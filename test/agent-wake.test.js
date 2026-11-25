// @ts-check
// A chat's agent comes back to it later by itself (the owner's word of 10-27: "it comes back later in the same chat",
// as Claude Code's scheduled wakeup does): come_back sets the time, a minute to a day out, with a note; one per chat, a
// new one replacing it, cancel dropping it. When the time comes the note is told as a shell's exit is — at the agent's
// next step while a turn of it runs, else in a turn Filament starts by itself, in its own words. Offered to a harness
// chat's own agent alone; a fork is refused in words; the person's Stop drops it. While it waits the page shows it — the
// status capsule, its popover with Cancel, the floating panel, Now — and the person's Cancel is told to the agent with
// its next turn, never waking the chat (the Designer's of 10-27).
import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attendShells, cancelComeBack, comeBackLater, comeBackOf, comeBacksNow, disposeBackgroundShells, onComeBackChange, onShellWake, peekShellExits, takeShellExits, tellLater, wakeDue, wakeKindOf } from "../src/adapters/tools/hands.js";
import { COME_BACK, COME_BACK_OFF, NO_COME_BACK, calendarDays, cancelByPerson, comeBackCall } from "../src/app/agent/come-back.js";
import { FORK_REFUSALS, isLoopTool, loopToolArgs } from "../src/app/agent/tools.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { TIME_WAKE_LINE, isWakeMessage, wakeLineFor } from "../src/app/sessions/wake.js";
import { WOKE_WORDS, messageTimeLabel, wokeWords } from "../src/ui/harness/lib/labels.js";
import { transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { deliveredWords, wokeLine, wokeRow } from "../src/ui/harness/conversation/turn.js";
import { disabledTools } from "../src/app/agent/turn.js";
import { KNOBS } from "../src/services/session-settings.js";
import { cardOf } from "../src/core/tool-vocab.js";
import { capsuleWords, createStatusCapsule, createStatusPanel } from "../src/ui/harness/conversation/status-panel.js";
import { cancelTitle, cancelledWords, comeBackIn, comeBackInShort, comeBackRow } from "../src/ui/harness/lib/come-back.js";
import { nowRows } from "../src/ui/harness/lib/now.js";
import { TOOL_GROUPS } from "../src/ui/harness/conversation/start-board.js";
import { familyPatch, toolFamilies } from "../src/ui/harness/widgets/overview-setup.js";
import { prefs } from "../src/ui/harness/prefs.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

after(() => disposeBackgroundShells());

describe("come_back: set, replaced, dropped, and told when its time comes", () => {
  before(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 }));
  after(() => mock.timers.reset());

  // (fails before: yes — no tool came back to a chat later; a model could only sleep or poll)
  test("its time told to the chat's own agent, the chat woken where no turn runs, in Filament's words for a time", () => {
    const session = "s-wake-1";
    /** @type {string[]} */
    const woke = [];
    const stop = onShellWake((s) => woke.push(s));
    try {
      const r = comeBackCall({ seconds: 600, note: "Check the deploy's status page." }, { session });
      assert.equal(r.ok, true);
      assert.match(/** @type {any} */ (r).text, /^Set: Filament comes back to this chat in 10 min \(at \d\d:\d\d\), with your note\. End your turn now unless other work is left\.$/);
      assert.equal(comeBackOf(session)?.note, "Check the deploy's status page.");
      mock.timers.tick(599_000);
      assert.deepEqual(peekShellExits({ session, agent: null }), [], "not before its time");
      mock.timers.tick(1_000);
      const told = peekShellExits({ session, agent: null });
      assert.equal(told.length, 1);
      assert.equal(told[0].kind, "wake");
      assert.equal(told[0].text, "[Filament: the time you set has come — 10 min ago you asked to come back to this chat. Your note: Check the deploy's status page.]");
      assert.equal(wakeKindOf(session), "wake");
      assert.equal(wakeLineFor(wakeKindOf(session)), TIME_WAKE_LINE);
      assert.equal(wokeWords([told[0].text]), "Filament went on by itself — the time the agent set came");
      assert.deepEqual(woke, [session], "no turn ran: the chat is woken");
      assert.equal(comeBackOf(session), null, "it is spent");
      takeShellExits({ session, agent: null });
    } finally {
      stop();
    }
  });

  // (fails before: yes)
  test("one per chat: a new one replaces it, cancel drops it; outside 60 to 86400 it is held to them, said", () => {
    const session = "s-wake-2";
    comeBackCall({ seconds: 120, note: "first" }, { session });
    const again = comeBackCall({ seconds: 300, note: "second" }, { session });
    assert.match(/** @type {any} */ (again).text, /It replaces the one set for \d\d:\d\d \(first\)\./);
    mock.timers.tick(200_000);
    assert.deepEqual(peekShellExits({ session, agent: null }), [], "the first is gone");
    mock.timers.tick(100_000);
    assert.match(String(peekShellExits({ session, agent: null })[0]?.text), /Your note: second\]$/);
    takeShellExits({ session, agent: null });

    comeBackCall({ seconds: 90, note: "never" }, { session });
    assert.match(/** @type {any} */ (comeBackCall({ cancel: true }, { session })).text, /^Dropped the come-back set for \d\d:\d\d \(never\): nothing comes back to this chat now\.$/);
    mock.timers.tick(200_000);
    assert.deepEqual(peekShellExits({ session, agent: null }), []);
    assert.equal(/** @type {any} */ (comeBackCall({ cancel: true }, { session })).text, "No come-back was set in this chat, so there was nothing to drop.");

    assert.match(/** @type {any} */ (comeBackCall({ seconds: 5, note: "soon" }, { session })).text, /in 1 min \(at \d\d:\d\d(?: tomorrow)?\) — 5 s is outside 60 to 86400, with your note/);
    // (fails before: yes — x50: an hour at most, where a wait for an account's limit to reset is longer)
    assert.match(/** @type {any} */ (comeBackCall({ seconds: 7200, note: "after the reset" }, { session })).text, /^Set: Filament comes back to this chat in 2 h \(at \d\d:\d\d(?: tomorrow)?\), with your note\./);
    // A day out lands on tomorrow's date but in the first hour of a day the clock moves back, which keeps it today.
    const day = calendarDays(Date.now() + 86_400_000, Date.now());
    assert.match(/** @type {any} */ (comeBackCall({ seconds: 99999, note: "late" }, { session })).text, new RegExp(`in 24 h \\(at \\d\\d:\\d\\d${day === 1 ? " tomorrow" : day > 1 ? " the day after tomorrow" : ""}\\) — 99999 s is outside 60 to 86400`));
    cancelComeBack(session);
  });

  // (fails before: yes)
  test("refused in words: no chat to come back to, no note, no time", () => {
    assert.deepEqual(comeBackCall({ seconds: 60, note: "x" }, null), { ok: false, error: COME_BACK_OFF });
    assert.match(/** @type {any} */ (comeBackCall({ seconds: 60 }, { session: "s-wake-3" })).error, /^Not set: note is required/);
    assert.match(/** @type {any} */ (comeBackCall({ note: "x" }, { session: "s-wake-3" })).error, /^Not set: seconds is required/);
    assert.equal(comeBackOf("s-wake-3"), null);
  });

  // (fails before: yes)
  test("while a turn of the agent runs, its time is told at the next step: nobody is woken", () => {
    const session = "s-wake-4";
    /** @type {string[]} */
    const woke = [];
    const stop = onShellWake((s) => woke.push(s));
    const leave = attendShells({ session, agent: null });
    try {
      comeBackLater(session, { seconds: 60, note: "look again" });
      mock.timers.tick(60_000);
      assert.equal(peekShellExits({ session, agent: null })[0]?.kind, "wake");
      assert.deepEqual(woke, []);
      takeShellExits({ session, agent: null });
    } finally {
      leave();
      stop();
    }
  });
});

