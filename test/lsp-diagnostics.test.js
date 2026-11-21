// @ts-check
// Errors after a write or an edit (the owner's LSP of 11-04): the result of an agent's write or edit lists the errors
// the language server that serves the file finds in it as it was left — not its warnings — where the server says them
// within 3 s; what it says after that rides the agent's next step, and a turn about to end goes one more step for it;
// a stop cuts the wait. They are asked of the agent's own lsp tool: a file no server serves says nothing at once, and a
// chat that switched the tool off, or whose rules refuse it or ask first, asks nothing. The call's card shows them too,
// those found after its result was written as well.
// (fails before: yes — a write's or an edit's result said only what the hand did)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runHand } from "../src/adapters/tools/hands.js";
import { createLspPool } from "../src/adapters/lsp/pool.js";
import { LSP, LSP_TOOL, errorsOfDiagnostics, runLsp } from "../src/app/agent/lsp-tool.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { removeDirs, until } from "./helpers/wait.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { RUN_EVENT_TYPE_LIST } from "../src/services/runs.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-lsp.mjs", import.meta.url));
/** How long a write's or an edit's result waits for the file's errors: the owner's 3 s. */
const ERRORS_WAIT_MS = 3000;
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
const APP = "start(); // ERROR: start is not defined\n";
/** A folder with a file the fake server finds an error in. */
const folder = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-lsp-diag-"));
  made.push(d);
  writeFileSync(join(d, "app.js"), APP);
  return d;
};
/** The fake server as yours, with knobs in its environment. @param {Record<string, string>} [env] @returns {import("../src/adapters/lsp/servers.js").LspEntry} */
const fakeEntry = (env = {}) => ({ name: "fake", from: "yours", on: true, spec: { name: "fake", command: process.execPath, args: [FAKE], env, languages: { ".js": "javascript" } } });
/** The column the fake server says a line's error at, 1-based. @param {string} line */
const colOf = (line) => line.indexOf("ERROR:") + 1;
const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
/** @param {any[]} content */
const reply = (content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
/** A request's newest message: its tool results by the call each answers, and its words. @param {any} body */
const newest = (body) => {
  const m = body.messages.at(-1);
  /** @type {any[]} */
  const blocks = Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content) }];
  return {
    results: Object.fromEntries(blocks.filter((b) => b.type === "tool_result").map((b) => [b.tool_use_id, typeof b.content === "string" ? b.content : JSON.stringify(b.content)])),
    said: blocks.filter((b) => b.type === "text").map((b) => b.text),
  };
};

