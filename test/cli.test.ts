import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "index.ts");

function run(extraArgs: string[], input?: string) {
  // --no-repo-vocab keeps fixture expectations stable: this repo's own test
  // files contain "teh"/"wrod" 3+ times, so default harvesting would bless them.
  return spawnSync(process.execPath, [cli, "--no-repo-vocab", ...extraArgs], {
    encoding: "utf8",
    cwd: root,
    input: input ?? "",
  });
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "spellcli-"));
}

test("CLI reports misspellings with file prefix and exits 1", () => {
  const result = run([path.join(root, "test.txt")]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /test\.txt: 'gooattty' misspelled on line\(s\): 1\./);
});

test("CLI prints suggestions when available", () => {
  const result = run([path.join(root, "test", "fixtures", "suggestions.txt")]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /'teh' misspelled on line\(s\): 1\. Suggestions: .+/);
  // "receive" must be the top suggestion for "recieve"
  assert.match(result.stdout, /'recieve' misspelled on line\(s\): 1\. Suggestions: receive,/);
});

test("CLI honors inline directives end to end", () => {
  const result = run([path.join(root, "test", "fixtures", "directives.txt")]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /'teh' misspelled on line\(s\): 1, 3, 9\./);
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
    file: string;
    count: number;
    misspellings: { word: string; lines: number[]; suggestions: string[] }[];
  };
  assert.equal(parsed.count, 1);
  assert.equal(parsed.file, path.join(root, "test.txt"));
  assert.equal(parsed.misspellings[0].word, "gooattty");
  assert.deepEqual(parsed.misspellings[0].lines, [1]);
});

test("CLI reads from stdin via dash", () => {
  const result = run(["-"], "teh wrod\n");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /<stdin>: 'teh' misspelled/);
  assert.match(result.stdout, /<stdin>: 'wrod' misspelled/);
});

test("CLI reads piped input with no file argument", () => {
  const result = run([], "teh\n");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /<stdin>: 'teh' misspelled/);
});

test("CLI exits 2 on unknown option", () => {
  const result = run(["--bogus"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown option/);
});

test("CLI exits 2 on unreadable file", () => {
  const result = run([path.join(root, "does-not-exist.txt")]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Error reading/);
});

test("CLI exits 2 on missing wordlist", () => {
  const result = run(["--dict", "/nonexistent/words.txt", path.join(root, "test.txt")]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Wordlist not found/);
});

test("CLI --add-word adds to a wordlist", () => {
  const dir = tmpDir();
  const dict = path.join(dir, "custom.dict");
  const added = run(["--dict", dict, "--add-word", "kubernets,Toolong"]);
  assert.equal(added.status, 0);
  assert.match(added.stdout, /Added 2 word\(s\) to/);

  const textFile = path.join(dir, "doc.txt");
  fs.writeFileSync(textFile, "the kubernets Toolong cluster\n");
  const check = run(["--dict", dict, textFile]);
  assert.equal(check.status, 0);
});

test("CLI --generate-dict blesses current misspellings", () => {
  const dir = tmpDir();
  const dict = path.join(dir, ".spelldict");
  const textFile = path.join(dir, "doc.txt");
  fs.writeFileSync(textFile, "teh and wrod are typos\n");

  // .spelldict lives in cwd; run the CLI from the temp dir via a relative copy.
  const gen = run(["--dict", dict, "--generate-dict", textFile]);
  assert.equal(gen.status, 0);
  assert.match(gen.stdout, /Added 2 word\(s\)/);
  assert.deepEqual(
    fs.readFileSync(dict, "utf8").split("\n").filter(Boolean).sort(),
    ["teh", "wrod"],
  );

  const recheck = run(["--dict", dict, textFile]);
  assert.equal(recheck.status, 0);
});

test("CLI --ignore suppresses words case-insensitively", () => {
  const result = run(["--ignore", "TEH", path.join(root, "test", "fixtures", "suggestions.txt")]);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /'teh'/);
  assert.match(result.stdout, /'recieve' misspelled/);
});

test("CLI --min-length skips short words", () => {
  const dir = tmpDir();
  const textFile = path.join(dir, "doc.txt");
  fs.writeFileSync(textFile, "xy teh\n");
  const result = run(["--min-length", "3", textFile]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /'teh' misspelled/);
  assert.doesNotMatch(result.stdout, /'xy'/);
});

