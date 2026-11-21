// @ts-check
// HarnessV3-FixRound F5 — shell safety (HarnessV3 §14), PM decision 20.
// 22: a secret split across two `bash_output` reads escaped the session's redaction: each read redacted only its own
//     slice. Now the whole kept output is redacted and the read returns its new part; while the shell runs under a
//     session that redacts, an unfinished last line waits for its end, so a read never shows the half of a secret that
//     no pattern can match yet.
// 23: any loop with the shell could read or stop any background shell whose id it knew. Now a shell belongs to the
//     agent that started it, in its session: the session's main agent reaches every shell of its session, any other
//     agent (a sub-agent) only its own, and another session's shell is unknown.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHand, disposeBackgroundShells } from "../src/adapters/tools/hands.js";
import { shellSessionOf } from "../src/core/conversation.js";
import { redactorOf } from "../src/core/redact.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

after(() => disposeBackgroundShells());
const cwd = tmpdir();
const idOf = (/** @type {string} */ text) => (/bg_[0-9a-z]+/.exec(text) || [""])[0];
/** @param {string} name @param {any} input @param {any} [o] */
const run = async (name, input, o = {}) => String(await runHand(name, input, { root: cwd, ...o }));
const LONG = `node -e "console.log('up');setInterval(()=>{},1000)"`;

// ---- 22: redaction across reads ----

