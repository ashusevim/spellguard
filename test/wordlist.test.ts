import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendWords, loadWordlist, loadCorrections, appendCorrections } from "../wordlist.ts";

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

test("loadCorrections parses typo=fix pairs, skips comments and junk", () => {
  const file = tmpFile("# learned\nteh=the\nwrod = word\nbroken\n=nofix\nnofix=\n");
  const corrections = loadCorrections(file);
  assert.deepEqual(
    [...corrections.entries()].sort(),
    [
      ["teh", "the"],
      ["wrod", "word"],
    ],
  );
});

test("loadCorrections returns empty for missing files", () => {
  assert.equal(loadCorrections("/nonexistent/corrections.txt").size, 0);
});

test("appendCorrections dedupes case-insensitively", () => {
  const file = tmpFile("teh=the\n");
  const added = appendCorrections(file, [
    ["TEH", "the"],
    ["wrod", "word"],
  ]);
  assert.equal(added, 1);
  const corrections = loadCorrections(file);
  assert.equal(corrections.get("teh"), "the");
  assert.equal(corrections.get("wrod"), "word");
});
