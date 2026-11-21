// @ts-check
// What a turn runs under (the review of 10-27's settings fixes): a turn memory situated and prepared carries memory's
// state; one it left out (a folder, model or client excluded in Memory settings) or situated and did not prepare (a
// housekeeping probe) carries its session's settings alone, so its rules, redaction and knobs hold all the same. The
// session its own tools ride (D4 of 11-01): memory's chain where memory took the turn in, the session the request names
// where memory left it out — for the loop's turn and a coding agent's alike. The review of 21d92f3df: where memory's
// situate or prepare fails, the turn rides the session all the same and offers the tools the chat's other turns offer.
// Since the decisions of 11-02 such a turn is kept where the archive can write it, its pictures on it; where the archive
// cannot, its pictures are kept on the session, as memory keeps no row of it.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { turnMemState } from "../src/app/pipeline/stages/situate.js";
import { chainRefOf } from "../src/core/conversation.js";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const settings = { loop: { rules: [{ tool: "bash", pattern: "rm *", verdict: "deny" }] } };
/** @param {any} m */
const of = (m) => turnMemState(/** @type {any} */ ({ trace: null, traceOn() {}, viewContextFor() {}, ...m }));

// (fails before: yes — D4: a turn memory left out carried no session, so the loop's own tools went without the chat's
// chain, and a coding agent's turn had the chat's surfaces switched off as well)
test("memory's state where it situated and prepared the request; the settings alone where it did not; nothing where neither — with the session the turn's own tools ride", () => {
  const sit = { settings, composed: true, project: { id: "p1", cwd: "/x" }, client: "harness" };
  const prep = { chain: "c1", turn: 7 };
  assert.deepEqual(of({ sit, prep, session: { chain: "c1", composed: true } }), { sit, prep, chain: "c1", rowless: false });
  // A housekeeping probe: situated, not prepared — memory-quiet, its project and client left out, no session's tools.
  assert.deepEqual(of({ sit, prep: null, session: { chain: "c1", composed: true } }), { sit: { settings, composed: true }, prep: null, chain: null, rowless: false });
  // Left out by Memory settings, or by a situate that failed: situate's settings-only document, and the session the
  // request names, which keeps no row of the turn.
  assert.deepEqual(of({ sit: null, prep: null, settingsOnly: { settings, composed: true }, session: { chain: "c2", composed: true } }), { sit: { settings, composed: true }, prep: null, chain: "c2", rowless: true });
  assert.deepEqual(of({ sit: null, prep: null, settingsOnly: { settings, composed: false }, session: null }), { sit: { settings, composed: false }, prep: null, chain: null, rowless: true }, "a document and no session it names");
  assert.equal(of({ sit: null, prep: null, settingsOnly: null }), null, "traffic that is nobody's session");
});

// (fails before: yes — the turn kept of a chat Memory settings leave out (`kept`, the decision of 11-02) ran under no
// settings at all: its state's `sit` was memory's, which is none there)
test("a session turn of a chat Memory settings leave out runs under the session's settings alone, beside the turn memory kept of it, which has its row", () => {
  const kept = { chain: "c3", turn: 11, turnN: 2, silent: true, leftOut: 'model "m-out" is excluded in Memory settings' };
  const settingsOnly = { settings, composed: true };
  assert.deepEqual(of({ sit: null, kept: { leftOut: kept.leftOut }, prep: kept, settingsOnly, session: { chain: "c3", composed: true } }), { sit: settingsOnly, prep: kept, chain: "c3", rowless: false });
});

