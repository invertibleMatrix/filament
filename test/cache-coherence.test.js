// Cache-coherence P1 fixes (2026-09-19 audit): tool-leg re-attach, no new blocks on tool legs,
// sticky tools, and quiet mode for x-filament-memory: off. Each test fails if its fix is reverted.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryService } from "../src/memory-service.js";
import { MemoryEngine } from "../src/memory-engine.js";
import { MEMORY_TAG, messageHash } from "../src/memory-brain.js";
import { openaiToAnthropicRequest, anthropicToOpenaiResponse } from "../src/translate.js";
import { memoryCommand } from "../src/app/commands/mem.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-sidecar.mjs", import.meta.url));
const CC_UA = { "user-agent": "claude-cli/2.1.258 (external, cli)" };
const sys = (cwd = "C:\\cachefix") => `You are Claude Code.\n<env>\nWorking directory: ${cwd}\nIs a git repo: yes\n</env>`;
const strip = (s) => String(s).replace(/\n*<filament-memory[\s\S]*?<\/filament-memory>\n*/g, "");

let dir, svc, cfg;
const req = (userTexts, { cwd = "C:\\cachefix", headers = CC_UA, assistant = "ok" } = {}) => {
  const messages = []; userTexts.forEach((t, i) => { messages.push({ role: "user", content: t }); if (i < userTexts.length - 1) messages.push({ role: "assistant", content: `${assistant} ${i}` }); });
  return { format: "anthropic", body: { model: "claude-x", max_tokens: 100, system: sys(cwd), messages }, headers, model: "claude-x" };
};

before(() => {
  dir = mkdtempSync(join(tmpdir(), "filament-cachefix-"));
  cfg = { server: { port: 20398, inboundKeys: ["k"] }, memory: { enabled: true, folder: join(dir, "memory"), engine: { embeddings: true, bank: "default" }, autopilot: { enabled: true, mode: "conservative", briefingTokens: 1200, turnTokens: 300, minScore: 0.2, tools: true, cue: true }, capture: { turns: true, learn: true }, commands: { enabled: true, prefix: "@mem" }, privacy: { encryptArchive: true } } };
  svc = new MemoryService({ getConfig: () => cfg, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20398", getModelNames: () => ["claude-haiku-4-5"] });
  svc.start();
  svc.store = new MemoryEngine({ command: process.execPath, args: [FAKE], env: { FAKE_SIDECAR_STATE: join(dir, "fake-state.json") }, writeConfig: false });
  svc.brain.store = svc.store;
});
after(async () => { await svc.store?.stop?.(); svc.stop(); for (let i = 0; i < 10; i++) { try { rmSync(dir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 200)); } } });

test("P1.1: a deferred memory-tool result attached to a tool leg is re-attached on every resend", async () => {
  const r1 = req(["please search memory for the tray decision"]);
  const prep1 = await svc.prepare(svc.situate(r1), { requestId: "d1" });
  // The model mixed memory tools with client tools: Filament ran the memory calls and parked the results.
  svc.brain.setDeferred(prep1.chain, "tray decision: keep the qwen summarizer (2026-09-18)");
  const leg = { format: "anthropic", body: { model: "claude-x", system: sys(), messages: [r1.body.messages[0], { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "Read", input: { file_path: "x" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "file bytes" }] }] }, headers: CC_UA, model: "claude-x" };
  await svc.prepare(svc.situate(leg), { requestId: "d2" });
  const legAfter = leg.body.messages.at(-1).content;
  assert.ok(legAfter.some((b) => b.type === "text" && b.text.includes(`<${MEMORY_TAG} kind="tool">`) && b.text.includes("qwen summarizer")), "the deferred results ride along on the tool leg");
  // The client resends history WITHOUT Filament's blocks (it never saw them): the leg must get the same block back.
  const resent = { format: "anthropic", body: { model: "claude-x", system: sys(), messages: [{ role: "user", content: strip(r1.body.messages[0].content) }, { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "Read", input: { file_path: "x" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "file bytes" }] }, { role: "assistant", content: "noted" }, { role: "user", content: "and now something completely different about sourdough" }] }, headers: CC_UA, model: "claude-x" };
  await svc.prepare(svc.situate(resent), { requestId: "d3" });
  const legResent = resent.body.messages[2].content;
  assert.ok(legResent.some((b) => b.type === "text" && b.text.includes("qwen summarizer")), "P1.1: the leg block is re-attached on the resend (was bare before the fix)");
  assert.deepEqual(legResent, legAfter, "byte-identical to what the provider saw the first time");
});

