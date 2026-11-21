// @ts-check
// HarnessV4_Space_Plan S3b (SG-D12, SG-D13): a second look before risky moves. A fourth verdict, `review`, asks as ask
// does in every mode — Full access too — with no Always allow, never lifted by an allow rule or a brief's grant, and
// refused where nobody answers; a command Filament can tell only reads is left to the gate. The switch "Second look
// before risky commands" (`loop.secondLook`, off by default) adds the shipped patterns after the session's own rules.
// As a review rule asks, the Reviewer — the saved agent, read-only — starts in the chat as an agent that started by
// itself: no seat, no marks in the transcript, its answer held for the person; the card draws its five lines as they
// come and stops it once answered. A coding agent's request asks the same way. The dashboard button's look is
// space-dashboards.test.js's (the runner) and space.test.js's (its sheet).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECK_LINES, CHECK_SAID_CHARS, LOOK_LINES, RISKY, RISKY_RULES, checkWords, lookWords, verdictOf } from "../src/core/second-look.js";
import { asksFirst, describeRule, ruleFor, rulesFrom } from "../src/app/agent/rules.js";
import { ruled, toolSetFor } from "../src/app/agent/tools.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { PAUSE_TTL_MS, createParks } from "../src/app/agent/turn.js";
import { createAgentPermits } from "../src/app/agent-permits.js";
import { fromJudged } from "../src/adapters/agents/asks.js";
import { REVIEWER, createSecondLook, lookIn } from "../src/app/second-look.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { KNOBS } from "../src/services/session-settings.js";
import { permissionBlock, reviewWords } from "../src/ui/harness/conversation/interaction.js";
import { workerLine } from "../src/ui/harness/conversation/decisions.js";
import { secondLookView } from "../src/ui/harness/conversation/second-look.js";
import { lookAnswer, lookLine, lookLines, lookTime, readingWords, roundText } from "../src/ui/harness/lib/second-look.js";
import { ruleWords } from "../src/ui/harness/composer/mode.js";
import { pauseOf } from "../src/ui/harness/lib/labels.js";
import { ARTIFACT_GUIDE } from "../src/app/agent/artifacts.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** A folder of the test's own. @param {string} name */
const folder = (name) => {
  const dir = mkdtempSync(join(tmpdir(), `filament-second-look-${name}-`));
  made.push(dir);
  return dir;
};
/** The first node under `n` wearing a class. @param {any} n @param {string} cls @returns {any} */
const one = (n, cls) => {
  if (!n || typeof n !== "object") return null;
  if (String(n.attrs?.class || "").split(/\s+/).includes(cls)) return n;
  for (const k of n.kids || []) {
    const hit = one(k, cls);
    if (hit) return hit;
  }
  return null;
};
/**
 * Every word under a node as the page shows it — a node's `textContent` where the page set it, else its children —
 * the non-empty ones joined with "|". @param {any} n @returns {string}
 */
const said = (n) => {
  if (n == null) return "";
  if (typeof n !== "object") return String(n);
  if (Object.hasOwn(n, "textContent")) return String(n.textContent);
  return (n.kids || []).map(said).filter(Boolean).join("|");
};
/** A permission card's rows, as its choices. @param {any} el */
const rows = (el) => buttonsOf(el).filter((b) => String(b.attrs.class || "").split(/\s+/).includes("ix-option"));
const FORCE = { tool: "bash", pattern: "git push*--force*", verdict: "review" };
const SHIPPED = RISKY_RULES.find((r) => r.pattern === "git push*--force*");

