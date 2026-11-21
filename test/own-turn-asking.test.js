// @ts-check
// A coding agent's own turn (HarnessV3-ACP AC3-9) never lands between a question and its answer (the decision of
// 11-02): a chat that moved from Claude Code to Filament's loop, whose turn paused on a question while Claude's
// background task ran, gets Claude's own turn once the answer's turn has ended. Filament's door refuses the turn while
// the question waits, saying so, and its asker (app/own-turns.js) waits for a turn of the chat to come and go — never
// asking again at once, as it does for a session that is merely free.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply, FAKE_ACP_AGENT } from "./helpers/app.js";
import { until, removeDirs } from "./helpers/wait.js";
import { wireOwnTurns } from "../src/app/own-turns.js";
import { SessionTurns } from "../src/services/session-turns.js";
import { PAUSE_TTL_MS } from "../src/app/agent/turn.js";

/** @param {any[]} blocks @param {string} [stop] */
const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** The command a loop turn asks permission for in Edit. */
const CHECK = { type: "tool_use", id: "c1", name: "bash", input: { command: `node -e "console.log('checked')"` } };
/** The calls a request's newest message answers. @param {any} call */
const answersTo = (call) => (Array.isArray(call.body?.messages?.at(-1)?.content) ? call.body.messages.at(-1).content : []).filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id);
/** The text of a message. @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));

describe("a coding agent's own turn while a question waits for the person's answer", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-own-asking-"));
  const projDir = join(root, "project");
  /** The bridge's asks for an own turn: those of the chat `hold` names wait in `held`; the rest go on. @type {{ hold: string, held: any[], real: (cycle: any) => void }} */
  const asks = { hold: "", held: [], real: () => {} };
  before(async () => {
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    up = await fakeUpstream(async (call) => (answersTo(call).includes("c1") ? reply([{ type: "text", text: "The check printed checked." }]) : reply([CHECK], "tool_use")));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "claude", name: "Claude Code", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1" }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
        ];
        cfg.routes = [
          { match: "claude/*", upstream: "claude", upstreamModel: "{1}", enabled: true },
          { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true },
        ];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
    const acp = /** @type {any} */ (shim.app).acp;
    asks.real = acp.onOwnCycle;
    acp.onOwnCycle = (/** @type {any} */ cycle) => (cycle.chain === asks.hold ? void asks.held.push(cycle) : asks.real(cycle));
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, root);
  });
  /**
   * @param {string} id @param {string} content @param {boolean} [page]  sent as the page sends one, its run's events on
   * @param {boolean} [asIs]  the switch card's Send as it is
   */
  const turn = async (id, content, page = false, asIs = false) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { ...(page ? { content, stream: true, runEvents: true } : { content, stream: false }), ...(asIs ? { sendAsIs: true } : {}) } });
    assert.equal(r.status, 200, await r.clone().text());
    return page ? (await r.text(), "") : textOf(await r.json());
  };
  /** @param {string} id */
  const transcript = async (id) => (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();

  // (fails before: yes — the door ran Claude's own turn at once: it stood between the loop's question and its answer)
  test("Claude's own turn waits for the answer's turn to end, then comes after it", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "claude/haiku", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    // Claude starts a task in the background; its end comes after the turn, and Claude answers it in a cycle of its own,
    // which asks for a turn of the chat.
    asks.hold = id;
    await turn(id, "~wake please", true);
    const [cycle] = /** @type {any[]} */ (await until(() => (asks.held.length ? asks.held.splice(0) : null), "Claude's cycle asking for its turn"));
    asks.hold = "";
    // The chat moves to Filament's loop, whose turn pauses on its question.
    const moved = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { model: { name: "agent/brain-model" } } } });
    assert.equal(moved.status, 200, await moved.clone().text());
    assert.match(await turn(id, "run the check", false, true), /May I run this command\?/);
    assert.equal((await transcript(id)).paused?.kind, "permission");
    // Claude's turn is asked for while the question waits: the door refuses it, and the asker waits.
    const turns = /** @type {any} */ (shim.app).sessionTurns;
    const subscribe = turns.onChange.bind(turns);
    let waits = 0;
    turns.onChange = (/** @type {string} */ key, /** @type {any} */ fn) => {
      waits++;
      const un = subscribe(key, fn);
      return () => (waits--, un());
    };
    try {
      asks.real(cycle);
      const ownTurns = async () => (await transcript(id)).turns.filter((/** @type {any} */ t) => t.own).length;
      await until(async () => waits > 0 || (await ownTurns()) > 0, "Claude's turn, or its wait");
      assert.equal(await ownTurns(), 0, "no turn of Claude's own between the question and its answer");
      assert.equal(waits, 1, "its asker waits");
      // Answered, the loop's turn ends; Claude's own turn comes after it.
      assert.equal(await turn(id, "yes"), "The check printed checked.");
      const tr = await until(async () => {
        const t = await transcript(id);
        return t.turns.length === 4 && t.turns.every((/** @type {any} */ x) => x.final) && !t.live ? t : null;
      }, "Claude's own turn after the answer's");
      assert.deepEqual(tr.turns.map((/** @type {any} */ t) => (t.own ? "own" : textOf(t.user))), ["~wake please", "run the check", "yes", "own"]);
      assert.equal(waits, 0, "and its wait is over");
    } finally {
      turns.onChange = subscribe;
    }
  });

  // A lapse is the question ending (the decision of 11-02): what waits on it goes when it lapses, as when it is answered.
  // (fails before: yes — Claude's turn waited for a turn of the chat, which never came: no turn of its own after the
  // question lapsed)
  test("the question lapses unanswered: Claude's own turn comes then, with no answer's turn", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "claude/haiku", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    asks.hold = id;
    await turn(id, "~wake please", true);
    const [cycle] = /** @type {any[]} */ (await until(() => (asks.held.length ? asks.held.splice(0) : null), "Claude's cycle asking for its turn"));
    asks.hold = "";
    const moved = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { model: { name: "agent/brain-model" } } } });
    assert.equal(moved.status, 200, await moved.clone().text());
    assert.match(await turn(id, "run the check", false, true), /May I run this command\?/);
    // The question near the end of its time: asked six hours ago but a moment.
    const archive = /** @type {any} */ (shim.app).memory.archive;
    const stored = archive.metaOf(id, ["paused"]).paused;
    archive.mergeMeta(id, { paused: { ...stored, at: Date.now() - PAUSE_TTL_MS + 800, expires: Date.now() + 800 } });
    asks.real(cycle);
    const tr = await until(async () => {
      const t = await transcript(id);
      return t.turns.length === 3 && t.turns.every((/** @type {any} */ x) => x.final) && !t.live ? t : null;
    }, "Claude's own turn once the question lapsed");
    assert.deepEqual(tr.turns.map((/** @type {any} */ t) => (t.own ? "own" : textOf(t.user))), ["~wake please", "run the check", "own"]);
    assert.equal(tr.paused, null);
  });
});

