// @ts-check
// Memory as a service (HarnessV3-Memory M7-6, M7-D38..D46): `/mcp/memory`, the MCP server an agent Filament does not run
// adds once. Who may call; the session, a chain of memory's made on first use, that outlives a restart and is told
// what was corrected since it was shown it; the folder it stands in, asked of the client as its roots; the tools; the
// opening words. First on the handler over scripted requests (the client's pace is the test's), then over HTTP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryMcp, memoryMcpRefusal, originAllowed, mcpSessionKey } from "../src/http/memory-mcp.js";
import { MEMORY_MCP_TOOLS, memoryMcpCall } from "../src/app/memory-mcp.js";
import { estimateTokens } from "../src/core/tokens.js";
import { houseAuth } from "../src/services/house.js";
import { projectOf, dateOf } from "../src/services/memory/brain.js";
import { world } from "./fixtures/memory-world.mjs";
import { startApp } from "./helpers/app.js";

const CWD = "C:\\evals";

/** One SSE block's JSON-RPC message. @param {string} text */
const framesIn = (text) =>
  text
    .split("\n\n")
    .map((b) => /^data: (.*)$/m.exec(b)?.[1])
    .filter(Boolean)
    .map((d) => JSON.parse(/** @type {string} */ (d)));

/**
 * A request to the handler as a client sends it: the body arrives after `handle` begins, the response is recorded.
 * `start` returns at once with the response so far (a stream's frames as they come); `done` when it ends.
 * @param {MemoryMcp} mcp @param {any} body
 * @param {{ headers?: Record<string, string>, method?: string, query?: string, remote?: string }} [o]
 */
function start(mcp, body, { headers = {}, method = "POST", query = "", remote = "127.0.0.1" } = {}) {
  const req = Object.assign(new EventEmitter(), { method, headers: { "content-type": "application/json", ...headers }, socket: { remoteAddress: remote }, resume() {} });
  /** @type {{ status: number, headers: Record<string, string>, chunks: string[], ended: boolean }} */
  const out = { status: 0, headers: {}, chunks: [], ended: false };
  const res = Object.assign(new EventEmitter(), {
    /** @param {number} s @param {Record<string, string>} [h] */
    writeHead(s, h = {}) {
      out.status = s;
      out.headers = h;
    },
    /** @param {string} c */
    write(c) {
      out.chunks.push(String(c));
      return true;
    },
    /** @param {string} [c] */
    end(c) {
      if (c) out.chunks.push(String(c));
      out.ended = true;
      res.emit("close");
    },
  });
  const done = mcp.handle(/** @type {any} */ (req), /** @type {any} */ (res), new URL(`http://x/mcp/memory${query}`));
  if (method === "POST") {
    req.emit("data", Buffer.from(typeof body === "string" ? body : JSON.stringify(body)));
    req.emit("end");
  }
  const text = () => out.chunks.join("");
  return {
    out,
    res,
    frames: () => framesIn(text()),
    done: done.then(() => ({ status: out.status, headers: out.headers, text: text(), json: /json/.test(out.headers["content-type"] || "") ? JSON.parse(text()) : null, frames: framesIn(text()) })),
  };
}
/** @param {MemoryMcp} mcp @param {any} body @param {Parameters<typeof start>[2]} [o] */
const call = (mcp, body, o) => start(mcp, body, o).done;
const until = async (/** @type {() => boolean} */ ok, /** @type {string} */ what) => {
  const end = Date.now() + 5000;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
};

/**
 * An MCP client over the handler: a session once initialized, its folder by header when it names one, its roots when
 * it declares them, a stream when it takes one.
 * @param {MemoryMcp} mcp
 * @param {{ name?: string, cwd?: string, roots?: boolean, sse?: boolean, key?: string }} [o]
 */
function client(mcp, { name = "claude-code", cwd = "", roots = false, sse = false, key = "k" } = {}) {
  let sid = "";
  let n = 0;
  const headers = () => ({
    authorization: `Bearer ${key}`,
    accept: sse ? "application/json, text/event-stream" : "application/json",
    ...(sid ? { "mcp-session-id": sid } : {}),
    ...(cwd ? { "x-filament-cwd": cwd } : {}),
  });
  return {
    get sid() {
      return sid;
    },
    set sid(v) {
      sid = v;
    },
    /** @param {any} body @param {{ headers?: Record<string, string>, query?: string }} [o] */
    start: (body, o = {}) => start(mcp, body, { ...o, headers: { ...headers(), ...o.headers } }),
    /** @param {any} body @param {{ headers?: Record<string, string>, query?: string }} [o] */
    post: (body, o = {}) => call(mcp, body, { ...o, headers: { ...headers(), ...o.headers } }),
    async init(/** @type {{ query?: string }} */ o = {}) {
      const r = await call(mcp, { jsonrpc: "2.0", id: ++n, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: roots ? { roots: { listChanged: true } } : {}, clientInfo: { name, version: "1.0" } } }, { ...o, headers: headers() });
      sid = r.headers["mcp-session-id"];
      await call(mcp, { jsonrpc: "2.0", method: "notifications/initialized" }, { headers: headers() });
      return r.json.result;
    },
    /** @param {string} tool @param {any} [args] */
    async tool(tool, args = {}) {
      const r = await call(mcp, { jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name: tool, arguments: args } }, { headers: headers() });
      return r.json.result;
    },
  };
}
/** The handler on a world's memory, its server section as given. @param {any} w @param {any} [server] */
const rig = (w, server = { inboundKeys: ["k"] }, o = {}) => new MemoryMcp({ memory: w.svc, config: { get: () => ({ ...w.cfg, server }) }, rootsWaitMs: 300, ...o });
/** A tool answer's last text, parsed. @param {any} r */
const answer = (r) => JSON.parse(r.content.at(-1).text);
const pid = projectOf({ cwdHint: CWD }).id;

test("M7-D39: who may call — never a page elsewhere; the house key; with keys set one of them, whatever requireAuth says; with none, this machine only", () => {
  const req = (/** @type {Record<string, string>} */ headers, remote = "127.0.0.1") => /** @type {any} */ ({ headers, socket: { remoteAddress: remote } });
  const keyed = { inboundKeys: ["k1", "k2"], requireAuth: false };
  const no = memoryMcpRefusal(req({}), keyed);
  assert.equal(no?.status, 401, "no key, though requireAuth is off: the model endpoints' rule is not memory's");
  assert.equal(no?.headers?.["www-authenticate"], 'Bearer realm="Filament memory"');
  assert.equal(memoryMcpRefusal(req({ authorization: "Bearer nope" }), keyed)?.status, 401);
  assert.equal(memoryMcpRefusal(req({ authorization: "Bearer k2" }, "10.0.0.9"), keyed), null, "a key passes from anywhere");
  assert.equal(memoryMcpRefusal(req({ "x-api-key": "k1" }), keyed), null);
  assert.equal(memoryMcpRefusal(req(houseAuth(), "10.0.0.9"), keyed), null, "Filament's own key");
  const open = { inboundKeys: [], requireAuth: true };
  assert.equal(memoryMcpRefusal(req({}), open), null, "no key set: this machine");
  assert.equal(memoryMcpRefusal(req({}, "::1"), open), null);
  assert.equal(memoryMcpRefusal(req({}, "10.0.0.9"), open)?.status, 403, "no key set: never another");
  assert.equal(memoryMcpRefusal(req({}, "10.0.0.9"), { inboundKeys: [""] })?.status, 403, "an empty key is none");
  assert.equal(memoryMcpRefusal(req(houseAuth(), "10.0.0.9"), open), null);
  // A page elsewhere, through the owner's browser: refused before any key is read.
  assert.equal(memoryMcpRefusal(req({ origin: "https://evil.example", authorization: "Bearer k1" }), keyed)?.status, 403);
  assert.equal(memoryMcpRefusal(req({ origin: "null" }), open)?.status, 403, "a sandboxed page or a file");
  for (const [origin, ok] of /** @type {[string, boolean][]} */ ([
    ["http://localhost:5173", true],
    ["http://app.localhost", true],
    ["http://127.0.0.1:20300", true],
    ["http://[::1]:20300", true],
    ["http://192.168.1.4", false],
    ["http://box.lan", true],
    ["http://shim.home", true],
    ["http://other.lan", false],
  ]))
    assert.equal(originAllowed(origin, { host: "shim.home", allowedHosts: ["BOX.lan"] }), ok, origin);
  assert.equal(originAllowed(undefined, {}), true, "no Origin: no browser");
});

