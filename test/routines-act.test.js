// @ts-check
// Routines that act through connections, and that write in a Space of the person's own with no repository
// (HarnessV4_SpacesPlugins_Plan A2c): a routine names the connections' tools its runs call without asking — checked,
// said on its row, its sheet and its run's first message —, its run's chat carries them, and the gate lets them run in
// read-only while the rules still judge them; a routine that writes in a Space of one's own whose folder is no git
// repository runs in that folder, where any other Space's still needs git.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { actWords, mayWords, routineActs, routineFields, routinesWords, rowWords, runWords, runsWhereWords, ROUTINE_LIMITS } from "../src/core/routines.js";
import { createAgentPermits } from "../src/app/agent-permits.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createRoutines } from "../src/app/routines.js";
import { inRepo } from "../src/app/own-spaces.js";
import { MCP_DOOR } from "../src/core/mcp-door.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-server.mjs", import.meta.url));
const ARCHIVE = "mcp__gmail__archive";
const MOVE = "mcp__linear__update_issue";

describe("a routine's acts, in words", () => {
  test("acts are checked: a list of full tool names, trimmed, each once, 16 at most; [] takes them away; refusals in words", () => {
    const f = routineFields({ title: "Triage", when: "weekdays 09:00", text: "Answer who tagged me.", acts: [ARCHIVE, ` ${MOVE} `, ARCHIVE] }, { create: true });
    assert.ok(f.ok);
    assert.deepEqual(f.ok && f.fields.acts, [ARCHIVE, MOVE]);
    assert.equal(f.ok && f.fields.writes, false);
    const none = routineFields({ title: "Brief", when: "daily 08:00", text: "Read." }, { create: true });
    assert.ok(none.ok && !("acts" in none.fields), "none unless it says");
    const cleared = routineFields({ acts: [] }, { create: false });
    assert.deepEqual(cleared.ok && cleared.fields, { acts: [] });
    const notList = routineFields({ acts: ARCHIVE }, { create: false });
    assert.match(!notList.ok ? notList.error : "", /acts is a list of connections' tools by their full names/);
    const bare = routineFields({ acts: ["archive"] }, { create: false });
    assert.match(!bare.ok ? bare.error : "", /acts names a connection's tool as mcp__<server>__<tool>, of letters, digits, _ and -; "archive" is not one/);
    // Only a name a call can have (mcp-client.js toolNameFor): no dot, 64 characters at most.
    const dotted = routineFields({ acts: ["mcp__gmail__messages.archive"] }, { create: false });
    assert.match(!dotted.ok ? dotted.error : "", /"mcp__gmail__messages\.archive" is not one/);
    const long = `mcp__gmail__${"a".repeat(60)}`;
    const tooLong = routineFields({ acts: [long] }, { create: false });
    assert.equal(!tooLong.ok ? tooLong.error : "", `a connection's tool is named in 64 characters at most, as its calls are; "${long}" has 72`);
    assert.deepEqual([...routineActs({ routine: { acts: [ARCHIVE, "mcp__x__a.b", 7] } })], [ARCHIVE], "a chat's marked acts, only those a call can name");
    assert.deepEqual([...routineActs({})], []);
    const many = routineFields({ acts: Array.from({ length: ROUTINE_LIMITS.acts + 1 }, (_, i) => `mcp__s__t${i}`) }, { create: false });
    assert.match(!many.ok ? many.error : "", /16 tools at most; these are 17/);
    const nothing = routineFields({}, { create: false });
    assert.match(!nothing.ok ? nothing.error : "", /title, when or trigger, text, writes, acts, wakes or guides/);
  });

  test("the sheet's, the row's and the run's words say what it acts through, and where a run that writes works", () => {
    assert.equal(actWords([ARCHIVE]), "gmail's archive");
    assert.equal(actWords([ARCHIVE, MOVE, "mcp__gmail__label"]), "gmail's archive, linear's update_issue and gmail's label");
    assert.equal(mayWords({ writes: false }), "Reads only: it changes no file and sends nothing; it may write drafts and lines in What happened");
    assert.equal(mayWords({ writes: false, acts: [ARCHIVE] }), "Changes no file and sends nothing; it acts through gmail's archive without asking, and may write drafts and lines in What happened");
    assert.match(mayWords({ writes: true }), /^Writes in a lane of its own/);
    assert.match(mayWords({ writes: true, acts: [MOVE] }, { inPlace: true }), /^Writes in its Space's folder, which is no git repository: what it changes is there at once, with no lane to look at first; it acts through linear's update_issue without asking$/);
    const r = { title: "Triage", task: "Answer who tagged me.", writes: false, acts: [ARCHIVE] };
    const said = runWords(r, { project: "Work", when: "weekdays at 09:00", by: "time" });
    assert.match(said, /You read only: change no file, and send nothing\. .* The person let this routine call these tools of its connections without asking, as its words need them: mcp__gmail__archive\. Nothing that sends to people: that is a draft\.\n\nAnswer who tagged me\.$/);
    assert.ok(!runWords({ ...r, acts: [] }, { project: "Work", when: "", by: "you" }).includes("The person let this routine"));
    const here = runWords({ ...r, writes: true }, { project: "Notes", when: "", by: "you", inPlace: true });
    assert.match(here, /You work in this Space's own folder, which is no git repository: what you change is there at once, and nobody looks at it first\. Change only what the routine's words ask for\. Push, deploy and send nothing\. The person let/);
    /** @type {any} */
    const row = { id: "r1", ...r, when: "weekdays 09:00", state: "proposed", paused: false, madeIn: "c1", madeBy: "", model: "", at: 1, onAt: null, upTo: null, last: null, skipped: null };
    const w = rowWords(row, { now: Date.now() });
    assert.equal(w.may, "reads only · acts through gmail's archive");
    assert.match(w.allowed, /acts through gmail's archive without asking/);
    assert.equal(rowWords({ ...row, writes: true, acts: [] }, { now: Date.now(), inPlace: true }).may, "writes in its folder");
    // The agents' read says where a run that writes works, as the runner decides it (found by the Hunter on A2c).
    const read = routinesWords([{ ...row, writes: true, acts: [] }], { nameOf: () => "Triage chat", now: Date.now(), inPlace: true });
    assert.match(read, /- r1 "Triage" \(by Triage chat\), weekdays at 09:00, writes in its Space's own folder, which is no git repository: proposed/);
    assert.deepEqual([runsWhereWords(false, true), runsWhereWords(true, false), runsWhereWords(true, true)], ["reading only", "in a worktree of its own", "writing in its Space's own folder, which is no git repository"]);
  });

  test("a coding agent's run acts through its routine's tools as the loop's does: the gate's no turns into a run, a deny rule still refuses", () => {
    const call = [{ name: ARCHIVE, input: { id: "m1" } }];
    const readOnly = () => /** @type {const} */ ("read-only");
    const judged = (/** @type {any} */ o) => createAgentPermits({ rules: [], modeNow: readOnly, learned: null, ...o }).judge(call, "/w").verdict;
    assert.equal(judged({ acts: new Set([ARCHIVE]) }), "run");
    assert.equal(judged({}), "refuse", "none outside a run: read-only refuses it");
    assert.equal(judged({ acts: new Set([MOVE]) }), "refuse", "only the tools it names");
    assert.equal(judged({ acts: new Set([ARCHIVE]), rules: [{ tool: ARCHIVE, pattern: "*", verdict: "deny" }] }), "refuse", "a deny rule stands over them");
  });

  test("a folder is in a repository when it or a folder above it holds .git", () => {
    const has = new Set([join("/a", "repo", ".git")]);
    const exists = (/** @type {any} */ p) => has.has(String(p));
    assert.equal(inRepo(join("/a", "repo", "src", "deep"), exists), true);
    assert.equal(inRepo(join("/a", "other"), exists), false);
  });
});

describe("a routine's acts and place, kept and run", () => {
  /** @type {string} */
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-routines-act-"));
  });
  after(async () => {
    await removeDirs(dir);
  });

  test("the store keeps a routine's acts and says them; a run of a Space of one's own with no repository writes in its folder, any other Space's still needs git; its chat carries the acts", async () => {
    const spaces = createSpaceStore({ dir: join(dir, "spaces") });
    const by = { chain: "c1", byName: "Triage chat", model: "m" };
    const mine = "aaaaaaaaaaaa";
    const theirs = "bbbbbbbbbbbb";
    const folder = join(dir, "Work");
    mkdirSync(folder);
    spaces.makeOwn(mine, { name: "Work", folder });
    const f = routineFields({ title: "Tidy notes", when: "daily 18:00", text: "Tidy the notes.", writes: true, acts: [ARCHIVE] }, { create: true });
    assert.ok(f.ok);
    const r = spaces.routinePropose(mine, f.ok ? f.fields : {}, by);
    assert.deepEqual(r.acts, [ARCHIVE]);
    spaces.routineOn(mine, r.id);
    const log = spaces.get(mine).log.map((e) => e.text);
    assert.ok(log.includes("Proposed a routine: “Tidy notes”, daily at 18:00, writing, acting through gmail's archive. It runs only once you switch it on, in Routines."), log.join("\n"));
    assert.ok(log.some((t) => /^You switched on “Tidy notes”: .*, writing, acting through gmail's archive\.$/.test(t)), log.join("\n"));
    // Read again from disk: the acts stay.
    assert.deepEqual(createSpaceStore({ dir: join(dir, "spaces") }).get(mine).routines[0].acts, [ARCHIVE]);
    const g = routineFields({ title: "Ship notes", when: "daily 18:00", text: "Write the notes.", writes: true }, { create: true });
    const other = spaces.routinePropose(theirs, g.ok ? g.fields : {}, by);
    assert.ok(spaces.get(theirs).log.some((e) => e.text.includes("writing in a lane of its own")), "a project's Space still says its lane");
    spaces.routineOn(theirs, other.id);

    /** @type {any[]} */
    const created = [];
    /** @type {any[]} */
    const marked = [];
    /** @type {any[]} */
    const posted = [];
    let n = 0;
    /** @type {any} */
    let facts = { busy: true, asking: false, last: null };
    const routines = createRoutines({
      spaces,
      sessions: { create: (o) => (created.push(o), { id: `run${++n}` }), besideFacts: () => facts },
      mark: (id, m) => void marked.push([id, m]),
      postTurn: async (id, b) => (posted.push([id, b]), { status: 200, body: null }),
      folderOf: (p) => (p === mine ? folder : "/work/app"),
      places: { own: async (cwd) => ({ ok: false, outside: `${cwd} is no git repository` }), takeBack: async () => null },
    });
    const chat = await routines.runNow(mine, r.id);
    assert.equal(chat, "run1");
    assert.equal(created[0].cwd, folder, "it writes in the Space's own folder");
    assert.equal(created[0].settings, null, "in the chat's own mode, as any run that writes");
    assert.deepEqual(marked[0][1].routine.acts, [ARCHIVE], "its chat carries what it acts through");
    assert.match(posted[0][1].content[0].text, /You work in this Space's own folder, which is no git repository/);
    assert.equal(spaces.get(mine).routines[0].last?.state, "running");
    // Its end takes the acts off its chat: a message the person sends there after is judged as any chat's (found by the
    // Hunter on A2c: they stayed, and the chat kept acting without asking).
    facts = { busy: false, asking: false, last: { final: true, text: "Tidied." } };
    routines.released("run1");
    assert.equal(spaces.get(mine).routines[0].last?.state, "done");
    assert.deepEqual(marked.at(-1), ["run1", { routine: { project: mine, id: r.id, title: "Tidy notes", at: marked[0][1].routine.at, by: "you" } }]);
    // A Space of one's own whose folder is a repository — no commit yet, or git not to be asked — writes in no folder
    // but a lane's: its run fails in words, as its sheet said (found by the Hunter on A2c).
    const repoSpace = "cccccccccccc";
    const repoFolder = join(dir, "Repo");
    mkdirSync(join(repoFolder, ".git"), { recursive: true });
    spaces.makeOwn(repoSpace, { name: "Repo", folder: repoFolder });
    const q = spaces.routinePropose(repoSpace, f.ok ? f.fields : {}, by);
    spaces.routineOn(repoSpace, q.id);
    const noLane = await routines.runNow(repoSpace, q.id).catch((/** @type {any} */ e) => e);
    assert.equal(created.length, 1, "no chat without a lane");
    assert.match(String(noLane?.message), /could not start: it writes, and .* is no git repository: a lane of its own needs git/);
    const none = await routines.runNow(theirs, other.id).catch((/** @type {any} */ e) => e);
    assert.equal(created.length, 1, "a project's Space makes no chat without a lane");
    assert.match(String(none?.message), /“Ship notes” could not start: it writes, and \/work\/app is no git repository: a lane of its own needs git/);
    assert.equal(spaces.get(theirs).routines[0].last?.why, "it writes, and /work/app is no git repository: a lane of its own needs git");
  });
});

describe("a routine's run acts through its connections", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-routines-act-loop-"));
    up = await fakeUpstream(async (/** @type {any} */ call) => brain(call));
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, root);
  });
  const NOTES = { name: "notes", command: process.execPath, args: [FIXTURE] };
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
  const lastResults = (/** @type {any[]} */ msgs) => (Array.isArray(msgs.at(-1)?.content) ? msgs.at(-1).content.filter((/** @type {any} */ c) => c?.type === "tool_result") : []);
  /** @param {any} settings @param {string[]} acts */
  const runChat = async (settings, acts) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    const id = String((await r.json()).id);
    // As the runner marks a run's chat.
    shim.app.memory.archive?.mergeMeta(id, { routine: { project: "p", id: "r1", title: "Tidy", at: Date.now(), by: "you", ...(acts.length ? { acts } : {}) } });
    return id;
  };
  /** @param {string} id */
  const turn = async (id) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "run", stream: false } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return r.json();
  };

  test("read-only, its acts run without asking and every other change is refused; a deny rule still refuses an act; a chat with no acts is refused as before", async () => {
    let round = 0;
    /** @type {any[]} */
    let results = [];
    brain = (/** @type {any} */ call) => {
      round++;
      if (round === 1) return reply([toolUse("w1", MCP_DOOR, { action: "call", tool: "write_note", args: { name: "acted", text: "sent" } }), toolUse("f1", "write", { path: "file.txt", content: "no" })], "tool_use");
      results = lastResults(call.body.messages);
      return reply([{ type: "text", text: "Done." }]);
    };
    const id = await runChat({ plugins: { mcp: [NOTES] }, loop: { permissions: "read-only" } }, ["mcp__notes__write_note"]);
    await turn(id);
    assert.equal(readFileSync(join(root, "acted.txt"), "utf8"), "sent");
    assert.equal(results[0].content, "wrote acted.txt");
    assert.match(String(results[1].content), /this session is read-only, so write is not available/);
    assert.ok(!existsSync(join(root, "file.txt")));

    round = 0;
    const denied = await runChat({ plugins: { mcp: [NOTES] }, loop: { permissions: "read-only", rules: [{ tool: "mcp__notes__write_note", pattern: "*", verdict: "deny" }] } }, ["mcp__notes__write_note"]);
    brain = (/** @type {any} */ call) => {
      round++;
      if (round === 1) return reply([toolUse("w1", MCP_DOOR, { action: "call", tool: "write_note", args: { name: "denied", text: "x" } })], "tool_use");
      results = lastResults(call.body.messages);
      return reply([{ type: "text", text: "Done." }]);
    };
    await turn(denied);
    assert.ok(!existsSync(join(root, "denied.txt")), "a deny rule stands over the routine's acts");
    assert.equal(results[0].is_error, true);

    round = 0;
    const plain = await runChat({ plugins: { mcp: [NOTES] }, loop: { permissions: "read-only" } }, []);
    brain = (/** @type {any} */ call) => {
      round++;
      if (round === 1) return reply([toolUse("w1", MCP_DOOR, { action: "call", tool: "write_note", args: { name: "plain", text: "x" } })], "tool_use");
      results = lastResults(call.body.messages);
      return reply([{ type: "text", text: "Done." }]);
    };
    await turn(plain);
    assert.ok(!existsSync(join(root, "plain.txt")));
    assert.match(String(results[0].content), /this session is read-only, so mcp__notes__write_note is not available/);
  });
});
