// @ts-check
// A chat's coding agent's own tasks on the harness page, the holders the page is told of, and a chat being opened. The
// chat hears its agent's tasks (HarnessV4_Tasks U1) — the sub-agents and shells it runs beside its work, the whole list
// each time it is said — on the events feed, with its session's id, whoever holds the session: its own turn, another
// tab's, its move, or nobody once a turn has ended and a task it left runs on. A page holds the events feed alone
// (HarnessV3-Responsiveness R3, which turn-run-events.test.js pins). Another tab's turn is followed here as it runs. A
// chat's move is read at its release where another page asked for it, in the folder it moved to; the page that asked
// reads it at the move's own end, each move by its own mark, and a message that waits for it waits it out — or joins the
// chat's queue where a turn running in the chat takes no words as it would go. A coding agent's turn of its own is the
// harness's: a message waiting on it has Stop it and go first while that turn holds the session. An outside client's
// requests hold no chat at all: they reach the page as none of these. A chat being opened is being read: a turn heard
// meanwhile, or one a send met running, is read once that read has landed, never by a read beside it. The page boots a
// DOM at import, so its functions are lifted out of app.js and run against stand-ins (helpers/app-lift.js).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP_SRC, NOOP, lift } from "./helpers/app-lift.js";
import { readsOnShow, readSince, noteUnseenTurn } from "../src/ui/harness/lib/release.js";
import { transcriptWhole, writtenSince } from "../src/ui/harness/lib/transcript-since.js";
import * as waiting from "../src/ui/harness/waiting.js";
import { stopReached, forceOutcome } from "../src/ui/harness/lib/stops.js";
import { withoutAsked } from "../src/ui/harness/conversation/interaction.js";
import { mergedTurns, placeBoundary, runningOn, endedOn } from "../src/ui/harness/conversation/history.js";
import { ownLast, engineDividers, leadingSince } from "../src/ui/harness/lib/team.js";
import * as history from "../src/ui/harness/conversation/history.js";
import { attachmentBlock } from "../src/ui/harness/composer/attachments.js";
import { awayBack, queueAdd, queueState, queuedAnswer } from "../src/ui/harness/composer/queue.js";
import { againOf, steerForkOf, steerForkRefusal, STEER_FORK_USAGE } from "../src/ui/harness/lib/labels.js";
import { isClientView } from "../src/ui/harness/widgets/compaction.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { footerEl } from "../src/ui/harness/conversation/turn.js";

const { holderFromView } = waiting;

/** A stand-in that keeps what is asked of it by name and takes anything else. @param {Record<string, any>} own @returns {any} */
const standIn = (own) => new Proxy(own, { get: (t, k) => (k in t ? t[/** @type {any} */ (k)] : NOOP) });

const HARNESS = Object.freeze({ window: "harness", client: "harness", label: "the harness", since: 1 });
const OWN = Object.freeze({ window: "harness", client: "harness", label: "Claude Code", since: 1, own: { agent: "Claude Code" } });
/** The turn lock's holder while a chat moves to another folder, as app/sessions/move.js takes the lock. */
const MOVE = Object.freeze({ window: /export const MOVE_WINDOW = "([^"]+)";/.exec(readFileSync("src/app/sessions/move.js", "utf8"))?.[1] || "", client: "the move to another folder", label: "the move to another folder", since: 1 });
const TASKS = [{ id: "t1", kind: "local_bash", description: "npm test", background: true }];
/** Lets every promise already settled run its handlers. */
const settled = () => new Promise((r) => setImmediate(r));

/**
 * The page's chat-showing path, lifted from app.js: `selectChat`, `openSession`, a chat deleted here, the agent tasks the
 * feed says (`setAgentTasks`), the feed's `turn` and `agent-tasks` handlers, the moves the page asked for (`movingHere`),
 * the read a session let go owes, the holders resync's correction and the feed's reconnect. The transcript and the
 * composer keep what they are asked; `scope` is the names the lifted functions read, a test's own stand-in put there
 * taking the page's place.
 * @param {any[]} chats
 */
function page(chats) {
  const state = { currentId: /** @type {string | null} */ (null), chats: new Map(), holders: new Map() };
  for (const c of chats) state.chats.set(c.id, c);
  /** @type {string[]} */
  const said = [];
  /** @type {Record<string, any>} */
  const scope = {
    state,
    chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
    chatByChain: (/** @type {string} */ id) => [...state.chats.values()].find((c) => c.chainId === id) || null,
    readsOnShow,
    noteUnseenTurn,
    isClientView,
    MOVE_WINDOW: waiting.MOVE_WINDOW,
    opening: new WeakSet(),
    letGo: new Map(),
    applySessionView: (/** @type {any} */ c, /** @type {any} */ part) => {
      said.push(`view ${c.id}`);
      c.view = { ...(c.view || {}), ...part };
    },
    paintStatus: (/** @type {any} */ c) => said.push(`panel ${c.id}`),
    hydrate: async (/** @type {any} */ c) => void said.push(`read ${c.id}`),
    followElsewhere: (/** @type {any} */ c) => said.push(`catch up ${c.id}`),
    putChat: (/** @type {any} */ c) => (state.chats.set(c.id, { turns: [], ...c }), state.chats.get(c.id)),
    newChatId: () => `o${state.chats.size}`,
    sidebar: standIn({ load: () => said.push("left bar") }),
    transcript: standIn({ startTurn: () => said.push("row"), drawBlocks: () => said.push("drawn") }),
    composer: standIn({ setLive: (/** @type {boolean} */ on) => void (on && said.push("Stop")) }),
    newChat: () => {
      state.chats.set("n1", { id: "n1", chainId: null, turns: [] });
      fns.selectChat("n1");
    },
  };
  const fns = lift(["selectChat", "drawChat?", "drawnChat?", "leaveDeleted", "openSession", "setAgentTasks?", "movingHere?", "movingMark?", "movesHere?", "movingHeard?", "heardMove?", "sessionLetGo?", "clientTurnEnded?", "resyncHolder?", "afterFeedGap"], scope);
  Object.assign(scope, fns);
  return { state, fns, scope, said, turnFeed: feedHandler("turn", scope), tasksFeed: () => feedHandler("agent-tasks", scope) };
}

/**
 * The events feed's handler for `type` messages as app.js wires it (`onBus`), run among the scope's names as `lift` runs
 * a function. @param {string} type @param {Record<string, any>} scope @returns {(msg: any) => void}
 */
function feedHandler(type, scope) {
  const head = new RegExp(`onBus\\(\\(msg\\) => \\{\\n  if \\(msg\\?\\.type [!=]== "${type}"`).exec(APP_SRC);
  assert.ok(head, `app.js hears "${type}" on the feed`);
  const end = APP_SRC.indexOf("\n});\n", head.index);
  const handler = APP_SRC.slice(head.index + "onBus(".length, end + "\n}".length);
  const room = new Proxy(scope, {
    has: (t, k) => k in t || !(k in globalThis),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[/** @type {any} */ (k)] : NOOP),
    set: (t, k, v) => ((t[/** @type {any} */ (k)] = v), true),
  });
  // eslint-disable-next-line no-new-func
  return new Function("room", `with (room) { return ${handler}; }`)(room);
}

/**
 * The page's transcript reads held until the test lets each land, as app.js `hydrate` lands one: the chat is no longer
 * being opened, a turn the read found running is followed (`follows`), and what was heard before the read was asked is
 * in it (`readSince`). @param {ReturnType<typeof page>} p
 */
function heldReads(p) {
  /** @type {((o?: { follows?: boolean }) => void)[]} */
  const landings = [];
  p.scope.hydrate = (/** @type {any} */ c) => {
    p.said.push(`read ${c.id}`);
    const asked = Date.now();
    return new Promise((done) =>
      landings.push(({ follows = false } = {}) => {
        p.scope.opening.delete(c);
        if (follows) c.live = { turn: {} };
        readSince(c, asked);
        done(undefined);
      }),
    );
  };
  return landings;
}

describe("a chat's agent tasks ride the events feed", () => {
  // (fails before: yes — on e7f453755 the tasks were heard on the chat shown's live topic alone: app.js had no handler
  // for `agent-tasks` on the feed, and a chat not shown kept the list it was read with)
  test("each list the feed says reaches its chat, the status drawn where it is the chat shown, whoever holds the session", () => {
    const held = { id: "c1", chainId: "s-c1", turns: [], view: { holder: HARNESS } };
    const free = { id: "c2", chainId: "s-c2", turns: [], view: { holder: null } };
    const moving = { id: "c3", chainId: "s-c3", turns: [], view: { holder: MOVE } };
    const p = page([held, free, moving]);
    for (const id of ["c1", "c2", "c3"]) p.fns.selectChat(id);
    const feed = p.tasksFeed();
    p.said.length = 0;
    feed({ type: "agent-tasks", chainId: "s-c3", sessionId: "acp-3", tasks: TASKS });
    assert.deepEqual([/** @type {any} */ (moving).agentTasks, p.said], [TASKS, ["panel c3"]], "the chat shown: the list, whole, to the panel");
    assert.ok(Number(/** @type {any} */ (moving).agentTasksAt) > 0, "when it was heard is kept with it");
    feed({ type: "agent-tasks", chainId: "s-c1", sessionId: "acp-1", tasks: TASKS });
    assert.deepEqual([/** @type {any} */ (held).agentTasks, p.said], [TASKS, ["panel c3"]], "a chat kept but not shown: its list, and nothing drawn");
    feed({ type: "agent-tasks", chainId: "s-c1", sessionId: "acp-1", tasks: [] });
    assert.deepEqual(/** @type {any} */ (held).agentTasks, [], "they ended");
    feed({ type: "agent-tasks", chainId: "s-gone", tasks: TASKS });
    feed({ type: "agent-tasks", tasks: TASKS });
    assert.deepEqual(p.said, ["panel c3"], "a chat the page does not keep, or none named: nothing");
    p.fns.selectChat("c1");
    assert.deepEqual(/** @type {any} */ (held).agentTasks, [], "shown again: the list it has");
  });

  // (fails before: no — a guard: a chat opened sends its transcript read, app.js `opening`; the server has no stream of
  // a session's own for it to open, which turn-run-events.test.js's R3 pin holds)
  test("a chat opened reads its transcript; deleted while shown, the new chat takes the screen", async () => {
    const p = page([]);
    const chat = await p.fns.openSession({ id: "s-o", title: "Opened" });
    assert.deepEqual(p.said.filter((s) => /^read /.test(s)), [`read ${chat.id}`]);
    p.fns.leaveDeleted("s-o");
    assert.equal(p.state.currentId, "n1");
  });

  // (fails before: yes — on e7f453755 a read on its way replaced the newer list the topic had said meanwhile with the
  // transcript's older one)
  test("a read of the transcript on its way keeps a list the feed said after it was asked; one asked after the feed's word takes the transcript's", async () => {
    let clock = 1000;
    /** @type {((tr: any) => void)[]} */
    const answers = [];
    const state = { currentId: "c1", chats: new Map(), compactingHeard: new Map(), commands: new Map() };
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", turns: [] });
    state.chats.set("c1", chat);
    const { hydrate } = lift(["hydrate"], {
      state, newestOnRecord: history.newestOnRecord,
      Date: { now: () => clock },
      api: () => new Promise((r) => answers.push(r)),
      chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
      opening: new WeakSet(),
      transcriptTurns: () => [],
      withReadWork: (/** @type {any[]} */ t) => t,
      withReadRuns: (/** @type {any[]} */ t) => t,
      transcriptWhole, writtenSince,
      mergedTurns: (/** @type {any[]} */ _page, /** @type {any[]} */ read) => read,
      applySessionView: (/** @type {any} */ c, /** @type {any} */ part) => void (c.view = { ...(c.view || {}), ...part }),
      readSince,
      waitingOwes: () => null,
    });
    const older = [{ id: "t0", kind: "local_bash", description: "npm run build", background: true }];
    const reading = hydrate(chat);
    // The feed's word lands while the read is on its way (app.js `setAgentTasks`).
    clock = 1500;
    Object.assign(chat, { agentTasks: TASKS, agentTasksAt: clock });
    answers.shift()?.({ agentTasks: older, turns: [] });
    await reading;
    assert.deepEqual(chat.agentTasks, TASKS, "the newer list stands");
    clock = 2000;
    const again = hydrate(chat);
    answers.shift()?.({ agentTasks: [], turns: [] });
    await again;
    assert.deepEqual(chat.agentTasks, [], "a read asked after the feed's word holds it: the transcript's list stands");
  });

  // (fails before: yes — on e7f453755 the feed's reconnect read the chat shown and marked the chats kept, and a chat whose
  // own turn ran through the gap was read by nothing: a change of its agent's tasks the feed lost stood until the next)
  test("the feed back after a gap: the chat shown is read now, one kept is read as it is shown, one whose own turn runs is read at that turn's end", () => {
    const shown = { id: "c1", chainId: "s-c1", turns: [] };
    const kept = { id: "c2", chainId: "s-c2", turns: [] };
    const running = /** @type {any} */ ({ id: "c3", chainId: "s-c3", turns: [], live: { turn: {} } });
    const p = page([shown, kept, running]);
    p.fns.selectChat("c1");
    p.said.length = 0;
    p.fns.afterFeedGap();
    assert.deepEqual(p.said, ["catch up c1"], "the chat shown, now");
    assert.deepEqual([readsOnShow(kept), running.hydrateAfterSend], [true, true], "the others, as they are shown, and at their turn's end");
    p.fns.selectChat("c2");
    assert.ok(p.said.includes("catch up c2"), "the chat kept, read as it is shown");
  });
});

describe("a chat being opened is being read: what is heard meanwhile is read once that read has landed", () => {
  // (fails before: yes — on c97b98c59 another harness tab's turn heard while the chat's first read was on its way — the
  // holders resync's take, the feed's — started a read beside it (`followElsewhere`): where the first landed with the
  // turn's open row and followed it, the second dropped that row for the server's copy, and the turn was drawn twice)
  test("another harness tab's turn heard while the first read is on its way starts no read beside it; the read that follows the turn reads nothing more, one that did not is read again and the turn followed", async () => {
    const p = page([]);
    const landings = heldReads(p);
    /** The reads the page asked for since: of its transcript, or of a turn followed from elsewhere. */
    const reads = () => p.said.filter((s) => /^(read|catch up) /.test(s));
    // A reload onto a chat another harness tab's turn holds: the holders read lands before the transcript does.
    const first = p.fns.openSession({ id: "s-o", title: "Opened" });
    const followed = p.state.chats.get(String(p.state.currentId));
    p.said.length = 0;
    p.state.holders.set("s-o", HARNESS);
    p.fns.resyncHolder?.(followed);
    p.turnFeed({ type: "turn", chainId: "s-o", holder: HARNESS });
    assert.deepEqual(reads(), [], "the resync's take and the feed's: no read beside the one on its way");
    landings.shift()?.({ follows: true });
    await first;
    assert.deepEqual(reads(), [], "its read found the turn and follows it: nothing more");
    // Opened from the left bar as another tab's turn takes the session: the read on its way holds none of it.
    const second = p.fns.openSession({ id: "s-p", title: "Taken" });
    const missed = p.state.chats.get(String(p.state.currentId));
    p.said.length = 0;
    p.turnFeed({ type: "turn", chainId: "s-p", holder: HARNESS });
    assert.deepEqual(reads(), [], "the feed's take: nothing beside the read");
    landings.shift()?.();
    await second;
    assert.deepEqual(reads(), [`catch up ${missed.id}`], "read again once its read landed, and followed where it runs");
  });

  // (fails before: yes — on c97b98c59 a release heard while the chat's first read was on its way read nothing more where
  // the view had no holder yet, and a feed gap meanwhile neither: the read, asked before, might hold the turn running)
  test("another tab's turn let go, or a gap in the feed, while the first read is on its way: read once it has landed", async () => {
    const p = page([]);
    const landings = heldReads(p);
    const reads = () => p.said.filter((s) => /^(read|catch up) /.test(s));
    const released = p.fns.openSession({ id: "s-q", title: "Released" });
    const q = p.state.chats.get(String(p.state.currentId));
    p.said.length = 0;
    p.turnFeed({ type: "turn", chainId: "s-q", holder: null });
    assert.deepEqual(reads(), [], "nothing beside the read");
    landings.shift()?.();
    await released;
    assert.deepEqual(reads(), [`catch up ${q.id}`], "read once its read has landed");
    const gapped = p.fns.openSession({ id: "s-r", title: "Gapped" });
    const r = p.state.chats.get(String(p.state.currentId));
    p.said.length = 0;
    p.fns.afterFeedGap();
    assert.deepEqual(reads(), [], "the feed back: nothing beside the read");
    landings.shift()?.();
    await gapped;
    assert.deepEqual(reads(), [`catch up ${r.id}`], "read once its read has landed");
  });

  // (fails before: yes — on 32afa3f3f a send refused because a turn of the harness's held the session followed that turn
  // at once (`followElsewhere`), a read beside the chat's first read still on its way: where the first landed with the
  // turn's open row and followed it, the second dropped that row for the server's copy, and the turn was drawn twice)
  test("a send that meets a harness turn while the first read is on its way starts no read beside it: the turn is read once that read has landed, where it did not hold it", async () => {
    const p = page([]);
    const landings = heldReads(p);
    const reads = () => p.said.filter((s) => /^(read|catch up) /.test(s));
    const send = sendLift(p.scope, async () => refusedByHarness());
    const opened = p.fns.openSession({ id: "s-o", title: "Opened" });
    const chat = p.state.chats.get(String(p.state.currentId));
    p.said.length = 0;
    assert.equal(await send("go on", []), false, "the harness's turn holds the session");
    assert.deepEqual(reads(), [], "no read beside the one on its way");
    landings.shift()?.();
    await opened;
    assert.deepEqual(reads(), [`catch up ${chat.id}`], "read once it has landed, and followed where the turn runs");
  });
});

