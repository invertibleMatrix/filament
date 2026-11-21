// @ts-check
// Short-text helpers shared by everything that prints a preview: one line, one ellipsis, one place.

/** Collapse whitespace runs to one space and trim. @param {unknown} s */
export const squash = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();

/** Cut to at most `n` characters, the last one an ellipsis when anything was dropped. @param {string} s @param {number} n */
export const cut = (s, n) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

/** A one-line preview of any text: squashed, then cut. @param {unknown} s @param {number} n */
export const clip = (s, n) => cut(squash(s), n);

/** A word with its article, as a sentence names one of a kind: a builder, an explorer. @param {string} word */
export const aOrAn = (word) => `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;

/**
 * A name's possessive, as a sentence says it: "Methodical's", and an apostrophe alone after a name that ends in s —
 * "BugHunters'", "Builders'". The page's copy is ui/harness/lib/labels.js's, pinned equal by test/bughunters.test.js.
 * @param {string} name
 */
export const possessive = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/**
 * Cut a stored text to `max` characters and say how much was dropped, so a reader of the record knows the body is
 * incomplete and by how much. Anything that is not a string passes through untouched.
 * @template T
 * @param {T} s
 * @param {number} max
 * @returns {T | string}
 */
export const truncateMarked = (s, max) =>
  typeof s === "string" && s.length > max ? `${s.slice(0, max)}…[truncated ${s.length - max} chars]` : s;

// Cuts to a byte budget: what one tool result may carry into a model's window is counted in UTF-8 bytes, and a cut
// never lands inside a character — half a character reads as garbage, and half a surrogate pair is not text at all.
const UTF8 = new TextEncoder();
const FROM_UTF8 = new TextDecoder();
/** Whether a byte continues a UTF-8 character, so a cut there would split it. @param {number} b */
const continues = (b) => (b & 0xc0) === 0x80;

/** The start of a text within `budget` UTF-8 bytes, never ending inside a character. @param {string} s @param {number} budget */
export function headBytes(s, budget) {
  const bytes = UTF8.encode(s);
  if (bytes.length <= budget) return s;
  let end = Math.max(0, Math.floor(budget));
  while (end > 0 && continues(bytes[end])) end--;
  return FROM_UTF8.decode(bytes.subarray(0, end));
}

/** The end of a text within `budget` UTF-8 bytes, never starting inside a character. @param {string} s @param {number} budget */
export function tailBytes(s, budget) {
  const bytes = UTF8.encode(s);
  if (bytes.length <= budget) return s;
  let start = bytes.length - Math.max(0, Math.floor(budget));
  while (start < bytes.length && continues(bytes[start])) start++;
  return FROM_UTF8.decode(bytes.subarray(start));
}

/** The first `n` UTF-16 units of a text, one fewer when the cut would split a surrogate pair. @param {string} s @param {number} n */
export function headChars(s, n) {
  if (s.length <= n) return s;
  const last = s.charCodeAt(n - 1);
  return s.slice(0, last >= 0xd800 && last <= 0xdbff ? n - 1 : n);
}

/** The last `n` UTF-16 units of a text, one fewer when the cut would split a surrogate pair. @param {string} s @param {number} n */
export function tailChars(s, n) {
  if (s.length <= n) return s;
  const first = s.charCodeAt(s.length - n);
  return s.slice(first >= 0xdc00 && first <= 0xdfff ? s.length - n + 1 : s.length - n);
}

/**
 * A wait or an age in the words Filament says it in: seconds under two minutes, else minutes — "8 s", "4 min". A moment
 * is "1 s", never "0 s". @param {number} ms
 */
export const durationWords = (ms) => (ms < 120_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);

/** How long something is kept, in the words Filament says it in: days from two days up, else hours — "7 days", "6 hours". @param {number} ms */
export const keptWords = (ms) => (ms >= 48 * 3600_000 ? `${Math.round(ms / (24 * 3600_000))} days` : ms >= 2 * 3600_000 ? `${Math.round(ms / 3600_000)} hours` : durationWords(ms));

/** Words ended as a sentence: a period after them, unless they end one already. @param {string} s */
export const sentence = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** Items as a sentence lists them: "a", "a and b", "a, b and c" — or with `last` in place of "and". @param {readonly string[]} items @param {string} [last] */
export const listed = (items, last = "and") => (items.length > 1 ? `${items.slice(0, -1).join(", ")} ${last} ${items.at(-1)}` : items.join(""));

/** Streamed characters as tokens, in words, at the prose rate: "about 2,750 tokens". @param {number} chars */
export const aboutTokens = (chars) => `about ${Math.max(1, Math.round(chars / 4)).toLocaleString("en-US")} tokens`;

/** Levenshtein distance, for a "did you mean": the fewest letters added, dropped or changed between two words. @param {string} a @param {string} b */
export function editDistance(a, b) {
  const m = a.length,
    n = b.length;
  if (!m || !n) return m + n;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

const HTML_ENTITY = /&(quot|apos|amp|lt|gt|nbsp|#\d+|#x[0-9a-f]+);/i;
const HTML_TAG = /<\/?[a-z][a-z0-9-]*(\s[^<>]*)?\/?>/i;
const CODE_OPERATORS = /=>|->|::|!==|===|&&|\|\||\+=|-=|\$\{/;
const CODE_OPENING = /^(export|import|const|let|var|function|return|class|def|async|await|if|for|while|switch|try|catch|else)\b/;
const METHOD_CALL = /\b[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\(/;
// A token is a word when it is letters in any script, a number, or a path/URL — each allowed the punctuation a
// sentence hangs on it (an opening bracket or quote before, a comma, period, bracket or quote after).
const LEAD = "[(\\[\"'“‘`]*";
const TAIL = "[.,:;!?)\\]\"”’`]*";
const WORD = new RegExp(`^${LEAD}\\p{L}[\\p{L}\\p{M}'’-]*${TAIL}$`, "u");
const NUMBER = new RegExp(`^${LEAD}\\p{N}[\\p{N}.,%]*${TAIL}$`, "u");
const PATH = new RegExp(`^${LEAD}(?:[A-Za-z][A-Za-z0-9+.-]*://\\S+|(?:[A-Za-z]:)?[\\w.~-]*[\\\\/][\\w.~\\\\/-]+)${TAIL}$`);
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
const STATEMENT_END = /;$|^[{}]$/;

