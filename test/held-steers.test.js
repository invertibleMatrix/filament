// @ts-check
// HarnessV3-CodebasePass decisions 1 and 2, the page's half. The owner's first test drive: "sending new messages
// wouldn't even enter the loop for quite a while". Enter pressed while the page's turn had no run yet (composing,
// compacting at the line, reading memory) put the text back in the box without a word, and a turn compacting before
// its request showed a bare spinner for minutes. Now the message is held, drawn as waiting for the run and sent the
// moment the run is known (or queued for the next turn when none reads it), and the live fold says it is compacting.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHeldSteers } from "../src/ui/harness/lib/held-steers.js";
import { steerWords, turnPhaseWords } from "../src/ui/harness/lib/labels.js";

describe("held steers (decision 2)", () => {
  // (fails before: the module did not exist — the composer handed the text back)
  test("held in the order typed; flushed one after another to the run; a refusal comes back with its error", async () => {
    /** @type {string[]} */
    const posted = [];
    /** @type {((v?: any) => void) | null} */
    let release = null;
    let inFlight = 0;
    let most = 0;
    const held = createHeldSteers({
      post: async (runId, m) => {
        inFlight++;
        most = Math.max(most, inFlight);
        posted.push(`${runId}:${m.kind}:${m.text}`);
        if (m.text === "first") await new Promise((r) => (release = r));
        inFlight--;
        if (m.text === "late") throw Object.assign(new Error("no loop is listening"), { status: 409 });
        return { message: { id: `srv-${posted.length}` } };
      },
    });
    const a = held.hold("note", "first");
    const b = held.hold("veto", "second");
    const c = held.hold("note", "late");
    assert.equal(new Set([a.id, b.id, c.id]).size, 3, "each held message has its own id (its bubble's)");
    assert.equal(held.size(), 3);
    const flushing = held.flush("run-1");
    assert.equal(held.size(), 0, "the flush takes them all at once: a release meanwhile finds none");
    const meanwhile = held.hold("note", "typed during the flush");
    assert.deepEqual(held.release(), [meanwhile], "a message typed during the flush is the caller's, not lost");
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(posted, ["run-1:note:first"], "the second waits for the first: the order typed holds");
    /** @type {any} */ (release)();
    const out = await flushing;
    assert.equal(most, 1, "never two at once");
    assert.deepEqual(posted, ["run-1:note:first", "run-1:veto:second", "run-1:note:late"]);
    assert.deepEqual(out.map((r) => [r.held.text, r.out?.message?.id ?? null, r.error ? String(/** @type {any} */ (r.error).status) : null]), [
      ["first", "srv-1", null],
      ["second", "srv-2", null],
      ["late", null, "409"],
    ]);
    assert.equal(held.size(), 0);
    assert.deepEqual(await held.flush("run-1"), [], "nothing held, nothing sent");
  });

  // (fails before: yes — HarnessV4_Tasks U4: nothing could read what was held without taking it, so a page going away
  // could not keep it)
  test("what is held can be read where it stays held: the page keeps it as it goes away", () => {
    const held = createHeldSteers({ post: async () => ({}) });
    held.hold("note", "first");
    held.hold("veto", "second");
    assert.deepEqual(held.texts(), ["first", "second"]);
    assert.equal(held.size(), 2, "still held: the run may yet come");
    held.release();
    assert.deepEqual(held.texts(), []);
  });

  // (fails before: yes — found by the Bug Hunter, 10-19: a held message kept a team's result only as words)
  test("a message that carries a team's result keeps the result and the person's own words, for the run or the queue", async () => {
    /** @type {any[]} */
    const posted = [];
    const held = createHeldSteers({ post: async (_run, m) => { posted.push(m.text); return { message: { id: "s-1" } }; } });
    const result = { kind: "team", name: "Bug Hunter's result", text: "Found: 15", team: { id: "t-1", main: "c-1", n: 3 } };
    const m = held.hold("note", "Found: 15\n\nfix the first three", [], { teams: [result], typed: "fix the first three" });
    assert.deepEqual([m.teams, m.typed], [[result], "fix the first three"]);
    assert.equal("teams" in held.hold("note", "plain"), false, "none carried: none kept");
    const out = await held.flush("r-1");
    assert.deepEqual(out.map((r) => r.held.teams?.length || 0), [1, 0], "the flush hands back what each carried, for the page to say sent");
    assert.deepEqual(posted, ["Found: 15\n\nfix the first three", "plain"]);
  });

  test("the bubble says what it waits for: the run to start, or the run's next step", () => {
    assert.equal(steerWords({ kind: "note", text: "x", held: true }).state, "Waiting for the run to start…");
    assert.equal(steerWords({ kind: "veto", text: "x", held: true }).state, "veto — Waiting for the run to start…");
    assert.equal(steerWords({ kind: "note", text: "x" }).state, "Waiting for the run's next step…");
    assert.equal(steerWords({ kind: "note", text: "x", unread: true }).state, "The run ended before reading this", "a sent one no run read says so");
  });
});

