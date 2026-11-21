// @ts-check
// A chat's page read counts its turns' tool legs (truth.js `toolLegsOf`) from each turn's count kept between reads
// (archive.js `toolLegs`): it asked the kind of every message of every turn at each read, and a long chat's work is
// tens of thousands of messages, each a lookup cold on disk (the owner's of 11-17: opening TinyQuest held the server
// 10 s in them). The count is the one the kinds give: a turn whose work was set anew is counted anew, a turn naming a
// message the archive did not hold yet counts it once it is held, and a name the work holds twice counts twice. A turn
// over — ended, or a later one after it — has its count kept in the file too (`turn_legs`), so a start of Filament
// reads it again with no kind asked; a turn deleted takes its count with it.
// (fails before: yes — every read asked every message's kind; then, each start asked them all again)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive, LEGS_KEPT } from "../src/services/memory/archive.js";
import { toolLegsOf } from "../src/services/memory/truth.js";
import { sha256 } from "../src/core/hash.js";

/** A turn's work of `calls` rounds: the model's call, then its result. @param {number} calls @param {string} tag */
const rounds = (calls, tag) =>
  Array.from({ length: calls }, (_, i) => [
    { role: "assistant", content: [{ type: "text", text: `${tag} step ${i}` }, { type: "tool_use", id: `${tag}${i}`, name: "Bash", input: { command: `echo ${tag} ${i}` } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: `${tag}${i}`, content: `${tag} out ${i}` }] },
  ]).flat();

/** An archive with a chat of finished turns, `calls[i]` rounds each, every ask of kinds kept. @param {number[]} calls */
function archiveWith(calls) {
  const dir = mkdtempSync(join(tmpdir(), "filament-legs-"));
  const file = join(dir, "a.db");
  const a = /** @type {any} */ (new Archive({ file }));
  const chain = a.chainForKey("k-legs", { cwd: "C:\\widgets", client: "harness", model: "m" }).id;
  calls.forEach((n, i) => {
    const { turnId } = a.beginTurn(chain, { requestId: `r${i}`, userMessage: { role: "user", content: `step ${i}` } });
    a.addWork(turnId, rounds(n, `t${i}-`));
    a.finishTurn(turnId, { finalMessage: { role: "assistant", content: `Done ${i}.` }, outputChars: 5 });
  });
  const { asked, kinds } = watched(a);
  /** @type {any[]} */
  const opened = [a];
  /** The same file opened anew, as a start of Filament opens it, its asks of kinds kept. */
  const reopen = () => {
    for (const x of opened) x.close();
    opened.length = 0;
    const b = /** @type {any} */ (new Archive({ file }));
    opened.push(b);
    return { b, ...watched(b) };
  };
  return { a, chain, asked, kinds, reopen, done: () => (opened.forEach((x) => x.close()), rmSync(dir, { recursive: true, force: true })) };
}
/** An opening's asks of kinds, each kept. @param {any} a */
function watched(a) {
  /** @type {string[][]} */
  const asked = [];
  const kinds = a.messageKinds.bind(a);
  a.messageKinds = (/** @type {string[]} */ hashes) => (asked.push([...hashes]), kinds(hashes));
  return { asked, kinds };
}
/** The turns the file keeps a count of. @param {any} a @returns {number[]} */
const filedOf = (a) => a.db.prepare("SELECT turn_id FROM turn_legs ORDER BY turn_id").all().map((/** @type {any} */ r) => Number(r.turn_id));

/** The count as it was made before: every message's kind asked, a name held twice counted twice. @param {(h: string[]) => Map<string, string>} kinds @param {any[]} turns */
const counted = (kinds, turns) => {
  const hashes = turns.flatMap((t) => (Array.isArray(t.work) ? t.work : []));
  const got = kinds(hashes);
  return hashes.reduce((n, h) => n + (got.get(h) === "tool_use" ? 1 : 0), 0);
};

test("a chat's tool legs are what every message's kind says, and a read again asks no kind of a turn that did not move", () => {
  const { a, chain, asked, kinds, done } = archiveWith([3, 40, 7, 0, 25]);
  try {
    const turns = a.getTurns(chain);
    const want = counted(kinds, turns);
    assert.equal(want, 75, "one leg a round");
    assert.equal(toolLegsOf(a, turns), want);
    assert.equal(asked.length, 1, "the first read asks the kinds once, for every turn");
    assert.equal(toolLegsOf(a, a.getTurns(chain)), want);
    assert.equal(asked.length, 1, "a read again asks none");
  } finally {
    done();
  }
});

