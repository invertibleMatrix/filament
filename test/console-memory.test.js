// @ts-check
// HarnessV3-Memory M6-6: the console says what the harness's Settings → Memory says, in its own style. On the fake DOM:
// the Memories tab's claim browser (where, which, what kind, a search; each claim with how it is known, how sure memory
// is, its flags and its trigger; Confirm, Correct, Retire, Restore and its history) and memory's questions; a Projects
// card's dossier by section, its cites opening the claim, Rewrite now; the always-allow offers; the Memories and
// Projects pages around them, with no word left from before claims; and the three model pickers on Memory → Settings.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bindUi, state as runtimeState } from "../src/ui/runtime.js";
import { claimPanels, dossierView, permissionPanel } from "../src/ui/pages/memory-claims.js";
import { memoryModelsPanel } from "../src/ui/pages/memory-models.js";
import { learnsWith } from "../src/ui/lib/claims.js";
import { stallWords } from "../src/ui/lib/engine.js";
import { outcomesPanel } from "../src/ui/pages/memory-outcomes.js";
import { memory, memories, projects, memGate } from "../src/ui/pages/memory.js";
import { fmt } from "../src/ui/lib/format.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";

/** The console's mutable bag, loosely typed as the pages read it. @type {any} */
const state = runtimeState;
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
/** Every node under `el` for which `ok` holds. @param {any} el @param {(n: any) => boolean} ok @returns {any[]} */
const all = (el, ok, out = /** @type {any[]} */ ([])) => {
  if (!el || typeof el !== "object") return out;
  if (ok(el)) out.push(el);
  for (const k of el.kids || []) all(k, ok, out);
  return out;
};
const tagged = (/** @type {any} */ el, /** @type {string} */ tag) => all(el, (n) => n.tag === tag);
const cls = (/** @type {string} */ c) => (/** @type {any} */ n) => String(n.attrs?.class || "").split(/\s+/).includes(c);
const button = (/** @type {any} */ el, /** @type {string} */ starts) => buttonsOf(el).find((b) => textOf(b).startsWith(starts));
/** The button whose words are exactly these. @param {any} el @param {string} words */
const named = (el, words) => buttonsOf(el).find((b) => textOf(b) === words);
const click = (/** @type {any} */ el, /** @type {string} */ starts) => {
  const b = button(el, starts);
  assert.ok(b, `a button "${starts}" in ${textOf(el).slice(0, 200)}`);
  b.dispatch("click");
};
/** The claim rows of a panel, by id. @param {any} el */
const rowsOf = (el) => Object.fromEntries(tagged(el, "tr").filter((r) => r.attrs?.["data-id"]).map((r) => [r.attrs["data-id"], r]));

const SCOPES = [
  { project: null, name: "Everywhere", claims: 1 },
  { project: "p1", name: "filament", cwd: "H:/filament", claims: 3, dossier: 2 },
  { project: "p2", name: "other", cwd: "H:/other", claims: 0 },
];
const STANDING = [
  { id: "i12", kind: "procedure", text: "How to release: 1. npm test 2. npm run build", status: "inferred", trust: "the learner", backed: 2, sure: 0.8, flags: [], triggers: [] },
  { id: "i7", kind: "fact", text: "The api listens on port 3000.", status: "confirmed", trust: "you", backed: 1, sure: 0.95, flags: ["file changed since"], triggers: [] },
  { id: "i9", kind: "rule", text: "Don't run npm test bare.", status: "confirmed", trust: "you", backed: 1, sure: 0.3, held: true, flags: [], triggers: [{ shape: "npm test", unless: "env -u CLAUDECODE npm test", fired: 2, followed: 1 }] },
];
const RETIRED = [
  { id: "i4", kind: "fact", text: "The api listens on port 8080.", status: "superseded", trust: "you", sure: 0.9, flags: [], replacedBy: "i7", triggers: [] },
  { id: "i5", kind: "decision", text: "We ship on Fridays.", status: "dismissed", trust: "the learner", sure: 0.5, flags: [], triggers: [] },
  { id: "i8", kind: "fact", text: "The api now listens on port 9090.", status: "dismissed", trust: "inferred", flags: ["would replace i7 if you say so"], asked: "q4", triggers: [] },
];
/** How models did, as the outcomes route answers it: a turn group and a sub-agent group. */
const OUTCOMES = {
  project: null, days: 30, kind: null, runs: 7,
  groups: [
    {
      model: "glm-5.3", kind: "turn", runs: 5, held: 3, done: 4, failed: 1, stopped: 0, corrected: 1, rounds: 4, ms: 83_000, tokensIn: 50_000, tokensOut: 4_000, priced: 4, usd: 0.016, usdPerRun: 0.004,
      did: [{ did: "tests", runs: 3, held: 2, done: 3, failed: 0, stopped: 0, corrected: 1 }, { did: "delegated", runs: 2, held: 1, done: 1, failed: 1, stopped: 0, corrected: 0 }],
    },
    {
      model: "grok-4.6", kind: "subagent", runs: 2, held: 0, done: 1, failed: 0, stopped: 1, corrected: 1, rounds: 2.5, ms: 950, tokensIn: 900, tokensOut: 80, priced: 0, usd: null, usdPerRun: null,
      did: [{ did: "answered", runs: 2, held: 0, done: 1, failed: 0, stopped: 1, corrected: 1 }],
    },
  ],
};
const COUNTS = { standing: 3, review: 2, retired: 2, kinds: { all: 3, rules: 1, howto: 1, pitfalls: 1, decisions: 0, facts: 1, threads: 0 } };
const QUESTION = { id: "q3", proposal: { action: "retire", id: 9 }, claims: [{ id: "i9", text: "Don't run npm test bare." }], reason: "its file is gone", created: "2026-10-03T09:00:00.000Z" };
const HISTORY = [
  { action: "created", by: "learner", at: "2026-10-02T09:00:00.000Z", detail: { status: "inferred" } },
  { action: "status", by: "owner", at: "2026-10-03T09:00:00.000Z", detail: { from: "inferred", to: "confirmed" }, reason: "confirmed on the console" },
];
const DOSSIER = {
  project: "p1", version: 2, written: { at: "2026-10-03T09:00:00.000Z", model: "glm-5.3", run: "r4" }, lines: 2, hidden: 1,
  sections: [
    { title: "Pitfalls", lines: [{ text: "Don't run npm test bare: use env -u CLAUDECODE.", cites: ["i9"], flags: ["✓2"] }] },
    { title: "Facts", lines: [{ text: "The api listens on port 3000.", cites: ["i7"], flags: ["file changed since"] }] },
  ],
};

