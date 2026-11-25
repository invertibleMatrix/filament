// @ts-check
// An agent proposes a watcher, and a watcher's agent sends its guidance, through the space tool (the plan of 11-11, its
// w7). The `routine` action takes a watcher's `trigger`, `wakes` and `guides`: each trigger kind is proposed, kept
// Proposed with its trigger read, and listens only once the person switched it on; its answer says what the person
// will read on its sheet. A trigger's chat is "this" or one of the project's chats the calling chat may read; a commit
// trigger's place is a folder of the project — at the tool, and where a kept one is followed —; a connection's tool is
// one the project's chats have, marked read-only. Fields that cannot stand together are refused with the call that
// teaches. A change of a watcher that is on switches it off, its source stopped. `guidance` sends a watcher's words to
// the chat it watches, from the chat it wakes or a run of it — from a turn held to reading too, on Filament's loop and
// on a coding agent. The guide teaches each call, and none the tool refuses.
// (fails before: yes — the routine action passed no trigger, wakes or guides on, so no agent could propose a watcher;
// the tool had no call that sent guidance; a commit watcher followed any folder on the machine)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GUIDES_PER_MESSAGE, GUIDE_HEAD, TRIGGER_KINDS, WAKE_HEAD, WATCH_WAKES_HOUR, triggerWords } from "../src/core/watchers.js";
import { mayWords, routineFields, rowWords, runWords, wakeWords } from "../src/core/routines.js";
import { readerNames } from "../src/core/space.js";
import { clip } from "../src/core/text.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createGuidance } from "../src/app/watchers/guidance.js";
import { createWatchEvents } from "../src/app/watchers/events.js";
import { createCommitWatch, placeAmong, placeAmongSoon } from "../src/app/watchers/commits.js";
import { createOwnTimes } from "../src/app/watchers/own-times.js";
import { createConnectionWatch } from "../src/app/watchers/connection.js";
import { createSpaceTools } from "../src/app/space-tools.js";
import { lanesWords } from "../src/app/space-lanes.js";
import { spaceCall, spaceGuide, spaceRun } from "../src/app/agent/space.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { routineFixWords } from "../src/ui/harness/lib/space-view.js";
import { startApp, fakeUpstream, anthropicReply, FAKE_ACP_AGENT } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const RUNS_SERVER = fileURLToPath(new URL("./fixtures/mcp-runs-server.mjs", import.meta.url));
/** @type {string[]} */
const made = [];
/** What a test started that holds a timer or a process. @type {(() => unknown)[]} */
const stops = [];
after(async () => {
  for (const stop of stops.splice(0)) await stop();
  await removeDirs(...made);
});
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-watch-propose-${tag}-`));
  made.push(d);
  return d;
};

/** A moment of Monday 26 October 2026, local. @param {number} h @param {number} [m] */
const at = (h, m = 0) => new Date(2026, 9, 26, h, m).getTime();
const NAMES = /** @type {Record<string, string>} */ ({ c1: "Lead", c2: "Build the login flow", c3: "Docs", c4: "Private notes", run1: "Supervisor · Mon 26 Oct" });
/** @param {string} c */
const nameOf = (c) => NAMES[c] || "an untitled chat";
/** @param {any} r */
const words = (r) => (r.ok ? r.text : r.error);
const call = (/** @type {Record<string, any>} */ w) => ({ action: "routine", with: w });

// The supervisor as the guide teaches it, from the chat to be reviewed; and what a refusal of a watcher's fields ends with.
const SUPERVISOR = '{"action":"routine","with":{"title":"Supervisor","trigger":{"kind":"turn","chat":"this"},"wakes":"new","guides":true,"text":"Read the turn against what the person asked for in that chat. On track: end in one line. Drifting, or a claim the changes do not bear out: send guidance, saying what and why in a few lines."}}';
const TEACH = `The call: ${SUPERVISOR} — {"action":"guide","topic":"routine"} gives every field.`;
// The sheet's sentences (core's `mayWords`), each once.
const TURNS = "after each turn of Build the login flow that changes files or marks tasks done";
const READS = "Reads only: it changes no file and sends nothing; it may write drafts and lines in What happened";
const HELD = "A turn in Lead, held to reading: it changes no file and runs no command that changes one, whatever that chat's own permissions";
const LIMIT = ". Filament holds it by refusing what that chat's agent asks to do: a coding agent that asks nothing before it acts cannot be held, and where Filament knows that of the chat's agent, the watcher fails rather than wake it";
const GUIDE = "; it may guide Build the login flow: guidance that chat reads at its next step, or as a turn of its own where it is at rest — 3 at most for each message of yours there, the next held in Needs you for your Send it —, or a sealed letter";
/** A watcher's answer: that it waits, what its sheet says, and what a run of it starts on. @param {string} id @param {string} title @param {string} sheet @param {{ changed?: boolean, off?: boolean, runs?: boolean }} [o] */
const answerOf = (id, title, sheet, { changed = false, off = false, runs = true } = {}) =>
  `Watcher ${id} "${title}" ${changed ? "is changed and " : ""}waits for the person's Switch on, on the card under this call and in the Space's Watchers: nothing listens until they press it.${off ? " It was on: it is off now, until the person switches it on again." : ""} Its sheet says to the person: “${sheet}.”${runs ? " It runs on agent/brain-model, the model you run on now, until the person chooses another on its sheet." : ""}`;

/**
 * A project's Space with the three sources a watcher listens through over stand-ins — the chats' events, the branches'
 * watches, the connections' asks —, set again at each `arm` as the server sets them; its folder, one it added and a
 * worktree are real folders; its connection `ci` is a real MCP server, whose `list_runs` only reads.
 */
function worldOf() {
  const clock = { at: at(9) };
  const now = () => clock.at;
  const spaces = createSpaceStore({ dir: null, now });
  const root = fresh("root");
  mkdirSync(join(root, "packages", "app"), { recursive: true });
  const added = fresh("added");
  const tree = fresh("tree");
  const outside = fresh("outside");
  const folders = [root, added, tree];
  /** @param {string} p @param {string} id @param {readonly unknown[]} evs */
  const heard = (p, id, evs) => spaces.watchHeard(p, id, evs);
  const events = createWatchEvents({ store: spaces, heard, chatOf: (c) => (NAMES[c] ? { project: "p1" } : null), nameOf, now });
  /** The branches watched, and those let go: each its place and its branch. @type {string[][]} */
  const started = [];
  /** @type {string[][]} */
  const let_go = [];
  const commits = createCommitWatch({
    store: spaces, heard, folderOf: () => root, chatOf: () => null, own: createOwnTimes({ now }), foldersOf: async () => folders, now,
    watch: /** @type {any} */ ((/** @type {string} */ place, /** @type {string} */ branch) => (started.push([place, branch]), { stop: () => void let_go.push([place, branch]) })),
  });
  /** @type {string[]} */
  const asked = [];
  const connection = createConnectionWatch({ store: spaces, heard, ask: async (_p, t) => (asked.push(t.tool), { ok: true, out: "[]" }), now });
  const spec = { name: "ci", command: process.execPath, args: [RUNS_SERVER] };
  /** @type {Record<string, any>} */
  const servers = { ci: { ok: true, spec, cwd: root }, off: { ok: false, error: "off is switched off for this project (Library › Plugins & Connectors)" } };
  const tools = createSpaceTools({ serverFor: (p, n) => (p === "p1" && servers[n]) || { ok: false, error: `${n} is no MCP server of this project's chats (Library › Plugins & Connectors, for all chats or this project)` } });
  stops.push(() => (events.stop(), commits.stop(), connection.stop(), tools.close()));
  /** @type {string[]} */
  const armed = [];
  const arm = () => {
    armed.push("arm");
    commits.sync();
    connection.sync();
  };
  /** The project's chats as the server lists them: none of another project, none archived; c4's words are its own alone. */
  const chatsOf = (/** @type {string} */ p) => (p === "p1" ? ["c1", "c2", "c3", "c4"].map((chain) => ({ chain, name: chain === "c4" ? "an untitled chat" : NAMES[chain] })) : []);
  const apart = (/** @type {string} */ c) => c === "c4";
  /** What both doors are wired with (the server's `space`). */
  const deps = {
    store: spaces, projectOf: (/** @type {string} */ c) => (NAMES[c] ? "p1" : null), nameOf, apart, on: () => true, modelOf: () => "agent/brain-model",
    routines: /** @type {any} */ ({ runNow: async () => "", arm }), runOf: () => null, chatsOf,
    placeIn: async (/** @type {string} */ _p, /** @type {string} */ place) => placeAmong(folders, place),
    toolReads: (/** @type {string} */ p, /** @type {string} */ tool) => tools.askable(p, tool),
  };
  /** Where a call of Filament's loop stands. @param {string} [chain] @param {Record<string, any>} [o] @returns {import("../src/app/agent/space.js").SpaceAt} */
  const atOf = (chain = "c1", o = {}) => ({ store: spaces, project: "p1", chain, name: null, ...readerNames({ nameOf, apart }, chain), on: () => true, modelOf: deps.modelOf, routines: deps.routines, runOf: deps.runOf, chatsOf, placeIn: deps.placeIn, toolReads: deps.toolReads, ...o });
  /** A coding agent's door: Filament's MCP server's own call. */
  const mcp = createAgentTools(/** @type {any} */ ({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null, space: deps }));
  /** @param {any} c @param {string} [chain] */
  const viaMcp = (c, chain = "c1") => mcp.call("space", c, /** @type {any} */ ({ cwd: root, chain, permit: null }));
  const routine = (/** @type {string} */ id) => /** @type {import("../src/core/routines.js").Routine} */ (spaces.get("p1").routines.find((r) => r.id === id));
  /** The person's Switch on, as its route does it: the store's, then the sources set again. @param {string} id */
  const switchOn = (id) => {
    spaces.routineOn("p1", id);
    arm();
  };
  return { clock, spaces, root, added, tree, outside, events, commits, connection, started, let_go, asked, armed, atOf, viaMcp, routine, switchOn };
}

