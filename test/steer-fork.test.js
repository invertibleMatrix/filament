// @ts-check
// The forked steer (the owner's of 11-04: "what if steer an agent and at that point the conversation is simply forked
// behind the scene and with this cache is warm … if it is a task that needs to be created mid way the forked session
// simply creates a tasks … and then makes an envelope for main agent which will be opened by main agent at natural
// checkpoints"): a note the person types into the loop's running turn is held out of the loop's mailbox while a fork of
// the turn weighs it (services/runs.js), which the turn starts read-only on its own conversation (steer-fork.js,
// subagents.js `weighs`); a correction goes in as any note, a question is answered for the person, more work becomes
// tasks proposed on the graph (core/task-graph.js `proposed`) and a letter the agent opens when it chooses. The loop does
// not end its turn while a note is weighed (loop.js), and the page says what came of each (lib/labels.js).
// (fails before: yes — the owner's of 11-04: every note went straight into the loop; nothing weighed one aside)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "../src/services/events.js";
import { createRunLog } from "../src/services/runs.js";
import { letterText, readVerdict, weighAside } from "../src/app/agent/steer-fork.js";
import * as steerFork from "../src/app/agent/steer-fork.js";
import * as toolsModule from "../src/app/agent/tools.js";
import { STEER_FORK_NOTE, createSubagentRegistry } from "../src/app/agent/subagents.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { applyPlan, applyTasks, graphView, helperTook, proposeTasks, sideBySide } from "../src/core/task-graph.js";
import { alignEvents, envelopeFrom, envelopeOpenedWords, steerWords } from "../src/ui/harness/lib/labels.js";
import { KNOBS } from "../src/services/session-settings.js";
import { until } from "./helpers/wait.js";

