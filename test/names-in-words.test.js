// @ts-check
// HarnessV3-Launch F14: one way to name a preset and a session, on every screen. A preset in words is Title case:
// there are no presets now (the owner's of 11-07), and a settings card kept from before says the one it names so, in
// the words that say where a setting came from. A session in words is its title, else its first
// message, else "Untitled session", as the harness's sidebar reads it: the console's Home, Memory → Sessions (the
// list, the detail and its export) and the lineage graph, whose nodes now carry the first message.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { presetWords, sessionWords } from "../src/ui/lib/format.js";
import { sourceWords } from "../src/ui/harness/lib/labels.js";

const read = (/** @type {string} */ f) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", f), "utf8");

// (fails before: yes — neither helper existed; the harness's Start board had its own `titled`, the console none)
test("presetWords: a preset's name in Title case, the rest as stored; nothing for no name", () => {
  assert.equal(presetWords("balanced"), "Balanced");
  assert.equal(presetWords("my-fast_2"), "My-fast_2", "a saved name: its first letter");
  assert.equal(presetWords("Balanced"), "Balanced");
  for (const none of ["", null, undefined]) assert.equal(presetWords(none), "", String(none));
});

test("sessionWords: a session's title, else its first message, else Untitled session", () => {
  assert.equal(sessionWords({ title: "Fix the login bug", preview: "fix the login bug please" }), "Fix the login bug");
  assert.equal(sessionWords({ title: null, preview: "why does the tray restart twice?" }), "why does the tray restart twice?", "untitled: its first message, as the harness's sidebar reads it");
  assert.equal(sessionWords({ title: "", preview: "" }), "Untitled session");
  assert.equal(sessionWords({}), "Untitled session");
  assert.equal(sessionWords(null), "Untitled session");
});

// (fails before: yes — "preset max", where the Start board said "preset Max"; now a card kept from before presets went)
test("where a setting came from names its preset in words", () => {
  assert.equal(sourceWords("preset", "max"), "preset Max");
  assert.equal(sourceWords("preset"), "the applied preset");
});

test("every console surface that names a session says its words", () => {
  const home = read("src/ui/pages/home.js");
  assert.match(home, /h\("td", \{\}, h\("b", \{\}, sessionWords\(s\)\),/, "Home's Where you left off");
  const mem = read("src/ui/pages/memory.js");
  assert.match(mem, /h\("b", \{\}, sessionWords\(s\)\),/, "Memory → Sessions' list");
  assert.match(mem, /h\("h2", \{ style: "margin:0" \}, sessionWords\(ch\)\)/, "its detail");
  assert.match(mem, /const md = \[`# \$\{sessionWords\(ch\)\} \(\$\{ch\.id\}\)`/, "its export");
  const app = read("src/ui/app.js");
  assert.match(app, /el\("text", \{ x: 10, y: 35 \}, sessionWords\(n\)\.slice\(0, 22\)\)/, "the lineage graph");
  for (const [f, src] of [["home", home], ["memory", mem], ["app", app]])
    assert.doesNotMatch(src, /\.title \|\| "[Uu]ntitled/, `${f}: no session named its own way`);
});
