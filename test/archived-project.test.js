// @ts-check
// An archived project runs nothing by itself (r-itself, 11-12; the owner left it to the lead: "an archived project
// runs nothing by itself"). Its chats take no turn Filament starts — the one rule of an archived chat
// (sessions/service.js `notByItself`) reads the project's flag too —, its Space's routines skip their times and its
// watchers hear nothing, with nothing switched off; brought back, each goes again, and nothing it missed is made up. A
// turn the person sends themselves, and their own Run now, work as in any project. Through a real Filament where a
// turn is asked for, over the runner and the store where a clock is.
// (fails before: yes — the rule read the chat's own mark alone, and the project's flag was the tree's display flag:
// in an archived project a command's end, an idle check-in, a goal's round, a come-back and a restart's resume each
// started a turn, its routines ran at their times and its watchers woke, with no row saying so)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { ANY_WAKE_LINE, IDLE_WAKE_LINE, TIME_WAKE_LINE, WAKE_LINE } from "../src/app/sessions/wake.js";
import { RESUME_LINE } from "../src/app/sessions/resume-cut.js";
import { ARCHIVED_CHAT, ARCHIVED_PROJECT } from "../src/app/sessions/service.js";
import { keepComeBack, tellLater } from "../src/adapters/tools/hands.js";
import { newGoal } from "../src/services/memory/goal.js";
import { WAKE_HEAD } from "../src/core/watchers.js";
import { routineFields, rowWords } from "../src/core/routines.js";
import { textOfMessage } from "../src/core/messages.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createDashboardRunner } from "../src/services/dashboard-runner.js";
import { createArtifactsHandler } from "../src/http/artifacts.js";
import { spaceRoutes } from "../src/http/admin/spaces.js";
import { memoryRoutes } from "../src/http/admin/memory.js";
import { createRouter } from "../src/http/router.js";
import { artifactCall } from "../src/app/agent/artifacts.js";
import { spaceRun } from "../src/app/agent/space.js";
import { createRoutines } from "../src/app/routines.js";
import { openTurnWords } from "../src/ui/harness/lib/labels.js";
import { glanceWords } from "../src/ui/harness/lib/your-space.js";
import { seenWords } from "../src/ui/harness/lib/beside.js";

const MINUTE_MS = 400;
/** A command that runs until the test lets it end, by the file `gate` in the chat's folder. @param {string} gate */
const exitsOn = (gate) => `node -e "const fs=require('fs');setInterval(()=>fs.existsSync('${gate}')&&process.exit(0),50)"`;
const sleepMs = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const lastSaid = (/** @type {any} */ body) => JSON.stringify((body?.messages || []).at(-1)?.content ?? "");
/** What a row says where its project is archived. */
const ROW_ARCHIVED = "its project is archived: nothing in it runs by itself until you bring it back";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));

