// @ts-check
// The kinds of a watcher's trigger are one table (core/watchers.js `TRIGGER_ROWS`): a row for each kind holds what is
// the kind's own — its keys and how they are read, whether it names a chat, how it is heard (off Filament's bus by its
// filter, or by a source of its own), its words, its event as a watcher keeps it, the fields of the cursor it keeps and
// its trouble in words — and every reader reads the row: core's own, the store's cursor reader and its writers, the
// space tool's guide and fences, a wake's packet. A kind is its row, its example call and guide line, and its source's
// own file where it has one; nothing else names it, which the ratchet at the end holds.
// (fails before: yes — a kind was a branch in each reader: the store's cursor reader kept every kind's fields for any
// kind, a watcher's trouble was said by a key read off a connection's trigger, and its store's writer took a commit's
// alone; the tool's calls, guide lines and fences and the packet's details each named the kinds in their own branches)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "../src/core/watchers.js";
import { routineClash, routineFields, rowWords } from "../src/core/routines.js";
import { namedText } from "../src/core/space.js";
import { createSpaceStore } from "../src/services/spaces.js";
import * as spaceTool from "../src/app/agent/space.js";
import { removeDirs } from "./helpers/wait.js";

const { TRIGGER_KINDS, TRIGGER_ROWS, eventIn, picks, seenFields, triggerChat, triggerEvery, triggerFields, triggerParts, triggerShort, troubleWords, watchEventOf, watchedName, watchedParts, wokeParts } = core;
const { TRIGGER_FENCES, TRIGGER_GUIDE, spaceGuide, spaceRun } = spaceTool;

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-watch-kinds-${tag}-`));
  made.push(d);
  return d;
};

/** 09:00 of Monday 26 October 2026, local. */
const T = new Date(2026, 9, 26, 9).getTime();
const MIN = 60_000;
const NAMES = /** @type {Record<string, string>} */ ({ c1: "Lead", c2: "Build the login flow" });
/** @param {string} c */
const nameOf = (c) => NAMES[c] || "an untitled chat";
const BY = { chain: "c1", byName: "Lead", model: "m", nameOf };
const A = "a".repeat(40);
const B = "b".repeat(40);

/** A row, for a test that calls what it holds with a trigger of any kind. @param {string} k @returns {any} */
const rowOf = (k) => /** @type {any} */ (TRIGGER_ROWS)[k];
/** A kind's trigger as the tool's example call gives it, "this" the chat c2. @param {string} k @returns {any} */
const given = (k) => {
  const t = JSON.parse(/** @type {any} */ (TRIGGER_GUIDE)[k].call).with.trigger;
  return t.chat === "this" ? { ...t, chat: "c2" } : t;
};
/** …and as core reads it. @param {any} input @returns {any} */
const read = (input) => {
  const r = triggerFields(input);
  assert.ok(r.ok, `${JSON.stringify(input)}: ${JSON.stringify(r)}`);
  return r.trigger;
};
/** @param {string} k */
const triggerOf = (k) => read(given(k));
/** What a refusal of a key says: the kind and the keys its row takes. @param {string} k @param {string} odd */
const takes = (k, odd) => {
  const keys = rowOf(k).keys;
  return `a${/^[aeiou]/.test(k) ? "n" : ""} ${k} trigger takes ${keys.length > 1 ? `${keys.slice(0, -1).join(", ")} and ${keys.at(-1)}` : keys[0]}; "${odd}" is none of them`;
};
/** @param {() => unknown} fn */
const refusal = (fn) => {
  try {
    fn();
  } catch (/** @type {any} */ e) {
    return [e.status, e.message];
  }
  return null;
};
/** @param {any} r */
const words = (r) => (r.ok ? r.text : r.error);

/** What happened, as each kind's source says it: one event its example trigger picks, where the bus is how it is heard. */
const HEARD = /** @type {Record<string, any>} */ ({
  turn: { kind: "turn", chain: "c2", at: T, turn: 4, failed: false, stopped: false, files: 1, tree: false, done: [] },
  task: { kind: "task", chain: "c2", at: T, graph: 1, task: "t1", name: "Write the parser", state: "blocked", why: "its checklist item says blocked" },
  ask: { kind: "ask", chain: "c2", at: T - 30 * MIN, ask: "run-1:q1", words: "Go on?" },
  shell: { kind: "shell", chain: "c2", at: T, id: "run-1:u3", command: "npm test", exit: 1 },
  subagent: { kind: "subagent", chain: "c2", at: T, agent: "sa_1", exchange: 1, description: "Map the folder", ok: true, status: "done", report: "Mapped." },
  commit: { kind: "commit", at: T, after: T - MIN, place: "/r", branch: "main", from: A, to: B, added: [{ sha: B, subject: "Fix the parser" }], more: 0, dropped: 0, gone: false },
  connection: { kind: "connection", at: T, tool: "mcp__linear__list_issues", key: "0123456789abcdef", words: "ENG-1 Login fails" },
  file: { kind: "file", at: T, after: T - MIN, place: "/r/docs", glob: "docs/**/*.md", where: "docs", added: [], changed: ["a.md"], removed: [], away: false },
  webhook: { kind: "webhook", at: T, post: "0abcdefgh-0123456789abcdef", type: "application/json", head: '{"status":"red"}' },
  script: { kind: "script", at: T, key: "0123456789abcdef", words: "3 new mentions", ref: "m-41", body: "Ana, Bo and Cy mentioned you" },
});

/** A cursor that holds every kind's own fields, as a file could. */
const EVERY_FIELD = { n: 2, keys: ["0123456789abcdef"], list: ["issues"], asked: T + MIN, trouble: { at: T + MIN, why: "it failed", fails: 2 }, head: A, headAt: T + 2 * MIN, fileAt: T + 3 * MIN };

describe("the table of trigger kinds", () => {
  test("it has the ten kinds in order, frozen, each row whole", () => {
    assert.deepEqual(Object.keys(TRIGGER_ROWS), ["turn", "task", "ask", "shell", "subagent", "commit", "connection", "file", "webhook", "script"]);
    assert.deepEqual([...TRIGGER_KINDS], Object.keys(TRIGGER_ROWS), "the kinds are the table's keys");
    assert.ok(Object.isFrozen(TRIGGER_ROWS) && Object.isFrozen(TRIGGER_KINDS));
    for (const k of TRIGGER_KINDS) {
      const row = rowOf(k);
      assert.ok(Object.isFrozen(row), k);
      assert.deepEqual(Object.keys(row).sort(), ["bus", "chat", "event", "fields", "keys", "name", "parts", "program", "seen", "short", "trouble", "watched", "woke"], k);
      assert.equal(typeof row.program, "boolean", `${k}: whether its source runs a program as the person`);
      assert.ok(Array.isArray(row.keys) && row.keys.every((/** @type {unknown} */ x) => typeof x === "string" && x && x !== "kind"), `${k}: its keys beside kind`);
      assert.ok(["needed", "may", "none"].includes(row.chat), `${k}: whether it names a chat`);
      assert.equal(row.keys.includes("chat"), row.chat !== "none", `${k}: chat is a key of the kinds that name one`);
      for (const f of ["fields", "parts", "watched", "name", "short", "woke", "event"]) assert.equal(typeof row[f], "function", `${k}.${f}`);
      assert.ok(row.bus === null || (typeof row.bus.picks === "function" && (row.bus.every === undefined || typeof row.bus.every === "function")), `${k}: heard off the bus by its filter, or by a source of its own`);
      assert.ok(Object.values(row.seen).every((r) => typeof r === "function"), `${k}: each field of its cursor with its reader`);
      assert.ok(row.trouble === null || typeof row.trouble === "function", `${k}: its trouble in words, or none`);
    }
    // What each row says of its kind today.
    assert.deepEqual(Object.fromEntries(TRIGGER_KINDS.map((k) => [k, rowOf(k).chat])), { turn: "needed", task: "may", ask: "may", shell: "may", subagent: "may", commit: "none", connection: "none", file: "none", webhook: "none", script: "none" });
    assert.deepEqual(TRIGGER_KINDS.filter((k) => rowOf(k).bus), ["turn", "task", "ask", "shell", "subagent"], "a commit, a connection, a folder's files, a program's post and a script are heard by a source of their own");
    assert.deepEqual(TRIGGER_KINDS.filter((k) => rowOf(k).bus?.every), ["turn"]);
    assert.deepEqual(Object.fromEntries(TRIGGER_KINDS.map((k) => [k, Object.keys(rowOf(k).seen)])), { turn: ["n"], task: [], ask: [], shell: [], subagent: [], commit: ["trouble", "head", "headAt"], connection: ["keys", "list", "asked", "trouble"], file: ["fileAt", "trouble"], webhook: ["trouble"], script: ["trouble"] });
    assert.deepEqual(TRIGGER_KINDS.filter((k) => rowOf(k).trouble), ["commit", "connection", "file", "webhook", "script"]);
  });
});

describe("each reader agrees with the kind's row", () => {
  test("its keys: a key it does not take is refused naming the row's, and what it reads is its kind's trigger", () => {
    for (const k of TRIGGER_KINDS) {
      const r = triggerFields({ ...given(k), zzz: 1 });
      assert.deepEqual(r, { ok: false, error: takes(k, "zzz") }, k);
      const t = triggerOf(k);
      assert.equal(t.kind, k);
      assert.deepEqual(Object.keys(t).filter((key) => key !== "kind" && !rowOf(k).keys.includes(key)), [], `${k}: no key but its row's`);
      assert.deepEqual(read(t), t, `${k}: read again, the same`);
    }
  });

  test("whether it names a chat: needed, may or none — what triggerChat and the guides rule go by", () => {
    const NO_CHAT = "guides needs a trigger that names a chat — a turn, task, ask, shell or subagent trigger with its chat —: that chat is the one this watcher may guide";
    /** @param {any} trigger */
    const guides = (trigger) => routineClash({ task: "x", trigger, wakes: "new", guides: true });
    for (const k of TRIGGER_KINDS) {
      const row = rowOf(k);
      const { chat: _chat, ...bare } = given(k);
      if (row.chat === "none") {
        assert.deepEqual(triggerFields({ ...bare, chat: "c2" }), { ok: false, error: takes(k, "chat") }, k);
        assert.equal(triggerChat(read(bare)), "", k);
        assert.equal(guides(read(bare)), NO_CHAT, k);
        continue;
      }
      const named = read({ ...bare, chat: "c2" });
      assert.equal(triggerChat(named), "c2", k);
      assert.equal(guides(named), null, `${k}: it may guide the chat it names`);
      const unnamed = triggerFields(bare);
      assert.equal(unnamed.ok, row.chat === "may", `${k}: ${row.chat}`);
      if (unnamed.ok) {
        assert.equal(triggerChat(unnamed.trigger), "", k);
        assert.equal(guides(unnamed.trigger), NO_CHAT, k);
      }
    }
  });

  test("how it is heard: picks takes an event of its own kind where its row has a filter, and never one a source of its own hears", () => {
    for (const k of TRIGGER_KINDS) {
      const row = rowOf(k);
      const t = triggerOf(k);
      for (const j of TRIGGER_KINDS) assert.equal(picks(t, HEARD[j], T), j === k && !!row.bus, `a ${k} trigger and a ${j} event`);
      if (row.bus) assert.equal(row.bus.picks(t, HEARD[k], T), true, k);
      assert.equal(triggerEvery(t), row.bus?.every ? row.bus.every(t) : 1, k);
    }
    assert.equal(triggerEvery(triggerOf("turn")), 3, "the turn's example call wakes it at every third");
  });

  test("its words: each sentence of a trigger is its row's", () => {
    for (const k of TRIGGER_KINDS) {
      const row = rowOf(k);
      const t = triggerOf(k);
      assert.deepEqual(triggerParts(t, nameOf), row.parts(t, nameOf), k);
      assert.deepEqual(watchedParts(t, nameOf), row.watched(t, nameOf), k);
      assert.equal(watchedName(t, nameOf), row.name(t, nameOf), k);
      assert.deepEqual(triggerShort(t), row.short(t), k);
      for (const said of [namedText(triggerParts(t, nameOf)), namedText(watchedParts(t, nameOf)), watchedName(t, nameOf), triggerShort(t).each, triggerShort(t).when]) assert.ok(said && !/undefined|\[object/.test(said), `${k}: ${said}`);
      // What woke a chat: its row's words whole, or one event's and several's counted, of the chat they are of.
      const woke = row.woke(t);
      const one = namedText(wokeParts("Supervisor", t, { events: [watchEventOf(HEARD[k], t, nameOf)], more: 0 }, { nameOf }));
      const three = namedText(wokeParts("Supervisor", t, { events: [watchEventOf(HEARD[k], t, nameOf)], more: 2 }, { nameOf }));
      if (typeof woke === "string") assert.deepEqual([one, three], [`“Supervisor” woke this chat · ${woke}`, `“Supervisor” woke this chat · ${woke}`], k);
      else {
        assert.equal(one, `“Supervisor” woke this chat · ${woke.one} of Build the login flow${woke.did}`, k);
        assert.equal(three, `“Supervisor” woke this chat · 3 ${woke.many} of Build the login flow${woke.didMany ?? woke.did}`, k);
      }
    }
  });

  test("its event as a watcher keeps it: its row's, of its kind, read back whole from a file", () => {
    for (const k of TRIGGER_KINDS) {
      const t = triggerOf(k);
      const e = watchEventOf(HEARD[k], t, nameOf);
      assert.deepEqual(e, rowOf(k).event(HEARD[k], t, nameOf, false), k);
      assert.equal(e.kind, k);
      assert.ok(e.id.startsWith(`${k}:`), e.id);
      assert.deepEqual(eventIn(JSON.parse(JSON.stringify(e))), e, `${k}: as its Space's file holds it`);
    }
  });

  test("its cursor: seenIn keeps the kind's own fields and no other kind's", () => {
    const dir = fresh("seen");
    const store = createSpaceStore({ dir, now: () => T });
    for (const k of TRIGGER_KINDS) {
      const f = routineFields({ title: `Of ${k}`, text: "x", trigger: given(k) }, { create: true });
      assert.ok(f.ok, JSON.stringify(f));
      store.routineOn("p1", store.routinePropose("p1", f.fields, BY).id);
    }
    const file = join(dir, "p1.json");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    for (const r of raw.routines) r.seen = { ...r.seen, ...EVERY_FIELD };
    writeFileSync(file, JSON.stringify(raw));
    const kept = createSpaceStore({ dir, now: () => T }).get("p1").routines;
    assert.equal(kept.length, TRIGGER_KINDS.length);
    for (const r of kept) {
      const k = /** @type {string} */ (r.trigger?.kind);
      const own = Object.keys(rowOf(k).seen);
      assert.deepEqual(Object.keys(r.seen || {}), ["from", "at", "ids", ...own], `${k}: its own fields, in its row's order`);
      assert.deepEqual(r.seen, { from: T, at: null, ids: [], ...Object.fromEntries(own.map((f) => [f, /** @type {any} */ (EVERY_FIELD)[f]])) }, k);
      assert.deepEqual(seenFields(/** @type {any} */ (k), EVERY_FIELD), Object.fromEntries(own.map((f) => [f, /** @type {any} */ (EVERY_FIELD)[f]])), k);
      // A field that does not read is left out: a list with no keys, a head's moment with no head, a look at no moment.
      assert.deepEqual(seenFields(/** @type {any} */ (k), { n: 0, keys: "x", list: ["issues"], asked: -1, trouble: { at: 0, why: "x", fails: 1 }, head: "zz", headAt: T, fileAt: 0 }), {}, k);
    }
  });

  test("its trouble: said in its row's words on its watcher's row, kept by the store for a kind that has them and for no other", () => {
    const TROUBLE = /** @type {Record<string, string>} */ ({
      commit: "its branch could not be read: the feed is down",
      connection: "its tool failed 2 times in a row: the feed is down; it asks again in 120 min",
      file: "the feed is down",
      webhook: "the feed is down",
      script: "its program failed: the feed is down",
    });
    const trouble = { at: T, why: "the feed is down", fails: 2 };
    const store = createSpaceStore({ dir: null, now: () => T });
    for (const k of TRIGGER_KINDS) {
      const row = rowOf(k);
      const t = triggerOf(k);
      assert.equal(troubleWords(trouble, t), TROUBLE[k] ?? "", k);
      assert.equal(troubleWords(trouble, t), row.trouble ? row.trouble(trouble, t) : "", k);
      assert.equal(troubleWords(null, t), "", `${k}: none where it has no trouble`);
      const f = routineFields({ title: `Of ${k}`, text: "x", trigger: given(k) }, { create: true });
      assert.ok(f.ok, JSON.stringify(f));
      const { id } = store.routinePropose("p1", f.fields, BY);
      store.routineOn("p1", id);
      const w = () => /** @type {import("../src/core/routines.js").Routine} */ (store.get("p1").routines.find((r) => r.id === id));
      assert.equal(rowWords({ ...w(), seen: { from: T, at: null, ids: [], trouble } }, { now: T }).skipped, TROUBLE[k] ?? "", `${k}: its row`);
      if (!row.trouble) {
        assert.deepEqual(refusal(() => store.watchTrouble("p1", id, "the feed is down")), [409, `“Of ${k}” keeps no trouble of its own.`], k);
        continue;
      }
      assert.equal(store.watchTrouble("p1", id, "the feed is down"), true, k);
      assert.deepEqual(w().seen?.trouble, { at: T, why: "the feed is down", fails: 1 }, k);
      assert.equal(rowWords(w(), { now: T }).skipped, row.trouble({ at: T, why: "the feed is down", fails: 1 }, t), k);
      assert.equal(store.watchTrouble("p1", id, null), true, k);
      assert.equal(w().seen?.trouble, undefined, `${k}: a look that goes well takes it off`);
    }
    assert.deepEqual(Object.keys(TROUBLE), TRIGGER_KINDS.filter((k) => rowOf(k).trouble));
    const timed = store.routinePropose("p1", { title: "Brief", when: "daily 09:00", task: "x", writes: false }, BY);
    assert.deepEqual(refusal(() => store.watchTrouble("p1", timed.id, "x")), [409, "“Brief” keeps no trouble of its own."], "a routine at times");
  });
});

