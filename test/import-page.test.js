// @ts-check
// Settings → Import (HarnessV4_Tasks E17, the plan: HarnessV4_Import_Plan in the vault): the section's words as pure
// functions, then the page on the fake DOM over a scripted stand-in for the admin routes — the Sync card that says
// what a click brings before the click, the agents' rows, a run's bar with Stop wherever it was started, how a run
// ended, Browse with its states and buttons, and memory's part. Every call is recorded.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  renderImport,
  importKeeper,
  syncSays,
  agentSays,
  holdsWords,
  inFilament,
  tightSays,
  lastSays,
  lastReadSays,
  runSays,
  endSays,
  browseGroups,
  chatFilter,
  nothingNew,
  sizeWords,
  whenWords,
  countWords,
  reachWords,
  STATE_WORDS,
} from "../src/ui/harness/settings/import.js";
import { SECTIONS } from "../src/ui/harness/settings/page.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { all, every, one, btn, field, type, pick, settle } from "./helpers/agents-page.js";

const MB = 1 << 20;
const NOW = new Date(2026, 9, 14, 15, 30).getTime();
const at = (/** @type {number} */ daysAgo, h = 14, min = 2) => new Date(2026, 9, 14 - daysAgo, h, min).getTime();

const CLAUDE = {
  id: "claude-code", label: "Claude Code", where: "C:\\Users\\me\\.claude\\projects", found: true, on: true,
  chats: 79, bytes: 5.7 * 1024 * MB, projects: 20,
  states: { new: 60, grown: 2, imported: 12, own: 1, removed: 4 },
  pending: { chats: 3, bytes: 212 * MB },
};
const CODEX = { id: "codex", label: "Codex", where: "C:\\Users\\me\\.codex\\sessions", found: true, on: true, chats: 60, bytes: 7 * MB, projects: 4, states: { new: 1, own: 59 }, pending: { chats: 1, bytes: 1 * MB } };
const CURSOR = { id: "cursor", label: "Cursor", where: "C:\\Users\\me\\.cursor\\projects", found: false, on: true, chats: 0, bytes: 0, projects: 0, states: {}, pending: { chats: 0, bytes: 0 } };
const OVERVIEW = {
  prefs: { reachDays: 30, on: ["claude-code", "codex", "cursor"], learn: false },
  reaches: [7, 30, 90, 0],
  last: { by: "sync", at: at(0), reachDays: 30, chats: 9, newChats: 9, newTurns: 1203, errors: [], sources: {} },
  free: 40 * 1024 * MB,
  sources: [CLAUDE, CODEX, CURSOR],
  unread: { chats: 14, passes: 80 },
  job: null,
  reading: null,
  learner: { model: "glm-5.3-flash", why: null },
};
const chat = (/** @type {string} */ id, /** @type {string} */ cwd, /** @type {string} */ state, /** @type {Record<string, any>} */ more = {}) => ({
  id, key: `cc:${id}`, agentSession: id, cwd, preview: `first words of ${id}`, startedAt: at(3), lastAt: at(1, 9, 10), bytes: 4.2 * MB, mark: 1,
  state, chain: null, turns: null, title: null, ...more,
});
const CHATS = [
  chat("a1", "H:\\shop", "new", { lastAt: at(0, 11, 5) }),
  chat("b1", "H:\\notes\\daily", "grown", { chain: "chainB1", turns: 31, title: "Daily notes" }),
  chat("a2", "H:\\shop", "imported", { chain: "chainA2", turns: 8, lastAt: at(40) }),
  chat("a3", "H:\\shop", "own"),
  chat("a4", "H:\\shop", "removed"),
];

/**
 * The section on the fake DOM. `overview`, `chats`: what the server holds; `answer(method, path, body, state)`: an
 * answer of the test's own (throw to refuse; undefined to let the stand-in answer); `cb`: the page's callbacks.
 * @param {{ overview?: any, chats?: any[], answer?: (method: string, path: string, body: any, state: any) => any }} [o]
 */
async function open(o = {}) {
  /** @type {[string, string, any][]} */
  const calls = [];
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  /** @type {any[]} */
  const sheets = [];
  /** @type {(() => void)[]} */
  const timers = [];
  /** @type {string[]} */
  const went = [];
  let sessions = 0;
  const state = { overview: structuredClone(o.overview ?? OVERVIEW), chats: structuredClone(o.chats ?? CHATS), /** @type {Map<string, any>} */ jobs: new Map() };
  const startJob = (/** @type {string} */ kind) => {
    const job = { id: `${kind}-1`, kind, status: "running", percent: 0, progress: [], stoppable: true };
    state.jobs.set(job.id, job);
    return job;
  };
  const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
    const method = init.method || "GET";
    calls.push([method, path, init.body]);
    const own = await o.answer?.(method, path, init.body, state);
    if (own !== undefined) return own;
    if (method === "GET" && path === "/memory/import/overview") return structuredClone(state.overview);
    if (method === "GET" && path === "/memory/import/chats?source=claude-code") return { source: "claude-code", label: "Claude Code", found: true, chats: structuredClone(state.chats) };
    if (method === "PUT" && path === "/memory/import/prefs") {
      Object.assign(state.overview.prefs, init.body);
      for (const s of state.overview.sources) s.on = state.overview.prefs.on.includes(s.id);
      return { prefs: state.overview.prefs };
    }
    if (method === "POST" && path === "/memory/import/sync") return { job: structuredClone(startJob("import-sync")) };
    if (method === "POST" && path === "/memory/import/chosen") return { job: structuredClone(startJob("import-claude-code")) };
    if (method === "POST" && path === "/memory/backfill") return { job: structuredClone(startJob("learn-backfill")) };
    const jobId = /^\/memory\/jobs\/([^/]+)(\/stop)?$/.exec(path);
    if (jobId && method === "GET") return structuredClone(state.jobs.get(decodeURIComponent(jobId[1])));
    if (jobId && method === "POST") return { stopped: true };
    throw new Error(`the stand-in has no answer for ${method} ${path}`);
  };
  const sheet = (/** @type {any} */ s) => {
    const rec = { ...s, closed: false, close() { if (rec.closed) return; rec.closed = true; s.onClose?.(); } };
    sheets.push(rec);
    return { el: rec, scroller: s.body, close: rec.close };
  };
  const body = fakeH("div");
  renderImport(body, { onToast: (msg, kind) => void toasts.push([msg, kind]), onSessions: () => void sessions++ },
    { h: fakeH, api, sheet: /** @type {any} */ (sheet), now: () => NOW, later: (fn) => void timers.push(fn), go: (hash) => void went.push(hash) });
  const first = textOf(body);
  await settle();
  return {
    body, first, calls, toasts, sheets, timers, went, state,
    /** The page's next look at its runs. */
    tick: async () => { for (const fn of timers.splice(0)) fn(); await settle(); },
    sessions: () => sessions,
    said: () => calls.map(([m, path]) => `${m} ${path}`),
  };
}
const press = async (/** @type {any} */ b) => { b.dispatch("click"); await settle(); };
const isOff = (/** @type {any} */ b) => "disabled" in b.attrs;
const agentRow = (/** @type {any} */ n, /** @type {string} */ id) => all(n, (x) => x.attrs?.["data-agent"] === id)[0];
const chatRow = (/** @type {any} */ n, /** @type {string} */ id) => all(n, (x) => x.attrs?.["data-chat"] === id)[0];

