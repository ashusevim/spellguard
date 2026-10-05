import { test } from "node:test";
import assert from "node:assert/strict";
import { SymSpell, damerauLevenshtein } from "../symspell.ts";

const VOCAB = ["the", "word", "world", "hello", "receive", "relieve", "recipe", "spelling"];

test("damerauLevenshtein counts adjacent transposition as 1", () => {
  assert.equal(damerauLevenshtein("teh", "the", 2), 1);
  assert.equal(damerauLevenshtein("wrod", "word", 2), 1);
  assert.equal(damerauLevenshtein("cat", "cut", 2), 1);
  assert.equal(damerauLevenshtein("abc", "abc", 2), 0);
  assert.equal(damerauLevenshtein("abc", "xyz", 2), 3);
});

test("damerauLevenshtein abandons early above max", () => {
  assert.equal(damerauLevenshtein("kitten", "sitting", 2), 3); // true distance 3
});

test("suggest finds transposition corrections with a d1 index", () => {
  const engine = new SymSpell(VOCAB, 2);
  assert.ok(engine.suggest("teh", 5).includes("the"));
  assert.ok(engine.suggest("wrod", 5).includes("word"));
  assert.ok(engine.suggest("recieve", 5).includes("receive"));
});

test("common words win ties at equal distance", () => {
  const engine = new SymSpell(["the", "tea", "tee", "tel"], 2, {
    commonWords: new Set(["the"]),
  });
  assert.equal(engine.suggest("teh", 1)[0], "the");
  // without the boost the tie is broken alphabetically
  const plain = new SymSpell(["the", "tea", "tee", "tel"], 2);
  assert.equal(plain.suggest("teh", 1)[0], "tea");
});

test("suggest respects the limit", () => {
  const engine = new SymSpell(VOCAB, 2);
  assert.ok(engine.suggest("speling", 1).length === 1);
  assert.ok(engine.suggest("speling", 3).length <= 3);
});

test("isValid filters candidates", () => {
  const engine = new SymSpell(VOCAB, 2, { isValid: () => false });
  assert.deepEqual(engine.suggest("teh", 5), []);
});

test("indexDistance = maxEditDistance catches two-substitution typos", () => {
  // "wird" -> "word" is two substitutions (i->o, r->r stays)... use a clear case:
  // "wark" -> "work" is 1 sub; "wirk" -> "work" is 1 sub. A 2-sub case: "wirk" -> "world"? no.
  // "helle" -> "world" won't work; use "wrlld" -> "world" (i? no). Two subs: "wgrld" -> "world".
  const engine = new SymSpell(["world"], 2, { indexDistance: 2 });
  assert.deepEqual(engine.suggest("wgrld", 5), ["world"]);
});

test("single-character queries return no suggestions", () => {
  const engine = new SymSpell(VOCAB, 2);
  assert.deepEqual(engine.suggest("t", 5), []);
});
