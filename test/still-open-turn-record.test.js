// @ts-check
// Still open's record of a chat's running turn (agent/still-open.js `begin`, `over`, `turnsNow`) is a running turn's
// alone: every road out of a turn ends it. A coding agent's chat whose message Filament answers itself — a chat
// command, with no agent asked — began the record ahead of the branch that answers, which skips the turn's `finally`:
// the chat kept an entry for as long as Filament ran. Through a real Filament: a coding agent's chat (the fake ACP
// agent) and a chat on Filament's loop, each by the roads a turn can take.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply, FAKE_ACP_AGENT } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const root = mkdtempSync(join(tmpdir(), "filament-open-record-"));
const projDir = join(root, "project");
const holdDir = join(root, "hold");
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** The loop's model, as the test at hand scripts it. @type {(call: any) => any} */
let brain = () => anthropicReply("HI", { model: "brain-model" });

before(async () => {
  mkdirSync(projDir);
  mkdirSync(holdDir);
  up = await fakeUpstream(async (call) => {
    if (call.kind !== "anthropic") return undefined;
    if (!call.body?.tools?.length) return anthropicReply("A title", { model: "brain-model" });
    return brain(call);
  });
  shim = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.upstreams = [
        { id: "claude", name: "claude", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_HOLD_GATE: holdDir }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
        { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
      ];
      cfg.routes = [
        { match: "claude/*", upstream: "claude", upstreamModel: "{1}", enabled: true },
        { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true },
      ];
      cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
      cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
  await removeDirs(root);
});

const at = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
/** @param {string} model */
const create = async (model) => {
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain" } });
  assert.equal(r.status, 200, await r.clone().text());
  return String((await r.json()).id);
};
/** @param {string} id @param {string} content */
const send = (id, content) => shim.api(`${at(id)}/turns`, { method: "POST", body: { content, stream: false } });
/** Whether Still open holds a running turn's record for the chat. @param {string} id */
const recorded = (id) => /** @type {string[]} */ (/** @type {any} */ (shim.app).stillOpen.turnsNow()).includes(id);
/** Until no turn of the chat runs. @param {string} id */
const rests = (id) => until(() => (/** @type {any} */ (shim.app).sessions.running().includes(id) ? null : true), "the chat's turn to end", { timeoutMs: 20_000 });

// (fails before: yes — the record began ahead of the branch that answers a chat command, which skips the turn's
// `finally`: the chat's entry stayed until Filament stopped)
test("a coding agent's chat: a message Filament answers itself leaves no record; a turn its agent answers holds one while it runs, and none after", async () => {
  const id = await create("claude/haiku");
  // A chat command Filament answers, the agent not called.
  const help = await send(id, "/help");
  assert.equal(help.status, 200, await help.clone().text());
  assert.match(JSON.stringify(await help.json()), /Commands you can type here/);
  await rests(id);
  assert.equal(recorded(id), false, "answered by Filament: no turn of the agent's runs, and none is kept as running");
  // A turn the agent answers: the record stands while it runs…
  const turn = send(id, "~slowstart please").then((r) => r.text());
  try {
    await until(() => (recorded(id) ? true : null), "the running turn's record", { timeoutMs: 30_000 });
  } finally {
    writeFileSync(join(holdDir, "slowstart"), "");
  }
  assert.match(await turn, /echo\(/);
  await rests(id);
  // …and goes with it.
  assert.equal(recorded(id), false, "the turn ended");
  // A command that names no session is answered in words too.
  const none = await send(id, "/resume nope-nope");
  assert.equal(none.status, 200, await none.clone().text());
  await rests(id);
  assert.equal(recorded(id), false, "answered by Filament again");
});

// (fails before: no — the loop begins its record at the `try` whose `finally` ends it, and a chat command of a loop's
// chat is answered before its turn begins; this pins each road out of a loop's turn)
test("a chat on Filament's loop: a command Filament answers, a turn that answers and one whose first request is refused each leave no record", async () => {
  const id = await create("agent/brain-model");
  const status = await send(id, "/status");
  assert.equal(status.status, 200, await status.clone().text());
  await rests(id);
  assert.equal(recorded(id), false, "a command Filament answers");
  const ok = await send(id, "hello");
  assert.equal(ok.status, 200, await ok.clone().text());
  await rests(id);
  assert.equal(recorded(id), false, "a turn that answered");
  brain = () => ({ status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "not now" } } });
  try {
    const failed = await send(id, "hello again");
    assert.ok(failed.status >= 400, `the turn failed: HTTP ${failed.status}`);
    await rests(id);
    assert.equal(recorded(id), false, "a turn whose first request was refused");
  } finally {
    brain = () => anthropicReply("HI", { model: "brain-model" });
  }
});
