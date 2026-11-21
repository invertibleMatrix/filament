// @ts-check
// The Run pane drawn again at the run's pulse keeps the elements under the pointer (the owner's of 11-01: "when i hover
// over my mouse over some interactive elements like buttons then those are just suppose to highlight only once they
// quite a lot of time they start blinking … and during that sometimes the clicks even don't pass through so i have to
// press more than once"). Rounds' spine was made anew at every event a reply streamed, its Maximise link with it, and
// the pulse (every 1.2 s while the run moves) emptied the pane's part and drew Calls and For developers from nothing:
// the toolbar's buttons, the search field and every card new elements under a resting pointer, an open card back to
// "Loading…" and read again, the headers it had opened closed. Drawn in place (dom.js `morphChildren`), each part and
// card keyed by what it is, they are the elements that stood, their words the newest draw's.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** What the stand-in server answers a GET, by its whole address: a body, or nothing (404). @type {(url: string) => any} */
let serve = () => undefined;
/** Every address read. @type {string[]} */
const read = [];
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => {
  read.push(String(url));
  const body = await serve(String(url));
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { renderRun, refreshRun, showRunPart } = await import("../src/ui/harness/panes/run-pane.js");
const spine = await import("../src/ui/harness/panes/run.js");

/** @type {ReturnType<typeof stubDocument>} */
let doc;
before(() => {
  doc = stubDocument();
});
after(() => {
  doc.restore();
  g.fetch = realFetch;
  showRunPart("rounds");
});

/** A moment for promises to settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));
/** A served main-session record. @param {string} id @param {number} input */
const record = (id, input) => ({ id, model: "m1", tokens: { input, output: 2 }, stopReason: "end_turn", totalMs: 5, upstream: "anthropic", httpStatus: 200 });
/** The pane's body, on the page. @returns {any} */
const bodyEl = () => {
  const body = doc.document.createElement("div");
  body.className = "pane-body";
  doc.document.body.append(body);
  return body;
};

// (fails before: yes — the spine's Maximise link was made anew at every paint)
test("Rounds: the spine drawn again at each event keeps its stations, its Maximise link and its replay scrubber, and the scrubber acts", async () => {
  const host = /** @type {any} */ (doc.document.createElement("div"));
  doc.document.body.append(host);
  /** @type {any[]} */
  const events = [{ n: 1, type: "round-start", round: 1 }, { n: 2, type: "round-text", round: 1, text: "Looking." }];
  const s = spine.renderRun(host, { runId: "r1", events, live: false });
  await s.load();
  const el = host.querySelector(".run-spine");
  const maximise = el.querySelector("a.ghost");
  const station1 = el.querySelector(".run-station");
  assert.ok(maximise && station1, "the Maximise link and round 1's station");
  assert.equal(maximise.textContent, "Maximise");

  events.push({ n: 3, type: "round-start", round: 2 });
  s.refresh();
  assert.equal(el.querySelector("a.ghost"), maximise, "the Maximise link stands");
  assert.equal(el.querySelector(".run-station"), station1, "round 1's station stands");
  assert.deepEqual(el.querySelectorAll(".run-station").map((/** @type {any} */ x) => x.className), ["run-station done", "run-station running"], "round 1 ended as round 2 started");

  events.push({ n: 4, type: "run-end", status: "done" });
  s.refresh();
  const range = el.querySelector("input.run-scrub");
  assert.ok(range, "the run ended: its replay scrubber");
  s.refresh();
  assert.equal(el.querySelector("input.run-scrub"), range, "the scrubber stands at the next paint");
  assert.equal(el.querySelector("a.ghost"), maximise);
  assert.equal(el.querySelector(".run-station"), station1);

  range.value = "2";
  range.dispatch("input");
  assert.equal(el.querySelectorAll(".run-station").length, 1, "dragged back to the second event: round 1 alone");
  assert.equal(el.querySelector(".run-station"), station1, "the station that stood");
  assert.equal(el.querySelector("input.run-scrub"), range, "the scrubber being dragged stands");
  host.remove();
});

// (fails before: yes — the pulse emptied the part and drew the pane's box anew around the spine, whose paint made its
// Maximise link anew)
test("Rounds in the pane: the pulse keeps the part's box, the spine and its controls", async () => {
  showRunPart("rounds");
  serve = (url) => (url.includes("/runs/r2/events") ? { events: [{ n: 1, type: "round-start", round: 1 }, { n: 2, type: "round-text", round: 1, text: "Hi." }, { n: 3, type: "run-end", status: "done" }], run: { events: 3 } } : undefined);
  const body = bodyEl();
  const ctx = { chat: { chainId: "c2", turns: [], live: { runId: "r2" } } };
  renderRun(body, ctx);
  const part = body.querySelector(".run-part");
  const stations = await until(() => body.querySelector(".run-stations"), "the run read, its stations drawn");
  const scroll = body.querySelector(".pane-scroll");
  const maximise = body.querySelector("a.ghost");
  const scrub = body.querySelector("input.run-scrub");
  assert.ok(scroll && maximise && scrub, "the pane's box, the Maximise link and the replay scrubber");
  refreshRun(body, ctx);
  await settle();
  assert.equal(body.querySelector(".run-part"), part, "the part's box stands");
  assert.equal(body.querySelector(".pane-scroll"), scroll, "the pane's box stands");
  assert.equal(body.querySelector(".run-stations"), stations, "the stations stand");
  assert.equal(body.querySelector("a.ghost"), maximise, "the Maximise link stands");
  assert.equal(body.querySelector("input.run-scrub"), scrub, "the scrubber stands");
  body.remove();
});

// (fails before: yes — the pulse emptied the part and drew Calls from nothing: new buttons, a new search field, new
// cards — the open one back to "Loading…" —, and the search's word gone)
test("Calls: the pulse keeps the toolbar, the search and its word, and the cards — an open card stays open with its record; Expand all acts", async () => {
  showRunPart("calls");
  const proto = Object.getPrototypeOf(doc.document.createElement("div"));
  // The page's own event dispatch, which Expand all uses to say each card opened.
  proto.dispatchEvent = function (/** @type {Event} */ ev) {
    this.dispatch(ev.type);
    return true;
  };
  serve = (url) => {
    if (url.includes("/sessions/c3/requests")) return { requests: [record("q1", 10), record("q2", 12)] };
    const m = /\/requests\/(q\d)$/.exec(url);
    return m ? { shapedBody: JSON.stringify({ messages: [{ role: "user", content: `the ask of ${m[1]}` }] }) } : undefined;
  };
  const body = bodyEl();
  const ctx = { chat: { chainId: "c3", turns: [], live: null }, coder: () => "" };
  try {
    renderRun(body, ctx);
    await until(() => body.querySelectorAll("details.prompt-card").length === 2, "the cards");
    const [q1, q2] = body.querySelectorAll("details.prompt-card");
    const head = body.querySelector(".run-last");
    const expandAll = body.querySelector("button[title='Expand all']");
    const search = body.querySelector("input.zc-input");
    assert.ok(head && expandAll && search, "Calls' head, Expand all and the search");
    q1.open = true;
    q1.dispatch("toggle");
    await until(() => q1.querySelector(".prompt-msg-text"), "the open card read its record");
    read.length = 0;

    refreshRun(body, ctx);
    await settle();
    assert.equal(body.querySelector(".run-last"), head, "Calls' head stands");
    assert.deepEqual(body.querySelectorAll("details.prompt-card"), [q1, q2], "the cards stand");
    assert.equal(q1.open, true, "the open card is open still");
    assert.equal(q1.querySelector(".prompt-msg-text")?.textContent, "the ask of q1", "with its record, never back to Loading…");
    assert.equal(body.querySelector("button[title='Expand all']"), expandAll, "Expand all stands");
    assert.equal(body.querySelector("input.zc-input"), search, "the search stands");
    assert.deepEqual(read.filter((u) => /\/requests\/q\d$/.test(u)), [], "the open card's record was not read again");

    expandAll.dispatch("click");
    await until(() => q2.querySelector(".prompt-msg-text"), "Expand all opened the other card, which read its record");
    assert.equal(q2.open, true);

    search.value = "12";
    search.dispatch("input");
    assert.deepEqual(body.querySelectorAll("details.prompt-card"), [q2], "the search keeps the call it names");
    refreshRun(body, ctx);
    await settle();
    assert.deepEqual(body.querySelectorAll("details.prompt-card"), [q2], "the pulse keeps the search's word");
    assert.equal(body.querySelector("input.zc-input"), search);
  } finally {
    delete proto.dispatchEvent;
    body.remove();
  }
});

// (fails before: yes — the developer's reviewer of 11-02: the pulse drew nothing while Calls' search had the focus, a
// guard from when it drew the part anew; at a turn's end the head kept saying the turn ran)
test("Calls with its search focused: a turn's end draws the head again, the search keeping its word and its place", async () => {
  showRunPart("calls");
  serve = (url) => (url.includes("/sessions/c5/requests") ? { requests: [record("q1", 10)] } : undefined);
  const body = bodyEl();
  const ctx = { chat: { chainId: "c5", turns: /** @type {any[]} */ ([]), live: /** @type {any} */ ({ runId: "r5" }) }, coder: () => "" };
  const page = /** @type {any} */ (doc.document);
  try {
    renderRun(body, ctx);
    await until(() => body.querySelector("details.prompt-card"), "the card");
    const search = body.querySelector("input.zc-input");
    assert.match(body.querySelector(".run-last").textContent, /once it ends/, "the turn runs");
    search.value = "q";
    search.dispatch("input");
    page.activeElement = search;
    // The turn ends.
    ctx.chat.live = null;
    refreshRun(body, ctx);
    await settle();
    assert.equal(body.querySelector(".run-last").textContent, "No reply yet.", "the head says the turn ended");
    assert.equal(body.querySelector("input.zc-input"), search, "the search stands");
    assert.equal(search.value, "q", "with its word");
  } finally {
    delete page.activeElement;
    body.remove();
  }
});

// (fails before: yes — the pulse emptied the part and drew For developers from nothing, its table back to "Loading…"
// and the Request headers opened closed and emptied)
test("For developers: the pulse keeps the table and the network's rows — headers opened stay open with what they read", async () => {
  showRunPart("dev");
  serve = (url) => {
    if (url.includes("/sessions/c4/requests")) return { requests: [record("q1", 10)] };
    return /\/requests\/q1$/.test(url) ? { shapedHeaders: { "x-a": "1" } } : undefined;
  };
  const body = bodyEl();
  const ctx = { chat: { chainId: "c4", turns: [], live: null }, coder: () => "" };
  renderRun(body, ctx);
  const attempt = await until(() => body.querySelector(".dev-attempt"), "the network's row");
  const tiles = body.querySelector(".dev-tiles");
  const did = body.querySelector(".run-did");
  const req = attempt.querySelector("details.dev-headers");
  assert.ok(tiles && did && req, "the tiles, what Filament did, and the Request headers");
  req.open = true;
  req.dispatch("toggle");
  await until(() => req.querySelector("pre.dev-headers-pre"), "the headers read");

  refreshRun(body, ctx);
  await settle();
  assert.equal(body.querySelector(".dev-attempt"), attempt, "the attempt's row stands");
  assert.equal(body.querySelector(".dev-tiles"), tiles, "the tiles stand");
  assert.equal(attempt.querySelector("details.dev-headers"), req, "Request headers stands");
  assert.equal(req.open, true, "open as it was");
  assert.equal(req.querySelector("pre.dev-headers-pre")?.textContent, "x-a: 1", "with the headers it read");
  assert.equal(body.querySelector(".run-did"), did, "What Filament did stands");
  body.remove();
});