test("M7-D38: POST speaks JSON-RPC — one message or a batch, notifications 202, the protocol the client asked when known; GET, another type, a bad body are refused in words", () =>
  world({}, async (w) => {
    const mcp = rig(w);
    const auth = { authorization: "Bearer k" };
    const get = await call(mcp, "", { method: "GET", headers: auth });
    assert.deepEqual([get.status, get.headers.allow], [405, "POST, DELETE"]);
    assert.equal((await call(mcp, "{}", { headers: { ...auth, "content-type": "text/plain" } })).status, 415, "a page's POST with no preflight");
    assert.equal((await call(mcp, "{nope", { headers: auth })).json.error.code, -32700);
    assert.equal((await call(mcp, { jsonrpc: "2.0", id: 1, method: "ping" }, { headers: {} })).status, 401, "the key is asked before the body is read");
    const small = rig(w, { inboundKeys: ["k"], maxBodyBytes: 64 });
    assert.equal((await call(small, { jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(200) } }, { headers: auth })).status, 413, "too big: 413");
    const c = client(mcp);
    const init = await c.init();
    assert.match(c.sid, /^[0-9a-f]{32}$/);
    assert.deepEqual([init.protocolVersion, init.serverInfo.name, init.capabilities], ["2025-06-18", "filament-memory", { tools: { listChanged: false } }]);
    const newer = await call(mcp, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } }, { headers: auth });
    assert.equal(newer.json.result.protocolVersion, "2025-11-25", "one it does not know: its newest");
    const note = await c.post({ jsonrpc: "2.0", method: "notifications/cancelled", params: {} });
    assert.deepEqual([note.status, note.headers["mcp-session-id"]], [202, c.sid]);
    const batch = await c.post([{ jsonrpc: "2.0", id: 7, method: "ping" }, { jsonrpc: "2.0", method: "notifications/x" }, { jsonrpc: "1.0", id: 8, method: "ping" }, 42, { jsonrpc: "2.0", id: 9, method: "nope" }]);
    assert.deepEqual(
      batch.json.map((/** @type {any} */ r) => [r.id, r.result ? "ok" : r.error.code]),
      [[7, "ok"], [8, -32600], [9, -32601], [null, -32600]],
      "each request answered, the notification not, the invalid said",
    );
    const unknown = await c.post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "rm", arguments: {} } });
    assert.equal(unknown.json.error.code, -32602);
    const empties = await c.post([{ jsonrpc: "2.0", id: 10, method: "resources/list" }, { jsonrpc: "2.0", id: 11, method: "resources/templates/list" }, { jsonrpc: "2.0", id: 12, method: "prompts/list" }]);
    assert.deepEqual(empties.json.map((/** @type {any} */ r) => r.result), [{ resources: [] }, { resourceTemplates: [] }, { prompts: [] }], "the lists some clients ask for, answered empty");
  }));

