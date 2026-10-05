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