const root = tmpdir();
/** Every step queued so far, and the microtasks they queue, run. */
const settle = () => new Promise((r) => setImmediate(r));
const deferred = () => {
  /** @type {(v?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

/** A running agent turn's run log and mailbox, and what its run said, in order. */
function runOf() {
  const dir = mkdtempSync(join(tmpdir(), "filament-steer-fork-"));
  const runs = createRunLog({ events: createEventBus(), dataDir: dir, config: () => ({ observability: { runEvents: { persist: false } } }), ops: { record: () => {} } });
  runs.startRun({ id: "t-1", kind: "agent-turn", meta: { steerImages: true } });
  const mb = runs.mailbox("t-1");
  /** @type {any[]} */
  const said = [];
  runs.subscribe("t-1", (e) => said.push(e));
  /** The person's note. @param {string} text @param {Record<string, any>} [o] */
  const say = (text, o = {}) => {
    const r = runs.steer("t-1", { kind: "note", text, from: "harness", ...o });
    assert.equal(r.ok, true, JSON.stringify(r));
    return /** @type {any} */ (r).message;
  };
  /** What the run said of a note's fork, in order. @param {string} id */
  const asides = (id) => said.filter((e) => e.type === "steer-aside" && e.id === id);
  const done = () => {
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { runs, mb, said, say, asides, done };
}

test("a note held aside: no read of the loop's takes it, nothing waiting for a message wakes, until its fork passes it", async () => {
  const r = runOf();
  /** @type {any[]} */
  const held = [];
  r.mb.aside({ take: (m) => (held.push(m), true), changed: () => {} });
  const m = r.say("use yarn, not npm");
  assert.equal(r.said.find((e) => e.type === "steer")?.aside, true, "the page is told it is weighed aside");
  assert.deepEqual([r.mb.read().length, r.mb.size(), r.mb.peek(() => true), r.mb.list(() => true).length], [0, 0, null, 0]);
  let woke = false;
  void r.mb.next().then(() => (woke = true));
  const weighed = r.mb.weighed();
  assert.ok(weighed, "the turn has a note to wait for");
  let over = false;
  void weighed?.then(() => (over = true));
  await settle();
  assert.deepEqual([woke, over], [false, false]);
  assert.equal(r.mb.weighs(held[0], { as: "weighing", agent: "sa_1" }), true);
  await settle();
  assert.deepEqual([woke, over], [false, false], "said on the run, still held");
  assert.equal(r.mb.pass(held[0], { as: "correction", agent: "sa_1" }), true);
  await settle();
  assert.deepEqual([woke, over], [true, true]);
  assert.deepEqual(r.asides(m.id).map((e) => [e.as, e.agent]), [["weighing", "sa_1"], ["correction", "sa_1"]]);
  assert.deepEqual(r.mb.read().map((x) => x.text), ["use yarn, not npm"], "a correction is read as any note");
  assert.equal(r.mb.weighed(), null);
  r.done();
});

test("a note its fork settles leaves the queue unread by the loop, and wakes no wait for a message", async () => {
  const r = runOf();
  /** @type {any[]} */
  const held = [];
  r.mb.aside({ take: (m) => (held.push(m), true), changed: () => {} });
  const m = r.say("why is the cache keyed by path?");
  let woke = false;
  void r.mb.next().then(() => (woke = true));
  const waited = r.mb.wait(60_000);
  assert.equal(r.mb.settle(held[0], { as: "question", agent: "sa_1", answer: "Paths are stable across runs." }), true);
  await settle();
  assert.equal(woke, false, "nothing is there to read");
  assert.deepEqual([r.mb.read().length, r.mb.weighed()], [0, null]);
  assert.equal(r.asides(m.id).at(-1)?.answer, "Paths are stable across runs.");
  assert.equal(r.mb.pass(held[0], { as: "correction" }), false, "it is gone");
  r.say("a stop", { kind: "stop", text: "" });
  assert.deepEqual((await waited).map((x) => x.kind), ["stop"], "a wait still wakes on what can be read");
  r.done();
});

test("a wait for a message is released by the run's end and its Force stop, never by a note held aside", async () => {
  for (const end of ["end", "force"]) {
    const r = runOf();
    r.mb.aside({ take: () => true, changed: () => {} });
    const t0 = Date.now();
    const waited = r.mb.wait(10_000);
    let next = false;
    void r.mb.next().then(() => (next = true));
    r.say("held");
    await settle();
    assert.equal(next, false, "a held note wakes neither");
    if (end === "end") r.runs.endRun("t-1", { status: "done" });
    else assert.equal(r.runs.force("t-1", { from: "harness" }).ok, true);
    assert.deepEqual((await waited).map((m) => m.kind), end === "end" ? [] : ["stop"], `${end}: the held note is not read`);
    await settle();
    assert.ok(Date.now() - t0 < 1000, `${end}: at once, not at the wait's time`);
    assert.equal(next, true, `${end}: the loop's wait for a message ends too`);
    r.done();
  }
});

test("only a note the person typed is weighed: a veto, a stop, a picture, a lead's note go straight in", () => {
  const r = runOf();
  /** @type {string[]} */
  const asked = [];
  r.mb.aside({ take: (m) => (asked.push(m.text), true), changed: () => {} });
  r.say("veto this", { kind: "veto" });
  r.say("see this", { images: [{ name: "a.png", mediaType: "image/png", data: "aGk=" }] });
  r.say("from the lead", { from: "lead" });
  // (fails before: yes — the review of 11-04: the steer route told the agent to use the agents a note named, or that it
  // overruled their answers, while the note itself was weighed aside and could be answered for the person alone)
  r.say("ask @reviewer about it", { straight: "it names agents for the agent to use" });
  r.say("", { kind: "stop" });
  assert.deepEqual(asked, []);
  assert.equal(r.mb.read((x) => x.kind !== "stop").length, 4);
  r.done();
});

test("Delete and Edit reach the fork; the run's end marks a note still held unread", async () => {
  const r = runOf();
  /** @type {[string, string][]} */
  const changed = [];
  r.mb.aside({ take: () => true, changed: (m, how) => void changed.push([m.text, how]) });
  const a = r.say("first words");
  const b = r.say("second");
  assert.equal(r.runs.editSteer("t-1", a.id, { text: "new words" }).ok, true);
  const w = r.mb.weighed();
  assert.equal(r.runs.dropSteer("t-1", b.id).ok, true);
  assert.deepEqual(changed, [["new words", "edit"], ["second", "drop"]]);
  r.runs.endRun("t-1", { status: "done" });
  await w;
  assert.deepEqual(r.said.filter((e) => e.type === "steer-unread").flatMap((e) => e.ids), [a.id]);
  r.done();
});

test("a fork's verdict, read: a correction, a question and its letter, work and its tasks — and none", () => {
  assert.deepEqual(readVerdict("Verdict: correction"), { as: "correction" });
  assert.deepEqual(readVerdict("**Verdict:** question\nIt is in src/cache.js, line 40.\n\n**Letter:** the cache moved; read it there."), { as: "question", answer: "It is in src/cache.js, line 40.", letter: "the cache moved; read it there." });
  const work = readVerdict('Verdict: work\n```json\n[{"id": "t9", "name": "Docs", "needs": [], "by": "builder", "check": ["rm -rf /"]}]\n```\nLetter: add the docs once the fix is in.');
  assert.deepEqual(work, { as: "work", plan: { goal: "", tasks: [{ id: "t9", name: "Docs", needs: [] }] }, letter: "add the docs once the fix is in." }, "who does it and its check are the agent's to give");
  assert.deepEqual(readVerdict('Verdict: work\n```\n{"goal": "Ship it", "tasks": [{"id": "a", "name": "A"}]}\n```')?.as === "work" && /** @type {any} */ (readVerdict('Verdict: work\n```\n{"goal": "Ship it", "tasks": [{"id": "a", "name": "A"}]}\n```')).plan, { goal: "Ship it", tasks: [{ id: "a", name: "A" }] });
  assert.equal(readVerdict("I think the person wants yarn."), null);
  assert.equal(readVerdict("Verdict: question"), null, "a question with no answer");
  assert.equal(readVerdict("Verdict: work\nsomething"), null, "work with neither a plan nor a letter");
  const said = letterText("also add docs", /** @type {any} */ (work), { ok: true, ids: ["t9"] });
  assert.match(said, /^While you worked, the person wrote: "also add docs"\nIt asks for more work\. I planned it as tasks proposed on your graph — none started/);
  assert.match(said, /\n- t9: Docs\n\nadd the docs once the fix is in\.$/);
  assert.match(letterText("also add docs", /** @type {any} */ (work), { ok: false, error: "t9 is a task in the graph already" }), /your graph took none of them \(t9 is a task in the graph already\): add them yourself/);
});

/** A registry and a graph that stand in for the turn's, and what each was asked. */
function standIns({ launches = true } = {}) {
  /** @type {{ id: string, spec: any, d: ReturnType<typeof deferred> }[]} */
  const launched = [];
  /** @type {string[]} */
  const stopped = [];
  /** @type {any[]} */
  const letters = [];
  /** @type {any[]} */
  const proposed = [];
  let n = 0;
  const registry = {
    launch: (/** @type {any} */ spec) => {
      if (!launches) return /** @type {const} */ ({ ok: false, error: "the main agent's turn has sent no request yet" });
      const d = deferred();
      const id = `sa_${++n}`;
      launched.push({ id, spec, d });
      return { ok: /** @type {const} */ (true), id, done: d.promise };
    },
    stop: (/** @type {string} */ id) => void stopped.push(id),
    letter: (/** @type {string} */ chainId, /** @type {any} */ l) => void letters.push({ chainId, ...l }),
  };
  const graphs = { propose: (/** @type {string} */ chainId, /** @type {any} */ input) => (proposed.push({ chainId, input }), { ok: /** @type {const} */ (true), ids: input.tasks.map((/** @type {any} */ t) => String(t.id)) }) };
  /** The fork's end, its final message. @param {number} i @param {string} report */
  const end = (i, report, status = "done") => launched[i].d.resolve({ status, ok: status === "done", report, error: status === "done" ? null : "it broke" });
  return { registry, graphs, launched, stopped, letters, proposed, end };
}

test("a correction: its fork is the turn's own, read-only, and the note goes in at the loop's next read", async () => {
  const r = runOf();
  const s = standIns();
  weighAside({ chainId: "c1", mailbox: r.mb, registry: s.registry, graphs: s.graphs, can: () => true });
  const m = r.say("not that file — the one in lib/");
  await settle();
  assert.equal(s.launched.length, 1);
  assert.deepEqual(
    (({ origin, chainId, view, may, weighs }) => ({ origin, chainId, view, may, weighs }))(s.launched[0].spec),
    { origin: "self", chainId: "c1", view: "fork", may: "read", weighs: m.id },
  );
  assert.match(s.launched[0].spec.prompt, /not that file — the one in lib\/$/);
  assert.deepEqual(r.mb.read(), [], "held while it weighs");
  s.end(0, "Verdict: correction");
  await settle();
  assert.deepEqual(r.mb.read().map((x) => x.text), ["not that file — the one in lib/"]);
  assert.deepEqual(r.asides(m.id).map((e) => e.as), ["weighing", "correction"]);
  assert.deepEqual([s.letters, s.proposed], [[], []]);
  r.done();
});

test("a question: answered for the person, off the queue — the agent written to only where the answer changes its work", async () => {
  const r = runOf();
  const s = standIns();
  weighAside({ chainId: "c1", mailbox: r.mb, registry: s.registry, graphs: s.graphs, can: () => true });
  const a = r.say("what does the cache key on?");
  await settle();
  s.end(0, "Verdict: question\nOn the file's path and its mtime.");
  await settle();
  assert.deepEqual([r.mb.read().length, s.letters.length], [0, 0]);
  assert.deepEqual((({ as, answer }) => ({ as, answer }))(r.asides(a.id).at(-1)), { as: "question", answer: "On the file's path and its mtime." });
  const b = r.say("is the mtime check still needed?");
  await settle();
  s.end(1, "Verdict: question\nNo: the hash covers it.\nLetter: drop the mtime check from your change.");
  await settle();
  assert.equal(s.letters.length, 1);
  const [l] = s.letters;
  assert.deepEqual([l.chainId, l.from, l.via, l.sender], ["c1", "sa_2", "steer", "the fork that weighed the person's message"]);
  assert.match(l.subject, /^the person asked "is the mtime check still needed\?" and was answered under their message/);
  assert.match(l.text, /No: the hash covers it\.\n\ndrop the mtime check from your change\.$/);
  assert.ok(r.asides(b.id).at(-1)?.letter, "the page knows the agent was told");
  r.done();
});

test("work: tasks proposed on the graph, the note off the queue, and a sealed letter that names them", async () => {
  const r = runOf();
  const s = standIns();
  weighAside({ chainId: "c1", mailbox: r.mb, registry: s.registry, graphs: s.graphs, can: () => true });
  const m = r.say("also add docs for the cache, and later a benchmark");
  await settle();
  s.end(0, 'Verdict: work\n```json\n[{"id": "d1", "name": "Cache docs", "writes": ["docs/cache.md"]}, {"id": "b1", "name": "Benchmark", "needs": ["d1"]}]\n```\nLetter: both after your fix.');
  await settle();
  assert.deepEqual(s.proposed, [{ chainId: "c1", input: { goal: "also add docs for the cache, and later a benchmark", tasks: [{ id: "d1", name: "Cache docs", writes: ["docs/cache.md"] }, { id: "b1", name: "Benchmark", needs: ["d1"] }] } }], "a plan with no goal of its own: the person's words, should it start the graph");
  const last = r.asides(m.id).at(-1);
  assert.deepEqual([last.as, last.tasks], ["work", [{ id: "d1", name: "Cache docs" }, { id: "b1", name: "Benchmark" }]]);
  assert.equal(r.mb.read().length, 0);
  const [l] = s.letters;
  assert.match(l.subject, /asks for more work: 2 tasks proposed on your graph \(d1, b1\), none started$/);
  assert.match(l.text, /- d1: Cache docs\n- b1: Benchmark\n\nboth after your fix\.$/);
  r.done();
});

test("one note at a time, in the order they came", async () => {
  const r = runOf();
  const s = standIns();
  weighAside({ chainId: "c1", mailbox: r.mb, registry: s.registry, graphs: s.graphs, can: () => true });
  r.say("one");
  r.say("two");
  await settle();
  assert.deepEqual(s.launched.map((x) => x.spec.prompt.split("\n").at(-1)), ["one"]);
  s.end(0, "Verdict: correction");
  await settle();
  assert.deepEqual(s.launched.map((x) => x.spec.prompt.split("\n").at(-1)), ["one", "two"]);
  assert.deepEqual(r.mb.read().map((x) => x.text), ["one"], "the second still weighed");
  r.done();
});

test("a note no fork weighs to an end goes straight in: none could start, it failed, or it gave no verdict", async () => {
  const r = runOf();
  const none = standIns({ launches: false });
  const w = weighAside({ chainId: "c1", mailbox: r.mb, registry: none.registry, graphs: none.graphs, can: () => true });
  const a = r.say("first");
  await settle();
  assert.deepEqual(r.asides(a.id).map((e) => [e.as, e.why]), [["straight", "no fork could weigh it: the main agent's turn has sent no request yet"]]);
  assert.deepEqual(r.mb.read().map((x) => x.text), ["first"]);
  w.close();
  const s = standIns();
  weighAside({ chainId: "c1", mailbox: r.mb, registry: s.registry, graphs: s.graphs, can: () => true });
  const b = r.say("second");
  const c = r.say("third");
  await settle();
  s.end(0, "", "failed");
  await settle();
  s.end(1, "I would rather not say.");
  await settle();
  assert.deepEqual([r.asides(b.id).at(-1)?.why, r.asides(c.id).at(-1)?.why], ["its fork failed: it broke", "its fork gave no verdict Filament could read"]);
  assert.deepEqual(r.mb.read().map((x) => x.text), ["second", "third"]);
  r.done();
});

// (fails before: yes — the review of 11-04: a note that waited in line behind another started its fork without asking
// again whether a fork could read the cache)
test("each note is gated as its turn in line comes: one that waited while the cache went cold goes in unweighed, saying why", async () => {
  const r = runOf();
  const s = standIns();
  /** @type {boolean | string} */
  let may = true;
  weighAside({ chainId: "c1", mailbox: r.mb, registry: s.registry, graphs: s.graphs, can: () => may });
  r.say("one");
  const two = r.say("two");
  await settle();
  may = "the provider's cache has gone cold, or a fork would carry more than half its line";
  s.end(0, "Verdict: correction");
  await settle();
  assert.equal(s.launched.length, 1, "no fork for the note that waited");
  assert.deepEqual(r.asides(two.id).map((e) => [e.as, e.why]), [["straight", "the provider's cache has gone cold, or a fork would carry more than half its line"]]);
  assert.deepEqual(r.mb.read().map((x) => x.text), ["one", "two"]);
  r.done();
});

// (fails before: yes — the review of 11-04: right after a fold the gate read the request before it as warm, though the
// fork copies the folded conversation, which no request had cached yet — the fork paid full price for it)
test("whether a fork may weigh a note: the switch, a lead's turn, the first request, a fold since it, the cache — each said in words", () => {
  const steerGate = /** @type {any} */ (steerFork).steerGate;
  assert.equal(typeof steerGate, "function");
  const a = { role: "user", content: "fix the cache" };
  const b = { role: "assistant", content: "On it." };
  const c = { role: "user", content: "a result" };
  const ok = { off: false, lead: false, sent: [a, b], live: [a, b, c], pays: () => true };
  assert.equal(steerGate(ok), true, "the conversation starts with what the newest request sent: its fork reads the cache");
  assert.equal(steerGate({ ...ok, off: true }), false, "the switch off: nothing said note by note");
  assert.equal(steerGate({ ...ok, lead: true }), "a team's lead weighs no message aside");
  assert.equal(steerGate({ ...ok, sent: null }), "the turn's first request has not come back yet");
  const folded = "the conversation was compacted since its newest request, and the provider's cache holds none of it as it is now";
  assert.equal(steerGate({ ...ok, live: [{ role: "user", content: "The summary." }, c] }), folded);
  assert.equal(steerGate({ ...ok, live: [a, { ...b }, c] }), folded, "a message replaced, though its words are the same");
  assert.equal(steerGate({ ...ok, pays: () => false }), "the provider's cache has gone cold, or a fork would carry more than half its line");
  const turn = readFileSync(new URL("../src/app/agent/turn.js", import.meta.url), "utf8");
  assert.match(turn, /can: \(\{ asked \}\) => steerGate\(\{ off: !asked && docNow\(\)\?\.loop\?\.steerFork !== true, lead: !!leadTeam, sent: lastCall\?\.messages \|\| null, live: liveConvo, pays: forkable \}\),/, "the turn asks it of its newest request and its conversation as it stands — the switch, unless the person asked for a fork");
});

// (fails before: yes — the review of 11-04: the fork's note said envelope was not its to call, and nothing refused it;
// and the fork's calls asked the route's cache lifetime where the turn's asked the chat's)
test("a fork that weighs is refused the envelope tool in words, and its calls ask the chat's cache lifetime as the turn's do", () => {
  const refusals = /** @type {any} */ (toolsModule).WEIGH_REFUSALS;
  assert.match(String(refusals?.envelope), /^Not run: you weigh the person's message while the agent works on undisturbed/);
  assert.ok(STEER_FORK_NOTE.includes("ask, plan, tasks, agent and envelope are not yours to call"));
  const turn = readFileSync(new URL("../src/app/agent/turn.js", import.meta.url), "utf8");
  assert.match(turn, /\.\.\.\(host\?\.weighs \? WEIGH_REFUSALS : \{\}\) \}/, "added to a weighing fork's refusals");
  assert.match(turn, /const chatTtl = \(!host \|\| forked\) && \(doc\?\.model\?\.cacheTtl === "5m"/, "a fork's run asks the chat's lifetime");
});

test("Edit weighs the new words, Delete stops its fork, and the turn's end stops the one at work; a switch that is off weighs nothing", async () => {
  const r = runOf();
  const s = standIns();
  let on = true;
  const w = weighAside({ chainId: "c1", mailbox: r.mb, registry: s.registry, graphs: s.graphs, can: () => on });
  const m = r.say("old words");
  await settle();
  r.runs.editSteer("t-1", m.id, { text: "new words" });
  await settle();
  assert.deepEqual([s.stopped, s.launched.map((x) => x.spec.prompt.split("\n").at(-1))], [["sa_1"], ["old words", "new words"]]);
  s.end(0, "Verdict: correction");
  await settle();
  assert.equal(r.mb.read().length, 0, "the stopped fork's verdict is no longer the note's");
  r.runs.dropSteer("t-1", m.id);
  await settle();
  assert.deepEqual(s.stopped, ["sa_1", "sa_2"]);
  r.say("held at the end");
  await settle();
  w.close();
  assert.deepEqual(s.stopped, ["sa_1", "sa_2", "sa_3"]);
  r.say("after the end");
  assert.equal(r.mb.read().length, 1, "a closed weigher takes nothing");
  on = false;
  weighAside({ chainId: "c1", mailbox: r.mb, registry: s.registry, graphs: s.graphs, can: () => on });
  r.say("switch off");
  await settle();
  assert.deepEqual([s.launched.length, r.mb.read().map((x) => x.text)], [3, ["switch off"]]);
  r.done();
});

/**
 * A turn of the agent loop on a run's mailbox, its model's replies scripted: `replyOf` gives the nth reply's blocks.
 * @param {ReturnType<typeof runOf>} r @param {(n: number) => any[]} replyOf @param {{ inbox?: any }} [o]
 */
function loopOn(r, replyOf, { inbox = null } = {}) {
  /** @type {any[]} */
  const calls = [];
  /** @type {any[]} */
  const events = [];
  const out = runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
    model: "m", root, readerModel: "", maxTokens: 100, thinking: null, costOf: () => 0,
    runHand: async (/** @type {string} */ name) => `${name} ran`, delegateRead: null, permissions: null, rules: [], hooks: null,
    mcpReadOnly: new Set(), previewChars: 200, messages: [{ role: "user", content: "fix the cache" }], system: "s",
    tools: toolSetFor({ delegateRead: false }), modeNow: () => "edit", subagents: null, inbox, mailbox: r.mb, tree: null,
    onEvent: (/** @type {any} */ e) => events.push(e),
    sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } },
    signal: null, resume: null,
    call: async (/** @type {any} */ { body }) => {
      calls.push(structuredClone(body));
      const content = replyOf(calls.length);
      return { ok: true, status: 200, json: { content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }, id: null, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  }));
  /** Until the turn waits, saying why. @param {string} why @param {number} [n] the nth such wait */
  const waits = (why, n = 1) => until(() => events.filter((e) => e.type === "waiting" && e.why === why).length >= n, `the turn to wait: ${why}`);
  return { out, calls, events, waits };
}

