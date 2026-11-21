// @ts-check
// Apply where the agent stands (the Designer's of 10-27, on the owner's "what does that apply button even do behind the
// scene"): an agent's thread says what its Apply would do before the press, as the agents band in Changes does — why it
// waits, the dry run's effect line or the file that stops it, How Apply works — and what it did after, in place of a
// toast; its head holds no second "Apply changes". The mark in the chat says what waits and opens its row in Changes.
import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { agentRow } from "./helpers/side-view.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** What the stand-in server answers, by method and address; null leaves the request unanswered. @type {(url: string, method: string) => Response | null} */
let serve = () => null;
/** @type {string[]} */
const asked = [];
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
  const method = String(init?.method || "GET");
  asked.push(`${method} ${String(url).split("?")[0]}`);
  return serve(String(url), method) ?? new Promise(() => {});
};
const { subagentConversation } = await import("../src/ui/harness/subagent-viewer.js");
const { subagentMarkRow } = await import("../src/ui/harness/conversation/subagent-marks.js");
const { chipActions } = await import("../src/ui/harness/conversation/tools/layout.js");
const { h } = await import("../src/ui/lib/dom.js");

/** @param {any} body @param {number} [status] */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const MAIN = { state: () => /** @type {const} */ ("idle"), outside: () => null, start: () => {}, write: () => {} };
const FOLDER = "/r/.git/filament-worktrees/sa_w1";
const waiting = { pending: 2, added: 4, removed: 1, applied: 0, open: true, folder: FOLDER, lastApplied: null,
  files: [{ path: "src/list.js", status: "M", added: 3, removed: 1, binary: false }, { path: "src/now.js", status: "A", added: 1, removed: 0, binary: false }] };

