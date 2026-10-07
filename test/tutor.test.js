import { test } from "node:test";
import assert from "node:assert/strict";
import { createLearner, setLessonPlan } from "../public/js/learner.js";
import { tutorTurn, detectSituation, revealsAnswer, recentHistory, soundsHarsh } from "../public/js/tutor.js";

// Stands in for the in-browser AI: returns scripted grades and replies, records prompts.
function fakeLLM({ grades = [], replies = [] }) {
  const calls = { json: [], chat: [] };
  return {
    calls,
    async json({ messages }) {
      calls.json.push(messages);
      const next = grades.shift();
      if (next instanceof Error) throw next;
      return next ?? null;
    },
    async chat({ messages, onText }) {
      calls.chat.push(messages);
      const text = replies.shift() ?? "ok";
      for (const word of text.split(/(?= )/)) onText(word);
      return text;
    },
  };
}

const noCheck = { tutor_question: "", correct_answer: "", answered_check: false, concept: "", result: "none", hints_used: 0, update_plan: false, topic: "", concepts: [] };

test("first message: builds a lesson plan, adds the subject guide, streams the reply", async () => {
  const llm = fakeLLM({
    grades: [{ ...noCheck, update_plan: true, topic: "Passé composé", concepts: ["Avoir verbs", "Être verbs"] }],
    replies: ["What do you already know about avoir?"],
  });
  const session = { learner: createLearner({ subject: "French", goal: "passé composé" }), messages: [] };
  const events = [];

  await tutorTurn(llm, session, "I don't get passé composé", (e) => events.push(e));

  assert.deepEqual(session.learner.concepts.map((c) => c.name), ["Avoir verbs", "Être verbs"]);
  assert.equal(events.filter((e) => e.type === "text").map((e) => e.text).join(""), "What do you already know about avoir?");
  const system = llm.calls.chat[0][0].content;
  assert.match(system, /DR MRS VANDERTRAMP/); // French teaching notes included
  assert.match(system, /Avoir verbs/); // lesson plan included
  assert.deepEqual(session.messages.map((m) => m.role), ["user", "assistant"]);
});

test("a wrong answer: progress drops, pacing and the hidden answer reach the tutor", async () => {
  const wrong = { ...noCheck, answered_check: true, concept: "Être verbs", result: "incorrect", correct_answer: "je suis allé" };
  const llm = fakeLLM({ grades: [wrong, wrong] });
  const session = { learner: createLearner(), messages: [] };
  setLessonPlan(session.learner, "Passé composé", ["Être verbs"]);

  await tutorTurn(llm, session, "j'ai allé", () => {});
  await tutorTurn(llm, session, "j'ai allé?", () => {});

  assert.equal(session.learner.concepts[0].attempts, 2);
  const system = llm.calls.chat[1][0].content;
  assert.match(system, /not quite right yet/);
  assert.match(system, /SLOW DOWN/);
  assert.match(system, /DO NOT reveal it: the correct answer is "je suis allé"/);
});

test("if the reply gives the answer away, it's thrown out and rewritten", async () => {
  const llm = fakeLLM({
    grades: [{ ...noCheck, answered_check: true, concept: "Être verbs", result: "incorrect", correct_answer: "je suis allé" }],
    replies: ["Close! It's **Je suis allé**.", "Close! Which helper verb does aller use?"],
  });
  const session = { learner: createLearner(), messages: [] };
  const events = [];

  await tutorTurn(llm, session, "j'ai allé", (e) => events.push(e));

  assert.ok(events.some((e) => e.type === "reset"));
  assert.match(llm.calls.chat[1][0].content, /Do not write "je suis allé"/);
  assert.equal(session.messages.at(-1).content, "Close! Which helper verb does aller use?");
});

test("a correct answer doesn't trigger the leak check", async () => {
  const llm = fakeLLM({
    grades: [{ ...noCheck, answered_check: true, concept: "Être verbs", result: "correct", correct_answer: "je suis allé" }],
    replies: ["Yes! Je suis allé is right."],
  });
  const events = [];
  await tutorTurn(llm, { learner: createLearner(), messages: [] }, "je suis allé", (e) => events.push(e));
  assert.ok(!events.some((e) => e.type === "reset"));
  assert.equal(llm.calls.chat.length, 1);
});

