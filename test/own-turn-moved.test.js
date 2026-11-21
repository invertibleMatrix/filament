// @ts-check
// A chat moved off a coding agent still gets that agent's own turns (the decision of 11-02: work the agent started
// reports back), run in the agent's session on the model it ran — and each says so: the turn names its agent where the
// person's message would be, and its facts and its record name the agent's model and upstream, never the chat's model
// now.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply, FAKE_ACP_AGENT } from "./helpers/app.js";
import { until, removeDirs } from "./helpers/wait.js";
import { factsLine } from "../src/ui/harness/lib/labels.js";

/** The text of a message. @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));

describe("a coding agent's own turn in a chat moved off it", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-own-moved-"));
  const projDir = join(root, "project");
  /** The bridge's asks for an own turn: those of the chat `hold` names wait in `held`; the rest go on. @type {{ hold: string, held: any[], real: (cycle: any) => void }} */
  const asks = { hold: "", held: [], real: () => {} };
  before(async () => {
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    up = await fakeUpstream(async () => anthropicReply("Loop words.", { model: "brain-model" }));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "claude", name: "Claude Code", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_LOG: join(root, "prompts.jsonl") }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
        ];
        cfg.routes = [
          { match: "claude/*", upstream: "claude", upstreamModel: "{1}", enabled: true },
          { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true },
        ];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
    const acp = /** @type {any} */ (shim.app).acp;
    asks.real = acp.onOwnCycle;
    acp.onOwnCycle = (/** @type {any} */ cycle) => (cycle.chain === asks.hold ? void asks.held.push(cycle) : asks.real(cycle));
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, root);
  });
  /** @param {string} id */
  const transcript = async (id) => (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();

  // (fails before: no — verified as built: the own turn names Claude Code, its facts say haiku on claude, which the
  // footer draws, and its record claude/haiku on claude, while the chat runs agent/brain-model)
  test("the agent's own turn names its agent, and its facts and record name the agent's model, not the chat's", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "claude/haiku", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    // Claude starts a task in the background; its end comes after the turn, in a cycle of its own.
    asks.hold = id;
    const first = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "~wake please", stream: true, runEvents: true } });
    assert.equal(first.status, 200);
    await first.text();
    const [cycle] = /** @type {any[]} */ (await until(() => (asks.held.length ? asks.held.splice(0) : null), "Claude's cycle asking for its turn"));
    asks.hold = "";
    // The chat moves to Filament's loop and has a turn there; then Claude's own turn comes.
    const moved = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { model: { name: "agent/brain-model" } } } });
    assert.equal(moved.status, 200, await moved.clone().text());
    const loop = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hello loop", stream: false, sendAsIs: true } });
    assert.equal(loop.status, 200, await loop.clone().text());
    assert.equal(textOf(await loop.json()), "Loop words.");
    asks.real(cycle);
    const tr = await until(async () => {
      const t = await transcript(id);
      const own = t.turns.find((/** @type {any} */ x) => x.own);
      return own?.final && own.facts && !t.live ? t : null;
    }, "Claude's own turn, with its facts");
    assert.equal(tr.settings.effective.model.name, "agent/brain-model", "the chat runs the loop now");
    const own = tr.turns.find((/** @type {any} */ x) => x.own);
    assert.equal(own.own.agent, "Claude Code", "the turn names its agent where the message would be");
    const rec = await (await shim.api(`/api/requests/${encodeURIComponent(own.requestIds.at(-1))}`)).json();
    assert.deepEqual([own.facts.model, own.facts.upstream], ["haiku", "claude"], "its facts name the agent's model");
    const model = factsLine(own.facts).find((s) => s.id === "model");
    assert.match(String(model?.title), /^answered by haiku on claude/, "the footer says the agent's model");
    assert.deepEqual([rec.model, rec.upstream], ["claude/haiku", "claude"], "its record names the agent's model");
    // (fails before: yes — the owner's of 11-08: the agent's own turn read as the chat moving back to it, so the person's
    // next message to the loop was stopped by the switch's card again)
    const next = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "and on", stream: false } });
    assert.equal(next.status, 200, await next.clone().text());
  });

  // (fails before: yes — the review of cb2d2d1f0: the agent's own turn read as its session's newest, so the chat going
  // back to it after the loop's turn was no switch: no card, and its session went on with none of the loop's turn)
  test("back on the agent after its own turn: the switch's card asks, and the session it goes on in is handed the loop's turn", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "claude/haiku", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    const turns = `/api/sessions/${encodeURIComponent(id)}/turns`;
    /** @param {string} name */
    const pick = async (name) => assert.equal((await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { model: { name } } } })).status, 200);
    asks.hold = id;
    const first = await shim.api(turns, { method: "POST", body: { content: "~wake please", stream: true, runEvents: true } });
    assert.equal(first.status, 200);
    await first.text();
    const [cycle] = /** @type {any[]} */ (await until(() => (asks.held.length ? asks.held.splice(0) : null), "Claude's cycle asking for its turn"));
    asks.hold = "";
    await pick("agent/brain-model");
    const loop = await shim.api(turns, { method: "POST", body: { content: "hello loop", stream: false, sendAsIs: true } });
    assert.equal(loop.status, 200, await loop.clone().text());
    asks.real(cycle);
    await until(async () => {
      const t = await transcript(id);
      return t.turns.find((/** @type {any} */ x) => x.own)?.final && !t.live ? t : null;
    }, "Claude's own turn");
    await pick("claude/haiku");
    const asked = await shim.api(turns, { method: "POST", body: { content: "back again", stream: false } });
    const body = await asked.json();
    assert.equal(asked.status, 409, JSON.stringify(body));
    assert.equal(body.switchQuestion?.resumes, true, "its session is still up, and the chat goes on in it");
    const went = await shim.api(turns, { method: "POST", body: { content: "back again", stream: false, sendAsIs: true } });
    assert.equal(went.status, 200, await went.clone().text());
    const prompts = readFileSync(join(root, "prompts.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const told = JSON.stringify(prompts.at(-1));
    assert.ok(told.includes("back again") && told.includes("hello loop") && told.includes("Loop words."), `handed the loop's turn: ${told.slice(0, 1500)}`);
    // (fails before: yes — the same review: the bridge counted its own cycle as the turn after the one it last saw, so the
    // loop's turn read as seen, and the catch-up handed the session its own cycle as another assistant's)
    assert.ok(!told.includes("A background task ended"), `never its own cycle back: ${told.slice(0, 1500)}`);
  });
});
