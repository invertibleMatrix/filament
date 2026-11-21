import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryService } from "../src/memory-service.js";
import { MemoryEngine } from "../src/memory-engine.js";
import { MEMORY_TAG, allUserTexts, applyUserBlock, memoryBlock } from "../src/memory-brain.js";
import { attachMemoryTools, memoryToolDefs, executeMemoryTool } from "../src/memory-tools.js";
import { memoryCommand } from "../src/app/commands/mem.js";
import { deferMemoryResults, memoryToolCtx } from "../src/app/memory-tools.js";
import { responsesToChat } from "../src/core/wire/responses.js";
import { turnsRead } from "./helpers/held-transcript.js";
import { defaultsOf, RULES } from "../src/core/schema.js";
import { memoryThreads } from "../src/app/agent/graph-runner.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-sidecar.mjs", import.meta.url));
let dir, svc, cfg;
const CC_UA = { "user-agent": "claude-cli/2.1.258 (external, cli)" };
const sys = (cwd = "C:\\filament") => `You are Claude Code.\n<env>\nWorking directory: ${cwd}\nIs a git repo: yes\n</env>`;
const req = (userTexts, { cwd, headers = CC_UA, assistant = "ok" } = {}) => {
  const messages = []; userTexts.forEach((t, i) => { messages.push({ role: "user", content: t }); if (i < userTexts.length - 1) messages.push({ role: "assistant", content: `${assistant} ${i}` }); });
  return { format: "anthropic", body: { model: "claude-x", max_tokens: 100, system: sys(cwd), messages }, headers, model: "claude-x" };
};

before(() => {
  dir = mkdtempSync(join(tmpdir(), "filament-memsvc-"));
  cfg = { server: { port: 20399, inboundKeys: ["k"] }, memory: { enabled: true, folder: join(dir, "memory"), engine: { embeddings: true, bank: "default" }, autopilot: { enabled: true, mode: "conservative", briefingTokens: 1200, turnTokens: 300, minScore: 0.2, tools: true, cue: true }, capture: { turns: true, learn: true }, commands: { enabled: true, prefix: "@mem" }, privacy: { encryptArchive: true }, models: { summarizer: "claude-haiku-4-5" } } };
  svc = new MemoryService({ getConfig: () => cfg, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20399" });
  svc.start();
  // no managed engine on disk: swap in the fake sidecar as the store
  svc.store = new MemoryEngine({ command: process.execPath, args: [FAKE], env: { FAKE_SIDECAR_STATE: join(dir, "fake-state.json"), FAKE_SIDECAR_LOG: join(dir, "sidecar-ops.jsonl") }, writeConfig: false });
  svc.brain.store = svc.store;
});
after(async () => { await svc.store?.stop?.(); svc.stop(); for (let i = 0; i < 10; i++) { try { rmSync(dir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 200)); } } });

test("service: folder, manifest, archive and summarizer resolution", () => {
  assert.ok(existsSync(join(dir, "memory", "archive.db"))); const man = JSON.parse(readFileSync(join(dir, "memory", "memory.json"), "utf8")); assert.equal(man.encrypted, true); assert.ok(man.deviceId);
  assert.equal(svc.summarizerModel(), "claude-haiku-4-5", "the model set for memory");
});

test("service: memory's model not set, and nothing a provider serves — the model paths simply don't run", async () => {
  const real = svc.getConfig;
  const without = () => ({ ...cfg, memory: { ...cfg.memory, models: { summarizer: "auto" } } });
  svc.getConfig = without;
  try {
    assert.equal(svc.summarizerModel(), "", "auto (or unset) is no model set");
    assert.deepEqual(svc.modelFor({}), { model: "", from: "none" }, "no route serves a model here: none, never a guess");
    await assert.rejects(() => svc.callModel({ system: "s", user: "u", purpose: "memory" }), /no model to call: set one in Settings › Memory › Model/);
    await assert.rejects(() => svc.callModel({ system: "s", user: "u", purpose: "recall" }), /no model to call/);
    const gone = () => ({ ...cfg, memory: { ...cfg.memory, models: {} } });
    svc.getConfig = gone;
    assert.equal(svc.summarizerModel(), "", "unset is the same rule");
  } finally {
    svc.getConfig = real;
  }
});

// (fails before: yes — the review of b7fbcdb6a: nothing could say why memory left a request out, so the words blamed
// Memory settings wherever it did — a situate that failed on a conversation it could not read among them)
test("excludedWhy: the Memory setting that leaves a request out, read as situate reads it; a request situate could not read names none, and fails nothing", () => {
  const real = svc.getConfig;
  /** Memory's capture lists as given. @param {any} lists */
  const capture = (lists) => (svc.getConfig = () => ({ ...cfg, memory: { ...cfg.memory, capture: { ...cfg.memory.capture, ...lists } } }));
  try {
    const r = req(["hello there"]);
    capture({ excludeModels: ["claude-x"] });
    assert.equal(svc.situate(r), null, "memory leaves it out");
    assert.equal(svc.excludedWhy(r), 'model "claude-x" is excluded in Memory settings');
    capture({ excludeFolders: ["C:\\filament"] });
    assert.equal(svc.excludedWhy(r), "the working folder is excluded in Memory settings", "the folder from the system prompt, as situate reads it");
    capture({});
    assert.equal(svc.excludedWhy(r), null, "nothing excludes it");
    // A conversation that cannot be read: situate fails and leaves the request out; why names no setting.
    const unreadable = { ...r, body: { ...r.body, get messages() { throw new Error("unreadable"); } } };
    assert.equal(svc.situate(unreadable), null);
    capture({ excludeFolders: ["C:\\elsewhere"] });
    assert.equal(svc.excludedWhy(unreadable), null, "the folder could not be read: no setting is named, and nothing throws");
  } finally {
    svc.getConfig = real;
  }
});

// (fails before: yes — the owner's decision of 11-01, exclusion follows the chat: a call Filament makes for a chat was
// judged on its own model alone, never on the model the chat's turns name — a harness chat's with its effort on it,
// which the chain's model column does not carry)
test("chatModelOf and chatLeftOut: a harness chat's model as its turns send it, its effort on its name, leaves out the calls made for it; an outside client's chat by the model its own requests named", () => {
  const real = svc.getConfig;
  /** Memory's capture lists as given, with the rules' effort suffixes. @param {any} lists */
  const capture = (lists) => (svc.getConfig = () => ({ ...cfg, rules: { ...defaultsOf(RULES) }, memory: { ...cfg.memory, capture: { ...cfg.memory.capture, ...lists } } }));
  try {
    capture({});
    const chat = svc.archive.chainForKey("n:effort-chat", { cwd: "C:\\filament", client: "harness", model: "brain-model", meta: { native: true } });
    svc.archive.setChainSettings(chat.id, { model: { name: "brain-model", effort: "high" } });
    const client = svc.chainFor(svc.situate(req(["an outside client's chat"])));
    /** A sub-agent's call for a chat, on another model. @param {string} chainId */
    const call = (chainId) => ({ format: "anthropic", body: { model: "agent/gpt-6", max_tokens: 100, messages: [{ role: "user", content: "the task" }] }, headers: { "user-agent": "node", "x-filament-chain": chainId, "x-filament-memory": "tools" }, model: "agent/gpt-6", cwdHint: "C:\\filament" });
    capture({ excludeModels: ["brain-model-high"] });
    assert.equal(svc.situate(call(chat.id)), null, "the chat's model as its turns send it");
    assert.equal(svc.excludedWhy(call(chat.id)), 'model "brain-model-high" is excluded in Memory settings');
    assert.ok(svc.situate(call(client.id)), "another chat's call is situated");
    capture({ excludeModels: ["claude-x"] });
    assert.equal(svc.excludedWhy(call(client.id)), 'model "claude-x" is excluded in Memory settings', "the outside client's chat, by the model its requests named");
    assert.equal(svc.excludedWhy(call(chat.id)), null);
    assert.deepEqual([svc.chatModelOf(chat.id), svc.chatModelOf(client.id), svc.chatModelOf("no-such-chat")], ["brain-model-high", "claude-x", ""]);
    assert.deepEqual([svc.chatLeftOut(client.id), svc.chatLeftOut(chat.id)], ['model "claude-x" is excluded in Memory settings', null]);
  } finally {
    svc.getConfig = real;
  }
});

// (fails before: yes — lead 2 of the 11-02 privacy round: a chat whose leaving-out could not be read was told null, left
// in, by chatLeftOut — while keptToItself and subagentLeftOut kept it out — so a request naming it was left in too, and
// its graph looked memory's thread up as in a chat memory works in: [null, null, "no memory i1"])
test("chatLeftOut fails closed: a chat whose leaving-out cannot be read is left out, said so, as keptToItself and subagentLeftOut keep it", () => {
  const real = svc.getConfig;
  const metaOf = svc.archive.metaOf;
  const chat = svc.archive.chainForKey("n:unreadable-chat", { cwd: "C:\\filament", client: "harness", model: "brain-model", meta: { native: true } });
  try {
    svc.getConfig = () => ({ ...cfg, memory: { ...cfg.memory, capture: { ...cfg.memory.capture, excludeFolders: ["C:\\elsewhere"] } } });
    assert.equal(svc.chatLeftOut(chat.id), null, "read, the chat is not left out");
    // The chat's folder cannot be read: the archive is locked under it.
    svc.archive.metaOf = (/** @type {string} */ id, /** @type {any} */ keys) => {
      if (String(id) === chat.id) throw new Error("database is locked");
      return metaOf.call(svc.archive, id, keys);
    };
    const UNREAD = "Memory settings could not be read";
    const call = { format: "anthropic", body: { model: "agent/gpt-6", max_tokens: 100, messages: [{ role: "user", content: "the task" }] }, headers: { "user-agent": "node", "x-filament-chain": chat.id, "x-filament-memory": "tools" }, model: "agent/gpt-6", cwdHint: "C:\\filament" };
    const thread = memoryThreads(svc).of(chat.id, "i1");
    assert.deepEqual(
      [svc.chatLeftOut(chat.id), svc.excludedWhy(call), "error" in thread ? thread.error : thread],
      [UNREAD, UNREAD, `Memory leaves this chat out (${UNREAD}), so no thread of memory's goes on its graph`],
    );
    assert.deepEqual([svc.keptToItself(chat.id), svc.subagentLeftOut(chat.id, "")], [true, UNREAD], "as the others keep it");
  } finally {
    svc.archive.metaOf = metaOf;
    svc.getConfig = real;
  }
});

test("autopilot: first turn gets a briefing with tools, the message gets a block, a correction files nothing by its words, replay re-attaches", async () => {
  await svc.store.remember({ content: "The tray script tray/filament-tray.ps1 restarted Filament twice because the watchdog and the tray both relaunch it.", source: "fact", importance: 0.8, metadata: { kind: "fact" } });
  await svc.identitySet({ name: "name", body: "The user's name is Alice." });
  const r1 = req(["the tray keeps restarting Filament twice again, like last time"]);
  const sit = svc.situate(r1); assert.ok(sit); assert.equal(sit.project.name, "filament"); assert.equal(sit.client, "claude-code"); assert.equal(sit.position, "first"); assert.equal(sit.keySource, "fingerprint");
  const prep = await svc.prepare(sit, { requestId: "r1", upstream: "anthropic" });
  assert.ok(prep.chain); assert.equal(prep.newTurn, true); assert.equal(prep.turnN, 1);
  assert.ok(r1.body.system.includes(`<${MEMORY_TAG} kind="briefing">`), "briefing in the system prompt"); assert.match(r1.body.system, /What holds in every project \(the user's own word\):\n- \[i\d+ fact · user said[^\]]*\] The user's name is Alice\./); assert.ok(r1.body.system.includes("Memory tools (filament_memory_*)"));
  assert.ok(prep.briefing >= 1 && r1.body.system.includes("watchdog"), "the tray fact went into the briefing (deep recall on the first message)"); assert.equal(prep.injected, 0, "nothing repeated on the message itself");
  assert.equal(prep.tools, true); assert.equal(attachMemoryTools("anthropic", r1.body), 9);
  assert.deepEqual(prep.signals, {}, "\"again, like last time\" says nothing about how much is looked up");
  // the model replies; the turn is finished and use is tracked
  svc.afterReply({ chainId: prep.chain, turnId: prep.turn, requestId: "r1", finalMessage: { role: "assistant", content: [{ type: "text", text: "Yes: the watchdog and the tray both relaunch it. Removing one fixes the double restart." }] }, replyText: "the watchdog and the tray both relaunch it", injectedIds: prep.ids, outputChars: 90 });
  const rec = svc.archive.injections.recent(5); assert.ok(rec.some((x) => x.request_id === "r1" && x.used === true), "the injected fact counted as used");
  // second turn with a correction, in the same chain (client resends history without our blocks)
  const r2 = req(["the tray keeps restarting Filament twice again, like last time", "no, don't edit the ps1 with a heredoc, it mangles backslashes; use the Write tool"]);
  const sit2 = svc.situate(r2); assert.equal(sit2.key, sit.key, "same fingerprint, same chain"); assert.equal(sit2.position, "mid");
  const prep2 = await svc.prepare(sit2, { requestId: "r2" });
  assert.equal(prep2.turnN, 2); assert.equal("correction" in prep2.signals, false, "nothing read from its words");
  assert.ok(r2.body.system.includes("The user's name is Alice.") && r2.body.system.includes("watchdog"), "the same briefing again, byte for byte");
  assert.equal(r2.body.system, r1.body.system.replace(/\n\n<filament-memory kind="turn">[\s\S]*$/, ""), "stable system prompt across turns");
  // Nothing is filed from the message by its words (the memory plan's d3): the agent keeps it with its tools, quoting it.
  assert.ok(!prep2.notes.some((n) => /captured/.test(n)), prep2.notes.join(" | "));
  assert.deepEqual(svc.archive.items.list({ kind: "rule" }), []);
  // a fact stored after the briefing was frozen reaches the model through a per-turn block, re-attached on replay
  await svc.store.remember({ content: "Heredocs in Git Bash mangle backslashes in patch scripts; use the Write tool for files.", source: "fact", importance: 0.8, metadata: { kind: "fact" } });
  const r3 = req(["the tray keeps restarting Filament twice again, like last time", "no, don't edit the ps1 with a heredoc, it mangles backslashes; use the Write tool", "why do heredocs mangle backslashes in patch scripts?"]);
  const prep3 = await svc.prepare(svc.situate(r3), { requestId: "r3b" });
  assert.ok(prep3.injected >= 1, prep3.notes.join(" | ")); assert.ok(r3.body.messages[4].content.includes(`<${MEMORY_TAG} kind="turn">`) && r3.body.messages[4].content.includes("Write tool"));
  const r4 = req(["the tray keeps restarting Filament twice again, like last time", "no, don't edit the ps1 with a heredoc, it mangles backslashes; use the Write tool", "why do heredocs mangle backslashes in patch scripts?", "ok thanks, next: the tray log grows forever"]);
  await svc.prepare(svc.situate(r4), { requestId: "r4b" });
  assert.equal(r4.body.messages[4].content, r3.body.messages[4].content, "turn 3's block re-attached byte for byte on replay");
  // a tool-result leg: no new turn, no new block, history re-attached
  const leg = { format: "anthropic", body: { model: "claude-x", system: sys(), messages: [...r4.body.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content.replace(/\n*<filament-memory[\s\S]*?<\/filament-memory>\n*/g, "") : m.content })), { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "file" }] }] }, headers: CC_UA, model: "claude-x" };
  const sitL = svc.situate(leg); assert.equal(sitL.position, "toolLeg");
  const prepL = await svc.prepare(sitL, { requestId: "r5b" }); assert.equal(prepL.newTurn, false); assert.equal(prepL.injected, 0);
  assert.ok(leg.body.messages[4].content.includes("Write tool"), "history re-attached on a tool leg too");
});