// (fails before: yes — the review of a9afebe80: the results were kept under the message's own key, over the recall the
// failed request had stored there: the retry sent the message with both, the next turn with the results alone — its
// bytes changed under the provider's cache, its recall gone for good)
test("deferred results on a message that carries its recall keep both: the next turn sends the message as its retry did", async () => {
  const h = { ...CC_UA, "x-session-id": "defer-recall" };
  const cwd = "C:\\cachefix-defer";
  const first = await svc.prepare(svc.situate(req(["tell me about the billing setup"], { headers: h, cwd })), { requestId: "dr1" });
  // A fact learned after the briefing froze reaches the model through the next message's recall.
  await svc.store.remember({ content: "Billing lives in us-east-1 and deploys from the main branch only.", source: "fact", importance: 0.9, metadata: { kind: "fact" } });
  const asked = ["tell me about the billing setup", "where does billing deploy from?"];
  const r2 = req(asked, { headers: h, cwd });
  await svc.prepare(svc.situate(r2), { requestId: "dr2" });
  assert.ok(r2.body.messages[2].content.includes(`<${MEMORY_TAG} kind="turn">`), "the message carries its recall");
  // The model called memory; its follow-up failed, and what the calls returned waits for the session's next request.
  svc.brain.setDeferred(first.chain, "billing: deploys from main (2026-10-01)");
  // The client asks again, the message as it holds it: without Filament's blocks.
  const retry = req(asked, { headers: h, cwd });
  await svc.prepare(svc.situate(retry), { requestId: "dr3" });
  const sent = retry.body.messages[2].content;
  assert.ok(sent.includes(`<${MEMORY_TAG} kind="turn">`) && sent.includes(`<${MEMORY_TAG} kind="tool">`), `the retry carries its recall and the results: ${sent}`);
  // The next turn: the message is history now, and goes out as the retry sent it.
  const next = req([...asked, "and who owns it?"], { headers: h, cwd });
  await svc.prepare(svc.situate(next), { requestId: "dr4" });
  assert.equal(next.body.messages[2].content, sent, "the message's bytes are the retry's: its recall kept, the results after it");
});

// (fails before: yes — the results sat in the message's own place, so the retry took them for its recall and looked
// nothing up: the message went out with the results alone)
test("a recall looked up on a retry goes before the results the message carries, where every later request puts it", async () => {
  const h = { ...CC_UA, "x-session-id": "defer-recall-late" };
  const cwd = "C:\\cachefix-defer-late";
  const first = await svc.prepare(svc.situate(req(["tell me about the ledger setup"], { headers: h, cwd })), { requestId: "dl1" });
  const asked = ["tell me about the ledger setup", "where does the ledger replicate to?"];
  // Nothing to recall for the message yet; the model called memory, and its follow-up failed.
  await svc.prepare(svc.situate(req(asked, { headers: h, cwd })), { requestId: "dl2" });
  svc.brain.setDeferred(first.chain, "ledger: replicates to the archive bucket (2026-10-02)");
  await svc.store.remember({ content: "The ledger replicates to the archive bucket every night.", source: "fact", importance: 0.9, metadata: { kind: "fact" } });
  const retry = req(asked, { headers: h, cwd });
  await svc.prepare(svc.situate(retry), { requestId: "dl3" });
  const sent = retry.body.messages[2].content;
  const recall = sent.indexOf(`<${MEMORY_TAG} kind="turn">`);
  assert.ok(recall >= 0 && recall < sent.indexOf(`<${MEMORY_TAG} kind="tool">`), `the retry looks the message's recall up, before the results: ${sent}`);
  const next = req([...asked, "and how long is it kept?"], { headers: h, cwd });
  await svc.prepare(svc.situate(next), { requestId: "dl4" });
  assert.equal(next.body.messages[2].content, sent, "the next turn sends the message as the retry did");
});

