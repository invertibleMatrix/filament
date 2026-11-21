// @ts-check
// Opening a chat, a running one above all (the chat-open audit of 10-29): what the page asks Filament for, in what
// order, and what it reads again for nothing. The page's own functions run here against stand-ins (helpers/app-lift.js):
// the transcript goes out first and the side looks once it has landed; the meter weighs the plain preview, never the
// compactor's plan; the unread mark is one write; a chat chosen again is not drawn again; a chat read while another is
// shown does not take the transcript over; what was read of an ended turn comes with it into the next reading; the
// live poll reads the session's live state alone, the goal's look the goal alone; a turn running in a chat not shown
// leaves the shown chat's panes and status as they are.
import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_SRC, NOOP, lift } from "./helpers/app-lift.js";
import { transcriptTurns, withReadWork, mergedTurns, meterTurnOf, newestOnRecord } from "../src/ui/harness/conversation/history.js";
import { withReadRuns } from "../src/ui/harness/lib/turn-reads.js";
import { alignOnto, letGoOfLog } from "../src/ui/harness/lib/labels.js";
import { transcriptWhole, writtenSince } from "../src/ui/harness/lib/transcript-since.js";

/** A promise and its resolve, for a read the test lands when it says. */
function later() {
  /** @type {(v: any) => void} */
  let land = () => {};
  const p = new Promise((r) => (land = r));
  return { p, land };
}
const tick = () => new Promise((r) => setImmediate(r));

/** The page's state, with one chat and the session list. @param {any[]} [sessions] */
function pageState(sessions = []) {
  return { currentId: /** @type {string | null} */ (null), chats: new Map(), sessions, unreadChains: new Set(), terminals: [], compactingHeard: new Map(), commands: new Map(), holders: new Map() };
}

/** A store of the agents' lists: `setChain` with a session reads its list, as the page's do. @param {string[]} calls @param {string} name */
function storeOf(calls, name) {
  let chain = "";
  return {
    setChain: (/** @type {string | null} */ id) => {
      const next = String(id || "");
      if (next === chain) return;
      chain = next;
      if (chain) calls.push(`${name} ${chain}`);
    },
    chainId: () => chain,
    rows: () => [],
  };
}

/** The open path, lifted whole: openSession → selectChat → hydrate, the status's looks, the meter, the claim. */
function openPath({ popped = "" } = {}) {
  /** @type {string[]} */
  const calls = [];
  const transcriptRead = later();
  const state = pageState([{ id: "s1", title: "Running chat", cwd: "C:/work", unread: true }]);
  const renders = /** @type {any[]} */ ([]);
  const scope = {
    state,
    POPPED: popped,
    // This computer's page: a view-only device's reads no terminals (remote-view-ui.test.js).
    viewOnlyPage: () => false,
    opening: new WeakSet(),
    chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
    putChat: (/** @type {any} */ c) => {
      const chat = { kind: "new", chainId: null, turns: [], live: null, following: true, ...c };
      state.chats.set(chat.id, chat);
      return chat;
    },
    newChatId: () => "c1",
    chatByChain: () => null,
    letGo: new Map(),
    api: (/** @type {string} */ path, /** @type {any} */ init) => {
      calls.push(`${init?.method || "GET"} ${path}`);
      if (path.startsWith("/sessions/s1/transcript")) return transcriptRead.p;
      return Promise.resolve({});
    },
    apiShared: (/** @type {string} */ path) => scope.api(path, undefined),
    claim: (/** @type {string | null} */ chainId) => calls.push(`PUT /tabs/open ${chainId}`),
    subagentStore: storeOf(calls, "agents"),
    besideStore: storeOf(calls, "teams"),
    flowList: storeOf(calls, "flows"),
    transcript: { render: (/** @type {any} */ c) => renders.push(c), startTurn() {}, pause() {}, refreshSpace() {} },
    transcriptTurns, withReadWork, mergedTurns, withReadRuns, transcriptWhole, writtenSince,meterTurnOf,
    waitingOwes: () => null,
    newestOnRecord,
    folderIn: { value: "" },
    onScreen: () => true,
    recordHeld: () => 1, factsHeld: () => 1, factsAfterCompaction: () => null, factsOfFreshStart: () => null,
  };
  const fns = lift(["openSession", "selectChat", "drawnChat?", "drawChat?", "hydrate", "markRead", "refreshStatus", "termSeq", "termAt", "loadTerminals", "loadGoal", "loadGit", "claimWriting", "paintMeter", "meterRecords", "sessionChat", "previewKeyOf", "composePreview", "previewCache", "plainPreview", "plainCache"], scope);
  return { fns, calls, transcriptRead, state, renders };
}