test("a turn whose work was set anew is counted from its new work; the others are not asked again", () => {
  const { a, chain, asked, kinds, done } = archiveWith([5, 9]);
  try {
    assert.equal(toolLegsOf(a, a.getTurns(chain)), 14);
    const [first] = a.getTurns(chain);
    a.setWork(first.id, rounds(2, "again-"));
    asked.length = 0;
    const turns = a.getTurns(chain);
    assert.equal(toolLegsOf(a, turns), counted(kinds, turns));
    assert.equal(toolLegsOf(a, turns), 11);
    assert.deepEqual(asked[0], turns[0].work, "only the turn set anew is asked");
  } finally {
    done();
  }
});

test("a message the archive did not hold yet counts once it is held: its turn is not kept until then", () => {
  const { a, chain, done } = archiveWith([4]);
  try {
    const later = { role: "assistant", content: [{ type: "tool_use", id: "late", name: "Read", input: { path: "a.txt" } }] };
    const [t] = a.getTurns(chain);
    const turns = [{ ...t, work: [...t.work, sha256(JSON.stringify(later))] }];
    assert.equal(toolLegsOf(a, turns), 4, "the name the archive does not hold counts nothing");
    a.putMessage("assistant", later);
    assert.equal(toolLegsOf(a, turns), 5, "held now, it counts");
  } finally {
    done();
  }
});

test("a name a turn's work holds twice counts twice, and one two turns share counts in each", () => {
  const { a, chain, kinds, done } = archiveWith([3]);
  try {
    const [t] = a.getTurns(chain);
    const call = t.work[0];
    const turns = [{ ...t, work: [...t.work, call] }, { id: 1_000_000, work: [call, t.work[1]] }];
    assert.equal(toolLegsOf(a, turns), counted(kinds, turns));
    assert.equal(toolLegsOf(a, turns), 5);
    assert.equal(toolLegsOf(a, turns), 5, "kept, the same");
  } finally {
    done();
  }
});

test(`past ${LEGS_KEPT} turns an opening keeps, those counted longest ago are read from the file where it keeps them, else asked again — the count what the kinds say`, () => {
  const { a, chain, asked, done } = archiveWith([1]);
  try {
    const [t] = a.getTurns(chain);
    const call = t.work[0];
    // Turns over: the file keeps them, and those that went past the bound are read from it.
    const many = Array.from({ length: LEGS_KEPT + 100 }, (_, i) => ({ id: 2_000_000 + i, work: [call], ended_at: 1 }));
    assert.equal(toolLegsOf(a, many), LEGS_KEPT + 100);
    asked.length = 0;
    assert.equal(toolLegsOf(a, many), LEGS_KEPT + 100);
    assert.equal(asked.length, 0, "the hundred counted first went past the bound, and were read from the file");
    // Turns still at work — each its chain's newest, not ended —: the file keeps none, and past the bound they are asked again.
    const open = Array.from({ length: LEGS_KEPT + 100 }, (_, i) => ({ id: 3_000_000 + i, work: [call] }));
    for (const x of open) assert.equal(toolLegsOf(a, [x]), 1);
    asked.length = 0;
    for (const x of open.slice(0, 100)) assert.equal(toolLegsOf(a, [x]), 1);
    assert.equal(asked.length, 100, "each asked again");
    assert.equal(filedOf(a).filter((id) => id >= 3_000_000).length, 0);
  } finally {
    done();
  }
});

test("a turn over is kept in the file: an opening anew answers a chat with no kind asked; the newest, not ended, is filed once a turn follows it", () => {
  const { a, chain, kinds, reopen, done } = archiveWith([3, 40, 7]);
  try {
    const want = counted(kinds, a.getTurns(chain));
    assert.equal(toolLegsOf(a, a.getTurns(chain)), want);
    // The newest still at work: counted, not filed.
    const { turnId: open } = a.beginTurn(chain, { requestId: "r-open", userMessage: { role: "user", content: "go on" } });
    a.addWork(open, rounds(4, "open-"));
    assert.equal(toolLegsOf(a, a.getTurns(chain)), want + 4);
    assert.equal(filedOf(a).includes(open), false, "at work still: not filed");
    const { b, asked } = reopen();
    assert.equal(toolLegsOf(b, b.getTurns(chain)), want + 4);
    assert.deepEqual(asked, [b.getTurn(open).work], "a start asks only the kinds of the turn at work");
    // A turn after it: it is over, and filed — read again from the file after a start, with nothing asked.
    const { turnId: next } = b.beginTurn(chain, { requestId: "r-next", userMessage: { role: "user", content: "and then" } });
    b.addWork(next, rounds(1, "next-"));
    assert.equal(toolLegsOf(b, b.getTurns(chain)), want + 5);
    assert.equal(filedOf(b).includes(open), true);
    b.finishTurn(next, { finalMessage: { role: "assistant", content: "Done." }, outputChars: 5 });
    assert.equal(toolLegsOf(b, b.getTurns(chain)), want + 5);
    const again = reopen();
    assert.equal(toolLegsOf(again.b, again.b.getTurns(chain)), want + 5);
    assert.deepEqual(again.asked, [], "every turn over, every count the file's");
  } finally {
    done();
  }
});

