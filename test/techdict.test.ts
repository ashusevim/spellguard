import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeText } from "../checker.ts";
import { TECH_WORDS } from "../techdict.ts";

test("supplement dictionary covers common hunspell en_US gaps", () => {
  // Every one of these was a false positive in real usage.
  const result = analyzeText("config msg auth roadmap transpiler retarget UTF\n");
  assert.deepEqual([...result.keys()], [], `unexpected flags: ${[...result.keys()].join(", ")}`);
});

test("supplement words are matched case-insensitively", () => {
  const result = analyzeText("Config MSG Roadmap\n");
  assert.equal(result.size, 0);
});

test("dot-segmented tokens are valid when every segment is a valid word", () => {
  const result = analyzeText("Node.js package.json README.md okay\n");
  assert.deepEqual([...result.keys()], [], `unexpected flags: ${[...result.keys()].join(", ")}`);
});

test("dot-segmented tokens still flag invalid segments", () => {
  const result = analyzeText("teh.js is wrong\nNode.js is fine\n");
  assert.deepEqual([...result.keys()], ["teh"]);
  assert.deepEqual(result.get("teh")?.lines, [1]);
});
test("techdict words still work through identifier splitting", () => {
  // "loadConfigs" -> "load" + "Configs" -> both valid via dictionary/supplement
  assert.equal(analyzeText("loadConfigs").size, 0);
});

test("supplement set is lowercase-only", () => {
  for (const word of TECH_WORDS) {
    assert.equal(word, word.toLowerCase(), `non-lowercase entry: ${word}`);
  }
});
