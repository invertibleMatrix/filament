// @ts-check
// HarnessV3-ACP AC-R1: what a coding agent's fresh session is seeded with. A harness chat's is the harness's own
// composition of the chat — the whole of it, or where its compaction left it — never the archive's cut to a budget; an
// outside client's is the archive's, whose budget is the upstream's, else half the window Filament knows for the
// agent's model. A switch into an agent weighs that composition at the line, as the agent will hold it. A session has
// what a prompt carries once it goes out: a turn stopped before then leaves the next to seed it, or to catch it up
// (the bug report's L21), and a restart keeps what it heard. Each bridge against its fake, memory's budget, then the
// switch through the app.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FIXTURES, FAKE_ACP_AGENT, startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { afterHead, splitHead } from "./helpers/agent-head.js";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { CodexBridge } from "../src/adapters/agents/codex/bridge.js";
import { CursorSdkBridge } from "../src/adapters/agents/cursor-sdk.js";
import { COMPACTED_WORDS, COMPACTION_HEADER, EARLIER_WORDS } from "../src/adapters/agents/compactions.js";
import { estimateTokens, estimateBodyTokens } from "../src/core/tokens.js";
import { flattenMessages } from "../src/core/wire/flatten.js";

const quiet = () => {};
/** JSON lines of a file, oldest first. @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
/** A request's headers, naming the chat's newest compaction; none for an outside client's. @param {number | null} base */
const naming = (base) => (base == null ? {} : { [COMPACTION_HEADER]: String(base) });
/** The chat so far, as the harness composes it before any compaction. */
const CHAT = [
  { role: "user", content: "one" },
  { role: "assistant", content: "Echo: one" },
  { role: "user", content: "two" },
  { role: "assistant", content: "Echo: two" },
];
/** The chat as a seed's transcript reads it. */
const SEEN = "### User\none\n\n### Assistant\nEcho: one\n\n### User\ntwo\n\n### Assistant\nEcho: two";
/** A call that read much: its input past 800 characters, its result past 4,000 (HarnessV4_Tasks A7). */
const TOOLS = { input: { command: `echo ${"i".repeat(1200)}` }, result: "r".repeat(6000) };
/** A chat whose one answer is a call alone, then its result, then the reply. */
const TOOL_CHAT = [
  { role: "user", content: "one" },
  { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: TOOLS.input }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: TOOLS.result }] },
  { role: "assistant", content: "Done." },
];
/** A request's body: the history, then the person's words. @param {string} text @param {any[]} [history] */
const bodyOf = (text, history = []) => ({ model: "m", max_tokens: 100, messages: [...history, { role: "user", content: text }] });
/** A turn's `onEvent` that stops it as its prompt is about to go out. @param {AbortController} stop */
const stopAtSession = (stop) => (/** @type {any} */ ev) => void (ev.type === "session" && stop.abort());
/** What the archive hands back, as memory's `archivedTranscript` does. */
const ARCHIVED = { chainId: "c1", view: "chat", text: "### Turn 1\nthe archive's words", turns: 1, dropped: 2, tokens: 9, title: null, excludedInFlight: true, budget: 123 };

let dir = "";
before(() => {
  dir = mkdtempSync(join(tmpdir(), "filament-agent-seed-"));
});
after(async () => {
  await removeDirs(dir);
});

// (fails before: yes — HarnessV4_Tasks A7: there was no whole reading; every seed was cut a line's worth)
test("read whole, either wire format keeps every call's whole input and every result whole; cut, as before", () => {
  const call = JSON.stringify(TOOLS.input);
  const texts = (/** @type {"anthropic" | "openai"} */ format, /** @type {any} */ body, whole = false) => flattenMessages(format, body, { whole }).map((m) => m.text);
  assert.deepEqual(texts("anthropic", { messages: TOOL_CHAT }, true), ["one", `[called tool Bash with ${call}]`, `[tool result: ${TOOLS.result}]`, "Done."]);
  assert.deepEqual(texts("anthropic", { messages: TOOL_CHAT }), ["one", `[called tool Bash with ${call.slice(0, 800)}]`, `[tool result: ${TOOLS.result.slice(0, 4000)}…]`, "Done."]);
  const oai = { messages: [{ role: "user", content: "one" }, { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "Bash", arguments: call } }] }, { role: "tool", tool_call_id: "t1", content: TOOLS.result }, { role: "assistant", content: "Done." }] };
  assert.deepEqual(texts("openai", oai, true), ["one", `[called tool Bash with ${call}]`, `[tool result: ${TOOLS.result}]`, "Done."]);
  assert.deepEqual(texts("openai", oai), ["one", "[called tools: Bash]", `[tool result: ${TOOLS.result.slice(0, 4000)}]`, "Done."]);
});

