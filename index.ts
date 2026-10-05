#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import { analyzeText, type Correction } from "./checker.ts";

const USAGE = "Usage: node index.ts [--json] <file-to-check>";

// Exit codes: 0 = no misspellings, 1 = misspellings found, 2 = usage/IO error.
function main(): void {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const fileName = args.find((arg) => arg !== "--json");

  if (!fileName) {
    console.error(USAGE);
    process.exit(2);
  }

  let content: string;
  try {
    content = fs.readFileSync(fileName, "utf8");
  } catch (err) {
    console.error(`Error reading '${fileName}': ${(err as Error).message}`);
    process.exit(2);
  }

  const corrections = analyzeText(content);

  if (asJson) {
    const misspellings = [...corrections].map(([word, info]): Correction & { word: string } => ({
      word,
      ...info,
    }));
    console.log(JSON.stringify({ misspellings }, null, 2));
  } else if (corrections.size === 0) {
    console.log("No errors, everything is good");
  } else {
    corrections.forEach((info, word) => {
      const suggestions =
        info.suggestions.length > 0 ? ` Suggestions: ${info.suggestions.join(", ")}` : "";
      console.log(`'${word}' is misspelled on line(s): ${info.lines.join(", ")}.${suggestions}`);
    });
  }

  process.exit(corrections.size === 0 ? 0 : 1);
}

main();
