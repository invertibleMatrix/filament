// Memory that stays true (HarnessV3-Memory M1): the unit-level proofs behind the evals in memory-evals.test.js — the
// engine fenced off (MD-0), statuses and history on items, correct/confirm/forget, ids and labels on every line, use
// judged per item, live canon, errata. Run through the real service and brain on the fake engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { world, adminCall } from "./fixtures/memory-world.mjs";
import { executeMemoryTool } from "../src/memory-tools.js";
import { dateOf, trustOf } from "../src/services/memory/brain.js";

const refresh = (id, content) => ({ id, content: `[MODEL_REFRESH_PROPOSAL] ${content}`, source: "sleep_model_refresh_proposal", importance: 0.95, veracity: "inferred", scope: "session", memory_type: "context", timestamp: "2026-09-25T03:00:07" });
const summary = (id, content) => ({ id, content, source: "sleep_consolidation", tier: "episodic", importance: 0.6, veracity: "inferred", scope: "global", timestamp: "2026-09-26T03:00:54" });
const num = (ref) => Number(String(ref).slice(1));

// (fails before: nothing ever marked the engine's own rows, so they took recall's top slots forever)
test("the engine's own rows are fenced when it starts: marked superseded, ids kept in the archive, Filament's rows untouched; a second fence finds none", () =>
  world({ engineRows: [refresh("r1", "Project 'test' at H:\test"), summary("s1", "Assistant runs in project 'test' at H:\test"), { id: "m9", content: "the staging server is in eu-west-2", source: "filament-fact", importance: 0.8, scope: "global" }] }, async (w) => {
    await w.settle();
    const rows = Object.fromEntries(w.engineRows().map((r) => [r.id, r]));
    assert.equal(rows.r1.superseded_by, "filament:engine-written");
    assert.equal(rows.s1.superseded_by, "filament:engine-written");
    assert.equal(rows.m9.superseded_by, undefined, "Filament's own row stands");
    assert.ok(w.engineRows().every((r) => !r.forgotten), "nothing deleted");
    const rec = w.svc.archive.schemaMetaGet("engineFence");
    assert.deepEqual(rec.working, ["r1"]);
    assert.deepEqual(rec.episodic, ["s1"]);
    assert.deepEqual(await w.svc.fenceEngine(), { working: [], episodic: [], canonical: [] }, "idempotent");
    assert.deepEqual(w.svc.archive.schemaMetaGet("engineFence").working, ["r1"], "the record keeps what the first fence did");
  }));

// (fails before: recall served whatever the engine returned, by score)
test("rows the engine writes after the fence are never served either: the serving rule stands on its own", () =>
  world({}, async (w) => {
    await w.svc.store.remember({ content: "Project 'test' at H:\test; file-level tools conditionally unavailable", source: "sleep_model_refresh_proposal", importance: 0.95 });
    await w.svc.store.remember({ content: "[MEMORIA memoria_instructions] must not restart the live harness test runner", source: "memoria_memoria_instructions", importance: 0.5 });
    const { seen, prep } = await w.session("a").send("which file-level tools are available in the test project, and may I restart the harness test runner?");
    assert.ok(!seen.includes("H:\test"), "a model-refresh guess written after the fence");
    assert.ok(!seen.includes("must not restart the live harness"), "a memoria fragment");
    assert.ok(prep.notes.length >= 1);
  }));

