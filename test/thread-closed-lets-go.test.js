// @ts-check
// A thread let go of lets go of the box it scrolled in (the owner's of 11-02: "if i go into this chat's agents tab and
// open any finished or completed sub agent and scroll it's chat and stop, it snaps back at the end after a couple of
// seconds"). The Agents tab scrolls every thread in one box: a thread left for another kept that box, and a read of it
// still on its way — seconds, on a busy Filament — landed after the switch, drew the thread left and put the box at
// its end, under the thread the person had scrolled up in.
import { test, before, after } from "node:test";
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
/** @param {any} body */
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
/** A finished agent's row. @param {string} id */
const doneRow = (id) => agentRow(id, { status: "done", origin: "owner", asked: false, card: { tag: "scout", name: "Scout" }, exchanges: [{ prompt: "Look.", description: "Look.", by: "owner", runId: null, status: "done", startedAt: NOW - 5_000, endedAt: NOW - 1_000, delivery: null, report: "Found it." }] });
/** Answer the agent's oldest read on its way. @param {string} id */
const answer = (id) => reads.get(id)?.shift()?.(json({ subagent: doneRow(id) }));
const MAIN = { state: () => /** @type {const} */ ("idle"), outside: () => null, start: () => {}, write: () => {} };

// (fails before: yes — the thread left drew itself at its read's answer and put the shared box at its end: 5000)
test("a thread's read that lands after another thread took its box leaves the person's place in that box", async () => {
  const a = subagentConversation({ chainId: "c1", id: "sa_a", toast: () => {}, main: MAIN });
  const b = subagentConversation({ chainId: "c1", id: "sa_b", toast: () => {}, main: MAIN });
  try {
    // The Agents tab's one box: tall, of which a screen shows.
    const scroll = /** @type {any} */ (h("div", { class: "sd-scroll" }, a.body));
    Object.defineProperty(scroll, "scrollHeight", { get: () => 5000 });
    Object.defineProperty(scroll, "clientHeight", { get: () => 600 });
    scroll.scrollTop = 0;
    const host = h("div", { class: "host" }, scroll);
    doc.document.body.append(host);
    a.mount(scroll);
    await until(() => (reads.get("sa_a") || []).length === 1, "A is read");
    // Another thread opened before A's read came back (side.js paintThread): A let go of, B in its box.
    a.close();
    scroll.replaceChildren(b.body);
    b.mount(scroll);
    await until(() => (reads.get("sa_b") || []).length === 1, "B is read");
    answer("sa_b");
    await until(() => scroll.scrollTop === 5000, "B drawn at its end");
    // The person scrolls up in B to read it.
    scroll.scrollTop = 1200;
    scroll.dispatch("scroll");
    // A's read comes back now.
    answer("sa_a");
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(scroll.scrollTop, 1200, "B stays where the person scrolled it");
    assert.equal(scroll.children[0], b.body, "and B is what the box holds");
  } finally {
    a.close();
    b.close();
  }
});