test("the loop does not end its turn while a note is weighed: a correction gets one more round, an answered question none", async () => {
  /** @param {"pass" | "settle"} how */
  const turn = async (how) => {
    const r = runOf();
    /** @type {any[]} */
    const held = [];
    r.mb.aside({ take: (m) => (held.push(m), true), changed: () => {} });
    const { out, calls, waits } = loopOn(r, (n) => {
      if (n === 1) r.say("use yarn");
      return [{ type: "text", text: n === 1 ? "Done." : "Done, with yarn." }];
    });
    await waits("weighing your message aside");
    await settle();
    assert.equal(calls.length, 1, "it waits");
    if (how === "pass") r.mb.pass(held[0], { as: "correction" });
    else r.mb.settle(held[0], { as: "question", answer: "42" });
    const ended = await out;
    r.done();
    return { calls, ended };
  };
  const passed = await turn("pass");
  assert.equal(passed.calls.length, 2);
  assert.match(JSON.stringify(passed.calls[1].messages.at(-1)), /use yarn/);
  assert.equal(passed.ended.status, "done");
  const answered = await turn("settle");
  assert.equal(answered.calls.length, 1);
  assert.equal(answered.ended.status, "done");
});

// (fails before: yes — the review of 11-04: the turn asked whether a note was weighed once, before it waited for its
// agents; one typed during that wait was held, woke nothing, and the turn ended with it unread)
test("a note typed while the turn waits for its agents at its end is weighed before the turn ends", async () => {
  const r = runOf();
  /** @type {any[]} */
  const held = [];
  r.mb.aside({ take: (m) => (held.push(m), true), changed: () => {} });
  const owes = deferred();
  let owing = true;
  const inbox = { owed: () => (owing ? owes.promise : null), owedWhy: () => "waiting for sub-agents to report", take: () => [], sealed: () => [], hold: () => null };
  const { out, calls, waits } = loopOn(r, (n) => [{ type: "text", text: n === 1 ? "Done." : "Done, with yarn." }], { inbox });
  await waits("waiting for sub-agents to report");
  r.say("use yarn");
  await settle();
  owing = false;
  owes.resolve();
  await waits("weighing your message aside");
  assert.equal(calls.length, 1, "it waits for the note's fork");
  r.mb.pass(held[0], { as: "correction" });
  const ended = await out;
  assert.deepEqual([calls.length, ended.status], [2, "done"]);
  assert.match(JSON.stringify(calls[1].messages.at(-1)), /use yarn/);
  r.done();
});

