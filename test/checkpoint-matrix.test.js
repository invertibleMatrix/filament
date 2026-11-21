// @ts-check
// The checkpoints an agent hears, readers by moments (app/agent/checkpoint.js, the owner's of 11-10: every nudge reaches
// Filament's loop and the coding agents alike): which blocks each reader hears at each moment, in order, how they reach
// it, and what it marks as said — and every way a loop's differ from a coding agent's named in DIVERGENCE, with why,
// read from the facts each real caller gives the composer: its source, as it stands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { compose, DIVERGENCE, MOMENTS, READERS, textOf, tickText, viaOf } from "../src/app/agent/checkpoint.js";
import { startBlocks } from "../src/app/agent-context.js";

/** Every fact there is, each block's own words. @type {import("../src/app/agent/checkpoint.js").Facts} */
const ALL = {
  exits: "EXITS",
  fileNews: { text: "NEWS WITH HUNKS", names: "NEWS BY NAME" },
  open: "OPEN",
  sealed: "SEALED",
  where: "WHERE",
  back: { files: ["src/a.js"], plan: [{ text: "map", status: "doing" }], graph: "GRAPH", open: ["- bg_1"], letters: [{ id: "l1", from: "sa_1", subject: "Done" }], ended: ["- sa_2 ended"], skills: [{ name: "pdf", turn: 3 }] },
  handover: "HANDOVER",
  team: "TEAM",
  unplanned: "UNPLANNED",
  drift: "DRIFT",
  memory: "MEMORY",
  answer: "ANSWER",
  next: "NEXT",
  atOnce: "AT ONCE",
  now: "NOW",
  alsoOpen: "ALSO OPEN",
  started: "STARTED",
  onTask: "ON TASK",
};

/** A reader's blocks at every moment, by id, with how they reach it. @param {import("../src/app/agent/checkpoint.js").Reader} reader */
const row = (reader) => Object.fromEntries(MOMENTS.map((m) => [m, `${compose(m, reader, ALL).blocks.map((b) => b.id).join(" ")} | ${viaOf(m, reader)}`]));

const START = "shell-exits file-news still-open sealed where | message";
const MAIN = {
  "turn-start": START,
  switch: "shell-exits file-news handover sealed | message",
  "after-compact": "back sealed | message",
  // What is still open where a change waited long in the turn (still-open.js `waited`), ahead of what the call met.
  action: "still-open memory unplanned drift | message",
  tick: "answer at-once next now started also-open | tool-answer",
  note: "on-task | message",
};
/**
 * A coding agent's, by how words reach its running turn: its commands' ends reach it otherwise than at a turn's start
 * (DIVERGENCE shell-exits-start). A note goes with the developer's words, which are a steer of their own.
 * @param {"steer" | "tool-answer"} mid
 */
const coding = (mid) => ({
  ...MAIN,
  "turn-start": "file-news still-open sealed where | message",
  switch: "file-news handover sealed | message",
  "after-compact": `back sealed | ${mid}`,
  action: `still-open memory unplanned drift | ${mid}`,
  note: "on-task | steer",
});

test("the composer's rules: each reader's blocks at each moment from every fact, in order, and how they reach it", () => {
  assert.deepEqual(row(READERS.loop), MAIN);
  for (const r of [READERS.claude, READERS.codex, READERS.cursorSdk]) assert.deepEqual(row(r), coding("steer"));
  // Cursor's CLI takes words only once a step ended: what comes mid-turn rides Filament's next tool answer to it.
  assert.deepEqual(row(READERS.cursorCli), coding("tool-answer"));
  // A coding lead hears its team as it stands after what comes back (team-tools.js `teamNow`); the loop's lead hears
  // which of its workers ended inside what comes back (DIVERGENCE lead-team, lead-ended).
  assert.deepEqual(row(READERS.loopLead), MAIN);
  assert.deepEqual(row(READERS.codingLead), { ...coding("steer"), "after-compact": "back team sealed | steer" });
  // A sub-agent has no envelope tool.
  const sealedOff = (/** @type {Record<string, string>} */ r) => Object.fromEntries(Object.entries(r).map(([m, s]) => [m, s.replace(/ sealed(?=[ |])/, "")]));
  assert.deepEqual(row(READERS.loopWorker), sealedOff(MAIN));
  assert.deepEqual(row(READERS.codingWorker), sealedOff(coding("steer")));
});

