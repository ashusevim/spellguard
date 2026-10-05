import fs from "node:fs";
import path from "node:path";
import { splitIdentifiers } from "./checker.ts";

/**
 * Repo-native vocabulary: derives the project's language from the repo
 * itself instead of a static hand-maintained wordlist.
 *
 * Two trust tiers:
 * - Manifest words (dependency names, project name, keywords) are trusted:
 *   dependency names are almost always spelled correctly, so they are
 *   blessed unconditionally.
 * - Identifier and filename words are counted across the repo and only
 *   blessed at >= minWordCount occurrences, so a one-off typo in the code
 *   never becomes vocabulary.
 *
 * The walk is bounded (maxFiles) and skips dependency/build directories,
 * lockfiles, and minified output.
 */

export interface RepoVocabOptions {
  /** Directory to harvest from (usually the project root / cwd). */
  root: string;
  /** Maximum number of files to scan (default: 1500). */
  maxFiles?: number;
  /** Occurrences needed to bless an identifier/filename word (default: 3). */
  minWordCount?: number;
}

export interface RepoVocabResult {
  /** Lowercased vocabulary words ready to merge into extraWords. */
  words: string[];
  /** Distinct words blessed from manifests. */
  manifestWords: number;
  /** Distinct words blessed from code/filenames via the count threshold. */
  countedWords: number;
  /** Files read during the walk. */
  filesScanned: number;
}

const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", "coverage", "vendor", "target",
  "__pycache__", "venv", "env", "site-packages", "bower_components",
  ".terraform", "examples", "fixtures",
]);

const MANIFESTS = new Set([
  "package.json", "cargo.toml", "go.mod", "pyproject.toml", "requirements.txt",
]);

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", "jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java",
  ".kt", ".rb", ".php", ".c", ".h", ".cpp", ".hpp", ".cs", ".swift", ".sh",
  ".md", ".markdown", ".mdx", ".txt", ".yml", ".yaml", ".toml", ".json",
]);

const IDENTIFIER = /[A-Za-z_$][\w$]*/g;
const MAX_FILE_SIZE = 512 * 1024;

export function harvestRepoVocab(options: RepoVocabOptions): RepoVocabResult {
  const root = options.root;
  const maxFiles = options.maxFiles ?? 1500;
  const minWordCount = Math.max(1, options.minWordCount ?? 3);

  const trusted = new Set<string>();
  const counts = new Map<string, number>();
  let filesScanned = 0;

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { words: [], manifestWords: 0, countedWords: 0, filesScanned: 0 };
  }

  // Depth-first walk with a stack; skips dot-directories and dependency trees.
  const stack: string[] = [root];
  const sourceFiles: string[] = [];

  walk: while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name.toLowerCase())) {
          stack.push(full);
        }
        continue;
      }
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      if (isLockfile(entry.name)) continue;
      if (filesScanned >= maxFiles) break walk;
      filesScanned++;

      const ext = path.extname(entry.name).toLowerCase();
      const isManifest = MANIFESTS.has(entry.name.toLowerCase());

      if (isManifest) {
        const content = readIfSmall(full);
        if (content !== null) harvestManifest(entry.name.toLowerCase(), content, trusted);
      } else if (SOURCE_EXTENSIONS.has(ext)) {
        sourceFiles.push(full);
      }
    }
  }

  // Count identifier words from source files, and words from filenames.
  for (const file of sourceFiles) {
    const content = readIfSmall(file);
    if (content === null) continue;
    countWordsFromText(content, counts);

    const base = path.basename(file, path.extname(file));
    for (const part of base.split(/[^a-zA-Z]+/)) {
      countWord(part, counts);
    }
  }

  const counted = [...counts].filter(([, n]) => n >= minWordCount).map(([w]) => w);
  const words = [...new Set([...trusted, ...counted])].sort();

  return {
    words,
    manifestWords: trusted.size,
    countedWords: counted.length,
    filesScanned,
  };
}

function readIfSmall(filePath: string): string | null {
  try {
    if (fs.statSync(filePath).size > MAX_FILE_SIZE) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function isLockfile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("lock") ||
    lower.endsWith(".map") ||
    lower.endsWith(".min.js") ||
    lower.endsWith(".min.css")
  );
}

