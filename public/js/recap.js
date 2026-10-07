// Session recap: what the student learned, what to practice next, and one
// key example, to read again (or screenshot) before a test.
import { LEVELS } from "./learner.js";

const SCHEMA = {
  type: "object",
  properties: {
    learned: { type: "array", items: { type: "string" } },
    practice_next: { type: "array", items: { type: "string" } },
    key_example: { type: "string" },
  },
  required: ["learned", "practice_next", "key_example"],
};

// The part that doesn't need the AI: straight from the progress tracking.
export function progressPart(learner) {
  return {
    topic: learner.topic || learner.profile.subject || "Your topic",
    mastered: learner.concepts.filter((c) => c.level === 3).map((c) => c.name),
    inProgress: learner.concepts.filter((c) => c.level > 0 && c.level < 3).map((c) => `${c.name} (${LEVELS[c.level]})`),
    notStarted: learner.concepts.filter((c) => c.level === 0).map((c) => c.name),
  };
}

const strings = (list, max) =>
  (Array.isArray(list) ? list : []).filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim().slice(0, 200)).slice(0, max);

export async function buildRecap(llm, session, { signal } = {}) {
  const progress = progressPart(session.learner);
  const transcript = session.messages
    .slice(-12)
    .map((m) => `${m.role === "user" ? "STUDENT" : "TUTOR"}: ${m.content.slice(0, 600)}`)
    .join("\n\n");
  let ai = null;
  try {
    const raw = await llm.json({
      signal,
      maxTokens: 500,
      schema: SCHEMA,
      messages: [
        {
          role: "system",
          content: `You write a short, encouraging study recap for a high school student, in plain words they'd understand. Reply with JSON only.
- learned: 2 to 4 short bullet points of what they learned, as rules or facts they can reread.
- practice_next: 1 to 3 short, specific things to practice next.
- key_example: one short example that captures the most important idea (for example a conjugation or a solved step).
Don't include anything from their homework answers.`,
        },
        { role: "user", content: `Topic: ${progress.topic}\nMastered: ${progress.mastered.join(", ") || "none yet"}\nStill practicing: ${progress.inProgress.join(", ") || "none"}\n\nRecent conversation:\n${transcript}` },
      ],
    });
    if (raw) ai = { learned: strings(raw.learned, 4), practiceNext: strings(raw.practice_next, 3), keyExample: typeof raw.key_example === "string" ? raw.key_example.trim().slice(0, 300) : "" };
  } catch (err) {
    if (err.name === "AbortError") throw err;
  }
  return { ...progress, ...(ai || { learned: [], practiceNext: [], keyExample: "" }), date: new Date().toLocaleDateString() };
}

// Plain-text version for copying.
export function recapText(r) {
  const section = (title, items) => (items.length ? `${title}\n${items.map((i) => `• ${i}`).join("\n")}\n` : "");
  return [
    `Sage recap: ${r.topic} (${r.date})`,
    "",
    section("What I learned", r.learned),
    r.keyExample ? `Key example\n${r.keyExample}\n` : "",
    section("Mastered", r.mastered),
    section("Still practicing", r.inProgress),
    section("Practice next", r.practiceNext.length ? r.practiceNext : r.inProgress.concat(r.notStarted).slice(0, 3)),
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}
