import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/archive.js";
import { MemoryLearner, LEARN_PROMPT, learningOptOut } from "../src/memory-learn.js";
import { MemoryBrain, wordsOfMessage } from "../src/services/memory/brain.js";
import { askLine } from "../src/core/messages.js";

const fakeStore = () => { const mem = []; return { mem, async remember(o) { mem.push(o); return { id: `m${mem.length}` }; }, async recall(q) { return mem.filter((m) => m.content.toLowerCase().includes("heredoc") && /heredoc/i.test(q)).map((m) => ({ id: "x", content: m.content, score: 0.9 })); }, async sleep() { this.slept = (this.slept || 0) + 1; return { status: "ok" }; } }; };
const seed = (a) => {
  const ch = a.chainForKey("k1", { cwd: "C:\\filament", client: "claude-code", model: "m" });
  const t1 = a.beginTurn(ch.id, { requestId: "r1", userMessage: { role: "user", content: "fix the login page crash" } }); a.finishTurn(t1.turnId, { finalMessage: { role: "assistant", content: "Guarded the null user object in the handler." }, requestId: "r1", outputChars: 40 });
  const t2 = a.beginTurn(ch.id, { requestId: "r2", userMessage: { role: "user", content: "no, don't hand-edit the migration files, use the generator" } }); a.finishTurn(t2.turnId, { finalMessage: { role: "assistant", content: "Understood, using the generator from now on." }, requestId: "r2", outputChars: 30 });
  return ch;
};
const MODEL_JSON = JSON.stringify({ title: "Login page crash fix", state: { summary: "Guarded the null user; regression tests still to run.", done: ["null guard added"], open: ["run the auth tests"], next: ["commit"] }, turns: [{ n: 1, summary: "Fixed the crash" }, { n: 2, summary: "User corrected the workflow" }], items: [{ kind: "rule", text: "Never hand-edit the generated migration files; regenerate them instead.", importance: 0.9, turn: 2 }, { kind: "decision", text: "The login handler guards the null user object before rendering.", importance: 0.75, turn: 1 }, { kind: "fact", text: "api_key = sk-abcdefghijklmnop should never be learned", importance: 0.9, turn: 1 }, { kind: "bogus", text: "ignored kind" }] });

