// @ts-check
// A watcher's events and the door its wake goes through (r-itself, 11-12). What a watcher heard is lost for no failure
// of Filament's own: a wake whose post is thrown, or answered 503 or any 5xx, keeps its events for the next try — held
// back as from a chat at work, its wait doubling to `PARK_MAX_MS`, what waits held to the newest `WATCH_LIMITS.events`
// —; a 4xx that is no 409 is the chat's own no, and fails with them as before. And what runs by itself stops at a
// stop's first step: a turn that ends while Filament drains is heard, kept, and wakes its watcher after the restart.
// (fails before: yes — every post that was not a 2xx or a 409 failed with its events, a new chat's run took them before
// its post, and the routines stopped only once the drain was over: a turn that ended in a restart's window was heard,
// its wake refused 503, and what it heard gone)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WAKE_HEAD, WATCH_LIMITS } from "../src/core/watchers.js";
import { routineFields } from "../src/core/routines.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createRoutines, PARK_MAX_MS, PARK_MS } from "../src/app/routines.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { gate, removeDirs, until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));

/** A moment of Monday 26 October 2026, local. @param {number} h @param {number} [m] */
const at = (h, m = 0) => new Date(2026, 9, 26, h, m).getTime();
const NAMES = /** @type {Record<string, string>} */ ({ c1: "Lead", c2: "Build the login flow" });
/** @param {string} c */
const nameOf = (c) => NAMES[c] || "an untitled chat";
const BY = { chain: "c1", byName: "Lead", model: "m", nameOf };
/** A turn of c2 that ended, as a watcher keeps it. @param {number} i @param {number} when */
const ev = (i, when) => ({ id: `turn:c2:${i}:${when}`, kind: "turn", at: when, chain: "c2", summary: `Turn ${i} of Build the login flow ended: 2 files changed`, ref: `turn ${i}`, of: { turn: i } });
/** A chat's facts as the sessions service says them. @param {any} [o] */
const facts = (o = {}) => ({ busy: false, asking: false, last: { n: 3, final: true, text: "Earlier reply.", cut: false, failed: false, why: "", stopped: false }, ...o });