describe("the space tool's record of each kind", () => {
  test("every kind has its example call and its guide line, and the routine topic gives them in the table's order", () => {
    assert.deepEqual(Object.keys(TRIGGER_GUIDE), [...TRIGGER_KINDS]);
    const guide = spaceGuide("routine");
    assert.ok(guide.ok);
    const lines = guide.text.split("\n");
    const head = lines.indexOf("A watcher takes trigger in place of when — what wakes it, by its kind:");
    assert.ok(head > 0, "the topic's line over the kinds");
    assert.deepEqual(lines.slice(head + 1, head + 1 + TRIGGER_KINDS.length), TRIGGER_KINDS.map((k) => `- ${/** @type {any} */ (TRIGGER_GUIDE)[k].call}: ${/** @type {any} */ (TRIGGER_GUIDE)[k].says}`));
    assert.ok(lines[head + 1 + TRIGGER_KINDS.length].startsWith("- chat: "), "then what they share");
    for (const k of TRIGGER_KINDS) {
      const { call, says } = /** @type {any} */ (TRIGGER_GUIDE)[k];
      const c = JSON.parse(call);
      assert.deepEqual([c.action, c.with.trigger.kind, typeof c.with.title, typeof c.with.text], ["routine", k, "string", "string"], k);
      assert.ok(typeof says === "string" && says.length > 10 && says.endsWith("."), `${k}: ${says}`);
      assert.equal(triggerFields(given(k)).ok, true, `${k}: its example is one core takes`);
    }
  });

  test("a kind's fence checks what its trigger names against the project, before anything is kept", async () => {
    /** Each fenced kind with a trigger its fence looks at: a commit's with a place, a connection's as it is given, a file's with a place. */
    const FENCED = /** @type {Record<string, any>} */ ({ commit: { ...given("commit"), place: "packages/app" }, connection: given("connection"), file: { ...given("file"), place: "packages/app" } });
    assert.deepEqual(Object.keys(TRIGGER_FENCES), Object.keys(FENCED));
    for (const [k, trigger] of Object.entries(FENCED)) {
      assert.ok(/** @type {readonly string[]} */ (TRIGGER_KINDS).includes(k) && typeof (/** @type {any} */ (TRIGGER_FENCES)[k]) === "function", k);
      const store = createSpaceStore({ dir: null, now: () => T });
      const base = { store, project: "p1", chain: "c1", name: null, nameOf };
      /** @param {boolean} ok @returns {import("../src/app/agent/space.js").SpaceAt} */
      const at = (ok) => ({
        ...base,
        placeIn: async () => (ok ? { ok: true, place: "/r/packages/app" } : { ok: false, error: "the project says no" }),
        toolReads: async () => (ok ? { ok: true } : { ok: false, error: "the project says no" }),
      });
      const call = { action: "routine", with: { title: `Of ${k}`, text: "x", trigger } };
      const refused = await spaceRun(call, at(false), T);
      assert.deepEqual([refused.ok, words(refused)], [false, "Not written: the project says no."], k);
      const unwired = await spaceRun(call, base, T);
      assert.ok(!unwired.ok && words(unwired).startsWith("Not written: "), `${k}: ${words(unwired)}`);
      assert.equal(store.get("p1").routines.length, 0, `${k}: nothing kept`);
      const taken = await spaceRun(call, at(true), T);
      assert.equal(taken.ok, true, `${k}: ${words(taken)}`);
      assert.deepEqual(store.get("p1").routines.map((r) => r.trigger), [read(trigger)], k);
    }
    // A kind with no fence is kept as core reads it, whatever the project's checks would say.
    for (const k of TRIGGER_KINDS.filter((x) => !(x in TRIGGER_FENCES))) {
      const store = createSpaceStore({ dir: null, now: () => T });
      const r = await spaceRun({ action: "routine", with: { title: `Of ${k}`, text: "x", trigger: given(k) } }, { store, project: "p1", chain: "c2", name: null, nameOf, placeIn: async () => ({ ok: false, error: "no" }), toolReads: async () => ({ ok: false, error: "no" }) }, T);
      assert.equal(r.ok, true, `${k}: ${words(r)}`);
    }
  });
});