/** An event of a chat, as Filament's sources say one: by its kind. */
const EVENTS = /** @type {Record<string, (at: number) => any>} */ ({
  turn: (t) => ({ kind: "turn", chain: "c2", at: t, turn: 4, failed: false, stopped: false, files: 1, tree: false, done: [] }),
  task: (t) => ({ kind: "task", chain: "c2", at: t, graph: 1, task: "t1", name: "Write the parser", state: "done", why: "" }),
  ask: (t) => ({ kind: "ask", chain: "c3", at: t - 11 * 60_000, ask: "a1", words: "Go on?" }),
  shell: (t) => ({ kind: "shell", chain: "c1", at: t, id: "s1", command: "npm test", exit: 1 }),
  subagent: (t) => ({ kind: "subagent", chain: "c3", at: t, agent: "sa_1", exchange: 1, description: "Map the folder", ok: true, status: "done", report: "Mapped." }),
});
/** Each kind as an agent proposes it, as its Space keeps it, and as its sheet says what wakes it. */
const KINDS = /** @type {{ kind: string, trigger: any, kept: any, when: string }[]} */ ([
  { kind: "turn", trigger: { kind: "turn", chat: "c2" }, kept: { kind: "turn", chat: "c2", turns: "changed", every: 1 }, when: TURNS },
  { kind: "task", trigger: { kind: "task", chat: "c2", on: ["done"] }, kept: { kind: "task", chat: "c2", on: ["done"] }, when: "when a task of Build the login flow's graph is done" },
  { kind: "ask", trigger: { kind: "ask" }, kept: { kind: "ask", afterMin: 10 }, when: "when a question of any chat waits 10 min for you" },
  { kind: "shell", trigger: { kind: "shell", chat: "this" }, kept: { kind: "shell", chat: "c1" }, when: "when a command of Lead fails" },
  { kind: "subagent", trigger: { kind: "subagent", chat: "chat:c3" }, kept: { kind: "subagent", chat: "c3" }, when: "when a sub-agent of Docs reports" },
  { kind: "commit", trigger: { kind: "commit", branch: "main", place: "packages/app" }, kept: { kind: "commit", branch: "main", place: "packages/app" }, when: "on each new commit on main in packages/app" },
  { kind: "connection", trigger: { kind: "connection", tool: "mcp__ci__list_runs", args: { branch: "main" }, everyMin: 30 }, kept: { kind: "connection", tool: "mcp__ci__list_runs", args: { branch: "main" }, everyMin: 30 }, when: "when ci's list_runs says something new, asked every 30 min" },
]);

describe("an agent proposes a watcher: each kind of trigger, through the tool", () => {
  for (const k of KINDS)
    test(`${k.kind}: kept Proposed with its trigger read; its answer is its sheet's words; nothing listens until the person's Switch on, then it does`, async () => {
      const w = worldOf();
      const r = await spaceRun(call({ title: `On a ${k.kind}`, trigger: k.trigger, text: "Look at what happened." }), w.atOf(), w.clock.at);
      assert.equal(r.ok, true, words(r));
      const kept = w.spaces.get("p1").routines.at(-1);
      assert.ok(kept, "the watcher");
      assert.deepEqual([kept.state, kept.trigger, kept.wakes, kept.when, kept.task, kept.seen ?? null, kept.madeIn], ["proposed", k.kept, "new", "", "Look at what happened.", null, "c1"]);
      assert.equal(triggerWords(/** @type {any} */ (kept.trigger), nameOf), k.when);
      assert.equal(words(r), answerOf(kept.id, `On a ${k.kind}`, `${k.when}, wakes a new chat each time. ${READS}`));
      assert.deepEqual(w.armed, ["arm"], "the sources set again");
      // Proposed, it listens to nothing: no branch watched, no tool asked, and what happens is not heard.
      w.clock.at = at(9, 30);
      assert.deepEqual([w.started, [...w.commits.watched()], [...w.connection.dueOf()]], [[], [], []]);
      await w.connection.askNow("p1", kept.id).catch(() => {});
      assert.deepEqual(w.asked, []);
      if (EVENTS[k.kind]) {
        assert.equal(w.events.publish(EVENTS[k.kind](w.clock.at)), 0);
        await w.events.settled();
        assert.equal(w.routine(kept.id).pending ?? null, null);
      }
      // The person's Switch on: from now it does.
      w.switchOn(kept.id);
      w.clock.at = at(10);
      if (EVENTS[k.kind]) {
        assert.equal(w.events.publish(EVENTS[k.kind](w.clock.at)), 1);
        await w.events.settled();
        assert.equal(w.routine(kept.id).pending?.events.length, 1, "heard, and waiting for its run");
      } else if (k.kind === "commit") {
        await w.commits.settled();
        assert.deepEqual(w.started, [[join(w.root, "packages", "app"), "main"]], "its branch watched, its place read against the project's folder");
      } else {
        assert.deepEqual([...w.connection.dueOf().keys()], [`p1\n${kept.id}`], "its next ask set");
        await w.connection.askNow("p1", kept.id);
        assert.deepEqual(w.asked, ["mcp__ci__list_runs"]);
      }
    });

  test("whom it wakes, what that may do and whom it may guide are said as its sheet says them; only one that starts a chat of its own runs on a model", async () => {
    const w = worldOf();
    const text = "Read its turn.";
    const chat = await spaceRun(call({ title: "Supervisor", trigger: { kind: "turn", chat: "c2" }, wakes: "chat", guides: true, text }), w.atOf(), w.clock.at);
    assert.equal(words(chat), answerOf("r1", "Supervisor", `${TURNS}. ${HELD}${GUIDE}${LIMIT}`, { runs: false }));
    assert.deepEqual([w.routine("r1").wakes, w.routine("r1").guides, w.routine("r1").writes], ["chat", true, false]);
    assert.ok(words(chat).includes(mayWords(w.routine("r1"), { nameOf })), "the sheet's own sentence, never a second wording");
    const you = await spaceRun(call({ title: "Waiting", trigger: { kind: "ask", afterMin: 20 }, wakes: "you", text }), w.atOf(), w.clock.at);
    assert.equal(words(you), answerOf("r2", "Waiting", "when a question of any chat waits 20 min for you. Runs nothing: what it hears is told to you, in Needs you", { runs: false }));
    const lane = await spaceRun(call({ title: "Fixer", trigger: { kind: "shell", chat: "c2" }, writes: true, guides: true, acts: ["mcp__linear__update_issue"], text }), w.atOf(), w.clock.at);
    assert.equal(words(lane), answerOf("r3", "Fixer", `when a command of Build the login flow fails, wakes a new chat each time. Writes in a lane of its own, a worktree made for each run: what it changed waits there for you, like any lane's; it acts through linear's update_issue without asking${GUIDE}`));
    // What happened names the chats the watcher names, as the chat that proposed it reads them.
    assert.equal(w.spaces.get("p1").log.at(-3)?.text, `Proposed a watcher: “Supervisor”, ${TURNS}, wakes Lead in a turn held to reading, and may guide Build the login flow. It listens only once you switch it on, in Watchers.`);
    // A routine at times answers as it did, and sets the timer again.
    const timed = spaceCall(call({ title: "Morning brief", when: "weekdays 09:00", text: "Read CI." }), w.atOf(), w.clock.at);
    assert.equal(words(timed), 'Routine r4 "Morning brief" (weekdays at 09:00, reading only) waits for the person\'s Switch on, on the card under this call and in the Space\'s Routines: nothing runs until they press it. Each run is a new chat of this project, its first message your text. It runs on agent/brain-model, the model you run on now, until the person chooses another on its sheet.');
    assert.equal(w.armed.length, 4);
  });

  // (fails before: yes — the tool answered that it runs now, a new chat; the runner's own refusal says "tells only you",
  // which an agent reads of itself)
  test("Run now of a watcher that tells only the person is refused in words that name the person: it runs nothing", async () => {
    const w = worldOf();
    await spaceRun(call({ title: "Waiting", trigger: { kind: "ask" }, wakes: "you" }), w.atOf(), w.clock.at);
    w.switchOn("r1");
    assert.equal(words(await spaceRun(call({ id: "r1", run: true }), w.atOf(), w.clock.at)), "Not run: “Waiting” tells only the person, in Needs you: it runs nothing, so it has no Run now.");
    assert.match(words(spaceGuide("routine")), /A watcher that tells only the person has no Run now/);
  });

  test("a coding agent's call proposes one the same; a call no engine runs is told so", async () => {
    const w = worldOf();
    const r = await w.viaMcp(call({ title: "Supervisor", trigger: { kind: "turn", chat: "c2" }, wakes: "chat", guides: true, text: "Read its turn." }));
    assert.equal(r.isError, undefined, r.text);
    assert.equal(r.text, answerOf("r1", "Supervisor", `${TURNS}. ${HELD}${GUIDE}${LIMIT}`, { runs: false }));
    assert.deepEqual([w.routine("r1").state, w.routine("r1").trigger, w.routine("r1").madeBy], ["proposed", { kind: "turn", chat: "c2", turns: "changed", every: 1 }, "Lead"]);
    assert.deepEqual(spaceCall(call({ title: "S", trigger: { kind: "turn", chat: "c2" }, text: "x" }), w.atOf()), { ok: false, error: "Not written: a watcher's trigger is checked against this project's chats, folders and connections, and is answered by Filament's own call of the tool." });
    assert.deepEqual(spaceCall(call({ guidance: "x" }), w.atOf()), { ok: false, error: "Not sent: a watcher's guidance goes to another chat, and is answered by Filament's own call of the tool." });
  });
});

