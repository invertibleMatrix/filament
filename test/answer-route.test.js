// @ts-check
// One answer route for any ask (the remote-agents plan's f-answer): what waits for the person in a chat — its own turn's
// permission or question, its coding agent's question, its sub-agent's call — is listed by GET /api/sessions/:id/asks
// and answered by POST /api/sessions/:id/asks/:ask/answer, by an option's id or a boolean, never by its words; an ask
// answered once is refused the second time, and an id the chat never asked is not found. `filament chat` asks it at a
// terminal and goes on, and with no terminal ends (exit 4) naming it. Another machine's agents' device reaches the chats
// it started alone — their asks answered, another chat's refused as one that is not there —; revoked, what runs in its
// chats stops; its grant `agents` switched off, what it holds ends. Through real Filaments, a fake provider that asks
// for a command, a question or nothing, and the fake ACP agent.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, parseSse, startApp } from "./helpers/app.js";
import { gate, until } from "./helpers/wait.js";
import { startTwoMachines } from "./helpers/two-machines.js";
import { pinnedFetch } from "../src/services/machines/pinned.js";
import { runCli } from "../src/cli/main.js";
import { EXIT } from "../src/cli/client.js";

const JSON_TYPE = { "content-type": "application/json" };
const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** A message's words. @param {any} m */
const wordsOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));
/** What a tool's result said. @param {any} r */
const resultWords = (r) => (typeof r?.content === "string" ? r.content : (r?.content || []).map((/** @type {any} */ b) => b?.text ?? "").join(""));

/**
 * The model behind the chats: `WRITE <file>` asks to write the file with a command — which a chat in Edit mode asks the
 * person about —, `PICK` asks the person to choose a colour, `SLOW` waits for `slow` to open; the call after a tool's
 * result says `DONE: ` and what the result said.
 * @param {{ promise: Promise<unknown> }} slow
 * @returns {(call: any) => any}
 */
const brain = (slow) => async (call) => {
  if (call.kind !== "anthropic") return undefined;
  const last = call.body.messages.at(-1);
  const result = Array.isArray(last?.content) ? last.content.find((/** @type {any} */ c) => c?.type === "tool_result") : null;
  if (result) return reply([{ type: "text", text: `DONE: ${resultWords(result)}` }]);
  const said = wordsOf(last);
  const file = said.match(/WRITE (\S+)/)?.[1];
  if (file) return reply([toolUse("c1", "bash", { command: `node -e "require('fs').writeFileSync('${file}','1')"` })], "tool_use");
  if (/PICK/.test(said)) return reply([toolUse("c2", "ask", { question: "Which colour?", options: ["red", "blue"] })], "tool_use");
  if (/SLOW/.test(said)) await slow.promise;
  return reply([{ type: "text", text: "MODEL ANSWER" }]);
};

/** The model's provider and the fake ACP agent, and Filament's loop in Edit mode under `root`. @param {any} cfg @param {string} url @param {string} root */
const configure = (cfg, url, root) => {
  cfg.upstreams = [
    { id: "m", name: "m", type: "anthropic", baseUrl: url, apiKey: "s", enabled: true },
    { id: "coder", name: "coder", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: {}, cwdDefault: root, permissions: "allow-all", hints: false } },
  ];
  cfg.routes = [
    { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true },
    { match: "coder/*", upstream: "coder", upstreamModel: "{1}", enabled: true },
  ];
  cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
};

/** The reply's words, streamed. @param {Response} res */
const streamed = async (res) => {
  let said = "";
  for (const { data } of parseSse(await res.text())) if (data?.type === "content_block_delta") said += data.delta?.text ?? "";
  return said;
};

/**
 * A chat's calls on one Filament, by `call` — this computer's own, or another machine's device's.
 * @param {(path: string, o?: { method?: string, body?: unknown, signal?: AbortSignal }) => Promise<Response>} call @param {string} cwd
 */
