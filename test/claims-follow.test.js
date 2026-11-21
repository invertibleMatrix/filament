// @ts-check
// A page's claim changes off the events fan-out (HarnessV3-Memory M7-D36, M7-D37): `followClaims` collects them, and
// says "read everything again" when a message was missed, on a reset and on a reconnect; `claimsTouched` and
// `turnTouched` decide what a page reads again, and nothing else; `followTurnMemory` is the harness's turn memory on it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { followClaims, claimsTouched, turnTouched, followTurnMemory, firstScope } from "../src/ui/lib/claims.js";
import { listenerSet } from "../src/ui/lib/listeners.js";

/** A fan-out: `say` hands each listener a message. */
function fanOut() {
  /** @type {Set<(msg: any) => void>} */
  const listeners = new Set();
  return {
    listeners,
    subscribe: (/** @type {(msg: any) => void} */ fn) => (listeners.add(fn), () => void listeners.delete(fn)),
    say: (/** @type {any} */ msg) => {
      for (const fn of [...listeners]) fn(msg);
    },
  };
}
/** A page of changes, chained after the one before (`n` its place). @param {number} n @param {any[]} changes */
const page = (n, ...changes) => ({ type: "claims", prev: `e1:${n - 1}`, last: `e1:${n}`, changes });
/** @param {string | null} claim @param {string} action @param {string | null} project @param {Record<string, any>} [more] */
const change = (claim, action, project, more = {}) => ({ type: "change", id: "e1:0", claim, action, at: "2026-10-03T12:00:00.000Z", by: "learner", project, session: "c9", ...more });

/** The tests whose clock is mocked already. */
const mocked = new WeakSet();
/** A page following the fan-out, what it was handed recorded. @param {any} t @param {{ alive?: () => boolean }} [o] */
function follow(t, o = {}) {
  if (!mocked.has(t)) t.mock.timers.enable({ apis: ["setTimeout"] });
  mocked.add(t);
  const bus = fanOut();
  /** @type {any[]} */
  const got = [];
  const stop = followClaims(bus.subscribe, { onChanges: (c) => got.push(c.map((x) => x.claim)), onReadAll: () => got.push("all"), ...o });
  return { bus, got, stop, tick: () => t.mock.timers.tick(250) };
}

test("followClaims hands the changes collected over 250 ms, once; other messages are not its own", (t) => {
  const { bus, got, tick } = follow(t);
  bus.say(page(5, change("i1", "status", "p1")));
  bus.say({ type: "op", op: {} });
  bus.say(page(6, change("i2", "created", "p1"), change("i3", "evidence", "p1")));
  t.mock.timers.tick(249);
  assert.deepEqual(got, [], "still collecting");
  t.mock.timers.tick(1);
  assert.deepEqual(got, [["i1", "i2", "i3"]], "the first message heard is taken whatever its prev; then each chains");
  bus.say(page(7, change("i4", "fired", "p1")));
  tick();
  assert.deepEqual(got, [["i1", "i2", "i3"], ["i4"]]);
});

test("followClaims: a message missed, a reset and a reconnect each say read everything again, and drop what was collected", (t) => {
  const { bus, got, tick } = follow(t);
  bus.say(page(1, change("i1", "status", "p1")));
  bus.say(page(5, change("i2", "status", "p1")));
  tick();
  assert.deepEqual(got, ["all"], "prev e1:4 is not e1:1: one was missed, and what was held goes with it");
  bus.say(page(6, change("i3", "status", "p1")));
  tick();
  assert.deepEqual(got, ["all", ["i3"]], "it chains on from the one that said it");
  bus.say({ type: "claims", reset: true, last: "e2:0" });
  bus.say({ type: "claims", prev: "e2:0", last: "e2:1", changes: [change("i9", "created", "p1")] });
  tick();
  assert.deepEqual(got.slice(2), ["all", ["i9"]], "a reset: everything, then the new store's changes");
  bus.say(page(40, change("i5", "status", "p1")));
  bus.say({ type: "hello", version: "x" });
  bus.say(page(70, change("i6", "status", "p1")));
  tick();
  assert.deepEqual(got.slice(4), ["all", "all", ["i6"]], "missed, then a reconnect; after it the first message heard is taken");
});