describe("what a trigger names is this project's: its chat, its place, its tool", () => {
  test('chat: "this" is the calling chat, a tag or chat:<id> its id; one of another project, one that is not there, or one whose words are its own alone is refused with the chats it may name', async () => {
    const w = worldOf();
    const mine = await spaceRun(call({ title: "Mine", trigger: { kind: "turn", chat: "this" }, text: "x" }), w.atOf("c2"), w.clock.at);
    assert.equal(mine.ok, true, words(mine));
    assert.deepEqual([w.routine("r1").trigger, w.routine("r1").madeIn], [{ kind: "turn", chat: "c2", turns: "changed", every: 1 }, "c2"]);
    const tagged = await spaceRun(call({ title: "Tagged", trigger: { kind: "turn", chat: "[Build the login flow](chat:c2)" }, text: "x" }), w.atOf(), w.clock.at);
    assert.equal(tagged.ok, true, words(tagged));
    assert.equal(/** @type {any} */ (w.routine("r2").trigger).chat, "c2");
    const LIST = 'Its chats: Build the login flow (chat:c2), Docs (chat:c3); "this" is this chat, and {"action":"lanes"} lists them where they work.';
    for (const chat of ["x9", "c404", "c4"]) {
      const r = await spaceRun(call({ title: "Other", trigger: { kind: "turn", chat }, text: "x" }), w.atOf(), w.clock.at);
      assert.deepEqual(r, { ok: false, error: `Not written: “${chat}” is no chat of this project that this chat may read. ${LIST}` }, chat);
    }
    // Over MCP the same, and where no trigger needs a chat none is asked for.
    const over = await w.viaMcp(call({ title: "Other", trigger: { kind: "shell", chat: "x9" }, text: "x" }));
    assert.deepEqual([over.isError, over.text], [true, `Not written: “x9” is no chat of this project that this chat may read. ${LIST}`]);
    assert.equal(w.spaces.get("p1").routines.length, 2, "none made of a refusal");
    // A chat's id that reads as none is core's to refuse, with the call that teaches.
    assert.equal(words(await spaceRun(call({ title: "Odd", trigger: { kind: "turn", chat: 7 }, text: "x" }), w.atOf(), w.clock.at)), `Not written: this watcher's trigger: chat is a chat's id, as its tag [title](chat:<id>) and the space tool's lanes give it. ${TEACH}`);
  });

  test("a commit trigger's place is a folder of the project — its own, one it added, a worktree of its repository, or inside one —; any other is refused, as is one that is no folder", async () => {
    const w = worldOf();
    /** @param {string} place @param {Record<string, any>} [o] */
    const propose = (place, o = {}) => spaceRun(call({ title: "Commits", trigger: { kind: "commit", branch: "main", place }, text: "x" }), w.atOf("c1", o), w.clock.at);
    const OUT = (/** @type {string} */ place) => `Not written: place "${place}" is no folder of this project: its own folder, one it added or a worktree of its repository, or a folder inside one — a path not whole is read against the project's folder.`;
    assert.deepEqual(await propose(w.outside), { ok: false, error: OUT(w.outside) });
    assert.deepEqual(await propose("../elsewhere"), { ok: false, error: OUT("../elsewhere") });
    assert.deepEqual(await propose("packages/nope"), { ok: false, error: 'Not written: place "packages/nope" is no folder on this machine.' });
    assert.deepEqual(await propose("packages/app", { placeIn: undefined }), { ok: false, error: "Not written: a commit watcher's place cannot be checked in this Filament: leave it out, and it watches the project's folder." });
    assert.equal(w.spaces.get("p1").routines.length, 0);
    for (const place of [w.root, w.added, w.tree, "packages/app", join(w.root, "packages")]) assert.equal((await propose(place)).ok, true, place);
    assert.equal(/** @type {any} */ (w.routine("r4").trigger).place, "packages/app", "kept as it was named");
    // One that names no place watches the project's folder, and asks nothing of the fence.
    assert.equal((await spaceRun(call({ title: "Main", trigger: { kind: "commit", branch: "main" }, text: "x" }), w.atOf("c1", { placeIn: undefined }), w.clock.at)).ok, true);
  });

  test("a place kept from before that is outside the project is not followed: the watcher's trouble on its row, no branch watched; one inside is", async () => {
    const w = worldOf();
    /** A watcher as a Space kept it before the tool fenced its place. @param {string} place */
    const kept = (place) => {
      const f = routineFields({ title: "Commits", text: "x", trigger: { kind: "commit", branch: "main", place } }, { create: true });
      assert.ok(f.ok, JSON.stringify(f));
      const r = w.spaces.routinePropose("p1", f.fields, { chain: "c1", byName: "Lead", model: "m" });
      w.switchOn(r.id);
      return r.id;
    };
    const out = kept(w.outside);
    await w.commits.settled();
    assert.deepEqual([w.started, [...w.commits.watched()]], [[], []], "nothing of that folder is read");
    const why = `place "${w.outside}" is no folder of this project: its own folder, one it added or a worktree of its repository, or a folder inside one — a path not whole is read against the project's folder`;
    assert.equal(w.routine(out).seen?.trouble?.why, why);
    assert.equal(rowWords(w.routine(out), { now: w.clock.at, nameOf }).skipped, `its branch could not be read: ${clip(why, 120)}`, "said on its row");
    const inside = kept(join(w.tree, "."));
    await w.commits.settled();
    assert.deepEqual(w.started, [[w.tree, "main"]]);
    assert.equal(w.routine(inside).seen?.trouble ?? null, null);
    assert.equal(w.routine(out).seen?.trouble?.why, why, "its trouble stays");
  });

  test("a place's judgment that comes once its watcher was changed and switched on again is dropped: the place it has now is followed, with no trouble of the one before", async () => {
    const clock = { at: at(9) };
    const spaces = createSpaceStore({ dir: null, now: () => clock.at });
    const root = fresh("late");
    mkdirSync(join(root, "packages", "app"), { recursive: true });
    const outside = fresh("late-outside");
    /** Each read of the project's folders, answered as the test lets it. @type {(() => void)[]} */
    const reads = [];
    /** @type {string[][]} */
    const started = [];
    const commits = createCommitWatch({
      store: spaces, heard: () => 0, folderOf: () => root, chatOf: () => null, own: createOwnTimes(), now: () => clock.at,
      foldersOf: () => new Promise((ok) => void reads.push(() => ok([root]))),
      watch: /** @type {any} */ ((/** @type {string} */ place, /** @type {string} */ branch) => (started.push([place, branch]), { stop: () => {} })),
    });
    stops.push(() => commits.stop());
    const f = routineFields({ title: "Commits", text: "x", trigger: { kind: "commit", branch: "main", place: outside } }, { create: true });
    assert.ok(f.ok, JSON.stringify(f));
    const r = spaces.routinePropose("p1", f.fields, { chain: "c1", byName: "Lead", model: "m" });
    spaces.routineOn("p1", r.id);
    commits.sync();
    await new Promise((ok) => setImmediate(ok));
    assert.equal(reads.length, 1, "its place is being judged");
    // Its chat names a place inside, which switches it off; the person switches it on again: judged anew.
    const changed = routineFields({ trigger: { kind: "commit", branch: "main", place: "packages/app" } }, { create: false });
    assert.ok(changed.ok, JSON.stringify(changed));
    spaces.routinePropose("p1", changed.fields, { chain: "c1", byName: "Lead", model: "m" }, r.id);
    clock.at += 60_000;
    spaces.routineOn("p1", r.id);
    commits.sync();
    await new Promise((ok) => setImmediate(ok));
    assert.equal(reads.length, 2);
    for (const answer of reads) answer();
    await commits.settled();
    const now = spaces.get("p1").routines.find((x) => x.id === r.id);
    assert.equal(now?.seen?.trouble ?? null, null, "the place before is not its trouble");
    assert.deepEqual(started, [[join(root, "packages", "app"), "main"]]);
  });

  // (fails before: yes — x54, the hunt on x34: a commit watcher's place was looked at on the server's thread, the fence's
  // existsSync and realpathSync and a stat, which a share that went away holds as long as it does)
  test("a commit watcher's place on a drive or share that does not answer is its trouble in words, nothing looked at there on the server's thread, and it is judged again a moment later", async () => {
    const clock = { at: at(9) };
    const spaces = createSpaceStore({ dir: null, now: () => clock.at });
    const root = fresh("hung");
    const added = fresh("hung-added");
    let answers = false;
    /** @type {string[][]} */
    const started = [];
    const commits = createCommitWatch({
      store: spaces, heard: () => 0, folderOf: () => root, chatOf: () => null, own: createOwnTimes(), now: () => clock.at, retryMs: 50,
      // The server's: a folder it added that does not answer is left out of its folders.
      foldersOf: async () => (answers ? [root, added] : [root]),
      there: async (/** @type {string} */ p) => (p === added && !answers ? null : true),
      watch: /** @type {any} */ ((/** @type {string} */ place, /** @type {string} */ branch) => (started.push([place, branch]), { stop: () => {} })),
    });
    stops.push(() => commits.stop());
    const f = routineFields({ title: "Commits", text: "x", trigger: { kind: "commit", branch: "main", place: added } }, { create: true });
    assert.ok(f.ok, JSON.stringify(f));
    const r = spaces.routinePropose("p1", f.fields, { chain: "c1", byName: "Lead", model: "m" });
    spaces.routineOn("p1", r.id);
    commits.sync();
    await commits.settled();
    const trouble = () => spaces.get("p1").routines.find((x) => x.id === r.id)?.seen?.trouble?.why ?? null;
    assert.equal(trouble(), `place "${added}" cannot be checked: its drive or share does not answer`);
    assert.deepEqual(started, []);
    // The agent that proposes it is told the same.
    assert.deepEqual(await placeAmongSoon([root], added, async (p) => (p === added ? null : true)), { ok: false, error: `place "${added}" cannot be checked: its drive or share does not answer`, unanswered: true });
    answers = true;
    await until(() => started.length > 0, "its branch watched once its share answers", { timeoutMs: 5000 });
    assert.deepEqual(started, [[added, "main"]]);
  });

  test("a connection trigger's tool is one the project's chats have, switched on, that its server marks read-only: any other is refused as it is proposed", async () => {
    const w = worldOf();
    /** @param {string} tool @param {Record<string, any>} [o] */
    const propose = (tool, o = {}) => spaceRun(call({ title: "Runs", trigger: { kind: "connection", tool }, text: "x" }), w.atOf("c1", o), w.clock.at);
    assert.deepEqual(await propose("mcp__ci__rerun"), { ok: false, error: "Not written: ci does not say rerun only reads: a watcher only reads, so it is not asked." });
    assert.deepEqual(await propose("mcp__ci__nope"), { ok: false, error: "Not written: ci has no tool nope." });
    assert.deepEqual(await propose("mcp__slack__list_messages"), { ok: false, error: "Not written: slack is no MCP server of this project's chats (Library › Plugins & Connectors, for all chats or this project)." });
    assert.deepEqual(await propose("mcp__off__list_runs"), { ok: false, error: "Not written: off is switched off for this project (Library › Plugins & Connectors)." });
    assert.deepEqual(await propose("mcp__ci__list_runs", { toolReads: undefined }), { ok: false, error: "Not written: this project's connections are not wired in this Filament." });
    assert.equal(w.spaces.get("p1").routines.length, 0);
    const ok = await propose("mcp__ci__list_runs");
    assert.equal(ok.ok, true, words(ok));
    assert.deepEqual(w.routine("r1").trigger, { kind: "connection", tool: "mcp__ci__list_runs", everyMin: 15 });
  });
});