describe("after a write or an edit", () => {
  /** @type {ReturnType<typeof createLspPool>} */
  let pool;
  before(() => {
    pool = createLspPool();
  });
  after(() => pool.closeAll());

  /**
   * One turn of the loop whose hands are the real ones and whose language server is asked through the real lsp tool, on
   * the fake server — as turn.js hands them to it — its model answering `script` request by request; `onLsp` hears each
   * ask.
   * @param {string} root @param {(n: number) => any[] | Promise<any[]>} script
   * @param {{ env?: Record<string, string>, tools?: readonly any[], rules?: any[], mailbox?: any, onLsp?: () => void, onEvent?: (e: any) => void }} [o]
   */
  const turnIn = async (root, script, { env = {}, tools = toolSetFor({ delegateRead: false }), rules = [], mailbox = { read: () => [] }, onLsp = () => {}, onEvent = () => {} } = {}) => {
    /** @type {any[]} */
    const bodies = [];
    const out = await runAgentTurn(
      /** @type {any} */ ({
        model: "m",
        messages: [{ role: "user", content: "go" }],
        system: "s",
        tools,
        rules,
        modeNow: () => "edit",
        root,
        readerModel: "",
        maxTokens: 100,
        costOf: () => 0,
        delegateRead: null,
        mailbox,
        permissions: null,
        tree: null,
        onEvent,
        previewChars: 0,
        sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } },
        signal: null,
        resume: null,
        runHand: (/** @type {string} */ name, /** @type {any} */ input, /** @type {any} */ { root: r, signal }) => runHand(name, input, { root: r, signal }),
        problemsOf: (/** @type {string} */ path, /** @type {{ signal: AbortSignal }} */ { signal }) => {
          onLsp();
          return runLsp({ action: "diagnostics", path }, { root, servers: [fakeEntry(env)], pool, signal });
        },
        call: async (/** @type {any} */ { body }) => {
          bodies.push(structuredClone(body));
          return reply(await script(bodies.length));
        },
      }),
    );
    return { out, bodies };
  };
  /** The folder's server started before the turn: what comes late is its word, not its start. @param {string} root @param {Record<string, string>} [env] */
  const warm = (root, env = {}) => runLsp({ action: "symbols", path: "app.js" }, { root, servers: [fakeEntry(env)], pool });
  /** The folder's server is held by no ask: the word it was waited on for has come. @param {string} root */
  const idle = (root) => {
    const here = pool.running().filter((r) => r.root.toLowerCase() === root.toLowerCase());
    return here.length > 0 && here.every((r) => r.held === 0);
  };

  // (fails before: yes — the results said only what the hand did)
  test("a write's and an edit's results list the errors in the file as each left it — not its warnings — within 3 s", async () => {
    const root = folder();
    // The server has spoken of app.js as it stands: that error is the one the edit takes away.
    assert.equal(await runLsp({ action: "diagnostics", path: "app.js" }, { root, servers: [fakeEntry()], pool }), `app.js:1:${colOf(APP)}: error: start is not defined (fake E1)`);
    const NEW = "go(); // ERROR: go is not defined\n// WARN: a long line\n";
    const EDITED = "begin(); // ERROR: begin is not defined";
    const { bodies } = await turnIn(root, (n) =>
      n === 1
        ? [toolUse("w1", "write", { path: "new.js", content: NEW }), toolUse("e1", "edit", { path: "app.js", edits: [{ oldText: APP.trim(), newText: `${EDITED}\n// WARN: still a long line` }] })]
        : [{ type: "text", text: "Done." }],
    );
    assert.equal(bodies.length, 2);
    const { results } = newest(bodies[1]);
    assert.equal(results.w1, `Successfully wrote to new.js (${Buffer.byteLength(NEW)} bytes)\n\nThe language server finds an error in new.js:\nnew.js:1:${colOf(NEW)}: error: go is not defined (fake E1)`);
    assert.equal(results.e1, `Successfully replaced 1 block in app.js\n\nThe language server finds an error in app.js:\napp.js:1:${colOf(EDITED)}: error: begin is not defined (fake E1)`);
  });

  // The owner's of 11-04 ("for lsp related stuff do keep the token usages in mind"): an agent working a file writes it
  // again and again, and each result listed every error the file held — the ones it had read the step before too.
  // (fails before: yes — every result listed the file's errors whole, and one that left none said nothing)
  test("writes of a file the turn was told the errors of: the new ones listed, the ones told before counted, their end said", async () => {
    const root = folder();
    await warm(root);
    const TWO = "a(); // ERROR: a is not defined\nb(); // ERROR: b is not defined\n";
    const B_AND_C = "b(); // ERROR: b is not defined\nc(); // ERROR: c is not defined\n";
    const B = "b(); // ERROR: b is not defined\n";
    const writes = [TWO, B_AND_C, B, "ok();\n", "fine();\n"];
    const { bodies } = await turnIn(root, (n) => (n <= writes.length ? [toolUse(`w${n}`, "write", { path: "work.js", content: writes[n - 1] })] : [{ type: "text", text: "Done." }]));
    const results = bodies.slice(1).map((b, i) => newest(b).results[`w${i + 1}`]);
    const ok = (/** @type {string} */ text) => `Successfully wrote to work.js (${Buffer.byteLength(text)} bytes)`;
    assert.equal(results[0], `${ok(TWO)}\n\nThe language server finds 2 errors in work.js:\nwork.js:1:${colOf(TWO)}: error: a is not defined (fake E1)\nwork.js:2:${colOf(TWO)}: error: b is not defined (fake E1)`);
    assert.equal(results[1], `${ok(B_AND_C)}\n\nThe language server finds a new error in work.js — one it found before remains:\nwork.js:2:${colOf(B_AND_C)}: error: c is not defined (fake E1)`);
    assert.equal(results[2], `${ok(B)}\n\nThe language server finds no new error in work.js: one it found before remains.`);
    assert.equal(results[3], `${ok("ok();\n")}\n\nThe language server finds no errors in work.js now: the one it found before is gone.`);
    assert.equal(results[4], ok("fine();\n"), "none before, none now: nothing said");
  });

  // The card is the developer's, and costs the model nothing: it shows the file's errors whole, where the result names
  // only those the agent was not told.
  // (fails before: yes — a write's card showed its change alone)
  test("a write's card carries its file's errors as the result was written — every one counted, the first 20 listed, those told before too; one that left none, nothing", async () => {
    const root = folder();
    await warm(root);
    const TWO = "a(); // ERROR: a is not defined\nb(); // ERROR: b is not defined\n// WARN: a long line\n";
    const MANY = Array.from({ length: 25 }, (_, i) => `x${i}(); // ERROR: x${i} is not defined`).join("\n");
    const writes = [TWO, TWO, MANY, "ok();\n"];
    /** @type {any[]} */
    const ends = [];
    await turnIn(root, (n) => (n <= writes.length ? [toolUse(`w${n}`, "write", { path: "work.js", content: writes[n - 1] })] : [{ type: "text", text: "Done." }]), {
      onEvent: (e) => e.type === "tool-end" && ends.push(e),
    });
    const lsp = ends.map((e) => e.lsp);
    const line = (/** @type {number} */ i, /** @type {string} */ name, /** @type {string} */ text) => `work.js:${i}:${colOf(text.split("\n")[i - 1])}: error: ${name} is not defined (fake E1)`;
    assert.deepEqual(lsp[0], { errors: 2, lines: [line(1, "a", TWO), line(2, "b", TWO)] });
    assert.deepEqual(lsp[1], lsp[0], "the result says no new error; the card, the file's two");
    assert.equal(lsp[2].errors, 25);
    assert.deepEqual(lsp[2].lines, Array.from({ length: 20 }, (_, i) => line(i + 1, `x${i}`, MANY)));
    assert.equal(lsp[3], undefined);
  });

  // (fails before: yes — what the server found after a write's result reached the model alone)
  test("errors found after a write's result was written reach its card: an event names the call and its round", async () => {
    const root = folder();
    const env = { FAKE_LSP_DIAG_MS: String(ERRORS_WAIT_MS + 2000) };
    await warm(root, env);
    const LATE = "late(); // ERROR: late is not defined\n";
    /** @type {any[]} */
    const events = [];
    await turnIn(
      root,
      async (n) => {
        if (n === 1) return [toolUse("w1", "write", { path: "late.js", content: LATE })];
        if (n === 2) {
          await until(() => idle(root), "the server's word on late.js");
          return [toolUse("r1", "read", { path: "app.js" })];
        }
        return [{ type: "text", text: "Done." }];
      },
      { env, onEvent: (e) => events.push(e) },
    );
    assert.equal(events.find((e) => e.type === "tool-end" && e.id === "w1")?.lsp, undefined, "its result was written before the server spoke");
    assert.deepEqual(
      events.filter((e) => e.type === "tool-errors").map(({ type, round, id, lsp }) => ({ type, round, id, lsp })),
      [{ type: "tool-errors", round: 1, id: "w1", lsp: { errors: 1, lines: [`late.js:1:${colOf(LATE)}: error: late is not defined (fake E1)`] } }],
    );
  });

  // The lsp tool's words say so, so an agent does not ask for a file's diagnostics after each edit only to read again
  // what its result said.
  // (fails before: yes — its diagnostics line said only what it lists)
  test("the lsp tool's words say a write's or an edit's result carries its file's errors", () => {
    assert.match(LSP_TOOL.description, /diagnostics — the file's errors and warnings now \(a write's or an edit's result says its file's errors by itself\)\./);
  });

  // (fails before: yes — nothing the server said after a write reached the model)
  test("errors the server finds after 3 s are not in the result: they ride the next step, once", async () => {
    const root = folder();
    const env = { FAKE_LSP_DIAG_MS: String(ERRORS_WAIT_MS + 2000) };
    await warm(root, env);
    const LATE = "late(); // ERROR: late is not defined\n// WARN: a long line\n";
    const { bodies } = await turnIn(
      root,
      async (n) => {
        if (n === 1) return [toolUse("w1", "write", { path: "late.js", content: LATE })];
        // The model writes its next step while the server's word comes.
        if (n === 2) {
          await until(() => idle(root), "the server's word on late.js");
          return [toolUse("r1", "read", { path: "app.js" })];
        }
        if (n === 3) return [toolUse("r2", "read", { path: "app.js" })];
        return [{ type: "text", text: "Done." }];
      },
      { env },
    );
    assert.equal(bodies.length, 4);
    const second = newest(bodies[1]);
    assert.equal(second.results.w1, `Successfully wrote to late.js (${Buffer.byteLength(LATE)} bytes)`, "its result was written before the server spoke");
    assert.deepEqual(second.said, []);
    const third = newest(bodies[2]);
    assert.ok("r1" in third.results, JSON.stringify(third));
    assert.deepEqual(third.said, [`The language server found an error in late.js after your write's result was written:\nlate.js:1:${colOf(LATE)}: error: late is not defined (fake E1)`]);
    assert.deepEqual(newest(bodies[3]).said, [], "said once");
  });

  // (fails before: yes — the turn ended on "Done." with the edit's error unread)
  test("errors that come as the model writes what would be its last reply: the turn goes one more step with them", async () => {
    const root = folder();
    const env = { FAKE_LSP_DIAG_MS: String(ERRORS_WAIT_MS + 2000) };
    await warm(root, env);
    const LAST = "last(); // ERROR: last is not defined\n";
    const { out, bodies } = await turnIn(
      root,
      async (n) => {
        if (n === 1) return [toolUse("w1", "edit", { path: "app.js", edits: [{ oldText: APP.trim(), newText: LAST.trim() }] })];
        if (n === 2) {
          await until(() => idle(root), "the server's word on app.js");
          return [{ type: "text", text: "Done." }];
        }
        return [{ type: "text", text: "Fixed after all." }];
      },
      { env },
    );
    assert.equal(out.status, "done");
    assert.equal(bodies.length, 3);
    assert.equal(newest(bodies[1]).results.w1, "Successfully replaced 1 block in app.js");
    assert.deepEqual(bodies[2].messages.at(-2), { role: "assistant", content: [{ type: "text", text: "Done." }] });
    assert.deepEqual(newest(bodies[2]).said, [`The language server found an error in app.js after your edit's result was written:\napp.js:1:${colOf(LAST)}: error: last is not defined (fake E1)`]);
    assert.deepEqual(out.final, [{ type: "text", text: "Fixed after all." }]);
  });

  // (fails before: no — a guard: errors gone, said in a line, must not cost the turn a step of its own at its end)
  test("errors gone, come as the model writes its last reply: said nowhere, and the turn ends there", async () => {
    const root = folder();
    const env = { FAKE_LSP_DIAG_MS: String(ERRORS_WAIT_MS + 2000) };
    await warm(root, env);
    const LATE = "late(); // ERROR: late is not defined\n";
    const { out, bodies } = await turnIn(
      root,
      async (n) => {
        if (n === 1) return [toolUse("w1", "write", { path: "late.js", content: LATE })];
        if (n === 2) {
          await until(() => idle(root), "the server's word on late.js");
          return [toolUse("r1", "read", { path: "app.js" })];
        }
        if (n === 3) return [toolUse("w2", "write", { path: "late.js", content: "late = 1;\n" })];
        if (n === 4) {
          await until(() => idle(root), "the server's word on the fix");
          return [{ type: "text", text: "Done." }];
        }
        return [{ type: "text", text: "A step for nothing." }];
      },
      { env },
    );
    assert.equal(out.status, "done");
    assert.deepEqual(newest(bodies[2]).said, [`The language server found an error in late.js after your write's result was written:\nlate.js:1:${colOf(LATE)}: error: late is not defined (fake E1)`]);
    assert.equal(bodies.length, 4, "no step for an end of errors");
    assert.deepEqual(out.final, [{ type: "text", text: "Done." }]);
  });

  // (fails before: yes — there was no errorsOfDiagnostics: a diagnostics that said nothing in time read as no errors)
  test("what diagnostics said, read for its errors: none where it finds no problems or lesser ones, null where it said nothing", () => {
    assert.deepEqual(errorsOfDiagnostics("(no matches) fake finds no problems in a.js."), []);
    assert.deepEqual(errorsOfDiagnostics("a.js:1:2: warning: long (fake)"), []);
    assert.deepEqual(errorsOfDiagnostics("a.js:1:2: error: x is not defined (fake E1)\na.js:2:1: warning: long (fake)"), ["a.js:1:2: error: x is not defined (fake E1)"]);
    assert.equal(errorsOfDiagnostics("(no matches) fake said nothing of a.js's problems within 10 s; it may still be reading the project — ask again in a moment."), null);
    assert.equal(errorsOfDiagnostics("(no matches) No language server here serves .md files. Use grep and read for this file."), null);
    assert.equal(errorsOfDiagnostics("Error: stopped while language server fake started"), null);
  });

  // (fails before: yes — no server was asked, so no stop came while one was waited on)
  test("a stop cuts the wait: the turn ends at the stop, the result as the write left it, the server let go", async () => {
    const root = folder();
    const env = { FAKE_LSP_DIAG_MS: "30000" };
    await warm(root, env);
    const stop = new AbortController();
    let stoppedAt = 0;
    const SLOW = "slow(); // ERROR: slow is not defined\n";
    const { out } = await turnIn(root, (n) => (n === 1 ? [toolUse("w1", "write", { path: "slow.js", content: SLOW })] : [{ type: "text", text: "Done." }]), {
      env,
      mailbox: { read: () => (stop.signal.aborted ? [{ kind: "stop", text: "", from: "harness" }] : []), stopSignal: stop.signal },
      onLsp: () =>
        void setTimeout(() => {
          stoppedAt = Date.now();
          stop.abort();
        }, 200),
    });
    const took = Date.now() - stoppedAt;
    assert.equal(out.status, "stopped");
    assert.ok(stoppedAt > 0 && took < 1000, `the turn ended at the stop, not when the ${ERRORS_WAIT_MS} ms were up (${took} ms after it)`);
    const result = out.work.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b.type === "tool_result" && b.tool_use_id === "w1");
    assert.equal(result?.content, `Successfully wrote to slow.js (${Buffer.byteLength(SLOW)} bytes)`);
    await until(() => idle(root), "the server let go by the stopped ask");
  });

  // (fails before: yes — no server was asked of any file)
  test("a file no server serves says nothing, at once; a chat that switched lsp off, or whose rules refuse it or ask first, asks nothing", async () => {
    const root = folder();
    let asks = 0;
    const counted = () => void asks++;
    /** One write and its result. @param {string} path @param {string} content @param {Parameters<typeof turnIn>[2]} o */
    const wrote = async (path, content, o) => {
      const { bodies } = await turnIn(root, (n) => (n === 1 ? [toolUse("w1", "write", { path, content })] : [{ type: "text", text: "Done." }]), { onLsp: counted, ...o });
      return newest(bodies[1]).results.w1;
    };
    const t0 = Date.now();
    assert.equal(await wrote("notes.md", "# ERROR: not code\n", {}), "Successfully wrote to notes.md (18 bytes)");
    assert.equal(asks, 1, "the lsp tool was asked");
    assert.ok(Date.now() - t0 < ERRORS_WAIT_MS, `and said at once that no server serves .md files (${Date.now() - t0} ms)`);
    const BAD = "x(); // ERROR: x is not defined\n";
    assert.equal(await wrote("off.js", BAD, { tools: toolSetFor({ delegateRead: false, disabled: [LSP] }) }), `Successfully wrote to off.js (${Buffer.byteLength(BAD)} bytes)`);
    assert.equal(await wrote("denied.js", BAD, { rules: [{ tool: LSP, pattern: "*", verdict: "deny" }] }), `Successfully wrote to denied.js (${Buffer.byteLength(BAD)} bytes)`);
    assert.equal(await wrote("asks.js", BAD, { rules: [{ tool: LSP, pattern: "*", verdict: "ask" }] }), `Successfully wrote to asks.js (${Buffer.byteLength(BAD)} bytes)`);
    assert.equal(asks, 1, "and only of the file no server serves");
  });
});