test("begging for answers and pasted homework add instructions for that turn", async () => {
  const llm = fakeLLM({});
  await tutorTurn(llm, { learner: createLearner(), messages: [] }, "just tell me the answer\n1. Solve 2x+3=7\n2. Solve x-4=10", () => {});
  const system = llm.calls.chat[0][0].content;
  assert.match(system, /asking for the answer/);
  assert.match(system, /pasted assignment questions/);
});

test("situation detection", () => {
  assert.equal(detectSituation("what is the answer").length, 1);
  assert.match(detectSituation("ugh I give up, I'm so dumb")[0], /frustrated/);
  assert.match(detectSituation("Question 3: what is a gerund?")[0], /assignment/);
  assert.deepEqual(detectSituation("I think the subject is dog"), []);
  assert.deepEqual(detectSituation("Can you give me a harder one?"), []);
});

test("leak check ignores very short answers and formatting", () => {
  assert.equal(revealsAnswer("It's **Je   suis allé**!", "je suis allé"), true);
  assert.equal(revealsAnswer("Try 5 more times", "5"), false);
  assert.equal(revealsAnswer("Which helper verb?", "je suis allé"), false);
});

test("history keeps the newest messages that fit the model's memory", () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `${i}`.padEnd(500, ".") }));
  const kept = recentHistory(messages, 2600);
  assert.equal(kept.length, 5);
  assert.equal(kept.at(-1), messages.at(-1));
  assert.equal(recentHistory([{ role: "user", content: "x".repeat(9000) }], 2600).length, 1); // newest always kept
});

test("if grading fails or returns junk, the student still gets a reply", async () => {
  const llm = fakeLLM({ grades: [new Error("model confused"), { nonsense: true }], replies: ["one", "two"] });
  const session = { learner: createLearner(), messages: [] };
  await tutorTurn(llm, session, "hi", () => {});
  await tutorTurn(llm, session, "hello", () => {});
  assert.deepEqual(session.messages.map((m) => m.content), ["hi", "one", "hello", "two"]);
});

test("harsh replies are rewritten in a gentler voice", async () => {
  const llm = fakeLLM({ replies: ["That's wrong. Obviously the verb is first.", "Not quite yet! Let's look at the verb together."] });
  const session = { learner: createLearner(), messages: [] };
  const events = [];
  await tutorTurn(llm, session, "is it the noun?", (e) => events.push(e));
  assert.ok(events.some((e) => e.type === "reset"));
  assert.match(llm.calls.chat[1][0].content, /sounded harsh/);
  assert.equal(session.messages.at(-1).content, "Not quite yet! Let's look at the verb together.");
});

test("harshness check", () => {
  assert.equal(soundsHarsh("No. Try again."), true);
  assert.equal(soundsHarsh("That's incorrect, the answer is different."), true);
  assert.equal(soundsHarsh("This is simply the subject."), true);
  assert.equal(soundsHarsh("Not quite yet, but you're close!"), false);
  assert.equal(soundsHarsh("Nobody gets this right away. Know what? You're close."), false);
  assert.equal(soundsHarsh("The word 'wrong' is an adjective here."), false);
});

test("the tutor's instructions are nurturing", async () => {
  const llm = fakeLLM({});
  await tutorTurn(llm, { learner: createLearner(), messages: [] }, "hi", () => {});
  assert.match(llm.calls.chat[0][0].content, /Praise effort/);
});

const mc = { kind: "choice", question: 'Which helper verb does "aller" use?', concept: "Être verbs" };
const picked = (given, result, wrongTries = 0) => ({ ...mc, given, result, correct: '"être"', wrongTries });

test("the tutor is taught every interactive question type", async () => {
  const llm = fakeLLM({});
  await tutorTurn(llm, { learner: createLearner(), messages: [] }, "hi", () => {});
  const system = llm.calls.chat[0][0].content;
  for (const kind of ["quiz", "blank", "order", "match"]) assert.match(system, new RegExp("```" + kind + "\\n"));
});

