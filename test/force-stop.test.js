// @ts-check
// Force stop (HarnessV3-FixRound F2 item 13, BUG-09; Q2 (a)): a Stop cuts the model call, a command, a foreground
// sub-agent and the `delegate_read` reader's call (F4 item 21c), but some waits never hear it — here a pre-tool hook
// that sleeps, which takes only the client's hang-up. After a few seconds the composer offers Force stop
// (`POST /api/runs/:id/steer { kind: "stop", force: true }`): the turn ends now, the call it was waiting on is answered
// as cut, and the record, the run and the transcript say it was force-stopped.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp, fakeUpstream, anthropicReply, parseSse } from "./helpers/app.js";
import { until, removeDirs } from "./helpers/wait.js";
import { archivedStubs } from "../src/ui/harness/conversation/tools/render.js";
import { stopReached, runToForce, forceOutcome } from "../src/ui/harness/lib/stops.js";
import { createEventBus } from "../src/services/events.js";
import { createRunLog } from "../src/services/runs.js";

const HOOK = `node "${fileURLToPath(new URL("./fixtures/hook.mjs", import.meta.url))}"`;
const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** Settle within `ms` or fail saying what did not happen. @param {Promise<any>} p @param {number} ms @param {string} what */
const within = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} did not happen within ${ms} ms`)), ms).unref())]);

describe("the run log's Force stop", () => {
  test("a stop first, then the force signal; for an agent turn's run, a sub-agent's and a coding agent's, and only while it runs", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-forcesig-"));
    const runs = createRunLog({ events: createEventBus(), dataDir: dir, config: () => ({ observability: { runEvents: { persist: false } } }), ops: { record: () => {} } });
    try {
      runs.startRun({ id: "a1", kind: "agent-turn" });
      const box = runs.mailbox("a1");
      assert.equal(box.forceSignal.aborted, false);
      assert.deepEqual(runs.force("a1", { from: "harness" }), { ok: true, queued: true }, "no stop was queued: Force stop queues one");
      assert.equal(box.stopSignal.aborted, true, "it cuts what a Stop cuts");
      assert.equal(box.forceSignal.aborted, true);
      assert.deepEqual(box.read().map((m) => [m.kind, m.from]), [["stop", "harness"]], "the turn still ends in a stop's words");
      runs.startRun({ id: "s1", kind: "subagent" });
      assert.deepEqual(runs.force("s1"), { ok: true, queued: true });
      assert.equal(runs.mailbox("s1").forceSignal.aborted, true);
      runs.startRun({ id: "c1", kind: "coding-agent" });
      assert.deepEqual(runs.force("c1"), { ok: true, queued: true }, "a coding agent's turn too (HarnessV3-ACP AC1-1)");
      runs.startRun({ id: "x1", kind: "chat" });
      assert.match(String(/** @type {any} */ (runs.force("x1")).error), /agent's turn or a sub-agent's run; this one is chat/);
      runs.endRun("a1", { status: "stopped" });
      assert.match(String(/** @type {any} */ (runs.force("a1")).error), /has ended/);
    } finally {
      runs.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the composer offers Force stop (source contract: the page boots a DOM at import)", () => {
  test("five seconds after a Stop that left the agent turn running; it sends the stop with force", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /const FORCE_OFFER_MS = 5000;/);
    assert.match(app, /offerForceLater\(chat, live\);\s*\n\s*return; \/\/ the loop cuts/, "armed by the Stop that reached the run");
    assert.match(app, /body: \{ kind: "stop", force: true, from: "harness" \}/);
    const composer = readFileSync("src/ui/harness/composer/composer.js", "utf8");
    assert.match(composer, /else offerForce\(false\);/, "the turn's end takes the offer back");
  });

  // (fails before: yes — a stop sent through the session armed no offer, and Force stop needed the run id this page
  // holds: after a reload, or for a turn another window sent, there was no way to force)
  test("after a stop sent through the session too; with no run id in hand the force goes through the session", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /offerForceForRun\(chat, runToForce\(out\)\);/, "armed by the session's stop, for the run it steered");
    assert.match(app, /if \(out\?\.stopped === "steered"\) return offerForceLater\(chat, live\);/, "and by the stop of a turn whose run is not named yet");
    assert.match(app, /if \(!run \|\| run\.endedAt != null \|\| chatOf\(state\.currentId\) !== chat \|\| !composer\.live\(\)\.streaming\) return;/, "offered only while that run still runs");
    assert.match(app, /\/stop`, \{ method: "POST", body: \{ force: true \} \}\)/, "the session's stop, with force");
  });
});

