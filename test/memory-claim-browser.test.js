// @ts-check
// The claim browser's reads (HarnessV3-Memory M6-5): a project's claims, or the global ones, as cards by state
// (standing, to review, retired) and by kind as a reader looks for them (rules, how to, pitfalls, decisions, facts,
// threads), with counts for each; where claims live ("Everywhere", then each project); the dossier's lines by section,
// each with the claims it rests on (M6-D3); and their routes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIDENCE_GATE } from "../src/services/memory/brain.js";
import { world, adminCall } from "./fixtures/memory-world.mjs";

const RELEASE = "How to cut a release: 1. `npm version patch` 2. `git push --follow-tags` 3. `npm publish`";

/** A project with one claim of each kind a reader looks for, a retired one, one memory asks about, and a global one. @param {any} w */
async function filed(w) {
  const { sit } = await w.session("a").send("hello");
  const projectId = sit.project.id;
  const brain = w.svc.brain;
  const said = async (/** @type {string} */ text, /** @type {string} */ kind, pid = projectId) => `i${(await brain.remember(text, { kind, projectId: pid, by: "person" })).itemId}`;
  const learned = async (/** @type {string} */ chainId, /** @type {string} */ kind, /** @type {string} */ text) => `i${(await brain.fileLearned({ projectId, chainId, kind, text, importance: 0.7 })).id}`;
  const ids = {
    pitfall: await said("never run npm test bare here; run it as env -u CLAUDECODE npm test", "rule"),
    release: await said(RELEASE, "procedure"),
    decision: await said("We chose sqlite over postgres for the archive because it ships with node.", "decision"),
    fact: await learned("l1", "fact", "the api listens on port 3000"),
    thread: await learned("l2", "thread", "the retry logic in src/net/client.js still drops the last attempt"),
    gone: await learned("l3", "fact", "the docs site deploys to netlify"),
    global: await said("Always answer in British English.", "preference", null),
  };
  const num = (/** @type {string} */ id) => Number(id.slice(1));
  await w.svc.scope({ role: "owner" }).setStatus(num(ids.gone), "dismissed", { reason: "we moved off netlify" });
  w.svc.archive.inbox.add({ projectId, kind: "retire", key: "test:fact", itemIds: [num(ids.fact)], proposal: { action: "retire", id: num(ids.fact) }, reason: "asked in the test" });
  return { projectId, ids };
}
const idsOf = (/** @type {any} */ r) => r.claims.map((/** @type {any} */ c) => c.id).sort();

