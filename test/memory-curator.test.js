// @ts-check
// The curator's frame (HarnessV3-Memory M4-1): a pass over a project's memory, each of its actions an event of the pass,
// within a budget of model calls per pass and per day, and undone exactly — marked, never deleted (M4-D6). Run through
// the real service on the fake engine, with a scripted model where one is needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/services/memory/archive.js";
import { KEY_PROMPT, MERGE_PROMPT, VERIFY_PROMPT, DOSSIER_PROMPT } from "../src/services/memory/curator.js";
import { world } from "./fixtures/memory-world.mjs";
import { until } from "./helpers/wait.js";

const DAY = 86_400_000;

/**
 * A scripted curator model: each prompt answered by its handler, every call kept. A handler gets the user text.
 * @param {{ key?: (u: string) => any, merge?: (u: string) => any, verify?: (u: string) => any, dossier?: (u: string) => any }} h
 */
function scripted(h) {
  /** @type {{ purpose: string, model: string, system: string, user: string }[]} */
  const calls = [];
  const fn = async (/** @type {any} */ a) => {
    calls.push({ purpose: a.purpose, model: a.model, system: a.system, user: a.user });
    const pick = a.system === KEY_PROMPT ? h.key : a.system === MERGE_PROMPT ? h.merge : a.system === VERIFY_PROMPT ? h.verify : a.system === DOSSIER_PROMPT ? h.dossier : null;
    if (!pick) throw new Error(`no script for ${String(a.purpose)}: ${String(a.system).slice(0, 40)}`);
    return JSON.stringify(pick(a.user));
  };
  return Object.assign(fn, { calls });
}
/** The numbered notes of a key or merge prompt, by number. @param {string} user */
const numbered = (user) => [...user.matchAll(/^(\d+)\. (?:A: )?(.*)$/gm)].map((m) => ({ n: Number(m[1]), text: m[2] }));

/** A project's id and a learned claim filer, after one session opened it. @param {any} w */
async function project(w) {
  const { sit } = await w.session("open").send("hello");
  const projectId = sit.project.id;
  let turn = 0;
  /** @param {string} kind @param {string} text @param {{ slot?: any, chain?: string, ageDays?: number }} [o] */
  const learned = async (kind, text, { slot = null, chain = `c${++turn}`, ageDays = 0 } = {}) => {
    const r = await w.svc.brain.fileLearned({ projectId, chainId: chain, kind, text, importance: 0.7, slot });
    if (ageDays) w.svc.archive.db.prepare("UPDATE items SET created_at = ? WHERE id = ?").run(Date.now() - ageDays * DAY, r.id);
    // The engine holds the claim before the next is learned, as it does between learning runs: the learner's near check
    // sees it, whatever the outbox's pace (a test never rides on it).
    await w.settle();
    return w.svc.archive.items.get(r.id);
  };
  return { projectId, learned };
}
/** The claim `it` stands for now: itself, or the survivor of the merge that superseded it. @param {any} w @param {any} it */
const standsFor = (w, it) => {
  const now = w.svc.archive.items.get(it.id);
  return now.status === "superseded" ? now.superseded_by : now.id;
};
/** The merge's pairs a scripted model was asked about, one string each. @param {any} model @returns {string[]} */
const pairsAsked = (model) => model.calls.filter((/** @type {any} */ x) => x.system === MERGE_PROMPT).flatMap((/** @type {any} */ x) => x.user.split(/\n(?=\d+\. )/));
/** What undo must give back exactly: each claim's standing and slot, and what confidence counts. @param {any} w @param {number[]} ids */
const snapshot = (w, ids) => {
  const counts = w.svc.archive.items.eventCounts(ids);
  return ids.map((id) => {
    const it = w.svc.archive.items.get(id);
    const c = counts.get(id) || { evidence: 0, suspected: 0 };
    return [id, it.status, it.superseded_by, it.invalid_reason, it.slot, it.slot_value, it.slot_multi, c.evidence, c.suspected];
  });
};