test("followClaims: a reset is read everything again though it is the first message heard; and what was collected goes with no change handed later", (t) => {
  const a = follow(t);
  a.bus.say({ type: "claims", reset: true, last: "e2:0" });
  assert.deepEqual(a.got, ["all"], "at once");
  a.tick();
  assert.deepEqual(a.got, ["all"], "and nothing more");
  const b = follow(t);
  b.bus.say(page(1, change("i1", "status", "p1")));
  b.bus.say(page(2, change("i2", "status", "p1")));
  b.bus.say({ type: "hello" });
  b.tick();
  assert.deepEqual(b.got, ["all"], "one wait for the two, dropped with them");
});

test("followClaims lets go at the next message once the page is gone, or when its change is due; and when told to", (t) => {
  let alive = true;
  const a = follow(t, { alive: () => alive });
  alive = false;
  a.bus.say(page(1, change("i1", "status", "p1")));
  assert.deepEqual([a.got, a.bus.listeners.size], [[], 0]);
  alive = true;
  const b = follow(t, { alive: () => alive });
  b.bus.say(page(1, change("i1", "status", "p1")));
  alive = false;
  b.tick();
  assert.deepEqual([b.got, b.bus.listeners.size], [[], 0], "gone while collecting");
  const c = follow(t);
  c.bus.say(page(1, change("i1", "status", "p1")));
  c.stop();
  c.tick();
  assert.deepEqual([c.got, c.bus.listeners.size], [[], 0], "the undo drops what was held");
});

test("claimsTouched: the counts on a change that moves one; the list on its scope's claims or one it shows; questions in scope or global; open histories; the dossier's project", () => {
  const view = { scope: "p1", shown: ["i7", "i8"], histories: ["i7", "i30"], dossier: null };
  const none = { scopes: false, list: false, questions: false, histories: [], dossier: false };
  assert.deepEqual(claimsTouched([change("i99", "evidence", "p2")], view), none, "another project's claim, unseen here");
  for (const action of ["created", "status", "deleted", "moved", "dossier"]) assert.equal(claimsTouched([change("i99", action, "p2")], view).scopes, true, action);
  for (const action of ["evidence", "fired", "followed", "triggers", "anchored", "slot", "asked"]) assert.equal(claimsTouched([change("i99", action, "p2")], view).scopes, false, action);
  assert.equal(claimsTouched([change("i40", "evidence", "p1")], view).list, true, "a claim of the scope");
  assert.equal(claimsTouched([change("i8", "moved", "p2", { from: "p3" })], view).list, true, "one the list shows, wherever it is now");
  assert.equal(claimsTouched([change("i41", "moved", "p2", { from: "p1" })], view).list, true, "one moved out of the scope");
  assert.equal(claimsTouched([change(null, "dossier", "p1")], view).list, false, "a dossier is no claim");
  assert.equal(claimsTouched([change("i40", "evidence", null)], view).list, false, "a global claim is not this project's list");
  assert.equal(claimsTouched([change("i40", "evidence", null)], { ...view, scope: null }).list, true, "Everywhere: the global claims");
  assert.equal(claimsTouched([change("i40", "evidence", "p1")], { ...view, scope: null }).list, false, "Everywhere: not a project's");
  assert.equal(claimsTouched([change("i40", "asked", "p1")], view).questions, true);
  assert.equal(claimsTouched([change("i40", "decided", null)], view).questions, true, "the global questions are asked everywhere");
  assert.equal(claimsTouched([change("i40", "asked", "p2")], view).questions, false);
  assert.equal(claimsTouched([change("i40", "status", "p1")], view).questions, false, "a status is no question");
  assert.deepEqual(claimsTouched([change("i7", "status", "p1"), change("i30", "fired", null), change("i7", "evidence", "p1"), change("i8", "fired", "p1")], view).histories, ["i7", "i30"]);
  assert.equal(claimsTouched([change("i40", "evidence", "p1")], view).dossier, false, "no dossier shown");
  assert.equal(claimsTouched([change("i40", "evidence", null), change(null, "deleted", null)], view).dossier, false, "no dossier shown: not the global claims' either");
  assert.deepEqual(claimsTouched([change(null, "deleted", "p9")], view), { ...none, scopes: true }, "a project gone: the scopes, and nothing else");
  const dossier = { scope: "p1", dossier: "p1" };
  assert.equal(claimsTouched([change(null, "dossier", "p1")], dossier).dossier, true);
  assert.equal(claimsTouched([change("i41", "moved", "p2", { from: "p1" })], dossier).dossier, true, "a claim it may cite left");
  assert.equal(claimsTouched([change("i41", "status", "p2")], dossier).dossier, false);
  assert.deepEqual(claimsTouched([], view), none);
});