// (fails before: yes — the first read showed "key=SECRET-ABCDEF", the next "GHIJKL", and neither slice matched alone)
test("a secret printed in two halves across reads comes back redacted: the first half waits for its line, then the whole line is redacted", async () => {
  const redact = (/** @type {string} */ t) => t.replace(/SECRET-[A-Z]{12}/g, "[redacted]");
  // The first half lands after the start has answered, so a bash_output read is the one that must hold it.
  const cmd = `node -e "setTimeout(()=>process.stdout.write('key=SECRET-ABCDEF'),800);setTimeout(()=>{console.log('GHIJKL');setTimeout(()=>{},2000)},3800)"`;
  const start = await run("bash_background", { command: cmd, grace: 0.1 }, { redact });
  const id = idOf(start);
  assert.ok(id, start);
  assert.doesNotMatch(start, /unfinished line/, "the start answered before the first half");
  // Read until the first half has surely been printed: a read now must hold it, and say that it does.
  let early = "";
  for (let i = 0; i < 50 && !/unfinished line|SECRET/.test(early); i++) {
    early += await run("bash_output", { id, wait: 0 }, { redact });
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.doesNotMatch(early, /SECRET|ABCDEF/, early);
  assert.match(early, /17 more characters are an unfinished line, shown once the line ends or the command exits/);
  const line = await run("bash_output", { id, wait: 10 }, { redact });
  assert.match(line, /key=\[redacted\]/, line);
  const rest = await run("bash_output", { id, wait: 10 }, { redact });
  for (const text of [line, rest]) assert.doesNotMatch(text, /ABCDEF|GHIJKL/, text);
  assert.doesNotMatch(rest, /key=/, "a read returns only what is new: the redacted line is not shown again");
  await run("bash_kill", { id });
});

// (fails before: yes — the start's early output showed "key=SECRET-ABCDEF")
test("the start's early output holds an unfinished line too, and the next read takes it up whole", async () => {
  const redact = (/** @type {string} */ t) => t.replace(/SECRET-[A-Z]{12}/g, "[redacted]");
  const cmd = `node -e "process.stdout.write('key=SECRET-ABCDEF');setTimeout(()=>{console.log('GHIJKL');setTimeout(()=>{},2000)},7000)"`;
  const start = await run("bash_background", { command: cmd, grace: 5 }, { redact });
  const id = idOf(start);
  assert.doesNotMatch(start, /SECRET|ABCDEF/, start);
  assert.match(start, /No output yet\.\n\[Filament: 17 more characters are an unfinished line/, start);
  const line = await run("bash_output", { id, wait: 10 }, { redact });
  assert.match(line, /still running\]\nkey=\[redacted\]/, line);
  await run("bash_kill", { id });
});

// (fails before: yes — the second read redacted "ABCDEFGH\nEND KEY" alone, which the pattern does not match)
test("the redaction runs over the whole kept output: a match that began in an earlier read is redacted whole, shown as its mark", async () => {
  const redact = (/** @type {string} */ t) => t.replace(/BEGIN KEY\n[A-Z]+\nEND KEY/g, "[redacted]");
  const cmd = `node -e "setTimeout(()=>console.log('BEGIN KEY'),500);setTimeout(()=>{process.stdout.write('ABCDEFGH\\nEND KEY\\n');setTimeout(()=>{},2000)},2500)"`;
  const id = idOf(await run("bash_background", { command: cmd, grace: 0.1 }, { redact }));
  const first = await run("bash_output", { id, wait: 10 }, { redact });
  assert.match(first, /BEGIN KEY/, "a finished line goes out at once: the first line of a pattern written across lines is the gap decision 20 names");
  const second = await run("bash_output", { id, wait: 10 }, { redact });
  assert.match(second, /\[redacted\]/, second);
  assert.doesNotMatch(second, /ABCDEFGH|END KEY/, second);
  await run("bash_kill", { id });
});

// (fails before: no — this pins that the hold is redaction's alone; it kills the mutant that holds without it)
test("with nothing to redact, an unfinished line is shown at once: the hold is for a session that redacts", async () => {
  const id = idOf(await run("bash_background", { command: `node -e "setTimeout(()=>process.stdout.write('READY'),500);setInterval(()=>{},1000)"`, grace: 0.1 }));
  const t0 = Date.now();
  const out = await run("bash_output", { id, wait: 10 });
  assert.match(out, /READY/, out);
  assert.doesNotMatch(out, /unfinished line/);
  assert.ok(Date.now() - t0 < 6000, "the read ended on the output, not on its wait");
  await run("bash_kill", { id });
});

// (fails before: no — new behaviour; it kills a hold that waits for \n alone)
test("under redaction a carriage return ends a line too: a progress bar's redraw is shown as it lands", async () => {
  const redact = (/** @type {string} */ t) => t.replace(/SECRET-[A-Z]{12}/g, "[redacted]");
  const id = idOf(await run("bash_background", { command: `node -e "setTimeout(()=>process.stdout.write('50%\\r'),500);setInterval(()=>{},1000)"`, grace: 0.1 }, { redact }));
  const t0 = Date.now();
  const out = await run("bash_output", { id, wait: 10 }, { redact });
  assert.match(out, /50%/, out);
  assert.doesNotMatch(out, /unfinished line/);
  assert.ok(Date.now() - t0 < 6000, "the redraw was not held for its wait");
  await run("bash_kill", { id });
});

// (fails before: yes for the held part — the read showed all 11,019 characters; new behaviour)
test("under redaction an unfinished line longer than the hold shows all but its last 4,096 characters, and a secret inside it is matched whole", async () => {
  const redact = (/** @type {string} */ t) => t.replace(/SECRET-[A-Z]{12}/g, "[redacted]");
  const cmd = `node -e "setTimeout(()=>process.stdout.write('x'.repeat(6000)+'SECRET-ABCDEFGHIJKL'+'y'.repeat(5000)),500);setInterval(()=>{},1000)"`;
  const id = idOf(await run("bash_background", { command: cmd, grace: 0.1 }, { redact }));
  const out = await run("bash_output", { id, wait: 10 }, { redact });
  assert.match(out, /x\[redacted\]y/, out.slice(0, 200));
  assert.doesNotMatch(out, /ABCDEF/);
  assert.equal(/\[redacted\](y+)/.exec(out)?.[1].length, 11019 - 4096 - 6019, "the line is shown up to 4,096 characters before its newest end");
  assert.match(out, /4.096 more characters are an unfinished line/);
  await run("bash_kill", { id });
});

// (fails before: yes — redactorOf gave an identity function, so every source took any session as one that redacts)
test("redactorOf: null when there is nothing to apply, else every pattern replaced", () => {
  assert.equal(redactorOf([]), null);
  assert.equal(redactorOf(["", "("]), null, "a pattern that is empty or does not compile is left out");
  assert.equal(redactorOf(["k[0-9]+"])?.("a k12 b k3"), "a [redacted] b [redacted]");
});

// ---- 23: whose shell it is ----

// (fails before: yes — any caller read and stopped any shell by its id)
test("a background shell is its starter's: a worker naming the main agent's shell is refused, its kill too; the main agent reaches its delegates' shells; another session's is unknown", async () => {
  const main = { session: "S1", agent: null };
  const worker = { session: "S1", agent: "task-1" };
  const sub = { session: "S1", agent: "subagent:a" };
  const sibling = { session: "S1", agent: "subagent:b" };
  const other = { session: "S2", agent: null };
  const mine = idOf(await run("bash_background", { command: LONG, grace: 0.1 }, { owner: main }));
  await assert.rejects(run("bash_output", { id: mine }, { owner: worker }), /background shell "bg_\w+" was started by another agent in this session; only that agent, or the session's main agent, can read or stop it/);
  await assert.rejects(run("bash_kill", { id: mine }, { owner: worker }), /started by another agent in this session/);
  await assert.rejects(run("bash_output", { id: mine }, { owner: sub }), /started by another agent in this session/);
  await assert.rejects(run("bash_output", { id: mine }, { owner: other }), /no background shell "bg_\w+" — it may have been stopped/, "another session's shell is as unknown as an id never issued");
  await assert.rejects(run("bash_kill", { id: mine }, { owner: other }), /no background shell/);
  await assert.rejects(run("bash_output", { id: mine }), /no background shell/, "a caller that names no owner is the anonymous session");
  assert.match(await run("bash_output", { id: mine }, { owner: main }), /still running/, "the refused kills left it running, and its starter reads it");
  const theirs = idOf(await run("bash_background", { command: LONG, grace: 0.1 }, { owner: sub }));
  assert.match(await run("bash_output", { id: theirs }, { owner: sub }), /still running/, "a sub-agent reaches its own");
  await assert.rejects(run("bash_output", { id: theirs }, { owner: sibling }), /started by another agent in this session/, "not a sibling's");
  assert.match(await run("bash_kill", { id: theirs }, { owner: main }), /Background shell bg_\w+ stopped/, "the main agent stops what its sub-agent left running");
  assert.match(await run("bash_kill", { id: mine }, { owner: main }), /stopped/);
  const anon = idOf(await run("bash_background", { command: LONG, grace: 0.1 }));
  await assert.rejects(run("bash_kill", { id: anon }, { owner: main }), /no background shell/, "and a named session does not reach the anonymous one's");
  assert.match(await run("bash_kill", { id: anon }), /stopped/);
});

// (fails before: yes — there was no such function; every agent of a session must agree on it)
test("shellSessionOf: Filament's chain header, else the chain memory found, else the client's conversation id, else the anonymous session", () => {
  assert.equal(shellSessionOf({ "x-filament-chain": "c1", "x-session-id": "s1" }, "m1"), "c1");
  assert.equal(shellSessionOf({ "x-session-id": "s1" }, "m1"), "m1", "an outside client's sub-agent rides the chain memory found, so its main agent must use it too");
  assert.equal(shellSessionOf({ "x-session-id": "s1" }, null), "s1");
  assert.equal(shellSessionOf({}, undefined), "");
});

// ---- end to end: the agent loop and a sub-agent it launches ----
const CHILD = "You are a sub-agent run by Filament";
/** @type {string} */ let root;
/** @type {any} */ let up;
/** @type {any} */ let shim;
/** The main agent's newest background shell, and what its sub-agent's calls were answered. */
let mainShell = "";
let childSaw = "";
/** @param {any} m */
const resultsOf = (m) => (Array.isArray(m?.content) ? m.content.filter((/** @type {any} */ b) => b?.type === "tool_result") : []);
/** @param {any} c */
const contentText = (c) => (typeof c === "string" ? c : (c || []).map((/** @type {any} */ b) => b?.text || "").join(""));
/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-shell-safety-"));
  up = await fakeUpstream((/** @type {any} */ call) => {
    if (call.kind !== "anthropic") return undefined;
    const body = call.body || {};
    const model = String(body.model || "");
    const msgs = body.messages || [];
    const said = resultsOf(msgs.at(-1)).map((/** @type {any} */ r) => contentText(r.content)).join(" | ");
    const answered = resultsOf(msgs.at(-1)).length > 0;
    const say = (/** @type {string} */ text) => anthropicReply(text, { model });
    const use = (/** @type {any[][]} */ ...uses) => anthropicReply("", { model, stop: "tool_use", blocks: uses.map(([id, name, input]) => ({ type: "tool_use", id, name, input })) });
    const peekAt = /peek at (bg_[0-9a-z]+)/.exec(JSON.stringify(msgs))?.[1];
    // A sub-agent the main agent launched: it tries to read and to stop the main agent's shell.
    if (JSON.stringify(body.system ?? "").includes(CHILD)) {
      if (!answered) return use(["c1", "bash_output", { id: peekAt }], ["c2", "bash_kill", { id: peekAt }]);
      childSaw = said;
      return say(`CHILD SAW: ${said}`);
    }
    const newest = textOf([...msgs].reverse().find((/** @type {any} */ m) => m.role === "user" && !resultsOf(m).length));
    if (answered) {
      if (/CHILD SAW/.test(said)) return use(["k1", "bash_kill", { id: mainShell }]);
      const started = /Background shell (bg_[0-9a-z]+) started/.exec(said);
      if (!started) return say(`SAW: ${said}`);
      mainShell = started[1];
      return /and peek/.test(newest) ? use(["a1", "agent", { run_in_background: false, description: "Peek", prompt: `peek at ${mainShell}` }]) : say(`STARTED ${mainShell}`);
    }
    const read = /read (bg_[0-9a-z]+)/.exec(newest);
    if (read) return use(["o1", "bash_output", { id: read[1] }]);
    return use(["b1", "bash_background", { command: LONG }]);
  });
  shim = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.memory.autopilot = { enabled: false };
      cfg.memory.capture = { turns: true, learn: false };
      cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
  // The shells the server's stop killed ran in this folder: Windows lets it go once they have exited.
  await removeDirs(root);
});

