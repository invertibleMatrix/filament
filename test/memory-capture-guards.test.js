// What files a claim (BUG-27/28 follow-ups, the memory plan's d3). Nothing is filed from a message by its words: a
// correction, a preference, a decision, a "remember that" or a procedure the person types reaches memory as the agent
// keeps it with its memory tools, quoting them (d1), or by their own @mem command — so no list of words can make a
// pasted review's "never …" theirs, nor retire their memories (a fake correction dismissed seven real ones). An
// explicit remember of a dismissed text brings its item back; of one that stands, it keeps the one engine copy. What
// the person's own words of a message are (`ownWords`) is read still: the learner and the quote check use it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryService } from "../src/memory-service.js";
import { MemoryEngine } from "../src/memory-engine.js";
import { ownWords, PASTED_CHARS } from "../src/services/memory/brain.js";
import { executeMemoryTool } from "../src/memory-tools.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-sidecar.mjs", import.meta.url));
let dir, svc, cfg, opsLog;
const CC_UA = { "user-agent": "claude-cli/2.1.258 (external, cli)" };
const sys = (cwd) => `You are Claude Code.\n<env>\nWorking directory: ${cwd}\nIs a git repo: yes\n</env>`;
const req = (newest, cwd) => ({
  format: "anthropic",
  body: { model: "claude-x", max_tokens: 100, system: sys(cwd), messages: [{ role: "user", content: "let's get the release out" }, { role: "assistant", content: "ok" }, { role: "user", content: newest }] },
  headers: CC_UA,
  model: "claude-x",
});

