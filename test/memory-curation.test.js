// @ts-check
// What a curator pass does to a project's memory (HarnessV3-Memory M4-2..M4-5): claims that say the same thing become
// one, the survivor chosen by rule; unkeyed values get their slot, only with a value in their own words; a claim whose
// file changed is checked against the file; an open thread nobody takes up expires. The model is scripted here; the live
// check runs a real one (M4-8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEY_PROMPT, MERGE_PROMPT, VERIFY_PROMPT, DOSSIER_PROMPT, mayMerge, survivorOrder, excerptOf } from "../src/services/memory/curator.js";
import { confidenceOf, DOSSIER_SECTIONS, DOSSIER_UNUSED_SESSIONS } from "../src/services/memory/brain.js";
import { memoryCommand } from "../src/app/commands/mem.js";
import { world, memoryLines } from "./fixtures/memory-world.mjs";
import { fileURLToPath } from "node:url";

const DAY = 86_400_000;

/**
 * A scripted model: each prompt's handler gets the user text; every call is kept.
 * @param {{ key?: (u: string) => any, merge?: (u: string) => any, verify?: (u: string) => any, dossier?: (u: string) => any }} h
 */
function scripted(h) {
  /** @type {{ system: string, user: string }[]} */
  const calls = [];
  const fn = async (/** @type {any} */ a) => {
    calls.push({ system: a.system, user: a.user });
    const pick = a.system === KEY_PROMPT ? h.key : a.system === MERGE_PROMPT ? h.merge : a.system === VERIFY_PROMPT ? h.verify : a.system === DOSSIER_PROMPT ? h.dossier : null;
    return JSON.stringify(pick ? pick(a.user) : a.system === KEY_PROMPT ? { slots: [] } : a.system === MERGE_PROMPT ? { pairs: [] } : { sections: [] });
  };
  return Object.assign(fn, { calls, of: (/** @type {string} */ p) => calls.filter((c) => c.system === p) });
}
/** The numbered pairs of a merge prompt: their A and B texts. @param {string} u */
const pairsOf = (u) => [...u.matchAll(/^(\d+)\. A: \[\w+\] (.*)\n {3}B: \[\w+\] (.*)$/gm)].map((m) => ({ n: Number(m[1]), a: m[2], b: m[3] }));
const allSame = (/** @type {string} */ u) => ({ pairs: pairsOf(u).map((p) => ({ n: p.n, same: true })) });

/** A project and a filer of learned claims in it. @param {any} w */
async function project(w) {
  const { sit } = await w.session("open").send("hello");
  const projectId = sit.project.id;
  let n = 0;
  /** @param {string} kind @param {string} text @param {{ slot?: any, chain?: string, ageDays?: number }} [o] */
  const learned = async (kind, text, { slot = null, chain = `c${++n}`, ageDays = 0 } = {}) => {
    const r = await w.svc.brain.fileLearned({ projectId, chainId: chain, kind, text, importance: 0.7, slot });
    if (ageDays) w.svc.archive.db.prepare("UPDATE items SET created_at = ? WHERE id = ?").run(Date.now() - ageDays * DAY, r.id);
    // The engine holds the claim before the next is learned, as it does between learning runs: the learner's near check
    // sees it, whatever the outbox's pace (a test never rides on it).
    await w.settle();
    return w.svc.archive.items.get(r.id);
  };
  return { sit, projectId, learned };
}
/** @param {(dir: string) => Promise<void>} body */
async function inFolder(body) {
  const dir = mkdtempSync(join(tmpdir(), "filament-curation-"));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- M4-2: merge ----
test("two claims holding rival values are never put to the model as the same; a different kind is not either", async () => {
  const at = { created_at: 1, id: 1, status: "inferred", origin: "learner" };
  assert.equal(mayMerge({ ...at, kind: "fact", text: "we install packages with pnpm in this repo" }, { ...at, kind: "fact", text: "we install packages with bun in this repo" }), false, "rival package managers");
  assert.equal(mayMerge({ ...at, kind: "fact", text: "the api listens on port 3000" }, { ...at, kind: "fact", text: "the api listens on port 8080" }), false, "rival ports");
  assert.equal(mayMerge({ ...at, kind: "fact", slot: "api · host", slot_value: "alpha", text: "the api host is alpha" }, { ...at, kind: "fact", slot: "api · host", slot_value: "beta", text: "the api host is beta" }), false, "rival slot values");
  assert.equal(mayMerge({ ...at, kind: "fact", text: "deploys need two approvals" }, { ...at, kind: "decision", text: "deploys need two approvals" }), false, "a fact and a decision");
  assert.equal(mayMerge({ ...at, kind: "rule", text: "never push to main" }, { ...at, kind: "preference", text: "never push to main" }), true, "two kinds that tell how to work");
  const model = scripted({ merge: allSame });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    const a = await learned("fact", "we install the packages with pnpm in this repo");
    const b = await learned("fact", "we install the packages with bun in this repo");
    await w.svc.curator.run(projectId);
    assert.deepEqual(model.of(MERGE_PROMPT), [], "no pair to judge");
    assert.deepEqual([w.svc.archive.items.get(a.id).status, w.svc.archive.items.get(b.id).status], ["inferred", "inferred"]);
  });
});

test("the survivor of a merge is chosen by rule: the user's word, then confirmed, then more sessions, then the oldest", () => {
  const c = (/** @type {any} */ o) => ({ id: o.id, created_at: o.at ?? o.id, origin: "learner", status: "inferred", ...o });
  /** @param {any[]} xs @param {Map<number, { evidence: number }>} [counts] */
  const keep = (xs, counts = new Map()) => [...xs].sort((x, y) => survivorOrder(x, y, counts))[0].id;
  assert.equal(keep([c({ id: 1 }), c({ id: 2, origin: "person", status: "confirmed" })]), 2, "the user's word over an older learned one");
  assert.equal(keep([c({ id: 1, origin: "correction" }), c({ id: 2, status: "confirmed" })]), 1, "said by the user over confirmed");
  assert.equal(keep([c({ id: 1 }), c({ id: 2, status: "confirmed" })]), 2, "confirmed over inferred");
  assert.equal(keep([c({ id: 1 }), c({ id: 2 })], new Map([[2, { evidence: 3 }]])), 2, "more sessions over older");
  assert.equal(keep([c({ id: 5, at: 1 }), c({ id: 2, at: 9 })]), 5, "then the oldest by when it was said");
});

test("a merge keeps the user's word, moves the other's sessions onto it, tells no session of an erratum, and a distinct pair is not asked again", async () => {
  const model = scripted({ merge: (u) => ({ pairs: pairsOf(u).map((p) => ({ n: p.n, same: !/staging/.test(p.a + p.b) })) }) });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned, sit } = await project(w);
    const theirs = await learned("convention", "the release build runs through npm run build:release", { chain: "x1" });
    const mine = (await w.svc.brain.remember("release builds run through npm run build:release only", { kind: "convention", projectId, by: "person" })).itemId;
    const other = await learned("fact", "the release build uploads to the staging bucket first", { chain: "x2" });
    const other2 = await learned("fact", "the release build uploads to the staging bucket at first", { chain: "x3" });
    const r = await w.svc.curator.run(projectId);
    assert.equal(r.merged, 1);
    assert.equal(w.svc.archive.items.get(mine).status, "confirmed", "the user's word survives");
    const gone = w.svc.archive.items.get(theirs.id);
    assert.deepEqual([gone.status, gone.superseded_by, gone.invalid_reason], ["superseded", mine, `merged: says the same as i${mine}`]);
    assert.deepEqual(w.svc.archive.items.evidenceChains(projectId).get(mine), ["x1"], "its session counts for the survivor");
    assert.equal(w.svc.archive.items.get(other.id).status, "inferred", "judged distinct: both stand");
    const asked = model.of(MERGE_PROMPT).length;
    await w.svc.curator.run(projectId);
    assert.equal(model.of(MERGE_PROMPT).length, asked, "a pair judged distinct is not put to the model again");
    assert.equal(w.svc.archive.items.get(other2.id).status, "inferred");
    const chain = w.svc.archive.getChain(sit.chain ?? "")?.meta?.errata;
    assert.equal(chain, undefined, "no erratum: what it said still holds");
  });
});

test("a pair the model answers neither true nor false for is neither merged nor judged distinct: it is asked again", async () => {
  /** @type {((n: number) => { n: number, same: unknown }[])[]} */
  const answers = [(n) => [{ n, same: "yes" }], () => [], (n) => [{ n, same: 1 }]];
  let pass = 0;
  const model = scripted({ merge: (u) => ({ pairs: pairsOf(u).flatMap((p) => answers[pass](p.n)) }) });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    const a = await learned("fact", "the nightly job rebuilds the search index", { chain: "v1" });
    const b = await learned("fact", "the search index is rebuilt each night by a scheduled job", { chain: "v2" });
    for (; pass < answers.length; pass++) {
      await w.svc.curator.run(projectId);
      assert.equal(model.of(MERGE_PROMPT).length, pass + 1, `pass ${pass + 1}: the pair is put to the model again`);
      assert.deepEqual([a, b].map((x) => w.svc.archive.items.get(x.id).status), ["inferred", "inferred"]);
      assert.ok(!w.svc.archive.items.events(b.id).some((e) => e.action === "distinct"), "no answer is not a verdict");
    }
  });
});

test("a quote of the turn a served claim was filed from is not shown beside it", async () => {
  await world({}, async (w) => {
    await w.session("a").remember("the bundle is built with esbuild from src/main.ts");
    const { seen } = await w.session("b").send("how is the bundle built with esbuild from src/main.ts?");
    const lines = memoryLines(seen).filter((l) => /esbuild/.test(l));
    assert.deepEqual(lines.length, 1, lines.join("\n"));
    assert.match(lines[0], /^- \[i\d+ fact/);
  });
});

// ---- M4-3: keying ----
test("keying keeps a slot only when its value is in the claim's own words, and asks about each claim once", async () => {
  const model = scripted({
    key: (u) => ({
      slots: [...u.matchAll(/^(\d+)\. (.*)$/gm)].map((m) => (/listens/.test(m[2]) ? { n: Number(m[1]), subject: "api", attribute: "port", value: "8080" } : { n: Number(m[1]), subject: "project", attribute: "bundler", value: "esbuild" })),
    }),
  });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    const port = await learned("fact", "the api listens on port 3000");
    const bundler = await learned("fact", "the bundle is built with esbuild");
    const r = await w.svc.curator.run(projectId);
    assert.equal(r.keyed, 1);
    assert.equal(w.svc.archive.items.get(port.id).slot, null, "8080 is not in its words: never an invented value");
    assert.equal(w.svc.archive.items.events(port.id).at(-1).reason, "the value it named (8080) is not in its words");
    const b = w.svc.archive.items.get(bundler.id);
    assert.deepEqual([b.slot, b.slot_value, b.slot_multi], ["project · bundler", "esbuild", 0]);
    await w.svc.curator.run(projectId);
    assert.equal(model.of(KEY_PROMPT).length, 1, "keyed or not, a claim is asked about once");
  });
});

