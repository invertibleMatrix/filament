// @ts-check
// What a coding agent left running when its turn was stopped (HarnessV4_Tasks B13): what the command had started is
// read at the stop, before the agent hears its cancel; what of it still runs after is ended where the command was the
// one thing the agent's process was doing, and said on the turn; where the agent did other work meanwhile nothing is
// ended, and what still runs is named.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { leftRunning, leftRunningWords, listProcesses, readPsRows, readWindowsRows, startedSince, startedUnder, stillRunning } from "../src/adapters/agents/left-running.js";
import { FAKE_ACP_AGENT } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

/** Whether a process of this id still runs. @param {number} pid */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("the system's process table, read", () => {
  test("Windows' rows and ps's rows give each process its parent and when it began", () => {
    assert.deepEqual(readWindowsRows("4 0 1760000000000 System\r\n812 4 1760000001500 node.exe\r\n\r\nnot a row\r\n9 812 1760000002000 Code Helper.exe\r\n"), [
      { pid: 4, ppid: 0, startedAt: 1760000000000, name: "System" },
      { pid: 812, ppid: 4, startedAt: 1760000001500, name: "node.exe" },
      { pid: 9, ppid: 812, startedAt: 1760000002000, name: "Code Helper.exe" },
    ]);
    // ps's age: mm:ss, hh:mm:ss, dd-hh:mm:ss.
    assert.deepEqual(readPsRows("    1     0 2-03:04:05 systemd\n  700     1    01:02:03 node\n  701   700       00:07 sh\n junk\n", 10_000_000_000), [
      { pid: 1, ppid: 0, startedAt: 10_000_000_000 - (((2 * 24 + 3) * 60 + 4) * 60 + 5) * 1000, name: "systemd" },
      { pid: 700, ppid: 1, startedAt: 10_000_000_000 - ((1 * 60 + 2) * 60 + 3) * 1000, name: "node" },
      { pid: 701, ppid: 700, startedAt: 10_000_000_000 - 7000, name: "sh" },
    ]);
  });

  const procs = [
    { pid: 1, ppid: 0, startedAt: 10, name: "init" },
    { pid: 50, ppid: 1, startedAt: 100, name: "filament" },
    { pid: 60, ppid: 50, startedAt: 200, name: "agent" },
    { pid: 61, ppid: 60, startedAt: 250, name: "helper" }, // the agent's own, there before the command
    { pid: 62, ppid: 61, startedAt: 520, name: "search" }, // born under the old helper since the command began
    { pid: 70, ppid: 60, startedAt: 500, name: "shell" }, // the command's shell
    { pid: 71, ppid: 70, startedAt: 510, name: "node" },
    { pid: 72, ppid: 71, startedAt: 530, name: "worker" },
    { pid: 90, ppid: 1, startedAt: 505, name: "elsewhere" }, // not the agent's
    { pid: 95, ppid: 70, startedAt: 300, name: "stale" }, // older than its parent: a reused id, no child of it
  ];

  test("what the agent's process has started since the command began: each new process, with all under it", async () => {
    assert.deepEqual(startedUnder(procs, 60, 400).map((p) => p.pid), [62, 70, 71, 72]);
    assert.deepEqual(startedUnder(procs, 60, 100).map((p) => p.pid), [61, 62, 70, 71, 72], "from earlier on: the helper, and what it started under it");
    assert.deepEqual(startedUnder(procs, 60, 600), []);
    assert.deepEqual(startedUnder(procs, 4242, 0), [], "an agent that is gone has nothing under it");
    // Read at the stop: the table as it is then, or none where it cannot be read.
    assert.deepEqual((await startedSince({ agentPid: 60, since: 400, list: async () => procs }))?.map((p) => p.pid), [62, 70, 71, 72]);
    assert.equal(await startedSince({ agentPid: 60, since: 400, list: async () => [] }), null);
  });

  // (fails before: yes — the read was given 4 s: its program was killed there, the table was none, and the Stop said
  // it could not read the system's processes)
  test("a table that takes longer than 4 s to read — a busy machine's, often busy with the very command stopped — is waited for, and read", async () => {
    const rows = "60 1 1760000000000 agent.exe\r\n70 60 1760000005000 powershell.exe\r\n71 70 1760000005100 node.exe\r\n";
    /** @type {string[]} */
    const said = [];
    // The program that reads the table answers after 5 s, run as the real one is: under the read's own wait.
    const slow = /** @type {any} */ ((_file, _args, options, done) => execFile(process.execPath, ["-e", `setTimeout(() => process.stdout.write(${JSON.stringify(rows)}), 5000)`], options, done));
    const began = Date.now();
    const was = await startedSince({ agentPid: 60, since: 1760000004000, platform: "win32", log: (_l, t) => void said.push(t), list: (o) => listProcesses({ ...o, exec: slow }) });
    assert.deepEqual([was?.map((p) => p.pid), said], [[70, 71], []]);
    assert.ok(Date.now() - began >= 5000, "the table came as its program answered, 5 s on");
  });

  // (fails before: yes — the live drive, 2026-10-11: Cursor's cancel ended the shell it ran the command in, and the
  // command, nobody's child from then, was looked for under the agent's process and never found)
  test("what of it still runs later: the tops of what is left, a shell's command once its shell is gone among them", () => {
    const was = startedUnder(procs, 60, 400);
    const gone = (/** @type {number[]} */ ...pids) => procs.filter((p) => !pids.includes(p.pid));
    assert.deepEqual(stillRunning(procs, was), [
      { pid: 62, name: "search", startedAt: 520, under: 0 },
      { pid: 70, name: "shell", startedAt: 500, under: 2 },
    ]);
    assert.deepEqual(stillRunning(gone(62, 70), was), [{ pid: 71, name: "node", startedAt: 510, under: 1 }], "the shell ended, what it ran left");
    assert.deepEqual(stillRunning(gone(62, 70, 71, 72), was), []);
    // Another process that took an id meanwhile is none of them; ps's whole second is the same process.
    assert.deepEqual(stillRunning([...gone(62, 70, 71, 72), { pid: 71, ppid: 1, startedAt: 9000, name: "other" }], was), []);
    assert.deepEqual(stillRunning([...gone(62, 70, 71, 72), { pid: 71, ppid: 1, startedAt: 1400, name: "node" }], was).map((b) => b.pid), [71]);
  });
});

