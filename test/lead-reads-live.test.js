// @ts-check
// HarnessV3-TaskGraph-v2 §12 (V2-0a) on the live app: a team's lead that reads along with its workers, end to end
// through the pipeline. A harness session under Builders, as a session is born (`engine.supervise` on): its lead's
// wait ends on a look at its Builder's plan, its message reaches the Builder before the Builder's first change, the
// change so far is a patch of the Builder's worktree, and the next turn's history holds a line where each look was.
// The launch and the message to the running worker both run at once. With the switch off the lead is version 18's. The fake upstream holds a worker's reply until the lead has acted, so what
// each side had seen when it answered is fixed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOOK_GONE, LOOK_OPEN, LOOK_STUB } from "../src/app/agent/looks.js";
import { PROMPT, TOOL_TEXT } from "../src/app/agent/prompt.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let folder;

const BUILD = { role: "builder", description: "Write the quiet note", goal: "note.txt greets the reader", files: ["note.txt"], steps: ["Read a.txt", "Write note.txt"], acceptance: "note.txt holds the greeting", dont_touch: ["a.txt"] };
const SCOUT = { role: "scout", description: "Map it under a look", goal: "know what is here", steps: ["List the files"], acceptance: "every file is named" };
const PLAIN = { role: "scout", description: "Map it unwatched", goal: "know what is here", steps: ["List the files"], acceptance: "every file is named" };
/** What the Builder says before its first call: its plan, which the brief's goal does not ask for. */
const PLAN = "PLAN: I will shout the greeting in upper case.";
const SCOUT_PLAN = "PLAN: I will list every file, then read each.";
/** The lead's message to its running worker, and the steering block the worker's loop reads it in. */
const STEER = "Lower case, never upper case.";
const NARROW = "List the files only: read none.";
const blockOf = (/** @type {string} */ told) => `Message from your team's lead, relayed by Filament (1 message). Acknowledge what you heard in your next reply before acting on it:\n- ${told}`;

/** A door the script holds a reply behind until the other side has acted. */
const gate = () => {
  /** @type {() => void} */
  let open = () => {};
  const passed = /** @type {Promise<void>} */ (new Promise((res) => (open = res)));
  return { open, passed };
};
/** @type {Record<string, ReturnType<typeof gate>>} */
let gates = {};
/**
 * What the lead's script saw while the Builder's reply was held: its progress with the lead's message sent, then read,
 * and the repository's refs on either side of the read of its change.
 * @type {any}
 */
let seen = {};
let calls = 0;

/** @param {any} b */
const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
/** @param {any} content */
const textOf = (content) => (typeof content === "string" ? content : (content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));
const isLead = (/** @type {any} */ c) => sysOf(c.body).includes(String(PROMPT.leadRole));
const isWorker = (/** @type {any} */ c) => sysOf(c.body).includes(String(PROMPT.workerRole));
/** Every text a request's messages hold, a tool result's included. @param {any} body */
const textsIn = (body) => {
  /** @type {string[]} */
  const out = [];
  for (const m of body?.messages || [])
    for (const b of Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content ?? "") }]) {
      if (b?.type === "text") out.push(String(b.text));
      else if (b?.type === "tool_result") out.push(textOf(b.content));
    }
  return out;
};
/** The looks a request shows whole: the newest one, where the lead reads along. @param {any} body */
const looksIn = (body) => textsIn(body).filter((t) => t.startsWith(LOOK_OPEN) && t !== LOOK_STUB && t !== LOOK_GONE);
/** What a tool call answered in a request: the text of the tool_result for `id`, or null. @param {any} body @param {string} id */
const resultIn = (body, id) => {
  for (const m of body?.messages || [])
    for (const b of Array.isArray(m.content) ? m.content : []) if (b?.type === "tool_result" && b.tool_use_id === id) return textOf(b.content);
  return null;
};
/** @param {any} body @param {string} name */
const toolOf = (body, name) => (body.tools || []).find((/** @type {any} */ t) => t.name === name);

