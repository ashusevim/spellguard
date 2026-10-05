# TypeScript Spell Checker

A command-line spell checker built with TypeScript that analyzes text files and provides spelling suggestions using the [Typo.js](https://github.com/cfinke/Typo.js) library.

Runs directly on Node.js — no build step, no transpiler.

## Features

- **Accurate spell checking** using the US English dictionary
- **Line number tracking** for misspelled words
- **Smart suggestions** with up to 3 alternatives per word
- **Apostrophe-aware** — `don't` is checked as-is, not stripped to `dont`
- **Duplicate detection** consolidates repeated misspellings across lines
- **JSON output** (`--json`) for scripting
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
node index.ts <file-to-check>

# JSON output for scripting
node index.ts --json <file-to-check>
```

### Examples

```bash
# Check a document
node index.ts document.txt

# Check a markdown file
node index.ts README.md

# Use in a script and react to the exit code
node index.ts notes.txt || echo "found misspellings"
```

### Sample Output

```
'recieve' is misspelled on line(s): 1. Suggestions: relieve, receive, recipe
'gooattty' is misspelled on line(s): 1.
```

Or when no errors are found:

```
No errors, everything is good
```

### JSON Output

```json
{
  "misspellings": [
    {
      "word": "recieve",
      "lines": [1],
      "suggestions": ["relieve", "receive", "recipe"]
    }
  ]
}
```

## How It Works

1. **File reading**: reads the specified file as UTF-8
2. **Text parsing**: splits content into lines and extracts individual words
3. **Word cleaning**: strips punctuation while preserving apostrophes; skips pure numbers
4. **Dictionary check**: validates each word against the US English dictionary (typo-js, with dictionary data preloaded synchronously)
5. **Suggestion generation**: provides up to 3 alternatives per misspelling
6. **Result aggregation**: groups the same misspelling across multiple lines

## Development

The logic lives in `checker.ts` (library) and `index.ts` (CLI wrapper).

Run the test suite (Node's built-in test runner, zero test dependencies):

```bash
npm test
```

## License

MIT License - feel free to use this project for learning and development.
