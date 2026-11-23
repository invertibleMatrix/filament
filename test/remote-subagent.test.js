// @ts-check
// A sub-agent on another machine (the remote-agents plan's s-launch): the agent tool's `machine` sends its task to a
// machine this Filament keeps an agents' device for, and its report comes back as a local sub-agent's does. Two real
// Filaments (helpers/two-machines.js): `here`'s full device mints the agents' device on `there`, whose own computer
// switches its grant on; `here` keeps the token in its own remotes.json, as the desktop app does (services/machines
// `keep`). The project is one repository on both — the same origin URL —, cloned twice on `there` (main and a feature
// branch), each a folder of a chat the person started there. The agent tool's launch is called as a turn's loop calls
// it (`openTurn(…).subagents.run`), with the tool's schema as it stands: the next task adds `machine` to its words.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTwoMachines } from "./helpers/two-machines.js";
import { anthropicReply, anthropicStream, fakeUpstream } from "./helpers/app.js";
import { pinnedFetch } from "../src/services/machines/pinned.js";
import { createMachines } from "../src/services/machines/index.js";
import { CliError, clientAt } from "../src/services/machines/client.js";
import { houseAuth } from "../src/services/house.js";
import { createRemoteAgents, SEND_COPY, STREAM_IDLE_MS, modelThere, repoKeyOf } from "../src/app/agent/remote-agents.js";
import { createSubagentRegistry, mirrorEvents } from "../src/app/agent/subagents.js";

const JSON_TYPE = { "content-type": "application/json" };
const ORIGIN = "https://github.com/acme/widgets.git";
/** Filament's own loop on the model, so the chat there runs a turn with its run's events. */
const MODEL = "agent/m-1";