test("M7-D44: the thirteen tools, by short names, the reads marked read only, each schema an object", () =>
  world({}, async (w) => {
    const c = client(rig(w));
    await c.init();
    const { tools } = (await c.post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json.result;
    assert.deepEqual(tools.map((/** @type {any} */ t) => t.name), ["brief", "search", "claim", "history", "pitfalls", "questions", "sessions", "load", "remember", "correct", "close", "confirm", "forget"]);
    assert.deepEqual(tools, MEMORY_MCP_TOOLS);
    assert.deepEqual(
      tools.filter((/** @type {any} */ t) => t.annotations.readOnlyHint).map((/** @type {any} */ t) => t.name),
      ["brief", "search", "claim", "history", "pitfalls", "questions", "sessions", "load"],
    );
    for (const t of tools) assert.equal(t.inputSchema.type, "object", t.name);
    const by = Object.fromEntries(tools.map((/** @type {any} */ t) => [t.name, t]));
    assert.deepEqual(tools.filter((/** @type {any} */ t) => t.inputSchema.properties?.cwd).map((/** @type {any} */ t) => t.name), ["brief", "search", "pitfalls", "questions", "remember"], "the calls that stand in a folder take one");
    assert.deepEqual([by.pitfalls.annotations.readOnlyHint, by.pitfalls.annotations.idempotentHint], [true, false], "pitfalls are said once: asking again says less");
    assert.equal(by.confirm.annotations.idempotentHint, true, "confirming twice is confirming once");
    assert.equal(by.close.annotations.idempotentHint, true, "closing twice is closing once");
    assert.deepEqual(by.remember.inputSchema.properties.scope.enum, ["project", "global"]);
    assert.ok(!JSON.stringify(tools).includes("filament_memory_"), "the shared words name the tools as they are called here");
    assert.ok(tools.find((/** @type {any} */ t) => t.name === "remember")?.description.includes("`correct`"));
  }));

test("M7-D40: a session is a chain of kind mcp, made on its first call that reads or writes memory, named for its client, in the project of its folder, and in no list of the person's sessions", () =>
  world({}, async (w) => {
    const mcp = rig(w);
    const c = client(mcp, { name: "Claude Code", cwd: CWD });
    await c.init();
    await c.post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    // Its folder was known as it opened, but memory held nothing to say: no chain.
    assert.equal(w.svc.mcpChainOf(mcpSessionKey(c.sid)), null, "opening and listing write nothing");
    await c.tool("search", { query: "anything" });
    const chain = w.svc.mcpChainOf(mcpSessionKey(c.sid));
    assert.deepEqual([chain.kind, chain.client, chain.project_id], ["mcp", "mcp:Claude-Code", pid]);
    assert.ok(!w.svc.brain.sessions("").some((/** @type {any} */ s) => s.id === chain.id), "not a session the person had");
  }));

test("M7-6's proof: an MCP client corrects a claim; the session shown it hears the erratum and the new words, so does another MCP session shown it, the one that corrected it does not, and a new session that asks finds the new words, never the old", () =>
  world({}, async (w) => {
    const owner = w.svc.scope({ role: "owner", project: pid });
    const old = (await owner.remember("Always build with pnpm, never npm.", { kind: "rule" })).id;
    await w.settle();
    const s = w.session("s-one");
    assert.ok((await s.send("hello")).seen.includes("Always build with pnpm"), "the session is briefed with the rule");
    const mcp = rig(w);
    const a = client(mcp, { cwd: CWD });
    const opening = await a.init();
    assert.ok(opening.instructions.includes(`[${old} `) && opening.instructions.includes("Always build with pnpm"), "A opens knowing the user's rule (M7-D45)");
    const b = client(mcp, { cwd: CWD, name: "cursor" });
    await b.init();
    const fixed = answer(await b.tool("correct", { id: old, text: "Always build with bun now; pnpm is gone.", reason: "the repo moved to bun" }));
    assert.equal(fixed.ok, true);
    const now = fixed.id;
    const heard = await a.tool("questions");
    assert.equal(heard.content.length, 2, "A's next answer opens with the erratum");
    assert.match(heard.content[0].text, new RegExp(`Memory correction: \\[${old}\\] "Always build with pnpm, never npm\\." no longer holds — now \\[${now}\\] "Always build with bun now`));
    assert.equal((await a.tool("questions")).content.length, 1, "said once");
    assert.equal((await b.tool("questions")).content.length, 1, "B made the correction: it is not told of it");
    const next = (await s.send("and how do we build now?")).seen;
    assert.ok(next.includes(`Memory correction: [${old}]`) && next.includes(`now [${now}]`), "the session hears it on its next turn");
    assert.ok(next.indexOf(`Memory correction: [${old}]`) < next.indexOf("Related memory for this message"), "at the top of the turn's block");
    // An agent's word is no rule of the user's (M2-6): the replacement is not briefed as one, and is found when a turn
    // asks; what it replaced is said nowhere again.
    const fresh = (await w.session("s-two").send("how do we build this project?")).seen;
    assert.ok(fresh.includes(`[${now} `) && fresh.includes("Always build with bun now"), "a new session asking finds the new words");
    assert.ok(!fresh.includes("Always build with pnpm"), "and never the old");
    const chainB = w.svc.mcpChainOf(mcpSessionKey(b.sid));
    assert.equal(w.svc.archive.items.get(Number(now.slice(1))).chain_id, chainB.id, "the correction names the session that made it");
  }));

test("M7-D40: a turn that carries only an erratum has its replacement judged as anything memory adds — logged on the request, used when the reply says it", () =>
  world({}, async (w) => {
    const owner = w.svc.scope({ role: "owner", project: pid });
    const old = (await owner.remember("Always build with pnpm, never npm.", { kind: "rule" })).id;
    await w.settle();
    const s = w.session("s-erratum");
    await s.send("hello");
    const now = (await w.svc.scope({ role: "agent", project: pid }).correct(old, { text: "Always build with bun now; pnpm is gone.", reason: "the repo moved" })).id;
    const turn = await s.send("and how do we run the test suite?", { reply: "We build with bun now; pnpm is gone. The suite runs with vitest." });
    assert.ok(turn.seen.includes(`<filament-memory kind="turn">\nMemory correction: [${old}]`), "the erratum is the turn's block");
    assert.deepEqual(turn.prep.ids, [now], "the replacement is what memory added to this request");
    const rows = w.svc.archive.db.prepare("SELECT i.kind, ii.memory_id, ii.used FROM injections i JOIN injection_ids ii ON ii.injection_id = i.id WHERE i.request_id = ?").all(turn.requestId);
    assert.deepEqual(rows.map((/** @type {any} */ r) => [r.kind, r.memory_id, r.used]), [["erratum", now, 1]], "logged on the request, and judged used: the reply says it");
  }));

test("M7-D40: a turn's errata add each replacement to what memory added once — not again when its block found it too — and a memory retired with nothing in its place adds nothing", () =>
  world({}, async (w) => {
    const owner = w.svc.scope({ role: "owner", project: pid });
    const old = (await owner.remember("The test suite runs with jest.", { kind: "fact" })).id;
    const gone = (await owner.remember("The test suite runs on the shared runner box.", { kind: "fact" })).id;
    await w.settle();
    const s = w.session("s-errata-ids");
    const first = await s.send("how do we run the test suite?");
    assert.ok([old, gone].every((id) => first.prep.ids.includes(id)), "both shown to the session");
    const now = (await w.svc.scope({ role: "agent", project: pid }).correct(old, { text: "The test suite runs with vitest; jest is gone.", reason: "migrated" })).id;
    await owner.forget(gone, { reason: "no shared runner box any more" });
    const turn = await s.send("how do we run the test suite now?");
    assert.ok(turn.seen.includes(`Memory correction: [${old}]`) && turn.seen.includes(`Memory correction: [${gone}]`), "both said");
    assert.ok(turn.seen.split("\n").some((l) => l.startsWith(`- [${now} `)), "the block found the replacement too");
    assert.deepEqual(turn.prep.ids, [now], "the replacement once; the retirement adds nothing");
  }));

test("M7-D47: what an agent outside Filament stores or corrects is its finding, named for its client: on its record, its card and the claim browser's, as sure as a model's note, and served as found with the words that say what that means", () =>
  world({}, async (w) => {
    const mcp = rig(w);
    const a = client(mcp, { cwd: CWD, name: "Cursor IDE" });
    await a.init();
    const stored = answer(await a.tool("remember", { text: "The evals harness writes its reports under out/reports.", kind: "fact" }));
    const finder = { agent: "Cursor-IDE", type: "MCP" };
    const created = w.svc.archive.items.events(Number(stored.id.slice(1))).find((/** @type {any} */ e) => e.action === "created");
    assert.deepEqual([created.by, created.detail.finder], ["agent", finder], "named on its record");
    const owner = w.svc.scope({ role: "owner", project: pid });
    const card = owner.claim(stored.id);
    assert.deepEqual([card.trust, card.finder], ["an agent found", finder]);
    const listed = w.svc.claims(pid, { q: "out/reports" }).claims.find((/** @type {any} */ c) => c.id === stored.id);
    assert.deepEqual([listed?.sure, listed?.trust, listed?.finder], [0.55, "an agent found", finder], "the claim browser's card: as sure as a sub-agent's finding, named");
    const rule = (await owner.remember("Never commit the out/ folder.", { kind: "rule" })).id;
    const port = (await owner.remember("The evals dashboard listens on port 4410.", { kind: "fact" })).id;
    const night = (await owner.remember("The evals dashboard restarts every night at 02:00.", { kind: "fact" })).id;
    await w.settle();
    const s = w.session("s-shown");
    const shown = await s.send("can I commit the out folder, and which port is the evals dashboard on, and when does it restart?");
    assert.ok([rule, port, night].every((id) => shown.seen.includes(`[${id} `)), shown.seen);
    const fixed = answer(await a.tool("correct", { id: rule, text: "Commit out/reports, never the rest of out/.", reason: "reports are reviewed in PRs" }));
    assert.deepEqual([owner.claim(fixed.id).trust, owner.claim(fixed.id).finder], ["an agent found", finder], "a correction is its finding too");
    assert.equal(answer(await a.tool("forget", { id: port, reason: "the dashboard moved behind the proxy" })).ok, true);
    assert.equal(answer(await a.tool("correct", { id: night, reason: "it no longer restarts" })).ok, true, "a correction with no new words only retires");
    // (fails before: yes — the door had no close, M7-D64) An open thread it finished: closed, named for it.
    const open = `i${(await w.svc.brain.fileLearned({ projectId: pid, chainId: "l9", kind: "thread", text: "out/reports still needs an index page", importance: 0.6 })).id}`;
    assert.deepEqual(answer(await a.tool("close", { id: open, because: "the index page is written" })), { ok: true, id: open, status: "dismissed", closed: true });
    assert.deepEqual(w.svc.archive.items.events(Number(open.slice(1))).filter((/** @type {any} */ e) => e.action === "closed").map((/** @type {any} */ e) => [e.by, e.detail.finder]), [["agent", finder]]);
    // The machine's day, as the line writes it (FixRound decision 30): not the UTC day.
    const day = dateOf(Date.now());
    const told = [
      `Memory correction: [${rule}] "Never commit the out/ folder." no longer holds — now [${fixed.id}] "Commit out/reports, never the rest of out/." (Cursor-IDE, an agent over MCP, ${day}).`,
      `Memory correction: [${port}] "The evals dashboard listens on port 4410." no longer holds (Cursor-IDE, an agent over MCP, ${day}).`,
      `Memory correction: [${night}] "The evals dashboard restarts every night at 02:00." no longer holds (Cursor-IDE, an agent over MCP, ${day}).`,
    ];
    const next = await s.send("ok, and the reports?");
    for (const line of told) assert.ok(next.seen.includes(line), `the session's erratum names the agent: ${next.seen}`);
    const sub = await w.svc.scope({ role: "agent", project: pid, chain: shown.prep.chain, turn: next.prep.turn }).brief({ purpose: "subagent", task: "commit the reports", tools: [] });
    for (const line of told) assert.ok(sub.text.includes(line), `so does a sub-agent's brief, read from the history: ${sub.text}`);
    const status = w.svc.archive.items.events(Number(port.slice(1))).filter((/** @type {any} */ e) => e.action === "status").at(-1);
    assert.deepEqual([status.by, status.detail.finder], ["agent", finder], "named on the claim's history");
    const brief = await w.svc.scope({ role: "agent", project: pid }).brief({ purpose: "subagent", task: "Where do the evals reports go?", tools: [] });
    assert.ok(brief.text.split("\n").some((l) => l.startsWith(`- [${stored.id} fact · an agent found · `)), brief.text);
    assert.ok(brief.text.endsWith('\n"an agent found": what an agent outside Filament stored over MCP, unchecked.'), brief.text);
  }));

test("M7-D40: what a session is shown by search, a card or its history is logged there, so a claim retired later reaches it; a call in no session is told nothing and logs nothing", () =>
  world({}, async (w) => {
    // The sessions open before the claims are on file: their openings show none of them, so each erratum below comes from
    // what its search, card or history showed.
    const mcp = rig(w);
    const [bySearch, byCard, byHistory] = [client(mcp, { cwd: CWD }), client(mcp, { cwd: CWD }), client(mcp, { cwd: CWD })];
    for (const c of [bySearch, byCard, byHistory]) await c.init();
    const owner = w.svc.scope({ role: "owner", project: pid });
    const ids = [];
    for (const text of ["The staging cluster is called kestrel.", "The CI runner image is node:22-slim.", "Releases are tagged on Thursdays."]) ids.push((await owner.remember(text, { kind: "fact" })).id);
    await w.settle();
    const found = answer(await bySearch.tool("search", { query: "staging cluster kestrel" }));
    assert.ok(found.results.some((/** @type {any} */ r) => r.id === ids[0]));
    const card = answer(await byCard.tool("claim", { id: ids[1] }));
    assert.deepEqual([card.id, card.text, card.status], [ids[1], "The CI runner image is node:22-slim.", "confirmed"]);
    assert.equal(answer(await byHistory.tool("history", { id: ids[2] })).id, ids[2]);
    const logged = () => w.svc.archive.db.prepare("SELECT COUNT(*) AS n FROM injections").get().n;
    const before = logged();
    const stateless = await call(mcp, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "claim", arguments: { id: ids[1] } } }, { headers: { authorization: "Bearer k" } });
    assert.equal(answer(stateless.json.result).id, ids[1], "no session: it still answers");
    assert.equal(logged(), before, "and logs nothing as shown");
    for (const id of ids) await owner.forget(id, { reason: "gone" });
    assert.match((await bySearch.tool("questions")).content[0].text, new RegExp(`\\[${ids[0]}\\]`));
    assert.match((await byCard.tool("questions")).content[0].text, new RegExp(`\\[${ids[1]}\\]`));
    assert.match((await byHistory.tool("questions")).content[0].text, new RegExp(`\\[${ids[2]}\\]`));
    const again = await call(mcp, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "questions", arguments: {} } }, { headers: { authorization: "Bearer k" } });
    assert.equal(again.json.result.content.length, 1, "a call in no session hears no erratum");
    const errorCard = await byCard.tool("claim", { id: "i999" });
    assert.equal(errorCard.isError, true, "a claim that is not there is an error, in words");
  }));

