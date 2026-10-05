# TypeScript Spell Checker

A command-line spell checker built with TypeScript that analyzes text files and provides spelling suggestions. Dictionary recall with a zero-config, low-false-positive experience — fully local, one runtime dependency.

Runs directly on Node.js — no build step, no transpiler.

## Features

- **Repo-native vocabulary** — the tool learns your project's language automatically: dependency names from `package.json`/`Cargo.toml`/`go.mod`/`pyproject.toml`/`requirements.txt` are trusted, and code identifiers + filenames are blessed at 3+ occurrences. Zero config, deterministic, no LLM.
- **SymSpell suggestions** — corrects typos that Hunspell-style suggesters miss (`teh→the`, `wrod→word`, `tommorow→tomorrow`), ranked by edit distance and word frequency, built lazily in ~1s
- **Accurate spell checking** using the US English dictionary
- **Identifier splitting** — `getSubcribeName` is checked as `get Subcribe Name`; camelCase, PascalCase, snake_case, kebab-case
- **Markdown mode** — auto-enabled for `.md`/`.markdown`/`.mdx`: fenced code blocks, inline code, frontmatter, and HTML comments are skipped
- **`--fix` / `--diff`** — apply top suggestions (case-preserving) or preview them
- **Line number tracking** for misspelled words
- **Apostrophe-aware** — `don't` is checked as-is, not stripped to `dont`
- **Project wordlist** — `.spelldict` is picked up automatically; never configure, just add words
- **Inline directives** — disable checking per line, per next line, or per block
- **Noise filtering** — URLs, emails, and hex blobs (hashes, ids) are never flagged
- **JSON output** (`--json`) for scripting
- **stdin support** — `cat file | spellchecker`
- **Exit codes** for CI pipelines: `0` = clean, `1` = misspellings found, `2` = usage/IO error

## Requirements

- Node.js 22.6+ (native TypeScript type stripping; tested on Node 26)
- One runtime dependency: `typo-js`

## Installation

```bash
git clone <your-repo-url>
cd spell-checker
npm install
```

## Usage

```bash
node index.ts [options] <file>
cat file | node index.ts          # stdin
node index.ts -                   # stdin, explicit
```

### Options

| Option | Effect |
| --- | --- |
| `--json` | Structured JSON output |
| `--dict <path>` | Load an extra wordlist file (repeatable, one word per line) |
| `--ignore <a,b,c>` | Words to never flag (repeatable, case-insensitive) |
| `--min-length <n>` | Skip words shorter than n characters |
| `--add-word <a,b>` | Add word(s) to the wordlist and exit |
| `--generate-dict` | Add all misspelled words from the input to `.spelldict`, exit 0 |
| `--markdown` | Force Markdown mode (auto-enabled for `.md`/`.markdown`/`.mdx`) |
| `--fix` | Replace every misspelling with its top suggestion (case-preserving) |
| `--diff` | Print the changes `--fix` would make; write nothing |
| `--no-repo-vocab` | Don't derive vocabulary from the surrounding project |
| `--repo-root <dir>` | Project root for repo vocabulary (default: cwd) |
| `--vocab-count <n>` | Occurrences needed to bless a code word (default: 3) |
| `--verbose` | Print repo vocabulary stats to stderr |
| `-h`, `--help` | Show help |

### Project wordlist

A `.spelldict` file in the current directory is loaded automatically (one word per line, `#` comments allowed). Words are matched case-insensitively:

```
# .spelldict
kubernetes
Kubernetes   # duplicate, ignored
MyCompanyName
```

### Repo-native vocabulary (on by default)

Before checking, the tool reads the surrounding project and derives its vocabulary:

- **Manifests are trusted**: dependency names, project names, and keywords from `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, and `requirements.txt`
- **Code and filenames are counted**: identifier sub-words (`kubernetsClient` → `kubernets`) are blessed at 3+ occurrences across the repo — so a one-off typo in the code never becomes vocabulary

Dependency directories (`node_modules`, `target`, `vendor`, ...), lockfiles, and minified output are skipped; the walk is capped at 1500 files. Disable with `--no-repo-vocab`, retarget with `--repo-root <dir>`, tune the threshold with `--vocab-count <n>`, inspect with `--verbose`.

Add words as you go:

```bash
node index.ts --add-word kubernets,MyOrg
node index.ts --generate-dict notes.txt   # bless every word it just flagged
```

### Inline directives

Put them anywhere in a line — comments, prose, anywhere:

```js
teh spellcheck:disable-line          // this line is skipped
teh                                  // flagged
// spellcheck:disable-next-line
teh                                  // skipped
// spellcheck:off
teh                                  // skipped
// spellcheck:on
teh                                  // flagged again
```

### Sample Output

```
notes.txt: 'recieve' misspelled on line(s): 1, 12. Suggestions: relieve, receive, recipe
notes.txt: 'gooattty' misspelled on line(s): 8.
```

Or when no errors are found:

```
No errors, everything is good
```

### JSON Output

```json
{
  "file": "notes.txt",
  "count": 1,
  "misspellings": [
    { "word": "recieve", "lines": [1, 12], "suggestions": ["relieve", "receive", "recipe"] }
  ]
}
```

## How It Works

1. **Input**: reads the file (or stdin) as UTF-8
2. **Repo vocabulary**: harvests trusted manifest words and count-verified code words from the surrounding project
3. **Markdown mode**: blanks frontmatter, fenced code, inline code, and HTML comments at equal length (line/column offsets preserved)
4. **Noise filtering**: strips URLs, emails, `0x` hex, and long hex runs per line
5. **Directives**: applies `spellcheck:` inline directives before scanning
6. **Token checking**: each whitespace token is checked whole first (so `well-known` and `don't` pass), then split into identifier sub-words and checked individually
7. **Dictionary check**: validates words against the US English dictionary (typo-js, preloaded synchronously), the project wordlist, and the repo vocabulary
8. **Suggestions**: a SymSpell deletion index over the ~120k-word vocabulary plus repo words ranks candidates by Damerau-Levenshtein distance, then common-word frequency
9. **Result aggregation**: groups the same misspelling across lines

## Development

The logic lives in `checker.ts` (scanning), `symspell.ts` (suggestion engine), `repo-vocab.ts` (repo vocabulary harvest), `markdown.ts` (Markdown preprocessing), `wordlist.ts` (wordlist files), and `index.ts` (CLI).

Run the test suite (Node's built-in test runner, zero test dependencies):

```bash
npm test
```

## Roadmap

- Terminology-consistency lint (`Github` vs `GitHub`, `backend` vs `back-end`)
- Agent-facing output (`--agent` task-list format) and auto-blessing on `--fix`
- Multiple files / glob patterns with directory walking
- `spellcheck.json` config file (words, ignorePaths, minLength)
- Interactive mode (aspell-style y/n/a)
- Additional locales (en_GB and beyond)
- Commit-msg hook recipe and GitHub Action

## License

MIT License - feel free to use this project for learning and development.