describe("the review rule, pure", () => {
  // (fails before: yes — there was no review verdict, and no patterns)
  test("the shipped patterns catch deploys, migrations, infrastructure, rewriting and publishing pushes, data drops and cloud deletes; everyday commands pass", () => {
    const hit = (/** @type {string} */ command) => ruleFor(/** @type {any} */ (RISKY_RULES), "bash", { command })?.verdict ?? null;
    for (const c of ["npx wrangler deploy --env production", "npx wrangler rollback 3f2a --yes", "npm run db:migrate", "npx prisma migrate deploy", "terraform apply -auto-approve",
      "kubectl delete pod web-1", "git push --force origin main", "git push origin -f", "git push origin v1.8.0", "git push origin --tags", "git push origin :old-branch",
      "psql -c \"DROP TABLE users\"", "sqlite3 app.db 'delete from sessions'", "aws s3 rm s3://bucket --recursive", "gh release delete v1.7", "cd infra && terraform destroy"])
      assert.equal(hit(c), "review", c);
    for (const c of ["git push origin main", "git push", "npm test", "terraform plan", "kubectl get pods", "npx wrangler dev", "git status", "aws s3 ls"]) assert.equal(hit(c), null, c);
    assert.ok(RISKY_RULES.every((r) => r.tool === "bash" && r.verdict === "review" && r.shipped === true) && RISKY_RULES.length === RISKY.length);
    assert.deepEqual(LOOK_LINES, ["What it does", "Production", "What can go wrong", "Way back", "Verdict"]);
  });

  // (fails before: yes — the same)
  test("deny over review over ask over allow; the switch adds the shipped patterns after the session's own; review asks first; its words name the switch", () => {
    const push = { command: "git push --force origin main" };
    const allow = { tool: "bash", pattern: "git push*", verdict: "allow" };
    const ask = { tool: "bash", pattern: "git push*", verdict: "ask" };
    assert.equal(ruleFor(/** @type {any} */ ([allow, ask, FORCE]), "bash", push)?.verdict, "review", "review speaks over an earlier ask and allow");
    assert.equal(ruleFor(/** @type {any} */ ([FORCE, { tool: "bash", pattern: "git push*", verdict: "deny" }]), "bash", push)?.verdict, "deny");
    assert.equal(ruleFor(/** @type {any} */ ([allow, FORCE]), "bash", { command: "git push origin main" })?.verdict, "allow", "a push that forces nothing");
    // (fails before: yes — found writing these tests: the first rule that covered a segment spoke for it, so an earlier
    // allow, a learned one included, lifted the switch's review, which comes after the session's own rules)
    const learnedPush = { tool: "bash", pattern: "git push", verdict: "allow", learned: true };
    assert.equal(ruleFor(/** @type {any} */ ([learnedPush, ...RISKY_RULES]), "bash", push)?.verdict, "review", "a learned allow lifts no second look");
    assert.equal(ruleFor(/** @type {any} */ ([learnedPush, ...RISKY_RULES]), "bash", { command: "git push origin main" })?.verdict, "allow");
    assert.equal(ruleFor(/** @type {any} */ ([FORCE, { tool: "bash", pattern: "*--force*", verdict: "deny" }]), "bash", push)?.verdict, "deny", "a deny after it still refuses");
    const doc = { privacy: { bashDeny: ["rm -rf /*"] }, loop: { rules: [ask, FORCE] } };
    assert.deepEqual(rulesFrom(doc).map(describeRule), ["bash(rm -rf /*) deny", "bash(git push*) ask", "bash(git push*--force*) review"], "off by default: none shipped");
    const on = rulesFrom({ ...doc, loop: { ...doc.loop, secondLook: true } });
    assert.equal(on.length, 3 + RISKY.length);
    assert.deepEqual(on.slice(3).map((r) => r.pattern), [...RISKY], "after the session's own, in order");
    assert.equal(describeRule(on[3]), "bash(*wrangler deploy*) review · Second look before risky commands");
    assert.equal(describeRule(/** @type {any} */ (FORCE)), "bash(git push*--force*) review");
    assert.deepEqual([asksFirst(ruleFor(/** @type {any} */ ([FORCE]), "bash", push)), asksFirst(ruleFor(/** @type {any} */ ([ask]), "bash", push)), asksFirst(ruleFor(/** @type {any} */ ([allow]), "bash", push)), asksFirst(null)], [true, true, false, false]);
    assert.equal(KNOBS["loop.secondLook"].default, false, "off: it changes how Full access behaves, so it is the person's to switch on");
  });

  // (fails before: yes — the same)
  test("ruled: a review asks in every mode, Full access included, and says why; a command that only reads goes to the gate; read-only and deny still refuse", () => {
    const hit = (/** @type {string} */ command) => /** @type {any} */ (ruleFor(/** @type {any} */ ([FORCE, { tool: "bash", pattern: "*drop table*", verdict: "review" }]), "bash", { command }));
    const input = { command: "git push --force origin main" };
    const full = /** @type {any} */ (ruled({ verdict: "run" }, hit(input.command), "bash", input, "/w"));
    assert.deepEqual([full.verdict, full.review, full.rule.pattern], ["ask", true, "git push*--force*"]);
    assert.match(full.question, / A rule of this session asks for a second look first\.$/);
    const edit = /** @type {any} */ (ruled({ verdict: "ask", question: "May I run this command?", why: "it pushes" }, hit(input.command), "bash", input, "/w"));
    assert.deepEqual([edit.verdict, edit.question, edit.why], ["ask", "May I run this command? A rule of this session asks for a second look first.", "it pushes"]);
    const grep = { command: "grep -ri \"drop table\" migrations" };
    const reads = /** @type {any} */ (ruled({ verdict: "run", readOnly: true }, hit(grep.command), "bash", grep, "/w", () => true));
    assert.deepEqual([reads.verdict, reads.review], ["run", undefined], "it only reads: the gate decides");
    assert.match(reads.note, /leaves `grep -ri "drop table" migrations` to the gate — it only reads$/);
    assert.equal(/** @type {any} */ (ruled({ verdict: "run" }, hit(grep.command), "bash", grep, "/w", () => false)).verdict, "ask", "where it cannot tell, it asks");
    assert.equal(ruled({ verdict: "refuse", text: "read-only" }, hit(input.command), "bash", input).verdict, "refuse");
  });

  // (fails before: yes — the Reviewer had no task)
  test("its task: read and change nothing; the command, where, why; a button's sentence, its row and the others; five labelled lines", () => {
    const plain = lookWords({ command: "git push --force origin main", folder: "/w", why: "the rule bash(git push*--force*) review asks for a second look" });
    assert.match(plain, /^This is a second look, for Filament: .* You read and change nothing: do not run the command/);
    assert.ok(plain.includes("The command: git push --force origin main\nWhere it runs: /w\nWhy Filament asks: the rule bash(git push*--force*) review asks for a second look"));
    for (const [i, l] of LOOK_LINES.entries()) assert.ok(plain.includes(`\n${i + 1}. ${l}: `), l);
    assert.ok(!plain.includes("dashboard"));
    const rowsOf = Array.from({ length: 25 }, (_, i) => ({ version: `v${i}` }));
    const button = lookWords({ command: "npx wrangler rollback 3f2a --yes", folder: "/w", why: "…", button: { label: "Roll back to this…", dashboard: "Deploys", says: "Roll back to 3f2a?", row: { version: "3f2a", message: "Add retry" }, rows: rowsOf } });
    assert.ok(button.includes("It is the button “Roll back to this…” of the dashboard “Deploys”, on one of its rows. What the button says: Roll back to 3f2a?"));
    assert.ok(button.includes("The row it acts on: version: 3f2a · message: Add retry"));
    assert.ok(button.includes("- version: v19\n") && !button.includes("v20"), "twenty of the others at most");
  });

  // HarnessV4_Space_Plan S5d: a check's task — a button ran and ended without an error; read whether it did what it was
  // for, change nothing, run it again least of all — and its verdict read off its last line.
  // (fails before: yes — there was no check)
  test("a check's task: what ran and said, the row before and after, what to look for; three lines; its verdict read", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ version: `v${i}` }));
    const long = `${"x".repeat(3000)}Rolled back to 3f2a`;
    const w = checkWords({ label: "Roll back to this…", dashboard: "Deploys", says: "Roll back to 3f2a?", ran: "npx wrangler rollback 3f2a --yes", folder: "/w", said: long, verify: "3f2a serves 100%", before: { version: "3f2a", traffic: "0" }, after: { version: "3f2a", traffic: "100" }, rows });
    assert.match(w, /^This is a check, for Filament: a button of a dashboard just ran, with no AI, and ended without an error\. .* You read and change nothing: do not run it again/);
    assert.ok(w.includes("The button “Roll back to this…” of the dashboard “Deploys”. What it says: Roll back to 3f2a?\nWhat ran: npx wrangler rollback 3f2a --yes\nWhere it ran: /w"));
    assert.ok(w.includes(`What it said: …${long.slice(-CHECK_SAID_CHARS)}`), "its last 2,000 characters");
    assert.ok(w.includes("The row it acted on, before: version: 3f2a · traffic: 0\nThe same row, read again after: version: 3f2a · traffic: 100"));
    assert.ok(w.includes("- version: v19\n") && !w.includes("v20"), "twenty rows at most");
    assert.ok(w.includes("What to look for, as the dashboard's author said: 3f2a serves 100%"));
    for (const [i, l] of CHECK_LINES.entries()) assert.ok(w.includes(`\n${i + 1}. ${l}: `), l);
    const tool = checkWords({ label: "Re-run…", dashboard: "CI", says: "", ran: 'ci › rerun {"run_id":8812}', tool: "ci", folder: "/w", said: "", verify: "", before: { run: "8812" }, after: null, rows: [] });
    assert.ok(tool.includes("It called a tool of the MCP server ci") && tool.includes("What it said: (nothing)") && tool.includes("The same row, read again after: it is no longer there."));
    assert.ok(!tool.includes("What to look for"), "no verify: not said");
    // Its verdict, from its Verdict line: worked, did not work, can't tell — as written, its numbering and marks aside.
    const cases = [
      ["1. What it did: x\n2. What I checked: y\n3. Verdict: it worked — 3f2a serves 100%", "worked", "3f2a serves 100%"],
      ["3. **Verdict:** It did not work — the row still says 0%.", "failed", "the row still says 0%."],
      ["Verdict: didn't work: traffic unchanged", "failed", "traffic unchanged"],
      ["3) Verdict: can't tell — the list did not load", "unclear", "the list did not load"],
      ["3. Verdict: Can’t tell, no access", "unclear", "no access"],
      ["3. Verdict: probably fine", "unclear", "probably fine"],
      ["It worked, I think.", "unclear", ""],
      // Found by the Hunter on S5d: any "did not …" was failed. What it was for, not done: failed, its words whole; a
      // harm it did not do: no failure, and no "worked" either.
      ["3. Verdict: it did not succeed — traffic still 0%", "failed", "did not succeed — traffic still 0%"],
      ["3. Verdict: It didn’t finish the rollback", "failed", "didn’t finish the rollback"],
      ["3. Verdict: it did not fail — the tag moved", "unclear", "did not fail — the tag moved"],
      ["3. Verdict: didn't break anything, but 7c1e still serves", "unclear", "didn't break anything, but 7c1e still serves"],
      ["3. Verdict: it did nothing visible", "unclear", "it did nothing visible"],
    ];
    for (const [report, verdict, reason] of cases) assert.deepEqual(verdictOf(report), { verdict, reason }, report);
  });
});

/** A turn's ask, as its model sends one tool call at a time. */
const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
const answer = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
/** A stand-in for a chat's second looks: each start an agent of its own, every stop kept. */
const looksOf = () => {
  /** @type {any[]} */
  const started = [];
  /** @type {any[]} */
  const stopped = [];
  return {
    started,
    stopped,
    start: (/** @type {any} */ about) => (started.push(about), { chain: "c1", agent: `sa-${started.length}` }),
    stop: (/** @type {any} */ look) => void stopped.push(look),
  };
};
/**
 * A loop turn whose model runs each command with bash, in order, then ends. `mode`: the mode in force, or a function
 * reading it; `asker`: a worker's, whose call waits in place; `resume`: a paused turn and its answer.
 * @param {{ commands?: string[], rules?: any[], mode?: string | (() => string), asker?: any, unattended?: string, grants?: any, looks?: ReturnType<typeof looksOf> | null, permissions?: any, resume?: any, root?: string }} o
 */
const loopTurn = async ({ commands = [], rules = [FORCE], mode = "auto", asker, unattended, grants = null, looks = looksOf(), permissions = null, resume = null, root = tmpdir() }) => {
  /** @type {string[]} */
  const ran = [];
  /** @type {any[]} */
  const events = [];
  let n = 0;
  const out = await runAgentTurn(/** @type {any} */ ({
    model: "m",
    messages: [{ role: "user", content: "ship it" }],
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: typeof mode === "function" ? mode : () => mode,
    rules,
    root,
    readerModel: "",
    maxTokens: 100,
    ...(asker ? { asker } : {}),
    ...(unattended ? { unattended } : {}),
    call: async () => {
      const c = commands[n++];
      return answer(c != null ? [{ type: "tool_use", id: `b${n}`, name: "bash", input: { command: c } }] : [{ type: "text", text: "Done." }]);
    },
    costOf: () => 0,
    runHand: async (/** @type {string} */ _name, /** @type {any} */ input) => {
      ran.push(String(input.command));
      return "ok";
    },
    delegateRead: null,
    mailbox: { read: () => [] },
    permissions,
    grants,
    tree: null,
    onEvent: (/** @type {any} */ e) => events.push(e),
    previewChars: 0,
    sink,
    signal: null,
    resume,
    secondLook: looks,
  }));
  return { out, ran, events, looks: /** @type {ReturnType<typeof looksOf>} */ (looks) };
};

