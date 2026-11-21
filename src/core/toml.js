// @ts-check
// A small reader of TOML (HarnessV4_Settings_Plan HS-D76): the part a coding agent's config file uses — tables and
// arrays of tables, dotted and quoted keys, strings (basic, literal, and their multi-line forms), numbers, booleans,
// arrays over several lines and inline tables. A date is kept as its text. What it does not read it names, with the
// line: the caller says the file could not be read and goes on with the others.

/** @param {unknown} v @returns {v is Record<string, any>} */
const isTable = (v) => !!v && typeof v === "object" && !Array.isArray(v);

const BARE = /[A-Za-z0-9_-]/;
/** @type {Record<string, string>} */
const ESCAPES = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };

/**
 * The document a TOML text holds. Throws `line N: why` for anything it does not read.
 * @param {string} text @returns {Record<string, any>}
 */
export function readToml(text) {
  const src = String(text ?? "").replace(/^﻿/, "");
  let i = 0;
  let line = 1;
  /** @type {Record<string, any>} */
  const root = {};
  let table = root;
  /** @param {string} why @returns {never} */
  const fail = (why) => {
    throw new Error(`line ${line}: ${why}`);
  };
  const spaces = () => {
    while (src[i] === " " || src[i] === "\t") i++;
  };
  const comment = () => {
    if (src[i] === "#") while (i < src.length && src[i] !== "\n") i++;
  };
  /** One line's end; false at the text's end. */
  const newline = () => {
    if (src[i] === "\r" && src[i + 1] === "\n") i += 2;
    else if (src[i] === "\n") i++;
    else return false;
    line++;
    return true;
  };
  /** Spaces, comments and line ends, as an array or a blank line has them. */
  const blank = () => {
    for (;;) {
      spaces();
      comment();
      if (!newline()) return;
    }
  };
  /** The end of a key's line: only a comment may follow its value. */
  const lineEnd = () => {
    spaces();
    comment();
    if (i < src.length && !newline()) fail(`more after the value: ${src.slice(i, i + 12)}`);
  };

  const escape = () => {
    const c = src[i + 1];
    i += 2;
    if (c in ESCAPES) return ESCAPES[c];
    if (c === "u" || c === "U") {
      const n = c === "u" ? 4 : 8;
      const hex = src.slice(i, i + n);
      if (!new RegExp(`^[0-9a-fA-F]{${n}}$`).test(hex)) fail(`\\${c} needs ${n} hex digits`);
      i += n;
      return String.fromCodePoint(parseInt(hex, 16));
    }
    return fail(`an escape TOML has not: \\${c ?? ""}`);
  };
  const basic = () => {
    if (src.startsWith('"""', i)) return multiBasic();
    i++;
    let out = "";
    for (;;) {
      const c = src[i];
      if (c === undefined || c === "\n" || c === "\r") fail("a string is not closed on its line");
      if (c === '"') {
        i++;
        return out;
      }
      if (c === "\\") out += escape();
      else {
        out += c;
        i++;
      }
    }
  };
  const multiBasic = () => {
    i += 3;
    newline();
    let out = "";
    for (;;) {
      if (i >= src.length) fail('a """ string is not closed');
      if (src.startsWith('"""', i)) {
        // Up to two quotes may end the string's own text.
        let q = 3;
        while (src[i + q] === '"' && q < 5) q++;
        out += '"'.repeat(q - 3);
        i += q;
        return out;
      }
      if (src[i] === "\\" && /^\\[ \t]*\r?\n/.test(src.slice(i, i + 64))) {
        // A backslash at a line's end: the line break and the spaces after it go.
        i++;
        for (;;) {
          spaces();
          if (!newline()) break;
        }
        continue;
      }
      if (src[i] === "\\") out += escape();
      else if (src[i] === "\n" || (src[i] === "\r" && src[i + 1] === "\n")) {
        out += "\n";
        newline();
      } else out += src[i++];
    }
  };
  const literal = () => {
    if (src.startsWith("'''", i)) {
      i += 3;
      newline();
      const end = src.indexOf("'''", i);
      if (end < 0) fail("a ''' string is not closed");
      let close = end + 3;
      while (src[close] === "'" && close < end + 5) close++;
      const out = src.slice(i, close - 3);
      line += (out.match(/\n/g) || []).length;
      i = close;
      return out.replace(/\r\n/g, "\n");
    }
    i++;
    const end = src.indexOf("'", i);
    const nl = src.indexOf("\n", i);
    if (end < 0 || (nl >= 0 && nl < end)) fail("a string is not closed on its line");
    const out = src.slice(i, end);
    i = end + 1;
    return out;
  };
  /** One part of a key. */
  const keyPart = () => {
    spaces();
    if (src[i] === '"') return basic();
    if (src[i] === "'") return literal();
    const from = i;
    while (i < src.length && BARE.test(src[i])) i++;
    if (from === i) fail(`a key was expected: ${src.slice(i, i + 12) || "the text ended"}`);
    return src.slice(from, i);
  };
  const key = () => {
    const parts = [keyPart()];
    spaces();
    while (src[i] === ".") {
      i++;
      parts.push(keyPart());
      spaces();
    }
    for (const p of parts) if (p === "__proto__") fail("a key Filament does not read: __proto__");
    return parts;
  };
  /** @param {Record<string, any>} at @param {string[]} parts @param {any} v */
  const set = (at, parts, v) => {
    let o = at;
    for (const p of parts.slice(0, -1)) {
      if (o[p] === undefined) o[p] = {};
      else if (!isTable(o[p])) fail(`${parts.join(".")}: ${p} is not a table`);
      o = o[p];
    }
    const last = /** @type {string} */ (parts.at(-1));
    if (Object.hasOwn(o, last)) fail(`${parts.join(".")} is set twice`);
    o[last] = v;
  };
  const value = () => {
    spaces();
    const c = src[i];
    if (c === '"') return basic();
    if (c === "'") return literal();
    if (c === "[") return array();
    if (c === "{") return inline();
    const m = /^[^\s,\]}#]+/.exec(src.slice(i, i + 128));
    if (!m) return fail("a value was expected");
    i += m[0].length;
    const t = m[0];
    if (t === "true") return true;
    if (t === "false") return false;
    const n = t.replace(/_/g, "");
    if (/^[+-]?(0|[1-9]\d*)$/.test(n) || /^[+-]?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(n)) return Number(n);
    if (/^0x[0-9a-fA-F]+$|^0o[0-7]+$|^0b[01]+$/.test(n)) return Number(n);
    if (/^[+-]?(inf|nan)$/.test(n)) return n.endsWith("nan") ? NaN : n.startsWith("-") ? -Infinity : Infinity;
    if (/^\d{4}-\d{2}-\d{2}([Tt ]?[\d:.]+([Zz]|[+-]\d{2}:\d{2})?)?$|^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(t)) return t;
    return fail(`a value Filament does not read: ${t}`);
  };
  const array = () => {
    i++;
    /** @type {any[]} */
    const out = [];
    for (;;) {
      blank();
      if (src[i] === "]") {
        i++;
        return out;
      }
      if (i >= src.length) fail("an array is not closed");
      out.push(value());
      blank();
      if (src[i] === ",") i++;
      else if (src[i] !== "]") fail("an array needs , or ] after a value");
    }
  };
  const inline = () => {
    i++;
    /** @type {Record<string, any>} */
    const out = {};
    spaces();
    if (src[i] === "}") {
      i++;
      return out;
    }
    for (;;) {
      const k = key();
      if (src[i] !== "=") fail("= was expected after a key");
      i++;
      set(out, k, value());
      spaces();
      if (src[i] === ",") i++;
      else if (src[i] === "}") {
        i++;
        return out;
      } else fail("an inline table needs , or } after a value");
    }
  };
  /** The table a header names, made where missing; `[[…]]` adds one to the array there. @param {string[]} parts @param {boolean} many */
  const open = (parts, many) => {
    /** @type {any} */
    let o = root;
    parts.forEach((p, n) => {
      const last = n === parts.length - 1;
      if (last && many) {
        if (o[p] === undefined) o[p] = [];
        if (!Array.isArray(o[p])) fail(`[[${parts.join(".")}]]: ${p} is not an array of tables`);
        o[p].push({});
        o = o[p].at(-1);
        return;
      }
      if (o[p] === undefined) o[p] = {};
      const at = Array.isArray(o[p]) ? o[p].at(-1) : o[p];
      if (!isTable(at)) fail(`[${parts.join(".")}]: ${p} is not a table`);
      o = at;
    });
    return o;
  };

  for (;;) {
    blank();
    if (i >= src.length) return root;
    if (src[i] === "[") {
      const many = src[i + 1] === "[";
      i += many ? 2 : 1;
      const parts = key();
      if (!src.startsWith(many ? "]]" : "]", i)) fail("a table's name is not closed");
      i += many ? 2 : 1;
      table = open(parts, many);
      lineEnd();
      continue;
    }
    const k = key();
    if (src[i] !== "=") fail("= was expected after a key");
    i++;
    set(table, k, value());
    lineEnd();
  }
}
