// @ts-check
// The signs on a worker's trail (HarnessV3-TaskGraph-v2 §12, TG2-D15): the moments someone reading along would look up
// at — it said its plan, it made its first change, it wrote outside its files, the same command failed again, it waits
// for an answer (the developer's on a call, or, TG2-D49, its lead's to its question), and (TG2-D48) it asked to run or
// started a step that cannot be undone, or its context was compacted, which may have taken its brief. Each is a rule
// over the run's events, no model's judgment: a sign makes the lead's look due at once and is named in it. It stops,
// refuses and delays nothing.
//
// The plan is a sign once the run goes on from it — its first call, or its next round: a first reply that is also the
// last is the worker's report, which reaches its lead by itself. A plan is what the worker said: its thinking is none,
// as no lead reads a worker's thinking (HarnessV3-TaskGraph-v2 TG2-D60).
//
// The steps that cannot be undone are one list (`oneWayOf`): the signs read it here, the watcher (core/watch.js) and a
// brief's grants (app/agent/grants.js) from here.
//
// Read one event at a time (`signStep`), as a run goes, or off a whole log (`signsOf`). Pure.
import { writeNames } from "./task-graph.js";

/** @typedef {"plan" | "change" | "outside" | "failure" | "asks" | "one-way" | "compacted"} SignKind */
/**
 * @typedef {object} Sign
 * @property {SignKind} kind
 * @property {number} round  the round it showed in
 * @property {number} at  the event that showed it (0 where the event carried no number)
 * @property {string} words  how a look names it
 */
/**
 * @typedef {object} WorkerFiles  what a worker's task says of its files
 * @property {readonly string[]} [writes]  a graph task's writes: files and globs, the only ones it changes
 * @property {readonly string[]} [files]  a brief's files; an entry that is no path (it has blanks) names none
 * @property {readonly string[]} [dontTouch]  a brief's "do not touch"; the same
 */
/**
 * @typedef {object} SignState  what the signs remember of a run so far
 * @property {boolean} plan  it has said something
 * @property {number} planned  the round it first did, while that is not yet a sign: the run has not gone on from it (0: none waits)
 * @property {boolean} change  it has made a change
 * @property {Set<string>} outside  the paths outside its files it wrote, each named once
 * @property {Map<string, number>} fails  each command's failed runs
 * @property {Map<string, string>} open  its commands still running, by call
 * @property {Set<string>} oneWay  the steps that cannot be undone it asked to run or started, each named once
 * @property {number} round  the round it is in
 */

/** @returns {SignState} */
export const newSignState = () => ({ plan: false, planned: 0, change: false, outside: new Set(), fails: new Map(), open: new Map(), oneWay: new Set(), round: 0 });

/** What a call does where its event carried no card: Filament's own hands, by name. */
const KIND_BY_NAME = Object.freeze({ write: "write", edit: "edit", bash: "shell", powershell: "shell", bash_background: "shell" });

/**
 * A command that cannot be undone from the session, by its shape, and what a look calls it. A list, not a proof: a
 * one-way step in another shape is the watcher's to notice.
 * @type {readonly (readonly [RegExp, string])[]}
 */