describe("the loop asks with a second look", () => {
  // (fails before: yes — Full access ran a forced push without asking)
  test("Full access: a risky command pauses with its rule and the Reviewer's look, offering no Always allow; a safe one runs; Allow stops the look and runs it", async () => {
    const offered = { allowed: () => false, offered: () => ({ itemId: 3, tool: "bash", shape: "git push" }), recordAllow: () => null };
    const t = await loopTurn({ commands: ["git status", "git push --force origin main"], permissions: offered });
    assert.equal(t.out.status, "paused");
    assert.deepEqual(t.ran, ["git status"]);
    const p = /** @type {any} */ (t.out.pause);
    assert.deepEqual([p.kind, p.review, p.look, p.offer], ["permission", "bash(git push*--force*) review", { chain: "c1", agent: "sa-1" }, undefined]);
    assert.deepEqual(t.looks.started, [{ command: "git push --force origin main", folder: tmpdir(), why: "the rule bash(git push*--force*) review asks for a second look" }]);
    const ask = t.events.find((e) => e.type === "ask");
    assert.deepEqual([ask.review, ask.look, ask.offer], ["bash(git push*--force*) review", { chain: "c1", agent: "sa-1" }, undefined], "the card's event: the rule and its look, no offer");
    assert.ok(t.out.notes.includes("agent: paused for permission to bash, with a second look (the rule bash(git push*--force*) review)"), t.out.notes.join("\n"));
    assert.deepEqual(t.looks.stopped, [], "it reads while the card waits");
    /** @type {string[]} */
    const recorded = [];
    const learning = { allowed: () => false, offered: () => null, recordAllow: (/** @type {string} */ _n, /** @type {any} */ i) => (recorded.push(String(i.command)), { offered: { id: 9 }, shape: { tool: "bash", shape: "git push", text: "bash: git push" }, count: 5 }) };
    const yes = await loopTurn({ looks: t.looks, resume: { paused: p, answer: "yes", allow: true }, permissions: learning });
    assert.equal(yes.out.status, "done");
    assert.deepEqual([yes.ran, t.looks.stopped], [["git push --force origin main"], [{ chain: "c1", agent: "sa-1" }]], "answered: its look stopped, the command run");
    // Its yes counts towards no always-allow: five force-pushes allowed would offer every `git push`.
    // (fails before: yes — found by the Hunter on S3b: the yes was recorded, and its offer came at the fifth)
    assert.deepEqual([recorded, yes.events.filter((e) => e.type === "permission-offer")], [[], []]);
    assert.ok(yes.out.notes.includes("agent: a yes to a review rule's ask counts towards no always-allow"), yes.out.notes.join("\n"));
    // A plain ask's yes still counts.
    const plain = await loopTurn({ commands: ["rm -rf build"], rules: [], mode: "edit" });
    const plainYes = await loopTurn({ resume: { paused: /** @type {any} */ (plain.out.pause), answer: "yes", allow: true }, rules: [], mode: "edit", permissions: learning });
    assert.deepEqual([plainYes.ran, recorded, plainYes.events.filter((e) => e.type === "permission-offer").length], [["rm -rf build"], ["rm -rf build"], 1]);
    // Off, or not covered: nothing asks under Full access, and nothing starts.
    const off = await loopTurn({ commands: ["git push --force origin main"], rules: [] });
    assert.deepEqual([off.out.status, off.ran, off.looks.started], ["done", ["git push --force origin main"], []]);
  });

  // (fails before: yes — the same)
  test("the switch moved while it waits: judged again, the same look kept; read-only refuses it and stops the look; no chat to run one in, the card says why", async () => {
    let mode = "auto";
    const t = await loopTurn({ commands: ["git push --force origin main"], mode: () => mode });
    const p = /** @type {any} */ (t.out.pause);
    const again = await loopTurn({ looks: t.looks, mode: () => mode, resume: { paused: p, answer: "Switched to Edit automatically", modeSwitch: true } });
    assert.equal(again.out.status, "paused");
    assert.deepEqual([/** @type {any} */ (again.out.pause).look, t.looks.started.length, t.looks.stopped], [{ chain: "c1", agent: "sa-1" }, 1, []], "still asks, with the look already reading");
    mode = "read-only";
    const ro = await loopTurn({ looks: t.looks, mode: () => mode, resume: { paused: /** @type {any} */ (again.out.pause), answer: "Switched to Read only", modeSwitch: true } });
    assert.deepEqual([ro.ran, t.looks.stopped], [[], [{ chain: "c1", agent: "sa-1" }]], "refused under read-only: its look stopped");
    const none = await loopTurn({ commands: ["git push --force origin main"], looks: null });
    assert.deepEqual(/** @type {any} */ (none.out.pause).look, { error: "this chat runs no agents of Filament's" });
  });

  // (fails before: yes — a brief's grant ran a covered command; a worker's ask offered Always allow)
  test("a worker: the look rides its question and stops once answered; a brief's grant does not lift a review; with nobody to answer, it is refused and no look starts", async () => {
    const root = folder("wt");
    const grants = { list: { check: ["npm test"], mayRun: [], card: [] }, folder: folder("proj") };
    const review = [{ tool: "bash", pattern: "npm test*", verdict: "review" }];
    /** @type {any[]} */
    const asked = [];
    const asker = async (/** @type {any} */ q) => {
      asked.push(q);
      return { text: "no" };
    };
    const granted = await loopTurn({ commands: ["npm test"], rules: [], mode: "edit", grants, root, asker, unattended: "worker" });
    assert.deepEqual([granted.ran, asked.length], [["npm test"], 0], "without the rule, its grant runs it");
    const w = await loopTurn({ commands: ["npm test"], rules: review, mode: "edit", grants, root, asker, unattended: "worker", permissions: { allowed: () => false, offered: () => ({ itemId: 1, tool: "bash", shape: "npm test" }), recordAllow: () => null } });
    assert.deepEqual(w.ran, [], "the grant does not lift it");
    assert.deepEqual([asked[0].review, asked[0].look, asked[0].offer], ["bash(npm test*) review", { chain: "c1", agent: "sa-1" }, undefined]);
    assert.deepEqual(w.looks.stopped, [{ chain: "c1", agent: "sa-1" }], "answered: stopped");
    const alone = await loopTurn({ commands: ["git push --force origin main"], unattended: "self" });
    assert.deepEqual([alone.ran, alone.looks.started], [[], []]);
    assert.ok(alone.out.notes.includes("agent: bash refused — it needs approval, and nobody is asked for an agent that started by itself"), alone.out.notes.join("\n"));
  });
});

describe("a paused turn let go", () => {
  // (fails before: yes — found by the Hunter on S3b: a pause dropped unanswered left its Reviewer reading)
  test("out of time — at a sweep, or as the next message finds it — its look stops; taken in time, it is the resume's and its look reads on", () => {
    const clock = { at: 1_000 };
    /** @type {any[]} */
    const stopped = [];
    const parks = createParks({ stopLook: (l) => void stopped.push(l), now: () => clock.at });
    const look = { chain: "c1", agent: "sa-1" };
    const paused = /** @type {any} */ ({ kind: "permission", look });
    parks.park("a", paused, null);
    parks.park("b", /** @type {any} */ ({ kind: "permission", look: { error: "none" } }), null);
    parks.park("c", /** @type {any} */ ({ kind: "permission", look: { chain: "c2", agent: "sa-2" } }), null);
    assert.equal(parks.take("a")?.paused, paused, "in time: the resume's");
    assert.deepEqual(stopped, [], "its look reads on: the answer stops it");
    parks.park("a", paused, null);
    clock.at += PAUSE_TTL_MS + 1;
    assert.equal(parks.take("a"), null, "out of time as the next message comes");
    assert.deepEqual(stopped, [look]);
    parks.sweep();
    assert.deepEqual(stopped, [look, { chain: "c2", agent: "sa-2" }], "the sweep: only a look that runs is stopped");
    assert.deepEqual([parks.take("b"), parks.take("c")], [null, null], "both let go");
  });
});