test("commands: status, remember, sessions, load attaches a session to the next message, off/on, new", async () => {
  const s = svc.situate(req(["@mem status"]));
  const st = await memoryCommand(svc, "@mem status", s); assert.ok(/Memory status/.test(st.text)); assert.ok(/sessions archived/.test(st.text));
  // The command names the kind, never the words (the memory plan's d3).
  const rm = await memoryCommand(svc, "@mem remember always run npm test before committing", s); assert.ok(/Stored as a fact/.test(rm.text), rm.text);
  const rl = await memoryCommand(svc, "@mem rule always run the linter before committing", s); assert.ok(/Stored as a rule/.test(rl.text), rl.text);
  const pf = await memoryCommand(svc, "@mem prefer short answers with the outcome first", s); assert.ok(/Stored as a preference/.test(pf.text), pf.text);
  const pr = await memoryCommand(svc, "@mem procedure How to release: 1. npm version patch 2. npm publish", s); assert.ok(/Stored as a procedure/.test(pr.text), pr.text);
  const bad = await memoryCommand(svc, "@mem procedure release it on fridays", s); assert.ok(/How to <goal>/.test(bad.text), bad.text);
  const how = await memoryCommand(svc, "@mem remember How to deploy: 1. npm run build 2. npm run ship", s); assert.ok(/Stored as a fact/.test(how.text), `remember keeps a fact, whatever its words: ${how.text}`);
  const ss = await memoryCommand(svc, "@mem sessions tray restarting", s); assert.ok(/Sessions matching/.test(ss.text), ss.text); assert.ok(/1\. `/.test(ss.text), ss.text);
  const ld = await memoryCommand(svc, "@mem load 1 chat", s); assert.ok(/Loaded session/.test(ld.text), ld.text);
  const nxt = req(["what did that session conclude?"], { headers: { ...CC_UA, "x-session-id": "zc-77" } });
  const sitN = svc.situate(nxt); // a different chain (header key); the pending load belongs to the command's chain key
  assert.notEqual(sitN.key, s.key);
  const sitSame = svc.situate({ ...req(["@mem status", "what did that session conclude?"]) });
  const prepSame = await svc.prepare(sitSame, { requestId: "r4" });
  assert.ok(prepSame.loaded, "the loaded session id is reported"); assert.ok(sitSame.body.messages.at(-1).content.includes(`<${MEMORY_TAG} kind="load">`)); assert.ok(sitSame.body.messages.at(-1).content.includes("Turn 1"));
  const off = await memoryCommand(svc, "@mem off", sitSame); assert.ok(/off for this chat/.test(off.text));
  const prepMuted = await svc.prepare(svc.situate(req(["@mem status", "what did that session conclude?", "another question about the tray"])), { requestId: "r5" }); assert.equal(prepMuted.muted, true); assert.equal(prepMuted.injected, 0);
  const on = await memoryCommand(svc, "@mem on", sitSame); assert.ok(/on again/.test(on.text));
  const nw = await memoryCommand(svc, "@mem new", sitSame); assert.ok(/new session/.test(nw.text));
  const after = svc.situate(req(["@mem status", "what did that session conclude?", "another question about the tray"])); const prepAfter = await svc.prepare(after, { requestId: "r6" }); assert.notEqual(prepAfter.chain, prepSame.chain, "a fresh chain after @mem new");
  const help = await memoryCommand(svc, "@mem", s); assert.ok(/Memory commands/.test(help.text));
  assert.equal(await memoryCommand(svc, "hello there", s), null);
});

// (fails before: yes — the load was pasted into the message's one block before its recall, so the recall found the
// block taken and looked nothing up: the message carried the load and no related memory)
test("a session loaded onto a message rides after its recall, which still runs, and both go out the same on every resend", async () => {
  const A = "the lexer keeps failing on escapes in the string table";
  const other = (await svc.prepare(svc.situate(req(["the parser fixture for nested quotes lives in test/fixtures/quotes"])), { requestId: "ld1-o" })).chain;
  const s1 = svc.situate(req([A]));
  await svc.prepare(s1, { requestId: "ld1-1" });
  await svc.store.remember({ content: "The lexer string table escapes are generated by scripts/gen-escapes.mjs; rerun it after editing the table.", source: "fact", importance: 0.8, metadata: { kind: "fact" } });
  assert.match((await memoryCommand(svc, `@mem load ${other}`, s1)).text, /^Loaded session/);
  const E = "how are the lexer string table escapes generated?";
  const r2 = req([A, E]);
  const p2 = await svc.prepare(svc.situate(r2), { requestId: "ld1-2" });
  const sent = String(r2.body.messages.at(-1).content);
  assert.equal(p2.loaded, other, p2.notes.join(" | "));
  assert.match(sent, /kind="turn">[\s\S]*gen-escapes[\s\S]*kind="load">[\s\S]*nested quotes/, sent.slice(0, 600));
  const r3 = req([A, E, "and the parser?"]);
  await svc.prepare(svc.situate(r3), { requestId: "ld1-3" });
  assert.equal(r3.body.messages[2].content, sent, "the same message, byte for byte, on the next request");
});

// (fails before: yes — the review of 14b90e384: the second load took the first's place in the message's one slot for
// loads: the retry sent the message with both, the next request with the second alone — its bytes changed under the
// provider's cache, the first session gone from it for good)
test("a second load onto one message keeps the first: the next request sends the message as its retry did", async () => {
  const cwd = "C:\\filament-second-load";
  const A = "the release train leaves on thursdays";
  const one = (await svc.prepare(svc.situate(req(["the staging cluster is called blue-7"], { cwd })), { requestId: "ld4-o1" })).chain;
  const two = (await svc.prepare(svc.situate(req(["the canary sits in the eu-west-2 region"], { cwd })), { requestId: "ld4-o2" })).chain;
  const s1 = svc.situate(req([A], { cwd }));
  await svc.prepare(s1, { requestId: "ld4-1" });
  const B = "which cluster does the train stage on?";
  assert.match((await memoryCommand(svc, `@mem load ${one}`, s1)).text, /^Loaded session/);
  await svc.prepare(svc.situate(req([A, B], { cwd })), { requestId: "ld4-2" });
  // The request failed; a second session is loaded, and the client asks again, the message as it holds it.
  assert.match((await memoryCommand(svc, `@mem load ${two}`, s1)).text, /^Loaded session/);
  const retry = req([A, B], { cwd });
  await svc.prepare(svc.situate(retry), { requestId: "ld4-3" });
  const sent = String(retry.body.messages[2].content);
  assert.match(sent, /kind="load">[\s\S]*blue-7[\s\S]*kind="load">[\s\S]*eu-west-2/, `the retry carries both loads, in the order they came: ${sent.slice(0, 600)}`);
  const next = req([A, B, "and the canary?"], { cwd });
  await svc.prepare(svc.situate(next), { requestId: "ld4-4" });
  assert.equal(next.body.messages[2].content, sent, "the message's bytes are the retry's: both loads, in the order they went");
});

// (fails before: yes — the load took the place of the block its message's words already had: on the next request the
// earlier copy of those words went out bare, its bytes changed, the copy the load rode lost its block, and every later
// copy of the words carried the load again)
test("a load rides its one message: an earlier copy of its words keeps its block, a later one has the block and no load", async () => {
  const A = "the build cache key ignores the lockfile";
  const other = (await svc.prepare(svc.situate(req(["the release notes template lives in docs/release.md"])), { requestId: "ld2-o" })).chain;
  const s1 = svc.situate(req([A]));
  await svc.prepare(s1, { requestId: "ld2-1" });
  await svc.store.remember({ content: "The build cache key is computed in scripts/cache-key.mjs from package.json alone; the lockfile is not hashed.", source: "fact", importance: 0.8, metadata: { kind: "fact" } });
  const B = "where is the build cache key computed?";
  const r2 = req([A, B]);
  await svc.prepare(svc.situate(r2), { requestId: "ld2-2" });
  const first = String(r2.body.messages[2].content);
  assert.match(first, /kind="turn">[\s\S]*cache-key\.mjs/, first.slice(0, 400));
  assert.match((await memoryCommand(svc, `@mem load ${other}`, s1)).text, /^Loaded session/);
  const r3 = req([A, B, "and the lockfile?", B]);
  await svc.prepare(svc.situate(r3), { requestId: "ld2-3" });
  const twin = String(r3.body.messages[6].content);
  assert.match(twin, /kind="turn">[\s\S]*cache-key\.mjs[\s\S]*kind="load">[\s\S]*release notes template/, twin.slice(0, 600));
  const r4 = req([A, B, "and the lockfile?", B, "thanks", B]);
  await svc.prepare(svc.situate(r4), { requestId: "ld2-4" });
  const m = r4.body.messages.map((/** @type {any} */ x) => String(x.content));
  assert.equal(m[2], first, "the earlier copy keeps its block, byte for byte");
  assert.equal(m[6], twin, "the copy the load rode, byte for byte");
  assert.doesNotMatch(m[10], /kind="load"/, "a later copy of the words carries no load");
  assert.match(m[10], /kind="turn">[\s\S]*cache-key\.mjs/, "and has the block its words have");
});

// (fails before: yes — the review of 6798aad42: a load on a later copy of a message's words took the one slot the
// earlier copy's load was kept in, so from the next request on the earlier copy went out without its load)
test("each copy of a message's words keeps the load it rode", async () => {
  const A = "the migration renames the orders table";
  const x = (await svc.prepare(svc.situate(req(["the rollback script for the orders migration is scripts/rollback.sql"])), { requestId: "ld5-x" })).chain;
  const y = (await svc.prepare(svc.situate(req(["the staging database behind the orders service is refreshed nightly"])), { requestId: "ld5-y" })).chain;
  const s1 = svc.situate(req([A]));
  await svc.prepare(s1, { requestId: "ld5-1" });
  const C = "go on with the migration plan from where we stopped";
  assert.match((await memoryCommand(svc, `@mem load ${x}`, s1)).text, /^Loaded session/);
  const r2 = req([A, C]);
  await svc.prepare(svc.situate(r2), { requestId: "ld5-2" });
  const first = String(r2.body.messages[2].content);
  assert.match(first, /kind="load">[\s\S]*rollback\.sql/, first.slice(0, 600));
  assert.match((await memoryCommand(svc, `@mem load ${y}`, s1)).text, /^Loaded session/);
  const r3 = req([A, C, "the orders table first", C]);
  await svc.prepare(svc.situate(r3), { requestId: "ld5-3" });
  const twin = String(r3.body.messages[6].content);
  assert.match(twin, /kind="load">[\s\S]*refreshed nightly/, twin.slice(0, 600));
  assert.equal(String(r3.body.messages[2].content), first, "the first copy keeps its load on the request the second rode");
  const r4 = req([A, C, "the orders table first", C, "thanks, that settles it"]);
  await svc.prepare(svc.situate(r4), { requestId: "ld5-4" });
  const m = r4.body.messages.map((/** @type {any} */ v) => String(v.content));
  assert.equal(m[2], first, "the first copy keeps its load, byte for byte");
  assert.equal(m[6], twin, "the second copy keeps its own");
});

// (fails before: yes — the review of 6798aad42: a message whose recall found nothing on the request its load rode, and
// something on a retry of that request, went out with the load and then its block on the retry, and with its block and
// then the load on every request after: the cached prefix broke at that message)
test("a message's own block made on a retry after its load rode it goes before the load, as on every later request", async () => {
  const A = "the scheduler drops jobs queued during a deploy";
  const other = (await svc.prepare(svc.situate(req(["the deploy checklist for the scheduler lives in docs/deploy.md"])), { requestId: "ld6-o" })).chain;
  const s1 = svc.situate(req([A]));
  await svc.prepare(s1, { requestId: "ld6-1" });
  assert.match((await memoryCommand(svc, `@mem load ${other}`, s1)).text, /^Loaded session/);
  const E = "where does the scheduler keep its pending jobs while a deploy runs?";
  const r2 = req([A, E]);
  await svc.prepare(svc.situate(r2), { requestId: "ld6-2" });
  const before = String(r2.body.messages[2].content);
  assert.doesNotMatch(before, /kind="turn"/, "nothing recalled on the request the load rode");
  assert.match(before, /kind="load">[\s\S]*deploy checklist/, before.slice(0, 600));
  await svc.store.remember({ content: "The scheduler keeps its pending jobs in Redis under sched:pending; a deploy moves them to sched:held until it ends.", source: "fact", importance: 0.8, metadata: { kind: "fact" } });
  const retry = req([A, E]);
  await svc.prepare(svc.situate(retry), { requestId: "ld6-3" });
  const sent = String(retry.body.messages[2].content);
  assert.match(sent, /kind="turn">[\s\S]*sched:pending[\s\S]*kind="load">[\s\S]*deploy checklist/, sent.slice(0, 800));
  const r3 = req([A, E, "and once the deploy ends?"]);
  await svc.prepare(svc.situate(r3), { requestId: "ld6-4" });
  assert.equal(String(r3.body.messages[2].content), sent, "the same message, byte for byte, on the next request");
});

// (fails before: no — a guard: the review of 2e9bc425d found the array branch of a block placed before the load
// unexercised: on content in parts, the block goes in its own part before the load's, as appending the two in that
// order would)
test("a block placed before a load on content in parts lands where appending the two in order puts it", () => {
  const parts = () => ({ messages: [{ role: "user", content: [{ type: "text", text: "the words" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] }] });
  const inOrder = parts();
  applyUserBlock(inOrder, 0, "the recall", "turn");
  applyUserBlock(inOrder, 0, "the load", "load");
  const late = parts();
  applyUserBlock(late, 0, "the load", "load");
  assert.equal(applyUserBlock(late, 0, "the recall", "turn", memoryBlock("load", "the load")), true);
  assert.deepEqual(late, inOrder);
  assert.equal(applyUserBlock(late, 0, "the recall", "turn", memoryBlock("load", "the load")), false, "placed once");
});

// (fails before: yes — the review of 6798aad42: with memory and its autopilot both off in Memory settings, the reply
// named memory alone, and turning it back on left the load waiting on the autopilot)
test("@mem load with memory and its autopilot off in Memory settings names both", async () => {
  const cwd = "C:\\filament-held-load-2";
  const s = svc.situate(req(["@mem status"], { cwd }));
  const id = svc.chainFor(s).id;
  const real = svc.getConfig;
  svc.getConfig = () => ({ ...real(), memory: { ...real().memory, enabled: false, autopilot: { ...(real().memory?.autopilot || {}), enabled: false } } });
  try {
    const said = (await memoryCommand(svc, `@mem load ${id}`, s)).text;
    assert.match(said, /It waits while memory and its autopilot are off in Memory settings, then rides your next message here\.$/, said);
  } finally {
    svc.getConfig = real;
  }
});

// (fails before: yes — a load that rendered nothing was used up with no word: no block, no note)
test("a load with nothing to paste is used up, and the notes say so", async () => {
  const cwd = "C:\\filament-empty-load";
  const s0 = svc.situate(req(["@mem help"], { cwd }));
  const own = svc.chainFor(s0).id;
  assert.match((await memoryCommand(svc, `@mem load ${own}`, s0)).text, /^Loaded session/);
  const p = await svc.prepare(svc.situate(req(["@mem help", "what was decided here?"], { cwd })), { requestId: "ld3-1" });
  assert.equal(p.loaded, undefined);
  assert.ok(p.notes.some((/** @type {string} */ n) => /nothing of session \S+ to load before this message/.test(n)), p.notes.join(" | "));
  assert.equal(svc.pendingLoads.has(s0.key), false, "used up");
});

// (fails before: yes — the reply named the first reason alone: with memory off in the chat and autopilot off, it promised
// the load after `@mem on`, which left autopilot off and the load waiting)
test("@mem load in a chat memory stays out of names every reason it waits", async () => {
  const cwd = "C:\\filament-held-load";
  const s = svc.situate(req(["@mem off"], { cwd }));
  await memoryCommand(svc, "@mem off", s);
  const real = svc.getConfig;
  svc.getConfig = () => ({ ...real(), memory: { ...real().memory, autopilot: { ...(real().memory?.autopilot || {}), enabled: false } } });
  try {
    const said = (await memoryCommand(svc, `@mem load ${svc.chainFor(s).id}`, s)).text;
    assert.match(said, /It waits while memory is off in this chat \(`@mem on` turns it back on\) and autopilot is off in Memory settings, then rides your next message here\.$/, said);
  } finally {
    svc.getConfig = real;
  }
});

// (fails before: yes — the harness's chat was rekeyed under a closed key and told a fresh chain starts, while its turns
// went on in the same session by its id)
test("@mem new in a chat of the harness's own says it goes on as itself, and moves nothing", async () => {
  const sit = svc.situate(req(["a first word in a harness chat"], { headers: { ...CC_UA, "x-session-id": "own-new-1" } }));
  const prep = await svc.prepare(sit, { requestId: "on1" });
  svc.archive.mergeMeta(prep.chain, { native: true });
  const key = svc.archive.getChain(prep.chain).key;
  const nw = await memoryCommand(svc, "@mem new", sit);
  assert.equal(nw.text, "This chat is one of the harness's own: it goes on as this session. A new chat (New chat, at the top of the left bar) starts fresh.");
  assert.equal(svc.archive.getChain(prep.chain).key, key, "its key stays");
});

test("@mem off keeps its promise past the reply: the turn is archived, no learning is queued, and the trace says why", async () => {
  const sit = svc.situate(req(["a question about the flaky build"], { headers: { ...CC_UA, "x-session-id": "mute-learn-1" } }));
  const prep = await svc.prepare(sit, { requestId: "ml1" });
  await memoryCommand(svc, "@mem off", sit);
  svc.learner.pending.delete(prep.chain);
  const tr = svc.trace();
  svc.afterReply({ chainId: prep.chain, turnId: prep.turn, requestId: "ml1", finalMessage: { role: "assistant", content: [{ type: "text", text: "Retry the step." }] }, replyText: "Retry the step.", outputChars: 15, trace: tr });
  assert.equal(svc.learner.pending.has(prep.chain), false, "nothing queued for the idle learner");
  assert.match(tr.steps.find((x) => x.name === "learning off")?.note || "", /memory is off for this chat/, "the trace says why instead of 'learning queued'");
  assert.ok(!tr.steps.some((x) => x.name === "learning queued"));
  assert.ok(svc.archive.getTurns(prep.chain).length >= 1, "recording never stops (D6)");
  await memoryCommand(svc, "@mem on", sit);
  const tr2 = svc.trace();
  svc.afterReply({ chainId: prep.chain, turnId: prep.turn, requestId: "ml2", finalMessage: { role: "assistant", content: [{ type: "text", text: "Done." }] }, replyText: "Done.", outputChars: 5, trace: tr2 });
  assert.equal(svc.learner.pending.has(prep.chain), true, "@mem on queues it again");
  assert.ok(tr2.steps.some((x) => x.name === "learning queued"));
});

test("sessions list carries the learning state; a manual learn force-runs the learner and stamps the chain", async () => {
  const r = req(["where is the deploy checklist and when do we ship?", "ok, and bump the cache ttl"], { cwd: "C:\\learnstate", headers: { ...CC_UA, "x-session-id": "lrn-1" } });
  const prep = await svc.prepare(svc.situate(r), { requestId: "lrn0" });
  const id = prep.chain;
  const before = svc.brain.sessions("", { limit: 50 }).find((s) => s.id === id);
  assert.ok(before, "the session is listed"); assert.equal(before.learned, null, "no learner pass yet"); assert.equal(typeof before.items, "number");
  // A run reads finished turns (HarnessV3-Memory M7-D28): the reply lands first.
  svc.afterReply({ chainId: id, turnId: prep.turn, requestId: "lrn0", finalMessage: { role: "assistant", content: [{ type: "text", text: "The checklist is in ops.md; the cache ttl is bumped." }] }, replyText: "The checklist is in ops.md; the cache ttl is bumped.", outputChars: 52 });
  const prev = svc.callModel;
  svc.callModel = async () => JSON.stringify({ title: "Deploy checklist", state: { summary: "located the checklist; ship day confirmed", done: ["checklist found in ops.md"], open: [], next: [] }, turns: [{ n: 1, summary: "asked where the checklist lives" }], items: [{ kind: "preference", text: "Deploys for this project ship on the staging ring first", turn: 1, importance: 0.7 }] });
  try {
    const out = await svc.learn(id);
    assert.equal(out.items, 1, "one item learned"); assert.ok(out.title, "title written"); assert.ok(out.state, "end state written");
    const after = svc.brain.sessions("", { limit: 50 }).find((s) => s.id === id);
    assert.equal(after.title, "Deploy checklist", "the card gets its title");
    assert.ok(/checklist/.test(after.state || ""), "the card gets the end-state line");
    assert.equal(after.items, 1, "learned items counted per session");
    assert.ok(after.learned && after.learned.at && !after.learned.error && !after.learned.skipped, "learned stamp from meta.lastLearn");
    assert.equal(after.open.length, 0);
    const again = await svc.learn(id); assert.ok(again.dedupedItems >= 1 || again.items === 0, "re-learning dedupes instead of duplicating");
  } finally { svc.callModel = prev; }
});

test("cache stability: hundreds of block-bearing messages and a late duplicate never change already-sent bytes", async () => {
  const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
  // seed one memory per turn theme so (almost) every message earns a turn block
  for (let i = 0; i < 80; i++) await svc.store.remember({ content: `gizmo-${i} rev ${1000 + i} calibration tolerance jig voltage margin ${i}: always reseat gizmo-${i} first`, source: "fact", importance: 0.9 });
  const H = [{ role: "user", content: "the orphan protocol handshake sequence alpha-beta-gamma-delta-epsilon needs review" }, { role: "assistant", content: "noted, nothing found" }];
  await svc.prepare(svc.situate(req([H[0].content], { cwd: "C:\\cachestress", headers: { ...CC_UA, "x-session-id": "cs-1" } })), { requestId: "cs-0" });
  await svc.store.remember({ content: "orphan protocol handshake sequence alpha-beta-gamma-delta-epsilon requires the beta guard", source: "fact", importance: 0.95 });
  let prev = null;
  const wireOf = (body) => ({ m: body.messages.map((m) => `${m.role}:${sha(JSON.stringify(m.content))}`).join("|"), s: sha(String(body.system)) });
  for (let i = 0; i < 75; i++) {
    const msgs = [...H, { role: "user", content: `about gizmo-${i} rev ${1000 + i} calibration like we discussed before: proceed with gizmo-${i}` }];
    const r = { format: "anthropic", body: { model: "claude-x", max_tokens: 100, system: sys("C:\\cachestress"), messages: structuredClone(msgs) }, headers: { ...CC_UA, "x-session-id": "cs-1" }, model: "claude-x" };
    await svc.prepare(svc.situate(r), { requestId: `cs-${i + 1}` });
    const wire = wireOf(r.body);
    if (prev) { assert.equal(wire.m.slice(0, prev.m.length), prev.m, `request ${i}: the provider-visible prefix changed for already-sent messages`); assert.equal(wire.s, prev.s, `request ${i}: the system prompt changed`); }
    prev = wire;
    H.push({ role: "user", content: msgs.at(-1).content }, { role: "assistant", content: `ok ${i}` });
    if (i === 40) { // the orphan's exact text returns now that a memory matches it: the older twin must stay clean
      const dup = { format: "anthropic", body: { model: "claude-x", max_tokens: 100, system: sys("C:\\cachestress"), messages: structuredClone([...H, { role: "user", content: H[0].content }]) }, headers: { ...CC_UA, "x-session-id": "cs-1" }, model: "claude-x" };
      await svc.prepare(svc.situate(dup), { requestId: `cs-dup` });
      const w2 = wireOf(dup.body);
      assert.equal(w2.m.slice(0, prev.m.length), prev.m, "the duplicate must not change the bytes of the earlier identical message");
      prev = w2;
      H.push({ role: "user", content: H[0].content }, { role: "assistant", content: "reviewed" });
    }
  }
  const chain = svc.archive.getChain(svc.archive.recentChains({ limit: 1 })[0].id);
  const mapSize = Object.keys(svc.archive.blocksFor(chain.id)).length;
  assert.ok(mapSize > 60, `the block map must be uncapped to keep the prefix stable (held ${mapSize} entries)`);
});

test("cleanup: move a session between projects, delete a session, delete a project", async () => {
  const mk = async (cwd, sid, texts) => { const r = req(texts, { cwd, headers: { ...CC_UA, "x-session-id": sid } }); const sit = svc.situate(r); const prep = await svc.prepare(sit, { requestId: sid }); return { sit, prep }; };
  const X = await mk("C:\\cleanupX", "cx-1", ["wire the flux capacitor in cleanupX"]);
  const Y = await mk("C:\\cleanupY", "cy-1", ["tune the rectifier in cleanupY"]);
  assert.notEqual(X.sit.project.id, Y.sit.project.id);
  // an item learned from Y's session, mirrored into the engine
  const it = svc.archive.items.add({ projectId: Y.sit.project.id, chainId: Y.prep.chain, kind: "fact", text: "The rectifier tunes at 60 Hz in cleanupY", status: "inferred", importance: 0.6 });
  svc.archive.items.setMemoryId(it.id, "fake-mem-cy1");
  // moving re-files the chain and its items under the target project
  const mv = svc.moveSession(Y.prep.chain, X.sit.project.id);
  assert.equal(mv.to, X.sit.project.id); assert.equal(mv.items, 1, "the item followed its session");
  assert.ok(svc.brain.sessions("", { limit: 50, project: X.sit.project.id }).some((s) => s.id === Y.prep.chain), "the moved session lists under X");
  assert.equal(svc.brain.sessions("", { limit: 50, project: Y.sit.project.id }).length, 0, "nothing left under Y");
  assert.equal(svc.archive.items.get(it.id).project_id, X.sit.project.id);
  // deleting a session removes its turns and items, and forgets the engine twin
  const forgotten = []; const origForget = svc.store.forget.bind(svc.store); svc.store.forget = async (id) => { forgotten.push(id); return origForget(id); };
  try {
    const del = await svc.deleteSession(Y.prep.chain);
    assert.ok(del.turns >= 1); assert.equal(del.items, 1); assert.deepEqual(forgotten, ["fake-mem-cy1"], "the engine twin is forgotten");
    assert.ok(!svc.brain.sessions("", { limit: 50 }).some((s) => s.id === Y.prep.chain), "gone from the list");
    assert.ok(svc.archive.items.get(it.id) == null, "its learned items are gone");
    // deleting a project cascades over what is left under it
    const delp = await svc.deleteProject(X.sit.project.id);
    assert.ok(delp.chains >= 1); assert.equal(svc.brain.sessions("", { limit: 50, project: X.sit.project.id }).length, 0, "the project filter is empty afterwards");
    assert.ok(!svc.projects().some((p) => p.id === X.sit.project.id), "the project row is gone");
    await assert.rejects(() => svc.deleteProject("nope"), /no such project/);
    await assert.rejects(() => svc.deleteSession("nope"), /no such session/);
  } finally { svc.store.forget = origForget; }
});

test("compaction request: nothing injected, the summary is archived; continuation links and stores the client's summary", async () => {
  const r = req(["fix the loop", "Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests."], { cwd: "C:\\projects\\acme-game" });
  const sit = svc.situate(r); const prep = await svc.prepare(sit, { requestId: "c1" });
  assert.equal(prep.position, "compaction"); assert.ok(prep.compaction); assert.equal(prep.injected, 0);
  // The client's own summary is a compaction door (HarnessV3-Memory M7-D27): its row written, the session learns now.
  const runs = []; const realLearn = svc.learner.learnChain;
  svc.learner.learnChain = (chainId, o) => { runs.push([chainId, o]); return Promise.resolve({}); };
  try {
    const empty = svc.trace();
    svc.afterReply({ chainId: prep.chain, turnId: null, requestId: "c1", replyText: "", compaction: prep.compaction, trace: empty });
    assert.equal(svc.archive.getCompactions(prep.chain).length, 0, "an empty reply writes no row");
    assert.deepEqual(runs, [], "and starts no learning: nothing was compacted");
    assert.ok(!empty.steps.some((x) => x.name === "learning starts now"));
    const tr = svc.trace();
    svc.afterReply({ chainId: prep.chain, turnId: null, requestId: "c1", replyText: "Summary: the user fixed the loop in acme-game.", compaction: prep.compaction, trace: tr });
    assert.equal(svc.archive.getCompactions(prep.chain).length, 1);
    // (fails before: yes — the client's own summary was written with no method, for the readers to guess at)
    assert.equal(svc.archive.getCompactions(prep.chain)[0].method, "summary", "a client's own compaction is a summary, and its row says so");
    assert.deepEqual(runs, [[prep.chain, { reason: "compaction", door: "client" }]], "the row written, the session learns now, by the client's door");
    assert.deepEqual(tr.steps.filter((x) => x.name === "learning starts now").map((x) => [x.session, x.model]), [[prep.chain, "claude-haiku-4-5"]]);
  } finally { svc.learner.learnChain = realLearn; }
  const cont = req(["This session is being continued from a previous conversation that ran out of context. Summary: the user fixed the loop in acme-game and wants tests next."], { cwd: "C:\\projects\\acme-game", headers: { ...CC_UA, "x-session-id": "new-1" } });
  const sit2 = svc.situate(cont); const prep2 = await svc.prepare(sit2, { requestId: "c2" });
  assert.equal(prep2.position, "afterCompaction"); assert.ok(prep2.notes.some((n) => /continues/.test(n)), prep2.notes.join(" | "));
  const links = svc.archive.linksFor(prep2.chain); assert.ok(links.some((l) => l.type === "continues" && l.dst === prep.chain));
});

test("mixed tool replies: deferred memory results reach the chain's next request", async () => {
  const r = req(["look at src/usage.js rateNow and remember what we decided"], { cwd: "C:\\mixed" });
  const sit = svc.situate(r); const prep = await svc.prepare(sit, { requestId: "d1" });
  await deferMemoryResults([{ id: "b", name: "filament_memory_search", input: { query: "rateNow tps" } }], memoryToolCtx(svc, sit, prep), { because: "mixed" });
  const leg = { format: "anthropic", body: { model: "claude-x", system: sys("C:\\mixed"), messages: [{ role: "user", content: "look at src/usage.js rateNow and remember what we decided" }, { role: "assistant", content: [{ type: "tool_use", id: "a", name: "Read", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "file" }] }] }, headers: CC_UA, model: "claude-x" };
  const sit2 = svc.situate(leg); const prep2 = await svc.prepare(sit2, { requestId: "d2" });
  assert.equal(prep2.chain, prep.chain); const last = leg.body.messages.at(-1); assert.ok(last.content.some((b) => b.type === "text" && b.text.includes(`<${MEMORY_TAG} kind="tool">`) && b.text.includes("filament_memory_search")));
});

// (fails before: yes — a loop's own tick returned before the deferred results were attached: its model read them only
// with the person's next request, and results one loop deferred rode whatever request of the session came next)
test("a loop's tick: the results its own reply deferred reach its next tick, never another loop's or the person's request", async () => {
  const first = "trace the rateNow figures in src/usage.js";
  const prep = await svc.prepare(svc.situate(req([first], { cwd: "C:\\ticks" })), { requestId: "tk0" });
  const tick = (/** @type {string} */ run) => ({ format: "anthropic", body: { model: "claude-x", system: sys("C:\\ticks"), messages: [{ role: "user", content: first }, { role: "assistant", content: [{ type: "tool_use", id: `u_${run}`, name: "Read", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: `u_${run}`, content: "file" }] }] }, headers: { ...CC_UA, "x-filament-memory": "tools", "x-filament-agent-of": run }, model: "claude-x" });
  const said = (/** @type {any} */ r) => JSON.stringify(r.body.messages.at(-1).content).includes("Results of the memory tools");
  const a1 = tick("run-a"); const sitA = svc.situate(a1); const prepA = await svc.prepare(sitA, { requestId: "tka1" });
  assert.equal(prepA.chain, prep.chain);
  await deferMemoryResults([{ id: "m", name: "filament_memory_search", input: { query: "rateNow" } }], memoryToolCtx(svc, sitA, prepA), { because: "mixed" });
  const b1 = tick("run-b"); await svc.prepare(svc.situate(b1), { requestId: "tkb1" });
  assert.ok(!said(b1), "another loop's tick on the same session gets none of them");
  const person = req([first, "now write the tests"], { cwd: "C:\\ticks" }); await svc.prepare(svc.situate(person), { requestId: "tk1" });
  assert.ok(!said(person), "nor does the person's next request");
  const a2 = tick("run-a"); const prepA2 = await svc.prepare(svc.situate(a2), { requestId: "tka2" });
  assert.ok(said(a2), "the loop's next tick carries them");
  assert.equal(prepA2.quiet, true);
  assert.ok(prepA2.notes.some((n) => /results of the model's memory tool calls attached/.test(n)), prepA2.notes.join(" | "));
});

// (fails before: yes — a request the client asked memory to stay out of returned before the deferred results were
// attached, though they answer the model's own calls)
test("deferred memory results reach a request the client asked memory to stay out of", async () => {
  const first = "check the retry loop in src/fetcher.js";
  const sit = svc.situate(req([first], { cwd: "C:\\deferoff" })); const prep = await svc.prepare(sit, { requestId: "do0" });
  await deferMemoryResults([{ id: "b", name: "filament_memory_search", input: { query: "retry loop" } }], memoryToolCtx(svc, sit, prep), { because: "mixed" });
  const leg = { format: "anthropic", body: { model: "claude-x", system: sys("C:\\deferoff"), messages: [{ role: "user", content: first }, { role: "assistant", content: [{ type: "tool_use", id: "a", name: "Read", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "file" }] }] }, headers: { ...CC_UA, "x-filament-memory": "off" }, model: "claude-x" };
  const prep2 = await svc.prepare(svc.situate(leg), { requestId: "do1" });
  assert.equal(prep2.quiet, true);
  assert.ok(leg.body.messages.at(-1).content.some((/** @type {any} */ b) => b.type === "text" && b.text.includes(`<${MEMORY_TAG} kind="tool">`) && b.text.includes("filament_memory_search")));
});

// (fails before: yes — a tool leg carrying a client's reminder beside its results read as the person's message: memory
// opened a new turn on it and attached a per-turn block)
test("a tool leg with a client's reminder beside its results continues the turn: no new turn, no per-turn block", async () => {
  const first = "find where the cache key is built in src/cache.js";
  const p1 = await svc.prepare(svc.situate(req([first], { cwd: "C:\\reminder-leg" })), { requestId: "rl0" });
  const leg = { format: "anthropic", body: { model: "claude-x", system: sys("C:\\reminder-leg"), messages: [{ role: "user", content: first }, { role: "assistant", content: [{ type: "tool_use", id: "g", name: "Grep", input: { pattern: "cacheKey" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "g", content: "src/cache.js:12" }, { type: "text", text: "<system-reminder>\nThe date has changed.\n</system-reminder>" }] }] }, headers: CC_UA, model: "claude-x" };
  const sit = svc.situate(leg);
  assert.equal(sit.position, "toolLeg");
  const p2 = await svc.prepare(sit, { requestId: "rl1" });
  assert.equal(p2.chain, p1.chain); assert.equal(p2.newTurn, false); assert.equal(p2.turnN, p1.turnN);
  assert.ok(!JSON.stringify(leg.body.messages.at(-1).content).includes(`<${MEMORY_TAG} kind="turn">`));
});

// (fails before: yes — what a Responses client's tool returned beside its output, carried in a user message after the
// tool messages, read as the person's message)
test("what a Responses client's tool returned beside its output is no message of the person's", async () => {
  const input = [{ role: "user", content: "look at the screenshot of the settings page" }, { type: "function_call", call_id: "s1", name: "Screenshot", arguments: "{}" }, { type: "function_call_output", call_id: "s1", output: [{ type: "input_text", text: "taken" }, { type: "input_image", image_url: "data:image/png;base64,AAAA" }] }];
  const { chat } = responsesToChat({ model: "gpt-x", instructions: "You help.\nWorking directory: C:\\carried", input });
  assert.equal(chat.messages.at(-1).role, "user", "the image rides a user message after the tool message");
  const sit = svc.situate({ format: "openai", body: chat, headers: { "x-session-id": "carried-1" }, model: "gpt-x" });
  assert.equal(sit.position, "toolLeg"); assert.equal(sit.newestIndex, -1);
  assert.deepEqual(allUserTexts("openai", chat), ["look at the screenshot of the settings page"], "nor are its words the person's");
});

// (fails before: yes — the briefing was tried only while the session had fewer than three turns, muted ones counted: a
// session muted for its first three never got one)
test("a briefing is tried on turns memory takes part in: three muted turns first, the fourth still gets one, on its message", async () => {
  const texts = ["what does the tray watchdog restart?", "and how often does it check?", "where does it log?", "why did Filament restart twice?"];
  const at = (/** @type {number} */ n) => req(texts.slice(0, n), { cwd: "C:\\muted-first", headers: { ...CC_UA, "x-session-id": "muted-first" } });
  const chain = svc.chainFor(svc.situate(at(1)));
  svc.brain.mute(chain.id, true);
  for (let n = 1; n <= 3; n++) {
    const prep = await svc.prepare(svc.situate(at(n)), { requestId: `mf${n}` });
    assert.equal(prep.chain, chain.id); assert.equal(prep.muted, true);
    svc.afterReply({ chainId: prep.chain, turnId: prep.turn, requestId: `mf${n}`, finalMessage: { role: "assistant", content: [{ type: "text", text: "Done." }] }, replyText: "Done.", outputChars: 5 });
  }
  assert.equal(svc.archive.getChain(chain.id).turns, 3, "three turns recorded while muted");
  svc.brain.mute(chain.id, false);
  const r4 = at(4); const prep4 = await svc.prepare(svc.situate(r4), { requestId: "mf4" });
  assert.ok(prep4.briefing > 0, prep4.notes.join(" | "));
  // The system prompt went out without one three times: it rides the message it was built on (t418).
  assert.ok(String(r4.body.messages.at(-1).content).includes(`<${MEMORY_TAG} kind="briefing">`));
  assert.ok(!String(r4.body.system).includes(`<${MEMORY_TAG} kind="briefing">`));
});

// (fails before: yes — the newest chain of the project was taken whatever its kind: an outside agent's MCP chain or a
// loop's tick stood as the person's previous session)
test("a client's compaction links the person's previous session, and the briefing names it — never a newer MCP or tick chain of the project", async () => {
  const cwd = "C:\\kinds";
  const p1 = await svc.prepare(svc.situate(req(["build the parser for the config files"], { cwd, headers: { ...CC_UA, "x-session-id": "kinds-1" } })), { requestId: "kd1" });
  const later = svc.archive.getChain(p1.chain).last_at + 60_000;
  const others = [["kinds-mcp", "mcp"], ["kinds-tick", "tick"]].map(([key, kind]) => {
    const c = svc.archive.chainForKey(key, { cwd, kind });
    svc.archive.db.prepare("UPDATE chains SET last_at = ? WHERE id = ?").run(later, c.id);
    return c.id;
  });
  const r2 = req(["This session is being continued from a previous conversation. Summary: the config parser reads YAML now."], { cwd, headers: { ...CC_UA, "x-session-id": "kinds-2" } });
  const p2 = await svc.prepare(svc.situate(r2), { requestId: "kd2" });
  const system = String(r2.body.system);
  assert.ok(system.includes(`session ${p1.chain}`) && !others.some((id) => system.includes(id)), system.slice(-1500));
  const links = svc.archive.linksFor(p2.chain).filter((/** @type {any} */ l) => l.type === "continues");
  assert.deepEqual(links.map((/** @type {any} */ l) => l.dst), [p1.chain], JSON.stringify(links));
});

// (fails before: yes — "continue where we left off" linked the chat to the project's newest one, its parent set, by the
// person's words; and an agent that loaded an earlier session to go on with it left no link: the memory plan's c3)
test("the person's words link no session; the agent's load of a session of its project in the chat's first turn links that one, once", async () => {
  const cwd = "C:\\loaded";
  const p1 = await svc.prepare(svc.situate(req(["build the exporter for the ledger"], { cwd, headers: { ...CC_UA, "x-session-id": "ld-1" } })), { requestId: "ld1" });
  const p0 = await svc.prepare(svc.situate(req(["draft the importer for the ledger"], { cwd, headers: { ...CC_UA, "x-session-id": "ld-0" } })), { requestId: "ld0" });
  const p2 = await svc.prepare(svc.situate(req(["continue where we left off with the exporter"], { cwd, headers: { ...CC_UA, "x-session-id": "ld-2" } })), { requestId: "ld2" });
  const continues = (/** @type {string} */ id) => svc.archive.linksFor(id).filter((/** @type {any} */ l) => l.type === "continues" && l.src === id).map((/** @type {any} */ l) => l.dst);
  assert.deepEqual(continues(p2.chain), [], "the words linked nothing");
  assert.equal(p2.notes.some((/** @type {string} */ n) => /continues/.test(n)), false, p2.notes.join(" | "));
  const sit2 = svc.situate(req(["continue where we left off with the exporter"], { cwd, headers: { ...CC_UA, "x-session-id": "ld-2" } }));
  const model = svc.scope({ role: "model", project: sit2.project.id, chain: p2.chain, turn: p2.turn });
  assert.ok(model.load(p1.chain, { view: "chat" }), "the earlier session loads");
  assert.deepEqual(continues(p2.chain), [p1.chain], "the session the agent loaded, not the project's newest");
  assert.equal(svc.archive.getChain(p2.chain).parent_id, p1.chain);
  model.load(p0.chain, { view: "chat" });
  assert.deepEqual(continues(p2.chain), [p1.chain], "once: a second load links no other");
  // A sub-agent's load, and a load after the chat's first turn is finished, link nothing.
  const p3 = await svc.prepare(svc.situate(req(["write the exporter's tests"], { cwd, headers: { ...CC_UA, "x-session-id": "ld-3" } })), { requestId: "ld3" });
  svc.scope({ role: "agent", project: sit2.project.id, chain: p3.chain, conversation: "sub-1" }).load(p1.chain, { view: "chat" });
  assert.deepEqual(continues(p3.chain), [], "a sub-agent's load");
  svc.afterReply({ chainId: p3.chain, turnId: p3.turn, requestId: "ld3", finalMessage: { role: "assistant", content: [{ type: "text", text: "Tests written." }] }, replyText: "Tests written.", outputChars: 14 });
  svc.scope({ role: "model", project: sit2.project.id, chain: p3.chain }).load(p1.chain, { view: "chat" });
  assert.deepEqual(continues(p3.chain), [], "after the first turn");
});

// (fails before: yes — a harness chat whose first words were "continue …" was linked to the project's newest chat, its
// briefing said it continued that effort, and the agent loaded the last chat's work first: the owner's of 11-05)
test("a harness chat's \"continue\" is the person's word to it: no link to the project's newest chat, no effort it continues; the memory words never send the agent to load a past session by itself", async () => {
  const cwd = "C:\\own-continue";
  const p1 = await svc.prepare(svc.situate(req(["build the release pipeline"], { cwd, headers: { ...CC_UA, "x-session-id": "own-cont-1" } })), { requestId: "oc1" });
  const r2 = req(["continue with the pipeline checks"], { cwd, headers: { ...CC_UA, "x-filament-client": "harness", "x-session-id": "own-cont-2" } });
  const sit2 = svc.situate(r2);
  assert.equal(sit2.client, "harness");
  const p2 = await svc.prepare(sit2, { requestId: "oc2" });
  assert.deepEqual(svc.archive.linksFor(p2.chain).filter((/** @type {any} */ l) => l.type === "continues"), [], "no continues link");
  const system = String(r2.body.system);
  assert.ok(!system.includes("This session continues an effort"), system.slice(-1500));
  assert.ok(system.includes(`session ${p1.chain}`), "the earlier chat is still named among the recent sessions, for reference");
  assert.ok(system.includes("never load one on your own to pick up its work") && !system.includes("when you start on a project"), system.slice(-1200));
  const defs = memoryToolDefs("anthropic");
  const words = (/** @type {string} */ n) => String(defs.find((/** @type {any} */ d) => d.name === n)?.description || "");
  assert.ok(words("filament_memory_search").includes("Use it when the user refers to earlier work") && !words("filament_memory_search").includes("when you start on a project"));
  assert.ok(words("filament_memory_load").includes("Never load a past session on your own to pick up its work"));
});

test("status and api helpers", async () => {
  const st = await svc.status({ probe: true }); assert.equal(st.enabled, true); assert.equal(st.engine.version, "fake-3.15.1"); assert.ok(st.archive.chains >= 3); assert.equal(st.summarizer, "claude-haiku-4-5");
  const found = await svc.scope({ role: "owner" }).search("tray watchdog"); assert.ok(found.length >= 1, JSON.stringify(found));
  const sessions = svc.sessions("tray"); assert.ok(sessions.length >= 1); const detail = svc.session(sessions[0].id); assert.ok(detail.turns.length >= 1); assert.ok(detail.rendered.text);
  assert.ok(svc.items({ status: "inferred" }).length >= 1 || svc.items({}).length >= 1);
  assert.equal(svc.identity()[0].name, "name");
});

// HarnessV3-Memory MD-1: superseded, not dismissed — kept with the correction as its replacement, and the engine copy
// invalidated (pointing at the replacement), never deleted. What the person says reaches memory as the agent keeps it,
// quoting them (the memory plan's d1, d3): their preference, then their correction of it.
test("a correction supersedes what it contradicts: the old item is kept as superseded and its engine twin invalidated", async () => {
  const opsLog = join(dir, "sidecar-ops.jsonl");
  const said1 = "I always use pnpm for package installs in this project";
  const r1 = req([said1], { cwd: "C:\\supersede" });
  const sit1 = svc.situate(r1); const proj = sit1.project.id;
  const prep1 = await svc.prepare(sit1, { requestId: "su1" });
  const kept = await svc.brain.remember(said1, { kind: "preference", projectId: proj, chainId: prep1.chain, turnId: prep1.turn, by: "model", quote: said1 });
  assert.equal(kept.heard, true, JSON.stringify(kept));
  let old = null;
  for (let i = 0; i < 40; i++) { old = svc.archive.items.list({ projectId: proj, kind: "preference" }).find((p) => /pnpm/.test(p.text)); if (old?.memory_id) break; await new Promise((r) => setTimeout(r, 50)); }
  assert.ok(old?.memory_id, "the preference was mirrored to the engine");
  const said2 = "no, we switched to bun for package installs now";
  const r2 = req([said1, said2], { cwd: "C:\\supersede" });
  const prep2 = await svc.prepare(svc.situate(r2), { requestId: "su2" });
  const fixed = await svc.brain.correct(`i${old.id}`, { text: "we switched to bun for package installs now", chainId: prep2.chain, turnId: prep2.turn, by: "model", quote: "we switched to bun for package installs now" });
  assert.equal(fixed.heard, true, JSON.stringify(fixed));
  const rule = svc.archive.items.list({ projectId: proj, kind: "preference" }).find((x) => /bun/.test(x.text));
  assert.ok(rule, "the correction itself is stored, of the kind it corrects");
  assert.equal(rule.origin, "correction", "the user's correction");
  const now = svc.archive.items.get(old.id);
  assert.equal(now.status, "superseded", "the contradicted preference is kept, superseded");
  assert.equal(now.superseded_by, rule.id, "by the correction");
  await svc.brain.outbox.drain(); // the invalidate goes out through the outbox (HarnessV3-Memory M2-2)
  const ops = readFileSync(opsLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(ops.some((o) => o.op === "invalidate" && o.args.id === old.memory_id && o.args.replacement_id === `filament:i${rule.id}`), "its engine twin is invalidated, naming the replacement");
  assert.ok(!ops.some((o) => o.op === "forget" && o.args.id === old.memory_id), "and never deleted");
  const rr = await svc.brain.retrieve({ query: "pnpm package installs", projectId: proj, mode: "search" });
  assert.ok(!rr.items.some((x) => x.id === `i${old.id}`), "a superseded item is not retrieved any more");
});

// (fails before: yes — the rewrite was on by default, and a message's words — "again", "last week", "continue" — chose
// whether it ran: the memory plan's c3)
test("the rewrite is off by default; switched on, a query whose own words find little gets cheap-model variants merged into recall, whatever the words", async () => {
  const prev = svc.brain.callModel;
  /** @type {string[]} */
  const asked = [];
  svc.brain.callModel = async (/** @type {any} */ a) => (asked.push(a.purpose), '{"queries":["generic event bus refactor","event loop migration"]}');
  const opsLog = join(dir, "sidecar-ops.jsonl");
  const sawVariant = () => { try { return readFileSync(opsLog, "utf8").includes("generic event bus refactor"); } catch { return false; } };
  try {
    await svc.prepare(svc.situate(req(["didn't I already try the bus refactor last week?"], { cwd: "C:\\rewrite-off" })), { requestId: "rw0" });
    assert.equal(asked.includes("recall") || sawVariant(), false, "off: no rewrite call");
    cfg.memory.autopilot.rewrite = true;
    const prep = await svc.prepare(svc.situate(req(["the bus refactor for the message pump"], { cwd: "C:\\rewrite" })), { requestId: "rw1" });
    assert.equal("pastRef" in prep.signals, false);
    let saw = false;
    for (let i = 0; i < 40 && !(saw = sawVariant()); i++) await new Promise((x) => setTimeout(x, 50));
    assert.ok(saw, "the rewritten query reached the engine's recall, on a message that names no past");
  } finally { svc.brain.callModel = prev; delete cfg.memory.autopilot.rewrite; }
});

// HarnessV3-AtHome AH-D1: with memory on for everyone, the conversations in no folder are every app's and every chat's.
// (fails before: yes — the invoice app's conversation was linked as the newsletter app's continuation, its parent set)
test("a request in no folder continues no session by itself: no folder, no project to continue in", async () => {
  const appReq = (text, ua) => ({ format: "anthropic", body: { model: "claude-x", max_tokens: 100, system: "You help.", messages: [{ role: "user", content: text }] }, headers: { "user-agent": ua }, model: "claude-x" });
  const prepA = await svc.prepare(svc.situate(appReq("draft the quarterly newsletter", "newsletter-app/1.0")), { requestId: "nf1" });
  const sitB = svc.situate(appReq("This session is being continued from a previous conversation. Summary: the invoice parser reads PDFs now.", "invoice-app/2.0"));
  const prepB = await svc.prepare(sitB, { requestId: "nf2" });
  assert.notEqual(prepB.chain, prepA.chain);
  assert.equal(sitB.position, "afterCompaction", "a continuation, as a client's compaction opens one");
  assert.ok(!prepB.notes.some((n) => /continues/.test(n)), prepB.notes.join(" | "));
  assert.ok(!svc.archive.linksFor(prepB.chain).some((l) => l.type === "continues"), "no link to another app's conversation");
  assert.equal(svc.archive.getChain(prepB.chain).parent_id ?? null, null, "and no parent");
});

test("lineage: briefings name the effort's arc, sessions carry continues, load lineage renders the line, the session never cites itself", async () => {
  const A = req(["fix the rate limiter"], { cwd: "C:\\lineage", headers: { ...CC_UA, "x-session-id": "lin-1" } });
  const sitA = svc.situate(A); const prepA = await svc.prepare(sitA, { requestId: "ln1" });
  svc.afterReply({ chainId: prepA.chain, turnId: prepA.turn, requestId: "ln1", finalMessage: { role: "assistant", content: [{ type: "text", text: "Token bucket done." }] }, replyText: "Token bucket done.", outputChars: 18 });
  svc.archive.setState(prepA.chain, { status: "open", summary: "token bucket done", open: ["redis backoff"] });
  const B = req(["This session is being continued from a previous conversation. Summary: token bucket done; redis backoff is open."], { cwd: "C:\\lineage", headers: { ...CC_UA, "x-session-id": "lin-2" } });
  const prepB = await svc.prepare(svc.situate(B), { requestId: "ln2" });
  assert.ok(prepB.notes.some((n) => /continues/.test(n)), prepB.notes.join(" | "));
  assert.ok(B.body.system.includes("continues an effort"), `arc in the briefing: ${B.body.system.slice(0, 300)}`);
  svc.archive.setState(prepB.chain, { status: "open", summary: "redis backoff added" });
  const C = req(["This session is being continued from a previous conversation. Summary: redis backoff added; docs next."], { cwd: "C:\\lineage", headers: { ...CC_UA, "x-session-id": "lin-3" } });
  const sitC = svc.situate(C); const prepC = await svc.prepare(sitC, { requestId: "ln3" });
  assert.ok(prepC.notes.some((n) => /continues/.test(n)));
  assert.ok(C.body.system.includes("continues an effort"), "the arc names both ancestors");
  assert.ok(C.body.system.includes(prepA.chain), "the arc reaches back to the first session");
  // sessions list carries the lineage pointer; load lineage renders all three, oldest first
  const listed = svc.brain.sessions("redis backoff", { limit: 10 });
  const rowB = listed.find((s) => s.id === prepB.chain); assert.ok(rowB?.continues === prepA.chain, "sessions() exposes continues");
  const arc = svc.brain.load(prepC.chain, { view: "lineage", budgetTokens: 4000 });
  assert.equal(arc.sessions, 3); assert.ok(arc.text.includes("this session")); assert.ok(arc.text.indexOf(prepA.chain) < arc.text.indexOf(prepB.chain), "oldest first");
  // the current session is never its own related memory
  const withSelf = await svc.brain.retrieve({ query: "redis backoff added docs", projectId: sitC.project.id, mode: "search" });
  const without = await svc.brain.retrieve({ query: "redis backoff added docs", projectId: sitC.project.id, mode: "search", excludeChainId: prepC.chain });
  assert.ok(withSelf.items.some((x) => x.chainId === prepC.chain), "sanity: the session's own words are in the index");
  assert.ok(!without.items.some((x) => x.chainId === prepC.chain), "excludeChainId removes the current session");
  // the tool schema advertises the lineage view; @mem load accepts it
  assert.ok(memoryToolDefs("anthropic")[2].input_schema.properties.view.enum.includes("lineage"));
  const sLin = svc.situate(req(["@mem sessions rate limiter"], { cwd: "C:\\lineage", headers: { ...CC_UA, "x-session-id": "lin-3" } }));
  const ss = await memoryCommand(svc, "@mem sessions rate limiter", sLin); assert.ok(/1\. `/ .test(ss.text), ss.text);
  const ld = await memoryCommand(svc, "@mem load 1 lineage", sLin); assert.ok(/lineage of /.test(ld.text), ld.text);
});