describe("where come_back is offered", () => {
  // (fails before: yes)
  test("a harness chat's own agent alone, last of its set; never a lead's; a fork is refused in words", () => {
    const on = loopToolArgs({ comeBack: true });
    assert.equal(on.at(-1).name, COME_BACK);
    assert.ok(!loopToolArgs({}).some((t) => t.name === COME_BACK), "a set without it is the bytes it always was");
    assert.deepEqual(on.slice(0, -1), loopToolArgs({}));
    assert.ok(!loopToolArgs({ lead: true, comeBack: true }).some((t) => t.name === COME_BACK));
    assert.ok(!loopToolArgs({ comeBack: true, disabled: [COME_BACK] }).some((t) => t.name === COME_BACK), "the chat's switch takes it off");
    assert.ok(isLoopTool(COME_BACK));
    assert.match(FORK_REFUSALS[COME_BACK], /^Not run: coming back to this chat later is the main agent's to set/);
    // What drops it and what keeps it, as its words end: a goal's halt for its time drops it too (core/goal-drive.js).
    assert.match(on.at(-1).description, / The person's Stop drops it, as does a goal halted for its time; a restart of Filament keeps it, and one whose time came meanwhile comes once Filament is back\.$/);
  });

  // (fails before: yes)
  test("the loop sets it where the run names the chat, and refuses it in words where it names none", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wake-loop-"));
    try {
      /** @param {{ session: string } | null} comeBack */
      const run = async (comeBack) => {
        /** @type {any[]} */
        const bodies = [];
        const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
        await runAgentTurn(/** @type {any} */ ({
          model: "m", messages: [{ role: "user", content: "go" }], system: "s", tools: loopToolArgs({ comeBack: true }), modeNow: () => "edit",
          root: dir, readerModel: "", maxTokens: 100, costOf: () => 0, delegateRead: null, mailbox: { read: () => [] }, permissions: null, tree: null,
          previewChars: 0, sink: { text() {}, thinking() {}, signThinking() {}, endBlock() {}, count: () => 0 }, signal: null, resume: null, onEvent: () => {},
          runHand: async () => "ok",
          comeBack,
          call: async (/** @type {any} */ { body }) => {
            bodies.push(structuredClone(body));
            return bodies.length === 1 ? reply([{ type: "tool_use", id: "w1", name: COME_BACK, input: { seconds: 900, note: "see whether CI passed" } }]) : reply([{ type: "text", text: "Done." }]);
          },
        }));
        return JSON.stringify(bodies[1].messages.at(-1));
      };
      assert.match(await run({ session: "s-wake-5" }), /Set: Filament comes back to this chat in 15 min/);
      assert.equal(comeBackOf("s-wake-5")?.note, "see whether CI passed");
      cancelComeBack("s-wake-5");
      assert.ok((await run(null)).includes(COME_BACK_OFF));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("through a real Filament", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  const said = (/** @type {any} */ body) => JSON.stringify(body?.messages || []);
  /** @param {string} id */
  const transcript = async (id) => /** @type {any} */ (await (await shim.api(`/api/sessions/${id}/transcript`)).json());
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-wake-"));
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
      const all = said(call.body);
      if (all.includes(TIME_WAKE_LINE.slice(0, 50))) return anthropicReply("The deploy is live.", { model: "m-1" });
      if (all.includes('"tool_use_id":"w1"')) return anthropicReply("I'll look again in 10 minutes.", { model: "m-1" });
      return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: "w1", name: COME_BACK, input: { seconds: 600, note: "Check the deploy's status page." } }] });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // (fails before: yes — the agent had no way back into its chat but the person's next message)
  test("the agent sets it in its chat; when its time comes the chat goes on by itself with the note; the person's Stop drops it", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    const id = String((await made.json()).id);
    const turn = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "deploy is running; check it later", stream: false } });
    assert.equal(turn.status, 200, await turn.clone().text());
    assert.equal(comeBackOf(id)?.note, "Check the deploy's status page.", "set on this chat, as the waker knows it");
    // Its time, now: the test does not wait ten minutes (the timer itself is the first describe's).
    const set = cancelComeBack(id);
    tellLater({ session: id, agent: null }, { id: "wake_t", command: "", code: null, kind: "wake", text: `[Filament: the time you set has come — 10 min ago you asked to come back to this chat. Your note: ${set?.note}]` });
    const tr = await until(async () => {
      const t = await transcript(id);
      return (t.turns || []).length >= 2 && t.turns[1].final ? t : null;
    }, "the chat's second turn", { timeoutMs: 20_000 });
    assert.equal(tr.turns[1].woke, true);
    assert.ok(isWakeMessage(tr.turns[1].user), "its message is Filament's line");
    assert.ok(JSON.stringify(tr.turns[1].user).includes(TIME_WAKE_LINE), "in its words for a time");
    const page = transcriptTurns(tr);
    assert.match(String(page[1].wakeExits?.[0]), /Your note: Check the deploy's status page\.\]$/);
    assert.ok(up.received.some((/** @type {any} */ c) => said(c.body).includes("Your note: Check the deploy")), "the model read the note");

    comeBackLater(id, { seconds: 600, note: "again" });
    const stop = await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200, await stop.clone().text());
    assert.equal(comeBackOf(id), null, "the person's Stop dropped it");
  });

  // (fails before: yes — a watch's lines that rode with the person's message were stamped and said as a shell's exit)
  test("a watch's lines that ride with the person's message are stamped as lines, and said so", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    const id = String((await made.json()).id);
    const first = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "start", stream: false } });
    assert.equal(first.status, 200, await first.clone().text());
    cancelComeBack(id);
    tellLater({ session: id, agent: null }, { id: "bg_t:watch", command: "npm run dev", code: null, kind: "lines", text: "[Filament: background shell bg_t (npm run dev) printed a line you watch for (/ready/):\nready on :3000]" }, { now: false });
    const next = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "and now?", stream: false } });
    assert.equal(next.status, 200, await next.clone().text());
    assert.equal(next.headers.get("x-filament-shell-watch"), "1", "the page that sent it says so at once");
    const tr = await transcript(id);
    assert.equal(tr.turns[1].shellExits, 1);
    assert.equal(tr.turns[1].shellWatch, 1);
    assert.equal(deliveredWords(transcriptTurns(tr)[1]), "with the lines a watch caught");
    cancelComeBack(id);
  });

  // (fails before: yes — nothing said a come-back while it waited: no word on the feed as the agent set it, none in the
  // holders read or the transcript, and no route cancelled one — POST /come-back/cancel was a 404)
  test("the come-back while it waits: the feed says it as it is set and cancelled, the holders read and the transcript carry it; the person's Cancel tells the agent with its next turn, starts none, and is refused in words when none is set", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    const id = String((await made.json()).id);
    /** @type {any[]} */
    const heard = [];
    const off = /** @type {any} */ (shim.app).events.subscribe("turns", (/** @type {any} */ m) => { if (m?.type === "come-back" && m.chainId === id) heard.push(m.comeBack); });
    try {
      const turn = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "deploy is running; check it later", stream: false } });
      assert.equal(turn.status, 200, await turn.clone().text());
      const set = comeBackOf(id);
      assert.equal(set?.note, "Check the deploy's status page.", "the agent set it in its turn");
      assert.deepEqual(heard, [set], "the feed said it as it was set");
      const holders = /** @type {any} */ (await (await shim.api("/api/sessions/holders")).json());
      assert.deepEqual(holders.comeBacks.filter((/** @type {any} */ x) => x.chainId === id), [{ chainId: id, comeBack: set }]);
      assert.deepEqual((await transcript(id)).comeBack, set);

      const cancel = await shim.api(`/api/sessions/${id}/come-back/cancel`, { method: "POST", body: {} });
      assert.equal(cancel.status, 200, await cancel.clone().text());
      assert.deepEqual(await cancel.json(), { ok: true, comeBack: set }, "the answer names what was cancelled");
      assert.equal(comeBackOf(id), null);
      assert.equal(heard.at(-1), null, "the feed said it went");
      assert.equal((await transcript(id)).comeBack, null);
      const after = /** @type {any} */ (await (await shim.api("/api/sessions/holders")).json());
      assert.deepEqual(after.comeBacks.filter((/** @type {any} */ x) => x.chainId === id), []);
      const again = await shim.api(`/api/sessions/${id}/come-back/cancel`, { method: "POST", body: {} });
      assert.equal(again.status, 409);
      assert.equal((await again.json()).error, NO_COME_BACK);
      await new Promise((r) => setTimeout(r, 800));
      assert.equal((await transcript(id)).turns.length, 1, "the Cancel started no turn of its own");

      const next = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "and now?", stream: false } });
      assert.equal(next.status, 200, await next.clone().text());
      assert.equal(next.headers.get("x-filament-shell-cancel"), "1", "the page that sent it says so at once");
      assert.ok(up.received.some((/** @type {any} */ c) => said(c.body).includes("[Filament: the person cancelled the come-back you set for ")), "the agent read it with its next turn");
      const tr = await transcript(id);
      assert.deepEqual([tr.turns[1].shellExits, tr.turns[1].shellCancel], [1, 1]);
      assert.equal(deliveredWords(transcriptTurns(tr)[1]), "with word of the come-back you cancelled", "no command's end");
    } finally {
      off();
      cancelComeBack(id);
    }
  });
});

