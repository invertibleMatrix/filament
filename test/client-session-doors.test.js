// A client's session is its client's (the owner's rules of 10-31: an outside client gets a plain proxy plus memory):
// the harness writes into none — a turn, a compaction, a rewind or a move of one is refused, all but the compaction
// with the fork to go on in once a turn has finished — and the chats the harness forks are its own, which no client
// reaches. The harness names itself with a header only Filament's own calls keep.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, upstreamControls } from "./helpers/wait.js";
import { chainKeyForConversationId, clientOf } from "../src/services/memory/brain.js";
import { admitHeaders } from "../src/services/house.js";

describe("the harness and a client's session", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  /** The upstream's next answer, where a test holds it. @type {null | ((call: any) => any)} */ let next = null;
  const { hold, letGo } = upstreamControls();
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-doors-"));
    up = await fakeUpstream((/** @type {any} */ c) => (next ? next(c) : anthropicReply(`answer ${c.n}`, { model: "brain-model" })));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    letGo();
    await shim.stop();
    await up.close();
    // The chats' folder, which a git Filament asks there may still hold as it ends.
    await removeDirs(root);
  });
  const archive = () => /** @type {any} */ (shim.app.memory.archive);
  /** An OpenCode session of one finished turn. @param {string} sid */
  const clientSession = async (sid) => {
    const r = await shim.post("/v1/messages", { model: "brain-model", max_tokens: 64, system: `You help.\nWorking directory: ${root}`, messages: [{ role: "user", content: "hello" }] }, { "x-session-id": sid, "user-agent": "OpenCode/1.4.0" });
    assert.equal(r.status, 200, await r.clone().text());
    await r.text();
    const id = archive().chainIdForKey(chainKeyForConversationId(sid));
    assert.ok(id, "the client's session is archived");
    return String(id);
  };
  /** @param {string} id @param {string} content */
  const harnessTurn = (id, content) => shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });

  // (fails before: yes — the harness's turn ran in the client's session, its message and the model's answer written
  // there as the harness's window)
  test("a harness turn into a client's session is refused with the fork to go on in, and writes nothing", async () => {
    const id = await clientSession("zc-turn");
    const turns = archive().getTurns(id).length;
    const asked = up.received.length;
    const r = await harnessTurn(id, "go on from here");
    assert.equal(r.status, 409, await r.clone().text());
    const b = await r.json();
    assert.equal(b.error, "this session is OpenCode's: the harness goes on in a fork of it");
    assert.deepEqual(b.fork, { method: "POST", path: `/api/sessions/${encodeURIComponent(id)}/fork`, atTurn: 1 });
    assert.equal(archive().getTurns(id).length, turns, "no turn written");
    assert.equal(up.received.length, asked, "the model was not called");
  });

  // (fails before: yes — the harness's fork kept a key a client reaches (`h:` of the `fork-…` id it answered with), so a
  // client sending that id in x-filament-conversation wrote into the harness's chat)
  test("the harness's fork of a client's session is its own: keyed as the harness keys its chats, no client conversation id, and it takes the turn", async () => {
    const id = await clientSession("zc-fork");
    const made = await shim.api(`/api/sessions/${encodeURIComponent(id)}/fork`, { method: "POST", body: { atTurn: 1 } });
    assert.equal(made.status, 200, await made.clone().text());
    const fork = await made.json();
    assert.equal(fork.conversationId, undefined, "no id a client could send");
    const row = archive().getChain(fork.chainId);
    assert.equal(row.key, `n:${fork.chainId}`);
    assert.equal(row.meta?.native, true);
    const turn = await harnessTurn(fork.chainId, "go on");
    assert.equal(turn.status, 200, await turn.clone().text());
  });

  // (fails before: yes — Compact now compacted a client's session, whose client owns its history)
  test("a compaction of a client's session is refused: its client compacts it", async () => {
    const id = await clientSession("zc-compact");
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/compact`, { method: "POST", body: { method: "fold" } });
    assert.equal(r.status, 409, await r.clone().text());
    const b = await r.json();
    assert.equal(b.error, "this session is OpenCode's: its client owns the history and compacts it");
    assert.equal(b.fork, undefined);
    assert.equal(archive().getCompactions(id).length, 0, "nothing compacted");
  });

  // (fails before: yes — the harness rewound a client's session in place, marking its client's turns a rewound line)
  test("a rewind of a client's session is refused with the fork to rewind instead", async () => {
    const id = await clientSession("zc-rewind");
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/rewind`, { method: "POST", body: { turn: 1, what: "conversation" } });
    assert.equal(r.status, 409, await r.clone().text());
    const b = await r.json();
    assert.equal(b.error, "this session is OpenCode's: the harness rewinds a fork of it");
    assert.equal(b.fork?.atTurn, 1);
    assert.equal(archive().getTurns(id).some((/** @type {any} */ t) => t.meta?.rewound), false, "nothing rewound");
  });

  // (fails before: yes — a rewound line opened as a fork was no chat of the harness's own (`native` unset), so the
  // harness's next turn there was refused as a client's)
  test("a rewound line of the harness's chat opens as a chat of its own, in the chat's folder, and takes the next turn", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model", preset: "plain" } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    for (const words of ["one", "two"]) assert.equal((await harnessTurn(id, words)).status, 200);
    const back = await shim.api(`/api/sessions/${encodeURIComponent(id)}/rewind`, { method: "POST", body: { turn: 2, what: "conversation" } });
    assert.equal(back.status, 200, await back.clone().text());
    const line = archive().getTurns(id).find((/** @type {any} */ t) => t.meta?.rewound)?.meta.rewound.line;
    assert.ok(line, "turn 2 is a rewound line");
    const opened = await shim.api(`/api/sessions/${encodeURIComponent(id)}/lines/${encodeURIComponent(line)}/fork`, { method: "POST" });
    assert.equal(opened.status, 200, await opened.clone().text());
    const fork = await opened.json();
    const row = archive().getChain(fork.id);
    assert.equal(row.meta?.native, true);
    assert.equal(row.meta?.cwd, archive().getChain(id).meta?.cwd);
    const turn = await harnessTurn(fork.id, "three");
    assert.equal(turn.status, 200, await turn.clone().text());
  });

  // (fails before: yes — the refusal pointed at a fork of turn null, which the fork route refuses with 400)
  test("a client's session whose first turn has not ended is refused with no fork to go to", async () => {
    const sid = "zc-first";
    const held = hold(anthropicReply("late", { model: "brain-model" }));
    next = held.script;
    const first = shim.post("/v1/messages", { model: "brain-model", max_tokens: 64, system: `You help.\nWorking directory: ${root}`, messages: [{ role: "user", content: "hello" }] }, { "x-session-id": sid, "user-agent": "OpenCode/1.4.0" });
    try {
      await held.arrived;
      const id = archive().chainIdForKey(chainKeyForConversationId(sid));
      assert.ok(id, "the session exists while its first turn runs");
      const r = await harnessTurn(String(id), "too soon");
      assert.equal(r.status, 409);
      const b = await r.json();
      assert.equal(b.error, "this session is OpenCode's: the harness goes on in a fork of it");
      assert.equal(b.fork, undefined, "no finished turn to fork at");
    } finally {
      next = null;
      held.release();
      await (await first).text();
    }
  });

  // (fails before: yes — a session of no client's, as a rewound line of the harness's chat opened before such forks
  // were its own, read "this session is its client's")
  test("a session that is no chat of the harness's own and names no client is refused in those words", async () => {
    const row = archive().chainForKey("h:an-older-line-fork", { cwd: root, client: "harness" });
    const r = await harnessTurn(String(row.id), "go on");
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, "this session is no chat of the harness's own: the harness goes on in a fork of it");
  });

  // (fails before: yes — the move (on f351a2773) and the sheet's read of it (on a78e4eb17) went on to plan the client's
  // chat's folder, refused here only because that folder is in no git repository)
  test("a move of a client's chat is refused with the fork to move instead, and so is the move sheet's read of it", async () => {
    const id = await clientSession("zc-move");
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/move`, { method: "POST", body: { to: { name: "elsewhere", made: true } } });
    const b = await r.json();
    assert.deepEqual([r.status, b.error, b.fork?.atTurn], [409, "this session is OpenCode's: the harness moves a fork of it", 1]);
    const read = await shim.api(`/api/sessions/${encodeURIComponent(id)}/move?name=elsewhere&made=1`);
    const said = await read.json();
    assert.deepEqual([read.status, said.error, said.plan], [409, "this session is OpenCode's: the harness moves a fork of it", undefined]);
  });

  // (fails before: yes — a Space sync's note "now" went into the running turn of a client's coding agent, its run's
  // mailbox holding Filament's words)
  test("a Space sync's note never goes into a client's running turn, which holds no chat", async () => {
    const id = await clientSession("zc-steer");
    const chain = archive().getChain(id);
    const runs = /** @type {any} */ (shim.app.runs);
    runs.startRun({ id: "zc-steer-run", kind: "coding-agent", meta: { chain: id, steer: "queued" } });
    assert.equal(/** @type {any} */ (shim.app.sessionTurns).holder(chain.key), null, "OpenCode's turn holds no lock of its chat");
    try {
      const space = `/api/space/${encodeURIComponent(String(chain.project_id))}`;
      assert.equal((await shim.api(space, { method: "POST" })).status, 200, "its project's Space");
      const synced = await shim.api(`${space}/sync`, { method: "POST", body: { lanes: [{ chain: id, when: "now" }] } });
      assert.equal(synced.status, 200, await synced.clone().text());
      assert.deepEqual(runs.mailbox("zc-steer-run").read().map((/** @type {any} */ m) => m.text), [], "nothing of Filament's in the client's run");
    } finally {
      runs.endRun("zc-steer-run");
    }
  });

  // (fails before: yes — the run's stop marked the client's chat as stopped by the person)
  test("a stop of a run Filament runs for a client's request ends the run and marks nothing of the client's chat", async () => {
    const id = await clientSession("zc-run-stop");
    const runs = /** @type {any} */ (shim.app.runs);
    runs.startRun({ id: "zc-run-stop-run", kind: "coding-agent", meta: { chain: id, steer: "queued" } });
    try {
      const r = await shim.api("/api/runs/zc-run-stop-run/steer", { method: "POST", body: { kind: "stop", text: "", from: "harness" } });
      assert.equal(r.status, 200, await r.clone().text());
      assert.deepEqual(runs.mailbox("zc-run-stop-run").read().map((/** @type {any} */ m) => m.kind), ["stop"], "the run takes the stop");
      assert.equal(archive().getChain(id).meta?.lastStop, undefined, "no stop of the person's marked on the client's chat");
    } finally {
      runs.endRun("zc-run-stop-run");
    }
  });

  // (fails before: yes — on e7f453755, with the harness's turn holding its chat before it named its request, a Space
  // sync's note went into the first turn running in the chat, whoever's). The note taken, the sync parks no lane, and
  // no turn of its runs past the test.
  test("a Space sync's note reaches the harness's own request, and only it, while its turn has not named one yet", async () => {
    const made = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model", preset: "plain", title: "steer filter" } })).json();
    const chain = archive().getChain(made.id);
    const runs = /** @type {any} */ (shim.app.runs);
    const turns = /** @type {any} */ (shim.app.sessionTurns);
    const usage = /** @type {any} */ (shim.app.usage);
    /** @type {any} */
    let held = null;
    try {
      runs.startRun({ id: "not-the-harness-run", kind: "coding-agent", meta: { chain: made.id, steer: "queued" } });
      runs.startRun({ id: "the-harness-run", kind: "coding-agent", meta: { chain: made.id, steer: "queued" } });
      usage.byId.set("the-harness-run", { id: "the-harness-run", api: "session" });
      held = await turns.acquire(chain.key, { window: "harness", client: "harness" });
      assert.ok(held.ok, "the harness's turn holds its chat, no request named yet");
      const space = `/api/space/${encodeURIComponent(String(chain.project_id))}`;
      assert.equal((await shim.api(space, { method: "POST" })).status, 200, "its project's Space");
      const synced = await shim.api(`${space}/sync`, { method: "POST", body: { lanes: [{ chain: made.id, when: "now" }] } });
      assert.equal(synced.status, 200, await synced.clone().text());
      assert.deepEqual(runs.mailbox("not-the-harness-run").read().map((/** @type {any} */ m) => m.text), [], "nothing of Filament's in a run that is no request of the harness's");
      assert.equal(runs.mailbox("the-harness-run").read().length, 1, "the note in the harness's own request");
    } finally {
      runs.endRun("not-the-harness-run");
      runs.endRun("the-harness-run");
      usage.byId.delete("the-harness-run");
      if (held?.ok) turns.release(chain.key, held.token);
    }
  });

  // (fails before: yes, on e7f453755 — a client's session with a `harness` window, from when the harness took turns in
  // one, carried the harness's compaction plan)
  test("a client's session the harness typed into before carries no compaction plan of Filament's", async () => {
    const id = await clientSession("zc-shared-before");
    archive().mergeMeta(id, { windows: { ...(archive().windowsOf(id) || {}), harness: { client: "harness", lastSeen: 1 } } });
    assert.ok(archive().windowsOf(id)?.harness, "the harness's window, as the older data has it");
    const read = await shim.api(`/api/sessions/${encodeURIComponent(id)}/compose?dry=1&compaction=1`);
    assert.equal(read.status, 200, await read.clone().text());
    const plan = await read.json();
    assert.ok(plan.current && Array.isArray(plan.compactions), "the composed request is read");
    assert.equal(plan.compaction, undefined, "its client compacts it");
  });
});

// (fails before: yes — any client could send `x-filament-client: harness`, or a `harness-` session id, and be taken
// for the harness's window)
test("only Filament's own calls name the harness: its header is set aside from any other caller, and a session id names no client", () => {
  const outside = admitHeaders({ "x-filament-client": "harness", "x-session-id": "zc-1" }, { reads: false });
  assert.equal(outside.headers["x-filament-client"], undefined);
  assert.ok(outside.setAside.dropped.includes("x-filament-client"), JSON.stringify(outside.setAside));
  assert.equal(clientOf(outside.headers), "unknown", "a session id and no user-agent names no client of its own");
  assert.equal(clientOf({ "user-agent": "Mozilla/5.0 (Windows NT 10.0)", "x-session-id": "harness-0f3a" }), "mozilla");
  assert.equal(clientOf({ "x-filament-client": "harness" }), "harness", "the harness's own turns still name it");
});