test("a project's claims by state and kind: each a card, with how many each state and kind would list", async () => {
  await world({}, async (w) => {
    const { projectId, ids } = await filed(w);
    const claims = (/** @type {any} */ o = {}) => w.svc.claims(projectId, o);
    const all = claims();
    assert.deepEqual(idsOf(all), [ids.pitfall, ids.release, ids.decision, ids.fact, ids.thread].sort(), "standing: the project's own, not the global one, not the retired one");
    assert.deepEqual(all.counts, { standing: 5, review: 1, retired: 1, kinds: { all: 5, rules: 1, howto: 1, pitfalls: 1, decisions: 1, facts: 1, threads: 1 } });
    assert.equal(all.more, 0);
    const card = (/** @type {string} */ id) => all.claims.find((/** @type {any} */ c) => c.id === id);
    assert.deepEqual(card(ids.pitfall).triggers, [{ shape: "npm test", unless: "env -u CLAUDECODE", source: "words", fired: 0, followed: 0, kept: 0 }]);
    assert.deepEqual([card(ids.pitfall).trust, card(ids.pitfall).backed, card(ids.pitfall).flags], ["user said", 1, []]);
    assert.equal(card(ids.release).text, RELEASE, "a procedure whole");
    // To review: the standing claims memory flags, holds back or is no longer sure of.
    const review = claims({ state: "review" });
    assert.deepEqual(idsOf(review), [ids.fact]);
    assert.deepEqual(review.claims[0].flags, ["in question: the user is asked to retire it"]);
    assert.deepEqual(review.counts.kinds, { all: 1, rules: 0, howto: 0, pitfalls: 0, decisions: 0, facts: 1, threads: 0 }, "the kinds counted under the state");
    const retired = claims({ state: "retired" });
    assert.deepEqual(idsOf(retired), [ids.gone]);
    assert.equal(retired.claims[0].status, "dismissed");
    assert.equal("sure" in retired.claims[0], false, "a retired claim has no confidence");
    // A pitfall is any claim with a trigger, whatever its kind; a kind leaves the kinds' own counts alone.
    const pitfalls = claims({ kind: "pitfalls" });
    assert.deepEqual(idsOf(pitfalls), [ids.pitfall]);
    assert.deepEqual([pitfalls.counts.standing, pitfalls.counts.review, pitfalls.counts.retired, pitfalls.counts.kinds.all], [1, 0, 0, 5]);
    assert.deepEqual(idsOf(claims({ kind: "howto" })), [ids.release]);
    assert.deepEqual(idsOf(claims({ kind: "threads" })), [ids.thread]);
    assert.deepEqual(idsOf(claims({ kind: "rules" })), [ids.pitfall], "a rule that is a pitfall is a rule too");
    const facts = claims({ kind: "facts" });
    assert.deepEqual([idsOf(facts), facts.counts.standing, facts.counts.retired], [[ids.fact], 1, 1]);
    assert.deepEqual(idsOf(claims({ kind: "facts", state: "retired" })), [ids.gone]);
    // Words its text holds, or its id; a limit says how many more.
    assert.deepEqual(idsOf(claims({ q: "PORT" })), [ids.fact]);
    assert.deepEqual(idsOf(claims({ q: ids.decision })), [ids.decision]);
    assert.deepEqual(idsOf(claims({ q: ` ${ids.decision.toUpperCase()} ` })), [ids.decision], "an id pasted with its spaces, in capitals");
    assert.deepEqual(idsOf(claims({ q: "claudecode" })), [ids.pitfall], "lower-case words find the claim's capitals");
    assert.deepEqual(claims({ q: "port" }).counts.kinds.all, 1, "the counts are of what the words find");
    assert.deepEqual(idsOf(claims({ q: "  retry  CLIENT.JS " })), [ids.thread], "every word, wherever it stands in the text (M7-D62)");
    assert.deepEqual(idsOf(claims({ q: "retry netlify" })), [], "a word it lacks: not found");
    const two = claims({ limit: 2 });
    assert.deepEqual([two.claims.length, two.more, two.counts.standing], [2, 3, 5]);
    // "Everywhere": the global claims alone.
    const everywhere = w.svc.claims(null);
    assert.deepEqual([everywhere.project, idsOf(everywhere), everywhere.counts.kinds.rules], [null, [ids.global], 1]);
  });
});

test("where claims live: Everywhere first, then each project with how many claims stand in it; no project is not one", async () => {
  await world({}, async (w) => {
    const { projectId } = await filed(w);
    await w.session("loose", { cwd: null }).send("hello");
    const scopes = w.svc.claimScopes();
    assert.deepEqual(scopes[0], { project: null, name: "Everywhere", claims: 1 });
    assert.deepEqual(scopes.slice(1), [{ project: projectId, name: "evals", cwd: "C:\\evals", claims: 5, dossier: null }], "the session with no folder made no scope");
  });
});