// (fails before: yes — the review of 11-04: a turn that paused for the person's answer carried the notes the loop could
// read; one a fork still weighed was left held, its fork stopped with the turn, and the run's end marked it unread)
test("a turn that pauses for the person's answer takes a note still weighed with it, unweighed, its fork stopped", async () => {
  const r = runOf();
  /** @type {[string, string][]} */
  const changed = [];
  r.mb.aside({ take: () => true, changed: (m, how) => void changed.push([m.text, how]) });
  /** @type {any} */
  let m = null;
  const { out } = loopOn(r, () => {
    m = r.say("use yarn");
    return [{ type: "tool_use", id: "q1", name: "ask", input: { question: "x or y?" } }];
  });
  const ended = /** @type {any} */ (await out);
  assert.equal(ended.status, "paused");
  assert.deepEqual(ended.pause?.heard?.map((/** @type {any} */ x) => x.text), ["use yarn"], "it rides the answer");
  assert.deepEqual(changed, [["use yarn", "drop"]], "its fork stops");
  assert.deepEqual((({ as, why }) => ({ as, why }))(r.asides(m.id).at(-1)), { as: "straight", why: "the turn paused for your answer before its fork weighed it" });
  r.done();
});

// (fails before: yes — the review of 11-04: Filament acting on a verdict that threw left the note held, and the turn
// waited for it until Stop)
test("a verdict Filament cannot act on sends the note in unweighed, and a switch that cannot be read weighs nothing", async () => {
  const r = runOf();
  const s = standIns();
  const graphs = { propose: () => { throw new Error("the graph could not be kept"); } };
  weighAside({ chainId: "c1", mailbox: r.mb, registry: s.registry, graphs, can: () => true });
  const m = r.say("also add docs");
  await settle();
  s.end(0, 'Verdict: work\n```json\n[{"id": "d1", "name": "Docs"}]\n```');
  await settle();
  assert.deepEqual(r.mb.read().map((x) => x.text), ["also add docs"]);
  assert.equal(r.asides(m.id).at(-1)?.why, "Filament could not act on its fork's verdict: the graph could not be kept");
  assert.equal(r.mb.weighed(), null);
  const t = runOf();
  weighAside({ chainId: "c1", mailbox: t.mb, registry: s.registry, graphs: s.graphs, can: () => { throw new Error("no session"); } });
  t.say("plain");
  assert.deepEqual(t.mb.read().map((x) => x.text), ["plain"]);
  r.done();
  t.done();
});