// (fails before: yes — the meter's preview with the compactor's plan, the agents' lists, the terminals, the session's
// row, the place and the writing claim all went out ahead of the transcript)
test("a chat opened asks for its transcript first, and for the rest once it has landed", async () => {
  const { fns, calls, transcriptRead } = openPath();
  const opened = fns.openSession({ id: "s1", title: "Running chat", cwd: "C:/work", unread: true }, { push: true, view: "chat" });
  await tick();
  assert.deepEqual(calls, ["PATCH /sessions/s1/settings", "GET /sessions/s1/transcript?work=held"], "the unread mark's write, then the transcript: nothing else is on its way");
  transcriptRead.land({ turns: [], title: "Running chat", cwd: "C:/work", live: null });
  await opened;
  await tick();
  const after = calls.slice(2);
  for (const want of ["agents s1", "teams s1", "flows s1", "GET /terminal", "GET /sessions/s1/goal", "PUT /tabs/open s1"])
    assert.ok(after.includes(want), `${want} goes once the transcript has landed (${after.join(", ")})`);
  assert.ok(after.some((c) => c.startsWith("GET /git/place?cwd=")), "the place is looked up once it has landed");
  assert.ok(!calls.some((c) => c.includes("compaction=1")), "the meter never asks for the compactor's plan");
  assert.equal(calls.filter((c) => c.startsWith("PATCH ")).length, 1, "the unread mark is written once");
});

// (fails before: yes — the meter asked `compose?dry=1&compaction=1`, the plan's, before the transcript and again after)
test("the meter weighs the plain preview, once the chat's turns are read", () => {
  const state = pageState();
  /** @type {string[]} */
  const calls = [];
  const opening = new WeakSet();
  const { paintMeter } = lift(["paintMeter", "meterRecords", "sessionChat", "previewKeyOf", "composePreview", "previewCache", "plainPreview", "plainCache"], {
    state, POPPED: "", opening, chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
    api: (/** @type {string} */ p) => (calls.push(p), Promise.resolve({})),
    meterTurnOf, recordHeld: () => 1, factsHeld: () => 1, factsAfterCompaction: () => null, factsOfFreshStart: () => null,
  });
  const chat = { id: "c2", chainId: "s2", turns: [], live: null, view: { settings: { hash: "h1" } } };
  state.chats.set("c2", chat);
  state.currentId = "c2";
  paintMeter(chat);
  assert.deepEqual(calls, ["/sessions/s2/compose?dry=1"], "the plain preview: the meter reads `current`, which the server weighs without the plan");
  // A chat whose transcript is on its way weighs nothing yet: its turns and its settings are not the ones it will have.
  const reading = { id: "c3", chainId: "s3", turns: [], live: null };
  state.chats.set("c3", reading);
  state.currentId = "c3";
  opening.add(reading);
  paintMeter(reading);
  assert.deepEqual(calls, ["/sessions/s2/compose?dry=1"], "nothing weighed while its transcript is on its way");
});

test("a popped pane's window reads nothing for a meter or a status panel it does not show", async () => {
  const { fns, calls, transcriptRead } = openPath({ popped: "changes" });
  const opened = fns.openSession({ id: "s1", title: "Running chat", cwd: "C:/work" }, {});
  transcriptRead.land({ turns: [], title: "Running chat", cwd: "C:/work", live: null });
  await opened;
  await tick();
  assert.deepEqual(calls.filter((c) => !c.startsWith("agents") && !c.startsWith("teams") && !c.startsWith("flows")), ["PATCH /sessions/s1/settings", "GET /sessions/s1/transcript?work=held"], "its panes read the agents' lists; nothing else");
});