/** @type {{ path: string, method: string, body: any }[]} */
let calls;
/** @type {{ msg: string, kind?: string }[]} */
let toasts;
/** @type {string[]} */
let went;
/** What a POST answers, by path; a thrown error is a refusal. @type {(path: string, body: any) => any} */
let posts;
/** What GET /memory/inbox answers. @type {any[]} */
let questions;
/** What GET /memory/claims/scopes answers. @type {any[]} */
let scopes;
/** What a claim's history answers. @type {any[]} */
let history;
/** What GET /memory/outcomes answers, by its query (M7-D52). @type {(q: URLSearchParams) => any} */
let outcomesFor;
/** A GET answered otherwise, once, by its path: held back until the test says, or refused. @type {Map<string, () => Promise<any>>} */
let holds;
/** The events stream as the panels hear it: `say` hands each listener a message. @type {Set<(msg: any) => void>} */
const listeners = new Set();
const say = (/** @type {any} */ msg) => {
  for (const fn of [...listeners]) fn(msg);
};

beforeEach(() => {
  listeners.clear();
  calls = [];
  toasts = [];
  went = [];
  questions = [QUESTION];
  scopes = SCOPES;
  history = HISTORY;
  holds = new Map();
  outcomesFor = () => structuredClone(OUTCOMES);
  posts =(path) => (path.endsWith("/correct") ? { ok: true, id: "i30" } : path === "/memory/curator/run" ? { run: "r5", actions: 2, questions: 1 } : { ok: true });
  Object.assign(state, { memUi: null, memClaims: null, memProjects: null, memProjSet: null, memProj: null, config: { routes: [] } });
  bindUi({
    h: fakeH,
    fmt,
    state,
    toast: (/** @type {string} */ msg, /** @type {string} */ kind) => toasts.push({ msg, kind }),
    go: (/** @type {string} */ tab) => went.push(tab),
    goto: (/** @type {string} */ tab, /** @type {string} */ label) => fakeH("a", { href: `#${tab}` }, label),
    render: () => {},
    markDirty: () => { state.dirty = true; },
    intro: (/** @type {string} */ _key, /** @type {any[]} */ ...kids) => fakeH("div", { class: "intro" }, ...kids),
    empty: (/** @type {string} */ title, /** @type {string} */ hint) => fakeH("div", { class: "empty" }, fakeH("b", {}, title), hint ? fakeH("span", {}, hint) : null),
    memGate: (/** @type {(st: any) => any} */ fn) => fn({ engine: { installed: true } }),
    memPrefix: () => "@mem",
    memAgo: (/** @type {any} */ ts) => (ts ? "2 h ago" : "–"), // the app's: "–" when there is no time to show
    memSessionLink: (/** @type {string} */ id) => fakeH("a", {}, String(id ?? "–")),
    md: (/** @type {string} */ s) => s,
    upDisplay: (/** @type {string} */ id) => id,
    memStatus: async () => ({}),
    onEvents: (/** @type {(msg: any) => void} */ fn) => (listeners.add(fn), () => void listeners.delete(fn)),
    modelCatalog: () => ({ models: [{ id: "glm-5.3", upstream: "zai" }, { id: "claude-code", upstream: "cc", codingAgent: true }] }),
    api: async (/** @type {string} */ path, /** @type {any} */ o = {}) => {
      const method = o.method || "GET";
      calls.push({ path, method, body: o.body && structuredClone(o.body) });
      if (method === "POST") return posts(path, o.body);
      const held = holds.get(path);
      if (held) {
        holds.delete(path);
        return held();
      }
      const u = new URL(`http://x${path}`);
      const q = u.searchParams;
      if (u.pathname === "/memory/claims/scopes") return { scopes: structuredClone(scopes) };
      if (u.pathname === "/memory/claims") {
        if (q.get("project") === "p2" || q.get("q") === "nothing") return { project: q.get("project"), counts: { standing: 0, review: 0, retired: 0, kinds: { all: 0 } }, claims: [], more: 0 };
        const list = q.get("state") === "retired" ? RETIRED : STANDING;
        return { project: q.get("project"), counts: COUNTS, claims: structuredClone(list), more: 0 };
      }
      if (u.pathname === "/memory/inbox") return { questions: structuredClone(questions) };
      if (/^\/memory\/items\/\d+\/history$/.test(u.pathname)) return { events: structuredClone(history) };
      if (u.pathname === "/memory/dossier") return structuredClone(DOSSIER);
      if (u.pathname === "/memory/outcomes") return outcomesFor(q);
      if (u.pathname === "/memory/items") {
        const perms = {
          inferred: [{ id: 31, kind: "permission", text: "Bash(npm test)", project_id: "p1", chain_id: "c1", created_at: 1 }],
          confirmed: [{ id: 32, kind: "permission", text: "Bash(git status)", project_id: "p1", chain_id: "c1", created_at: 1 }],
        };
        return { items: perms[/** @type {"inferred" | "confirmed"} */ (q.get("status"))] || [] };
      }
      if (u.pathname === "/memory/projects") return { projects: [{ id: "p1", name: "filament", cwd: "H:/filament", chains: 4, turns: 40, items: 9, dossier: 2, first_seen: 1_790_900_000_000, last_seen: 1_790_980_000_000 }] };
      if (u.pathname === "/memory/identity") return { identity: [] };
      if (u.pathname === "/memory/models") return { models: { summarizer: "", effort: "", curatorUsesModel: false, now: null, from: "none", whyNone: "no model to call" } };
      throw new Error(`unexpected GET ${path}`);
    },
  });
});
afterEach(() => { state.memUi = null; state.memClaims = null; });

const gets = () => calls.filter((c) => c.method === "GET").map((c) => c.path);
const postsMade = () => calls.filter((c) => c.method === "POST").map((c) => [c.path, c.body]);
/** The claim browser, opened and read. @param {any} [S] */
const openBrowser = async (S = {}) => {
  const { panels } = claimPanels(S);
  await settle();
  return { S, claimsEl: panels[0], asksEl: panels[1] };
};

test("the Memories tab opens on the project with the most memories: each claim with how it is known, how sure, its flags and its trigger", async () => {
  const { S, claimsEl } = await openBrowser();
  assert.equal(S.scope, "p1", "the busiest project first");
  assert.ok(gets().includes("/memory/claims?state=standing&project=p1"), gets().join(" "));
  assert.ok(gets().includes("/memory/inbox?project=p1"));
  const opts = tagged(claimsEl, "option").map(textOf);
  assert.deepEqual(opts, ["Everywhere (1)", "filament (3)", "other (0)"]);
  const rows = rowsOf(claimsEl);
  assert.deepEqual(Object.keys(rows), ["i12", "i7", "i9"]);
  assert.match(textOf(rows.i12), /^How to\|How to release/);
  assert.match(textOf(rows.i12), /i12\| \|the learner · ✓2\|80%/);
  // The trigger in words, its commands as code; the held claim under the line says so.
  assert.equal(textOf(all(rows.i9, cls("mem-trigger"))[0]), "⚠ |On |npm test| · the right way: |env -u CLAUDECODE npm test| · said 2 times| · followed 1 time");
  assert.deepEqual(all(all(rows.i9, cls("mem-trigger"))[0], (n) => n.tag === "code").map(textOf), ["npm test", "env -u CLAUDECODE npm test"]);
  assert.ok(all(rows.i9, (n) => n.tag === "td" && String(n.attrs.class) === "num warn").length === 1, "under the line: warned");
  assert.match(textOf(rows.i9), /held back from recall/);
  assert.match(textOf(rows.i7), /file changed since/);
  // Confirm where it changes something (M6-D8): not on a confirmed claim whose files stand.
  assert.ok(button(rows.i12, "Confirm") && button(rows.i7, "Confirm"));
  assert.equal(button(rows.i9, "Confirm"), undefined);
  for (const r of Object.values(rows)) assert.ok(button(r, "Correct") && button(r, "Retire") && button(r, "History"));
  // The tabs and the kinds carry their counts.
  assert.match(textOf(claimsEl), /Standing 3\|To review 2\|Retired 2/);
  assert.match(textOf(claimsEl), /All 3\|Rules 1\|How to 1\|Pitfalls 1\|Decisions 0\|Facts 1\|Threads 0/);
});