/** The words of a message, its blocks joined. @param {any} m */
const wordsOf = (m) => (typeof m?.content === "string" ? m.content : (Array.isArray(m?.content) ? m.content : []).map((/** @type {any} */ b) => b?.text ?? "").join("\n"));
/** git in a folder, as a person types it, its commits by a test's name. @param {string} cwd @param {string[]} args */
const gitIn = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
/** Waits until `ok()` holds, asking every 50 ms, for `ms` at most. @param {() => boolean | Promise<boolean>} ok @param {string} what */
const until = async (ok, what, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`waited ${ms} ms for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
/** A folder as the filesystem names it, in one case on Windows. @param {string} p */
const real = (p) => {
  const r = realpathSync.native(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? r.toLowerCase() : r;
};
/** A port nothing listens at. */
const deadPort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = /** @type {net.AddressInfo} */ (s.address()).port;
      s.close(() => resolve(port));
    });
  });

/** One machine kept for the agents, "Box", whose admin API is `client`. @param {any} client */
const oneMachine = (client) => {
  const m = { machine: { id: "m1" }, name: "Box", device: { scope: "agent" } };
  return /** @type {any} */ ({ list: () => [m], find: () => m, clientOf: async () => client });
};
/** A chat on Box, before its first turn. @returns {import("../src/app/agent/remote-agents.js").RemoteChat} */
const onBox = () => ({ machine: { id: "m1", name: "Box" }, cwd: "/w", chat: null, model: null, effort: null });
/** A run's event on a turn's stream, as the other Filament sends it. @param {any} event @returns {[string, any]} */
const runEvent = (event) => ["message", { type: "filament_run", event: { runId: "r1", ...event } }];

// (fails before: yes — "unknown" and "budget-stopped" came back as statuses of their own, neither done nor failed, and a
// stop there read "it ended stopped")
test("a turn there that ends other than done fails, in words that say what happened there; one stopped there is stopped", async () => {
  for (const [status, words, want = "failed"] of /** @type {[string, RegExp, string?][]} */ ([
    ["unknown", /^Filament on Box restarted while it ran, and its turn there was cut$/],
    ["budget-stopped", /^it reached its budget on Box$/],
    ["error", /^it failed on Box: the model said no$/],
    ["stopped", /^stopped on Box, by someone there$/, "aborted"],
  ])) {
    const client = {
      post: async () => ({ id: "c1", model: "m-1" }),
      stream: async (/** @type {string} */ _p, /** @type {any} */ _b, /** @type {(e: string, d: any) => void} */ onEvent) => onEvent(...runEvent({ n: 1, type: "round-start", round: 1 })),
      // The stream ended with its run open: its run's events say how it ended, as runs.js keeps it.
      get: async () => ({ events: [], run: { endedAt: 1, status, summary: status === "error" ? { error: "the model said no" } : {} } }),
    };
    const fin = await createRemoteAgents({ machines: oneMachine(client), wait: async () => {} }).turn(onBox(), { content: [{ type: "text", text: "go" }], signal: new AbortController().signal });
    assert.equal(fin.status, want, status);
    assert.match(String(fin.error), words);
  }
});

// (fails before: yes — the turn's stream took no idle time: a network that dropped without a word held it open for good)
test("a turn's stream that goes silent is let go of, and its run's events are read from where it stopped", async () => {
  /** @type {any} */
  let asked = null;
  const client = {
    post: async () => ({ id: "c1", model: "m-1" }),
    stream: async (/** @type {string} */ _p, /** @type {any} */ _b, /** @type {(e: string, d: any) => void} */ onEvent, /** @type {any} */ o) => {
      asked = o;
      onEvent(...runEvent({ n: 1, type: "round-start", round: 1 }));
      throw Object.assign(new Error("nothing came for 45 s"), { idle: true });
    },
    get: async (/** @type {string} */ path) => {
      assert.match(path, /^\/runs\/r1\/events\?since=1$/);
      return { events: [{ runId: "r1", n: 2, type: "round-text", round: 1, text: "WORDS THERE" }, { runId: "r1", n: 3, type: "run-end", status: "done", summary: { rounds: 1 } }] };
    },
  };
  const fin = await createRemoteAgents({ machines: oneMachine(client), wait: async () => {} }).turn(onBox(), { content: [{ type: "text", text: "go" }], signal: new AbortController().signal });
  assert.equal(asked?.idleMs, STREAM_IDLE_MS);
  assert.ok(STREAM_IDLE_MS >= 45_000, "three of the other Filament's 15 s pings missed");
  assert.deepEqual([fin.status, fin.report], ["done", "WORDS THERE"]);

  // The client's stream itself: silent past its idle time after one event, it ends with an idle error.
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ type: "ping" })}\n\n`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(null)));
  try {
    const url = `http://127.0.0.1:${/** @type {net.AddressInfo} */ (server.address()).port}`;
    /** @type {any[]} */
    const seen = [];
    const out = await Promise.race([
      clientAt(url, {}, fetch).stream("/turns", {}, (_e, d) => seen.push(d), { idleMs: 1000 }).then(() => "ended", (/** @type {any} */ e) => e),
      new Promise((resolve) => setTimeout(() => resolve("still open after 5 s"), 5000).unref()),
    ]);
    assert.ok(out instanceof Error && /** @type {any} */ (out).idle, String(out));
    assert.match(out.message, /^nothing came from http:\/\/127\.0\.0\.1:\d+ for 1 s$/);
    assert.deepEqual(seen.map((d) => d.type), ["ping"]);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

// (fails before: yes — the reply's words were read for its report alone: nothing here heard them as they came)
test("a turn there hands on its words and its thinking as the reply streams them, each block's end with them", async () => {
  /** @type {any[]} */
  const heard = [];
  /** @param {any} delta @returns {[string, any]} */
  const delta = (delta) => ["content_block_delta", { type: "content_block_delta", index: 0, delta }];
  /** @returns {[string, any]} */
  const stop = () => ["content_block_stop", { type: "content_block_stop", index: 0 }];
  const client = {
    post: async () => ({ id: "c1", model: "m-1" }),
    stream: async (/** @type {string} */ _p, /** @type {any} */ _b, /** @type {(e: string, d: any) => void} */ onEvent) => {
      onEvent(...runEvent({ n: 1, type: "round-start", round: 1, blocksBefore: 0 }));
      onEvent(...delta({ type: "thinking_delta", thinking: "weighing" }));
      onEvent(...delta({ type: "signature_delta", signature: "sig" }));
      onEvent(...stop());
      onEvent(...delta({ type: "text_delta", text: "WORDS " }));
      onEvent(...delta({ type: "text_delta", text: "THERE" }));
      onEvent(...stop());
      onEvent(...runEvent({ n: 2, type: "round-text", round: 1, text: "WORDS THERE" }));
      onEvent(...runEvent({ n: 3, type: "run-end", status: "done", summary: { rounds: 1 } }));
    },
    get: async () => ({ events: [] }),
  };
  const words = { piece: (/** @type {string} */ type, /** @type {string} */ text) => void heard.push([type, text]), endBlock: () => void heard.push(["end"]) };
  const fin = await createRemoteAgents({ machines: oneMachine(client), wait: async () => {} }).turn(onBox(), { content: [{ type: "text", text: "go" }], signal: new AbortController().signal, words });
  assert.deepEqual(heard, [["thinking", "weighing"], ["end"], ["text", "WORDS "], ["text", "THERE"], ["end"]]);
  assert.deepEqual([fin.status, fin.report], ["done", "WORDS THERE"]);
});

// (fails before: yes — the review of s2e: a follow-up that first settled a pause still waiting there put the resumed
// turn's rounds and its own, numbered from 1 again, in one run here, two turns' words and calls in one round)
test("a turn there read into its run here: two runs of one exchange never share a round, a resumed turn's rounds go on as they are, and what that machine keeps stays out", () => {
  /** @type {string[]} */
  const said = [];
  let blocks = 0;
  const read = mirrorEvents({ endBlock: () => void said.push("end"), held: () => blocks });
  /** @param {string} runId @param {any} e */
  const at = (runId, e) => read({ runId, n: 1, ...e });
  // The pause a follow-up settled first: its turn goes on from its paused round, 2.
  assert.deepEqual(at("r-old", { type: "round-start", round: 3, blocksBefore: 4 }), { runId: "r-old", n: 1, type: "round-start", round: 3, blocksBefore: 4 });
  assert.equal(at("r-old", { type: "round-text", round: 4, text: "OLD" }).round, 4);
  assert.deepEqual(said, [], "no block ended before the first run's");
  blocks = 2;
  // The follow-up's own turn starts from round 1 again: numbered on from the last round shown.
  assert.deepEqual(at("r-new", { type: "round-start", round: 1, blocksBefore: 0 }), { runId: "r-new", n: 1, type: "round-start", round: 5, blocksBefore: 2 });
  assert.deepEqual(said, ["end"], "the block open here ended as the new run began");
  assert.equal(at("r-new", { type: "tool-start", round: 2, id: "t1", name: "read" }).round, 6);
  // A pause answered in the same exchange: its resumed turn goes on from its paused round and keeps its numbers.
  const again = mirrorEvents({ endBlock: () => {}, held: () => 1 });
  assert.equal(again({ runId: "a", type: "round-start", round: 1, blocksBefore: 0 }).round, 1);
  assert.equal(again({ runId: "a", type: "round-start", round: 2, blocksBefore: 1 }).round, 2);
  assert.deepEqual([again({ runId: "b", type: "round-start", round: 3, blocksBefore: 0 })].map((e) => [e.round, e.blocksBefore]), [[3, 1]]);
  // What its card asks, its steers, pictures, artifacts, graph and own agents are that machine's; a budget's stop, an
  // output cut and its coding agent's notices are its thread's.
  for (const type of ["ask", "ask-end", "subagent-ask", "steer", "steer-read", "visual", "artifact", "graph", "subagent-dispatch", "run-start", "run-end"]) assert.equal(again({ runId: "b", type }), null, type);
  for (const type of ["budget", "output-cut", "agent-notice", "notice", "compaction", "tool-output"]) assert.ok(again({ runId: "b", type, round: 3 }), type);
});

// (fails before: yes — the swarm's review of 11-10: a stream that dropped before its run's first event threw, and the
// turn there ran on, unseen and unstopped; a stop that did not reach that machine was said as a stop; a run that said its
// words before that machine went silent lost them)
describe("a turn there that loses its machine", () => {
  /** A client whose stream drops before any event, then answers as `get` says; its posts kept. @param {(path: string) => any} get @param {{ stop?: () => any }} [o] */
  const dropping = (get, { stop = () => ({ ok: true }) } = {}) => {
    /** @type {string[]} */
    const posted = [];
    return {
      posted,
      client: {
        state: { takes: ["mode"] },
        post: async (/** @type {string} */ path) => (posted.push(path), path === "/sessions" ? { id: "c1", model: "m-1" } : path.endsWith("/stop") ? stop() : { ok: true }),
        stream: async () => {
          throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
        },
        get: async (/** @type {string} */ path) => get(path),
      },
    };
  };
  test("dropped before its run's first event: the run the message began there is found by the chat's live state and followed", async () => {
    const { client, posted } = dropping((path) => {
      if (path === "/sessions/c1/live-state") return { live: { requestId: "r1" } };
      assert.match(path, /^\/runs\/r1\/events\?since=0$/);
      return { events: [{ runId: "r1", n: 1, type: "round-text", round: 1, text: "WORDS THERE" }, { runId: "r1", n: 2, type: "run-end", status: "done", summary: {} }] };
    });
    const remote = onBox();
    const fin = await createRemoteAgents({ machines: oneMachine(client), wait: async () => {} }).turn(remote, { content: [{ type: "text", text: "go" }], signal: new AbortController().signal });
    assert.deepEqual([fin.status, fin.report], ["done", "WORDS THERE"], String(fin.error));
    assert.equal(remote.run, "r1");
    assert.ok(!posted.some((p) => p.endsWith("/stop")), "nothing stopped");
  });
  test("dropped, and no run there: a stop goes, so none runs on unseen; one that does not reach it is owed, and goes first with the next message", async () => {
    let reach = false;
    const { client, posted } = dropping(() => ({ live: null }), {
      stop: () => {
        if (!reach) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        return { ok: true };
      },
    });
    const remote = onBox();
    const r = createRemoteAgents({ machines: oneMachine(client), wait: async () => {} });
    await assert.rejects(r.turn(remote, { content: [{ type: "text", text: "go" }], signal: new AbortController().signal }), /^Error: Box stopped answering before a turn of its sub-agent was seen to begin there \(socket hang up\), and none runs there now$/);
    assert.deepEqual(posted, ["/sessions", "/sessions/c1/stop"]);
    assert.equal(remote.stopOwed, true, "the stop is owed");
    reach = true;
    await assert.rejects(r.turn(remote, { content: [{ type: "text", text: "again" }], signal: new AbortController().signal }));
    assert.equal(posted[2], "/sessions/c1/stop", "the owed stop goes before the next message");
  });
  test("stopped here, and the stop does not reach it: its words say it may still run there, and the stop is owed", async () => {
    const ctrl = new AbortController();
    /** @type {string[]} */
    const posted = [];
    const client = {
      state: { takes: ["mode"] },
      post: async (/** @type {string} */ path) => {
        posted.push(path);
        if (path.endsWith("/stop")) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        return { id: "c1", model: "m-1" };
      },
      stream: async (/** @type {string} */ _p, /** @type {any} */ _b, /** @type {(e: string, d: any) => void} */ onEvent, /** @type {any} */ o) => {
        onEvent(...runEvent({ n: 1, type: "round-start", round: 1 }));
        ctrl.abort();
        if (o.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
      get: async () => ({ events: [] }),
    };
    const remote = onBox();
    const fin = await createRemoteAgents({ machines: oneMachine(client), wait: async () => {} }).turn(remote, { content: [{ type: "text", text: "go" }], signal: ctrl.signal });
    assert.equal(fin.status, "aborted");
    assert.match(String(fin.error), /^stopped here, and the stop did not reach Box \(.*ECONNREFUSED.*\): its turn there may still run, and is sent a stop again before its next message$/);
    assert.equal(remote.stopOwed, true);
  });
  // Its machine going silent ends nothing (the review of 11-11: remote-reach.test.js); one that answers, and refuses
  // this Filament's agents, ends the turn here.
  test("its machine refuses this Filament's agents after its run said words: they come back with why, and a stop is sent", async () => {
    /** @type {string[]} */
    const posted = [];
    const client = {
      state: { takes: ["mode"] },
      post: async (/** @type {string} */ path) => (posted.push(path), { id: "c1", model: "m-1" }),
      stream: async (/** @type {string} */ _p, /** @type {any} */ _b, /** @type {(e: string, d: any) => void} */ onEvent) => {
        onEvent(...runEvent({ n: 1, type: "round-text", round: 1, text: "HALF A REPORT" }));
        throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      },
      get: async () => {
        throw Object.assign(new CliError("this device is not known here"), { status: 403 });
      },
    };
    const fin = await createRemoteAgents({ machines: oneMachine(client), wait: async () => {} }).turn(onBox(), { content: [{ type: "text", text: "go" }], signal: new AbortController().signal });
    assert.deepEqual([fin.status, fin.report], ["failed", "HALF A REPORT"]);
    assert.match(String(fin.error), /^Box refused this Filament's agents as their sub-agent worked: this device is not known here/);
    assert.ok(posted.includes("/sessions/c1/stop"), "its run there is sent a stop");
  });
});

// (fails before: yes — the swarm's review of 11-10: a chat deleted left its sub-agent on another machine at work there)
test("a chat deleted stops its sub-agents at work, one on another machine with a stop there", async () => {
  const folder = mkdtempSync(join(tmpdir(), "filament-remote-forget-"));
  /** @type {string[]} */
  const posted = [];
  let release = () => {};
  const held = new Promise((r) => (release = () => r(null)));
  const client = {
    state: { system: null, takes: ["mode"] },
    post: async (/** @type {string} */ path) => (posted.push(path), path === "/sessions" ? { id: "chat-1", model: "m-1" } : { ok: true }),
    get: async (/** @type {string} */ path) => (path.endsWith("/asks") ? { asks: [] } : { events: [] }),
    stream: async (/** @type {string} */ _p, /** @type {any} */ _b, /** @type {(e: string, d: any) => void} */ onEvent, /** @type {any} */ o) => {
      onEvent(...runEvent({ n: 1, type: "round-start", round: 1 }));
      await Promise.race([held, new Promise((r) => o.signal.addEventListener("abort", r, { once: true }))]);
      if (o.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    },
  };
  try {
    const registry = createSubagentRegistry({
      config: () => /** @type {any} */ ({ agentLoop: {} }),
      log: () => {},
      events: { publish: () => {} },
      runs: null,
      context: /** @type {any} */ ({ settings: () => ({ subagents: {}, loop: { permissions: "edit" } }), modelProblem: () => null, session: () => ({ cwd: folder, model: "m-1" }), mark: (/** @type {string} */ _c, /** @type {any} */ m) => m, loadThreads: () => [] }),
      machines: oneMachine(client),
    });
    const door = registry.openTurn({ chainId: "c-gone", runId: "turn-gone", cwd: folder, mode: "edit", model: "m-1", thinking: null, fork: null });
    const res = await door.subagents.run({ id: "toolu_gone", input: { machine: "Box", cwd: "/w", description: "Work there", prompt: "Work.", run_in_background: true }, emit: () => {}, signal: null });
    const id = String(/sub-agent (sa_[0-9a-f]+)/.exec(res.text)?.[1] || "");
    await until(() => !!registry.get(id)?.remote?.run, "its run there");
    door.close();
    await registry.forgetChat("c-gone");
    await until(() => registry.get(id)?.status !== "running", "it stops", 5000);
    assert.ok(posted.includes("/sessions/chat-1/stop"), JSON.stringify(posted));
  } finally {
    release();
    rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// (fails before: yes — the swarm's review of 11-10: a follow-up carried a changed mode to a Filament there that takes
// none, which refused the message; a folder there that machine's fence keeps from this machine's agents was read as an
// old Filament's answer, and the launch went to a clone; a read of the asks there that failed was never made again)
describe("what that machine takes and keeps", () => {
  test("a changed mode goes with a follow-up only where that machine takes a mode", async () => {
    /** @type {any[]} */
    const bodies = [];
    /** @param {string[]} takes */
    const clientOf = (takes) => ({
      state: { takes },
      post: async () => ({ ok: true }),
      stream: async (/** @type {string} */ _p, /** @type {any} */ b, /** @type {(e: string, d: any) => void} */ onEvent) => {
        bodies.push(b);
        onEvent(...runEvent({ n: 1, type: "run-end", status: "done", summary: {} }));
      },
      get: async () => ({ asks: [] }),
    });
    for (const takes of [[], ["mode"]]) {
      const remote = { ...onBox(), chat: "c1", mode: null };
      await createRemoteAgents({ machines: oneMachine(clientOf(takes)), wait: async () => {} }).turn(remote, { content: [{ type: "text", text: "go" }], signal: new AbortController().signal, mode: "edit" });
    }
    assert.equal(bodies[0].settingsPatch, undefined, "a Filament there that takes no mode is sent none");
    assert.deepEqual(bodies[1].settingsPatch, { loop: { permissions: "edit" } });
  });
  test("a folder that machine's fence keeps from this machine's agents refuses the launch in its words", async () => {
    const client = { state: { platform: "darwin", takes: ["mode"] }, get: async () => ({ clones: [{ path: "/w/main", head: "b".repeat(40), branch: "main", dirty: false }], named: null, refused: "another machine's agents never work in a credentials folder" }) };
    const repo = mkdtempSync(join(tmpdir(), "filament-remote-fenced-"));
    try {
      gitIn(repo, "init", "-q", "-b", "main");
      gitIn(repo, "remote", "add", "origin", ORIGIN);
      await assert.rejects(createRemoteAgents({ machines: oneMachine(client) }).place("Box", { cwd: "/Users/x/.ssh", folder: repo }), /^Error: Box keeps \/Users\/x\/\.ssh from this Filament's agents: another machine's agents never work in a credentials folder$/);
    } finally {
      rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });
  test("its models are asked for within a bound", async () => {
    /** @type {any} */
    let o = null;
    const client = { state: {}, get: async (/** @type {string} */ _p, /** @type {any} */ opts) => ((o = opts), { models: [] }) };
    await createRemoteAgents({ machines: oneMachine(client) }).modelsText("Box");
    assert.ok(o?.timeoutMs > 0 && o.timeoutMs <= 30_000, JSON.stringify(o));
  });
  test("a read of the asks there that fails is made again, and the ask shows", async () => {
    let reads = 0;
    /** @type {string[]} */
    const shown = [];
    let release = () => {};
    const done = new Promise((r) => (release = () => r(null)));
    // Never shown: the run ends all the same, a moment on, and the test says so.
    setTimeout(() => release(), 2000).unref();
    const client = {
      state: { takes: ["mode"] },
      post: async () => ({ id: "c1", model: "m-1" }),
      stream: async (/** @type {string} */ _p, /** @type {any} */ _b, /** @type {(e: string, d: any) => void} */ onEvent) => {
        onEvent(...runEvent({ n: 1, type: "subagent-ask" }));
        await done;
        onEvent(...runEvent({ n: 2, type: "run-end", status: "done", summary: {} }));
      },
      get: async (/** @type {string} */ path) => {
        if (!path.endsWith("/asks")) return { events: [] };
        if (++reads === 1) throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
        return { asks: [{ id: "x1", from: "sa_1", kind: "permission", tool: "bash", question: "Run it?" }] };
      },
    };
    const onAsk = async (/** @type {any} */ ask) => (shown.push(ask.id), release(), null);
    const fin = await createRemoteAgents({ machines: oneMachine(client), wait: () => new Promise((go) => setTimeout(go, 5)) }).turn(onBox(), { content: [{ type: "text", text: "go" }], signal: new AbortController().signal, onAsk });
    assert.equal(fin.status, "done", String(fin.error));
    assert.deepEqual(shown, ["x1"]);
  });
});

// (fails before: yes — a chat there that no model was named for went without one, and that machine refused its message;
// this chat's mode went nowhere — the owner's of 11-10)
test("a chat there that neither its launch nor that machine names a model for runs on this chat's where it answers there, else the first that does; this chat's mode goes with it, and a Filament there from before starts the chat without it", async () => {
  /**
   * `old`: a Filament from before agents set a chat's mode, whose /state names nothing it takes, and which refuses one;
   * `refuse`: words a machine that takes a mode refuses the chat's start with.
   * @param {{ made?: any, models?: any, old?: boolean, refuse?: string | null }} [o]
   */
  const box = ({ made = { id: "c1" }, models = [], old = false, refuse = null } = {}) => {
    /** @type {{ posts: any[], turns: any[], gets: string[], silent: number }} */
    const seen = { posts: [], turns: [], gets: [], silent: 0 };
    const client = {
      state: old ? { platform: "darwin" } : { platform: "darwin", takes: ["mode"] },
      post: async (/** @type {string} */ _p, /** @type {any} */ body) => {
        seen.posts.push(body);
        if (old && body?.settings?.loop) throw new Error("another machine's agents set a chat's model.name and model.effort alone; settings: loop.permissions is more than that (HTTP 400)");
        if (refuse) throw new Error(refuse);
        return made;
      },
      stream: async (/** @type {string} */ _p, /** @type {any} */ body, /** @type {(e: string, d: any) => void} */ onEvent) => {
        seen.turns.push(body);
        // A stream that ends before its run began there: nothing took the message.
        if (seen.silent > 0) return void (seen.silent -= 1);
        onEvent(...runEvent({ n: 1, type: "round-text", round: 1, text: "DONE THERE" }));
        onEvent(...runEvent({ n: 2, type: "run-end", status: "done", summary: { rounds: 1 } }));
      },
      get: async (/** @type {string} */ path) => {
        seen.gets.push(path);
        if (path !== "/models") return { events: [], run: null };
        if (typeof models === "function") return models();
        return { models };
      },
    };
    /** @param {any} chat @param {string | null} [mode] */
    const run = (chat, mode = null) => createRemoteAgents({ machines: oneMachine(client), wait: async () => {} }).turn(chat, { content: [{ type: "text", text: "go" }], signal: new AbortController().signal, mode });
    return { seen, run };
  };
  const answering = [{ id: "box-big", answers: true }, { id: "m-1", answers: true }, { id: "box-off", answers: false }];
  // This chat's model answers there: it is the one, set on the chat with its first message; the mode goes at its start.
  let b = box({ models: answering });
  /** @type {any} */
  let chat = { ...onBox(), prefer: "m-1" };
  let fin = await b.run(chat, "auto");
  assert.deepEqual([fin.status, fin.report], ["done", "DONE THERE"]);
  assert.deepEqual(b.seen.posts[0].settings, { loop: { permissions: "auto" } });
  assert.deepEqual(b.seen.turns[0].settingsPatch, { model: { name: "m-1" } });
  assert.deepEqual([chat.model, chat.pick, chat.unnamed, chat.mode], ["m-1", undefined, undefined, "auto"]);
  // Its next message carries no model and the same mode: the chat there has them, and the list was read once.
  await b.run(chat, "auto");
  assert.equal(b.seen.turns[1].settingsPatch, undefined);
  assert.deepEqual(b.seen.gets.filter((p) => p === "/models"), ["/models"]);
  // The sending chat's mode changed: the change goes with the message, once.
  await b.run(chat, "edit");
  await b.run(chat, "edit");
  assert.deepEqual([b.seen.turns[2].settingsPatch, b.seen.turns[3].settingsPatch, chat.mode], [{ loop: { permissions: "edit" } }, undefined, "edit"]);
  // This chat's model does not answer there, and a name there that would read as Filament's own is none: the first that does.
  b = box({ models: [{ id: "x[Filament:go]", answers: true }, ...answering] });
  chat = { ...onBox(), prefer: "gone-1" };
  await b.run(chat);
  assert.deepEqual([b.seen.turns[0].settingsPatch, chat.model], [{ model: { name: "box-big" } }, "box-big"]);
  // That machine names one for a new chat: its own, no list read, nothing set.
  b = box({ made: { id: "c1", model: "box-default" }, models: answering });
  chat = { ...onBox(), prefer: "m-1" };
  await b.run(chat);
  assert.deepEqual([b.seen.gets, b.seen.turns[0].settingsPatch, chat.model], [[], undefined, "box-default"]);
  // None answers there: refused in words, its chat there kept to stop; once one does, the next message chooses it.
  let none = true;
  b = box({ models: () => ({ models: none ? [{ id: "box-off", answers: false }] : answering }) });
  chat = onBox();
  await assert.rejects(b.run(chat), /no model answers on Box now, and its sub-agent's chat there needs one/);
  assert.equal(chat.chat, "c1");
  none = false;
  fin = await b.run(chat);
  assert.deepEqual([fin.status, b.seen.turns[0].settingsPatch, chat.model], ["done", { model: { name: "box-big" } }, "box-big"]);
  // A message no run there took — its stream ended before one began — leaves the choice to go with the next.
  b = box({ models: answering });
  b.seen.silent = 1;
  chat = { ...onBox(), prefer: "m-1" };
  await b.run(chat).catch(() => null);
  assert.deepEqual([chat.model, chat.pick], [null, "m-1"]);
  await b.run(chat);
  assert.deepEqual([b.seen.turns[1].settingsPatch, chat.model, chat.pick], [{ model: { name: "m-1" } }, "m-1", undefined]);
  // A Filament there from before agents set a chat's mode says it takes none (its /state names nothing): the chat starts
  // without one, in that machine's own, and no change of mode is sent it after.
  // (fails before: yes — the mode was sent, and its refusal's words read for the fallback: the review of 11-10)
  b = box({ made: { id: "c1", model: "box-default" }, old: true });
  chat = onBox();
  fin = await b.run(chat, "auto");
  assert.equal(fin.status, "done");
  assert.deepEqual(b.seen.posts.map((p) => p.settings), [undefined], "never sent where it is not taken");
  await b.run(chat, "edit");
  assert.deepEqual([chat.modeless, b.seen.turns[1].settingsPatch], [true, undefined]);
  // One to read alone is never started there in a mode that may write: refused in words, before any chat is made.
  b = box({ made: { id: "c1", model: "box-default" }, old: true });
  chat = onBox();
  await assert.rejects(b.run(chat, "read-only"), /Box runs a Filament from before a chat's mode could be sent there, so its chat cannot start read-only: update Filament on Box/);
  assert.equal(b.seen.posts.length, 0, "no chat started without its mode");
  // A machine that takes a mode and refuses the start, whatever its words name, is refused as it said: never started again.
  b = box({ refuse: "settings: loop.permissions is more than that (HTTP 400)" });
  chat = onBox();
  await assert.rejects(b.run(chat, "auto"), /loop\.permissions is more than that/);
  assert.deepEqual([b.seen.posts.length, chat.modeless], [1, undefined]);
});

// (fails before: yes — its chat there was kept only once its run's first event came: a restart here between its making
// and that event lost it, and nothing stopped the chat there; the s-launch hunt's)
test("its chat there is handed to the caller to keep the moment it is made, before its message goes", async () => {
  /** @type {string[]} */
  const order = [];
  const ctrl = new AbortController();
  const client = {
    post: async (/** @type {string} */ path) => {
      order.push(`post ${path}`);
      return { id: "c1", model: "m-1" };
    },
    stream: async () => {
      order.push("message");
      ctrl.abort();
    },
    get: async () => ({ asks: [] }),
  };
  const chat = onBox();
  await createRemoteAgents({ machines: oneMachine(client), wait: async () => {} })
    .turn(chat, { content: [{ type: "text", text: "go" }], signal: ctrl.signal, onChat: () => order.push(`kept ${chat.chat}`) })
    .catch(() => null);
  assert.deepEqual(order.slice(0, 3), ["post /sessions", "kept c1", "message"]);
});

// (fails before: yes — an ask whose event came after the asks' read had looked its last, and before that read let go,
// set "look again" on a read that was over: nobody read it, and its run waited there for good; the s-launch hunt's)
test("an ask heard as the asks' read there ends is read again, wherever in that read's end it lands", async () => {
  for (let hops = 0; hops < 12; hops++) {
    /** @type {(e: string, d: any) => void} */
    let emit = () => {};
    /** @type {() => void} */
    let end = () => {};
    let reads = 0;
    /** @type {string[]} */
    const shown = [];
    const client = {
      post: async () => ({ id: "c1", model: "m-1" }),
      stream: (/** @type {string} */ _p, /** @type {any} */ _b, /** @type {(e: string, d: any) => void} */ onEvent) =>
        new Promise((resolve) => {
          emit = onEvent;
          end = () => {
            onEvent(...runEvent({ n: 9, type: "run-end", status: "done", summary: {} }));
            resolve(undefined);
          };
          onEvent(...runEvent({ n: 1, type: "round-start", round: 1 }));
          onEvent(...runEvent({ n: 2, type: "subagent-ask" }));
        }),
      get: async (/** @type {string} */ path) => {
        if (!/\/asks$/.test(path)) return { events: [] };
        reads++;
        if (reads === 1) {
          // Its read finds nothing yet; the ask's event lands `hops` steps after it answers.
          let k = hops;
          const later = () => (k-- > 0 ? queueMicrotask(later) : emit(...runEvent({ n: 3, type: "subagent-ask" })));
          queueMicrotask(later);
          return { asks: [] };
        }
        return { asks: [{ id: "a1", from: "subagent", kind: "permission", question: "run npm test?" }] };
      },
    };
    const turn = createRemoteAgents({ machines: oneMachine(client), wait: async () => {} }).turn(onBox(), {
      content: [{ type: "text", text: "go" }],
      signal: new AbortController().signal,
      onAsk: async (/** @type {any} */ a) => {
        shown.push(a.id);
        end();
        return null;
      },
    });
    const out = await Promise.race([turn.then(() => "ended"), new Promise((resolve) => setTimeout(() => resolve("waited"), 2000).unref())]);
    if (out === "waited") end();
    await turn;
    assert.deepEqual(shown, ["a1"], `the ask shown, its event ${hops} steps after the read`);
  }
});

// (fails before: yes — a named folder matched a clone there in any case on every system: on Linux, /w/app took /w/App's
// branch and HEAD for its brief, a folder that is not it; the s-launch hunt's)
test("a folder named there is its clone in any case on Windows and macOS, and in its own case alone on Linux", async () => {
  const repo = mkdtempSync(join(tmpdir(), "filament-remote-case-"));
  try {
    gitIn(repo, "init", "-q", "-b", "main");
    gitIn(repo, "remote", "add", "origin", ORIGIN);
    const clone = { path: "/w/App", head: "b".repeat(40), branch: "main", dirty: false };
    for (const [platform, matched] of /** @type {[string | undefined, boolean][]} */ ([["linux", false], ["darwin", true], ["win32", true], [undefined, false]])) {
      const client = { state: { platform }, get: async () => ({ clones: [clone] }) };
      const p = await createRemoteAgents({ machines: oneMachine(client) }).place("Box", { cwd: "/w/app", folder: repo });
      assert.deepEqual([p.cwd, p.clone?.path ?? null], ["/w/app", matched ? "/w/App" : null], String(platform));
      const exact = await createRemoteAgents({ machines: oneMachine(client) }).place("Box", { cwd: "/w/App/", folder: repo });
      assert.equal(exact.clone?.path, "/w/App", `${platform}: its own case`);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// (fails before: yes — the owner's of 11-10 and the review of 11-10: a named folder that was no clone there, its git state
// unread or none at all, was told to check its branch and HEAD and catch up with this chat's commit)
test("a folder named there is read there: no git, another repository's clone, a subfolder of this project's clone, and one a Filament from before did not read are each said as they are", async () => {
  const repo = mkdtempSync(join(tmpdir(), "filament-remote-named-"));
  try {
    gitIn(repo, "init", "-q", "-b", "main");
    gitIn(repo, "remote", "add", "origin", ORIGIN);
    writeFileSync(join(repo, "a.txt"), "a\n");
    gitIn(repo, "add", ".");
    gitIn(repo, "commit", "-q", "-m", "first");
    /** @type {string[]} */
    const asked = [];
    /** @param {any} named */
    const box = (named) => ({ state: { platform: "darwin" }, get: async (/** @type {string} */ path) => (asked.push(path), named === undefined ? { clones: [] } : { clones: [], named }) });
    const place = (/** @type {any} */ named, cwd = "/Users/kai/FilamentProjects/scratch") => createRemoteAgents({ machines: oneMachine(box(named)) }).place("Box", { cwd, folder: repo });
    const r = createRemoteAgents({ machines: null });
    // No git there: nothing to sync, and nothing of this chat's commit is said to be reachable.
    let p = await place({ git: false, same: false, gone: false, path: null, head: null, branch: null, dirty: null });
    assert.match(asked.at(-1) ?? "", /^\/clones\?remote=.+&cwd=%2FUsers%2Fkai%2FFilamentProjects%2Fscratch$/);
    assert.deepEqual([p.clone, p.folder?.git], [null, false]);
    let w = r.whereWords(p);
    assert.match(w, /\nSync: none — this folder is in no git repository there, so nothing of the work at [0-9a-f]{10} is in it: work from what your task gives you\.$/);
    assert.doesNotMatch(w, /check its branch|git fetch/);
    // Another repository's clone.
    p = await place({ git: true, same: false, gone: false, path: "/w/other", head: "c".repeat(40), branch: "main", dirty: false }, "/w/other");
    assert.match(r.whereWords(p), /\nSync: none — this folder is a clone of another repository, not .+: nothing of the work at [0-9a-f]{10} is in it\.$/);
    // A folder that is not there.
    p = await place({ git: false, same: false, gone: true, path: null, head: null, branch: null, dirty: null }, "/w/nowhere");
    assert.match(r.whereWords(p), /\nSync: none — this folder is not there yet: make it, and work from what your task gives you\.$/);
    // A subfolder of this project's clone: its clone, as the machine read it, with the sync a clone takes.
    p = await place({ git: true, same: true, gone: false, path: "/w/widgets", head: "b".repeat(40), branch: "main", dirty: false }, "/w/widgets/src");
    assert.deepEqual([p.cwd, p.clone?.path, p.clone?.head], ["/w/widgets/src", "/w/widgets", "b".repeat(40)]);
    assert.match(r.whereWords(p), /\nSync: their commit [0-9a-f]{10} is not pushed, so you cannot fetch it: work from this folder as it is\.$/);
    // A Filament there from before reads no named folder: its git state unread, said so.
    p = await place(undefined);
    assert.deepEqual([p.clone, p.folder], [null, null]);
    assert.match(r.whereWords(p), /\nSync: Filament could not read this folder's git state — check its branch and HEAD yourself before you start; theirs is [0-9a-f]{10}\.$/);
  } finally {
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// (fails before: yes — the review of 11-10: HEAD on any remote-tracking branch read as pushed, so a commit pushed to a
// fork alone was said fetchable from the clone there, whose origin is the project's)
test("this chat's commit counts as pushed only where the remote its clone there is matched by holds it, never a fork's", async () => {
  const base = mkdtempSync(join(tmpdir(), "filament-remote-fork-"));
  try {
    const up = join(base, "up.git");
    const fork = join(base, "fork.git");
    const repo = join(base, "here");
    gitIn(base, "init", "-q", "--bare", "-b", "main", up);
    gitIn(base, "init", "-q", "--bare", "-b", "main", fork);
    gitIn(base, "clone", "-q", up, repo);
    writeFileSync(join(repo, "a.txt"), "a\n");
    gitIn(repo, "add", ".");
    gitIn(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "first");
    gitIn(repo, "push", "-q", "origin", "main");
    gitIn(repo, "remote", "add", "fork", fork);
    writeFileSync(join(repo, "b.txt"), "b\n");
    gitIn(repo, "add", ".");
    gitIn(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "second");
    gitIn(repo, "push", "-q", "fork", "main");
    const clone = { path: "/w/up", head: "b".repeat(40), branch: "main", dirty: false };
    const client = { state: { platform: "darwin" }, get: async () => ({ clones: [clone] }) };
    const p = await createRemoteAgents({ machines: oneMachine(client) }).place("Box", { folder: repo });
    assert.equal(p.here?.pushed, false, "on the fork alone");
    gitIn(repo, "push", "-q", "origin", "main");
    const q = await createRemoteAgents({ machines: oneMachine(client) }).place("Box", { folder: repo });
    assert.equal(q.here?.pushed, true, "on origin, which its clone there is matched by");
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// (fails before: yes — a launch that named no folder there ran in the person's clone there whatever that machine took;
// cp-place)
test("a launch that names no folder there: a copy of its own where that machine takes one and this chat's folder is in git, no clone asked; else the clone there on this chat's branch first, then a clean one", async () => {
  const repo = mkdtempSync(join(tmpdir(), "filament-remote-where-"));
  try {
    gitIn(repo, "init", "-q", "-b", "main");
    gitIn(repo, "remote", "add", "origin", ORIGIN);
    writeFileSync(join(repo, "a.txt"), "a\n");
    gitIn(repo, "add", ".");
    gitIn(repo, "commit", "-q", "-m", "first");
    const clones = [
      { path: "/w/feature", head: "b".repeat(40), branch: "feature", dirty: false },
      { path: "/w/main-dirty", head: "b".repeat(40), branch: "main", dirty: true },
      { path: "/w/main", head: "b".repeat(40), branch: "main", dirty: false },
    ];
    /** @type {string[]} */
    const asked = [];
    /** @param {string[] | undefined} takes */
    const box = (takes) => ({ state: { platform: "darwin", ...(takes ? { takes } : {}) }, get: async (/** @type {string} */ path) => (asked.push(path), { clones }) });
    const copying = await createRemoteAgents({ machines: oneMachine(box(["mode", "exec-mode", "transfer", "copy"])) }).place("Box", { folder: repo, copy: true });
    assert.deepEqual([copying.cwd, copying.clone, copying.pending?.from, asked.length], ["", null, repo, 0]);
    assert.equal(copying.here?.branch, "main");
    for (const takes of [undefined, ["mode", "exec-mode", "transfer"]]) {
      const p = await createRemoteAgents({ machines: oneMachine(box(takes)) }).place("Box", { folder: repo, copy: true });
      assert.deepEqual([p.cwd, p.pending ?? null], ["/w/main", null], `takes ${JSON.stringify(takes)}: the clone on its branch, clean`);
    }
    // A command's place (remote-commands.js) is no launch's: the clone, whatever that machine takes.
    const command = await createRemoteAgents({ machines: oneMachine(box(["transfer", "copy"])) }).place("Box", { folder: repo });
    assert.deepEqual([command.cwd, command.pending ?? null], ["/w/main", null], "a command: the clone");
    const named = await createRemoteAgents({ machines: oneMachine(box(["transfer", "copy"])) }).place("Box", { cwd: "/w/feature", folder: repo, copy: true });
    assert.deepEqual([named.cwd, named.pending ?? null], ["/w/feature", null], "a folder named: that folder");
    const plain = mkdtempSync(join(tmpdir(), "filament-remote-plain-"));
    try {
      await assert.rejects(createRemoteAgents({ machines: oneMachine(box(["transfer", "copy"])) }).place("Box", { folder: plain, copy: true }), /has no git remote to find its clone on Box by/, "outside git: no copy");
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  } finally {
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// (fails before: yes — a pushed commit was to be checked out, which leaves the person's clone on a detached HEAD; then
// the swarm's review of 11-10: a pull reached the branch's tip, not their commit, merged into a clone with the person's
// uncommitted work, and a worktree of a branch the clone lacked failed)
test("the sync it is told never moves the person's clone there but by a fast-forward to their commit, clean on its branch; else a worktree at that commit", () => {
  const r = createRemoteAgents({ machines: null });
  /** @param {string} branch @param {boolean} [dirty] */
  const at = (branch, dirty = false) => ({ machine: { id: "m1", name: "Box" }, cwd: "/w", system: {}, remote: ORIGIN, clone: { path: "/w", head: "b".repeat(40), branch, dirty }, here: { head: "a".repeat(40), branch: "main", dirty: false, pushed: true } });
  const sha = "a".repeat(40);
  const same = r.whereWords(at("main"));
  assert.match(same, new RegExp(`\\nSync: run \`git fetch\`, then \`git merge --ff-only ${sha}\` on main to reach aaaaaaaaaa before you start; where that is no fast-forward, work in a worktree of it beside this folder \\(\`git worktree add --detach "<folder>" ${sha}\`\\), never a merge here\\.$`));
  const worktree = new RegExp(`\\nSync: their work is aaaaaaaaaa on main, and this folder is the person's: run \`git fetch\`, then work in a worktree of that commit beside it \\(\`git worktree add --detach "<folder>" ${sha}\`\\), never a checkout, pull or merge here\\.$`);
  const other = r.whereWords(at("feature"));
  assert.match(other, worktree);
  const dirty = r.whereWords(at("main", true));
  assert.match(dirty, worktree, "the same branch with the person's uncommitted work: a worktree too");
  for (const w of [same, other, dirty]) assert.doesNotMatch(w, /check out|git pull|\(or merge\)/);
});

describe("a sub-agent on another machine", () => {
  const base = mkdtempSync(join(tmpdir(), "filament-remote-sub-"));
  /** This machine's clone, and there's two: on this one's branch, and on a feature branch. A folder outside git here. */
  const hereRepo = join(base, "here", "widgets");
  const thereMain = join(base, "there", "widgets-main");
  const thereFeature = join(base, "there", "widgets-feature");
  const plain = join(base, "here", "notes");
  /** The held model calls there (`HOLD`), each let go at the end. @type {(() => void)[]} */
  const held = [];
  /** The model calls there `WAIT` and the first `ONCE` hold, apart from `held`, each let go at the end. @type {(() => void)[]} */
  const waiting = [];
  let onces = 0;
  /** The `STREAM` calls there, each holding its reply's rest until let go. @type {(() => void)[]} */
  const streamed = [];
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startTwoMachines>>} */
  let two;
  /** @type {any} */
  let registry;
  /** This machine's chat the launches are made from. */
  let chainId = "";
  let deviceId = "";
  /** The agents' chat there the first launch made, and a chat the person started there. */
  let theirChat = "";
  let personChat = "";
  let n = 0;

  /** The model there: `HOLD` waits until let go, `FOLLOW` and anything else are answered in words. @param {any} call */
  const brain = (call) => {
    if (call.kind !== "anthropic") return undefined;
    const said = wordsOf(call.body?.messages?.at(-1));
    const reply = (/** @type {string} */ text) => (call.body?.stream ? anthropicStream(text, { model: "m-1" }) : anthropicReply(text, { model: "m-1" }));
    if (/HOLD/.test(said)) return new Promise((resolve) => held.push(() => resolve(reply("LET GO"))));
    // A raw stream the fake provider pumps as it comes (helpers/app.js `writeReply`'s `body`).
    if (/STREAM/.test(said) && call.body?.stream) return /** @type {any} */ ({ body: slowly() });
    if (/WAIT/.test(said) || (/ONCE/.test(said) && onces++ === 0)) return new Promise((resolve) => waiting.push(() => resolve(reply("LET GO"))));
    if (/ONCE/.test(said)) return reply("ANSWERED ONCE");
    if (/FOLLOW/.test(said)) return reply("FOLLOWED UP THERE");
    return reply("REPORT FROM THERE");
  };
  /**
   * A reply whose thinking and first words come at once, and its rest once `streamed` lets it go: words there as they
   * are written.
   */
  const slowly = () => {
    const enc = new TextEncoder();
    const frame = (/** @type {string} */ event, /** @type {any} */ data) => enc.encode(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
    return new ReadableStream({
      async start(c) {
        c.enqueue(frame("message_start", { message: { id: "msg_slow", type: "message", role: "assistant", model: "m-1", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } }));
        c.enqueue(frame("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "" } }));
        c.enqueue(frame("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "WEIGHING " } }));
        c.enqueue(frame("content_block_stop", { index: 0 }));
        c.enqueue(frame("content_block_start", { index: 1, content_block: { type: "text", text: "" } }));
        c.enqueue(frame("content_block_delta", { index: 1, delta: { type: "text_delta", text: "FIRST WORDS " } }));
        await new Promise((resolve) => streamed.push(() => resolve(undefined)));
        c.enqueue(frame("content_block_delta", { index: 1, delta: { type: "text_delta", text: "AND THE REST" } }));
        c.enqueue(frame("content_block_stop", { index: 1 }));
        c.enqueue(frame("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 6 } }));
        c.enqueue(frame("message_stop", {}));
        c.close();
      },
    });
  };
  /** The model calls there whose first message opens with where its sub-agent runs. */
  const briefed = () => up.received.filter((c) => c.kind === "anthropic" && /Where you run: on Workstation/.test(wordsOf(c.body?.messages?.[0])));
  /** The agent tool's call, as a turn's loop makes it, from this machine's chat. @param {any} input @param {{ cwd?: string, mode?: string }} [o] */
  const call = async (input, { cwd = hereRepo, mode = "edit" } = {}) => {
    const door = registry.openTurn({ chainId, runId: `turn-${++n}`, cwd, mode, model: MODEL, thinking: null, fork: null });
    try {
      return await door.subagents.run({ id: `toolu_${n}`, input, emit: () => {}, signal: null });
    } finally {
      door.close();
    }
  };
  /** The agents' chats there, as its archive lists them. */
  const theirChats = async () => ((await (await two.there.api("/api/memory/sessions?limit=50")).json()).sessions || []).length;
  /** Switch the agents' grant there, as its own computer does. @param {boolean} on */
  const grant = async (on) => {
    const r = await two.there.api(`/api/remote/devices/${encodeURIComponent(deviceId)}`, { method: "PATCH", body: { grants: { agents: on } } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** The copies folder there, a test's: a launch that names no folder works in a copy of this chat's folder in it. */
  const copiesThere = join(base, "copies");
  const copiesWas = process.env.FILAMENT_COPIES_DIR;
  /** The person's press of Allow on a project's first copy to a machine, as its card asks; off while a test presses its own. */
  let pressing = true;
  const presser = setInterval(() => {
    if (!pressing || !registry) return;
    for (const row of registry.list(chainId)) {
      const a = registry.get(row.id)?.progress?.asking;
      if (a?.tool === SEND_COPY) registry.answer(row.id, chainId, "Allow", { allow: true, n: a.n });
    }
  }, 50);
  presser.unref();

  before(async () => {
    process.env.FILAMENT_COPIES_DIR = copiesThere;
    for (const d of [hereRepo, join(base, "there"), plain]) mkdirSync(d, { recursive: true });
    gitIn(hereRepo, "init", "-q", "-b", "main");
    writeFileSync(join(hereRepo, "readme.md"), "widgets\n");
    gitIn(hereRepo, "add", ".");
    gitIn(hereRepo, "commit", "-q", "-m", "first");
    for (const d of [thereFeature, thereMain]) gitIn(join(base, "there"), "clone", "-q", hereRepo, d);
    gitIn(thereFeature, "checkout", "-q", "-b", "feature");
    for (const d of [hereRepo, thereMain, thereFeature]) {
      if (d === hereRepo) gitIn(d, "remote", "add", "origin", ORIGIN);
      else gitIn(d, "remote", "set-url", "origin", ORIGIN);
    }
    up = await fakeUpstream(brain);
    const models = (/** @type {any} */ cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1"] }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [], readerModel: "" };
    };
    two = await startTwoMachines({ here: { configure: models }, there: { configure: models } });
    registry = /** @type {any} */ (two.here.app).subagents;
    // The agents' device, minted by here's full device and switched on by there's own computer; kept here as the
    // desktop app keeps it, sealed in remotes.json.
    const minted = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" })).json();
    deviceId = String(minted.device.id);
    createMachines({ dataDir: two.here.dataDir }).keep({ url: two.remote.url, fingerprint: two.remote.fingerprint, machine: two.remote.machine, device: minted.device, token: minted.token });
    await grant(true);
    // The person's own chats there, in each clone — the folders there's agents' chats may start in, and /clones looks at.
    for (const cwd of [thereFeature, thereMain]) {
      const r = await two.there.api("/api/sessions", { method: "POST", body: { cwd, model: "m-1" } });
      assert.equal(r.status, 200, await r.clone().text());
      personChat = String((await r.json()).id);
    }
    const made = await two.here.api("/api/sessions", { method: "POST", body: { cwd: hereRepo, model: "m-1" } });
    assert.equal(made.status, 200, await made.clone().text());
    chainId = String((await made.json()).id);
  });

  after(async () => {
    clearInterval(presser);
    for (const go of [...held.splice(0), ...waiting.splice(0), ...streamed.splice(0)]) go();
    await two?.stop();
    await up?.close();
    if (copiesWas === undefined) delete process.env.FILAMENT_COPIES_DIR;
    else process.env.FILAMENT_COPIES_DIR = copiesWas;
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // (fails before: yes — the agent tool took no machine: the launch ran on this machine, in this chat's folder)
  test("a launch with machine and its clone there named runs in a chat there, in that clone, told first where it runs, and its report comes back; a follow-up is a turn of that chat", async () => {
    const res = await call({ machine: "workstation", cwd: thereMain, description: "Map the widgets", prompt: "Map the repository.", model: MODEL, run_in_background: false });
    assert.equal(res.ok, true, res.text);
    assert.match(res.text, /REPORT FROM THERE/);
    assert.match(String(res.note), /on Workstation/);
    assert.match(res.text, /It worked on Workstation, in .+: what it changed is there, not in your folder — have it commit its own change alone, on a branch of its own, and push that branch, then fetch it here/);
    const [sa] = registry.list(chainId);
    assert.deepEqual([sa.machine?.name, sa.machine?.id, sa.status], ["Workstation", two.there.machine.id, "done"]);
    assert.equal(real(sa.remote.cwd), real(thereMain));
    assert.equal(sa.remote.copy ?? null, null, "no copy: the person's clone");
    assert.ok(sa.remote.chat, "its chat there");
    theirChat = String(sa.remote.chat);
    const there = ((await (await two.there.api("/api/memory/sessions?limit=50")).json()).sessions || []).find((/** @type {any} */ s) => s.id === theirChat);
    assert.equal(real(String(there?.cwd)), real(thereMain), "its chat there works in that clone");
    // Its first message there opens with where it runs: the machine, the folder, the branch and HEAD, how to sync.
    const head = gitIn(hereRepo, "rev-parse", "HEAD");
    const first = wordsOf(briefed()[0]?.body?.messages?.[0]);
    assert.match(first, /^Where you run: on Workstation \(/);
    assert.ok(first.includes(thereMain) || first.toLowerCase().includes(thereMain.toLowerCase()), first);
    assert.ok(first.includes(`on branch main at ${head.slice(0, 10)}`), first);
    assert.match(first, /Sync: none — this folder is at the same commit\./);
    assert.match(first, /Map the repository\./);
    // A follow-up: a new turn in the same chat there, its message alone — the chat holds what came before.
    const before = briefed().length;
    const again = await call({ agent_id: sa.id, prompt: "FOLLOW: and the tests?", run_in_background: false });
    assert.equal(again.ok, true, again.text);
    assert.match(again.text, /FOLLOWED UP THERE/);
    assert.equal(registry.get(sa.id).remote.chat, sa.remote.chat, "the same chat there");
    const last = up.received.filter((c) => c.kind === "anthropic").at(-1);
    assert.equal(wordsOf(last?.body?.messages?.at(-1)), "FOLLOW: and the tests?");
    assert.ok(/REPORT FROM THERE/.test(JSON.stringify(last?.body?.messages)), "the chat there holds its first exchange");
    assert.equal(briefed().length, before + 1, "the same conversation, whose first message is the brief");
    // Its changes are on that machine: nothing to apply or mark here.
    for (const key of ["apply_changes", "mark_applied"])
      await assert.rejects(call({ agent_id: sa.id, [key]: true }), /changes are on Workstation: have it commit its own change alone, on a branch of its own, and push that branch, then fetch it here/, key);
    // (fails before: yes — sync found no worktree and went on as a follow-up, nothing synced and nothing said; the
    // s-launch hunt's)
    const before2 = briefed().length + up.received.length;
    await assert.rejects(call({ agent_id: sa.id, sync: true, prompt: "go on" }), /works on Workstation, in its clone there: sync brings this folder into a worktree here, and it has none/);
    assert.equal(briefed().length + up.received.length, before2, "no follow-up went");
  });

  // (fails before: yes — one on another machine had no run here: its thread here said Starting until its report came
  // whole, its words as they were written seen on that machine alone)
  test("its turn there is a run here while it works: its words and thinking as they stream, its rounds in that run's log, ended as its exchange ends", async () => {
    const res = await call({ machine: "workstation", cwd: thereMain, description: "Say it slowly", prompt: "STREAM: say it slowly.", model: MODEL, run_in_background: true });
    assert.equal(res.ok, true, res.text);
    const row = () => registry.list(chainId).find((/** @type {any} */ r) => r.description === "Say it slowly");
    await until(() => !!row()?.exchanges?.at(-1)?.mirror, "its run here");
    const shown = String(row().exchanges.at(-1).mirror);
    assert.match(shown, /^rsa-[0-9a-f]{12}$/);
    assert.equal(row().exchanges.at(-1).runId ?? null, null, "never its runId, which a stop steers into");
    const app = /** @type {any} */ (two.here.app);
    await until(() => app.liveWords.blocks(shown).some((/** @type {any} */ b) => b.type === "text" && b.text === "FIRST WORDS "), "its words as they stream");
    assert.deepEqual(app.liveWords.blocks(shown).map((/** @type {any} */ b) => [b.type, b.text]), [["thinking", "WEIGHING "], ["text", "FIRST WORDS "]]);
    const meta = app.runs.getRun(shown);
    assert.deepEqual([meta?.kind, meta?.endedAt ?? null, meta?.meta?.chain ?? null, meta?.meta?.machine], ["remote-subagent", null, null, "Workstation"], "running, and no chat here reads as working for it");
    const started = app.runs.events(shown, { since: 0 }).events.filter((/** @type {any} */ e) => e.type === "round-start");
    assert.deepEqual(started.map((/** @type {any} */ e) => e.blocksBefore), [0], "where its round's words begin among them");
    streamed.splice(0).forEach((go) => go());
    await until(() => row()?.status === "done", "its report");
    await until(() => app.runs.getRun(shown)?.endedAt != null, "its run here ended");
    assert.equal(app.runs.getRun(shown).status, "done");
    assert.deepEqual(app.liveWords.blocks(shown), [], "its words let go of with its end");
    const log = app.runs.events(shown, { since: 0 }).events;
    assert.ok(log.some((/** @type {any} */ e) => e.type === "round-text" && /FIRST WORDS AND THE REST/.test(String(e.text))), "its round's words, whole, in its log");
    assert.deepEqual(log.filter((/** @type {any} */ e) => e.type === "run-start" || e.type === "run-end").map((/** @type {any} */ e) => e.type), ["run-start", "run-end"], "its own start and end alone: that machine's stay there");
    assert.deepEqual(log.filter((/** @type {any} */ e) => /^(ask|steer|subagent|visual|artifact|graph)/.test(String(e.type))), [], "what that machine keeps stays there");
    // A follow-up is a run of its own, its exchange's.
    const again = await call({ agent_id: row().id, prompt: "FOLLOW: once more", run_in_background: false });
    assert.equal(again.ok, true, again.text);
    const next = String(row().exchanges.at(-1).mirror);
    assert.notEqual(next, shown);
    assert.equal(app.runs.getRun(next)?.status, "done");
  });

  // (fails before: yes — the agent tool took no machine: the patch went to a sub-agent on this machine)
  test("changes: the uncommitted changes here go to it as a patch, beside where it runs", async () => {
    writeFileSync(join(hereRepo, "readme.md"), "widgets\nand gadgets\n");
    try {
      const before = briefed().length;
      const res = await call({ machine: "Workstation", cwd: thereMain, description: "Look at the change", prompt: "Review what changed.", model: MODEL, changes: "uncommitted", run_in_background: false });
      assert.equal(res.ok, true, res.text);
      const first = wordsOf(briefed()[before]?.body?.messages?.[0]);
      assert.match(first, /^Where you run: on Workstation/);
      assert.match(first, /Sync: none — this folder is at the same commit\. The patch below carries its uncommitted changes alone\./);
      assert.match(first, /<changes source="uncommitted" files="1">[\s\S]*\+and gadgets/);
      assert.match(first, /Review what changed\.$/);
    } finally {
      gitIn(hereRepo, "checkout", "--", "readme.md");
    }
  });

  // (fails before: yes — a launch that named no folder there ran in the person's clone there, matched by its git remote,
  // at whatever commit it stood; cp-place)
  test("a launch that names no folder there works in a copy of this chat's folder made for it: the first to that machine on the person's press on its card, the next unasked; told first; its chat there holds its copy, one launched while it does gets its own, and once a newer launch took it a follow-up is refused in words", async () => {
    pressing = false;
    writeFileSync(join(hereRepo, "draft.md"), "not committed\n");
    writeFileSync(join(hereRepo, ".env"), "TOKEN=here\n");
    /** The sub-agent of this chat asking for a copy's send, and its ask. */
    const asking = () => {
      for (const row of registry.list(chainId)) {
        const a = registry.get(row.id)?.progress?.asking;
        if (a?.tool === SEND_COPY) return { id: String(row.id), a };
      }
      return null;
    };
    try {
      const before = briefed().length;
      const going = call({ machine: "Workstation", description: "Work in a copy", prompt: "Look at the copy.", model: MODEL, run_in_background: false });
      await until(() => !!asking(), "the copy's ask on its card");
      const q = /** @type {{ id: string, a: any }} */ (asking());
      assert.equal(q.a.verb, "wants to send");
      assert.match(q.a.args, /^a copy of widgets to Workstation: \d+ files, \d+ KB; kept here: \.env$/);
      // (fails before: yes — the re-read of 11-11, its finding 4: the files in no commit, which go too, were named nowhere)
      assert.match(q.a.question, /^Send a copy of widgets to Workstation for this sub-agent to work in\? \d+ files, \d+ KB as a bundle\. 1 of them is in no commit here: draft\.md\. What stays here: \.env \([^)]+\)\. Asked once for this project and machine: later launches send what changed\.$/);
      assert.equal(briefed().length, before, "nothing went there before the press");
      assert.equal(registry.answer(q.id, chainId, "Allow", { allow: true, n: q.a.n }).ok, true);
      const res = await going;
      assert.equal(res.ok, true, res.text);
      assert.match(res.text, /REPORT FROM THERE/);
      assert.match(res.text, /It worked on Workstation, in its own copy of widgets there, and changed nothing\./);
      const sa = registry.get(q.id);
      const copy = sa.remote.copy;
      assert.deepEqual([copy?.project, copy?.commit?.length], ["widgets", 40]);
      assert.deepEqual([sa.work?.there, sa.work?.pending, String(sa.work?.sig).split(":")[0]], [true, 0, copy.commit.slice(0, 12)], "its work: from the copy sent, nothing changed yet");
      const folder = String(sa.remote.cwd);
      assert.ok(real(folder).startsWith(real(copiesThere)), `in the copies folder there: ${folder}`);
      assert.match(folder, /[\\/]widgets[\\/]1$/);
      assert.equal(readFileSync(join(folder, "draft.md"), "utf8").replace(/\r\n/g, "\n"), "not committed\n", "its uncommitted files there");
      assert.equal(existsSync(join(folder, ".env")), false, "its secret held back");
      const there = ((await (await two.there.api("/api/memory/sessions?limit=50")).json()).sessions || []).find((/** @type {any} */ s) => s.id === sa.remote.chat);
      assert.equal(real(String(there?.cwd)), real(folder), "its chat there works in the copy");
      // (fails before: yes — the review of cp-place: a second chat of their agents' in that copy worked under its turns)
      const agents = createMachines({ dataDir: two.here.dataDir });
      const theirs = await agents.clientOf(agents.list()[0], { agents: true });
      await assert.rejects(theirs.post("/sessions", { cwd: folder, model: "m-1" }), /is in a copy another launch's chat works in: a launch that names no folder takes a copy of its own/);
      // (fails before: yes — the re-review of cp-place: a chat started in a copy whose answer never came back held it,
      // and the launch's next try there was refused 409) A chat that ran no turn there gives the copy to the next.
      // As a launch's own ask goes: its repository named beside its folder's name (the review of 11-11).
      const fresh = await theirs.post("/transfers/place", { project: sa.remote.copy.project, repo: await repoKeyOf(hereRepo), commit: sa.remote.copy.commit });
      const unheard = await theirs.post("/sessions", { cwd: fresh.folder, model: "m-1" });
      const retried = await theirs.post("/sessions", { cwd: fresh.folder, model: "m-1" });
      assert.notEqual(retried.id, unheard.id);
      assert.equal(/** @type {any} */ (two.there.app).remoteCopies.get(fresh.copy)?.chat, retried.id, "the copy is the chat started again's");
      assert.ok(/** @type {any} */ (two.there.app).remoteCopies.release(fresh.copy));
      // Told first: the copy, as this folder stands, what was held back, and no sync.
      const head = gitIn(hereRepo, "rev-parse", "HEAD");
      const first = wordsOf(briefed()[before]?.body?.messages?.[0]);
      assert.match(first, /^Where you run: on Workstation \(/);
      assert.ok(first.includes(`: a copy of widgets made for you, as its folder stands on the machine that launched you (branch main at ${head.slice(0, 10)}, with its uncommitted changes)`), first);
      assert.match(first, /Held back there, so not here: \.env \(/);
      // (fails before: yes — the re-read of 11-11, its words: it was not told that a repository made in its copy stays
      // there, nor that one link out of its folder keeps everything it changed from going back)
      assert.match(first, /\nWhat you change here goes back to the machine that launched you as each of your turns ends — the files as you leave them, committed or not, less what \.gitignore leaves out, a secret's file, a file over 100 MB and a repository made inside this one, which stay here — for the agent that launched you to apply: say in your report what you changed\. A link that leads out of this folder, or a junction, keeps all of it from going back: make none, and take away one you made before your turn ends\. It is no clone of the person's: never push from it\.\n/);
      assert.match(first, /\nSync: none — this copy is that folder as it stands now\.\n/);
      assert.match(first, /Look at the copy\.$/);
      await assert.rejects(call({ agent_id: sa.id, sync: true, prompt: "go on" }), /works on Workstation, in its own copy there: sync brings this folder into a worktree here/);

      // (fails before: yes — what it changed stayed in its copy there, and the agent was told to ask it for its diff;
      // cp-back) What it changes there comes back as its turn ends, a secret made there left there, and applies here
      // as a local sub-agent's work does — but for send_back, which does not reach that copy.
      // (fails before: yes — finding 3 of the review of 11-11: a file it made there that stays there was never said, and
      // its report read "changed nothing")
      writeFileSync(join(folder, ".env.local"), "TOKEN=there\n");
      const secret = await call({ agent_id: sa.id, prompt: "FOLLOW: a secret?", run_in_background: false });
      assert.equal(secret.ok, true, secret.text);
      assert.match(secret.text, /It worked on Workstation, in its own copy of widgets there, and nothing it changed came back here\. What it made or changed there that stays in that copy, not brought here: a secret's file by its name: 1 \(\.env\.local\)\./);
      assert.doesNotMatch(secret.text, /changed nothing/);
      assert.deepEqual(registry.get(sa.id).work.left, [{ path: ".env.local", why: "a secret's file by its name" }], "kept with its work, for its Changes");
      writeFileSync(join(folder, "made-there.md"), "made there\n");
      writeFileSync(join(folder, "draft.md"), "changed there\n");
      writeFileSync(join(folder, ".env.local"), "TOKEN=there\n");
      // A follow-up: its chat there, in its copy, held again.
      const again = await call({ agent_id: sa.id, prompt: "FOLLOW: and the tests?", run_in_background: false });
      assert.equal(again.ok, true, again.text);
      assert.match(again.text, /FOLLOWED UP THERE/);
      assert.match(again.text, /It worked on Workstation, in its own copy of widgets there, and what it changed came back here, not into your folder yet: .*To apply it, call agent with agent_id "sa_[0-9a-f]+" and apply_changes: true .*overlap says what happens \("markers" or "mine"\)/s);
      assert.match(again.text, /The developer can apply it too\. What it made or changed there that stays in that copy, not brought here: a secret's file by its name: 1 \(\.env\.local\)\./);
      assert.deepEqual(registry.get(sa.id).work.files.map((/** @type {any} */ f) => f.path).sort(), ["draft.md", "made-there.md"]);
      await assert.rejects(call({ agent_id: sa.id, apply_changes: true, overlap: "send_back" }), /in its own copy there, which send_back does not reach: overlap is "markers" or "mine" for it/);
      const applied = await call({ agent_id: sa.id, apply_changes: true });
      assert.equal(applied.ok, true, applied.text);
      assert.equal(readFileSync(join(hereRepo, "made-there.md"), "utf8").replace(/\r\n/g, "\n"), "made there\n");
      assert.equal(readFileSync(join(hereRepo, "draft.md"), "utf8").replace(/\r\n/g, "\n"), "changed there\n");
      assert.equal(existsSync(join(hereRepo, ".env.local")), false, "a secret made there stays there");
      assert.equal(registry.get(sa.id).work.pending, 0, "applied: nothing waits");
      // (fails before: yes — the review of cp-back: the work an apply moved its base to was held by no ref)
      const held = () => gitIn(hereRepo, "for-each-ref", "--format=%(refname:lstrip=4) %(objectname)", `refs/filament/subagents/${sa.id}/`);
      await until(() => held().includes("applied "), "the applied work held");
      const appliedAt = String(registry.get(sa.id).work.sig).split(":")[0];
      assert.match(held(), new RegExp(`^applied ${appliedAt}[0-9a-f]{28}\ncopy ${copy.commit}$`));

      // A second launch while the first's chat holds its copy: unasked, a copy of its own.
      const second = await call({ machine: "Workstation", description: "Another copy", prompt: "Look again.", model: MODEL, run_in_background: false });
      assert.equal(second.ok, true, second.text);
      const sa2 = registry.list(chainId).map((/** @type {any} */ r) => registry.get(r.id)).find((/** @type {any} */ s) => s.description === "Another copy");
      assert.equal(sa2.questions, 0, "unasked: this project went to Workstation once already");
      assert.match(String(sa2.remote.cwd), /[\\/]widgets[\\/]2$/);
      assert.notEqual(sa2.remote.copy?.id, copy.id);

      // Let go there, the first's copy is taken by the next launch, and the first's follow-up is refused in words.
      assert.ok(/** @type {any} */ (two.there.app).remoteCopies.release(copy.id));
      // (fails before: yes — the review of cp-place: a coding agent's own background task there, run past its turn,
      // held nothing, and the next launch rewrote the copy under it)
      const acpThere = /** @type {any} */ (two.there.app).acp;
      acpThere.onTasks({ chain: sa.remote.chat, sessionId: "agent-copy", tasks: [{ id: "t-dev", kind: "local_bash", description: "npm run dev", background: true, since: Date.now() }] });
      const whileItWorks = await call({ machine: "Workstation", description: "While it works", prompt: "Look meanwhile.", model: MODEL, run_in_background: false });
      assert.equal(whileItWorks.ok, true, whileItWorks.text);
      const saWorks = registry.list(chainId).map((/** @type {any} */ r) => registry.get(r.id)).find((/** @type {any} */ s) => s.description === "While it works");
      assert.notEqual(saWorks.remote.copy?.id, copy.id, "its chat's background task holds the first's copy");
      acpThere.onTasks({ chain: sa.remote.chat, sessionId: "agent-copy", tasks: [] });
      const third = await call({ machine: "Workstation", description: "Its copy again", prompt: "Look once more.", model: MODEL, run_in_background: false });
      assert.equal(third.ok, true, third.text);
      const sa3 = registry.list(chainId).map((/** @type {any} */ r) => registry.get(r.id)).find((/** @type {any} */ s) => s.description === "Its copy again");
      assert.deepEqual([sa3.remote.copy?.id, real(String(sa3.remote.cwd))], [copy.id, real(folder)], "the idle copy taken again");
      // Its copy let go too, for the launches after (MAX_COPIES).
      assert.ok(/** @type {any} */ (two.there.app).remoteCopies.release(saWorks.remote.copy.id));
      const refused = await call({ agent_id: sa.id, prompt: "FOLLOW: once more", run_in_background: false });
      assert.match(JSON.stringify(refused), /this chat works in a copy another machine sent: its copy here went to a newer launch of its project once this chat let it go: a new launch takes a fresh one/);
      // (fails before: yes — the review of cp-back: its hold on the copy's commits stayed once its thread went)
      assert.equal((await registry.forget(sa.id, chainId)).ok, true);
      assert.equal(held(), "", "its holds go with its thread");
    } finally {
      pressing = true;
      rmSync(join(hereRepo, "draft.md"), { force: true });
      rmSync(join(hereRepo, "made-there.md"), { force: true });
      rmSync(join(hereRepo, ".env"), { force: true });
    }
  });

  // (fails before: yes — no machine was listed, and list_models answered this machine's models whatever machine named)
  test("list_machines says each machine kept for the agents, whether it answers, its system and its grants; list_models with machine, the models that answer there", async () => {
    const dead = await deadPort();
    createMachines({ dataDir: two.here.dataDir }).keep({ url: `https://127.0.0.1:${dead}`, fingerprint: two.remote.fingerprint, machine: { id: "11111111-1111-4111-8111-111111111111", name: "Offline box" }, device: { id: "d-off", name: "Filament agents", scope: "agent" }, token: "fdt_offline" });
    const listed = await call({ list_machines: true });
    assert.match(listed.text, /^Machines this Filament's agents may work on \(2\):/);
    assert.match(listed.text, /- Workstation: answers · .+ · grants on there: agents/);
    assert.match(listed.text, /- Offline box: does not answer now \(No Filament answers at https:\/\/127\.0\.0\.1:\d+/);
    const models = await call({ list_models: true, machine: "Workstation" });
    assert.match(models.text, /on Workstation/);
    assert.match(String(models.note), /listed the models that answer on Workstation/);
    // (fails before: yes — the hunt on s-tools: model and provider were dropped with machine, and list_machines beside
    // list_models was never answered)
    const all = Number(/^Models that answer on Workstation \((\d+)\)/.exec(models.text)?.[1] || 0);
    assert.ok(all > 0, models.text);
    const named = String(/\n- (\S+)/.exec(models.text)?.[1] || "");
    assert.ok(named, models.text);
    const narrowed = await call({ list_models: true, machine: "Workstation", model: named.toUpperCase() });
    assert.ok(narrowed.text.startsWith(`Models that answer on Workstation (1 of ${all}, named like "${named.toUpperCase()}")`), narrowed.text);
    assert.ok(narrowed.text.includes(`\n- ${named}`), narrowed.text);
    const none = await call({ list_models: true, machine: "Workstation", model: "no-such-model-anywhere" });
    assert.match(none.text, new RegExp(`^No model that answers on Workstation is named like "no-such-model-anywhere": list_models with machine and no model lists all ${all}\\.$`));
    const byProvider = await call({ list_models: true, machine: "Workstation", provider: "m" });
    assert.match(byProvider.text, /\nprovider narrows nothing on Workstation: its models are listed by name alone\.$/);
    const both = await call({ list_models: true, list_machines: true });
    assert.match(both.text, /\n\nMachines this Filament's agents may work on \(2\):/, both.text);
    assert.match(String(both.note), /, and the machines$/);
    // One that does not answer is refused before anything starts.
    const chats = await theirChats();
    await assert.rejects(call({ machine: "Offline box", prompt: "x", model: MODEL }), /No Filament answers at https:\/\/127\.0\.0\.1:/);
    assert.equal(await theirChats(), chats);
  });

  // (fails before: yes — machine was no field of the launch's: each of these launched on this machine)
  test("refused in words before anything starts: a machine not kept, what stays on this machine, a folder with no remote to match, the agents' grant off there", async () => {
    const subs = registry.list(chainId).length;
    const chats = await theirChats();
    await assert.rejects(call({ machine: "Nowhere", prompt: "x" }), /no machine "Nowhere" for this Filament's agents — the machines this Filament's agents may work on: Workstation/);
    await assert.rejects(call({ machine: "Workstation", prompt: "x", context: "fork" }), /a fork copies this chat's request stays on this machine — leave context out/);
    await assert.rejects(call({ machine: "Workstation", prompt: "x", context: "folded" }), /a view of this chat stays on this machine — leave context out/);
    await assert.rejects(call({ machine: "Workstation", prompt: "x", saved_agent: "hunter" }), /a saved agent runs on this machine/);
    await assert.rejects(call({ machine: "Workstation", prompt: "x", provider: "m" }), /provider names one of this machine's providers/);
    await assert.rejects(call({ machine: "Workstation", agent_id: "sa_00000000", prompt: "x" }), /a follow-up goes on where its launch ran — leave machine out/);
    await assert.rejects(call({ machine: "Workstation", prompt: "x", model: MODEL }, { cwd: plain }), /has no git remote to find its clone on Workstation by: name a folder there with cwd/);
    await grant(false);
    try {
      await assert.rejects(call({ machine: "Workstation", prompt: "x", model: MODEL }), /Workstation lets this Filament's agents work there no more: its grant is switched off there/);
      await assert.rejects(call({ list_models: true, machine: "Workstation" }), /grant is switched off/);
      assert.match((await call({ list_machines: true })).text, /- Workstation: answers · its agents' grant is off there/);
    } finally {
      await grant(true);
    }
    assert.equal(registry.list(chainId).length, subs, "no sub-agent here");
    assert.equal(await theirChats(), chats, "no chat there");
  });

  // (fails before: yes — with no model named its chat there had none, and that machine refused its message: "the session
  // has no model"; and its chat there started in that machine's own mode, not this chat's — the owner's of 11-10)
  test("a launch that names no model runs there on one that answers there, this chat's first; its chat there starts in this chat's mode", async () => {
    const res = await call({ machine: "Workstation", description: "No model named", prompt: "Look around.", run_in_background: false }, { mode: "auto" });
    assert.equal(res.ok, true, res.text);
    assert.match(res.text, /REPORT FROM THERE/);
    const sa = registry.list(chainId).find((/** @type {any} */ s) => s.description === "No model named");
    const chat = String(sa?.remote?.chat || "");
    assert.ok(chat, "its chat there");
    const client = await createMachines({ dataDir: two.here.dataDir }).clientOf("Workstation", { agents: true });
    const want = modelThere(await client.get("/models"), MODEL);
    assert.ok(want, "a model answers there");
    const settings = await (await two.there.api(`/api/sessions/${encodeURIComponent(chat)}/settings`)).json();
    assert.deepEqual([settings.effective?.model?.name, settings.effective?.loop?.permissions, sa.model], [want, "auto", want]);
    // A kind that reads runs read-only there, as here, whatever this chat's mode.
    const read = await call({ machine: "Workstation", subagent_type: "reviewer", description: "Read there", prompt: "Look around.", model: MODEL, run_in_background: false }, { mode: "auto" });
    assert.equal(read.ok, true, read.text);
    const reader = registry.list(chainId).find((/** @type {any} */ s) => s.description === "Read there");
    const its = await (await two.there.api(`/api/sessions/${encodeURIComponent(String(reader?.remote?.chat))}/settings`)).json();
    assert.equal(its.effective?.loop?.permissions, "read-only");
  });

  // (fails before: yes — POST /sessions/:id/stop and GET /models were no rows another machine's agents reached)
  test("the rows a sub-agent there needs answer the agents' device with its grant on, of its own chats alone; the house key alone is refused there", async () => {
    const pinned = pinnedFetch(two.there.lan.fingerprint);
    // The house key is per process, and the two Filaments of this test share it: alone, it opens nothing there.
    for (const [method, path, body] of [["GET", "/api/state"], ["POST", "/api/sessions", { cwd: thereMain, model: "m-1" }], ["GET", "/api/models"]]) {
      const r = await pinned(`${two.there.far}${path}`, { method: String(method), headers: { ...houseAuth(), ...(body ? JSON_TYPE : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal(r.status, 403, `${method} ${path} with the house key alone: ${r.status}`);
    }
    const v1 = await pinned(`${two.there.far}/v1/messages`, { method: "POST", headers: { ...houseAuth(), ...JSON_TYPE }, body: JSON.stringify({ model: MODEL, max_tokens: 10, messages: [{ role: "user", content: "hi" }] }) });
    // The model endpoints answer on the machine Filament runs on alone: its network door serves none of them.
    assert.ok([401, 403, 404].includes(v1.status), `/v1/messages with the house key alone: ${v1.status} ${await v1.text()}`);
    const client = await createMachines({ dataDir: two.here.dataDir }).clientOf("Workstation", { agents: true });
    assert.ok(Array.isArray((await client.get("/models")).models));
    // Another chat's stop is none of theirs: answered as one that is not there.
    await assert.rejects(client.post(`/sessions/${encodeURIComponent(personChat)}/stop`, {}), /no such session/);
    // Their own chat's Stop, never its Force stop.
    await assert.rejects(client.post(`/sessions/${encodeURIComponent(theirChat)}/stop`, { force: true }), /force is more than that/);
    assert.equal((await client.post(`/sessions/${encodeURIComponent(theirChat)}/stop`, {}))?.ok, true);
    await grant(false);
    try {
      await assert.rejects(createMachines({ dataDir: two.here.dataDir }).clientOf("Workstation", { agents: true }), (/** @type {any} */ e) => e.body?.grant === "agents");
    } finally {
      await grant(true);
    }
  });

  // (fails before: yes — the agents' device read the whole list: each model's provider, the providers and what asking
  // them said, errors included)
  test("GET /models gives the agents' device the models that answer, by name and label alone", async () => {
    const client = await createMachines({ dataDir: two.here.dataDir }).clientOf("Workstation", { agents: true });
    const j = await client.get("/models");
    assert.deepEqual(Object.keys(j), ["models"]);
    assert.ok(j.models.length > 0, JSON.stringify(j));
    for (const m of j.models) {
      assert.deepEqual(Object.keys(m).filter((k) => !["id", "label", "answers"].includes(k)), [], JSON.stringify(m));
      assert.equal(m.answers, true);
    }
    assert.ok(!JSON.stringify(j).includes(up.url), "no provider's address");
    // The person's own read of it there is whole.
    const theirs = await (await two.there.api("/api/models")).json();
    assert.ok(theirs.upstreams && theirs.families && theirs.models.some((/** @type {any} */ m) => m.upstream === "m"));
  });

  // (fails before: yes — the note was held for a run of this machine's that never comes, and the sender was told it went)
  test("a message to one running there is refused in words: it takes words as a follow-up once its turn ends", async () => {
    const w0 = waiting.length;
    const res = await call({ machine: "Workstation", description: "Busy there", prompt: "WAIT for a note", model: MODEL, run_in_background: true });
    const id = String(/sub-agent (sa_[0-9a-f]+)/.exec(res.text)?.[1]);
    await until(() => waiting.length > w0 && !!registry.get(id)?.remote?.run, "its model call there");
    try {
      const words = new RegExp(`^sub-agent ${id} runs on Workstation; it takes words when its turn ends: send them as a follow-up, with agent_id "${id}"$`);
      const lead = registry.message(id, { chainId, text: "also look at the tests", from: "lead" });
      assert.equal(lead.ok, false);
      assert.match(lead.error, words);
      const person = registry.developerMessage(id, { chainId, text: "and the docs" });
      assert.equal(person.ok, false);
      assert.match(person.error, words);
    } finally {
      registry.stop(id);
      await until(() => registry.get(id)?.status !== "running", "its end here");
    }
  });

  // (fails before: yes — main's follow-up to one at work, merged with this, went as a message, and was refused with
  // "send them as a follow-up, with agent_id": what the agent had just done, refused the same way again on every retry)
  test("a follow-up while it works there is refused in words that say its report comes first, never to send what was sent", async () => {
    const w0 = waiting.length;
    const res = await call({ machine: "Workstation", description: "Busy there too", prompt: "WAIT for a follow-up", model: MODEL, run_in_background: true });
    const id = String(/sub-agent (sa_[0-9a-f]+)/.exec(res.text)?.[1]);
    await until(() => waiting.length > w0 && !!registry.get(id)?.remote?.run, "its model call there");
    try {
      await assert.rejects(call({ agent_id: id, prompt: "also look at the tests" }), (/** @type {any} */ e) => {
        assert.equal(e.message, `sub-agent ${id} is still working on Workstation, which no message of this machine's reaches: its report comes first, then follow up with agent_id "${id}"`);
        return true;
      });
      assert.equal(registry.get(id)?.status, "running", "its turn there goes on");
    } finally {
      registry.stop(id);
      await until(() => registry.get(id)?.status !== "running", "its end here");
    }
  });

  // (fails before: yes — the follow-up sent its own words alone: the chat there, which had read nothing, never had its
  // brief or its task)
  test("a follow-up to one whose first turn never began there carries its brief and task with its words", async () => {
    const res = await call({ machine: "Workstation", description: "Never began", prompt: "Note the widgets.", model: MODEL, run_in_background: true });
    const id = String(/sub-agent (sa_[0-9a-f]+)/.exec(res.text)?.[1]);
    // Stopped as it starts: before its turn there began.
    registry.stop(id);
    await until(() => registry.get(id)?.status !== "running", "its end here");
    assert.ok(!registry.get(id).remote.run, "no turn of it began there");
    const before = briefed().length;
    const again = await call({ agent_id: id, prompt: "FOLLOW: and the gadgets?", run_in_background: false });
    assert.equal(again.ok, true, again.text);
    assert.match(again.text, /FOLLOWED UP THERE/);
    assert.equal(briefed().length, before + 1, "its chat there's first message opens with where it runs");
    const first = wordsOf(briefed().at(-1)?.body?.messages?.[0]);
    assert.match(first, /^Where you run: on Workstation/);
    assert.match(first, /Note the widgets\.\nFOLLOW: and the gadgets\?$/);
  });

  // (fails before: yes — the retry sent the chat there no words — its question was the last it had read — and that
  // machine refused an empty message: Retry always failed)
  test("Retry of one stopped there asks its question again, whole, in the same chat", async () => {
    const w0 = waiting.length;
    const res = await call({ machine: "Workstation", description: "Retry me", prompt: "ONCE: count the files", model: MODEL, run_in_background: true });
    const id = String(/sub-agent (sa_[0-9a-f]+)/.exec(res.text)?.[1]);
    await until(() => waiting.length > w0 && !!registry.get(id)?.remote?.run, "its model call there");
    const chat = registry.get(id).remote.chat;
    registry.stop(id);
    await until(() => registry.get(id)?.status !== "running", "its end here");
    assert.equal(registry.get(id).status, "aborted");
    const r = registry.followUp(id, { prompt: "", chainId, by: "owner", again: true, deliver: false });
    assert.equal(r.ok, true, r.error);
    const out = await r.done;
    assert.equal(out.ok, true, out.error);
    assert.match(out.report, /ANSWERED ONCE/);
    assert.equal(registry.get(id).remote.chat, chat, "the same chat there");
    const last = up.received.filter((c) => c.kind === "anthropic").at(-1);
    assert.match(wordsOf(last?.body?.messages?.at(-1)), /ONCE: count the files$/);
    // (fails before: yes — its marks in the chat named no machine: a transcript opened again, the registry's row not
    // yet read, said nothing of where it ran; the s-ui hunt's)
    const marks = /** @type {any} */ (two.here.app).memory.archive.getChain(chainId).meta.subagentMarks.filter((/** @type {any} */ m) => m.agentId === id);
    assert.ok(marks.some((/** @type {any} */ m) => m.event === "dispatch"), "the Retry is marked in the chat");
    assert.deepEqual([...new Set(marks.map((/** @type {any} */ m) => `${m.event}:${m.machine?.name}:${m.machine?.id}`))].sort(), [...new Set(marks.map((/** @type {any} */ m) => `${m.event}:Workstation:${two.there.machine.id}`))].sort());
  });

  // (fails before: yes — its model read "its default on Workstation" until its turn ended, and its launch said
  // "(Builder, its default on Workstation) on Workstation": the machine twice; the s-ui hunt's)
  test("a launch that names no model says its machine once: its model is its machine's default", async () => {
    const res = await call({ machine: "Workstation", description: "No model named", prompt: "Count the widgets.", run_in_background: true });
    assert.equal(res.ok, true, res.text);
    const id = String(/sub-agent (sa_[0-9a-f]+)/.exec(res.text)?.[1]);
    assert.match(String(res.note), /its machine's default\) on Workstation/);
    assert.equal(String(res.note).match(/Workstation/g)?.length, 1, String(res.note));
    await until(() => registry.get(id)?.status !== "running", "its end");
  });

  // (fails before: yes — nothing stopped its turn there: it ran on, and its follow-up was refused there as busy)
  test("a restart here while it ran there stops its turn there, says so, and its follow-up goes", async () => {
    const w0 = waiting.length;
    const res = await call({ machine: "Workstation", description: "Cut by a restart", prompt: "WAIT through a restart", model: MODEL, run_in_background: true });
    const id = String(/sub-agent (sa_[0-9a-f]+)/.exec(res.text)?.[1]);
    await until(() => waiting.length > w0 && !!registry.get(id)?.remote?.run, "its model call there");
    const run = String(registry.get(id).remote.run);
    const thread = /** @type {any} */ (two.here.app).sessions.loadSubagentThreads(chainId).find((/** @type {any} */ t) => t.id === id);
    assert.ok(thread?.remote?.chat && thread.exchanges.some((/** @type {any} */ x) => !x.outcome), "kept mid-run, its chat there named");
    // This machine after a restart: a registry of its own, reading the thread kept.
    const restarted = createSubagentRegistry({ config: () => ({ agentLoop: {} }), log: () => {}, events: { publish: () => {} }, runs: null, context: /** @type {any} */ ({ loadThreads: () => [structuredClone(thread)], settings: () => ({ subagents: {}, loop: { permissions: "edit" } }), session: () => ({ cwd: hereRepo, model: "m-1" }), mark: (/** @type {string} */ _c, /** @type {any} */ m) => m }), machines: createMachines({ dataDir: two.here.dataDir }) });
    assert.equal(restarted.list(chainId).find((s) => s.id === id)?.status, "aborted");
    assert.match(String(restarted.detail(id)?.exchanges.at(-1)?.error), /^Filament restarted before it finished: its turn on Workstation was sent a stop there$/);
    await until(() => /** @type {any} */ (two.there.app).runs.getRun(run)?.endedAt != null, "its run's end there");
    const r = restarted.followUp(id, { prompt: "FOLLOW: after the restart", chainId, by: "owner", deliver: false });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const out = await r.done;
    assert.equal(out.ok, true, String(out.error));
    assert.match(out.report, /FOLLOWED UP THERE/);
  });

  // (fails before: yes — there was no machine to stop a sub-agent on)
  test("a stop stops its turn there", async () => {
    const res = await call({ machine: "Workstation", description: "Wait there", prompt: "HOLD until told", model: MODEL, run_in_background: true });
    assert.match(res.text, /Launched sub-agent sa_[0-9a-f]+ \("Wait there"\) on Workstation/);
    const id = String(/sub-agent (sa_[0-9a-f]+)/.exec(res.text)?.[1]);
    await until(() => held.length > 0 && !!registry.get(id)?.remote?.run, "its model call there");
    const run = String(registry.get(id).remote.run);
    assert.deepEqual(registry.stop(id), { ok: true });
    await until(() => registry.get(id)?.status !== "running", "its end here");
    assert.equal(registry.get(id).status, "aborted");
    assert.match(String(registry.detail(id).exchanges.at(-1)?.error), /stopped on Workstation/);
    await until(() => /** @type {any} */ (two.there.app).runs.getRun(run)?.endedAt != null, "its run's end there");
  });

  // (fails before: yes — ag-stop, the owner's of 11-11: the agent tool had no stop — the call was a follow-up, refused as
  // one to a sub-agent still working there — and no message of this machine's reaches a turn there to ask it to stop)
  test("the agent tool's stop stops its turn there, as the developer's does: no special case, and its end is the agent's stop", async () => {
    const w0 = waiting.length;
    // In the person's clone there, named: a copy of its own would be one more than that machine keeps for this suite's launches.
    const res = await call({ machine: "Workstation", cwd: thereMain, description: "Stopped from here", prompt: "WAIT to be stopped", model: MODEL, run_in_background: true });
    const id = String(/sub-agent (sa_[0-9a-f]+)/.exec(res.text)?.[1]);
    await until(() => waiting.length > w0 && !!registry.get(id)?.remote?.run, "its model call there");
    const run = String(registry.get(id).remote.run);
    const out = await call({ description: "Stop it", agent_id: id, stop: true });
    assert.deepEqual([out.ok, out.text], [true, `Stopping sub-agent ${id} now, with no message sent to it. Its report so far arrives as a message. To take it up again in the context it has, call agent with agent_id "${id}" and a prompt.`]);
    assert.match(String(out.note), new RegExp(`^agent: stopped sub-agent ${id} \\(Builder, [^)]+\\) on Workstation$`));
    await until(() => registry.get(id)?.status !== "running", "its end here");
    assert.equal(registry.get(id).status, "aborted");
    assert.match(String(registry.detail(id).exchanges.at(-1)?.error), /stopped on Workstation/);
    const heard = String(registry.peekQueued(chainId).find((/** @type {any} */ d) => d.from === id)?.text);
    assert.ok(heard.startsWith(`[Filament: your background sub-agent ${id} ("Stopped from here") was stopped as you asked. You asked it:`), heard.slice(0, 300));
    await until(() => /** @type {any} */ (two.there.app).runs.getRun(run)?.endedAt != null, "its run's end there");
  });

  // (fails before: yes — there was no machine to lose mid-run)
  test("revoked mid-run, it ends with the words why, as a sub-agent that failed", async () => {
    const res = await call({ machine: "Workstation", description: "Cut off", prompt: "HOLD again", model: MODEL, run_in_background: true });
    const id = String(/sub-agent (sa_[0-9a-f]+)/.exec(res.text)?.[1]);
    await until(() => held.length > 1 && !!registry.get(id)?.remote?.run, "its model call there");
    const r = await two.there.api(`/api/remote/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
    assert.equal(r.status, 200, await r.clone().text());
    await until(() => registry.get(id)?.status !== "running", "its end here");
    assert.equal(registry.get(id).status, "failed");
    assert.match(String(registry.detail(id).exchanges.at(-1)?.error), /Workstation (refused this Filament's agents as their sub-agent worked|no longer knows this device)/);
  });
});