test("CLI loads default .spelldict from cwd", () => {
  const dir = tmpDir();
  const textFile = path.join(dir, "doc.txt");
  fs.writeFileSync(textFile, "kubernets fine\n");
  fs.writeFileSync(path.join(dir, ".spelldict"), "kubernets\n");
  const result = spawnSync(process.execPath, [cli, textFile], {
    encoding: "utf8",
    cwd: dir, // .spelldict is discovered relative to the working directory
    input: "",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No errors, everything is good/);
});

test("CLI --fix replaces misspellings with top suggestion, preserving case", () => {
  const dir = tmpDir();
  const textFile = path.join(dir, "doc.txt");
  fs.writeFileSync(textFile, "teh wrod\nTeh Cat\n");
  const result = run(["--fix", textFile]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Fixed \d+ misspelling/);
  const fixed = fs.readFileSync(textFile, "utf8");
  assert.match(fixed, /the word/);
  assert.match(fixed, /The Cat/);
});

test("CLI --fix on a clean file is a no-op with exit 0", () => {
  const result = run(["--fix", path.join(root, "test", "fixtures", "clean.txt")]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Nothing to fix/);
});

test("CLI --diff prints changes without writing", () => {
  const dir = tmpDir();
  const textFile = path.join(dir, "doc.txt");
  const original = "teh wrod\n";
  fs.writeFileSync(textFile, original);
  const result = run(["--diff", textFile]);
  assert.equal(result.status, 1); // fixable misspellings found
  assert.match(result.stdout, /--- /);
  assert.match(result.stdout, /@@ line 1/);
  assert.match(result.stdout, /-teh wrod/);
  assert.match(result.stdout, /\+the word/);
  assert.equal(fs.readFileSync(textFile, "utf8"), original, "file must be untouched");
});

test("CLI --markdown skips fenced code blocks", () => {
  const dir = tmpDir();
  const mdFile = path.join(dir, "doc.mdx"); // auto-detected by extension
  fs.writeFileSync(mdFile, "prose teh\n```\nteh in code\n```\n");
  const result = run([mdFile]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /'teh' misspelled on line\(s\): 1\./);
  assert.doesNotMatch(result.stdout, /line\(s\): 1, 3/);
});

test("CLI --markdown flag forces markdown mode on plain files", () => {
  const dir = tmpDir();
  const txtFile = path.join(dir, "doc.txt");
  fs.writeFileSync(txtFile, "prose\n~~~\nteh\n~~~\n");
  const result = run(["--markdown", txtFile]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No errors, everything is good/);
});

test("repo vocabulary is on by default: dependency names pass without .spelldict", () => {
  const repo = tmpDir();
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({ name: "demo", dependencies: { kuberconnect: "^1.0.0" } }),
  );
  const doc = path.join(repo, "doc.txt");
  fs.writeFileSync(doc, "the kuberconnect service\n");
  const result = spawnSync(process.execPath, [cli, doc], {
    encoding: "utf8",
    cwd: repo, // repo vocab is harvested relative to cwd
    input: "",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /No errors, everything is good/);
});

test("--no-repo-vocab reverts to dictionary-only checking", () => {
  const repo = tmpDir();
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({ name: "demo", dependencies: { kuberconnect: "^1.0.0" } }),
  );
  const doc = path.join(repo, "doc.txt");
  fs.writeFileSync(doc, "the kuberconnect service\n");
  const result = spawnSync(process.execPath, [cli, "--no-repo-vocab", doc], {
    encoding: "utf8",
    cwd: repo,
    input: "",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /'kuberconnect' misspelled/);
});

test("--verbose reports repo vocabulary stats on stderr", () => {
  const repo = tmpDir();
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "demo" }));
  const doc = path.join(repo, "doc.txt");
  fs.writeFileSync(doc, "fine\n");
  const result = spawnSync(process.execPath, [cli, "--verbose", "--no-repo-vocab", doc], {
    encoding: "utf8",
    cwd: repo,
    input: "",
  });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stderr, /repo vocab/); // disabled -> no stats

  const verbose = spawnSync(process.execPath, [cli, "--verbose", doc], {
    encoding: "utf8",
    cwd: repo,
    input: "",
  });
  assert.match(verbose.stderr, /repo vocab: \+\d+ words/);
});

test("--consistency flags terminology issues and affects exit code", () => {
  const dir = tmpDir();
  const doc = path.join(dir, "doc.txt");
  // "co-operate" passes the spelling check (its collapsed form "cooperate" is
  // a dictionary word), so the consistency lint is what catches the drift.
  fs.writeFileSync(doc, "Please cooperate fully.\nPlease co-operate fully.\n");
  const result = run(["--consistency", "--no-repo-vocab", doc]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /terminology: 'cooperate' vs 'co-operate' — prefer 'cooperate'/);
  assert.match(result.stdout, /line\(s\): 1, 2/);
  assert.doesNotMatch(result.stdout, /misspelled/);
});

