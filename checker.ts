import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Typo from "typo-js";

export interface Correction {
  lines: number[];
  suggestions: string[];
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

function isSkippable(word: string): boolean {
  // Skip empty results and pure numbers ("123" is not a spelling mistake).
  return word === "" || /^\d+$/.test(word);
}

/** Analyzes text and returns one aggregated entry per misspelled word. */
export function analyzeText(text: string): Map<string, Correction> {
  const corrections = new Map<string, Correction>();

  text.split("\n").forEach((line, lineIndex) => {
    const words = line.split(/\s+/).filter((word) => word.trim() !== "");
    words.forEach((word) => {
      const clean = cleanWord(word);
      if (isSkippable(clean) || dictionary.check(clean)) return;

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
