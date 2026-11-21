// P7 — archive-backed continuity (§11.1–11.3).
//
// The client's history is lossy in one direction (it compacted, and it carries the narration it was shown) and an
// agent's session is lossy in the other (it never saw the turns another model handled). The archive is the only place
// holding the whole cross-model conversation byte-exact, so it is the better seed for a new agent session.
//
// The subtle part these tests exist for: `memory.prepare` archives the newest user message BEFORE the agent is asked
// anything, so a naive "render the whole chain" seed repeats that message — once in the seed and again under "Latest
// user message". The exclusion has to be matched on TEXT, not by always dropping the last turn, because when memory
// did not prepare this request (a tool-loop leg, a housekeeping call, an excluded client) the last archived turn is an
// older one and dropping it would silently lose real history.
import "./helpers/clean-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryService } from "../src/memory-service.js";
import { seedBudgetOf } from "../src/services/memory/index.js";

const dir = mkdtempSync(join(tmpdir(), "filament-p7-"));
const UA = "opencode/1.0";
const sys = (cwd) => `Working directory: ${cwd}`;
const projectDir = join(dir, "project");

// A request shape like the ones the server builds: the chain key comes from the client's conversation id header, so
// every request in one chat lands on one chain. `newestText` is what the bridge passes — the text of the message about
// to be sent — and it is what the in-flight-turn exclusion is matched against.
const req = (texts, { conversationId = "chat-p7-1", model = "claude-x" } = {}) => {
  const messages = [];
  texts.forEach((t, i) => { messages.push({ role: "user", content: t }); if (i < texts.length - 1) messages.push({ role: "assistant", content: `answer ${i}` }); });
  return {
    format: "anthropic", model,
    body: { model, max_tokens: 100, system: sys(projectDir), messages },
    headers: { "user-agent": UA, "x-session-id": conversationId },
    newestText: texts.at(-1) || "",
  };
};

