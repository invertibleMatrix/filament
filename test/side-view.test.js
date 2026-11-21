// @ts-check
// HarnessV4_Tasks E13-1, through the app: what a side agent sees. A sub-agent the developer launches beside a session
// can be shown the turn running now, rebuilt from that turn's run log (BW-6) — in a session Filament's own loop runs and
// in one a coding agent runs over the ACP bridge — and a change as a patch (BW-5). A later message to it carries what
// happened since its last look, once (BW-7). The three starts (BW-4) fill a launch's fields, on the launch route and
// on `/subagent start=`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";
import { until } from "./helpers/wait.js";
import { parseSubagentCommand } from "../src/app/commands/parse.js";

const FAKE_ACP = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");
const CHILD = "You are a sub-agent run by Filament";
const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));
/** The text blocks of a message, one by one. @param {any} m */
const blocksOf = (m) => (Array.isArray(m?.content) ? m.content : []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text));
/** The calls a request's newest message answers. @param {any} c */
const answersTo = (c) => (Array.isArray(c.body?.messages?.at(-1)?.content) ? c.body.messages.at(-1).content : []).filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id);
const isChild = (/** @type {any} */ c) => JSON.stringify(c.body?.system ?? "").includes(CHILD);
const deferred = () => {
  /** @type {(v?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

/** @type {string} */ let folder;
/** @type {string} */ let stepGate;
/** @type {any} */ let up;
/** @type {any} */ let shim;
/** The main agent's second round ("work then hold") answers once the test lets it: a turn that runs while the test acts. */
let gate = deferred();
let reports = 0;

before(async () => {
  folder = mkdtempSync(join(tmpdir(), "filament-side-"));
  stepGate = join(folder, "..", `filament-side-gate-${process.pid}`);
  writeFileSync(join(folder, "notes.txt"), "hello side\n");
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: folder, stdio: "ignore" });
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "add", "notes.txt");
  git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "notes");
  up = await fakeUpstream(async (call) => {
    const messages = call.body?.messages || [];
    const lastText = textOf(messages.at(-1));
    const blocks = (/** @type {any[]} */ b, stop = "end_turn") => anthropicReply("", { model: call.body?.model || "m-1", stop, blocks: b, usage: { input_tokens: 5, output_tokens: 3 } });
    if (isChild(call)) return blocks([{ type: "text", text: `SIDE REPORT ${++reports}` }]);
    if (answersTo(call).includes("toolu_r1")) {
      await gate.promise;
      return blocks([{ type: "text", text: "MAIN DONE" }]);
    }
    if (answersTo(call).includes("toolu_w1")) return blocks([{ type: "text", text: "WROTE IT" }]);
    if (/work then hold/.test(lastText)) return blocks([{ type: "text", text: "Looking at the notes." }, toolUse("toolu_r1", "read", { path: "notes.txt" })], "tool_use");
    if (/write the file/.test(lastText)) return blocks([toolUse("toolu_w1", "write", { path: "made.txt", content: "made by the main agent\n" })], "tool_use");
    return blocks([{ type: "text", text: `ANSWER TO ${lastText}` }]);
  });
  shim = await startApp({
    memory: true,
    keep: true,
    configure: (cfg) => {
      cfg.upstreams = [
        { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
        { id: "plainacp", name: "plainacp", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP], env: { FAKE_ACP_STEP_GATE: stepGate }, cwdDefault: folder, permissions: "allow-all", hints: false } },
      ];
      cfg.routes = [
        { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
        { match: "plainacp/*", upstream: "plainacp", upstreamModel: "{1}", enabled: true },
      ];
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
      cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
    },
  });
});
after(async () => {
  gate.resolve();
  writeFileSync(stepGate, "");
  await shim.stop();
  await up.close();
  for (const dir of [shim.dataDir, folder, stepGate]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

const at = (/** @type {string} */ id, rest = "") => `/api/sessions/${encodeURIComponent(id)}${rest}`;
const newSession = async (model = "m-1") => {
  const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model, preset: "plain" } });
  assert.equal(s.status, 200, await s.clone().text());
  return String((await s.json()).id);
};
/** A turn sent and ended; its answer's text. @param {string} id @param {string} content */
const turnDone = async (id, content) => {
  const t = await shim.api(at(id, "/turns"), { method: "POST", body: { content, stream: false } });
  assert.equal(t.status, 200, await t.clone().text());
  return t.text();
};
/** @param {string} id @returns {Promise<any>} */
const sizesOf = async (id) => (await shim.api(at(id, "/subagents/views"))).json();
/** A launch through the route; the sub-agent once it has reported, whole. @param {string} id @param {any} body */
const launched = async (id, body) => {
  const r = await shim.api(at(id, "/subagents"), { method: "POST", body: { worker: "reviewer", deliver: false, ...body } });
  assert.equal(r.status, 200, await r.clone().text());
  return ended(id, (await r.json()).subagent.id);
};
/** A sub-agent once it is no longer running, whole (the viewer's form). @param {string} id @param {string} sid @returns {Promise<any>} */
const ended = (id, sid) =>
  until(async () => {
    const { subagent } = await (await shim.api(at(id, `/subagents/${sid}`))).json();
    return subagent && subagent.status !== "running" ? subagent : null;
  }, `sub-agent ${sid} to report`);
