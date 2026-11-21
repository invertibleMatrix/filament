// @ts-check
// An agent's thread drawn again keeps the elements under the pointer (the owner's of 11-01: "when i hover over my mouse
// over some interactive elements like buttons then those are just suppose to highlight only once they quite a lot of
// time they start blinking … and during that sometimes the clicks even don't pass through so i have to press more than
// once"). Its Apply box was made anew at each look at the agent and at each dry run of its Apply — every fifteen seconds
// while it shows —, Apply, Show the diff, Mark as applied and How Apply works new elements under a resting pointer; its
// head's facts and clock every second, a fact's tooltip with them. Drawn in place (dom.js `morphChildren`), each is the
// element that stood, its words and its handler the newest draw's.
import { test, before, after, afterEach } from "node:test";
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
/** The page's event stream, as the bus opens it: the test says what the server would. @type {any[]} */
const streams = [];
/** @param {any} msg */
const say = (msg) => streams.at(-1)?.onmessage?.({ data: JSON.stringify(msg) });
const STUBS = {
  requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
  MutationObserver: class { observe() {} disconnect() {} },
  EventSource: class { constructor() { streams.push(this); } close() {} },
  addEventListener: () => {},
};
/** @type {Record<string, any>} */
const had = {};
for (const [k, v] of Object.entries(STUBS)) {
  had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
  g[k] = v;
}
const { subagentConversation } = await import("../src/ui/harness/subagent-viewer.js");
const { h } = await import("../src/ui/lib/dom.js");

/** @param {any} body @param {number} [status] */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const MAIN = { state: () => /** @type {const} */ ("idle"), outside: () => null, start: () => {}, write: () => {} };
const FOLDER = "/r/.git/filament-worktrees/sa_w1";
const waiting = { pending: 2, added: 4, removed: 1, applied: 0, open: true, folder: FOLDER, lastApplied: null,
  files: [{ path: "src/list.js", status: "M", added: 3, removed: 1, binary: false }, { path: "src/now.js", status: "A", added: 1, removed: 0, binary: false }] };

/** @type {ReturnType<typeof stubDocument>} */
let doc;
before(() => { doc = stubDocument(); });
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

/** The same element, never compared by its shape. @param {any} now @param {any} was @param {string} what */
const same = (now, was, what) => assert.ok(now != null && now === was, `${what}: the element that stood`);
/** @param {any} el @param {string} words */
const press = (el, words) => el.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === words) || null;
/** @param {any} row */
const mounted = (row) => {
  const conv = subagentConversation({ chainId: "c1", id: row.id, toast: () => {}, main: MAIN });
  open.push(conv);
  const scroll = h("div", { class: "scroll" }, conv.body);
  const host = h("div", { class: "host" }, conv.head, scroll, conv.foot);
  doc.document.body.replaceChildren(host);
  conv.mount(scroll);
  return { head: /** @type {any} */ (conv.head), body: /** @type {any} */ (conv.body) };
};
/** The server says the agent moved: the thread looks at it again, and draws what it read. */
const moved = async () => {
  const looks = () => asked.filter((a) => a === "GET /api/sessions/c1/subagents/sa_w1").length;
  const before = looks();
  say({ type: "subagent", id: "sa_w1" });
  await until(() => looks() > before, "a look at the agent");
  await new Promise((r) => setTimeout(r, 20));
};

test("its Apply box drawn again at a look at the agent keeps Apply, Show the diff, Mark as applied and How Apply works; a press acts", async () => {
  const row = agentRow("sa_w1", { may: "edit", work: waiting });
  let applied = 0;
  serve = (url, method) =>
    url.endsWith("/subagents/sa_w1/apply-preview") ? json({ folder: FOLDER, repo: "/r", came: [{ path: "src/now.js", how: "took" }], conflicts: [] })
    : url.endsWith("/subagents/sa_w1/apply") && method === "POST" ? (applied++, null)
    : url.startsWith("/api/sessions/c1/subagents/sa_w1") ? json({ subagent: row })
    : null;
  const { body } = mounted(row);
  await until(() => (body.querySelector(".sav-work-effect")?.textContent || "").startsWith("Apply writes"), "the dry run's words");
  const apply = press(body, "Apply 2 files");
  const diff = press(body, "Show the diff");
  const mark = press(body, "Mark as applied");
  const how = press(body, "How Apply works");
  assert.ok(apply && diff && mark && how, "the box's four buttons");
  await moved();
  same(press(body, "Apply 2 files"), apply, "Apply");
  same(press(body, "Show the diff"), diff, "Show the diff");
  same(press(body, "Mark as applied"), mark, "Mark as applied");
  same(press(body, "How Apply works"), how, "How Apply works");
  // Its own press draws it again: the button pressed is the one that stands, its words the newest.
  how.dispatch("click");
  same(press(body, "How Apply works"), how, "How Apply works, pressed");
  assert.equal(how.getAttribute("aria-expanded"), "true");
  apply.dispatch("click");
  assert.equal(applied, 1, "the press on the Apply that stood applies");
  same(press(body, "Applying…"), apply, "Apply, at work");
});

test("its head drawn again keeps its facts and its clock", async () => {
  const row = agentRow("sa_w1", { may: "edit", work: waiting });
  serve = (url) =>
    url.endsWith("/subagents/sa_w1/apply-preview") ? json({ folder: FOLDER, repo: "/r", came: [], conflicts: [] })
    : url.startsWith("/api/sessions/c1/subagents/sa_w1") ? json({ subagent: row })
    : null;
  const { head } = mounted(row);
  await until(() => head.querySelector(".sav-meta span"), "its facts");
  const fact = head.querySelector(".sav-meta span");
  const word = head.querySelector(".sav-status .sav-dot");
  await moved();
  same(head.querySelector(".sav-meta span"), fact, "its first fact");
  same(head.querySelector(".sav-status .sav-dot"), word, "its status's dot");
});
