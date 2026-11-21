// @ts-check
// The Next request pane drawn again — at the run's pulse, and as you type (the composer's live figures move it) — keeps
// its figure, its parts bar, its legend and the turns' cards (the owner's of 11-01: "when i hover over my mouse over
// some interactive elements like buttons then those are just suppose to highlight only once they quite a lot of time
// they start blinking … and during that sometimes the clicks even don't pass through so i have to press more than
// once"). Each paint emptied its boxes and drew them from nothing: the bar's parts and the turns' cards new elements
// under a resting pointer, their tooltips gone with them. Drawn in place (dom.js `morphChildren`), the turns keyed by
// their number, they are the elements that stood, their words the newest.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** What the stand-in server answers by the whole address: a body, or undefined for a 404. @type {(url: string) => any} */
let serve = () => undefined;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => {
  const body = await serve(String(url));
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { renderNextRequest, refreshNextRequest, draftMoved } = await import("../src/ui/harness/panes/next-request.js");
const { h } = await import("../src/ui/lib/dom.js");

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {Record<string, any>} */
const had = {};
const STUBS = {
  requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
  cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
  HTMLElement: class {},
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

/** A few turns of the event loop: what a read set off has landed. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

// (fails before: yes — each paint emptied the parts' box and the turns' box and drew them anew)
test("the pulse and the draft moving keep the figure, the bar, the legend and the turns' cards, their words the newest", async () => {
  let preview = { current: { window: 200000, usable: 170000, fixed: 12000, tokens: 30000, perTurn: [{ n: 1, shape: "raw", tokens: 20000 }, { n: 2, shape: "fold", tokens: 10000 }] } };
  let draft = "";
  serve = (url) => (url.includes("/sessions/c1/transcript") ? { turns: [{ n: 1, user: { content: "Fix the bug" } }, { n: 2, user: { content: "Now test it" } }, { n: 3, user: { content: "And the docs" } }] } : undefined);
  const chat = /** @type {any} */ ({ chainId: "c1", turns: [{}, {}] });
  const body = /** @type {any} */ (h("div", { class: "pane-body" }));
  doc.document.body.append(body);
  const ctx = { chat, preview: async () => preview, draft: () => draft, onToast: () => {}, reload: () => {}, coder: () => "" };
  renderNextRequest(body, ctx);
  await until(() => body.querySelector(".ctx-turn-snippet"), "the turns drawn");
  await settle();
  const fig = body.querySelector(".nr-fig");
  const bar = body.querySelector(".inst-stack");
  const legend = body.querySelector(".inst-legend");
  const stack = body.querySelector(".ctx-stack");
  const [t1, t2] = body.querySelectorAll(".ctx-turn");
  const keys = body.querySelector(".ctx-legend");
  assert.ok(fig && bar && legend && stack && t1 && t2 && keys, "the figure, the bar, the legend, the stack, two cards and the stack's legend");
  assert.match(fig.textContent, /^42,000 of 200,000 tokens · 21%/);
  /** @param {string} sel */
  const texts = (sel) => body.querySelectorAll(sel).map((/** @type {any} */ e) => e.textContent);

  // The chat moved — a turn more — and the pulse weighs the request again.
  preview = { current: { ...preview.current, tokens: 46000, perTurn: [...preview.current.perTurn, { n: 3, shape: "raw", tokens: 16000 }] } };
  chat.turns.push({});
  refreshNextRequest(body, ctx);
  await until(() => body.querySelectorAll(".ctx-turn").length === 3, "the third turn drawn");
  await settle();
  assert.equal(body.querySelector(".nr-fig"), fig, "the figure stands across the pulse");
  assert.match(fig.textContent, /^58,000 of 200,000 tokens · 29%/, "with the newest weighing");
  assert.deepEqual([body.querySelector(".inst-stack"), body.querySelector(".inst-legend")], [bar, legend], "the bar and the legend stand");
  assert.equal(body.querySelector(".ctx-stack"), stack, "the stack stands");
  assert.deepEqual(body.querySelectorAll(".ctx-turn").slice(0, 2), [t1, t2], "the turns' cards stand");
  assert.equal(body.querySelector(".ctx-legend"), keys, "the stack's legend stands");
  assert.deepEqual(texts(".ctx-turn-snippet"), ["Fix the bug", "Now test it", "And the docs"]);
  assert.match(keys.textContent, /3 turns · 2 whole · 1 folded/, "its tally the newest");
  const t3 = body.querySelectorAll(".ctx-turn")[2];

  // Typing: the draft's figures move the bar and put the ghost at the top; the cards stand.
  draft = "a draft of forty characters, near enough";
  draftMoved();
  assert.equal(body.querySelector(".nr-fig"), fig, "the figure stands as you type");
  assert.match(fig.textContent, /^58,0\d\d of 200,000 tokens · 29%/, "your draft weighed in");
  assert.deepEqual([body.querySelector(".inst-stack"), body.querySelector(".inst-legend")], [bar, legend]);
  assert.equal(legend.querySelectorAll(".inst-legend-row").length, 3, "your draft in the legend");
  const ghost = body.querySelector(".ctx-ghost");
  assert.ok(ghost, "the draft is a ghost at the top");
  assert.equal(body.querySelector(".ctx-stack"), stack);
  assert.deepEqual(body.querySelectorAll(".ctx-turn"), [t1, t2, t3], "the cards stand under the ghost");
  const ghostTokens = ghost.querySelector(".ctx-turn-tokens").textContent;
  draft += " — and more of them, typed on";
  draftMoved();
  assert.equal(body.querySelector(".ctx-ghost"), ghost, "the ghost stands as the draft grows");
  assert.notEqual(ghost.querySelector(".ctx-turn-tokens").textContent, ghostTokens, "its figure moved");
  assert.equal(body.querySelector(".nr-fig"), fig);
  body.remove();
});