/** A follow-up through the route; the sub-agent once it has reported again. @param {string} id @param {string} sid @param {string} prompt */
const followedUp = async (id, sid, prompt) => {
  const r = await shim.api(at(id, `/subagents/${sid}/follow-up`), { method: "POST", body: { prompt } });
  assert.equal(r.status, 200, await r.clone().text());
  return ended(id, sid);
};
/** The side agents' own requests since `mark`, oldest first. @param {number} mark */
const sideCalls = (mark) => up.received.slice(mark).filter(isChild);

test("a side agent launched while a turn runs is shown that turn: its message, its words, its calls, the newest round whole", async () => {
  gate = deferred();
  const id = await newSession();
  const mark = up.received.length;
  const turn = shim.api(at(id, "/turns"), { method: "POST", body: { content: "work then hold", stream: false } });
  /** @type {any} */
  let sa;
  try {
    await until(() => up.received.slice(mark).some((/** @type {any} */ c) => !isChild(c) && answersTo(c).includes("toolu_r1")), "the turn's second round to be in flight");
    // (fails before: the sizes said nothing of a running turn, and a view held finished turns only)
    const sizes = await sizesOf(id);
    assert.deepEqual([sizes.running?.rounds, sizes.running?.calls, sizes.running?.tokens > 0], [1, 1, true], JSON.stringify(sizes.running));
    assert.equal(sizes.tokens.folded, 0, "no turn has finished yet");
    assert.deepEqual(sizes.starts.map((/** @type {any} */ s) => [s.id, s.name]), [["ask", "Ask"], ["job", "Try it in a copy"], ["review", "Review my last change"], ["catchup", "Catch me up"]]);
    sa = await launched(id, { prompt: "what is it doing?", view: "folded", running: true });
    const opening = blocksOf(sideCalls(mark)[0].body.messages[0]);
    assert.equal(opening.length, 2, JSON.stringify(opening));
    assert.match(opening[0], /^<running-turn rounds="1" calls="1">\nThe turn the main agent is working on now/);
    for (const words of ["User: work then hold", "Assistant: Looking at the notes.", 'Tool call read: {"input":"notes.txt"}', "hello side"]) assert.ok(opening[0].includes(words), `${words} — in:\n${opening[0]}`);
    assert.ok(opening[0].endsWith("</running-turn>"));
    assert.equal(opening[1], "what is it doing?", "the task comes last, whole");
    assert.deepEqual(sa.opening.map((/** @type {any} */ b) => [b.kind, b.count]), [["running", 1]], "the viewer sees what it was handed");
    assert.deepEqual([sa.running, sa.changes, sa.start, sa.aside], [true, null, null, true]);
    // Asked again at once: the turn has not moved, so nothing of it is said twice.
    sa = await followedUp(id, sa.id, "and now?");
    assert.deepEqual(blocksOf(sideCalls(mark).at(-1).body.messages.at(-1)), ["and now?"]);
    assert.equal(sa.exchanges[1].caughtUp, undefined);
  } finally {
    gate.resolve();
  }
  assert.match(await (await turn).text(), /MAIN DONE/);
  // The turn has ended since its last look: the next message carries it, as a finished turn.
  sa = await followedUp(id, sa.id, "and at the end?");
  const last = blocksOf(sideCalls(mark).at(-1).body.messages.at(-1));
  assert.equal(last.length, 2, JSON.stringify(last));
  assert.match(last[0], /^<since-your-last-look turns="1">\nWhat happened in the session since you last looked/);
  assert.ok(last[0].includes("User: work then hold") && last[0].includes("MAIN DONE") && last[0].endsWith("</since-your-last-look>"), last[0]);
  assert.equal(last[1], "and at the end?");
  assert.deepEqual([sa.exchanges[2].caughtUp.turns, sa.exchanges[2].caughtUp.rounds, sa.exchanges[2].caughtUp.tokens > 0], [1, 0, true]);
});