// (fails before: yes — the review of 21d92f3df: a prepare that failed before it opened the turn names no chain, so the
// turn rode none — the loop's and a coding agent's own tools went without the chat's session for that turn)
test("a turn whose prepare failed before it opened rides the session the request belongs to, which keeps no row of it; one that failed after keeps its turn", () => {
  const sit = { settings, composed: true, project: { id: "p1", cwd: "/x" }, client: "harness" };
  const failed = { notes: ["memory: skipped (database is locked)"], injected: 0, briefing: 0, tokens: 0, ids: [], tools: false };
  assert.deepEqual(of({ sit, prep: failed, session: { chain: "c1", composed: true } }), { sit, prep: failed, chain: "c1", rowless: true });
  assert.deepEqual(of({ sit, prep: failed, session: null }), { sit, prep: failed, chain: null, rowless: true }, "a chat its prepare had not found yet: no session to ride");
  const late = { ...failed, chain: "c1", turn: 9, turnN: 3 };
  assert.deepEqual(of({ sit, prep: late, session: { chain: "c1", composed: true } }), { sit, prep: late, chain: "c1", rowless: false });
});

const SVG = '<svg viewBox="0 0 400 80" width="100%"><rect x="10" y="10" width="120" height="40" rx="6" fill="var(--blue-fill)"/></svg>';
/** The archive of a running Filament, which memory opens. @param {Awaited<ReturnType<typeof startApp>>} shim @returns {any} */
const archiveOf = (shim) => shim.app.memory.archive;

/**
 * Memory fails the next turn of the chat `id` opens, before that turn opens, `times` times: its prepare
 * (`archive.beginTurn` throws, as a busy file would — twice, as a broken one would, which a turn kept after its prepare
 * failed is written again on) or its situate (the brain's throws). The loop's ticks and every other chat's requests go
 * as they do.
 * @param {Awaited<ReturnType<typeof startApp>>} shim @param {"prepare" | "situate"} where @param {string} id
 * @param {number} [times]
 * @returns {() => void}  puts it back, where it did not fail
 */
function failsOnce(shim, where, id, times = 1) {
  const memory = /** @type {any} */ (shim.app.memory);
  const [owner, name] = where === "prepare" ? [memory.archive, "beginTurn"] : [memory.brain, "situate"];
  const real = owner[name];
  let left = times;
  const back = () => {
    owner[name] = real;
  };
  /** @this {any} @param {any[]} a */
  owner[name] = function (...a) {
    const named = where === "prepare" ? a[0] : !a[0]?.headers?.["x-filament-agent-of"] && chainRefOf(a[0]?.headers);
    if (named !== id) return real.apply(this, a);
    if (--left <= 0) back();
    throw new Error(`the ${where} broke`);
  };
  return back;
}

