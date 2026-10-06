import { recordCheck, setLessonPlan, summary, LEVELS } from "./learner.js";

// Small local models have short memories, so only recent messages are sent.
// The lesson plan and progress are always included, so nothing important is lost.
const HISTORY_MESSAGES = Number(process.env.HISTORY_MESSAGES) || 16;

const TUTOR_RULES = `You are Sage, a patient tutor for high school students who are stuck on something in school: diagramming sentences, French, algebra, chemistry, essay structure, whatever comes up. You are not an answer machine. Your job is to make the student able to do the work on their own.

How you teach:
- Find out where they are first. Before explaining anything, ask a question or two that shows what they already understand and where it breaks down. Build from what they know.
- Teach in small pieces. One idea at a time, explained in plain language with a short example. Keep each message brief, a few short paragraphs at most.
- Check after every piece. End each teaching step with one question that makes them use the idea (not "does that make sense?"). Wait for their answer before moving on.
- When they're wrong, don't correct it for them. Figure out what misconception produced the answer, then give the smallest hint that lets them fix it themselves. Hints escalate: a nudge, then a more specific pointer, then a worked example of a similar (not identical) problem.
- When they're right, say specifically what they did well, then raise the difficulty a little.
- Use examples from their world (sports, music, games, food, friends). Be warm and encouraging, never condescending. Struggling is normal and you say so.

Homework and answers:
- Never do their assignment for them. If they paste homework questions, don't answer them. Teach the skill using your own similar practice examples, then let them do their real questions and offer to check their reasoning.
- If they ask you to just give the answer, kindly explain that you'll get them there faster together, and give a hint instead. If they've genuinely tried several times, walk through a worked example of a similar problem, then hand them back their own.
- You can confirm whether an answer they came up with is right, and explain why.

Formatting: use Markdown. For anything visual, such as a sentence diagram, verb conjugation table or step-by-step equation, use a table or a monospace code block so the layout stays intact. For sentence diagrams, use a text layout like this and explain the parts:
\`\`\`
 dog      | barked
----------+--------
  \\ The   |   \\ loudly
\`\`\`

Privacy: never ask for personal details like their full name, address, phone number, school name or social media.

Stay on schoolwork and learning. If a student seems upset or mentions something serious going on in their life, be kind, and encourage them to talk to a trusted adult such as a parent, teacher or school counselor.`;

function aboutStudent(learner) {
  const p = learner.profile;
  const lines = [
    p.name && `Name: ${p.name}`,
    p.grade && `Grade: ${p.grade}`,
    p.subject && `Subject: ${p.subject}`,
    p.goal && `What they said they're stuck on: ${p.goal}`,
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : "(they didn't say yet; ask)";
}

function planText(learner) {
  if (learner.concepts.length === 0) return "No plan yet.";
  const rows = learner.concepts.map((c, i) => `${i + 1}. ${c.name}: ${LEVELS[c.level]} (${c.correct}/${c.attempts} correct)`);
  return `Topic: ${learner.topic}\n${rows.join("\n")}`;
}

function replySystemPrompt(learner, pacing) {
  return `${TUTOR_RULES}

About this student:
${aboutStudent(learner)}

Lesson plan and progress:
${planText(learner)}

Pacing for this reply (follow it):
${pacing}

Most important: teach with hints and questions, never just give answers, and end with one question for the student.`;
}

// ---- Step 1: grade the student's message ----

const ASSESS_SCHEMA = {
  type: "object",
  properties: {
    answered_check: { type: "boolean" },
    concept: { type: "string" },
    result: { type: "string", enum: ["correct", "partial", "incorrect", "none"] },
    hints_used: { type: "integer" },
    update_plan: { type: "boolean" },
    topic: { type: "string" },
    concepts: { type: "array", items: { type: "string" } },
  },
  required: ["answered_check", "concept", "result", "hints_used", "update_plan", "topic", "concepts"],
};

function assessMessages(learner, recent) {
  const transcript = recent.map((m) => `${m.role === "user" ? "STUDENT" : "TUTOR"}: ${m.content}`).join("\n\n");
  return [
    {
      role: "system",
      content: `You grade a tutoring conversation. You never talk to the student. Reply with JSON only.

Fields:
- answered_check: true only if the STUDENT's last message answers a practice or check question the TUTOR asked just before it.
- concept: if answered_check, which concept from the lesson plan the question tested (copy its name exactly). Otherwise "".
- result: "correct", "partial" or "incorrect" if answered_check, otherwise "none". Judge the subject matter carefully.
- hints_used: how many hints the tutor gave for that question before this answer (0 if none).
- update_plan: true if there is no plan yet and you now know what the student needs, or the student switched to a different topic.
- topic and concepts: if update_plan, a short topic name and 2 to 6 concepts to teach in order, each a single learnable idea. Otherwise "" and [].

Student: ${aboutStudent(learner).replace(/\n/g, "; ")}
Lesson plan:
${planText(learner)}`,
    },
    { role: "user", content: `Conversation (most recent last):\n\n${transcript}` },
  ];
}

function validAssessment(a) {
  return (
    a &&
    typeof a.answered_check === "boolean" &&
    typeof a.update_plan === "boolean" &&
    ["correct", "partial", "incorrect", "none"].includes(a.result)
  );
}

// Returns pacing guidance for the reply, updating the learner along the way.
async function assess(llm, session, signal, emit) {
  const recent = session.messages.slice(-4);
  const a = await llm.json({ messages: assessMessages(session.learner, recent), schema: ASSESS_SCHEMA, signal }).catch((err) => {
    if (err.name === "AbortError") throw err;
    return null; // grading is a bonus; never block the reply on it
  });
  if (!validAssessment(a)) return "No answer to grade this time. Keep teaching at the current pace.";

  const notes = [];
  const concepts = Array.isArray(a.concepts) ? a.concepts.filter((c) => typeof c === "string" && c.trim()).slice(0, 8) : [];
  if (a.update_plan && concepts.length > 0) {
    setLessonPlan(session.learner, String(a.topic || session.learner.profile.subject || "Your plan").trim().slice(0, 80), concepts.map((c) => c.trim().slice(0, 80)));
    notes.push(`New lesson plan: ${concepts.join(", ")}. Start with the first concept.`);
    emit({ type: "progress", progress: summary(session.learner) });
  }
  if (a.answered_check && a.result !== "none" && typeof a.concept === "string" && a.concept.trim()) {
    const hints = Number.isInteger(a.hints_used) && a.hints_used >= 0 ? a.hints_used : 0;
    const { pacing } = recordCheck(session.learner, a.concept.trim().slice(0, 80), a.result, hints);
    notes.push(`Their answer was ${a.result}. ${pacing}`);
    emit({ type: "progress", progress: summary(session.learner) });
  }
  return notes.join("\n") || "No answer to grade this time. Keep teaching at the current pace.";
}

// ---- Step 2: reply ----

// Runs one student turn: grades their message, then streams the tutor's
// reply through `emit` and saves both to session.messages.
export async function tutorTurn(llm, session, studentText, emit, { signal } = {}) {
  session.messages.push({ role: "user", content: studentText });

  const pacing = await assess(llm, session, signal, emit);

  const reply = await llm.chat({
    messages: [
      { role: "system", content: replySystemPrompt(session.learner, pacing) },
      ...session.messages.slice(-HISTORY_MESSAGES),
    ],
    signal,
    onText: (text) => emit({ type: "text", text }),
  });

  session.messages.push({ role: "assistant", content: reply });
}
