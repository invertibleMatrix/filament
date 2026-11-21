// @ts-check
// The Side view's seams on the fake DOM (HarnessV4_Tasks E15 step 5): a SideIO that records what the view asks of its
// host, the three shortcuts' rows and a few cards as the server lists them, and stand-ins for what the view draws with
// the page's own document — the menu, the thread part, the model picker, the attachments and the pool's chip — each
// keeping what it was told.
import { fakeH, fakeDrawIn } from "./fake-dom.js";
import { poolChips } from "./team-view.js";

/** The clock the recording SideIO reads. */
export const NOW = 1_800_000_000_000;

/**
 * A starts table as the sizes route answers it (services/subagent-starts.js has its own): here every start but the
 * review runs as the card that edits, Ask and Catch me up lowering it to reading.
 * @type {import("../../src/ui/harness/lib/subagents.js").StartRow[]}
 */
export const STARTS = [
  { id: "ask", name: "Ask", view: "folded", running: true, changes: null, worker: "builder", may: "read", worktree: false, deliver: false },
  { id: "job", name: "Try it in a copy", view: "folded", running: true, changes: null, worker: "builder", may: "edit", worktree: true, deliver: false },
  { id: "review", name: "Review my last change", view: "none", running: false, changes: "turn", worker: "reviewer", may: "read", worktree: false, deliver: false },
  { id: "catchup", name: "Catch me up", view: "folded", running: true, changes: null, worker: "builder", may: "read", worktree: false, deliver: false, task: "Catch me up.", since: "message", asks: true, fork: "warm" },
];

/** Saved agents: two workers the shortcuts run as, an agent that keeps nothing, and one with its own model. @type {import("../../src/ui/harness/lib/agent-cards.js").AgentCard[]} */
export const CARDS = [
  { tag: "builder", name: "Builder", goodFor: "Any one job, done as the main agent would", thinks: "", may: "edit", model: null, sees: { view: "none", running: false, changes: null }, shipped: true },
  { tag: "reviewer", name: "Reviewer", goodFor: "Reads a change and says what is wrong", thinks: "", may: "read", model: null, sees: { view: "none", running: false, changes: "turn" }, shipped: true },
  { tag: "enduser", name: "End user", goodFor: "Runs the checks", thinks: "", may: "copy", model: null, sees: { view: "none", running: false, changes: null }, shipped: true },
  { tag: "product", name: "Product", goodFor: "Scope and what to cut", thinks: "", may: "read", model: "glm-5.3", sees: { view: "folded", running: true, changes: null }, shipped: true },
];

/** A session with a turn running, each view sized, both changes read, one agent of four at work. @type {import("../../src/ui/harness/lib/side.js").SideFacts} */
export const FACTS = {
  defaultModel: "glm-5.3",
  defaultEffort: "max",
  mainModel: "claude-sonnet-5-5",
  turnRuns: true,
  forkable: true,
  tokens: { none: 0, folded: 24000, window: 61000, fork: 80000 },
  runningTokens: 2200,
  runningRounds: 7,
  patches: { turn: { tokens: 1200, files: 3 }, uncommitted: { tokens: 0, files: 0, note: "the folder is no git repository" } },
  limit: { max: 4, running: 1 },
  seats: { max: 4, running: 1 },
};

/**
 * An agent's row, as the session's list answers it. @param {string} id @param {Record<string, any>} [over]
 * @returns {any}
 */
export const agentRow = (id, over = {}) => ({
  id,
  card: { tag: "builder", name: "Builder" },
  asked: true,
  origin: "owner",
  may: "read",
  status: "done",
  startedAt: NOW - 60_000,
  description: `Job ${id}`,
  progress: null,
  work: null,
  exchanges: [{ description: `Job ${id}`, startedAt: NOW - 60_000, endedAt: NOW - 54_000, spentUsd: 0.02, delivery: "held" }],
  ...over,
});

