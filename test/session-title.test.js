// A session is named by the first message that reached the model, never by a command Filament answered (the
// HarnessV3-FixRound backlog 18: a `/set …` as a session's first message used to name the session after itself).
// The archive marks a command's turn at its birth, so it writes neither the row's preview nor an auto title, and the
// first-user-text lookup (fork names, the preview backfill) passes over it; the harness's create call asks for
// `autoTitle` instead of sending its first message as the title, and its typed-name fallback skips command turns.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive, firstLineTitle } from "../src/services/memory/archive.js";
import { firstMessageName } from "../src/ui/harness/lib/labels.js";
import { sessionStartBody } from "../src/ui/harness/session-start.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

const user = (/** @type {string} */ text) => ({ role: "user", content: [{ type: "text", text }] });

describe("the archive: a command's turn labels and names nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-title-"));
  /** @type {Archive[]} */
  const opened = [];
  let clock = 1_758_000_000_000;
  const open = () => {
    const a = new Archive({ file: join(dir, `t${opened.length}.db`), now: () => (clock += 1000) });
    opened.push(a);
    return a;
  };
  after(() => {
    for (const a of opened) a.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("the preview and the first user text come from the first message that reached the model", () => {
    const a = open();
    const c = a.chainForKey("n:t1", { client: "harness" });
    a.beginTurn(c.id, { userMessage: user("/set model.maxTokens 2000"), command: true });
    assert.equal(a.getChain(c.id)?.preview ?? null, null, "a command labels nothing");
    assert.equal(a.firstUserText(c.id), null);
    a.beginTurn(c.id, { userMessage: user("fix the login bug\nand add a test") });
    assert.equal(a.getChain(c.id)?.preview, "fix the login bug and add a test");
    assert.equal(a.firstUserText(c.id), "fix the login bug\nand add a test", "the fork name and the backfill skip it too");
  });

  test("autoTitle: the first line of the first real message, once; a title already set is kept", () => {
    const a = open();
    const c = a.chainForKey("n:t2", { client: "harness" });
    a.mergeMeta(c.id, { autoTitle: true });
    a.beginTurn(c.id, { userMessage: user("/goal help"), command: true });
    assert.equal(a.getChain(c.id)?.title ?? null, null, "a command names nothing");
    a.beginTurn(c.id, { userMessage: user("  fix the login bug  \nand add a test") });
    assert.equal(a.getChain(c.id)?.title, "fix the login bug");
    assert.equal(a.getChain(c.id)?.meta?.autoTitle, undefined, "asked once: the mark is spent");
    a.beginTurn(c.id, { userMessage: user("now the signup page") });
    assert.equal(a.getChain(c.id)?.title, "fix the login bug", "later messages never rename it");
    const named = a.chainForKey("n:t3", { client: "harness" });
    a.setTitle(named.id, "Mine");
    a.mergeMeta(named.id, { autoTitle: true });
    a.beginTurn(named.id, { userMessage: user("hello") });
    assert.equal(a.getChain(named.id)?.title, "Mine", "a name already given wins");
    // (fails before: yes — F4's hand test: a first message that carried a queued sub-agent report named the session
    // "[Filament: sub-agent …")
    const carried = a.chainForKey("n:t5", { client: "harness" });
    a.mergeMeta(carried.id, { autoTitle: true });
    a.beginTurn(carried.id, { userMessage: { role: "user", content: [{ type: "text", text: "[Filament: sub-agent sa_1 (\"Audit\") was cut by a Filament restart before it finished.]" }, { type: "text", text: "[Filament: the developer is passing you the report of sub-agent sa_2]" }, { type: "text", text: "hello there" }] } });
    assert.deepEqual([a.getChain(carried.id)?.title, a.getChain(carried.id)?.preview], ["hello there", "hello there"], "the person's words name it, not Filament's notes in front");
    const plain = a.chainForKey("n:t4", { client: "harness" });
    a.beginTurn(plain.id, { userMessage: user("hello") });
    assert.equal(a.getChain(plain.id)?.title ?? null, null, "no autoTitle: titles stay the client's own business");
    assert.equal(firstLineTitle("x".repeat(100)).length, 80);
  });
});

describe("the harness's side", () => {
  test("the create call asks the server to name the session, unless a name is given", () => {
    assert.equal(sessionStartBody({}, "C:/p", "m").autoTitle, true);
    const named = sessionStartBody({}, "C:/p", "m", "Mine");
    assert.equal(named.title, "Mine");
    assert.equal("autoTitle" in named, false);
  });

  test("the typed name skips a command Filament answered", () => {
    const turns = [{ userText: "/set model.maxTokens 2000", command: true }, { userText: "fix the login bug" }];
    assert.equal(firstMessageName(turns, () => true), "fix the login bug");
    assert.equal(firstMessageName([{ userText: "/goal help", command: true }], () => true), "", "commands only: no name");
    assert.equal(firstMessageName([{ userText: "old", past: true }, { userText: "new" }], (t) => !t.past), "new");
  });

  // (fails before: yes — the drive of 11-04: a chat whose first message the page sent, then woken by a letter, was named
  // by the wake's message — the first one the server's copy held — until the page was loaded again)
  test("the name skips a message that is Filament's own: a wake, a resume, a sync, a team's or a flow's result, a coding agent's own turn", () => {
    const filaments = [{ by: "wake", woke: true }, { by: "resume", resumed: true }, { by: "sync", synced: true }, { by: "beside", teamResult: true }, { by: "flow", flowSaid: "on" }, { by: "agent", own: { agent: "Claude Code" } }];
    for (const mark of filaments) assert.equal(firstMessageName([{ userText: "[Filament: a letter from another chat has come for you…]", history: true, ...mark }, { userText: "later", history: true }], (t) => t.history), "later", JSON.stringify(mark));
  });
});

describe("end to end: /set first, then a message", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */ let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */ let shim;
  /** @type {string} */ let root;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-title-e2e-"));
    up = await fakeUpstream(() => anthropicReply("on it", { model: "brain-model" }));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true });
  });
  /** @param {any} body */
  const create = async (body) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model", preset: null, ...body } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    return r.text();
  };
  const titleOf = async (/** @type {string} */ id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}`)).json()).identity?.title ?? null;

  // (fails before: yes — the harness titled the session with its first message at create, "/set …" included)
  test("the session is named by the message, not the command; a command-only session stays unnamed", async () => {
    const id = await create(sessionStartBody({}, root, "brain-model"));
    await turn(id, "/goal help");
    assert.equal(await titleOf(id), null, "Filament answered it: no name yet");
    await turn(id, "fix the login bug\nand add a test");
    assert.equal(await titleOf(id), "fix the login bug");
    assert.ok(up.received.some((c) => JSON.stringify(c.body).includes("fix the login bug")), "the message reached the model");
    const only = await create(sessionStartBody({}, root, "brain-model"));
    await turn(only, "/goal help");
    assert.equal(await titleOf(only), null);
    const mine = await create({ title: "Mine" });
    await turn(mine, "hello");
    assert.equal(await titleOf(mine), "Mine", "a name given at create is the name");
  });
});
