import { recordCheck, setLessonPlan, summary, LEVELS } from "./learner.js";
import { guideFor } from "./subjects.js";

// The in-browser models only remember about 4,000 tokens (roughly 12,000
// characters), so the conversation is trimmed to fit alongside the instructions.
const HISTORY_CHAR_BUDGET = 5500;
const REPLY_MAX_TOKENS = 450;

// Kept short and concrete on purpose: small models follow a few clear rules
// and one example far better than a long list of guidelines.
const TUTOR_RULES = `You are Sage, a friendly tutor for high school students. You help them learn to do it themselves. You never just give answers.

Every reply:
1. React to what the student said: say exactly what they got right, or give ONE hint about what's wrong.
2. Teach at most one small idea, with a short example.
3. End with exactly one question for the student to answer.
Keep replies under 120 words.

Rules:
- Never give the final answer to the student's question or homework. Teach with your own similar example instead.
- If they're wrong, don't say the right answer. Give a hint so they can find it themselves.
- If they ask for the answer, say you'll get there together, then give a hint.
- If they've tried 3 or more times, show a worked example of a SIMILAR problem, then ask them to try theirs again.
- Be warm and encouraging. Use examples from sports, music, games and food.
- Use Markdown. Put conjugations, diagrams and math steps in tables or code blocks.
- Don't ask for personal details. If they seem upset about something serious, kindly suggest talking to a trusted adult.

Example of a good reply:
Student: what's "I went" in french? just tell me
Sage: Let's work it out, it'll stick better that way! "Went" is past tense, so we use the **passé composé**. *Aller* is one of the verbs that uses **être** as its helper instead of avoir:
| helper (être) | + | past participle |
|---|---|---|
| je suis | + | allé |
So what do you think "I went" is? And bonus: what would "she went" be?`;

// ---- Spotting situations that small models handle badly ----

