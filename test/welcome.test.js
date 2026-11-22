// @ts-check
// The welcome tour (the owner's FTUE of 11-05, rebuilt the same day: "top-notch, covering every feature, configuring
// Filament step by step"): ten steps on a rail, each reading and writing through the routes the harness's own settings
// use — Your chats by Settings › Import's own (the owner's of 11-12); it opens by itself once per data folder
// (`ui.welcome.seen`), and from the command center, the help menu and `/welcome`.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { startApp } from "./helpers/app.js";
import { CONFIG_SCHEMA } from "../src/core/schema.js";
import { FIELD_SECTIONS } from "../src/app/config-fields.js";
import "./helpers/teams-on-page.js";
import { state } from "../src/ui/harness/state.js";

/** @type {typeof import("../src/ui/harness/views/welcome.js")} */
let W;
/** @type {ReturnType<typeof stubDocument>} */
let doc;
const g = /** @type {any} */ (globalThis);
/** @type {any} */
let hadElement;
before(async () => {
  doc = stubDocument();
  // The sheet asks what had the focus; nothing in the stub page is an element of the browser's.
  hadElement = g.HTMLElement;
  g.HTMLElement = class {};
  W = await import("../src/ui/harness/views/welcome.js");
});
after(() => {
  doc.restore();
  if (hadElement === undefined) delete g.HTMLElement;
  else g.HTMLElement = hadElement;
});

const settle = () => new Promise((r) => setTimeout(r, 5));
const text = (/** @type {any} */ el) => String(el?.textContent || "").replace(/\s+/g, " ").trim();
const sheetEl = () => doc.document.body.querySelector(".wel-sheet");
const q = (/** @type {string} */ sel) => /** @type {any} */ (doc.document.body.querySelector(sel));
const qa = (/** @type {string} */ sel) => /** @type {any[]} */ (doc.document.body.querySelectorAll(sel));
const buttons = (/** @type {string} */ label) => doc.document.body.querySelectorAll("button").filter((/** @type {any} */ b) => text(b) === label);
const press = (/** @type {string} */ label) => {
  const b = buttons(label)[0];
  assert.ok(b, `a button "${label}"`);
  b.dispatch("click");
};
const closeIt = () => q(".wel-sheet .zc-sheet-x")?.dispatch("click");
/** What the rail says under each step's name. */
const facts = () => Object.fromEntries(qa(".wel-step").map((b) => [text(b.querySelector(".wel-label")), text(b.querySelector(".wel-fact"))]));
/** The step's index by its id. @param {string} id */
const stepOf = (id) => W.WELCOME_STEPS.findIndex((s) => s.id === id);

/** A keeper as app.js's are: what it holds now, and its listeners told on `set`. @param {any} start */
const keeper = (start) => {
  let now = start;
  /** @type {Set<(v: any) => void>} */
  const fns = new Set();
  return {
    now: () => now,
    rows: () => now,
    listen: (/** @type {(v: any) => void} */ fn) => (fns.add(fn), () => void fns.delete(fn)),
    keep: (/** @type {any} */ v) => {
      now = v;
      for (const fn of fns) fn(v);
    },
    set: (/** @type {any} */ v) => {
      now = v;
      for (const fn of fns) fn(v);
    },
    size: () => fns.size,
  };
};

/** Where new chats start, kept here as state.js and the composer keep it. @param {{ model?: string, last?: string, effort?: string, thinking?: boolean }} [o] */
const prefOf = (o = {}) => {
  const p = { model: o.model || "", last: o.last || "", effort: o.effort || "", thinking: !!o.thinking };
  return {
    p,
    pref: {
      get: () => p.model,
      set: (/** @type {string} */ m) => void (p.model = m),
      last: () => p.last,
      effort: () => p.effort,
      thinking: () => p.thinking,
      setEffort: (/** @type {string} */ l, /** @type {boolean | undefined} */ on) => {
        p.effort = l;
        if (on) p.thinking = true;
      },
    },
  };
};

/**
 * The tour opened over fakes: the routes it asks answered from `routes` (a method and path each), every call kept.
 * `later`: the page's timers, kept by the test to be run by hand; `now`: the clock.
 * @param {Record<string, any>} [routes] @param {any} [o]
 */
const open = (routes = {}, o = {}) => {
  /** @type {{ method: string, path: string, body: any }[]} */
  const calls = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ opts = {}) => {
    const method = opts.method || "GET";
    calls.push({ method, path, body: opts.body });
    const r = routes[`${method} ${path}`];
    if (typeof r === "function") return r(opts.body);
    if (r === undefined) throw Object.assign(new Error(`no ${method} ${path}`), { body: null });
    return r;
  };
  const agents = o.agents || keeper({ entries: [] });
  const accounts = o.accounts || keeper([]);
  const start = o.pref || prefOf();
  /** @type {any[]} */
  const done = [], steps = [], kept = [], examples = [], signIns = [], settings = [], started = [], sessions = [], toasts = [];
  const t = W.openWelcome(
    {
      step: o.step,
      agents,
      accounts,
      signIn: (upstream, back) => signIns.push({ upstream, back }),
      install: (id, back) => signIns.push({ install: id, back }),
      onStep: (/** @type {number} */ i, /** @type {string} */ id) => { steps.push(i); kept.push(id); },
      onDone: (how) => done.push(how),
      onExample: (x) => examples.push(x),
      onSettings: (s) => settings.push(s),
      onStart: () => started.push(true),
      onSessions: () => sessions.push(true),
      onToast: (/** @type {string} */ msg, /** @type {string | undefined} */ kind) => toasts.push([msg, kind]),
      ...(o.pickFolder ? { pickFolder: o.pickFolder, folders: o.folders } : {}),
    },
    { api, pref: start.pref, ...(o.later ? { later: o.later } : {}), ...(o.now ? { now: o.now } : {}), ...(o.modelRow ? { modelRow: o.modelRow } : {}), ...(o.modelSelect ? { modelSelect: o.modelSelect } : {}) },
  );
  return { t, calls, done, steps, kept, examples, signIns, settings, started, sessions, toasts, agents, accounts, p: start.p };
};

const MB = 1 << 20;
/** The page's clock in the Your chats tests: 12 Nov 2026, 15:30. */
const NOW = new Date(2026, 10, 12, 15, 30).getTime();
const at = (/** @type {number} */ daysAgo, h = 14, min = 2) => new Date(2026, 10, 12 - daysAgo, h, min).getTime();
// The other coding agents' chats as a newcomer's computer holds them: two agents found, none switched on (as Filament
// ships), nothing in Filament yet; a third not found. The tour's read of the overview names the chats a run could
// bring (`?list=1`): three of Claude Code's — one whose folder is not on this computer, its size an estimate — and
// one of Codex's, the newest first.
const CLAUDE_LIST = [
  { id: "shop/a1", cwd: "H:\\shop", preview: "first words of a1", lastAt: at(0, 11, 5), bytes: 4 * MB, state: "new" },
  { id: "daily/b1", cwd: "H:\\notes\\daily", title: "Daily notes", preview: "first words of b1", lastAt: at(1, 9, 10), bytes: 200 * MB, state: "new" },
  { id: "old/c1", project: "old-workspace", preview: "first words of c1", lastAt: at(3), bytes: 8 * MB, about: true, state: "new" },
];
const CODEX_LIST = [{ id: "x1", cwd: "H:\\tool", preview: "Fix the parser", lastAt: at(2), bytes: 1 * MB, state: "new" }];
const CLAUDE = { id: "claude-code", label: "Claude Code", where: "C:\\Users\\me\\.claude\\projects", found: true, on: false, chats: 79, bytes: 5.7 * 1024 * MB, projects: 20, states: { new: 78, own: 1 }, pending: { chats: 3, bytes: 212 * MB, list: CLAUDE_LIST } };
const CODEX = { id: "codex", label: "Codex", where: "C:\\Users\\me\\.codex\\sessions", found: true, on: false, chats: 60, bytes: 7 * MB, projects: 4, states: { new: 1, own: 59 }, pending: { chats: 1, bytes: 1 * MB, list: CODEX_LIST } };
const CURSOR = { id: "cursor", label: "Cursor", where: "C:\\Users\\me\\.cursor\\projects", found: false, on: false, chats: 0, bytes: 0, projects: 0, states: {}, pending: { chats: 0, bytes: 0, list: [] } };
const CHATS = { prefs: { reachDays: 30, on: [], learn: false }, reaches: [7, 30, 90, 0], last: null, free: 40 * 1024 * MB, sources: [CLAUDE, CODEX, CURSOR], unread: { chats: 0, passes: 0 }, job: null, reading: null, learner: { model: "a/haiku", why: null } };
/** The overview as the tour reads it: with the chats a run could bring named. */
const OVERVIEW = "/memory/import/overview?list=1";

/**
 * Settings › Import's routes as the server answers them, scripted as test/import-page.test.js's stand-in is: the
 * overview it holds, a choice written into it, the job of the chats chosen (and a Sync's, which the tour never
 * starts) — named by the overview while it runs —, Stop; and the page's timers, kept to be run by hand (`tick`).
 * @param {any} overview
 */
const importServer = (overview) => {
  const state = { overview: structuredClone(overview), /** @type {Map<string, any>} */ jobs: new Map() };
  /** @type {(() => void)[]} */
  const timers = [];
  const start = (/** @type {string} */ kind) => {
    const job = { id: `${kind}-1`, kind, status: "running", percent: 0, progress: [], stoppable: true };
    state.jobs.set(job.id, job);
    state.overview.job = { id: job.id, kind: job.kind };
    return { job: structuredClone(job) };
  };
  /** @type {Record<string, any>} */
  const routes = {
    [`GET ${OVERVIEW}`]: () => structuredClone(state.overview),
    "PUT /memory/import/prefs": (/** @type {any} */ body) => {
      Object.assign(state.overview.prefs, body);
      for (const s of state.overview.sources) s.on = state.overview.prefs.on.includes(s.id);
      return { prefs: state.overview.prefs };
    },
    "POST /memory/import/chosen": () => start("import-chosen"),
    "POST /memory/import/sync": () => start("import-sync"),
  };
  for (const id of ["import-chosen-1", "import-sync-1"]) {
    routes[`GET /memory/jobs/${id}`] = () => structuredClone(state.jobs.get(id));
    routes[`POST /memory/jobs/${id}/stop`] = () => ({ stopped: true });
  }
  return {
    state,
    routes,
    timers,
    later: (/** @type {() => void} */ fn) => void timers.push(fn),
    /** The page's next look at its runs. */
    tick: async () => { for (const fn of timers.splice(0)) fn(); await settle(); },
    /** The run moves on, or ends: an ended one is named by the overview no more. @param {Record<string, any>} patch */
    job: (patch) => {
      Object.assign([...state.jobs.values()][0], patch);
      if (patch.status && patch.status !== "running") state.overview.job = null;
    },
    /** Chats came in: they leave their agent's list, and stand as in Filament. @param {string} source @param {string[]} ids */
    cameIn: (source, ids) => {
      const s = state.overview.sources.find((/** @type {any} */ x) => x.id === source);
      const gone = s.pending.list.filter((/** @type {any} */ c) => ids.includes(c.id));
      s.pending.list = s.pending.list.filter((/** @type {any} */ c) => !ids.includes(c.id));
      s.pending.chats = s.pending.list.length;
      s.pending.bytes -= gone.reduce((/** @type {number} */ n, /** @type {any} */ c) => n + c.bytes, 0);
      s.states = { ...s.states, new: s.states.new - gone.length, imported: (s.states.imported || 0) + gone.length };
    },
  };
};
/** Your chats over a scripted server, on the tests' clock. @param {ReturnType<typeof importServer>} srv @param {Record<string, any>} [more] */
const chatsStep = (srv, more = {}) => open(srv.routes, { step: stepOf("import"), later: srv.later, now: () => NOW, ...more });
/** An agent's group on Your chats' list, and a chat's row. @param {string} id */
const groupOf = (id) => q(`.wel-import .wel-pick-group[data-agent="${id}"]`);
const rowOf = (/** @type {string} */ id) => q(`.wel-import .wel-pick-row[data-chat="${id}"]`);
/** The tick of a row or of a group's head; the one over the list. @param {any} el */
const tickOf = (el) => el.querySelector("input");
const allTick = () => q(".wel-import .wel-pick-all input");
/** A tick pressed, as the person's click leaves it. @param {any} el @param {boolean} on */
const setTick = (el, on) => { el.checked = on; el.dispatch("change"); };
/** How a tick over several chats stands. @param {any} el */
const stands = (el) => (el.indeterminate ? "some" : el.checked ? "all" : "none");
/** The chats ticked, as the list shows them. */
const ticked = () => qa(".wel-import .wel-pick-row").filter((r) => tickOf(r).checked).map((r) => r.getAttribute("data-chat"));
/** The bring row: what is chosen, its hint, the button's words and whether it waits. */
const brings = () => [text(q(".wel-import .wel-bring-head")), text(q(".wel-import .wel-bring .wel-hint")), text(q(".wel-import .wel-bring button")), q(".wel-import .wel-bring button").hasAttribute("disabled")];
/** What the filter is typed to. @param {string} words */
const filterTo = (words) => { const f = q(".wel-import .wel-pick-filter"); f.value = words; f.dispatch("input"); };
/** How often the overview was read, with its list or without. @param {{ method: string, path: string }[]} calls */
const overviews = (calls) => calls.filter((c) => c.method === "GET" && c.path.startsWith("/memory/import/overview")).length;
/** What was posted and put. @param {{ method: string, path: string, body: any }[]} calls @param {string} method */
const sent = (calls, method) => calls.filter((c) => c.method === method).map((c) => [c.path, c.body]);