describe("a coding agent's request", () => {
  const root = tmpdir();
  const bash = (/** @type {string} */ command) => ({ name: "bash", input: { command } });
  const learned = { offered: () => ({ itemId: 4, tool: "bash", shape: "git push" }), recordAllow: () => null };

  // (fails before: yes — a coding agent's forced push ran under Full access)
  test("asks in Full access with the rule, no offer; the review speaks for a request that asks for other reasons too; reads go to the gate", () => {
    const permits = createAgentPermits({ rules: /** @type {any} */ ([FORCE]), modeNow: () => "auto", learned: /** @type {any} */ (learned) });
    const v = /** @type {any} */ (permits.judge([bash("git push --force origin main")], root));
    assert.deepEqual([v.verdict, v.review, v.offer, v.how], ["ask", "bash(git push*--force*) review", undefined, "asked: the rule bash(git push*--force*) review asks with a second look first"]);
    const edit = createAgentPermits({ rules: /** @type {any} */ ([FORCE]), modeNow: () => "edit", learned: /** @type {any} */ (learned) });
    const both = /** @type {any} */ (edit.judge([bash("rm -rf build"), bash("git push --force origin main")], root));
    assert.deepEqual([both.verdict, both.review, both.command], ["ask", "bash(git push*--force*) review", "git push --force origin main"], "the review's call speaks for the request");
    const reads = createAgentPermits({ rules: /** @type {any} */ ([{ tool: "bash", pattern: "*drop table*", verdict: "review" }]), modeNow: () => "edit", learned: null });
    assert.equal(reads.judge([bash("grep -ri \"drop table\" migrations")], root).verdict, "run", "it only reads");
  });

  // (fails before: yes — found by the Hunter on S3b: the yes was recorded for every shape, and its offer came)
  test("the person's yes to a review's ask counts towards no always-allow; a plain ask's still does", () => {
    /** @type {string[]} */
    const recorded = [];
    const counting = { offered: () => null, recordAllow: (/** @type {string} */ _n, /** @type {any} */ i) => (recorded.push(String(i.command)), { offered: { id: 4 }, shape: { tool: "bash", shape: "git push", text: "bash: git push" }, count: 5 }) };
    const permits = createAgentPermits({ rules: /** @type {any} */ ([FORCE]), modeNow: () => "auto", learned: /** @type {any} */ (counting) });
    const v = /** @type {any} */ (permits.allowed([bash("git push --force origin main")], root));
    assert.deepEqual([v.verdict, v.how, v.offers, recorded], ["run", "ran: the person allowed it, with a second look", undefined, []]);
    const plain = /** @type {any} */ (permits.allowed([bash("rm -rf build")], root));
    assert.deepEqual([plain.how, plain.offers?.length, recorded], ["ran: the person allowed it", 1, ["rm -rf build"]]);
  });

  // (fails before: yes — the same)
  test("look and unlook: the Reviewer starts and stops through the chat's looks; none, the card says why; its form carries the rule and the look", () => {
    const looks = looksOf();
    const permits = /** @type {any} */ (createAgentPermits({ rules: [], modeNow: () => "auto", learned: null, look: looks }));
    const about = { command: "git push --force", folder: root, why: "the rule … asks for a second look" };
    const l = permits.look(about);
    assert.deepEqual([l, looks.started], [{ chain: "c1", agent: "sa-1" }, [about]]);
    permits.unlook(l);
    permits.unlook({ error: "none" });
    permits.unlook(null);
    assert.deepEqual(looks.stopped, [{ chain: "c1", agent: "sa-1" }], "only a look that runs is stopped");
    assert.deepEqual(/** @type {any} */ (createAgentPermits({ rules: [], modeNow: () => "auto", learned: null })).look(about), { error: "this chat runs no agents of Filament's" });
    const form = fromJudged({ agent: "Claude", tool: "bash", words: "May I run this command?", command: "git push --force", review: "bash(git push*--force*) review", look: l });
    assert.deepEqual([form.judged?.review, form.judged?.look], ["bash(git push*--force*) review", { chain: "c1", agent: "sa-1" }]);
    assert.equal("review" in /** @type {any} */ (fromJudged({ agent: "Claude", tool: "bash", words: "May I?" }).judged), false);
  });
});

