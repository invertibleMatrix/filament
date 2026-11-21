// @ts-check
// The cache-churn watch: the provider's columns read as a verdict — a leg churned when write + input covers most of
// its prompt, a session churns when enough legs did, and the crossing request carries the note. The cold start (a
// session's first big write), tiny prompts, memory's own calls and children-billed parents never count.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { churnLegOf, churnVerdict, churnNote, createCacheChurnWatch, CHURN_RULES } from "../src/services/cache-churn.js";
import { UsageStore } from "../src/services/records.js";

/** A finished leg's record shape, as the store holds it. */
const leg = (chain, { read = 0, write = 0, input = 0 }, extra = {}) => ({
  status: "ok",
  memory: { chain },
  tokens: { input, output: 100, cacheRead: read, cacheWrite: write },
  changes: [],
  ...extra,
});

describe("cache churn — the pure rules", () => {
  test("churnLegOf: the billed shape churns, the healthy shape does not, and the quiet ones say nothing", () => {
    // The $128 session's own shape: read pinned at a floor, the prefix re-written.
    const bad = churnLegOf(leg("c1", { read: 39_784, write: 250_000 }));
    assert.ok(bad && bad.churned, "write covering the prefix churns");
    assert.equal(bad.rewritten, 250_000);
    // The full-input variant (no write at all, the whole prefix billed as input).
    const miss = churnLegOf(leg("c1", { read: 39_784, input: 341_700 }));
    assert.ok(miss && miss.churned, "a whole-prefix input churns too");
    // Healthy: almost everything read back.
    const good = churnLegOf(leg("c1", { read: 388_000, write: 8_000 }));
    assert.ok(good && !good.churned, "a read-dominated leg is fine");
    // Cold start shape (nothing read, everything written) churns as a LEG — the watch's cold-start grace handles the session's first.
    const cold = churnLegOf(leg("c1", { write: 374_000 }));
    assert.ok(cold && cold.churned);
    // Silence: too small, no chain, memory's own, a command, a children-billed parent, a failed request.
    assert.equal(churnLegOf(leg("c1", { write: 10_000 })), null, "a small prompt is not a bill");
    assert.equal(churnLegOf({ status: "ok", tokens: { input: 50_000 } }), null, "no session, no verdict");
    assert.equal(churnLegOf(leg("c1", { write: 50_000 }, { memoryFor: "x" })), null, "memory's own call");
    assert.equal(churnLegOf(leg("c1", { write: 50_000 }, { local: true })), null, "an answered command");
    assert.equal(churnLegOf(leg("c1", { write: 50_000 }, { agent: { rounds: 1 } })), null, "a parent whose children bill");
    assert.equal(churnLegOf(leg("c1", { write: 50_000 }, { status: "error" })), null, "a failed request");
  });

  test("churnVerdict: three of the last four with a bill's worth re-written, and nothing less", () => {
    const churned = { churned: true, rewritten: 250_000 };
    const healthy = { churned: false, rewritten: 8_000 };
    assert.equal(churnVerdict([churned, churned, churned]), null, "three legs are not yet a window");
    assert.equal(churnVerdict([churned, churned, healthy, healthy]), null, "2 churned of 4 never fire");
    const v = churnVerdict([healthy, churned, churned, churned]);
    assert.ok(v, "3 of 4 fire");
    assert.equal(v.legs, 3);
    assert.equal(v.avg, 250_000);
    const pennies = { churned: true, rewritten: 25_000 };
    assert.equal(churnVerdict([pennies, pennies, pennies, pennies]), null, "pennies of churn are noise, not a bill");
    assert.match(churnNote({ legs: 3, avg: 250_000, rewritten: 750_000 }), /the client resends a changing history/);
  });
});