const chats = (call, cwd) => {
  const S = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
  return {
    /** A new chat, its id. @param {Record<string, unknown>} [o] */
    async create(o = {}) {
      const r = await call("/api/sessions", { method: "POST", body: { cwd, model: "agent/brain-model", preset: "plain", ...o } });
      const j = await r.json();
      assert.equal(r.status, 200, JSON.stringify(j));
      return String(j.id);
    },
    /** A turn whose reply comes whole: its run's id and the reply. @param {string} id @param {string} content */
    async turn(id, content) {
      const r = await call(`${S(id)}/turns`, { method: "POST", body: { content, stream: false } });
      const j = await r.json();
      assert.equal(r.status, 200, JSON.stringify(j));
      return { runId: String(r.headers.get("x-filament-request-id")), reply: j };
    },
    /** The asks the chat waits on. @param {string} id @returns {Promise<any[]>} */
    async asks(id) {
      const r = await call(`${S(id)}/asks`);
      const j = await r.json();
      assert.equal(r.status, 200, JSON.stringify(j));
      return j.asks;
    },
    /** @param {string} id @param {string} ask @param {any} body */
    answer: (id, ask, body) => call(`${S(id)}/asks/${encodeURIComponent(ask)}/answer`, { method: "POST", body }),
    S,
  };
};

