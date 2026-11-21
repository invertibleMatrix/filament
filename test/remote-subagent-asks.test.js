// @ts-check
// What a sub-agent on another machine asks (the remote-agents plan's s-asks): its chat there, in that machine's own mode,
// asks the person before a command runs — and the ask shows here, as the sub-agent's own, in words that name the machine,
// and only the person's press here answers it there. Two real Filaments (helpers/two-machines.js): `here` keeps the
// agents' device `there` minted, as the desktop app does; `there` runs its chats in Ask mode, on a fake model that asks
// for a command (`RUN <file>`: a node one-liner that writes the file in its folder), a question (`PICK`), or says its
// report; after a command's result it reports what the result said (`HOLD` holds that report until let go). The launch
// is called as a turn's loop calls the agent tool (`openTurn(…).subagents.run`); the person's press is the page's own
// route here (POST /sessions/:id/subagents/:sid/answer, or the asks route), the person there answers with there's.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTwoMachines } from "./helpers/two-machines.js";
import { anthropicReply, fakeUpstream } from "./helpers/app.js";
import { until } from "./helpers/wait.js";
import { createMachines } from "../src/services/machines/index.js";
import { createRemoteAgents } from "../src/app/agent/remote-agents.js";
import { remoteAsked } from "../src/app/agent/subagents.js";
import { leadOf, running, watched } from "./helpers/team.js";

const JSON_TYPE = { "content-type": "application/json" };
const ORIGIN = "https://github.com/acme/widgets.git";
/** Filament's own loop on the model, so the chat there runs a turn with its run's events. */
const MODEL = "agent/m-1";

/** The words of a message, its text blocks joined. @param {any} m */
const wordsOf = (m) => (typeof m?.content === "string" ? m.content : (Array.isArray(m?.content) ? m.content : []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));
/** What a tool's result said. @param {any} r */
const resultWords = (r) => (typeof r?.content === "string" ? r.content : (r?.content || []).map((/** @type {any} */ b) => b?.text ?? "").join(""));
/** git in a folder, its commits by a test's name. @param {string} cwd @param {string[]} args */
const gitIn = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
/** A model's reply, whole. @param {any[]} blocks @param {string} [stop] */
const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "m-1", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** No answer comes for `ms`: what waits, waits. @param {number} ms */
const quiet = (ms) => new Promise((r) => setTimeout(r, ms));