describe("the holders the page is told of: another tab's turn is followed, a chat's move is read at its release or its own end", () => {
  // (fails before: yes — the review of fe86a180d: a move another page asked for was read in the folder it moved to only
  // where its release reached the chat shown: released while its chat was kept but not shown, or while the feed was
  // down, it was read on show in the folder it moved from)
  test("a move another page asked for marks its chat whenever its release comes: kept but not shown, or while the feed was down; a harness turn's release marks nothing", () => {
    const shown = /** @type {any} */ ({ id: "c1", chainId: "s-c1", turns: [], view: { holder: null } });
    const kept = /** @type {any} */ ({ id: "c2", chainId: "s-c2", turns: [], view: { holder: null } });
    const gap = /** @type {any} */ ({ id: "c3", chainId: "s-c3", turns: [], view: { holder: null } });
    const ran = /** @type {any} */ ({ id: "c4", chainId: "s-c4", turns: [], view: { holder: null } });
    const p = page([shown, kept, gap, ran]);
    p.fns.selectChat("c1");
    p.turnFeed({ type: "turn", chainId: "s-c2", holder: MOVE });
    assert.equal(kept.movedAt ?? 0, 0, "not while it moves");
    p.turnFeed({ type: "turn", chainId: "s-c2", holder: null });
    assert.ok(kept.movedAt > 0, "released while not shown: its read on show takes the folder it moved to");
    p.turnFeed({ type: "turn", chainId: "s-c3", holder: MOVE });
    p.fns.afterFeedGap();
    assert.ok(gap.movedAt > 0, "its release may have come while the feed was down");
    p.turnFeed({ type: "turn", chainId: "s-c4", holder: HARNESS });
    p.turnFeed({ type: "turn", chainId: "s-c4", holder: null });
    assert.equal(ran.movedAt ?? 0, 0, "a harness turn's release");
  });

  // (fails before: yes — an outside client's chat holds no lock: the server says its turn's end with no holder, which
  // read nothing in the page showing the chat — the turn its client sent stayed unread until the chat was opened again)
  test("an outside client's chat shown is read again as its turn ends; a harness chat's release reads nothing more; the chat's own send owes the read at its end", () => {
    const client = { id: "c1", chainId: "s-c1", turns: [], view: { holder: null, settings: { native: false } } };
    const own = { id: "c2", chainId: "s-c2", turns: [], view: { holder: null, settings: { native: true } } };
    const p = page([client, own]);
    const reads = () => p.said.filter((s) => s.startsWith("read"));
    p.fns.selectChat("c1");
    p.said.length = 0;
    p.turnFeed({ type: "turn", chainId: "s-c1", holder: null });
    assert.deepEqual(reads(), ["read c1"], "its client's turn is on record: read again");
    /** @type {any} */ (client).live = { turn: {} };
    p.said.length = 0;
    p.turnFeed({ type: "turn", chainId: "s-c1", holder: null });
    assert.deepEqual([reads(), /** @type {any} */ (client).hydrateAfterSend], [[], true], "a send of the page's runs: its end reads it");
    p.fns.selectChat("c2");
    p.said.length = 0;
    p.turnFeed({ type: "turn", chainId: "s-c2", holder: null });
    assert.deepEqual(reads(), [], "the harness's own chat: its turns are followed, their release reads nothing more");
  });

  // (fails before: yes — on c97b98c59 a chat's move (window "move", app/sessions/move.js) read nothing at its release in
  // any page: the move's own end read the chat in the page that pressed Move alone (`movedTo`), so another tab or a
  // popped pane showing the chat drew neither its "Moved to …" row nor its change rounds)
  test("a harness turn's release reads nothing more; a chat's move another page asked for is read at its release, the left bar with it, and the one this page asked for at its own end; the chat's own send owes the read at its end", () => {
    const chat = { id: "c1", chainId: "s-c1", turns: [], view: { holder: null } };
    const p = page([chat]);
    p.fns.selectChat("c1");
    p.said.length = 0;
    p.turnFeed({ type: "turn", chainId: "s-c1", holder: HARNESS });
    p.turnFeed({ type: "turn", chainId: "s-c1", holder: null });
    assert.deepEqual(p.said, ["view c1", "catch up c1", "view c1"], "a harness turn is followed by its run: its release reads nothing here");
    p.said.length = 0;
    p.turnFeed({ type: "turn", chainId: "s-c1", holder: MOVE });
    assert.deepEqual(p.said, ["view c1"], "a chat's move takes the session: no row, no Stop");
    p.turnFeed({ type: "turn", chainId: "s-c1", holder: null });
    assert.deepEqual(p.said, ["view c1", "view c1", "read c1", "left bar"], "a move another page asked for: read at its release");
    p.said.length = 0;
    const mine = p.fns.movingMark(chat);
    p.turnFeed({ type: "turn", chainId: "s-c1", holder: MOVE });
    p.turnFeed({ type: "turn", chainId: "s-c1", holder: null });
    assert.deepEqual(p.said, ["view c1", "view c1"], "the move this page asked for: its own end reads the chat, its release nothing more");
    mine.done();
    p.turnFeed({ type: "turn", chainId: "s-c1", holder: MOVE });
    /** @type {any} */ (chat).live = { turn: {} };
    p.said.length = 0;
    p.turnFeed({ type: "turn", chainId: "s-c1", holder: null });
    assert.deepEqual([p.said.filter((s) => s.startsWith("read")), /** @type {any} */ (chat).hydrateAfterSend], [[], true], "the chat's own send runs: its end reads it");
    assert.equal(waiting.MOVE_WINDOW, MOVE.window, "the page's word for a move's window is the server's");
  });

  // (fails before: yes — on c97b98c59 nothing marked a move as this page's own, so its release could not be told from
  // another page's move; on 32afa3f3f the mark was one flag per chat, which a second move cleared as the server refused
  // it at once — a row's Move back's own catch, the sheet's `move.catch` — while the first was still on its way: the
  // first's release was read as another page's move, and the chat read twice)
  test("each move this page asks for is its own from its press until its own end has read the chat, or it was refused: a second one refused at once leaves the first's standing", async () => {
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", turns: [], view: { holder: null } });
    /** The page's reads of the chat. @type {string[]} */
    const reads = [];
    /** The moves posted, each answered when the test says. @type {{ ok: (v: any) => void, no: (e: any) => void }[]} */
    const posts = [];
    /** The sheet as the page opened it last. @type {any} */
    let sheet = null;
    const fns = lift(["movingHere", "movingMark?", "movesHere?", "sessionLetGo", "movedTo", "moveBackIn", "openMoveSheet?"], {
      state: { currentId: "c1" },
      chatOf: () => chat,
      MOVE_WINDOW: waiting.MOVE_WINDOW,
      api: () => new Promise((ok, no) => void posts.push({ ok, no })),
      hydrate: async () => void reads.push("read"),
      withoutMove: () => {},
      placeName: (/** @type {string} */ cwd) => cwd,
      moveSheet: (/** @type {any} */ o) => void (sheet = o),
      sidebar: standIn({}),
    });
    /** The feed's release of the chat's move: how many reads it asked. */
    const released = () => {
      const was = reads.length;
      fns.sessionLetGo(chat, MOVE);
      return reads.length - was;
    };
    const refusal = () => Object.assign(new Error("not moved: the chat is moving already"), { status: 409 });
    // A row's Move back on its way, and a second one the server refuses at once.
    const first = fns.moveBackIn(chat, { id: "m1" });
    const second = fns.moveBackIn(chat, { id: "m1" });
    posts[1].no(refusal());
    await second;
    assert.equal(released(), 0, "the first's release: its own end reads the chat");
    posts[0].ok({ cwd: "H:/w/proj-fix" });
    await first;
    assert.deepEqual([reads, chat.cwd], [["read"], "H:/w/proj-fix"], "its own end read it");
    assert.equal(released(), 1, "neither leaves a mark: a later release is another page's move");
    // The sheet's Move on its way, and a row's Move back refused at once.
    reads.length = 0;
    fns.openMoveSheet(chat);
    /** @type {(v: any) => void} */
    let land = () => {};
    sheet.onMoving(new Promise((r) => (land = r)));
    const back = fns.moveBackIn(chat, { id: "m2" });
    posts.at(-1)?.no(refusal());
    await back;
    assert.equal(released(), 0, "the sheet's move: its own end reads the chat");
    land({ cwd: "H:/w/proj-sheet", running: [] });
    sheet.onMoved({ cwd: "H:/w/proj-sheet", running: [] });
    await settled();
    assert.deepEqual([[...reads], chat.cwd, released()], [["read"], "H:/w/proj-sheet", 1], "its own end read it, its mark with it");
    // A row's Move back on its way, and the sheet's Move refused at once.
    reads.length = 0;
    const third = fns.moveBackIn(chat, { id: "m3" });
    fns.openMoveSheet(chat);
    sheet.onMoving(Promise.reject(refusal()));
    await settled();
    assert.equal(released(), 0, "the Move back's release: its own end reads the chat");
    posts.at(-1)?.ok({ cwd: "H:/w/proj" });
    await third;
    assert.deepEqual([[...reads], released()], [["read"], 1]);
  });

  // (fails before: yes — on 32afa3f3f a move another page asked for was read at its release with the chat kept in the
  // folder this page had (`hydrate` takes the page's folder before the transcript's), and nothing told the folder's
  // change: the header, the git chips and the status went on in the old folder until the page loaded afresh)
  test("a move another page asked for, read at its release or at the end of the chat's own send, leaves the chat in the transcript's folder and tells the folder's change; a read asked before the release, or any other, keeps the page's folder", async () => {
    let clock = 1000;
    /** @type {((tr: any) => void)[]} */
    const answers = [];
    /** The folder's changes told, with the chat's folder as each was told. @type {string[]} */
    const changes = [];
    const state = { currentId: "c1", chats: new Map(), compactingHeard: new Map(), commands: new Map() };
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", turns: [], view: { holder: MOVE } });
    state.chats.set("c1", chat);
    const fns = lift(["movingHere", "movingMark?", "movesHere?", "sessionLetGo", "hydrate"], {
      state, newestOnRecord: history.newestOnRecord,
      Date: { now: () => clock },
      api: () => new Promise((r) => answers.push(r)),
      chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
      MOVE_WINDOW: waiting.MOVE_WINDOW,
      opening: new WeakSet(),
      transcriptTurns: () => [],
      withReadWork: (/** @type {any[]} */ t) => t,
      withReadRuns: (/** @type {any[]} */ t) => t,
      transcriptWhole, writtenSince,
      mergedTurns: (/** @type {any[]} */ _page, /** @type {any[]} */ read) => read,
      applySessionView: (/** @type {any} */ c, /** @type {any} */ part) => void (c.view = { ...(c.view || {}), ...part }),
      readSince,
      waitingOwes: () => null,
      folderIn: { dispatchEvent: (/** @type {Event} */ e) => void changes.push(`${e.type} ${chat.cwd}`) },
      sidebar: standIn({}),
    });
    // A read asked while the move ran lands after its release, holding the folder the chat moved from.
    const early = fns.hydrate(chat);
    clock = 1500;
    fns.sessionLetGo(chat, MOVE);
    answers.shift()?.({ turns: [], cwd: "H:/w/proj" });
    await early;
    assert.deepEqual([chat.cwd, changes], ["H:/w/proj", []], "a read asked before the release: the folder the page has");
    answers.shift()?.({ turns: [], cwd: "H:/w/proj-fix" });
    await settled();
    assert.deepEqual([chat.cwd, changes], ["H:/w/proj-fix", ["change H:/w/proj-fix"]], "the release's read: where it moved to, its change told");
    clock = 2000;
    const after = fns.hydrate(chat);
    answers.shift()?.({ turns: [], cwd: "H:/w/proj" });
    await after;
    assert.deepEqual([chat.cwd, changes.length], ["H:/w/proj-fix", 1], "any other read: the folder the page has");
    // Another page's move let go while the chat's own send runs: the read at the send's end has it where it moved to.
    chat.live = { turn: {} };
    clock = 2500;
    fns.sessionLetGo(chat, MOVE);
    assert.deepEqual([answers.length, chat.hydrateAfterSend], [0, true], "nothing read beside the send");
    chat.live = null;
    clock = 3000;
    const owed = fns.hydrate(chat);
    answers.shift()?.({ turns: [], cwd: "H:/w/proj-2" });
    await owed;
    assert.deepEqual([chat.cwd, changes.at(-1)], ["H:/w/proj-2", "change H:/w/proj-2"]);
  });

  // (fails before: yes — on e7f453755 the holders resync corrected a release the feed dropped and nothing else: a take it
  // dropped left the view's holder empty, so the release that followed read nothing; on c97b98c59 a move another page
  // asked for was read at no release)
  test("the holders resync sets a take the feed dropped, so the release after it reads a move another page asked for; a harness tab's take is drawn; a chat whose own turn runs is left to it", () => {
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", turns: [], view: { holder: null } });
    const p = page([chat]);
    p.fns.selectChat("c1");
    p.said.length = 0;
    p.state.holders.set("s-c1", MOVE);
    p.fns.resyncHolder?.(chat);
    assert.deepEqual([chat.view.holder, p.said], [MOVE, ["view c1"]], "the take the feed dropped: the view hears it, and nothing is drawn");
    p.fns.resyncHolder?.(chat);
    assert.deepEqual(p.said, ["view c1"], "read again, the same: nothing more");
    p.said.length = 0;
    p.state.holders.delete("s-c1");
    p.fns.resyncHolder?.(chat);
    assert.deepEqual([chat.view.holder, p.said], [null, ["view c1", "read c1", "left bar"]], "and its release, dropped too: the move is read");
    p.said.length = 0;
    p.state.holders.set("s-c1", HARNESS);
    p.fns.resyncHolder?.(chat);
    assert.deepEqual(p.said, ["view c1", "catch up c1"], "another harness tab's take: drawn as the feed's would be");
    chat.view.holder = null;
    chat.live = { turn: {} };
    p.said.length = 0;
    p.fns.resyncHolder?.(chat);
    assert.deepEqual(p.said, [], "its own turn runs: the turn's holder is its own");
  });

  // (fails before: yes — on e7f453755 a turn followed from elsewhere (followLiveTurn) read the chat at its end and left
  // `hydrateAfterSend` set, so the chat was never let go (lib/release.js `letGoable`) until its next send's end read it
  // again)
  test("a turn followed from elsewhere reads the chat at its end, and owes no read after it", async () => {
    const state = { currentId: "c1", chats: new Map() };
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", turns: [{ n: 1, past: true, status: "open" }] });
    state.chats.set("c1", chat);
    /** @type {(() => Promise<void>)[]} */
    const polls = [];
    let reads = 0;
    const { followLiveTurn } = lift(["followLiveTurn"], {
      state, newestOnRecord: history.newestOnRecord,
      chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
      api: async () => ({ live: null }),
      setTimeout: (/** @type {() => Promise<void>} */ fn) => (polls.push(fn), 0),
      hydrate: async () => void reads++,
      document: { hidden: false },
      writing: { chainId: null, you: true },
    });
    followLiveTurn(chat, { startedAt: 1 });
    // The events feed came back while this one ran (`afterFeedGap`): the read is owed.
    chat.hydrateAfterSend = true;
    await polls.shift()?.();
    await settled();
    assert.deepEqual([chat.live, reads, chat.hydrateAfterSend], [null, 1, false]);
  });

  // (fails before: yes — on b4ee117a2 a stop's answer that named a holder counted as a turn reached, the mark an outside
  // window's turn took to stop at its next leg)
  test("a stop whose answer names a holder and stopped nothing reached no turn", () => {
    assert.equal(stopReached({ ok: true, holder: { window: "move", requestId: "r9" } }), false);
    assert.equal(stopReached({ ok: true, holder: { window: "harness", requestId: "r1" }, stopped: null }), false);
    assert.equal(forceOutcome({ ok: true, holder: { window: "move" } }), "nothing");
    assert.equal(stopReached({ ok: true, holder: { window: "harness", requestId: "r1" }, stopped: "steered" }), true, "a run that took the stop");
  });
});

/**
 * The waiting row's page (app.js `armWaiting`, HarnessV3 Step 3 D14), lifted with the queue, the copies kept for a reload
 * (`kept`, by session), the chat's queue (`enqueued`, what the composer was given), the rows taken out of the transcript
 * (`dropped`), the session view and `sendMessage` stood in: `io.send(o)` answers for `sendMessage`, given its options;
 * `view(chat, holder)` is the events feed's word on the chat's holder as app.js applies it to the view
 * (`applySessionView`: the view's subscribers hear it).
 */
function waitingPage() {
  /** @type {string[]} */
  const stops = [];
  /** @type {any[]} */
  const drawn = [];
  /** @type {Map<string, any>} */
  const kept = new Map();
  /** @type {any[][]} */
  const enqueued = [];
  /** @type {any[]} */
  const dropped = [];
  /** @type {any[]} */
  const started = [];
  /** The chats followed (`followElsewhere`), the queue's goings on (`composer.goOn`), the lines said in place
   *  (`transcript.waitingLine`), and the words each send went with. @type {any[]} */
  const follows = [];
  /** @type {number[]} */
  const goOns = [];
  /** @type {any[]} */
  const lines = [];
  /** @type {string[]} */
  const words = [];
  /** The chat's queue as the composer holds it, in order, and each time the composer was set live or not. @type {any[]} */
  const items = [];
  /** @type {any[][]} */
  const lives = [];
  /** The chats read (app.js `hydrate`), and what the page did in what order. @type {any[]} */
  const reads = [];
  /** @type {string[]} */
  const order = [];
  /** What the page armed the queue with, and the queue it made. @type {any} */
  let queued = null;
  /** @type {any} */
  let made = null;
  /** @type {Map<any, Set<(view: any) => void>>} */
  const watching = new Map();
  const state = { currentId: "c1", chats: new Map() };
  const io = { send: /** @type {(o: any) => Promise<any>} */ (async () => undefined), read: /** @type {((c: any) => Promise<void>) | null} */ (null) };
  const { armWaiting } = lift(["armWaiting"], {
    state,
    chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
    holderFromView,
    createWaitingQueue: (/** @type {any} */ o) => {
      queued = o;
      made = { text: "Waiting — …", cancel() {}, stop: async (/** @type {string} */ route) => void stops.push(route) };
      return made;
    },
    composer: standIn({
      enqueue: (/** @type {any[]} */ texts) => {
        enqueued.push(texts);
        items.push(...texts);
      },
      enqueueFirst: (/** @type {any} */ it) => void items.unshift(it),
      goOn: () => void goOns.push(1),
      setLive: (/** @type {any[]} */ ...a) => void lives.push(a),
    }),
    transcript: standIn({ drawFoot: (/** @type {any} */ t) => void drawn.push(t), dropTurn: (/** @type {any} */ t) => void dropped.push(t), startTurn: (/** @type {any} */ t) => void started.push(t), waitingLine: (/** @type {any} */ t) => void lines.push(t) }),
    followElsewhere: (/** @type {any} */ c) => void follows.push(c),
    nextNumber: history.nextNumber,
    queuedAnswer,
    wstore: { save: (/** @type {string} */ id, /** @type {any} */ p) => void kept.set(id, p), clear: (/** @type {string} */ id) => void kept.delete(id), read: (/** @type {string} */ id) => kept.get(id) ?? null },
    readOnlyNow: () => false,
    followsStill: () => false,
    viewOnlyPage: () => false,
    hydrate: async (/** @type {any} */ c) => {
      reads.push(c);
      order.push("read");
      await io.read?.(c);
    },
    sendMessage: (/** @type {string} */ text, /** @type {any[]} */ _files, /** @type {any} */ _modifier, /** @type {any} */ o) => {
      order.push("send");
      words.push(text);
      return io.send(o);
    },
    onSessionView: (/** @type {any} */ c, /** @type {(view: any) => void} */ fn) => {
      if (!watching.has(c)) watching.set(c, new Set());
      watching.get(c)?.add(fn);
      return () => watching.get(c)?.delete(fn);
    },
  });
  /**
   * A message that met `holder`'s turn, its row armed as the 409 path arms it among the chat's turns, its copy kept for a
   * reload. @param {any} holder @param {{ attachments?: any[], text?: string, opts?: any }} [o]
   */
  const waitOn = (holder, o = {}) => {
    /** @type {any} */
    const turn = { n: 2, status: "waiting" };
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", turns: [turn], view: { holder } });
    state.chats.set("c1", chat);
    const payload = { text: "next", attachments: [], holder, ...o };
    kept.set("s-c1", payload);
    armWaiting(chat, turn, payload);
    drawn.length = 0;
    return { chat, turn, q: queued, queue: made, payload };
  };
  /** @param {any} chat @param {any} holder */
  const view = (chat, holder) => {
    chat.view = { ...chat.view, holder };
    for (const fn of [...(watching.get(chat) || [])]) fn(chat.view);
  };
  return { io, state, stops, drawn, kept, enqueued, dropped, started, reads, order, waitOn, view, follows, goOns, lines, words, items, lives };
}

/** The server's refusal of a send while a turn of the harness's own holds the session (its 409, with the holder). */
const refusedByHarness = () => ({ reply: { httpStatus: 409, errorBody: { holder: HARNESS } } });

/**
 * The page's send (app.js `sendMessage`), lifted among `scope`'s names with what each send here takes: no /flow, no /plan, no /steer-fork and no `@` names in its words, the session writable and made ready, no card's row to give way; `post`
 * answers for `postTurn`; `more`, the page's functions it calls that run whole beside it.
 * @param {Record<string, any>} scope @param {(o: any) => Promise<any>} post @param {string[]} [more]
 * @returns {(text: string, attachments: any[], modifier?: string, o?: any) => Promise<any>}
 */
function sendLift(scope, post, more = []) {
  const given = {
    flowWordsOf: () => null,
    planWordsOf: () => null,
    steerForkOf: () => null,
    usesIn: () => [],
    teamUsesIn: () => [],
    readOnlyNow: () => false,
    followsStill: () => false,
    viewOnlyPage: () => false,
    readySession: async (/** @type {any} */ c) => ({ chat: c, model: "m-1" }),
    withoutAsked: () => null,
    unsent: history.unsent,
    nextNumber: history.nextNumber,
    renumbered: history.renumbered,
  };
  // A test's own names stand: a /flow's words, the copy kept for a reload. Its post is the one it hands in.
  for (const [k, v] of Object.entries(given)) if (!(k in scope)) scope[k] = v;
  scope.postTurn = post;
  return lift(["sendMessage", "compactingBetween?", ...more], scope).sendMessage;
}

