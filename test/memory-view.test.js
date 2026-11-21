// @ts-check
// Memory as the owner sees it and acts on it (HarnessV3-Memory M6-1..M6-3): what memory did for one turn — what the
// turn's requests were shown and whether the reply used it, the reminders said at its calls and whether one was
// followed, the claims it filed with what they replaced, memory's open questions — read back from the archive alone;
// and the owner's word from a page (a correction scoped to the open session, the models memory works with) and the
// person's in the chat (@mem confirm, @mem correct).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryCommand } from "../src/app/commands/mem.js";
import { world, adminCall } from "./fixtures/memory-world.mjs";
import { EFFORT_LEVELS } from "../src/core/schema.js";

const MD14 = "no, don't run npm test directly inside Claude Code; run it as env -u CLAUDECODE npm test.";
/** MD14 as the person's rule: what the agent keeps of it, or the person's @mem rule (the memory plan's d3). */
const MD14_RULE = "don't run npm test directly inside Claude Code; run it as env -u CLAUDECODE npm test";

// ---- M6-2: a reminder followed ----
test("a pitfall's reminder is followed when a later call of the session holds its right way: once a firing, never as evidence", async () => {
  await world({}, async (w) => {
    const { sit } = await w.session("a").remember(MD14_RULE, { kind: "rule" });
    const projectId = sit.project.id;
    const call = (/** @type {string} */ chainId, /** @type {string} */ command) => w.svc.brain.pitfallsFor({ projectId, chainId, turnId: 7, tool: "Bash", input: { command } });
    const [hit] = call("b", "npm test");
    const id = Number(hit.id.slice(1));
    const acts = (/** @type {string} */ action) => w.svc.archive.items.events(id).filter((/** @type {any} */ e) => e.action === action);
    const before = w.svc.archive.items.eventCounts([id]).get(id);
    assert.deepEqual(call("b", "env -u CLAUDECODE npm test"), []);
    assert.deepEqual(acts("followed").map((/** @type {any} */ e) => [e.by, e.detail]), [["filament", { chain: "b", turn: 7, shape: "npm test", unless: "env -u CLAUDECODE" }]]);
    call("b", "env -u CLAUDECODE npm test -- --grep slow");
    assert.equal(acts("followed").length, 1, "followed once: nothing fired since");
    call("c", "env -u CLAUDECODE npm test");
    assert.equal(acts("followed").length, 1, "the right way in a session it never fired in follows nothing");
    call("d", "npm test");
    call("d", "npm test -- --watch");
    call("d", "env -u CLAUDECODE npm test");
    assert.deepEqual(acts("followed").map((/** @type {any} */ e) => e.detail.chain), ["b", "d"], "two firings, then the right way: one followed");
    call("d", "npm test");
    call("d", "env -u CLAUDECODE npm test");
    assert.equal(acts("followed").length, 3, "fired again, followed again");
    assert.deepEqual(w.svc.archive.items.eventCounts([id]).get(id), before, "a followed reminder is no evidence for its claim (M6-D4)");
    // A trigger with no right way is never followed: nothing in a call says it was.
    const push = (await w.svc.brain.remember("never run git push --force", { kind: "rule", projectId, by: "person" })).itemId;
    call("e", "git push --force");
    call("e", "git push origin main");
    assert.equal(w.svc.archive.items.events(push).filter((/** @type {any} */ e) => e.action === "followed").length, 0);
    // A firing in one session is not one in another: the right way there follows nothing.
    call("f", "npm test");
    call("g", "env -u CLAUDECODE npm test");
    assert.deepEqual(acts("followed").map((/** @type {any} */ e) => e.detail.chain), ["b", "d", "d"]);
    // Two triggers on one shape, apart by their words: the right way of the one that never fired follows nothing.
    const flags = (await w.svc.brain.remember("the suite's own flags want the env prefix as well", { kind: "rule", projectId, by: "person" })).itemId;
    w.svc.archive.triggers.set(flags, "seen", [
      { tool: "bash", shape: "npm test", args: "--grep", unless: "env -u CLAUDECODE" },
      { tool: "bash", shape: "npm test", args: "--watch", unless: "env -u CLAUDECODE" },
    ]);
    call("h", "npm test --grep slow");
    call("h", "env -u CLAUDECODE npm test --watch");
    const flagActs = w.svc.archive.items.events(flags).filter((/** @type {any} */ e) => e.action === "fired" || e.action === "followed");
    assert.deepEqual(flagActs.map((/** @type {any} */ e) => [e.action, e.detail.args]), [["fired", "--grep"]]);
  });
});

