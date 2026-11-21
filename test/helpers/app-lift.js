// @ts-check
// The harness page's own functions, lifted out of app.js and run against a test's stand-ins (as status-goal-looks and
// others lift one function by hand). app.js boots the whole page as it loads, so its functions are read from its text:
// each named one, whole, then run inside a scope that hands them the test's names and, for any other name the page
// would reach, a stand-in that takes every call and every property and does nothing — the page's globals (`Date`,
// `Promise`, `encodeURIComponent`) stay the real ones.
import { readFileSync } from "node:fs";

export const APP_SRC = readFileSync("src/ui/harness/app.js", "utf8");

/** A stand-in for anything: callable, every property another, never a promise. @type {any} */
export const NOOP = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive ? () => "" : NOOP),
  apply: () => NOOP,
  construct: () => NOOP,
});

/**
 * The text of a top-level function, `const` or `let` of app.js, whole: a function to the lone `}` that closes it, a
 * value to its line's `;`, or to the lone `};` that closes it.
 * @param {string} name @param {string} [src]
 */
export function sourceOf(name, src = APP_SRC) {
  const heads = [`\nasync function ${name}(`, `\nfunction ${name}(`, `\nconst ${name} = `, `\nlet ${name} = `];
  const at = heads.map((h) => src.indexOf(h)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (at == null) throw new Error(`app.js has no ${name}`);
  const from = at + 1;
  const firstLine = src.slice(from, src.indexOf("\n", from));
  const value = /^(const|let) /.test(firstLine);
  if (value && firstLine.trimEnd().endsWith(";")) return firstLine;
  const close = value ? "\n};\n" : "\n}\n";
  const end = src.indexOf(close, from);
  if (end < 0) throw new Error(`app.js's ${name} does not end`);
  return src.slice(from, end + close.length - 1);
}

/**
 * The named functions and values of app.js, run in a scope of the test's names: `scope` gives what they read and write
 * (a name they assign that `scope` holds lands on it), every other name not a global is `NOOP`. Returns the named ones as
 * they stand once lifted (a function, or a value as it was declared). A name ending in `?` is lifted where app.js has
 * it — a helper the page's older text did not have, so a test runs against that text too and fails on what it pins.
 * @param {string[]} wanted @param {Record<string, any>} scope
 * @returns {Record<string, any>}
 */
export function lift(wanted, scope) {
  const has = (/** @type {string} */ n) => [`\nasync function ${n}(`, `\nfunction ${n}(`, `\nconst ${n} = `, `\nlet ${n} = `].some((h) => APP_SRC.includes(h));
  const names = wanted.filter((n) => !n.endsWith("?") || has(n.slice(0, -1))).map((n) => n.replace(/\?$/, ""));
  const body = names.map((n) => sourceOf(n)).join("\n");
  const room = new Proxy(scope, {
    has: (t, k) => k in t || !(k in globalThis),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[/** @type {any} */ (k)] : NOOP),
    set: (t, k, v) => ((t[/** @type {any} */ (k)] = v), true),
  });
  // eslint-disable-next-line no-new-func
  const make = new Function("room", `with (room) {\n${body}\nreturn { ${names.join(", ")} };\n}`);
  return make(room);
}