describe("a message that waits for a running turn", () => {
  // (fails before: yes — on c97b98c59 the row's Stop was looked at again at the queue's ticks alone, two seconds apart:
  // after a coding agent's own turn gave the session to another harness tab's turn, the row went on offering Stop it and
  // go first until the next tick, and the stop route stops whichever harness turn holds the session)
  test("on a chat's move it has Cancel and no Stop; on a coding agent's turn of its own, Stop it and go first while that turn holds the session, looked at again the moment the view hears the holder change", () => {
    const w = waitingPage();
    const moving = w.waitOn(MOVE);
    assert.deepEqual([typeof moving.turn.cancelWait, moving.turn.stopIt ?? null], ["function", null], "a chat's move: waited out");
    const own = w.waitOn(OWN);
    assert.equal(typeof own.turn.stopIt, "function", "the agent's own turn: the harness's to stop");
    own.turn.stopIt();
    assert.deepEqual(w.stops, ["/sessions/s-c1/stop"], "through the session's stop");
    // The agent's own turn hands the session to another harness tab's turn: the feed says so, before any tick.
    w.view(own.chat, HARNESS);
    assert.deepEqual([own.turn.stopIt, w.drawn], [null, [own.turn]], "no Stop for that turn, at once, and the row drawn again");
    w.view(own.chat, HARNESS);
    assert.equal(w.drawn.length, 1, "nothing changed: the row stands as it is drawn");
    w.view(own.chat, OWN);
    assert.deepEqual([typeof own.turn.stopIt, w.drawn.length], ["function", 2], "the agent's own turn again: offered again");
    w.view(own.chat, MOVE);
    assert.equal(own.turn.stopIt, null, "a chat's move: waited out");
  });

  // (fails before: yes — on c97b98c59 the row was spent, and its copy kept for a reload cleared, once `sendMessage` had
  // resolved, which is when the turn its message started ends: the row stood over that turn with its line and Cancel,
  // a Cancel there marked it stopped while the message ran, and a reload meanwhile armed it again and sent the message a
  // second time at that turn's end)
  test("its row is spent the moment its message goes — no line, Cancel or Stop over the turn it starts, no copy kept for a reload — not when that turn ends; given back once it went, it waits again", async () => {
    const w = waitingPage();
    const { chat, turn, q } = w.waitOn(OWN);
    w.view(chat, null);
    /** @type {any} */
    let stopAsItWent = "unset";
    /** @type {() => void} */
    let ends = () => {};
    w.io.send = (o) =>
      new Promise((done) => {
        stopAsItWent = turn.stopIt;
        // The message goes as a turn of its own: its row drawn, its request on its way (app.js `sendMessage`'s `goes`).
        o?.goes?.();
        ends = () => done(undefined);
      });
    const sending = q.send();
    await settled();
    assert.equal(stopAsItWent, null, "nothing left to stop as the message went");
    assert.deepEqual([turn.status, turn.waitingText, turn.cancelWait, turn.stopIt, chat.waiting, w.kept.has("s-c1")], ["done", null, null, null, null, false], "spent while the turn it started runs");
    assert.equal(w.drawn.at(-1), turn, "drawn again, its line and buttons gone");
    w.view(chat, OWN);
    assert.equal(turn.stopIt, null, "a spent row offers nothing as the holder moves");
    ends();
    assert.equal(await sending, null);
    assert.deepEqual([turn.status, chat.waiting, w.kept.has("s-c1")], ["done", null, false], "the turn's end changes nothing of it");
    // The page gives it back once it went (a turn of the harness's own held the session): it waits again on its row.
    const back = w.waitOn(OWN);
    w.io.send = async (o) => {
      o?.goes?.();
      return false;
    };
    w.view(back.chat, null);
    assert.equal(await back.q.send(), back.payload.holder, "it waits again, on the holder it was armed with");
    assert.deepEqual([back.turn.status, typeof back.turn.cancelWait, back.chat.waiting === back.queue, w.kept.get("s-c1")], ["waiting", "function", true, back.payload], "its line, Cancel and kept copy back");
    w.view(back.chat, OWN);
    assert.equal(typeof back.turn.stopIt, "function", "its Stop follows the holder again");
  });

  // (fails before: no — a guard: another holder first, and Cancel, were right on c97b98c59 once the send had ended)
  test("another holder takes the session first: this row is spent and the new one waits with its own copy; cancelled, a row offers nothing more", async () => {
    const w = waitingPage();
    const raced = w.waitOn(OWN);
    const next = { text: "Waiting — …" };
    const nextCopy = { text: "next", attachments: [], holder: MOVE };
    w.io.send = async (o) => {
      o?.goes?.();
      // The 409 path: the message waits again on a row of its own (app.js `armWaiting` for that turn).
      raced.chat.waiting = next;
      w.kept.set("s-c1", nextCopy);
    };
    w.view(raced.chat, null);
    assert.equal(await raced.q.send(), null);
    assert.deepEqual([raced.turn.status, raced.turn.stopIt, raced.turn.cancelWait, raced.chat.waiting, w.kept.get("s-c1")], ["done", null, null, next, nextCopy], "this row is spent, the new one waits with its copy");
    assert.equal(w.drawn.at(-1), raced.turn);
    const cancelled = w.waitOn(OWN);
    cancelled.turn.cancelWait();
    assert.deepEqual([cancelled.turn.status, cancelled.turn.stopIt, cancelled.turn.cancelWait, w.kept.has("s-c1"), w.drawn], ["stopped", null, null, false, [cancelled.turn]]);
  });

  // (fails before: yes — on 32afa3f3f a send answered "queue" — a turn runs in the chat that takes no words now: a coding
  // agent's that queues them, one followed here with no run to follow, a /flow — spent the row as though its message had
  // gone: its copy kept for a reload cleared, and the message in no queue at all, lost)
  test("its send answered \"queue\" — a turn running in the chat takes no words now: the message joins the chat's queue whole, and the row gives way to it with its copy kept for a reload", async () => {
    const w = waitingPage();
    const picture = { name: "shot.png", kind: "image", type: "image/png", size: 3, data: "AAAA" };
    const { chat, turn, q } = w.waitOn(MOVE, { attachments: [picture] });
    w.io.send = async () => "queue";
    w.view(chat, null);
    assert.equal(await q.send(), null, "it waits on no row: the chat's queue sends it");
    assert.deepEqual(w.items, [{ text: "next", files: [picture] }], "in the chat's queue, its files with it");
    assert.deepEqual([chat.turns, w.dropped, chat.waiting, w.kept.has("s-c1")], [[], [turn], null, false], "its row gone, and its copy kept for a reload");
    w.view(chat, OWN);
    assert.equal(turn.stopIt ?? null, null, "the row hears the holder no more");
    const plain = w.waitOn(MOVE);
    w.view(plain.chat, null);
    await plain.q.send();
    assert.equal(w.items[0], "next", "words alone join as words");
  });

  // (fails before: yes — the review of f50fcf6f9: the row's message joined the queue as its words alone, ["go on"]: the
  // answers it overruled, past a card's question and a switch's form all dropped)
  test("a waiting row's message that joins the chat's queue keeps what went with it: the answers it overrules, past a card's question, a switch's form", async () => {
    const w = waitingPage();
    const overrules = [{ agentId: "a1", exchange: 1, name: "Reviewer", question: "q", answer: "a" }];
    const { chat, q } = w.waitOn(MOVE, { text: "go on", opts: { sendAsIs: true, carry: "summary", overrules } });
    w.io.send = async () => "queue";
    w.view(chat, null);
    assert.equal(await q.send(), null);
    assert.deepEqual(w.items, [{ text: "go on", files: [], overrules, sendAsIs: true, carry: "summary" }]);
    // The queue hands what it answers to the page's send (the composer's drain, a chat not shown's).
    assert.deepEqual(queuedAnswer(w.items[0]), { sendAsIs: true, carry: "summary" });
    assert.match(APP_SRC, /onSend: \(text, attachments, modifier, o\) => sendMessage\(text, attachments, modifier, \{ modeSwitch: o\?\.modeSwitch === true, queued: o\?\.queued === true, overrules: o\?\.overrules \|\| \[\], sendAsIs: o\?\.sendAsIs === true, carry: o\?\.carry \|\| null,/);
  });

  // (fails before: yes — the review of eae666f64: the switch's words joined the queue as words alone,
  // [["Switched to Ask"], {}], to go at the turn's end as a plain message)
  test("a permission switch's words that waited on their row and join the chat's queue stay the switch's answer to its waiting call — never a plain message", async () => {
    const w = waitingPage();
    const { chat, q } = w.waitOn(MOVE, { text: "Switched to Ask", opts: { modeSwitch: true } });
    w.io.send = async () => "queue";
    w.view(chat, null);
    assert.equal(await q.send(), null);
    assert.deepEqual([w.items, queuedAnswer(w.items[0])], [[{ text: "Switched to Ask", files: [], modeSwitch: true }], { modeSwitch: true }]);
    assert.match(APP_SRC, /onSend: \(text, attachments, modifier, o\) => sendMessage\(text, attachments, modifier, \{ modeSwitch: o\?\.modeSwitch === true,/, "and the queue's send says so");
  });

  // (fails before: yes — on 32afa3f3f the row a reload restored was laid out (`startTurn`) and armed, and nothing drew its
  // footer: its line, Cancel and Stop it and go first stood nowhere until the chat was drawn whole again)
  test("a reload restores the message's row with its footer, drawn once it is armed", async () => {
    const state = { currentId: "c1", chats: new Map(), compactingHeard: new Map(), commands: new Map() };
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", turns: [] });
    state.chats.set("c1", chat);
    /** Each draw of a footer: the row's status, its line, and whether it has Cancel and Stop. @type {any[][]} */
    const feet = [];
    const { hydrate } = lift(["hydrate", "armWaiting"], {
      state, newestOnRecord: history.newestOnRecord,
      api: async () => ({ turns: [], live: OWN }),
      chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
      opening: new WeakSet(),
      transcriptTurns: () => [],
      withReadWork: (/** @type {any[]} */ t) => t,
      withReadRuns: (/** @type {any[]} */ t) => t,
      transcriptWhole, writtenSince,
      mergedTurns: (/** @type {any[]} */ _page, /** @type {any[]} */ read) => read,
      applySessionView: (/** @type {any} */ c, /** @type {any} */ part) => void (c.view = { ...(c.view || {}), ...part }),
      readSince,
      waitingOwes: waiting.waitingOwes,
      wstore: { read: () => ({ text: "next", attachments: [], holder: OWN }), save() {}, clear() {} },
      holderFromView,
      createWaitingQueue: () => ({ text: "Waiting — Claude Code is working on its own · 1 min · idle 0 s", cancel() {}, stop: async () => {} }),
      onSessionView: () => () => {},
      transcript: standIn({ drawFoot: (/** @type {any} */ t) => void feet.push([t.status, t.waitingText, typeof t.cancelWait, typeof t.stopIt]) }),
    });
    await hydrate(chat);
    assert.deepEqual(feet, [["waiting", "Waiting — Claude Code is working on its own · 1 min · idle 0 s", "function", "function"]]);
    assert.equal(chat.turns.at(-1)?.status, "waiting");
  });

  // (fails before: yes — the map of 11-01 (P4, B11): the message that met the chat held waited as words alone — a /flow's
  // words without the /flow, a switch's or a card's answer as a plain message — and its row sent it again so)
  test("a message that meets the chat held waits as it was sent: its words as typed and what went with them, kept for a reload, and its row sends it so", async () => {
    /** @type {any[]} */
    const saved = [];
    /** @type {any[]} */
    const armed = [];
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [{ n: 1, status: "done" }], live: null });
    const send = sendLift(
      {
        state: { currentId: "c1" },
        chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null),
        flowWordsOf: (/** @type {string} */ t) => (t.startsWith("/flow ") ? t.slice(6) : null),
        besideStore: { main: () => null, knownChat: () => null },
        wstore: { save: (/** @type {string} */ _id, /** @type {any} */ p) => void saved.push(p), clear() {}, read: () => null },
        armWaiting: (/** @type {any} */ _c, /** @type {any} */ _t, /** @type {any} */ p) => void armed.push(p),
        toast: () => {},
      },
      async () => ({ reply: { httpStatus: 409, errorBody: { holder: MOVE } } }),
    );
    const overrules = [{ agentId: "a1", exchange: 1, name: "Reviewer", question: "q", answer: "a" }];
    await send("/flow ship it", []);
    await send("Switched to Ask", [], "normal", { modeSwitch: true, ours: true });
    await send("go on", [], "normal", { sendAsIs: true, carry: "summary", overrules });
    assert.deepEqual(saved.map((p) => [p.text, p.opts]), [["/flow ship it", {}], ["Switched to Ask", { modeSwitch: true }], ["go on", { sendAsIs: true, carry: "summary", overrules }]]);
    assert.deepEqual(armed, saved, "armed as it is kept");
    const w = waitingPage();
    const { chat: held, q } = w.waitOn(MOVE, { text: "/flow ship it", opts: { modeSwitch: true, carry: "summary" } });
    /** @type {any} */
    let went = null;
    w.io.send = async (o) => {
      went = o;
      o?.goes?.();
    };
    w.view(held, null);
    await q.send();
    assert.deepEqual([w.words.at(-1), went?.modeSwitch, went?.carry], ["/flow ship it", true, "summary"]);
  });

  // (fails before: yes — the 11-01 report (B10) and the map (F-b, P5): a send while a message waited for the chat met the
  // chat held and waited on a second row beside the first, each with a queue of its own sending in its timer's order, the
  // copy kept for a reload holding the newest alone; a switch moved twice sent its answer twice)
  test("while a message waits for the chat, what is typed waits in the chat's queue behind it; a card's answer is refused in words, a switch's goes as none; the row's own send goes", async () => {
    const row = { n: 2, status: "waiting" };
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [{ n: 1, status: "done" }, row], live: null, waiting: { text: "Waiting — …" } });
    /** @type {string[]} */
    const toasts = [];
    let posts = 0;
    const send = sendLift(
      {
        state: { currentId: "c1" },
        chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null),
        toast: (/** @type {string} */ w) => void toasts.push(w),
        refuse: (/** @type {string} */ w) => {
          toasts.push(w);
          return false;
        },
        wstore: { save() {}, clear() {}, read: () => null },
      },
      async () => {
        posts++;
        return { reply: { httpStatus: 409, errorBody: { holder: MOVE } } };
      },
    );
    assert.equal(await send("typed meanwhile", [], "normal", { boxed: true }), "queue");
    assert.equal(await send("from the queue", [], "normal", { queued: true }), "queue");
    assert.equal(await send("again", [], "normal", { replaces: { n: 1, status: "error" } }), false);
    assert.equal(await send("Switched to Ask", [], "normal", { modeSwitch: true, ours: true }), undefined);
    assert.deepEqual([posts, toasts], [0, ["Queued behind the message waiting for this chat", "A message already waits for this chat: send this once that one has gone"]]);
    await send("next", [], undefined, { replaces: row, goes: () => {} });
    assert.equal(posts, 1, "the row's own send goes");
  });

  // (fails before: yes — the review of c2ee8d232: while a message waited on its row, what was sent from outside the box —
  // a card's command (a goal's Accept), a decision's answer, a line from a sub-agent's view, a widget's command, a task's
  // carry-on, Resume's "continue" — was answered "queue" by a send that queued nothing: lost, and unsaid)
  test("while a message waits for the chat, words sent from outside the box wait in the chat's queue behind it, said so", async () => {
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [{ n: 1, status: "done" }], live: null, waiting: { text: "Waiting — …" } });
    /** @type {string[]} */
    const toasts = [];
    /** @type {string[]} */
    const enqueued = [];
    let posts = 0;
    const scope = {
      state: { currentId: "c1" },
      chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null),
      toast: (/** @type {string} */ w) => void toasts.push(w),
      composer: standIn({ enqueue: (/** @type {string[]} */ texts) => void enqueued.push(...texts) }),
      wstore: { save() {}, clear() {}, read: () => null },
    };
    sendLift(scope, async () => {
      posts++;
      return {};
    });
    const { sendOrQueue } = lift(["sendMessage", "compactingBetween?", "sendOrQueue"], scope);
    assert.equal(await sendOrQueue("/goal accept"), "queue");
    await sendOrQueue("continue", { ours: true });
    assert.deepEqual([posts, enqueued, toasts], [0, ["/goal accept", "continue"], ["Queued behind the message waiting for this chat", "Queued behind the message waiting for this chat"]]);
    // Each way of sending from outside the box goes through it.
    /** @type {[string, RegExp][]} */
    const ways = [
      ["a line from a sub-agent's view to the main agent", /start: \(line\) => \{\s*views\.show\("chat"\);\s*void sendOrQueue\(line\);/],
      ["a task's carry-on", /if \(carries\) void sendOrQueue\(carryOnWords\(/],
      ["Resume's continue", /void sendOrQueue\("continue", \{ ours: true \}\)\.then\(/],
      ["a card's command", /onCommand: \(chat, command\) => \{\s*if \(typeof command === "string" && command\.trim\(\)\) void sendOrQueue\(command\.trim\(\)\);/],
      ["a decision's answer", /answer: \(chat, text\) => \{ if \(text\) void sendOrQueue\(text\);/],
      ["a widget's command", /command: \(text\) => \{ void sendOrQueue\(text\); \}/],
    ];
    for (const [way, re] of ways) assert.match(APP_SRC, re, way);
  });

  // (fails before: yes — the owner's of 11-05: a message sent while Compact now's compaction was written went at once, met
  // the context as it was, and the card that asks before a message stood again over the compaction at work)
  test("while a compaction is written between the chat's turns, what is sent waits in the chat's queue and goes once the room is made; a card's own message goes, and Filament's copy holds nothing", async () => {
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [{ n: 1, status: "done" }], live: null, waiting: null });
    const away = /** @type {any} */ ({ id: "c2", chainId: "s-c2", cwd: "H:/w/proj", model: "m-1", turns: [{ n: 1, status: "done" }], live: null, waiting: null });
    /** @type {string[]} */
    const toasts = [];
    /** @type {string[]} */
    const said = [];
    let posts = 0;
    const scope = /** @type {Record<string, any>} */ ({
      state: { currentId: "c1", compacting: new Map(), chats: new Map([["c1", chat], ["c2", away]]) },
      chatOf: (/** @type {string} */ id) => scope.state.chats.get(id) || null,
      chatByChain: (/** @type {string} */ id) => [...scope.state.chats.values()].find((c) => c.chainId === id) || null,
      toast: (/** @type {string} */ w) => void toasts.push(w),
      paintCompacting: () => {},
      paintStatus: () => {},
      composer: standIn({ goOn: () => void said.push("box queue goes on"), setQueue: () => void said.push("box queue drawn") }),
      drainElsewhere: async (/** @type {any} */ c) => void said.push(`${c.id}'s queue goes on`),
      queueOf: (/** @type {any} */ c) => (c.queue ||= queueState()),
      folderIn: { value: "" },
      errText: (/** @type {any} */ e) => String(e?.message || e),
      wstore: { save() {}, clear() {}, read: () => null },
    });
    const send = sendLift(scope, async () => {
      posts++;
      return {};
    }, ["noteCompacting", "roomMade?"]);
    const { noteCompacting } = lift(["noteCompacting", "compactingBetween?", "roomMade?"], scope);
    const { turnRunsIn, compactNow } = lift(["turnRunsIn", "compactingBetween?", "compactNow", "compactAsk?", "roomMade?", "roomNotMade?"], scope);
    noteCompacting("s-c1", { door: "manual", since: 1 });
    assert.equal(await send("typed meanwhile", [], "normal", { boxed: true }), "queue");
    assert.equal(await send("from the queue", [], "normal", { queued: true }), "queue");
    assert.deepEqual([posts, toasts], [0, ["A compaction is being written for this chat — your message waits in the queue, and goes once it is done"]], "the queue's own send is taken back quietly");
    // The card's answer goes as it is: the compaction was its answer.
    void send("the card's message", [], "normal", { sendAsIs: true });
    await settled();
    assert.equal(posts, 1);
    chat.live = null;
    chat.turns = [{ n: 1, status: "done" }];
    noteCompacting("s-c1", { door: "manual", since: 1, step: "writing" });
    assert.deepEqual(said, [], "still written: nothing goes");
    noteCompacting("s-c1", null);
    assert.deepEqual(said, ["box queue goes on"], "the room made: the queue goes on, once");
    noteCompacting("s-c1", { door: "manual", since: 2 });
    noteCompacting("s-c1", null);
    assert.deepEqual(said, ["box queue goes on"], "nothing waited for that one");
    // A card's Compact and send makes room for its own message: it goes first, and the queue at its turn's end.
    noteCompacting("s-c1", { door: "manual", since: 3 });
    assert.equal(await send("behind the card's", [], "normal", { boxed: true }), "queue");
    chat.turns = [{ n: 1, status: "done" }, { n: 2, status: "error", makingRoom: 5 }];
    noteCompacting("s-c1", null);
    assert.deepEqual(said, ["box queue goes on"], "the card's message goes first");
    // Another chat's compaction: its own queue goes on.
    noteCompacting("s-c2", { door: "manual", since: 4 });
    void send("into the chat not shown", [], "normal", { chat: away, queued: true });
    await settled();
    noteCompacting("s-c2", null);
    assert.deepEqual(said, ["box queue goes on", "c2's queue goes on"]);
    // Filament's copy alone: the agent's session goes on as it is.
    chat.turns = [{ n: 1, status: "done" }];
    noteCompacting("s-c1", { door: "copy", since: 5 });
    void send("past the copy", [], "normal", { boxed: true });
    await settled();
    assert.equal(posts, 2, "it went");
    // The review of bf2fbda19. A Retry, or a waiting row's own send, meets the compaction too: it waits (a card's
    // answers and Retry are refused in words before they get here); a new message for the header's other folder opens
    // its new chat there at once.
    chat.live = null;
    chat.turns = [{ n: 1, status: "done" }];
    noteCompacting("s-c1", { door: "manual", since: 6 });
    toasts.length = 0;
    assert.equal(await send("again", [], "normal", { replaces: { n: 1, status: "error" } }), "queue");
    assert.equal(turnRunsIn(chat), true);
    assert.equal(toasts.at(-1), "A compaction is being written for this chat — answer the card once it is done");
    scope.folderIn.value = "H:/w/other";
    void send("a new task there", [], "normal", { boxed: true, fresh: true });
    await settled();
    assert.equal(posts, 3, "it went, to the new chat");
    chat.live = null;
    scope.folderIn.value = "";
    noteCompacting("s-c1", null);
    // A queue paused already says so; what waits for this page's own Compact now from the moment it asks.
    chat.queue = queueState();
    chat.queue.paused = true;
    chat.queue.items.push("older");
    chat.roomWait = false;
    chat.compactAsked = true;
    toasts.length = 0;
    assert.equal(await send("held by the ask", [], "normal", { boxed: true }), "queue");
    assert.match(toasts[0], /paused: Continue sends it once the compaction is done$/);
    chat.compactAsked = false;
    // This page's compaction that made no room: what waited waits paused, saying so, for Continue — never sent into
    // the card that asks before a message.
    chat.queue = queueState();
    chat.queue.items.push("typed meanwhile");
    chat.roomWait = true;
    said.length = 0;
    scope.api = async () => {
      throw Object.assign(new Error("stopped"), { body: { stopped: true } });
    };
    assert.equal(await compactNow(chat), false);
    assert.deepEqual([chat.queue.paused, chat.queue.why, chat.queue.said, chat.roomWait, chat.compactAsked, said], [true, "refused", "The compaction did not make room: what you sent meanwhile waits here", false, 0, ["box queue drawn"]]);
    // (fails before: yes — the review of 8c87a8284) Two asks at once: one refused while the other is written pauses
    // nothing; what waited goes once that one has made room.
    chat.queue = queueState();
    chat.queue.items.push("typed meanwhile");
    chat.roomWait = true;
    chat.compactAsked = 1;
    said.length = 0;
    assert.equal(await compactNow(chat), false);
    assert.deepEqual([chat.queue.paused, chat.roomWait, chat.compactAsked], [false, true, 1], "the other ask still waits");
    chat.compactAsked = 0;
    // A chat opened while its compaction is written: what waits for the room is not paused as the chat's "away".
    assert.match(APP_SRC, /if \(!again && !chat\.live && !\(chat\.roomWait && compactingBetween\(chat\)\)\) openedIdle\(queueOf\(chat\)\);/);
    // The summoned card's Compact with no message: the room made, the queue goes on.
    assert.match(APP_SRC, /if \(s\.ask\.sends\) \{\s+chat\.roomWait = false;\s+void sendSummoned\(chat, s, sendsIn\(chat\)\);\s+\} else roomMade\(chat\);/);
  });

  // (fails before: yes — the review of c2ee8d232: a card's answer while a message waited on its row went to a send that
  // refused it, and the card was told it went — its answers disabled for good, "Your message is on its way" over a message
  // unsent, the error banner's Retry spent)
  test("a card's answer, or a Retry, while a message waits for the chat is refused up front and said: the card is told it did not go", () => {
    /** @type {string[]} */
    const toasts = [];
    const { turnRunsIn } = lift(["turnRunsIn", "compactingBetween?"], { toast: (/** @type {string} */ w) => void toasts.push(w) });
    assert.deepEqual([turnRunsIn({ live: null, waiting: { text: "Waiting — …" } }), turnRunsIn({ live: null, waiting: null })], [true, false]);
    assert.deepEqual(toasts, ["A message already waits for this chat — answer the card once that one has gone"]);
    assert.match(APP_SRC, /onRetry: \(chat, turn\) => \{[\s\S]{0,400}?if \(turnRunsIn\(chat\)\) return false;\s*return sendAsked\(chat, turn\);/, "Retry asks it too");
  });

  // (fails before: yes — the review of bbe9eab53: Continue on refused while a message waited for the chat answered the
  // limit card nothing, so the card stayed spent; and one whose chat began a turn, or got a waiting message, while the
  // session's model was written sent the turn's words again into that)
  test("Continue on while a turn runs in the chat or a message waits for it says false, before the model is written or after, and sends nothing", async () => {
    /** @type {any[]} */
    let did = [];
    const chat = /** @type {any} */ ({ id: "t1", live: null, waiting: { text: "Waiting — …" } });
    const scope = {
      state: { currentId: "t1" },
      chatOf: (/** @type {string} */ id) => (id === "t1" ? chat : null),
      toast: (/** @type {string} */ w) => void did.push(["toast", w]),
      modelOn: () => "claude2/opus",
      writeSessionSettings: async () => {
        did.push(["model written"]);
        chat.live = { runId: "r9" };
        return true;
      },
      sendAgain: () => (did.push(["sent"]), Promise.resolve()),
    };
    const { continueOn } = lift(["continueOn", "turnRunsIn", "compactingBetween?"], scope);
    assert.equal(await continueOn(chat, {}, "claude2"), false);
    assert.deepEqual(did, [["toast", "A message already waits for this chat — answer the card once that one has gone"]], "refused up front: no model written");
    did = [];
    chat.waiting = null;
    assert.equal(await continueOn(chat, {}, "claude2"), false);
    assert.deepEqual(did.map((d) => d[0]), ["model written", "toast"], "a turn began while the model was written: nothing sent");
    did = [];
    chat.live = null;
    scope.writeSessionSettings = async () => (did.push(["model written"]), true);
    const again = lift(["continueOn", "turnRunsIn", "compactingBetween?"], scope);
    assert.equal(await again.continueOn(chat, {}, "claude2"), true);
    assert.deepEqual(did, [["model written"], ["sent"]]);
  });

  /** A page of one chat with a countdown, its timers the test's, for Continue on (`continueOn`, `armResume`); `more`, more
   *  of the page's names. @param {Record<string, any>} [more] */
  const resumePage = (more = {}) => {
    /** @type {{ f: () => void, ms: number, cleared?: boolean }[]} */
    const timers = [];
    /** @type {string[]} */
    const toasts = [];
    /** @type {number[]} */
    const writes = [];
    /** The turns whose limit card the page gave back (`limitBack`). @type {any[]} */
    const backs = [];
    const chat = /** @type {any} */ ({ id: "t1", live: null, waiting: null, turns: [] });
    const page = {
      /** The model's write, given its options (its `signal`). @type {(o?: any) => Promise<boolean>} */
      write: async () => true,
      /** @type {() => Promise<unknown>} */
      send: async () => undefined,
    };
    const scope = {
      window: { setTimeout: (/** @type {() => void} */ f, /** @type {number} */ ms) => timers.push({ f, ms }), clearTimeout: (/** @type {number} */ id) => void (id && (timers[id - 1].cleared = true)) },
      state: { currentId: "t1" },
      chatOf: (/** @type {string} */ id) => (id === "t1" ? chat : null),
      toast: (/** @type {string} */ w) => void toasts.push(w),
      modelOn: () => "claude2/opus",
      againOf: (/** @type {any} */ t) => ({ text: t.userText || "", attachments: [] }),
      writeSessionSettings: (/** @type {any} */ _c, /** @type {any} */ _change, /** @type {any} */ o) => (writes.push(1), page.write(o)),
      sendAgain: () => page.send(),
      errText: (/** @type {any} */ e) => String(e?.message || e),
      transcript: { paintResume() {}, limitBack: (/** @type {any} */ t) => void backs.push(t) },
      // What the last send said where it refused: the page's own `refuse` writes it.
      refusal: "",
      viewOnlyPage: () => false,
      ...more,
    };
    const { continueOn, armResume, refuse, stopContinue } = lift(["continueOn", "turnRunsIn", "compactingBetween?", "armResume", "holdResume?", "stopContinue?", "resumeTook?", "LONGEST_WAIT", "refuse"], scope);
    return { chat, timers, toasts, writes, backs, page, continueOn, armResume, refuse, stopContinue };
  };

  // (fails before: yes — the review of 134f74bd5: the card let go of the countdown and armed it again itself, so a
  // Dismiss or a Cancel while the model was written still armed one nobody saw; a second Continue on wrote a second
  // model; and a refusal after the model was written did not say the session now ran on it)
  test("Continue on holds the countdown while the model is written: refused, it stands again — unless its card was dismissed or its Cancel pressed meanwhile", async () => {
    const T = Date.now() + 3_600_000;
    /** @type {any} */
    const turn = { userText: "go on" };
    for (const meanwhile of ["a turn began", "cancelled", "dismissed", "write failed"]) {
      const p = resumePage();
      p.armResume(p.chat, T);
      /** @type {(v: boolean) => void} */
      let land = () => {};
      p.page.write = () => new Promise((r) => (land = r));
      const going = p.continueOn(p.chat, turn, "claude2");
      assert.deepEqual([p.timers[0].cleared, p.chat.resume?.at], [true, T], `${meanwhile}: held while the model is written — its timer stopped, its time still said`);
      assert.equal(await p.continueOn(p.chat, turn, "claude2"), false, "one Continue on at a time");
      assert.equal(p.writes.length, 1);
      if (meanwhile === "a turn began") p.chat.live = { runId: "r1" };
      if (meanwhile === "cancelled") p.armResume(p.chat, null);
      if (meanwhile === "dismissed") turn.shimDismissed = true;
      land(meanwhile === "a turn began");
      assert.equal(await going, false);
      const stands = meanwhile === "a turn began" || meanwhile === "write failed";
      assert.deepEqual([p.chat.resume?.at ?? null, !!p.chat.resume?.held], [stands ? T : null, false], `${meanwhile}: ${stands ? "armed again" : "let go"}`);
      if (meanwhile === "a turn began") assert.equal(p.toasts.at(-1), "The session runs on claude2/opus now, but a turn began in this chat meanwhile — answer the card once it ends");
      delete turn.shimDismissed;
    }
  });

  // (fails before: yes — the review of 134f74bd5: Continue on never held the countdown — the card let it go, so "sent:
  // let go" failed first — and a turn with nothing to send again had its model written all the same; the review of
  // 19650663a: a send refused after it went armed the countdown again on a card left spent, and said nothing of the model)
  test("Continue on that sent lets the countdown go, and arms it again where the send is refused after all; a turn with nothing to send writes no model", async () => {
    const T = Date.now() + 3_600_000;
    const p = resumePage();
    p.armResume(p.chat, T);
    /** @type {(v: unknown) => void} */
    let answer = () => {};
    p.page.send = () => new Promise((r) => (answer = r));
    assert.equal(await p.continueOn(p.chat, { userText: "go on" }, "claude2"), true);
    assert.equal(p.chat.resume, null, "sent: let go");
    answer(false);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(p.chat.resume?.at, T, "refused after all: armed again");
    assert.deepEqual([p.backs.length, p.toasts.at(-1)], [1, "The session runs on claude2/opus now"], "its card given back, the model said");
    p.page.send = async () => undefined;
    assert.equal(await p.continueOn(p.chat, { userText: "go on" }, "claude2"), true);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(p.chat.resume, null, "gone: let go for good");
    assert.equal(await p.continueOn(p.chat, { userText: "" }, "claude2"), false);
    assert.deepEqual([p.writes.length, p.toasts.at(-1)], [2, "Nothing of this message can go again from here — what went with it is not kept on the page: send it again from the box"]);
  });

  // (fails before: yes — the hunt's lead (e): nothing stopped a model's write that never answered — the countdown's Cancel
  // left it running, "still writing", the countdown held and chat.continuing set for good, every later Continue on
  // refused)
  test("a Continue on whose model's write never answers is stopped by the countdown's Cancel: no clock — the write is aborted, the countdown let go, and the next Continue on goes", async () => {
    const T = Date.now() + 3_600_000;
    const p = resumePage();
    p.armResume(p.chat, T);
    // The write answers only when it is stopped — as the page's own does, quietly and with nothing written.
    p.page.write = (o) => new Promise((r) => o?.signal?.addEventListener("abort", () => r(false)));
    const going = p.continueOn(p.chat, { userText: "go on" }, "claude2");
    assert.deepEqual([!!p.chat.resume?.held, !!p.chat.continuing], [true, true], "held while the model is written");
    // The card's Cancel: its countdown let go.
    p.armResume(p.chat, null);
    assert.equal(await Promise.race([going, new Promise((r) => setTimeout(() => r("still writing"), 50))]), false, "stopped: a way not taken");
    assert.deepEqual([p.chat.resume ?? null, !!p.chat.continuing], [null, false]);
    p.page.write = async () => true;
    assert.equal(await p.continueOn(p.chat, { userText: "go on" }, "claude2"), true, "the next Continue on goes");
  });

  // (fails before: yes — the countdown's fire took no way: the chat's limit card stayed as it was, null, its ways live
  // while "continue" went)
  test("the countdown that fires takes the way of the chat's limit cards not yet taken — each says so and offers none again — given back where its continue is refused, retold where it waits", async () => {
    /** @type {any[]} */
    const got = [];
    for (const answer of [undefined, false, "queue"]) {
      /** @type {string[]} */
      const sent = [];
      const p = resumePage({ sendOrQueue: async (/** @type {string} */ text) => (sent.push(text), answer) });
      const stopped = /** @type {any} */ ({ status: "error", facts: { limit: { freeAt: 0 } } });
      const retried = { status: "error", facts: { limit: { freeAt: 0 } }, limitTaken: { by: "retry", said: "Sent again" } };
      p.chat.turns = [retried, stopped];
      p.armResume(p.chat, Date.now() - 2000);
      p.timers.at(-1)?.f();
      const atFire = stopped.limitTaken ?? null;
      await new Promise((r) => setTimeout(r, 0));
      got.push([answer ?? "went", sent, atFire, stopped.limitTaken ?? null, retried.limitTaken.said]);
    }
    const WENT = { by: "resume", said: "“continue” went at the reset" };
    assert.deepEqual(got, [
      ["went", ["continue"], WENT, WENT, "Sent again"],
      [false, ["continue"], WENT, null, "Sent again"],
      ["queue", ["continue"], WENT, { by: "resume", said: "“continue” waits in this chat's queue" }, "Sent again"],
    ]);
  });

  // (fails before: yes — the lead of 11-02, verified: the read's copy of the turn held no word of the page's, [null, null],
  // so its card offered its ways again)
  test("a read keeps the way a limit card took on a turn this page did not send: the read's copy of the turn — the same turn by its id — takes the page's word, and its card offers none again", async () => {
    const { withReadRuns } = await import("../src/ui/harness/lib/turn-reads.js");
    const meterRecords = new WeakMap();
    const { keptOfTurn } = lift(["keptOfTurn?"], { meterRecords });
    const limit = { freeAt: 0 };
    const taken = { by: "resume", said: "“continue” went at the reset" };
    // A turn drawn from an earlier read — no send of this page's — whose card the countdown took, and the next read.
    const drawn = [{ n: 3, turnId: "t3", past: true, status: "error", facts: { limit }, requestIds: ["r3"], limitTaken: taken }];
    const read = [{ n: 3, turnId: "t3", past: true, status: "error", facts: { limit }, requestIds: ["r3"] }, { n: 4, turnId: "t4", past: true, status: "done", requestIds: ["r4"] }];
    meterRecords.set(drawn[0], { rec: 3 });
    const turns = history.mergedTurns(drawn, withReadRuns(read, drawn, keptOfTurn));
    assert.deepEqual(turns.map((t) => t.limitTaken ?? null), [taken, null]);
    assert.deepEqual(meterRecords.get(turns[0]), { rec: 3 }, "the meter's record goes with it, as it did");
  });

  // (fails before: yes — the lead of 11-02: the read's copy of the turn held no word of the page's, [true, false], so its
  // banner came back)
  test("a read keeps a banner dismissed on a turn this page did not send: the read's copy of the turn takes the page's word, and the banner stays away", async () => {
    const { withReadRuns } = await import("../src/ui/harness/lib/turn-reads.js");
    const { keptOfTurn } = lift(["keptOfTurn?"], { meterRecords: new WeakMap() });
    // A failed turn drawn from an earlier read, its banner dismissed, and the next read.
    const drawn = [{ n: 3, turnId: "t3", past: true, status: "error", error: "The provider refused the request", requestIds: ["r3"], shimDismissed: true }];
    const read = [{ n: 3, turnId: "t3", past: true, status: "error", error: "The provider refused the request", requestIds: ["r3"] }];
    const turns = history.mergedTurns(drawn, withReadRuns(read, drawn, keptOfTurn));
    assert.deepEqual([turns[0] === read[0], turns[0].shimDismissed ?? false], [true, true], "the read's copy, the word kept");
  });

  // (fails before: yes — found reading the code: with no countdown armed nothing kept the write's stop — `holdResume`
  // keeps none —, so the write ran on, "still writing", `chat.continuing` set and every later Continue on refused)
  test("a Continue on with no countdown armed is stopped by the card's own Cancel: its model's write is aborted, and the next Continue on goes", async () => {
    const p = resumePage();
    p.page.write = (o) => new Promise((r) => o?.signal?.addEventListener("abort", () => r(false)));
    const going = p.continueOn(p.chat, { userText: "go on" }, "claude2");
    assert.deepEqual([p.chat.resume ?? null, !!p.chat.continuing], [null, true], "no countdown armed; the way under way");
    p.stopContinue?.(p.chat);
    const got = await Promise.race([going, new Promise((r) => setTimeout(() => r("still writing"), 50))]);
    assert.deepEqual([got, !!p.chat.continuing], [false, false], "stopped: a way not taken");
    p.page.write = async () => true;
    assert.equal(await p.continueOn(p.chat, { userText: "go on" }, "claude2"), true, "the next Continue on goes");
  });

  // (fails before: yes — the hunt's lead (e): a send refused after it went, its reset time passed by then, armed the
  // countdown again for that time, { at: T }, which fired "continue" at once into the same refusal and was spent)
  test("Continue on refused after it went, its reset time passed by then, arms no countdown to fire into the same refusal: its card comes back, Retry its way on", async () => {
    const T = Date.now() + 30;
    const p = resumePage();
    p.armResume(p.chat, T);
    /** @type {(v: unknown) => void} */
    let answer = () => {};
    p.page.send = () => new Promise((r) => (answer = r));
    assert.equal(await p.continueOn(p.chat, { userText: "go on" }, "claude2"), true);
    await new Promise((r) => setTimeout(r, 60));
    answer(false);
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual([p.chat.resume ?? null, p.backs.length], [null, 1], "no countdown armed; its card given back");
  });

  // (fails before: yes — the review of 0949c570d: the countdown held stood again at its passed time, { at: T, wait: 0 },
  // and fired "continue" at once each way — into the read-only refusal the words or the model's write met, its toast
  // taking the one that said the model, and behind the turn begun meanwhile that the card said to wait for)
  test("Continue on that went nowhere, its reset time passed while the model was written, arms no countdown to fire at once — into what stopped it, or behind the turn its card is to be answered after: the card comes back as it stood", async () => {
    const READ_ONLY = "This session is open for writing in another tab — choose Take over here to write from this one";
    /** @type {any[]} */
    const got = [];
    for (const how of ["refused at once", "write refused", "a turn began"]) {
      let now = 1_000_000;
      const T = now + 60_000;
      /** What the countdown sent. @type {string[]} */
      const fired = [];
      /** @type {any} */
      let p = null;
      p = resumePage({
        Date: { now: () => now },
        // Another tab writes the session now: its "continue" is refused as the words were.
        sendOrQueue: (/** @type {string} */ text) => (fired.push(text), Promise.resolve(p.refuse(READ_ONLY))),
        queueNext: (/** @type {any} */ _chat, /** @type {string[]} */ texts) => void fired.push(...texts),
      });
      p.armResume(p.chat, T);
      /** @type {(v: boolean) => void} */
      let land = () => {};
      p.page.write = () => new Promise((r) => (land = r));
      p.page.send = () => Promise.resolve(p.refuse(READ_ONLY));
      const going = p.continueOn(p.chat, { userText: "go on" }, "claude2");
      now = T + 5_000;
      if (how === "a turn began") p.chat.live = { runId: "r1" };
      land(how !== "write refused");
      assert.equal(await going, false, how);
      const armed = p.chat.resume ? { at: p.chat.resume.at, wait: p.timers.at(-1)?.ms } : null;
      for (const t of p.timers.filter((/** @type {any} */ t) => !t.cleared)) t.f();
      got.push([how, armed, fired, p.toasts.at(-1) ?? null]);
    }
    // The toast each leaves is its own: the send's refusal with the model, none where the page's write said why, the turn
    // begun meanwhile.
    assert.deepEqual(got, [
      ["refused at once", null, [], `The session runs on claude2/opus now, but the message did not go: ${READ_ONLY}`],
      ["write refused", null, [], null],
      ["a turn began", null, [], "The session runs on claude2/opus now, but a turn began in this chat meanwhile — answer the card once it ends"],
    ]);
  });

  // (fails before: yes — the review of 19650663a: a send refused at once — the tab turned read-only while the model was
  // written — answered Continue on true, the countdown let go and the card spent; and a write that threw left the
  // countdown held and every later Continue on refused)
  test("Continue on whose send is refused at once is a way not taken: the countdown stands again; a write that throws lets the hold go", async () => {
    const T = Date.now() + 3_600_000;
    const p = resumePage();
    p.armResume(p.chat, T);
    p.page.send = () => Promise.resolve(false);
    assert.equal(await p.continueOn(p.chat, { userText: "go on" }, "claude2"), false);
    assert.deepEqual([p.chat.resume?.at, !!p.chat.resume?.held, p.backs.length], [T, false, 0], "armed again, the card its own to give back");
    p.page.write = async () => {
      throw new Error("a listener broke");
    };
    assert.equal(await p.continueOn(p.chat, { userText: "go on" }, "claude2"), false);
    assert.deepEqual([p.chat.resume?.at, !!p.chat.resume?.held, !!p.chat.continuing], [T, false, false], "the hold let go, the next Continue free");
    assert.equal(p.toasts.at(-1), "a listener broke");
  });

  // (fails before: yes — the review of 6361f59e6: the model's toast took the one slot the refusal's words had just
  // taken, so a refused send said only "The session runs on claude2/opus now"; and a send that threw made Continue on
  // throw, its card left going with every way off)
  test("Continue on whose send is refused says the model with the refusal's words, at once or after it went; a send that throws is refused in its words", async () => {
    const said = (/** @type {string} */ why) => `The session runs on claude2/opus now, but the message did not go: ${why}`;
    const READ_ONLY = "This session is open for writing in another tab — choose Take over here to write from this one";
    for (const when of ["at once", "after it went"]) {
      const p = resumePage();
      p.page.send = when === "at once" ? () => Promise.resolve(p.refuse(READ_ONLY)) : async () => (await null, p.refuse("This chat is its client's"));
      assert.equal(await p.continueOn(p.chat, { userText: "go on" }, "claude2"), when === "after it went");
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(p.toasts.at(-1), said(when === "at once" ? READ_ONLY : "This chat is its client's"), when);
    }
    const p = resumePage();
    p.page.send = () => Promise.reject(new Error("the page broke"));
    const went = await p.continueOn(p.chat, { userText: "go on" }, "claude2");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(p.toasts.at(-1), said("the page broke"));
    assert.ok(went === false || p.backs.length === 1, "a way not taken, or its card given back");
  });

  // (fails before: yes, at bbe9eab53's parent — the composer had no enqueueFirst; the page's stand-in above did its own
  // unshift, so the real one was run by no test — the review of bbe9eab53)
  test("the composer's enqueueFirst: the waiting row's message goes ahead of what the queue holds, and goes at once when nothing runs and the queue is not paused", async () => {
    const doc = stubDocument();
    try {
      const { createComposer } = await import("../src/ui/harness/composer/composer.js");
      const { queueState } = await import("../src/ui/harness/composer/queue.js");
      /** @type {string[]} */
      const sent = [];
      const host = /** @type {any} */ (doc.document.createElement("div"));
      const c = /** @type {any} */ (createComposer(host, { onSend: (/** @type {string} */ text) => (sent.push(text), true), onStop: () => {}, getChat: () => ({ chainId: "c1", turns: [] }) }));
      const st = queueState();
      c.setQueue(st);
      c.setLive(true, null, "waiting");
      c.enqueue(["typed after it"]);
      c.enqueueFirst("the row's message");
      assert.deepEqual([st.items, sent], [["the row's message", "typed after it"], []], "first, and nothing goes while the chat is live");
      c.setLive(false);
      st.paused = true;
      c.enqueueFirst("another");
      assert.deepEqual([st.items, sent], [["another", "the row's message", "typed after it"], []], "a paused queue holds it, first");
      st.paused = false;
      c.enqueueFirst("the newest row's");
      await new Promise((r) => setTimeout(r, 0));
      assert.deepEqual([st.items, sent], [["another", "the row's message", "typed after it"], ["the newest row's"]], "idle and going on: it goes at once, ahead of the rest");
    } finally {
      doc.restore();
    }
  });

  // (fails before: yes — the map of 11-01 (P10): a row whose message went as a note into the chat's running turn stood on
  // as a turn "done" of its own with no reply, which the next send numbered after)
  test("its message gone as a note into the chat's running turn: the row gives way, as it does to the chat's queue", async () => {
    const w = waitingPage();
    const { chat, turn, q } = w.waitOn(MOVE);
    w.io.send = async () => undefined;
    w.view(chat, null);
    assert.equal(await q.send(), null);
    assert.deepEqual([chat.turns, w.dropped, chat.waiting, w.kept.has("s-c1")], [[], [turn], null, false]);
  });

  // (fails before: yes — the map of 11-01 (P11): a harness turn that took the chat while this page's own send was out —
  // the feed's word found the chat live — was never drawn while the row waited)
  test("a harness turn holding the chat while the row waits is followed: once shown and not live", async () => {
    const w = waitingPage();
    const { chat, q } = w.waitOn(MOVE);
    w.view(chat, HARNESS);
    assert.equal(await q.free(), HARNESS);
    assert.deepEqual(w.follows, [chat]);
    chat.live = { turn: {} };
    await q.free();
    chat.live = null;
    w.state.currentId = "c2";
    await q.free();
    w.state.currentId = "c1";
    w.view(chat, MOVE);
    await q.free();
    assert.equal(w.follows.length, 1, "not while live, not where another chat is shown, not for a move");
  });

  // (fails before: yes — what is typed while a message waits goes in the chat's queue behind it: a Cancel of that message
  // left the queue waiting on nothing)
  test("cancelled, what waited behind it in the chat's queue goes on", () => {
    const w = waitingPage();
    w.waitOn(MOVE).turn.cancelWait();
    assert.equal(w.goOns.length, 1);
  });

  // (fails before: yes — the review of c2ee8d232: a row whose message joined the chat's queue went behind what was typed
  // while it waited, which was sent after it)
  test("its message joining the chat's queue goes first, ahead of what was typed while it waited", async () => {
    const w = waitingPage();
    const { chat, q } = w.waitOn(MOVE);
    w.items.push("typed while it waited");
    w.io.send = async () => "queue";
    w.view(chat, null);
    await q.send();
    assert.deepEqual(w.items, ["next", "typed while it waited"]);
  });

  // (fails before: yes — the review of c2ee8d232: the row's tick set the composer idle every two seconds while a turn
  // followed here ran in the chat — no Stop, and Enter steered what was typed into that turn instead of queueing it)
  test("its tick leaves the composer to a turn followed here while that turn runs, and waits with the row again after", () => {
    const w = waitingPage();
    const { chat, turn, q } = w.waitOn(HARNESS);
    q.onTick("Waiting — 1 min");
    chat.live = { turn: {} };
    q.onTick("Waiting — 2 min");
    assert.deepEqual([w.lives, turn.waitingText], [[[false, null, "waiting"]], "Waiting — 2 min"], "the line moves on; the composer is the followed turn's");
    chat.live = null;
    q.onTick("Waiting — 3 min");
    assert.equal(w.lives.length, 2, "that turn over: the composer waits with the row");
  });

  // (fails before: yes — a row given back numbered itself after every turn the page held, a row withdrawn among them, which
  // is on no record and shares its number with the turn sent after it)
  test("given back, the row numbers on after the turns on record", async () => {
    const w = waitingPage();
    const { chat, turn, q } = w.waitOn(OWN);
    w.io.send = async (o) => {
      o?.goes?.();
      chat.turns = [{ n: 1, status: "done" }, { n: 2, status: "stopped", withdrawn: true }];
      return false;
    };
    w.view(chat, null);
    await q.send();
    assert.deepEqual([turn.n, chat.turns.at(-1) === turn, w.kept.get("s-c1")?.text], [2, true, "next"]);
  });

  // (fails before: yes — the review of 9f0185fbe: the row a reload restored held the message's words alone: no chips, and
  // its Retry, once withdrawn, sent the words without the files — nothing at all where it was files alone)
  test("the row a reload restores holds the message's files: its chips, and the whole of them for a way on", async () => {
    const pic = { kind: "image", name: "shot.png", size: 3, type: "image/png", data: "AAAA" };
    const state = { currentId: "c1", chats: new Map(), compactingHeard: new Map(), commands: new Map() };
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", turns: [] });
    state.chats.set("c1", chat);
    const { hydrate } = lift(["hydrate", "armWaiting"], {
      state, newestOnRecord: history.newestOnRecord,
      api: async () => ({ turns: [], live: OWN }),
      chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
      opening: new WeakSet(),
      transcriptTurns: () => [],
      withReadWork: (/** @type {any[]} */ t) => t,
      withReadRuns: (/** @type {any[]} */ t) => t,
      transcriptWhole, writtenSince,
      mergedTurns: (/** @type {any[]} */ _page, /** @type {any[]} */ read) => read,
      applySessionView: (/** @type {any} */ c, /** @type {any} */ part) => void (c.view = { ...(c.view || {}), ...part }),
      readSince,
      waitingOwes: waiting.waitingOwes,
      wstore: { read: () => ({ text: "", attachments: [pic], holder: OWN }), save() {}, clear() {} },
      holderFromView,
      attachmentBlock,
      createWaitingQueue: () => ({ text: "Waiting", cancel() {}, stop: async () => {} }),
      onSessionView: () => () => {},
      transcript: standIn({}),
    });
    await hydrate(chat);
    const row = chat.turns.at(-1);
    assert.deepEqual([row?.status, row?.attachments], ["waiting", [{ name: "shot.png", size: 3, kind: "image" }]]);
    assert.deepEqual(againOf(row).attachments, [pic], "its Retry sends the picture");
  });

  // (fails before: yes — the drive of fe86a180d: the row stayed beside the turn its send drew, a "done" row of the same
  // words, and that turn took its number past it — one message on two rows, the turn numbered one past the server's)
  test("the row gives way to the turn its send draws; refused once it went, it is drawn again and waits", async () => {
    const w = waitingPage();
    const { chat, turn, q } = w.waitOn(OWN);
    /** @type {any} */
    let asked = null;
    w.io.send = async (o) => {
      asked = o;
      o?.goes?.();
    };
    w.view(chat, null);
    await q.send();
    assert.equal(asked?.replaces, turn, "its send's own row takes its place");
    const back = w.waitOn(OWN);
    w.io.send = async (o) => {
      // The row gave way to the send's (app.js `sendMessage`, `withoutAsked`), which the refusal then took away.
      back.chat.turns = back.chat.turns.filter((/** @type {any} */ t) => t !== o.replaces);
      o?.goes?.();
      return false;
    };
    w.view(back.chat, null);
    assert.equal(await back.q.send(), back.payload.holder);
    assert.deepEqual([back.chat.turns, w.started, back.turn.status], [[back.turn], [back.turn], "waiting"], "its row back, drawn again, waiting");
  });

  // (fails before: yes — the drive of fe86a180d: a waiting row is on no record, yet stayed among the chat's turns as the
  // send drew its own, which took the number after it: the page asked memory of a turn the session does not have)
  test("a waiting row's send draws its turn in the row's place, numbered after the chat's turns before it", async () => {
    const done = { n: 1, status: "done" };
    const row = { n: 2, status: "waiting" };
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [done, row], live: null });
    /** @type {Record<string, any>} */
    const scope = { state: { currentId: "c1" }, chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null) };
    const send = sendLift(scope, () => new Promise(() => {}));
    scope.withoutAsked = withoutAsked;
    void send("next", [], undefined, { goes: () => {}, replaces: row });
    await settled();
    assert.deepEqual(chat.turns.map((/** @type {any} */ t) => [t.n, t.userText ?? null]), [[1, null], [2, "next"]]);
    assert.ok(!chat.turns.includes(row), "the waiting row gave way");
  });

  // (fails before: yes — the review of dea50ef1f: a waiting row, on no record, hid the server's turn of its number — a
  // coding agent's own turn that began while it waited — and its send took that number)
  test("a read keeps a waiting row after the server's turns, numbered on: the turn that ran while it waited is drawn", () => {
    const row = { n: 2, status: "waiting", boundaries: [], boundariesAfter: [] };
    const server = [{ n: 1, boundaries: [], boundariesAfter: [] }, { n: 2, own: true, boundaries: [], boundariesAfter: [] }];
    const turns = mergedTurns([row], server);
    assert.deepEqual(turns.map((/** @type {any} */ t) => [t.n, t === row ? "row" : t.own ? "own" : "server"]), [[1, "server"], [2, "own"], [3, "row"]]);
  });

  // (fails before: yes — the review of dea50ef1f: a message that waited on a coding agent's own turn went as that turn
  // ended, before the page had read it: the turn it started took the agent's turn's number)
  test("a message that waited on a coding agent's own turn reads the chat before it goes; one that waited on a move goes at once", async () => {
    const w = waitingPage();
    const own = w.waitOn(OWN);
    w.io.send = async (o) => void o?.goes?.();
    w.view(own.chat, null);
    await own.q.send();
    assert.deepEqual([w.reads, w.order], [[own.chat], ["read", "send"]], "read once, before it went");
    w.order.length = 0;
    const moving = w.waitOn(MOVE);
    w.view(moving.chat, null);
    await moving.q.send();
    assert.deepEqual([w.reads.length, w.order], [1, ["send"]], "a move adds no turn: nothing read first");
  });

  // (fails before: yes — the review of c3e13b868: the read before the row's send took its time, and the message then went
  // into whichever chat was shown, or after its row was cancelled. And the review of d53154737: shown again, it went with
  // no second read, though a hidden chat hears no turn of the agent's own begin)
  test("a row whose read before it goes outlasts its chat on screen waits to be shown again; one cancelled meanwhile sends nothing", async () => {
    const w = waitingPage();
    /** @type {() => void} */
    let land = () => {};
    const slow = () => new Promise((/** @type {(v?: any) => void} */ r) => (land = r));
    const own = w.waitOn(OWN);
    w.io.send = async (o) => void o?.goes?.();
    w.io.read = slow;
    w.view(own.chat, null);
    const going = own.q.send();
    await settled();
    w.state.currentId = "c2";
    land();
    assert.equal(await going, own.payload.holder, "it waits to be shown again");
    assert.deepEqual(w.order, ["read"], "nothing went into the chat shown now");
    w.state.currentId = "c1";
    w.io.read = null;
    assert.equal(await own.q.send(), null);
    assert.deepEqual(w.order, ["read", "read", "send"], "shown again, it reads the chat again, and goes");
    const again = w.waitOn(OWN);
    w.order.length = 0;
    w.io.read = slow;
    w.view(again.chat, null);
    const cancelled = again.q.send();
    await settled();
    again.turn.cancelWait();
    land();
    assert.equal(await cancelled, null);
    assert.deepEqual([w.order, again.turn.status], [["read"], "stopped"], "cancelled while it read: nothing sent");
  });

  // (fails before: yes — the review of d53154737: a row cancelled stayed among the chat's turns, on no record, and a read
  // kept it in place of the server's turn of its number — the agent's turn it had waited on)
  test("a row cancelled is withdrawn: a read places it after the server's turns, as a waiting row", () => {
    const w = waitingPage();
    const { turn } = w.waitOn(OWN);
    turn.cancelWait();
    assert.deepEqual([turn.status, turn.withdrawn], ["stopped", true]);
    Object.assign(turn, { boundaries: [], boundariesAfter: [] });
    const server = [{ n: 1, boundaries: [], boundariesAfter: [] }, { n: 2, own: true, boundaries: [], boundariesAfter: [] }];
    assert.deepEqual(mergedTurns([turn], server).map((/** @type {any} */ t) => [t.n, t === turn ? "row" : t.own ? "own" : "server"]), [[1, "server"], [2, "own"], [3, "row"]]);
  });

  // (fails before: yes — the review of d53154737: the queue's tick set the row's words and drew nothing: its minutes stood
  // still until something else drew the row; and the 11-01 report (B12): the line says idle seconds, so at each look of
  // the queue, two seconds apart, the row's whole footer was drawn again — a Cancel under the pointer replaced mid-click)
  test("the row's line is said anew in place as its words change, and only then: its footer is not drawn again", () => {
    const w = waitingPage();
    const { turn, q } = w.waitOn(MOVE);
    q.onTick("Waiting — the chat is moving · 2 min · idle 2 s");
    assert.deepEqual([turn.waitingText, w.lines, w.drawn], ["Waiting — the chat is moving · 2 min · idle 2 s", [turn], []]);
    q.onTick("Waiting — the chat is moving · 2 min · idle 2 s");
    assert.equal(w.lines.length, 1, "the same words: nothing said");
  });

  // (fails before: yes — the review of dea50ef1f: with two rows waiting, the first's send counted the second, a row on no
  // record, and was numbered one past the server's turn)
  test("a waiting row's send is numbered after the turns on record: another row still waiting is none of them", async () => {
    const done = { n: 1, status: "done" };
    const first = { n: 2, status: "waiting" };
    const second = { n: 3, status: "waiting" };
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [done, first, second], live: null });
    /** @type {Record<string, any>} */
    const scope = { state: { currentId: "c1" }, chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null) };
    const send = sendLift(scope, () => new Promise(() => {}));
    scope.withoutAsked = withoutAsked;
    void send("first", [], undefined, { goes: () => {}, replaces: first });
    await settled();
    const sent = chat.turns.find((/** @type {any} */ t) => t.userText === "first");
    assert.equal(sent?.n, 2, "the server's turn 2");
  });

  // (fails before: yes — the review of 9f0185fbe: a message withdrawn while it waited stayed among the turns its Retry,
  // and a message typed after it, were numbered after — one past the server's turn, which a read drew beside it — and the
  // Retry left the row beside the turn it sent)
  test("a withdrawn row's Retry takes the row's place, numbered as the server numbers it; a message typed after one is numbered so too", async () => {
    const done = { n: 1, status: "done" };
    const withdrawn = { n: 2, status: "stopped", withdrawn: true, userText: "hello" };
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [done, withdrawn], live: null });
    /** @type {Record<string, any>} */
    const scope = { state: { currentId: "c1" }, chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null) };
    const send = sendLift(scope, () => new Promise(() => {}));
    scope.withoutAsked = withoutAsked;
    void send("hello", [], "normal", { replaces: withdrawn });
    await settled();
    assert.deepEqual(chat.turns.map((/** @type {any} */ t) => [t.n, t.status]), [[1, "done"], [2, "streaming"]], "its Retry: the server's turn 2, in the row's place");
    Object.assign(chat, { turns: [done, withdrawn], live: null });
    void send("typed", [], undefined, {});
    await settled();
    assert.equal(chat.turns.find((/** @type {any} */ t) => t.userText === "typed")?.n, 2, "typed after it: the server's turn 2");
  });

  // (fails before: yes — the review of 9f0185fbe: a row on no record shares its number with the turn sent after it, and a
  // mark of that number landed on the row)
  test("a mark of a turn's number lands on the turn on record, not on a withdrawn row of its number", () => {
    const rows = () => ({ boundaries: /** @type {any[]} */ ([]), boundariesAfter: /** @type {any[]} */ ([]) });
    const done = { n: 1, status: "done", ...rows() };
    const withdrawn = { n: 2, status: "stopped", withdrawn: true, ...rows() };
    const sent = { n: 2, status: "done", ...rows() };
    const turns = [done, withdrawn, sent];
    assert.equal(placeBoundary(turns, { type: "compaction", fromTurn: 1, toTurn: 2, afterTurn: 2 }), sent, "a compaction after it");
    assert.equal(placeBoundary(turns, { type: "settings", beforeTurn: 2 }), sent, "a settings change before it");
    const chat = { id: "c1", turns };
    const { placeCompaction } = lift(["placeCompaction", "undoOnlyOn?"], { state: { currentId: "c1" }, chatOf: () => chat, turnNumbered: history.turnNumbered, holdsRow: history.holdsRow, newerCompaction: history.newerCompaction, transcript: standIn({}) });
    placeCompaction(chat, { type: "compaction", fromTurn: 2, toTurn: 2, afterTurn: 2 });
    assert.deepEqual([withdrawn.boundaries.length, withdrawn.boundariesAfter.length, sent.boundariesAfter.length], [0, 0, 2], "the compaction Compact now wrote");
  });

  // (fails before: yes — the drive of a3a89f309: a turn another page ran, open as the chat was read with a withdrawn row
  // on the page, was neither followed nor drawn as it ended: the read took the row, placed after every turn, for the
  // chat's newest)
  test("a read follows the turn another page runs, a withdrawn row after it", async () => {
    const state = { currentId: "c1", chats: new Map(), compactingHeard: new Map(), commands: new Map() };
    const withdrawn = { n: 2, status: "stopped", withdrawn: true, userText: "retry me", boundaries: [], boundariesAfter: [] };
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", turns: [withdrawn] });
    state.chats.set("c1", chat);
    const done = { n: 1, past: true, history: true, status: "done", boundaries: [], boundariesAfter: [] };
    const open = { n: 2, past: true, history: true, status: "open", boundaries: [], boundariesAfter: [] };
    const { hydrate } = lift(["hydrate", "followLiveTurn"], {
      state,
      api: async () => ({ turns: [], live: { ...HARNESS, requestId: "r-2", startedAt: 5 } }),
      chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
      opening: new WeakSet(),
      transcriptTurns: () => [done, open],
      withReadWork: (/** @type {any[]} */ t) => t,
      withReadRuns: (/** @type {any[]} */ t) => t,
      transcriptWhole, writtenSince,
      mergedTurns,
      newestOnRecord: history.newestOnRecord,
      unsent: history.unsent,
      applySessionView: (/** @type {any} */ c, /** @type {any} */ part) => void (c.view = { ...(c.view || {}), ...part }),
      readSince,
      waitingOwes: () => null,
      transcript: standIn({}),
      setTimeout: () => 0,
    });
    await hydrate(chat);
    assert.deepEqual(chat.turns.map((/** @type {any} */ t) => [t.n, t === withdrawn ? "row" : t.status]), [[1, "done"], [2, "streaming"], [3, "row"]]);
    assert.equal(open.elsewhere, true, "followed here");
  });

  // (fails before: yes — the drive of a3a89f309: the chat's newest turn was its last row, a withdrawn one among them)
  test("the chat's newest turn is the newest on record: a send's broken connection, its end, a mark with no turn of its number, the question it stopped on", () => {
    const rows = () => ({ boundaries: /** @type {any[]} */ ([]), boundariesAfter: /** @type {any[]} */ ([]) });
    const asked = { n: 1, status: "done", paused: { kind: "question" }, ...rows() };
    const sent = { n: 2, status: "streaming", requestId: "r-2", ...rows() };
    const withdrawn = { n: 3, status: "stopped", withdrawn: true, ...rows() };
    assert.ok(runningOn({ live: { window: "harness", requestId: "r-2" } }, [asked, sent, withdrawn], sent), "its connection broke: it runs on");
    assert.equal(endedOn({ live: null, turns: [{ n: 2, requestIds: ["r-2"], open: false }] }, [asked, sent, withdrawn], sent), "done");
    assert.equal(placeBoundary([asked, withdrawn], { type: "compaction", fromTurn: 1, toTurn: 1, afterTurn: 9 }), asked, "no turn of its number: the newest on record");
    assert.equal(ownLast([asked, withdrawn]), asked, "the question it stopped on still waits");
  });

  // (fails before: yes — the review of a3a89f309: a withdrawn row's Retry gave the row away before it went, and a send
  // refused by a turn of the harness's own took its own row away too: the message was gone, said back in the box)
  test("a withdrawn row's Retry that meets a turn of the harness's own keeps the row and its message", async () => {
    const done = { n: 1, status: "done" };
    const withdrawn = { n: 2, status: "stopped", withdrawn: true, userText: "hello" };
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [done, withdrawn], live: null });
    /** @type {string[]} */
    const toasts = [];
    /** @type {Record<string, any>} */
    const scope = { state: { currentId: "c1" }, chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null), opening: new WeakSet(), followElsewhere: () => {}, toast: (/** @type {string} */ words) => void toasts.push(words) };
    const send = sendLift(scope, async () => refusedByHarness());
    scope.withoutAsked = withoutAsked;
    assert.equal(await send("hello", [], "normal", { replaces: withdrawn }), false);
    assert.deepEqual(chat.turns, [done, withdrawn], "the row stands again");
    assert.deepEqual(toasts, ["This chat's turn is still running — following it now. Your message stays on its row: send it again once the turn ends."]);
  });

  // (fails before: yes — the review of a3a89f309: a message typed while a row waited counted the row, one past the
  // server's number)
  test("a message typed while a row waits is numbered after the turns on record", async () => {
    const done = { n: 1, status: "done" };
    const row = { n: 2, status: "waiting" };
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [done, row], live: null });
    /** @type {Record<string, any>} */
    const scope = { state: { currentId: "c1" }, chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null) };
    const send = sendLift(scope, () => new Promise(() => {}));
    void send("typed", [], undefined, {});
    await settled();
    assert.equal(chat.turns.find((/** @type {any} */ t) => t.userText === "typed")?.n, 2, "the server's turn 2");
  });

  // (fails before: yes — the review of a3a89f309: a switch of who answers was marked after the chat's last row, a
  // withdrawn one, and the engine dividers and "Leading since" read that row as a turn your agent answered)
  test("a row on no record is no one's turn: a switch is marked after the turn before it, and the team still leads", () => {
    const led = { n: 1, status: "done", startedAt: 7, engine: { kind: "team", team: "crew", name: "Crew" }, boundaries: [], boundariesAfter: /** @type {any[]} */ ([]) };
    const withdrawn = { n: 2, status: "stopped", withdrawn: true, boundaries: [], boundariesAfter: /** @type {any[]} */ ([]) };
    const turns = [led, withdrawn];
    assert.deepEqual([...engineDividers(turns).values()].map((d) => d.to), ["team"], "no divider at the row");
    assert.equal(leadingSince(turns, "crew"), 7);
    const chat = { id: "c1", turns };
    const { markEngine } = lift(["markEngine"], { state: { currentId: "c1" }, chatOf: () => chat, newestOnRecord: history.newestOnRecord, widgets: standIn({}) });
    markEngine(chat, "crew", null);
    assert.deepEqual([led.boundariesAfter.map((b) => b.type), withdrawn.boundariesAfter.length], [["engine"], 0]);
  });

  // (fails before: yes — the review of 38aa701ff: the header's Fork and its shortcut opened at the chat's last row this
  // page sent, a withdrawn one among them; the command center's recent changes read it, and listed nothing)
  test("Fork from the header and the recent changes take the newest turn on record", () => {
    const sent = { n: 1, status: "done" };
    const withdrawn = { n: 2, status: "stopped", withdrawn: true };
    const fns = lift(["forkAt?"], { unsent: history.unsent, forkable: history.forkable });
    assert.equal(fns.forkAt?.({ turns: [sent, withdrawn] }), sent, "Fork opens at the turn on record");
    assert.equal((APP_SRC.match(/const last = forkAt\(c\);\s+if \(c && last\) forkModal\(c, last\);/g) || []).length, 2, "the header's Fork and its shortcut");
    const center = readFileSync("src/ui/harness/command-center.js", "utf8");
    assert.match(center, /const last = newestOnRecord\(\(chat\?\.turns \|\| \[\]\)\.filter\(\(\/\*\* @type \{any\} \*\/ t\) => !t\.past && t\.status !== "streaming"\)\);/);
  });

  /**
   * A send through the page's sendMessage after turns 1–3 and a row withdrawn while it waited (numbered 4), its record
   * naming `made`, the compactions the composer made for it, whose rows finish() read from the transcript's newest by
   * their ids (`composedCompactions`); `compactions`, the rows finish() read there for a command's or a coding agent's
   * own in the middle of the turn, which the page's placeCompaction places; `read` runs as the turn finishes, a read
   * landing then.
   * `heard`: the compactions an Undo was heard for (`undoneIds`) — the word itself spent by a read asked since.
   * @param {any[]} made @param {{ read?: (turns: any[]) => void, compactions?: any[], heard?: number[] }} [o]
   */
  async function sendCompacting(made, { read, compactions, heard = [] } = {}) {
    const rows = () => ({ boundaries: /** @type {any[]} */ ([]), boundariesAfter: /** @type {any[]} */ ([]) });
    const turns = [1, 2, 3].map((n) => ({ n, status: "done", ...rows() }));
    const withdrawn = { n: 4, status: "stopped", withdrawn: true, ...rows() };
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [...turns, withdrawn], live: null, undoneHeard: [], undoneIds: new Set(heard) });
    /** @type {any[]} */
    const drawn = [];
    /** @type {Record<string, any>} */
    const scope = {
      state: { currentId: "c1" },
      chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null),
      placeBoundary,
      holdsRow: history.holdsRow, newerCompaction: history.newerCompaction,
      turnNumbered: history.turnNumbered,
      newestOnRecord: history.newestOnRecord,
      transcript: standIn({
        finish: async (/** @type {any} */ live) => {
          live.turn.rec = { view: { compactions: made } };
          live.turn.composedCompactions = history.composedCompactions(made.map((c) => ({ type: "compaction", afterTurn: c.toTurn, ...c })), live.turn.rec.view.compactions);
          if (compactions) live.turn.compactions = compactions;
          read?.(chat.turns);
        },
        drawBoundaries: (/** @type {any} */ t) => void drawn.push(t),
      }),
    };
    const send = sendLift(scope, async () => ({ reply: { stopReason: "end_turn" } }), ["placeCompaction", "undoOnlyOn?"]);
    await send("next", []);
    const sent = chat.turns.find((/** @type {any} */ t) => t.userText === "next");
    const row = (/** @type {any} */ b) => [b.type, b.fromTurn, b.toTurn, b.id ?? null, ...(b.undoable != null ? [b.undoable] : [])];
    const at = (/** @type {any} */ t) => [t.boundaries.map(row), t.boundariesAfter.map(row)];
    return { at, third: turns[2], withdrawn, sent, drawn, chat };
  }

  // (fails before: yes — the hunt's lead (b): the queue's next message, drained as the turn ended, began before the rows
  // landed, and the read finish() was served before it took the session still offered Undo: the row took it, true, and
  // the Undo the message had ended was offered and refused)
  test("a turn's compaction rows that land once the queue's next message has begun take no Undo: that message ended them all", async () => {
    // The queue drained as the turn ended (setLive(false)): its next message's turn began before finish() read the rows,
    // whose tail the server served before that turn took the session — Undo still offered there.
    const began = (/** @type {any[]} */ turns) => void turns.push({ n: 5, status: "streaming", userText: "queued", boundaries: [], boundariesAfter: [] });
    const composed = await sendCompacting([{ id: 7, fromTurn: 1, toTurn: 3, kind: "plain", method: "summary", undoable: true }], { read: began });
    assert.deepEqual(composed.at(composed.sent), [[["compaction", 1, 3, 7, false]], []], "the composer's, before the turn it answers, no Undo");
    const command = { type: "compaction", id: 8, afterTurn: 4, fromTurn: 1, toTurn: 4, method: "summary", undoable: true, at: Date.now() };
    const typed = await sendCompacting([], { read: began, compactions: [command] });
    assert.deepEqual(typed.at(typed.sent), [[], [["compaction", 1, 4, 8, false]]], "a command's, after its own turn, no Undo");
  });

  // (fails before: yes — the review of 9d15cbc4d: the compaction row a send's record names went after the turn before the
  // send, whatever turn the compaction ended on — a fold leaves the newest turn whole — and a read moved it up one)
  test("the compaction row a send's record names lands where a read places it: after the turn it ended on, a withdrawn row passed by", async () => {
    const fold = await sendCompacting([{ id: 6, fromTurn: 1, toTurn: 2, kind: "plain", method: "fold" }]);
    assert.deepEqual([fold.at(fold.third), fold.at(fold.withdrawn), fold.at(fold.sent)], [[[["compaction", 1, 2, 6]], []], [[], []], [[], []]], "before turn 3, which the fold left whole");
    assert.ok(fold.drawn.includes(fold.third), "drawn there");
    // A summary of every turn before the send is before the send, turn 4 — not before the row withdrawn as turn 4.
    const summary = await sendCompacting([{ id: 6, fromTurn: 1, toTurn: 3, kind: "plain", method: "summary" }]);
    assert.deepEqual([summary.at(summary.third), summary.at(summary.withdrawn), summary.at(summary.sent)], [[[], []], [[], []], [[["compaction", 1, 3, 6]], []]], "before the send");
    assert.ok(summary.drawn.includes(summary.sent), "drawn there");
  });

  // (fails before: yes — the 11-01 report's B9: the record named one compaction, so the send placed one row, and the
  // other came in with the page's next read)
  test("a send whose record names two compactions — at its line, then in the middle of the turn — places both where a read places them", async () => {
    const r = await sendCompacting([{ id: 6, fromTurn: 1, toTurn: 2, kind: "plain", method: "fold" }, { id: 7, fromTurn: 1, toTurn: 3, kind: "plain", method: "summary" }]);
    assert.deepEqual([r.at(r.third), r.at(r.withdrawn), r.at(r.sent)], [[[["compaction", 1, 2, 6]], []], [[], []], [[["compaction", 1, 3, 7]], []]]);
    assert.ok(r.drawn.includes(r.third) && r.drawn.includes(r.sent), "each drawn where it landed");
  });

  // (fails before: yes — the review of e706f3699: a turn's end placed a row from the read it made as it finished, though
  // an Undo heard since took it back — here or in another tab —, and left the Undo of a row a read before had drawn
  // standing beside the newest's)
  test("a send's compaction an Undo was heard for stays gone, and the newest's Undo stands alone", async () => {
    const r = await sendCompacting([{ id: 6, fromTurn: 1, toTurn: 2, kind: "plain", method: "fold", undoable: false }, { id: 7, fromTurn: 1, toTurn: 3, kind: "plain", method: "summary", undoable: true }], {
      // A read during the turn drew the line's row while it was the newest, with its Undo.
      read: (all) => void all[2].boundaries.push({ type: "compaction", id: 6, fromTurn: 1, toTurn: 2, afterTurn: 2, kind: "plain", method: "fold", undoable: true }),
    });
    assert.deepEqual([r.at(r.third), r.at(r.sent)], [[[["compaction", 1, 2, 6, false]], []], [[["compaction", 1, 3, 7, true]], []]], "one Undo: the newest's");
    const gone = await sendCompacting([{ id: 6, fromTurn: 1, toTurn: 2, kind: "plain", method: "fold" }, { id: 7, fromTurn: 1, toTurn: 3, kind: "plain", method: "summary" }], { heard: [7] });
    assert.deepEqual([gone.at(gone.third), gone.at(gone.sent)], [[[["compaction", 1, 2, 6]], []], [[], []]], "the one undone is not placed");
  });

  // (fails before: yes — the review of ab71c0420: a turn's end placed its composer's rows where no read asked before it
  // was told of them — a turn read from the server, which the read takes whole, lost them)
  test("a turn's end keeps the rows it placed for a read asked before it, placed where a read places them", async () => {
    const r = await sendCompacting([{ id: 6, fromTurn: 1, toTurn: 3, kind: "plain", method: "summary", undoable: true }]);
    assert.deepEqual(r.chat.rowsHeard.filter((/** @type {any} */ h) => h.row).map((/** @type {any} */ h) => [h.row.id, h.asRead]), [[6, true]]);
    const turns = [1, 2, 3, 4].map((n) => ({ n, status: "done", past: true, boundaries: /** @type {any[]} */ ([]), boundariesAfter: /** @type {any[]} */ ([]) }));
    history.afterCompactionPlaced(turns, r.chat.rowsHeard.find((/** @type {any} */ h) => h.row).row, { asRead: true });
    assert.deepEqual(turns.map((t) => [t.boundaries.map((b) => [b.id, b.undoable]), t.boundariesAfter.length]), [[[], 0], [[], 0], [[], 0], [[[6, true]], 0]], "before the turn after it, as a read places it");
  });

  // (fails before: yes — the review of 6a7c7d42c: a command's compaction an Undo was heard for was placed again from the
  // turn's finish; one the finish read before a newer compaction took the newer one's Undo; and an Undo whose word a read
  // asked since had spent no longer kept its row from coming back — the heard: [7] above)
  test("a turn's end places no command's compaction an Undo was heard for, and an older row takes no Undo from a newer one", async () => {
    const command = { type: "compaction", id: 8, afterTurn: 3, fromTurn: 1, toTurn: 3, kind: "plain", method: "summary", undoable: true };
    const undone = await sendCompacting([], { compactions: [command], heard: [8] });
    assert.deepEqual(undone.at(undone.third), [[], []], "not placed");
    const r = await sendCompacting([{ id: 7, fromTurn: 1, toTurn: 3, kind: "plain", method: "summary", undoable: true }], {
      // A read as the turn finished already holds a compaction made after it, with its Undo.
      read: (all) => void all[2].boundariesAfter.push({ type: "compaction", id: 9, fromTurn: 1, toTurn: 3, afterTurn: 3, kind: "plain", method: "fold", undoable: true }),
    });
    assert.deepEqual([r.at(r.third), r.at(r.sent)], [[[], [["compaction", 1, 3, 9, true]]], [[["compaction", 1, 3, 7, false]], []]], "the newer keeps its Undo, alone");
  });

  // (fails before: yes — the review of 7e1d595ea: a read that landed as the send finished placed the server's row, and the
  // send placed its own copy beside it)
  test("a send's compaction row that a read placed as the turn finished stands once", async () => {
    const r = await sendCompacting([{ id: 7, fromTurn: 1, toTurn: 2, kind: "plain", method: "fold" }], {
      read: (all) => void all[2].boundaries.push({ type: "compaction", id: 7, fromTurn: 1, toTurn: 2, afterTurn: 2, kind: "plain", method: "fold" }),
    });
    assert.deepEqual(r.at(r.third), [[["compaction", 1, 2, 7]], []], "the server's row alone");
  });

  // (fails before: yes — the review of 3c5c2d678: a coding agent that compacted its own context in the middle of the turn
  // made a row of the same turns as Filament's summary at the turn's line, and the send's row was taken for held)
  test("a coding agent's own compaction in the middle of the turn is not the send's: both rows stand", async () => {
    const own = { type: "compaction", id: 8, afterTurn: 4, fromTurn: 1, toTurn: 3, kind: "plain", method: "own", detail: { during: 4 } };
    const r = await sendCompacting([{ id: 6, fromTurn: 1, toTurn: 3, kind: "plain", method: "summary" }], { compactions: [own] });
    assert.deepEqual(r.at(r.sent), [[["compaction", 1, 3, 6]], [["compaction", 1, 3, 8]]], "Filament's summary before the send, the agent's own after it");
  });

  // (fails before: yes — the review of 3c5c2d678: a row the turn read as it ended — a command's, a coding agent's own —
  // was placed again where a read had placed it as the turn finished, and the server's row lost its Undo)
  test("a compaction a read placed already is not placed again, and keeps its Undo", () => {
    const turns = [1, 2, 3].map((n) => ({ n, status: "done", boundaries: /** @type {any[]} */ ([]), boundariesAfter: /** @type {any[]} */ ([]) }));
    const served = { type: "compaction", id: 7, afterTurn: 2, fromTurn: 1, toTurn: 2, kind: "plain", method: "summary", detail: {}, undoable: true };
    turns[2].boundaries.push(served);
    const chat = { id: "c1", turns };
    const { placeCompaction } = lift(["placeCompaction", "undoOnlyOn?"], { state: { currentId: "c1" }, chatOf: () => chat, turnNumbered: history.turnNumbered, holdsRow: history.holdsRow, newerCompaction: history.newerCompaction });
    placeCompaction(chat, { ...served });
    assert.deepEqual([turns.map((t) => t.boundaries.length + t.boundariesAfter.length), served.undoable], [[0, 0, 1], true]);
  });

  // (fails before: yes — the review of 3c5c2d678: a compaction's row was one by its turns alone, and every team mark had
  // one key)
  test("a row is the same row by what it is: two compactions of the same turns, two teams' marks, stand apart", () => {
    const at4 = (/** @type {any[]} */ rows) => [{ n: 4, boundaries: rows, boundariesAfter: [] }];
    const line = { type: "compaction", fromTurn: 1, toTurn: 3, method: "summary" };
    const own = { type: "compaction", id: 8, fromTurn: 1, toTurn: 3, method: "own", detail: { during: 4 } };
    const ownAtLine = { type: "compaction", id: 5, fromTurn: 1, toTurn: 3, method: "own", detail: {} };
    const copy = { type: "compaction", id: 9, fromTurn: 1, toTurn: 3, method: "summary", detail: { copy: "agent" } };
    assert.equal(history.holdsRow(at4([own]), line), false, "a coding agent's own in the middle of turn 4 is not Filament's at its line");
    assert.equal(history.holdsRow(at4([ownAtLine]), copy), false, "the summary of Filament's copy is not the agent's own at the line");
    assert.equal(history.holdsRow(at4([{ ...line, id: 3, kind: "plain", detail: {} }]), line), true, "the server's row of the send's compaction");
    assert.equal(history.holdsRow(at4([{ ...own }]), own), true, "the agent's own, read twice");
    const fired = (/** @type {string} */ id) => ({ type: "team", id, event: "fired", afterTurn: 3 });
    assert.deepEqual([history.holdsRow(at4([fired("a")]), fired("b")), history.holdsRow(at4([fired("a")]), fired("a"))], [false, true], "a team's mark");
    // A read keeps the page's mark the server does not hold yet, beside the server's.
    const [merged] = mergedTurns([{ n: 4, status: "done", boundaries: [fired("b")], boundariesAfter: [] }], [{ n: 4, status: "done", boundaries: [fired("a")], boundariesAfter: [] }]);
    assert.deepEqual(merged.boundaries.map((/** @type {any} */ b) => b.id), ["a", "b"]);
  });

  // (fails before: yes — the review of 2d7ef9ce3: a compaction of turns the page held another compaction of — one undone
  // in another tab, which tells no other; the agent's own at the line beside Filament's summary — was taken for held, and
  // not placed)
  test("another compaction of the same turns is not held: the server's ids, or the methods, tell them apart", () => {
    const at4 = (/** @type {any[]} */ rows) => [{ n: 4, boundaries: rows, boundariesAfter: [] }];
    const undoneElsewhere = { type: "compaction", id: 7, afterTurn: 3, fromTurn: 1, toTurn: 3, kind: "plain", method: "summary", detail: {}, undoable: true };
    assert.equal(history.holdsRow(at4([undoneElsewhere]), { ...undoneElsewhere, id: 8 }), false, "the same turns compacted again");
    const ownAtLine = { type: "compaction", id: 5, fromTurn: 1, toTurn: 3, method: "own", detail: {} };
    assert.equal(history.holdsRow(at4([ownAtLine]), { type: "compaction", fromTurn: 1, toTurn: 3, method: "summary" }), false, "Filament's summary of the turns the agent compacted at its line");
    assert.equal(history.holdsRow(at4([undoneElsewhere]), { type: "compaction", fromTurn: 1, toTurn: 3, method: "summary" }), true, "the send's own copy of it");
    const turns = [1, 2, 3].map((n) => ({ n, status: "done", boundaries: /** @type {any[]} */ ([]), boundariesAfter: /** @type {any[]} */ ([]) }));
    turns[2].boundariesAfter.push(undoneElsewhere);
    const chat = { id: "c1", turns };
    const { placeCompaction } = lift(["placeCompaction", "undoOnlyOn?"], { state: { currentId: "c1" }, chatOf: () => chat, turnNumbered: history.turnNumbered, holdsRow: history.holdsRow, newerCompaction: history.newerCompaction });
    placeCompaction(chat, { ...undoneElsewhere, id: 8 });
    assert.deepEqual(turns[2].boundariesAfter.map((/** @type {any} */ b) => [b.id, !!b.undoable]), [[7, false], [8, true]], "Compact now's, placed with its Undo");
  });

  // (fails before: yes — the review of 9f0185fbe: a withdrawn row offered Rewind, to the turn of its number, which the
  // session does not have)
  test("a withdrawn row is no message a rewind goes back to", () => {
    /** @type {string[]} */
    const said = [];
    const done = { n: 1, status: "done", userText: "first" };
    const withdrawn = { n: 2, status: "stopped", withdrawn: true, userText: "hello" };
    const chat = { id: "c1", chainId: "s-c1", turns: [done, withdrawn], live: null, view: { holder: null } };
    const fns = lift(["rewindConfirm", "rewindRefusal", "rewindable"], { unsent: history.unsent, toast: (/** @type {string} */ m) => void said.push(m) });
    assert.deepEqual(fns.rewindable(chat), [done], "not listed");
    assert.equal(fns.rewindRefusal({ chainId: "s-c1", turns: [withdrawn], live: null }), "Nothing to rewind yet: rewind after the chat's first reply", "a chat of no turn on record");
    fns.rewindConfirm(chat, withdrawn);
    assert.deepEqual(said, ["This message never went: there is nothing of it to rewind"]);
  });

  // (fails before: yes — the review of dea50ef1f: a row given back once its send was refused came back with the number it
  // had, which the turn that took the chat meanwhile may hold)
  test("a row given back takes the number after the chat's turns as they stand", async () => {
    const w = waitingPage();
    const back = w.waitOn(MOVE);
    const ran = { n: 2, status: "streaming" };
    w.io.send = async (o) => {
      back.chat.turns = [ran];
      o?.goes?.();
      return false;
    };
    w.view(back.chat, null);
    await back.q.send();
    assert.deepEqual(back.chat.turns.map((/** @type {any} */ t) => [t.n, t.status]), [[2, "streaming"], [3, "waiting"]]);
  });

  // (fails before: yes — the review of de6c0982b: a client's turn that ended while the page's own send into its chat
  // waited on the server's refusal owed the chat a read at the send's end, which the refusal never reached: the turn
  // stayed unread, and the owed read kept the chat from being let go)
  test("a send an outside client's chat refuses reads the chat where its client's turn ended meanwhile", async () => {
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [{ n: 1, status: "done" }], live: null });
    /** @type {string[]} */
    const reads = [];
    const scope = {
      state: { currentId: "c1" },
      chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null),
      toast: () => {},
      forkModal: () => {},
      hydrate: async (/** @type {any} */ c) => void reads.push(`read ${c.id}`),
      sidebar: standIn({ load: () => void reads.push("list") }),
    };
    const send = sendLift(scope, async () => {
      // The client's turn ended on the feed while this send waited (`clientTurnEnded`): its end owes the read.
      chat.hydrateAfterSend = true;
      return { reply: { httpStatus: 409, errorBody: { error: "this session is OpenCode's: the harness goes on in a fork of it", client: true } } };
    });
    assert.equal(await send("hello", []), false);
    assert.deepEqual([reads, chat.hydrateAfterSend], [["read c1", "list"], false]);
  });

  // (fails before: yes — a send into an outside client's chat drew an error row of the server's words and left the
  // message there: the fork its 409 names, which the harness goes on in, was not offered)
  test("a send an outside client's chat refuses takes its row back, puts the message back, and offers the fork the server names with the message", async () => {
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [{ n: 1, status: "done" }, { n: 2, status: "done" }], live: null });
    /** @type {string[]} */
    const toasts = [];
    /** @type {any[]} */
    const forks = [];
    const refused = (/** @type {any} */ fork) => async () => ({ reply: { httpStatus: 409, errorBody: { error: "this session is OpenCode's: the harness goes on in a fork of it", client: true, ...(fork ? { fork } : {}) } } });
    const scope = {
      state: { currentId: "c1" },
      chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null),
      toast: (/** @type {string} */ words) => void toasts.push(words),
      forkModal: (/** @type {any[]} */ ...a) => void forks.push(a),
    };
    const send = sendLift(scope, refused({ method: "POST", path: "/api/sessions/s-c1/fork", atTurn: 2 }));
    assert.equal(await send("go on from here", [], undefined, { boxed: true }), false, "back in the box");
    assert.deepEqual(chat.turns.map((/** @type {any} */ t) => t.n), [1, 2], "the row the send drew is gone");
    assert.deepEqual(forks, [[chat, { n: 2 }, { prefill: "go on from here" }]], "the fork the server names, the message with it");
    assert.deepEqual(toasts, ["This session is OpenCode's: the harness goes on in a fork of it. Your message is back in the box, and goes with a fork of turn 2."]);
    const bare = sendLift({ ...scope }, refused(null));
    toasts.length = 0;
    assert.equal(await bare("go on", [], undefined, { boxed: true }), false);
    assert.deepEqual([forks.length, toasts], [1, ["This session is OpenCode's: the harness goes on in a fork of it. Your message is back in the box."]], "no finished turn: no fork offered");
  });

  // (fails before: no — a guard: on 32afa3f3f `sendMessage` told `goes` before it posted the turn; the tests above stand
  // in for `sendMessage`, so nothing held it to that)
  test("the send tells the row its message goes before it posts the turn, not once the post has answered", async () => {
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [], live: null });
    /** @type {string[]} */
    const order = [];
    const send = sendLift({ state: { currentId: "c1" }, chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null) }, () => {
      order.push("post");
      return new Promise(() => {});
    });
    void send("next", [], undefined, { goes: () => void order.push("goes") });
    await settled();
    assert.deepEqual(order, ["goes", "post"]);
  });

  // (fails before: yes — the page round of 11-02: every refusal was one Continue could send past, a /flow with no words
  // among them: the queue offered Continue as a try again)
  test("a send's refusal of the message itself — a /flow with no words or in a team's chat — is one Continue can't send past; one of the chat's state is, each send's afresh", async () => {
    /** @param {Record<string, any>} more */
    const sendWith = (more) => {
      const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [{ n: 1, status: "done", requestId: "r1" }], live: null });
      /** @type {Record<string, any>} */
      const scope = { state: { currentId: "c1" }, chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null), toast() {}, newestOnRecord: history.newestOnRecord, FLOW_USAGE: "usage", FLOW_TEAM_CHAT: "team chat", readOnlyWords: () => "another tab", refusal: "", refusalAgain: null, ...more };
      return { scope, send: sendLift(scope, () => new Promise(() => {}), ["refuse"]) };
    };
    const noWords = sendWith({ flowWordsOf: () => "" });
    const team = sendWith({ flowWordsOf: () => "a flow", besideStore: { main: () => ({}) } });
    const readOnly = sendWith({ readOnlyNow: () => true, followsStill: () => true });
    assert.deepEqual(
      [
        await noWords.send("/flow", [], "normal", { queued: true }),
        await team.send("/flow a flow", [], "normal", { queued: true }),
        await readOnly.send("then commit", [], "normal", { queued: true }),
      ],
      [false, false, false],
    );
    assert.deepEqual([noWords, team, readOnly].map((x) => [x.scope.refusal, x.scope.refusalAgain]), [
      ["usage", false],
      ["team chat", false],
      ["another tab", true],
    ]);
  });

  // (fails before: yes — the review of 11-05: a /steer-fork the queue sent once its turn had ended was refused as no
  // turn running, Continue could not send it past, and the queue stalled on it; and nothing ran the send's refusals)
  test("/steer-fork: into the loop's running turn with its ask; refused, back in the box, with no turn or the word alone; from the queue, its words go as the next message", async () => {
    /** @param {any} live @param {any[]} posts @param {any[]} steers */
    const sendOn = (live, posts, steers) => {
      const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [{ n: 1, status: "done", requestId: "r1" }], live });
      /** @type {Record<string, any>} */
      const scope = {
        state: { currentId: "c1", models: [] },
        chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null),
        toast() {},
        refusal: "",
        refusalAgain: null,
        steerForkOf,
        steerForkRefusal,
        STEER_FORK_USAGE,
        teamWords: (/** @type {any[]} */ _files, /** @type {string} */ text) => ({ others: [], named: [], words: text, teamed: [] }),
        steerPost: async (/** @type {string} */ runId, /** @type {any} */ m) => (steers.push([runId, m]), { message: { id: "s1" } }),
      };
      return { scope, send: sendLift(scope, (o) => (posts.push(o), new Promise(() => {})), ["refuse"]) };
    };
    /** @type {any[]} */
    const posts = [];
    /** @type {any[]} */
    const steers = [];
    const running = sendOn({ runId: "run-1", runKind: "agent-turn", turn: { paused: false } }, posts, steers);
    assert.equal(await running.send("/steer-fork not that file", [], "normal"), undefined);
    assert.deepEqual(steers.map(([id, m]) => [id, m.text, m.weigh]), [["run-1", "not that file", true]], "its words, asked to be weighed");
    const idle = sendOn(null, posts, steers);
    assert.equal(await idle.send("/steer-fork not that file", [], "normal"), false);
    assert.deepEqual([idle.scope.refusal, idle.scope.refusalAgain], [steerForkRefusal("idle"), false]);
    const paused = sendOn({ runId: "run-1", runKind: "agent-turn", turn: { paused: true } }, posts, steers);
    assert.equal(await paused.send("Weigh this", [], "fork"), false, "the ⌄ menu's ask, a turn waiting for an answer");
    assert.equal(paused.scope.refusal, steerForkRefusal("paused"));
    const coder = sendOn({ runId: "run-2", runKind: "coding-agent", steer: "live", turn: { paused: false } }, posts, steers);
    assert.equal(await coder.send("/steer-fork x", [], "normal"), false);
    assert.equal(coder.scope.refusal, steerForkRefusal("agent"));
    const bare = sendOn({ runId: "run-1", runKind: "agent-turn", turn: { paused: false } }, posts, steers);
    assert.equal(await bare.send("/steer-fork", [], "normal"), false);
    assert.equal(bare.scope.refusal, STEER_FORK_USAGE);
    assert.equal(steers.length, 1, "none of these steered");
    const drained = sendOn(null, posts, steers);
    void drained.send("/steer-fork not that file", [], "normal", { queued: true });
    await settled();
    assert.deepEqual(posts.map((o) => o.content), [[{ type: "text", text: "not that file" }]], "the queue's: its words, as the next message");
  });

  // (fails before: yes — on 32afa3f3f a waiting row's send that met a turn of the harness's own was told "Your message is
  // back in the box", where the message is back on its row, which sends it itself as that turn ends)
  test("a waiting row's send that meets a turn of the harness's own is told its message waits on its row again; a send from the box, that it is back in the box", async () => {
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [], live: null });
    /** @type {string[]} */
    const toasts = [];
    const send = sendLift(
      { state: { currentId: "c1" }, chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null), opening: new WeakSet(), followElsewhere: () => {}, toast: (/** @type {string} */ words) => void toasts.push(words) },
      async () => refusedByHarness(),
    );
    assert.equal(await send("next", [], undefined, { goes: () => {} }), false);
    assert.equal(await send("next", [], undefined, { boxed: true }), false);
    assert.deepEqual(toasts, [
      "This chat's turn is still running — following it now. Your message waits on its row again, and sends itself when the turn ends.",
      "This chat's turn is still running — following it now. Your message is back in the box: send it at its next step, or when it's done.",
    ]);
  });

  // (fails before: yes — the 11-01 report: a send the box did not make — a Retry, a card's answer, a task's carry-on —
  // refused by a turn of the harness's own or by a client's chat was told its message was back in the box, which held
  // none, and a queued one refused by a client's chat was told so too)
  test("a refused send the box did not make is told where its message is: not sent, or back in the queue", async () => {
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [{ n: 1, status: "done" }], live: null });
    /** @type {string[]} */
    const toasts = [];
    const scope = () => ({ state: { currentId: "c1" }, chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null), opening: new WeakSet(), followElsewhere: () => {}, toast: (/** @type {string} */ words) => void toasts.push(words) });
    const byHarness = sendLift(scope(), async () => refusedByHarness());
    assert.equal(await byHarness("again", []), false);
    const byClient = sendLift(scope(), async () => ({ reply: { httpStatus: 409, errorBody: { error: "this session is OpenCode's", client: true } } }));
    assert.equal(await byClient("again", []), false);
    assert.equal(await byClient("queued", [], "normal", { queued: true }), false);
    assert.deepEqual(toasts, [
      "This chat's turn is still running — following it now. Your message was not sent: send it again once the turn ends.",
      "This session is OpenCode's. Your message was not sent.",
      "This session is OpenCode's. Your message is back in the queue.",
    ]);
    // The box's own send is the box's (composer.js takes it back on a refusal); the queue's is not.
    assert.match(APP_SRC, /onSend: \(text, attachments, modifier, o\) => sendMessage\(text, attachments, modifier, \{[^}]*boxed: o\?\.queued !== true, fresh: o\?\.queued !== true, via: o\?\.via \|\| null \}\),/);
  });

  // (fails before: yes — the 11-01 report: Retry, and a switch's answer, while this chat's own turn ran did nothing, and
  // said nothing. Retry asks the card's question too since the review of c2ee8d232: a message waiting on its row)
  test("Retry and a switch's answer while this chat's turn runs say to do it once the turn ends, and answer that nothing went", () => {
    assert.match(APP_SRC, /onRetry: \(chat, turn\) => \{\s+if \(viewOnlyPage\(\)\) \{\s+toast\(VIEW_ONLY_WORDS, "err"\);\s+return false;\s+\}\s+if \(chat\.live\) \{\s+toast\("This chat's turn is still running — Retry once it ends\."\);\s+return false;\s+\}\s+if \(turnRunsIn\(chat\)\) return false;\s+return sendAsked\(chat, turn\);/);
    assert.match(APP_SRC, /onSwitch: \(chat, turn, form, ask\) => \{\s+if \(turnRunsIn\(chat\)\) return false;/);
  });

  // (fails before: yes — the review of a2e843221: words Filament wrote — a task's carry-on, Resume's "continue", a switch's
  // answer — were told "Your message was not sent: send it again", which the person cannot)
  test("a refused send of words Filament wrote says nothing was sent", async () => {
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [{ n: 1, status: "done" }], live: null });
    /** @type {string[]} */
    const toasts = [];
    const scope = () => ({ state: { currentId: "c1" }, chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null), opening: new WeakSet(), followElsewhere: () => {}, toast: (/** @type {string} */ words) => void toasts.push(words) });
    assert.equal(await sendLift(scope(), async () => refusedByHarness())("continue", [], "normal", { ours: true }), false);
    assert.equal(await sendLift(scope(), async () => ({ reply: { httpStatus: 409, errorBody: { error: "this session is OpenCode's", client: true } } }))("continue", [], "normal", { ours: true }), false);
    assert.deepEqual(toasts, ["This chat's turn is still running — following it now. Nothing was sent.", "This session is OpenCode's. Nothing was sent."]);
    // The carry-on and "continue" go through `sendOrQueue` (the review of c2ee8d232), which hands their `ours` on.
    for (const call of [/sendOrQueue\(carryOnWords\([^\n]+, \{ ours: true \}\);/, /sendOrQueue\("continue", \{ ours: true \}\)\.then\(/, /sendMessage\(answer, \[\], "normal", \{ modeSwitch: true, ours: true \}\);/, /async function sendOrQueue\(text, o = \{\}\) \{\s+const sent = await sendMessage\(text, \[\], "normal", o\);/]) assert.match(APP_SRC, call);
    assert.match(APP_SRC, /await sendMessage\(o\.words, \[\], "normal", \{ boxed: true \}\)/, "the team hand-over puts its words back in the box itself");
  });

  // (fails before: yes — the review of a2e843221: a summoned card's message the send refused was nowhere: the card was
  // gone, and nothing put the message back)
  // (and at bd4ddab53: yes — the review of f50fcf6f9: where the chat was not shown it went into that chat's draft and its
  // files with it, ["draft", "c1", "make room"], a box nobody saw, the card's answer dropped)
  test("a summoned card's message the send refuses is back in the box; where the chat is not shown, first in that chat's queue, paused with why, past the card's question still — never in its box", async () => {
    const chat = /** @type {any} */ ({ id: "c1", live: null });
    const s = { message: "make room", files: [{ name: "a.png" }] };
    /** @type {any[]} */
    const took = [];
    /** @type {any[]} */
    const sends = [];
    /** @type {Record<string, any>} */
    const scope = {
      state: { currentId: "c1" },
      chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : { id }),
      composer: { takeBack: (/** @type {string} */ t, /** @type {any[]} */ f) => void took.push(["box", t, f.length]) },
      saveDraft: (/** @type {any} */ c, /** @type {string} */ t) => void took.push(["draft", c.id, t]),
      saveDraftFiles: (/** @type {any} */ c, /** @type {any[]} */ f) => void took.push(["files", c.id, f.length]),
      queueOf: (/** @type {any} */ c) => (c.queue ||= queueState()),
      awayBack,
      refusal: "",
      sendMessage: async (/** @type {string} */ _t, /** @type {any[]} */ _f, /** @type {string} */ _m, /** @type {any} */ o) => (sends.push(o), (scope.refusal = "This chat is its client's"), false),
    };
    const { sendSummoned } = lift(["sendSummoned"], scope);
    await sendSummoned(chat, s);
    scope.state.currentId = "c2";
    await sendSummoned(chat, s, { chat });
    assert.deepEqual(took, [["box", "make room", 1]], "shown: back in the box it came from; not shown: in no box");
    assert.deepEqual([chat.queue?.items, chat.queue?.paused, chat.queue?.said], [[{ text: "make room", files: s.files, sendAsIs: true }], true, "This chat is its client's"]);
    assert.deepEqual(sends.map((o) => [o.sendAsIs, o.boxed, !!o.chat]), [[true, true, false], [true, false, true]]);
  });

  // (fails before: yes — Hunter sa_1b191739 on 26ecaaca3: Compact and send asked whether a turn ran only before its
  // compaction, a minute and more; a turn begun meanwhile took the message as a note, and a send that held it ("queue")
  // left it nowhere)
  // (and at bd4ddab53: yes — the review of f50fcf6f9: it joined the queue silently and without the card's answer, unlike
  // a stopped message's (`sendAsked`), and where the chat was not shown it went into that chat's draft)
  test("a summoned card's message whose chat runs a turn by the time it goes waits in the chat's queue past the card's question — its own chat's queue where the chat is not shown", async () => {
    const chat = /** @type {any} */ ({ id: "c1", live: { runId: "r-other-tab" } });
    const s = { message: "make room", files: [{ name: "a.png" }] };
    /** @type {any[]} */
    const did = [];
    const scope = {
      state: { currentId: "c1" },
      chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : { id }),
      composer: {
        takeBack: (/** @type {string} */ t) => void did.push(["box", t]),
        enqueue: (/** @type {any[]} */ items) => void did.push(["queue", ...items]),
      },
      saveDraft: (/** @type {any} */ c, /** @type {string} */ t) => void did.push(["draft", c.id, t]),
      saveDraftFiles: (/** @type {any} */ c, /** @type {any[]} */ f) => void did.push(["files", c.id, f.length]),
      queueAdd,
      queueOf: (/** @type {any} */ c) => (c.queue ||= queueState()),
      toast: (/** @type {string} */ w) => void did.push(["toast", w]),
      sendMessage: async (/** @type {string} */ t) => void did.push(["sent", t]),
    };
    const { sendSummoned } = lift(["sendSummoned", "queueNext"], scope);
    await sendSummoned(chat, s, {});
    assert.deepEqual(did, [["queue", { text: "make room", files: s.files, sendAsIs: true }], ["toast", "A turn began in this chat meanwhile — your message waits in the queue, and goes when it ends"]], "a turn runs: no send, the message, its files and the card's answer in the queue");
    did.length = 0;
    chat.live = null;
    await sendSummoned(chat, s);
    assert.deepEqual(did, [["sent", "make room"]], "sent: nothing more");
    did.length = 0;
    chat.live = { runId: "r-other-tab" };
    scope.state.currentId = "c2";
    const away = lift(["sendSummoned", "queueNext"], scope);
    await away.sendSummoned(chat, s, { chat });
    assert.deepEqual([did, chat.queue?.items], [[], [{ text: "make room", files: s.files, sendAsIs: true }]], "not shown: its own chat's queue, which sends it as that turn ends there");
  });

  // (fails before: yes — the review of 3f174b6b6: the pin found `sendAgain(chat, turn, { sendAsIs: true, carry }); return
  // true;` and no sendAsked — Compact and send answered true whatever its send came to, so a turn begun while the card
  // made room took the message as a note or answered "queue" into nothing, and a message waiting on the chat's row
  // refused it with the card spent)
  test("a card's answer that waits first — Compact and send, the way to stop being asked — sends as the chat stands by then: a turn begun meanwhile takes the message into the chat's queue with what the card answered, its row giving way; a send refused before it goes gives the card back with why", async () => {
    // Through `compactAndSend`, which marks the turn as making room for Now meanwhile (the merge of main into uiux).
    assert.match(APP_SRC, /if \(made !== true\) return made \|\| false;\s+(?:\/\/ [^\n]+\n\s+)*try \{\s+return await sendAsked\(chat, turn, \{ sendAsIs: true, carry \}\);/, "Compact and send answers what its send came to");
    assert.match(APP_SRC, /onCompact: \(chat, turn, choice, once, carry\) => compactAndSend\(chat, turn, choice, once, carry\),/);
    assert.match(APP_SRC, /toast\(changed \? [^\n]+\);\s+return sendAsked\(chat, turn, cold \|\| changed \? \{ sendAsIs: true, carry \} : \{\}\);/, "and so does the way to stop being asked, with a lost card's form");
    const shot = { kind: "image", name: "a.png", type: "image/png", data: "AAAA" };
    /** A row the card stopped before its message went: the session asked first. */
    const asked = () => ({ n: 2, status: "error", userText: "go on", sent: [shot], reply: { httpStatus: 409, error: "asks", errorBody: { resumeQuestion: { why: "cold" } } } });
    /** @type {any[]} */
    const did = [];
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", turns: [], live: { runId: "r-box", turn: { paused: false } }, waiting: null });
    /** @type {Record<string, any>} */
    const scope = {
      state: { currentId: "c1" },
      chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : { id }),
      againOf,
      withoutAsked,
      queueAdd,
      queueOf: (/** @type {any} */ c) => (c.queue ||= queueState()),
      transcript: { dropTurn: (/** @type {any} */ t) => void did.push(["dropped", t.userText]) },
      composer: { enqueue: (/** @type {any[]} */ items) => void did.push(["queue", ...items]) },
      toast: (/** @type {string} */ w) => void did.push(["toast", w]),
      errText: (/** @type {any} */ e) => String(e?.message || e),
      refusal: "",
      /** The page's send, as each case has it answer. @type {(o: any) => Promise<any>} */
      answers: async () => undefined,
      sendMessage: (/** @type {string} */ t, /** @type {any[]} */ f, /** @type {string} */ _m, /** @type {any} */ o) => (did.push(["sent", t, f.length, o.sendAsIs === true, o.carry ?? null, !!o.replaces, !!o.chat]), scope.answers(o)),
    };
    const { sendAsked } = lift(["sendAsked?", "sendAgain", "sendsIn", "queueNext", "refuse"], scope);

    // A turn began in the chat while the card made room (a message from the box): no note into it — the message waits
    // for its end in the chat's queue, whole, past the card's question, and its row gives way.
    const row = asked();
    chat.turns = [{ n: 1, status: "done" }, row];
    assert.equal(await sendAsked(chat, row, { sendAsIs: true, carry: "words" }), true);
    assert.deepEqual(did, [["dropped", "go on"], ["queue", { text: "go on", files: [shot], sendAsIs: true, carry: "words" }], ["toast", "A turn began in this chat meanwhile — your message waits in the queue, and goes when it ends"]]);
    assert.deepEqual(chat.turns.map((/** @type {any} */ t) => t.n), [1]);
    // Not shown: its own chat's queue, which sends it as that turn ends there.
    did.length = 0;
    const away = asked();
    chat.turns = [{ n: 1, status: "done" }, away];
    scope.state.currentId = "c2";
    assert.equal(await sendAsked(chat, away), true);
    assert.deepEqual([did, chat.queue.items], [[["dropped", "go on"]], [{ text: "go on", files: [shot] }]]);
    scope.state.currentId = "c1";

    // No turn runs: it goes, as the card says, the moment it is on its way.
    did.length = 0;
    chat.live = null;
    const goes = asked();
    chat.turns = [{ n: 1, status: "done" }, goes];
    scope.answers = (/** @type {any} */ o) => (o.went?.(), new Promise(() => {}));
    assert.equal(await sendAsked(chat, goes, { sendAsIs: true, carry: null }), true);
    assert.deepEqual(did, [["sent", "go on", 1, true, null, true, false]]);
    // A message waits on the chat's row by then: the send refuses it at once, and the card is given back with why —
    // its message still on its row, to be pressed again.
    did.length = 0;
    scope.answers = async () => ((scope.refusal = "A message already waits for this chat: send this once that one has gone"), false);
    assert.equal(await sendAsked(chat, goes, { sendAsIs: true }), "A message already waits for this chat: send this once that one has gone");
    assert.equal(chat.turns.at(-1), goes);
    // A send that throws is refused in its words.
    did.length = 0;
    scope.answers = () => Promise.reject(new Error("the page lost its network"));
    assert.equal(await sendAsked(chat, goes), "the page lost its network");
    assert.deepEqual(did.slice(1), [["toast", "the page lost its network"]]);
    // Nothing of the message is kept on the page: nothing goes, and the card says so.
    did.length = 0;
    const bare = { ...asked(), userText: "(attachments)", sent: undefined, attachments: [{ name: "notes.txt", kind: "file" }] };
    assert.match(String(await sendAsked(chat, bare)), /^Nothing of this message can go again from here/);
    assert.deepEqual(did, [["toast", "Nothing of this message can go again from here — what went with it is not kept on the page: send it again from the box"]], "said, where the chat is shown, as every refusal is");
  });

  // (fails before: yes — the review of f50fcf6f9: Send as it is and Switch and send sent again and answered true
  // whatever the send came to — a send another tab's session refused before it went answered true, not why, and the
  // card stayed spent)
  // (fails before: yes — the hunt's lead (d): the race took the send's first wait for its going — a refusal from the
  // chat's readying (a session that names no model has it written first) answered true, the card spent with nothing sent,
  // and a turn begun meanwhile answered "queue" into nothing, the message dropped)
  test("a card's message answers what its send came to past the chat's readying: refused there, the card comes back with why; a turn begun meanwhile takes the message into the chat's queue, whole", async () => {
    /** @type {any[]} */
    const did = [];
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", turns: [], live: null, waiting: null });
    /** @type {Record<string, any>} */
    const room = {
      state: { currentId: "c1" },
      chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null),
      againOf,
      withoutAsked,
      transcript: { dropTurn: (/** @type {any} */ t) => void did.push(["dropped", t.userText]) },
      composer: { enqueue: (/** @type {any[]} */ items) => void did.push(["queue", ...items]) },
      toast: (/** @type {string} */ w) => void did.push(["toast", w]),
      errText: (/** @type {any} */ e) => String(e?.message || e),
      refusal: "",
      /** The page's send, answering after its readying's own wait. @type {(o: any) => Promise<any>} */
      answers: async () => undefined,
      sendMessage: (/** @type {string} */ _t, /** @type {any[]} */ _f, /** @type {string} */ _m, /** @type {any} */ o) => room.answers(o),
    };
    const { sendAsked } = lift(["sendAsked", "sendAgain", "sendsIn", "queueNext", "refuse"], room);
    const row = { n: 2, status: "error", userText: "go on", sent: [], reply: { httpStatus: 409, error: "asks", errorBody: { resumeQuestion: { why: "cold" } } } };
    chat.turns = [row];
    // A session that names no model has it written as the chat is made ready (`readySession`): refused there.
    room.answers = async () => {
      await null;
      room.refusal = "the session's model could not be written";
      return false;
    };
    assert.equal(await sendAsked(chat, row, { sendAsIs: true }), "the session's model could not be written", "the card given back, saying why");
    assert.deepEqual([chat.turns, did], [[row], []], "its row stands; nothing queued");
    // A turn began in the chat while it was made ready: "queue" — the message waits whole, and its row gives way.
    room.answers = async () => (await null, "queue");
    assert.equal(await sendAsked(chat, row, { sendAsIs: true, carry: "words" }), true);
    assert.deepEqual([chat.turns, did], [[], [["dropped", "go on"], ["queue", { text: "go on", files: [], sendAsIs: true, carry: "words" }], ["toast", "A turn began in this chat meanwhile — your message waits in the queue, and goes when it ends"]]]);
  });

  test("Send as it is and Switch and send answer what their send came to: one refused before it goes gives the card back with why", async () => {
    /** @type {any[]} */
    const sends = [];
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", turns: [], live: null, waiting: null });
    /** @type {Record<string, any>} */
    const room = {
      state: { currentId: "c1" },
      chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null),
      againOf,
      withoutAsked,
      refusal: "",
      toast() {},
      errText: (/** @type {any} */ e) => String(e?.message || e),
      /** The page's send, as each case has it answer. @type {() => Promise<any>} */
      answers: async () => undefined,
      sendMessage: (/** @type {string} */ t, /** @type {any[]} */ _f, /** @type {string} */ _m, /** @type {any} */ o) => (sends.push([t, o.sendAsIs === true, o.carry ?? null]), room.answers(o)),
    };
    const lifted = lift(["sendAsked", "sendAgain", "sendsIn", "queueNext", "refuse", "turnRunsIn", "compactingBetween?"], room);
    /** A card's answer as the page hands it to the timeline (app.js), by its key. @param {string} key @returns {Function} */
    const answerOf = (key) => {
      const at = APP_SRC.indexOf(`  ${key}: (chat, turn`);
      const end = APP_SRC.indexOf("\n  },\n", at);
      const names = ["turnRunsIn", "sendAsked", "sendAgain"];
      return new Function(...names, `return ({\n${APP_SRC.slice(at, end)}\n  },\n});`)(...names.map((n) => lifted[n]))[key];
    };
    const onSendAsIs = answerOf("onSendAsIs");
    const onSwitch = answerOf("onSwitch");
    const row = { n: 2, status: "error", userText: "go on", sent: [], reply: { httpStatus: 409, error: "asks", errorBody: { resumeQuestion: { why: "cold" } } } };
    chat.turns = [row];
    // Another tab took the session meanwhile: the send refuses before anything goes.
    room.answers = async () => ((room.refusal = "Another tab writes this session"), false);
    assert.equal(await onSendAsIs(chat, row), "Another tab writes this session");
    assert.equal(await onSwitch(chat, row, "fold"), "Another tab writes this session");
    assert.deepEqual(sends, [["go on", true, null], ["go on", false, "fold"]], "past the card's question, the switch's form with it");
    // One on its way: the card is spent.
    room.answers = (/** @type {any} */ o) => (o.went?.(), new Promise(() => {}));
    assert.equal(await onSendAsIs(chat, row), true);
    assert.equal(await onSwitch(chat, row, "fold"), true);
  });

  // (fails before: yes — the review of a164c1573: Retry sent again and answered true whatever the send came to — a send
  // another tab's session refused before it went answered true, and its banner's Retry stayed spent)
  test("Retry answers what its send came to: one refused before it goes leaves Retry standing, said where the chat is shown", async () => {
    /** @type {string[]} */
    const toasts = [];
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", turns: [], live: null, waiting: null });
    /** @type {Record<string, any>} */
    const room = {
      state: { currentId: "c1" },
      chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null),
      againOf,
      withoutAsked,
      refusal: "",
      toast: (/** @type {string} */ w) => void toasts.push(w),
      errText: (/** @type {any} */ e) => String(e?.message || e),
      /** The page's send, as each case has it answer. @type {() => Promise<any>} */
      answers: async () => undefined,
      sendMessage: (/** @type {string} */ _t, /** @type {any[]} */ _f, /** @type {string} */ _m, /** @type {any} */ o) => room.answers(o),
    };
    const lifted = lift(["sendAsked", "sendAgain", "sendsIn", "queueNext", "refuse", "turnRunsIn", "compactingBetween?"], room);
    const at = APP_SRC.indexOf("  onRetry: (chat, turn) => {");
    const end = APP_SRC.indexOf("\n  },\n", at);
    const names = ["turnRunsIn", "sendAsked", "sendAgain", "toast", "viewOnlyPage", "VIEW_ONLY_WORDS"];
    const { onRetry } = new Function(...names, `return ({\n${APP_SRC.slice(at, end)}\n  },\n});`)(lifted.turnRunsIn, lifted.sendAsked, lifted.sendAgain, room.toast, () => false, "");
    const failed = { n: 2, status: "error", userText: "go on", sent: [], reply: { error: "the model is overloaded" } };
    chat.turns = [failed];
    // Another tab took the session: the send refuses before anything goes.
    room.answers = async () => ((room.refusal = "Another tab writes this session"), false);
    assert.equal(await onRetry(chat, failed), "Another tab writes this session");
    // Nothing of its message kept on the page: said, and Retry stands.
    const bare = { ...failed, userText: "(attachments)", sent: undefined, attachments: [{ name: "notes.txt", kind: "file" }] };
    assert.match(String(await onRetry(chat, bare)), /^Nothing of this message can go again from here/);
    assert.match(toasts.at(-1) || "", /^Nothing of this message can go again from here/);
    // One on its way: Retry is spent.
    room.answers = (/** @type {any} */ o) => (o.went?.(), new Promise(() => {}));
    assert.equal(await onRetry(chat, failed), true);
  });
});

