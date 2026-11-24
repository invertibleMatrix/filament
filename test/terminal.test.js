// The terminal stack (B4), without a shell: the WebSocket codec against RFC 6455's own vector, the PTY registry
// over a fake spawn, and the admin rows through the router with a fake service. A real process is never spawned
// here — node-pty is exercised live in the browser pass, not in the suite.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { wsAcceptKey, wsHandshake, wsTextFrame, wsCloseFrame, WsDecoder } from "../src/http/ws.js";
import { createTerminalService, MAX_TERMINALS } from "../src/services/terminal.js";
import { spawnTerminal } from "../src/adapters/terminal/pty.js";
import { terminalRoutes } from "../src/http/admin/terminal.js";
import { createRouter } from "../src/http/router.js";

// --- the codec -------------------------------------------------------------------

test("wsAcceptKey: the RFC 6455 sample vector, and the handshake line order", () => {
  assert.equal(wsAcceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  assert.equal(
    wsHandshake("dGhlIHNhbXBsZSBub25jZQ=="),
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n",
  );
});

/** A true client frame: masked, as the RFC requires browser→server. @param {string} text @param {number} fin @param {number} opcode */
function clientFrame(text, { fin = true, opcode = 1 } = {}) {
  const mask = Buffer.from([0x37, 0xa2, 0x11, 0x5c]);
  const payload = Buffer.from(text, "utf8");
  const head = Buffer.alloc(2);
  head[0] = (fin ? 0x80 : 0) | opcode;
  head[1] = 0x80 | payload.length; // tests stay under the 126 boundary
  const masked = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
  return Buffer.concat([head, mask, masked]);
}

test("wsTextFrame: the three payload-length forms round-trip", () => {
  for (const text of ["echo hi", "x".repeat(125), "y".repeat(1000), "z".repeat(70000)]) {
    const dec = new WsDecoder();
    const frames = dec.feed(wsTextFrame(text));
    assert.equal(frames.length, 1);
    assert.equal(frames[0].opcode, 1);
    assert.equal(frames[0].text, text);
  }
});

test("WsDecoder: a masked client frame is unmasked; a chunk split mid-frame waits for its rest; control frames stand alone; a continuation reassembles", () => {
  const dec = new WsDecoder();
  const whole = clientFrame("hello");
  assert.deepEqual(dec.feed(whole.subarray(0, 4)), [], "a partial header/mask yields nothing");
  assert.equal(dec.feed(whole.subarray(4))[0].text, "hello");
  assert.equal(dec.feed(Buffer.from([0x88, 0x80, 1, 2, 3, 4]))[0].opcode, 8); // close (empty, masked)
  assert.equal(dec.feed(Buffer.from([0x89, 0x80, 1, 2, 3, 4]))[0].opcode, 9); // ping
  assert.deepEqual(dec.feed(clientFrame("ab", { fin: false })), [], "the first half of a fragmented message holds");
  assert.equal(dec.feed(clientFrame("cd", { fin: true, opcode: 0 }))[0].text, "abcd", "the continuation completes it");
  assert.equal(wsCloseFrame().length, 4);
});

// (fails before: yes — the bug hunt of 10-30, HTTP-6: the decoder held a frame's bytes for whatever length its header
// said, and a fragmented message's pieces without end, so one socket could fill the server's memory)
test("WsDecoder: a message past its cap ends the stream before its bytes are held — a frame said longer, or fragments that come to more; one at the cap reads whole", () => {
  /** A masked client frame's header alone, saying `len` bytes follow. @param {number} len @param {{ fin?: boolean, opcode?: number }} [o] */
  const headSaying = (len, { fin = true, opcode = 1 } = {}) => {
    const head = Buffer.alloc(14);
    head[0] = (fin ? 0x80 : 0) | opcode;
    head[1] = 0x80 | 127;
    head.writeBigUInt64BE(BigInt(len), 2);
    return head;
  };
  assert.throws(() => new WsDecoder(1024).feed(headSaying(1025)), /websocket message too large/, "a frame said past the cap");
  assert.throws(() => new WsDecoder().feed(headSaying(2 ** 40)), /websocket message too large/, "with no cap named, server.maxBodyBytes's own default");
  const dec = new WsDecoder(8);
  assert.deepEqual(dec.feed(clientFrame("abcd", { fin: false })), [], "the first piece holds");
  assert.deepEqual(dec.feed(clientFrame("efgh", { fin: false, opcode: 0 })), [], "eight bytes, the cap");
  assert.throws(() => dec.feed(clientFrame("i", { fin: false, opcode: 0 })), /websocket message too large/, "pieces past it");
  const atCap = new WsDecoder(8);
  atCap.feed(clientFrame("abcd", { fin: false }));
  assert.equal(atCap.feed(clientFrame("efgh", { fin: true, opcode: 0 }))[0].text, "abcdefgh");
  assert.equal(atCap.feed(clientFrame("12345678"))[0].text, "12345678", "and the next message starts at nothing");
  assert.equal(new WsDecoder(8).feed(Buffer.from([0x89, 0x80, 1, 2, 3, 4]))[0].opcode, 9, "a control frame stands alone");
});

// --- the registry over a fake spawn ------------------------------------------------------------------------------

/**
 * A fake PTY in node-pty's shape: writes echo to onData; kill() fires onExit once, as `{ exitCode, signal }`;
 * `end(code)` is the process ending by itself.
 */
const fakeSpawn = () => {
  const data = [];
  const exits = [];
  let alive = true;
  const end = (/** @type {number} */ exitCode) => { if (alive) { alive = false; for (const fn of exits) fn({ exitCode, signal: 0 }); } };
  return {
    write: (/** @type {string} */ d) => { for (const fn of data) fn(`[echo ${JSON.stringify(d)}]`); },
    resize: () => {},
    kill: () => end(0),
    end,
    onData: (/** @type {any} */ fn) => (data.push(fn), () => data.splice(data.indexOf(fn), 1)),
    onExit: (/** @type {any} */ fn) => exits.push(fn),
  };
};

const dir = mkdtempSync(join(tmpdir(), "filament-term-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("the registry: create/list/input/resize/kill; the backlog replays on re-attach; an unknown id answers in words", () => {
  const svc = createTerminalService({ spawn: fakeSpawn, log: () => {} });
  const t = svc.create({ cwd: dir, cols: 100, rows: 30 });
  assert.equal(t.exited, false);
  assert.deepEqual(svc.list().map((x) => x.id), [t.id]);
  /** @type {any[]} */
  let got = [];
  const detach = svc.attach(t.id, (m) => got.push(m));
  svc.input(t.id, "dir\r");
  assert.ok(got.some((m) => m.t === "o" && m.d.includes("dir")), "a live attach sees the echo");
  detach();
  svc.input(t.id, "git status\r"); // printed while nobody watched
  /** @type {any[]} */
  const later = [];
  svc.attach(t.id, (m) => later.push(m));
  assert.equal(later[0].t, "b", "the backlog arrives before anything live");
  assert.ok(later[0].d.includes("git status"), "and it is what printed during the detach");
  svc.resize(t.id, 120, 40);
  svc.kill(t.id);
  assert.deepEqual(svc.list(), []);
  assert.throws(() => svc.input(t.id, "x"), /no such terminal/);
});

test("the registry: the process's own death marks the row and every listener hears x", async () => {
  const svc = createTerminalService({ spawn: fakeSpawn, log: () => {} });
  const t = svc.create({ cwd: dir });
  /** @type {any[]} */
  const got = [];
  svc.attach(t.id, (m) => got.push(m));
  const exited = new Promise((res) => {
    const stop = svc.attach(t.id, (m) => { if (m.t === "x") { stop(); res(m); } });
  });
  svc.kill(t.id); // the fake's kill fires onExit, exactly as a real shell's death does
  const x = await exited;
  assert.equal(x.code, 0);
  assert.deepEqual(got.filter((m) => m.t === "x").length, 1, "the long-lived listener heard it too");
});

// (fails before: yes — the registry read `code`, which node-pty never sends: every exit read as null)
test("the registry: a program that ends by itself keeps node-pty's exit code; whoever started it hears it, and whether it was closed", () => {
  /** @type {any} */
  let pty = null;
  /** @type {any[]} */
  const spawned = [];
  const svc = createTerminalService({ spawn: (o) => (spawned.push(o), (pty = fakeSpawn())), log: () => {} });
  /** @type {any[]} */
  const heard = [];
  const program = { file: "agent", args: ["login"], env: { HOME: dir } };
  const t = svc.create({ cwd: dir, title: "Sign in · Agent", program, onExit: (code, closed) => heard.push([code, closed]) });
  assert.deepEqual(spawned[0].program, program, "the program goes to the PTY with its whole environment");
  pty.end(3);
  assert.deepEqual(svc.list().map((x) => [x.id, x.title, x.exited, x.exitCode]), [[t.id, "Sign in · Agent", true, 3]]);
  const closed = svc.create({ cwd: dir, onExit: (code, wasClosed) => heard.push([code, wasClosed]) });
  svc.kill(closed.id);
  assert.deepEqual(heard, [[3, false], [0, true]], "the one closed (the pane's ×, the cap) says so");
});

// (fails before: yes — a terminal ran a program only: a program's download, which Filament does itself, had no terminal
// to show its progress in)
test("the registry: a task Filament runs itself is a terminal too, with no PTY — what it says is its output, its end 0; a failure said, and 1; a kill stops it through its signal and says it was closed", async () => {
  const svc = createTerminalService({ spawn: () => { throw new Error("no PTY here"); }, log: () => {} });
  /** @type {any[]} */
  const heard = [];
  /** @param {string} id */
  const backlog = (id) => {
    /** @type {any[]} */
    const got = [];
    svc.attach(id, (m) => got.push(m));
    return got.filter((m) => m.t === "b").map((m) => m.d).join("");
  };
  const ended = (/** @type {number} */ n) => new Promise((res) => { const tick = () => (heard.length >= n ? res(null) : setImmediate(tick)); tick(); });
  const ok = svc.create({ cwd: dir, title: "Install · X", task: async ({ say }) => { say("Downloading…\r\n"); say("Installed.\r\n"); }, onExit: (code, closed) => heard.push([code, closed]) });
  await ended(1);
  assert.deepEqual([backlog(ok.id), svc.list().find((t) => t.id === ok.id)?.exitCode], ["Downloading…\r\nInstalled.\r\n", 0]);
  const bad = svc.create({ cwd: dir, task: async ({ say }) => { say("Downloading…\r\n"); throw new Error("its address answered 404"); }, onExit: (code, closed) => heard.push([code, closed]) });
  await ended(2);
  assert.equal(backlog(bad.id), "Downloading…\r\n\r\nits address answered 404\r\n");
  /** @type {AbortSignal | null} */
  let signal = null;
  const held = svc.create({ cwd: dir, task: ({ signal: s }) => new Promise((_, no) => { signal = s; s.addEventListener("abort", () => no(s.reason)); }), onExit: (code, closed) => heard.push([code, closed]) });
  await new Promise((r) => setImmediate(r));
  svc.kill(held.id);
  await ended(3);
  assert.deepEqual([heard, /** @type {any} */ (signal)?.aborted], [[[0, false], [1, false], [1, true]], true]);
});

test("the registry: the cap keeps eight terminals and closes the oldest living one", () => {
  const svc = createTerminalService({ spawn: fakeSpawn, log: () => {} });
  const ids = [];
  for (let i = 0; i < MAX_TERMINALS + 2; i++) ids.push(svc.create({ cwd: dir }).id);
  assert.equal(svc.list().length, MAX_TERMINALS);
  assert.equal(svc.list()[0].id, ids[2], "the first two were closed by the cap, oldest first");
});

test("the pty adapter: a spawn failure is a clean sentence, never a boot crash", () => {
  const r = spawnTerminal({ cwd: dir, spawn: () => { throw new Error("spawn-helper ENOENT"); } });
  assert.equal(r.ok, false);
  assert.match(r.error, /terminal could not start: spawn-helper ENOENT/);
});

// --- the admin rows over the router ------------------------------------------------------------------------------

/**
 * Invoke one row through the real router with a minimal `r`.
 * @param {string} method @param {string} path @param {any[]} rows @param {{ params?: any, json?: any }} o
 */
async function call(method, path, rows, o = {}) {
  const router = createRouter(rows);
  const m = router(method, path);
  assert.ok(m, `${method} ${path} matched a row`);
  /** @type {any} */
  let sent = {};
  const res = {
    writeHead: () => {},
    end: (b) => (sent = JSON.parse(String(b))),
  };
  await m.handler({ res, url: new URL("http://localhost/api/terminal"), params: m.params, json: async () => o.json ?? {} }, {});
  return sent;
}

test("the admin rows: create fences the cwd, list/input/resize/kill reach the service", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-term-root-"));
  after(() => rmSync(root, { recursive: true, force: true }));
  const svc = createTerminalService({ spawn: fakeSpawn, log: () => {} });
  const rows = terminalRoutes({ config: { get: () => ({ agentLoop: { roots: [root] }, server: {} }) }, terminal: svc });

  const missing = await call("POST", "/terminal", rows, { json: { cwd: join(root, "no-such-folder") } });
  assert.match(missing.error, /does not exist/);

  const t = (await call("POST", "/terminal", rows, { json: { cwd: root } })).terminal;
  assert.ok(t.id);

  assert.equal((await call("GET", "/terminal", rows)).terminals.length, 1);
  assert.equal((await call("POST", `/terminal/${t.id}/input`, rows, { json: { data: "echo hi\r" } })).ok, true);
  assert.equal((await call("POST", `/terminal/${t.id}/resize`, rows, { json: { cols: 120, rows: 40 } })).ok, true);
  assert.equal((await call("POST", `/terminal/${t.id}/kill`, rows)).ok, true);
  assert.deepEqual(svc.list(), []);

  const noInput = await call("POST", `/terminal/${t.id}/input`, rows, { json: { data: "x" } });
  assert.match(noInput.error, /no such terminal/);
});