describe("an agent's thread, its work waiting in its copy", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    MutationObserver: class { observe() {} disconnect() {} },
    EventSource: class { close() {} },
    addEventListener: () => {},
  };
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
  });
  after(() => {
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
    g.fetch = realFetch;
  });
  /** @type {{ close: () => void }[]} */
  const open = [];
  afterEach(() => {
    for (const c of open.splice(0)) c.close();
  });
  /** @param {any} row @param {(msg: string, kind?: string) => void} toast */
  const mounted = (row, toast) => {
    const conv = subagentConversation({ chainId: "c1", id: row.id, toast, main: MAIN });
    open.push(conv);
    const scroll = h("div", { class: "scroll" }, conv.body);
    const host = h("div", { class: "host" }, conv.head, scroll, conv.foot);
    doc.document.body.append(host);
    conv.mount(scroll);
    return { head: /** @type {any} */ (conv.head), body: /** @type {any} */ (conv.body) };
  };
  /** @param {any} el @param {string} sel */
  const text = (el, sel) => el.querySelector(sel)?.textContent || "";
  /** @param {any} el @param {string} words */
  const press = (el, words) => el.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === words);

  // (fails before: yes — the box said "waiting to be applied" and its Apply wrote at once with a toast after; the head
  // had a second Apply changes)
  test("it says why it waits and what Apply would do, How Apply works opens; applied, the result line in place of a toast", async () => {
    /** @type {string[]} */
    const toasts = [];
    let row = agentRow("sa_w1", { may: "edit", work: waiting });
    serve = (url, method) =>
      url.endsWith("/subagents/sa_w1/apply-preview") ? json({ folder: FOLDER, repo: "/r", came: [{ path: "src/list.js", how: "merged" }, { path: "src/now.js", how: "took" }], conflicts: [] })
      : url.endsWith("/subagents/sa_w1/apply") && method === "POST" ? json({ ok: true, files: ["src/list.js", "src/now.js"] })
      : url.startsWith("/api/sessions/c1/subagents/sa_w1") ? json({ subagent: row })
      : null;
    const { head, body } = mounted(row, (msg) => toasts.push(msg));
    await until(() => text(body, ".sav-work-effect").startsWith("Apply writes"), "the dry run's words");
    assert.equal(press(head, "Apply changes"), undefined, "no second Apply in the head");
    assert.equal(text(body, ".sav-work-effect"), "Apply writes 2 files into /r: 1 as it left it, 1 merged with your edits (list.js). Nothing is staged or committed.");
    assert.match(text(body, ".sav-work-note"), /^It worked in its own copy, so your folder has none of this yet\. 2 files, \+4 −1\.$/);
    press(body, "How Apply works").dispatch("click");
    assert.equal(body.querySelectorAll(".sav-how li").length, 5);
    assert.match(text(body, ".sav-how"), /filament-worktrees\/sa_w1/, "its copy's folder named");
    row = agentRow("sa_w1", { may: "edit", work: { ...waiting, pending: 0, applied: 2, lastApplied: { at: Date.UTC(2026, 9, 28, 14, 2), files: 2, by: "owner", came: { took: 1, merged: ["src/list.js"], deleted: 0, same: 0 } } } });
    press(body, "Apply 2 files").dispatch("click");
    await until(() => /^Applied /.test(text(body, ".sav-work-note")), "the result line");
    assert.match(text(body, ".sav-work-note"), /^Applied \d\d:\d\d by you — 2 files: 1 as it left it, 1 merged with your edits\. Nothing staged\.$/);
    assert.deepEqual(toasts, [], "said in place, never a toast");
  });

  // (fails before: yes — an overlap was a toast after the press)
  test("a file that stops it is named before the press, Apply off; a refusal after the press is said in place", async () => {
    /** @type {string[]} */
    const toasts = [];
    let stuck = true;
    const row = agentRow("sa_w1", { may: "edit", work: waiting });
    serve = (url, method) =>
      url.endsWith("/subagents/sa_w1/apply-preview") ? json(stuck ? { folder: FOLDER, repo: "/r", came: [], conflicts: [{ path: "src/list.js", why: "its change overlaps yours" }] } : { folder: FOLDER, repo: "/r", came: [{ path: "src/now.js", how: "took" }], conflicts: [] })
      : url.endsWith("/subagents/sa_w1/apply") && method === "POST" ? json({ error: "The folder moved under it: try again" }, 409)
      : url.startsWith("/api/sessions/c1/subagents/sa_w1") ? json({ subagent: row })
      : null;
    const { body } = mounted(row, (msg) => toasts.push(msg));
    await until(() => text(body, ".sav-work-effect").startsWith("Can't apply"), "the stop, before the press");
    assert.equal(text(body, ".sav-work-effect"), "Can't apply as it stands — its file overlaps your edits. Nothing would be written.");
    assert.equal(text(body, ".sav-conflicts"), "list.js — its change overlaps yourssrc/list.js", "the file, why, and its path");
    assert.ok(body.querySelectorAll(".sav-work-note").some((/** @type {any} */ n) => /or send it back to rebase, from its row in Changes\.$/.test(n.textContent)), "where to choose for it");
    assert.notEqual(press(body, "Apply 2 files").getAttribute("disabled"), null, "Apply off");
    // Clear of it, the press refused all the same (the folder moved under it): said in place, never a toast.
    stuck = false;
    const again = mounted(row, (msg) => toasts.push(msg));
    await until(() => text(again.body, ".sav-work-effect").startsWith("Apply writes"), "a clean dry run");
    press(again.body, "Apply 2 files").dispatch("click");
    // (fails before: yes — the Hunter's of 10-28: the refusal stood over every dry run after it, Apply locked)
    await until(() => /moved under it/.test(text(again.body, ".sav-work-last")), "the refusal in place");
    assert.equal(text(again.body, ".sav-work-last"), "Your last Apply: Nothing applied: The folder moved under it: try again");
    assert.equal(press(again.body, "Apply 2 files").getAttribute("disabled"), null, "the dry run after it is clean: Apply on");
    assert.deepEqual(toasts, []);
  });

  // (fails before: yes — the Hunter's of 10-28: the dry run was read again only as its work moved, so a file the
  // developer cleared of the overlap kept Apply off until a follow-up, a rebase or a reload)
  test("its dry run is read again on its own once it is 15 s old: the overlap cleared in the developer's editor, Apply comes on", async () => {
    const realSet = g.setTimeout;
    const realNow = Date.now;
    /** @type {(() => void)[]} */
    const later = [];
    // The clock runs, 15 s on at once when the test says: `until`'s own deadline reads it too.
    let ahead = 0;
    g.setTimeout = (/** @type {() => void} */ fn, /** @type {number} */ ms, /** @type {any[]} */ ...a) => (ms >= 15_000 ? (later.push(fn), { unref() {} }) : realSet(fn, ms, ...a));
    Date.now = () => realNow() + ahead;
    try {
      let stuck = true;
      const row = agentRow("sa_w1", { may: "edit", work: waiting });
      serve = (url) =>
        url.endsWith("/subagents/sa_w1/apply-preview") ? json(stuck ? { folder: FOLDER, repo: "/r", came: [], conflicts: [{ path: "src/list.js", why: "its change overlaps yours" }] } : { folder: FOLDER, repo: "/r", came: [{ path: "src/now.js", how: "took" }, { path: "src/list.js", how: "merged" }], conflicts: [] })
        : url.startsWith("/api/sessions/c1/subagents/sa_w1") ? json({ subagent: row })
        : null;
      const { body } = mounted(row, () => {});
      await until(() => text(body, ".sav-work-effect").startsWith("Can't apply"), "the stop");
      stuck = false;
      ahead += 15_001;
      for (const fn of later.splice(0)) fn();
      await until(() => text(body, ".sav-work-effect").startsWith("Apply writes"), "read again: clean now");
      assert.equal(press(body, "Apply 2 files").getAttribute("disabled"), null, "Apply on");
    } finally {
      g.setTimeout = realSet;
      Date.now = realNow;
    }
  });

  // (fails before: yes — 10-29, the owner's: a change brought into the folder by hand still read "Apply 2 files", with no
  // way to say it was in)
  test("Mark as applied in its thread: a refusal said in place; marked, its line says nothing was written, with Undo, which has it wait again", async () => {
    /** @type {string[]} */
    const toasts = [];
    let row = agentRow("sa_w1", { may: "edit", work: waiting });
    let refuse = true;
    const marked = { ...waiting, pending: 0, applied: 1, files: [], lastApplied: { at: Date.UTC(2026, 9, 29, 14, 2), files: 2, by: "owner", hand: true, undo: true } };
    asked.length = 0;
    serve = (url, method) =>
      url.endsWith("/subagents/sa_w1/apply-preview") ? json({ folder: FOLDER, repo: "/r", came: [{ path: "src/list.js", how: "same" }, { path: "src/now.js", how: "same" }], conflicts: [] })
      : url.endsWith("/subagents/sa_w1/mark-applied") && method === "POST"
        ? refuse ? json({ error: "sub-agent sa_w1's work is being applied now" }, 409) : ((row = agentRow("sa_w1", { may: "edit", work: marked })), json({ ok: true, files: waiting.files, subagent: row }))
      : url.endsWith("/subagents/sa_w1/mark-applied") && method === "DELETE" ? ((row = agentRow("sa_w1", { may: "edit", work: waiting })), json({ ok: true, files: waiting.files, subagent: row }))
      : url.startsWith("/api/sessions/c1/subagents/sa_w1") ? json({ subagent: row })
      : null;
    const { body } = mounted(row, (msg) => toasts.push(msg));
    await until(() => text(body, ".sav-work-effect").startsWith("Every file"), "the dry run's words");
    assert.deepEqual(body.querySelector(".sav-work-actions").querySelectorAll("button").map((/** @type {any} */ b) => b.textContent), ["How Apply works", "Show the diff", "Mark as applied", "Apply 2 files"]);
    press(body, "Mark as applied").dispatch("click");
    await until(() => /being applied now/.test(text(body, ".sav-work-last")), "the refusal in place");
    assert.equal(text(body, ".sav-work-last"), "It couldn't be marked as applied: sub-agent sa_w1's work is being applied now");

    refuse = false;
    press(body, "Mark as applied").dispatch("click");
    await until(() => /^Marked as applied /.test(text(body, ".sav-work-note")), "the mark's line");
    assert.match(text(body, ".sav-work-note"), /^Marked as applied \d\d:\d\d by you — 2 files, in your folder already\. Filament wrote nothing\.$/);
    assert.equal(body.querySelector(".sav-work-last"), null, "the refusal goes with the mark that took");
    press(body, "Undo").dispatch("click");
    await until(() => !!press(body, "Apply 2 files"), "its work waits again");
    assert.deepEqual(asked.filter((a) => a.endsWith("/mark-applied")), ["POST /api/sessions/c1/subagents/sa_w1/mark-applied", "POST /api/sessions/c1/subagents/sa_w1/mark-applied", "DELETE /api/sessions/c1/subagents/sa_w1/mark-applied"]);
    assert.deepEqual(toasts, [], "said in place, never a toast");
  });

  // (fails before: yes — a mark's refusal stood beside the Apply's pressed after it, as if the Apply had said it)
  test("a mark's refusal goes once Apply is pressed", async () => {
    const row = agentRow("sa_w1", { may: "edit", work: waiting });
    serve = (url, method) =>
      url.endsWith("/subagents/sa_w1/apply-preview") ? json({ folder: FOLDER, repo: "/r", came: [{ path: "src/now.js", how: "took" }, { path: "src/list.js", how: "merged" }], conflicts: [] })
      : url.endsWith("/subagents/sa_w1/mark-applied") && method === "POST" ? json({ error: "git would not keep the mark: its work waits as it did" }, 409)
      : url.endsWith("/subagents/sa_w1/apply") && method === "POST" ? json({ error: "The folder moved under it: try again" }, 409)
      : url.startsWith("/api/sessions/c1/subagents/sa_w1") ? json({ subagent: row })
      : null;
    const { body } = mounted(row, () => {});
    await until(() => text(body, ".sav-work-effect").startsWith("Apply writes"), "the dry run's words");
    press(body, "Mark as applied").dispatch("click");
    await until(() => /keep the mark/.test(text(body, ".sav-work-last")), "the mark's refusal");
    press(body, "Apply 2 files").dispatch("click");
    await until(() => /moved under it/.test(text(body, ".sav-work-last")), "the Apply's refusal");
    assert.deepEqual(body.querySelectorAll(".sav-work-last").map((/** @type {any} */ n) => n.textContent), ["Your last Apply: Nothing applied: The folder moved under it: try again"], "the mark's refusal went");
  });

  // (fails before: yes — the Hunter's of 10-28: work sent back to rebase was painted green with its Apply, as the band
  // said it was its sub-agent's next)
  test("work sent back to rebase says so in its thread, no Apply, no dry run", async () => {
    const row = agentRow("sa_w1", { may: "edit", work: waiting, rebaseDue: true });
    asked.length = 0;
    serve = (url) => (url.startsWith("/api/sessions/c1/subagents/sa_w1") ? json({ subagent: row }) : null);
    const { body } = mounted(row, () => {});
    await until(() => /^Sent back to rebase/.test(text(body, ".sav-work-note")), "the rebase's words");
    assert.equal(press(body, "Apply 2 files"), undefined, "no Apply");
    assert.equal(asked.some((a) => a.endsWith("/apply-preview")), false, "no dry run asked");
  });
});