test("the registry starts the fork on the turn's own request, under the steer fork's note, and leaves no mark in the chat", async () => {
  /** @type {any[]} */
  const bodies = [];
  /** @type {any[]} */
  const marks = [];
  /** @type {any[]} what memory was given to learn from */
  const learned = [];
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    now: Date.now,
    context: {
      settings: () => ({ subagents: { pool: [{ model: "", seats: 4 }] }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: root, model: "m", projectId: "p1" }),
      view: async () => ({ text: "", turns: 0 }),
      brief: async () => null,
      modelProblem: () => null,
      mark: (/** @type {string} */ _c, /** @type {any} */ m) => (marks.push(m), { ...m, afterTurn: 1 }),
      reported: (/** @type {any} */ x) => void learned.push(x),
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      registry.attach(id, "run-f");
      bodies.push({ ...body, host: registry.hostOf(id)?.fork, weighs: registry.hostOf(id)?.weighs });
      registry.finish(id, { status: "done", error: null, report: "Verdict: correction", convo: [...body.messages], rounds: 1, toolCalls: 0, tokensIn: 10, tokensOut: 2, spentUsd: 0, roundIds: ["run-f"] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "Verdict: correction" }], usage: { input_tokens: 10, output_tokens: 2 } }, id: "run-f", upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  const turnBody = { model: "m", max_tokens: 100, system: [{ type: "text", text: "the agent's own" }], tools: [{ name: "read" }], messages: [{ role: "user", content: "fix the cache" }, { role: "assistant", content: [{ type: "text", text: "On it." }] }] };
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: root, mode: "edit", model: "m", thinking: null, fork: () => ({ body: structuredClone(turnBody), headers: {}, tokens: 50 }) });
  const r = registry.launch({ origin: "self", chainId: "c1", view: "fork", may: "read", weighs: "s3-abc", prompt: "The person's message, sent while the agent worked:\n\nuse yarn", description: "Weighing your message", why: "you sent a message while the agent worked" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const o = await /** @type {any} */ (r).done;
  assert.deepEqual([o.status, o.report], ["done", "Verdict: correction"]);
  assert.equal(registry.get(/** @type {any} */ (r).id)?.weighs, "s3-abc");
  const [b] = bodies;
  assert.deepEqual([b.host?.system, b.host?.tools, b.messages.slice(0, 2)], [turnBody.system, turnBody.tools, turnBody.messages], "the turn's own prefix, byte for byte: its host sends the turn's system and tools");
  const last = JSON.stringify(b.messages.at(-1));
  assert.ok(last.includes(JSON.stringify(STEER_FORK_NOTE).slice(1, 60)), "the steer fork's note");
  assert.match(last, /use yarn/);
  assert.equal(b.messages.length, 3);
  assert.deepEqual(marks.map((m) => m.event), [], "no row in the chat's transcript");
  // (fails before: yes — the drive and the review of 11-04: the fork's verdict reached the main agent as a report
  // "joined the conversation here", memory learned from it, and the person could send it on)
  assert.equal(b.weighs, "s3-abc", "its run says whose message it weighs: the sidebar takes it for no word of the chat's");
  const bar = readFileSync(new URL("../src/ui/harness/sidebar.js", import.meta.url), "utf8");
  assert.match(bar, /\|\| run\.meta\?\.weighs\) continue;/, "the left bar gives its chat no working mark and no unread dot for it");
  assert.deepEqual(door.inbox.take({ seal: false, end: true }), [], "its verdict is the turn's to read, never the agent's");
  assert.equal(registry.get(/** @type {any} */ (r).id)?.exchanges.at(-1)?.delivery, "weighed");
  assert.deepEqual(learned, [], "nor memory's");
  const sent = registry.send(/** @type {any} */ (r).id, "c1");
  assert.match(sent.ok ? "" : sent.error, /weighed your message for the agent/);
  door.close();
});