describe("the second look's run", () => {
  /** A registry's stand-in: what it launched and stopped, and its agents by id. */
  const regOf = () => {
    /** @type {Map<string, any>} */
    const subs = new Map();
    /** @type {any[]} */
    const launched = [];
    /** @type {any[]} */
    const stopped = [];
    let refuse = "";
    return {
      subs,
      launched,
      stopped,
      refuseWith: (/** @type {string} */ e) => void (refuse = e),
      launch: (/** @type {any} */ spec) => {
        launched.push(spec);
        if (refuse) return { ok: false, error: refuse };
        const id = `sa-${launched.length}`;
        subs.set(id, { id, chainId: spec.chainId, second: spec.second, status: "running", runId: null, model: spec.model || "m-main", provider: "Anthropic", exchanges: [{ prompt: spec.prompt.slice(0, 40), report: "", error: null }], whole: spec.prompt });
        return { ok: true, id };
      },
      get: (/** @type {string} */ id) => subs.get(id) || null,
      detail: (/** @type {string} */ id) => {
        const sa = subs.get(id);
        return sa ? { ...sa, exchanges: sa.exchanges.map((/** @type {any} */ x, /** @type {number} */ i) => ({ ...x, prompt: i === 0 ? sa.whole : x.prompt })) } : null;
      },
      stop: (/** @type {string} */ id, /** @type {any} */ o) => (stopped.push([id, o]), { ok: true }),
    };
  };
  const busOf = () => {
    /** @type {Set<(p: any) => void>} */
    const fns = new Set();
    return {
      subscribe: (/** @type {string} */ topic, /** @type {(p: any) => void} */ fn) => {
        assert.equal(topic, "subagents");
        fns.add(fn);
        return () => void fns.delete(fn);
      },
      publish: (/** @type {any} */ p) => {
        for (const fn of [...fns]) fn(p);
      },
      size: () => fns.size,
    };
  };

  // (fails before: yes — there was no second look)
  test("start: the Reviewer, read-only, by itself, in the chat; refused in words; run waits for its run, then its end; stop stops one that runs", async () => {
    const reg = regOf();
    const bus = busOf();
    const looks = createSecondLook({ registry: () => /** @type {any} */ (reg), events: /** @type {any} */ (bus), chatOf: (id) => (id === "c1" ? { title: "t" } : null) });
    const about = { command: "git push --force", folder: "/w", why: "the rule … asks" };
    assert.deepEqual(looks.start({ chainId: "c1", cwd: "/w", about, why: "the rule … asks" }), { ok: true, chain: "c1", agent: "sa-1" });
    const spec = reg.launched[0];
    assert.deepEqual([spec.origin, spec.second, spec.as, spec.may, spec.chainId, spec.cwd, spec.description, spec.why], ["self", true, REVIEWER, "read", "c1", "/w", "Second look", "the rule … asks"]);
    assert.equal(spec.prompt, lookWords(about));
    assert.deepEqual(looks.start({ chainId: "c9", about, why: "x" }), { ok: false, error: "the chat it would run in is gone" });
    reg.refuseWith("Reviewer is switched off.");
    assert.deepEqual(looks.start({ chainId: "c1", about, why: "x" }), { ok: false, error: "Reviewer is switched off" });
    assert.deepEqual(createSecondLook({ registry: () => null, events: /** @type {any} */ (bus), chatOf: () => ({ title: "t" }) }).start({ chainId: "c1", about, why: "x" }), { ok: false, error: "agents are not available in this Filament" });
    // Its run: no clock — it waits for the registry to say the run exists.
    const waiting = looks.run("c1", "sa-1");
    await new Promise((r) => setImmediate(r));
    assert.equal(bus.size(), 1, "it waits on the bus");
    bus.publish({ type: "subagent", id: "sa-2" });
    reg.subs.get("sa-1").runId = "run-7";
    bus.publish({ type: "subagent", id: "sa-1" });
    const its = { model: "m-main", provider: "Anthropic", asked: lookWords(about) };
    assert.deepEqual(await waiting, { ok: true, runId: "run-7", status: "running", report: "", error: null, ...its });
    assert.equal(bus.size(), 0, "and lets go");
    assert.deepEqual(looks.stop("c1", "sa-1"), { ok: true, ran: true });
    assert.deepEqual(reg.stopped, [["sa-1", { from: "filament" }]]);
    Object.assign(reg.subs.get("sa-1"), { status: "done", exchanges: [{ report: "1. What it does: pushes", error: null }] });
    assert.deepEqual(await looks.run("c1", "sa-1"), { ok: true, runId: "run-7", status: "done", report: "1. What it does: pushes", error: null, ...its });
    assert.deepEqual(looks.stop("c1", "sa-1"), { ok: true, ran: false }, "ended: nothing to stop");
    reg.subs.set("sa-5", { id: "sa-5", chainId: "c1", second: false, status: "running", runId: null, exchanges: [] });
    for (const [chain, id] of [["c1", "sa-5"], ["c2", "sa-1"], ["c1", "sa-404"]]) {
      assert.deepEqual(await looks.run(chain, id), { ok: false, error: "that second look is no longer kept" }, `${chain} ${id}`);
      assert.deepEqual(looks.stop(chain, id), { ok: false, error: "that second look is no longer kept" });
    }
    // A chat's looks, as a turn's gate asks for them.
    const chat = lookIn(looks, "c1");
    reg.refuseWith("");
    const l = chat.start(about);
    assert.deepEqual(l, { chain: "c1", agent: "sa-3" });
    assert.equal(reg.launched.at(-1).cwd, "/w", "in the folder the move runs in");
    chat.stop(l);
    chat.stop({ error: "none" });
    assert.deepEqual(reg.stopped.at(-1), ["sa-3", { from: "filament" }]);
    assert.deepEqual(lookIn(looks, "c9").start(about), { error: "the chat it would run in is gone" });
  });

  // HarnessV4_Space_Plan S5d: a button's check is the same Reviewer, read-only, by itself in the chat, told the check's
  // task; `ended` waits for its end with no clock and says its answer, or why it has none.
  // (fails before: yes — there was no check)
  test("a check: the Reviewer told the check's task; ended waits for its end, its answer or why none", async () => {
    const reg = regOf();
    const bus = busOf();
    const looks = createSecondLook({ registry: () => /** @type {any} */ (reg), events: /** @type {any} */ (bus), chatOf: (id) => (id === "c1" ? { title: "t" } : null) });
    const about = { label: "Roll back to this…", dashboard: "Deploys", says: "Roll back to 3f2a?", ran: "npx wrangler rollback 3f2a --yes", folder: "/w", said: "Rolled back", verify: "", before: { version: "3f2a" }, after: null, rows: [] };
    assert.deepEqual(looks.check({ chainId: "c1", cwd: "/w", about, why: "you asked", description: "Check: Roll back to this on Deploys" }), { ok: true, chain: "c1", agent: "sa-1" });
    const spec = reg.launched[0];
    assert.deepEqual([spec.origin, spec.second, spec.as, spec.may, spec.chainId, spec.cwd, spec.description], ["self", true, REVIEWER, "read", "c1", "/w", "Check: Roll back to this on Deploys"]);
    assert.equal(spec.prompt, checkWords(about));
    assert.deepEqual(looks.check({ chainId: "c9", about, why: "x" }), { ok: false, error: "the chat it would run in is gone" });
    // Its end: no clock — it waits on the bus until the registry says it ended.
    const ending = looks.ended("c1", "sa-1");
    await new Promise((r) => setImmediate(r));
    assert.equal(bus.size(), 1, "it waits on the bus");
    bus.publish({ type: "subagent", id: "sa-1" });
    assert.equal(bus.size(), 1, "still running: it waits on");
    Object.assign(reg.subs.get("sa-1"), { status: "done", exchanges: [{ report: "3. Verdict: it worked — 3f2a serves", error: null }] });
    bus.publish({ type: "subagent", id: "sa-1" });
    assert.deepEqual(await ending, { status: "done", report: "3. Verdict: it worked — 3f2a serves", error: null });
    assert.equal(bus.size(), 0, "and lets go");
    assert.deepEqual(await looks.ended("c1", "sa-1"), { status: "done", report: "3. Verdict: it worked — 3f2a serves", error: null }, "ended already: at once");
    assert.deepEqual(await looks.ended("c2", "sa-1"), { status: "gone", report: "", error: "it is no longer kept" });
  });

  // The owner's word of 10-31: no agent starts behind the person's back, and the model it runs on is theirs to see and
  // choose — a look or a check runs on the model the person picked, and says it, with its provider and its task whole.
  // (fails before: yes — the launch named no model, and the run said none)
  test("a look and a check run on the model the person chose; its run says that model, its provider and what it was asked, whole", async () => {
    const reg = regOf();
    const bus = busOf();
    const looks = createSecondLook({ registry: () => /** @type {any} */ (reg), events: /** @type {any} */ (bus), chatOf: () => ({ title: "t" }) });
    const about = { command: "npx wrangler rollback 3f2a --yes", folder: "/w", why: "the button asks", button: { label: "Roll back to this…", dashboard: "Deploys", says: "Roll back?", row: { version: "3f2a" }, rows: Array.from({ length: 20 }, (_, i) => ({ version: `v${i}`, message: "x".repeat(300) })) } };
    assert.deepEqual(looks.start({ chainId: "c1", cwd: "/w", about, why: "asks", model: "brain-skeptic" }), { ok: true, chain: "c1", agent: "sa-1" });
    assert.equal(reg.launched[0].model, "brain-skeptic", "launched on the model chosen");
    const checkAbout = { label: "Roll back to this…", dashboard: "Deploys", says: "", ran: "x", folder: "/w", said: "", verify: "", before: {}, after: null, rows: [] };
    assert.ok(looks.check({ chainId: "c1", cwd: "/w", about: checkAbout, why: "you asked", model: "brain-checker" }).ok);
    assert.equal(reg.launched[1].model, "brain-checker");
    assert.ok(looks.start({ chainId: "c1", about, why: "asks" }).ok);
    assert.equal("model" in reg.launched[2], false, "none chosen: none named, the registry's own choice");
    reg.subs.get("sa-1").runId = "run-1";
    const r = /** @type {any} */ (await looks.run("c1", "sa-1"));
    assert.deepEqual([r.model, r.provider], ["brain-skeptic", "Anthropic"]);
    assert.equal(r.asked, lookWords(about), "its task whole, never the card's cut");
    assert.ok(r.asked.length > 4000);
  });

  // (fails before: yes — every event of the agent's, its progress twice a second included, built its whole public form
  // while its run or its answer was awaited)
  test("a look awaited reads the registry as its state changes, never at its progress", async () => {
    const reg = regOf();
    const bus = busOf();
    let gets = 0;
    const counted = { ...reg, get: (/** @type {string} */ id) => (gets++, reg.get(id)) };
    const looks = createSecondLook({ registry: () => /** @type {any} */ (counted), events: /** @type {any} */ (bus), chatOf: () => ({ title: "t" }) });
    assert.ok(looks.start({ chainId: "c1", cwd: "/w", about: { command: "git push --force", folder: "/w", why: "asks" }, why: "asks" }).ok);
    const running = looks.run("c1", "sa-1");
    const ending = looks.ended("c1", "sa-1");
    await new Promise((r) => setImmediate(r));
    gets = 0;
    for (let i = 0; i < 10; i++) bus.publish({ type: "subagent-progress", chainId: "c1", id: "sa-1", progress: { round: i } });
    assert.equal(gets, 0, "its progress: nothing read");
    reg.subs.get("sa-1").runId = "run-1";
    bus.publish({ type: "subagent", chainId: "c1", id: "sa-1", status: "running", runId: "run-1" });
    assert.deepEqual(await running, { ok: true, runId: "run-1", status: "running", report: "", error: null, model: "m-main", provider: "Anthropic", asked: lookWords({ command: "git push --force", folder: "/w", why: "asks" }) });
    Object.assign(reg.subs.get("sa-1"), { status: "done", exchanges: [{ report: "Fine.", error: null }] });
    bus.publish({ type: "subagent", chainId: "c1", id: "sa-1", status: "done", runId: "run-1" });
    assert.deepEqual(await ending, { status: "done", report: "Fine.", error: null });
    assert.equal(bus.size(), 0, "and both let go");
  });

  // (fails before: yes — the registry had no second look)
  test("in the registry: no seat, no mark in the chat, its answer held for the person", async () => {
    const cards = createAgentCardStore({ dataDir: null });
    /** @type {any[]} */
    const marks = [];
    /** @type {Map<string, () => void>} */
    const gates = new Map();
    /** @type {ReturnType<typeof createSubagentRegistry>} */
    let registry;
    let n = 0;
    registry = createSubagentRegistry({
      now: () => Date.UTC(2026, 9, 24, 9, 0, 0),
      config: () => ({ agentLoop: { subagents: {} } }),
      log: () => {},
      events: { publish: () => {} },
      runs: null,
      context: /** @type {any} */ ({
        card: (/** @type {string} */ tag) => cards.find(tag),
        settings: () => ({ subagents: { pool: [{ model: "flash" }], most: 4, view: "none", ask: [] }, loop: { permissions: "edit" } }),
        teamMost: () => null,
        session: () => ({ cwd: tmpdir(), model: "m-main", projectId: "p1" }),
        view: async () => ({ text: "User: ship it", turns: 1 }),
        brief: async () => null,
        modelProblem: () => null,
        modelFacts: (/** @type {string} */ name) => ({ problem: null, limit: null, at: { upstream: "u", model: name } }),
        agentOf: () => null,
        mark: (/** @type {string} */ _chain, /** @type {any} */ m) => (marks.push(m), { ...m, afterTurn: 1 }),
      }),
      call: /** @type {any} */ (async (/** @type {any} */ { body, headers = {} }) => {
        const id = headers["x-filament-subagent"];
        const runId = `run-${++n}`;
        registry.attach(id, runId);
        await new Promise((res) => gates.set(id, () => res(undefined)));
        const text = "1. What it does: pushes over main.\n2. Production: no.\n3. What can go wrong: lost commits.\n4. Way back: the reflog.\n5. Verdict: wait.";
        registry.finish(id, { status: "done", error: null, report: text, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text }] }], rounds: 1, toolCalls: 0, tokensIn: 10, tokensOut: 5, spentUsd: 0, roundIds: [] });
        return { ok: true, status: 200, json: { content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
      }),
    });
    const r = /** @type {any} */ (registry.launch(/** @type {any} */ ({ origin: "self", second: true, chainId: "c1", as: REVIEWER, may: "read", prompt: lookWords({ command: "git push --force", folder: tmpdir(), why: "x" }), description: "Second look", why: "the rule … asks" })));
    assert.equal(r.ok, true, r.error);
    const sa = /** @type {any} */ (registry.get(r.id));
    assert.deepEqual([sa.second, sa.origin, sa.may, sa.seat, sa.card.tag], [true, "self", "read", null, "reviewer"]);
    await until(() => gates.has(r.id), "its request");
    /** @type {() => void} */ (gates.get(r.id))();
    await r.done;
    const ended = /** @type {any} */ (registry.get(r.id));
    assert.equal(ended.status, "done");
    assert.match(ended.exchanges[0].report, /^1\. What it does: pushes over main\./);
    assert.deepEqual([marks, registry.queued("c1")], [[], 0], "no dispatch, no arrival; nothing sent to the chat's agent");
    // The same card Filament starts itself, not as a second look (a steer's fork), marks the chat as ever.
    const self = /** @type {any} */ (registry.launch(/** @type {any} */ ({ origin: "self", chainId: "c1", as: REVIEWER, prompt: "doubt the plan", description: "Doubts", why: "the turn ended" })));
    assert.equal(self.ok, true);
    assert.deepEqual(marks.map((m) => m.event), ["dispatch"]);
    await until(() => gates.has(self.id), "its request");
    /** @type {() => void} */ (gates.get(self.id))();
    await self.done;
  });

  // The owner's word of 10-31: the model a button's look or check runs on is said before it starts, with why, and the
  // person's choice is the one it runs on.
  // (fails before: yes — the registry said nothing of it before the launch, which named no model)
  test("selfModel: its card's model, else the first of the chat's list that can run, else the chat's own, with why; a launch runs on the model named", async () => {
    const cards = createAgentCardStore({ dataDir: null });
    /** @type {string[]} */
    let cardModels = [];
    /** @type {any[]} */
    let pool = [{ model: "flash" }];
    let broken = "";
    const registry = createSubagentRegistry({
      now: () => Date.UTC(2026, 9, 31, 9, 0, 0),
      config: () => ({ agentLoop: { subagents: {} } }),
      log: () => {},
      events: { publish: () => {} },
      runs: null,
      context: /** @type {any} */ ({
        card: (/** @type {string} */ tag) => {
          const c = cards.find(tag);
          return c && cardModels.length ? { ...c, models: cardModels, model: cardModels[0] } : c;
        },
        settings: () => ({ subagents: { pool, most: 4, view: "none", ask: [] }, loop: { permissions: "edit" } }),
        teamMost: () => null,
        session: () => ({ cwd: tmpdir(), model: "m-main", projectId: "p1" }),
        view: async () => ({ text: "", turns: 0 }),
        brief: async () => null,
        modelProblem: (/** @type {string} */ m) => (m === broken ? "its key is gone" : null),
        modelFacts: (/** @type {string} */ name) => ({ problem: name === broken ? "its key is gone" : null, limit: null, at: { upstream: "u", model: name, name: "Anthropic" } }),
        agentOf: () => null,
        mark: (/** @type {string} */ _chain, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
      }),
      call: /** @type {any} */ (() => new Promise(() => {})),
    });
    assert.deepEqual(registry.selfModel("c1", REVIEWER), { model: "flash", why: "the first of that chat's models for its agents that can run" });
    broken = "flash";
    pool = [{ model: "flash" }, { model: "" }];
    assert.deepEqual(registry.selfModel("c1", REVIEWER), { model: "m-main", why: "that chat's own model" }, "the first that can run: the chat's own row");
    broken = "";
    pool = [{ model: "" }];
    assert.deepEqual(registry.selfModel("c1", REVIEWER), { model: "m-main", why: "that chat's own model" });
    cardModels = ["brain-card", "brain-second"];
    assert.deepEqual(registry.selfModel("c1", REVIEWER), { model: "brain-card", why: "the Reviewer's card names it" });
    broken = "brain-card";
    assert.deepEqual(registry.selfModel("c1", REVIEWER), { model: "brain-second", why: "the Reviewer's card names it" }, "its card's first that can run");
    cardModels = ["brain-card"];
    assert.deepEqual(registry.selfModel("c1", REVIEWER), { model: "brain-card", why: "the Reviewer's card names it" }, "none can: its first, which the person is told cannot run");
    assert.equal(registry.selfModel("c1", "nobody"), null);
    // The person's choice is what it runs on — whatever its card says — and the run says it, with its provider.
    broken = "";
    const r = /** @type {any} */ (registry.launch(/** @type {any} */ ({ origin: "self", second: true, chainId: "c1", as: REVIEWER, may: "read", prompt: "look", description: "Second look", why: "you asked", model: "brain-chosen" })));
    assert.equal(r.ok, true, r.error);
    const sa = /** @type {any} */ (registry.get(r.id));
    assert.deepEqual([sa.model, sa.provider], ["brain-chosen", "Anthropic"]);
    registry.stop(r.id, { from: "filament" });
  });
});

