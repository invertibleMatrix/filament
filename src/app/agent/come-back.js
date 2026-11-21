// @ts-check
// The agent's come_back (the owner's word of 10-27: "it comes back later in the same chat", as Claude Code's scheduled
// wakeup does): Filament starts a turn of the agent's in its chat once the time it set has passed, with the note it
// left — for work that needs time but not the agent: a deploy to settle, a CI run to finish, a reply to check for. One
// per chat, a new one replacing it; its time is told as a background shell's exit is (hands.js `comeBackLater`): at
// the agent's next step while a turn of it runs, else in a turn the waker sends the chat. The person's Stop drops it,
// and so does a goal's halt for its time (core/goal-drive.js); Filament's restart keeps it, and one whose time came
// meanwhile comes late (sessions/owed-wakes.js, the nudge map of 11-10). Offered to a harness chat's own agent alone: a
// sub-agent's run ends with its report, a lead's chat goes on with its team, and a client's own conversation has no turn
// Filament could start. While it waits the page shows it, with the person's Cancel (`cancelByPerson`; the Designer's of
// 10-27).
import { COME_BACK_MAX_S, COME_BACK_MIN_S, cancelComeBack, comeBackLater, comeBackOf, tellLater } from "../../adapters/tools/hands.js";

export const COME_BACK = "come_back";
/** A call where the agent has no chat to come back to. */
export const COME_BACK_OFF = "Not run: only a chat's own agent comes back to it later — carry on with the task.";
/** The most of a note kept: what the agent reads when it comes back. */
const NOTE_CHARS = 2000;

export const COME_BACK_TOOL = Object.freeze({
  name: COME_BACK,
  description: `Come back to this chat later by yourself: once \`seconds\` have passed (${COME_BACK_MIN_S} to ${COME_BACK_MAX_S}), Filament starts a turn of yours here with your \`note\` — what to check or do then. Use it for work that needs time but not you: a deploy to settle, a CI run to finish, a page or a reply to check again. One per chat: a new one replaces the one set before, and \`cancel: true\` drops it. If a turn of yours runs when the time comes, the note reaches you at its next step. Once it is set, end your turn unless other work is left — don't sleep or poll. The person's Stop drops it, as does a goal halted for its time; a restart of Filament keeps it, and one whose time came meanwhile comes once Filament is back.`,
  input_schema: Object.freeze({
    type: "object",
    properties: Object.freeze({
      seconds: Object.freeze({ type: "number", description: `How long from now, in seconds (${COME_BACK_MIN_S} to ${COME_BACK_MAX_S}).` }),
      note: Object.freeze({ type: "string", description: "What to check or do when you come back, as you will read it then." }),
      cancel: Object.freeze({ type: "boolean", description: "true: drop the come-back set before, and nothing else." }),
    }),
  }),
});

/** A time of day on Filament's clock, "14:32". @param {number} t */
const clockOf = (t) => new Date(t).toTimeString().slice(0, 5);
/** How long, in words: "1 min", "20 min", "1 h", "1 h 5 min". @param {number} s */
const spanWords = (s) => {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
};
/** A note's start, for an answer that names one. @param {string} note */
const noteHead = (note) => {
  const one = note.replace(/\s+/g, " ").trim();
  return one.length > 80 ? `${one.slice(0, 79)}…` : one;
};

/**
 * One call: set the chat's come-back, replacing the one before, or drop it. `at`: the chat it comes back to — null
 * where the agent has none (a sub-agent, a lead, a client's own conversation).
 * @param {any} input @param {{ session: string } | null} at
 * @returns {{ ok: true, text: string } | { ok: false, error: string }}
 */
export function comeBackCall(input, at) {
  if (!at?.session) return { ok: false, error: COME_BACK_OFF };
  if (input?.cancel === true) {
    const was = cancelComeBack(at.session);
    return { ok: true, text: was ? `Dropped the come-back set for ${clockOf(was.at)} (${noteHead(was.note)}): nothing comes back to this chat now.` : "No come-back was set in this chat, so there was nothing to drop." };
  }
  const note = String(input?.note ?? "").trim();
  if (!note) return { ok: false, error: "Not set: note is required — what to check or do when you come back." };
  const asked = Number(input?.seconds);
  if (input?.seconds == null || !Number.isFinite(asked)) return { ok: false, error: `Not set: seconds is required — how long from now, ${COME_BACK_MIN_S} to ${COME_BACK_MAX_S}.` };
  const kept = note.length > NOTE_CHARS ? `${note.slice(0, NOTE_CHARS - 1)}…` : note;
  const r = comeBackLater(at.session, { seconds: asked, note: kept });
  const held = r.seconds !== Math.round(asked) ? ` — ${Math.round(asked)} s is outside ${COME_BACK_MIN_S} to ${COME_BACK_MAX_S}` : "";
  return {
    ok: true,
    text: [
      `Set: Filament comes back to this chat in ${spanWords(r.seconds)} (at ${clockOf(r.at)})${held}, with your note.`,
      r.replaced ? `It replaces the one set for ${clockOf(r.replaced.at)} (${noteHead(r.replaced.note)}).` : "",
      "End your turn now unless other work is left.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/** What the person's Cancel answers where the chat has no come-back set. */
export const NO_COME_BACK = "No come-back is set in this chat: its time came, or it was cancelled.";

/**
 * The person's Cancel on the chat's come-back (the Designer's of 10-27; one press, no question): dropped, and its agent
 * told with its next turn — at its next step where a turn of it runs — in Filament's words, never woken for it. The word
 * is no time that came (kind `cancel`, not `wake`): a later cancel or Stop never drops it, and it wakes no chat
 * (hands.js `wakes`). Refused in words where the chat has none set, and then nothing changes: one whose time came is
 * no longer the page's to show, and its note is the agent's to hear.
 * @param {string} chain
 * @returns {{ ok: true, comeBack: import("../../adapters/tools/hands.js").ComeBack } | { ok: false, error: string }}
 */
export function cancelByPerson(chain) {
  const was = comeBackOf(chain) ? cancelComeBack(chain) : null;
  if (!was) return { ok: false, error: NO_COME_BACK };
  const text = `[Filament: the person cancelled the come-back you set for ${clockOf(was.at)} (${noteHead(was.note)}): nothing comes back to this chat now.]`;
  tellLater({ session: chain, agent: null }, { id: `${was.id}:cancel`, command: "", code: null, kind: "cancel", text }, { wake: false });
  return { ok: true, comeBack: { at: was.at, note: was.note } };
}
