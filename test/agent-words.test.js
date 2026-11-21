// @ts-check
// HarnessV4_Tasks E15 step 5 (AG-145, AG-146), then proposal_ux N2 (10-18): one word for an agent on the harness page.
// An agent beside the main one is a sub-agent (its tab is Sub Agents, the owner's name), or an "agent" where nothing
// else is in view; a team's stay "workers"; the models they run on are seats. E15 had made them "agents on the side",
// which the owner did not understand. This reads every string the page's own modules and the shared parts it draws
// hold — comments and regular expressions are not words a person sees. The code keeps its own names (`/subagent`,
// `subagents.pool`, routes, class names), and the task graph's `by` value stays the server's. The proxy console's own
// pages are not read: they describe Filament's parts by the names its settings keep.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { jsStrings } from "./helpers/js-strings.js";

const UI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ui");

/** Every file of a kind under `dir`, the vendored ones left out. @param {string} dir @param {string} [ext] @param {string[]} [out] @returns {string[]} */
const modules = (dir, ext = ".js", out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "vendor") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) modules(p, ext, out);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
};
const name = (/** @type {string} */ p) => relative(UI, p).replaceAll("\\", "/");

/** The harness page's own modules, and the shared parts it draws. */
const FILES = [...modules(join(UI, "harness")), ...modules(join(UI, "lib"))].sort();

test("the lexer reads what a person can be shown: strings and templates, never a comment or a regular expression", () => {
  const src = [
    "// a comment's \"quoted words\"",
    "const a = \"one\"; /* 'two' in a block */ const b = 'three';",
    "const c = `four ${d ? \"five\" : `six ${e}`} seven`;",
    "const r = /\"eight\"|[/\"]nine/.test(x) ? x / 2 : \"ten\";",
    "return /'eleven'/;",
  ].join("\n");
  assert.deepEqual(jsStrings(src).map((s) => [s.text, s.line]), [["one", 2], ["three", 2], ["five", 3], ["six ${}", 3], ["four ${} seven", 3], ["ten", 4]]);
});

// (fails before: yes — the lists of models were "Agents on the side" and "Workers", and the agents themselves "agents
// on the side" in a dozen strings: the owner's question of 10-18, "what is that agents on the side mean?" — proposal_ux
// N2 names them sub-agents, their lists seats. "Ask on the side" is an act, and stays.)
test("no string of the harness page names an agent \"on the side\": a sub-agent, its lists of models seats", () => {
  /** @type {string[]} */
  const found = [];
  for (const f of FILES) {
    for (const s of jsStrings(readFileSync(f, "utf8"))) {
      // Settings search keeps the old words, so a person who remembers them still finds the row.
      if (/\bagents? on the side\b/i.test(s.text) && !/^side pool model /.test(s.text)) found.push(`${name(f)}:${s.line}: ${s.text}`);
    }
  }
  assert.deepEqual(found, []);
  const shell = readFileSync(join(UI, "harness.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
  assert.doesNotMatch(shell, /agents? on the side/i, "the page's shell");
  for (const css of [join(UI, "harness.css"), ...modules(join(UI, "harness"), ".css")]) {
    const drawn = (readFileSync(css, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").match(/content:\s*"[^"]*"/g) || []).join("\n");
    assert.doesNotMatch(drawn, /agents? on the side/i, `${name(css)}: no word drawn by a style`);
  }
});

// (fails before: no — the Side tab was built in these words; this holds them: HarnessV4_Tasks E13.7)
test("the Side tab's own words: none of the launcher's (spawn, view, aggressive, moderate, light, deliver, inform)", () => {
  for (const f of ["harness/views/side.js", "harness/lib/side.js"]) {
    const said = jsStrings(readFileSync(join(UI, f), "utf8")).filter((s) => /\b(spawn\w*|views?|aggressive|moderate|light|deliver\w*|inform\w*)\b/i.test(s.text));
    assert.deepEqual(said.map((s) => `${f}:${s.line}: ${s.text}`), []);
  }
});

// (fails before: yes — each of these said "sub-agent")
test("the words where both kinds are in view say which: a sub-agent, the main agent's, a team's workers", async () => {
  const { turnStateWords, settingChangeWords } = await import("../src/ui/harness/lib/labels.js");
  const { leaderState, whoOfTask, carryOnWords } = await import("../src/ui/harness/lib/team.js");
  const { deliveredWords } = await import("../src/ui/harness/conversation/turn.js");
  const { OUTCOME_FILTERS } = await import("../src/ui/lib/outcomes.js");
  const { SECTIONS } = await import("../src/ui/lib/settings/knobs.js");
  assert.deepEqual([turnStateWords({ to: "waiting", why: "its background agents" }), turnStateWords({ to: "waiting", why: "the developer's" }), turnStateWords({ to: "waiting", why: "x" }, true)],
    ["waiting for its agents", "waiting for your agent", "waiting for its workers"]);
  assert.deepEqual([leaderState({ live: false, paused: false, waits: false, atWork: 2, team: false }).title, leaderState({ live: false, paused: false, waits: false, atWork: 2, team: true }).title],
    ["Its agents are at work", "Its workers are at work"]);
  assert.deepEqual([whoOfTask("sub-agent").word, whoOfTask("explorer").word], ["Agent", "Explorer"]);
  assert.equal(carryOnWords("t3", { resumes: null, crew: "agent" }), "I sent t3 back to a new agent — carry on.");
  assert.equal(deliveredWords({ deliveries: 1 }), "with 1 message from agents");
  // A flow's start told to the main agent is Filament's word, not an agent's (HarnessV4_OneAgent_Plan OA3, OA-D8).
  assert.equal(deliveredWords({ deliveries: 1, flowStarts: 1 }), "with the flow you started");
  assert.equal(deliveredWords({ deliveries: 4, flowStarts: 2, shellExits: 1 }), "with the 2 flows you started and 1 message from agents and 1 background shell exit");
  assert.deepEqual(OUTCOME_FILTERS.map((f) => f.label), ["All", "Turns", "Agents", "Team workers"]);
  assert.equal(SECTIONS.find((/** @type {any} */ s) => s.id === "agents")?.title, "Engine and agents");
});