test("M7-D41: a session outlives a restart — its id adopted, its chain found, what was corrected meanwhile said; an ended one is 404, here and after the restart; an id it never makes is 404", () =>
  world({}, async (w) => {
    const owner = w.svc.scope({ role: "owner", project: pid });
    const id = (await owner.remember("The docs site deploys from the gh-pages branch.", { kind: "fact" })).id;
    await w.settle();
    const first = rig(w);
    const a = client(first, { cwd: CWD });
    await a.init();
    await a.tool("claim", { id });
    const ended = client(first, { cwd: CWD });
    await ended.init();
    await ended.tool("claim", { id });
    const gone = await call(first, "", { method: "DELETE", headers: { authorization: "Bearer k", "mcp-session-id": ended.sid } });
    assert.equal(gone.status, 200);
    assert.equal((await ended.post({ jsonrpc: "2.0", id: 5, method: "ping" })).status, 404, "ended: 404");
    assert.equal((await call(first, "", { method: "DELETE", headers: { authorization: "Bearer k", "mcp-session-id": ended.sid } })).status, 404);
    await owner.correct(id, { text: "The docs site deploys from the docs/ folder on main.", reason: "moved" });
    // Filament restarts: a new handler on the same memory.
    const second = rig(w);
    const back = client(second, { cwd: CWD });
    back.sid = a.sid;
    const heard = await back.tool("questions");
    assert.match(heard.content[0].text, new RegExp(`Memory correction: \\[${id}\\]`), "adopted: the erratum queued meanwhile is said");
    const again = client(second, { cwd: CWD });
    again.sid = ended.sid;
    assert.equal((await again.post({ jsonrpc: "2.0", id: 1, method: "ping" })).status, 404, "an ended session with a chain stays ended after the restart");
    const odd = client(second);
    odd.sid = "not-ours";
    assert.equal((await odd.post({ jsonrpc: "2.0", id: 1, method: "ping" })).status, 404);
    const never = client(second);
    never.sid = "0123456789abcdef0123456789abcdef";
    assert.equal((await never.post({ jsonrpc: "2.0", id: 1, method: "ping" })).status, 200, "an id of the right shape is adopted: its state, if any, is in the archive");
  }));

