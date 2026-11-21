// @ts-check
// HarnessV3-AtHome P2 step 3 on the live app: a team's lead and its workers, end to end through the pipeline. A harness
// session under Builders: its lead has a prompt and tools of its own, briefs a Builder through the agent tool, waits
// for the report and applies the work through worker; the Builder runs on the pool's model as its role, with the
// session's hands and MCP servers, compacts at its own model's line, and is a record, a run and an outcome of its own.
// A coding agent's name under a team leads it as itself. Step 4:
// the lead watches a Tester whose command waits for the developer's answer, messages it while it runs, corrects the
// work it reported, and stops one.
// The lead's orders run at once, whatever an old session's saved settings say of a team mode, and a session saved
// while its lead's proposal waited loads with nothing waiting. HarnessV3-Views V3: the developer's permission switch
// answers a Tester's waiting command through the session's route.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { taskWorktreePath } from "../src/adapters/git/worktree.js";
import { patchRecordOf } from "../src/adapters/git/patch.js";
import { PROMPT } from "../src/app/agent/prompt.js";
import { HAND_TOOLS } from "../src/adapters/tools/hands.js";
import { SUBAGENT_NOTES } from "../src/app/agent/subagents.js";
import { SHIPPED_TEAMS } from "../src/services/teams.js";
import { SHIPPED_CARDS } from "../src/services/agent-cards.js";
import { KNOBS } from "../src/services/session-settings.js";
import { FAKE_ACP_AGENT, FIXTURES, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { copyState } from "./helpers/copies.js";
import { removeDirs, until } from "./helpers/wait.js";

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let folder;

// Its tools ride every request in full (E49: load core), so a lead's and a worker's tool lists name them.
const NOTES = { name: "notes", command: process.execPath, args: [join(FIXTURES, "mcp-server.mjs")], load: "core" };
/**
 * A lead's tools in a harness chat, which shows visuals (HarnessV4_Visuals_Plan E16) and makes artifacts
 * (HarnessV4_Artifacts_Plan E18). It has no space tool: its project has no Space made (10-29).
 */
// A harness chat's lead has every tool a new chat has (HarnessV4_AgentTools_Plan AT-D1): the task graph's, the web's
// and the browser too.
const LEAD_TOOLS = [...HAND_TOOLS.map((t) => t.name), "lsp", "ask", "plan", "tasks", "agent", "worker", "wait", "envelope", "visual_guide", "show_visual", "artifact", "web_fetch", "web_search", "browser", "skill", "filament_recall"];
// The skill tool: the Library holds the skill Filament ships (prompt version 54); the recall tool memory adds last.
/** The summary the compaction writer answers with: a worker's conversation that holds it was folded. */
const SUMMARY = "WORKER-ROUNDS-SUMMARY: big.txt read through, the greeting found.";
const BUILD = { role: "builder", description: "Write the note", goal: "note.txt greets the reader", files: ["note.txt"], steps: ["Read big.txt for the greeting", "Write note.txt"], acceptance: "note.txt holds the greeting", dont_touch: ["big.txt"] };
const BRIEF = "Your task: Write the note\n\nGoal: note.txt greets the reader\n\nFiles:\n- note.txt\n\nSteps:\n1. Read big.txt for the greeting\n2. Write note.txt\n\nAcceptance check: note.txt holds the greeting\n\nDo not touch:\n- big.txt";
// A Builder under Full access that writes into the developer's folder past its worktree — by its write hand, then by
// its shell — and then in its worktree (HarnessV3-TaskGraph-v2 TG2-D38 on Filament's loop, found by TG2-D55's drive).
const STRAY = { role: "builder", description: "Write past the worktree", goal: "stray.txt greets the reader", files: ["stray.txt"], steps: ["Write stray.txt"], acceptance: "stray.txt holds the greeting" };
/** A Builder on Auto, which works in a patch (the owner's plan of 11-09 for big repos). */
const IN_PATCH = { role: "builder", description: "Write the patch note", goal: "patch-note.txt greets the reader", files: ["patch-note.txt"], steps: ["Write patch-note.txt"], acceptance: "patch-note.txt holds the greeting" };
const SCOUT = { role: "scout", description: "Map the folder", goal: "know what is here", steps: ["List the files"], acceptance: "every file is named" };
// Its command asks: `node -p`, since a version query (`node --version`) runs without asking (HarnessV3-FailurePoints
// S5-7).
const TEST = { role: "tester", description: "Check the version", goal: "know node's version", steps: ["Run node -p process.version"], acceptance: "the version is reported" };
/** The lead's message to its running Tester, and the steering block the Tester's loop reads it in. */
const TOLD = "Report the version exactly as printed.";
const TOLD_BLOCK = `Message from your team's lead, relayed by Filament (1 message). Acknowledge what you heard in your next reply before acting on it:\n- ${TOLD}`;
const SLOW = { role: "tester", description: "Probe slowly", goal: "know node's version", steps: ["Run node -p process.version"], acceptance: "the version is reported" };
const SWITCHED = { role: "tester", description: "Check under a switch", goal: "know node's version", steps: ["Run node -p process.version"], acceptance: "the version is reported" };
/** The Tester the developer tells something past its lead (HarnessV4_Tasks decision 10), and what they tell it. */
const PAST = { role: "tester", description: "Check it past the lead", goal: "know node's version", steps: ["Run node -p process.version"], acceptance: "the version is reported" };
const PAST_WORDS = "Use the long form.";
const FIRST = { role: "scout", description: "Map it first", goal: "know what is here", steps: ["List the files"], acceptance: "every file is named" };

/** @param {any} b */
const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
/** @param {any} content */
const textOf = (content) => (typeof content === "string" ? content : (content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));
const isLead = (/** @type {any} */ c) => sysOf(c.body).includes(String(PROMPT.leadRole));
const isWorker = (/** @type {any} */ c) => sysOf(c.body).includes(String(PROMPT.workerRole));
/** @param {any} body */
const toolNames = (body) => (body.tools || []).map((/** @type {any} */ t) => t.name);

before(async () => {
  folder = mkdtempSync(join(tmpdir(), "filament-team-live-"));
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: folder, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(folder, "a.txt"), "one\n");
  // About 6,000 tokens a read: a Builder that reads it again and again reaches its model's compaction line.
  writeFileSync(join(folder, "big.txt"), Array.from({ length: 300 }, (_, i) => `line ${i}: lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod`).join("\n"));
  git("add", "-A");
  git("commit", "-qm", "init");
  let reads = 0;
  up = await fakeUpstream(async (call) => {
    const b = call.body || {};
    const system = sysOf(b);
    const all = JSON.stringify(b.messages || []);
    const model = String(b.model || "");
    const blocks = (/** @type {any[]} */ list, stop = "end_turn") => anthropicReply("", { model, stop, blocks: list, usage: { input_tokens: 5, output_tokens: 3 } });
    const say = (/** @type {string} */ text) => blocks([{ type: "text", text }]);
    const use = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => blocks([{ type: "tool_use", id, name, input }], "tool_use");
    if (system.includes("compaction summaries")) return say(`<summary>\n${SUMMARY}\n</summary>`);
    if (system.includes(String(PROMPT.workerRole))) {
      if (all.includes("Your task: Map the folder")) return say("SCOUT REPORT: a.txt and big.txt are here.");
      if (all.includes("Your task: Map it first")) return say("SCOUT REPORT: mapped.");
      // A Tester runs one command, which waits for the developer's answer where they can give one: the watched one
      // reports and takes its lead's correction; the slow one is stopped while it waits; the probe is refused.
      if (all.includes("Your task: Probe slowly")) return use("toolu_slowver", "bash", { command: "node -p process.version" });
      if (all.includes("Your task: Check under a switch")) return all.includes("toolu_modever") ? say("TESTER: ran under the switch.") : use("toolu_modever", "bash", { command: "node -p process.version" });
      // The one the developer tells something past its lead: it says whether their words reached it.
      if (all.includes("Your task: Check it past the lead")) return all.includes("toolu_pastver") ? say(all.includes(PAST_WORDS) ? "TESTER: told the long form" : "TESTER: never told") : use("toolu_pastver", "bash", { command: "node -p process.version" });
      if (all.includes("Your task: Check the version")) {
        if (all.includes("Say the major version only.")) return say("TESTER: THE MAJOR ONLY");
        if (all.includes("toolu_ver")) return say("TESTER REPORT: node -p process.version printed it.");
        return use("toolu_ver", "bash", { command: "node -p process.version" });
      }
      if (all.includes("Your task: Write past the worktree")) {
        if (all.includes("toolu_stray_in")) return say("BUILDER REPORT: stray.txt written in my worktree.");
        if (all.includes("toolu_stray_sh")) return use("toolu_stray_in", "write", { path: "stray.txt", content: "hello from the worktree\n" });
        if (all.includes("toolu_stray_out")) return use("toolu_stray_sh", "bash", { command: `node -e "require('fs').writeFileSync(process.argv[1], 'by its shell')" "${join(folder, "stray-shell.txt").split("\\").join("/")}"` });
        return use("toolu_stray_out", "write", { path: join(folder, "stray.txt"), content: "hello from outside\n" });
      }
      // The Builder in a patch writes its note with its own hands, and reports.
      if (all.includes("Your task: Write the patch note")) return all.includes("toolu_pnote") ? say("BUILDER REPORT: patch-note.txt written.") : use("toolu_pnote", "write", { path: "patch-note.txt", content: "hello from the patch\n" });
      // The Builder reads until its rounds are folded, then writes through the session's MCP server and its own hands.
      if (all.includes("toolu_note")) return say("BUILDER REPORT: note.txt written in my worktree; it holds the greeting.");
      if (all.includes("toolu_mcp")) return use("toolu_note", "write", { path: "note.txt", content: "hello from the builder\n" });
      if (all.includes(SUMMARY)) return use("toolu_mcp", "mcp__notes__write_note", { name: "from-mcp", text: "via the session's server" });
      if (reads >= 40) return say("NEVER COMPACTED");
      return use(`toolu_read_${++reads}`, "read", { path: "big.txt" });
    }
    if (system.includes(String(PROMPT.leadRole))) {
      // The lead of the watched run: it launches a Tester, messages it and waits; the developer asks how it goes, and
      // it waits again; the report falls short, so it corrects it, and waits for the new one.
      if (all.includes("check the version")) {
        if (all.includes("TESTER: THE MAJOR ONLY")) return say("LEAD DONE: the version is checked.");
        if (all.includes("took your correction in the background")) return use("toolu_wait3", "wait", { seconds: 60 });
        const reported = /\[Filament: your tester (sa_[0-9a-f]{8})/.exec(all);
        if (reported) return use("toolu_fix", "worker", { agent_id: reported[1], prompt: "Say the major version only.", correction: true });
        if (all.includes("How is the tester doing?")) return use("toolu_wait2", "wait", { seconds: 60 });
        const launched = /Launched tester (sa_[0-9a-f]{8})/.exec(all);
        if (launched)
          return blocks(
            [
              { type: "tool_use", id: "toolu_msg", name: "worker", input: { agent_id: launched[1], prompt: TOLD } },
              { type: "tool_use", id: "toolu_wait", name: "wait", input: { seconds: 60 } },
            ],
            "tool_use",
          );
        return use("toolu_test", "agent", TEST);
      }
      // The lead whose Tester the developer tells something past it (decision 10): it launches the Tester and waits;
      // woken by what the developer told it, it waits again, and answers once the report is in.
      if (all.includes("tell it past the lead")) {
        if (/\[Filament: your tester sa_[0-9a-f]{8}/.test(all)) return say(all.includes("directly, past you:") ? "LEAD HEARD WHAT YOU TOLD IT" : "LEAD NEVER HEARD");
        if (all.includes("directly, past you:")) return use("toolu_wait_past2", "wait", { seconds: 60 });
        if (/Launched tester sa_/.test(all)) return use("toolu_wait_past", "wait", { seconds: 60 });
        return use("toolu_past", "agent", PAST);
      }
      // The lead that does a one-line piece itself (HarnessV4_Tasks decision 9): it writes the file with its own hands,
      // under the session's permission mode, and says what its write answered.
      if (all.includes("fix it yourself")) {
        if (all.includes("toolu_own")) return say(`LEAD WROTE IT: ${resultIn(b, "toolu_own")}`);
        return use("toolu_own", "write", { path: "own.txt", content: "by the lead\n" });
      }
      // The lead that stops its Tester when the developer says so.
      if (all.includes("stop the slow probe")) {
        if (all.includes("was stopped as you asked")) return say("LEAD STOPPED IT");
        if (all.includes("Stopping tester")) return all.includes("toolu_wait_s2") ? say("LEAD MISSED THE STOP") : use("toolu_wait_s2", "wait", { seconds: 60 });
        const slow = /Launched tester (sa_[0-9a-f]{8})/.exec(all);
        if (slow && all.includes("Stop the tester.")) return use("toolu_stop", "worker", { agent_id: slow[1], stop: true });
        if (slow) return use("toolu_wait_s", "wait", { seconds: 60 });
        return use("toolu_slow", "agent", SLOW);
      }
      // The lead that sends a Scout first, and waits for its report once it runs.
      if (all.includes("send a scout first")) {
        if (/\[Filament: your scout sa_[0-9a-f]{8}/.test(all)) return say("LEAD SAW THE FIRST SCOUT");
        if (/Launched scout sa_/.test(all)) return use("toolu_wait_first", "wait", { seconds: 60 });
        return blocks([{ type: "text", text: "A scout maps it first." }, { type: "tool_use", id: "toolu_first", name: "agent", input: FIRST }], "tool_use");
      }
      // The lead whose Tester's command waits while the developer switches the session to Full access.
      if (all.includes("run it under a switch")) {
        if (/\[Filament: your tester sa_[0-9a-f]{8}/.test(all)) return say("LEAD SAW THE SWITCH");
        if (/Launched tester sa_/.test(all)) return use("toolu_wait_mode", "wait", { seconds: 60 });
        return use("toolu_mode_launch", "agent", SWITCHED);
      }
      // The lead of the Builder in a patch: it launches it, waits for its report and applies its work.
      if (all.includes("build the patch note")) {
        if (all.includes("Applied the changes of sub-agent")) return say("LEAD DONE: patch-note.txt is in.");
        const done = /\[Filament: your builder (sa_[0-9a-f]{8})/.exec(all);
        if (done) return use("toolu_pnote_apply", "worker", { agent_id: done[1], apply_changes: true });
        if (/Launched builder sa_/.test(all)) return use("toolu_pnote_wait", "wait", { seconds: 60 });
        return use("toolu_pnote_build", "agent", IN_PATCH);
      }
      // The lead of the Builder that strays: it launches it, waits for its report and applies its work, once.
      if (all.includes("build past the worktree")) {
        if (all.includes("Applied the changes of sub-agent")) return say("LEAD DONE: stray.txt is in.");
        if (all.includes("toolu_stray_apply")) return say("LEAD SAW NO APPLY");
        const strayed = /\[Filament: your builder (sa_[0-9a-f]{8})/.exec(all);
        if (strayed) return use("toolu_stray_apply", "worker", { agent_id: strayed[1], apply_changes: true });
        if (/Launched builder sa_/.test(all)) return use("toolu_stray_wait", "wait", { seconds: 60 });
        return use("toolu_stray", "agent", STRAY);
      }
      if (all.includes("Applied the changes of sub-agent")) return say("LEAD DONE: note.txt is in.");
      const built = /\[Filament: your builder (sa_[0-9a-f]{8})/.exec(all);
      if (built) return use("toolu_apply", "worker", { agent_id: built[1], apply_changes: true });
      if (/\[Filament: your scout sa_[0-9a-f]{8}/.test(all)) return say("LEAD SAW THE SCOUT");
      if (/Launched (builder|scout) sa_/.test(all)) return use("toolu_wait", "wait", { seconds: 60 });
      if (all.includes("build the note")) return use("toolu_build", "agent", BUILD);
      if (all.includes("scout it")) return use("toolu_scout", "agent", SCOUT);
      return say("LEAD ANSWER");
    }
    return say("MODEL ANSWER");
  });
  shim = await startApp({ memory: true, keep: true, configure });
});
after(async () => {
  await shim.stop();
  await up.close();
  await removeDirs(folder, shim.dataDir);
});

/** The app's settings, at its start and at a restart on the same data. @param {any} cfg @param {{ dataDir: string }} ctx */
function configure(cfg, { dataDir }) {
  cfg.upstreams = [
    { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 }, "m-cheap": { input: 1, output: 1, contextTokens: 64000 } } },
    { id: "cli", name: "cli", type: "acp", enabled: true, acp: { command: process.execPath, args: [FAKE_ACP_AGENT], cwdDefault: dataDir, permissions: "allow-all" } },
  ];
  cfg.routes = [
    { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
    { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true },
  ];
  cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
  cfg.memory.autopilot = { enabled: false };
}

/** What a tool call answered in a request: the text of the tool_result for `id`, or null. @param {any} body @param {string} id */
const resultIn = (body, id) => {
  for (const m of body?.messages || [])
    for (const b of Array.isArray(m.content) ? m.content : []) if (b?.type === "tool_result" && b.tool_use_id === id) return textOf(b.content);
  return null;
};
/** A run's events so far, through the run's route. @param {string} runId */
const runEvents = async (runId) => /** @type {any[]} */ ((await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0`)).json()).events || []);

/**
 * A harness session in the repository. Its lead does not read along with its workers (`engine.supervise` off): these
 * tests script a lead to the flow that switch keeps — a wait that answers with the watch, a turn whose model calls are
 * counted. The lead that reads along is test/lead-reads-live.test.js's.
 * @param {any} given @param {string} [model]
 */
const newSession = async (given, model = "m-1") => {
  const settings = given?.engine ? { ...given, engine: { supervise: false, ...given.engine } } : given;
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model, preset: "plain", settings } });
  assert.equal(r.status, 200, await r.clone().text());
  return String((await r.json()).id);
};
/** One harness turn, answered whole. @param {string} id @param {string} content */
const turn = async (id, content, extra = {}) => {
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false, ...extra } });
  assert.equal(r.status, 200, await r.clone().text());
  return { text: textOf((await r.json()).content), id: String(r.headers.get("x-filament-request-id")) };
};

// (fails before: yes — a team's session ran the loop's own prompt and tools: its lead did the work itself, and no
// worker ran as a role)
test("a harness session under Builders: its lead briefs a Builder, waits for the report and applies the work; the Builder runs on the pool's model as its role, with the session's hands and MCP servers, and compacts at its own model's line", async (ctx) => {
  // Memory keeps a run's outcome only where its autopilot is on (M7-D51); its tools stay off, so the lists below are
  // the loop's own.
  const autopilot = /** @type {any} */ (shim.app).config.memory.autopilot;
  Object.assign(autopilot, { enabled: true, tools: false });
  ctx.after(() => Object.assign(autopilot, { enabled: false }));
  // In a worktree: its copy's own record is read below (a Builder in a patch is the test after this one).
  const id = await newSession({
    engine: { mode: "team", team: "builders" },
    subagents: { pool: [{ model: "m-cheap", seats: 4 }], workspace: "worktree" },
    plugins: { mcp: [NOTES] },
    loop: { rules: [{ tool: "mcp__notes__write_note", pattern: "*", verdict: "allow" }] },
  });
  const mark = up.received.length;
  const t = await turn(id, "build the note");
  assert.equal(t.text, "LEAD DONE: note.txt is in.");
  const calls = up.received.slice(mark);

  // The lead: its own prompt and tools — every hand, and the session's MCP servers too (HarnessV4_Tasks decision 9).
  const lead = calls.filter(isLead);
  assert.equal(lead.length, 4, "the launch, the wait, the apply, the answer");
  for (const c of lead) assert.deepEqual(toolNames(c.body).filter((n) => !n.startsWith("mcp__")), LEAD_TOOLS);
  for (const c of lead) assert.ok(["mcp__notes__echo", "mcp__notes__write_note"].every((n) => toolNames(c.body).includes(n)), toolNames(c.body).join(", "));
  const leadSystem = sysOf(lead[0].body);
  assert.ok(leadSystem.includes(`# Your team: Builders\n${SHIPPED_CARDS.buildlead.thinks}\n\n${PROMPT.headLead}`), "the team's persona after the lead's role: its Lead's words alone");
  // (fails before: yes — HarnessV3-TaskGraph-v2 TG2-D47: a lead knew nothing of the models its workers run on)
  assert.ok(leadSystem.includes("\n- Your workers run on m-cheap.\n"), "its lines name its workers' model: the session's pool of one model");
  assert.ok(!leadSystem.includes(PROMPT.role), "none of a coding agent's lines but its hands");
  assert.ok(leadSystem.includes(`${PROMPT.mcp} notes (`), "the session's MCP server, as the solo loop names it");
  assert.equal(lead[0].body.model, "m-1", "the lead runs on the session's model");

  // The Builder: the pool's model, its role's prompt with the team's words, the session's hands and MCP tools.
  const builder = calls.filter(isWorker);
  assert.ok(builder.length >= 4, `it read, wrote and reported: ${builder.length} calls`);
  for (const c of builder) assert.equal(c.body.model, "m-cheap", "workers run on the session's pool");
  const workerSystem = sysOf(builder[0].body);
  assert.ok(workerSystem.includes(SHIPPED_CARDS.builder.thinks) && workerSystem.includes(`Team Builders asks of you: ${SHIPPED_TEAMS.builders.members.find((m) => m.tag === "builder")?.line}`));
  const names = toolNames(builder[0].body);
  for (const has of ["read", "write", "edit", "bash", "mcp__notes__echo", "mcp__notes__write_note"]) assert.ok(names.includes(has), `${has} in ${names}`);
  for (const never of ["ask", "plan", "agent", "worker", "wait"]) assert.ok(!names.includes(never), `${never} is not a worker's`);
  assert.ok(names.includes("envelope"), "its envelope writes its lead (the owner's of 11-04)");
  assert.deepEqual(builder[0].body.messages[0].content.map((/** @type {any} */ b) => b.text), [SUBAGENT_NOTES.workerWorktree, BRIEF], "its worktree's note and its brief, nothing of the lead's conversation");

  // The work: applied by the lead into the folder. (fails before: yes — the bug hunt of 10-30, PERM-3: the Builder's MCP
  // server ran in the session's folder, so the note its relative name made landed in the developer's folder past the
  // worktree and its fence, and the apply brought the Builder's own file alone.) Its server ran in its worktree: what it
  // wrote by a relative name is the Builder's work, and reached the folder by the apply.
  assert.equal(readFileSync(join(folder, "note.txt"), "utf8"), "hello from the builder\n");
  assert.equal(readFileSync(join(folder, "from-mcp.txt"), "utf8"), "via the session's server");
  assert.ok(JSON.stringify(lead[3].body.messages).includes("to your folder: 2 files (+2 −0) — from-mcp.txt, note.txt."), "the server wrote in the worktree: the apply brought its note with the Builder's");
  const { subagents } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
  assert.equal(subagents.length, 1);
  const [sa] = subagents;
  // Its team leads the session: its row says so (`charge`).
  assert.deepEqual([sa.engine, sa.team, sa.card.tag, sa.model, sa.status, sa.work?.applied], ["loop", { key: "builders", name: "Builders", role: "builder", place: "builder", charge: true }, "builder", "m-cheap", "done", 1]);
  // (fails before: no — a guard the mutation pass asked for: the lead's door knows it leads, so the report it reads
  // names worker for the apply and the follow-up)
  const report = JSON.stringify(lead[2].body.messages);
  for (const hint of [`To apply them, call worker with agent_id \\"${sa.id}\\" and apply_changes: true`, `To ask it more in the same context, call worker with agent_id \\"${sa.id}\\".`])
    assert.ok(report.includes(hint), `${hint}\n${report.slice(-1500)}`);
  assert.equal(copyState(String(await taskWorktreePath(folder, sa.id))), "parked", "its copy is parked for its next question");

  // (fails before: yes — the Builder's own request rode the session's chain as a client of its own: the row said
  // node and agent/m-cheap, and the Builder's calls that would ask were refused in words)
  const row = /** @type {any} */ (shim.app).memory.archive.getChain(id);
  assert.deepEqual([row.client, row.model], ["harness", "m-1"], "a worker's run rides the session's chain without becoming its client or its model");

  // The records: the lead names its team; the worker its team and role, its own window and its compaction.
  const leadRec = await shim.record(t.id);
  assert.deepEqual([leadRec.upstream, leadRec.agent?.team], ["agent-loop", { key: "builders", name: "Builders" }]);
  for (const note of [
    "agent: team Builders' lead (engine.team): its workers do the work — agent launches them, worker messages, stops or follows up on them — and it has every hand of its own, under the permission mode, for a piece better done itself",
  ])
    assert.ok(leadRec.changes.includes(note), `${note}\n${leadRec.changes.join("\n")}`);
  assert.ok(leadRec.changes.some((/** @type {string} */ c) => c.startsWith("agent: MCP server notes offers ")), leadRec.changes.join("\n"));
  const workRec = await shim.record(sa.runId);
  assert.deepEqual([workRec.agent?.team, workRec.agent?.subagent], [{ key: "builders", name: "Builders", role: "builder" }, "builder"]);
  assert.ok(workRec.changes.includes(`agent: team Builders' builder ${sa.id} (Builder) — the session's tools without ask, plan, agent, wait; a call that would ask waits for the developer's answer`), workRec.changes.join("\n"));
  assert.ok(workRec.changes.some((/** @type {string} */ c) => /^agent: the session's MCP servers run in this worker's own worktree \(.+\), started for its run and closed with it$/.test(c)), workRec.changes.join("\n"));
  assert.ok(!leadRec.changes.some((/** @type {string} */ c) => c.includes("own worktree (")), "the lead's are the session's");
  assert.ok(workRec.changes.some((/** @type {string} */ c) => /^agent: compacted rounds 1–\d+ of this turn at the compaction line, summarized by m-cheap/.test(c)), workRec.changes.join("\n"));
  assert.deepEqual([leadRec.context?.window, workRec.context?.window], [200000, 64000], "each on its own model's window");
  assert.equal(workRec.context.usable, Math.floor((64000 * leadRec.context.usable) / 200000), "the same line, on its own window");
  const { run } = await (await shim.api(`/api/runs/${encodeURIComponent(sa.runId)}`)).json();
  assert.deepEqual([run.kind, run.parentId, run.title], ["subagent", t.id, `builder ${sa.id}`]);

  // On the lead's timeline, the Builder's start and end sit at the round that launched it.
  const { events } = await (await shim.api(`/api/runs/${encodeURIComponent(t.id)}/events?since=0`)).json();
  const at = events.find((/** @type {any} */ e) => e.type === "tool-start" && e.id === "toolu_build")?.round;
  const start = events.find((/** @type {any} */ e) => e.type === "subagent-start" && e.agentId === sa.id);
  const end = events.find((/** @type {any} */ e) => e.type === "subagent-end" && e.agentId === sa.id);
  assert.ok(at > 0);
  assert.deepEqual([start?.parent, start?.round, start?.background, end?.parent, end?.round], ["toolu_build", at, true, "toolu_build", at]);

  // (fails before: yes — V4-D82: the lead's log named no run of its Builder, and no route read a sub-agent's end
  // from its own run's log — a card whose sub-agent the registry had lost could only say "End unknown")
  const named = events.find((/** @type {any} */ e) => e.type === "subagent-run" && e.agentId === sa.id);
  assert.deepEqual([named?.parent, named?.round, named?.exchange, named?.run], ["toolu_build", at, 0, sa.runId], "the lead's log names the Builder's own run");
  assert.ok(events.indexOf(start) < events.indexOf(named) && events.indexOf(named) < events.indexOf(end), "after its start, once its run exists");
  const endOf = (/** @type {string} */ sid, /** @type {string} */ run, session = id) => shim.api(`/api/sessions/${encodeURIComponent(session)}/subagents/${encodeURIComponent(sid)}/end?run=${encodeURIComponent(run)}`);
  const logged = await (await endOf(sa.id, sa.runId)).json();
  const held = sa.exchanges[0];
  assert.deepEqual(
    [logged.run, logged.end.status, logged.end.rounds, logged.end.toolCalls, logged.end.tokensIn, logged.end.tokensOut, logged.end.error, logged.end.failure],
    [sa.runId, "done", held.rounds, held.toolCalls, held.tokensIn, held.tokensOut, null, null],
    "its run's log says the end the registry holds",
  );
  assert.equal(logged.end.report, held.report, "and its report: the words of its last round");
  assert.ok(logged.end.endedAt >= logged.end.startedAt && logged.end.ms === logged.end.endedAt - logged.end.startedAt);
  for (const [why, res] of [
    ["another sub-agent's id", await endOf("sa_none", sa.runId)],
    ["the lead's own run: not a sub-agent's", await endOf(sa.id, t.id)],
    ["another session", await endOf(sa.id, sa.runId, "no-such-session")],
    ["no run named", await endOf(sa.id, "")],
    ["a run the log does not hold", await endOf(sa.id, "req-never-was")],
  ])
    assert.equal(/** @type {Response} */ (res).status, 404, String(why));
  assert.match((await (await endOf(sa.id, "req-never-was")).json()).error, /^no run req-never-was of sub-agent sa_[0-9a-z]+ in this session: the run log holds none under that id/);

  // Memory: the Builder's exchange is a worker's outcome, by its role.
  const out = await (await shim.api("/api/memory/outcomes?days=30&kind=worker")).json();
  assert.deepEqual([out.runs, out.groups.map((/** @type {any} */ g) => [g.kind, g.model])], [1, [["worker", "m-cheap"]]], JSON.stringify(out));
  const rows = /** @type {any} */ (shim.app.memory).archive.outcomes.list({ since: 0, kind: "worker" });
  assert.deepEqual(rows.map((/** @type {any} */ o) => [o.agent, o.model, o.ended]), [["builder", "m-cheap", "done"]]);
});

// (fails before: no — the counterpart of the one above for a Builder on Auto, which works in a patch)
test("a Builder under Builders on Auto works in a patch, no checkout: its lead applies its work, and its patch is parked for its next question", async () => {
  const id = await newSession({ engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "m-cheap", seats: 4 }] } });
  const t = await turn(id, "build the patch note");
  assert.equal(t.text, "LEAD DONE: patch-note.txt is in.");
  assert.equal(readFileSync(join(folder, "patch-note.txt"), "utf8"), "hello from the patch\n");
  const { subagents } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
  assert.deepEqual(subagents.map((/** @type {any} */ s) => [s.card.tag, s.status, s.work?.applied]), [["builder", "done", 1]]);
  const dest = String(await taskWorktreePath(folder, subagents[0].id));
  assert.equal(existsSync(join(dest, ".git")), false, "no checkout");
  assert.equal(patchRecordOf(dirname(dest), subagents[0].id)?.state, "parked", "its patch is parked for its next question");
});

// (fails before: yes — a coding agent's name under a team kept its own turn, the team named only in the settings; the
// owner's rule of 10-31: a team answers a harness session's turns alone, so it runs in one)
test("a coding agent's name under a team: the agent leads the team as itself, said on the record; /team says the team leads", async () => {
  const h = await newSession({ engine: { mode: "team", team: "builders" } }, "coder-1");
  const { engine } = await (await shim.api(`/api/sessions/${encodeURIComponent(h)}/settings`)).json();
  assert.deepEqual([engine.mode, engine.team, engine.active, engine.problem], ["team", "builders", true, null]);
  const r = await turn(h, "hello coder");
  assert.match(r.text, /echo\(\d+\): [^]*hello coder$/m, "the coding agent answered");
  const rec = await shim.record(r.id);
  assert.equal(rec.upstream, "cli");
  const notes = [...(rec.priorChanges || []), ...rec.changes];
  assert.ok(notes.includes("engine: team Builders answers this session's turns (engine.team), its lead the coding agent coder-1"), notes.join("\n"));
  assert.ok(notes.some((c) => c.startsWith("acp: cli leads team Builders (engine.team): its workers do the work")), notes.join("\n"));
  assert.deepEqual(rec.acp.team, { key: "builders", name: "Builders", spentUsd: 0 });
  const leads = /^\*\*Teams\*\* — this chat's turns go to team \*\*Builders\*\*\.$/m;
  assert.match((await turn(h, "/team")).text, leads);
});
// (fails before: yes — a worker's command that needed approval was refused in words, the lead could not reach a running
// worker, its wait said only what woke it, and nothing marked a worker's work its lead corrected)
test("the watched run: a Tester's command waits for the developer's answer while its lead's wait shows it waiting; the lead's message reaches it as it works; the developer's answer runs it; and the lead's correction reaches memory", async (ctx) => {
  const autopilot = /** @type {any} */ (shim.app).config.memory.autopilot;
  Object.assign(autopilot, { enabled: true, tools: false });
  ctx.after(() => Object.assign(autopilot, { enabled: false }));
  const id = await newSession({ engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "m-cheap", seats: 4 }] } });
  const S = `/api/sessions/${encodeURIComponent(id)}`;
  const mark = up.received.length;
  const pending = turn(id, "check the version");

  // The Tester's `node -p process.version` waits for the developer, and the lead's message reached its run.
  const tester = await until(async () => {
    const { subagents } = await (await shim.api(`${S}/subagents`)).json();
    return subagents.find((/** @type {any} */ s) => s.team?.role === "tester" && s.progress?.asking && s.runId) || null;
  }, "the Tester to wait for the developer's answer", { timeoutMs: 30_000 });
  assert.match(tester.progress.asking.question, /^May I run this command\? `node -p process.version` — /);
  assert.deepEqual([tester.progress.asking.tool, tester.progress.asking.args], ["bash", "node -p process.version"]);
  // (fails before: yes — a running worker's spend was known only once it ended)
  assert.ok(tester.progress.spent > 0, "while it waits, the Tester's row says what its calls have cost so far");
  // (fails before: no — a guard the mutation pass asked for: the first test reads the row once the turn is over, when
  // the lead's own requests could have written a model back; while a worker runs, none of its own may be there)
  const row = /** @type {any} */ (shim.app).memory.archive.getChain(id);
  assert.deepEqual([row.client, row.model], ["harness", "m-1"], "while its Tester waits, the session keeps the developer's client and model");
  await until(async () => (await runEvents(tester.runId)).some((e) => e.type === "steer" && e.from === "lead" && e.text === TOLD), "the lead's message to reach the Tester's run");

  // The developer asks the lead how it goes, while the lead waits: its wait answers with the Tester waiting on them.
  const lead = String((await (await shim.api(`/api/runs/${encodeURIComponent(tester.runId)}`)).json()).run.parentId);
  await until(async () => (await runEvents(lead)).some((e) => e.type === "tool-start" && e.id === "toolu_wait"), "the lead to wait");
  const asked = await shim.api(`/api/runs/${encodeURIComponent(lead)}/steer`, { method: "POST", body: { kind: "note", text: "How is the tester doing?" } });
  assert.equal(asked.status, 200, await asked.clone().text());
  await until(async () => (await runEvents(lead)).some((e) => e.type === "tool-end" && e.id === "toolu_wait"), "the lead's wait to return");

  // The session's route answers the Tester: what it refuses, then the developer's yes, once.
  const answer = (/** @type {string} */ sid, /** @type {any} */ body) => shim.api(`${S}/subagents/${encodeURIComponent(sid)}/answer`, { method: "POST", body });
  const blank = await answer(tester.id, { answer: " " });
  assert.deepEqual([blank.status, (await blank.json()).error], [400, "a JSON object is required: { answer, allow?, go? } — allow: true runs the call, go: true lets a plan start; without them, answer says what to do instead"]);
  const stranger = await answer("sa_00000000", { answer: "yes" });
  assert.deepEqual([stranger.status, (await stranger.json()).error], [404, "no such sub-agent in this session"]);
  const other = await newSession({ engine: { mode: "team", team: "builders" } });
  const elsewhere = await shim.api(`/api/sessions/${encodeURIComponent(other)}/subagents/${encodeURIComponent(tester.id)}/answer`, { method: "POST", body: { answer: "yes" } });
  assert.deepEqual([elsewhere.status, (await elsewhere.json()).error], [404, "no such sub-agent in this session"], "another session's worker");
  // (fails before: yes — the route took no question's number, and settled whatever waited)
  assert.equal(tester.progress.asking.n, 1, "its first question is ask 1");
  for (const ask of [0, 1.5, "1"]) {
    const bad = await answer(tester.id, { answer: "yes", ask });
    assert.deepEqual([bad.status, (await bad.json()).error], [400, "ask is the number of the question the answer is for: a whole number from 1"], `ask ${JSON.stringify(ask)}`);
  }
  const ahead = await answer(tester.id, { answer: "yes", ask: 2 });
  assert.deepEqual([ahead.status, (await ahead.json()).error], [409, `tester ${tester.id} has asked no ask 2: it waits on ask 1`], "an ask never asked settles nothing");
  const yes = await answer(tester.id, { answer: "yes", allow: true, ask: 1 });
  const said = await yes.json();
  assert.deepEqual([yes.status, said.ok, said.subagent?.id, said.subagent?.progress?.asking], [200, true, tester.id, null]);
  const twice = await answer(tester.id, { answer: "yes" });
  assert.deepEqual([twice.status, (await twice.json()).error], [409, `tester ${tester.id} is not waiting for an answer`]);
  const settled = await answer(tester.id, { answer: "yes", ask: 1 });
  assert.deepEqual([settled.status, (await settled.json()).error], [409, `tester ${tester.id} is not waiting for an answer: ask 1 is settled`]);

  const t = await pending;
  assert.equal(t.text, "LEAD DONE: the version is checked.");
  const calls = up.received.slice(mark);
  const leads = calls.filter(isLead).map((c) => c.body);
  const testers = calls.filter(isWorker).map((c) => c.body);

  // The lead's first wait: the developer's message woke it, and the watch shows the Tester waiting on the developer.
  const woke = leads.map((b) => resultIn(b, "toolu_wait")).find(Boolean);
  assert.match(
    String(woke),
    new RegExp(`^Waited \\d+ s: the developer sent a message\\. It follows\\.\\n\\nWorkers still running \\(1\\):\\n- tester ${tester.id} \\("Check the version"\\): round 1 · waiting for the developer's answer \\(ask 1\\) — may it run bash \`node -p process.version\`\\? · context ≈[\\d,]+ of 64,000 tokens \\(\\d+%\\)$`),
  );
  // The second: the report woke it, and no worker runs any more.
  assert.match(String(leads.map((b) => resultIn(b, "toolu_wait2")).find(Boolean)), /^Waited \d+ s: a sub-agent reported\. Its report follows as a message\.\n\nNo worker is running now\.$/);
  // The lead's message goes out beside the Tester's first round: sent before the Tester asks, or while it waits for the
  // developer's answer — which the answer then says (TG2-D36).
  assert.match(
    String(leads.map((b) => resultIn(b, "toolu_msg")).find(Boolean)),
    new RegExp(`^Sent to tester ${tester.id}: (it reads your message at its next step, while it works|it waits for the developer's answer on a bash call \\(ask 1\\) now, and reads your message at its next step after that answer)\\. Its report still arrives as a message when it finishes\\.$`),
  );

  // The Tester: its lead's message read once, in its lead's words; the developer's yes ran the command.
  assert.equal(JSON.stringify(testers.at(-1)?.messages).split(JSON.stringify(TOLD_BLOCK).slice(1, -1)).length - 1, 1, "its conversation holds it once, as its lead's");
  const ran = testers.map((b) => resultIn(b, "toolu_ver")).find(Boolean);
  assert.ok(String(ran).includes(process.version), String(ran));
  const testRec = await shim.record(tester.runId);
  for (const note of ["agent: bash waited for the developer's answer", "agent: the developer allowed bash"]) assert.ok(testRec.changes.includes(note), `${note}\n${testRec.changes.join("\n")}`);

  // The lead's timeline: the Tester's question and its answer, at the round that launched it.
  const events = await runEvents(lead);
  const at = events.find((e) => e.type === "tool-start" && e.id === "toolu_test")?.round;
  const ask = events.find((e) => e.type === "subagent-ask" && e.agentId === tester.id);
  const end = events.find((e) => e.type === "subagent-ask-end" && e.agentId === tester.id);
  assert.deepEqual([ask?.parent, ask?.round, ask?.tool, ask?.args, ask?.question], ["toolu_test", at, "bash", "node -p process.version", tester.progress.asking.question]);
  assert.deepEqual([end?.parent, end?.round, end?.answered], ["toolu_test", at, true]);

  // The lead's correction: the record says memory counts the Tester's first task as corrected; its outcome says so.
  const leadRec = await shim.record(t.id);
  assert.ok(leadRec.changes.includes(`agent: a correction to tester ${tester.id} (m-cheap) in the background — memory counts its last task as corrected`), leadRec.changes.join("\n"));
  // An outcome names the card its worker ran as — the Tester's is Builder's —, so the Tester's are its own exchanges'.
  const its = new Set(((await (await shim.api(`${S}/subagents/${encodeURIComponent(tester.id)}`)).json()).subagent?.exchanges || []).map((/** @type {any} */ x) => x.runId));
  const rows = /** @type {any} */ (shim.app.memory).archive.outcomes.list({ since: 0, kind: "worker" }).filter((/** @type {any} */ o) => o.agent === "builder" && its.has(o.request_id));
  assert.deepEqual(rows.map((/** @type {any} */ o) => [o.request_id, o.corrected]), [[tester.runId, "lead"], [rows[1]?.request_id, null]], "the task that fell short, not the one that answered it");
});

// (fails before: yes — HarnessV4_Tasks decision 10: the developer reached a working worker only through its lead)
test("the developer tells a working Tester something past its lead: it reads their words with its command's result, as theirs; its lead's wait wakes to what they told it, said once; and what the route refuses", async () => {
  const id = await newSession({ engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "m-cheap", seats: 4 }] } });
  const S = `/api/sessions/${encodeURIComponent(id)}`;
  const mark = up.received.length;
  const pending = turn(id, "tell it past the lead");
  const tester = await until(async () => {
    const { subagents } = await (await shim.api(`${S}/subagents`)).json();
    return subagents.find((/** @type {any} */ s) => s.description === PAST.description && s.progress?.asking && s.runId) || null;
  }, "the Tester to wait for the developer's answer", { timeoutMs: 30_000 });
  const lead = String((await (await shim.api(`/api/runs/${encodeURIComponent(tester.runId)}`)).json()).run.parentId);
  await until(async () => (await runEvents(lead)).some((e) => e.type === "tool-start" && e.id === "toolu_wait_past"), "the lead to wait", { timeoutMs: 30_000 });
  const message = (/** @type {string} */ sid, /** @type {any} */ body) => shim.api(`${S}/subagents/${encodeURIComponent(sid)}/message`, { method: "POST", body });
  const blank = await message(tester.id, { text: "  " });
  assert.deepEqual([blank.status, (await blank.json()).error], [400, "a JSON object is required: { text } — your words for it"]);
  const stranger = await message("sa_00000000", { text: "hi" });
  assert.deepEqual([stranger.status, (await stranger.json()).error], [404, "no such sub-agent in this session"]);
  // It waits on the developer's answer: their words reach it after that answer, which the route says.
  const sent = await message(tester.id, { text: PAST_WORDS });
  assert.deepEqual([sent.status, await sent.json()], [200, { ok: true, told: "turn", asking: "bash" }]);
  await until(async () => (await runEvents(tester.runId)).some((e) => e.type === "steer" && e.from === "harness" && e.text === PAST_WORDS), "the words to reach the Tester's run");
  // Its lead's wait wakes to what they told it, before the Tester has done anything more.
  await until(async () => (await runEvents(lead)).some((e) => e.type === "tool-end" && e.id === "toolu_wait_past"), "the lead's wait to wake", { timeoutMs: 30_000 });
  const yes = await shim.api(`${S}/subagents/${encodeURIComponent(tester.id)}/answer`, { method: "POST", body: { answer: "yes", allow: true } });
  assert.equal(yes.status, 200, await yes.clone().text());

  const t = await pending;
  assert.equal(t.text, "LEAD HEARD WHAT YOU TOLD IT");
  const calls = up.received.slice(mark);
  const leads = calls.filter(isLead).map((c) => c.body);
  const testers = calls.filter(isWorker).map((c) => c.body);
  // The Tester: their words once, as the developer's, with its command's result.
  const heard = `Message from the developer, relayed by Filament (1 message). Acknowledge what you heard in your next reply before acting on it:\n- ${PAST_WORDS}`;
  assert.equal(JSON.stringify(testers.at(-1)?.messages).split(JSON.stringify(heard).slice(1, -1)).length - 1, 1, "its conversation holds them once, as the developer's");
  assert.ok(String(testers.map((b) => resultIn(b, "toolu_pastver")).find(Boolean)).includes(process.version), "the developer's yes ran its command");
  // The lead: its wait said what woke it, and the line says whom the developer told what, once.
  assert.match(String(leads.map((b) => resultIn(b, "toolu_wait_past")).find(Boolean)), /^Waited \d+ s: the developer wrote to one of your workers directly\. What they wrote follows as a message\./);
  const told = `[Filament: the developer wrote to your tester ${tester.id} ("${PAST.description}") directly, past you:\n${PAST_WORDS}\n\nIt reads that at its next step as their own message, so you need not pass it on: weigh it in what you tell ${tester.id} from now on.]`;
  assert.equal(JSON.stringify(leads.at(-1)?.messages).split(JSON.stringify(told).slice(1, -1)).length - 1, 1, "the lead's conversation holds the line once");
  // The lead's timeline: where it read what the developer told its Tester.
  const reports = (await runEvents(lead)).filter((e) => e.type === "subagent-report");
  assert.deepEqual(reports.map((e) => [e.kind, e.agentId]), [["told", tester.id], ["report", tester.id]]);
  // Done, it reads no more.
  const late = await message(tester.id, { text: "One more thing." });
  assert.deepEqual([late.status, (await late.json()).error], [409, `sub-agent ${tester.id} is not running`]);
});