describe("a message a card stopped before it was sent, and the rows on no record", () => {
  /** A row a card stopped: Filament asked before anything went (the send's 409 with its question). @param {number} n */
  const asked = (n) => ({ n, status: "error", userText: "go on", reply: { httpStatus: 409, errorBody: { needsCompaction: true, why: "past the line", sentTokens: 9 } }, requestId: "r-asked", boundaries: [], boundariesAfter: [] });

  // (fails before: yes — the 11-01 report: a message a card stopped is on no record, yet it was counted as one: the next
  // message took one past the server's number, and a read took the row for the server's turn of its number, which it hid)
  test("is no turn of the session's: the next message takes the number after the turns on record, and a read keeps the server's turn of its number", async () => {
    const row = asked(2);
    assert.equal(history.unsent(row), true);
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [{ n: 1, status: "done" }, row], live: null });
    const send = sendLift({ state: { currentId: "c1" }, chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null) }, () => new Promise(() => {}));
    void send("something else", []);
    await settled();
    assert.deepEqual(chat.turns.map((/** @type {any} */ t) => [t.n, t.userText]), [[1, undefined], [2, "go on"], [2, "something else"]], "numbered as the server numbers it");
    const page = [{ n: 1, status: "done", boundaries: [], boundariesAfter: [] }, asked(2)];
    const served = [1, 2].map((n) => ({ n, status: "done", past: true, history: true, userText: n === 2 ? "another tab's" : "first", boundaries: [], boundariesAfter: [] }));
    const merged = mergedTurns(page, served);
    assert.deepEqual(merged.map((t) => [t.n, t.userText]), [[1, undefined], [2, "another tab's"], [3, "go on"]], "the server's turn 2 stands, the row after it");
    assert.deepEqual([history.newestOnRecord(merged)?.userText, history.turnNumbered(merged, 3)], ["another tab's", null]);
  });

  // (fails before: yes — the 11-01 report: the meter read a row withdrawn while it waited, or a message a card stopped,
  // where it carried a request's id)
  test("the meter reads the newest turn on record, past a withdrawn row and a message a card stopped", () => {
    const done = { n: 1, status: "done", requestId: "r1" };
    const withdrawn = { n: 2, status: "stopped", withdrawn: true, requestId: "r2" };
    assert.equal(history.meterTurnOf([done, withdrawn], () => 5), done);
    assert.equal(history.meterTurnOf([done, asked(2)], () => 5), done);
  });

  // (fails before: yes — the 11-01 report: after a reload every turn is the transcript's, `past`, and the header's Fork
  // said "Nothing to fork yet"; a message a card stopped could be forked at, as could a turn still running)
  test("the header's Fork forks at the newest turn on record that has ended, read from the transcript or sent here", () => {
    const fns = lift(["forkAt"], { unsent: history.unsent, forkable: history.forkable });
    const read = (/** @type {number} */ n, /** @type {string} */ status = "done") => ({ n, status, past: true, history: true });
    const one = read(1);
    const two = read(2);
    assert.equal(fns.forkAt({ turns: [one, two] }), two, "after a reload");
    assert.equal(fns.forkAt({ turns: [one, two, { n: 3, status: "streaming" }] }), two, "a turn of this page's still running");
    assert.equal(fns.forkAt({ turns: [one, read(2, "open")] }), one, "a turn running elsewhere");
    assert.equal(fns.forkAt({ turns: [one, { n: 2, status: "error", past: true }] }), one, "a bare past card is no turn");
    assert.equal(fns.forkAt({ turns: [one, asked(2)] }), one, "a message a card stopped");
  });

  // (fails before: yes — the 11-01 report: a message a card stopped offered Fork, at a turn of the session's it is not;
  // and the map of 11-01 (P8): Copy, which copied nothing — a message on no record has no reply)
  test("a row on no record offers no Fork and no Copy: waiting, withdrawn, or stopped by a card; Retry stays where it sends the message after all", () => {
    const doc = stubDocument();
    try {
      const cb = { onCopy() {}, onFork() {}, onRetry() {}, onWatchRun() {} };
      const titles = (/** @type {any} */ turn) => /** @type {any} */ (footerEl(turn, cb)).querySelectorAll("button").map((/** @type {any} */ b) => String(b.getAttribute("title")).split(" — ")[0]);
      assert.deepEqual(titles(asked(2)), ["Retry"]);
      assert.deepEqual(titles({ n: 2, status: "stopped", withdrawn: true }), ["Retry"]);
      assert.deepEqual(titles({ n: 2, status: "waiting" }), []);
      assert.deepEqual(titles({ n: 2, status: "done" }), ["Copy", "Fork from here", "Retry"]);
    } finally {
      doc.restore();
    }
  });

  // (fails before: yes — the review of 7884b1c14: the header's Fork opened at a turn that failed, which the server does
  // not fork at — "turn N is still open (no final answer yet)"; the footer's Fork offered the same. And the review of
  // 0048a08b9: a turn waiting on its question ended with it — the server forks there — and had no Fork)
  test("Fork, from the header or a turn's footer, is at a turn that ended: with its answer, or the question it waits on", () => {
    const fns = lift(["forkAt"], { unsent: history.unsent, forkable: history.forkable });
    const read = (/** @type {number} */ n, /** @type {string} */ status = "done") => ({ n, status, past: true, history: true });
    const one = read(1);
    assert.equal(fns.forkAt({ turns: [one, read(2, "error")] }), one, "a turn that failed, read after a reload");
    const asking = { n: 2, status: "done", paused: { kind: "question" } };
    assert.equal(fns.forkAt({ turns: [one, asking] }), asking, "a turn waiting on its question");
    const stopped = { n: 2, status: "stopped" };
    assert.equal(fns.forkAt({ turns: [one, stopped] }), stopped, "a stopped turn ended with what it said");
    const doc = stubDocument();
    try {
      const cb = { onCopy() {}, onFork() {}, onRetry() {}, onWatchRun() {} };
      const titles = (/** @type {any} */ turn) => /** @type {any} */ (footerEl(turn, cb)).querySelectorAll("button").map((/** @type {any} */ b) => String(b.getAttribute("title")).split(" — ")[0]);
      assert.deepEqual(titles({ n: 2, status: "error", error: "overloaded" }), ["Copy", "Retry"], "failed");
      assert.ok(titles({ n: 2, status: "done", paused: { kind: "question" } }).includes("Fork from here"), "waiting on its question");
      assert.deepEqual(titles({ n: 2, status: "streaming" }), ["Copy", "Fork after the turn finishes", "Retry"], "running: once it ends");
    } finally {
      doc.restore();
    }
  });

  // (fails before: yes — the 11-01 report: a waiting row offered Rewind, which said "This message never went" — and the
  // row sends itself moments later)
  test("a row on no record offers no Rewind", () => {
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.match(timeline, /onRewind: unsent\(turn\) \? undefined : \(\) => cb\.onRewind\?\.\(chat, turn\),/);
    // (fails before: yes — the review of 7884b1c14: a row drawn as its send went, which then waited for the chat or was
    // stopped by a card, kept its Rewind: its user row is drawn once)
    assert.match(timeline, /function dropRewind\(turn, v\) \{\s+if \(unsent\(turn\)\) v\.userEl\.querySelector\("\.u-rewind"\)\?\.remove\(\);\s+\}/);
    assert.match(timeline, /drawFoot\(turn\) \{\s+const v = view\.get\(turn\);\s+if \(v\) dropRewind\(turn, v\);/, "as a waiting row's foot is drawn");
    assert.match(timeline, /const v = ensureView\(turn\);\s+dropRewind\(turn, v\);/, "as a send a card stopped ends");
  });

  // (fails before: yes — the review of 7884b1c14: a chat's first message a card stopped kept the message sent instead
  // from carrying the chat's load: it counted as the first)
  test("a chat's first message on record carries its load, past a message a card stopped", async () => {
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [asked(1)], live: null, load: { chainId: "s-old" } });
    /** @type {any[]} */
    const posts = [];
    const send = sendLift({ state: { currentId: "c1" }, chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null) }, (o) => (posts.push(o), new Promise(() => {})));
    void send("something else", []);
    await settled();
    assert.deepEqual(posts.map((o) => o.load), [{ chainId: "s-old" }]);
  });
});

