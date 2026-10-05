import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Typo from "typo-js";
import { SymSpell, COMMON_WORDS } from "./symspell.ts";
import { stripMarkdown } from "./markdown.ts";

export interface Misspelling {
  lines: number[];
  suggestions: string[];
}

export interface Occurrence {
  word: string;
  line: number;
  suggestions: string[];
}

export interface CheckOptions {
  /** Extra valid words (e.g. from a project wordlist). Matched case-insensitively. */
  extraWords?: string[];
  /** Words to never flag. Matched case-insensitively. */
  ignoreWords?: string[];
  /** Skip words shorter than this many characters (default: 1, i.e. check everything). */
  minLength?: number;
  /** Preprocess the text as Markdown (code blocks, inline code, frontmatter are skipped). */
  markdown?: boolean;
}

const MAX_SUGGESTIONS = 3;

// Resolve the dictionary relative to this file so the CLI works
// from any working directory.
const dictionariesPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "node_modules",
  "typo-js",
  "dictionaries",
);

const affData = fs.readFileSync(path.join(dictionariesPath, "en_US", "en_US.aff"), "utf8");
const wordsData = fs.readFileSync(path.join(dictionariesPath, "en_US", "en_US.dic"), "utf8");
const dictionary = new Typo("en_US", affData, wordsData);

/** Strips punctuation while keeping apostrophes so "don't" stays "don't". */
export function cleanWord(word: string): string {
  return word.replace(/[^\w']/g, "");
}

// Tokens that are never spelling mistakes: URLs, email addresses,
// 0x-prefixed hex, and long hex runs (hashes, ids, base16 blobs).
// Replaced at equal length so column offsets stay valid.
const URL_OR_EMAIL = /https?:\/\/\S+|www\.\S+|\S+@\S+|0[xX][0-9a-fA-F]+/g;
const HEX_RUN = /\b[0-9a-fA-F]{8,}\b/g;

function stripNoise(line: string): string {
  return line
    .replace(URL_OR_EMAIL, (m) => " ".repeat(m.length))
    .replace(HEX_RUN, (m) => " ".repeat(m.length));
}

const DIRECTIVE = /\bspellcheck:(off|on|disable-line|disable-next-line)\b/i;

function isNumber(word: string): boolean {
  return /^\d+$/.test(word);
}

/**
 * Splits a token into identifier sub-words: snake_case, kebab-case,
 * camelCase, PascalCase and leading-acronym forms ("HTMLParser").
 */
export function splitIdentifiers(token: string): string[] {
  return token
    .split(/[_\-/]+/)
    .flatMap((part) => part.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
    .filter((part) => part !== "");
}

// Lazily built: only constructed when the first suggestion is requested.
let suggestionEngine: SymSpell | null = null;
let engineVocabKey = "";
const suggestionCache = new Map<string, string[]>();

function getSuggestions(word: string, extraWords: string[]): string[] {
  const key = word.toLowerCase();
  const cached = suggestionCache.get(key);
  if (cached) return cached;

  if (!suggestionEngine || engineVocabKey !== extraWords.join("\u0000")) {
    const vocabKey = extraWords.join("\u0000");
    const vocab = Object.keys(
      (dictionary as { dictionaryTable?: Record<string, unknown> }).dictionaryTable ?? {},
    );
    suggestionEngine = new SymSpell([...vocab, ...extraWords], 2, {
      commonWords: COMMON_WORDS,
      isValid: (candidate) => dictionary.check(candidate) || extraWords.includes(candidate),
    });
    engineVocabKey = vocabKey;
  }

  const suggestions = suggestionEngine.suggest(key, MAX_SUGGESTIONS);
  suggestionCache.set(key, suggestions);
  return suggestions;
}

/** Scans text and returns every misspelling occurrence with its line number. */
export function scanText(text: string, options: CheckOptions = {}): Occurrence[] {
  const { extraWords = [], ignoreWords = [], minLength = 1, markdown = false } = options;
  const known = new Set(extraWords.map((word) => word.toLowerCase()));
  const ignored = new Set(ignoreWords.map((word) => word.toLowerCase()));
  const source = markdown ? stripMarkdown(text) : text;
  const occurrences: Occurrence[] = [];

  let disabledBlock = false;
  let disableNextLines = 0;

  source.split("\n").forEach((line, lineIndex) => {
    const directive = DIRECTIVE.exec(line);
    if (directive) {
      switch (directive[1].toLowerCase()) {
        case "off":
          disabledBlock = true;
          return;
        case "on":
          disabledBlock = false;
          return;
        case "disable-line":
          return;
        case "disable-next-line":
          disableNextLines = 1;
          return;
      }
    }

    if (disabledBlock) return;
    if (disableNextLines > 0) {
      disableNextLines--;
      return;
    }

    const tokens = stripNoise(line).split(/\s+/).filter((token) => token.trim() !== "");
    for (const token of tokens) {
      const whole = cleanWord(token);
      if (!whole) continue;

      // A valid whole token is accepted as-is: covers "don't", "e-mail",
      // "well-known" and other forms that identifier splitting would mangle.
      if (whole.length >= minLength) {
        const wholeKey = whole.toLowerCase();
        if (ignored.has(wholeKey) || known.has(wholeKey) || dictionary.check(whole)) continue;
      }

      // Invalid as a whole: check its identifier sub-words.
      for (const part of splitIdentifiers(token)) {
        const clean = cleanWord(part);
        if (clean.length < minLength || isNumber(clean) || /^\d/.test(clean)) continue;

        const key = clean.toLowerCase();
        if (ignored.has(key) || known.has(key) || dictionary.check(clean)) continue;

        occurrences.push({
          word: clean,
          line: lineIndex + 1,
          suggestions: getSuggestions(clean, extraWords),
        });
      }
    }
  });

  return occurrences;
}

/** Analyzes text and returns one aggregated entry per misspelled word. */
export function analyzeText(text: string, options: CheckOptions = {}): Map<string, Misspelling> {
  const corrections = new Map<string, Misspelling>();
  for (const { word, line, suggestions } of scanText(text, options)) {
    const entry = corrections.get(word);
    if (entry) {
      // Multiple occurrences on the same line report the line once.
      if (entry.lines[entry.lines.length - 1] !== line) entry.lines.push(line);
    } else {
      corrections.set(word, { lines: [line], suggestions });
    }
  }
  return corrections;
}