describe("in a whole turn", () => {
  /** @type {any} */
  let up;
  /** @type {any} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {string} */
  let dataDir;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = folder();
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "init");
    up = await fakeUpstream(async (/** @type {any} */ call) => brain(call));
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
    dataDir = shim.dataDir;
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(dataDir);
  });
  const answer = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });

  // (fails before: yes — the write's result said only what the hand did)
  test("the chat's own language server: the write's result lists its file's error", async () => {
    const settings = { lsp: { servers: [{ name: "fake", command: process.execPath, args: [FAKE], extensionToLanguage: { ".js": "javascript" } }] } };
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings } });
    if (created.status !== 200) assert.fail(`HTTP ${created.status}: ${await created.text()}`);
    const id = String((await created.json()).id);
    const BAD = "bad(); // ERROR: bad is not defined\n// WARN: a long line\n";
    /** @type {any[]} */
    const seen = [];
    brain = (/** @type {any} */ call) => {
      seen.push(call.body);
      const all = JSON.stringify(call.body.messages);
      // The chat's server starts at the agent's own first ask; then it writes.
      if (!all.includes('"id":"s1"')) return answer([{ type: "tool_use", id: "s1", name: LSP, input: { action: "symbols", path: "app.js" } }], "tool_use");
      if (!all.includes('"id":"w1"')) return answer([{ type: "tool_use", id: "w1", name: "write", input: { path: "bad.js", content: BAD } }], "tool_use");
      return answer([{ type: "text", text: "Done." }]);
    };
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "write bad.js", stream: false } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    const answered = seen.find((b) => JSON.stringify(b.messages.at(-1)).includes('"tool_use_id":"w1"'));
    assert.ok(answered, "the write's result went to the model");
    assert.equal(newest(answered).results.w1, `Successfully wrote to bad.js (${Buffer.byteLength(BAD)} bytes)\n\nThe language server finds an error in bad.js:\nbad.js:1:${colOf(BAD)}: error: bad is not defined (fake E1)`);
  });
});