// ---- M7-D63: a rule kept without a reminder ----
// (fails before: yes — the live leg's sub-agent ran `env -u CLAUDECODE npm test` from its briefing and the rule's history read only "created")
test("M7-D63: the right way taken where the rule never fired is kept — once a conversation and trigger, only while the rule is in force; missed after, it fires, and the right way then is followed; never evidence", async () => {
  await world({}, async (w) => {
    const { sit } = await w.session("a").remember(MD14_RULE, { kind: "rule" });
    const projectId = sit.project.id;
    const call = (/** @type {string} */ chainId, /** @type {string} */ command, conversation = /** @type {string | null} */ (null)) => w.svc.brain.pitfallsFor({ projectId, chainId, turnId: 7, conversation, tool: "Bash", input: { command } });
    const [hit] = call("z", "npm test");
    const id = Number(hit.id.slice(1));
    const acts = (/** @type {string} */ action) => w.svc.archive.items.events(id).filter((/** @type {any} */ e) => e.action === action);
    const before = w.svc.archive.items.eventCounts([id]).get(id);
    assert.deepEqual(call("b", "env -u CLAUDECODE npm test"), [], "the right way is told nothing");
    assert.deepEqual(acts("kept").map((/** @type {any} */ e) => [e.by, e.detail]), [["filament", { chain: "b", turn: 7, shape: "npm test", unless: "env -u CLAUDECODE" }]]);
    call("b", "env -u CLAUDECODE npm test -- --grep slow");
    assert.equal(acts("kept").length, 1, "kept once a conversation");
    call("b", "env -u CLAUDECODE npm test", "sa_1");
    assert.deepEqual(acts("kept").map((/** @type {any} */ e) => e.detail.conversation ?? null), [null, "sa_1"], "a sub-agent's conversation in the session is its own");
    assert.equal(call("b", "npm test").length, 1, "kept, then missed: it fires");
    call("b", "env -u CLAUDECODE npm test");
    assert.deepEqual([acts("kept").length, acts("followed").map((/** @type {any} */ e) => e.detail.chain)], [2, ["b"]], "after a firing the right way is followed, not kept");
    assert.deepEqual(w.svc.archive.items.eventCounts([id]).get(id), before, "kept is no evidence for its claim (M6-D4)");
    // A rule not in force — learned once, said by no other session — would not fire, so its right way keeps nothing.
    const learned = (await w.svc.brain.fileLearned({ projectId, chainId: "l1", kind: "rule", text: "never run pnpm test bare here; run it as env -u CLAUDECODE pnpm test", importance: 0.7 })).id;
    assert.deepEqual(w.svc.archive.triggers.of(learned).map((/** @type {any} */ t) => [t.shape, t.unless]), [["pnpm test", "env -u CLAUDECODE"]]);
    call("k", "env -u CLAUDECODE pnpm test");
    assert.deepEqual(w.svc.archive.items.events(learned).filter((/** @type {any} */ e) => e.action === "kept"), [], "a trigger out of force keeps nothing");
    // The card counts it, by trigger and in all.
    const card = /** @type {any} */ (w.svc.brain.card(`i${id}`));
    assert.deepEqual([card.triggers.map((/** @type {any} */ t) => [t.fired, t.followed, t.kept]), card.kept], [[[2, 1, 2]], 2]);
  });
});