// A kind is named where it is its own: its row in core/watchers.js, and its source's file under app/watchers/. The
// readers of a trigger — core, the store, the space tool, the routines' runner, the packet — read the row, or a record
// by kind of their own, and compare no kind's name: a new kind adds an entry, never a branch.
describe("ratchet: no reader of a trigger branches on a kind's name", () => {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  /** @param {string} dir @returns {string[]} */
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const rel = (/** @type {string} */ p) => relative(ROOT, p).split("\\").join("/");
  /** The files that read a trigger or a watch event whole, where a bare `kind` is theirs too. */
  const READERS = ["src/core/routines.js", "src/services/spaces.js", "src/app/agent/space.js", "src/app/routines.js", "src/app/watchers/packet.js"];
  const files = [...new Set([...walk(join(ROOT, "src", "core")).map(rel).filter((f) => f.endsWith(".js") && f !== "src/core/watchers.js"), ...READERS])].sort();
  const NAME = `["'](?:${TRIGGER_KINDS.join("|")})["']`;
  /** Something's `.kind` compared with a kind's name, either way round, or looked for in a list of them: the name before `.kind` is whose. */
  const OF = [new RegExp(`(\\w+)\\??\\.kind\\s*[!=]==?\\s*${NAME}`, "g"), new RegExp(`${NAME}\\s*[!=]==?\\s*(?:\\w+\\??\\.)*(\\w+)\\??\\.kind\\b`, "g"), new RegExp(`\\[[^\\]]*${NAME}[^\\]]*\\]\\.includes\\(\\s*(?:\\w+\\??\\.)*(\\w+)\\??\\.kind\\b`, "g")];
  /** …and a kind held in a variable of its own, or a switch's case, in the files that read triggers. */
  const BARE = [new RegExp(`(?<![\\w.?])kind\\s*[!=]==?\\s*${NAME}`), new RegExp(`${NAME}\\s*[!=]==?\\s*kind\\b`), new RegExp(`\\bcase\\s+${NAME}\\s*:`), new RegExp(`\\[[^\\]]*${NAME}[^\\]]*\\]\\.includes\\(\\s*kind\\b`)];
  /**
   * Whose `.kind` is no trigger's and no watch event's, by the name the code gives it: a row of Needs you (`n`, `x` —
   * "ask" is a row's kind too) and a tool call's card (`card` — "shell" and "subagent" are a card's).
   */
  const NOT_A_TRIGGER = new Set(["n", "x", "card"]);
  /**
   * The store's writers of one source's own cursor: `watchAsked` keeps a connection's answer, `watchHead` a commit's
   * head, and each refuses a watcher of any other kind. They are that kind's own place in the store, as its source's
   * file is under app/watchers/: a new source writes through a method of its own, or through `watchTrouble`, which
   * goes by the row.
   */
  const OWN_WRITERS = new Set(["watchAsked", "watchHead"]);
  /** The store's method a line is in: the nearest one opened above it. @param {string[]} lines @param {number} i */
  const methodAt = (lines, i) => {
    for (let j = i; j >= 0; j--) {
      const m = /^ {4}(?:async )?(\w+)\(.*\) \{$/.exec(lines[j]);
      if (m) return m[1];
    }
    return "";
  };
  /** Whether a line compares a trigger's or a watch event's kind with a kind's name. @param {string} line @param {boolean} reader */
  const compares = (line, reader) => OF.some((re) => [...line.matchAll(re)].some((m) => !NOT_A_TRIGGER.has(m[1]))) || (reader && BARE.some((re) => re.test(line)));

  test("the rule reads a comparison, a list and a switch, and lets a record by kind be", () => {
    for (const line of ['if (r.trigger?.kind !== "commit") return null;', 'if (t.trigger.kind === "connection") {', 'return "turn" === e.kind;', 'if (["commit", "connection"].includes(t.kind)) return false;', "const own = e.kind == 'task';"]) assert.equal(compares(line, false), true, line);
    for (const line of ['if (kind === "ask") return 1;', '      case "commit":', 'if (["turn", "task"].includes(kind)) n += 1;']) assert.deepEqual([compares(line, true), compares(line, false)], [true, false], line);
    for (const line of ['if (n.kind === "ask" && n.ask) {', 'x.kind === "ask" && x.ask?.chain === at.chain', 'one(card.kind === "shell" ? commandLabel(target) : target)', 'if (s.kind === "every") return 1;', "const fence = TRIGGER_FENCES[t.kind];", 'trigger: { kind: "commit", branch }', "if (t.kind !== e.kind) return false;"]) assert.equal(compares(line, true), false, line);
  });

  test("outside core/watchers.js and a source's own file, no reader compares a trigger's or an event's kind with a kind's name", () => {
    assert.ok(files.length > 100 && READERS.every((f) => files.includes(f)), "the files are read");
    /** @type {string[]} */
    const offenders = [];
    for (const f of files) {
      const lines = readFileSync(join(ROOT, f), "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!compares(line, READERS.includes(f))) return;
        if (f === "src/services/spaces.js" && OWN_WRITERS.has(methodAt(lines, i))) return;
        offenders.push(`${f}:${i + 1} ${line.trim().slice(0, 120)}`);
      });
    }
    assert.deepEqual(offenders, []);
  });
});