before(() => {
  dir = mkdtempSync(join(tmpdir(), "filament-capguard-"));
  opsLog = join(dir, "sidecar-ops.jsonl");
  cfg = { server: { port: 20395, inboundKeys: ["k"] }, memory: { enabled: true, folder: join(dir, "memory"), engine: { embeddings: true, bank: "default" }, autopilot: { enabled: true, mode: "conservative", briefingTokens: 1200, turnTokens: 300, minScore: 0.2, tools: true, cue: true }, capture: { turns: true, learn: true }, commands: { enabled: true, prefix: "@mem" }, privacy: { encryptArchive: true }, models: { summarizer: "claude-haiku-4-5" } } };
  svc = new MemoryService({ getConfig: () => cfg, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20395" });
  svc.start();
  svc.store = new MemoryEngine({ command: process.execPath, args: [FAKE], env: { FAKE_SIDECAR_STATE: join(dir, "fake-state.json"), FAKE_SIDECAR_LOG: opsLog }, writeConfig: false });
  svc.brain.store = svc.store;
});
after(async () => {
  await svc.store?.stop?.();
  svc.stop();
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
});
const ops = (op) => {
  try {
    return readFileSync(opsLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((o) => o.op === op);
  } catch {
    return [];
  }
};

// (fails before: yes — capture filed a rule, a preference, a decision, a fact and a procedure from these messages' words,
// and a correction that opened one retired the claim it shared words with)
test("no message files a claim by its words, nor retires one: a correction, a preference, a decision, a remember, a procedure", async () => {
  const cwd = "C:\\capguard";
  const first = svc.situate(req("hello", cwd));
  const kept = svc.archive.items.add({ projectId: first.project.id, kind: "rule", text: "Run the tray watchdog check before every release build of the tray app.", status: "confirmed", importance: 0.9 });
  const said = [
    "no, don't run the tray watchdog check before release builds any more",
    "I always use pnpm for installs here.",
    "let's go with the yarn lockfile from now on",
    "remember that the release branch is cut every Thursday at noon",
    "remember how to deploy: npm run build; npm run ship",
    "Nein, benutze hier nicht npm, wir nehmen pnpm.",
  ];
  for (const [i, m] of said.entries()) {
    const prep = await svc.prepare(svc.situate(req(m, cwd)), { requestId: `cg-none-${i}` });
    assert.ok(!prep.notes.some((n) => /captured|supersedes|signal call/.test(n)), `${m}: ${prep.notes.join(" | ")}`);
  }
  const items = svc.archive.items.list({ projectId: first.project.id, limit: 50 });
  assert.deepEqual(items.map((it) => it.id), [kept.id], JSON.stringify(items.map((it) => [it.kind, it.text])));
  assert.equal(svc.archive.items.get(kept.id).status, "confirmed", "the owner's rule stands: the agent judges what a correction retires");
});

test("remembering a dismissed text brings it back with its own engine copy restored; a standing one keeps its single copy", async () => {
  const text = "The staging database is rebuilt every Sunday at 03:00 UTC.";
  const a = await svc.brain.remember(text, { kind: "fact", projectId: "p-capguard", by: "owner" });
  assert.equal(a.id, `i${a.itemId}`);
  await svc.brain.outbox.drain(); // the engine copy follows the item through the outbox (HarnessV3-Memory M2-2)
  const engineId = svc.archive.items.get(a.itemId).memory_id;
  assert.ok(engineId, "mirrored to the engine");
  await svc.brain.setItemStatus(a.itemId, "dismissed", { by: "owner" }); // dismissed on the Memories tab
  await svc.brain.outbox.drain();
  assert.ok(ops("invalidate").some((o) => o.args?.id === engineId), "its engine copy invalidated, not deleted");
  const b = await svc.brain.remember(text, { kind: "fact", projectId: "p-capguard", by: "owner" });
  assert.equal(b.itemId, a.itemId, "the same archive item");
  assert.equal(b.restored, true);
  assert.equal(svc.archive.items.get(a.itemId).status, "confirmed", "an explicit remember brings a dismissed item back");
  await svc.brain.outbox.drain();
  assert.ok(ops("restore").some((o) => o.args?.id === engineId), "its engine copy restored");
  assert.equal(svc.archive.items.get(a.itemId).memory_id, engineId, "the same engine copy, not a fresh one");
  const before = ops("remember").filter((o) => o.args?.content === text).length;
  assert.equal(before, 1, "one engine copy in all");
  const c = await svc.brain.remember(text, { kind: "fact", projectId: "p-capguard", by: "owner" });
  assert.equal(c.id, b.id, "the standing item answers with its id");
  await svc.brain.outbox.drain();
  assert.equal(ops("remember").filter((o) => o.args?.content === text).length, before, "no second engine copy of the same text");
});

// HarnessV3-FixRound F4 item 21 (Q3 (a)): text the owner pastes — another agent's review, a log, a quote — could still
// add a preference or rule when a sentence of it matched. Memory reads their own words only: a fenced block, a quoted
// line and a long block under their opening paragraph add nothing. Free; it misses some on purpose.
test("ownWords leaves out a fenced block, quoted lines and a long block under the opening paragraph", () => {
  assert.equal(ownWords("look at this:\n```\nwe always use yarn here\n```\nthoughts?"), "look at this:\nthoughts?");
  assert.equal(ownWords("look:\n~~~ts\nnever use pnpm\n~~~"), "look:");
  assert.equal(ownWords("an unclosed fence:\n```\nwe always use yarn here"), "an unclosed fence:", "an unclosed fence runs to the end");
  assert.equal(ownWords("see:\n```\n~~~\nwe always use yarn here\n```\nok?"), "see:\nok?", "a fence closes only on its own kind");
  assert.equal(ownWords("see:\n````\n```\nwe always use yarn here\n````\nok?"), "see:\nok?", "and only on one at least as long");
  assert.equal(ownWords("> we always use yarn here\n> said the other agent\nI disagree."), "I disagree.");
  const review = "Review complete. ".repeat(40) + "We always use yarn for installs.";
  assert.equal(ownWords(`here is the other agent's review:\n\n${review}`), "here is the other agent's review:", `${PASTED_CHARS} characters or more under the opening paragraph read as pasted`);
  const mine = "I always use pnpm here.\n\nAnd the tests run with node --test.";
  assert.equal(ownWords(mine), mine, "a short message of several paragraphs is the person's own");
  assert.equal(ownWords(review), review.trim(), "a paste with no opening line of theirs is read whole (a miss, by choice)");
});

// HarnessV3-Memory MD-1: bringing a retired memory back is the user's word, never a model's. The @mem command (the
// person) says it stands again; the remember tool (a model) leaves it retired and says so.
test("the @mem command says when a dismissed text stands again; the model's remember tool cannot bring it back", async () => {
  const text = "The nightly backup runs at 02:00 UTC on the archive host.";
  const a = await svc.brain.remember(text, { kind: "fact", projectId: "p-capguard-21b", by: "owner" });
  assert.equal(a.restored, undefined, "a new text was not brought back");
  await svc.brain.setItemStatus(a.itemId, "dismissed", { by: "owner" });
  const viaTool = JSON.parse(await executeMemoryTool(svc.scope({ role: "model", project: "p-capguard-21b" }), "filament_memory_remember", { text, kind: "fact" }));
  assert.equal(viaTool.stored, false, JSON.stringify(viaTool));
  assert.match(viaTool.note, /only the user can bring it back/);
  assert.equal(svc.archive.items.get(a.itemId).status, "dismissed", "still retired");
  const b = await svc.brain.remember(text, { kind: "fact", projectId: "p-capguard-21b", by: "person" });
  assert.equal(b.restored, true);
  assert.equal(svc.archive.items.get(a.itemId).status, "confirmed");
  const cmd = readFileSync(new URL("../src/app/commands/mem.js", import.meta.url), "utf8");
  assert.match(cmd, /r\.restored \? " — you had dismissed it; it stands again" : ""/);
});
