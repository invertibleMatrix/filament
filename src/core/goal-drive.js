// @ts-check
// A goal driven round by round (the owner's of 11-05: "Goal round driver. improve it"): while a chat's goal is active
// and driving, each of its turns that ends with its reply starts the next round — Filament's own turn, its line saying
// the round and the marks —, until the agent's reply ends with one: [goal: done] (the slice is finished and checked),
// [goal: blocked: <why>] (it needs the person) — both halt the drive, said on the goal's card —, or [goal: waiting]
// (what it started wakes it: no round now, and the turn that wakes it decides again). Something that wakes the agent by
// itself — a sub-agent, a team, a coding agent's own task, a wake on its way — is waited for in the same way. The
// person's Stop halts it, and so do its cap of rounds and its cap of time, and the person's own words while it drives
// (the owner's of 11-10, "Match the decision": the round cap, a time cap, and a halt when the person types); the agent's
// next turn is told why (`haltLine`). `/goal go` drives on with as many again, `/goal hold` halts it.
// Nothing of it counts money: a goal never stops for what it spent (the owner's: "drop the whole spend tracking").
// Pure: the session service (app/sessions/service.js) keeps the drive on the goal and sends the rounds.

/** How many rounds a drive runs before it halts for the person, and as many again for each `/goal go`. */
export const DRIVE_ROUNDS = 20;
/** How long a drive runs before it halts for the person, from its start or its `/goal go` (the owner's of 11-10). */
export const DRIVE_MS = 2 * 60 * 60 * 1000;
/** Its time in words. */
const DRIVE_TIME = `${DRIVE_MS / 3_600_000} hours`;

/**
 * A goal's drive, kept on it: `on` once accepted to drive; `round`, the rounds Filament sent — each counted as its turn
 * takes it, so a round owed twice is sent and counted once; `cap`, the round it halts at; `since`, when it began or
 * `/goal go` began it again, which its time counts from — none on a drive begun before the time cap, which has none;
 * `halted`, why it waits for the person — the agent's done or blocked, their Stop, the cap of rounds or of time, their
 * words, their hold.
 * @typedef {{ kind: "done" | "blocked" | "stopped" | "cap" | "time" | "typed" | "held" | "leftout", why?: string, at: number, told?: boolean, comeBack?: boolean }} Halt
 *   `leftout`: Memory settings left the chat out, so the goal rides none of its requests — `why` in their words;
 *   `typed`: the person wrote to the agent while it drove; `told`: the agent's turn carried its line (`haltLine`);
 *   `comeBack`: its time's halt dropped a come-back the agent had set (the session service's), which its line says
 * @typedef {{ on: boolean, round: number, cap: number, since?: number, halted: Halt | null }} Drive
 */

/**
 * A drive just begun, or begun again by `/goal go` from where it stood, its time from `now`.
 * @param {Drive | null} was @param {number} now @returns {Drive}
 */
export const driveFrom = (was, now) => ({ on: true, round: was?.round || 0, cap: (was?.round || 0) + DRIVE_ROUNDS, since: now, halted: null });

/** A goal's drive, or null where it drives none — not active, or accepted before goals were driven. @param {any} goal @returns {Drive | null} */
export const driveOf = (goal) => (goal?.status === "active" && goal.drive?.on === true ? goal.drive : null);

/** The round's line: Filament's words, never the person's. @param {number} round @param {number} cap */
export const goalRoundLine = (round, cap) =>
  `[Filament: goal round ${round} of ${cap} — go on toward the goal where you left off. End your reply with [goal: done] once the slice is finished and checked, [goal: blocked: <why>] when you need the person, or [goal: waiting] when something you started will wake you.]`;

const ROUND = /^\[Filament: goal round (\d+) of (\d+) — /;

/**
 * The round a message is, where it is a round's: its last text block is a round's line. @param {any} message
 * @returns {{ round: number, cap: number } | null}
 */
export function goalRoundOf(message) {
  const c = message?.content;
  const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b?.type === "text").at(-1)?.text : null;
  const m = ROUND.exec(String(text || ""));
  return m ? { round: Number(m[1]), cap: Number(m[2]) } : null;
}

/** How far from its end a reply's mark is read: it ends the reply, give or take a closing line. */
const MARK_TAIL = 600;
const MARK = /\[goal:\s*(done|waiting|blocked)\s*(?::\s*([^\]\n]{0,300}))?\]/gi;

/**
 * The mark a reply ends with, or null: the last one in its tail.
 * @param {string} text
 * @returns {{ kind: "done" } | { kind: "waiting" } | { kind: "blocked", why: string } | null}
 */
export function goalMarkOf(text) {
  const tail = String(text || "").slice(-MARK_TAIL);
  const last = [...tail.matchAll(MARK)].at(-1);
  if (!last) return null;
  const kind = last[1].toLowerCase();
  if (kind === "blocked") return { kind: "blocked", why: String(last[2] || "").trim() || "it did not say why" };
  return kind === "done" ? { kind: "done" } : { kind: "waiting" };
}

/** A message's words: its text blocks, joined. @param {any} message */
export function wordsOf(message) {
  const c = message?.content;
  if (typeof c === "string") return c;
  return Array.isArray(c) ? c.filter((b) => b?.type === "text").map((b) => String(b.text || "")).join("\n") : "";
}

