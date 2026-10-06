import { test } from "node:test";
import assert from "node:assert/strict";
import { createLearner } from "../src/learner.js";
import { tutorTurn } from "../src/tutor.js";

// Stands in for the Anthropic client: replays scripted responses and records requests.
function fakeClient(responses) {
  const requests = [];
  return {
    requests,
    beta: {
      messages: {
        stream(params) {
          requests.push(structuredClone(params));
          const message = responses.shift();
          const listeners = [];
          return {
            on(event, fn) {
              if (event === "text") listeners.push(fn);
              return this;
            },
            async finalMessage() {
              for (const b of message.content) if (b.type === "text") listeners.forEach((fn) => fn(b.text));
              return message;
            },
          };
        },
      },
    },
  };
}

test("runs tool calls, reports progress, then streams the reply", async () => {
  const client = fakeClient([
    {
      stop_reason: "tool_use",
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "tool_use", id: "t1", name: "set_lesson_plan", input: { topic: "Diagramming", concepts: ["Subject and verb"] } },
        { type: "tool_use", id: "t2", name: "record_check", input: { concept: "Subject and verb", result: "correct", hints_used: 0 } },
      ],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Nice work! Try this one:" }] },
  ]);
  const session = { learner: createLearner(), messages: [] };
  const events = [];

  await tutorTurn(client, session, "The dog barked. Subject is dog.", (e) => events.push(e));

  assert.deepEqual(events.filter((e) => e.type === "text").map((e) => e.text), ["Nice work! Try this one:"]);
  assert.equal(events.filter((e) => e.type === "progress").length, 2);
  assert.equal(session.learner.concepts[0].correct, 1);

  // Both tool results go back together in one user message, and the
  // assistant turn (thinking included) is echoed back unchanged.
  const second = client.requests[1].messages;
  assert.equal(second[1].content[0].type, "thinking");
  assert.deepEqual(second[2].content.map((b) => b.tool_use_id), ["t1", "t2"]);
  assert.match(second[2].content[1].content, /pacing/);
});

test("bad tool input comes back as an error instead of changing progress", async () => {
  const client = fakeClient([
    {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t1", name: "record_check", input: { concept: "Verbs", result: "great" } }],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] },
  ]);
  const session = { learner: createLearner(), messages: [] };

  await tutorTurn(client, session, "hi", () => {});

  const result = session.messages[2].content[0];
  assert.equal(result.is_error, true);
  assert.equal(session.learner.concepts.length, 0);
});

test("blocks from before a fallback are not echoed back", async () => {
  const client = fakeClient([
    {
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "", signature: "a" },
        { type: "text", text: "Let's " },
        { type: "fallback", from: { model: "x" }, to: { model: "y" } },
        { type: "thinking", thinking: "", signature: "b" },
        { type: "text", text: "start." },
      ],
    },
  ]);
  const session = { learner: createLearner(), messages: [] };

  await tutorTurn(client, session, "hi", () => {});

  assert.deepEqual(session.messages[1].content.map((b) => b.signature ?? b.type), ["text", "fallback", "b", "text"]);
});
