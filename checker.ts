import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Typo from "typo-js";

export interface Misspelling {
  lines: number[];
  suggestions: string[];
}

export interface CheckOptions {
  /** Extra valid words (e.g. from a project wordlist). Matched case-insensitively. */
  extraWords?: string[];
  /** Words to never flag. Matched case-insensitively. */
  ignoreWords?: string[];
  /** Skip words shorter than this many characters (default: 1, i.e. check everything). */
  minLength?: number;
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
const URL_OR_EMAIL = /https?:\/\/\S+|www\.\S+|\S+@\S+|0[xX][0-9a-fA-F]+/g;
const HEX_RUN = /\b[0-9a-fA-F]{8,}\b/g;

function stripNoise(line: string): string {
  return line.replace(URL_OR_EMAIL, " ").replace(HEX_RUN, " ");
}

const DIRECTIVE = /\bspellcheck:(off|on|disable-line|disable-next-line)\b/i;

function isNumber(word: string): boolean {
  return /^\d+$/.test(word);
}

/** Analyzes text and returns one aggregated entry per misspelled word. */
export function analyzeText(text: string, options: CheckOptions = {}): Map<string, Misspelling> {
  const { extraWords = [], ignoreWords = [], minLength = 1 } = options;
  const known = new Set(extraWords.map((word) => word.toLowerCase()));
  const ignored = new Set(ignoreWords.map((word) => word.toLowerCase()));
  const corrections = new Map<string, Misspelling>();

  let disabledBlock = false;
  let disableNextLines = 0;

  text.split("\n").forEach((line, lineIndex) => {
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

    const words = stripNoise(line).split(/\s+/).filter((word) => word.trim() !== "");
    words.forEach((word) => {
      const clean = cleanWord(word);
      if (clean.length < minLength || isNumber(clean)) return;

      const key = clean.toLowerCase();
      if (ignored.has(key) || known.has(key) || dictionary.check(clean)) return;

      const lineNumber = lineIndex + 1;
      const entry = corrections.get(clean);
      if (entry) {
        entry.lines.push(lineNumber);
      } else {
        corrections.set(clean, {
          lines: [lineNumber],
          suggestions: dictionary.suggest(clean, MAX_SUGGESTIONS),
        });
      }
    });
  });

  return corrections;
}
