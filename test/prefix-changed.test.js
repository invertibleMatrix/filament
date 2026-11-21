// @ts-check
// When what a chat sends ahead of its history changed — Filament updated, an MCP server connected, a tool switched —
// the person's next message stops on the card that asks before a message goes (the owner's of 11-06: "a card should be
// shown about it that do you wanna update the session with latest stuff that is added or want to continue with current
// one"). In the loop every request sends them as they stand, so a warm cache would be written whole again; a coding
// agent's session that goes on can keep what it already loaded in its old form. Send as it is goes on, and the chat keeps the new print.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_ACP_AGENT, startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { resumeWords } from "../src/app/sessions/cache-clock.js";
import { predictNextRead } from "../src/ui/harness/widgets/cache.js";

const UPDATED = "Filament was updated: what it tells the agent, or its tools, changed";

describe("the words of the question", () => {
  test("what changed, and what going on costs: the loop's cache write, an agent's old tools; a cold question says it too", () => {
    const model = { kind: /** @type {const} */ ("model"), name: "brain-model", from: /** @type {const} */ ("copy") };
    const base = { idleMs: 60_000, held: 40_000, estimated: true, window: 200_000, usable: 170_000, cache: null };
    assert.equal(resumeWords({ ...base, why: "changed", changes: ["tools switched off: bash"], reads: model }), "What this chat sends ahead of its history changed (tools switched off: bash), so going on writes all ≈40,000 tokens of its 200,000-token window to brain-model's cache again, at a write's price — making room first leaves less to write. Send it as it is, or make room first?");
    assert.match(resumeWords({ ...base, why: "changed", changes: [UPDATED], reads: { kind: "agent", name: "Claude Code", from: "session" } }), /^What Claude Code is given ahead of this chat changed \(Filament was updated.+\): its session goes on, and what it already loaded there can keep its old form .+ Making room first starts a fresh session from the compaction, which reads it all anew/);
    const cold = resumeWords({ ...base, why: "cold", changes: ["MCP server linear connected"], reads: model, cache: { state: "cold", idleMs: 3_700_000, ttlMs: 300_000, leftMs: 0, seen: false } });
    assert.match(cold, /the cache has gone cold.+ What it sends ahead of its history changed too: MCP server linear connected\. Send it as it is/);
  });
});

describe("the Cache widget's next turn", () => {
  // (fails before: yes — a warm cache predicted the whole history read, though the next request writes it again)
  test("what the chat sends ahead changed: the loop's next turn writes it all again, asked while warm; an agent's asks first, its cache carried where it goes on", () => {
    const loop = predictNextRead({ carried: 0.95, changed: ["tools switched off: bash"] });
    assert.deepEqual(loop, { share: 0, words: "What this chat sends ahead of its history changed (tools switched off: bash), so the next turn writes the whole prompt again, warm as the cache is. Your next message asks first: compacting before it leaves less to write." });
    const coldLoop = predictNextRead({ carried: 0.95, cold: true, changed: ["tools switched off: bash"] });
    assert.equal(coldLoop.share, 0);
    assert.doesNotMatch(coldLoop.words, /asks first/, "a cold cache is written whole anyway, and nothing asks");
    const agent = predictNextRead({ carried: 0.9, agent: true, changed: [UPDATED] });
    assert.equal(agent.share, 0.9);
    assert.match(agent.words, /^What the agent is given changed \(Filament was updated.+\)\. Your next message asks first: going on keeps its session and cache, though what it already loaded can keep its old form/);
    assert.equal(predictNextRead({ carried: 0.9, agent: true, cold: true, changed: [UPDATED] }).share, 0, "an expired cache is expired whatever changed");
    assert.equal(predictNextRead({ carried: 0.95, changed: [] }).share, 0.95, "nothing changed: the history carries over");
    assert.equal(predictNextRead({ carried: 0.95, wouldCompact: true, changed: ["tools switched off: bash"] }).share, 0.03, "a compaction restarts it anyway");
  });
});

