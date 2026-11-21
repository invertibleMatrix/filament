// @ts-check
// A send whose connection breaks (the worktree plan's Phase 3 item 1): the turn runs on at the server (HarnessV2 D1),
// so the page follows it again as a reload does, instead of drawing a failure while the turn keeps working. A turn that
// ended while the connection was down is drawn from the transcript; one the server never took stays the error it is.
// A send its own running turn refuses (item 2): the page had lost that turn, and follows it again; the message goes
// back to the box.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runningOn, endedOn, keptPageTurns } from "../src/ui/harness/conversation/history.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

// (fails before: yes — the review of 3f163c5b2: the server kept nothing of the page's send, so a send whose reply's head
// never came was known by its number and its words alone — another tab's turn of the same words taken for it)
test("the turn a page's send begins keeps the send's own name, and a Retry going on in its row adds its own", async () => {
  let calls = 0;
  const up = await fakeUpstream(async () => (++calls === 1 ? { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "not now" } } } : anthropicReply("Hello.", { model: "brain-model" })));
  /** @param {any} cfg */
  const configure = (cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.memory.autopilot = { enabled: false };
    cfg.memory.capture = { turns: true, learn: false };
  };
  const shim = await startApp({ memory: true, configure });
  try {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: process.cwd(), model: "brain-model", preset: "plain" } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    /** @param {string} sendId */
    const send = (sendId) => shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "say hello", stream: false, sendId } });
    const sends = async () => ((await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript?work=0`)).json()).turns || []).map((/** @type {any} */ t) => [t.n, t.sends || []]);
    assert.notEqual((await send("page-send-0001")).status, 200, "the first try fails");
    assert.deepEqual(await sends(), [[1, ["page-send-0001"]]]);
    assert.equal((await send("page-send-0002")).status, 200, "its Retry");
    assert.deepEqual(await sends(), [[1, ["page-send-0001", "page-send-0002"]]], "the Retry goes on in the failed try's row, its own name added");
    assert.equal((await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "again", stream: false, sendId: "no good!" } })).status, 200);
    assert.deepEqual((await sends()).at(-1), [2, []], "a name not of letters, digits, - and _ is kept by no turn");
    // (fails before: yes — the review of fa29cc5b7: a command Filament answered itself recorded its turn with no send)
    assert.equal((await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "/cost", stream: false, sendId: "page-send-0003" } })).status, 200);
    assert.deepEqual((await sends()).at(-1), [3, ["page-send-0003"]], "a command's turn keeps its send too");
  } finally {
    await shim.stop();
    await up.close();
  }
});

test("runningOn: the session's running turn when it is this send's — this window's, the newest on the page, the same request", () => {
  const turn = { n: 3, requestId: "r3" };
  const page = [{ n: 1, past: true }, { n: 2, past: true }, turn];
  const live = { window: "harness", client: "harness", requestId: "r3", startedAt: 5 };
  assert.equal(runningOn({ live }, page, turn), live);
  const notCaught = { ...live, requestId: null };
  assert.equal(runningOn({ live: notCaught }, page, turn), notCaught, "the server had not caught the id yet: the session's own turn");
  // (fails before: yes — the review of 3f163c5b2: a send whose reply's head never came took any running turn of the
  // window for its own, another tab's among them)
  const headless = { n: 3, requestId: null, sendId: "s3" };
  const rows = (/** @type {string[]} */ sends) => [{ n: 3, open: true, requestIds: ["r3"], sends }];
  assert.equal(runningOn({ live, turns: rows(["s3"]) }, [...page.slice(0, 2), headless], headless), live, "the reply's head never came: the running turn holds its send");
  assert.equal(runningOn({ live, turns: rows(["s-other"]) }, [...page.slice(0, 2), headless], headless), null, "another tab's running turn");
  assert.equal(runningOn({ live, turns: [] }, [...page.slice(0, 2), headless], headless), null, "no row of it yet: nothing is claimed");
  assert.equal(runningOn({ live: { ...live, requestId: "r9" } }, page, turn), null, "another send's turn");
  assert.equal(runningOn({ live: { ...live, window: "opencode" } }, page, turn), null, "another window's turn: the waiting queue's");
  assert.equal(runningOn({ live: null }, page, turn), null, "no turn runs: it ended, or never started");
  assert.equal(runningOn(null, page, turn), null, "the session could not be read");
  assert.equal(runningOn({ live }, [...page, { n: 4 }], turn), null, "not the newest turn on the page");
});

test("a dropped send whose turn ended meanwhile gives way to the server's copy; one the server never took stays", () => {
  const dropped = { n: 3, status: "error", fromTranscript: true };
  assert.deepEqual(keptPageTurns([{ n: 2, past: true }, dropped], [{ n: 2 }, { n: 3 }]), [], "turn 3 is drawn from the transcript");
  assert.deepEqual(keptPageTurns([{ n: 2, past: true }, dropped], [{ n: 2 }]), [dropped], "the server has no turn 3: the error stays");
});

// (fails before: yes — HarnessV4_Tasks U4, the worktree plan's known limit: a turn that finished while the connection
// was down still ended the send as an error, so the queue paused as "failed" until Continue though nothing had failed)
test("endedOn: what the transcript says a dropped send's turn was, once none runs — finished, failed, or never taken", () => {
  const turn = { n: 3, requestId: "r3" };
  const page = [{ n: 1, past: true }, { n: 2, past: true }, turn];
  const done = { n: 3, requestIds: ["r3"], open: false };
  assert.equal(endedOn({ live: null, turns: [done] }, page, turn), "done");
  assert.equal(endedOn({ live: null, turns: [{ ...done, requestIds: ["r2b", "r3"] }] }, page, turn), "done", "any of the turn's requests");
  assert.equal(endedOn({ live: null, turns: [{ n: 3, requestIds: ["r3"], open: true, facts: { error: "upstream said no" } }] }, page, turn), "error", "it failed at the server: a failure it is");
  assert.equal(endedOn({ live: null, turns: [{ n: 3, requestIds: ["r3"], open: true }] }, page, turn), null, "open with no word of how: nothing is claimed");
  assert.equal(endedOn({ live: null, turns: [{ n: 2, requestIds: ["r2"], open: false }] }, page, turn), null, "the server never took this send: its newest turn is the one before");
  assert.equal(endedOn({ live: null, turns: [{ n: 3, requestIds: ["r9"], open: false }] }, page, turn), null, "another request's turn under the same number");
  // (fails before: yes — the review of 3f163c5b2: a send whose reply's head never came was the newest turn of its
  // number — another tab's that took the number, never this one, ended the send "done" and the queue went on)
  const headless = { n: 3, requestId: null, sendId: "s3" };
  assert.equal(endedOn({ live: null, turns: [{ ...done, sends: ["s3"] }] }, [...page.slice(0, 2), headless], headless), "done", "the reply's head never came: the turn that holds its send");
  assert.equal(endedOn({ live: null, turns: [{ ...done, requestIds: ["r9"], sends: ["s9"] }] }, [...page.slice(0, 2), headless], headless), null, "another tab's turn of its number");
  assert.equal(endedOn({ live: null, turns: [{ ...done, n: 4, requestIds: ["r4"], sends: ["s3"] }] }, [...page.slice(0, 2), headless], headless), "done", "its own, at the number another tab's pushed it to");
  assert.equal(endedOn({ live: { window: "harness", requestId: "r3" }, turns: [done] }, page, turn), null, "a turn still runs: `runningOn` answers that");
  assert.equal(endedOn(null, page, turn), null, "the session could not be read");
  assert.equal(endedOn({ live: null, turns: [] }, page, turn), null);
  assert.equal(endedOn({ live: null, turns: [done] }, [...page, { n: 4 }], turn), null, "not the newest turn on the page");
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const send = app.slice(app.indexOf("async function sendMessage("), app.indexOf("async function stopCurrent("));
  assert.match(send, /if \(live\.dropped\) \{\s*turn\.fromTranscript = true;\s*chat\.hydrateAfterSend = true;\s*(\/\/[^\n]*\n\s*)+if \(endedOn\(head, chat\.turns, turn\) === "done"\) \{\s+turn\.status = "done";\s+turn\.error = null;\s+\}\s*\}\s*runDraw\.now\(\);/, "a turn that finished is no failure: the queue goes on");
});

// (fails before: yes — the review of 3f163c5b2: a send carried nothing of its own, so a read knew one whose reply's head
// never came by its number and words alone)
test("each send carries its own name to the turn's post, one the server keeps", async () => {
  const { newSendId } = await import("../src/ui/harness/lib/api.js");
  const a = newSendId();
  assert.match(a, /^[A-Za-z0-9_-]{8,64}$/, "a name the server keeps (sessions/service.js SEND_ID)");
  assert.notEqual(newSendId(), a);
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const send = app.slice(app.indexOf("async function sendMessage("), app.indexOf("async function stopCurrent("));
  assert.match(send, /const turn = \{[^]*?\n\s+sendId: newSendId\(\),/, "each send's turn is named");
  assert.match(send, /const r = await postTurn\(\{\s+chainId: String\(chat\.chainId\),\s+content,\s+sendId: turn\.sendId,/, "and the post carries it");
  const api = readFileSync("src/ui/harness/lib/api.js", "utf8");
  assert.match(api, /runEvents: true,\s+\.\.\.\(sendId \? \{ sendId \} : \{\}\),/, "in the body");
});

test("the send: a broken connection asks the session before it ends the turn, and follows a turn that runs on", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const send = app.slice(app.indexOf("async function sendMessage("), app.indexOf("async function stopCurrent("));
  assert.match(send, /turn\.status = "error";\s+turn\.error = String\(e\?\.message \|\| e\);\s+\/\/[^\n]*\n\s+live\.dropped = !!chat\.chainId;/, "only a broken connection is asked about: a stop and a given-up reply are not");
  assert.match(send, /\n\s*(\/\/[^\n]*\n\s*)+const head = live\.dropped \? await api\(`\/sessions\/\$\{encodeURIComponent\(String\(chat\.chainId\)\)\}\/transcript\?work=0&limit=1`\)\.catch\(\(\) => null\) : null;\s+const runsOn = head \? runningOn\(head, chat\.turns, turn\) : null;/, "the session is asked once");
  assert.ok(send.indexOf("} finally {\n    letGo();\n  }") < send.indexOf("const runsOn = "), "asked once the reply is let go");
  const letLiveGo = send.slice(send.indexOf("const letLiveGo = (said) => {"), send.indexOf("let ownTurn = null;"));
  assert.match(letLiveGo, /runDraw\.now\(\);\s+transcript\.flushBlocks\(live\);\s+live\.watch\.stop\(\);\s+live\.follower\?\.stop\(\);/, "what landed is drawn first, the reply's last words too; the old watch and follow end: one follow at a time");
  assert.match(letLiveGo, /requeueHeld\(chat, live, live\.held\.release\(\), said\);\s+chat\.live = null;/, "a message held for the run goes out as the next one");
  const on = send.slice(send.indexOf("if (runsOn) {"), send.indexOf("if (live.dropped) {"));
  assert.match(on, /^if \(runsOn\) \{\s+letLiveGo\("[^"]+"\);\s+Object\.assign\(turn, \{ past: true, status: "streaming", error: null, blocks: \[\], segments: \[\], liveLost: false \}\);\s+if \(chatOf\(state\.currentId\) === chat\) drawChat\(chat\);/, "the turn is the server's now, drawn afresh where it shows");
  assert.match(on, /followLiveTurn\(chat, runsOn, true\);\s+return;/, "followed as a reload follows it: its end draws the transcript's copy and tells the queue — this page's own send, its chat's queue going on where it is not shown");
  assert.match(send, /if \(live\.dropped\) \{\s*turn\.fromTranscript = true;\s*chat\.hydrateAfterSend = true;/, "no turn of this send's left running: the transcript decides what it was");
  const follow = app.slice(app.indexOf("function followLiveTurn("), app.indexOf("function followLiveTurn(") + 400);
  assert.match(follow, /const turn = newestOnRecord\(chat\.turns\);\s+if \(!turn \|\| !turn\.past\) return;/, "it follows the newest turn, a server's one: why the send marks it past");
});

// (fails before: yes — the refusal named no holder, and the page drew a hard 409 error card under its own running turn)
test("a send its own running turn refuses: the page follows that turn again, and the message goes back to the box", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const send = app.slice(app.indexOf("async function sendMessage("), app.indexOf("async function stopCurrent("));
  // (a thread's brief sent again waits on no row, which would send it as the person's: `!brief`)
  assert.match(send, /if \(holder\?\.window === "harness" && !holder\.own\) ownTurn = holder;\s+else if \(holder && !brief\) \{\s+applySessionView\(chat, \{ holder \}\);\s+turn\.status = "waiting";/, "another window's turn, or an agent's own, keeps the waiting queue");
  const own = send.slice(send.indexOf("if (ownTurn) {"), send.indexOf("const runsOn = "));
  assert.match(own, /^if \(ownTurn\) \{\s+letLiveGo\("[^"]+"\);\s+chat\.turns = \[\.\.\.chat\.turns\.filter\(\(t\) => t !== turn\), \.\.\.\(gaveWay \? \[gaveWay\] : \[\]\)\];\s+(\/\/[^\n]*\n\s+)*if \(chatOf\(state\.currentId\) === chat\) drawChat\(chat\);/, "the row the send drew goes: no row guesses the running turn's number");
  assert.match(own, /applySessionView\(chat, \{ holder: ownTurn \}\);/, "the view holds the turn's holder: the follow lasts while it runs");
  assert.match(own, /if \(chatOf\(state\.currentId\) === chat\) composer\.setLive\(false, null\);/, "no ending: the queue does not drain into the running turn");
  assert.match(own, /followElsewhere\(chat\);\s+refusal = "A turn was already running in this chat";\s+return false;\s+\}/, "followed again; false gives the message back to the box");
  const composer = readFileSync("src/ui/harness/composer/composer.js", "utf8");
  assert.match(composer, /if \(ok === false\) backInBox\(text, files, overrules\);/, "a refused send's words and files return to the box, with what it overruled");
  const elsewhere = app.slice(app.indexOf("async function followElsewhere("), app.indexOf("async function followElsewhere(") + 700);
  assert.match(elsewhere, /await hydrate\(chat\);\s+if \(chat\.live \|\| chat\.view\?\.holder\?\.window !== "harness"\) return;/, "it reads the transcript until the turn shows, and the hydrate follows it");
});