describe("cache churn — the watch", () => {
  test("the cold start is grace; the verdict fires once on the crossing request, then the cooldown holds and a fresh run re-arms", () => {
    /** @type {string[]} */
    const alerts = [];
    let t = 1_000_000;
    const w = createCacheChurnWatch({ onAlert: (kind, text) => alerts.push(`${kind}: ${text.slice(0, 30)}`), now: () => t });
    const churned = leg("c1", { read: 39_784, write: 250_000 });
    assert.equal(w.note(churned), null, "the session's first big write is a cold start");
    assert.equal(w.note(churned), null);
    assert.equal(w.note(churned), null);
    assert.equal(w.note(churned), null);
    const note = w.note(churned);
    assert.ok(note && note.includes("re-cached"), "the fourth churned leg after the cold start carries the note");
    // (fails before: yes — the owner's rules of 10-31: the note offered /trim, which no client has now)
    assert.match(note, /A cheaper model caps the cost\.$/);
    assert.doesNotMatch(note, /\/trim/);
    assert.equal(alerts.length, 1, "one alert per verdict");
    // The cooldown: a fresh run of legs within the window says nothing.
    assert.equal(w.note(churned), null);
    assert.equal(w.note(churned), null);
    assert.equal(w.note(churned), null);
    assert.equal(w.note(churned), null, "the cooldown holds without a fresh run of legs");
    t += CHURN_RULES.cooldownMs + 1;
    assert.ok(w.note(churned), "past the cooldown, a still-full window says it again at once — the churn never stopped");
    t += CHURN_RULES.cooldownMs + 1;
    assert.equal(w.note(churned), null);
    assert.equal(w.note(churned), null);
    assert.equal(w.note(churned), null);
    assert.ok(w.note(churned), "and a fresh run of legs past a lapsed cooldown fires again");
    assert.equal(alerts.length, 3);
  });

  test("a healthy session never hears a word, and sessions are judged apart", () => {
    /** @type {string[]} */
    const alerts = [];
    const w = createCacheChurnWatch({ onAlert: (kind, text) => alerts.push(text) });
    const good = leg("healthy", { read: 380_000, write: 8_000 });
    for (let i = 0; i < 10; i++) assert.equal(w.note(good), null);
    assert.equal(alerts.length, 0);
    for (let i = 0; i < 3; i++) w.note(leg("other", { read: 39_784, write: 250_000 }));
    assert.equal(alerts.length, 0, "the other session is still inside its own window");
  });

  test("the store's finish stamps the crossing record through the observer", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-churn-"));
    try {
      const store = new UsageStore({ dataDir: dir, options: { broadcast: false } });
      /** @type {string[]} */
      const alerts = [];
      const w = createCacheChurnWatch({ onAlert: (_k, text) => alerts.push(text) });
      store.setOnFinishRecord(w.note);
      const churned = leg("c1", { read: 39_784, write: 250_000 });
      const notes = [];
      let last = null;
      for (let i = 0; i < 5; i++) {
        const rec = { id: `r${i}`, _t0: performance.now(), model: "claude-opus-5-5", ...churned, changes: [] };
        store.finish(rec, { status: "ok" }, null);
        notes.push(rec.changes.at(-1) || "");
        last = rec;
      }
      assert.ok(notes[4].includes("re-cached ~250,000"), "the crossing record carries the note in its changes");
      assert.ok(notes.slice(0, 4).every((n) => n === ""), "the earlier legs and the cold start stay clean");
      assert.equal(alerts.length, 1);
      // One finish per record: a second call (a reply path's catch after a throw below the close) must not re-feed the watch or
      // re-book the day — the note count on the record and the alert count stay exactly as the first pass left them.
      assert.ok(last, "the loop ran");
      const changesBefore = last.changes.length;
      store.finish(last, { status: "ok" }, null);
      assert.equal(last.changes.length, changesBefore, "a re-finish adds no second note");
      assert.equal(alerts.length, 1, "and no second alert");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a throwing finish subscriber stays the subscriber's: finish returns, the throw is warned, the record is closed", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-churn-"));
    try {
      const store = new UsageStore({ dataDir: dir, options: {} });
      /** @type {string[]} */
      const warned = [];
      store.on("warn", (m) => warned.push(String(m)));
      store.on("event", (e) => { if (e.type === "finish") throw new Error("dashboard socket gone"); });
      const rec = /** @type {any} */ ({ id: "r-sub", _t0: performance.now(), model: "claude-opus-5-5", ...leg("c9", { read: 1000, write: 0 }), changes: [] });
      assert.doesNotThrow(() => store.finish(rec, { status: "ok" }, null), "a reply that completed is never turned into a stream failure");
      assert.equal(rec.status, "ok");
      assert.ok(rec.totalMs != null, "the record closed");
      assert.ok(warned.some((m) => m.includes("r-sub") && m.includes("dashboard socket gone")), `the throw is said: ${JSON.stringify(warned)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
