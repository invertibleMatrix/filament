// @ts-check
// The harness runs on the loop, period: a native session that names a plain LLM route runs the agent loop as if it
// had named `agent/<model>` — the prefix is Filament's own name for its loop. A coding agent's (ACP) route is never
// wrapped, an unknown model keeps its 404, and an outside client's plain model keeps its plain meaning. The picker's
// half (the base name shown) is pinned DOM-free on the exported helper.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeUpstream, anthropicReply, startApp, FAKE_ACP_AGENT } from "./helpers/app.js";
import { shownName } from "../src/ui/harness/composer/model.js";

/** @type {string} */ let root;
/** @type {any} */ let up;
/** @type {any} */ let shim;
/** @type {string} */ let acpLog;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-hl-"));
  acpLog = join(root, "acp.jsonl");
  up = await fakeUpstream(async (call) =>
    anthropicReply("", { model: call.body?.model || "m", stop: "end_turn", blocks: [{ type: "text", text: "PLAIN TEXT ANSWER" }], usage: { input_tokens: 5, output_tokens: 3 } }),
  );
  shim = await startApp({
    memory: true,
    keep: true,
    configure: (cfg) => {
      cfg.upstreams = [
        { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
        { id: "acp", name: "acp", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_LOG: acpLog }, cwdDefault: root, permissions: "allow-all" } },
      ];
      cfg.routes = [
        { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
        { match: "acp-*", upstream: "acp", upstreamModel: "{1}", enabled: true },
      ];
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
  for (const dir of [shim.dataDir, root]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

/** @param {string} model @returns {Promise<string>} the new session's id */
const createSession = async (model) => {
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model } });
  assert.equal(r.status, 200, await r.clone().text());
  return (await r.json()).id;
};
/** @param {string} id @param {string} content */
const turn = (id, content) => shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });

test("a harness turn on a plain LLM route runs the agent loop — the prefix is Filament's own name for it", async () => {
  const id = await createSession("m-1");
  const mark = up.received.length;
  const t = await turn(id, "hello loop");
  assert.equal(t.status, 200, await t.clone().text());
  const calls = up.received.slice(mark);
  assert.equal(calls.length, 1, "one round: the fake replies plain text, so the loop ends");
  const body = calls[0].body;
  assert.equal(body.model, "m-1", "the loop drives the plain route as its inner model");
  assert.ok(
    Array.isArray(body.tools) && body.tools.some((tool) => tool.name === "bash") && body.tools.some((tool) => tool.name === "plan"),
    "the loop's hands and plan were offered — this is the loop, not a plain dispatch",
  );
  const rec = await shim.record(t.headers.get("x-filament-request-id"));
  assert.equal(rec.route, "agent:m-1", "the record says the loop answered, with the plain name as its model");
});

test("round-start carries blocksBefore — where the round's own output begins, the cards' placement anchor", async () => {
  const id = await createSession("m-1");
  const t = await turn(id, "anchor please");
  assert.equal(t.status, 200, await t.clone().text());
  const rid = String(t.headers.get("x-filament-request-id"));
  const page = await (await shim.api(`/api/runs/${encodeURIComponent(rid)}/events?since=0`)).json();
  const starts = (page.events || []).filter((/** @type {any} */ e) => e.type === "round-start");
  assert.ok(starts.length >= 1, "the run has its round");
  assert.ok(starts.every((/** @type {any} */ e) => Number.isInteger(e.blocksBefore)), "every round-start names where its output begins");
  assert.equal(starts[0].blocksBefore, 0, "the first round starts at the reply's first block");
});

test("a coding agent's (ACP) route is never wrapped: the turn goes to the agent, not the loop", async () => {
  const id = await createSession("acp-1");
  const mark = up.received.length;
  const t = await turn(id, "hello agent");
  assert.equal(t.status, 200, await t.clone().text());
  assert.equal(up.received.length, mark, "no LLM round went out");
  assert.ok(existsSync(acpLog) && readFileSync(acpLog, "utf8").includes("hello agent"), "the ACP agent got the prompt");
});

test("an unknown model keeps its plain 404 — the wrap never invents a route", async () => {
  const id = await createSession("ghost-1");
  const t = await turn(id, "hi");
  assert.equal(t.status, 404);
  assert.match(await t.text(), /no route matches model/);
});

test("an outside client's plain model keeps its plain meaning: the loop is never its", async () => {
  const mark = up.received.length;
  const r = await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, system: "THE CLIENT'S PROMPT", messages: [{ role: "user", content: "hi" }] }, { "x-session-id": "hl-out" });
  assert.equal(r.status, 200, await r.clone().text());
  const body = up.received[mark].body;
  assert.equal(body.system, "THE CLIENT'S PROMPT", "the client's own prompt, not the loop's");
  assert.ok(!Array.isArray(body.tools) || body.tools.length === 0, "no loop tools");
});

test("an agent/ name shows as its base", () => {
  assert.equal(shownName("agent/grok-4.6"), "grok-4.6");
  assert.equal(shownName("grok-4.6"), "grok-4.6");
});
