// @ts-check
// HarnessV3-TaskGraph-v2 §12 (V2-0a), a lead's looks apart from the registry and the loop (app/agent/looks.js): when a
// look is due (TG2-D15), its words (TG2-D14, §12.6), its marks taken and handed back, and the rule that keeps one look
// in the lead's conversation (TG2-D24).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LOOK_GONE, LOOK_STUB, createLooks, holdsLook, isLook, newMark, noted, patchWords, tidyLooks, withoutLooks } from "../src/app/agent/looks.js";

/**
 * A lead's turn over workers whose run logs the test writes: `log(id, event)` records an event as the run log would
 * (numbered) and notes it on the worker's mark, as the registry does.
 * @param {{ seconds?: number, lean?: boolean, files?: any }} [o]
 */
function bench({ seconds = 30, lean = false, files = null } = {}) {
  let clock = 1_000_000;
  /** @type {{ fn: () => void, at: number }[]} */
  const timers = [];
  /** @type {Map<string, any[]>} */
  const logs = new Map();
  /** @type {import("../src/app/agent/looks.js").Watched[]} */
  const watched = [];
  let rings = 0;
  const looks = createLooks({ now: () => clock, later: (fn, ms) => void timers.push({ fn, at: clock + ms }), seconds: () => seconds, lean, workers: () => watched, eventsOf: (run) => logs.get(run) || [], wake: () => void rings++ });
  return {
    looks,
    rings: () => rings,
    /** @param {string} id @param {string} role @param {string} description @param {string | null} [task] */
    worker(id, role, description, task = null) {
      logs.set(`run-${id}`, []);
      watched.push({ id, role, description, task, run: `run-${id}`, head: ["round 1"], mark: newMark() });
      return /** @type {import("../src/app/agent/looks.js").Watched} */ (watched.at(-1));
    },
    /** @param {string} id */
    gone(id) {
      watched.splice(watched.findIndex((w) => w.id === id), 1);
    },
    /** @param {string} id @param {any} e */
    log(id, e) {
      const list = /** @type {any[]} */ (logs.get(`run-${id}`));
      const evt = { n: list.length + 1, ts: clock, ...e };
      list.push(evt);
      const w = /** @type {import("../src/app/agent/looks.js").Watched} */ (watched.find((x) => x.id === id));
      if (noted(w.mark, evt, files)) looks.ring();
    },
    /** @param {number} ms */
    pass(ms) {
      clock += ms;
      for (const t of timers.splice(0).sort((a, b) => a.at - b.at)) t.at <= clock ? t.fn() : timers.push(t);
    },
  };
}
const edit = (/** @type {string} */ id, /** @type {string} */ path, round = 2) => ({ type: "tool-start", round, id, name: "edit", args: path, card: { kind: "edit", subject: path } });

