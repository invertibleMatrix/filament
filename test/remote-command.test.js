// @ts-check
// A background command on another machine (the remote-agents plan's c-tools): bash_background's `machine`, and a coding
// agent's background_command's, runs the command on a machine this Filament keeps an agents' device for, through that
// machine's exec route, as a background shell of this chat — its output read as a local one's, its end told into the
// turn or waking the chat, bash_kill and the panel's Stop sent there. This chat's mode judges it there, its Auto as
// Edit unless that machine lets this one's agents run without asking (a Filament there from before judges it by its
// own); its ask shows on this chat's permission card, answered by the person's press alone — never this chat's model,
// its sub-agents, the words in its run or a switch of its mode. Two real Filaments (helpers/two-machines.js), set up as test/remote-subagent.test.js sets
// them up: `here`'s chat works in a clone of the project, `there` keeps another, the folder of a chat its person started.
// The loop's turns are driven as a page sends them, on a model scripted by the words of the person's message.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTwoMachines } from "./helpers/two-machines.js";
import { anthropicReply, fakeUpstream } from "./helpers/app.js";
import { scaledMs, until } from "./helpers/wait.js";
import { createMachines } from "../src/services/machines/index.js";
import { createBackgroundCommands } from "../src/app/agent/commands.js";
import * as remoteCommands from "../src/app/agent/remote-commands.js";
import { AGENTS_CHAT_THERE, CWD_HERE, ENDED_THERE, NOT_OFFERED_THERE, createRemoteCommands, thereForm } from "../src/app/agent/remote-commands.js";
import { EXEC_GRACE_MS } from "../src/http/admin/exec.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { ANSWERED_THERE } from "../src/app/agent/remote-agents.js";
import { createAgentPermits } from "../src/app/agent-permits.js";
import { disposeBackgroundShells, keepRemoteShell, runHand } from "../src/adapters/tools/hands.js";
import { ANY_WAKE_LINE, WAKE_LINE } from "../src/app/sessions/wake.js";

const JSON_TYPE = { "content-type": "application/json" };
const ORIGIN = "https://github.com/acme/widgets.git";
/** Filament's own loop on the model. */
const MODEL = "agent/m-1";
/** A command that says one line at once, another 1.5 s later, and exits 3 a second after that. */
const RUN = `node -e "console.log('first-out'); setTimeout(() => console.log('second-out'), 1500); setTimeout(() => process.exit(3), 2500)"`;
/**
 * A command that says one line at once, the next once the file say-<tag>-2 is in its folder, and exits 3 once
 * say-<tag>-3 is: the model's steps write them, so what each step reads is the same under any load.
 * @param {string} tag
 */
const stepped = (tag) => `node -e "const fs=require('fs');console.log('first-out');let n=2;setInterval(()=>{if(!fs.existsSync('say-${tag}-'+n))return;if(n===2){console.log('second-out');n=3}else process.exit(3)},50)"`;
/** A command that runs until the file `gate` appears in its folder, then exits 0. @param {string} gate */
const exitsOn = (gate) => `node -e "const fs=require('fs');setInterval(()=>fs.existsSync('${gate}')&&process.exit(0),50)"`;
/** A command that writes its process id to `file` in its folder and then runs until stopped. @param {string} file */
const forever = (file) => `node -e "require('fs').writeFileSync('${file}', String(process.pid)); setInterval(() => {}, 1000)"`;
/** A command that leaves the file ran-<tag>.txt in its folder, and exits. @param {string} tag */
const leaves = (tag) => `node -e "require('fs').writeFileSync('ran-${tag}.txt', 'yes')"`;

/** git in a folder, its commits by a test's name. @param {string} cwd @param {string[]} args */
const gitIn = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
/** A message's words: its text blocks, and its tool results' words. @param {any} content @returns {string} */
const textOf = (content) =>
  typeof content === "string" ? content : (Array.isArray(content) ? content : []).map((/** @type {any} */ b) => (b?.type === "text" ? b.text : b?.type === "tool_result" ? textOf(b.content) : "")).join("\n");
/** Whether a message carries a tool's result. @param {any} m */
const hasResult = (m) => Array.isArray(m?.content) && m.content.some((/** @type {any} */ b) => b?.type === "tool_result");
/** The first background shell a text names. @param {string} text */
const shellOf = (text) => (/bg_[0-9a-z]+/.exec(text) || [""])[0];
/** Whether a process lives. @param {number} pid */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** A pause, for what must not happen meanwhile, as long as a busy machine needs (`scaledMs`). @param {number} ms */
const sleepMs = (ms) => new Promise((r) => setTimeout(r, scaledMs(ms)));
/**
 * A model request as the loop made it: the person's message it answers (the newest with no tool result), how many
 * calls the model made since, the newest message's words, and the whole conversation as JSON.
 * @param {any} body
 */
const stepOf = (body) => {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  let at = msgs.length - 1;
  while (at >= 0 && !(msgs[at].role === "user" && !hasResult(msgs[at]))) at--;
  return { said: at >= 0 ? textOf(msgs[at].content) : "", step: msgs.slice(at + 1).filter((/** @type {any} */ m) => m.role === "assistant").length, last: textOf(msgs.at(-1)?.content), all: JSON.stringify(msgs) };
};

