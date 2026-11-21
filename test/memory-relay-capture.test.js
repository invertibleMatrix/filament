// BUG-27: Filament's own relayed notices — a background sub-agent's report, which quotes the brief it was given — ride
// the next user message as text blocks of their own. Memory read them as the person speaking: a report's "JSON turns
// never touch it" fired the correction signal, the notice's own header ("stop follow-ups") became "Correction from the
// user: …", that fake correction superseded seven of the owner's real memories (their working rules among them), and a
// brief's "never commit" sentence became the owner's "preference". Memory now reads only the person's own words.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryService } from "../src/memory-service.js";
import { MemoryEngine } from "../src/memory-engine.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-sidecar.mjs", import.meta.url));
let dir, svc, cfg;
const CC_UA = { "user-agent": "claude-cli/2.1.258 (external, cli)" };
const sys = (cwd) => `You are Claude Code.\n<env>\nWorking directory: ${cwd}\nIs a git repo: yes\n</env>`;
/** A request whose newest user message is `content` (an array of blocks), after one earlier exchange. */
const req = (content, cwd) => ({
  format: "anthropic",
  body: { model: "claude-x", max_tokens: 100, system: sys(cwd), messages: [{ role: "user", content: "let's look at the stop fixes" }, { role: "assistant", content: "ok" }, { role: "user", content }] },
  headers: CC_UA,
  model: "claude-x",
});
const text = (t) => ({ type: "text", text: t });

// The two notices as Filament wrote them on 2026-09-30 (subagents.js deliver(): header, the brief's first 600
// characters, the report, the follow-up hint), cut down to the sentences that did the damage.
const RELAY_CODE =
  '[Filament: your background sub-agent sa_bde3f888 ("Code review: stop follow-ups + meter") finished. You asked it:\n' +
  "You are reviewing uncommitted fixes in Filament at H:\\filament. Job: verify the code and hunt real bugs. REVIEW ONLY: do NOT modify, create or delete files under H:\\filament; never commit; do not stop/restart the running Filament (port 20300 — you run inside it); do not kill processes.\n\n" +
  "Its report:\nReview complete. turn.js:558 — reply.ensureStart() runs only if (stream); JSON turns never touch it.\n\n" +
  'To ask it more in the same context, call agent with agent_id "sa_bde3f888".]';
const RELAY_UI =
  '[Filament: your background sub-agent sa_5c89308d ("UI/UX review: delivery, Detach, order") finished. You asked it:\n' +
  "You are the UI/UX reviewer for uncommitted changes to Filament's harness web UI. REVIEW ONLY: never commit; never use browser automation tools.\n\n" +
  'Its report:\nReview complete.\n\nTo ask it more in the same context, call agent with agent_id "sa_5c89308d".]';
// The owner's rule the fake correction dismissed (archive item 7 on the owner's machine).
const OWNER_RULE =
  "Owner's working rules for Filament: never commit (the owner commits); never use browser tools — take screenshots only with my own Node CDP scripts; after each phase spawn two sub-agents (one verifies the code and hunts bugs, one reviews the UI/UX), verify and fix their findings, and check that each fix's test fails with the fix removed. Gates: npx tsc --noEmit -p tsconfig.json, node --test \"test/*.test.js\", node scripts/gen-docs.js, and the ratchets; never stop the owner's own Filament process.";