describe("an ACP agent's fresh session", () => {
  /** @type {AcpBridge} */ let bridge;
  /** @type {any[]} */ const asked = [];
  const prompts = () => lines(join(dir, "acp-prompts.jsonl")).map((p) => p.prompt);
  /** @param {any} [acp] */
  const up = (acp = {}) => ({
    id: "ag",
    name: "ag",
    type: "acp",
    acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_LOG: join(dir, "acp-prompts.jsonl") }, cwdDefault: dir, permissions: "allow-all", ...acp },
  });
  before(() => {
    bridge = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    /** @type {any} */ (bridge).archivedTranscript = (/** @type {any} */ args, /** @type {any} */ opts) => (asked.push(opts), ARCHIVED);
  });
  after(() => bridge.shutdown());
  /** @param {string} text @param {number | null} base @param {string} chat @param {any} [acp] */
  const turn = (text, base, chat, acp) =>
    bridge.run({ upstream: up(acp), modelId: "fake-a", format: "anthropic", body: bodyOf(text, CHAT), conversationId: chat, headers: naming(base), onEvent: () => {} });

  test("a harness chat's: the whole chat as the harness composed it, the archive not asked", async () => {
    const r = await turn("three", 0, "harness");
    assert.equal(asked.length, 0, "the archive is not asked");
    assert.equal(prompts().at(-1), `${EARLIER_WORDS}:\n\n${SEEN}\n\n---\nLatest user message:\n\nthree`);
    assert.ok(r.notes.includes(`acp: seeded from the whole chat: the harness's composition, 4 messages, ~${estimateTokens(SEEN)} tokens`), r.notes.join("\n"));
  });

  test("an outside client's: the archive's, asked for the upstream's budget or none — and the record names the budget it used", async () => {
    const r = await turn("three", null, "outside");
    assert.deepEqual(asked.at(-1), { view: "chat", budgetTokens: 0 }, "no budget of the upstream's: memory's own rule");
    assert.equal(prompts().at(-1), `${EARLIER_WORDS}:\n\n${ARCHIVED.text}\n\n---\nLatest user message:\n\nthree`);
    assert.ok(
      r.notes.includes("acp: seeded from Filament's archive (chat view) — 1 turn(s), ~9 tokens, 2 older turn(s) dropped to fit the 123-token budget, this turn excluded; the client's own history was not used"),
      r.notes.join("\n"),
    );
    await turn("three", null, "outside-2", { seedBudgetTokens: 9000 });
    assert.deepEqual(asked.at(-1), { view: "chat", budgetTokens: 9000 });
  });

  // (fails before: yes — HarnessV4_Tasks A7: Whole was cut on its way into the seed — a call's input at 800 characters,
  // its result at 4,000)
  test("a harness chat's seed carries each tool call whole: its whole input and its whole result", async () => {
    const r = await bridge.run({ upstream: up(), modelId: "fake-a", format: "anthropic", body: bodyOf("two", TOOL_CHAT), conversationId: "whole-tools", headers: naming(0), onEvent: () => {} });
    const p = String(prompts().at(-1));
    assert.equal(p, `${EARLIER_WORDS}:\n\n### User\none\n\n### Assistant\n[called tool Bash with ${JSON.stringify(TOOLS.input)}]\n\n### User\n[tool result: ${TOOLS.result}]\n\n### Assistant\nDone.\n\n---\nLatest user message:\n\ntwo`);
    assert.ok(r.notes.some((/** @type {string} */ n) => n.startsWith("acp: seeded from the whole chat: the harness's composition, 4 messages")), r.notes.join("\n"));
  });

  /** A harness chat's turn on `b`, its words the newest. @param {AcpBridge} b @param {string} chat @param {string} text @param {any[]} history @param {AbortController | null} [stop] @param {any} [acp] */
  const said = (b, chat, text, history, stop = null, acp = {}) =>
    b.run({ upstream: up(acp), modelId: "fake-a", format: "anthropic", body: bodyOf(text, history), conversationId: chat, headers: naming(0), signal: stop?.signal ?? null, onEvent: stop ? stopAtSession(stop) : () => {} });

  // (fails before: yes — the stopped turn's words counted as heard, and only a session opened in the turn was seeded:
  // the next turn reused it bare, without the chat or the stopped words, and a known session's never caught up on them)
  test("a turn stopped before its prompt went out leaves the session owed what it carried: the next seeds it, or catches it up", async () => {
    assert.equal((await said(bridge, "never-prompted", "three", CHAT, new AbortController())).stopReason, "cancelled");
    const sent = prompts().length;
    const next = await said(bridge, "never-prompted", "four", [...CHAT, { role: "user", content: "three" }]);
    assert.equal(prompts().length, sent + 1, "the stopped prompt never went out");
    assert.equal(prompts().at(-1), `${EARLIER_WORDS}:\n\n${SEEN}\n\n### User\nthree\n\n---\nLatest user message:\n\nfour`);
    assert.ok(next.notes.some((/** @type {string} */ n) => /^acp: session \S+ reused \(turn 1\), seeded with 5 earlier messages$/.test(n)), next.notes.join("\n"));
    await said(bridge, "prompted", "three", CHAT);
    const later = [...CHAT, { role: "user", content: "three" }, { role: "assistant", content: "Echo: three" }];
    assert.equal((await said(bridge, "prompted", "four", later, new AbortController())).stopReason, "cancelled");
    await said(bridge, "prompted", "five", [...later, { role: "user", content: "four" }]);
    assert.match(prompts().at(-1), /^Meanwhile, this conversation continued with another assistant[^]*:\n\n### User\nfour\n\n---\nLatest user message:\n\nfive$/);
  });

  // (fails before: yes — the session map kept no count of the turns a session had heard: after a restart the chat's
  // session never caught up on the turns it missed)
  test("after a restart, a session catches up on the turns it missed since, and no more", async () => {
    const stateFile = join(dir, "acp-heard.json");
    const reopens = { env: { FAKE_ACP_LOG: join(dir, "acp-prompts.jsonl"), FAKE_ACP_ALLOW_LOAD: "1" } };
    const first = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile }));
    try {
      await said(first, "restarted", "three", CHAT, null, reopens);
    } finally {
      first.shutdown();
    }
    const again = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile }));
    try {
      const away = [...CHAT, { role: "user", content: "three" }, { role: "assistant", content: "Echo: three" }, { role: "user", content: "elsewhere" }, { role: "assistant", content: "Another model's answer" }];
      const r = await said(again, "restarted", "back", away, null, reopens);
      assert.equal(r.reused, true, "the session reopened");
      assert.match(prompts().at(-1), /^Meanwhile, this conversation continued with another assistant[^]*:\n\n### User\nelsewhere\n\n### Assistant\nAnother model's answer\n\n---\nLatest user message:\n\nback$/);
    } finally {
      again.shutdown();
    }
  });

  // (fails before: yes — a session stopped before its first prompt was reused bare, and the command's turn counted as
  // told: the chat before the command never reached the session)
  test("an agent's own command on a session owed its seed goes as typed: the seed comes with the next message, the command's exchange left out", async () => {
    const chat = "owed-command";
    const stopped = await said(bridge, chat, "three", CHAT, new AbortController());
    assert.equal(stopped.stopReason, "cancelled");
    // The fake publishes its commands a few ms after session/new: the command is read once they are in. (A sleep of 60 ms
    // stood here, which the full suite's load outran: /review went seeded, an unknown command — FabeleHelper's of 11-10.)
    await until(() => bridge.commandsOf(up().id, String(stopped.sessionId)).length > 0, "the session's commands");
    const asked = [...CHAT, { role: "user", content: "three" }];
    const r = await said(bridge, chat, "/review", asked);
    assert.deepEqual([prompts().at(-1), r.seeded], ["/review", false], "the command as typed, the seed not sent");
    assert.ok(r.notes.includes("acp: /review is the agent's own command, sent as typed: the session's seed waits for the next message"), r.notes.join("\n"));
    await said(bridge, chat, "four", [...asked, { role: "user", content: "/review" }, { role: "assistant", content: "Reviewed." }]);
    assert.equal(prompts().at(-1), `${EARLIER_WORDS}:\n\n${SEEN}\n\n### User\nthree\n\n---\nLatest user message:\n\nfour`);
  });

  /**
   * A bridge of its own and its agent, the agent's commands published when `FAKE_ACP_COMMANDS_MS` says: one turn of a
   * harness chat's on it. @param {string} id @param {string} when
   */
  const publishing = (id, when) => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const log = join(dir, `${id}-prompts.jsonl`);
    const upstream = { id, name: id, type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_LOG: log, FAKE_ACP_COMMANDS_MS: when }, cwdDefault: dir, permissions: "allow-all" } };
    return {
      b,
      sent: () => lines(log).map((p) => p.prompt),
      /** As after a restart: Filament holds the sessions, and has not seen how their agent opens one (`#saysCommands`). */
      unseen: () => {
        for (const c of b.convs.values()) delete c.openedAs;
        b.publishes.clear();
      },
      /** @param {string} chat @param {string} text @param {any[]} history @param {number} [base] @param {AbortSignal | null} [signal] @param {(ev: any) => void} [onEvent] */
      say: (chat, text, history, base = 0, signal = null, onEvent = () => {}) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text, history), conversationId: chat, headers: naming(base), signal, onEvent }),
    };
  };

  // (fails before: yes — a session opened in the turn had published no commands yet when its prompt was made: `/autocompact
  // 400k` sent right after a compaction started a fresh session went to the agent as words, wrapped in the session's seed)
  test("the agent's own command as the first words a fresh session hears goes as typed: its commands, published a moment after it opens, are waited for", async () => {
    const { b, say, sent } = publishing("cmd-late", "300");
    try {
      const r = await say("first-words", "/review the diff", CHAT);
      assert.deepEqual([sent().at(-1), r.seeded], ["/review the diff", false], "the command as typed, its argument with it, the seed not sent");
      assert.ok(r.notes.includes("acp: /review is the agent's own command, sent as typed: the session's seed waits for the next message"), r.notes.join("\n"));
      assert.ok(!r.notes.some((/** @type {string} */ n) => /published no commands/.test(n)), "its own word came: nothing stood in");
      // Words that only look like one are read against the commands too, and go as words, seeded.
      const words = await say("only-words", "/usr/bin is broken", CHAT);
      assert.deepEqual([sent().at(-1), words.seeded], [`${EARLIER_WORDS}:\n\n${SEEN}\n\n---\nLatest user message:\n\n/usr/bin is broken`, true]);
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — HarnessV4_Tasks B6: a clock cut the wait whatever Filament knew of the agent — a slow start read
  // its command against another session's, an agent with no commands cost the wait every time — and nothing said
  // what the turn waited for)
  test("an agent known to say its commands is waited on with no clock, and the turn says so; one that answered having said none is waited on for nothing", async () => {
    // The first session publishes at once, the next after 1.2 s: long past the clock.
    const known = publishing("cmd-known", "5,1200");
    known.b.commandsWaitMs = 100;
    try {
      await known.say("first", "hello", CHAT);
      await until(async () => [...known.b.convs.values()].some((c) => Array.isArray(c.commands)), "the first session's commands");
      /** @type {string[]} */
      const steps = [];
      const t0 = Date.now();
      const r = await known.say("second", "/commit", CHAT, 0, null, (ev) => void (ev.type === "step" && steps.push(ev.step)));
      assert.equal(known.sent().at(-1), "/commit", "read against its own session's commands");
      assert.ok(Date.now() - t0 >= 1000, `its word was waited for (${Date.now() - t0} ms)`);
      assert.ok(!r.notes.some((/** @type {string} */ n) => /published no commands|is read against/.test(n)), r.notes.join("\n"));
      assert.deepEqual(steps.filter((s) => s !== "starting"), ["opening", "commands", "sent"], "said while it waits, between the open and the prompt");
    } finally {
      known.b.shutdown();
    }
    const silent = publishing("cmd-silent", "60000");
    silent.b.commandsWaitMs = 200;
    try {
      // Not seen yet: the clock, once. It answers having said none.
      const first = await silent.say("first", "/review", CHAT);
      assert.ok(first.notes.some((/** @type {string} */ n) => /^acp: session \S{8} published no commands in 200 ms, so \/review goes to it as words$/.test(n)), first.notes.join("\n"));
      // Its session answered, and has said none past the wait: the next is waited on for nothing.
      /** @type {string[]} */
      const steps = [];
      const again = await silent.say("second", "/review", CHAT, 0, null, (ev) => void (ev.type === "step" && steps.push(ev.step)));
      assert.ok(again.notes.includes("acp: cmd-silent said no commands in the sessions it opened before, so /review goes to it as words"), again.notes.join("\n"));
      assert.ok(!steps.includes("commands"), "nothing waited for, nothing said");
    } finally {
      silent.b.shutdown();
    }
  });

  // (fails before: yes — the update that came in ahead of the open's answer found no conversation, and was dropped)
  test("commands published ahead of the open's answer are the session's: nothing is waited for", async () => {
    const { b, say, sent } = publishing("cmd-early", "early");
    b.commandsWaitMs = 60_000;
    try {
      const t0 = Date.now();
      await say("early", "/review", CHAT);
      assert.equal(sent().at(-1), "/review");
      assert.ok(Date.now() - t0 < 20_000, `sent in ${Date.now() - t0} ms, not at the wait's end`);
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — nothing stood in for a session's commands, and nothing said why a command went as words)
  test("an agent Filament has not seen say its commands, and a session that publishes none in time: the chat's session from before stands in, else another of the upstream's; with neither, the words go as words, and the record says why", async () => {
    // The first session publishes at once, those after it only after a minute.
    const { b, say, sent, unseen } = publishing("cmd-never", "5,60000");
    b.commandsWaitMs = 300;
    try {
      const opened = await say("compacted", "three", CHAT);
      await new Promise((r) => setTimeout(r, 60));
      unseen();
      // Another chat's first words: the upstream's other session, which published, stands in.
      const other = await say("another-chat", "/commit", CHAT);
      assert.equal(sent().at(-1), "/commit");
      assert.ok(other.notes.includes(`acp: session ${other.sessionId.slice(0, 8)} published no commands in 300 ms: /commit is read against the ones session ${opened.sessionId.slice(0, 8)} published`), other.notes.join("\n"));
      // The chat compacted (its newest compaction now 1): a fresh session takes the place of the one that published.
      unseen();
      const after = await say("compacted", "/review", CHAT, 1);
      assert.equal(sent().at(-1), "/review", "read against the session from before");
      assert.notEqual(after.sessionId, opened.sessionId);
      assert.ok(after.notes.includes(`acp: session ${after.sessionId.slice(0, 8)} published no commands in 300 ms: /review is read against the ones the chat's session before it published`), after.notes.join("\n"));
      // A name nobody published is words, whoever stands in.
      unseen();
      const unknown = await say("unknown-name", "/nonesuch", CHAT);
      assert.equal(sent().at(-1), `${EARLIER_WORDS}:\n\n${SEEN}\n\n---\nLatest user message:\n\n/nonesuch`);
      assert.equal(unknown.seeded, true);
    } finally {
      b.shutdown();
    }
    const none = publishing("cmd-none", "60000");
    none.b.commandsWaitMs = 300;
    try {
      const r = await none.say("alone", "/review", CHAT);
      assert.equal(none.sent().at(-1), `${EARLIER_WORDS}:\n\n${SEEN}\n\n---\nLatest user message:\n\n/review`);
      assert.ok(r.notes.some((/** @type {string} */ n) => /^acp: session \S{8} published no commands in 300 ms, so \/review goes to it as words$/.test(n)), r.notes.join("\n"));
      // A stop while the commands are waited for ends the wait there, and the turn with it.
      none.unseen();
      none.b.commandsWaitMs = 60_000;
      const stop = new AbortController();
      const t0 = Date.now();
      const stopped = none.say("stopped", "/review", CHAT, 0, stop.signal);
      setTimeout(() => stop.abort(), 400);
      assert.equal((await stopped).stopReason, "cancelled");
      assert.ok(Date.now() - t0 < 20_000, `stopped in ${Date.now() - t0} ms`);
      // Words that name no command wait for nothing.
      const t1 = Date.now();
      await none.say("plain", "hello", CHAT);
      assert.ok(Date.now() - t1 < 20_000, `plain words went out in ${Date.now() - t1} ms`);
    } finally {
      none.b.shutdown();
    }
  });

  // (fails before: no — a guard the mutation pass asked for: the seed's decision counted the command's exchange: a
  // session that heard nothing but the agent's own command had an empty seed ahead of the next message)
  test("a chat that opened with the agent's own command has nothing to seed its session with: the next message goes alone", async () => {
    const chat = "opened-with-command";
    assert.equal((await said(bridge, chat, "/review", [], new AbortController())).stopReason, "cancelled");
    await new Promise((r) => setTimeout(r, 60)); // the fake publishes its commands a few ms after session/new
    await said(bridge, chat, "/review", []);
    assert.equal(prompts().at(-1), "/review");
    const r = await said(bridge, chat, "hello", [{ role: "user", content: "/review" }, { role: "assistant", content: "Reviewed." }]);
    assert.deepEqual([prompts().at(-1), r.seeded], ["hello", false]);
  });

  // (fails before: no — a guard the mutation pass asked for: a session no prompt of the person's had reached took the
  // agent's own command for all it was owed: an outside client's never had the archive's seed)
  test("an outside client's session whose first prompt was the agent's own command has the archive's seed with the next", async () => {
    /** @param {string} text @param {any[]} history @param {AbortController | null} [stop] */
    const ask = (text, history, stop = null) =>
      bridge.run({ upstream: up(), modelId: "fake-a", format: "anthropic", body: bodyOf(text, history), conversationId: "outside-command", headers: naming(null), signal: stop?.signal ?? null, onEvent: stop ? stopAtSession(stop) : () => {} });
    assert.equal((await ask("/review", [], new AbortController())).stopReason, "cancelled");
    await new Promise((r) => setTimeout(r, 60)); // the fake publishes its commands a few ms after session/new
    await ask("/review", []);
    assert.equal(prompts().at(-1), "/review");
    await ask("hello", [{ role: "user", content: "/review" }, { role: "assistant", content: "Reviewed." }]);
    assert.equal(prompts().at(-1), `${EARLIER_WORDS}:\n\n${ARCHIVED.text}\n\n---\nLatest user message:\n\nhello`);
  });

  // (fails before: no — a guard the mutation pass asked for: a reloaded session's replayed history counted as the
  // agent's answer now, so words shaped like a command went in before it said its commands)
  test("after a restart, a reloaded session's history is no answer of the agent's now: a / note still waits for its word", async () => {
    const stateFile = join(dir, "acp-replayed.json");
    const reopens = { env: { FAKE_ACP_LOG: join(dir, "acp-prompts.jsonl"), FAKE_ACP_ALLOW_LOAD: "1", FAKE_ACP_LATE_REPLAY: "1", FAKE_ACP_NO_COMMANDS: "1" } };
    const first = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile }));
    try {
      await said(first, "replayed", "three", CHAT, null, reopens);
    } finally {
      first.shutdown();
    }
    const again = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile }));
    try {
      /** @type {unknown} */
      let waits = "no session";
      const r = await again.run({
        upstream: up(reopens), modelId: "fake-a", format: "anthropic", body: bodyOf("back", [...CHAT, { role: "user", content: "three" }, { role: "assistant", content: "Echo: three" }]), conversationId: "replayed", headers: naming(0),
        onEvent: (/** @type {any} */ ev) => void (ev.type === "session" && (waits = ev.ownCommands?.unsure("/review it") ?? null)),
      });
      assert.equal(r.reused, true, "the session reloaded, its history replayed");
      assert.ok(waits instanceof Promise, "the / note waits for the agent's word in this process");
    } finally {
      again.shutdown();
    }
  });

  // (fails before: no — a guard the mutation pass asked for: the session map kept neither whether a session was still
  // owed its seed nor the command it heard while it was owed a catch-up)
  test("after a restart, a session still owed its seed gets it, and one that heard a command is not handed it back", async () => {
    const stateFile = join(dir, "acp-owed.json");
    const reopens = { env: { FAKE_ACP_LOG: join(dir, "acp-prompts.jsonl"), FAKE_ACP_ALLOW_LOAD: "1" } };
    const away = [{ role: "user", content: "first" }, { role: "assistant", content: "Echo: first" }, { role: "user", content: "elsewhere" }, { role: "assistant", content: "Another model's answer" }];
    const first = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile }));
    try {
      assert.equal((await said(first, "owed-seed", "three", CHAT, new AbortController(), reopens)).stopReason, "cancelled");
      await said(first, "heard-command", "first", [], null, reopens);
      await new Promise((r) => setTimeout(r, 60)); // the fake publishes its commands a few ms after session/new
      await said(first, "heard-command", "/review", away, null, reopens);
      assert.equal(prompts().at(-1), "/review");
    } finally {
      first.shutdown();
    }
    const again = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile }));
    try {
      await said(again, "owed-seed", "four", [...CHAT, { role: "user", content: "three" }], null, reopens);
      assert.equal(prompts().at(-1), `${EARLIER_WORDS}:\n\n${SEEN}\n\n### User\nthree\n\n---\nLatest user message:\n\nfour`);
      await said(again, "heard-command", "back", [...away, { role: "user", content: "/review" }, { role: "assistant", content: "Reviewed." }], null, reopens);
      assert.match(prompts().at(-1), /^Meanwhile, this conversation continued with another assistant[^]*:\n\n### User\nelsewhere\n\n### Assistant\nAnother model's answer\n\n---\nLatest user message:\n\nback$/);
    } finally {
      again.shutdown();
    }
  });
});

