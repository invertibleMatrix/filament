// @ts-check
// HarnessV4_Visuals_Plan E16 step 4, the page: a helper's pictures. In its thread each stands in its round after the
// calls, its card the same one from "Drawing…" to the picture, read from where it is kept — the turn that launched it,
// or the session for a helper no turn launched (VS-D48, VS-D49); a thread whose run's log is gone draws them from what
// the exchange says it drew. Under the card that launched or asked it a "Drew" line names each one: a click opens it
// under the card, a second folds it — hidden, never made again (VS-D50). The drawing itself is step 2's frame, looked at
// in a browser (the Logs, step 4): here a picture's code is never answered, so nothing is drawn, and what is checked is
// where each card stands and where its code is read from.
// (fails before: yes — a helper's thread drew no picture, and no card said what a helper drew)
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { agentRow, NOW } from "./helpers/side-view.js";
import { until } from "./helpers/wait.js";
import { runSocketFromRoutes } from "./helpers/run-socket.js";

const g = /** @type {any} */ (globalThis);
/** The paths the page asked the server for, in order. @type {string[]} */
const asked = [];
/** What the stand-in server answers, by the whole address; null leaves the request unanswered. @type {(url: string) => Response | null} */
let serve = () => null;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => {
  asked.push(String(url).split("?")[0]);
  return serve(String(url)) ?? new Promise(() => {});
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { subagentConversation } = await import("../src/ui/harness/subagent-viewer.js");
const { agentCardRow } = await import("../src/ui/harness/conversation/agent-card.js");
const { askedRows, roundRows } = await import("../src/ui/harness/conversation/tools/render.js");
const { chipActions } = await import("../src/ui/harness/conversation/tools/layout.js");
const { alignEvents } = await import("../src/ui/harness/lib/labels.js");
const { drewIn } = await import("../src/ui/harness/lib/subagents.js");
const { h } = await import("../src/ui/lib/dom.js");

const read = (/** @type {string} */ f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
/** @param {any} body */
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
/** A run's stream the test writes to, as the server's events stream sends it (and its run socket, the same frames). */
const runStream = () => {
  /** @type {ReadableStreamDefaultController<Uint8Array>} */
  let ctl;
  const body = new ReadableStream({ start: (c) => { ctl = c; } });
  const enc = new TextEncoder();
  let n = 0;
  return {
    response: () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    /** @param {...any} events */
    say: (...events) => { for (const e of events) ctl.enqueue(enc.encode(`data: ${JSON.stringify({ n: ++n, at: NOW, ...e })}\n\n`)); },
    end: () => {
      ctl.enqueue(enc.encode(`data: ${JSON.stringify({ type: "ended", status: "done" })}\n\n`));
      ctl.close();
    },
  };
};
const SVG = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

after(() => {
  g.fetch = realFetch;
});

describe("what a helper drew, as the page reads it", () => {
  // (fails before: yes — a visual's event said only a turn: one the session keeps had no place)
  test("a run's visual kept on the session is said so in its round", () => {
    const a = alignEvents([{ n: 1, type: "visual", round: 1, id: "v1", title: "flow", bytes: 3, session: true }, { n: 2, type: "visual", round: 1, id: "v2", title: "map", bytes: 4, turn: 3 }]);
    assert.deepEqual(/** @type {any} */ (a.byRound.get(1)).visuals, [{ id: "v1", title: "flow", bytes: 3, session: true }, { id: "v2", title: "map", bytes: 4, turn: 3 }]);
  });

  // (fails before: yes — nothing read what a helper drew)
  test("the page's list says it while Filament holds the agent; else the chat's record: the launching turn's, then the session's, its own exchange alone", () => {
    const listed = [{ id: "v9", title: "listed", bytes: 1, session: /** @type {const} */ (true) }];
    const row = /** @type {any} */ ({ exchanges: [{ drew: listed }] });
    const chat = {
      turns: [
        { n: 3, visuals: [{ id: "a", title: "mine", bytes: 5, by: "sa_1", exchange: 0, at: 1 }, { id: "b", title: "the main agent's", bytes: 5 }, { id: "c", title: "another's", bytes: 5, by: "sa_2", exchange: 0 }, { id: "d", title: "my next exchange's", bytes: 5, by: "sa_1", exchange: 1 }] },
        { n: null, visuals: [{ id: "e", title: "a turn not numbered yet", bytes: 5, by: "sa_1", exchange: 0 }] },
      ],
      visuals: [{ id: "f", title: "kept on the session", bytes: 7, by: "sa_1", exchange: 0, at: 2 }],
    };
    assert.equal(drewIn(row, chat, "sa_1", 0), listed);
    assert.deepEqual(drewIn(null, chat, "sa_1", 0), [{ id: "a", title: "mine", bytes: 5, turn: 3 }, { id: "f", title: "kept on the session", bytes: 7, session: true }]);
    assert.deepEqual(drewIn(/** @type {any} */ ({ exchanges: [{}] }), chat, "sa_1", 1), [{ id: "d", title: "my next exchange's", bytes: 5, turn: 3 }], "a list that holds no drawing for it reads the record");
    assert.deepEqual(drewIn(null, {}, "sa_1", 0), []);
  });
});

describe("in the page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
    MutationObserver: class { observe() {} disconnect() {} },
    EventSource: class { close() {} },
    // The thread follows its run on the page's run socket, answered from the same stand-in routes.
    WebSocket: runSocketFromRoutes((path) => serve(path)),
    location: { protocol: "http:", host: "stand-in" },
    addEventListener: () => {},
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
  });
  beforeEach(() => {
    asked.length = 0;
  });

  describe("a helper's thread (VS-D49)", () => {
    /** Its parts in a page, as a host mounts them. @param {any} row */
    const mounted = (row) => {
      const conv = subagentConversation({ chainId: "c1", id: row.id, toast: () => {}, main: { state: () => "idle", outside: () => null, start: () => {}, write: () => {} } });
      const scroll = h("div", { class: "scroll" }, conv.body);
      const host = h("div", { class: "host" }, conv.head, scroll, conv.foot);
      doc.document.body.append(host);
      conv.mount(scroll);
      return { conv, body: /** @type {any} */ (conv.body) };
    };
    /** @param {any} body */
    const cards = (body) => body.querySelectorAll(".visual-card");

    // (fails before: yes — its run's visual events drew nothing in its thread)
    test("a picture it draws stands in its round after the calls: the card that said “Drawing…” is the one that opens it, read from the session that keeps it", async () => {
      const run = runStream();
      const row = agentRow("sa_1", { status: "running", card: { tag: "designer", name: "Designer", kind: "lead" }, exchanges: [{ prompt: "Draw a login screen.", description: "Draw a login screen.", by: "owner", runId: "run_1", status: "running", startedAt: NOW - 5_000, endedAt: null, delivery: null }] });
      serve = (url) => (url.startsWith("/api/sessions/c1/subagents/sa_1") ? json({ subagent: row }) : url.startsWith("/api/runs/run_1/events") ? run.response() : null);
      const { conv, body } = mounted(row);
      run.say(
        { type: "round-start", round: 1, blocksBefore: 0 },
        { type: "tool-start", round: 1, id: "toolu_dv", name: "show_visual", args: "login_wireframe", card: { kind: "visual", title: "Drawing", subject: "login_wireframe" } },
        { type: "visual-writing", round: 1, id: "toolu_dv", title: "login_wireframe", loading: ["Two layouts side by side"], chars: 1_200 },
      );
      await until(() => cards(body).length === 1, "the card that says it is drawing");
      const card = cards(body)[0];
      const round = body.querySelectorAll(".sav-round")[0];
      assert.equal(round.querySelector(".sav-pics .visual-card"), card, "in its round's pictures");
      const order = round.children.map((/** @type {any} */ k) => k.className.split(" ")[0]);
      assert.ok(order.indexOf("sav-tools") < order.indexOf("sav-pics"), `after the round's calls: ${order.join(", ")}`);
      assert.match(card.querySelector(".visual-writing").textContent, /^Drawing login_wireframe…Two layouts side by side1\.2k characters written$/);

      run.say(
        { type: "visual", round: 1, id: "toolu_dv", title: "login_wireframe", bytes: SVG.length, session: true },
        { type: "tool-end", round: 1, id: "toolu_dv", name: "show_visual", ok: true, ms: 4 },
        { type: "round-start", round: 2, blocksBefore: 1 },
        { type: "round-text", round: 2, text: "Layout A reads first." },
      );
      await until(() => asked.includes("/api/sessions/c1/visuals/toolu_dv"), "its code read from the session");
      assert.equal(cards(body).length, 1, "one card, never two");
      assert.equal(cards(body)[0], card, "the same card: a frame is never made twice");
      assert.equal(card.querySelector(".visual-title").textContent, "login_wireframe");
      assert.equal(body.querySelectorAll(".sav-round")[1].querySelectorAll(".visual-card").length, 0, "the round after it draws none");
      run.end();
      conv.close();
    });

    // (fails before: yes — a thread whose run's log was gone drew its report alone)
    test("a thread whose run's log is gone draws what the exchange says it drew, before its end, read from the turn that keeps it", async () => {
      const row = agentRow("sa_2", { exchanges: [{ prompt: "Map the flow.", description: "Map the flow.", by: "agent", runId: "run_2", status: "done", startedAt: NOW - 9_000, endedAt: NOW - 4_000, delivery: "tool", report: "Mapped.", drew: [{ id: "toolu_old", title: "old_flow", bytes: 9, turn: 3 }] }] });
      serve = (url) => (url.startsWith("/api/sessions/c1/subagents/sa_2") ? json({ subagent: row }) : url.startsWith("/api/runs/run_2/events") ? new Response("{}", { status: 404 }) : null);
      const { conv, body } = mounted(row);
      await until(() => cards(body).length === 1, "the picture it drew");
      const ex = body.querySelector(".sav-ex");
      const kids = ex.children;
      const card = cards(body)[0];
      const box = kids.findIndex((/** @type {any} */ k) => k.contains(card));
      assert.ok(box >= 0 && box < kids.findIndex((/** @type {any} */ k) => k.classList.contains("sav-end")), "before its end");
      assert.equal(ex.querySelectorAll(".sav-round").length, 0);
      assert.ok(asked.includes("/api/sessions/c1/turns/3/visuals/toolu_old"), asked.join(", "));
      conv.close();
    });

    // (fails before: yes — VS-D51)
    test("a picture's ask and its Tell write into the thread's own box where it has one, else the chat's: never sent (pinned in its source)", () => {
      const src = read("src/ui/harness/subagent-viewer.js");
      assert.match(src, /const writeIn = \(text\) => \{\n\s+if \(!sa \|\| noBoxWhy\(sa\)\) return main\.write\(text\);/);
      assert.match(src, /visualCard\(\{ id: vid, title \}, \{ onAsk: writeIn, onTell: writeIn \}\)/);
      assert.doesNotMatch(src.slice(src.indexOf("const writeIn"), src.indexOf("/** Its pictures' cards")), /sendFollowUp|routes\./, "it writes; only the person sends");
      const app = read("src/ui/harness/app.js");
      assert.match(app, /write: \(text\) => \{\n\s+composer\.add\(text\);/);
      assert.match(app, /chipActions\.visualWords = \(text\) => composer\.add\(text\);/);
    });
  });

  describe("the card that launched or asked it (VS-D50)", () => {
    /** @type {{ drew: any[], words: string[] }} */
    let page;
    beforeEach(() => {
      page = { drew: [], words: [] };
      Object.assign(chipActions, {
        cardMarks: () => ({}),
        subagentRow: () => null,
        subagentsKnown: () => false,
        subagentDelivery: () => "held",
        outsideClient: () => null,
        drewOf: (/** @type {string} */ id, /** @type {number} */ x) => (x === 0 && (id === "sa_9" || id === "sa_5") ? { chain: "c1", drew: page.drew } : null),
        visualWords: (/** @type {string} */ t) => page.words.push(t),
      });
    });
    after(() => {
      for (const k of ["cardMarks", "subagentRow", "subagentsKnown", "subagentDelivery", "outsideClient", "drewOf", "visualWords"]) /** @type {any} */ (chipActions)[k] = null;
    });
    /** Its answer's mark. @param {any} [o] */
    const back = (o = {}) => ({ type: "subagent", event: "arrival", agentId: "sa_9", exchange: 0, at: 1_000, afterTurn: 3, model: "zai/glm-5.3", card: { tag: "designer", name: "Designer" }, asked: true, question: "Draw a login screen.", status: "done", ms: 4_000, answer: "Layout A reads first.", delivery: "held", ...o });
    /** @param {any} row */
    const pills = (row) => row.querySelectorAll(".ask-card-drew-pic");
    /** @param {any} row */
    const drawnIds = (row) => row.querySelector(".ask-card-drawn").children.map((/** @type {any} */ k) => k.getAttribute("data-visual"));

    // (fails before: yes — the card said nothing of what its agent drew)
    test("a line names each picture once it drew; a click opens it under the card, in the order drawn; a second folds it, hidden and never made again; a card drawn anew keeps them", () => {
      /** @type {() => void} */
      let repaint = () => {};
      const row = /** @type {any} */ (agentCardRow(back(), { follow: (_row, onChange) => { repaint = onChange; }, now: () => 2_000 }));
      doc.document.body.append(row);
      assert.ok(row.querySelector(".ask-card-drew").classList.contains("hidden"), "nothing drawn, no line");

      page.drew = [{ id: "v1", title: "login_wireframe", bytes: 10, session: true }, { id: "v2", title: "flow", bytes: 5, turn: 3 }];
      repaint();
      const line = row.querySelector(".ask-card-drew");
      assert.equal(line.classList.contains("hidden"), false);
      assert.deepEqual([line.textContent, pills(row).map((/** @type {any} */ b) => b.getAttribute("aria-expanded"))], ["Drewlogin_wireframeflow", ["false", "false"]]);

      pills(row)[1].dispatch("click");
      assert.deepEqual(drawnIds(row), ["v2"]);
      assert.ok(asked.includes("/api/sessions/c1/turns/3/visuals/v2"), "read from the turn that keeps it");
      pills(row)[0].dispatch("click");
      assert.deepEqual(drawnIds(row), ["v1", "v2"], "in the order drawn, whichever opened first");
      assert.ok(asked.includes("/api/sessions/c1/visuals/v1"), "read from the session that keeps it");
      assert.deepEqual(pills(row).map((/** @type {any} */ b) => [b.getAttribute("aria-expanded"), b.classList.contains("is-open")]), [["true", true], ["true", true]]);

      const v1 = row.querySelector(".ask-card-drawn").children[0];
      pills(row)[0].dispatch("click");
      assert.ok(v1.classList.contains("hidden"), "folded: hidden");
      assert.equal(row.querySelector(".ask-card-drawn").children[0], v1, "not taken out: taken out it would draw again");
      pills(row)[0].dispatch("click");
      assert.equal(v1.classList.contains("hidden"), false);
      assert.equal(asked.filter((p) => p === "/api/sessions/c1/visuals/v1").length, 1, "opened again, never read again");

      // Its turn goes on and draws the card anew: the pictures opened stand under the new one, as they were.
      pills(row)[1].dispatch("click");
      const again = /** @type {any} */ (agentCardRow(back(), { now: () => 2_000 }));
      row.replaceWith(again);
      assert.deepEqual(drawnIds(again), ["v1", "v2"]);
      assert.equal(again.querySelector(".ask-card-drawn").children[0], v1);
      assert.deepEqual(pills(again).map((/** @type {any} */ b) => b.getAttribute("aria-expanded")), ["true", "false"]);
      again.remove();
    });

    // (fails before: yes — the agent tool's row said nothing of what its agent drew)
    test("Filament's own agent's row has the line under it, folded or not; its fold is still remembered", () => {
      page.drew = [{ id: "v5", title: "plan_map", bytes: 4, turn: 2 }];
      const stub = { id: "ag_5", name: "agent", state: "done", args: { description: "map the plan", prompt: "Map it." }, card: { kind: "subagent", title: "Agent", subject: "map the plan" }, sub: { agentId: "sa_5", exchange: 0, state: "done", status: "done", order: [], tools: new Map(), description: "map the plan", report: "Mapped." } };
      const cell = { round: 1, order: ["ag_5"], tools: new Map([["ag_5", stub]]), plan: null };
      const [row] = /** @type {any[]} */ (roundRows(/** @type {any} */ (cell)));
      assert.ok(row.classList.contains("sub-drew"), row.className);
      assert.deepEqual(row.children.map((/** @type {any} */ k) => k.tagName === "DETAILS" ? "details" : k.className.split(" ")[0]), ["details", "ask-card-drew", "ask-card-drawn", "ask-card-made"], "and the line of what it made (AFC-100)");
      assert.equal(row.querySelector(".ask-card-drew").textContent, "Drewplan_map");
      const det = row.children[0];
      // The person presses the row: a toggle the page made is not theirs to remember.
      det.querySelector("summary").dispatch("click");
      det.open = true;
      det.dispatch("toggle");
      const [redrawn] = /** @type {any[]} */ (roundRows(/** @type {any} */ (cell)));
      assert.equal(redrawn.children[0].open, true, "drawn anew, it stands open as it was left");
      // A coding agent's own helper is no agent of Filament's: no line.
      const own = { ...stub, id: "ag_6", sub: { ...stub.sub, agentId: undefined } };
      const [plain] = /** @type {any[]} */ (roundRows(/** @type {any} */ ({ round: 1, order: ["ag_6"], tools: new Map([["ag_6", own]]), plan: null })));
      assert.equal(plain.tagName, "DETAILS");
    });

    // (fails before: yes — a helper that drew stood inside its settled turn's folded work: you went looking, VS-D53)
    test("a settled turn draws a helper that drew apart from its folded work, as it does an agent it asked; one that drew nothing stays in the work", () => {
      page.drew = [{ id: "v5", title: "plan_map", bytes: 4, turn: 2 }];
      /** @param {string} id @param {string} agentId */
      const stubOf = (id, agentId) => ({ id, name: "agent", state: "done", args: { description: `task ${id}`, prompt: "Map it." }, card: { kind: "subagent", title: "Agent", subject: `task ${id}` }, sub: { agentId, exchange: 0, state: "done", status: "done", order: [], tools: new Map(), description: `task ${id}`, report: "Done." } });
      const cell = /** @type {any} */ ({ round: 1, order: ["ag_5", "ag_7"], tools: new Map([["ag_5", stubOf("ag_5", "sa_5")], ["ag_7", stubOf("ag_7", "sa_7")]]), plan: null });
      /** @param {any[]} rows */
      const lines = (rows) => rows.flatMap((r) => r.querySelectorAll(".ask-card-drew")).map((/** @type {any} */ l) => (l.classList.contains("hidden") ? "none" : l.textContent));
      assert.deepEqual(lines(roundRows(cell, { asksApart: true })), ["none"], "the folded work keeps the helper that drew nothing");
      assert.deepEqual(lines(askedRows([cell])), ["Drewplan_map"], "the one that drew stands apart");
      assert.deepEqual(lines(roundRows(cell)).sort(), ["Drewplan_map", "none"], "a live turn folds nothing: both stay in their round");
    });

    // (fails before: yes — VS-D51)
    test("a picture opened under a card writes its ask and its Tell into the message box (pinned in its source)", () => {
      const src = read("src/ui/harness/conversation/agent-card.js");
      assert.match(src, /const intoBox = \(text\) => chipActions\.visualWords\?\.\(text\);/);
      assert.match(src, /visualCard\(\{ id: d\.id, title: d\.title \}, \{ onAsk: intoBox, onTell: intoBox \}\)/);
    });
  });
});