test("M7-D42: the folder — the call's cwd, else the session's header or query, else the client's first file root, asked once on the answer's stream; a client that does not answer is waited for, then the session names none; list_changed asks again", () =>
  world({}, async (w) => {
    const mcp = rig(w);
    const c = client(mcp, { roots: true, sse: true });
    await c.init();
    const list = c.start({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    await until(() => list.frames().length > 0, "the roots ask");
    assert.equal(list.out.headers["content-type"], "text/event-stream");
    const ask = list.frames()[0];
    assert.equal(ask.method, "roots/list");
    const told = await c.post({ jsonrpc: "2.0", id: ask.id, result: { roots: [{ uri: "https://example.com" }, { uri: pathToFileURL(CWD + "\\").href, name: "evals" }] } });
    assert.equal(told.status, 202);
    const done = await list.done;
    assert.deepEqual(done.frames.map((/** @type {any} */ f) => f.id), [ask.id, 2], "then the answer, on the same stream");
    assert.equal(done.frames[1].result.tools.length, 13);
    const kept = answer(await c.tool("remember", { text: "The evals folder holds the golden files." }));
    assert.equal(w.svc.archive.items.get(Number(kept.id.slice(1))).project_id, pid, "filed in the project of its root");
    assert.equal((await c.post({ jsonrpc: "2.0", id: 3, method: "ping" })).headers["content-type"].startsWith("application/json"), true, "asked once");
    // Its roots changed: asked again; this time it does not answer.
    await c.post({ jsonrpc: "2.0", method: "notifications/roots/list_changed" });
    const t0 = Date.now();
    const quiet = await c.post({ jsonrpc: "2.0", id: 4, method: "ping" });
    assert.ok(Date.now() - t0 >= 250, "waited for");
    assert.deepEqual(quiet.frames.map((/** @type {any} */ f) => f.method ?? f.id), ["roots/list", 4]);
    const still = answer(await c.tool("remember", { text: "The evals folder holds the snapshots too." }));
    assert.equal(w.svc.archive.items.get(Number(still.id.slice(1))).project_id, pid, "the root it named before still stands");
    // The call's own cwd first; a header before roots: a client that names its folder is never asked.
    const other = "C:\\elsewhere";
    const there = answer(await c.tool("remember", { text: "Elsewhere keeps its logs in /var/log/else.", cwd: other }));
    assert.equal(w.svc.archive.items.get(Number(there.id.slice(1))).project_id, projectOf({ cwdHint: other }).id);
    assert.equal(w.svc.archive.getProject(projectOf({ cwdHint: other }).id)?.cwd, other, "a folder first seen is a project, so the claim browser lists what was filed there");
    const named = client(mcp, { roots: true, sse: true, cwd: CWD });
    await named.init();
    assert.equal((await named.post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).headers["content-type"].startsWith("application/json"), true);
    const byQuery = client(mcp, { roots: true, sse: true });
    await byQuery.init({ query: `?cwd=${encodeURIComponent(CWD)}` });
    assert.equal((await byQuery.post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { query: `?cwd=${encodeURIComponent(CWD)}` })).headers["content-type"].startsWith("application/json"), true);
    const noRoots = client(mcp, { sse: true });
    await noRoots.init();
    assert.equal((await noRoots.post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).headers["content-type"].startsWith("application/json"), true, "a client that declared no roots is never asked");
  }));

test("M7-D43: with no folder, remember refuses — a claim that holds everywhere goes with scope global; reads read everything", () =>
  world({}, async (w) => {
    const owner = w.svc.scope({ role: "owner", project: pid });
    const id = (await owner.remember("The evals use the fake engine.", { kind: "fact" })).id;
    await w.settle();
    const c = client(rig(w));
    const opening = await c.init();
    assert.ok(opening.instructions.includes("names no folder"), "the opening says how to name one");
    const refused = await c.tool("remember", { text: "The user likes short answers." });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /scope "global"/);
    const global = answer(await c.tool("remember", { text: "The user likes short answers.", scope: "global" }));
    assert.equal(w.svc.archive.items.get(Number(global.id.slice(1))).project_id, null, "global");
    assert.ok(answer(await c.tool("search", { query: "fake engine evals" })).results.some((/** @type {any} */ r) => r.id === id), "a read with no folder reads every project");
    const placed = client(rig(w), { cwd: CWD });
    await placed.init();
    const everywhere = answer(await placed.tool("remember", { text: "The user writes British English.", scope: "global" }));
    assert.equal(w.svc.archive.items.get(Number(everywhere.id.slice(1))).project_id, null, "global from a folder: still every project's");
  }));

test("M7-D44: pitfalls — one with a right way said at each wrong call and never at the right one, one without said once in the session; brief, questions and the shared verbs answer in their formats; a refusal is an error", () =>
  world({}, async (w) => {
    const owner = w.svc.scope({ role: "owner", project: pid });
    const trap = (await owner.remember("Never run `docker compose up` bare here: run it as `docker compose -f dev.yml up`.", { kind: "fact" })).id;
    const once = (await owner.remember("Never run git push --force on main.", { kind: "fact" })).id;
    const rule = (await owner.remember("Always run the linter before committing.", { kind: "rule" })).id;
    const named = (await owner.remember("Search with filament_memory_search before you edit the evals.", { kind: "fact" })).id;
    await w.settle();
    const c = client(rig(w), { cwd: CWD });
    await c.init();
    const ask = async (/** @type {string} */ command) => (await c.tool("pitfalls", { tool: "Bash", input: { command } })).content[0].text;
    const head = "Memory on the call you are about to make (Filament):\n- [memory ";
    assert.ok((await ask("docker compose up")).startsWith(`${head}${trap} `));
    assert.ok((await ask("docker compose up")).startsWith(`${head}${trap} `), "the wrong way again: said again");
    assert.equal(await ask("docker compose -f dev.yml up"), "Nothing in memory for this call that this session was not told already.", "the right way");
    assert.ok(w.svc.archive.items.events(Number(trap.slice(1))).some((/** @type {any} */ e) => e.action === "followed"), "and the reminder is recorded as followed");
    assert.ok((await ask("git push --force origin main")).startsWith(`${head}${once} `));
    assert.equal(await ask("git push --force origin main"), "Nothing in memory for this call that this session was not told already.", "no right way: once");
    const other = client(rig(w), { cwd: CWD });
    await other.init();
    assert.match((await other.tool("pitfalls", { tool: "Bash", input: { command: "git push --force origin main" } })).content[0].text, new RegExp(`\\[memory ${once} `), "another session hears it");
    const brief = (await c.tool("brief", { task: "bring the stack up and commit the fix" })).content[0].text;
    assert.ok(brief.includes(`[${rule} `) && brief.includes(`[${trap} `), "the brief: the rule, and the pitfall of a coding agent's hands");
    assert.deepEqual(answer(await c.tool("questions")), { questions: [] });
    const confirm = answer(await c.tool("confirm", { id: rule }));
    assert.equal(confirm.ok, true);
    const same = await c.tool("correct", { id: rule, text: "Always run the linter before committing.", reason: "x" });
    assert.equal(same.isError, true);
    assert.match(same.content[0].text, /`confirm` marks a memory that proved right/, "a refusal names the tools as they are called here");
    const sessions = answer(await c.tool("sessions", { query: "anything" }));
    assert.ok(Array.isArray(sessions.sessions));
    const quoted = answer(await c.tool("search", { query: "filament_memory_search evals" })).results.find((/** @type {any} */ r) => r.id === named);
    assert.ok(quoted?.text.includes("filament_memory_search"), "a claim is answered in its own words: only a refusal is Filament's");
    const said = (await w.session("s-named").send("Look it up with filament_memory_search before you edit the evals.")).prep.chain;
    const loaded = await c.tool("load", { session: said });
    assert.ok(!loaded.isError && loaded.content.at(-1)?.text.includes("filament_memory_search"), "so is a session, as it was typed");
    const nope = await memoryMcpCall(w.svc, "nope", {}, { folder: CWD, key: null, client: "mcp:x", meta: null });
    assert.deepEqual([nope.isError, nope.content.at(-1)?.text], [true, "unknown tool nope"], "a name it does not know: an error in words");
  }));

test("M7-D44: memory off or not started — every call says why, as an error; the tools are still listed", () =>
  world({}, async (w) => {
    const mcp = rig(w);
    const c = client(mcp, { cwd: CWD });
    await c.init();
    w.cfg.memory.enabled = false;
    const off = await c.tool("search", { query: "x" });
    assert.deepEqual([off.isError, off.content[0].text], [true, "memory is off in Filament's settings"]);
    assert.equal((await c.post({ jsonrpc: "2.0", id: 9, method: "tools/list" })).json.result.tools.length, 13);
    // (fails before: yes — it said memory "has not started, or its folder did not open", whatever the service knew)
    const why = "H:/m/archive.db was written by another build of Filament (archive version 16; this build reads version 17). Run `npm run reset` for a clean slate.";
    const unopened = new MemoryMcp({ memory: { enabled: () => true, isOpen: () => false, archiveWhy: () => why }, config: { get: () => ({ server: { inboundKeys: ["k"] } }) } });
    const u = client(unopened, { cwd: CWD });
    await u.init();
    const notYet = await u.tool("search", { query: "x" });
    assert.deepEqual([notYet.isError, notYet.content[0].text], [true, why]);
  }));

