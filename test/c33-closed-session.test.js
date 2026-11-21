// @ts-check
// HarnessV4_Tasks C33 step 2, an agent's own ways when its session is closed. The card offers two ways that are the
// agent's own — it compacts its own session, or writes the summary from it — and both needed the session open in a
// live agent process: after a restart of Filament, or once an idle agent was let go, they read "Not open now". The
// chat's record keeps what its session was opened with, so a way of the agent's own opens it again first, with the
// same, and the page says so ("Opens its session first").
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURES, FAKE_ACP_AGENT } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { CodexBridge } from "../src/adapters/agents/codex/bridge.js";
import { COMPACTION_HEADER } from "../src/adapters/agents/compactions.js";
import { askChoices, NOT_OFFERED } from "../src/ui/harness/widgets/compaction.js";

const quiet = () => {};
const CODEX = join(FIXTURES, "fake-codex-app-server.mjs");
/** JSON lines of a file, oldest first. @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
/** A harness turn's request: the person's words, naming the chat's newest compaction. @param {string} text @param {number} base */
const asked = (text, base) => ({ format: "anthropic", body: { model: "m", max_tokens: 100, messages: [{ role: "user", content: text }] }, headers: { [COMPACTION_HEADER]: String(base) }, onEvent: () => {} });

let dir = "";
before(() => {
  dir = mkdtempSync(join(tmpdir(), "filament-c33-closed-"));
});
after(async () => {
  await removeDirs(dir);
});

describe("the page's words", () => {
  const plan = { native: true, methods: { summary: { possible: true, after: 9000, exact: false } }, agent: { own: "fork", self: "fork", opens: true, warmUntil: Date.now() + 60_000, held: 120_000 } };
  // (fails before: yes — nothing said a way would open the session first: it was not offered at all)
  test("a way that opens the session first says so; one not offered says why on its row", () => {
    const rows = askChoices({ plan, agent: true, agentName: "Claude Code", now: Date.now() });
    assert.deepEqual(rows.slice(0, 2).map((r) => [r.sub, r.disabled]), [
      ["Opens its session first · forked first, so Undo brings its session back", false],
      ["Opens its session first · in a fork, read-only", false],
    ]);
    const live = askChoices({ plan: { ...plan, agent: { ...plan.agent, opens: false, own: "session" } }, agent: true, agentName: "Claude Code", now: Date.now() });
    assert.equal(live[0].sub, "In its live session");
    const none = askChoices({ plan: { ...plan, agent: { ...plan.agent, own: null, self: null, opens: false } }, agent: true, agentName: "Claude Code", now: Date.now() });
    assert.deepEqual(none.slice(0, 2).map((r) => [r.sub, r.disabled]), [[NOT_OFFERED.own, true], [NOT_OFFERED.self, true]]);
    assert.match(NOT_OFFERED.own, /^Not offered: /);
  });
});