const portKeys = (/** @type {string} */ u) => ({ slots: [...u.matchAll(/^(\d+)\. .*port (\d{4}).*$/gm)].map((m) => ({ n: Number(m[1]), subject: "api", attribute: "port", value: m[2] })) });
/** The user's word on the api's port, said a minute ago. @param {any} w @param {string} projectId */
const usersPort = async (w, projectId) => {
  const id = (await w.svc.brain.remember("the api listens on port 3000", { projectId, by: "person" })).itemId;
  w.svc.archive.db.prepare("UPDATE items SET created_at = created_at - 60000 WHERE id = ?").run(id);
  return id;
};

test("keyed, a slot is settled by M2-5's rule: the user's word holds against a newer learned value, and they are asked if it replaces theirs (M6-D16)", async () => {
  await world({ models: { summarizer: "judge" }, callModel: scripted({ key: portKeys }) }, async (w) => {
    const { projectId, learned } = await project(w);
    const users = await usersPort(w, projectId);
    const newer = await learned("fact", "the api now listens on port 8080", { slot: { slot: "api · port", value: "8080", multi: false } });
    const r = await w.svc.curator.run(projectId);
    assert.deepEqual([r.keyed, r.questions, r.slotAsked], [1, 1, 1]);
    assert.equal(w.svc.archive.items.get(users).status, "confirmed");
    const l = w.svc.archive.items.get(newer.id);
    assert.equal(l.status, "dismissed", "a learned value never replaces the user's (M2-6)");
    assert.match(l.invalid_reason, new RegExp(`^the user's word holds its slot \\(api · port\\): i${users}, user said$`));
    // Asked; meanwhile the user's word stands, and its line says what the later session said.
    const [q, ...more] = w.svc.brain.questions(projectId);
    assert.equal(more.length, 0);
    assert.deepEqual([q.kind, q.proposal.action, q.proposal.id, q.proposal.replacement, q.reason], ["retire", "correct", users, newer.id, "a later session said otherwise: 8080"]);
    assert.deepEqual(w.svc.brain.claims(projectId).claims.find((/** @type {any} */ c) => c.id === `i${users}`).flags, ["said otherwise later: 8080"]);
    // The later value is held for their answer, not retired: its card says what it waits on (M6-7).
    const held = w.svc.brain.claims(projectId, { state: "retired" }).claims.find((/** @type {any} */ c) => c.id === `i${newer.id}`);
    assert.deepEqual([held.status, held.asked, held.flags], ["dismissed", q.id, [`would replace i${users} if you say so`]]);
    const { seen } = await w.session("asks").send("which port does the api listen on?");
    assert.ok(memoryLines(seen).some((l) => new RegExp(`^- \\[i${users} fact · user said · [^\\]]*said otherwise later: 8080\\] the api listens on port 3000$`).test(l)), seen);
    assert.ok(seen.includes(`A line marked "said otherwise later" is the user's word that a later session contradicted`), seen);
    // Accepted: the later words are the user's now — their claim corrected, with history.
    const a = await w.svc.brain.decide(q.id, "accept", { by: "person" });
    assert.deepEqual([a.ok, a.status], [true, "accepted"]);
    assert.equal(w.svc.archive.inbox.get(Number(q.id.slice(1))).status, "accepted", "the correction it carried out did not withdraw it");
    const was = w.svc.archive.items.get(users);
    assert.deepEqual([was.status, was.superseded_by], ["superseded", newer.id]);
    assert.equal(w.svc.archive.items.get(newer.id).status, "confirmed");
    assert.match(w.svc.archive.items.events(users).find((/** @type {any} */ e) => e.action === "status")?.reason, /^a later session said otherwise: 8080 \(accepted from memory's questions, q\d+\)$/);
    const now = w.svc.brain.claims(projectId).claims.find((/** @type {any} */ c) => c.id === `i${newer.id}`);
    assert.deepEqual([now.asked, now.flags], [undefined, []], "answered: it stands, waiting on nothing");
  });
});

test("a later value rejected leaves the user's word as it was; one learned at filing is asked about too, and one said before theirs is not (M6-D16)", async () => {
  await world({ models: { summarizer: "judge" }, callModel: scripted({ key: portKeys }) }, async (w) => {
    const { projectId, learned } = await project(w);
    const older = await learned("fact", "the api listens on port 5000", { slot: { slot: "api · port", value: "5000", multi: false }, ageDays: 1 });
    const users = await usersPort(w, projectId);
    const r = await w.svc.curator.run(projectId);
    assert.deepEqual([r.keyed, r.questions, w.svc.archive.items.get(older.id).status], [1, 0, "dismissed"], "said before the user's word: retired, never asked");
    // Now keyed, the user's word holds a later learned value off as it is filed, and asks.
    const later = await learned("fact", "the api now listens on port 8080", { slot: { slot: "api · port", value: "8080", multi: false } });
    assert.equal(later.status, "dismissed");
    const [q] = w.svc.brain.questions(projectId);
    assert.deepEqual([q.proposal.id, q.proposal.replacement, q.reason], [users, later.id, "a later session said otherwise: 8080"]);
    const no = await w.svc.brain.decide(q.id, "reject", { by: "person" });
    assert.deepEqual([no.ok, no.status], [true, "rejected"]);
    assert.deepEqual([w.svc.archive.items.get(users).status, w.svc.archive.items.get(later.id).status], ["confirmed", "dismissed"]);
    assert.deepEqual(w.svc.brain.claims(projectId).claims.find((/** @type {any} */ c) => c.id === `i${users}`).flags, [], "answered: no flag");
    const after = w.svc.brain.claims(projectId, { state: "retired" }).claims.find((/** @type {any} */ c) => c.id === `i${later.id}`);
    assert.deepEqual([after.asked, after.flags], [undefined, []], "rejected: retired now, waiting on nothing");
    const again = await learned("fact", "the api now listens on port 8080 again", { slot: { slot: "api · port", value: "8080", multi: false } });
    assert.equal(again.status, "dismissed");
    assert.deepEqual(w.svc.brain.questions(projectId), [], "the same value said again in other words is not asked again");
    const other = await learned("fact", "the api moved to port 9090", { slot: { slot: "api · port", value: "9090", multi: false } });
    assert.deepEqual(w.svc.brain.questions(projectId).map((/** @type {any} */ x) => x.proposal.replacement), [other.id], "another value is");
  });
});

test("keyed as one of several values, a claim retires no other value in its slot", async () => {
  const model = scripted({ key: (u) => ({ slots: [...u.matchAll(/^(\d+)\. .* uses (\w+) .*$/gm)].map((m) => ({ n: Number(m[1]), subject: "project", attribute: "language", value: m[2], multi: true })) }) });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    const py = await learned("fact", "the project is written in python", { slot: { slot: "project · language", value: "python", multi: false } });
    const rs = await learned("fact", "the parser uses rust for speed");
    const r = await w.svc.curator.run(projectId);
    assert.deepEqual([r.keyed, r.slotRetired, r.slotAsked, r.questions], [1, undefined, undefined, 0], JSON.stringify(r));
    const k = w.svc.archive.items.get(rs.id);
    assert.deepEqual([k.slot, k.slot_value, k.slot_multi], ["project · language", "rust", 1]);
    assert.deepEqual([py, rs].map((x) => w.svc.archive.items.get(x.id).status), ["inferred", "inferred"], "both values stand");
  });
});

// ---- M4-4: re-verify ----
test("a claim whose file changed is checked against it: holds loses the label, wrong is retired, unsure is asked once per file state", () =>
  inFolder(async (dir) => {
    mkdirSync(join(dir, "src"));
    const file = (/** @type {string} */ n, /** @type {string} */ body) => writeFileSync(join(dir, "src", n), body);
    file("server.js", "export function listen() { return app.listen(3000); }\n");
    file("config.js", "export function loadConfig() { return read('config.yaml'); }\n");
    file("queue.js", "export function drain() { return queue.flush(); }\n");
    const verdicts = { "server.js": "holds", "config.js": "wrong", "queue.js": "unsure" };
    const model = scripted({ verify: (u) => ({ verdict: Object.entries(verdicts).find(([f]) => u.includes(`File src/${f}`))?.[1], why: "the file says so" }) });
    await world({ cwd: dir, models: { summarizer: "judge" }, callModel: model }, async (w) => {
      const { projectId, learned } = await project(w);
      const s = await learned("fact", "src/server.js starts the http listener on port 3000");
      const c = await learned("fact", "src/config.js reads config.yaml at startup");
      const q = await learned("fact", "src/queue.js drains the job queue on shutdown");
      for (const x of [s, c, q]) assert.equal(w.svc.brain.filesOf(x)?.worst.state, "ok");
      file("server.js", "// listener\nexport function listen() { return app.listen(3000); }\n");
      file("config.js", "export function loadConfig() { return readJson('config.json'); }\n");
      file("queue.js", "export function drain() { return queue.flush(true); }\n");
      const r = await w.svc.curator.run(projectId);
      assert.deepEqual([r.verified, r.wrong, r.unsure], [1, 1, 1]);
      assert.equal(w.svc.brain.filesOf(w.svc.archive.items.get(s.id))?.worst.state, "ok", "anchored afresh: no label");
      assert.equal(w.svc.archive.items.events(s.id).find((/** @type {any} */ e) => e.action === "verified")?.by, "curator");
      const cc = w.svc.archive.items.get(c.id);
      assert.deepEqual([cc.status, cc.invalid_reason], ["dismissed", "checked against src/config.js: the file says so"]);
      assert.equal(w.svc.archive.items.get(q.id).status, "inferred", "unsure: left labelled");
      assert.equal(w.svc.brain.filesOf(w.svc.archive.items.get(q.id))?.worst.state, "changed");
      const asked = model.of(VERIFY_PROMPT).length;
      await w.svc.curator.run(projectId);
      assert.equal(model.of(VERIFY_PROMPT).length, asked, "the same file state is not asked about again");
      file("queue.js", "export function drain() { return queue.flush(true, 'all'); }\n");
      await w.svc.curator.run(projectId);
      assert.equal(model.of(VERIFY_PROMPT).length, asked + 1, "a file that moved again is");
      assert.match(model.of(VERIFY_PROMPT).at(-1)?.user ?? "", /^Note \(i\d+, inferred, recorded \d{4}-\d{2}-\d{2}\): src\/queue\.js drains the job queue on shutdown\n\nFile src\/queue\.js \(changed since the note was recorded\):\nexport function drain/);
      const u = await w.svc.brain.undoRun(Number(r.run.slice(1)), { by: "owner" });
      assert.deepEqual(u.skipped, []);
      assert.equal(w.svc.archive.items.get(c.id).status, "inferred", "undo brings the retired one back");
      assert.equal(w.svc.brain.filesOf(w.svc.archive.items.get(s.id))?.worst.state, "changed", "and the verified one's old anchors");
    });
  }));

