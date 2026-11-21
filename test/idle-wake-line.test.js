// @ts-check
// The line of the turn Filament sends as its check-in on an idle agent (sessions/wake.js `IDLE_WAKE_LINE`) says that
// nothing came since the agent's turn ended. It is true where the turn carries the check-in alone, and said only there:
// a letter that waits sealed, whose own line follows, or a word queued for the agent that woke nothing and rides ahead,
// did come, and the line then says the check-in without that word (`IDLE_BESIDE_WAKE_LINE`). With another command's
// end or an agent's report the wake says what came in its words for several, as it did. Through a real Filament, each
// combination staged as it stands when the wake's turn is asked for: the check-in told (hands.js `tellLater`), the rest
// kept by the registry.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { ANY_WAKE_LINE, IDLE_BESIDE_WAKE_LINE, IDLE_WAKE_LINE, LETTER_WAKE_LINE, REPORT_WAKE_LINE, WAKE_LINE, isWakeMessage, wakeLineFor } from "../src/app/sessions/wake.js";
import { idleText } from "../src/app/sessions/idle-wake.js";
import { tellLater } from "../src/adapters/tools/hands.js";

/** Every line a wake's turn of these tests may say. */
const LINES = [WAKE_LINE, ANY_WAKE_LINE, REPORT_WAKE_LINE, IDLE_WAKE_LINE, IDLE_BESIDE_WAKE_LINE, LETTER_WAKE_LINE];
/** The words that say nothing came: the line's, and the check-in's own. */
const NOTHING_CAME = /nothing came since|Nothing else came meanwhile/;

describe("the check-in's line", () => {
  // (fails before: yes — one line for every check-in, which said that nothing came)
  test("alone it says that nothing came since; with something beside it, the same less that word; both are Filament's", () => {
    assert.equal(
      IDLE_WAKE_LINE,
      "[Filament: you ended your turn while a background command of yours still runs, and nothing came since; Filament's check-in is above. Read its output so far and say in a line where it stands: wait on if it is working, or stop it if it hangs and go on with your work.]",
    );
    assert.equal(
      IDLE_BESIDE_WAKE_LINE,
      "[Filament: you ended your turn while a background command of yours still runs; Filament's check-in is above. Read its output so far and say in a line where it stands: wait on if it is working, or stop it if it hangs and go on with your work.]",
    );
    assert.equal(wakeLineFor("idle"), IDLE_WAKE_LINE, "by its kind alone: what its turn carries beside it is the service's to know");
    for (const l of [IDLE_WAKE_LINE, IDLE_BESIDE_WAKE_LINE]) assert.ok(isWakeMessage({ role: "user", content: [{ type: "text", text: "[Filament: 5 min since your turn ended, …]" }, { type: "text", text: l }] }), l);
  });
});