/** This computer's calls to a Filament of the test's. @param {Awaited<ReturnType<typeof startApp>>} app */
const local = (app) => (/** @type {string} */ path, /** @type {{ method?: string, body?: unknown, signal?: AbortSignal }} */ { method = "GET", body, signal } = {}) =>
  fetch(`${app.url}${path}`, { method, signal, headers: body === undefined ? {} : JSON_TYPE, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/**
 * A terminal a person answers at: each question, as it waits at the end of what was written, gets `answer(question,
 * screen)` — "" where that says nothing.
 * @param {(q: string, screen: string) => string | undefined} answer
 */
const person = (answer) => {
  const input = /** @type {any} */ (new PassThrough());
  input.setRawMode = () => {};
  const output = new PassThrough();
  let screen = "";
  let at = 0;
  output.on("data", (c) => {
    screen += String(c);
    if (!/(\] |: )$/.test(screen.slice(at))) return;
    const q = screen.slice(at).split("\n").at(-1) || "";
    at = screen.length;
    const a = answer(q, screen) ?? "";
    setImmediate(() => input.write(`${a}\n`));
  });
  return { term: /** @type {any} */ ({ input, output, tty: true }), screen: () => screen };
};
/** The number the screen's last list gives an answer, by its label. @param {string} screen @param {string} label */
const numberOf = (screen, label) => [...screen.matchAll(new RegExp(` {2}(\\d+)\\. ${label}\\n`, "g"))].at(-1)?.[1];

describe("the asks route, on one Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-answer-route-"));
  const slow = gate();
  /** @type {ReturnType<typeof chats>} */
  let c;
  before(async () => {
    up = await fakeUpstream(brain(slow));
    shim = await startApp({ configure: (cfg) => configure(cfg, up.url, root) });
    c = chats(local(shim), root);
  });
  after(async () => {
    slow.open();
    await shim.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // (fails before: yes — there was no asks route: GET /asks and POST /asks/:ask/answer were unknown admin endpoints)
  test("a chat's own permission: listed by the run that paused, its press its options; Allow through the route runs the call and the turn goes on; answered again, 409; an id never asked, 404", async () => {
    const id = await c.create();
    const t = await c.turn(id, "WRITE own-allow.txt");
    assert.match(wordsOf(t.reply), /May I run this command\?/);
    const [ask, ...more] = await c.asks(id);
    assert.deepEqual(more, []);
    assert.deepEqual([ask.id, ask.kind, ask.from, ask.runId, ask.tool, ask.options.map((/** @type {any} */ o) => o.id)], [t.runId, "permission", "chat", t.runId, "bash", ["allow", "deny"]]);
    assert.match(ask.command, /writeFileSync\('own-allow\.txt'/);
    const yes = await c.answer(id, ask.id, { allow: true });
    const j = await yes.json();
    assert.equal(yes.status, 200, JSON.stringify(j));
    assert.match(wordsOf(j), /^DONE: /, "the turn went on: its reply is the answer's");
    assert.equal(existsSync(join(root, "own-allow.txt")), true);
    assert.deepEqual(await c.asks(id), [], "nothing waits now");
    const again = await c.answer(id, ask.id, { allow: true });
    assert.equal(again.status, 409);
    assert.match((await again.json()).error, new RegExp(`ask ${ask.id} waits no more`));
    for (const never of ["r-none", `${t.runId}.q9`, "sa_00000000.1"]) {
      const r = await c.answer(id, never, { allow: true });
      assert.equal(r.status, 404, never);
      assert.equal((await r.json()).error, `no ask ${never} in this chat`);
    }
    assert.equal((await local(shim)("/api/sessions/no-such-chat/asks")).status, 404);
  });

  // (fails before: yes — no route answered an ask by its options' ids)
  test("Deny by its choice runs nothing and its words are the agent's to read; no press, or a choice that is none of its options, is refused; a question is answered by its option's id", async () => {
    const id = await c.create();
    await c.turn(id, "WRITE own-deny.txt");
    const [ask] = await c.asks(id);
    const none = await c.answer(id, ask.id, { words: "yes, go ahead" });
    assert.equal(none.status, 400, "words are no press, whatever they say");
    assert.match((await none.json()).error, /a permission is answered by its press/);
    const odd = await c.answer(id, ask.id, { choice: "maybe" });
    assert.deepEqual([odd.status, (await odd.json()).error], [400, "choice is the id of one of its options: allow, deny"]);
    const no = await c.answer(id, ask.id, { choice: "deny", words: "use the other folder" });
    const j = await no.json();
    assert.equal(no.status, 200, JSON.stringify(j));
    assert.equal(existsSync(join(root, "own-deny.txt")), false);
    assert.match(wordsOf(j), /^DONE: Not run: the developer declined/);
    assert.ok(wordsOf(j).includes("use the other folder"), "the agent reads Deny's words");
    const pick = await c.create();
    await c.turn(pick, "PICK one");
    const [q] = await c.asks(pick);
    assert.deepEqual([q.kind, q.from, q.question, q.options], ["question", "chat", "Which colour?", [{ id: "1", label: "red" }, { id: "2", label: "blue" }]]);
    const chose = await c.answer(pick, q.id, { choice: "2" });
    const k = await chose.json();
    assert.equal(chose.status, 200, JSON.stringify(k));
    assert.match(wordsOf(k), /^DONE: .*blue/s, "the option's own words answered it");
  });

  // (fails before: yes — the choice's label answered it and the words beside it went unread, 200)
  test("a question answered by a choice and words both is refused in words and nothing answered — the chat's own and a sub-agent's —; words alone, or a choice alone, answer it", async () => {
    const both = "a question is answered by its choice or its words, not both: a choice's own words are its answer, and words beside one would go unread";
    const id = await c.create();
    await c.turn(id, "PICK one");
    const [q] = await c.asks(id);
    const calls = up.received.length;
    const refused = await c.answer(id, q.id, { choice: "2", words: "a darker one" });
    assert.deepEqual([refused.status, (await refused.json()).error], [400, both]);
    assert.equal(up.received.length, calls, "no turn went on");
    assert.deepEqual((await c.asks(id)).map((/** @type {any} */ x) => x.id), [q.id], "it waits still");
    const said = await c.answer(id, q.id, { words: "a darker one" });
    const j = await said.json();
    assert.equal(said.status, 200, JSON.stringify(j));
    assert.match(wordsOf(j), /^DONE: .*a darker one/s, "the words alone answered it");
    // A sub-agent's question, asked as a sub-agent on another machine asks the person (subagents.js `remoteTurn`): its
    // turn waits on its model meanwhile.
    const chat = await c.create();
    const spawn = await local(shim)(`${c.S(chat)}/subagents`, { method: "POST", body: { prompt: "SLOW sub-question", description: "Wait" } });
    const sj = await spawn.json();
    assert.equal(spawn.status, 200, JSON.stringify(sj));
    const sid = String(sj.subagent.id);
    await until(() => up.received.some((x) => x.kind === "anthropic" && /SLOW sub-question/.test(JSON.stringify(x.body?.messages))), "the sub-agent's model call", { timeoutMs: 20_000 });
    const reg = /** @type {any} */ (shim.app).subagents;
    let settled = false;
    const answered = reg.ask(sid, { tool: "ask", args: "", question: "Which colour?", machine: "Workstation", kind: "question", options: ["red", "blue"] }).then((/** @type {any} */ x) => ((settled = true), x));
    const ask = await until(async () => (await c.asks(chat)).find((x) => x.from === sid) || null, "the sub-agent's question", { timeoutMs: 20_000 });
    assert.deepEqual([ask.id, ask.kind, ask.options], [`${sid}.1`, "question", [{ id: "1", label: "red" }, { id: "2", label: "blue" }]]);
    const no = await c.answer(chat, ask.id, { choice: "2", words: "a darker one" });
    assert.deepEqual([no.status, (await no.json()).error], [400, both]);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(settled, false, "nothing answered it");
    assert.deepEqual((await c.asks(chat)).map((/** @type {any} */ x) => x.id), [ask.id], "it waits still");
    const chose = await c.answer(chat, ask.id, { choice: "2" });
    assert.deepEqual([chose.status, await chose.json()], [200, { ok: true, id: ask.id, from: sid }]);
    assert.deepEqual(await answered, { text: "blue", modeSwitch: false, choice: "2" }, "the choice alone answered it");
    assert.equal(reg.stop(sid, { from: "filament" }).ok, true);
    await until(() => reg.get(sid)?.status !== "running", "the sub-agent's stop", { timeoutMs: 20_000 });
  });

  // (fails before: yes — a sub-agent's call was answered by its own route alone, by the sub-agent's id and a number)
  test("a sub-agent's call: listed as `<agent>.<ask>`, Allow through the route runs it; answered again, 409; an ask it never asked, 404", async () => {
    const id = await c.create();
    const spawn = await local(shim)(`${c.S(id)}/subagents`, { method: "POST", body: { prompt: "WRITE sub-allow.txt", description: "Write the file" } });
    const sj = await spawn.json();
    assert.equal(spawn.status, 200, JSON.stringify(sj));
    const sid = String(sj.subagent.id);
    const ask = await until(async () => (await c.asks(id)).find((x) => x.from === sid) || null, "the sub-agent's call to wait", { timeoutMs: 20_000 });
    assert.deepEqual([ask.id, ask.kind, ask.tool, ask.options.map((/** @type {any} */ o) => o.id)], [`${sid}.1`, "permission", "bash", ["allow", "deny"]]);
    assert.match(ask.command, /sub-allow\.txt/);
    const yes = await c.answer(id, ask.id, { choice: "allow" });
    assert.deepEqual([yes.status, await yes.json()], [200, { ok: true, id: ask.id, from: sid }]);
    await until(() => existsSync(join(root, "sub-allow.txt")), "the sub-agent's call to run", { timeoutMs: 20_000 });
    const again = await c.answer(id, ask.id, { allow: true });
    assert.equal(again.status, 409);
    assert.equal((await c.answer(id, `${sid}.2`, { allow: true })).status, 404, "it asked no second");
  });

  // (fails before: yes — a coding agent's question was answered by its run's route alone, by the run's id and its own)
  test("a coding agent's question: listed as `<run>.<id>` with its form's choices; Allow through the route answers it and the turn goes on; answered again, 409", async () => {
    const id = await c.create({ model: "coder/fake-a", settings: { loop: { permissions: "ask" } } });
    const res = await local(shim)(`${c.S(id)}/turns`, { method: "POST", body: { content: "~permbash", stream: true } });
    assert.equal(res.status, 200);
    const runId = String(res.headers.get("x-filament-request-id"));
    const ask = await until(async () => (await c.asks(id)).find((x) => x.from === "coding-agent") || null, "the coding agent's question", { timeoutMs: 20_000 });
    assert.deepEqual([ask.id, ask.kind, ask.runId, ask.command, ask.options.map((/** @type {any} */ o) => o.id)], [`${runId}.q1`, "permission", runId, "rm -rf build", ["allow", "deny"]]);
    const yes = await c.answer(id, ask.id, { allow: true });
    assert.deepEqual([yes.status, await yes.json()], [200, { ok: true, id: ask.id, from: "coding-agent" }]);
    assert.match(await streamed(res), /permbash: allow-once/);
    const again = await c.answer(id, ask.id, { allow: true });
    assert.equal(again.status, 409);
  });

  /**
   * `filament chat` as `term` runs it: what it wrote and said, and its code.
   * @param {string[]} argv @param {any} term
   */
  const cli = async (argv, term) => {
    /** @type {{ out: string[], err: string[], written: string }} */
    const said = { out: [], err: [], written: "" };
    const code = await runCli(argv, { dataDir: shim.dataDir, term, out: (s) => said.out.push(s), err: (s) => said.err.push(s), write: (s) => (said.written += s) });
    return { code, ...said };
  };

  // (fails before: yes — the chat's own ask ended the command with exit 0 and nothing asked, and a terminal's person was
  // never asked: the command ended (exit 4) for the harness to answer)
  test("filament chat at a terminal: the ask in words, its answers numbered, the press sent and the turn goes on; with no terminal, exit 4 naming the ask and the route", async () => {
    const id = await c.create();
    const p = person((q, screen) => (q === "Number: " ? numberOf(screen, "Allow") : undefined));
    const r = await cli(["chat", "--chat", id, "WRITE cli-allow.txt"], p.term);
    assert.equal(r.code, EXIT.ok, `${p.screen()}\n${r.err.join("\n")}`);
    assert.match(p.screen(), /The agent asks \(ask [^)]+\): May I run this command\?[^]*\n {2}1\. Allow\n {2}2\. Deny\n/);
    assert.match(r.written, /DONE: /, "the turn went on, read as the first was");
    assert.equal(existsSync(join(root, "cli-allow.txt")), true);
    assert.deepEqual(await c.asks(id), []);
    const quiet = await c.create();
    const n = await cli(["chat", "--chat", quiet, "WRITE cli-none.txt"], { input: Readable.from([]), output: new PassThrough(), tty: false });
    assert.equal(n.code, EXIT.needsPerson, n.err.join("\n"));
    const [ask] = await c.asks(quiet);
    const err = n.err.join("\n");
    assert.match(err, /the agent asks you: May I run this command\?/);
    assert.ok(err.includes(`POST /api/sessions/${quiet}/asks/<ask>/answer`) && err.includes(`${ask.id} (allow | deny)`), err);
    assert.equal(existsSync(join(root, "cli-none.txt")), false, "nothing answered it");
  });
});