describe("the turn's phase in words (decision 1)", () => {
  // (fails before: there were no words — the fold said nothing until the run's first event)
  test("compacting, by the session's method; anything else says nothing", () => {
    assert.equal(turnPhaseWords({ kind: "compacting", method: "fold" }), "compacting first — folding the older turns; the model is asked once it's done");
    // Memory's wait (HarnessV3-FailurePoints §5.1 item 3): its lookups alone — nothing is captured from a message by its
    // words any more (the memory plan's d3), so no turn waits on that.
    assert.equal(turnPhaseWords({ kind: "recalling" }), "recalling memory first — your message goes to the model once it's done");
    assert.equal(turnPhaseWords({ kind: "capturing" }), "", "a phase no turn has any more says nothing");
    assert.equal(turnPhaseWords({ kind: "compacting", method: "summary" }), "compacting first — summarizing the history; the model is asked once it's done");
    // The owner's rules of 10-31: one summary or the instant fold; a method no layer holds any more is the summary's.
    for (const method of ["trim", "auto"]) assert.equal(turnPhaseWords({ kind: "compacting", method }), "compacting first — summarizing the history; the model is asked once it's done", method);
    assert.equal(turnPhaseWords(null), "");
    assert.equal(turnPhaseWords({ kind: "other" }), "");
  });
});

