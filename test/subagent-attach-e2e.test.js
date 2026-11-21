// @ts-check
// `attach` end to end (the owner's of 11-17: a picture the person sent reached no sub-agent): in a chat on Filament's
// loop and in one on a coding agent, the main agent's agent call hands its sub-agent the person's pictures as
// `picture N` — their message's first, then those sent into the turn while it worked — and a file of its folder by its
// path, each in the sub-agent's first message after its brief. Against a scripted upstream and the fake coding agent.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { PROMPT } from "../src/app/agent/prompt.js";

/** Three tiny pictures, told apart by their bytes. */
const P1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const P2 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const P3 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQOODwHwAERAIgypllwgAAAABJRU5ErkJggg==";
const image = (/** @type {string} */ data) => ({ type: "image", source: { type: "base64", media_type: "image/png", data } });
const sysOf = (/** @type {any} */ b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
/** Whether a request is a Filament sub-agent's. @param {any} b */
const isSub = (b) => sysOf(b).includes(String(PROMPT.subagentRole));
const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
/** A message's blocks without the cache marker a request's newest block carries. @param {any[]} blocks */
const unmarked = (blocks) => blocks.map(({ cache_control, ...b }) => b);

describe("attach on Filament's loop", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  const configure = (/** @type {any} */ cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.memory.autopilot = { enabled: false };
    cfg.memory.capture = { turns: true, learn: false };
    cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-attach-loop-"));
    writeFileSync(join(root, "a.txt"), "the parser trips on an empty file\n");
    up = await fakeUpstream(async (call) => brain(call));
    // Kept across a stop: a test starts Filament again on the same data, as after a restart.
    shim = await startApp({ memory: true, configure, keep: true });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, root]) rmSync(dir, { recursive: true, force: true });
  });

  // (fails before: yes — no picture of the person's reached a sub-agent, and attach was no field of the agent tool)
  test("picture 1 from the person's message, picture 2 sent while it worked, and a file: the sub-agent's first message carries them after its brief, in the order named; the call's answer says what went", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    const id = String((await r.json()).id);
    /** @type {any} */
    const saw = {};
    let main = 0;
    brain = async (call) => {
      const say = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 9, output_tokens: 3 } });
      if (call.kind !== "anthropic") return undefined;
      if (isSub(call.body)) {
        saw.sub = call.body.messages.at(-1).content;
        return say([{ type: "text", text: "SUB: two pictures and a file." }]);
      }
      main++;
      if (main === 1) {
        const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
        const live = runs.find((/** @type {any} */ x) => x.status === "running");
        await shim.api(`/api/runs/${live?.id}/steer`, { method: "POST", body: { kind: "note", from: "harness", text: "and this one", images: [{ name: "two.png", mediaType: "image/png", data: P2 }] } });
        return say([toolUse("r1", "read", { path: "a.txt" })], "tool_use");
      }
      if (main === 2) return say([toolUse("a1", "agent", { description: "Look at both", prompt: "Compare the two pictures with the file.", subagent_type: "reviewer", run_in_background: false, attach: ["picture 1", "picture 2", "a.txt"] })], "tool_use");
      saw.result = JSON.stringify((call.body.messages.at(-1).content || []).find((/** @type {any} */ b) => b?.type === "tool_result" && b.tool_use_id === "a1")?.content);
      return say([{ type: "text", text: "Done." }]);
    };
    const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: [{ type: "text", text: "look at this" }, image(P1)], stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    assert.ok(saw.sub, "the sub-agent ran");
    const tail = saw.sub.slice(-4);
    assert.match(String(tail[0].text), /Compare the two pictures with the file\.$/);
    assert.deepEqual(unmarked(tail.slice(1)), [{ type: "text", text: "File: a.txt\n```\nthe parser trips on an empty file\n\n```" }, image(P1), image(P2)]);
    assert.match(saw.result, /Attached: picture 1 \(70 bytes picture\), picture 2 \(70 bytes picture\), a\.txt \(34 bytes text\)\./);
  });

  // (fails before: yes — Fable 5.2's review of 11-17: a resumed turn numbered the answer's pictures, which reach the
  // model as words alone, and its picture 1 was no longer the one the turn began with, nor its picture 2 the one sent
  // while it worked before it asked)
  test("a turn that asked and was answered: picture 1 is still its message's and picture 2 the one sent before it asked; the answer's picture is no picture of the turn", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    const id = String((await r.json()).id);
    /** @type {any} */
    const saw = {};
    let main = 0;
    brain = async (call) => {
      const say = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 9, output_tokens: 3 } });
      if (call.kind !== "anthropic") return undefined;
      if (isSub(call.body)) {
        saw.sub = call.body.messages.at(-1).content;
        return say([{ type: "text", text: "SUB: seen." }]);
      }
      main++;
      const result = (/** @type {string} */ use) => JSON.stringify((call.body.messages.at(-1).content || []).find((/** @type {any} */ b) => b?.type === "tool_result" && b.tool_use_id === use)?.content);
      if (main === 1) {
        const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
        const live = runs.find((/** @type {any} */ x) => x.status === "running");
        await shim.api(`/api/runs/${live?.id}/steer`, { method: "POST", body: { kind: "note", from: "harness", text: "and this one", images: [{ name: "two.png", mediaType: "image/png", data: P2 }] } });
        return say([toolUse("r1", "read", { path: "a.txt" })], "tool_use");
      }
      if (main === 2) return say([toolUse("q1", "ask", { question: "Which part?" })], "tool_use");
      if (main === 3) return say([toolUse("a1", "agent", { description: "Look", prompt: "Say what they show.", subagent_type: "reviewer", run_in_background: false, attach: ["picture 3"] })], "tool_use");
      if (main === 4) {
        saw.refused = result("a1");
        return say([toolUse("a2", "agent", { description: "Look", prompt: "Say what they show.", subagent_type: "reviewer", run_in_background: false, attach: ["picture 1", "picture 2"] })], "tool_use");
      }
      saw.result = result("a2");
      return say([{ type: "text", text: "Done." }]);
    };
    const asked = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: [{ type: "text", text: "look at this" }, image(P1)], stream: false } });
    assert.equal(asked.status, 200, await asked.clone().text());
    assert.equal(main, 2, "it asked");
    const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: [{ type: "text", text: "the top" }, image(P3)], stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    assert.match(saw.refused, /attach: picture 3: this turn has 2 pictures from the person: picture 1 to picture 2/);
    assert.ok(saw.sub, "the sub-agent ran");
    assert.deepEqual(unmarked(saw.sub.slice(-2)), [image(P1), image(P2)]);
    assert.match(saw.result, /Attached: picture 1 \(70 bytes picture\), picture 2 \(70 bytes picture\)\./);
  });

  // (fails before: yes — Fable 5.2's review of 11-17: a turn taken up from the archive after a restart read its
  // opening from the newest message ahead of its answer, there the round's results, and sent the picture a boundary
  // delivered as picture 1)
  test("a turn taken up from the archive after a restart numbers none of the person's pictures, and says why — nor after it asks again and is answered in this process", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    const id = String((await r.json()).id);
    /** @type {any} */
    const saw = {};
    let main = 0;
    brain = async (call) => {
      const say = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 9, output_tokens: 3 } });
      if (call.kind !== "anthropic") return undefined;
      if (isSub(call.body)) {
        saw.sub = call.body.messages.at(-1).content;
        return say([{ type: "text", text: "SUB: seen." }]);
      }
      main++;
      if (main === 1) {
        const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
        const live = runs.find((/** @type {any} */ x) => x.status === "running");
        await shim.api(`/api/runs/${live?.id}/steer`, { method: "POST", body: { kind: "note", from: "harness", text: "and this one", images: [{ name: "two.png", mediaType: "image/png", data: P2 }] } });
        return say([toolUse("r1", "read", { path: "a.txt" })], "tool_use");
      }
      if (main === 2) return say([toolUse("q1", "ask", { question: "Which part?" })], "tool_use");
      const result = (/** @type {string} */ use) => JSON.stringify((call.body.messages.at(-1).content || []).find((/** @type {any} */ b) => b?.type === "tool_result" && b.tool_use_id === use)?.content);
      if (main === 3) return say([toolUse("a1", "agent", { description: "Look", prompt: "Say what it shows.", subagent_type: "reviewer", run_in_background: false, attach: ["picture 1"] })], "tool_use");
      if (main === 4) {
        saw.refused = result("a1");
        return say([toolUse("q2", "ask", { question: "And which line?" })], "tool_use");
      }
      if (main === 5) return say([toolUse("a2", "agent", { description: "Look", prompt: "Say what it shows.", subagent_type: "reviewer", run_in_background: false, attach: ["picture 1"] })], "tool_use");
      saw.again = result("a2");
      return say([{ type: "text", text: "Done." }]);
    };
    const asked = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: [{ type: "text", text: "look at this" }, image(P1)], stream: false } });
    assert.equal(asked.status, 200, await asked.clone().text());
    assert.equal(main, 2, "it asked");
    // The process that asked is gone: the same data, a fresh Filament.
    const dataDir = shim.dataDir;
    await shim.stop();
    shim = await startApp({ memory: true, configure, dataDir, keep: true });
    const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "the top", stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    const rec = await shim.record(String(t.headers.get("x-filament-request-id")));
    assert.ok(rec.changes.some((/** @type {string} */ c) => /resumed from the archived pause/.test(c)), "taken up from the archive");
    assert.match(saw.refused, /attach: picture 1: this turn numbers none of the person's pictures: it was taken up again from what Filament kept/);
    assert.equal(main, 4, "it asked again");
    // Its second question, answered in this process: its park says it numbers none.
    const again = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "the first", stream: false } });
    assert.equal(again.status, 200, await again.clone().text());
    assert.match(saw.again, /attach: picture 1: this turn numbers none of the person's pictures/);
    assert.equal(saw.sub, undefined, "no sub-agent ran");
  });
});