describe("a chat of the loop", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-prefix-changed-"));
    // Its replies read the cache: a warm one, for five minutes after a turn.
    up = await fakeUpstream(async (c) => (c.kind === "anthropic" ? anthropicReply((c.body?.tools || []).length ? "ok" : "A title", { model: "brain-model" }) : undefined));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(shim?.dataDir, root);
  });
  /** @returns {any} */
  const archive = () => shim.app.memory.archive;
  const chat = async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(created.status, 200, await created.clone().text());
    return String((await created.json()).id);
  };
  /** @param {string} id @param {string} content @param {boolean} [sendAsIs] */
  const send = async (id, content, sendAsIs = false) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { stream: false, content, ...(sendAsIs ? { sendAsIs: true } : {}) } });
    return { status: r.status, body: /** @type {any} */ (await r.json().catch(() => null)) };
  };
  /** @param {string} id @param {any} patch */
  const patch = async (id, patch) => assert.equal((await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch } })).status, 200);

  // (fails before: yes — the message went, and the warm cache was written whole again unasked)
  test("a tool switched off while the cache is warm: the next message asks, Send as it is goes, and the one after goes unasked", async () => {
    const id = await chat();
    assert.equal((await send(id, "one")).status, 200);
    const kept = archive().getChain(id).meta.prefixSent;
    assert.equal(kept?.v, 1, "the turn kept the print it sent");
    assert.equal(kept.head, 0, "standing on no compaction");
    assert.deepEqual((await shim.app.sessions.preview(id, {})).current.printChanged, [], "nothing changed yet");
    await patch(id, { loop: { tools: { bash: false } } });
    // The Cache widget's preview says it, before any message.
    assert.deepEqual((await shim.app.sessions.preview(id, {})).current.printChanged, ["tools switched off: bash"]);
    const asked = await send(id, "two");
    assert.equal(asked.status, 409, JSON.stringify(asked.body));
    const q = asked.body?.errorBody?.resumeQuestion ?? asked.body?.resumeQuestion;
    assert.equal(q?.why, "changed", JSON.stringify(asked.body));
    assert.deepEqual(q.changes, ["tools switched off: bash"]);
    assert.equal(q.cache?.state, "warm");
    assert.match(String(asked.body.error), /^What this chat sends ahead of its history changed \(tools switched off: bash\)/);
    assert.equal((await send(id, "two", true)).status, 200, "Send as it is goes");
    assert.deepEqual(archive().getChain(id).meta.prefixSent.off, ["bash"], "and the chat keeps the print it sent");
    assert.equal((await send(id, "three")).status, 200, "nothing changed since: no question");
  });

  // (fails before: yes — nothing was weighed against what the chat last sent)
  test("Filament updated: the print the chat kept is no longer the build's — asked while warm, never once switched off", async () => {
    const id = await chat();
    assert.equal((await send(id, "one")).status, 200);
    const old = () => archive().mergeMeta(id, { prefixSent: { ...archive().getChain(id).meta.prefixSent, build: "0000000000000000" } });
    old();
    const warm = await send(id, "two");
    assert.equal(warm.status, 409);
    assert.deepEqual((warm.body?.errorBody?.resumeQuestion ?? warm.body?.resumeQuestion)?.changes, [UPDATED]);
    // Switched off, it asks nothing for this.
    await patch(id, { context: { compaction: { changeQuestion: false } } });
    assert.equal((await send(id, "two")).status, 200);
  });

  // (fails before: no — nothing was asked then; it guards the skip, and fails where a compaction since is not weighed)
  test("a compaction since the chat's last print: the history it writes again is small, and nothing is asked", async () => {
    const id = await chat();
    // Long enough that a summary makes room.
    assert.equal((await send(id, `one ${"words ".repeat(800)}`)).status, 200);
    assert.equal((await send(id, `two ${"words ".repeat(800)}`)).status, 200);
    archive().mergeMeta(id, { prefixSent: { ...archive().getChain(id).meta.prefixSent, build: "0000000000000000" } });
    const made = await shim.api(`/api/sessions/${encodeURIComponent(id)}/compact`, { method: "POST", body: { method: "summary" } });
    assert.equal(made.status, 200, await made.clone().text());
    assert.equal((await send(id, "three")).status, 200);
  });
});