before(async () => {
  folder = mkdtempSync(join(tmpdir(), "filament-lead-reads-"));
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: folder, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(folder, "a.txt"), "one\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  up = await fakeUpstream(async (call) => {
    const b = call.body || {};
    const system = sysOf(b);
    const all = JSON.stringify(b.messages || []);
    const model = String(b.model || "");
    const blocks = (/** @type {any[]} */ list, stop = "end_turn") => anthropicReply("", { model, stop, blocks: list, usage: { input_tokens: 5, output_tokens: 3 } });
    const say = (/** @type {string} */ text) => blocks([{ type: "text", text }]);
    const use = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => blocks([{ type: "tool_use", id, name, input }], "tool_use");
    const wait = () => use(`toolu_wait_${++calls}`, "wait", { seconds: 60 });
    const refs = () => execFileSync("git", ["for-each-ref"], { cwd: folder, encoding: "utf8" });
    const progress = async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(seen.session)}/subagents`)).json()).subagents?.[0]?.progress?.lead;
    if (system.includes(String(PROMPT.workerRole))) {
      // The Builder says its plan and reads; its next reply is held until its lead has messaged it, so the message is
      // what its third request reads; its report is held until its lead has asked for its change so far.
      if (all.includes("Your task: Write the quiet note")) {
        if (resultIn(b, "toolu_w_note") != null) {
          gates.wrote.open();
          await gates.shown.passed;
          return say("BUILDER REPORT: note.txt written in lower case, as the lead said.");
        }
        if (all.includes(STEER)) return blocks([{ type: "text", text: "Understood: lower case." }, { type: "tool_use", id: "toolu_w_note", name: "write", input: { path: "note.txt", content: "hello\n" } }], "tool_use");
        if (resultIn(b, "toolu_w_a") == null) return blocks([{ type: "text", text: PLAN }, { type: "tool_use", id: "toolu_w_a", name: "read", input: { path: "a.txt" } }], "tool_use");
        await gates.steered.passed;
        return use(`toolu_w_again_${++calls}`, "read", { path: "a.txt" });
      }
      // The watched Scout: the same held reply, and a report once it has read its lead's message.
      if (all.includes("Your task: Map it under a look")) {
        if (all.includes(NARROW)) return say("SCOUT REPORT: a.txt is here; I read none, as the lead said.");
        if (resultIn(b, "toolu_s_glob") == null) return blocks([{ type: "text", text: SCOUT_PLAN }, { type: "tool_use", id: "toolu_s_glob", name: "glob", input: { pattern: "*" } }], "tool_use");
        await gates.narrowed.passed;
        return use(`toolu_s_again_${++calls}`, "glob", { pattern: "*.txt" });
      }
      return say("SCOUT REPORT: mapped.");
    }
    if (system.includes(String(PROMPT.leadRole))) {
      // The lead that reads along: it launches a Builder and waits; the look shows the plan, so it messages the
      // Builder; a later look shows the write, so it asks for the change so far; then the report — it reads the change
      // that waits, applies it, and asks once more.
      if (all.includes("quiet note, please")) {
        if (all.includes("what happened?")) return say("LEAD ANSWER");
        const built = /\[Filament: your builder (sa_[0-9a-f]{8})/.exec(all);
        if (resultIn(b, "toolu_after") != null) return say("LEAD DONE: note.txt is in, lower case.");
        if (built && all.includes("Applied the changes of sub-agent")) return use("toolu_after", "worker", { agent_id: built[1], show_changes: true });
        if (built && resultIn(b, "toolu_kept") != null) return use("toolu_apply", "worker", { agent_id: built[1], apply_changes: true });
        if (built) return use("toolu_kept", "worker", { agent_id: built[1], show_changes: true });
        const id = /Launched builder (sa_[0-9a-f]{8})/.exec(all)?.[1];
        if (!id) return use("toolu_build", "agent", BUILD);
        if (resultIn(b, "toolu_changes") != null) {
          seen.refsAfter ||= refs();
          gates.shown.open();
          return wait();
        }
        if (resultIn(b, "toolu_steer") != null) {
          seen.sent ||= await progress();
          gates.steered.open();
          if (!looksIn(b).some((t) => t.includes("Called write"))) return wait();
          await gates.wrote.passed;
          seen.read = await progress();
          seen.refsBefore = refs();
          return use("toolu_changes", "worker", { agent_id: id, show_changes: true });
        }
        if (!all.includes(PLAN)) return wait();
        return use("toolu_steer", "worker", { agent_id: id, prompt: STEER });
      }
      // The lead launches a Scout; the look shows the Scout's plan and the lead narrows it.
      if (all.includes("map it, watched")) {
        if (/\[Filament: your scout sa_[0-9a-f]{8}/.test(all)) return say("LEAD SAW THE NARROWED SCOUT");
        const id = /Launched scout (sa_[0-9a-f]{8})/.exec(all)?.[1];
        if (!id) return blocks([{ type: "text", text: "A scout maps it first." }, { type: "tool_use", id: "toolu_watched", name: "agent", input: SCOUT }], "tool_use");
        if (resultIn(b, "toolu_narrow") != null) {
          gates.narrowed.open();
          return wait();
        }
        if (!all.includes(SCOUT_PLAN)) return wait();
        return use("toolu_narrow", "worker", { agent_id: id, prompt: NARROW });
      }
      // The lead whose session has the switch off: version 18's flow.
      if (/\[Filament: your scout sa_[0-9a-f]{8}/.test(all)) return say("LEAD SAW THE SCOUT");
      if (/Launched scout sa_/.test(all)) return use("toolu_wait_plain", "wait", { seconds: 60 });
      return use("toolu_plain", "agent", PLAIN);
    }
    return say("MODEL ANSWER");
  });
  shim = await startApp({
    memory: true,
    configure: (/** @type {any} */ cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 }, "m-cheap": { input: 1, output: 1, contextTokens: 64000 } } }];
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

/** A harness session in the repository, its settings as given: reading along is a session's default. @param {any} settings */
const newSession = async (settings) => {
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain", settings } });
  assert.equal(r.status, 200, await r.clone().text());
  return String((await r.json()).id);
};
/** One harness turn, answered whole. @param {string} id @param {any} body */
const turn = async (id, body) => {
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { stream: false, ...(typeof body === "string" ? { content: body } : body) } });
  assert.equal(r.status, 200, await r.clone().text());
  return { text: textOf((await r.json()).content), id: String(r.headers.get("x-filament-request-id")) };
};
/** A run's events so far, through the run's route. @param {string} runId */
const runEvents = async (runId) => /** @type {any[]} */ ((await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0`)).json()).events || []);