test("Confirm, Retire and Correct are the owner's word through the routes, and the tab reads everything again after", async () => {
  const { claimsEl } = await openBrowser();
  calls.length = 0;
  click(rowsOf(claimsEl).i12, "Confirm");
  await settle();
  assert.deepEqual(postsMade(), [["/memory/items/12", { status: "confirmed" }]]);
  assert.deepEqual(toasts.at(-1), { msg: "i12 confirmed: it counts as your word", kind: undefined });
  assert.deepEqual(gets().sort(), ["/memory/claims/scopes", "/memory/claims?state=standing&project=p1", "/memory/inbox?project=p1"].sort());
  calls.length = 0;
  click(rowsOf(claimsEl).i9, "Retire");
  await settle();
  assert.deepEqual(postsMade(), [["/memory/forget", { id: "i9", reason: "retired in the console" }]]);
  // Correct: the editor opens under the row; Save waits for words that say something new.
  calls.length = 0;
  click(rowsOf(claimsEl).i7, "Correct");
  const field = tagged(claimsEl, "textarea")[0];
  assert.ok(field, "the editor opened");
  assert.equal(field.value, "The api listens on port 3000.");
  const save = button(claimsEl, "Save");
  assert.ok("disabled" in save.attrs, "the same words are no correction");
  field.value = "The api listens on port 4000.";
  field.oninput();
  assert.ok(!("disabled" in save.attrs));
  save.dispatch("click");
  await settle();
  assert.deepEqual(postsMade(), [["/memory/items/7/correct", { text: "The api listens on port 4000.", reason: "corrected in the console" }]]);
  assert.deepEqual(toasts.at(-1), { msg: "i30 replaces i7", kind: undefined });
  assert.equal(tagged(claimsEl, "textarea").length, 0, "the editor closes once it is said");
  // A refusal is said in its words.
  posts = () => { throw Object.assign(new Error("i12 is superseded by i30; only the user can bring it back"), { status: 409 }); };
  click(rowsOf(claimsEl).i12, "Confirm");
  await settle();
  assert.deepEqual(toasts.at(-1), { msg: "i12 is superseded by i30; only the user can bring it back", kind: "err" });
});

test("the filters read what they say: a state, a kind, a search, another place", async () => {
  const { S, claimsEl, asksEl } = await openBrowser();
  calls.length = 0;
  click(claimsEl, "To review");
  await settle();
  assert.deepEqual(gets(), ["/memory/claims?state=review&project=p1"]);
  calls.length = 0;
  click(claimsEl, "Pitfalls");
  await settle();
  assert.deepEqual(gets(), ["/memory/claims?state=review&kind=pitfalls&project=p1"]);
  calls.length = 0;
  const search = tagged(claimsEl, "input").find((i) => i.attrs.type === "search");
  search.value = "port 3000";
  search.onkeydown({ key: "Enter" });
  await settle();
  assert.deepEqual(gets(), ["/memory/claims?state=review&kind=pitfalls&q=port%203000&project=p1"]);
  // Everywhere: the global claims and questions; the search was the last place's.
  calls.length = 0;
  const where = tagged(claimsEl, "select")[0];
  where.value = "";
  where.dispatch("change");
  await settle();
  assert.equal(S.scope, null);
  assert.equal(S.q, "");
  assert.deepEqual(gets().sort(), ["/memory/claims?state=review&kind=pitfalls", "/memory/inbox"].sort());
  assert.match(textOf(asksEl), /Memory asks · 1/);
});

test("a retired claim is struck; Restore brings back a retired one, and a replaced one points at what replaced it", async () => {
  const { S, claimsEl } = await openBrowser({ scope: "p1", state: "retired" });
  const rows = rowsOf(claimsEl);
  assert.deepEqual(Object.keys(rows), ["i4", "i5", "i8"]);
  assert.deepEqual(Object.values(rows).map((r) => r.attrs.class), ["mem-claim-retired", "mem-claim-retired", "mem-claim-held"], "one held for the user's answer is not struck: it is not untrue");
  assert.equal(button(rows.i4, "Restore"), undefined, "a correction's word stands: what replaced it is corrected instead");
  assert.equal(button(rows.i8, "Restore"), undefined, "held for the user's answer: the question is where it is answered (M6-7)");
  assert.ok(textOf(rows.i8).includes("would replace i7 if you say so"), textOf(rows.i8));
  assert.deepEqual(all(rows.i8, (n) => n.tag === "td" && /^num/.test(String(n.attrs.class))).map(textOf), ["–"], "no confidence: a dash, never 0%");
  assert.equal(button(rows.i4, "Retire"), undefined);
  calls.length = 0;
  click(rows.i5, "Restore");
  await settle();
  assert.deepEqual(postsMade(), [["/memory/items/5", { status: "confirmed" }]]);
  assert.deepEqual(toasts.at(-1), { msg: "i5 stands again", kind: undefined });
  calls.length = 0;
  click(rowsOf(claimsEl).i4, "replaced by i7");
  await settle();
  assert.equal(S.state, "standing");
  assert.deepEqual(gets(), ["/memory/claims?state=standing&q=i7&project=p1"]);
});

test("a claim's history opens under its row, in words, and closes again", async () => {
  const { claimsEl } = await openBrowser();
  calls.length = 0;
  click(rowsOf(claimsEl).i12, "History ▾");
  await settle();
  assert.deepEqual(gets(), ["/memory/items/12/history"]);
  const open = all(claimsEl, cls("mem-history"))[0];
  assert.ok(open, "the history opened");
  assert.match(textOf(open), /Filed inferred by the learner/);
  assert.match(textOf(open), /Confirmed by you\| — confirmed on the console/);
  click(rowsOf(claimsEl).i12, "History ▴");
  assert.equal(all(claimsEl, cls("mem-history")).length, 0);
  history = [];
  click(rowsOf(claimsEl).i7, "History ▾");
  await settle();
  assert.match(textOf(claimsEl), /\|No history recorded\.\|/, "an empty history says so");
});