// (fails before: yes — HarnessV4_Tasks decision 9: a lead's own tools were read, grep and glob, so it had no write)
test("a lead does a piece itself with its own hands, under the session's permission mode: under Edit its write lands in the folder; under Read-only it is refused in the mode's words; under Ask it waits for the developer's yes, as the solo loop's does", async () => {
  const team = { engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "m-cheap", seats: 4 }] } };
  const mark = up.received.length;
  try {
    const t = await turn(await newSession(team), "fix it yourself");
    assert.match(t.text, /^LEAD WROTE IT: /, t.text);
    assert.equal(readFileSync(join(folder, "own.txt"), "utf8"), "by the lead\n", "Validate holds its orders, not its own hands: those answer to the mode");
    const lead = up.received.slice(mark).filter(isLead);
    assert.ok(lead.every((c) => toolNames(c.body).includes("write")), "write is among its tools");
  } finally {
    rmSync(join(folder, "own.txt"), { force: true });
  }
  const refused = await turn(await newSession({ ...team, loop: { permissions: "read-only" } }), "fix it yourself");
  assert.match(refused.text, /^LEAD WROTE IT: .*read-only/is, refused.text);
  assert.equal(existsSync(join(folder, "own.txt")), false);
  // Under Ask its write waits for the developer's answer, as their agent's does, and their yes runs it.
  const asks = await newSession({ ...team, loop: { permissions: "ask" } });
  try {
    const q = await turn(asks, "fix it yourself");
    assert.match(q.text, /May I write own\.txt\?/, q.text);
    assert.equal(existsSync(join(folder, "own.txt")), false, "nothing written before the answer");
    const yes = await turn(asks, "yes", { allow: true });
    assert.match(yes.text, /^LEAD WROTE IT: /, yes.text);
    assert.equal(readFileSync(join(folder, "own.txt"), "utf8"), "by the lead\n");
  } finally {
    rmSync(join(folder, "own.txt"), { force: true });
  }
});