// (fails before: yes — the review of 14b90e384: the second deferral took the first's place in the message's one slot for
// results: the retry sent the leg with both, the next turn with the second alone — its bytes changed under the provider's
// cache, the first results gone for good)
test("a second deferral onto one message keeps the first: the next turn sends the message as its retry did", async () => {
  const h = { ...CC_UA, "x-session-id": "defer-twice" };
  const cwd = "C:\\cachefix-defer-twice";
  const ask = "please search memory for the deploy window";
  const first = await svc.prepare(svc.situate(req([ask], { headers: h, cwd })), { requestId: "dt1" });
  /** N's messages as the client holds them: the person's, the model's call of a client tool, and its result (the leg L). */
  const leg = () => ({ format: "anthropic", body: { model: "claude-x", max_tokens: 100, system: sys(cwd), messages: [{ role: "user", content: ask }, { role: "assistant", content: [{ type: "tool_use", id: "c7", name: "Read", input: { file_path: "deploy.md" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "c7", content: "the deploy notes" }] }] }, headers: h, model: "claude-x" });
  // N-1's reply mixed a memory call with the client's: what memory's call returned rides N, on L.
  svc.brain.setDeferred(first.chain, "deploy window: Tuesdays 10:00 UTC (2026-10-05)");
  await svc.prepare(svc.situate(leg()), { requestId: "dt2" });
  // At N the model called memory again, and its follow-up failed: what that call returned waits too.
  svc.brain.setDeferred(first.chain, "freeze: no deploys during the quarter close (2026-10-06)");
  // The client asks N again, its messages as it holds them.
  const retry = leg();
  await svc.prepare(svc.situate(retry), { requestId: "dt3" });
  const sent = retry.body.messages[2].content;
  const results = sent.filter((/** @type {any} */ b) => b.type === "text" && b.text.includes(`<${MEMORY_TAG} kind="tool">`));
  assert.deepEqual(results.map((/** @type {any} */ b) => /deploy window|freeze/.exec(b.text)?.[0]), ["deploy window", "freeze"], `the retry carries both, in the order they came: ${JSON.stringify(sent)}`);
  // The next turn: L is history, and goes out as the retry sent it.
  const next = leg();
  next.body.messages.push({ role: "assistant", content: "noted" }, { role: "user", content: "and when is the next deploy?" });
  await svc.prepare(svc.situate(next), { requestId: "dt4" });
  assert.deepEqual(next.body.messages[2].content, sent, "the leg's bytes are the retry's: both deferrals, in the order they went");
});

// (fails before: yes — lead 5 of the 11-02 privacy round: the chat left out had its blocks re-attached from a copy holding
// its recall results alone, and the walk of a slot stopped at its first placement, the results kept there before: the next
// turn sent the leg bare, its bytes changed and the recall's answer gone)
test("in a chat Memory settings come to leave out, a recall result placed after the results a message carried rides on: the next turn sends it as its retry did", async () => {
  const h = { ...CC_UA, "x-session-id": "left-out-slot" };
  const cwd = "C:\\cachefix-left-out-slot";
  const ask = "please look up the release window";
  /** A request of the chat, kept as a chat Filament composes keeps its turns, whatever Memory settings say. @param {any[]} messages */
  const of = (messages) => ({ format: "anthropic", body: { model: "claude-left", max_tokens: 100, system: sys(cwd), messages }, headers: h, model: "claude-left", keep: true });
  /** N's messages: the person's, the model's call of a tool, and its result (the leg L). */
  const legOf = () => [{ role: "user", content: ask }, { role: "assistant", content: [{ type: "tool_use", id: "c9", name: "Read", input: { file_path: "release.md" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "c9", content: "the release notes" }] }];
  const first = await svc.prepare(svc.situate(of([{ role: "user", content: ask }])), { requestId: "lo1" });
  // N-1's reply mixed a memory call with its tools: what memory's call returned rides N, on L.
  svc.brain.setDeferred(first.chain, "release window: Wednesdays 09:00 UTC (2026-10-07)");
  await svc.prepare(svc.situate(of(legOf())), { requestId: "lo2" });
  const was = cfg.memory.capture;
  cfg.memory.capture = { ...was, excludeModels: ["claude-left"] };
  try {
    // Memory settings leave the chat out now; N failed after a filament_recall call, whose result waits, and N is asked again.
    svc.brain.setDeferred(first.chain, "turn 1: the release notes say Wednesdays");
    const retry = of(legOf());
    const sit = svc.situate(retry);
    assert.equal(sit?.leftOut, 'model "claude-left" is excluded in Memory settings');
    await svc.prepare(sit, { requestId: "lo3" });
    const sent = retry.body.messages[2].content;
    const kinds = sent.filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => /kind="(\w+)"/.exec(b.text)?.[1]);
    assert.deepEqual(kinds, ["recall"], `the retry carries the recall's answer, and none of what memory placed before: ${JSON.stringify(sent)}`);
    const next = of([...legOf(), { role: "assistant", content: "noted" }, { role: "user", content: "and the freeze?" }]);
    await svc.prepare(svc.situate(next), { requestId: "lo4" });
    assert.deepEqual(next.body.messages[2].content, sent, "the leg's bytes are the retry's: the recall's answer rides on");
  } finally {
    cfg.memory.capture = was;
  }
});

test("P1.1: a rules-that-act reminder on a tool leg is re-attached on resend", async () => {
  const r = req(["please restart Filament now"], { cwd: "C:\\cachefix-rules" });
  const prep = await svc.prepare(svc.situate(r), { requestId: "ra1" });
  const it = svc.archive.items.add({ projectId: "cachefix-rules", chainId: prep.chain, turnId: prep.turn, kind: "rule", text: "Never restart Filament while a chat may be flowing; check /api/live first.", status: "confirmed", importance: 0.9 });
  cfg.memory.rules = { act: [`i${it.id}`] };
  const leg = { format: "anthropic", body: { model: "claude-x", system: sys("C:\\cachefix-rules"), messages: [{ role: "user", content: "please restart Filament now" }, { role: "assistant", content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "node bin/filament.js restart" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "b1", content: "done" }] }] }, headers: CC_UA, model: "claude-x" };
  const prep2 = await svc.prepare(svc.situate(leg), { requestId: "ra2" });
  assert.equal(prep2.rules, 1, prep2.notes.join(" | "));
  const legAfter = leg.body.messages.at(-1).content;
  // Resent clean: same rule block must come back on the leg.
  const resent = { format: "anthropic", body: { model: "claude-x", system: sys("C:\\cachefix-rules"), messages: [{ role: "user", content: "please restart Filament now" }, { role: "assistant", content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "node bin/filament.js restart" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "b1", content: "done" }] }] }, headers: CC_UA, model: "claude-x" };
  await svc.prepare(svc.situate(resent), { requestId: "ra3" });
  assert.deepEqual(resent.body.messages.at(-1).content, legAfter, "the rule reminder re-attaches byte-identically on the resent leg");
  delete cfg.memory.rules;
});