describe("Settings → Import: the words", () => {
  // (fails before: yes — there was no Import section: nothing said what a click would bring)
  test("sizes, counts, times and reaches read as a person says them", () => {
    assert.deepEqual([0, 900, 2048, 7 * MB, 212.4 * MB, 105.3 * MB, 1.4 * 1024 * MB, 5.7 * 1024 * MB].map(sizeWords), ["0 B", "900 B", "2 KB", "7 MB", "212 MB", "105 MB", "1.4 GB", "5.7 GB"]);
    assert.deepEqual([countWords(1, "chat"), countWords(0, "chat"), countWords(1203, "new turn"), countWords(2, "reply", "replies")], ["1 chat", "0 chats", "1,203 new turns", "2 replies"]);
    assert.equal(whenWords(at(0), NOW), "today 14:02");
    assert.equal(whenWords(at(1, 9, 5), NOW), "yesterday 09:05");
    assert.equal(whenWords(at(2), NOW), "12 Oct");
    assert.equal(whenWords(new Date(2025, 11, 3).getTime(), NOW), "3 Dec 2025");
    assert.deepEqual([7, 30, 90, 0].map(reachWords), ["7 days", "30 days", "90 days", "Everything"]);
    assert.deepEqual(STATE_WORDS, { new: "new", grown: "grown", imported: "in Filament", own: "ran through Filament", removed: "removed by you", empty: "nothing in it" });
  });

  // (fails before: yes)
  test("the Sync card says what a click brings, per agent and how big, and when there is nothing to click for", () => {
    assert.deepEqual(syncSays(OVERVIEW), { head: "4 chats are new or have grown", sub: "about 213 MB to read · Claude Code 3 · Codex 1", can: true, bytes: 213 * MB });
    const one = syncSays({ ...OVERVIEW, sources: [{ ...CLAUDE, pending: { chats: 1, bytes: 2 * MB } }] });
    assert.equal(one.head, "1 chat is new or has grown");
    // an agent switched off brings nothing, and is not counted
    assert.equal(syncSays({ ...OVERVIEW, sources: [{ ...CLAUDE, on: false }, CODEX] }).sub, "about 1 MB to read · Codex 1");
    const none = { ...CLAUDE, pending: { chats: 0, bytes: 0 } };
    assert.deepEqual(syncSays({ ...OVERVIEW, sources: [none] }), { head: "Up to date", sub: "No chat of the last 30 days is new or has grown.", can: false, bytes: 0 });
    assert.equal(syncSays({ ...OVERVIEW, prefs: { ...OVERVIEW.prefs, reachDays: 0 }, sources: [none] }).sub, "No chat is new or has grown.");
    assert.deepEqual(syncSays({ ...OVERVIEW, sources: [CURSOR] }), { head: "No coding agent's chats were found on this computer", sub: "", can: false, bytes: 0 });
    assert.equal(syncSays({ ...OVERVIEW, sources: [{ ...CLAUDE, on: false }] }).head, "Every agent is switched off");
  });

  // (fails before: yes)
  test("an agent's row says where its chats are and how they stand in Filament", () => {
    assert.deepEqual(agentSays(CLAUDE, 30), {
      found: "found",
      where: "C:\\Users\\me\\.claude\\projects · 79 chats in 20 projects · 5.7 GB",
      states: "14 in Filament · 3 new or grown in the last 30 days · 59 older than that (Browse brings them) · 1 ran through Filament, so it is here already · 4 removed by you",
    });
    // with no reach nothing is older, and the count of Filament's own is said so that 59 missing chats are no mystery
    assert.equal(agentSays({ ...CODEX, pending: { chats: 1, bytes: MB } }, 0).states, "0 in Filament · 1 new or grown · 59 ran through Filament, so they are here already");
    assert.equal(agentSays({ ...CODEX, states: { imported: 1, empty: 2, own: 57 }, pending: { chats: 0, bytes: 0 } }, 30).states, "1 in Filament · 57 ran through Filament, so they are here already · 2 with nothing in them");
    assert.deepEqual(agentSays(CURSOR, 30), { found: "not found", where: "Looked in C:\\Users\\me\\.cursor\\projects", states: "" });
    assert.deepEqual(agentSays({ ...CURSOR, found: true }, 30), { found: "found, no chats", where: "C:\\Users\\me\\.cursor\\projects", states: "" });
    // (fails before: yes — an agent whose store could not be read had no words of its own: the section failed whole)
    assert.deepEqual(agentSays({ ...CURSOR, found: true, error: "file is not a database" }, 30), { found: "found, cannot be read", where: "C:\\Users\\me\\.cursor\\projects", states: "file is not a database" });
  });

  // (fails before: yes — 11-12: the welcome tour's Your chats had none of this section's words for an agent's store in
  // short, nor for switches that stand above what a run would bring, and wrote its own a page away from the switches)
  test("what the welcome tour's Your chats says in this section's words: an agent's store in short, where the switches stand, the chats in Filament, a drive too full", () => {
    assert.equal(holdsWords(CLAUDE), "79 chats in 20 projects · 5.7 GB");
    assert.equal(holdsWords({ ...CODEX, chats: 1, projects: 1, about: true }), "1 chat in 1 project · about 7 MB");
    assert.equal(agentSays(CLAUDE, 30).where, `C:\\Users\\me\\.claude\\projects · ${holdsWords(CLAUDE)}`, "the row's own words are these");
    const off = { ...OVERVIEW, sources: [{ ...CLAUDE, on: false }] };
    assert.deepEqual([syncSays(off).sub, syncSays(off, "above").sub], ["Switch one on below, or bring single chats in through Browse.", "Switch one on above, or bring single chats in through Browse."]);
    assert.deepEqual([inFilament(OVERVIEW), inFilament({ sources: [] })], [14, 0], "imported whole, or grown since");
    assert.equal(tightSays({ ...OVERVIEW, free: 100 * MB }, syncSays(OVERVIEW)), "That is more than the 100 MB free on the drive Filament keeps its sessions on. Choose a shorter reach, or bring single chats in through Browse.");
    assert.deepEqual([tightSays(OVERVIEW, syncSays(OVERVIEW)), tightSays({ ...OVERVIEW, free: null }, syncSays(OVERVIEW))], [null, null], "room to spare, or the system does not say");
  });

  // (fails before: yes — the owner's of 11-12: the tour's Your chats lists the single chats to choose from, and this
  // section had no filter but inside Browse's groups, no words for nothing in reach but inside the Sync card's, and
  // one advice for a drive too full — a shorter reach, which a list of chosen chats has none of)
  test("what the welcome tour's list of single chats takes from this section: Browse's filter, nothing in reach, a drive too full with its own advice", () => {
    const kept = (/** @type {string | undefined} */ filter, list = CHATS) => list.filter(chatFilter(filter)).map((c) => c.id);
    assert.deepEqual([kept("  NOTES "), kept("words of a2"), kept("daily notes"), kept("nothing holds this")], [["b1"], ["a2"], ["b1"], []], "by folder whatever the case, by first words, by title");
    assert.deepEqual([kept(""), kept("   "), kept(undefined)].map((ids) => ids.length), [5, 5, 5], "no filter holds every chat");
    const lost = [chat("p1", "", "new", { project: "old-workspace" }), chat("a1", "H:\shop", "new", { project: "old-workspace" })];
    assert.deepEqual(kept("OLD-work", lost), ["p1"], "the name its agent gave the project is read where the chat's folder is not on this computer, and only there");
    for (const filter of ["", "  NOTES ", "words of a2", "daily notes", "shop", "nothing holds this"])
      assert.deepEqual(browseGroups(CHATS, filter).flatMap((g) => g.chats.map((c) => c.id)).sort(), kept(filter).sort(), `Browse keeps the same chats for "${filter}"`);
    assert.deepEqual([nothingNew(30), nothingNew(7), nothingNew(0)], ["No chat of the last 30 days is new or has grown.", "No chat of the last 7 days is new or has grown.", "No chat is new or has grown."]);
    const none = { ...OVERVIEW, sources: [{ ...CLAUDE, pending: { chats: 0, bytes: 0 } }] };
    assert.deepEqual([syncSays(none).sub, syncSays({ ...none, prefs: { ...OVERVIEW.prefs, reachDays: 0 } }).sub], [nothingNew(30), nothingNew(0)], "the Sync card's own words under Up to date are these");
    assert.equal(tightSays({ ...OVERVIEW, free: 100 * MB }, syncSays(OVERVIEW), "Choose fewer chats."), "That is more than the 100 MB free on the drive Filament keeps its sessions on. Choose fewer chats.");
    assert.equal(tightSays(OVERVIEW, syncSays(OVERVIEW), "Choose fewer chats."), null);
  });

  // (fails before: yes)
  test("the last run, a run under way, and how a run ended", () => {
    assert.equal(lastSays(null, NOW), "Nothing has been imported yet");
    assert.equal(lastSays(OVERVIEW.last, NOW), "Last sync: today 14:02 · 9 chats, 1,203 new turns");
    assert.equal(lastSays({ by: "browse", at: at(1), chats: 1, newTurns: 1, errors: [{}, {}] }, NOW), "Last import: yesterday 14:02 · 1 chat, 1 new turn · 2 files could not be read");
    assert.equal(lastSays({ by: "sync", at: at(0), chats: 0, newTurns: 0, errors: [] }, NOW), "Last sync: today 14:02 · nothing new");
    assert.equal(lastReadSays(null, NOW), null);
    assert.equal(lastReadSays({ at: at(1, 9, 5), learned: 12, considered: 14, nothing: 2, unread: [] }, NOW), "Last reading: yesterday 09:05 · 12 of 14 chats read");
    const label = (/** @type {string} */ id) => ({ "claude-code": "Claude Code" })[id] || id;
    assert.equal(runSays({ kind: "import-sync", percent: 61.6, progress: [{ step: "claude-code", done: 2, total: 14 }] }, label), "Claude Code · chat 3 of 14 · 62%");
    assert.equal(runSays({ kind: "import-sync", percent: 100, progress: [{ step: "claude-code", done: 14, total: 14 }] }, label), "Claude Code · chat 14 of 14 · 100%");
    assert.equal(runSays({ kind: "import-sync", percent: 0, progress: [] }, label), "0%");
    assert.equal(runSays({ kind: "learn-backfill", percent: 25, progress: [{ step: "learn", done: 3, total: 14 }] }, label), "Memory is reading chat 4 of 14");
    assert.equal(runSays({ kind: "learn-backfill", progress: [] }, label), "Memory is starting to read");
    assert.equal(runSays({ kind: "learn-backfill", progress: [{ step: "learn", done: 3, total: 14, unread: 2 }] }, label), "Memory is reading chat 4 of 14 · 2 left unread so far");

    const done = (/** @type {any} */ result) => endSays({ kind: "import-sync", status: "done", result }, label);
    assert.deepEqual(done({ chats: 9, newChats: 9, newTurns: 1203, errors: [] }), { tone: "good", text: "9 chats came in, 1,203 new turns.", errors: [] });
    assert.equal(done({ chats: 9, newChats: 4, newTurns: 30, errors: [] }).text, "9 chats came in, 30 new turns. 4 new, the rest had grown.");
    assert.equal(done({ chats: 0, newChats: 0, newTurns: 0, errors: [] }).text, "Nothing new came in.");
    assert.equal(done({ chats: 0, newChats: 0, newTurns: 0, empty: 1, errors: [] }).text, "Nothing new came in. 1 chat had nothing in it.");
    assert.equal(done({ chats: 2, newChats: 2, newTurns: 5, empty: 3, errors: [] }).text, "2 chats came in, 5 new turns. 3 chats had nothing in them.");
    assert.equal(done({ chats: 3, newChats: 0, newTurns: 0, errors: [] }).text, "Nothing new: 3 chats read, all in Filament already.");
    assert.deepEqual(done({ chats: 1, newChats: 1, newTurns: 2, errors: [{ source: "claude-code", file: "x.jsonl", error: "EBUSY: locked" }] }), {
      tone: "warn",
      text: "1 chat came in, 2 new turns. 1 file could not be read:",
      errors: ["Claude Code · x.jsonl: EBUSY: locked"],
    });
    assert.deepEqual(endSays({ kind: "import-sync", status: "error", stopped: true, error: "the import was stopped" }, label), { tone: "quiet", text: "Stopped. What was read stays, and the next run goes on from there.", errors: [] });
    assert.equal(endSays({ kind: "import-sync", status: "error", error: "SQLITE_FULL: database or disk is full" }, label).text, "The import failed: SQLITE_FULL: database or disk is full");
    assert.equal(endSays({ kind: "import", lost: "no such job" }, label).text, "Lost sight of the run: no such job");
    assert.equal(endSays({ kind: "learn-backfill", status: "done", result: { learned: 12, considered: 14 } }, label).text, "Memory read 12 of 14 chats.");
    // a chat left unread is said with why, and the ending is no plain success
    assert.deepEqual(endSays({ kind: "learn-backfill", status: "done", result: { learned: 1, considered: 4, nothing: 1, unread: [{ why: "the model did not answer in the form memory reads", chats: 2 }] } }, label),
      { tone: "warn", text: "Memory read 1 of 4 chats. 1 had nothing to read.", errors: ["2 chats left unread: the model did not answer in the form memory reads"] });
    assert.equal(endSays({ kind: "learn-backfill", status: "done", result: { learned: 4, considered: 4, nothing: 0, unread: [] } }, label).tone, "good");
    assert.equal(endSays({ kind: "learn-backfill", status: "error", stopped: true }, label).text, "Stopped. What memory read stays.");
    assert.equal(endSays({ kind: "learn-backfill", status: "error", error: "no learning model" }, label).text, "Memory's reading failed: no learning model");
  });

  // (fails before: yes — MEMR-10: a line too long to read failed its whole chat, and the run's end had no word for one)
  test("a run's end names each line too long to read, left out while the rest of its chat came in", () => {
    const label = (/** @type {string} */ id) => ({ "claude-code": "Claude Code", codex: "Codex" })[id] || id;
    const long = { source: "claude-code", file: "x.jsonl", line: 3, bytes: 300 * MB };
    assert.deepEqual(endSays({ kind: "import-sync", status: "done", result: { chats: 1, newChats: 1, newTurns: 2, errors: [], long: [long] } }, label), {
      tone: "warn",
      text: "1 chat came in, 2 new turns. 1 line too long to read was left out, the rest of its chat read:",
      errors: ["Claude Code · x.jsonl: line 3, 300 MB"],
    });
    const both = endSays({ kind: "import-sync", status: "done", result: { chats: 2, newChats: 2, newTurns: 4, errors: [{ source: "codex", file: "y.jsonl", error: "EBUSY: locked" }], long: [long, { ...long, line: 9 }] } }, label);
    assert.deepEqual(both, {
      tone: "warn",
      text: "2 chats came in, 4 new turns. 1 file could not be read; 2 lines too long to read were left out, the rest of their chats read:",
      errors: ["Codex · y.jsonl: EBUSY: locked", "Claude Code · x.jsonl: line 3, 300 MB", "Claude Code · x.jsonl: line 9, 300 MB"],
    });
  });

  // (fails before: yes)
  test("Browse groups an agent's chats by folder, the folder with the newest chat first, and filters by folder or words", () => {
    const groups = browseGroups(CHATS);
    assert.deepEqual(groups.map((g) => [g.cwd, g.chats.map((c) => c.id), g.open.map((c) => c.id)]), [
      ["H:\\shop", ["a1", "a2", "a3", "a4"], ["a1", "a4"]],
      ["H:\\notes\\daily", ["b1"], ["b1"]],
    ]);
    assert.deepEqual(browseGroups(CHATS, "  NOTES ").map((g) => g.cwd), ["H:\\notes\\daily"], "by folder, whatever the case");
    assert.deepEqual(browseGroups(CHATS, "words of a2").flatMap((g) => g.chats.map((c) => c.id)), ["a2"], "by a chat's first words");
    assert.deepEqual(browseGroups(CHATS, "daily notes").flatMap((g) => g.chats.map((c) => c.id)), ["b1"], "by its title");
    assert.deepEqual(browseGroups(CHATS, "nothing holds this"), []);
    assert.deepEqual(browseGroups([chat("z", "", "new")]).map((g) => g.cwd), [""], "a chat with no folder has a group too");
  });

  // (fails before: yes — every chat with no folder fell into one group, whatever project its agent filed it under)
  test("Browse groups chats whose folder is not on this computer by the name their agent gave the project", () => {
    const lost = [chat("p1", "", "new", { project: "old-workspace" }), chat("z", "", "new"), chat("p2", "", "imported", { project: "old-workspace" }), chat("q1", "", "new", { project: "other-workspace" }), chat("a1", "H:\\shop", "new", { project: "ignored beside a folder" })];
    assert.deepEqual(browseGroups(lost).map((g) => [g.cwd, g.project, g.chats.map((c) => c.id), g.open.map((c) => c.id)]), [
      ["", "old-workspace", ["p1", "p2"], ["p1"]],
      ["", "", ["z"], ["z"]],
      ["", "other-workspace", ["q1"], ["q1"]],
      ["H:\\shop", "", ["a1"], ["a1"]],
    ]);
    assert.deepEqual(browseGroups(lost, "OTHER-work").map((g) => g.project), ["other-workspace"], "the filter reads the name too");
  });
});

