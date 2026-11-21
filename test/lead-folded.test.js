// @ts-check
// The owner's "Teams, improved and kept" (11-03), its second piece, part C, on the live app: a team's lead on Filament's
// agent loop whose context Filament folds mid-turn hears, in the block that comes back after the summary, its workers of
// the turn that ended — who, what it was given, how it ended, its report's first line — and how to reach them. The main
// agent of a session that leads no team keeps its block as it was: no such part. The lines' words are
// lead-compacted.test.js's; the block's still-open.test.js's.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROMPT } from "../src/app/agent/prompt.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let folder;

const SCOUT = { role: "scout", description: "Map the parser", goal: "know where parse() is", steps: ["Find parse()"], acceptance: "its file is named" };
const OVERFLOW = { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 99999 tokens > 5000 maximum" } } };
/** The request each turn's agent sent once its context was folded. @type {Record<string, any>} */
const retried = {};
/** Whether each turn's agent has had its overflow. @type {Record<string, boolean>} */
const overflowed = {};

/** @param {any} b */
const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
/** @param {any} body @param {string} id */
const answered = (body, id) => (body?.messages || []).some((/** @type {any} */ m) => Array.isArray(m.content) && m.content.some((/** @type {any} */ b) => b?.type === "tool_result" && b.tool_use_id === id));

before(async () => {
  folder = mkdtempSync(join(tmpdir(), "filament-lead-folded-"));
  writeFileSync(join(folder, "a.txt"), "one\n");
  up = await fakeUpstream(async (call) => {
    const b = call.body || {};
    const all = JSON.stringify(b.messages || []);
    const blocks = (/** @type {any[]} */ list, stop = "end_turn") => anthropicReply("", { model: String(b.model || ""), stop, blocks: list, usage: { input_tokens: 5, output_tokens: 3 } });
    const say = (/** @type {string} */ text) => blocks([{ type: "text", text }]);
    const use = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => blocks([{ type: "tool_use", id, name, input }], "tool_use");
    if (sysOf(b).includes("compaction summaries")) return say("SUMMARY: a worker was sent to map the parser, and a.txt was read.");
    // A team's worker, or the main agent's sub-agent, which sees its task alone.
    if (sysOf(b).includes(String(PROMPT.workerRole)) || (all.includes("find where parse() lives") && !all.includes("solo: map the parser"))) return say("Subject: parse() lives in src/parse.js\nIt reads the whole file at once.");
    // Each turn's agent: it sends its worker — a team's lead by its agent tool, the main agent by its own, in the
    // foreground — waits for it where it leads, reads three times, overflows, and answers once its context is folded.
    const turn = all.includes("lead: map the parser") ? "lead" : all.includes("solo: map the parser") ? "solo" : null;
    if (!turn) return say("MODEL ANSWER");
    // Its steps by its own count: the fold takes its earlier rounds away, so it never reads them back.
    if (overflowed[turn]) {
      retried[turn] = b;
      return say(`${turn.toUpperCase()} DONE`);
    }
    if (!answered(b, "toolu_send")) return use("toolu_send", "agent", turn === "lead" ? SCOUT : { description: "Map the parser", prompt: "find where parse() lives", run_in_background: false });
    if (turn === "lead" && !answered(b, "toolu_wait")) return use("toolu_wait", "wait", { seconds: 60 });
    for (const n of [1, 2, 3]) if (!answered(b, `toolu_read${n}`)) return use(`toolu_read${n}`, "read", { path: "a.txt" });
    overflowed[turn] = true;
    return OVERFLOW;
  });
  shim = await startApp({
    memory: true,
    configure: (/** @type {any} */ cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
  for (const dir of [folder, shim.dataDir]) rmSync(dir, { recursive: true, force: true });
});

/** A harness session in the folder, its settings as given. @param {any} settings */
const newSession = async (settings) => {
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain", settings } });
  assert.equal(r.status, 200, await r.clone().text());
  return String((await r.json()).id);
};
/** One harness turn, answered whole. @param {string} id @param {string} content */
const turn = async (id, content) => {
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { stream: false, content } });
  assert.equal(r.status, 200, await r.clone().text());
  return JSON.stringify(await r.json());
};

// (fails before: yes — a loop lead's fold brought back its workers still running and those whose change waits, never
// those that ended: the scout's report, folded into the summary, was all it had of it)
test("a team's lead whose context Filament folds hears its workers of the turn that ended, after the summary; a session's main agent leading no team hears no such part", async () => {
  const lead = await newSession({ engine: { mode: "team", team: "builders", lookSeconds: 0 }, subagents: { pool: [{ model: "m-1", seats: 4 }] } });
  assert.match(await turn(lead, "lead: map the parser"), /LEAD DONE/);
  const sent = JSON.stringify(retried.lead?.messages || []);
  assert.ok(sent.includes("SUMMARY: a worker was sent to map the parser"), "the retry carries the summary");
  assert.match(sent, /your workers of this turn that had ended\./, sent);
  // (fails before: yes — the review of 11-03: a lead that reads along, as a session's lead does unless it says otherwise,
  // was sent to a follow-up for what show_report reads)
  assert.match(
    sent,
    /<ended>\\n- scout sa_[0-9a-f]{8} \(\\"Map the parser\\"\): reported — \\"Subject: parse\(\) lives in src\/parse\.js\\"\\nworker with an agent_id and show_report: true gives that worker's brief and its reports whole\.\\n<\/ended>/,
    sent,
  );
  const workers = (await (await shim.api(`/api/sessions/${encodeURIComponent(lead)}/subagents`)).json()).subagents;
  assert.equal(workers.length, 1, "one launch: nothing launched again after the fold");

  const solo = await newSession({ subagents: { pool: [{ model: "m-1", seats: 4 }] } });
  assert.match(await turn(solo, "solo: map the parser"), /SOLO DONE/);
  const plain = JSON.stringify(retried.solo?.messages || []);
  assert.ok(plain.includes("SUMMARY: a worker was sent to map the parser"), "the retry carries the summary");
  assert.ok(!plain.includes("<ended>") && !plain.includes("had ended"), "the main agent's block has no such part");
});