describe("fields that cannot stand together are refused through the tool, with the call that teaches", () => {
  test("a new one: guides with no chat to guide, a time and a trigger, a watcher's fields on a routine at times, a chat that would guide itself, writes that is no yes or no", async () => {
    const w = worldOf();
    /** @param {Record<string, any>} o @param {string} [chain] */
    const refused = async (o, chain = "c1") => {
      const r = await spaceRun(call({ title: "W", text: "x", ...o }), w.atOf(chain), w.clock.at);
      assert.equal(r.ok, false, JSON.stringify(o));
      return words(r);
    };
    assert.equal(await refused({ trigger: { kind: "commit", branch: "main" }, guides: true }), `Not written: guides needs a trigger that names a chat — a turn, task, ask, shell or subagent trigger with its chat —: that chat is the one this watcher may guide. ${TEACH}`);
    assert.equal(await refused({ trigger: { kind: "turn", chat: "c2" }, when: "daily 09:00" }), `Not written: a routine runs at times (when) or on events (trigger), never both. ${TEACH}`);
    assert.equal(await refused({ trigger: { kind: "turn", chat: "c2" }, wakes: "chat", acts: ["mcp__gmail__archive"] }), `Not written: acts belong to a run in a chat of its own (wakes: "new"): a watcher that wakes its chat reads only, or with writes: true works as that chat does. ${TEACH}`);
    assert.equal(await refused({ trigger: { kind: "turn", chat: "c2" }, wakes: "you", writes: true }), `Not written: a watcher that tells only the person (wakes: "you") runs nothing: it takes no writes: true. ${TEACH}`);
    assert.equal(await refused({ when: "daily 09:00", wakes: "chat" }), `Not written: wakes is a watcher's: a routine at times runs as a new chat each time. ${TEACH}`);
    assert.equal(await refused({ when: "daily 09:00", guides: true }), `Not written: guides is a watcher's: a routine at times watches no chat it could guide. ${TEACH}`);
    // A chat never guides itself: one that wakes the chat it watches has nobody to guide.
    const SELF = `Not written: guides: true with wakes: "chat" needs a trigger that names another chat: this watcher would wake the chat it watches, and a chat never guides itself — wakes: "new" reviews this chat from a chat of its own. ${TEACH}`;
    assert.equal(await refused({ trigger: { kind: "turn", chat: "this" }, wakes: "chat", guides: true }), SELF);
    assert.equal(await refused({ trigger: { kind: "turn", chat: "c2" }, wakes: "chat", guides: true }, "c2"), SELF);
    // What writes: true means, by whom it wakes.
    assert.equal(await refused({ trigger: { kind: "turn", chat: "c2" }, wakes: "chat", writes: "yes" }), `Not written: writes is true or false: true lets its turn work as the chat it wakes works. ${TEACH}`);
    assert.equal(await refused({ trigger: { kind: "turn", chat: "c2" }, writes: "yes" }), `Not written: writes is true or false: true runs it in a worktree of its own. ${TEACH}`);
    assert.equal(w.spaces.get("p1").routines.length, 0, "none made of a refusal");
    const over = await w.viaMcp(call({ title: "W", text: "x", trigger: { kind: "commit", branch: "main" }, guides: true }));
    assert.deepEqual([over.isError, over.text.endsWith(TEACH)], [true, true], over.text);
  });

  test("a change is checked on the record it makes, and refused the same way, nothing changed", async () => {
    const w = worldOf();
    await spaceRun(call({ title: "Supervisor", trigger: { kind: "turn", chat: "c2" }, wakes: "chat", guides: true, text: "Read its turn." }), w.atOf(), w.clock.at);
    const was = JSON.stringify(w.routine("r1"));
    assert.deepEqual(spaceCall(call({ id: "r1", wakes: "you" }), w.atOf()), { ok: false, error: `Not written: a watcher that tells only the person (wakes: "you") runs nothing: it takes no guides: true. ${TEACH}` });
    assert.deepEqual(await spaceRun(call({ id: "r1", trigger: { kind: "commit", branch: "main" } }), w.atOf(), w.clock.at), { ok: false, error: `Not written: guides needs a trigger that names a chat — a turn, task, ask, shell or subagent trigger with its chat —: that chat is the one this watcher may guide. ${TEACH}` });
    assert.deepEqual(await spaceRun(call({ id: "r1", trigger: { kind: "turn", chat: "this" } }), w.atOf(), w.clock.at), { ok: false, error: `Not written: guides: true with wakes: "chat" needs a trigger that names another chat: this watcher would wake the chat it watches, and a chat never guides itself — wakes: "new" reviews this chat from a chat of its own. ${TEACH}` });
    assert.deepEqual(spaceCall(call({ id: "r1", writes: "yes" }), w.atOf()), { ok: false, error: `Not written: writes is true or false: true runs it in a worktree of its own — or, for a watcher that wakes its chat, lets its turn work as that chat works. ${TEACH}` });
    assert.equal(JSON.stringify(w.routine("r1")), was);
    // Another chat's is the store's to refuse, in its words.
    assert.deepEqual(spaceCall(call({ id: "r1", guides: false }), w.atOf("c2")), { ok: false, error: "r1 is Lead's routine: propose one of your own." });
  });
});

describe("a change of a watcher that is on", () => {
  test("switches it off until the person switches it on again, and its source stops: the sources are set again", async () => {
    const w = worldOf();
    await spaceRun(call({ title: "Commits", trigger: { kind: "commit", branch: "main" }, text: "Review what landed." }), w.atOf(), w.clock.at);
    w.switchOn("r1");
    await w.commits.settled();
    assert.deepEqual([w.started, w.routine("r1").state, !!w.routine("r1").seen], [[[w.root, "main"]], "on", true]);
    const n = w.armed.length;
    const r = await spaceRun(call({ id: "r1", trigger: { kind: "commit", branch: "release" }, guides: false }), w.atOf(), w.clock.at);
    assert.equal(words(r), answerOf("r1", "Commits", `on each new commit on release, wakes a new chat each time. ${READS}`, { changed: true, off: true }));
    assert.deepEqual([w.routine("r1").state, w.routine("r1").seen ?? null, w.routine("r1").trigger], ["proposed", null, { kind: "commit", branch: "release" }]);
    assert.equal(w.armed.length, n + 1, "arm called");
    assert.deepEqual([w.let_go, [...w.commits.watched()]], [[[w.root, "main"]], []], "its branch is watched no more");
    // A change that names no trigger goes the tool's plain road, and stops what listened as well.
    w.switchOn("r1");
    await w.commits.settled();
    assert.equal(w.started.length, 2);
    const again = spaceCall(call({ id: "r1", text: "Review what landed, briefly." }), w.atOf(), w.clock.at);
    assert.ok(again.ok && again.text.includes("is changed and waits") && again.text.includes("It was on: it is off now"), words(again));
    assert.deepEqual([w.routine("r1").state, [...w.commits.watched()]], ["proposed", []]);
  });
});

