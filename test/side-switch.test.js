// @ts-check
// Parallelize tasks (the owner's plan mode of 11-06, piece D; its name the owner's): Settings › Experimental's, on for
// every chat once on (the owner's of 11-08) — no chat's own switch, beside the message box or on the offer card. On,
// it is the person's consent (the owner's of 11-09): the agent's prompt says once that it starts the tasks that can run
// at once on sub-agents itself — the loop's system prompt, a coding agent's context —, and no message carries a line
// ahead of it any more; a /plan is planned so.
import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as tg from "../src/core/task-graph.js";
import { isAskLine, withoutAskLine } from "../src/core/messages.js";
import { wordsOfMessage } from "../src/services/memory/brain.js";
import { createComposer } from "../src/ui/harness/composer/composer.js";
import { deliveredWords, planOfferEl } from "../src/ui/harness/conversation/turn.js";
import { CODER_PARALLEL_OFF_TEXT, CODER_PARALLEL_TEXT, CODER_TRAILER_TEXT } from "../src/app/agent-context.js";
import { PROMPT } from "../src/app/agent/prompt.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");

describe("one switch, for every chat", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  beforeEach(() => {
    doc = stubDocument();
    /** @type {Map<string, string>} */
    const kept = new Map();
    g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => kept.set(k, v), removeItem: (/** @type {string} */ k) => kept.delete(k) };
  });
  afterEach(() => {
    delete g.localStorage;
    doc.restore();
  });

  // (fails before: yes — the owner's of 11-08: on in Settings › Experimental, Parallelize tasks was still a switch of each
  // chat's, beside the message box and on the offer card, off until pressed there)
  // (fails before: yes — the owner's of 11-09: the switch on is consent, said once in the agent's prompt, so the page
  // sent it with every message for a line each carried)
  // (fails before: yes — the review of 11-09: the page sent it with a /plan; the session reads it, as for a /parallel)
  test("on in Settings › Experimental, it holds for every chat: no chip beside the message box, and the page sends no word of it", () => {
    const host = /** @type {any} */ (doc.document.createElement("div"));
    const c = /** @type {any} */ (createComposer(host, { onSend: () => true, onStop: () => {}, getChat: () => ({ chainId: "c1", turns: [] }) }));
    assert.equal(host.querySelector(".side-chip"), null, "no chip");
    assert.equal(c.setSide, undefined);
    const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ui", "harness", "app.js"), "utf8");
    assert.doesNotMatch(app, /\n {6}side: /, "a /plan's neither: the session reads the switch, a team's lead aside");
    assert.doesNotMatch(app, /side-switch\.js|setSide\(|sideOf\(/, "no chat's own switch kept");
    assert.equal(existsSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ui", "harness", "lib", "side-switch.js")), false);
  });

  // (fails before: yes — the owner's of 11-08: the card had a Parallelize tasks switch of its own)
  test("the offer card has no Parallelize tasks switch; its Plan sends the depth", () => {
    const turn = { planOffer: { depth: "deep", side: true }, status: "done", userText: "Add OAuth" };
    /** @type {any[]} */
    const sent = [];
    const card = /** @type {any} */ (planOfferEl(turn, true, { onPlan: (o) => sent.push(o), onJustDo: () => {} }));
    assert.equal(card.querySelectorAll(".set-switch").length, 0);
    assert.doesNotMatch(card.textContent, /Parallelize/);
    card.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Plan").dispatch("click");
    assert.deepEqual(sent, [{ words: "Add OAuth", depth: "deep" }]);
  });

  // (fails before: yes — the walk of plan mode's screens, 11-06: an Approve sent with the switch on said "with 1
  // message from agents" under it, the line counted as one)
  // (fails before: yes — the review of 2aaed3e0e: memory's learner, its views, a compaction's transcript and the search
  // read the line with every message)
  test("the line is standing words: every reader but the turn's own model leaves it out", () => {
    const m = { role: "user", content: [{ type: "text", text: tg.SIDE_BY_SIDE_LINE }, { type: "text", text: "Build the parser" }] };
    assert.deepEqual(withoutAskLine(m).content, [{ type: "text", text: "Build the parser" }]);
    assert.equal(isAskLine(tg.SIDE_BY_SIDE_LINE), true);
    assert.deepEqual(wordsOfMessage(m), { said: "Build the parser", rode: "" });
    assert.equal(withoutAskLine({ role: "user", content: [{ type: "text", text: "Build it" }] }).content.length, 1);
  });

  test("the line is no agent's message: the row under the message says only what agents sent", () => {
    assert.equal(deliveredWords({ deliveries: 1, side: true }), "");
    assert.match(deliveredWords({ deliveries: 2, side: true }), /^with 1 message from agents$/);
  });
});

describe("the line, through a real Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-side-switch-"));
    up = await fakeUpstream(async (c) => {
      if (c.kind !== "anthropic") return undefined;
      if (!(c.body?.tools || []).length) return anthropicReply("A title", { model: "brain-model" });
      return anthropicReply("ok", { model: "brain-model" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
          // A coding agent that takes Filament's tools over HTTP MCP: the line reaches it as any agent's.
          { id: "coder", name: "coder", type: "acp", enabled: true, acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_MCP_CAPS: "http", FAKE_ACP_LOG: join(root, "coder-prompts.jsonl") }, cwdDefault: root, permissions: "allow-all", hints: false } },
        ];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }, { match: "coder/*", upstream: "coder", upstreamModel: "{1}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
        cfg.experimental = { ...cfg.experimental, parallelizeTasks: true };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(shim?.dataDir, root);
  });
  const chat = async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(created.status, 200, await created.clone().text());
    return `/api/sessions/${encodeURIComponent(String((await created.json()).id))}`;
  };
  /** The agent's request whose newest message says the words: its body. @param {string} words @returns {any} */
  const asked = (words) => {
    const c = up.received.findLast((x) => (x.body?.tools || []).length && JSON.stringify(x.body.messages.at(-1)).includes(words));
    assert.ok(c, words);
    return c.body;
  };
  /** A user message's text blocks. @param {any} m @returns {string[]} */
  const texts = (m) => (Array.isArray(m?.content) ? m.content.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text)) : [String(m?.content ?? "")]);
  /** What a request holds, its cache's marks aside. @param {any} x */
  const bare = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === "cache_control" ? undefined : v)));
  /** @param {string} path @param {Record<string, any>} body */
  const send = async (path, body) => {
    const r = await shim.api(`${path}/turns`, { method: "POST", body: { stream: false, ...body } });
    assert.equal(r.status, 200, await r.clone().text());
    return r;
  };
  /** @param {string} path */
  const turns = async (path) => /** @type {any[]} */ ((await (await shim.api(`${path}/transcript`)).json()).turns || []);

  /** The system text a request carries. @param {any} body @returns {string} */
  const systemOf = (body) => (Array.isArray(body.system) ? body.system.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text)).join("\n") : String(body.system ?? ""));

  // (fails before: yes — the switch's side went nowhere: no line reached the agent)
  // (fails before: yes — the owner's of 11-09: on is the person's consent, said once in the agent's prompt, where a line
  // rode ahead of every message — sent `side` by a page from before, too)
  test("on, the system prompt says it once and no line rides ahead of the person's message — what came before is the same bytes", async () => {
    const path = await chat();
    const first = await send(path, { content: "Build the parser", side: true });
    await send(path, { content: "And the docs" });
    await send(path, { content: "Then the tests", side: true });
    const one = asked("Build the parser");
    const two = asked("And the docs");
    const three = asked("Then the tests");
    assert.deepEqual(texts(one.messages.at(-1)), ["Build the parser"]);
    assert.deepEqual(texts(two.messages.at(-1)), ["And the docs"]);
    assert.deepEqual(texts(three.messages.at(-1)), ["Then the tests"]);
    assert.ok(systemOf(one).includes(tg.PARALLEL_CONSENT), "the main agent's prompt says it");
    assert.ok(!JSON.stringify([one, two, three].map((b) => b.messages)).includes(tg.SIDE_BY_SIDE_LINE));
    // The prefix the cache holds: the system, the tools and the turns before, the same each time.
    assert.deepEqual([bare(two.system), bare(two.tools)], [bare(one.system), bare(one.tools)]);
    assert.deepEqual(bare(two.messages.slice(0, one.messages.length)), bare(one.messages));
    assert.deepEqual(bare(three.messages.slice(0, two.messages.length)), bare(two.messages));
    // No row counts a line among its deliveries.
    assert.equal(first.headers.get("x-filament-side"), null);
    const rows = await turns(path);
    assert.deepEqual(rows.map((t) => [t.deliveries ?? 0, t.side === true]), [[0, false], [0, false], [0, false]]);
  });

  // (fails before: yes — k2: the switch reached no prompt; flipped, it is the person's own act, so no card asks first)
  // (fails before: yes — the owner's of 11-14: off, the prompt said nothing of the person's card)
  test("turned off mid-chat: the next turn's prompt says the hold line in its place, and no card asks first — the chat's print is the same", async () => {
    const path = await chat();
    const id = decodeURIComponent(path.split("/").at(-1) || "");
    await send(path, { content: "Sketch the loader" });
    assert.ok(systemOf(asked("Sketch the loader")).includes(tg.PARALLEL_CONSENT));
    const off = await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "experimental.parallelizeTasks": false } } });
    assert.equal(off.status, 200, await off.clone().text());
    try {
      assert.deepEqual((await shim.app.sessions.preview(id, {})).current.printChanged, [], "nothing in the print moved");
      await send(path, { content: "Then the saver" });
      const next = asked("Then the saver");
      assert.equal(systemOf(next).includes(tg.PARALLEL_CONSENT), false);
      assert.equal(
        systemOf(next),
        systemOf(asked("Sketch the loader")).replace(`${tg.PARALLEL_CONSENT}\n`, "").replace(`${PROMPT.agentRecipes}\n`, `${PROMPT.agentRecipes}\n${PROMPT.parallelOff}\n`),
        "that line went, and the hold line stands after the three ways sub-agents pay",
      );
    } finally {
      await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "experimental.parallelizeTasks": true } } });
    }
  });

  // (fails before: yes — the review of 2aaed3e0e: the line rode ahead of a coding agent's own command, which it reads only
  // at its prompt's start, so "/review" went to it as plain words)
  // (fails before: yes — k2: a coding agent heard nothing of the switch but that line)
  // (fails before: yes — the owner's of 11-14: off, a coding agent heard nothing of the person's card)
  test("a coding agent: its first prompt carries Parallelize tasks' block beside the graph's; no message carries a line, its own command neither; off, the block in its off words", async () => {
    /** The newest prompt the coding agent got that carries `words`. @param {string} words */
    const prompted = (words) => {
      const log = join(root, "coder-prompts.jsonl");
      const lines = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
      const p = lines.findLast((x) => String(x.prompt).includes(words));
      assert.ok(p, words);
      return String(p.prompt);
    };
    const coder = async () => {
      const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "coder/fake", preset: "plain" } });
      assert.equal(created.status, 200, await created.clone().text());
      return `/api/sessions/${encodeURIComponent(String((await created.json()).id))}`;
    };
    const path = await coder();
    await send(path, { content: "Explain the parser", side: true });
    await send(path, { content: "/review", side: true });
    assert.deepEqual((await turns(path)).map((t) => t.side === true), [false, false]);
    const first = prompted("Explain the parser");
    const block = `<filament-context kind="parallel">\n${CODER_PARALLEL_TEXT}\n</filament-context>`;
    assert.ok(first.includes(block), first);
    assert.ok(first.indexOf('<filament-context kind="tasks">') < first.indexOf(block), "beside the graph's, after it");
    assert.ok(!first.includes(tg.SIDE_BY_SIDE_LINE));
    const off = await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "experimental.parallelizeTasks": false } } });
    assert.equal(off.status, 200, await off.clone().text());
    try {
      await send(await coder(), { content: "Map the lexer" });
      const plain = prompted("Map the lexer");
      assert.ok(plain.includes('<filament-context kind="tasks">'), plain);
      assert.equal(plain.includes(CODER_PARALLEL_TEXT), false);
      assert.ok(plain.includes(`<filament-context kind="parallel">\n${CODER_PARALLEL_OFF_TEXT}\n</filament-context>`), plain);
    } finally {
      await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "experimental.parallelizeTasks": true } } });
    }
    // (fails before: yes — the owner's of 11-10: a coding agent was never asked Filament's co-author line) On as it
    // ships, its first prompt asks it; switched off, a new chat's agent is not asked it.
    assert.ok(first.includes(CODER_TRAILER_TEXT), first);
    const trailerOff = await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "sessions.commitTrailer": false } } });
    assert.equal(trailerOff.status, 200, await trailerOff.clone().text());
    try {
      await send(await coder(), { content: "Map the tokenizer" });
      assert.equal(prompted("Map the tokenizer").includes('kind="commits"'), false);
    } finally {
      await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "sessions.commitTrailer": true } } });
    }
  });

  // (fails before: yes — a typed /plan took no side by side from the switch, and the line rode with /parallel too; then
  // words before a colon were read for it — the owner's of 11-06: nothing reads the person's words)
  // (fails before: yes — the review of 11-09: a /plan sent with no page's `side` got none, though the switch was on)
  test("a /plan takes it from the switch alone — never from its words, nor a page's word", async () => {
    const path = await chat();
    await send(path, { content: "/plan the importer", plan: true, side: true });
    await send(path, { content: "/plan the exporter", plan: true });
    const [a, b] = [texts(asked("the importer").messages.at(-1)), texts(asked("the exporter").messages.at(-1))];
    assert.match(a[0], /\n- Parallelize tasks is on, which is their consent: /);
    assert.match(b[0], /\n- Parallelize tasks is on, which is their consent: /, "no page's word needed");
    assert.ok(![...a, ...b].includes(tg.SIDE_BY_SIDE_LINE));
  });

  // (fails before: yes — the owner's of 11-06: a chat's switch carried the line whatever Settings › Experimental said)
  test("Settings › Experimental off: a chat's switch left on carries no line, and a /plan none of it — whatever its words say", async () => {
    const off = await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "experimental.parallelizeTasks": false } } });
    assert.equal(off.status, 200, await off.clone().text());
    try {
      const path = await chat();
      await send(path, { content: "Build the lexer", side: true });
      await send(path, { content: "/plan side by side: the linter", plan: true, side: true });
      assert.deepEqual(texts(asked("Build the lexer").messages.at(-1)), ["Build the lexer"]);
      assert.doesNotMatch(texts(asked("the linter").messages.at(-1))[0], /Parallelize tasks is on/, "the words are the agent's to read");
      assert.deepEqual((await turns(path)).map((t) => t.side === true), [false, false]);
    } finally {
      await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "experimental.parallelizeTasks": true } } });
    }
  });
});