describe("the welcome tour", () => {
  // (fails before: yes — five steps on a bar over the page, none of them the default model, how the agent asks, where you
  // work or what was set: the owner's of 11-05)
  // (fails before: yes — the owner's of 11-12: nine steps, bringing your chats in half-said inside Your work, with a
  // button that closed the tour for Settings › Import)
  test("its rail: ten steps in three groups — Your chats after Memory, before Your work —, the one on lit and those seen ticked; a click jumps; Previous, Next, Finish; Skip", async () => {
    const { t, done, steps, kept } = open();
    assert.deepEqual(qa(".wel-step").map((b) => text(b.querySelector(".wel-label"))), ["Welcome", "Connect a model", "Default model", "How it asks", "Memory", "Your chats", "Your work", "Agents and teams", "Everything else", "Ready"]);
    assert.deepEqual(W.WELCOME_STEPS.filter((st) => st.group === "Set up").map((st) => st.id), ["welcome", "connect", "model", "asks", "memory", "import", "work"]);
    assert.deepEqual(qa(".wel-group-label").map(text), ["Set up", "Discover", "Start"]);
    assert.equal(qa(".wel-step")[0].getAttribute("aria-current"), "step");
    assert.equal(buttons("Previous")[0].hasAttribute("disabled"), true, "nothing before the first");
    // (fails before: yes — Product's review of 11-06: the sheet's title said again as the page's, a second way to step 2
    // and a list of the steps the rail already is)
    assert.equal(text(q(".wel-pagehead .wel-h")), "Every coding agent you have, in one window", "not the sheet's title again");
    assert.deepEqual([qa(".wel-plan-step").length, buttons("Set it up").length], [0, 0], "one way on, Next; the rail is the steps ahead");
    qa(".wel-step")[7].dispatch("click");
    assert.ok(q(".wel-team"), "Agents and teams shows");
    assert.equal(t.step(), 7);
    assert.equal(text(q(".wel-eyebrow")), "Step 8 of 10 · Discover");
    assert.equal(text(q(".wel-where-at")), "Step 8 of 10");
    assert.match(text(qa(".wel-step")[0]), /^✓/, "a step seen is ticked");
    press("Next");
    press("Next");
    assert.ok(q(".wel-ready"));
    assert.deepEqual(buttons("Finish").length, 1, "the last step's Next is Finish");
    // (fails before: yes — Product's review of 11-06: Finish stood primary beside Start your first chat, and Skip for now
    // on the last step)
    assert.deepEqual([buttons("Finish")[0].classList.contains("zc-btn-v-ghost"), buttons("Finish")[0].classList.contains("zc-btn-v-default"), /** @type {any} */ (buttons("Skip for now")[0]).hidden], [true, false, true], "Start your first chat is the one to press; nothing left to skip");
    press("Previous");
    assert.equal(t.step(), 8);
    assert.deepEqual([buttons("Next")[0].classList.contains("zc-btn-v-default"), /** @type {any} */ (buttons("Skip for now")[0]).hidden], [true, false], "back a step, Next leads again");
    assert.deepEqual(steps, [0, 7, 8, 9, 8], "each step is told to the page, to keep");
    assert.deepEqual(kept, ["welcome", "team", "discover", "ready", "discover"], "by its name too, which is what the page keeps");
    press("Next");
    press("Finish");
    assert.equal(sheetEl(), null, "it closed");
    assert.deepEqual(done, ["finish"]);
    const again = open({}, { step: 3 });
    assert.equal(again.t.step(), 3, "it opens at the step it was left on");
    press("Skip for now");
    assert.deepEqual(again.done, ["skip"]);
    assert.equal(sheetEl(), null);
  });

  test("the rail says what each step has set: what answers, the model and its effort, the mode, memory", async () => {
    const { p } = open(
      {
        "GET /start": { connected: { ok: true, models: 3, example: "a/opus" }, memory: { enabled: true } },
        "GET /defaults/settings": { flat: { "loop.permissions": "ask" } },
      },
      { pref: prefOf({ model: "a/claude-opus-5-5", effort: "high" }) },
    );
    await settle();
    const f = facts();
    assert.deepEqual([f["Connect a model"], f["Default model"], f["How it asks"], f.Memory], ["3 models", "Claude Opus 5.5 · High", "Ask before changes", "On"]);
    assert.equal(p.model, "a/claude-opus-5-5", "reading writes nothing");
    closeIt();
  });

  // (fails before: yes — every agent the registry knows was listed, 38 of them not installed, ahead of nothing; a connected
  // agent never read said "its sign-in not read yet" with no way to read it; Claude Max's plan was said twice; seen in the
  // tour's screenshots, 11-05)
  test("Connect a model: your agents first, the others folded; a connected agent never read is asked who is signed in, once; a plan its label names is said once", async () => {
    assert.equal(W.agentRowOf({ id: "c", state: "connected", upstreams: ["cc"] }, [{ upstream: "cc", account: { identity: { kind: "account", label: "Claude Max", plan: "max" } } }]).words, "Signed in as Claude Max");
    assert.equal(W.agentRowOf({ id: "c", state: "connected", upstreams: ["cc"] }, [{ upstream: "cc", account: {} }]).words, "Connected — not heard from yet");
    assert.equal(W.agentRowOf({ id: "c", state: "connected", upstreams: ["cc"] }, [{ upstream: "cc", account: {} }], new Set(["cc"])).words, "Connected — asking who is signed in…");
    // (fails before: yes — the owner's of 11-11: an agent signed in that doesn't say as whom read "Connected — it doesn't
    // say which account it runs on", with Sign in, as one nobody had signed in to)
    const unnamed = { identity: null, signedOut: false, identitySource: "sign-in" };
    assert.deepEqual(W.agentRowOf({ id: "a", state: "connected", upstreams: ["agy"] }, [{ upstream: "agy", says: false, account: unnamed }]), { state: "signed-in", words: "Signed in — it doesn't say which account it runs on", act: null });
    assert.deepEqual(W.agentRowOf({ id: "c", state: "connected", upstreams: ["cc"] }, [{ upstream: "cc", says: null, account: unnamed }]), { state: "signed-in", words: "Signed in", act: null });
    assert.equal(W.agentRowOf({ id: "a", state: "connected", upstreams: ["agy"] }, [{ upstream: "agy", says: false, account: { identity: null, signedOut: false, identitySource: null } }]).words, "Connected — it doesn't say which account it runs on", "nothing known of it: as before");

    const agents = keeper({
      entries: [
        { id: "amp", name: "Amp", state: "missing", download: "https://amp" },
        { id: "claude", name: "Claude Code", state: "connected", upstreams: ["claude-code"], primary: "claude-code" },
        { id: "gemini", name: "Gemini CLI", state: "missing", install: { way: "npm" } },
      ],
    });
    /** @type {string[]} */
    const checks = [];
    /** @type {() => void} */
    let answer = () => {};
    const accounts = {
      ...keeper([{ agent: "claude", upstream: "claude-code", agentName: "Claude Code", account: {} }]),
      check: (/** @type {string} */ upstream) => (checks.push(upstream), new Promise((r) => (answer = () => r(undefined)))),
    };
    open({}, { agents, accounts, step: stepOf("connect") });
    const row = (/** @type {string} */ id) => q(`.wel-row[data-agent="${id}"]`);
    assert.deepEqual(checks, ["claude-code"], "asked as the step opens");
    assert.equal(text(row("claude")?.querySelector(".wel-row-state")), "Connected — asking who is signed in…");
    const more = q(".wel-more");
    assert.equal(more.hidden, false);
    assert.equal(text(more.querySelector("summary")), "More coding agents (2)");
    assert.deepEqual(more.querySelectorAll(".wel-row").map((/** @type {any} */ r) => r.getAttribute("data-agent")), ["amp", "gemini"], "the ones not here, folded");
    assert.equal(more.querySelector('.wel-row[data-agent="claude"]'), null, "yours stay out of the fold");
    accounts.set([{ agent: "claude", upstream: "claude-code", agentName: "Claude Code", account: { identity: { kind: "account", label: "ada@example.com" } } }]);
    answer();
    await settle();
    assert.equal(text(row("claude")?.querySelector(".wel-row-state")), "Signed in as ada@example.com");
    agents.set({ entries: [{ id: "claude", name: "Claude Code", state: "connected", upstreams: ["claude-code"], primary: "claude-code" }] });
    assert.deepEqual(checks, ["claude-code"], "once");
    assert.equal(more.hidden, true, "none to fold: no fold");
    agents.set({ entries: [{ id: "amp", name: "Amp", state: "missing", download: "https://amp" }] });
    assert.match(text(q(".wel-agents .wel-rows")), /None of them is on this computer yet/);
    assert.equal(more.open, true, "none here: the fold opens by itself");
    closeIt();
  });

  test("Connect a model: each agent's state and its act; a sign-in takes the tour's place and gives it back; the row turns as the sign-in ends", async () => {
    assert.deepEqual(W.agentRowOf({ id: "codex", state: "ready" }, []).act?.kind, "connect");
    assert.deepEqual(W.agentRowOf({ id: "gemini", state: "missing", install: { way: "npm", line: "npm i -g x" } }, []).act?.kind, "install");
    assert.equal(W.agentRowOf({ id: "gemini", state: "missing", install: { way: "npm", needs: "npm" } }, []).act, null, "one that needs npm first offers nothing to press");
    assert.equal(W.agentRowOf({ id: "x", state: "missing", download: "https://x" }, []).act?.kind, "download");
    assert.equal(W.agentRowOf({ id: "x", state: "connected", installing: {} }, []).state, "installing");
    // (fails before: yes — the tour matched an account by the agent's key, which a registry agent's entry id is not, and
    // took the first account, an added one before its Default; found by the review of 8e420b6ff)
    const work = { upstream: "cc-work", agent: "claude-code", account: { identity: { kind: "none" }, signedOut: true } };
    const main = { upstream: "cc", agent: "claude-code", account: { identity: { kind: "account", label: "ada@example.com" } } };
    assert.equal(W.agentRowOf({ id: "claude", state: "connected", upstreams: ["cc-work", "cc"], primary: "cc" }, [work, main]).state, "signed-in", "its Default's account, by the upstreams it serves");
    assert.equal(W.agentRowOf({ id: "claude", state: "connected", upstreams: ["cc"], primary: "cc" }, [work]).state, "connected", "another agent's account is not its own");

    const agents = keeper({ entries: [{ id: "claude", name: "Claude Code", state: "connected", upstreams: ["claude-code"], primary: "claude-code" }, { id: "codex", name: "Codex", state: "ready" }] });
    const accounts = keeper([{ agent: "claude", upstream: "claude-code", agentName: "Claude Code", account: { identity: { kind: "none" }, signedOut: true } }]);
    const listed = { entries: [{ id: "claude", name: "Claude Code", state: "connected", upstreams: ["claude-code"], primary: "claude-code" }, { id: "codex", name: "Codex", state: "connected" }] };
    let models = 0;
    const { calls, signIns, done } = open(
      { "POST /coding-agents/codex/connect": listed, "GET /coding-agents": listed, "GET /start": () => ({ connected: { ok: models > 0, models } }) },
      { agents, accounts, step: stepOf("connect") },
    );
    await settle();
    assert.match(text(q(".wel-status")), /^Nothing can answer yet/, "the banner says what answers");
    const row = (/** @type {string} */ id) => q(`.wel-row[data-agent="${id}"]`);
    assert.equal(text(row("claude")?.querySelector(".wel-row-state")), "Not signed in");
    assert.equal(text(row("codex")?.querySelector(".wel-row-state")), "Installed, not connected");
    models = 4;
    press("Connect");
    await settle();
    assert.ok(calls.some((c) => c.method === "POST" && c.path === "/coding-agents/codex/connect"));
    assert.equal(text(row("codex")?.querySelector(".wel-row-state")), "Connected", "the keeper took the answer, and the row turned");
    // (fails before: yes — no banner: nothing said whether anything could answer yet, the owner's of 11-05)
    assert.match(text(q(".wel-status")), /^✓ Filament can answer on 4 models/, "an agent connected: what answers is read again");
    assert.equal(facts()["Connect a model"], "4 models");
    accounts.set([{ agent: "claude", upstream: "claude-code", agentName: "Claude Code", account: { identity: { kind: "account", label: "ada@example.com", plan: "Max" } } }]);
    assert.equal(text(row("claude")?.querySelector(".wel-row-state")), "Signed in as ada@example.com · Max", "a sign-in that ended turns its row");
    accounts.set([{ agent: "claude", upstream: "claude-code", agentName: "Claude Code", account: { identity: { kind: "none" }, signedOut: true } }]);
    qa(".wel-step")[2].dispatch("click");
    qa(".wel-step")[1].dispatch("click");
    press("Sign in");
    assert.equal(sheetEl(), null, "the sign-in's sheet takes the tour's place");
    assert.deepEqual(done, [], "stepping aside ends nothing");
    assert.equal(signIns[0].upstream, "claude-code");
    assert.equal(agents.size(), 0, "its listeners went with it");
    signIns[0].back();
    assert.ok(sheetEl(), "the sign-in's sheet closed: the tour is back");
    assert.ok(q(".wel-agents"), "at the step it was on");
    assert.match(text(qa(".wel-step")[2]), /^✓/, "the steps seen before it stepped aside are still ticked");
    press("Look again");
    await settle();
    assert.ok(calls.some((c) => c.path === "/coding-agents"));
    closeIt();
  });

  // (fails before: yes — a plan picked ran the provider's fill, which put its plans back and the first picked: Z.AI's
  // API went in as its coding plan; found by the review of 8e420b6ff)
  test("Connect a model's key: a provider's plan picked stays picked, its own key's link beside it, and goes in with the key", async () => {
    /** @type {any[]} */
    const posted = [];
    open(
      {
        "GET /upstreams": { upstreams: [] },
        "GET /providers": { providers: [{ id: "zai", name: "Z.AI", prefix: "zai", plans: [{ id: "coding", label: "Coding plan", keyUrl: "https://z.ai/coding" }, { id: "api", label: "API", keyUrl: "https://z.ai/api" }] }] },
        "POST /upstreams": (/** @type {any} */ body) => (posted.push(body), { upstream: { id: "zai" } }),
        "GET /upstreams/zai/test": { ok: true },
      },
      { step: stepOf("connect") },
    );
    await settle();
    const plan = qa(".wel-keys select")[1];
    assert.equal(plan.hidden, false, "two plans: the person picks");
    const options = plan.querySelectorAll("option");
    plan.value = "api";
    plan.dispatch("change");
    // A browser's select put back to its first option as its options are drawn again; the stub's keeps its value.
    assert.deepEqual(plan.querySelectorAll("option"), options, "a plan picked leaves the plans as they are");
    assert.equal(plan.value, "api");
    assert.equal(q(".wel-link")?.href, "https://z.ai/api");
    q(".wel-input").value = "zk-1";
    press("Add and test");
    await settle();
    assert.deepEqual(posted, [{ provider: "zai", plan: "api", apiKey: "zk-1", prefix: "zai" }]);
    closeIt();
  });

  test("Connect a model's key: a provider's key added and tried at once — ✓ with its models, a taken name taken as the one offered — and the keys already added, masked", async () => {
    /** @type {any[]} */
    const posted = [];
    let first = true;
    const { calls } = open(
      {
        "GET /upstreams": { upstreams: [{ id: "openai", name: "OpenAI", key: { stored: true, masked: "sk-…abcd" } }, { id: "cc", agent: "claude", key: { stored: true } }] },
        "GET /providers": { providers: [{ id: "anthropic", name: "Anthropic", prefix: "anthropic", keyUrl: "https://console.anthropic.com/keys", plans: [] }, { id: "azure", name: "Azure", fields: [{ id: "resource" }] }] },
        "POST /upstreams": (/** @type {any} */ body) => {
          posted.push(body);
          if (first) {
            first = false;
            throw Object.assign(new Error("taken"), { body: { free: "anthropic-2" } });
          }
          return { upstream: { id: body.prefix } };
        },
        "GET /upstreams/anthropic-2/test": { ok: true, ms: 120, models: 7 },
      },
      { step: stepOf("connect") },
    );
    await settle();
    const have = qa(".wel-keys .wel-row");
    assert.deepEqual(have.map((r) => [text(r.querySelector(".wel-row-name")), text(r.querySelector(".wel-row-state"))]), [["OpenAI", "✓ Key saved · sk-…abcd"]], "the keys added, said saved, masked; a coding agent's is none");
    const options = qa(".wel-keys select")[0].querySelectorAll("option").map((/** @type {any} */ x) => text(x));
    assert.deepEqual(options, ["Anthropic"], "a provider that asks for more than a key is Settings' to add");
    assert.equal(q(".wel-link")?.href, "https://console.anthropic.com/keys", "where its key is got");
    press("Add and test");
    assert.equal(text(q(".wel-said")), "Paste the key first.");
    q(".wel-input").value = "sk-ant-test";
    const starts = calls.filter((c) => c.path === "/start").length;
    press("Add and test");
    await settle();
    await settle();
    assert.deepEqual(posted, [{ provider: "anthropic", apiKey: "sk-ant-test", prefix: "anthropic" }, { provider: "anthropic", apiKey: "sk-ant-test", prefix: "anthropic-2" }]);
    assert.equal(text(q(".wel-said")), "✓ anthropic-2 answers in 120 ms: 7 models.");
    assert.ok(calls.some((c) => c.path === "/upstreams/anthropic-2/test"));
    assert.equal(calls.filter((c) => c.path === "/start").length, starts + 1, "a key added: what answers is read again");
    assert.equal(q(".wel-input").value, "", "the key leaves the field");
    closeIt();
  });

  // (fails before: yes — the tour never set where new chats start: the owner's of 11-05, "configuring Filament step by
  // step", with "every model picker includes reasoning effort")
  test("Default model: the composer's picker with its effort, on the model new chats start on; a pick, Use the default and an effort each write where new chats start", async () => {
    /** @type {any} */
    let made = null;
    /** @type {any[]} */
    const shown = [];
    const modelRow = (/** @type {any} */ opts) => {
      made = opts;
      return { row: doc.document.createElement("div"), show: (/** @type {any[]} */ ...a) => void shown.push(a), relist: () => {}, model: () => "", effort: () => "", ready: () => true, say: () => {}, hold: () => {} };
    };
    const families = [{ id: "a/opus", upstream: "a", effort: { levels: ["low", "medium", "high", "max"], via: "setting" }, members: [{ id: "a/opus" }] }, { id: "a/mini", upstream: "a", members: [{ id: "a/mini" }] }];
    const { p } = open({ "GET /models?all=1": { models: [{ id: "a/opus" }, { id: "a/mini" }], families } }, { step: stepOf("model"), modelRow, pref: prefOf({ last: "a/opus", effort: "high" }) });
    await settle();
    assert.equal(made.named, "New chats start on");
    assert.equal(made.effort?.tuning, true, "with its effort, on the message box's own chip");
    // (fails before: yes — Product's review of 11-06: "the model you used last" on a fresh install, where none was used)
    assert.deepEqual(shown.at(-1), ["a/opus", "The message box's model now: choose one, and every new chat starts on it.", "high"], "the message box's, at the effort a new chat starts from");
    assert.equal(made.defaultDesc, "Start on the model the message box had last");
    made.onPick("a/mini");
    assert.deepEqual([p.model, shown.at(-1)], ["a/mini", ["a/mini", "Every new chat starts on it.", ""]], "a model that takes no effort shows none");
    assert.match(facts()["Default model"], /^Mini/);
    made.effort.onPick("max");
    assert.equal(p.effort, "max");
    assert.match(text(q(".wel-model .wel-said")), /New chats think at Max/);
    made.onDefault();
    assert.deepEqual([p.model, shown.at(-1)[0]], ["", "a/opus"], "Use the default: the one used last again");
    closeIt();
    open({ "GET /models?all=1": { models: [], families: [] } }, { step: stepOf("model"), modelRow });
    await settle();
    assert.match(text(q(".wel-model")), /Nothing can answer yet/);
    press("Connect a model");
    assert.ok(q(".wel-connect"), "nothing to choose: it leads to Connect a model");
    closeIt();
  });

  // (fails before: yes — a coding agent's model whose ids spell the level was named by its id, "Opus Low", its effort
  // shown as Default, and an effort chosen never reached it: a new chat ran the member picked at its own level)
  test("Default model: a model whose ids spell its level is named as its family, at its member's level; an effort moves it to the member at that level", async () => {
    /** @type {any} */
    let made = null;
    /** @type {any[]} */
    const shown = [];
    const modelRow = (/** @type {any} */ opts) => {
      made = opts;
      return { row: doc.document.createElement("div"), show: (/** @type {any[]} */ ...a) => void shown.push(a), relist: () => {}, model: () => "", effort: () => "", ready: () => true, say: () => {}, hold: () => {} };
    };
    const families = [{ id: "c/opus", label: "Claude Opus 5.5", upstream: "c", kind: "variants", effort: { levels: ["low", "high"], via: "name", plain: false }, members: [{ id: "c/opus-low", effort: "low" }, { id: "c/opus-high", effort: "high" }] }];
    const routes = { "GET /models?all=1": { models: [{ id: "c/opus-low" }, { id: "c/opus-high" }], families } };
    let { p } = open(routes, { step: stepOf("model"), modelRow, pref: prefOf() });
    await settle();
    made.onPick("c/opus-low");
    assert.deepEqual([p.model, shown.at(-1)[2]], ["c/opus-low", "low"], "at its member's own level");
    assert.equal(facts()["Default model"], "Claude Opus 5.5 · Low", "named as its picker names it");
    assert.match(text(q(".wel-model .wel-said")), /^New chats start on Claude Opus 5\.5\.$/);
    made.effort.onPick("high");
    assert.deepEqual([p.model, p.effort, shown.at(-1)[0], shown.at(-1)[2]], ["c/opus-high", "high", "c/opus-high", "high"], "the member at the level chosen");
    assert.equal(facts()["Default model"], "Claude Opus 5.5 · High");
    // Default effort, on a model with no plain member: the one it is on stays, and says its level.
    made.effort.onPick("");
    assert.deepEqual([p.model, shown.at(-1)[0], shown.at(-1)[2]], ["c/opus-high", "c/opus-high", "high"]);
    assert.match(text(q(".wel-model .wel-said")), /^Claude Opus 5\.5 has no default of its own: new chats on it think at High\.$/);
    closeIt();
    ({ p } = open(routes, { step: stepOf("model"), modelRow, pref: prefOf({ effort: "max" }) }));
    await settle();
    made.onPick("c/opus-low");
    assert.equal(p.model, "c/opus-high", "picked with an effort it lacks: the member at the nearest under it, as the composer's pick");
    closeIt();
  });

  // (fails before: yes — Max on an Opus kept thinking off, so a new chat ran it capped at High while the tour said Max)
  test("Default model: a level that needs extended thinking turns it on with it, and the rail says what a new chat runs at", async () => {
    /** @type {any} */
    let made = null;
    const modelRow = (/** @type {any} */ opts) => {
      made = opts;
      return { row: doc.document.createElement("div"), show: () => {}, relist: () => {}, model: () => "", effort: () => "", ready: () => true, say: () => {}, hold: () => {} };
    };
    const families = [{ id: "k/opus", label: "Opus 5.5", upstream: "k", kind: "model", effort: { via: "setting", levels: ["low", "medium", "high", "xhigh", "max"], capWithoutThinking: "high", default: "high" }, thinking: { via: "setting" }, members: [{ id: "k/opus", effort: null, speed: null, thinking: null, window: null }] }];
    const routes = { "GET /models?all=1": { models: [{ id: "k/opus" }], families } };
    let { p } = open(routes, { step: stepOf("model"), modelRow, pref: prefOf({ model: "k/opus", effort: "max" }) });
    await settle();
    assert.equal(facts()["Default model"], "Opus 5.5 · High", "thinking off: Max runs capped at High, and the rail says so");
    made.effort.onPick("max");
    assert.deepEqual([p.effort, p.thinking], ["max", true], "Max with thinking on, as the composer's pick");
    assert.equal(facts()["Default model"], "Opus 5.5 · Max");
    assert.match(text(q(".wel-model .wel-said")), /^New chats think at Max/);
    closeIt();
    ({ p } = open(routes, { step: stepOf("model"), modelRow, pref: prefOf({ model: "k/opus" }) }));
    await settle();
    made.effort.onPick("medium");
    assert.deepEqual([p.effort, p.thinking], ["medium", false], "a level it runs without thinking leaves thinking as it was");
    closeIt();
  });

  // (fails before: yes — the tour never said what the agent may do on its own, nor set it: the owner's of 11-05)
  test("How it asks: the four modes as cards, the one new chats start in on; a pick writes your default, Full access warned of", async () => {
    /** @type {any[]} */
    const patched = [];
    const { calls } = open(
      {
        "GET /defaults/settings": { flat: { "loop.permissions": "ask" } },
        "PATCH /defaults/settings": (/** @type {any} */ b) => (patched.push(b), { flat: { "loop.permissions": b.patch.loop.permissions } }),
      },
      { step: stepOf("asks") },
    );
    await settle();
    // (fails before: yes — Product's review of 11-06: Ask before changes stood after Edit automatically)
    assert.deepEqual(qa(".wel-mode").map((b) => b.getAttribute("data-mode")), ["read-only", "ask", "edit", "auto"], "the least it may do first");
    assert.equal(q(".wel-mode.on")?.getAttribute("data-mode"), "ask");
    assert.equal(q(".wel-mode.on")?.getAttribute("aria-checked"), "true");
    assert.match(text(q('.wel-mode[data-mode="edit"]')), /Filament's default/);
    q('.wel-mode[data-mode="auto"]').dispatch("click");
    await settle();
    assert.deepEqual(patched, [{ patch: { loop: { permissions: "auto" } } }]);
    assert.equal(q(".wel-mode.on")?.getAttribute("data-mode"), "auto");
    assert.match(text(q(".wel-asks .wel-said")), /^✓ New chats start in Full access\. It edits and runs any command without asking you/);
    assert.equal(facts()["How it asks"], "Full access");
    q('.wel-mode[data-mode="auto"]').dispatch("click");
    await settle();
    assert.equal(patched.length, 1, "the one on, picked again, writes nothing");
    assert.ok(calls.some((c) => c.method === "GET" && c.path === "/defaults/settings"));
    closeIt();
  });

  // (fails before: yes — the owner's of 11-06: "any place where model needs to be selected the model picker needs to be
  // shown, not just a dropdown with bunch of options"; the side model was a list of names. And Product's review of 11-06:
  // a checkbox, a switch and a list in four rows, two ways off, the model's id said again, an engine row once installed)
  // (fails before: yes — the memory plan's m1: Use the default let Filament choose the cheapest model with a price)
  test("Memory: on or off in words, no switch; while on, memory's model on the composer's picker — Use the default unsets it — set where it is picked; its engine only while it needs you", async () => {
    const families = [
      { id: "a/opus", label: "Opus", members: [{ id: "a/opus" }], price: { input: 5, output: 25 } },
      { id: "a/haiku", label: "Haiku", members: [{ id: "a/haiku" }], price: { input: 1, output: 5 } },
      { id: "z/glm", label: "GLM", members: [{ id: "z/glm" }], billing: "plan" },
    ];
    const answers = new Set(["a/opus", "a/haiku", "z/glm"]);
    /** The picker the step made, newest last, and what it was handed. @type {any[]} */
    const pickers = [];
    const modelSelect = (/** @type {any} */ c) => {
      const made = { c, el: doc.document.createElement("button"), shown: "", models: /** @type {any[]} */ ([]), families: /** @type {any[]} */ ([]), note: /** @type {string | null} */ (null), locked: /** @type {string | null} */ (null) };
      pickers.push(made);
      return {
        el: made.el,
        set: (/** @type {string} */ n) => void (made.shown = n),
        setModels: (/** @type {any[]} */ x) => void (made.models = x),
        setFamilies: (/** @type {any[]} */ x) => void (made.families = x),
        setAccounts: () => {},
        setNote: (/** @type {string | null} */ n) => void (made.note = n),
        setLocked: (/** @type {string | null} */ r) => void (made.locked = r),
      };
    };
    /** Where the engine stands, as /memory/engine says it: missing, then installing once Install is pressed. @type {any} */
    let engine = { state: "missing", error: null };
    /** What memory learns with, as /memory/models keeps it. @type {any} */
    let learning = { summarizer: "", effort: "", curatorUsesModel: true, now: "z/glm", from: "default", whyNone: null };
    let memoryOn = true;
    const { calls } = open(
      {
        "GET /memory/status": () => ({ enabled: memoryOn, engine: { installed: false, state: "stopped" } }),
        "GET /memory/engine": () => engine,
        "GET /memory/models": () => ({ models: learning }),
        "GET /models?all=1": { models: [...answers].map((id) => ({ id, answers: true })), families },
        "POST /memory/models": (/** @type {any} */ b) => ({ models: (learning = { ...learning, summarizer: b.summarizer, now: b.summarizer || "z/glm", from: b.summarizer ? "memory" : "default" }) }),
        "POST /memory/install": () => ((engine = { state: "installing", percent: 40, source: "bundle" }), { job: 1 }),
        "POST /memory/enabled": (/** @type {any} */ b) => ((memoryOn = b.enabled), { ok: true, enabled: b.enabled }),
      },
      { step: stepOf("memory"), modelSelect },
    );
    await settle();
    assert.equal(qa(".wel-memory select").length, 0, "no list of names");
    const pick = () => pickers.at(-1);
    assert.deepEqual([pick().shown, pick().note, pick().families, pick().models.length, pick().c.defaultDesc, pick().el.getAttribute("aria-label")], ["", null, families, 3, "Not set: each chat's compaction model, else the chat's own", "Memory's model"], "the picker on memory's model, none set, every model by family");
    const learnsRow = () => qa(".wel-memory .wel-row")[1];
    assert.equal(text(learnsRow().querySelector(".wel-row-name")), "Learns with");
    assert.ok(learnsRow().querySelector(".wel-row-state").childNodes.includes(pick().el), "in the Learns with row");
    assert.doesNotMatch(text(q(".wel-memory")), /z\/glm|picked for you|cheapest/, "not set: each chat's own, never a model chosen for you");
    assert.match(text(q(".wel-memory .wel-hint")), /^Each chat's compaction model, else the chat's own\.$/);
    assert.equal(facts().Memory, "On", "the rail names no model where none is set");
    pick().c.onChange("a/haiku");
    await settle();
    assert.deepEqual(calls.find((c) => c.method === "POST" && c.path === "/memory/models")?.body, { summarizer: "a/haiku" });
    // (fails before: yes — a pick said only a toast, the step stayed on the old model; found by the review of 8e420b6ff)
    assert.deepEqual([pick().shown, facts().Memory], ["a/haiku", "On · Haiku"], "the step shows the pick");
    pick().c.onUseDefault();
    await settle();
    assert.deepEqual(calls.filter((c) => c.method === "POST" && c.path === "/memory/models").at(-1)?.body, { summarizer: "" });
    // (fails before: yes — the owner's of 11-08 and 11-09: memory's one off switch is Settings › Experimental's, never
    // the tour's) Whether memory is on, in words, and no switch.
    assert.deepEqual(qa('.wel-memory [role="switch"]').length, 0);
    assert.equal(text(qa(".wel-memory .wel-row")[0].querySelector(".wel-row-state")), "On");
    assert.equal(qa(".wel-memory input").length, 0, "no checkbox");
    const engineLine = () => qa(".wel-memory .wel-row")[2];
    const engineRow = () => text(engineLine()?.querySelector(".wel-row-state"));
    assert.equal(engineLine().hidden, false, "missing: it needs you");
    // (fails before: yes — the row named Engine said "Its engine is…" of itself; seen in the tour's screenshots, 11-05)
    assert.equal(engineRow(), "Not installedInstall");
    press("Install");
    await settle();
    assert.ok(calls.some((c) => c.method === "POST" && c.path === "/memory/install"), "its engine installs from here");
    // (fails before: yes — the step read the engine from /memory/status, whose state is the engine process's and never
    // "installing": Install was offered again, no percent, no poll; found by the review of 8e420b6ff)
    assert.equal(engineRow(), "Installing — 40%");
    const statuses = calls.filter((c) => c.path === "/memory/status").length;
    engine = { state: "ready", source: "bundle" };
    await new Promise((r) => setTimeout(r, 1600));
    assert.equal(engineLine().hidden, true, "read again while it installs; installed, nothing to act on");
    assert.equal(calls.filter((c) => c.path === "/memory/status").length, statuses, "its row alone: the side model's list is not drawn again under the pointer");
    assert.equal(qa(".wel-memory .wel-row").length, 3, "no configuration read: no naming row");
    assert.ok(!calls.some((c) => c.path === "/memory/enabled"), "nothing here turns memory off");
    closeIt();
    // Memory turned off in Settings › Experimental: said, and the side model goes with it.
    memoryOn = false;
    open(
      {
        "GET /memory/status": () => ({ enabled: memoryOn, engine: { installed: true, state: "stopped" } }),
        "GET /memory/engine": { state: "ready" },
        "GET /memory/models": () => ({ models: learning }),
        "GET /models?all=1": { models: [], families: [] },
      },
      { step: stepOf("memory"), modelSelect },
    );
    await settle();
    assert.deepEqual([text(qa(".wel-memory .wel-row")[0].querySelector(".wel-row-state")), qa(".wel-memory .wel-row-name").map(text).includes("Learns with"), facts().Memory, qa('.wel-memory [role="switch"]').length], ["Off", false, "Off", 0]);
    closeIt();
    // Learning turned off in Settings › Memory: the picker on none, a word of how to have it learn again.
    open(
      {
        "GET /memory/status": { enabled: true },
        "GET /memory/engine": { state: "ready" },
        "GET /memory/models": { models: { summarizer: "off", now: null, from: "off", whyNone: "memory's model is off (Settings › Memory › Model)" } },
        "GET /models?all=1": { models: [], families: [] },
      },
      { step: stepOf("memory"), modelSelect },
    );
    await settle();
    assert.deepEqual([pick().shown, text(q(".wel-memory .wel-hint"))], ["", "Learning is off: choose a model, and memory learns from your chats again."]);
    closeIt();
  });

  // (fails before: yes — the tour said nothing of Settings › Experimental's naming by the side model: the owner's of 11-05)
  test("Memory: chats named by the side model, Settings › Experimental's switch, read and written as that page does", async () => {
    /** @type {any[]} */
    const set = [];
    open(
      {
        "GET /memory/status": { enabled: true },
        "GET /memory/engine": { state: "ready" },
        "GET /memory/models": { models: { summarizer: "a/haiku", now: "a/haiku", from: "memory" } },
        "GET /models?all=1": { models: [], families: [] },
        "GET /state": { config: { experimental: { nameChats: false } } },
        "PATCH /config/fields": (/** @type {any} */ b) => (set.push(b), { ok: true }),
      },
      { step: stepOf("memory") },
    );
    await settle();
    const row = qa(".wel-memory .wel-row")[3];
    assert.deepEqual([text(row.querySelector(".wel-row-name .wel-badge")), text(row.querySelector(".wel-row-name")).startsWith("Name chats")], ["Experimental", true]);
    const sw = row.querySelector('[role="switch"]');
    assert.deepEqual([sw.classList.contains("set-switch"), sw.getAttribute("aria-checked")], [true, "false"], "Settings' switch, as Memory's");
    assert.match(text(row.querySelector(".wel-row-state")), /^Off/, "it says it is off, as Memory says it is on");
    sw.dispatch("click");
    await settle();
    assert.equal(sw.getAttribute("aria-checked"), "true");
    assert.deepEqual(set, [{ set: { "experimental.nameChats": true } }]);
    assert.match(text(row.querySelector(".wel-row-state")), /^On/);
    assert.equal(facts().Memory, "On · Haiku");
    closeIt();
  });

  test("Memory: an install read while the step shows, and no more once the tour closes", async () => {
    const { calls } = open(
      {
        "GET /memory/status": { enabled: true },
        "GET /memory/engine": { state: "installing", percent: 10 },
        "GET /memory/models": { models: { summarizer: "auto" } },
        "GET /models?all=1": { models: [], families: [] },
      },
      { step: stepOf("memory") },
    );
    await settle();
    const reads = () => calls.filter((c) => c.path === "/memory/engine").length;
    assert.equal(reads(), 1);
    closeIt();
    await new Promise((r) => setTimeout(r, 1600));
    assert.equal(reads(), 1, "closed, its timer went with it");
  });

  // (fails before: yes — the tour never asked where you work: the owner's of 11-05)
  // (fails before: yes — 11-12: the step still read the other agents' chats, and sent the person out of the tour to
  // Settings › Import for them; they have a step of their own)
  test("Your work: a folder picked starts a chat in it, the folders worked in last a click away — and the folder alone: the chats you had elsewhere are Your chats'", async () => {
    /** @type {any[]} */
    const asked = [];
    const { calls } = open(
      { [`GET ${OVERVIEW}`]: CHATS },
      { step: stepOf("work"), pickFolder: async (/** @type {string | undefined} */ path) => (asked.push(path ?? null), path || "H:/proj/app"), folders: () => ["H:/old/site", "H:/old/tool"] },
    );
    await settle();
    assert.deepEqual(qa(".wel-work .wel-chip").map(text), ["site", "tool"], "the folders worked in last");
    press("Choose a folder…");
    await settle();
    assert.deepEqual(asked, [null], "the person's pick");
    assert.match(text(q(".wel-work .wel-signed-in")), /✓ H:\/proj\/app/);
    assert.equal(facts()["Your work"], "app");
    qa(".wel-work .wel-chip")[0].dispatch("click");
    await settle();
    assert.deepEqual(asked, [null, "H:/old/site"]);
    assert.deepEqual([overviews(calls), buttons("Open Settings › Import").length, qa(".wel-work h4").map(text)], [0, 0, ["A project folder"]], "nothing of the other agents' chats is read or said here");
    closeIt();
  });

  // (fails before: yes — by need, 11-12: the tour said "the folder has a Space of its own", and a project has none until
  // the first thing the person adds on its page makes one)
  test("Your work says a folder can have a Space, made by the first thing you add on its page: never that it has one", () => {
    assert.equal(W.WELCOME_STEPS[stepOf("work")].why,
      "A chat works in a project folder: the agent reads and edits there, and the folder can have a Space of its own — its board of tasks, and What happened, its logbook —, made by the first thing you add on its page.");
  });

  // (fails before: yes — the owner's of 11-12: "add a step asking users to import their chat from other agents.
  // Currently only way to do is to do it from settings and import so users might just miss that")
  // (fails before: yes — the owner's of 11-12, later: "the welcome tour should not import all the chats, even though
  // filtered by age it should show the individual chat that one can select or select all to bring in": the step had a
  // Sync switch per agent and one button, which brought in every chat in reach of the agents switched on)
  test("Your chats: the single chats a run could bring, a row each, grouped by agent as the server lists them — none chosen at first, and the button waits", async () => {
    const st = W.WELCOME_STEPS[stepOf("import")];
    assert.deepEqual([st.label, st.title, st.why], ["Your chats", "Bring in the chats you already have",
      // Two lines of the sheet, where it was three: every line above the list is a chat's row less in it. That more
      // comes in later from Settings › Import — the page the owner said people miss — is said at the list's end.
      "The chats you had in Claude Code, Codex and other coding agents on this computer can come into Filament, each as a chat here you can open and go on with. Nothing is changed where they are."]);
    const srv = importServer(CHATS);
    const { calls } = chatsStep(srv);
    assert.equal(text(q(".wel-import")), "Looking for your coding agents' chats…");
    await settle();
    assert.deepEqual(calls.filter((c) => c.path.startsWith("/memory/import")).map((c) => `${c.method} ${c.path}`), ["GET /memory/import/overview?list=1"], "one read, the chats a run could bring named in it");
    // The head line: what to do, and how far back the list reaches — one line, and no title over it (fails before: yes
    // — a title, then the sentence, then the list: at 1280 × 800 the list showed two chats and a half).
    const head = q(".wel-import .wel-titled");
    assert.equal(text(head.querySelector(".wel-lead")), "Choose the chats to bring in. Nothing comes in until you press the button.");
    assert.equal(head.querySelector("select").getAttribute("aria-label"), "Reaches back");
    assert.equal(qa(".wel-import h4").length, 0);
    // A group for each agent found that has chats in reach, in the server's order; one not found has none.
    assert.deepEqual(qa(".wel-import .wel-pick-group").map((s) => s.getAttribute("data-agent")), ["claude-code", "codex"]);
    const claude = groupOf("claude-code");
    assert.deepEqual([text(claude.querySelector(".wel-pick-name")), text(claude.querySelector(".wel-pick-agent .wel-hint")), !!claude.querySelector(".cag-mark"), claude.querySelector(".wel-pick-agent").tagName],
      ["Claude Code", "3 chats", true, "LABEL"], "its head: its mark, its name, how many — and a press anywhere on it is its tick's");
    // A row per chat, the newest first: its title, else its first words; its folder's last name — the whole path its
    // tip —, or the name of a project whose folder is not on this computer; when it was last active; how big it is.
    assert.deepEqual(qa(".wel-import .wel-pick-row").map((r) => [r.getAttribute("data-chat"), r.tagName, text(r.querySelector(".wel-pick-words")), text(r.querySelector(".wel-pick-meta"))]), [
      ["shop/a1", "LABEL", "first words of a1", "shop · today 11:05 · 4 MB"],
      ["daily/b1", "LABEL", "Daily notes", "daily · yesterday 09:10 · 200 MB"],
      ["old/c1", "LABEL", "first words of c1", "old-workspace · 9 Nov · about 8 MB"],
      ["x1", "LABEL", "Fix the parser", "tool · 10 Nov · 1 MB"],
    ]);
    assert.equal(rowOf("daily/b1").querySelector(".wel-pick-meta span").getAttribute("title"), "H:\\notes\\daily");
    assert.deepEqual(qa(".wel-import .wel-pick-row").map((r) => r.parentNode.getAttribute("data-agent")), ["claude-code", "claude-code", "claude-code", "codex"], "each under its agent");
    assert.equal(tickOf(rowOf("shop/a1")).getAttribute("type"), "checkbox");
    // Nothing is chosen, and nothing can be pressed.
    assert.deepEqual([ticked(), stands(allTick()), stands(tickOf(claude)), text(q(".wel-import .wel-pick-all")), text(q(".wel-import .wel-pick-count"))], [[], "none", "none", "Select all", "0 of 4 chosen"]);
    assert.deepEqual(brings(), ["No chat chosen yet", "", "Bring in", true]);
    assert.equal(q(".wel-import .wel-bring button").classList.contains("zc-btn-v-default"), true, "the step's one primary button");
    const filter = q(".wel-import .wel-pick-filter");
    assert.deepEqual([filter.getAttribute("type"), filter.getAttribute("placeholder"), filter.getAttribute("aria-label")], ["search", "Filter by folder or words", "Filter by folder or words"]);
    // One quiet line at the list's own end, after its last chat: the agents not found, what each agent's list leaves
    // out, and where more comes in from.
    assert.equal(text(q(".wel-import .wel-pick-list .wel-pick-foot")), "Not found on this computer: Cursor. · Claude Code: 1 in Filament already, 75 older than 30 days · Codex: 59 in Filament already · Settings › Import brings in more, any time.");
    assert.equal(q(".wel-import .wel-pick-list").lastChild, q(".wel-import .wel-pick-foot"));
    assert.deepEqual(qa(".wel-import .wel-muted").length, 1, "and no line of the step's own beside it");
    // The agents' Sync switches and the way out to Browse have left the step: its one switch is memory's.
    assert.deepEqual([qa('.wel-import [role="switch"]').map((b) => b.getAttribute("aria-label")), buttons("Browse single chats in Settings › Import").length, buttons("Bring them in").length], [["Memory reads what is imported"], 0, 0]);
    assert.equal(facts()["Your chats"], "4 chats found");
    closeIt();
  });

  // (fails before: yes — nothing could be chosen: the step listed no chat)
  test("Your chats: a tick chooses a chat, an agent's tick its chats, Select all every chat — each in between while some are chosen —, and the row says what a press would bring", async () => {
    const srv = importServer(CHATS);
    const { calls } = chatsStep(srv);
    await settle();
    setTick(tickOf(rowOf("shop/a1")), true);
    assert.deepEqual([ticked(), stands(allTick()), stands(tickOf(groupOf("claude-code"))), stands(tickOf(groupOf("codex"))), text(q(".wel-import .wel-pick-count"))], [["shop/a1"], "some", "some", "none", "1 of 4 chosen"]);
    assert.deepEqual(brings(), ["1 chat chosen", "about 4 MB to read · Claude Code 1", "Bring in 1 chat", false]);
    // An agent's tick: its chats, the other agent's as they were.
    setTick(tickOf(groupOf("codex")), true);
    assert.deepEqual([ticked(), stands(tickOf(groupOf("codex"))), stands(allTick())], [["shop/a1", "x1"], "all", "some"]);
    assert.deepEqual(brings(), ["2 chats chosen", "about 5 MB to read · Claude Code 1 · Codex 1", "Bring in 2 chats", false]);
    setTick(tickOf(groupOf("claude-code")), true);
    assert.deepEqual([ticked(), stands(tickOf(groupOf("claude-code"))), stands(allTick()), text(q(".wel-import .wel-pick-count"))], [["shop/a1", "daily/b1", "old/c1", "x1"], "all", "all", "4 of 4 chosen"]);
    assert.deepEqual(brings(), ["4 chats chosen", "about 213 MB to read · Claude Code 3 · Codex 1", "Bring in 4 chats", false]);
    // Select all, cleared and set.
    setTick(allTick(), false);
    assert.deepEqual([ticked(), stands(allTick()), brings()], [[], "none", ["No chat chosen yet", "", "Bring in", true]]);
    setTick(allTick(), true);
    assert.deepEqual([ticked().length, stands(allTick())], [4, "all"]);
    setTick(tickOf(rowOf("daily/b1")), false);
    assert.deepEqual([ticked(), stands(allTick()), stands(tickOf(groupOf("claude-code"))), stands(tickOf(groupOf("codex")))], [["shop/a1", "old/c1", "x1"], "some", "some", "all"]);
    assert.deepEqual([overviews(calls), sent(calls, "POST"), sent(calls, "PUT")], [1, [], []], "a tick reads nothing and writes nothing: nothing comes in until the press");
    closeIt();
  });

  // (fails before: yes)
  test("Your chats: the filter keeps the chats whose folder or words hold it, Select all then takes the ones shown, and the count still says the whole", async () => {
    const srv = importServer(CHATS);
    chatsStep(srv);
    await settle();
    const rows = () => qa(".wel-import .wel-pick-row").map((r) => r.getAttribute("data-chat"));
    setTick(tickOf(rowOf("x1")), true);
    filterTo("  NOTES ");
    assert.deepEqual([rows(), qa(".wel-import .wel-pick-group").map((s) => s.getAttribute("data-agent"))], [["daily/b1"], ["claude-code"]], "by its folder, whatever the case: an agent with no chat shown has no group");
    assert.deepEqual([text(q(".wel-import .wel-pick-all")), stands(allTick()), text(q(".wel-import .wel-pick-count")), text(groupOf("claude-code").querySelector(".wel-pick-agent .wel-hint"))],
      ["Select the 1 shown", "none", "1 of 4 chosen", "1 of 3 chats"]);
    setTick(allTick(), true);
    assert.deepEqual([ticked(), stands(allTick()), text(q(".wel-import .wel-pick-count")), brings()[0]], [["daily/b1"], "all", "2 of 4 chosen", "2 chats chosen"], "the ones shown, beside what was chosen before");
    filterTo("parser");
    assert.deepEqual([rows(), ticked()], [["x1"], ["x1"]], "by its first words; its tick as it was left");
    filterTo("old-work");
    assert.deepEqual(rows(), ["old/c1"], "by the name of a project whose folder is not on this computer");
    setTick(tickOf(groupOf("claude-code")), true);
    filterTo("nothing holds this");
    assert.deepEqual([rows(), qa(".wel-import .wel-pick-none").map(text), text(q(".wel-import .wel-pick-all")), allTick().hasAttribute("disabled")], [[], ["No chat's folder or words hold that."], "Select the 0 shown", true]);
    filterTo("");
    assert.deepEqual([rows().length, ticked(), text(q(".wel-import .wel-pick-all")), stands(allTick()), allTick().hasAttribute("disabled"), qa(".wel-import .wel-pick-none").length],
      [4, ["daily/b1", "old/c1", "x1"], "Select all", "some", false, 0], "the filter cleared: every chat, and the choice whole");
    closeIt();
  });

  // (fails before: yes — the press was Bring them in: `POST /memory/import/sync`, every chat in reach of the agents
  // switched on; and the step's switches wrote which agents a Sync brings)
  test("Your chats: the press brings in exactly the chats chosen, of every agent in one run — never a Sync, and no agent's switch written —, with its bar, its words and Stop; what came in leaves the list", async () => {
    const srv = importServer(CHATS);
    const { calls, sessions } = chatsStep(srv);
    await settle();
    // Ticked in another order than the list's: the press names the agents in the server's order, the chats in the list's.
    setTick(tickOf(rowOf("x1")), true);
    setTick(tickOf(rowOf("daily/b1")), true);
    setTick(tickOf(rowOf("shop/a1")), true);
    press("Bring in 3 chats");
    await settle();
    assert.deepEqual(sent(calls, "POST"), [["/memory/import/chosen", { picks: [{ source: "claude-code", chats: ["shop/a1", "daily/b1"] }, { source: "codex", chats: ["x1"] }] }]]);
    // While it runs: one import at a time, and nothing to tick.
    assert.deepEqual(brings(), ["Bringing them in…", "", "Bring in 3 chats", true]);
    assert.deepEqual([qa(".wel-import .wel-pick input").length, qa(".wel-import .wel-pick input").every((i) => i.hasAttribute("disabled")), q(".wel-import select").hasAttribute("disabled")], [8, true, true], "every tick and the filter wait, and the reach");
    assert.deepEqual(ticked(), ["shop/a1", "daily/b1", "x1"], "what is coming in stays ticked");
    assert.deepEqual([text(q(".wel-import .imp-run-words")), buttons("Stop").length], ["0%", 1]);
    srv.job({ percent: 62, progress: [{ step: "claude-code", done: 1, total: 2 }] });
    await srv.tick();
    assert.equal(calls.at(-1)?.path, "/memory/jobs/import-chosen-1");
    assert.deepEqual([text(q(".wel-import .imp-run-words")), q(".wel-import .imp-bar").getAttribute("aria-valuenow")], ["Claude Code · chat 2 of 2 · 62%", "62"]);
    assert.equal(facts()["Your chats"], "Bringing in · 62%");
    assert.deepEqual(sessions, []);
    // It ends: everything is read again, the page is told that chats came in, and they have left the list.
    srv.job({ status: "done", percent: 100, result: { by: "browse", chats: 3, newChats: 3, newTurns: 57, errors: [] } });
    srv.cameIn("claude-code", ["shop/a1", "daily/b1"]);
    srv.cameIn("codex", ["x1"]);
    await srv.tick();
    assert.deepEqual(calls.slice(-2).map((c) => c.path), ["/memory/jobs/import-chosen-1", OVERVIEW]);
    assert.equal(text(q(".wel-import .imp-end")), "3 chats came in, 57 new turns.");
    assert.deepEqual(sessions, [true], "the sidebar's list is read again");
    assert.deepEqual([qa(".wel-import .wel-pick-row").map((r) => r.getAttribute("data-chat")), ticked(), text(q(".wel-import .wel-pick-count"))], [["old/c1"], [], "0 of 1 chosen"]);
    assert.deepEqual(brings(), ["No chat chosen yet", "", "Bring in", true]);
    assert.equal(facts()["Your chats"], "3 chats in Filament");
    assert.deepEqual(srv.timers, [], "an ended run is asked no more");
    assert.deepEqual([sent(calls, "POST").map(([path]) => path), sent(calls, "PUT")], [["/memory/import/chosen"], []], "from first to last: one run of the chats chosen — no Sync, and no agent switched on for one");
    closeIt();
  });

  // (fails before: yes)
  test("Your chats: Stop ends the run after the turn in hand — what came in leaves the list, and what was chosen and did not come in stays chosen, so it can go on", async () => {
    const srv = importServer(CHATS);
    const { calls } = chatsStep(srv);
    await settle();
    setTick(allTick(), true);
    press("Bring in 4 chats");
    await settle();
    press("Stop");
    await settle();
    assert.deepEqual([calls.at(-1)?.method, calls.at(-1)?.path], ["POST", "/memory/jobs/import-chosen-1/stop"]);
    assert.equal(buttons("Stopping after this turn…")[0].hasAttribute("disabled"), true);
    srv.job({ status: "error", stopped: true, error: "the import was stopped" });
    srv.cameIn("claude-code", ["shop/a1"]);
    await srv.tick();
    assert.equal(text(q(".wel-import .imp-end")), "Stopped. What was read stays, and the next run goes on from there.");
    assert.deepEqual([qa(".wel-import .wel-pick-row").map((r) => r.getAttribute("data-chat")), ticked()], [["daily/b1", "old/c1", "x1"], ["daily/b1", "old/c1", "x1"]]);
    assert.deepEqual(brings(), ["3 chats chosen", "about 209 MB to read · Claude Code 2 · Codex 1", "Bring in 3 chats", false]);
    press("Bring in 3 chats");
    await settle();
    assert.deepEqual(sent(calls, "POST").at(-1), ["/memory/import/chosen", { picks: [{ source: "claude-code", chats: ["daily/b1", "old/c1"] }, { source: "codex", chats: ["x1"] }] }], "the rest, and no chat twice");
    closeIt();
  });

  // (fails before: yes)
  test("Your chats: a run goes on while another step shows and after the tour closes — the rail says how far, and the page hears when chats came in —, and coming back to the step finds it", async () => {
    const srv = importServer(CHATS);
    const { calls, sessions } = chatsStep(srv);
    await settle();
    setTick(tickOf(groupOf("claude-code")), true);
    press("Bring in 3 chats");
    await settle();
    press("Next");
    assert.ok(q(".wel-work"), "another step shows");
    srv.job({ percent: 40, progress: [{ step: "claude-code", done: 1, total: 3 }] });
    await srv.tick();
    assert.equal(facts()["Your chats"], "Bringing in · 40%", "the rail keeps up from another step");
    press("Previous");
    await settle();
    assert.deepEqual([text(q(".wel-import .imp-run-words")), buttons("Stop").length, brings()[3], allTick().hasAttribute("disabled")], ["Claude Code · chat 2 of 3 · 40%", 1, true, true], "coming back finds it");
    closeIt();
    // The tour has gone: the run is the server's, and it is asked until it ends, so the sidebar lists what came in.
    const reads = overviews(calls);
    srv.job({ percent: 80 });
    await srv.tick();
    assert.equal(srv.timers.length, 1, "asked again");
    srv.job({ status: "done", percent: 100, result: { by: "browse", chats: 3, newChats: 3, newTurns: 57, errors: [] } });
    await srv.tick();
    assert.deepEqual([sessions, overviews(calls) - reads, srv.timers.length], [[true], 0, 0], "the page hears that chats came in; a tour that has gone reads nothing again");
    // A tour opened while a run is under way — a Sync started on Settings › Import, say: the server names it, and the
    // step shows it, its ticks waiting.
    const back = importServer({ ...CHATS, job: { id: "import-sync-1", kind: "import-sync" } });
    back.state.jobs.set("import-sync-1", { id: "import-sync-1", kind: "import-sync", status: "running", percent: 70, progress: [{ step: "codex", done: 0, total: 1 }] });
    chatsStep(back);
    await settle();
    assert.deepEqual([text(q(".wel-import .imp-run-words")), brings()[3], allTick().hasAttribute("disabled"), facts()["Your chats"]], ["Codex · chat 1 of 1 · 70%", true, true, "Bringing in · 70%"]);
    assert.equal(back.timers.length, 1, "and it is asked again");
    closeIt();
  });

  // (fails before: yes)
  test("Your chats: how far back the list reaches is chosen here as on Settings › Import — the list follows, and a chat it no longer holds is chosen no more —, and more to read than the drive has free is said before the press", async () => {
    const srv = importServer({ ...CHATS, free: 100 * MB });
    const { calls } = chatsStep(srv);
    await settle();
    const reach = () => q(".wel-import select");
    assert.equal(reach().getAttribute("aria-label"), "Reaches back");
    // (fails before: yes — the reach stood in the row of the button that brought every chat in: it says how far back the
    // list goes, so it stands beside the list's title)
    assert.equal(q(".wel-import .wel-titled select"), reach(), "beside the title of what it lists");
    assert.deepEqual(reach().querySelectorAll("option").map((/** @type {any} */ o) => [o.getAttribute("value"), text(o), o.hasAttribute("selected")]), [["7", "7 days", false], ["30", "30 days", true], ["90", "90 days", false], ["0", "Everything", false]]);
    // The drive: what is chosen is what weighs.
    assert.equal(q(".wel-import .wel-status.warn"), null, "nothing chosen: nothing warns");
    setTick(tickOf(rowOf("shop/a1")), true);
    assert.equal(q(".wel-import .wel-status.warn"), null, "4 MB has room");
    setTick(tickOf(rowOf("daily/b1")), true);
    assert.equal(text(q(".wel-import .wel-status.warn")), "That is more than the 100 MB free on the drive Filament keeps its sessions on. Choose fewer chats.");
    assert.equal(brings()[3], false, "said before the press, which stays the person's");
    // A shorter reach: the server lists fewer chats, and the choice is kept to them.
    srv.state.overview.sources[0].pending = { chats: 1, bytes: 4 * MB, list: [CLAUDE_LIST[0]] };
    reach().value = "7";
    reach().dispatch("change");
    await settle();
    assert.deepEqual(sent(calls, "PUT"), [["/memory/import/prefs", { reachDays: 7 }]]);
    assert.deepEqual(reach().querySelectorAll("option").filter((/** @type {any} */ o) => o.hasAttribute("selected")).map((/** @type {any} */ o) => o.getAttribute("value")), ["7"], "read again: what stands");
    assert.deepEqual([qa(".wel-import .wel-pick-row").map((r) => r.getAttribute("data-chat")), ticked(), brings()[0], q(".wel-import .wel-status.warn")], [["shop/a1", "x1"], ["shop/a1"], "1 chat chosen", null]);
    closeIt();
  });

  // (fails before: yes)
  test("Your chats: nothing found on this computer is one line with no control, and Next goes on", async () => {
    const none = { ...CHATS, sources: CHATS.sources.map((s) => ({ ...s, found: false, chats: 0, bytes: 0, projects: 0, states: {}, pending: { chats: 0, bytes: 0, list: [] } })) };
    open({ [`GET ${OVERVIEW}`]: none }, { step: stepOf("import") });
    await settle();
    assert.equal(text(q(".wel-import")), "No coding agent's chats were found on this computer: Filament looked for Claude Code's, Codex's and Cursor's.");
    assert.deepEqual([qa(".wel-import button").length, qa(".wel-import select").length, qa(".wel-import input").length], [0, 0, 0], "no dead control");
    assert.equal(facts()["Your chats"], "Nothing found");
    press("Next");
    assert.ok(q(".wel-work"));
    closeIt();
  });

  // (fails before: yes — with nothing a run would bring the step still showed its agents' rows and a dead button)
  test("Your chats: agents found and no chat in reach is one line, the reach still there to widen it; where every chat found is in Filament already, that is what it says", async () => {
    const bare = (/** @type {any} */ s) => ({ ...s, pending: { chats: 0, bytes: 0, list: [] } });
    const says = () => [qa(".wel-import .wel-lead").map(text), qa(".wel-import .wel-pick").length, qa(".wel-import .wel-bring").length, qa(".wel-import select").length];
    open({ [`GET ${OVERVIEW}`]: { ...CHATS, sources: [bare(CLAUDE), bare(CODEX), CURSOR] } }, { step: stepOf("import") });
    await settle();
    assert.deepEqual(says(), [["No chat of the last 30 days is new or has grown."], 0, 0, 1], "no list and no button: the reach, to look further back");
    assert.ok(qa(".wel-import .wel-muted").map(text).includes("Not found on this computer: Cursor. · Claude Code: 1 in Filament already, 78 older than 30 days · Codex: 59 in Filament already, 1 older than 30 days"), "and the line under it says where the chats are");
    assert.equal(text(q(".wel-import .wel-reads .wel-row-name")), "Memory reads them", "memory's choice stays: a later Sync reads it");
    assert.equal(facts()["Your chats"], "Nothing new");
    closeIt();
    open({ [`GET ${OVERVIEW}`]: { ...CHATS, prefs: { ...CHATS.prefs, reachDays: 0 }, sources: [{ ...bare(CLAUDE), chats: 5, states: { removed: 2, empty: 2, own: 1 } }] } }, { step: stepOf("import") });
    await settle();
    assert.deepEqual(says()[0], ["No chat is new or has grown."], "no reach set: none to name");
    closeIt();
    open({ [`GET ${OVERVIEW}`]: { ...CHATS, sources: [{ ...bare(CLAUDE), states: { imported: 78, own: 1 } }, CURSOR] } }, { step: stepOf("import") });
    await settle();
    assert.deepEqual(says(), [["Every chat found is in Filament already."], 0, 0, 1]);
    assert.equal(facts()["Your chats"], "78 chats in Filament");
    closeIt();
  });

  // (fails before: yes — the tour said memory learns from the chats brought in, and nothing in it had memory read them:
  // Settings › Import's switch for that, off as Filament ships, was a page away)
  test("Your chats: whether memory reads what comes in is Settings › Import's switch, here; memory off, or no model for it, is said with the way back to Memory — and the chats still come in", async () => {
    const srv = importServer(CHATS);
    const { calls } = chatsStep(srv);
    await settle();
    const reads = () => q(".wel-import .wel-reads");
    const sw = () => reads().querySelector('[role="switch"]');
    assert.equal(text(reads().querySelector(".wel-row-name")), "Memory reads them");
    assert.deepEqual([sw().getAttribute("aria-label"), sw().getAttribute("aria-checked"), sw().hasAttribute("disabled")], ["Memory reads what is imported", "false", false], "off, as Filament ships");
    assert.match(text(reads().querySelector(".wel-row-state")), /^Off/);
    // (fails before: yes — its words stood on a line of their own under the switch, a chat's row taken from the list:
    // one line now, beside the switch — off, that no model is called and what on does; on, what it costs)
    assert.equal(text(reads().querySelector(".wel-hint")), "No model is called. On, memory reads what comes in with Haiku.");
    assert.equal(reads().querySelector(".wel-hint").classList.contains("wel-hint-line"), false);
    // (fails before: yes — it stood under the button: what a press does is chosen before the press)
    assert.deepEqual(qa(".wel-import .wel-row").map((r) => r.className), ["wel-row wel-reads", "wel-row wel-bring"], "over the row that brings them in");
    setTick(tickOf(rowOf("x1")), true);
    sw().dispatch("click");
    await settle();
    assert.deepEqual(sent(calls, "PUT"), [["/memory/import/prefs", { learn: true }]]);
    assert.equal(sw().getAttribute("aria-checked"), "true");
    assert.match(text(reads().querySelector(".wel-row-state")), /^On/);
    assert.equal(text(reads().querySelector(".wel-hint")), "Memory reads what comes in with Haiku, a call for every few turns.");
    assert.deepEqual(ticked(), ["x1"], "the step drawn again: what was chosen stays");
    closeIt();
    // Memory off: the server says why nothing can be read, and the tour's own Memory step is a press away; the chats
    // come in all the same.
    const off = open({ [`GET ${OVERVIEW}`]: { ...CHATS, learner: { model: null, why: "memory is switched off" } } }, { step: stepOf("import"), now: () => NOW });
    await settle();
    assert.equal(text(reads().querySelector(".wel-row-state")), "Not now: memory is switched off.");
    assert.equal(sw().hasAttribute("disabled"), true);
    setTick(tickOf(rowOf("x1")), true);
    assert.deepEqual(brings().slice(2), ["Bring in 1 chat", false], "the chats come in, memory on or off");
    press("Back to Memory");
    assert.ok(q(".wel-memory"), "the tour's own step, not a Settings page");
    assert.deepEqual([off.t.step(), off.done, off.settings, sheetEl() != null], [stepOf("memory"), [], [], true]);
    closeIt();
  });

  // (fails before: yes — where the overview did not read the tour said "Settings › Import brings them in, when memory is
  // on": the chats come in memory on or off, and nothing said why they did not read)
  test("Your chats: an overview that does not read says why, in the server's words, and Try again reads it", async () => {
    let fail = true;
    const { calls } = open({ [`GET ${OVERVIEW}`]: () => { if (fail) throw new Error("no archive: the memory folder cannot be written"); return CHATS; } }, { step: stepOf("import"), now: () => NOW });
    await settle();
    assert.equal(text(q(".wel-import .wel-said")), "Your coding agents' chats did not read: no archive: the memory folder cannot be written");
    assert.deepEqual(qa(".wel-import button").map(text), ["Try again"]);
    assert.equal(facts()["Your chats"], "", "nothing known: nothing said");
    fail = false;
    press("Try again");
    await settle();
    assert.equal(overviews(calls), 2);
    assert.ok(groupOf("claude-code"));
    closeIt();
  });

  // (fails before: yes)
  test("Your chats: an agent found whose chats cannot be read says why on its group's head, with no row and no tick; one found with no chat has no group; a chat partly in Filament is tagged grown", async () => {
    const broken = { ...CODEX, chats: 0, bytes: 0, projects: 0, states: {}, pending: { chats: 0, bytes: 0, list: [] }, error: "EACCES: permission denied, scandir 'C:\\Users\\me\\.codex\\sessions'" };
    const hollow = { ...CURSOR, found: true };
    const grown = { ...CLAUDE, states: { new: 77, grown: 1, own: 1 }, pending: { ...CLAUDE.pending, list: CLAUDE_LIST.map((c) => (c.id === "daily/b1" ? { ...c, state: "grown" } : c)) } };
    open({ [`GET ${OVERVIEW}`]: { ...CHATS, sources: [grown, broken, hollow] } }, { step: stepOf("import"), now: () => NOW });
    await settle();
    assert.deepEqual(qa(".wel-import .wel-pick-group").map((s) => s.getAttribute("data-agent")), ["claude-code", "codex"]);
    const codex = groupOf("codex");
    assert.deepEqual([text(codex.querySelector(".wel-pick-name")), text(codex.querySelector(".wel-said.bad")), codex.querySelectorAll("input").length, codex.querySelectorAll(".wel-pick-row").length],
      ["Codex", "EACCES: permission denied, scandir 'C:\\Users\\me\\.codex\\sessions'", 0, 0], "why, in the system's words");
    const tag = rowOf("daily/b1").querySelector(".wel-badge");
    assert.deepEqual([text(tag), tag.getAttribute("title"), qa(".wel-import .wel-pick-row .wel-badge").length], ["grown", "Part of it is in Filament already: the rest comes in", 1], "the others are new: no tag");
    assert.deepEqual([text(q(".wel-import .wel-pick-count")), qa(".wel-import .wel-muted").map(text)], ["0 of 3 chosen", ["Claude Code: 1 in Filament already, 75 older than 30 days · Settings › Import brings in more, any time."]], "none is missing: no line says so");
    closeIt();
    // No chat in reach, and an agent that cannot be read: the line, and that agent's head alone — nothing to tick.
    open({ [`GET ${OVERVIEW}`]: { ...CHATS, sources: [{ ...CLAUDE, pending: { chats: 0, bytes: 0, list: [] } }, broken] } }, { step: stepOf("import"), now: () => NOW });
    await settle();
    assert.deepEqual([qa(".wel-import .wel-lead").map(text), qa(".wel-import .wel-pick-group").map((s) => s.getAttribute("data-agent")), qa(".wel-import .wel-pick-head").length, qa(".wel-import .wel-pick input").length, qa(".wel-import .wel-bring").length],
      [["No chat of the last 30 days is new or has grown."], ["codex"], 0, 0, 0]);
    closeIt();
  });

  // (fails before: yes)
  test("Your chats: a tour that comes back from a sign-in's sheet reads the chats again — the rail keeps its note, what was chosen is chosen still, and a run under way is found", async () => {
    const srv = importServer(CHATS);
    const agents = keeper({ entries: [{ id: "claude", name: "Claude Code", state: "connected", upstreams: ["claude-code"], primary: "claude-code" }] });
    const accounts = keeper([{ agent: "claude", upstream: "claude-code", agentName: "Claude Code", account: { identity: { kind: "none" }, signedOut: true } }]);
    const { calls, signIns, sessions } = chatsStep(srv, { agents, accounts });
    await settle();
    setTick(tickOf(rowOf("daily/b1")), true);
    setTick(tickOf(rowOf("x1")), true);
    qa(".wel-step")[stepOf("connect")].dispatch("click");
    press("Sign in");
    assert.equal(sheetEl(), null, "the sign-in's sheet takes the tour's place");
    const reads = overviews(calls);
    signIns[0].back();
    await settle();
    assert.ok(q(".wel-agents"), "back on Connect a model");
    assert.deepEqual([overviews(calls) - reads, facts()["Your chats"]], [1, "4 chats found"], "read again, though Your chats does not show");
    // (fails before: yes — there was no choice to keep)
    qa(".wel-step")[stepOf("import")].dispatch("click");
    await settle();
    assert.deepEqual([ticked(), brings()[2]], [["daily/b1", "x1"], "Bring in 2 chats"], "the choice came back with the tour");
    press("Bring in 2 chats");
    await settle();
    qa(".wel-step")[stepOf("connect")].dispatch("click");
    press("Sign in");
    signIns[1].back();
    await settle();
    assert.equal(facts()["Your chats"], "Bringing in · 0%", "the run under way is found");
    srv.job({ percent: 55, progress: [{ step: "claude-code", done: 0, total: 1 }] });
    await srv.tick();
    assert.equal(facts()["Your chats"], "Bringing in · 55%");
    srv.job({ status: "done", percent: 100, result: { by: "browse", chats: 2, newChats: 2, newTurns: 57, errors: [] } });
    srv.cameIn("claude-code", ["daily/b1"]);
    srv.cameIn("codex", ["x1"]);
    await srv.tick();
    assert.deepEqual([facts()["Your chats"], sessions.includes(true), srv.timers.length], ["2 chats in Filament", true, 0], "and the page hears that chats came in");
    closeIt();
  });

  // (fails before: yes — there was nothing chosen to keep; the read at each visit stands as it did)
  test("Your chats: what is chosen is kept as the tour moves to another step and back, and the list is read again at each visit — a chat that came in meanwhile has left it, and the choice", async () => {
    const srv = importServer(CHATS);
    const { calls } = chatsStep(srv);
    await settle();
    setTick(tickOf(rowOf("old/c1")), true);
    setTick(tickOf(rowOf("x1")), true);
    filterTo("tool");
    press("Next");
    assert.ok(q(".wel-work"));
    // Meanwhile, from Settings › Import or another window, one of the chosen chats came in.
    srv.cameIn("codex", ["x1"]);
    press("Previous");
    assert.deepEqual([ticked(), q(".wel-import .wel-pick-filter").value], [["old/c1", "x1"], ""], "drawn at once from what was read last, the choice as it was left; a visit starts with no filter");
    await settle();
    assert.equal(overviews(calls), 2, "read again at the visit");
    assert.deepEqual([qa(".wel-import .wel-pick-row").map((r) => r.getAttribute("data-chat")), ticked(), brings().slice(0, 3)], [["shop/a1", "daily/b1", "old/c1"], ["old/c1"], ["1 chat chosen", "about 8 MB to read · Claude Code 1", "Bring in 1 chat"]]);
    closeIt();
  });

  // (fails before: yes — the step had no field to type in)
  test("Your chats: ← and → typed in the filter are the field's, not the tour's; from the page they still move between steps", async () => {
    /** @type {((e: any) => void)[]} */
    const heard = [];
    const had = g.window.addEventListener;
    g.window.addEventListener = (/** @type {string} */ type, /** @type {(e: any) => void} */ fn) => { if (type === "keydown") heard.push(fn); };
    try {
      const srv = importServer(CHATS);
      const { t } = chatsStep(srv);
      await settle();
      assert.equal(heard.length, 1, "the tour's keys");
      let prevented = 0;
      const key = (/** @type {string} */ k, /** @type {any} */ target) => heard[0]({ key: k, target, preventDefault: () => void prevented++ });
      const filter = q(".wel-import .wel-pick-filter");
      assert.ok(filter, "the filter");
      key("ArrowRight", filter);
      key("ArrowLeft", filter);
      assert.deepEqual([t.step(), prevented], [stepOf("import"), 0], "the keys stay the field's: its caret moves");
      key("ArrowRight", tickOf(rowOf("x1")));
      assert.deepEqual([t.step(), prevented], [stepOf("import"), 0], "nor from a tick");
      key("ArrowRight", doc.document.body);
      assert.deepEqual([t.step(), prevented], [stepOf("work"), 1], "from the page they move the tour, as before");
      closeIt();
    } finally {
      g.window.addEventListener = had;
    }
  });

  // (fails before: yes — the step had no list: there was no filter to keep, and nothing in it to hold the focus)
  test("Your chats: drawn again as the overview is read, the step keeps the filter's words and the focus where it was — in the filter with its caret, or on a chat's tick", async () => {
    const page = /** @type {any} */ (doc.document);
    const proto = Object.getPrototypeOf(doc.document.body);
    const had = proto.focus;
    /** @type {any[]} */
    const focused = [];
    /** @type {any[]} */
    const carets = [];
    proto.focus = function () { focused.push(this); };
    proto.setSelectionRange = function (/** @type {number} */ a, /** @type {number} */ b) { carets.push([this, a, b]); };
    try {
      const srv = importServer(CHATS);
      chatsStep(srv);
      await settle();
      const again = async () => {
        focused.length = 0;
        const reach = q(".wel-import select");
        reach.value = reach.value === "90" ? "30" : "90";
        reach.dispatch("change");
        await settle();
      };
      // Nothing in the list had the focus: none is given.
      await again();
      assert.deepEqual(focused, []);
      // The filter being typed in.
      filterTo("shop");
      const typedIn = q(".wel-import .wel-pick-filter");
      page.activeElement = Object.assign(typedIn, { selectionStart: 2 });
      await again();
      const filter = q(".wel-import .wel-pick-filter");
      assert.notEqual(filter, typedIn, "the step was drawn again");
      assert.deepEqual([filter.value, qa(".wel-import .wel-pick-row").map((r) => r.getAttribute("data-chat")), text(q(".wel-import .wel-pick-all"))], ["shop", ["shop/a1"], "Select the 1 shown"], "the filter's words stand, and what they leave");
      assert.deepEqual([focused, carets], [[filter], [[filter, 2, 2]]], "the filter has the focus again, its caret where it was");
      // A chat's tick reached by Tab.
      filterTo("");
      page.activeElement = tickOf(rowOf("x1"));
      await again();
      assert.deepEqual(focused, [tickOf(rowOf("x1"))], "the same chat's tick, drawn anew");
      // What had the focus outside the step is left where it is.
      page.activeElement = doc.document.body;
      await again();
      assert.deepEqual(focused, []);
      closeIt();
    } finally {
      proto.focus = had;
      delete proto.setSelectionRange;
      delete page.activeElement;
    }
  });

  // (fails before: yes — none of these words existed)
  test("Your chats' words: the groups a filter leaves, a choice kept to the list, what a choice would bring, what the list leaves out, and what is said where it is empty", () => {
    assert.deepEqual(W.pickGroups(CHATS).map((gr) => [gr.id, gr.label, gr.error, gr.chats.map((c) => c.id), gr.shown.length]),
      [["claude-code", "Claude Code", null, ["shop/a1", "daily/b1", "old/c1"], 3], ["codex", "Codex", null, ["x1"], 1]], "the agents found that have chats in reach, in the server's order");
    assert.deepEqual(W.pickGroups(CHATS, "DAILY").map((gr) => [gr.id, gr.chats.length, gr.shown.map((c) => c.id)]), [["claude-code", 3, ["daily/b1"]], ["codex", 1, []]], "a filter leaves `shown`: Browse's rule, by folder or words");
    assert.deepEqual(W.pickGroups({ sources: [{ ...CODEX, error: "EACCES", pending: { chats: 0, bytes: 0, list: [] } }] }).map((gr) => [gr.id, gr.error, gr.chats]), [["codex", "EACCES", []]], "an agent that cannot be read: its error, no chat");
    assert.deepEqual([W.pickGroups({ sources: [{ ...CODEX, pending: { chats: 1, bytes: 1 } }] }), W.pickGroups(null)], [[], []], "an overview read without its list lists nothing");
    // A choice kept to the list: the server's order of agents, the list's order of chats, each once.
    assert.deepEqual(W.picksIn(CHATS, [{ source: "codex", chats: ["x1", "gone"] }, { source: "claude-code", chats: ["old/c1", "shop/a1"] }, { source: "cursor", chats: ["k"] }, { source: "claude-code", chats: ["shop/a1"] }]),
      [{ source: "claude-code", chats: ["shop/a1", "old/c1"] }, { source: "codex", chats: ["x1"] }]);
    assert.deepEqual([W.picksIn(CHATS, [{ source: "codex", chats: ["gone"] }]), W.picksIn(CHATS, []), W.picksIn(null, [{ source: "codex", chats: ["x1"] }])], [[], [], []], "an agent with none left is left out");
    // What a choice would bring.
    assert.deepEqual(W.bringSays(CHATS, []), { head: "No chat chosen yet", sub: "", button: "Bring in", can: false, chats: 0, bytes: 0 });
    assert.deepEqual(W.bringSays(CHATS, [{ source: "codex", chats: ["x1"] }]), { head: "1 chat chosen", sub: "about 1 MB to read · Codex 1", button: "Bring in 1 chat", can: true, chats: 1, bytes: 1 * MB });
    assert.deepEqual(W.bringSays(CHATS, [{ source: "claude-code", chats: ["shop/a1", "old/c1", "gone"] }, { source: "codex", chats: ["x1"] }]),
      { head: "3 chats chosen", sub: "about 13 MB to read · Claude Code 2 · Codex 1", button: "Bring in 3 chats", can: true, chats: 3, bytes: 13 * MB }, "a chat no longer listed counts nothing");
    const many = { ...CHATS, sources: [{ ...CODEX, pending: { chats: 1200, bytes: 1200 * MB, list: Array.from({ length: 1200 }, (_, i) => ({ id: `c${i}`, bytes: MB, state: "new" })) } }] };
    const every = W.bringSays(many, [{ source: "codex", chats: many.sources[0].pending.list.map((c) => c.id) }]);
    assert.deepEqual([every.head, every.sub, every.button], ["1,200 chats chosen", "about 1.2 GB to read · Codex 1,200", "Bring in 1,200 chats"]);
    // The quiet line: the agents not found; of each found, what is in Filament already and what is older than the reach.
    assert.equal(W.leftOutSays(CHATS), "Not found on this computer: Cursor. · Claude Code: 1 in Filament already, 75 older than 30 days · Codex: 59 in Filament already");
    assert.equal(W.leftOutSays({ ...CHATS, prefs: { ...CHATS.prefs, reachDays: 0 } }), "Not found on this computer: Cursor. · Claude Code: 1 in Filament already · Codex: 59 in Filament already", "no reach set: nothing is older than it");
    assert.equal(W.leftOutSays({ ...CHATS, sources: [{ ...CLAUDE, states: { imported: 12, grown: 2, new: 41, own: 1, removed: 4 } }] }), "Claude Code: 13 in Filament already, 40 older than 30 days", "brought in whole or run through Filament; new or grown, and out of reach");
    assert.equal(W.leftOutSays({ ...CHATS, sources: [{ ...CLAUDE, states: { new: 3 } }] }), "", "nothing left out: nothing said");
    assert.equal(W.leftOutSays({ ...CHATS, sources: [{ ...CODEX, error: "EACCES" }, CURSOR, { ...CURSOR, id: "other", label: "Another" }] }), "Not found on this computer: Cursor and Another.", "an agent that cannot be read counts nothing here: its head says why");
    // No chat in reach.
    const bare = (/** @type {any} */ s) => ({ ...s, pending: { chats: 0, bytes: 0, list: [] } });
    assert.equal(W.noneSays({ ...CHATS, sources: [bare(CLAUDE), CURSOR] }), "No chat of the last 30 days is new or has grown.");
    assert.equal(W.noneSays({ ...CHATS, prefs: { ...CHATS.prefs, reachDays: 0 }, sources: [{ ...bare(CLAUDE), chats: 3, states: { removed: 3 } }] }), "No chat is new or has grown.");
    assert.equal(W.noneSays({ ...CHATS, sources: [{ ...bare(CLAUDE), states: { imported: 78, own: 1 } }, { ...bare(CODEX), states: { own: 60 } }, CURSOR] }), "Every chat found is in Filament already.");
    assert.equal(W.noneSays({ ...CHATS, sources: [{ ...bare(CLAUDE), states: { imported: 78, own: 1 } }, { ...bare(CODEX), chats: 0, states: {}, error: "EACCES" }] }), "No chat of the last 30 days is new or has grown.", "an agent that could not be read may hold more");
  });

  // (fails before: yes)
  // (fails before: yes — 11-12, later: the note named the agents switched on, or "Found, none on": the step has no switch)
  test("the rail's note under Your chats, and Ready's line, say what stands: a run and how far, what is in Filament, how many chats were found, nothing new, nothing found", async () => {
    const run = { kind: "import-chosen", percent: 61.6, progress: [{ step: "claude-code", done: 2, total: 14 }] };
    assert.equal(W.chatsFact(CHATS, run), "Bringing in · 62%");
    assert.equal(W.chatsFact(CHATS), "4 chats found");
    assert.equal(W.chatsFact({ ...CHATS, sources: [CODEX, CURSOR] }), "1 chat found");
    assert.equal(W.chatsFact({ ...CHATS, sources: CHATS.sources.map((s) => ({ ...s, on: true, pending: { chats: s.pending.chats, bytes: s.pending.bytes } })) }), "4 chats found", "the overview's counts alone: no list is read, and no switch");
    assert.equal(W.chatsFact({ ...CHATS, sources: [{ ...CLAUDE, pending: { chats: 0, bytes: 0, list: [] } }, CURSOR] }), "Nothing new");
    assert.equal(W.chatsFact({ ...CHATS, sources: [{ ...CURSOR, pending: { chats: 5, bytes: 1 } }] }), "Nothing found", "an agent not found brings nothing");
    const brought = { ...CHATS, sources: [{ ...CLAUDE, states: { imported: 200, grown: 14, new: 3 } }, CODEX, CURSOR] };
    assert.equal(W.chatsFact(brought), "214 chats in Filament");
    assert.equal(W.chatsFact({ ...CHATS, sources: [{ ...CODEX, states: { imported: 1 } }] }), "1 chat in Filament");
    assert.equal(W.chatsFact({ ...CHATS, sources: [CURSOR] }), "Nothing found");
    // Ready: its line among what was set, read where the step was never opened, with its Change.
    const { calls } = open({ [`GET ${OVERVIEW}`]: brought }, { step: stepOf("ready"), now: () => NOW });
    await settle();
    const row = q('.wel-summary .wel-row[data-step="import"]');
    assert.deepEqual([text(row.querySelector(".wel-row-name")), text(row.querySelector(".wel-row-state")), overviews(calls)], ["Your chats", "214 chats in Filament", 1]);
    assert.deepEqual(qa(".wel-summary .wel-row").map((r) => r.getAttribute("data-step")), ["connect", "model", "asks", "memory", "import", "work"], "in the steps' order");
    assert.equal(facts()["Your chats"], "214 chats in Filament");
    row.querySelector("button").dispatch("click");
    assert.ok(q(".wel-import"), "Change goes to its step");
    closeIt();
  });

  // (fails before: yes)
  test("Ready's line for Your chats does not hold the rest back while the chats are looked for, and keeps up with a run under way", async () => {
    const srv = importServer(CHATS);
    /** @type {(v: any) => void} */
    let answer = () => {};
    const slow = new Promise((r) => { answer = r; });
    let asked = 0;
    const routes = { ...srv.routes, [`GET ${OVERVIEW}`]: () => (asked++ ? srv.routes[`GET ${OVERVIEW}`]() : slow) };
    const { t } = open(routes, { step: stepOf("ready"), later: srv.later, now: () => NOW });
    await settle();
    const line = () => text(q('.wel-summary .wel-row[data-step="import"] .wel-row-state'));
    assert.deepEqual([qa(".wel-summary .wel-row").length, line()], [6, "Looking for them…"], "what was set is listed before the look through every agent's files answers");
    answer(structuredClone(srv.state.overview));
    await settle();
    assert.equal(line(), "4 chats found");
    t.go(stepOf("import"));
    await settle();
    setTick(allTick(), true);
    press("Bring in 4 chats");
    await settle();
    t.go(stepOf("ready"));
    await settle();
    assert.equal(line(), "Bringing in · 0%");
    srv.job({ percent: 40, progress: [{ step: "claude-code", done: 1, total: 3 }] });
    await srv.tick();
    assert.equal(line(), "Bringing in · 40%", "as the rail says it");
    srv.job({ status: "done", percent: 100, result: { by: "browse", chats: 4, newChats: 4, newTurns: 57, errors: [] } });
    srv.cameIn("claude-code", ["shop/a1", "daily/b1", "old/c1"]);
    srv.cameIn("codex", ["x1"]);
    await srv.tick();
    assert.equal(line(), "4 chats in Filament");
    closeIt();
  });

  // (fails before: yes — the page kept the step's place, a number: with a step put in before Your work, a tour left on
  // Your work or later would have opened one step early)
  test("the step the page keeps is its name; a place an older Filament kept opens the step it was", () => {
    assert.deepEqual(["welcome", "import", "work", "ready"].map((id) => W.stepAt(id)), [0, 5, 6, 9], "a name: its place now");
    assert.deepEqual([0, 4, 5, 6, 7, 8].map((n) => W.stepAt(n)), [0, 4, 6, 7, 8, 9], "a number is a place among the nine steps there were: Your work and those after it are one further on");
    assert.deepEqual(["5", "8"].map((n) => W.stepAt(n)), [6, 9], "as the browser kept it, in words");
    assert.deepEqual(["", null, undefined, "nowhere", 12, -1].map((x) => W.stepAt(x)), [0, 0, 0, 0, 0, 0], "nothing kept, or nothing known: the first step");
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /step: stepAt\(prefs\.get\("welcomeStep"\)\),\n/);
    assert.match(app, /onStep: \(_i, id\) => prefs\.set\("welcomeStep", id\),/);
    const prefs = readFileSync(new URL("../src/ui/harness/prefs.js", import.meta.url), "utf8");
    assert.match(prefs, /\n  welcomeStep: "",\n/, "kept as words: a number kept before reads as it was written");
  });

  // (fails before: yes — the rail named a coding agent's model by its id, its level twice: "Opus High · High")
  test("the rail names the model new chats start on as its picker does, from the families read at the tour's open", async () => {
    const families = [{ id: "c/opus", label: "Claude Opus 5.5", upstream: "c", kind: "model", effort: { levels: ["low", "high"], via: "name" }, members: [{ id: "c/opus-low", effort: "low" }, { id: "c/opus-high", effort: "high" }] }];
    open({ "GET /models?all=1": { models: [], families } }, { step: stepOf("asks"), pref: prefOf({ model: "c/opus-high", effort: "high" }) });
    await settle();
    assert.equal(facts()["Default model"], "Claude Opus 5.5 · High");
    closeIt();
  });

  // (fails before: yes — the agents and teams were words only: whom your agent may bring in was set nowhere in the tour,
  // the owner's of 11-05)
  test("Agents and teams: the four explained, with examples that work on day one; whom your agent may bring in by itself ticked here as in Library", async () => {
    /** @type {any[]} */
    const puts = [];
    const { examples, done } = open(
      {
        "GET /agents": {
          shipped: [{ tag: "builder", name: "Builder", goodFor: "builds", shipped: true }, { tag: "reviewer", name: "Reviewer", goodFor: "reviews", shipped: true }, { tag: "bh-lead", name: "BugHunters lead", partOf: "bughunters", shipped: true }],
          saved: [{ tag: "product", name: "Product", goodFor: "product calls" }],
          ask: [],
          always: ["builder", "reviewer"],
        },
        "GET /teams": { shipped: [{ key: "bughunters", name: "BugHunters", line: "finds bugs and checks them" }], saved: [], agentTeams: [] },
        "PUT /subagents/ask": (/** @type {any} */ b) => (puts.push(["ask", b]), { ok: true, ask: b.tags }),
        "PUT /subagents/teams": (/** @type {any} */ b) => (puts.push(["teams", b]), { agentTeams: b.teams }),
      },
      { step: stepOf("team") },
    );
    await settle();
    assert.deepEqual(W.TEAM_CARDS.map((c) => c.title), ["The main agent", "Sub-agents", "Side agents", "Teams"]);
    assert.deepEqual(qa(".wel-team .wel-card-title").map(text), ["The main agent", "Sub-agents", "Side agents", "Teams"]);
    const names = qa(".wel-team .wel-rows .wel-row-name").map(text);
    assert.deepEqual(names, ["Builder", "Reviewer", "Product", "BugHunters team"], "a team's own lead runs only with its team: never ticked");
    assert.deepEqual(qa(".wel-always").map((r) => text(r.querySelector(".wel-badge"))), ["Always", "Always"]);
    const product = q('.wel-tick[data-tag="product"]');
    product.checked = true;
    product.dispatch("change");
    await settle();
    const team = q('.wel-tick[data-team="bughunters"]');
    team.checked = true;
    team.dispatch("change");
    await settle();
    assert.deepEqual(puts, [["ask", { tags: ["product"] }], ["teams", { teams: ["bughunters"] }]]);
    assert.equal(facts()["Agents and teams"], "3 agents, 1 team");
    // (fails before: yes — Product's review of 11-06: "the change you just made" before any, and a bare /parallel before a plan)
    assert.equal(q(".wel-card-side .wel-example"), null, "side agents want a plan first: no example");
    q(".wel-card-sub .wel-example").dispatch("click");
    assert.deepEqual([examples, done], [["Have a sub-agent find where this project handles errors, while you go on."], ["finish"]]);
  });

  // (fails before: yes — the owner's of 11-17: teams stood in the tour while untested and unfinished)
  test("Agents, while Settings › Experimental's Teams switch is off: no team's card, row or read, the step named Agents; Everything else has no Teams", async () => {
    const config = state.config;
    state.config = { ...config, experimental: { ...config?.experimental, teams: false } };
    try {
      const { calls } = open(
        {
          "GET /agents": { shipped: [{ tag: "builder", name: "Builder", shipped: true }, { tag: "reviewer", name: "Reviewer", shipped: true }], saved: [], ask: [], always: ["builder", "reviewer"] },
          "GET /teams": { shipped: [{ key: "bughunters", name: "BugHunters", line: "finds bugs and checks them" }], saved: [], agentTeams: ["bughunters"] },
        },
        { step: stepOf("team") },
      );
      await settle();
      assert.deepEqual(qa(".wel-team .wel-card-title").map(text), ["The main agent", "Sub-agents", "Side agents"]);
      assert.deepEqual(qa(".wel-team .wel-rows .wel-row-name").map(text), ["Builder", "Reviewer"]);
      assert.deepEqual(calls.filter((c) => c.path === "/teams"), [], "the teams are not read");
      assert.equal(facts().Agents, "2 agents");
      assert.ok(!("Agents and teams" in facts()));
      assert.match(text(q(".wel-team")), /Library › Agents holds the cards/);
      closeIt();
      open({}, { step: stepOf("discover") });
      assert.ok(qa(".wel-feat .wel-card-title").length > 0);
      assert.equal(qa(".wel-feat .wel-card-title").map(text).includes("Teams"), false);
      closeIt();
    } finally {
      state.config = config;
    }
  });

  // (fails before: yes — the tour listed shipped and saved cards only, so a tick here wrote the ask list without the
  // plugins' agents Library had ticked)
  test("Agents and teams: a plugin's agent is listed as Library lists it, and a tick here keeps its tick", async () => {
    /** @type {any[]} */
    const puts = [];
    open(
      {
        "GET /agents": {
          shipped: [{ tag: "builder", name: "Builder", shipped: true }, { tag: "reviewer", name: "Reviewer", shipped: true }],
          saved: [{ tag: "product", name: "Product" }],
          plugins: [{ tag: "pr-check", name: "PR check", plugin: "gh-tools" }],
          ask: ["pr-check"],
          always: ["builder", "reviewer"],
        },
        "GET /teams": { shipped: [], saved: [], agentTeams: [] },
        "PUT /subagents/ask": (/** @type {any} */ b) => (puts.push(b.tags), { ok: true, ask: b.tags }),
      },
      { step: stepOf("team") },
    );
    await settle();
    assert.ok(q('.wel-tick[data-tag="pr-check"]')?.hasAttribute("checked"), "the plugin's agent, ticked as in Library");
    const product = q('.wel-tick[data-tag="product"]');
    product.checked = true;
    product.dispatch("change");
    await settle();
    assert.deepEqual(puts, [["pr-check", "product"]]);
    closeIt();
  });

  // (fails before: yes — five features, the rest of Filament unsaid: the owner's of 11-05, "covering every feature")
  test("Everything else: every area's features, where each is, an area's chip keeping its own; an example picked goes to the message box, and the tour ends", () => {
    const { examples, done } = open({}, { step: stepOf("discover") });
    assert.deepEqual(qa(".wel-discover .wel-chip").map(text), ["All", "Plan and run", "Agents", "Your code", "Memory and Spaces", "Everywhere"]);
    assert.equal(qa(".wel-feat").length, W.FEATURES.length);
    assert.ok(W.FEATURES.every((f) => f.where && f.line && f.icon), "each says where it is");
    qa(".wel-discover .wel-chip")[3].dispatch("click");
    assert.deepEqual(qa(".wel-feat .wel-card-title").map(text), ["Changes", "Terminal", "Browser", "@ files and @# names", "Language servers"]);
    assert.equal(q(".wel-discover .wel-chip.on")?.getAttribute("aria-pressed"), "true");
    qa(".wel-discover .wel-chip")[1].dispatch("click");
    q(".wel-card-plan .wel-example")?.dispatch("click");
    assert.deepEqual(examples, ["/plan add sign-in with GitHub"]);
    assert.deepEqual(done, ["finish"]);
    assert.equal(sheetEl(), null);
  });

  // (fails before: yes — the tour ended on a list of features, with nothing said of what it set: the owner's of 11-05)
  test("Ready: what was set, each with its Change; Start your first chat starts one, and the tour ends", async () => {
    const { started, done } = open(
      {
        "GET /start": { connected: { ok: true, models: 5 }, memory: { enabled: true, learnsWith: "a/haiku" } },
        "GET /defaults/settings": { flat: { "loop.permissions": "edit" } },
      },
      { step: stepOf("ready"), pref: prefOf({ model: "a/opus", effort: "medium" }) },
    );
    await settle();
    const rows = qa(".wel-summary .wel-row").map((r) => [text(r.querySelector(".wel-row-name")), text(r.querySelector(".wel-row-state"))]);
    assert.deepEqual(rows, [
      ["Models", "5 models can answer"],
      ["New chats start on", "Opus · Medium effort"],
      ["How it asks", "Edit automatically"],
      ["Memory", "On, learning with Haiku"],
      // (fails before: yes — 11-12: what was set had no line for the chats brought in)
      ["Your chats", "Not read"],
      ["First chat in", "No folder yet: Change picks one, or your first chat asks"],
    ]);
    // (fails before: yes — Product's review of 11-06: the rail said a bare "On" while the summary named the side model)
    assert.equal(facts().Memory, "On · Haiku", "the rail keeps the side model");
    q('.wel-summary .wel-row[data-step="asks"] button')?.dispatch("click");
    assert.ok(q(".wel-asks"), "Change goes back to its step");
    press("Next");
    press("Next");
    press("Next");
    press("Next");
    press("Next");
    press("Next");
    press("Start your first chat");
    assert.deepEqual([started, done, sheetEl()], [[true], ["finish"], null]);
  });

  // (fails before: yes — the owner's Mac of 11-08: a data folder with a chat, or a tour closed once, opened none while
  // nothing could answer)
  test("it opens by itself while nothing can answer, however often it was closed, and once on a data folder with no chat yet", () => {
    const none = { toured: true, chats: null, models: 0, connected: 0 };
    assert.equal(W.tourOpensItself(none), true, "nothing connected: it opens, toured or not");
    assert.equal(W.tourOpensItself({ ...none, connected: 1 }), false, "a coding agent connected");
    assert.equal(W.tourOpensItself({ ...none, models: 3 }), false, "a provider's models listed");
    assert.equal(W.tourOpensItself({ ...none, models: null }), false, "the models unread: nothing said");
    assert.equal(W.tourOpensItself({ ...none, connected: null }), false, "the agents unread: nothing said");
    const set = { toured: false, chats: 0, models: 2, connected: 1 };
    assert.equal(W.tourOpensItself(set), true, "a first start with no chat: once, connected or not");
    assert.equal(W.tourOpensItself({ ...set, toured: true }), false);
    assert.equal(W.tourOpensItself({ ...set, chats: 1 }), false);
    assert.equal(W.tourOpensItself({ ...set, chats: null }), false, "the chats unread");
  });

  test("the page opens it once per data folder with no chat yet, and from the command center, the help menu and /welcome; its first chat, folder and examples start chats as Ctrl+N and Open folder… do", () => {
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    // (fails before: yes — a chats list that failed to read, or held only archived chats, read as no chat, and a pane's
    // own window opened a second tour; found by the review of 8e420b6ff)
    assert.match(app, /applyRoute\(initial\);\n(?:  \/\/[^\n]*\n)+  if \(!POPPED && !CHAT_ONLY && !viewOnlyPage\(\) && state\.config\) \{\n    const toured = state\.config\?\.ui\?\.welcome\?\.seen !== false;\n    const listed = !toured && state\.sessionsLoadedAt && !\(state\.sessions \|\| \[\]\)\.length;\n    tourAsked = Promise\.all\(\[\n      listed \? api\("\/memory\/sessions\?limit=1&kind=interactive,fork&archived=all"\)\.then\(\(r\) => \(r\?\.sessions \|\| \[\]\)\.length, \(\) => null\) : null,\n      modelsRead,\n      api\("\/coding-agents"\)\.then\(\(l\) => \(l\?\.entries \|\| \[\]\)\.filter\(\(\/\*\* @type \{any\} \*\/ e\) => e\.state === "connected"\)\.length, \(\) => null\),\n    \]\)\.then\(\(\[chats, models, connected\]\) => \{ if \(tourOpensItself\(\{ toured, chats, models, connected \}\)\) openTour\(\); \}\);/);
    // (the review of the change: a model listed that nothing can run — an exact route with no key — counted as one that
    // answers; and a view-only page whose state never read could open it)
    assert.match(app, /const modelsRead = catalogue\.load\(\)\.then\(\(c\) => \(c\?\.models \|\| c\?\.data \|\| \[\]\)\.filter\(\(\/\*\* @type \{any\} \*\/ m\) => m\.answers\)\.length, \(\) => null\);/, "the models that answer, by the server's own rule");
    // (fails before: yes — an install's Sign in closed the install's sheet, which brought the tour back, and the sign-in's
    // sheet then closed the tour as closed: seen, and lost; found by the review of 8e420b6ff)
    assert.match(app, /setTimeout\(\(\) => \{ if \(!document\.querySelector\("\.zc-sheet-overlay"\)\) back\(\); \}, 0\)/);
    assert.match(app, /openInstall\(id, \{ agents: agentsKeeper, accounts: accountKeeper, signIn: \(upstream\) => void openSignIn\(upstream, \{ keeper: accountKeeper, onToast: toast \}, \{ sheet: sheetThen\(back\) \}\)/);
    assert.match(app, /\{ id: "welcome", label: "Welcome tour", icon: "sparkles", [^}]*run: \(\) => openTour\(\) \}/);
    assert.match(app, /onWelcome: \(\) => openTour\(\),/);
    assert.match(app, /await api\("\/config\/fields", \{ method: "PATCH", body: \{ set: \{ "ui\.welcome\.seen": true \} \} \}\);/);
    assert.match(app, /onStep: \(_i, id\) => prefs\.set\("welcomeStep", id\),/);
    assert.match(app, /onExample: \(text\) => \{\n\s*if \(!chatOf\(state\.currentId\)\?\.chainId\) \{ pushNextAddress = true; newChat\(\); leaveScreen\(\); \}\n\s*composer\.fill\(text\);/, "a chat not sent yet takes the model the tour set");
    assert.match(app, /onStart: \(\) => \{ pushNextAddress = true; newChat\(\); leaveScreen\(\); composer\.focus\?\.\(\); \},/);
    // (fails before: yes — a folder picked left the screen under the tour, and the new address closed the tour with it)
    assert.match(app, /pickFolder: \(path\) => \(path \? Promise\.resolve\(path\) : pickProjectFolder\(\)\)\.then\(\(p\) => \{ if \(p\) \{ pushNextAddress = true; newChat\(\{ cwd: p \}\); \} return p \|\| null; \}\),\n\s*folders: \(\) => recentFolders\(\),\n\s*onSettings: \(section\) => \{ location\.hash = routeFor\("settings", \{ section \}\); \},/, "a folder picked leaves no screen while the tour is open");
    assert.match(app, /step: stepAt\(prefs\.get\("welcomeStep"\)\),\n\s*\/\/ Where a new chat starts now: Your work and Ready say it\.\n\s*folder: folderIn\.value\.trim\(\),/, "the tour told where a new chat starts now");
    // (fails before: yes — 11-12: chats brought in from the tour's Your chats were sessions the sidebar never heard of)
    assert.match(app, /\n    \/\/ Your chats brought chats in: they are sessions now, and the sidebar lists them\.\n    onSessions: \(\) => \{ sidebar\.load\(\); \},\n    onToast: toast,\n  \}\);\n\}/, "the sidebar's list is read again as the tour's import ends");
    const composer = readFileSync(new URL("../src/ui/harness/composer/composer.js", import.meta.url), "utf8");
    assert.match(composer, /if \(!asWritten && cb\.onWelcome && \/\^\\\/welcome\\s\*\$\/i\.test\(text\.trim\(\)\)\) \{/);
    const header = readFileSync(new URL("../src/ui/harness/header.js", import.meta.url), "utf8");
    assert.match(header, /\{ label: "Welcome tour", icon: "sparkles", onClick: \(\) => cb\.onWelcome\?\.\(\) \}/);
    assert.equal(/** @type {any} */ (CONFIG_SCHEMA).ui.welcome.seen.default, false);
    assert.ok(FIELD_SECTIONS.includes("ui"));
  });

  test("the effort a new chat starts from, chosen apart from a chat: the rest of the last tuning stays", async () => {
    const E = await import("../src/ui/harness/composer/effort.js");
    const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    /** @type {Map<string, string>} */
    const kept = new Map([["filament.harness.lastTuning", JSON.stringify({ speed: "fast", thinking: "on", window: 0 })]]);
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)) } });
    try {
      E.rememberEffort("high");
      assert.deepEqual([E.lastTuning().effort, E.lastTuning().speed, E.lastTuning().thinking], ["high", "fast", "on"]);
      E.rememberEffort("");
      assert.equal(E.lastTuning().effort, null, "the model's own");
      E.rememberEffort("nonsense");
      assert.equal(E.lastTuning().effort, null);
      // (fails before: yes — the review of 5ff8bcb56: the tour's Max on Opus with thinking off said Max and ran at High,
      // its thinking dropped)
      kept.set("filament.harness.lastTuning", JSON.stringify({ speed: "standard", thinking: "off", window: 0 }));
      E.rememberEffort("max", true);
      assert.deepEqual([E.lastTuning().effort, E.lastTuning().thinking], ["max", "on"], "a level that needs extended thinking turns it on");
      E.rememberEffort("low");
      assert.equal(E.lastTuning().thinking, "on", "and a level that does not leaves it as it was");
    } finally {
      if (had) Object.defineProperty(globalThis, "localStorage", had);
      else delete (/** @type {any} */ (globalThis)).localStorage;
    }
  });

  // (fails before: yes — the tour printed Ctrl+K on a mac, where Filament's shortcuts read ⌘K)
  test("the tour's shortcuts print as the computer's: ⌘K on a mac, Ctrl+K elsewhere", async () => {
    const W = await import("../src/ui/harness/views/welcome.js");
    const had = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const as = (/** @type {string} */ platform) => Object.defineProperty(globalThis, "navigator", { configurable: true, value: { platform } });
    try {
      as("MacIntel");
      assert.equal(W.keysIn("The command center (Ctrl+K), Changes · Ctrl+Shift+D, the Plan tab · Alt+5."), "The command center (⌘K), Changes · ⌘⇧D, the Plan tab · ⌥5.");
      as("Win32");
      assert.equal(W.keysIn("The command center (Ctrl+K)."), "The command center (Ctrl+K).");
    } finally {
      if (had) Object.defineProperty(globalThis, "navigator", had);
      else delete (/** @type {any} */ (globalThis)).navigator;
    }
  });
});

// (fails before: yes — no `ui` in the configuration: a write of ui.welcome.seen was refused, and nothing said the tour
// was seen for the data folder)
test("the data folder keeps that the tour was seen: unseen at first, written through the harness's own fields", async () => {
  const shim = await startApp({});
  try {
    const st = await (await shim.api("/api/state")).json();
    assert.equal(st.config?.ui?.welcome?.seen, false);
    const w = await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "ui.welcome.seen": true } } });
    assert.equal(w.status, 200, await w.clone().text());
    assert.equal((await (await shim.api("/api/state")).json()).config?.ui?.welcome?.seen, true);
    const cmds = await (await shim.api("/api/commands")).json();
    assert.ok(JSON.stringify(cmds).includes('"/welcome"'), "/welcome is in the composer's slash menu");
  } finally {
    await shim.stop();
  }
});
