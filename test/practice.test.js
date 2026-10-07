import { test } from "node:test";
import assert from "node:assert/strict";
import { createLearner, setLessonPlan } from "../public/js/learner.js";
import { buildPracticeTest, cleanQuestions, scoreTest, resultNote, TEST_LENGTH } from "../public/js/practice.js";
import { buildRecap, recapText, progressPart } from "../public/js/recap.js";

function plan() {
  const learner = createLearner({ subject: "French", grade: "10th grade" });
  setLessonPlan(learner, "Passé composé", ["Avoir verbs", "Être verbs"]);
  return learner;
}
const q = (over = {}) => ({ concept: "Être verbs", question: "Helper for aller?", options: ["avoir", "être", "faire"], answer: "b", why: "Movement verbs use être.", ...over });

test("practice test: keeps good questions and drops broken ones", () => {
  const raw = {
    questions: [
      q(),
      q({ question: "Helper for aller?" }), // duplicate
      q({ question: "Only two options", options: ["x", "y"] }),
      q({ question: "Answer out of range", answer: "d" }),
      q({ question: "Repeated options", options: ["a", "a", "b"] }),
      q({ question: "Unknown concept", concept: "Something else" }),
      q({ question: "Q3" }), q({ question: "Q4" }), q({ question: "Q5" }), q({ question: "Q6" }),
    ],
  };
  const clean = cleanQuestions(raw, plan());
  assert.equal(clean.length, TEST_LENGTH);
  assert.equal(clean[0].answer, 1);
  assert.ok(clean.every((c) => ["Avoir verbs", "Être verbs"].includes(c.concept)));
  assert.deepEqual(cleanQuestions(null, plan()), []);
});

test("practice test: builds with one model call and scores into progress", async () => {
  const learner = plan();
  let calls = 0;
  const llm = { json: async ({ maxTokens }) => (calls++, assert.ok(maxTokens >= 1000), { questions: [q(), q({ question: "Q2", concept: "Avoir verbs", answer: "a" })] }) };
  const questions = await buildPracticeTest(llm, learner);
  assert.equal(calls, 1);
  const result = scoreTest(learner, questions, [1, 2]);
  assert.equal(result.score, 1);
  assert.deepEqual(result.toReview, ["Avoir verbs"]);
  assert.equal(learner.concepts[1].correct, 1);
  assert.equal(learner.concepts[0].missesInRow, 1);
  assert.match(resultNote(result), /1 of 2 right\. Worth reviewing: Avoir verbs/);
});

test("recap: progress part works without the AI, AI part is added when available", async () => {
  const learner = plan();
  learner.concepts[0].level = 3;
  learner.concepts[1].level = 1;
  assert.deepEqual(progressPart(learner).mastered, ["Avoir verbs"]);

  const broken = { json: async () => { throw new Error("model hiccup"); } };
  const fallback = await buildRecap(broken, { learner, messages: [] });
  assert.deepEqual(fallback.learned, []);
  assert.match(recapText(fallback), /Mastered\n• Avoir verbs/);
  assert.match(recapText(fallback), /Practice next\n• Être verbs \(learning\)/);

  const good = { json: async () => ({ learned: ["Movement verbs use être"], practice_next: ["Agreement"], key_example: "je suis allé(e)" }) };
  const recap = await buildRecap(good, { learner, messages: [{ role: "user", content: "hi" }] });
  const text = recapText(recap);
  assert.match(text, /What I learned\n• Movement verbs use être/);
  assert.match(text, /Key example\nje suis allé\(e\)/);
  assert.match(text, /Practice next\n• Agreement/);
});