test("M7-D41: what a session is held as — the folder its header or query named stays for its later calls; a client with no name is `client`; held sessions are capped, one let go adopted again with what its chain knows; DELETE names its session", () =>
  world({}, async (w) => {
    // The header and the query name the session's folder once: later calls that send neither still stand in it.
    const mcp = rig(w);
    for (const by of ["header", "query"]) {
      const c = client(mcp, by === "header" ? { cwd: CWD } : {});
      await c.init(by === "query" ? { query: `?cwd=${encodeURIComponent(CWD)}` } : {});
      const bare = client(mcp);
      bare.sid = c.sid;
      const kept = answer(await bare.tool("remember", { text: `The ${by} names the evals folder for good.` }));
      assert.equal(w.svc.archive.items.get(Number(kept.id.slice(1))).project_id, pid, `the ${by}'s folder, kept`);
    }
    // A client that gives no name is "client", on its chain and as the finder of what it stores.
    const nameless = rig(w);
    const init = await call(nameless, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } }, { headers: { authorization: "Bearer k", "x-filament-cwd": CWD } });
    const anon = client(nameless, { cwd: CWD });
    anon.sid = init.headers["mcp-session-id"];
    const stored = answer(await anon.tool("remember", { text: "The nameless client found the evals run nightly." }));
    assert.equal(w.svc.mcpChainOf(mcpSessionKey(anon.sid)).client, "mcp:client");
    assert.deepEqual(w.svc.archive.items.events(Number(stored.id.slice(1))).find((/** @type {any} */ e) => e.action === "created").detail.finder, { agent: "client", type: "MCP" });
    // One session held: the first, which declared no roots, is let go when the second opens; adopted again at its next
    // call with no chain to say what it declared, it may have roots, and is asked them on a stream.
    const small = rig(w, { inboundKeys: ["k"] }, { maxSessions: 1 });
    const first = client(small, { sse: true });
    await first.init();
    assert.match((await first.post({ jsonrpc: "2.0", id: 2, method: "ping" })).headers["content-type"], /json/, "held: it declared no roots");
    await client(small).init();
    const back = first.start({ jsonrpc: "2.0", id: 3, method: "ping" });
    await until(() => back.frames().length > 0, "the adopted session's roots ask");
    assert.equal(back.frames()[0].method, "roots/list", "let go and adopted: its roots unknown, it is ready, so it is asked");
    assert.equal(back.out.headers["mcp-session-id"], first.sid, "the stream carries the session's id");
    await first.post({ jsonrpc: "2.0", id: back.frames()[0].id, result: { roots: [] } });
    await back.done;
    // A client with roots that takes no stream cannot be asked: it is answered in JSON.
    const noStream = client(mcp, { roots: true });
    await noStream.init();
    assert.match((await noStream.post({ jsonrpc: "2.0", id: 2, method: "ping" })).headers["content-type"], /json/, "no stream, no ask");
    // DELETE with no session named is 400; a session ended before it had a chain stays ended in this process.
    assert.equal((await call(mcp, "", { method: "DELETE", headers: { authorization: "Bearer k" } })).status, 400);
    const chainless = client(mcp);
    await chainless.init();
    assert.equal(w.svc.mcpChainOf(mcpSessionKey(chainless.sid)), null);
    assert.equal((await call(mcp, "", { method: "DELETE", headers: { authorization: "Bearer k", "mcp-session-id": chainless.sid } })).status, 200);
    assert.equal((await chainless.post({ jsonrpc: "2.0", id: 2, method: "ping" })).status, 404, "ended with no chain: this process remembers");
  }));

test("M7-D41: an adopted session is what its chain says — its client, and its roots as it declared them", () =>
  world({}, async (w) => {
    const first = rig(w);
    const plain = client(first, { name: "Cursor", cwd: CWD, sse: true });
    await plain.init();
    await plain.tool("search", { query: "anything" });
    // A restart: the session is adopted from its chain.
    const second = rig(w);
    const back = client(second, { name: "Cursor", sse: true });
    back.sid = plain.sid;
    const r = await back.post({ jsonrpc: "2.0", id: 2, method: "ping" });
    assert.match(r.headers["content-type"], /json/, "it declared no roots: never asked, after the restart too");
    const kept = answer(await back.tool("remember", { text: "Cursor found the evals need the fake engine.", cwd: CWD }));
    assert.deepEqual(w.svc.archive.items.events(Number(kept.id.slice(1))).find((/** @type {any} */ e) => e.action === "created").detail.finder, { agent: "Cursor", type: "MCP" }, "its client, from its chain");
  }));

test("M7-D42: a client that leaves while it is asked its roots is let go at once, not waited for", () =>
  world({}, async (w) => {
    const mcp = rig(w, { inboundKeys: ["k"] }, { rootsWaitMs: 60_000 });
    const c = client(mcp, { roots: true, sse: true });
    await c.init();
    const asking = c.start({ jsonrpc: "2.0", id: 2, method: "ping" });
    await until(() => asking.frames().length > 0, "the roots ask");
    asking.res.emit("close");
    const settled = await Promise.race([asking.done.then(() => true), new Promise((r) => setTimeout(() => r(false), 3000))]);
    assert.equal(settled, true, "the ask settled when the client left, not after the minute's wait");
  }));

test("M7-D42: which folder wins — the header over the query and over a root said before; a call in no session takes its header or query, its client from its user agent; two sessions asked at once each hear their own answer", () =>
  world({}, async (w) => {
    const mcp = rig(w);
    const other = "C:\\elsewhere";
    const otherPid = projectOf({ cwdHint: other }).id;
    const where = (/** @type {any} */ r) => w.svc.archive.items.get(Number(answer(r).id.slice(1))).project_id;
    // The header over the query.
    const both = client(mcp, { cwd: CWD });
    await both.init({ query: `?cwd=${encodeURIComponent(other)}` });
    assert.equal(where(await both.tool("remember", { text: "Both named: the header's folder is the one." })), pid);
    // A root said first, then a header: the header.
    const rooted = client(mcp, { roots: true, sse: true });
    await rooted.init();
    const ask = rooted.start({ jsonrpc: "2.0", id: 2, method: "ping" });
    await until(() => ask.frames().length > 0, "the roots ask");
    await rooted.post({ jsonrpc: "2.0", id: ask.frames()[0].id, result: { roots: [{ uri: pathToFileURL(CWD).href }] } });
    await ask.done;
    const later = client(mcp, { cwd: other });
    later.sid = rooted.sid;
    assert.equal(where(await later.tool("remember", { text: "A header after the root: the header's folder." })), otherPid);
    // No session: the header, else the query; the client its user agent names.
    const stateless = (/** @type {any} */ o) => call(mcp, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "remember", arguments: { text: o.text } } }, { headers: { authorization: "Bearer k", "user-agent": "codex-cli/0.9 (x)", ...(o.headers || {}) }, query: o.query || "" });
    const byHeader = (await stateless({ text: "Stateless by header: the evals folder.", headers: { "x-filament-cwd": CWD } })).json.result;
    assert.equal(where(byHeader), pid);
    const byQuery = (await stateless({ text: "Stateless by query: the evals folder.", query: `?cwd=${encodeURIComponent(CWD)}` })).json.result;
    assert.equal(where(byQuery), pid);
    assert.deepEqual(w.svc.archive.items.events(Number(answer(byQuery).id.slice(1))).find((/** @type {any} */ e) => e.action === "created").detail.finder, { agent: "codex-cli", type: "MCP" });
    // Two sessions asked at once: each ask its own id, each answer its own session's.
    const a = client(mcp, { roots: true, sse: true });
    const b = client(mcp, { roots: true, sse: true });
    await a.init();
    await b.init();
    const askA = a.start({ jsonrpc: "2.0", id: 2, method: "ping" });
    const askB = b.start({ jsonrpc: "2.0", id: 2, method: "ping" });
    await until(() => askA.frames().length > 0 && askB.frames().length > 0, "both asks");
    assert.notEqual(askA.frames()[0].id, askB.frames()[0].id);
    await b.post({ jsonrpc: "2.0", id: askB.frames()[0].id, result: { roots: [{ uri: pathToFileURL(other).href }] } });
    await a.post({ jsonrpc: "2.0", id: askA.frames()[0].id, result: { roots: [{ uri: pathToFileURL(CWD).href }] } });
    await Promise.all([askA.done, askB.done]);
    assert.equal(where(await a.tool("remember", { text: "Session a stands in the evals folder." })), pid);
    assert.equal(where(await b.tool("remember", { text: "Session b stands elsewhere." })), otherPid);
  }));

