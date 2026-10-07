import { test } from "node:test";
import assert from "node:assert/strict";
import { createTopics, MAX_TOPICS } from "../public/js/topics.js";

function memoryStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: (k) => (k in data ? structuredClone(data[k]) : null),
    set: (k, v) => (data[k] = structuredClone(v)),
    remove: (k) => delete data[k],
  };
}

const learner = (subject) => ({ profile: { subject }, topic: "", concepts: [] });

test("keeps several topics and switches between them", () => {
  let t = 1000;
  const topics = createTopics(memoryStore(), () => t++);
  const french = topics.add(learner("French"));
  const algebra = topics.add(learner("Algebra"));
  assert.equal(topics.active().id, algebra.id);
  topics.activate(french.id);
  assert.equal(topics.active().learner.profile.subject, "French");
  topics.save(french);
  assert.equal(topics.list()[0].id, french.id); // most recently used first
});

test("survives a reload", () => {
  const store = memoryStore();
  const first = createTopics(store);
  const topic = first.add(learner("French"));
  topic.messages.push({ role: "user", content: "hi" });
  first.save(topic);
  const again = createTopics(store);
  assert.equal(again.active().messages[0].content, "hi");
});

test("carries over the single chat saved by earlier versions", () => {
  const store = memoryStore({ sageSession: { learner: learner("Spanish"), messages: [{ role: "user", content: "hola" }] } });
  const topics = createTopics(store);
  assert.equal(topics.active().learner.profile.subject, "Spanish");
  assert.equal(topics.active().messages[0].content, "hola");
  assert.equal(store.data.sageSession, undefined);
});

test("has a limit, and removing or clearing works", () => {
  const topics = createTopics(memoryStore());
  for (let i = 0; i < MAX_TOPICS; i++) topics.add(learner(`S${i}`));
  assert.equal(topics.isFull(), true);
  assert.throws(() => topics.add(learner("one too many")));
  topics.remove(topics.active().id);
  assert.equal(topics.active(), null);
  assert.equal(topics.list().length, MAX_TOPICS - 1);
  topics.clearAll();
  assert.equal(topics.list().length, 0);
});
