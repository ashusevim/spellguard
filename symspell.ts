/**
 * SymSpell-style symmetric delete spelling correction.
 *
 * Index: every vocabulary word plus all its variants with up to
 * `indexDistance` characters deleted, keyed by the deletion string.
 * Lookup: generate deletion variants of the query up to `maxEditDistance`
 * and intersect. A collision proves the true Damerau-Levenshtein distance
 * is at most indexDistance + maxEditDistance; candidates are verified with
 * an exact DL computation and ranked.
 *
 * The default (index 1, query 2) guarantees every distance-1 correction and
 * most distance-2 corrections, with an index small enough to build at CLI
 * startup (~1s). Set indexDistance = maxEditDistance for the full guarantee
 * at roughly 5x the build cost.
 *
 * Reference: https://github.com/wolfgarbe/SymSpell
 */

export interface SymSpellOptions {
  /** Deletion depth used for the precomputed index (default: 1). */
  indexDistance?: number;
  /** Ranking boost: words in this set win ties at equal edit distance. */
  commonWords?: Set<string>;
  /** Optional validator; candidates failing it are dropped. */
  isValid?: (word: string) => boolean;
}

export class SymSpell {
  private readonly max: number;
  private readonly indexDistance: number;
  private readonly index = new Map<string, string[]>();
  private readonly commonWords: Set<string>;
  private readonly isValid: (word: string) => boolean;

  constructor(vocabulary: string[], maxEditDistance = 2, options: SymSpellOptions = {}) {
    this.max = maxEditDistance;
    this.indexDistance = Math.min(options.indexDistance ?? 1, maxEditDistance);
    this.commonWords = options.commonWords ?? new Set();
    this.isValid = options.isValid ?? (() => true);

    for (const raw of vocabulary) {
      const word = raw.toLowerCase();
      // Only suggest-able tokens: letters and apostrophes, at least 2 chars.
      if (!/^[a-z][a-z']+$/.test(word)) continue;
      for (const deletion of this.deletions(word, this.indexDistance)) {
        // Duplicate entries per key are fine: candidates are deduped at
        // query time in a Set, so buckets skip the dedup cost.
        let bucket = this.index.get(deletion);
        if (!bucket) this.index.set(deletion, (bucket = []));
        bucket.push(word);
      }
    }
  }

  /**
   * All variants of `word` with 0..depth characters deleted.
   * Duplicates (words with repeated letters) are harmless: query-time
   * candidate collection dedups via a Set.
   */
  private deletions(word: string, depth: number): string[] {
    const variants: string[] = [word];
    for (let i = 0; i < word.length; i++) {
      const once = word.slice(0, i) + word.slice(i + 1);
      variants.push(once);
      if (depth >= 2) {
        for (let j = i; j < once.length; j++) {
          variants.push(once.slice(0, j) + once.slice(j + 1));
        }
      }
    }
    return variants;
  }

  /** Returns up to `limit` suggestions, best first (distance, commonality, length). */
  suggest(word: string, limit: number): string[] {
    const query = word.toLowerCase();
    if (query.length < 2) return [];

    const candidates = new Set<string>();
    for (const deletion of this.deletions(query, this.max)) {
      const bucket = this.index.get(deletion);
      if (bucket) for (const c of bucket) candidates.add(c);
    }
    candidates.delete(query);

    const scored: { word: string; distance: number }[] = [];
    for (const candidate of candidates) {
      const distance = damerauLevenshtein(query, candidate, this.max);
      if (distance <= this.max && this.isValid(candidate)) {
        scored.push({ word: candidate, distance });
      }
    }

    scored.sort(
      (a, b) =>
        a.distance - b.distance ||
        Number(this.commonWords.has(b.word)) - Number(this.commonWords.has(a.word)) ||
        Math.abs(a.word.length - query.length) - Math.abs(b.word.length - query.length) ||
        a.word.localeCompare(b.word),
    );
    return scored.slice(0, limit).map((s) => s.word);
  }
}

/** Damerau-Levenshtein distance (optimal string alignment), with early abandon above `max`. */
export function damerauLevenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;

  const alen = a.length;
  const blen = b.length;
  const rows: number[][] = [];
  rows[0] = Array.from({ length: blen + 1 }, (_, i) => i);

  for (let i = 1; i <= alen; i++) {
    const prev = rows[i - 1];
    const prevPrev = i > 1 ? rows[i - 2] : null;
    const cur = new Array<number>(blen + 1).fill(0);
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= blen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prevPrev && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prevPrev[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    rows[i] = cur;
    if (rowMin > max) return max + 1;
  }
  return rows[alen][blen];
}

/**
 * Small set of very common English words used to break ranking ties at
 * equal edit distance, so "teh" suggests "the" instead of "tech".
 */
export const COMMON_WORDS = new Set(
  `the be to of and a in that have it for not on with he as you do at this but his by from
  they we say her she or an will my one all would there their what so up out if about who
  get which go me when make can like time no just him know take people into year your good
  some could them see other than then now look only come its over think also back after use
  two how our work first well way even new want because any these give day most us is was
  are been has had were said did having may should each such where much before right too
  old same tell does set three must state never become between high really something
  receive separate exist success occurred definitely word words world spelling account
  tomorrow calendar guarantee maintenance problem system program different important
  information government development experience community business service research
  `
    .split(/\s+/)
    .filter((w) => w !== ""),
);
