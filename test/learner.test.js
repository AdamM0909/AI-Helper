import { test } from "node:test";
import assert from "node:assert/strict";
import { createLearner, recordCheck, setLessonPlan, dueForReview, summary } from "../public/js/learner.js";

function learnerWithPlan() {
  const learner = createLearner({ subject: "English grammar" });
  setLessonPlan(learner, "Diagramming sentences", ["Subject and verb", "Adjectives and adverbs"]);
  return learner;
}

test("three independent correct answers in a row means mastered", () => {
  const learner = learnerWithPlan();
  recordCheck(learner, "Subject and verb", "correct");
  recordCheck(learner, "Subject and verb", "correct");
  const { concept, pacing } = recordCheck(learner, "Subject and verb", "correct");
  assert.equal(concept.levelName, "mastered");
  assert.match(pacing, /Adjectives and adverbs/);
});

test("answers that needed hints don't count toward mastery", () => {
  const learner = learnerWithPlan();
  for (let i = 0; i < 4; i++) recordCheck(learner, "Subject and verb", "correct", 2);
  const { concept, pacing } = recordCheck(learner, "Subject and verb", "correct", 1);
  assert.notEqual(concept.levelName, "mastered");
  assert.match(pacing, /alone/);
});

test("two misses in a row tells the tutor to slow down and change approach", () => {
  const learner = learnerWithPlan();
  recordCheck(learner, "Subject and verb", "incorrect");
  const { pacing } = recordCheck(learner, "Subject and verb", "incorrect");
  assert.match(pacing, /SLOW DOWN/);
  assert.match(pacing, /new angle/);
});

test("a streak speeds things up", () => {
  const learner = learnerWithPlan();
  recordCheck(learner, "Subject and verb", "correct");
  const { pacing } = recordCheck(learner, "Subject and verb", "correct");
  assert.match(pacing, /harder/);
});

test("slipping after mastery drops to 'getting it'", () => {
  const learner = learnerWithPlan();
  for (let i = 0; i < 3; i++) recordCheck(learner, "Subject and verb", "correct");
  const { concept } = recordCheck(learner, "Subject and verb", "incorrect");
  assert.equal(concept.levelName, "getting it");
});

test("replacing the plan keeps progress on concepts that carry over", () => {
  const learner = learnerWithPlan();
  recordCheck(learner, "Subject and verb", "correct");
  setLessonPlan(learner, "Diagramming sentences", ["Subject and verb", "Prepositional phrases"]);
  assert.equal(learner.concepts[0].correct, 1);
  assert.equal(learner.concepts[1].attempts, 0);
});

test("finishing the whole plan triggers a celebration", () => {
  const learner = learnerWithPlan();
  for (let i = 0; i < 3; i++) recordCheck(learner, "Subject and verb", "correct");
  let result;
  for (let i = 0; i < 3; i++) result = recordCheck(learner, "Adjectives and adverbs", "correct");
  assert.match(result.pacing, /Celebrate/);
});

test("accented concept names are tracked correctly", () => {
  const learner = createLearner();
  setLessonPlan(learner, "Passé composé", ["Être verbs", "Avoir verbs"]);
  recordCheck(learner, "Etre verbs", "correct");
  assert.equal(learner.concepts[0].id, "etre-verbs");
  assert.equal(learner.concepts[0].correct, 1);
  assert.equal(learner.concepts.length, 2);
});

test("spaced review: mastered concepts come back after 1, 2, then 4 days", () => {
  const DAY = 24 * 60 * 60 * 1000;
  let now = Date.parse("2026-10-07T12:00:00Z");
  const learner = learnerWithPlan();
  for (let i = 0; i < 3; i++) recordCheck(learner, "Subject and verb", "correct", 0, now);
  assert.equal(dueForReview(learner, now).length, 0);
  assert.equal(dueForReview(learner, now + 1 * DAY).length, 1);
  assert.equal(summary(learner, now + 1 * DAY).concepts[0].due, true);

  now += 1 * DAY;
  const { pacing } = recordCheck(learner, "Subject and verb", "correct", 0, now);
  assert.match(pacing, /still remember/);
  assert.equal(dueForReview(learner, now + 1 * DAY).length, 0);
  assert.equal(dueForReview(learner, now + 2 * DAY).length, 1);

  now += 2 * DAY;
  recordCheck(learner, "Subject and verb", "correct", 0, now);
  now += 4 * DAY;
  assert.equal(dueForReview(learner, now).length, 1);
  recordCheck(learner, "Subject and verb", "correct", 0, now);
  assert.equal(dueForReview(learner, now + 30 * DAY).length, 0); // locked in, no more reviews
});

test("spaced review: forgetting drops the concept back so it's re-learned", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse("2026-10-07T12:00:00Z");
  const learner = learnerWithPlan();
  for (let i = 0; i < 3; i++) recordCheck(learner, "Subject and verb", "correct", 0, now);
  const { concept } = recordCheck(learner, "Subject and verb", "incorrect", 0, now + DAY);
  assert.equal(concept.levelName, "getting it");
  assert.equal(dueForReview(learner, now + 10 * DAY).length, 0);
});

test("spaced review: every gap fits inside the 5-day cleanup", async () => {
  const { REVIEW_DAYS } = await import("../public/js/learner.js");
  const { IDLE_DAYS } = await import("../public/js/housekeeping.js");
  assert.ok(REVIEW_DAYS.every((d) => d < IDLE_DAYS));
});