test("the claim browser's routes: scopes; claims by project, state, kind, words and limit; refusals in words", async () => {
  await world({}, async (w) => {
    const { projectId, ids } = await filed(w);
    const get = (/** @type {string} */ path) => adminCall(w.svc, "GET", path);
    const scopes = await get("/memory/claims/scopes");
    assert.deepEqual([scopes.status, scopes.body.scopes.map((/** @type {any} */ s) => [s.project, s.claims])], [200, [[null, 1], [projectId, 5]]]);
    const pitfalls = await get(`/memory/claims?project=${projectId}&kind=pitfalls`);
    assert.deepEqual([pitfalls.status, idsOf(pitfalls.body)], [200, [ids.pitfall]]);
    assert.deepEqual(idsOf((await get(`/memory/claims?project=${projectId}&state=retired`)).body), [ids.gone]);
    assert.deepEqual(idsOf((await get(`/memory/claims?project=${projectId}&q=netlify&state=retired`)).body), [ids.gone]);
    const one = (await get(`/memory/claims?project=${projectId}&limit=1`)).body;
    assert.deepEqual([one.claims.length, one.more], [1, 4]);
    assert.deepEqual(idsOf((await get("/memory/claims")).body), [ids.global], "no project named: the global claims");
    assert.deepEqual((await get(`/memory/claims?project=${projectId}&state=old`)).body, { error: "state is one of standing, review, retired" });
    assert.equal((await get(`/memory/claims?project=${projectId}&state=old`)).status, 400);
    assert.deepEqual((await get(`/memory/claims?project=${projectId}&kind=notes`)).body, { error: "kind is one of rules, howto, pitfalls, decisions, facts, threads" });
    assert.equal((await get("/memory/claims?project=nope")).status, 404);
    assert.equal((await adminCall({ isOpen: () => false, archiveWhy: () => "Memory has not started." }, "GET", "/memory/claims")).status, 503);
    assert.equal((await adminCall({ isOpen: () => false, archiveWhy: () => "Memory has not started." }, "GET", "/memory/claims/scopes")).status, 503);
  });
});

test("one claim's card by any id a line shows, as the browser draws it; what is no claim, or nothing, refused in words (M7-D34)", async () => {
  await world({}, async (w) => {
    const { projectId, ids } = await filed(w);
    await w.settle();
    const get = (/** @type {string} */ path) => adminCall(w.svc, "GET", path);
    const num = (/** @type {string} */ id) => Number(id.slice(1));
    const drawn = [...w.svc.claims(projectId).claims, ...w.svc.claims(projectId, { state: "retired" }).claims, ...w.svc.claims(null).claims];
    for (const id of Object.values(ids)) {
      const card = drawn.find((c) => c.id === id);
      assert.deepEqual(await get(`/memory/claims/${id}`), { status: 200, body: card }, id);
      assert.deepEqual((await get(`/memory/claims/${num(id)}`)).body, card, `${id} by its bare number`);
    }
    assert.ok(drawn.find((c) => c.id === ids.fact).flags.length && drawn.find((c) => c.id === ids.pitfall).triggers, "the cards compared carry flags and triggers");
    // An engine twin's id, as a search shows it, percent-encoded as a page sends it: the card, and the history.
    const twin = w.svc.archive.items.get(num(ids.decision)).memory_id;
    assert.ok(twin, "the engine has the decision");
    assert.deepEqual((await get(`/memory/claims/${encodeURIComponent(`e:${twin}`)}`)).body, drawn.find((c) => c.id === ids.decision));
    const h = await get(`/memory/items/${encodeURIComponent(`e:${twin}`)}/history`);
    assert.deepEqual([h.status, h.body.id], [200, ids.decision]);
    // Refused in words.
    const refused = async (/** @type {string} */ path) => {
      const r = await get(path);
      return [r.status, r.body.error];
    };
    const kept = (/** @type {string} */ kind) => `i${w.svc.archive.items.add({ projectId, chainId: "a", kind, text: `a stored ${kind}`, status: "inferred", importance: 0.5 }).id}`;
    const perm = kept("permission");
    const turn = kept("turn");
    const ability = kept("ability:release");
    assert.deepEqual(await refused("/memory/claims/i99999"), [404, "no memory i99999"]);
    assert.deepEqual(await refused(`/memory/claims/${perm}`), [404, `${perm} is not a claim: it is an always-allow offer`]);
    assert.deepEqual(await refused(`/memory/claims/${turn}`), [404, `${turn} is not a claim: it is words from a past session`]);
    assert.deepEqual(await refused(`/memory/claims/${ability}`), [404, `${ability} is not a claim: it is what the ability release held`]);
    assert.deepEqual(await refused(`/memory/claims/${encodeURIComponent("s:a:1")}`), [404, "that id is a quote from a past session, not a stored memory"]);
    // The engine's canonical facts are no claims Filament reads (the memory plan's f5): `canon:` is no id form of its own.
    assert.deepEqual(await refused("/memory/claims/canon:name"), [404, "no memory stands behind canon:name yet"]);
    assert.deepEqual(await refused("/memory/claims/m-none"), [404, "no memory stands behind m-none yet"]);
    assert.deepEqual(await refused("/memory/claims/%E0%A4%A"), [400, "bad percent-encoding in the path"]);
    const scopes = await get("/memory/claims/scopes");
    assert.deepEqual([scopes.status, Array.isArray(scopes.body.scopes)], [200, true], "the scopes keep their name");
    assert.equal((await adminCall({ isOpen: () => false, archiveWhy: () => "Memory has not started." }, "GET", "/memory/claims/i1")).status, 503);
  });
});