/** The callers of the composer, by the kind of agent each composes for: a tick is the tasks tool's answer to both. */
const CALLERS = /** @type {const} */ ([
  ["src/app/agent/loop.js", "loop"],
  ["src/app/agent/graph-runner.js", "both"],
  ["src/app/acp-turn.js", "coding"],
]);
/** What comes back after a compaction, by its parts (checkpoint.js `BackParts`). */
const BACK_PARTS = ["files", "plan", "graph", "open", "letters", "ended", "skills"];

/** A file of Filament's, parsed. @param {string} path */
const parsed = (path) => ts.createSourceFile(path, readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
/** Each node under `n`, `n` first. @param {ts.Node} n @param {(n: ts.Node) => void} f */
const walk = (n, f) => {
  f(n);
  ts.forEachChild(n, (k) => walk(k, f));
};
/** The object literal a value is, or holds — a conditional's branch, an `||`'s side. @param {ts.Node | undefined} e */
const objectIn = (e) => {
  /** @type {ts.ObjectLiteralExpression | null} */
  let found = null;
  if (e) walk(e, (n) => void (!found && ts.isObjectLiteralExpression(n) && (found = n)));
  return /** @type {ts.ObjectLiteralExpression | null} */ (found);
};
/** Whether a value gives anything: never `null`, an empty list or "". @param {ts.Expression} e */
const gives = (e) => !(e.kind === ts.SyntaxKind.NullKeyword || (ts.isArrayLiteralExpression(e) && !e.elements.length) || (ts.isStringLiteral(e) && !e.text));
/**
 * The declaration of `name` nearest before `at` in the blocks around it: what a spread of it gives.
 * @param {ts.Node} at @param {string} name @returns {ts.Expression | null}
 */
const declared = (at, name) => {
  for (let n = at.parent; n; n = n.parent)
    if (ts.isBlock(n) || ts.isSourceFile(n))
      for (const s of n.statements)
        if (s.pos < at.pos && ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) return d.initializer;
  return null;
};
/**
 * The facts an object literal gives, by name — a spread's by what it spreads — and of what comes back, its parts that
 * give anything. @param {ts.ObjectLiteralExpression} o
 */
const factsGiven = (o) => {
  /** @type {Set<string>} */
  const keys = new Set();
  /** @type {Set<string>} */
  const back = new Set();
  for (const p of o.properties) {
    if (ts.isSpreadAssignment(p)) {
      const from = ts.isIdentifier(p.expression) ? objectIn(declared(p, p.expression.text) ?? undefined) : null;
      for (const q of from?.properties || []) if (q.name && ts.isIdentifier(q.name)) keys.add(q.name.text);
      continue;
    }
    if (!p.name || !ts.isIdentifier(p.name)) continue;
    keys.add(p.name.text);
    if (p.name.text !== "back" || !ts.isPropertyAssignment(p)) continue;
    for (const q of objectIn(p.initializer)?.properties || []) if (ts.isPropertyAssignment(q) && ts.isIdentifier(q.name) && gives(q.initializer)) back.add(q.name.text);
    for (const q of objectIn(p.initializer)?.properties || []) if (ts.isShorthandPropertyAssignment(q)) back.add(q.name.text);
  }
  return { keys, back };
};

/**
 * What each kind's callers give the composer at each moment: the facts, and the parts of what comes back — the loop's
 * with what its `reattach` reads as it renders the block, past the composer (turn.js: what is still open, a lead's
 * workers that ended, read where the block is said).
 */
const gathered = (() => {
  /** @type {Map<string, Map<string, { keys: Set<string>, back: Set<string> }>>} */
  const by = new Map([["loop", new Map()], ["coding", new Map()]]);
  /** @param {string} kind @param {string} moment */
  const at = (kind, moment) => {
    const m = /** @type {Map<string, { keys: Set<string>, back: Set<string> }>} */ (by.get(kind));
    if (!m.has(moment)) m.set(moment, { keys: new Set(), back: new Set() });
    return /** @type {{ keys: Set<string>, back: Set<string> }} */ (m.get(moment));
  };
  for (const [path, kind] of CALLERS)
    walk(parsed(path), (n) => {
      if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== "compose" || n.arguments.length !== 3) return;
      const [moment, , facts] = n.arguments;
      assert.ok(ts.isStringLiteral(moment) && ts.isObjectLiteralExpression(facts), `${path}: compose's moment a word, its facts an object, as the test reads them`);
      const g = factsGiven(facts);
      for (const k of kind === "both" ? ["loop", "coding"] : [kind]) {
        const into = at(k, moment.text);
        for (const x of g.keys) into.keys.add(x);
        for (const x of g.back) into.back.add(x);
      }
    });
  walk(parsed("src/app/agent/turn.js"), (n) => {
    if (!ts.isPropertyAssignment(n) || !ts.isIdentifier(n.name) || n.name.text !== "reattach") return;
    walk(n.initializer, (c) => {
      if (!ts.isCallExpression(c) || !ts.isIdentifier(c.expression) || c.expression.text !== "reattachBlock") return;
      const o = c.arguments[0];
      if (o && ts.isObjectLiteralExpression(o)) for (const q of o.properties) if (ts.isPropertyAssignment(q) && ts.isIdentifier(q.name) && BACK_PARTS.includes(q.name.text) && gives(q.initializer)) at("loop", "after-compact").back.add(q.name.text);
    });
  });
  return by;
})();
/**
 * The facts that are no block's words: each says how a block stands — what comes back is owed since a compaction
 * (`owed`), an earlier message holds where the agent stands (`whereHeld`). A caller that gives one gives it true or
 * false as the turn stands, so each is weighed both ways (`standsOf`).
 */