describe("Fork at a turn the server forks at, wherever it is offered", () => {
  // (fails before: yes — the review of 0048a08b9: a chat row's Fork… forked at the row's count of finished turns, which
  // is no turn's number once one failed between them: turn 2 failed, turn 3 done → "turn 2 is still open")
  test("a chat row's Fork… forks at the chat's newest turn that ended, read from its transcript", async () => {
    const said = (/** @type {number} */ n, /** @type {boolean} */ failed = false) => ({ n, user: { role: "user", content: `m${n}` }, final: failed ? null : { role: "assistant", content: "ok" }, open: failed, facts: failed ? { error: "overloaded" } : {} });
    /** @type {any[]} */
    const posts = [];
    /** @type {any[]} */
    const opened = [];
    const fns = lift(["forkSessionRow", "forkAt"], {
      unsent: history.unsent,
      forkable: history.forkable,
      transcriptTurns: history.transcriptTurns,
      api: async (/** @type {string} */ url, /** @type {any} */ o) => {
        if (url.includes("/transcript")) return { turns: [said(1), said(2, true), said(3), said(4, true)], boundaries: [] };
        posts.push([url, o?.body]);
        return { forkedFrom: "s-1", atTurn: o?.body?.atTurn };
      },
      openFork: (/** @type {any} */ c, /** @type {any} */ f) => opened.push(f.atTurn),
    });
    await fns.forkSessionRow({ id: "s-1", title: "t", cwd: "H:/w", turns: 2 });
    assert.deepEqual([posts, opened], [[["/sessions/s-1/fork", { atTurn: 3 }]], [3]]);
  });

  test("Rewind's Fork instead is offered where the turn is one the session forks at", () => {
    assert.match(APP_SRC, /\.\.\.\(forkable\(turn\) \? \[\{ label: "Fork instead", [^\n]*forkModal\(chat, turn, \{ prefill: turn\.userText \|\| "", precheck: true \}\); \} \}\] : \[\]\),/);
  });
});