// (fails before: yes — the lead could not stop a worker, nothing waited to be stopped, and the report said a stopped
// worker ended "stopped" with no word of who stopped it)
test("the lead stops its Tester while its command waits for the developer: the wait ends unanswered, the Tester ends stopped by its lead, and the lead hears it was stopped as it asked", async () => {
  const id = await newSession({ engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "m-cheap", seats: 4 }] } });
  const S = `/api/sessions/${encodeURIComponent(id)}`;
  const mark = up.received.length;
  const pending = turn(id, "stop the slow probe");
  const tester = await until(async () => {
    const { subagents } = await (await shim.api(`${S}/subagents`)).json();
    return subagents.find((/** @type {any} */ s) => s.team?.role === "tester" && s.progress?.asking && s.runId) || null;
  }, "the Tester to wait for the developer's answer", { timeoutMs: 30_000 });
  const lead = String((await (await shim.api(`/api/runs/${encodeURIComponent(tester.runId)}`)).json()).run.parentId);
  await until(async () => (await runEvents(lead)).some((e) => e.type === "tool-start" && e.id === "toolu_wait_s"), "the lead to wait");
  const told = await shim.api(`/api/runs/${encodeURIComponent(lead)}/steer`, { method: "POST", body: { kind: "note", text: "Stop the tester." } });
  assert.equal(told.status, 200, await told.clone().text());
  const t = await pending;
  assert.equal(t.text, "LEAD STOPPED IT");
  const leads = up.received.slice(mark).filter(isLead).map((c) => c.body);
  assert.equal(leads.map((b) => resultIn(b, "toolu_stop")).find(Boolean), `Stopping tester ${tester.id} now; its report so far arrives as a message.`);
  const heard = JSON.stringify(leads.at(-1)?.messages);
  assert.ok(heard.includes(JSON.stringify(`[Filament: your tester ${tester.id} ("Probe slowly") was stopped as you asked.`).slice(1, -1)), heard.slice(-1500));
  const rec = await shim.record(tester.runId);
  assert.deepEqual([rec.agent?.status, rec.agent?.stoppedBy], ["stopped", "lead"]);
  const end = (await runEvents(lead)).find((e) => e.type === "subagent-ask-end" && e.agentId === tester.id);
  assert.equal(end?.answered, false, "the wait ended with no answer");
  const late = await shim.api(`${S}/subagents/${encodeURIComponent(tester.id)}/answer`, { method: "POST", body: { answer: "yes" } });
  assert.deepEqual([late.status, (await late.json()).error], [409, `tester ${tester.id} is not waiting for an answer`]);
});