test("the fork's letter is a letter: sealed for the agent to open when it chooses, kept so when no turn reads it", () => {
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    now: Date.now,
    context: {
      settings: () => ({ subagents: { pool: [{ model: "", seats: 4 }] }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: root, model: "m", projectId: "p1" }),
      view: async () => ({ text: "", turns: 0 }),
      brief: async () => null,
      modelProblem: () => null,
      mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
      reportWaits: () => {},
    },
    call: async () => {
      throw new Error("no launch here");
    },
  });
  const LETTER = { text: "While you worked, the person wrote…", from: "sa_1", description: "Weighing your message", sender: "the fork that weighed the person's message", subject: "more work", via: /** @type {const} */ ("steer") };
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: root, mode: "edit", model: "m", thinking: null, fork: null, opens: () => true });
  assert.deepEqual(registry.letter("c1", LETTER), { ok: true, at: "turn" });
  const [line] = door.inbox.take({ seal: false, end: true });
  assert.deepEqual([line.kind, line.envelope], ["envelope", 1], "sealed even as the turn ends");
  assert.match(line.text, /^\[Filament: envelope 1, sealed — from the fork that weighed the person's message: more work\./);
  door.close();
  assert.deepEqual(registry.envelopes("c1").map((e) => [e.n, e.via]), [[1, "steer"]], "kept sealed for the chat");
});