// (fails before: yes — a Hunter's of 11-01 (B3's leftover): a chat whose first message stopped on Filament's question,
// its header's folder changed, sent the card's answer into a new chat there, the card stranded on the old one; and a
// chat opened from the list took the header's new folder as its own while its messages went on in its old session)
test("a folder changed in the header: the box's new message in a chat with a session opens a new one there, any other send stays in its chat, a chat with none takes it", async () => {
  /** @param {any} chat @param {{ opens?: boolean }} [o] */
  const ready = (chat, o) => {
    const scope = {
      composer: { modelName: () => "m-1", permissionMode: () => "", effortValue: () => "", openModel() {} },
      folderIn: { value: "H:/b", dispatchEvent() {} },
      state: { models: [] },
      newChat: (/** @type {any} */ n) => ({ id: "fresh", chainId: null, cwd: n.cwd, model: n.model, turns: [] }),
      ensureSession: async (/** @type {any} */ c) => c.chainId || "s-new",
      rememberFolder() {},
      rememberModel() {},
      baseModelOf: (/** @type {string} */ m) => m,
      lastModel: () => "",
      refuse() {},
    };
    return lift(["readySession"], scope).readySession(chat, o);
  };
  const opened = { id: "c1", chainId: "s-1", cwd: "H:/a", model: "m-1", turns: [{ n: 1, status: "done", past: true }] };
  const r1 = await ready(opened, { opens: true });
  assert.deepEqual([r1.chat.id, r1.chat.cwd, opened.cwd], ["fresh", "H:/b", "H:/a"], "opened from the list: a new chat in the new folder");
  const r1b = await ready(opened);
  assert.deepEqual([r1b.chat.id, r1b.chat.cwd], ["c1", "H:/a"], "any other send: in its chat, its folder kept");
  const asked = { id: "c2", chainId: "s-2", cwd: "H:/a", model: "m-1", turns: [{ n: 1, status: "error", reply: { errorBody: { needsCompaction: true } } }] };
  const r2 = await ready(asked);
  assert.deepEqual([r2.chat.id, r2.chat.cwd], ["c2", "H:/a"], "the card's answer: in the card's chat, its folder kept");
  const fresh = { id: "c3", chainId: null, cwd: "H:/a", model: "m-1", turns: [] };
  const r3 = await ready(fresh);
  assert.deepEqual([r3.chat.id, r3.chat.cwd], ["c3", "H:/b"], "no session yet: the chat takes the folder");
});