// (fails before: a correction dismissed the old item with no reason, no replacement and no history, and deleted its
// engine copy; nothing could bring it back as it was)
test("a correction keeps the old memory as history: superseded by the new one, with who, why and when; the owner can bring it back", () =>
  world({}, async (w) => {
    const { brain, archive } = w.svc;
    const a = await brain.remember("The build output goes to out/dist.", { kind: "fact", projectId: "p1", by: "person" });
    await w.settle();
    const engineId = archive.items.get(a.itemId).memory_id;
    assert.ok(engineId);
    const r = await brain.correct(a.id, { text: "The build output goes to build/.", reason: "moved in the vite switch", by: "person" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.replaces, a.id);
    const old = archive.items.get(a.itemId);
    assert.equal(old.status, "superseded");
    assert.equal(old.superseded_by, num(r.id));
    assert.equal(old.invalid_reason, "moved in the vite switch");
    assert.ok(old.invalid_at > 0);
    const ev = archive.items.events(a.itemId);
    assert.deepEqual(ev.map((e) => e.action), ["created", "status"]);
    assert.equal(ev[1].by, "person");
    assert.deepEqual(ev[1].detail, { from: "confirmed", to: "superseded", replacement: num(r.id) });
    const now = archive.items.get(num(r.id));
    assert.equal(now.status, "confirmed");
    assert.equal(now.origin, "correction");
    assert.equal(trustOf(now), "user corrected");
    await w.settle();
    assert.ok(archive.items.get(now.id).memory_id, "the replacement reached the engine");
    assert.ok(w.ops().some((o) => o.op === "invalidate" && o.args.id === engineId && o.args.replacement_id === `filament:${r.id}`), "the old copy invalidated, naming its replacement");
    assert.ok(!w.ops().some((o) => o.op === "forget"), "nothing deleted");
    // A retired claim is not corrected: the refusal names what stands, to correct instead (M7-D67).
    assert.equal(
      (await brain.correct(a.id, { text: "The build output goes to dist/.", reason: "again", by: "owner" })).error,
      `${a.id} was replaced by ${r.id}, which stands: "The build output goes to build/."; correct ${r.id} if it is wrong too`,
    );
    assert.match((await brain.correct(r.id, { text: "The build output goes to build/.", reason: "same", by: "owner" })).error, /the new text is the old one/);
    assert.match((await brain.setItemStatus(now.id, "superseded", { by: "owner" })).error, /needs the memory that replaces it/);
    assert.match((await brain.correct("s:c_x:3", { text: "anything at all", reason: "r", by: "owner" })).error, /quote from a past session/);
    // The owner's word brings the old one back, its engine copy with it; its retirement stamps are cleared.
    const back = await brain.setItemStatus(a.itemId, "confirmed", { by: "owner" });
    assert.equal(back.ok, true);
    const again = archive.items.get(a.itemId);
    assert.equal(again.superseded_by, null);
    assert.equal(again.invalid_reason, null);
    await w.settle();
    assert.ok(w.ops().some((o) => o.op === "restore" && o.args.id === engineId));
    // Without a new text, a correction only retires.
    const gone = await brain.correct(r.id, { reason: "the build folder is gone", by: "owner" });
    assert.equal(gone.retired, true);
    assert.equal(archive.items.get(num(r.id)).status, "dismissed");
  }));

// (fails before: a model's remember was confirmed and pinned like the user's own word, it could bring back what the
// user had dismissed, and nothing told the model's confirmation apart from the user's)
test("a model's word is a note: its remember is inferred and unpinned, its confirm is a use, and it never brings back what was retired", () =>
  world({}, async (w) => {
    const { brain, archive } = w.svc;
    const tool = async (name, input) => JSON.parse(await executeMemoryTool(w.svc.scope({ role: "model", project: "p2" }), name, input));
    const m = await tool("filament_memory_remember", { text: "The CI for this repo runs on GitHub Actions.", kind: "fact" });
    assert.match(m.id, /^i\d+$/);
    const id = num(m.id);
    await w.settle();
    const it = archive.items.get(id);
    assert.equal(it.status, "inferred");
    assert.equal(it.origin, "model");
    assert.equal(trustOf(it), "assistant noted");
    const sent = w.ops().find((o) => o.op === "remember" && o.args.content === it.text);
    assert.equal(sent.args.pin, false);
    assert.equal(sent.args.veracity, "inferred");
    const found = await tool("filament_memory_search", { query: "CI GitHub Actions" });
    assert.ok(found.results.some((x) => x.id === m.id && x.trust === "assistant noted"), JSON.stringify(found));
    // Shown and ignored once, then confirmed by the model: that showing counts as a use.
    archive.injections.add({ requestId: "q1", chainId: null, kind: "turn", ids: [m.id] });
    archive.injections.markUsed("q1", 0, []);
    assert.equal(archive.injections.neverUsedCount(m.id), 1);
    const c = await tool("filament_memory_confirm", { id: m.id });
    assert.equal(c.ok, true, JSON.stringify(c));
    assert.equal(archive.items.get(id).status, "inferred", "only the user's word makes it confirmed");
    assert.equal(archive.injections.neverUsedCount(m.id), 0, "the model's confirmation is a use");
    assert.ok(archive.items.events(id).some((e) => e.action === "verified" && e.by === "model"));
    const f = await tool("filament_memory_forget", { id: m.id, reason: "moved to Buildkite" });
    assert.equal(f.ok, true);
    assert.equal(archive.items.get(id).invalid_reason, "moved to Buildkite");
    const back = await tool("filament_memory_remember", { text: it.text, kind: "fact" });
    assert.equal(back.stored, false);
    assert.equal(archive.items.get(id).status, "dismissed", "a model cannot bring it back");
    assert.equal(
      (await tool("filament_memory_correct", { id: m.id, text: "CI runs on Buildkite.", reason: "r" })).error,
      `${m.id} is retired (dismissed: moved to Buildkite): nothing of it stands; store what is true now with filament_memory_remember`,
    );
    assert.match((await tool("filament_memory_confirm", { id: m.id })).error, /only the user can bring it back/);
  }));

// (fails before: yes — a model's remember of kind permission filed an always-allow offer for a command nobody had
// approved, which the next call of that shape carried; and a model's correct of an offer gave it another command)
test("a model remembers only the kinds its tool names and never words an always-allow offer; the person and the owner remember any claim, and nothing else", () =>
  world({}, async (w) => {
    const { archive } = w.svc;
    const tool = async (name, input) => JSON.parse(await executeMemoryTool(w.svc.scope({ role: "model", project: "p2" }), name, input));
    const offers = () => archive.items.list({ kind: "permission", limit: 50 }).map((/** @type {any} */ it) => it.text);
    for (const kind of ["permission", "turn", "session", "thread", "convention", "ability:git"])
      assert.equal((await tool("filament_memory_remember", { text: "bash: git push", kind })).error, `memory: a memory is remembered as fact, rule, preference, decision or procedure, not "${kind}"`, kind);
    assert.deepEqual(offers(), []);
    const offer = archive.items.add({ projectId: "p2", kind: "permission", text: "bash: npm test", status: "inferred", importance: 0.8, origin: "learner" });
    const c = await tool("filament_memory_correct", { id: `i${offer.id}`, text: "bash: git push", reason: "the same thing" });
    assert.equal(c.error, `i${offer.id} is not a claim: it is an always-allow offer, which only the user answers`);
    assert.deepEqual([offers(), archive.items.get(offer.id).status], [["bash: npm test"], "inferred"]);
    const owner = w.svc.scope({ role: "owner", project: "p2" });
    const notClaim = `memory: a memory is remembered as rule, convention, preference, procedure, decision, fact or thread, not "permission"`;
    await assert.rejects(owner.remember("bash: git push", { kind: "permission" }), (/** @type {any} */ e) => e.message === notClaim);
    assert.match((await owner.remember("Open: pick the release date.", { kind: "thread" })).id, /^i\d+$/, "the owner opens a thread");
    const r = await adminCall(w.svc, "POST", "/memory/remember", { text: "bash: git push", kind: "permission", project: "p2" });
    assert.deepEqual([r.status, r.body.error], [400, notClaim], "the caller's to fix");
    assert.deepEqual(offers(), ["bash: npm test"]);
  }));

// (fails before: lines carried no id, and a tool took only the engine's id)
// (and fails before: yes — an earlier build's item:<n> and chain:… still named an item and past words)
test("every id a line or a search shows resolves: i<n>, e:<engine id> or the bare engine id, past words, canon; nothing else", () =>
  world({}, async (w) => {
    const { brain } = w.svc;
    const a = await brain.remember("Releases are tagged vX.Y.Z on main.", { kind: "rule", projectId: "p3", by: "owner" });
    await w.settle();
    const engineId = w.svc.archive.items.get(a.itemId).memory_id;
    const solo = await w.svc.store.remember({ content: "Imported: the docs were once on a wiki.", source: "fact", importance: 0.5, metadata: { kind: "fact" } });
    for (const ref of [a.id, `e:${engineId}`, engineId]) {
      const r = brain.resolveRef(ref);
      assert.equal(r.type, "item", ref);
      assert.equal(r.item.id, a.itemId, ref);
    }
    assert.deepEqual(brain.resolveRef(`e:${solo.id}`), { type: "engine", engineId: solo.id });
    assert.equal(brain.resolveRef("s:c_abc:3").type, "words");
    assert.equal(brain.resolveRef("chain:c_abc:3").type, "engine", "not past words: an engine id no row has");
    assert.equal(brain.resolveRef(`item:${a.itemId}`).type, "engine", "not the item");
    assert.equal(brain.resolveRef("canon:identity/name").type, "engine", "no id form of its own: the facts about the user are memories");
    assert.equal(brain.resolveRef("i987654").type, "none");
    assert.equal(brain.resolveRef("").type, "none");
    // An engine-only row corrected by the model: adopted as an imported item, superseded, its own row invalidated.
    const r = await brain.correct(`e:${solo.id}`, { text: "The docs live in the repo under docs/.", reason: "the wiki was retired", by: "model" });
    assert.equal(r.ok, true, JSON.stringify(r));
    const [adopted] = w.svc.archive.items.byMemoryId(solo.id);
    assert.equal(adopted.origin, "import");
    assert.equal(adopted.status, "superseded");
    await w.settle();
    assert.ok(w.ops().some((o) => o.op === "invalidate" && o.args.id === solo.id));
    const now = w.svc.archive.items.get(num(r.id));
    assert.equal(now.status, "inferred", "a model's replacement is its note until the user confirms it");
    assert.equal(now.origin, "model");
  }));

test("trust labels say how a memory is known, from the model's side", () => {
  const cases = [
    [{ origin: "person", status: "confirmed" }, "user said"],
    [{ origin: "owner", status: "confirmed" }, "user said"],
    [{ origin: "correction", status: "inferred" }, "user corrected"],
    [{ origin: "learner", status: "confirmed" }, "user confirmed"],
    [{ origin: "capture", status: "inferred" }, "user's words"],
    [{ origin: "model", status: "inferred" }, "assistant noted"],
    [{ origin: "import", status: "inferred" }, "imported"],
    [{ origin: "learner", status: "inferred" }, "inferred"],
    [{ origin: null, status: "inferred" }, "inferred"],
  ];
  for (const [it, label] of cases) assert.equal(trustOf(it), label, JSON.stringify(it));
});

// (fails before: one echoed line marked the whole injection used, crediting every neighbour; and the fade counted it)
test("use is judged per memory: an echoed line counts, its neighbours in the same injection do not", () =>
  world({}, async (w) => {
    const { brain, archive } = w.svc;
    await w.session("seed").remember("the release train leaves every Thursday at noon");
    await w.session("seed2").remember("the release notes are written in docs/releases.md");
    const s = w.session("s");
    const { prep } = await s.send("tell me about the release train and the release notes", { reply: "The release train leaves every Thursday at noon, so plan for that." });
    const rows = archive.db.prepare("SELECT j.memory_id AS id, j.used AS used FROM injection_ids j JOIN injections i ON i.id = j.injection_id WHERE i.chain_id = ?").all(prep.chain);
    const train = archive.items.list({}).find((x) => /Thursday/.test(x.text));
    const notes = archive.items.list({}).find((x) => /releases\.md/.test(x.text));
    const used = Object.fromEntries(rows.map((r) => [r.id, r.used]));
    assert.equal(used[`i${train.id}`], 1, JSON.stringify(rows));
    assert.equal(used[`i${notes.id}`], 0, JSON.stringify(rows));
    assert.equal(brain.archive.injections.neverUsedCount(`i${notes.id}`), 1);
    assert.equal(brain.archive.injections.neverUsedCount(`i${train.id}`), 0);
  }));

// (fails before: canon was rebuilt only at the next promotion, so a retired fact rode every briefing until then)
test("the dossier shows a line only while every claim it cites stands; a session's line stays; what came since follows it", () =>
  world({}, async (w) => {
    const { brain, archive } = w.svc;
    const { sit } = await w.session("s").send("hello");
    const projectId = sit.project.id;
    const a = await brain.remember("The build output goes to out/dist.", { kind: "fact", projectId, by: "owner" });
    const b = await brain.remember("The API listens on port 8080 locally.", { kind: "fact", projectId, by: "owner" });
    const c = await brain.remember("The API listens on port 8080 in docker too.", { kind: "fact", projectId, by: "owner" });
    archive.dossiers.add({
      projectId,
      sections: [
        { title: "Facts", lines: [{ text: "The build output goes to out/dist.", cites: [`i${a.itemId}`] }, { text: "The API listens on port 8080, locally and in docker.", cites: [`i${b.itemId}`, `i${c.itemId}`] }] },
        { title: "Current work and open threads", lines: [{ text: "The parser rewrite is under way.", cites: ["s:abc"] }] },
      ],
      cites: [a.itemId, b.itemId, c.itemId],
      basis: "x",
    });
    const whole = brain.dossierOf(projectId);
    assert.equal(whole?.lines, 3);
    assert.deepEqual(whole?.cites, [`i${a.itemId}`, `i${b.itemId}`, `i${c.itemId}`]);
    await brain.forget(a.id, { by: "owner" });
    await brain.forget(b.id, { by: "owner" });
    const later = await brain.remember("Deploys need two approvals.", { kind: "decision", projectId, by: "owner" });
    const d = brain.dossierOf(projectId);
    assert.equal(d?.hidden, 2, "a line goes when any claim it cites is retired (M4-D10)");
    assert.deepEqual(d?.text.split("\n").slice(1), [
      "Current work and open threads:",
      "- The parser rewrite is under way. [s:abc]",
      `New since v1:`,
      `- [i${later.itemId} decision · user said · ${dateOf(archive.items.get(later.itemId).created_at)}] Deploys need two approvals.`,
    ]);
    assert.equal(brain.dossierOf("no-such-project"), null);
  }));

// (fails before: the dashboard set the archive's status alone — no history, the engine copy left valid, no errata)
test("the owner's word on the dashboard goes through the brain: the history and the engine copy move with it", () =>
  world({}, async (w) => {
    const a = await w.svc.brain.remember("The cache lives in redis on port 6380.", { kind: "fact", projectId: "p11", by: "person" });
    await w.settle();
    const engineId = w.svc.archive.items.get(a.itemId).memory_id;
    assert.equal((await w.svc.scope({ role: "owner" }).setStatus(a.itemId, "dismissed")).ok, true);
    const it = w.svc.archive.items.get(a.itemId);
    assert.equal(it.invalid_reason, "set in the console");
    assert.equal(w.svc.archive.items.events(a.itemId).at(-1).by, "owner");
    await w.settle();
    assert.ok(w.ops().some((o) => o.op === "invalidate" && o.args.id === engineId), "the engine copy invalidated");
  }));

// (fails before: retiring an engine row whose text an item already held retired the item and left the row valid
// beside it, so recall could still serve it)
test("retiring an engine row whose text an item already holds retires that row too, by its own id", () =>
  world({}, async (w) => {
    const { brain, archive, store } = w.svc;
    const ids = [];
    for (const [n, text] of [[12, "The deploy target is fly.io."], [13, "The docs site builds with mkdocs."]]) {
      const a = await brain.remember(text, { kind: "fact", projectId: `p${n}`, by: "person" });
      await w.settle();
      const twin = await store.remember({ content: text.toLowerCase().replace(/\.$/, ""), source: "fact", importance: 0.5, metadata: { kind: "fact", project: `p${n}` } });
      assert.notEqual(twin.id, archive.items.get(a.itemId).memory_id, "a row of its own");
      ids.push([a, twin.id]);
    }
    const [[a, rowA], [b, rowB]] = ids;
    assert.equal((await brain.forget(`e:${rowA}`, { reason: "we moved to render", by: "owner" })).ok, true);
    assert.equal(archive.items.get(a.itemId).status, "dismissed", "the item that holds the text");
    await w.settle();
    assert.ok(w.ops().some((o) => o.op === "invalidate" && o.args.id === rowA), "forget: the row itself");
    const r = await brain.correct(`e:${rowB}`, { text: "The docs site builds with vitepress.", reason: "switched", by: "person" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(archive.items.get(b.itemId).status, "superseded");
    await w.settle();
    assert.ok(w.ops().some((o) => o.op === "invalidate" && o.args.id === rowB && o.args.replacement_id === `filament:${r.id}`), "correct: the row itself, naming the replacement");
  }));

// (fails before: a session that was shown a value kept working from it after the value was corrected elsewhere)
test("errata: sessions shown a memory in the last 14 days hear once that it was corrected; the correcting session and older ones do not", () =>
  world({}, async (w) => {
    const { archive } = w.svc;
    await w.session("a").remember("the staging server is in region eu-west-2");
    const s = w.session("s");
    const first = await s.send("which region is the staging server in?");
    assert.ok(first.seen.includes("eu-west-2"));
    const old = w.session("old");
    const o1 = await old.send("which region is the staging server in?");
    archive.db.prepare("UPDATE injections SET created_at = ? WHERE chain_id = ?").run(Date.now() - 15 * 86400000, o1.prep.chain);
    const b = w.session("b");
    const b1 = await b.correct("no, the staging server is in region eu-central-1 now.", { of: "eu-west-2", claim: "the staging server is in region eu-central-1 now" });
    const errata = (chain) => JSON.parse(archive.getChain(chain).meta_json || "{}").errata || [];
    assert.equal(errata(first.prep.chain).length, 1);
    assert.equal(errata(o1.prep.chain).length, 0, "shown more than 14 days ago");
    assert.equal(errata(b1.prep.chain).length, 0, "the session that corrected it was there");
    const next = await s.send("ok, and what else runs on the staging server?");
    const newest = next.r.body.messages.at(-1).content;
    assert.match(newest, /Memory correction: \[i\d+\] "[^"]*eu-west-2[^"]*" no longer holds — now \[i\d+\] "[^"]*eu-central-1[^"]*" \(the user, \d{4}-\d\d-\d\d\)\./);
    assert.ok(next.prep.notes.some((n) => /corrected since/.test(n)), next.prep.notes.join(" | "));
    assert.equal(errata(first.prep.chain).length, 0, "taken");
    const after = await s.send("and which database does it use?");
    assert.ok(!/Memory correction/.test(after.r.body.messages.at(-1).content), "said once");
  }));

// (fails before: yes — with the session's per-turn block off no lookup ran, and the errata it says went unsaid: the
// session kept working from a value corrected since)
test("errata are said with the session's per-turn block off: the block holds them alone, and re-attaches as it was", () =>
  world({}, async (w) => {
    await w.session("a").remember("the staging server is in region eu-west-2");
    const s = w.session("s");
    assert.ok((await s.send("which region is the staging server in?")).seen.includes("eu-west-2"));
    await w.session("b").correct("no, the staging server is in region eu-central-1 now.", { of: "eu-west-2", claim: "the staging server is in region eu-central-1 now" });
    const off = { memory: { enabled: true, briefing: true, turnBlock: false, tools: true, turnTokens: 300, minScore: 0.2, learn: true, index: true }, privacy: { learn: true, index: true } };
    const next = await s.send("ok, and what else runs on the staging server?", { settings: off });
    const newest = next.r.body.messages.at(-1).content;
    assert.match(newest, /\n\n<filament-memory kind="turn">\nMemory correction: \[i\d+\] "[^"]*eu-west-2[^"]*" no longer holds — now \[i\d+\] "[^"]*eu-central-1[^"]*" \(the user, \d{4}-\d\d-\d\d\)\.\n<\/filament-memory>$/);
    assert.ok(next.prep.notes.some((n) => /no per-turn recall — the session turned it off/.test(n)), next.prep.notes.join(" | "));
    assert.ok(next.prep.notes.some((n) => /corrected since/.test(n)), next.prep.notes.join(" | "));
    // (fails before: no — a guard the mutation pass asked for: a block said now is no block re-attached)
    assert.ok(!next.prep.notes.some((n) => /re-attached/.test(n)), next.prep.notes.join(" | "));
    const after = await s.send("and which database does it use?", { settings: off });
    assert.equal(after.r.body.messages.at(-3).content, newest, "the block re-attaches byte for byte");
    assert.ok(!/Memory correction/.test(after.r.body.messages.at(-1).content), "said once");
  }));

// (fails before: no — a guard the mutation pass asked for: a message mid-history takes no errata, as it takes no
// lookup: its bytes are in the provider's cache)
test("with the per-turn block off, errata wait for a person's message at the request's end: one mid-history takes none", () =>
  world({}, async (w) => {
    await w.session("a").remember("the staging server is in region eu-west-2");
    const first = await w.session("s").send("which region is the staging server in?");
    await w.session("b").correct("no, the staging server is in region eu-central-1 now.", { of: "eu-west-2", claim: "the staging server is in region eu-central-1 now" });
    const errata = () => JSON.parse(w.svc.archive.getChain(first.prep.chain).meta_json || "{}").errata || [];
    assert.equal(errata().length, 1);
    // An OpenAI client's request with a note of the client's after the person's message.
    const ask = "ok, and what else runs on the staging server?";
    const system = "You are Claude Code.\n<env>\nWorking directory: C:\\evals\nIs a git repo: yes\n</env>";
    const r = { format: "openai", body: { model: "claude-x", messages: [{ role: "system", content: system }, { role: "user", content: ask }, { role: "system", content: "The client's note after the message." }] }, headers: first.r.headers, model: "claude-x" };
    const sit = w.svc.situate(r);
    sit.settings = { memory: { enabled: true, briefing: true, turnBlock: false, tools: true, turnTokens: 300, minScore: 0.2, learn: true, index: true }, privacy: { learn: true, index: true } };
    const prep = await w.svc.prepare(sit, { requestId: "mid-1", upstream: "openai" });
    assert.equal(prep.chain, first.prep.chain);
    assert.equal(r.body.messages[1].content, ask, "nothing is added to a message mid-history");
    assert.equal(errata().length, 1, "the errata wait");
  }));

// (fails before: no — a guard the mutation pass asked for: a try that found nothing counts, and a fork keeps the count)
test("a briefing that found nothing on three of a session's turns is not tried again, nor on a fork of it: what is learned later waits for the next session", () =>
  world({}, async (w) => {
    // With the memory tools off, a project nothing is known about gives a briefing nothing to say.
    const noTools = { memory: { enabled: true, briefing: true, turnBlock: true, tools: false, turnTokens: 300, minScore: 0.2, learn: true, index: true }, privacy: { learn: true, index: true } };
    const briefed = (/** @type {any} */ sent) => String(sent.r.body.system).includes('kind="briefing"');
    const s = w.session("s");
    for (const t of ["what does the tray watchdog restart?", "and how often does it check?", "where does it log?"]) assert.ok(!briefed(await s.send(t, { settings: noTools })));
    await w.session("a").remember("the tray watchdog restarts the proxy every 30 seconds");
    const fourth = await s.send("why did Filament restart twice?", { settings: noTools });
    assert.ok(!briefed(fourth), "the system prompt stays as the session's turns had it");
    const fork = w.svc.archive.forkChain(fourth.prep.chain, { atTurn: 4, key: "h:fork-of-s" });
    assert.ok(!briefed(await w.session("f").send("and where does the fork stand?", { headers: { "x-filament-chain": fork.id }, settings: noTools })), "nor its fork's");
    assert.ok(briefed(await w.session("t").send("what restarts the proxy?", { settings: noTools })), "a new session gets one");
  }));

// (fails before: an item dismissed on the dashboard left its engine copy valid, and recall served the copy)
test("an engine copy whose item was retired is not served, even where the engine still holds it valid", () =>
  world({}, async (w) => {
    const { brain, archive } = w.svc;
    const a = await brain.remember("The mobile app is built with Flutter 3.24.", { kind: "fact", projectId: "p8", by: "owner" });
    await w.settle();
    archive.items.setStatus(a.itemId, "dismissed"); // the archive alone, as a dashboard before M1 did
    const r = await brain.retrieve({ query: "mobile app Flutter", projectId: "p8", mode: "search" });
    assert.ok(!r.items.some((x) => /Flutter/.test(x.text)), JSON.stringify(r.items));
    assert.ok(!w.ops().some((o) => o.op === "invalidate"), "the engine row itself was never touched");
  }));

// (fails before: the old forget deleted the copy; bringing the item back then tied it to nothing)
test("an item retired before M1, whose engine copy was deleted, comes back with a fresh copy", () =>
  world({}, async (w) => {
    const { brain, archive } = w.svc;
    const text = "The staging certificate renews on the 1st of every month.";
    const a = await brain.remember(text, { kind: "fact", projectId: "p9", by: "person" });
    await w.settle();
    const was = archive.items.get(a.itemId).memory_id;
    await w.svc.store.forget(was); // what forget did before M1
    archive.items.setStatus(a.itemId, "dismissed");
    const b = await brain.remember(text, { kind: "fact", projectId: "p9", by: "person" });
    assert.equal(b.restored, true);
    await w.settle();
    const now = archive.items.get(a.itemId);
    assert.equal(now.status, "confirmed");
    assert.ok(now.memory_id && now.memory_id !== was, `a fresh copy (${now.memory_id})`);
  }));

// (fails before: "remember that …" of a text the user had dismissed made a second engine copy beside the first)
test("the person's remember of a retired text restores it and its own engine copy", () =>
  world({}, async (w) => {
    const { brain, archive } = w.svc;
    await w.session("a").remember("the deploy key lives in vault/ops");
    const it = archive.items.list({}).find((x) => /vault\/ops/.test(x.text));
    assert.ok(it?.memory_id);
    await brain.forget(`i${it.id}`, { by: "owner" });
    const { item } = await w.session("b").remember("the deploy key lives in vault/ops");
    assert.equal(item.restored, true, JSON.stringify(item));
    await w.settle();
    assert.equal(archive.items.get(it.id).status, "confirmed");
    assert.ok(w.ops().some((o) => o.op === "restore" && o.args.id === it.memory_id));
    assert.equal(w.ops().filter((o) => o.op === "remember" && o.args.content === it.text).length, 1, "one engine copy");
  }));