// (fails before: yes — the route took no permission switch: the Tester's command was answered "Not run" in its words)
test("the developer switches the session to Full access while a Tester's command waits: the switch answers it through the session's route, and judged again, it runs", async () => {
  const id = await newSession({ engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "m-cheap", seats: 4 }] } });
  const S = `/api/sessions/${encodeURIComponent(id)}`;
  const mark = up.received.length;
  const pending = turn(id, "run it under a switch");
  const tester = await until(async () => {
    const { subagents } = await (await shim.api(`${S}/subagents`)).json();
    return subagents.find((/** @type {any} */ s) => s.team?.role === "tester" && s.progress?.asking && s.runId) || null;
  }, "the Tester to wait for the developer's answer", { timeoutMs: 30_000 });
  const patched = await shim.api(`${S}/settings`, { method: "PATCH", body: { patch: { loop: { permissions: "auto" } } } });
  assert.equal(patched.status, 200, await patched.clone().text());
  const switched = await shim.api(`${S}/subagents/${encodeURIComponent(tester.id)}/answer`, { method: "POST", body: { answer: "Switched to Full access", modeSwitch: true } });
  assert.equal(switched.status, 200, await switched.clone().text());
  const t = await pending;
  assert.equal(t.text, "LEAD SAW THE SWITCH");
  const ran = up.received.slice(mark).filter(isWorker).map((c) => resultIn(c.body, "toolu_modever")).find(Boolean);
  assert.ok(String(ran).includes(process.version), String(ran));
  const rec = await shim.record(tester.runId);
  assert.ok(rec.changes.includes("agent: the developer switched the mode to auto while bash waited — judged again under it"), rec.changes.join("\n"));
  assert.ok(!rec.changes.includes("agent: the developer allowed bash"), "no yes was said: the mode ran it");
});