test("the curator's events carry its run; an undone one is kept and no longer counts", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-curator-"));
  try {
    const b = new Archive(/** @type {any} */ ({ file: join(dir, "archive.db") }));
    try {
      const it = b.items.add({ projectId: "p", kind: "fact", text: "the api listens on port 3000", origin: "person" });
      assert.deepEqual(b.items.events(it.id).map((e) => [e.action, e.run_id, e.undone_at]), [["created", null, null]], "a claim's own history has no run");
      // (fails before: yes — a pass started with no owner was written, and the open-pass sweep could never tell whose it was)
      assert.throws(() => b.curator.start(/** @type {any} */ ({ projectId: "p", reason: "test" })), /names its owner/);
      const run = b.curator.start({ projectId: "p", reason: "test", owner: { host: "h", pid: 1, instance: "t" } });
      b.items.note(it.id, "evidence", { by: "curator", run, detail: { chain: "x" } });
      assert.deepEqual(b.curator.events(run).map((e) => [e.action, e.item_id]), [["evidence", it.id]]);
      assert.equal(b.items.eventCounts([it.id]).get(it.id)?.evidence, 1);
      b.curator.undoneEvent(b.curator.events(run)[0].id);
      assert.equal(b.items.eventCounts([it.id]).get(it.id)?.evidence ?? 0, 0, "an undone event does not count");
      assert.equal(b.items.events(it.id).length, 2, "and is kept");
    } finally {
      b.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a pass with no model runs only the steps that need none, and calls nothing", async () => {
  const model = scripted({});
  await world({ callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    const stale = await learned("thread", "the flaky upload test still needs a fix", { ageDays: 40 });
    const fresh = await learned("thread", "the release notes still need a changelog section", { ageDays: 2 });
    const unkeyed = await learned("fact", "the api listens on port 3000");
    const r = await w.svc.curator.run(projectId);
    assert.equal(r.model, null, "no summarizer and no curator model: none");
    assert.equal(r.calls, 0);
    assert.equal(model.calls.length, 0, "the model is never called");
    assert.equal(w.svc.archive.items.get(stale.id).status, "dismissed");
    assert.match(w.svc.archive.items.get(stale.id).invalid_reason, /^expired: an open thread no session took up since \d{4}-\d{2}-\d{2}$/);
    assert.equal(w.svc.archive.items.get(fresh.id).status, "inferred", "a fresh thread stays");
    assert.equal(w.svc.archive.items.get(unkeyed.id).slot, null, "keying needs the model");
    const run = w.svc.archive.curator.get(Number(r.run.slice(1)));
    assert.deepEqual([run.calls, run.actions, run.reason, run.model, run.error], [0, 1, "manual", null, null]);
    assert.ok(run.ended_at >= run.started_at);
    const ev = w.svc.archive.items.events(stale.id).at(-1);
    assert.deepEqual([ev.action, ev.by, ev.run_id], ["status", "curator", run.id], "the action names its pass");
  });
});

test("the curator works with memory's model; memory.curator.usesModel off is none", async () => {
  await world({ models: { summarizer: "cheap-1" } }, async (w) => {
    assert.equal(w.svc.curatorModel(), "cheap-1");
    w.cfg.memory.curator.usesModel = false;
    assert.equal(w.svc.curatorModel(), "", "the curator works by rule alone");
    w.cfg.memory.curator.usesModel = true;
    w.cfg.memory.models.summarizer = "off";
    assert.equal(w.svc.curatorModel(), "", "memory's model off: none");
  });
});

// (fails before: yes — the keyer spent the one call, and the dossier, which every session reads, was starved)
test("a pass out of its budget stops calling and says so, the dossier's call kept for it; the steps that need no model still run", async () => {
  const dossier = (/** @type {string} */ u) => {
    const [, id, text] = /^(i\d+) \[[^\]]*\] (.*)$/m.exec(u) || [];
    return { sections: [{ title: "Facts", lines: [{ text, cites: [id] }] }] };
  };
  const model = scripted({ key: () => ({ slots: [] }), merge: () => ({ pairs: [] }), dossier });
  await world({ models: { summarizer: "judge" }, curator: { maxCalls: 1 }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    await learned("fact", "the api listens on port 3000");
    await learned("convention", "builds run through the npm run build script");
    await learned("convention", "to build the app, always use npm run build rather than calling vite directly");
    const stale = await learned("thread", "the flaky upload test still needs a fix", { ageDays: 40 });
    const r = await w.svc.curator.run(projectId);
    assert.equal(r.calls, 1);
    assert.equal(model.calls.length, 1);
    assert.deepEqual([model.calls[0].purpose, model.calls[0].model], ["curate", "judge"], "through the front door as purpose curate, on its own model");
    assert.match(r.stopped, /budget of 1 model call a pass \(memory\.curator\.maxCalls\), the dossier's call kept for it/);
    assert.equal(model.calls[0].system, DOSSIER_PROMPT, "the keyer had claims to key, and left the dossier its call");
    assert.equal(r.dossier, "v1");
    assert.equal(w.svc.archive.items.get(stale.id).status, "dismissed", "expiry ran");
    assert.equal(w.svc.archive.curator.get(Number(r.run.slice(1))).detail.stopped, r.stopped, "the pass's record says so");
    // (fails before: yes — the call was kept for a dossier that would stand as it was, and the keyer got none, ever)
    // Nothing moved since: the dossier would stand, and the keyer has the call.
    const r2 = await w.svc.curator.run(projectId);
    assert.deepEqual([r2.calls, model.calls.at(-1)?.system, r2.dossier], [1, KEY_PROMPT, "v1 unchanged"]);
  });
});

// (fails before: yes — the dossier the last call's answer moved was left as it was, and the project waited for something
// to be learned before its next pass)
test("where the last call went to a step whose answer moved what the dossier is written from, the dossier is owed and the next pass writes it", async () => {
  const dossier = (/** @type {string} */ u) => ({ sections: [{ title: "Facts", lines: [...u.matchAll(/^(i\d+) \[fact[^\]]*\] (.*)$/gm)].map((m) => ({ text: m[2], cites: [m[1]] })) }] });
  const key = (/** @type {string} */ u) => ({ slots: numbered(u).map((x) => ({ n: x.n, subject: "api", attribute: "port", value: /\b(\d{4})\b/.exec(x.text)?.[1], multi: false })) });
  const model = scripted({ key, merge: () => ({ pairs: [] }), dossier });
  await world({ models: { summarizer: "judge" }, curator: { maxCalls: 1, everyHours: 0 }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    const old = await learned("fact", "the api listens on port 3000");
    const now = await learned("fact", "the backend binds 8080 for its http endpoints since the proxy moved");
    assert.notEqual(old.id, now.id, "two claims");
    // The first pass keeps its one call for the dossier, which has none yet.
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v1");
    // Nothing moved since: the keyer has the call, and its answer settles the slot - the older port is retired.
    const r2 = await w.svc.curator.run(projectId);
    assert.deepEqual([r2.calls, model.calls.at(-1)?.system], [1, KEY_PROMPT]);
    assert.equal(w.svc.archive.items.get(old.id).status, "superseded", JSON.stringify(r2));
    assert.deepEqual([r2.dossier, r2.dossierOwed], ["owed: no call left to write it, so the next pass is due", true]);
    assert.equal(w.svc.curator.due(projectId), true, "due, though nothing was learned since");
    const r3 = await w.svc.curator.run(projectId);
    assert.equal(r3.dossier, "v2");
    assert.deepEqual(w.svc.archive.dossiers.latest(projectId).cites, [now.id]);
    assert.equal(w.svc.curator.due(projectId), false, "nothing owed, nothing learned");
  });
});