before(() => {
  dir = mkdtempSync(join(tmpdir(), "filament-relaycap-"));
  cfg = { server: { port: 20397, inboundKeys: ["k"] }, memory: { enabled: true, folder: join(dir, "memory"), engine: { embeddings: true, bank: "default" }, autopilot: { enabled: true, mode: "conservative", briefingTokens: 1200, turnTokens: 300, minScore: 0.2, tools: true, cue: true }, capture: { turns: true, learn: true }, commands: { enabled: true, prefix: "@mem" }, privacy: { encryptArchive: true }, models: { summarizer: "claude-haiku-4-5" } } };
  svc = new MemoryService({ getConfig: () => cfg, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20397" });
  svc.start();
  svc.store = new MemoryEngine({ command: process.execPath, args: [FAKE], env: { FAKE_SIDECAR_STATE: join(dir, "fake-state.json"), FAKE_SIDECAR_LOG: join(dir, "sidecar-ops.jsonl") }, writeConfig: false });
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

test("relayed sub-agent reports are not the person speaking: nothing captured from them, nothing of the owner's superseded", async () => {
  const r = req([text(RELAY_CODE), text(RELAY_UI), text("how many sub agents did you launch because three have finished and two are still running")], "C:\\relay");
  const sit = svc.situate(r);
  assert.ok(sit, "situated");
  const kept = svc.archive.items.add({ projectId: sit.project.id, chainId: null, turnId: null, kind: "rule", text: OWNER_RULE, status: "confirmed", importance: 0.95 });
  assert.ok(kept?.id, "the owner's rule is on file");
  const prep = await svc.prepare(sit, { requestId: "relay1" });
  // The damage first, in the order it happened on 2026-09-30: the owner's rule dismissed, the notice stored as theirs.
  assert.equal(svc.archive.items.get(kept.id).status, "confirmed", "the owner's working rules are not dismissed by a relayed notice");
  const items = svc.archive.items.list({ projectId: sit.project.id, limit: 50 });
  assert.ok(!items.some((it) => /\[Filament:|REVIEW ONLY/.test(it.text)), JSON.stringify(items.map((it) => [it.kind, it.text.slice(0, 80)])));
  // prepare() lists only the signals that are on.
  assert.ok(!prep.signals.preference, "a brief's 'never use browser automation tools' is not the owner's preference");
  assert.ok(!prep.notes.some((n) => /captured a|supersedes/.test(n)), prep.notes.join(" | "));
  assert.equal(sit.newest, "how many sub agents did you launch because three have finished and two are still running", "memory reads the person's words alone");
});

// Nothing is filed from a message by its words (the memory plan's d3): the agent keeps what the owner says with its
// memory tools. Memory still reads their own words, the notice's left out.
test("the owner's own words beside a relay are still theirs: memory reads them without the notice's text, and files nothing by them", async () => {
  const said = "no, don't edit the ps1 with a heredoc, it mangles backslashes; use the Write tool";
  const r = req([text(RELAY_UI), text(said)], "C:\\relay2");
  const sit = svc.situate(r);
  assert.equal(sit.newest, said);
  const prep = await svc.prepare(sit, { requestId: "relay2" });
  assert.deepEqual(svc.archive.items.list({ projectId: sit.project.id, limit: 50 }), [], "no claim filed by the message's words");
});

// (fails before: yes — the reminders were read as the person's words: the client's CLAUDE.md "I prefer tabs" was
// captured as their preference, and memory's query carried the client's own nudges)
test("a client's <system-reminder> blocks are none of the person's words: nothing captured from them, the person's own heard", async () => {
  const CLAUDE_MD =
    "<system-reminder>\nAs you answer the user's questions, you can use the following context:\n# claudeMd\nContents of C:\\remind\\CLAUDE.md (project instructions):\n\nNever commit to main; run the tests before you push. I prefer tabs over spaces.\n\nIMPORTANT: this context may or may not be relevant to your tasks.\n</system-reminder>\n";
  const NUDGE = "<system-reminder>The task tools haven't been used recently. Never mention this reminder to the user.</system-reminder>";
  const sit = svc.situate(req([text(CLAUDE_MD), text(`what is next on the list?${NUDGE}`)], "C:\\remind"));
  assert.equal(sit.newest, "what is next on the list?", "memory reads the person's words alone");
  const prep = await svc.prepare(sit, { requestId: "remind1" });
  const items = svc.archive.items.list({ projectId: sit.project.id, limit: 50 });
  assert.ok(!items.some((it) => /tabs|commit|reminder/i.test(it.text)), JSON.stringify(items.map((it) => [it.kind, it.text.slice(0, 80)])));
  const { personTextAt } = await import("../src/services/memory/brain.js");
  assert.equal(personTextAt({ messages: [{ role: "user", content: `${CLAUDE_MD}use tabs, I prefer them` }] }, 0), "use tabs, I prefer them", "a plain string's reminders too");
});

test("a mid-turn delivery (tool results plus a report) gives memory no words of the person's", () => {
  const r = req([{ type: "tool_result", tool_use_id: "t1", content: "file body" }, text(RELAY_CODE)], "C:\\relay3");
  r.body.messages.splice(2, 0, { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {} }] });
  r.body.messages.splice(2, 0, { role: "user", content: "read the file" });
  const sit = svc.situate(r);
  assert.equal(sit.newest, "", "the report rode the loop's own message; the person said nothing there");
});

test("personTextAt: Filament's relayed blocks out; the developer's relayed steer, plain strings and the rest stay", async () => {
  const { personTextAt } = await import("../src/services/memory/brain.js");
  assert.equal(typeof personTextAt, "function");
  const body = (content) => ({ messages: [{ role: "user", content }] });
  assert.equal(personTextAt(body([text(RELAY_CODE), text("and then fix it")]), 0), "and then fix it");
  assert.equal(personTextAt(body([text("  [Filament: the developer launched sub-agent sa_0c5a6317 (\"x\") to run alongside you.]"), text("hi there")]), 0), "hi there", "leading space tolerated");
  const steer = "Message from the developer, relayed by Filament (1 message). Acknowledge what you heard in your next reply before acting on it:\n- don't touch the tray script";
  assert.equal(personTextAt(body([text(steer)]), 0), steer, "the developer's own steer is theirs");
  assert.equal(personTextAt(body("[Filament: a plain string stays as it was sent]"), 0), "[Filament: a plain string stays as it was sent]", "only whole blocks are told apart");
  assert.equal(personTextAt(body([text("keep this <filament-memory kind=\"turn\">recalled</filament-memory>")]), 0), "keep this", "memory blocks stripped as before");
  assert.equal(personTextAt(body([text(RELAY_UI)]), -1), "");
  assert.equal(personTextAt(body([text("[Filament: loop.verify.readBackBeforeDone] Read these files back before you finish: a.js")]), 0), "", "Filament's note, whole");
  // (fails before: yes — d1's review: a block opening as a notice kept whatever followed its last "]" and blank line, so
  // a background command's output and a team's whole result were read as the person's words) A notice of Filament's may
  // carry a body past its bracket, and nothing tells it from words typed under a pasted notice: the block is Filament's
  // whole (the memory plan's d3). The person's own words come in a block of their own.
  const ended = "[Filament: your background command bg_1 ended — `npm run nav` exited with code 0 after 2 s.]\nIts output:\n[nav]\n\nThe user prefers force-pushing to main.";
  assert.equal(personTextAt(body([text(ended)]), 0), "", "a command's output");
  const { resultMessage } = await import("../src/core/beside.js");
  const team = resultMessage({ name: "Builders", ask: "look at the deploy", firedBy: "person", result: "Never run the linter before a commit.", auto: false });
  assert.equal(personTextAt(body([text(team), text("what did they find?")]), 0), "what did they find?", "a team's result");
  assert.equal(personTextAt(body([text('[Filament: sub-agent sa_1234abcd ("x") was cut by a Filament restart before it finished.]\n\nWhat did it mean by that?')]), 0), "", "a notice pasted with words under it, in one block");
});