describe("on the page", () => {
  /** A look's stand-in: what it was asked to draw. */
  const drawn = () => {
    /** @type {any[]} */
    const refs = [];
    const look = /** @type {any} */ ((/** @type {any} */ ref, /** @type {any} */ o) => (refs.push([ref, typeof o?.h]), { el: fakeH("section", { class: "slk-stand-in" }), stop() {} }));
    return { refs, look };
  };

  // (fails before: yes — the card had no review)
  test("the permission card: the rule at its head, the Reviewer's look on top, Allow and Deny alone", () => {
    const d = drawn();
    const paused = { kind: "permission", tool: "bash", question: "May I run this command? A rule of this session asks for a second look first.", command: "git push --force origin main", offer: { itemId: 3, tool: "bash", shape: "git push" }, review: "bash(git push*--force*) review · Second look before risky commands", look: { chain: "c1", agent: "sa-1" } };
    const el = /** @type {any} */ (permissionBlock({ paused }, { onAnswer: () => {}, onAlways: () => {} }, { h: fakeH, look: d.look }));
    assert.ok(el.classList.contains("is-review"));
    assert.equal(textOf(one(el, "ix-rule")), "rule: review · |git push*--force*| · Second look before risky commands");
    assert.deepEqual(d.refs, [[{ chain: "c1", agent: "sa-1" }, "function"]]);
    assert.ok(one(el, "slk-stand-in"));
    assert.deepEqual(rows(el).map((x) => textOf(x)), ["Allow|only this time", "Deny|reject it for now"], "no Always allow, though one is offered");
    const plain = /** @type {any} */ (permissionBlock({ paused: { ...paused, review: undefined, look: undefined } }, { onAnswer: () => {}, onAlways: () => {} }, { h: fakeH, look: d.look }));
    assert.deepEqual([plain.classList.contains("is-review"), one(plain, "ix-rule"), d.refs.length, rows(plain).length], [false, null, 1, 3]);
    assert.deepEqual(reviewWords("bash(git push*--force*) review"), { pattern: "git push*--force*", shipped: "" });
    assert.deepEqual(reviewWords("bash(a (b) c) review · Second look before risky commands"), { pattern: "a (b) c", shipped: "Second look before risky commands" });
    assert.deepEqual(pauseOf(/** @type {any} */ ({ kind: "permission", question: "q", review: "bash(x) review", look: { error: "none" } })).look, { error: "none" });
  });

  // (fails before: yes — the same)
  test("a worker's line: the look under it, the rule named, no Always allow", () => {
    const d = drawn();
    const row = { id: "sa_1", card: { tag: "tester", name: "Tester", kind: "worker" }, asked: false, may: "edit", status: "running", team: { team: "architect", role: "tester" },
      progress: { asking: { tool: "bash", args: "git push --force", question: "May I run this command?", command: "git push --force", offer: { itemId: 1, tool: "bash", shape: "git push" }, review: "bash(git push*--force*) review", look: { chain: "c1", agent: "sa-2" } } } };
    const line = /** @type {any} */ (workerLine(fakeH, /** @type {any} */ (row), { answer: async () => true, always: async () => true, reveal: () => {}, place: (/** @type {any} */ p, /** @type {any[]} */ k) => p.replaceChildren(...k), look: d.look }));
    assert.equal(String(line.attrs.class), "ask-strip-look");
    assert.ok(one(line, "ask-strip") && one(line, "slk-stand-in"));
    assert.equal(textOf(one(line, "ix-rule")), "rule: review · |git push*--force*");
    assert.deepEqual(d.refs, [[{ chain: "c1", agent: "sa-2" }, "function"]]);
    assert.ok(!textOf(line).includes("Always"), textOf(line));
    const plain = /** @type {any} */ (workerLine(fakeH, /** @type {any} */ ({ ...row, progress: { asking: { ...row.progress.asking, review: undefined, look: undefined } } }), { answer: async () => true, always: async () => true, reveal: () => {}, place: (/** @type {any} */ p, /** @type {any[]} */ k) => p.replaceChildren(...k), look: d.look }));
    assert.deepEqual([String(plain.attrs.class), d.refs.length], ["ask-strip", 1]);
  });

  // (fails before: yes — there were no such words)
  test("its words: the answer's lines with their labels, what it reads, how long; a rule's words and the switch's", () => {
    assert.deepEqual(lookLines("1. **What it does:** pushes\n\n2) Production: no\n- `Way back`: reflog\n  • Verdict: wait  \n"), ["What it does: pushes", "Production: no", "Way back: reflog", "Verdict: wait"]);
    // Its words before its first numbered line are not its answer: none while it comes, every line once done where it numbered none.
    assert.deepEqual(lookAnswer("Let me look at what it changes."), []);
    assert.deepEqual(lookAnswer("Let me look.\n**1.** What it does: pushes\n  over main\n2. Production: no"), ["What it does: pushes", "over main", "Production: no"]);
    assert.deepEqual(lookAnswer("It pushes over main.\nVerdict: wait", true), ["It pushes over main.", "Verdict: wait"]);
    assert.deepEqual(lookAnswer("Here it is:\n1. Verdict: safe", true), ["Verdict: safe"]);
    assert.deepEqual(lookLine("What can go wrong: lost commits: all of them"), { label: "What can go wrong", text: "lost commits: all of them" });
    assert.deepEqual(lookLine("it pushes: over main"), { label: "", text: "it pushes: over main" }, "a label starts with a capital");
    assert.equal(readingWords({ type: "tool-start", name: "bash", args: "git log -5" }), "bash git log -5");
    assert.equal(readingWords({ type: "tool-end", name: "bash" }), null);
    assert.equal(/** @type {string} */ (readingWords({ type: "tool-start", name: "read", args: "x".repeat(200) })).length, 90);
    assert.deepEqual([lookTime(0), lookTime(6400), lookTime(60_000), lookTime(72_000)], ["0 s", "6 s", "1 min", "1 min 12 s"]);
    assert.equal(roundText({ blocks: [{ type: "text", text: "old" }, { type: "thinking", text: "hm" }, { type: "text", text: "new " }, { type: "text", text: "words" }] }, 1), "new words");
    assert.equal(roundText(null, 0), "");
    assert.equal(ruleWords({ tool: "bash", pattern: "git push*--force*", verdict: "review" }), "Asks with a second look before running `git push*--force*`");
    // (fails before: yes — the guide never named it, so no agent marked a button) The agent that builds a dashboard is told of it.
    assert.match(ARTIFACT_GUIDE.dashboard, /`secondLook`: true for a button whose act reaches production/);
    // A check after it ran (S5d): the author says what to look for.
    assert.match(ARTIFACT_GUIDE.dashboard, /`verify`: for a button whose result is worth a look once it ran, what an agent should look for, a line \(300 characters at most\) with \{row\.<column>\} for a value/);
    // Neither starts an agent by itself (the owner's word of 10-31): the author offers, the developer asks, on the model
    // they choose. (fails before: yes — the guide said the sheet opens with the look, and verify ticks the check)
    assert.match(ARTIFACT_GUIDE.dashboard, /its sheet offers the developer a second look: the Reviewer, which only reads, starts when they ask for it, on the model they choose/);
    assert.match(ARTIFACT_GUIDE.dashboard, /The sheet says it beside "Then have an agent check it", which stays off until the developer ticks it/);
    assert.doesNotMatch(ARTIFACT_GUIDE.dashboard, /its sheet opens with a second look|It ticks the sheet's/);
  });

  // (fails before: yes — nothing drew a second look)
  test("the look itself: none says why; it follows the run — what it reads, its words as they come — and ends on its lines; ended before the page asked, the registry's answer", async () => {
    const none = secondLookView({ error: "the chat it would run in is gone" }, { h: fakeH });
    assert.equal(said(none.el), "No second look:|the chat it would run in is gone");
    assert.ok(none.el.classList.contains("is-none"));
    assert.ok(secondLookView(null, { h: fakeH }).el.classList.contains("is-none"));
    let at = 1000;
    /** @type {any} */
    let follow = null;
    /** @type {string[]} */
    const got = [];
    const live = secondLookView({ chain: "c1", agent: "sa-1" }, {
      h: fakeH,
      now: () => at,
      get: async (p) => (got.push(p), { ok: true, runId: "run-7", status: "running", report: "", error: null }),
      follow: /** @type {any} */ ((/** @type {string} */ runId, /** @type {any} */ o) => ((follow = { runId, ...o }), { stop: () => void (follow.stopped = true) })),
    });
    assert.match(said(one(live.el, "slk-state")), /^· Reviewer is reading… 0 s$/);
    await until(() => follow, "it follows the run");
    assert.deepEqual([got, follow.runId, follow.words], [["/sessions/c1/second-looks/sa-1"], "run-7", true]);
    // Its first round says what it will read: not its answer, drawn as no line (seen live as "1. Let me look.").
    follow.onEvent({ type: "round-start", blocksBefore: 0 });
    follow.onWords({ type: "words", blocks: [{ type: "text", text: "Let me look." }] });
    follow.onEvent({ type: "round-text", text: "Let me look." });
    assert.equal(one(live.el, "slk-lines").kids.length, 0, "no line before its answer");
    follow.onEvent({ type: "round-start", blocksBefore: 1 });
    follow.onEvent({ type: "tool-start", name: "bash", args: "git log origin/main..HEAD" });
    assert.equal(said(one(live.el, "slk-doing")), "reads bash git log origin/main..HEAD");
    follow.onWords({ type: "words", blocks: [{ type: "text", text: "Let me look." }, { type: "text", text: "1. What it does: pushes\n2. Production: no" }] });
    assert.deepEqual(one(live.el, "slk-lines").kids.map((/** @type {any} */ li) => textOf(li)), ["What it does: |pushes", "Production: |no"], "its words as they come, its earlier round's left out");
    at = 7400;
    follow.onEvent({ type: "run-end", status: "done" });
    assert.equal(said(one(live.el, "slk-state")), "· Reviewer · 6 s");
    assert.ok(live.el.classList.contains("is-done"));
    live.stop();
    assert.equal(follow.stopped, true);
    // Ended before the page asked: the registry's answer whole; stopped, why.
    const late = secondLookView({ chain: "c1", agent: "sa-2" }, { h: fakeH, get: async () => ({ ok: true, runId: "run-8", status: "done", report: "1. Verdict: safe", error: null }), follow: /** @type {any} */ (() => assert.fail("nothing to follow")) });
    await until(() => late.el.classList.contains("is-done"), "drawn from the registry");
    assert.deepEqual([said(one(late.el, "slk-state")), said(one(late.el, "slk-lines"))], ["· Reviewer · done", "Verdict: |safe"]);
    const cut = secondLookView({ chain: "c1", agent: "sa-3" }, { h: fakeH, get: async () => ({ ok: true, runId: "run-9", status: "aborted", report: "", error: "Filament stopped it" }) });
    await until(() => cut.el.classList.contains("is-done"), "its stop");
    assert.equal(said(one(cut.el, "slk-state")), "· the Reviewer stopped: Filament stopped it");
    const gone = secondLookView({ chain: "c1", agent: "sa-4" }, { h: fakeH, get: async () => { throw new Error("that second look is no longer kept"); } });
    await until(() => gone.el.classList.contains("is-done"), "why not");
    assert.equal(said(one(gone.el, "slk-state")), "· none: that second look is no longer kept");
  });

  // The owner's word of 10-31: an agent's look says what runs it — the Reviewer, on which model, at which provider —, what
  // it was asked, whole, and where its card is, whose model the person may set for every look after.
  // (fails before: yes — the look said "Reviewer is reading…" and nothing of its model, its provider or its task)
  test("the look says who reads, on which model and provider, what it was asked, and opens the Reviewer's card", async () => {
    const asked = "This is a second look, for Filament: …\n\nThe command: npx wrangler rollback 3f2a --yes";
    let cards = 0;
    const view = secondLookView({ chain: "c1", agent: "sa-6" }, {
      h: fakeH,
      get: async () => ({ ok: true, runId: "run-11", status: "running", report: "", error: null, model: "brain-skeptic", provider: "Anthropic", asked }),
      follow: /** @type {any} */ (() => ({ stop: () => {} })),
      modelName: (/** @type {string} */ id) => (id === "brain-skeptic" ? "Brain Reviewer" : id),
      openCard: () => void cards++,
    });
    const meta = () => one(view.el, "slk-meta");
    assert.equal(meta().hidden, true, "nothing to say before its run is known");
    await until(() => !meta().hidden, "its model, once known");
    assert.equal(said(one(view.el, "slk-on")), "On Brain Reviewer · Anthropic");
    const task = one(view.el, "slk-asked");
    assert.deepEqual([task.hidden, said(task)], [true, asked], "what it was asked, whole, folded");
    const toggle = one(view.el, "slk-asked-toggle");
    assert.equal(said(toggle), "What it was asked");
    toggle.dispatch("click");
    assert.equal(task.hidden, false);
    assert.equal(toggle.attrs["aria-expanded"], "true");
    one(view.el, "slk-card").dispatch("click");
    assert.equal(cards, 1, "the Reviewer's card, where its model is set for every look");
    view.stop();
    // A model with no provider known: the model alone.
    const bare = secondLookView({ chain: "c1", agent: "sa-7" }, { h: fakeH, get: async () => ({ ok: true, runId: null, status: "done", report: "1. Verdict: safe", error: null, model: "m-main", provider: null, asked: "x" }), modelName: (/** @type {string} */ id) => id, openCard: () => {} });
    await until(() => bare.el.classList.contains("is-done"), "drawn from the registry");
    assert.equal(said(one(bare.el, "slk-on")), "On m-main");
  });

  // (fails before: yes — a look stopped while it asked where its run is (its card answered, its sheet closed) followed
  // the run once the answer came, and nothing stopped that follow: a Reviewer gone quietly, with no end in its log, was
  // followed for as long as the page lived)
  test("a look stopped before it knew its run follows nothing", async () => {
    /** @type {(r: any) => void} */
    let answer = () => {};
    let follows = 0;
    const view = secondLookView({ chain: "c1", agent: "sa-5" }, {
      h: fakeH,
      get: () => new Promise((resolve) => { answer = resolve; }),
      follow: /** @type {any} */ (() => (follows++, { stop: () => {} })),
    });
    view.stop();
    answer({ ok: true, runId: "run-10", status: "running", report: "", error: null });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(follows, 0, "nothing follows a look already stopped");
  });

  // A look Filament stopped as its question ended — a rewind took the turn that asked away — is still named by the pause
  // an undone rewind brings back, and the card draws it from the registry's answer (the decision of 11-02): stopped, its
  // words none of the Reviewer's, and nothing on it acts on the look.
  // (fails before: yes — drawn as "· Reviewer · done", Filament's note "(Filament: Filament stopped this task …)" drawn as
  // the Reviewer's answer line)
  test("a look Filament stopped is drawn stopped: no answer of its, nothing that acts on it", async () => {
    const note = "(Filament: Filament stopped this task after 0 tool calls; no reply had been written yet.)";
    const view = secondLookView({ chain: "c1", agent: "sa-8" }, { h: fakeH, get: async () => ({ ok: true, runId: "run-12", status: "stopped", report: note, error: null, model: "m-main", provider: null, asked: "x" }), follow: /** @type {any} */ (() => assert.fail("nothing to follow")), modelName: (/** @type {string} */ id) => id, openCard: () => {} });
    await until(() => view.el.classList.contains("is-done"), "drawn from the registry");
    assert.equal(said(one(view.el, "slk-state")), "· the Reviewer was stopped before it answered");
    assert.equal(one(view.el, "slk-lines").kids.length, 0, "no line of its");
    assert.deepEqual(buttonsOf(view.el).map((/** @type {any} */ b) => textOf(b)), ["What it was asked", "The Reviewer's card"], "what it was asked and its card, nothing that acts on the look");
    // Stopped once it had said some of its lines: those, under the same words.
    const partway = secondLookView({ chain: "c1", agent: "sa-9" }, { h: fakeH, get: async () => ({ ok: true, runId: "run-13", status: "stopped", report: "1. What it does: pushes", error: null }) });
    await until(() => partway.el.classList.contains("is-done"), "drawn from the registry");
    assert.deepEqual([said(one(partway.el, "slk-state")), said(one(partway.el, "slk-lines"))], ["· the Reviewer was stopped", "What it does: |pushes"]);
  });
});

describe("end to end on a native session", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = folder("e2e");
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  /** @type {any[]} */
  const skeptic = [];
  const LINES = "1. What it does: rewrites main on origin.\n2. Production: no.\n3. What can go wrong: others' commits lost.\n4. Way back: push the old head from the reflog.\n5. Verdict: wait.";
  before(async () => {
    up = await fakeUpstream(async (call) => {
      if (JSON.stringify(call.body?.messages ?? "").includes("This is a second look, for Filament")) {
        skeptic.push(call);
        return anthropicReply("", { model: "brain-model", stop: "end_turn", blocks: [{ type: "text", text: LINES }], usage: { input_tokens: 30, output_tokens: 7 } });
      }
      return brain(call);
    });
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
    made.push(shim.dataDir);
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });
  const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });

  // (fails before: yes — Full access pushed with --force unasked)
  test("the switch on, Full access: a forced push pauses with the rule and the Reviewer's run; its five lines come back to the page; Deny stops nothing that ended and runs nothing", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { loop: { permissions: "auto", secondLook: true } } } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    let round = 0;
    brain = () => (++round === 1 ? reply([{ type: "tool_use", id: "b1", name: "bash", input: { command: "git push --force origin main" } }], "tool_use") : reply([{ type: "text", text: "Left as it is." }]));
    const t = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "push it", stream: false } });
    assert.equal(t.status, 200);
    const row = await (await shim.api(`/api/sessions/${id}/transcript?limit=5&work=0`)).json();
    const p = row.paused;
    assert.equal(p?.kind, "permission", JSON.stringify(row.paused ?? null));
    assert.equal(p.review, "bash(git push*--force*) review · Second look before risky commands");
    assert.equal(p.look?.chain, id, JSON.stringify(p.look));
    assert.match(String(p.look.agent), /\S/);
    assert.match(String(p.question), /A rule of this session asks for a second look first\.$/);
    // The page asks where its run is, and reads its end.
    const look = `/api/sessions/${id}/second-looks/${encodeURIComponent(p.look.agent)}`;
    const first = await (await shim.api(look)).json();
    assert.match(String(first.runId), /\S/, JSON.stringify(first));
    await until(async () => (await (await shim.api(look)).json()).status !== "running", "the Reviewer's end");
    const end = await (await shim.api(look)).json();
    assert.deepEqual([end.status, end.report], ["done", LINES]);
    assert.equal(skeptic.length, 1);
    assert.match(JSON.stringify(skeptic[0].body.messages), /The command: git push --force origin main/);
    const agents = await (await shim.api(`/api/sessions/${id}/subagents`)).json();
    const sa = (agents.subagents || agents).find((/** @type {any} */ s) => s.id === p.look.agent);
    assert.deepEqual([sa?.second, sa?.may, sa?.card?.tag, agents.queued], [true, "read", "reviewer", 0], "its answer stays with the person");
    // Its run says so in the runs list the left bar reads: its chat takes no working mark and no unread dot for it
    // (seen live, S5d: a check left its chat a dot that opened on nothing new).
    // (fails before: yes)
    const runs = await (await shim.api("/api/runs?limit=50")).json();
    const run = (runs.runs || runs).find((/** @type {any} */ x) => x.id === first.runId);
    assert.deepEqual([run?.meta?.subagent, run?.meta?.chain, run?.meta?.second], [p.look.agent, id, true], JSON.stringify(run?.meta ?? null));
    const bar = readFileSync(new URL("../src/ui/harness/sidebar.js", import.meta.url), "utf8");
    assert.match(bar, /if \(!chain \|\| seen\.has\(chain\) \|\| run\.meta\?\.second \|\| run\.meta\?\.weighs\) continue;/, "the left bar leaves it out");
    const stop = await shim.api(`${look}/stop`, { method: "POST" });
    assert.deepEqual(await stop.json(), { ok: true, ran: false });
    assert.equal((await shim.api(`/api/sessions/${id}/second-looks/sa_nope`)).status, 404);
    const no = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "no", stream: false } });
    assert.equal(no.status, 200);
    assert.equal(round, 2, "declined: the model heard so, and the push never ran");
  });
});
