import { test } from "node:test";
import assert from "node:assert/strict";
import { createLearner, setLessonPlan } from "../src/learner.js";
import { tutorTurn } from "../src/tutor.js";

// Stands in for the local AI: returns scripted grades and replies, records prompts.
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

const noCheck = { answered_check: false, concept: "", result: "none", hints_used: 0, update_plan: false, topic: "", concepts: [] };

test("first message: builds a lesson plan and streams the reply", async () => {
  const llm = fakeLLM({
    grades: [{ ...noCheck, update_plan: true, topic: "Diagramming", concepts: ["Subject and verb", "Modifiers"] }],
    replies: ["Let's start. What's the verb in 'Dogs bark'?"],
  });
  const session = { learner: createLearner({ subject: "English" }), messages: [] };
  const events = [];

  await tutorTurn(llm, session, "I don't get diagramming", (e) => events.push(e));

  assert.deepEqual(session.learner.concepts.map((c) => c.name), ["Subject and verb", "Modifiers"]);
  assert.equal(events.filter((e) => e.type === "text").map((e) => e.text).join(""), "Let's start. What's the verb in 'Dogs bark'?");
  assert.ok(events.some((e) => e.type === "progress"));
  assert.match(llm.calls.chat[0][0].content, /Subject and verb/); // plan goes into the tutor's instructions
  assert.deepEqual(session.messages.map((m) => m.role), ["user", "assistant"]);
});

test("a graded answer updates progress and puts pacing advice in the prompt", async () => {
  const llm = fakeLLM({
    grades: [
      { ...noCheck, answered_check: true, concept: "Subject and verb", result: "incorrect" },
      { ...noCheck, answered_check: true, concept: "Subject and verb", result: "incorrect" },
    ],
  });
  const session = { learner: createLearner(), messages: [] };
  setLessonPlan(session.learner, "Diagramming", ["Subject and verb"]);

  await tutorTurn(llm, session, "dogs?", () => {});
  await tutorTurn(llm, session, "bark is the subject", () => {});

  assert.equal(session.learner.concepts[0].attempts, 2);
  assert.match(llm.calls.chat[1][0].content, /SLOW DOWN/);
});

test("if grading fails or returns junk, the student still gets a reply", async () => {
  const llm = fakeLLM({ grades: [new Error("model confused"), { nonsense: true }], replies: ["one", "two"] });
  const session = { learner: createLearner(), messages: [] };

  await tutorTurn(llm, session, "hi", () => {});
  await tutorTurn(llm, session, "hello", () => {});

  assert.deepEqual(session.messages.map((m) => m.content), ["hi", "one", "hello", "two"]);
  assert.equal(session.learner.concepts.length, 0);
});

test("only recent history is sent, to fit small models", async () => {
  const llm = fakeLLM({});
  const session = { learner: createLearner(), messages: [] };
  for (let i = 0; i < 30; i++) session.messages.push({ role: i % 2 ? "assistant" : "user", content: `m${i}` });

  await tutorTurn(llm, session, "latest", () => {});

  const sent = llm.calls.chat[0];
  assert.equal(sent.length, 17); // system prompt + 16 messages
  assert.equal(sent.at(-1).content, "latest");
  assert.ok(llm.calls.json[0].at(-1).content.includes("STUDENT: latest"));
});
