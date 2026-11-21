// @ts-check
// The idle wake through a real Filament (sessions/idle-wake.js, the owner's of 11-08: "if filament goes idle when you
// stop the turn, filament needs to wake it back up after let's say 5 minutes so that you are not stuck forever";
// narrowed: "not wake up on open tasks but just when background command is running"). A chat's agent that ends its turn
// while its background command runs is sent Filament's turn after the minutes set — here a "minute" is 400 ms
// (`overrides.idleWakeMinuteMs`) —; the command's end, the person's message and their Stop each drop it; a coding
// agent's own background shell counts too.
// (fails before: yes — nothing woke an agent that ended its turn while its command ran on and never ended)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until } from "./helpers/wait.js";
import { ANY_WAKE_LINE, IDLE_WAKE_LINE, WAKE_LINE } from "../src/app/sessions/wake.js";
import { endChatShells, startCommandShell } from "../src/adapters/tools/hands.js";
import { transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { deliveredWords } from "../src/ui/harness/conversation/turn.js";

const MINUTE_MS = 400;
/** A coding agent as Claude Code's SDK speaks: `~wake` ends a background task of its own after its turn, and it goes on. */
const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");
/** A command that runs until the test lets it end, by the file `gate` in the chat's folder (a name, not a path: a Windows path's backslashes are escapes in the line): one that slept raced the turns on a busy machine. @param {string} gate */
const exitsOn = (gate) => `node -e "const fs=require('fs');setInterval(()=>fs.existsSync('${gate}')&&process.exit(0),50)"`;
const sleepMs = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @type {any} */ let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */ let shim;
/** @type {string} */ let root;
/** The idle wake as the `turns` topic said it, per chat, in order. @type {Map<string, any[]>} */
const heard = new Map();
/** @type {() => void} */ let off = () => {};
const said = (/** @type {any} */ body) => JSON.stringify(body?.messages || []);
const lastSaid = (/** @type {any} */ body) => JSON.stringify((body?.messages || []).at(-1)?.content ?? "");
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
  return r;
};
/** @param {unknown} minutes */
const setMinutes = async (minutes) => {
  const cfg = (await (await shim.api("/api/state")).json()).config;
  const r = await shim.api("/api/config", { method: "PUT", body: { ...cfg, sessions: { ...cfg.sessions, idleWakeMinutes: minutes } } });
  assert.equal(r.status, 200, await r.clone().text());
};

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-idle-"));
  up = await fakeUpstream(async (call) => {
    if (call.kind !== "anthropic") return undefined;
    if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
    const last = lastSaid(call.body);
    if (last.includes(IDLE_WAKE_LINE.slice(0, 60))) return anthropicReply("Still building; I'll wait on it.", { model: "m-1" });
    if (last.includes(WAKE_LINE.slice(0, 60)) || last.includes(ANY_WAKE_LINE.slice(0, 60))) return anthropicReply("The build is done.", { model: "m-1" });
    const gate = /start the build at (\S+?)\./.exec(last)?.[1];
    if (gate) return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: `b-${gate.length}`, name: "bash_background", input: { command: exitsOn(gate) } }] });
    return anthropicReply("Started; waiting on it.", { model: "m-1" });
  });
  shim = await startApp({
    memory: true,
    overrides: { idleWakeMinuteMs: MINUTE_MS },
    configure: (cfg) => {
      cfg.upstreams = [
        { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
        { id: "claude", name: "Claude Code", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_CLAUDE: "1" }, cwdDefault: root, permissions: "allow-all", hints: false } },
      ];
      cfg.routes = [
        { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
        { match: "claude/*", upstream: "claude", upstreamModel: "{1}", enabled: true },
      ];
      cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      cfg.sessions = { ...cfg.sessions, idleWakeMinutes: 1 };
    },
  });
  off = /** @type {any} */ (shim.app).events.subscribe("turns", (/** @type {any} */ m) => {
    if (m?.type === "idle-wake") heard.set(m.chainId, [...(heard.get(m.chainId) || []), m.idleWake]);
  });
});
after(async () => {
  off();
  await shim?.stop();
  await up?.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test("a turn that ends with its command running: Filament's turn after the minute, naming the command; again later, twice as late; the command's end drops it, and nothing comes after", async () => {
  const id = await chat();
  await send(id, "start the build at gate-a.");
  const tr = await turnsDone(id, 2);
  assert.equal(tr.turns[1].woke, true, "a turn of Filament's");
  assert.ok(JSON.stringify(tr.turns[1].user).includes(IDLE_WAKE_LINE), "in its words for a check-in");
  assert.deepEqual([tr.turns[1].shellExits, tr.turns[1].shellIdle], [1, 1]);
  assert.equal(deliveredWords(transcriptTurns(tr)[1]), "with Filament's check-in on a running command", "no command's end");
  const read = up.received.map((/** @type {any} */ c) => said(c.body)).find((/** @type {string} */ s) => s.includes("since your turn ended"));
  assert.match(String(read), /\[Filament: 1 min since your turn ended, your background command still runs with no end: `node -e \\"const fs=require\('fs'\);[^`]*` \(bg_[0-9a-z]+, running 1 min\)\. If it keeps running, Filament checks in again in 2 min\.\]/);
  assert.ok((heard.get(id) || []).some((w) => w?.commands?.length === 1), "the page was told when it is due");

  // The command ends: its own end wakes the agent — with a check-in that came at the same moment, in one turn —, and
  // with nothing running after it nothing is armed.
  writeFileSync(join(root, "gate-a"), "");
  const done = /** @type {any} */ (
    await until(async () => {
      const t = await transcript(id);
      const at = (t.turns || []).findIndex((/** @type {any} */ x) => [WAKE_LINE, ANY_WAKE_LINE].some((w) => JSON.stringify(x.user).includes(w)));
      return at > 0 && t.turns.slice(at).every((/** @type {any} */ x) => x.final) ? t : null;
    }, "the command's end's turn", { timeoutMs: 20_000 })
  );
  await sleepMs(4 * MINUTE_MS);
  assert.equal((await transcript(id)).turns.length, done.turns.length, "nothing after the command's end");
  assert.equal((heard.get(id) || []).at(-1), null, "the page told nothing is due");
});

test("the person's message drops it and starts the back-off again; their Stop drops it, and nothing comes", async () => {
  await setMinutes(5);
  try {
    const id = await chat();
    await send(id, "start the build at gate-bb.");
    await until(() => (heard.get(id) || []).at(-1)?.at || null, "armed as the turn ended");
    const first = (heard.get(id) || []).at(-1).at;
    // A page that opens later reads it: the transcript, and the holders read every page makes.
    assert.equal((await transcript(id)).idleWake?.at, first, "the transcript carries it");
    const holders = /** @type {any} */ (await (await shim.api("/api/sessions/holders")).json());
    assert.deepEqual(holders.idleWakes.filter((/** @type {any} */ x) => x.chainId === id).map((/** @type {any} */ x) => x.idleWake.at), [first], "the holders read lists it");
    await send(id, "how is it going?");
    await until(() => ((heard.get(id) || []).at(-1)?.at > first ? true : null), "armed again as the message's turn ended");
    assert.ok((heard.get(id) || []).includes(null), "the message's turn dropped the first");
    const stop = await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200, await stop.clone().text());
    assert.equal((heard.get(id) || []).at(-1), null, "the Stop dropped it");
    await sleepMs(6 * MINUTE_MS + 300);
    assert.equal((await transcript(id)).turns.length, 2, "no turn of Filament's after the Stop");
    endChatShells(id);
  } finally {
    await setMinutes(1);
  }
});

test("0 turns it off: a turn that ends with its command running arms nothing", async () => {
  await setMinutes(0);
  try {
    const id = await chat();
    await send(id, "start the build at gate-ccc.");
    await sleepMs(3 * MINUTE_MS);
    assert.equal((heard.get(id) || []).filter(Boolean).length, 0);
    assert.equal((await transcript(id)).turns.length, 1);
    endChatShells(id);
  } finally {
    await setMinutes(1);
  }
});

test("a coding agent's own background shell counts — its sub-agent does not", async () => {
  const acp = /** @type {any} */ (shim.app).acp;
  const id = await chat();
  acp.onTasks({ chain: id, sessionId: "agent-x", tasks: [{ id: "t-agent", kind: "local_agent", description: "Explore", background: true, since: Date.now() }] });
  await send(id, "anything running?");
  await sleepMs(3 * MINUTE_MS);
  assert.equal((await transcript(id)).turns.length, 1, "a sub-agent's end wakes its agent by itself");
  acp.onTasks({ chain: id, sessionId: "agent-x", tasks: [{ id: "t-dev", kind: "local_bash", description: "npm run dev", background: true, since: Date.now() - 3 * 60_000 }] });
  await send(id, "and now?");
  const tr = await turnsDone(id, 3);
  assert.equal(tr.turns[2].woke, true);
  const read = up.received.map((/** @type {any} */ c) => said(c.body)).filter((/** @type {string} */ s) => s.includes("`npm run dev` (t-dev, running 3 min)"));
  assert.ok(read.length > 0, "named by its description and id");
  acp.onTasks({ chain: id, sessionId: "agent-x", tasks: [] });
});

// (fails before: yes — the owner's of 11-08: the waker counted a coding agent's own shell in a chat moved off that agent,
// and woke the agent the chat runs on now to be told of a shell in another's session)
test("a coding agent's own background shell in a chat that runs on another now does not count", async () => {
  const acp = /** @type {any} */ (shim.app).acp;
  const id = await chat();
  acp.onTasks({ chain: id, sessionId: "agent-old", upstream: "claude", tasks: [{ id: "t-old", kind: "local_bash", description: "npm run serve", background: true, since: Date.now() - 3 * 60_000 }] });
  try {
    await send(id, "anything running?");
    await sleepMs(3 * MINUTE_MS);
    assert.equal((await transcript(id)).turns.length, 1, "Claude's shell runs in Claude's session: the loop is not woken for it");
  } finally {
    acp.onTasks({ chain: id, sessionId: "agent-old", upstream: "claude", tasks: [] });
  }
});

// (fails before: yes — the end of a coding agent's own cycle, Claude going on as its own task ended, armed nothing: an
// agent whose own task woke it and that ended its turn there waited on the command forever)
test("a coding agent's own turn — Claude going on as its own task ended — arms it as any turn's end does", async () => {
  await setMinutes(5);
  const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "claude/haiku", preset: "plain" } });
  assert.equal(made.status, 200, await made.clone().text());
  const id = String((await made.json()).id);
  startCommandShell(exitsOn("gate-own"), root, { session: id, agent: null }, { onEnd: () => {} });
  try {
    const r = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "~wake please", stream: true, runEvents: true } });
    assert.equal(r.status, 200, await r.clone().text());
    await r.text();
    const tr = /** @type {any} */ (
      await until(async () => {
        const t = await transcript(id);
        const own = (t.turns || []).findIndex((/** @type {any} */ x) => x.own);
        return own > 0 && t.turns.slice(own + 1).some((/** @type {any} */ x) => JSON.stringify(x.user).includes(IDLE_WAKE_LINE)) ? t : null;
      }, "Filament's check-in after the agent's own turn", { timeoutMs: 30_000 })
    );
    const own = tr.turns.findIndex((/** @type {any} */ x) => x.own);
    assert.ok(!tr.turns.slice(0, own).some((/** @type {any} */ x) => JSON.stringify(x.user).includes(IDLE_WAKE_LINE)), "its own turn came first, and dropped the one its first turn's end armed");
  } finally {
    endChatShells(id);
    await setMinutes(1);
  }
});

// (fails before: yes — the bug hunt of 11-08: a chat deleted with its check-in armed kept it, the page's holders read
// listing it until its time came, and that time told a chat that is gone of a command)
test("a chat deleted while its check-in is armed drops it", async () => {
  await setMinutes(5);
  const acp = /** @type {any} */ (shim.app).acp;
  const id = await chat();
  acp.onTasks({ chain: id, sessionId: "agent-gone", tasks: [{ id: "t-gone", kind: "local_bash", description: "npm run watch", background: true, since: Date.now() }] });
  try {
    await send(id, "anything running?");
    await until(() => (heard.get(id) || []).at(-1)?.at || null, "armed as the turn ended");
    const del = await shim.api(`/api/memory/sessions/${encodeURIComponent(id)}/delete`, { method: "POST", body: {} });
    assert.equal(del.status, 200, await del.clone().text());
    assert.equal((heard.get(id) || []).at(-1), null, "the page told nothing is due");
    const holders = /** @type {any} */ (await (await shim.api("/api/sessions/holders")).json());
    assert.deepEqual(holders.idleWakes.filter((/** @type {any} */ x) => x.chainId === id), [], "the holders read lists it no more");
  } finally {
    acp.onTasks({ chain: id, sessionId: "agent-gone", tasks: [] });
    await setMinutes(1);
  }
});
