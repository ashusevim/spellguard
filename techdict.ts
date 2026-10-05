/**
 * Supplement dictionary: common tech and dev-prose words that hunspell's
 * en_US dictionary is missing. Matched case-insensitively as valid words.
 *
 * Scope: words that appear constantly in technical writing and are
 * genuinely correct spellings ("config", "msg", "auth", "roadmap",
 * "transpiler", file extensions, spell-checker tool names). Deliberately
 * excludes anything ambiguous or generic enough to be misspelled often.
 */
export const TECH_WORDS: ReadonlySet<string> = new Set(
  `
  app apps api apis arg args aspell auth bool bugfix changelog charset checksum
  chmod cli cmdline codebase codespell config configs cookie cors cpu cron crud
  csv cspell cwd datetime dbg desc dev diff dir dns docstring docs dotfile
  dotfiles dotenv dup endpoint endpoints enum enums env errno filepath filetype
  frontend git github gitlab glob graphql gui gzip hexdump homebrew hostname
  hotfix http https hunspell idx impl infra ini ispell jpeg jpg js json jsx kebab
  localhost lockfile lsp markdown mjs middleware monorepo msg multiline myspell
  namespace nodejs npm nullable nspell oauth param params png polyfill popup
  prepublish pubsub py pyproject readme regex regexes refactor refactored repo
  repos retarget roadmap rollback runtime scaffold scrollbar sdk serde shebang
  sidebar spellguard sqlite stacktrace stdin stdout stderr subdir subcommand
  subdirectory svg symlink tcp tls tmp todo todos tokenizer toolchain tooltip
  transpile transpiled transpiler tsconfig tsx txt typescript utf utf8 uuid vcs
  vscode webpack websocket wifi wildcard workflow workflows xml yaml yml zlib
  zsh
  js ts jsx tsx mjs cjs py rb rs go sh md html css sql php kt swift toml tsv
  `
    .split(/\s+/)
    .filter((word) => word !== ""),
);
