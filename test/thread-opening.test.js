// @ts-check
// An agent's thread opened while its launch still composes its first message: the registry lists it at once, with no
// context yet — its worktree is made, its room waited for, the session read, and only then is the context its first
// message opens with known. The thread draws "Context handed over" once a later read of the agent brings it, not only
// when the thread is opened again.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { agentRow, NOW } from "./helpers/side-view.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** The agent's reads, each answered when the test says. @type {((r: Response) => void)[]} */
const reads = [];
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => {
  if (/\/subagents\/sa_o1$/.test(String(url).split("?")[0])) return new Promise((resolve) => reads.push(resolve));
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
/** The agent as the detail route answers it while its first exchange runs, with the context it has so far. @param {any[]} opening */
const composing = (opening) =>
  agentRow("sa_o1", { status: "running", origin: "owner", asked: false, card: { tag: "scout", name: "Scout" }, opening, exchanges: [{ prompt: "Look at the parser.", description: "Look at the parser.", by: "owner", runId: null, status: "running", startedAt: NOW - 5_000, endedAt: null, delivery: null }] });
/** @param {any} el */
const folds = (el) => el.querySelectorAll(".sav-context").map((/** @type {any} */ c) => c.textContent);

// (fails before: yes — the exchange was drawn once, with the empty context of the first read: "Context handed over" never
// came, and the wait for it timed out)
test("the context a launch composed after its thread was opened is drawn when a read brings it", async () => {
  const MAIN = { state: () => /** @type {const} */ ("idle"), outside: () => null, start: () => {}, write: () => {} };
  const conv = subagentConversation({ chainId: "c1", id: "sa_o1", toast: () => {}, main: MAIN });
  try {
    const scroll = h("div", { class: "scroll" }, conv.body);
    const host = h("div", { class: "host" }, conv.head, scroll, conv.foot);
    doc.document.body.append(host);
    conv.mount(scroll);
    const body = /** @type {any} */ (conv.body);
    reads.shift()?.(json({ subagent: composing([]) }));
    await until(() => body.querySelector(".sav-ex"), "its first exchange, drawn while its launch composes");
    assert.doesNotMatch(body.textContent, /Context handed over/, "no context is known yet");

    // Its first message is composed: the agent's next message on the feed reads it again.
    const opening = [
      { kind: "view", count: 3, text: "turn 1: hello\nturn 2: the parser\nturn 3: fix it" },
      { kind: "brief", count: 2, text: "- the parser lives in src/parse.js\n- tests in test/parse.test.js" },
    ];
    feed.onmessage({ data: JSON.stringify({ type: "subagent", chainId: "c1", id: "sa_o1" }) });
    await until(() => reads.length === 1, "the read the feed's message asks for");
    reads.shift()?.(json({ subagent: composing(opening) }));
    await until(() => /Context handed over/.test(body.textContent), "the context, drawn once a read brings it");
    const ex = body.querySelector(".sav-ex");
    assert.equal(ex.children[0].className, "sav-opening", "it stands first in the exchange, over the task");
    assert.deepEqual(folds(body).map((t) => t.split("~")[0]), ["Conversation · 3 turns", "Memory brief · 2 lines"]);

    // A fold opened stays open while later reads bring the same context.
    const fold = body.querySelectorAll("details.sav-context")[0];
    fold.open = true;
    feed.onmessage({ data: JSON.stringify({ type: "subagent", chainId: "c1", id: "sa_o1" }) });
    await until(() => reads.length === 1, "the next read");
    reads.shift()?.(json({ subagent: composing(opening) }));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(body.querySelectorAll("details.sav-context")[0], fold, "the same fold, not drawn again");
    assert.ok(fold.open, "and still open");
    assert.equal(body.querySelectorAll(".sav-opening").length, 1, "one context, never two");
  } finally {
    conv.close();
  }
});