test("a right answer is graded in code, without asking the model to grade", async () => {
  const llm = fakeLLM({ replies: ["Yes! Être it is."] });
  const session = { learner: createLearner(), messages: [] };
  setLessonPlan(session.learner, "Passé composé", ["Avoir verbs", "Être verbs"]);
  const events = [];
  await tutorTurn(llm, session, "I chose B) être", (e) => events.push(e), { answer: picked('B) "être"', "correct") });
  assert.equal(llm.calls.json.length, 0); // no grading call
  assert.equal(session.learner.concepts[1].correct, 1);
  assert.ok(events.some((e) => e.type === "progress"));
  assert.match(llm.calls.chat[0][0].content, /That's right!/);
});

test("a wrong answer gets a hint, keeps the answer hidden, and the leak check guards it", async () => {
  const llm = fakeLLM({ replies: ["Close! The answer is être.", "Close! Think about verbs of movement. Want to try again?"] });
  const session = { learner: createLearner(), messages: [] };
  const events = [];
  await tutorTurn(llm, session, "I chose A) avoir", (e) => events.push(e), { answer: picked('A) "avoir"', "incorrect") });
  const system = llm.calls.chat[0][0].content;
  assert.match(system, /DO NOT reveal it: the right answer is "être"/);
  assert.match(system, /Don't ask a new question yet/);
  assert.ok(events.some((e) => e.type === "reset")); // first draft named the answer
  assert.equal(session.messages.at(-1).content, "Close! Think about verbs of movement. Want to try again?");
});

test("right after wrong tries counts as needing help, not mastery progress", async () => {
  const llm = fakeLLM({});
  const session = { learner: createLearner(), messages: [] };
  await tutorTurn(llm, session, "I chose B) être", () => {}, { answer: picked('B) "être"', "correct", 2) });
  assert.equal(session.learner.concepts[0].correct, 1);
  assert.equal(session.learner.concepts[0].level, 1);
});

test("a fill-in-the-blank with missing accents is 'partly right' and points at the accents", async () => {
  const llm = fakeLLM({});
  const session = { learner: createLearner(), messages: [] };
  await tutorTurn(llm, session, "My answer: allee", () => {}, {
    answer: { kind: "blank", question: "Elle est ___ hier.", given: '"allee"', correct: '"allée"', result: "partial", wrongTries: 0 },
  });
  assert.match(llm.calls.chat[0][0].content, /accents/);
  assert.equal(session.learner.concepts[0].missesInRow, 0); // partial isn't a miss
});

test("order and match answers skip the leak check (their answers are lists)", async () => {
  const llm = fakeLLM({ replies: ["Subtract 3 from both sides comes first, right?"] });
  const events = [];
  await tutorTurn(llm, { learner: createLearner(), messages: [] }, "My order: ...", (e) => events.push(e), {
    answer: { kind: "order", question: "Solve it", given: "2, 1", correct: "1. Subtract 3 from both sides 2. Divide by 2", result: "incorrect", wrongTries: 0 },
  });
  assert.ok(!events.some((e) => e.type === "reset"));
});

test("extra guidance (like a warm-up review) reaches the tutor", async () => {
  const llm = fakeLLM({});
  await tutorTurn(llm, { learner: createLearner(), messages: [] }, "warm up please", () => {}, { extra: ["Warm-up review: Être verbs"] });
  assert.match(llm.calls.chat[0][0].content, /Warm-up review: Être verbs/);
});

test("options inside a new quiz don't trip the leak check", async () => {
  const reply = "Let's try one more.\n\n```quiz\nquestion: Pick the helper for aller\na) avoir\nb) être\nanswer: b\n```";
  const llm = fakeLLM({ replies: [reply] });
  const events = [];
  await tutorTurn(llm, { learner: createLearner(), messages: [] }, "I chose A) avoir", (e) => events.push(e), { answer: picked('A) "avoir"', "incorrect") });
  assert.ok(!events.some((e) => e.type === "reset"));
});
