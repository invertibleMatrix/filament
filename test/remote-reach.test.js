// @ts-check
// A sub-agent on another machine whose machine cannot be reached for a while (the review of 11-11): a gap in the network
// alone never stops its turn there — its run is asked for again, further and further apart, said unreachable past a
// bound and followed again once that machine answers —; a stop that could not be known to have landed is owed, kept
// with its thread across a restart, and goes before anything else is asked of its chat; and nothing is brought back
// from its copy while a stop is owed. The other machine is a client the test answers for (no network), as
// remote-subagent.test.js's are; the registry is the real one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as remoteAgents from "../src/app/agent/remote-agents.js";
import { createRemoteAgents } from "../src/app/agent/remote-agents.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { CliError } from "../src/services/machines/client.js";

/** One machine kept for the agents, "Box", whose admin API is `client`. @param {any} client */
const oneMachine = (client) => {
  const m = { machine: { id: "m1" }, name: "Box", device: { scope: "agent" } };
  return /** @type {any} */ ({ list: () => [m], find: () => m, clientOf: async () => client });
};
/** A chat on Box, before its first turn. @returns {import("../src/app/agent/remote-agents.js").RemoteChat} */
const onBox = () => ({ machine: { id: "m1", name: "Box" }, cwd: "/w", chat: null, model: null, effort: null });
/** A run's event on a turn's stream, as the other Filament sends it. @param {any} event @returns {[string, any]} */
const runEvent = (event) => ["message", { type: "filament_run", event: { runId: "r1", ...event } }];
/** A read that did not reach the machine. @param {string} [code] */
const unreached = (code = "ETIMEDOUT") => Object.assign(new Error(`connect ${code}`), { code });