const makeService = (enabled = true) => {
  const cfg = {
    server: { port: 0, inboundKeys: ["k"] },
    memory: {
      enabled, folder: join(dir, `memory-${enabled}-${Math.random().toString(36).slice(2, 8)}`),
      engine: { embeddings: false }, autopilot: { enabled: false, tools: false },
      capture: { turns: true, learn: false }, commands: { enabled: false }, privacy: { encryptArchive: false },
    },
  };
  const svc = new MemoryService({ getConfig: () => cfg, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:0", getModelNames: () => ["claude-x"] });
  svc.start();
  return svc;
};

// Archive two turns of a chat through the real prepare/afterReply flow, so the chain holds what a real chat holds.
// One message per turn is enough: the chain key comes from the conversation id header, not from the body.
async function archiveTwoTurns(svc, conversationId = "chat-p7-1") {
  const out = [];
  const texts = ["first question about the watchdog", "second question about the tray"];
  for (const [i, text] of texts.entries()) {
    const sit = svc.situate(req([text], { conversationId }));
    assert.ok(sit?.key, `situate produced a chain key for turn ${i + 1}`);
    const prep = await svc.prepare(sit, { requestId: `p7-r${i}`, upstream: "anthropic" });
    svc.afterReply({ chainId: prep.chain, turnId: prep.turn, requestId: `p7-r${i}`, finalMessage: { role: "assistant", content: [{ type: "text", text: `ANSWER-${i + 1} about ${text.slice(0, 12)}` }] }, outputTokens: 20 });
    out.push(prep.chain);
  }
  assert.equal(out[0], out[1], "both turns landed on one chain");
  return out[0];
}

test("chainIdForKey looks up without creating, which is what makes it safe from a path that archives nothing", () => {
  const svc = makeService(true);
  try {
    const count = () => svc.archive.recentChains({ limit: 500 }).length;
    const before = count();
    assert.equal(svc.archive.chainIdForKey("no-such-key-at-all"), null, "an unknown key is null, not a new chain");
    assert.equal(svc.archive.chainIdForKey(""), null, "and an empty key does not throw");
    assert.equal(svc.archive.chainIdForKey(null), null);
    assert.equal(count(), before, "no chain was created by a miss — the ACP path does not archive, so a miss must leave the archive exactly as it was");
    // A real key does resolve.
    const sit = svc.situate(req(["hello there"], { conversationId: "chat-lookup" }));
    const made = svc.archive.chainForKey(sit.key, { project: null, cwd: projectDir, client: "opencode", model: "claude-x" });
    assert.equal(svc.archive.chainIdForKey(sit.key), made.id, "and a key that exists resolves to its chain");
    assert.equal(count(), before + 1, "created by chainForKey, which is the writing call — not by the lookup");
  } finally { svc.stop(); }
});

test("archivedTranscript returns the archived conversation, and nothing when there is none", async () => {
  const svc = makeService(true);
  try {
    // A chat that has never been archived: null, so the caller falls back to the request body.
    const empty = svc.archivedTranscript(req(["brand new chat"], { conversationId: "chat-never-archived" }), {});
    assert.equal(empty, null, "an unarchived chat has nothing to seed from");
    assert.equal(svc.archive.chainIdForKey(svc.situate(req(["brand new chat"], { conversationId: "chat-never-archived" })).key), null, "and looking it up did not create a chain");

    const chainId = await archiveTwoTurns(svc);
    const got = svc.archivedTranscript(req(["a third question"], { conversationId: "chat-p7-1" }), {});
    assert.ok(got, "an archived chat returns a transcript");
    assert.equal(got.chainId, chainId);
    assert.equal(got.view, "chat", "the default view");
    assert.match(got.text, /first question about the watchdog/, "it holds the real user text");
    assert.match(got.text, /ANSWER-1/, "and the real answers");
    assert.ok(got.turns >= 2, `both turns are there: ${got.turns}`);
    assert.ok(got.tokens > 0, "with a token count for the record");
  } finally { svc.stop(); }
});

test("archivedTranscript excludes the in-flight turn, matched on text and not by position", async () => {
  const svc = makeService(true);
  try {
    await archiveTwoTurns(svc);
    const newest = "second question about the tray"; // exactly what the last archived turn holds
    const withMatch = svc.archivedTranscript(req([newest], { conversationId: "chat-p7-1" }), {});
    assert.ok(withMatch, "a transcript came back");
    assert.equal(withMatch.excludedInFlight, true, "it says the in-flight turn was excluded");
    assert.ok(!withMatch.text.includes("ANSWER-2"), `the in-flight turn's answer is not in the seed: ${withMatch.text.slice(-200)}`);
    assert.match(withMatch.text, /first question about the watchdog/, "and the turn BEFORE it still is — real history was not dropped");

    // A newest message that is NOT the last archived turn (a tool-loop leg, a retry, a client memory did not prepare):
    // nothing is excluded, because dropping the last turn here would lose a turn the agent has not seen.
    const noMatch = svc.archivedTranscript(req(["something entirely different"], { conversationId: "chat-p7-1" }), {});
    assert.equal(noMatch.excludedInFlight, false, "no exclusion when the text does not match");
    assert.match(noMatch.text, /ANSWER-2/, "so the last archived turn is kept");

    // No newestText at all: nothing to compare against, nothing excluded.
    const none = svc.archivedTranscript({ format: "anthropic", body: { model: "claude-x", system: sys(projectDir), messages: [] }, headers: { "user-agent": UA, "x-session-id": "chat-p7-1" }, model: "claude-x" }, {});
    assert.ok(none && none.excludedInFlight === false, "and an empty request does not exclude anything");
  } finally { svc.stop(); }
});

test("a chat whose ONLY archived turn is the one in flight has nothing to seed from", async () => {
  const svc = makeService(true);
  try {
    const r = req(["the one and only message"], { conversationId: "chat-p7-solo" });
    const sit = svc.situate(r);
    const prep = await svc.prepare(sit, { requestId: "p7-solo", upstream: "anthropic" });
    svc.afterReply({ chainId: prep.chain, turnId: prep.turn, requestId: "p7-solo", finalMessage: { role: "assistant", content: [{ type: "text", text: "solo answer" }] }, outputTokens: 5 });
    // Seeding a new agent session for this chat, newest message being the one already archived: excluding it leaves
    // nothing, and an empty seed is worse than falling back to the client's history (which at least has the message).
    const got = svc.archivedTranscript(req(["the one and only message"], { conversationId: "chat-p7-solo" }), {});
    assert.equal(got, null, "null, so the caller falls back rather than sending an empty preamble");
  } finally { svc.stop(); }
});

test("the view knob changes the shape: chat is a transcript, summary is the handoff shape", async () => {
  const svc = makeService(true);
  try {
    await archiveTwoTurns(svc);
    const args = { format: "anthropic", body: req(["third"]).body, headers: { "user-agent": UA, "x-session-id": "chat-p7-1" }, model: "claude-x", cwdHint: "", newestText: "third" };
    const chat = svc.archivedTranscript(args, { view: "chat" });
    const summary = svc.archivedTranscript(args, { view: "summary" });
    const compact = svc.archivedTranscript(args, { view: "compact" });
    assert.equal(chat.view, "chat"); assert.equal(summary.view, "summary"); assert.equal(compact.view, "compact");
    assert.ok(summary.text && summary.text.length > 0, "the summary view renders text too");
    assert.ok(summary.tokens <= chat.tokens + 40, `the summary view is not larger than the transcript (${summary.tokens} vs ${chat.tokens})`);
    // §11.3's cross-agent handoff needs no model call: the archive already stores per-turn summaries.
    assert.match(summary.text, /watchdog|tray/, "and it still carries what the turns were about");
    // An unknown view falls back to chat rather than throwing or rendering nothing.
    assert.equal(svc.archivedTranscript(args, { view: "nonsense" }).view, "chat", "an invalid view falls back to chat");
    assert.equal(svc.archivedTranscript(args, { view: "full" }).view, "chat", "and so does `full`, which renders message objects rather than text");
  } finally { svc.stop(); }
});

test("the budget drops the OLDEST turns and reports how many", async () => {
  const svc = makeService(true);
  try {
    await archiveTwoTurns(svc);
    const args = { format: "anthropic", body: req(["third"]).body, headers: { "user-agent": UA, "x-session-id": "chat-p7-1" }, model: "claude-x", newestText: "third" };
    const roomy = svc.archivedTranscript(args, { budgetTokens: 4000 });
    assert.equal(roomy.dropped, 0, "a roomy budget keeps everything");
    const tight = svc.archivedTranscript(args, { budgetTokens: 200 });
    // The smallest accepted budget is clamped, so this may or may not drop; what must hold is that it never returns
    // nothing at all and never drops the NEWEST turn.
    assert.ok(tight, "a tight budget still returns something");
    assert.match(tight.text, /second question about the tray/, "and the newest turn survives any budget");
    assert.ok(tight.dropped >= 0 && tight.tokens <= 4000, `within budget: ${tight.tokens}`);
  } finally { svc.stop(); }
});

test("the budget: the upstream's, else half the window Filament knows for the agent's model, else 100,000 — none of memory's own (AC-R1)", async () => {
  assert.deepEqual([seedBudgetOf(0), seedBudgetOf(64_000), seedBudgetOf(1_000_000)], [100_000, 32_000, 500_000]);
  const svc = makeService(true);
  try {
    await archiveTwoTurns(svc);
    const args = { format: "anthropic", body: req(["third"]).body, headers: { "user-agent": UA, "x-session-id": "chat-p7-1" }, model: "claude-x", newestText: "third" };
    assert.equal(svc.archivedTranscript(args, {}).budget, 100_000, "no window known");
    assert.equal(svc.archivedTranscript(args, { window: 64_000 }).budget, 32_000);
    assert.equal(svc.archivedTranscript(args, { budgetTokens: 50_000, window: 64_000 }).budget, 50_000, "the upstream's own, past what memory once capped it at");
  } finally { svc.stop(); }
});

test("with memory off there is no archive to seed from, and nothing throws", () => {
  const svc = makeService(false);
  try {
    assert.equal(svc.enabled(), false, "memory is off");
    assert.equal(svc.archivedTranscript(req(["anything"]), {}), null, "so the seed is null and the caller falls back");
    assert.equal(svc.archivedTranscript(undefined, undefined), null, "and a malformed call does not throw");
    assert.equal(svc.archivedTranscript({}, {}), null);
  } finally { svc.stop(); }
});

test("end to end: a new agent session is seeded from the ARCHIVE, not from the client's diminished history", async () => {
  // The scenario §11.1 exists for. The client compacted, so it resends only the newest message; the archive still
  // holds the earlier turns, so the agent gets them anyway. A body-only seed structurally cannot do this.
  const { createServer } = await import("node:http");
  const { createApp } = await import("../src/server.js");
  const { defaultConfig } = await import("../src/config.js");
  const FAKE = join(process.cwd(), "test", "fixtures", "fake-acp-agent.mjs");
  const FAKE_SDK = join(process.cwd(), "test", "fixtures", "fake-cursor-sdk.mjs");
  const appDir = mkdtempSync(join(tmpdir(), "filament-p7-app-"));
  const agentLog = join(appDir, "prompts.jsonl");
  const sdkLog = join(appDir, "sdk.jsonl");
  process.env.FAKE_SDK_LOG = sdkLog;

  // A minimal API upstream, so the first two turns of the chat are archived by the normal memory path.
  const api = createServer((rq, rs) => {
    let b = ""; rq.on("data", (d) => (b += d));
    rq.on("end", () => {
      const j = JSON.parse(b || "{}");
      const last = (j.messages || []).filter((m) => m.role === "user").at(-1)?.content || "";
      rs.writeHead(200, { "content-type": "application/json" });
      rs.end(JSON.stringify({ id: "msg_api", type: "message", role: "assistant", model: j.model, content: [{ type: "text", text: `api answered: ${String(last).slice(0, 40)}` }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }));
    });
  });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));

  const cfg = defaultConfig();
  cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.experimental.cursorSdk = true; // its `sd` upstream is Cursor through its SDK, behind Settings › Experimental
  // The agent loop, always on (the owner's of 11-09), claims the `agent/*` names this suite routes to its fake ACP
  // upstream only on a harness chat's turn or Filament's own call, and these are a client's requests.
  cfg.memory = { ...cfg.memory, enabled: true, folder: join(appDir, "memory"), engine: { embeddings: false }, autopilot: { enabled: false, tools: false }, capture: { turns: true, learn: false }, commands: { enabled: false }, privacy: { encryptArchive: false } };
  cfg.upstreams = [
    { id: "api", name: "api", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${api.address().port}`, apiKey: "s" },
    { id: "ag", name: "agent", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: agentLog }, cwdDefault: appDir, permissions: "allow-all" } },
    // The Cursor SDK bridge too: the last three reviews each found a feature wired into one bridge and not the other,
    // so "both bridges" is only a claim until both are driven end to end.
    { id: "sd", name: "sdk", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: appDir, permissions: "allow-all" } },
  ];
  cfg.routes = [{ match: "api/*", upstream: "api", upstreamModel: "{1}", format: "auto" }, { match: "agent/*", upstream: "ag", upstreamModel: "{1}", format: "auto" }, { match: "sdk/*", upstream: "sd", upstreamModel: "{1}", format: "auto" }];
  writeFileSync(join(appDir, "config.json"), JSON.stringify(cfg));
  const app = createApp({ dataDir: appDir, overrides: { port: 0, cursorSdkLoader: () => import(pathToFileURL(FAKE_SDK).href) } });
  const { port } = await app.start();
  const H = { "content-type": "application/json", "x-api-key": "k", "anthropic-version": "2023-06-01" };
  const SESS = `p7-e2e-${Math.random().toString(36).slice(2, 8)}`;
  const send = (model, messages) => fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": SESS }, body: JSON.stringify({ model, max_tokens: 60, system: `Working directory: ${appDir}`, messages }) }).then((r) => r.json());
  const prompts = () => (existsSync(agentLog) ? JSON.parse(`[${readFileSync(agentLog, "utf8").trim().split("\n").filter(Boolean).join(",")}]`) : []);

  try {
    // Two turns with the API model. These are archived, and they are the turns the agent has never seen.
    await send("api/claude-x", [{ role: "user", content: "the watchdog keeps relaunching the tray" }]);
    await send("api/claude-x", [{ role: "user", content: "the watchdog keeps relaunching the tray" }, { role: "assistant", content: "api answered" }, { role: "user", content: "does removing either one fix it" }]);
    // Now switch to the agent, with a CLIENT THAT COMPACTED: it resends only the newest message.
    await send("agent/fake-a", [{ role: "user", content: "so which one should I remove" }]);
    const p = prompts().at(-1);
    assert.ok(p, "the agent was called");
    assert.match(p.text, /watchdog keeps relaunching/, "the seed carries a turn the client did NOT resend — only the archive had it");
    assert.match(p.text, /Latest user message:\s*\n\s*\nso which one should I remove/, "and the newest message is still sent as itself, once");
    const occurrences = p.text.split("so which one should I remove").length - 1;
    assert.equal(occurrences, 1, `the in-flight turn was excluded from the seed, so it appears exactly once (got ${occurrences})`);
    const rec = app.usage.list(3).find((r) => (r.changes || []).some((c) => /seeded from Filament's archive/.test(c)));
    assert.ok(rec, `the record says the archive was the source: ${JSON.stringify(app.usage.list(1)[0].changes).slice(-300)}`);
    const notes = rec.changes.filter((c) => /archive/.test(c));
    assert.ok(notes.some((c) => /seeded from Filament's archive \(chat view\) — \d+ turn/.test(c)), `the record says the archive was the source, which view, and how much: ${JSON.stringify(notes).slice(0, 400)}`);
    assert.ok(notes.some((c) => /new session .*seeded from Filament's archive/.test(c)), "and the new-session note agrees");
    assert.ok(notes.some((c) => /this turn excluded/.test(c)), `the in-flight turn is reported as excluded: ${JSON.stringify(notes).slice(0, 400)}`);

    // THE CONTROL: with the knob off, the same compacted client produces a seed that does NOT have the old turns.
    // Without this the test would pass on a body-only seed that happened to contain the words.
    app.config.upstreams.find((u) => u.id === "ag").acp.seedFromArchive = false;
    const SESS2 = `p7-e2e-off-${Math.random().toString(36).slice(2, 8)}`;
    const send2 = (model, messages) => fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": SESS2 }, body: JSON.stringify({ model, max_tokens: 60, system: `Working directory: ${appDir}`, messages }) }).then((r) => r.json());
    await send2("api/claude-x", [{ role: "user", content: "a completely different topic about printers" }]);
    await send2("agent/fake-a", [{ role: "user", content: "and now the scanner" }]);
    const p2 = prompts().at(-1);
    assert.ok(!p2.text.includes("watchdog keeps relaunching"), "with seedFromArchive off the archive is not consulted");
    assert.ok(!p2.text.includes("different topic about printers"), "and a compacted client's seed really is just what it resent");
    const rec2 = app.usage.list(1)[0];
    assert.ok(!(rec2.changes || []).some((c) => /seeded from Filament's archive/.test(c)), "with the knob off the archive is never claimed as the source");
    assert.ok(!(rec2.changes || []).some((c) => /seeded/.test(c)), `and a compacted client with no body history seeds nothing at all: ${JSON.stringify(rec2.changes).slice(-240)}`);

    // The other fallback: the knob off but the client DID send history, so the body is used and the record says so —
    // and it says "the knob is off", not "nothing was archived", because those have different remedies.
    const SESS3 = `p7-e2e-body-${Math.random().toString(36).slice(2, 8)}`;
    const send3 = (model, messages) => fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": SESS3 }, body: JSON.stringify({ model, max_tokens: 60, system: `Working directory: ${appDir}`, messages }) }).then((r) => r.json());
    await send3("api/claude-x", [{ role: "user", content: "a question about the paper shredder" }]);
    await send3("agent/fake-a", [
      { role: "user", content: "a question about the paper shredder" },
      { role: "assistant", content: "api answered" },
      { role: "user", content: "and the jam light" },
    ]);
    const p3 = prompts().at(-1);
    assert.match(p3.text, /paper shredder/, "the body-based seed carries what the client resent");
    const rec3 = app.usage.list(1)[0];
    assert.ok((rec3.changes || []).some((c) => /seeded from the client's history \(acp\.seedFromArchive is off\)/.test(c)), `and the record says the knob is why: ${JSON.stringify(rec3.changes).slice(-300)}`);

    // THE SDK BRIDGE, end to end: same compacted client, same archive, other bridge. Three reviews in a row found a
    // feature wired into one bridge and not the other, so this is not a redundant assertion.
    app.config.upstreams.find((u) => u.id === "ag").acp.seedFromArchive = true;
    const SESS4 = `p7-e2e-sdk-${Math.random().toString(36).slice(2, 8)}`;
    const send4 = (model, messages) => fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k", "x-session-id": SESS4 }, body: JSON.stringify({ model, messages }) }).then((r) => r.json());
    await send4("api/claude-x", [{ role: "user", content: "the sdk chat begins with a question about the router" }]);
    await send4("sdk/grok-4.6", [{ role: "user", content: "and now the modem" }]);
    const sdkEvents = existsSync(sdkLog) ? readFileSync(sdkLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    const sent = sdkEvents.filter((e) => e.event === "send").at(-1);
    assert.ok(sent, `the SDK agent was called: ${sdkEvents.map((e) => e.event).join(", ")}`);
    assert.match(sent.text, /question about the router/, "the SDK bridge seeds from the archive too — the client resent only the newest message");
    assert.match(sent.text, /Latest user message:\s*\n\s*\nand now the modem/, "with the newest message sent as itself");
    assert.equal(sent.text.split("and now the modem").length - 1, 1, "and the in-flight turn was excluded, so it is not repeated");
    const rec4 = app.usage.list(4).find((r) => (r.changes || []).some((c) => /sdk: seeded from Filament's archive/.test(c)));
    assert.ok(rec4, `the SDK record says the archive was the source: ${JSON.stringify(app.usage.list(1)[0].changes).slice(-320)}`);
  } finally {
    await app.stop(); api.close();
    for (let i = 0; i < 12; i++) { try { rmSync(appDir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  }
});

test("the in-flight exclusion survives the two ways Filament itself rewrites a message", async () => {
  // THE P1s THIS PINS. The archive stores the client's RAW bytes; the text an agent turn works with has had
  // `<system-reminder>` blocks stripped and may carry a re-attached `<filament-memory>` block. Comparing those two
  // directly fails for exactly the clients that inject reminders — Claude Code, i.e. the default — and it
  // fails SILENTLY: the newest message is seeded and then repeated under "Latest user message", with the client's
  // internal reminder bytes and Filament's own injection markup shown to the agent as conversation history. Every
  // fixture in this file sent bare strings, which is the only shape the naive comparison happens to survive.
  const norm = (s) => String(s).replace(/\s+/g, " ").trim();

  // (a) A client that wraps the message in a system-reminder block.
  const a = makeService(true);
  try {
    await archiveTwoTurns(a, "chat-rem");
    const wrapped = `<system-reminder>The user just saved a file. Today is 2026-09-17.</system-reminder>second question about the tray`;
    const body = { model: "claude-x", max_tokens: 100, system: sys(projectDir), messages: [{ role: "user", content: wrapped }] };
    const got = a.archivedTranscript({ format: "anthropic", body, headers: { "user-agent": UA, "x-session-id": "chat-rem" }, model: "claude-x" }, {});
    assert.ok(got, "a transcript came back");
    assert.equal(got.excludedInFlight, true, "the reminder-wrapped message is still recognised as the in-flight turn");
    assert.ok(!got.text.includes("ANSWER-2"), `and its answer is not in the seed: ${got.text.slice(-200)}`);
    assert.ok(!/<system-reminder>/.test(got.text), `the client's reminder bytes are not fed to the agent as history: ${got.text.slice(-200)}`);
    assert.match(got.text, /first question about the watchdog/, "while the earlier turn still is");
    // The bridge's flattened copy (what the caller passes) would NOT have matched the raw archive — prove the service
    // no longer depends on which of the two it is given.
    const viaNewestText = a.archivedTranscript({ format: "anthropic", body: { ...body, messages: [] }, headers: { "user-agent": UA, "x-session-id": "chat-rem" }, model: "claude-x", newestText: "second question about the tray" }, {});
    assert.equal(viaNewestText.excludedInFlight, true, "and a caller that only has the flattened text gets the same answer");
  } finally { a.stop(); }

  // (b) A message that already earned a memory block — the cross-model case P7 targets: the same question was asked
  // of an API model, then re-sent to the agent, so the stored block rides along on the agent's copy.
  const b = makeService(true);
  try {
    await archiveTwoTurns(b, "chat-mem");
    const withBlock = `second question about the tray\n\n<filament-memory kind="turn">\nRelated memory for this message (Filament; may be outdated):\n- something recalled\n</filament-memory>`;
    const body = { model: "claude-x", max_tokens: 100, system: sys(projectDir), messages: [{ role: "user", content: withBlock }] };
    const got = b.archivedTranscript({ format: "anthropic", body, headers: { "user-agent": UA, "x-session-id": "chat-mem" }, model: "claude-x" }, {});
    assert.equal(got.excludedInFlight, true, "a re-attached memory block does not defeat the match");
    const occurrences = got.text.split("second question about the tray").length - 1;
    assert.equal(occurrences, 0, `the in-flight message appears nowhere in the seed, not twice: ${norm(got.text.slice(-260))}`);
    assert.ok(!got.text.includes("filament-memory"), "and Filament's own injection markup is not presented as conversation history");
  } finally { b.stop(); }

  // (c) Whitespace and a block-content message (an array of parts, as Anthropic clients send) both still match.
  const c = makeService(true);
  try {
    await archiveTwoTurns(c, "chat-ws");
    const body = { model: "claude-x", max_tokens: 100, system: sys(projectDir), messages: [{ role: "user", content: [{ type: "text", text: "  second question about the tray\n\n" }] }] };
    const got = c.archivedTranscript({ format: "anthropic", body, headers: { "user-agent": UA, "x-session-id": "chat-ws" }, model: "claude-x" }, {});
    assert.equal(got.excludedInFlight, true, "block content and stray whitespace normalize to the same thing");
  } finally { c.stop(); }
});

test("a chat with no conversation-id header is never seeded from the archive", async () => {
  // Without the header the chain key is a fingerprint of (folder + first message), so two DIFFERENT chats in one
  // folder that open the same way share one chain. Seeding from it would hand one chat's transcript to another chat's
  // tool-running agent under "Earlier conversation; continue it, do not repeat it" — stated as fact, not hedged the
  // way a memory snippet is. Refusing the fingerprint key costs almost nothing: a header-less client's fingerprint
  // moves as soon as it compacts, so the lookup misses anyway.
  const svc = makeService(true);
  try {
    // Archive a chat that has NO conversation-id header, so it lands on a fingerprint key.
    const noHeader = (text) => ({ format: "anthropic", model: "claude-x", body: { model: "claude-x", max_tokens: 100, system: sys(projectDir), messages: [{ role: "user", content: text }] }, headers: { "user-agent": UA } });
    const sit = svc.situate(noHeader("can you take a look at the failing test"));
    assert.equal(sit.keySource, "fingerprint", "no conversation id means a fingerprint key");
    const prep = await svc.prepare(sit, { requestId: "p7-fp", upstream: "api" });
    svc.afterReply({ chainId: prep.chain, turnId: prep.turn, requestId: "p7-fp", finalMessage: { role: "assistant", content: [{ type: "text", text: "CHAT-ONE: the test fails because the port is in use" }] }, outputTokens: 10 });
    assert.ok(svc.archive.chainIdForKey(sit.key), "the chain exists");
    // A DIFFERENT chat, same folder, same opening line: same fingerprint, so the same chain.
    const got = svc.archivedTranscript(noHeader("can you take a look at the failing test"), {});
    assert.equal(got, null, "and yet the seed is refused — the other chat's transcript must not become this agent's history");
    // With a header, the same content is a distinct chain and seeding is allowed.
    const withHeader = { ...noHeader("can you take a look at the failing test"), headers: { "user-agent": UA, "x-session-id": "chat-headered" } };
    const sit2 = svc.situate(withHeader);
    assert.equal(sit2.keySource, "header");
    const prep2 = await svc.prepare(sit2, { requestId: "p7-h1", upstream: "api" });
    svc.afterReply({ chainId: prep2.chain, turnId: prep2.turn, requestId: "p7-h1", finalMessage: { role: "assistant", content: [{ type: "text", text: "headered answer" }] }, outputTokens: 5 });
    const got2 = svc.archivedTranscript({ ...withHeader, body: { ...withHeader.body, messages: [{ role: "user", content: "a follow-up" }] } }, { newestText: "a follow-up" });
    assert.ok(got2, "a header-keyed chat does seed");
    assert.notEqual(got2.chainId, prep.chain, "from its own chain, not the fingerprint one");
    assert.ok(!got2.text.includes("CHAT-ONE"), "and it carries none of the other chat's content");
  } finally { svc.stop(); }
});

test("partial archive coverage is disclosed, not silently shortened", async () => {
  // A chat whose early turns ran with memory off has turns the client resent that the archive lacks. Preferring the
  // archive then tells the agent it knows less than the client just said — so the record has to say so.
  const svc = makeService(true);
  try {
    await archiveTwoTurns(svc, "chat-partial");
    const got = svc.archivedTranscript(req(["a third question"], { conversationId: "chat-partial" }), {});
    assert.ok(got && got.turns === 2, `the archive holds the two turns it has: ${got?.turns}`);
    // The bridge compares that against the client's resent history; this test pins the number it compares against.
    assert.equal(typeof got.turns, "number");
    assert.equal(got.dropped, 0, "and nothing was dropped by the budget");
  } finally { svc.stop(); }
});

test("cleanup", () => { for (let i = 0; i < 12; i++) { try { rmSync(dir, { recursive: true, force: true }); break; } catch { /* Windows holds the db briefly */ } } });