test("P1.4: an OpenAI tool leg never attaches a NEW block to a mid-history user message", async () => {
  const oai = (messages, headers = CC_UA) => ({ format: "openai", body: { model: "gpt-x", max_tokens: 100, messages }, headers, model: "gpt-x" });
  const sysM = { role: "system", content: sys("C:\\cachefix-oai") };
  const userM = { role: "user", content: "refactor the warp drive calibration module for me" };
  // First contact: nothing in memory matches, so the message goes out clean (no block stored).
  const p1 = await svc.prepare(svc.situate(oai([sysM, userM])), { requestId: "o1" });
  assert.equal(p1.injected, 0, "nothing attached on the first pass");
  // Now a matching fact lands (another session learned it). On the tool leg, a fresh lookup WOULD find it —
  // but the message is mid-history now, so attaching would change bytes the provider already cached.
  await svc.store.remember({ content: "The warp drive calibration module lives in src/warp/calibration.js.", source: "fact", importance: 0.9, metadata: { kind: "fact" } });
  const leg = oai([sysM, { role: "user", content: "refactor the warp drive calibration module for me" }, { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "Read", arguments: "{}" } }] }, { role: "tool", tool_call_id: "t1", content: "module source" }]);
  const prep2 = await svc.prepare(svc.situate(leg), { requestId: "o2" });
  assert.equal(prep2.injected, 0, "no new injection on a tool leg");
  assert.equal(leg.body.messages[1].content, "refactor the warp drive calibration module for me", "the mid-history user message is untouched");
  assert.equal(leg.body.messages[1].content.includes(MEMORY_TAG), false);
});