/** The door's own failures, each as a post meets it: what the next post answers, or throws. */
const DOORS = /** @type {const} */ ([
  ["thrown", { throws: "connect ECONNREFUSED 127.0.0.1:8787" }, /ECONNREFUSED/],
  ["503", { status: 503, body: { error: "the archive is not open yet" } }, /the archive is not open yet/],
  ["500", { status: 500, body: { error: "an error of Filament's own" } }, /an error of Filament's own/],
]);

/**
 * The runner over a store of its own, its chats' facts and its posts the test's: a post answers what the test queued
 * (`answers`), or throws it (`throws`); past them what the door always answers where the test set it (`door.always`),
 * else 200, and the chat at work in the turn it became. An answer `inside`: the turn failed inside the lock — it took
 * its chat and let it go, which the server's lock says to the runner (`released`) before the post is answered.
 * @param {"chat" | "new"} wakes
 * @param {{ store?: (s: import("../src/services/spaces.js").SpaceStore) => import("../src/services/spaces.js").SpaceStore }} [o]
 *   `store`: the store as the runner holds it, where the test stands in front of it
 */
function rig(wakes, o = {}) {
  const clock = { at: at(9) };
  const now = () => clock.at;
  const kept = createSpaceStore({ dir: null, now });
  const spaces = o.store ? o.store(kept) : kept;
  /** @type {[string, any][]} */
  const posted = [];
  /** @type {string[]} */
  const removed = [];
  /** @type {Map<string, any>} */
  const chats = new Map([["c1", facts()]]);
  /** @typedef {{ status: number, body: any, inside?: boolean } | { throws: string }} Answer */
  /** @type {Answer[]} */
  const answers = [];
  const door = { always: /** @type {Answer | null} */ (null) };
  let n = 0;
  const routines = createRoutines({
    spaces,
    sessions: {
      create: () => {
        const id = `run${++n}`;
        chats.set(id, facts({ last: null }));
        return { id };
      },
      besideFacts: (id) => {
        const f = chats.get(id);
        if (!f) throw new Error("no such session");
        return f;
      },
    },
    mark: () => {},
    postTurn: async (id, b) => {
      posted.push([id, b]);
      const a = answers.shift() || door.always || { status: 200, body: null };
      if ("throws" in a) throw new Error(a.throws);
      if (a.inside) routines.released(id);
      const c = chats.get(id);
      if (a.status !== 200 || !c) return a;
      const turn = (c.last?.n || 0) + 1;
      chats.set(id, { ...c, busy: true, last: { ...facts().last, n: turn, final: false, text: "" } });
      return { ...a, turn };
    },
    remove: async (id) => {
      removed.push(id);
      chats.delete(id);
    },
    folderOf: (p) => (p === "p1" ? "/work/app" : null),
    nameOf: () => "app",
    chatName: nameOf,
    packetOf: async (_r, heard) => `PACKET of ${heard?.events.length ?? 0}`,
    now,
  });
  /** A watcher the chat c1 proposed, switched on. @param {string} title @param {"chat" | "new"} wakes */
  const add = (title, wakes) => {
    const f = routineFields({ title, text: "Read its turn.", trigger: { kind: "turn", chat: "c2" }, wakes }, { create: true });
    assert.ok(f.ok, JSON.stringify(f));
    const id = kept.routinePropose("p1", f.fields, BY).id;
    kept.routineOn("p1", id);
    return id;
  };
  const id = add("Supervisor", wakes);
  /** A watcher by its id. @param {string} id */
  const of = (id) => /** @type {import("../src/core/routines.js").Routine} */ (kept.get("p1").routines.find((x) => x.id === id));
  return {
    clock,
    spaces: kept,
    routines,
    posted,
    removed,
    chats,
    answers,
    door,
    id,
    add,
    of,
    w: () => kept.get("p1").routines[0],
    /** The words of the n-th post. @param {number} i */
    words: (i) => String(posted[i]?.[1]?.content?.map((/** @type {any} */ b) => b.text).join("\n") || ""),
    /** How many lines of What happened say it failed; with a title, that watcher's. @param {string} [title] */
    failures: (title) => kept.get("p1").log.filter((l) => l.text.includes(title ? `“${title}” failed` : "failed")).length,
    /** How many posts carried a watcher's words so far — its wake, or its run's first message —, by its title. @param {string} title */
    tries: (title) => posted.filter(([, b]) => String(b?.content?.[0]?.text || "").includes(`“${title}”`)).length,
  };
}

describe("a wake the door itself failed keeps what it heard (the chat it wakes)", () => {
  for (const [how, answer, said] of DOORS)
    test(`${how}: its events wait, its failure is said with none of them, and its next try sends them all`, async () => {
      const t = rig("chat");
      await t.routines.start();
      t.answers.push(answer);
      const t0 = at(9, 10);
      t.clock.at = t0;
      assert.equal(await t.routines.heard("p1", t.id, [ev(1, t0)]), 1);
      assert.equal(t.posted.length, 1);
      assert.equal(t.w().pending?.events.length, 1, "what it heard waits for the next try");
      assert.deepEqual([t.w().last?.state, said.test(String(t.w().last?.why))], ["failed", true], JSON.stringify(t.w().last));
      assert.equal(t.spaces.get("p1").needs.filter((x) => x.kind === "routine").length, 1, "its failure, once in Needs you");
      // One heard meanwhile waits beside the first; nothing goes before its wait is over.
      await t.routines.heard("p1", t.id, [ev(2, t0 + 1000)]);
      t.clock.at = t0 + PARK_MS - 1;
      await t.routines.tick();
      assert.equal(t.posted.length, 1, "held back, as from a chat at work");
      t.clock.at = t0 + PARK_MS;
      await t.routines.tick();
      assert.equal(t.posted.length, 2, "tried again by its own timer");
      assert.ok(t.words(1).includes("PACKET of 2") && t.words(1).startsWith(WAKE_HEAD), t.words(1));
      assert.deepEqual([t.w().pending, t.w().last?.state, t.w().last?.events], [null, "running", 2]);
      t.routines.stop();
    });

  test("a door that never opens: one try a wait, the wait doubling to its cap; said once; what waits is the newest, the rest counted", async () => {
    const t = rig("chat");
    await t.routines.start();
    for (let i = 0; i < 40; i++) t.answers.push({ status: 500, body: { error: "an error of Filament's own" } });
    const t0 = at(9, 10);
    t.clock.at = t0;
    await t.routines.heard("p1", t.id, [ev(1, t0)]);
    assert.equal(t.posted.length, 1);
    // Each wait twice the last, `PARK_MAX_MS` at most: a try as each ends, none before.
    let when = t0;
    let wait = PARK_MS;
    for (let tries = 2; tries <= 8; tries++) {
      t.clock.at = when + wait - 1;
      await t.routines.tick();
      assert.equal(t.posted.length, tries - 1, `no try ${tries} before its wait of ${wait / 1000}s`);
      when += wait;
      t.clock.at = when;
      await t.routines.tick();
      assert.equal(t.posted.length, tries, `try ${tries} as its wait ended`);
      wait = Math.min(wait * 2, PARK_MAX_MS);
    }
    assert.equal(wait, PARK_MAX_MS, "the wait reached its cap");
    assert.equal(t.failures(), 1, "its failure said once while the door stays shut");
    // What it hears meanwhile waits under the cap what waits always has.
    const more = WATCH_LIMITS.events + 5;
    await t.routines.heard("p1", t.id, Array.from({ length: more }, (_, i) => ev(100 + i, when + 1 + i)));
    assert.deepEqual([t.w().pending?.events.length, t.w().pending?.more], [WATCH_LIMITS.events, more + 1 - WATCH_LIMITS.events]);
    t.routines.stop();
  });

  test("Filament restarting (the route's 503): its events wait, and nothing is said of it; Run now says so", async () => {
    const t = rig("chat");
    await t.routines.start();
    const restarting = { status: 503, body: { error: "Filament is restarting; send again in a few seconds", restarting: true } };
    t.answers.push(restarting, restarting);
    t.clock.at = at(9, 10);
    await t.routines.heard("p1", t.id, [ev(1, at(9, 10))]);
    assert.equal(t.posted.length, 1);
    assert.deepEqual([t.w().pending?.events.length, t.w().last, t.failures()], [1, null, 0], "kept, and no failure to say: the next start takes them up");
    await assert.rejects(t.routines.runNow("p1", t.id), (/** @type {any} */ e) => e.status === 503 && /Filament could not start its turn there now: what it heard goes at the next try/.test(e.message));
    assert.equal(t.w().pending?.events.length, 1);
    t.routines.stop();
  });

  test("a 4xx that is no 409 is that chat's own no: its failure with its events, as before", async () => {
    for (const status of [400, 403, 404]) {
      const t = rig("chat");
      await t.routines.start();
      t.answers.push({ status, body: { error: "the chat said no" } });
      const t0 = at(9, 10);
      t.clock.at = t0;
      await t.routines.heard("p1", t.id, [ev(1, t0)]);
      assert.deepEqual([t.posted.length, t.w().pending, t.w().last?.state], [1, null, "failed"], String(status));
      assert.match(String(t.w().last?.why), /could not take its turn: the chat said no$/);
      // Nothing waits, so nothing is tried again.
      t.clock.at = t0 + 60 * PARK_MS;
      await t.routines.tick();
      assert.equal(t.posted.length, 1, String(status));
      t.routines.stop();
    }
  });
});

describe("a wake the door itself failed keeps what it heard (a new chat each time)", () => {
  for (const [how, answer, said] of DOORS)
    test(`${how}: the run that could not start is said, its chat goes, and its events wait for the next try`, async () => {
      const t = rig("new");
      await t.routines.start();
      t.answers.push(answer);
      const t0 = at(9, 10);
      t.clock.at = t0;
      assert.equal(await t.routines.heard("p1", t.id, [ev(1, t0)]), 1);
      assert.deepEqual([t.posted.map((p) => p[0]), t.removed], [["run1"], ["run1"]]);
      assert.deepEqual([t.w().last?.state, said.test(String(t.w().last?.why))], ["failed", true], JSON.stringify(t.w().last));
      assert.equal(t.w().pending?.events.length, 1, "what it heard waits for the next try");
      await t.routines.heard("p1", t.id, [ev(2, t0 + 1000)]);
      t.clock.at = t0 + PARK_MS - 1;
      await t.routines.tick();
      assert.equal(t.posted.length, 1, "held back");
      t.clock.at = t0 + PARK_MS;
      await t.routines.tick();
      assert.deepEqual(t.posted.map((p) => p[0]), ["run1", "run2"], "tried again by its own timer, in a chat of its own");
      assert.ok(t.words(1).includes("PACKET of 2"), t.words(1));
      assert.deepEqual([t.w().pending, t.w().last?.state, t.w().last?.chain, t.w().last?.events], [null, "running", "run2", 2]);
      t.routines.stop();
    });

  test("events heard while its run starts wait on, whichever way the post goes", async () => {
    const t = rig("new");
    await t.routines.start();
    t.answers.push({ status: 500, body: { error: "an error of Filament's own" } });
    const t0 = at(9, 10);
    t.clock.at = t0;
    const first = t.routines.heard("p1", t.id, [ev(1, t0)]);
    // Heard before the first one's post is answered: it waits beside it.
    const second = t.routines.heard("p1", t.id, [ev(2, t0 + 1)]);
    await Promise.all([first, second]);
    assert.deepEqual(t.w().pending?.events.map((e) => e.of?.turn), [1, 2]);
    t.routines.stop();
  });

  test("a door that never opens makes no queue without end: what waits stays under its cap, each try later than the last", async () => {
    const t = rig("new");
    await t.routines.start();
    const t0 = at(9, 10);
    t.clock.at = t0;
    t.answers.push({ status: 503, body: { error: "the archive is not open yet" } });
    await t.routines.heard("p1", t.id, [ev(1, t0)]);
    // Heard while it is held back: each waits, none starts a run.
    for (let i = 2; i <= WATCH_LIMITS.events + 5; i++) await t.routines.heard("p1", t.id, [ev(i, t0 + i)]);
    assert.deepEqual([t.posted.length, t.w().pending?.events.length, t.w().pending?.more], [1, WATCH_LIMITS.events, 5]);
    t.answers.push({ status: 503, body: { error: "the archive is not open yet" } });
    t.clock.at = t0 + PARK_MS;
    await t.routines.tick();
    assert.equal(t.posted.length, 2);
    assert.deepEqual([t.w().pending?.events.length, t.w().pending?.more, t.w().pending?.events.at(-1)?.of?.turn], [WATCH_LIMITS.events, 5, WATCH_LIMITS.events + 5], "given back whole, and no more than waited");
    // Its second wait in a row is twice the first.
    t.clock.at = t0 + 2 * PARK_MS;
    await t.routines.tick();
    assert.equal(t.posted.length, 2, "held back longer");
    t.clock.at = t0 + 3 * PARK_MS;
    await t.routines.tick();
    assert.deepEqual([t.posted.length, t.w().pending, t.w().last?.state, t.w().last?.events], [3, null, "running", WATCH_LIMITS.events + 5]);
    t.routines.stop();
  });

  test("a 4xx is its failure with its events, as before", async () => {
    const t = rig("new");
    await t.routines.start();
    t.answers.push({ status: 400, body: { error: "a routine's run carries a routine's words" } });
    const t0 = at(9, 10);
    t.clock.at = t0;
    await t.routines.heard("p1", t.id, [ev(1, t0)]);
    assert.deepEqual([t.posted.length, t.removed, t.w().pending, t.w().last?.state], [1, ["run1"], null, "failed"]);
    t.clock.at = t0 + 60 * PARK_MS;
    await t.routines.tick();
    assert.equal(t.posted.length, 1, "never tried again with the same");
    t.routines.stop();
  });
});

// What ends a wait the door gave (s-itself, the second read of 11-12). A turn that fails inside the lock — its provider
// unreachable, a 502 — took its chat and lets it go as it fails, and a lock let go ended the wait of every watcher
// that chat proposed, as it ends the wait a chat at work gives. Two watchers of one chat, each with events waiting,
// then sent their turns back to back for as long as the door stayed shut: each failed turn ended the other's wait.
// (fails before: yes — in the first test's 300 ms the two sent 48 turns, each failure said anew and no wait twice the
// last; one watcher's wait ended as its own failed turn let go late, as any turn of its chat ended, as room was made;
// a watcher in a chat of its own ran again at each turn's end of the chat that proposed it; its failure was said
// again where its chat had been at work between two tries; two watchers of a chat that needs compacting sent it 44
// turns in 300 ms, each refused post's lock ending the other's hold; and a wake that threw after its turn was sent
// sent that turn again each time it ended, a minute apart at most)
describe("a wait the door gave is over when its own time is: no lock let go and no room made ends it", () => {
  const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
  /** A provider that cannot be reached, as the turns route answers it: the turn failed inside the lock. */
  const UNREACHABLE = { status: 502, body: { error: "upstream m unreachable: ECONNREFUSED" }, inside: true };

  test("two watchers of one chat, each turn failing inside the lock: one try each, its failure said once, and each waits out its own wait, twice the last", async () => {
    const t = rig("chat");
    const second = t.add("Reviewer", "chat");
    await t.routines.start();
    t.door.always = UNREACHABLE;
    const t0 = at(9, 10);
    t.clock.at = t0;
    try {
      await t.routines.heard("p1", t.id, [ev(1, t0)]);
      await t.routines.heard("p1", second, [ev(1, t0)]);
      // The runner's timer is the real one: what it would send back to back, it sends in this while.
      await sleep(300);
      assert.deepEqual([t.tries("Supervisor"), t.tries("Reviewer")], [1, 1], `one try each until its wait is over (${t.posted.length} turns were sent)`);
      assert.deepEqual([t.failures("Supervisor"), t.failures("Reviewer")], [1, 1]);
      assert.deepEqual([t.of(t.id).pending?.events.length, t.of(second).pending?.events.length], [1, 1], "what each heard waits");
      let when = t0;
      let wait = PARK_MS;
      for (let tries = 2; tries <= 6; tries++) {
        t.clock.at = when + wait - 1;
        await t.routines.tick();
        await sleep(30);
        assert.equal(t.posted.length, 2 * (tries - 1), `no try ${tries} before its wait of ${wait / 1000}s`);
        when += wait;
        t.clock.at = when;
        await t.routines.tick();
        await sleep(30);
        assert.deepEqual([t.tries("Supervisor"), t.tries("Reviewer")], [tries, tries], `try ${tries} as its wait ended, each once`);
        wait = Math.min(wait * 2, PARK_MAX_MS);
      }
      assert.equal(wait, PARK_MAX_MS, "the wait reached its cap");
      assert.deepEqual([t.failures("Supervisor"), t.failures("Reviewer")], [1, 1], "each said once while the door stays shut");
    } finally {
      t.routines.stop();
    }
  });

  test("one watcher: its failed turn letting go once its post was answered, a turn of the person's ending in its chat, room made for it — none ends its wait, none says its failure again", async () => {
    const t = rig("chat");
    await t.routines.start();
    t.door.always = { status: 502, body: { error: "upstream m unreachable: ECONNREFUSED" } };
    const t0 = at(9, 10);
    t.clock.at = t0;
    try {
      await t.routines.heard("p1", t.id, [ev(1, t0)]);
      assert.deepEqual([t.posted.length, t.failures()], [1, 1]);
      for (const [what, lets] of /** @type {[string, () => void][]} */ ([
        ["its failed turn's lock let go late", () => t.routines.released("c1")],
        ["a turn of the person's ended there", () => t.routines.released("c1")],
        ["room was made for the chat", () => t.routines.freed("c1")],
      ])) {
        lets();
        await sleep(60);
        assert.deepEqual([t.posted.length, t.failures()], [1, 1], what);
      }
      t.clock.at = t0 + PARK_MS - 1;
      await t.routines.tick();
      assert.equal(t.posted.length, 1);
      t.clock.at = t0 + PARK_MS;
      await t.routines.tick();
      assert.equal(t.posted.length, 2, "its own time ends it");
    } finally {
      t.routines.stop();
    }
  });

  test("a watcher that runs in a chat of its own waits out its own time too, whatever the turns of the chat that proposed it do", async () => {
    const t = rig("new");
    const beside = t.add("Reviewer", "chat");
    await t.routines.start();
    t.door.always = UNREACHABLE;
    const t0 = at(9, 10);
    t.clock.at = t0;
    try {
      await t.routines.heard("p1", t.id, [ev(1, t0)]);
      // The other's turn fails in the chat that proposed both, and lets go of it.
      await t.routines.heard("p1", beside, [ev(1, t0)]);
      await sleep(200);
      assert.deepEqual([t.tries("Supervisor"), t.tries("Reviewer")], [1, 1], `one try each (${t.posted.length} turns were sent)`);
      // So does a turn of the person's there.
      t.routines.released("c1");
      await sleep(60);
      assert.deepEqual([t.tries("Supervisor"), t.w().pending?.events.length], [1, 1]);
      t.clock.at = t0 + PARK_MS;
      await t.routines.tick();
      await sleep(30);
      assert.deepEqual([t.tries("Supervisor"), t.tries("Reviewer")], [2, 2]);
      t.clock.at = t0 + 2 * PARK_MS;
      await t.routines.tick();
      await sleep(30);
      assert.deepEqual([t.tries("Supervisor"), t.tries("Reviewer")], [2, 2], "the second wait of each is twice its first");
    } finally {
      t.routines.stop();
    }
  });

  test("its chat at work as its wait ends: its turn goes as that chat lets go — and through a door still shut nothing is said again, and its wait is longer than its last", async () => {
    const t = rig("chat");
    await t.routines.start();
    const shut = { status: 502, body: { error: "upstream m unreachable: ECONNREFUSED" } };
    const t0 = at(9, 10);
    t.clock.at = t0;
    try {
      t.answers.push(shut);
      await t.routines.heard("p1", t.id, [ev(1, t0)]);
      assert.deepEqual([t.posted.length, t.failures()], [1, 1]);
      // Its wait is over while a turn of the person's holds its chat: held back as from a chat at work, two minutes.
      t.chats.set("c1", facts({ busy: true }));
      t.clock.at = t0 + PARK_MS;
      await t.routines.tick();
      assert.equal(t.posted.length, 1);
      // That turn ends: the watcher's goes at once, as after any chat at work — and the door fails it again.
      t.answers.push(shut);
      t.chats.set("c1", facts());
      t.routines.released("c1");
      await until(() => t.posted.length === 2, "sent as the chat let go");
      await t.routines.tick();
      assert.deepEqual([t.failures(), t.w().pending?.events.length], [1, 1], "said once while the door stays shut, whatever its chat did meanwhile");
      // No lock let go ends this wait either, and it is twice the two minutes before it.
      t.routines.released("c1");
      t.clock.at = t0 + PARK_MS + 4 * PARK_MS - 1;
      await t.routines.tick();
      assert.equal(t.posted.length, 2, "a wait longer than its last");
      // The door open again: its turn goes, with all it heard.
      t.clock.at = t0 + PARK_MS + 4 * PARK_MS;
      await t.routines.tick();
      assert.deepEqual([t.posted.length, t.w().pending, t.w().last?.state], [3, null, "running"]);
    } finally {
      t.routines.stop();
    }
  });

  test("two watchers of one chat that says a no of its own inside the lock — it needs compacting first —: each fails once and is held, the lock a refused post lets go ends no hold, and a turn of that chat's ending sends them", async () => {
    const t = rig("chat");
    const second = t.add("Reviewer", "chat");
    await t.routines.start();
    t.door.always = { status: 409, body: { error: "the history weighs 9,000 of the 10,000-token window, leaving under the 1,024-token reply floor — choose how to make room and send again (Compact and send)", needsCompaction: true }, inside: true };
    const t0 = at(9, 10);
    t.clock.at = t0;
    try {
      await t.routines.heard("p1", t.id, [ev(1, t0)]);
      await t.routines.heard("p1", second, [ev(1, t0)]);
      await sleep(300);
      assert.deepEqual([t.tries("Supervisor"), t.tries("Reviewer")], [1, 1], `one try each (${t.posted.length} turns were sent)`);
      assert.deepEqual([t.failures("Supervisor"), t.failures("Reviewer")], [1, 1], "each said once");
      // No timer sends either again, as before.
      t.clock.at = t0 + 60 * PARK_MS;
      await t.routines.tick();
      await sleep(30);
      assert.equal(t.posted.length, 2);
      // The person made room and wrote there: as that turn ends, what each heard goes — one turn, then the other.
      t.door.always = null;
      t.chats.set("c1", facts({ last: { ...facts().last, n: 4, text: "Compacted, and answered." } }));
      t.routines.released("c1");
      await until(() => t.posted.length === 3, "the first sent as the chat's own turn ended");
      await t.routines.tick();
      t.chats.set("c1", facts({ last: { ...facts().last, n: 5, text: "Read it: nothing drifted." } }));
      t.routines.released("c1");
      await until(() => t.posted.length === 4, "the other sent as the first one's turn ended");
      await t.routines.tick();
      assert.deepEqual([t.tries("Supervisor"), t.tries("Reviewer"), t.of(t.id).pending, t.of(second).pending], [2, 2, null, null]);
    } finally {
      t.routines.stop();
    }
  });

  test("the person's Run now ends the wait: its turn is tried at once, and through a door open again it goes", async () => {
    const t = rig("chat");
    await t.routines.start();
    const t0 = at(9, 10);
    t.clock.at = t0;
    t.answers.push({ status: 502, body: { error: "upstream m unreachable: ECONNREFUSED" } });
    await t.routines.heard("p1", t.id, [ev(1, t0)]);
    assert.equal(t.posted.length, 1);
    t.clock.at = t0 + 1000;
    assert.equal(await t.routines.runNow("p1", t.id), "c1");
    assert.deepEqual([t.posted.length, t.w().pending, t.w().last?.state, t.w().last?.by], [2, null, "running", "you"]);
    t.routines.stop();
  });

  test("a wake that threw once its turn was sent — its Space could not be written — waits out its own time too: that turn's end sends none again, and each wait is twice the last", async () => {
    let broken = false;
    const t = rig("chat", {
      store: (s) =>
        Object.assign(Object.create(s), {
          watchTake: (/** @type {Parameters<typeof s.watchTake>} */ ...a) => {
            if (broken) throw new Error("ENOSPC: no space left on device");
            return s.watchTake(...a);
          },
        }),
    });
    await t.routines.start();
    const t0 = at(9, 10);
    t.clock.at = t0;
    /** The turn the last post began ends, and lets go of the chat. */
    const ends = () => {
      t.chats.set("c1", facts());
      t.routines.released("c1");
    };
    try {
      broken = true;
      await t.routines.heard("p1", t.id, [ev(1, t0)]);
      assert.deepEqual([t.posted.length, t.w().pending?.events.length], [1, 1], "its turn went, and what it carried could not be taken");
      ends();
      await sleep(100);
      assert.equal(t.posted.length, 1, "not again as that turn ends");
      t.clock.at = t0 + PARK_MS;
      await t.routines.tick();
      assert.equal(t.posted.length, 2, "again by its own timer");
      ends();
      await sleep(100);
      t.clock.at = t0 + PARK_MS + 2 * PARK_MS - 1;
      await t.routines.tick();
      assert.equal(t.posted.length, 2, "the second wait is twice the first");
      // Its Space written again: the turn that goes takes what waited.
      broken = false;
      t.clock.at = t0 + PARK_MS + 2 * PARK_MS;
      await t.routines.tick();
      assert.deepEqual([t.posted.length, t.w().pending, t.w().last?.state], [3, null, "running"]);
    } finally {
      t.routines.stop();
    }
  });
});

describe("a restart's window, on a real Filament", () => {
  test("a turn that ends while Filament drains is heard and kept: its watcher wakes after the restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "filament-door-"));
    made.push(root);
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", ["-c", "user.email=ada@example.com", "-c", "user.name=Ada Lovelace", ...args], { cwd: root, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    writeFileSync(join(root, "README.md"), "app\n");
    git("add", ".");
    git("commit", "-q", "-m", "First");
    /** The wakes the lead chat was sent, by what each carried. @type {string[]} */
    const wakes = [];
    /** The slow turn's answer, held until the stop is under way. */
    const slow = gate();
    let asked = false;
    /** @param {any} m */
    const textOf = (m) => (typeof m?.content === "string" ? m.content : Array.isArray(m?.content) ? m.content.map((/** @type {any} */ b) => b?.text || "").join("\n") : "");
    const up = await fakeUpstream(async (/** @type {any} */ call) => {
      const model = String(call.body?.model || "");
      const said = textOf([...(call.body?.messages || [])].reverse().find((/** @type {any} */ m) => m.role === "user" && textOf(m).trim()));
      if (said.includes(WAKE_HEAD)) {
        wakes.push(said);
        return anthropicReply("Read it: nothing drifted.", { model });
      }
      if (said.includes("Take your time.")) {
        asked = true;
        await slow.promise;
        return anthropicReply("Done, slowly.", { model });
      }
      return anthropicReply("Okay.", { model });
    });
    const configure = (/** @type {any} */ cfg) => {
      const price = { input: 1, output: 1, contextTokens: 200000 };
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": price } }];
      cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.memory.autopilot = { enabled: false };
      cfg.memory.capture = { turns: true, learn: false };
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
    };
    const first = await startApp({ memory: true, keep: true, configure });
    /** @type {Awaited<ReturnType<typeof startApp>> | null} */
    let second = null;
    try {
      /** @param {Awaited<ReturnType<typeof startApp>>} shim */
      const chat = async (shim) => {
        const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
        assert.equal(r.status, 200, await r.clone().text());
        return String((await r.json()).id);
      };
      const lead = await chat(first);
      const worker = await chat(first);
      const project = String(first.app.memory.archive?.getChain(lead)?.project_id || "");
      assert.ok(project, "the chats are of a project");
      first.app.spaces.make(project);
      const f = routineFields({ title: "Supervisor", text: "Read its turn.", model: "agent/brain-model", wakes: "chat", trigger: { kind: "turn", chat: worker, turns: "all" } }, { create: true });
      assert.ok(f.ok, JSON.stringify(f));
      const id = first.app.spaces.routinePropose(project, f.fields, { chain: lead, byName: "Lead", model: "agent/brain-model", nameOf: () => "Lead" }).id;
      first.app.spaces.routineOn(project, id);
      const of = (/** @type {Awaited<ReturnType<typeof startApp>>} */ shim) => shim.app.spaces.get(project).routines.find((x) => x.id === id);
      // The worker's turn is at work as the stop is asked for, and ends inside its drain.
      const turn = first.api(`/api/sessions/${encodeURIComponent(worker)}/turns`, { method: "POST", body: { stream: false, content: "Take your time." } });
      await until(() => asked, "the worker's turn at its model", { timeoutMs: 30_000 });
      // What the routines say while Filament drains: stopped at the stop's first step, they try no wake at all.
      /** @type {string[]} */
      const said = [];
      const own = { info: console.info, warn: console.warn };
      console.info = console.warn = (/** @type {unknown[]} */ ...words) => void said.push(words.map(String).join(" "));
      try {
        const stopped = first.app.stop();
        slow.open();
        assert.equal((await turn).status, 200);
        await stopped;
      } finally {
        Object.assign(console, own);
      }
      assert.deepEqual(said.filter((l) => l.includes("routines:")), [], "no wake was tried through a door that was closing");
      assert.equal(wakes.length, 0, "and none went through it");
      assert.equal(of(first)?.pending?.events.length, 1, "what it heard in the window waits");
      assert.equal(of(first)?.last ?? null, null, "and no failure was said of it");
      // The next start takes it up: the watcher's turn in the chat it wakes.
      second = await startApp({ memory: true, dataDir: first.dataDir, configure });
      const again = second;
      await until(() => wakes.length === 1 || null, "the watcher's wake after the restart", { timeoutMs: 30_000 });
      assert.match(wakes[0], /Turn 1 of .+ ended/);
      await until(() => of(again)?.last?.state === "done" || null, "its turn there, ended", { timeoutMs: 30_000 });
      assert.deepEqual([of(again)?.last?.chain, of(again)?.last?.events, of(again)?.pending ?? null], [lead, 1, null]);
    } finally {
      slow.open();
      if (second) await second.stop();
      else await removeDirs(first.dataDir);
      await up.close();
    }
  });
});