describe("through the app: Filament's own agent in a harness chat whose memory fails a turn", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-memory-fails-loop-"));
  /** Each tick's tools, by the model it went out on. @type {Map<string, string[][]>} */
  const ticks = new Map();
  before(async () => {
    up = await fakeUpstream(async (call) => {
      const names = (call.body?.tools || []).map((/** @type {any} */ t) => String(t.name));
      if (!names.includes("read")) return undefined;
      const model = String(call.body.model);
      const seen = ticks.get(model) || [];
      seen.push(names);
      ticks.set(model, seen);
      const asked = call.body.messages.at(-1);
      const answered = Array.isArray(asked?.content) && asked.content.some((/** @type {any} */ b) => b?.type === "tool_result");
      return answered
        ? anthropicReply("Drawn.", { model })
        : anthropicReply("", { model, stop: "tool_use", blocks: [{ type: "tool_use", id: "v1", name: "show_visual", input: { title: "flow", code: SVG } }], usage: { input_tokens: 30, output_tokens: 7 } });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: true };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });
  /** @param {string} model */
  const chat = async (model) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    const json = await r.json();
    return { runId: String(r.headers.get("x-filament-request-id")), text: (json.content || []).map((/** @type {any} */ b) => b.text || "").join("") };
  };
  const events = async (/** @type {string} */ runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || [];
  /** The ticks of a turn memory took in, which each turn whose memory failed is held to. */
  const tookTicks = async () => {
    if (!ticks.has("brain-in")) assert.equal((await turn(await chat("agent/brain-in"), "draw the flow")).text, "Drawn.");
    const took = ticks.get("brain-in") || [];
    assert.equal(took.length, 2);
    assert.ok(took[0].some((n) => n.startsWith("filament_memory_")) && took[0].includes("filament_recall"), `memory's tools on its ticks: ${took[0].join(", ")}`);
    for (const n of ["tasks", "show_visual", "visual_guide", "artifact", "come_back"]) assert.ok(took[0].includes(n), `${n}: ${took[0].join(", ")}`);
    return took;
  };
  /**
   * A turn of a new chat on `model` whose memory fails as it opens, `times` times: its ticks offer what the ticks of a
   * turn memory took in offer, memory's tools and filament_recall among them. Where its picture was said to be kept, and
   * the turns memory kept of the chat.
   * @param {"prepare" | "situate"} where @param {string} model @param {number} [times]
   */
  const heldToTook = async (where, model, times = 1) => {
    const took = await tookTicks();
    const id = await chat(`agent/${model}`);
    const back = failsOnce(shim, where, id, times);
    let ran;
    try {
      ran = await turn(id, "draw the flow");
    } finally {
      back();
    }
    assert.equal(ran.text, "Drawn.");
    const failed = ticks.get(model) || [];
    assert.equal(failed.length, 2);
    assert.deepEqual(failed[0], took[0], "the tools a turn memory took in offers");
    assert.deepEqual(failed[1], failed[0], "the same tools tick to tick");
    const drew = (await events(ran.runId)).find((/** @type {any} */ e) => e.type === "visual");
    return { id, drew, turns: archiveOf(shim).getTurns(id) };
  };
  /** Its turn is kept, and its picture on it. @param {Awaited<ReturnType<typeof heldToTook>>} t */
  const keptOnTurn = ({ id, drew, turns }) => {
    assert.deepEqual([drew?.id, drew?.session, drew?.turn], ["v1", undefined, 1], "said on the run as kept on its turn");
    assert.equal(turns.length, 1, "its turn, kept");
    assert.equal(archiveOf(shim).turnVisual(turns[0].id, "v1")?.code, SVG, "kept on its turn");
    assert.equal(archiveOf(shim).chainVisual(id, "v1"), null, "not on the session");
  };

  // (fails before: yes — the review of 21d92f3df: memory's prepare that failed before it opened the turn named no chain,
  // so that turn's loop went without the task graph, pictures, artifacts, the browser, the Space, a come-back, teams and
  // flows, which the chat's other turns offer; and, before the decisions of 11-02, memory kept no turn of it, so its
  // picture was said and kept on its session)
  test("a turn whose prepare failed before it opened offers the tools the chat's other turns offer, and keeps its turn where the archive can write it, its picture on it", async () => {
    keptOnTurn(await heldToTook("prepare", "brain-unopened"));
  });

  // (fails before: yes — the review of 21d92f3df: a situate that failed leaves the turn out for a reason of memory's own
  // (`leftOut` true), which the loop read as no Memory setting's, so with no turn to keep a picture on show_visual and
  // visual_guide alone dropped out of that turn; and, before the decisions of 11-02, memory kept no turn of it)
  test("a turn whose situate failed offers the tools the chat's other turns offer, and keeps its turn, its picture on it", async () => {
    keptOnTurn(await heldToTook("situate", "brain-unsituated"));
  });

  // (fails before: no — a guard: where the archive itself cannot write the turn, on its prepare and on the write that keeps
  // a turn whose prepare failed, memory keeps no turn of it, and its picture is kept on its session, as the review of
  // 21d92f3df made it)
  test("a turn the archive cannot write offers the tools the chat's other turns offer, and keeps its picture on its session", async () => {
    const { id, drew, turns } = await heldToTook("prepare", "brain-unwritten", 2);
    assert.deepEqual([drew?.id, drew?.session, drew?.turn], ["v1", true, undefined], "said on the run as kept on the session");
    assert.equal(archiveOf(shim).chainVisual(id, "v1")?.code, SVG, "kept on the session");
    assert.equal(turns.length, 0, "memory kept no turn of it");
  });
});

