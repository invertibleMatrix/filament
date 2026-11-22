// @ts-check
// HarnessV3-ACP AC3-2 through the app and the fake agent (fixtures/fake-acp-agent.mjs): in a harness session the
// session's permission switch answers what a coding agent asks to do. Each request is read as the loop's calls and
// judged as the loop judges its own — the session's rules, then the gate under the mode in force, with the project's
// learned permissions. A run answers the agent's allow-once, a refusal its reject-once, and an ask draws the loop's
// card, whose answer goes back; a switch while it waits judges it again. The plan the agent proposes waits for the
// person whatever the switch says, Filament's own hands are judged where they act, and outside clients keep
// `acp.permissions`. Claude's plan mode lasts until its plan is accepted, and its fresh context goes back to the mode
// in which it asks (AC3-3).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp, parseSse } from "./helpers/app.js";
import { applySessionSettings } from "../src/adapters/agents/acp/configure.js";
import { loopCalls, optionFor } from "../src/adapters/agents/turn-bridge.js";
import { mcpCallOf } from "../src/adapters/agents/acp/updates.js";
import { ALWAYS_ALLOW_WORDS } from "../src/adapters/agents/asks.js";
import { climbsOut, createAgentPermits, linkedIn, namesOutside, strayWords } from "../src/app/agent-permits.js";
import { resolveInside } from "../src/adapters/tools/fs-fence.js";
import { permissionShape } from "../src/services/memory/permissions.js";
import { removeDirs, until } from "./helpers/wait.js";
import { openTaskWorktree, releaseTaskWorktree } from "../src/adapters/git/worktree.js";
import { copyMeta } from "./helpers/copies.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");

