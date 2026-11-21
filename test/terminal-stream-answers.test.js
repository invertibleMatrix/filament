// @ts-check
// The terminal's stream answers what it refuses (s-hands, the second read of 11-12, its item 16). Its ticket holds;
// but two addresses threw inside the upgrade, past every refusal, and left the socket open and unanswered with an error
// in the log: a terminal's id that does not decode (`/api/terminal/%zz/stream`, with the app's key held and none
// shown), and a ticket as long as a real one, in characters, with a character of more than one byte in it. Both are
// answered now as the stream's other refusals are — no such terminal, no ticket that holds — and nothing is thrown.
// Through a real Filament and a stand-in for node-pty.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { startApp } from "./helpers/app.js";
import { PRESS_HEADER, setPressKey } from "../src/http/guards.js";
import { createTerminalService } from "../src/services/terminal.js";

const KEY = randomBytes(32).toString("base64url");
const PRESS = { [PRESS_HEADER]: KEY };
const WS = { connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" };
/** How long an upgrade may go unanswered before the test says so: a refusal is written at once. */
const ANSWER_MS = 3000;

/** A stand-in for node-pty: it stays up and says nothing. */
const fakePty = () => ({ onData() {}, onExit() {}, write() {}, resize() {}, kill() {} });

/**
 * A WebSocket's upgrade asked: its status — 101 where it opened, then let go — and what a refusal said; "no answer"
 * where the socket was left open with nothing written.
 * @param {number} port @param {string} path @param {Record<string, string>} [headers]
 * @returns {Promise<{ status: number, text: string }>}
 */
const upgrade = (port, path, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, ...WS, ...headers } });
    const late = setTimeout(() => {
      req.destroy();
      resolve({ status: 0, text: "no answer" });
    }, ANSWER_MS);
    req.on("upgrade", (res, socket) => {
      clearTimeout(late);
      socket.on("error", () => {});
      socket.destroy();
      resolve({ status: Number(res.statusCode), text: "" });
    });
    req.on("response", (res) => {
      clearTimeout(late);
      let b = "";
      res.on("error", () => {});
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve({ status: Number(res.statusCode), text: b }));
    });
    req.on("error", (e) => {
      clearTimeout(late);
      reject(e);
    });
    req.end();
  });

/** A ticket's length in characters, with a character of two bytes in it. @param {string} ticket */
const twoByte = (ticket) => `é${ticket.slice(1)}`;

// (fails before: yes — RangeError [ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH]: Input buffers must have the same byte length)
test("a ticket shown is compared by its bytes: one of the same length in characters and another in bytes is no ticket, and nothing is thrown", () => {
  const terminal = createTerminalService({ spawn: fakePty });
  const t = terminal.create({ cwd: tmpdir() });
  const ticket = terminal.ticket(t.id);
  assert.equal(twoByte(ticket).length, ticket.length);
  assert.notEqual(Buffer.byteLength(twoByte(ticket)), Buffer.byteLength(ticket));
  for (const shown of [twoByte(ticket), "é".repeat(ticket.length), "€".repeat(ticket.length), `${ticket}é`, ticket.slice(1), "\ud800".repeat(ticket.length)]) assert.equal(terminal.redeem(t.id, shown), false, JSON.stringify(shown));
  assert.equal(terminal.redeem(t.id, ticket), true, "the ticket given holds still");
  assert.equal(terminal.redeem(t.id, ticket), false, "once");
  terminal.stopAll();
});

describe("the terminal's stream, through Filament", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** What was thrown past every handler while a test ran. @type {unknown[]} */
  const thrown = [];
  const caught = (/** @type {unknown} */ e) => void thrown.push(e);
  /** @param {string} path @param {{ headers?: Record<string, string> }} [o] */
  const post = (path, { headers = {} } = {}) => fetch(`${shim.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
  /** A terminal opened by the key, its id. */
  const open = async () => {
    const r = await fetch(`${shim.url}/api/terminal`, { method: "POST", headers: { "content-type": "application/json", ...PRESS }, body: JSON.stringify({ cwd: tmpdir() }) });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).terminal.id);
  };
  /** The log's errors: the operations Filament recorded at that level. */
  const errors = async () => (await (await shim.api("/api/ops?kinds=all&limit=500")).json()).ops.filter((/** @type {any} */ o) => o.level === "error").map((/** @type {any} */ o) => o.title);

  before(async () => {
    shim = await startApp({ overrides: { terminalSpawn: fakePty }, configure: (cfg) => void (cfg.agentLoop = { ...cfg.agentLoop, roots: [tmpdir()] }) });
    process.on("uncaughtException", caught);
  });
  after(async () => {
    process.off("uncaughtException", caught);
    setPressKey("");
    await shim.stop();
  });

  // (fails before: yes — with the key held and none shown the upgrade threw "URIError: URI malformed" past its
  // refusals: the socket was left open, { status: 0, text: "no answer" }; with the key shown, and with no key held, it
  // answered 404 "URI malformed")
  test("an id that does not decode names no terminal: answered 404 in the words an unknown id is, while the app holds its key and with none held", async () => {
    setPressKey(KEY);
    for (const id of ["%zz", "%", "%E0%A4%A", "t%ff"]) {
      assert.deepEqual(await upgrade(shim.port, `/api/terminal/${id}/stream`), { status: 404, text: "no such terminal" }, `${id}, no key shown`);
      assert.deepEqual(await upgrade(shim.port, `/api/terminal/${id}/stream?ticket=${randomBytes(24).toString("base64url")}`), { status: 404, text: "no such terminal" }, `${id}, a ticket shown`);
      assert.deepEqual(await upgrade(shim.port, `/api/terminal/${id}/stream`, PRESS), { status: 404, text: "no such terminal" }, `${id}, the key shown`);
    }
    // An id that decodes and names none is refused as it was: by the press first, then as unknown.
    assert.equal((await upgrade(shim.port, "/api/terminal/t-none/stream")).status, 403);
    assert.deepEqual(await upgrade(shim.port, "/api/terminal/t-none/stream", PRESS), { status: 404, text: "no such terminal" });
    setPressKey("");
    assert.deepEqual(await upgrade(shim.port, "/api/terminal/%zz/stream"), { status: 404, text: "no such terminal" }, "with no key held");
    assert.deepEqual(thrown, [], "nothing was thrown");
    assert.deepEqual(await errors(), [], "and the log has no error");
  });

  // (fails before: yes — the stream's `redeem` threw the RangeError above past its refusals: { status: 0, text: "no answer" })
  test("a ticket of a real one's length with a character of two bytes: refused 403 as any ticket nobody was given, and the real one opens the stream still", async () => {
    setPressKey(KEY);
    const id = await open();
    const T = `/api/terminal/${encodeURIComponent(id)}`;
    const asked = await post(`${T}/ticket`, { headers: PRESS });
    assert.equal(asked.status, 200);
    const ticket = String((await asked.json()).ticket);
    const none = await upgrade(shim.port, `${T}/stream?ticket=${randomBytes(24).toString("base64url")}`);
    assert.equal(none.status, 403);
    assert.deepEqual(await upgrade(shim.port, `${T}/stream?ticket=${encodeURIComponent(twoByte(ticket))}`), none, "as a ticket nobody was given");
    assert.equal((await upgrade(shim.port, `${T}/stream?ticket=${ticket}`)).status, 101, "the ticket given opens it");
    assert.equal((await post(`${T}/kill`)).status, 200);
    setPressKey("");
    assert.deepEqual(thrown, [], "nothing was thrown");
    assert.deepEqual(await errors(), [], "and the log has no error");
  });
});
