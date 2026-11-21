// @ts-check
// A run's spine while the run goes on (the performance audit of 10-29, C5): the Run pane grouped the whole run into
// stations again at each event it heard, and the maximised room did too — twice, then made its spine anew from
// nothing —, so an event cost more the longer the run. Now each folds the events since the last paint onto what it
// folded, keeps its one spine, and draws once a frame however many events land in it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";
import { runSocketFromRoutes } from "./helpers/run-socket.js";

const g = /** @type {any} */ (globalThis);
/** The run's events stream, as the server sends it: the test writes to it. @type {ReadableStreamDefaultController<Uint8Array> | null} */
let stream = null;
const enc = new TextEncoder();
/** The events the run had when the room read it. */
const FIRST = [{ n: 1, type: "round-start", round: 1 }, { n: 2, type: "round-text", round: 1, text: "Looking." }];
/** The run's routes: its events stream, its log. @param {string} url */
const serve = async (url) => {
  if (String(url).includes("stream=1")) {
    const body = new ReadableStream({ start: (c) => { stream = c; } });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  return new Response(JSON.stringify({ events: FIRST, run: { events: 2 } }), { status: 200, headers: { "content-type": "application/json" } });
};
const realFetch = g.fetch;
g.fetch = serve;
// The page reads `fetch` as its modules load: they load after the stand-in stands, and before the document does.
const { renderRun, stationsFrom } = await import("../src/ui/harness/panes/run.js");
const { renderControlRoom } = await import("../src/ui/harness/control-room.js");

/** The frames the page asked for, run when the test says. @type {(() => void)[]} */
const frames = [];
const STUBS = {
  requestAnimationFrame: (/** @type {() => void} */ fn) => frames.push(fn),
  cancelAnimationFrame: () => {},
  MutationObserver: class { observe() {} disconnect() {} },
  // The room follows its run on the page's run socket, answered from the same routes.
  WebSocket: runSocketFromRoutes((path) => serve(path)),
  location: { protocol: "http:", host: "stand-in" },
  addEventListener: () => {},
  removeEventListener: () => {},
};
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

/** Every element under `el` that wears the class, in order. @param {any} el @param {string} cls @returns {any[]} */
const all = (el, cls) => [...(el.classList?.contains(cls) ? [el] : []), ...[...(el.children || [])].flatMap((k) => all(k, cls))];

// (fails before: yes — each paint grouped every event of the run again)
test("the Run pane folds only the events since its last paint, and draws what the whole run says", () => {
  let reads = 0;
  /** An event whose kind is counted each time it is read. @param {any} e */
  const counted = (e) => {
    const { type, ...rest } = e;
    return Object.defineProperty(rest, "type", { get: () => (reads++, type), enumerable: true });
  };
  const events = Array.from({ length: 200 }, (_, i) => counted(i % 10 === 0 ? { n: i + 1, type: "round-start", round: i / 10 + 1 } : { n: i + 1, type: "round-text", round: Math.floor(i / 10) + 1, text: "x" }));
  const host = document.createElement("div");
  const spine = renderRun(/** @type {any} */ (host), { runId: "r0", events, live: false });
  void spine.load();
  const first = reads;
  reads = 0;
  events.push(counted({ n: 201, type: "round-start", round: 21 }));
  spine.refresh();
  assert.ok(reads < first / 10, `one event more read ${reads} kinds, the whole run ${first}`);
  assert.equal(all(host, "run-station").length, 21, "every round drawn");
  assert.deepEqual(all(host, "run-station").map((s) => s.classList.contains("running")).slice(-2), [false, true], "the newest runs, the one before ended");
  // The same stations the whole log gives.
  assert.equal(stationsFrom(events).rounds.length, 21);
});

// (fails before: yes — each event the room heard grouped the run twice and made its spine anew)
test("the maximised room keeps one spine and draws once a frame however many events land", async () => {
  const host = document.createElement("div");
  doc.document.body.append(host);
  renderControlRoom(/** @type {any} */ (host), "r1", { onClose: () => {} });
  await until(() => all(host, "run-spine").length === 1 && stream, "the run read, its spine drawn, its events followed");
  const spine = all(host, "run-spine")[0];
  const status = all(host, "cr-status")[0];
  assert.equal(status.textContent, "working · step 1");
  frames.length = 0;
  const say = (/** @type {any} */ e) => /** @type {any} */ (stream).enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
  say({ n: 3, type: "round-start", round: 2 });
  say({ n: 4, type: "round-text", round: 2, text: "More." });
  say({ n: 5, type: "round-start", round: 3 });
  await until(() => frames.length > 0, "the events heard");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(frames.length, 1, "three events, one frame");
  assert.equal(status.textContent, "working · step 1", "drawn at the frame");
  for (const fn of frames.splice(0)) fn();
  assert.equal(status.textContent, "working · step 3");
  assert.equal(all(host, "run-spine")[0], spine, "the same spine, drawn again");
  assert.equal(all(spine, "run-station").length, 3);
  // The run ends: its follow ends with it.
  say({ n: 6, type: "run-end", status: "done" });
  /** @type {any} */ (stream).close();
  await until(() => frames.length > 0, "its end heard");
  for (const fn of frames.splice(0)) fn();
  assert.equal(status.textContent, "ended · step 3");
  host.replaceChildren();
});
