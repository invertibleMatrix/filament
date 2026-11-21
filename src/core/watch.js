// @ts-check
// What a turn did, read off its run's events (HarnessV4_Tasks E15 step 7, AG-200): its calls, the files it wrote, its
// newest words — and the signs of trouble Filament sees there by itself, which a lead's look at its workers names. The
// agent that watched a turn and gave a verdict went on the owner's word of 11-05; the signs stayed.
//
// Three of the developer's four signs are rules over the log, no model's judgment: the same command failed a third time
// and a step that cannot be undone, by its shape (core/signs.js, which keeps the one list of such steps), and
// "verified" said where no command ran after the turn's newest change. Each makes a look due at once and is named in
// it. The fourth — work outside what was asked — is a reader's to judge, from what the developer asked for. A sign
// stops, refuses and delays nothing.
//
// Read one event at a time (`watchStep`): as a run goes, or over a turn's whole log once it ended. Pure.
import { newSignState, oneWayOf, signStep } from "./signs.js";

/** The developer's four signs, by key, as a look says them. */
export const WATCH_SIGNS = Object.freeze({
  outside: "outside what was asked",
  failing: "the same failing step again",
  unchecked: '"verified" with no check run',
  "one-way": "a step that cannot be undone",
});
/** @typedef {keyof typeof WATCH_SIGNS} WatchSignKind */
/**
 * @typedef {object} WatchSign  a sign Filament saw in the turn's log
 * @property {WatchSignKind} kind
 * @property {number} at  the event that showed it (0 where the event carried no number)
 * @property {string} words  how a look names it
 * @property {string} [command]  a failing sign's command, as its run named it (a stuck worker is sent to its lead,
 *   HarnessV3-TaskGraph-v2 TG2-D59)
 */
/**
 * @typedef {object} WatchState  what the watch remembers of a turn's run so far
 * @property {import("./signs.js").SignState} signs  the trail's own state: each command's failed runs
 * @property {number} tools  the turn's calls
 * @property {Set<string>} wrote  the files it wrote or edited
 * @property {string} lastWrite  the newest of them
 * @property {number} wroteAt  the newest write's place among the turn's calls (0: none)
 * @property {number} ranAt  the newest command's place that ran to its end (0: none)
 * @property {Map<string, number>} shells  its commands still running, by call, each with its place
 * @property {Set<string>} oneWay  the one-way commands named so far
 * @property {string} said  its newest words
 */

/** @returns {WatchState} */
export const newWatchState = () => ({ signs: newSignState(), tools: 0, wrote: new Set(), lastWrite: "", wroteAt: 0, ranAt: 0, shells: new Map(), oneWay: new Set(), said: "" });

/** What a call does where its event carried no card: Filament's own hands, by name. */
const KIND_BY_NAME = Object.freeze({ write: "write", edit: "edit", bash: "shell", powershell: "shell", bash_background: "shell" });

/** A claim that the work was checked, as a report says one — never one it denies ("not verified", "unverified"). */
const CLAIM = /(?<!\bnot\s)(?<!n't\s)(?<!\bun)\b(verified|tested|tests?\s+(?:now\s+)?pass(?:es|ed|ing)?|all\s+(?:the\s+)?tests|confirmed\s+working|works\s+as\s+expected)\b/i;

/**
 * The signs one event of the turn's run shows, given the run so far; `state` moves with it. A command's third failed
 * run is a sign once, at the third; a one-way command is one the first time it is run.
 * @param {WatchState} state @param {any} e  a run's event (services/runs.js `RUN_EVENT_FIELDS`)
 * @returns {WatchSign[]}
 */
export function watchStep(state, e) {
  if (!e || typeof e !== "object") return [];
  const at = Number(e.n) > 0 ? Number(e.n) : 0;
  /** @type {WatchSign[]} */
  const out = [];
  // The command a command's end is of, before the step lets go of it.
  const ending = e.type === "tool-end" ? state.signs.open.get(String(e.id ?? "")) : undefined;
  for (const s of signStep(state.signs, e)) if (s.kind === "failure" && / a third time /.test(s.words)) out.push({ kind: "failing", at: s.at, words: s.words, ...(ending !== undefined ? { command: ending } : {}) });
  switch (e.type) {
    case "round-text":
      if (String(e.text || "").trim()) state.said = String(e.text);
      break;
    case "tool-start": {
      state.tools++;
      const kind = String(e.card?.kind || /** @type {Record<string, string>} */ (KIND_BY_NAME)[String(e.name)] || "");
      const subject = String(e.card?.subject ?? e.args ?? "");
      if (kind === "write" || kind === "edit") {
        state.wrote.add(subject);
        state.lastWrite = subject;
        state.wroteAt = state.tools;
      } else if (kind === "shell" && !/_(output|kill)$/.test(String(e.name))) {
        const command = String(e.args ?? subject);
        if (e.id != null) state.shells.set(String(e.id), state.tools);
        const what = oneWayOf(command);
        if (what && !state.oneWay.has(command)) {
          state.oneWay.add(command);
          out.push({ kind: "one-way", at, words: `ran a step that cannot be undone: ${what} (\`${command}\`)` });
        }
      }
      break;
    }
    case "tool-end": {
      const place = state.shells.get(String(e.id ?? ""));
      if (place === undefined) break;
      state.shells.delete(String(e.id));
      // A command refused, declined, never run or cut by a stop checked nothing.
      if (!(e.refused || e.declined || e.vetoed || e.notRun || e.stopped)) state.ranAt = Math.max(state.ranAt, place);
      break;
    }
  }
  return out;
}

/**
 * The sign a turn's end shows, or null: its report says the work was checked, and no command ran to its end after the
 * turn's newest change — or, where it changed nothing, in the turn at all.
 * @param {WatchState} state @param {string} [report]  the turn's final words; its newest words where none is given
 * @returns {WatchSign | null}
 */
export function uncheckedAt(state, report = state.said) {
  const claim = CLAIM.exec(String(report || ""))?.[1];
  if (!claim || state.ranAt > state.wroteAt) return null;
  const where = state.wroteAt ? `after its last change (${state.lastWrite})` : "in the turn";
  return { kind: "unchecked", at: 0, words: `says "${claim.replace(/\s+/g, " ")}", and no command ran to its end ${where}` };
}