test("turnTouched: a change to a claim the turn shows, a claim filed in its session, a question in its project or global", () => {
  const mem = {
    session: "c1",
    project: "p1",
    shown: [{ id: "i1" }, { id: "s:c0:2", kind: "words" }],
    reminders: [{ kind: "pitfall", claim: { id: "i2" } }],
    said: [{ id: "i3", replaces: [{ id: "i4" }] }],
    asks: { count: 1, first: [{ id: "q1", claims: [{ id: "i5" }] }] },
  };
  for (const id of ["i1", "i2", "i3", "i4", "i5"]) assert.equal(turnTouched([change(id, "evidence", "p9")], mem), true, id);
  assert.equal(turnTouched([change("i9", "status", "p1")], mem), false, "a claim it does not show");
  assert.equal(turnTouched([change("i9", "created", "p1", { session: "c1" })], mem), true, "filed in its session");
  assert.equal(turnTouched([change("i9", "created", "p1", { session: "c2" })], mem), false, "filed in another");
  assert.equal(turnTouched([change("i9", "status", "p1", { session: "c1" })], mem), false, "a claim of its session it does not show, changed");
  assert.equal(turnTouched([change("i9", "asked", "p1")], mem), true);
  assert.equal(turnTouched([change("i9", "decided", null)], mem), true);
  assert.equal(turnTouched([change("i9", "asked", "p2")], mem), false);
  assert.equal(turnTouched([change("i1", "status", "p1")], null), false, "no turn memory shown");
  assert.equal(turnTouched([change("i9", "evidence", "p1")], { session: "c1", project: "p1" }), false, "a turn that showed nothing");
});

test("followTurnMemory reads the turn's memory again when a change touches it, and on anything missed", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const bus = fanOut();
  let reads = 0;
  /** @type {any} */
  let shown = { session: "c1", project: "p1", shown: [{ id: "i1" }] };
  followTurnMemory(bus.subscribe, { shown: () => shown, read: () => reads++ });
  bus.say(page(1, change("i9", "status", "p2")));
  t.mock.timers.tick(250);
  assert.equal(reads, 0);
  bus.say(page(2, change("i1", "status", "p1")));
  t.mock.timers.tick(250);
  assert.equal(reads, 1);
  shown = null;
  bus.say(page(3, change("i1", "status", "p1")));
  t.mock.timers.tick(250);
  assert.equal(reads, 1, "nothing shown: nothing to read");
  bus.say({ type: "hello" });
  assert.equal(reads, 2, "a reconnect: read, at once");
});

test("firstScope: the project with the most claims; everywhere when none has any", () => {
  assert.equal(firstScope([{ project: null, claims: 9 }, { project: "p1", claims: 2 }, { project: "p2", claims: 5 }, { project: "p3" }]), "p2", "everywhere's count is not a project's");
  assert.equal(firstScope([{ project: null, claims: 9 }, { project: "p1", claims: 0 }, { project: "p2" }]), null);
  assert.equal(firstScope([{ project: null, claims: 0 }]), null);
  assert.equal(firstScope([]), null);
});

