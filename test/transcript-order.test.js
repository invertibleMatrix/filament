// @ts-check
// Where the harness draws two things mid-turn (2026-09-30):
// BUG-13 — the developer's steering messages sat in one box pinned to the bottom of a running turn, read or not, so
// three messages the loop had already delivered stayed under every later thinking block and reply ("you started your
// thinking block above those three messages"). A message the loop has read now takes its place in the flow, at the
// round whose results carried it; only messages still waiting sit at the bottom.
// BUG-16 — the files-changed card appeared mid-stream and moved after every round (it followed "the newest round's
// cards"). Each edit's own card carries its +/−; the turn's summary card now appears once the turn has settled, at
// the end of the turn, outside the fold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { alignEvents, foldSplit, boxSteers, steerWords } from "../src/ui/harness/lib/labels.js";

test("a steer the loop read is anchored at the round whose results carried it", () => {
  const al = alignEvents([
    { type: "round-start", round: 1, n: 1 },
    { type: "steer", id: "s1", kind: "note", text: "also check the logs", n: 2 },
    { type: "round-start", round: 2, n: 3 },
    { type: "steer", id: "s2", kind: "note", text: "and the tests", n: 4 },
    { type: "steer-read", ids: ["s1"], n: 5 },
    { type: "round-start", round: 3, n: 6 },
  ]);
  const s1 = al.steers.get("s1");
  assert.equal(s1?.read, true);
  assert.equal(s1?.readRound, 2, "read while round 2 ran: it rides round 2's results, before round 3's words");
  assert.ok(al.byRound.get(2)?.steers.some((s) => s.id === "s1"), "drawn with round 2's cards");
  const s2 = al.steers.get("s2");
  assert.equal(s2?.read, false);
  assert.ok(!al.byRound.get(2)?.steers.some((s) => s.id === "s2"), "a message still waiting is not anchored in the flow");
});

// (fails before: yes — the user's report, 2026-10-09: three notes read "Conversation steered" the moment Claude Code
// took them, while it went on compacting its context for four minutes; the same message went three times)
test("a coding agent's note: delivered when the agent takes it, steered once the agent's next round starts", () => {
  const events = [
    { type: "run-start", kind: "coding-agent", meta: { steer: "live" }, n: 1 },
    { type: "round-start", round: 245, n: 2 },
    { type: "compacting", round: 245, own: true, by: "Claude Code", n: 3 },
    { type: "steer", id: "s1", kind: "note", text: "no need to check flex", n: 4 },
    { type: "steer-read", ids: ["s1"], kinds: ["note"], n: 5 },
  ];
  const taken = alignEvents(events).steers.get("s1");
  assert.deepEqual([taken?.read, taken?.taken], [false, true], "taken, not read: the agent is still compacting");
  assert.deepEqual([steerWords(taken).tone, steerWords(taken).state], ["pending", "Delivered — the agent reads it at its next step"]);
  assert.deepEqual(boxSteers([taken], true).map((s) => s.id), ["s1"], "it waits at the bottom while the turn runs");
  assert.equal(steerWords(taken, { settled: true }).tone, "unread", "a turn that ended before the agent's next round never read it");
  const al = alignEvents([...events, { type: "compaction", round: 245, own: true, n: 6 }, { type: "round-start", round: 246, n: 7 }]);
  const read = al.steers.get("s1");
  assert.equal(read?.read, true);
  assert.equal(read?.readRound, 245, "drawn after the round it was taken in, before the next round's words");
  assert.ok(al.byRound.get(245)?.steers.some((s) => s.id === "s1"));
  assert.equal(steerWords(read).state, "Conversation steered");
  const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
  const fromLog = /const FROM_LOG = \/\*\* @type \{const\} \*\/ \(\[([^\]\n]*)\]\);/.exec(timeline);
  assert.ok(fromLog, "the fields a bubble takes from the run's log");
  for (const k of ["read", "unread", "taken", "after", "queuedAt", "interrupt", "waits", "word", "agent", "refused"]) assert.ok(fromLog[1].includes(`"${k}"`), k);
  assert.match(timeline, /if \(src && FROM_LOG\.some\(\(k\) => src\[k\] !== s\[k\]\)\) \{\s+for \(const k of FROM_LOG\) s\[k\] = src\[k\];/, "the bubble drawn before the log carried it takes the state too");
});