/** Each call the guide's routine topic teaches, as JSON: every `{"action":"routine"…}` of its text, read to its closing brace. */
function taught() {
  const text = /** @type {any} */ (spaceGuide("routine")).text;
  /** @type {any[]} */
  const out = [];
  for (let i = text.indexOf('{"action":"routine"'); i >= 0; i = text.indexOf('{"action":"routine"', i + 1)) {
    let depth = 0;
    let quoted = false;
    let j = i;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (quoted) {
        if (ch === "\\") j++;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) break;
    }
    out.push(JSON.parse(text.slice(i, j + 1)));
  }
  return out;
}

describe("the guide teaches a watcher, and no call the tool refuses", () => {
  test("the supervisor's two calls, from the chat to be reviewed and from a chat that reviews another, are each proposed as the guide gives them", async () => {
    const w = worldOf();
    const [own, other] = taught().filter((c) => c.with?.title === "Supervisor");
    assert.deepEqual(own, JSON.parse(SUPERVISOR));
    assert.deepEqual(other, { action: "routine", with: { ...own.with, trigger: { kind: "turn", chat: "<its id>" }, wakes: "chat" } });
    // From the chat that should be reviewed, through Filament's loop's door.
    const one = await spaceRun(own, w.atOf("c2"), w.clock.at);
    assert.equal(one.ok, true, words(one));
    assert.deepEqual([w.routine("r1").trigger, w.routine("r1").wakes, w.routine("r1").guides, w.routine("r1").madeIn, w.routine("r1").task], [{ kind: "turn", chat: "c2", turns: "changed", every: 1 }, "new", true, "c2", own.with.text]);
    // From a chat that reviews another, through a coding agent's.
    const two = await w.viaMcp({ ...other, with: { ...other.with, trigger: { ...other.with.trigger, chat: "c2" } } }, "c1");
    assert.equal(two.isError, undefined, two.text);
    assert.deepEqual([w.routine("r2").trigger, w.routine("r2").wakes, w.routine("r2").guides, w.routine("r2").madeIn], [{ kind: "turn", chat: "c2", turns: "changed", every: 1 }, "chat", true, "c1"]);
    // Each reads rightly in the Space's read: to the chat it guides, and to the chat that proposed it.
    const read = (/** @type {string} */ chain) => words(spaceCall({ action: "read" }, w.atOf(chain), w.clock.at));
    assert.ok(read("c2").includes(`- r1 "Supervisor" (yours), ${TURNS}, wakes a new chat each time, reads only, may guide you: proposed: it waits for the person's Switch on`), read("c2"));
    assert.ok(read("c2").includes(`- r2 "Supervisor" (by Lead), ${TURNS}, wakes Lead in a turn held to reading, may guide you: proposed`), read("c2"));
    assert.ok(read("c1").includes(`- r1 "Supervisor" (by Build the login flow), ${TURNS}, wakes a new chat each time, reads only, may guide Build the login flow: proposed`), read("c1"));
    assert.ok(read("c1").includes(`- r2 "Supervisor" (yours), ${TURNS}, wakes you in a turn held to reading, may guide Build the login flow: proposed`), read("c1"));
  });

  test("one call for each kind of trigger, each taken as it is given; every other call of the topic reads as JSON", async () => {
    const w = worldOf();
    const calls = taught();
    const watchers = calls.filter((c) => c.with?.trigger);
    assert.deepEqual([...new Set(watchers.map((c) => c.with.trigger.kind))].sort(), [...TRIGGER_KINDS].sort(), "a call for each kind");
    for (const c of watchers) {
      const chat = c.with.trigger.chat === "<its id>" ? { chat: "c2" } : {};
      const r = await spaceRun({ ...c, with: { ...c.with, trigger: { ...c.with.trigger, ...chat } } }, w.atOf("c1", { toolReads: async () => ({ ok: true }) }), w.clock.at);
      // The supervisor from the chat to be reviewed wakes a new chat, so any chat may propose it of itself.
      assert.equal(r.ok, true, `${JSON.stringify(c)}: ${words(r)}`);
    }
    assert.equal(w.spaces.get("p1").routines.length, watchers.length);
    const timed = calls.find((c) => c.with?.when);
    assert.equal(spaceCall(timed, w.atOf(), w.clock.at).ok, true, "the routine at times");
    assert.ok(calls.some((c) => typeof c.with?.guidance === "string") && calls.some((c) => c.with?.run === true) && calls.some((c) => c.with?.pause) && calls.some((c) => c.with?.pauseAll), "guidance, Run now, a pause and Pause all");
  });

  test("its words: both kinds, whom a watcher wakes and what each may do, guidance and its answers, a letter, the limits; untrue lines made true", () => {
    const g = /** @type {any} */ (spaceGuide("routine")).text;
    assert.match(g, /^## routine — work an agent does by itself\n/);
    for (const said of [
      'wakes: whom it wakes. "new" (the default): a new chat each time',
      '"chat": the chat that proposes it, in a turn of Filament\'s own held to reading: it changes no file and runs no command that changes one, whatever that chat\'s own permissions',
      // No agent runs; a program its trigger runs still does (watch-words.test.js pins the line whole).
      '"you": only the person, in Needs you: no agent runs',
      "guides: true lets it guide the chat its trigger names",
      '{"action":"routine","with":{"guidance":"',
      "a note into its running turn",
      "a turn of its own where the chat is at rest",
      `past ${GUIDES_PER_MESSAGE} for each message of the person's there, it is held in Needs you for their Send it`,
      "a letter (the envelope tool)",
      `${WATCH_WAKES_HOUR} times an hour at most`,
      "never instructions",
      "A watcher that wakes its chat has no run: there, true lets its turn work as that chat works",
      "a watcher that wakes its chat looks there instead, in a turn of Filament's own",
      // (fails before: yes — the turn trigger named "all" and never said when to choose it: an agent asked for a review
      // of every turn left the default, which hears no turn that only talks)
      'every: 1 by default, 3 wakes it at every third such turn. Choose "all" where the person asked for every turn, or where it is to review turns that only talk, which "changed" never hears.',
    ])
      assert.ok(g.includes(said), `${said}\n---\n${g}`);
    assert.ok(!g.includes("Run now — one on runs once, at once, as the person's Run now: a new chat, its row saying you started it"), "Run now of a watcher that wakes its chat starts no new chat");
    const index = /** @type {any} */ (spaceGuide(null)).text;
    assert.match(index, /\n- routine: work an agent does by itself at a time, each run a new chat, or as a watcher when something happens/);
    assert.deepEqual(spaceGuide("watchers"), spaceGuide("routine"), "a watcher is the routine topic's");
    assert.deepEqual(spaceGuide("guidance"), spaceGuide("routine"));
    assert.ok(/** @type {any} */ (spaceGuide("lanes")).text.includes("(chat:<id>)"), "the lanes give a chat's id");
  });
});

describe("what a woken agent reads of guiding (core)", () => {
  const o = { project: "app", when: "after each turn", heard: null };
  const HOW = (/** @type {string} */ id) => `to guide the chat it watches, which the person lets this watcher do, call the space tool with {"action":"routine","with":{"id":"${id}","guidance":"what, and why, in a few lines"}} — a review that finds nothing to say ends in one line and sends nothing`;

  test("a wake's block says how where the watcher guides, with the call whole; where it does not, nothing of guidance", () => {
    const base = { id: "r3", title: "Supervisor", task: "Say how it drifted.", writes: false, trigger: /** @type {any} */ ({ kind: "turn", chat: "c2", turns: "changed", every: 1 }) };
    const guides = wakeWords({ ...base, guides: true }, o).split("\n\n")[0];
    assert.ok(guides.startsWith(WAKE_HEAD), guides);
    assert.ok(guides.endsWith(`never the person's. This turn reads only: Filament refuses what would change a file; ${HOW("r3")}; the person's word comes before the watcher's.]`), guides);
    const works = wakeWords({ ...base, writes: true, guides: true }, o).split("\n\n")[0];
    assert.ok(works.endsWith(`This turn works as this chat works; ${HOW("r3")}; the person's word comes before the watcher's.]`), works);
    for (const none of [wakeWords(base, o), wakeWords({ ...base, guides: false }, o), wakeWords({ ...base, guides: true, trigger: /** @type {any} */ ({ kind: "commit", branch: "main" }) }, o)]) {
      assert.match(none.split("\n\n")[0], /This turn reads only: Filament refuses what would change a file; the person's word comes before the watcher's\.\]$/);
      assert.ok(!/guid/i.test(none), none);
    }
  });

  test("a run's first message the same, after what it may do", () => {
    const base = { id: "r7", title: "Supervisor", task: "Say how it drifted.", writes: false, trigger: /** @type {any} */ ({ kind: "turn", chat: "c2", turns: "changed", every: 1 }) };
    const said = HOW("r7");
    const guides = runWords({ ...base, guides: true }, { ...o, by: "event" });
    assert.ok(guides.startsWith(`This is “Supervisor”, a watcher of app's Space, woken as what it watches happened (after each turn): a chat of its own. You read only: change no file, and send nothing. What the person should see goes in your answer; anything that would go out is a draft (the space tool's draft), which only the person sends. ${said[0].toUpperCase()}${said.slice(1)}.\n\nSay how it drifted.`), guides);
    const none = runWords(base, { ...o, by: "event" });
    assert.ok(none.includes("which only the person sends.\n\nSay how it drifted.") && !/guid/i.test(none), none);
    assert.ok(!/guid/i.test(runWords({ title: "Morning brief", task: "Read CI.", writes: false }, { project: "app", when: "weekdays at 09:00", by: "time" })), "a routine at times");
  });
});