const ONE_WAY = Object.freeze([
  [/\bgit\s+push\b/i, "a push"],
  [/\bgit\s+reset\s+--hard\b/i, "a hard reset"],
  [/\bgit\s+clean\s+-[a-z]*f/i, "a clean of untracked files"],
  [/\bgit\s+branch\s+-D\b/, "a branch deleted"],
  [/\bgit\s+(?:checkout|restore)\s+(?:--\s+\S|\.(?:\s|$))/i, "changes discarded"],
  [/\bgit\s+stash\s+(?:drop|clear)\b/i, "a stash dropped"],
  [/\brm\s+-[a-z]*r/i, "a recursive delete"],
  [/\b(?:rmdir|rd)\s+\/s\b/i, "a recursive delete"],
  [/\bdel\s+(?:\S+\s+)*\/s\b/i, "a recursive delete"],
  [/\bRemove-Item\b[^|;&]*-Recurse\b/i, "a recursive delete"],
  [/\bdrop\s+(?:table|database|schema)\b/i, "a table or database dropped"],
  [/\btruncate\s+table\b/i, "a table emptied"],
  [/\b(?:npm|pnpm|yarn|cargo)\s+publish\b/i, "a publish"],
  [/\btwine\s+upload\b/i, "a publish"],
  [/\bgh\s+(?:release\s+create|pr\s+merge|repo\s+delete)\b/i, "a release, merge or deletion on GitHub"],
  [/\bterraform\s+(?:apply|destroy)\b/i, "a change to live infrastructure"],
  [/\bkubectl\s+delete\b/i, "a change to live infrastructure"],
  [/\bdocker\s+(?:system|volume)\s+prune\b/i, "a prune of Docker's data"],
  [/\bmkfs(?:\.\w+)?\b|\bdd\s+[^|;&]*\bof=/i, "a disk overwritten"],
]);

/** What a command that cannot be undone is called, or null. @param {string} command */
export function oneWayOf(command) {
  const c = String(command || "");
  return ONE_WAY.find(([re]) => re.test(c))?.[1] ?? null;
}

/**
 * What a compaction left a summary of, in a look's words (TG2-D48) — or null for one that folded nothing: a fold that
 * stood down, a Compact that found too little, one that failed (the rule the lead's watch counts compactions by,
 * app/agent/subagents.js `relay`). On Filament's loop a worker's brief stays whole and its oldest rounds fold; a coding
 * agent's own compaction may take its brief.
 * @param {any} e  the run's compaction event
 */
function compactedWords(e) {
  if (e.stoodDown || e.result) return null;
  if (e.own) return "compacted its own context: its brief and what it read may be only a summary now";
  if (e.why === "overflow-refusal") return `compacted its context after its provider refused a round for size: ${e.folded ? "its oldest rounds are a summary now — its brief stays whole" : "its old tool results were cleared"}`;
  const from = Number(e.fromRound) || 0;
  const to = Number(e.toRound) || 0;
  if (!from || !to) return "compacted its context";
  return `compacted its context${e.manual ? " on the developer's request" : ""}: its ${from === to ? `round ${from} is` : `rounds ${from} to ${to} are`} a summary now — its brief stays whole`;
}
/** An entry of a brief's list that names a path: it has no blanks. @param {unknown} s */
const pathLike = (s) => typeof s === "string" && s.trim() !== "" && !/\s/.test(s.trim());
/** The entries of a list that name paths. @param {readonly string[] | undefined} list */
const paths = (list) => (Array.isArray(list) ? list.filter(pathLike) : []);

/**
 * Why a write to `path` is outside the worker's files, in a look's words, or null: its task's writes do not name it,
 * its brief names files and not this one, or its brief said not to touch it.
 * @param {WorkerFiles | null | undefined} files @param {string} path
 */
export function outsideWhy(files, path) {
  if (!files || !path) return null;
  const dont = paths(files.dontTouch);
  if (dont.some((w) => writeNames(w, path))) return "wrote to a file its brief said not to touch";
  const writes = paths(files.writes);
  if (writes.length && !writes.some((w) => writeNames(w, path))) return "wrote outside its task's writes";
  const named = paths(files.files);
  if (named.length && !named.some((w) => writeNames(w, path))) return "wrote outside its files";
  return null;
}

/**
 * The signs one event shows, given the run so far; `state` moves with it.
 * @param {SignState} state @param {any} e  a run's event @param {WorkerFiles | null} [files]
 * @returns {Sign[]}
 */
