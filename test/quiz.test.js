import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuiz, gradeBlank, gradeOrder, gradeMatch, shuffled } from "../public/js/quiz.js";

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
  assert.deepEqual(quiz, { kind: "choice", question: 'Which helper verb does "aller" use?', options: ["avoir", "être", "faire"], answer: 1, concept: "" });
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

test("fill in the blank: reads alternatives and grades kindly", () => {
  const { quiz } = parseQuiz("Try it:\n```blank\nquestion: Hier, je ___ allé au parc.\nanswer: suis | suis allé\n```");
  assert.deepEqual(quiz.answers, ["suis", "suis allé"]);
  assert.equal(gradeBlank(quiz, "  Suis. "), "correct");
  assert.equal(gradeBlank(quiz, "suis allé"), "correct");
  assert.equal(gradeBlank(quiz, "ai"), "incorrect");
  const accent = parseQuiz("```blank\nquestion: Elle est ___ hier.\nanswer: allée\n```").quiz;
  assert.equal(gradeBlank(accent, "allee"), "partial"); // right word, missing accent
  assert.equal(parseQuiz("```blank\nquestion: No blank here\nanswer: x\n```").quiz, null);
});

test("put in order: reads steps and grades position by position", () => {
  const { quiz } = parseQuiz("```order\nquestion: Solve 2x + 3 = 7\n1. Subtract 3 from both sides\n2. Divide both sides by 2\n3. Check by plugging in\n```");
  assert.deepEqual(quiz.items, ["Subtract 3 from both sides", "Divide both sides by 2", "Check by plugging in"]);
  assert.equal(gradeOrder(quiz, [0, 1, 2]), "correct");
  assert.equal(gradeOrder(quiz, [0, 2, 1]), "incorrect");
  const four = { items: ["a", "b", "c", "d"] };
  assert.equal(gradeOrder(four, [0, 1, 3, 2]), "partial");
});

test("matching: reads pairs in several styles and grades", () => {
  const { quiz } = parseQuiz("```match\nquestion: Match the words\nchien = dog\nchat → cat\n- oiseau: bird\n```");
  assert.deepEqual(quiz.pairs.map((p) => p.right), ["dog", "cat", "bird"]);
  assert.equal(gradeMatch(quiz, [0, 1, 2]), "correct");
  assert.equal(gradeMatch(quiz, [0, 2, 1]), "incorrect");
  // a block labeled quiz that is really a matching list
  assert.equal(parseQuiz("```quiz\nMatch them\nun = one\ndeux = two\n```").quiz.kind, "match");
});

test("shuffling never leaves an order question already solved", () => {
  let seed = 0;
  const notRandom = () => 0.999 - (seed++ % 2) * 0.998;
  for (let n = 2; n < 7; n++) assert.ok(shuffled(n, notRandom).some((v, i) => v !== i));
  assert.ok(shuffled(3, () => 0.99).some((v, i) => v !== i)); // even a "random" that never shuffles
});