test("with no turn running there is no running turn to show, and nothing is said of one", async () => {
  const id = await newSession();
  await turnDone(id, "first question");
  const mark = up.received.length;
  const sizes = await sizesOf(id);
  assert.equal(sizes.running, null);
  assert.ok(sizes.tokens.folded > 0);
  const sa = await launched(id, { prompt: "look around", view: "folded", running: true });
  assert.deepEqual(sa.opening.map((/** @type {any} */ b) => [b.kind, b.count]), [["view", 1]]);
  const opening = blocksOf(sideCalls(mark)[0].body.messages[0]);
  assert.equal(opening.length, 2);
  assert.match(opening[0], /^<conversation view="folded" turns="1">/);
  assert.ok(!JSON.stringify(opening).includes("running-turn"));
});

test("a follow-up carries the turns finished since the side agent last looked, once; one that sees nothing is told nothing", async () => {
  const id = await newSession();
  await turnDone(id, "first question");
  const mark = up.received.length;
  let sa = await launched(id, { prompt: "keep an eye on it", view: "folded" });
  await turnDone(id, "second question");
  await turnDone(id, "third question");
  sa = await followedUp(id, sa.id, "what happened?");
  // (fails before: a follow-up went on in the context its sub-agent started with, and knew nothing of the two turns)
  const last = blocksOf(sideCalls(mark).at(-1).body.messages.at(-1));
  assert.equal(last.length, 2, JSON.stringify(last));
  assert.match(last[0], /^<since-your-last-look turns="2">\n/);
  for (const words of ["User: second question", "Assistant: ANSWER TO second question", "User: third question", "Assistant: ANSWER TO third question"]) assert.ok(last[0].includes(words), `${words} — in:\n${last[0]}`);
  assert.ok(!last[0].includes("first question"), "the turn it was launched with is not said again");
  assert.equal(last[1], "what happened?");
  assert.deepEqual([sa.exchanges[1].caughtUp.turns, sa.exchanges[1].caughtUp.rounds, sa.exchanges[1].caughtUp.tokens > 0], [2, 0, true]);
  sa = await followedUp(id, sa.id, "and again?");
  assert.deepEqual(blocksOf(sideCalls(mark).at(-1).body.messages.at(-1)), ["and again?"], "nothing twice");
  assert.equal(sa.exchanges[2].caughtUp, undefined);
  // One launched to see nothing of the session stays so.
  let blind = await launched(id, { prompt: "work alone", view: "none" });
  await turnDone(id, "fourth question");
  blind = await followedUp(id, blind.id, "still alone?");
  assert.deepEqual(blocksOf(sideCalls(mark).at(-1).body.messages.at(-1)), ["still alone?"]);
  assert.equal(blind.exchanges[1].caughtUp, undefined);
});

