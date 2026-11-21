// @ts-check
// Filament's answer to an agent's own request — a permission, a file, a terminal — when its handler fails. The answer is
// a JSON-RPC error the agent can read: a whole number for its code and words for its message. A Node error's code is a
// word ("ENOENT", "EBUSY"); sent as the code, the agent's ACP library took the answer for no answer at all and said
// "Invalid request" in place of what failed (the tool failures of 10-28, as memory's engine was removed mid-turn).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { RpcProcess } from "../src/adapters/agents/agent-process.js";

/** An RpcProcess on a stand-in child, its log kept. */
const started = () => {
  const child = Object.assign(new EventEmitter(), { pid: 0, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
  /** @type {string[]} */
  const logged = [];
  const p = new RpcProcess({ command: process.execPath, name: "Answers", log: (/** @type {string} */ level, /** @type {string} */ text) => logged.push(`${level} ${text}`) });
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
  return { p, child, logged };
};

/** The agent asks `method`; Filament's answer, as the agent reads it. @param {any} child @param {string} method */
const ask = (child, method, id = 7) =>
  new Promise((resolve) => {
    let buf = "";
    child.stdin.on("data", (/** @type {Buffer} */ d) => {
      buf += d.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl >= 0) resolve(JSON.parse(buf.slice(0, nl)));
    });
    child.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, method, params: {} }) + "\n");
  });

/** ACP's own test of an error answer (@agentclientprotocol/sdk, isErrorResponse). @param {any} e */
const readable = (e) => !!e && typeof e === "object" && Number.isInteger(e.code) && typeof e.message === "string";

describe("an agent's request whose handler fails", () => {
  // (fails before: yes — the code went out as "ENOENT", an answer ACP reads as none)
  test("a Node error's word code: the answer carries a whole-number code and the error's words, and Filament logs it", async () => {
    const { p, child, logged } = started();
    p.onRequest("session/request_permission", () => {
      throw Object.assign(new Error("ENOENT: no such file or directory, open 'C:\\gone\\engine.json'"), { code: "ENOENT" });
    });
    const answer = /** @type {any} */ (await ask(child, "session/request_permission"));
    assert.equal(answer.id, 7);
    assert.ok(readable(answer.error), `an error ACP can read: ${JSON.stringify(answer.error)}`);
    assert.match(answer.error.message, /ENOENT: no such file or directory/);
    assert.ok(logged.some((l) => /^warn .*session\/request_permission.*ENOENT/.test(l)), `logged: ${logged.join(" | ")}`);
  });

  // (fails before: yes — a thrown value with no message sent no message)
  test("a thrown value that is no Error still answers in words", async () => {
    const { p, child } = started();
    p.onRequest("fs/read_text_file", () => {
      throw "the archive is closed";
    });
    const answer = /** @type {any} */ (await ask(child, "fs/read_text_file", 8));
    assert.ok(readable(answer.error), `an error ACP can read: ${JSON.stringify(answer.error)}`);
    assert.equal(answer.error.message, "the archive is closed");
  });

  // (fails before: no — the codes Filament means are sent as they are, and its refusals are not logged as failures)
  test("a JSON-RPC code Filament throws on purpose goes out as it is, unlogged", async () => {
    const { p, child, logged } = started();
    p.onRequest("terminal/output", () => {
      throw Object.assign(new Error("unknown terminal"), { code: -32602 });
    });
    const answer = /** @type {any} */ (await ask(child, "terminal/output", 9));
    assert.deepEqual(answer.error, { code: -32602, message: "unknown terminal" });
    assert.ok(!logged.some((l) => /terminal\/output/.test(l)), `logged: ${logged.join(" | ")}`);
  });
});