describe("attach on a coding agent's chat", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let folder;
  /** @type {string} */
  let logs;
  /** @type {any[] | null} */
  let sub = null;
  before(async () => {
    folder = mkdtempSync(join(tmpdir(), "filament-attach-coder-"));
    logs = mkdtempSync(join(tmpdir(), "filament-attach-coder-logs-"));
    writeFileSync(join(folder, "a.txt"), "one\n");
    up = await fakeUpstream(async (call) => {
      const b = call.body || {};
      const say = (/** @type {string} */ text) => anthropicReply("", { model: String(b.model || ""), stop: "end_turn", blocks: [{ type: "text", text }], usage: { input_tokens: 5, output_tokens: 3 } });
      if (isSub(b)) {
        sub = b.messages.at(-1).content;
        return say("SUB REPORT: seen");
      }
      return say("MODEL ANSWER");
    });
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg, { dataDir }) => {
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
          { id: "cli", name: "cli", type: "acp", enabled: true, acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(logs, "calls.jsonl"), FAKE_ACP_LOG: join(logs, "prompts.jsonl"), FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "http", FAKE_ACP_SESSION_CAPS: "resume,close" }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" } },
        ];
        cfg.routes = [
          { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true },
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
  const lines = (/** @type {string} */ file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

  // (fails before: yes — the same, on a coding agent's own chat: its agent call over MCP took no attach)
  test("picture 1 from the person's message and a file of its folder: its sub-agent's first message carries them; a .git folder is kept, the call refused in words", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "coder-1", preset: "plain", settings: { subagents: { pool: [{ model: "m-1", seats: 4 }] } } } });
    const id = String((await r.json()).id);
    const call = JSON.stringify({ description: "Look", prompt: "Say what the picture shows.", subagent_type: "reviewer", attach: ["picture 1", "a.txt"] });
    const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: [{ type: "text", text: `~mcpcall agent ${call}` }, image(P1)], stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    const text = ((await t.json()).content || []).map((/** @type {any} */ b) => b.text || "").join("");
    assert.match(text, /mcp:SUB REPORT: seen/);
    assert.match(text, /Attached: picture 1 \(70 bytes picture\), a\.txt \(4 bytes text\)\./);
    assert.ok(sub, "the sub-agent ran");
    assert.deepEqual(unmarked(/** @type {any[]} */ (sub).slice(-2)), [{ type: "text", text: "File: a.txt\n```\none\n\n```" }, image(P1)]);
    mkdirSync(join(folder, ".git"), { recursive: true });
    writeFileSync(join(folder, ".git", "config"), "[remote]");
    const kept = JSON.stringify({ description: "Look", prompt: "Read it.", subagent_type: "reviewer", attach: [".git/config"] });
    const k = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `~mcpcall agent ${kept}`, stream: false } });
    const said = ((await k.json()).content || []).map((/** @type {any} */ b) => b.text || "").join("");
    assert.match(said, /attach: \.git\/config: in a repository's own \.git folder, which is kept from attachments/);
    assert.equal(lines(join(logs, "prompts.jsonl")).filter((p) => String(p.text).includes("~mcpcall agent")).length, 2);
  });
});