// ---- M6-1: the turn's memory ----
test("a turn's memory: the claims it was shown by layer, the reminders at its calls and their following, what it filed and replaced, the open questions", async () => {
  await world({}, async (w) => {
    const a = w.session("a");
    const first = await a.remember("we use pnpm for package installs here");
    const projectId = first.sit.project.id;
    const chainA = first.prep.chain;
    const pnpm = w.svc.archive.items.ofTurn(chainA, first.prep.turn)[0];
    assert.match(pnpm?.text ?? "", /pnpm/);
    const second = await a.correct("no, we switched to bun for package installs.", { of: "pnpm", claim: "we switched to bun for package installs" });
    await a.remember(MD14_RULE, { kind: "rule" });
    // Turn 2 filed a correction that replaced turn 1's claim.
    const t2 = w.svc.turnMemory(chainA, 2);
    assert.ok(t2);
    const bun = t2.said.find((/** @type {any} */ c) => /bun/.test(c.text));
    assert.ok(bun, JSON.stringify(t2.said));
    assert.deepEqual([bun.kind, bun.status, bun.trust], ["fact", "confirmed", "user corrected"], "a correction is the user's word by its origin, of the kind it corrects");
    assert.deepEqual(bun.replaces, [{ id: `i${pnpm.id}`, text: pnpm.text, status: "superseded" }]);
    assert.equal(t2.turn, 2);
    assert.equal(t2.session, chainA);
    assert.equal(second.prep.turn != null, true);
    // Turn 3's rule is a pitfall: its card carries the trigger.
    const t3 = w.svc.turnMemory(chainA, 3);
    const rule = t3.said.find((/** @type {any} */ c) => /CLAUDECODE/.test(c.text));
    assert.deepEqual(rule.triggers, [{ shape: "npm test", unless: "env -u CLAUDECODE", source: "words", fired: 0, followed: 0, kept: 0 }]);
    assert.equal(rule.backed, 1);
    assert.ok(rule.sure > 0.35, String(rule.sure));

    // Another session: a briefing, then a tool loop that walks into the pitfall and then follows it.
    const loop = w.claudeCode("b", "run the tests in this repo");
    const { prep } = await loop.start();
    await loop.ran("Bash", { command: "npm test" }, { error: "exit code 1" });
    await loop.ran("Bash", { command: "env -u CLAUDECODE npm test" });
    const ruleId = Number(rule.id.slice(1));
    w.svc.archive.inbox.add({ projectId, kind: "retire", key: "test:retire", itemIds: [ruleId], proposal: { id: ruleId }, reason: "asked in the test" });
    const t = w.svc.turnMemory(prep.chain, 1);
    assert.ok(t);
    assert.equal(t.project, projectId);
    assert.equal(t.briefing?.turn, 1, JSON.stringify(t.briefing));
    assert.ok(t.briefing.count >= 1 && t.briefing.tokens > 0);
    const shownRule = t.shown.find((/** @type {any} */ s) => s.id === rule.id);
    assert.ok(shownRule, JSON.stringify(t.shown.map((/** @type {any} */ s) => [s.id, s.layers])));
    assert.deepEqual(shownRule.layers, ["briefing", "pitfall"], "the briefing carried it, then the leg's result");
    assert.equal(shownRule.used, null, "no reply judged it yet");
    assert.ok(!t.shown.some((/** @type {any} */ s) => s.id === `i${pnpm.id}`), "a retired claim is shown nowhere");
    assert.equal(t.count, t.shown.length);
    assert.ok(t.tokens >= t.briefing.tokens);
    assert.equal(t.reminders.length, 1);
    const [r] = t.reminders;
    assert.deepEqual([r.kind, r.shape, r.unless, r.times, r.followed, r.claim.id], ["pitfall", "npm test", "env -u CLAUDECODE", 1, true, rule.id]);
    assert.deepEqual(r.claim.triggers, [{ shape: "npm test", unless: "env -u CLAUDECODE", source: "words", fired: 1, followed: 1, kept: 0 }]);
    assert.deepEqual([r.claim.fired, r.claim.followed], [1, 1]);
    assert.deepEqual(r.claim.flags, ["in question: the user is asked to retire it"]);
    assert.equal(t.asks.count, 1);
    assert.deepEqual(t.asks.first.map((/** @type {any} */ q) => [q.kind, q.claims.map((/** @type {any} */ c) => c.id)]), [["retire", [rule.id]]]);
    assert.deepEqual(t.said, [], "the loop filed nothing");

    // A judged reply: what it echoed is used, the rest is not.
    const t1 = w.svc.turnMemory(chainA, 1);
    assert.ok(t1.shown.every((/** @type {any} */ s) => s.used === false), JSON.stringify(t1.shown));
    // Words of a past session show where they are from; an engine row with no claim, as itself.
    w.svc.archive.injections.add({ requestId: "words-1", chainId: prep.chain, turnId: prep.turn, kind: "turn", ids: [`s:${chainA}:1`, "e:loose"], tokens: 9 });
    const words = w.svc.turnMemory(prep.chain, 1).shown.filter((/** @type {any} */ s) => s.kind === "words" || s.kind === "engine");
    assert.deepEqual(words.map((/** @type {any} */ s) => [s.id, s.kind, s.session ?? null, s.turn ?? null, s.layers, s.used]), [
      [`s:${chainA}:1`, "words", chainA, 1, ["turn"], null],
      ["e:loose", "engine", null, null, ["turn"], null],
    ]);
    // A turn the session does not hold, and a session that does not exist.
    assert.equal(w.svc.turnMemory(prep.chain, 9), null);
    assert.equal(w.svc.turnMemory("nope", 1), null);
  });
});

