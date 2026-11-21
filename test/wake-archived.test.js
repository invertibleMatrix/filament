// @ts-check
// A chat the person archived takes no turn Filament starts by itself, whenever one is asked for (sessions/service.js
// `notByItself`, the owner's of 11-11: "an archived chat takes no turn Filament starts by itself; what it is owed stays
// owed and rides its next turn once the person opens it again"). Through a real Filament that never restarts: a
// command's end, an idle check-in, the wake's own route and a goal's round each find the chat archived and start
// nothing; brought back, nothing starts for what waited, and the person's next message carries it. A "minute" here is
// 400 ms (`overrides.idleWakeMinuteMs`).
// (fails before: yes — the review of 11-11: the rule stood in the start's sweep alone, read once as Filament started,
// so a chat archived while its command or its sub-agent ran was woken all the same)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { ANY_WAKE_LINE, IDLE_WAKE_LINE, WAKE_LINE } from "../src/app/sessions/wake.js";
import { tellLater } from "../src/adapters/tools/hands.js";
import { newGoal } from "../src/services/memory/goal.js";
import { SYNC_HEAD } from "../src/core/space.js";

const MINUTE_MS = 400;
/** A command that runs until the test lets it end, by the file `gate` in the chat's folder (a name, not a path: a Windows path's backslashes are escapes in the line). @param {string} gate */
const exitsOn = (gate) => `node -e "const fs=require('fs');setInterval(()=>fs.existsSync('${gate}')&&process.exit(0),50)"`;
const sleepMs = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const lastSaid = (/** @type {any} */ body) => JSON.stringify((body?.messages || []).at(-1)?.content ?? "");

/** @type {any} */ let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */ let shim;
/** @type {string} */ let root;
/** @param {string} id */
const transcript = async (id) => /** @type {any} */ (await (await shim.api(`/api/sessions/${id}/transcript`)).json());
/** @param {string} id @param {number} n */
const turnsDone = (id, n) =>
  until(async () => {
    const t = await transcript(id);
    return (t.turns || []).length >= n && t.turns.slice(0, n).every((/** @type {any} */ x) => x.final) ? t : null;
  }, `the chat's turn ${n}`, { timeoutMs: 20_000 });
const chat = async () => String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } })).json()).id);
/** @param {string} id @param {string} content */
const send = async (id, content) => {
  const r = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content, stream: false } });
  assert.equal(r.status, 200, await r.clone().text());
};
/** A turn of Filament's own asked of the chat, as its wakers ask (server.js `postOwnTurn`). @param {string} id @param {Record<string, unknown>} own */
const ask = (id, own) => shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { ...own, stream: false } });
/** The chat archived, or brought back, as the page does it. @param {string} id @param {boolean} on */
const archive = async (id, on) => {
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { display: { archived: on } } } });
  assert.equal(r.status, 200, await r.clone().text());
};
const owedOf = (/** @type {string} */ id) => shim.app.memory.archive?.metaOf(id, ["owedWakes"])?.owedWakes;
/** @param {unknown} minutes */
const setMinutes = async (minutes) => {
  const cfg = (await (await shim.api("/api/state")).json()).config;
  const r = await shim.api("/api/config", { method: "PUT", body: { ...cfg, sessions: { ...cfg.sessions, idleWakeMinutes: minutes } } });
  assert.equal(r.status, 200, await r.clone().text());
};

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-wake-archived-"));
  up = await fakeUpstream(async (call) => {
    if (call.kind !== "anthropic") return undefined;
    if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
    const last = lastSaid(call.body);
    const round = /goal round (\d+) of \d+/.exec(last);
    if (round) return anthropicReply(`Round ${round[1]}: the parser ships.\n\n[goal: done]`, { model: "m-1" });
    if (last.includes(IDLE_WAKE_LINE.slice(0, 60))) return anthropicReply("HEARD-idle", { model: "m-1" });
    if (last.includes(WAKE_LINE.slice(0, 60)) || last.includes(ANY_WAKE_LINE.slice(0, 60))) return anthropicReply("HEARD-exit", { model: "m-1" });
    const gate = /start the build at (\S+?)\./.exec(last)?.[1];
    if (gate) return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: `b-${gate}`, name: "bash_background", input: { command: exitsOn(gate) } }] });
    return anthropicReply("OK.", { model: "m-1" });
  });
  shim = await startApp({
    memory: true,
    overrides: { idleWakeMinuteMs: MINUTE_MS },
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
      // 60 "minutes" of 400 ms: no check-in comes within a test that does not set its own.
      cfg.sessions = { ...cfg.sessions, idleWakeMinutes: 60 };
    },
  });
});
after(async () => {
  await shim?.stop();
  await up?.close();
  await removeDirs(shim?.dataDir, root);
});