describe("the lanes give the ids a trigger names a chat by", () => {
  test("each other chat with its id; none for the asking chat, a routine's run, or a chat whose words are its own alone", () => {
    /** @param {string} id @param {string} name @param {Record<string, any>} [o] */
    const chat = (id, name, o = {}) => ({ id, name, home: true, working: false, lastAt: null, routine: false, ...o });
    const lane = { path: "/r", name: "main", main: true, ok: true, missing: false, error: null, branch: "main", base: null, facts: "read", files: [], more: 0, filesError: null };
    const chats = [chat("c1", "Lead"), chat("c2", "Build the login flow"), chat("c4", "an untitled chat"), chat("run1", "Supervisor · Mon 26 Oct", { routine: true })];
    const text = lanesWords({ ok: true, folder: "/r", lanes: [{ ...lane, chats }], left: 0, shared: [] }, { self: "c1", now: at(9), apart: (c) => c === "c4" });
    assert.ok(text.includes("  chats: Lead (you) — idle; Build the login flow (chat:c2) — idle; an untitled chat — idle; Supervisor · Mon 26 Oct (a routine's run) — idle"), text);
  });
});

describe("what Fix… starts a chat with, by kind (the page's words)", () => {
  test("a failed watcher is called a watcher, fixed by its words, what wakes it or what it needs; a routine at times as it was", () => {
    assert.equal(
      routineFixWords({ title: "Supervisor", why: "the chat it wakes needs compacting", ran: "woken by what it watches at 09:10", watcher: true }, "app"),
      "“Supervisor”, a watcher of app's Space, failed (woken by what it watches at 09:10): the chat it wakes needs compacting. Find out why, and fix it — its words, what it watches, or what it needs; propose the watcher again where it changes: ",
    );
    assert.equal(
      routineFixWords({ title: "Morning brief", why: "GitHub: sign-in expired", ran: "today 09:00" }, "app"),
      "“Morning brief”, a routine of app's Space, failed (today 09:00): GitHub: sign-in expired. Find out why, and fix it — its words, its time, or what it needs; propose the routine again where it changes: ",
    );
  });
});

/** A chat's newest turn as the sessions service says it. @param {any} [o] */
const turnOf = (o = {}) => ({ n: 3, final: true, text: "Earlier reply.", cut: false, failed: false, why: "", stopped: false, ...o });
const DRIFT = "You drifted: the parser, not the lexer.";

/**
 * The space tool over a real guidance module (app/watchers/guidance.js), whose chats, turns and counts are the test's:
 * a watcher of c1's that wakes c1 and may guide c2, on; `run`, one that wakes a new chat, with run1 a run of it.
 */
function guideWorld() {
  const clock = { at: at(9) };
  const now = () => clock.at;
  const spaces = createSpaceStore({ dir: null, now });
  /** @type {Map<string, any>} */
  const chats = new Map(["c1", "c2", "c3", "run1"].map((c) => [c, { busy: false, asking: false, last: turnOf() }]));
  /** @type {[string, any][]} */
  const posted = [];
  /** @type {[string, string][]} */
  const steered = [];
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {Map<string, { project: string, id: string }>} */
  const runs = new Map();
  let n = 0;
  const guidance = createGuidance({
    spaces,
    sessions: { besideFacts: (id) => chats.get(id) ?? (() => { throw new Error("no such session"); })() },
    letters: {
      guideSent: (c, most) => (counts.get(c) || 0) < most && !!counts.set(c, (counts.get(c) || 0) + 1),
      guideDropped: (c) => void counts.set(c, Math.max(0, (counts.get(c) || 0) - 1)),
    },
    reach: {
      busy: (c) => !!chats.get(c)?.busy,
      steer: (c, text) => (steered.push([c, text]), { ok: true, run: `run-${c}`, id: `s${++n}` }),
      post: async (c, body) => (posted.push([c, body]), { status: 200, body: null, turn: 4 }),
    },
    runOf: (c) => runs.get(c) || null,
    projectOf: () => "p1",
    projectName: () => "app",
    nameOf,
    now,
    settleMs: 1,
  });
  stops.push(() => guidance.stop());
  /** A watcher of `from`'s that may guide c2, switched on. @param {Record<string, any>} [o] @param {string} [from] */
  const on = (o = {}, from = "c1") => {
    const f = routineFields({ title: "Supervisor", text: "Read its turn.", wakes: "chat", guides: true, trigger: { kind: "turn", chat: "c2" }, ...o }, { create: true });
    assert.ok(f.ok, JSON.stringify(f));
    const r = spaces.routinePropose("p1", f.fields, { chain: from, byName: nameOf(from), model: "m", nameOf });
    spaces.routineOn("p1", r.id);
    return r.id;
  };
  const deps = { store: spaces, projectOf: () => "p1", nameOf, on: () => true, routines: /** @type {any} */ ({ runNow: async () => "", arm: () => {} }), runOf: () => null, guidance };
  /** @param {string} chain @param {Record<string, any>} [o] @returns {import("../src/app/agent/space.js").SpaceAt} */
  const atOf = (chain, o = {}) => ({ store: spaces, project: "p1", chain, name: null, ...readerNames({ nameOf }, chain), on: () => true, runOf: () => null, guidance, ...o });
  const mcp = createAgentTools(/** @type {any} */ ({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null, space: deps }));
  /** @param {any} c @param {string} chain */
  const viaMcp = (c, chain) => mcp.call("space", c, /** @type {any} */ ({ cwd: "/r", chain, permit: null }));
  const kept = () => spaces.guidance("p1").map((g) => [g.from, g.to, g.text, g.state, g.how ?? null]);
  return { spaces, chats, posted, steered, counts, runs, guidance, on, atOf, viaMcp, kept };
}

describe("a watcher's agent sends guidance through the tool", () => {
  test("from the chat its watcher wakes, through Filament's loop's door: the guidance goes, and the answer is the guidance's own words", async () => {
    const w = guideWorld();
    const id = w.on();
    const r = await spaceRun(call({ guidance: DRIFT }), w.atOf("c1"));
    assert.deepEqual(r, { ok: true, text: "Sent to Build the login flow as a turn of its own: the chat was at rest." });
    assert.deepEqual([w.posted.length, w.posted[0][0], w.posted[0][1].by], [1, "c2", "guide"]);
    assert.ok(String(w.posted[0][1].content[0].text).startsWith(`${GUIDE_HEAD} “Supervisor” (${id}) of app's Space`) && String(w.posted[0][1].content[0].text).endsWith(`]\n\n${DRIFT}`));
    // A turn of its own is read as it begins.
    assert.deepEqual(w.kept(), [["c1", "c2", DRIFT, "read", "turn"]]);
    // At work, a note into its turn.
    w.chats.set("c2", { busy: true, asking: false, last: turnOf({ final: false }) });
    assert.deepEqual(await spaceRun(call({ id, guidance: "And the tests." }), w.atOf("c1")), { ok: true, text: "Sent to Build the login flow as a note into its running turn: its agent reads it at its next step." });
    assert.deepEqual(w.steered, [["c2", "And the tests."]]);
  });

  test("from a run of it, through a coding agent's door; each answer as guidance gives it — it waits, it is held past the cap, it is refused", async () => {
    const w = guideWorld();
    const id = w.on({ wakes: "new" });
    w.runs.set("run1", { project: "p1", id });
    const sent = await w.viaMcp(call({ guidance: DRIFT }), "run1");
    assert.deepEqual([sent.isError, sent.text], [undefined, "Sent to Build the login flow as a turn of its own: the chat was at rest."]);
    assert.deepEqual(w.kept(), [["run1", "c2", DRIFT, "read", "turn"]]);
    // A question of the watched chat waits for the person: kept, and said so — no error, it will go.
    w.chats.set("c2", { busy: false, asking: true, last: turnOf() });
    const waits = await w.viaMcp(call({ guidance: "Second." }), "run1");
    assert.deepEqual([waits.isError, waits.text], [undefined, "Not sent yet: a question of Build the login flow's waits for the person. Filament keeps it: it goes as that chat next lets go, or into its next turn where that begins first."]);
    // Past the cap for the person's last message: held for them.
    w.chats.set("c2", { busy: false, asking: false, last: turnOf() });
    w.counts.set("c2", GUIDES_PER_MESSAGE);
    const held = await w.viaMcp(call({ guidance: "Fourth." }), "run1");
    assert.deepEqual([held.isError, held.text], [undefined, `Not sent: ${GUIDES_PER_MESSAGE} went to Build the login flow since the person last wrote there, the most Filament sends by itself. It is held for the person in Needs you, who may send it.`]);
    assert.equal(w.spaces.get("p1").needs.some((x) => x.kind === "routine" && x.routine?.guide?.text === "Fourth."), true, "its row in Needs you");
    // Refused, in guidance's words: a chat that is no watcher's, words that are none, a watcher that may not guide.
    const none = await w.viaMcp(call({ guidance: DRIFT }), "c3");
    assert.deepEqual([none.isError, none.text], [true, "Not sent: this chat is no watcher's: only the chat a watcher wakes, or a run of it, guides the chat that watcher watches."]);
    assert.deepEqual(await spaceRun(call({ guidance: "  " }), w.atOf("run1")), { ok: false, error: "Not sent: the guidance has no words." });
    assert.deepEqual(await spaceRun(call({ guidance: { text: DRIFT } }), w.atOf("run1")), { ok: false, error: 'Not sent: guidance is the words to send, as text. The call: {"action":"routine","with":{"guidance":"The turn says the tests pass, and test/login.test.js is skipped: run it, or say so."}} — {"action":"guide","topic":"routine"} gives every field.' });
    w.spaces.routinePause("p1", id, true);
    assert.deepEqual(await spaceRun(call({ guidance: DRIFT }), w.atOf("run1")), { ok: false, error: "Not sent: “Supervisor” is paused: it guides again once the person resumes it." });
    assert.deepEqual(await spaceRun(call({ guidance: DRIFT }), w.atOf("run1", { guidance: null })), { ok: false, error: "Not sent: guidance is not wired in this Filament." });
  });

  test("a chat that speaks for two watchers that may guide says which, by its id: with none named it is refused, naming them", async () => {
    const w = guideWorld();
    const one = w.on();
    const two = w.on({ title: "Second look", trigger: { kind: "shell", chat: "c3" } });
    const r = await spaceRun(call({ guidance: DRIFT }), w.atOf("c1"));
    assert.deepEqual(r, { ok: false, error: `Not sent: this chat speaks for 2 watchers that may guide: “Supervisor” (${one}), “Second look” (${two}). Say which, by its id.` });
    assert.equal(w.posted.length, 0);
    assert.deepEqual(await spaceRun(call({ id: two, guidance: DRIFT }), w.atOf("c1")), { ok: true, text: "Sent to Docs as a turn of its own: the chat was at rest." });
    assert.deepEqual(w.posted.map((p) => p[0]), ["c3"]);
    const over = await w.viaMcp(call({ id: "r9", guidance: DRIFT }), "c1");
    assert.deepEqual([over.isError, over.text], [true, "Not sent: there is no watcher “r9” that wakes this chat, or that this chat is a run of."]);
  });
});