test("the turn's memory route: the turn by its number, 404 for one the session lacks, 400 for no number", async () => {
  await world({}, async (w) => {
    const { prep } = await w.session("a").send(MD14);
    const ok = await adminCall(w.svc, "GET", `/memory/sessions/${prep.chain}/turns/1/memory`);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, JSON.parse(JSON.stringify(w.svc.turnMemory(prep.chain, 1))));
    assert.equal((await adminCall(w.svc, "GET", `/memory/sessions/${prep.chain}/turns/2/memory`)).status, 404);
    assert.equal((await adminCall(w.svc, "GET", `/memory/sessions/nope/turns/1/memory`)).status, 404);
    assert.equal((await adminCall(w.svc, "GET", `/memory/sessions/${prep.chain}/turns/0/memory`)).status, 400);
    assert.equal((await adminCall(w.svc, "GET", `/memory/sessions/${prep.chain}/turns/x/memory`)).status, 400);
  });
});

test("a turn's memory reads its own turn alone: each layer once, used when any reply used it, its own firings and filings, the latest briefing", async () => {
  await world({}, async (w) => {
    // Another session first, so a turn's row id is not its number.
    const z = await w.session("z").send("hello there");
    w.svc.archive.setTitle(z.prep.chain, "Setting up the repo");
    const a = w.session("a");
    const one = await a.send("hello");
    const two = await a.send("hello again");
    const three = await a.send("and once more");
    const chain = one.prep.chain;
    const projectId = one.sit.project.id;
    const [t1, t2, t3] = [one.prep.turn, two.prep.turn, three.prep.turn];
    assert.notEqual(t2, 2, "the turn's row id differs from its number");
    const rule = async (/** @type {string} */ text, /** @type {any} */ o = {}) => (await w.svc.brain.remember(text, { kind: "rule", projectId, by: "person", ...o })).itemId;
    const r1 = await rule("the test suite wants its environment prefix");
    const r2 = await rule("pushing wants a review first");
    const r3 = await rule("the api module is half rewritten");
    const ref = (/** @type {number} */ id) => `i${id}`;
    const inj = w.svc.archive.injections;
    inj.add({ requestId: "q1", chainId: chain, turnId: t2, kind: "turn", ids: [ref(r1), `s:${z.prep.chain}:1`], tokens: 4 });
    inj.add({ requestId: "q2", chainId: chain, turnId: t2, kind: "turn", ids: [ref(r1)], tokens: 3 });
    inj.add({ requestId: "q2", chainId: chain, turnId: t2, kind: "erratum", ids: [ref(r2)], tokens: 2 });
    inj.add({ requestId: "q3", chainId: chain, turnId: t3, kind: "turn", ids: [ref(r3)], tokens: 5 });
    inj.markUsed("q1", true, [ref(r1)]);
    inj.markUsed("q2", false, []);
    inj.add({ requestId: "b1", chainId: chain, turnId: t1, kind: "briefing", ids: [ref(r1)], tokens: 6 });
    inj.add({ requestId: "b2", chainId: chain, turnId: t2, kind: "briefing", ids: [ref(r1), ref(r2)], tokens: 7 });
    // What turn 2 and turn 3 filed.
    const filed2 = await rule("deploys go out on tuesdays", { chainId: chain, turnId: t2 });
    const filed3 = await rule("the staging box is retired", { chainId: chain, turnId: t3 });
    // Reminders: twice on one trigger, once on its sibling (then followed), one followed only before it fired, a thread,
    // and one on turn 3.
    w.svc.archive.triggers.set(r1, "seen", [
      { tool: "bash", shape: "npm test", args: "", unless: "env -u CLAUDECODE" },
      { tool: "bash", shape: "npm test", args: "--watch", unless: "env -u CLAUDECODE" },
    ]);
    const note = (/** @type {number} */ id, /** @type {string} */ action, /** @type {any} */ detail) => w.svc.archive.items.note(id, action, { by: "filament", detail: { chain, ...detail } });
    const UNLESS = "env -u CLAUDECODE";
    note(r1, "fired", { turn: t2, shape: "npm test", unless: UNLESS });
    note(r1, "fired", { turn: t2, shape: "npm test", unless: UNLESS });
    note(r1, "fired", { turn: t2, shape: "npm test", args: "--watch", unless: UNLESS });
    note(r1, "followed", { turn: t2, shape: "npm test", args: "--watch", unless: UNLESS });
    note(r2, "followed", { turn: t2, shape: "git push", unless: "gh pr create" });
    note(r2, "fired", { turn: t2, shape: "git push", unless: "gh pr create" });
    note(r3, "fired", { turn: t2, file: "src/api.js" });
    note(r1, "fired", { turn: t3, shape: "npm run build" });

    const m = w.svc.turnMemory(chain, 2);
    const mine = new Set([ref(r1), ref(r2), ref(r3)]);
    assert.deepEqual(
      m.shown.filter((/** @type {any} */ s) => mine.has(s.id)).map((/** @type {any} */ s) => [s.id, s.layers, s.used]),
      [
        [ref(r1), ["turn", "briefing"], true],
        [ref(r2), ["erratum", "briefing"], false],
      ],
      "r1 shown twice in one layer is one layer, used though the second reply did not; the briefing built on turn 2 rides it; r3 was turn 3's",
    );
    const quoted = m.shown.find((/** @type {any} */ s) => s.kind === "words");
    assert.deepEqual([quoted?.id, quoted?.title, quoted?.used], [`s:${z.prep.chain}:1`, "Setting up the repo", false]);
    assert.deepEqual(m.briefing, { turn: 2, count: 2, tokens: 7 }, "the latest briefing, its turn by number");
    assert.deepEqual(m.said.map((/** @type {any} */ c) => c.id), [ref(filed2)]);
    assert.deepEqual(w.svc.turnMemory(chain, 3).said.map((/** @type {any} */ c) => c.id), [ref(filed3)]);
    assert.deepEqual(
      m.reminders.map((/** @type {any} */ r) => [r.claim.id, r.kind, r.shape ?? r.file, r.args ?? "", r.times, r.followed ?? null]),
      [
        [ref(r1), "pitfall", "npm test", "", 2, false],
        [ref(r1), "pitfall", "npm test", "--watch", 1, true],
        [ref(r2), "pitfall", "git push", "", 1, false],
        [ref(r3), "thread", "src/api.js", "", 1, null],
      ],
    );
    const card = m.reminders[0].claim;
    assert.deepEqual(card.triggers, [
      { shape: "npm test", unless: UNLESS, source: "seen", fired: 2, followed: 0, kept: 0 },
      { shape: "npm test", args: "--watch", unless: UNLESS, source: "seen", fired: 1, followed: 1, kept: 0 },
    ]);
    assert.deepEqual([card.fired, card.followed], [4, 1], "the claim's totals hold every trigger's, turn 3's too");
  });
});