describe("its chats take no turn Filament starts (a real Filament)", () => {
  /** @type {any} */ let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */ let shim;
  /** @type {string} */ let base;
  /** The wakes a watcher sent, by what each carried. @type {string[]} */
  const watched = [];
  /** @param {string} id */
  const transcript = async (id) => /** @type {any} */ (await (await shim.api(`/api/sessions/${id}/transcript`)).json());
  /** @param {string} id @param {number} n */
  const turnsDone = (id, n) =>
    until(async () => {
      const t = await transcript(id);
      return (t.turns || []).length >= n && t.turns.slice(0, n).every((/** @type {any} */ x) => x.final) ? t : null;
    }, `the chat's turn ${n}`, { timeoutMs: 20_000 });
  /** A chat in a folder of its own under the base — a project of its own —, with that project. @param {string} name */
  const chatIn = async (name) => {
    const cwd = join(base, name);
    mkdirSync(cwd, { recursive: true });
    const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd, model: "m-1", preset: "plain" } })).json()).id);
    const project = String(shim.app.memory.archive?.getChain(id)?.project_id || "");
    assert.ok(project, "the chat is of a project");
    return { id, cwd, project };
  };
  /** @param {string} id @param {string} content */
  const send = async (id, content) => {
    const r = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** A turn of Filament's own asked of the chat, as its wakers ask (server.js `postOwnTurn`). @param {string} id @param {Record<string, unknown>} own */
  const ask = (id, own) => shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { ...own, stream: false } });
  /** The project archived, or brought back, as the left bar's menu does it. @param {string} project @param {boolean} on */
  const archiveProject = async (project, on) => {
    const r = await shim.api(`/api/memory/projects/${encodeURIComponent(project)}/archive`, { method: "POST", body: { archived: on } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  const owedOf = (/** @type {string} */ id) => shim.app.memory.archive?.metaOf(id, ["owedWakes"])?.owedWakes;
  /** The chat's own mark, as its settings say it, and what the rule says of the chat. @param {string} id */
  const standsOf = async (id) => [(await (await shim.api(`/api/sessions/${encodeURIComponent(id)}`)).json()).inForce?.archived === true, shim.app.sessions.notByItself(id)];
  /** @param {unknown} minutes */
  const setMinutes = async (minutes) => {
    const cfg = (await (await shim.api("/api/state")).json()).config;
    const r = await shim.api("/api/config", { method: "PUT", body: { ...cfg, sessions: { ...cfg.sessions, idleWakeMinutes: minutes } } });
    assert.equal(r.status, 200, await r.clone().text());
  };

  before(async () => {
    base = mkdtempSync(join(tmpdir(), "filament-archived-project-"));
    made.push(base);
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
      const last = lastSaid(call.body);
      if (last.includes(WAKE_HEAD)) {
        watched.push(last);
        return anthropicReply("Read it: nothing drifted.", { model: "m-1" });
      }
      const round = /goal round (\d+) of \d+/.exec(last);
      if (round) return anthropicReply(`Round ${round[1]}: the parser ships.\n\n[goal: done]`, { model: "m-1" });
      if (last.includes(IDLE_WAKE_LINE.slice(0, 60))) return anthropicReply("HEARD-idle", { model: "m-1" });
      if (last.includes(TIME_WAKE_LINE.slice(0, 60))) return anthropicReply("HEARD-time", { model: "m-1" });
      if (last.includes(WAKE_LINE.slice(0, 60)) || last.includes(ANY_WAKE_LINE.slice(0, 60))) return anthropicReply("HEARD-exit", { model: "m-1" });
      const gate = /start the build at (\S+?)\./.exec(last)?.[1];
      if (gate) return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: `b-${gate}`, name: "bash_background", input: { command: exitsOn(gate) } }] });
      return anthropicReply("OK.", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      overrides: { idleWakeMinuteMs: MINUTE_MS },
      configure: (cfg) => {
        // Its list of models names m-1: a team's model is read as a person names one, from that list.
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1"] }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [base], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
        // 60 "minutes" of 400 ms: no check-in comes within a test that does not set its own.
        cfg.sessions = { ...cfg.sessions, idleWakeMinutes: 60 };
      },
    });
    made.push(shim.dataDir);
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });

  test("the rule reads the project's flag, and says which it is: a wake asked of a chat of an archived project is refused; the chat's own mark is untouched; brought back, the wake goes and carries what waited", async () => {
    const { id, project } = await chatIn("wake");
    const other = await chatIn("beside");
    assert.notEqual(other.project, project, "a folder of its own is a project of its own");
    await send(id, "hello");
    // A command's end waits untold for the chat, its wake not yet sent (hands.js `tellLater`'s `now: false`).
    tellLater({ session: id, agent: null }, { id: "bg_parch", command: "npm test", code: 0, text: "[Filament: background shell bg_parch (npm test) exited with code 0.]" }, { now: false });
    await archiveProject(project, true);
    assert.deepEqual([await standsOf(id), await standsOf(other.id)], [[false, ARCHIVED_PROJECT], [false, null]], "of that project alone, and no mark of the chat's own");
    assert.equal(ARCHIVED_PROJECT, "its project is archived");
    const refused = await ask(id, { by: "wake" });
    const said = /** @type {any} */ (await refused.json());
    assert.deepEqual([refused.status, said.wake, said.error], [409, "archived", "the chat's project is archived, and Filament starts no turn in it by itself: its next turn carries what came"]);
    assert.equal((await transcript(id)).turns.length, 1, "no turn of Filament's");
    await archiveProject(project, false);
    assert.equal(shim.app.sessions.notByItself(id), null);
    const woke = await ask(id, { by: "wake" });
    assert.equal(woke.status, 200, await woke.clone().text());
    const t = await turnsDone(id, 2);
    assert.equal(t.turns[1].woke, true);
    assert.match(JSON.stringify(t.turns[1].user), /background shell bg_parch \(npm test\) exited with code 0\./);
  });

  test("a command that ends in an archived project starts no turn; the person's own message there is taken as in any chat and brings nothing back; what its agent starts then wakes nothing either", async () => {
    const { id, cwd, project } = await chatIn("command");
    await send(id, "start the build at gate-a.");
    await archiveProject(project, true);
    writeFileSync(join(cwd, "gate-a"), "");
    // Its end came: kept untold for the agent, or — the defect — told in a turn Filament started for it.
    await until(async () => (owedOf(id)?.untold || []).some((/** @type {any} */ x) => x.code === 0) || (await transcript(id)).turns.length > 1 || null, "the command's end", { timeoutMs: 20_000 });
    await sleepMs(1500);
    assert.equal((await transcript(id)).turns.length, 1, "archived: no turn of Filament's");
    // The person writes there: their own turn, which carries the end — and the project stays where they put it.
    await send(id, "start the build at gate-b.");
    const t = await turnsDone(id, 2);
    assert.equal(t.turns[1].woke, undefined, "the person's own turn");
    assert.match(JSON.stringify(t.turns[1].user), /background shell bg_[0-9a-z]+ \(node -e .*\) exited with code 0/);
    assert.deepEqual(await standsOf(id), [false, ARCHIVED_PROJECT], "their message brings no project back");
    assert.equal(shim.app.memory.archive?.projects().find((/** @type {any} */ p) => p.id === project)?.archived, true);
    // Its agent ended that turn on a command still running: its end wakes nothing while the project is archived.
    writeFileSync(join(cwd, "gate-b"), "");
    await until(() => (owedOf(id)?.untold || []).some((/** @type {any} */ x) => x.code === 0) || null, "the second command's end, untold", { timeoutMs: 20_000 });
    await sleepMs(1500);
    assert.equal((await transcript(id)).turns.length, 2, "archived: no turn of Filament's");
    // Brought back, nothing starts for what waited: the chat's next turn carries it.
    await archiveProject(project, false);
    await sleepMs(1500);
    assert.equal((await transcript(id)).turns.length, 2, "brought back: what waited starts nothing");
    await send(id, "hello again");
    assert.match(JSON.stringify((await turnsDone(id, 3)).turns[2].user), /exited with code 0/);
  });

  test("an idle check-in starts no turn in an archived project, and is set again; brought back, it comes at its next time", async () => {
    await setMinutes(2);
    const { id, cwd, project } = await chatIn("idle");
    try {
      await send(id, "start the build at gate-i.");
      await archiveProject(project, true);
      // Three of its waits pass: held each time, and set again.
      await sleepMs(3 * 2 * MINUTE_MS + 300);
      assert.equal((await transcript(id)).turns.length, 1, "archived: no turn of Filament's");
      assert.deepEqual([(owedOf(id)?.untold || []).length, owedOf(id)?.idle?.at > Date.now() - 2 * MINUTE_MS], [0, true], `nothing told, and set again: ${JSON.stringify(owedOf(id))}`);
      await archiveProject(project, false);
      const t = await turnsDone(id, 2);
      assert.equal(t.turns[1].woke, true, "a turn of Filament's");
      assert.ok(JSON.stringify(t.turns[1].user).includes(IDLE_WAKE_LINE), JSON.stringify(t.turns[1].user));
      assert.match(JSON.stringify(t.turns[1].final), /HEARD-idle/);
    } finally {
      writeFileSync(join(cwd, "gate-i"), "");
      await setMinutes(60);
    }
  });

  test("a goal's round is refused in an archived project and stays owed; brought back, the round goes when it is asked for", async () => {
    const { id, project } = await chatIn("goal");
    await send(id, "hello");
    /** @type {any} */ (shim.app).memory.setGoal(id, { ...newGoal("the parser ships", { now: Date.now() }), status: "active", acceptedAt: Date.now(), drive: { on: true, round: 1, cap: 20, halted: null } });
    assert.equal(shim.app.sessions.oweGoal(id), true, "its next round is owed");
    await archiveProject(project, true);
    const refused = await ask(id, { by: "goal" });
    const said = /** @type {any} */ (await refused.json());
    assert.deepEqual([refused.status, said.wake, said.error], [409, "archived", "the chat's project is archived, and Filament starts no turn in it by itself: the goal's round stays owed"]);
    assert.deepEqual([(await transcript(id)).turns.length, shim.app.sessions.goalOwed(id), /** @type {any} */ (shim.app).memory.goalFor(id)?.drive?.halted], [1, true, null], "no round, still owed, the drive not halted");
    await archiveProject(project, false);
    const round = await ask(id, { by: "goal" });
    assert.equal(round.status, 200, await round.clone().text());
    assert.match(JSON.stringify((await turnsDone(id, 2)).turns[1].user), /goal round 2 of 20/);
    assert.equal(shim.app.sessions.goalOwed(id), false, "its turn took it");
  });

  test("a come-back whose time comes in an archived project is told and starts no turn; brought back, the next one wakes the chat, and carries the one that waited", async () => {
    const { id, project } = await chatIn("come-back");
    await send(id, "hello");
    await archiveProject(project, true);
    assert.equal(keepComeBack(id, { id: "wake_parch1", at: Date.now() + 300, setAt: Date.now() - 120_000, note: "check the deploy" }), "armed");
    await until(() => (owedOf(id)?.untold || []).some((/** @type {any} */ x) => x.kind === "wake") || null, "its time came, told", { timeoutMs: 20_000 });
    await sleepMs(1500);
    assert.equal((await transcript(id)).turns.length, 1, "archived: no turn of Filament's");
    await archiveProject(project, false);
    await sleepMs(1500);
    assert.equal((await transcript(id)).turns.length, 1, "brought back: what waited starts nothing");
    assert.equal(keepComeBack(id, { id: "wake_parch2", at: Date.now() + 300, setAt: Date.now() - 60_000, note: "check the page" }), "armed");
    const t = await turnsDone(id, 2);
    assert.equal(t.turns[1].woke, true, "a turn of Filament's");
    assert.match(JSON.stringify(t.turns[1].user), /Your note: check the deploy[\s\S]*Your note: check the page/);
    assert.match(JSON.stringify(t.turns[1].final), /HEARD-time/);
  });

  test("its Space's watcher hears nothing and wakes nothing while the project is archived, its row says why, nothing is switched off, and the person's Run now runs it still; brought back, it wakes on what happens then, and nothing it missed is made up", async () => {
    const lead = await chatIn("space");
    const worker = await chatIn("space");
    const project = lead.project;
    assert.equal(worker.project, project);
    await send(lead.id, "hello");
    shim.app.spaces.make(project);
    const f = routineFields({ title: "Supervisor", text: "Read its turn.", model: "m-1", wakes: "chat", trigger: { kind: "turn", chat: worker.id, turns: "all" } }, { create: true });
    assert.ok(f.ok, JSON.stringify(f));
    const wid = shim.app.spaces.routinePropose(project, f.fields, { chain: lead.id, byName: "Lead", model: "m-1", nameOf: () => "Lead" }).id;
    const on = await shim.api(`/api/space/${project}/routines/${wid}/on`, { method: "POST", body: {} });
    assert.equal(on.status, 200, await on.clone().text());
    const w = () => shim.app.spaces.get(project).routines.find((x) => x.id === wid);
    /** Its row as the Space's page reads it. */
    const row = async () => /** @type {any} */ (await (await shim.api(`/api/space/${project}`)).json()).runs.routines.find((/** @type {any} */ x) => x.id === wid);
    const before = watched.length;
    await archiveProject(project, true);
    // A turn of the chat it watches ends: the person's own, taken as in any chat — and not heard.
    await send(worker.id, "hello");
    await sleepMs(1200);
    assert.deepEqual([watched.length - before, w()?.pending ?? null, w()?.last ?? null], [0, null, null], "nothing heard, nothing woken");
    assert.deepEqual([w()?.state, w()?.paused, (await row()).words.next], ["on", false, ROW_ARCHIVED], "on as it was, its row saying why it runs nothing");
    // The person's own press runs it, as under Pause all.
    const ran = await shim.api(`/api/space/${project}/routines/${wid}/run`, { method: "POST", body: {} });
    assert.equal(ran.status, 200, await ran.clone().text());
    await until(() => w()?.last?.state === "done" || null, "its turn on the person's Run now, ended", { timeoutMs: 20_000 });
    assert.equal(watched.length - before, 1);
    // Brought back: the next turn there is heard, alone.
    await archiveProject(project, false);
    assert.notEqual((await row()).words.next, ROW_ARCHIVED);
    await send(worker.id, "hello again");
    await until(() => (watched.length - before === 2 && w()?.last?.state === "done") || null, "the watcher's wake after the project came back", { timeoutMs: 20_000 });
    assert.match(watched.at(-1) || "", /Turn 2 of .+ ended/);
    assert.doesNotMatch(watched.at(-1) || "", /Turn 1 of .+ ended/, "what it missed is not made up");
    assert.equal(w()?.last?.events, 1);
  });

  // A team's switches act by themselves as it ends (s-itself, 11-12): Then notify began a turn of the main chat, and
  // Then verify sent BugHunters, in an archived project as in any. The team itself is the person's to send there.
  // (fails before: yes — the main chat took a turn with the team's result by itself, and BugHunters started on the
  // Builders' result)
  test("a team's result in an archived project: Then notify starts no turn of the main chat by itself, and Then verify no BugHunters; its card says it reached nobody, and why; the person's Send to your agent… sends it still", async () => {
    const { id, project } = await chatIn("team");
    await send(id, "hello");
    await archiveProject(project, true);
    const WHY = "the chat's project is archived, and Filament starts no turn in it by itself";
    const teams = async () => /** @type {any[]} */ ((await (await shim.api(`/api/sessions/${id}/beside`)).json()).teams || []);
    /** A team sent by the person, and its row once its result is in and its switches acted. @param {Record<string, unknown>} body */
    const ended = async (body) => {
      const r = await shim.api(`/api/sessions/${id}/beside`, { method: "POST", body: { model: "m-1", ...body } });
      assert.equal(r.status, 200, await r.clone().text());
      const tid = String((await r.json()).team.id);
      return until(async () => {
        const x = (await teams()).find((t) => t.id === tid);
        return x?.state === "done" && (x.missed || x.notified || x.verifiedBy) ? x : null;
      }, `the ${body.team} team's result, and where it went`, { timeoutMs: 30_000 });
    };
    const hunt = await ended({ team: "bughunters", ask: "find bugs in the parser", notify: true });
    assert.deepEqual([hunt.notified, hunt.missed], [null, `the result could not reach the main agent: ${WHY}`]);
    assert.equal(seenWords(hunt), `Filament tried to hand it to your agent when the team ended and could not (${WHY}): your agent has not seen it — Send to your agent… still sends it`);
    // Then verify: no BugHunters by itself on the Builders' result, which stands unsent as well.
    const built = await ended({ team: "builders", ask: "build it", verify: true, notify: true });
    assert.deepEqual([built.verifiedBy ?? null, built.notified, built.missed], [null, null, `the result could not reach the main agent: ${WHY}`]);
    await sleepMs(600);
    assert.deepEqual([(await teams()).filter((t) => t.of === built.id).length, (await transcript(id)).turns.length], [0, 1], "no check sent, and no turn of Filament's in the main chat");
    // The person's own press sends it, as in any chat.
    const pressed = await shim.api(`/api/sessions/${id}/beside/${hunt.id}/notify`, { method: "POST", body: {} });
    assert.deepEqual([pressed.status, (await pressed.clone().json()).how], [200, "sent"], await pressed.clone().text());
    const t = await turnsDone(id, 2);
    assert.equal(t.turns[1].teamResult, true);
    assert.equal((await teams()).find((x) => x.id === hunt.id)?.notified?.how, "sent");
  });
});