// (fails before: yes — HarnessV4_Tasks E15 step 5 (BW-16, AG-130): `/btw` was no command; a model read it as a message)
test("/btw <question> is the Ask start by its shorter name: the Reviewer reads, the command answers, nothing goes to the session's agent; with no words it says what to type", async () => {
  const btw = /** @type {any} */ (parseSubagentCommand("/btw  why is the cache cold?\nit was warm a minute ago"));
  assert.deepEqual([btw.action, btw.start, btw.prompt, btw.command, btw.raw, btw.wait, btw.as], ["launch", "ask", "why is the cache cold?\nit was warm a minute ago", "/btw", "/btw  why is the cache cold?", null, null]);
  assert.deepEqual([/** @type {any} */ (parseSubagentCommand("/BTW x")).prompt, parseSubagentCommand("/btween us"), parseSubagentCommand("say /btw x")], ["x", null, null], "the word alone, at the start");
  const bare = /** @type {any} */ (parseSubagentCommand("/btw"));
  assert.deepEqual([bare.action, bare.command], ["unknown", "/btw"]);

  const id = await newSession();
  await turnDone(id, "first question");
  const said = await turnDone(id, "/btw what did it do?");
  assert.match(said, /SIDE REPORT \d+/, "the command waited and answered with the answer");
  const list = await (await shim.api(at(id, "/subagents"))).json();
  const [sa] = list.subagents;
  assert.deepEqual([sa.origin, sa.start, sa.card.tag, sa.may, sa.aside, sa.exchanges[0].prompt, sa.exchanges[0].delivery, list.queued], ["command", "ask", "reviewer", "read", true, "what did it do?", "held", 0]);
  const none = await turnDone(id, "/btw");
  assert.match(none, /`\/btw` needs your question after it: `\/btw <question>`\./);
  assert.doesNotMatch(none, /I did not understand/);
  assert.equal((await (await shim.api(at(id, "/subagents"))).json()).subagents.length, 1, "nothing launched");
});

test("a start fills the launch's fields, on the route and on /subagent start=; what the launch names wins; an unknown start is refused", async () => {
  const id = await newSession();
  await turnDone(id, "first question");
  const mark = up.received.length;
  // Ask, typed as a command: read only, the session folded, and the answer stays with the developer — here.
  const said = await turnDone(id, "/subagent start=ask what did it do?");
  assert.match(said, /SIDE REPORT \d+/, "the command waited and answered with the report");
  const { subagents } = await (await shim.api(at(id, "/subagents"))).json();
  assert.deepEqual([subagents[0].origin, subagents[0].start, subagents[0].view, subagents[0].card.tag, subagents[0].may, subagents[0].running, subagents[0].aside, subagents[0].exchanges[0].delivery], ["command", "ask", "folded", "reviewer", "read", true, true, "held"]);
  assert.match(blocksOf(sideCalls(mark)[0].body.messages[0])[0], /^<conversation view="folded" turns="1">/);
  assert.match(await turnDone(id, "/subagent start=watch keep looking"), /start must be one of ask, job, review/);
  // Review, on the route: what the last turn changed rides as a patch — or, where that turn recorded none, its words —
  // and nothing of the conversation.
  const review = await launched(id, { prompt: "did it do it?", start: "review", worker: undefined, deliver: undefined });
  assert.deepEqual([review.start, review.view, review.card.tag, review.may, review.running, review.changes, review.aside], ["review", "none", "reviewer", "read", false, "turn", true]);
  assert.deepEqual(review.opening.map((/** @type {any} */ b) => b.kind), ["changes"]);
  assert.match(review.opening[0].text, /^<changes source="turn" files="0">\nturn 1 recorded no change \(it wrote nothing, or snapshots are off\): there is no patch to show\./);
  // A field the launch names wins over the start's.
  const wide = await launched(id, { prompt: "read it all", start: "ask", view: "window", worker: undefined });
  assert.deepEqual([wide.start, wide.view, wide.card.tag, wide.may], ["ask", "window", "reviewer", "read"]);
  const bad = await shim.api(at(id, "/subagents"), { method: "POST", body: { prompt: "x", start: "watch" } });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /start must be one of ask, job, review/);
  const worse = await shim.api(at(id, "/subagents"), { method: "POST", body: { prompt: "x", changes: "everything" } });
  assert.equal(worse.status, 400);
  assert.match((await worse.json()).error, /changes must be one of running, turn, uncommitted, or since:<a commit, tag or branch>/);
});