// ---- M6-3: the owner's word from a page, the person's in the chat ----
test("the owner corrects a claim from a page: the new words replace it, scoped to the open session, whose errata spare it", async () => {
  await world({}, async (w) => {
    const { sit } = await w.session("a").remember("we use pnpm for package installs here");
    const b = await w.session("b").send("hello");
    const c = await w.session("c").send("hello");
    const pnpm = w.svc.archive.items.list({}).find((/** @type {any} */ it) => /pnpm/.test(it.text));
    // Sessions b and c were shown it.
    for (const s of [b, c]) w.svc.archive.injections.add({ requestId: `shown-${s.prep.chain}`, chainId: s.prep.chain, turnId: s.prep.turn, kind: "turn", ids: [`i${pnpm.id}`], tokens: 12 });
    const route = (/** @type {string} */ id, /** @type {any} */ body) => adminCall(w.svc, "POST", `/memory/items/${id}/correct`, body);
    assert.equal((await route("999", { text: "x" })).status, 404);
    assert.equal((await route(String(pnpm.id), { text: 5 })).status, 400);
    assert.equal((await route(String(pnpm.id), { text: "x", session: "nope" })).status, 404);
    assert.equal((await route(String(pnpm.id), { text: pnpm.text, session: b.prep.chain })).status, 409, "the same words are no correction");
    const done = await route(String(pnpm.id), { text: "we use bun for package installs here.", reason: "switched last week", session: b.prep.chain });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.replaces, `i${pnpm.id}`);
    const now = w.svc.archive.items.get(Number(done.body.id.slice(1)));
    assert.deepEqual([now.status, now.origin, now.chain_id, now.project_id], ["confirmed", "correction", b.prep.chain, sit.project.id], "the owner's word, filed in the open session");
    const old = w.svc.archive.items.get(pnpm.id);
    assert.deepEqual([old.status, old.superseded_by], ["superseded", now.id]);
    const ev = w.svc.archive.items.events(pnpm.id).at(-1);
    assert.deepEqual([ev.action, ev.by, ev.reason], ["status", "owner", "switched last week"]);
    const errata = (/** @type {string} */ chain) => (w.svc.archive.getChain(chain)?.meta?.errata || []).map((/** @type {any} */ e) => e.ref);
    assert.deepEqual(errata(b.prep.chain), [], "the session that made the change was there");
    assert.deepEqual(errata(c.prep.chain), [`i${pnpm.id}`], "the other session hears of it");
    assert.equal((await route(String(pnpm.id), { text: "we use npm" })).status, 409, "a retired claim is corrected no more");
    // No words: retired, with nothing in its place.
    const gone = await route(done.body.id, { text: "", reason: "we have no package manager rule" });
    assert.deepEqual([gone.status, gone.body.retired, w.svc.archive.items.get(now.id).status], [200, true, "dismissed"]);
  });
});