describe("a restart's resume (a real Filament, started twice)", () => {
  /** @param {string} text */
  const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
  /** A run event as the log stores one. @param {string} type @param {Record<string, any>} [o] @param {number} [ts] */
  const ev = (type, o = {}, ts = 0) => ({ type, ts, ...o });
  /** A loop's turn two calls in, cut while its second round ran (resume-cut.test.js's). */
  const LOGGED = [
    ev("run-start", { kind: "agent-turn" }, 100),
    ev("round-start", { round: 1 }, 110),
    ev("tool-start", { round: 1, id: "c1", name: "read", args: "src/sheet.js" }, 120),
    ev("tool-end", { round: 1, id: "c1", name: "read", ok: true, preview: "export function sheet() {}" }, 130),
    ev("round-text", { round: 1, text: "Reading the sheet.", block: 0 }, 131),
    ev("round-start", { round: 2 }, 140),
    ev("tool-start", { round: 2, id: "c2", name: "write", args: "src/sheet.js" }, 150),
  ];

  test("a chat of an archived project is not gone on with: no turn is sent, its cut turn says why in the person's words, a resume asked of it is refused; brought back, the resume goes", async () => {
    const up = await fakeUpstream((call) => anthropicReply(lastSaid(call.body).includes(RESUME_LINE.slice(0, 60)) ? "FINISHED THE SHEET" : "DONE", { model: "m-1" }));
    const folder = mkdtempSync(join(tmpdir(), "filament-archived-resume-"));
    const configure = (/** @type {any} */ cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
    };
    // A chat whose second turn a restart cut off (resume-cut.test.js's `restarted`), its project archived meanwhile.
    let shim = await startApp({ memory: true, keep: true, configure });
    const dataDir = shim.dataDir;
    made.push(dataDir, folder);
    const modelCalls = () => up.received.filter((/** @type {any} */ c) => c.kind === "anthropic").length;
    try {
      const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain" } })).json()).id);
      const one = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "turn 1: hello", stream: false } });
      assert.equal(one.status, 200, await one.clone().text());
      const start = JSON.parse(readFileSync(join(dataDir, "runs", `${String(one.headers.get("x-filament-request-id"))}.jsonl`), "utf8").split("\n")[0]);
      /** @type {any} */
      const archive = shim.app.memory.archive;
      const project = String(archive.getChain(id).project_id);
      archive.beginTurn(id, { requestId: "cut-run", model: "m-1", upstream: "m", client: "harness", window: "harness", running: true, userMessage: user("turn 2: build the sheet") });
      const put = await shim.api(`/api/memory/projects/${encodeURIComponent(project)}/archive`, { method: "POST", body: { archived: true } });
      assert.equal(put.status, 200, await put.clone().text());
      await shim.stop();
      const logged = [{ ...start, runId: "cut-run" }, ...LOGGED.slice(1).map((e, i) => ({ ...e, n: i + 2, seq: 0, ts: start.ts + i + 1, runId: "cut-run" }))];
      writeFileSync(join(dataDir, "runs", "cut-run.jsonl"), logged.map((e) => JSON.stringify(e)).join("\n") + "\n");
      up.reset();
      shim = await startApp({ memory: true, keep: true, dataDir, configure });
      assert.deepEqual(await shim.app.resumedAtStart, [], "no turn is sent");
      await shim.app.owedWokenAtStart;
      assert.equal(modelCalls(), 0, "no model call");
      const tr = await (await shim.api(`/api/sessions/${id}/transcript`)).json();
      assert.deepEqual([tr.turns.length, tr.turns[1].cutOff, tr.turns[1].cut.resume], [2, true, { held: ARCHIVED_PROJECT }]);
      assert.match(openTurnWords(tr.turns[1]), /Filament did not go on by itself: this chat's project is archived\. Send a message to go on$/);
      // The route a resume takes keeps the rule too.
      const asked = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { by: "resume", stream: false } });
      assert.equal(asked.status, 409, await asked.clone().text());
      assert.equal((await asked.json()).error, "the chat's project is archived, and Filament starts no turn in it by itself: its next turn goes on from what the cut turn had done");
      assert.equal(modelCalls(), 0, "still none");
      // Brought back, a resume asked of it goes on with the cut turn.
      const back = await shim.api(`/api/memory/projects/${encodeURIComponent(project)}/archive`, { method: "POST", body: { archived: false } });
      assert.equal(back.status, 200, await back.clone().text());
      const went = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { by: "resume", stream: false } });
      assert.equal(went.status, 200, await went.clone().text());
      const after = await (await shim.api(`/api/sessions/${id}/transcript`)).json();
      assert.deepEqual([after.turns.length, after.turns[2].resumed, textOfMessage(after.turns[2].final)], [3, true, "FINISHED THE SHEET"]);
    } finally {
      await shim.stop().catch(() => {});
      await up.close();
    }
  });

  test("the cut turn's line reads right to the person for both causes: the chat they archived, and its project", () => {
    const cut = { rounds: 0, tools: 0, logged: 0 };
    assert.equal(ARCHIVED_CHAT, "the person archived it");
    assert.equal(openTurnWords({ cutOff: true, cut: { ...cut, resume: { held: ARCHIVED_CHAT } } }), "cut off before its reply — Filament stopped while it ran. Its run's log shows no work before that. Filament did not go on by itself: you archived this chat. Send a message to go on");
    assert.equal(openTurnWords({ cutOff: true, cut: { ...cut, resume: { held: ARCHIVED_PROJECT } } }), "cut off before its reply — Filament stopped while it ran. Its run's log shows no work before that. Filament did not go on by itself: this chat's project is archived. Send a message to go on");
    // Any other reason is said as it is kept.
    assert.match(openTurnWords({ cutOff: true, cut: { ...cut, resume: { refused: "the session asks before compacting" } } }), /Filament did not go on by itself: the session asks before compacting\. Send a message to go on$/);
  });
});