test("a user's claim the file says is wrong is asked about, never retired", () =>
  inFolder(async (dir) => {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "config.js"), "export function loadConfig() { return read('config.yaml'); }\n");
    const model = scripted({ verify: () => ({ verdict: "wrong", why: "it reads config.json now" }) });
    await world({ cwd: dir, models: { summarizer: "judge" }, callModel: model }, async (w) => {
      const { projectId } = await project(w);
      const id = (await w.svc.brain.remember("src/config.js reads config.yaml at startup", { projectId, by: "person" })).itemId;
      writeFileSync(join(dir, "src", "config.js"), "export function loadConfig() { return readJson('config.json'); }\n");
      const r = await w.svc.curator.run(projectId);
      assert.deepEqual([r.wrong, r.reverifyAsked, r.questions], [undefined, 1, 1]);
      assert.equal(w.svc.archive.items.get(id).status, "confirmed");
      const [q] = w.svc.brain.questions(projectId);
      assert.equal(q.reason, "checked against src/config.js: it reads config.json now");
      await w.svc.curator.run(projectId);
      assert.equal(model.of(VERIFY_PROMPT).length, 1, "asked once for this file state");
    });
  }));

test("a file's excerpt is taken around what the claim names, within its room", () =>
  inFolder(async (dir) => {
    const body = `${"// filler line\n".repeat(800)}export function loadConfig() { return read('config.yaml'); }\n${"// more filler\n".repeat(800)}`;
    writeFileSync(join(dir, "big.js"), body);
    const ex = excerptOf(join(dir, "big.js"), "loadConfig reads config.yaml", 2000);
    assert.ok(ex.length <= 2000 + 8, String(ex.length));
    assert.match(ex, /export function loadConfig\(\)/);
    assert.match(ex, /^…\n/);
    writeFileSync(join(dir, "small.js"), "const a = 1;\n");
    assert.equal(excerptOf(join(dir, "small.js"), "anything", 2000), "const a = 1;\n");
    assert.match(excerptOf(join(dir, "big.js"), "nothing named here", 100), /^\/\/ filler line\n/);
  }));

// ---- M4-5: threads ----
test("an open thread ages from when a session last said it: taken up again it stays, left a month it expires", async () => {
  const NOW = Date.UTC(2026, 9, 3);
  const t = { kind: "thread", origin: "learner", status: "inferred", created_at: NOW - 40 * DAY };
  assert.ok(confidenceOf(t, {}, NOW) < 0.35, "forty days untouched: under the gate");
  assert.ok(confidenceOf(t, { evidence: 1, lastSaid: NOW - 2 * DAY }, NOW) >= 0.35, "said again two days ago: fresh");
  await world({}, async (w) => {
    const { projectId, learned } = await project(w);
    const left = await learned("thread", "the flaky upload test still needs a fix", { ageDays: 40 });
    const again = await learned("thread", "the docs site still needs a search box", { ageDays: 40 });
    await w.svc.brain.fileLearned({ projectId, chainId: "later", kind: "thread", text: "the docs site still needs a search box", importance: 0.7 });
    const users = (await w.svc.brain.remember("the migration guide still needs a section on plugins", { kind: "thread", projectId, by: "person" })).itemId;
    w.svc.archive.db.prepare("UPDATE items SET created_at = ? WHERE id = ?").run(Date.now() - 80 * DAY, users);
    const r = await w.svc.curator.run(projectId);
    assert.deepEqual([r.expired, r.expireAsked], [1, 1]);
    assert.equal(w.svc.archive.items.get(left.id).status, "dismissed");
    assert.equal(w.svc.archive.items.get(again.id).status, "inferred", "taken up again in another session");
    assert.equal(w.svc.archive.items.get(users).status, "confirmed", "the user's own thread is asked about");
  });
});

// ---- M4-7: the dossier ----
/** A dossier model: every fact it is given becomes a line in its own words, plus lines memory must not keep. */
const dossierWriter = scripted({
  dossier: (u) => {
    const claims = [...u.matchAll(/^(i\d+) \[(\w+)[^\]]*\] (.*)$/gm)];
    const first = claims[0]?.[1];
    return {
      sections: [
        { title: "Facts", lines: claims.filter((m) => m[2] === "fact").map((m) => ({ text: m[3], cites: [m[1]] })) },
        { title: "Key decisions", lines: [{ text: "The team decided to rewrite everything in Rust next quarter.", cites: [first] }] },
        { title: "Gossip", lines: [{ text: "Somebody likes tabs.", cites: [first] }] },
        { title: "Facts", lines: [{ text: "The queue drains on shutdown.", cites: ["i99999"] }, { text: "A line that cites nothing.", cites: [] }] },
      ],
    };
  },
});

test("the curator's dossier keeps only grounded lines that cite what it was given, and is written again only when that moved", async () => {
  dossierWriter.calls.length = 0;
  await world({ models: { summarizer: "judge" }, callModel: dossierWriter }, async (w) => {
    const { projectId, learned } = await project(w);
    const a = await learned("fact", "the cli entry point is bin/run.mjs");
    const b = await learned("fact", "integration tests need a running postgres");
    const r = await w.svc.curator.run(projectId);
    assert.deepEqual([r.dossier, r.dossierDropped], ["v1", 4], JSON.stringify(r));
    const d = w.svc.archive.dossiers.latest(projectId);
    assert.deepEqual(d.sections, [{ title: "Facts", lines: [{ text: a.text, cites: [`i${a.id}`] }, { text: b.text, cites: [`i${b.id}`] }] }]);
    assert.deepEqual(d.cites.sort(), [a.id, b.id].sort());
    assert.equal(d.run_id, Number(r.run.slice(1)));
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v1 unchanged");
    assert.equal(dossierWriter.of(DOSSIER_PROMPT).length, 1, "nothing moved: no call");
    const c = await learned("fact", "the docs site deploys from the gh-pages branch");
    const r3 = await w.svc.curator.run(projectId);
    assert.equal(r3.dossier, "v2");
    assert.match(dossierWriter.of(DOSSIER_PROMPT).at(-1)?.user ?? "", new RegExp(`^i${c.id} \\[fact · inferred\\] the docs site deploys`, "m"));
    await w.svc.brain.undoRun(Number(r3.run.slice(1)), { by: "owner" });
    assert.equal(w.svc.archive.dossiers.latest(projectId).version, 1, "undo takes its version back");
    assert.equal(w.svc.brain.dossierOf(projectId)?.version, 1);
    const none = await w.svc.curator.run(null);
    assert.equal(none.dossier, undefined, "the global claims have no dossier");
    await w.svc.brain.fileLearned({ projectId: "none", chainId: "n1", kind: "fact", text: "the weather service answers in celsius", importance: 0.7 });
    const calls = dossierWriter.of(DOSSIER_PROMPT).length;
    assert.equal((await w.svc.curator.run("none")).dossier, undefined, "the sessions that named no folder are no project");
    assert.equal(dossierWriter.of(DOSSIER_PROMPT).length, calls);
  });
});

// (fails before: yes — the basis hashed the claims in their ranked order, so one that rose above another wrote a version)
test("a dossier is written again for a new set of claims, never for the same ones ranked anew", async () => {
  const writer = scripted({ dossier: (u) => ({ sections: [{ title: "Facts", lines: [...u.matchAll(/^(i\d+) \[fact[^\]]*\] (.*)$/gm)].map((m) => ({ text: m[2], cites: [m[1]] })) }] }) });
  await world({ models: { summarizer: "judge" }, callModel: writer }, async (w) => {
    const { projectId, learned } = await project(w);
    const a = await learned("fact", "the cli entry point is bin/run.mjs");
    const b = await learned("fact", "integration tests need a running postgres");
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v1");
    const ranked = () => [...(writer.of(DOSSIER_PROMPT).at(-1)?.user ?? "").matchAll(/^i(\d+) /gm)].map((m) => Number(m[1]));
    assert.deepEqual(ranked(), [a.id, b.id]);
    // b weighs more now: the same two claims, the other way round.
    w.svc.archive.db.prepare("UPDATE items SET importance = 0.95 WHERE id = ?").run(b.id);
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v1 unchanged");
    assert.equal(writer.of(DOSSIER_PROMPT).length, 1, "no call");
    await learned("fact", "the docs site deploys from the gh-pages branch");
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v2", "a claim more is a new set");
    assert.equal(ranked()[0], b.id, "given in the new order");
    // (fails before: yes — a session's learnedAt was in the basis, so every learning run wrote the same dossier again)
    // A session as the dossier reads it: a learning run that leaves its summary as it was writes nothing.
    const chain = w.svc.archive.chainsForProject(projectId, { limit: 1 })[0];
    const state = (/** @type {number} */ at, /** @type {string} */ summary) => w.svc.archive.db.prepare("UPDATE chains SET state_json = ? WHERE id = ?").run(JSON.stringify({ summary, learnedAt: at }), chain.id);
    state(1, "Set up the cli and its integration tests.");
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v3", "a session's summary is new");
    state(2, "Set up the cli and its integration tests.");
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v3 unchanged");
    state(3, "Set up the cli, its integration tests and the docs deploy.");
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v4");
  });
});