// (fails before: yes — the rewrite was given up after `rewriteTimeoutMs` (80 ms here), its slow answer thrown away;
// the setting stays as that condition, and nothing reads it now — HarnessV3-FailurePoints FP-D4)
test("the rewrite runs on memory's model; its call is waited for, and a failed one yields no variants", async () => {
  cfg.memory.autopilot.rewriteTimeoutMs = 80;
  const seen = [];
  const prev = svc.brain.callModel;
  const asked = "didn't we already try the generic event bus migration last week?";
  try {
    svc.brain.callModel = async (a) => { seen.push(a); await new Promise((r) => setTimeout(r, 400)); return JSON.stringify({ queries: ["pubsub broker refactor"] }); };
    assert.deepEqual(await svc.brain.rewriteQueries(asked), ["pubsub broker refactor"], "a slow rewrite's variants are used");
    svc.brain.callModel = async (a) => { seen.push(a); throw new Error("the provider failed"); };
    assert.deepEqual(await svc.brain.rewriteQueries(asked), [], "a failed rewrite yields no variants");
    assert.equal(seen.length, 2);
  } finally { svc.brain.callModel = prev; delete cfg.memory.autopilot.rewriteTimeoutMs; }
});

test("projects, lineage graph, turn detail, injection items and the project filter are served", async () => {
  // a two-session lineage in its own project
  const r1 = req(["start the graph walk in a fresh folder"], { cwd: "C:\\graph", headers: { ...CC_UA, "x-session-id": "gr-1" } });
  const sit1 = svc.situate(r1); const prep1 = await svc.prepare(sit1, { requestId: "gr1" });
  svc.afterReply({ chainId: prep1.chain, turnId: prep1.turn, requestId: "gr1", finalMessage: { role: "assistant", content: [{ type: "text", text: "The walk started." }] }, replyText: "The walk started.", outputChars: 17 });
  const r2 = req(["This session is being continued from a previous conversation. Summary: the graph walk started."], { cwd: "C:\\graph", headers: { ...CC_UA, "x-session-id": "gr-2" } });
  const prep2 = await svc.prepare(svc.situate(r2), { requestId: "gr2" });
  // projects
  const ps = svc.projects(); const proj = ps.find((p) => (p.cwd || "").toLowerCase().includes("graph"));
  assert.ok(proj, "the project exists"); assert.ok(proj.chains >= 2 && proj.turns >= 1); assert.equal(proj.dossier, null, "no dossier until the curator writes one");
  assert.equal(svc.dossier(proj.id)?.version, null, "until then it is rendered from the project's claims"); assert.equal(svc.dossier("no-such-project"), null);
  // lineage
  const lin = svc.lineage(prep2.chain);
  assert.equal(lin.nodes.length, 2);
  assert.ok(lin.nodes.some((n) => n.id === prep1.chain) && lin.nodes.some((n) => n.id === prep2.chain));
  assert.ok(lin.nodes.find((n) => n.id === prep2.chain).current); assert.equal(lin.nodes.find((n) => n.id === prep1.chain).depth, -1);
  assert.ok(lin.edges.some((e) => e.src === prep2.chain && e.dst === prep1.chain && e.type === "continues"));
  // (fails before: yes — a node carried its title alone, so the console's graph called an untitled session "untitled"
  // where its list names it by its first message: HarnessV3-Launch F14)
  const untitled = lin.nodes.find((n) => n.id === prep1.chain);
  assert.equal(untitled.title, null);
  assert.equal(untitled.preview, "start the graph walk in a fresh folder", "an untitled session is named by its first message");
  svc.archive.setTitle(prep1.chain, "The graph walk");
  assert.equal(svc.lineage(prep2.chain).nodes.find((n) => n.id === prep1.chain).preview, null, "a titled one carries none, as the sessions list's rows");
  svc.archive.setTitle(prep1.chain, null);
  // turn detail
  const td = svc.turnDetail(prep1.turn);
  assert.ok(td.user.preview.includes("start the graph walk")); assert.ok(td.final.preview.includes("The walk started")); assert.equal(td.work.length, 0);
  // sessions filtered by project
  const only = svc.brain.sessions("", { limit: 50, project: proj.id });
  assert.ok(only.length >= 2 && only.every((s) => s.project === proj.id), "the filter holds");
  assert.ok(!svc.brain.sessions("", { limit: 50, project: "nope" }).some((s) => s.project === proj.id));
  // injection items resolve to text
  const inj = svc.archive.injections.recent(200).find((x) => (x.ids || []).length);
  assert.ok(inj, "some injection with ids exists");
  const items = await svc.injectionItems(inj.ids);
  assert.equal(items.length, inj.ids.length);
  assert.ok(items.some((it) => it.text), "at least one item resolved to text");
  assert.ok((await svc.injectionItems(["e:m-gone", "s:a1:1", "m-not-there"])).length === 3, "odd ids resolve to labelled rows");
});

