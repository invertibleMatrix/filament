// A reply's reads run side by side, as Claude Code runs them (the owner's word of 10-27: "It reads one file at a time.
// Make it work like claude to read in batches"): consecutive reads, searches and fetches together, at most
// READS_AT_ONCE; a call that changes something waits for them, and the reads after it for it; the results go back
// in the reply's order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { runAgentTurn, READS_AT_ONCE } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";

const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const reply = (content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };

/** A model that asks for `calls` once, then says it is done; and hands that take a moment, counted while they run. */
const world = (calls) => {
  const bodies = [];
  let active = 0;
  const peaks = [];
  const starts = [];
  return {
    bodies, peaks, starts,
    args: /** @type {any} */ ({
      model: "m",
      messages: [{ role: "user", content: "go" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false }),
      modeNow: () => "edit",
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      call: async ({ body }) => {
        bodies.push(structuredClone(body));
        return bodies.length === 1 ? reply(calls) : reply([{ type: "text", text: "Done." }]);
      },
      costOf: () => 0,
      runHand: async (name, input) => {
        starts.push(`${name}:${input?.path ?? input?.pattern ?? ""}`);
        active++;
        peaks.push(active);
        await new Promise((r) => setTimeout(r, 30));
        active--;
        return `${name} ran`;
      },
      delegateRead: null,
      mailbox: { read: () => [] },
      permissions: null,
      tree: null,
      onEvent: () => {},
      previewChars: 0,
      sink,
      signal: null,
      resume: null,
    }),
  };
};
const answeredIds = (body) => {
  const last = body.messages.at(-1);
  return (Array.isArray(last.content) ? last.content : []).filter((b) => b?.type === "tool_result").map((b) => b.tool_use_id);
};

// (fails before: yes — every call ran after the one before it ended: the most at once was 1)
test("consecutive reads run side by side; a write waits for them and the reads after it for the write; results in the reply's order", async () => {
  const w = world([
    toolUse("a", "read", { path: "a.txt" }),
    toolUse("b", "grep", { pattern: "x" }),
    toolUse("c", "glob", { pattern: "*.js" }),
    toolUse("d", "write", { path: "new-file-read-batch.txt", content: "hi" }),
    toolUse("e", "read", { path: "e.txt" }),
    toolUse("f", "read", { path: "f.txt" }),
  ]);
  await runAgentTurn(w.args);
  assert.equal(w.bodies.length, 2);
  assert.deepEqual(answeredIds(w.bodies[1]), ["a", "b", "c", "d", "e", "f"], "the reply's order");
  // a, b and c together; the write alone; e and f together.
  assert.deepEqual(w.peaks, [1, 2, 3, 1, 1, 2], `how many ran as each started: ${w.peaks}`);
  assert.deepEqual(w.starts.slice(3, 4), ["write:new-file-read-batch.txt"], "the write starts once the reads before it ended");
});

test("a long run of reads goes in groups of READS_AT_ONCE", async () => {
  const n = READS_AT_ONCE + 2;
  const w = world(Array.from({ length: n }, (_, i) => toolUse(`r${i}`, "read", { path: `f${i}.txt` })));
  await runAgentTurn(w.args);
  assert.equal(Math.max(...w.peaks), READS_AT_ONCE);
  assert.deepEqual(answeredIds(w.bodies[1]), Array.from({ length: n }, (_, i) => `r${i}`));
});

// The Hunter's finds of 10-27 (sa_6951ccf9), each verified against the code before it was fixed.
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runHand } from "../src/adapters/tools/hands.js";

/**
 * A slow disk under `dir`, both ways a hand may read it: a read or a listing there takes `ms`, holding the event loop
 * where it is read in one go, waiting off it where it is read the other way. Undone by the function it answers.
 * @param {string} dir @param {number} ms
 */