describe("its Space's routines and watchers (the runner, over the store and a clock)", () => {
  /** A moment of Monday 26 October 2026, local. @param {number} h @param {number} [m] */
  const at = (h, m = 0) => new Date(2026, 9, 26, h, m).getTime();
  const BY = { chain: "c1", byName: "Lead", model: "m", nameOf: () => "Lead" };
  /** A turn of c2 that ended, as a watcher keeps it. @param {number} i @param {number} when */
  const ev = (i, when) => ({ id: `turn:c2:${i}:${when}`, kind: "turn", at: when, chain: "c2", summary: `Turn ${i} of Build the login flow ended: 2 files changed`, ref: `turn ${i}`, of: { turn: i } });
  /** A chat's facts as the sessions service says them. @param {any} [o] */
  const facts = (o = {}) => ({ busy: false, asking: false, last: { n: 3, final: true, text: "Earlier reply.", cut: false, failed: false, why: "", stopped: false }, ...o });

  /** The runner over a store that knows which projects are archived (`archived`), its chats' facts and its posts the test's. */
  function rig() {
    const clock = { at: at(9) };
    const now = () => clock.at;
    /** @type {Set<string>} */
    const archived = new Set();
    const spaces = createSpaceStore({ dir: null, now, archived: (p) => archived.has(p) });
    /** @type {[string, any][]} */
    const posted = [];
    /** @type {Map<string, any>} */
    const chats = new Map([["c1", facts()]]);
    let n = 0;
    const routines = createRoutines({
      spaces,
      sessions: {
        create: () => {
          const id = `run${++n}`;
          chats.set(id, facts({ last: null }));
          return { id };
        },
        besideFacts: (id) => {
          const f = chats.get(id);
          if (!f) throw new Error("no such session");
          return f;
        },
      },
      mark: () => {},
      postTurn: async (id, b) => {
        posted.push([id, b]);
        const c = chats.get(id);
        const turn = (c?.last?.n || 0) + 1;
        chats.set(id, { ...c, busy: true, last: { ...facts().last, n: turn, final: false, text: "" } });
        return { status: 200, body: null, turn };
      },
      remove: async (id) => void chats.delete(id),
      folderOf: (p) => (p === "p1" ? "/work/app" : null),
      nameOf: () => "app",
      chatName: () => "Lead",
      now,
    });
    /** A run's chat ends its turn, and lets go. @param {string} id */
    const end = (id) => {
      chats.set(id, facts({ last: { ...facts().last, n: chats.get(id)?.last?.n || 1 } }));
      routines.released(id);
    };
    /** @param {Record<string, unknown>} fields */
    const add = (fields) => {
      const f = routineFields({ title: "Morning brief", text: "Write the brief.", ...fields }, { create: true });
      assert.ok(f.ok, JSON.stringify(f));
      const id = spaces.routinePropose("p1", f.fields, BY).id;
      spaces.routineOn("p1", id);
      return id;
    };
    return { clock, spaces, routines, posted, archived, add, end, of: (/** @type {string} */ id) => /** @type {import("../src/core/routines.js").Routine} */ (spaces.get("p1").routines.find((x) => x.id === id)) };
  }

  test("a routine at times: its time in an archived project is skipped, said on its row with why; nothing is switched off; brought back, it runs at its next time, and the times it missed are not made up", async () => {
    const t = rig();
    await t.routines.start();
    const id = t.add({ when: "every 30m" });
    t.archived.add("p1");
    t.routines.arm();
    t.clock.at = at(9, 30);
    await t.routines.tick();
    t.clock.at = at(10);
    await t.routines.tick();
    assert.deepEqual([t.posted.length, t.of(id).state, t.of(id).paused, t.of(id).last ?? null], [0, "on", false, null], "nothing ran, nothing switched off");
    assert.deepEqual(t.of(id).skipped, { at: at(10), why: "its project was archived" });
    const words = rowWords(t.of(id), { now: t.clock.at, archived: true });
    assert.deepEqual([words.skipped, words.next, words.nextAt], ["today 10:00 skipped: its project was archived", ROW_ARCHIVED, null]);
    assert.equal(rowWords(t.of(id), { now: t.clock.at }).next, "next: today 10:30", "and its next time as ever where it is not");
    // Brought back between two of its times: nothing runs for the ones that passed.
    t.clock.at = at(10, 10);
    t.archived.delete("p1");
    t.routines.arm();
    await t.routines.tick();
    assert.equal(t.posted.length, 0, "no run made up");
    t.clock.at = at(10, 30);
    await t.routines.tick();
    assert.deepEqual([t.posted.length, t.of(id).last?.state, t.of(id).last?.at], [1, "running", at(10, 30)]);
    t.routines.stop();
  });

  test("a watcher: what waited as the project was archived wakes nothing, and what happens meanwhile is not heard; brought back, it wakes once with what waited, as after Pause all", async () => {
    const t = rig();
    await t.routines.start();
    const id = t.add({ title: "Supervisor", text: "Read its turn.", trigger: { kind: "turn", chat: "c2" }, wakes: "new" });
    // Its run under way as the project is archived: what it hears then waits for that run's end.
    assert.equal(await t.routines.heard("p1", id, [ev(1, at(9, 1))]), 1);
    assert.deepEqual([t.posted.length, t.of(id).last?.state], [1, "running"]);
    assert.equal(await t.routines.heard("p1", id, [ev(2, at(9, 2))]), 1, "heard while its run is under way: it waits");
    t.archived.add("p1");
    t.routines.arm();
    t.end("run1");
    await t.routines.tick();
    assert.deepEqual([t.posted.length, t.of(id).pending?.events.length, t.of(id).last?.state], [1, 1, "done"], "what waited starts nothing");
    for (let i = 3; i <= 40; i++) assert.equal(await t.routines.heard("p1", id, [ev(i, at(9, i))]), 0, "archived: it hears none");
    t.clock.at = at(11);
    await t.routines.tick();
    assert.deepEqual([t.posted.length, t.of(id).pending?.events.length, t.of(id).pending?.more, t.of(id).state, t.of(id).paused], [1, 1, 0, "on", false]);
    const words = rowWords(t.of(id), { now: t.clock.at, archived: true });
    assert.equal(words.next, ROW_ARCHIVED);
    // Brought back: one wake, with the one event that waited.
    t.archived.delete("p1");
    t.routines.arm();
    await t.routines.tick();
    assert.deepEqual([t.posted.length, t.of(id).pending ?? null, t.of(id).last?.events], [2, null, 1]);
    assert.equal(await t.routines.heard("p1", id, [ev(41, at(11, 1))]), 1, "and it hears again");
    t.routines.stop();
  });

  test("Run now in an archived project: the person's press runs it, as under Pause all; a chat's agent's is refused in words", async () => {
    const t = rig();
    await t.routines.start();
    const id = t.add({ when: "weekdays 18:00" });
    t.archived.add("p1");
    t.routines.arm();
    await assert.rejects(t.routines.runNow("p1", id, { chain: "c1", byName: "Lead" }), (/** @type {any} */ e) => e.status === 409 && e.message === "this project is archived: nothing in it starts by itself until the person brings it back. Their Run now runs it still.");
    assert.equal(t.posted.length, 0);
    assert.equal(await t.routines.runNow("p1", id), "run1");
    assert.deepEqual([t.posted.length, t.of(id).last?.by], [1, "you"]);
    t.routines.stop();
  });

  test("the store keeps nothing a source brings for an archived project's watcher, as under Pause all: no event, no head, no look", () => {
    const clock = { at: at(9) };
    /** @type {Set<string>} */
    const archived = new Set();
    const store = createSpaceStore({ dir: null, now: () => clock.at, archived: (p) => archived.has(p) });
    /** @param {Record<string, unknown>} trigger */
    const watcher = (trigger) => {
      const f = routineFields({ title: "Watcher", text: "Read it.", trigger }, { create: true });
      assert.ok(f.ok, JSON.stringify(f));
      const id = store.routinePropose("p1", f.fields, BY).id;
      store.routineOn("p1", id);
      return id;
    };
    const turns = watcher({ kind: "turn", chat: "c2" });
    const commits = watcher({ kind: "commit", branch: "main" });
    const files = watcher({ kind: "file", glob: "docs/**/*.md" });
    const of = (/** @type {string} */ id) => store.get("p1").routines.find((x) => x.id === id);
    assert.equal(store.archived("p1"), false);
    archived.add("p1");
    assert.deepEqual([store.archived("p1"), store.archived("p2")], [true, false]);
    assert.equal(store.watchHeard("p1", turns, [ev(1, at(9, 1))]), 0);
    assert.equal(store.watchHead("p1", commits, "a".repeat(40)), false);
    assert.equal(store.watchLooked("p1", files, at(9, 1)), false);
    assert.deepEqual([of(turns)?.pending ?? null, of(commits)?.seen?.head ?? null, of(files)?.seen?.fileAt ?? null], [null, null, null]);
    archived.delete("p1");
    assert.equal(store.watchHeard("p1", turns, [ev(2, at(9, 2))]), 1);
    assert.equal(store.watchHead("p1", commits, "a".repeat(40)), true);
    assert.equal(store.watchLooked("p1", files, at(9, 2)), true);
  });
});

