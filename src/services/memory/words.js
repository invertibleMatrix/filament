// @ts-check
// Memory's words in any script (the memory plan's c1): what a word is, by Unicode's letters, marks and digits, never by
// a language's alphabet — an ASCII-only reading dropped every word with another letter in it (Urdu, Russian, Chinese,
// German "gelöst"), so a message in them searched for nothing and its claims all shared one empty key. No language is
// detected and no word list is kept: the rules go by script, and an ASCII text reads by `[a-z0-9]` alone.
//
// Scripts written without spaces between words (Han, kana, Thai, Lao, Khmer, Myanmar) have no word to split on: a run
// of them is read as its overlapping pairs of characters (`pairsOf`) where words are compared, and searched by its
// trigrams (archive.js `fts_tri`).

/**
 * A letter, mark or digit of a script written without spaces between its words, by its Unicode script extensions —
 * those alone: punctuation shares them (`·`, `、` and `。` list Han among theirs).
 */
export const UNSPACED = /(?=[\p{L}\p{M}\p{N}])[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}]/u;
/** Runs of such characters, letters and marks alone. */
const UNSPACED_RUNS = /(?:(?=[\p{L}\p{M}\p{N}])[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}])+/gu;
/** A script whose one character carries a syllable or more (those above and Hangul): two of them make a word. */
const DENSE = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}]/u;

/** Whether a text holds a script written without spaces. @param {string} s */
export const hasUnspaced = (s) => UNSPACED.test(String(s || ""));

/** The fewest characters a word of `w`'s script needs to say something: two in a dense script, three elsewhere. @param {string} w */
export const shortestWord = (w) => (DENSE.test(w) ? 2 : 3);

/**
 * A text lower-cased, its runs of letters, marks and digits kept and everything between them one space: in ASCII,
 * what `[^a-z0-9]+ → " "` gave. @param {unknown} s
 */
export const normWords = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();

/** A run's overlapping pairs of characters; a run of one is itself. @param {string} run */
export function pairsOf(run) {
  const c = [...run];
  if (c.length < 2) return c.length ? [run] : [];
  const out = [];
  for (let i = 0; i + 1 < c.length; i++) out.push(c[i] + c[i + 1]);
  return out;
}

/**
 * The units two texts are compared by, in order: `normWords`' words, each run of an unspaced script in one read as its
 * pairs (`本番へのリリース` → 本番 番へ への …), what stands around such a run a word of its own. @param {unknown} s
 * @returns {string[]}
 */
export function segmentsOf(s) {
  const out = [];
  for (const w of normWords(s).split(" ")) {
    if (!w) continue;
    if (!UNSPACED.test(w)) {
      out.push(w);
      continue;
    }
    let at = 0;
    for (const m of w.matchAll(UNSPACED_RUNS)) {
      const i = /** @type {number} */ (m.index);
      if (i > at) out.push(w.slice(at, i));
      out.push(...pairsOf(m[0]));
      at = i + m[0].length;
    }
    if (at < w.length) out.push(w.slice(at));
  }
  return out;
}

/** Whether a segment says enough to count where texts are compared: a pair of an unspaced script, or a word long enough for its script. @param {string} w */
export const segmentCounts = (w) => w.length >= shortestWord(w) || (UNSPACED.test(w) && [...w].length === 2);

/**
 * The trigrams a search of the trigram index takes for a query's unspaced runs (`fts_tri`): each run of three or more
 * characters as its overlapping threes, each once, in order; runs of two are left to `shortUnspaced`.
 * @param {string} query @returns {string[]}
 */
export function trigramsOf(query) {
  const seen = new Set();
  for (const m of String(query || "").toLowerCase().matchAll(UNSPACED_RUNS)) {
    const c = [...m[0]];
    for (let i = 0; i + 3 <= c.length; i++) seen.add(c.slice(i, i + 3).join(""));
  }
  return [...seen];
}

/** A query's unspaced runs of two characters, which no trigram finds. @param {string} query @returns {string[]} */
export const shortUnspaced = (query) => [...new Set([...String(query || "").toLowerCase().matchAll(UNSPACED_RUNS)].map((m) => m[0]).filter((r) => [...r].length === 2))];
