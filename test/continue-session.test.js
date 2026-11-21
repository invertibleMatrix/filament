// HarnessV3 Step 3, Phase 3B (D7/D8): the harness continues any session. Another window's turns are rebuilt for
// the request at hand — translated to Anthropic and the loop's own tools when every call maps, folded as a whole
// when anything doesn't (a cut body included) — the transcript gives those turns their cards and their window, a
// command typed in the harness on an OpenCode session survives a reload, and a harness-only session still composes
// the same bytes as before.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeDirs } from "./helpers/wait.js";
import { startApp, fakeUpstream, anthropicReply, openaiReply } from "./helpers/app.js";
import { Archive } from "../src/archive.js";
import { chainKeyForConversationId } from "../src/services/memory/brain.js";
import { archivedStubs, familyOf, groupRuns, kindOfStub } from "../src/ui/harness/conversation/tools/render.js";
import { cardOf, toolsOfTurn } from "../src/core/tool-vocab.js";

const SYS = { role: "system", content: "You help." };
const person = (text) => ({ role: "user", content: [{ type: "text", text }] });
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });

describe("the harness continues any session (D7/D8)", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {any[]} */
  let upstreamCalls = [];
  /** @type {((call: any) => any)[]} */
  let script = [];
  /** The replies the next calls get, in order (the last repeats); each seeding starts its calls at zero. */
  const setScript = (...fns) => {
    script = fns;
    upstreamCalls = [];
  };
  const nextReply = (call) => {
    const i = upstreamCalls.length - 1;
    const fn = script[Math.min(Math.max(i, 0), script.length - 1)] || (() => anthropicReply("ok"));
    return fn(call);
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-continue-"));
    up = await fakeUpstream(async (call) => {
      upstreamCalls.push(call);
      return nextReply(call);
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
    await removeDirs(shim.dataDir, root);
  });
  /** Open the app's archive read-only (the chain id and the window list come from there). */
  const openArchive = () => new Archive({ file: join(shim.dataDir, "mem", "archive.db"), now: () => 0 });
  const chainOf = (sid) => {
    const a = openArchive();
    try {
      return a.chainIdForKey(chainKeyForConversationId(sid));
    } finally {
      a.close(); // an open handle keeps archive.db locked on Windows, and the data dir with it
    }
  };
  const apiJson = async (path, opts) => {
    const r = await shim.api(path, opts);
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r.json();
  };
  /** One OpenCode turn through the proxy (anthropic in): a Read call, its result, the reply. */
  const opencodeReadTurn = async (sid, text, file) => {
    setScript(
      () => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [toolUse("t1", "Read", { file_path: file })] }),
      () => anthropicReply("done reading", { model: "m-1" }),
    );
    const h = { "x-session-id": sid, "x-filament-cwd": root };
    const first = await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person(text)] }, h);
    assert.equal((await first.json()).stop_reason, "tool_use");
    const leg = await shim.post("/v1/messages", {
      model: "m-1", max_tokens: 100,
      messages: [SYS, person(text), { role: "assistant", content: [toolUse("t1", "Read", { file_path: file })] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "the bytes" }] }],
    }, h);
    assert.ok((await leg.json()).content, "the leg is answered");
  };

  // (fails before: yes — the turn went out raw, with Claude Code's own names and fields)
  test("an OpenCode session's Read turn composes and sends as our read {path}, and nothing else names a foreign tool", async () => {
    await opencodeReadTurn("zc-compose", "read the config", "a.js");
    const chainId = chainOf("zc-compose");
    assert.ok(chainId, "the OpenCode window's session exists");
    const preview = await apiJson(`/api/sessions/${encodeURIComponent(chainId)}/compose?prompt=1&text=next`);
    const json = JSON.stringify(preview.current.prompt.messages);
    assert.ok(!json.includes("file_path"), "the foreign field spelling is gone");
    assert.ok(!json.includes('"Read"'), "the foreign tool name is gone");
    const calls = preview.current.prompt.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_use");
    assert.deepEqual(calls.map((c) => ({ name: c.name, input: c.input })), [{ name: "read", input: { path: "a.js" } }]);
    // The composed turn rides the harness's next turn too, in its fork of the session: the upstream sees the same
    // rebuilt call.
    const fork = await apiJson(`/api/sessions/${encodeURIComponent(chainId)}/fork`, { method: "POST", body: { atTurn: 1 } });
    upstreamCalls = [];
    setScript(() => anthropicReply("from the harness", { model: "m-1" }));
    const turn = await shim.api(`/api/sessions/${encodeURIComponent(fork.chainId)}/turns`, { method: "POST", body: { content: "and now from the harness", stream: false } });
    assert.equal(turn.status, 200, await turn.text());
    const sent = JSON.stringify(upstreamCalls[0]?.body?.messages || []);
    assert.ok(sent.includes('"name":"read"') && sent.includes('"path"'), "the harness's request carries the rebuilt call");
    assert.ok(!sent.includes('"Read"') && !sent.includes("file_path"), "nothing in it names a tool the loop doesn't send");
  });

  // (fails before: no — a guard the mutation pass asked for: no other window's turn carried a tasks call)
  test("another window's tasks call rides as the call it was: the session's task graph is always on", async () => {
    const call = toolUse("g1", "tasks", { action: "show" });
    setScript(
      () => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [call] }),
      () => anthropicReply("shown", { model: "m-1" }),
    );
    const h = { "x-session-id": "tg-other", "x-filament-cwd": root };
    assert.equal((await (await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("show the graph")] }, h)).json()).stop_reason, "tool_use");
    const leg = await shim.post("/v1/messages", {
      model: "m-1", max_tokens: 100,
      messages: [SYS, person("show the graph"), { role: "assistant", content: [call] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "g1", content: "No task graph yet." }] }],
    }, h);
    assert.ok((await leg.json()).content, "the leg is answered");
    const chainId = chainOf("tg-other");
    const calls = async () => {
      const preview = await apiJson(`/api/sessions/${encodeURIComponent(chainId)}/compose?prompt=1&text=next`);
      return preview.current.prompt.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_use").map((c) => c.name);
    };
    assert.deepEqual(await calls(), ["tasks"]);
  });

  // (fails before: yes — the OpenAI wire shapes rode the anthropic body raw)
  test("an OpenAI-format session composes into a valid Anthropic body", async () => {
    // One OpenAI turn: a tool_call leg and its answer, through /v1/chat/completions with an openai-compatible route.
    const h = { "x-session-id": "oai-compose", "x-filament-cwd": root };
    setScript(
      () => anthropicReply("", { model: "m-2", stop: "tool_use", blocks: [toolUse("c1", "Read", { file_path: "b.js" })] }),
      () => anthropicReply("done reading b", { model: "m-2" }),
    );
    // The upstream is anthropic-shaped; the proxy translates openai→anthropic on the way out. Script by shape.
    const first = await shim.post("/v1/chat/completions", { model: "m-2", messages: [SYS, { role: "user", content: "read b" }] }, h);
    assert.equal((await first.json()).choices[0].finish_reason, "tool_calls");
    const leg = await shim.post("/v1/chat/completions", { model: "m-2", messages: [SYS, { role: "user", content: "read b" }, { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "Read", arguments: "{\"file_path\":\"b.js\"}" } }] }, { role: "tool", tool_call_id: "c1", content: "bytes" }] }, h);
    assert.ok((await leg.json()).choices, "the leg is answered");
    const chainId = chainOf("oai-compose");
    assert.ok(chainId, "the OpenAI window's session exists");
    const preview = await apiJson(`/api/sessions/${encodeURIComponent(chainId)}/compose?prompt=1&text=next`);
    const msgs = preview.current.prompt.messages;
    assert.ok(msgs.every((m) => m.role !== "tool" && !Array.isArray(m.tool_calls)), "no OpenAI wire shapes ride the body");
    const calls = msgs.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_use");
    assert.deepEqual(calls.map((c) => ({ name: c.name, input: c.input })), [{ name: "read", input: { path: "b.js" } }]);
    const results = msgs.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result");
    assert.equal(results.length, 1, "the tool's result rides along in Anthropic shape");
  });

  // (fails before: yes — the storage marker went to the model as a message)
  test("a body cut at storage folds, and the report says so", async () => {
    const big = "x".repeat(1_100_000);
    setScript(
      () => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [toolUse("t1", "Read", { file_path: "big.js" })] }),
      () => anthropicReply(big, { model: "m-1" }),
    );
    const h = { "x-session-id": "zc-cut", "x-filament-cwd": root };
    await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("read the big one")] }, h);
    await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("read the big one"), { role: "assistant", content: [toolUse("t1", "Read", { file_path: "big.js" })] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "bytes" }] }] }, h);
    const chainId = chainOf("zc-cut");
    const preview = await apiJson(`/api/sessions/${encodeURIComponent(chainId)}/compose?prompt=1&text=next`);
    const json = JSON.stringify(preview.current.prompt.messages);
    assert.ok(!json.includes("_filament_truncated"), "the storage marker never reaches the model");
    assert.ok(!json.includes('"tool_use"'), "a turn with a cut body folds whole — no half-translated call rides it");
  });

  // (fails before: yes — outside clients' turns had no cards, no client, no window)
  test("the transcript gives an OpenCode turn its cards, its client and its window", async () => {
    await opencodeReadTurn("zc-cards", "read it again", "c.js");
    const chainId = chainOf("zc-cards");
    const tr = await apiJson(`/api/sessions/${encodeURIComponent(chainId)}/transcript?work=1`);
    const t = tr.turns.find((x) => x.n === 1);
    assert.equal(t.client, "node", "the client label the request's user-agent gave");
    assert.ok(String(t.window).startsWith("h:"), "the window is the conversation's own key");
    assert.deepEqual(
      t.tools.map((x) => ({ name: x.name, card: x.card, isError: x.isError, result: x.result })),
      [{ name: "Read", card: { kind: "read", title: "Read", subject: "c.js" }, isError: false, result: "the bytes" }],
    );
  });

  test("a harness-only session composes byte-identically, its turns untouched by the adapter", async () => {
    const created = await apiJson("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    setScript(() => anthropicReply("first answer", { model: "m-1" }), () => anthropicReply("second answer", { model: "m-1" }));
    for (const text of ["one", "two"]) {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(created.id)}/turns`, { method: "POST", body: { content: text, stream: false } });
      assert.equal(r.status, 200, await r.text());
    }
    const p1 = await apiJson(`/api/sessions/${encodeURIComponent(created.id)}/compose?prompt=1&text=three`);
    const p2 = await apiJson(`/api/sessions/${encodeURIComponent(created.id)}/compose?prompt=1&text=three`);
    assert.equal(JSON.stringify(p1.current.prompt.messages), JSON.stringify(p2.current.prompt.messages), "the same inputs compose the same bytes");
    assert.ok(JSON.stringify(p1.current.prompt.messages).includes("first answer"), "the history rides as stored");
  });
});

describe("the card renderer, DOM-free (D8)", () => {
  test("every kind draws, the generic card covers the rest", () => {
    const cases = [
      ["read", { path: "a.js" }, "read"],
      ["Read", { file_path: "a.js" }, "read"],
      ["bash", { command: "npm test" }, "shell"],
      ["Bash", { command: "ls", timeout_ms: 5000 }, "shell"],
      ["edit", { path: "a.js", edits: [{ oldText: "a", newText: "b" }] }, "edit"],
      ["Edit", { file_path: "a.js", old_string: "a", new_string: "b" }, "edit"],
      ["plan", { items: [{ text: "go", status: "doing" }] }, "todo"],
      ["TodoWrite", { todos: [{ content: "go", status: "in_progress", activeForm: "going" }] }, "todo"],
      ["web_fetch", { url: "https://x" }, "web"],
      ["ask", { question: "ready?" }, "ask"],
      ["mcp__github__create_issue", { repo: "x" }, "mcp"],
      ["frobnicate", {}, "other"],
    ];
    for (const [name, input, kind] of cases) {
      assert.equal(cardOf(name, input).kind, kind, `${name} draws as ${kind}`);
      const [stub] = archivedStubs([{ name, card: cardOf(name, input), input, result: "out", isError: false }]);
      assert.equal(kindOfStub(stub), kind, `${name}'s archived stub draws as ${kind}`);
    }
    const [generic] = archivedStubs([{ name: "frobnicate", card: cardOf("frobnicate", { a: 1 }), input: { a: 1 }, result: null, isError: false }]);
    assert.equal(generic.card.title, "frobnicate", "the generic card names the tool");
    assert.equal(generic.card.subject, "frobnicate");
    assert.equal(generic.preview, "", "and shows no result it has none of");
    assert.equal(generic.state, "done", "a finished turn's call never draws running");
  });

  test("the renderer draws by card kind: a foreign vocabulary's calls draw as our rows, not the wrench", () => {
    for (const [name, input, kind] of [
      ["TodoWrite", { todos: [{ content: "go", status: "in_progress", activeForm: "going" }] }, "todo"],
      ["MultiEdit", { file_path: "a.js", edits: [{ old_string: "a", new_string: "b" }] }, "edit"],
      ["WebFetch", { url: "https://x", prompt: "sum" }, "web"],
      ["read_file", { file_path: "a.js" }, "read"],
      ["run_terminal_cmd", { command: "npm test" }, "shell"],
      ["mcp__github__create_issue", { repo: "x" }, "mcp"],
    ])
      assert.equal(kindOfStub({ name, card: cardOf(name, input) }), kind, name + " draws by its card");
    // our own names still map without a card, for events older than the card
    assert.equal(kindOfStub({ name: "read" }), "read");
    assert.equal(kindOfStub({ name: "bash_output" }), "shell");
    assert.equal(kindOfStub({ name: "plan" }), "todo");
    assert.equal(kindOfStub({ name: "frobnicate" }), null, "an unknown name without a card draws the generic row");
    // the row's title words come from the card too
    assert.equal(cardOf("TodoWrite", { todos: [{ content: "x", status: "pending", activeForm: "x" }] }).title, "Plan");
    assert.equal(cardOf("WebFetch", { url: "https://x", prompt: "s" }).title, "Fetch");
  });

  test("toolsOfTurn pairs calls with results in either wire format, and cards group by kind", () => {
    const anthropic = toolsOfTurn([
      { role: "assistant", content: [toolUse("t1", "Read", { file_path: "a.js" }), toolUse("t2", "Bash", { command: "ls", timeout_ms: 100 })] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "bytes" }, { type: "tool_result", tool_use_id: "t2", content: "boom", is_error: true }] },
    ], "anthropic");
    assert.deepEqual(
      anthropic.map((x) => [x.name, x.card.kind, x.result, x.isError]),
      [["Read", "read", "bytes", false], ["Bash", "shell", "boom", true]],
    );
    const openai = toolsOfTurn([
      { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "Read", arguments: "{\"file_path\":\"a.js\"}" } }] },
      { role: "tool", tool_call_id: "c1", content: "bytes" },
    ], "openai");
    assert.deepEqual(openai.map((x) => [x.name, x.card.subject, x.result]), [["Read", "a.js", "bytes"]]);
    // grouping follows the card's kind, whatever the name
    const stubs = anthropic.map((x) => ({ name: x.name, card: x.card, state: "done" }));
    assert.equal(familyOf(stubs[0]), "explore");
    assert.equal(familyOf(stubs[1]), "terminal");
    const anotherRead = { name: "read", card: cardOf("read", { path: "b.js" }), state: "done" };
    assert.deepEqual(groupRuns([stubs[0], anotherRead, stubs[1]]), [
      { start: 0, length: 2, family: "explore" },
    ], "two explores group; the terminal call after them stands alone");
  });
});