// (fails before: yes — the review of f50fcf6f9: each send that met the missing folder opened a picker of its own: one
// picker asked for, 2 opened)
test("two sends that meet a folder not on this machine ask for a folder once: the second waits for the one the first was given, and the session is made there once", async () => {
  /** The folder each session POST was made in. @type {string[]} */
  const posts = [];
  let picks = 0;
  /** @type {(p: string | null) => void} */
  let pick = () => {};
  const chat = /** @type {any} */ ({ id: "c1", chainId: null, cwd: "H:/gone", model: "m-1", turns: [], live: null });
  const scope = {
    state: { currentId: "c1", models: [] },
    chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null),
    composer: standIn({ modelName: () => "m-1", permissionMode: () => "", effortValue: () => "" }),
    folderIn: { value: "H:/gone", dispatchEvent() {} },
    api: () => (posts.push(chat.cwd), chat.cwd === "H:/gone" ? Promise.reject(new Error("the folder does not exist")) : Promise.resolve({ id: "s-1" })),
    errText: (/** @type {any} */ e) => String(e?.message || e),
    pickProjectFolder: () => (picks++, new Promise((r) => (pick = r))),
    refusal: "",
  };
  const { readySession } = lift(["readySession", "ensureSession", "makeSession"], scope);
  // The chat's first message, and another Enter while its session is asked for.
  const first = readySession(chat, { opens: true });
  const second = readySession(chat, { opens: true });
  await settled();
  assert.equal(picks, 1, "one picker");
  pick("H:/here");
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual([a?.chat, b?.chat, chat.chainId, chat.cwd, posts], [chat, chat, "s-1", "H:/here", ["H:/gone", "H:/here"]]);
});