const STANDS = /** @type {const} */ (["owed", "whereHeld"]);
/**
 * The facts a kind's callers give at `moment`, each with every fact's words, and of what comes back the parts they give
 * — the rest none; of the facts that say how a block stands, those of `stands` the kind's callers give, true.
 * @param {"loop" | "coding"} kind @param {string} moment @param {readonly string[]} [stands]
 * @returns {import("../src/app/agent/checkpoint.js").Facts}
 */
const factsOf = (kind, moment, stands = []) => {
  const g = gathered.get(kind)?.get(moment);
  if (!g) return {};
  /** @type {any} */
  const facts = Object.fromEntries([...g.keys].filter((k) => k !== "back" && k in ALL).map((k) => [k, /** @type {any} */ (ALL)[k]]));
  if (g.keys.has("back")) facts.back = Object.fromEntries(BACK_PARTS.map((p) => [p, g.back.has(p) ? /** @type {any} */ (ALL.back)[p] : p === "files" ? [] : null]));
  for (const s of stands) if (g.keys.has(s)) facts[s] = true;
  return facts;
};
/** The ways a block may stand at `moment` that a caller of either kind says: none, then each alone. @param {string} moment */
const standsOf = (moment) => [[], ...STANDS.filter((s) => [...gathered.values()].some((m) => m.get(moment)?.keys.has(s))).map((s) => [s])];