describe("an ACP agent (Claude Code's adapter)", () => {
  const state = () => join(dir, "acp-sessions.json");
  const up = {
    id: "own",
    name: "own",
    type: "acp",
    acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(dir, "own-calls.jsonl"), FAKE_ACP_LOG: join(dir, "own-prompts.jsonl"), FAKE_ACP_CLAUDE: "1", FAKE_ACP_OWN_COMPACT: "1", FAKE_ACP_SESSION_CAPS: "resume,close,fork,delete" }, cwdDefault: dir, permissions: "allow-all" },
  };
  const calls = () => lines(join(dir, "own-calls.jsonl"));
  const where = { upstream: up, conversationId: "chat", base: 0 };

  // (fails before: yes — `compacts` and `summarizes` answered null with no live process, and `compactOwn` threw
  // "holds no open session of this chat to compact")
  test("after a restart its compaction and its summary are offered; asked for, the session is opened again with what it was opened with, then compacted", async () => {
    const first = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile: state() }));
    let sid = "";
    try {
      await first.run({ upstream: up, modelId: "fake-a", conversationId: "chat", ...asked("one", 0) });
      const two = await first.run({ upstream: up, modelId: "fake-a", conversationId: "chat", ...asked("two", 0) });
      sid = two.sessionId;
      await until(() => first.commandsOf(up.id, sid).length, "the agent's commands");
      assert.deepEqual([first.compacts(where), first.summarizes(where), first.closed(where)], ["fork", "fork", false], "open in its process: nothing to open first");
      first.convs.flush();
    } finally {
      await first.shutdown();
    }
    const kept = JSON.parse(readFileSync(state(), "utf8")).conversations;
    const rec = /** @type {any} */ (Object.values(kept)[0]);
    assert.deepEqual(rec.opened.can, { fork: true, reopen: true, reportsCompaction: true });
    assert.equal(rec.opened.modelId, "fake-a");

    const second = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile: state() }));
    try {
      assert.deepEqual([second.compacts(where), second.summarizes(where), second.closed(where)], ["fork", "fork", true], "no process holds it: offered, opened first");
      assert.equal(second.closed({ ...where, base: 3 }), false, "a chat compacted since leaves the session: nothing to open");
      const opensBefore = calls().filter((c) => c.method === "session/resume" && c.sessionId === sid).length;
      const facts = await second.compactOwn({ ...where, keep: "the plan", fork: true, record: () => 7 });
      assert.equal(facts.forked, true);
      assert.equal(facts.tokensBefore, 120_000);
      const resumes = calls().filter((c) => c.method === "session/resume" && c.sessionId === sid);
      assert.equal(resumes.length, opensBefore + 1, "opened again, once");
      const order = calls().filter((c) => c.sessionId === sid || c.from === sid).map((c) => c.method);
      assert.ok(order.lastIndexOf("session/resume") < order.lastIndexOf("own compact"), `opened before it was asked to compact: ${order.join(", ")}`);
      assert.deepEqual(calls().filter((c) => c.method === "own compact").at(-1)?.told, "the plan");
      assert.equal(second.closed({ ...where, base: 7 }), false, "a process holds it now");
      assert.equal(second.compacts({ ...where, base: 7 }), "fork");
    } finally {
      await second.shutdown();
    }
  });

  // (fails before: yes — the bug hunt of 10-30: the session map kept the token of Filament's MCP address, the session's
  // capability, in plain text: as a field of its own and in the address the session was opened with)
  test("the session map on disk holds no token of Filament's MCP address; after a restart a way of the agent's own opens the session with a new one, which its next turn goes on at", async () => {
    const tok = { ...up, id: "tok", name: "tok", acp: { ...up.acp, env: { ...up.acp.env, FAKE_ACP_CALLS: join(dir, "tok-calls.jsonl"), FAKE_ACP_LOG: join(dir, "tok-prompts.jsonl") } } };
    const file = join(dir, "acp-tok.json");
    const at = { upstream: tok, conversationId: "chat", base: 0 };
    const mcpBase = "http://127.0.0.1:9";
    /** A harness turn whose session takes the task graph's tool, so Filament's MCP server, at `mcpBase`. @param {AcpBridge} b @param {string} text @param {number} base */
    const turn = (b, text, base) => b.run({ upstream: tok, modelId: "fake-a", conversationId: "chat", mcpBase, toolsAt: { chain: "ch_tok", turn: "t", graph: true }, ...asked(text, base) });
    const opens = () => lines(join(dir, "tok-calls.jsonl")).filter((c) => /^session\/(new|load|resume)$/.test(c.method));
    const first = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile: file }));
    let token = "";
    try {
      await turn(first, "one", 0);
      await turn(first, "two", 0);
      token = String(/** @type {any} */ ([...first.convs.values()][0]).mcpToken || "");
      assert.match(token, /^[0-9a-f]{24}$/, "the session was given Filament's server");
      assert.equal(opens().at(-1)?.mcpUrl, `${mcpBase}/mcp/${token}`);
      first.convs.flush();
    } finally {
      await first.shutdown();
    }
    const text = readFileSync(file, "utf8");
    assert.ok(!text.includes(token), "no token on disk");
    const rec = /** @type {any} */ (Object.values(JSON.parse(text).conversations)[0]);
    assert.deepEqual([rec.mcpToken, rec.opened.mcpServers.map((/** @type {any} */ s) => s.url)], [undefined, [`${mcpBase}/mcp/`]], "Filament's server kept by its address alone");

    const second = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile: file }));
    try {
      await second.compactOwn({ ...at, keep: "", fork: true, record: () => 7 });
      const again = /\/mcp\/([0-9a-f]{24})$/.exec(String(opens().at(-1)?.mcpUrl))?.[1] || "";
      assert.ok(again && again !== token, "opened again with a new token");
      assert.equal(second.contextForMcpToken(again)?.conv?.sessionId, rec.sessionId, "which stands for the chat's session");
      assert.equal(second.contextForMcpToken(token), null, "and the old one for nothing");
      const before = opens().length;
      await turn(second, "three", 7);
      assert.equal(opens().length, before, "the next turn goes on in the session as it was opened");
      assert.equal(/** @type {any} */ ([...second.convs.values()][0]).mcpToken, again, "at that address");
    } finally {
      await second.shutdown();
    }
  });

  // (fails before: yes — the review of 11-08: the way of the agent's own opened the session with the options its record
  // kept, and the next turn found it open in its process with no switch moved, so it went on without the attribution
  // setting until some tool flipped)
  test("a session a Filament before this one opened, compacted by its agent after a restart: the next turn opens it again with the options it takes now", async () => {
    const old = { ...up, id: "old", name: "old", acp: { ...up.acp, env: { ...up.acp.env, FAKE_ACP_CALLS: join(dir, "old-calls.jsonl"), FAKE_ACP_LOG: join(dir, "old-prompts.jsonl") } } };
    const file = join(dir, "acp-old.json");
    const at = { upstream: old, conversationId: "chat", base: 0 };
    /** @param {AcpBridge} b @param {string} text @param {number} base */
    const turn = (b, text, base) => b.run({ upstream: old, modelId: "fake-a", conversationId: "chat", ...asked(text, base) });
    const opens = () => lines(join(dir, "old-calls.jsonl")).filter((c) => /^session\/(new|load|resume)$/.test(c.method));
    const first = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile: file }));
    try {
      await turn(first, "one", 0);
      await turn(first, "two", 0);
      assert.deepEqual(opens().at(-1)?.settings?.attribution, { commit: "", pr: "" }, "this Filament hides its attribution");
      first.convs.flush();
    } finally {
      await first.shutdown();
    }
    // The record as an older Filament left it: the session opened with no options of Claude Code's.
    const kept = JSON.parse(readFileSync(file, "utf8"));
    const rec = /** @type {any} */ (Object.values(kept.conversations)[0]);
    delete rec.opened.sessionMeta._meta.claudeCode.options;
    writeFileSync(file, JSON.stringify(kept));

    const second = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile: file }));
    try {
      await second.compactOwn({ ...at, keep: "", fork: true, record: () => 7 });
      assert.equal(opens().at(-1)?.settings, undefined, "its agent's compaction opens it as its record kept");
      const before = opens().length;
      const done = await turn(second, "three", 7);
      assert.equal(opens().length, before + 1, "opened again, once");
      assert.deepEqual(opens().at(-1)?.settings?.attribution, { commit: "", pr: "" }, "with the options it takes now");
      assert.ok((done.notes || []).some((/** @type {string} */ n) => /what old is opened with changed since this session opened/.test(n)), `said in the record: ${JSON.stringify(done.notes)}`);
      const after = opens().length;
      await turn(second, "four", 7);
      assert.equal(opens().length, after, "and the turn after goes on in it");
    } finally {
      await second.shutdown();
    }
  });

  // (fails before: yes — the bug hunt of 10-30, noticed: the session map wrote its upstream's own MCP servers whole, the
  // secret in a server's env in plain text, where config.json seals it)
  test("the session map on disk holds none of its upstream's own MCP servers, whose env may carry a secret; after a restart a way of the agent's own opens the session with them again, from the configuration", async () => {
    const keys = { name: "keys", command: process.execPath, args: ["-e", "0"], env: { API_TOKEN: "s3cret-api-token-1234" } };
    const own = { ...up, id: "keys", name: "keys", acp: { ...up.acp, mcpServers: [keys], env: { ...up.acp.env, FAKE_ACP_CALLS: join(dir, "keys-calls.jsonl"), FAKE_ACP_LOG: join(dir, "keys-prompts.jsonl") } } };
    const file = join(dir, "acp-keys.json");
    const opens = () => lines(join(dir, "keys-calls.jsonl")).filter((c) => /^session\/(new|load|resume)$/.test(c.method));
    const first = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile: file }));
    try {
      await first.run({ upstream: own, modelId: "fake-a", conversationId: "chat", ...asked("one", 0) });
      await first.run({ upstream: own, modelId: "fake-a", conversationId: "chat", ...asked("two", 0) });
      assert.deepEqual(opens().at(-1)?.servers, ["keys:stdio"], "the session opened with its upstream's server");
      first.convs.flush();
    } finally {
      await first.shutdown();
    }
    const text = readFileSync(file, "utf8");
    assert.ok(!text.includes("s3cret-api-token-1234"), "no secret on disk");
    const rec = /** @type {any} */ (Object.values(JSON.parse(text).conversations)[0]);
    assert.deepEqual(rec.opened.mcpServers, [], "nor the server it rides in");
    const second = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile: file }));
    try {
      await second.compactOwn({ upstream: own, conversationId: "chat", base: 0, keep: "", fork: true, record: () => 7 });
      assert.deepEqual([opens().at(-1)?.method, opens().at(-1)?.servers], ["session/resume", ["keys:stdio"]], "opened again with it, from the configuration");
      const held = /** @type {any} */ ([...second.convs.values()][0]).opened.mcpServers.find((/** @type {any} */ s) => s.name === "keys");
      assert.deepEqual(held?.env, [{ name: "API_TOKEN", value: "s3cret-api-token-1234" }], "its env whole, in memory");
    } finally {
      await second.shutdown();
    }
  });

  test("a session its agent no longer has: asked to compact, it fails in the agent's words and nothing is recorded", async () => {
    const gone = { ...up, id: "gone", name: "gone", acp: { ...up.acp, env: { ...up.acp.env, FAKE_ACP_CALLS: join(dir, "gone-calls.jsonl"), FAKE_ACP_LOG: join(dir, "gone-prompts.jsonl") } } };
    const file = join(dir, "acp-gone.json");
    const at = { upstream: gone, conversationId: "chat", base: 0 };
    const first = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile: file }));
    try {
      await first.run({ upstream: gone, modelId: "fake-a", conversationId: "chat", ...asked("one", 0) });
      const two = await first.run({ upstream: gone, modelId: "fake-a", conversationId: "chat", ...asked("two", 0) });
      await until(() => first.commandsOf(gone.id, two.sessionId).length, "the agent's commands");
      first.convs.flush();
    } finally {
      await first.shutdown();
    }
    const lost = { ...gone, acp: { ...gone.acp, env: { ...gone.acp.env, FAKE_ACP_RESUME_FAIL: "1" } } };
    const second = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile: file }));
    try {
      assert.equal(second.closed({ ...at, upstream: lost }), true);
      let recorded = 0;
      await assert.rejects(second.compactOwn({ ...at, upstream: lost, keep: "", fork: true, record: () => ++recorded }), /Internal error|session/i);
      assert.equal(recorded, 0);
    } finally {
      await second.shutdown();
    }
  });
});