describe("a coding agent's requests answered by the session's switch (HarnessV3-ACP AC3-2)", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-acp-permits-"));
  const projDir = join(root, "project");
  /** The session methods the Claude-like agent is sent. */
  const calls = join(root, "claudeish-calls.jsonl");
  before(async () => {
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    /** @param {string} permissions @param {Record<string, string>} [env] */
    const acp = (permissions, env = {}) => ({ command: process.execPath, args: [FAKE], env, cwdDefault: projDir, permissions, hints: false });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "coder", name: "coder", type: "acp", acp: acp("allow-all") },
          { id: "refuser", name: "refuser", type: "acp", acp: acp("reject") },
          { id: "hands", name: "hands", type: "acp", acp: { ...acp("allow-all"), clientBridge: "full" } },
          { id: "claudeish", name: "claudeish", type: "acp", acp: acp("allow-all", { FAKE_ACP_CONFIG: "1", FAKE_ACP_CALLS: calls }) },
        ];
        cfg.routes = ["coder", "refuser", "hands", "claudeish"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true }));
        cfg.memory.autopilot = { enabled: true };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "", learnedPermissions: { afterApprovals: 2 } };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });

  /**
   * A harness session on a model, its switch at `mode`, with rules of its own.
   * @param {string} model @param {string} mode @param {any[] | null} [rules]
   */
  const session = async (model, mode, rules = null) => {
    const loop = { permissions: mode, ...(rules ? { rules } : {}) };
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain", settings: { loop } } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** The session's switch moved, as the page moves it. @param {string} id @param {string} mode */
  const setMode = async (id, mode) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { loop: { permissions: mode } } } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** A harness turn, as the page sends one, and its run's id. @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
    assert.equal(res.status, 200);
    return { res, runId: String(res.headers.get("x-filament-request-id")) };
  };
  /** @param {string} runId @returns {Promise<any[]>} */
  const runEvents = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events;
  /** The page's answer to a question. @param {string} runId @param {Record<string, unknown>} body */
  const answer = (runId, body) => shim.api(`/api/runs/${encodeURIComponent(runId)}/answer`, { method: "POST", body });
  /** The page's Allow or Deny. @param {string} runId @param {"allow" | "deny"} chosen @param {string} [words] */
  const permit = async (runId, chosen, words = "") => {
    const r = await answer(runId, { ask: "q1", outcome: "answered", answers: { permission: { chosen: [chosen], ...(words ? { words } : {}) } } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** The run's question, once it waits. @param {string} runId @param {string} [id] */
  const asked = (runId, id = "q1") => until(async () => (await runEvents(runId)).find((e) => e.type === "ask" && e.id === id) || null, `question ${id}`);
  /** The reply's words, its run's events apart. @param {Response} res */
  const words = async (res) => {
    let said = "";
    for (const { event, data } of parseSse(await res.text()))
      if (event !== "filament_run" && data?.type === "content_block_delta") said += data.delta?.text ?? "";
    return said;
  };
  /** The run's settled questions: each one's outcome and words. @param {string} runId */
  const ended = async (runId) => (await runEvents(runId)).filter((e) => e.type === "ask-end").map((e) => [e.outcome, e.words]);
  /** A call's end in the run. @param {string} runId @param {string} id */
  const endOf = async (runId, id) => (await runEvents(runId)).find((e) => e.type === "tool-end" && e.id === id);
  /** The turn's record, once written. @param {string} runId */
  const record = (runId) =>
    until(async () => {
      const x = await shim.record(runId);
      return x?.acp?.run ? x : null;
    }, "the record");
  /** What the record says of the turn's requests. @param {string} runId @returns {Promise<string[]>} */
  const judged = async (runId) => ((await record(runId)).changes || []).filter((/** @type {string} */ c) => c.startsWith("permission: "));
  /** The modes Filament set on the Claude-like agent, in order. @returns {string[]} */
  const modesSet = () =>
    (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [])
      .filter((c) => c.method === "session/set_mode")
      .map((c) => c.modeId);
  /** The page's answer to Claude's plan: one of its ways on. @param {string} runId @param {string} way */
  const planWay = async (runId, way) => {
    await asked(runId);
    const r = await answer(runId, { ask: "q1", outcome: "answered", answers: { permission: { chosen: [way] } } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  const PLAN_KEPT = "acp: mode plan kept: the agent plans on until its plan is accepted";

  test("the switch runs what its mode allows and refuses what it doesn't, with the agent's allow-once or reject-once", async () => {
    const auto = await turn(await session("coder/fake-a", "auto"), "~permbash");
    assert.match(await words(auto.res), /permbash: allow-once/, "allowed once, never the agent's always");
    assert.deepEqual(await judged(auto.runId), ["permission: coder asked to run `rm -rf build` — ran (auto mode)"]);
    assert.equal((await runEvents(auto.runId)).some((e) => e.type === "ask"), false, "nobody was asked");
    const id = await session("coder/fake-a", "read-only");
    const ro = await turn(id, "~permbash");
    assert.match(await words(ro.res), /permbash: reject/);
    const end = await endOf(ro.runId, "cb1");
    assert.deepEqual([end.ok, end.refused, end.reason], [false, true, "this session's read-only mode"]);
    assert.deepEqual(await judged(ro.runId), ["permission: coder asked to run `rm -rf build` — refused (read-only mode)"]);
    const reads = await turn(id, "~permbash ls");
    assert.match(await words(reads.res), /permbash: allow-once/, "a command that only reads runs even in Read-only");
    assert.deepEqual(await judged(reads.runId), ["permission: coder asked to run `ls` — ran without asking: it only reads"]);
  });

  test("under Ask, the loop's card: Allow runs it once; Deny keeps it from running, its words beside the answer", async () => {
    const id = await session("coder/fake-a", "ask");
    const yes = await turn(id, "~permbash");
    const ask = await asked(yes.runId);
    assert.deepEqual([ask.kind, ask.call, ask.form.judged.tool, ask.form.judged.command], ["permission", "cb1", "bash", "rm -rf build"]);
    assert.match(ask.question, /^May I run this command\? `rm -rf build`/);
    assert.deepEqual(ask.form.questions[0].choices.map((/** @type {any} */ c) => c.id), ["allow", "deny"]);
    await permit(yes.runId, "allow");
    assert.match(await words(yes.res), /permbash: allow-once/);
    assert.deepEqual(await ended(yes.runId), [["answered", ["Allow"]]]);
    assert.deepEqual(await judged(yes.runId), [
      "permission: coder asked to run `rm -rf build` — asked (ask mode)",
      "permission: coder's request to run `rm -rf build` — ran: the person allowed it",
    ]);
    const no = await turn(id, "~permbash");
    await asked(no.runId);
    await permit(no.runId, "deny", "keep the build");
    assert.match(await words(no.res), /permbash: reject/);
    assert.deepEqual(await ended(no.runId), [["answered", ["Deny, keep the build"]]]);
    assert.equal((await endOf(no.runId, "cb1")).declined, true);
  });

  test("a change's card shows each file inside the folder and its diff — Claude's Write and Edit (AC3's drive D5)", async () => {
    const id = await session("coder/fake-a", "ask");
    const write = await turn(id, "~permwrite");
    const w = (await asked(write.runId)).form.judged;
    assert.deepEqual([w.tool, w.changes.map((/** @type {any} */ c) => [c.file, c.created, c.patch])], ["write", [["notes.md", true, "--- /dev/null\n+++ notes.md\n@@ -0,0 +1,1 @@\n+notes\n"]]]);
    await permit(write.runId, "deny");
    await words(write.res);
    const edit = await turn(id, "~permedit");
    const e = (await asked(edit.runId)).form.judged;
    assert.deepEqual([e.tool, e.changes.map((/** @type {any} */ c) => [c.file, c.added, c.removed, c.patch])], ["edit", [["README.md", 1, 1, "--- README.md\n+++ README.md\n@@ -1,1 +1,1 @@\n-hello agent\n+hello, agent of change\n"]]]);
    await permit(edit.runId, "deny");
    await words(edit.res);
  });

  test("Edit runs a change and asks before a command; the session's rules come first", async () => {
    const edit = await session("coder/fake-a", "edit");
    const write = await turn(edit, "~permwrite");
    assert.match(await words(write.res), /permwrite: allow-once/);
    assert.deepEqual(await judged(write.runId), ["permission: coder asked to write notes.md — ran (edit mode)"]);
    const command = await turn(edit, "~permbash");
    assert.equal((await asked(command.runId)).form.judged.tool, "bash");
    await permit(command.runId, "allow");
    assert.match(await words(command.res), /permbash: allow-once/);
    const denied = await turn(await session("coder/fake-a", "auto", [{ tool: "bash", pattern: "rm *", verdict: "deny" }]), "~permbash");
    assert.match(await words(denied.res), /permbash: reject/, "a deny rule refuses whatever the mode says");
    assert.equal((await endOf(denied.runId, "cb1")).reason, "the rule bash(rm *) deny");
    assert.deepEqual(await judged(denied.runId), ["permission: coder asked to run `rm -rf build` — refused by the rule bash(rm *) deny"]);
    const allowed = await turn(await session("coder/fake-a", "ask", [{ tool: "bash", pattern: "npm *", verdict: "allow" }]), "~permbash npm test");
    assert.match(await words(allowed.res), /permbash: allow-once/, "an allow rule runs it without asking");
    assert.deepEqual(await judged(allowed.runId), ["permission: coder asked to run `npm test` — ran on the rule bash(npm *) allow"]);
  });

  // (fails before: yes — memory's situate is null for a folder Memory leaves out, and the agent's permits read their
  // rules from memory's state: the chat's deny rule was not there, and auto ran the command)
  test("a coding agent's chat in a folder Memory leaves out still answers its requests by its own rules", async () => {
    const id = await session("coder/fake-a", "auto", [{ tool: "bash", pattern: "rm *", verdict: "deny" }]);
    const capture = shim.app.config.memory.capture;
    capture.excludeFolders = [projDir];
    try {
      const denied = await turn(id, "~permbash");
      assert.match(await words(denied.res), /permbash: reject/, "the chat's deny rule refuses it");
      assert.equal((await endOf(denied.runId, "cb1")).reason, "the rule bash(rm *) deny");
    } finally {
      capture.excludeFolders = [];
    }
  });

  test("a command only its title names is judged whole; a fetch never asks", async () => {
    const t = await turn(await session("coder/fake-a", "ask"), "~permwords");
    const ask = await asked(t.runId);
    assert.deepEqual([ask.form.judged.tool, ask.form.judged.command], ["bash", "npm test &&\nnpm run lint"]);
    await permit(t.runId, "allow");
    assert.match(await words(t.res), /permwords: allow allow/, "the fetch after it ran unasked");
  });

  test("a switch while the card waits judges the request again: a mode that settles it ends the card, one that asks keeps it", async () => {
    const id = await session("coder/fake-a", "ask");
    const t = await turn(id, "~permbash");
    await asked(t.runId);
    await setMode(id, "edit");
    assert.equal((await answer(t.runId, { ask: "q1", outcome: "switched" })).status, 200);
    await setMode(id, "auto");
    assert.equal((await answer(t.runId, { ask: "q1", outcome: "switched" })).status, 200, "the same card still waited");
    assert.match(await words(t.res), /permbash: allow-once/);
    assert.deepEqual(await ended(t.runId), [["answered", ["Allow — auto mode runs it"]]]);
    assert.deepEqual(await judged(t.runId), [
      "permission: coder asked to run `rm -rf build` — asked (ask mode)",
      "permission: the permission mode is edit now (it was ask)",
      "permission: the switch moved while coder's request to run `rm -rf build` waited — asked (edit mode)",
      "permission: the permission mode is auto now (it was edit)",
      "permission: the switch moved while coder's request to run `rm -rf build` waited — ran (auto mode)",
    ]);
    const other = await session("coder/fake-a", "ask");
    const r = await turn(other, "~permbash");
    await asked(r.runId);
    await setMode(other, "read-only");
    assert.equal((await answer(r.runId, { ask: "q1", outcome: "switched" })).status, 200);
    assert.match(await words(r.res), /permbash: reject/);
    assert.deepEqual(await ended(r.runId), [["answered", ["Deny — this session's read-only mode refuses it"]]]);
    assert.equal((await endOf(r.runId, "cb1")).reason, "this session's read-only mode");
  });

  test("a yes counts towards the project's always-allow, kept in Filament: offered at its threshold, confirmed, then it runs unasked", async () => {
    const id = await session("coder/fake-a", "edit");
    /** One request for `npm test`, allowed on the card. */
    const allowOnce = async () => {
      const t = await turn(id, "~permbash npm test");
      const ask = await asked(t.runId);
      await permit(t.runId, "allow");
      assert.match(await words(t.res), /permbash: allow-once/);
      return { ...t, ask };
    };
    const first = await allowOnce();
    // (fails before: yes — HarnessV4_Tasks E3: a coding agent's first ask carried no always-allow either)
    assert.deepEqual(first.ask.form.judged.offer, { itemId: null, tool: "bash", shape: "npm test" }, "Always allow is offered at the first ask, with no item yet");
    const second = await allowOnce();
    const offer = (await runEvents(second.runId)).find((e) => e.type === "permission-offer");
    assert.deepEqual([offer?.tool, offer?.shape, offer?.count], ["bash", "npm test", 2]);
    const item = (await (await shim.api("/api/memory/items?kind=permission&limit=50")).json()).items.find((/** @type {any} */ x) => x.id === offer.itemId);
    assert.deepEqual([item?.text, item?.status], ["bash: npm test", "inferred"]);
    assert.ok((await judged(second.runId)).includes(`permission: an always-allow for "bash: npm test" was offered (memory item ${offer.itemId}, inferred)`));
    const third = await allowOnce();
    assert.deepEqual(third.ask.form.judged.offer, { itemId: offer.itemId, tool: "bash", shape: "npm test" }, "the card carries the always-allow waiting for its shape");
    assert.equal((await shim.api(`/api/memory/items/${offer.itemId}`, { method: "POST", body: { status: "confirmed" } })).status, 200);
    const fourth = await turn(id, "~permbash npm test");
    assert.match(await words(fourth.res), /permbash: allow-once/);
    assert.equal((await runEvents(fourth.runId)).some((e) => e.type === "ask"), false, "the confirmed always-allow runs it unasked");
    assert.deepEqual(await judged(fourth.runId), ["permission: coder asked to run `npm test` — ran on a learned permission"]);
  });

  test("what the switch never answers: the plan the agent proposes, and Filament's own hand", async () => {
    const auto = await session("coder/fake-a", "auto");
    const plan = await turn(auto, "~permexit");
    const ask = await asked(plan.runId);
    assert.equal(ask.form.judged, null, "the agent's own choices, even in Auto");
    assert.deepEqual(ask.form.questions[0].choices.map((/** @type {any} */ c) => c.id), ["exit-plan-default", "exit-plan-clear-bypass", "reject"]);
    assert.equal((await answer(plan.runId, { ask: "q1", outcome: "answered", answers: { permission: { chosen: ["exit-plan-default"] } } })).status, 200);
    assert.match(await words(plan.res), /permexit: exit-plan-default/);
    const ro = await session("coder/fake-a", "read-only");
    const hand = await turn(ro, "~permhand");
    assert.match(await words(hand.res), /permhand: allow-once/, "judged where it acts");
    assert.deepEqual(await judged(hand.runId), []);
    const enter = await turn(ro, "~permenter");
    assert.match(await words(enter.res), /permenter: allow-once/, "entering its plan mode only narrows what the agent does");
  });

  // (fails before: yes — the re-read of 11-11: a call was taken for Filament's own hand by its server's name alone, so a
  // tool of a server of the agent's own config named "filament" ran unjudged, in Read-only too, its always taken)
  test("Filament's own hand is a tool its own server listed at the session's address: a tool of a server that only goes by its name is judged as any server's", async () => {
    const ro = await session("coder/fake-a", "read-only");
    const spoof = await turn(ro, "~permhand bash");
    assert.match(await words(spoof.res), /permhand: reject/);
    assert.deepEqual(await judged(spoof.runId), ["permission: coder asked to mcp__filament__bash — refused (read-only mode)"]);
    const always = await turn(ro, "~permhand always bash");
    assert.match(await words(always.res), /permhand: reject/, "its always not taken");
    const own = await turn(ro, "~permhand always");
    assert.match(await words(own.res), /permhand: allow-with-updates/, "a tool Filament's server listed is its hand");
  });

  // (fails before: yes — an agent that offered only to always allow a call had it refused in every mode, Auto
  // included, and in Ask a yes on its card was refused too while it counted towards the project's always-allow;
  // Filament's own hand, judged where it acts, was refused the same)
  test("an agent that offers only to always allow it: asked whatever the mode, its card saying so — a yes takes its always, a no rejects it", async () => {
    const auto = await session("coder/fake-a", "auto");
    const always = await turn(auto, "~permalways");
    const ask = await asked(always.runId);
    assert.equal(ask.form.judged.always, true, "the card says the grant is an always");
    assert.equal(ask.form.judged.command, "make");
    assert.equal(ask.form.judged.offer, null, "no always-allow of the project's beside the agent's own");
    assert.match(ask.form.title, /I offer only to always allow it: once allowed, I run calls like it without asking again/);
    assert.equal(ask.form.questions[0].choices[0].description, ALWAYS_ALLOW_WORDS);
    assert.equal((await answer(always.runId, { ask: "q1", outcome: "answered", answers: { permission: { chosen: ["allow"] } } })).status, 200);
    assert.match(await words(always.res), /permalways: allow-with-updates/);
    const said = await judged(always.runId);
    assert.equal(said[0], "permission: coder asked to run `make` — asked: the agent offers only to always allow it, which the switch never grants by itself (auto mode)");
    assert.equal(said.at(-1), "permission: coder keeps this always-allow for the rest of its session, on the person's yes");
    const no = await turn(auto, "~permalways");
    await asked(no.runId);
    assert.equal((await answer(no.runId, { ask: "q1", outcome: "answered", answers: { permission: { chosen: ["deny"] } } })).status, 200);
    assert.match(await words(no.res), /permalways: reject/, "the person's no is the agent's reject");
    // What the switch refuses is refused unasked, as before; Filament's own hand, which judges each call where it acts,
    // takes the agent's always with nobody asked.
    const ro = await session("coder/fake-a", "read-only");
    const refused = await turn(ro, "~permalways");
    assert.match(await words(refused.res), /permalways: reject/);
    assert.equal((await runEvents(refused.runId)).some((e) => e.type === "ask"), false);
    const hand = await turn(ro, "~permhand always");
    assert.match(await words(hand.res), /permhand: allow-with-updates/);
  });

  // (fails before: yes — the bug hunt of 5d57bbe8a: each yes on such a card counted towards the project's always-allow,
  // offered at the second, though no card of its could ever show it and the learned rule never stops it asking)
  test("a yes to an agent that offers only its always counts towards no always-allow of the project's", async () => {
    const id = await session("coder/fake-a", "edit");
    for (let i = 0; i < 3; i++) {
      const t = await turn(id, "~permalways");
      await asked(t.runId);
      assert.equal((await answer(t.runId, { ask: "q1", outcome: "answered", answers: { permission: { chosen: ["allow"] } } })).status, 200);
      assert.match(await words(t.res), /permalways: allow-with-updates/);
      assert.equal((await runEvents(t.runId)).some((e) => e.type === "permission-offer"), false, `yes ${i + 1}`);
      assert.ok((await judged(t.runId)).every((x) => !/an always-allow for/.test(x)), `yes ${i + 1}`);
    }
    const items = (await (await shim.api("/api/memory/items?kind=permission&limit=50")).json()).items;
    assert.equal(items.some((/** @type {any} */ x) => x.text === "bash: make"), false, items.map((/** @type {any} */ x) => x.text).join(", "));
  });

  // (fails before: yes — the switch took no word of the agent's always: what Auto runs ran, the grant left to the agent)
  test("the switch told the agent offers only an always: what would run asks, its command whole and the always in its question", async () => {
    const permits = createAgentPermits({ rules: [], modeNow: () => /** @type {const} */ ("auto"), learned: null });
    const calls = [{ name: "bash", input: { command: "make" } }];
    assert.equal(permits.judge(calls, projDir).verdict, "run", "without its always, Auto runs it");
    const j = permits.judge(calls, projDir, { always: true });
    assert.equal(j.verdict, "ask");
    assert.equal(j.always, true);
    assert.equal(j.tool, "bash");
    assert.equal(j.command, "make");
    assert.match(String(j.question), /^May I run this command\? `make`.* I offer only to always allow it/);
  });

  // (fails before: yes — Cursor's question before a tool of Filament's own MCP server ran was judged as Cursor's own
  // `other`: put to the person under Edit (AC4's drive), refused under Read-only; another server's tool was asked
  // about by no name of its own)
  test("Cursor's question before an MCP server's tool: Filament's own runs unasked, as its hand; another's is judged as itself", async () => {
    const own = await turn(await session("coder/fake-a", "read-only"), "~cursormcp filament tasks");
    assert.match(await words(own.res), /cursormcp: allow-once/);
    assert.deepEqual(await judged(own.runId), []);
    const events = await runEvents(own.runId);
    assert.equal(events.some((e) => e.type === "ask"), false, "nobody was asked");
    const start = events.find((e) => e.type === "tool-start" && e.id === "cm1");
    // E40: a tasks call's own card — this one names no action, so it reads as the task graph's.
    assert.deepEqual([start.name, start.card], ["tasks", { kind: "tasks", title: "Task graph", subject: "" }], "Filament's own tool, as Claude's call of it reads");
    const other = await turn(await session("coder/fake-a", "ask"), "~cursormcp docs search_docs");
    const ask = await asked(other.runId);
    assert.equal(ask.form.judged.tool, "mcp__docs__search_docs");
    await permit(other.runId, "allow");
    assert.match(await words(other.res), /cursormcp: allow-once/);
    const card = (await runEvents(other.runId)).find((e) => e.type === "tool-start" && e.id === "cm1");
    assert.deepEqual([card.name, card.args], ["mcp__docs__search_docs", '{"query":"tabs"}'], "named and given its arguments as Cursor's input says them");
  });

  test("Claude's plan sent back: the turn ends with no cancel said, and Claude plans on until its plain yes", async () => {
    const n = modesSet().length;
    const id = await session("claudeish/default", "auto");
    const enter = await turn(id, "~permenter");
    assert.match(await words(enter.res), /permenter: allow-once/);
    const back = await turn(id, "~permexit");
    await planWay(back.runId, "reject");
    assert.doesNotMatch(await words(back.res), /cancelled|without saying anything/, "the turn did as the person said");
    const rec = await record(back.runId);
    assert.ok(rec.changes.includes(PLAN_KEPT), rec.changes.join("\n"));
    assert.ok(rec.changes.includes("acp: stop reason cancelled — the person sent the plan back, and claudeish's adapter ends its turn then"));
    assert.deepEqual(await ended(back.runId), [["answered", ["No, keep planning"]]]);
    assert.equal((await endOf(back.runId, "ce1")).declined, true);
    const words2 = await turn(id, "smaller steps");
    await words(words2.res);
    assert.ok((await record(words2.runId)).changes.includes(PLAN_KEPT), "the person's words come in plan mode");
    const yes = await turn(id, "~permexit");
    await planWay(yes.runId, "exit-plan-default");
    assert.match(await words(yes.res), /permexit: exit-plan-default/);
    const after = await turn(id, "hello");
    await words(after.res);
    const changes = (await record(after.runId)).changes;
    assert.ok(!changes.includes(PLAN_KEPT), "the plan accepted ends its planning");
    assert.ok(changes.includes("acp: mode default instead of bypassPermissions: the agent asks before it acts, and the switch Filament holds for this turn answers"));
    assert.deepEqual(modesSet().slice(n), [], "Claude's own moves: Filament set no mode");
  });

  // (fails before: no — a guard the mutation pass asked for: no plan was sent back in a turn that named plan mode)
  test("a plan sent back in a turn that named plan mode: the turns after it plan on", async () => {
    const id = await session("claudeish/default@plan", "auto");
    const back = await turn(id, "~permexit");
    await planWay(back.runId, "reject");
    await words(back.res);
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { model: { name: "claudeish/default" } } } });
    assert.equal(r.status, 200, await r.clone().text());
    const next = await turn(id, "smaller steps");
    await words(next.res);
    const changes = (await record(next.runId)).changes;
    assert.ok(changes.includes(PLAN_KEPT), changes.join("\n"));
  });

  // (fails before: no — a guard the mutation pass asked for: no yes to a plan went unsaid, or was said to be the mode
  // in which the agent asks)
  test("a yes to its plan the agent doesn't say ends its planning all the same; one it says took it where it asks is left there", async () => {
    const n = modesSet().length;
    const id = await session("claudeish/default", "auto");
    await words((await turn(id, "~permenter")).res);
    const quiet = await turn(id, "~permexit other");
    await planWay(quiet.runId, "proceed");
    assert.match(await words(quiet.res), /permexit: proceed/);
    const next = await turn(id, "hello");
    await words(next.res);
    const changes = (await record(next.runId)).changes;
    assert.ok(!changes.includes(PLAN_KEPT), changes.join("\n"));
    assert.deepEqual(modesSet().slice(n), ["default"], "the plan accepted: the next turn sets the mode in which it asks");
    const m = modesSet().length;
    const says = await turn(await session("claudeish/default", "auto"), "~permexit other says default");
    await planWay(says.runId, "proceed");
    assert.match(await words(says.res), /permexit: proceed/);
    assert.deepEqual(modesSet().slice(m), [], "already where it asks: Filament sets nothing");
    assert.ok(!(await record(says.runId)).changes.some((/** @type {string} */ c) => / again: /.test(c)));
  });

  // (fails before: no — a guard the mutation pass asked for: no agent said its own mode again once turned back)
  test("an agent that won't be turned back is turned back once: Filament never fights it", async () => {
    const n = modesSet().length;
    const t = await turn(await session("claudeish/default", "ask"), "~permexit twice");
    await planWay(t.runId, "exit-plan-clear-bypass");
    await words(t.res);
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(modesSet().slice(n), ["default"]);
  });

  test("Claude's plan in a fresh context: it starts over in its own mode, which Filament turns back to the one in which it asks", async () => {
    const n = modesSet().length;
    const t = await turn(await session("claudeish/default", "ask"), "~permexit");
    await planWay(t.runId, "exit-plan-clear-bypass");
    assert.match(await words(t.res), /permexit: exit-plan-clear-bypass \(mode default\)/);
    assert.deepEqual(modesSet().slice(n), ["default"]);
    assert.ok((await record(t.runId)).changes.includes("acp: mode default again: the agent started on its plan in its own bypassPermissions mode; in a harness session it asks before it acts, and the session's switch answers"));
  });

  test("a sub-agent's request is judged on its parent's turn", async () => {
    const t = await turn(await session("coder/fake-a", "ask"), "~subask");
    const ask = await asked(t.runId);
    assert.deepEqual([ask.form.judged.tool, ask.form.judged.command], ["bash", "npm run build"]);
    await permit(t.runId, "allow");
    assert.match(await words(t.res), /sub-permission:allow/);
  });

  test("Filament's own hands are judged as the loop's: a write denied is never made, one Edit runs is", async () => {
    const id = await session("hands/fake-a", "ask");
    const no = await turn(id, "~writefile");
    const ask = await asked(no.runId);
    assert.equal(ask.form.judged.tool, "edit");
    assert.match(ask.question, /^May I edit .*out\.txt\?/);
    await permit(no.runId, "deny");
    assert.match(await words(no.res), /writeerr:/);
    assert.equal(existsSync(join(projDir, "out.txt")), false);
    await setMode(id, "edit");
    const yes = await turn(id, "~writefile");
    assert.match(await words(yes.res), /wrote/);
    assert.equal(readFileSync(join(projDir, "out.txt"), "utf8"), "hello from agent");
  });

  /** A repository of five folders' files, committed, and a sparse copy of it that holds pkg/a. @param {string} name @param {string} id */
  const sparseCopy = async (name, id) => {
    const repo = join(root, name);
    const git = (/** @type {string[]} */ ...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    for (const [p, s] of Object.entries({ "pkg/a/index.js": "a\n", "lib/c/x.js": "x\n", "lib/c/y.js": "y\n", "docs/d/guide.md": "g\n", "tools/e/run.js": "r\n", "vendor/f/one.js": "1\n" })) {
      mkdirSync(join(repo, p, ".."), { recursive: true });
      writeFileSync(join(repo, p), s);
    }
    git("init", "-q");
    git("config", "core.autocrlf", "false");
    git("add", "-A");
    git("commit", "-qm", "init");
    const o = await openTaskWorktree(join(repo, "pkg", "a"), { id, kind: "sparse" });
    assert.ok(o.ok, !o.ok ? o.error : "");
    return o.wt;
  };

  // (fails before: yes — the write landed where the copy's cone does not reach, the folder's other files left out)
  test("an agent's write through Filament outside its sparse copy's cone brings the folder in first, and the turn's record says so", async () => {
    const wt = await sparseCopy("sparse-project", "sa_acpsparse");
    try {
      assert.ok(!existsSync(join(wt.dest, "lib")));
      const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: wt.dest, model: "hands/fake-a", preset: "plain", settings: { loop: { permissions: "edit" } } } });
      assert.equal(r.status, 200, await r.clone().text());
      const t = await turn(String((await r.json()).id), "~writeat lib/c/z.txt");
      assert.match(await words(t.res), /wrote/);
      assert.deepEqual([readFileSync(join(wt.dest, "lib", "c", "z.txt"), "utf8"), readFileSync(join(wt.dest, "lib", "c", "y.js"), "utf8")], ["written at a path\n", "y\n"]);
      assert.deepEqual(copyMeta(wt.dest)?.cone, ["lib/c", "pkg/a"]);
      assert.ok((await record(t.runId)).changes.includes("acp: Filament brought lib/c/ into the agent's sparse copy for lib/c/z.txt"));
    } finally {
      await releaseTaskWorktree(wt, "parked");
    }
  });

  // (fails before: yes — the review of 4dfe2433c: the folder came in before the write was judged, so one the person
  // refused had grown the copy's cone all the same)
  test("an agent's write through Filament outside its sparse copy's cone brings no folder in while it is asked, nor once it is refused", async () => {
    const wt = await sparseCopy("sparse-refused", "sa_acpsparse2");
    try {
      const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: wt.dest, model: "hands/fake-a", preset: "plain", settings: { loop: { permissions: "ask" } } } });
      assert.equal(r.status, 200, await r.clone().text());
      const t = await turn(String((await r.json()).id), "~writeat lib/c/z.txt");
      assert.equal((await asked(t.runId)).form.judged.tool, "edit");
      assert.ok(!existsSync(join(wt.dest, "lib")), "nothing of its folder on disk while the person is asked");
      await permit(t.runId, "deny");
      assert.match(await words(t.res), /writeerr:/);
      assert.ok(!existsSync(join(wt.dest, "lib")));
      assert.deepEqual(copyMeta(wt.dest)?.cone, ["pkg/a"]);
      assert.ok(!(await record(t.runId)).changes.some((c) => c.includes("sparse copy")), "the turn's record says no folder came in");
    } finally {
      await releaseTaskWorktree(wt, "parked");
    }
  });

  test("a stop while the card waits ends the call Stopped", async () => {
    const t = await turn(await session("coder/fake-a", "ask"), "~permbash");
    await asked(t.runId);
    assert.equal((await shim.api(`/api/runs/${encodeURIComponent(t.runId)}/steer`, { method: "POST", body: { kind: "stop" } })).status, 200);
    assert.match(await words(t.res), /permbash: cancelled/);
    assert.deepEqual(await ended(t.runId), [["cancelled", ["Cancelled"]]]);
    const end = await endOf(t.runId, "cb1");
    assert.deepEqual([end.ok, end.stopped, end.notRun], [false, true, true]);
    assert.ok((await judged(t.runId)).includes("permission: coder's request to run `rm -rf build` — not answered"));
  });

  test("Claude asks before it acts in a harness session; an outside client keeps the upstream's mode and its policy", async () => {
    const own = await turn(await session("claudeish/default", "auto"), "hello");
    await words(own.res);
    const rec = await record(own.runId);
    assert.ok(rec.changes.includes("acp: mode default instead of bypassPermissions: the agent asks before it acts, and the switch Filament holds for this turn answers"), rec.changes.join("\n"));
    const named = await turn(await session("claudeish/default@bypassPermissions", "auto"), "hello");
    await words(named.res);
    assert.ok((await record(named.runId)).changes.includes("acp: mode default -> bypassPermissions"), "a mode the person names stays");
    const outside = await shim.post("/v1/messages", { model: "claudeish/default", max_tokens: 100, messages: [{ role: "user", content: "hello" }] }, { "x-session-id": "permits-outside" });
    await outside.json();
    const out = await record(String(outside.headers.get("x-filament-request-id")));
    assert.ok(out.changes.includes("acp: mode default -> bypassPermissions (alias of agent)"), out.changes.join("\n"));
    const refused = await shim.post("/v1/messages", { model: "refuser/fake-a", max_tokens: 100, messages: [{ role: "user", content: "~permbash" }] }, { "x-session-id": "permits-policy" });
    const text = (await refused.json()).content.map((/** @type {any} */ b) => b.text || "").join("");
    assert.match(text, /permbash: reject/, "the upstream's policy answers an outside client's turn");
    assert.deepEqual(((await record(String(refused.headers.get("x-filament-request-id")))).changes || []).filter((/** @type {string} */ c) => c.startsWith("permission: ")), []);
  });

  // (fails before: yes — a sub-agent launched on a model named with a mode ran in it, whoever named it: Filament set
  // bypassPermissions on its agent, which then asked nobody, whatever its chat's switch said — and the launch's row is
  // no press, nor is the agent's own launch)
  test("a sub-agent's model that names a mode in which its agent asks nobody runs as its chat does, said in its record; the mode its chat's own model names is its sub-agent's too, and one that plans is taken", async () => {
    /** A sub-agent launched in a chat on a model, as its row launches one: its run's record. @param {string} chat @param {string} model */
    const launched = async (chat, model) => {
      const at = `/api/sessions/${encodeURIComponent(chat)}/subagents`;
      const r = await shim.api(at, { method: "POST", body: { prompt: "hello", description: "a helper", model, deliver: false } });
      assert.equal(r.status, 200, await r.clone().text());
      const id = (await r.json()).subagent.id;
      const sa = await until(async () => (await (await shim.api(at)).json()).subagents.find((/** @type {any} */ s) => s.id === id && s.status !== "running") || null, "the sub-agent's end", { timeoutMs: 30_000 });
      assert.equal(sa.status, "done", JSON.stringify(sa));
      return record(String(sa.exchanges[0].runId));
    };
    const NOT_TAKEN = "acp: mode bypassPermissions not taken from its model's name (claudeish/default@bypassPermissions): a sub-agent's run asks as its chat does, and only its chat's own model names a mode in which its agent asks less";
    const ASKS = "acp: mode default instead of bypassPermissions: the agent asks before it acts, and the switch Filament holds for this turn answers";
    const plain = await session("claudeish/default", "ask");
    let from = modesSet().length;
    const rec = await launched(plain, "claudeish/default@bypassPermissions");
    assert.deepEqual(modesSet().slice(from).filter((m) => m === "bypassPermissions"), [], "the agent was never set to ask nobody");
    assert.ok(rec.changes.includes(NOT_TAKEN), rec.changes.join("\n"));
    assert.ok(rec.changes.includes(ASKS), rec.changes.join("\n"));
    // A mode in which the agent plans, or asks, is no less than its chat's: taken as named.
    const planned = await launched(plain, "claudeish/default@plan");
    assert.ok(planned.changes.some((/** @type {string} */ c) => c.startsWith("acp: mode default -> plan")), planned.changes.join("\n"));
    assert.ok(!planned.changes.some((/** @type {string} */ c) => c.includes("not taken")), planned.changes.join("\n"));
    // The chat's own model names the mode — the person's press set it —: its sub-agent on the same runs in it.
    const named = await session("claudeish/default@bypassPermissions", "ask");
    from = modesSet().length;
    const same = await launched(named, "claudeish/default@bypassPermissions");
    assert.ok(same.changes.includes("acp: mode default -> bypassPermissions"), same.changes.join("\n"));
    assert.ok(modesSet().slice(from).includes("bypassPermissions"));
  });
});