describe("through the app: a coding agent in a harness chat whose memory fails a turn", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-memory-fails-coder-"));
  const logs = mkdtempSync(join(tmpdir(), "filament-memory-fails-logs-"));
  const calls = join(logs, "calls.jsonl");
  before(async () => {
    shim = await startApp({
      memory: true,
      configure: (cfg, { dataDir }) => {
        const acp = { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: calls, FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "http", FAKE_ACP_SESSION_CAPS: "additionalDirectories,resume" }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" };
        cfg.upstreams = [{ id: "cli", name: "cli", type: "acp", enabled: true, acp }];
        cfg.routes = [{ match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root, logs);
  });
  /** @param {string} model */
  const chat = async (model) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    return ((await r.json()).content || []).map((/** @type {any} */ b) => b.text || "").join("");
  };
  /** The session opens the fake agent was sent, in order. @returns {any[]} */
  const opens = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []).filter((c) => c.method === "session/new");
  /** @param {string} url @param {string} method @param {any} [params] */
  const rpc = async (url, method, params = {}) => (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
  /** What Filament's server lists for the session `o` opened. @param {any} o */
  const listed = async (o) => {
    await rpc(o.mcpUrl, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    return ((await rpc(o.mcpUrl, "tools/list"))?.tools || []).map((/** @type {any} */ t) => String(t.name));
  };
  const draw = `~mcpcall show_visual ${JSON.stringify({ title: "flow", code: SVG })}`;

  // (fails before: yes — the review of 21d92f3df: a coding agent's session opened in a turn whose prepare failed before it
  // opened had no chat to stand its tools in, and one opened in a turn whose situate failed went without the visual
  // tools: each listed less than a session the chat's other turns open, and its picture was refused; and, before the
  // decisions of 11-02, memory kept no turn of either, so their pictures were kept on their sessions)
  test("a session opened in a turn whose prepare or situate failed lists what one a turn memory took in lists, memory's tools among them; its turn is kept where the archive can write it, its picture on it, else on its session", async () => {
    const took = await chat("coder-in");
    await turn(took, "hello");
    const said = [];
    for (const [where, model, times] of /** @type {const} */ ([["prepare", "coder-unopened", 1], ["situate", "coder-unsituated", 1], ["prepare", "coder-unwritten", 2]])) {
      const id = await chat(model);
      const back = failsOnce(shim, where, id, times);
      try {
        said.push({ id, where: times > 1 ? "write" : where, text: await turn(id, draw) });
      } finally {
        back();
      }
    }
    const [tookOpen, ...failedOpens] = /** @type {any[]} */ (await until(() => (opens().length >= 4 ? opens() : null), "the four sessions opened"));
    const tookTools = await listed(tookOpen);
    assert.ok(tookTools.some((n) => n.startsWith("filament_memory_")), `memory's tools where it took the turn in: ${tookTools.join(", ")}`);
    for (const n of ["tasks", "show_visual", "visual_guide", "artifact"]) assert.ok(tookTools.includes(n), `${n}: ${tookTools.join(", ")}`);
    for (const [i, o] of failedOpens.entries()) assert.deepEqual(await listed(o), tookTools, `where its ${said[i].where} failed`);
    for (const s of said) {
      assert.match(s.text, /mcp:Shown to the developer in the chat as flow/, `where its ${s.where} failed`);
      const onSession = archiveOf(shim).getChain(s.id)?.meta?.visuals || [];
      const turns = archiveOf(shim).getTurns(s.id);
      if (s.where === "write") {
        assert.equal(onSession.length, 1, "the archive could not write its turn: kept on its session");
        assert.equal(archiveOf(shim).chainVisual(s.id, onSession[0].id)?.code, SVG);
        assert.equal(turns.length, 0, "memory kept no turn of it");
        continue;
      }
      assert.deepEqual(onSession, [], `none on its session, where its ${s.where} failed`);
      assert.equal(turns.length, 1, `its turn kept, where its ${s.where} failed`);
      const drawn = archiveOf(shim).turnMeta(turns[0].id)?.visuals || [];
      assert.equal(drawn.length, 1, `kept on its turn, where its ${s.where} failed`);
      assert.equal(archiveOf(shim).turnVisual(turns[0].id, drawn[0].id)?.code, SVG);
    }
  });
});