function isVocabWord(word: string): boolean {
  return /^[a-z]{2,24}$/.test(word);
}

function countWord(word: string, counts: Map<string, number>): void {
  const lower = word.toLowerCase();
  if (!isVocabWord(lower)) return;
  counts.set(lower, (counts.get(lower) ?? 0) + 1);
}

function countWordsFromText(text: string, counts: Map<string, number>): void {
  for (const match of text.matchAll(IDENTIFIER)) {
    for (const part of splitIdentifiers(match[0])) {
      countWord(part, counts);
    }
  }
}

function addManifestPhrase(phrase: string, trusted: Set<string>): void {
  for (const part of phrase.split(/[^a-zA-Z]+/)) {
    const lower = part.toLowerCase();
    if (isVocabWord(lower)) trusted.add(lower);
  }
}

function harvestManifest(name: string, content: string, trusted: Set<string>): void {
  switch (name) {
    case "package.json":
      harvestPackageJson(content, trusted);
      break;
    case "cargo.toml":
      harvestTomlSections(content, ["dependencies", "dev-dependencies", "build-dependencies"], trusted);
      // The project's own name is trusted vocabulary too.
      const nameMatch = /^\s*name\s*=\s*"([^"]+)"/m.exec(content);
      if (nameMatch) addManifestPhrase(nameMatch[1], trusted);
      break;
    case "go.mod":
      harvestGoMod(content, trusted);
      break;
    case "pyproject.toml":
      harvestPyproject(content, trusted);
      break;
    case "requirements.txt":
      harvestRequirements(content, trusted);
      break;
  }
}

function harvestPackageJson(content: string, trusted: Set<string>): void {
  let pkg: {
    name?: string;
    keywords?: string[];
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(content);
  } catch {
    return;
  }
  if (typeof pkg.name === "string") addManifestPhrase(pkg.name, trusted);
  for (const keyword of pkg.keywords ?? []) {
    if (typeof keyword === "string") addManifestPhrase(keyword, trusted);
  }
  for (const deps of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies, pkg.optionalDependencies]) {
    for (const dep of Object.keys(deps ?? {})) addManifestPhrase(dep, trusted);
  }
}

function harvestTomlSections(
  content: string,
  sectionNames: string[],
  trusted: Set<string>,
): void {
  let active = false;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) {
      active = sectionNames.includes(section[1].split(".").pop()!.trim().toLowerCase());
      continue;
    }
    if (!active) continue;
    const key = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(line);
    if (key) addManifestPhrase(key[1], trusted);
  }
}

function harvestGoMod(content: string, trusted: Set<string>): void {
  let inBlock = false;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("require (")) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (line === ")") inBlock = false;
      else if (line !== "" && !line.startsWith("//")) {
        addManifestPhrase(line.split(/\s+/)[0] ?? "", trusted);
      }
      continue;
    }
    if (line.startsWith("require ")) addManifestPhrase(line.slice(8).trim().split(/\s+/)[0] ?? "", trusted);
    if (line.startsWith("module ")) addManifestPhrase(line.slice(7).trim(), trusted);
  }
}

function harvestPyproject(content: string, trusted: Set<string>): void {
  // [project] name / [tool.poetry] name
  const nameMatch = /^\s*name\s*=\s*"([^"]+)"/m.exec(content);
  if (nameMatch) addManifestPhrase(nameMatch[1], trusted);
  // dependencies = [ "pkg>=1.0", ... ] (single or multi-line)
  for (const arrayMatch of content.matchAll(/dependencies\s*=\s*\[([^\]]*)\]/gs)) {
    for (const dep of arrayMatch[1].matchAll(/"([^"]+)"/g)) {
      addManifestPhrase(dep[1], trusted);
    }
  }
  // [tool.poetry.dependencies] style section keys
  harvestTomlSections(content, ["dependencies", "dev-dependencies"], trusted);
}

function harvestRequirements(content: string, trusted: Set<string>): void {
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("-")) continue;
    const pkg = line.split(/[\s<>=!~;[()[\],]/)[0] ?? "";
    addManifestPhrase(pkg, trusted);
  }
}