// (fails before: yes — under Full access a worker on Filament's loop wrote into the developer's folder, by its write hand
// and by its shell, past its lead's apply and the folder's check: TG2-D55's drive found it)
test("under Full access a Builder in its own worktree is held to it: a change of the developer's folder, by its write hand or its shell, is refused in Filament's words, and its work reaches the folder by the apply alone", async (ctx) => {
  ctx.after(() => rmSync(join(folder, "stray.txt"), { force: true }));
  const id = await newSession({ engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "m-cheap", seats: 4 }] }, loop: { permissions: "auto" } });
  const mark = up.received.length;
  const t = await turn(id, "build past the worktree");
  assert.equal(t.text, "LEAD DONE: stray.txt is in.");
  const asked = up.received.slice(mark).filter(isWorker).map((c) => c.body);
  const answer = (/** @type {string} */ call) => String(asked.map((b) => resultIn(b, call)).find((x) => x != null));
  assert.match(answer("toolu_stray_out"), /^Filament refused your change to .*stray\.txt: that is the developer's folder, and you work in your own worktree\. The same file is .*stray\.txt — read and change that one\./);
  assert.match(answer("toolu_stray_sh"), /^Filament refused your command: it reaches the developer's folder/);
  assert.equal(readFileSync(join(folder, "stray.txt"), "utf8"), "hello from the worktree\n", "the apply brought its work");
  assert.equal(existsSync(join(folder, "stray-shell.txt")), false, "its shell never wrote there");
  const { subagents } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
  const sa = subagents.find((/** @type {any} */ s) => s.description === "Write past the worktree");
  const rec = await shim.record(sa.runId);
  for (const name of ["write", "bash"])
    assert.ok(rec.changes.some((/** @type {string} */ c) => c.startsWith(`agent: ${name} refused — `) && c.includes("outside the worktree it works in")), rec.changes.join("\n"));
});