// (fails before: yes — a lead's wait answered with a list of its workers and never their words: the Builder wrote
// HELLO, as it had planned, and the lead learned of it from the report)
test("a lead that reads along: its wait ends on a look at the Builder's plan, its message reaches the Builder before the first change, the change so far is a patch of the worktree, and the next turn keeps a line where each look was", async () => {
  gates = { steered: gate(), wrote: gate(), shown: gate() };
  seen = {};
  const id = await newSession({ engine: { mode: "team", team: "builders", lookSeconds: 0 }, subagents: { pool: [{ model: "m-cheap", seats: 4 }] } });
  seen.session = id;
  const mark = up.received.length;
  const t = await turn(id, "quiet note, please");
  assert.equal(t.text, "LEAD DONE: note.txt is in, lower case.");
  const reqs = up.received.slice(mark);
  const lead = reqs.filter(isLead);
  const builder = reqs.filter(isWorker);

  // The words and the tools: the lead's say how it reads along, and its worker tool reads a trail and a change.
  const leadSystem = sysOf(lead[0].body);
  assert.ok(leadSystem.includes(String(PROMPT.leadLooks)), leadSystem);
  assert.ok(!leadSystem.includes("- wait answers with your workers still running"), "the watch's line gave way");
  assert.equal(toolOf(lead[0].body, "worker").description, TOOL_TEXT.workerReads);
  assert.deepEqual(["show_trail", "from_round", "show_changes"].map((k) => k in toolOf(lead[0].body, "worker").input_schema.properties), [true, true, true]);
  assert.equal(toolOf(lead[0].body, "wait").description, TOOL_TEXT.teamWaitReads);
  const workerSystem = sysOf(builder[0].body);
  // Since version 27 it may ask its lead (TG2-D49): its report line is ask_lead's, in place of "go on".
  assert.ok(workerSystem.includes(String(PROMPT.workerReadAlong)) && workerSystem.includes(String(PROMPT.workerAsksLead)), workerSystem);
  assert.ok(!/nobody can answer a question from you mid-task/i.test(workerSystem), "its lead can");

  // The first look: the wait ended on it, and it shows the plan in the Builder's own words, under its sign.
  const first = lead.find((c) => looksIn(c.body).some((l) => l.includes(PLAN)));
  assert.ok(first, "a look showed the plan");
  const [look] = looksIn(first.body);
  assert.ok(look.startsWith("[Filament: a look at your workers. 1 is running.]"), look);
  assert.ok(look.includes("sign: said how it will go about its task") && look.includes(`Round 1\nSaid: ${PLAN}\nCalled read \`a.txt\``), look);
  assert.ok(textsIn(first.body).some((x) => /^Waited \d+ s: your workers moved\. A look follows as a message\.$/.test(x)), textsIn(first.body).join("\n---\n"));
  assert.ok(!textsIn(first.body).some((x) => x.includes("still running:")), "no watch beside the look");

  // The steer: read at the Builder's next step, before its first change — it wrote lower case.
  const wrote = builder.findIndex((c) => resultIn(c.body, "toolu_w_note") != null);
  const heard = builder.findIndex((c) => textsIn(c.body).some((x) => x.includes(blockOf(STEER))));
  assert.ok(heard > 0 && heard < wrote, `the message came before the write: ${heard} < ${wrote}`);
  assert.ok(!JSON.stringify(builder[heard].body.messages).includes("toolu_w_note"), "nothing was written when it read the message");
  assert.equal(readFileSync(join(folder, "note.txt"), "utf8"), "hello\n", "applied as steered");
  assert.deepEqual([seen.sent, seen.read], [{ read: 0, unread: 1 }, { read: 1, unread: 0 }], "the Builder's progress says whether it has read its lead's message");

  // The later looks: the message read, then the acknowledgment and the first change under its sign — each round
  // whole once, the plan kept as its one line; then the change so far, a patch. How many looks the lead was shown
  // between the two depends on when its waits ended, so the round that read the message is whole in one of them.
  assert.ok(lead.some((c) => looksIn(c.body).some((l) => l.includes(`Read your message at the end of this round: "${STEER}"`))), "a look showed the message read");
  const later = lead.find((c) => looksIn(c.body).some((l) => l.includes("Called write")));
  assert.ok(later, "a look showed the write");
  const [second] = looksIn(later.body);
  assert.ok(second.startsWith("[Filament: a look at your workers, in place of the one before. Since it: 1 moved, 0 did not.]"), second);
  assert.ok(second.includes("Said: Understood: lower case.\nCalled write `note.txt`") && second.includes("sign: made its first change (note.txt)") && second.includes(`Its plan (round 1): ${PLAN}`), second);
  assert.ok(!second.includes(`Round 1\nSaid: ${PLAN}`), "a round an earlier look showed whole is not shown whole again");
  assert.equal(looksIn(later.body).length, 1, "one look whole");
  assert.ok(textsIn(later.body).includes(LOOK_STUB), "a line where the older look was");
  const shown = lead.find((c) => resultIn(c.body, "toolu_changes") != null);
  const patch = String(resultIn(shown?.body, "toolu_changes"));
  assert.ok(patch.startsWith("[Filament: the change so far of ") && patch.includes("1 file") && patch.includes("note.txt") && patch.includes("+hello"), patch);
  assert.ok(seen.refsBefore && seen.refsAfter === seen.refsBefore, `reading the change wrote no ref: ${JSON.stringify([seen.refsBefore, seen.refsAfter])}`);
  // (fails before: yes — once a worker had reported, its lead's show_changes was refused: it applied on the report
  // alone, as GLM 5.3 did in the live drive of 2026-10-12)
  // Once the Builder reported, the same read gives the change that waits to be applied, in place of the earlier one;
  // applied, it says where the change is.
  const read = lead.find((c) => resultIn(c.body, "toolu_kept") != null);
  assert.ok(textsIn(read?.body).some((x) => /To read them first, call worker with agent_id "sa_[0-9a-f]{8}" and show_changes: true\. The developer can apply them too\./.test(x)), "the report names the read");
  const waiting = String(resultIn(read?.body, "toolu_kept"));
  assert.match(waiting, /^\[Filament: the change so far of sa_[0-9a-f]{8}, against where it started: 1 file, as it stood when it reported\. It stays until you ask for it again\.\]\n\n- note\.txt \(\+1 −0\)\n\n/);
  assert.ok(waiting.includes("+hello"), waiting);
  assert.match(String(resultIn(read?.body, "toolu_changes")), /^\[Filament: the change so far of sa_[0-9a-f]{8} was here\. A newer one replaces it\.\]$/);
  const applied = lead.find((c) => resultIn(c.body, "toolu_after") != null);
  assert.match(String(resultIn(applied?.body, "toolu_after")), /^The change of builder sa_[0-9a-f]{8} is applied: it is in your folder, where your own tools read it\.$/);

  // The record and the run log.
  const rec = await shim.record(t.id);
  assert.equal(rec.agent?.supervise, true);
  assert.ok(rec.changes.includes("agent: the lead reads along with its workers (engine.supervise): Filament shows it a look at them at once on a sign, else whenever something is new (engine.lookSeconds)"), rec.changes.join("\n"));
  const looks = (await runEvents(t.id)).filter((e) => e.type === "look");
  assert.ok(looks.length >= 2, `each look is in the lead's run: ${looks.length}`);

  // The next turn: the work kept holds a line where each look was, and no word of the worker's trail or its patch.
  const from = up.received.length;
  assert.equal((await turn(id, "what happened?")).text, "LEAD ANSWER");
  const [next] = up.received.slice(from).filter(isLead);
  const kept = textsIn(next.body);
  assert.ok(kept.includes(LOOK_GONE) && kept.some((x) => /^\[Filament: the change so far of sa_[0-9a-f]{8} was here, while it ran\.\]$/.test(x)), kept.join("\n---\n"));
  assert.ok(!kept.some((x) => x.includes(PLAN) || x.includes("Called write") || x.includes("+hello")), kept.join("\n---\n"));
  assert.deepEqual(looksIn(next.body), [], "no look whole");
  assert.ok(kept.some((x) => x.includes("BUILDER REPORT: note.txt written in lower case")), "the report is what is kept");
});