test("undo puts back statuses, slots and what confidence counts exactly, marks the actions and keeps them", async () => {
  const model = scripted({
    key: (u) => ({ slots: numbered(u).filter((x) => /port/.test(x.text)).map((x) => ({ n: x.n, subject: "api", attribute: "port", value: x.text.match(/\d{4}/)?.[0] })) }),
    merge: (u) => ({ pairs: numbered(u).map((x) => ({ n: x.n, same: true })) }),
  });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    const oldPort = await learned("fact", "the api server listens on port 3000", { chain: "s1" });
    w.svc.archive.db.prepare("UPDATE items SET created_at = ? WHERE id = ?").run(Date.now() - 5 * DAY, oldPort.id);
    const newPort = await learned("fact", "the api listens on port 8080 now", { slot: { slot: "api · port", value: "8080", multi: false }, chain: "s2" });
    const a = await learned("convention", "builds run through the npm run build script", { chain: "s3" });
    const b = await learned("convention", "to build the app, always use npm run build rather than calling vite directly", { chain: "s4" });
    const ids = [oldPort.id, newPort.id, a.id, b.id];
    const before = snapshot(w, ids);
    const r = await w.svc.curator.run(projectId);
    assert.equal(w.svc.archive.items.get(oldPort.id).status, "superseded", "keyed into the slot, the older value is replaced");
    assert.equal(w.svc.archive.items.get(oldPort.id).superseded_by, newPort.id);
    assert.equal(w.svc.archive.items.get(b.id).status, "superseded", "the two wordings merged");
    assert.equal(w.svc.archive.items.eventCounts([a.id]).get(a.id).evidence, 1, "the merged one's session counts for the survivor");
    assert.notDeepEqual(snapshot(w, ids), before);
    const run = Number(r.run.slice(1));
    const u = await w.svc.brain.undoRun(run, { by: "owner" });
    assert.deepEqual([u.ok, u.skipped], [true, []]);
    assert.ok(u.undone >= 4, String(u.undone));
    assert.deepEqual(snapshot(w, ids), before, "exactly as before");
    assert.ok(w.svc.archive.curator.get(run).undone_at, "the pass is marked undone");
    assert.equal(w.svc.archive.curator.get(run).undone_by, "owner");
    assert.deepEqual(w.svc.archive.curator.events(run), [], "no action of it stands");
    const h = w.svc.brain.history(`i${oldPort.id}`);
    const slotEv = h.events.find((/** @type {any} */ e) => e.action === "slot");
    assert.ok(slotEv.undone && slotEv.run === run, "the history keeps what the curator did, marked undone");
    assert.ok(h.events.some((/** @type {any} */ e) => e.action === "undo" && e.by === "owner"), "and who undid it");
    assert.equal((await w.svc.brain.undoRun(run, { by: "owner" })).already, true, "twice is once");
  });
});