describe("what a sub-agent on another machine asks", () => {
  const base = mkdtempSync(join(tmpdir(), "filament-remote-asks-"));
  const hereRepo = join(base, "here", "widgets");
  const thereRepo = join(base, "there", "widgets");
  /** The reports there `HOLD` holds, each let go at the end. @type {(() => void)[]} */
  const held = [];
  let calls = 0;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startTwoMachines>>} */
  let two;
  /** @type {any} */
  let registry;
  /** This machine's chat the launches are made from, in Edit mode; and one in Auto mode. */
  let chainId = "";
  let autoChain = "";
  let n = 0;

  /** The model there: a command's result is reported, `RUN <file>` asks for the command, `PICK` asks a question, `STALL`
   *  answers once let go. @param {any} call */
  const brain = (call) => {
    if (call.kind !== "anthropic") return undefined;
    const last = call.body?.messages?.at(-1);
    const result = Array.isArray(last?.content) ? last.content.find((/** @type {any} */ c) => c?.type === "tool_result") : null;
    if (result) {
      const r = reply([{ type: "text", text: `REPORT: ${resultWords(result)}` }]);
      return /HOLD/.test(JSON.stringify(call.body.messages)) ? new Promise((resolve) => held.push(() => resolve(r))) : r;
    }
    const said = wordsOf(last);
    if (/STALL/.test(said)) return new Promise((resolve) => held.push(() => resolve(reply([{ type: "text", text: "STALLED" }]))));
    const file = /RUN (\S+)/.exec(said)?.[1];
    if (file) return reply([{ type: "tool_use", id: `c${++calls}`, name: "bash", input: { command: `node -e "require('fs').writeFileSync('${file}','1')"` } }], "tool_use");
    // `LINES <file>`: a command of two lines, the second indented.
    const lines = /LINES (\S+)/.exec(said)?.[1];
    if (lines) return reply([{ type: "tool_use", id: `c${++calls}`, name: "bash", input: { command: `echo first\n\tnode -e "require('fs').writeFileSync('${lines}','1')"` } }], "tool_use");
    if (/PICK/.test(said)) return reply([{ type: "tool_use", id: `q${++calls}`, name: "ask", input: { question: "Which colour?", options: ["red", "blue"] } }], "tool_use");
    return reply([{ type: "text", text: "REPORT FROM THERE" }]);
  };
  /** The agent tool's launch in the background, as a turn's loop makes it: the sub-agent's id. @param {string} prompt @param {string} [chain] */
  const launch = async (prompt, chain = chainId) => {
    const door = registry.openTurn({ chainId: chain, runId: `turn-${++n}`, cwd: hereRepo, mode: chain === autoChain ? "auto" : "edit", model: MODEL, thinking: null, fork: null });
    try {
      // In the person's clone there, named: its commands' files are looked for there.
      const res = await door.subagents.run({ id: `toolu_${n}`, input: { machine: "Workstation", cwd: thereRepo, description: prompt, prompt, model: MODEL, run_in_background: true }, emit: () => {}, signal: null });
      assert.equal(res.ok, true, res.text);
      return String(/sub-agent (sa_[0-9a-f]+)/.exec(res.text)?.[1]);
    } finally {
      door.close();
    }
  };
  /** A follow-up in the background, as the agent tool's `agent_id` sends it. @param {string} id @param {string} prompt */
  const followUp = async (id, prompt) => {
    const door = registry.openTurn({ chainId, runId: `turn-${++n}`, cwd: hereRepo, mode: "edit", model: MODEL, thinking: null, fork: null });
    try {
      return await door.subagents.run({ id: `toolu_${n}`, input: { agent_id: id, prompt, run_in_background: true }, emit: () => {}, signal: null });
    } finally {
      door.close();
    }
  };
  /** Its ask here, once it shows. @param {string} id */
  const asked = (id) => until(() => registry.get(id)?.progress?.asking || null, `sub-agent ${id}'s ask to show here`, { timeoutMs: 30_000 });
  /** Its end here. @param {string} id */
  const ended = (id) => until(() => registry.get(id)?.status !== "running" && registry.get(id), `sub-agent ${id}'s end here`, { timeoutMs: 30_000 });
  /** The person's press here, on the page's own route. @param {string} id @param {any} body @param {string} [chain] */
  const press = (id, body, chain = chainId) => two.here.api(`/api/sessions/${encodeURIComponent(chain)}/subagents/${encodeURIComponent(id)}/answer`, { method: "POST", body });
  /** What its chat there waits on, as that machine lists it. @param {string} id @returns {Promise<any[]>} */
  const asksThere = async (id) => (await (await two.there.api(`/api/sessions/${encodeURIComponent(registry.get(id).remote.chat)}/asks`)).json()).asks;
  /** What this chat waits on, as this machine lists it. @param {string} [chain] @returns {Promise<any[]>} */
  const asksHere = async (chain = chainId) => (await (await two.here.api(`/api/sessions/${encodeURIComponent(chain)}/asks`)).json()).asks;
  /** Whether a file its command writes is in the clone there. @param {string} file */
  const wrote = (file) => existsSync(join(thereRepo, file));

  before(async () => {
    mkdirSync(hereRepo, { recursive: true });
    mkdirSync(join(base, "there"), { recursive: true });
    gitIn(hereRepo, "init", "-q", "-b", "main");
    writeFileSync(join(hereRepo, "readme.md"), "widgets\n");
    gitIn(hereRepo, "add", ".");
    gitIn(hereRepo, "commit", "-q", "-m", "first");
    gitIn(join(base, "there"), "clone", "-q", hereRepo, thereRepo);
    gitIn(hereRepo, "remote", "add", "origin", ORIGIN);
    gitIn(thereRepo, "remote", "set-url", "origin", ORIGIN);
    up = await fakeUpstream(brain);
    /** @param {"edit" | "ask"} mode */
    const models = (mode) => (/** @type {any} */ cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1"] }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: mode, roots: [], readerModel: "" };
    };
    // There, its own mode asks before a command runs.
    two = await startTwoMachines({ here: { configure: models("edit") }, there: { configure: models("ask") } });
    registry = /** @type {any} */ (two.here.app).subagents;
    const minted = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" })).json();
    createMachines({ dataDir: two.here.dataDir }).keep({ url: two.remote.url, fingerprint: two.remote.fingerprint, machine: two.remote.machine, device: minted.device, token: minted.token });
    const on = await two.there.api(`/api/remote/devices/${encodeURIComponent(String(minted.device.id))}`, { method: "PATCH", body: { grants: { agents: true } } });
    assert.equal(on.status, 200, await on.clone().text());
    // The person's own chat there, in the clone — a folder there's agents' chats may start in, and /clones looks at.
    const theirs = await two.there.api("/api/sessions", { method: "POST", body: { cwd: thereRepo, model: "m-1" } });
    assert.equal(theirs.status, 200, await theirs.clone().text());
    for (const permissions of ["edit", "auto"]) {
      const made = await two.here.api("/api/sessions", { method: "POST", body: { cwd: hereRepo, model: "m-1", settings: { loop: { permissions } } } });
      assert.equal(made.status, 200, await made.clone().text());
      if (permissions === "edit") chainId = String((await made.json()).id);
      else autoChain = String((await made.json()).id);
    }
  });

  after(async () => {
    for (const go of held.splice(0)) go();
    await two?.stop();
    await up?.close();
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // (fails before: yes — its turn there paused on the ask, and the sub-agent here ended at once, failed: "its turn on
  // Workstation ended paused"; nothing showed here, and nothing could answer it)
  test("its chat's ask there shows here as its own, naming the machine; the person's Allow here runs it there, and its report comes back", async () => {
    const id = await launch("RUN allowed.txt");
    const q = await asked(id);
    assert.match(q.question, /^On Workstation, it asks to run bash: /);
    assert.deepEqual([q.machine, q.kind, q.tool, q.n], ["Workstation", "permission", "bash", 1]);
    assert.match(q.command, /writeFileSync\('allowed\.txt'/);
    assert.equal(registry.get(id).status, "running");
    // This chat lists it as its sub-agent's ask, Allow or Deny; that machine lists its chat's own.
    const [here] = await asksHere();
    assert.deepEqual([here.id, here.kind, here.from, here.options.map((/** @type {any} */ o) => o.id)], [`${id}.1`, "permission", id, ["allow", "deny"]]);
    assert.match(here.question, /On Workstation/);
    const [there] = await asksThere(id);
    assert.deepEqual([there.kind, there.from], ["permission", "chat"]);
    assert.equal(wrote("allowed.txt"), false, "nothing ran before the press");
    const r = await press(id, { answer: "yes", allow: true, ask: q.n });
    assert.equal(r.status, 200, await r.clone().text());
    const sa = await ended(id);
    assert.equal(sa.status, "done", String(registry.detail(id).exchanges.at(-1)?.error));
    assert.equal(wrote("allowed.txt"), true, "it ran there");
    assert.match(String(registry.report(id)), /^REPORT: /);
    assert.deepEqual(await asksThere(id), [], "nothing waits there");
    assert.equal(registry.get(id).progress?.asking ?? null, null);
  });

  // (fails before: yes — the sub-agent ended failed on its pause, and its chat there never heard the person's no)
  test("Deny: nothing runs there, and its chat there reads the person's words; words alone, whatever they say, deny", async () => {
    const id = await launch("RUN denied.txt");
    const q = await asked(id);
    // The person's words with no press of Allow: "yes" is no press.
    const r = await press(id, { answer: "yes, run it — no, use the other folder", ask: q.n });
    assert.equal(r.status, 200, await r.clone().text());
    const sa = await ended(id);
    assert.equal(sa.status, "done", String(registry.detail(id).exchanges.at(-1)?.error));
    assert.equal(wrote("denied.txt"), false, "nothing ran there");
    const report = String(registry.report(id));
    assert.match(report, /^REPORT: Not run/);
    assert.ok(report.includes("use the other folder"), report);
  });

  // (fails before: yes — the follow-up's words went to its chat there as a turn, which answered the pause: "/allow" ran
  // the command with nobody's press)
  test("no lead, no switch of this chat's mode and no message answers it; a follow-up waits on it, and the person's press alone answers it", async () => {
    const id = await launch("RUN guarded.txt");
    const q = await asked(id);
    // A lead's answer (team-tools' `worker` answer reaches the registry so), a switch of this chat's mode.
    const lead = registry.answer(id, chainId, "yes", { by: "lead", allow: true, n: q.n });
    assert.equal(lead.ok, false);
    assert.match(lead.error, /asks on Workstation \(ask 1\): that is the person's to answer, by their press — not its lead's$/);
    const switched = await press(id, { answer: "auto", modeSwitch: true });
    assert.equal(switched.status, 409);
    assert.match((await switched.json()).error, /whose own mode asked it: a switch of this chat's mode answers none/);
    // Words to it while it runs, from its lead or the person, are refused (it takes words as a follow-up).
    assert.equal(registry.message(id, { chainId, text: "/allow", from: "lead" }).ok, false);
    assert.equal(registry.developerMessage(id, { chainId, text: "/allow" }).ok, false);
    assert.ok(registry.get(id).progress?.asking, "it still waits");
    assert.equal((await asksThere(id)).length, 1, "it waits there too");
    // Stopped as it waits: its pause there waits on.
    registry.stop(id);
    await ended(id);
    assert.equal(wrote("guarded.txt"), false);
    assert.equal((await asksThere(id)).length, 1, "its pause there waits on");
    // A follow-up's words would answer that pause there: it is shown to the person first, and their press answers it.
    const again = await followUp(id, "/allow");
    assert.equal(again.ok, true, again.text);
    const shownAgain = await asked(id);
    assert.match(shownAgain.question, /^On Workstation, it asks to run bash: /);
    await quiet(1500);
    assert.equal(wrote("guarded.txt"), false, "the follow-up answered nothing");
    const r = await press(id, { answer: "yes", allow: true, ask: shownAgain.n });
    assert.equal(r.status, 200, await r.clone().text());
    const sa = await ended(id);
    assert.equal(sa.status, "done", String(registry.detail(id).exchanges.at(-1)?.error));
    assert.equal(wrote("guarded.txt"), true, "the person's press ran it");
    // Then the follow-up went, as a message of its own.
    assert.equal(String(registry.report(id)), "REPORT FROM THERE");
    const last = up.received.filter((c) => c.kind === "anthropic").at(-1);
    assert.equal(wordsOf(last?.body?.messages?.at(-1)), "/allow");
  });

  // (fails before: yes — it ended at once, failed, on its pause there: nothing waited for anyone)
  test("in a chat here in Auto mode it is never allowed by itself: unanswered, it waits, there too, until the stop", async () => {
    const id = await launch("RUN waited.txt", autoChain);
    await asked(id);
    await quiet(4000);
    assert.equal(registry.get(id).status, "running");
    assert.ok(registry.get(id).progress?.asking, "it still waits here");
    assert.equal((await asksHere(autoChain)).length, 1);
    assert.equal((await asksThere(id)).length, 1, "it still waits there");
    assert.equal(wrote("waited.txt"), false, "nothing ran");
    assert.deepEqual(registry.stop(id), { ok: true });
    const sa = await ended(id);
    assert.equal(sa.status, "aborted");
    assert.match(String(registry.detail(id).exchanges.at(-1)?.error), /^stopped on Workstation$/);
    assert.equal(registry.get(id).progress?.asking ?? null, null);
    assert.deepEqual(await asksHere(autoChain), []);
    assert.equal(wrote("waited.txt"), false);
  });

  // (fails before: yes — it had ended failed on its pause; the person's answer there resumed a turn nobody here read)
  test("answered by the person there, it is cleared here, and the turn it resumed there is read to its report", async () => {
    const id = await launch("RUN there.txt HOLD");
    await asked(id);
    const [ask] = await asksThere(id);
    const paused = registry.get(id).remote.run;
    assert.equal(ask.id, paused);
    // The person at that machine presses Allow on its own page, which streams the turn it resumes.
    const answering = two.there.api(`/api/sessions/${encodeURIComponent(registry.get(id).remote.chat)}/asks/${encodeURIComponent(ask.id)}/answer`, { method: "POST", body: { allow: true, stream: true, runEvents: true } });
    assert.equal((await answering).status, 200);
    await until(() => !registry.get(id)?.progress?.asking, "its ask here to clear", { timeoutMs: 30_000 });
    await until(() => registry.get(id)?.remote?.run && registry.get(id).remote.run !== paused, "the resumed turn there to be read", { timeoutMs: 30_000 });
    assert.equal(registry.get(id).status, "running");
    await until(() => held.length > 0, "its report there to be held");
    for (const go of held.splice(0)) go();
    const sa = await ended(id);
    assert.equal(sa.status, "done", String(registry.detail(id).exchanges.at(-1)?.error));
    assert.equal(wrote("there.txt"), true);
    assert.match(String(registry.report(id)), /^REPORT: /);
    (await answering).body?.cancel().catch(() => {});
  });

  // (fails before: yes — nothing ran there by the time its asks were read again, and no turn of it ran there to follow:
  // it ended failed, "what it asked on Workstation waits no more there", though the turn there had done its work)
  test("answered by the person there, a turn it resumed that ended before anyone here looked for it is read to its report", async () => {
    const id = await launch("PICK quickly");
    await asked(id);
    // Its asks there are read further apart as it waits: the turn the answer resumes ends between two reads.
    await quiet(3500);
    const [ask] = await asksThere(id);
    // The person at that machine picks on its own page; its reply comes once the turn it resumed has ended.
    const r = await two.there.api(`/api/sessions/${encodeURIComponent(registry.get(id).remote.chat)}/asks/${encodeURIComponent(ask.id)}/answer`, { method: "POST", body: { choice: "1" } });
    assert.equal(r.status, 200, await r.clone().text());
    const sa = await ended(id);
    assert.equal(sa.status, "done", String(registry.detail(id).exchanges.at(-1)?.error));
    assert.match(String(registry.report(id)), /^REPORT: [\s\S]*red/);
  });

  // (fails before: yes — the review of the s-asks hunt's fix: a chat command the person ran there as its question waited
  // was the turn after it, by its request, and that request ran nothing to read: it ended failed, the answer's turn unread)
  test("answered there after a chat command ran there, the turn it resumed is read to its report, never the command's", async () => {
    const id = await launch("PICK after a command");
    await asked(id);
    const chat = registry.get(id).remote.chat;
    const help = await two.there.api(`/api/sessions/${encodeURIComponent(chat)}/turns`, { method: "POST", body: { content: "/help" } });
    assert.equal(help.status, 200, await help.clone().text());
    await help.text();
    const [ask] = await asksThere(id);
    assert.equal(ask?.kind, "question", "the command answered nothing");
    await quiet(3500);
    const r = await two.there.api(`/api/sessions/${encodeURIComponent(chat)}/asks/${encodeURIComponent(ask.id)}/answer`, { method: "POST", body: { choice: "2" } });
    assert.equal(r.status, 200, await r.clone().text());
    const sa = await ended(id);
    assert.equal(sa.status, "done", String(registry.detail(id).exchanges.at(-1)?.error));
    assert.match(String(registry.report(id)), /^REPORT: [\s\S]*blue/);
  });

  // (fails before: yes — the review of the s-asks hunt's fix: a turn the person started there after the answer's turn
  // ended ran there as it was looked for, and was read in its place: its words, never the answer's, were the report)
  test("answered there, the turn it resumed is read to its report though a newer turn runs there by then", async () => {
    const id = await launch("PICK before a newer turn");
    await asked(id);
    const chat = registry.get(id).remote.chat;
    await quiet(3500);
    const [ask] = await asksThere(id);
    const r = await two.there.api(`/api/sessions/${encodeURIComponent(chat)}/asks/${encodeURIComponent(ask.id)}/answer`, { method: "POST", body: { choice: "1" } });
    assert.equal(r.status, 200, await r.clone().text());
    // The person there sends a message of their own at once: its turn runs on while this machine looks.
    const newer = await two.there.api(`/api/sessions/${encodeURIComponent(chat)}/turns`, { method: "POST", body: { content: "STALL", stream: true, runEvents: true } });
    assert.equal(newer.status, 200);
    try {
      const sa = await ended(id);
      assert.equal(sa.status, "done", String(registry.detail(id).exchanges.at(-1)?.error));
      assert.match(String(registry.report(id)), /^REPORT: [\s\S]*red/);
    } finally {
      for (const go of held.splice(0)) go();
      newer.body?.cancel().catch(() => {});
    }
  });

  // (fails before: yes — the card's Allow answered its question "yes" there, and a choice was its words alone: the
  // answer's words went, whatever the choice pressed)
  test("a question it asks there takes no Allow: the press of Allow is refused in words, and a choice answers it by its number", async () => {
    const id = await launch("PICK a shade");
    const q = await asked(id);
    const allow = await press(id, { answer: "yes", allow: true, ask: q.n });
    assert.equal(allow.status, 409);
    assert.match((await allow.json()).error, /asks a question on Workstation \(ask 1\): one of its choices answers it, or the person's words — Allow answers no question$/);
    const none = await press(id, { answer: "anything", choice: "3", ask: q.n });
    assert.equal(none.status, 409);
    assert.match((await none.json()).error, /question \(ask 1\) has choices 1 to 2 — no choice 3$/);
    assert.ok(registry.get(id).progress?.asking, "it still waits");
    assert.equal((await asksThere(id)).length, 1, "it waits there too");
    // The choice is the answer, whatever words ride with it.
    const r = await press(id, { answer: "anything", choice: "2", ask: q.n });
    assert.equal(r.status, 200, await r.clone().text());
    const sa = await ended(id);
    assert.equal(sa.status, "done", String(registry.detail(id).exchanges.at(-1)?.error));
    const report = String(registry.report(id));
    assert.match(report, /^REPORT: [\s\S]*blue/);
    assert.equal(report.includes("anything"), false, report);
  });

  // (fails before: yes — the question paused its turn there, and it ended failed here with nothing shown)
  test("a question it asks there shows here with its choices, and the person's choice answers it", async () => {
    const id = await launch("PICK a colour");
    const q = await asked(id);
    assert.deepEqual([q.kind, q.question, q.options], ["question", "On Workstation, it asks: Which colour?", ["red", "blue"]]);
    const [here] = await asksHere();
    assert.deepEqual([here.id, here.kind, here.options], [`${id}.1`, "question", [{ id: "1", label: "red" }, { id: "2", label: "blue" }]]);
    // The person's choice, on this chat's asks route.
    const r = await two.here.api(`/api/sessions/${encodeURIComponent(chainId)}/asks/${encodeURIComponent(here.id)}/answer`, { method: "POST", body: { choice: "2" } });
    assert.equal(r.status, 200, await r.clone().text());
    const sa = await ended(id);
    assert.equal(sa.status, "done", String(registry.detail(id).exchanges.at(-1)?.error));
    assert.match(String(registry.report(id)), /^REPORT: [\s\S]*blue/);
  });

  // (fails before: yes — the security re-read of 11-11: the ask's command went through the card's one-line helper, so
  // its lines came here run together as one, and the person pressed Allow on a second command they could not tell apart)
  test("a command of several lines it asks to run there shows here line by line, in its ask and in this chat's asks list", async () => {
    const id = await launch("LINES lines.txt");
    const q = await asked(id);
    const command = `echo first\n\tnode -e "require('fs').writeFileSync('lines.txt','1')"`;
    assert.equal(q.command, command);
    assert.doesNotMatch(q.args, /\n/, "its short line stays one line");
    const here = (await asksHere()).find((/** @type {any} */ a) => a.from === id);
    assert.equal(here?.command, command, "the asks list shows it so too");
    const r = await press(id, { answer: "no", ask: q.n });
    assert.equal(r.status, 200, await r.clone().text());
    await ended(id);
    assert.equal(wrote("lines.txt"), false, "nothing ran there");
  });
});

describe("one ask of a sub-agent's chat there shown here at a time", () => {
  // (fails before: yes — the review of the s-asks hunt's fix: the chat's own ask, shown as a call of what runs in its
  // turn there was shown, took that call's place unanswered — its card here never settled and never showed again — and
  // a call let go of as the own ask showed was not shown again as the turn it resumed ran)
  test("its chat's own ask lets go of a call of its turn shown here first; that call shows again once the answer goes", async () => {
    const inRun = (/** @type {string} */ id) => ({ id, from: "sa_9", kind: "permission", tool: "bash", question: "Run it?", options: [], words: true });
    const own = { id: "r1", from: "chat", kind: "question", tool: "ask", question: "Which?", options: [{ id: "a", label: "A" }], words: true };
    /** Where its chat there stands: its run, paused on its own ask, its answer's run. */
    let phase = "run";
    /** @type {any[]} */
    const posted = [];
    /** The asks the person here was shown, in order. @type {string[]} */
    const shown = [];
    /** The one ask the person here is shown, as the registry keeps it: a second takes its place. @type {any} */
    let slot = null;
    const client = {
      state: { system: null },
      post: async (/** @type {string} */ path, /** @type {any} */ body) => (path === "/sessions" ? { id: "chat-1", model: "m-1" } : (posted.push([path, body]), { ok: true })),
      get: async (/** @type {string} */ path) => {
        if (!path.endsWith("/asks")) return { events: [], run: { endedAt: 1, status: "done" } };
        const answered = posted.some(([p]) => p.includes("/asks/x2/"));
        return { asks: phase === "run" ? [inRun("x1")] : phase === "paused" ? [inRun("x2"), own] : answered ? [] : [inRun("x2")] };
      },
      stream: async (/** @type {string} */ path, /** @type {any} */ _b, /** @type {(e: string, d: any) => void} */ onEvent) => {
        const send = (/** @type {string} */ runId, /** @type {any[]} */ events) => events.forEach((e, i) => onEvent("message", { type: "filament_run", event: { runId, n: i + 1, ...e } }));
        if (path.endsWith("/turns")) {
          onEvent("message", { type: "filament_run", event: { runId: "r1", n: 1, type: "round-start", round: 1 } });
          onEvent("message", { type: "filament_run", event: { runId: "r1", n: 2, type: "subagent-ask" } });
          await until(() => shown.includes("x1"), "the call of its run shown here");
          phase = "paused";
          onEvent("message", { type: "filament_run", event: { runId: "r1", n: 3, type: "run-end", status: "paused", summary: {} } });
          return;
        }
        // The answer to its own ask: the turn it resumes waits on its sub-agent's call there.
        phase = "resumed";
        await until(() => posted.some(([p]) => p.includes("/asks/x2/")), "the call answered", { timeoutMs: 5000 });
        send("r2", [{ type: "round-start", round: 1 }, { type: "round-text", round: 1, text: "DONE" }, { type: "run-end", status: "done", summary: {} }]);
      },
    };
    const m = { machine: { id: "m1" }, name: "Box", device: { scope: "agent" } };
    const machines = /** @type {any} */ ({ list: () => [m], find: () => m, clientOf: async () => client });
    const remote = { machine: { id: "m1", name: "Box" }, cwd: "/w", chat: null, model: null, effort: null };
    const onAsk = (/** @type {any} */ ask, /** @type {AbortSignal} */ signal) =>
      new Promise((resolve) => {
        shown.push(ask.id);
        const s = { ask, resolve };
        slot = s;
        signal.addEventListener("abort", () => {
          if (slot === s) slot = null;
          resolve(null);
        }, { once: true });
      });
    const r = createRemoteAgents({ machines, wait: () => new Promise((go) => setTimeout(go, 5)) });
    const turn = r.turn(/** @type {any} */ (remote), { content: [{ type: "text", text: "Go." }], signal: new AbortController().signal, onAsk });
    turn.catch(() => {});
    const ownShown = await until(() => (slot?.ask.id === "r1" ? slot : null), "its own ask shown here");
    ownShown.resolve({ choice: "a" });
    const again = await until(() => (slot?.ask.id === "x2" ? slot : null), "the call let go of shown again");
    again.resolve({ allow: true });
    const fin = await turn;
    assert.deepEqual([fin.status, fin.report], ["done", "DONE"], String(fin.error));
    assert.deepEqual(shown.slice(-2), ["r1", "x2"]);
    assert.deepEqual(posted.filter(([p]) => p.includes("/asks/")), [["/sessions/chat-1/asks/x2/answer", { allow: true }]]);
  });
});

describe("a question there that takes its choices alone", () => {
  // (fails before: yes — the review of the s-asks hunt's fix: that machine's ask that takes no words lost its `words`
  // here: Other… was offered, and the person's words went there to be refused)
  test("it shows as one, and the person's words are refused here in words; its choice answers it", async () => {
    const plan = { id: "p1", from: "coding-agent", kind: "plan", tool: "Codex", question: "Go on with the plan?", options: [{ id: "accepted", label: "Yes" }, { id: "rejected", label: "No" }], words: false };
    const asked = remoteAsked("Box", /** @type {any} */ (plan));
    assert.deepEqual([asked.kind, asked.options, asked.words], ["question", ["Yes", "No"], false]);
    assert.equal("words" in remoteAsked("Box", /** @type {any} */ ({ ...plan, words: true })), false, "one words answer says nothing more");
    const w = watched();
    const l = leadOf(w.registry, w.dir);
    const { id } = await running(w, l);
    const answer = w.registry.ask(id, asked, { signal: new AbortController().signal });
    const n = w.registry.get(id)?.progress?.asking?.n;
    const words = w.registry.answer(id, "c1", "yes, but keep the old names", { n });
    assert.equal(words.ok, false);
    assert.match(words.error, /question \(ask 1\) takes one of its choices alone, 1 to 2: words answer it not$/);
    assert.ok(w.registry.get(id)?.progress?.asking, "it still waits");
    assert.deepEqual(w.registry.answer(id, "c1", "Yes", { n, choice: "1" }).ok, true);
    assert.deepEqual(await answer, { text: "Yes", modeSwitch: false, choice: "1" });
    l.door.close();
  });
});
