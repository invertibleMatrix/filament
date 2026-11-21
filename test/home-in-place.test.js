// @ts-check
// Home drawn again as the chats move keeps the elements under the pointer (the owner's of 11-01: "when i hover over my
// mouse over some interactive elements like buttons then those are just suppose to highlight only once they quite a
// lot of time they start blinking … and during that sometimes the clicks even don't pass through so i have to press
// more than once"). Needs you's rows and filters, Working's rows and Finished today's Show, and At a glance's cards
// were each made anew — at every word of a chat's row, every read of Home, every minute — while the pointer rested on
// them: a row, its Done and Not now, a card and its project's chip new elements under it, whose hover started over and
// where a press that began on the old one never clicked. Drawn in place (dom.js `morphChildren`), each keyed by what it
// is, they are the elements that stood, their words and their handlers the newest draw's. The Space's page's are
// space-in-place.test.js's.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** What the page posted, in order. @type {{ url: string, body: any }[]} */
const posted = [];
/** What the stand-in server answers by the whole address (and the method): a body, or undefined for a 404. @type {(url: string, method: string) => any} */
let serve = () => undefined;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
  const method = String(init.method || "GET");
  if (method !== "GET") posted.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
  const body = serve(String(url), method);
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { renderYourSpace } = await import("../src/ui/harness/space/your-space.js");
const { h } = await import("../src/ui/lib/dom.js");

after(() => {
  g.fetch = realFetch;
});

const MIN = 60_000;
/** Each part the very element it was. @param {Record<string, any>} now @param {Record<string, any>} was @param {string} what */
const same = (now, was, what) => {
  // The very element, said in a word: a diff of two page trees is more than the reporter can hold.
  for (const k of Object.keys(was)) assert.ok(now[k] === was[k], `${what}: its ${k}`);
};