/**
 * What a turn's end does to a drive: halted, the next round owed (`post`; its turn counts it), or neither — the agent
 * waits on something that wakes it. A round already on its way is the waker's to send once (wake.js: one at a time per
 * chat). Its time is read at every end of a live drive, whatever that end decided: a drive whose turns only wait — a
 * come-back's wakes, each ending [goal: waiting] — starts no round, and would else run on past it without bound. Its
 * rounds are counted only where one would start.
 * @param {Drive} drive
 * @param {{ stopped: boolean, reply: string | null, waits: boolean, now: number }} o
 *   `reply`: its reply's words, null where it ended without one (a question for the person, a failure); `waits`:
 *   something wakes the agent by itself
 * @returns {{ drive: Drive, post: boolean }}
 */
export function afterTurn(drive, { stopped, reply, waits, now }) {
  if (!drive.on || drive.halted) return { drive, post: false };
  if (stopped) return { drive: { ...drive, halted: { kind: "stopped", at: now } }, post: false };
  const timed = typeof drive.since === "number" && now - drive.since >= DRIVE_MS ? { drive: { ...drive, halted: /** @type {Halt} */ ({ kind: "time", at: now }) }, post: false } : null;
  // A question for the person, or a turn that failed: the answer's turn, or their next message, decides.
  if (reply == null) return timed || { drive, post: false };
  const mark = goalMarkOf(reply);
  if (mark?.kind === "done") return { drive: { ...drive, halted: { kind: "done", at: now } }, post: false };
  if (mark?.kind === "blocked") return { drive: { ...drive, halted: { kind: "blocked", why: mark.why, at: now } }, post: false };
  if (mark?.kind === "waiting" || waits) return timed || { drive, post: false };
  if (drive.round >= drive.cap) return { drive: { ...drive, halted: { kind: "cap", at: now } }, post: false };
  return timed || { drive, post: true };
}

/** The halts the agent is told of on its next turn (`haltLine`): the rounds, the time, the person's words — not its own marks. */
const TOLD = new Set(["cap", "time", "typed"]);

/**
 * The line the agent's next turn carries where its drive halted and it was not told why (the owner's of 11-10: the
 * agent hears why it halted) — the rounds ran out, the time did, or the person wrote —, or null.
 * @param {Drive | null} drive
 */
export function haltLine(drive) {
  const h = drive?.halted;
  if (!drive || !h || h.told || !TOLD.has(h.kind)) return null;
  const why =
    h.kind === "cap" ? `its ${DRIVE_ROUNDS} rounds ran out (round ${drive.round})`
    : h.kind === "time" ? `its ${DRIVE_TIME} ran out (round ${drive.round})`
    : `the person wrote to you while it drove (round ${drive.round})`;
  // The come-back's answer said Filament would come back: where the halt dropped it, this says it will not.
  const dropped = h.kind === "time" && h.comeBack ? " The come-back you had set was dropped with it." : "";
  return `[Filament: the goal's drive halted — ${why}. No goal round starts by itself until the person sends /goal go.${dropped}]`;
}

/**
 * A drive in words, for the goal's status and its card — plain words, as a card draws them: driving, at which round,
 * or why it halted and what goes on.
 * @param {Drive | null} drive
 */
export function driveWords(drive) {
  if (!drive) return "";
  const h = drive.halted;
  if (!h) return `driving: round ${drive.round} of ${drive.cap} — each turn that ends goes on by itself until the agent marks the slice done or blocked; /goal hold holds it`;
  if (h.kind === "done") return `the agent says the slice is done (after round ${drive.round}): check it, then /goal done closes it, or /goal go drives on`;
  if (h.kind === "blocked") return `the agent is blocked: ${h.why} — answer it in the chat, then /goal go drives on`;
  if (h.kind === "stopped") return `you stopped it at round ${drive.round}: /goal go drives on`;
  if (h.kind === "cap") return `halted after ${drive.cap} rounds, for you to look: /goal go drives ${DRIVE_ROUNDS} more`;
  if (h.kind === "time") return `halted after ${DRIVE_TIME} of driving (round ${drive.round}), for you to look: /goal go drives on, ${DRIVE_ROUNDS} rounds or ${DRIVE_TIME} more`;
  if (h.kind === "typed") return `halted as you wrote to the agent at round ${drive.round}: /goal go drives on`;
  if (h.kind === "leftout") return `memory leaves this chat out (${h.why || "a Memory setting"}): the goal rides none of its requests now — /goal done or /goal abandon closes it`;
  return `held at round ${drive.round}: /goal go drives on`;
}

/**
 * A drive in a few words, for the chat's status panel: its round, or why it halted. @param {Drive | null} drive
 */
export function driveShort(drive) {
  if (!drive) return "";
  const h = drive.halted;
  if (!h) return `Driving · round ${drive.round} of ${drive.cap}`;
  if (h.kind === "done") return "Done, the agent says · check it";
  if (h.kind === "blocked") return `Blocked: ${h.why}`;
  if (h.kind === "stopped") return `Stopped at round ${drive.round}`;
  if (h.kind === "cap") return `Halted after ${drive.cap} rounds`;
  if (h.kind === "time") return `Halted after ${DRIVE_TIME}`;
  if (h.kind === "typed") return `Halted as you wrote · round ${drive.round}`;
  if (h.kind === "leftout") return "Halted: memory leaves this chat out";
  return `Held at round ${drive.round}`;
}
