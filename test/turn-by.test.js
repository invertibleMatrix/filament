// @ts-check
// Who begins a chat's turn (core/turn-by.js): the person, one of Filament's own — a wake, a goal's round, a restart's
// resume, a sync, a team's or a flow's result, a flow's line to its team box, a thread's brief, a watcher's wake, a
// watcher's guidance, a routine's run, a Space ask's run, a team's opening — or a coding agent by itself. One table says what each is; the
// turn's row keeps who began it (`meta.by`); one reader reads it back.
// The characterisation table runs each kind as its real caller posts it, through a running Filament, and reads what the
// turn did: when the person last wrote (`personAt`), a driving goal halted as by their words, the chat's letters heard,
// the room made for the person's message taken, the compaction question asked, the transcript's mark. The kinds that
// were already marked by a flag behave as they did; a routine's run, a Space ask's run and a team's opening — posted
// with no flag, and so counted as the person's — no longer do.
// (fails before: yes for the rows of a routine's run, a Space ask's run and a team's opening (`personAt` stamped,
// letters heard), the room's sync and team's result (taken: drift), the let-go and the browser's driver (sync, team's
// result and flow's line: drift), every `by` row, a pasted wake line drawn as the person's, a brief counted in
// `personLast`, the marks, the callers' `by`, and the module's own tests; no for the other characterisation rows, which
// guard what the flags did)
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { WAKE_LINE } from "../src/app/sessions/wake.js";
import { tellLater } from "../src/adapters/tools/hands.js";
import { newGoal } from "../src/services/memory/goal.js";
import { SYNC_HEAD } from "../src/core/space.js";
import { resultMessage } from "../src/core/beside.js";
import { FLOW_GO_ON } from "../src/core/flow.js";
import { guideWords, routineFields, wakeWords } from "../src/core/routines.js";
import { estimateTokens } from "../src/core/tokens.js";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/** A message's words, its text blocks alone. @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (Array.isArray(m?.content) ? m.content : []).map((/** @type {any} */ b) => (b?.type === "text" ? b.text : "")).join(""));
const SYNC = `${SYNC_HEAD}, which the person ran just now. The board as it stands: nothing new.]`;
const RESULT = resultMessage({ name: "Bughunters", ask: "find bugs in the parser", firedBy: "you", result: "Found nothing.", auto: false });
const WATCHED = wakeWords({ id: "r9", title: "Supervisor", task: "Read its turn; say where it drifted." }, { project: "P", when: "a turn of this chat ends", by: "you" });
const GUIDED = guideWords({ id: "r9", title: "Supervisor" }, { project: "P", byName: "Lead", text: "You drifted: the parser, not the lexer." });
/** The transcript's marks of who began a turn, as the page draws each. */
const MARKS = ["resumed", "woke", "goalRound", "synced", "teamResult", "flowEnd", "flowDrive", "brief", "watched", "guided", "flowSaid", "own"];
/** The reply's size, in characters, that weighs about `tokens` as Filament estimates it. @param {number} tokens */
const charsFor = (tokens) => Math.ceil(tokens / (estimateTokens("y".repeat(10_000)) / 10_000));