// (fails before: yes — a session whose saved layer named Validate had its lead's launch wait as a proposal, the reply
// ending on it, and a write that named the mode was taken)
test("a lead's order runs at once whatever an old session's saved settings say of a team mode: its Scout runs with nobody asked, the saved word is left where it lies, and a write that names the mode is refused", async () => {
  const id = await newSession({ engine: { mode: "team", team: "builders" } });
  const S = `/api/sessions/${encodeURIComponent(id)}`;
  // As an older Filament saved it: the session's own layer names the mode, written past today's checks.
  const archive = /** @type {any} */ (shim.app).memory.archive;
  const layer = archive.chainSettings(id);
  archive.setChainSettings(id, { ...layer, engine: { ...layer.engine, teamMode: "validate" } });
  const t = await turn(id, "send a scout first");
  assert.ok(t.text.startsWith("A scout maps it first.") && t.text.endsWith("LEAD SAW THE FIRST SCOUT"), t.text);
  const { subagents } = await (await shim.api(`${S}/subagents`)).json();
  assert.deepEqual(subagents.map((/** @type {any} */ s) => [s.team?.role, s.description, s.status]), [["scout", "Map it first", "done"]], "its Scout ran, nobody asked");
  const rec = await shim.record(t.id);
  assert.ok(!rec.changes.some((/** @type {string} */ c) => c.includes("proposal")), rec.changes.join("\n"));
  assert.equal(archive.getChain(id).meta.paused, undefined, "nothing waits");
  assert.equal((await (await shim.api(`${S}/transcript`)).json()).paused, null);
  assert.equal(archive.chainSettings(id).engine.teamMode, "validate", "left as saved: nothing converts it");
  const patched = await shim.api(`${S}/settings`, { method: "PATCH", body: { patch: { engine: { teamMode: "validate" } } } });
  assert.equal(patched.status, 400, await patched.clone().text());
  assert.equal(KNOBS["engine.teamMode"], undefined, "no such setting");
});