const newSession = async () => {
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
  assert.equal(r.status, 200, await r.clone().text());
  return String((await r.json()).id);
};
/** One harness turn; its reply's text. @param {string} id @param {string} content */
const turn = async (id, content) => {
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
  const text = await r.text();
  assert.equal(r.status, 200, text);
  return text;
};

// (fails before: yes — the other session read the shell, and the sub-agent read it and stopped it)
test("a session's main agent keeps its shell across turns; another session cannot name it; a sub-agent it launches can neither read nor stop it", async () => {
  const a = await newSession();
  const b = await newSession();
  const id = /STARTED (bg_[0-9a-z]+)/.exec(await turn(a, "start one"))?.[1] || "";
  assert.ok(id, "the main agent started a shell");
  assert.match(await turn(a, `read ${id}`), /SAW: \[bg_[0-9a-z]+ still running\]/, "the session's next turn reads it");
  assert.match(await turn(b, `read ${id}`), /SAW: Error: no background shell/, "another session knows no such shell");
  assert.match(await turn(a, `read ${id}`), /still running/, "and it was not stopped");
  const t = await turn(a, "start and peek");
  const refusals = childSaw.match(/background shell "bg_[0-9a-z]+" was started by another agent in this session/g) || [];
  assert.equal(refusals.length, 2, `the sub-agent's read and its kill were both refused: ${childSaw}`);
  assert.match(t, /SAW: Background shell bg_[0-9a-z]+ stopped/, "the main agent's own kill found it still running");
});
