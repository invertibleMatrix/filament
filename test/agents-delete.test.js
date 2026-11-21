// @ts-check
// Deleting a row of the Agents tab (the owner's ask of 10-23: "i should be able to right click threads in Agents tab and
// be able to delete those for cleanup"): what each row's delete is and when it cannot go (lib/side.js `dropOf`), and
// the tab's right-click and Delete key on its rows (views/side.js) — the host asks and deletes (app.js `removeThread`).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DROP_BUSY, DROP_FLOW_BUSY, TEAM_CHARGE, dropOf, sideTeamItem, teamItems } from "../src/ui/harness/lib/side.js";
import { leadingTeam } from "../src/ui/harness/lib/team.js";
import { flowItem, flowRow } from "../src/ui/harness/lib/flow.js";
import { createSideView } from "../src/ui/harness/views/side.js";
import { fakeH } from "./helpers/fake-dom.js";
import { NOW, agentRow, guestRowOf, menuRows, sideIO, sideSeams } from "./helpers/side-view.js";

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** The list's row standing for this id. @param {any} el @param {string} id @returns {any} */
const rowEl = (el, id) => all(el, (x) => x.attrs?.["data-id"] === id && String(x.attrs?.class || "").includes("sd-row"))[0];
/** The tab's Start… button. @param {any} el @returns {any} */
const startBtn = (el) => all(el, (x) => String(x.attrs?.class || "").split(/\s+/).includes("sd-new"))[0];
/** A right-click on a node: whether the page's own menu was held back. @param {any} n */
const rightClick = (n) => {
  let held = false;
  n.dispatch("contextmenu", { preventDefault() { held = true; } });
  return held;
};
const settled = () => new Promise((r) => setImmediate(r));

/** The Architect team in charge, as a session's settings name it. */
const ENGINE = { mode: "team", team: "architect", teams: [{ key: "architect", name: "Architect", lead: { tag: "architect", name: "Architect" }, members: [{ tag: "builder", name: "Builder", may: "edit" }] }] };
/** A worker of the team in charge. @param {string} id */
const crewRow = (id) => agentRow(id, { card: { tag: "builder", name: "Builder", kind: "worker" }, may: "edit", status: "running", team: { key: "architect", team: "architect", role: "builder" }, exchanges: [{ description: `Task ${id}`, startedAt: NOW - 60_000, endedAt: null }] });
/** A team on the side of this chat, as its store lists it. @param {Record<string, any>} [o] @returns {any} */
const besideRow = (o = {}) => ({
  id: "t1", main: "c1", team: { key: "bug-hunter", name: "Bug Hunter" }, ask: "find bugs in the parser", firedBy: "you", at: NOW - 5 * 60_000, model: "m-1", title: "",
  state: "done", workers: { running: 0, waiting: 0, total: 3 }, verify: false, notify: false, of: null, verifiedBy: null, result: null, notified: null, cut: false, readOnly: true,
  on: { lead: "m-1", workers: ["m-2"], from: "team", fell: [] }, ...o,
});
/** The teams' facts as the host gathers them. @param {Record<string, any>} [o] @returns {any} */
const facts = (o = {}) => ({ leading: null, live: false, paused: false, rows: [], beside: [], self: null, boards: () => [], now: NOW, ...o });
/** A box of a flow as the list route answers it. @param {any} [o] */
const box = (o = {}) => ({
  id: "b1", kind: "agent", agent: "pm", name: "PM", words: "plan the parser", needs: [], gate: false, readOnly: false, model: null, sees: null,
  state: "done", run: { sub: "s1" }, ran: [], result: null, verdict: null, goneOn: false, sentBack: 0, error: null, usd: 0, startedAt: null, endedAt: null, past: [],
  words_: "Done", writes: false, needsOf: [], broken: [], waiting: null, ...o,
});
/** A flow as the list route answers it. @param {any} [o] @returns {any} */
const flow = (o = {}) => ({
  id: "fl-1", chainId: "c1", title: "Plan, check, hunt", goal: "plan the parser", state: "done",
  steps: [{ why: "The plan first.", boxes: [box()] }, { why: "", boxes: [box({ id: "b2", kind: "team", agent: "bug-hunter", name: "Bug Hunter", run: { team: "t9" } })] }],
  tell: true, hold: null, end: null, drawn: "agent", at: 0, startedAt: null, endedAt: null, sentBack: 0, line: "Flow · done",
  problem: null, seats: 1, usd: 0, place: null, ...o,
});