export function signStep(state, e, files = null) {
  if (!e || typeof e !== "object") return [];
  const at = Number(e.n) > 0 ? Number(e.n) : 0;
  if (Number(e.round) > state.round) state.round = Number(e.round);
  const round = Number.isFinite(Number(e.round)) && e.round != null ? Number(e.round) : state.round;
  /** @type {Sign[]} */
  const out = [];
  /** @param {SignKind} kind @param {string} words @param {number} [inRound] */
  const sign = (kind, words, inRound = round) => void out.push({ kind, round: inRound, at, words });
  /** A step that cannot be undone, the first time the run shows it: asked to run, or started. @param {string} command @param {string} how */
  const oneWay = (command, how) => {
    const what = oneWayOf(command);
    if (!what || state.oneWay.has(command)) return;
    state.oneWay.add(command);
    sign("one-way", `${how} a step that cannot be undone: ${what} (\`${command}\`)`);
  };
  // The run goes on from its first reply: what it said there is its plan.
  if (state.planned && (e.type === "tool-start" || (e.type === "round-start" && Number(e.round) > state.planned))) {
    sign("plan", "said how it will go about its task", state.planned);
    state.planned = 0;
  }
  switch (e.type) {
    case "round-text":
      if (!state.plan && String(e.text ?? "").trim()) {
        state.plan = true;
        state.planned = round || 1;
      }
      break;
    case "tool-start": {
      const kind = String(e.card?.kind || /** @type {Record<string, string>} */ (KIND_BY_NAME)[String(e.name)] || "");
      const subject = String(e.card?.subject ?? e.args ?? "");
      if (kind === "shell" && !/_(output|kill)$/.test(String(e.name))) {
        const command = String(e.args ?? subject);
        if (e.id != null) state.open.set(String(e.id), command);
        oneWay(command, "tried");
      }
      if (kind !== "write" && kind !== "edit") break;
      if (!state.change) {
        state.change = true;
        sign("change", `made its first change (${subject})`);
      }
      const why = outsideWhy(files, subject);
      if (why && !state.outside.has(subject)) {
        state.outside.add(subject);
        sign("outside", `${why} (${subject})`);
      }
      break;
    }
    case "tool-end": {
      const command = state.open.get(String(e.id ?? ""));
      if (command === undefined) break;
      state.open.delete(String(e.id));
      // A command refused, declined or never run has no end of its own; a stop's cut is the developer's, no failure.
      if (e.refused || e.declined || e.vetoed || e.notRun || e.stopped) break;
      if (typeof e.exitCode !== "number" || e.exitCode === 0) break;
      const n = (state.fails.get(command) || 0) + 1;
      state.fails.set(command, n);
      if (n >= 3) sign("failure", `the same command failed ${n === 3 ? "a third time" : `${n} times`} (\`${command}\`)`);
      break;
    }
    case "ask":
      if (!e.waits) break;
      // A question to its lead (TG2-D49) is the lead's to answer: it has no call, and no command to be. Its plan, while its
      // lead reviews it (TG2-D50), waits for a go.
      if (e.kind === "lead") {
        sign("asks", e.plan ? "sent you its plan, and waits for your go" : "asks you a question, and waits for your answer");
        break;
      }
      sign("asks", `waits for the developer's answer${e.tool ? ` (${e.tool})` : ""}`);
      // A call that waits shows its command whole: a step that cannot be undone is a sign while the answer can be no.
      if (e.command) oneWay(String(e.command), "asks to run");
      break;
    case "compaction": {
      const words = compactedWords(e);
      if (words) sign("compacted", words);
      break;
    }
  }
  return out;
}

/**
 * Every sign a run's log shows, in order (TG2-D15; the Watcher's first two are among them, HarnessV4_Agents_Plan L-66).
 * @param {readonly any[]} events  the run's events in order @param {WorkerFiles | null} [files]
 * @returns {Sign[]}
 */
export function signsOf(events, files = null) {
  const state = newSignState();
  return (events || []).flatMap((e) => signStep(state, e, files));
}