// (fails before: yes — the left bar's open wrote the mark, and the open wrote it again from the sessions list's row)
test("a chat opened from the left bar clears its unread mark in one write", async () => {
  /** @type {string[]} */
  const calls = [];
  const row = { id: "s1", title: "Done elsewhere", unread: true };
  const state = pageState([row]);
  const start = APP_SRC.indexOf("  onOpen: (s) => {");
  const end = APP_SRC.indexOf("\n  },\n", start);
  assert.ok(start > 0 && end > start, "found the left bar's onOpen");
  const scope = {
    state,
    api: (/** @type {string} */ path, /** @type {any} */ init) => (calls.push(`${init?.method || "GET"} ${path}`), Promise.resolve({})),
    chatByChain: () => null,
    letGo: new Map(),
    opening: new WeakSet(),
    putChat: (/** @type {any} */ c) => c,
    newChatId: () => "c1",
    selectChat: () => {},
    hydrate: async () => {},
    chatOf: () => null,
    viewOnlyPage: () => false,
  };
  const { openSession, markRead } = lift(["openSession", "markRead"], scope);
  const onOpen = new Function("openSession", "state", "api", "leaveScreen", `return ({\n${APP_SRC.slice(start, end)}\n  },\n}).onOpen;`)(openSession, state, scope.api, () => {});
  // The row the left bar drew from a list read a moment before this one: the same session, unread in both.
  onOpen({ ...row });
  await tick();
  assert.equal(calls.filter((c) => c === "PATCH /sessions/s1/settings").length, 1);
  assert.equal(row.unread, false, "the list's row reads read");
  // A team's chat beside another has no row in the sessions list: the row it was opened from says it is unread.
  calls.length = 0;
  markRead({ id: "team-1", unread: true });
  assert.deepEqual(calls, ["PATCH /sessions/team-1/settings"]);
});

// (fails before: yes — the bug hunt of 10-30, UIS-3: a chat that turned out not to exist put an empty chat in place of
// whatever was on screen, even after the person had gone on to another chat while it was read)
test("a chat the archive does not have makes way for an empty one only while it is the chat on screen", async () => {
  /** A chat opened whose read answers 404, with the person where `then` leaves them by then. @param {(state: any) => void} then */
  const open = async (then) => {
    const state = pageState();
    /** @type {string[]} */
    const said = [];
    let made = 0;
    const scope = {
      state,
      opening: new WeakSet(),
      chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
      putChat: (/** @type {any} */ c) => {
        const chat = { chainId: null, turns: [], ...c };
        state.chats.set(chat.id, chat);
        return chat;
      },
      newChatId: () => "c-gone",
      chatByChain: () => null,
      letGo: new Map(),
      selectChat: (/** @type {string} */ id) => { state.currentId = id; },
      hydrate: async () => {
        then(state);
        throw Object.assign(new Error("no such session: s-gone"), { status: 404 });
      },
      newChat: () => void made++,
      toast: (/** @type {string} */ m) => void said.push(m),
      api: async () => ({}),
    };
    const { openSession } = lift(["openSession"], scope);
    await openSession({ id: "s-gone", title: "", cwd: "" });
    return { state, said, made };
  };
  const stayed = await open(() => {});
  assert.deepEqual([stayed.made, stayed.said, stayed.state.chats.has("c-gone")], [1, ["No chat “s-gone” in the archive: starting an empty one"], false]);
  const went = await open((state) => { state.currentId = "c-other"; });
  assert.deepEqual([went.made, went.said, went.state.chats.has("c-gone"), went.state.currentId], [0, ["No chat “s-gone” in the archive"], false, "c-other"], "the person stays where they went");
});

// (fails before: yes — a second choice of the chat on screen drew its every turn again)
test("the chat on screen chosen again is not drawn again; its turns read anew are", () => {
  const { fns, state, renders } = openPath();
  const chat = { id: "c1", chainId: "s1", cwd: "C:/work", turns: [{ n: 1 }], live: null };
  state.chats.set("c1", chat);
  fns.selectChat("c1");
  fns.selectChat("c1", { view: "chat" });
  assert.equal(renders.length, 1, "drawn once");
  chat.turns = [{ n: 1 }, { n: 2 }];
  fns.selectChat("c1");
  assert.equal(renders.length, 2, "new turns: drawn again");
  const other = { id: "c2", chainId: "s2", cwd: "C:/work", turns: [], live: null };
  state.chats.set("c2", other);
  fns.selectChat("c2");
  fns.selectChat("c1");
  assert.deepEqual(renders.slice(2), [other, chat], "a switch draws the chat switched to");
});

