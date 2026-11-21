// @ts-check
// E42, agents drive the Space (HarnessV4_AgentsSpace_Plan AS1–AS2, cases 1–7): an agent of the project reads every
// row of Needs you — a watch's find, a stopped source, a check, a routine's run, a repro, a draft — each with its id,
// and marks one done once it is dealt with, with a line on what it did. The row goes to Done today saying who closed it
// and its line; What happened gets the chat's own line; Bring back says whose done it undid. Another chat's draft is
// never its to close; its own draft it discards. Hand to an agent… names the row and how to close it.
// (fails before: yes — the space tool read the drafts alone, and only the page marked a row done)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grantOf } from "../src/core/dashboard-sources.js";
import { needsWords } from "../src/core/space.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { SPACE_GUIDED, SPACE_TOOL, spaceCall, spaceGuide } from "../src/app/agent/space.js";
import { doneByLine, handWords, reproFixWords } from "../src/ui/harness/lib/space-view.js";
import { removeDirs } from "./helpers/wait.js";

const T = Date.UTC(2026, 9, 26, 8, 0);
/** A dashboard of CI runs whose watch writes in Needs you. */
const RUNS = {
  sources: { runs: { command: ["gh", "run", "list", "--json", "databaseId,conclusion"], key: "databaseId", columns: { run: "databaseId", status: "conclusion" } } },
  watch: [{ from: "runs", new: true, match: { status: "failure" }, says: "CI failed on main: run {row.run}", to: "needs-you" }],
};
const WHY = "a watch of CI: a new row of runs where status is failure";
const NAMES = /** @type {Record<string, string>} */ ({ c1: "Release", c2: "Docs" });
/** A Space with a watch's find, a stopped source, a draft of c1's and one of c2's. @param {string | null} [dir] */
function spaceOf(dir = null) {
  const clock = { at: T };
  const store = createSpaceStore({ dir, now: () => clock.at });
  store.keepDashboard("p1", { name: "ci-ab12", v: 1, grant: grantOf(RUNS), title: "CI" });
  store.watchSaw("p1", "ci-ab12", "w0", { keys: ["10"], at: T }, ["CI failed on main: run 10"], "CI", { to: "needs-you", why: WHY });
  store.sourceStopped("p1", { dashboard: "ci-ab12", title: "CI", source: "runs", error: "gh exited 1: not signed in" });
  const draft = { title: "Reply to Sara", connection: "slack", tool: "post_message", args: { channel: "C024", text: "{words}" }, words: "Not today: CI is red.", to: "#releases", answers: null, from: [] };
  store.writeDraft("p1", draft, { chain: "c1", byName: "Release", account: "" });
  store.writeDraft("p1", { ...draft, title: "Note to Ola" }, { chain: "c2", byName: "Docs", account: "" });
  const ids = Object.fromEntries(store.get("p1").needs.map((n) => [n.kind === "draft" ? `draft:${n.draft?.chain}` : n.kind, n.id]));
  return { clock, store, ids };
}
/** Where a call of c1's stands. @param {ReturnType<typeof createSpaceStore>} store @param {Record<string, any>} [o] */
const atOf = (store, o = {}) => ({ store, project: "p1", chain: "c1", name: null, nameOf: (/** @type {string} */ c) => NAMES[c] || c, ...o });
/** @param {any} r */
const words = (r) => (r.ok ? r.text : r.error);