// ---- f3: use in the dossier ----
let shows = 0;
/**
 * Showings of claims, each judged as its reply was: `sessions` sessions' briefings (or turns' related memory, `kind`),
 * the claims in `used` used by each. @param {any} w @param {number[]} ids @param {number} sessions
 * @param {{ kind?: string, used?: number[], chain?: string, judged?: boolean }} [o]  `chain`: one session's showings; `judged`: false, never judged
 */
function showed(w, ids, sessions, { kind = "briefing", used = [], chain = "", judged = true } = {}) {
  for (let k = 0; k < sessions; k++) {
    const req = `show-${++shows}`;
    w.svc.archive.injections.add({ requestId: req, chainId: chain || `c-${req}`, kind, ids: ids.map((id) => `i${id}`) });
    if (judged) w.svc.archive.injections.markUsed(req, used.length ? 1 : 0, used.map((id) => `i${id}`));
  }
}
/** The archive's clock set by the test, a second on each `tick`. @param {any} w */
const clocked = (w) => {
  let t = Date.now();
  w.svc.archive.now = () => t;
  return { tick: () => (t += 1000) };
};
/** A dossier model that writes a line for each claim it is given; the order it was given them in, read back. */
const lineEach = () => {
  const writer = scripted({ dossier: (u) => ({ sections: [{ title: "Facts", lines: [...u.matchAll(/^(i\d+) \[\w+[^\]]*\] (.*)$/gm)].map((m) => ({ text: m[2], cites: [m[1]] })) }] }) });
  return Object.assign(writer, { given: () => [...(writer.of(DOSSIER_PROMPT).at(-1)?.user ?? "").matchAll(/^i(\d+) /gm)].map((m) => Number(m[1])) });
};
const byId = (/** @type {number} */ a, /** @type {number} */ b) => a - b;

// (fails before: yes — nothing ranked the dossier's claims by use, and a claim no session used stayed in it for good)
test("a claim the briefings of five sessions showed and none used leaves the dossier, and comes back once a turn uses it; a pitfall, a convention, an open thread and the user's word keep their place", async () => {
  const writer = lineEach();
  await world({ models: { summarizer: "judge" }, callModel: writer }, async (w) => {
    const { sit, projectId, learned } = await project(w);
    const quiet = await learned("fact", "the nightly export writes csv files to the shared drive");
    const unshown = await learned("fact", "the cli entry point is bin/run.mjs");
    const how = await learned("convention", "commit messages start with the package name");
    const open = await learned("thread", "the flaky upload test still needs a fix");
    const theirs = (await w.svc.brain.remember("the staging host is called kestrel", { kind: "fact", projectId, by: "person" })).itemId;
    const bare = `node -e "process.exit(process.env.READY ? 0 : 3)"`;
    const seen = { projectId, text: `\`${bare}\` failed here (exit 3); \`env READY=1 ${bare}\` worked.`, trigger: { tool: "bash", shape: "node", unless: "env READY=1" } };
    const pit = await w.svc.brain.fileSeen({ ...seen, chainId: "m1" });
    await w.svc.brain.fileSeen({ ...seen, chainId: "m2" });
    await w.settle();
    const all = [quiet.id, how.id, open.id, theirs, pit.id];
    showed(w, all, DOSSIER_UNUSED_SESSIONS - 1);
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v1");
    assert.deepEqual(writer.given().sort(byId), [...all, unshown.id].sort(byId), "four sessions: every claim stays");
    showed(w, all, 1);
    const reply = (await memoryCommand(w.svc, "@mem curate", sit))?.text || "";
    assert.match(reply, /^- wrote the project's dossier \(v2\), leaving out 1 memory sessions' briefings showed and none used \(search still finds them\)$/m, reply);
    assert.deepEqual(writer.given().sort(byId), [unshown.id, how.id, open.id, theirs, pit.id].sort(byId));
    assert.equal(w.svc.archive.items.get(quiet.id).status, "inferred", "it stands: search still finds it");
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v2 unchanged", "left out, it stays out");
    // A turn's related memory showed it where a message named it, and the reply used it: back in, its count started again.
    showed(w, [quiet.id], 1, { kind: "turn", used: [quiet.id] });
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v3");
    assert.ok(writer.given().includes(quiet.id));
    showed(w, [quiet.id], DOSSIER_UNUSED_SESSIONS - 1);
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v3 unchanged", "four sessions since its use");
  });
});

// (fails before: yes — the dossier's claims ranked by how sure and how important alone; and, the review's, a briefing's
// verdicts weighed a claim down for being in the dossier)
test("of claims as sure and as important, the more used in turns is given to the dossier first, in thirds; briefings weigh nothing; a use alone writes no version", async () => {
  const writer = lineEach();
  await world({ models: { summarizer: "judge" }, callModel: writer }, async (w) => {
    const { projectId, learned } = await project(w);
    const a = await learned("fact", "the cli entry point is bin/run.mjs");
    const b = await learned("fact", "integration tests need a running postgres");
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v1");
    assert.deepEqual(writer.given(), [a.id, b.id]);
    // b was used in two of its three judged turn showings (1.3), a in one of three (1.15); b's three briefings, none
    // used, weigh nothing.
    showed(w, [b.id], 2, { kind: "turn", used: [b.id] });
    showed(w, [a.id, b.id], 1, { kind: "turn", used: [a.id] });
    showed(w, [a.id], 2, { kind: "turn" });
    showed(w, [b.id], 3);
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v1 unchanged", "the same claims ranked anew");
    assert.equal(writer.of(DOSSIER_PROMPT).length, 1, "no call");
    const c = await learned("fact", "the docs site deploys from the gh-pages branch");
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v2");
    assert.deepEqual(writer.given(), [b.id, a.id, c.id], "two thirds, a third, too few judged to tell");
  });
});

// (fails before: yes — the review's: the last use was the newest showing a use credited, so a session's use of its
// briefing's claim after five sessions began meanwhile counted for nothing, and the claim left the dossier as it was used)
test("a use is placed by when it was judged: a session that uses its briefing's claim after five sessions began meanwhile starts the count again", async () => {
  const writer = lineEach();
  await world({ models: { summarizer: "judge" }, callModel: writer }, async (w) => {
    const { projectId, learned } = await project(w);
    const clock = clocked(w);
    const x = await learned("fact", "the nightly export writes csv files to the shared drive");
    const y = await learned("fact", "integration tests need a running postgres");
    showed(w, [x.id], 1, { chain: "c-early" });
    clock.tick();
    showed(w, [x.id], DOSSIER_UNUSED_SESSIONS);
    clock.tick();
    // The early session's agent looks it up again and uses it: its briefing's showing is credited, now.
    assert.deepEqual(w.svc.archive.injections.creditShownIn("c-early", [`i${x.id}`]), [`i${x.id}`]);
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v1");
    assert.deepEqual(writer.given().sort(byId), [x.id, y.id].sort(byId), "used after those five briefings: it stays");
    clock.tick();
    showed(w, [x.id], DOSSIER_UNUSED_SESSIONS);
    // Five sessions since that use: a written line resting on it alone is left out at once, and counted.
    const d = w.svc.brain.dossierOf(projectId);
    assert.equal(d?.version, 1);
    assert.ok(!d?.text.includes(x.text) && d?.text.includes(y.text), d?.text);
    assert.match(d?.text ?? "", /…and 1 more line; filament_memory_search finds them\.$/);
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v2");
    assert.deepEqual(writer.given(), [y.id]);
  });
});

// (fails before: yes — the review's: a briefing was judged on its session's first reply alone, and a claim it showed is
// not shown again that session, so one the session went on to use counted as never used)
test("what a session's briefing showed is judged on every reply of the session, not the first alone", async () => {
  await world({}, async (w) => {
    const { projectId } = await project(w);
    const said = { projectId, kind: "fact", text: "the nightly export writes csv files to the shared drive", importance: 0.7 };
    const x = Number((await w.svc.brain.fileLearned({ ...said, chainId: "e1" })).id);
    await w.svc.brain.fileLearned({ ...said, chainId: "e2" });
    await w.settle();
    const s = w.session("later");
    const first = await s.send("let's look at the upload test", { reply: "Sure, opening it." });
    const usedInBriefing = () => w.svc.archive.db.prepare("SELECT j.used AS used FROM injection_ids j JOIN injections i ON i.id = j.injection_id WHERE i.kind = 'briefing' AND i.chain_id = ? AND j.memory_id = ?").get(first.prep.chain, `i${x}`)?.used;
    assert.equal(usedInBriefing(), 0, "its first reply did not use it");
    await s.send("ok, and where do the exports land?", { reply: "The nightly export writes csv files to the shared drive, under exports/." });
    assert.equal(usedInBriefing(), 1, "a later reply did: its briefing's showing is credited");
  });
});

// (fails before: yes — the review's second look: once a session's later reply credited its briefing's claim, its later
// uses were judged no more, so a use that came after five sessions began counted for nothing; and a fork, whose briefing
// was its parent's, had no showing to credit, so its uses set nothing)
test("every later use of a briefing's claim counts as late as it came", async () => {
  await world({}, async (w) => {
    const { projectId } = await project(w);
    const clock = clocked(w);
    const said = { projectId, kind: "fact", text: "the nightly export writes csv files to the shared drive", importance: 0.7 };
    const x = Number((await w.svc.brain.fileLearned({ ...said, chainId: "e1" })).id);
    await w.svc.brain.fileLearned({ ...said, chainId: "e2" });
    await w.settle();
    const inDossier = () => (w.svc.brain.dossierOf(projectId)?.cites ?? []).includes(`i${x}`);
    const echo = "The nightly export writes csv files to the shared drive, under exports/.";
    const s = w.session("long");
    await s.send("let's look at the upload test", { reply: "Sure, opening it." });
    clock.tick();
    await s.send("where do the exports land?", { reply: echo });
    clock.tick();
    showed(w, [x], DOSSIER_UNUSED_SESSIONS);
    assert.equal(inDossier(), false, "five sessions since its use");
    clock.tick();
    await s.send("and the export once more?", { reply: echo });
    assert.equal(inDossier(), true, "used again, later than those five");
  });
});