test("P1.3: muted chains and a degraded engine keep the memory tools attached", async () => {
  const r = req(["what is the tray loop about"], { headers: { ...CC_UA, "x-session-id": "sticky-1" } });
  const s1 = svc.situate(r); const p1 = await svc.prepare(s1, { requestId: "s1" });
  assert.equal(p1.tools, true);
  const off = await memoryCommand(svc, "@mem off", s1); assert.ok(/off/.test(off.text));
  const p2 = await svc.prepare(svc.situate(req(["what is the tray loop about", "and why does it restart twice"], { headers: { ...CC_UA, "x-session-id": "sticky-1" } })), { requestId: "s2" });
  assert.equal(p2.muted, true);
  assert.equal(p2.tools, true, "mute stops injection, not the tools section (was dropped before the fix)");
  // Engine away: storeReady() is false, tools must stay — a health event must not rewrite the prompt.
  const realStore = svc.brain.store; svc.brain.store = null;
  try {
    const p3 = await svc.prepare(svc.situate(req(["a fresh chat about kilts"], { headers: { ...CC_UA, "x-session-id": "sticky-2" } })), { requestId: "s3" });
    assert.equal(svc.brain.storeReady(), false);
    assert.equal(p3.tools, true, "engine degraded: tools stay attached (calls error to the model, bytes stay stable)");
  } finally { svc.brain.store = realStore; }
});

// (fails before: yes — the 10-31 cache check: a client's compaction request went without memory's tools, so the request
// that carries the whole conversation changed its tools section and its provider read all of it uncached)
test("a client's compaction request keeps the memory tools its session's requests carry", async () => {
  const h = { ...CC_UA, "x-session-id": "sticky-compact" };
  const p1 = await svc.prepare(svc.situate(req(["the build fails on the tray icon"], { headers: h })), { requestId: "c1" });
  assert.equal(p1.tools, true);
  const ask = "Your task is to create a detailed summary of the conversation so far.";
  const p2 = await svc.prepare(svc.situate(req(["the build fails on the tray icon", ask], { headers: h })), { requestId: "c2" });
  assert.equal(p2.position, "compaction");
  assert.equal(p2.tools, true, "the tools section stays as the session's requests sent it");
  // (fails before: yes — the first fix offered them by `memory.tools` alone: with memory's autopilot off a session's
  // requests carry none, and its compaction request gained them)
  const was = cfg.memory.autopilot.enabled;
  cfg.memory.autopilot.enabled = false;
  try {
    const off = { ...CC_UA, "x-session-id": "sticky-compact-off" };
    const q1 = await svc.prepare(svc.situate(req(["the tray icon is blurry"], { headers: off })), { requestId: "c3" });
    const q2 = await svc.prepare(svc.situate(req(["the tray icon is blurry", ask], { headers: off })), { requestId: "c4" });
    assert.deepEqual([q2.position, q1.tools, q2.tools], ["compaction", false, false], "none on either");
  } finally {
    cfg.memory.autopilot.enabled = was;
  }
});

test("P1.2: x-filament-memory: off is a quiet request — stable history, no capture, no new injection", async () => {
  const h = { ...CC_UA, "x-session-id": "quiet-1" };
  const r1 = req(["the deploy checklist lives in the wiki"], { headers: h });
  const p1 = await svc.prepare(svc.situate(r1), { requestId: "q1" });
  const sysAfter1 = r1.body.system;
  const r2 = req(["the deploy checklist lives in the wiki", "and the rollback plan is in the same page"], { headers: h });
  const p2 = await svc.prepare(svc.situate(r2), { requestId: "q2" });
  const turnsBefore = svc.archive.getChain(p2.chain).turns;
  // The quiet request: same header set plus the off flag, history clean as the client holds it.
  const r3 = req(["the deploy checklist lives in the wiki", "and the rollback plan is in the same page", "what should I check before deploying?"], { headers: { ...h, "x-filament-memory": "off" } });
  const p3 = await svc.prepare(svc.situate(r3), { requestId: "q3" });
  assert.equal(p3.quiet, true);
  assert.equal(p3.newTurn, false, "a quiet request records nothing");
  assert.equal(p3.injected, 0, "and adds nothing new");
  assert.equal(p3.tools, true, "but keeps the tools section stable");
  assert.equal(r3.body.system, r2.body.system, "system prompt byte-identical across the quiet request (briefing kept)");
  assert.equal(r3.body.messages[0].content, r2.body.messages[0].content, "earlier messages byte-identical too");
  assert.equal(svc.archive.getChain(p2.chain).turns, turnsBefore, "no turn was archived for the quiet request");
  // The request after (header gone) is still on the same chain, fully stable.
  const r4 = req(["the deploy checklist lives in the wiki", "and the rollback plan is in the same page", "what should I check before deploying?", "ok, deploy to staging first"], { headers: h });
  const p4 = await svc.prepare(svc.situate(r4), { requestId: "q4" });
  assert.equal(p4.chain, p2.chain, "same chain after the quiet gap");
  assert.equal(r4.body.system, r2.body.system);
  assert.equal(r4.body.messages[0].content, r2.body.messages[0].content);
});