test("the rewrite is conditional: a base query that already finds enough skips the model call; the load budget caps a request", async () => {
  const r1 = req(["seed the bun installer facts"], { cwd: "C:\\condrw", headers: { ...CC_UA, "x-session-id": "cr-1" } });
  const sit1 = svc.situate(r1); const prep1 = await svc.prepare(sit1, { requestId: "cr1" });
  svc.archive.items.add({ projectId: sit1.project.id, chainId: prep1.chain, turnId: prep1.turn, kind: "fact", text: "bun installer run scripts live in package.json", status: "confirmed", importance: 0.8 });
  svc.archive.items.add({ projectId: sit1.project.id, chainId: prep1.chain, turnId: prep1.turn, kind: "convention", text: "bun installer errors go to the tray log", status: "confirmed", importance: 0.7 });
  const prev = svc.brain.callModel; let calls = 0; const orig = svc.brain.callModel; svc.brain.callModel = async (...a) => { calls++; return orig(...a); };
  cfg.memory.autopilot.rewrite = true;
  try {
    const r2 = req(["seed the bun installer facts", "didn't we already fix the bun installer last week?"], { cwd: "C:\\condrw", headers: { ...CC_UA, "x-session-id": "cr-1" } });
    const prep2 = await svc.prepare(svc.situate(r2), { requestId: "cr2" });
    assert.equal(calls, 0, "no rewrite call: the base keywords already found the items (thin-query check)");
    assert.ok(prep2.injected >= 1, prep2.notes.join(" | "));
  } finally { svc.brain.callModel = prev; delete cfg.memory.autopilot.rewrite; }
  const model = svc.scope({ role: "model", project: sit1.project.id });
  const out = await executeMemoryTool(model, "filament_memory_load", { session: prep1.chain, view: "chat" }, { loadedTokens: 29990 });
  assert.ok(/budget/.test(String(out)), String(out).slice(0, 120));
  const tally = { loadedTokens: 0 };
  const ok2 = await executeMemoryTool(model, "filament_memory_load", { session: prep1.chain, view: "chat" }, tally);
  assert.ok(!String(ok2).startsWith('{"error"'), String(ok2).slice(0, 120));
  assert.ok(tally.loadedTokens > 0, "the request's tally counts what it loaded, for the next call's ceiling");
});

