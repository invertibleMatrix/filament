// @ts-check
// Another agent's report that comes for a chat's agent while no turn of it runs wakes the chat, as a background
// command's end does (the owner's of 10-28: "if envelope arrives with an intention of you reading it then you should
// wake"). The report rides ahead of Filament's line, as the queued reports open every turn's message. After the
// person's Stop Filament never starts the agent by itself: the report waits for their next message (FO-D50).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { PROMPT } from "../src/app/agent/prompt.js";
import { ANY_WAKE_LINE, CHECK_WAKE_LINE, REPORT_WAKE_LINE, isWakeMessage, wakeLineFor } from "../src/app/sessions/wake.js";

/** @type {string} */
let root;
/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
const said = (/** @type {string} */ t) => anthropicReply("", { model: "brain-model", stop: "end_turn", blocks: [{ type: "text", text: t }], usage: { input_tokens: 30, output_tokens: 7 } });
const isSub = (/** @type {any} */ call) => JSON.stringify(call.body?.system ?? "").includes(PROMPT.subagentRole);
const heard = (/** @type {any} */ call) => JSON.stringify(call.body?.messages ?? []);

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-report-wake-"));
  up = await fakeUpstream(async (call) => {
    if (call.kind !== "anthropic") return undefined;
    if (!call.body?.tools?.length) return said("A title");
    if (isSub(call)) return said("SUB REPORT: the folder is clean.");
    return said(heard(call).includes(REPORT_WAKE_LINE.slice(0, 60)) ? "WEIGHED" : "HI");
  });
  shim = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.memory.autopilot = { enabled: false };
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
  await removeDirs(shim.dataDir, root);
});

const create = async () => {
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { subagents: { worktree: false } } } });
  if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
  return String((await r.json()).id);
};
/** @param {string} id */
const firstTurn = async (id) => {
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
  assert.equal(r.status, 200, await r.clone().text());
};
/** @param {string} id */
const transcript = async (id) => /** @type {any} */ (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json());
/** @param {string} id */
const listed = async (id) => /** @type {any} */ (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json());
/** The developer's own sub-agent, alongside the chat's agent. @param {string} id */
const launch = async (id) => {
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "audit the folder", description: "Audit" } });
  assert.equal(r.status, 200, await r.clone().text());
};

test("the words: a report's wake is Filament's own line, told apart from a command's end", () => {
  assert.equal(wakeLineFor("report"), REPORT_WAKE_LINE);
  assert.ok(isWakeMessage({ role: "user", content: [{ type: "text", text: "[Filament: the developer ran sub-agent sa_1 …]" }, { type: "text", text: REPORT_WAKE_LINE }] }));
});

// (fails before: yes — the owner's of 10-28: four Hunters' reports landed while the chat sat idle, and none woke it;
// they rode with the owner's next message)
test("a report that comes while no turn runs wakes the chat: the report ahead of Filament's line, the agent reads it, nothing waits", async () => {
  const id = await create();
  await firstTurn(id);
  await launch(id);
  const tr = await until(async () => {
    const t = await transcript(id);
    return (t.turns || []).length >= 2 && t.turns[1].final ? t : null;
  }, "the chat going on by itself", { timeoutMs: 20_000 });
  assert.equal(tr.turns[1].woke, true, "Filament's own turn");
  assert.ok(isWakeMessage(tr.turns[1].user), "its message ends with Filament's line");
  const user = JSON.stringify(tr.turns[1].user);
  assert.ok(user.includes(REPORT_WAKE_LINE.slice(0, 60)), "in its words for a report");
  assert.ok(user.indexOf("SUB REPORT") >= 0 && user.indexOf("SUB REPORT") < user.indexOf(REPORT_WAKE_LINE.slice(0, 60)), "the report rides ahead of it");
  assert.match(JSON.stringify(tr.turns[1].final), /WEIGHED/, "the agent read it and went on");
  assert.equal((await listed(id)).queued, 0, "nothing waits any more");
});

/**
 * A graph's word told the chat's agent while no turn runs, as the graph runner tells it: it wakes the chat.
 * @param {string} id @param {string} text @param {string} [about]
 */
const graphWord = (id, text, about) => /** @type {any} */ (shim.app).subagents.tell(id, { text, from: "", description: "the task graph", spends: [], wrote: false, wakes: true, ...(about ? { about } : {}) });
/** The chat's second turn, Filament's own, once it has its answer. @param {string} id */
const woke = (id) =>
  until(async () => {
    const t = await transcript(id);
    return (t.turns || []).length >= 2 && t.turns[1].final ? t.turns[1] : null;
  }, "the chat going on by itself", { timeoutMs: 20_000 });

// (fails before: yes — the nudge map of 11-10: a check's verdict woke the chat as "another agent's report has come")
test("a check's verdict that comes while no turn runs wakes the chat in its own words; two kinds at once say what came", async () => {
  const id = await create();
  await firstTurn(id);
  graphWord(id, "[Filament: t1's check failed: npm test exited 1]", "check");
  const turn = await woke(id);
  const user = JSON.stringify(turn.user);
  assert.ok(isWakeMessage(turn.user), "its message ends with Filament's line");
  assert.ok(user.includes(CHECK_WAKE_LINE.slice(0, 60)), user);
  assert.ok(!user.includes(REPORT_WAKE_LINE.slice(0, 40)), "no report came");
  assert.ok(user.indexOf("t1's check failed") < user.indexOf(CHECK_WAKE_LINE.slice(0, 60)), "the verdict rides ahead of it");
  const two = await create();
  await firstTurn(two);
  // Both queued before the waker asks: it waits a moment for the turn that woke it to let go.
  graphWord(two, "[Filament: t2's check passed]", "check");
  graphWord(two, "[Filament: t3 merged into the folder]", "merge");
  const both = JSON.stringify((await woke(two)).user);
  assert.ok(both.includes(ANY_WAKE_LINE.slice(0, 60)), both);
});

// (fails before: no — nothing woke a chat for a report; this pins that a chat with no turn yet stays so)
test("a chat that has had no turn is not woken: its first message carries the report", async () => {
  const id = await create();
  await launch(id);
  await until(async () => ((await listed(id)).queued === 1 ? true : null), "the report in the queue", { timeoutMs: 20_000 });
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((await transcript(id)).turns?.length || 0, 0, "no turn of Filament's");
  assert.equal((await listed(id)).queued, 1, "it waits for the first message");
});

// (fails before: no — the guard was already there for a command's end; this pins it for a report)
test("after the person's Stop a report waits for their next message: the chat is not woken", async () => {
  const id = await create();
  await firstTurn(id);
  const stop = await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} });
  assert.equal(stop.status, 200, await stop.clone().text());
  await launch(id);
  await until(async () => ((await listed(id)).queued === 1 ? true : null), "the report in the queue", { timeoutMs: 20_000 });
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((await transcript(id)).turns.length, 1, "no turn of Filament's");
  assert.equal((await listed(id)).queued, 1, "it waits for the next message");
});