/**
 * One of a coding agent's own agents, as the session's list answers it (app/agent-guests.js): the id names its turn's
 * run and its card there. @param {string} stub @param {Record<string, any>} [over]
 * @returns {import("../../src/ui/harness/lib/subagents.js").GuestRow}
 */
export const guestRowOf = (stub, over = {}) => ({
  id: `run_1~${stub}`,
  guest: true,
  of: "Claude Code",
  run: "run_1",
  stub,
  description: `Own ${stub}`,
  agent: "Explore",
  model: "",
  prompt: `Do ${stub}`,
  status: "done",
  startedAt: NOW - 200_000,
  endedAt: NOW - 20_000,
  ms: 180_000,
  toolCalls: 14,
  tokens: null,
  report: `${stub} is done`,
  error: "",
  ...over,
});

/**
 * A SideIO that records each read of the sizes, launch, Enhance, answer, toast and used offer;
 * any part is the test's to replace.
 * @param {Record<string, any>} [over]
 */
export function sideIO(over = {}) {
  /** @type {any[][]} */
  const calls = [];
  return {
    calls,
    rows: () => /** @type {any[]} */ ([]),
    own: () => /** @type {any[]} */ ([]),
    chainId: () => "c1",
    cards: () => CARDS,
    starts: () => STARTS,
    facts: () => FACTS,
    /** @param {boolean} patches */
    readSizes: (patches) => { calls.push(["readSizes", patches]); },
    models: () => /** @type {any[]} */ ([]),
    /** @returns {{ rows: unknown, source: string, main: string } | null} */
    pool: () => ({ rows: [{ model: "", seats: 4 }], source: "default", main: "glm-5.3" }),
    /** @param {any[] | null} rows */
    setPool: (rows) => { calls.push(["setPool", rows]); },
    /** @param {string} model */
    priceOf: (model) => "",
    fallsToMain: () => false,
    /** @param {any} body */
    launch: async (body) => { calls.push(["launch", body]); return /** @type {any} */ ({ id: "s9", shares: null }); },
    /** @param {string} prompt @param {any} o */
    enhance: async (prompt, o) => { calls.push(["enhance", prompt, o]); return /** @type {any} */ ({ text: `Brief: ${prompt}`, title: "A brief", how: "fork", usage: { input: 0, cacheRead: 41_000, cacheWrite: 0, output: 0 } }); },
    cache: () => /** @type {any} */ ({ state: "none", running: false, leftMs: 0, ttlMs: 0, tokens: 0, model: null, forkable: false }),
    /** @param {string} model */
    modelProblem: async (model) => /** @type {string | null} */ (null),
    /** @param {string} id @param {any} words */
    answer: async (id, words) => { calls.push(["answer", id, words]); return true; },
    /** @param {string} id @param {any} offer */
    always: async (id, offer) => { calls.push(["always", id, offer]); return true; },
    mainDoor: /** @type {import("../../src/ui/harness/subagent-viewer.js").MainDoor} */ ({ state: () => "idle", outside: () => null, start: (line) => { calls.push(["start", line]); } }),
    beside: () => /** @type {string[]} */ ([]),
    held: /** @type {any} */ (null),
    /** @param {string} msg @param {string} [kind] */
    toast: (msg, kind) => { calls.push(["toast", msg, kind || ""]); },
    offered: { seen: () => false, mark: () => { calls.push(["offered"]); } },
    now: () => NOW,
    ...over,
  };
}

/**
 * What the view draws with the page's own document, as stand-ins: `menus` the menus opened, each with its rows;
 * `threads` the thread parts mounted, each with what it was given — `guest` on one of a coding agent's own, which has
 * no box to take the keys; `pickers` the model pickers; `files` what the box holds beside its words; `pools` the
 * pool's chips, each with its io and what it shows.
 */
