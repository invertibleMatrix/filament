// @ts-check
// No `:has()` before a combinator in Filament's stylesheets (the owner's 10-24: typing lagged, "infact the whole harness
// is lagging"). Measured on a chat whose running turn held 1,800 steps: with a rule like `.zc-dialog:has(> .cc) >
// :first-child` beside one whose `:has()` any new element might change (`:has(> *)`), every element added anywhere —
// each event of a running turn, each key the composer redraws for — had Chromium restyle the page's elements, 48 ms
// each time; with `:has()` only in the part a rule styles (`.x:has(…)`, `.y:has(~ .z)`), 0.1 ms. A rule that needs a
// condition further up is written with a class of the element's own (`.zc-menu-item.has-desc`), a sibling selector,
// or a custom property its container sets and a style query reads.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UI = join(ROOT, "src", "ui");

/** Every stylesheet under src/ui, the vendored ones aside. @param {string} dir @returns {string[]} */
function sheets(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "vendor" ? [] : sheets(p);
    return e.name.endsWith(".css") ? [p] : [];
  });
}

/** The selectors of a stylesheet: each rule's prelude, split at its top-level commas. @param {string} css */
export function selectorsOf(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  /** @type {string[]} */
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== "{" && c !== "}" && c !== ";") continue;
    const prelude = text.slice(start, i).trim();
    start = i + 1;
    if (c !== "{" || !prelude || prelude.startsWith("@")) continue;
    // A declaration block's property (`a: b;` before a nested rule) is no selector; nor a keyframe's step.
    if (/^(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+(\.\d+)?%))*$/.test(prelude)) continue;
    out.push(...splitTop(prelude, ","));
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

/** `s` cut at each `sep` outside brackets. @param {string} s @param {string} sep */
function splitTop(s, sep) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === sep && depth === 0) {
      parts.push(s.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(s.slice(from));
  return parts;
}

/** Whether a selector holds a `:has()` before its last combinator: in a part it does not style. @param {string} sel */
export function hasBeforeCombinator(sel) {
  const s = sel.trim().replace(/\s*([>+~])\s*/g, "$1").replace(/\s+/g, " ");
  let depth = 0;
  let last = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && (c === " " || c === ">" || c === "+" || c === "~")) last = i;
  }
  const at = s.indexOf(":has(");
  return at >= 0 && at < last;
}

test("the check: a :has() in the part a rule styles passes, one further up does not", () => {
  assert.equal(hasBeforeCombinator(".zc-dialog:has(> .cc) > :first-child"), true);
  assert.equal(hasBeforeCombinator(".zc-menu-item:has(.zc-menu-desc) .zc-menu-ic svg"), true);
  assert.equal(hasBeforeCombinator(".inst-row:has(> .inst-row-ic) + .inst-row:has(> .inst-row-ic)::before"), true);
  assert.equal(hasBeforeCombinator(".zc-popover:has(> .widget-panel)"), false);
  assert.equal(hasBeforeCombinator(".a-md.streaming:not(:has(> *))::after"), false);
  assert.equal(hasBeforeCombinator(".frame > .transcript:has(~ .empty-chat.has-board:not(.hidden))"), false);
  assert.equal(hasBeforeCombinator(".zc-menu-item .zc-menu-text:has(.zc-menu-desc)"), false);
  assert.equal(hasBeforeCombinator('[title~="a b"] .x'), false);
  assert.deepEqual(selectorsOf("/* a, b { } */ .a, .b:has(> i) { x: 1; } @media (max-width: 9px) { .c > .d { y: 2; } } @keyframes k { from { o: 0; } 50% { o: 1; } }"),
    [".a", ".b:has(> i)", ".c > .d"]);
});

test("no stylesheet under src/ui has a :has() before a combinator", () => {
  const found = sheets(UI).flatMap((f) =>
    selectorsOf(readFileSync(f, "utf8")).filter(hasBeforeCombinator).map((s) => `${relative(ROOT, f).replace(/\\/g, "/")}: ${s}`));
  assert.ok(sheets(UI).length > 10, "the stylesheets are found");
  assert.deepEqual(found, []);
});