// The page's wiring (no DOM here): the pins the two fixes rest on.
describe("the page's wiring", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const composer = readFileSync("src/ui/harness/composer/composer.js", "utf8");
  const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
  const turnJs = readFileSync("src/ui/harness/conversation/turn.js", "utf8");
  const send = app.slice(app.indexOf("async function sendMessage("), app.indexOf("async function stopCurrent("));
  test("Enter before the run is known holds the message, a coding agent's too — one whose run takes no words mid-turn queues it — never hands it back", () => {
    assert.ok(!/if \(chat\.live && !chat\.live\.turn\.paused\) return false;/.test(send), "the silent bounce is gone");
    const noRun = send.slice(send.indexOf("if (chat.live && !chat.live.turn.paused) {"), send.indexOf("const chip = folderIn.value.trim();"));
    // A coding agent's turn queues it before any steer where its run takes no words mid-turn (HarnessV3-ACP AC3-1); its
    // run not known yet, it is held as the loop's.
    // A message to weigh aside first is refused before (the owner's of 11-05): no coding agent's turn weighs one.
    assert.match(send, /const agentTurn = !!chat\.live && !chat\.live\.turn\.paused && \(chat\.live\.runKind === "coding-agent" \|\| \(!chat\.live\.runKind && codingAgentModel\(chat\.model\)\)\);\s+(?:\/\/[^\n]*\s+)*const weigh = modifier === "fork";\s+if \(weigh && \(agentTurn [^\n]*\s+if \(agentTurn && chat\.live\.runKind && !agentTakesWords\(chat\.live\.steer\)\) \{\s+toast\(agentQueuesWords\(chat\.live\.own\)\);\s+return "queue";/);
    const queues = send.indexOf("!agentTakesWords(chat.live.steer)");
    assert.ok(queues > 0 && queues < send.indexOf("if (chat.live && chat.live.runId && !chat.live.turn.paused) {"));
    assert.match(send, /const kind = modifier === "veto" && !agentTurn \? "veto" : "note";\s+(?:\/\/[^\n]*\s+|const (?:interrupt|how|team|images|files|over) = [^\n]*\s+|if \(team\.others\.length [^\n]*\s+return refuse\([^\n]*\s+)*try \{\s+const out = await steerPost/, "a coding agent's turn takes notes: Ctrl+Enter is one too");
    // (fails before: yes — found by the Bug Hunter, 10-19: a team's result held here was said sent at once, its card's
    // Send gone, though no run had read it yet) It is held with its result and the person's own words, and said sent
    // only once the run takes it.
    // The row it went by (`via`, the owner's of 11-09) goes with it to the run.
    assert.match(noRun, /const team = teamWords\(attachments, text\);\s+const m = chat\.live\.held\.hold\(kind, team\.words, overrules, \{ teams: team\.teamed, typed: text, \.\.\.\(kind === "note" \? \{ use: useTags, useTeams: useKeys \} : \{\}\), weigh \}\);\s+(?:\/\/[^\n]*\s+)*if \(via\) Object\.assign\(m, \{ via \}\);\s+transcript\.addSteer\(chat\.live\.turn, \{ id: m\.id, kind, text, held: true, read: false, unread: false, \.\.\.\(team\.named\.length \? \{ files: team\.named, shots: team\.named\.map\(\(\) => null\) \} : \{\}\), \.\.\.\(overrules\.length \? \{ overrules: overrules\.map\(\(o\) => \(\{ name: o\.name \}\)\) \} : \{\}\) \}\);\s+return;/);
    assert.doesNotMatch(noRun.slice(0, noRun.indexOf("const ready = away ? readyAway(chat) : await readySession(chat, { opens: fresh });")), /teamSent\(/);
    assert.match(send, /held: createHeldSteers\(\{ post: steerPost \}\)/, "every turn the page sends has its own");
  });
  // (and, HarnessV3-Views V3 — fails before: yes — another chat shown, they stayed on their turn as bubbles no run
  // would read, the queue being the shown chat's; now each chat keeps its own, and a turn's end reaches the composer
  // only while its chat is shown)
  test("held messages go out the moment the run is known, in both detection paths, and the rest are queued at the end", () => {
    // The run's kind first (HarnessV3-ACP AC3-1: a coding agent's says whether it takes them), then what was held.
    const carried = send.slice(send.indexOf("const carriedEvent = (e) => {"), send.indexOf("const detectRun = async"));
    assert.match(carried, /if \(e\?\.type === "run-start" && e\.kind\) runKnown\(chat, live, e\);\s+if \(!detected\) \{\s+detected = true;\s+live\.runId = turn\.requestId;\s+turn\.runId = turn\.requestId;\s+deliverHeld\(chat, live\);/);
    assert.match(send, /turn\.runId = requestId;\s+runKnown\(chat, live, runInfo\.run\);\s+deliverHeld\(chat, live\);/);
    assert.match(send, /chat\.live = null;[\s\S]*requeueHeld\(chat, live, live\.held\.release\(\)\);\s+(?:\/\/[^\n]*\n\s+)*const endedBy = [^\n]+\n(?:\s*\/\/[^\n]*\n)+\s+if \(chatOf\(state\.currentId\) === chat\) composer\.setLive\(false, null, endedBy\);/, "queued before the queue drains, after the chat is free");
    const deliver = app.slice(app.indexOf("async function deliverHeld("), app.indexOf("function requeueHeld("));
    assert.match(deliver, /if \(r\.out\) \{\s+transcript\.addSteer\(live\.turn, \{ id: r\.out\?\.message\?\.id \|\| r\.held\.id/, "the bubble takes the mailbox's id, which the run's events name");
    assert.match(deliver, /noteOverruled\(chat, r\.held\.overrules \|\| \[\], r\.held\.text\);\s+teamSent\(r\.held\.teams \|\| \[\], "steered"\);\s+if \(r\.out\?\.use\?\.length\) live\.turn\.useNoted = true;\s+\} else refused\.push\(r\.held\);/, "a team's result is sent once the run takes it");
    assert.match(deliver, /else refused\.push\(r\.held\);[\s\S]*requeueHeld\(chat, live, refused\);/);
    assert.match(deliver, /if \(live\.runKind === "coding-agent" && !agentTakesWords\(live\.steer\)\) return requeueHeld\(chat, live, live\.held\.release\(\), agentQueuesWords\(live\.own\)\);/, "a coding agent that takes none mid-turn: all wait for its end");
    const requeue = app.slice(app.indexOf("function requeueHeld("), app.indexOf("async function stopCurrent("));
    // The row each was sent by goes with it, which no run heard (the owner's of 11-09).
    assert.match(requeue, /const queued = list\.map\(\(m\) => \(m\.teams\?\.length\s+\? \{ text: m\.typed \?\? "", files: m\.teams, \.\.\.\(m\.overrules\?\.length \? \{ overrules: m\.overrules \} : \{\}\), \.\.\.queuedVia\(m\) \}\s+: m\.overrules\?\.length \|\| m\.via \? \{ text: m\.text, files: \[\], \.\.\.\(m\.overrules\?\.length \? \{ overrules: m\.overrules \} : \{\}\), \.\.\.queuedVia\(m\) \} : m\.text\)\);\s+queueNext\(chat, queued, said \|\| /, "one that carries a team's result is queued with the result beside the person's words again");
    assert.match(requeue, /function queueNext\(chat, texts, said\) \{\s+if \(chatOf\(state\.currentId\) !== chat\) return queueAdd\(queueOf\(chat\), texts\);\s+composer\.enqueue\(texts\);/, "another chat shown: its own queue keeps them");
  });
  // (fails before: yes — HarnessV3-Views V3's drive: a page reloaded mid-turn said "The turn is starting" all the turn
  // long while Enter steered its run; a message sent before its run was known threw, the page's turn having no place
  // to hold it; and a turn reloaded while it composed was never followed)
  test("a page following its turn after a reload learns the run as a send's own turn does: held until the stream names it, steered after", () => {
    const join = app.slice(app.indexOf("function followLiveTurn("), app.indexOf("/** The header's Reload session"));
    assert.match(join, /const live = \{ turn, aborter, reply: null, runId: null, [^}]*held: createHeldSteers\(\{ post: steerPost \}\) \};/, "no run until the stream names it, and a place to hold");
    assert.match(join, /transcript\.startLive\(live\);\s+if \(chatOf\(state\.currentId\) === chat\) composer\.setLive\(true, null\);/, "the composer is the shown chat's");
    const onRun = join.slice(join.indexOf("const onRun = (run) => {"), join.indexOf("/** @param {any} e */"));
    assert.match(onRun, /if \(live\.runId \|\| chat\.live !== live\) return;\s+live\.runId = runId;\s+turn\.runId = runId;\s+runKnown\(chat, live, run\);\s+deliverHeld\(chat, live\);/);
    assert.match(join, /followRun\(runId, \{ since, words: true, onRun, onEvent, onWords,/);
    assert.match(join, /chat\.live = null;[\s\S]*requeueHeld\(chat, live, live\.held\.release\(\)\);\s+if \(chatOf\(state\.currentId\) === chat\) composer\.setLive\(false,/, "queued before the queue drains");
    assert.match(join, /if \(liveInfo\.requestId\) followTheRun\(liveInfo\.requestId\);/, "only the live request is followed");
    assert.match(join, /if \(!st\.live\) return settle\(\);\s+if \(!live\.follower && st\.live\.requestId\) followTheRun\(String\(st\.live\.requestId\)\);/, "a turn reloaded while it composed is followed once its request is named");
  });
  // (fails before: yes — HarnessV4_Tasks U4, the At-Home drive's find and fable51's F4: a turn followed from another
  // window whose run the server did not hold (not registered yet, or swept) kept "The turn is starting" for the whole
  // turn; its follow had ended on a 404 without a word, and no later poll followed it again)
  test("a followed turn with no run to follow: the page asks again, and the composer says what a message does meanwhile — it waits for the turn's end", () => {
    const join = app.slice(app.indexOf("function followLiveTurn("), app.indexOf("/** The header's Reload session"));
    const missing = join.slice(join.indexOf("const onMissing = () => {"), join.indexOf("/** @param {any} e */"));
    assert.match(missing, /if \(chat\.live !== live \|\| live\.runId\) return;\s+live\.watch\?\.stop\(\);\s+live\.watch = null;\s+live\.follower = null;\s+live\.unfollowed = true;\s+if \(chatOf\(state\.currentId\) === chat\) composer\.setLive\(true, liveRun\(live\)\);/, "let go, so the poll follows again once the transcript names its request");
    assert.match(join, /followRun\(runId, \{ since, words: true, onRun, onEvent, onWords, onGap, onMissing, onRunEnd, onDone: \(\) => \{\} \}\)/);
    assert.match(join, /const onRunEnd = \(\) => \{\n\s+if \(chat\.live === live\) live\.whole = true;\n\s+settle\(\);\n\s+\};/, "the run's end settles the turn");
    assert.match(join, /if \(!live\.follower && st\.live\.requestId\) followTheRun\(String\(st\.live\.requestId\)\);/, "the poll that follows again");
    assert.match(join, /const followTheRun = \(runId\) => \{\s+turn\.requestId = runId;\s+live\.watch\?\.stop\(\);/, "one watchdog at a time, however often it is followed again");
    // Once the run is named after all, the face is the run's.
    const known = app.slice(app.indexOf("function runKnown("), app.indexOf("/**", app.indexOf("function runKnown(")));
    assert.match(known, /live\.unfollowed = false;/);
    assert.match(app, /const liveRun = \(live\) => \(live\?\.runKind \? \{ kind: live\.runKind, [^}]*\} : live\?\.unfollowed \? \{ kind: "", unfollowed: true \} : null\);/);
    // What is typed waits in the queue, as the words say.
    assert.match(send, /if \(chat\.live\?\.unfollowed && !chat\.live\.runId && !chat\.live\.turn\.paused\) return "queue";/);
    assert.match(composer, /unfollowed = on && !runKnown && run\?\.unfollowed === true;/);
    assert.match(composer, /: unfollowed \? "A turn is running — what you send now goes out when it ends"\s+: agentTurn \? "The agent is starting — what you send now is held until it's up"\s+: "The turn is starting — what you send now reaches its run as soon as it starts"/);
    // The hint names the ⌄ menu's row the send key does (the owner's of 11-09).
    assert.match(composer, /\? holds \|\| agentQueues \|\| unfollowed \? `\$\{key\} sends when it's done\$\{veto\} · the Stop button stops`/, "the hint");
    assert.match(composer, /queue\.steers\(!agentQueues && !unfollowed, on\);/);
  });
  // (fails before: yes — the send's own turn painted the face from its run's start whatever chat was shown, and a chat
  // switched back to lost it: "The turn is starting" over a run Enter steered)
  test("the composer's face follows the run for the chat it shows: on each path a run becomes known, and on the switch back", () => {
    const known = app.slice(app.indexOf("function runKnown("), app.indexOf("/**", app.indexOf("function runKnown(")));
    assert.match(known, /live\.runKind = run\.kind;\s+live\.steer = run\.meta\?\.steer \|\| null;\s+live\.pictures = run\.meta\?\.steerImages === true;\s+live\.interrupts = run\.meta\?\.interrupts === true;\s+live\.agent = run\.meta\?\.agent \? String\(run\.meta\.agent\) : null;\s+live\.own = run\.meta\?\.own\?\.agent \|\| null;\s+live\.unfollowed = false;\s+if \(chat\.live === live && chatOf\(state\.currentId\) === chat\) composer\.setLive\(true, liveRun\(live\)\);/);
    assert.match(send, /if \(e\?\.type === "run-start" && e\.kind\) runKnown\(chat, live, e\);/, "the reply's own events");
    assert.match(send, /runKnown\(chat, live, runInfo\.run\);\s+deliverHeld\(chat, live\);/, "the lookup");
    assert.ok(!/composer\.setLive\(true, (e\.kind|e\b|runInfo|run\b)/.test(app), "no path paints the face around the rule");
    assert.match(app, /composer\.setLive\(!!chat\.live, liveRun\(chat\.live\)\);/, "the switch");
  });
  test("the composer queues a message nothing can steer, and drains what it is handed only once the turn is over", () => {
    assert.match(composer, /else if \(ok === "queue"\) \{\s+queue\.push\(asQueued\(text, files, overrules, via\)\);\s+paintQueue\(\);\s+\}/);
    const enqueue =composer.slice(composer.indexOf("enqueue(texts) {"), composer.indexOf("setStopping(on) {"));
    assert.match(enqueue, /if \(!live && !queue\.paused\(\)\) drain\(\);/);
    assert.match(composer, /: agentQueues \? "A coding agent is working — what you send now goes out when it ends"\s+(?:\/\/[^\n]*\n\s+)?: waitsForEnd\(\) \? "A turn is running — what you send now goes out when it ends"\s+(?:\/\/[^\n]*\n\s+)*: steerable \? \(lead \? `Tell \$\{theLead\(\)\} — it reads your words at its next step` : "A turn is running — what you send now is read at its next step"\)\s+: agentTurn && runKnown \? `The \$\{lead \? "lead" : "agent"\} is working — what you send now is read at its next step`\s+: unfollowed \? "A turn is running — what you send now goes out when it ends"\s+: agentTurn \? "The agent is starting — what you send now is held until it's up"\s+: "The turn is starting — what you send now reaches its run as soon as it starts"/);
  });
  test("the holder's phase reaches the page's own live turn, and its fold says it", () => {
    assert.match(app, /if \(chat\.live && \(msg\.holder\?\.window === "harness" \|\| !msg\.holder\)\) transcript\.phase\(chat\.live\.turn, msg\.holder\?\.phase \|\| null\);/);
    assert.match(timeline, /phase\(turn, phase\) \{\s+turn\.phase = phase \|\| null;\s+if \(!owned\(turn\)\) return;\s+const fold = view\.get\(turn\)\?\.fold;\s+fold\?\.setState\?\.\(turnPhaseWords\(turn\.phase\)\);/);
    assert.match(turnJs, /setState\(turnPhaseWords\(turn\.phase\) \|\| \(turn\.aligned \? liveWords\(turn\.aligned, turn\.engine\?\.kind === "team"\) : ""\)\);/, "a fold drawn again (a chat switched back) says it too");
  });
});
