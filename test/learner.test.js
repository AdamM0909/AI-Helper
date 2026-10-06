import { test } from "node:test";
import assert from "node:assert/strict";
import { createLearner, recordCheck, setLessonPlan } from "../public/js/learner.js";

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

test("finishing the whole plan triggers a mixed review", () => {
  const learner = learnerWithPlan();
  for (let i = 0; i < 3; i++) recordCheck(learner, "Subject and verb", "correct");
  let result;
  for (let i = 0; i < 3; i++) result = recordCheck(learner, "Adjectives and adverbs", "correct");
  assert.match(result.pacing, /mixed review/);
});

test("accented concept names are tracked correctly", () => {
  const learner = createLearner();
  setLessonPlan(learner, "Passé composé", ["Être verbs", "Avoir verbs"]);
  recordCheck(learner, "Etre verbs", "correct");
  assert.equal(learner.concepts[0].id, "etre-verbs");
  assert.equal(learner.concepts[0].correct, 1);
  assert.equal(learner.concepts.length, 2);
});
