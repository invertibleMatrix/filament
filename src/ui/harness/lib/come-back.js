// @ts-check
// A chat's come-back while it waits (agent/come-back.js; the Designer's of 10-27, accepted as drawn): its agent set it
// with come_back, and Filament goes on in the chat by itself at its time, with the agent's note. The server says it with
// the transcript (`comeBack`), at each set, replace, Cancel, Stop and its time coming (`come-back` on the events feed's
// `turns` topic), and in the five-second holders read (`comeBacks`); the page keeps it in `state.comeBacks`. The status
// capsule says when, its popover lists it with Cancel (conversation/status-panel.js), and Now keeps its chat under
// Working (lib/now.js). Pure: the words.
import { messageTimeLabel } from "./labels.js";

/**
 * A chat's come-back as the server says it (hands.js `ComeBack`): when, on Filament's clock, and the agent's note.
 * @typedef {{ at: number, note: string }} ComeBack
 */

/** How much of the note a row shows: its whole on hover. */
const NOTE_CHARS = 80;

/**
 * Its time on the page's clock, as a reply's time reads: "14:32" — "05:01 tomorrow" for one on the next calendar day, a
 * come-back being set up to a day out, and "the day after tomorrow" past it, which a day's wait across a clock moved
 * forward reaches. @param {ComeBack} c @param {Date} [now]
 */
export const comeBackClock = (c, now = new Date()) => {
  const at = new Date(c.at);
  const days = c.at > now.getTime() ? Math.round((Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000) : 0;
  return `${messageTimeLabel(c.at, now)}${days === 1 ? " tomorrow" : days > 1 ? " the day after tomorrow" : ""}`;
};

/** The note on one line, cut to a row's room. @param {string} note */
export const comeBackNote = (note) => {
  const one = String(note || "").replace(/\s+/g, " ").trim();
  return one.length > NOTE_CHARS ? `${one.slice(0, NOTE_CHARS - 1)}…` : one;
};

/** The minutes until it, at least one while it is still to come. @param {ComeBack} c @param {number} now */
const minutesTo = (c, now) => Math.max(1, Math.round((c.at - now) / 60_000));

/** How long until it, in the popover's words: "in 18 min", "in 1 h"; "any moment now" once its time passed. @param {ComeBack} c @param {number} now */
export const comeBackIn = (c, now) => {
  if (c.at <= now) return "any moment now";
  const m = minutesTo(c, now);
  return m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
};

/** How long until it in Now's age slot, short as its ages are: "in 18m", "in 1h"; "now" once its time passed. @param {ComeBack} c @param {number} now */
export const comeBackInShort = (c, now) => {
  if (c.at <= now) return "now";
  const m = minutesTo(c, now);
  return m < 60 ? `in ${m}m` : `in ${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}m` : ""}`;
};

/** Now's fact, and the end of the capsule's title in any other state: "comes back at 14:32". @param {ComeBack} c */
export const comeBackFact = (c) => `comes back at ${comeBackClock(c)}`;

/** The floating panel's bit: "back 14:32". @param {ComeBack} c */
export const comeBackWord = (c) => `back ${comeBackClock(c)}`;

/** The capsule's title while the come-back is all there is. @param {ComeBack} c */
export const comeBackTitle = (c) => `The turn is over; Filament goes on here by itself at ${comeBackClock(c)}, with the agent's note`;

/** Cancel's title: one press, no question — so it says what the press does. @param {ComeBack} c */
export const cancelTitle = (c) => `Cancel it: Filament won't go on in this chat at ${comeBackClock(c)}. The agent is told with its next turn.`;

/** The toast once it is cancelled. @param {ComeBack} c */
export const cancelledWords = (c) => `Cancelled — nothing comes back to this chat at ${comeBackClock(c)}`;

/**
 * The popover's row: the note cut to its room, whole on hover; its time; how long until it.
 * @param {ComeBack} c @param {number} now
 * @returns {{ note: string, title: string, at: string, left: string }}
 */
export const comeBackRow = (c, now) => ({ note: comeBackNote(c.note), title: String(c.note || ""), at: `at ${comeBackClock(c)}`, left: comeBackIn(c, now) });

/**
 * Filament's check-in on a chat's agent idle while its command runs (app/sessions/idle-wake.js, the owner's of 11-08):
 * when, and the commands that ran as the turn ended. The server says it as a come-back is said — the transcript
 * (`idleWake`), `idle-wake` on the `turns` topic, the holders read (`idleWakes`) —; the page keeps it in
 * `state.idleWakes`. Nothing to cancel: any turn drops it, and Settings › Agent loop turns it off.
 * @typedef {{ at: number, commands: { id: string, command: string, startedAt: number }[] }} IdleWake
 */

/** Now's fact and the capsule's: "checks in at 14:32". @param {IdleWake} w */
export const idleWakeFact = (w) => `checks in at ${messageTimeLabel(w.at)}`;

/**
 * The popover's row: what happens then — in a row's room —, how long until it and on what, and why on hover.
 * @param {IdleWake} w @param {number} now
 * @returns {{ at: string, left: string, words: string, title: string }}
 */
export const idleWakeRow = (w, now) => {
  const n = w.commands.length;
  return {
    at: `at ${messageTimeLabel(w.at)}`,
    left: `${comeBackIn({ at: w.at, note: "" }, now)} · if ${n === 1 ? "it still runs" : "they still run"} and nothing else came`,
    words: `Filament asks the agent about ${n === 1 ? "its command" : `its ${n} commands`}`,
    title: "So an agent left with a command that never ends is not stuck there all night. Any turn first — the command's end, your message, a report — drops it. Settings › Agent loop sets the minutes, or turns it off.",
  };
};