test("a session whose briefing has no showing of its own, as a fork's is its parent's, sets its last use all the same", async () => {
  await world({}, async (w) => {
    const { projectId } = await project(w);
    const clock = clocked(w);
    const said = { projectId, kind: "fact", text: "the nightly export writes csv files to the shared drive", importance: 0.7 };
    const x = Number((await w.svc.brain.fileLearned({ ...said, chainId: "e1" })).id);
    await w.svc.brain.fileLearned({ ...said, chainId: "e2" });
    await w.settle();
    const inDossier = () => (w.svc.brain.dossierOf(projectId)?.cites ?? []).includes(`i${x}`);
    const echo = "The nightly export writes csv files to the shared drive, under exports/.";
    const f = w.session("forked");
    const first = await f.send("let's look at the upload test", { reply: "Sure." });
    w.svc.archive.db.prepare("DELETE FROM injection_ids WHERE injection_id IN (SELECT id FROM injections WHERE kind = 'briefing' AND chain_id = ?)").run(first.prep.chain);
    clock.tick();
    showed(w, [x], DOSSIER_UNUSED_SESSIONS);
    assert.equal(inDossier(), false);
    clock.tick();
    await f.send("where do the exports land?", { reply: echo });
    assert.equal(inDossier(), true, "no showing to credit, its last use set");
  });
});

// (fails before: no — coverage: what does not count toward leaving)
test("a briefing nobody judged, and a session's several briefings, count toward leaving the dossier as nothing and as one", async () => {
  const writer = lineEach();
  await world({ models: { summarizer: "judge" }, callModel: writer }, async (w) => {
    const { projectId, learned } = await project(w);
    const x = await learned("fact", "the nightly export writes csv files to the shared drive");
    showed(w, [x.id], DOSSIER_UNUSED_SESSIONS, { judged: false });
    showed(w, [x.id], DOSSIER_UNUSED_SESSIONS, { chain: "c-one" });
    showed(w, [x.id], DOSSIER_UNUSED_SESSIONS - 2);
    assert.equal((await w.svc.curator.run(projectId)).dossier, "v1");
    assert.ok(writer.given().includes(x.id), "four sessions judged");
  });
});

// (fails before: yes — the same, for a dossier rendered from claims)
test("rendered from claims, a claim five sessions' briefings showed and none used is left out and counted, and the more used comes first", async () => {
  await world({}, async (w) => {
    const { projectId } = await project(w);
    let n = 0;
    /** A fact two sessions said: it earned a place. @param {string} text */
    const earned = async (text) => {
      const r = await w.svc.brain.fileLearned({ projectId, chainId: `e${++n}`, kind: "fact", text, importance: 0.7 });
      await w.svc.brain.fileLearned({ projectId, chainId: `e${++n}`, kind: "fact", text, importance: 0.7 });
      await w.settle();
      return Number(r.id);
    };
    const used = await earned("the nightly export writes csv files to the shared drive");
    const quiet = await earned("integration tests need a running postgres");
    const newest = await earned("the docs site deploys from the gh-pages branch");
    const open = Number((await w.svc.brain.fileLearned({ projectId, chainId: "t1", kind: "thread", text: "the flaky upload test still needs a fix", importance: 0.7 })).id);
    const how = await earned("commit messages start with the package name");
    w.svc.archive.db.prepare("UPDATE items SET kind = 'convention' WHERE id = ?").run(how);
    await w.settle();
    showed(w, [open, how], DOSSIER_UNUSED_SESSIONS);
    const cites = () => w.svc.brain.dossierOf(projectId)?.cites ?? [];
    assert.ok(cites().includes(`i${open}`) && cites().includes(`i${how}`), "an open thread and a convention keep their place");
    const facts = () => (w.svc.brain.dossierOf(projectId)?.cites ?? []).filter((/** @type {string} */ c) => [used, quiet, newest].map((i) => `i${i}`).includes(c));
    assert.deepEqual(facts(), [`i${newest}`, `i${quiet}`, `i${used}`], "as sure and as important: the newest first");
    showed(w, [used], 2, { kind: "turn", used: [used] });
    showed(w, [used], 1, { kind: "turn" });
    showed(w, [quiet], DOSSIER_UNUSED_SESSIONS);
    assert.deepEqual(facts(), [`i${used}`, `i${newest}`]);
    const d = w.svc.brain.dossierOf(projectId);
    assert.match(d?.text ?? "", /…and 1 more line; filament_memory_search finds them\.$/, d?.text);
  });
});

// (fails before: yes — a step the budget stopped mid-loop threw out of itself, and what it had counted was lost)
test("a step the budget stops ends where it stands and keeps its counts; the dossier still has its call", () =>
  inFolder(async (dir) => {
    mkdirSync(join(dir, "src"));
    const file = (/** @type {string} */ n, /** @type {string} */ body) => writeFileSync(join(dir, "src", `${n}.js`), body);
    for (const n of ["alpha", "bravo"]) file(n, `export function ${n}() { return 1; }\n`);
    const model = scripted({ verify: () => ({ verdict: "unsure", why: "the excerpt does not settle it" }), dossier: (u) => ({ sections: [{ title: "Facts", lines: [...u.matchAll(/^(i\d+) \[fact[^\]]*\] (.*)$/gm)].map((m) => ({ text: m[2], cites: [m[1]] })) }] }) });
    await world({ cwd: dir, models: { summarizer: "judge" }, curator: { maxCalls: 3 }, callModel: model }, async (w) => {
      const { projectId, learned } = await project(w);
      await learned("fact", "src/alpha.js parses the command line flags");
      await learned("fact", "src/bravo.js renders the settings page");
      for (const n of ["alpha", "bravo"]) file(n, `export function ${n}() { return 2; }\n`);
      const r = await w.svc.curator.run(projectId);
      assert.deepEqual([r.calls, r.unsure, r.reverifyLeft, r.dossier], [3, 1, 1, "v1"], JSON.stringify(r));
      assert.match(r.stopped, /budget of 3 model calls a pass \(memory\.curator\.maxCalls\), the dossier's call kept for it/);
      assert.deepEqual(model.calls.map((c) => c.system), [KEY_PROMPT, VERIFY_PROMPT, DOSSIER_PROMPT]);
    });
  }));

// (fails before: yes — re-verify took the claims in the order they were filed, so those every session reads waited
// behind the backlog)
test("re-verify takes first what was not checked this week, then the claims the dossier cites, then the most shown: what a pass has no calls for waits", () =>
  inFolder(async (dir) => {
    mkdirSync(join(dir, "src"));
    const names = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
    const file = (/** @type {string} */ n, /** @type {string} */ body) => writeFileSync(join(dir, "src", `${n}.js`), body);
    for (const n of names) file(n, `export function ${n}() { return 1; }\n`);
    const model = scripted({ verify: () => ({ verdict: "unsure", why: "the excerpt does not settle it" }) });
    await world({ cwd: dir, models: { summarizer: "judge" }, callModel: model }, async (w) => {
      const { projectId, learned } = await project(w);
      const claims = [];
      const says = ["parses the command line flags", "renders the settings page", "opens the sqlite database", "retries failed uploads three times", "formats dates for the logs", "signs the release artifacts"];
      for (const [k, n] of names.entries()) claims.push(await learned("fact", `src/${n}.js ${says[k]}`));
      assert.equal(new Set(claims.map((c) => c.id)).size, 6, "six claims");
      for (const n of names) file(n, `export function ${n}() { return 2; }\n`);
      const [, , , delta, echo, foxtrot] = claims;
      w.svc.archive.dossiers.add({ projectId, sections: [], cites: [foxtrot.id], basis: "seeded" });
      const show = (/** @type {any} */ it, /** @type {number} */ times) => {
        for (let k = 0; k < times; k++) w.svc.archive.injections.add({ requestId: `show-${it.id}-${k}`, chainId: `c-show-${k}`, kind: "turn", ids: [`i${it.id}`] });
      };
      show(echo, 3);
      show(delta, 1);
      const r = await w.svc.curator.run(projectId);
      assert.deepEqual([r.unsure, r.reverifyLeft], [4, 2]);
      const checked = (/** @type {any} */ it) => w.svc.archive.items.events(it.id).some((/** @type {any} */ e) => e.action === "checked");
      assert.deepEqual(claims.map(checked), [true, false, false, true, true, true], "foxtrot (cited), echo (3 showings), delta (1), then alpha by its id");
      const asked = () => model.of(VERIFY_PROMPT).map((c) => /^Note \(i(\d+),/.exec(c.user)?.[1]).map(Number);
      assert.deepEqual(asked(), [foxtrot.id, echo.id, delta.id, claims[0].id]);
      // (fails before: yes — the same four took every call again whenever their files moved, and the two behind them never
      // came)
      // Every file moves again: the two not checked come first, then those checked this week, the dossier's first.
      for (const n of names) file(n, `export function ${n}() { return 3; }\n`);
      const r2 = await w.svc.curator.run(projectId);
      assert.deepEqual([r2.unsure, r2.reverifyLeft], [4, 2]);
      assert.deepEqual(asked().slice(4), [claims[1].id, claims[2].id, foxtrot.id, echo.id]);
    });
  }));

test("the curator writes the dossier from the project's claims, the user's own rules aside: the briefing shows them first", async () => {
  const model = scripted({});
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    const fact = await learned("fact", "the cli entry point is bin/run.mjs");
    await w.svc.brain.remember("never commit generated files", { kind: "rule", projectId, by: "person" });
    const decided = (await w.svc.brain.remember("we chose sqlite over postgres for the archive", { kind: "decision", projectId, by: "person" })).itemId;
    await w.svc.curator.run(projectId);
    const user = model.of(DOSSIER_PROMPT)[0]?.user ?? "";
    assert.match(user, new RegExp(`^i${fact.id} \\[fact · inferred\\] the cli entry point`, "m"), user);
    assert.match(user, new RegExp(`^i${decided} \\[decision · user said\\] we chose sqlite`, "m"), "the user's decisions are the project's to tell");
    assert.doesNotMatch(user, /never commit generated files/);
  });
});