/** A transcript of one ended turn that ran a run. */
const ENDED = { turns: [{ n: 1, turnId: "t1", run: true, requestIds: ["r1"], user: { content: [{ type: "text", text: "go" }] }, final: { role: "assistant", content: [{ type: "text", text: "done" }] }, workCount: 0 }], title: "A chat", cwd: "C:/work", live: null };

// (fails before: yes — a chat read while another was shown, its turn ended in the background, took the transcript over)
test("a chat read while another is shown is not drawn over the chat on screen", async () => {
  const { fns, state, renders } = openPath();
  const shown = { id: "c1", chainId: "s1", cwd: "C:/work", turns: [], live: null };
  const hidden = { id: "c9", chainId: "s9", cwd: "C:/work", turns: [], live: null };
  state.chats.set("c1", shown);
  state.chats.set("c9", hidden);
  fns.selectChat("c1");
  const before = renders.length;
  // The hidden chat's transcript is read (its followed turn ended): its turns are its own, the screen stays.
  const lifted = lift(["hydrate", "drawChat?", "drawnChat?", "meterRecords"], {
    state, newestOnRecord, chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
    api: async () => ENDED, transcript: { render: (/** @type {any} */ c) => renders.push(c), startTurn() {}, pause() {}, refreshSpace() {} },
    transcriptTurns, withReadWork, mergedTurns, withReadRuns, transcriptWhole, writtenSince,waitingOwes: () => null, opening: new WeakSet(),
  });
  state.currentId = "c1";
  await lifted.hydrate(hidden);
  assert.equal(renders.length, before, "nothing drawn");
  assert.equal(hidden.turns.length, 1, "the hidden chat holds its turns");
  await lifted.hydrate(shown);
  assert.equal(renders.at(-1), shown, "the chat on screen is drawn as it is read");
});

// (fails before: yes — every reading made the turns anew, and each read its run's log, its changes and its record again.
// Since 11-15 what comes of its run is its log's alignment, the log let go of: labels.js `letGoOfLog`)
test("what was read of an ended turn comes with it into the next reading", async () => {
  const state = pageState();
  const log = [{ n: 1, type: "run-start" }, { n: 2, type: "run-end" }];
  const alignCache = /** @type {any} */ ({});
  const aligned = alignOnto(alignCache, log);
  letGoOfLog(alignCache, log);
  const tree = { totals: { files: 1 } };
  const rec = { id: "r1" };
  const chat = { id: "c1", chainId: "s1", cwd: "C:/work", turns: /** @type {any[]} */ ([{ n: 1, turnId: "t1", runId: "r1", requestId: "r1", status: "done", past: true, history: true, alignCache, aligned, tree, steers: [] }]), live: null };
  state.chats.set("c1", chat);
  state.currentId = "c1";
  const meterRecords = new WeakMap([[chat.turns[0], rec]]);
  const lifted = lift(["hydrate", "drawChat?", "drawnChat?", "keptOfTurn?"], {
    state, newestOnRecord, chatOf: (/** @type {string} */ id) => state.chats.get(id) || null, meterRecords,
    api: async () => ENDED, transcript: { render() {}, startTurn() {}, pause() {}, refreshSpace() {} },
    transcriptTurns, withReadWork, mergedTurns, withReadRuns, transcriptWhole, writtenSince,waitingOwes: () => null, opening: new WeakSet(),
  });
  const was = chat.turns[0];
  await lifted.hydrate(chat);
  const now = chat.turns[0];
  assert.notEqual(now, was, "a new turn, as the transcript makes it");
  assert.equal(now.aligned, aligned, "its run's log aligned, not read again");
  assert.equal(now.alignCache.whole, true);
  assert.equal(now.runLog, undefined, "and not the log itself");
  assert.equal(now.tree, tree, "its changes, not read again");
  assert.equal(meterRecords.get(now), rec, "the meter's record, not read again");
});

