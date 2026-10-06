import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createLLM, createThinkFilter, LLMError } from "../src/llm.js";

// A tiny fake of an OpenAI-compatible server like Ollama.
let server;
let baseUrl;
let lastBody;
let mode = "ok";

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url === "/v1/models") {
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ data: [{ id: "qwen2.5:7b" }] }));
      }
      lastBody = JSON.parse(raw);
      if (mode === "missing") {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: { message: 'model "nope" not found, try pulling it first' } }));
      }
      if (lastBody.stream) {
        res.setHeader("Content-Type", "text/event-stream");
        const parts = ["Hel", "lo <thi", "nk>secret</think> the", "re!"];
        for (const p of parts) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      res.setHeader("Content-Type", "application/json");
      const content = mode === "junk" ? "sorry I can't" : 'Sure! {"answered_check": true}';
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://localhost:${server.address().port}/v1`;
});

after(() => server.close());

test("streams text and hides <think> blocks", async () => {
  mode = "ok";
  const llm = createLLM({ baseUrl, model: "qwen2.5:7b" });
  const pieces = [];
  const full = await llm.chat({ messages: [{ role: "user", content: "hi" }], onText: (t) => pieces.push(t) });
  assert.equal(full, "Hello  there!");
  assert.equal(pieces.join(""), full);
  assert.equal(lastBody.model, "qwen2.5:7b");
});

test("json() sends a schema and pulls the JSON out of the reply", async () => {
  mode = "ok";
  const llm = createLLM({ baseUrl, model: "qwen2.5:7b" });
  const result = await llm.json({ messages: [], schema: { type: "object" } });
  assert.deepEqual(result, { answered_check: true });
  assert.equal(lastBody.response_format.type, "json_schema");
});

test("json() returns null for unusable output instead of crashing", async () => {
  mode = "junk";
  const llm = createLLM({ baseUrl, model: "qwen2.5:7b" });
  assert.equal(await llm.json({ messages: [], schema: {} }), null);
});

test("explains a missing model and an unreachable server", async () => {
  mode = "missing";
  await assert.rejects(createLLM({ baseUrl, model: "nope" }).chat({ messages: [] }), (e) => e instanceof LLMError && e.kind === "model_missing");
  await assert.rejects(createLLM({ baseUrl: "http://localhost:1/v1", model: "x" }).chat({ messages: [] }), (e) => e.kind === "unreachable");
});

test("startup check notices a model that isn't downloaded", async () => {
  assert.deepEqual(await createLLM({ baseUrl, model: "qwen2.5:7b" }).checkReady(), { ok: true });
  assert.deepEqual(await createLLM({ baseUrl, model: "llama3.1:8b" }).checkReady(), { ok: false, reason: "model_missing" });
  assert.deepEqual(await createLLM({ baseUrl: "http://localhost:1/v1", model: "x" }).checkReady(), { ok: false, reason: "unreachable" });
});

test("think filter handles tags split at every position", () => {
  const text = "A<think>hidden</think>B<think>x</think>C";
  for (let size = 1; size <= text.length; size++) {
    const push = createThinkFilter();
    let out = "";
    for (let i = 0; i < text.length; i += size) out += push(text.slice(i, i + size));
    assert.equal(out, "ABC", `chunk size ${size}`);
  }
});