// (fails before: yes — the review of 11-11: the matrix gave both kinds every fact and held only the composer's rules, so
// what the callers gather never showed: a coding agent's turn start took no command's end, its lead heard its team where
// the loop's heard which workers ended, and what comes back after a compaction kept the loop's checklist and letters
// alone — none named here)
test("every way what a loop hears differs from what a coding agent hears, as their callers gather it, is named in DIVERGENCE, with why — and DIVERGENCE names no more", () => {
  const composed = new Set([...gathered.values()].flatMap((m) => [...m.keys()]));
  // Every moment the composer has is one a caller composes: a row no caller reads would hold no one to it.
  assert.deepEqual([...composed].sort(), [...MOMENTS].sort());
  const pairs = [
    [READERS.loop, READERS.claude],
    [READERS.loopLead, READERS.codingLead],
    [READERS.loopWorker, READERS.codingWorker],
    [READERS.loop, READERS.cursorCli],
  ];
  /** @type {Set<string>} */
  const seen = new Set();
  /** The entry that names a difference, which the test sees. @param {string} m @param {(d: (typeof DIVERGENCE)[number]) => boolean} f @param {string} what */
  const named = (m, f, what) => {
    const d = DIVERGENCE.find((x) => x.moments.includes(m) && f(x));
    assert.ok(d, `${m}: ${what}, unnamed`);
    seen.add(d.id);
  };
  // (fails before: yes — the re-review of 11-11: `owed` and `whereHeld` never reached the composer here, so the block a
  // coding agent is owed at a turn's start, and what it goes in place of, showed nowhere and had no entry)
  assert.deepEqual(standsOf("turn-start"), [[], ["owed"], ["whereHeld"]], "what the callers say of how a turn's start stands");
  for (const [loop, agent] of pairs)
    for (const m of composed)
      for (const stands of standsOf(m)) {
        const a = compose(/** @type {any} */ (m), loop, factsOf("loop", m, stands)).blocks;
        const b = compose(/** @type {any} */ (m), agent, factsOf("coding", m, stands)).blocks;
        // What comes back, owed, goes in place of what is open and of where it stands: its entry says so. Where a
        // summary's head holds where the loop stands, the loop's start alone is told, and leaves the block out.
        const owedTo = (/** @type {string} */ id) => (stands.includes("owed") && (id === "still-open" || id === "where") ? "owed-back" : stands.includes("whereHeld") && id === "where" ? "where-held" : "");
        for (const x of a.filter((x) => !b.some((y) => y.id === x.id))) named(m, (d) => (owedTo(x.id) ? d.id === owedTo(x.id) : d.block === x.id && d.only === "loop" && !d.part), `${x.id} the loop's alone${stands.length ? ` (${stands})` : ""}`);
        for (const y of b.filter((y) => !a.some((x) => x.id === y.id))) named(m, (d) => (owedTo(y.id) ? d.id === owedTo(y.id) : d.block === y.id && d.only === "coding" && !d.part), `${y.id} a coding agent's alone${stands.length ? ` (${stands})` : ""}`);
        for (const x of a) {
          const y = b.find((k) => k.id === x.id);
          if (!y || JSON.stringify(x) === JSON.stringify(y)) continue;
          // What comes back, part by part: each one kind alone gets is named.
          if (x.id === "back") {
            for (const p of BACK_PARTS) {
              const [px, py] = [/** @type {any} */ (x.back)?.[p], /** @type {any} */ (y.back)?.[p]];
              if (JSON.stringify(px) !== JSON.stringify(py)) named(m, (d) => d.block === "back" && d.part === p && d.only === (py == null || (Array.isArray(py) && !py.length) ? "loop" : "coding"), `back's ${p} one kind's alone`);
            }
          } else named(m, (d) => d.block === x.id && !d.part && !d.only, `${x.id} heard in another form`);
        }
      }
  // A reader reached otherwise than a coding agent that takes words while it works is named too (FabeleHelper's of 11-10).
  for (const m of MOMENTS) {
    const way = viaOf(m, READERS.cursorCli);
    if (way !== viaOf(m, READERS.claude)) named(m, (d) => d.via === way, `Cursor CLI reached by ${way}`);
  }
  // DIVERGENCE claims no more than the callers make: each entry is a difference seen.
  for (const d of DIVERGENCE) {
    assert.ok(d.why.length > 40, d.id);
    assert.ok(seen.has(d.id), `${d.id}: no difference the callers make`);
  }
});