// Its Space's dashboards and apps (s-itself, 11-12): a kept one read its sources on its watches' timers, at its page's
// every and as its Space and Home were read, in an archived project as in any — its commands and scripts run with its
// secrets, unseen. The runner asks the one rule the routines ask.
// (fails before: yes — a watch looked after a restart in an archived project, its row said "next: soon"; a page's ask,
// At a glance and an agent's look each ran the sources' commands; an agent's read, press and tool ran; bringing the
// project back set no watch again)
describe("its Space's dashboards and apps (the runner, over the store, its routes and a clock)", () => {
  const MIN = 60_000;
  /** Deploys (space-dashboards.test.js's, cut down): two sources, a watch on CI's runs, a button on a deploy's row. */
  const DEPLOYS = {
    tiles: [
      { kind: "table", title: "Recent deploys", from: "deploys", columns: ["when", "version"], actions: ["rollback"] },
      { kind: "status", title: "CI on main", from: "runs", field: "status" },
    ],
    tables: { deploys: [{ when: "2026-10-24T12:00:00Z", version: "7c1e" }], runs: [{ run: 8812, status: "failure" }] },
    sources: {
      deploys: { command: ["npx", "wrangler", "deployments", "list", "--json"], key: "id", every: "2m", columns: { when: "created_on", version: "version" } },
      runs: { command: ["gh", "run", "list", "--json", "databaseId,conclusion"], key: "databaseId", columns: { run: "databaseId", status: "conclusion" } },
    },
    watch: [{ from: "runs", new: true, match: { status: "failure" }, says: "CI failed on main: run {row.run}", every: "10m" }],
    actions: { rollback: { label: "Roll back to this…", on: "deploys", command: ["npx", "wrangler", "rollback", "{row.version}", "--yes"], check: { "row.version": "^[0-9a-f]{4}$" }, says: "Roll back to {row.version}?" } },
  };
  /** CI (app-tools.test.js's, cut down): an app with a tool its Space's agents run. */
  const CI = {
    type: "app",
    title: "CI",
    html: "<!doctype html><title>CI</title><main></main>",
    sources: { runs: { command: ["node", "runs.mjs"], key: "id" } },
    actions: {},
    tools: { tail_logs: { description: "The CI server's newest log lines", args: { lines: { description: "How many lines", pattern: "^[0-9]{1,4}$" } }, command: ["node", "tools/logs.mjs", "--lines={args.lines}"], effect: "reads" } },
  };
  const NAME = "deploys-ab12";
  const GH = "gh run list --json databaseId,conclusion";
  const NPX = "npx wrangler deployments list --json";
  /** What an agent is told there: the routines' words to it, and what runs it still. */
  const AGENT_NO = "this project is archived: nothing in it starts by itself until the person brings it back. Their own press runs it still";
  const BY = { chain: "c1", name: null, byName: "Lead" };

  /** Deploys and CI kept in p1, over a store that knows which projects are archived (`archived`); each command run counted. */
  function world() {
    const folder = mkdtempSync(join(tmpdir(), "filament-archived-dash-"));
    const data = mkdtempSync(join(tmpdir(), "filament-archived-art-"));
    made.push(folder, data);
    mkdirSync(join(folder, "tools"));
    writeFileSync(join(folder, "tools", "logs.mjs"), "console.log('ok')");
    writeFileSync(join(folder, "runs.mjs"), "console.log('[]')");
    const clock = { at: Date.UTC(2026, 9, 24, 14, 0) };
    const now = () => clock.at;
    /** @type {Set<string>} */
    const archived = new Set();
    const four = ["ab12", "cd34"];
    const artifacts = createArtifactStore({ dataDir: data, log: () => {}, now, four: () => four.shift() || "zzzz" });
    const spaces = createSpaceStore({ dir: null, now, archived: (p) => archived.has(p) });
    /** The sources' commands run, and the buttons' and tools'. @type {string[]} */
    const ran = [];
    /** @type {string[]} */
    const acted = [];
    const deps = {
      spaces,
      artifacts,
      folderOf: () => folder,
      projectOfChain: () => "p1",
      now,
      /** @type {import("../src/core/dashboard-sources.js").RunCommand} */
      run: async (argv) => {
        ran.push(argv.join(" "));
        const out = argv[0] === "gh" ? [{ databaseId: 1, conclusion: "failure" }] : argv[0] === "npx" ? [{ id: "a", created_on: "2026-10-23T10:00:00Z", version: "3f2a" }] : [];
        return { ok: true, out: JSON.stringify(out) };
      },
      /** @type {import("../src/core/dashboard-sources.js").RunAction} */
      act: async (argv) => {
        acted.push(argv.join(" "));
        return { ok: true, said: "done\n" };
      },
    };
    const runner = createDashboardRunner(deps);
    for (const input of [{ type: "dashboard", title: "Deploys", ...DEPLOYS }, CI]) {
      const r = artifactCall({ action: "publish", ...input }, { who: "c1", by: { chain: "c1", model: "m", folder, helper: null }, within: [], port: 20300, maxBytes: 1_000_000 }, artifacts);
      assert.ok(r.ok, r.ok ? "" : r.error);
    }
    assert.deepEqual([runner.keep("p1", NAME, 1).ok, runner.keep("p1", "ci-cd34", 1).ok], [true, true]);
    /** Where a chat's agent stands, for the space tool. @returns {any} */
    const atOf = () => ({ store: spaces, project: "p1", chain: "c1", name: null, nameOf: () => "Lead", on: () => true, dashboards: runner, judge: async () => ({ ok: true }) });
    /** The Space's routes over a runner. @param {any} [dashboards] */
    const rows = (dashboards = runner) => spaceRoutes(/** @type {any} */ ({
      config: { get: () => ({ agentLoop: { roots: [tmpdir()] }, server: {} }) },
      memory: { archive: { getProject: (/** @type {string} */ id) => (id === "p1" ? { id, name: "app", cwd: folder } : null) } },
      spaces,
      dashboards,
    }));
    return { clock, spaces, artifacts, archived, ran, acted, deps, runner, atOf, rows };
  }
  /** One row through the real router: its status and its body. @param {any[]} rows @param {string} method @param {string} path @param {any} [json] */
  async function call(rows, method, path, json) {
    const m = createRouter(rows)(method, path);
    assert.ok(m, `${method} ${path} matched a row`);
    const got = { status: 0, body: /** @type {any} */ (null) };
    const res = { headersSent: false, writableEnded: false, writeHead: (/** @type {number} */ s) => Object.assign(got, { status: s }), end: (/** @type {string} */ b) => void (got.body = JSON.parse(String(b))) };
    await m.handler({ res, url: new URL(`http://localhost/api${path}`), path, method, params: m.params, json: async () => json }, {});
    return got;
  }
  /** A page's ask of its artifact's address: its status and its body. @param {any} answer @param {string} path */
  async function ask(answer, path) {
    /** @type {any} */
    const res = { status: 0, body: "", writeHead(/** @type {number} */ s) { this.status = s; }, write() {}, end(/** @type {any} */ b) { this.body = b ? String(b) : ""; } };
    await answer({ method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" }, on: () => {} }, res, NAME, new URL(`http://x${path}`));
    let json = null;
    try {
      json = JSON.parse(res.body);
    } catch {}
    return { status: res.status, body: res.body, json };
  }
  /** @param {any} r */
  const words = (r) => (r.ok ? r.text : r.error);
  /** The watch of Deploys looked, as its Space keeps it. @param {ReturnType<typeof world>} w */
  const looked = (w) => Object.keys(w.spaces.get("p1").dashboards.find((d) => d.name === NAME)?.seen || {}).length === 1;

  test("a kept watch looks at nothing in an archived project, a restart included, and its row says so where its next look would be, in the routines' rows' words; brought back, the watches are set again and it looks", async () => {
    const w = world();
    const looks = () => w.ran.filter((c) => c === GH).length;
    const one = createDashboardRunner({ ...w.deps, firstMs: 1 });
    one.start();
    await until(() => looked(w) || null, "the watch's first look");
    await one.stop();
    assert.equal(looks(), 1);
    w.archived.add("p1");
    // Filament started again over the archived project: no watch looks.
    const two = createDashboardRunner({ ...w.deps, firstMs: 1 });
    two.start();
    await sleepMs(60);
    assert.equal(looks(), 1, "no look in an archived project");
    assert.deepEqual(two.watches("p1").map((x) => [x.title, x.archived ?? false, x.paused, x.nextAt]), [["Deploys", true, false, null]], "kept and unpaused as it was, with no next look");
    const runs = (await call(w.rows(two), "GET", "/space/p1")).body.runs;
    assert.deepEqual([runs.watches[0].nextWords, runs.watches[0].archived, runs.head], [ROW_ARCHIVED, true, ""], "its row says why, and the head counts none of it");
    // Pause all switched meanwhile sets every watch again: none for the archived project.
    two.pauseAll(true);
    two.pauseAll(false);
    await sleepMs(60);
    assert.equal(looks(), 1);
    // Brought back, by the row the left bar's menu writes: the watches are set again, and it looks.
    const memory = { archiveProject: (/** @type {string} */ id, /** @type {boolean} */ on) => (on ? w.archived.add(id) : w.archived.delete(id), { ok: true }) };
    const back = await call(memoryRoutes(/** @type {any} */ ({ memory, usage: {}, dashboards: two })), "POST", "/memory/projects/p1/archive", { archived: false });
    assert.equal(back.status, 200, JSON.stringify(back.body));
    await until(() => looks() === 2 || null, "the watch's look once its project is back");
    const after = (await call(w.rows(two), "GET", "/space/p1")).body.runs;
    assert.deepEqual([after.watches[0].archived ?? false, after.head.startsWith("Runs by itself: 1 watch")], [false, true]);
    await two.stop();
  });

  test("nothing of it is read by itself there: its page's ask, At a glance and an agent's look answer its rows as last read and run nothing, and a source never read says why; the person's Refresh reads still; brought back, each reads as ever", async () => {
    const w = world();
    const handler = createArtifactsHandler(/** @type {any} */ ({ store: w.artifacts, server: () => ({ host: "127.0.0.1", allowedHosts: [] }), port: () => 20300, dashboards: w.runner }));
    const first = /** @type {any} */ (await w.runner.read(NAME, 1, "runs"));
    assert.deepEqual([first.ok, w.ran], [true, [GH]]);
    w.archived.add("p1");
    // An hour on: each source is long past its every.
    w.clock.at += 60 * MIN;
    const asked = await ask(handler, "/_filament/sources/runs?fresh=1");
    assert.deepEqual([asked.status, asked.json.at, asked.json.rows.length], [200, first.state.at, 1], "its page's ask: the rows as last read, as old as they are");
    const glance = w.runner.glance({ projects: new Set(["p1"]) }).find((g) => g.name === NAME);
    assert.deepEqual(glance?.tiles.map((t) => [t.title, t.read, t.stale, t.at]), [["CI on main", true, true, first.state.at]], "At a glance: its line as last read, said as of then");
    assert.match(words(await spaceRun({ action: "dashboard", with: { name: NAME } }, w.atOf(), w.clock.at)), /Deploys/);
    // After a restart none is read: its line says why, in the row's words, where it would say "Reading…" for ever.
    const cold = createDashboardRunner(w.deps).glance({ projects: new Set(["p1"]) }).find((g) => g.name === NAME);
    assert.deepEqual(cold?.tiles.map((t) => [t.read, t.stale, t.error]), [[false, false, ROW_ARCHIVED]]);
    assert.equal(glanceWords(/** @type {any} */ (cold?.tiles[0]), w.clock.at).under, `Couldn't read runs: ${ROW_ARCHIVED}.`);
    await sleepMs(10);
    assert.deepEqual(w.ran, [GH], "nothing ran");
    // One never read says why, in the routines' rows' words — to its page too.
    assert.deepEqual(await w.runner.read(NAME, 1, "deploys"), { ok: false, error: ROW_ARCHIVED, off: "archived" });
    const none = await ask(handler, "/_filament/sources/deploys");
    assert.deepEqual([none.status, none.json], [409, { error: `Deploys does not read deploys now: ${ROW_ARCHIVED}.`, off: "archived" }]);
    assert.equal(/"live":true/.test((await ask(handler, "/")).body), true, "its page is of the version that reads, as kept: the person's presses run still");
    assert.deepEqual(w.ran, [GH]);
    // The person's Refresh reads both now, as their Run now runs a routine.
    const read = await call(w.rows(), "POST", `/space/p1/dashboards/${NAME}/read`, {});
    assert.deepEqual([read.status, read.body.sources.deploys.at, read.body.sources.runs.at], [200, w.clock.at, w.clock.at]);
    assert.deepEqual(w.ran.slice(1).sort(), [GH, NPX]);
    // Brought back: a source past its every is read as it is asked.
    w.archived.delete("p1");
    w.clock.at += 60 * MIN;
    assert.equal((await ask(handler, "/_filament/sources/runs")).json.at, w.clock.at);
    assert.equal(w.ran.length, 4);
  });

  test("a button and a tool there: an agent's read, press and tool are refused in the routines' words, and it still looks and pauses; the person's press runs, and reads its source again", async () => {
    const w = world();
    await w.runner.read(NAME, 1, "deploys");
    w.archived.add("p1");
    /** @param {Record<string, any>} x */
    const dash = (x) => spaceRun({ action: "dashboard", with: { name: NAME, ...x } }, w.atOf(), w.clock.at).then(words);
    assert.equal(await dash({ read: true }), `Not read: ${AGENT_NO}.`);
    assert.equal(await dash({ read: "deploys" }), `Not read: ${AGENT_NO}.`);
    assert.equal(await dash({ press: "rollback", row: "a" }), `Not pressed: ${AGENT_NO}.`);
    assert.equal(words(await spaceRun({ action: "app", with: { name: "ci-cd34", tool: "tail_logs", args: { lines: "5" } } }, w.atOf(), w.clock.at)), `Not run: ${AGENT_NO}.`);
    // The doors themselves, whatever judged the call before.
    assert.deepEqual(await w.runner.act("p1", NAME, "rollback", "a", {}, { by: BY }), { ok: false, status: 409, error: AGENT_NO });
    assert.deepEqual(await w.runner.useTool("p1", "ci-cd34", "tail_logs", { lines: "5" }, { by: BY }), { ok: false, status: 409, error: AGENT_NO });
    assert.deepEqual([w.ran, w.acted], [[NPX], []], "nothing ran");
    // What stops something is the agent's still, and its look.
    assert.match(await dash({}), /Deploys/);
    assert.match(await dash({ pause: "its deploy key expired" }), /is paused: nothing of it reads, watches or runs until the person resumes it/);
    w.runner.change("p1", NAME, { paused: false });
    // The person's own press: its sheet opens, it runs, and its source is read again after it.
    const p = `/space/p1/dashboards/${NAME}/actions/rollback`;
    const sheet = await call(w.rows(), "POST", p, { key: "a" });
    assert.deepEqual([sheet.status, sheet.body.command], [200, ["npx", "wrangler", "rollback", "3f2a", "--yes"]]);
    const run = await call(w.rows(), "POST", `${p}/run`, { key: "a" });
    assert.deepEqual([run.status, run.body.done, w.acted], [200, true, ["npx wrangler rollback 3f2a --yes"]]);
    assert.deepEqual(w.ran, [NPX, NPX], "read again after the person's press");
    // Brought back, the agent's read reads.
    w.archived.delete("p1");
    assert.match(await dash({ read: "runs" }), /Deploys/);
    assert.deepEqual(w.ran, [NPX, NPX, GH]);
  });
});

describe("what the person reads of it", () => {
  test("the left bar's Archive project says what it now does", () => {
    const sidebar = readFileSync(new URL("../src/ui/harness/sidebar.js", import.meta.url), "utf8");
    assert.ok(sidebar.includes('cb.onToast?.("Project archived: its chats stay in the archive, and nothing in it runs by itself until you bring it back");'));
    const guide = readFileSync(new URL("../docs/GUIDE.md", import.meta.url), "utf8");
    assert.match(guide.replace(/\s+/g, " "), /An archived project runs nothing by itself/);
  });
});