test("the owner retires a claim from a page as the open session's: its errata spare that session; an unknown session is a 404", async () => {
  await world({}, async (w) => {
    await w.session("a").remember("we use pnpm for package installs here");
    const b = await w.session("b").send("hello");
    const c = await w.session("c").send("hello");
    const pnpm = w.svc.archive.items.list({}).find((/** @type {any} */ it) => /pnpm/.test(it.text));
    for (const s of [b, c]) w.svc.archive.injections.add({ requestId: `shown-${s.prep.chain}`, chainId: s.prep.chain, turnId: s.prep.turn, kind: "turn", ids: [`i${pnpm.id}`], tokens: 12 });
    const forget = (/** @type {any} */ body) => adminCall(w.svc, "POST", "/memory/forget", body);
    assert.equal((await forget({ id: `i${pnpm.id}`, session: "nope" })).status, 404);
    assert.equal(w.svc.archive.items.get(pnpm.id).status, pnpm.status, "refused: nothing retired");
    const done = await forget({ id: `i${pnpm.id}`, reason: "we never did", session: b.prep.chain });
    assert.deepEqual([done.status, done.body.ok], [200, true], JSON.stringify(done.body));
    assert.deepEqual([w.svc.archive.items.get(pnpm.id).status, w.svc.archive.items.events(pnpm.id).at(-1).by], ["dismissed", "owner"]);
    const errata = (/** @type {string} */ chain) => (w.svc.archive.getChain(chain)?.meta?.errata || []).map((/** @type {any} */ e) => e.ref);
    assert.deepEqual(errata(b.prep.chain), [], "the session that retired it was there");
    assert.deepEqual(errata(c.prep.chain), [`i${pnpm.id}`], "the other session hears of it");
  });
});