test("without --consistency no terminology lines appear", () => {
  const dir = tmpDir();
  const doc = path.join(dir, "doc.txt");
  fs.writeFileSync(doc, "Please cooperate fully.\nPlease co-operate fully.\n");
  const result = run(["--no-repo-vocab", doc]);
  assert.equal(result.status, 0); // spelling-wise both forms collapse to "cooperate"
  assert.doesNotMatch(result.stdout, /terminology:/);
});

test("--json includes consistency findings when requested", () => {
  const dir = tmpDir();
  const doc = path.join(dir, "doc.txt");
  fs.writeFileSync(doc, "Github and back-end\nbackend\n");
  const result = run(["--json", "--consistency", "--no-repo-vocab", doc]);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout) as {
    consistency: { kind: string; recommendation: string; forms: { form: string }[] }[];
  };
  const kinds = parsed.consistency.map((f) => f.kind);
  assert.ok(kinds.includes("casing"), `expected casing finding: ${result.stdout}`);
  assert.ok(kinds.includes("variants"), `expected variants finding: ${result.stdout}`);
});

test("--agent emits a numbered, confidence-ordered task list", () => {
  const dir = tmpDir();
  const doc = path.join(dir, "doc.txt");
  fs.writeFileSync(doc, "teh wrod\nxyzzyq\n");
  const result = run(["--agent", "--no-repo-vocab", doc]);
  assert.equal(result.status, 1);
  const out = result.stdout;
  assert.match(out, /^# SPELLCHECK TASK LIST/);
  assert.match(out, /# issues: 3 \(2 fixable, 1 review\)/);
  // confidence ordering: both fix:high before the review item
  const highIndex = out.indexOf("[fix:high] line 1: replace 'teh' with 'the'");
  const reviewIndex = out.indexOf("[review] line 2: 'xyzzyq'");
  assert.ok(highIndex > -1 && reviewIndex > highIndex, out);
  // no-suggestion items carry the bless command
  assert.match(out, /--add-word xyzzyq/);
});

test("--agent downgrades words repeated across lines to review", () => {
  const dir = tmpDir();
  const doc = path.join(dir, "doc.txt");
  fs.writeFileSync(doc, "recieve here\nrecieve there\n");
  const result = run(["--agent", "--no-repo-vocab", doc]);
  assert.equal(result.status, 1);
  const out = result.stdout;
  assert.doesNotMatch(out, /\[fix:/); // repeated word must not auto-fix
  assert.match(out, /appears on 2 lines/);
  assert.match(out, /--add-word recieve/);
  assert.match(out, /suggested fix: 'receive'/);
});

test("--agent keeps one-off misspellings as fixable", () => {
  const dir = tmpDir();
  const doc = path.join(dir, "doc.txt");
  fs.writeFileSync(doc, "teh wrod\n");
  const result = run(["--agent", "--no-repo-vocab", doc]);
  assert.match(result.stdout, /\[fix:high\] line 1: replace 'teh' with 'the'/);
});

test("--agent on a clean file prints NO ISSUES and exits 0", () => {
  const result = run(["--agent", path.join(root, "test", "fixtures", "clean.txt")]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /# NO ISSUES/);
});

test("--agent and --json are mutually exclusive", () => {
  const result = run(["--agent", "--json", path.join(root, "test.txt")]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /mutually exclusive/);
});

test("learning loop: --fix persists pairs, later runs honor them as top suggestion", () => {
  const dir = tmpDir();
  const correctionsFile = path.join(dir, "learned.txt");
  const firstDoc = path.join(dir, "first.txt");
  fs.writeFileSync(firstDoc, "teh wrod\n");

  const fixed = run(["--fix", "--no-repo-vocab", "--corrections", correctionsFile, firstDoc]);
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  assert.match(fixed.stdout, /Learned 2 correction\(s\)/);
  const learned = fs.readFileSync(correctionsFile, "utf8");
  assert.match(learned, /teh=the/);
  assert.match(learned, /wrod=word/);

  // A new file with the same typo now gets the learned fix as top suggestion.
  const secondDoc = path.join(dir, "second.txt");
  fs.writeFileSync(secondDoc, "wrod again\n");
  const check = run(["--no-repo-vocab", "--corrections", correctionsFile, secondDoc]);
  assert.match(check.stdout, /'wrod' misspelled on line\(s\): 1\. Suggestions: word,/);

  // Overriding the learned fix flips the ranking deterministically.
  fs.writeFileSync(correctionsFile, "wrod=world\n");
  const overridden = run(["--no-repo-vocab", "--corrections", correctionsFile, secondDoc]);
  assert.match(overridden.stdout, /Suggestions: world,/);
});