test("listenerSet hands a message to the listeners there when it came: one added meanwhile hears the next, one let go meanwhile not this; a failure is reported, the rest still hear", () => {
  /** @type {string[]} */
  const errors = [];
  const set = listenerSet((err) => errors.push(/** @type {Error} */ (err).message));
  /** @type {string[]} */
  const got = [];
  const offBroken = set.on(() => {
    throw new Error("a page that breaks");
  });
  /** @type {() => void} */
  let offLate = () => {};
  set.on((m) => {
    got.push(`a:${m}`);
    if (m === 1) set.on((n) => got.push(`added:${n}`));
    if (m === 2) offLate();
  });
  offLate = set.on((m) => got.push(`late:${m}`));
  assert.equal(set.size, 3);
  set.hand(1);
  assert.deepEqual([got, errors], [["a:1", "late:1"], ["a page that breaks"]]);
  set.hand(2);
  assert.deepEqual([got.slice(2), errors.length], [["a:2", "added:2"], 2], "the one added hears from the next on; the one let go hears this no more");
  offBroken();
  set.hand(3);
  assert.deepEqual([got.slice(4), errors.length, set.size], [["a:3", "added:3"], 2, 2], "let go: it hears nothing");
});

test("listenerSet's failures go to the page's reportError when none is given", (t) => {
  /** @type {unknown[]} */
  const reported = [];
  const g = /** @type {any} */ (globalThis);
  const had = Object.hasOwn(g, "reportError");
  const was = g.reportError;
  g.reportError = (/** @type {unknown} */ err) => reported.push(err);
  t.after(() => {
    if (had) g.reportError = was;
    else delete g.reportError;
  });
  const set = listenerSet();
  const boom = new Error("boom");
  set.on(() => {
    throw boom;
  });
  set.hand("x");
  assert.deepEqual(reported, [boom]);
});

// The two apps' wiring, read as written (their pages boot a browser; what they wire is tested above and in the pages').
test("the console hands every events message to its listeners before its own handler bails, and gives the pages the door", () => {
  const src = readFileSync(new URL("../src/ui/app.js", import.meta.url), "utf8");
  assert.match(src, /^import \{ listenerSet \} from "\.\/lib\/listeners\.js";$/m);
  assert.match(src, /\nconst eventListeners = listenerSet\(\);\n[^\n]*\nconst onEvents = \(fn\) => eventListeners\.on\(fn\);\n/, "one set; the door is its `on`, the undo with it");
  const at = src.indexOf("es.onmessage");
  const body = src.slice(at, src.indexOf("};", at));
  const handed = body.indexOf("eventListeners.hand(ev);");
  assert.ok(handed > 0 && handed < body.indexOf("if (ev?.type === \"models-discovered\")"), "first, every message, its hello too");
  const bound = src.slice(src.indexOf("bindUi({"), src.indexOf("});", src.indexOf("bindUi({")));
  assert.match(bound, /\bonEvents,/, "the pages reach it as ui.onEvents");
});

test("the harness's bus hands every message to its listeners the same way, and its door gives the undo", () => {
  const src = readFileSync(new URL("../src/ui/harness/lib/bus.js", import.meta.url), "utf8");
  assert.match(src, /^import \{ listenerSet \} from "\.\.\/\.\.\/lib\/listeners\.js";$/m);
  assert.match(src, /\nconst listeners = listenerSet\(\);\n/);
  const at = src.indexOf("source.onmessage");
  assert.match(src.slice(at, src.indexOf("\n  };", at)), /return;\n {4}\}\n[^\n]*\n {4}listeners\.hand\(msg\);$/, "each message parsed, then handed");
  assert.match(src, /export function onBus\(fn\) \{\n {2}const off = listeners\.on\(fn\);\n {2}if \(!source\) open\(\);\n {2}return off;\n\}/);
});

test("the harness reads the open session's turn memory again on the claims it shows", () => {
  const src = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  const at = src.indexOf("followTurnMemory(onBus, {");
  assert.ok(at > 0, "followed on the bus");
  const call = src.slice(at, src.indexOf("\n});", at));
  assert.match(call, /shown: \(\) => sessionChat\(\)\?\.view\?\.memory \?\? null/);
  assert.match(call, /if \(c\) void readTurnMemory\(c\);/);
});
