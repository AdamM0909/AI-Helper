import { test } from "node:test";
import assert from "node:assert/strict";
import { createThinkFilter } from "../public/js/think.js";

test("think filter hides <think> blocks even when tags are split at every position", () => {
  const text = "A<think>hidden</think>B<think>x</think>C <b>bold</b>";
  for (let size = 1; size <= text.length; size++) {
    const push = createThinkFilter();
    let out = "";
    for (let i = 0; i < text.length; i += size) out += push(text.slice(i, i + size));
    assert.equal(out, "ABC <b>bold</b>", `chunk size ${size}`);
  }
});

test("only foreign-language phrases get a pronunciation button", async () => {
  const { looksForeign } = await import("../public/js/speech.js");
  assert.equal(looksForeign("je suis allée", "fr-FR"), true);
  assert.equal(looksForeign("être", "fr-FR"), true);
  assert.equal(looksForeign("Avoir verbs", "fr-FR"), false);
  assert.equal(looksForeign("we went", "fr-FR"), false);
  assert.equal(looksForeign("Warm-up review", "fr-FR"), false);
  assert.equal(looksForeign("yo soy", "es-ES"), true);
  assert.equal(looksForeign("the verb", "es-ES"), false);
});

test("English words that are also French or Spanish words don't count", async () => {
  const { looksForeign } = await import("../public/js/speech.js");
  assert.equal(looksForeign("as soon as", "fr-FR"), false);
  assert.equal(looksForeign("on time", "fr-FR"), false);
  assert.equal(looksForeign("no way", "es-ES"), false);
});