describe("a stopped turn's command, left running", () => {
  const shell = { pid: 70, ppid: 60, startedAt: 500, name: "powershell.exe" };
  const node = { pid: 71, ppid: 70, startedAt: 510, name: "node.exe" };
  const base = [{ pid: 60, ppid: 1, startedAt: 200, name: "agent" }];
  /** A table that answers each look in turn, the last one for good. @param {any[][]} looks */
  const tables = (looks) => {
    let n = 0;
    return async () => looks[Math.min(n++, looks.length - 1)];
  };
  /** @param {Partial<Parameters<typeof leftRunning>[0]>} o */
  const look = (o) => {
    /** @type {number[]} */
    const ended = [];
    /** @type {number[]} */
    const paused = [];
    return leftRunning({ was: [shell, node], alone: true, platform: "win32", end: async (pid) => (ended.push(pid), true), pause: async (ms) => void paused.push(ms), ...o }).then((found) => ({ found, ended, paused }));
  };

  test("alone, it is ended with what runs under it; with other work about, nothing is, and it is named", async () => {
    const both = [...base, shell, node];
    const was = await look({ list: tables([both]) });
    assert.deepEqual([was.found, was.ended, was.paused], [{ ended: [{ pid: 70, name: "powershell.exe", startedAt: 500, under: 1 }], left: [], alone: true }, [70], [700]]);
    assert.equal(leftRunningWords(was.found, "Cursor"), "Cursor left the stopped command running, so Filament ended it: powershell.exe (process 70, 1 more under it).");
    // The agent ended its shell and left what the shell ran: that is what is ended.
    const orphan = await look({ list: tables([[...base, node]]) });
    assert.deepEqual([orphan.found?.ended, orphan.ended], [[{ pid: 71, name: "node.exe", startedAt: 510, under: 0 }], [71]]);
    assert.equal(leftRunningWords(orphan.found, "Cursor"), "Cursor left the stopped command running, so Filament ended it: node.exe (process 71).");
    const busy = await look({ list: tables([both]), alone: false });
    assert.deepEqual([busy.found?.ended, busy.found?.left.map((b) => b.pid), busy.ended], [[], [70], []]);
    assert.equal(
      leftRunningWords(busy.found, "Cursor"),
      "Something Cursor started while the stopped command ran is still running: powershell.exe (process 70, 1 more under it). Filament ended none of it: Cursor was doing other work then, and it cannot tell which of these the stopped command started.",
    );
  });

  test("an agent that ends its own command leaves nothing: gone at the first look, or by the second, nothing is ended or said", async () => {
    const none = await look({ list: tables([base]) });
    assert.deepEqual([none.found, none.ended, none.paused], [null, [], []], "nothing there: no second look");
    const dying = await look({ list: tables([[...base, shell, node], base]) });
    assert.deepEqual([dying.found, dying.ended, dying.paused], [null, [], [700]], "the agent was still ending it as it answered");
    // A command that had started nothing by the stop left nothing: the table is not read again.
    const nothing = await look({ was: [], list: () => assert.fail("no look") });
    assert.deepEqual([nothing.found, nothing.paused], [null, []]);
    assert.equal(leftRunningWords(null, "Cursor"), "");
  });

  test("one Filament could not end is said so, and so is a table that could not be read", async () => {
    const stuck = await look({ list: tables([[...base, shell]]), end: async () => false });
    assert.deepEqual([stuck.found?.ended, stuck.found?.left.map((b) => b.pid)], [[], [70]]);
    assert.equal(leftRunningWords(stuck.found, "Cursor"), "Cursor left the stopped command running, and Filament could not end it: powershell.exe (process 70).");
    const unread = "Filament could not read this system's processes, so it cannot tell whether Cursor left the stopped command running.";
    // Unread at the stop, or after it: nothing is ended, and the turn says what it does not know.
    for (const o of [{ was: null }, { list: tables([[]]) }, { list: tables([[...base, shell, node], []]) }]) {
      const blind = await look(o);
      assert.deepEqual([blind.found?.unread, blind.ended], [true, []]);
      assert.equal(leftRunningWords(blind.found, "Cursor"), unread);
    }
  });
});

