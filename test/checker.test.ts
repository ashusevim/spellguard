import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeText, scanText, cleanWord } from "../checker.ts";

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

test("two occurrences on the same line report the line once", () => {
  const result = analyzeText("teh teh\nrecieve");
  assert.deepEqual(result.get("teh")?.lines, [1]);
  assert.deepEqual(result.get("recieve")?.lines, [2]);
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

test("spellcheck:disable-line skips the current line only", () => {
  const result = analyzeText("teh spellcheck:disable-line\nteh");
  assert.deepEqual(result.get("teh")?.lines, [2]);
});

test("spellcheck:disable-next-line skips the following line only", () => {
  const result = analyzeText("teh spellcheck:disable-next-line\nteh\nteh");
  assert.deepEqual(result.get("teh")?.lines, [3]);
});

test("spellcheck:off/on skips everything in between", () => {
  const result = analyzeText("teh\nspellcheck:off\nteh\nteh\nspellcheck:on\nteh");
  assert.deepEqual(result.get("teh")?.lines, [1, 6]);
});

test("directives are case-insensitive", () => {
  const result = analyzeText("teh // SpellCheck:Disable-Line\nteh");
  assert.deepEqual(result.get("teh")?.lines, [2]);
});

test("URLs, emails, and hex blobs are not checked", () => {
  const result = analyzeText(
    "visit https://example.com/teh and mail teh@example.com\nid 0xDEADBEEF hash deadbeefcafe1234 fine\nhello teh",
  );
  assert.deepEqual([...result.keys()], ["teh"]);
  assert.deepEqual(result.get("teh")?.lines, [3]);
});

test("long hex runs are stripped even in mixed case", () => {
  const result = analyzeText("DeadBeefCafe teh");
  assert.deepEqual([...result.keys()], ["teh"]);
});

test("extraWords suppresses flags, matched case-insensitively", () => {
  const result = analyzeText("Kubernetes kubernets", {
    extraWords: ["kubernetes", "kubernets"],
  });
  assert.equal(result.size, 0);
});

test("ignoreWords suppresses flags and is case-insensitive", () => {
  const result = analyzeText("Teh teh", { ignoreWords: ["teh"] });
  assert.equal(result.size, 0);
});

test("minLength skips short words", () => {
  const result = analyzeText("xy hello teh", { minLength: 3 });
  // "xy" skipped by length; "hello" is valid; "teh" still flagged.
  assert.deepEqual([...result.keys()], ["teh"]);
});

test("camelCase identifiers are split and sub-words are checked", () => {
  const result = analyzeText("getSubcribeName fine");
  assert.deepEqual([...result.keys()], ["Subcribe"]);
  assert.deepEqual(result.get("Subcribe")?.lines, [1]);
});

test("snake_case identifiers are split", () => {
  const result = analyzeText("my_varible = 1");
  assert.deepEqual([...result.keys()], ["varible"]);
});

test("valid compound tokens are not flagged via identifier splitting", () => {
  // whole token valid or all parts valid -> no flags
  assert.equal(analyzeText("well-known e-mail don't").size, 0);
});

test("markdown option skips fenced code and checks prose", () => {
  const md = "prose teh\n```\nteh in code\n```\nteh after";
  const result = analyzeText(md, { markdown: true });
  assert.deepEqual(result.get("teh")?.lines, [1, 5]);
});

test("scanText returns occurrences for --fix workflows", () => {
  const occurrences = scanText("teh wrod\nteh");
  assert.equal(occurrences.length, 3);
  assert.deepEqual(
    occurrences.map((o) => o.line),
    [1, 1, 2],
  );
  for (const o of occurrences) assert.ok(Array.isArray(o.suggestions));
});