// (fails before: yes — the review of 3f174b6b6: a second send while a new chat's first was inside POST /sessions found
// no session and no turn of the chat's, and asked for a session of its own: ["/sessions", "/sessions"]; with one
// session and no wait for the turn the first began, it posted a second turn beside it: ["s-1", "s-1"]; and a chat whose
// session was being made took the header's other folder as its own: ["c2", "H:/b", "H:/b"])
test("two sends while a new chat's session is made make one session: the second waits for it, then for the end of the turn the first began, in the chat's queue", async () => {
  /** @type {string[]} */
  const posts = [];
  /** The session POSTs, each answered when the test says. @type {(() => void)[]} */
  const answer = [];
  /** @type {string[]} */
  const turns = [];
  /** @type {string[]} */
  const toasts = [];
  const chat = /** @type {any} */ ({ id: "c1", chainId: null, cwd: "H:/a", model: "m-1", turns: [], live: null, waiting: null });
  const scope = {
    state: { currentId: "c1", models: [] },
    chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null),
    composer: standIn({ modelName: () => "m-1", permissionMode: () => "", effortValue: () => "" }),
    folderIn: { value: "H:/a", dispatchEvent() {} },
    api: (/** @type {string} */ url) => {
      const id = `s-${posts.push(url)}`;
      return new Promise((r) => answer.push(() => r({ id })));
    },
    toast: (/** @type {string} */ w) => void toasts.push(w),
    refusal: "",
  };
  // The first message's turn runs on: its reply never ends here.
  const send = sendLift(scope, (/** @type {any} */ o) => (turns.push(o.chainId), new Promise(() => {})), ["readySession", "ensureSession", "makeSession?"]);
  void send("make the page", [], "normal", { fresh: true, boxed: true });
  // Another Enter while the session is still being made.
  /** @type {any} */
  let second = "unanswered";
  void send("and its tests", [], "normal", { fresh: true, boxed: true }).then((a) => (second = a));
  await settled();
  assert.deepEqual(posts, ["/sessions"], "one session asked for");
  for (const go of answer.splice(0)) go();
  await settled();
  assert.deepEqual([chat.chainId, turns, chat.turns.map((/** @type {any} */ t) => t.userText)], ["s-1", ["s-1"], ["make the page"]], "the first message's turn, in the one session");
  assert.equal(second, "queue", "the second waits in the queue for that turn's end, as no second turn beside it");
  assert.deepEqual(toasts, ["A turn began in this chat meanwhile — your message waits in the queue, and goes when it ends"]);
  // A folder put in the header meanwhile is no folder for the chat whose session is being made: the box's message
  // opens a new chat there.
  const making = /** @type {any} */ ({ id: "c2", chainId: null, cwd: "H:/a", model: "m-1", turns: [], making: new Promise(() => {}) });
  const ready = lift(["readySession"], { ...scope, folderIn: { value: "H:/b", dispatchEvent() {} }, newChat: (/** @type {any} */ n) => ({ id: "fresh", chainId: null, cwd: n.cwd, model: n.model, turns: [] }), ensureSession: async () => "s-new" });
  const r = await ready.readySession(making, { opens: true });
  assert.deepEqual([r?.chat.id, r?.chat.cwd, making.cwd], ["fresh", "H:/b", "H:/a"]);
});

// (fails before: yes — the review of c8a4f44d5: the send answered "queue" after its wait, ["queue", "queue"], and its
// caller put it in the queue of the chat shown by then — the box's panel, `sendOrQueue`'s `composer.enqueue` — to go
// into that chat at its turn's end)
test("a send that waited for a new chat's session, another chat shown by the time it may go, waits in its own chat's queue — never the chat shown's", async () => {
  /** @type {(() => void)[]} */
  const answer = [];
  /** @type {string[]} */
  const toasts = [];
  /** What reached the box's queue, the chat shown's. @type {any[]} */
  const boxQueue = [];
  const chat = /** @type {any} */ ({ id: "c1", chainId: null, cwd: "H:/a", model: "m-1", turns: [], live: null, waiting: null });
  const other = /** @type {any} */ ({ id: "c2", chainId: "s-b", cwd: "H:/b", model: "m-1", turns: [], live: null, waiting: null });
  /** @type {Record<string, any>} */
  const scope = {
    state: { currentId: "c1", models: [] },
    chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : id === "c2" ? other : null),
    composer: standIn({ modelName: () => "m-1", permissionMode: () => "", effortValue: () => "", enqueue: (/** @type {any[]} */ items) => void boxQueue.push(...items) }),
    folderIn: { value: "H:/a", dispatchEvent() {} },
    api: () => new Promise((r) => answer.push(() => r({ id: "s-1" }))),
    toast: (/** @type {string} */ w) => void toasts.push(w),
    queueAdd,
    queuedAnswer,
    queueOf: (/** @type {any} */ c) => (c.queue ||= queueState()),
    refusal: "",
  };
  // The first message's turn runs on: its reply never ends here.
  sendLift(scope, () => new Promise(() => {}), ["readySession", "ensureSession", "makeSession"]);
  const page = lift(["sendMessage", "compactingBetween?", "sendOrQueue", "readySession", "ensureSession", "makeSession"], scope);
  void page.sendMessage("make the page", [], "normal", { fresh: true, boxed: true });
  const shot = { name: "a.png", kind: "image", type: "image/png", data: "AAAA" };
  /** @type {any} */
  let second = "unanswered";
  void page.sendMessage("and its tests", [shot], "normal", { fresh: true, boxed: true }).then((/** @type {any} */ a) => (second = a));
  /** @type {any} */
  let carried = "unanswered";
  void page.sendOrQueue("then the docs").then((/** @type {any} */ a) => (carried = a));
  await settled();
  // The person opens another chat before the session comes.
  scope.state.currentId = "c2";
  for (const go of answer.splice(0)) go();
  await settled();
  assert.deepEqual(chat.turns.map((/** @type {any} */ t) => t.userText), ["make the page"], "the first message's turn, in its chat");
  assert.deepEqual([second, carried], [undefined, undefined], "taken: no \"queue\" for the box or the caller to put in the chat shown's queue");
  assert.deepEqual(chat.queue?.items, [{ text: "and its tests", files: [shot] }, "then the docs"], "its own chat's queue, whole");
  assert.deepEqual([boxQueue, other.queue, toasts], [[], undefined, []], "nothing in the chat shown's queue, nothing said over it");
});

// (fails before: yes — the review of 141d4458c (its #4 and #5): a move whose read failed left the header's chip on the
// folder the chat had left, which the next message read as one chosen for a new chat; and Everything's folder, made
// while the person switched chats, was put in the chip of the chat switched to)
test("the folder chip says the folder a chat moved to though its read failed; Everything's lands on the chat that asked", async () => {
  /** @type {any[]} */
  const told = [];
  const moving = { id: "m1", chainId: "s-1", cwd: "H:/a", turns: [] };
  const moveScope = {
    state: { currentId: "m1" },
    chatOf: (/** @type {string} */ id) => (id === "m1" ? moving : null),
    hydrate: async () => {
      throw new Error("the read failed");
    },
    headerModule: { setChat: (/** @type {any} */ c) => void told.push([c.id, c.cwd]) },
    folderIn: { dispatchEvent() {} },
    sidebar: { load() {} },
    toast() {},
    errText: (/** @type {any} */ e) => String(e?.message || e),
  };
  await lift(["movedTo"], moveScope).movedTo(moving, "H:/b-wt", "Moved", { done() {} });
  assert.deepEqual(told, [["m1", "H:/b-wt"]], "the header told the chat, in the folder it moved to");

  const chip = { value: "", dispatchEvent() {} };
  const shown = { models: [], currentId: "e1" };
  const asking = { id: "e1", chainId: null, cwd: null, model: "m-1", turns: [] };
  const readyScope = {
    composer: { modelName: () => "m-1", permissionMode: () => "", effortValue: () => "", openModel() {} },
    folderIn: chip,
    state: shown,
    chatOf: (/** @type {string} */ id) => (id === "e1" ? asking : { id }),
    // The person switches to another chat while Everything is made.
    api: async () => ((shown.currentId = "other"), { cwd: "H:/everything" }),
    ensureSession: async () => "s-new",
    sidebar: { load() {} },
    rememberFolder() {},
    rememberModel() {},
    baseModelOf: (/** @type {string} */ m) => m,
    lastModel: () => "",
    refuse() {},
  };
  const r = await lift(["readySession"], readyScope).readySession(asking);
  assert.deepEqual([r?.chat.cwd, chip.value], ["H:/everything", ""], "the chat works in Everything; the chip shown stays the other chat's");
});

// (fails before: yes — the review of 141d4458c: the send kept a card's answer and a waiting row's own in their chat and
// took every other send to a new chat in the header's other folder — the queue's next message, Resume's "continue", a
// decision's answer, a switch's answer, Send as it is, a team's first words)
test("a send takes the header's other folder to a new chat for the person's new message from the box alone", async () => {
  /** Whether each send asked for a chat that may open anew. @type {boolean[]} */
  const seen = [];
  const chat = { id: "c1", chainId: "s-1", cwd: "H:/a", model: "m-1", turns: [], live: null, waiting: null };
  const scope = {
    state: { currentId: "c1" },
    chatOf: () => chat,
    flowWordsOf: () => null,
    planWordsOf: () => null,
    steerForkOf: () => null,
    teamsOf: () => [],
    usesIn: () => [],
    teamUsesIn: () => [],
    agentCards: { all: () => [] },
    readOnlyNow: () => false,
    followsStill: () => false,
    viewOnlyPage: () => false,
    caughtUp() {},
    // Asked either way the page has said it: `opens`, or `stays` before it.
    readySession: (/** @type {any} */ _c, /** @type {any} */ o) => (seen.push(o?.opens ?? !o?.stays), null),
    refusal: "",
  };
  const { sendMessage } = lift(["sendMessage", "compactingBetween?"], scope);
  /** @type {Record<string, any>} */
  const ways = {
    "the box": { fresh: true, boxed: true },
    "the queue": { queued: true },
    "a decision's answer, a card's command, Resume's continue": {},
    "a task's carry-on": { ours: true },
    "a switch's answer": { modeSwitch: true, ours: true },
    "Send as it is": { sendAsIs: true, boxed: true },
    "a team's first words": { boxed: true },
    "a card's answer": { replaces: { n: 1 } },
    "a waiting row's own": { goes: () => {}, replaces: { n: 1, status: "waiting" } },
  };
  for (const [way, o] of Object.entries(ways)) assert.equal(await sendMessage("go on", [], "normal", o), false, way);
  assert.deepEqual(Object.keys(ways).filter((_, i) => seen[i]), ["the box"]);
  assert.match(APP_SRC, /onSend: \(text, attachments, modifier, o\) => sendMessage\(text, attachments, modifier, \{ modeSwitch: o\?\.modeSwitch === true, queued: o\?\.queued === true, overrules: o\?\.overrules \|\| \[\], sendAsIs: o\?\.sendAsIs === true, carry: o\?\.carry \|\| null, boxed: o\?\.queued !== true, fresh: o\?\.queued !== true, via: o\?\.via \|\| null \}\),/, "the box's own send, not the queue's, is fresh");
});

describe("two tabs on one chat: a turn's number is the session's", () => {
  // (fails before: yes — the rv21 drive of 11-01: tab Y's "say hi" guessed turn 4, where tab X's /compact was turn 4 and
  // "say hi" turn 5 at the server; a read matched the turns by number — "say hi" drawn twice, the /compact turn gone)
  test("a read knows the page's own turn by its request, takes the server's number for it, and keeps the turn it had guessed", () => {
    const read = (/** @type {number} */ n, /** @type {string} */ text, /** @type {string[]} */ ids) => ({ n, status: "done", past: true, history: true, userText: text, requestIds: ids, boundaries: [], boundariesAfter: [] });
    const server = [read(1, "a", ["r1"]), read(2, "b", ["r2"]), read(3, "c", ["r3"]), read(4, "/compact", ["r-x"]), read(5, "say hi", ["r-y"])];
    const mine = { n: 4, status: "done", userText: "say hi", requestId: "r-y", boundaries: [{ type: "settings", beforeTurn: 4 }], boundariesAfter: [] };
    const page = [read(1, "a", ["r1"]), read(2, "b", ["r2"]), read(3, "c", ["r3"]), mine];
    const merged = mergedTurns(page, server);
    assert.deepEqual(merged.map((t) => [t.n, t.userText, t === mine]), [[1, "a", false], [2, "b", false], [3, "c", false], [4, "/compact", false], [5, "say hi", true]]);
    assert.deepEqual(mine.boundaries.map((/** @type {any} */ b) => b.beforeTurn), [5], "its settings row moves with it");
    // A turn the server holds no row of yet (a command's, numbered at its end) stands beside the server's of its number.
    const running = { n: 4, status: "streaming", userText: "/compact", requestId: "r-z", boundaries: [], boundariesAfter: [] };
    assert.deepEqual(mergedTurns([running], server.slice(0, 4)).map((t) => [t.n, t.userText]), [[1, "a"], [2, "b"], [3, "c"], [4, "/compact"], [4, "/compact"]]);
    // A send whose head never came is known by its own name for the send, which the server's turn holds.
    const headless = { n: 3, status: "error", userText: "c", requestId: null, sendId: "s3", boundaries: [], boundariesAfter: [] };
    assert.deepEqual(mergedTurns([headless], [...server.slice(0, 2), { ...server[2], sends: ["s3"] }]).map((t) => t === headless), [false, false, true]);
  });

  // (fails before: yes — the review of 3f163c5b2: a send whose head never came was known by its number and its words: the
  // turn of its number said them — another tab's "continue" — or any later turn did, however much later, and the send the
  // server never took was drawn as that turn; and words at the end of another message's ("Sure?\nyes") were its own)
  test("a send whose head never came is the turn that holds its send: at the number another tab's pushed it to, never one of the same words", () => {
    const read = (/** @type {number} */ n, /** @type {string} */ text, /** @type {string[]} */ ids, /** @type {string[]} */ sends = []) => ({ n, status: "done", past: true, history: true, userText: text, requestIds: ids, sends, boundaries: [], boundariesAfter: [] });
    const headless = (/** @type {string} */ text, o = {}) => ({ n: 3, status: "error", userText: text, requestId: null, sendId: "mine", boundaries: [], boundariesAfter: [], ...o });
    const drawn = (/** @type {any[]} */ turns, /** @type {any} */ mine) => turns.map((t) => [t.n, t.userText, t === mine]);
    for (const read2 of [false, true]) {
      const mine = headless("c", read2 ? { fromTranscript: true } : {});
      const merged = mergedTurns([mine], [read(1, "a", ["r1"]), read(2, "b", ["r2"]), read(3, "x", ["rX"], ["theirs"]), read(4, "c", ["rC"], ["mine"])]);
      assert.deepEqual(drawn(merged, mine), [[1, "a", false], [2, "b", false], [3, "x", false], [4, "c", !read2]], read2 ? "drawn from a read: the server's copy alone" : "drawn once, at the server's number");
    }
    const never = headless("continue");
    assert.deepEqual(
      drawn(mergedTurns([never], [read(1, "a", ["r1"]), read(2, "b", ["r2"]), read(3, "continue", ["rX"], ["theirs"]), read(4, "continue", ["rY"], ["later"])]), never),
      [[1, "a", false], [2, "b", false], [3, "continue", false], [3, "continue", true], [4, "continue", false]],
      "another tab's turns of its words, at its number and after: theirs; the send the server never took stays the error it is",
    );
    const yes = headless("yes");
    assert.deepEqual(drawn(mergedTurns([yes], [read(1, "a", ["r1"]), read(2, "b", ["r2"]), read(3, "Sure?\nyes", ["rX"], ["theirs"])]), yes).map((r) => r[2]), [false, false, false, true], "another message that ends in its words");
  });

  // (fails before: yes — the review of be36c9503: a Retry goes on in the row of the turn that failed, which then held
  // both requests, and the read gave it to the failed try — drawn beside the retry, both turn 3; where the retry's reply
  // was lost, drawn in the server's copy's place, the retry and its answer gone. And a send that failed before the
  // server, guessed 3, took by its number the row of the next send, whose reply was lost: that answer gone)
  test("a Retry is the turn that failed: a read draws it once, and a failed send takes no other send's row", () => {
    const read = (/** @type {number} */ n, /** @type {string} */ text, /** @type {string[]} */ ids) => ({ n, status: "done", past: true, history: true, userText: text, requestIds: ids, boundaries: [], boundariesAfter: [] });
    const page = (/** @type {any[]} */ ...mine) => [read(1, "a", ["r1"]), read(2, "b", ["r2"]), ...mine];
    const own = (/** @type {any} */ t) => ({ boundaries: [], boundariesAfter: [], ...t });
    const server = (/** @type {string} */ text, /** @type {string[]} */ ids) => [read(1, "a", ["r1"]), read(2, "b", ["r2"]), read(3, text, ids)];
    const drawn = (/** @type {any[]} */ turns, /** @type {Record<string, any>} */ named) =>
      turns.map((t) => [t.n, t.userText, t.status, Object.keys(named).find((k) => named[k] === t) || "server"]);
    for (const lost of [false, true]) {
      const failed = own({ n: 3, status: "error", userText: "c", requestId: "rF" });
      const retry = own({ n: 3, status: "done", userText: "c", requestId: "rR", ...(lost ? { fromTranscript: true } : {}) });
      assert.deepEqual(
        drawn(mergedTurns(page(failed, retry), server("c", ["rF", "rR"])), { failed, retry }),
        [[1, "a", "done", "server"], [2, "b", "done", "server"], [3, "c", "done", lost ? "server" : "retry"]],
        lost ? "the retry's reply lost: the server's copy" : "the retry, drawn live",
      );
    }
    const headless = own({ n: 3, status: "error", userText: "c", requestId: null, sendId: "sC" });
    const next = own({ n: 3, status: "done", userText: "d", requestId: "rD", fromTranscript: true });
    assert.deepEqual(
      drawn(mergedTurns(page(headless, next), server("d", ["rD"])), { headless, next }),
      [[1, "a", "done", "server"], [2, "b", "done", "server"], [3, "d", "done", "server"], [3, "c", "error", "headless"]],
      "the send the server never took stays the error it is, beside the next send's turn",
    );
    // (fails before: yes — the review of 3f163c5b2 (its #6): a Retry whose reply's head never came, gone on in the failed
    // try's row, was no turn of the server's — the failed try took the row by its request, and the Retry was drawn beside
    // it, its error under the row's answer)
    const failed = own({ n: 3, status: "error", userText: "c", requestId: "rF", sendId: "sF" });
    const retry = own({ n: 4, status: "error", userText: "c", requestId: null, sendId: "sR" });
    assert.deepEqual(
      drawn(mergedTurns(page(failed, retry), [...server("c", ["rF", "rR"]).slice(0, 2), { ...server("c", ["rF", "rR"])[2], sends: ["sF", "sR"] }]), { failed, retry }),
      [[1, "a", "done", "server"], [2, "b", "done", "server"], [3, "c", "error", "retry"]],
      "a Retry whose head never came, in the failed try's row: that row's, drawn once",
    );
  });

  // (fails before: yes — the same: the send kept the number it guessed)
  test("a send takes the number the session's head names, its settings row and the rows on no record with it, and owes a read", async () => {
    const waiting = { n: 4, status: "waiting" };
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [{ n: 1, status: "done" }, { n: 2, status: "done" }, { n: 3, status: "done" }, waiting], live: null });
    const send = sendLift({ state: { currentId: "c1" }, chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null) }, (o) => {
      o.onHeaders("r-y", { status: 200, turn: 5 });
      return new Promise(() => {});
    });
    void send("say hi", []);
    await settled();
    const sent = chat.turns.find((/** @type {any} */ t) => t.userText === "say hi");
    assert.deepEqual([sent.n, waiting.n, chat.hydrateAfterSend], [5, 6, true]);
    assert.deepEqual([history.renumbered(chat.turns, sent, 5), history.renumbered(chat.turns, sent, null)], [false, false], "told again, or told none: nothing moves");
  });

  // (fails before: yes — a send numbered itself by a count of the page's turns, which a turn that took the session's
  // number past a turn the page does not hold leaves one short: the next send took that number again)
  test("a send numbers itself after the newest turn on record, not by a count", async () => {
    const chat = /** @type {any} */ ({ id: "c1", chainId: "s-c1", cwd: "H:/w/proj", model: "m-1", turns: [{ n: 1, status: "done" }, { n: 2, status: "done" }, { n: 5, status: "done" }, { n: 6, status: "stopped", withdrawn: true }], live: null });
    const send = sendLift({ state: { currentId: "c1" }, chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : null) }, () => new Promise(() => {}));
    void send("next", []);
    await settled();
    assert.equal(chat.turns.at(-1).n, 6);
    assert.equal(history.nextNumber([]), 1);
  });

  test("the page takes the number at the head and at the end, and a reload's waiting row numbers on after the turns on record", () => {
    assert.match(APP_SRC, /onHeaders: \(id, marks\) => \{\s+turn\.requestId = id;[^]*?if \(renumbered\(chat\.turns, turn, marks\.turn\)\) chat\.hydrateAfterSend = true;/);
    assert.match(APP_SRC, /await transcript\.finish\(live, [^\n]+\n[^\n]*\n\s+if \(renumbered\(chat\.turns, turn, turn\.rec\?\.memory\?\.turn\)\) chat\.hydrateAfterSend = true;/);
    assert.ok(!/n: chat\.turns(\.filter\([^)]*\))?\.length \+ 1/.test(APP_SRC), "no turn numbered by a count");
    const apiSrc = readFileSync("src/ui/harness/lib/api.js", "utf8");
    assert.match(apiSrc, /turn: Number\(res\.headers\.get\("x-filament-turn"\)\) \|\| null,/);
  });
});

describe("a fork opened with a message", () => {
  // (fails before: yes — the drive of page2: the message a fork opens with went into the box and out again: the address
  // the fork opens at shows the chat once more, and showing a chat puts its own draft in the box, which held none)
  test("keeps it as the fork's draft: shown again, its box holds it", async () => {
    /** @type {Map<string, string>} */
    const drafts = new Map();
    let box = "";
    const state = { currentId: /** @type {string | null} */ (null), chats: new Map() };
    /** @type {Record<string, any>} */
    const scope = {
      state,
      chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
      putChat: (/** @type {any} */ c) => (state.chats.set(c.id, c), c),
      newChatId: () => "f1",
      chatTitle: () => "the source",
      selectChat: (/** @type {string} */ id) => {
        state.currentId = id;
        box = drafts.get(id) || "";
      },
      hydrate: async () => {},
      draftFor: (/** @type {any} */ c) => drafts.get(c.id) || "",
      saveDraft: (/** @type {any} */ c, /** @type {string} */ words) => void drafts.set(c.id, words),
      composer: standIn({ setDraft: (/** @type {string} */ words) => void (box = words) }),
      sidebar: standIn({}),
      toast: () => {},
    };
    const { openFork } = lift(["openFork"], scope);
    await openFork({ cwd: "H:/w/proj", model: "m-1" }, { chainId: "s-f1", forkedFrom: "s-c1", atTurn: 2, copied: { turns: 2, blocks: 0 } }, "go on from here");
    assert.equal(box, "go on from here");
    // The address the fork opens at shows it again (app.js `applyRoute`).
    scope.selectChat("f1");
    assert.equal(box, "go on from here");
  });
});