describe("a coding agent's session", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-prefix-changed-agent-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "ag", name: "ag", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, "calls.jsonl"), FAKE_ACP_LOG: join(root, "prompts.jsonl"), FAKE_ACP_SESSION_CAPS: "resume,close" }, cwdDefault: projDir, permissions: "allow-all", hints: false } }];
        cfg.routes = [{ match: "ag/*", upstream: "ag", upstreamModel: "{1}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await removeDirs(root);
  });
  /** @returns {any} */
  const archive = () => shim.app.memory.archive;
  /** @param {string} id @param {string} content @param {boolean} [sendAsIs] */
  const send = async (id, content, sendAsIs = false) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { stream: false, content, ...(sendAsIs ? { sendAsIs: true } : {}) } });
    return { status: r.status, body: /** @type {any} */ (await r.json().catch(() => null)) };
  };

  // (fails before: yes — the agent's resumed session went on with the tools it first loaded, unsaid)
  test("Filament updated under a session that goes on: asked, in its own session; Send as it is goes on in it, and keeps the print", async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "ag/fake-a", preset: "plain" } });
    const id = String((await created.json()).id);
    assert.equal((await send(id, "one ~holds 5000")).status, 200);
    const kept = archive().getChain(id).meta.agentPrintSent;
    assert.equal(kept?.v, 1, "its fresh session's print is kept");
    assert.equal(archive().getChain(id).meta.prefixSent, undefined, "the loop's is not an agent's");
    archive().mergeMeta(id, { agentPrintSent: { ...kept, build: "0000000000000000" } });
    const asked = await send(id, "two");
    assert.equal(asked.status, 409, JSON.stringify(asked.body));
    const q = asked.body?.errorBody?.resumeQuestion ?? asked.body?.resumeQuestion;
    assert.deepEqual([q?.why, q?.changes, q?.reads?.from], ["changed", [UPDATED], "session"]);
    assert.equal((await send(id, "two", true)).status, 200);
    assert.equal(archive().getChain(id).meta.agentPrintSent.build, kept.build, "Send as it is keeps the print as it stands");
    assert.equal((await send(id, "three")).status, 200, "nothing changed since: no question");
  });

  // (fails before: yes — a flow's line into its team box's chat went as Send as it is: on a team led by a coding agent the
  // print was kept as sent, though the session that went on kept what it had loaded, so the person's next message asked
  // nothing; and the line counted as the person's own for the chat's letters)
  test("Filament's own turn (a flow's line into its team box's chat): past the question, as a wake goes — never the person's Send as it is, nor their message", async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "ag/fake-a", preset: "plain" } });
    const id = String((await created.json()).id);
    assert.equal((await send(id, "one ~holds 5000")).status, 200);
    const kept = archive().getChain(id).meta.agentPrintSent;
    const OLD = "0000000000000000";
    archive().mergeMeta(id, { agentPrintSent: { ...kept, build: OLD }, letters: { tagged: [], wrote: [], alone: 3, asks: {} } });
    const own = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { stream: false, content: "go on", byFilament: true } });
    assert.equal(own.status, 200, await own.clone().text());
    assert.equal(archive().getChain(id).meta.agentPrintSent.build, OLD, "the session went on with what it had loaded: no new print is kept");
    assert.equal(archive().getChain(id).meta.letters?.alone, 3, "no message of the person's: its letters since they wrote count on");
    const asked = await send(id, "two");
    assert.equal(asked.status, 409, JSON.stringify(asked.body));
    assert.deepEqual((asked.body?.errorBody?.resumeQuestion ?? asked.body?.resumeQuestion)?.changes, [UPDATED], "the person's next message asks");
    assert.equal((await send(id, "two", true)).status, 200);
    assert.equal(archive().getChain(id).meta.letters?.alone, 0, "the person's own message: from none again");
  });
});
