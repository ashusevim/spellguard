#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import { analyzeText } from "./checker.ts";
import { appendWords, loadWordlist } from "./wordlist.ts";

const DEFAULT_DICT = ".spelldict";

const USAGE = `Usage: node index.ts [options] <file | ->
       cat file | node index.ts

Options:
  --json               Output structured JSON
  --dict <path>        Load an extra wordlist file (repeatable, one word per line)
  --ignore <a,b,c>     Words to never flag (repeatable, case-insensitive)
  --min-length <n>     Skip words shorter than n characters (default: 1)
  --add-word <a,b>     Add word(s) to the wordlist and exit
  --generate-dict      Add all misspelled words from the input to .spelldict, exit 0

Wordlist: .spelldict in the current directory is loaded automatically if present.
Inline directives: spellcheck:disable-line, spellcheck:disable-next-line,
                   spellcheck:off ... spellcheck:on

Exit codes: 0 = no misspellings, 1 = misspellings found, 2 = usage/IO error.`;

// Exit codes: 0 = no misspellings, 1 = misspellings found, 2 = usage/IO error.
function main(): void {
  const args = process.argv.slice(2);

  const opts = {
    json: false,
    dictPaths: [] as string[],
    ignoreWords: [] as string[],
    minLength: 1,
    addWords: [] as string[],
    generateDict: false,
    useStdin: false,
    file: "" as string,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = (): string => {
      if (i + 1 >= args.length) {
        console.error(`Missing value for ${arg}`);
        console.error(USAGE);
        process.exit(2);
      }
      return args[++i];
    };
    switch (arg) {
      case "--json":
        opts.json = true;
        break;
      case "--dict":
        opts.dictPaths.push(value());
        break;
      case "--ignore":
        opts.ignoreWords.push(...splitWords(value()));
        break;
      case "--min-length": {
        const n = Number.parseInt(value(), 10);
        if (Number.isNaN(n) || n < 1) {
          console.error("--min-length requires a positive integer");
          process.exit(2);
        }
        opts.minLength = n;
        break;
      }
      case "--add-word":
        opts.addWords.push(...splitWords(value()));
        break;
      case "--generate-dict":
        opts.generateDict = true;
        break;
      case "-":
      case "--stdin":
        opts.useStdin = true;
        break;
      case "-h":
      case "--help":
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`Unknown option: ${arg}`);
          console.error(USAGE);
          process.exit(2);
        }
        opts.file = arg;
        break;
    }
  }

  const dictTarget = opts.dictPaths[0] ?? DEFAULT_DICT;

  // --add-word only touches the wordlist, no input file needed.
  if (opts.addWords.length > 0) {
    const added = appendWords(dictTarget, opts.addWords);
    console.log(`Added ${added} word(s) to ${dictTarget}`);
    process.exit(0);
  }

  const hasInput = opts.file !== "" || opts.useStdin;
  if (!hasInput) {
    if (process.stdin.isTTY) {
      console.error(USAGE);
      process.exit(2);
    }
    opts.useStdin = true; // piped input with no file argument
  }

  // Load wordlists: default .spelldict (if present) plus any --dict paths.
  const allDictPaths = [...opts.dictPaths];
  if (fs.existsSync(DEFAULT_DICT)) allDictPaths.unshift(DEFAULT_DICT);
  // With --generate-dict the target wordlist is about to be created, so a
  // missing file is not an error.
  const pathsToLoad = opts.generateDict
    ? allDictPaths.filter((dictPath) => dictPath !== dictTarget || fs.existsSync(dictPath))
    : allDictPaths;
  for (const dictPath of pathsToLoad) {
    if (!fs.existsSync(dictPath)) {
      console.error(`Wordlist not found: ${dictPath}`);
      process.exit(2);
    }
  }
  const extraWords = pathsToLoad.flatMap((dictPath) => loadWordlist(dictPath));

  const label = opts.useStdin ? "<stdin>" : opts.file;
  let content: string;
  try {
    content = opts.useStdin ? fs.readFileSync(0, "utf8") : fs.readFileSync(opts.file, "utf8");
  } catch (err) {
    console.error(`Error reading '${label}': ${(err as Error).message}`);
    process.exit(2);
  }

  const corrections = analyzeText(content, {
    extraWords,
    ignoreWords: opts.ignoreWords,
    minLength: opts.minLength,
  });

  if (opts.generateDict) {
    const added = appendWords(dictTarget, [...corrections.keys()]);
    console.log(`Added ${added} word(s) to ${dictTarget}`);
    process.exit(0);
  }

  if (opts.json) {
    const misspellings = [...corrections].map(([word, info]) => ({ word, ...info }));
    console.log(JSON.stringify({ file: label, count: misspellings.length, misspellings }, null, 2));
  } else if (corrections.size === 0) {
    console.log("No errors, everything is good");
  } else {
    corrections.forEach((info, word) => {
      const suggestions =
        info.suggestions.length > 0 ? ` Suggestions: ${info.suggestions.join(", ")}` : "";
      console.log(
        `${label}: '${word}' misspelled on line(s): ${info.lines.join(", ")}.${suggestions}`,
      );
    });
  }

  process.exit(corrections.size === 0 ? 0 : 1);
}

function splitWords(value: string): string[] {
  return value
    .split(",")
    .map((word) => word.trim())
    .filter((word) => word !== "");
}

main();