describe("the agent's plan mode across a harness session's turns (HarnessV3-ACP AC3-3)", () => {
  /**
   * The session's mode applied over a recording agent: the modes it was set to, and the record's notes.
   * @param {any} conv @param {string | null} [modeOverride]
   */
  const apply = async (conv, modeOverride = null) => {
    /** @type {string[]} */
    const set = [];
    /** @type {string[]} */
    const notes = [];
    const proc = { request: async (/** @type {string} */ method, /** @type {any} */ params) => { if (method === "session/set_mode") set.push(params.modeId); return {}; } };
    await applySessionSettings({ proc, conv, acp: {}, modelId: "", effort: null, mode: modeOverride || "agent", modeOverride, asks: true, notes, structured: [] });
    return { set, notes };
  };

  test("kept while the agent plans by its own move; a turn that names its mode ends that", async () => {
    const conv = { sessionId: "s1", mode: "plan", availableModes: ["default", "plan", "bypassPermissions"], keepPlan: true };
    const kept = await apply(conv);
    assert.deepEqual([kept.set, kept.notes], [[], ["acp: mode plan kept: the agent plans on until its plan is accepted"]]);
    const named = await apply(conv, "default");
    assert.deepEqual([named.set, conv.keepPlan], [["default"], false]);
    conv.mode = "plan";
    const left = await apply(conv);
    assert.deepEqual(left.set, ["default"], "plan mode the agent didn't keep gives way to the mode in which it asks");
  });

  // (fails before: yes — plan mode was kept only from a mode in which the agent asks nobody: an upstream whose own mode
  // asks set that mode, and the agent's planning ended once its plan was sent back)
  test("kept whatever mode the upstream names, one in which the agent asks too (the bug report's L24)", async () => {
    /** @type {string[]} */
    const set = [];
    /** @type {string[]} */
    const notes = [];
    const proc = { request: async (/** @type {string} */ method, /** @type {any} */ params) => { if (method === "session/set_mode") set.push(params.modeId); return {}; } };
    const conv = { sessionId: "s1", mode: "plan", availableModes: ["default", "plan", "bypassPermissions"], keepPlan: true };
    await applySessionSettings({ proc, conv, acp: {}, modelId: "", effort: null, mode: "ask", modeOverride: null, asks: true, notes, structured: [] });
    assert.deepEqual([set, notes], [[], ["acp: mode plan kept: the agent plans on until its plan is accepted"]]);
  });

  // (fails before: no — a guard the mutation pass asked for: no upstream's own mode planned or asked)
  test("an upstream whose own mode plans keeps it: only a mode in which the agent asks nobody gives way", async () => {
    /** @type {string[]} */
    const set = [];
    const proc = { request: async (/** @type {string} */ method, /** @type {any} */ params) => { if (method === "session/set_mode") set.push(params.modeId); return {}; } };
    const conv = { sessionId: "s1", mode: "bypassPermissions", availableModes: ["default", "plan", "bypassPermissions"] };
    await applySessionSettings({ proc, conv, acp: {}, modelId: "", effort: null, mode: "plan", modeOverride: null, asks: true, notes: [], structured: [] });
    assert.deepEqual(set, ["plan"]);
  });

  // (fails before: yes — the review of 11-10: an agent offering no mode Filament knows to ask (a registry agent's
  // `ask`/`code`/`auto`) was switched into its `auto` on the harness's own word, and every call then ran unasked)
  test("an agent that offers no mode known to ask keeps the mode its session opened in, said", async () => {
    const conv = { sessionId: "s1", mode: "code", availableModes: ["ask", "code", "auto"] };
    const r = await apply(conv);
    assert.deepEqual(r.set, [], "never switched into the mode that asks nobody");
    assert.deepEqual(r.notes, ["acp: mode code kept, not auto: the agent offers no mode Filament knows to ask before it acts, and auto would run its calls without the switch Filament holds for this turn"]);
    assert.equal(conv.mode, "code");
    assert.deepEqual((await apply(conv, "auto")).set, ["auto"], "a mode the person names on the turn is theirs");
  });

  // (fails before: no — a guard the mutation pass asked for: no turn wanted the plan mode the agent planned on in)
  test("an agent planning on under an upstream whose own mode plans: nothing set, nothing said", async () => {
    /** @type {string[]} */
    const set = [];
    /** @type {string[]} */
    const notes = [];
    const proc = { request: async (/** @type {string} */ method, /** @type {any} */ params) => { if (method === "session/set_mode") set.push(params.modeId); return {}; } };
    const conv = { sessionId: "s1", mode: "plan", availableModes: ["default", "plan", "bypassPermissions"], keepPlan: true };
    await applySessionSettings({ proc, conv, acp: {}, modelId: "", effort: null, mode: "plan", modeOverride: null, asks: true, notes, structured: [] });
    assert.deepEqual([set, notes], [[], []]);
  });
});

// The page's half (no DOM here): the pins it rests on.
describe("the page answers a coding agent's request the switch asks about (HarnessV3-ACP AC3-2)", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  /** A function's body in app.js. @param {string} head */
  const body = (head) => app.slice(app.indexOf(head), app.indexOf("\n}\n", app.indexOf(head)));

  test("the switch moved: each request still waiting is judged again, unless the switch went to Ask", () => {
    assert.match(app, /switchWorkers\(mode\);\s+switchAgent\(chat, mode\);/);
    const moved = body("function switchAgent(");
    assert.match(moved, /if \(!switchWords\(mode\)\) return;/);
    assert.match(moved, /for \(const a of newestOnRecord\(chat\.turns\)\?\.waiting \|\| \[\]\) if \(a\.form\?\.judged\) void answerAgent\(chat, a, \{ outcome: "switched" \}\);/);
  });

  test("Allow and Deny answer it on the run; Deny's words go to the agent as the person's message, queued where it takes none mid-turn", () => {
    const permit = body("async function permitAgent(");
    assert.match(permit, /answerAgent\(chat, ask, \{ outcome: "answered", answers: \{ permission: \{ chosen: \[allow \? "allow" : "deny"\], \.\.\.\(words \? \{ words \} : \{\}\) \} \} \}\)/);
    // Through `sendOrQueue` since the review of c2ee8d232, which queues what the send answers "queue" for.
    assert.match(permit, /if \(!allow && words\) await sendOrQueue\(words\);/);
    assert.match(app, /agentPermission: \(chat, ask, x\) => \{ void permitAgent\(chat, ask, x\); \},/);
  });

  // (fails before: no — a guard the mutation pass asked for: nothing pinned what a yes to a plan does under Read-only)
  test("a plan's way on: a yes under Read-only moves the switch to Ask first; words with a way back go out next", () => {
    const plan = body("async function planAgent(");
    assert.match(plan, /if \(!back && chat\.view\?\.settings\?\.effective\?\.loop\?\.permissions === "read-only" && !\(await writeSessionSettings\(chat, \{ patch: setPath\("loop\.permissions", "ask"\) \}\)\)\)\s+return "The switch stayed at Read-only, so the plan wasn't answered";/);
    assert.match(plan, /if \(!why && words\) queueNext\(chat, \[words\], /);
  });
});