describe("on the page", () => {
  // (fails before: yes — a write's or an edit's card drew its change alone, and no event brought errors found later)
  test("a write's or an edit's card counts its file's errors on its row and lists them over its change, each at its line and column; those found later land on the call they followed — a sub-agent's too", () => {
    for (const type of ["tool-errors", "subagent-tool-errors"]) assert.ok(RUN_EVENT_TYPE_LIST.includes(type), `${type} is a run event`);
    const doc = stubDocument();
    try {
      const many = Array.from({ length: 20 }, (_, i) => `work.js:${i + 1}:9: error: x${i} is not defined (fake E1)`);
      const late = "late.js:3:1: error: late is not defined (fake E1)";
      const events = [
        { type: "tool-start", round: 1, id: "w1", name: "write", args: "work.js", card: { kind: "write", title: null, subject: "work.js" } },
        { type: "tool-end", round: 1, id: "w1", name: "write", ok: true, ms: 5, chars: 40, lsp: { errors: 23, lines: many } },
        { type: "tool-start", round: 1, id: "e1", name: "edit", args: "late.js", card: { kind: "edit", title: null, subject: "late.js" } },
        { type: "tool-end", round: 1, id: "e1", name: "edit", ok: true, ms: 5, chars: 40 },
        { type: "tool-errors", round: 1, id: "e1", lsp: { errors: 1, lines: [late] } },
        { type: "tool-start", round: 1, id: "e2", name: "edit", args: "fine.js", card: { kind: "edit", title: null, subject: "fine.js" } },
        { type: "tool-end", round: 1, id: "e2", name: "edit", ok: true, ms: 5, chars: 40 },
        { type: "tool-start", round: 1, id: "a1", name: "agent", args: "Fix it" },
        { type: "subagent-start", round: 1, parent: "a1", agentId: "sa_1", description: "Fix it", agent: "builder", model: "m", exchange: 0 },
        { type: "subagent-tool-start", round: 1, parent: "a1", id: "s1", name: "write", args: "sub.js", card: { kind: "write", title: null, subject: "sub.js" } },
        { type: "subagent-tool-end", round: 1, parent: "a1", id: "s1", name: "write", ok: true, ms: 5, chars: 40 },
        { type: "subagent-tool-errors", round: 1, parent: "a1", id: "s1", lsp: { errors: 2, lines: ["sub.js:1:1: error: a (fake E1)", "sub.js:2:1: error: b (fake E1)"] } },
      ];
      const cell = alignEvents(events).byRound.get(1);
      assert.deepEqual(cell?.tools.get("a1").sub.tools.get("s1").lsp, { errors: 2, lines: ["sub.js:1:1: error: a (fake E1)", "sub.js:2:1: error: b (fake E1)"] });
      /** @type {any[]} */
      const rows = roundRows(cell);
      // A card's own row, inside any group its round folds calls of a kind into.
      const rowOf = (/** @type {string} */ file) =>
        rows.flatMap((r) => [r, ...r.querySelectorAll(".tool-row")]).find((r) => r.className.includes("tool-row") && !r.querySelectorAll(".tool-row").length && r.querySelector(".file-chip")?.textContent === file);
      const wrote = rowOf("work.js");
      assert.equal(wrote.querySelector(".edit-errors")?.textContent, "23 errors");
      const items = wrote.querySelectorAll(".lsp-errors li");
      assert.equal(items.length, 21, "the 20 it carries, and how many more");
      assert.deepEqual([items[0].querySelector(".lsp-at")?.textContent, items[0].textContent], ["1:9", "1:9x0 is not defined (fake E1)"]);
      assert.equal(items[20].textContent, "3 more");
      const edited = rowOf("late.js");
      assert.equal(edited.querySelector(".edit-errors")?.textContent, "1 error");
      assert.equal(edited.querySelector(".lsp-errors li")?.textContent, "3:1late is not defined (fake E1)");
      const fine = rowOf("fine.js");
      assert.deepEqual([fine.querySelector(".edit-errors"), fine.querySelector(".lsp-errors")], [null, null], "none found: nothing said");
    } finally {
      doc.restore();
    }
  });
});