describe("when a look is due (TG2-D15)", () => {
  test("a worker's first reply rings the lead once it goes on from it, and the look opens with its plan", () => {
    const b = bench();
    b.worker("sa_1", "builder", "parse the ledger file");
    b.log("sa_1", { type: "round-start", round: 1 });
    assert.equal(b.looks.due(), false, "a round that has shown nothing is nothing to look at");
    b.log("sa_1", { type: "round-thinking", round: 1, thinking: "Floats lose cents. I will parse into integers." });
    b.log("sa_1", { type: "round-text", round: 1, text: "Plan: read src/ledger.js, then change parse()." });
    // A reply the run may end on rings nobody: were it the last, it is the report, which reaches the lead by itself.
    assert.deepEqual([b.rings(), b.looks.due()], [0, false]);
    // (fails before: nothing but a report, the developer's message or the wait's own timer ended a lead's wait)
    b.log("sa_1", { type: "tool-start", round: 1, id: "c1", name: "read", args: "src/ledger.js", card: { kind: "read", subject: "src/ledger.js" } });
    assert.deepEqual([b.rings(), b.looks.due()], [1, true]);
    const look = b.looks.take();
    assert.ok(look);
    // Its words and its calls: its thinking is in no look (HarnessV3-TaskGraph-v2 TG2-D60).
    assert.equal(look.text, [
      "[Filament: a look at your workers. 1 is running.]",
      "",
      '## builder sa_1 — "parse the ledger file"',
      "round 1 · sign: said how it will go about its task",
      "Its plan (round 1): Plan: read src/ledger.js, then change parse().",
      "",
      "Round 1",
      "Said: Plan: read src/ledger.js, then change parse().",
      "Called read `src/ledger.js` → still running",
    ].join("\n"));
    assert.deepEqual(look.meta.workers, [{ id: "sa_1", run: "run-sa_1", fromEvent: 0, toEvent: 4, fromRound: 1, toRound: 1, signs: ["plan"] }]);
    assert.ok(look.meta.tokens > 0);
    assert.equal(b.looks.due(), false);
  });

  test("a worker whose first reply is its last rings nobody: its report tells it", () => {
    const b = bench({ seconds: 0 });
    b.worker("sa_1", "scout", "map the folder");
    b.log("sa_1", { type: "round-start", round: 1 });
    b.log("sa_1", { type: "round-thinking", round: 1, thinking: "Two files." });
    b.log("sa_1", { type: "round-text", round: 1, text: "SCOUT REPORT: a.txt and big.txt are here." });
    b.log("sa_1", { type: "turn-state", from: "planning", to: "done" });
    // (fails before: the reply rang the lead, which read the scout's words in a look and again in its report)
    assert.deepEqual([b.rings(), b.looks.due()], [0, false]);
    // A second round is the run going on: what it said before is new to a look then.
    const c = bench({ seconds: 0 });
    c.worker("sa_2", "scout", "map the folder");
    c.log("sa_2", { type: "round-text", round: 1, text: "I will list the files." });
    c.log("sa_2", { type: "round-start", round: 2 });
    assert.deepEqual([c.rings(), c.looks.due()], [1, true]);
    assert.deepEqual(/** @type {any} */ (c.looks.take()).meta.workers[0].signs, ["plan"]);
  });

  test("with no sign a look waits for the pace, and is due sooner on a write outside the worker's files", () => {
    const b = bench({ seconds: 30, files: { files: ["src/ledger.js"] } });
    b.worker("sa_1", "builder", "parse the ledger file");
    b.log("sa_1", { type: "round-text", round: 1, text: "Plan." });
    b.log("sa_1", { type: "tool-start", round: 1, id: "c1", name: "read", args: "src/ledger.js", card: { kind: "read", subject: "src/ledger.js" } });
    b.looks.take();
    const rung = b.rings();
    b.log("sa_1", { type: "tool-end", round: 1, id: "c1", name: "read", ok: true, chars: 10 });
    assert.deepEqual([b.looks.due(), b.rings()], [false, rung], "something is new, and the pace has not passed");
    b.pass(29_000);
    assert.equal(b.looks.due(), false);
    b.pass(1_000);
    assert.deepEqual([b.looks.due(), b.rings()], [true, rung + 1], "the pace passed: the lead is rung once");
    b.looks.take();
    // The first change is a sign, and so is a write outside the brief's files: each is due at once.
    b.log("sa_1", edit("c2", "src/ledger.js"));
    assert.equal(b.looks.due(), true);
    assert.match(/** @type {any} */ (b.looks.take()).text, /sign: made its first change \(src\/ledger\.js\)/);
    b.log("sa_1", edit("c3", "src/cli.js", 3));
    assert.equal(b.looks.due(), true);
    const look = /** @type {any} */ (b.looks.take());
    assert.match(look.text, /sign: wrote outside its files \(src\/cli\.js\)/);
    assert.deepEqual(look.meta.workers[0].signs, ["outside"]);
  });

  test("a pace of 0 is every round; a lead that asks gets a look with nothing new; no worker, no look", () => {
    const b = bench({ seconds: 0 });
    assert.equal(b.looks.take(), null);
    b.worker("sa_1", "tester", "tests for money");
    b.log("sa_1", { type: "round-text", round: 1, text: "Plan: write three tests." });
    b.looks.take();
    b.log("sa_1", { type: "tool-start", round: 1, id: "c1", name: "read", args: "a.js" });
    assert.equal(b.looks.due(), true, "at pace 0 anything new is due");
    b.looks.take();
    assert.equal(b.looks.due(), false);
    b.looks.ask();
    assert.equal(b.looks.due(), true);
    const look = /** @type {any} */ (b.looks.take());
    // Its head line, its plan and what it did so far: a look stands without the one before it.
    assert.equal(look.text, [
      "[Filament: a look at your workers, in place of the one before. Since it: 0 moved, 1 did not.]",
      "",
      '## tester sa_1 — "tests for money"',
      "round 1",
      "Its plan (round 1): Plan: write three tests.",
      "So far (round 1): read 1 file",
      "Nothing new since your last look.",
    ].join("\n"));
    b.gone("sa_1");
    b.looks.ask();
    assert.deepEqual([b.looks.due(), b.looks.take()], [false, null], "a worker that reported is in no look");
  });
});