// (fails before: yes — HarnessV4_Tasks U1; HarnessV3-FailurePoints §7.2, §14.3: a note to Claude waits in Claude's own
// queue, and its bubble read "Waiting for the run's next step…", then "Delivered", whatever became of it — and one
// that ran as the next prompt, its turn over, read "Conversation steered")
test("a note to an agent that queues what is typed: queued at it, then taken — or runs next, its turn having ended first; one sent to interrupt it says so", () => {
  const start = { type: "run-start", kind: "coding-agent", meta: { steer: "queued", interrupts: true, agent: "Claude Code" }, n: 1 };
  const note = (/** @type {string} */ id, /** @type {Record<string, any>} */ o = {}) => ({ type: "steer", id, kind: "note", text: `note ${id}`, ...o });
  const state = (/** @type {any[]} */ events, /** @type {string} */ id, /** @type {any} */ o = undefined) => { const w = steerWords(alignEvents(events).steers.get(id), o); return [w.tone, w.state]; };
  const sent = [start, { type: "round-start", round: 1 }, note("s1"), note("s2", { interrupt: true })];
  assert.deepEqual(alignEvents(sent).steers.get("s1")?.queuedAt, "Claude Code");
  assert.deepEqual(state(sent, "s1"), ["pending", "Queued at Claude Code — goes in at its next step"]);
  assert.deepEqual(state(sent, "s2"), ["pending", "Interrupting Claude Code…"]);
  // Claude's echo of it: taken into its turn — read once its next round starts.
  const took = [...sent, { type: "steer-read", ids: ["s1"], kinds: ["note"] }];
  assert.deepEqual(state(took, "s1"), ["pending", "Taken — Claude Code has it in its turn"]);
  assert.deepEqual(state([...took, { type: "round-start", round: 2 }], "s1"), ["read", "Conversation steered"]);
  // Its turn ended first: it runs as the agent's next prompt, and says so before and after.
  const after = [...sent, { type: "steer-read", ids: ["s1"], kinds: ["note"], after: true }];
  assert.deepEqual(state(after, "s1"), ["pending", "Runs next — Claude Code's turn had ended first"]);
  assert.deepEqual(state([...after, { type: "round-start", round: 2 }], "s1"), ["read", "Ran as its next prompt"]);
  // Never taken (a stop dropped it): the words of any note the turn ended before.
  const dropped = alignEvents([...sent, { type: "steer-unread", ids: ["s1"], kinds: ["note"] }]).steers.get("s1");
  assert.deepEqual([steerWords(dropped, { settled: true, stopped: true }).tone, steerWords({ ...dropped, next: true }, { settled: true }).state], ["unread", "The turn ended before the agent took this — queued as your next message"]);
  // An agent with no name on its run, and a run that takes notes another way: as before.
  assert.deepEqual(state([{ ...start, meta: { steer: "queued" } }, note("s1")], "s1"), ["pending", "Queued at the agent — goes in at its next step"]);
  assert.deepEqual(state([{ ...start, meta: { steer: "live", agent: "Codex" } }, note("s1")], "s1"), ["pending", "Waiting for the run's next step…"]);
  assert.deepEqual(state([{ type: "run-start", kind: "agent-turn", meta: {} }, note("s1")], "s1"), ["pending", "Waiting for the run's next step…"], "Filament's own loop reads it at its next step");
  // A stop to such a run is a stop: no queue's words.
  assert.equal(alignEvents([start, { type: "steer", id: "x", kind: "stop", text: "" }]).steers.get("x")?.queuedAt, undefined);
  // The server's side: the mailbox says a note that ran next, and the run names its agent.
  assert.match(readFileSync("src/services/runs.js", "utf8"), /took: \(m, \{ after = false \} = \{\}\) => \{[\s\S]{0,200}events\.publish\(`run:\$\{runId\}`, \{ type: "steer-read", ids: \[m\.id\], kinds: \[m\.kind\], \.\.\.\(after \? \{ after: true \} : \{\}\) \}\);/);
  const turn = readFileSync("src/app/acp-turn.js", "utf8");
  assert.match(turn, /if \(!took \|\| !mb\.took\(note, \{ after: took === "after" \}\)\) \{/);
  assert.match(turn, /meta: \{ engine: upstream\.type, upstream: upstream\.id, agent: agentName, model: modelId,/);
});

// (fails before: yes — HarnessV4_Tasks U1; HarnessV3-FailurePoints §14.3: a `/word` note its run held — the agent's own
// command, or one that may be, sent before the agent said its commands — read "Queued at Claude Code — goes in at its
// next step" while it was not going in at all; only the turn's record said why)
test("a `/word` note its run holds says why: it waits for the agent's commands, or is one of them and waits for the turn's end", () => {
  const start = { type: "run-start", kind: "coding-agent", meta: { steer: "queued", agent: "Claude Code" }, n: 1 };
  const note = { type: "steer", id: "s1", kind: "note", text: "/review the diff" };
  const state = (/** @type {any[]} */ events, /** @type {any} */ o = undefined, /** @type {Record<string, any>} */ more = {}) => { const w = steerWords({ ...alignEvents(events).steers.get("s1"), ...more }, o); return [w.tone, w.state]; };
  const unsure = [start, note, { type: "steer-weighed", ids: ["s1"], as: "unsure", word: "/review" }];
  assert.deepEqual(state(unsure), ["pending", "Waiting for Claude Code to say its commands — /review may be one of them"]);
  // The agent said its commands, and it is one: it waits for the turn's end — and says so once the turn is over.
  const command = [...unsure, { type: "steer-weighed", ids: ["s1"], as: "command", word: "/review" }];
  assert.deepEqual(state(command), ["pending", "/review is Claude Code's own command — it waits for the turn's end and goes as your next message"]);
  const ended = [...command, { type: "steer-unread", ids: ["s1"], kinds: ["note"] }];
  assert.deepEqual(state(ended, { settled: true }, { next: true }), ["unread", "/review is Claude Code's own command — queued as your next message"]);
  assert.deepEqual(state(ended, { settled: true, stopped: true }), ["unread", "The turn stopped before reading this"], "a stopped turn sends nothing on");
  // …or it is none of them: it goes in as any note does, and reads so.
  const words = [...unsure, { type: "steer-weighed", ids: ["s1"], as: "words" }];
  assert.equal(alignEvents(words).steers.get("s1")?.waits, null);
  assert.deepEqual(state(words), ["pending", "Queued at Claude Code — goes in at its next step"]);
  assert.deepEqual(state([...words, { type: "steer-read", ids: ["s1"], kinds: ["note"] }]), ["pending", "Taken — Claude Code has it in its turn"]);
  // An agent that takes notes another way waits the same; one with no name on its run is "the agent".
  assert.deepEqual(state([{ ...start, meta: { steer: "next", agent: "Cursor" } }, note, { type: "steer-weighed", ids: ["s1"], as: "command", word: "/review" }]), ["pending", "/review is Cursor's own command — it waits for the turn's end and goes as your next message"]);
  assert.deepEqual(state([{ ...start, meta: { steer: "queued" } }, note, { type: "steer-weighed", ids: ["s1"], as: "unsure", word: "/review" }]), ["pending", "Waiting for the agent to say its commands — /review may be one of them"]);
  // A note the log does not carry is none of the event's: nothing breaks.
  assert.equal(alignEvents([start, { type: "steer-weighed", ids: ["gone"], as: "command", word: "/x" }]).steers.size, 0);
  // The server's side: said once per wait, from where the note is weighed; the registry describes it.
  const turn = readFileSync("src/app/acp-turn.js", "utf8");
  assert.match(turn, /const say = \(as, word = null\) => events\.publish\(topic, \{ type: "steer-weighed", ids: \[note\.id\], as, \.\.\.\(word \? \{ word \} : \{\}\) \}\);/);
  assert.match(turn, /heldNotes\.set\(note\.id, note\.text\);\n\s*say\("command", command\);/);
  // …and a held command whose words were changed into words says so (HarnessV4_Tasks C34).
  assert.match(turn, /if \(unsureNotes\.delete\(note\.id\) \|\| was\) say\("words"\);/);
  assert.match(turn, /say\("unsure", word\);/);
});

test("the loop's note, and any run's stop, are read as they are taken", () => {
  const loop = alignEvents([{ type: "run-start", kind: "agent-turn", n: 1 }, { type: "steer", id: "s1", kind: "note", text: "x", n: 2 }, { type: "steer-read", ids: ["s1"], n: 3 }]);
  assert.equal(loop.steers.get("s1")?.read, true, "the loop takes a note into its next request: read");
  const stop = alignEvents([{ type: "run-start", kind: "coding-agent", n: 1 }, { type: "steer", id: "s2", kind: "stop", text: "", n: 2 }, { type: "steer-read", ids: ["s2"], n: 3 }]);
  assert.equal(stop.steers.get("s2")?.read, true, "a stop is Filament's to act on, not the model's to read");
});

test("the steer box: while the turn runs only what still waits; once settled, every message", () => {
  const steers = [{ id: "a", read: true }, { id: "b", read: false }];
  assert.deepEqual(boxSteers(steers, true).map((s) => s.id), ["b"], "read ones are in the flow, not at the bottom");
  assert.deepEqual(boxSteers(steers, false).map((s) => s.id), ["a", "b"], "a settled turn keeps them in view between the work and the reply");
});

test("the files-changed summary stays outside the fold once the turn settles, after the reply", () => {
  const segs = [
    { kind: "block", block: { type: "thinking" } },
    { kind: "cards" },
    { kind: "block", block: { type: "text", text: "Done." } },
    { kind: "files" },
  ];
  const settled = foldSplit(segs, { live: false });
  assert.deepEqual(settled.after.map((s) => s.kind), ["files"], "at the turn's end, visible");
  assert.ok(!settled.fold.some((s) => s.kind === "files"), "never folded away with the work");
});

test("the timeline adds the summary only when the turn has settled, anchors read steers while live, and re-places the cards at the end", () => {
  const src = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
  assert.match(src, /kind: "files"/, "the summary is its own segment kind");
  assert.match(src, /if \(!live && \(snaps\.length \|\| files\.length\)\)/, "no summary while the turn streams");
  assert.match(src, /boxSteers\(\/\*\* @type \{any\[\]\} \*\/ \(turn\.steers\), live\)/, "the bottom box holds only what still waits while live");
  const from = src.indexOf("async finish(live, status)");
  const fin = src.slice(from, src.indexOf("enrich(); // the reply's last fence", from));
  assert.match(fin, /api_\.placeCards\(turn\)/, "finish re-places the cards: the summary appears, inline steers move into the settled box");
});
