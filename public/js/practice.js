// Practice tests: a short set of multiple-choice questions across the whole
// pathway, answered one at a time with no hints, then scored.
import { recordCheck } from "./learner.js";

export const TEST_LENGTH = 5;
const LETTERS = ["a", "b", "c", "d"];

// Field order matters: the model writes the options before naming the answer
// and explains why after, which keeps small models more accurate.
const SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          concept: { type: "string" },
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          answer: { type: "string", enum: LETTERS },
          why: { type: "string" },
        },
        required: ["concept", "question", "options", "answer", "why"],
      },
    },
  },
  required: ["questions"],
};

function prompt(learner) {
  const p = learner.profile;
  return [
    {
      role: "system",
      content: `You write practice tests for a ${p.grade || "high school"} student. Reply with JSON only.
Write ${TEST_LENGTH} multiple-choice questions that check the concepts below, spread across them, starting easy and getting a bit harder.
Each question: 3 or 4 short options, exactly one correct, wrong options based on common mistakes. "answer" is the letter of the correct option (a = first). "why" is one friendly sentence explaining the right answer.
Use new examples, not ones from homework.`,
    },
    { role: "user", content: `Subject: ${p.subject || "general"}\nTopic: ${learner.topic}\nConcepts:\n${learner.concepts.map((c) => `- ${c.name}`).join("\n")}` },
  ];
}

// Keeps only well-formed questions, matched to the pathway's concepts.
export function cleanQuestions(raw, learner) {
  const names = learner.concepts.map((c) => c.name);
  const seen = new Set();
  const out = [];
  for (const q of Array.isArray(raw?.questions) ? raw.questions : []) {
    if (!q || typeof q.question !== "string" || !q.question.trim() || seen.has(q.question.trim())) continue;
    const options = Array.isArray(q.options) ? q.options.filter((o) => typeof o === "string" && o.trim()).map((o) => o.trim().slice(0, 160)) : [];
    const answer = LETTERS.indexOf(String(q.answer).toLowerCase());
    if (options.length < 3 || options.length > 4 || new Set(options).size !== options.length || answer < 0 || answer >= options.length) continue;
    const concept = names.find((n) => n.toLowerCase() === String(q.concept || "").toLowerCase().trim()) || names[out.length % names.length] || learner.topic;
    seen.add(q.question.trim());
    out.push({ kind: "choice", concept, question: q.question.trim().slice(0, 300), options, answer, why: typeof q.why === "string" ? q.why.trim().slice(0, 300) : "" });
    if (out.length === TEST_LENGTH) break;
  }
  return out;
}

export async function buildPracticeTest(llm, learner, { signal } = {}) {
  const raw = await llm.json({ messages: prompt(learner), schema: SCHEMA, signal, maxTokens: 1400 });
  return cleanQuestions(raw, learner);
}

// picks[i]: the option index chosen for question i.
// Records each answer toward mastery and returns a summary.
export function scoreTest(learner, questions, picks, now = Date.now()) {
  const results = questions.map((q, i) => ({ ...q, picked: picks[i], right: picks[i] === q.answer }));
  for (const r of results) recordCheck(learner, r.concept, r.right ? "correct" : "incorrect", 0, now);
  const score = results.filter((r) => r.right).length;
  const toReview = [...new Set(results.filter((r) => !r.right).map((r) => r.concept))];
  return { results, score, total: results.length, toReview };
}

// A short note saved into the chat so the tutor knows how the test went.
export function resultNote({ score, total, toReview }) {
  return `(Practice test finished: ${score} of ${total} right.${toReview.length ? ` Worth reviewing: ${toReview.join(", ")}.` : " Everything right!"})`;
}