test("the claims route reads its words and caps its limit; a limit that is no whole number is refused in words", async () => {
  /** @type {any[]} */
  const asked = [];
  const memory = { isOpen: () => true, archive: { getProject: () => ({ id: "p1" }) }, claims: (/** @type {any} */ p, /** @type {any} */ o) => (asked.push([p, o]), { claims: [] }) };
  for (const qs of ["project=p1&q=port&limit=5000", "limit=0", "", "limit="]) assert.equal((await adminCall(memory, "GET", `/memory/claims?${qs}`)).status, 200);
  assert.deepEqual(asked, [
    ["p1", { state: "standing", kind: null, q: "port", limit: 1000 }],
    [null, { state: "standing", kind: null, q: "", limit: 0 }],
    [null, { state: "standing", kind: null, q: "", limit: 200 }],
    [null, { state: "standing", kind: null, q: "", limit: 200 }],
  ]);
  for (const bad of ["abc", "-3", "2.5"]) {
    const r = await adminCall(memory, "GET", `/memory/claims?limit=${bad}`);
    assert.deepEqual([r.status, r.body], [400, { error: "limit is a whole number" }], bad);
  }
  assert.equal(asked.length, 4, "a refused read asks nothing");
});

test("the dossier's lines by section, each with the claims it rests on, as its text shows them", async () => {
  await world({}, async (w) => {
    const { projectId, ids } = await filed(w);
    const d = (await adminCall(w.svc, "GET", `/memory/dossier?project=${projectId}`)).body;
    assert.deepEqual(d.sections, [
      { title: "How to", lines: [{ text: "How to cut a release (3 steps)", cites: [ids.release], flags: [] }] },
      { title: "Key decisions", lines: [{ text: "We chose sqlite over postgres for the archive because it ships with node.", cites: [ids.decision], flags: [] }] },
      { title: "Current work and open threads", lines: [{ text: "the retry logic in src/net/client.js still drops the last attempt", cites: [ids.thread], flags: [] }] },
    ]);
    for (const sec of d.sections) {
      assert.ok(d.text.includes(`\n${sec.title}:\n`), sec.title);
      for (const l of sec.lines) assert.ok(d.text.includes(`[${l.cites[0]} `) && d.text.includes(l.text), l.text);
    }
    assert.deepEqual(d.cites, d.sections.flatMap((/** @type {any} */ s) => s.lines.flatMap((/** @type {any} */ l) => l.cites)));
  });
});