describe("the come-back's switch and the person's Stop (the Hunter's finds of 10-27)", () => {
  before(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: 5_000_000 }));
  after(() => mock.timers.reset());

  // (fails before: yes — come_back was no name of the chat's tool switches: loop.tools.come_back false left it on)
  test("loop.tools.come_back false takes it off, as every loop tool's switch does", () => {
    assert.ok(disabledTools({ come_back: false }).includes(COME_BACK));
    assert.ok(!disabledTools({ come_back: true }).includes(COME_BACK));
    assert.ok(/** @type {any} */ (KNOBS["loop.tools"]).options.includes(COME_BACK));
  });

  // (fails before: yes — a come-back whose time had come waited untold through the person's Stop)
  test("the person's Stop drops a come-back whose time came and that waits untold, and leaves a shell's end", () => {
    const session = "s-wake-untold";
    const stop = onShellWake(() => {});
    try {
      comeBackLater(session, { seconds: 60, note: "look again" });
      mock.timers.tick(60_000);
      tellLater({ session, agent: null }, { id: "bg_e", command: "npm test", code: 0, text: "[Filament: background shell bg_e (npm test) exited with code 0.]" }, { now: false });
      assert.deepEqual(peekShellExits({ session, agent: null }).map((x) => x.kind), ["wake", "exit"]);
      cancelComeBack(session);
      assert.deepEqual(peekShellExits({ session, agent: null }).map((x) => x.kind), ["exit"], "the note went; the end stays");
      takeShellExits({ session, agent: null });
    } finally {
      stop();
    }
  });
});