describe("a look's words (TG2-D14, §12.6)", () => {
  /** A builder two rounds in, its first look taken. */
  const started = () => {
    const b = bench({ files: { files: ["src/ledger.js"] } });
    const w = b.worker("sa_7", "builder", "parse the ledger file", "t3");
    b.worker("sa_9", "tester", "tests for money");
    b.log("sa_7", { type: "round-thinking", round: 1, thinking: "Read first." });
    b.log("sa_7", { type: "round-text", round: 1, text: "Plan: integers." });
    b.log("sa_7", { type: "tool-start", round: 1, id: "c1", name: "read", args: "src/ledger.js", card: { kind: "read", subject: "src/ledger.js" } });
    b.log("sa_7", { type: "tool-end", round: 1, id: "c1", name: "read", ok: true, chars: 6120, preview: "FILE-BODY" });
    b.log("sa_7", edit("c2", "src/ledger.js"));
    b.log("sa_7", { type: "tool-end", round: 2, id: "c2", name: "edit", ok: true, chars: 12 });
    b.log("sa_7", { type: "tool-start", round: 2, id: "c3", name: "bash", args: "npm test -- ledger" });
    b.log("sa_9", { type: "round-text", round: 1, text: "Plan: three tests." });
    return { b, w, first: /** @type {any} */ (b.looks.take()) };
  };

  test("each round since the last look is whole; what came before is a line; a failed call shows its result's head", () => {
    const { b, w, first } = started();
    assert.match(first.text, /^\[Filament: a look at your workers\. 2 are running\.\]/);
    assert.match(first.text, /## builder sa_7 — task t3: "parse the ledger file"/);
    assert.match(first.text, /Called read `src\/ledger\.js` → ok, 6,120 characters\n/);
    assert.match(first.text, /Called bash `npm test -- ledger` → still running/);
    assert.ok(!first.text.includes("FILE-BODY"), "a call that went well is a line, never its content");
    b.log("sa_7", { type: "tool-end", round: 2, id: "c3", name: "bash", ok: false, exitCode: 1, chars: 300, preview: "1 failing\n  expected 1050" });
    b.log("sa_7", { type: "steer", id: "m1", kind: "note", text: "keep amounts as integers", from: "lead", at: 1 });
    b.log("sa_7", { type: "steer-read", ids: ["m1"], kinds: ["note"] });
    b.log("sa_7", { type: "round-thinking", round: 3, thinking: "The lead wants integers.\nCents it is." });
    b.log("sa_7", edit("c4", "src/cli.js", 3));
    w.head = ["round 3", "context ≈41,200 of 128,000 tokens (32%)"];
    const look = /** @type {any} */ (b.looks.take());
    assert.equal(look.text, [
      "[Filament: a look at your workers, in place of the one before. Since it: 1 moved, 1 did not.]",
      "",
      '## builder sa_7 — task t3: "parse the ledger file"',
      "round 3 · context ≈41,200 of 128,000 tokens (32%) · sign: wrote outside its files (src/cli.js)",
      "Its plan (round 1): Plan: integers.",
      "So far (rounds 1 to 2): read 1 file · changed src/ledger.js · ran `npm test -- ledger` once · sign, round 2: made its first change (src/ledger.js)",
      "",
      "Round 2, continued",
      "Called bash `npm test -- ledger` → exit 1:",
      "  1 failing",
      "    expected 1050",
      'Read your message at the end of this round: "keep amounts as integers"',
      "",
      "Round 3",
      "Called edit `src/cli.js` → still running",
      "",
      '## tester sa_9 — "tests for money"',
      "round 1",
      "Its plan (round 1): Plan: three tests.",
      "So far (round 1): no calls yet",
      "Nothing new since your last look.",
    ].join("\n"));
    assert.ok(![first.text, look.text].some((t) => t.includes("Read first.") || t.includes("Cents it is.")), "no look holds a worker's thinking (TG2-D60)");
    assert.deepEqual(look.meta.workers.map((/** @type {any} */ x) => [x.id, x.fromRound, x.toRound, x.signs]), [["sa_7", 2, 3, ["outside"]], ["sa_9", 1, 1, []]]);
  });

  // (fails before: yes — the V2-1 drive, run 3: a worker's write said "Successfully wrote to bin/tally.js (425 bytes)",
  // 46 characters, and its look said "ok, 46 characters", which its lead read as the file's size — a placeholder — and
  // spent two rounds making sure)
  test("a write or an edit that went well is its tool's own line, never the size of that line", () => {
    const b = bench({ files: { files: ["bin/tally.js", "src/ledger.js"] } });
    b.worker("sa_3", "builder", "the command line");
    b.log("sa_3", { type: "round-text", round: 1, text: "Plan: write it." });
    b.log("sa_3", { type: "tool-start", round: 1, id: "w1", name: "write", args: "bin/tally.js", card: { kind: "write", subject: "bin/tally.js" } });
    b.log("sa_3", { type: "tool-end", round: 1, id: "w1", name: "write", ok: true, chars: 46, preview: "Successfully wrote to bin/tally.js (425 bytes)" });
    b.log("sa_3", edit("e1", "src/ledger.js", 1));
    b.log("sa_3", { type: "tool-end", round: 1, id: "e1", name: "edit", ok: true, chars: 12 });
    b.log("sa_3", edit("e2", "src/ledger.js", 1));
    b.log("sa_3", { type: "tool-end", round: 1, id: "e2", name: "edit", ok: true, chars: 140, preview: "The file src/ledger.js has been updated. Here's a snippet of it:\n     1\tconst cents = 1;" });
    b.log("sa_3", edit("e3", "src/ledger.js", 1));
    b.log("sa_3", { type: "tool-end", round: 1, id: "e3", name: "edit", ok: true, chars: 400, preview: `Edited ${"x".repeat(400)}` });
    b.log("sa_3", { type: "tool-start", round: 1, id: "r1", name: "read", args: "README.md", card: { kind: "read", subject: "README.md" } });
    b.log("sa_3", { type: "tool-end", round: 1, id: "r1", name: "read", ok: true, chars: 1199, preview: "# tally" });
    const text = /** @type {any} */ (b.looks.take()).text;
    assert.ok(
      text.includes(
        [
          "Called write `bin/tally.js` → ok: Successfully wrote to bin/tally.js (425 bytes)",
          "Called edit `src/ledger.js` → ok",
          "Called edit `src/ledger.js` → ok: The file src/ledger.js has been updated. Here's a snippet of it:",
          `Called edit \`src/ledger.js\` → ok: Edited ${"x".repeat(153)}…`,
          "Called read `README.md` → ok, 1,199 characters",
        ].join("\n"),
      ),
      text,
    );
    assert.ok(!/\b(46|12|140|400) characters/.test(text) && !text.includes("const cents"), "a change's line, whole or cut, never its size, nor what follows it");
  });

  test("a message not read yet is on the head line", () => {
    const { b } = started();
    b.pass(40_000);
    b.log("sa_7", { type: "steer", id: "m1", kind: "note", text: "use cents", from: "lead", at: 1_000_000 });
    b.looks.ask();
    assert.match(/** @type {any} */ (b.looks.take()).text, /round 1 · your message of 40 s ago is not read yet\n/);
  });

  // (fails before: yes — HarnessV3-TaskGraph-v2 TG2-D59: Filament's word to a stuck worker read as the developer's
  // message — not read yet on its head line, read in its round, and counted with the developer's after)
  test("Filament's own word to a worker is named so, and counted as nobody's message", () => {
    const { b } = started();
    const STUCK = "`npm test -- ledger` has failed 3 times. If you do not see why, ask your lead with ask_lead: say what you tried and what it showed.";
    b.log("sa_7", { type: "steer", id: "m1", kind: "note", text: STUCK, from: "filament", at: 1_000_000 });
    b.looks.ask();
    const unread = /** @type {any} */ (b.looks.take()).text;
    assert.match(unread, /\n## builder sa_7 — task t3: "parse the ledger file"\nround 1\n/);
    assert.ok(!unread.includes("not read yet"), unread);
    b.log("sa_7", { type: "steer-read", ids: ["m1"], kinds: ["note"] });
    b.looks.ask();
    const read = /** @type {any} */ (b.looks.take()).text;
    assert.ok(read.includes(`Read Filament's word at the end of this round: "${STUCK}"`), read);
    b.log("sa_7", { type: "round-thinking", round: 3, thinking: "Ask the lead." });
    b.looks.ask();
    const after = /** @type {any} */ (b.looks.take()).text;
    assert.match(after, /\nSo far \(rounds 1 to 2\): /);
    assert.ok(!after.includes("of the developer's") && !after.includes("of yours"), after);
  });

  test("a look taken and handed back shows the same rounds again", () => {
    const { b } = started();
    b.log("sa_7", { type: "round-thinking", round: 3, thinking: "Now the CLI." });
    b.log("sa_7", edit("c4", "src/cli.js", 3));
    const one = /** @type {any} */ (b.looks.take());
    assert.equal(b.looks.due(), false);
    // (a coding agent's turn that ended before the look reached it, B12: nothing of it is queued for the next turn)
    b.looks.back(one.meta);
    assert.equal(b.looks.due(), true, "its sign is fresh again");
    assert.equal(/** @type {any} */ (b.looks.take()).text, one.text);
  });

  test("the whole trail on the lead's ask moves no mark; a coding agent's lead gets the new part only", () => {
    const { b, w } = started();
    const trail = b.looks.trail(w, 2);
    assert.match(trail, /^\[Filament: the trail of sa_7, whole from round 2\. It stays until you ask for it again\.\]\n\n## builder sa_7/);
    assert.ok(!trail.includes("Read first.") && trail.includes("Round 2\nCalled edit `src/ledger.js` → ok\n"));
    assert.ok(b.looks.trail(w).includes("Round 1\nSaid: Plan: integers.") && !b.looks.trail(w).includes("Read first."), "from its start, and none of its thinking (TG2-D60)");
    assert.equal(b.looks.due(), false);
    const lean = bench({ lean: true, files: { files: ["src/ledger.js"] } });
    lean.worker("sa_7", "builder", "parse the ledger file");
    lean.log("sa_7", { type: "round-thinking", round: 1, thinking: "Read first." });
    lean.log("sa_7", { type: "round-text", round: 1, text: "Plan: integers." });
    lean.log("sa_7", { type: "tool-start", round: 1, id: "c0", name: "read", args: "src/ledger.js" });
    const first = /** @type {any} */ (lean.looks.take()).text;
    assert.ok(first.includes("Round 1\nSaid: Plan: integers.") && !first.includes("Its plan") && !first.includes("Read first."), "its plan is in its round, once — and its thinking in none (TG2-D60)");
    lean.pass(30_000);
    lean.log("sa_7", { type: "round-thinking", round: 2, thinking: "Quiet thought." });
    lean.log("sa_7", { type: "tool-start", round: 2, id: "c1", name: "read", args: "a.js" });
    const next = /** @type {any} */ (lean.looks.take()).text;
    assert.equal(next, ["[Filament: a look at your workers. Since the last: 1 moved, 0 did not.]", "", '## builder sa_7 — "parse the ledger file"', "round 1", "", "Round 2", "Called read `a.js` → still running"].join("\n"));
  });

  test("a worker's change so far, in its lead's words", () => {
    const text = patchWords({ id: "sa_7", role: "builder" }, { files: [{ path: "src/ledger.js", added: 4, removed: 2 }], diff: "diff --git a/src/ledger.js b/src/ledger.js" });
    assert.equal(text, "[Filament: the change so far of sa_7, against where it started: 1 file. It stays until you ask for it again.]\n\n- src/ledger.js (+4 −2)\n\ndiff --git a/src/ledger.js b/src/ledger.js");
    assert.match(patchWords({ id: "sa_7", role: "builder" }, { files: [], diff: "" }), /builder sa_7 has changed nothing in its worktree yet\.$/);
  });
});

describe("the lead's conversation holds one look (TG2-D24)", () => {
  /** @returns {any} */
  const LOOK = (/** @type {number} */ n) => ({ type: "text", text: `[Filament: a look at your workers, in place of the one before. Since it: 1 moved, 0 did not.]\n\nlook ${n}` });
  /** @returns {any} */
  const use = (/** @type {string} */ id, name = "wait", input = {}) => ({ type: "tool_use", id, name, input });
  /** @returns {any} */
  const res = (/** @type {string} */ id, content = "Waited 30 s: your workers moved. A look follows as a message.") => ({ type: "tool_result", tool_use_id: id, content });
  /** @type {any} */
  const TASK = { role: "user", content: [{ type: "text", text: "Build the ledger." }] };
  /** @type {any[]} */
  const LAUNCH = [{ role: "assistant", content: [{ type: "text", text: "Launching." }, use("a1", "agent", { role: "builder" })] }, { role: "user", content: [res("a1", "Launched builder sa_7.")] }];
  const texts = (/** @type {any[]} */ convo) => convo.flatMap((m) => (m.role === "user" ? m.content : [])).filter((b) => b.type === "text").map((b) => b.text.split("\n").at(-1));

  test("a second look turns the first into its line", () => {
    /** @type {any[]} */
    const convo = [TASK, ...LAUNCH, { role: "assistant", content: [use("r1", "read", { path: "a.js" })] }, { role: "user", content: [res("r1", "A"), LOOK(1)] }, { role: "assistant", content: [use("r2", "read", { path: "b.js" })] }, { role: "user", content: [res("r2", "B"), LOOK(2)] }];
    const before = convo[4];
    // (fails before: every status block a lead was given stayed in its conversation for the rest of the turn)
    assert.deepEqual(tidyLooks(convo, { from: 1, own: 1 }), { lined: 1, left: 0 });
    assert.deepEqual(texts(convo), ["Build the ledger.", LOOK_STUB, "look 2"]);
    assert.equal(convo.length, 7, "the lead's own steps stay");
    assert.notEqual(convo[4], before, "the message is made anew, the turn's record untouched");
    assert.equal(before.content[1].text.split("\n").at(-1), "look 1");
    assert.deepEqual(tidyLooks(convo, { from: 1, own: 1 }), { lined: 0, left: 0 }, "twice in a row it changes nothing");
  });

  test("three looks answered with nothing but wait leave one wait and the newest look", () => {
    /** @type {any[]} */
    const convo = [TASK, ...LAUNCH];
    const wait = (/** @type {number} */ n, thinking = true) => {
      convo.push({ role: "assistant", content: [...(thinking ? [{ type: "thinking", thinking: "On track.", signature: "s" }] : []), use(`w${n}`)] }, { role: "user", content: [res(`w${n}`), LOOK(n)] });
      return tidyLooks(convo, { from: 1, own: 1 });
    };
    assert.deepEqual(wait(1), { lined: 0, left: 0 });
    // (fails before: three waits and three status blocks)
    assert.deepEqual(wait(2), { lined: 1, left: 1 });
    assert.deepEqual(wait(3, false), { lined: 1, left: 1 });
    assert.equal(convo.length, 5);
    assert.deepEqual(convo[3].content.map((/** @type {any} */ b) => b.type), ["thinking", "tool_use"], "the first wait, as the model wrote it");
    assert.deepEqual(convo[4].content.map((/** @type {any} */ b) => (b.type === "text" ? b.text.split("\n").at(-1) : b.tool_use_id)), ["w1", "look 3"]);
    // A report beside the look, or the lead's own words, and the round stays.
    convo.push({ role: "assistant", content: [use("w4")] }, { role: "user", content: [res("w4"), { type: "text", text: "sa_7 reported: done." }, LOOK(4)] });
    assert.deepEqual(tidyLooks(convo, { from: 1, own: 1 }), { lined: 1, left: 0 });
    convo.push({ role: "assistant", content: [{ type: "text", text: "sa_9 drifts; I told it." }, use("k1", "worker", { agent_id: "sa_9", prompt: "use cents" }), use("w5")] }, { role: "user", content: [res("k1", "Sent."), res("w5"), LOOK(5)] });
    assert.deepEqual(tidyLooks(convo, { from: 1, own: 1 }), { lined: 1, left: 0 });
    // The look the lead steered on is its line; its words and its steer stay; a quiet wait after it leaves again.
    convo.push({ role: "assistant", content: [use("w6")] }, { role: "user", content: [res("w6"), LOOK(6)] });
    assert.deepEqual(tidyLooks(convo, { from: 1, own: 1 }), { lined: 1, left: 1 });
    assert.deepEqual(texts(convo), ["Build the ledger.", LOOK_STUB, "sa_7 reported: done.", LOOK_STUB, "look 6"]);
    assert.equal(convo.at(-2).content[0].text, "sa_9 drifts; I told it.");
    assert.equal(holdsLook(convo, 1), true);
  });

  test("a round ahead of the turn's own work never leaves; a reply that said nothing and called nothing does", () => {
    /** @type {any[]} */
    const paused = [TASK, { role: "assistant", content: [use("w1")] }, { role: "user", content: [res("w1"), LOOK(1)] }, { role: "assistant", content: [use("w2")] }, { role: "user", content: [res("w2"), LOOK(2)] }];
    // The turn went on after a pause from the newest reply: what came before it is the paused half's, kept as it was.
    assert.deepEqual(tidyLooks(paused, { from: 1, own: 3 }), { lined: 1, left: 0 });
    /** @type {any[]} */
    const ended = [TASK, ...LAUNCH, { role: "assistant", content: [use("w1")] }, { role: "user", content: [res("w1"), LOOK(1)] }, { role: "assistant", content: [{ type: "thinking", thinking: "Nothing to say.", signature: "s" }] }, { role: "user", content: [LOOK(2)] }];
    assert.deepEqual(tidyLooks(ended, { from: 1, own: 1 }), { lined: 1, left: 1 });
    assert.equal(ended.length, 5);
  });

  test("a newer trail or patch of the same worker replaces the older, and a finished turn keeps none", () => {
    const trail = (/** @type {string} */ id, /** @type {string} */ body) => `[Filament: the trail of ${id}, whole from round 1. It stays until you ask for it again.]\n\n${body}`;
    const patch = (/** @type {string} */ id, /** @type {string} */ body) => `[Filament: the change so far of ${id}, against where it started: 1 file. It stays until you ask for it again.]\n\n${body}`;
    /** @type {any[]} */
    const convo = [
      TASK,
      { role: "assistant", content: [use("k1", "worker"), use("k2", "worker"), use("k3", "worker")] },
      { role: "user", content: [res("k1", trail("sa_7", "old trail")), res("k2", trail("sa_9", "the tester's")), res("k3", patch("sa_7", "old patch"))] },
      { role: "assistant", content: [use("k4", "worker"), use("k5", "worker")] },
      { role: "user", content: [res("k4", trail("sa_7", "new trail")), res("k5", patch("sa_7", "new patch")), LOOK(1)] },
    ];
    tidyLooks(convo, { from: 1, own: 1 });
    const said = () => convo.flatMap((m) => (m.role === "user" ? m.content : [])).filter((b) => b.type === "tool_result").map((b) => b.content.split("\n").at(-1));
    assert.deepEqual(said(), ["[Filament: the trail of sa_7 was here. A newer one replaces it.]", "the tester's", "[Filament: the change so far of sa_7 was here. A newer one replaces it.]", "new trail", "new patch"]);
    const kept = withoutLooks(convo.slice(1));
    assert.equal(holdsLook(kept), false);
    assert.deepEqual(kept.flatMap((m) => (m.role === "user" ? m.content : [])).filter((b) => b.type === "tool_result" && !b.content.includes("replaces")).map((b) => b.content), ["[Filament: the trail of sa_9 was here, while it ran.]", "[Filament: the trail of sa_7 was here, while it ran.]", "[Filament: the change so far of sa_7 was here, while it ran.]"]);
    assert.equal(kept.at(-1).content.at(-1).text, LOOK_GONE);
    assert.equal(isLook(convo.at(-1)?.content.at(-1)), true, "the conversation handed in is untouched");
    assert.equal(isLook({ type: "text", text: LOOK_STUB }) || isLook({ type: "text", text: LOOK_GONE }), false);
  });
});