describe("Codex's fresh thread", () => {
  /** @type {CodexBridge} */ let bridge;
  /** @type {any[]} */ const asked = [];
  const heard = (/** @type {string} */ method) => lines(join(dir, "codex.jsonl")).filter((m) => m.method === method);
  const up = { id: "cx", name: "cx", type: "codex", acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], env: { FAKE_CODEX_CALLS: join(dir, "codex.jsonl") }, cwdDefault: dir, permissions: "allow-all" } };
  before(() => {
    bridge = new CodexBridge({ log: quiet, stateFile: join(dir, "codex-sessions.json") });
    bridge.archivedTranscript = (/** @type {any} */ args, /** @type {any} */ opts) => (asked.push(opts), ARCHIVED);
  });
  after(() => bridge.shutdown());
  /** @param {string} text @param {number | null} base @param {string} chat */
  const turn = (text, base, chat) =>
    bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body: bodyOf(text, CHAT), conversationId: chat, headers: naming(base), onEvent: () => {} });

  test("a harness chat's: the whole chat as its history, the archive not asked; an outside client's: the archive's", async () => {
    const r = await turn("three", 0, "harness");
    assert.equal(asked.length, 0);
    const [inject] = heard("thread/inject_items");
    assert.deepEqual(inject.params.items.map((/** @type {any} */ i) => [i.role, i.content[0].text]), CHAT.map((m) => [m.role, m.content]));
    const tokens = estimateTokens(CHAT.map((m) => m.content).join("\n\n"));
    assert.ok(r.notes.includes(`codex: seeded from the whole chat: the harness's composition, 4 message(s), ~${tokens} tokens, as the thread's history`), r.notes.join("\n"));

    const o = await turn("three", null, "outside");
    assert.deepEqual(asked.at(-1), { view: "chat", budgetTokens: 0 });
    assert.equal(heard("thread/inject_items").at(-1).params.items[0].content[0].text, `${EARLIER_WORDS}:\n\n${ARCHIVED.text}`);
    assert.ok(o.notes.includes("codex: seeded from Filament's archive (chat view): 1 turn(s), ~9 tokens, 2 older turn(s) dropped to fit the 123-token budget, as the thread's history"), o.notes.join("\n"));
  });

  // (fails before: yes — HarnessV4_Tasks A7: the thread's history was cut as the ACP seed was)
  test("a harness chat's history carries each tool call whole", async () => {
    await bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body: bodyOf("two", TOOL_CHAT), conversationId: "whole-tools", headers: naming(0), onEvent: () => {} });
    assert.deepEqual(heard("thread/inject_items").at(-1).params.items.map((/** @type {any} */ i) => [i.role, i.content[0].text]), [
      ["user", "one"],
      ["assistant", `[called tool Bash with ${JSON.stringify(TOOLS.input)}]`],
      ["user", `[tool result: ${TOOLS.result}]`],
      ["assistant", "Done."],
    ]);
  });

  // (fails before: yes — the stopped turn's words counted as heard once the chat before them went in: the next turn
  // never handed them over)
  test("a turn stopped before its message went out leaves the thread owed it: the next hands it over as history", async () => {
    const stop = new AbortController();
    const r = await bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body: bodyOf("three", CHAT), conversationId: "stopped", headers: naming(0), signal: stop.signal, onEvent: stopAtSession(stop) });
    assert.equal(r.stopReason, "cancelled");
    const starts = heard("turn/start").length;
    await bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body: bodyOf("four", [...CHAT, { role: "user", content: "three" }]), conversationId: "stopped", headers: naming(0), onEvent: () => {} });
    assert.equal(heard("turn/start").length, starts + 1, "the stopped message never went out");
    assert.deepEqual(heard("thread/inject_items").at(-1).params.items.map((/** @type {any} */ i) => [i.role, i.content[0].text]), [["user", "three"]]);
  });

  // (fails before: no — a guard the mutation pass asked for: a thread whose history Codex refused counted as having it,
  // so a turn stopped then left the next to go on without the chat)
  test("history Codex refused stays owed: a turn stopped before its message went out leaves the next to seed the thread", async () => {
    const refusing = { ...up, id: "cx-refuses", acp: { ...up.acp, env: { ...up.acp.env, FAKE_CODEX_INJECT_FAIL: "1" } } };
    const stop = new AbortController();
    const r = await bridge.run({ upstream: refusing, modelId: "gpt-6-astra", format: "anthropic", body: bodyOf("three", CHAT), conversationId: "refused", headers: naming(0), signal: stop.signal, onEvent: stopAtSession(stop) });
    assert.equal(r.stopReason, "cancelled");
    await bridge.run({ upstream: refusing, modelId: "gpt-6-astra", format: "anthropic", body: bodyOf("four", [...CHAT, { role: "user", content: "three" }]), conversationId: "refused", headers: naming(0), onEvent: () => {} });
    assert.equal(heard("turn/start").at(-1).params.input[0].text, `${EARLIER_WORDS}:\n\n${SEEN}\n\n### User\nthree\n\n---\nLatest user message:\n\nfour`);
  });
});