export function sideSeams() {
  /** @type {any[]} */
  const menus = [];
  /** @type {any[]} */
  const threads = [];
  /** @type {any[]} */
  const pickers = [];
  /** @type {{ list: any[] }} */
  const files = { list: [] };
  /** The gear's sheets, as opened: what each was given, and whether it closed. @type {any[]} */
  const sheets = [];
  const pools = poolChips();
  return {
    menus,
    threads,
    pickers,
    files,
    sheets,
    pools: pools.made,
    seams: {
      poolChip: pools.make,
      /** @param {any} o */
      sheet: (o) => {
        const s = { o, closed: false, close() { if (s.closed) return; s.closed = true; o.onClose?.(); } };
        sheets.push(s);
        return /** @type {any} */ (s);
      },
      // The fake's nodes go into a host as they are: morph reads a DOM's.
      drawIn: fakeDrawIn,
      /** @param {any[]} items @param {any} o */
      menu: (items, o) => {
        const m = { items, o, closed: false, close() { m.closed = true; } };
        menus.push(m);
        return /** @type {any} */ (m);
      },
      /** @param {any} o */
      conversation: (o) => {
        const t = { o, mounted: 0, closed: false, focused: false,
          head: fakeH("div", { class: "sav-head" }, `head ${o.id}`), body: fakeH("div", { class: "sav-body" }, `body ${o.id}`), foot: fakeH("div", { class: "sav-foot-box" }, `foot ${o.id}`),
          mount() { t.mounted += 1; }, close() { t.closed = true; }, focusFollowUp() { t.focused = true; } };
        threads.push(t);
        return /** @type {any} */ (t);
      },
      /** @param {any} o */
      guest: (o) => {
        const t = { o, guest: true, mounted: 0, closed: false,
          head: fakeH("div", { class: "sav-head" }, `own head ${o.id}`), body: fakeH("div", { class: "sav-body" }, `own body ${o.id}`), foot: fakeH("div", { class: "sav-foot-box" }, `own foot ${o.id}`),
          mount() { t.mounted += 1; }, close() { t.closed = true; } };
        threads.push(t);
        return /** @type {any} */ (t);
      },
      /** @param {any} o */
      modelSelect: (o) => {
        const p = { o, el: fakeH("span", { class: "model-select" }), models: /** @type {any[]} */ ([]), name: "", note: /** @type {string | null} */ (null), locked: /** @type {string | null} */ (null), opened: 0,
          /** @param {any[]} m */ setModels(m) { p.models = m; },
          families: /** @type {any[]} */ ([]), accounts: /** @type {any[]} */ ([]),
          /** @param {any[]} f */ setFamilies(f) { p.families = f; },
          /** @param {any[]} a */ setAccounts(a) { p.accounts = a; },
          /** @param {string} n */ set(n) { p.name = n; },
          /** @param {string | null} n */ setNote(n) { p.note = n; },
          /** @param {string | null} why */ setLocked(why) { p.locked = why; },
          open() { p.opened += 1; } };
        pickers.push(p);
        return /** @type {any} */ (p);
      },
      attachments: () => /** @type {any} */ ({
        el: fakeH("div", { class: "attachments" }),
        overlay: fakeH("div", {}),
        input: fakeH("input", { type: "file" }),
        list: () => files.list,
        /** @param {any[]} more */ add: async (more) => { files.list = [...files.list, ...more]; },
        clear: () => { files.list = []; },
        /** @param {any[]} kept */ restore: (kept) => { files.list = [...(kept || [])]; },
      }),
    },
  };
}

/** A menu's rows as the tests read them: each row's kind, words and whether it is on or off. @param {any} m */
export const menuRows = (m) => m.items.map((/** @type {any} */ i) => [i.type || "item", i.label || "", ...(i.type === "radio" || i.type === "check" ? [!!i.checked] : []), ...(i.disabled ? ["off"] : [])]);
/** The row of a menu with this label. @param {any} m @param {string} label @returns {any} */
export const menuRow = (m, label) => m.items.find((/** @type {any} */ i) => i.label === label);