test("memory's questions are answered in place, and an empty list says what memory asks about", async () => {
  const { asksEl } = await openBrowser();
  assert.match(textOf(asksEl), /Retire “Don't run npm test bare\.”\|its file is gone/);
  calls.length = 0;
  click(asksEl, "Accept");
  await settle();
  assert.deepEqual(postsMade(), [["/memory/inbox/q3", { answer: "accept" }]]);
  assert.deepEqual(toasts.at(-1), { msg: "Done as asked", kind: undefined });
  calls.length = 0;
  click(asksEl, "Reject");
  await settle();
  assert.deepEqual(postsMade(), [["/memory/inbox/q3", { answer: "reject" }]]);
  assert.deepEqual(toasts.at(-1), { msg: "Left as it is: memory will not ask it again", kind: undefined });
  questions = [];
  const { asksEl: quiet } = await openBrowser();
  assert.match(textOf(quiet), /^Memory asks\|Memory asks nothing here\. It asks before it changes your own word/);
});

test("an empty list says why, by what was asked", async () => {
  const { S, claimsEl } = await openBrowser({ scope: "p2" });
  assert.equal(S.scope, "p2", "a place remembered is kept");
  assert.match(textOf(claimsEl), /No memories here yet/);
  click(claimsEl, "To review");
  await settle();
  assert.match(textOf(claimsEl), /Nothing to review/);
  S.state = "standing";
  const search = tagged(claimsEl, "input").find((i) => i.attrs.type === "search");
  search.value = "nothing";
  search.onkeydown({ key: "Enter" });
  await settle();
  assert.match(textOf(claimsEl), /No memory here says that/);
  // A place that is gone falls back to the busiest, read once.
  calls.length = 0;
  const gone = await openBrowser({ scope: "p9" });
  assert.equal(gone.S.scope, "p1");
  assert.deepEqual(gets().sort(), ["/memory/claims/scopes", "/memory/inbox?project=p1", LIST].sort());
  // One remembered that is no place at all: the same.
  const odd = await openBrowser({ scope: 7 });
  assert.equal(odd.S.scope, "p1");
});

test("a state remembered that is no state reads the standing ones; an archived project is listed while memories stand in it", async () => {
  scopes = [...SCOPES, { project: "p3", name: "old", cwd: "H:/old", claims: 0, archived: true }, { project: "p4", name: "kept", cwd: "H:/kept", claims: 2, archived: true }];
  const { S, claimsEl } = await openBrowser({ scope: "p1", state: "old" });
  assert.equal(S.state, "standing");
  assert.ok(gets().includes("/memory/claims?state=standing&project=p1"), gets().join(" "));
  assert.deepEqual(tagged(claimsEl, "option").map(textOf), ["Everywhere (1)", "filament (3)", "other (0)", "kept (2)"]);
});

test("a Projects card's dossier: by section, its cites open the claim on the Memories tab; Rewrite now asks the curator", async () => {
  const el = dossierView({ id: "p1", name: "filament", dossier: 2 });
  assert.match(textOf(el), /^Dossier v2, written by the curator: every new session here opens with it\./);
  assert.deepEqual(gets(), [], "read when shown");
  click(el, "Show");
  await settle();
  assert.deepEqual(gets(), ["/memory/dossier?project=p1"]);
  assert.match(textOf(el), /written .+ by glm-5\.3 · 1 line hidden: a memory it rests on changed or was retired/);
  const secs = all(el, cls("mem-dsec"));
  assert.deepEqual(secs.map((s) => textOf(tagged(s, "b")[0])), ["Pitfalls", "Facts"]);
  assert.equal(textOf(secs[0]), "Pitfalls|Don't run npm test bare: use env -u CLAUDECODE.|i9", "a ✓ is not a warning");
  assert.equal(textOf(secs[1]), "Facts|The api listens on port 3000.|i7|file changed since");
  click(el, "i7");
  assert.deepEqual(state.memClaims, { scope: "p1", state: "standing", kind: "", q: "i7" });
  assert.deepEqual(went, ["memories"]);
  calls.length = 0;
  click(el, "Rewrite now");
  assert.match(textOf(el), /rewriting…/);
  await settle();
  assert.deepEqual(postsMade(), [["/memory/curator/run", { project: "p1" }]]);
  assert.deepEqual(toasts.at(-1), { msg: "The curator's pass r5: 2 changes, 1 question", kind: undefined });
  assert.deepEqual(gets(), ["/memory/dossier?project=p1"], "the new version read");
  posts = () => ({ skipped: "a pass is running" });
  click(el, "Rewrite now");
  await settle();
  assert.deepEqual(toasts.at(-1), { msg: "The curator did not run: a pass is running", kind: "err" });
});

test("the always-allow offers: Always allow confirms one, Dismiss keeps it from being offered again", async () => {
  const S = {};
  const el = permissionPanel(S);
  await settle();
  assert.deepEqual(gets(), ["/memory/items?kind=permission&status=inferred&limit=200"]);
  assert.match(textOf(el), /Bash\(npm test\)/);
  calls.length = 0;
  named(el, "Always allow").dispatch("click");
  await settle();
  assert.deepEqual(postsMade(), [["/memory/items/31", { status: "confirmed" }]]);
  assert.deepEqual(toasts.at(-1), { msg: "Always allowed: Bash(npm test)", kind: undefined });
  calls.length = 0;
  named(el, "Dismiss").dispatch("click");
  await settle();
  assert.deepEqual(postsMade(), [["/memory/items/31", { status: "dismissed" }]]);
  calls.length = 0;
  named(el, "Always allowed").dispatch("click");
  await settle();
  assert.deepEqual(gets(), ["/memory/items?kind=permission&status=confirmed&limit=200"]);
  assert.match(textOf(el), /Bash\(git status\)/);
  assert.equal(named(el, "Always allow"), undefined, "one always allowed is offered no Always allow");
  assert.ok(named(el, "Dismiss"));
  named(el, "Dismissed").dispatch("click");
  await settle();
  assert.match(textOf(el), /Nothing dismissed/);
});

// (fails before: yes — the Archive card said only that the archive "could not be opened", whatever the reason)
test("the Memory page's Archive card says why the archive did not open, in the archive's own words", async () => {
  const refusal = "H:/m/archive.db was written by another build of Filament (archive version 16; this build reads version 17). Run `npm run reset` for a clean slate: it keeps how Filament is reached, your upstreams and your routes, and starts everything else over.";
  const base = /** @type {any} */ (await import("../src/ui/runtime.js")).ui;
  const api = base.api; // the binding below replaces it on the same object
  bindUi({
    ...base,
    memEnginePill: () => fakeH("span", { class: "pill" }, "ready"),
    memStatus: async () => ({ enabled: true, folder: "H:/m", folderExists: true, manifest: {}, engine: { installed: true, counts: {} }, archive: null, archiveError: refusal, autopilot: {}, backups: {}, models: { learnsWith: "glm-5.3" } }),
    api: async (/** @type {string} */ path, /** @type {any} */ o) => (path.startsWith("/memory/activity") ? { activity: [] } : api(path, o)),
  });
  const page = memory();
  await settle();
  const card = all(page, (n) => n.tag === "section" && textOf(n).startsWith("Archive|"))[0];
  assert.ok(card, textOf(page).slice(0, 400));
  assert.ok(textOf(card).includes(refusal), textOf(card));
  assert.doesNotMatch(textOf(card), /could not be opened/);
});

// (fails before: yes — the owner's top complaint, Filament crawls: the archive's messages were summed at each read of the
// status; counted once in the background, the card said "–" for them, as for a figure that is not there)
test("the Memory page's Archive card says its messages are being counted, and reads again until they are", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const figures = { projects: 1, chains: 2, turns: 3, items: 4, compactions: 0, trimSlices: 0, injections: 5 };
  /** @type {any[]} */
  const asked = [];
  const answers = [{ ...figures, messages: null, bytes: null, counting: true }, { ...figures, messages: 630_696, bytes: 2_818_793_842 }];
  const base = /** @type {any} */ (await import("../src/ui/runtime.js")).ui;
  const api = base.api; // the binding below replaces it on the same object
  bindUi({
    ...base,
    memEnginePill: () => fakeH("span", { class: "pill" }, "ready"),
    memBytes: (/** @type {number | null} */ n) => (n == null ? "–" : `${n} B`),
    memStatus: async (/** @type {any} */ o = {}) => (asked.push(o), { enabled: true, folder: "H:/m", folderExists: true, manifest: {}, engine: { installed: true, counts: {} }, archive: answers[Math.min(asked.length - 1, 1)], autopilot: {}, backups: {}, models: { learnsWith: "glm-5.3" } }),
    api: async (/** @type {string} */ path, /** @type {any} */ o) => (path.startsWith("/memory/activity") ? { activity: [] } : api(path, o)),
  });
  const page = memory();
  const box = page.kids.at(-1);
  box.isConnected = true;
  await settle();
  const card = () => all(page, (n) => n.tag === "section" && textOf(n).startsWith("Archive|"))[0];
  assert.match(textOf(card()), /Messages\|counting…\|counted once, in the background/, textOf(card()));
  assert.equal(asked.length, 1);
  t.mock.timers.tick(3000);
  await settle();
  assert.equal(asked.length, 2, "read again while it counts");
  assert.equal(asked[1].fresh, true, "past the status's five-second keep");
  assert.match(textOf(card()), new RegExp(`Messages\\|${fmt.n(630_696)}\\|2818793842 B`), textOf(card()));
  t.mock.timers.tick(10_000);
  await settle();
  assert.equal(asked.length, 2, "counted: nothing more to read");
});