test("a proposed task is never ready — nothing starts it, nothing offers it side by side — until the agent starts or changes it", () => {
  const at = 1;
  const g0 = /** @type {any} */ (applyTasks(null, { action: "add", goal: "Fix the cache", tasks: [{ id: "t1", name: "Fix", writes: ["src/cache.js"] }] }, { at, crew: "agent" })).graph;
  const p = proposeTasks(g0, { tasks: [{ id: "d1", name: "Docs", writes: ["docs/cache.md"] }, { id: "b1", name: "Bench", writes: ["bench/cache.js"] }] }, { at: 2, crew: "agent" });
  assert.equal(p.ok, true, JSON.stringify(p));
  const g = /** @type {any} */ (p).graph;
  assert.deepEqual(g.tasks.map((/** @type {any} */ t) => [t.id, t.proposed ?? null]), [["t1", null], ["d1", { from: "steer", at: 2 }], ["b1", { from: "steer", at: 2 }]]);
  assert.deepEqual(graphView(g)?.tasks.map((t) => [t.id, t.ready]), [["t1", true], ["d1", false], ["b1", false]]);
  assert.deepEqual(sideBySide(g), [], "t1 alone is ready: no two to offer");
  const shown = /** @type {any} */ (applyTasks(g, { action: "show" }, { at: 3, crew: "agent" })).text;
  assert.match(shown, /d1 "Docs" — proposed from the person's message — start it, or change it, to take it on; drop it if it is not to be done/);
  assert.match(shown, /proposed: d1, b1/);
  const started = /** @type {any} */ (applyTasks(g, { action: "start", ids: ["d1"] }, { at: 4, crew: "agent" })).graph;
  assert.deepEqual(started.tasks.map((/** @type {any} */ t) => [t.id, t.state, !!t.proposed]), [["t1", "waiting", false], ["d1", "running", false], ["b1", "waiting", true]]);
  const changed = /** @type {any} */ (applyTasks(g, { action: "change", tasks: [{ id: "b1", name: "Benchmark" }] }, { at: 4, crew: "agent" })).graph;
  assert.deepEqual(sideBySide(changed), ["t1", "b1"], "taken on, it is offered as any other");
  assert.equal(proposeTasks(g, { tasks: [{ id: "d1", name: "Again" }] }, { at: 5, crew: "agent" }).ok, false, "an id the graph holds is refused, the graph as it was");
  const goaled = /** @type {any} */ (proposeTasks(g, { goal: "Document everything", tasks: [{ id: "x1", name: "More" }] }, { at: 5, crew: "agent" })).graph;
  assert.deepEqual([goaled.goal, goaled.tasks.at(-1).id], ["Fix the cache", "x1"], "a fork's plan never restates the agent's goal");
  // (fails before: yes — the review of 11-04: its checklist's item or a coding agent's helper took a proposed task on,
  // and it still read proposed)
  const ticked = /** @type {any} */ (applyPlan(g, [{ text: "Fix", status: "pending" }, { text: "Docs", status: "doing" }, { text: "Bench", status: "done" }], { at: 6, crew: "agent" })).graph;
  assert.deepEqual(ticked.tasks.filter((/** @type {any} */ t) => t.id !== "t1").map((/** @type {any} */ t) => [t.id, t.state, !!t.proposed]), [["d1", "running", false], ["b1", "done", false]]);
  const helped = /** @type {any} */ (helperTook(g, "d1", { agent: "sa_9", model: "m", copy: false, at: 6 }));
  assert.deepEqual([helped.tasks[1].state, !!helped.tasks[1].proposed], ["running", false]);
  const fresh = proposeTasks(null, { goal: "Docs for the cache", tasks: [{ id: "d1", name: "Docs" }] }, { at: 6, crew: "agent" });
  assert.deepEqual([fresh.ok, /** @type {any} */ (fresh).graph?.goal], [true, "Docs for the cache"]);
});

test("the page: the bubble says the fork weighs it, what it made of it, and where the answer and the tasks went", () => {
  const evs = [
    { type: "round-start", round: 0 },
    { type: "steer", id: "s1", kind: "note", text: "what keys the cache?", from: "harness", at: 1, state: "queued", aside: true },
    { type: "steer", id: "s2", kind: "note", text: "also docs", from: "harness", at: 2, state: "queued", aside: true },
    { type: "steer", id: "s3", kind: "note", text: "not that file", from: "harness", at: 3, state: "queued", aside: true },
    { type: "steer-aside", id: "s1", as: "weighing", agent: "sa_1" },
  ];
  const s1 = alignEvents(evs).steers.get("s1");
  assert.equal(steerWords(s1).state, "Weighing this aside — the agent works on…");
  const more = [
    ...evs,
    { type: "round-start", round: 2 },
    { type: "steer-aside", id: "s1", as: "question", agent: "sa_1", answer: "Its path." },
    { type: "steer-aside", id: "s2", as: "work", agent: "sa_2", letter: "…", tasks: [{ id: "d1", name: "Docs" }] },
    { type: "steer-aside", id: "s3", as: "correction", agent: "sa_3" },
  ];
  const al = alignEvents(more);
  const [q, w, c] = ["s1", "s2", "s3"].map((id) => al.steers.get(id));
  assert.deepEqual([q.read, q.readRound, q.answer, steerWords(q).state], [true, 2, "Its path.", "Answered aside — the agent worked on"]);
  assert.equal(steerWords(w).state, "Planned aside for the agent: d1 (Docs) — none started; it reads the fork's letter when it chooses");
  assert.deepEqual(al.byRound.get(2)?.steers.map((s) => s.id), ["s1", "s2"], "drawn where they settled");
  assert.deepEqual([c.read, steerWords(c).state], [false, "A correction — it reaches the agent at its next step…"]);
  // (fails before: yes — the review of 11-04: new words for a note its fork had passed on still said it was a correction)
  const edited = alignEvents([...more, { type: "steer-edit", id: "s3", text: "not that file — the other one" }]).steers.get("s3");
  assert.deepEqual([edited.text, edited.aside, steerWords(edited).state === steerWords(c).state], ["not that file — the other one", undefined, false]);
  assert.equal(envelopeFrom({ description: "Weighing your message", via: "steer" }), "the fork that weighed your message");
  assert.match(envelopeOpenedWords({ n: 4, description: "Weighing your message", via: "steer", by: "tool" }), /: its letter joined the conversation here$/);
  // (fails before: yes — the review of 11-04: a note that went in unweighed never said why)
  const cold = "the provider's cache has gone cold, or a fork would carry more than half its line";
  const straightIn = [...evs, { type: "steer-aside", id: "s2", as: "straight", why: cold }];
  assert.equal(steerWords(alignEvents(straightIn).steers.get("s2")).state, `Not weighed aside — ${cold}: it reaches the agent at its next step…`);
  const read = alignEvents([...straightIn, { type: "round-start", round: 1 }, { type: "steer-read", ids: ["s2"], kinds: ["note"] }]).steers.get("s2");
  assert.equal(steerWords(read).state, `Conversation steered — not weighed aside: ${cold}`);
  // (fails before: yes — the review of 11-05: a bubble its POST drew before the log's took the log's `aside` but not why)
  const timeline = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
  const fromLog = /const FROM_LOG = \/\*\* @type \{const\} \*\/ \(\[([^\]\n]*)\]\);/.exec(timeline)?.[1] || "";
  for (const k of ["aside", "why", "answer", "letter", "tasks"]) assert.ok(fromLog.includes(`"${k}"`), `a drawn bubble takes ${k} from the log`);
});

// (fails before: yes — the owner's of 11-05: "by default keep the straight forward steer we have because 99% users are
// used to simple steer": the switch was on by default)
test("the switch: off unless the person turns it on, read as each message comes", () => {
  assert.equal(KNOBS["loop.steerFork"].default, false);
});