// (fails before: yes — the live leg's dossier read a session's frozen "open:" line, wrote "Open thread: …" citing the session, and GLM then took the session's id for the thread's)
test("M7-D66: the dossier reads open work from the open threads, by their ids, never from a session's frozen open and next lines", async () => {
  const model = scripted({});
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { prep, sit } = await w.session("guide").send("write the migration guide");
    const projectId = sit.project.id;
    w.svc.archive.setState(prep.chain, { status: "open", summary: "wrote the migration guide's intro", done: ["the intro"], open: ["the plugins section of the guide is unwritten"], next: ["ask which plugins to cover"], learnedAt: 1 });
    const thread = (await w.svc.brain.fileLearned({ projectId, chainId: prep.chain, kind: "thread", text: "docs/migration.md still needs a plugins section", importance: 0.6 })).id;
    await w.svc.curator.run(projectId);
    const user = model.of(DOSSIER_PROMPT)[0]?.user ?? "";
    assert.match(user, new RegExp(`^s:${prep.chain} .*wrote the migration guide's intro`, "m"), user);
    assert.doesNotMatch(user, /plugins section of the guide is unwritten|ask which plugins to cover|open: |next: /, "a session's end state says what was open when it was learned, not now");
    assert.match(user, new RegExp(`^i${thread} \\[thread · inferred\\] docs/migration\\.md still needs a plugins section`, "m"));
    assert.match(DOSSIER_PROMPT, /"Current work and open threads" \(the open threads \(\[thread\]\), each cited by its id, and what the sessions' summaries say is under way\)/);
  });
});

test("a session that names no folder is no project: its briefing has no dossier, whatever such sessions earned", async () => {
  await world({}, async (w) => {
    await w.svc.brain.fileLearned({ projectId: "none", chainId: "n1", kind: "thread", text: "the flaky upload test still needs a fix", importance: 0.7 });
    await w.svc.brain.fileLearned({ projectId: "none", chainId: "n2", kind: "decision", text: "we chose sqlite over postgres for the archive", importance: 0.7 });
    await w.svc.brain.fileLearned({ projectId: "none", chainId: "n3", kind: "decision", text: "we chose sqlite over postgres for the archive", importance: 0.7 });
    const { seen, sit } = await w.session("loose", { cwd: null }).send("hello");
    assert.equal(sit.project.id, "none");
    assert.doesNotMatch(seen, /The project's dossier/);
  });
});

test("a dossier line whose claim's file is gone is hidden while it is gone, back when the file is, and marked when it changed since", () =>
  inFolder(async (dir) => {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "legacy.js"), "export function importOld() {}\n");
    dossierWriter.calls.length = 0;
    await world({ cwd: dir, models: { summarizer: "judge" }, callModel: dossierWriter }, async (w) => {
      const { projectId, learned } = await project(w);
      const it = await learned("fact", "the old importer lives in src/legacy.js");
      await learned("fact", "release notes are written in CHANGELOG.md by hand");
      await w.svc.curator.run(projectId);
      assert.deepEqual([w.svc.brain.dossierOf(projectId)?.lines, w.svc.brain.dossierOf(projectId)?.hidden], [2, 0]);
      w.svc.brain.filesOf(w.svc.archive.items.get(it.id));
      rmSync(join(dir, "src", "legacy.js"));
      const gone = w.svc.brain.dossierOf(projectId);
      assert.deepEqual([gone?.lines, gone?.hidden], [1, 1]);
      assert.doesNotMatch(gone?.text ?? "", /legacy/);
      writeFileSync(join(dir, "src", "legacy.js"), "export function importOld() {}\n");
      assert.match(w.svc.brain.dossierOf(projectId)?.text ?? "", /the old importer lives in src\/legacy\.js \[i\d+\]/);
      writeFileSync(join(dir, "src", "legacy.js"), "export function importOld() {}\nexport function importNew() {}\n");
      assert.match(w.svc.brain.dossierOf(projectId)?.text ?? "", /the old importer lives in src\/legacy\.js \[i\d+ · file changed since\]/, "said on its line, as recall says it");
    });
  }));

test("rendered from claims, the dossier shows what earned a place, by kind, and never a code fragment or the user's own rules", async () => {
  await world({}, async (w) => {
    const { projectId, learned } = await project(w);
    const once = await learned("fact", "the staging host is called kestrel");
    const twice = await learned("convention", "commit messages start with the package name", { chain: "k1" });
    await w.svc.brain.fileLearned({ projectId, chainId: "k2", kind: "convention", text: "commit messages start with the package name", importance: 0.7 });
    const decided = (await w.svc.brain.remember("we chose sqlite over postgres for the archive", { kind: "decision", projectId, by: "person" })).itemId;
    const rule = (await w.svc.brain.remember("never commit generated files", { kind: "rule", projectId, by: "person" })).itemId;
    const thread = await learned("thread", "the flaky upload test still needs a fix");
    const junk = w.svc.archive.items.add({ projectId, chainId: "j", kind: "fact", text: "a2.fw.res; }", status: "confirmed", importance: 0.9 });
    const d = w.svc.brain.dossierOf(projectId);
    assert.equal(d?.version, null);
    assert.deepEqual(d?.text.split("\n").map((l) => l.replace(/ · \d{4}-\d{2}-\d{2}/, "")), [
      "The project's dossier (its standing memories, by kind):",
      "Conventions and rules:",
      `- [i${twice.id} convention · inferred · ✓2] commit messages start with the package name`,
      "Key decisions:",
      `- [i${decided} decision · user said] we chose sqlite over postgres for the archive`,
      "Current work and open threads:",
      `- [i${thread.id} thread · inferred] the flaky upload test still needs a fix`,
    ]);
    for (const left of [once.id, rule, junk.id]) assert.ok(!d?.cites.includes(`i${left}`), `i${left}`);
    // In the briefing, the user's rule comes first (L0), then the dossier (L1); recall serves none of them again.
    const { seen } = await w.session("next").send("let's look at the upload test");
    const at = (/** @type {string} */ s) => seen.indexOf(s);
    assert.ok(at("never commit generated files") >= 0 && at("never commit generated files") < at("The project's dossier"), seen);
    assert.equal(seen.split("the flaky upload test still needs a fix").length, 2, "one line, in the dossier");
  });
});

test("rendered from claims, a pitfall shows under Pitfalls whatever its kind, and a procedure under How to, by its goal (M5-7)", async () => {
  const pitfallWriter = scripted({ dossier: () => ({ sections: [] }) });
  await world({ models: { summarizer: "judge" }, callModel: pitfallWriter }, async (w) => {
    const { projectId } = await project(w);
    // The miner's sighting, said again by a second session: a fact with a `seen` trigger, its commands its point.
    const bare = `node -e "process.exit(process.env.READY ? 0 : 3)"`;
    const seen = `\`${bare}\` failed here (exit 3); \`env READY=1 ${bare}\` worked.`;
    const trigger = { tool: "bash", shape: "node", unless: "env READY=1" };
    const mined = await w.svc.brain.fileSeen({ projectId, chainId: "m1", text: seen, trigger });
    await w.svc.brain.fileSeen({ projectId, chainId: "m2", text: seen, trigger });
    // The user's decision whose words arm a trigger is a pitfall too; their procedure is know-how; their fact is a fact.
    const decided = (await w.svc.brain.remember("We decided: never run `npm publish` from a laptop; run it as `CI=1 npm publish`.", { kind: "decision", projectId, by: "person" })).itemId;
    const how = (await w.svc.brain.remember("How to cut a release: 1. npm version patch 2. git push --follow-tags 3. npm publish", { kind: "procedure", projectId, by: "person" })).itemId;
    const fact = (await w.svc.brain.remember("the staging host is called kestrel", { kind: "fact", projectId, by: "person" })).itemId;
    const d = w.svc.brain.dossierOf(projectId);
    assert.deepEqual(d?.text.split("\n").map((l) => l.replace(/ · \d{4}-\d{2}-\d{2}/, "")), [
      "The project's dossier (its standing memories, by kind):",
      "How to:",
      `- [i${how} procedure · user said] How to cut a release (3 steps)`,
      "Pitfalls:",
      `- [i${decided} decision · user said] We decided: never run \`npm publish\` from a laptop; run it as \`CI=1 npm publish\`.`,
      `- [i${mined.id} fact · inferred · ✓2] ${seen}`,
      "Facts:",
      `- [i${fact} fact · user said] the staging host is called kestrel`,
    ]);
    // The curator is told which claims are pitfalls, and given a procedure by its goal.
    await w.svc.curator.run(projectId);
    const user = pitfallWriter.of(DOSSIER_PROMPT).at(-1)?.user ?? "";
    assert.match(user, new RegExp(`^i${mined.id} \\[fact · inferred · ✓2 · pitfall\\] `, "m"));
    assert.match(user, new RegExp(`^i${decided} \\[decision · user said · pitfall\\] `, "m"));
    assert.match(user, new RegExp(`^i${how} \\[procedure · user said\\] How to cut a release \\(3 steps\\)$`, "m"));
    assert.match(user, new RegExp(`^i${fact} \\[fact · user said\\] the staging host`, "m"));
    // The prompt names every section, in the dossier's order.
    const at = DOSSIER_SECTIONS.map((t) => DOSSIER_PROMPT.indexOf(`"${t}"`));
    assert.ok(at.every((n, i) => n > 0 && (i === 0 || n > at[i - 1])), JSON.stringify(at));
  });
});

test("a section's six lines are counted by section: a fact that is a pitfall takes no line of Facts", async () => {
  await world({}, async (w) => {
    const { projectId } = await project(w);
    const pitfall = (await w.svc.brain.remember("Never run `make deploy` bare; run it as `env STAGE=prod make deploy`.", { kind: "fact", projectId, by: "person" })).itemId;
    for (let i = 0; i < 6; i++) await w.svc.brain.remember(`fact number ${i} about the build`, { kind: "fact", projectId, by: "person" });
    const d = w.svc.brain.dossierOf(projectId);
    assert.equal(d?.lines, 7, d?.text);
    assert.doesNotMatch(d?.text ?? "", /more line/);
    assert.match(d?.text ?? "", new RegExp(`Pitfalls:\\n- \\[i${pitfall} fact · user said`));
  });
});

