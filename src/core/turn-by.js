// @ts-check
// Who begins a chat's turn (the one marker): the person, one of Filament's own, or a coding agent by itself. Every turn
// begins with a message; most are the person's, many are Filament's. One frozen table names each kind and what it is, by
// traits named for what is asked of a turn — every reader asks a trait by its name, and none lists kinds. A turn's input
// names its kind (`turnBy`, `by`); the turn's row keeps it (`meta.by`, absent for the person's); one reader reads it
// back (`byOfTurn`).
//
// `unattended` is a fact of its own beside who begins the turn: nobody is at the page to answer (Filament's replay of a
// session's turns in a copy, replay-compare.js). A person's turn sent so asks no question and stamps no "the person
// wrote" (`personAt`), yet takes the room made for their message and is heard by letters as theirs; Filament's own turns
// ask nothing whether it is set or not. Another machine's agents' message (the turn's `commands: false`) is a person's
// kind too — their own words in their chat —, read as the person's by none of what marks the person's writing.

/**
 * @typedef {"person" | "wake" | "goal" | "resume" | "sync" | "beside" | "flow" | "thread" | "watch" | "guide" | "routine" | "ask" | "team" | "agent"} TurnBy
 * @typedef {{
 *   person: boolean,
 *   woken: boolean,
 *   line: boolean,
 *   opens: boolean,
 *   input: boolean,
 *   flag: string | null,
 *   what: string,
 * }} TurnKind
 *   `person`: its message is its sender's own words — the person's, or another machine's agents' in their own chat. Only
 *   such a message takes the room made for it, may be asked a question before it goes (compaction, a switch, a change, a
 *   cold cache), drives the chat's browser, is plain words that may name agents and teams, and — sent by the person, with
 *   someone there — stamps when they last wrote, halts a driving goal and is heard by letters. Every other kind is
 *   Filament's own, or a coding agent's: the turn starts by itself, asks nothing, and is refused to another machine's
 *   agents and in their chat once their device lets them in no more.
 *   `woken`: the chat's work stretch goes on with it (sessions/stretch.js) — what its agent waited on came (a command's
 *   end, a report, a team's result), a goal's round, or a cut turn going on.
 *   `line`: its message is Filament's line, written by the turn whatever the input's `content` says: no block waits to
 *   open it (a hunt's range waits for a team's first message).
 *   `opens`: the first message of a chat Filament made for it, taken only while that chat has no turn.
 *   `input`: a turn's input may name it; a coding agent's own turn never comes through one.
 *   `flag`: the boolean an older caller named it by, still read as this kind.
 *   `what`: the turn in words, for a refusal.
 */

/** @param {TurnKind} k */
const kind = (k) => Object.freeze(k);

/** Every kind of who begins a turn, and what each is. @type {Readonly<Record<TurnBy, Readonly<TurnKind>>>} */
export const TURN_BY = Object.freeze({
  person: kind({ person: true, woken: false, line: false, opens: false, input: true, flag: null, what: "the person's message" }),
  // A background command's end, a sub-agent's report, a letter, an idle check-in, a come-back (sessions/wake.js).
  wake: kind({ person: false, woken: true, line: true, opens: false, input: true, flag: "wake", what: "the wake" }),
  // A driving goal's next round (core/goal-drive.js).
  goal: kind({ person: false, woken: true, line: true, opens: false, input: true, flag: "goal", what: "the goal's round" }),
  // Going on with a turn a restart cut off (sessions/resume-cut.js).
  resume: kind({ person: false, woken: true, line: true, opens: false, input: true, flag: "resume", what: "the resume" }),
  // A sync from the project's Space, which the person ran (core/space.js).
  sync: kind({ person: false, woken: false, line: false, opens: false, input: true, flag: "sync", what: "the sync" }),
  // A team's or a flow's result reaching the main agent, or the turn a flow started In place opens (core/beside.js).
  beside: kind({ person: false, woken: true, line: false, opens: false, input: true, flag: "beside", what: "the team's result" }),
  // A flow's line to its team box: go on, or sent back from its gate (app/flow-runner.js).
  flow: kind({ person: false, woken: false, line: false, opens: false, input: true, flag: "byFilament", what: "the flow's line" }),
  // A thread's brief, its starter's agent's words (core/threads.js).
  thread: kind({ person: false, woken: false, line: false, opens: false, input: true, flag: "thread", what: "the thread's brief" }),
  // A watcher's wake of the chat that proposed it (app/routines.js `wakeChat`).
  watch: kind({ person: false, woken: false, line: false, opens: false, input: true, flag: "watch", what: "the watcher's turn" }),
  // A watcher's guidance to the chat it watches, where that chat is at rest (app/watchers/guidance.js).
  guide: kind({ person: false, woken: false, line: false, opens: false, input: true, flag: null, what: "the watcher's guidance" }),
  // A routine's run, in the chat made for it (app/routines.js; `meta.routine`).
  routine: kind({ person: false, woken: false, line: false, opens: true, input: true, flag: null, what: "the routine's run" }),
  // An app's ask from a Space, in the chat made for it (app/space-asks.js; `meta.ask`).
  ask: kind({ person: false, woken: false, line: false, opens: true, input: true, flag: null, what: "the ask's run" }),
  // A team's opening, its lead's first message in the team's own chat beside (app/teams-beside.js).
  team: kind({ person: false, woken: false, line: false, opens: true, input: true, flag: null, what: "the team's opening" }),
  // A turn a coding agent began by itself (`meta.own`, HarnessV3-ACP AC3-9).
  agent: kind({ person: false, woken: true, line: false, opens: false, input: false, flag: null, what: "the agent's own turn" }),
});

/** The kinds a turn's input may name, in the table's order. */
const NAMED = /** @type {TurnBy[]} */ (Object.keys(TURN_BY)).filter((k) => TURN_BY[k].input);

/** @param {unknown} v @returns {v is TurnBy} */
const isKind = (v) => typeof v === "string" && Object.hasOwn(TURN_BY, v);

/**
 * Who begins the turn an input asks for: its `by`, or the boolean an older caller named the kind by (`wake: true`,
 * `byFilament: true`, …), read as that kind; neither is the person's message. One kind at most: two at once, or a `by`
 * the table does not hold as an input's, is refused in words.
 * @param {any} input @returns {{ by: TurnBy } | { error: string }}
 */
export function turnBy(input) {
  /** @type {TurnBy[]} */
  const named = [];
  if (input?.by !== undefined) {
    if (!isKind(input.by) || !TURN_BY[input.by].input) return { error: `by is who begins the turn: one of ${NAMED.join(", ")}` };
    named.push(input.by);
  }
  for (const k of NAMED) {
    const flag = TURN_BY[k].flag;
    if (flag && input?.[flag] === true && !named.includes(k)) named.push(k);
  }
  if (named.length > 1) return { error: `a turn is begun by one kind, and this one names ${named.join(" and ")}` };
  return { by: named[0] || "person" };
}

/**
 * Who began a turn, as its row keeps it: its mark (`meta.by`), a coding agent's own turn (`meta.own`), a thread's brief
 * (`meta.brief`), else what `unmarked` reads of a turn with none — its caller's rule for turns begun before turns were
 * marked —, else the person. A mark no kind of the table names is read past, as none.
 * @param {{ meta?: any }} t @param {(t: any) => TurnBy | null} [unmarked]
 * @returns {TurnBy}
 */
export function byOfTurn(t, unmarked) {
  const by = t?.meta?.by;
  if (isKind(by)) return by;
  if (t?.meta?.own) return "agent";
  if (t?.meta?.brief === true) return "thread";
  return unmarked?.(t) || "person";
}
