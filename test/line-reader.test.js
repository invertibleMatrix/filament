// @ts-check
// Lines read off a stream as its chunks come (core/lines.js): an agent's JSON-RPC messages, ripgrep's matches. A line
// that came in many chunks was found by searching the whole of what had come for a newline at every chunk, and cut out
// of it again — over a long line (an agent's message carrying a file), the square of its length. Each chunk is searched
// once, and a line's pieces joined once.
import { test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter, once } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { createLineReader } from "../src/core/lines.js";
import { RpcProcess } from "../src/adapters/agents/agent-process.js";

/** How many characters `fn` had searched for a newline. @param {() => Promise<void> | void} fn */
const searched = async (fn) => {
  const real = String.prototype.indexOf;
  let n = 0;
  String.prototype.indexOf = /** @type {any} */ (function (/** @type {string} */ s, /** @type {number} */ from) {
    if (s === "\n") n += this.length - Math.max(0, Number(from) || 0);
    return real.call(this, s, from);
  });
  try {
    await fn();
  } finally {
    String.prototype.indexOf = real;
  }
  return n;
};

// (fails before: yes — the module is new)
test("lines read in any chunks are the lines of the whole: newlines, CRLF, empty lines, a last line with none", () => {
  const text = "first\r\nsecond\n\n" + "x".repeat(5000) + "\nthird\r\n\r\nlast without one";
  const whole = text.split("\n");
  for (const size of [1, 2, 3, 7, 64, 4999, 5001, text.length]) {
    /** @type {string[]} */
    const got = [];
    const r = createLineReader((l) => void got.push(l));
    for (let i = 0; i < text.length; i += size) r.push(text.slice(i, i + size));
    assert.deepEqual([...got, r.rest()], whole, `chunks of ${size}`);
  }
});

// (fails before: yes — a line ended at a newline alone: the names git lists with `-z`, a newline among them, could not be read)
test("lines ended by a NUL, as git's -z lists names: a newline is part of a line, in any chunks", () => {
  const text = "a\nb\0src/x.js\0" + "é".repeat(3000) + "\0\0last without one";
  const whole = text.split("\0");
  for (const size of [1, 2, 7, 3001, text.length]) {
    /** @type {string[]} */
    const got = [];
    const r = createLineReader((l) => void got.push(l), { eol: "\0" });
    for (let i = 0; i < text.length; i += size) r.push(text.slice(i, i + size));
    assert.deepEqual([...got, r.rest()], whole, `chunks of ${size}`);
  }
});

test("a reader told to stop leaves the rest of that chunk unread", () => {
  /** @type {string[]} */
  const got = [];
  const r = createLineReader((l) => (got.push(l), l === "b"));
  assert.equal(r.push("a\nb\nc\nd"), true);
  assert.deepEqual(got, ["a", "b"]);
});

test("a long line in many chunks is searched once and joined once", async () => {
  const line = "y".repeat(400_000);
  /** @type {string[]} */
  const got = [];
  const n = await searched(() => {
    const r = createLineReader((l) => void got.push(l));
    for (let i = 0; i < line.length; i += 1000) r.push(line.slice(i, i + 1000));
    r.push("\nnext\n");
  });
  assert.deepEqual(got, [line, "next"]);
  assert.ok(n < line.length * 2, `searched ${n} characters for a ${line.length}-character line`);
});

/**
 * An RpcProcess on a child that is two streams: what the test writes to `child.stdout` is the agent's output.
 * @param {(level: string, msg: string) => void} [log]
 */
