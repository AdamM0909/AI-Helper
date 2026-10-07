import { recordCheck, setLessonPlan, summary, LEVELS } from "./learner.js";
import { guideFor } from "./subjects.js";
import { parseQuiz, KIND_LABELS } from "./quiz.js";

// The in-browser models only remember about 4,000 tokens (roughly 12,000
// characters), so the conversation is trimmed to fit alongside the instructions.
const HISTORY_CHAR_BUDGET = 5500;
const REPLY_MAX_TOKENS = 450;

// Kept short and concrete on purpose: small models follow a few clear rules
// and one example far better than a long list of guidelines.
const TUTOR_RULES = `You are Sage, a warm, patient tutor for high school students. Many of them have been struggling and feel discouraged, so you are kind, calm and encouraging. You help them learn to do it themselves; you never just give answers.

Your voice:
- Nurturing and on their side. Say "we" and "let's". Believe in them out loud ("you're closer than you think").
- Praise effort and thinking, not just right answers ("I like how you broke that down").
- Treat mistakes as a normal part of learning: "Not quite yet, but that's a really common mix-up." Never say "wrong", "no", "incorrect", "obviously", "simply", "just", "easy" or "clearly".
- Never sound disappointed, impatient or like you're lecturing. No sarcasm.

Every reply:
1. Respond kindly to what they said: name exactly what they got right, or gently give ONE hint about what to look at again.
2. Teach at most one small idea, with a short, friendly example.
3. End with exactly one question that guides them to the next step: either an open question or a multiple-choice quiz (see below).
Keep replies under 120 words.

Choosing the kind of question:
- Multiple choice, matching or put-in-order fit quick checks, recognizing the right form or rule, and moments when the student is struggling.
- Fill in the blank fits recalling one exact word or form (a verb ending, a vocabulary word, a number).
- An open question fits when they should produce or explain something themselves.
- Mix them, and don't repeat the same kind twice in a row unless they're struggling.
For an interactive question, end your reply with ONE block like these. The student sees buttons or a box, and answers stay hidden:
\`\`\`quiz
question: Which helper verb does "aller" use?
a) avoir
b) être
c) faire
answer: b
\`\`\`
\`\`\`blank
question: Hier, je ___ allé au parc.
answer: suis
\`\`\`
\`\`\`order
question: Put the steps in order to solve 2x + 3 = 7
- Subtract 3 from both sides
- Divide both sides by 2
- Check by plugging x back in
\`\`\`
(list the steps in the CORRECT order; the page shuffles them)
\`\`\`match
question: Match each word to its meaning
chien = dog
chat = cat
oiseau = bird
\`\`\`
Multiple choice: 3 or 4 options, exactly one right, wrong options based on common mistakes. Don't ask a second question outside the block.

Rules:
- Never give the final answer to their question or homework. Teach with your own similar example instead.
- If they're not quite right, don't say the right answer. Guide them with a hint so they can find it.
- If they ask for the answer, reassure them that you'll get there together, then give a hint.
- If they've tried 3 or more times, show a worked example of a SIMILAR problem, then invite them to try theirs again.
- Use examples from sports, music, games and food. Use Markdown, and put conjugations, diagrams and math steps in tables or code blocks.
- Don't ask for personal details. If they seem upset about something serious, kindly suggest talking to a trusted adult.

Example of a good reply:
Student: what's "I went" in french? i keep getting it wrong. just tell me
Sage: You're not alone, this one trips up almost everyone at first! Let's figure it out together. "Went" is past tense, so we use the **passé composé**. *Aller* is one of the special verbs that uses **être** as its helper instead of avoir:
| helper (être) | + | past participle |
|---|---|---|
| je suis | + | allé |
Using that pattern, what do you think "I went" would be?`;

// ---- Spotting situations that small models handle badly ----