test("M7-D44: the brief and the search, as an outside agent asks them — its head an agent's, nothing said in words, its budget kept; a search at most 30; a verb that throws answers an error in words", () =>
  world({}, async (w) => {
    const owner = w.svc.scope({ role: "owner", project: pid });
    for (let i = 1; i <= 32; i++) await owner.remember(`The kestrel cluster's node ${i} runs the evals shard ${i} with the fake engine and the nightly golden files.`, { kind: "fact" });
    await w.settle();
    const c = client(rig(w), { cwd: CWD });
    await c.init();
    const full = (await c.tool("brief", { task: "run the evals on the kestrel cluster" })).content[0].text;
    assert.ok(full.startsWith("Memory for your task (Filament): what the user"), "an outside agent's head: no session it starts without");
    assert.ok(full.includes("correct the memory by its id with `correct`"), full);
    const short = (await c.tool("brief", { task: "run the evals on the kestrel cluster", budget: 300 })).content[0].text;
    assert.ok(short.length < full.length, "the budget it asks is kept");
    const empty = client(rig(w), { cwd: "C:\\nothing-here" });
    await empty.init();
    assert.match((await empty.tool("brief", { task: "paint the shed" })).content[0].text, /^Nothing from memory for this task: .+\.$/);
    const all = answer(await c.tool("search", { query: "kestrel cluster", limit: 100 }));
    assert.equal(all.results.length, 30, "at most 30");
    // A verb that throws: its words, as an error.
    const broken = new MemoryMcp({ memory: { enabled: () => true, isOpen: () => true, mcpStand: () => ({ project: null, chain: null }), scope: () => ({ chain: null, errata: () => "", search: async () => { throw new Error("the engine fell over"); } }) }, config: { get: () => ({ server: { inboundKeys: ["k"] } }) } });
    const b = client(broken, { cwd: CWD });
    assert.ok((await b.init()).instructions.startsWith("Filament's memory:"), "a brief that cannot be built: the guide");
    const fell = await b.tool("search", { query: "x" });
    assert.deepEqual([fell.isError, fell.content.at(-1).text], [true, "the engine fell over"]);
  }));

test("a search of its project's memory keeps to it — its claims, those that hold everywhere and its sessions' words, never another project's; from no project, what holds everywhere", () =>
  world({}, async (w) => {
    const elsewhere = projectOf({ cwdHint: "C:\\elsewhere" }).id;
    const mine = (await w.svc.scope({ role: "owner", project: pid }).remember("The heron queue drains every night at two.", { kind: "fact" })).id;
    const far = (await w.svc.scope({ role: "owner", project: elsewhere }).remember("The heron queue elsewhere drains at noon.", { kind: "fact" })).id;
    const everywhere = (await w.svc.scope({ role: "owner" }).remember("The heron queue is the user's name for any job queue.", { kind: "fact" })).id;
    // What was typed: nine sessions of another project's, then one of this project's, longer, so it ranks after them.
    for (let i = 1; i <= 9; i++) await w.session(`s-far-${i}`, { cwd: "C:\\elsewhere" }).send(`is the heron queue stuck again, take ${i}?`);
    const own = (await w.session("s-own").send("is the heron queue stuck again? it was fine last week, before the deploy moved the workers onto the new hosts and the runbook changed with it")).prep.chain;
    await w.settle();
    const c = client(rig(w), { cwd: CWD });
    await c.init();
    const ids = async (/** @type {any} */ who, /** @type {any} */ args) => answer(await who.tool("search", { query: "heron queue stuck", limit: 30, ...args })).results.map((/** @type {any} */ r) => r.id);
    const every = await ids(c, {});
    assert.ok(every.includes(far) && every.some((/** @type {string} */ id) => id.startsWith("s:") && !id.startsWith(`s:${own}:`)), `every project's, unasked: ${every}`);
    const kept = await ids(c, { project_only: true });
    assert.ok(kept.includes(mine) && kept.includes(everywhere), `its own claims and those that hold everywhere: ${kept}`);
    assert.ok(!kept.includes(far), "never another project's claim");
    const quoted = kept.filter((/** @type {string} */ id) => id.startsWith("s:"));
    assert.ok(quoted.length > 0 && quoted.every((/** @type {string} */ id) => id.startsWith(`s:${own}:`)), `its own sessions' words, found past nine of another project's: ${quoted}`);
    const nowhere = client(rig(w));
    await nowhere.init();
    assert.deepEqual(await ids(nowhere, { project_only: true }), [everywhere], "from no project: what holds in every project, and no project's words");
  }));