// (fails before: yes — the merge grouped every pair judged the same through any chain of pairs, and asked again about a
// pair an earlier pass found distinct when its verdict sat on the other claim: two claims known distinct became one)
test("the merge never joins two claims known distinct, either way round, not even through a third that resembles both", async () => {
  const model = scripted({ key: () => ({ slots: [] }), merge: (u) => ({ pairs: numbered(u).map((x) => ({ n: x.n, same: true })) }) });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    const a = await learned("convention", "builds run through the npm run build script", { chain: "s3" });
    const b = await learned("convention", "to build the app, always use npm run build rather than calling vite directly", { chain: "s4" });
    const c = await learned("convention", "the app ships from the npm build script, never from vite", { chain: "s5" });
    w.svc.archive.items.note(a.id, "distinct", { by: "curator", detail: { other: c.id } });
    await w.svc.curator.run(projectId);
    assert.ok(!pairsAsked(model).some((p) => p.includes(a.text) && p.includes(c.text)), "the pair known distinct is not asked about");
    assert.notEqual(standsFor(w, a), standsFor(w, c), "the two stay two claims");
    assert.equal([a, b, c].filter((it) => w.svc.archive.items.get(it.id).status === "superseded").length, 1, "the most alike pair merged");
  });
});

// (fails before: yes — the merge joined two claims known distinct through a third: whichever of them held an earlier
// pass's verdict, and when the pass gave the verdict itself)
test("a pair found distinct stays two claims whichever of them holds the verdict, and when the pass itself finds it", async () => {
  const A = "builds run through the npm run build script";
  const B = "to build the app, always use npm run build rather than calling vite directly";
  const C = "the app ships from the npm build script, never from vite";
  const same = scripted({ key: () => ({ slots: [] }), merge: (u) => ({ pairs: numbered(u).map((x) => ({ n: x.n, same: true })) }) });
  await world({ models: { summarizer: "judge" }, callModel: same }, async (w) => {
    const { projectId, learned } = await project(w);
    const a = await learned("convention", A, { chain: "s3" });
    await learned("convention", B, { chain: "s4" });
    const c = await learned("convention", C, { chain: "s5" });
    w.svc.archive.items.note(c.id, "distinct", { by: "curator", detail: { other: a.id } });
    await w.svc.curator.run(projectId);
    assert.ok(!pairsAsked(same).some((p) => p.includes(A) && p.includes(C)), "not asked about");
    assert.notEqual(standsFor(w, a), standsFor(w, c));
  });
  const judging = scripted({ key: () => ({ slots: [] }), merge: (u) => ({ pairs: u.split(/\n(?=\d+\. )/).map((p) => ({ n: Number(/^\d+/.exec(p)?.[0]), same: !(p.includes(A) && p.includes(C)) })) }) });
  await world({ models: { summarizer: "judge" }, callModel: judging }, async (w) => {
    const { projectId, learned } = await project(w);
    const a = await learned("convention", A, { chain: "s3" });
    await learned("convention", B, { chain: "s4" });
    const c = await learned("convention", C, { chain: "s5" });
    await w.svc.curator.run(projectId);
    assert.ok(pairsAsked(judging).some((p) => p.includes(A) && p.includes(C)), "asked, and judged distinct");
    assert.notEqual(standsFor(w, a), standsFor(w, c), "the pass's own verdict keeps them apart");
  });
});