describe("Codex", () => {
  const state = () => join(dir, "codex-sessions.json");
  const up = { id: "cx", name: "cx", type: "codex", acp: { command: process.execPath, args: [CODEX], env: { FAKE_CODEX_CALLS: join(dir, "cx.jsonl") }, cwdDefault: dir, permissions: "allow-all" } };
  /** What the fake heard, by method. @param {string} method */
  const heard = (method) => lines(join(dir, "cx.jsonl")).filter((m) => m.method === method);
  const where = { upstream: up, conversationId: "chat", base: 0 };

  // (fails before: yes — with no app-server holding the thread its own ways answered null)
  test("after a restart its compaction is offered; asked for, the thread is resumed with what it was opened with, then compacted", async () => {
    const first = new CodexBridge({ log: quiet, stateFile: state() });
    let tid = "";
    try {
      await first.run({ upstream: up, modelId: "gpt-6-astra", conversationId: "chat", ...asked("one", 0) });
      const two = await first.run({ upstream: up, modelId: "gpt-6-astra", conversationId: "chat", ...asked("two", 0) });
      tid = two.sessionId;
      assert.deepEqual([first.compacts(where), first.summarizes(where), first.closed(where)], ["fork", "fork", false]);
    } finally {
      await first.shutdown();
    }
    const second = new CodexBridge({ log: quiet, stateFile: state() });
    try {
      assert.deepEqual([second.compacts(where), second.summarizes(where), second.closed(where)], ["fork", "fork", true]);
      const resumedBefore = heard("thread/resume").length;
      const facts = await second.compactOwn({ ...where, keep: "", fork: true, record: () => 5 });
      assert.equal(facts.forked, true);
      const resumed = heard("thread/resume");
      assert.equal(resumed.length, resumedBefore + 1);
      assert.equal(resumed.at(-1).params.threadId, tid);
      assert.equal(heard("thread/compact/start").at(-1).params.threadId, tid);
      assert.equal(second.closed({ ...where, base: 5 }), false, "the app-server holds it now");
    } finally {
      await second.shutdown();
    }
  });

  // (fails before: yes — the bug hunt of 10-30: the thread map kept the token of Filament's MCP address in plain text,
  // as a field of its own and in the config the thread was opened with)
  test("the thread map on disk holds no token of Filament's MCP address; after a restart the thread is resumed with a new one, which stands for it", async () => {
    const file = join(dir, "codex-tok.json");
    const tok = { ...up, id: "cx-tok", name: "cx-tok" };
    const at = { upstream: tok, conversationId: "tok", base: 0 };
    const mcpBase = "http://127.0.0.1:9";
    /** @param {CodexBridge} b @param {string} text @param {number} base */
    const turn = (b, text, base) => b.run({ upstream: tok, modelId: "gpt-6-astra", conversationId: "tok", mcpBase, toolsAt: { chain: "ch_tok", turn: "t", graph: true }, ...asked(text, base) });
    /** Filament's server's address the newest open of `method` gave. @param {string} method */
    const own = (method) => String(heard(method).at(-1)?.params?.config?.["mcp_servers.filament"]?.url || "");
    const first = new CodexBridge({ log: quiet, stateFile: file });
    let token = "";
    try {
      await turn(first, "one", 0);
      await turn(first, "two", 0);
      token = String(/** @type {any} */ ([...first.convs.values()].find((c) => c.upstreamId === "cx-tok"))?.mcpToken || "");
      assert.match(token, /^[0-9a-f]{24}$/);
      assert.equal(own("thread/start"), `${mcpBase}/mcp/${token}`);
    } finally {
      await first.shutdown();
    }
    const text = readFileSync(file, "utf8");
    assert.ok(!text.includes(token), "no token on disk");
    const rec = /** @type {any} */ (Object.values(JSON.parse(text).conversations).find((c) => /** @type {any} */ (c).upstreamId === "cx-tok"));
    assert.deepEqual([rec.mcpToken, rec.opened.config["mcp_servers.filament"].url], [undefined, `${mcpBase}/mcp/`]);
    const second = new CodexBridge({ log: quiet, stateFile: file });
    try {
      await second.compactOwn({ ...at, keep: "", fork: true, record: () => 5 });
      const again = /\/mcp\/([0-9a-f]{24})$/.exec(own("thread/resume"))?.[1] || "";
      assert.ok(again && again !== token, "resumed with a new token");
      assert.equal(second.contextForMcpToken(again)?.conv?.sessionId, rec.sessionId);
      assert.equal(second.contextForMcpToken(token), null);
    } finally {
      await second.shutdown();
    }
  });

  // (fails before: yes — the bug hunt of 10-30, noticed: the thread map wrote its upstream's own MCP servers whole in
  // the config it was opened with, the secret in a server's env in plain text)
  test("the thread map on disk holds none of its upstream's own MCP servers; after a restart the thread is resumed with them again, from the configuration", async () => {
    const file = join(dir, "codex-keys.json");
    const keys = { name: "keys", command: process.execPath, args: ["-e", "0"], env: { API_TOKEN: "s3cret-api-token-5678" } };
    const own = { ...up, id: "cx-keys", name: "cx-keys", acp: { ...up.acp, mcpServers: [keys] } };
    const at = { upstream: own, conversationId: "keys", base: 0 };
    /** The newest open's config: the servers it was given. @param {string} method */
    const config = (method) => heard(method).at(-1)?.params?.config || {};
    const first = new CodexBridge({ log: quiet, stateFile: file });
    try {
      await first.run({ upstream: own, modelId: "gpt-6-astra", conversationId: "keys", ...asked("one", 0) });
      await first.run({ upstream: own, modelId: "gpt-6-astra", conversationId: "keys", ...asked("two", 0) });
      assert.equal(config("thread/start")["mcp_servers.keys"]?.env?.API_TOKEN, "s3cret-api-token-5678", "the thread opened with its upstream's server");
    } finally {
      await first.shutdown();
    }
    const text = readFileSync(file, "utf8");
    assert.ok(!text.includes("s3cret-api-token-5678"), "no secret on disk");
    const rec = /** @type {any} */ (Object.values(JSON.parse(text).conversations).find((c) => /** @type {any} */ (c).upstreamId === "cx-keys"));
    assert.deepEqual(Object.keys(rec.opened.config || {}), [], "nor the server it rides in");
    const second = new CodexBridge({ log: quiet, stateFile: file });
    try {
      await second.compactOwn({ ...at, keep: "", fork: true, record: () => 5 });
      assert.deepEqual(config("thread/resume")["mcp_servers.keys"], { command: process.execPath, args: ["-e", "0"], env: { API_TOKEN: "s3cret-api-token-5678" } }, "resumed with it again, from the configuration");
    } finally {
      await second.shutdown();
    }
  });
});
