// HarnessV3 Step 3, Phase 3E (D16): the session's Stop, and where a chat's live news goes. An outside client's turn is
// that client's: it holds no chat, so the bus hears only its end (`turns`, with no holder), and the session's Stop
// leaves it be. A
// harness chat's holder changes and a coding agent's tasks ride the events feed every page holds (`turns`, with the
// chat's id) and no topic of the chat's own, and a session has no live stream of its own to follow.
import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until, upstreamControls, readEvents } from "./helpers/wait.js";
import { textOpen, textDelta, textClose, toolOpen, toolInput, toolClose, textsOf } from "./helpers/sse.js";
import { chainKeyForConversationId } from "../src/services/memory/brain.js";

const SYS = { role: "system", content: "You help." };
const person = (text) => ({ role: "user", content: [{ type: "text", text }] });
const replyText = (m) =>
  Array.isArray(m?.content) ? m.content.filter((b) => b?.type === "text").map((b) => b.text).join("") : String(m?.content ?? "");

/**
 * What the bus says of a chat while a test runs: each topic named for the chat (`own`), and each holder change the
 * events feed's `turns` says of it (`holders`).
 * @param {any} app @param {string} chainId
 */
const hear = (app, chainId) => {
  /** @type {string[]} */
  const own = [];
  /** @type {any[]} */
  const holders = [];
  const off = app.events.subscribe("*", (/** @type {any} */ p, /** @type {any} */ e) => {
    if (String(e.topic).includes(chainId)) own.push(e.topic);
    else if (e.topic === "turns" && p?.type === "turn" && p.chainId === chainId) holders.push(p.holder);
  });
  return { own, holders, off };
};