/**
 * Requests to `m` over the network, pinned to its certificate, with `token` as their Bearer: as another machine's
 * Filament sends them.
 * @param {import("./helpers/two-machines.js").Machine} m @param {string} token
 */
const as = (m, token) => {
  const pinned = pinnedFetch(m.lan.fingerprint);
  /** @param {string} path @param {{ method?: string, body?: unknown, signal?: AbortSignal }} [o] @returns {Promise<Response>} */
  return (path, { method = "GET", body, signal } = {}) =>
    pinned(`${m.far}${path}`, { method, signal, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : JSON_TYPE) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
};

/**
 * A stream held open — a run's events — and a promise of its end.
 * @param {(path: string, o?: { signal?: AbortSignal }) => Promise<Response>} call @param {string} path
 */
const hold = async (call, path) => {
  const stop = new AbortController();
  const r = await call(path, { signal: stop.signal });
  if (r.status !== 200) return { status: r.status, closed: Promise.resolve(true), end: () => {} };
  const reader = r.body?.getReader();
  const closed = (async () => {
    try {
      while (reader && !(await reader.read()).done);
    } catch {}
    return true;
  })();
  return { status: r.status, closed, end: () => stop.abort() };
};
/** Whether `p` settles within `ms`. @param {Promise<any>} p @param {number} ms */
const within = (p, ms) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);