const onFakeChild = (log = () => {}) => {
  const child = Object.assign(new EventEmitter(), { pid: 0, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
  const p = new RpcProcess({ command: process.execPath, name: "long", log });
  const cp = /** @type {any} */ (childProcess);
  const real = cp.spawn;
  cp.spawn = () => child;
  syncBuiltinESMExports();
  try {
    p.start();
  } finally {
    cp.spawn = real;
    syncBuiltinESMExports();
  }
  return { child, p };
};

// (fails before: yes — the bug hunt of 10-30: a line was held whole however long it ran)
test("a line past the most a reader holds is dropped: its reader is told its length and its two ends at its newline, in its place, and the lines after it are read", () => {
  /** @type {string[]} */
  const got = [];
  /** @type {any[]} */
  const over = [];
  const r = createLineReader((l) => void got.push(l), { max: 10, onOver: (o) => void over.push(o) });
  for (const chunk of ["short\n0123", "456789", "abcdef", "\nnext\n", "0123456789x", "y\ntail"]) r.push(chunk);
  assert.deepEqual(got, ["short", "next"]);
  assert.deepEqual(over, [{ length: 16, start: "0123456789abcdef", end: "0123456789abcdef" }, { length: 12, start: "0123456789xy", end: "0123456789xy" }]);
  assert.equal(r.rest(), "tail");
  r.push("0123456789more");
  assert.equal(r.rest(), "", "a line past it under way is not held");
  const stops = createLineReader(() => {}, { max: 2, onOver: () => true });
  assert.equal(stops.push("long\nnot read\n"), true, "a reader told of one may stop the reading, as onLine may");
});

// (fails before: yes — the bug hunt of 10-30, noticed: a stream that ended inside a line past the most a reader holds lost
// it with no word, its reader given back "" for it and told nothing)
test("a stream that ends inside a line past the most a reader holds tells of it at its end, and the reader starts afresh", () => {
  /** @type {string[]} */
  const got = [];
  /** @type {any[]} */
  const over = [];
  const r = createLineReader((l) => void got.push(l), { max: 10, onOver: (o) => void over.push(o) });
  r.push("short\n0123456789");
  r.push("ab");
  assert.equal(r.end(), "", "nothing of it is given back");
  assert.deepEqual(over, [{ length: 12, start: "0123456789ab", end: "0123456789ab" }], "told as its newline would have");
  r.push("next\ntail");
  assert.equal(r.end(), "tail", "a last line it holds is given back");
  assert.equal(r.end(), "", "and the reader starts afresh");
  assert.deepEqual([got, over.length], [["short", "next"], 1]);
});

/** Write a line of the agent's of `size` characters past its start and before its end, a MiB a write, as the pipe takes it. @param {PassThrough} out @param {string} start @param {number} size @param {string} end */
const longLine = async (out, start, size, end) => {
  const piece = "x".repeat(2 ** 20);
  out.write(start);
  for (let left = size; left > 0; left -= piece.length) if (!out.write(left >= piece.length ? piece : piece.slice(0, left))) await once(out, "drain");
  out.write(end);
};

// (fails before: yes — the bug hunt of 10-30: an agent's message of any size was held whole, and one past what a string
// takes threw in the pipe's handler; the request in it went to its handler, and an answer to its request)
test("an agent's message past 256 MiB is dropped unread: its request is refused in words, Filament's request it answered fails in words, each is logged, and the stream reads on", { timeout: 120_000 }, async () => {
  /** @type {string[]} */
  const logged = [];
  const { child, p } = onFakeChild((level, msg) => logged.push(`${level} ${msg}`));
  /** @type {any[]} */
  const answers = [];
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (/** @type {string} */ d) => answers.push(...d.trim().split("\n").map((l) => JSON.parse(l))));
  const size = 2 ** 28 + 2 ** 20;
  await longLine(child.stdout, '{"jsonrpc":"2.0","id":7,"method":"fs/write_text_file","params":{"path":"a.txt","content":"', size, '"}}\n');
  const asked = p.request("session/load", { sessionId: "s" });
  const failed = assert.rejects(asked, { message: "long answered session/load with 257 MiB on one line, past the 256 MiB Filament reads of one message: Filament dropped the answer unread" });
  await longLine(child.stdout, '{"jsonrpc":"2.0","id":1,"result":{"history":"', size, '"}}\n');
  await failed;
  const heard = new Promise((resolve) => p.on("notification", (/** @type {string} */ method) => resolve(method)));
  child.stdout.write('{"jsonrpc":"2.0","method":"session/update","params":{}}\n');
  assert.equal(await heard, "session/update", "the next line is read");
  assert.deepEqual(answers.filter((a) => a.id === 7), [{ jsonrpc: "2.0", id: 7, error: { code: -32000, message: "Filament dropped this fs/write_text_file request unread: it was 257 MiB on one line, past the 256 MiB Filament reads of one message" } }]);
  assert.deepEqual(logged.filter((l) => l.startsWith("warn")), [
    "warn [long] the agent's fs/write_text_file request was 257 MiB on one line, past the 256 MiB Filament reads of one message: dropped unread, and refused",
    "warn [long] the agent's answer to session/load was 257 MiB on one line, past the 256 MiB Filament reads of one message: dropped unread",
  ]);
});

// (fails before: yes — the agent's 2 MB message in 1,000 chunks was searched for its newline over a billion characters)
test("an agent's message in a thousand chunks is read once, and the message is whole", async () => {
  const { child, p } = onFakeChild();
  const text = "z".repeat(2_000_000);
  const wire = JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { text } }) + "\n";
  /** @type {any[]} */
  const heard = [];
  const n = await searched(async () => {
    const got = new Promise((resolve) => p.on("notification", (/** @type {string} */ method, /** @type {any} */ params) => resolve(heard.push([method, params.text.length]))));
    for (let i = 0; i < wire.length; i += 2000) child.stdout.write(wire.slice(i, i + 2000));
    await got;
  });
  assert.deepEqual(heard, [["session/update", text.length]]);
  assert.ok(n < wire.length * 3, `searched ${n} characters for a ${wire.length}-character message`);
});