// The fake agent runs its command as Cursor's CLI does — in a shell of its own, which its cancel ends, and not what
// the shell ran; the system's own table is read.
describe("on a real agent's process", () => {
  /** @type {string} */ let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-left-running-"));
  });
  after(() => removeDirs(dir));
  /** @param {string} id @param {Record<string, string>} env */
  const upstreamOf = (id, env) => ({ id, name: id, type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env, cwdDefault: dir, permissions: "allow-all" } });
  /** @param {string} text */
  const bodyOf = (text) => ({ model: "m", max_tokens: 100, messages: [{ role: "user", content: text }] });
  /**
   * A turn that runs the command, stopped once it runs: by its request's signal, or (`how`) by the turn's own cancel.
   * → the turn's end, its own words, and the command's process.
   * @param {string} id @param {string} words @param {"signal" | "turn"} [how]
   */
  const stoppedTurn = async (id, words, how = "signal") => {
    const b = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
    // The system's table is read through PowerShell, whose start alone took 3.6–5.7 s beside 64 busy processes and its
    // whole read 12–15 s, up against the stop's own 15 s: the read is what these tests are about, so it is given what
    // it takes, a loaded run's slowest too.
    b.processesWaitMs = 60_000;
    const pidFile = join(dir, `${id}.pid`);
    /** @type {string[]} */
    const own = [];
    const stop = new AbortController();
    const running = b.run({ upstream: upstreamOf(id, { FAKE_ACP_LEFT_PID: pidFile }), modelId: "fake-a", format: "anthropic", body: bodyOf(words), conversationId: id, signal: stop.signal, onEvent: (/** @type {any} */ ev) => void (ev.type === "text" && ev.own && own.push(ev.text)) });
    await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").length > 0, "the agent's command to start", { timeoutMs: 60_000 });
    const pid = Number(readFileSync(pidFile, "utf8"));
    assert.ok(alive(pid), "the command runs");
    if (how === "turn") void (/** @type {any} */ ([...b.turns.values()][0]).cancel());
    else stop.abort();
    const out = await running;
    return { b, out, own, pid };
  };
  /** @param {string} id @param {number} pid */
  const endedIt = (id, pid) => new RegExp(`^acp: ${id} left the stopped command running, so Filament ended it: \\S+ \\(process ${pid}(?:, \\d+ more under it)?\\)\\.$`);

  // (fails before: yes — HarnessV4_Tasks B13, seen live with Cursor's CLI on 2026-10-11: the turn ended 0.6 s after the
  // Stop and its command ran on for 83 s more, said nowhere; and, the fix's first cut, the live drive: the table was
  // read after the cancel, when the shell was gone and its command under nothing)
  test("a command the agent's own shell left running at the stop is ended, and the turn says so", async () => {
    const { b, out, own, pid } = await stoppedTurn("left-alone", "~leftcmd please");
    try {
      assert.equal(out.stopReason, "cancelled");
      await until(() => !alive(pid), "the command's process to end");
      const note = out.notes.find((/** @type {string} */ n) => /left the stopped command running/.test(n));
      assert.match(note, endedIt("left-alone", pid));
      assert.deepEqual(own, [`\n\n_filament: ${note.slice(5)}_\n\n`]);
      assert.equal([...b.procs.values()][0].exited, false, "the agent itself runs on");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the turn's own cancel told the agent to cancel and noted no stop: what its command left
  // running was never looked for)
  test("a stop that comes as the turn's own cancel — a hang-up of the request that resumed it — ends it as well", async () => {
    const { b, out, pid } = await stoppedTurn("left-turn", "~leftcmd please", "turn");
    try {
      assert.equal(out.stopReason, "cancelled");
      await until(() => !alive(pid), "the command's process to end");
      assert.match(out.notes.find((/** @type {string} */ n) => /left the stopped command running/.test(n)), endedIt("left-turn", pid));
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — nothing was said of it at all)
  test("where the agent began other work while the command ran, nothing is ended: what still runs is named", async () => {
    const { b, out, own, pid } = await stoppedTurn("left-busy", "~leftcmd ~leftbusy please");
    try {
      assert.equal(out.stopReason, "cancelled");
      const note = out.notes.find((/** @type {string} */ n) => /is still running/.test(n));
      assert.match(note, new RegExp(`^acp: Something left-busy started while the stopped command ran is still running: \\S+ \\(process ${pid}(?:, \\d+ more under it)?\\)\\. Filament ended none of it: `));
      assert.equal(own.length, 1);
      assert.ok(alive(pid), "the process runs on");
    } finally {
      try {
        process.kill(pid);
      } catch {}
      b.shutdown();
    }
  });
});