describe("what the session's stop said, read for the page", () => {
  // (fails before: no — a guard: the page reads the answers the session's stop gives — a harness turn it reached, or
  // none, which another window's turn, a chat's move and no turn at all all are)
  test("a stop that reached a turn; the run it left to force", () => {
    const steeredOwn = { ok: true, holder: { window: "harness", requestId: "r1" }, stopped: "steered" };
    const steeredFound = { ok: true, holder: { window: "harness", requestId: null }, stopped: "steered", runs: ["r2", "r3"] };
    const cancelled = { ok: true, holder: { window: "harness", requestId: null }, stopped: "cancelled" };
    const none = { ok: true, holder: null, stopped: null };
    assert.deepEqual([steeredOwn, steeredFound, cancelled, none].map(stopReached), [true, true, true, false]);
    assert.equal(runToForce(steeredOwn), "r1", "the harness turn's own run");
    assert.equal(runToForce(steeredFound), "r2", "the first run the session found, the turn's request id not out yet");
    assert.equal(runToForce(cancelled), null, "a turn cancelled before its run began has none");
    assert.equal(runToForce(none), null);
    assert.equal(runToForce({ ok: true, holder: { window: "harness", requestId: null }, stopped: "steered" }), null, "no id, no run");
    // (fails before: yes — a harness turn whose request id was not out yet named its steered run only in `runs`)
    assert.equal(runToForce({ ok: true, holder: { window: "harness", requestId: null }, stopped: "steered", runs: ["r4"] }), "r4", "the run the session found");
  });
  // (fails before: no — a guard: as above, for the stop with force)
  test("what a forced stop through the session did", () => {
    assert.equal(forceOutcome({ ok: true, holder: { window: "harness", requestId: "r1" }, stopped: "forced" }), "forced");
    assert.equal(forceOutcome({ ok: true, holder: { window: "harness", requestId: null }, stopped: "forced", runs: ["r2"] }), "forced");
    assert.equal(forceOutcome({ ok: true, holder: { window: "harness" }, stopped: "cancelled" }), "stopped", "no run to force: the stop it was");
    assert.equal(forceOutcome({ ok: true, holder: null, stopped: null }), "nothing");
  });
});

describe("Stop and compact on the page (source contract)", () => {
  // (fails before: yes — there was no such action: Compact pressed while a coding agent's turn ran only said to
  // compact once the turn ends)
  test("one action: the server is asked to compact once the turn ends, then the turn is stopped", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /if \(!composer\.live\(\)\.streaming\) return void compactSession\(chat\);/, "with no turn running it is Compact");
    assert.match(app, /compactNow\(chat, \{ onceTurnEnds: true \}\)\.finally\(\(\) => \{ chat\.compactAfter = false; \}\);\s*\n\s*stopCurrent\(\);/, "asked first, so the wait stands while the stop lands");
    assert.match(app, /\.\.\.\(onceTurnEnds \? \{ onceTurnEnds: true \} : \{\}\)/, "the compact route's own field");
    assert.match(app, /stopAndCompact: \(\) => stopAndCompact\(\),/, "the widgets may ask for it too");
    const composer = readFileSync("src/ui/harness/composer/composer.js", "utf8");
    // The Context popover's, whenever a turn runs (the owner's of 11-09): the ⌄ menu is about the message typed.
    assert.ok(!composer.includes("Stop and compact\","), "no row of the ⌄ menu");
    const context = readFileSync("src/ui/harness/widgets/context.js", "utf8");
    assert.match(context, /title: "Stop the turn, then compact this session once it has ended",\s+onclick: \(\) => \{ close\(\); ctx\.stopAndCompact\(\); \},/);
    assert.match(composer, /compacts \? "Stopping… — the session is compacted once the turn has ended"/, "the stop's hint says what comes after");
  });
});