/** followLiveTurn, lifted, with its follow, its frames and its poll in the test's hands. */
function liveFollow() {
  const state = pageState();
  /** @type {string[]} */
  const calls = [];
  /** @type {any[]} */
  const follows = [];
  /** @type {((landed: any[]) => void)[]} */
  const draws = [];
  /** @type {(() => any)[]} */
  const timers = [];
  let pulses = 0;
  let viewPulses = 0;
  /** @type {any} */
  let liveState = { live: { requestId: "r1" } };
  const hydrated = /** @type {any[]} */ ([]);
  const fns = lift(["followLiveTurn"], {
    state, newestOnRecord,
    chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
    api: (/** @type {string} */ path) => (calls.push(path), Promise.resolve(liveState)),
    followRun: (/** @type {string} */ id, /** @type {any} */ o) => (follows.push({ id, ...o }), { stop() {} }),
    createRunDraw: (/** @type {any} */ draw) => (draws.push(draw), { add() {}, now() {} }),
    setTimeout: (/** @type {() => any} */ fn) => (timers.push(fn), 0),
    rail: { pulse: () => pulses++ },
    views: { pulse: () => viewPulses++ },
    hydrate: async (/** @type {any} */ c) => void hydrated.push(c),
    createHeldSteers: () => ({ release: () => [] }),
    // The transcript aligns the turn's log as the timeline's `applyEvents` does; the rest of it stands in.
    transcript: new Proxy({ applyEvents: (/** @type {any} */ t, /** @type {any[]} */ events) => void (t.aligned = alignOnto((t.alignCache ||= {}), events)) }, { get: (o, k) => (k in o ? /** @type {any} */ (o)[k] : NOOP) }),
    letGoOfLog,
  });
  const turn = { n: 3, turnId: "t3", past: true, history: true, status: "open", runId: "r1", steers: [] };
  const chat = { id: "c1", chainId: "s1", turns: [turn], live: /** @type {any} */ (null) };
  state.chats.set("c1", chat);
  return { fns, state, chat, turn, calls, follows, draws, timers, hydrated, pulses: () => pulses, viewPulses: () => viewPulses, setLive: (/** @type {any} */ v) => (liveState = v) };
}

// (fails before: yes — the timeline read the running turn's log as a past turn's cards beside its follow. Since 11-15 the
// turn kept the whole log, `runLog`, for the reading at its end; now its alignment alone)
test("a running turn's log is read by its follow alone, and its alignment kept whole at its end, the log let go of", async () => {
  const f = liveFollow();
  f.state.currentId = "c1";
  f.fns.followLiveTurn(f.chat, { requestId: "r1", startedAt: 1 });
  assert.ok(f.turn.runRead instanceof Promise, "marked read: the timeline's past-turn read leaves it to the follow");
  assert.equal(f.follows.length, 1);
  assert.equal(f.follows[0].since, 0, "followed from its first event");
  f.follows[0].onEvent({ n: 1, type: "run-start" });
  f.follows[0].onEvent({ n: 2, type: "round-start", round: 1 });
  f.follows[0].onEvent({ n: 3, type: "run-end" });
  f.draws[0]([]);
  f.follows[0].onRunEnd("done");
  await tick();
  assert.equal(f.hydrated.length, 1, "the turn's end reads the transcript");
  const turn = /** @type {any} */ (f.turn);
  assert.equal(turn.runLog, undefined, "no log goes with the turn into that reading");
  assert.equal(turn.alignCache.whole, true, "its alignment does, whole (lib/turn-reads.js)");
  assert.equal(turn.alignCache.list, null);
  assert.equal(turn.aligned.maxRound, 1);
});

// (fails before: yes — the drive of 10-29: a running turn whose reply was asked for whole names its run to the live state
// only as it ends; opened meanwhile, it was marked read for a follow that never started, and drew none of its work)
test("a running turn the live state names no run for yet is the timeline's to read, and followed once the poll names it", async () => {
  const f = liveFollow();
  f.state.currentId = "c1";
  f.setLive({ live: { requestId: null } });
  f.fns.followLiveTurn(f.chat, { requestId: null, startedAt: 1 });
  assert.equal(f.follows.length, 0, "no run named: nothing followed");
  assert.equal(/** @type {any} */ (f.turn).runRead, undefined, "its cards left for the timeline to read, as a past turn's are");
  await f.timers[0]();
  assert.equal(f.follows.length, 0, "still unnamed");
  f.setLive({ live: { requestId: "r1" } });
  await f.timers[1]();
  assert.deepEqual(f.follows.map((x) => [x.id, x.since]), [["r1", 0]], "named: followed from its first event");
});