// (fails before: yes — the bug hunt of 10-30, MEMR-6: the merge joined claims through any chain of pairs judged the
// same, so a third claim went into a survivor it was never put beside, and what it said that the survivor does not went
// with it)
test("the merge joins only claims each judged the same as the others: one never put beside the survivor stays its own claim", async () => {
  const A = "the release script tags the version and pushes the tag";
  const B = "the release script pushes the tag, then the pipeline builds the installer";
  const C = "the pipeline builds the installer on a manual start or a tag push";
  const model = scripted({ key: () => ({ slots: [] }), merge: (u) => ({ pairs: numbered(u).map((x) => ({ n: x.n, same: true })) }) });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    const a = await learned("convention", A, { chain: "s3" });
    const b = await learned("convention", B, { chain: "s4" });
    const c = await learned("convention", C, { chain: "s5" });
    assert.equal(new Set([a.id, b.id, c.id]).size, 3, "three claims");
    await w.svc.curator.run(projectId);
    assert.ok(pairsAsked(model).some((p) => p.includes(A) && p.includes(B)) && pairsAsked(model).some((p) => p.includes(B) && p.includes(C)), "A and B, B and C were judged the same");
    assert.ok(!pairsAsked(model).some((p) => p.includes(A) && p.includes(C)), "A and C share too few words to be put to the model");
    assert.notEqual(standsFor(w, a), standsFor(w, c), "so they stay two claims");
    assert.equal(standsFor(w, c), standsFor(w, b), "the pair judged the same merged");
  });
});

// (fails before: no — a guard the mutation pass asked for: a verdict undone with its pass counts no more)
test("a distinct verdict undone with its pass keeps nothing apart: the pair is asked again", async () => {
  let same = false;
  const model = scripted({ key: () => ({ slots: [] }), merge: (u) => ({ pairs: numbered(u).map((x) => ({ n: x.n, same })) }) });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    const a = await learned("convention", "builds run through the npm run build script", { chain: "s3" });
    const b = await learned("convention", "to build the app, always use npm run build rather than calling vite directly", { chain: "s4" });
    const first = await w.svc.curator.run(projectId);
    assert.notEqual(standsFor(w, a), standsFor(w, b), "judged distinct");
    await w.svc.brain.undoRun(Number(first.run.slice(1)), { by: "owner" });
    same = true;
    await w.svc.curator.run(projectId);
    assert.equal(standsFor(w, a), standsFor(w, b), "asked again, and merged");
  });
});

// (fails before: yes — the dossier's sessions were the project's newest chains whatever their kind: an outside agent's
// MCP chain or a loop's tick was written up as one of the project's sessions)
test("the dossier is written from the person's sessions, never an outside agent's MCP chain or a loop's tick", async () => {
  const model = scripted({ key: () => ({ slots: [] }), merge: () => ({ pairs: [] }), dossier: () => ({ sections: [] }) });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId } = await project(w);
    const a = w.svc.archive;
    const mine = a.chainsForProject(projectId)[0];
    const later = mine.last_at + 60_000;
    const others = [["d-mcp", "mcp"], ["d-tick", "tick"]].map(([key, kind]) => {
      const c = a.chainForKey(key, { cwd: a.getProject(projectId).cwd, kind });
      a.db.prepare("UPDATE chains SET last_at = ? WHERE id = ?").run(later, c.id);
      return c.id;
    });
    for (const id of [mine.id, ...others]) a.setState(id, { status: "open", summary: `the work of session ${id}` });
    await w.svc.curator.run(projectId);
    const user = model.calls.find((x) => x.system === DOSSIER_PROMPT)?.user || "";
    assert.ok(user.includes(`the work of session ${mine.id}`) && !others.some((id) => user.includes(id)), user);
  });
});