describe("the switch's parts, one at a time (HarnessV3-ACP AC3-2)", () => {
  const root = mkdtempSync(join(tmpdir(), "filament-acp-permit-parts-"));
  after(() => removeDirs(root));
  /** The session's switch at `mode` with these rules, no learned permissions. @param {string} mode @param {any[]} [rules] */
  const at = (mode, rules = []) => createAgentPermits({ rules, modeNow: () => /** @type {any} */ (mode), learned: null });

  // (fails before: yes — the switch knew no worktree: in edit mode a worker's write to the developer's folder ran, and
  // its change landed past the apply; HarnessV3-TaskGraph-v2 §12.18, found by V2-0b's drive)
  test("a worker held to its worktree: a change to a file outside it is refused before any mode or rule is asked, the person's yes included; inside it, and everything that is no change, is judged as before", () => {
    const worktree = join(root, "wt");
    mkdirSync(worktree, { recursive: true });
    const outside = join(root, "notes.md");
    /** @param {string} mode @param {any[]} [rules] */
    const held = (mode, rules = []) => createAgentPermits({ rules, modeNow: () => /** @type {any} */ (mode), learned: null, confine: worktree });
    const refusal = { verdict: "refuse", mode: "edit", notes: [], how: `refused: ${outside} is outside the worktree it works in (${worktree}), and its change is read from there`, why: `Filament, as ${outside} is outside the worktree it works in` };
    // By its full path, by one that climbs out, as a write and as an edit; one file of several is enough.
    assert.deepEqual(held("edit").judge([{ name: "edit", input: { path: outside } }], worktree), refusal);
    assert.deepEqual(held("edit").judge([{ name: "write", input: { path: outside, content: "x" } }], worktree), refusal);
    assert.equal(held("edit").judge([{ name: "edit", input: { path: "../notes.md" } }], worktree).verdict, "refuse");
    assert.equal(held("edit").judge([{ name: "edit", input: { path: join(worktree, "a.js") } }, { name: "edit", input: { path: outside } }], worktree).verdict, "refuse");
    // No mode runs it, no rule allows it, and nobody is asked: under ask it is refused, not put to the person.
    assert.equal(held("auto").judge([{ name: "edit", input: { path: outside } }], worktree).verdict, "refuse");
    assert.equal(held("ask").judge([{ name: "edit", input: { path: outside } }], worktree).verdict, "refuse");
    assert.equal(held("edit", [{ tool: "edit", pattern: "*", verdict: "allow" }]).judge([{ name: "edit", input: { path: outside } }], worktree).verdict, "refuse");
    assert.deepEqual(held("edit").allowed([{ name: "edit", input: { path: outside } }], worktree), refusal, "the person's yes moves nothing out of it");
    // Inside its worktree, by a full path or one from its folder: as the switch judges any change.
    assert.equal(held("edit").judge([{ name: "edit", input: { path: join(worktree, "src", "a.js") } }], worktree).verdict, "run");
    assert.equal(held("edit").judge([{ name: "write", input: { path: "notes.md", content: "x" } }], worktree).verdict, "run");
    assert.equal(held("ask").judge([{ name: "edit", input: { path: join(worktree, "a.js") } }], worktree).verdict, "ask");
    assert.equal(held("edit").allowed([{ name: "edit", input: { path: join(worktree, "a.js") } }], worktree).verdict, "run");
    // What changes no file by its path is not the fence's: a read of the developer's folder, a command.
    assert.equal(held("edit").judge([{ name: "read", input: { path: outside } }], worktree).verdict, "run");
    for (const command of ["ls", `echo x > "${outside}"`]) {
      const call = [{ name: "bash", input: { command } }];
      assert.deepEqual(held("edit").judge(call, worktree), at("edit").judge(call, worktree), `a command is the switch's as before: ${command}`);
    }
    // The session's own agent, and a worker that shares the folder, are held to none: a change outside its folder asks,
    // as any chat's does (HarnessV4_SpacesPlugins_Plan A2b), never the fence's refusal.
    assert.equal(at("edit").judge([{ name: "edit", input: { path: outside } }], worktree).verdict, "ask");
  });

  // (fails before: yes — refused its Edit, a worker's agent wrote the same file with its shell: the switch asked about
  // the command as about any, and a yes — or Auto — put the change in the developer's folder, past the apply;
  // HarnessV3-TaskGraph-v2 §12.18, TG2-D38, found by the fix's own drive)
  test("a worker held to its worktree: a command that reaches the developer's folder outside it is refused in every mode, the person's yes included, and the turn is told; one in its worktree, and one that only says the folder's name, is judged as before", () => {
    const folder = join(root, "proj");
    const worktree = join(folder, ".git", "filament-worktrees", "sa_1");
    mkdirSync(worktree, { recursive: true });
    const fwd = (/** @type {string} */ p) => p.split(sep).join("/");
    /** @type {import("../src/app/agent-permits.js").Stray[]} */
    const told = [];
    /** @param {string} mode @param {any[]} [rules] */
    const held = (mode, rules = []) => createAgentPermits({ rules, modeNow: () => /** @type {any} */ (mode), learned: null, confine: worktree, folder, onStray: (out) => told.push(out) });
    const refusal = {
      verdict: "refuse",
      mode: "edit",
      notes: [],
      how: `refused: its command reaches the developer's folder (${folder}), outside the worktree it works in (${worktree}): its commands run on its worktree's files`,
      why: "Filament, as its command reaches the developer's folder outside the worktree it works in",
    };
    const write = `echo x > "${fwd(folder)}/amounts.js"`;
    assert.deepEqual(held("edit").judge([{ name: "bash", input: { command: write } }], worktree), refusal);
    assert.deepEqual(told, [{ command: write }], "the turn is told what was refused, once");
    // A PowerShell script the same, a read of a file there, and a step into the folder; one call of several is enough.
    const script = `Set-Content -Path '${join(folder, "amounts.js")}' -Value 'x'`;
    assert.deepEqual(held("edit").judge([{ name: "powershell", input: { command: script } }], worktree), refusal);
    assert.equal(held("edit").judge([{ name: "bash", input: { command: `cat "${fwd(folder)}/amounts.js"` } }], worktree).verdict, "refuse");
    assert.equal(held("edit").judge([{ name: "bash", input: { command: `cd "${fwd(folder)}" && node --test` } }], worktree).verdict, "refuse");
    assert.equal(held("edit").judge([{ name: "bash", input: { command: "ls" } }, { name: "bash", input: { command: write } }], worktree).verdict, "refuse");
    // No mode runs it, no rule allows it, nobody is asked, and the person's yes does not run it.
    for (const mode of ["auto", "ask"]) assert.equal(held(mode).judge([{ name: "bash", input: { command: write } }], worktree).verdict, "refuse", mode);
    assert.equal(held("edit", [{ tool: "bash", pattern: "*", verdict: "allow" }]).judge([{ name: "bash", input: { command: write } }], worktree).verdict, "refuse");
    assert.deepEqual(held("edit").allowed([{ name: "bash", input: { command: write } }], worktree), refusal);
    // A file it asks to change says its path to the turn, not a command.
    told.length = 0;
    assert.equal(held("edit").judge([{ name: "edit", input: { path: join(folder, "amounts.js") } }], worktree).verdict, "refuse");
    assert.deepEqual(told, [{ path: join(folder, "amounts.js") }]);
    // In its worktree, by its full path or none; and a command that only says the folder's name, which the switch's
    // reader passes as reading: judged as the same request of an agent held to nothing, and the turn hears nothing.
    told.length = 0;
    for (const command of [`echo x > "${fwd(worktree)}/amounts.js"`, `cd "${fwd(worktree)}" && node --test`, "cat amounts.js", "node --test", `echo "the folder is ${fwd(folder)}"`, `echo x > "${fwd(folder)}-other/a.js"`]) {
      const call = [{ name: "bash", input: { command } }];
      assert.deepEqual(held("edit").judge(call, worktree), at("edit").judge(call, worktree), command);
    }
    assert.equal(held("edit").judge([{ name: "bash", input: { command: `echo "the folder is ${fwd(folder)}"` } }], worktree).verdict, "run");
    assert.deepEqual(told, []);
  });

  // The re-read of 11-11: Antigravity names the folder its command runs in (`Cwd`), which its bash call dropped off
  // Windows, and the switch read every command but a PowerShell script's as run in the chat's folder.
  // (fails before: yes — `cat secret.txt` run in another folder ran as a read of the chat's; `cat ../notes.md` run in
  // its src asked; a worker's command run in the developer's folder ran under Auto; a read in `.git` of another
  // machine's agents' chat ran)
  test("a command run in the folder its call names is judged there: past the chat's folder it asks, inside it reads from there; a worker's run in the developer's folder is refused, and another machine's agents' run in `.git` is no read", () => {
    const chat = join(root, "chat-cwd");
    const elsewhere = join(root, "elsewhere");
    for (const d of [join(chat, "src"), join(chat, ".git"), elsewhere]) mkdirSync(d, { recursive: true });
    writeFileSync(join(chat, "notes.md"), "n\n");
    writeFileSync(join(elsewhere, "secret.txt"), "s\n");
    /** Antigravity's command off Windows, as the switch is handed it. @param {string} command @param {string} cwd */
    const agy = (command, cwd) => /** @type {any[]} */ (loopCalls({ toolCallId: "c1", kind: "execute", status: "pending", title: command, rawInput: { CommandLine: command, Cwd: cwd } }, "antigravity-acp", "linux"));
    const past = at("edit").judge(agy("cat secret.txt", elsewhere), chat);
    assert.equal(past.verdict, "ask", JSON.stringify(past));
    assert.match(String(/** @type {any} */ (past).reason ?? /** @type {any} */ (past).question), /it runs in .*elsewhere/);
    assert.equal(at("edit").judge(agy("cat ../notes.md", join(chat, "src")), chat).verdict, "run", "read from its own folder");
    assert.equal(at("edit").judge(agy("cat notes.md", chat), chat).verdict, "run");
    // A worker held to its worktree: a command, PowerShell's too, run in the developer's folder outside it.
    const folder = join(root, "proj-cwd");
    const worktree = join(folder, ".git", "filament-worktrees", "sa_2");
    mkdirSync(worktree, { recursive: true });
    const held = createAgentPermits({ rules: [], modeNow: () => /** @type {const} */ ("auto"), learned: null, confine: worktree, folder });
    for (const name of ["bash", "powershell"]) {
      assert.equal(held.judge([{ name, input: { command: "npm test", cwd: folder } }], worktree).verdict, "refuse", name);
      assert.equal(held.judge([{ name, input: { command: "npm test", cwd: join(worktree, "src") } }], worktree).verdict, "run", `${name} in its worktree`);
    }
    // Another machine's agents' chat: a repository's own `.git` is no read of theirs, whatever folder it is named from.
    const theirs = createAgentPermits({ rules: [], modeNow: () => /** @type {const} */ ("edit"), learned: null, agentsDevice: true });
    assert.notEqual(theirs.judge(agy("cat config", join(chat, ".git")), chat).verdict, "run");
    assert.equal(theirs.judge(agy("cat notes.md", chat), chat).verdict, "run");
  });

  // (fails before: yes — a yes was the person's alone, and counted towards the project's always-allow; TG2-D41)
  test("a worker's lead's yes is judged again as the person's is, in its own name, and counts towards nothing", () => {
    /** @type {string[]} */
    const counted = [];
    const learned = { allowed: () => false, recordAllow: (/** @type {string} */ name) => (counted.push(name), null), offered: () => null };
    /** @param {any[]} [rules] @param {string} [mode] */
    const p = (rules = [], mode = "ask") => createAgentPermits({ rules, modeNow: () => /** @type {any} */ (mode), learned });
    const call = [{ name: "bash", input: { command: "npm test" } }];
    assert.deepEqual(p().allowed(call, root, { by: "lead" }), { verdict: "run", mode: "ask", notes: [], how: "ran: its lead allowed it" });
    assert.deepEqual(counted, []);
    assert.match(p([{ tool: "bash", pattern: "npm *", verdict: "deny" }]).allowed(call, root, { by: "lead" }).how, /^its lead said yes, but the rule .* refuses it now$/);
    assert.equal(p([], "read-only").allowed(call, root, { by: "lead" }).how, "its lead said yes, but this session is read-only now");
    assert.equal(p().allowed(call, root).how, "ran: the person allowed it");
    assert.deepEqual(counted, ["bash"], "the person's yes still counts");
  });

  // (fails before: yes — nothing read a command for the developer's folder)
  test("a command names the developer's folder outside the worktree: however a shell says a path, and never for a folder or a worktree whose name only begins the same", () => {
    const F = "C:\\Users\\dev\\proj";
    const W = "C:\\Users\\dev\\proj\\.git\\filament-worktrees\\sa_1";
    const names = (/** @type {string} */ command) => namesOutside(command, F, W);
    // As Windows says it, with either slash and in any case; as Git Bash and WSL say a drive; quoted, and at the end.
    assert.equal(names("cat > C:/Users/dev/proj/amounts.js"), true);
    assert.equal(names("Set-Content -Path 'C:\\Users\\dev\\proj\\amounts.js' -Value x"), true);
    assert.equal(names("type c:\\users\\DEV\\proj\\amounts.js"), true);
    assert.equal(names("echo x > /c/Users/dev/proj/amounts.js"), true);
    assert.equal(names("echo x > /mnt/c/Users/dev/proj/amounts.js"), true);
    assert.equal(names('cd "C:\\Users\\dev\\proj" && node --test'), true);
    assert.equal(names("cd C:/Users/dev/proj"), true);
    assert.equal(names("cd C:/Users/dev/proj/"), true);
    // Inside its worktree is not outside it; one path outside is enough, and another worker's worktree is outside.
    assert.equal(names("cd C:/Users/dev/proj/.git/filament-worktrees/sa_1 && node --test"), false);
    assert.equal(names("cat /c/Users/dev/proj/.git/filament-worktrees/sa_1/amounts.js"), false);
    assert.equal(names("cp C:/Users/dev/proj/.git/filament-worktrees/sa_1/a.js C:/Users/dev/proj/a.js"), true);
    assert.equal(names("cat C:/Users/dev/proj/.git/filament-worktrees/sa_2/a.js"), true);
    assert.equal(names("cat C:/Users/dev/proj/.git/filament-worktrees/sa_10/a.js"), true, "a worktree whose name only begins the same");
    // Another folder, and a command that names none.
    assert.equal(names("echo x > C:/Users/dev/proj-other/a.js"), false);
    assert.equal(names("echo x > C:/Users/dev/project/a.js"), false);
    assert.equal(names("echo x > C:/Users/dev/proj.bak/a.js"), false);
    assert.equal(names("node --test"), false);
    assert.equal(names(""), false);
    // A folder with no drive is said one way.
    assert.equal(namesOutside("echo x > /home/dev/proj/a.js", "/home/dev/proj", "/home/dev/proj/.git/filament-worktrees/sa_1"), true);
    assert.equal(namesOutside("echo x > /home/dev/proj/.git/filament-worktrees/sa_1/a.js", "/home/dev/proj", "/home/dev/proj/.git/filament-worktrees/sa_1"), false);
  });

  // (fails before: yes — TG2-D55's fourth drive: a worker listed the developer's folder through Git Bash's /tmp, and
  // the fence knew the folder by its full path alone; Cygwin's drive was read already, Git Bash's form lying in it)
  test("a command names the developer's folder by the home's or the temp folder's short name, as Git Bash, PowerShell and cmd say them, or as Cygwin says a drive", () => {
    assert.equal(namesOutside("echo x > /cygdrive/c/Users/dev/proj/amounts.js", "C:\\Users\\dev\\proj", "C:\\Users\\dev\\proj\\.git\\filament-worktrees\\sa_1"), true);
    const H = join(homedir(), "code", "app");
    const HW = join(H, ".git", "filament-worktrees", "sa_1");
    for (const c of ["cp a.js ~/code/app/a.js", "cat $HOME/code/app/a.js", "cat ${HOME}/code/app/a.js", "type %USERPROFILE%\\code\\app\\a.js", "Get-Content $env:USERPROFILE\\code\\app\\a.js", "cd ~/code/app && npm test"])
      assert.equal(namesOutside(c, H, HW), true, c);
    assert.equal(namesOutside("cd ~/code/app/.git/filament-worktrees/sa_1 && npm test", H, HW), false, "its worktree by the home's name");
    assert.equal(namesOutside("cat ~/code/apps/a.js", H, HW), false, "a folder whose name only begins the same");
    assert.equal(namesOutside("cat $HOMEPATH/code/app/a.js", H, HW), false, "another variable");
    assert.equal(namesOutside("cat ~/.bashrc", H, HW), false, "elsewhere in the home");
    const T = join(tmpdir(), "filament-proj");
    const TW = join(T, ".git", "filament-worktrees", "sa_1");
    for (const c of ["ls -la /tmp/filament-proj/", "cat $TEMP/filament-proj/a.js", "cat ${TMP}/filament-proj/a.js", "cat $TMPDIR/filament-proj/a.js", "type %TEMP%\\filament-proj\\a.js", "Get-Content $env:TEMP\\filament-proj\\a.js"])
      assert.equal(namesOutside(c, T, TW), true, c);
    assert.equal(namesOutside("ls /tmp/filament-proj/.git/filament-worktrees/sa_1", T, TW), false, "its worktree by the temp folder's name");
    assert.equal(namesOutside("ls /tmp/filament-project", T, TW), false, "a folder whose name only begins the same");
  });

  // (fails before: yes — a refused agent heard only a no, and wrote the same file another way)
  test("Filament's word to a worker the fence refused: the same file in its worktree by its path, the worktree where the file is no twin's, and where a command belongs", () => {
    const folder = join(root, "proj");
    const worktree = join(folder, ".git", "filament-worktrees", "sa_1");
    const asked = join(folder, "src", "amounts.js");
    assert.equal(
      strayWords({ path: asked }, worktree, folder),
      `Filament refused your change to ${asked}: that is the developer's folder, and you work in your own worktree. The same file is ${join(worktree, "src", "amounts.js")} — read and change that one. Your work reaches the developer's folder from your worktree, once it is applied.`,
    );
    // A file outside the developer's folder too, one said from where it stands, and where no folder is known.
    const far = join(root, "elsewhere.txt");
    const nowhere = (/** @type {string} */ path) => `Filament refused your change to ${path}: it is outside your worktree, ${worktree}. Change files inside your worktree only: your work reaches the developer's folder from there, once it is applied.`;
    assert.equal(strayWords({ path: far }, worktree, folder), nowhere(far));
    assert.equal(strayWords({ path: "../notes.md" }, worktree, folder), nowhere("../notes.md"));
    assert.equal(strayWords({ path: asked }, worktree, null), nowhere(asked));
    assert.equal(
      strayWords({ command: "echo x > amounts.js" }, worktree, folder),
      `Filament refused your command: it reaches the developer's folder (${folder}), by its path or by climbing out of your worktree with "..", and you work in your own worktree, ${worktree}, where the same files are at the same paths. Run it there, with paths inside your worktree; a command that reads or writes the developer's folder is refused as a change to it is.`,
    );
    // A read: the same file in its worktree; a search, the same folder; where no twin is known, the worktree.
    assert.equal(
      strayWords({ path: asked, read: "file" }, worktree, folder),
      `Filament refused your read of ${asked}: that is the developer's folder, and you work in your own worktree, where your own changes are. The same file is ${join(worktree, "src", "amounts.js")} — read that one.`,
    );
    assert.equal(
      strayWords({ path: join(folder, "src"), read: "search" }, worktree, folder),
      `Filament refused your search of ${join(folder, "src")}: that is the developer's folder, and you work in your own worktree, where your own changes are. Search ${join(worktree, "src")} instead.`,
    );
    assert.equal(strayWords({ path: "../../../src", read: "search" }, worktree, folder).endsWith(`Search ${worktree} instead.`), true);
  });

  // (fails before: yes — a command that climbed out of the worktree with `..`, naming no folder, was judged as any:
  // Auto ran it, and its change landed in the developer's folder past the apply; HarnessV3-TaskGraph-v2 §12.18, TG2-D39)
  test("a command climbs out of the worktree into the developer's folder by `..`: from where it runs, by either slash and as Git Bash says a drive; never a range, a dotted name, a climb that stays inside or one that goes past the folder", () => {
    const F = "C:\\Users\\dev\\proj";
    const W = "C:\\Users\\dev\\proj\\.git\\filament-worktrees\\sa_1";
    const climbs = (/** @type {string} */ command, root = W) => climbsOut(command, F, W, root);
    assert.equal(climbs("cd ../../.. && sed -i s/a/b/ amounts.js"), true);
    assert.equal(climbs("echo x > ../../../amounts.js"), true);
    assert.equal(climbs("Set-Content -Path '..\\..\\..\\amounts.js' -Value x"), true);
    assert.equal(climbs("cd .."), true, "its worktrees' folder is the developer's .git, outside its own");
    assert.equal(climbs("git -C ../../.. commit -am x"), true);
    assert.equal(climbs("node --out=../../../out.txt"), true);
    assert.equal(climbs("cp a.js C:/Users/dev/proj/.git/filament-worktrees/sa_1/../../../a.js"), true, "a full path into the worktree that climbs back out");
    assert.equal(climbs("cp a.js /c/Users/dev/proj/.git/filament-worktrees/sa_1/../../../a.js"), true);
    assert.equal(climbs("cat ../amounts.js", join(W, "src")), false, "from a folder of the worktree, one step up is the worktree");
    assert.equal(climbs("cat ../../../../amounts.js", join(W, "src")), true);
    // Inside, past the folder, and what only looks like a climb.
    assert.equal(climbs("cat src/../amounts.js"), false);
    assert.equal(climbs("ls ../../../../other"), false, "past the developer's folder is another folder");
    assert.equal(climbs("git log HEAD~3..HEAD"), false);
    assert.equal(climbs("git diff main...HEAD"), false);
    assert.equal(climbs("echo ..."), false);
    assert.equal(climbs("node --test"), false);
    assert.equal(climbsOut("cd ../../..", "/home/dev/proj", "/home/dev/proj/.git/filament-worktrees/sa_1", "/home/dev/proj/.git/filament-worktrees/sa_1"), true);
  });

  // (fails before: yes — three builders of 11-09: a test file written with a heredoc, and a `node -e` one-liner, held
  // `../lib/…` in the text they wrote or ran, and the fence read it as the command's own path climbing out of the worktree)
  test("a command's own paths climb out, not the text it writes or the source it runs: a heredoc written to a file or read as a program, and an interpreter's inline source; a heredoc a shell runs or a command reads, its target, and the words around them still climb", () => {
    const F = "C:\\Users\\dev\\proj";
    const W = "C:\\Users\\dev\\proj\\.git\\filament-worktrees\\sa_1";
    const climbs = (/** @type {string} */ command) => climbsOut(command, F, W, W);
    // A file's text, and a program's source: from test/, ../lib is the worktree's.
    assert.equal(climbs(`cat > test/x.test.js <<'EOF'\nimport { a } from "../lib/x.js";\nEOF`), false);
    assert.equal(climbs(`cat <<EOF > test/x.test.js && node --test test/x.test.js\nimport "../../../../lib/x.js";\nEOF`), false);
    assert.equal(climbs(`tee -a notes.md <<-"END"\n\tsee ../../../a.js\n\tEND\necho done`), false);
    assert.equal(climbs(`node --input-type=module <<'JS'\nimport { a } from "../lib/x.js";\nJS`), false);
    assert.equal(climbs(`python3 - <<'PY'\nprint(open('../../../a.js').read())\nPY`), false);
    assert.equal(climbs(`node -e "const { a } = require('../lib/x.js'); console.log(a)"`), false);
    assert.equal(climbs(`node --input-type=module -e 'import("../../../lib/x.js")' && echo done`), false);
    assert.equal(climbs(`python -c "import sys; sys.path.insert(0, '../lib')"`), false);
    assert.equal(climbs(`node --eval="require('../lib/x.js')"`), false);
    assert.equal(climbs(`perl -ne 'print if m(../../../x)' a.js`), false);
    // The command's own paths around them: a heredoc's target, the line after its end, a climb ahead of the source.
    assert.equal(climbs("cat ../../secret"), true, "the developer's .git");
    assert.equal(climbs("cd .. && rm x"), true);
    assert.equal(climbs(`cat > ../../../a.js <<'EOF'\nx\nEOF`), true);
    assert.equal(climbs(`cat > a.js <<'EOF'\nx\nEOF\ncat ../../../secret`), true);
    assert.equal(climbs(`cd ../../.. && node -e "console.log(1)"`), true);
    // A heredoc a shell runs is commands; one piped on, taken into a substitution, or read by a command or a script is
    // their words; one that never ends is the command's; and a shell's own inline source is commands.
    assert.equal(climbs(`bash <<'EOF'\ncd ../../..\nrm amounts.js\nEOF`), true);
    assert.equal(climbs(`cat <<'EOF' | sh\ncd ../../.. && rm amounts.js\nEOF`), true);
    assert.equal(climbs(`rm $(cat <<'EOF'\n../../../amounts.js\nEOF\n)`), true);
    assert.equal(climbs(`rm "$(cat <<'EOF'\n../../../amounts.js\nEOF\n)"`), true);
    assert.equal(climbs(`xargs rm <<'EOF'\n../../../amounts.js\nEOF`), true);
    assert.equal(climbs(`node script.js <<'EOF'\n../../../amounts.js\nEOF`), true, "a script's input, not its source");
    assert.equal(climbs(`cat > a.js <<'EOF'\n../../../amounts.js`), true, "a heredoc that never ends");
    assert.equal(climbs(`bash -c "cd ../../.. && rm amounts.js"`), true);
    assert.equal(climbs(`echo "<<EOF"\ncat ../../../secret\nEOF`), true, "a `<<` in quotes opens nothing");
  });

  // (fails before: yes — 11-09's follow-up: a climb after a `cd` into the worktree's own folder was read from the
  // folder the command started in, and refused)
  test("a command's `cd` into a folder of its worktree moves where its later words are read from; one out of it, one nobody can read, one in a pipe, the background or a subshell, and one to no folder there keep reading them from where the command runs", () => {
    const F = join(root, "proj8");
    const W = join(F, ".git", "filament-worktrees", "sa_1");
    for (const d of ["test", "lib", join("src", "sub")]) mkdirSync(join(W, d), { recursive: true });
    const fwd = (/** @type {string} */ p) => p.split(sep).join("/");
    const climbs = (/** @type {string} */ command) => climbsOut(command, F, W, W);
    // From test/, ../lib is the worktree's: by `&&`, `;`, a line break, pushd, PowerShell's Set-Location, a full path.
    for (const command of [
      "cd test && cat ../lib/x.js",
      "cd test; cat ../lib/x.js",
      "cd test\ncat ../lib/x.js",
      "pushd test && cat ../lib/x.js && popd",
      "cd -- test && cat ../lib/x.js",
      "cd src/sub && cat ../../lib/x.js",
      "cd test && cd ../src && cat ../lib/x.js",
      "Set-Location -Path test; Get-Content ..\\lib\\x.js",
      "sl test; Get-Content ../lib/x.js",
      `cd "${fwd(join(W, "test"))}" && cat ../lib/x.js`,
      "(cd test && cat ../lib/x.js)",
    ])
      assert.equal(climbs(command), false, command);
    // Read from where the command runs, as before.
    for (const command of [
      "cd .. && cat secret",
      "cd test && cat ../../../../amounts.js",
      "cd $X && cat ../lib/x.js",
      'cd "$(git rev-parse --show-toplevel)/test" && cat ../lib/x.js',
      "cd - && cat ../lib/x.js",
      "cd && cat ../lib/x.js",
      "cd ~/test && cat ../lib/x.js",
      "cd te* && cat ../lib/x.js",
      "cd missing && cat ../lib/x.js",
      "cd test && cd $X && cat ../lib/x.js",
      "cd test | cat ../lib/x.js",
      "cd test & cat ../lib/x.js",
      "(cd test) && cat ../lib/x.js",
      "(cd test && ls) && cat ../lib/x.js",
      "pushd test && popd && cat ../lib/x.js",
      "cd test test2 && cat ../lib/x.js",
      `cd "${fwd(F)}" && cat ../lib/x.js`,
    ])
      assert.equal(climbs(command), true, command);
  });

  // (fails before: yes — 11-09's follow-up: the switch refused a worker's `cd test && cat ../lib/x.js`)
  test("a worker held to its worktree: a climb past a `cd` into its own folder is judged as any command; a `cd` out of it, to the developer's folder, or by a variable keeps today's judgement", () => {
    const folder = join(root, "proj9");
    const worktree = join(folder, ".git", "filament-worktrees", "sa_1");
    mkdirSync(join(worktree, "test"), { recursive: true });
    const fwd = (/** @type {string} */ p) => p.split(sep).join("/");
    /** @param {string} mode */
    const held = (mode) => createAgentPermits({ rules: [], modeNow: () => /** @type {any} */ (mode), learned: null, confine: worktree, folder });
    /** @param {string} command */
    const both = (command) => [{ name: "bash", input: { command } }];
    for (const mode of ["edit", "auto"]) assert.deepEqual(held(mode).judge(both("cd test && cat ../lib/x.js"), worktree), at(mode).judge(both("cd test && cat ../lib/x.js"), worktree), mode);
    for (const command of ["cd .. && cat secret", `cd ${fwd(folder)} && cat x`, "cd $X && cat ../lib/x.js", "cd test && cd $X && rm ../lib/x.js"])
      assert.equal(held("auto").judge(both(command), worktree).verdict, "refuse", command);
    // The fence reads no variable: a `cd` by one, then a path that climbs nothing, is judged as it was before.
    assert.deepEqual(held("auto").judge(both("cd $X && rm y"), worktree), at("auto").judge(both("cd $X && rm y"), worktree));
  });

  // (fails before: yes — 11-09's follow-up: a PowerShell here-string is a heredoc's twin, and its text was read as the
  // command's own paths)
  test("a PowerShell here-string written to a file or read as a program is no path of its command; one a shell runs, one kept in a variable, one whose subexpression runs, and a heredoc or an inline source whose `$(…)` runs, still climb", () => {
    const F = "C:\\Users\\dev\\proj";
    const W = "C:\\Users\\dev\\proj\\.git\\filament-worktrees\\sa_1";
    const climbs = (/** @type {string} */ command) => climbsOut(command, F, W, W);
    for (const command of [
      `@'\nimport { a } from "../lib/x.js";\n'@ | Set-Content test/x.test.js`,
      `Set-Content -Path test/x.test.js -Value @'\nimport "../../../lib/x.js";\n'@`,
      `@"\nimport { a } from "../lib/x.js";\n"@ | Out-File -Encoding utf8 test/x.test.js`,
      `@'\n../../../a.js\n'@ > notes.md`,
      `@'\nconsole.log(require("../lib/x.js"))\n'@ | node`,
      `node -e @'\nrequire("../lib/x.js")\n'@`,
      `Add-Content notes.md @'\nsee ../../../a.js\n'@; Get-Content notes.md`,
    ])
      assert.equal(climbs(command), false, command);
    for (const command of [
      `@'\nRemove-Item ../../../amounts.js\n'@ | Invoke-Expression`,
      `@'\nRemove-Item ../../../amounts.js\n'@ | iex`,
      `Invoke-Expression @'\nRemove-Item ../../../amounts.js\n'@`,
      `iex @"\nRemove-Item ../../../amounts.js\n"@`,
      `powershell -Command @'\nRemove-Item ../../../amounts.js\n'@`,
      `$s = @'\n../../../amounts.js\n'@; Remove-Item $s`,
      `@"\n$(Remove-Item ../../../amounts.js)\n"@ | Set-Content x.txt`,
      `@'\nx\n'@ | Set-Content ../../../amounts.js`,
      `@'\nx\n'@ | Set-Content x.txt; Remove-Item ../../../amounts.js`,
      `@'\n../../../a.js\n'@ | Tee-Object x.txt | Remove-Item`,
      `@'\n../../../amounts.js`,
      // bash's own: an unquoted heredoc's `$(…)` and backticks run, and so does a double-quoted source's.
      "cat > a.txt <<EOF\n$(rm ../../../amounts.js)\nEOF",
      "cat > a.txt <<EOF\n`rm ../../../amounts.js`\nEOF",
      `node -e "$(cat ../../../secret.js)"`,
    ])
      assert.equal(climbs(command), true, command);
    // A quoted delimiter and a single-quoted source run nothing.
    assert.equal(climbs("cat > a.js <<'EOF'\nconst p = `${'../lib'}/x.js`; $(x ../../../y)\nEOF"), false);
    assert.equal(climbs("node -e 'console.log(`../../../x`)'"), false);
  });

  // (fails before: yes — the same builders of 11-09: a heredoc that wrote a test file importing ../lib was refused as a
  // command reaching the developer's folder)
  test("a worker held to its worktree: a heredoc or a one-liner whose text climbs is judged as any command; one whose target, or whose source by its full path, is the developer's folder is still refused", () => {
    const folder = join(root, "proj6");
    const worktree = join(folder, ".git", "filament-worktrees", "sa_1");
    mkdirSync(join(worktree, "test"), { recursive: true });
    const fwd = (/** @type {string} */ p) => p.split(sep).join("/");
    /** @type {import("../src/app/agent-permits.js").Stray[]} */
    const told = [];
    /** @param {string} mode */
    const held = (mode) => createAgentPermits({ rules: [], modeNow: () => /** @type {any} */ (mode), learned: null, confine: worktree, folder, onStray: (out) => told.push(out) });
    for (const command of [`cat > test/x.test.js <<'EOF'\nimport { a } from "../lib/x.js";\nEOF`, `node -e "console.log(require('../lib/x.js'))"`]) {
      const call = [{ name: "bash", input: { command } }];
      for (const mode of ["edit", "auto"]) assert.deepEqual(held(mode).judge(call, worktree), at(mode).judge(call, worktree), `${mode}: ${command}`);
    }
    assert.deepEqual(told, []);
    for (const command of [
      `cat > ${fwd(folder)}/x.js <<'EOF'\nx\nEOF`,
      `node -e "require('fs').writeFileSync('${fwd(folder)}/x.js', '')"`,
      "cat ../../secret",
      "cd .. && rm x",
      `rm ${fwd(join(folder, "amounts.js"))}`,
    ])
      assert.equal(held("auto").judge([{ name: "bash", input: { command } }], worktree).verdict, "refuse", command);
  });

  // (fails before: yes — a builder of 11-09 copied a capture script into a temp folder of its own, as its brief asked,
  // and its write was refused as outside its worktree)
  test("a worker held to its worktree: the system's temp folder is no project's — a change, a read and a command there pass the fence; a link from it into the developer's folder, and a temp folder that holds or lies in the developer's folder, do not", () => {
    const folder = join(root, "proj7");
    const worktree = join(folder, ".git", "filament-worktrees", "sa_1");
    const temp = join(root, "temp7");
    mkdirSync(worktree, { recursive: true });
    mkdirSync(temp, { recursive: true });
    const fwd = (/** @type {string} */ p) => p.split(sep).join("/");
    /** @type {import("../src/app/agent-permits.js").Stray[]} */
    const told = [];
    /** @param {string} mode */
    const held = (mode) => createAgentPermits({ rules: [], modeNow: () => /** @type {any} */ (mode), learned: null, confine: worktree, folder, onStray: (out) => told.push(out) });
    // os.tmpdir() reads these at each call: TEMP and TMP on Windows, TMPDIR first elsewhere.
    const names = ["TEMP", "TMP", "TMPDIR"];
    const saved = names.map((n) => process.env[n]);
    /** @param {string} dir */
    const tempAt = (dir) => {
      for (const n of names) process.env[n] = dir;
    };
    try {
      tempAt(temp);
      assert.equal(tmpdir(), temp);
      const script = join(temp, "capture.mjs");
      for (const call of [
        { name: "write", input: { path: script, content: "x" } },
        { name: "edit", input: { path: script } },
        { name: "write", input: { path: join(temp, "sa_1", "new", "capture.mjs"), content: "x" } },
        { name: "read", input: { path: script } },
        { name: "bash", input: { command: `cp scripts/capture.mjs ${fwd(temp)}/capture.mjs && node ${fwd(temp)}/capture.mjs` } },
      ]) {
        for (const mode of ["edit", "auto"]) assert.deepEqual(held(mode).judge([call], worktree), at(mode).judge([call], worktree), `${mode}: ${call.name} ${JSON.stringify(call.input)}`);
      }
      assert.equal(held("auto").judge([{ name: "write", input: { path: script, content: "x" } }], worktree).verdict, "run");
      assert.deepEqual(told, []);
      // The developer's folder, another worker's worktree, the developer's .git, and a folder that is neither the temp
      // folder nor the worktree stay outside it.
      for (const path of [join(folder, "amounts.js"), join(folder, ".git", "filament-worktrees", "sa_2", "a.js"), join(folder, ".git", "config"), join(root, "elsewhere.txt")])
        assert.equal(held("auto").judge([{ name: "write", input: { path, content: "x" } }], worktree).verdict, "refuse", path);
      // A link in the temp folder into the developer's folder leads there.
      symlinkSync(folder, join(temp, "via"), process.platform === "win32" ? "junction" : "dir");
      assert.equal(held("auto").judge([{ name: "write", input: { path: join(temp, "via", "amounts.js"), content: "x" } }], worktree).verdict, "refuse");
      // A temp folder that holds the developer's folder, or lies in it, is no place apart.
      tempAt(root);
      assert.equal(held("auto").judge([{ name: "write", input: { path: join(root, "scratch.mjs"), content: "x" } }], worktree).verdict, "refuse");
      tempAt(join(folder, "tmp"));
      assert.equal(held("auto").judge([{ name: "write", input: { path: join(folder, "tmp", "scratch.mjs"), content: "x" } }], worktree).verdict, "refuse");
    } finally {
      names.forEach((n, i) => {
        if (saved[i] === undefined) delete process.env[n];
        else process.env[n] = saved[i];
      });
    }
  });

  // (fails before: yes — the switch ran a worker's read of the developer's folder in every mode: it read the developer's
  // copy, not its own with its changes; HarnessV3-TaskGraph-v2 §12.18, TG2-D39)
  test("a worker held to its worktree: a read or a search of the developer's folder outside it, and a command that climbs out into it, are refused in every mode with the turn told; one in its worktree, and one past the developer's folder, run as before", () => {
    const folder = join(root, "proj2");
    const worktree = join(folder, ".git", "filament-worktrees", "sa_1");
    mkdirSync(worktree, { recursive: true });
    /** @type {import("../src/app/agent-permits.js").Stray[]} */
    const told = [];
    /** @param {string} mode */
    const held = (mode) => createAgentPermits({ rules: [], modeNow: () => /** @type {any} */ (mode), learned: null, confine: worktree, folder, onStray: (out) => told.push(out) });
    const file = join(folder, "amounts.js");
    assert.deepEqual(held("edit").judge([{ name: "read", input: { path: file } }], worktree), {
      verdict: "refuse",
      mode: "edit",
      notes: [],
      how: `refused: ${file} is the developer's folder, outside the worktree it works in (${worktree}), which holds the same files with its own changes`,
      why: `Filament, as ${file} is the developer's folder outside the worktree it works in`,
    });
    assert.deepEqual(told, [{ path: file, read: "file" }]);
    for (const mode of ["auto", "ask", "read-only"]) assert.equal(held(mode).judge([{ name: "read", input: { path: file } }], worktree).verdict, "refuse", mode);
    assert.equal(held("edit").judge([{ name: "read", input: { path: "../../../amounts.js" } }], worktree).verdict, "refuse", "by a climb from its folder");
    told.length = 0;
    assert.equal(held("edit").judge([{ name: "grep", input: { pattern: "total", path: folder } }], worktree).verdict, "refuse");
    assert.equal(held("edit").judge([{ name: "glob", input: { pattern: "*.js", path: join(folder, "src") } }], worktree).verdict, "refuse");
    assert.deepEqual(told, [{ path: folder, read: "search" }, { path: join(folder, "src"), read: "search" }]);
    told.length = 0;
    assert.deepEqual(held("auto").judge([{ name: "bash", input: { command: "cd ../../.. && echo x > amounts.js" } }], worktree).verdict, "refuse");
    assert.deepEqual(told, [{ command: "cd ../../.. && echo x > amounts.js" }]);
    // Its worktree, a search with no folder, and a file past the developer's folder: as before, and nothing told.
    told.length = 0;
    assert.equal(held("edit").judge([{ name: "read", input: { path: join(worktree, "amounts.js") } }], worktree).verdict, "run");
    assert.equal(held("edit").judge([{ name: "read", input: { path: "amounts.js" } }], worktree).verdict, "run");
    assert.equal(held("edit").judge([{ name: "grep", input: { pattern: "total" } }], worktree).verdict, "run");
    assert.equal(held("edit").judge([{ name: "read", input: { path: join(root, "elsewhere.txt") } }], worktree).verdict, "run");
    assert.equal(held("auto").judge([{ name: "bash", input: { command: "cat src/../amounts.js" } }], worktree).verdict, "run");
    assert.deepEqual(told, []);
    // A worker that shares the folder is held to none of it.
    assert.equal(at("edit").judge([{ name: "read", input: { path: file } }], worktree).verdict, "run");
  });

  // (fails before: yes — the Designer run of 10-23: `require('electron')` printed the folder's node_modules path, which
  // the copy links in, and the command that ran it was refused as reaching the developer's folder)
  test("a worker held to its worktree: the dependency folders its worktree links in are its own by their other name; the rest of the folder stays fenced", () => {
    const folder = join(root, "proj3");
    const worktree = join(folder, ".git", "filament-worktrees", "sa_2");
    mkdirSync(join(folder, "node_modules", "electron", "dist"), { recursive: true });
    mkdirSync(worktree, { recursive: true });
    symlinkSync(join(folder, "node_modules"), join(worktree, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    /** @param {string} mode */
    const held = (mode) => createAgentPermits({ rules: [], modeNow: () => /** @type {any} */ (mode), learned: null, confine: worktree, folder });
    const exe = join(folder, "node_modules", "electron", "dist", "electron.exe");
    assert.deepEqual(linkedIn(folder, worktree), [join(folder, "node_modules")]);
    assert.equal(held("auto").judge([{ name: "bash", input: { command: `"${exe.replace(/\\/g, "/")}" main.cjs` } }], worktree).verdict, "run");
    assert.equal(held("auto").judge([{ name: "powershell", input: { command: `& "${exe}" --version` } }], worktree).verdict, "run");
    assert.equal(held("edit").judge([{ name: "read", input: { path: join(folder, "node_modules", "electron", "package.json") } }], worktree).verdict, "run");
    assert.equal(held("auto").judge([{ name: "bash", input: { command: "node ../../../node_modules/electron/cli.js" } }], worktree).verdict, "run", "climbing into it");
    assert.equal(namesOutside(`node ${exe}`, folder, worktree), false);
    assert.equal(held("auto").judge([{ name: "bash", input: { command: `node "${join(folder, "src", "x.js")}"` } }], worktree).verdict, "refuse", "the rest of the folder");
    assert.equal(held("auto").judge([{ name: "bash", input: { command: `node "${join(folder, "node_modules_old", "x.js")}"` } }], worktree).verdict, "refuse", "a folder whose name only begins the same");
    assert.equal(held("edit").judge([{ name: "read", input: { path: join(folder, "package.json") } }], worktree).verdict, "refuse");
    assert.deepEqual(linkedIn(folder, join(folder, ".git", "filament-worktrees", "none")), [], "no link, nothing shared");
    assert.equal(namesOutside(`node ${exe}`, folder, null), true, "a brief's grant, before any worktree: the folder's");
    // (fails before: yes — the E27 hunt of 10-23: the file tools' fence followed the link and refused the read the
    // permits ran; a worker's turn hands its fence the folders its copy links in, `linkedIn`'s, as reads)
    assert.throws(() => resolveInside(worktree, "node_modules/electron/package.json"), /reaches outside the allowed task folder through a link/);
    assert.equal(resolveInside(worktree, "node_modules/electron/package.json", { reads: linkedIn(folder, worktree) }), join(worktree, "node_modules", "electron", "package.json"));
  });

  // (fails before: yes — f3's of 11-10: a folder that is a linked worktree with no node_modules of its own has its main
  // checkout's linked into the copy, and the file tools' fence refused every read through that link)
  test("a linked worktree with no dependency folder of its own: its main checkout's, which the copy links, is the copy's own too — a link elsewhere is not", () => {
    const main = join(root, "proj-main");
    const folder = join(root, "proj-wt");
    const worktree = join(root, "proj-copies", "sa_5");
    mkdirSync(join(main, ".git", "worktrees", "proj-wt"), { recursive: true });
    mkdirSync(join(main, "node_modules", "electron"), { recursive: true });
    writeFileSync(join(main, "node_modules", "electron", "package.json"), "{}");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, ".git"), `gitdir: ${join(main, ".git", "worktrees", "proj-wt").replace(/\\/g, "/")}\n`);
    mkdirSync(worktree, { recursive: true });
    const kind = process.platform === "win32" ? "junction" : "dir";
    symlinkSync(join(main, "node_modules"), join(worktree, "node_modules"), kind);
    assert.deepEqual(linkedIn(folder, worktree), [join(main, "node_modules")]);
    assert.equal(resolveInside(worktree, "node_modules/electron/package.json", { reads: linkedIn(folder, worktree) }), join(worktree, "node_modules", "electron", "package.json"));
    // A link at the same place to a folder that is not the main checkout's: nothing shared, the read refused.
    const other = join(root, "proj-copies", "sa_6");
    mkdirSync(join(root, "elsewhere", "node_modules"), { recursive: true });
    mkdirSync(other, { recursive: true });
    symlinkSync(join(root, "elsewhere", "node_modules"), join(other, "node_modules"), kind);
    assert.deepEqual(linkedIn(folder, other), []);
    // A main checkout's own folder (its .git a folder) has no main checkout of its own to fall back on.
    assert.deepEqual(linkedIn(main, other), []);
  });

  // (fails before: yes — the E27 hunt of 10-23: quotes a shell joins away split the folder's path past the check)
  test("a path split by quotes is the path the shell joins: the developer's folder named so is refused", () => {
    const folder = join(root, "proj4");
    const worktree = join(folder, ".git", "filament-worktrees", "sa_3");
    const f = folder.replace(/\\/g, "/");
    assert.equal(namesOutside(`cat ${f.slice(0, 2)}'${f.slice(2)}/package.json'`, folder, worktree), true);
    assert.equal(namesOutside(`cat "${f.slice(0, 5)}""${f.slice(5)}/package.json"`, folder, worktree), true);
    assert.equal(namesOutside(`cat '${worktree.replace(/\\/g, "/")}/package.json'`, folder, worktree), false, "its own worktree, quoted, stays its own");
  });

  // (fails before: yes — the bug hunt of 10-30, PERM-4: the fence knew the developer's folder by one spelling, and a
  // shell reads `C:\Users\dev\proj.\x` as `C:\Users\dev\proj\x`: Windows drops the dots that end a name)
  test("a command or a read names the developer's folder with dots ending one of its names, as Windows drops them; a name that only begins the same stays another folder", () => {
    const F = "C:\\Users\\dev\\proj";
    const W = "C:\\Users\\dev\\proj\\.git\\filament-worktrees\\sa_1";
    const names = (/** @type {string} */ command) => namesOutside(command, F, W);
    assert.equal(names("echo x > C:/Users/dev/proj./amounts.js"), true);
    assert.equal(names("type C:\\Users\\dev\\proj...\\amounts.js"), true);
    assert.equal(names('cd "C:\\Users\\dev\\proj."'), true);
    assert.equal(names("echo x > C:/Users/dev./proj/amounts.js"), true, "a folder on its way");
    assert.equal(names("echo x > /c/Users/dev/proj./amounts.js"), true, "as Git Bash says a drive");
    assert.equal(names("cat C:/Users/dev/proj./.git/filament-worktrees/sa_1/a.js"), false, "its worktree by the same spelling");
    assert.equal(names("cat C:/Users/dev/proj.bak/a.js"), false);
    assert.equal(names("cat C:/Users/dev/proj.d/a.js"), false);
    assert.equal(namesOutside("cat /home/dev/proj./a.js", "/home/dev/proj", "/home/dev/proj/.git/filament-worktrees/sa_1"), false, "where no drive is, the dot is the name's");
    if (process.platform !== "win32") return;
    assert.equal(climbsOut("cat ../../../../proj./amounts.js", F, W, W), true);
    const folder = join(root, "proj5");
    const worktree = join(folder, ".git", "filament-worktrees", "sa_1");
    mkdirSync(worktree, { recursive: true });
    const held = createAgentPermits({ rules: [], modeNow: () => "edit", learned: null, confine: worktree, folder });
    assert.equal(held.judge([{ name: "read", input: { path: `${folder}.\\amounts.js` } }], worktree).verdict, "refuse");
    assert.equal(held.judge([{ name: "read", input: { path: `${worktree}.\\amounts.js` } }], worktree).verdict, "run", "its worktree, dotted, stays its own");
  });

  // (fails before: yes — the bug hunt of 10-30, PERM-4: the folder's short (8.3) name, as Windows keeps one beside a
  // long name, said it in a way no compare of the words finds)
  test("a command or a read names the developer's folder by its short (8.3) name: read as the long one it stands for, through the folder on its way that is there", { skip: process.platform !== "win32" && "short names are Windows'" }, (t) => {
    const folder = process.env.ProgramFiles || "C:\\Program Files";
    const short = spawnSync("cmd.exe", ["/d", "/s", "/c", `"for %I in ("${folder}") do @echo %~sI"`], { encoding: "utf8", windowsVerbatimArguments: true }).stdout.trim();
    if (!short || short.toLowerCase() === folder.toLowerCase()) return t.skip(`${folder} has no short name on this volume`);
    const worktree = join(folder, ".git", "filament-worktrees", "sa_1");
    assert.equal(namesOutside(`type ${short}\\notes.txt`, folder, worktree), true);
    assert.equal(namesOutside(`cat ${short.replace(/\\/g, "/")}/new/notes.txt`, folder, worktree), true, "a file not there yet, through the folder that is");
    assert.equal(namesOutside(`type ${short}\\.git\\filament-worktrees\\sa_1\\a.js`, folder, worktree), false, "its worktree by the short name");
    assert.equal(namesOutside("git diff HEAD~1", folder, worktree), false, "a `~` and a digit in what is no path");
    const held = createAgentPermits({ rules: [], modeNow: () => "edit", learned: null, confine: worktree, folder });
    assert.equal(held.judge([{ name: "read", input: { path: `${short}\\notes.txt` } }], worktree).verdict, "refuse");
    assert.equal(held.judge([{ name: "bash", input: { command: `echo x > ${short}\\notes.txt` } }], worktree).verdict, "refuse");
  });

  // (fails before: yes — the bug hunt of 10-30, PERM-3: the fence read the hands' calls alone, so an MCP server's tool
  // wrote the developer's folder by its full path in every mode, and the change landed past the apply)
  test("a worker held to its worktree: an MCP tool's call that names the developer's folder outside it, by its full path or a climb, is refused in every mode with the turn told; one that names its worktree, or the folder only in words, runs as before", () => {
    const folder = join(root, "proj6");
    const worktree = join(folder, ".git", "filament-worktrees", "sa_1");
    mkdirSync(worktree, { recursive: true });
    /** @type {import("../src/app/agent-permits.js").Stray[]} */
    const told = [];
    /** @param {string} mode */
    const held = (mode) => createAgentPermits({ rules: [], modeNow: () => /** @type {any} */ (mode), learned: null, confine: worktree, folder, onStray: (out) => told.push(out) });
    const file = join(folder, "amounts.js");
    const write = [{ name: "mcp__fs__write_file", input: { path: file, content: "x" } }];
    assert.deepEqual(held("auto").judge(write, worktree), {
      verdict: "refuse",
      mode: "auto",
      notes: [],
      how: `refused: ${file} is the developer's folder, outside the worktree it works in (${worktree}), which holds the same files with its own changes`,
      why: `Filament, as ${file} is the developer's folder outside the worktree it works in`,
    });
    assert.deepEqual(told, [{ path: file, tool: "mcp__fs__write_file" }]);
    for (const mode of ["edit", "ask", "read-only"]) assert.equal(held(mode).judge(write, worktree).verdict, "refuse", mode);
    assert.equal(held("auto").allowed(write, worktree).verdict, "refuse", "the person's yes moves nothing out of it");
    // Deep in its arguments, and by a climb out of the worktree.
    assert.equal(held("auto").judge([{ name: "mcp__fs__read_multiple_files", input: { paths: [join(worktree, "a.js"), file] } }], worktree).verdict, "refuse");
    assert.equal(held("auto").judge([{ name: "mcp__fs__move_file", input: { source: join(worktree, "a.js"), destination: "../../../a.js" } }], worktree).verdict, "refuse");
    assert.equal(
      strayWords({ path: file, tool: "mcp__fs__write_file" }, worktree, folder),
      `Filament refused your call of mcp__fs__write_file: it names ${file}, which is the developer's folder, and you work in your own worktree, where your own changes are. The same path in your worktree is ${join(worktree, "amounts.js")} — name that one.`,
    );
    // Its worktree, a place past the developer's folder, the folder in a sentence, a URL and a path from where it runs:
    // judged as the same call of an agent held to nothing, and the turn hears nothing.
    told.length = 0;
    for (const input of [{ path: join(worktree, "amounts.js"), content: "x" }, { path: join(root, "elsewhere.txt") }, { body: `the total is wrong in ${file}, see its test` }, { url: "https://example.com/a/../b" }, { path: "src/amounts.js" }]) {
      const call = [{ name: "mcp__fs__write_file", input }];
      assert.deepEqual(held("auto").judge(call, worktree), at("auto").judge(call, worktree), JSON.stringify(input));
    }
    assert.deepEqual(told, []);
  });

  // (fails before: yes — the bug hunt of 10-30, PERM-3's relative paths: an MCP call's string was judged only as a full
  // path or a climb, so one that, read from where the call ran — the developer's folder — named a place there ran unasked)
  test("a worker held to its worktree: an MCP call's relative path is judged from where the call runs, as its own tools' are — run in its worktree it stays there; run in the developer's folder, the call asks", () => {
    const folder = join(root, "proj7");
    const worktree = join(folder, ".git", "filament-worktrees", "sa_1");
    mkdirSync(worktree, { recursive: true });
    /** @param {string} mode */
    const held = (mode) => createAgentPermits({ rules: [], modeNow: () => /** @type {any} */ (mode), learned: null, confine: worktree, folder });
    const write = [{ name: "mcp__fs__write_file", input: { path: "amounts.js", content: "x" } }];
    assert.equal(held("auto").judge(write, worktree).verdict, "run", "from its worktree, the path names a place in it");
    const j = held("auto").judge(write, folder);
    assert.deepEqual([j.verdict, j.question], ["ask", `May I call mcp__fs__write_file? It names "amounts.js", which read from the folder it runs in (${folder}) is in the developer's folder, outside the worktree this agent works in — answer /allow to run it, or say what to do instead.`]);
    assert.deepEqual(j.notes, [`mcp__fs__write_file names "amounts.js", which read from ${folder} is in the developer's folder (${folder}), outside the worktree it works in: whether it is a place there only its server knows, so it asks`]);
    assert.equal(held("auto").allowed(write, folder).verdict, "run", "the person's yes runs it");
    assert.equal(held("auto").judge([{ name: "mcp__fs__write_file", input: { path: "../../../amounts.js" } }], worktree).verdict, "refuse", "a climb out of the worktree stays the fence's refusal");
    assert.equal(held("auto").judge([{ name: "mcp__docs__fetch", input: { url: "https://example.com/a", limit: 5 } }], folder).verdict, "run", "an address and a number name no place");
  });

  // (fails before: yes — the bug hunt of 10-30: an MCP call was judged as a command whatever its agent said of it, so
  // read-only refused a tool its agent says only reads, and a held plan held it)
  test("an MCP tool's call its agent says only reads is judged as the loop judges one its server vouches for: it runs in every mode, under a held plan too; one that says nothing is a command, as before", () => {
    const reads = loopCalls({ name: "mcp__docs__search", kind: "read", title: "mcp__docs__search", rawInput: { query: "tabs" } }, "claude");
    const other = loopCalls({ name: "mcp__docs__search", kind: "other", title: "mcp__docs__search", rawInput: { query: "tabs" } }, "claude");
    assert.deepEqual([reads, other], [[{ name: "mcp__docs__search", input: { query: "tabs" }, reads: true }], [{ name: "mcp__docs__search", input: { query: "tabs" } }]]);
    /** @param {string} mode */
    const at = (mode) => createAgentPermits({ rules: [], modeNow: () => /** @type {any} */ (mode), learned: null });
    const modes = ["read-only", "edit", "ask", "auto"];
    assert.deepEqual(modes.map((m) => at(m).judge(/** @type {any} */ (reads), root).verdict), ["run", "run", "run", "run"]);
    assert.deepEqual(modes.map((m) => at(m).judge(/** @type {any} */ (other), root).verdict), ["refuse", "ask", "ask", "run"]);
    assert.equal(at("read-only").allowed(/** @type {any} */ (reads), root).verdict, "run", "a yes judged again under read-only stands");
    const plan = createAgentPermits({ rules: [], modeNow: () => "edit", learned: null, held: () => true, onHeld: () => {} });
    assert.deepEqual([plan.judge(/** @type {any} */ (reads), root).verdict, plan.judge(/** @type {any} */ (other), root).verdict], ["run", "refuse"], "a held plan's reads run");
    assert.equal(at("read-only").judge([{ name: "bash", input: { command: "touch x" }, reads: true }], root).verdict, "refuse", "a hand's call is judged by itself");
  });

  // (fails before: no — a guard the mutation pass asked for: no request of Claude's PowerShell, its sandbox's network
  // access, its Write, its web search or its Read was read as calls, nor another agent's plan)
  test("a request as the loop's calls: each of Claude's tools as the loop's hand for it, and any agent's plan as a plan", () => {
    assert.deepEqual(loopCalls({ name: "PowerShell", kind: "other", title: "List the files", rawInput: { command: "Get-ChildItem", description: "List the files" } }, "claude"), [{ name: "powershell", input: { command: "Get-ChildItem" } }]);
    assert.deepEqual(loopCalls({ name: "SandboxNetworkAccess", kind: "other", title: "api.github.com", rawInput: { host: "api.github.com" } }, "claude"), [{ name: "web_fetch", input: { url: "https://api.github.com" } }]);
    assert.deepEqual(loopCalls({ name: "Write", kind: "edit", title: "Write notes.md", rawInput: { file_path: "/p/notes.md", content: "x" }, locations: [{ path: "/p/notes.md" }] }, "claude"), [{ name: "write", input: { path: "/p/notes.md" } }]);
    assert.deepEqual(loopCalls({ name: "WebSearch", kind: "fetch", title: 'Search "acp spec"', rawInput: { query: "acp spec" } }, "claude"), [{ name: "web_search", input: { query: "acp spec" } }]);
    assert.deepEqual(loopCalls({ name: "Read", kind: "read", title: "Read notes.md", rawInput: { file_path: "/p/notes.md" }, locations: [{ path: "/p/notes.md" }] }, "claude"), [{ name: "read", input: { path: "/p/notes.md" } }]);
    // A search with the folder it searches, as the loop's grep and glob take it; with none, none.
    assert.deepEqual(loopCalls({ name: "Grep", kind: "search", title: "grep total", rawInput: { pattern: "total", path: "/p/src" } }, "claude"), [{ name: "grep", input: { pattern: "total", path: "/p/src" } }]);
    assert.deepEqual(loopCalls({ name: "Glob", kind: "search", title: "*.js", rawInput: { pattern: "*.js" } }, "claude"), [{ name: "glob", input: { pattern: "*.js" } }]);
    assert.equal(loopCalls({ kind: "switch_mode", title: "Ready to code?" }, "gemini"), "plan");
  });

  // (fails before: yes — the trial of 11-11 with Antigravity 1.4.5 signed in: its command came as `CommandLine`, with its
  // folder as `Cwd`, and ran in Windows PowerShell 5, but was judged as a bash command read off its card's title)
  test("Antigravity's command: its command line, judged by PowerShell's reader in its folder on Windows, as bash elsewhere", () => {
    const tc = { toolCallId: "c1", kind: "execute", status: "pending", title: "Get-Content notes.txt", rawInput: { CommandLine: "Get-Content notes.txt | Select-Object -First 3", Cwd: "C:\\w\\src", WaitMsBeforeAsync: 5000 } };
    assert.deepEqual(loopCalls(tc, "antigravity-acp", "win32"), [{ name: "powershell", input: { command: "Get-Content notes.txt | Select-Object -First 3", cwd: "C:\\w\\src" } }]);
    // (fails before: yes — off Windows its folder was dropped: the re-read of 11-11)
    assert.deepEqual(loopCalls({ ...tc, rawInput: { CommandLine: "ls -la", Cwd: "/w/src" } }, "antigravity-acp", "darwin"), [{ name: "bash", input: { command: "ls -la", cwd: "/w/src" } }]);
    assert.deepEqual(loopCalls({ ...tc, rawInput: { CommandLine: "ls -la" } }, "antigravity-acp", "linux"), [{ name: "bash", input: { command: "ls -la" } }], "no folder named: the agent's own");
    assert.deepEqual(loopCalls({ ...tc, rawInput: { CommandLine: "dir" } }, "antigravity-acp", "win32"), [{ name: "powershell", input: { command: "dir" } }], "no folder named: the agent's own");
    // Another agent's command, as before.
    assert.deepEqual(loopCalls({ kind: "execute", title: "`ls`", rawInput: { command: "ls" } }, "qoder", "win32"), [{ name: "bash", input: { command: "ls" } }]);
  });

  // (fails before: yes — Cursor and Gemini CLI name no tool on a call to an MCP server's tool: theirs to Filament's own
  // server were judged as the agent's own `other`, not Filament's hand, and another server's by no name of its own,
  // without its arguments)
  test("a call to an MCP server's tool, however the agent says it: Filament's own server's is its hand, another's is judged as itself", () => {
    /** Cursor's words for an MCP call it asks about: its arguments, fenced as JSON. @param {any} args */
    const fenced = (args) => [{ type: "content", content: { type: "text", text: "```json\n" + JSON.stringify(args, null, 2) + "\n```" } }];
    /** The tools Filament's own server listed at the session's address. */
    const own = new Set(["tasks", "filament_memory_search"]);
    assert.equal(loopCalls({ toolCallId: "c1", title: "filament-tasks: tasks", kind: "other", status: "pending", content: fenced({ add: ["a"] }) }, "cursor", process.platform, own), "hand");
    assert.deepEqual(loopCalls({ toolCallId: "c2", title: "github-list_issues: list_issues", kind: "other", status: "pending", content: fenced({ state: "open" }) }, "cursor"), [{ name: "mcp__github__list_issues", input: { state: "open" } }]);
    assert.deepEqual(loopCalls({ title: "my-docs-search-docs: search-docs", kind: "other", content: fenced({}) }, "cursor"), [{ name: "mcp__my-docs__search-docs", input: {} }], "names with dashes of their own");
    assert.equal(loopCalls({ title: "filament: tasks", kind: "other", rawInput: { providerIdentifier: "filament", toolName: "tasks", args: {} } }, "cursor", process.platform, own), "hand", "Cursor's input for it");
    assert.deepEqual(loopCalls({ title: "docs: search_docs", kind: "other", rawInput: { providerIdentifier: "docs", toolName: "search_docs", args: { query: "x" } } }, "cursor"), [{ name: "mcp__docs__search_docs", input: { query: "x" } }]);
    const words = (/** @type {string} */ text) => [{ type: "content", content: { type: "text", text } }];
    assert.equal(loopCalls({ title: "filament_memory_search (filament MCP Server)", kind: "other", content: words('{"query":"x"}') }, "gemini", process.platform, own), "hand");
    assert.deepEqual(loopCalls({ title: "list_issues (github MCP Server)", kind: "other", content: words('{"state":"open"}') }, "gemini"), [{ name: "mcp__github__list_issues", input: { state: "open" } }]);
    assert.deepEqual(loopCalls({ title: "list_issues (github MCP Server)", kind: "other", rawInput: { state: "closed" }, content: words('{"state":"open"}') }, "gemini"), [{ name: "mcp__github__list_issues", input: { state: "closed" } }], "the input the agent gives, before its words");
    assert.equal(loopCalls({ name: "mcp__filament__tasks", kind: "other", title: "mcp__filament__tasks", rawInput: {} }, "claude", process.platform, own), "hand");
    const pick = { providerIdentifier: "zai", toolName: "chat", effort: "high" };
    assert.deepEqual(loopCalls({ name: "mcp__models__pick", kind: "other", title: "mcp__models__pick", rawInput: pick }, "claude"), [{ name: "mcp__models__pick", input: pick }], "Claude's name for its call, whatever its arguments hold");
    assert.deepEqual(loopCalls({ title: "git log a-b: b", kind: "execute" }, "gemini"), [{ name: "bash", input: { command: "git log a-b: b" } }], "a title names an MCP call only on a call of no kind of its own");
  });

  // (fails before: yes — the trial of 11-11 through Filament with Antigravity 1.4.5 signed in: its call to Filament's
  // memory search was judged as its own `other` and asked the person, and another server's by no name of its own)
  test("Antigravity's call to an MCP server's tool, by its `_meta.mcp`: Filament's own server's is its hand, another's is judged as itself with its arguments", () => {
    /** Antigravity's call as it asks about it: server and tool run together in its title, its arguments twice. @param {string} server @param {string} tool @param {any} args */
    const agy = (server, tool, args) => ({ toolCallId: "c1", kind: "other", status: "pending", title: `${server}_${tool}`, content: [], rawInput: { arguments: args, ...args }, _meta: { mcp: { tool, server }, is_mcp_tool_call: true } });
    assert.equal(loopCalls(agy("filament", "filament_memory_search", { query: "antigravity trial" }), "antigravity-acp", process.platform, new Set(["filament_memory_search"])), "hand");
    assert.deepEqual(loopCalls(agy("my_probe", "echo_words", { text: "hi there" }), "antigravity-acp"), [{ name: "mcp__my_probe__echo_words", input: { text: "hi there" } }]);
    // Its own tools name no MCP server: judged as before.
    assert.deepEqual(loopCalls({ kind: "other", title: "generate_image", rawInput: { Prompt: "a cat" } }, "antigravity-acp"), [{ name: "mcp__antigravity-acp__other", input: { Prompt: "a cat" } }]);
    // The card names it so, from its first update (its last carries no `_meta`, and is known by its id).
    assert.deepEqual(mcpCallOf({ ...agy("my_probe", "echo_words", { text: "x" }), sessionUpdate: "tool_call_update", status: "in_progress" }, ""), { server: "my_probe", tool: "echo_words", input: { text: "x" } });
  });

  // (fails before: yes — read live on agy 1.5.14, signed in: its call to Filament's own tool carries no `_meta.mcp`,
  // only its name `mcp_filament_echo`, so it was judged as an unknown call of its own and the person asked)
  test("agy 1.5's call to an MCP server's tool, by its name: Filament's own is its hand, its toolSummary no argument, a server's name with `_` found among the session's", () => {
    /** The question agy 1.5.14 asks before the tool runs, as read live. @param {string} joined @param {any} args */
    const agy = (joined, args) => ({ sessionUpdate: "tool_call", toolCallId: "call_7279242881347837135", name: `mcp_${joined}`, args: { ...args, toolSummary: "Echo ping text" }, status: "pending", kind: "other", title: `Run mcp_${joined}`, rawInput: { ...args, toolSummary: "Echo ping text" } });
    const own = new Set(["echo", "filament_memory_search"]);
    assert.equal(loopCalls(agy("filament_echo", { text: "ping" }), "antigravity-acp", "win32", own, ["filament"]), "hand");
    assert.equal(loopCalls(agy("filament_filament_memory_search", { query: "x" }), "antigravity-acp", "win32", own), "hand", "Filament's own server where the session names none");
    assert.deepEqual(loopCalls(agy("filament_delete_tree", { path: "/" }), "antigravity-acp", "win32", own, ["filament"]), [{ name: "mcp__filament__delete_tree", input: { path: "/" } }], "a tool its server never listed");
    assert.deepEqual(loopCalls(agy("my_probe_echo_words", { text: "hi" }), "antigravity-acp", "linux", own, ["filament", "my_probe", "my"]), [{ name: "mcp__my_probe__echo_words", input: { text: "hi" } }], "the longest of the session's servers it begins with");
    assert.deepEqual(loopCalls(agy("my_docs_search", { q: "x" }), "antigravity-acp", "linux", own, ["my.docs"]), [{ name: "mcp__my.docs__search", input: { q: "x" } }], "a server's name as agy writes it");
    assert.deepEqual(loopCalls(agy("github_list_issues", {}), "antigravity-acp", "linux", own, ["filament"]), [{ name: "mcp__github__list_issues", input: {} }], "a server the session never named: up to its first `_`");
    // Its card names it so on every update, its title alone where the update carries no name.
    assert.deepEqual(mcpCallOf({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed", kind: "other", title: "Run mcp_filament_echo", rawInput: { text: "ping", toolSummary: "Echo ping text" } }, "", ["filament"]), { server: "filament", tool: "echo", input: { text: "ping" } });
    // Its own tools, and a call of a kind of its own, are none.
    assert.equal(mcpCallOf({ name: "run_command", kind: "execute", title: "ping -n 10 127.0.0.1", rawInput: { CommandLine: "ping -n 10 127.0.0.1", toolSummary: "Ping" } }, ""), null);
    assert.equal(mcpCallOf({ name: "mcp_filament_echo", kind: "execute", title: "Run mcp_filament_echo", rawInput: {} }, ""), null);
    assert.equal(mcpCallOf({ name: "mcp_filament", kind: "other", title: "Run mcp_filament", rawInput: {} }, "", ["filament"]), null, "a server's name with no tool after it");
    // A question titled so but naming no call is no one's MCP call: another agent's is never taken for Filament's own.
    assert.deepEqual(loopCalls({ toolCallId: "c9", kind: "other", status: "pending", title: "Run mcp_filament_echo", rawInput: { text: "x" } }, "claude", "linux", own, ["filament"]), [{ name: "mcp__claude__other", input: { text: "x" } }]);
  });

  // (fails before: yes — the re-read of 11-11: Filament's own hand was known by its server's name alone, so any server
  // named "filament" in the agent's own config — a repository's — had its tools taken for Filament's, unjudged)
  test("Filament's own hand is a tool its own server listed at the session's address; one of a server that only goes by its name is judged as itself", () => {
    const own = new Set(["tasks", "filament_memory_search"]);
    const claude = (/** @type {string} */ tool, /** @type {any} */ input) => ({ name: `mcp__filament__${tool}`, kind: "other", title: `mcp__filament__${tool}`, rawInput: input });
    assert.equal(loopCalls(claude("tasks", {}), "claude", "linux", own), "hand");
    assert.deepEqual(loopCalls(claude("bash", { command: "rm -rf ~" }), "claude", "linux", own), [{ name: "mcp__filament__bash", input: { command: "rm -rf ~" } }], "a tool its server never listed");
    assert.deepEqual(loopCalls(claude("tasks", {}), "claude", "linux", null), [{ name: "mcp__filament__tasks", input: {} }], "a session that listed nothing of Filament's");
    assert.deepEqual(loopCalls(claude("tasks", {}), "claude"), [{ name: "mcp__filament__tasks", input: {} }], "nothing said of it");
    /** Antigravity's, by its `_meta.mcp`, only allow-always offered as it may be. @param {string} tool */
    const agy = (tool) => ({ kind: "other", title: `filament_${tool}`, rawInput: { arguments: { path: "/" } }, _meta: { mcp: { tool, server: "filament" }, is_mcp_tool_call: true } });
    assert.equal(loopCalls(agy("filament_memory_search"), "antigravity-acp", "win32", own), "hand");
    assert.deepEqual(loopCalls(agy("delete_tree"), "antigravity-acp", "win32", own), [{ name: "mcp__filament__delete_tree", input: { path: "/" } }]);
  });

  // (fails before: no — a guard the mutation pass asked for: no call the agent named itself had a title of an MCP
  // call's shape, and none to an MCP server's tool said no arguments)
  test("an agent's own name for its tool stands before any title; an MCP call that says no arguments takes none", () => {
    assert.deepEqual(loopCalls({ name: "Skill", kind: "other", title: "build-cache: cache", rawInput: { skill: "cache" } }, "claude"), [{ name: "mcp__claude__Skill", input: { skill: "cache" } }]);
    assert.deepEqual(loopCalls({ name: "mcp__docs__list", kind: "other", title: "mcp__docs__list" }, "claude"), [{ name: "mcp__docs__list", input: {} }]);
  });

  // (fails before: no — a guard the mutation pass asked for: no request offered both of the agent's refusals)
  test("the agent's own option: its allow-once for a run, never its always; its reject-once before its reject-always", () => {
    const options = [{ optionId: "aa", kind: "allow_always" }, { optionId: "a", kind: "allow_once" }, { optionId: "ra", kind: "reject_always" }, { optionId: "r", kind: "reject_once" }];
    assert.equal(optionFor(options, true)?.optionId, "a");
    assert.equal(optionFor(options, false)?.optionId, "r");
    assert.equal(optionFor(options.slice(0, 3), false)?.optionId, "ra", "where it offers no reject-once");
  });

  // (fails before: no — a guard the mutation pass asked for: no request of several files had one refused, no card
  // asked for a rule or gave a command's reason, and no yes met a deny rule or read-only come since)
  test("the strictest call speaks for the request; a card says what asks and why; a yes is judged again", () => {
    const files = [{ name: "edit", input: { path: "a.md" } }, { name: "edit", input: { path: "secret.env" } }];
    const refused = at("auto", [{ tool: "edit", pattern: "*.env", verdict: "deny" }]).judge(files, root);
    assert.deepEqual([refused.verdict, refused.how], ["refuse", "refused by the rule edit(*.env) deny"], "one file refused refuses the request");
    const ruled = at("auto", [{ tool: "bash", pattern: "npm *", verdict: "ask" }]).judge([{ name: "bash", input: { command: "npm publish" } }], root);
    assert.deepEqual([ruled.verdict, ruled.how], ["ask", "asked: the rule bash(npm *) ask asks first"]);
    const unread = /** @type {any} */ (at("ask").judge([{ name: "bash", input: { command: "cat a.txt > b.txt" } }], root));
    assert.deepEqual([unread.verdict, unread.how, unread.command], ["ask", "asked (ask mode)", "cat a.txt > b.txt"]);
    assert.match(unread.reason, /^Filament cannot tell that it only reads inside the working folder: output into a file/);
    const rm = [{ name: "bash", input: { command: "rm -rf build" } }];
    const denied = at("auto", [{ tool: "bash", pattern: "rm *", verdict: "deny" }]).allowed(rm, root);
    assert.deepEqual([denied.verdict, denied.how], ["refuse", "the person said yes, but the rule bash(rm *) deny refuses it now"]);
    const readOnly = at("read-only").allowed(rm, root);
    assert.deepEqual([readOnly.verdict, readOnly.how], ["refuse", "the person said yes, but this session is read-only now"]);
    assert.equal(at("read-only").allowed([{ name: "bash", input: { command: "ls" } }], root).verdict, "run", "a yes to a command that only reads stands");
  });

  // (fails before: yes — each of a request's calls counted as a yes of its own: five edits of .js files in one request
  // reached the always-allow's threshold on a single approval)
  test("one yes counts once for each shape it covers, however many of the request's calls share it", () => {
    /** @type {string[]} */
    const recorded = [];
    const learned = { allowed: () => false, offered: () => null, recordAllow: (/** @type {string} */ name, /** @type {any} */ input) => void recorded.push(String(permissionShape(name, input)?.text)) };
    const edits = ["a.js", "b.js", "c.js", "notes.md", "d.js"].map((path) => ({ name: "edit", input: { path } }));
    const tests = ["npm test", "npm test -- --watch"].map((command) => ({ name: "bash", input: { command } }));
    const yes = createAgentPermits({ rules: [], modeNow: () => /** @type {any} */ ("edit"), learned }).allowed([...edits, ...tests], root);
    assert.equal(yes.verdict, "run");
    assert.deepEqual(recorded, ["edit: *.js", "edit: *.md", "bash: npm test"]);
  });
});

// (fails before: yes — the swarm's review of 11-10: the gate runs every read, so a coding agent's Read past its folder,
// which it asks of the switch, ran in another machine's agents' chat without Full control: Claude Code read ~/.ssh there)
test("another machine's agents' chat without Full control: a coding agent's read or search past its folder, or into a credentials folder, is refused; in it, it runs; the person's own chat, and Auto, as before", () => {
  const base = mkdtempSync(join(tmpdir(), "filament-read-past-"));
  const root = join(base, "project");
  const added = join(base, "shared");
  for (const d of [join(root, "src"), join(root, ".ssh"), added, join(base, "home", ".ssh")]) mkdirSync(d, { recursive: true });
  try {
    const key = join(base, "home", ".ssh", "id_rsa");
    const theirs = (/** @type {any} */ mode = "edit") => createAgentPermits({ rules: [], modeNow: () => mode, learned: null, agentsDevice: true, reads: [added] });
    for (const call of [
      { name: "read", input: { path: key } },
      { name: "read", input: { path: "../home/.ssh/id_rsa" } },
      { name: "grep", input: { pattern: "BEGIN", path: join(base, "home") } },
      { name: "glob", input: { pattern: join(base, "home", ".ssh", "*") } },
    ]) {
      const v = theirs().judge([call], root);
      assert.equal(v.verdict, "refuse", JSON.stringify(call));
      assert.match(String(v.why), /outside the folder this chat of another machine's agents works in/);
    }
    const inCred = theirs().judge([{ name: "read", input: { path: ".ssh/id_rsa" } }], root);
    assert.equal(inCred.verdict, "refuse");
    assert.match(String(inCred.why), /in a credentials folder \(\.ssh\)/);
    assert.equal(theirs().judge([{ name: "read", input: { path: "src/a.js" } }], root).verdict, "run");
    assert.equal(theirs().judge([{ name: "read", input: { path: join(added, "notes.md") } }], root).verdict, "run", "a folder added to it");
    assert.equal(theirs("auto").judge([{ name: "read", input: { path: key } }], root).verdict, "run", "Auto: their device runs without asking, as the person's");
    assert.equal(createAgentPermits({ rules: [], modeNow: () => /** @type {const} */ ("edit"), learned: null }).judge([{ name: "read", input: { path: key } }], root).verdict, "run", "the person's own chat");
  } finally {
    removeDirs(base);
  }
});