test("M7-D40: what pitfalls says is logged as shown — the pitfall and the open thread — so their retirement reaches the session; the card is the card, the history the history; an open question is asked", () =>
  world({}, async (w) => {
    const root = mkdtempSync(join(tmpdir(), "filament-mcp-thread-"));
    try {
      writeFileSync(join(root, "notes.md"), "# Notes\n");
      const rpid = projectOf({ cwdHint: root }).id;
      const owner = w.svc.scope({ role: "owner", project: rpid });
      const c = client(rig(w), { cwd: root });
      await c.init();
      const trap = (await owner.remember("Never run `docker compose up` bare here: run it as `docker compose -f dev.yml up`.", { kind: "fact" })).id;
      const thread = (await owner.remember("notes.md still needs a summary section.", { kind: "thread" })).id;
      await w.settle();
      const mark = w.svc.archive.db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM injections").get().n;
      const told = (await c.tool("pitfalls", { tool: "Bash", input: { command: "docker compose up" } })).content[0].text;
      const line = told.split("\n").find((l) => l.startsWith(`- [memory ${trap} `));
      assert.ok(line, told);
      const rows = w.svc.archive.db.prepare("SELECT kind, ids_json, tokens FROM injections WHERE id > ? ORDER BY id").all(mark);
      assert.deepEqual(rows.map((/** @type {any} */ r) => [r.kind, JSON.parse(r.ids_json), r.tokens]), [["pitfall", [trap], estimateTokens(line.slice(2))]], "the pitfall, logged with its own line; nothing for the thread it did not say");
      assert.match((await c.tool("pitfalls", { tool: "Read", input: { file_path: join(root, "notes.md") } })).content[0].text, new RegExp(`\\[memory ${thread} `));
      await owner.forget(trap, { reason: "gone" });
      await owner.forget(thread, { reason: "done" });
      const heard = (await c.tool("questions")).content[0].text;
      assert.match(heard, new RegExp(`\\[${trap}\\]`), "the pitfall it was told is corrected to it");
      assert.match(heard, new RegExp(`\\[${thread}\\]`), "so is the thread");
      const fact = (await owner.remember("The release train leaves on Thursdays.", { kind: "fact" })).id;
      const card = answer(await c.tool("claim", { id: fact }));
      const hist = answer(await c.tool("history", { id: fact }));
      assert.deepEqual([typeof card.trust, "events" in card], ["string", false], "the card");
      assert.ok(Array.isArray(hist.events), "the history");
      w.svc.archive.inbox.add({ projectId: rpid, kind: "retire", key: "test:q", itemIds: [Number(fact.slice(1))], proposal: { action: "retire", id: Number(fact.slice(1)) }, reason: "asked in the test" });
      assert.equal(answer(await c.tool("questions")).questions.length, 1, "an open question is asked");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }));
test("M7-D45: the opening — the guide, then the brief for no task in its own small budget; with memory off the guide alone; one whose brief cannot be built is the guide", () =>
  world({}, async (w) => {
    const owner = w.svc.scope({ role: "owner", project: pid });
    for (let i = 1; i <= 40; i++) await owner.remember(`Always keep the evals shard ${i} pinned to its own golden file set when the nightly kestrel run starts.`, { kind: "rule" });
    await w.settle();
    const mcp = rig(w);
    const guideHead = "Filament's memory: what the user and their past sessions established";
    const opening = (await client(mcp, { cwd: CWD }).init()).instructions;
    assert.ok(opening.startsWith(guideHead), "the guide first");
    const full = (await client(mcp, { cwd: CWD }).tool("brief", { task: "" })).content[0].text;
    const part = opening.slice(opening.indexOf("Memory for your task (Filament)"));
    assert.ok(part.length > 0 && part.length < full.length, "the opening's brief is held to its own budget");
    w.cfg.memory.enabled = false;
    const off = (await client(mcp, { cwd: CWD }).init()).instructions;
    assert.ok(off.startsWith(guideHead) && !off.includes("Memory for your task"), "memory off: the guide alone");
    const fresh = "C:\\never-opened";
    await client(mcp, { cwd: fresh }).init();
    assert.equal(w.svc.archive.getProject(projectOf({ cwdHint: fresh }).id), null, "and nothing filed, not even the folder");
  }));
test("M7-D40: a request reads the files once — its errata and its block judge each claim's files by the same check", () =>
  world({}, async (w) => {
    const s = w.session("s-check");
    await s.send("hello there, how is the build set up?");
    const check = w.svc.brain.anchorCheck;
    const run = check.run.bind(check);
    let runs = 0;
    check.run = () => {
      runs++;
      return run();
    };
    await s.send("and how are the tests run?");
    assert.equal(runs, 1, "one file check for the whole request");
  }));

test("the operation log hears each tool call: which, whether it worked, the client, the session — never its arguments", () =>
  world({}, async (w) => {
    const mcp = rig(w);
    /** @type {any[]} */
    const ops = [];
    mcp.onOp = (title, o) => ops.push([title, o.level, o.detail]);
    const c = client(mcp, { cwd: CWD });
    await c.init();
    await c.tool("search", { query: "secret words" });
    await c.tool("claim", { id: "i999" });
    assert.deepEqual(ops, [
      ["memory over MCP: search ok", "info", { tool: "search", ok: true, client: "mcp:claude-code", session: c.sid.slice(0, 6) }],
      ["memory over MCP: claim failed", "warn", { tool: "claim", ok: false, client: "mcp:claude-code", session: c.sid.slice(0, 6) }],
    ]);
  }));

test("over HTTP: the front door routes /mcp/memory before the ACP door, behind the Host guard and the key; a client initializes, searches and is asked its roots on a real stream", async () => {
  const shim = await startApp({ memory: true });
  try {
    const url = `${shim.url}/mcp/memory`;
    const post = (/** @type {any} */ body, /** @type {Record<string, string>} */ headers = {}) =>
      fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${shim.key}`, ...headers }, body: JSON.stringify(body) });
    assert.equal((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: "" })).status, 401);
    assert.equal((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://evil.example" })).status, 403);
    // fetch sends its own Host; a page on a rebound name sends that name's.
    const rebound = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: shim.port, path: "/mcp/memory", method: "POST", headers: { host: "evil.example", "content-type": "application/json", authorization: `Bearer ${shim.key}` } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
    });
    assert.equal(rebound, 421, "the Host guard");
    const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { roots: {} }, clientInfo: { name: "e2e" } } });
    const sid = /** @type {string} */ (init.headers.get("mcp-session-id"));
    assert.match(sid, /^[0-9a-f]{32}$/);
    assert.equal((await post({ jsonrpc: "2.0", method: "notifications/initialized" }, { "mcp-session-id": sid })).status, 202);
    // The first request after: answered as a stream that asks the roots first.
    const res = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-session-id": sid });
    assert.equal(res.headers.get("content-type"), "text/event-stream");
    const reader = /** @type {ReadableStream<Uint8Array>} */ (res.body).getReader();
    const dec = new TextDecoder();
    let buf = "";
    /** @type {any[]} */
    const frames = [];
    const next = async () => {
      while (!buf.includes("\n\n")) {
        const { value, done } = await reader.read();
        if (done) return null;
        buf += dec.decode(value, { stream: true });
      }
      const i = buf.indexOf("\n\n");
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      frames.push(JSON.parse(/** @type {string} */ (/^data: (.*)$/m.exec(block)?.[1])));
      return frames.at(-1);
    };
    const ask = await next();
    assert.equal(ask.method, "roots/list");
    assert.equal((await post({ jsonrpc: "2.0", id: ask.id, result: { roots: [{ uri: pathToFileURL(shim.dataDir).href }] } }, { "mcp-session-id": sid })).status, 202);
    assert.equal((await next()).result.tools.length, 13);
    const kept = await (await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "remember", arguments: { text: "The e2e folder is a throwaway." } } }, { "mcp-session-id": sid })).json();
    assert.equal(JSON.parse(kept.result.content.at(-1).text).stored, true, "filed in the project of the root it named");
    const ops = (await (await shim.api("/api/ops?kinds=tool&limit=200")).json()).ops;
    assert.ok(ops.some((/** @type {any} */ o) => o.title === "memory over MCP: remember ok"), "the server hands each call to the operation log");
    assert.equal((await fetch(`${shim.url}/mcp/0123456789abcdef01234567`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404, "the ACP door is still there");
    // Settings writes the command from where the door is and whether it asks a key (M7-D46); the key is never said.
    const door = await shim.api("/api/memory/mcp");
    const said = await door.text();
    assert.deepEqual(JSON.parse(said), { path: "/mcp/memory", keyed: true });
    assert.ok(!said.includes(shim.key));
    // With no inbound key set, the door answers this machine alone, and says it asks none.
    const keys = shim.app.config.server.inboundKeys;
    shim.app.config.server.inboundKeys = [];
    try {
      assert.deepEqual(await (await fetch(`${shim.url}/api/memory/mcp`)).json(), { path: "/mcp/memory", keyed: false });
    } finally {
      shim.app.config.server.inboundKeys = keys;
    }
  } finally {
    await shim.stop();
  }
});