describe("Cursor's fresh SDK agent", () => {
  /** @type {CursorSdkBridge} */ let bridge;
  /** @type {any[]} */ const asked = [];
  const sent = () => lines(join(dir, "sdk.jsonl")).filter((e) => e.event === "send");
  before(() => {
    process.env.FAKE_SDK_LOG = join(dir, "sdk.jsonl");
    bridge = new CursorSdkBridge(/** @type {any} */ ({ log: quiet, stateFile: join(dir, "sdk-sessions.json"), loader: () => import(pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href) }));
    /** @type {any} */ (bridge).archivedTranscript = (/** @type {any} */ args, /** @type {any} */ opts) => (asked.push(opts), ARCHIVED);
  });
  after(() => {
    bridge.shutdown();
    delete process.env.FAKE_SDK_LOG;
  });
  const up = { id: "csdk", name: "csdk", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: dir } };
  /** @param {string} text @param {number | null} base @param {string} chat */
  const turn = (text, base, chat) =>
    bridge.run({ upstream: up, modelId: "grok-4.6", format: "anthropic", body: bodyOf(text, CHAT), conversationId: chat, headers: naming(base), onEvent: () => {} });

  test("a harness chat's: the whole chat as the harness composed it; an outside client's: the archive's", async () => {
    const r = await turn("three", 0, "harness");
    assert.equal(asked.length, 0);
    assert.equal(sent().at(-1).prompt, `${EARLIER_WORDS}:\n\n${SEEN}\n\n---\nLatest user message:\n\nthree`);
    assert.ok(r.notes.includes(`sdk: seeded from the whole chat: the harness's composition, 4 messages, ~${estimateTokens(SEEN)} tokens`), r.notes.join("\n"));
    await turn("three", null, "outside");
    assert.deepEqual(asked.at(-1), { view: "chat", budgetTokens: 0 });
    assert.equal(sent().at(-1).prompt, `${EARLIER_WORDS}:\n\n${ARCHIVED.text}\n\n---\nLatest user message:\n\nthree`);
  });

  /** A harness chat's turn, its words the newest. @param {string} chat @param {string} text @param {any[]} history @param {AbortController | null} [stop] */
  const said = (chat, text, history, stop = null) =>
    bridge.run({ upstream: up, modelId: "grok-4.6", format: "anthropic", body: bodyOf(text, history), conversationId: chat, headers: naming(0), signal: stop?.signal ?? null, onEvent: stop ? stopAtSession(stop) : () => {} });

  // (fails before: yes — the stopped turn's words counted as heard, and only an agent created in the turn was seeded:
  // the next turn reused it bare, without the chat or the stopped words, and a known agent never caught up on them)
  test("a turn stopped before its message went out leaves the agent owed what it carried: the next seeds it, or catches it up", async () => {
    assert.equal((await said("never-prompted", "three", CHAT, new AbortController())).stopReason, "cancelled");
    const sends = sent().length;
    const next = await said("never-prompted", "four", [...CHAT, { role: "user", content: "three" }]);
    assert.equal(sent().length, sends + 1, "the stopped message never went out");
    assert.equal(sent().at(-1).prompt, `${EARLIER_WORDS}:\n\n${SEEN}\n\n### User\nthree\n\n---\nLatest user message:\n\nfour`);
    assert.ok(next.notes.some((/** @type {string} */ n) => /^sdk: agent \S+ reused \(turn 1\), seeded with 5 earlier messages$/.test(n)), next.notes.join("\n"));
    await said("prompted", "three", CHAT);
    const later = [...CHAT, { role: "user", content: "three" }, { role: "assistant", content: "Echo: three" }];
    assert.equal((await said("prompted", "four", later, new AbortController())).stopReason, "cancelled");
    await said("prompted", "five", [...later, { role: "user", content: "four" }]);
    assert.match(sent().at(-1).prompt, /^Meanwhile, this conversation continued with another assistant[^]*:\n\n### User\nfour\n\n---\nLatest user message:\n\nfive$/);
  });

  // (fails before: no — a guard the mutation pass asked for: Cursor's session map kept neither the steering said nor
  // whether an agent was still owed its seed: after a restart the agent was steered again, or went on without the chat)
  test("after a restart, an agent steered once is not steered again, and one still owed its seed gets it", async () => {
    const stateFile = join(dir, "sdk-restart.json");
    const steered = { ...up, acp: { ...up.acp, steering: true } };
    const loader = () => import(pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href);
    /** @param {CursorSdkBridge} b @param {string} chat @param {string} text @param {any[]} history @param {AbortController | null} [stop] */
    const ask = (b, chat, text, history, stop = null) =>
      b.run({ upstream: steered, modelId: "grok-4.6", format: "anthropic", body: bodyOf(text, history), conversationId: chat, headers: naming(0), signal: stop?.signal ?? null, onEvent: stop ? stopAtSession(stop) : () => {} });
    const first = new CursorSdkBridge(/** @type {any} */ ({ log: quiet, stateFile, loader }));
    try {
      await ask(first, "steered", "three", CHAT);
      assert.ok(sent().at(-1).prompt.startsWith("Tool routing:"), "steered with its first message");
      assert.equal((await ask(first, "owed", "three", CHAT, new AbortController())).stopReason, "cancelled");
    } finally {
      first.shutdown();
    }
    const again = new CursorSdkBridge(/** @type {any} */ ({ log: quiet, stateFile, loader }));
    try {
      await ask(again, "steered", "four", [...CHAT, { role: "user", content: "three" }, { role: "assistant", content: "Echo: three" }]);
      assert.ok(!sent().at(-1).prompt.includes("Tool routing:"), "not steered again");
      await ask(again, "owed", "four", [...CHAT, { role: "user", content: "three" }]);
      const p = sent().at(-1).prompt;
      assert.ok(p.endsWith(`${EARLIER_WORDS}:\n\n${SEEN}\n\n### User\nthree\n\n---\nLatest user message:\n\nfour`), p);
    } finally {
      again.shutdown();
    }
  });
});