// (fails before: yes — another machine's agents reached every chat here by its id, a revoke left their chats' turns
// running, and switching their grant off left what they held open)
test("another machine's agents: their own chat's ask answered; another chat's, its asks and runs, not found; revoked, their chat's turn stops; their grant switched off, the run's events they follow end", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-answer-agents-"));
  const slow = gate();
  const up = await fakeUpstream(brain(slow));
  const two = await startTwoMachines({ there: { configure: (cfg) => configure(cfg, up.url, root) } });
  const { there } = two;
  /** @type {{ end: () => void }[]} */
  const open = [];
  try {
    /** A device for here's agents there, minted by here's full device, `agents` switched on by there's own computer. */
    const mint = async () => {
      const m = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" })).json();
      const on = await there.api(`/api/remote/devices/${encodeURIComponent(m.device.id)}`, { method: "PATCH", body: { grants: { agents: true } } });
      assert.equal(on.status, 200, await on.clone().text());
      return { id: String(m.device.id), call: as(there, m.token) };
    };
    const first = await mint();
    const theirs = chats(first.call, root);
    const mine = chats(local(there), root);
    // Their own chat's ask: listed and answered.
    const a = await theirs.create();
    await theirs.turn(a, "WRITE remote-a.txt");
    const [ask] = await theirs.asks(a);
    assert.equal(ask.from, "chat");
    const yes = await theirs.answer(a, ask.id, { allow: true });
    assert.equal(yes.status, 200, await yes.clone().text());
    assert.equal(existsSync(join(root, "remote-a.txt")), true);
    // A chat there's own computer started: not theirs, whichever way they name it.
    const b = await mine.create();
    const tb = await mine.turn(b, "WRITE remote-b.txt");
    for (const [method, path, body] of [
      ["GET", mine.S(b)],
      ["GET", `${mine.S(b)}/asks`],
      ["POST", `${mine.S(b)}/asks/${tb.runId}/answer`, { allow: true }],
      ["GET", `${mine.S(b)}/subagents`],
      ["POST", `${mine.S(b)}/turns`, { content: "hello", stream: false }],
      ["GET", `/api/runs/${tb.runId}/events`],
      ["POST", `/api/runs/${tb.runId}/answer`, { ask: "q1", outcome: "answered" }],
    ]) {
      const r = await first.call(String(path), { method: String(method), body });
      assert.equal(r.status, 404, `${method} ${path}`);
      assert.match((await r.json()).error, /^no such (session|run)$/, `${method} ${path}`);
    }
    const across = await theirs.answer(a, tb.runId, { allow: true });
    assert.deepEqual([across.status, (await across.json()).error], [404, `no ask ${tb.runId} in this chat`], "another chat's ask, named in their own chat");
    assert.equal(existsSync(join(root, "remote-b.txt")), false);
    assert.equal((await mine.asks(b)).length, 1, "it waits for there's own person still");
    // Revoked: the turn running in their chat stops, though nothing of theirs holds it open now.
    const going = new AbortController();
    const res = await first.call(`${theirs.S(a)}/turns`, { method: "POST", body: { content: "SLOW", stream: true }, signal: going.signal });
    assert.equal(res.status, 200);
    const slowRun = String(res.headers.get("x-filament-request-id"));
    await until(() => up.received.some((x) => x.kind === "anthropic" && /SLOW/.test(wordsOf(x.body?.messages?.at(-1)))), "the slow turn's model call");
    going.abort();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(there.app.runs.getRun(slowRun)?.endedAt ?? null, null, "its turn runs on with nobody following it");
    assert.equal((await there.api(`/api/remote/devices/${encodeURIComponent(first.id)}`, { method: "DELETE" })).status, 200);
    await until(() => there.app.runs.getRun(slowRun)?.endedAt != null, "the revoked device's chat's turn to stop");
    // A device minted again starts none of the old one's chats: its own, and the run's events it follows end as its
    // grant `agents` is switched off.
    const second = await mint();
    const c2 = await chats(second.call, root).create();
    assert.equal((await second.call(chats(second.call, root).S(a))).status, 404, "the first device's chat is not the second's");
    /** @type {any} */ (there.app.runs).startRun({ id: "r-theirs", kind: "test", meta: { chain: c2 } });
    /** @type {any} */ (there.app.runs).startRun({ id: "r-mine", kind: "test", meta: { chain: b } });
    assert.equal((await hold(second.call, "/api/runs/r-mine/events?stream=1")).status, 404, "a run of a chat not theirs");
    const held = await hold(second.call, "/api/runs/r-theirs/events?stream=1");
    open.push(held);
    assert.equal(held.status, 200);
    assert.equal(await within(held.closed, 500), false, "it is held open");
    const off = await there.api(`/api/remote/devices/${encodeURIComponent(second.id)}`, { method: "PATCH", body: { grants: { agents: false } } });
    assert.equal(off.status, 200, await off.clone().text());
    assert.equal(await within(held.closed, 3000), true, "its grant off, what it held ends");
    assert.equal((await second.call(chats(second.call, root).S(c2))).status, 403, "and its next request is refused");
    // Replaced by a third mint, as revoked: the turn running in its chat stops.
    const on = await there.api(`/api/remote/devices/${encodeURIComponent(second.id)}`, { method: "PATCH", body: { grants: { agents: true } } });
    assert.equal(on.status, 200, await on.clone().text());
    const again = await second.call(`${chats(second.call, root).S(c2)}/turns`, { method: "POST", body: { content: "SLOW again", stream: true } });
    assert.equal(again.status, 200);
    const againRun = String(again.headers.get("x-filament-request-id"));
    await until(() => up.received.filter((x) => x.kind === "anthropic" && /SLOW/.test(wordsOf(x.body?.messages?.at(-1)))).length >= 2, "the second slow turn's model call");
    await mint();
    await until(() => there.app.runs.getRun(againRun)?.endedAt != null, "the replaced device's chat's turn to stop");
  } finally {
    slow.open();
    for (const x of open) x.end();
    await two.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// (fails before: yes — FabeleHelper's of 11-10: another machine's agents' message kept when the person last wrote, so a
// chat they drove stayed "fresh" for a start's day cutoff, sessions/owed-wakes.js `staleWords`)
// (fails before: yes — FabeleHelper's of 11-10: a note typed into a running turn kept no personAt, so what the person asked
// that way was no ask "since the graph began" at its all-done, and their typing did not count as their being there)
test("another machine's agents' message is not the person's: it keeps no personAt, and the person's own does — a note into a running turn too, not theirs nor one Filament relays", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-answer-person-at-"));
  const slow = gate();
  const up = await fakeUpstream(brain(slow));
  const two = await startTwoMachines({ there: { configure: (cfg) => configure(cfg, up.url, root) } });
  const { there } = two;
  try {
    const m = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" })).json();
    const on = await there.api(`/api/remote/devices/${encodeURIComponent(m.device.id)}`, { method: "PATCH", body: { grants: { agents: true } } });
    assert.equal(on.status, 200, await on.clone().text());
    const theirs = chats(as(there, m.token), root);
    const mine = chats(local(there), root);
    const personAt = (/** @type {string} */ id) => there.app.memory.archive?.metaOf(id, ["personAt"])?.personAt ?? null;
    const a = await theirs.create();
    await theirs.turn(a, "hello from the agents");
    assert.equal(personAt(a), null, "their words are not the person's");
    const b = await mine.create();
    await mine.turn(b, "hello from the person");
    assert.equal(typeof personAt(b), "number", "the person's own message is kept");
    // A note into the running turn of a chat they drive — theirs never reaches it: they start and follow chats alone. One
    // Filament relays keeps none; the person's does.
    const going = as(there, m.token)(`${theirs.S(a)}/turns`, { method: "POST", body: { content: "SLOW", stream: true } });
    const res = await going;
    const runId = String(res.headers.get("x-filament-request-id"));
    await until(() => up.received.some((x) => x.kind === "anthropic" && /SLOW/.test(wordsOf(x.body?.messages?.at(-1)))), "the slow turn's model call");
    /** @param {(path: string, o?: any) => Promise<Response>} call @param {Record<string, unknown>} body */
    const note = async (call, body) => {
      const r = await call(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", ...body } });
      assert.equal(r.status, 200, await r.clone().text());
    };
    const refused = await as(there, m.token)(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text: "theirs, mid-turn" } });
    assert.equal(refused.status, 403);
    await note(local(there), { text: "[Filament: the Space synced]", from: "filament" });
    assert.equal(personAt(a), null, "words Filament relays");
    await note(local(there), { text: "also the docs", from: "harness" });
    assert.equal(typeof personAt(a), "number", "the person's own note");
    slow.open();
    await res.text();
  } finally {
    slow.open();
    await two.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