describe("the asker of an own turn, told a question waits (app/own-turns.js)", () => {
  // (fails before: yes — it asked again at once, the session being free: the door's refusal and its ask went round
  // without end while the question waited)
  test("it asks again only once a turn of the chat has come and gone", async () => {
    /** The door's answers, in order; then 200. @type {{ status: number, body?: any }[]} */
    const answers = [{ status: 409, body: { error: "a question waits for the person's answer: the agent's own turn goes once the answer's turn ends", busy: true, asking: true } }];
    let heard = 0;
    const door = createServer(async (req, res) => {
      for await (const _ of req);
      heard++;
      const a = answers.shift() ?? { status: 200 };
      res.writeHead(a.status, { "content-type": "application/json" });
      res.end(JSON.stringify(a.body ?? { ok: true }));
    });
    await new Promise((r) => door.listen(0, "127.0.0.1", () => r(undefined)));
    try {
      const port = /** @type {import("node:net").AddressInfo} */ (door.address()).port;
      const turns = new SessionTurns();
      /** @type {string[]} */
      const told = [];
      /** @type {any} */
      const bridge = { onOwnCycle: null, ownAgain: (/** @type {string} */ s) => told.push(`again ${s}`), declineOwn: (/** @type {string} */ s, /** @type {string} */ why) => told.push(`decline ${s}: ${why}`) };
      wireOwnTurns(bridge, { base: () => `http://127.0.0.1:${port}`, log: () => {}, sessionTurns: turns, chainKeyOf: (chain) => `key-${chain}`, questionOver: () => () => {} });
      bridge.onOwnCycle({ upstreamId: "claude", sessionId: "s1", chain: "c1", model: "claude/haiku", tasks: [] });
      await until(() => heard === 1, "the door's refusal");
      await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(told, [], "not while the question waits, though nobody holds the session");
      // The answer's turn comes and goes.
      const answer = await turns.acquire("key-c1", { window: "harness", client: "harness" });
      await new Promise((r) => setImmediate(r));
      assert.deepEqual(told, [], "not while the answer's turn runs");
      turns.release("key-c1", /** @type {string} */ (answer.token));
      await until(() => told.length === 1, "the ask again");
      assert.deepEqual([told, heard], [["again s1"], 1]);
    } finally {
      await new Promise((r) => door.close(() => r(undefined)));
    }
  });

  // (fails before: yes — it waited for a turn of the chat alone, never for the question's end: timed out waiting for its
  // wait on it, and a question that ended with no answer's turn — out of time, taken away by a rewind — asked nothing
  // again)
  test("it asks again once the question ends with no answer's turn: out of time, or taken away", async () => {
    let heard = 0;
    const door = createServer(async (req, res) => {
      for await (const _ of req);
      heard++;
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "a question waits for the person's answer", busy: true, asking: true }));
    });
    await new Promise((r) => door.listen(0, "127.0.0.1", () => r(undefined)));
    try {
      const port = /** @type {import("node:net").AddressInfo} */ (door.address()).port;
      /** What waits for each chat's question to end. @type {Map<string, Set<() => void>>} */
      const over = new Map();
      /** @param {string} chain */
      const end = (chain) => [...(over.get(chain) || [])].forEach((fn) => fn());
      /** @type {string[]} */
      const told = [];
      /** @type {any} */
      const bridge = { onOwnCycle: null, ownAgain: (/** @type {string} */ s) => told.push(`again ${s}`), declineOwn: (/** @type {string} */ s, /** @type {string} */ why) => told.push(`decline ${s}: ${why}`) };
      wireOwnTurns(bridge, {
        base: () => `http://127.0.0.1:${port}`,
        log: () => {},
        sessionTurns: new SessionTurns(),
        chainKeyOf: (chain) => `key-${chain}`,
        questionOver: (chain, fn) => {
          const set = over.get(chain) || over.set(chain, new Set()).get(chain);
          /** @type {Set<() => void>} */ (set).add(fn);
          return () => void over.get(chain)?.delete(fn);
        },
      });
      bridge.onOwnCycle({ upstreamId: "claude", sessionId: "s1", chain: "c1", model: "claude/haiku", tasks: [] });
      await until(() => heard === 1 && over.get("c1")?.size === 1, "the door's refusal, and the wait");
      end("c2");
      await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(told, [], "another chat's question ending is nothing to it");
      end("c1");
      await until(() => told.length === 1, "the ask again");
      assert.deepEqual([told, over.get("c1")?.size], [["again s1"], 0], "asked again, its wait let go");
    } finally {
      await new Promise((r) => door.close(() => r(undefined)));
    }
  });
});