describe("the stop, and a chat's live news on the events feed alone (D16)", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root;
  /** @type {any[]} */
  let upstreamCalls = [];
  /** @type {((call: any) => any)[]} */
  let script = [];
  const setScript = (...fns) => {
    script = fns;
    upstreamCalls = [];
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-live-"));
    up = await fakeUpstream(async (call) => {
      upstreamCalls.push(call);
      const fn = script[Math.min(Math.max(upstreamCalls.length - 1, 0), script.length - 1)];
      return fn ? fn(call) : anthropicReply("ok", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, root]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
  const { feed, letGo } = upstreamControls();
  afterEach(letGo);
  const archive = () => /** @type {any} */ (shim.app.memory).archive;
  const zcPost = (messages, sid = "lv-1", extra = {}) =>
    shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages, ...extra }, { "x-session-id": sid, "x-filament-cwd": root, "user-agent": "opencode/1.0" });
  /** OpenCode opens the session: one turn, answered "a one" — the history every later request of the test resends. */
  const seed = async (sid) => {
    setScript(() => anthropicReply("a one", { model: "m-1" }));
    assert.equal((await zcPost([SYS, person("one")], sid)).status, 200);
    return archive().chainIdForKey(chainKeyForConversationId(sid));
  };
  /** The session's Stop, as the harness presses it: 200, and what it answered. @param {string} chainId */
  const stopFromHarness = async (chainId) => {
    const stop = await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/stop`, { method: "POST" });
    const text = await stop.text();
    assert.equal(stop.status, 200, text);
    return JSON.parse(text);
  };

  // (fails before: yes — on c97b98c59 each holder change went out on the chat's own topic, `session:<id>`, too, and
  // GET /sessions/:id/live answered with that topic's stream, which no page followed; on 1d8c5f5c4 the turn gate's take
  // and release of the client's chat went out on `turns`; on b7fbcdb6a nothing said the client's turn ended)
  test("an outside client's turn, streamed or JSON, says only its end of its chat on the bus — no holder on `turns`, no topic of its own — and the session has no live stream to follow", async () => {
    const sid = "lv-quiet";
    const chainId = await seed(sid);
    const heard = hear(shim.app, chainId);
    try {
      const upstream = feed([...textOpen(), textDelta("one ")]);
      setScript(() => upstream);
      const history = [SYS, person("one"), { role: "assistant", content: "a one" }, person("stream it")];
      const client = readEvents(await zcPost(history, sid, { stream: true }));
      await until(() => textsOf(client.events).length === 1, "the first delta to reach the client");
      upstream.push(textDelta("two "));
      upstream.end(...textClose());
      await until(() => client.ended, "the client's stream to end");
      assert.deepEqual(textsOf(client.events), ["one ", "two "], "the client got its whole reply");
      // The same window's next turn over JSON, a tool call: nothing holds the chat for its leg
      setScript(() => ({
        status: 200,
        json: { id: "msg_q", type: "message", role: "assistant", model: "m-1", content: [{ type: "tool_use", id: "toolq", name: "Read", input: { path: "q" } }], stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } },
      }));
      const json = await zcPost([...history, { role: "assistant", content: "one two " }, person("read q")], sid);
      assert.equal((await json.json()).stop_reason, "tool_use");
    } finally {
      heard.off();
    }
    assert.deepEqual(heard.own, [], "no topic of the chat's own");
    assert.deepEqual(heard.holders, [null], "on `turns`, the streamed turn's end alone, with no holder: the client's requests hold no chat, and the tool call's turn has not ended");
    assert.equal(/** @type {any} */ (shim.app.sessionTurns).holder(archive().getChain(chainId).key), null, "and the lock names nobody");
    const live = await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/live`);
    const answer = live.status === 404 ? await live.json() : (await live.body?.cancel(), null);
    assert.deepEqual([live.status, answer], [404, { error: `unknown admin endpoint GET /sessions/${chainId}/live` }], "no live stream of the session's own");
  });

  // (fails before: yes — on b4ee117a2 the session's Stop cut an outside client's stream at its next chunk with
  // "⏹ Stopped from Filament's harness." and end_turn, stamped its turn stopped, and answered the next leg of a tool call
  // that streamed on with the stop, in the model's place)
  test("the session's Stop with an outside client's turn running stops nothing: its stream runs to its own end, and a tool call's next leg goes to the model", async () => {
    const sid = "lv-stop";
    const chainId = await seed(sid);
    const upstream = feed([...textOpen(), textDelta("alpha ")]);
    setScript(() => upstream);
    const history = [SYS, person("one"), { role: "assistant", content: "a one" }, person("tell me a long story")];
    const client = readEvents(await zcPost(history, sid, { stream: true }));
    await until(() => textsOf(client.events).length === 1, "the first delta to reach the client");
    assert.deepEqual(await stopFromHarness(chainId), { ok: true, holder: null, stopped: null }, "the stop reached no turn of the harness's");
    upstream.push(textDelta("beta "));
    upstream.end(...textClose());
    await until(() => client.ended, "the stream to run to its end");
    assert.deepEqual(textsOf(client.events), ["alpha ", "beta "], "the whole reply, with nothing cut into it");
    assert.ok(!JSON.stringify(client.events).includes("Stopped from Filament"), "no stop note");
    const rec = await shim.record((await shim.records(1))[0].id);
    assert.equal(rec.stopped, undefined, "the record says no stop");
    assert.equal(archive().getTurns(chainId).at(-1)?.meta?.stopped, undefined, "the turn is not stamped stopped");
    // A Stop while a tool call streams: the call runs to its end, and its leg goes to the model
    const tool = feed([...toolOpen("tool1"), toolInput('{"path"')]);
    setScript(() => tool);
    const asked = [...history, { role: "assistant", content: "alpha beta " }, person("read the file")];
    const second = readEvents(await zcPost(asked, sid, { stream: true }));
    const inputs = () => second.events.filter((e) => e.data?.delta?.type === "input_json_delta").length;
    await until(() => inputs() === 1, "the tool call to reach the client");
    assert.deepEqual(await stopFromHarness(chainId), { ok: true, holder: null, stopped: null });
    tool.push(toolInput(': "x"}'));
    tool.end(...toolClose());
    await until(() => second.ended, "the tool call to run to its end");
    setScript(() => anthropicReply("the file says hi", { model: "m-1" }));
    const leg = await zcPost([...asked, { role: "assistant", content: [{ type: "tool_use", id: "tool1", name: "Read", input: { path: "x" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "tool1", content: "bytes" }] }], sid);
    assert.equal(leg.status, 200);
    assert.equal(replyText({ content: (await leg.json()).content }), "the file says hi", "the leg went to the model");
    assert.equal(upstreamCalls.length, 1, "and reached it");
    assert.equal(archive().getChain(chainId).meta?.pendingStop, undefined, "nothing waits to answer a leg");
  });

  // (fails before: yes — on c97b98c59 a harness chat's every holder change went out on its own topic, `session:<id>`,
  // too)
  test("a harness chat's turns say their holder on the events feed's `turns` alone, each take and its release", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1" } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = (await made.json()).id;
    const heard = hear(shim.app, id);
    try {
      setScript(() => anthropicReply("done here", { model: "m-1" }));
      for (const content of ["first", "second"]) {
        const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
        assert.equal(t.status, 200, await t.clone().text());
        await t.text();
      }
    } finally {
      heard.off();
    }
    assert.deepEqual(heard.own, [], "no topic of the chat's own");
    const holders = heard.holders;
    assert.ok(holders.length >= 4 && holders.filter((h) => h === null).length === 2 && holders.at(-1) === null, `each turn's holder went out on \`turns\`: ${JSON.stringify(holders)}`);
    assert.ok(holders.filter(Boolean).every((h) => h.window === "harness"), "the harness's own turns");
  });

  test("the line-fork route opens a rewound line", async () => {
    const sid = "lv-4";
    const chainId = await seed(sid);
    setScript(() => anthropicReply("ok", { model: "m-1" }));
    for (const t of ["two", "three", "four"]) assert.equal((await zcPost([SYS, person(t)], sid)).status, 200);
    // rewind: the history holds turn 1 only, plus a new ask
    assert.equal((await zcPost([SYS, person("one"), { role: "assistant", content: "a one" }, person("edited")], sid)).status, 200);
    const marked = archive().getTurns(chainId).filter((t) => t.meta?.rewound);
    assert.ok(marked.length, "a line was marked");
    const line = marked[0].meta.rewound.line;
    const fork = await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/lines/${encodeURIComponent(line)}/fork`, { method: "POST" });
    assert.equal(fork.status, 200);
    const body = await fork.json();
    assert.ok(body.id && body.id !== chainId, "the fork is its own session");
    // (fails before: yes — the route recorded under an operation kind that does not exist, so the log dropped it)
    const ops = await (await shim.api("/api/ops?kinds=archive&limit=50")).json();
    const line_op = ops.ops.find((o) => o.sub === "fork" && o.ref?.chainId === body.id);
    assert.ok(line_op, "the line fork keeps the same durable line a fork keeps");
    assert.match(line_op.title, /rewound line .* opened as/);
  });
});

// A chat's news while no turn of the harness's holds it: its coding agent's tasks.
describe("a chat's coding agent's tasks ride the events feed alone", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-live3-"));
    up = await fakeUpstream(async () => anthropicReply("a one", { model: "m-1" }));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, root]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
  const newChat = async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1" } });
    assert.equal(made.status, 200, await made.clone().text());
    return (await made.json()).id;
  };

  // (fails before: yes — on e7f453755 a coding agent's tasks rode the chat's live topic alone, which the harness page
  // followed for the chat shown: a stream more beside its events feed, idle or not; on c97b98c59 they rode it as well)
  test("a coding agent's tasks ride the events feed every page holds, with the chat's id, whoever holds the chat, and no topic of the chat's own", async () => {
    const id = await newChat();
    const heard = hear(shim.app, id);
    const feed = readEvents(await shim.api("/api/events"));
    try {
      await until(() => feed.events.some((e) => e.data?.type === "hello"), "the feed to open");
      const tasks = [{ id: "t1", kind: "local_bash", description: "npm test", background: true }];
      shim.app.acp.onTasks({ chain: id, sessionId: "agent-1", tasks });
      shim.app.acp.onTasks({ chain: id, sessionId: "agent-1", tasks: [] });
      // This chat's: the feed carries every chat's, a list another test's chat said last among them.
      const said = () => feed.events.filter((e) => e.data?.type === "agent-tasks" && e.data.chainId === id).map((e) => e.data);
      await until(() => said().length === 2, "both lists on the feed");
      assert.deepEqual(said(), [
        { type: "agent-tasks", chainId: id, sessionId: "agent-1", tasks },
        { type: "agent-tasks", chainId: id, sessionId: "agent-1", tasks: [] },
      ]);
    } finally {
      heard.off();
      await feed.stop();
    }
    assert.deepEqual(heard.own, [], "no topic of the chat's own");
  });
});

describe("the live page's DOM-free parts (D15/D16)", () => {
  test("the rewound row says the §5 words and opens the fork", async () => {
    const { rewoundRow } = await import("../src/ui/harness/conversation/rewound.js");
    /** @type {any[]} */
    const made = [];
    const hFake = (tag, attrs = {}, ...kids) => {
      const node = { tag, attrs, kids };
      made.push(node);
      return node;
    };
    const opened = [];
    const forked = [];
    const el = rewoundRow(
      // the server's shape (Facade D13): the transcript decorates the mark with the line's range and the
      // re-winding window's client as both the id and the server's words for it
      { n: 5, client: "opencode", clientLabel: "OpenCode", rewound: { from: 5, to: 7, line: "r1", by: "h:z", client: "opencode", clientLabel: "OpenCode" } },
      { chainId: "c1" },
      { h: hFake, open: (row) => opened.push(row), fork: async (chainId, line) => (forked.push([chainId, line]), { id: "fork-9" }) },
    );
    const words = JSON.stringify(el);
    assert.ok(words.includes("Turns 5–7 were rewound in OpenCode"), words);
    // The Designer's line of 10-27: a compaction's dashed line, its turns kept — they open as a fork.
    assert.ok(words.includes("Open as a fork") && !words.includes("Undo"), "another window's line has no Undo here");
    const button = made.find((n) => n.tag === "button");
    assert.ok(button, "the fork button exists");
    await button.attrs.onclick();
    assert.deepEqual(forked, [["c1", "r1"]], "the button posts the line-fork route");
    assert.deepEqual(opened, [{ id: "fork-9" }], "and opens what comes back");
  });

  // (fails before: yes — HarnessV4_Tasks C5: the Stop was a bare fetch that named no content type, and the admin API
  // answers a page's write without one 415: the turn was never stopped)
  test("the queue's Stop goes through the admin client (the waiting module posts /stop)", async () => {
    const { createWaitingQueue } = await import("../src/ui/harness/waiting.js");
    /** @type {any[]} */
    const posted = [];
    const post = async (/** @type {string} */ path, /** @type {any} */ init) => {
      posted.push([path, init?.method]);
      throw new Error("no route yet");
    };
    {
      // The Stop the page offers for a coding agent's turn of its own (live-topic-page.test.js).
      let held = /** @type {any} */ ({ window: "harness", client: "harness", since: 0, idleMs: 0, own: { agent: "Claude Code" } });
      const q = createWaitingQueue({ content: "x", holder: held, free: async () => held, send: async () => null, pollMs: 10_000, post });
      /** @type {string[]} */
      const fails = [];
      await q.stop("/sessions/c1/stop", (why) => fails.push(why));
      assert.deepEqual(posted, [["/sessions/c1/stop", "POST"]], "Stop posts the route");
      assert.deepEqual(fails, ["no route yet"], "a failing stop is said, not silent");
      held = null;
      q.cancel();
    }
  });
});