// (fails before: yes — MEMR-8: an engine Filament restarted after it stalled left no word of it on the Memory page)
test("the Memory page's Engine card says when the engine stalled, the calls it held, and that Filament restarted it", async () => {
  const stalled = { at: Date.parse("2026-10-30T10:42:00"), quietMs: 61_000, calls: 1, ops: ["recall"], pid: 9, count: 1 };
  const base = /** @type {any} */ (await import("../src/ui/runtime.js")).ui;
  const api = base.api; // the binding below replaces it on the same object
  bindUi({
    ...base,
    memEnginePill: () => fakeH("span", { class: "pill" }, "ready"),
    memStatus: async () => ({ enabled: true, folder: "H:/m", folderExists: true, manifest: {}, engine: { installed: true, state: "ready", counts: {}, stalled }, archive: null, archiveError: "not opened here", autopilot: {}, backups: {}, models: { learnsWith: "glm-5.3" } }),
    api: async (/** @type {string} */ path, /** @type {any} */ o) => (path.startsWith("/memory/activity") ? { activity: [] } : api(path, o)),
  });
  const page = memory();
  await settle();
  const card = all(page, (n) => n.tag === "section" && textOf(n).startsWith("Engine|"))[0];
  assert.ok(card, textOf(page).slice(0, 400));
  assert.ok(textOf(card).includes(String(stallWords(stalled))), textOf(card));
  assert.match(String(stallWords(stalled)), /^At .+ the engine answered nothing for 61 s, not even a ping, with a call \(recall\) in flight: Filament restarted it, and that call ended with an error\.$/);
});

// (fails before: yes — the Memories, Sessions and Activity tabs said only that the archive could not be opened, with the
// engine's last error or a pointer to the folder and the log, never the archive's own words)
test("a memory tab whose archive did not open says why, in the archive's own words", async () => {
  const refusal = "H:/m/archive.db was written by another build of Filament (archive version 16; this build reads version 17). Run `npm run reset` for a clean slate: it keeps how Filament is reached, your upstreams and your routes, and starts everything else over.";
  bindUi({
    memOffPanel: () => fakeH("p", {}, "Memory is off"),
    memStatus: async () => ({ enabled: true, folder: "H:/m", archive: null, archiveError: refusal, engine: { installed: true, lastError: "the engine stopped" } }),
  });
  const tab = memGate(() => assert.fail("a tab is built only over an open archive"));
  await settle();
  assert.equal(textOf(tab), `The archive could not be opened|${refusal}`);
});

test("the Memories page: the claims and memory's questions first, no word from before claims, and Remember says where", async () => {
  const page = memories();
  await settle();
  const words = textOf(page);
  const panels = all(page, (n) => n.tag === "section");
  assert.match(textOf(panels[0]), /^Memories\|/);
  assert.match(textOf(panels[1]), /^Memory asks/);
  for (const stale of [/Learned items/, /\bcanon\b/i, /\bSleep\b/, /review queue/]) assert.doesNotMatch(words, stale);
  assert.match(words, /Identity facts/);
  assert.match(words, /@mem curate/);
  const note = tagged(page, "textarea").find((t) => /every model should know/.test(t.attrs.placeholder || ""));
  const selects = tagged(page, "select");
  const kind = selects.find((s) => tagged(s, "option").some((o) => o.attrs.value === "procedure"));
  const where = selects.find((s) => s.attrs.title === "Everywhere, or only in one project's sessions");
  assert.deepEqual(tagged(where, "option").map(textOf), ["everywhere", "filament"]);
  note.value = "Always run the e2e suite before a release.";
  kind.value = "rule";
  where.value = "p1";
  calls.length = 0;
  click(page, "Remember this");
  await settle();
  assert.deepEqual(postsMade(), [["/memory/remember", { text: "Always run the e2e suite before a release.", kind: "rule", project: "p1" }]]);
  assert.ok(gets().includes("/memory/claims/scopes"), "the claims are read again");
});

test("the Projects page: how many memories stand, Memories → opens them, the dossier in place of canon", async () => {
  const page = projects();
  await settle();
  const words = textOf(page);
  assert.doesNotMatch(words, /\bcanon\b/i);
  assert.match(words, /dossier/);
  assert.match(words, /Memories\|3\|standing claims/, "the count is the claim browser's, not every item's");
  assert.match(words, /Last activity\|2 h ago/, "when memory last saw the project (`last_seen`, the field projects() has; M6-7)");
  click(page, "Memories →");
  assert.deepEqual(state.memClaims, { scope: "p1", state: "standing", kind: "", q: "" });
  assert.deepEqual(went, ["memories"]);
});