test("a claim's files on its card: one changed is said and less sure, one gone is held back; both are to review, and so is one memory is unsure of", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-browser-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "api.js"), "export const port = 3000;\n");
    writeFileSync(join(dir, "src", "db.js"), "export const db = null;\n");
    await world({ cwd: dir }, async (w) => {
      const { sit } = await w.session("a").send("hello");
      const projectId = sit.project.id;
      const said = async (/** @type {string} */ text, /** @type {string} */ kind) => `i${(await w.svc.brain.remember(text, { kind, projectId, by: "person" })).itemId}`;
      const api = await said("We keep src/api.js on port 3000 because the docs name it.", "decision");
      const db = await said("src/db.js opens the archive lazily, never at import.", "rule");
      const card = (/** @type {string} */ id) => w.svc.claims(projectId).claims.find((/** @type {any} */ c) => c.id === id);
      const sure = card(api).sure;
      assert.deepEqual([card(api).flags, "held" in card(api), card(db).flags, "held" in card(db)], [[], false, [], false]);
      appendFileSync(join(dir, "src", "api.js"), "// moved to 3001\n");
      unlinkSync(join(dir, "src", "db.js"));
      const changed = card(api);
      const gone = card(db);
      assert.deepEqual([changed.flags, "held" in changed], [["file changed since"], false]);
      assert.ok(changed.sure < sure, `less sure once its file changed: ${changed.sure} < ${sure}`);
      assert.deepEqual([gone.flags, gone.held], [["file gone"], true]);
      // One memory is no longer sure of, with nothing flagged: to review all the same.
      const doubted = (await w.svc.brain.fileLearned({ projectId, chainId: "l1", kind: "fact", text: "the nightly build runs at two", importance: 0.7 })).id;
      for (const n of [1, 2]) w.svc.archive.items.note(doubted, "suspected", { by: "person", reason: "a correction named its words", detail: { chain: `x${n}` } });
      const unsure = card(`i${doubted}`);
      assert.ok(unsure.sure < CONFIDENCE_GATE && unsure.flags.length === 0 && !unsure.held, JSON.stringify(unsure));
      assert.deepEqual(idsOf(w.svc.claims(projectId, { state: "review" })), [api, db, `i${doubted}`].sort());
      // The dossier's line says its claim's file changed.
      const d = (await adminCall(w.svc, "GET", `/memory/dossier?project=${projectId}`)).body;
      const line = d.sections.flatMap((/** @type {any} */ s) => s.lines).find((/** @type {any} */ l) => l.cites.includes(api));
      assert.deepEqual(line?.flags, ["file changed since"], JSON.stringify(d.sections));
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a pitfall is a claim with a trigger, whatever its kind; a permission is no claim; a replaced claim names what replaced it", async () => {
  await world({}, async (w) => {
    const { projectId, ids } = await filed(w);
    const num = (/** @type {string} */ id) => Number(id.slice(1));
    const plain = `i${(await w.svc.brain.remember("keep the changelog in the past tense", { kind: "rule", projectId, by: "person" })).itemId}`;
    w.svc.archive.triggers.set(num(ids.fact), "seen", [{ tool: "bash", shape: "curl", args: "localhost:3000", unless: "localhost:3001" }]);
    assert.deepEqual(idsOf(w.svc.claims(projectId, { kind: "pitfalls" })), [ids.pitfall, ids.fact].sort(), "a fact with a trigger is a pitfall; a rule without one is not");
    assert.deepEqual(idsOf(w.svc.claims(projectId, { kind: "rules" })), [ids.pitfall, plain].sort());
    const perm = w.svc.archive.items.add({ projectId, chainId: "a", kind: "permission", text: "bash: npm test", status: "inferred", importance: 0.8 });
    const all = w.svc.claims(projectId);
    assert.ok(!all.claims.some((/** @type {any} */ c) => c.id === `i${perm.id}`), "a permission is not a claim");
    assert.equal(all.counts.standing, 6);
    const fresh = `i${(await w.svc.brain.remember("the api listens on port 3001", { kind: "fact", projectId, by: "person" })).itemId}`;
    w.svc.archive.items.setStatus(num(ids.fact), "superseded", { by: "person", replacement: num(fresh) });
    const old = w.svc.claims(projectId, { state: "retired" }).claims.find((/** @type {any} */ c) => c.id === ids.fact);
    assert.deepEqual([old?.status, old?.replacedBy], ["superseded", fresh]);
  });
});

test("where claims live, each project as it stands: archived said, its dossier's version, its folder when it has no name", async () => {
  await world({}, async (w) => {
    const { projectId } = await filed(w);
    const scope = () => w.svc.claimScopes().find((/** @type {any} */ s) => s.project === projectId);
    w.svc.archive.setProjectArchived(projectId, true);
    w.svc.archive.dossiers.add({ projectId, sections: [], cites: [], basis: "test" });
    w.svc.archive.dossiers.add({ projectId, sections: [], cites: [], basis: "test again" });
    assert.deepEqual([scope().archived, scope().dossier, scope().name], [true, 2, "evals"]);
    w.svc.archive.db.prepare("UPDATE projects SET name = NULL WHERE id = ?").run(projectId);
    assert.equal(scope().name, "C:\\evals", "a row with no name goes by its folder");
  });
});