const slowDisk = (dir, ms) => {
  const real = { readFileSync: fs.readFileSync, readdirSync: fs.readdirSync, readFile: fsp.readFile, readdir: fsp.readdir };
  const under = (/** @type {any} */ p) => String(p).startsWith(dir);
  const block = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const later = () => new Promise((r) => setTimeout(r, ms));
  fs.readFileSync = /** @type {any} */ ((/** @type {any} */ p, /** @type {any[]} */ ...a) => (under(p) && block(), real.readFileSync(p, ...a)));
  fs.readdirSync = /** @type {any} */ ((/** @type {any} */ p, /** @type {any[]} */ ...a) => (under(p) && block(), real.readdirSync(p, ...a)));
  fsp.readFile = /** @type {any} */ (async (/** @type {any} */ p, /** @type {any[]} */ ...a) => (under(p) && (await later()), real.readFile(p, ...a)));
  fsp.readdir = /** @type {any} */ (async (/** @type {any} */ p, /** @type {any[]} */ ...a) => (under(p) && (await later()), real.readdir(p, ...a)));
  syncBuiltinESMExports();
  return () => {
    Object.assign(fs, { readFileSync: real.readFileSync, readdirSync: real.readdirSync });
    Object.assign(fsp, { readFile: real.readFile, readdir: real.readdir });
    syncBuiltinESMExports();
  };
};

// (fails before: yes — read and glob did their work in one go: the batch's reads ran one after another however it
// started them, five slow reads taking five times one)
test("on real hands, five reads of a slow disk take about the time of one, and so do three globs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "read-batch-real-"));
  try {
    for (const n of [1, 2, 3, 4, 5]) writeFileSync(join(dir, `f${n}.txt`), `file ${n}\n`);
    for (const n of [1, 2, 3]) {
      mkdirSync(join(dir, `d${n}`));
      writeFileSync(join(dir, `d${n}`, "x.js"), "x");
    }
    const timed = async (/** @type {any[]} */ calls) => {
      const w = world(calls);
      w.args.root = dir;
      w.args.runHand = (/** @type {string} */ name, /** @type {any} */ input, /** @type {any} */ o) => runHand(name, input, { root: dir, signal: o?.signal ?? null });
      const undo = slowDisk(dir, 250);
      const t0 = Date.now();
      try {
        await runAgentTurn(w.args);
      } finally {
        undo();
      }
      return { ms: Date.now() - t0, said: JSON.stringify(w.bodies[1].messages.at(-1)) };
    };
    const reads = await timed([1, 2, 3, 4, 5].map((n) => toolUse(`r${n}`, "read", { path: `f${n}.txt` })));
    assert.ok(reads.ms < 900, `five reads took ${reads.ms} ms: one is 250`);
    for (const n of [1, 2, 3, 4, 5]) assert.ok(reads.said.includes(`file ${n}`), `read ${n} came back`);
    const globs = await timed([1, 2, 3].map((n) => toolUse(`g${n}`, "glob", { pattern: "*.js", path: `d${n}` })));
    assert.ok(globs.ms < 650, `three globs took ${globs.ms} ms: one is 250`);
    assert.equal((globs.said.match(/x\.js/g) || []).length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — every read of the batch asked at once: a worker's two questions took the one place a question
// waits in, and the first was never answered)
test("reads that ask a worker's question ask one at a time, each answered, and the turn ends", async () => {
  const w = world([1, 2, 3].map((n) => toolUse(`q${n}`, "read", { path: `q${n}.txt` })));
  let waiting = 0;
  let most = 0;
  /** @type {string[]} */
  const asked = [];
  Object.assign(w.args, {
    rules: [{ tool: "read", pattern: "*", verdict: "ask" }],
    unattended: "worker",
    asker: async (/** @type {any} */ q) => {
      waiting++;
      most = Math.max(most, waiting);
      asked.push(q.args);
      await new Promise((r) => setTimeout(r, 20));
      waiting--;
      return { text: "yes", allow: true };
    },
  });
  await runAgentTurn(w.args);
  assert.equal(asked.length, 3, "each read asked");
  assert.equal(most, 1, "one question at a time");
  assert.deepEqual(answeredIds(w.bodies[1]), ["q1", "q2", "q3"], "each answered, in the reply's order");
  assert.equal(w.starts.length, 3, "and each ran");
});

// (fails before: yes — a search took no notice of the turn's Stop: it ran out its own time, and the turn waited)
test("the turn's Stop ends a search under way at once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "read-batch-grep-"));
  try {
    writeFileSync(join(dir, "slow.txt"), `${"a".repeat(32)}b\n`);
    const stop = new AbortController();
    const t0 = Date.now();
    setTimeout(() => stop.abort(), 150);
    await runHand("grep", { pattern: "^(a+)+$", path: "." }, { root: dir, noRg: true, grepTimeoutMs: 15_000, signal: stop.signal });
    assert.ok(Date.now() - t0 < 3_000, `the search went on ${Date.now() - t0} ms after the Stop`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
