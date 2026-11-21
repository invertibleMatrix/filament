// @ts-check
// A thread's "Loading" while Filament was slow (the owner's logs of 11-01: the Agents tab said Loading for minutes). Its
// read's answer was dropped when it landed while the thread's place was off the page, and nothing asked again; and any
// failure — Filament busy, the connection dropped — said "This thread is gone", which only a 404 means. A thread still
// mounted now draws what it reads wherever it stands, and a read that failed for another cause keeps what is shown and
// asks again, later each time.
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { agentRow, NOW } from "./helpers/side-view.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** Each agent's reads, answered when the test says. @type {Map<string, ((r: Response) => void)[]>} */
const reads = new Map();
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => {
  const m = /\/subagents\/(sa_\w+)$/.exec(String(url).split("?")[0]);
  if (!m) return new Promise(() => {});
  return new Promise((resolve) => {
    const list = reads.get(m[1]) || [];
    list.push(resolve);
    reads.set(m[1], list);
  });
};
const STUBS = {
  requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
  cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
  MutationObserver: class { observe() {} disconnect() {} },
  EventSource: class { close() {} },
  addEventListener: () => {},
};
// The page reads `fetch` as its modules load: they load after the stand-in stands, and before the document does.
const { subagentConversation } = await import("../src/ui/harness/subagent-viewer.js");
const { h } = await import("../src/ui/lib/dom.js");
/** @type {Record<string, any>} */
const had = {};
/** @type {ReturnType<typeof stubDocument>} */
let doc;
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
/** @param {any} body @param {number} [status] */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** A finished agent's row. @param {string} id */
const doneRow = (id) => agentRow(id, { status: "done", origin: "owner", asked: false, card: { tag: "scout", name: "Scout" }, exchanges: [{ prompt: "Look.", description: "Look.", by: "owner", runId: null, status: "done", startedAt: NOW - 5_000, endedAt: NOW - 1_000, delivery: null, report: "Found it." }] });
/** @param {string} id */
const pending = (id) => (reads.get(id) || []).length;
/** @param {string} id @param {Response} r */
const answer = (id, r) => reads.get(id)?.shift()?.(r);
const MAIN = { state: () => /** @type {const} */ ("idle"), outside: () => null, start: () => {}, write: () => {} };
/** What the thread's body shows, in words. @param {any} body */
const shows = (body) => (body.querySelector(".sav-loading") ? "Loading" : body.querySelector(".sav-empty")?.textContent || (body.children.length ? "drawn" : "nothing"));

// (fails before: yes — the answer was dropped while its place was off the page, and the thread said Loading for good)
test("a thread's read that lands while its place is off the page is drawn, there for when it shows", async () => {
  const conv = subagentConversation({ chainId: "c1", id: "sa_off", toast: () => {}, main: MAIN });
  try {
    const scroll = h("div", { class: "scroll" }, conv.body);
    // Mounted in a place not in the document now (a pane's tile moved, the tab put away).
    const host = h("div", { class: "host" }, conv.head, scroll, conv.foot);
    conv.mount(scroll);
    await until(() => pending("sa_off") === 1, "it is read");
    assert.equal(shows(conv.body), "Loading");
    answer("sa_off", json({ subagent: doneRow("sa_off") }));
    await until(() => shows(conv.body) === "drawn", "drawn, though its place is off the page");
  } finally {
    conv.close();
  }
});

// (fails before: yes — a 503 said "This thread is gone", and nothing asked again)
test("a read that fails while Filament is busy keeps what is shown and asks again, later each time; only a 404 says it is gone", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  /** Wait for a condition on the turns of the event loop alone: the clock is the test's. @param {() => boolean} ok @param {string} what */
  const turns = async (ok, what) => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setImmediate(r));
    assert.ok(ok(), what);
  };
  const conv = subagentConversation({ chainId: "c1", id: "sa_busy", toast: () => {}, main: MAIN });
  try {
    const scroll = h("div", { class: "scroll" }, conv.body);
    const host = h("div", { class: "host" }, conv.head, scroll, conv.foot);
    doc.document.body.append(host);
    conv.mount(scroll);
    await turns(() => pending("sa_busy") === 1, "it is read");
    answer("sa_busy", json({ error: "busy" }, 503));
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    assert.equal(shows(conv.body), "Loading", "not gone: Filament could not say now");
    assert.equal(pending("sa_busy"), 0, "not asked again at once");
    mock.timers.tick(2_000);
    await turns(() => pending("sa_busy") === 1, "asked again after a wait");
    answer("sa_busy", json({ error: "busy" }, 503));
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    mock.timers.tick(2_000);
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    assert.equal(pending("sa_busy"), 0, "the second wait is longer");
    mock.timers.tick(2_000);
    await turns(() => pending("sa_busy") === 1, "then asked again");
    answer("sa_busy", json({ subagent: doneRow("sa_busy") }));
    await turns(() => shows(conv.body) === "drawn", "drawn once it answers");
  } finally {
    conv.close();
    mock.timers.reset();
  }
  const gone = subagentConversation({ chainId: "c1", id: "sa_gone", toast: () => {}, main: MAIN });
  try {
    const scroll = h("div", { class: "scroll" }, gone.body);
    const host = h("div", { class: "host" }, gone.head, scroll, gone.foot);
    doc.document.body.append(host);
    gone.mount(scroll);
    await until(() => pending("sa_gone") === 1, "it is read");
    answer("sa_gone", json({ error: "no such sub-agent in this session" }, 404));
    await until(() => /^This thread is gone/.test(shows(gone.body)), "a 404: gone");
  } finally {
    gone.close();
  }
});