test("rules that act: an opted-in rule rides along with the tool result of a matching tool call", async () => {
  const r = req(["please restart Filament to pick up the change"], { cwd: "C:\\rules" });
  const sit = svc.situate(r); const prep = await svc.prepare(sit, { requestId: "ru1" });
  const it = svc.archive.items.add({ projectId: sit.project.id, chainId: prep.chain, turnId: prep.turn, kind: "rule", text: "Never restart Filament while a chat may be flowing; check /api/live first and use POST /api/shutdown.", status: "confirmed", importance: 0.9 });
  cfg.memory.rules = { act: [`i${it.id}`] };
  const leg = { format: "anthropic", body: { model: "claude-x", system: sys("C:\\rules"), messages: [{ role: "user", content: "please restart Filament to pick up the change" }, { role: "assistant", content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "taskkill /IM node.exe /F && node bin/filament.js restart" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "b1", content: "done" }] }] }, headers: CC_UA, model: "claude-x" };
  const sit2 = svc.situate(leg); const prep2 = await svc.prepare(sit2, { requestId: "ru2" });
  assert.equal(prep2.rules, 1, prep2.notes.join(" | ")); const last = leg.body.messages.at(-1); assert.ok(last.content.some((b) => b.type === "text" && b.text.includes('<filament-memory kind="rule">') && b.text.includes("Never restart Filament")));
  // an unrelated tool call gets nothing
  const leg2 = { format: "anthropic", body: { model: "claude-x", system: sys("C:\\rules"), messages: [{ role: "user", content: "please restart Filament to pick up the change" }, { role: "assistant", content: [{ type: "tool_use", id: "b2", name: "Read", input: { file_path: "README.md" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "b2", content: "text" }] }] }, headers: CC_UA, model: "claude-x" };
  const prep3 = await svc.prepare(svc.situate(leg2), { requestId: "ru3" }); assert.equal(prep3.rules, undefined);
  // (fails before: yes — a bare item number and an earlier build's item:<n> named the rule as well as i<n> does)
  for (const [k, ref] of [String(it.id), `item:${it.id}`].entries()) {
    cfg.memory.rules = { act: [ref] };
    const legN = { format: "anthropic", body: { model: "claude-x", system: sys("C:\\rules"), messages: [{ role: "user", content: "please restart Filament to pick up the change" }, { role: "assistant", content: [{ type: "tool_use", id: `b${k + 4}`, name: "Bash", input: { command: "taskkill /IM node.exe /F && node bin/filament.js restart" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: `b${k + 4}`, content: `done ${k}` }] }] }, headers: CC_UA, model: "claude-x" };
    const p = await svc.prepare(svc.situate(legN), { requestId: `ru${k + 4}` });
    assert.equal(p.rules, undefined, `${ref} names no rule: ${p.notes.join(" | ")}`);
  }
  delete cfg.memory.rules;
});

