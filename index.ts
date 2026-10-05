#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { analyzeText, scanText, type Occurrence, type Misspelling } from "./checker.ts";
import { findInconsistencies, type ConsistencyFinding } from "./consistency.ts";
import { appendWords, loadWordlist, loadCorrections, appendCorrections } from "./wordlist.ts";
import { harvestRepoVocab } from "./repo-vocab.ts";

const DEFAULT_DICT = ".spelldict";
const DEFAULT_CORRECTIONS = ".spellcorrections";

// How to invoke this CLI in instructions we print (agent task lists, help):
// the installed bin name when running as one, the dev invocation otherwise.
const CLI_NAME = process.argv[1]?.replace(/\\/g, "/").includes("spellguard")
  ? "spellguard"
  : "node index.ts";

const USAGE = `Usage: spellguard [options] <file | ->        (dev: node index.ts)
       cat file | spellguard

Options:
  --json               Output structured JSON
  --dict <path>        Load an extra wordlist file (repeatable, one word per line)
  --ignore <a,b,c>     Words to never flag (repeatable, case-insensitive)
  --min-length <n>     Skip words shorter than n characters (default: 1)
  --add-word <a,b>     Add word(s) to the wordlist and exit
  --generate-dict      Add all misspelled words from the input to .spelldict, exit 0
  --markdown           Force Markdown mode (code blocks, inline code, frontmatter
                       skipped; auto-enabled for .md/.markdown/.mdx files)
  --fix                Replace every misspelling with its top suggestion
  --diff               Print the changes --fix would make; write nothing
  --no-repo-vocab      Don't derive vocabulary from the surrounding project
  --repo-root <dir>    Project root for repo vocabulary (default: cwd)
  --vocab-count <n>    Occurrences needed to bless a code word (default: 3)
  --consistency        Also run terminology-consistency checks (Github vs
                       GitHub, backend vs back-end)
  --agent              Emit an agent-oriented task list: numbered, action-tagged
                       ([fix:high]/[fix:medium]/[review]), confidence-ordered
  --corrections <path> Learned-corrections file (default: .spellcorrections).
                       --fix appends the pairs it applied; they become the top
                       suggestion on future runs
  --verbose            Print repo vocabulary stats to stderr

Wordlist: .spelldict in the current directory is loaded automatically if present.
Inline directives: spellcheck:disable-line, spellcheck:disable-next-line,
                   spellcheck:off ... spellcheck:on

Exit codes: 0 = no misspellings, 1 = misspellings found, 2 = usage/IO error.`;

interface CliOptions {
  json: boolean;
  dictPaths: string[];
  ignoreWords: string[];
  minLength: number;
  addWords: string[];
  generateDict: boolean;
  markdown: boolean;
  fix: boolean;
  diff: boolean;
  repoVocab: boolean;
  repoRoot: string;
  vocabCount: number;
  consistency: boolean;
  agent: boolean;
  correctionsPath: string;
  verbose: boolean;
  useStdin: boolean;
  file: string;
}