describe("the agent reads Needs you (case 1, 2)", () => {
  test("every open row with its id, what brought it, when, its words and why; the agent's own draft as its own", () => {
    const { store, ids } = spaceOf();
    const r = spaceCall({ action: "needs" }, atOf(store), T);
    assert.equal(r.ok, true, words(r));
    const text = words(r);
    assert.match(text, /^Needs you in this project's Space, as of 2026-10-26 \d\d:\d\d: 4 open\./);
    assert.ok(text.includes(`- ${ids.watch} · a watch of “CI” · `), text);
    assert.ok(text.includes(`: CI failed on main: run 10 (why: ${WHY})`), text);
    assert.ok(text.includes(`- ${ids.source} · CI's source runs stopped · `), text);
    assert.ok(text.includes(`- ${ids["draft:c1"]} · your draft, through slack › post_message, for the person's Send · `), text);
    assert.ok(text.includes(`- ${ids["draft:c2"]} · Docs's draft, through slack › post_message, for the person's Send · `), text);
    assert.match(text, /Once a row is dealt with, mark it done: \{"action":"needs","with":\{"id":"n\d+","done":"what you did, in a line"\}\}\. A draft of yours goes with "discard":true\.$/);
  });
  test("none: it says so; the core's words alone, the same", () => {
    const store = createSpaceStore({ dir: null, now: () => T });
    assert.equal(words(spaceCall({ action: "needs" }, atOf(store), T)), "Nothing in this project's Needs you: nothing waits for the person here.");
    assert.equal(needsWords([], { nameOf: (c) => c, now: T, self: "c1" }), "");
  });
  test("put off and done of late, apart, each saying who closed it", () => {
    const { store, ids, clock } = spaceOf();
    store.needChange("p1", ids.source, { later: T + 3_600_000 });
    spaceCall({ action: "needs", with: { id: ids.watch, done: "re-ran it; green" } }, atOf(store), T);
    clock.at = T + 60_000;
    const text = words(spaceCall({ action: "needs" }, atOf(store), T + 60_000));
    assert.match(text, /: 2 open, 1 put off\./);
    assert.ok(text.includes(`Put off by the person: ${ids.source} until `), text);
    assert.ok(text.includes(`Done in the last two days: ${ids.watch} “CI failed on main: run 10”, by you: re-ran it; green.`), text);
  });
});

describe("the agent marks a row done (cases 3–6)", () => {
  test("Done with its line: Done today keeps who and the line; What happened the chat's own line", () => {
    const { store, ids } = spaceOf();
    const r = spaceCall({ action: "needs", with: { id: ids.watch, done: "rolled back to 3f2a91; the watch is quiet" } }, atOf(store), T);
    assert.equal(words(r), `${ids.watch} “CI failed on main: run 10” is done: it is in the person's Done today, with your line, and in What happened. They can bring it back.`);
    const n = store.get("p1").needs.find((x) => x.id === ids.watch);
    assert.deepEqual([n?.state, n?.doneAt, n?.doneBy], ["done", T, { chain: "c1", byName: "Release", line: "rolled back to 3f2a91; the watch is quiet" }]);
    const e = store.get("p1").log.at(-1);
    assert.deepEqual([e?.by, e?.text], [{ kind: "agent", chain: "c1" }, "Marked “CI failed on main: run 10” done: rolled back to 3f2a91; the watch is quiet"]);
  });
  test("a helper of the chat is named as it, for the chat", () => {
    const { store, ids } = spaceOf();
    spaceCall({ action: "needs", with: { id: ids.watch, done: "fixed" } }, atOf(store, { name: "Deploy fixer" }), T);
    assert.deepEqual(store.get("p1").needs.find((x) => x.id === ids.watch)?.doneBy, { chain: "c1", byName: "Deploy fixer (for Release)", line: "fixed" });
  });
  test("Bring back on a row an agent closed writes whose done it undid, and the row opens as it was", () => {
    const { store, ids } = spaceOf();
    spaceCall({ action: "needs", with: { id: ids.watch, done: "fixed" } }, atOf(store), T);
    store.needChange("p1", ids.watch, { back: true });
    const n = store.get("p1").needs.find((x) => x.id === ids.watch);
    assert.deepEqual([n?.state, n?.doneBy], ["open", undefined]);
    const e = store.get("p1").log.at(-1);
    assert.deepEqual([e?.by, e?.text], [{ kind: "you" }, "Brought back “CI failed on main: run 10”, which Release had marked done."]);
  });
  test("refused in words: no line, a long line, no such row, done already, another chat's draft, its own draft", () => {
    const { store, ids } = spaceOf();
    const at = atOf(store);
    assert.match(words(spaceCall({ action: "needs", with: { id: ids.watch } }, at, T)), /^Not changed: say what you did, in a line: "done":"rolled back to 3f2a…91; the watch is quiet"/);
    assert.match(words(spaceCall({ action: "needs", with: { id: ids.watch, done: "x".repeat(401) } }, at, T)), /^Not changed: "done" is 400 characters at most; this one is 401/);
    assert.match(words(spaceCall({ action: "needs", with: { id: "n99", done: "fixed" } }, at, T)), /There is no row "n99" in this Space's Needs you/);
    spaceCall({ action: "needs", with: { id: ids.watch, done: "fixed" } }, at, T);
    assert.match(words(spaceCall({ action: "needs", with: { id: ids.watch, done: "again" } }, at, T)), new RegExp(`^Not changed: ${ids.watch} is done already`));
    assert.equal(words(spaceCall({ action: "needs", with: { id: ids["draft:c2"], done: "sent it" } }, at, T)), `Not changed: ${ids["draft:c2"]} is Docs's draft: the person sends or discards it, or Docs does.`);
    assert.equal(words(spaceCall({ action: "needs", with: { id: ids["draft:c1"], done: "sent it" } }, at, T)), `Not changed: ${ids["draft:c1"]} is your draft: a draft is sent or discarded, not done — {"action":"needs","with":{"id":"${ids["draft:c1"]}","discard":true}} discards it.`);
    assert.equal(store.get("p1").needs.find((x) => x.id === ids["draft:c2"])?.state, "open");
  });
  test("its own draft discarded; another's refused; one being sent refused, as on the page", () => {
    const { store, ids } = spaceOf();
    assert.equal(words(spaceCall({ action: "needs", with: { id: ids["draft:c2"], discard: true } }, atOf(store), T)), `Not changed: ${ids["draft:c2"]} is Docs's draft: the person sends or discards it, or Docs does.`);
    const sending = atOf(store, { sending: (/** @type {string} */ _p, /** @type {string} */ id) => id === ids["draft:c1"] });
    assert.match(words(spaceCall({ action: "needs", with: { id: ids["draft:c1"], discard: true } }, sending, T)), /^Not changed: it is being sent/);
    assert.equal(words(spaceCall({ action: "needs", with: { id: ids["draft:c1"], discard: true } }, atOf(store), T)), `Your draft ${ids["draft:c1"]} “Reply to Sara” is discarded.`);
    const n = store.get("p1").needs.find((x) => x.id === ids["draft:c1"]);
    assert.deepEqual([n?.state, n?.outcome], ["done", "discarded"]);
  });
  test("who closed it and its line are kept in the Space's file", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-space-agents-"));
    try {
      const { store, ids } = spaceOf(dir);
      spaceCall({ action: "needs", with: { id: ids.watch, done: "fixed it" } }, atOf(store), T);
      const again = createSpaceStore({ dir, now: () => T });
      assert.deepEqual(again.get("p1").needs.find((x) => x.id === ids.watch)?.doneBy, { chain: "c1", byName: "Release", line: "fixed it" });
    } finally {
      void removeDirs(dir);
    }
  });
  test("the person switched the tool off: refused, as every action", () => {
    const { store, ids } = spaceOf();
    assert.match(words(spaceCall({ action: "needs", with: { id: ids.watch, done: "x" } }, atOf(store, { on: () => false }), T)), /^Not run: the person switched the space tool off/);
  });
});

describe("the door and the guide name it", () => {
  test("needs is a guided action, its topic whole in the guide", () => {
    assert.ok(SPACE_GUIDED.includes("needs"));
    assert.match(SPACE_TOOL.description, /whose fields go in with: [\w, ]*\bneeds\b[\w, ]*;/);
    const g = spaceGuide("needs");
    assert.equal(g.ok, true);
    assert.match(g.ok ? g.text : "", /^## needs — what waits for the person/);
    assert.match(g.ok ? g.text : "", /"done"/);
    assert.match(g.ok ? g.text : "", /"discard":true/);
  });
});

describe("on the page (case 7, the Designer's words)", () => {
  /** @param {Record<string, any>} n */
  const row = (n) => /** @type {any} */ ({ id: "n7", kind: "watch", text: "Deploy errors rose to 41 in the last hour", why: "a watch of Deploys: a new row", dashboard: "deploys", title: "Deploys", at: T, state: "open", ...n });
  test("Hand to an agent… names the row and how to close it, and ends on the person's colon", () => {
    assert.equal(handWords(row({}), "filament"), "“Deploys”, a dashboard in filament's Space, put this in Needs you as row n7: Deploy errors rose to 41 in the last hour (why: a watch of Deploys: a new row). Once it is dealt with, mark the row done with the space tool, in a line on what you did. Look into it: ");
    const check = handWords(row({ kind: "check", check: { label: "Roll back…", ran: "wrangler rollback 3f2a", said: "rolled back", reason: "the count still reads zero" } }), "filament");
    assert.ok(check.endsWith("An agent checked it and says it did not work: the count still reads zero. It is row n7 of Needs you: once it is dealt with, mark it done with the space tool, in a line on what you did. Find out why, and fix it: "), check);
  });
  test("a repro's Fix it… names its row the same way: it stays open until marked", () => {
    const repro = { reproduced: true, test: "t.spec.ts", run: "npm test -- t", said: "fails 3 of 3", steps: "", tried: [], questions: [], draft: "", chain: "c1", byName: "Release", cwd: "" };
    assert.equal(reproFixWords({ id: "n7", title: "PLAY-91 x", repro }), "Fix “PLAY-91 x”. The failing test t.spec.ts shows it — run it with: npm test -- t. It said: fails 3 of 3. It is row n7 of Needs you: once it is fixed, mark it done with the space tool, in a line on what you changed. Make it pass without weakening it, and say what you changed: ");
  });
  test("doneByLine: the line under a row an agent closed; none for one the person closed", () => {
    assert.equal(doneByLine(row({ state: "done", doneAt: T, doneBy: { chain: "c1", byName: "Deploy fixer", line: "rolled back to 3f2a91; the watch is quiet" } })), "Deploy fixer: rolled back to 3f2a91; the watch is quiet");
    assert.equal(doneByLine(row({ state: "done", doneAt: T })), "");
  });
});
