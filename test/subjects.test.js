import { test } from "node:test";
import assert from "node:assert/strict";
import { guideFor } from "../public/js/subjects.js";

test("picks the right teaching guide", () => {
  assert.match(guideFor("French", "verb conjugations"), /^French/);
  assert.match(guideFor("English grammar", "diagramming sentences"), /^English grammar/);
  assert.match(guideFor("", "observing cells under a microscope"), /^Biology/);
  assert.match(guideFor("Spanish", "ser vs estar"), /^Spanish/);
  assert.match(guideFor("Algebra", "solve for x"), /^Math/);
  assert.equal(guideFor("Underwater basket weaving", "I already tried"), "");
});