test("the count is what every message's kind says over random work: added, set anew, grown, a name twice and in two turns, a fork's turns, and an opening anew", () => {
  const { a, chain, reopen, done } = archiveWith([2]);
  try {
    let seed = 7;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    /** @type {any[]} */
    let pool = rounds(6, "pool-");
    let cur = a;
    /** @type {string[]} */
    const chains = [chain];
    /** Each chain's count as every message's kind says it, and as the archive's. @param {any} x */
    const check = (x, /** @type {string} */ when) => {
      const kinds = Archive.prototype.messageKinds.bind(x);
      for (const c of chains) assert.equal(toolLegsOf(x, x.getTurns(c)), counted(kinds, x.getTurns(c)), `${when}: ${c}`);
    };
    /** What the steps did, so the walk is known to have gone everywhere. */
    const did = { begun: 0, set: 0, grown: 0, forked: 0, reopened: 0 };
    for (let step = 0; step < 60; step++) {
      const turns = cur.getTurns(chain);
      const roll = r();
      if (roll < 0.35) {
        const { turnId } = cur.beginTurn(chain, { requestId: `rr${step}`, userMessage: { role: "user", content: `more ${step}` } });
        // New rounds, and some of the pool's again: a name a turn holds twice, or another turn's.
        cur.addWork(turnId, [...rounds(1 + Math.floor(r() * 3), `s${step}-`), ...pool.slice(0, Math.floor(r() * 4))]);
        if (r() < 0.6) cur.finishTurn(turnId, { finalMessage: { role: "assistant", content: `ok ${step}` }, outputChars: 2 });
        did.begun++;
      } else if (roll < 0.6 && turns.length) {
        const t = turns[Math.floor(r() * turns.length)];
        cur.setWork(t.id, [...rounds(Math.floor(r() * 4), `set${step}-`), ...pool.slice(Math.floor(r() * 3), 6)]);
        did.set++;
      } else if (roll < 0.7 && turns.length) {
        const t = turns[turns.length - 1];
        cur.addWork(t.id, rounds(1, `grow${step}-`));
        did.grown++;
      } else if (roll < 0.8 && turns.some((/** @type {any} */ t) => t.final_hash)) {
        // A fork at a finished turn: its turns' copies, the same work under new ids.
        const finished = turns.filter((/** @type {any} */ t) => t.final_hash);
        const fork = cur.forkChain(chain, { atTurn: finished[Math.floor(r() * finished.length)].n, key: `fork-${step}` });
        assert.ok(fork && !fork.error, fork?.error);
        chains.push(fork.id);
        did.forked++;
      } else if (roll < 0.9) {
        // More for later turns to hold again.
        pool = [...pool, ...rounds(1, `late${step}-`)];
      } else {
        cur = reopen().b;
        did.reopened++;
      }
      check(cur, `step ${step}`);
      check(cur, `step ${step}, read again`);
    }
    check(reopen().b, "opened anew at the end");
    for (const [k, v] of Object.entries(did)) assert.ok(v > 0, `the walk ${k} at least once (${JSON.stringify(did)})`);
  } finally {
    done();
  }
});

test("a chain deleted takes its turns' kept counts with it", () => {
  const { a, chain, done } = archiveWith([2, 3]);
  try {
    const other = a.chainForKey("k-legs-2", { cwd: "C:\\widgets", client: "harness", model: "m" }).id;
    const { turnId } = a.beginTurn(other, { requestId: "o1", userMessage: { role: "user", content: "other" } });
    a.addWork(turnId, rounds(2, "o-"));
    a.finishTurn(turnId, { finalMessage: { role: "assistant", content: "Done." }, outputChars: 5 });
    toolLegsOf(a, a.getTurns(chain));
    toolLegsOf(a, a.getTurns(other));
    const mine = a.getTurns(chain).map((/** @type {any} */ t) => t.id);
    assert.deepEqual(filedOf(a), [...mine, turnId].sort((x, y) => x - y));
    a.deleteChain(chain);
    assert.deepEqual(filedOf(a), [turnId], "its turns' counts gone with them");
  } finally {
    done();
  }
});
