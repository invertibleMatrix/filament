// @ts-check
// The session's Stop (`POST /sessions/:id/stop`, http/admin/sessions.js) is the harness's: it stops the turn the lock
// names as the harness's, and nothing else — another window's turn, a chat's move and no turn at all reach none. Where
// the harness's turn has not named its request yet, the runs it stops are the session's running turns that are the
// harness's own requests, never an outside client's coding-agent run still running in the session. The route alone,
// its parts stood in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionRoutes } from "../src/http/admin/sessions.js";
import { createRouter } from "../src/http/router.js";

class FakeRes {
  status = 0;
  body = "";
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  setHeader() {}
  getHeader() {}
  /** @param {number} s */
  writeHead(s) {
    this.status = s;
    this.headersSent = true;
    return this;
  }
  /** @param {string} c */
  write(c) {
    this.body += c;
  }
  end(c = "") {
    this.body += c;
    this.writableEnded = true;
  }
  on() {}
}

/**
 * The Stop route over stood-in parts: who holds the session's lock, the session's running turns with their records'
 * `api`, whether the session is the harness's own (`native`), and what the route did to them.
 * @param {any} holder @param {{ id: string, api?: string }[]} running @param {{ native?: boolean }} [o]
 */
const stopRoute = (holder, running, { native = true } = {}) => {
  /** @type {string[]} */
  const steered = [];
  /** @type {string[]} */
  const forced = [];
  /** @type {string[]} */
  const cancelled = [];
  /** Any mark of a turn to be stopped later: the lock's or memory's. @type {string[]} */
  const marked = [];
  /** The chats whose newest turn the stop marked as the last stopped (FO-D50). @type {string[]} */
  const lastStop = [];
  const a = {
    memory: {
      archive: { chainHead: (/** @type {string} */ id) => (id === "c1" ? { id: "c1", key: "k1", native } : null) },
      markLastStop: (/** @type {string} */ id) => void lastStop.push(id),
      markPendingStop: (/** @type {string} */ id) => void marked.push(`pending ${id}`),
    },
    sessions: { cancelTurn: (/** @type {string} */ id) => (cancelled.push(id), true) },
    sessionTurns: { holder: () => holder, stop: (/** @type {string} */ key) => (marked.push(`lock ${key}`), holder), loopsOf: () => [] },
    runs: {
      runningIn: () => running.map((r) => ({ id: r.id, kind: "coding-agent", endedAt: null, meta: { chain: "c1" } })),
      steer: (/** @type {string} */ id) => (steered.push(id), { ok: true }),
      force: (/** @type {string} */ id) => (forced.push(id), { ok: true }),
    },
    usage: { byId: new Map(running.map((r) => [r.id, { id: r.id, ...(r.api ? { api: r.api } : {}) }])) },
    config: { get: () => ({}) },
  };
  const route = createRouter(sessionRoutes(a));
  /** @param {any} [body] */
  const press = async (body = {}) => {
    const m = route("POST", "/sessions/c1/stop");
    assert.ok(m, "the stop has its row");
    const res = new FakeRes();
    await m.handler({ req: { headers: {}, method: "POST", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url: new URL("http://x/sessions/c1/stop"), path: "/sessions/c1/stop", method: "POST", params: m.params, json: async () => body }, a);
    assert.equal(res.status, 200, res.body);
    return JSON.parse(res.body);
  };
  return { press, steered, forced, cancelled, marked, lastStop };
};

// (fails before: yes — on b4ee117a2 the harness's turn with no request id out steered every turn running in the session,
// an outside client's coding-agent run among them: `runs` named both)
test("a harness turn whose request id is not out: the stop steers the session's runs that are the harness's own requests, never an outside client's", async () => {
  const harness = { window: "harness", client: "harness", requestId: null };
  const r = stopRoute(harness, [{ id: "own", api: "session" }, { id: "outside" }]);
  assert.deepEqual(await r.press(), { ok: true, holder: harness, stopped: "steered", runs: ["own"] });
  assert.deepEqual([r.steered, r.cancelled], [["own"], []], "the outside client's run took no steer");
  const f = stopRoute(harness, [{ id: "outside" }, { id: "own", api: "session" }]);
  assert.deepEqual(await f.press({ force: true }), { ok: true, holder: harness, stopped: "forced", runs: ["own"] });
  assert.deepEqual([f.forced, f.steered], [["own"], []], "nor a force");
  // An outside client's run alone: none of the harness's to stop, so the harness's turn — still composing — is cancelled
  const c = stopRoute(harness, [{ id: "outside" }]);
  assert.deepEqual(await c.press(), { ok: true, holder: harness, stopped: "cancelled" });
  assert.deepEqual([c.steered, c.cancelled], [[], ["c1"]]);
});

// (fails before: yes — on b4ee117a2 the stop marked another window's turn, and a chat's move, to be stopped — the lock's
// `stop` and memory's pending stop — answering with their holder, and with no holder it steered the session's running
// turns, or left a pending stop where none ran)
test("another window's turn, a chat's move, and no turn at all: the stop reaches none, and steers, forces, cancels and marks no turn to stop later", async () => {
  for (const [holder, running] of /** @type {[any, { id: string, api?: string }[]][]} */ ([
    [{ window: "h:opencode", client: "opencode", requestId: "r9" }, [{ id: "outside" }]],
    [{ window: "move", client: "move", requestId: null }, []],
    [null, [{ id: "outside" }]],
    [null, []],
  ])) {
    const r = stopRoute(holder, running);
    const what = JSON.stringify([holder, running]);
    assert.deepEqual(await r.press(), { ok: true, holder: null, stopped: null }, what);
    assert.deepEqual(await r.press({ force: true }), { ok: true, holder: null, stopped: null }, `${what}, with force`);
    assert.deepEqual([r.steered, r.forced, r.cancelled, r.marked], [[], [], [], []], what);
    // (fails before: no — a guard: FO-D50's hold-back of Filament's own turns on the harness's chat)
    assert.deepEqual(r.lastStop, ["c1", "c1"], `${what}: Filament starts no turn of its own here until a newer one begins`);
  }
});

// (fails before: yes — on e7f453755 a stop pressed on a client's chat marked its newest turn as the last stopped, so the
// chat's facts called a turn that ran to its end stopped)
test("a client's chat: the stop reaches none and marks nothing of it, its client's turn running or not", async () => {
  for (const holder of [{ window: "h:opencode", client: "opencode", requestId: "r9" }, null]) {
    const r = stopRoute(holder, [{ id: "outside" }], { native: false });
    assert.deepEqual(await r.press(), { ok: true, holder: null, stopped: null });
    assert.deepEqual(await r.press({ force: true }), { ok: true, holder: null, stopped: null });
    assert.deepEqual([r.steered, r.forced, r.cancelled, r.marked, r.lastStop], [[], [], [], [], []], JSON.stringify(holder));
  }
});
