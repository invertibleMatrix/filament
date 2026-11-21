// An agent turn is one parent record (billed by its rounds: $0, its tokens the rounds' added up) and a record per
// round. The in-memory 24-hour summary and `/cost` counted both, so every agent turn read twice — "zeta-5 80.0k
// input, 4 requests" where three calls reached zeta-5 (the HarnessV3-FixRound backlog 20, seen on the Providers P4
// hand test). The durable daily store already skipped the parent.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { UsageStore } from "../src/usage.js";
import { chatRecordsOf } from "../src/app/commands/status.js";
import { answeredByFilament } from "../src/core/turn-facts.js";

const ok = { status: "ok", httpStatus: 200 };

describe("a turn's parent is no model call", () => {
  // (fails before: yes — requests 3 and input 400, the parent's own copy of its rounds' tokens counted again)
  test("the 24-hour summary counts the rounds once, and nothing for the parent", () => {
    const u = new UsageStore({ dataDir: ".", options: { logFile: "", broadcast: false, keepLastRequests: 20 } });
    const parent = u.start({ format: "anthropic", model: "zeta-5", upstream: "z", ua: "filament-harness" });
    for (const n of [120, 80]) {
      const round = u.start({ format: "anthropic", model: "zeta-5", upstream: "z", ua: "filament-agent/0.1" });
      round.agentOf = parent.id;
      u.finish(round, { ...ok, tokens: { input: n, output: 10 } }, {});
    }
    parent.agent = { rounds: 2, roundIds: [] };
    u.finish(parent, { ...ok, tokens: { input: 200, output: 20 } }, {});
    const s = u.summary(24 * 3600 * 1000);
    assert.equal(s.requests, 2);
    assert.equal(s.tokens.input, 200);
    assert.equal(s.byModel["zeta-5"].requests, 2);
    assert.equal(s.byModel["zeta-5"].input, 200);
    assert.deepEqual(Object.keys(s.byClient), ["filament-harness"], "the rounds are their turn's client's, and counted once");
    assert.equal(s.byClient["filament-harness"].requests, 2);
  });

  // (fails before: yes — HarnessV4_Tasks C7: By client read the user agent of each call alone, and Filament's own calls
  // reach its front door as `node`: the harness's sessions, every agent turn's rounds and every sub-agent's were one
  // client named "node")
  test("By client names who asked: a round is its turn's client's, a session's turn the harness's, never `node`", () => {
    const u = new UsageStore({ dataDir: ".", options: { logFile: "", broadcast: false, keepLastRequests: 50 } });
    /** A turn with one round under it, and a sub-agent's turn under that with a round of its own. @param {any} first */
    const turn = (first) => {
      const parent = u.start({ format: "anthropic", model: "zeta-5", upstream: "z", ...first });
      const round = u.start({ format: "anthropic", model: "zeta-5", upstream: "z", ua: "node" });
      round.agentOf = parent.id;
      const sub = u.start({ format: "anthropic", model: "zeta-5", upstream: "z", ua: "filament-subagent/0.1" });
      sub.subagentOf = parent.id;
      sub.agent = { rounds: 1, roundIds: [] };
      const subRound = u.start({ format: "anthropic", model: "zeta-5", upstream: "z", ua: "node" });
      subRound.agentOf = sub.id;
      for (const r of [round, subRound]) u.finish(r, { ...ok, tokens: { input: 10, output: 5 } }, {});
      parent.agent = { rounds: 1, roundIds: [] };
      for (const r of [sub, parent]) u.finish(r, { ...ok, tokens: { input: 10, output: 5 } }, {});
    };
    turn({ ua: "OpenCode/2.4 (win32)" });
    turn({ ua: "Mozilla/5.0 (Windows NT 10.0)", api: "session" });
    // A call of Filament's own that nothing kept began: a replay, or a round whose turn's record has gone.
    const lone = u.start({ format: "anthropic", model: "zeta-5", upstream: "z", ua: "node" });
    lone.agentOf = "req_gone";
    u.finish(lone, { ...ok, tokens: { input: 10, output: 5 } }, {});
    // And a tool's plain request, as before.
    u.finish(u.start({ format: "anthropic", model: "zeta-5", upstream: "z", ua: "claude-cli/2.1.0 (external)" }), { ...ok, tokens: { input: 10, output: 5 } }, {});
    const s = u.summary(24 * 3600 * 1000);
    assert.deepEqual(
      Object.fromEntries(Object.entries(s.byClient).map(([k, v]) => [k, /** @type {any} */ (v).requests])),
      { OpenCode: 2, "Filament harness": 2, "Filament (its own calls)": 1, "claude-cli": 1 },
    );
  });

  // (fails before: yes — the parent shares the chat id with its rounds)
  test("/cost's chat: the rounds, oldest first, without their parent", () => {
    const at = (/** @type {number} */ s) => new Date(1_790_000_000_000 + s * 1000).toISOString();
    const recs = [
      { id: "p", status: "ok", clientSession: "c1", ts: at(0), agent: { rounds: 2 } },
      { id: "r2", status: "ok", clientSession: "c1", ts: at(2), agentOf: "p" },
      { id: "r1", status: "ok", clientSession: "c1", ts: at(1), agentOf: "p" },
      { id: "x", status: "ok", clientSession: "c2", ts: at(4) },
      { id: "e", status: "error", clientSession: "c1", ts: at(5) },
    ];
    assert.deepEqual(chatRecordsOf(recs, "c1").map((r) => r.id), ["r1", "r2"]);
    assert.deepEqual(chatRecordsOf(recs, null, Date.parse(at(10))).map((r) => r.id), ["r1", "r2", "x"], "no chat id: the last 24 hours, parents left out the same way");
  });

  // A harness turn carries no client id; its session is known by its chain (HarnessV3-FixRound decision 3).
  test("/cost's chat with no client id but a known session: the records that book on that session", () => {
    const at = (/** @type {number} */ s) => new Date(1_790_000_000_000 + s * 1000).toISOString();
    const recs = [
      { id: "p", status: "ok", ts: at(0), agent: { rounds: 1 }, chain: "s1" },
      { id: "r1", status: "ok", ts: at(1), chain: "s1" },
      { id: "set", status: "ok", ts: at(2), chain: "s1", local: true },
      { id: "other", status: "ok", ts: at(3), chain: "s2" },
      { id: "none", status: "ok", ts: at(4), chain: null },
    ];
    const chainOf = (/** @type {any} */ r) => r.chain;
    assert.deepEqual(chatRecordsOf(recs, null, Date.parse(at(10)), { chainId: "s1", chainOf }).map((r) => r.id), ["r1", "set"]);
    assert.deepEqual(chatRecordsOf(recs, "c9", Date.parse(at(10)), { chainId: "s1", chainOf }).map((r) => r.id), [], "a client id still wins");
    assert.equal(answeredByFilament(recs[2]), true);
    assert.equal(answeredByFilament({ memory: { command: true } }), true, "a command's turn of the loop");
    assert.equal(answeredByFilament(recs[1]), false);
  });
});