// (fails before: yes — a message to a running worker could wait for the developer with the launches, so a lead's steer
// came after the work it meant to turn)
test("the launch and the lead's message to its running worker run at once: the turn runs to its end", async () => {
  gates = { narrowed: gate() };
  const id = await newSession({ engine: { mode: "team", team: "builders", lookSeconds: 0 } });
  const S = `/api/sessions/${encodeURIComponent(id)}`;
  const mark = up.received.length;
  const done = await turn(id, "map it, watched");
  assert.ok(done.text.startsWith("A scout maps it first.") && done.text.endsWith("LEAD SAW THE NARROWED SCOUT"), done.text);
  assert.equal((await (await shim.api(`${S}/transcript`)).json()).paused ?? null, null);
  const reqs = up.received.slice(mark);
  const told = reqs.filter(isLead).find((c) => resultIn(c.body, "toolu_narrow") != null);
  assert.ok(told && !String(resultIn(told.body, "toolu_narrow")).startsWith("Not run"), String(told && resultIn(told.body, "toolu_narrow")));
  assert.ok(reqs.filter(isWorker).some((c) => textsIn(c.body).some((x) => x.includes(blockOf(NARROW)))), "the Scout read it while it ran");
  const rec = await shim.record(done.id);
  assert.ok(!rec.changes.some((/** @type {string} */ c) => c.includes("proposal")), rec.changes.join("\n"));
});

