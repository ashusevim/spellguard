import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "index.ts");

function run(extraArgs: string[]) {
  return spawnSync(process.execPath, [cli, ...extraArgs], { encoding: "utf8", cwd: root });
}

test("CLI reports misspellings and exits 1", () => {
  const result = run([path.join(root, "test.txt")]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /'gooattty' is misspelled on line\(s\): 1/);
});

test("CLI prints suggestions when available", () => {
  const result = run([path.join(root, "test", "fixtures", "suggestions.txt")]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /'teh' is misspelled on line\(s\): 1\. Suggestions: .+/);
  assert.match(result.stdout, /'recieve' is misspelled on line\(s\): 1\. Suggestions: .+receive/);
});

test("CLI exits 0 with no misspellings", () => {
  const result = run([path.join(root, "test", "fixtures", "clean.txt")]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No errors, everything is good/);
});

test("CLI --json emits structured output with exit code 1", () => {
  const result = run(["--json", path.join(root, "test.txt")]);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout) as {
    misspellings: { word: string; lines: number[]; suggestions: string[] }[];
  };
  assert.equal(parsed.misspellings.length, 1);
  assert.equal(parsed.misspellings[0].word, "gooattty");
  assert.deepEqual(parsed.misspellings[0].lines, [1]);
});

test("CLI exits 2 on missing argument", () => {
  const result = run([]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});

test("CLI exits 2 on unreadable file", () => {
  const result = run([path.join(root, "does-not-exist.txt")]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Error reading/);
});