test("a turn settled by the poll, its follow not at its end, keeps no alignment whole to carry", async () => {
  const f = liveFollow();
  f.state.currentId = "c1";
  f.fns.followLiveTurn(f.chat, { requestId: "r1", startedAt: 1 });
  const live = f.chat.live;
  f.follows[0].onEvent({ n: 1, type: "run-start" });
  f.draws[0]([]);
  f.setLive({ live: null });
  await f.timers[0]();
  assert.equal(f.hydrated.length, 1);
  const turn = /** @type {any} */ (f.turn);
  assert.notEqual(turn.alignCache.whole, true, "what it aligned is not the whole log: the turn made anew reads it");
  assert.equal(turn.alignCache.list, live.events);
  assert.equal(turn.runLog, undefined);
});

// (fails before: yes — every 2.5 s the poll read `transcript?work=0&limit=1` for one field of it)
test("the live poll reads the session's live state alone", async () => {
  const f = liveFollow();
  f.state.currentId = "c1";
  f.fns.followLiveTurn(f.chat, { requestId: "r1", startedAt: 1 });
  await f.timers[0]();
  assert.deepEqual(f.calls, ["/sessions/s1/live-state"]);
  assert.equal(f.hydrated.length, 0, "still live: no settle");
});

// (fails before: yes — a turn running in a chat not shown refreshed the shown chat's panes at each of its frames)
test("a turn running in a chat not shown leaves the shown chat's panes as they are", () => {
  const f = liveFollow();
  f.state.currentId = "c1";
  f.fns.followLiveTurn(f.chat, { requestId: "r1", startedAt: 1 });
  f.draws[0]([]);
  assert.equal(f.pulses(), 1, "its own chat shown: the panes follow it");
  f.state.currentId = "c2";
  f.draws[0]([]);
  assert.equal(f.pulses(), 1, "another chat shown: nothing");
});

// (fails before: yes — the performance audit of 10-29: the views — Plan, Agents, Overview, the tabs' badges — draw the
// chat shown alone, and a turn running in any other chat pulsed them at each of its frames)
test("a turn running in a chat not shown pulses no view; one in the chat shown does", () => {
  const f = liveFollow();
  f.state.currentId = "c1";
  f.fns.followLiveTurn(f.chat, { requestId: "r1", startedAt: 1 });
  f.draws[0]([]);
  assert.equal(f.viewPulses(), 1, "its own chat shown: the views follow it");
  f.state.currentId = "c2";
  f.draws[0]([]);
  assert.equal(f.viewPulses(), 1, "another chat shown: nothing");
  // A send's frames, the same.
  const state = pageState();
  const seen = /** @type {string[]} */ ([]);
  const chat = { id: "c9", chainId: "s9" };
  const scope = { state, chat, turn: {}, live: { events: [] }, chatOf: (/** @type {string} */ id) => (id === "c9" ? chat : null), views: { pulse: () => seen.push("views") } };
  const drawRun = new Function("room", `with (room) {\n${sendDraw()}\nreturn drawRun;\n}`)(new Proxy(scope, {
    has: (t, k) => k in t || !(k in globalThis),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? /** @type {any} */ (t)[k] : NOOP),
  }));
  state.currentId = "c1";
  drawRun([]);
  assert.deepEqual(seen, []);
  state.currentId = "c9";
  drawRun([]);
  assert.deepEqual(seen, ["views"]);
});

/** The send's per-frame draw, lifted from sendMessage. */
function sendDraw() {
  const start = APP_SRC.indexOf("  const drawRun = (landed) => {");
  const end = APP_SRC.indexOf("\n  };\n", start);
  assert.ok(start > 0 && end > start, "found the send's drawRun");
  return APP_SRC.slice(start, end + 4);
}