describe("what deleting a row of the Agents tab is", () => {
  // (fails before: yes — the owner's ask of 10-23: no row of the tab could be deleted)
  test("a thread: its name in the words, its changes not applied counted; at work it waits for its Stop; a coding agent's own agent is none of Filament's to delete", () => {
    assert.deepEqual(dropOf({ kind: "agent", row: agentRow("a1") }), {
      kind: "agent", id: "a1", at: "a1", label: "Delete thread…", busy: null, title: "Delete this thread?",
      description: "Builder's thread leaves this chat: what it was asked and what it answered. What it already sent to your agent stays in the chat. This cannot be undone.",
      done: "Thread deleted",
    });
    const work = (/** @type {number} */ pending) => agentRow("a2", { work: { pending, added: 3, removed: 1, applied: 0, open: false, files: [] } });
    assert.match(String(dropOf({ kind: "agent", row: work(2) })?.description), /: what it was asked and what it answered\. Its changes to 2 files, not applied, go with it\. What it already sent/);
    assert.match(String(dropOf({ kind: "agent", row: work(1) })?.description), /Its changes to 1 file, not applied, go with it\./);
    assert.doesNotMatch(String(dropOf({ kind: "agent", row: work(0) })?.description), /Its changes/, "applied, nothing of it waits");
    assert.equal(dropOf({ kind: "agent", row: agentRow("a3", { status: "running" }) })?.busy, DROP_BUSY);
    assert.equal(DROP_BUSY, "It is at work: stop it first");
    assert.equal(dropOf({ kind: "agent", row: guestRowOf("g1") }), null);
  });

  // (fails before: yes — the owner's ask of 10-23)
  test("a team on the side: its chat with its lead's and workers' threads; asking, it stops first; at work it waits; the team in charge is no row to delete", () => {
    const [side] = teamItems(facts({ beside: [besideRow()] }));
    assert.deepEqual(dropOf({ kind: "item", item: side }), {
      kind: "team", id: "t1", at: sideTeamItem("t1"), label: "Delete team chat…", busy: null, title: "Delete this team's chat?",
      description: "The Bug Hunter team's chat leaves this chat's side, with its lead's and its workers' threads. A result already sent to your agent stays in the chat. This cannot be undone.",
      done: "Team chat deleted",
    });
    const [asking] = teamItems(facts({ beside: [besideRow({ state: "asking" })] }));
    assert.match(String(dropOf({ kind: "item", item: asking })?.description), /threads\. Its lead's question goes unanswered: the team stops first\. A result/);
    assert.equal(dropOf({ kind: "item", item: asking })?.busy, null);
    const [working] = teamItems(facts({ beside: [besideRow({ state: "working" })] }));
    assert.equal(dropOf({ kind: "item", item: working })?.busy, DROP_BUSY);
    const [charge] = teamItems(facts({ leading: leadingTeam(ENGINE), live: true, rows: [crewRow("w1")] }));
    assert.equal(charge.id, TEAM_CHARGE);
    assert.equal(dropOf({ kind: "item", item: charge }), null, "the team in charge is the chat's settings, set back there");
  });

  // (fails before: yes — the owner's ask of 10-23: a flow's Remove left its threads and its teams' chats behind)
  test("a flow: with what it ran, or nothing of it where it is a draft; its worktree stays and the words say so; until it ended it waits", () => {
    const done = flowRow(flow(), NOW);
    assert.deepEqual(done.drop, { id: "fl-1", state: "done", keeps: false });
    assert.deepEqual(dropOf({ kind: "item", item: done }), {
      kind: "flow", id: "fl-1", at: flowItem("fl-1"), label: "Delete flow…", busy: null, title: "Delete this flow?",
      description: "“Plan, check, hunt” leaves this chat, with its boxes' threads and its teams' chats. This cannot be undone.",
      done: "Flow deleted",
    });
    const kept = flowRow(flow({ place: { kind: "worktree", branch: "filament/flow-plan", path: "H:/w/flow-plan" } }), NOW);
    assert.match(String(dropOf({ kind: "item", item: kept })?.description), /teams' chats\. Its worktree and its branch stay: nothing of them is deleted\. This cannot/);
    const draft = flowRow(flow({ state: "draft", steps: [{ why: "", boxes: [box({ state: "waits", run: null })] }] }), NOW);
    assert.equal(dropOf({ kind: "item", item: draft })?.description, "“Plan, check, hunt” leaves this chat; nothing of it ran. This cannot be undone.");
    for (const state of ["running", "holds", "cut"]) assert.equal(dropOf({ kind: "item", item: flowRow(flow({ state, hold: state === "holds" ? { kind: "gate", box: "b1" } : null }), NOW) })?.busy, DROP_FLOW_BUSY, state);
    for (const state of ["done", "stopped", "failed", "draft"]) assert.equal(dropOf({ kind: "item", item: flowRow(flow({ state }), NOW) })?.busy, null, state);
    assert.equal(DROP_FLOW_BUSY, "It has not ended: stop it first");
  });
});

describe("the Agents tab: a row's right-click and its Delete key", () => {
  /** @param {{ rows?: any[], own?: any[], items?: () => any[], remove?: (d: any) => Promise<boolean> }} [o] */
  function viewOf(o = {}) {
    const rows = o.rows || [];
    /** @type {any[]} */
    const asked = [];
    const io = sideIO({
      rows: () => rows,
      own: () => o.own || [],
      teams: { el: fakeH("div", { class: "tv-fake" }), items: o.items || (() => []), paint: () => {}, home: () => true },
      remove: o.remove || (async (/** @type {any} */ d) => { asked.push(d); return true; }),
    });
    const s = sideSeams();
    const view = createSideView(/** @type {any} */ (io), { h: fakeH, place: (p, k) => p.replaceChildren(...k), ...s.seams });
    const chat = /** @type {any} */ ({ id: "chat-1", chainId: "c1", turns: [] });
    view.paint(chat);
    return { io, view, chat, rows, asked, ...s, el: view.el };
  }

  // (fails before: yes — the owner's ask of 10-23)
  test("a thread's right-click: one red Delete thread… at the row; its press asks the host, and the thread that was open gives the tab back to Start…", async () => {
    const rows = [agentRow("a1"), agentRow("a2")];
    const v = viewOf({ rows, remove: async (d) => { v.asked.push(d); rows.splice(rows.findIndex((r) => r.id === d.id), 1); return true; } });
    rowEl(v.el, "a1").dispatch("click");
    assert.equal(startBtn(v.el).classList.contains("is-on"), false, "a1 is open");
    assert.equal(rightClick(rowEl(v.el, "a1")), true, "the browser's own menu is held back");
    const m = v.menus.at(-1);
    assert.deepEqual(menuRows(m), [["item", "Delete thread…"]]);
    assert.deepEqual([m.items[0].icon, m.items[0].variant, m.o.anchor], ["trash2", "destructive", rowEl(v.el, "a1")]);
    m.items[0].onClick();
    await settled();
    assert.deepEqual(v.asked.map((d) => [d.kind, d.id, d.title]), [["agent", "a1", "Delete this thread?"]]);
    assert.equal(rowEl(v.el, "a1"), undefined, "its row left the list");
    assert.equal(startBtn(v.el).classList.contains("is-on"), true, "the tab is at Start… again");
  });

  // (fails before: yes — the owner's ask of 10-23)
  test("an open thread stays open where the person said no, and a thread not open leaves the open one alone", async () => {
    const no = viewOf({ rows: [agentRow("a1")], remove: async (d) => { no.asked.push(d); return false; } });
    rowEl(no.el, "a1").dispatch("click");
    rightClick(rowEl(no.el, "a1"));
    no.menus.at(-1).items[0].onClick();
    await settled();
    assert.equal(no.asked.length, 1);
    assert.equal(startBtn(no.el).classList.contains("is-on"), false, "still open: nothing went");
    const rows = [agentRow("a1"), agentRow("a2")];
    const other = viewOf({ rows, remove: async (d) => { rows.splice(rows.findIndex((r) => r.id === d.id), 1); return true; } });
    rowEl(other.el, "a1").dispatch("click");
    rightClick(rowEl(other.el, "a2"));
    other.menus.at(-1).items[0].onClick();
    await settled();
    assert.equal(rowEl(other.el, "a2"), undefined);
    assert.equal(rowEl(other.el, "a1").attrs.class, "sd-row is-on", "a1 is still the open one");
  });

  // (fails before: yes — the owner's ask of 10-23)
  test("at work: the item is there but off, saying why, and the Delete key says it too; nothing is asked", async () => {
    const v = viewOf({ rows: [agentRow("a1", { status: "running" })] });
    rightClick(rowEl(v.el, "a1"));
    const m = v.menus.at(-1);
    assert.deepEqual(menuRows(m), [["item", "Delete thread…", "off"]]);
    assert.equal(m.items[0].desc, DROP_BUSY);
    let held = false;
    rowEl(v.el, "a1").dispatch("keydown", { key: "Delete", preventDefault() { held = true; } });
    await settled();
    assert.equal(held, true);
    assert.deepEqual(v.io.calls.filter((c) => c[0] === "toast"), [["toast", DROP_BUSY, ""]]);
    assert.equal(v.asked.length, 0);
  });

  // (fails before: yes — the owner's ask of 10-23)
  test("the Delete key on a row at rest deletes it as its menu does; another key does nothing", async () => {
    const v = viewOf({ rows: [agentRow("a1")] });
    rowEl(v.el, "a1").dispatch("keydown", { key: "Backspace" });
    await settled();
    assert.equal(v.asked.length, 0);
    rowEl(v.el, "a1").dispatch("keydown", { key: "Delete" });
    await settled();
    assert.deepEqual(v.asked.map((d) => [d.kind, d.id]), [["agent", "a1"]]);
  });

  // (fails before: yes — the owner's ask of 10-23)
  test("a team on the side and a flow have their own; the team in charge, its crew, a coding agent's own agent and the Teams row keep the browser's menu", async () => {
    const rows = [crewRow("w1")];
    const items = () => [...teamItems(facts({ leading: leadingTeam(ENGINE), live: true, rows, beside: [besideRow()] })), flowRow(flow(), NOW)];
    const v = viewOf({ rows, own: [guestRowOf("g1")], items });
    rightClick(rowEl(v.el, sideTeamItem("t1")));
    assert.deepEqual(menuRows(v.menus.at(-1)), [["item", "Delete team chat…"]]);
    v.menus.at(-1).items[0].onClick();
    rightClick(rowEl(v.el, flowItem("fl-1")));
    assert.deepEqual(menuRows(v.menus.at(-1)), [["item", "Delete flow…"]]);
    v.menus.at(-1).items[0].onClick();
    await settled();
    assert.deepEqual(v.asked.map((d) => [d.kind, d.id, d.at]), [["team", "t1", sideTeamItem("t1")], ["flow", "fl-1", flowItem("fl-1")]]);
    const menus = v.menus.length;
    for (const id of [TEAM_CHARGE, "w1", guestRowOf("g1").id]) {
      const n = rowEl(v.el, id);
      assert.ok(n, id);
      assert.equal(rightClick(n), false, id);
    }
    const teams = all(v.el, (x) => String(x.attrs?.class || "").includes("sd-teams-row"))[0];
    if (teams) assert.equal(rightClick(teams), false, "the Teams row");
    assert.equal(v.menus.length, menus, "no menu of the tab's own");
  });
});
