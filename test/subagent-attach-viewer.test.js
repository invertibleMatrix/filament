// @ts-check
// A sub-agent's conversation says under the main agent's message what it attached to it (`attach`, the owner's of
// 11-17), its names in the tooltip; a message of the person's, or one with nothing attached, says nothing of it.
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { agentRow } from "./helpers/side-view.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** The row the stand-in server answers. @type {any} */
let row = null;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) =>
  String(url).startsWith("/api/sessions/c1/subagents/sa_1") ? new Response(JSON.stringify({ subagent: row }), { status: 200, headers: { "content-type": "application/json" } }) : new Promise(() => {});
const { subagentConversation } = await import("../src/ui/harness/subagent-viewer.js");
const { h } = await import("../src/ui/lib/dom.js");

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {Record<string, any>} */
const had = {};
const STUBS = { requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0), MutationObserver: class { observe() {} disconnect() {} }, EventSource: class { close() {} }, addEventListener: () => {} };
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
const MAIN = { state: () => /** @type {const} */ ("idle"), outside: () => null, start: () => {}, write: () => {} };
/** The conversation of `row`, drawn. */
const mounted = () => {
  const conv = subagentConversation({ chainId: "c1", id: "sa_1", toast: () => {}, main: MAIN });
  open.push(conv);
  const scroll = h("div", { class: "scroll" }, conv.body);
  doc.document.body.append(h("div", { class: "host" }, conv.head, scroll, conv.foot));
  conv.mount(scroll);
  return /** @type {any} */ (conv.body);
};

// (fails before: yes — the exchange kept no names of what was attached, and the conversation said none)
test("the main agent's message says what it attached; the person's, and one with nothing attached, say nothing", async () => {
  const ex = (/** @type {any} */ o) => ({ prompt: "Compare them.", description: "Look", startedAt: 1_000, endedAt: 2_000, status: "done", delivery: "tool", ...o });
  row = agentRow("sa_1", { asked: false, origin: "agent", exchanges: [ex({ by: "agent", files: ["notes.md"], pictures: ["picture 1", "picture 2"] }), ex({ by: "agent", prompt: "Again." }), ex({ by: "owner", prompt: "Mine.", pictures: ["shot.png"] })] });
  const body = mounted();
  await until(() => body.querySelectorAll(".sav-bubble").length === 3, "its three messages");
  const said = body.querySelectorAll(".sav-attached");
  assert.equal(said.length, 1, "the first message alone");
  assert.equal(said[0].textContent, "with a file and 2 pictures");
  assert.equal(said[0].getAttribute("title"), "notes.md, picture 1, picture 2");
});