test("a procedure whose steps read like code is still know-how: listed in the dossier, and read whole by the merge", async () => {
  const judge = scripted({ merge: (u) => ({ pairs: pairsOf(u).map((p) => ({ n: p.n, same: false })) }) });
  await world({ models: { summarizer: "judge" }, callModel: judge }, async (w) => {
    const { projectId } = await project(w);
    const ship = "How to ship: 1. `x=$(git describe) && echo $x` 2. `docker build -t app:$x .` 3. `docker push app:$x`";
    const id = (await w.svc.brain.remember(ship, { kind: "procedure", projectId, by: "person" })).itemId;
    assert.match(w.svc.brain.dossierOf(projectId)?.text ?? "", new RegExp(`How to:\\n- \\[i${id} procedure · user said · [\\d-]+\\] How to ship \\(3 steps\\)`));
    // Two ways to two goals that share their words: the merge is shown both whole, so a step past 300 characters counts.
    const long = (/** @type {string} */ where) =>
      `How to deploy the web app to ${where}: ${Array.from({ length: 6 }, (_, i) => `${i + 1}. run deploy stage ${i + 1} of the web app and watch the dashboards until it settles`).join(" ")} 7. tell #${where} it is out`;
    for (const where of ["staging", "production"]) await w.svc.brain.remember(long(where), { kind: "procedure", projectId, by: "person" });
    assert.ok(long("staging").length > 400);
    await w.svc.curator.run(projectId);
    const asked = judge.of(MERGE_PROMPT).map((c) => c.user).join("\n");
    assert.ok(asked.includes(long("staging")) && asked.includes(long("production")), asked);
  });
});

test("the curator's dossier keeps its How to and Pitfalls lines, in the dossier's order, grounded in what they cite", async () => {
  const writer = scripted({
    dossier: (u) => {
      const how = /^(i\d+) \[procedure[^\]]*\] (.*)$/m.exec(u);
      const pit = /^(i\d+) \[[^\]]* · pitfall\] (.*)$/m.exec(u);
      return {
        sections: [
          { title: "Pitfalls", lines: [{ text: "Run the readiness check with READY=1 set, or it exits 3.", cites: [pit?.[1]] }] },
          { title: "How to", lines: [{ text: how?.[2], cites: [how?.[1]] }] },
        ],
      };
    },
  });
  await world({ models: { summarizer: "judge" }, callModel: writer }, async (w) => {
    const { projectId } = await project(w);
    const trigger = { tool: "bash", shape: "node", unless: "env READY=1" };
    const seen = "`node check.js` failed here (exit 3); `env READY=1 node check.js` worked: the readiness check exits 3 without READY.";
    const mined = await w.svc.brain.fileSeen({ projectId, chainId: "m1", text: seen, trigger });
    await w.svc.brain.fileSeen({ projectId, chainId: "m2", text: seen, trigger });
    const how = (await w.svc.brain.remember("How to deploy: 1. docker build -t app . 2. docker push app", { kind: "procedure", projectId, by: "person" })).itemId;
    const r = await w.svc.curator.run(projectId);
    assert.equal(r.dossier, "v1", JSON.stringify(r));
    assert.deepEqual(w.svc.archive.dossiers.latest(projectId).sections, [
      { title: "How to", lines: [{ text: "How to deploy (2 steps)", cites: [`i${how}`] }] },
      { title: "Pitfalls", lines: [{ text: "Run the readiness check with READY=1 set, or it exits 3.", cites: [`i${mined.id}`] }] },
    ]);
    // In the briefing, the line that lists a procedure says how to get its steps (a first message with a task: one with
    // none is briefed the procedures whole since 10-29).
    const { seen: briefing } = await w.session("next").send("check why the readiness script fails");
    assert.match(briefing, /How to:\n- How to deploy \(2 steps\) \[i\d+\]\nPitfalls:\n- Run the readiness check/);
    assert.ok(briefing.includes('A "How to" line names a procedure kept for this project'), briefing);
  });
});

test("what the dossier leaves out, by its room or by a section's six lines, is counted, never dropped in silence", async () => {
  await world({}, async (w) => {
    const { projectId } = await project(w);
    for (let i = 0; i < 9; i++) await w.svc.brain.remember(`decision number ${i} keeps the ${"wordy ".repeat(30)}reasoning`, { kind: "decision", projectId, by: "person" });
    const whole = w.svc.brain.dossierOf(projectId);
    assert.equal(whole?.lines, 6, "six a section");
    assert.match(whole?.text ?? "", /\n…and 3 more lines; filament_memory_search finds them\.$/);
    for (let i = 0; i < 6; i++) await w.svc.brain.remember(`fact number ${i} says the ${"lengthy ".repeat(25)}detail`, { kind: "fact", projectId, by: "person" });
    const { seen } = await w.session("tight").send("hello again");
    const block = seen.slice(seen.indexOf("The project's dossier"), seen.indexOf("Recent sessions in this project"));
    const shown = block.split("\n").filter((l) => l.startsWith("- [i")).length;
    const more = Number(/\n…and (\d+) more lines; filament_memory_search finds them\.\n/.exec(block)?.[1]);
    assert.ok(shown >= 1 && shown < 12, block);
    assert.equal(shown + more, 15, "every one of them is shown or counted");
    assert.ok(block.length <= 1200 * 4 * 0.35 + 400, `within its room: ${block.length}`);
  });
});

test("an earned claim reaches the dossier however many more important claims did not earn a place", async () => {
  await world({}, async (w) => {
    const { projectId, learned } = await project(w);
    const insert = w.svc.archive.db.prepare("INSERT INTO items (project_id, kind, text, text_norm, status, importance, origin, created_at) VALUES (?, 'fact', ?, ?, 'inferred', 0.9, 'learner', ?)");
    for (let i = 0; i < 320; i++) insert.run(projectId, `inferred once: worker ${i} drains its queue`, `inferred once: worker ${i} drains its queue`, Date.now());
    const decided = (await w.svc.brain.remember("we chose sqlite over postgres for the archive", { kind: "decision", projectId, by: "person" })).itemId;
    w.svc.archive.db.prepare("UPDATE items SET importance = 0.5 WHERE id = ?").run(decided);
    const thread = await learned("thread", "the flaky upload test still needs a fix");
    w.svc.archive.db.prepare("UPDATE items SET importance = 0.4 WHERE id = ?").run(thread.id);
    const d = w.svc.brain.dossierOf(projectId);
    assert.deepEqual(d?.cites.sort(), [`i${decided}`, `i${thread.id}`].sort(), d?.text);
    assert.doesNotMatch(d?.text ?? "", /more line/, "an unearned claim is neither shown nor counted");
  });
});

// ---- the memory plan's f6: near duplicates found by meaning ----
// The merge found its pairs by shared words alone, so a claim said again in other words, or in another language, stood
// beside the first for good. The fake engine's similarities are the ones the engine's multilingual model measured.
const MONEY = "Money is stored as integer cents in the database, never as floats.";
const MONEY_JA = "金額はデータベースに整数のセントで保存し、浮動小数点は使わない。";
const PNPM = "The project uses pnpm as its package manager.";
const PNPM_DE = "Das Projekt verwendet pnpm als Paketmanager.";
const NEAR = [{ texts: [MONEY, MONEY_JA], sim: 0.76 }, { texts: [PNPM, PNPM_DE], sim: 0.98 }];
/** The engine's `dense` ops Filament sent for each text. @param {any} w @param {string} text */
const lookups = (w, text) => w.ops().filter((/** @type {any} */ o) => o.op === "dense" && o.args.text === text);
/** The merge prompts' pairs, as "A | B". @param {any} model */
const pairsAsked = (model) => model.of(MERGE_PROMPT).flatMap((/** @type {any} */ c) => pairsOf(c.user).map((p) => `${p.a} | ${p.b}`));

// (fails before: yes — no pair was found but by shared words)
test("a claim and its translation are judged by the model and merged onto the survivor the rules pick; undo restores them and looks them up again", async () => {
  const model = scripted({ merge: allSame });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    w.near(NEAR);
    const money = await learned("convention", MONEY, { ageDays: 2 });
    const ja = await learned("convention", MONEY_JA);
    const pnpm = await learned("fact", PNPM);
    const de = await learned("fact", PNPM_DE);
    const r = await w.svc.curator.run(projectId);
    assert.equal(r.merged, 2, JSON.stringify(r));
    assert.deepEqual(pairsAsked(model).sort(), [`${MONEY} | ${MONEY_JA}`, `${PNPM} | ${PNPM_DE}`]);
    assert.ok(lookups(w, MONEY_JA).every((o) => o.args.strict === true), "a lookup that searched nothing fails, never reads as nothing near");
    const st = (/** @type {any} */ c) => [w.svc.archive.items.get(c.id).status, w.svc.archive.items.get(c.id).superseded_by];
    assert.deepEqual(st(ja), ["superseded", money.id], "the older survives");
    assert.deepEqual(st(de), ["superseded", pnpm.id], "a translation is the same claim");
    assert.deepEqual([st(money)[0], st(pnpm)[0]], ["inferred", "inferred"]);
    await w.svc.brain.undoRun(Number(r.run.slice(1)), { by: "owner" });
    assert.deepEqual([st(ja)[0], st(de)[0]], ["inferred", "inferred"], "undone, both stand again");
    const before = lookups(w, MONEY_JA).length;
    await w.svc.curator.run(projectId);
    assert.equal(lookups(w, MONEY_JA).length, before + 1, "and the pass's lookups are made again");
  });
});

// (fails before: no — a guard: by meaning, two values of one thing are no pair, and the floor holds)
test("two values of one thing are never put to the model by meaning, however near; a pair under the floor is none", async () => {
  const model = scripted({ merge: (u) => ({ pairs: pairsOf(u).map((p) => ({ n: p.n, same: false })) }) });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    const BUN = "The project uses bun as its package manager.";
    const DEPLOY = "Deploys go out on every push to main.";
    w.near([{ texts: [PNPM, BUN], sim: 0.93 }, { texts: [PNPM, DEPLOY], sim: 0.7 }]);
    await learned("fact", PNPM);
    await learned("fact", BUN);
    await learned("fact", DEPLOY);
    await w.svc.curator.run(projectId);
    assert.deepEqual(pairsAsked(model), [], "rival values: no pair; under 0.75: no pair");
  });
});