describe("who begins a turn, through a running Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-turn-by-"));
  /** The characters of a reply asked for with BIG: set once the window is measured. */
  let bigChars = 4000;
  const S = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** @param {string} path @param {any} [body] @param {string} [method] */
  const call = async (path, body, method = body === undefined ? "GET" : "POST") => {
    const r = await shim.api(path, { method, ...(body === undefined ? {} : { body }) });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: r.status, json, text };
  };
  const app = () => /** @type {any} */ (shim.app);
  const archive = () => app().memory.archive;
  /** @param {string} id */
  const transcript = async (id) => (await call(`${S(id)}/transcript`)).json;
  /** A chat of the person's, on `model`. @param {string} [model] */
  const chat = async (model = "m-1") => {
    const r = await call("/api/sessions", { cwd: root, model, preset: "plain" });
    assert.equal(r.status, 200, r.text);
    return String(r.json.id);
  };
  /** A turn posted as its caller posts it, waited out. @param {string} id @param {Record<string, unknown>} body */
  const post = async (id, body) => {
    const r = await call(`${S(id)}/turns`, { ...body, stream: false });
    await until(() => (!app().sessions.besideFacts(id).busy ? true : null), `chat ${id} let go`, { timeoutMs: 20_000 });
    return r;
  };
  /** The person's message. @param {string} id @param {string} words */
  const say = async (id, words) => {
    const r = await post(id, { content: words });
    assert.equal(r.status, 200, r.text);
  };
  /** A team's own chat beside `main`, as a fire makes it. @param {string} main */
  const teamChat = (main) => String(app().sessions.create({ cwd: root, model: "m-1", kind: "team", beside: main, preset: "plain" }).id);
  /** The chat a tag in a message names, for letters to take as theirs. */
  let tagged = "";
  const tag = () => `[Tagged](chat:${tagged})`;
  /**
   * Just before the turn: when the person last wrote set far back, letters counted since, and a goal driving. A turn
   * that stamps `personAt`, hears letters or halts the goal as the person's words would shows it.
   * @param {string} id @param {{ goal?: boolean }} [o]
   */
  const prime = (id, { goal = true } = {}) => {
    archive().mergeMeta(id, { personAt: 1, letters: { alone: 3 } });
    if (goal) app().memory.setGoal(id, { ...newGoal("the parser ships", { now: Date.now() }), status: "active", acceptedAt: Date.now(), drive: { on: true, round: 1, cap: 20, halted: null } });
  };
  /** What the chat's newest turn did, as each column reads it. @param {string} id */
  const facts = async (id) => {
    const meta = archive().metaOf(id, ["personAt", "letters"]) || {};
    const t = (await transcript(id)).turns.at(-1);
    return {
      personAt: Number(meta.personAt) > 1,
      halted: app().memory.goalFor(id)?.drive?.halted?.kind === "typed",
      heard: meta.letters?.alone === 0 || (meta.letters?.tagged || []).includes(tagged),
      mark: MARKS.find((m) => t?.[m]) || "none",
    };
  };
  /** Who the chat's newest turn's row says began it, the transcript's word, and whether memory quotes it as the person's. @param {string} id */
  const marks = async (id) => {
    const row = archive().getTurns(id).at(-1);
    const t = (await transcript(id)).turns.at(-1);
    return { by: row?.meta?.by ?? null, said: t?.by ?? null, quoted: archive().personTurns(id).some((/** @type {any} */ x) => x.id === row?.id) };
  };
  /** What each row's turn left, for the marks' own tests. @type {Map<string, string>} */
  const chats = new Map();

  before(async () => {
    up = await fakeUpstream(async (/** @type {any} */ c) => {
      if (c.kind !== "anthropic") return undefined;
      if (!c.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
      const last = textOf((c.body.messages || []).at(-1));
      const brief = /START A THREAD SAYING <<([\s\S]+?)>>/.exec(last)?.[1];
      if (brief) return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: `tu_${Date.now()}`, name: "thread", input: { title: "Advisor", brief } }] });
      if (last.includes("BIG")) return anthropicReply(`${"y".repeat(bigChars)}\n\n[goal: waiting]`, { model: "m-1" });
      return anthropicReply("Done.\n\n[goal: waiting]", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1", "m-past"] }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
        cfg.sessions = { ...cfg.sessions, idleWakeMinutes: 600 };
      },
    });
    tagged = await chat();
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(root, shim?.dataDir);
  });

  /**
   * The characterisation table: each kind as its real caller posts it, and what its turn did. "—" where the column
   * cannot be reached for the kind: a routine's run, a Space ask's run and a team's opening are each the first message of
   * a chat Filament makes for it (no goal, no room, no history to ask about), and a thread's brief is its chat's first.
   * @type {{ kind: string, form: string, personAt: boolean, halted: boolean | "—", heard: boolean, mark: string, run: () => Promise<string> }[]}
   */
  const TABLE = [
    { kind: "person", form: "no flag", personAt: true, halted: true, heard: true, mark: "none", run: async () => {
      const id = await chat();
      await say(id, "hello");
      prime(id);
      await say(id, `Look at ${tag()}.`);
      return id;
    } },
    { kind: "wake", form: "wake: true", personAt: false, halted: false, heard: false, mark: "woke", run: async () => {
      const id = await chat();
      await say(id, "hello");
      prime(id);
      tellLater({ session: id, agent: null }, { id: "bg_by", command: "npm test", code: 0, text: "[Filament: background shell bg_by (npm test) exited with code 0.]" }, { now: false });
      assert.equal((await post(id, { wake: true })).status, 200);
      return id;
    } },
    { kind: "goal", form: "goal: true", personAt: false, halted: false, heard: false, mark: "goalRound", run: async () => {
      const id = await chat();
      await say(id, "hello");
      prime(id);
      assert.equal(app().sessions.oweGoal(id), true);
      assert.equal((await post(id, { goal: true })).status, 200);
      return id;
    } },
    { kind: "resume", form: "resume: true", personAt: false, halted: false, heard: false, mark: "resumed", run: async () => {
      const id = await chat();
      await say(id, "hello");
      // Its newest turn failed with no reply, as a clean stop fails it (resume-cut.test.js does the same).
      const cut = archive().beginTurn(id, { requestId: `r-cut-${id}`, model: "m-1", upstream: "m", client: "harness", window: "harness", userMessage: { role: "user", content: [{ type: "text", text: "turn two: build the sheet" }] } });
      archive().mergeTurnMeta(cut.turnId, { failed: { at: Date.now(), cause: "Filament is restarting; try again in a few seconds (HTTP 503)" } });
      prime(id);
      const r = await post(id, { resume: true });
      assert.equal(r.status, 200, r.text);
      return id;
    } },
    { kind: "sync", form: "sync: true", personAt: false, halted: false, heard: false, mark: "synced", run: async () => {
      const id = await chat();
      await say(id, "hello");
      prime(id);
      assert.equal((await post(id, { sync: true, content: SYNC })).status, 200);
      return id;
    } },
    { kind: "beside", form: "beside: true", personAt: false, halted: false, heard: false, mark: "teamResult", run: async () => {
      const id = await chat();
      await say(id, "hello");
      prime(id);
      assert.equal((await post(id, { beside: true, content: RESULT })).status, 200);
      return id;
    } },
    { kind: "flow", form: "byFilament: true", personAt: false, halted: false, heard: false, mark: "flowSaid", run: async () => {
      const main = await chat();
      await say(main, "hello");
      const id = teamChat(main);
      await say(id, "hello");
      prime(id);
      assert.equal((await post(id, { byFilament: true, content: FLOW_GO_ON })).status, 200);
      return id;
    } },
    { kind: "watch", form: "watch: true", personAt: false, halted: false, heard: false, mark: "watched", run: async () => {
      const id = await chat();
      await say(id, "hello");
      prime(id);
      assert.equal((await post(id, { watch: true, content: [{ type: "text", text: WATCHED }] })).status, 200);
      return id;
    } },
    { kind: "thread", form: "its starter's thread tool", personAt: false, halted: "—", heard: false, mark: "brief", run: async () => {
      const starter = await chat();
      const before = archive().threadsOf(starter).started.length;
      await say(starter, `START A THREAD SAYING <<Review each diff of ${tag()}.>>`);
      const started = archive().threadsOf(starter).started;
      assert.equal(started.length, before + 1);
      const id = String(started.at(-1));
      await until(() => (!app().sessions.besideFacts(id).busy && archive().newestTurnN(id) > 0 ? true : null), "the thread's first turn");
      return id;
    } },
    { kind: "routine", form: "Run now", personAt: false, halted: "—", heard: false, mark: "none", run: async () => {
      const main = await chat();
      await say(main, "hello");
      const { projectId } = (await call(`${S(main)}/settings`)).json;
      if (!app().spaces.has(projectId)) assert.equal((await call(`/api/space/${encodeURIComponent(projectId)}`, {})).status, 200);
      const f = routineFields({ title: "Morning look", when: "weekdays 09:00", text: `Read ${tag()} and say what changed.` }, { create: true });
      assert.ok(f.ok, JSON.stringify(f));
      const r = app().spaces.routinePropose(projectId, f.fields, { chain: main, byName: "Main", model: "m-1" });
      app().spaces.routineOn(projectId, r.id);
      const ran = await call(`/api/space/${encodeURIComponent(projectId)}/routines/${encodeURIComponent(r.id)}/run`, {});
      assert.equal(ran.status, 200, ran.text);
      const id = String(ran.json.chain);
      await until(() => (!app().sessions.besideFacts(id).busy && archive().newestTurnN(id) > 0 ? true : null), "the run's turn");
      return id;
    } },
    { kind: "ask", form: "an app's ask", personAt: false, halted: "—", heard: false, mark: "none", run: async () => {
      const main = await chat();
      await say(main, "hello");
      const { projectId } = (await call(`${S(main)}/settings`)).json;
      if (!app().spaces.has(projectId)) assert.equal((await call(`/api/space/${encodeURIComponent(projectId)}`, {})).status, 200);
      const asked = await call(`/api/space/${encodeURIComponent(projectId)}/asks`, { words: `Summarise ${tag()} for the board.`, app: "Board", model: "m-1" });
      assert.equal(asked.status, 200, asked.text);
      const id = String(asked.json.chain);
      await until(() => (!app().sessions.besideFacts(id).busy && archive().newestTurnN(id) > 0 ? true : null), "the ask's turn");
      return id;
    } },
    { kind: "team", form: "a team fired beside", personAt: false, halted: "—", heard: false, mark: "none", run: async () => {
      const main = await chat();
      await say(main, "hello");
      const fired = await call(`${S(main)}/beside`, { team: "bughunters", ask: `Find bugs in ${tag()}.`, model: "m-1" });
      assert.equal(fired.status, 200, fired.text);
      const id = String(fired.json.team.id);
      await until(() => (!app().sessions.besideFacts(id).busy && archive().newestTurnN(id) > 0 ? true : null), "the lead's first turn");
      return id;
    } },
    // The same kinds, as their callers post them now: by name.
    { kind: "wake", form: "by", personAt: false, halted: false, heard: false, mark: "woke", run: async () => {
      const id = await chat();
      await say(id, "hello");
      prime(id);
      tellLater({ session: id, agent: null }, { id: "bg_by2", command: "npm test", code: 0, text: "[Filament: background shell bg_by2 (npm test) exited with code 0.]" }, { now: false });
      assert.equal((await post(id, { by: "wake" })).status, 200);
      return id;
    } },
    { kind: "sync", form: "by", personAt: false, halted: false, heard: false, mark: "synced", run: async () => {
      const id = await chat();
      await say(id, "hello");
      prime(id);
      assert.equal((await post(id, { by: "sync", content: SYNC })).status, 200);
      return id;
    } },
    { kind: "beside", form: "by", personAt: false, halted: false, heard: false, mark: "teamResult", run: async () => {
      const id = await chat();
      await say(id, "hello");
      prime(id);
      assert.equal((await post(id, { by: "beside", content: RESULT })).status, 200);
      return id;
    } },
    { kind: "flow", form: "by", personAt: false, halted: false, heard: false, mark: "flowSaid", run: async () => {
      const main = await chat();
      await say(main, "hello");
      const id = teamChat(main);
      await say(id, "hello");
      prime(id);
      assert.equal((await post(id, { by: "flow", content: FLOW_GO_ON })).status, 200);
      return id;
    } },
    { kind: "watch", form: "by", personAt: false, halted: false, heard: false, mark: "watched", run: async () => {
      const id = await chat();
      await say(id, "hello");
      prime(id);
      assert.equal((await post(id, { by: "watch", content: [{ type: "text", text: WATCHED }] })).status, 200);
      return id;
    } },
    // A watcher's guidance has no older form: its caller names it. Its reviewer's words may hold a chat's tag.
    { kind: "guide", form: "its caller's by", personAt: false, halted: false, heard: false, mark: "guided", run: async () => {
      const id = await chat();
      await say(id, "hello");
      prime(id);
      assert.equal((await post(id, { by: "guide", content: [{ type: "text", text: `${GUIDED} See ${tag()}.` }] })).status, 200);
      return id;
    } },
  ];

  for (const row of TABLE)
    test(`${row.kind} (${row.form}): personAt ${row.personAt}, goal halted ${row.halted}, letters heard ${row.heard}, mark ${row.mark}`, async () => {
      const id = await row.run();
      if (row.form !== "by") chats.set(row.kind, id);
      const got = await facts(id);
      assert.deepEqual(
        { personAt: got.personAt, halted: row.halted === "—" ? "—" : got.halted, heard: got.heard, mark: got.mark },
        { personAt: row.personAt, halted: row.halted, heard: row.heard, mark: row.mark },
      );
    });

  // The turn's row keeps who began it, the transcript says it, and memory quotes none of Filament's own as the person's.
  for (const kind of ["person", "wake", "goal", "resume", "sync", "beside", "flow", "watch", "guide", "thread", "routine", "ask", "team"])
    test(`marks: ${kind}'s turn — meta.by, the transcript's by, memory's personTurns`, async () => {
      const id = chats.get(kind);
      assert.ok(id, `its row ran: ${kind}`);
      const own = kind === "person" ? null : kind;
      assert.deepEqual(await marks(id), { by: own, said: own, quoted: kind === "person" });
    });

  // (fails before: yes — r-doors, 11-12: the transcript said of none that it opens its chat, and the page's Retry sent
  // Filament's first message of a run again as the person's)
  test("the first message of a chat Filament made for it — a routine's run, an app's ask, a team's opening — is said so (`opening`), and no other kind's is", async () => {
    const said = [];
    for (const kind of ["person", "wake", "goal", "resume", "sync", "beside", "flow", "watch", "guide", "thread", "routine", "ask", "team"]) {
      const t = (await transcript(String(chats.get(kind)))).turns.at(-1);
      if (t.opening) said.push([kind, t.opening]);
    }
    assert.deepEqual(said, [["routine", true], ["ask", true], ["team", true]]);
  });

  // (fails before: yes — a message the person typed that reads as Filament's wake line was drawn as Filament's wake)
  test("a mark is read without the text: the person's message that pastes a wake line is theirs; a routine's run in plain words is Filament's", async () => {
    const id = await chat();
    await say(id, "hello");
    await say(id, WAKE_LINE);
    const t = (await transcript(id)).turns.at(-1);
    assert.deepEqual([t.woke ?? null, t.by ?? null, archive().getTurns(id).at(-1).meta?.by ?? null], [null, null, null], "the person's own");
    assert.deepEqual(await marks(String(chats.get("routine"))), { by: "routine", said: "routine", quoted: false }, "words with no Filament line, read by their mark");
  });

  // (fails before: yes — `fromThePerson` read a thread's brief as the person's message: the chat's day measured from it)
  test("a thread's brief is none of the person's: a thread they never wrote in has no turn of theirs to measure a day from, and is measured from when it began", async () => {
    const id = String(chats.get("thread"));
    assert.deepEqual(app().sessions.personLast(id), { personAt: 0, turnAt: 0, beganAt: archive().getTurns(id)[0].started_at });
    assert.ok(archive().getTurns(id)[0].started_at > 0);
  });

  // (fails before: yes — two kinds at once went as the first the service read, and a `by` it did not know as the person's)
  test("the input names one kind: two at once, a `by` Filament does not know, and a coding agent's own are refused in words", async () => {
    const id = await chat();
    await say(id, "hello");
    for (const body of [{ wake: true, sync: true, content: SYNC }, { by: "sync", beside: true, content: SYNC }, { by: "nobody", content: "hi" }, { by: "agent", content: "hi" }, { by: 7, content: "hi" }]) {
      const r = await call(`${S(id)}/turns`, { ...body, stream: false });
      assert.equal(r.status, 400, `${JSON.stringify(body)}: ${r.text}`);
      assert.match(String(r.json?.error), /\bby\b|one kind|begun by one/, r.text);
    }
    assert.equal(archive().newestTurnN(id), 1, "no turn began");
    const same = await post(id, { by: "sync", sync: true, content: SYNC });
    assert.equal(same.status, 200, `the kind named twice is one: ${same.text}`);
  });

  // A watcher's guidance is Filament's to post, as a watcher's wake is: only words that open with its head ride that
  // kind; it starts over no question that waits for the person, and not after their Stop until they write again.
  // (fails before: yes — `by: "guide"` named no kind: each was a 400 that said so)
  test("a watcher's guidance: refused without its head; over a question that waits and after the person's Stop it is held, in words its sender reads", async () => {
    const id = await chat();
    await say(id, "hello");
    const bare = await call(`${S(id)}/turns`, { by: "guide", content: "You drifted.", stream: false });
    assert.deepEqual([bare.status, bare.json?.error], [400, "a watcher's guidance turn carries a watcher's guidance"], bare.text);
    const body = { by: "guide", content: [{ type: "text", text: GUIDED }], stream: false };
    archive().mergeMeta(id, { paused: { kind: "permission", at: Date.now() } });
    const asking = await call(`${S(id)}/turns`, body);
    assert.deepEqual([asking.status, asking.json?.guide], [409, "asking"], asking.text);
    archive().mergeMeta(id, { paused: undefined, lastStop: { turn: archive().newestTurnN(id), at: Date.now() } });
    const stopped = await call(`${S(id)}/turns`, body);
    assert.deepEqual([stopped.status, stopped.json?.guide], [409, "stopped"], stopped.text);
    assert.equal(archive().newestTurnN(id), 1, "no turn began");
    archive().mergeMeta(id, { lastStop: undefined });
    assert.equal((await post(id, body)).status, 200);
    const t = (await transcript(id)).turns.at(-1);
    assert.deepEqual([t.guided, t.by, t.watched ?? null], [true, "guide", null]);
  });

  /**
   * The room made for the person's message (Compact and send): only that message takes it. A sync's or a team's result
   * that went first used to take it, so a wake could run ahead of the message (drift: the room's rule names the person's
   * message alone). A wake, a goal's round and a watcher's wake are refused while it is held, by their own gates.
   * @type {{ kind: string, room: "taken" | "held" | "refused", body: Record<string, unknown> }[]}
   */
  const ROOM = [
    { kind: "person", room: "taken", body: { content: "the message the room was made for" } },
    { kind: "sync", room: "held", body: { sync: true, content: SYNC } },
    { kind: "beside", room: "held", body: { beside: true, content: RESULT } },
    { kind: "flow", room: "held", body: { byFilament: true, content: FLOW_GO_ON } },
    { kind: "goal", room: "refused", body: { goal: true } },
    { kind: "watch", room: "refused", body: { watch: true, content: [{ type: "text", text: WATCHED }] } },
    { kind: "guide", room: "refused", body: { by: "guide", content: [{ type: "text", text: GUIDED }] } },
  ];
  for (const row of ROOM)
    test(`the room made for the person's message: ${row.kind} — ${row.room}`, async () => {
      const id = await chat();
      // Turns a summary makes smaller: a compaction that would not is refused.
      await say(id, "BIG one");
      await say(id, "BIG two");
      if (row.kind === "goal") {
        prime(id);
        assert.equal(app().sessions.oweGoal(id), true);
      }
      const c = await call(`${S(id)}/compact`, { sending: true });
      assert.equal(c.status, 200, c.text);
      const r = await post(id, row.body);
      if (row.room === "refused") return assert.deepEqual([r.status, r.json?.wake ?? r.json?.watch ?? r.json?.guide], [409, "room"], r.text);
      assert.equal(r.status, 200, r.text);
      const wake = await call(`${S(id)}/turns`, { wake: true, stream: false });
      assert.deepEqual([wake.status, wake.json?.wake], [409, row.room === "taken" ? "told" : "room"], wake.text);
    });

  // A message past the compaction line asks the person first (`context.compaction.mode: "ask"`, the default); every turn
  // of Filament's own makes room by the session's method and goes, nobody being there to answer.
  // (fails before: no — a guard)
  test("past the line: the person's message is asked; a wake, a goal's round, a sync, a team's result, a flow's line, a watcher's wake and its guidance make room and go", async () => {
    const probe = await chat("m-past");
    const fixed = Number((await call(`${S(probe)}/compose`)).json?.current?.fixed) || 0;
    assert.ok(fixed > 0, "the request's fixed part is weighed");
    const window = Math.ceil(fixed / 0.85 / 100) * 100 + 40_000;
    bigChars = charsFor(25_000);
    const cfg = (await call("/api/state")).json.config;
    const set = await call("/api/config", { ...cfg, upstreams: cfg.upstreams.map((/** @type {any} */ u) => (u.id === "m" ? { ...u, pricing: { ...(u.pricing || {}), "m-past": { input: 1, output: 1, contextTokens: window } } } : u)) }, "PUT");
    assert.equal(set.status, 200, set.text);
    /** A chat whose next message is past the line. */
    const past = async () => {
      const id = await chat("m-past");
      await say(id, "BIG one");
      await say(id, "BIG two");
      return id;
    };
    const person = await past();
    const asked = await call(`${S(person)}/turns`, { content: "three", stream: false });
    assert.deepEqual([asked.status, asked.json?.needsCompaction], [409, true], asked.text);
    /** @type {[string, (id: string) => Record<string, unknown>][]} */
    const own = [
      ["wake", (id) => (tellLater({ session: id, agent: null }, { id: `bg_${id.slice(0, 6)}`, command: "npm test", code: 0, text: "[Filament: background shell exited with code 0.]" }, { now: false }), { wake: true })],
      ["goal", (id) => (prime(id), app().sessions.oweGoal(id), { goal: true })],
      ["sync", () => ({ sync: true, content: SYNC })],
      ["beside", () => ({ beside: true, content: RESULT })],
      ["flow", () => ({ byFilament: true, content: FLOW_GO_ON })],
      ["watch", () => ({ watch: true, content: [{ type: "text", text: WATCHED }] })],
      ["guide", () => ({ by: "guide", content: [{ type: "text", text: GUIDED }] })],
    ];
    for (const [kind, body] of own) {
      const id = await past();
      const r = await post(id, body(id));
      assert.equal(r.status, 200, `${kind}: ${r.text}`);
      assert.equal(archive().newestTurnN(id), 3, `${kind}'s turn ran`);
    }
  });

  // Filament's own turn in another machine's agents' chat whose device lets them in no more: refused, all of them — the
  // rule is "Filament starts no turn of its own here", and a sync's, a team's result or a flow's line went on all the
  // same (drift). The person's own message still goes.
  // (fails before: yes — the route refused a wake, a goal's round, a resume and a watcher's wake alone)
  test("a chat another machine's agents started, their device let go: every turn of Filament's own is refused, the person's goes", async () => {
    const id = await chat();
    await say(id, "hello");
    archive().mergeMeta(id, { agentDevice: "dev-gone" });
    for (const body of [{ sync: true, content: SYNC }, { beside: true, content: RESULT }, { byFilament: true, content: FLOW_GO_ON }, { by: "sync", content: SYNC }, { by: "guide", content: [{ type: "text", text: GUIDED }] }]) {
      const r = await call(`${S(id)}/turns`, { ...body, stream: false });
      assert.deepEqual([r.status, r.json?.wake], [403, "let go"], `${JSON.stringify(body).slice(0, 40)}: ${r.text}`);
    }
    assert.equal(archive().newestTurnN(id), 1);
  });

  // The chat's browser is driven from the app of whoever sends its newest message — the person's own; none of
  // Filament's, which the route excepted only for a wake, a goal's round and a resume (drift).
  // (fails before: yes — a sync took the chat's browser back to this machine's app)
  test("the browser's driver moves with the person's message alone, not with a turn of Filament's own", async () => {
    const id = await chat();
    /** @type {string[]} */
    const drove = [];
    const browsers = app().browsers;
    const was = browsers.drive;
    browsers.drive = (/** @type {string} */ chain, /** @type {any} */ at) => {
      if (chain === id) drove.push(String(at));
      return was.call(browsers, chain, at);
    };
    try {
      await say(id, "hello");
      assert.equal(drove.length, 1, "the person's message drives it");
      assert.equal((await post(id, { sync: true, content: SYNC })).status, 200);
      assert.equal((await post(id, { beside: true, content: RESULT })).status, 200);
      assert.equal((await post(id, { by: "guide", content: [{ type: "text", text: GUIDED }] })).status, 200);
      assert.equal(drove.length, 1, "Filament's own turns move nothing");
    } finally {
      browsers.drive = was;
    }
  });
});