// (fails before: yes — a session saved while its lead's proposal waited loaded with the proposal waiting, and its next
// message answered it, running the held launch)
test("a session saved while its lead's proposal waited loads with nothing waiting: its next message starts a turn of its own, which runs nothing the proposal held, and its end clears the old pause", async () => {
  const id = await newSession({ engine: { mode: "team", team: "builders" } });
  const S = `/api/sessions/${encodeURIComponent(id)}`;
  const first = await turn(id, "hello there");
  assert.equal(first.text, "LEAD ANSWER");
  // The pause as an older Filament kept it on the chain: the lead's launch held, waiting for the developer's answer.
  const held = { type: "tool_use", id: "toolu_held", name: "agent", input: FIRST };
  const archive = /** @type {any} */ (shim.app).memory.archive;
  archive.mergeMeta(id, {
    paused: {
      kind: "proposal",
      question: '\n\nThe team\'s lead proposes 1 order:\n1. Launch a scout — "Map it first": know what is here\n\nApprove, amend, or discuss.',
      orders: [{ id: "toolu_held", kind: "launch", role: "scout", description: "Map it first", goal: "know what is here" }],
      approved: [],
      dangling: { role: "assistant", content: [{ type: "text", text: "A scout maps it first." }, held] },
      results: [],
      pending: held,
      remaining: [],
      round: 1,
      plan: null,
      root: folder,
      readerModel: "",
      heard: [],
      subagentWrote: [],
      unread: [],
      spent: null,
      requestId: first.id,
      at: Date.now(),
      expires: Date.now() + 3_600_000,
    },
  });
  const view = await (await shim.api(`${S}/transcript`)).json();
  assert.equal(view.paused, null, "a page that loads now draws nothing waiting");
  const next = await turn(id, "go");
  assert.equal(next.text, "LEAD ANSWER", "a turn of its own: the lead read the message");
  const rec = await shim.record(next.id);
  assert.ok(!rec.changes.some((/** @type {string} */ c) => c.includes("archived pause") || c.includes("proposal")), rec.changes.join("\n"));
  assert.deepEqual((await (await shim.api(`${S}/subagents`)).json()).subagents, [], "the held launch never ran");
  assert.equal(archive.getChain(id).meta.paused, undefined, "the turn's end cleared it");
});
