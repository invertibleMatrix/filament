// @ts-check
// A lead that reads along with its workers looks at each again and again while it runs. Each look read the worker's
// run from its first event — over the run, the square of its length, and past the run log's ring a read of its whole
// file every time. The reading is a fold over the events (run-work.js `createRunReader`): a look reads only what the
// log gained since the last, and holds what reading all of it at once gives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRunReader, trailOf, trailOfLog, workOfRun } from "../src/core/run-work.js";
import { createLooks, newMark, noted } from "../src/app/agent/looks.js";

/** A worker's run as its log holds it: rounds, calls, a question, the lead's notes queued, changed, dropped and read. */
const RUN = [
  { type: "run-start" },
  { type: "round-start", round: 1 },
  { type: "round-thinking", round: 1, thinking: "Integers first." },
  { type: "round-text", round: 1, text: "PLAN: read, then fix." },
  { type: "tool-start", round: 1, id: "c1", name: "read", args: "a.js", card: { kind: "read", subject: "a.js" } },
  { type: "steer", kind: "note", id: "s1", text: "mind the tests", from: "lead", at: 5 },
  { type: "tool-end", id: "c1", ok: true, preview: "const a = 1;", chars: 12 },
  { type: "steer", kind: "note", id: "s2", text: "and the docs", from: "lead", at: 6 },
  { type: "steer-edit", id: "s2", text: "and the README" },
  { type: "round-start", round: 2 },
  { type: "steer-read", ids: ["s1"] },
  { type: "tool-start", round: 2, id: "c2", name: "edit", args: "a.js", card: { kind: "edit", subject: "a.js" } },
  { type: "tool-start", round: 2, id: "c3", name: "bash", args: "npm test", card: { kind: "shell", subject: "npm test" } },
  { type: "ask", id: "q1", call: "c3", waits: true, question: "run it?" },
  { type: "tool-end", id: "c2", ok: true, preview: "edited" },
  { type: "ask-end", id: "q1" },
  { type: "steer", kind: "note", id: "s3", text: "drop this", from: "chat", at: 9 },
  { type: "steer-drop", ids: ["s3"] },
  { type: "tool-end", id: "c3", ok: false, exitCode: 1, preview: "1 failing" },
  { type: "held", tokens: 1200, window: 200000 },
  { type: "round-start", round: 3 },
  { type: "round-text", round: 3, text: "Fixed the test." },
  { type: "steer-read", ids: ["s2"] },
].map((e, i) => ({ n: i + 1, ts: i, ...e }));

// (fails before: yes — there was no reader to hand a run's events in parts)
test("a run read in parts holds what reading it whole gives: every trail, its work, at every mark", () => {
  for (const cuts of [[0, 23], [3, 9, 15, 23], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]]) {
    const reader = createRunReader();
    let from = 0;
    for (const to of cuts) {
      reader.feed(RUN.slice(from, to));
      from = to;
      const upTo = RUN.slice(0, to);
      for (const since of [0, 3, 7, 12, to])
        assert.deepEqual(trailOfLog(reader.log(), { since }), trailOf(upTo, { since }), `read to ${to}, the mark at ${since}`);
    }
  }
  const whole = createRunReader();
  whole.feed(RUN);
  assert.deepEqual(whole.log().unread.map((n) => n.text), [], "every note it kept was read");
  assert.deepEqual(workOfRun(RUN).rounds, 3);
});

test("a note handed out stays as it was when a later edit changes the one the reader keeps", () => {
  const reader = createRunReader();
  reader.feed(RUN.slice(0, 8));
  const before = reader.log().unread;
  reader.feed(RUN.slice(8, 9));
  assert.deepEqual(before.map((n) => n.text), ["mind the tests", "and the docs"]);
  assert.deepEqual(reader.log().unread.map((n) => n.text), ["mind the tests", "and the README"]);
});

/** A look's words past its head line. @param {string} t */
const withoutHead = (t) => t.replace(/^\[Filament: a look at your workers[^\]]*\]/, "");

// (fails before: yes — each look asked for the run from its first event: 8 looks handed it 8 times its length's worth)
test("a lead's looks read each event of a worker's run once, and say what a look reading it whole says", () => {
  /** @type {any[]} */
  const log = [];
  /** @type {number[]} */
  const asked = [];
  let handed = 0;
  /** @param {string} _run @param {number} since */
  const eventsOf = (_run, since) => {
    asked.push(since);
    const out = log.filter((e) => e.n > (since ?? 0));
    handed += out.length;
    return out;
  };
  const watched = { id: "sa_1", role: "builder", description: "fix it", task: null, run: "r1", head: ["round 1"], mark: newMark() };
  const looks = createLooks({ now: () => 1, later: () => {}, seconds: () => 0, lean: false, workers: () => [watched], eventsOf, wake: () => {} });
  /** @type {string[]} */
  const texts = [];
  for (let k = 0; k < RUN.length; k += 3) {
    for (const e of RUN.slice(k, k + 3)) {
      log.push(e);
      noted(watched.mark, e, null);
    }
    looks.ask();
    texts.push(String(looks.take()?.text));
  }
  assert.equal(handed, RUN.length, `each event handed once (${handed} for ${RUN.length})`);
  assert.deepEqual(asked, [0, 3, 6, 9, 12, 15, 18, 21], "each look asked for what came after the last it read");
  // The same looks by a lead whose reads start over at each look: what reading the run whole gives.
  const again = { ...watched, mark: newMark() };
  /** @type {any[]} */
  const seen = [];
  /** @type {string[]} */
  const whole = [];
  for (let k = 0; k < RUN.length; k += 3) {
    for (const e of RUN.slice(k, k + 3)) {
      seen.push(e);
      noted(again.mark, e, null);
    }
    const fresh = createLooks({ now: () => 1, later: () => {}, seconds: () => 0, lean: false, workers: () => [again], eventsOf: (_r, since) => seen.filter((e) => e.n > since), wake: () => {} });
    fresh.ask();
    whole.push(withoutHead(String(fresh.take()?.text)));
  }
  // Each fresh lead's look is its first, so its head says so: the workers' parts are what is compared.
  assert.deepEqual(texts.map(withoutHead), whole);
  assert.equal(looks.trail(watched, 0), createLooks({ now: () => 1, later: () => {}, seconds: () => 0, lean: false, workers: () => [watched], eventsOf: (_r, since) => log.filter((e) => e.n > since), wake: () => {} }).trail(watched, 0));
});
