import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeText, cleanWord } from "../checker.ts";

test("cleanWord strips punctuation but keeps apostrophes", () => {
  assert.equal(cleanWord('"hello,"'), "hello");
  assert.equal(cleanWord("don't!"), "don't");
  assert.equal(cleanWord("..."), "");
});

test("correct words are not reported", () => {
  const result = analyzeText("everything is fine");
  assert.equal(result.size, 0);
});

test("misspelled words are reported with line numbers and capped suggestions", () => {
  const result = analyzeText("everything is gooattty");
  assert.equal(result.size, 1);

  const entry = result.get("gooattty");
  assert.ok(entry, "expected 'gooattty' to be flagged");
  assert.deepEqual(entry.lines, [1]);
  assert.ok(entry.suggestions.length <= 3);
});

test("typo-like misspellings get non-empty suggestions", () => {
  const result = analyzeText("teh recieve");
  const teh = result.get("teh");
  const recieve = result.get("recieve");
  assert.ok(teh && teh.suggestions.length > 0, "expected suggestions for 'teh'");
  assert.ok(recieve && recieve.suggestions.includes("receive"), "expected 'receive' for 'recieve'");
});

test("repeated misspellings consolidate line numbers", () => {
  const result = analyzeText("recieve\nok\nrecieve");
  const entry = result.get("recieve");
  assert.ok(entry, "expected 'recieve' to be flagged");
  assert.deepEqual(entry.lines, [1, 3]);
});

test("apostrophe words are checked as-is, not stripped", () => {
  // "dont" is a misspelling; "don't" is not.
  const result = analyzeText("dont\ndon't");
  assert.ok(result.has("dont"), "'dont' should be flagged");
  assert.ok(!result.has("don't"), "'don't' should not be flagged");
});

test("pure numbers are skipped", () => {
  const result = analyzeText("123 456 hello 789");
  assert.equal(result.size, 0);
});

test("suggestions are capped at 3", () => {
  const result = analyzeText("teh");
  const entry = result.get("teh");
  assert.ok(entry, "expected 'teh' to be flagged");
  assert.ok(entry.suggestions.length <= 3);
});
