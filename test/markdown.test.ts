import { test } from "node:test";
import assert from "node:assert/strict";
import { stripMarkdown } from "../markdown.ts";

test("fenced code blocks are blanked, line count preserved", () => {
  const md = "prose teh\n```js\nconst teh = 1;\n```\nmore teh\n";
  const out = stripMarkdown(md);
  const lines = out.split("\n");
  assert.equal(lines.length, md.split("\n").length);
  assert.match(lines[0], /teh/);
  assert.equal(lines[1].trim(), "");
  assert.equal(lines[2].trim(), "");
  assert.equal(lines[3].trim(), "");
  assert.match(lines[4], /teh/);
});

test("tilde fences are handled", () => {
  const md = "prose\n~~~\nteh\n~~~\nteh\n";
  const lines = stripMarkdown(md).split("\n");
  assert.match(lines[0], /prose/);
  assert.equal(lines[2].trim(), "");
  assert.match(lines[4], /teh/);
});

test("inline code spans are blanked at equal length", () => {
  const md = "use `teh_wrod` flag";
  const out = stripMarkdown(md);
  assert.equal(out.length, md.length);
  assert.doesNotMatch(out, /teh_wrod/);
  assert.match(out, /^use\s+flag$/);
});

test("frontmatter is skipped", () => {
  const md = "---\nteh: wrod\n---\nprose teh\n";
  const lines = stripMarkdown(md).split("\n");
  assert.equal(lines[1].trim(), "");
  assert.match(lines[3], /teh/);
});

test("multi-line HTML comments are skipped", () => {
  const md = "before teh\n<!-- teh wrod\nstill comment -->\nafter teh\n";
  const lines = stripMarkdown(md).split("\n");
  assert.match(lines[0], /teh/);
  assert.equal(lines[1].trim(), "");
  assert.equal(lines[2].trim(), "");
  assert.match(lines[3], /teh/);
});

test("inline HTML comments are blanked at equal length", () => {
  const md = "prose <!-- teh wrod --> end";
  const out = stripMarkdown(md);
  assert.equal(out.length, md.length);
});