test("a chat archived while its command runs: the command's end starts no turn; brought back, nothing starts for what waited; the person's next message carries the end", async () => {
  const id = await chat();
  await send(id, "start the build at gate-a.");
  await archive(id, true);
  writeFileSync(join(root, "gate-a"), "");
  // Its end came: kept untold for the agent, or — the defect — told in a turn Filament started for it.
  await until(async () => (owedOf(id)?.untold || []).some((/** @type {any} */ x) => x.code === 0) || (await transcript(id)).turns.length > 1 || null, "the command's end", { timeoutMs: 20_000 });
  await sleepMs(1500);
  assert.equal((await transcript(id)).turns.length, 1, "archived: no turn of Filament's");
  await archive(id, false);
  await sleepMs(1500);
  assert.equal((await transcript(id)).turns.length, 1, "brought back: what waited starts nothing");
  await send(id, "hello again");
  const t = await turnsDone(id, 2);
  assert.equal(t.turns[1].woke, undefined, "the person's own turn");
  assert.match(JSON.stringify(t.turns[1].user), /background shell bg_[0-9a-z]+ \(node -e .*\) exited with code 0/);
  assert.equal(owedOf(id)?.untold, undefined, "told, and kept owed no more");
});

test("an idle check-in starts no turn in an archived chat, and is set again; brought back, it comes at its next time, its minutes counted from the turn's end", async () => {
  await setMinutes(2);
  try {
    const id = await chat();
    await send(id, "start the build at gate-b.");
    await archive(id, true);
    // Three of its waits pass: held each time, and set again.
    await sleepMs(3 * 2 * MINUTE_MS + 300);
    assert.equal((await transcript(id)).turns.length, 1, "archived: no turn of Filament's");
    assert.deepEqual([(owedOf(id)?.untold || []).length, owedOf(id)?.idle?.at > Date.now() - 2 * MINUTE_MS], [0, true], `nothing told, and set again: ${JSON.stringify(owedOf(id))}`);
    await archive(id, false);
    const t = await turnsDone(id, 2);
    assert.equal(t.turns[1].woke, true, "a turn of Filament's");
    const said = JSON.stringify(t.turns[1].user);
    assert.ok(said.includes(IDLE_WAKE_LINE), said);
    const min = Number(/\[Filament: (\d+) min since your turn ended/.exec(said)?.[1]);
    assert.ok(min >= 6, `counted from the turn's end, three waits of 2 min ago at least: ${min} min`);
    assert.match(JSON.stringify(t.turns[1].final), /HEARD-idle/);
  } finally {
    writeFileSync(join(root, "gate-b"), "");
    await setMinutes(60);
  }
});

test("the wake's own route refuses an archived chat, and says why; what waited is still there for the chat brought back", async () => {
  const id = await chat();
  await send(id, "hello");
  // A command's end waits untold for the chat, its wake not yet sent (hands.js `tellLater`'s `now: false`).
  tellLater({ session: id, agent: null }, { id: "bg_arch", command: "npm test", code: 0, text: "[Filament: background shell bg_arch (npm test) exited with code 0.]" }, { now: false });
  await archive(id, true);
  const refused = await ask(id, { wake: true });
  assert.deepEqual([refused.status, /** @type {any} */ (await refused.json()).wake], [409, "archived"]);
  assert.equal((await transcript(id)).turns.length, 1, "no turn of Filament's");
  await archive(id, false);
  const woke = await ask(id, { wake: true });
  assert.equal(woke.status, 200, await woke.clone().text());
  const t = await turnsDone(id, 2);
  assert.equal(t.turns[1].woke, true);
  assert.match(JSON.stringify(t.turns[1].user), /background shell bg_arch \(npm test\) exited with code 0\./);
  assert.match(JSON.stringify(t.turns[1].final), /HEARD-exit/);
});

test("a goal's round is refused in an archived chat and stays owed; brought back, the round goes when it is asked for", async () => {
  const id = await chat();
  await send(id, "hello");
  /** @type {any} */ (shim.app).memory.setGoal(id, { ...newGoal("the parser ships", { now: Date.now() }), status: "active", acceptedAt: Date.now(), drive: { on: true, round: 1, cap: 20, halted: null } });
  assert.equal(shim.app.sessions.oweGoal(id), true, "its next round is owed");
  await archive(id, true);
  const refused = await ask(id, { goal: true });
  assert.deepEqual([refused.status, /** @type {any} */ (await refused.json()).wake], [409, "archived"]);
  assert.deepEqual([(await transcript(id)).turns.length, shim.app.sessions.goalOwed(id), /** @type {any} */ (shim.app).memory.goalFor(id)?.drive?.halted], [1, true, null], "no round, still owed, the drive not halted");
  await archive(id, false);
  const round = await ask(id, { goal: true });
  assert.equal(round.status, 200, await round.clone().text());
  const t = await turnsDone(id, 2);
  assert.match(JSON.stringify(t.turns[1].user), /goal round 2 of 20/);
  assert.equal(shim.app.sessions.goalOwed(id), false, "its turn took it");
});

/** Whether the list the sidebar reads holds the chat (its `GET /api/memory/sessions`, the archived left out). @param {string} id */
const listed = async (id) => ((await (await shim.api("/api/memory/sessions?limit=200&kind=interactive,fork")).json()).sessions || []).some((/** @type {any} */ s) => s.id === id);
/** Whether the chat lies archived: its settings' own word, and the mark the rule reads. @param {string} id */
const archivedNow = async (id) => [(await (await shim.api(`/api/sessions/${encodeURIComponent(id)}`)).json()).inForce?.archived === true, shim.app.sessions.notByItself(id)];

// (fails before: yes — a message of the person's left the chat archived: the command its agent started and ended its
// turn on ended untold, and nothing woke it)
test("the person writes in a chat they archived: it comes back out of the archive, the list has it again once the feed says its turn let go, and what its agent starts from there wakes it", async () => {
  const id = await chat();
  await send(id, "hello");
  await archive(id, true);
  assert.deepEqual([await archivedNow(id), await listed(id)], [[true, "the person archived it"], false], "archived, and out of the list");
  /** What the feed said of the chat's turns and its settings, in order. @type {string[]} */
  const fed = [];
  const unhear = [
    shim.app.events.subscribe("turns", (/** @type {any} */ p) => void (p?.type === "turn" && p.chainId === id && fed.push(p.holder ? "held" : "let go"))),
    shim.app.events.subscribe("settings", (/** @type {any} */ p) => void (p?.type === "settings" && p.chainId === id && fed.push("settings"))),
  ];
  try {
    await send(id, "start the build at gate-w.");
    assert.deepEqual(await archivedNow(id), [false, null], "in use again: out of the archive");
    // The page's list reads again as a turn lets go (sidebar.js `loadSoon`): by then the chat is back, and the read has it.
    await until(() => (fed.includes("let go") ? true : null), "the feed's word that the turn let go");
    assert.ok(fed.indexOf("settings") >= 0 && fed.indexOf("settings") < fed.indexOf("let go"), `its settings moved before its turn let go: ${fed.join(", ")}`);
    assert.equal(await listed(id), true, "in the list again");
    // Its agent ended its turn on a command still running: the command's end wakes it, as in any chat.
    writeFileSync(join(root, "gate-w"), "");
    const t = await turnsDone(id, 3);
    assert.equal(t.turns[2].woke, true, "a turn of Filament's");
    assert.match(JSON.stringify(t.turns[2].final), /HEARD-exit/);
  } finally {
    for (const off of unhear) off();
    writeFileSync(join(root, "gate-w"), "");
  }
});

// (fails before: in its last line alone, where the person's own message brings the chat back; the turns of Filament's
// own left it archived then as now, pinned here beside the person's)
test("a turn that is not the person's own writing never brings a chat back: a sync from the Space, and a message sent with nobody there, leave it archived", async () => {
  const id = await chat();
  await send(id, "hello");
  await archive(id, true);
  // A sync the Space sent (core/space.js): Filament's message, on the person's click elsewhere.
  const sync = await ask(id, { by: "sync", content: `${SYNC_HEAD}, which the person ran just now. The board as it stands: nothing new.]` });
  assert.equal(sync.status, 200, await sync.clone().text());
  await turnsDone(id, 2);
  assert.deepEqual([await archivedNow(id), await listed(id)], [[true, "the person archived it"], false], "a sync's turn: still archived");
  // The person's words sent with nobody there (a replay in a copy): theirs, and not their writing in the chat now.
  const replay = await ask(id, { content: "hello again", unattended: true });
  assert.equal(replay.status, 200, await replay.clone().text());
  await turnsDone(id, 3);
  assert.deepEqual([await archivedNow(id), await listed(id)], [[true, "the person archived it"], false], "nobody there: still archived");
  // A wake asked of it is refused as before, and the person's own message then brings it back.
  tellLater({ session: id, agent: null }, { id: "bg_back", command: "npm test", code: 0, text: "[Filament: background shell bg_back (npm test) exited with code 0.]" }, { now: false });
  const refused = await ask(id, { by: "wake" });
  assert.deepEqual([refused.status, /** @type {any} */ (await refused.json()).wake], [409, "archived"]);
  await send(id, "back again");
  assert.deepEqual(await archivedNow(id), [false, null], "the person's own message");
});

// (fails before: yes — a team's own chat lies archived with the chat it runs beside, by that chat's word alone: a
// message written in the team's chat left both archived)
test("the person writes in a team's own chat beside a chat they archived: the two come back together, as they were archived", async () => {
  const main = await chat();
  await send(main, "hello");
  const team = String(/** @type {any} */ (shim.app).sessions.create({ cwd: root, model: "m-1", preset: "plain", kind: "team", beside: main }).id);
  await send(team, "hello");
  await archive(main, true);
  assert.deepEqual([shim.app.sessions.notByItself(main), shim.app.sessions.notByItself(team)], ["the person archived it", "the person archived it"], "archived together");
  await send(team, "hello again");
  assert.deepEqual([await archivedNow(main), shim.app.sessions.notByItself(team), await listed(main)], [[false, null], null, true], "back together");
});