test("the owner's Confirm from a page is 'proved right': its files anchored afresh; a retired claim confirmed is brought back (M6-D7)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-view-"));
  try {
    mkdirSync(join(dir, "src"));
    const server = (/** @type {string} */ body) => writeFileSync(join(dir, "src", "server.js"), body);
    server("export function listen() { return app.listen(3000); }\n");
    await world({ cwd: dir }, async (w) => {
      const { sit } = await w.session("a").send("hello");
      const filed = await w.svc.brain.fileLearned({ projectId: sit.project.id, chainId: "l1", kind: "fact", text: "src/server.js starts the http listener on port 3000", importance: 0.7 });
      const files = () => w.svc.brain.filesOf(w.svc.archive.items.get(filed.id))?.worst.state;
      assert.equal(files(), "ok");
      server("// the listener\nexport function listen() { return app.listen(3000); }\n");
      assert.equal(files(), "changed");
      const status = (/** @type {any} */ body) => adminCall(w.svc, "POST", `/memory/items/${filed.id}`, body);
      const ok = await status({ status: "confirmed" });
      assert.deepEqual([ok.status, ok.body.ok, w.svc.archive.items.get(filed.id).status], [200, true, "confirmed"], JSON.stringify(ok.body));
      assert.equal(files(), "ok", "proved right against the file as it is: the change it survived marks it no more");
      await status({ status: "dismissed" });
      assert.equal(w.svc.archive.items.get(filed.id).status, "dismissed");
      const back = await status({ status: "confirmed" });
      assert.deepEqual([back.status, back.body.ok, w.svc.archive.items.get(filed.id).status], [200, true, "confirmed"], "the owner brings a retired claim back");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("@mem confirm and @mem correct: the person's word on a claim, from the chat", async () => {
  await world({}, async (w) => {
    const { sit } = await w.session("a").send("hello");
    const learned = await w.svc.brain.fileLearned({ projectId: sit.project.id, chainId: "l1", kind: "fact", text: "the api listens on port 3000", importance: 0.7 });
    const mem = async (/** @type {string} */ text) => (await memoryCommand(w.svc, text, sit))?.text || "";
    assert.equal(await mem("@mem confirm"), "Usage: @mem confirm <id>");
    assert.equal(await mem(`@mem confirm i${learned.id}`), `Confirmed \`i${learned.id}\`: it counts as your word now.`);
    assert.equal(w.svc.archive.items.get(learned.id).status, "confirmed");
    assert.equal(await mem(`@mem confirm i${learned.id}`), `\`i${learned.id}\` is confirmed already.`);
    assert.match(await mem("@mem confirm i999"), /^Could not confirm `i999`: no memory i999\.$/);
    assert.match(await mem(`@mem correct i${learned.id}`), /^Usage: @mem correct <id> <what is true now>/);
    const fixed = await mem(`@mem correct i${learned.id} the api listens on port 8080`);
    const m = /^Corrected: `i(\d+)` replaces `i(\d+)`\.$/.exec(fixed);
    assert.ok(m, fixed);
    assert.equal(Number(m[2]), learned.id);
    const now = w.svc.archive.items.get(Number(m[1]));
    assert.deepEqual([now.text, now.status, now.origin], ["the api listens on port 8080", "confirmed", "correction"]);
    assert.equal(w.svc.archive.items.events(learned.id).at(-1).by, "person");
    assert.equal(await mem(`@mem correct i${learned.id} port 9090`), `Could not correct \`i${learned.id}\`: i${learned.id} was replaced by i${now.id}, which stands: "the api listens on port 8080"; correct i${now.id} if it is wrong too.`);
    assert.equal(await mem(`@mem confirm i${learned.id}`), `Could not confirm \`i${learned.id}\`: i${learned.id} is superseded by i${now.id}; remembering its words again brings it back.`, "said to the user, who can");
    assert.match(await mem("@mem help"), /@mem confirm <id>/);
  });
});

// (fails before: yes — the memory plan's m1: the route took summarizer and curator, and unset meant "the cheapest")
test("memory's model, set from a page: the model, its effort and the curator's use of it, saved with the config and read live", async () => {
  await world({}, async (w) => {
    let saved = 0;
    /** @type {any[]} */
    const recorded = [];
    const more = {
      config: { get: () => w.cfg, set: (/** @type {any} */ next) => Object.assign(w.cfg, next), save: () => saved++ },
      dryRun: (/** @type {any} */ input) => (["grok-4.6", "glm-5.3"].includes(input.body.model) ? { ok: true } : { ok: false, error: `no route matches model "${input.body.model}"` }),
      ops: { record: (/** @type {any[]} */ ...a) => recorded.push(a) },
    };
    const set = (/** @type {any} */ body) => adminCall(w.svc, "POST", "/memory/models", body, more);
    const before = structuredClone(w.cfg);
    assert.deepEqual((await set({})).status, 400);
    const curator = await set({ curator: "grok-4.6" });
    assert.deepEqual([curator.status, curator.body.error], [400, "summarizer, effort or curatorUsesModel is required"], "the curator has no model of its own");
    const bad = await set({ summarizer: "nope" });
    assert.deepEqual([bad.status, bad.body.error], [400, 'summarizer: no route matches model "nope"']);
    const effort = await set({ summarizer: "grok-4.6", effort: "loud" });
    assert.deepEqual([effort.status, effort.body.error], [400, `effort: one of ${["model", ...EFFORT_LEVELS].join(", ")}, or empty for low`]);
    assert.deepEqual([w.cfg, saved], [before, 0], "a refused change writes nothing");
    const none = { summarizer: "", effort: "", curatorUsesModel: true, now: null, from: "none", whyNone: "no model to call: set one in Settings › Memory › Model, or chat on a model a provider serves (a coding agent's alone is no plain model)" };
    assert.deepEqual((await adminCall(w.svc, "GET", "/memory/models", undefined, more)).body.models, none, "nothing set and nothing a provider serves: none, said why, never a guess");
    const ok = await set({ summarizer: "grok-4.6" });
    assert.deepEqual([ok.status, ok.body.set, ok.body.models], [200, { summarizer: "grok-4.6" }, { ...none, summarizer: "grok-4.6", now: "grok-4.6", from: "memory", whyNone: null }]);
    assert.deepEqual([w.svc.summarizerModel(), w.svc.curatorModel()], ["grok-4.6", "grok-4.6"], "read live: the curator works with it too");
    assert.deepEqual({ ...w.cfg, memory: { ...w.cfg.memory, models: before.memory.models } }, before, "nothing else touched");
    assert.equal((await set({ effort: "high" })).status, 200);
    assert.equal((await set({ curatorUsesModel: false })).body.models.curatorUsesModel, false);
    assert.deepEqual([w.cfg.memory.models, w.cfg.memory.curator.usesModel], [{ summarizer: "grok-4.6", effort: "high" }, false]);
    assert.equal(w.svc.curatorModel(), "", "the curator by rule alone");
    assert.equal((await set({ summarizer: "auto", effort: "" })).status, 200);
    assert.deepEqual([w.svc.summarizerModel(), w.cfg.memory.models], ["", { summarizer: "", effort: "" }], "auto is not set");
    assert.equal(saved, 4);
    assert.deepEqual(recorded.map((r) => r[1]), [
      "memory's model set (summarizer: grok-4.6)",
      "memory's model set (effort: high)",
      "memory's model set (curatorUsesModel: false)",
      "memory's model set (summarizer: not set, effort: not set)",
    ]);
  });
});