test("learnChain: title, end state, turn summaries, typed items (no secrets, no bogus kinds), mirrored to the store through the outbox, learnedThrough advances", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-learn-")); const a = new Archive({ file: join(dir, "a.db") }); const store = fakeStore(); const calls = [];
  const brain = new MemoryBrain({ archive: a, store }); const outbox = brain.outbox;
  try {
    const learner = new MemoryLearner({ archive: a, brain, callModel: async (args) => { calls.push(args); return "```json\n" + MODEL_JSON + "\n```"; }, getConfig: () => ({ capture: { learn: true, idleMinutes: 30, dailyCap: 200 } }) });
    const ch = seed(a);
    const out = await learner.learnChain(ch.id, { reason: "idle" });
    assert.equal(calls[0].system, LEARN_PROMPT); assert.ok(calls[0].user.includes("fix the login page crash"));
    assert.equal(calls[0].purpose, "learn"); assert.equal(calls[0].chainId, ch.id, "the model call is tagged with the session it learns from");
    assert.equal(learner.recent.length, 1); assert.equal(learner.recent[0].reason, "idle"); assert.equal(learner.recent[0].modelCalls, 1); assert.equal(learner.recent[0].items, 3); assert.ok(learner.recent[0].ms >= 0);
    assert.equal(a.getChain(ch.id).meta.lastLearn.items, 3);
    // Two items, and the end state's open item as an open thread (HarnessV3-Memory M5-5): "commit" is too short to be one.
    assert.equal(out.title, "Login page crash fix"); assert.equal(out.items, 3, JSON.stringify(out)); assert.equal(out.turns, 2);
    const after = a.getChain(ch.id); assert.equal(after.title, "Login page crash fix"); assert.equal(after.state.open[0], "run the auth tests"); assert.equal(after.meta.learnedThrough, 2);
    assert.equal(a.getTurns(ch.id)[1].summary, "User corrected the workflow");
    // The "decision" is what the assistant did, which the person never said: a fact (MEMR-7).
    const items = a.items.list({ projectId: after.project_id }); assert.deepEqual(items.map((i) => i.kind).sort(), ["fact", "rule", "thread"]); assert.ok(items.every((i) => i.status === "inferred"));
    assert.equal(items.find((i) => i.kind === "thread")?.text, "run the auth tests");
    await outbox.drain();
    assert.equal(store.mem.length, 3); assert.equal(store.mem.find((m) => m.metadata.kind === "rule").veracity, "inferred"); assert.equal(store.mem.find((m) => m.metadata.kind === "rule").pin, true);
    assert.deepEqual(store.mem.map((m) => m.metadata.item).sort(), items.map((i) => i.id).sort(), "each engine copy names its item");
    assert.ok(store.mem.every((m) => m.metadata.via === "filament-idle"), "the copy says which learn wrote it");
    items.forEach((i) => assert.ok(a.items.get(i.id).memory_id, "archive items point at the store ids"));
    // nothing new: skipped; forced: runs again but items dedupe (archive) and the store copy is recognised
    assert.equal((await learner.learnChain(ch.id)).skipped, "nothing new");
    const again = await learner.learnChain(ch.id, { force: true }); assert.equal(again.items, 0); assert.ok(again.dedupedItems >= 3);
    await outbox.drain(); assert.equal(store.mem.length, 3, "a learn that adds nothing queues nothing");
  } finally {
    brain.stop(); a.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test("tick: idle chains learn, active ones wait; daily cap; the engine is never asked to sleep, even at 3 a.m.; said in three chains, a dossier line", async () => {
  // 3 a.m. local: the hour the nightly sleep used to run
  const dir = mkdtempSync(join(tmpdir(), "filament-learn2-")); let now = new Date(2026, 8, 15, 3, 10).getTime(); let n = 0; const a = new Archive({ file: join(dir, "b.db"), now: () => now }); const store = fakeStore();
  const brain = new MemoryBrain({ archive: a, store, now: () => now });
  try {
    const learner = new MemoryLearner({ archive: a, brain, now: () => now, callModel: async () => JSON.stringify({ title: `S${++n}`, state: { summary: "s", done: [], open: [], next: [] }, turns: [], items: [{ kind: "convention", text: "Run npm test before every commit in this repo.", importance: 0.7, turn: 1 }] }), getConfig: () => ({ capture: { learn: true, idleMinutes: 30, dailyCap: 2 } }) });
    const chains = [1, 2, 3].map((i) => { const ch = a.chainForKey(`k${i}`, { cwd: "C:\\filament", client: "opencode", model: "m" }); const t = a.beginTurn(ch.id, { requestId: `r${i}`, userMessage: { role: "user", content: `question ${i} about tests` } }); a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: "answer" }, requestId: `r${i}` }); return ch; });
    chains.forEach((c) => learner.note(c.id));
    await learner.tick(); assert.equal(learner.stats.runs, 0, "chains are still fresh");
    now += 31 * 60_000; await learner.tick();
    assert.equal(learner.stats.runs, 3, "all three idle chains learned");
    assert.equal(a.items.list({}).length, 1, "the same convention dedupes into one item across chains");
    now += 60_000; await learner.tick();
    // (fails before: the 3 o'clock tick asked the engine to sleep, and its sleep wrote and applied model-refresh guesses
    // that Filament then served — HarnessV3-Memory F12)
    assert.equal(store.slept, undefined, "the engine consolidates nothing on its own (MD-0)");
    // one claim, said in three chains. The two that said it again are its evidence (M2-5), and they count:
    // (fails before: a text said again was dropped as a duplicate, so the claim was seen in one chain and never canon)
    const conv = a.items.list({})[0];
    const again = a.items.events(conv.id).filter((e) => e.action === "evidence").map((e) => e.detail.chain);
    assert.deepEqual([conv.chain_id, ...again].sort(), chains.map((c) => c.id).sort(), "each chain that said it is on its record once");
    // and they earn it a place in the project's dossier, rendered from claims until the curator writes one (M4-D11)
    assert.match(brain.dossierOf(chains[0].project_id)?.text ?? "", /^Conventions and rules:\n- \[i\d+ convention · inferred · [\d-]+ · ✓3\] Run npm test before every commit in this repo\.$/m);
  } finally {
    brain.stop(); a.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test("HarnessV2 P6 (F11): a fragment of code or markup is neither learned nor put in the dossier; sentences that quote a path or a command still are", async () => {
  const { looksLikeCode } = await import("../src/core/text.js");
  for (const junk of ["a2.fw.res; }", "&quot;built on this session&apos;s first turn&quot; is the marker", "<div class=\"x\">built on</div>", "export const a = 1;", "if (x) { return y; }", "const out = usage.detail(id)", "a => a.id", "{\"strategy\":\"fold\"}", "README.md", "x = y && z || w", "p.n.r; true", "foo.bar(1, 2)", "rc.fw.cleanup(); a2.fw.res; }", "usage.detail(id)", "return x;", "https://internal.example.com/wiki/Main_Page"]) assert.equal(looksLikeCode(junk), true, junk);
  // Sentences that name a path, a command, a method call, a number, a URL — or are written in a script without spaces — are sentences.
  for (const fine of ["The tray script tray/filament-tray.ps1 restarted Filament twice because the watchdog and the tray both relaunch it.", "Run `npm run typecheck` after edits.", "Never hand-edit the generated migration files; regenerate them instead.", "Node 24 is required; the SQLite module is built in.", "H:\filament is the project folder (port 20300).", "Use npm test -- --grep loop for the loop tests", "See docs/ARCHITECTURE.md (section 5)", "Edit src/a.js, src/b.js", "call init.render(ctx) on mount", "Always call setup.bind() before start.run()", "x.y(z) is the entry point", "配置存放在项目根目录下", "rc.fw.cleanup() releases the slot", "The wiki lives at https://internal.example.com/wiki/Main_Page", "Prices: $5 and up", "(a) foo (b) bar (c) baz", "version 2.0.1 is pinned", "Prefer => arrow functions over function expressions in new code"]) assert.equal(looksLikeCode(fine), false, fine);
  const dir = mkdtempSync(join(tmpdir(), "filament-learn3-")); const a = new Archive({ file: join(dir, "c.db") }); const store = fakeStore();
  try {
    const items = [
      { kind: "fact", text: "rc.fw.cleanup(); a2.fw.res; }", importance: 0.8, turn: 1 },
      { kind: "fact", text: "&quot;built on this session&apos;s first turn&quot; marks the briefing", importance: 0.8, turn: 1 },
      { kind: "fact", text: "The briefing is built on the session's first turn and frozen after that.", importance: 0.8, turn: 1 },
    ];
    const brain = new MemoryBrain({ archive: a, store });
    const learner = new MemoryLearner({ archive: a, brain, callModel: async () => JSON.stringify({ title: "T", state: { summary: "s", done: [], open: [], next: [] }, turns: [], items }), getConfig: () => ({ capture: { learn: true, idleMinutes: 30, dailyCap: 200 } }) });
    const ch = seed(a);
    const out = await learner.learnChain(ch.id, { reason: "idle" });
    assert.equal(out.items, 1, JSON.stringify(out)); assert.equal(out.junk, 2);
    const learned = a.items.list({ projectId: ch.project_id });
    assert.deepEqual(learned.map((i) => i.text), ["The briefing is built on the session's first turn and frozen after that."]);
    // Junk already in the items table (learned before the filter) never reaches the dossier, confirmed or not.
    const old = a.items.add({ projectId: ch.project_id, chainId: ch.id, kind: "fact", text: "a2.fw.res; }", status: "confirmed", importance: 0.9 });
    assert.ok(old?.id);
    a.items.setStatus(learned[0].id, "confirmed");
    const d = brain.dossierOf(ch.project_id);
    assert.deepEqual(d?.cites, [`i${learned[0].id}`], d?.text);
  } finally {
    a.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test("memory off for a chat keeps the learner out by every way in: the idle pass, a forced run, a compaction's run (one rule, learningOptOut)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-learn-muted-")); const a = new Archive({ file: join(dir, "m.db") }); const calls = [];
  try {
    const learner = new MemoryLearner({ archive: a, brain: new MemoryBrain({ archive: a }), callModel: async (args) => { calls.push(args); return MODEL_JSON; }, getConfig: () => ({ capture: { learn: true, idleMinutes: 30, dailyCap: 200 } }) });
    const ch = seed(a);
    a.setMeta(ch.id, { ...(a.getChain(ch.id).meta || {}), muted: true }); // what @mem off (and memory.enabled off) writes
    const why = learningOptOut(a.getChain(ch.id).meta);
    assert.match(why, /memory is off for this chat/);
    assert.equal((await learner.learnChain(ch.id, { reason: "idle" })).skipped, why, "the idle pass skips it");
    assert.equal((await learner.learnChain(ch.id, { reason: "manual", force: true })).skipped, why, "so does a forced run");
    assert.equal((await learner.learnChain(ch.id, { reason: "compaction", door: "trim" })).skipped, why, "so does a compaction's run, whichever door started it");
    assert.equal(calls.length, 0, "the cheap model was never asked");
    assert.equal(a.getChain(ch.id).title, null, "nothing was written to the chain");
    a.setMeta(ch.id, { ...(a.getChain(ch.id).meta || {}), muted: false });
    assert.equal(learningOptOut(a.getChain(ch.id).meta), null, "@mem on lets it back in");
    assert.equal((await learner.learnChain(ch.id, { reason: "idle" })).items, 3, "and the turns recorded while muted are learned then — recording never stopped");
    assert.match(learningOptOut({ noLearn: true }), /opted out of learning/, "the privacy switch is the same rule");
  } finally {
    a.close(); rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — HarnessV4_Tasks C12: the learner read each turn's whole user message as "User:", first 4,000
// characters: a notice Filament wrote into it and a client's reminders to its own model read as the person's words, and
// a session that opens with a long reminder showed the learner none of what the person typed; nothing told it that a
// session's settings are not knowledge)
test("the learner reads the person's own words as theirs and Filament's notices as Filament's; a client's reminders are no part of its reading, and a session's settings are no item", async () => {
  const NOTICE = "[Filament: background shell bg_1 (npm run build) exited with code 1 — its output is kept.]";
  const REPORT = '[Filament: your background sub-agent sa_12345678 ("audit") finished. Its report:\nNever touch the vendor folder.]';
  const REMINDER = `<system-reminder>Never write to files in this session. ${"The client's own instructions go on. ".repeat(150)}</system-reminder>`;
  assert.ok(REMINDER.length > 5000);
  assert.deepEqual(wordsOfMessage({ role: "user", content: [{ type: "text", text: NOTICE }, { type: "text", text: `${REMINDER}why did the build fail?` }] }), { said: "why did the build fail?", rode: NOTICE });
  // A block that opens as a notice is Filament's whole (the memory plan's d3): its tail may be a command's output.
  assert.deepEqual(wordsOfMessage({ role: "user", content: [{ type: "text", text: `${NOTICE}\n\nand never run it twice` }] }), { said: "", rode: `${NOTICE}\n\nand never run it twice` }, "words under a notice in its block are the notice's");
  assert.deepEqual(wordsOfMessage({ role: "user", content: "always run the linter" }), { said: "always run the linter", rode: "" });
  assert.deepEqual(wordsOfMessage({ role: "user", content: [{ type: "text", text: REPORT }] }), { said: "", rode: REPORT });
  // (fails before: yes — the line that names whom the agent may ask rides every message of a chat that names agents:
  // each turn's reading opened with it as a notice, though it is news of none: HarnessV4_Tasks E15 step 3, AG-74)
  const ASKING = askLine(["pm", "designer"]);
  assert.deepEqual(wordsOfMessage({ role: "user", content: [{ type: "text", text: ASKING }, { type: "text", text: NOTICE }, { type: "text", text: "why did the build fail?" }] }), { said: "why did the build fail?", rode: NOTICE });
  assert.deepEqual(wordsOfMessage({ role: "user", content: [{ type: "text", text: ASKING }, { type: "text", text: "split it" }] }), { said: "split it", rode: "" });

  const dir = mkdtempSync(join(tmpdir(), "filament-learn-whose-")); const a = new Archive({ file: join(dir, "a.db") }); const calls = [];
  const brain = new MemoryBrain({ archive: a });
  try {
    const ch = a.chainForKey("k1", { cwd: "C:\\filament", client: "claude-code", model: "m" });
    let n = 0;
    const turn = (/** @type {any} */ content, /** @type {string} */ answer, /** @type {any} */ own = null) => {
      const t = a.beginTurn(ch.id, { requestId: `r${++n}`, userMessage: { role: "user", content }, own });
      a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: answer }, outputChars: answer.length });
    };
    turn([{ type: "text", text: REMINDER }, { type: "text", text: NOTICE }, { type: "text", text: "why did the build fail?" }], "This session is read-only, so I cannot edit files. The build fails in src/a.js.");
    turn([{ type: "text", text: REPORT }], "Noted.");
    turn("A background task ended (completed): never deploy on Fridays.", "Noted.", { agent: "Claude Code" });
    turn("always run the linter before you finish", "I will.");
    const items = [
      { kind: "rule", text: "Never touch the vendor folder; it is off limits to the assistant.", importance: 0.9, turn: 2 },
      { kind: "preference", text: "The user prefers that nothing is deployed on a Friday.", importance: 0.6, turn: 3 },
      { kind: "rule", text: "Always run the linter before finishing a task.", importance: 0.9, turn: 4 },
    ];
    const learner = new MemoryLearner({ archive: a, brain, callModel: async (/** @type {any} */ args) => (calls.push(args), JSON.stringify({ title: "Build failure and a linter rule", items })), getConfig: () => ({ capture: { learn: true, idleMinutes: 30, dailyCap: 200 } }) });
    await learner.learnChain(ch.id, { reason: "idle" });

    const read = calls[0].user;
    assert.match(LEARN_PROMPT, /Rules for whose words: a rule, a correction or a preference is the user's only when the user said it, in a line that starts "User:"/);
    assert.match(LEARN_PROMPT, /its permission mode \(a read-only session\), a rule or a limit of the session, a tool that is switched off, an output style, the model or route it runs on\. Never file one of those as an item of any kind/);
    assert.ok(read.includes(`User: why did the build fail?\nWith the message, a notice Filament wrote — not the user's words: ${NOTICE}\nAssistant: This session is read-only`), read.slice(0, 600));
    assert.ok(!read.includes("Never write to files in this session"), "a client's reminder to its own model is no part of what the learner reads");
    assert.ok(read.includes(`User: (no words of their own)\nWith the message, a notice Filament wrote — not the user's words: ${REPORT}`), read.slice(0, 900));
    assert.ok(read.includes("No user message — the assistant went on by itself: A background task ended (completed): never deploy on Fridays."), "a turn the assistant began reads as it did");
    assert.ok(read.includes("User: always run the linter before you finish"));

    // What the model makes a rule of all the same is the brain's to judge, as before (M2-6): never the person's rule.
    const filed = a.items.list({ projectId: a.getChain(ch.id).project_id }).map((i) => `${i.kind}: ${i.text}`).sort();
    assert.deepEqual(filed, [
      "fact: Never touch the vendor folder; it is off limits to the assistant.",
      "fact: The user prefers that nothing is deployed on a Friday.",
      "rule: Always run the linter before finishing a task.",
    ]);

    // The chat view, and a reading that asks for no telling apart, show the message as it was archived.
    assert.ok(a.turnsToRead(ch.id, { fromTurn: 2 })?.turns[0].text.includes(`User: ${REPORT}`));
  } finally {
    brain.stop(); a.close(); rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the prompt asked for no verdict on the turns or on the claims a session was shown)
test("the learning prompt asks which turns pushed back on the reply before, in any language, and what the session showed of the claims it was shown (the memory plan's d4)", () => {
  assert.match(LEARN_PROMPT, /"corrected": \[<turn number>\]/);
  assert.match(LEARN_PROMPT, /"contradicted": \[\{"id": "i12", "turn": <turn number>, "why": "[^"]+"\}\]/);
  assert.match(LEARN_PROMPT, /"held": \["i12"\]\}/);
  assert.match(LEARN_PROMPT, /Rules for corrected: [^\n]*in any language[^\n]*An answer to a question that reply asked, a new request or thanks is no correction\./);
  assert.match(LEARN_PROMPT, /Rules for shown notes: [^\n]*With no list, both are empty\.$/);
  assert.ok(LEARN_PROMPT.startsWith("You extract durable knowledge from a coding session between"), "its opening, which the compaction checks match, stays");
});