test("the admin rows: a program in a shell's place, in the person's own folder where no cwd is named, its words checked", async () => {
  /** @type {any[]} */
  const asked = [];
  const svc = createTerminalService({ spawn: (/** @type {any} */ o) => (asked.push(o), fakeSpawn()), log: () => {} });
  const rows = terminalRoutes({ config: { get: () => ({ agentLoop: { roots: [] }, server: {} }) }, terminal: svc });
  const t = (await call("POST", "/terminal", rows, { json: { program: { file: "/usr/bin/ssh", args: ["-t", "--", "box", "exit"] }, title: "ssh box" } })).terminal;
  assert.ok(t.id);
  assert.equal(t.title, "ssh box");
  assert.equal(asked[0].program.file, "/usr/bin/ssh");
  assert.deepEqual(asked[0].program.args, ["-t", "--", "box", "exit"]);
  assert.equal(asked[0].cwd, homedir());
  // The environment a shell gets: the program's own (ssh's agent socket among it).
  assert.equal(asked[0].program.env.PATH ?? asked[0].program.env.Path, process.env.PATH ?? process.env.Path);
  // No title: the program's name.
  assert.equal((await call("POST", "/terminal", rows, { json: { program: { file: "/usr/bin/ssh" } } })).terminal.title, "ssh");
  assert.match((await call("POST", "/terminal", rows, { json: { program: { file: "" } } })).error, /program\.file is required/);
  assert.match((await call("POST", "/terminal", rows, { json: { program: { file: "ssh", args: "-t box" } } })).error, /program\.args are its words/);
  assert.match((await call("POST", "/terminal", rows, { json: { program: { file: "ssh", args: [1] } } })).error, /program\.args are its words/);
  assert.equal(asked.length, 2);
});