describe("the check-in's turn, through Filament", () => {
  /** @type {any} */ let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */ let shim;
  /** @type {string} */ let root;
  let seq = 0;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-idle-line-"));
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
      return anthropicReply("OK.", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
        // No check-in of the waker's own: each test tells its check-in itself.
        cfg.sessions = { ...cfg.sessions, idleWakeMinutes: 0 };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(shim?.dataDir, root);
  });

  /** @param {string} id */
  const transcript = async (id) => /** @type {any} */ (await (await shim.api(`/api/sessions/${id}/transcript`)).json());
  /** @param {string} id @param {number} n */
  const turnsDone = (id, n) =>
    until(async () => {
      const t = await transcript(id);
      return (t.turns || []).length >= n && t.turns.slice(0, n).every((/** @type {any} */ x) => x.final) ? t : null;
    }, `the chat's turn ${n}`, { timeoutMs: 20_000 });
  /** A chat whose agent has had a turn. */
  const chat = async () => {
    const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } })).json()).id);
    const r = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    return id;
  };
  const registry = () => /** @type {any} */ (shim.app).subagents;
  /** What can wait for a chat as its check-in's turn is asked for, each as the code that keeps it does. */
  const staged = {
    /** Filament's check-in, told and not yet sent (hands.js `tellLater`'s `now: false`). @param {string} id */
    checkIn: (id) =>
      tellLater(
        { session: id, agent: null },
        { id: `idle-${++seq}`, command: "", code: null, kind: "idle", text: idleText([{ id: "bg_dev", command: "npm run dev", startedAt: Date.now() - 7 * 60_000 }], { idleMin: 5, nextMin: 10, now: Date.now() }) },
        { now: false },
      ),
    /** Another command's end. @param {string} id */
    exit: (id) => {
      const bg = `bg_e${++seq}`;
      tellLater({ session: id, agent: null }, { id: bg, command: "npm test", code: 0, text: `[Filament: background shell ${bg} (npm test) exited with code 0.]` }, { now: false });
    },
    /** A graph's word that wakes the chat, as its runner tells it. @param {string} id */
    report: (id) => registry().tell(id, { text: "[Filament: t1 is done]", from: "", description: "the task graph", spends: [], wrote: false, wakes: true }),
    /** A graph task's end held for the graph's other workers: queued, waking nothing. @param {string} id */
    held: (id) => registry().tell(id, { text: "[Filament: t1 is done]", from: "", description: "the task graph", spends: [], wrote: false, wakes: false, held: true }),
    /** A letter from another chat, sealed while no turn runs. @param {string} id @param {string} from */
    letter: (id, from) => assert.deepEqual(registry().letter(id, { text: "Is 7 prime?", from, description: "The other chat", sender: 'the chat "The other chat"', subject: "A question" }), { ok: true, at: "sealed" }),
  };
  /**
   * The wake's turn of a chat, once it ended: Filament's lines in it, in their order, and its message whole. `ask`: the
   * wake's own route is asked — where nothing staged wakes the chat by itself.
   * @param {string} id @param {{ ask?: boolean }} [o]
   */
  const woken = async (id, { ask = false } = {}) => {
    if (ask) {
      const r = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { by: "wake", stream: false } });
      assert.equal(r.status, 200, await r.clone().text());
    }
    const t = await turnsDone(id, 2);
    assert.equal(t.turns[1].woke, true, "a turn of Filament's");
    const content = t.turns[1].user?.content;
    const texts = (Array.isArray(content) ? content : [{ type: "text", text: String(content ?? "") }]).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text));
    return { lines: texts.filter((x) => LINES.includes(x)), said: texts.join("\n") };
  };

  // (fails before: yes — fxl1's left: the check-in said "Nothing else came meanwhile." itself, whatever rode with it)
  test("the check-in alone: its line says that nothing came since, and the check-in itself says nothing of it", async () => {
    const id = await chat();
    staged.checkIn(id);
    const { lines, said } = await woken(id, { ask: true });
    assert.deepEqual(lines, [IDLE_WAKE_LINE]);
    assert.doesNotMatch(said, /Nothing else came/, "the line's word alone");
  });

  // (fails before: yes — the line said "nothing came since", and the letter's line after it said a letter came)
  test("with a letter that waits sealed: the line says the check-in without that word, and the letter's line follows", async () => {
    const other = await chat();
    const id = await chat();
    staged.checkIn(id);
    staged.letter(id, other);
    const { lines, said } = await woken(id);
    assert.deepEqual(lines, [IDLE_BESIDE_WAKE_LINE, LETTER_WAKE_LINE]);
    assert.doesNotMatch(said, NOTHING_CAME);
  });

  // (fails before: yes — a word queued that woke nothing rode ahead of the line, which said that nothing came)
  test("with a word queued for the agent that woke nothing: it rides ahead, and the line says the check-in without that word", async () => {
    const id = await chat();
    staged.held(id);
    staged.checkIn(id);
    const { lines, said } = await woken(id, { ask: true });
    assert.deepEqual(lines, [IDLE_BESIDE_WAKE_LINE]);
    assert.match(said, /\[Filament: t1 is done\]/, "the queued word, in the same message");
    // (fails before: yes — fxl1's left: the check-in still said "Nothing else came meanwhile." beside the word)
    assert.doesNotMatch(said, NOTHING_CAME);
  });

  test("with an agent's report: the wake says what came in its words for several, nothing of nothing", async () => {
    const id = await chat();
    staged.checkIn(id);
    staged.report(id);
    const { lines, said } = await woken(id);
    assert.deepEqual(lines, [ANY_WAKE_LINE]);
    assert.doesNotMatch(said, NOTHING_CAME);
  });

  test("with an agent's report and a letter: the words for several, then the letter's line", async () => {
    const other = await chat();
    const id = await chat();
    staged.checkIn(id);
    staged.report(id);
    staged.letter(id, other);
    const { lines, said } = await woken(id);
    assert.deepEqual(lines, [ANY_WAKE_LINE, LETTER_WAKE_LINE]);
    assert.doesNotMatch(said, NOTHING_CAME);
  });

  test("with another command's end: the words for several", async () => {
    const id = await chat();
    staged.exit(id);
    staged.checkIn(id);
    const { lines, said } = await woken(id, { ask: true });
    assert.deepEqual(lines, [ANY_WAKE_LINE]);
    assert.doesNotMatch(said, NOTHING_CAME);
  });

  test("with another command's end and a letter: the words for several, then the letter's line", async () => {
    const other = await chat();
    const id = await chat();
    staged.exit(id);
    staged.checkIn(id);
    staged.letter(id, other);
    const { lines, said } = await woken(id);
    assert.deepEqual(lines, [ANY_WAKE_LINE, LETTER_WAKE_LINE]);
    assert.doesNotMatch(said, NOTHING_CAME);
  });
});