test("P2: a rotated session id keeps the injected history via sibling block adoption", async () => {
  const h1 = { ...CC_UA, "x-session-id": "rotate-1" };
  const r1 = req(["tell me about the staging setup"], { headers: h1, cwd: "C:\\cachefix-rot" });
  const p1 = await svc.prepare(svc.situate(r1), { requestId: "rot1" });
  // A fact learned after the briefing froze reaches the model through a per-turn block on the next message.
  await svc.store.remember({ content: "Staging lives in eu-west-2 and deploys from the release branch only.", source: "fact", importance: 0.9, metadata: { kind: "fact" } });
  const r2 = req(["tell me about the staging setup", "where does staging deploy from?"], { headers: h1, cwd: "C:\\cachefix-rot" });
  const p2 = await svc.prepare(svc.situate(r2), { requestId: "rot2" });
  const blocked = r2.body.messages.at(-1).content;
  assert.ok(blocked.includes(MEMORY_TAG), "a per-turn block rode the second turn");
  // The client restarts and rotates its session id, resending the same conversation plus a new message.
  const h2 = { ...CC_UA, "x-session-id": "rotate-2" };
  const r3 = req(["tell me about the staging setup", "where does staging deploy from?", "and which branch was it again?"], { headers: h2, cwd: "C:\\cachefix-rot" });
  r3.body.messages[2].content = strip(r3.body.messages[2].content); // the client never saw Filament's block
  const p3 = await svc.prepare(svc.situate(r3), { requestId: "rot3" });
  assert.notEqual(p3.chain, p1.chain, "a new chain for the new session id");
  assert.equal(r3.body.messages[2].content, blocked, "the rotated chain re-attaches the sibling's block byte-for-byte (was bare before the fix)");
});

// (fails before: yes — the review of 1cb2824c9: the newest chat of the project with blocks lent them, a harness chat
// among them — a fork made in the harness, with the blocks of its cut, is the newest — and the client's own history
// went out without the blocks it carried)
test("P2: a client's rotated session borrows from the client's own chat, never from a harness chat", async () => {
  const cwd = "C:\\cachefix-native";
  const h1 = { ...CC_UA, "x-session-id": "rotate-4" };
  const r1 = req(["tell me about the canary setup"], { headers: h1, cwd });
  const p1 = await svc.prepare(svc.situate(r1), { requestId: "nat1" });
  await svc.store.remember({ content: "The canary runs in us-east-1 and promotes after one clean hour.", source: "fact", importance: 0.9, metadata: { kind: "fact" } });
  const r2 = req(["tell me about the canary setup", "when does the canary promote?"], { headers: h1, cwd });
  await svc.prepare(svc.situate(r2), { requestId: "nat2" });
  const blocked = r2.body.messages.at(-1).content;
  assert.ok(blocked.includes(MEMORY_TAG), "a per-turn block rode the second turn");
  // A harness chat of the same project, newer, with a block of its own. The archive stamps in whole milliseconds and the
  // chats below are made within one or two of them: stamped alike, `recentHeads` has nothing to put the newer first by.
  // A clock that never reads the same twice makes the later chat later.
  const a = svc.archive;
  const clock = a.now;
  let last = clock();
  a.now = () => (last = Math.max(last + 1, clock()));
  const native = a.chainForKey("n:native-chat", { project: a.getChain(p1.chain).project_id, client: "harness", model: "claude-x" });
  const asked = { role: "user", content: "a harness question" };
  const { turnId } = a.beginTurn(native.id, { requestId: "nat-h", model: "claude-x", upstream: "u", userMessage: asked });
  a.finishTurn(turnId, { finalMessage: { role: "assistant", content: "a harness answer" }, requestId: "nat-hc" });
  a.setBlock(native.id, messageHash(asked), "the harness chat's own block", 1, "turn");
  // Newer still: an import the person went on with in the harness, its own chat under its import's key (fails before:
  // yes — the review of 90688845b: the skip read the `n:` key alone).
  const imported = a.chainForKey("cc:imported-chat", { project: a.getChain(p1.chain).project_id, client: "claude-code", model: "claude-x", meta: { native: true } });
  const went = { role: "user", content: "an imported question" };
  const t2 = a.beginTurn(imported.id, { requestId: "nat-i", model: "claude-x", upstream: "u", userMessage: went });
  a.finishTurn(t2.turnId, { finalMessage: { role: "assistant", content: "an imported answer" }, requestId: "nat-ic" });
  a.setBlock(imported.id, messageHash(went), "the imported chat's own block", 1, "turn");
  a.now = clock;
  assert.equal(a.recentHeads(1)[0].id, imported.id, "the import is the project's newest");
  // The client restarts and rotates its session id, resending the same conversation plus a new message.
  const r3 = req(["tell me about the canary setup", "when does the canary promote?", "and where does it run?"], { headers: { ...CC_UA, "x-session-id": "rotate-5" }, cwd });
  r3.body.messages[2].content = strip(r3.body.messages[2].content);
  const p3 = await svc.prepare(svc.situate(r3), { requestId: "nat3" });
  assert.notEqual(p3.chain, p1.chain, "a new chain for the new session id");
  assert.equal(r3.body.messages[2].content, blocked, "the client's own chat lends its block, byte for byte");
});