// (fails before: yes — the Hunter's of 10-28: one the list was answered without — Filament holds it no longer — kept its
// mark's "3 files wait in its copy · Review ›", which opened Changes on no row of it)
test("the mark of one Filament holds no longer offers no Review ›: Changes has no row of it; before the list answers, the mark's word stands", () => {
  const doc = stubDocument();
  const mark = () => /** @type {any} */ (subagentMarkRow(/** @type {any} */ ({ event: "arrival", agentId: "sa_w1", exchange: 0, status: "done", changes: 3, card: { tag: "fixer", name: "Fixer" } })));
  Object.assign(chipActions, { subagentWork: () => null, subagentsKnown: () => true, reviewSubagent: () => {} });
  try {
    assert.equal(mark().querySelector(".sub-mark-send"), null);
    chipActions.subagentsKnown = () => false;
    assert.equal(mark().querySelector(".sub-mark-send")?.textContent, "3 files wait in its copy · Review ›");
  } finally {
    Object.assign(chipActions, { subagentWork: null, subagentsKnown: null, reviewSubagent: null });
    doc.restore();
  }
});

// (fails before: yes — 10-29: the mark stopped following once nothing waited, so an undone mark as applied left it
// saying the changes were applied while they waited again)
test("the mark in the chat says a mark as applied, and follows it while it can be undone: undone, its changes wait again", async () => {
  const doc = stubDocument();
  let work = { pending: 0, applied: 1, hand: true, undo: true };
  /** @type {(() => void)[]} */
  const heard = [];
  Object.assign(chipActions, {
    subagentWork: () => work,
    reviewSubagent: () => {},
    watchSubagents: (/** @type {() => void} */ fn) => (heard.push(fn), () => void heard.splice(heard.indexOf(fn), 1)),
  });
  const tell = () => { for (const fn of [...heard]) fn(); };
  try {
    const row = /** @type {any} */ (subagentMarkRow(/** @type {any} */ ({ event: "arrival", agentId: "sa_w1", exchange: 0, status: "done", changes: 3, card: { tag: "fixer", name: "Fixer" } })));
    doc.document.body.append(row);
    await new Promise((r) => setTimeout(r, 0));
    assert.match(row.textContent, / · its changes are marked as applied/);
    assert.equal(heard.length, 1, "it follows while the mark can be undone");
    work = { pending: 3, applied: 0, hand: false, undo: false };
    tell();
    assert.equal(row.querySelector(".sub-mark-send")?.textContent, "3 files wait in its copy · Review ›");
    // Marked again, and the sub-agent worked since: nothing to undo, and it follows no more.
    work = { pending: 0, applied: 1, hand: true, undo: false };
    tell();
    assert.match(row.textContent, / · its changes are marked as applied/);
    assert.equal(heard.length, 0);
  } finally {
    Object.assign(chipActions, { subagentWork: null, reviewSubagent: null, watchSubagents: null });
    doc.restore();
  }
});