test("the forms: the loop hears what changed in a file, a coding agent its name and count; the files come back to the loop alone", () => {
  assert.equal(textOf(compose("turn-start", READERS.loop, { fileNews: ALL.fileNews }).blocks), "NEWS WITH HUNKS");
  assert.equal(textOf(compose("turn-start", READERS.claude, { fileNews: ALL.fileNews }).blocks), "NEWS BY NAME");
  assert.deepEqual(compose("after-compact", READERS.loop, ALL).blocks[0].back?.files, ["src/a.js"]);
  assert.deepEqual(compose("after-compact", READERS.claude, ALL).blocks[0].back, { ...ALL.back, files: [] });
});

// FabeleHelper's of 11-10 on the design: what comes back after a coding agent's compaction, never heard by its turn's
// end, rides its next turn's start in place of what is open and where it stands — nothing said twice.
test("an owed compaction's block rides the next turn's start in place of what is open and where it stands; the sealed list after it", () => {
  const owed = compose("turn-start", READERS.claude, { ...ALL, owed: true });
  // (fails before: yes — FabeleHelper's of 11-10: the sealed list, no part of the block, went unsaid)
  assert.deepEqual(owed.blocks.map((b) => b.id), ["file-news", "back", "sealed"]);
  // Where it stands goes only where the block carries the graph.
  assert.deepEqual(compose("turn-start", READERS.claude, { ...ALL, owed: true, back: { .../** @type {any} */ (ALL.back), graph: null } }).blocks.map((b) => b.id), ["file-news", "back", "sealed", "where"]);
  // Where a summary's head holds where it stands already, it is not said again.
  assert.deepEqual(compose("turn-start", READERS.loop, { ...ALL, whereHeld: true }).blocks.map((b) => b.id), ["shell-exits", "file-news", "still-open", "sealed"]);
});

// (fails before: yes — FabeleHelper's 4 on 4e37bf0dd: the tick's order put Next after the weigh line and also-open before
// what Filament started, where the answers say them the other way)
test("a tick in today's order: the answer's own words, at-once, next and how the work stands in a line; what Filament started and what else is open after", () => {
  assert.equal(tickText(compose("tick", READERS.claude, ALL).blocks), "ANSWER AT ONCE NEXT NOW\nSTARTED\nALSO OPEN");
  assert.equal(tickText(compose("tick", READERS.loop, { answer: "ANSWER", now: "NOW", alsoOpen: "ALSO OPEN" }).blocks), "ANSWER NOW\nALSO OPEN");
});

// (fails before: yes — the hunt of 11-10 on switch-once, sw-map: acp-turn mapped every block that was not what is open
// or the envelopes to where it stands, so what changed in the files, given to a move, was said as where it stands)
test("a coding agent's first prompt carries each block by its id: what changed in the files at a move is no where block", () => {
  const as = { open: () => ({ id: "open", text: "OPEN" }), sealed: () => ({ id: "envelopes", text: "SEALED" }), where: () => ({ id: "where", text: "WHERE" }) };
  const moved = startBlocks(compose("switch", READERS.claude, { fileNews: ALL.fileNews, handover: "HANDOVER", sealed: "SEALED" }).blocks, as);
  assert.deepEqual(moved, [{ id: "file-news", text: "NEWS BY NAME" }, { id: "open", text: "OPEN" }, { id: "envelopes", text: "SEALED" }]);
  const started = startBlocks(compose("turn-start", READERS.claude, ALL).blocks, as);
  assert.deepEqual(started.map((b) => b.id), ["file-news", "open", "envelopes", "where"]);
  assert.equal(started.filter((b) => b.id === "where").length, 1, "where it stands, from its own block alone");
});

test("marks: every block composed is marked as said once delivered, but a tick's answer, which is the tool's own", () => {
  assert.deepEqual(compose("tick", READERS.claude, ALL).marks, ["at-once", "next", "now", "started", "also-open"]);
  assert.deepEqual(compose("turn-start", READERS.loop, { open: "OPEN", where: "" }).marks, ["still-open"], "an empty fact is no block");
  assert.deepEqual(compose("turn-start", READERS.loop, {}), { blocks: [], via: "message", marks: [] });
});