describe("every caller says who begins its turn", () => {
  /** Every source file under src. @param {string} dir @returns {string[]} */
  const files = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : n.endsWith(".js") ? [join(dir, n)] : []));
  /** The object literal that opens at `at` (its "{"), balanced. @param {string} s @param {number} at */
  const objectAt = (s, at) => {
    let depth = 0;
    for (let i = at; i < s.length; i++) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}" && --depth === 0) return s.slice(at, i + 1);
    }
    return s.slice(at);
  };
  // (fails before: yes — the callers named their kind by a boolean, or not at all)
  test("no caller in src names a kind by its old boolean, and each post of a turn of Filament's own names `by`", () => {
    /** @type {string[]} */
    const old = [];
    /** @type {string[]} */
    const unnamed = [];
    for (const f of files(SRC)) {
      const rel = relative(SRC, f).replace(/\\/g, "/");
      if (rel === "core/turn-by.js") continue;
      const code = readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
      for (const m of code.matchAll(/\b(?:wake|goal|resume|sync|beside|byFilament|thread|watch): true\b/g)) old.push(`${rel}: ${code.slice(Math.max(0, m.index - 40), m.index + 20).replace(/\s+/g, " ")}`);
      for (const m of code.matchAll(/\b(?:postTurn|postOwnTurn)\(\s*[^,()]+(?:\([^()]*\))?,\s*\{/g)) {
        const body = objectAt(code, m.index + m[0].length - 1);
        if (!/\bby: /.test(body)) unnamed.push(`${rel}: ${m[0]}${body.slice(1, 60).replace(/\s+/g, " ")}`);
      }
    }
    assert.deepEqual(old, [], "a kind is named by `by`");
    assert.deepEqual(unnamed, [], "each post names who begins its turn");
    const api = readFileSync(join(SRC, "ui/harness/lib/api.js"), "utf8");
    assert.match(api, /by: "thread"/, "the page's Retry of a brief names it");
  });
});