describe("a background command on another machine", () => {
  const base = mkdtempSync(join(tmpdir(), "filament-remote-cmd-"));
  /** This machine's clone, and there's: the folder of a chat its person started. */
  const hereRepo = join(base, "here", "widgets");
  const thereRepo = join(base, "there", "widgets");
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startTwoMachines>>} */
  let two;
  let deviceId = "";
  let seq = 0;

  /** The model: what each case's message asks, a call at a time; a wake's turn is answered in words. @param {any} call */
  const brain = (call) => {
    if (call.kind !== "anthropic") return undefined;
    if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
    const { said, step, last } = stepOf(call.body);
    /** @param {string} name @param {any} input @param {string} [id]  the call's id: a provider may give one again */
    const use = (name, input, id = `toolu_c${++seq}`) => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id, name, input }] });
    const say = (/** @type {string} */ text) => anthropicReply(text, { model: "m-1" });
    const kind = /CASE:(\w+)/.exec(said)?.[1];
    const tag = /TAG:(\w+)/.exec(said)?.[1] || "x";
    const there = { machine: "Workstation" };
    if (kind === "run") {
      if (step === 0) return use("bash_background", { command: stepped(tag), ...there });
      // Its second line only once its start has answered, and its end only once that line was read.
      if (step === 1) {
        writeFileSync(join(thereRepo, `say-${tag}-2`), "");
        return use("bash_output", { id: shellOf(last), until: "second-out", wait: 20 });
      }
      if (step === 2) {
        writeFileSync(join(thereRepo, `say-${tag}-3`), "");
        return use("bash", { command: `node -e "setTimeout(() => {}, 3000)"` });
      }
      return say("RUN DONE");
    }
    if (kind === "wake") return step === 0 ? use("bash_background", { command: exitsOn(`gate-${tag}`), ...there }) : say("WAITING ON IT");
    if (kind === "kill") {
      if (step === 0) return use("bash_background", { command: forever(`pid-${tag}.txt`), ...there });
      if (step === 1) return use("bash_kill", { id: shellOf(last) });
      return say("KILLED");
    }
    if (kind === "serve") return step === 0 ? use("bash_background", { command: forever(`pid-${tag}.txt`), ...there }) : say("LEFT RUNNING");
    if (kind === "there") return step === 0 ? use("bash_background", { command: leaves(tag), ...there }) : say(`SAW: ${last}`);
    if (kind === "nowhere") return step === 0 ? use("bash_background", { command: leaves(tag), machine: "Nowhere" }) : say(`SAW: ${last}`);
    if (kind === "sub") return step === 0 ? use("bash_background", { command: leaves(tag), ...there }) : say(`SUB SAW: ${last}`);
    if (kind === "reuse") return step < 2 ? use("bash_background", { command: leaves(`${tag}${step}`), ...there }, "call_0") : say("REUSED");
    if (kind === "cwdonly") return step === 0 ? use("bash_background", { command: leaves(tag), cwd: thereRepo }) : say(`SAW: ${last}`);
    return say("HEARD IT");
  };
  /** The requests the model was sent for the message tagged `tag`, at its call `step`. @param {string} tag @param {number} step */
  const seen = (tag, step) =>
    up.received
      .filter((c) => c.kind === "anthropic" && c.body?.tools?.length)
      .map((c) => stepOf(c.body))
      .find((s) => s.said.includes(`TAG:${tag} `) && s.step === step) || null;
  /** A chat here, in this machine's clone, under `mode` and its `rules`. @param {string} mode @param {any[]} [rules] */
  const chat = async (mode, rules) => {
    const r = await two.here.api("/api/sessions", { method: "POST", body: { cwd: hereRepo, model: MODEL, preset: "plain", settings: { loop: { permissions: mode, ...(rules ? { rules } : {}) } } } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** A turn to its end. @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await two.here.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  /** A turn sent as the page sends one, its run's id at once. @param {string} id @param {string} content */
  const start = async (id, content) => {
    const res = await two.here.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
    assert.equal(res.status, 200);
    return { res, runId: String(res.headers.get("x-filament-request-id")) };
  };
  /** @param {string} runId @returns {Promise<any[]>} */
  const runEvents = async (runId) => (await (await two.here.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || [];
  /** The ask there, on this chat's card, once it shows. @param {string} runId */
  const askOf = (runId) => until(async () => (await runEvents(runId)).find((e) => e.type === "ask" && e.form?.judged) || null, "the ask there on this chat's card", { timeoutMs: 20_000 });
  /** An answer on the card, as the page sends one. @param {string} runId @param {any} body */
  const answer = (runId, body) => two.here.api(`/api/runs/${encodeURIComponent(runId)}/answer`, { method: "POST", body });
  /** The person's press on the card, with Deny's words. @param {string} runId @param {any} ask @param {"allow" | "deny" | null} choice @param {string} [words] */
  const press = (runId, ask, choice, words = "") => answer(runId, { ask: ask.id, outcome: "answered", answers: { permission: { chosen: choice ? [choice] : [], ...(words ? { words } : {}) } } });
  /** There's mode for a new chat, as its defaults set it. @param {"read-only" | "edit" | "ask" | "auto"} m */
  const mode = async (m) => {
    const r = await two.there.api("/api/defaults/settings", { method: "PATCH", body: { patch: { loop: { permissions: m } } } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** Switch the agents' grant there, as its own computer does. @param {boolean} on */
  const grant = async (on) => {
    const r = await two.there.api(`/api/remote/devices/${encodeURIComponent(deviceId)}`, { method: "PATCH", body: { grants: { agents: on } } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** A process id a command there wrote, once it did. @param {string} file */
  const pidIn = async (file) => Number(await until(() => (existsSync(join(thereRepo, file)) ? readFileSync(join(thereRepo, file), "utf8") || null : null), `${file} there`, { timeoutMs: 20_000 }));

  before(async () => {
    for (const d of [hereRepo, join(base, "there")]) mkdirSync(d, { recursive: true });
    gitIn(hereRepo, "init", "-q", "-b", "main");
    writeFileSync(join(hereRepo, "readme.md"), "widgets\n");
    gitIn(hereRepo, "add", ".");
    gitIn(hereRepo, "commit", "-q", "-m", "first");
    gitIn(join(base, "there"), "clone", "-q", hereRepo, thereRepo);
    gitIn(hereRepo, "remote", "add", "origin", ORIGIN);
    gitIn(thereRepo, "remote", "set-url", "origin", ORIGIN);
    up = await fakeUpstream(brain);
    const models = (/** @type {any} */ cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1"] }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [tmpdir()], readerModel: "" };
    };
    two = await startTwoMachines({ here: { configure: models }, there: { configure: models } });
    // The agents' device, minted by here's full device and switched on by there's own computer; kept here as the
    // desktop app keeps it, sealed in remotes.json.
    const minted = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" })).json();
    deviceId = String(minted.device.id);
    createMachines({ dataDir: two.here.dataDir }).keep({ url: two.remote.url, fingerprint: two.remote.fingerprint, machine: two.remote.machine, device: minted.device, token: minted.token });
    await grant(true);
    // And may run without asking there, so that machine's auto runs their commands as its own (x-sec-grants.test.js
    // shows auto asking while it is off).
    const unasked = await two.there.api(`/api/remote/devices/${encodeURIComponent(deviceId)}`, { method: "PATCH", body: { grants: { unasked: true } } });
    assert.equal(unasked.status, 200, await unasked.clone().text());
    // The person's own chat there, in its clone: the folder /clones finds, and the agents' fence lets a command run in.
    const r = await two.there.api("/api/sessions", { method: "POST", body: { cwd: thereRepo, model: "m-1" } });
    assert.equal(r.status, 200, await r.clone().text());
    await mode("auto");
  });

  after(async () => {
    await two?.stop();
    await up?.close();
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // (fails before: yes — bash_background took no machine: the command ran here, in this chat's folder, and nothing said
  // which machine)
  test("bash_background with machine runs the command there: its early output in the start's answer, more with bash_output, its end told into the turn", async () => {
    const id = await chat("auto");
    await turn(id, "CASE:run TAG:r1 build it there");
    const started = seen("r1", 1);
    assert.match(String(started?.last), /Background shell bg_[0-9a-z]+ started on Workstation — it keeps running across turns \(and stops when Filament exits\)\. Filament on Workstation stops it an hour after it started there\./);
    assert.match(String(started?.last), /first-out/, "its early output, from there");
    const read = seen("r1", 2);
    assert.match(String(read?.last), /\[bg_[0-9a-z]+ still running on Workstation — this line matched until: second-out\]/);
    const told = seen("r1", 3);
    assert.match(String(told?.all), /\[Filament: background shell bg_[0-9a-z]+ \(.+?\) on Workstation exited with code 3/, "its end, into the turn at its next step");
    assert.ok(!existsSync(join(hereRepo, "first-out")), "nothing of it ran here");
  });

  // (fails before: yes — no command ran there, so no end of one came back to wake the chat)
  test("its end wakes the chat once the turn has ended, as a local command's does", async () => {
    const id = await chat("auto");
    await turn(id, "CASE:wake TAG:w1 start the watcher there");
    assert.match(String(seen("w1", 1)?.last), /Background shell bg_[0-9a-z]+ started on Workstation/);
    writeFileSync(join(thereRepo, "gate-w1"), "");
    const woke = await until(
      () =>
        up.received
          .filter((c) => c.kind === "anthropic" && c.body?.tools?.length)
          .map((c) => stepOf(c.body))
          .find((s) => s.all.includes("TAG:w1 ") && /on Workstation exited with code 0/.test(s.said)) || null,
      "the chat woken with the command's end",
      { timeoutMs: 30_000 },
    );
    assert.ok(woke);
    assert.ok([WAKE_LINE, ANY_WAKE_LINE].some((w) => woke.said.includes(w.slice(0, 60))), woke.said);
  });

  // (fails before: yes — bash_kill stopped a shell here; one there was never started, nor stopped)
  test("bash_kill stops it there, and so does the panel's Stop, which names the machine on its row", async () => {
    const id = await chat("auto");
    await turn(id, "CASE:kill TAG:k1 start the server there, then stop it");
    assert.match(String(seen("k1", 1)?.last), /Background shell bg_[0-9a-z]+ started on Workstation/);
    const pid = await pidIn("pid-k1.txt");
    assert.match(String(seen("k1", 2)?.last), /Background shell bg_[0-9a-z]+ stopped on Workstation\./);
    await until(() => !alive(pid), `node ${pid} on Workstation gone`, { timeoutMs: 20_000 });
    // The person's Stop on the chat's status: its row says where it runs.
    const id2 = await chat("auto");
    await turn(id2, "CASE:serve TAG:s1 start the server there");
    const shell = shellOf(String(seen("s1", 1)?.last));
    const pid2 = await pidIn("pid-s1.txt");
    const rows = (await (await two.here.api(`/api/sessions/${encodeURIComponent(id2)}/commands`)).json()).commands;
    assert.deepEqual(rows.map((/** @type {any} */ r) => [r.id, r.machine]), [[shell, "Workstation"]]);
    const stop = await two.here.api(`/api/sessions/${encodeURIComponent(id2)}/commands/${shell}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200, await stop.clone().text());
    await until(() => !alive(pid2), `node ${pid2} on Workstation gone`, { timeoutMs: 20_000 });
  });

  // (fails before: yes — no ask there reached this chat: there was no command there to ask about; and that machine's
  // own auto ran this chat's command unasked, the owner's of 11-10)
  test("this chat in edit, that machine in auto: the ask shows on this chat's card, naming the machine and the command; the person's Allow runs it, their Deny refuses it", async () => {
    try {
      const id = await chat("edit");
      const { res, runId } = await start(id, "CASE:there TAG:a1 make the file there");
      const ask = await askOf(runId);
      assert.equal(ask.kind, "permission");
      assert.equal(ask.waits, true);
      assert.equal(ask.form.judged.tool, "bash_background on Workstation");
      assert.equal(ask.form.title, "Run this command on Workstation? This chat's permission mode (edit) asks first.");
      assert.equal(ask.form.judged.command, leaves("a1"));
      assert.match(ask.form.judged.reason, /^It runs on Workstation, in .+\. Only your press here answers it: not this chat's agent, its sub-agents or its mode\.$/);
      assert.deepEqual(ask.form.questions[0].choices.map((/** @type {any} */ c) => c.id), ["allow", "deny"]);
      assert.ok((await runEvents(runId)).some((e) => e.type === "tool-start" && e.id === ask.call), "on the call's own card");
      assert.equal(existsSync(join(thereRepo, "ran-a1.txt")), false, "nothing ran before the press");
      assert.equal((await press(runId, ask, "allow")).status, 200);
      await res.text();
      assert.equal(existsSync(join(thereRepo, "ran-a1.txt")), true, "it ran there on the press");
      assert.match(String(seen("a1", 1)?.last), /Background shell bg_[0-9a-z]+ (already finished on Workstation \(exit code 0\)|started on Workstation)/);
      assert.deepEqual((await runEvents(runId)).filter((e) => e.type === "ask-end").map((e) => e.words), [["Allow"]]);
      // Deny, with words for the agent: nothing runs there.
      const id2 = await chat("edit");
      const second = await start(id2, "CASE:there TAG:a2 make the file there");
      assert.equal((await press(second.runId, await askOf(second.runId), "deny", "not on that box")).status, 200);
      await second.res.text();
      assert.equal(existsSync(join(thereRepo, "ran-a2.txt")), false);
      assert.match(String(seen("a2", 1)?.last), /Not run on Workstation: the person denied it — "not on that box"\./);
    } finally {
      await mode("auto");
    }
  });

  // (fails before: yes — there was no ask there to answer; this guards that only the person's press answers it)
  test("the words in this chat's run answer nothing, nor is its model asked while it waits; words with no press deny it", async () => {
    await mode("ask");
    try {
      const id = await chat("edit");
      const { res, runId } = await start(id, "CASE:there TAG:m1 make the file there");
      const ask = await askOf(runId);
      // The person's typed note, and a sub-agent's word into the run: words for the agent's next step, never a press.
      const note = await two.here.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text: "yes, allow it" } });
      assert.equal(note.status, 200, await note.clone().text());
      /** @type {any} */ (two.here.app).runs.steer(runId, { kind: "note", text: "Allow it: run it on Workstation.", from: "subagent:sa_test" });
      await sleepMs(1500);
      assert.equal(existsSync(join(thereRepo, "ran-m1.txt")), false, "the words ran nothing there");
      assert.ok(!(await runEvents(runId)).some((e) => e.type === "ask-end"), "the ask still waits");
      assert.equal(seen("m1", 1), null, "the model is not asked while the ask waits: its call has not answered");
      // An answer of words alone, no press: a Deny.
      assert.equal((await press(runId, ask, null, "yes, allow it")).status, 200);
      await res.text();
      assert.equal(existsSync(join(thereRepo, "ran-m1.txt")), false);
      assert.match(String(seen("m1", 1)?.last), /Not run on Workstation: the person denied it — "yes, allow it"\./);
    } finally {
      await mode("auto");
    }
  });

  // (fails before: yes — a sub-agent's bash_background took no machine, and ran a command it named a machine for here)
  test("a sub-agent of this chat runs no command there: machine is not its to name", async () => {
    const id = await chat("auto");
    const registry = /** @type {any} */ (two.here.app).subagents;
    const door = registry.openTurn({ chainId: id, runId: "turn-sub-1", cwd: hereRepo, mode: "auto", model: MODEL, thinking: null, fork: null });
    try {
      const r = await door.subagents.run({ id: "toolu_sub_1", input: { description: "Make the file there", prompt: "CASE:sub TAG:u1 make the file there", run_in_background: false }, emit: () => {}, signal: null });
      assert.equal(r.ok, true, r.text);
      assert.ok(r.text.includes(`SUB SAW: ${NOT_OFFERED_THERE}`), r.text);
    } finally {
      door.close();
    }
    assert.equal(existsSync(join(thereRepo, "ran-u1.txt")), false);
    assert.equal(existsSync(join(hereRepo, "ran-u1.txt")), false, "nor here");
  });

  // (fails before: yes — a chat in auto mode ran its command here without asking anyone: there was no ask there to wait on)
  test("this chat in auto mode allows nothing there that machine does not let run without asking: the ask waits for the press, and a switch of its mode waits on", async () => {
    const unasked = (/** @type {boolean} */ on) => two.there.api(`/api/remote/devices/${encodeURIComponent(deviceId)}`, { method: "PATCH", body: { grants: { unasked: on } } });
    assert.equal((await unasked(false)).status, 200);
    try {
      const id = await chat("auto");
      const { res, runId } = await start(id, "CASE:there TAG:au1 make the file there");
      const ask = await askOf(runId);
      assert.equal(ask.form.judged.tool, "bash_background on Workstation");
      assert.equal(ask.form.title, "Run this command on Workstation? This chat runs in auto, and Workstation asks first: its Without asking grant for this Filament's agents is off.");
      await sleepMs(1500);
      assert.equal(existsSync(join(thereRepo, "ran-au1.txt")), false, "auto here answers nothing there");
      // The page says the switch moved, as it does once the person switches the mode: judged again, it waits on under
      // its id — a second switch is taken, as a question that no longer waited would not be.
      assert.equal((await answer(runId, { ask: ask.id, outcome: "switched" })).status, 200);
      await until(async () => (await answer(runId, { ask: ask.id, outcome: "switched" })).status === 200, "the ask waiting again under its id");
      assert.equal(existsSync(join(thereRepo, "ran-au1.txt")), false);
      assert.ok(!(await runEvents(runId)).some((e) => e.type === "ask-end"), "no end to the ask");
      assert.equal((await press(runId, ask, "deny")).status, 200);
      await res.text();
      assert.equal(existsSync(join(thereRepo, "ran-au1.txt")), false);
    } finally {
      assert.equal((await unasked(true)).status, 200);
    }
  });

  // (fails before: yes — read-only refused bash_background here in its own words, which said nothing of another machine)
  test("this chat read-only: a command there is refused in words, and nothing reaches that machine", async () => {
    const id = await chat("read-only");
    await turn(id, "CASE:there TAG:ro1 make the file there");
    assert.match(String(seen("ro1", 1)?.last), /Not run: this chat is read-only, and runs no command on another machine either — the person may switch its mode\./);
    assert.equal(existsSync(join(thereRepo, "ran-ro1.txt")), false);
  });

  // (fails before: yes — machine was no field of bash_background: an unknown one ran the command here)
  test("an unknown machine is refused naming the kept ones; one whose grant is off, naming the grant", async () => {
    const id = await chat("auto");
    await turn(id, "CASE:nowhere TAG:n1 make the file there");
    assert.match(String(seen("n1", 1)?.last), /no machine "Nowhere" for this Filament's agents — the machines this Filament's agents may work on: Workstation/);
    assert.equal(existsSync(join(hereRepo, "ran-n1.txt")), false, "not run here instead");
    await grant(false);
    try {
      const id2 = await chat("auto");
      await turn(id2, "CASE:there TAG:g1 make the file there");
      assert.match(String(seen("g1", 1)?.last), /Workstation lets this Filament's agents work there no more: its grant is switched off there — switch it on in Settings › Remote access on Workstation/);
      assert.equal(existsSync(join(thereRepo, "ran-g1.txt")), false);
    } finally {
      await grant(true);
    }
  });

  // (fails before: yes — a deny rule alone was read here: with that machine in auto mode, the command ran there unasked)
  test("an ask or a review rule of this chat asks here first, on this chat's card, before anything is sent there — whatever that machine's mode", async () => {
    const id = await chat("auto", [{ tool: "bash", pattern: "node -e *ran-rl*", verdict: "ask" }]);
    const { res, runId } = await start(id, "CASE:there TAG:rl1 make the file there");
    const ask = await askOf(runId);
    assert.equal(ask.form.title, "Run this command on Workstation? A rule of this chat asks first: bash(node -e *ran-rl*) ask.");
    assert.match(ask.form.judged.reason, /^It runs on Workstation, in .+, where this chat's mode judges it after your press\. Only your press here answers it/);
    await sleepMs(500);
    assert.equal(existsSync(join(thereRepo, "ran-rl1.txt")), false, "nothing ran there before the press");
    assert.equal((await press(runId, ask, "allow")).status, 200);
    await res.text();
    assert.equal(existsSync(join(thereRepo, "ran-rl1.txt")), true, "allowed here, it ran there: this chat's auto, which that machine lets run without asking, asked nothing more");
    // A review rule, as the second look's risky rules are: asked the same, and Deny sends nothing there.
    const id2 = await chat("auto", [{ tool: "bash", pattern: "node -e *ran-rv*", verdict: "review" }]);
    const second = await start(id2, "CASE:there TAG:rv1 make the file there");
    const ask2 = await askOf(second.runId);
    assert.equal(ask2.form.title, "Run this command on Workstation? A rule of this chat asks first: bash(node -e *ran-rv*) review.");
    assert.equal((await press(second.runId, ask2, "deny")).status, 200);
    await second.res.text();
    assert.equal(existsSync(join(thereRepo, "ran-rv1.txt")), false);
    assert.match(String(seen("rv1", 1)?.last), /Not run on Workstation: the person denied it\./);
  });

  // (fails before: yes — the card's id was `there-<the call's id>`: the second call's card had the first's id, and a press
  // on the first settled it)
  test("each card has its own id, never the model's call id: a late press on an old card settles nothing", async () => {
    await mode("ask");
    try {
      const id = await chat("edit");
      const { res, runId } = await start(id, "CASE:reuse TAG:ru make the files there");
      const first = await askOf(runId);
      assert.equal((await press(runId, first, "deny")).status, 200);
      const cards = () => runEvents(runId).then((all) => all.filter((e) => e.type === "ask" && e.form?.judged));
      const second = (await until(async () => ((await cards()).length > 1 ? (await cards())[1] : null), "the second call's card"));
      assert.equal(second.call, first.call, "the provider gave the call's id again");
      assert.notEqual(second.id, first.id);
      assert.notEqual((await press(runId, first, "allow")).status, 200, "a press on the old card is refused");
      await sleepMs(500);
      assert.equal(existsSync(join(thereRepo, "ran-ru1.txt")), false, "the new card's command did not run on it");
      assert.ok(!(await runEvents(runId)).some((e) => e.type === "ask-end" && e.id === second.id), "the new card still waits");
      assert.equal((await press(runId, second, "deny")).status, 200);
      await res.text();
      assert.equal(existsSync(join(thereRepo, "ran-ru0.txt")), false);
      assert.equal(existsSync(join(thereRepo, "ran-ru1.txt")), false);
    } finally {
      await mode("auto");
    }
  });

  // (fails before: no — refused already, by hands.js; this guards that the refusal stayed where machine is offered)
  test("where machine is offered, cwd without it is refused in words, and nothing runs here", async () => {
    const id = await chat("auto");
    await turn(id, "CASE:cwdonly TAG:cw1 make the file in that folder");
    assert.equal(String(seen("cw1", 1)?.last).trim(), CWD_HERE);
    assert.equal(existsSync(join(hereRepo, "ran-cw1.txt")), false);
    assert.equal(existsSync(join(thereRepo, "ran-cw1.txt")), false);
  });

  // (fails before: yes — background_command took no machine: a coding agent's command ran here alone)
  test("a coding agent's background_command with machine: started there, its output read, its end delivered, its stop sent there; an ask there on the person's press", async () => {
    /** @type {any[]} */
    const ends = [];
    const commands = createBackgroundCommands({ registry: () => ({ commandEnd: (/** @type {string} */ chain, /** @type {any} */ r) => (ends.push({ chain, ...r }), { ok: true }) }), machines: createMachines({ dataDir: two.here.dataDir }) });
    /** @type {any[]} */
    const forms = [];
    let reply = "allow";
    const ctx = {
      chain: "c-coder",
      cwd: hereRepo,
      permit: async () => ({ asked: false }),
      judgeNow: () => /** @type {const} */ ("ask"),
      machines: true,
      askPerson: async (/** @type {any} */ form) => (forms.push(form), { outcome: "answered", answers: { permission: { chosen: [reply] } } }),
      signal: null,
    };
    const started = await commands.call({ command: RUN, machine: "Workstation" }, ctx);
    assert.match(started.text, /^Started background command bg_[0-9a-z]+ on Workstation: `node -e .+`, in .+\. Filament on Workstation stops it 1 h after it started there\. Go on with your work/);
    const sid = shellOf(started.text);
    const read = await until(async () => {
      const r = await commands.call({ id: sid }, ctx);
      return /second-out/.test(r.text) ? r : null;
    }, "its output from there");
    assert.ok(read);
    assert.match(read.text, /^\[bg_[0-9a-z]+ is still running on Workstation, for \d+ s|^\[Filament: your background command bg_[0-9a-z]+ on Workstation ended/);
    const end = await until(() => ends.find((e) => e.id === sid) || null, "its end delivered", { timeoutMs: 20_000 });
    assert.match(end.text, /^\[Filament: your background command bg_[0-9a-z]+ on Workstation ended — `node -e .+` exited with code 3 after \d+ s\.\]/);
    assert.match(end.text, /first-out[\s\S]*second-out/);
    assert.equal(forms.length, 0, "auto there asks nothing");
    // Its stop, sent there.
    const f = await commands.call({ command: forever("pid-coder.txt"), machine: "Workstation" }, ctx);
    const pid = await pidIn("pid-coder.txt");
    const stopped = await commands.call({ id: shellOf(f.text), stop: true }, ctx);
    assert.match(stopped.text, /^Stopped background command bg_[0-9a-z]+ \(`.+`\) on Workstation after \d+ s: its result will not come\./);
    await until(() => !alive(pid), `node ${pid} on Workstation gone`, { timeoutMs: 20_000 });
    // There in ask mode: the person's press here, on the card the agent's turn puts up.
    await mode("ask");
    try {
      reply = "allow";
      const ran = await commands.call({ command: leaves("c1"), machine: "Workstation" }, ctx);
      assert.equal(forms.at(-1)?.judged?.tool, "background_command on Workstation");
      assert.equal(forms.at(-1)?.judged?.command, leaves("c1"));
      assert.match(ran.text, /^(Started background command bg_[0-9a-z]+ on Workstation|\[Filament: your background command bg_[0-9a-z]+ on Workstation ended — `.+` exited with code 0)/);
      // The start answers as the command begins there: its file comes a moment after.
      await until(() => existsSync(join(thereRepo, "ran-c1.txt")) || null, "it ran there on the press");
      reply = "deny";
      const no = await commands.call({ command: leaves("c2"), machine: "Workstation" }, ctx);
      // (fails before: yes — the call waited on the card and refused with its Deny: its start answers as the ask waits now,
      // and the Deny is its end, here within the start's grace)
      assert.match(no.text, /^\[Filament: your background command bg_[0-9a-z]+ on Workstation ended — `.+` ended \(Not run on Workstation: the person denied it\.\) after \d+ s\.\]\nIt printed nothing\.$/);
      assert.equal(existsSync(join(thereRepo, "ran-c2.txt")), false);
      // A press that comes after the start's grace: the call has answered that it waits on the card; the press runs it.
      /** @type {(v: any) => void} */
      let pressed = () => {};
      const slow = { ...ctx, askPerson: async (/** @type {any} */ form) => (forms.push(form), new Promise((r) => (pressed = r))) };
      const quick = createBackgroundCommands({ registry: () => ({ commandEnd: (/** @type {string} */ chain, /** @type {any} */ r) => (ends.push({ chain, ...r }), { ok: true }) }), machines: createMachines({ dataDir: two.here.dataDir }), graceMs: 200 });
      const waiting = await quick.call({ command: leaves("c6"), machine: "Workstation" }, slow);
      assert.match(waiting.text, /^Started background command bg_[0-9a-z]+ on Workstation: .+ It waits for the person's press on this chat's permission card before it runs there: their Allow runs it, and their Deny, or a wait that is cut, ends it in words\. Go on with your work/);
      assert.equal(existsSync(join(thereRepo, "ran-c6.txt")), false, "nothing ran before the press");
      pressed({ outcome: "answered", answers: { permission: { chosen: ["allow"] } } });
      await until(() => existsSync(join(thereRepo, "ran-c6.txt")) || null, "it ran there on the press");
      const sixth = shellOf(waiting.text);
      const six = await until(() => ends.find((e) => e.id === sixth) || null, "its end delivered", { timeoutMs: 20_000 });
      assert.match(six.text, /exited with code 0/);
    } finally {
      await mode("auto");
    }
    // (fails before: yes — its chat's ask rule was never read: the command ran there unasked, that machine in auto)
    // A rule of its chat that asks first (`rulesAsk`): its card here before anything is sent there.
    const before = forms.length;
    const ruled = { ...ctx, rulesAsk: () => "bash(node -e *) ask" };
    reply = "deny";
    const held = await commands.call({ command: leaves("c4"), machine: "Workstation" }, ruled);
    assert.match(held.text, /^\[Filament: your background command bg_[0-9a-z]+ on Workstation ended — `.+` ended \(Not run on Workstation: the person denied it\.\) after \d+ s\.\]\nIt printed nothing\.$/);
    assert.equal(forms.at(-1)?.title, "Run this command on Workstation? A rule of this chat asks first: bash(node -e *) ask.");
    assert.equal(existsSync(join(thereRepo, "ran-c4.txt")), false);
    reply = "allow";
    const let1 = await commands.call({ command: leaves("c5"), machine: "Workstation" }, ruled);
    assert.match(let1.text, /^(Started background command bg_[0-9a-z]+ on Workstation|\[Filament: your background command bg_[0-9a-z]+ on Workstation ended — `.+` exited with code 0)/);
    assert.equal(existsSync(join(thereRepo, "ran-c5.txt")), true);
    assert.equal(forms.length, before + 2, "one card each, here: auto there asked nothing more");
    // (fails before: yes — its chat's mode went nowhere: that machine's auto ran it unasked, the owner's of 11-10)
    // Its chat's mode, as its bridge says it (`modeNow`): edit asks there, though that machine runs auto.
    reply = "deny";
    const moded = await commands.call({ command: leaves("c7"), machine: "Workstation" }, { ...ctx, modeNow: () => "edit" });
    assert.match(moded.text, /Not run on Workstation: the person denied it\./);
    assert.equal(forms.at(-1)?.title, "Run this command on Workstation? This chat's permission mode (edit) asks first.");
    assert.equal(existsSync(join(thereRepo, "ran-c7.txt")), false);
    // (fails before: yes — cwd with no machine was refused for every agent, machine offered or not)
    // Where machine is not offered, cwd is no field of the tool's: unread, as it always was, and the command runs here.
    const unread = await commands.call({ command: `node -e "console.log('cwd-unread')"`, cwd: thereRepo }, { ...ctx, machines: false });
    assert.match(unread.text, /^(Started background command bg_[0-9a-z]+: |\[Filament: your background command bg_[0-9a-z]+ ended — )/);
    // Refused here before anything reaches there: this chat's switch, an agent not offered machine, a chat another
    // machine's agents started, cwd with no machine where machine is offered.
    const asked = forms.length;
    assert.match(String((await commands.call({ command: leaves("c3"), machine: "Workstation" }, { ...ctx, judgeNow: () => /** @type {const} */ ("refuse") })).text), /^Not run: this chat's permission mode, or a rule of it, refuses this command — on another machine as here\.$/);
    assert.equal((await commands.call({ command: leaves("c3"), machine: "Workstation" }, { ...ctx, machines: false })).text, NOT_OFFERED_THERE);
    const theirs = createBackgroundCommands({ machines: createMachines({ dataDir: two.here.dataDir }), agentsChat: () => true });
    assert.equal((await theirs.call({ command: leaves("c3"), machine: "Workstation" }, ctx)).text, AGENTS_CHAT_THERE);
    assert.match(String((await commands.call({ command: leaves("c3"), cwd: thereRepo }, ctx)).text), /^Not run: cwd names a folder on another machine, with machine/);
    assert.equal(existsSync(join(thereRepo, "ran-c3.txt")), false);
    assert.equal(forms.length, asked, "nobody was asked");
  });
});

/** Until `signal` aborts: a stream kept open. @param {AbortSignal} signal @returns {Promise<void>} */
const openUntil = (signal) => new Promise((r) => (signal.aborted ? r() : signal.addEventListener("abort", () => r(), { once: true })));
/** What `p` gives within `ms`, else null. @template T @param {Promise<T>} p @param {number} [ms] */
const within = (p, ms = 3000) => Promise.race([p, sleepMs(ms).then(() => null)]);

/**
 * A machine kept for this Filament's agents that is a script (the exec route's events, its reads, stops and answers):
 * `events` sends its exec stream's events and ends it by returning; `get` answers its reads — by default never —, `post`
 * its stops and answers. Every call to it is kept in `calls`.
 * `takes`: what its GET /state says it takes from this Filament's agents; none, a Filament from before. `wait`: the
 * pause between two reads of an exec whose stream dropped, where it is not the clock's.
 * @param {{ events: (send: (d: any) => void, signal: AbortSignal) => Promise<void>, get?: (path: string) => Promise<any>, post?: (path: string, body: any) => Promise<any>, takes?: string[], wait?: (ms: number) => Promise<void> }} o
 */
const scripted = ({ events, get = () => new Promise(() => {}), post = async () => ({ ok: true }), takes = undefined, wait = undefined }) => {
  /** @type {any[]} */
  const calls = [];
  const m = { machine: { id: "m-fake" }, name: "Fakebox", device: { scope: "agent" } };
  const client = {
    state: { system: null, ...(takes ? { takes } : {}) },
    get: (/** @type {string} */ path) => (calls.push(["GET", path]), get(path)),
    post: (/** @type {string} */ path, /** @type {any} */ body) => (calls.push(["POST", path, body]), post(path, body)),
    stream: async (/** @type {string} */ path, /** @type {any} */ body, /** @type {(e: string, d: any) => void} */ onEvent, /** @type {any} */ o) => {
      calls.push(["STREAM", path, body]);
      await events((d) => onEvent("message", d), o.signal);
    },
  };
  const machines = /** @type {any} */ ({ list: () => [m], find: () => m, clientOf: async () => (calls.push(["CLIENT"]), client) });
  return { commands: createRemoteCommands(/** @type {any} */ ({ machines, ...(wait ? { wait } : {}) })), calls };
};

describe("a background command on another machine, its exec stream as that machine says it", () => {
  const folder = mkdtempSync(join(tmpdir(), "filament-remote-cmd-script-"));
  const owner = { session: "s-scripted", agent: null };
  /** @param {any} [o] */
  const how = (o = {}) => ({ folder, owner, ask: async () => null, ...o });
  after(() => rmSync(folder, { recursive: true, force: true }));

  // (fails before: yes — the start waited on GET /exec/:id after the exec event, and every event behind it: with the read
  // hanging, the call never answered, its output held unbounded)
  test("its first event says it runs, and the call answers with no read; an older machine's says neither, its read hangs, and its first output answers the call", async () => {
    const now = scripted({
      events: async (send, signal) => {
        send({ type: "exec", id: "ex_1", state: "running", cwd: "/there/widgets", mode: "auto" });
        await openUntil(signal);
      },
    });
    const a = await within(now.commands.start({ machine: "Fakebox", cwd: "/there/widgets", command: "tail -f log" }, how()));
    assert.ok(a, "it answered at once");
    assert.deepEqual(now.calls.filter((c) => c[0] === "GET"), [], "nothing read");
    await a.s.stop();
    const older = scripted({
      events: async (send, signal) => {
        send({ type: "exec", id: "ex_2", cwd: "/there/widgets", mode: "auto" });
        await sleepMs(100);
        send({ type: "output", stream: "stdout", text: "hello from there\n" });
        await openUntil(signal);
      },
    });
    const b = await within(older.commands.start({ machine: "Fakebox", cwd: "/there/widgets", command: "tail -f log" }, how()));
    assert.ok(b, "it answered while its read hung");
    assert.match(b.s.out, /hello from there/);
    assert.deepEqual(older.calls.filter((c) => c[0] === "GET").map((c) => c[1]), ["/exec/ex_2"]);
    await b.s.stop();
    assert.ok(older.calls.some((c) => c[0] === "POST" && c[1] === "/exec/ex_2/stop"), "its stop sent there");
  });

  // (fails before: yes — no mode went with a command: that machine's own judged it, and the card said so whatever this
  // chat's mode — the owner's of 11-10)
  test("this chat's mode goes with its command where that machine takes it, and its card says whose mode asks; a Filament there from before is sent none, and its own mode is said", async () => {
    for (const [takes, sent, judged, words] of /** @type {[string[] | undefined, string, string, RegExp][]} */ ([
      [["mode", "exec-mode"], "edit", "edit", /^Run this command on Fakebox\? This chat's permission mode \(edit\) asks first\.$/],
      [["mode", "exec-mode"], "auto", "edit", /^Run this command on Fakebox\? This chat runs in auto, and Fakebox asks first: its Without asking grant for this Filament's agents is off\.$/],
      [["mode"], "edit", "ask", /^Run this command on Fakebox\? Its permission mode there \(ask\) asks first\.$/],
      [undefined, "edit", "ask", /^Run this command on Fakebox\? Its permission mode there \(ask\) asks first\.$/],
      // (fails before: yes — a rule there that asked was said as this chat's mode asking, the review of 11-10)
      [["mode", "exec-mode"], "auto", "auto", /^Run this command on Fakebox\? A rule there asks first: bash\(make\) ask\.$/],
    ])) {
      const s = scripted({
        takes,
        get: async () => ({ state: "asking" }),
        events: async (send, signal) => {
          send({ type: "exec", id: "ex_m", state: "asking", mode: judged, ...(sent === judged && judged === "auto" ? { rule: "bash(make) ask" } : {}) });
          send({ type: "ask", ask: { id: "ex_m" } });
          await openUntil(signal);
        },
      });
      /** @type {any} */
      let q = null;
      const ask = async (/** @type {any} */ asked) => ((q = asked), { allow: false, words: "" });
      await assert.rejects(s.commands.start({ machine: "Fakebox", cwd: "/there/widgets", command: "make" }, how({ ask, mode: sent })), /Not run on Fakebox: the person denied it\./);
      const body = s.calls.find((c) => c[0] === "STREAM")?.[2];
      assert.equal(body?.mode, takes?.includes("exec-mode") ? sent : undefined, `sent with ${JSON.stringify(takes)}`);
      assert.match(thereForm(q, { tool: "bash_background" }).title, words);
    }
  });

  // (fails before: yes — what came before it was seen to run was held whole, and its events waited behind the ask)
  test("a flood of output before it is seen to run is held to its first and newest characters", async () => {
    const piece = "y".repeat(10_000);
    const s = scripted({
      get: async () => ({ state: "asking" }),
      events: async (send, signal) => {
        send({ type: "exec", id: "ex_3", state: "asking", mode: "ask" });
        send({ type: "ask", ask: { id: "ex_3" } });
        for (let i = 0; i < 200; i++) send({ type: "output", stream: "stdout", text: piece });
        send({ type: "answer", allow: true, by: "local" });
        await openUntil(signal);
      },
    });
    const ask = (/** @type {any} */ _q, /** @type {AbortSignal} */ gone) => new Promise((r) => gone.addEventListener("abort", () => r(null), { once: true }));
    const r = await within(s.commands.start({ machine: "Fakebox", cwd: "/there/widgets", command: "yes" }, how({ ask })));
    assert.ok(r, "it answered");
    assert.ok(r.s.produced <= 2 * 32 * 1024 + 200, `${r.s.produced} characters kept of 2,000,000`);
    assert.match(r.s.out, /\[Filament: \d+ characters of its output were dropped here, before it was seen to run\]/);
    await r.s.stop();
  });

  // (fails before: yes — its answer there waited behind the ask's wait here: the call stayed blocked on the card, and a
  // later Deny here was sent there, 409, which let the stream go and stopped what that machine's person had allowed)
  test("an ask allowed on that machine while its card waits here: the call answers, the card is let go as answered there, and a late Deny here sends nothing", async () => {
    const s = scripted({
      get: async () => ({ state: "asking" }),
      events: async (send, signal) => {
        send({ type: "exec", id: "ex_4", state: "asking", mode: "ask" });
        send({ type: "ask", ask: { id: "ex_4" } });
        await sleepMs(200);
        send({ type: "answer", allow: true, by: "Its own person" });
        send({ type: "output", stream: "stdout", text: "running there\n" });
        await openUntil(signal);
      },
    });
    /** The ask's wait here, as the start let it go. */
    const held = { gone: /** @type {AbortSignal | null} */ (null) };
    /** @type {(v: any) => void} */
    let late = () => {};
    const ask = (/** @type {any} */ _q, /** @type {AbortSignal} */ g) => ((held.gone = g), new Promise((r) => (late = r)));
    const r = await within(s.commands.start({ machine: "Fakebox", cwd: "/there/widgets", command: "serve" }, how({ ask })));
    assert.ok(r, "the call answered with no press here");
    assert.deepEqual([held.gone?.aborted, held.gone?.reason], [true, ANSWERED_THERE]);
    late({ allow: false, words: "" });
    await sleepMs(300);
    assert.deepEqual(s.calls.filter((c) => c[0] === "POST"), [], "no answer, no stop sent there");
    assert.equal(r.s.endedAt, null, "it runs on");
    assert.match(r.s.out, /running there/);
    await r.s.stop();
  });

  // (fails before: yes — its end waited behind the ask's wait here, for a press, while that machine had ended it)
  test("an ask that ends on that machine while its card waits here: the call refuses in that machine's words, the card is let go as ended there, nothing sent", async () => {
    const s = scripted({
      get: async () => ({ state: "asking" }),
      events: async (send, signal) => {
        send({ type: "exec", id: "ex_6", state: "asking", mode: "ask" });
        send({ type: "ask", ask: { id: "ex_6" } });
        await sleepMs(200);
        send({ type: "exit", code: null, signal: null, ms: 0, ended: "denied", reason: "denied: not on this box" });
        await openUntil(signal);
      },
    });
    /** The ask's wait here, as the start let it go. */
    const held = { gone: /** @type {AbortSignal | null} */ (null) };
    const ask = (/** @type {any} */ _q, /** @type {AbortSignal} */ g) => ((held.gone = g), new Promise(() => {}));
    const r = await within(s.commands.start({ machine: "Fakebox", cwd: "/there/widgets", command: "deploy" }, how({ ask })).then(() => "started", (e) => String(e.message)));
    assert.equal(r, "Not run on Fakebox: denied: not on this box.");
    assert.deepEqual([held.gone?.aborted, held.gone?.reason], [true, ENDED_THERE]);
    assert.deepEqual(s.calls.filter((c) => c[0] === "POST"), []);
  });

  // (fails before: yes — the owner's of 11-10: a coding agent's background_command waited on the card until its MCP call
  // timed out on the agent's side, and the ask there was cut with it: "the wait for the person's answer was cut")
  test("a start that answers as its ask waits (a coding agent's): the call answers at once, its own end cuts nothing; a press runs it, a Deny or a cut wait ends it in words", async () => {
    /** @param {(a: any) => void} [onAnswer] */
    const box = (onAnswer = () => {}) => {
      /** @type {(b: any) => void} */
      let answered = () => {};
      const press = new Promise((r) => (answered = r));
      const s = scripted({
        get: async () => ({ state: "asking" }),
        post: async (path, body) => (path.endsWith("/answer") && (answered(body), onAnswer(body)), { ok: true }),
        events: async (send, signal) => {
          send({ type: "exec", id: "ex_7", state: "asking", mode: "edit" });
          send({ type: "ask", ask: { id: "ex_7" } });
          const b = /** @type {any} */ (await Promise.race([press, openUntil(signal)]));
          if (b?.allow) {
            send({ type: "answer", allow: true, by: "DESKTOP-1's agents" });
            send({ type: "output", stream: "stdout", text: "ran there\n" });
            send({ type: "exit", code: 0, signal: null, ms: 5 });
          } else if (b) send({ type: "exit", code: null, signal: null, ms: 0, ended: "denied", reason: "denied by the person" });
          await openUntil(signal);
        },
      });
      /** @type {{ gone: AbortSignal | null, reply: (v: any) => void }} */
      const held = { gone: null, reply: () => {} };
      const ask = (/** @type {any} */ _q, /** @type {AbortSignal} */ g) => ((held.gone = g), new Promise((r) => (held.reply = r)));
      const call = new AbortController();
      const start = async () => {
        const r = await within(s.commands.start({ machine: "Fakebox", cwd: "/there/widgets", command: "npm test" }, how({ ask, early: true, signal: call.signal })));
        assert.ok(r, "it answered while the ask waits");
        return r;
      };
      return { s, held, call, start };
    };
    // Allowed: the call answered before the press, its own end let go of nothing, and the press ran it there.
    let b = box();
    let r = await b.start();
    assert.deepEqual([r.waits(), r.s.endedAt, r.s.machine], [true, null, "Fakebox"]);
    b.call.abort();
    await sleepMs(100);
    assert.equal(b.held.gone?.aborted, false, "the call's end cuts no ask");
    b.held.reply({ allow: true, words: "" });
    await until(() => (r.s.endedAt != null ? r : null), "its end");
    assert.deepEqual([r.s.proc.exitCode, /ran there/.test(r.s.out), r.s.why ?? null, r.waits()], [0, true, null, false]);
    assert.deepEqual(b.s.calls.filter((c) => c[0] === "POST").map((c) => [c[1], c[2]]), [["/exec/ex_7/answer", { allow: true }]]);
    // Denied: its end says so, and nothing ran.
    b = box();
    r = await b.start();
    b.held.reply({ allow: false, words: "not now" });
    await until(() => (r.s.endedAt != null ? r : null), "its end");
    assert.deepEqual([r.s.why, r.s.out], ['Not run on Fakebox: the person denied it — "not now".', ""]);
    // The wait cut (the turn ended, the card let go): its end says so, and its exec there is let go.
    b = box();
    r = await b.start();
    b.held.reply(null);
    await until(() => (r.s.endedAt != null ? r : null), "its end");
    assert.equal(r.s.why, "Not run on Fakebox: the wait for the person's answer was cut, and its ask there ended with it.");
    assert.deepEqual(b.s.calls.filter((c) => c[0] === "POST"), [], "no answer sent there: its stream let go");
  });

  // (fails before: yes — the card's id was the call's own, `there-call_0` twice; a rule of this chat that asks was not
  // handed to the start; a card let go as ended there said only that it was cancelled)
  test("the loop's cards for a command there: each its own id, a rule of this chat that asks handed to the start, a card let go as ended there saying so", async () => {
    /** @type {any[]} */
    const events = [];
    /** @type {any[]} */
    const rules = [];
    let n = 0;
    const toolUse = (/** @type {any} */ input) => ({ type: "tool_use", id: "call_0", name: "bash_background", input });
    const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
    const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
    const out = await runAgentTurn(/** @type {any} */ ({
      model: "m",
      messages: [{ role: "user", content: "go" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false, machines: true }),
      modeNow: () => "auto",
      root: folder,
      readerModel: "",
      maxTokens: 100,
      call: async () => (++n <= 2 ? reply([toolUse({ command: `node -e "${n}"`, machine: "Fakebox" })]) : reply([{ type: "text", text: "Done." }])),
      costOf: () => 0,
      runHand: async (/** @type {string} */ _name, /** @type {any} */ input, /** @type {any} */ o) => o.remote(input).then(() => "started", (/** @type {any} */ e) => String(e.message)),
      delegateRead: null,
      mailbox: { read: () => [] },
      permissions: null,
      tree: null,
      onEvent: (/** @type {any} */ e) => events.push(e),
      previewChars: 0,
      sink,
      signal: null,
      resume: null,
      rules: [{ tool: "bash", pattern: "node -e*", verdict: "ask" }],
      machines: {
        agentsChat: false,
        answer: (/** @type {string} */ _id, /** @type {any} */ o) => new Promise((r) => o.signal.addEventListener("abort", () => r(null), { once: true })),
        start: async (/** @type {any} */ input, /** @type {any} */ o) => {
          rules.push(o.rule);
          const gone = new AbortController();
          const asked = o.ask({ machine: "Fakebox", cwd: "/there/widgets", command: input.command, mode: "ask" }, gone.signal);
          await sleepMs(50);
          gone.abort(ENDED_THERE);
          await asked;
          throw new Error("Not run on Fakebox: denied: not on this box.");
        },
      },
    }));
    assert.equal(out.status, "done");
    const cards = events.filter((e) => e.type === "ask" && e.form?.judged);
    assert.deepEqual(cards.map((c) => c.call), ["call_0", "call_0"]);
    assert.notEqual(cards[0].id, cards[1].id);
    assert.deepEqual(rules, ["bash(node -e*) ask", "bash(node -e*) ask"]);
    assert.deepEqual(events.filter((e) => e.type === "ask-end").map((e) => [e.words, e.there]), [[["Ended on Fakebox"], "Fakebox"], [["Ended on Fakebox"], "Fakebox"]]);
  });

  // (fails before: yes — finding 1 of the review of 11-11: five reads a second apart, then a stop was sent and the
  // command said lost, while it ran on there and that machine answered each read)
  test("a stream that drops while its command runs there: its exec is read again by its id for as long as it runs — what it printed meanwhile comes, its end is as that machine says it, and no stop is sent", async () => {
    let reads = 0;
    /** @type {number[]} */
    const waits = [];
    const s = scripted({
      wait: async (/** @type {number} */ ms) => void waits.push(ms),
      get: async () => {
        reads++;
        // Twice that machine does not answer: asked again.
        if (reads === 3 || reads === 4) throw new Error("connect ETIMEDOUT");
        if (reads < 9) return { state: "running", output: [{ stream: "stdout", text: `x\n${"y\n".repeat(Math.min(reads, 5))}` }] };
        return { state: "ended", code: 0, output: [{ stream: "stdout", text: "x\ny\ny\ny\ny\ny\nz\n" }] };
      },
      events: async (send) => {
        send({ type: "exec", id: "ex_6", state: "running", mode: "auto" });
        send({ type: "output", stream: "stdout", text: "x\n" });
      },
    });
    /** @type {any[]} */
    const ends = [];
    await s.commands.start({ machine: "Fakebox", cwd: "/there/widgets", command: "build" }, how({ onEnd: (/** @type {any} */ e) => ends.push(e) }));
    const end = await until(() => ends[0] || null, "its end there", { timeoutMs: 15_000 });
    assert.deepEqual([end.code, end.why, end.out], [0, undefined, "x\ny\ny\ny\ny\ny\nz\n"]);
    assert.deepEqual(s.calls.filter((c) => c[0] === "POST"), [], "no stop sent");
    assert.equal(reads, 9, "read until it ended there");
    // Between two reads that machine answered, REATTACHED_MS; after one it did not, a wait that grows from REREAD_MS.
    assert.deepEqual(waits, [5000, 5000, 1000, 2000, 5000, 5000, 5000, 5000]);
  });

  // (fails before: yes — finding 1: after five seconds its end said "it may still be running … until Fakebox sees this
  // Filament gone", which nothing bounded; that machine now stops it by itself once it goes unread for its grace)
  test("a stream that drops and a machine that does not answer again: asked further and further apart until past the grace that machine gives the command, then its end says what is known — unread, stopped there by that machine's own rule, a stop sent that may not have reached it", async () => {
    /** @type {number[]} */
    const waits = [];
    const s = scripted({
      wait: async (/** @type {number} */ ms) => void waits.push(ms),
      get: async () => {
        throw new Error("nothing at that address");
      },
      events: async (send) => {
        send({ type: "exec", id: "ex_5", state: "running", mode: "auto" });
        send({ type: "output", stream: "stdout", text: "x\n" });
      },
    });
    /** @type {any[]} */
    const ends = [];
    await s.commands.start({ machine: "Fakebox", cwd: "/there/widgets", command: "watch" }, how({ onEnd: (/** @type {any} */ e) => ends.push(e) }));
    const end = await until(() => ends[0] || null, "its end, lost", { timeoutMs: 15_000 });
    assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16_000, ...Array(11).fill(30_000)], "asked on for six minutes");
    assert.equal(end.why, "its stream from Fakebox dropped (its stream ended with no end said), and Fakebox has not answered for 6 min since: its end there could not be read. Fakebox stops a command whose stream is gone within 5 min unless it is read again, so it runs there no more — unless Filament on Fakebox went down first; a stop was sent there too, and may not have reached it");
    assert.ok(s.calls.some((c) => c[0] === "POST" && c[1] === "/exec/ex_5/stop"));
    // The bounds, named: this side asks on for longer than that machine keeps an unread command running.
    const { LOST_AFTER_MS, THERE_GRACE_MS } = /** @type {any} */ (remoteCommands);
    assert.deepEqual([LOST_AFTER_MS, THERE_GRACE_MS, THERE_GRACE_MS === EXEC_GRACE_MS], [6 * 60_000, 5 * 60_000, true]);
  });

  // (fails before: yes — a refusal was read five times as silence, and its end's words said nothing of it: it guards
  // the longer wait from a machine that answers no, too)
  test("a stream that drops and a machine that refuses the read: its end says so at once, and that it may still run there", async () => {
    /** @type {number[]} */
    const waits = [];
    const s = scripted({
      wait: async (/** @type {number} */ ms) => void waits.push(ms),
      get: async () => {
        throw Object.assign(new Error("no such exec"), { status: 404, body: { error: "no such exec" } });
      },
      events: async (send) => {
        send({ type: "exec", id: "ex_7", state: "running", mode: "auto" });
        send({ type: "output", stream: "stdout", text: "x\n" });
      },
    });
    /** @type {any[]} */
    const ends = [];
    await s.commands.start({ machine: "Fakebox", cwd: "/there/widgets", command: "watch" }, how({ onEnd: (/** @type {any} */ e) => ends.push(e) }));
    const end = await until(() => ends[0] || null, "its end, lost", { timeoutMs: 15_000 });
    assert.deepEqual(waits, []);
    assert.equal(end.why, "its stream from Fakebox dropped (its stream ended with no end said), and Fakebox would not say how it stands (no such exec): its end there could not be read — it may still be running on Fakebox; a stop was sent there");
  });

  // (fails before: yes — a command of any length was sent, its card cutting it at 20,000 characters)
  test("a command longer than its card shows whole is refused in words, before the machine is even asked", async () => {
    const s = scripted({ events: async () => {} });
    const command = `echo ${"a".repeat(20_000)}`;
    await assert.rejects(s.commands.start({ machine: "Fakebox", cwd: "/there/widgets", command }, how()), /Not run: this command is 20005 characters long, and a command on another machine runs only as its permission card shows it whole — 20000 characters at most/);
    assert.deepEqual(s.calls, []);
  });

  // (fails before: yes — hands.js refused cwd with no machine for every caller, a Filament with no machine kept too)
  test("with no machine offered, bash_background's cwd goes unread, as it always did", async () => {
    const r = await runHand("bash_background", { command: `node -e "console.log('cwd-unread')"`, cwd: "/a/folder/elsewhere" }, { root: folder, owner }).catch((/** @type {any} */ e) => String(e?.message || e));
    assert.match(String(r), /Background shell bg_[0-9a-z]+ (started|already finished)/);
  });

  // (fails before: yes — the coding agents' permits had no rulesAsk)
  test("a coding agent's permits name the ask or review rule that speaks for a command, whatever the mode", () => {
    const permits = createAgentPermits(/** @type {any} */ ({ rules: [{ tool: "bash", pattern: "git push*", verdict: "ask" }, { tool: "bash", pattern: "rm -rf *", verdict: "review" }], modeNow: () => "auto", learned: null }));
    const of = (/** @type {string} */ command) => permits.rulesAsk?.([{ name: "bash_background", input: { command } }], folder) ?? "none";
    assert.deepEqual([of("git push --force"), of("rm -rf build"), of("npm test")], ["bash(git push*) ask", "bash(rm -rf *) review", "none"]);
  });

  // (fails before: yes — the shutdown waited for every stop, one sent to a machine that never answers for good)
  test("Filament's shutdown waits a few seconds at most for the stops it sends to other machines", async () => {
    const hung = keepRemoteShell({ command: "serve", cwd: folder, owner, machine: "Fakebox", stop: () => /** @type {Promise<void>} */ (new Promise(() => {})) });
    assert.ok(hung.id);
    const t = Date.now();
    const done = await within(disposeBackgroundShells().then(() => true), 10_000);
    assert.equal(done, true, "the shutdown went on");
    assert.ok(Date.now() - t < 6000, `it waited ${Date.now() - t} ms`);
  });
});