// (fails before: yes — a hidden chat's send refreshed the shown chat's panes, and read its own goal and place for a
// panel that drew neither)
test("a send's frames in a chat not shown read nothing for the shown chat's panes or status", () => {
  const state = pageState();
  const seen = /** @type {string[]} */ ([]);
  const chat = { id: "c9", chainId: "s9", goalAt: 5, gitAt: 5 };
  const scope = {
    state, chat, turn: {}, live: { events: [] },
    chatOf: (/** @type {string} */ id) => (id === "c9" ? chat : null),
    rail: { pulse: () => seen.push("pulse") },
    refreshStatus: () => seen.push("status"),
    loadTerminals: () => seen.push("terminals"),
  };
  const drawRun = new Function("room", `with (room) {\n${sendDraw()}\nreturn drawRun;\n}`)(new Proxy(scope, {
    has: (t, k) => k in t || !(k in globalThis),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? /** @type {any} */ (t)[k] : NOOP),
  }));
  state.currentId = "c1";
  drawRun([]);
  assert.deepEqual(seen, ["terminals"], "the terminals are the server's, shown whatever chat is");
  assert.equal(chat.goalAt, 0, "its goal is read as it is shown again");
  assert.equal(chat.gitAt, 0, "its place too");
  seen.length = 0;
  state.currentId = "c9";
  drawRun([]);
  assert.deepEqual(seen, ["pulse", "status"]);
});

// The owner's of 11-15, the page's process at 1.4 GB after three days: the page's own send kept its run's whole log on
// its turn (its alignment's cache held `live.events`) for as long as the chat held that turn.
// (fails before: yes — the send had no letGoOfRun, and its frames kept the log)
test("a send's turn lets go of its run's log once the send is done, the turn ended and the run's end drawn", () => {
  const start = APP_SRC.indexOf("  const letGoOfRun = () => {");
  const end = APP_SRC.indexOf("\n  };\n", start);
  assert.ok(start > 0 && end > start, "found the send's letGoOfRun");
  const chat = /** @type {any} */ ({ id: "c9", chainId: "s9" });
  const turn = /** @type {any} */ ({ status: "streaming" });
  const live = /** @type {any} */ ({ events: [] });
  chat.live = live;
  const scope = {
    state: pageState(), chat, turn, live, letGoOfLog,
    transcript: { applyEvents: (/** @type {any} */ t, /** @type {any[]} */ events) => void (t.aligned = alignOnto((t.alignCache ||= {}), events)) },
  };
  const drawRun = new Function("room", `with (room) {\n${APP_SRC.slice(start, end + 4)}\n${sendDraw()}\nreturn drawRun;\n}`)(new Proxy(scope, {
    has: (t, k) => k in t || !(k in globalThis),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? /** @type {any} */ (t)[k] : NOOP),
  }));
  live.events.push({ n: 1, type: "run-start" }, { n: 2, type: "round-start", round: 1 }, { n: 3, type: "run-end" });
  drawRun([]);
  assert.equal(turn.alignCache.list, live.events, "the send still runs: its log is kept");
  chat.live = null;
  turn.status = "paused";
  drawRun([]);
  assert.equal(turn.alignCache.list, live.events, "a paused turn has not ended");
  turn.status = "done";
  live.events.pop();
  drawRun([]);
  assert.equal(turn.alignCache.list, live.events, "its run's end not in yet: more may come");
  live.events.push({ n: 3, type: "run-end" });
  drawRun([]);
  assert.equal(turn.alignCache.whole, true, "let go of");
  assert.equal(turn.alignCache.list, null);
  assert.equal(turn.aligned.maxRound, 1, "its alignment kept");
});

// (fails before: yes — a hidden chat's place was read, then dropped)
test("the place is looked up for the chat shown only", async () => {
  const state = pageState();
  /** @type {string[]} */
  const calls = [];
  const { loadGit } = lift(["loadGit"], { state, apiShared: async (/** @type {string} */ p) => (calls.push(p), {}), refreshStatus: () => {} });
  state.currentId = "c1";
  await loadGit({ id: "c9", chainId: "s9" }, "C:/work");
  assert.deepEqual(calls, []);
  await loadGit({ id: "c1", chainId: "s1" }, "C:/work");
  assert.deepEqual(calls, ["/git/place?cwd=C%3A%2Fwork&chain=s1"]);
});