describe("core/turn-by.js", () => {
  const load = () => import("../src/core/turn-by.js");

  test("one frozen table: each kind with the same traits; the person's message alone is the person's, a coding agent's own never an input", async () => {
    const { TURN_BY } = await load();
    assert.ok(Object.isFrozen(TURN_BY));
    const kinds = Object.keys(TURN_BY);
    for (const k of ["person", "wake", "goal", "resume", "sync", "beside", "flow", "thread", "watch", "guide", "routine", "ask", "team", "agent"]) assert.ok(kinds.includes(k), k);
    assert.equal(kinds.length, 14, "and no other");
    const keys = JSON.stringify(Object.keys(TURN_BY.person).sort());
    for (const k of kinds) {
      assert.ok(Object.isFrozen(TURN_BY[k]), k);
      assert.equal(JSON.stringify(Object.keys(TURN_BY[k]).sort()), keys, `${k} has every trait`);
    }
    assert.deepEqual(kinds.filter((k) => TURN_BY[k].person), ["person"]);
    assert.deepEqual(kinds.filter((k) => !TURN_BY[k].input), ["agent"]);
    assert.deepEqual(kinds.filter((k) => TURN_BY[k].opens).sort(), ["ask", "routine", "team"]);
    assert.deepEqual(kinds.filter((k) => TURN_BY[k].line).sort(), ["goal", "resume", "wake"]);
    // A watcher's guidance: Filament's own, its message the content posted, in a chat that has turns; no older boolean.
    assert.deepEqual({ ...TURN_BY.guide }, { person: false, woken: false, line: false, opens: false, input: true, flag: null, what: "the watcher's guidance" });
  });

  test("turnBy reads `by`, or an older caller's boolean as its kind; one kind at most, and only one Filament knows", async () => {
    const { turnBy } = await load();
    assert.deepEqual(turnBy({ content: "hi" }), { by: "person" });
    assert.deepEqual(turnBy(null), { by: "person" });
    assert.deepEqual(turnBy({ by: "routine" }), { by: "routine" });
    assert.deepEqual(turnBy({ by: "guide" }), { by: "guide" });
    assert.deepEqual(turnBy({ guide: true }), { by: "person" }, "no boolean names a watcher's guidance");
    assert.ok("error" in turnBy({ by: "guide", watch: true }), "a guidance is no wake");
    for (const [flag, kind] of [["wake", "wake"], ["goal", "goal"], ["resume", "resume"], ["sync", "sync"], ["beside", "beside"], ["byFilament", "flow"], ["thread", "thread"], ["watch", "watch"]]) {
      assert.deepEqual(turnBy({ [flag]: true }), { by: kind }, flag);
      assert.deepEqual(turnBy({ by: kind, [flag]: true }), { by: kind }, `${flag} named twice`);
      assert.deepEqual(turnBy({ [flag]: false }), { by: "person" }, `${flag}: false names nothing`);
    }
    for (const bad of [{ wake: true, goal: true }, { by: "sync", beside: true }, { by: "nobody" }, { by: "agent" }, { by: 3 }, { by: "" }]) assert.ok("error" in turnBy(bad), JSON.stringify(bad));
    assert.match(/** @type {any} */ (turnBy({ wake: true, sync: true })).error, /wake.*sync|sync.*wake/);
  });

  test("byOfTurn: the row's mark, a coding agent's own, a brief; what the caller reads of an unmarked turn; else the person", async () => {
    const { byOfTurn } = await load();
    assert.equal(byOfTurn({ meta: { by: "routine" } }), "routine");
    assert.equal(byOfTurn({ meta: { by: "routine", own: { agent: "a" } } }), "routine");
    assert.equal(byOfTurn({ meta: { own: { agent: "a" } } }), "agent");
    assert.equal(byOfTurn({ meta: { brief: true } }), "thread");
    assert.equal(byOfTurn({ meta: {} }), "person");
    assert.equal(byOfTurn({}), "person");
    assert.equal(byOfTurn({ meta: {} }, () => "wake"), "wake", "an unmarked turn, as its caller reads it");
    assert.equal(byOfTurn({ meta: { by: "sync" } }, () => "wake"), "sync", "a mark is never read past");
    assert.equal(byOfTurn({ meta: { by: "nothing-known" } }), "person", "a mark Filament does not know names no kind");
  });
});

describe("a message the developer typed (services/runs.js `typedByDeveloper`)", () => {
  // (fails before: yes — a deny list: a sender it did not know, as "veto-button", was read as the developer's)
  test("theirs is the page's, or a steer that names no sender; any other sender, known or not, is not theirs", async () => {
    const { typedByDeveloper } = await import("../src/services/runs.js");
    for (const from of [undefined, "", "harness", "chat"]) assert.equal(typedByDeveloper({ from }), true, String(from));
    for (const from of ["lead", "agent", "filament", "developer", "veto-button", "routine", "watcher"]) assert.equal(typedByDeveloper({ from }), false, from);
  });
});
