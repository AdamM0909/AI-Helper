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