describe("Force stop", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** The reader's call never answers until the suite lets it go. */
  let letGo = () => {};
  const held = new Promise((res) => { letGo = () => res(undefined); });
  let lastRun = "";
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-force-"));
    writeFileSync(join(root, "a.txt"), "alpha\n");
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (call.body?.model === "brain-reader") {
        await held;
        return anthropicReply("late", { model: "brain-reader" });
      }
      const said = JSON.stringify(call.body?.messages?.at(-1) ?? "");
      if (/ask the reader/.test(said)) return reply([{ type: "text", text: "Asking." }, toolUse("d1", "delegate_read", { paths: ["a.txt"], question: "what is in it?" }), toolUse("r2", "read", { path: "a.txt" })], "tool_use");
      return reply([{ type: "text", text: "Reading." }, toolUse("r1", "read", { path: "a.txt" }), toolUse("r2", "read", { path: "a.txt" })], "tool_use");
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "brain-reader" };
      },
    });
  });
  after(async () => {
    letGo();
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });
  const eventsOf = async (/** @type {string} */ runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || [];
  /** @param {string} runId @param {any} body */
  const steer = (runId, body) => shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body });

  // (fails before: yes — there was no Force stop; the turn waited out the call, up to the turn's deadline)
  // (fails before: yes — the bug hunt of 10-30: the reply's two reads ran their pre-tool hooks one after the other, so
  // the second hook started only once the first read had run)
  test("a turn a Stop cannot reach ends within a second of Force stop, and the record and the transcript say so", async () => {
    // The wait a Stop cannot reach: a pre-tool hook that sleeps (it hears only the client's hang-up). Each hook keeps a
    // line as it starts.
    const started = join(root, "hooks-started.jsonl");
    const hooks = [{ on: "pre-tool", tool: "read", command: `${HOOK} record "${started}" sleep 5000`, timeoutMs: 20000 }];
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { hooks } } });
    assert.equal(s.status, 200, await s.clone().text());
    const sid = String((await s.json()).id);
    const res = await shim.api(`/api/sessions/${encodeURIComponent(sid)}/turns`, { method: "POST", body: { content: "read a.txt for me", stream: true } });
    assert.equal(res.status, 200);
    const runId = String(res.headers.get("x-filament-request-id") || "");
    assert.ok(runId, "the head names the run");
    lastRun = runId;
    const body = res.text();
    // The two reads run side by side (loop.js `onlyReads`, the owner's word of 10-27), their hooks too: both hooks start
    // before either read has run.
    const hooksStarted = () => readFileSync(started, "utf8").split("\n").filter(Boolean).length;
    await until(() => existsSync(started) && hooksStarted() === 2, "both reads' hooks to start");
    assert.equal((await eventsOf(runId)).some((e) => e.type === "tool-end"), false, "neither read ran before both hooks started");

    // The composer's Stop: queued, but the hook does not hear it.
    const stop = await steer(runId, { kind: "stop", text: "", from: "harness" });
    assert.equal(stop.status, 200);
    await new Promise((r) => setTimeout(r, 600));
    assert.equal((await eventsOf(runId)).some((e) => e.type === "run-end"), false, "the Stop alone leaves the turn waiting");

    const forced = await steer(runId, { kind: "stop", force: true, from: "harness" });
    assert.equal(forced.status, 200, await forced.clone().text());
    assert.deepEqual(await forced.json(), { ok: true, forced: true, queued: false }, "the Stop's message was already queued");
    const raw = await within(body, 3000, "the turn's end after Force stop");
    const text = parseSse(raw).map((f) => f.data).filter((d) => d?.delta?.type === "text_delta").map((d) => d.delta.text).join("");
    assert.match(text, /\(Filament: the developer force-stopped this turn after \d+ tool calls?; what was finished is above\.\)/);

    const ev = await eventsOf(runId);
    const force = ev.find((e) => e.type === "force-stop" && e.from === "harness");
    assert.ok(force, "the run says it was forced");
    const end = ev.find((e) => e.type === "run-end");
    assert.equal(end?.status, "stopped");
    assert.equal(end?.summary?.forced, true);
    // Within a second of Force stop by Filament's own clock: from the run hearing it to the run's end, whatever the
    // machine does to this test's requests and their answers meanwhile.
    assert.ok(end.ts - force.ts < 1000, `the turn ended ${end.ts - force.ts} ms after Force stop`);
    // A call is drawn as it runs, once its hooks have let it through: the call drawn is the one that runs (the bug hunt
    // of 10-30, PERM-5). Both reads were cut in their hooks, so both are answered Not run — neither ran.
    const ends = ev.filter((e) => e.type === "tool-end");
    assert.deepEqual(ends.map((e) => [e.id, e.stopped, !!e.notRun]).sort(), [["r1", true, true], ["r2", true, true]]);

    const rec = await shim.record(runId);
    assert.equal(rec.agent?.status, "stopped");
    assert.equal(rec.agent?.forced, true, "the record says force-stopped");
    assert.match(JSON.stringify(rec.changes || []), /force-stopped the turn while it was acting/);

    await until(async () => {
      const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(sid)}/transcript`)).json();
      return tr.turns?.at(-1)?.stopped?.forced === true;
    }, "the transcript's force-stopped mark");
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(sid)}/transcript`)).json();
    const turn = tr.turns.at(-1);
    assert.equal(turn.stopped.by, "harness");
    // After a reload both calls read as they did live: Not run, never Failed.
    assert.deepEqual(archivedStubs(turn.tools).map((x) => [x.state, !!x.notRun]), [["stopped", true], ["stopped", true]]);
  });

  // F4 item 21c (decision 13): the reader behind delegate_read took only the client's hang-up, so a Stop waited for it
  // and Force stop was the way out. Its call takes the round's cut now.
  // (fails before: the Stop left the turn waiting on the reader, which never answers)
  test("a Stop ends a turn waiting on a reader that never answers, within a second", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    const sid = String((await s.json()).id);
    const res = await shim.api(`/api/sessions/${encodeURIComponent(sid)}/turns`, { method: "POST", body: { content: "ask the reader about a.txt", stream: true } });
    assert.equal(res.status, 200);
    const runId = String(res.headers.get("x-filament-request-id") || "");
    const body = res.text();
    await until(async () => (await eventsOf(runId)).some((e) => e.type === "tool-start" && e.name === "delegate_read"), "the reader call to start");
    const t0 = Date.now();
    const stop = await steer(runId, { kind: "stop", text: "", from: "harness" });
    assert.equal(stop.status, 200);
    await within(body, 3000, "the turn's end after a Stop");
    assert.ok(Date.now() - t0 < 1000, `the turn ended ${Date.now() - t0} ms after the Stop`);
    const ev = await eventsOf(runId);
    const end = ev.find((e) => e.type === "run-end");
    assert.equal(end?.status, "stopped");
    assert.notEqual(end?.summary?.forced, true, "a plain Stop, not a forced one");
    const d1 = ev.find((e) => e.type === "tool-end" && e.id === "d1");
    assert.equal(d1?.stopped, true, "the reader's call reads Stopped");
  });

  test("Force stop is refused for a run that has ended, and for no run at all", async () => {
    assert.ok(lastRun, "the turn above ran");
    const ended = await steer(lastRun, { kind: "stop", force: true, from: "harness" });
    assert.equal(ended.status, 409);
    assert.match((await ended.json()).error, /has ended/);
    const none = await steer("no-such-run", { kind: "stop", force: true, from: "harness" });
    assert.equal(none.status, 409);
  });
});
