// @ts-check
// What each context view would hand a sub-agent (`GET /sessions/:id/subagents/views`, http/admin/sessions.js), the
// route alone, its service stood in. The slowness of 11-01: its two changes — the last turn's and the folder's whole
// uncommitted change, each read from git, measured at 1.6–4.6 s on the owner's live Filament — were read one after the
// other, and after the views' composes. They are read side by side, started before the composes, and what it answers
// stays the same.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionRoutes } from "../src/http/admin/sessions.js";
import { createRouter } from "../src/http/router.js";
import { estimateTokens } from "../src/core/tokens.js";

class FakeRes {
  status = 0;
  body = "";
  headersSent = false;
  writableEnded = false;
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

const later = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The route over a service whose reads each take a while, every read's start and end in order.
 * @param {string} query
 */
async function viewsWith(query) {
  /** @type {string[]} */
  const steps = [];
  /** @param {string} what @param {number} ms @param {any} value */
  const read = async (what, ms, value) => {
    steps.push(`${what} starts`);
    await later(ms);
    steps.push(`${what} ends`);
    return value;
  };
  const sessions = {
    /** @param {string} id @param {string | null} form @param {any} [o] */
    contextView: (id, form, o = {}) =>
      form
        ? read(`compose ${form}`, 30, { text: "folded words" })
        : o.changes === "uncommitted"
          ? read("uncommitted change", 80, { changes: { text: "diff --git a/x b/x", files: 3 } })
          : read("turn change", 80, { running: o.running ? { run: "run_1", text: "working", rounds: 2, tools: 5 } : null, changes: o.changes ? { text: "diff --git a/y b/y", files: 1, note: "turn 4" } : null }),
    windowView: () => read("compose window", 30, { text: "the whole window as it stands" }),
  };
  const subagents = { cacheOf: () => ({ tokens: 1234, forkable: true, model: "brain-model", state: "warm" }), liveMessages: () => null };
  const m = createRouter(sessionRoutes(/** @type {any} */ ({ memory: {}, usage: {}, ops: {}, sessions, subagents, config: { get: () => ({}) } })))("GET", "/sessions/c1/subagents/views");
  assert.ok(m, "the route has a row");
  const res = new FakeRes();
  const url = new URL(`http://127.0.0.1/sessions/c1/subagents/views${query}`);
  await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "GET", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url, path: url.pathname, method: "GET", params: m.params }), /** @type {any} */ ({}));
  assert.equal(res.status, 200, res.body);
  return { steps, body: JSON.parse(res.body) };
}

// (fails before: yes — the uncommitted change was read once the turn's had ended, both once the composes had)
test("the two changes are read side by side, started before the views' composes, and the answer is the same", async () => {
  const { steps, body } = await viewsWith("");
  const at = (/** @type {string} */ s) => steps.indexOf(s);
  assert.ok(at("uncommitted change starts") < at("turn change ends"), steps.join(", "));
  assert.ok(at("turn change starts") < at("compose fold ends") && at("uncommitted change starts") < at("compose fold ends"), steps.join(", "));
  const t = estimateTokens;
  assert.deepEqual(body.tokens, { none: 0, folded: t("folded words"), window: t("the whole window as it stands"), fork: 1234 });
  assert.deepEqual(body.fork, { available: true, model: "brain-model", state: "warm" });
  assert.deepEqual(body.running, { run: "run_1", tokens: t("working"), rounds: 2, calls: 5 });
  assert.deepEqual(body.changes, { turn: { tokens: t("diff --git a/y b/y"), files: 1, note: "turn 4" }, uncommitted: { tokens: t("diff --git a/x b/x"), files: 3 } });
  assert.equal(body.chainId, "c1");
});

// (fails before: yes — each read composed the history again, the two the Sub Agents tab asks at once included)
test("two reads of one chat's sizes at once compose its history once, and answer the same; a read after them, or of another chat, composes its own", async () => {
  /** @type {string[]} */
  const composed = [];
  const sessions = {
    /** @param {string} id @param {string | null} form @param {any} [o] */
    contextView: async (id, form, o = {}) => {
      if (form) composed.push(`${id} ${form}`);
      await later(20);
      return form ? { text: `folded ${id}` } : { running: o.running ? { run: "run_1", text: "working", rounds: 2, tools: 5 } : null, changes: null };
    },
    /** @param {string} id */
    windowView: async (id) => {
      composed.push(`${id} window`);
      await later(20);
      return { text: `the window of ${id}` };
    },
  };
  const subagents = { cacheOf: () => ({ tokens: 7, forkable: false, model: null, state: "none" }), liveMessages: () => null };
  const route = createRouter(sessionRoutes(/** @type {any} */ ({ memory: {}, usage: {}, ops: {}, sessions, subagents, config: { get: () => ({}) } })));
  const ask = async (/** @type {string} */ chain, /** @type {string} */ query) => {
    const m = /** @type {any} */ (route("GET", `/sessions/${chain}/subagents/views`));
    const res = new FakeRes();
    const url = new URL(`http://127.0.0.1/sessions/${chain}/subagents/views${query}`);
    await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "GET", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url, path: url.pathname, method: "GET", params: m.params }), /** @type {any} */ ({}));
    assert.equal(res.status, 200, res.body);
    return JSON.parse(res.body).tokens;
  };
  const [lean, whole, other] = await Promise.all([ask("c1", "?changes=0"), ask("c1", ""), ask("c2", "?changes=0")]);
  assert.deepEqual(composed.sort(), ["c1 fold", "c1 window", "c2 fold", "c2 window"]);
  assert.deepEqual(lean, whole);
  assert.deepEqual(lean, { none: 0, folded: estimateTokens("folded c1"), window: estimateTokens("the window of c1"), fork: 7 });
  assert.equal(other.folded, estimateTokens("folded c2"));
  await ask("c1", "?changes=0");
  assert.equal(composed.filter((c) => c === "c1 fold").length, 2, "a read after the first answered composes afresh");
});

test("asked without the changes, no git is read: the running turn alone beside the views", async () => {
  const { steps, body } = await viewsWith("?changes=0");
  assert.ok(!steps.includes("uncommitted change starts"));
  assert.equal(body.changes, null);
  assert.deepEqual(body.running, { run: "run_1", tokens: estimateTokens("working"), rounds: 2, calls: 5 });
});