test("P2: @mem new is a real fresh start — closed chains never lend their blocks", async () => {
  const h = { ...CC_UA, "x-session-id": "rotate-3" };
  const r1 = req(["tell me about the release process"], { headers: h, cwd: "C:\\cachefix-rot" });
  const s1 = svc.situate(r1); const p1 = await svc.prepare(s1, { requestId: "rn1" });
  // A fact learned after the briefing froze reaches the model through a per-turn block on the next message.
  await svc.store.remember({ content: "The release branch is cut on Mondays by the duty engineer.", source: "fact", importance: 0.9, metadata: { kind: "fact" } });
  const r2 = req(["tell me about the release process", "who cuts the release branch?"], { headers: h, cwd: "C:\\cachefix-rot" });
  const p2 = await svc.prepare(svc.situate(r2), { requestId: "rn2" });
  const blockedMsg = r2.body.messages.at(-1).content;
  assert.ok(blockedMsg.includes(MEMORY_TAG), "second turn carries a block: " + String(blockedMsg).slice(0, 120));
  await memoryCommand(svc, "@mem new", s1);
  const r3 = req(["tell me about the release process", "who cuts the release branch?", "start over please"], { headers: h, cwd: "C:\\cachefix-rot" });
  r3.body.messages[2].content = strip(r3.body.messages[2].content); // the client holds history without Filament's blocks
  const p3 = await svc.prepare(svc.situate(r3), { requestId: "rn3" });
  assert.notEqual(p3.chain, p1.chain, "a fresh chain after @mem new");
  assert.equal(r3.body.messages[2].content.includes(MEMORY_TAG), false, "no resurrection after @mem new");
});

test("P2: translation of malformed tool calls is deterministic across retries", () => {
  const malformed = { model: "gpt-x", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: null, tool_calls: [{ type: "function", function: { name: "Read", arguments: "{\"a\":1}" } }] }, { role: "tool", content: "bytes" }] };
  const a = openaiToAnthropicRequest(structuredClone(malformed));
  const b = openaiToAnthropicRequest(structuredClone(malformed));
  assert.deepEqual(a.body.messages, b.body.messages, "same malformed input, same ids on every retry");
  assert.match(JSON.stringify(a.body.messages), /"id":"call_[a-z0-9]+"/);
  // Response-side translation: the envelope id/created are client-facing metadata (Date.now is fine there —
  // they never re-enter a provider request). What must be deterministic is the tool_use id inside the content.
  const anthResp = { model: "claude-x", content: [{ type: "tool_use", name: "Read", input: { a: 1 } }], usage: { input_tokens: 1, output_tokens: 1 } };
  const t1 = anthropicToOpenaiResponse(structuredClone(anthResp)).choices[0].message.tool_calls;
  const t2 = anthropicToOpenaiResponse(structuredClone(anthResp)).choices[0].message.tool_calls;
  assert.deepEqual(t1, t2, "the translated tool_use id is stable across calls");
});