// (fails before: yes — the same)
test("a claim is looked up once its pairs are settled; one with a pair the model left unanswered is looked up again, its pair judged distinct not asked again", async () => {
  const C = "Prices are kept in whole cents as integers.";
  // The model says A–C are distinct and leaves B–C unanswered on the first pass; it answers every pair after.
  let first = true;
  const model = scripted({
    merge: (u) => {
      const out = { pairs: pairsOf(u).filter((p) => !(first && p.a === PNPM_DE)).map((p) => ({ n: p.n, same: false })) };
      first = false;
      return out;
    },
  });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    w.near([{ texts: [MONEY, C], sim: 0.8 }, { texts: [PNPM_DE, C], sim: 0.8 }]);
    await learned("convention", MONEY);
    await learned("convention", PNPM_DE);
    await learned("convention", C);
    await w.svc.curator.run(projectId);
    assert.equal(lookups(w, C).length, 1);
    await w.svc.curator.run(projectId);
    assert.equal(lookups(w, C).length, 2, "looked up again: a pair had no verdict");
    assert.deepEqual(pairsAsked(model).filter((p) => p.endsWith(C)), [`${MONEY} | ${C}`, `${PNPM_DE} | ${C}`, `${PNPM_DE} | ${C}`], "the distinct pair is not asked again");
    await w.svc.curator.run(projectId);
    assert.deepEqual([lookups(w, MONEY).length, lookups(w, C).length], [1, 2], "settled: not looked up again");
  });
});

// (fails before: yes — the review of f6: a pair judged the same that no group could take counted as settled, and the
// third claim stood beside its twin for good)
test("a pair judged the same that no group could take is found and merged next pass", async () => {
  const model = scripted({ merge: allSame });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    // Three wordings in three languages, sharing no word: the English and the German near, the German and the Japanese
    // near, the English and the Japanese not near enough to be put together.
    const B = "Geldbeträge werden als ganze Zahlen in der Datenbank gespeichert, nie als Gleitkommazahlen.";
    w.near([{ texts: [MONEY, B], sim: 0.85 }, { texts: [B, MONEY_JA], sim: 0.78 }]);
    const a = await learned("convention", MONEY);
    const b = (await w.svc.brain.remember(B, { kind: "convention", projectId, by: "person" })).itemId;
    await w.settle();
    const c = await learned("convention", MONEY_JA);
    await w.svc.curator.run(projectId);
    assert.equal(w.svc.archive.items.get(a.id).superseded_by, b, "the user's word survives A");
    assert.equal(w.svc.archive.items.get(c.id).status, "inferred", "the Japanese was never judged beside the English: no group took it");
    await w.svc.curator.run(projectId);
    assert.deepEqual([w.svc.archive.items.get(c.id).status, w.svc.archive.items.get(c.id).superseded_by], ["superseded", b], "found again, and merged");
  });
});

// (fails before: yes — the review of f6: the lookup took the engine's four nearest rows of every project, so other
// projects' near rows took the places of this project's twin, and the mark moved past it)
test("other projects' near rows do not take the places of this project's own", async () => {
  const model = scripted({ merge: allSame });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const others = ["C:\\work\\one", "C:\\work\\two", "C:\\work\\three"];
    const elsewhere = others.map((_, i) => `The project uses pnpm for its packages (${i + 1}).`);
    // Each of the two has three nearer rows in other projects, its own row among the nearest too.
    w.near([{ texts: [PNPM, ...elsewhere], sim: 0.95 }, { texts: [PNPM_DE, ...elsewhere], sim: 0.95 }, { texts: [PNPM, PNPM_DE], sim: 0.8 }]);
    for (const [i, cwd] of others.entries()) {
      const { sit } = await w.session(`o${i}`, { cwd }).send("hello");
      await w.svc.brain.fileLearned({ projectId: sit.project.id, chainId: `o${i}`, kind: "fact", text: elsewhere[i], importance: 0.7 });
      await w.settle();
    }
    const { projectId, learned } = await project(w);
    const pnpm = await learned("fact", PNPM);
    const de = await learned("fact", PNPM_DE);
    await w.svc.curator.run(projectId);
    assert.equal(w.svc.archive.items.get(de.id).superseded_by, pnpm.id);
  });
});

// (fails before: yes — the review of f6: lookups searched the engine while it made its vectors again, and every claim
// they found nothing for was marked looked up for good)
test("nothing is looked up while the engine makes its vectors again, nor with an engine with none; a claim deleted takes its mark with it", async () => {
  const model = scripted({ merge: allSame });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    w.near(NEAR);
    const money = await learned("convention", MONEY);
    const gone = await w.session("gone").send("hello");
    const ja = (await w.svc.brain.fileLearned({ projectId, chainId: gone.prep.chain, kind: "convention", text: MONEY_JA, importance: 0.7 })).id;
    await w.settle();
    w.svc.brain.reembedding = true;
    await w.svc.curator.run(projectId);
    assert.equal(lookups(w, MONEY_JA).length, 0);
    w.svc.brain.reembedding = false;
    await w.svc.curator.run(projectId);
    assert.equal(lookups(w, MONEY_JA).length, 1);
    assert.equal(w.svc.archive.curator.nearLooked([money.id]).size, 1);
    // A chat deleted takes its claims, and their marks: a claim filed later under a freed id is looked up all the same.
    assert.equal(w.svc.archive.curator.nearLooked([ja]).size, 1);
    await w.svc.deleteSession(gone.prep.chain);
    assert.equal(w.svc.archive.items.get(ja), null);
    assert.equal(w.svc.archive.curator.nearLooked([ja]).size, 0, "the deleted claim's mark went with it");
  });
  const fake = fileURLToPath(new URL("./fixtures/fake-sidecar.mjs", import.meta.url));
  await inFolder(async (dir) => {
    const engine = { command: process.execPath, args: [fake], env: { FAKE_SIDECAR_EMBEDDINGS: "0", FAKE_SIDECAR_STATE: join(dir, "state.json") } };
    await world({ models: { summarizer: "judge" }, callModel: scripted({}), engine }, async (w) => {
      const { projectId, learned } = await project(w);
      const a = await learned("convention", MONEY);
      await learned("convention", MONEY_JA);
      await w.svc.curator.run(projectId);
      assert.equal(w.svc.archive.curator.nearLooked([a.id]).size, 0, "an engine with no vectors marks nothing");
    });
  });
});

// (fails before: yes — the second look of f6's review: a claim standing again, or a pair's verdict undone, kept its
// mark, so the pairs it could be in were never looked for again; a claim's row deleted by any build left its mark)
test("a claim standing again, or a verdict undone, is looked up by meaning again; a claim's row deleted takes its mark", async () => {
  const model = scripted({ merge: (u) => ({ pairs: pairsOf(u).map((p) => ({ n: p.n, same: false })) }) });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { projectId, learned } = await project(w);
    w.near(NEAR);
    const money = await learned("convention", MONEY);
    const ja = await learned("convention", MONEY_JA);
    const pnpm = await learned("fact", PNPM);
    await w.svc.curator.run(projectId);
    const marked = (/** @type {number} */ id) => w.svc.archive.curator.nearLooked([id]).size === 1;
    assert.deepEqual([marked(money.id), marked(ja.id), marked(pnpm.id)], [true, true, true]);
    // The verdict undone: both its claims are looked up again.
    const verdict = w.svc.archive.items.events(ja.id).find((/** @type {any} */ e) => e.action === "distinct");
    assert.equal((await w.svc.brain.undoEvent(verdict.id, { by: "owner" })).ok, true);
    assert.deepEqual([marked(money.id), marked(ja.id)], [false, false]);
    // Retired and standing again: looked up again.
    await w.svc.brain.setItemStatus(pnpm.id, "dismissed", { by: "owner", reason: "not so" });
    await w.svc.brain.setItemStatus(pnpm.id, "inferred", { by: "owner", reason: "it was so" });
    assert.equal(marked(pnpm.id), false);
    // A claim's row deleted as a build that knows nothing of the marks deletes it: its mark goes with it.
    await w.svc.curator.run(projectId);
    assert.equal(marked(pnpm.id), true);
    w.svc.archive.db.prepare("DELETE FROM item_events WHERE item_id = ?").run(pnpm.id);
    w.svc.archive.db.prepare("DELETE FROM items WHERE id = ?").run(pnpm.id);
    assert.equal(w.svc.archive.db.prepare("SELECT COUNT(*) AS n FROM item_near WHERE item_id = ?").get(pnpm.id).n, 0);
  });
});

// (fails before: yes — the second look of f6's review: a reindex asked on the console, or an import's, searched a
// half-made index with no word of it, and lookups marked what they found nothing for; lookups ran with no call left to
// judge their pairs, and on a claim with no copy in the engine yet)
test("no lookup by meaning while any reindex runs, with no call left to judge, on a claim not in the engine yet, nor through a failing engine", async () => {
  const model = scripted({ merge: allSame });
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const going = w.svc.reindex();
    assert.equal(w.svc.brain.reembedding, true, "a reindex asked on the console makes the vectors again too");
    await going;
    assert.equal(w.svc.brain.reembedding, false);
    const { projectId, learned } = await project(w);
    w.near(NEAR);
    const money = await learned("convention", MONEY);
    const ja = await learned("convention", MONEY_JA);
    w.svc.archive.db.prepare("UPDATE items SET memory_id = NULL WHERE id = ?").run(ja.id);
    w.failOps(["dense"]);
    await w.svc.curator.run(projectId);
    assert.equal(w.svc.archive.curator.nearLooked([money.id, ja.id]).size, 0, "a failed lookup marks nothing");
    w.failOps([]);
    await w.svc.curator.run(projectId);
    assert.equal(lookups(w, MONEY_JA).length, 0, "no copy in the engine: not looked up");
    assert.deepEqual([w.svc.archive.curator.nearLooked([money.id]).size, w.svc.archive.curator.nearLooked([ja.id]).size], [1, 0]);
  });
  await world({ models: { summarizer: "judge" }, callModel: scripted({ merge: allSame }), curator: { maxCalls: 1 } }, async (w) => {
    const { projectId, learned } = await project(w);
    w.near(NEAR);
    await learned("convention", MONEY);
    await learned("convention", MONEY_JA);
    await w.svc.curator.run(projectId);
    assert.equal(lookups(w, MONEY_JA).length, 0, "the pass's one call is the dossier's: no pair could be judged");
  });
});