export function detectSituation(text) {
  const notes = [];
  if (/\b(just|pls|please)?\s*(tell|give|show) me (the )?(answers?|solution)|what('s| is) the answer|do (it|this|my homework) for me|answer (these|this) for me|can you (just )?(solve|do) (it|this|these)/i.test(text)) {
    notes.push("The student is asking for the answer. Don't give it. Be warm and understanding (they may be tired or stressed), tell them you believe they can do this, and offer a hint or a smaller first step.");
  }
  const listedQuestions = text.split("\n").filter((line) => /^\s*(\d+|[a-h])[.)]\s+\S/i.test(line)).length;
  if (listedQuestions >= 2 || /\b(question|problem|exercise) \d+/i.test(text)) {
    notes.push("The student pasted assignment questions. Don't answer any of them. Pick the skill they need, teach it with your OWN similar example, then ask them to try the first question themselves.");
  }
  if (/\b(i give up|i'?m (so )?(dumb|stupid)|this is (so )?(dumb|stupid|pointless)|i hate (this|it)|i can'?t do (this|it)|i'?ll never (get|understand)|so confused|frustrat)/i.test(text)) {
    notes.push("The student sounds frustrated or down on themselves. Start with real empathy: this is hard, feeling stuck is normal, and needing help doesn't mean they're not smart. Point to something they've already done well. Then make the next step smaller and easier.");
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
    const verdict = { correct: "right", partial: "partly right", incorrect: "not quite right yet" }[a.result];
    guidance.push(`Their answer was ${verdict}. ${pacing}`);
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

// Phrases that make a struggling student feel judged. Small models fall back
// on these even when told not to, so replies that use them get rewritten.
const HARSH = /\b(that'?s|this is|you'?re|your answer is) (wrong|incorrect|not correct)\b|^\s*(no|wrong|incorrect)[.!,]|\b(obviously|simply|clearly)\b|\bas i (already )?(said|told you|explained)\b|\bthat'?s (easy|basic)\b|\bit'?s easy\b/im;

export function soundsHarsh(reply) {
  return HARSH.test(reply);
}

// Grades an answer to an interactive question. The question carries its own
// answer and the page has already graded it, so no model call is needed.
//   answer: { kind, question, concept, result, given, correct, wrongTries }
//     result: "correct" | "partial" | "incorrect"
//     given / correct: the student's answer and the right one, as text
function gradeAnswer(session, answer, emit) {
  const learner = session.learner;
  const concept = answer.concept || learner.concepts.find((c) => c.level < 3)?.name || learner.topic || "Practice";
  // A right answer after wrong tries counts as needing help.
  const hints = answer.result === "correct" ? answer.wrongTries : 0;
  const { pacing } = recordCheck(learner, concept.slice(0, 80), answer.result, hints);
  emit({ type: "progress", progress: summary(learner) });

  const label = KIND_LABELS[answer.kind] || "question";
  const intro = `They answered your ${label} "${answer.question}" with: ${answer.given}.`;
  if (answer.result === "correct") {
    return { guidance: [`${intro} That's right! Briefly say why it's right. ${pacing}`], expected: "" };
  }
  const secret = `(For you only, DO NOT reveal it: the right answer is ${answer.correct}.)`;
  const retry = "They can try again right there. Gently explain what's tempting about their answer, give ONE hint, and invite them to try again. Don't ask a new question yet.";
  const partial = answer.kind === "blank" ? "They have the right word but the accents are off. Warmly point them to the accents." : "Part of it is right. Warmly name what they got right, then hint at the rest.";
  return {
    guidance: [`${intro} ${answer.result === "partial" ? "That's partly right." : "That's not quite right yet."} ${secret}`, answer.result === "partial" ? partial : "", retry].filter(Boolean),
    // Only short answers can be leak-checked; order and match answers are lists.
    expected: answer.kind === "choice" || answer.kind === "blank" ? answer.correct.replace(/^"|"$/g, "") : "",
  };
}

// Runs one student turn: grades their message, then streams the tutor's
// reply through `emit` and saves both to session.messages.
//   answer: set when the student answered an interactive question (see gradeAnswer)
//   extra: additional guidance for this reply (e.g. a warm-up review)
export async function tutorTurn(llm, session, studentText, emit, { signal, answer, extra = [] } = {}) {
  session.messages.push({ role: "user", content: studentText });

  const { guidance, expected } = answer ? gradeAnswer(session, answer, emit) : await assess(llm, session, signal, emit);
  if (!answer) guidance.push(...detectSituation(studentText));
  guidance.push(...extra);

  const history = recentHistory(session.messages);
  const generate = (lines) =>
    llm.chat({
      messages: [{ role: "system", content: replySystemPrompt(session.learner, lines) }, ...history],
      maxTokens: REPLY_MAX_TOKENS,
      signal,
      onText: (text) => emit({ type: "text", text }),
    });

  let reply = await generate(guidance);

  // Small models sometimes give the answer away or sound harsh anyway.
  // Catch that and rewrite once.
  // The quiz block is left out of these checks: its options may contain the answer on purpose.
  const shown = parseQuiz(reply).text;
  const fixes = [];
  if (revealsAnswer(shown, expected)) {
    fixes.push(`IMPORTANT: Do not write "${expected}" or any other form of the answer. Give a hint that helps them work it out instead.`);
  }
  if (soundsHarsh(shown)) {
    fixes.push(`IMPORTANT: Your last draft sounded harsh. Be gentle and encouraging. Instead of "wrong" or "incorrect", say something like "not quite yet" and guide them. Don't use "obviously", "simply", "clearly" or "easy".`);
  }
  if (fixes.length > 0) {
    emit({ type: "reset" });
    reply = await generate([...guidance, ...fixes]);
  }

  session.messages.push({ role: "assistant", content: reply });
}