describe("Settings → Import: the page", () => {
  // (fails before: yes — Settings had no Import)
  test("Import stands in Settings' list under Filament, after Usage stats (HS-D5)", () => {
    const i = SECTIONS.findIndex((s) => s.id === "import");
    assert.deepEqual(SECTIONS[i], { id: "import", group: "Filament", label: "Import", icon: "download" });
    assert.equal(SECTIONS[i - 1].id, "usage");
  });

  // (fails before: yes)
  test("it opens saying it is looking, then shows what a Sync would bring, a row per agent, and memory's part, from one read", async () => {
    const p = await open();
    assert.equal(p.first, "Looking for your coding agents' chats…");
    assert.deepEqual(p.said(), ["GET /memory/import/overview"]);
    const card = one(p.body, "imp-sync");
    assert.equal(textOf(card), "4 chats are new or have grown|about 213 MB to read · Claude Code 3 · Codex 1|Sync now|Reaches back|7 days|30 days|90 days|Everything|40 GB free|Last sync: today 14:02 · 9 chats, 1,203 new turns");
    assert.equal(isOff(btn(card, "Sync now")), false);
    const reach = field(card, "Reaches back");
    assert.deepEqual(reach.kids.map((/** @type {any} */ k) => [k.attrs.value, "selected" in k.attrs]), [["7", false], ["30", true], ["90", false], ["0", false]]);
    assert.equal(every(card, "imp-callout").length, 0, "with room to spare nothing warns");
    // a row per agent the server lists, in its order
    assert.deepEqual(every(p.body, "imp-agent").map((r) => r.attrs["data-agent"]), ["claude-code", "codex", "cursor"]);
    const claude = agentRow(p.body, "claude-code");
    assert.ok(textOf(claude).startsWith("C|Claude Code|found|C:\\Users\\me\\.claude\\projects · 79 chats in 20 projects · 5.7 GB|14 in Filament · 3 new or grown in the last 30 days"), textOf(claude));
    assert.deepEqual(buttonsOf(claude).map((b) => textOf(b) || b.attrs["aria-label"]), ["Sync brings Claude Code's chats", "Browse"]);
    // an agent whose folder is not there says where it looked, and has nothing to press
    const cursor = agentRow(p.body, "cursor");
    assert.equal(textOf(cursor), "C|Cursor|not found|Looked in C:\\Users\\me\\.cursor\\projects");
    assert.deepEqual(buttonsOf(cursor), []);
    const memory = one(p.body, "imp-memory");
    assert.equal(textOf(memory), "Memory reads what is imported|On: each chat a Sync or an Import brings is read by memory with glm-5.3-flash, a call for every few turns. Off: importing calls no model.|14 imported chats are unread|About 80 calls to glm-5.3-flash.|Let memory read them");
    assert.equal(all(memory, (x) => x.attrs?.role === "switch")[0].attrs["aria-checked"], "false");
  });

  // (fails before: yes)
  test("Sync now: one click starts it, a bar says which agent and chat and how far, and the end says what came in", async () => {
    const p = await open();
    await press(btn(p.body, "Sync now"));
    assert.deepEqual(p.said().slice(1), ["POST /memory/import/sync"]);
    let card = one(p.body, "imp-sync");
    assert.ok(textOf(card).startsWith("Importing…|Sync now|0%|Stop|Reaches back"), textOf(card));
    assert.equal(isOff(btn(card, "Sync now")), true, "one import at a time");
    assert.equal(isOff(field(card, "Reaches back")), true);
    // the run moves on
    Object.assign(p.state.jobs.get("import-sync-1"), { percent: 62, progress: [{ step: "claude-code", done: 2, total: 4 }] });
    await p.tick();
    assert.equal(p.said().at(-1), "GET /memory/jobs/import-sync-1");
    assert.equal(textOf(one(p.body, "imp-run")), "Claude Code · chat 3 of 4 · 62%|Stop");
    assert.equal(one(p.body, "imp-bar").attrs["aria-valuenow"], "62");
    assert.equal(one(p.body, "imp-bar-fill").attrs.style, "width:62%");
    assert.equal(p.sessions(), 0);
    // it ends: the page reads everything again and the sidebar's list is told
    Object.assign(p.state.jobs.get("import-sync-1"), { status: "done", percent: 100, result: { by: "sync", chats: 4, newChats: 3, newTurns: 57, errors: [{ source: "codex", file: "rollout-1.jsonl", error: "EBUSY: locked" }] } });
    p.state.overview.sources = [{ ...CLAUDE, pending: { chats: 0, bytes: 0 } }, { ...CODEX, pending: { chats: 0, bytes: 0 } }, CURSOR];
    await p.tick();
    assert.deepEqual(p.said().slice(-2), ["GET /memory/jobs/import-sync-1", "GET /memory/import/overview"]);
    assert.equal(p.sessions(), 1);
    card = one(p.body, "imp-sync");
    assert.ok(textOf(card).startsWith("Up to date|No chat of the last 30 days is new or has grown.|Sync now|4 chats came in, 57 new turns. 3 new, the rest had grown. 1 file could not be read:|Codex · rollout-1.jsonl: EBUSY: locked|Reaches back"), textOf(card));
    assert.equal(isOff(btn(card, "Sync now")), true, "nothing new: nothing to click for");
    assert.deepEqual(p.timers, [], "an ended run is asked no more");
  });

  // (fails before: yes)
  test("Stop ends a run after the turn in hand, and says what stays", async () => {
    const p = await open();
    await press(btn(p.body, "Sync now"));
    await press(btn(p.body, "Stop"));
    assert.equal(p.said().at(-1), "POST /memory/jobs/import-sync-1/stop");
    const stopping = btn(p.body, "Stopping after this turn…");
    assert.equal(isOff(stopping), true);
    Object.assign(p.state.jobs.get("import-sync-1"), { status: "error", stopped: true, error: "the import was stopped" });
    await p.tick();
    assert.equal(textOf(one(p.body, "imp-end")), "Stopped. What was read stays, and the next run goes on from there.");
    assert.equal(one(p.body, "imp-end").classList.contains("is-quiet"), true, "a stop of the person's is no failure");
    assert.equal(isOff(btn(p.body, "Sync now")), false, "and Sync can go on");
    // a run that had ended as Stop was pressed
    const late = await open({ answer: (method, path) => (method === "POST" && path.endsWith("/stop") ? { stopped: false } : undefined) });
    await press(btn(late.body, "Sync now"));
    await press(btn(late.body, "Stop"));
    assert.deepEqual(late.toasts, [["It had ended already.", undefined]]);
  });

  // (fails before: yes)
  test("a refused Sync is said in the server's words, and a run that failed says why", async () => {
    const p = await open({ answer: (method, path) => { if (method === "POST" && path === "/memory/import/sync") throw new Error("an import is running: wait for it to end, or stop it"); } });
    await press(btn(p.body, "Sync now"));
    assert.deepEqual(p.toasts, [["an import is running: wait for it to end, or stop it", "err"]]);
    assert.equal(every(p.body, "imp-run").length, 0);
    const q = await open();
    await press(btn(q.body, "Sync now"));
    Object.assign(q.state.jobs.get("import-sync-1"), { status: "error", error: "SQLITE_FULL: database or disk is full" });
    await q.tick();
    assert.equal(textOf(one(q.body, "imp-end")), "The import failed: SQLITE_FULL: database or disk is full");
    assert.equal(one(q.body, "imp-end").classList.contains("is-bad"), true);
    // the page loses the run (the server restarted): it says so and reads the page again
    const r = await open({ answer: (method, path) => { if (method === "GET" && path.startsWith("/memory/jobs/")) throw new Error("no such job"); } });
    await press(btn(r.body, "Sync now"));
    await r.tick();
    assert.equal(textOf(one(r.body, "imp-end")), "Lost sight of the run: no such job");
  });

  // (fails before: yes)
  test("a run started before this visit is found again: the bar is there on opening, and is followed", async () => {
    const overview = { ...OVERVIEW, job: { id: "import-sync-1", kind: "import-sync" } };
    const p = await open({ overview, answer: (method, path, _b, state) => {
      if (!state.jobs.size) state.jobs.set("import-sync-1", { id: "import-sync-1", kind: "import-sync", status: "running", percent: 40, progress: [{ step: "codex", done: 0, total: 1 }] });
    } });
    assert.deepEqual(p.said(), ["GET /memory/import/overview", "GET /memory/jobs/import-sync-1"]);
    assert.equal(textOf(one(p.body, "imp-run")), "Codex · chat 1 of 1 · 40%|Stop");
    assert.equal(isOff(btn(p.body, "Sync now")), true);
    assert.equal(p.timers.length, 1, "and it is asked again");
  });

  // (fails before: yes — 11-12: the section's hold on the server was this page's own, so the welcome tour could start
  // no run and follow none: its one button closed it for this page)
  test("the section's hold on the server is one for this page and the welcome tour: a run started through it is asked until it ends, or until its page says it has gone, and what is read again at its end is the page's to say", async () => {
    /** A keeper over a scripted server. @param {Record<string, any>} [cb] */
    const held = (cb = {}) => {
      /** @type {string[]} */
      const said = [];
      /** @type {(() => void)[]} */
      const timers = [];
      const job = { id: "import-sync-1", kind: "import-sync", status: "running", percent: 0, progress: /** @type {any[]} */ ([]) };
      const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
        said.push(`${init.method || "GET"} ${path}`);
        if (path === "/memory/import/overview") return structuredClone(OVERVIEW);
        if (path === "/memory/import/sync") return { job: structuredClone(job) };
        if (path === "/memory/jobs/import-sync-1") return structuredClone(job);
        throw new Error(`the stand-in has no answer for ${path}`);
      };
      /** @type {string[]} */
      const heard = [];
      const k = importKeeper({ paint: () => void heard.push("paint"), onRun: (kind) => void heard.push(`run ${kind}`), onSessions: () => void heard.push("sessions"), ...cb }, { h: fakeH, api, later: (fn) => void timers.push(fn) });
      return { k, job, said, heard, timers, tick: async () => { for (const fn of timers.splice(0)) fn(); await settle(); } };
    };
    // A page that says nothing of itself: the run is asked until it ends, and the overview read again then.
    const p = held();
    await p.k.load();
    await p.k.sync();
    assert.deepEqual([p.said, p.k.busy(), p.timers.length], [["GET /memory/import/overview", "POST /memory/import/sync"], true, 1]);
    Object.assign(p.job, { percent: 50 });
    await p.tick();
    assert.deepEqual([p.heard.at(-1), p.k.st.run.import.percent, p.timers.length], ["run import", 50, 1], "heard from, and asked again");
    Object.assign(p.job, { status: "done", result: { chats: 1, newChats: 1, newTurns: 2, errors: [] } });
    await p.tick();
    assert.deepEqual([p.said.slice(-2), p.heard.slice(-2), p.k.busy(), p.k.st.ended.import.status, p.timers.length], [["GET /memory/jobs/import-sync-1", "GET /memory/import/overview"], ["sessions", "paint"], false, "done", 0]);
    // A page that has gone asks no more; and one that says what is read at a run's end is the one that reads.
    let alive = true;
    /** @type {string[]} */
    const ends = [];
    const q = held({ alive: () => alive, onEnd: () => void ends.push("end") });
    await q.k.sync();
    await q.tick();
    assert.equal(q.timers.length, 1);
    alive = false;
    await q.tick();
    assert.equal(q.timers.length, 0, "the run goes on at the server, and the next visit finds it");
    const r = held({ onEnd: () => void ends.push("end") });
    await r.k.sync();
    Object.assign(r.job, { status: "done", result: {} });
    await r.tick();
    assert.deepEqual([ends, r.said, r.heard.includes("sessions")], [["end"], ["POST /memory/import/sync", "GET /memory/jobs/import-sync-1"], true], "nothing read that the page did not ask for");
  });

  // (fails before: yes — the owner's of 11-12: the hold had one read of the overview, the counts; the tour's Your chats
  // needs the chats a run would bring named, and this page must not be sent them)
  test("the hold reads the overview with its chats named only for the page that asks so: the welcome tour does, this page does not", async () => {
    /** The overview reads of a keeper made with `cb`, after a first read and one more. @param {Record<string, any>} cb */
    const reads = async (cb) => {
      /** @type {string[]} */
      const said = [];
      const k = importKeeper({ paint: () => {}, ...cb }, { h: fakeH, api: async (/** @type {string} */ path) => (said.push(path), structuredClone(OVERVIEW)), later: () => {} });
      await k.load();
      await k.load();
      return said;
    };
    assert.deepEqual(await reads({ list: true }), ["/memory/import/overview?list=1", "/memory/import/overview?list=1"]);
    assert.deepEqual([await reads({}), await reads({ list: false })], [["/memory/import/overview", "/memory/import/overview"], ["/memory/import/overview", "/memory/import/overview"]]);
    const p = await open();
    await press(btn(one(p.body, "imp-sync"), "Sync now"));
    Object.assign(p.state.jobs.get("import-sync-1"), { status: "done", result: { chats: 0, newChats: 0, newTurns: 0, errors: [] } });
    await p.tick();
    const overviews = p.calls.filter(([, path]) => path.startsWith("/memory/import/overview"));
    assert.deepEqual([overviews.length, overviews.some(([, path]) => path.includes("list="))], [2, false], "Settings › Import asks for the counts alone, at its opening and after a run");
  });

  // (fails before: yes)
  test("the reach and an agent's Sync switch are kept at the server, and the card says what stands", async () => {
    const p = await open();
    pick(field(p.body, "Reaches back"), "7");
    await settle();
    assert.deepEqual(p.calls.slice(1), [["PUT", "/memory/import/prefs", { reachDays: 7 }], ["GET", "/memory/import/overview", undefined]]);
    const sw = () => buttonsOf(agentRow(p.body, "codex"))[0];
    assert.equal(sw().attrs["aria-checked"], "true");
    await press(sw());
    assert.deepEqual(p.calls.at(-2), ["PUT", "/memory/import/prefs", { on: ["claude-code", "cursor"] }]);
    assert.equal(sw().attrs["aria-checked"], "false");
    assert.ok(textOf(one(p.body, "imp-sync")).includes("about 212 MB to read · Claude Code 3|"), "Codex is left out of what a Sync brings");
    assert.deepEqual(buttonsOf(agentRow(p.body, "codex")).map(textOf).filter(Boolean), ["Browse"], "Browse still works for it");
    await press(sw());
    assert.deepEqual(p.calls.at(-2), ["PUT", "/memory/import/prefs", { on: ["claude-code", "cursor", "codex"] }]);
    // a refusal is said, and the page shows what stands
    const q = await open({ answer: (method) => { if (method === "PUT") throw new Error("reachDays is a whole number of days from 0 (everything) to 3650"); } });
    pick(field(q.body, "Reaches back"), "90");
    await settle();
    assert.deepEqual(q.toasts, [["reachDays is a whole number of days from 0 (everything) to 3650", "err"]]);
    assert.deepEqual(field(q.body, "Reaches back").kids.filter((/** @type {any} */ k) => "selected" in k.attrs).map((/** @type {any} */ k) => k.attrs.value), ["30"]);
  });

  // (fails before: yes — the owner's of 10-29: every agent stood switched on, and a Sync pressed by mistake flooded the
  // left bar; a switch pressed sent the agents to leave out)
  test("as Filament ships, every agent's Sync switch is off and Sync now can't be pressed; a switch turns its agent alone on", async () => {
    const off = (/** @type {any} */ s) => ({ ...s, on: false });
    const p = await open({ overview: { ...OVERVIEW, prefs: { ...OVERVIEW.prefs, on: [] }, sources: OVERVIEW.sources.map(off) } });
    assert.deepEqual(["claude-code", "codex"].map((id) => buttonsOf(agentRow(p.body, id))[0].attrs["aria-checked"]), ["false", "false"]);
    assert.ok(textOf(one(p.body, "imp-sync")).startsWith("Every agent is switched off|Switch one on below, or bring single chats in through Browse."));
    assert.equal(isOff(btn(p.body, "Sync now")), true);
    await press(buttonsOf(agentRow(p.body, "codex"))[0]);
    assert.deepEqual(p.calls.at(-2), ["PUT", "/memory/import/prefs", { on: ["codex"] }]);
    assert.equal(buttonsOf(agentRow(p.body, "codex"))[0].attrs["aria-checked"], "true");
    assert.equal(buttonsOf(agentRow(p.body, "claude-code"))[0].attrs["aria-checked"], "false");
    assert.equal(isOff(btn(p.body, "Sync now")), false, "Codex's chats can come now");
  });

  // (fails before: yes)
  test("more to read than the drive has free is said before the click, with what to do", async () => {
    const p = await open({ overview: { ...OVERVIEW, free: 100 * MB } });
    assert.equal(textOf(one(p.body, "imp-callout")), "That is more than the 100 MB free on the drive Filament keeps its sessions on. Choose a shorter reach, or bring single chats in through Browse.");
    assert.ok(textOf(one(p.body, "imp-sync-foot")).includes("|100 MB free|"));
    const q = await open({ overview: { ...OVERVIEW, free: null } });
    assert.ok(!textOf(one(q.body, "imp-sync-foot")).includes("free"), "where the system does not say, the page says nothing");
  });

  // (fails before: yes)
  test("the section cannot be read: it says why and nothing else, and Try again reads it", async () => {
    let fail = true;
    const p = await open({ answer: (method, path) => { if (fail && path === "/memory/import/overview") throw new Error("no archive: the memory folder cannot be written"); } });
    assert.equal(textOf(p.body), "no archive: the memory folder cannot be written|Try again");
    fail = false;
    await press(btn(p.body, "Try again"));
    assert.ok(textOf(p.body).startsWith("4 chats are new or have grown"));
  });

  // (fails before: yes)
  test("Browse: an agent's chats by folder, each with how it stands and what can be done with it", async () => {
    const p = await open();
    await press(btn(agentRow(p.body, "claude-code"), "Browse"));
    assert.equal(p.said().at(-1), "GET /memory/import/chats?source=claude-code");
    const s = p.sheets[0];
    assert.equal(s.label, "Claude Code's chats");
    assert.equal(textOf(s.head), "Claude Code's chats|5 chats");
    assert.equal(textOf(s.foot), "Claude Code's files are only read.");
    assert.deepEqual(every(s.body, "imp-group").map((g) => textOf(one(g, "imp-group-head"))), ["shop|H:\\shop|4 chats|Import all 2", "daily|H:\\notes\\daily|1 chat|Import 1"]);
    const acts = (/** @type {string} */ id) => buttonsOf(chatRow(s.body, id)).map(textOf);
    assert.equal(textOf(chatRow(s.body, "a1")), "first words of a1|today 11:05 · 4.2 MB|new|Import");
    assert.equal(textOf(chatRow(s.body, "b1")), "Daily notes|yesterday 09:10 · 4.2 MB · 31 turns in Filament|grown|Import the rest|Open");
    assert.equal(textOf(chatRow(s.body, "a2")), "first words of a2|4 Sep · 4.2 MB · 8 turns in Filament|in Filament|Open");
    assert.deepEqual([acts("a3"), acts("a4")], [[], ["Import"]]);
    assert.equal(textOf(chatRow(s.body, "a3")), "first words of a3|yesterday 09:10 · 4.2 MB|ran through Filament");
    assert.equal(textOf(chatRow(s.body, "a4")), "first words of a4|yesterday 09:10 · 4.2 MB|removed by you|Import");
    // the box filters by folder or words; a folder's button then names only what is shown
    type(field(s.body, "Filter by folder or words"), "a4");
    assert.deepEqual(every(s.body, "imp-chat").map((r) => r.attrs["data-chat"]), ["a4"]);
    assert.equal(textOf(one(s.body, "imp-group-head")), "shop|H:\\shop|1 chat|Import 1");
    type(field(s.body, "Filter by folder or words"), "zzz");
    assert.equal(textOf(one(s.body, "imp-browse-list")), "No chat's folder or words hold that.");
    type(field(s.body, "Filter by folder or words"), "");
    assert.equal(every(s.body, "imp-chat").length, 5);
  });

  // (fails before: yes — a project with no folder on this computer was headed "no folder", all such projects as one)
  test("Browse: a project whose folder is not on this computer is headed by its name, and says so", async () => {
    const p = await open({ chats: [chat("p1", "", "new", { project: "old-workspace" }), chat("p2", "", "new", { project: "old-workspace" }), chat("z", "", "new")] });
    await press(btn(agentRow(p.body, "claude-code"), "Browse"));
    assert.deepEqual(every(p.sheets[0].body, "imp-group").map((g) => textOf(one(g, "imp-group-head"))), ["old-workspace|its folder is not on this computer|2 chats|Import all 2", "no folder|1 chat|Import 1"]);
  });

  // (fails before: yes — a size worked out from a share of the agent's database read as if it had been measured)
  test("a size that is an estimate says so, on the agent's row and on each of its chats", async () => {
    assert.equal(agentSays({ ...CLAUDE, about: true }, 30).where, "C:\\Users\\me\\.claude\\projects · 79 chats in 20 projects · about 5.7 GB");
    const p = await open({ chats: [chat("z1", "H:\\shop", "new", { about: true }), chat("z2", "H:\\shop", "new")] });
    await press(btn(agentRow(p.body, "claude-code"), "Browse"));
    assert.equal(textOf(chatRow(p.sheets[0].body, "z1")), "first words of z1|yesterday 09:10 · about 4.2 MB|new|Import");
    assert.equal(textOf(chatRow(p.sheets[0].body, "z2")), "first words of z2|yesterday 09:10 · 4.2 MB|new|Import", "a measured size says nothing more");
  });

  // (fails before: yes)
  test("Browse: Import brings one chat, a folder's button the chats that would bring something, and the run shows on the sheet", async () => {
    const p = await open();
    await press(btn(agentRow(p.body, "claude-code"), "Browse"));
    const s = p.sheets[0];
    await press(btn(chatRow(s.body, "a1"), "Import"));
    assert.deepEqual(p.calls.at(-1), ["POST", "/memory/import/chosen", { source: "claude-code", chats: ["a1"] }]);
    assert.equal(textOf(s.foot), "0%|Stop|Claude Code's files are only read.", "the run's bar is on the sheet, where it was started");
    assert.ok(buttonsOf(s.body).filter((b) => /^Import/.test(textOf(b))).every(isOff), "one import at a time");
    assert.equal(isOff(btn(chatRow(s.body, "b1"), "Open")), false, "a chat in Filament still opens");
    // it ends: the list is read again, the row says where the chat stands now
    Object.assign(p.state.jobs.get("import-claude-code-1"), { status: "done", percent: 100, result: { by: "browse", chats: 1, newChats: 1, newTurns: 6, errors: [] } });
    p.state.chats[0] = { ...p.state.chats[0], state: "imported", chain: "chainA1", turns: 6 };
    await p.tick();
    assert.deepEqual(p.said().slice(-3), ["GET /memory/jobs/import-claude-code-1", "GET /memory/import/overview", "GET /memory/import/chats?source=claude-code"]);
    assert.equal(textOf(chatRow(s.body, "a1")), "first words of a1|today 11:05 · 4.2 MB · 6 turns in Filament|in Filament|Open");
    assert.equal(textOf(s.foot), "1 chat came in, 6 new turns.|Claude Code's files are only read.");
    assert.equal(p.sessions(), 1);
    // a folder's button names the chats that would bring something: one in Filament whole is not read again
    await press(btn(every(s.body, "imp-group")[0], "Import 1"));
    assert.deepEqual(p.calls.at(-1), ["POST", "/memory/import/chosen", { source: "claude-code", chats: ["a4"] }]);
  });

  // (fails before: yes)
  test("Browse: Open closes the sheet and goes to the session the chat became", async () => {
    const p = await open();
    await press(btn(agentRow(p.body, "claude-code"), "Browse"));
    const s = p.sheets[0];
    await press(btn(chatRow(s.body, "b1"), "Open"));
    assert.equal(s.closed, true);
    assert.deepEqual(p.went, ["#/task/chainB1"]);
    // with the sheet closed a run's end reads no list
    await press(btn(p.body, "Sync now"));
    Object.assign(p.state.jobs.get("import-sync-1"), { status: "done", result: { chats: 0, newChats: 0, newTurns: 0, errors: [] } });
    await p.tick();
    assert.equal(p.said().at(-1), "GET /memory/import/overview");
    // a sheet opened after a run's end does not say that end again: the card holds it
    await press(btn(agentRow(p.body, "claude-code"), "Browse"));
    assert.equal(textOf(p.sheets[1].foot), "Claude Code's files are only read.");
    // a list that cannot be read says why
    const q = await open({ answer: (method, path) => { if (path.startsWith("/memory/import/chats")) throw new Error("EPERM: the folder cannot be read"); } });
    await press(btn(agentRow(q.body, "claude-code"), "Browse"));
    assert.equal(textOf(one(q.sheets[0].body, "imp-browse-list")), "EPERM: the folder cannot be read");
  });

  // (fails before: yes)
  test("memory: the switch is the person's, off at first; the unread chats are read at a click, with the calls said first and Stop while it reads", async () => {
    const p = await open();
    const memory = () => one(p.body, "imp-memory");
    const sw = () => all(memory(), (x) => x.attrs?.role === "switch")[0];
    await press(sw());
    assert.deepEqual(p.calls.at(-2), ["PUT", "/memory/import/prefs", { learn: true }]);
    assert.equal(sw().attrs["aria-checked"], "true");
    await press(btn(memory(), "Let memory read them"));
    assert.deepEqual(p.calls.at(-1), ["POST", "/memory/backfill", { limit: 200, imported: true }], "the imported chats alone: the count said is the work done");
    assert.equal(textOf(one(memory(), "imp-run")), "Memory is starting to read|Stop");
    assert.equal(isOff(btn(memory(), "Let memory read them")), true);
    assert.equal(isOff(btn(p.body, "Sync now")), false, "reading holds no import back");
    Object.assign(p.state.jobs.get("learn-backfill-1"), { percent: 21, progress: [{ step: "learn", done: 3, total: 14 }] });
    await p.tick();
    assert.equal(textOf(one(memory(), "imp-run")), "Memory is reading chat 4 of 14|Stop");
    await press(btn(memory(), "Stop"));
    assert.equal(p.said().at(-1), "POST /memory/jobs/learn-backfill-1/stop");
    assert.equal(isOff(btn(memory(), "Stopping after this chat…")), true);
    Object.assign(p.state.jobs.get("learn-backfill-1"), { status: "error", stopped: true, error: "memory's reading was stopped" });
    p.state.overview.unread = { chats: 10, passes: 61 };
    // the server's note of an earlier reading is not said beside the ending the page saw
    p.state.overview.lastRead = { at: at(1), learned: 3, considered: 3, nothing: 0, unread: [] };
    await p.tick();
    assert.ok(textOf(memory()).endsWith("10 imported chats are unread|About 61 calls to glm-5.3-flash.|Let memory read them|Stopped. What memory read stays."), textOf(memory()));
    assert.equal(p.sessions(), 0, "reading brings no session");
  });

  // (fails before: yes)
  test("memory: why nothing can be read is said and the switch and button are off; a reading under way is found again; all read says so", async () => {
    const off = await open({ overview: { ...OVERVIEW, learner: { model: null, why: "memory is switched off" } } });
    const memory = one(off.body, "imp-memory");
    assert.ok(textOf(memory).startsWith("Memory reads what is imported|Nothing can be read now: memory is switched off.|14 imported chats are unread|About 80 calls.|"), textOf(memory));
    assert.equal(isOff(all(memory, (x) => x.attrs?.role === "switch")[0]), true);
    assert.equal(isOff(btn(memory, "Let memory read them")), true);
    // more than one click reads
    const many = await open({ overview: { ...OVERVIEW, unread: { chats: 513, passes: 2200 } } });
    assert.ok(textOf(one(many.body, "imp-memory")).includes("|About 2,200 calls to glm-5.3-flash. A click reads the newest 200.|"));
    const one1 = await open({ overview: { ...OVERVIEW, unread: { chats: 1, passes: 1 } } });
    assert.ok(textOf(one(one1.body, "imp-memory")).includes("|1 imported chat is unread|About 1 call to glm-5.3-flash.|"));
    // everything read; and nothing imported yet says nothing at all
    const read = await open({ overview: { ...OVERVIEW, unread: { chats: 0, passes: 0 } } });
    assert.ok(textOf(one(read.body, "imp-memory")).endsWith("|Memory has read every imported chat."));
    const none = await open({ overview: { ...OVERVIEW, unread: { chats: 0, passes: 0 }, sources: [{ ...CLAUDE, states: { new: 79 } }] } });
    assert.equal(every(one(none.body, "imp-memory"), "imp-mem-row").length, 1);
    // how the last reading ended is said on a later visit, with why chats were left unread
    const later = await open({ overview: { ...OVERVIEW, lastRead: { at: at(0), learned: 0, considered: 4, nothing: 0, unread: [{ why: "the model did not answer in the form memory reads", chats: 4 }] } } });
    assert.ok(textOf(one(later.body, "imp-memory")).endsWith("|Let memory read them|Last reading: today 14:02 · 0 of 4 chats read · 4 chats left unread: the model did not answer in the form memory reads"), textOf(one(later.body, "imp-memory")));
    // a reading started before this visit
    const back = await open({ overview: { ...OVERVIEW, reading: { id: "learn-backfill-1" } }, answer: (_m, _p, _b, state) => {
      if (!state.jobs.size) state.jobs.set("learn-backfill-1", { id: "learn-backfill-1", kind: "learn-backfill", status: "running", percent: 50, progress: [{ step: "learn", done: 7, total: 14 }] });
    } });
    assert.equal(textOf(one(one(back.body, "imp-memory"), "imp-run")), "Memory is reading chat 8 of 14|Stop");
    assert.equal(isOff(btn(back.body, "Let memory read them")), true);
  });
});
