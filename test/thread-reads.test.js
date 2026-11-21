// @ts-check
// An agent's thread while its agent works (the performance audit of 10-29, C5): each of the agent's messages on the
// events feed read the agent whole again, beside the reads still on their way, and each frame aligned its run's whole
// log again, so a frame's work grew with the run. Now one read is on its way at a time with one at most behind it, and
// each frame aligns only the events since the last.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { agentRow, NOW } from "./helpers/side-view.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** The agent's reads, each answered when the test says. @type {((r: Response) => void)[]} */
const reads = [];
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => {
  if (/\/subagents\/sa_r1$/.test(String(url).split("?")[0])) return new Promise((resolve) => reads.push(resolve));
  return new Promise(() => {});
};
/** The events feed, as the page opened it. @type {any} */
let feed = null;
const STUBS = {
  requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
  cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
  MutationObserver: class { observe() {} disconnect() {} },
  EventSource: class {
    constructor() {
      /** @type {((e: { data: string }) => void) | null} */
      this.onmessage = null;
      feed = this;
    }
    close() {}
  },
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

// (fails before: yes — five messages, five reads of the agent at once)
test("the agent's messages while a read of it is on its way read it once more, together", async () => {
  const row = agentRow("sa_r1", { status: "done", origin: "owner", asked: false, card: { tag: "scout", name: "Scout" }, exchanges: [{ prompt: "Look.", description: "Look.", by: "owner", runId: null, status: "done", startedAt: NOW - 5_000, endedAt: NOW - 1_000, delivery: null }] });
  const MAIN = { state: () => /** @type {const} */ ("idle"), outside: () => null, start: () => {}, write: () => {} };
  const conv = subagentConversation({ chainId: "c1", id: "sa_r1", toast: () => {}, main: MAIN });
  try {
    const scroll = h("div", { class: "scroll" }, conv.body);
    const host = h("div", { class: "host" }, conv.head, scroll, conv.foot);
    doc.document.body.append(host);
    conv.mount(scroll);
    assert.equal(reads.length, 1, "mounted, it reads the agent");
    for (let i = 0; i < 5; i++) feed.onmessage({ data: JSON.stringify({ type: "subagent", chainId: "c1", id: "sa_r1" }) });
    assert.equal(reads.length, 1, "nothing goes out beside the read on its way");
    reads.shift()?.(json({ subagent: row }));
    await until(() => reads.length === 1, "the messages meanwhile read it once more");
    reads.shift()?.(json({ subagent: row }));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(reads.length, 0, "and that was all");
  } finally {
    conv.close();
  }
});

// (fails before: yes — each frame aligned the run's whole log again)
test("each frame aligns its run's log onto what the frame before aligned", () => {
  const viewer = readFileSync("src/ui/harness/subagent-viewer.js", "utf8");
  assert.match(viewer, /const aligned = alignOnto\(alignCache, events\);/);
  assert.doesNotMatch(viewer, /alignEvents\(events\)/);
});