test("Memory's model: one picker — not set, off, then every route; an empty custom name is not set", async () => {
  state.config = { routes: [{ match: "free-model", upstream: "a", fallbacks: [{ upstream: "b" }], enabled: true }] };
  const M = { models: { summarizer: "" } };
  const S = { models: { _doc: "", summarizer: {} } };
  const el = memoryModelsPanel(S, M);
  await settle();
  // (fails before: yes — three pickers, the first "chosen for you — the cheapest model you connected that has a price")
  const selects = tagged(el, "select");
  assert.equal(selects.length, 1, "the curator's and the rewriter's pickers went: memory has one model");
  const [learns] = selects;
  const offered = (/** @type {any} */ s) => tagged(s, "option").map((o) => o.attrs.value);
  assert.deepEqual(offered(learns), ["", "off", "free-model", "glm-5.3", "claude-code", "__custom__"], "a coding agent stays (M6-D9)");
  const chosen = (/** @type {any} */ s) => tagged(s, "option").filter((o) => o.attrs.selected === "").map((o) => o.attrs.value);
  assert.deepEqual(chosen(learns), [""]);
  assert.deepEqual(tagged(learns, "option").slice(0, 2).map((o) => textOf(o)), ["not set — each chat's compaction model, else the chat's own model", "off — memory learns nothing from finished sessions"]);
  assert.doesNotMatch(textOf(el), /cheapest/);
  learns.value = "glm-5.3";
  learns.onchange();
  assert.equal(M.models.summarizer, "glm-5.3");
  assert.equal(state.dirty, true);
  learns.value = "__custom__";
  learns.onchange();
  assert.equal(M.models.summarizer, "", "an empty custom name is not set");
  const custom = tagged(el, "input").find((i) => i.attrs.class === "mono");
  custom.value = "my-model";
  custom.oninput();
  assert.equal(M.models.summarizer, "my-model");
  assert.match(textOf(el), /Memory learns nothing from finished sessions: no model to call\| · the curator works by rule alone\|\./);
});

test("Memory's model says what memory works with now, and nothing where there is none (never a printed null)", async () => {
  state.config = { routes: [] };
  const S = { models: { _doc: "", summarizer: {} } };
  const nowOf = (/** @type {any} */ panel) => textOf(all(panel, (n) => n.tag === "div" && /reading which model|works with|Not set|learns nothing/.test(textOf(n)) && n.kids.length > 1).at(-1));
  const said = async (/** @type {any} */ models) => {
    bindUi({ ...(/** @type {any} */ (await import("../src/ui/runtime.js")).ui), api: async () => ({ models }) });
    const panel = memoryModelsPanel(S, { models: { summarizer: models.summarizer } });
    await settle();
    assert.doesNotMatch(textOf(panel), /null/);
    return nowOf(panel);
  };
  assert.equal(await said({ summarizer: "glm-5.3", effort: "", curatorUsesModel: true, now: "glm-5.3", from: "memory", whyNone: null }), "Memory works with |glm-5.3|.");
  assert.equal(
    await said({ summarizer: "", effort: "", curatorUsesModel: true, now: "glm-5.3", from: "default", whyNone: null }),
    "Not set: each chat's compaction model, else its own; where no chat is named, |glm-5.3|.",
  );
  assert.equal(
    await said({ summarizer: "off", effort: "", curatorUsesModel: false, now: null, from: "off", whyNone: "memory's model is off (Settings › Memory › Model)" }),
    "Memory learns nothing from finished sessions: memory's model is off| · the curator works by rule alone|.",
  );
});

test("what memory learns with, in words (m1): the model set, else each chat's own, or why there is none", () => {
  assert.deepEqual(learnsWith({ summarizer: "", now: "glm-5.3", from: "default" }), { model: "glm-5.3", chosen: true, off: false, why: "" });
  assert.deepEqual(learnsWith({ summarizer: "glm-5.3", now: "glm-5.3", from: "memory" }), { model: "glm-5.3", chosen: false, off: false, why: "" });
  assert.deepEqual(learnsWith({ summarizer: "off", now: null, from: "off" }), { model: null, chosen: false, off: true, why: "memory's model is off" });
  assert.deepEqual(learnsWith({ summarizer: "", now: null, from: "none", whyNone: "no model to call" }), { model: null, chosen: false, off: false, why: "no model to call" });
  assert.deepEqual(learnsWith(undefined), { model: null, chosen: false, off: false, why: "no model memory can call" }, "a status from before the models were said");
});

// (fails before: yes — L2's tour, tour4: with nothing able to answer, the hub, Memory → Settings and the import panel
// said nothing was priced)
test("with no model to call, memory's reason is the service's words, never a price (m1)", () => {
  const why = "no model to call: set one in Settings › Memory › Model";
  assert.deepEqual(learnsWith({ summarizer: "auto", now: null, from: "none", whyNone: why }), { model: null, chosen: false, off: false, why }, "auto, as an older config says it, is not set");
});

// ---- live (HarnessV3-Memory M7-D37): memory's changes, heard on the events stream ----
/** A page of changes on the stream, chained after the one before (`n` its place). @param {number} n @param {any[]} changes */
const page = (n, ...changes) => ({ type: "claims", prev: `e1:${n - 1}`, last: `e1:${n}`, changes });
/** A change as the feed says it. @param {string | null} claim @param {string} action @param {string | null} project @param {Record<string, any>} [more] */
const change = (claim, action, project, more = {}) => ({ type: "change", id: "e1:0", claim, action, at: "2026-10-03T12:00:00.000Z", by: "learner", project, session: "c9", ...more });
const LIST = "/memory/claims?state=standing&project=p1";

test("the claim browser reads again what a change touches, and nothing else; a correction being written waits; a tab left lets go (M7-D37)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { claimsEl } = await openBrowser();
  /** What the panels read for these messages. @param {any[]} msgs */
  const readFor = async (...msgs) => {
    calls.length = 0;
    for (const m of msgs) say(m);
    t.mock.timers.tick(250);
    await settle();
    return gets().sort();
  };
  assert.deepEqual(await readFor(page(1, change("i99", "evidence", "p2"))), [], "another project's claim");
  assert.deepEqual(await readFor(page(2, change("i7", "evidence", "p1"))), [LIST], "a claim of this project: its list");
  assert.deepEqual(await readFor(page(3, change("i40", "created", "p1"))), ["/memory/claims/scopes", LIST], "a claim filed here: the counts and the list");
  assert.deepEqual(await readFor(page(4, change("i31", "asked", null, { by: "curator" }))), ["/memory/inbox?project=p1"], "a question about a global claim");
  assert.deepEqual(await readFor(page(5, change("i9", "fired", "p1")), page(6, change("i12", "evidence", "p1"))), [LIST], "a burst is read once");
  click(rowsOf(claimsEl).i12, "History ▾");
  await settle();
  assert.deepEqual(await readFor(page(7, change("i12", "status", "p1", { by: "curator" }))), ["/memory/claims/scopes", LIST, "/memory/items/12/history"].sort(), "an open history whose claim changed");
  assert.deepEqual(await readFor({ type: "claims", prev: "e1:30", last: "e1:31", changes: [] }), ["/memory/claims/scopes", "/memory/inbox?project=p1", LIST, "/memory/items/12/history"].sort(), "a message missed: everything");
  // A correction being written: the list waits, the words stay; put away, what changed is read.
  click(rowsOf(claimsEl).i7, "Correct");
  const field = tagged(claimsEl, "textarea")[0];
  assert.deepEqual(await readFor(page(32, change("i7", "status", "p1", { by: "curator" }))), ["/memory/claims/scopes"], "the counts only");
  assert.deepEqual(await readFor({ type: "hello" }), [], "a reconnect waits too");
  assert.equal(tagged(claimsEl, "textarea")[0], field, "the words being written stay");
  calls.length = 0;
  click(claimsEl, "Cancel");
  await settle();
  assert.deepEqual(gets().sort(), ["/memory/claims/scopes", "/memory/inbox?project=p1", LIST, "/memory/items/12/history"].sort(), "put away: read");
  calls.length = 0;
  click(rowsOf(claimsEl).i7, "Correct");
  click(claimsEl, "Cancel");
  await settle();
  assert.deepEqual(gets(), [], "read, it is owed no more");
  // The tab left: the next message lets go, and nothing is read.
  /** @type {any} */ (claimsEl).isConnected = false;
  assert.deepEqual(await readFor(page(33, change("i7", "status", "p1"))), []);
  assert.equal(listeners.size, 0);
});

