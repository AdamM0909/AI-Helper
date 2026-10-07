// Tracks what a student knows, concept by concept, and turns that into
// concrete pacing advice for the tutor. Kept free of any API code so the
// rules are easy to read, tweak and test.

export const LEVELS = ["new", "learning", "getting it", "mastered"];

// How many correct answers in a row (without leaning on hints) count as mastery.
const MASTERY_STREAK = 3;
// Spaced review: mastered concepts come back for a quick check after these
// many days. All gaps stay under the 5-day idle cleanup (see housekeeping.js),
// so a review is never wiped before it's due.
export const REVIEW_DAYS = [1, 2, 4];
const DAY_MS = 24 * 60 * 60 * 1000;

// How many misses in a row before the tutor must change its approach.
const STRUGGLE_THRESHOLD = 2;

export function createLearner(profile = {}) {
  return {
    profile: {
      name: profile.name || "",
      grade: profile.grade || "",
      subject: profile.subject || "",
      goal: profile.goal || "",
    },
    topic: "",
    concepts: [],
  };
}

function newConcept(id, name) {
  return {
    id,
    name,
    attempts: 0,
    correct: 0,
    streak: 0,
    missesInRow: 0,
    level: 0,
  };
}

function slug(text) {
  return String(text)
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // "Être" and "Etre" are the same concept
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// Replace the lesson plan, keeping progress on any concept that carries over.
export function setLessonPlan(learner, topic, conceptNames) {
  const existing = new Map(learner.concepts.map((c) => [c.id, c]));
  learner.topic = topic;
  learner.concepts = conceptNames.map((name) => {
    const id = slug(name);
    return existing.get(id) || newConcept(id, name);
  });
  return learner.concepts;
}

function findConcept(learner, conceptName) {
  const id = slug(conceptName);
  let concept = learner.concepts.find((c) => c.id === id);
  if (!concept) {
    // The tutor checked something that wasn't in the plan; track it anyway.
    concept = newConcept(id, conceptName);
    learner.concepts.push(concept);
  }
  return concept;
}

// Record one check-for-understanding result and return pacing guidance.
//   result: "correct" | "partial" | "incorrect"
//   hintsUsed: how many hints the student needed for this question
export function recordCheck(learner, conceptName, result, hintsUsed = 0, now = Date.now()) {
  const concept = findConcept(learner, conceptName);
  concept.attempts += 1;
  const wasMastered = concept.level === 3;
  const wasDue = isDue(concept, now);

  // A right answer that needed lots of hints shows progress but not mastery yet.
  const independent = result === "correct" && hintsUsed === 0;

  if (result === "correct") {
    concept.correct += 1;
    concept.missesInRow = 0;
    concept.streak = independent ? concept.streak + 1 : Math.max(concept.streak, 1);
  } else if (result === "partial") {
    concept.missesInRow = 0;
    concept.streak = 0;
  } else {
    concept.missesInRow += 1;
    concept.streak = 0;
  }

  if (concept.streak >= MASTERY_STREAK) concept.level = 3;
  // Slipping after mastery drops to "getting it", not all the way back.
  else if (concept.streak >= 2 || concept.level === 3) concept.level = 2;
  else concept.level = 1;

  // Schedule spaced reviews.
  let pacing;
  if (concept.level === 3 && !wasMastered) {
    concept.reviewStep = 0;
    concept.reviewDue = now + REVIEW_DAYS[0] * DAY_MS;
  } else if (concept.level === 3 && wasDue && result === "correct") {
    concept.reviewStep = (concept.reviewStep ?? 0) + 1;
    concept.reviewDue = concept.reviewStep < REVIEW_DAYS.length ? now + REVIEW_DAYS[concept.reviewStep] * DAY_MS : null;
    pacing = `Review check: they still remember "${concept.name}" after a break. That's how you know it's sticking! Tell them warmly, then continue.`;
  } else if (concept.level < 3) {
    concept.reviewDue = null; // it has to be mastered again first
  }

  return { concept: { ...concept, levelName: LEVELS[concept.level] }, pacing: pacing || pacingFor(learner, concept, result, hintsUsed) };
}

function pacingFor(learner, concept, result, hintsUsed) {
  if (concept.missesInRow >= STRUGGLE_THRESHOLD) {
    return [
      `SLOW DOWN. The student has missed "${concept.name}" ${concept.missesInRow} times in a row.`,
      "Do not repeat the same explanation. Try a new angle: an everyday analogy, a worked example of a different problem, or break the idea into a smaller first step.",
      "Then check only that smaller step with an easy multiple-choice question. Reassure them warmly that this part is tricky for everyone and that they're making progress.",
    ].join(" ");
  }
  if (result === "incorrect") {
    return `Not quite yet. Gently find the specific misconception in their answer, give one targeted hint (not the answer), and encourage them to try again.`;
  }
  if (result === "partial") {
    return `Partly right. Warmly point out what they got right, then ask a guiding question about the missing piece.`;
  }
  if (concept.level === 3) {
    const next = learner.concepts.find((c) => c.level < 3);
    return next
      ? `"${concept.name}" is mastered. Briefly celebrate, then move on to "${next.name}". Mix a quick "${concept.name}" question into later practice so it sticks.`
      : `Every concept in the plan is mastered! Celebrate their hard work warmly and specifically, and tell them how far they've come.`;
  }
  if (hintsUsed > 0) {
    return `Right, but with ${hintsUsed} hint(s). Ask a similar question at the same difficulty and see if they can do it alone this time.`;
  }
  if (concept.streak >= 2) {
    return `On a roll (${concept.streak} in a row). Speed up: ask a harder open question where they produce the answer themselves (not multiple choice), with less scaffolding.`;
  }
  return `Correct. Keep the same difficulty for one more question to confirm it wasn't a lucky guess.`;
}

function isDue(concept, now) {
  return concept.level === 3 && typeof concept.reviewDue === "number" && concept.reviewDue <= now;
}

// Mastered concepts whose spaced review is due.
export function dueForReview(learner, now = Date.now()) {
  return learner.concepts.filter((c) => isDue(c, now));
}

export function summary(learner, now = Date.now()) {
  return {
    topic: learner.topic,
    concepts: learner.concepts.map((c) => ({
      due: isDue(c, now),
      id: c.id,
      name: c.name,
      level: c.level,
      levelName: LEVELS[c.level],
      attempts: c.attempts,
      correct: c.correct,
      streak: c.streak,
    })),
  };
}