describe("the come-back seen and cancelled: the server (the Designer's of 10-27)", () => {
  before(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: 9_000_000 }));
  after(() => mock.timers.reset());

  // (fails before: yes — nothing heard a come-back change, and nothing listed them: the page could not show one)
  test("its change is heard at each set, replace, drop and time that comes; the list holds every chat's while it waits", () => {
    /** @type {string[]} */
    const heard = [];
    const off = onComeBackChange((s) => heard.push(s));
    const stop = onShellWake(() => {});
    try {
      comeBackLater("s-see-1", { seconds: 120, note: "first" });
      comeBackLater("s-see-2", { seconds: 600, note: "another chat's" });
      assert.deepEqual(heard, ["s-see-1", "s-see-2"]);
      assert.deepEqual(comeBacksNow().get("s-see-1"), { at: Date.now() + 120_000, note: "first" });
      comeBackLater("s-see-1", { seconds: 300, note: "second" });
      assert.deepEqual([heard.length, heard.at(-1), comeBacksNow().get("s-see-1")?.note], [3, "s-see-1", "second"], "replaced");
      mock.timers.tick(300_000);
      assert.deepEqual([heard.length, heard.at(-1), comeBacksNow().has("s-see-1"), comeBackOf("s-see-1")], [4, "s-see-1", false, null], "its time came");
      assert.deepEqual(peekShellExits({ session: "s-see-1", agent: null }).map((x) => x.kind), ["wake"]);
      cancelComeBack("s-see-2");
      assert.deepEqual([heard.length, heard.at(-1), comeBacksNow().has("s-see-2")], [5, "s-see-2", false], "dropped, as a Stop or a Cancel drops it");
      cancelComeBack("s-see-2");
      assert.equal(heard.length, 5, "nothing to drop: nothing changed");
      takeShellExits({ session: "s-see-1", agent: null });
    } finally {
      off();
      stop();
    }
  });

  // (fails before: yes — the person could not cancel a come-back but by stopping the chat, and nothing told the agent;
  // a word kept for its next turn woke the chat as a turn let go of it, and was said beside an end as "mixed")
  test("the person's Cancel: dropped, its agent told with its next turn in Filament's words, the chat never woken; a later Stop keeps the word; none set is refused in words", () => {
    const session = "s-see-3";
    /** @type {string[]} */
    const woke = [];
    const stop = onShellWake((s) => woke.push(s));
    try {
      const set = comeBackLater(session, { seconds: 1080, note: "Check the deploy's status page." });
      assert.deepEqual(cancelByPerson(session), { ok: true, comeBack: { at: set.at, note: "Check the deploy's status page." } });
      assert.equal(comeBackOf(session), null);
      const told = peekShellExits({ session, agent: null });
      assert.deepEqual(told.map((x) => x.kind), ["cancel"], "no time that came: a later cancel never drops it");
      assert.match(told[0].text, /^\[Filament: the person cancelled the come-back you set for \d\d:\d\d \(Check the deploy's status page\.\): nothing comes back to this chat now\.\]$/);
      assert.equal(wakeDue(session), false, "nothing to wake the chat for");
      // A turn that ran as it was told, and let go of it untold: its next turn hears it, and none is started for it.
      attendShells({ session, agent: null })();
      assert.deepEqual(woke, [], "never woken");
      cancelComeBack(session);
      assert.deepEqual(peekShellExits({ session, agent: null }).map((x) => x.kind), ["cancel"], "the person's Stop after it keeps the word");
      tellLater({ session, agent: null }, { id: "bg_see", command: "npm test", code: 0, text: "[Filament: background shell bg_see (npm test) exited with code 0.]" }, { now: false });
      assert.equal(wakeKindOf(session), "exit", "beside an end, the turn that wakes the chat says what came");
      assert.deepEqual(cancelByPerson(session), { ok: false, error: NO_COME_BACK });
      takeShellExits({ session, agent: null });
    } finally {
      stop();
    }
  });
});

describe("the come-back seen and cancelled: the page (the Designer's of 10-27)", () => {
  /** A come-back at 14:32 local time, 18 minutes from now. */
  // Today at 14:32, read from the clock: the page says another day's time with its day ("Yesterday 14:32").
  const AT = new Date(new Date().setHours(14, 32, 0, 0)).getTime();
  const NOW = AT - 18 * 60_000;
  const back = { at: AT, note: "Check the deploy's status page." };
  /** The page's clock for it, as a reply's time reads. */
  const CLOCK = messageTimeLabel(AT);
  const S = { turn: { phase: "ended", startedAt: null, round: 0, error: "" }, compacting: null, working: 0, asking: 0, tasks: 0, now: NOW };

  // (fails before: yes — the capsule hid while only a come-back waited, and no other state said one)
  test("the capsule: a come-back alone is its own grey state, Comes back | 14:32; beside any other state it keeps that capsule and its title says when", () => {
    assert.match(CLOCK, /^\d\d:\d\d$/);
    assert.deepEqual(capsuleWords({ ...S, comeBack: back }), { state: "later", lead: "Comes back", more: CLOCK, title: `The turn is over; Filament goes on here by itself at ${CLOCK}, with the agent's note` });
    assert.deepEqual(capsuleWords({ ...S, commands: 1, comeBack: back }), { state: "working", lead: "Working", more: "1 command", title: `The turn is over; 1 command still at work · comes back at ${CLOCK}` });
    assert.equal(capsuleWords({ ...S, turn: { phase: "running", startedAt: NOW - 45_000, round: 3, error: "" }, comeBack: back }).title, `The agent works on your message · step 3 · 45s so far · comes back at ${CLOCK}`);
    assert.deepEqual(capsuleWords({ ...S, turn: { phase: "failed", startedAt: null, round: 0, error: "529 overloaded" }, comeBack: back }), { state: "stopped", lead: "Stopped", more: "529 overloaded", title: `529 overloaded · comes back at ${CLOCK}` });
    assert.equal(capsuleWords({ ...S, asking: 1, comeBack: back }).title, `1 question for you · comes back at ${CLOCK}`);
    assert.deepEqual(capsuleWords({ ...S, comeBack: null }), { state: "idle", lead: "", more: "", title: "" });
  });

  // (fails before: yes — no words said a come-back)
  test("its words: the row's note cut at 80 and whole on hover, how long until it, Cancel's title, the toast", () => {
    const long = { at: AT, note: `Check the deploy's status page,\nthen ${"x".repeat(100)}` };
    const row = comeBackRow(long, NOW + 20_000);
    assert.deepEqual([row.note.length, row.note.endsWith("…"), row.note.includes("\n"), row.title, row.at, row.left], [80, true, false, long.note, `at ${CLOCK}`, "in 18 min"]);
    assert.deepEqual([comeBackIn(back, AT - 3_600_000), comeBackIn(back, AT - 59_000), comeBackIn(back, AT)], ["in 1 h", "in 1 min", "any moment now"]);
    assert.deepEqual([comeBackInShort(back, NOW), comeBackInShort(back, AT - 3_600_000), comeBackInShort(back, AT + 1)], ["in 18m", "in 1h", "now"]);
    assert.equal(cancelTitle(back), `Cancel it: Filament won't go on in this chat at ${CLOCK}. The agent is told with its next turn.`);
    assert.equal(cancelledWords(back), `Cancelled — nothing comes back to this chat at ${CLOCK}`);
  });

  // (fails before: yes — a chat whose turn had ended stood in Done, or nowhere once read, while its agent's come-back
  // waited)
  test("Now: a chat whose come-back waits stays under Working — the timer's tile, its end first where unread, when it comes back, how long until it in the age's slot; beside a command, the command's row says it too", () => {
    const run = (/** @type {string} */ chain) => ({ id: `r-${chain}`, kind: "agent-turn", status: "done", startedAt: NOW - 600_000, endedAt: NOW - 60_000, meta: { chain, model: "m-1" } });
    const cmd = { id: "bg_1", command: "npm test", cwd: "C:\\work\\app", startedAt: NOW - 125_000, agent: null, line: "", logPath: null };
    const g = nowRows({
      runs: [run("w1"), run("w2"), run("w3"), run("w4")], folds: new Map(), threads: new Map(), unread: new Set(["w1", "w3"]), holders: new Map(), now: NOW,
      commands: new Map([["w3", [cmd]]]), comeBacks: new Map([["w1", back], ["w2", back], ["w3", back]]),
      chats: (c) => ({ title: `chat ${c}`, project: "p", when: NOW - 60_000, unread: c === "w1" || c === "w3" }),
    });
    const row = (/** @type {string} */ chain) => g.works.find((r) => r.chain === chain);
    assert.deepEqual([row("w1")?.fact, row("w1")?.icon, row("w1")?.due], [`finished · comes back at ${CLOCK}`, "timer", back]);
    assert.equal(g.done.find((r) => r.chain === "w1"), undefined, "not in Done as well");
    assert.deepEqual([row("w2")?.fact, row("w2")?.icon], [`comes back at ${CLOCK}`, "timer"], "an end already read is not said again");
    assert.deepEqual([row("w3")?.fact, row("w3")?.icon, row("w3")?.due], [`finished · 1 command running: npm test · comes back at ${CLOCK}`, "terminal", undefined]);
    assert.equal(row("w4"), undefined, "no come-back, nothing at work: no Working row");
    assert.equal(comeBackInShort(/** @type {any} */ (row("w1")?.due), NOW), "in 18m", "the age's slot");
  });

  // (fails before: yes — the call drew as its bare name, come_back, its note in its raw arguments)
  test("the transcript's card: Come back later · in 15 min: its note's first line; its cancel, Cancel coming back", () => {
    assert.deepEqual(cardOf("come_back", { seconds: 900, note: "Check the deploy's status page.\nThen the logs." }), { kind: "come-back", title: "Come back later", subject: "in 15 min: Check the deploy's status page." });
    assert.deepEqual(cardOf("come_back", { cancel: true }), { kind: "come-back", title: "Cancel coming back", subject: "" });
    assert.equal(cardOf("come_back", { note: "look" }).subject, "look");
  });

  // (fails before: yes — the woke capsule's line said the agent's own words, "The time you set has come — 10 min ago…")
  test("the woke capsule's line says the agent's note, cut at 80 and whole on hover; word of a Cancel riding along is not what came", () => {
    const told = "[Filament: the time you set has come — 10 min ago you asked to come back to this chat. Your note: Check the deploy's status page.]";
    assert.deepEqual(wokeLine(told), { tone: "ok", words: "The agent's note: Check the deploy's status page.", title: "Check the deploy's status page." });
    const long = wokeLine(`[Filament: the time you set has come — 1 min ago you asked to come back to this chat. Your note: ${"y".repeat(120)}]`);
    assert.deepEqual([long.words.length, long.words.endsWith("…"), long.title.length], ["The agent's note: ".length + 80, true, 120]);
    assert.deepEqual(wokeLine("[Filament: background shell bg_1 (npm test) exited with code 1 — all of its output was read.]"), { tone: "warn", words: "Background shell bg_1 (npm test) exited with code 1 — all of its output was read.", title: "" });
    const cancelled = "[Filament: the person cancelled the come-back you set for 14:32 (Check the deploy): nothing comes back to this chat now.]";
    assert.equal(wokeWords([cancelled, "[Filament: background shell bg_t (npm run dev) printed a line you watch for (/ready/):\nready on :3000]"]), "Filament went on by itself — a command it watches printed what it watches for");
    assert.equal(wokeWords([cancelled, "[Filament: background shell bg_1 (npm test) exited with code 0.]"]), WOKE_WORDS);
  });

  // (fails before: yes — come_back had no switch of its own on the Overview: its chips were the loop's other families)
  test("the Overview's What it may do: a Come back later chip, on unless switched off, and its press writes loop.tools.come_back", () => {
    const web = { fetch: true, search: true };
    assert.deepEqual(toolFamilies(null, web).at(-1), { label: "Come back later", on: true }, "on by default");
    assert.deepEqual(toolFamilies({ come_back: false }, web).at(-1), { label: "Come back later", on: false });
    const family = /** @type {any} */ (TOOL_GROUPS.find((g) => g.label === "Come back later"));
    assert.deepEqual(familyPatch(family, false, { bash: false }), { patch: { loop: { tools: { bash: false, come_back: false } } } });
    assert.ok(disabledTools(familyPatch(family, false, null).patch.loop.tools).includes(COME_BACK), "the turn reads it off");
  });

  describe("drawn", () => {
    /** @type {ReturnType<typeof stubDocument>} */
    let doc;
    /** The page's preferences, kept as the browser keeps them. @type {Map<string, string>} */
    const kept = new Map();
    before(() => {
      doc = stubDocument();
      /** @type {any} */ (globalThis).localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) };
    });
    after(() => {
      doc.restore();
      delete (/** @type {any} */ (globalThis).localStorage);
    });

    // (fails before: yes — the /parallel drive of 11-03: a turn Filament began for its side tasks' reports said "a
    // background command ended")
    test("a turn Filament began for sub-agents' reports says they came; with a command's end too, what the agent waited on", () => {
      const reports = ["[Filament: sub-agent sa_1 reported: route is done.]", "[Filament: sub-agent sa_2 reported: card is done.]"];
      const tr = { turns: [{ n: 2, turnId: 9, requestIds: ["r9"], woke: true, deliveries: 2, user: { role: "user", content: [...reports, "[Filament: went on by itself.]"].map((text) => ({ type: "text", text })) }, work: [], final: { role: "assistant", content: [{ type: "text", text: "Noted." }] } }] };
      const label = (/** @type {any} */ turn) => wokeRow(turn).querySelector(".boundary-label").textContent;
      assert.equal(label(transcriptTurns(tr)[0]), "Filament went on by itself — 2 reports from sub-agents came");
      assert.equal(wokeWords([], 1), "Filament went on by itself — a sub-agent's report came");
      const ended = "[Filament: background shell bg_1 (npm test) exited with code 0.]";
      assert.equal(wokeWords([ended], 1), "Filament went on by itself — what the agent waited on came");
      assert.equal(wokeWords([ended]), WOKE_WORDS, "a command's end alone, as it was");
      assert.equal(wokeWords([]), "Filament went on by itself — what the agent waited on came", "nothing known of what came: no command's end said");
    });

    // (fails before: yes — the capsule hid and the popover had no Comes back part: the person could neither see the
    // come-back nor cancel it)
    test("the capsule says it, grey; its popover's Comes back part: the note cut and whole on hover, Cancel at one press, how long until it", async () => {
      /** @type {string[]} */
      const did = [];
      const c = createStatusCapsule({ onOpenPlan: () => {}, onGoal: () => {}, onCancelComeBack: () => did.push("cancel") });
      const el = /** @type {any} */ (c.el);
      const soon = { at: Date.now() + 18 * 60_000 + 20_000, note: `Check the deploy's status page, then ${"x".repeat(100)}` };
      const clock = messageTimeLabel(soon.at);
      c.set({ turn: { phase: "ended", startedAt: null, round: 0, error: "" }, comeBack: soon });
      assert.deepEqual([el.classList.contains("hidden"), el.classList.contains("is-later"), el.getAttribute("aria-label")], [false, true, `Comes back, ${clock}`]);
      assert.equal(el.getAttribute("title"), `The turn is over; Filament goes on here by itself at ${clock}, with the agent's note`);
      el.dispatch("click");
      try {
        const sec = await until(() => doc.document.body.querySelector(".sp-comeback"), "its Comes back part");
        assert.equal(sec.querySelector(".sp-count").textContent, `at ${clock}`);
        const note = sec.querySelector(".sp-comeback-note");
        assert.deepEqual([note.textContent.length, note.textContent.endsWith("…"), note.getAttribute("title")], [80, true, soon.note]);
        assert.equal(sec.querySelector(".sp-comeback-in").textContent, "in 18 min");
        const cancel = sec.querySelector("button");
        assert.deepEqual([cancel.textContent, cancel.getAttribute("title")], ["Cancel", `Cancel it: Filament won't go on in this chat at ${clock}. The agent is told with its next turn.`]);
        cancel.dispatch("click");
        assert.deepEqual(did, ["cancel"], "one press, no question");
      } finally {
        el.dispatch("click");
      }
      c.set({ turn: { phase: "ended", startedAt: null, round: 0, error: "" }, comeBack: null });
      assert.equal(el.classList.contains("hidden"), true, "none left: the capsule hides");
    });

    // (fails before: yes — the floating panel stayed hidden while only a come-back waited)
    test("the floating panel: its bit says back 14:32, and its card has the same Comes back part", () => {
      prefs.set("statusPanel", "expanded");
      try {
        const p = createStatusPanel({ onOpenPlan: () => {}, onGoal: () => {}, onCancelComeBack: () => {} });
        const el = /** @type {any} */ (p.el);
        p.set({ comeBack: back });
        assert.equal(el.classList.contains("hidden"), false);
        assert.equal(el.querySelector(".sp-capsule").textContent, `back ${CLOCK}`);
        assert.equal(el.querySelector(".sp-comeback .sp-count").textContent, `at ${CLOCK}`);
        p.set({});
        assert.equal(el.classList.contains("hidden"), true, "none left: hidden again");
      } finally {
        prefs.set("statusPanel", "composer");
      }
    });
  });
});
