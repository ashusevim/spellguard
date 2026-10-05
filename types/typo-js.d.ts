// Minimal type declarations for typo-js (replaces @types/typo-js).
declare module "typo-js" {
  export default class Typo {
    constructor(
      dictionaryName: string,
      affData?: string,
      wordsData?: string,
      settings?: { dictionaryPath?: string },
    );
    /** Returns true if the word is spelled correctly. */
    check(word: string): boolean;
    /** Returns up to `limit` suggestions for a misspelled word. */
    suggest(word: string, limit?: number): string[];
    /** Raw dictionary table (word -> affix codes); object in typo-js < 1.3, Map in >= 1.3. */
    dictionaryTable?: Record<string, unknown> | Map<string, unknown>;
  }
}
