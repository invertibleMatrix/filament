// @ts-check
// The string and template literals of a JavaScript source: what a words test reads. Comments and regular expressions
// are left out (neither is a word a person sees on the page), and a template's `${…}` parts read as "${}", the
// literals inside them listed on their own.

const WORD = /[A-Za-z0-9_$]/;
/** A `/` after one of these words begins a regular expression, not a division. */
const BEFORE_REGEX = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "do", "else", "yield", "await"]);

/**
 * @param {string} src
 * @returns {{ text: string, line: number }[]}  each literal's text as written (escapes kept), and the line it begins on
 */
export function jsStrings(src) {
  /** @type {{ text: string, line: number }[]} */
  const out = [];
  /** @type {number[]} */
  const breaks = [];
  for (let k = src.indexOf("\n"); k >= 0; k = src.indexOf("\n", k + 1)) breaks.push(k);
  const lineOf = (/** @type {number} */ at) => {
    let lo = 0, hi = breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (breaks[mid] < at) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };

  /** Does the `/` at `i` begin a regular expression? By what stands before it. @param {number} i */
  const regexStarts = (i) => {
    let k = i - 1;
    while (k >= 0 && /\s/.test(src[k])) k--;
    if (k < 0) return true;
    const c = src[k];
    if (c === ")" || c === "]" || c === "}") return false;
    if (!WORD.test(c)) return true;
    let j = k;
    while (j >= 0 && WORD.test(src[j])) j--;
    return BEFORE_REGEX.has(src.slice(j + 1, k + 1));
  };

  /** The index after the regular expression that begins at `i`, or `i + 1` where the line ends before it closes. @param {number} i */
  const regex = (i) => {
    let inClass = false;
    for (let k = i + 1; k < src.length; k++) {
      const c = src[k];
      if (c === "\n") return i + 1;
      if (c === "\\") k++;
      else if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        k++;
        while (k < src.length && WORD.test(src[k])) k++;
        return k;
      }
    }
    return i + 1;
  };

  /** A quoted string from its opening quote at `i`. @param {number} i */
  const quoted = (i) => {
    const q = src[i];
    let k = i + 1;
    while (k < src.length && src[k] !== q && src[k] !== "\n") k += src[k] === "\\" ? 2 : 1;
    out.push({ text: src.slice(i + 1, k), line: lineOf(i) });
    return k + 1;
  };

  /** A template literal from its backtick at `i`. @param {number} i @returns {number} */
  const template = (i) => {
    let text = "";
    let k = i + 1;
    while (k < src.length && src[k] !== "`") {
      if (src[k] === "\\") { text += src.slice(k, k + 2); k += 2; }
      else if (src[k] === "$" && src[k + 1] === "{") { text += "${}"; k = code(k + 2, true); }
      else text += src[k++];
    }
    out.push({ text, line: lineOf(i) });
    return k + 1;
  };

  /** Code from `i`: to the source's end, or (`inTemplate`) past the `}` that closes a template's `${`. @param {number} i @param {boolean} inTemplate @returns {number} */
  const code = (i, inTemplate) => {
    let depth = 0;
    while (i < src.length) {
      const c = src[i], d = src[i + 1];
      if (c === "/" && d === "/") { const e = src.indexOf("\n", i); i = e < 0 ? src.length : e; }
      else if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; }
      else if (c === '"' || c === "'") i = quoted(i);
      else if (c === "`") i = template(i);
      else if (c === "/" && regexStarts(i)) i = regex(i);
      else {
        if (inTemplate && c === "{") depth++;
        else if (inTemplate && c === "}") { if (!depth) return i + 1; depth--; }
        i++;
      }
    }
    return i;
  };

  code(0, false);
  return out;
}