/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : Array.isArray(m?.content) ? m.content.map((/** @type {any} */ b) => b?.text || "").join("\n") : "");
/** A request's newest tool result's text, by its call's id. @param {any} body @param {string} id */
const resultOf = (body, id) => {
  const b = (body?.messages?.at(-1)?.content || []).find?.((/** @type {any} */ x) => x?.type === "tool_result" && x.tool_use_id === id);
  if (!b) return null;
  return typeof b.content === "string" ? b.content : (b.content || []).map((/** @type {any} */ x) => x.text || "").join("");
};
/** The supervisor from a chat that reviews another, as the guide gives it, of the chat `x`; its words open with `mark`. @param {string} x @param {string} mark */
const reviewerOf = (x, mark) => {
  const c = taught().find((t) => t.with?.title === "Supervisor" && t.with.wakes === "chat");
  return { ...c, with: { ...c.with, trigger: { ...c.with.trigger, chat: x }, text: `${mark} ${c.with.text}` } };
};

describe("on a real Filament, Filament's own agent: it proposes the supervisor, and its wake's turn, held to reading, sends guidance", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  before(async () => {
    root = fresh("loop");
    writeFileSync(join(root, "README.md"), "app\n");
    up = await fakeUpstream(async (/** @type {any} */ c) => {
      const body = c.body || {};
      const model = String(body.model || "");
      if (!(body.tools || []).length) return anthropicReply("A title", { model });
      /** @param {string} id @param {string} name @param {any} input */
      const use = (id, name, input) => anthropicReply("", { model, stop: "tool_use", blocks: [{ type: "tool_use", id, name, input }], usage: { input_tokens: 30, output_tokens: 7 } });
      if (resultOf(body, "pp1") !== null || resultOf(body, "po1") !== null) return anthropicReply("Proposed.", { model });
      if (resultOf(body, "gg1") !== null || resultOf(body, "rg1") !== null) return anthropicReply("Looked.", { model });
      // Woken, it tries to write — which its turn refuses — and then guides.
      if (resultOf(body, "gw1") !== null) return use("gg1", "space", { action: "routine", with: { guidance: DRIFT } });
      const said = textOf([...(body.messages || [])].reverse().find((/** @type {any} */ m) => m.role === "user" && textOf(m).trim()));
      if (said.includes(WAKE_HEAD) && said.includes("GUIDE-NOW")) return use("gw1", "write", { path: "woken.txt", content: "x" });
      // A run of the supervisor a chat proposed of itself: it guides the chat it watches.
      if (said.startsWith("This is “Supervisor”, a watcher of") && said.includes("RUN-GUIDE")) return use("rg1", "space", { action: "routine", with: { guidance: DRIFT } });
      if (said.includes("PROPOSE OWN")) {
        const own = JSON.parse(SUPERVISOR);
        return use("po1", "space", { ...own, with: { ...own.with, text: `RUN-GUIDE: ${own.with.text}` } });
      }
      const watch = /PROPOSE WATCH:(\S+)/.exec(said);
      if (watch) return use("pp1", "space", reviewerOf(watch[1], "GUIDE-NOW:"));
      if (said.includes(GUIDE_HEAD)) return anthropicReply("Guided: understood.", { model });
      return anthropicReply("Okay.", { model });
    });
    shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });
  const chat = async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content */
  const say = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { stream: false, content } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** What a call of the model's was answered with. @param {string} id */
  const answered = (id) => up.received.map((c) => resultOf(c.body, id)).find((x) => x !== null);

  test("proposed through the tool as the guide teaches it; switched on and woken, its turn's write is refused and its guidance reaches the chat it watches", async () => {
    const lead = await chat();
    const x = await chat();
    const project = String(shim.app.memory.archive?.getChain(lead)?.project_id || "");
    assert.ok(project, "the chats are of a project");
    const spaces = shim.app.spaces;
    spaces.make(project);
    await say(x, "Hello.");
    await say(lead, `PROPOSE WATCH:${x}`);
    const r = spaces.get(project).routines[0];
    assert.ok(r, String(answered("pp1")));
    assert.match(String(answered("pp1")), new RegExp(`^Watcher ${r.id} "Supervisor" waits for the person's Switch on, on the card under this call and in the Space's Watchers: nothing listens until they press it\\. Its sheet says to the person: “after each turn of .+ that changes files or marks tasks done\\. A turn in .+, held to reading: `));
    assert.deepEqual([r.state, r.trigger, r.wakes, r.guides, r.madeIn], ["proposed", { kind: "turn", chat: x, turns: "changed", every: 1 }, "chat", true, lead]);
    // The person's presses, as the page sends them: Switch on, then Run now.
    const routes = `/api/space/${encodeURIComponent(project)}/routines/${encodeURIComponent(r.id)}`;
    const on = await shim.api(`${routes}/on`, { method: "POST", body: { at: r.at } });
    assert.equal(on.status, 200, await on.clone().text());
    const ran = await shim.api(`${routes}/run`, { method: "POST", body: {} });
    assert.equal(ran.status, 200, await ran.clone().text());
    const now = () => spaces.get(project).routines[0];
    await until(() => now().last?.state === "done" || null, "the watcher's turn ended", { timeoutMs: 30_000 });
    // The wake said how to guide, with the call whole; the turn was held to reading, and its guidance went all the same.
    const wake = up.received.map((c) => textOf([...(c.body?.messages || [])].reverse().find((/** @type {any} */ m) => m.role === "user" && textOf(m).trim()))).find((t) => t.includes(WAKE_HEAD)) || "";
    assert.ok(wake.split("\n\n")[0].endsWith(`This turn reads only: Filament refuses what would change a file; to guide the chat it watches, which the person lets this watcher do, call the space tool with {"action":"routine","with":{"id":"${r.id}","guidance":"what, and why, in a few lines"}} — a review that finds nothing to say ends in one line and sends nothing; the person's word comes before the watcher's.]`), wake);
    assert.match(String(answered("gw1")), /read-only/i, "the write was refused");
    assert.equal(existsSync(join(root, "woken.txt")), false);
    assert.match(String(answered("gg1")), /^Sent to .+ as a turn of its own: the chat was at rest\.$/);
    await until(() => spaces.guidance(project).find((g) => g.to === x)?.state === "read" || null, "the guidance read by the chat it watches", { timeoutMs: 30_000 });
    assert.deepEqual(spaces.guidance(project).map((g) => [g.from, g.to, g.text, g.how]), [[lead, x, DRIFT, "turn"]]);
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(x)}/transcript`)).json();
    assert.deepEqual(tr.turns.map((/** @type {any} */ t) => [!!t.guided, t.by ?? null]), [[false, null], [true, "guide"]]);
    assert.ok(String(tr.turns[1].user?.content?.at(-1)?.text || "").endsWith(`]\n\n${DRIFT}`), JSON.stringify(tr.turns[1].user));
  });

  test("the supervisor a chat proposes of itself, as the guide gives it: its run, a chat of its own that reads only, is told how to guide and guides the chat it watches", async () => {
    const y = await chat();
    const project = String(shim.app.memory.archive?.getChain(y)?.project_id || "");
    const spaces = shim.app.spaces;
    if (!spaces.has(project)) spaces.make(project);
    await say(y, "PROPOSE OWN");
    const r = spaces.get(project).routines.find((x) => x.madeIn === y);
    assert.ok(r, String(answered("po1")));
    assert.match(String(answered("po1")), new RegExp(`^Watcher ${r.id} "Supervisor" waits for the person's Switch on, on the card under this call and in the Space's Watchers: nothing listens until they press it\\. Its sheet says to the person: “after each turn of .+ that changes files or marks tasks done, wakes a new chat each time\\. Reads only: it changes no file and sends nothing; it may write drafts and lines in What happened; it may guide .+” It runs on agent/brain-model, the model you run on now, until the person chooses another on its sheet\\.$`));
    assert.deepEqual([r.state, r.trigger, r.wakes, r.guides], ["proposed", { kind: "turn", chat: y, turns: "changed", every: 1 }, "new", true]);
    const routes = `/api/space/${encodeURIComponent(project)}/routines/${encodeURIComponent(r.id)}`;
    const on = await shim.api(`${routes}/on`, { method: "POST", body: { at: r.at } });
    assert.equal(on.status, 200, await on.clone().text());
    const ran = await shim.api(`${routes}/run`, { method: "POST", body: {} });
    assert.equal(ran.status, 200, await ran.clone().text());
    const run = String((await ran.json()).chain || "");
    assert.ok(run && run !== y, "a chat of its own");
    const now = () => spaces.get(project).routines.find((x) => x.id === r.id);
    await until(() => now()?.last?.state === "done" || null, "the watcher's run ended", { timeoutMs: 30_000 });
    const first = up.received.map((c) => textOf([...(c.body?.messages || [])].reverse().find((/** @type {any} */ m) => m.role === "user" && textOf(m).trim()))).find((t) => t.startsWith("This is “Supervisor”, a watcher of") && t.includes("RUN-GUIDE")) || "";
    assert.ok(first.split("\n\n")[0].endsWith(`which only the person sends. To guide the chat it watches, which the person lets this watcher do, call the space tool with {"action":"routine","with":{"id":"${r.id}","guidance":"what, and why, in a few lines"}} — a review that finds nothing to say ends in one line and sends nothing.`), first);
    assert.match(String(answered("rg1")), /^Sent to .+ as a turn of its own: the chat was at rest\.$/);
    await until(() => spaces.guidance(project).find((g) => g.to === y)?.state === "read" || null, "the guidance read by the chat it watches", { timeoutMs: 30_000 });
    assert.deepEqual(spaces.guidance(project).filter((g) => g.to === y).map((g) => [g.from, g.text, g.how]), [[run, DRIFT, "turn"]]);
  });
});

describe("on a real Filament, a coding agent: it proposes the supervisor over Filament's MCP server, and its wake's turn, held to reading, sends guidance", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  before(async () => {
    root = fresh("agent");
    writeFileSync(join(root, "README.md"), "app\n");
    shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "coder", name: "coder", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: {}, cwdDefault: root, permissions: "allow-all", hints: false } }];
        cfg.routes = [{ match: "coder/*", upstream: "coder", upstreamModel: "{1}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
  });
  const chat = async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "coder/fake-a", preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** A turn of the person's, to its end: what the agent answered. @param {string} id @param {string} content */
  const say = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { stream: false, content } });
    assert.equal(r.status, 200, await r.clone().text());
    return (((await r.json()).content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text)).join("");
  };

  test("its call proposes the watcher; woken in a turn that reads only, its call sends the guidance to the chat it watches", async () => {
    const lead = await chat();
    const x = await chat();
    const project = String(shim.app.memory.archive?.getChain(lead)?.project_id || "");
    assert.ok(project, "the chats are of a project");
    const spaces = shim.app.spaces;
    spaces.make(project);
    await say(x, "hello");
    // The watcher's words are the fake agent's own cue: woken, it calls Filament's space tool with its guidance.
    const proposal = reviewerOf(x, `~mcpcall space ${JSON.stringify({ action: "routine", with: { guidance: DRIFT } })}`);
    proposal.with.text = proposal.with.text.split(" Read the turn")[0];
    const proposed = await say(lead, `~mcpcall space ${JSON.stringify(proposal)}`);
    const r = spaces.get(project).routines[0];
    assert.ok(r, proposed);
    assert.ok(proposed.includes(`mcp:Watcher ${r.id} "Supervisor" waits for the person's Switch on, on the card under this call and in the Space's Watchers: nothing listens until they press it.`), proposed);
    assert.deepEqual([r.state, r.trigger, r.wakes, r.guides, r.writes, r.madeIn], ["proposed", { kind: "turn", chat: x, turns: "changed", every: 1 }, "chat", true, false, lead]);
    const routes = `/api/space/${encodeURIComponent(project)}/routines/${encodeURIComponent(r.id)}`;
    const on = await shim.api(`${routes}/on`, { method: "POST", body: { at: r.at } });
    assert.equal(on.status, 200, await on.clone().text());
    const ran = await shim.api(`${routes}/run`, { method: "POST", body: {} });
    assert.equal(ran.status, 200, await ran.clone().text());
    const now = () => spaces.get(project).routines[0];
    await until(() => (now().last?.state !== "running" && now().last) || null, "the watcher's turn ended", { timeoutMs: 30_000 });
    assert.equal(now().last?.state, "done", JSON.stringify(now().last));
    assert.match(String(now().last?.said), /^mcp:Sent to .+ as a turn of its own: the chat was at rest\./);
    // Its wake's block held the turn to reading and said how to guide, the call whole.
    const mine = await (await shim.api(`/api/sessions/${encodeURIComponent(lead)}/transcript`)).json();
    const woke = (mine.turns.at(-1)?.user?.content || []).map((/** @type {any} */ b) => b?.text || "").join("\n");
    assert.ok(woke.includes(`This turn reads only: Filament refuses what would change a file; to guide the chat it watches, which the person lets this watcher do, call the space tool with {"action":"routine","with":{"id":"${r.id}","guidance":"what, and why, in a few lines"}} — a review that finds nothing to say ends in one line and sends nothing; the person's word comes before the watcher's.]`), woke);
    await until(() => spaces.guidance(project).find((g) => g.to === x)?.state === "read" || null, "the guidance read by the chat it watches", { timeoutMs: 30_000 });
    assert.deepEqual(spaces.guidance(project).map((g) => [g.from, g.to, g.text, g.how]), [[lead, x, DRIFT, "turn"]]);
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(x)}/transcript`)).json();
    assert.deepEqual(tr.turns.map((/** @type {any} */ t) => [!!t.guided, t.by ?? null]), [[false, null], [true, "guide"]]);
  });

  test("the server's own checks: a commit place outside the project and a tool no connection of the project has are refused as they are proposed; a place kept from before is not followed", async () => {
    const lead = await chat();
    const project = String(shim.app.memory.archive?.getChain(lead)?.project_id || "");
    const spaces = shim.app.spaces;
    if (!spaces.has(project)) spaces.make(project);
    const outside = fresh("elsewhere");
    mkdirSync(join(root, "pkg"));
    /** @param {Record<string, any>} trigger */
    const propose = (trigger) => say(lead, `~mcpcall space ${JSON.stringify({ action: "routine", with: { title: "Commits", trigger, text: "Review what landed." } })}`);
    const had = spaces.get(project).routines.length;
    const out = await propose({ kind: "commit", branch: "main", place: outside });
    assert.ok(out.includes(`mcp:error:Not written: place "${outside}" is no folder of this project: its own folder, one it added or a worktree of its repository, or a folder inside one`), out);
    const none = await propose({ kind: "connection", tool: "mcp__ci__list_runs" });
    assert.match(none, /mcp:error:Not written: ci is no MCP server of this project's chats/);
    assert.equal(spaces.get(project).routines.length, had, "none made of a refusal");
    const inside = await propose({ kind: "commit", branch: "main", place: "pkg" });
    assert.match(inside, /mcp:Watcher r\d+ "Commits" waits for the person's Switch on, on the card under this call and in the Space's Watchers: nothing listens until they press it\. Its sheet says to the person: “on each new commit on main in pkg, wakes a new chat each time\. /);
    // One a Space kept before the tool fenced it: switched on, its place is its trouble, and nothing there is read.
    const f = routineFields({ title: "Kept", text: "Review.", trigger: { kind: "commit", branch: "main", place: outside } }, { create: true });
    assert.ok(f.ok, JSON.stringify(f));
    const kept = spaces.routinePropose(project, f.fields, { chain: lead, byName: "Lead", model: "coder/fake-a" });
    const on = await shim.api(`/api/space/${encodeURIComponent(project)}/routines/${encodeURIComponent(kept.id)}/on`, { method: "POST", body: { at: kept.at } });
    assert.equal(on.status, 200, await on.clone().text());
    const now = () => spaces.get(project).routines.find((r) => r.id === kept.id);
    await until(() => now()?.seen?.trouble || null, "its place refused: the watcher's trouble", { timeoutMs: 30_000 });
    assert.equal(now()?.seen?.trouble?.why, `place "${outside}" is no folder of this project: its own folder, one it added or a worktree of its repository, or a folder inside one — a path not whole is read against the project's folder`);
    const row = (await (await shim.api(`/api/space/${encodeURIComponent(project)}`)).json()).runs.routines.find((/** @type {any} */ r) => r.id === kept.id);
    assert.ok(String(row?.words?.skipped).startsWith('its branch could not be read: place "'), JSON.stringify(row?.words));
    assert.equal(now()?.seen?.head ?? null, null, "no branch of that folder was looked at");
  });
});