// (fails before: yes — only the old team engine's rounds were marked: a loop's tick that opened a chain was listed as
// the developer's task)
test("a loop's tick that opens a chain marks it internal — the session list leaves it out, `internal: all` shows it", async () => {
  const tick = req(["a loop's own round"], { headers: { ...CC_UA, "x-filament-agent-of": "parent-1", "x-session-id": "loop-parent-1" } });
  const pt = await svc.prepare(svc.situate(tick), { requestId: "t1" });
  assert.equal(svc.archive.getChain(pt.chain).meta.internal, "tick");
  assert.ok(!svc.sessions("", { limit: 100 }).map((s) => s.id).includes(pt.chain), "the sidebar's list leaves it out");
  assert.ok(svc.sessions("", { limit: 100, internal: "all" }).map((s) => s.id).includes(pt.chain), "the inspectors can still ask for it");
});

test("HarnessV2 P1: internal chains are typed as kinds; a project named from the harness must be a real folder; archive hides it", async () => {
  const tick = req(["a second loop round"], { headers: { ...CC_UA, "x-filament-agent-of": "parent-2", "x-session-id": "loop-parent-2" } });
  const pt = await svc.prepare(svc.situate(tick), { requestId: "t2" });
  assert.equal(svc.archive.getChain(pt.chain).kind, "tick", "the typed column the list filters on");
  assert.equal(svc.sessions("", { limit: 100, kinds: ["tick"] }).some((s) => s.id === pt.chain), true);
  // createProject: the folder must exist on this machine
  const missing = svc.createProject(join(dir, "does-not-exist"));
  assert.match(missing.error, /does not exist/);
  assert.match(svc.createProject("").error, /required/);
  const row = svc.createProject(dir);
  assert.equal(row.id.length, 12);
  assert.equal(row.cwd.toLowerCase().replace(/\\/g, "/"), dir.toLowerCase().replace(/\\/g, "/"));
  assert.ok(svc.projects({ canon: false }).some((p) => p.id === row.id && p.archived === false));
  assert.deepEqual(svc.archiveProject(row.id, true), { id: row.id, archived: true });
  assert.ok(svc.projects({ canon: false }).find((p) => p.id === row.id).archived);
  assert.match(svc.archiveProject("nope", true).error, /no such project/);
});