export function detectSituation(text) {
  const notes = [];
  if (/\b(just|pls|please)?\s*(tell|give|show) me (the )?(answers?|solution)|what('s| is) the answer|do (it|this|my homework) for me|answer (these|this) for me|can you (just )?(solve|do) (it|this|these)/i.test(text)) {
    notes.push("The student is asking for the answer. Don't give it. Be kind, say they can do this, and give a hint or a smaller first step.");
  }
  const listedQuestions = text.split("\n").filter((line) => /^\s*(\d+|[a-h])[.)]\s+\S/i.test(line)).length;
  if (listedQuestions >= 2 || /\b(question|problem|exercise) \d+/i.test(text)) {
    notes.push("The student pasted assignment questions. Don't answer any of them. Pick the skill they need, teach it with your OWN similar example, then ask them to try the first question themselves.");
  }
  if (/\b(i give up|i'?m (so )?(dumb|stupid)|this is (so )?(dumb|stupid|pointless)|i hate (this|it)|i can'?t do (this|it)|i'?ll never (get|understand)|so confused|frustrat)/i.test(text)) {
    notes.push("The student sounds frustrated. Start by reassuring them that this is hard and they're making progress. Make the next step smaller and easier.");
  }
  return notes;
}

// ---- Prompt building ----

function aboutStudent(learner) {
  const p = learner.profile;
  return (
    [p.name && `Name: ${p.name}`, p.grade && `Grade: ${p.grade}`, p.subject && `Subject: ${p.subject}`, p.goal && `Stuck on: ${p.goal}`]
      .filter(Boolean)
      .join("\n") || "(unknown; ask)"
  );
}

function planText(learner) {
  if (learner.concepts.length === 0) return "No plan yet.";
  const rows = learner.concepts.map((c, i) => `${i + 1}. ${c.name}: ${LEVELS[c.level]}`);
  return `Topic: ${learner.topic}\n${rows.join("\n")}`;
}

function replySystemPrompt(learner, guidance) {
  const guide = guideFor(learner.profile.subject, learner.profile.goal, learner.topic);
  return [
    TUTOR_RULES,
    guide && `Teaching notes for this subject:\n${guide}`,
    `About the student:\n${aboutStudent(learner)}`,
    `Lesson plan and progress:\n${planText(learner)}`,
    `What to do in this reply:\n${guidance.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Most recent messages that fit the budget, oldest first.
export function recentHistory(messages, budget = HISTORY_CHAR_BUDGET) {
  const kept = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const size = messages[i].content.length;
    if (kept.length > 0 && used + size > budget) break;
    kept.unshift(i === messages.length - 1 ? messages[i] : { ...messages[i], content: messages[i].content.slice(0, budget) });
    used += size;
  }
  return kept;
}

// ---- Step 1: grade the student's message ----

// Field order matters: the model writes the correct answer before it judges,
// which makes small models grade much more accurately.
const ASSESS_SCHEMA = {
  type: "object",
  properties: {
    tutor_question: { type: "string" },
    correct_answer: { type: "string" },
    answered_check: { type: "boolean" },
    concept: { type: "string" },
    result: { type: "string", enum: ["correct", "partial", "incorrect", "none"] },
    hints_used: { type: "integer" },
    update_plan: { type: "boolean" },
    topic: { type: "string" },
    concepts: { type: "array", items: { type: "string" } },
  },
  required: ["tutor_question", "correct_answer", "answered_check", "concept", "result", "hints_used", "update_plan", "topic", "concepts"],
};

function assessMessages(learner, recent) {
  const transcript = recent.map((m) => `${m.role === "user" ? "STUDENT" : "TUTOR"}: ${m.content.slice(0, 1500)}`).join("\n\n");
  return [
    {
      role: "system",
      content: `You grade a tutoring conversation. Reply with JSON only.

- tutor_question: the question the TUTOR asked just before the STUDENT's last message ("" if none).
- correct_answer: the correct answer to that question, worked out carefully ("" if none).
- answered_check: true only if the STUDENT's last message is an attempt to answer that question.
- concept: which lesson plan concept the question tested (copy its name), or "".
- result: compare the student's answer to correct_answer: "correct", "partial" or "incorrect". Use "none" if answered_check is false.
- hints_used: how many hints the tutor gave for this question (0 if none).
- update_plan: true if there is no plan yet, or the student changed topic.
- topic and concepts: if update_plan, a short topic name and 2 to 5 concepts to teach in order. Otherwise "" and [].

Student: ${aboutStudent(learner).replace(/\n/g, "; ")}
Lesson plan:
${planText(learner)}`,
    },
    { role: "user", content: `Conversation (most recent last):\n\n${transcript}` },
  ];
}

function validAssessment(a) {
  return a && typeof a.answered_check === "boolean" && typeof a.update_plan === "boolean" && ["correct", "partial", "incorrect", "none"].includes(a.result);
}

const KEEP_PACE = "Keep teaching at the current pace.";

// Returns guidance lines for the reply and the expected answer (if any),
// updating the learner along the way.
async function assess(llm, session, signal, emit) {
  const a = await llm.json({ messages: assessMessages(session.learner, session.messages.slice(-4)), schema: ASSESS_SCHEMA, signal }).catch((err) => {
    if (err.name === "AbortError") throw err;
    return null; // grading is a bonus; never block the reply on it
  });
  if (!validAssessment(a)) return { guidance: [KEEP_PACE], expected: "" };

  const guidance = [];
  const concepts = Array.isArray(a.concepts) ? a.concepts.filter((c) => typeof c === "string" && c.trim()).slice(0, 6) : [];
  if (a.update_plan && concepts.length > 0) {
    const topic = String(a.topic || session.learner.profile.subject || "Your plan").trim().slice(0, 80);
    setLessonPlan(session.learner, topic, concepts.map((c) => c.trim().slice(0, 80)));
    guidance.push(`New lesson plan. Start by finding out what they already know about "${concepts[0]}".`);
    emit({ type: "progress", progress: summary(session.learner) });
  }

  let expected = "";
  if (a.answered_check && a.result !== "none" && typeof a.concept === "string" && a.concept.trim()) {
    const hints = Number.isInteger(a.hints_used) && a.hints_used >= 0 ? a.hints_used : 0;
    const { pacing } = recordCheck(session.learner, a.concept.trim().slice(0, 80), a.result, hints);
    expected = typeof a.correct_answer === "string" ? a.correct_answer.trim().slice(0, 300) : "";
    guidance.push(`Their answer was ${a.result.toUpperCase()}. ${pacing}`);
    if (expected) {
      guidance.push(
        a.result === "correct"
          ? `(For you only: the expected answer was "${expected}".)`
          : `(For you only, DO NOT reveal it: the correct answer is "${expected}". Use it to give an accurate hint.)`,
      );
    }
    emit({ type: "progress", progress: summary(session.learner) });
  }
  return { guidance: guidance.length ? guidance : [KEEP_PACE], expected: a.result === "correct" ? "" : expected };
}

// ---- Step 2: reply ----

const normalize = (s) => s.toLowerCase().replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();

// Did the reply blurt out the answer the student got wrong?
export function revealsAnswer(reply, expected) {
  const answer = normalize(expected);
  return answer.length >= 4 && normalize(reply).includes(answer);
}

// Runs one student turn: grades their message, then streams the tutor's
// reply through `emit` and saves both to session.messages.
export async function tutorTurn(llm, session, studentText, emit, { signal } = {}) {
  session.messages.push({ role: "user", content: studentText });

  const { guidance, expected } = await assess(llm, session, signal, emit);
  guidance.push(...detectSituation(studentText));

  const history = recentHistory(session.messages);
  const generate = (lines) =>
    llm.chat({
      messages: [{ role: "system", content: replySystemPrompt(session.learner, lines) }, ...history],
      maxTokens: REPLY_MAX_TOKENS,
      signal,
      onText: (text) => emit({ type: "text", text }),
    });

  let reply = await generate(guidance);

  // Small models sometimes give the answer away anyway. Catch that and try once more.
  if (revealsAnswer(reply, expected)) {
    emit({ type: "reset" });
    reply = await generate([
      ...guidance,
      `IMPORTANT: Do not write "${expected}" or any other form of the answer. Give a hint that helps them work it out instead.`,
    ]);
  }

  session.messages.push({ role: "assistant", content: reply });
}