// (fails before: yes — Hunter's of 10-31: `/subagent start=` passed a start's `changes` and `running` only where they
// were set, and the route its `changes` only where it was a string, so a start's "none" and "no" fell to the card's own)
test("a start's own no — no change, no running turn — holds on the route and on /subagent start=, whatever its card's Sees say", async () => {
  /** @param {string} tag @param {any} sees */
  const seeing = async (tag, sees) => assert.equal((await shim.api(`/api/agents/${tag}`, { method: "PUT", body: { sees } })).status, 200);
  await seeing("builder", { view: "none", running: true, changes: "turn" });
  await seeing("reviewer", { view: "none", running: true, changes: "turn" });
  try {
    const id = await newSession();
    await turnDone(id, "first question");
    // Ask sees the session folded and the turn running now, and no change.
    const asked = await launched(id, { prompt: "what did it do?", start: "ask", worker: undefined, deliver: undefined });
    assert.deepEqual([asked.start, asked.view, asked.running, asked.changes], ["ask", "folded", true, null], "on the route");
    assert.match(await turnDone(id, "/subagent start=ask what did it do?"), /SIDE REPORT \d+/);
    // Review sees the last turn's change alone: no running turn.
    assert.match(await turnDone(id, "/subagent start=review did it do it?"), /SIDE REPORT \d+/);
    const { subagents } = await (await shim.api(at(id, "/subagents"))).json();
    const typed = subagents.filter((/** @type {any} */ s) => s.origin === "command").map((/** @type {any} */ s) => [s.start, s.view, s.running, s.changes]);
    assert.deepEqual(typed.sort(), [["ask", "folded", true, null], ["review", "none", false, "turn"]], "on /subagent start=");
  } finally {
    await seeing("builder", { view: "none", running: false, changes: null });
    await seeing("reviewer", { view: "none", running: false, changes: null });
  }
});

// The door a page asks through while a turn runs is the launch route: the session's own send takes no message then,
// a command among them (409, as for any message; `/btw` and the Side tab's composer are E13-2 and E13-3).
test("Ask, started on the route while a turn runs: the side agent is shown the running turn, its answer stays aside, and the turn goes on", async () => {
  gate = deferred();
  const id = await newSession();
  const mark = up.received.length;
  const turn = shim.api(at(id, "/turns"), { method: "POST", body: { content: "work then hold", stream: false } });
  try {
    await until(() => up.received.slice(mark).some((/** @type {any} */ c) => !isChild(c) && answersTo(c).includes("toolu_r1")), "the turn's second round to be in flight");
    const sa = await launched(id, { prompt: "what is it doing?", start: "ask", worker: undefined, deliver: undefined });
    assert.deepEqual([sa.start, sa.view, sa.card.tag, sa.may, sa.running, sa.aside, sa.exchanges[0].delivery], ["ask", "folded", "reviewer", "read", true, true, "held"]);
    assert.match(sa.exchanges[0].report, /SIDE REPORT \d+/);
    const opening = blocksOf(sideCalls(mark)[0].body.messages[0]);
    assert.match(opening[0], /^<running-turn rounds="1" calls="1">/, JSON.stringify(opening).slice(0, 400));
    assert.ok(opening[0].includes("User: work then hold"));
    assert.equal(opening.at(-1), "what is it doing?");
    assert.equal((await (await shim.api(at(id, "/subagents"))).json()).queued, 0, "nothing went to the main agent");
  } finally {
    gate.resolve();
  }
  assert.match(await (await turn).text(), /MAIN DONE/, "the main agent's turn went on to its end");
  assert.ok(!up.received.slice(mark).some((/** @type {any} */ c) => !isChild(c) && JSON.stringify(c.body.messages).includes("SIDE REPORT")), "and never read the side agent's report");
});

test("a coding agent's running turn is shown the same way: from its run log, to a side agent on another model", async () => {
  const id = await newSession("plainacp/auto");
  const mark = up.received.length;
  const turn = shim.api(at(id, "/turns"), { method: "POST", body: { content: "~steps", stream: false } });
  try {
    await until(async () => ((await sizesOf(id)).running?.calls >= 1 ? true : null), "the agent's first step to be running");
    const sa = await launched(id, { prompt: "what is the agent doing?", model: "m-1", view: "folded", running: true });
    assert.deepEqual([sa.model, sa.engine], ["m-1", "loop"]);
    const opening = blocksOf(sideCalls(mark)[0].body.messages[0]);
    assert.match(opening[0], /^<running-turn rounds="\d+" calls="1">\n/);
    for (const words of ["User: ~steps", "step 1", "(still running when Filament read the turn's log.)"]) assert.ok(opening[0].includes(words), `${words} — in:\n${opening[0]}`);
  } finally {
    writeFileSync(stepGate, "");
  }
  assert.equal((await turn).status, 200);
});