test("an action whose claim changed since is not overwritten: it is named, and the pass is not marked undone", async () => {
  const model = scripted({ key: () => ({ slots: [] }), merge: (u) => ({ pairs: numbered(u).map((x) => ({ n: x.n, same: true })) }) });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    const a = await learned("convention", "builds run through the npm run build script", { chain: "s3" });
    const b = await learned("convention", "to build the app, always use npm run build rather than calling vite directly", { chain: "s4" });
    const r = await w.svc.curator.run(projectId);
    assert.equal(w.svc.archive.items.get(b.id).status, "superseded");
    await w.svc.scope({ role: "owner" }).setStatus(b.id, "dismissed", { reason: "wrong after all" });
    const u = await w.svc.brain.undoRun(Number(r.run.slice(1)), { by: "owner" });
    assert.deepEqual(u.skipped.map((/** @type {any} */ s) => [s.id, s.action, s.why]), [[`i${b.id}`, "status", "it is dismissed now, not superseded"]]);
    assert.equal(w.svc.archive.items.get(b.id).status, "dismissed", "the owner's word stands");
    assert.equal(w.svc.archive.items.eventCounts([a.id]).get(a.id)?.evidence ?? 0, 0, "the rest is undone");
    assert.equal(w.svc.archive.curator.get(Number(r.run.slice(1))).undone_at, null);
  });
});