// (fails before: yes — the review of 10-30: work Filament found in the folder itself read as a mark of someone's)
test("the mark in the chat says work Filament found in your folder as found there", async () => {
  const doc = stubDocument();
  Object.assign(chipActions, { subagentWork: () => ({ pending: 0, applied: 1, hand: true, found: true, undo: true }), reviewSubagent: () => {}, watchSubagents: () => () => {} });
  try {
    const row = /** @type {any} */ (subagentMarkRow(/** @type {any} */ ({ event: "arrival", agentId: "sa_w1", exchange: 0, status: "done", changes: 3, card: { tag: "fixer", name: "Fixer" } })));
    doc.document.body.append(row);
    await new Promise((r) => setTimeout(r, 0));
    assert.match(row.textContent, / · its changes were found in your folder/);
    assert.doesNotMatch(row.textContent, /marked as applied/);
  } finally {
    Object.assign(chipActions, { subagentWork: null, reviewSubagent: null, watchSubagents: null });
    doc.restore();
  }
});

test("the mark in the chat: what waits in its copy, and Review › opens its row in Changes", () => {
  const doc = stubDocument();
  /** @type {string[]} */
  const reviewed = [];
  Object.assign(chipActions, { subagentWork: () => ({ pending: 3, applied: 0 }), reviewSubagent: (/** @type {string} */ id) => void reviewed.push(id) });
  try {
    const row = /** @type {any} */ (subagentMarkRow(/** @type {any} */ ({ event: "arrival", agentId: "sa_w1", exchange: 0, status: "done", changes: 3, card: { tag: "fixer", name: "Fixer" } })));
    const b = row.querySelector(".sub-mark-send");
    assert.equal(b?.textContent, "3 files wait in its copy · Review ›");
    b.dispatch("click");
    assert.deepEqual(reviewed, ["sa_w1"]);
  } finally {
    Object.assign(chipActions, { subagentWork: null, reviewSubagent: null });
    doc.restore();
  }
});
