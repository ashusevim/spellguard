# TypeScript Spell Checker

A command-line spell checker built with TypeScript that analyzes text files and provides spelling suggestions. Dictionary recall with a zero-config, low-false-positive experience — fully local, one runtime dependency.

Runs directly on Node.js — no build step, no transpiler.

## Features

- **Accurate spell checking** using the US English dictionary
- **Line number tracking** for misspelled words
- **Smart suggestions** with up to 3 alternatives per word
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
| `-h`, `--help` | Show help |

### Project wordlist

A `.spelldict` file in the current directory is loaded automatically (one word per line, `#` comments allowed). Words are matched case-insensitively:

```
# .spelldict
kubernetes
Kubernetes   # duplicate, ignored
MyCompanyName
```

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
2. **Noise filtering**: strips URLs, emails, `0x` hex, and long hex runs per line
3. **Directives**: applies `spellcheck:` inline directives before scanning
4. **Word cleaning**: strips punctuation while preserving apostrophes; skips pure numbers
5. **Dictionary check**: validates words against the US English dictionary (typo-js, preloaded synchronously) plus the project wordlist
6. **Suggestion generation**: provides up to 3 alternatives per misspelling
7. **Result aggregation**: groups the same misspelling across multiple lines

## Development

The logic lives in `checker.ts` (library), `index.ts` (CLI), and `wordlist.ts` (wordlist file handling).

Run the test suite (Node's built-in test runner, zero test dependencies):

```bash
npm test
```

## Roadmap

- SymSpell-based suggestion engine (better ranking than Hunspell-style suggesters)
- camelCase / snake_case identifier splitting for source code
- Markdown mode (skip fenced code blocks, inline code, links)
- `--fix` with `--diff` preview

## License

MIT License - feel free to use this project for learning and development.