/**
 * Whether a candidate memory text is a fragment of code or markup rather than a sentence in words — an HTML entity
 * or tag, a code opening keyword with code punctuation, a single token (a bare identifier, path or JSON blob; a
 * sentence in a script written without spaces is not), or a string whose tokens are mostly not words. Between
 * half and three-quarters words, the code signs decide: an operator, a method call, a statement terminator, symbol
 * density. A sentence that quotes a path, a command or a method call in passing stays a sentence.
 * @param {unknown} text
 */
export function looksLikeCode(text) {
  const t = squash(text);
  if (!t) return true;
  if (HTML_ENTITY.test(t) || HTML_TAG.test(t)) return true;
  if (CODE_OPENING.test(t) && /[=(){};]/.test(t)) return true;
  const tokens = t.split(" ");
  if (tokens.length < 2) return !NO_SPACE_SCRIPT.test(t);
  const words = tokens.filter((w) => WORD.test(w) || NUMBER.test(w) || PATH.test(w)).length;
  const ratio = words / tokens.length;
  if (ratio < 0.5) return true;
  if (ratio >= 0.75) return false;
  if (CODE_OPERATORS.test(t)) return true;
  if (METHOD_CALL.test(t) && ratio < 0.6) return true;
  if (tokens.some((w) => STATEMENT_END.test(w))) return true;
  const symbols = (t.match(/[{}();<>[\]=|\\]/g) || []).length;
  return ratio < 0.6 && symbols >= 3 && symbols / t.length > 0.05;
}