// (fails before: yes — the owner's of 11-05: "put that fork and steer behind that down popover or maybe also build a
// slash steer-fork command": a note was weighed aside only where the switch was on, and nothing asked for it note by note)
test("a note the person asks a fork for is weighed with the switch off; one no fork can take goes in, saying why", async () => {
  const r = runOf();
  const s = standIns();
  /** @type {boolean[]} */
  const askedOf = [];
  /** @type {boolean | string} */
  let pays = true;
  // The turn's gate: the switch off, so only an asked note may fork.
  weighAside({ chainId: "c1", mailbox: r.mb, registry: s.registry, graphs: s.graphs, can: ({ asked }) => (askedOf.push(asked), asked ? pays : false) });
  r.say("plain words");
  const a = r.say("not that file — the one in lib/", { weigh: true });
  assert.equal(r.said.find((e) => e.type === "steer" && e.id === a.id)?.aside, true, "held for its fork");
  await settle();
  assert.deepEqual(s.launched.map((x) => x.spec.weighs), [a.id], "the plain note went straight in, the asked one to a fork");
  assert.deepEqual(askedOf, [false, true], "the gate heard which the person asked for");
  s.end(0, "Verdict: correction");
  await settle();
  assert.deepEqual(r.mb.read().map((x) => x.text), ["plain words", "not that file — the one in lib/"]);
  // The cache gone cold: the asked note is held as it comes, and its turn in line says why no fork weighed it.
  pays = "the provider's cache has gone cold, or a fork would carry more than half its line";
  const b = r.say("and the tests too", { weigh: true });
  await settle();
  assert.equal(s.launched.length, 1, "no fork");
  assert.deepEqual(r.asides(b.id).map((e) => [e.as, e.why]), [["straight", pays]]);
  assert.deepEqual(r.mb.read().map((x) => x.text), ["and the tests too"]);
  r.done();
});

test("a note asked a fork for that none can take goes in at once, saying why: pictures, words that speak to the work, a turn that weighs none", () => {
  const r = runOf();
  /** @type {string[]} */
  const taken = [];
  r.mb.aside({ take: (m) => (taken.push(m.text), true), changed: () => {} });
  const pic = r.say("see this", { weigh: true, images: [{ name: "a.png", mediaType: "image/png", data: "aGk=" }] });
  const named = r.say("ask @reviewer about it", { weigh: true, straight: "it names agents for the agent to use" });
  assert.deepEqual(taken, []);
  assert.deepEqual([...r.asides(pic.id), ...r.asides(named.id)].map((e) => [e.as, e.why]), [["straight", "a message with pictures goes straight in"], ["straight", "it names agents for the agent to use"]]);
  assert.equal(r.said.filter((e) => e.type === "steer").every((e) => !e.aside), true);
  const none = runOf();
  const c = none.say("no fork here", { weigh: true });
  assert.deepEqual(none.asides(c.id).map((e) => [e.as, e.why]), [["straight", "this turn weighs no message aside"]]);
  assert.deepEqual(none.mb.read().map((x) => x.text), ["no fork here"]);
  // Not asked: nothing said of it note by note.
  const d = none.say("plain");
  assert.deepEqual(none.asides(d.id), []);
  // (fails before: yes — the review of 11-05: a coding agent's run said its asked note went "straight in", over its own
  // words for where a note waits at its agent)
  none.runs.startRun({ id: "t-2", kind: "coding-agent", meta: { steer: "live" } });
  /** @type {any[]} */
  const agentSaid = [];
  none.runs.subscribe("t-2", (e) => void agentSaid.push(e));
  assert.equal(none.runs.steer("t-2", { kind: "note", text: "weigh this", from: "harness", weigh: true }).ok, true);
  assert.deepEqual(agentSaid.map((e) => e.type), ["steer"], "a coding agent's run weighs nothing aside, and says nothing of it");
  none.done();
  r.done();
});

test("the ⌄ menu's Weigh aside first and /steer-fork send the note with weigh; none runs, a coding agent's turn, a paused one refuse it", () => {
  const composer = readFileSync(new URL("../src/ui/harness/composer/composer.js", import.meta.url), "utf8");
  // Under More ways… on the loop's face alone, beside its veto (the owner's of 11-09; the rows on the stub document in
  // send-rows.test.js).
  assert.match(composer, /const later = takesNone \? \[\] : agentInterrupts \? \[stopAndSend\] : agentTurn \? \[\] : \[\n\s+\{ label: "Veto this round", [^\n]*\n\s+\{ label: "Weigh aside first", desc: "[^"]+", onClick: \(\) => send\("fork"\) \},/, "the loop's alone");
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  // (and /plan's and /goal's words, which go before it)
  assert.match(app, /const forkAsk = flowAsk == null && planAsk == null && !goalAsk \? steerForkOf\(text\) : null;/);
  assert.match(app, /if \(weigh && \(agentTurn \|\| !chat\.live \|\| chat\.live\.turn\.paused\)\) return refuse\(steerForkRefusal\(agentTurn \? "agent" : chat\.live \? "paused" : "idle"\), !away, false\);/);
  assert.match(app, /\.\.\.\(weigh \? \{ weigh: true \} : \{\}\), \.\.\.\(via \? \{ via \} : \{\}\) \}\);/, "posted with the note");
  assert.match(app, /useTeams: useKeys \} : \{\}\), weigh \}\);/, "held with it, for a run not known yet");
  assert.match(app, /\.\.\.\(m\.weigh \? \{ weigh: true \} : \{\}\), \.\.\.\(m\.via \? \{ via: m\.via \} : \{\}\) \} \}\);/, "steerPost sends it");
  const route = readFileSync(new URL("../src/http/admin/runs.js", import.meta.url), "utf8");
  assert.match(route, /overrules: whose, weigh: b\?\.weigh === true, straight, via: b\?\.via \}\);/);
});

test("/steer-fork: the message after the word, the word alone, and no /steer-fork; held for a run not known yet, its ask kept", async () => {
  const labels = /** @type {any} */ (await import("../src/ui/harness/lib/labels.js"));
  assert.equal(typeof labels.steerForkOf, "function");
  assert.equal(labels.steerForkOf("/steer-fork  use yarn,\nnot npm "), "use yarn,\nnot npm");
  assert.equal(labels.steerForkOf("/Steer-Fork"), "");
  assert.equal(labels.steerForkOf("/steer-forked words"), null);
  assert.equal(labels.steerForkOf("please /steer-fork it"), null);
  assert.match(labels.STEER_FORK_USAGE, /^\/steer-fork needs your message after it/);
  assert.match(labels.steerForkRefusal("idle"), /\/btw$/);
  const { createHeldSteers } = await import("../src/ui/harness/lib/held-steers.js");
  /** @type {any[]} */
  const posted = [];
  const held = createHeldSteers({ post: async (_runId, m) => void posted.push(m) });
  held.hold("note", "weigh me", [], { weigh: true });
  held.hold("veto", "never weighed", [], { weigh: true });
  held.hold("note", "plain");
  await held.flush("t-1");
  assert.deepEqual(posted.map((m) => [m.text, m.weigh ?? null]), [["weigh me", true], ["never weighed", null], ["plain", null]]);
});
