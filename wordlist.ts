import fs from "node:fs";

/**
 * Loads a wordlist file: one word per line, `#` comments allowed,
 * blank lines ignored. Returns an empty list for missing files.
 */
export function loadWordlist(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line !== "");
}

/**
 * Appends words to a wordlist file, creating it if needed.
 * Skips duplicates (case-insensitive). Returns the number of words added.
 */
export function appendWords(filePath: string, words: string[]): number {
  if (words.length === 0) return 0;
  const existing = new Set(loadWordlist(filePath).map((word) => word.toLowerCase()));
  const fresh = words.filter((word) => !existing.has(word.toLowerCase()));
  if (fresh.length > 0) {
    fs.appendFileSync(filePath, fresh.join("\n") + "\n");
  }
  return fresh.length;
}

/**
 * Learned corrections: `typo=fix` per line, `#` comments allowed.
 * Written by --fix, honored as top suggestion on future runs.
 */
export function loadCorrections(filePath: string): Map<string, string> {
  const corrections = new Map<string, string>();
  if (!fs.existsSync(filePath)) return corrections;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const cleaned = line.replace(/#.*$/, "").trim();
    if (cleaned === "") continue;
    const eq = cleaned.indexOf("=");
    if (eq <= 0 || eq === cleaned.length - 1) continue;
    const typo = cleaned.slice(0, eq).trim().toLowerCase();
    const fix = cleaned.slice(eq + 1).trim();
    if (typo !== "" && fix !== "") corrections.set(typo, fix);
  }
  return corrections;
}

/** Appends typo=fix pairs, skipping duplicates. Returns the number added. */
export function appendCorrections(filePath: string, pairs: [string, string][]): number {
  if (pairs.length === 0) return 0;
  const existing = loadCorrections(filePath);
  const fresh = pairs.filter(([typo, fix]) => existing.get(typo.toLowerCase()) !== fix);
  if (fresh.length > 0) {
    fs.appendFileSync(filePath, fresh.map(([typo, fix]) => `${typo}=${fix}`).join("\n") + "\n");
  }
  return fresh.length;
}
