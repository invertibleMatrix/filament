// @ts-check
// A harness chat's turn sent another way than its page — an API call without the page's run events, or one sent
// unattended, as Filament's replay of the chat in a copy sends its turns — on a coding agent (HarnessV4_Tasks C24;
// HarnessV4_Overnight_Plan OV-D32 to OV-D35): the chat's switch judges what the agent asks, its questions wait on the
// turn's run and are answered through the API, a turn sent unattended refuses what its mode asks about, and the chat
// keeps the turn's work and snapshots as it keeps the page's. Through the app, with the fake ACP agent and the fake
// Codex; the upstreams' own policy is allow-all, which a chat's turn no longer falls back to.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp, parseSse } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { NOBODY_AT_PAGE } from "../src/app/acp-turn.js";
import { createTurnCollector } from "../src/app/acp-collect.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, "fixtures", "fake-acp-agent.mjs");
const FAKE_CODEX = join(HERE, "fixtures", "fake-codex-app-server.mjs");

describe("a harness chat's turn sent without its page, on a coding agent (C24)", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-chat-turn-"));
  const projDir = join(root, "project");
  const codexCalls = join(root, "cx.jsonl");
  before(async () => {
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: projDir, stdio: "ignore" });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
    /** @param {Record<string, string>} [env] */
    const acp = (env = {}) => ({ command: process.execPath, args: [FAKE], env, cwdDefault: projDir, permissions: "allow-all", hints: false });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "coder", name: "coder", type: "acp", acp: acp() },
          { id: "claude", name: "claude", type: "acp", acp: acp({ FAKE_ACP_CLAUDE: "1" }) },
          { id: "cx", name: "cx", type: "codex", acp: { command: process.execPath, args: [FAKE_CODEX], env: { FAKE_CODEX_CALLS: codexCalls }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
        ];
        cfg.routes = ["coder", "claude", "cx"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true }));
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });

  /** A harness chat on a model, its switch at `mode`. @param {string} model @param {string} mode */
  const session = async (model, mode) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain", settings: { loop: { permissions: mode } } } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /**
   * A turn sent by an API call, not by the page: no run events asked for. `extra`: the turn's other fields.
   * @param {string} id @param {string} content @param {Record<string, unknown>} [extra]
   */
  const turn = async (id, content, extra = {}) => {
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, ...extra } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-filament-run-events"), null, "the reply carries no run events: not the page's turn");
    return { res, runId: String(res.headers.get("x-filament-request-id")) };
  };
  /** @param {string} runId @returns {Promise<any[]>} */
  const runEvents = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events;
  /** An answer through the API, as a script gives one. @param {string} runId @param {"allow" | "deny"} chosen */
  const permit = async (runId, chosen) => {
    const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/answer`, { method: "POST", body: { ask: "q1", outcome: "answered", answers: { permission: { chosen: [chosen] } } } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** The run's question, once it waits. @param {string} runId */
  const asked = (runId) => until(async () => (await runEvents(runId)).find((e) => e.type === "ask" && e.id === "q1") || null, "the question");
  /** The reply's words. @param {Response} res */
  const words = async (res) => {
    let said = "";
    for (const { data } of parseSse(await res.text())) if (data?.type === "content_block_delta") said += data.delta?.text ?? "";
    return said;
  };
  /** The turn's record, once its run's account is on it. @param {string} runId */
  const record = (runId) =>
    until(async () => {
      const x = await shim.record(runId);
      return x?.acp?.run ? x : null;
    }, "the record");
  /** What the record says of the turn's requests. @param {string} runId @returns {Promise<string[]>} */
  const judged = async (runId) => ((await record(runId)).changes || []).filter((/** @type {string} */ c) => c.startsWith("permission: "));

  // (fails before: yes — the upstream's allow-all ran it, unasked, whatever the chat's mode)
  test("Ask: the agent's request waits on the turn's run; the API's Deny keeps it from running, its Allow runs it once", async () => {
    const id = await session("coder/fake-a", "ask");
    const no = await turn(id, "~permbash");
    const ask = await asked(no.runId);
    assert.deepEqual([ask.kind, ask.waits, ask.form.judged.tool, ask.form.judged.command], ["permission", true, "bash", "rm -rf build"]);
    await permit(no.runId, "deny");
    assert.match(await words(no.res), /permbash: reject/);
    assert.deepEqual(await judged(no.runId), ["permission: coder asked to run `rm -rf build` — asked (ask mode)", "permission: coder's request to run `rm -rf build` — the person declined"]);
    const yes = await turn(id, "~permbash");
    await asked(yes.runId);
    await permit(yes.runId, "allow");
    assert.match(await words(yes.res), /permbash: allow-once/, "once, never the agent's always");
  });

  // (fails before: yes — Read-only ran it: the upstream's allow-all answered)
  test("Read-only refuses a change, said; a command that only reads runs unasked; Full access runs it", async () => {
    const id = await session("coder/fake-a", "read-only");
    const ro = await turn(id, "~permbash");
    assert.match(await words(ro.res), /permbash: reject/);
    assert.deepEqual(await judged(ro.runId), ["permission: coder asked to run `rm -rf build` — refused (read-only mode)"]);
    assert.equal((await runEvents(ro.runId)).some((e) => e.type === "ask"), false, "nobody was asked");
    const reads = await turn(id, "~permbash ls");
    assert.match(await words(reads.res), /permbash: allow-once/);
    assert.deepEqual(await judged(reads.runId), ["permission: coder asked to run `ls` — ran without asking: it only reads"]);
    const auto = await turn(await session("coder/fake-a", "auto"), "~permbash");
    assert.match(await words(auto.res), /permbash: allow-once/);
    assert.deepEqual(await judged(auto.runId), ["permission: coder asked to run `rm -rf build` — ran (auto mode)"]);
  });

  // (fails before: yes — the record said nothing of the switch: the upstream's policy ran it)
  test("the turn's own `permissions` names its mode for that turn, as it does for Filament's own loop", async () => {
    const id = await session("coder/fake-a", "ask");
    const t = await turn(id, "~permbash", { permissions: "auto" });
    assert.match(await words(t.res), /permbash: allow-once/);
    assert.deepEqual(await judged(t.runId), ["permission: coder asked to run `rm -rf build` — ran (auto mode)"]);
  });

  // (fails before: yes — nothing waited: the request ran under the upstream's allow-all)
  test("a stop while the question waits ends the call Stopped", async () => {
    const t = await turn(await session("coder/fake-a", "ask"), "~permbash");
    await asked(t.runId);
    assert.equal((await shim.api(`/api/runs/${encodeURIComponent(t.runId)}/steer`, { method: "POST", body: { kind: "stop" } })).status, 200);
    assert.match(await words(t.res), /permbash: cancelled/);
    assert.ok((await judged(t.runId)).includes("permission: coder's request to run `rm -rf build` — not answered"));
  });

  // (fails before: yes — nobody was asked: the chat tool's question tool was looked for, and none was there; and the
  // reply's head, which names the run, waited for the stream's first ping)
  test("the agent's own question waits on the run too; the reply's head names the run at once, and the API's answer reaches it", async () => {
    const t0 = Date.now();
    const t = await turn(await session("coder/fake-a", "edit"), "~elicit");
    const ask = await asked(t.runId);
    assert.ok(Date.now() - t0 < 10_000, "the head came before the stream's first ping (15 s)");
    assert.deepEqual([ask.kind, ask.waits, ask.question], ["question", true, "Which database?"]);
    const r = await shim.api(`/api/runs/${encodeURIComponent(t.runId)}/answer`, { method: "POST", body: { ask: "q1", outcome: "answered", answers: { question_0: { chosen: ["SQLite"] } } } });
    assert.equal(r.status, 200, await r.clone().text());
    assert.match(await words(t.res), /elicit: \{"action":"accept","content":\{"question_0":"SQLite"\}\}/);
  });

  // (fails before: yes — the request's id reached the session's state with the reply's head, which a reply sent whole
  // writes at its end: nobody could find the run its question waited on)
  test("a reply sent whole: the session's state names the running turn's request, whose question the API answers", async () => {
    const id = await session("coder/fake-a", "ask");
    const pending = shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "~permbash", stream: false } });
    const runId = await until(async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript?work=0&limit=1`)).json()).live?.requestId || null, "the running turn's request");
    await asked(String(runId));
    await permit(String(runId), "deny");
    const r = await pending;
    assert.equal(r.headers.get("x-filament-request-id"), runId);
    assert.match((await r.json()).content.map((/** @type {any} */ b) => b.text || "").join(""), /permbash: reject/);
  });

  // (fails before: yes — the replay's turn ran it under the upstream's allow-all)
  test("sent unattended (the replay's way): what the mode asks about is refused at once, in words; what it allows runs", async () => {
    const id = await session("coder/fake-a", "ask");
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "~permbash", stream: false, unattended: true } });
    assert.equal(r.status, 200);
    const runId = String(r.headers.get("x-filament-request-id"));
    const text = (await r.json()).content.map((/** @type {any} */ b) => b.text || "").join("");
    assert.match(text, /permbash: reject/);
    assert.deepEqual(await judged(runId), [
      "permission: coder asked to run `rm -rf build` — asked (ask mode)",
      `permission: coder's request to run \`rm -rf build\` — refused: ${NOBODY_AT_PAGE} (ask mode)`,
    ]);
    const reads = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "~permbash ls", stream: false, unattended: true } });
    assert.match((await reads.json()).content.map((/** @type {any} */ b) => b.text || "").join(""), /permbash: allow-once/);
  });

  // (fails before: yes — Codex was opened under the upstream's allow-all: approvals never, its sandbox full access)
  test("Codex: opened under the chat's switch, its approval waiting on the run; the API's Deny declines it", async () => {
    const id = await session("cx/gpt-5", "ask");
    const t = await turn(id, "~approve");
    const ask = await asked(t.runId);
    assert.deepEqual([ask.form.judged.tool, ask.form.judged.command], ["bash", "rm -rf build"]);
    await permit(t.runId, "deny");
    assert.match(await words(t.res), /decision: decline/);
    const start = (existsSync(codexCalls) ? readFileSync(codexCalls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []).find((m) => m.method === "thread/start");
    assert.deepEqual([start?.params.approvalPolicy, start?.params.sandbox], ["untrusted", "workspace-write"]);
    assert.ok((await record(t.runId)).changes.includes("codex: the session's switch (ask) answers Codex: it asks before each change and each command it does not know to be safe, in a workspace-write sandbox"));
  });

  // (fails before: yes — such a turn took no snapshot and was archived as an outside client's reply: its words alone)
  test("the chat keeps such a turn as the page's: its folder snapshotted for Review, its rounds and calls in the history", async () => {
    const id = await session("claude/haiku", "auto");
    const t = await turn(id, "~work on the readme");
    await words(t.res);
    assert.deepEqual((await runEvents(t.runId)).filter((e) => e.type === "snapshot").map((e) => e.round), [2]);
    assert.equal((await record(t.runId)).acp.run.snapshots, 1);
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript?work=1`)).json();
    const parts = tr.turns.at(-1).work.flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : []));
    assert.deepEqual(parts.filter((/** @type {any} */ b) => b.type === "tool_use").map((/** @type {any} */ b) => b.name), ["Read", "Edit", "Bash", "Task"]);
  });

  // (fails before: yes — the page following the turn read the call's line meant for its sender, beside the call's card)
  test("the page following such a turn reads it in its own shape: no call's line beside the cards; the sender's reply keeps its lines", async () => {
    const t = await turn(await session("coder/fake-a", "ask"), "~permbash");
    await asked(t.runId);
    const page = shim.app.liveWords;
    /** @type {any[]} */
    const pieces = [];
    const off = page.follow(t.runId, (p) => pieces.push(p));
    const sofar = page.blocks(t.runId);
    await permit(t.runId, "deny");
    const said = await words(t.res);
    off();
    assert.match(said, /⚙ run `Run it`\n✗ Run it — Not run: the developer declined it\.\npermbash: reject/, "the sender's reply says the call in its lines, then the agent's words");
    const read = [...sofar.map((/** @type {any} */ b) => b.text), ...pieces.map((p) => p.text || "")].join("");
    assert.doesNotMatch(read, /⚙|✗|Run it/, "the page draws the call as its card alone");
    assert.match(read, /permbash: reject/, "the agent's words reach the page");
  });

  // (fails before: no — an outside client was answered by the upstream's policy, and still is)
  test("an outside client naming no harness chat keeps the upstream's policy", async () => {
    const r = await shim.post("/v1/messages", { model: "coder/fake-a", max_tokens: 100, messages: [{ role: "user", content: "~permbash" }] }, { "x-session-id": "outside-c24" });
    assert.match((await r.json()).content.map((/** @type {any} */ b) => b.text || "").join(""), /permbash: allow-once/, "allow-all's own pick: the agent's once, which it offers beside its always");
    const rec = await record(String(r.headers.get("x-filament-request-id")));
    assert.deepEqual((rec.changes || []).filter((/** @type {string} */ c) => c.startsWith("permission: ")), []);
  });
});

// (fails before: yes — the live words were the sender's reply: its call lines, its quoted thoughts, one block for the
// turn)
test("a chat's turn its page did not send: the live words and the rounds' anchors in the page's shape, the wire in the sender's", () => {
  /** @type {string[]} */
  const wire = [];
  /** @type {any[]} */
  const page = [];
  const c = createTurnCollector({
    rec: {},
    stream: true,
    wire: /** @type {any} */ ({ streamText: (/** @type {string} */ t) => wire.push(`text:${t}`), streamThought: (/** @type {string} */ t) => wire.push(`thinking:${t}`), breakBlock: () => wire.push("break") }),
    thoughtsMode: "text",
    renderer: { handle: () => "⚙ run ls" },
    log: () => {},
    progress: () => {},
    harness: false,
    paged: true,
    words: { piece: (type, text) => page.push({ type, text }), endBlock: () => page.push("end") },
  });
  assert.equal(c.breakBlock(), 0, "the first round: nothing before its cards");
  c.onEvent({ type: "text", text: "Looking." });
  c.onEvent({ type: "tool", toolCallId: "t1" });
  assert.equal(c.breakBlock(), 1, "the second round's cards go after the first round's block");
  c.onEvent({ type: "thought", text: "Hmm." });
  c.onEvent({ type: "text", text: "Found it." });
  c.ownLine("a note");
  assert.deepEqual(page.filter((p) => p !== "end").map((p) => `${p.type}:${p.text}`), ["text:Looking.", "thinking:Hmm.", "text:Found it.", "text:_filament: a note_"]);
  assert.equal(page.filter((p) => p === "end").length, 2, "a block per round, and Filament's line its own");
  assert.ok(!wire.includes("break"), "the sender's reply is not broken");
  const sent = wire.filter((w) => w.startsWith("text:")).map((w) => w.slice(5)).join("");
  assert.match(sent, /^Looking\.\n⚙ run ls[\s\S]*💭[\s\S]*Hmm\.[\s\S]*Found it\.\n\n_filament: a note_$/, "the call's line, the thought woven in, the note set apart");
  assert.equal(c.col.text, sent, "the record keeps what the sender got");
});
