// @ts-check
// Memory's block goes with the message it was recalled for (the main agent's chat of 11-09). A coding agent's turn hands
// its agent more than one prompt — the person's, then what Filament owes it within the same turn: a sub-agent's report,
// a relayed note, a letter — and memory's recall, its errata and its quotes were made for the person's words alone: the
// first prompt carries them, the later ones carry none, so the same text is not said again on each, nor a memory retired
// while the turn ran. An erratum is said once, on the person's next message.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectOf } from "../src/services/memory/brain.js";
import { PROMPT } from "../src/app/agent/prompt.js";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const RULE = "Keep each commit to one change.";
const REGION = "The deploy region for the api server is eu-west-2.";
const BRANCH = "The api server deploy ships from the release branch.";
const deferred = () => {
  /** @type {(v?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

describe("through the app: memory's block on a coding agent's prompts within one turn", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */ let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */ let shim;
  /** @type {string} */ let folder;
  /** @type {string} */ let logs;
  let gate = deferred();

  /** @param {any} b */
  const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
  /** The fake agent's prompts, oldest first: `prompt` is the text it was sent whole. */
  const prompts = () => (existsSync(join(logs, "prompts.jsonl")) ? readFileSync(join(logs, "prompts.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const promptsOf = (/** @type {string} */ sessionId) => prompts().filter((p) => p.sessionId === sessionId).map((p) => String(p.prompt));
  const runEvents = async (/** @type {string} */ runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || [];
  /** The agent's session a prompt of `marker` went to. @param {string} marker */
  const sessionOf = (marker) => String(prompts().find((p) => String(p.prompt).includes(marker))?.sessionId || "");
  /** A memory as the person's own word, in the folder's project. @param {string} text @param {string} [kind] */
  const remembered = async (text, kind = "fact") => {
    const memory = /** @type {any} */ (shim.app.memory);
    const id = String((await memory.scope({ role: "owner", project: projectOf({ cwdHint: folder }).id }).remember(text, { kind })).id);
    await memory.brain.outbox.drain();
    return id;
  };
  /** A memory replaced by an agent of another chat. @param {string} id @param {string} text */
  const corrected = async (id, text) => {
    const memory = /** @type {any} */ (shim.app.memory);
    const r = await memory.scope({ role: "agent", project: projectOf({ cwdHint: folder }).id }).correct(id, { text, reason: "it moved" });
    assert.equal(r.ok, true, JSON.stringify(r));
    await memory.brain.outbox.drain();
    return String(r.id);
  };
  const newSession = async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "coder-1", preset: "plain", settings: { subagents: { pool: [{ model: "m-1", seats: 4 }] } } } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** A turn answered whole. @param {string} id @param {string} content */
  const whole = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    await r.json();
  };
  /**
   * A turn whose agent launches a sub-agent in the background, which holds until `held` runs: its report wakes the agent
   * as its next prompt, in the same turn. @param {string} id @param {string} prompt @param {() => Promise<void>} [held]
   */
  const withReport = async (id, prompt, held = async () => {}) => {
    gate = deferred();
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `~mcpcall agent ${JSON.stringify({ description: "Check the deploy", prompt: `HOLD then ${prompt}`, run_in_background: true })}`, stream: true, runEvents: true } });
    const runId = String(res.headers.get("x-filament-request-id"));
    try {
      await until(async () => (await runEvents(runId)).some((e) => e.type === "turn-state" && e.to === "waiting") || null, "the turn to wait for its sub-agent");
      await held();
    } finally {
      gate.resolve();
    }
    await res.text();
  };

  before(async () => {
    folder = mkdtempSync(join(tmpdir(), "filament-memory-follow-ups-"));
    logs = mkdtempSync(join(tmpdir(), "filament-memory-follow-ups-logs-"));
    writeFileSync(join(folder, "a.txt"), "one\n");
    up = await fakeUpstream(async (call) => {
      const b = call.body || {};
      const say = (/** @type {string} */ text) => anthropicReply("", { model: String(b.model || ""), stop: "end_turn", blocks: [{ type: "text", text }], usage: { input_tokens: 5, output_tokens: 3 } });
      // Filament's sub-agent, on the loop: it reports once the test lets it.
      if (sysOf(b).includes(String(PROMPT.subagentRole))) {
        if (JSON.stringify(b.messages || []).includes("HOLD")) await gate.promise;
        return say("SUB REPORT: checked.");
      }
      return say("MODEL ANSWER");
    });
    shim = await startApp({
      memory: true,
      configure: (cfg, { dataDir }) => {
        const acp = { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(logs, "calls.jsonl"), FAKE_ACP_LOG: join(logs, "prompts.jsonl"), FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "http", FAKE_ACP_SESSION_CAPS: "resume,close" }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" };
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }, { id: "cli", name: "cli", type: "acp", enabled: true, acp }];
        cfg.routes = [
          { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
        cfg.memory.autopilot = { enabled: true };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
      },
    });
  });
  after(async () => {
    gate.resolve();
    await shim.stop();
    await up.close();
    await removeDirs(folder, logs);
  });

  // (fails before: yes — the main agent's chat of 11-09: every prompt of the turn carried the person's block again, the
  // sub-agent's report among them, and a memory replaced while the turn ran stayed listed on each, in its old words)
  test("the person's recall rides their prompt alone: the report that wakes the agent in the same turn carries none, nor the memory replaced meanwhile", async () => {
    // The chat's first message builds its briefing on what memory holds then; what the next turn recalls is filed after.
    await remembered(RULE, "rule");
    const id = await newSession();
    await whole(id, "hello there");
    const region = await remembered(REGION);
    let now = "";
    await withReport(id, "check the deploy region of the api server", async () => {
      now = await corrected(region, "The deploy region for the api server is eu-central-1 now.");
    });
    const sent = promptsOf(sessionOf("hello there"));
    assert.equal(sent.length, 3, "the first turn's prompt, then the person's and the report's");
    assert.match(sent[1], new RegExp(`<filament-memory kind="turn">\\nRelated memory for this message[^\\n]*\\n- \\[${region} `), "recalled for the person's words, on their prompt");
    assert.ok(sent[2].includes("SUB REPORT: checked."), sent[2]);
    assert.ok(!sent[2].includes("<filament-memory"), `nothing of memory's on the report's prompt:\n${sent[2]}`);
    assert.ok(!sent[2].includes(`[${region} `) && !sent[2].includes(REGION), "the replaced memory is not listed again");
    assert.ok(!sent[2].includes(`[${now} `), "nor its replacement: no recall ran on the report");
  });

  // (fails before: yes — the same chat: the erratum the person's message carried rode every prompt after it in the turn)
  test("an erratum is said once, on the person's next message: not on the report that wakes the agent after it, nor on the message after that", async () => {
    const id = await newSession();
    await whole(id, "hello there, again");
    const branch = await remembered(BRANCH);
    await whole(id, "which branch does the api server deploy ship from?");
    const sid = sessionOf("hello there, again");
    assert.ok(promptsOf(sid)[1].includes(`[${branch} `), "the session was shown the memory");
    const now = await corrected(branch, "The api server deploy ships from the main branch since the move.");
    await withReport(id, "check the api server deploy branch");
    const sent = promptsOf(sid);
    assert.equal(sent.length, 4, "the first two turns' prompts, then this turn's two");
    const erratum = `Memory correction: [${branch}] "${BRANCH}" no longer holds — now [${now}]`;
    assert.ok(sent[2].includes(erratum), `the person's message carries it:\n${sent[2]}`);
    assert.ok(sent[3].includes("SUB REPORT: checked."), sent[3]);
    assert.ok(!sent[3].includes("Memory correction:") && !sent[3].includes("<filament-memory"), `not said again on the report:\n${sent[3]}`);
    await whole(id, "and the api server deploy branch now?");
    const next = promptsOf(sid).at(-1) || "";
    assert.ok(next.includes("and the api server deploy branch now?") && !next.includes(`Memory correction: [${branch}]`), `said once:\n${next}`);
  });
});