test("a Projects card's dossier reads again on a change in its project while shown, and on a rewrite even hidden (M7-D37)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const el = dossierView({ id: "p1", name: "filament", dossier: 1 });
  /** @param {any[]} msgs */
  const readFor = async (...msgs) => {
    calls.length = 0;
    for (const m of msgs) say(m);
    t.mock.timers.tick(250);
    await settle();
    return gets();
  };
  assert.deepEqual(await readFor({ type: "hello" }), [], "hidden and never read: nothing to read again");
  assert.deepEqual(await readFor(page(1, change("i7", "evidence", "p1"))), [], "hidden: a claim's change waits for Show");
  assert.deepEqual(await readFor(page(2, change("i7", "evidence", "p1"), change(null, "dossier", "p2", { by: "curator", session: null }))), [], "another project's dossier");
  assert.deepEqual(await readFor(page(3, change(null, "dossier", "p1", { by: "curator", session: null }))), ["/memory/dossier?project=p1"], "rewritten: read, hidden or not");
  assert.match(textOf(el), /^Dossier v2,/, "its version is the new one");
  click(el, "Show");
  await settle();
  assert.deepEqual(await readFor(page(4, change("i7", "status", "p1", { by: "curator" }))), ["/memory/dossier?project=p1"], "shown: a claim of its project changed");
  assert.deepEqual(await readFor(page(5, change("i31", "status", "p2"))), [], "another project's claim");
  assert.deepEqual(await readFor({ type: "hello" }), ["/memory/dossier?project=p1"], "a reconnect");
  el.isConnected = false;
  assert.deepEqual(await readFor(page(6, change(null, "dossier", "p1"))), []);
  assert.equal(listeners.size, 0);
});

/** The panels' reads for these messages, the collect window passed. @param {any} t @param {any[]} msgs */
const readFor = async (t, ...msgs) => {
  calls.length = 0;
  for (const m of msgs) say(m);
  t.mock.timers.tick(250);
  await settle();
  return gets().sort();
};

test("Everywhere: a change to a claim its list shows is read, wherever the claim went (M7-D37)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await openBrowser({ scope: null });
  assert.deepEqual(await readFor(t, page(1, change("i7", "moved", "p1", { by: "owner" }))), ["/memory/claims/scopes", "/memory/claims?state=standing"]);
});

test("the project shown, deleted elsewhere: the tab goes where it opens, once a correction being written is put away (M7-D37)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { S, claimsEl } = await openBrowser();
  click(rowsOf(claimsEl).i7, "Correct");
  const field = tagged(claimsEl, "textarea")[0];
  scopes = SCOPES.filter((s) => s.project !== "p1");
  const gone = change(null, "deleted", "p1", { by: "owner", session: null });
  assert.deepEqual(await readFor(t, page(1, gone)), ["/memory/claims/scopes"], "the scopes: the words being written stay");
  assert.deepEqual([S.scope, tagged(claimsEl, "textarea")[0]], ["p1", field]);
  calls.length = 0;
  click(claimsEl, "Cancel");
  await settle();
  assert.equal(S.scope, null, "where it opens: everywhere, no project holding a memory");
  assert.ok(gets().includes("/memory/claims?state=standing") && gets().includes("/memory/inbox"), gets().join("\n"));
  assert.equal(tagged(claimsEl, "select")[0].value, "");
  // Hands free: at once.
  scopes = SCOPES;
  assert.ok((await readFor(t, { type: "hello" })).includes("/memory/claims/scopes"));
  const where = tagged(claimsEl, "select")[0];
  where.value = "p1";
  where.dispatch("change");
  await settle();
  scopes = SCOPES.filter((s) => s.project !== "p1");
  assert.deepEqual(await readFor(t, page(2, gone)), ["/memory/claims/scopes", "/memory/claims?state=standing", "/memory/inbox"].sort());
  assert.equal(S.scope, null);
});

test("the questions are the scope picked last: a read overtaken by a newer one is dropped", async () => {
  const { asksEl, claimsEl } = await openBrowser();
  /** @type {(v: any) => void} */
  let late = () => {};
  holds.set("/memory/inbox?project=p1", () => new Promise((r) => (late = r)));
  const where = tagged(claimsEl, "select")[0];
  where.value = "p1";
  where.dispatch("change");
  await settle();
  questions = [];
  where.value = "";
  where.dispatch("change");
  await settle();
  late({ questions: [QUESTION] });
  await settle();
  assert.match(textOf(asksEl), /Memory asks nothing here/, "everywhere asks nothing: p1's late answer is not its");
  // The owner's word paints the questions from what was read, before it is sent: still everywhere's, not p1's.
  button(rowsOf(claimsEl).i12, "Confirm").dispatch("click");
  assert.match(textOf(asksEl), /Memory asks nothing here/, "nor kept for the next paint");
  await settle();
});

test("a Projects card whose project is deleted elsewhere says so, and reads nothing more (M7-D37)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const el = dossierView({ id: "p1", name: "filament", dossier: 1 });
  click(el, "Show");
  await settle();
  assert.match(textOf(el), /^Dossier v2,/);
  assert.deepEqual(await readFor(t, page(1, change(null, "deleted", "p2", { by: "owner", session: null }))), [], "another project went");
  assert.deepEqual(await readFor(t, page(2, change("i7", "deleted", "p1", { by: "owner" }))), ["/memory/dossier?project=p1"], "a claim of it went: read, it may have cited it");
  assert.match(textOf(el), /^Dossier v2,/);
  const gone = change(null, "deleted", "p1", { by: "owner", session: null });
  assert.deepEqual(await readFor(t, page(3, change("i9", "deleted", "p1", { by: "owner" }), gone)), [], "its claims and the project went: nothing to read");
  assert.equal(textOf(el), "This project was deleted: its dossier went with it.");
  assert.equal(listeners.size, 0, "let go");
  // Deleted while this tab was away: the read after the reconnect finds no project, and says so, not as a failure.
  const other = dossierView({ id: "p1", name: "filament", dossier: 1 });
  click(other, "Show");
  await settle();
  holds.set("/memory/dossier?project=p1", async () => {
    throw Object.assign(new Error("no such project"), { status: 404, body: { error: "no such project" } });
  });
  toasts.length = 0;
  assert.deepEqual(await readFor(t, { type: "hello" }), ["/memory/dossier?project=p1"]);
  assert.deepEqual([textOf(other), toasts, listeners.size], ["This project was deleted: its dossier went with it.", [], 0]);
});