// (fails before: yes — finding 6 of the review of 11-11: a stop that reached that machine before the turn its message
// starts was registered there stopped nothing, and was said as "stopped on Box" while the turn ran on)
test("a stop that found no turn there, its run not seen yet: the chat's live state is read once — a turn that runs there is stopped again; with none, or unread, the stop is owed, in words that say so", async () => {
  /**
   * A turn stopped here as its message goes, before any event of its run: the first stop finds no turn there.
   * @param {{ live: () => any, second?: () => any, first?: () => any }} o
   */
  const stoppedEarly = async ({ live, second = () => ({ ok: true, holder: null, stopped: null }), first = () => ({ ok: true, holder: null, stopped: null }) }) => {
    /** @type {string[]} */
    const posted = [];
    /** @type {string[]} */
    const read = [];
    let stops = 0;
    const ctrl = new AbortController();
    const client = {
      state: { takes: ["mode"] },
      post: async (/** @type {string} */ path) => {
        posted.push(path);
        if (path.endsWith("/stop")) return ++stops === 1 ? first() : second();
        return { id: "c1", model: "m-1" };
      },
      stream: async (/** @type {string} */ _p, /** @type {any} */ _b, /** @type {any} */ _on, /** @type {any} */ o) => {
        ctrl.abort();
        if (o.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
      get: async (/** @type {string} */ path) => {
        read.push(path);
        return live();
      },
    };
    const remote = onBox();
    const fin = await createRemoteAgents({ machines: oneMachine(client), wait: async () => {} }).turn(remote, { content: [{ type: "text", text: "go" }], signal: ctrl.signal });
    return { fin, remote, stops: posted.filter((p) => p.endsWith("/stop")).length, read };
  };
  // A turn runs there after all: stopped again, and that stop took it.
  const ran = await stoppedEarly({ live: () => ({ live: { requestId: "r1" } }), second: () => ({ ok: true, holder: { window: "harness" }, stopped: "steered" }) });
  assert.deepEqual([ran.fin.status, ran.fin.error, ran.stops, ran.read], ["aborted", "stopped on Box", 2, ["/sessions/c1/live-state"]]);
  assert.equal(ran.remote.stopOwed, undefined);
  // None runs there as it is read: its message may still start one, so the stop is owed.
  const none = await stoppedEarly({ live: () => ({ live: null }) });
  assert.deepEqual([none.fin.status, none.stops, none.remote.stopOwed], ["aborted", 1, true]);
  assert.match(String(none.fin.error), /^stopped here before a turn of it was seen on Box, where the stop found none: its message may still start one there, and a stop is sent again before anything else is asked of its chat$/);
  // Its live state could not be read: owed.
  const unread = await stoppedEarly({
    live: () => {
      throw unreached();
    },
  });
  assert.deepEqual([unread.stops, unread.remote.stopOwed], [1, true]);
  assert.match(String(unread.fin.error), /^stopped here before a turn of it was seen on Box/);
  // A turn runs there, and the second stop does not reach it: owed, said as a stop that did not reach.
  const cut = await stoppedEarly({
    live: () => ({ live: { requestId: "r1" } }),
    second: () => {
      throw unreached("ECONNREFUSED");
    },
  });
  assert.deepEqual([cut.stops, cut.remote.stopOwed], [2, true]);
  assert.match(String(cut.fin.error), /^stopped here, and the stop did not reach Box \(.*ECONNREFUSED.*\): its turn there may still run/);
  // The first stop took a turn there: nothing more is read or sent.
  const took = await stoppedEarly({ live: () => ({ live: null }), first: () => ({ ok: true, holder: { window: "harness" }, stopped: "steered" }) });
  assert.deepEqual([took.fin.error, took.stops, took.read, took.remote.stopOwed], ["stopped on Box", 1, [], undefined]);
});

/**
 * A turn on Box whose stream says a round's first words ("HALF") and drops, its run's events then read by its id:
 * `events(k)` answers the k-th such read (from 1), or throws where Box does not answer it. Its posts, its reads, the
 * waits between them and what `onAway` was told are kept.
 * @param {{ events: (k: number, path: string) => any, stop?: () => any, onWait?: (n: number, ctrl: AbortController) => void }} o
 */
const dropped = async ({ events, stop = () => ({ ok: true, holder: { window: "harness" }, stopped: "steered" }), onWait = () => {} }) => {
  /** @type {string[]} */
  const posted = [];
  /** @type {string[]} */
  const read = [];
  /** @type {number[]} */
  const waits = [];
  /** @type {any[]} */
  const away = [];
  const ctrl = new AbortController();
  let k = 0;
  const client = {
    state: { takes: ["mode"] },
    post: async (/** @type {string} */ path) => {
      posted.push(path);
      if (path.endsWith("/stop")) return stop();
      return { id: "c1", model: "m-1" };
    },
    stream: async (/** @type {string} */ _p, /** @type {any} */ _b, /** @type {(e: string, d: any) => void} */ onEvent) => {
      onEvent(...runEvent({ n: 1, type: "round-start", round: 1 }));
      onEvent(...runEvent({ n: 2, type: "round-text", round: 1, text: "HALF" }));
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    },
    get: async (/** @type {string} */ path) => {
      read.push(path);
      return events(++k, path);
    },
  };
  const wait = async (/** @type {number} */ ms) => {
    waits.push(ms);
    onWait(waits.length, ctrl);
  };
  const remote = onBox();
  const fin = await createRemoteAgents({ machines: oneMachine(client), wait }).turn(remote, { content: [{ type: "text", text: "go" }], signal: ctrl.signal, onAway: (/** @type {any} */ a) => away.push(a) });
  return { fin, remote, posted, read, waits, away };
};
/** The rest of the run "HALF" began, as a page of its events. */
const rest = () => ({ events: [{ runId: "r1", n: 3, type: "round-text", round: 1, text: "REST" }, { runId: "r1", n: 4, type: "run-end", status: "done", summary: { rounds: 1 } }] });

// (fails before: yes — finding 1 of the review of 11-11: five reads Box did not answer, a few seconds in all, ended its
// sub-agent's turn as failed and sent it a stop, while it worked on there)
test("a turn there outlives the reads its machine does not answer: asked again further and further apart, said unreachable once past the bound, never stopped — and followed again by its run's id from where it stood once the machine answers", async () => {
  const { FOLLOW_MAX_MS, UNREACHABLE_AFTER_MS, UNREACHABLE_AGAIN_MS } = /** @type {any} */ (remoteAgents);
  // Seventeen reads unanswered — five minutes and more —, then Box answers.
  const out = await dropped({
    events: (k) => {
      if (k <= 17) throw unreached();
      return rest();
    },
  });
  assert.deepEqual([out.fin.status, out.fin.report, out.fin.error], ["done", "HALF\nREST", null], "its turn went on there, and its end is read");
  assert.ok(!out.posted.some((p) => p.endsWith("/stop")), `nothing stopped there: ${out.posted.join(" ")}`);
  assert.equal(out.remote.stopOwed, undefined);
  assert.deepEqual([FOLLOW_MAX_MS, UNREACHABLE_AFTER_MS, UNREACHABLE_AGAIN_MS], [30_000, 5 * 60_000, 60_000], "the bounds, named");
  // Each read asks for what came after the last event seen, by the run's id: nothing is read twice, nothing skipped.
  assert.deepEqual([...new Set(out.read)], ["/runs/r1/events?since=2"]);
  assert.equal(out.read.length, 18);
  // The waits grow to the most, then go a minute apart once it is said unreachable.
  assert.deepEqual(out.waits, [1000, 2000, 4000, 8000, 16_000, ...Array(9).fill(FOLLOW_MAX_MS), ...Array(3).fill(UNREACHABLE_AGAIN_MS)]);
  // Said once, past the bound, with what the last read said; and once more when Box answers.
  assert.equal(out.away.length, 2, JSON.stringify(out.away));
  assert.ok(out.away[0].ms >= UNREACHABLE_AFTER_MS && out.away[0].ms < UNREACHABLE_AFTER_MS + FOLLOW_MAX_MS, String(out.away[0].ms));
  assert.match(out.away[0].why, /ETIMEDOUT/);
  assert.equal(out.away[1], null);
  assert.equal(/** @type {any} */ (remoteAgents).unreachableWords("Box"), "unreachable: it may still be running on Box");

  // A gap shorter than the bound is said to nobody.
  const short = await dropped({
    events: (k) => {
      if (k <= 6) throw unreached("ECONNRESET");
      return rest();
    },
  });
  assert.deepEqual([short.fin.status, short.fin.report, short.away, short.posted.filter((p) => p.endsWith("/stop"))], ["done", "HALF\nREST", [], []]);

  // A Filament there that answers it cannot now (HTTP 502 through a relay, 503 as it starts) is no refusal either.
  const starting = await dropped({
    events: (k) => {
      if (k <= 6) throw Object.assign(new CliError("HTTP 503"), { status: 503 });
      return rest();
    },
  });
  assert.deepEqual([starting.fin.status, starting.fin.report, starting.posted.filter((p) => p.endsWith("/stop"))], ["done", "HALF\nREST", []]);
});

// (fails before: yes — finding 1: the sender gave up before Box answered, so it never learned how the turn ended there)
test("once its machine answers again, a turn that ended there meanwhile is said as it ended there: cut by a restart of Filament there, in those words, with the words it had said", async () => {
  const out = await dropped({
    events: (k) => {
      if (k <= 8) throw unreached("ECONNREFUSED");
      // Box restarted: the run an earlier process left open reads as `unknown`, with no more events.
      return { events: [], run: { id: "r1", status: "unknown", endedAt: 5, summary: {} } };
    },
  });
  assert.deepEqual([out.fin.status, out.fin.report], ["failed", "HALF"]);
  assert.equal(out.fin.error, "Filament on Box restarted while it ran, and its turn there was cut");
  assert.ok(!out.posted.some((p) => p.endsWith("/stop")), "a turn that ended there is sent no stop");
  assert.deepEqual(out.away, [], "eight reads are under the bound");
});

// (fails before: no — the person's Stop was, and stays, at once; it guards the waits above from holding it off)
test("the person's Stop while its machine does not answer stops at once here, and is owed where it cannot reach it; a refusal of this Filament's agents still ends the turn, with a stop", async () => {
  const out = await dropped({
    events: () => {
      throw unreached();
    },
    stop: () => {
      throw unreached("ECONNREFUSED");
    },
    // Stopped by the person during the third wait.
    onWait: (n, ctrl) => {
      if (n === 3) ctrl.abort();
    },
  });
  assert.deepEqual([out.fin.status, out.fin.report, out.waits.length], ["aborted", "HALF", 3]);
  assert.match(String(out.fin.error), /^stopped here, and the stop did not reach Box \(.*ECONNREFUSED.*\): its turn there may still run, and is sent a stop again before its next message$/);
  assert.equal(out.remote.stopOwed, true);

  // Box knows this Filament's agents no more (their device revoked): that is an answer, and ends the turn here.
  const refused = await dropped({
    events: () => {
      throw Object.assign(new CliError("this device is not known here"), { status: 403 });
    },
  });
  assert.deepEqual([refused.fin.status, refused.fin.report, refused.waits], ["failed", "HALF", []]);
  assert.match(String(refused.fin.error), /^Box refused this Filament's agents as their sub-agent worked: this device is not known here/);
  assert.deepEqual(refused.posted.filter((p) => p.endsWith("/stop")), ["/sessions/c1/stop"]);
});

// (fails before: yes — finding 1: a stream dropped before its run's first event, and a live state Box did not answer,
// read as "no turn there": a stop went and the launch failed, while the message may have begun a turn there)
test("dropped before its run's first event, its machine not answering what runs there: asked again until it answers, and the run its message began is followed — never read as none", async () => {
  /** @type {string[]} */
  const posted = [];
  /** @type {number[]} */
  const waits = [];
  let asked = 0;
  const client = {
    state: { takes: ["mode"] },
    post: async (/** @type {string} */ path) => (posted.push(path), { id: "c1", model: "m-1" }),
    stream: async () => {
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    },
    get: async (/** @type {string} */ path) => {
      if (path === "/sessions/c1/live-state") {
        if (++asked <= 3) throw unreached();
        return { live: { requestId: "r1" } };
      }
      assert.equal(path, "/runs/r1/events?since=0");
      return { events: [{ runId: "r1", n: 1, type: "round-text", round: 1, text: "WORDS THERE" }, { runId: "r1", n: 2, type: "run-end", status: "done", summary: {} }] };
    },
  };
  const remote = onBox();
  const fin = await createRemoteAgents({ machines: oneMachine(client), wait: async (/** @type {number} */ ms) => void waits.push(ms) }).turn(remote, { content: [{ type: "text", text: "go" }], signal: new AbortController().signal });
  assert.deepEqual([fin.status, fin.report, fin.error], ["done", "WORDS THERE", null]);
  assert.deepEqual([asked, waits, remote.run, remote.stopOwed], [4, [1000, 2000, 4000], "r1", undefined]);
  assert.ok(!posted.some((p) => p.endsWith("/stop")), "nothing stopped");
});

/** @param {() => any} ok @param {string} what @param {number} [ms] */
const until = async (ok, what, ms = 8000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};
/** A folder of the test's own, gone at its end. @param {import("node:test").TestContext} t @param {string} name */
const folderFor = (t, name) => {
  const dir = mkdtempSync(join(tmpdir(), `filament-remote-${name}-`));
  // A registry's own git calls may still run in it a moment after the test's last word: removed once they let go.
  t.after(async () => {
    for (let k = 0; ; k++)
      try {
        return rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        if (k >= 50) throw e;
        await new Promise((r) => setTimeout(r, 100));
      }
  });
  return dir;
};
/**
 * A registry here whose one machine is Box, answered by `client`, its sub-agents' threads kept in `threads` as a
 * session keeps them: another registry over the same `threads` is this Filament after a restart.
 * @param {any} client @param {{ folder: string, threads?: Map<string, any>, remoteWait?: (ms: number, signal: AbortSignal) => Promise<void>, published?: any[] }} o
 */
const registryOn = (client, { folder, threads = new Map(), remoteWait = async () => {}, published = [] }) =>
  createSubagentRegistry({
    config: () => /** @type {any} */ ({ agentLoop: {} }),
    log: () => {},
    events: { publish: (_topic, evt) => void published.push(evt) },
    runs: null,
    context: /** @type {any} */ ({
      settings: () => ({ subagents: {}, loop: { permissions: "edit" } }),
      modelProblem: () => null,
      session: () => ({ cwd: folder, model: "m-1" }),
      mark: (/** @type {string} */ _c, /** @type {any} */ m) => m,
      saveThread: (/** @type {string} */ _c, /** @type {any} */ thread) => void threads.set(thread.id, JSON.parse(JSON.stringify(thread))),
      loadThreads: () => [...threads.values()].map((x) => JSON.parse(JSON.stringify(x))),
    }),
    machines: oneMachine(client),
    .../** @type {any} */ ({ remoteWait }),
  });
/**
 * Box as a sub-agent's turn there loses it: its stream says a round's first words ("HALF") and drops, and its run's
 * events are then unanswered (`silent`), answered with nothing new (`idle`), or with the rest and its end (`end`), as
 * `phase` says. Reads Box does not answer wait on `held` once it is said unreachable, so the test sees that state.
 */
const losingBox = () => {
  /** @type {string[]} */
  const posted = [];
  const s = { phase: /** @type {"silent" | "idle" | "end"} */ ("silent"), release: () => {} };
  const held = new Promise((r) => (s.release = () => r(null)));
  const client = {
    state: { system: null, takes: ["mode"] },
    post: async (/** @type {string} */ path) => (posted.push(path), path === "/sessions" ? { id: "chat-1", model: "m-1" } : { ok: true, holder: { window: "harness" }, stopped: "steered" }),
    stream: async (/** @type {string} */ _p, /** @type {any} */ _b, /** @type {(e: string, d: any) => void} */ onEvent) => {
      onEvent(...runEvent({ n: 1, type: "round-start", round: 1 }));
      onEvent(...runEvent({ n: 2, type: "round-text", round: 1, text: "HALF" }));
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    },
    get: async (/** @type {string} */ path) => {
      if (path.endsWith("/asks")) return { asks: [] };
      if (!path.startsWith("/runs/")) return { events: [] };
      if (s.phase === "silent") throw unreached();
      return s.phase === "idle" ? { events: [] } : rest();
    },
  };
  /** @param {number} ms */
  const remoteWait = async (ms) => {
    if (ms === /** @type {any} */ (remoteAgents).UNREACHABLE_AGAIN_MS && s.phase === "silent") await held;
    await new Promise((r) => setTimeout(r, 2));
  };
  /** The test is over: Box answers, so no turn is left asking it. */
  const over = () => {
    s.phase = "end";
    s.release();
  };
  return { client, posted, s, remoteWait, over };
};
const AWAY = /^\[Filament: sub-agent (sa_[0-9a-f]+) \("Work there"\) is unreachable: it may still be running on Box\. Box has not answered Filament for 5 min \(connect ETIMEDOUT\)\. Filament has not stopped it there and has brought nothing back from it: what it does there meanwhile is not known here\. Filament asks Box again every 60 s; once Box answers, its turn is followed again from where it stood, or said as it ended there, and its report reaches you as a message from Filament then\. This turn does not wait for it: carry on, or end your turn\. Don't launch its task again on Box meanwhile\. The developer can stop it here: a stop that cannot reach Box is sent again before anything else is asked of its chat there\.\]$/;

// (fails before: yes — finding 1: the call that waited on it was answered "failed … Box stopped answering as its
// sub-agent worked" a few seconds into the gap, and its turn there was sent a stop)
test("a sub-agent whose machine does not answer past the bound is said unreachable to the agent that launched it, with what happens next: the call that waits on it is answered then, its turn waits for it no more, nothing is stopped — and once the machine answers, that is said, and its report comes as a message", async (t) => {
  const folder = folderFor(t, "away");
  const box = losingBox();
  /** @type {any[]} */
  const published = [];
  const registry = registryOn(box.client, { folder, remoteWait: box.remoteWait, published });
  t.after(box.over);
  const door = registry.openTurn({ chainId: "c-away", runId: "turn-away", cwd: folder, mode: "edit", model: "m-1", thinking: null, fork: null });
  const res = await door.subagents.run({ id: "toolu_away", input: { machine: "Box", cwd: "/w", description: "Work there", prompt: "Work.", run_in_background: false }, emit: () => {}, signal: null });
  assert.equal(res.ok, true, res.text);
  assert.match(res.text, AWAY);
  const id = String(AWAY.exec(res.text)?.[1]);
  // It works on, unstopped, as a background launch whose report the turn does not wait for.
  assert.deepEqual([registry.get(id)?.status, registry.get(id)?.background], ["running", true]);
  assert.ok(!box.posted.some((p) => p.endsWith("/stop")), `nothing stopped there: ${box.posted.join(" ")}`);
  assert.equal(door.inbox.owed(), null, "the turn waits for it no more");
  // Its card says the same words.
  const waitSaid = () => published.filter((e) => e.type === "subagent-progress" && e.id === id).at(-1)?.progress.wait;
  await until(() => waitSaid() === "unreachable: it may still be running on Box", `its card's line, which says ${waitSaid()}`);

  // Box answers again, its run still going there: said, as the agent read that it was unreachable.
  box.s.phase = "idle";
  box.s.release();
  /** @type {any[]} */
  const taken = [];
  await until(() => (taken.push(...door.inbox.take()), taken.length > 0), "the word that Box answers again");
  assert.equal(taken[0].text, `[Filament: Box answers again. Sub-agent ${id} ("Work there") was not stopped: its turn there is followed again from where it stood, or said as it ended there. Its report still comes as a message.]`);
  await until(() => waitSaid() === null, `its card's line cleared, which says ${waitSaid()}`);
  // Its turn there ends: its report comes whole, read from where the events stopped.
  box.s.phase = "end";
  await until(() => (taken.push(...door.inbox.take()), taken.some((d) => d.kind === "report")), "its report");
  assert.match(taken.find((d) => d.kind === "report").text, /HALF\nREST/);
  assert.equal(registry.get(id)?.status, "done");
  assert.ok(!box.posted.some((p) => p.endsWith("/stop")), "never stopped");
  door.close();
});

// (fails before: yes — finding 1: the launch failed and was stopped there; nothing said it may still run)
test("a background launch whose machine does not answer past the bound: its launcher is told by a notice — one not read yet when the machine answers again goes, with nothing said of a gap nobody heard of", async (t) => {
  const folder = folderFor(t, "away-bg");
  const box = losingBox();
  const registry = registryOn(box.client, { folder, remoteWait: box.remoteWait });
  t.after(box.over);
  const door = registry.openTurn({ chainId: "c-bg", runId: "turn-bg", cwd: folder, mode: "edit", model: "m-1", thinking: null, fork: null });
  const res = await door.subagents.run({ id: "toolu_bg", input: { machine: "Box", cwd: "/w", description: "Work there", prompt: "Work.", run_in_background: true }, emit: () => {}, signal: null });
  const id = String(/sub-agent (sa_[0-9a-f]+)/.exec(res.text)?.[1] || "");
  // Read by a turn at work: the notice, in the same words.
  /** @type {any[]} */
  const taken = [];
  await until(() => (taken.push(...door.inbox.take()), taken.length > 0), "the notice that it is unreachable");
  assert.deepEqual([taken[0].kind, taken[0].from], ["notice", id]);
  assert.match(taken[0].text, AWAY);
  assert.equal(door.inbox.owed(), null, "the turn waits for it no more");
  assert.equal(registry.get(id)?.status, "running");
  assert.ok(!box.posted.some((p) => p.endsWith("/stop")), "nothing stopped there");
  door.close();

  // A second one, with no turn at work: its notice waits for the chat's next turn, and goes once Box answers.
  const other = losingBox();
  const quiet = registryOn(other.client, { folder, remoteWait: other.remoteWait });
  t.after(other.over);
  const d2 = quiet.openTurn({ chainId: "c-quiet", runId: "turn-quiet", cwd: folder, mode: "edit", model: "m-1", thinking: null, fork: null });
  const r2 = await d2.subagents.run({ id: "toolu_quiet", input: { machine: "Box", cwd: "/w", description: "Work there", prompt: "Work.", run_in_background: true }, emit: () => {}, signal: null });
  const id2 = String(/sub-agent (sa_[0-9a-f]+)/.exec(r2.text)?.[1] || "");
  d2.close();
  await until(() => quiet.peekQueued("c-quiet").length > 0, "the notice, queued");
  assert.match(quiet.peekQueued("c-quiet")[0].text, AWAY);
  other.s.phase = "idle";
  other.s.release();
  await until(() => quiet.peekQueued("c-quiet").length === 0, "the unread notice gone");
  other.s.phase = "end";
  await until(() => quiet.get(id2)?.status === "done", "its end");
  assert.deepEqual(quiet.peekQueued("c-quiet").map((d) => d.kind), ["report"]);
  assert.match(quiet.peekQueued("c-quiet")[0].text, /HALF\nREST/);
  box.over();
  await until(() => registry.get(id)?.status === "done", "the first one's end");
});

/**
 * The thread of a sub-agent at work on Box as its session kept it mid-turn, for a restart here to read: its chat and
 * run there named, its exchange open. @param {import("node:test").TestContext} t @param {string} folder
 */
const keptMidTurn = async (t, folder) => {
  let release = () => {};
  const held = new Promise((r) => (release = () => r(null)));
  t.after(() => release());
  const client = {
    state: { system: null, takes: ["mode"] },
    post: async (/** @type {string} */ path) => (path === "/sessions" ? { id: "chat-1", model: "m-1" } : { ok: true }),
    get: async (/** @type {string} */ path) => (path.endsWith("/asks") ? { asks: [] } : { events: [] }),
    stream: async (/** @type {string} */ _p, /** @type {any} */ _b, /** @type {(e: string, d: any) => void} */ onEvent, /** @type {any} */ o) => {
      onEvent(...runEvent({ n: 1, type: "round-start", round: 1 }));
      await Promise.race([held, new Promise((r) => o.signal.addEventListener("abort", r, { once: true }))]);
      onEvent(...runEvent({ n: 2, type: "run-end", status: "done", summary: {} }));
    },
  };
  /** @type {Map<string, any>} */
  const threads = new Map();
  const registry = registryOn(client, { folder, threads });
  const door = registry.openTurn({ chainId: "c-cut", runId: "turn-cut", cwd: folder, mode: "edit", model: "m-1", thinking: null, fork: null });
  const res = await door.subagents.run({ id: "toolu_cut", input: { machine: "Box", cwd: "/w", description: "Work there", prompt: "Work.", run_in_background: true }, emit: () => {}, signal: null });
  const id = String(/sub-agent (sa_[0-9a-f]+)/.exec(res.text)?.[1] || "");
  await until(() => !!threads.get(id)?.remote?.run, "its thread kept with its run there");
  const thread = JSON.parse(JSON.stringify(threads.get(id)));
  assert.ok(thread.remote.chat === "chat-1" && thread.exchanges.some((/** @type {any} */ x) => !x.outcome), "kept mid-turn");
  door.close();
  release();
  await until(() => registry.get(id)?.status !== "running", "the first process's own end");
  return { id, thread };
};
/** Box after this Filament restarted: its posts and streams in order, a stop reaching it or not as `reach` says. */
const boxAfter = () => {
  /** @type {string[]} */
  const asked = [];
  const s = { reach: false };
  const client = {
    state: { system: null, takes: ["mode", "back"] },
    post: async (/** @type {string} */ path) => {
      asked.push(path);
      if (path.endsWith("/stop")) {
        if (!s.reach) throw unreached("ECONNREFUSED");
        return { ok: true, holder: { window: "harness" }, stopped: "steered" };
      }
      // A capture of its copy: nothing changed there.
      if (path === "/transfers/back") return { id: null, commit: "0".repeat(39) + "1", unchanged: true, left: [] };
      return { ok: true };
    },
    get: async (/** @type {string} */ path) => (path.endsWith("/asks") ? { asks: [] } : { events: [] }),
    stream: async (/** @type {string} */ path, /** @type {any} */ _b, /** @type {(e: string, d: any) => void} */ onEvent) => {
      asked.push(`stream ${path}`);
      onEvent(...runEvent({ runId: "r2", n: 1, type: "round-text", round: 1, text: "FOLLOWED UP THERE" }));
      onEvent(...runEvent({ runId: "r2", n: 2, type: "run-end", status: "done", summary: {} }));
    },
  };
  return { client, asked, s };
};

// (fails before: yes — finding 4: a restart-cut turn whose stop did not reach its machine was owed nothing: its thread
// kept no `stopOwed`, and after another restart nothing stopped it before its chat was asked more)
test("a turn a restart here cut, whose stop did not reach its machine: the stop is owed, kept with its thread — it goes again at the next start, and before the next message", async (t) => {
  const folder = folderFor(t, "owed");
  const { id, thread } = await keptMidTurn(t, folder);
  const threads = new Map([[id, thread]]);

  // After the restart: Box is not reached.
  const first = boxAfter();
  const restarted = registryOn(first.client, { folder, threads });
  assert.equal(restarted.list("c-cut").find((s) => s.id === id)?.status, "aborted");
  await until(() => /could not be stopped/.test(String(restarted.detail(id)?.exchanges.at(-1)?.error)), "the stop's failure, said");
  assert.equal(threads.get(id).remote.stopOwed, true, "the stop is owed, kept with its thread");
  assert.match(String(restarted.detail(id)?.exchanges.at(-1)?.error), /^Filament restarted before it finished, and its turn on Box could not be stopped \(connect ECONNREFUSED\): it may still run there, and is sent a stop again before anything else is asked of its chat$/);

  // Another restart, Box still away: the owed stop goes at once, and stays owed.
  const second = boxAfter();
  const again = registryOn(second.client, { folder, threads });
  assert.equal(again.list("c-cut").find((s) => s.id === id)?.status, "aborted");
  await until(() => second.asked.length === 1, "the owed stop, sent at the start");
  assert.deepEqual(second.asked, ["/sessions/chat-1/stop"]);
  assert.equal(threads.get(id).remote.stopOwed, true);
  // Box is back: the stop goes before the next message, and is owed no more.
  second.s.reach = true;
  const r = again.followUp(id, { prompt: "FOLLOW: after the restarts", chainId: "c-cut", by: "owner", deliver: false });
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  const out = await /** @type {any} */ (r).done;
  assert.equal(out.ok, true, String(out.error));
  assert.match(out.report, /FOLLOWED UP THERE/);
  assert.deepEqual(second.asked, ["/sessions/chat-1/stop", "/sessions/chat-1/stop", "stream /sessions/chat-1/turns"]);
  assert.equal(threads.get(id).remote.stopOwed, undefined, "owed no more once it reached Box");
});

// (fails before: yes — the owed stop a start sends was not waited for by the next message: the message sent a stop of
// its own, which Box answered first, and began its turn there with the start's stop still on its way to land on it)
test("a message to its chat waits for an owed stop that is still on its way: its turn there begins once that stop is through, and no stop lands on it", async (t) => {
  const folder = folderFor(t, "owed-way");
  const { id, thread } = await keptMidTurn(t, folder);
  const threads = new Map([[id, thread]]);
  // A restart that could not reach Box leaves its stop owed, its exchange ended.
  const restarted = registryOn(boxAfter().client, { folder, threads });
  restarted.list("c-cut");
  await until(() => threads.get(id).remote.stopOwed === true, "the stop owed, kept with its thread");

  // The next start: Box takes the owed stop slowly, as over a network that is coming back.
  const box = boxAfter();
  let through = () => {};
  const way = new Promise((r) => (through = () => r(null)));
  t.after(() => through());
  let stops = 0;
  const client = {
    ...box.client,
    post: async (/** @type {string} */ path) => {
      if (!path.endsWith("/stop")) return box.client.post(path);
      const n = ++stops;
      box.asked.push(`stop ${n} sent`);
      if (n === 1) await way;
      box.asked.push(`stop ${n} through`);
      return { ok: true, holder: { window: "harness" }, stopped: "steered" };
    },
  };
  const again = registryOn(client, { folder, threads });
  again.list("c-cut");
  await until(() => box.asked.length === 1, "the owed stop, sent at the start");
  const r = again.followUp(id, { prompt: "FOLLOW: as the stop is on its way", chainId: "c-cut", by: "owner", deliver: false });
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  await new Promise((res) => setTimeout(res, 300));
  assert.deepEqual(box.asked, ["stop 1 sent"], "nothing more is asked of Box while that stop is on its way");
  through();
  const out = await /** @type {any} */ (r).done;
  assert.equal(out.ok, true, String(out.error));
  assert.match(out.report, /FOLLOWED UP THERE/);
  assert.deepEqual(box.asked, ["stop 1 sent", "stop 1 through", "stream /sessions/chat-1/turns"]);
  assert.equal(threads.get(id).remote.stopOwed, undefined, "owed no more");
});

// (fails before: yes — findings 1 and 4: after a stop that did not reach Box, what its copy held was asked for at
// once — a capture of a copy a turn may still be writing in, brought here as its work)
test("nothing is asked of its copy there while a stop is owed: the stop goes first, and its copy is read only once it reached the machine", async (t) => {
  const folder = folderFor(t, "owed-copy");
  // The project here, at the commit its copy there was made from.
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: folder, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  writeFileSync(join(folder, "a.txt"), "one\n");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "one");
  const base = git("rev-parse", "HEAD");
  const kept = await keptMidTurn(t, folder);
  // Its thread as one at work in a copy of the project there is kept: its copy named, its work there.
  const thread = { ...kept.thread, work: { repo: folder, base, head: null, files: [], applied: [], there: true }, remote: { ...kept.thread.remote, copy: { id: "copy-1", project: "widgets", commit: base } } };
  const threads = new Map([[kept.id, thread]]);

  const first = boxAfter();
  const restarted = registryOn(first.client, { folder, threads });
  assert.equal(restarted.list("c-cut").find((s) => s.id === kept.id)?.status, "aborted");
  await until(() => first.asked.length >= 2, "what is asked of Box after the stop that did not reach it");
  assert.deepEqual([...new Set(first.asked)], ["/sessions/chat-1/stop"], "no capture is asked of a copy a turn may still write in");
  await until(() => !!restarted.get(kept.id)?.work?.error, "why nothing came back");
  assert.match(String(restarted.get(kept.id)?.work?.error), /^nothing is brought here from its copy on Box yet: its turn there may still run, as the stop it is owed did not reach Box \(connect ECONNREFUSED\) — its copy is read once that stop has$/);
  assert.equal(threads.get(kept.id).remote.stopOwed, true);

  // The next start, Box back: the owed stop first, then its copy.
  const second = boxAfter();
  second.s.reach = true;
  const again = registryOn(second.client, { folder, threads });
  again.list("c-cut");
  await until(() => second.asked.includes("/transfers/back"), "its copy, read");
  assert.deepEqual(second.asked, ["/sessions/chat-1/stop", "/transfers/back"]);
  await until(() => threads.get(kept.id).remote.stopOwed === undefined, "owed no more");
});