describe("through the app: a switch into an agent", () => {
  const SUMMARY = "SUMMARY: the turns so far, condensed.";
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  const calls = () => lines(join(root, "calls.jsonl"));
  /** Each prompt as the agent was sent it. */
  const sentPrompts = () => lines(join(root, "prompts.jsonl")).map((p) => p.prompt);
  /** Each prompt's seed: what follows Filament's own head, where it has one. */
  const prompts = () => sentPrompts().map(afterHead);
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-agent-seed-app-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    // The model the chat starts on, and the compaction's writer.
    up = await fakeUpstream(() => anthropicReply(SUMMARY, { model: "m-1", usage: { input_tokens: 10, output_tokens: 5 } }));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          {
            id: "ag",
            name: "ag",
            type: "acp",
            acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, "calls.jsonl"), FAKE_ACP_LOG: join(root, "prompts.jsonl") }, cwdDefault: projDir, permissions: "allow-all", hints: false },
            // What Filament knows of the agent's windows: a small one, and a large one.
            pricing: { "fake-small": { contextTokens: 4000 }, "fake-big": { contextTokens: 1_000_000 } },
          },
          // An agent that refuses a seed from another assistant for its size, though Filament knows a large window for it.
          {
            id: "agtight",
            name: "agtight",
            type: "acp",
            acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, "calls.jsonl"), FAKE_ACP_LOG: join(root, "prompts.jsonl"), FAKE_ACP_OVERFLOW_SEEDED: "1000000", FAKE_ACP_SESSION_CAPS: "close" }, cwdDefault: projDir, permissions: "allow-all", hints: false },
            pricing: { "fake-big": { contextTokens: 1_000_000 } },
          },
          // One that refuses the same, takes words into its turn, and says no commands: its prompts wait for a file.
          {
            id: "agquiet",
            name: "agquiet",
            type: "acp",
            acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_STEERING: "1", FAKE_ACP_CALLS: join(root, "calls.jsonl"), FAKE_ACP_LOG: join(root, "prompts.jsonl"), FAKE_ACP_OVERFLOW_SEEDED: "1", FAKE_ACP_SESSION_CAPS: "close", FAKE_ACP_COMMANDS_GATE: join(root, "quiet-gate"), FAKE_ACP_NO_COMMANDS: "1" }, cwdDefault: projDir, permissions: "allow-all", hints: false },
            pricing: { "fake-big": { contextTokens: 1_000_000 } },
          },
          // Another account of the same agent, with no row for any model (HarnessV3-ACP AC3-7).
          { id: "ag2", name: "ag2", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, "calls.jsonl"), FAKE_ACP_LOG: join(root, "prompts.jsonl") }, cwdDefault: projDir, permissions: "allow-all", hints: false, account: "Second" } },
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } },
        ];
        cfg.routes = [
          { match: "ag/*", upstream: "ag", upstreamModel: "{1}", enabled: true },
          { match: "ag2/*", upstream: "ag2", upstreamModel: "{1}", enabled: true },
          { match: "agtight/*", upstream: "agtight", upstreamModel: "{1}", enabled: true },
          { match: "agquiet/*", upstream: "agquiet", upstreamModel: "{1}", enabled: true },
          { match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });
  /** @param {string} path @param {any} [init] */
  const json = async (path, init) => (await shim.api(path, init)).json();
  /**
   * A session on the model the chat starts on, and its turns: the reply's record. It makes room by itself at the line
   * (Automatic) unless a test says otherwise: asking first is the default (HarnessV4_Tasks C26).
   * @param {any} [compaction]
   */
  const chat = async (compaction = {}) => {
    const id = String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model: "m-1", preset: "plain", settings: { context: { compaction: { model: "m-1", mode: "auto", ...compaction } } } } })).id);
    // A turn that switches the model answers the switch's question Send as it is (HarnessV4_Tasks A7): the form the
    // question suggests, the session's own where the model changes.
    /** @param {string} content @param {any} [settingsPatch] */
    const say = async (content, settingsPatch) => {
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false, ...(settingsPatch ? { settingsPatch, sendAsIs: true } : {}) } });
      assert.equal(res.status, 200, await res.clone().text());
      return /** @type {any} */ (await shim.record(String(res.headers.get("x-filament-request-id"))));
    };
    return say;
  };

  /** A session on the model the chat starts on, its turns' address, and a turn posted as it is. */
  const session = async () => {
    const id = String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model: "m-1", preset: "plain", settings: { context: { compaction: { model: "m-1", mode: "auto" } } } } })).id);
    const turns = `/api/sessions/${encodeURIComponent(id)}/turns`;
    return { turns, post: (/** @type {any} */ body) => shim.api(turns, { method: "POST", body: { stream: false, ...body } }) };
  };
  /** A turn that went: its record's notes of how it composed. @param {Response} res */
  const notesOf = async (res) => {
    assert.equal(res.status, 200, await res.clone().text());
    return /** @type {string[]} */ ((/** @type {any} */ (await shim.record(String(res.headers.get("x-filament-request-id")))).changes || []).filter((c) => c.startsWith("compose: agent: ")));
  };

  // (fails before: yes — HarnessV4_Tasks A7: a switch went straight on in the session's form, Words, and asked nothing)
  test("a switch asks first, every time, in words that say what happens now; the card's answer is the form its fresh session carries", async () => {
    const { post } = await session();
    // Long enough that a summary leaves the chat smaller: a short chat's card offers no handoff (the owner's of 11-09).
    assert.equal((await post({ content: `one ${"words ".repeat(3000)}` })).status, 200);
    const opened = calls().filter((c) => c.method === "session/new").length;
    const res = await post({ content: "two", settingsPatch: { model: { name: "ag/fake-big" } } });
    const body = JSON.parse(await res.text());
    assert.equal(res.status, 409, JSON.stringify(body));
    const { handoff, ...asked } = body.switchQuestion;
    assert.deepEqual(asked, {
      from: { upstream: "agent-loop", name: "m-1", model: "m-1" },
      to: { upstream: "ag", name: "ag", model: "fake-big" },
      account: false, sameModel: false, resumes: false, compacted: false, suggested: "words", session: "words", window: 1_000_000, usable: 850_000, own: null,
    });
    assert.equal(body.error, "You switched to ag on fake-big from m-1. It starts a new session of this chat now, and Filament hands it the conversation from its own copy: every turn so far, in the form you choose below. The agent's thinking stays behind, and nothing of the chat is cached on ag yet. m-1 can write a summary of it first, for ag to start from.");
    assert.deepEqual([handoff.way, handoff.by, handoff.cache], ["summary", "m-1", null], "the model that answered last can write the summary first; its usage said no cache numbers, so nothing is said of a cache");
    assert.equal(calls().filter((c) => c.method === "session/new").length, opened, "nothing was opened or sent");
    assert.equal((await post({ content: "two" })).status, 409, "a message not answered asks again: the question is no setting's");
    assert.equal((await post({ content: "two", carry: "no such form" })).status, 409, "an answer that names no form answers nothing");
    assert.deepEqual(await notesOf(await post({ content: "two", carry: "fold" })), ["compose: agent: another model answered last, so this turn starts a fresh agent session from Filament's copy of the chat, earlier turns carried as Folded (chosen on the switch's card)"]);
    assert.deepEqual(await notesOf(await post({ content: "three" })), [], "its next turn goes on in its session, asking nothing");
  });

  // (fails before: yes — the hunt of 11-08: the turn read names its model with the effort it ran at, and the route was
  // looked up by that whole name — no route of the model's own name matched, and no handoff was offered)
  test("a switch from a model at an effort offers its summary first too, and the summary is written as that model", async () => {
    const id = String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model: "m-1", preset: "plain", settings: { model: { effort: "high" }, context: { compaction: { model: "m-1", mode: "auto" } } } } })).id);
    const post = (/** @type {any} */ body) => shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { stream: false, ...body } });
    assert.equal((await post({ content: `one ${"words ".repeat(3000)}` })).status, 200);
    const res = await post({ content: "two", settingsPatch: { model: { name: "ag/fake-big" } } });
    const body = JSON.parse(await res.text());
    assert.equal(res.status, 409, JSON.stringify(body));
    assert.deepEqual([body.switchQuestion.handoff?.way, body.switchQuestion.handoff?.by], ["summary", "m-1-high"]);
    const made = await shim.api(`/api/sessions/${encodeURIComponent(id)}/compact`, { method: "POST", body: { method: "summary", once: { writer: "session" }, by: "last" } });
    assert.equal(made.status, 200, await made.clone().text());
  });

  // (fails before: yes — the hunt of 11-08: the card offered a summary by the model that answered last though no upstream
  // of its route could answer — its press failed after the call, in words that blamed memory's model)
  test("a switch whose last model can be called no more offers no summary by it; one asked for anyway is refused first, saying why", async () => {
    const { post, turns } = await session();
    assert.equal((await post({ content: `one ${"words ".repeat(3000)}` })).status, 200);
    const cfg = (await (await shim.api("/api/state")).json()).config;
    const put = async (/** @type {any[]} */ upstreams) => assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...cfg, upstreams } })).status, 200);
    await put(cfg.upstreams.map((/** @type {any} */ u) => (u.id === "m" ? { ...u, enabled: false } : u)));
    try {
      const res = await post({ content: "two", settingsPatch: { model: { name: "ag/fake-big" } } });
      const body = JSON.parse(await res.text());
      assert.equal(res.status, 409, JSON.stringify(body));
      assert.equal(body.switchQuestion.handoff, null, "none to write");
      const made = await shim.api(turns.replace(/\/turns$/, "/compact"), { method: "POST", body: { method: "summary", once: { writer: "session" }, by: "last" } });
      assert.equal(made.status, 409, await made.clone().text());
      assert.equal((await made.json()).error, 'm-1, the model that answered last, cannot write the summary now: its upstream "m" is switched off. Switch it on on the Upstreams page.');
    } finally {
      await put(cfg.upstreams);
    }
  });

  // (fails before: yes — HarnessV4_Tasks A7: another account of the same agent was handed the turns as Words, each
  // turn's calls a counted line, though the same model there holds as much as it did on the account before)
  test("an account switch on the same model asks too, and carries the turns whole unless the card says less; back on the first account, its session goes on, handed the turns it missed", async () => {
    const { post } = await session();
    assert.equal((await post({ content: "one" })).status, 200);
    // ag's context holds more than a summary would: its own summary is offered (the owner's of 11-09: none where it would
    // leave the chat no smaller).
    await notesOf(await post({ content: "two ~holds 20000", settingsPatch: { model: { name: "ag/fake-big" } }, sendAsIs: true }));
    const res = await post({ content: "three", settingsPatch: { model: { name: "ag2/fake-big" } } });
    const body = JSON.parse(await res.text());
    assert.equal(res.status, 409, JSON.stringify(body));
    const q = body.switchQuestion;
    assert.deepEqual([q.from, q.to.upstream, q.to.model, q.account, q.sameModel, q.resumes, q.suggested, q.session], [{ upstream: "ag", name: "ag", model: "fake-big" }, "ag2", "fake-big", true, true, false, "plain", "words"]);
    assert.equal(body.error, `You switched accounts: ${q.to.name} takes over from ag, on the same model (fake-big). It starts a new session of this chat now, and Filament hands it the conversation from its own copy: every turn so far, whole unless you choose less below: your words, the agent's, and every tool call with its result. The agent's thinking stays behind, and nothing of the chat is cached on this account yet. ag can write a summary of it first, from its cache while it is still warm, for ${q.to.name} to start from.`);
    // Send as it is goes with the form the question suggests: Whole.
    assert.deepEqual(await notesOf(await post({ content: "three", sendAsIs: true })), [`compose: agent: you switched to ${q.to.name} from ag, another account of the same agent, so this turn starts a fresh agent session from Filament's copy of the chat, earlier turns carried as Whole (an account switch on the same model carries them whole)`]);
    // Back on the first account: its session of the chat is still up, so it goes on in it, handed what it missed.
    const back = await post({ content: "four", settingsPatch: { model: { name: "ag/fake-big" } } });
    const asked = JSON.parse(await back.text());
    assert.equal(back.status, 409, JSON.stringify(asked));
    assert.deepEqual([asked.switchQuestion.account, asked.switchQuestion.resumes, asked.switchQuestion.suggested], [true, true, "plain"]);
    assert.match(asked.error, /^You switched accounts: ag takes over from .+, on the same model \(fake-big\)\. ag still has its own session of this chat from before: it goes on in it now, and Filament hands it the turns it missed from its own copy, whole unless you choose less below/);
    const opened = calls().filter((c) => c.method === "session/new").length;
    assert.deepEqual(await notesOf(await post({ content: "four", carry: "words" })), [`compose: agent: you switched to ag from ${q.to.name}, another account of the same agent, and ag's own session of this chat is still up: it goes on in it, handed the turns it missed from Filament's copy as Words (chosen on the switch's card)`]);
    assert.equal(calls().filter((c) => c.method === "session/new").length, opened, "no session opened");
    assert.match(String(prompts().at(-1)), /^Meanwhile, this conversation continued with another assistant[^]*### User\nthree[^]*Latest user message:\n\nfour$/);
  });

  // (fails before: yes — the owner's of 11-08, G7: on an account switch to another model the card recommended Whole, the
  // agent and its tools being the same, while the server suggested the session's Words and Send as it is carried them)
  test("an account switch to another model suggests Whole, as its card does, and Send as it is carries it", async () => {
    const { post } = await session();
    assert.equal((await post({ content: "one", settingsPatch: { model: { name: "ag/fake-big" } }, sendAsIs: true })).status, 200);
    const res = await post({ content: "two", settingsPatch: { model: { name: "ag2/fake-small" } } });
    const body = JSON.parse(await res.text());
    assert.equal(res.status, 409, JSON.stringify(body));
    const q = body.switchQuestion;
    assert.deepEqual([q.account, q.sameModel, q.suggested, q.session], [true, false, "plain", "words"]);
    assert.match(body.error, /^You switched accounts and models: .+ takes over from ag on fake-big\. It starts a new session of this chat now, and Filament hands it the conversation from its own copy: every turn so far, whole unless you choose less below: your words, the agent's, and every tool call with its result\./);
    // (fails before: yes — the hunt of 11-08: the note gave the session's context.carry as Whole's reason, which says Words)
    assert.deepEqual((await notesOf(await post({ content: "two", sendAsIs: true }))).map((n) => /carried as (.+)$/.exec(n)?.[1]).filter(Boolean), ["Whole (an account switch on another model carries them whole)"]);
  });

  // (fails before: yes — the hunt of 11-08: the login that answered last was looked up among those switched on alone, so
  // a move off one switched off since — its plan's limit reached — was asked as another model's, the session's Words)
  test("an account switch from a login switched off since is an account switch still: Whole suggested, and Send as it is carries it", async () => {
    const { post } = await session();
    assert.equal((await post({ content: "one", settingsPatch: { model: { name: "ag/fake-big" } }, sendAsIs: true })).status, 200);
    const cfg = (await (await shim.api("/api/state")).json()).config;
    const put = async (/** @type {any[]} */ upstreams) => assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...cfg, upstreams } })).status, 200);
    await put(cfg.upstreams.map((/** @type {any} */ u) => (u.id === "ag" ? { ...u, enabled: false } : u)));
    try {
      const res = await post({ content: "two", settingsPatch: { model: { name: "ag2/fake-big" } } });
      const body = JSON.parse(await res.text());
      assert.equal(res.status, 409, JSON.stringify(body));
      const q = body.switchQuestion;
      assert.deepEqual([q.from, q.account, q.sameModel, q.suggested], [{ upstream: "ag", name: "ag", model: "fake-big" }, true, true, "plain"]);
      assert.match(body.error, /^You switched accounts: .+ takes over from ag, on the same model \(fake-big\)\./);
      assert.deepEqual((await notesOf(await post({ content: "two", sendAsIs: true }))).map((n) => /carried as (\w+)/.exec(n)?.[1]).filter(Boolean), ["Whole"]);
    } finally {
      await put(cfg.upstreams);
    }
  });

  test("under the agent's line: its fresh session starts from the whole chat", async () => {
    const say = await chat();
    await say("one");
    await say("two");
    const rec = await say("three", { model: { name: "ag/fake-big" } });
    assert.equal(prompts().at(-1), `${EARLIER_WORDS}:\n\n### User\none\n\n### Assistant\n${SUMMARY}\n\n### User\ntwo\n\n### Assistant\n${SUMMARY}\n\n---\nLatest user message:\n\nthree`);
    // (fails before: yes — HarnessV4_Tasks E23-D8: a coding agent had Filament's agent tool only where the session named
    // a model for it) Ahead of the seed, Filament's head: its agent tool's block. What a launch naming none runs on is the
    // tool's model field's to say since the owner's prompt pass of 11-08 (agents-coder-launch.test.js).
    const { head } = splitHead(sentPrompts().at(-1));
    assert.ok(head.includes('<filament-context kind="agents">') && head.includes("Filament gives you a tool of its own, named agent"), head);
    assert.ok((rec.changes || []).some((/** @type {string} */ c) => /^acp: seeded from the whole chat: the harness's composition, 4 messages, ~\d+ tokens$/.test(c)), (rec.changes || []).join("\n"));
  });

  test("past it: Filament makes room on its copy first, and the fresh session starts from the compaction", async () => {
    const say = await chat();
    const long = (/** @type {string} */ w) => `${w} ${"words ".repeat(800)}`;
    for (const t of ["one", "two", "three", "four"]) await say(long(t));
    const opened = calls().filter((c) => c.method === "session/new").length;
    const rec = await say("five", { model: { name: "ag/fake-small" } });
    assert.equal(calls().filter((c) => c.method === "session/new").length, opened + 1, "a fresh session");
    const seed = String(prompts().at(-1));
    assert.ok(seed.startsWith(`${COMPACTED_WORDS}:\n\n### User\n[Filament compacted `), seed.slice(0, 300));
    assert.ok(seed.includes(SUMMARY) && seed.endsWith("\n---\nLatest user message:\n\nfive"), seed.slice(-300));
    assert.ok(
      (rec.changes || []).includes("compose: agent: another model answered last, so this turn starts a fresh agent session from the composition — it was past the line, so Filament made room on its copy first"),
      (rec.changes || []).join("\n"),
    );
  });

  // (fails before: yes — the refused seed went bare: the fresh session went on without the chat, HarnessV3-FailurePoints D9)
  test("a seed the agent refuses for its size: Filament compacts its copy, and a fresh session starts from that", async () => {
    const say = await chat();
    const long = (/** @type {string} */ w) => `${w} ${"words ".repeat(800)}`;
    for (const t of ["one", "two", "three", "four"]) await say(long(t));
    const opened = calls().filter((c) => c.method === "session/new").length;
    const rec = await say("five", { model: { name: "agtight/fake-big" } });
    const fresh = calls().filter((c) => c.method === "session/new").slice(opened);
    assert.equal(fresh.length, 2, "the refused session, then a fresh one");
    assert.ok(calls().some((c) => c.method === "session/close" && c.sessionId === fresh[0].sessionId), "the refused one let go");
    const seed = String(prompts().at(-1));
    assert.ok(seed.startsWith(`${COMPACTED_WORDS}:\n\n### User\n[Filament compacted `), seed.slice(0, 300));
    assert.ok(seed.includes(SUMMARY) && seed.endsWith("\n---\nLatest user message:\n\nfive"), seed.slice(-300));
    const changes = (rec.changes || []).join("\n");
    // (fails before: yes — HarnessV4_Tasks B5: what the agent said its context takes was read by nothing)
    assert.match(changes, /compose: agent: agtight refused the seed for its size \(≈[\d,]+ tokens; agtight says it takes 1,000,000 and counted 1,000,200\), so Filament made room on its copy, and a fresh agent session starts from the compaction/);
    assert.match(changes, /compose: compaction: .* summarized /, "the compaction's own note");
    // (fails before: yes — the 11-01 report's B9: the view kept the compaction as `compaction`, by no id its row is found by)
    const rows = /** @type {any} */ (shim.app.memory.archive).getCompactions(String(rec.memory?.chain));
    assert.deepEqual(rows.map((/** @type {any} */ r) => [r.from_turn, r.method]), [[1, "summary"]]);
    assert.deepEqual(rec.view?.compactions, rows.map((/** @type {any} */ r) => ({ id: r.id, fromTurn: r.from_turn, toTurn: r.to_turn, kind: r.kind, method: r.method })), "the record's view is the composition the session was seeded from");
  });

  // (fails before: yes — HarnessV4_Tasks C26: under Ask first the refused seed was compacted all the same, a model
  // called with nobody asked)
  test("a seed the agent refuses under Ask first: nothing is compacted and nothing goes on without the chat; the turn fails in the agent's words, and its facts say room is needed", async () => {
    const id = String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model: "m-1", preset: "plain", settings: { context: { compaction: { model: "m-1" } } } } })).id);
    const at = `/api/sessions/${encodeURIComponent(id)}`;
    const long = (/** @type {string} */ w) => `${w} ${"words ".repeat(800)}`;
    for (const t of ["one", "two", "three", "four"]) assert.equal((await shim.api(`${at}/turns`, { method: "POST", body: { content: long(t), stream: false } })).status, 200);
    const opened = calls().filter((c) => c.method === "session/new").length;
    const res = await shim.api(`${at}/turns`, { method: "POST", body: { content: "five", stream: false, settingsPatch: { model: { name: "agtight/fake-big" } }, sendAsIs: true } });
    const said = await res.text();
    assert.notEqual(res.status, 200, said);
    assert.equal(calls().filter((c) => c.method === "session/new").length, opened + 1, "the refused session, and no other: no prompt goes on without the chat");
    const rec = await shim.record(String(res.headers.get("x-filament-request-id")));
    assert.deepEqual([rec.status, rec.failure?.kind], ["error", "overflow"], said);
    assert.ok(!(rec.changes || []).some((/** @type {string} */ c) => /refused the seed|^compose: compaction:/.test(c)), (rec.changes || []).join("\n"));
    assert.deepEqual((await json(`${at}/compose?dry=1`)).compactions || [], [], "nothing was compacted");
    const tr = await json(`${at}/transcript`);
    assert.equal(tr.turns.at(-1)?.facts?.needsRoom, true, JSON.stringify(tr.turns.at(-1)?.facts));
  });

  // (fails before: no — a guard the mutation pass asked for: a compaction that made no room went on as if made)
  test("a refused seed the compaction can make no room in goes on without the earlier conversation, and the record keeps its first composition", async () => {
    // A fold keeps the newest turn whole: a chat of one has nothing to fold.
    const say = await chat({ method: "fold" });
    await say("one");
    const opened = calls().filter((c) => c.method === "session/new").length;
    const rec = await say("two", { model: { name: "agtight/fake-big" } });
    assert.equal(calls().filter((c) => c.method === "session/new").length, opened + 2, "the refused session, then a bare one");
    assert.equal(prompts().at(-1), "two", "the message alone");
    assert.ok(!(rec.changes || []).some((/** @type {string} */ c) => c.startsWith("compose: agent: agtight refused the seed")), "no composition made: the record keeps the first");
  });

  // (fails before: no — a guard the mutation pass asked for: a note that waited for the refused session's word on its
  // commands waited on — that session was gone — and nothing reached the fresh session's turn)
  test("a note that waits for the agent's word on its commands as its seed is refused waits for the fresh session's, said once", async () => {
    const id = String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model: "m-1", preset: "plain", settings: { context: { compaction: { model: "m-1", mode: "auto" } } } } })).id);
    const turns = `/api/sessions/${encodeURIComponent(id)}/turns`;
    assert.equal((await shim.api(turns, { method: "POST", body: { content: "one", stream: false } })).status, 200);
    const opened = calls().filter((c) => c.method === "session/new").length;
    const res = await shim.api(turns, { method: "POST", body: { content: "~steerable", stream: true, runEvents: true, settingsPatch: { model: { name: "agquiet/fake-big" } }, sendAsIs: true } });
    assert.equal(res.status, 200);
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    for (const text of ["/tmp is full ~again", "clear it"]) {
      const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text, from: "harness" } });
      assert.equal(r.status, 200, await r.clone().text());
    }
    const waiting = "acp: /tmp may be agquiet's own command, and agquiet has not said its commands yet: the message waits until it says them, or answers without them";
    await until(async () => (/** @type {any} */ (await shim.record(runId))?.priorChanges || []).includes(waiting) || null, "the note to wait for the agent's word");
    // The refused session says its commands (none), and its prompt is refused for its size; the fresh one's goes on.
    writeFileSync(join(root, "quiet-gate"), "");
    const said = await body;
    const fresh = calls().filter((c) => c.method === "session/new").slice(opened);
    assert.equal(fresh.length, 2, "the refused session, then a fresh one");
    assert.deepEqual(calls().filter((c) => c.method === "queued prompt" && fresh.some((f) => f.sessionId === c.sessionId)).map((c) => [c.sessionId, c.words]), [[fresh[1].sessionId, "/tmp is full ~again"], [fresh[1].sessionId, "clear it"]], "both went into the fresh session's turn, in order");
    assert.match(said, /heard:\/tmp is full ~again/);
    assert.match(said, /heard:clear it/);
    const rec = /** @type {any} */ (await shim.record(runId));
    assert.equal(rec.changes.filter((/** @type {string} */ c) => c === waiting).length, 1, rec.changes.join("\n"));
  });

  // The account-switch fix (filament-agent worktree plan, 2b-A, D1–D2). (fails before: yes — neither account's window
  // was known, so both switches weighed the chat against compose's 200,000 and seeded it whole)
  test("the window the agent named is the switch's line: its account's, and its other accounts' until they name their own", async () => {
    const first = await chat();
    await first("~window 4000", { model: { name: "ag/fake-named" } });
    const long = (/** @type {string} */ w) => `${w} ${"words ".repeat(800)}`;
    for (const to of ["ag/fake-named", "ag2/fake-named"]) {
      const say = await chat();
      for (const t of ["one", "two", "three", "four"]) await say(long(t));
      const rec = await say("five", { model: { name: to } });
      const seed = String(prompts().at(-1));
      assert.ok(seed.startsWith(`${COMPACTED_WORDS}:\n\n### User\n[Filament compacted `), `${to}: ${seed.slice(0, 300)}`);
      assert.ok(
        (rec.changes || []).includes("compose: agent: another model answered last, so this turn starts a fresh agent session from the composition — it was past the line, so Filament made room on its copy first"),
        `${to}: ${(rec.changes || []).join("\n")}`,
      );
    }
  });

  // What the owner met on 2026-10-10: the meter said 358K (what the agent that answered last held) and this stop said
  // "the history weighs 1,772,113". (fails before: yes — the stop named neither whose copy it weighs nor why that copy
  // is read whole, so it read as the agent's own context and contradicted the meter)
  test("under Ask first, a switch past the line stops in words that say what is weighed: Filament's copy, which the fresh session starts from", async () => {
    const id = String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model: "m-1", preset: "plain", settings: { context: { compaction: { model: "m-1", mode: "ask" } } } } })).id);
    const turns = `/api/sessions/${encodeURIComponent(id)}/turns`;
    const long = (/** @type {string} */ w) => `${w} ${"words ".repeat(800)}`;
    for (const t of ["one", "two", "three", "four"]) assert.equal((await shim.api(turns, { method: "POST", body: { content: long(t), stream: false } })).status, 200);
    const opened = calls().filter((c) => c.method === "session/new").length;
    const res = await shim.api(turns, { method: "POST", body: { content: "five", stream: false, settingsPatch: { model: { name: "ag/fake-small" } }, sendAsIs: true } });
    const said = await res.text();
    assert.equal(res.status, 409, said);
    assert.match(
      said,
      /another model answered last, so this turn starts a fresh agent session from Filament's copy of the chat, which weighs ≈[\d,]+ of the agent's 4,000-token window, past the [\d,]+-token compaction line — choose how to make room and send again \(Compact and send\), or set context\.compaction\.mode to auto/,
    );
    assert.doesNotMatch(said, /the history weighs/);
    // (fails before: yes — HarnessV4_Tasks C26: the refusal said nothing of what would read the session, for the card)
    const body = JSON.parse(said);
    assert.deepEqual([body.needsCompaction, body.reads.kind, body.reads.from, body.estimated, body.cache], [true, "agent", "copy", true, null]);
    // (fails before: yes — HarnessV4_Tasks A7: the switch's form was not sent back, so Compact and send lost the card's answer)
    assert.equal(body.carry, "words", "the switch's form goes back with the question");
    assert.equal(calls().filter((c) => c.method === "session/new").length, opened, "nothing was opened or sent");
  });

  // (fails before: yes — HarnessV4_Tasks C20: the turn's details read "compose: the request leaves 0 tokens of the
  // 4,000-token window — not even the 1,024-token reply floor fits; compact before the next turn", about Filament's
  // copy of the chat, while the agent went on in its own session and was sent the new message alone)
  test("an agent that goes on in its own session: what its turn notes of Filament's copy says what the copy is, and asks for no compaction of a request", async () => {
    const say = await chat();
    const long = (/** @type {string} */ w) => `${w} ${"words ".repeat(800)}`;
    /** @type {any} */
    let rec = null;
    // Three long turns: Filament's copy no longer leaves room for a reply in the agent's window, and the agent, which
    // states no count, is still under its own line by Filament's estimate of what it holds.
    for (const t of ["one", "two", "three"]) rec = await say(long(t), { model: { name: "ag/fake-small" } });
    assert.ok(String(prompts().at(-1)).startsWith("three words "), "the agent was sent the new message alone");
    assert.ok(!(rec.changes || []).some((/** @type {string} */ c) => /compaction: turns|fresh session/.test(c)), "and went on in its own session");
    const notes = /** @type {string[]} */ (rec.changes || []).filter((c) => c.startsWith("compose: "));
    assert.ok(
      notes.some((c) => /^compose: Filament's copy of the chat weighs ≈[\d,]+ of the agent's 4,000-token window, leaving under the 1,024-token reply floor\. While the agent goes on in its own session it holds the conversation itself, and this copy is not sent; a fresh agent session, or a switch to another model, starts from it — Compact now makes room on it$/.test(c)),
      notes.join("\n"),
    );
    assert.ok(!notes.some((c) => /compact before the next turn|max_tokens|the request leaves/.test(c)), notes.join("\n"));
  });

  // (fails before: yes — the turn taught the estimator a factor for the agent's model: what the agent said it holds over
  // Filament's estimate of its own copy. On the owner's install the same Opus was ×1.82 on one account and ×0.63 on another.)
  test("an agent's turn teaches the token estimator nothing: what it states is its own context's count, not this body's", async () => {
    const say = await chat();
    for (const t of ["one", "two", "three"]) await say(`${t} ${"words ".repeat(800)} ~holds 900`, { model: { name: "ag/fake-big" } });
    const learned = /** @type {any[]} */ (await json("/api/token-calib"));
    assert.deepEqual(learned.filter((e) => String(e.key).startsWith("ag")).map((e) => e.key), []);
  });
});

