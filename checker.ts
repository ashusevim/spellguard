import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Typo from "typo-js";
import { SymSpell, COMMON_WORDS } from "./symspell.ts";
import { stripMarkdown } from "./markdown.ts";
import { TECH_WORDS } from "./techdict.ts";

export interface Misspelling {
  lines: number[];
  suggestions: string[];
  /** Damerau-Levenshtein distance of the top suggestion (undefined if none). */
  topDistance?: number;
}

export interface Occurrence {
  word: string;
  line: number;
  suggestions: string[];
  /** Damerau-Levenshtein distance of the top suggestion (undefined if none). */
  topDistance?: number;
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
  /** Learned corrections (typo -> fix) applied as the top suggestion. */
  corrections?: Map<string, string>;
}

const MAX_SUGGESTIONS = 3;

// Resolve the dictionary through the module system so it works in every
// install layout: running from a checkout, npx, or installed as a
// dependency (where npm may flatten node_modules).
const typoEntryPath = fileURLToPath(import.meta.resolve("typo-js"));
const dictionariesPath = path.join(path.dirname(typoEntryPath), "dictionaries");

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
    .split(/[_\-/.]+/)
    .flatMap((part) => part.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
    .filter((part) => part !== "");
}

// Lazily built: only constructed when the first suggestion is requested.
let suggestionEngine: SymSpell | null = null;
let engineVocabKey = "";
const suggestionCache = new Map<string, { suggestions: string[]; topDistance?: number }>();

function getSuggestions(
  word: string,
  extraWords: string[],
  corrections: Map<string, string>,
): { suggestions: string[]; topDistance?: number } {
  const key = word.toLowerCase();
  const learnedFix = corrections.get(key);
  // The cached value depends on the word's learned correction, so it must
  // be part of the cache key (the engine itself is keyed on extraWords).
  const cacheKey = learnedFix ? `${key}\u0001${learnedFix.toLowerCase()}` : key;
  const cached = suggestionCache.get(cacheKey);
  if (cached) return cached;

  if (!suggestionEngine || engineVocabKey !== extraWords.join("\u0000")) {
    const vocabKey = extraWords.join("\u0000");
    suggestionEngine = new SymSpell([...dictionaryVocabulary(), ...extraWords], 2, {
      commonWords: COMMON_WORDS,
      isValid: (candidate) => dictionary.check(candidate) || extraWords.includes(candidate),
    });
    engineVocabKey = vocabKey;
  }

  const ranked = suggestionEngine.suggestWithDistance(key, MAX_SUGGESTIONS);
  let suggestions = ranked.map((s) => s.word);
  let topDistance = ranked[0]?.distance;

  // A learned correction always ranks first.
  if (learnedFix && learnedFix.toLowerCase() !== key) {
    suggestions = [learnedFix, ...suggestions.filter((s) => s !== learnedFix)].slice(
      0,
      MAX_SUGGESTIONS,
    );
    topDistance = 1;
  }

  const result = { suggestions, topDistance };
  suggestionCache.set(cacheKey, result);
  return result;
}

/**
 * The dictionary's raw word list, used as suggestion vocabulary.
 * typo-js < 1.3 exposes dictionaryTable as an object; >= 1.3 uses a Map.
 */
function dictionaryVocabulary(): string[] {
  const table = (dictionary as { dictionaryTable?: Record<string, unknown> | Map<string, unknown> })
    .dictionaryTable;
  if (!table) return [];
  return table instanceof Map ? [...table.keys()] : Object.keys(table);
}

/** Scans text and returns every misspelling occurrence with its line number. */
export function scanText(text: string, options: CheckOptions = {}): Occurrence[] {
  const {
    extraWords = [],
    ignoreWords = [],
    minLength = 1,
    markdown = false,
    corrections = new Map(),
  } = options;
  const known = new Set(extraWords.map((word) => word.toLowerCase()));
  const ignored = new Set(ignoreWords.map((word) => word.toLowerCase()));
  const occurrences: Occurrence[] = [];

  for (const { line: lineNumber, tokens } of preprocessLines(text, markdown)) {
    for (const token of tokens) {
      const whole = cleanWord(token);
      if (!whole) continue;

      // Dot-segmented tokens ("Node.js", "package.json", "README.md") are
      // valid when every segment is a valid word.
      if (token.includes(".")) {
        const segments = token.split(".");
        const allValid = segments.every((segment) => {
          const s = cleanWord(segment).toLowerCase();
          return (
            s !== "" &&
            (dictionary.check(s) || TECH_WORDS.has(s) || known.has(s) || ignored.has(s))
          );
        });
        if (allValid) continue;
      }

      // A valid whole token is accepted as-is: covers "don't", "e-mail",
      // "well-known" and other forms that identifier splitting would mangle.
      if (whole.length >= minLength) {
        const wholeKey = whole.toLowerCase();
        if (
          ignored.has(wholeKey) ||
          known.has(wholeKey) ||
          TECH_WORDS.has(wholeKey) ||
          dictionary.check(whole)
        ) {
          continue;
        }
      }

      // Invalid as a whole: check its identifier sub-words.
      for (const part of splitIdentifiers(token)) {
        const clean = cleanWord(part);
        if (clean.length < minLength || isNumber(clean) || /^\d/.test(clean)) continue;

        const key = clean.toLowerCase();
        if (
          ignored.has(key) ||
          known.has(key) ||
          TECH_WORDS.has(key) ||
          dictionary.check(clean)
        ) {
          continue;
        }

        const { suggestions, topDistance } = getSuggestions(clean, extraWords, corrections);
        occurrences.push({ word: clean, line: lineNumber, suggestions, topDistance });
      }
    }
  }

  return occurrences;
}

export interface ProcessedLine {
  /** 1-based line number in the original text. */
  line: number;
  /** Whitespace tokens after noise stripping, directive filtering, etc. */
  tokens: string[];
}

/**
 * Shared preprocessing pipeline for all checks: Markdown blanking, inline
 * directives, and noise stripping (URLs, emails, hex). Line numbers map
 * back to the original text.
 */
export function preprocessLines(text: string, markdown = false): ProcessedLine[] {
  const source = markdown ? stripMarkdown(text) : text;
  const processed: ProcessedLine[] = [];

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
    processed.push({ line: lineIndex + 1, tokens });
  });

  return processed;
}

/** Analyzes text and returns one aggregated entry per misspelled word. */
export function analyzeText(text: string, options: CheckOptions = {}): Map<string, Misspelling> {
  const corrections = new Map<string, Misspelling>();
  for (const { word, line, suggestions, topDistance } of scanText(text, options)) {
    const entry = corrections.get(word);
    if (entry) {
      // Multiple occurrences on the same line report the line once.
      if (entry.lines[entry.lines.length - 1] !== line) entry.lines.push(line);
    } else {
      corrections.set(word, { lines: [line], suggestions, topDistance });
    }
  }
  return corrections;
}