// (fails before: no — a guard: the switch off is version 18's lead)
test("with engine.supervise off the lead is version 18's: the watch's words, the worker tool without its reads, and no look", async () => {
  const id = await newSession({ engine: { mode: "team", team: "builders", supervise: false } });
  const mark = up.received.length;
  const t = await turn(id, "scout it");
  assert.equal(t.text, "LEAD SAW THE SCOUT");
  const reqs = up.received.slice(mark);
  const lead = reqs.filter(isLead);
  // The plain lines, with the line that names its workers' model after their first (TG2-D47, version 26).
  assert.ok(sysOf(lead[0].body).includes(String(PROMPT.lead).replace("\n", "\n- Your workers run on m-1.\n")) && !sysOf(lead[0].body).includes(String(PROMPT.leadLooks)), sysOf(lead[0].body));
  assert.equal(toolOf(lead[0].body, "worker").description, TOOL_TEXT.worker);
  assert.equal("show_trail" in toolOf(lead[0].body, "worker").input_schema.properties, false);
  // Its worker may ask it, as every worker of a team may since version 29 (TG2-D58): its question comes to its door.
  const worker = sysOf(reqs.filter(isWorker)[0].body);
  assert.ok(worker.includes(String(PROMPT.workerAsksLead)) && !/nobody can answer a question from you mid-task/i.test(worker), worker);
  assert.deepEqual(Object.keys(toolOf(lead[0].body, "worker").input_schema.properties).slice(-2), ["answer", "ask"]);
  for (const c of lead) assert.deepEqual(looksIn(c.body), [], "no look");
  const rec = await shim.record(t.id);
  assert.ok(!rec.agent?.supervise && rec.changes.includes("agent: the lead does not read along with its workers (engine.supervise is off, or Filament keeps no run log here): its wait answers with a line for each of them"), rec.changes.join("\n"));
  assert.deepEqual((await runEvents(t.id)).filter((e) => e.type === "look"), []);
});
