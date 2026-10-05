import { test } from "node:test";
import assert from "node:assert/strict";
import { findInconsistencies } from "../consistency.ts";

test("wrong brand casing is flagged with the canonical recommendation", () => {
  const findings = findInconsistencies("We use Github and Javascript daily.\n");
  assert.equal(findings.length, 2);
  const github = findings.find((f) => f.recommendation === "GitHub");
  const js = findings.find((f) => f.recommendation === "JavaScript");
  assert.ok(github && js, `expected GitHub + JavaScript findings, got ${JSON.stringify(findings)}`);
  assert.equal(github.kind, "casing");
  assert.deepEqual(github.forms[0].form, "Github");
  assert.deepEqual(github.lines, [1]);
});

test("correct brand casing produces no findings", () => {
  assert.deepEqual(findInconsistencies("GitHub, TypeScript, iOS and Node.js are fine.\n"), []);
});

test("ALL-CAPS renderings are accepted (headings)", () => {
  assert.deepEqual(findInconsistencies("GITHUB ACTIONS GUIDE\nuse GitHub\n"), []);
});

test("plural and possessive stems are handled", () => {
  // correct stems: accepted
  assert.deepEqual(findInconsistencies("GitHub's APIs and JSONs work.\n"), []);
  // wrong stems: flagged
  const findings = findInconsistencies("Githubs and Api docs.\n");
  assert.equal(findings.length, 2);
});

test("separator variants are flagged with the most frequent form recommended", () => {
  const text = "The backend handles auth.\nThe back-end renders views.\nAnother backend line.\n";
  const findings = findInconsistencies(text);
  assert.equal(findings.length, 1);
  const f = findings[0];
  assert.equal(f.kind, "variants");
  assert.equal(f.recommendation, "backend");
  assert.deepEqual(f.forms.map((x) => x.form).sort(), ["back-end", "backend"]);
  assert.deepEqual(f.lines, [1, 2, 3]);
});

test("case-only differences are never flagged", () => {
  assert.deepEqual(findInconsistencies("Web tools.\nthe web tools.\n"), []);
});

test("underscore variants are caught", () => {
  const findings = findInconsistencies("use x86_64 here\nand x86-64 there\n");
  assert.equal(findings.length, 1);
  assert.deepEqual(findings.map((f) => f.kind), ["variants"]);
});

test("a single spelling is never flagged", () => {
  assert.deepEqual(findInconsistencies("backend backend backend\n"), []);
});

test("markdown code blocks are skipped via the markdown option", () => {
  const md = "Github prose\n```\nGithub in code\n```\n";
  assert.equal(findInconsistencies(md, { markdown: true }).length, 1);
  // without markdown mode the code fence content counts too
  assert.equal(findInconsistencies(md).length, 1);
  const bothInProse = "Github\nGithub\n";
  assert.equal(findInconsistencies(bothInProse).length, 1);
});

test("URLs do not trigger brand findings", () => {
  assert.deepEqual(findInconsistencies("see https://github.com/example/repo\n"), []);
});

test("spellcheck directives suppress lines", () => {
  const text = "Github spellcheck:disable-line\nGithub\n";
  const findings = findInconsistencies(text);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].lines, [2]);
});

test("findings are sorted by first line", () => {
  const text = "use back-end here\nGithub there\nand backend again\n";
  const findings = findInconsistencies(text);
  const firstLines = findings.map((f) => Math.min(...f.lines));
  assert.deepEqual(firstLines, [...firstLines].sort((a, b) => a - b));
});
