import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendWords, loadWordlist } from "../wordlist.ts";

function tmpFile(content = ""): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spelldict-"));
  const file = path.join(dir, "words.txt");
  if (content) fs.writeFileSync(file, content);
  return file;
}

test("loadWordlist reads words, skips comments and blanks", () => {
  const file = tmpFile("alpha\n# a comment\n\nbeta  # trailing comment\n");
  assert.deepEqual(loadWordlist(file), ["alpha", "beta"]);
});

test("loadWordlist returns empty for missing files", () => {
  assert.deepEqual(loadWordlist("/nonexistent/path/words.txt"), []);
});

test("appendWords creates a file and adds words", () => {
  const file = tmpFile();
  const added = appendWords(file, ["alpha", "beta"]);
  assert.equal(added, 2);
  assert.deepEqual(loadWordlist(file), ["alpha", "beta"]);
});

test("appendWords skips duplicates case-insensitively", () => {
  const file = tmpFile("Alpha\n");
  const added = appendWords(file, ["ALPHA", "beta", "alpha"]);
  assert.equal(added, 1);
  assert.deepEqual(loadWordlist(file), ["Alpha", "beta"]);
});

test("appendWords with no new words writes nothing", () => {
  const file = tmpFile("alpha\n");
  const added = appendWords(file, ["ALPHA"]);
  assert.equal(added, 0);
  assert.deepEqual(loadWordlist(file), ["alpha"]);
});