test("Memory → Overview's How models did (M7-D53): a row per model and kind with how its runs ended, its medians and cost, a line per thing they did; every workspace or one, over a window, of a kind of work; a workspace gone falls back; nothing yet, said; a refusal, said", async () => {
  const S = {};
  const el = outcomesPanel(S);
  await settle();
  assert.deepEqual(gets(), ["/memory/claims/scopes", "/memory/outcomes?days=30"]);
  assert.deepEqual({ ...S }, { days: "30", kind: "", project: null }, "the picks it starts on");
  assert.equal(textOf(tagged(el, "h2")[0]), "How models did");
  assert.ok(textOf(el).includes("A record for you to read; Filament never picks or switches a model by it."));
  assert.deepEqual(tagged(el, "th").map((t) => textOf(t)), ["Model", "Runs", "Held", "Corrected · failed · stopped", "Rounds", "Time", "A run", "Cost"]);
  assert.deepEqual(all(el, cls("mo-group")).map((r) => textOf(r)), [
    "glm-5.3|5 turns|60%|1 corrected · 1 failed|4|1.4 min|$0.0040|$0.02 in all, over the 4 priced",
    "grok-4.6|2 agent runs|0%|1 corrected · 1 stopped|2.5|950 ms|–|no price known",
  ]);
  assert.deepEqual(all(el, cls("mo-did")).map((r) => textOf(r)), ["Ran tests|2 of 3 held|1 corrected", "Delegated|1 of 2 held|1 failed", "Answered|0 of 2 held|1 corrected · 1 stopped"]);
  const bar = all(el, cls("mo-bar"))[0];
  assert.equal(bar.attrs["aria-label"], "3 of 5 held");
  assert.deepEqual(bar.kids.map((/** @type {any} */ s) => [s.attrs.class, s.attrs.style]), [["mo-seg is-held", "flex:3"], ["mo-seg is-corrected", "flex:1"], ["mo-seg is-failed", "flex:1"]]);
  assert.ok(textOf(el).endsWith("7 runs · rounds and time are medians · a run's cost is over the runs with a price"));
  const selects = tagged(el, "select");
  assert.deepEqual(selects.map((x) => x.attrs["aria-label"]), ["Workspace", "Over the last", "Kind of work"]);
  assert.deepEqual(all(el, cls("toolbar")).map((t) => tagged(t, "select").length), [3], "the pickers sit in a toolbar, whose selects keep their own width beside the heading (style.css .toolbar select)");
  // (fails before: yes — at 960 px the drive saw "brain-5-1" and "28 ms" broken over two lines: the table squeezed its words to fit)
  assert.deepEqual(all(el, cls("table-wrap")).map((t) => tagged(t, "table").length), [1], "a narrow window scrolls the table, never squeezes it");
  const css = readFileSync("src/ui/style.css", "utf8");
  const nowrap = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].filter((m) => /white-space:\s*nowrap/.test(m[2])).flatMap((m) => m[1].split(",").map((x) => x.trim()));
  assert.deepEqual([".mem-outcomes td code", ".mem-outcomes td.num"].filter((x) => !nowrap.includes(x)), [], "a model's name and each number stay on one line");
  assert.deepEqual(tagged(selects[0], "option").map((o) => [o.attrs.value, textOf(o)]), [["", "Every workspace"], ["p1", "filament"], ["p2", "other"]]);
  /** Picks `value` on the select labelled `label`. @param {string} label @param {string} value */
  const choose = async (label, value) => {
    const sel = tagged(el, "select").find((x) => x.attrs["aria-label"] === label);
    sel.value = value;
    sel.dispatch("change");
    await settle();
  };
  await choose("Workspace", "p1");
  await choose("Over the last", "90");
  await choose("Kind of work", "subagent");
  assert.deepEqual(gets().slice(2), ["/memory/outcomes?days=30&project=p1", "/memory/outcomes?days=90&project=p1", "/memory/outcomes?days=90&project=p1&kind=subagent"]);
  assert.deepEqual({ ...S }, { days: "90", kind: "subagent", project: "p1" });
  assert.deepEqual(tagged(tagged(el, "select")[0], "option").filter((o) => o.attrs.selected === "").map((o) => o.attrs.value), ["p1"], "the pick shows");
  outcomesFor = () => ({ ...OUTCOMES, runs: 0, groups: [] });
  await choose("Workspace", "");
  assert.equal(S.project, null);
  assert.equal(textOf(el).split("|").at(-1), "No finished agent runs anywhere in the last 90 days. A turn's outcome is kept when it ends, an agent's or a team worker's when its run does.");
  outcomesFor = () => { throw Object.assign(new Error("HTTP 503"), { body: { error: "Memory has not started." } }); };
  await choose("Over the last", "7");
  assert.equal(all(el, cls("err"))[0] && textOf(all(el, cls("err"))[0]), "Memory has not started.");
  // A read overtaken by a newer pick is dropped: the year's answer comes after the 30 days', and is not shown.
  outcomesFor = () => structuredClone(OUTCOMES);
  /** @type {(v: any) => void} */
  let late = () => {};
  holds.set("/memory/outcomes?days=365&kind=subagent", () => new Promise((r) => (late = r)));
  await choose("Over the last", "365");
  await choose("Over the last", "30");
  assert.equal(holds.size, 0, "the year was asked");
  late({ ...OUTCOMES, runs: 0, groups: [] });
  await settle();
  assert.equal(all(el, cls("mo-group")).length, 2, "the newer pick's answer stays");
  const sub = OUTCOMES.groups[1];
  outcomesFor = () => ({ ...OUTCOMES, runs: 1, groups: [{ ...sub, runs: 1, done: 0, corrected: 0, did: [{ ...sub.did[0], runs: 1, done: 0, corrected: 0 }] }] });
  await choose("Over the last", "90");
  assert.deepEqual([all(el, cls("mo-group")).map((r) => textOf(r)), textOf(el).split("|").at(-1)], [["grok-4.6|1 agent run|0%|1 stopped|2.5|950 ms|–|no price known"], "1 run · rounds and time are medians · a run's cost is over the runs with a price"], "one run");
  calls.length = 0;
  const gone = { project: "p9", days: "14", kind: "bogus" };
  outcomesPanel(gone);
  await settle();
  assert.deepEqual(gone, { project: null, days: "30", kind: "" }, "a workspace gone since, a window and a kind it does not offer: every workspace, the defaults");
  assert.deepEqual(gets(), ["/memory/claims/scopes", "/memory/outcomes?days=30&project=p9", "/memory/outcomes?days=30"], "read again for every workspace");
});
