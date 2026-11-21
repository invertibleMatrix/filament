// @ts-check
// HarnessV4_Envelopes_Plan EN3: envelopes for a coding agent (Claude Code, Codex, Cursor). Another agent's result that
// lands while the agent works reaches it sealed — its line into the running turn, the report kept with the session —
// and opens in its wait, in its wake once its turn ended, or by Filament's envelope tool, oldest first. Its turn's end
// says the sealed ones once; its next turn's first prompt lists them; a compaction of its own says them again. An agent
// Filament's tools reach not gets every result whole, as before (EN-D10).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENVELOPES_TOOL, givenTools, promptFor } from "../src/adapters/agents/context.js";
import { ENVELOPES_BLOCK, envelopesBlock } from "../src/app/agent-context.js";
import { createLaunchTurn } from "../src/app/agent-launch.js";
import { PROMPT, TOOL_TEXT } from "../src/app/agent/prompt.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { gate, until } from "./helpers/wait.js";

// An agent that takes no MCP server over HTTP stands for one Filament's tools don't reach: with the relay off, as
// FILAMENT_MCP_RELAY=off keeps it (the review of 11-10 gave such an agent the relay where it works).
process.env.FILAMENT_MCP_RELAY = "off";

const root = tmpdir();
const idIn = (/** @type {any} */ text) => String(/sa_[0-9a-f]{8}/.exec(String(text))?.[0] || "");
/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));

/**
 * A registry whose front door is a scripted host, and a coding agent's turn on it. A launch whose prompt says
 * `HOLD:<name>` reports once `land(name)` opens its gate, its report headed by its subject line.
 * @param {{ envelopes?: string, opens?: boolean }} [o]
 */
function scripted({ envelopes = "sealed", opens = true } = {}) {
  const cards = createAgentCardStore({ dataDir: null });
  /** @type {Map<string, ReturnType<typeof gate>>} */
  const gates = new Map();
  /** @type {any[]} */ const events = [];
  /** @type {string[]} */ const notes = [];
  const can = { opens };
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { pool: [{ model: "m-sub", seats: 4 }], view: "none", ask: [], envelopes }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: root, model: "coder-1", projectId: "p1" }),
      view: async () => ({ text: "User: fix the parser", turns: 1 }),
      brief: async () => null,
      modelProblem: () => null,
      agentOf: () => null,
      mark: (_chain, m) => ({ ...m, afterTurn: 1 }),
      modelList: async () => "",
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      const name = /HOLD:(\w+)/.exec(textOf(body.messages.at(-1)))?.[1] || "quick";
      await gates.get(name)?.promise;
      const report = `Subject: ${name} findings\nThe report of ${name}.`;
      registry.finish(id, { status: "done", error: null, report, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: report }] }], rounds: 1, toolCalls: 0, tokensIn: 100, tokensOut: 10, spentUsd: 0.01, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: report }], usage: { input_tokens: 10, output_tokens: 5 } }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: root, mode: null, model: "coder-1", thinking: null, fork: null, emit: (e) => events.push(e), round: () => 3 });
  const turn = createLaunchTurn({ registry, door, chainId: "c1", emit: (e) => events.push(e), note: (t) => notes.push(t), mailbox: () => null, signal: new AbortController().signal, stopSignal: new AbortController().signal, opens: () => can.opens });
  /** A background launch, its report held. @param {string} name */
  const launch = async (name) => {
    gates.set(name, gate());
    const r = await turn.call("agent", { description: name, prompt: `HOLD:${name} look`, run_in_background: true });
    return idIn(r.text);
  };
  /** Its report lands at the turn's door. @param {string} name @param {string} id */
  const land = async (name, id) => {
    gates.get(name)?.open();
    await until(() => (registry.get(id)?.status === "done" ? true : null), `${name} to report`);
  };
  return { registry, turn, events, notes, can, launch, land };
}

