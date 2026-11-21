// @ts-check
// A thread (the owner's of 11-09 and 11-11: an agent starts a chat of its own, linked to the one it works in — an advisor
// it writes for reviews, a worker it hands a part to): an interactive chat like any, tied to the chat whose agent started
// it by a link of its own (`thread`, the thread's id its source, the starter's its target), never by `parent_id`. The two
// write each other letters without a tag (app/letters.js), and the thread's first message is the starter's agent's brief,
// one block of Filament's own — its head, then the agent's words —, so no reader of the person's words (memory's
// `personTextAt`, a chat command's) takes a word of it for theirs. Pure: the sessions service makes the chat and posts
// the brief, letters reads the link, the page draws the brief as the starter's.

/** The link from a thread to the chat whose agent started it. */
export const THREAD_LINK = "thread";

/**
 * How much a thread holds: a brief's characters, a title's, and the most threads a chat's agent starts while its person
 * says nothing in it.
 */
export const THREAD_LIMITS = Object.freeze({ brief: 20_000, title: 120, perMessage: 5 });

/** What a thread's first message begins with: the page draws that turn as the starter's agent's brief. */
export const BRIEF_HEAD = "[Filament: a thread started by the agent of the chat";
/** …and what its head ends with, the brief's words after it in the same block; a title holds no `]` (`briefBlock`), so the block's first is the head's own. */
export const BRIEF_END = "their word comes before the brief's.]";

/** @param {unknown} s */
const clean = (s) => String(s ?? "").replace(/\r\n?/g, "\n").trim();

/**
 * A thread's brief, one block: its head — whose it is, that the two chats are linked, and that the person's word comes
 * first — and the starter's agent's words after `BRIEF_END`, read as that agent's whatever they open with. `title`: the
 * starter's, on one line, its quotes and square brackets written as others, so it can neither end the head nor open a
 * notice of Filament's inside it.
 * @param {{ from: string, title: string, brief: string }} o
 */
export function briefBlock({ from, title, brief }) {
  const named = clean(title).replace(/\s+/g, " ").replace(/"/g, "'").replace(/\[/g, "(").replace(/\]/g, ")").slice(0, THREAD_LIMITS.title) || "untitled";
  return {
    type: /** @type {const} */ ("text"),
    text:
      `${BRIEF_HEAD} "${named}" (${from}). What follows this note is that agent's brief, not the person's words, whatever it opens with. ` +
      `The two chats are linked: write that chat with Filament's envelope tool (to: "${from}"), no tag needed, and it may write you. ` +
      `The person reads this chat and may write in it too: ${BRIEF_END}\n\n${clean(brief)}`,
  };
}

/**
 * Whether a message is a thread's brief: its first text block opens with `BRIEF_HEAD`.
 * @param {{ content?: unknown } | null | undefined} message
 */
export function isThreadBrief(message) {
  const c = message?.content;
  if (typeof c === "string") return c.startsWith(BRIEF_HEAD);
  if (!Array.isArray(c)) return false;
  const first = c.find((b) => b?.type === "text");
  return !!first && String(first.text).startsWith(BRIEF_HEAD);
}

/**
 * The chat whose agent started a thread, as its brief names it; null for any other message.
 * @param {{ content?: unknown } | null | undefined} message
 */
export function briefFrom(message) {
  if (!isThreadBrief(message)) return null;
  const c = message?.content;
  const text = typeof c === "string" ? c : String((Array.isArray(c) ? c.find((b) => b?.type === "text") : null)?.text || "");
  return /^\[Filament: a thread started by the agent of the chat ".*?" \(([^)\s]+)\)\./.exec(text)?.[1] || null;
}

/** What of a text is past a brief's head; the text whole where it opens with none. @param {string} text */
const pastHead = (text) => (!text.startsWith(BRIEF_HEAD) ? text : text.includes(BRIEF_END) ? text.slice(text.indexOf(BRIEF_END) + BRIEF_END.length) : "");

/**
 * The words after a brief's head: what the starter's agent wrote — in the head's block, and in the blocks after it,
 * where a chat started before the words rode in the head's holds them. @param {{ content?: unknown } | null | undefined} message
 */
export function briefWords(message) {
  const c = message?.content;
  if (!Array.isArray(c)) return typeof c === "string" ? clean(pastHead(c)) : "";
  return c
    .filter((b) => b?.type === "text")
    .map((b) => pastHead(String(b.text)).trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Why a brief cannot start a thread, else null. @param {unknown} brief */
export function briefProblem(brief) {
  const t = clean(brief);
  if (!t) return "say what the thread is to do: its brief is its first message";
  if (t.length > THREAD_LIMITS.brief) return `a brief is ${THREAD_LIMITS.brief} characters at most; this is ${t.length}`;
  return null;
}