test("HarnessV2 P3: the session's document on sit.settings gates memory for that request — briefing off, turn block off, tools off, learn off", async () => {
  await svc.store.remember({ content: "The build uses esbuild with a custom loader for .glsl files.", source: "fact", importance: 0.8, metadata: { kind: "fact" } });
  const doc = (memory, privacy = {}) => ({ memory: { enabled: true, briefing: true, turnBlock: true, tools: true, turnTokens: 300, minScore: 0.2, learn: true, index: true, ...memory }, privacy: { learn: true, index: true, ...privacy } });
  // settingsFor: the document over the config; learn needs both switches.
  const s0 = svc.brain.settingsFor({ settings: doc({ tools: false, turnTokens: 0, minScore: 0.9 }) });
  assert.equal(s0.auto.tools, false); assert.equal(s0.auto.turnTokens, 0); assert.equal(s0.auto.minScore, 0.9); assert.equal(s0.capture.learn, true);
  assert.deepEqual(s0.session, { briefing: true, turnBlock: true });
  assert.equal(svc.brain.settingsFor({ settings: doc({}, { learn: false }) }).capture.learn, false, "privacy.learn off = learn off");
  assert.equal(svc.brain.settingsFor({ settings: doc({ learn: false }) }).capture.learn, false);
  assert.equal(svc.brain.settingsFor({}).session, null, "no document: the config as it stands");
  // A fresh chain with the briefing and the turn block off: nothing placed, the notes say why, the tools stay off.
  const r1 = req(["no, never use esbuild's watch mode here, it double-builds the glsl loader; run the build once"], { cwd: "C:\p3-doc", headers: { ...CC_UA, "x-session-id": "p3-doc-1" } });
  const sit = svc.situate(r1);
  sit.settings = doc({ briefing: false, turnBlock: false, tools: false, learn: false });
  const prep = await svc.prepare(sit, { requestId: "p3-1", upstream: "anthropic" });
  assert.ok(prep.chain); assert.equal(prep.turnN, 1);
  assert.ok(!String(r1.body.system).includes(`<${MEMORY_TAG}`), "no briefing block in the system prompt");
  assert.equal(prep.briefing, 0); assert.equal(prep.injected, 0); assert.equal(prep.tools, false);
  assert.ok(!r1.body.messages.some((m) => typeof m.content === "string" && m.content.includes(`<${MEMORY_TAG} kind="turn">`)), "no per-turn block on the message");
  assert.ok(prep.notes.some((n) => /no briefing — the session turned it off/.test(n)), prep.notes.join(" | "));
  assert.ok(prep.notes.some((n) => /no per-turn recall — the session turned it off/.test(n)), prep.notes.join(" | "));
  assert.ok(!prep.notes.some((n) => /captured a/.test(n)), "learn off: the correction is not captured");
  assert.ok(!svc.archive.items.list({ kind: "rule" }).some((it) => /glsl/.test(it.text)), "no rule item from this message");
  // The same chain with the document back to defaults: the briefing is built now, the turn block looked up, the tools offered.
  const r2 = req(["no, never use esbuild's watch mode here, it double-builds the glsl loader; run the build once", "how does the esbuild glsl loader get configured?"], { cwd: "C:\p3-doc", headers: { ...CC_UA, "x-session-id": "p3-doc-1" } });
  const sit2 = svc.situate(r2);
  sit2.settings = doc({});
  const prep2 = await svc.prepare(sit2, { requestId: "p3-2", upstream: "anthropic" });
  assert.equal(prep2.chain, prep.chain);
  assert.equal(prep2.tools, true);
  assert.ok(String(r2.body.system).includes(`<${MEMORY_TAG} kind="briefing">`), "the briefing is placed once the switch is on");
  assert.ok(!prep2.notes.some((n) => /turned it off/.test(n)));
  // The early-return path (a quiet request on a chain that has a briefing): the briefing built earlier keeps riding by
  // default — the document's `memory.briefing: false` is the one thing that takes it off there too.
  const quietReq = () => req(["…", "how does the esbuild glsl loader get configured?", "and the watch mode?"], { cwd: "C:\p3-doc", headers: { ...CC_UA, "x-session-id": "p3-doc-1", "x-filament-memory": "off" } });
  const r3 = quietReq();
  const sit3 = svc.situate(r3);
  assert.equal(sit3.quiet, true);
  sit3.settings = doc({});
  const prep3 = await svc.prepare(sit3, { requestId: "p3-3", upstream: "anthropic" });
  assert.equal(prep3.quiet, true);
  assert.ok(String(r3.body.system).includes(`<${MEMORY_TAG} kind="briefing">`), "quiet keeps the briefing built earlier (the provider's cached prefix)");
  assert.ok(prep3.composition.briefing > 0, "the composition counts the placed briefing's tokens");
  const r4 = quietReq();
  const sit4 = svc.situate(r4);
  sit4.settings = doc({ briefing: false });
  const prep4 = await svc.prepare(sit4, { requestId: "p3-4", upstream: "anthropic" });
  assert.equal(prep4.quiet, true);
  assert.ok(!String(r4.body.system || "").includes(`<${MEMORY_TAG} kind="briefing">`), "memory.briefing: false takes the built briefing off the quiet path too");
  assert.equal(prep4.composition.briefing, 0);
  assert.ok(prep4.notes.some((n) => /no briefing — the session turned it off \(one built earlier is not placed\)/.test(n)), prep4.notes.join(" | "));
});