describe("two watchers of one chat whose turn fails inside the lock, on a real Filament", () => {
  // (fails before: yes — in the three seconds after the watched turn ended, 404 turns of the two watchers took the
  // chat's lock: each one's failed turn ended the other's wait as the server's lock let go of the chat)
  test("each sends the chat one turn, says its failure once and keeps what it heard: the lock a failed turn lets go sends no other's again", async () => {
    const root = mkdtempSync(join(tmpdir(), "filament-door-two-"));
    made.push(root);
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", ["-c", "user.email=ada@example.com", "-c", "user.name=Ada Lovelace", ...args], { cwd: root, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    writeFileSync(join(root, "README.md"), "app\n");
    git("add", ".");
    git("commit", "-q", "-m", "First");
    const up = await fakeUpstream((/** @type {any} */ call) => anthropicReply("Okay.", { model: String(call.body?.model || "") }));
    const shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg) => {
        const price = { input: 1, output: 1, contextTokens: 200000 };
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": price } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
    /** What the routines say meanwhile, kept off the test's output. @type {string[]} */
    const said = [];
    const own = { info: console.info, warn: console.warn };
    try {
      const chat = async () => {
        const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
        assert.equal(r.status, 200, await r.clone().text());
        return String((await r.json()).id);
      };
      const lead = await chat();
      const worker = await chat();
      const project = String(shim.app.memory.archive?.getChain(lead)?.project_id || "");
      assert.ok(project, "the chats are of a project");
      shim.app.spaces.make(project);
      const ids = ["Supervisor", "Reviewer"].map((title) => {
        const f = routineFields({ title, text: "Read its turn.", model: "agent/brain-model", wakes: "chat", trigger: { kind: "turn", chat: worker, turns: "all" } }, { create: true });
        assert.ok(f.ok, JSON.stringify(f));
        const id = shim.app.spaces.routinePropose(project, f.fields, { chain: lead, byName: "Lead", model: "agent/brain-model", nameOf: () => "Lead" }).id;
        shim.app.spaces.routineOn(project, id);
        return id;
      });
      const of = (/** @type {string} */ id) => shim.app.spaces.get(project).routines.find((x) => x.id === id);
      const failures = () => shim.app.spaces.get(project).log.filter((l) => l.text.includes("failed")).length;
      // Every turn of the chat they wake fails once it holds the lock, with an error of Filament's own (a 500): the
      // check the service makes there, first thing inside it, throws.
      let begun = 0;
      const memory = /** @type {any} */ (shim.app.memory);
      const check = memory.assertPrivacy.bind(memory);
      memory.assertPrivacy = (/** @type {string} */ id, /** @type {any[]} */ ...rest) => {
        if (id !== lead) return check(id, ...rest);
        begun += 1;
        throw new Error("an error of Filament's own");
      };
      console.info = console.warn = (/** @type {unknown[]} */ ...words) => void said.push(words.map(String).join(" "));
      // The watched chat ends a turn: both watchers hear it, and each has a turn for the chat they wake.
      const turn = await shim.api(`/api/sessions/${encodeURIComponent(worker)}/turns`, { method: "POST", body: { stream: false, content: "Go on." } });
      assert.equal(turn.status, 200, await turn.clone().text());
      await until(() => ids.every((id) => of(id)?.last?.state === "failed") || null, "each watcher's turn failed at the door", { timeoutMs: 30_000 });
      // Each waits a minute now (`PARK_MS`): what the two would send back to back, they send in these seconds.
      await new Promise((r) => setTimeout(r, 3000));
      assert.equal(begun, 2, `one turn each, and none again inside its wait (${begun} turns took the lock)`);
      assert.equal(failures(), 2, "each said its failure once");
      assert.deepEqual(ids.map((id) => of(id)?.pending?.events.length), [1, 1], "and what each heard waits for its next try");
      assert.match(String(of(ids[0])?.last?.why), /could not take its turn: /);
    } finally {
      Object.assign(console, own);
      await shim.stop();
      await up.close();
    }
  });
});