describe("Home drawn again", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
    HTMLElement: class {},
    // The events stream, one for the page: a test hands Home a message through it.
    EventSource: class {
      constructor() {
        streams.push(this);
      }
      close() {}
    },
    addEventListener: () => {},
  };
  /** @type {any[]} */
  const streams = [];
  /** A message on the events stream, as the server sends one. @param {any} msg */
  const hear = (msg) => {
    for (const s of streams) s.onmessage?.({ data: JSON.stringify(msg) });
  };
  /** Every Home drawn, stopped at the end so no tick outlives its test. @type {(() => void)[]} */
  const stops = [];
  /** @type {Map<string, string>} */
  const kept = new Map();
  let hadStore;
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
    g.window.setTimeout = () => 0;
    // A menu listens for its keys on the window.
    g.window.addEventListener ||= () => {};
    g.window.removeEventListener ||= () => {};
    hadStore = g.localStorage;
    g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, v), removeItem: (/** @type {string} */ k) => void kept.delete(k) };
  });
  after(() => {
    for (const stop of stops) stop();
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
    if (hadStore === undefined) delete g.localStorage;
    else g.localStorage = hadStore;
  });
  beforeEach(() => {
    posted.length = 0;
    for (const stop of stops.splice(0)) stop();
  });

  /** A menu opened from a button: its rows. @param {any} b @param {string} what */
  const menuOf = async (b, what) => {
    b.dispatch("click");
    await until(() => doc.document.body.querySelector(".zc-menu"), what);
    return /** @type {any[]} */ (doc.document.body.querySelector(".zc-menu").querySelectorAll(".zc-menu-item"));
  };

  /**
   * Home drawn as the page draws it: two projects, their kept rows and a dashboard's tile from the server; the chats'
   * rows from Now, kept in objects a test moves in place.
   */
  const mountHome = () => {
    const at = Date.now();
    /** @param {string} id @param {any} o */
    const need = (id, o) => ({ id, kind: "watch", text: `CI failed on main: run ${id}`, why: "a watch of Deploys", dashboard: "deploys-ab12", title: "Deploys", watch: "w0", at: at - 10 * MIN, state: "open", project: "p1", ...o });
    const served = {
      needs: [need("w1", {}), need("d1", { state: "done", doneAt: at - MIN })],
      value: "7c1e",
    };
    const answer = () => ({
      projects: [{ id: "p1", name: "app", cwd: "/r" }, { id: "p2", name: "api", cwd: "/a" }],
      needs: served.needs,
      dashboards: { p1: [{ name: "deploys-ab12", title: "Deploys", state: "kept", paused: false }], p2: [] },
      glance: [{ project: "p1", name: "deploys-ab12", title: "Deploys", paused: false,
        tiles: [{ read: true, at, stale: false, error: null, title: "Live now", from: "deploys", line: { title: "Live now", value: served.value, format: "text", words: "", tone: "", at: at - 12 * MIN } }] }],
      extended: true,
    });
    serve = (u, method) => {
      if (u === "/api/your-space" && method === "GET") return answer();
      const m = /^\/api\/space\/(p\d)\/needs\/(\w+)$/.exec(u);
      if (m && method === "POST") {
        served.needs = served.needs.map((n) => (n.id === m[2] ? { ...n, state: "done", doneAt: Date.now() } : n));
        return { ok: true, space: {} };
      }
      return undefined;
    };
    /** @param {any} o */
    const nowRow = (o) => ({ thread: null, group: "needs", fact: "", tone: "", icon: "messageSquare", tile: "model", model: "", under: [], team: "", step: "", ...o, key: `chat:${o.chain}` });
    const groups = {
      needs: [nowRow({ chain: "c1", title: "login", project: "app", fact: "asks which branch", tone: "asks", at: at - 3 * MIN }), nowRow({ chain: "c2", title: "build", project: "api", fact: "Stopped: boom", tone: "error", at: at - 5 * MIN })],
      works: [nowRow({ chain: "c3", group: "works", title: "search", project: "app", fact: "reads files", at: at - MIN })],
      done: [nowRow({ chain: "c4", group: "done", title: "docs", project: "app", at: at - 2000 })],
    };
    const did = { rows: /** @type {string[]} */ ([]), spaces: /** @type {string[]} */ ([]) };
    const host = h("div", { class: "main-frame" });
    doc.document.body.append(host);
    const ys = renderYourSpace(host, { now: () => groups, openRow: (r) => void did.rows.push(r.chain), openSpace: (id, tab) => void did.spaces.push(tab ? `${id} › ${tab}` : id), startWith: () => {}, onClose: () => {} });
    stops.push(ys.stop, () => host.remove());
    return { host, ys, did, groups, served };
  };

  // (fails before: yes — the rows and the filters were made anew at every word of a chat's row and every read)
  test("Needs you's rows and filters drawn again as the chats' words move keep each row, its Done and Not now, and the filters; each press acts on the one that stands", async () => {
    const { host, did, groups, served } = mountHome();
    await until(() => host.querySelector('.sp-need[data-chain="c1"]') && host.querySelector('.sp-need[data-need="w1"]'), "the rows read");
    const sec = host.querySelector(".ys-needs");
    const find = () => {
      const w1 = sec.querySelector('.sp-need[data-need="w1"]');
      return { c1: sec.querySelector('.sp-need[data-chain="c1"]'), w1, done: w1?.querySelector(".sp-need-done"), later: w1?.querySelector(".sp-need-later"),
        all: sec.querySelector('.ys-filter[data-filter="all"]'), chats: sec.querySelector('.ys-filter[data-filter="chats"]') };
    };
    const was = find();
    assert.ok(Object.values(was).every(Boolean), "the chat's row, the kept row, its Done and Not now, the filters All and Chats");
    groups.needs[0].fact = "asks which file";
    served.needs[0].text = "CI failed on main: run w1 again";
    hear({ type: "space", project: "p1" });
    await until(() => sec.querySelector('.sp-need[data-chain="c1"] .sp-need-t')?.textContent === "asks which file" && sec.querySelector('.sp-need[data-need="w1"] .sp-need-t')?.textContent === "CI failed on main: run w1 again", "the newest words drawn");
    same(find(), was, "the rows and the filters");
    assert.ok((await menuOf(was.later, "Not now's choices")).length, "Not now opens its choices");
    was.later.dispatch("click");
    assert.equal(doc.document.body.querySelector(".zc-menu"), null, "a second press on the button that stands closes its menu");
    was.c1.dispatch("click");
    assert.deepEqual(did.rows, ["c1"], "the chat's row opens it");
    was.chats.dispatch("click");
    assert.deepEqual(sec.querySelectorAll(".sp-needs .sp-need").map((/** @type {any} */ e) => e.getAttribute("data-chain")), ["c1"], "Chats narrows the list");
    assert.ok(sec.querySelector('.sp-need[data-chain="c1"]') === was.c1, "to the row that stood");
    was.all.dispatch("click");
    // Chats took the kept row off the page: All draws it anew — a row that left has nothing to stand for it.
    const w1 = find();
    assert.ok(w1.w1 && w1.done, "All brings the kept row back");
    assert.ok(sec.querySelector('.sp-need[data-chain="c1"]') === was.c1, "the chat's row stood through both");
    same({ all: w1.all, chats: w1.chats }, { all: was.all, chats: was.chats }, "the filters too");
    w1.done.dispatch("click");
    await until(() => !sec.querySelector('.sp-need[data-need="w1"]'), "done");
    assert.deepEqual(posted.at(-1), { url: "/api/space/p1/needs/w1", body: { done: true } });
  });

  // (fails before: yes — the rows and Finished today's foot were made anew at every word of a chat's row)
  test("Working drawn again as a chat's words move keeps its rows and Finished today's Show; Show lists what finished, the rows standing", async () => {
    const { host, ys, did, groups } = mountHome();
    await until(() => host.querySelector('.ys-works .ys-chat[data-chain="c3"]'), "the rows read");
    const works = host.querySelector(".ys-works");
    const find = () => ({ c3: works.querySelector('.ys-chat[data-chain="c3"]'), show: works.querySelector(".sp-needs-show") });
    const was = find();
    assert.ok(Object.values(was).every(Boolean), "the chat's row and Finished today's Show");
    groups.works[0].fact = "edits files";
    ys.paint();
    same(find(), was, "Working's row and the foot's Show");
    assert.match(was.c3.textContent, /edits files/, "the row says its newest words");
    was.show.dispatch("click");
    assert.deepEqual(works.querySelectorAll(".ys-done-list .ys-chat").map((/** @type {any} */ e) => e.getAttribute("data-chain")), ["c4"], "Show lists what finished today");
    assert.ok(works.querySelector('.ys-chat[data-chain="c3"]') === was.c3, "the row at work stands through Show");
    was.c3.dispatch("click");
    assert.deepEqual(did.rows, ["c3"]);
  });

  // (fails before: yes — the cards were made anew at every read and every minute)
  test("At a glance drawn again as a tile moves keeps each card and its project's chip; a press, and Enter, open the one that stands", async () => {
    const { host, did, served } = mountHome();
    await until(() => host.querySelector('.ys-card[data-dashboard="deploys-ab12"]'), "the cards read");
    const find = () => ({ card: host.querySelector('.ys-card[data-dashboard="deploys-ab12"]'), chip: host.querySelector('.ys-card[data-dashboard="deploys-ab12"] .ys-proj') });
    const was = find();
    assert.ok(Object.values(was).every(Boolean), "the card and its project's chip");
    served.value = "8d2f";
    hear({ type: "space", project: "p1" });
    await until(() => host.querySelector('.ys-card[data-dashboard="deploys-ab12"] .ys-g-value')?.textContent === "8d2f", "the tile's newest value drawn");
    same(find(), was, "At a glance");
    was.card.dispatch("click");
    was.card.dispatch("keydown", { key: "Enter" });
    was.chip.dispatch("click");
    assert.deepEqual(did.spaces, ["p1 › deploys-ab12", "p1 › deploys-ab12", "p1"], "the card opens its page by a press and by Enter; the chip its Space");
  });
});