/** Applies the case pattern of `original` to `replacement`. */
function matchCase(replacement: string, original: string): string {
  if (original.length > 1 && original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function escapeRegex(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Computes line rewrites: line index (0-based) -> new line text, using the
 * top suggestion for every misspelled word on that line.
 */
function computeFixes(lines: string[], occurrences: Occurrence[]): Map<number, string> {
  // Group: line -> word(lower) -> replacement (case matched per match).
  const byLine = new Map<number, Map<string, string>>();
  for (const { word, line, suggestions } of occurrences) {
    if (suggestions.length === 0) continue;
    let words = byLine.get(line - 1);
    if (!words) byLine.set(line - 1, (words = new Map()));
    if (!words.has(word.toLowerCase())) words.set(word.toLowerCase(), suggestions[0]);
  }

  const fixes = new Map<number, string>();
  for (const [lineIndex, words] of byLine) {
    let fixed = lines[lineIndex];
    for (const [word, replacement] of words) {
      const pattern = new RegExp(`\\b${escapeRegex(word)}\\b`, "gi");
      fixed = fixed.replace(pattern, (match) => matchCase(replacement, match));
    }
    if (fixed !== lines[lineIndex]) fixes.set(lineIndex, fixed);
  }
  return fixes;
}

function main(): void {
  const args = process.argv.slice(2);

  const opts: CliOptions = {
    json: false,
    dictPaths: [],
    ignoreWords: [],
    minLength: 1,
    addWords: [],
    generateDict: false,
    markdown: false,
    fix: false,
    diff: false,
    repoVocab: true,
    repoRoot: "",
    vocabCount: 3,
    consistency: false,
    agent: false,
    correctionsPath: "",
    verbose: false,
    useStdin: false,
    file: "",
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
      case "--markdown":
        opts.markdown = true;
        break;
      case "--fix":
        opts.fix = true;
        break;
      case "--diff":
        opts.diff = true;
        break;
      case "--no-repo-vocab":
        opts.repoVocab = false;
        break;
      case "--repo-root":
        opts.repoRoot = value();
        break;
      case "--vocab-count": {
        const n = Number.parseInt(value(), 10);
        if (Number.isNaN(n) || n < 1) {
          console.error("--vocab-count requires a positive integer");
          process.exit(2);
        }
        opts.vocabCount = n;
        break;
      }
      case "--verbose":
        opts.verbose = true;
        break;
      case "--consistency":
        opts.consistency = true;
        break;
      case "--agent":
        opts.agent = true;
        break;
      case "--corrections":
        opts.correctionsPath = value();
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

  if (opts.agent && opts.json) {
    console.error("--agent and --json are mutually exclusive");
    process.exit(2);
  }

  // Markdown mode: forced by flag, auto-enabled for Markdown file extensions.
  if (!opts.markdown && /\.(md|markdown|mdx)$/i.test(opts.file)) opts.markdown = true;

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

  // Repo-native vocabulary: learn the project's language from its manifests,
  // identifiers, and filenames (flagged words from a one-off typo need 3+ hits).
  if (opts.repoVocab) {
    const harvest = harvestRepoVocab({
      root: opts.repoRoot || process.cwd(),
      minWordCount: opts.vocabCount,
    });
    extraWords.push(...harvest.words);
    if (opts.verbose) {
      console.error(
        `repo vocab: +${harvest.words.length} words (${harvest.manifestWords} manifest, ${harvest.countedWords} from code) from ${harvest.filesScanned} files`,
      );
    }
  }

  const label = opts.useStdin ? "<stdin>" : opts.file;
  let content: string;
  try {
    content = opts.useStdin ? fs.readFileSync(0, "utf8") : fs.readFileSync(opts.file, "utf8");
  } catch (err) {
    console.error(`Error reading '${label}': ${(err as Error).message}`);
    process.exit(2);
  }

  const correctionsPath = opts.correctionsPath || DEFAULT_CORRECTIONS;
  const learned = loadCorrections(correctionsPath);

  const checkOptions = {
    extraWords,
    ignoreWords: opts.ignoreWords,
    minLength: opts.minLength,
    markdown: opts.markdown,
    corrections: learned,
  };

  // --fix / --diff: rewrite lines with top suggestions.
  if (opts.fix || opts.diff) {
    const occurrences = scanText(content, checkOptions);
    const fixable = occurrences.filter((o) => o.suggestions.length > 0);
    const unfixable = new Set(
      occurrences.filter((o) => o.suggestions.length === 0).map((o) => o.word),
    );
    const lines = content.split("\n");
    const fixes = computeFixes(lines, occurrences);

    if (opts.diff) {
      if (fixes.size > 0) {
        console.log(`--- ${label}`);
        console.log(`+++ ${label}`);
        for (const [lineIndex, fixed] of [...fixes].sort((a, b) => a[0] - b[0])) {
          console.log(`@@ line ${lineIndex + 1}`);
          console.log(`-${lines[lineIndex]}`);
          console.log(`+${fixed}`);
        }
      }
      process.exit(fixable.length > 0 ? 1 : 0);
    }

    if (fixes.size === 0) {
      if (unfixable.size > 0) {
        console.error(`No suggestions for: ${[...unfixable].join(", ")}`);
      } else {
        console.log("Nothing to fix");
      }
      process.exit(unfixable.size > 0 ? 1 : 0);
    }

    for (const [lineIndex, fixed] of fixes) lines[lineIndex] = fixed;
    if (!opts.useStdin) fs.writeFileSync(opts.file, lines.join("\n"));
    else process.stdout.write(lines.join("\n"));

    // Learning loop: persist the pairs we just applied so they become the
    // top suggestion for future runs of the same typo.
    const appliedPairs = new Map<string, string>();
    for (const occurrence of fixable) {
      if (occurrence.suggestions.length > 0) {
        appliedPairs.set(occurrence.word.toLowerCase(), occurrence.suggestions[0]);
      }
    }
    const learnedCount = appendCorrections(correctionsPath, [...appliedPairs]);
    console.log(`Fixed ${fixable.length} misspelling(s) in ${label}`);
    if (learnedCount > 0) console.log(`Learned ${learnedCount} correction(s) to ${correctionsPath}`);
    if (unfixable.size > 0) {
      console.error(`No suggestions for: ${[...unfixable].join(", ")}`);
      process.exit(1);
    }
    process.exit(0);
  }

  const corrections = analyzeText(content, checkOptions);
  const consistencyFindings: ConsistencyFinding[] = opts.consistency
    ? findInconsistencies(content, { markdown: opts.markdown })
    : [];

  if (opts.generateDict) {
    const added = appendWords(dictTarget, [...corrections.keys()]);
    console.log(`Added ${added} word(s) to ${dictTarget}`);
    process.exit(0);
  }

  if (opts.agent) {
    console.log(renderAgentTaskList(label, corrections, consistencyFindings, opts));
    process.exit(corrections.size + consistencyFindings.length === 0 ? 0 : 1);
  }

  if (opts.json) {
    const misspellings = [...corrections].map(([word, info]) => ({ word, ...info }));
    console.log(
      JSON.stringify(
        {
          file: label,
          count: misspellings.length,
          misspellings,
          ...(opts.consistency ? { consistency: consistencyFindings } : {}),
        },
        null,
        2,
      ),
    );
  } else if (corrections.size === 0 && consistencyFindings.length === 0) {
    console.log("No errors, everything is good");
  } else {
    corrections.forEach((info, word) => {
      const suggestions =
        info.suggestions.length > 0 ? ` Suggestions: ${info.suggestions.join(", ")}` : "";
      console.log(
        `${label}: '${word}' misspelled on line(s): ${info.lines.join(", ")}.${suggestions}`,
      );
    });
    for (const finding of consistencyFindings) {
      const forms = finding.forms.map((f) => `'${f.form}'`).join(" vs ");
      const allLines = [...new Set(finding.forms.flatMap((f) => f.lines))].sort((a, b) => a - b);
      console.log(
        `${label}: terminology: ${forms} — prefer '${finding.recommendation}' (line(s): ${allLines.join(", ")})`,
      );
    }
  }

  const issueCount = corrections.size + consistencyFindings.length;
  process.exit(issueCount === 0 ? 0 : 1);
}

function splitWords(value: string): string[] {
  return value
    .split(",")
    .map((word) => word.trim())
    .filter((word) => word !== "");
}

interface AgentTask {
  confidence: 0 | 1 | 2; // 0 = high, 1 = medium, 2 = review
  line: number;
  text: string;
}

function renderAgentTaskList(
  label: string,
  corrections: Map<string, Misspelling>,
  findings: ConsistencyFinding[],
  opts: CliOptions,
): string {
  const tasks: AgentTask[] = [];
  const seen = new Set<string>();

  for (const [word, info] of corrections) {
    // A misspelling used on multiple lines is usually intentional vocabulary
    // (a proper noun, a tool name), not a one-off typo - downgrade to review
    // so the agent verifies instead of trusting one suggestion for all lines.
    const repeated = info.lines.length >= 2;
    for (const line of info.lines) {
      const dedupeKey = `${word.toLowerCase()}:${line}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      if (info.suggestions.length === 0) {
        tasks.push({
          confidence: 2,
          line,
          text: `[review] line ${line}: '${word}' has no suggestion — rewrite or bless: ${cliCommand(opts, ["--add-word", word])}`,
        });
      } else if (repeated) {
        tasks.push({
          confidence: 2,
          line,
          text: `[review] line ${line}: '${word}' appears on ${info.lines.length} lines — if intentional, bless: ${cliCommand(opts, ["--add-word", word])}; suggested fix: '${info.suggestions[0]}'`,
        });
      } else {
        const confidence: "high" | "medium" = info.topDistance === 1 ? "high" : "medium";
        const alternatives = info.suggestions.slice(1);
        const altText = alternatives.length > 0 ? ` (alternatives: ${alternatives.join(", ")})` : "";
        tasks.push({
          confidence: confidence === "high" ? 0 : 1,
          line,
          text: `[fix:${confidence}] line ${line}: replace '${word}' with '${info.suggestions[0]}'${altText}`,
        });
      }
    }
  }

  for (const finding of findings) {
    const forms = finding.forms.map((f) => f.form);
    const line = Math.min(...finding.lines);
    const text =
      finding.kind === "casing"
        ? `[review] consistency line ${line}: '${forms[0]}' should be '${finding.recommendation}'`
        : `[review] consistency line ${line}: ${forms.map((f) => `'${f}'`).join(" vs ")} — prefer '${finding.recommendation}'`;
    tasks.push({ confidence: 2, line, text });
  }

  tasks.sort((a, b) => a.confidence - b.confidence || a.line - b.line);

  const fixable = tasks.filter((t) => t.confidence !== 2).length;
  const header = tasks.length === 0
    ? ["# SPELLCHECK TASK LIST", `# file: ${label}`, "# NO ISSUES"]
    : [
        "# SPELLCHECK TASK LIST",
        `# file: ${label}`,
        `# issues: ${tasks.length} (${fixable} fixable, ${tasks.length - fixable} review)`,
        ...(!opts.useStdin
          ? [`# self-service: ${cliCommand(opts, ["--fix", label])}`]
          : []),
      ];

  return [...header, ...tasks.map((t, i) => `${i + 1}. ${t.text}`)].join("\n");
}

function cliCommand(opts: CliOptions, args: string[]): string {
  const flags: string[] = [];
  if (opts.consistency) flags.push("--consistency");
  if (opts.markdown) flags.push("--markdown");
  if (opts.correctionsPath) flags.push("--corrections", opts.correctionsPath);
  return [CLI_NAME, ...flags, ...args].join(" ");
}

main();