// (fails before: yes — a coding agent's turn took every result whole, into its running turn)
describe("a coding agent's turn", () => {
  test("at work a result comes as its line, its report kept; the envelope tool opens it whole, its spend counted once", async () => {
    const s = scripted();
    const a = await s.launch("A");
    await s.land("A", a);
    const [line] = s.turn.take({ seal: true });
    assert.equal(line, `[Filament: envelope 1, sealed — from your background sub-agent ${a} ("A"): A findings. Finish what you are doing first, then open it with Filament's envelope tool when you reach a stopping point. Envelopes open oldest first; this is the one sealed now.]`);
    const sealed = s.events.find((e) => e.type === "envelope-sealed");
    assert.deepEqual([sealed?.envelope, sealed?.agentId, sealed?.subject], [1, a, "A findings"]);
    assert.ok(!s.events.some((e) => e.type === "subagent-report"), "no report reached the agent at its sealing");
    assert.ok(s.notes.includes("agent: 1 result sealed for the agent: its line delivered, its report waits for the envelope tool"), s.notes.join("\n"));
    assert.equal(s.turn.spentUsd(), 0.01, "counted as it was sealed");
    assert.deepEqual(s.registry.envelopes("c1").map((e) => e.n), [1]);

    const opened = await s.turn.call("envelope", {});
    assert.match(opened.text, new RegExp(`^\\[Filament: envelope 1, opened — from your background sub-agent ${a} \\("A"\\)\\]\\n`));
    assert.ok(opened.text.includes("The report of A."), opened.text);
    assert.match(opened.text, /\[Filament: one envelope opened\. None is sealed now\.\]$/);
    assert.equal(opened.isError, undefined);
    const open = s.events.find((e) => e.type === "envelope-opened");
    assert.deepEqual([open?.envelope, open?.by], [1, "tool"]);
    assert.ok(s.events.some((e) => e.type === "subagent-report" && e.envelope === 1), "it reached the agent as it was opened");
    assert.ok(s.notes.includes("agent: envelope opened 1"));
    assert.equal(s.turn.spentUsd(), 0.01, "once");
    assert.deepEqual(await s.turn.call("envelope", { all: true }), { text: "No envelope is sealed." });
  });

  test("its wait opens what is sealed, oldest first, then what came; with nothing running a wait opens them at once", async () => {
    const s = scripted();
    const [a, b] = [await s.launch("A"), await s.launch("B")];
    await s.land("A", a);
    assert.match(s.turn.take({ seal: true })[0], /^\[Filament: envelope 1, sealed/);
    const waited = s.turn.call("wait", { seconds: 30 }, { patienceMs: 600_000 });
    setTimeout(() => void s.land("B", b), 20);
    const said = (await waited).text;
    assert.match(said, /^Waited \d+ s: 2 messages from Filament:\n\n\[Filament: envelope 1, opened — from your background sub-agent sa_[0-9a-f]{8} \("A"\)\]\n/);
    const [first, second] = [said.indexOf("The report of A."), said.indexOf("The report of B.")];
    assert.ok(first > 0 && second > first, "the sealed one first, then the report that ended the wait, whole");
    assert.deepEqual(s.events.filter((e) => e.type === "envelope-opened").map((e) => [e.envelope, e.by]), [[1, "wait"]]);
    assert.ok(s.notes.includes("agent: 1 sealed result opened for the agent, as it waited"), s.notes.join("\n"));

    const c = await s.launch("C");
    await s.land("C", c);
    assert.match(s.turn.take({ seal: true })[0], /^\[Filament: envelope 2, sealed/);
    const again = (await s.turn.call("wait", {})).text;
    assert.match(again, /^Nothing to wait for: nothing you launched is still running\. The envelope still sealed opens here, oldest first:\n\n\[Filament: envelope 2, opened — from your background sub-agent sa_[0-9a-f]{8} \("C"\)\]\n/);
    assert.deepEqual(s.registry.envelopes("c1"), []);
  });

  // (fails before: yes — the review of 11-04 on letters: a wait that opened the reports dropped every envelope's line
  // and list not yet heard, as if all were opened, so a letter's line, still sealed, went unsaid)
  // The list said again after a compaction is the block that comes back now (acp-turn.js `backText`), no line of the
  // inbox's (the owner's of 11-10).
  test("a wait that opens the reports keeps a letter's line, still sealed", async () => {
    const s = scripted();
    const a = await s.launch("A");
    await s.land("A", a);
    s.registry.letter("c1", { text: "Please confirm: is 7 prime?", from: "c2", description: "Other", sender: 'the chat "Other" (c2)', subject: "Is 7 prime?" });
    assert.deepEqual(s.turn.take({ seal: true }).map((t) => /envelope (\d+), sealed/.exec(t)?.[1]), ["1", "2"]);
    s.turn.unheard();
    const [line, opened, ...rest] = s.turn.take({});
    assert.match(line, /^\[Filament: envelope 2, sealed — from the chat "Other" \(c2\): Is 7 prime\?/);
    assert.match(opened, /^\[Filament: envelope 1, opened/);
    assert.deepEqual(rest, []);
    assert.deepEqual(s.registry.envelopes("c1").map((e) => e.n), [2]);
  });

  test("at the turn's end nothing new keeps them sealed and the reminder says them once; a result that came opens with them", async () => {
    const s = scripted();
    const a = await s.launch("A");
    await s.land("A", a);
    s.turn.take({ seal: true });
    assert.deepEqual(s.turn.take({ end: true }), [], "the turn's end opens nothing for nothing new");
    const r = s.turn.remind?.();
    assert.equal(r, `[Filament: one envelope is still sealed (envelope 1, from your background sub-agent ${a} ("A"): A findings): open it now with Filament's envelope tool, or end your turn and it waits for your next one.]`);
    assert.equal(s.turn.remind?.(), null, "once a turn");
    assert.deepEqual(s.events.filter((e) => e.type === "envelope-reminder").map((e) => e.envelopes), [[1]]);
    assert.ok(s.notes.includes("agent: 1 envelope was still sealed as the turn would end — said once"), s.notes.join("\n"));

    const b = await s.launch("B");
    await s.land("B", b);
    const both = s.turn.take({ end: true });
    assert.equal(both.length, 2);
    assert.match(both[0], /^\[Filament: envelope 1, opened/);
    assert.ok(both[1].includes("The report of B.") && !both[1].includes("envelope"), "the new one whole, after the sealed one (EN-D13)");
  });

  test("an agent Filament's tools reach not gets every result whole, the sealed ones first, and no reminder (EN-D10); a session set to Whole too", async () => {
    const s = scripted();
    const a = await s.launch("A");
    await s.land("A", a);
    s.turn.take({ seal: true });
    s.can.opens = false;
    assert.equal(s.turn.remind?.(), null, "no reminder of a tool it does not have");
    const b = await s.launch("B");
    await s.land("B", b);
    const got = s.turn.take({ seal: true });
    assert.equal(got.length, 2);
    assert.match(got[0], /^\[Filament: envelope 1, opened/);
    assert.ok(got[1].includes("The report of B."));
    assert.equal(s.events.filter((e) => e.type === "envelope-sealed").length, 1, "only the one sealed while it could open it");

    const w = scripted({ envelopes: "whole" });
    const c = await w.launch("C");
    await w.land("C", c);
    const [whole] = w.turn.take({ seal: true });
    assert.ok(whole.includes("The report of C.") && !whole.includes("envelope"), whole);
    assert.deepEqual(w.registry.envelopes("c1"), []);
  });

  test("a line never heard goes with the next take, and drops once its envelope opened; the end keeps it sealed", async () => {
    const s = scripted();
    const a = await s.launch("A");
    await s.land("A", a);
    const [line] = s.turn.take({ seal: true });
    s.turn.unheard();
    assert.deepEqual(s.turn.take({ seal: true }), [line], "its line goes with the next prompt");
    s.turn.unheard();
    await s.turn.call("envelope", {});
    assert.deepEqual(s.turn.take({ seal: true }), [], "its line said nothing true any more");

    const b = await s.launch("B");
    await s.land("B", b);
    // Its turn ends with a line it never heard: the envelope stays sealed with the session, for its next turn's list.
    s.turn.take({ seal: true });
    s.turn.unheard();
    s.turn.close();
    assert.deepEqual(s.registry.envelopes("c1").map((e) => e.n), [2]);
    assert.equal(s.registry.peekQueued("c1").length, 0, "no line of it waits: the list is the registry's");
  });

  test("the list for a turn's first prompt goes only to a session given the envelope tool, a plain chat's or a lead's", () => {
    const block = envelopesBlock([{ n: 3, from: "sa_1", description: "Audit", sender: "your background sub-agent sa_1 (\"Audit\")", subject: "Two stale keys" }]);
    assert.deepEqual([block.id, block.tool, ENVELOPES_BLOCK, ENVELOPES_TOOL], ["envelopes", "envelope", "envelopes", "envelope"]);
    assert.equal(block.text, `[Filament: one envelope is still sealed, oldest first:\n- envelope 3, from your background sub-agent sa_1 ("Audit"): Two stale keys.\nOpen it with Filament's envelope tool when you reach a stopping point.]`);
    const context = { standing: [], prompt: [{ id: "recall", text: "R" }, block] };
    assert.deepEqual(promptFor(context, givenTools({ graph: false, launch: true })).map((b) => b.id), ["recall", "envelopes"]);
    assert.deepEqual(promptFor(context, givenTools({ graph: false, launch: false, team: true })).map((b) => b.id), ["recall", "envelopes"]);
    assert.deepEqual(promptFor(context, givenTools({ graph: true, launch: false })).map((b) => b.id), ["recall"], "no tool, no list");
    assert.ok(TOOL_TEXT.envelope.startsWith("Your mailbox: open the results other agents sent you"));
  });
});

// ---------------------------------------------------------------------------------------------------
// Through the app, on a coding agent over the bridge
// ---------------------------------------------------------------------------------------------------

describe("through the app", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */ let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */ let shim;
  /** @type {string} */ let folder;
  /** @type {string} */ let logs;

  /** @param {any} b */
  const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
  const lines = (/** @type {string} */ file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const promptWith = (/** @type {string} */ marker) => lines(join(logs, "prompts.jsonl")).find((p) => String(p.text).includes(marker)) || null;
  const promptsOf = (/** @type {string} */ sessionId) => lines(join(logs, "prompts.jsonl")).filter((p) => p.sessionId === sessionId);
  /** @param {any} settings @param {string} model */
  const newSession = async (settings, model) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model, preset: "plain", settings } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** A harness turn, answered whole. @param {string} id @param {string} content */
  const whole = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    const json = await r.json();
    const text = (json.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("");
    return { status: r.status, json, text, id: String(r.headers.get("x-filament-request-id")) };
  };
  const runEvents = async (/** @type {string} */ runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || [];
  const notesOf = async (/** @type {string} */ id) => {
    const rec = await shim.record(id);
    return [...(rec.priorChanges || []), ...(rec.changes || [])].map(String);
  };
  /** A streamed reply's words, from its text deltas. @param {string} sse */
  const wordsOf = (sse) =>
    sse
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)))
      .filter((d) => d?.type === "content_block_delta" && d.delta?.type === "text_delta")
      .map((d) => d.delta.text)
      .join("");
  /** @param {string} url @param {string} method */
  const mcp = async (url, method) => (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }) })).json()).result;

  before(async () => {
    folder = mkdtempSync(join(tmpdir(), "filament-envelopes-coder-"));
    logs = mkdtempSync(join(tmpdir(), "filament-envelopes-coder-logs-"));
    writeFileSync(join(folder, "a.txt"), "one\n");
    up = await fakeUpstream(async (call) => {
      const b = call.body || {};
      const say = (/** @type {string} */ text) => anthropicReply("", { model: String(b.model || ""), stop: "end_turn", blocks: [{ type: "text", text }], usage: { input_tokens: 5, output_tokens: 3 } });
      // Filament's sub-agents, on the loop: each reports at once.
      if (sysOf(b).includes(String(PROMPT.subagentRole))) return say("Subject: a.txt is the only file\nSUB REPORT: a.txt");
      return say("MODEL ANSWER");
    });
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg, { dataDir }) => {
        const agent = (/** @type {string} */ id, /** @type {Record<string, string>} */ env) => ({
          id,
          name: id,
          type: "acp",
          enabled: true,
          acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(logs, "calls.jsonl"), FAKE_ACP_LOG: join(logs, "prompts.jsonl"), FAKE_ACP_CLAUDE: "1", FAKE_ACP_STEERING: "1", ...env }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" },
        });
        // `steerer` takes words while it works and Filament's MCP server; `mute` takes the words but no server.
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }, agent("steerer", { FAKE_ACP_MCP_CAPS: "http" }), agent("mute", { FAKE_ACP_MCP_CAPS: "none" })];
        cfg.routes = [
          { match: "steerer-*", upstream: "steerer", upstreamModel: "{model}", enabled: true },
          { match: "mute-*", upstream: "mute", upstreamModel: "{model}", enabled: true },
          { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [folder, logs, shim.dataDir]) rmSync(dir, { recursive: true, force: true });
  });

  // (fails before: yes — the report went whole into the agent's running turn, and nothing listed or opened it after)
  test("a report that lands while Claude Code works goes in as its line; the turn's end says it once; the next turn lists it, and the agent's envelope call opens it whole", async () => {
    const id = await newSession({ subagents: { pool: [{ model: "m-1", seats: 4 }] } }, "steerer-1");
    const launch = { description: "Map it", prompt: "List the files", run_in_background: true };
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `~mcpcall agent ${JSON.stringify(launch)} ~steerable`, stream: true, runEvents: true } });
    const runId = String(res.headers.get("x-filament-request-id"));
    const said = wordsOf(await res.text());
    assert.match(said, /heard:\[Filament: envelope 1, sealed — from your background sub-agent sa_[0-9a-f]{8} \("Map it"\): a\.txt is the only file\. Finish what you are doing first/);
    assert.ok(!said.includes("SUB REPORT: a.txt"), "the report stayed out of the agent's turn");
    const first = /** @type {any} */ (promptWith("~mcpcall agent"));
    const prompts = promptsOf(first.sessionId).map((p) => String(p.text));
    assert.equal(prompts.length, 2, "its prompt, then the reminder");
    assert.match(prompts[1], /\[Filament: one envelope is still sealed \(envelope 1, from your background sub-agent sa_[0-9a-f]{8} \("Map it"\): a\.txt is the only file\): open it now/);
    const events = await runEvents(runId);
    // (fails before: yes — its number rode `n`, which the run log's own numbering of each event wrote over)
    assert.deepEqual(events.filter((e) => e.type === "envelope-sealed").map((e) => [e.envelope, e.subject]), [[1, "a.txt is the only file"]]);
    assert.deepEqual(events.filter((e) => e.type === "envelope-reminder").map((e) => e.envelopes), [[1]]);
    assert.ok(!events.some((e) => e.type === "subagent-report"), "no report reached it");
    const notes = await notesOf(runId);
    assert.ok(notes.includes("acp: 1 message from Filament went into steerer's running turn"), notes.join("\n"));
    assert.ok(notes.includes("agent: 1 envelope was still sealed as the turn would end — said once"), notes.join("\n"));
    const tools = (await mcp(first.mcpUrl, "tools/list")).tools;
    const envelope = tools.find((/** @type {any} */ t) => t.name === "envelope");
    assert.deepEqual([envelope?.description, envelope?._meta], [TOOL_TEXT.envelope, { "anthropic/alwaysLoad": true }], "loaded whole, as its line names it (the owner's tool plan of 11-08, in place of EN-D15's held name)");
    assert.match((await mcp(first.mcpUrl, "initialize")).instructions, /Its `envelope` opens, oldest first, the results other agents sent you that wait sealed/);

    const next = await whole(id, `~mcpcall envelope {}`);
    assert.equal(next.status, 200, JSON.stringify(next.json));
    const asked = /** @type {any} */ (promptWith("~mcpcall envelope"));
    assert.ok(String(asked.text).includes(`[Filament: one envelope is still sealed, oldest first:\n- envelope 1, from your background sub-agent `), `its first prompt lists it: ${asked.text}`);
    assert.match(next.text, /mcp:\[Filament: envelope 1, opened — from your background sub-agent sa_[0-9a-f]{8} \("Map it"\)\]\n/);
    assert.ok(next.text.includes("SUB REPORT: a.txt") && next.text.includes("[Filament: one envelope opened. None is sealed now.]"), next.text);
    const later = await runEvents(next.id);
    assert.deepEqual(later.filter((e) => e.type === "envelope-list").map((e) => [e.envelopes, e.at]), [[[1], "start"]]);
    assert.deepEqual(later.filter((e) => e.type === "envelope-opened").map((e) => [e.envelope, e.by]), [[1, "tool"]]);
    assert.ok(later.some((e) => e.type === "subagent-report" && e.envelope === 1), "it reached the agent as it was opened");
    assert.ok((await notesOf(next.id)).includes("acp: 1 envelope still sealed, listed with steerer's first prompt of the turn"));
    const third = await whole(id, "and now?");
    assert.ok(!String(promptWith("and now?")?.text).includes("still sealed"), "none left to list");
    assert.equal(third.status, 200);
  });

  // (fails before: yes — the review of 11-04 on letters: a letter that woke a coding agent's chat drew no card at its
  // turn's start, only a line that envelopes were listed, where a loop's turn draws the letter's card)
  test("a letter that wakes Claude Code's chat is listed with its first prompt and drawn as its card, from the chat that wrote it", async () => {
    const other = await newSession({}, "steerer-1");
    assert.equal((await whole(other, "hello")).status, 200);
    const asker = await newSession({}, "steerer-1");
    const ask = { to: other, subject: "Is 7 prime?", text: "Please confirm: is 7 prime?" };
    const sent = await whole(asker, `[Good](chat:${other}) ~mcpcall envelope ${JSON.stringify(ask)}`);
    assert.match(sent.text, /mcp:Sent: letter lt_[0-9a-f]+ to the chat "hello" \([^)]+\)\. Its agent was at rest: Filament wakes it, and it opens the letter when it chooses\./);
    const turns = await until(async () => {
      const t = /** @type {any} */ (await (await shim.api(`/api/sessions/${encodeURIComponent(other)}/transcript`)).json()).turns || [];
      return t.length >= 2 && t[1].final ? t : null;
    }, "the other chat woken and done", { timeoutMs: 30_000 });
    assert.equal(turns[1].woke, true);
    const runId = String(turns[1].requestIds[0]);
    const events = await runEvents(runId);
    assert.deepEqual(events.filter((e) => e.type === "envelope-sealed").map((e) => [e.envelope, e.via, e.subject]), [[1, "chat", "Is 7 prime?"]]);
    assert.equal(events.filter((e) => e.type === "envelope-list").length, 0, "no line that envelopes were listed again");
    assert.ok((await notesOf(runId)).includes("acp: 1 envelope still sealed, listed with steerer's first prompt of the turn"));
  });

  // (fails before: no — a guard: EN-D10, an agent that cannot call the envelope tool must still hear every result)
  test("an agent that takes no MCP server hears a result that lands while it works whole, as before", async () => {
    const id = await newSession({}, "mute-1");
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "~steerable alone", stream: true, runEvents: true } });
    const runId = String(res.headers.get("x-filament-request-id"));
    await until(async () => (await runEvents(runId)).some((e) => e.type === "round-start"), "the agent to work");
    const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "List the files", description: "Side look", model: "m-1" } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
    const said = wordsOf(await res.text());
    assert.match(said, /heard:\[Filament: the developer ran sub-agent sa_[0-9a-f]{8} \("Side look"\) alongside you; it finished\./);
    assert.ok(said.includes("SUB REPORT: a.txt") && !said.includes("envelope 1"), "whole");
    const events = await runEvents(runId);
    assert.ok(!events.some((e) => e.type === "envelope-sealed") && events.some((e) => e.type === "subagent-report"));
    assert.deepEqual((await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents.length, 1);
  });
});