// HarnessV4_Tasks C19: Filament weighs its copy of a chat before a coding agent's fresh session starts from it. The
// agent's own counts teach the estimator nothing, but its turns name the model that counted them, and that model's
// factor, learned on an upstream Filament calls directly, is the scale the copy is weighed on.
describe("through the app: an agent's model weighed on the scale its turns' model showed over the API", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */ let shim;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */ let api;
  let root = "";
  let projDir = "";
  const SUMMARY = "SUMMARY: the turns so far, condensed.";
  /** Each prompt's seed: what follows Filament's own head, where it has one. */
  const prompts = () => lines(join(root, "prompts.jsonl")).map((p) => afterHead(p.prompt));
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-agent-scale-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    // An API whose tokenizer counts half of what Filament's estimator does, and says so on every reply.
    api = await fakeUpstream((call) => anthropicReply(SUMMARY, { model: "real-model", usage: { input_tokens: Math.round(estimateBodyTokens(call.body, "request") * 0.5), output_tokens: 5 } }));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          {
            id: "cc",
            name: "cc",
            type: "acp",
            acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_LOG: join(root, "prompts.jsonl") }, cwdDefault: projDir, permissions: "allow-all", hints: false },
            // Two of the agent's models, each with the same small window.
            pricing: { alias: { contextTokens: 4000 }, unnamed: { contextTokens: 4000 } },
          },
          { id: "api", name: "api", type: "anthropic", baseUrl: api.url, apiKey: "s", enabled: true, pricing: { "real-model": { input: 1, output: 1, contextTokens: 200000 } } },
        ];
        cfg.routes = [
          { match: "cc/*", upstream: "cc", upstreamModel: "{1}", enabled: true },
          { match: "real-model", upstream: "api", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await api.close();
    await removeDirs(root);
  });
  /** @param {string} path @param {any} [init] */
  const json = async (path, init) => (await shim.api(path, init)).json();
  const chat = async () => {
    const id = String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model: "real-model", preset: "plain", settings: { context: { compaction: { model: "real-model", mode: "auto" } } } } })).id);
    // A turn that switches the model answers the switch's question Send as it is (HarnessV4_Tasks A7).
    /** @param {string} content @param {any} [settingsPatch] */
    return async (content, settingsPatch) => {
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false, ...(settingsPatch ? { settingsPatch, sendAsIs: true } : {}) } });
      assert.equal(res.status, 200, await res.clone().text());
      return /** @type {any} */ (await shim.record(String(res.headers.get("x-filament-request-id"))));
    };
  };
  const PAST = "compose: agent: another model answered last, so this turn starts a fresh agent session from the composition — it was past the line, so Filament made room on its copy first";
  const long = (/** @type {string} */ w) => `${w} ${"words ".repeat(800)}`;

  // (fails before: yes — an agent's model was served no factor: the same chat was weighed on the plain estimate for
  // both of the agent's models, past the 4,000-token window's line, and compacted before either fresh session)
  test("a chat past the agent's line on the plain estimate goes in whole once the agent's turns named a model the API taught the estimator", async () => {
    // The API's replies teach the estimator its model; an agent's turn names that model as the one that counted it.
    const first = await chat();
    for (const t of ["one", "two", "three"]) await first(long(t));
    await first("~counted real-model", { model: { name: "cc/alias" } });
    const learned = /** @type {any[]} */ (await json("/api/token-calib"));
    const own = learned.find((e) => e.key === "api::real-model");
    assert.ok(own && own.f === 0.5 && own.n >= 3, JSON.stringify(learned));
    assert.deepEqual({ ...learned.find((e) => e.key === "cc::alias"), at: 0 }, { key: "cc::alias", as: "real-model", from: "api::real-model", f: 0.5, n: own.n, at: 0 });
    assert.deepEqual(learned.filter((e) => String(e.key).startsWith("cc::")).map((e) => e.key), ["cc::alias"], "the helper model that wrote more names nothing, and the agent's counts teach no factor");

    // The same chat, into each of the agent's two models: the named one weighs it at half and takes it whole.
    for (const [to, whole] of /** @type {[string, boolean][]} */ ([["cc/unnamed", false], ["cc/alias", true]])) {
      const say = await chat();
      for (const t of ["one", "two", "three", "four"]) await say(long(t));
      const rec = await say("five", { model: { name: to } });
      const seed = String(prompts().at(-1));
      assert.equal(seed.startsWith(`${EARLIER_WORDS}:\n\n### User\none words `), whole, `${to}: ${seed.slice(0, 200)}`);
      assert.equal(seed.startsWith(`${COMPACTED_WORDS}:\n\n### User\n[Filament compacted `), !whole, `${to}: ${seed.slice(0, 200)}`);
      assert.equal((rec.changes || []).includes(PAST), !whole, `${to}: ${(rec.changes || []).join("\n")}`);
    }
  });
});