test("HarnessV2 P6 (F6): a proxied client's tool-loop legs join their turn — the loop so far as its work, the newest reply as its final; a replayed leg adds nothing twice; the next message opens the next turn", async () => {
  const H = { ...CC_UA, "x-session-id": "legs-1" };
  const U = { role: "user", content: "list the files in src and tell me the biggest" };
  const body = (messages) => ({ format: "anthropic", body: { model: "claude-x", max_tokens: 100, system: sys("C:\legs"), messages: structuredClone(messages) }, headers: H, model: "claude-x" });
  const R1 = { role: "assistant", content: [{ type: "text", text: "Let me look." }, { type: "tool_use", id: "u1", name: "Bash", input: { command: "ls -S src" } }] };
  const T1 = { role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: "a.js 10k\nb.js 2k" }] };
  const R2 = { role: "assistant", content: [{ type: "tool_use", id: "u2", name: "Read", input: { file_path: "src/a.js" } }] };
  const T2 = { role: "user", content: [{ type: "tool_result", tool_use_id: "u2", content: "export const a = 1;" }] };
  const R3 = { role: "assistant", content: [{ type: "text", text: "The biggest is a.js (10k)." }] };
  // Leg 1: the person speaks; the reply is a tool call, and it closes the turn as today.
  const prep1 = await svc.prepare(svc.situate(body([U])), { requestId: "lg-1" });
  assert.equal(prep1.newTurn, true); assert.equal(prep1.turnN, 1); assert.equal(prep1.legWork, undefined);
  svc.afterReply({ chainId: prep1.chain, turnId: prep1.turn, requestId: "lg-1", finalMessage: R1, replyText: "Let me look.", outputChars: 12 });
  const chainId = prep1.chain;
  assert.equal(svc.archive.getTurn(prep1.turn).work.length, 0);
  assert.equal(svc.archive.getChain(chainId).turns, 1);
  // Leg 2: the client resends with the tool result; the turn is found by its user message, the loop so far is its work.
  const sitL = svc.situate(body([U, R1, T1]));
  assert.equal(sitL.position, "toolLeg");
  const prepL = await svc.prepare(sitL, { requestId: "lg-2" });
  assert.equal(prepL.turn, prep1.turn); assert.equal(prepL.turnN, 1); assert.equal(prepL.newTurn, false);
  assert.deepEqual(prepL.legWork, [R1, T1]);
  assert.ok(prepL.notes.some((n) => /a tool-loop leg of turn 1 — the loop so far \(2 messages\) is archived as the turn's work/.test(n)), prepL.notes.join(" | "));
  svc.afterReply({ chainId, turnId: prepL.turn, requestId: "lg-2", finalMessage: R2, workMessages: prepL.legWork, replyText: "", outputChars: 0 });
  // Leg 3: the final answer.
  const prep3 = await svc.prepare(svc.situate(body([U, R1, T1, R2, T2])), { requestId: "lg-3" });
  // Only what the archive does not hold is handed on: R1 and T1 are the turn's work already, R2 its final.
  assert.equal(prep3.turn, prep1.turn); assert.deepEqual(prep3.legWork, [R2, T2]);
  assert.ok(prep3.notes.some((n) => /the loop so far \(4 messages\)/.test(n)), prep3.notes.join(" | "));
  svc.afterReply({ chainId, turnId: prep3.turn, requestId: "lg-3", finalMessage: R3, workMessages: prep3.legWork, replyText: "The biggest is a.js (10k).", outputChars: 27 });
  let t = svc.archive.getTurn(prep1.turn);
  assert.deepEqual(t.requestIds, ["lg-1", "lg-2", "lg-3"], "every leg's request is on the turn");
  assert.deepEqual(t.work.map((h) => svc.archive.getMessage(h).kind), ["tool_use", "tool_result", "tool_use", "tool_result"]);
  assert.deepEqual(svc.archive.getMessage(t.final_hash).message, R3, "the newest reply is the final");
  assert.equal(svc.archive.getChain(chainId).turns, 1, "one turn, counted once");
  // A replayed leg (the client retried) adds nothing twice.
  const prep3b = await svc.prepare(svc.situate(body([U, R1, T1, R2, T2])), { requestId: "lg-3b" });
  svc.afterReply({ chainId, turnId: prep3b.turn, requestId: "lg-3b", finalMessage: R3, workMessages: prep3b.legWork, replyText: "The biggest is a.js (10k).", outputChars: 27 });
  t = svc.archive.getTurn(prep1.turn);
  assert.equal(t.work.length, 4); assert.deepEqual(t.requestIds, ["lg-1", "lg-2", "lg-3", "lg-3b"]);
  // The next person-speaking message opens turn 2; a leg of it does not touch turn 1.
  const U2 = { role: "user", content: "thanks — now count its lines" };
  const prepN = await svc.prepare(svc.situate(body([U, R1, T1, R2, T2, R3, U2])), { requestId: "lg-4" });
  assert.equal(prepN.turnN, 2); assert.equal(prepN.newTurn, true); assert.equal(prepN.legWork, undefined);
  const R4 = { role: "assistant", content: [{ type: "tool_use", id: "u4", name: "Bash", input: { command: "wc -l src/a.js" } }] };
  svc.afterReply({ chainId, turnId: prepN.turn, requestId: "lg-4", finalMessage: R4, replyText: "", outputChars: 0 });
  const T4 = { role: "user", content: [{ type: "tool_result", tool_use_id: "u4", content: "1" }] };
  const prepN2 = await svc.prepare(svc.situate(body([U, R1, T1, R2, T2, R3, U2, R4, T4])), { requestId: "lg-5" });
  assert.equal(prepN2.turnN, 2); assert.deepEqual(prepN2.legWork, [R4, T4], "only the current turn's loop, not the whole history");
  assert.equal(svc.archive.getTurn(prep1.turn).work.length, 4);
  svc.afterReply({ chainId, turnId: prepN2.turn, requestId: "lg-5", finalMessage: { role: "assistant", content: [{ type: "text", text: "1 line." }] }, workMessages: prepN2.legWork, replyText: "1 line.", outputChars: 7 });
  // Phase 6's definition of done: the session truth's tool-leg count (the archive's) equals the transcript's
  // (what the timeline counts from the same turns) — turn 1 has two legs, turn 2 one.
  const truth = svc.sessionTruth(chainId);
  assert.equal(truth.activity.turns, 2); assert.equal(truth.activity.toolLegs, 3); assert.equal(truth.activity.workMessages, 6);
  // The archive counts each turn's work as it is written (`meta.tally`: what the page heads a turn with before it
  // reads the work), and the page counts the same from the work once read.
  const bodies = svc.archive.turnBodies(chainId);
  assert.deepEqual(bodies.map((x) => [x.meta.tally, x.workCount]), [[{ legs: 2, calls: 2 }, 4], [{ legs: 1, calls: 1 }, 2]]);
  const shown = turnsRead({ turns: bodies });
  assert.deepEqual(shown.map((x) => [x.toolLegs, x.toolCalls]), [[2, 2], [1, 1]]);
  assert.equal(shown.reduce((s, x) => s + x.toolLegs, 0), truth.activity.toolLegs, "the pane's tool legs equal the transcript's");
  // A quiet request (a loop's own tick) still archives nothing.
  const q = body([U, R1, T1]); q.headers = { ...H, "x-filament-memory": "off" };
  const prepQ = await svc.prepare(svc.situate(q), { requestId: "lg-q" });
  assert.equal(prepQ.turn ?? null, null); assert.equal(prepQ.legWork, undefined);
  // A leg whose person-speaking message matches an OLDER turn (turn 1's text again, with turn 2 newest) reopens
  // nothing: only the chain's newest turn can be continued, so turn 1 keeps its four work messages.
  const stale = await svc.prepare(svc.situate(body([U, R1, T1])), { requestId: "lg-stale" });
  assert.equal(stale.turn ?? null, null, "an older turn is never reopened by a look-alike leg");
  assert.equal(stale.legWork, undefined);
  assert.equal(svc.archive.getTurn(prep1.turn).work.length, 4);
  assert.deepEqual(svc.archive.getTurn(prep1.turn).requestIds, ["lg-1", "lg-2", "lg-3", "lg-3b"]);
  // A leg on a branch of the newest turn — the client edited a tool result (or rewound the loop) after the turn
  // finished — is not folded in: the turn keeps its work and its real answer, and the request says why.
  const T4e = { role: "user", content: [{ type: "tool_result", tool_use_id: "u4", content: "EDITED" }] };
  const branch = await svc.prepare(svc.situate(body([U, R1, T1, R2, T2, R3, U2, R4, T4e])), { requestId: "lg-branch" });
  assert.equal(branch.turn ?? null, null, "an edited history is a branch, not the turn");
  assert.equal(branch.legWork, undefined);
  assert.ok(branch.notes.some((n) => n.includes("does not continue turn 2 as archived (message 2 of the loop differs")), branch.notes.join(" | "));
  const t2 = svc.archive.getTurn(prepN.turn);
  assert.deepEqual(t2.work.map((h) => svc.archive.getMessage(h).message), [R4, T4], "turn 2's work is untouched");
  assert.equal(svc.archive.getMessage(t2.final_hash).message.content[0].text, "1 line.", "turn 2 keeps its real answer");
  // A leg that merely replays a prefix of the archived loop still agrees (a retry of leg 1 of turn 2).
  const prefix = await svc.prepare(svc.situate(body([U, R1, T1, R2, T2, R3, U2, R4, T4])), { requestId: "lg-prefix" });
  assert.equal(prefix.turn, prepN.turn);
});

test("HarnessV2 P6 (F6) in the OpenAI shape — what a Codex (Responses API) client becomes before the pipeline: tool_calls legs and role:tool results join their turn the same way", async () => {
  const H = { "user-agent": "codex_cli_rs/0.40.0", "x-session-id": "legs-oa-1" };
  const body = (messages) => ({ format: "openai", body: { model: "gpt-x", messages: [{ role: "system", content: "You are Codex.\nWorking directory: C:\\legs-oa" }, ...structuredClone(messages)] }, headers: H, model: "gpt-x" });
  const U = { role: "user", content: "count the files in src" };
  const A1 = { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "shell", arguments: "{\"command\":\"ls src\"}" } }] };
  const T1 = { role: "tool", tool_call_id: "c1", content: "a.js\nb.js" };
  const A2 = { role: "assistant", content: "Two files: a.js and b.js." };
  const p1 = await svc.prepare(svc.situate(body([U])), { requestId: "oa-1" });
  assert.equal(p1.newTurn, true);
  svc.afterReply({ chainId: p1.chain, turnId: p1.turn, requestId: "oa-1", finalMessage: A1, replyText: "", outputChars: 0 });
  const sitL = svc.situate(body([U, A1, T1]));
  assert.equal(sitL.position, "toolLeg");
  const pL = await svc.prepare(sitL, { requestId: "oa-2" });
  assert.equal(pL.turn, p1.turn); assert.deepEqual(pL.legWork, [A1, T1]);
  svc.afterReply({ chainId: p1.chain, turnId: pL.turn, requestId: "oa-2", finalMessage: A2, workMessages: pL.legWork, replyText: A2.content, outputChars: A2.content.length });
  const t = svc.archive.getTurn(p1.turn);
  assert.deepEqual(t.work.map((h) => svc.archive.getMessage(h).kind), ["tool_use", "tool_result"], "an OpenAI tool_calls message is a tool_use, a role:tool message a tool_result");
  assert.deepEqual(t.requestIds, ["oa-1", "oa-2"]);
  const truth = svc.sessionTruth(p1.chain);
  assert.equal(truth.activity.toolLegs, 1);
  const bodies = svc.archive.turnBodies(p1.chain);
  assert.deepEqual(bodies.map((x) => x.meta.tally), [{ legs: 1, calls: 1 }], "the archive counts the leg and its call as it writes them");
  const shown = turnsRead({ turns: bodies }, "openai");
  assert.deepEqual(shown.map((x) => [x.toolLegs, x.toolCalls]), [[1, 1]], "the transcript counts the same leg and call");
});

// (fails before: the status read the engine's state before its own probe, so a probe that woke the engine said
// "starting" about an engine that was ready)
test("a status probe reports the engine as the probe left it", async () => {
  const prev = svc.store;
  let state = "starting";
  svc.store = { status: () => ({ state }), ensure: async () => { state = "ready"; }, call: async () => ({ version: "probe-1" }), hello: null };
  try {
    const st = await svc.status({ probe: true });
    assert.equal(st.engine.state, "ready");
    assert.equal(st.engine.version, "probe-1");
  } finally {
    svc.store = prev;
  }
});