// (fails before: yes — the owner's words of 10-19: "why don't you have a slice of current context window … since the
// last compaction to the last round even in a running turn")
test("the context window: Filament's loop's request as it stands — its finished turns, this turn's message, words and calls, a result whole — in one block", async () => {
  gate = deferred();
  const id = await newSession();
  await turnDone(id, "first question");
  const mark = up.received.length;
  const turn = shim.api(at(id, "/turns"), { method: "POST", body: { content: "work then hold", stream: false } });
  try {
    await until(() => up.received.slice(mark).some((/** @type {any} */ c) => !isChild(c) && answersTo(c).includes("toolu_r1")), "the turn's second round to be in flight");
    const sizes = await sizesOf(id);
    assert.ok(sizes.tokens.window > sizes.tokens.folded, JSON.stringify(sizes.tokens));
    const sa = await launched(id, { prompt: "what does it hold?", view: "window", running: true });
    assert.deepEqual([sa.view, sa.opening.map((/** @type {any} */ b) => [b.kind, b.count])], ["window", [["view", 1]]], "the running turn is in the window, not beside it");
    const opening = blocksOf(sideCalls(mark)[0].body.messages[0]);
    assert.equal(opening.length, 2, JSON.stringify(opening));
    assert.match(opening[0], /^<conversation view="window" turns="1">\nThe main agent's context window as it stands: .+ The turn goes on while you work\. Background only — your task follows\.\n\n/);
    // The call as it was sent — its own input, not the run log's target.
    for (const words of ["User: first question", "Assistant: ANSWER TO first question", "User: work then hold", "Assistant: Looking at the notes.", 'Tool call read: {"path":"notes.txt"}', "hello side"]) assert.ok(opening[0].includes(words), `${words} — in:\n${opening[0]}`);
    assert.ok(opening[0].indexOf("first question") < opening[0].indexOf("work then hold"), "in the order the request holds them");
    assert.ok(opening[0].endsWith("</conversation>") && !opening[0].includes("running-turn"));
    assert.equal(opening[1], "what does it hold?");
  } finally {
    gate.resolve();
  }
  assert.match(await (await turn).text(), /MAIN DONE/);
});

test("a coding agent's context window is rebuilt: its finished turns as they were sent, then its running turn from the run's log", async () => {
  // Its first step holds until the gate stands again.
  rmSync(stepGate, { force: true });
  const id = await newSession("plainacp/auto");
  const mark = up.received.length;
  const turn = shim.api(at(id, "/turns"), { method: "POST", body: { content: "~steps", stream: false } });
  try {
    await until(async () => ((await sizesOf(id)).running?.calls >= 1 ? true : null), "the agent's first step to be running");
    const sa = await launched(id, { prompt: "what does the agent hold?", model: "m-1", view: "window" });
    const opening = blocksOf(sideCalls(mark)[0].body.messages[0]);
    assert.match(opening[0], /^<conversation view="window" turns="0">\nThe main agent's context window as Filament rebuilds it: /);
    for (const words of ["[Filament: the turn running now, as its run's log stands — a call by its target, a result by its first lines:]", "User: ~steps", "step 1"]) assert.ok(opening[0].includes(words), `${words} — in:\n${opening[0]}`);
    assert.deepEqual(sa.opening.map((/** @type {any} */ b) => b.kind), ["view"]);
  } finally {
    writeFileSync(stepGate, "");
  }
  assert.equal((await turn).status, 200);
});

test("a change rides as a patch: everything uncommitted in the session's folder, or the last turn's", async () => {
  const id = await newSession();
  await turnDone(id, "write the file");
  const mark = up.received.length;
  const sizes = await sizesOf(id);
  assert.deepEqual([sizes.changes.uncommitted.files, sizes.changes.uncommitted.tokens > 0], [1, true], JSON.stringify(sizes.changes));
  const sa = await launched(id, { prompt: "read the change", view: "none", changes: "uncommitted" });
  assert.deepEqual(sa.opening.map((/** @type {any} */ b) => [b.kind, b.count]), [["changes", 1]]);
  const opening = blocksOf(sideCalls(mark)[0].body.messages[0]);
  assert.match(opening[0], /^<changes source="uncommitted" files="1">\nEverything uncommitted in the session's folder, as a patch/);
  assert.ok(opening[0].includes("+++ b/made.txt") && opening[0].includes("+made by the main agent") && opening[0].endsWith("</changes>"), opening[0]);
  assert.equal(opening[1], "read the change");
});
