# spellguard

[![CI](https://github.com/ashusevim/spellguard/actions/workflows/ci.yml/badge.svg)](https://github.com/ashusevim/spellguard/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/spellguard)](https://www.npmjs.com/package/spellguard)

**A spell checker that learns your project's language — and stays out of your way.**

Fully local, deterministic, no config required, one runtime dependency.

```bash
$ npx spellguard --consistency doc.md
doc.md: 'recieve' misspelled on line(s): 2. Suggestions: receive, relieve, recede
doc.md: 'tommorow' misspelled on line(s): 3. Suggestions: tomorrow
doc.md: terminology: 'Github' — prefer 'GitHub' (line(s): 1)
doc.md: terminology: 'backend' vs 'back-end' — prefer 'backend' (line(s): 1, 2)
```

That's the whole pitch: real typos get caught, your project's terms never do, and everything runs in milliseconds on your machine.

## Why spellguard

Existing tools force a bad trade:

- **Dictionary checkers** (aspell, cspell) flag every project term you haven't configured — the "configuration tax" grows forever
- **Typo-list checkers** (codespell, typos) only catch typos someone already listed
- **AI checkers** are slow, non-deterministic, and send your text to a server

spellguard takes a different path — it **derives your project's vocabulary from the repo itself**, then layers deterministic checks on top. No config, no network, no LLM.

## What it does

**1. Learns your repo (zero config, on by default)**

Dependency names from `package.json` / `Cargo.toml` / `go.mod` / `pyproject.toml` / `requirements.txt` are trusted automatically. Words from your code and filenames (`kubernetsClient` → `kubernets`) are blessed after 3+ occurrences — so one-off typos never become vocabulary.

**2. Corrects typos other checkers miss**

Suggestions come from a SymSpell engine (edit distance + word frequency ranking), not Hunspell's:

```
teh      → the        (Hunspell often suggests: th, eh, tech)
wrod     → word
tommorow → tomorrow
```

**3. Checks code like code**

Identifiers are split before checking — `getSubcribeName` flags `Subcribe`. camelCase, PascalCase, snake_case, kebab-case. In Markdown, fenced code blocks, inline code, and frontmatter are skipped automatically.

**4. Catches terminology drift (`--consistency`)**

The casing/separator inconsistency that AI-generated docs are notorious for — see the example above.

**5. Works with AI agents (`--agent`)**

Emits a numbered, confidence-ordered task list instead of prose:

```
$ spellguard --agent doc.md
# SPELLCHECK TASK LIST
# file: doc.md
# issues: 4 (3 fixable, 1 review)
# self-service: spellguard --fix doc.md
1. [fix:high] line 2: replace 'recieve' with 'receive' (alternatives: relieve, recede)
2. [fix:high] line 3: replace 'teh' with 'the' (alternatives: tea, tee)
3. [fix:medium] line 3: replace 'tommorow' with 'tomorrow'
4. [review] line 9: 'xyzzyq' has no suggestion — rewrite or bless: spellguard --add-word xyzzyq
```

Confidence is deterministic: `[fix:high]` = one-off typo, edit distance 1 · `[fix:medium]` = distance 2 · `[review]` = no suggestion, a consistency finding, or a word repeated across lines (repeated "misspellings" are usually intentional vocabulary — verify, don't auto-fix).

**6. Gets smarter every time you use it**

`--fix` applies top suggestions (case-preserving) and persists them to `.spellcorrections` — learned corrections become the top suggestion on future runs:

```bash
$ spellguard --fix doc.md
Fixed 2 misspelling(s) in doc.md
Learned 2 correction(s) to .spellcorrections
```

The loop: `--agent` → apply fixes (or `--fix` directly) → re-run until `# NO ISSUES`. Words you decide to keep get blessed with `--add-word` and never flag again.

## Installation

```bash
npm install -g spellguard    # global CLI
npx spellguard file.md       # or run without installing
npm install -D spellguard    # or as a dev dependency (CI)
```

Requires Node.js 20.6+. One runtime dependency (`typo-js`). No network calls, ever.

## Usage

```bash
spellguard [options] <file>
cat file | spellguard          # stdin
spellguard --fix src/**/*.md   # see Options below
```

### Options

| Option | Effect |
| --- | --- |
| `--fix` | Replace every misspelling with its top suggestion (case-preserving) |
| `--diff` | Preview what `--fix` would do; write nothing |
| `--consistency` | Run terminology checks (`Github` vs `GitHub`, `backend` vs `back-end`) |
| `--agent` | Agent task list: numbered, action-tagged, confidence-ordered |
| `--json` | Structured JSON output |
| `--ignore <a,b,c>` | Words to never flag (repeatable, case-insensitive) |
| `--dict <path>` | Extra wordlist file (repeatable, one word per line) |
| `--add-word <a,b>` | Bless word(s) into the project wordlist and exit |
| `--generate-dict` | Bless every word the current run flagged, exit 0 |
| `--markdown` | Force Markdown mode (auto-enabled for `.md`/`.markdown`/`.mdx`) |
| `--min-length <n>` | Skip words shorter than n characters |
| `--no-repo-vocab` | Don't derive vocabulary from the surrounding project |
| `--repo-root <dir>` | Project root for repo vocabulary (default: cwd) |
| `--vocab-count <n>` | Occurrences needed to bless a code word (default: 3) |
| `--corrections <path>` | Learned-corrections file (default: `.spellcorrections`) |
| `--verbose` | Print repo-vocabulary stats to stderr |
| `-h`, `--help` | Show help |

### Exit codes

`0` clean · `1` issues found · `2` usage/IO error — so `spellguard . || echo typos` just works in scripts and CI.

## Fine-tuning (when you need it)

**Project wordlist** — `.spelldict` in your repo, picked up automatically:

```
# .spelldict
MyCompanyName
kubernetes
```

**Inline directives** — anywhere in a line, any language's comments:

```js
teh spellcheck:disable-line          // this line is skipped
// spellcheck:disable-next-line
teh                                  // skipped
// spellcheck:off
teh                                  // skipped
// spellcheck:on
teh                                  // flagged again
```

**Auto-skipped noise** — URLs, emails, hex hashes, version numbers, and a built-in supplement of ~200 common tech words hunspell lacks (`config`, `auth`, `msg`, `roadmap`, ...). `don't` is checked as-is; `Node.js` is validated segment by segment.

## How it works

1. Reads the file (or stdin) as UTF-8
2. Harvests repo vocabulary: trusted manifest words + code/filename words at 3+ occurrences
3. Preprocesses: Markdown blanking (line numbers preserved), `spellcheck:` directives, noise stripping (URLs, emails, hex)
4. Checks tokens: whole token first (`well-known`, `don't` pass), then identifier sub-words — against the US English dictionary, your wordlist, repo vocabulary, and the tech-word supplement
5. Ranks suggestions with a SymSpell deletion index (~120k words, Damerau-Levenshtein + frequency)
6. Optionally runs the consistency lint over the same tokens
7. Aggregates by word with line numbers

## Comparison

| | spellguard | aspell | codespell / typos | cspell |
| --- | --- | --- | --- | --- |
| Catches unknown typos | ✅ | ✅ | ❌ (known list only) | ✅ |
| Learns project vocabulary automatically | ✅ | ❌ | ❌ | ❌ (manual config) |
| Terminology-consistency lint | ✅ | ❌ | ❌ | ❌ |
| Suggestion quality (edit distance + frequency) | ✅ SymSpell | ✅ | n/a | Hunspell-style |
| False positives out of the box | low | medium | low | high |
| Agent-friendly output + learning loop | ✅ | ❌ | partial | ❌ |
| Runs fully local, deterministic | ✅ | ✅ | ✅ | ✅ |

## Development

```bash
git clone https://github.com/ashusevim/spellguard.git
cd spellguard
npm install
npm test          # 104 tests, Node's built-in runner, zero test dependencies
npm run build     # compile dist/ (TypeScript is a devDependency only)
npm publish       # runs tests + build via prepublishOnly
```

Source layout: `checker.ts` (scanning + preprocessing) · `symspell.ts` (suggestion engine) · `consistency.ts` (terminology lint) · `repo-vocab.ts` (repo vocabulary) · `markdown.ts` (Markdown preprocessing) · `techdict.ts` (tech-word supplement) · `wordlist.ts` (wordlists + learned corrections) · `index.ts` (CLI).

## Roadmap

- Custom brand/terminology lists
- Multiple files / glob patterns with directory walking
- `spellguard.json` config file
- Interactive mode (aspell-style y/n/a)
- Additional locales (en_GB and beyond)
- GitHub Action + pre-commit recipe

## License

MIT
