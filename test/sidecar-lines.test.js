// The memory engine's answers are read a line each off its stdout (adapters/sidecar/client.js): however the pipe cuts
// them — an answer in many chunks, several answers in one, a blank line or one that is not JSON between them — each
// call gets its own answer, whole.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import { MemoryEngine } from "../src/adapters/sidecar/client.js";

/**
 * An engine process that answers each request with `answer(req)`, written back cut every `cut` characters.
 * @param {(req: any) => any} answer @param {number} cut
 */
function fakeEngine(answer, cut) {
  return () => {
    // No pid: a stop's kill is the child's own (no taskkill looks for a process by a made-up id), and it ends the child.
    const child = Object.assign(new EventEmitter(), { pid: 0, exitCode: /** @type {number | null} */ (null), signalCode: null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
    const exit = () => {
      if (child.exitCode != null) return;
      child.exitCode = 0;
      setImmediate(() => child.emit("exit", 0, null));
    };
    Object.assign(child, { kill: () => (exit(), true) });
    let pending = "";
    /** @type {string[]} */
    const out = [];
    const flush = () => {
      const text = out.splice(0).join("");
      for (let i = 0; i < text.length; i += cut) child.stdout.write(text.slice(i, i + cut));
    };
    child.stdin.setEncoding("utf8");
    child.stdin.on("data", (/** @type {string} */ d) => {
      pending += d;
      let nl;
      while ((nl = pending.indexOf("\n")) >= 0) {
        const req = JSON.parse(pending.slice(0, nl));
        pending = pending.slice(nl + 1);
        if (req.op === "shutdown") {
          out.push(`${JSON.stringify({ id: req.id, ok: true, result: {} })}\n`);
          setImmediate(exit);
          continue;
        }
        // A blank line and a line that is not JSON ride between the answers
        out.push(`\n${JSON.stringify(answer(req))}\r\nnot json\n`);
      }
      setImmediate(flush);
    });
    return child;
  };
}

// (fails before: yes — the bug hunt of 10-30: an answer of any size was held whole, and one past what a string takes
// threw in the pipe's handler)
test("an answer past 256 MiB is dropped unread: its call fails in words, the log says its size alone, and the next call is answered", { timeout: 120_000 }, async () => {
  const spawnImpl = () => {
    const child = Object.assign(new EventEmitter(), { pid: 0, exitCode: /** @type {number | null} */ (null), signalCode: null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
    const exit = () => {
      if (child.exitCode != null) return;
      child.exitCode = 0;
      setImmediate(() => child.emit("exit", 0, null));
    };
    Object.assign(child, { kill: () => (exit(), true) });
    /** The answer to `stats`: a text of 257 MiB, a MiB a write, as the pipe takes it. @param {number} id */
    const long = async (id) => {
      const piece = "x".repeat(2 ** 20);
      child.stdout.write(`{"id": ${id}, "ok": true, "result": {"text": "`);
      for (let i = 0; i < 257; i++) if (!child.stdout.write(piece)) await once(child.stdout, "drain");
      child.stdout.write('"}}\n');
    };
    let pending = "";
    child.stdin.setEncoding("utf8");
    child.stdin.on("data", async (/** @type {string} */ d) => {
      pending += d;
      for (let nl = pending.indexOf("\n"); nl >= 0; nl = pending.indexOf("\n")) {
        const req = JSON.parse(pending.slice(0, nl));
        pending = pending.slice(nl + 1);
        if (req.op === "stats") await long(req.id);
        else child.stdout.write(`${JSON.stringify({ id: req.id, ok: true, result: req.op === "hello" ? { version: "fake" } : { op: req.op } })}\n`);
        if (req.op === "shutdown") setImmediate(exit);
      }
    });
    return child;
  };
  /** @type {string[]} */
  const logged = [];
  const e = new MemoryEngine({ command: "x", writeConfig: false, spawnImpl: /** @type {any} */ (spawnImpl), log: (/** @type {string} */ l, /** @type {string} */ m) => logged.push(`${l} ${m}`) });
  try {
    await e.ensure();
    await assert.rejects(e.stats(), { message: "the memory engine answered stats with 257 MiB on one line, past the 256 MiB Filament reads of one answer: Filament dropped the answer unread" });
    assert.deepEqual(await e.canonical({}), { op: "canonical_list" }, "the next call is answered");
    assert.deepEqual(logged.filter((l) => l.startsWith("warn")), ["warn memory engine: its answer to stats was 257 MiB on one line, past the 256 MiB Filament reads of one answer: dropped unread"]);
  } finally {
    await e.stop();
  }
});

test("each call gets its own answer, whole, however the engine's stdout is cut", async () => {
  const long = "é".repeat(150_000) + "日本";
  const answer = (/** @type {any} */ req) =>
    req.op === "hello" ? { id: req.id, ok: true, result: { version: "fake" } } : { id: req.id, ok: true, result: { op: req.op, text: req.op === "stats" ? long : "short" } };
  for (const cut of [1_000_000, 4096, 61]) {
    /** @type {string[]} */
    const logged = [];
    const e = new MemoryEngine({ command: "x", writeConfig: false, spawnImpl: /** @type {any} */ (fakeEngine(answer, cut)), log: (/** @type {string} */ l, /** @type {string} */ m) => logged.push(`${l} ${m}`) });
    try {
      assert.equal((await e.ensure()).version, "fake");
      const [stats, canon] = await Promise.all([e.stats(), e.canonical({})]);
      assert.equal(/** @type {any} */ (stats).text, long, `cut every ${cut}: the long answer whole`);
      assert.equal(/** @type {any} */ (canon).text, "short");
      assert.ok(logged.some((l) => /not JSON \(8 chars\)/.test(l)), "the line that is not JSON is said, by its length");
    } finally {
      await e.stop();
    }
  }
});
