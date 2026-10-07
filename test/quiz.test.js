import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuiz } from "../public/js/quiz.js";

const reply = `Nice thinking! Let's check one thing.

\`\`\`quiz
question: Which helper verb does "aller" use?
a) avoir
b) être
c) faire
answer: b
\`\`\``;

test("reads a quiz block and removes it from the visible text", () => {
  const { text, quiz } = parseQuiz(reply);
  assert.equal(text, "Nice thinking! Let's check one thing.");
  assert.deepEqual(quiz, { question: 'Which helper verb does "aller" use?', options: ["avoir", "être", "faire"], answer: 1, concept: "" });
});

test("tolerates the small variations models produce", () => {
  const messy = "Try this:\n```Quiz\nWhat is the subject of 'Dogs bark'?\nA. Dogs\nB. bark\n- c) neither\nCorrect answer: (a)\nconcept: Subject and verb\n```\nYou've got this!";
  const { text, quiz } = parseQuiz(messy);
  assert.equal(text, "Try this:\n\nYou've got this!");
  assert.equal(quiz.question, "What is the subject of 'Dogs bark'?");
  assert.deepEqual(quiz.options, ["Dogs", "bark", "neither"]);
  assert.equal(quiz.answer, 0);
  assert.equal(quiz.concept, "Subject and verb");
});

test("hides an unfinished block while the reply is still streaming", () => {
  const partial = "Good job!\n\n```quiz\nquestion: Which one\na) av";
  assert.deepEqual(parseQuiz(partial), { text: "Good job!", quiz: null, pending: true });
});

test("a broken block is shown as text but never reveals the answer", () => {
  const broken = "Hmm:\n```quiz\nquestion: Pick one\na) yes\nanswer: c\n```";
  const { text, quiz } = parseQuiz(broken);
  assert.equal(quiz, null);
  assert.match(text, /Pick one/);
  assert.doesNotMatch(text, /answer/i);
});

test("replies without a quiz pass through untouched", () => {
  assert.deepEqual(parseQuiz("What do you think the verb is?"), { text: "What do you think the verb is?", quiz: null });
});