test("the curator never writes a claim's words, and only the user answers, runs or undoes (M4-D3)", async () => {
  await world({}, async (w) => {
    const { projectId } = await project(w);
    await assert.rejects(w.svc.brain.remember("a sentence of the curator's", { by: "curator", projectId }), /never writes a claim's words/);
    const it = (await w.svc.brain.remember("the api listens on port 3000", { by: "person", projectId })).itemId;
    await assert.rejects(w.svc.brain.correct(`i${it}`, { text: "port 8080", by: "curator" }), /never writes a claim's words/);
    const model = w.svc.scope({ role: "model", project: projectId });
    await assert.rejects(model.curate(), /only the user runs the curator/);
    await assert.rejects(model.undo("r1"), /only the user undoes a curator pass/);
    await assert.rejects(model.decide("q1", "accept"), /only the user answers memory's questions/);
    assert.deepEqual(await w.svc.brain.decide("q1", "accept", { by: "agent" }), { ok: false, error: "only the user answers memory's questions" });
  });
});

test("passes run one after another; a poke makes one pass per scope that is due, in the background", async () => {
  await world({}, async (w) => {
    const { projectId, learned } = await project(w);
    const order = [];
    const p1 = w.svc.curator.run(projectId).then(() => order.push(1));
    const p2 = w.svc.curator.run(projectId).then(() => order.push(2));
    await Promise.all([p1, p2]);
    assert.deepEqual(order, [1, 2]);
    assert.equal(w.svc.archive.curator.list({ projectId }).length, 2);
    // (fails before: yes — a learning run queued a pass, debounced, whatever the last one was; a burst of pokes now
    // makes one pass, and only where the scope is due)
    assert.deepEqual(w.svc.curator.poke(projectId), [], "nothing learned since its last pass: not due");
    // A claim filed in the very millisecond a pass began is no change since it: the steps here are a few apart.
    const apart = () => new Promise((r) => setTimeout(r, 5));
    await apart();
    await learned("fact", "the api listens on port 3000");
    await apart();
    assert.deepEqual(w.svc.curator.poke(projectId), [], "its last pass is under 6 hours old");
    w.cfg.memory.curator.everyHours = 0;
    assert.deepEqual(w.svc.curator.poke(projectId), [projectId], "a claim since, and the hours past: due");
    assert.deepEqual(w.svc.curator.poke(projectId), [], "a burst makes one pass");
    assert.deepEqual(w.svc.curator.queued(), [projectId]);
    await until(() => !w.svc.curator.queued().length, "the pass ends");
    assert.equal(w.svc.archive.curator.list({ projectId }).length, 3);
    assert.equal(w.svc.archive.curator.list({ projectId })[0].reason, "learned");
    await apart();
    assert.deepEqual(w.svc.curator.poke(projectId), [], "nothing learned since that pass");
    assert.deepEqual(w.svc.curator.poke("none"), [], "no project, no pass");
    await learned("fact", "the docs site is deployed to netlify");
    w.cfg.memory.curator.enabled = false;
    assert.deepEqual(w.svc.curator.poke(projectId), []);
    assert.deepEqual(await w.svc.curator.run(projectId), { skipped: "the curator is off (memory.curator.enabled)" });
  });
});

// (fails before: yes — the review of m1: due read the claims' updated_at, so the pass's own keying and the engine's copy
// of a claim made the next pass due though nothing was learned, and a claim said again, an event alone, did not)
test("due: a claim filed or said again since the last pass; the curator's own keying and the engine's copy are no change", async () => {
  await world({ curator: { everyHours: 0 } }, async (w) => {
    const { projectId, learned } = await project(w);
    await learned("fact", "the api listens on port 3000");
    await w.svc.curator.run(projectId);
    const it = w.svc.archive.items.list({}).find((/** @type {any} */ x) => x.text.includes("3000"));
    await new Promise((r) => setTimeout(r, 5));
    w.svc.archive.items.setSlot(it.id, { slot: "api|port", value: "3000" });
    w.svc.archive.items.setMemoryId(it.id, "m-1");
    assert.equal(w.svc.curator.due(projectId), false, "its keying and its engine copy: nothing learned");
    w.svc.archive.items.note(it.id, "evidence", { by: "learner", detail: { chain: "c2" } });
    assert.equal(w.svc.curator.due(projectId), true, "said again by another session");
  });
});

test("the global claims are a scope of their own: a poke passes over them where they changed", async () => {
  await world({ curator: { everyHours: 0 } }, async (w) => {
    const { projectId } = await project(w);
    assert.deepEqual(w.svc.curator.poke(projectId), [], "nothing learned anywhere");
    await w.svc.brain.fileLearned({ projectId: null, chainId: "g1", kind: "preference", text: "answer in short paragraphs", importance: 0.7 });
    assert.deepEqual(w.svc.curator.poke(projectId), [null], "the global claims changed; the project did not");
    await until(() => !w.svc.curator.queued().length, "the pass ends");
    assert.equal(w.svc.archive.curator.list({ projectId: null }).length, 1);
  });
});

test("the service pokes the curator as a learning run lands and as a chat of the project starts a turn", async () => {
  const learnt = { items: [{ kind: "convention", text: "Deploy with npm run deploy from the main branch only.", importance: 0.7, turn: 1 }] };
  const callModel = async (/** @type {any} */ a) => JSON.stringify(a.purpose === "learn" ? learnt : {});
  await world({ models: { summarizer: "learn-1" }, curator: { everyHours: 0 }, callModel }, async (w) => {
    /** @type {[string | null, string][]} */
    const pokes = [];
    const poke = w.svc.curator.poke.bind(w.svc.curator);
    w.svc.curator.poke = (/** @type {string | null} */ p, /** @type {string} */ why) => (pokes.push([p, why]), poke(p, why));
    // The person's rule, kept by their word (nothing is filed from a message by its words, the memory plan's d3): the next
    // turn's start finds it filed since the project's last pass, none.
    const s = w.session("learning");
    const { sit } = await s.remember("we always run npm test before every commit", { kind: "rule" });
    const { prep } = await s.send("and run the linter too");
    assert.deepEqual(pokes, [[sit.project.id, "turn"], [sit.project.id, "turn"]], "each turn's start pokes its project");
    const out = await w.svc.learner.learnChain(prep.chain, { reason: "manual", force: true });
    assert.ok(out && !out.error && !out.skipped, JSON.stringify(out));
    assert.deepEqual(pokes.at(-1), [sit.project.id, "learned"]);
    // The person's rule made the second turn's pass due; the claim the learning run filed, the next.
    await until(() => w.svc.archive.curator.list({ projectId: sit.project.id }).some((/** @type {any} */ r) => r.reason === "learned" && r.ended_at), "the learned claims' pass ran");
    const runs = w.svc.archive.curator.list({ projectId: sit.project.id });
    assert.deepEqual(runs.map((/** @type {any} */ r) => [r.reason, r.model]), [["learned", "learn-1"], ["turn", "learn-1"]], "each on memory's model");
  });
});

// (fails before: yes — the live leg's fourth run: the keyer, shown no slot in use, keyed the user's "api · port = 3000" and the code's "server · port = 4000" apart, and a note it gave eight slots by the last; the user's stale word stood, and nothing asked them)
test("M7-D71: the keyer is shown the slots in use, the user's word first; a note given several slots is not keyed, and one keyed into the user's slot with another value asks the user", async () => {
  /** @type {string[]} */
  const asked = [];
  const model = scripted({
    key: (u) => {
      asked.push(u);
      return {
        slots: numbered(u).flatMap((x) =>
          /summary/.test(x.text)
            ? [
                { n: x.n, subject: "server", attribute: "port", value: "4000" },
                { n: x.n, subject: "readme", attribute: "port", value: "3000" },
              ]
            : /http server/.test(x.text)
              ? [{ n: x.n, subject: "api", attribute: "port", value: "4000" }]
              : /deploy region/.test(x.text)
                ? [{ n: x.n, subject: "deploy", attribute: "region", value: "eu-west-2" }]
                : [],
        ),
      };
    },
    merge: () => ({ pairs: [] }),
    dossier: () => ({ sections: [] }),
  });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    const region = await learned("fact", "the deploy region is eu-west-2");
    await w.svc.curator.run(projectId);
    assert.deepEqual([asked, w.svc.archive.items.get(region.id).slot], [[`Notes:\n1. ${region.text}`], "deploy · region"], "no slot in use yet: the notes alone");
    const said = (await w.svc.brain.remember("The api listens on port 3000.", { by: "person", projectId })).itemId;
    w.svc.archive.items.setSlot(said, { slot: "api · port", value: "3000", multi: false });
    w.svc.archive.db.prepare("UPDATE items SET created_at = ? WHERE id = ?").run(Date.now() - DAY, said);
    // Keyed since into the user's slot with the same value, so both stand there: a slot is shown once, as the user said it.
    const same = await learned("fact", "the service's port number is 3000");
    w.svc.archive.items.setSlot(same.id, { slot: "api · port", value: "3000", multi: false });
    await learned("fact", "the api answers in json and in xml", { slot: { slot: "api · formats", value: "json", multi: true } });
    const moved = await learned("fact", "the cache store was moved off memcached");
    w.svc.archive.items.setSlot(moved.id, { slot: "cache · store", value: null, multi: false }); // a correction's replacement keeps the slot, not a value
    const summary = await learned("fact", "Project summary: demo-api answers on 4000 per src/server.js, while its README says 3000");
    const http = await learned("fact", "the http server listens on port 4000");
    await w.svc.curator.run(projectId);
    assert.equal(
      asked[1],
      `Slots in use (subject · attribute = value):\n- api · port = 3000 (the user's word)\n- deploy · region = eu-west-2\n- api · formats (several values)\n- cache · store\n\nNotes:\n1. ${summary.text}\n2. ${http.text}`,
      "the slots in use, the user's word first, then the notes",
    );
    const left = w.svc.archive.items.get(summary.id);
    const unkeyed = w.svc.archive.items.events(summary.id).find((/** @type {any} */ e) => e.action === "unkeyed");
    assert.deepEqual([left.slot, unkeyed?.reason], [null, "it names several values: server · port = 4000, readme · port = 3000"], "never keyed by whichever came last");
    assert.equal(w.svc.archive.items.get(http.id).status, "dismissed", "the user's word holds its slot");
    const q = w.svc.brain.questions(projectId).find((/** @type {any} */ x) => x.proposal?.id === said);
    assert.deepEqual([q?.kind, q?.reason, q?.proposal?.value], ["retire", "a later session said otherwise: 4000", "4000"], "and the user is asked whether 4000 replaces their 3000");
  });
});

test("M7-D71: the keyer is shown at most 40 slots in use, the user's word first", async () => {
  /** @type {string[]} */
  const asked = [];
  const model = scripted({ key: (u) => (asked.push(u), { slots: [] }), merge: () => ({ pairs: [] }), dossier: () => ({ sections: [] }) });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    for (let i = 1; i <= 40; i++) await learned("fact", `service number ${i} listens on port ${4000 + i}`, { slot: { slot: `service ${i} · port`, value: String(4000 + i), multi: false } });
    const said = (await w.svc.brain.remember("The api listens on port 3000.", { by: "person", projectId })).itemId;
    w.svc.archive.items.setSlot(said, { slot: "api · port", value: "3000", multi: false });
    await learned("fact", "the build output goes to the dist folder");
    await w.svc.curator.run(projectId);
    const lines = asked[0].split("\n").filter((l) => l.startsWith("- "));
    assert.deepEqual([lines.length, lines[0], lines.at(-1)], [40, "- api · port = 3000 (the user's word)", "- service 39 · port = 4039"]);
  });
});

test("M7-D71: the keying prompt asks for one slot a thing, the slot in use reused whatever the note calls it", () => {
  assert.match(KEY_PROMPT, /Slots in use, when given, come before the notes: when a note speaks of one of those things, use its subject and attribute exactly, whatever the note calls it \(the api, the server, the http server, when they are one thing\)\./);
  assert.match(KEY_PROMPT, /Notes that speak of the same thing take the same subject and attribute\. Give a note one slot at most: a note that states several values, or sums up several things, is left out\./);
});
