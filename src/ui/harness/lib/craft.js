// @ts-check
// `/craft <words>` (the owner's word of 10-27): a crafter chat of its own — the same folder and model, its agent crafting
// a skill in the open with the craft tool, every step in its transcript — opened from the chat it is typed in, which
// carries on. Its first message waits in its box for the person's Send. Read here for the box; the chat is made by the
// server (app/crafter-chats.js).

/** The words after `/craft`, "" for the word alone, or null where the draft is no /craft. @param {string} text */
export function craftOf(text) {
  const m = /^\/craft(?:\s+([\s\S]*))?$/i.exec(String(text || "").trim());
  return m ? String(m[1] || "").trim() : null;
}

/** `/craft` with nothing after it: what to type. */
export const CRAFT_USAGE = "/craft needs what to make a skill of: /craft <what it is for, and what to make it from — files, folders, web pages, this chat>. It opens a chat of its own where you watch it craft, and steer it.";

/**
 * @typedef {{ id: string, title?: string | null, preview?: string | null, craft?: { skill: string | null, from: string | null } | null }} CraftRow
 *   a row of the sessions list, as far as the crafter's line reads it
 * @typedef {{ kind: "crafter", skill: string | null, from: { id: string, title: string } | null }
 *   | { kind: "source", crafters: { id: string, title: string, skill: string | null, waiting: boolean }[] }} CraftLine
 */

/** A row's name as the list shows it. @param {CraftRow | undefined} row */
const rowTitle = (row) => String(row?.title || row?.preview || "").trim() || "untitled";

/**
 * What the line over the box says of the chat on screen (the owner's yes of 10-27), or null for none: in a crafter chat,
 * the skill it crafts and the chat it was opened from, to go back to; in a chat a crafter was opened from, the crafters
 * at work or waiting for the person — none once they are done.
 * @param {string | null | undefined} chainId  the chat on screen
 * @param {CraftRow[]} rows  the sessions list
 * @param {{ working: (id: string) => boolean, waiting: (id: string) => boolean }} at
 * @returns {CraftLine | null}
 */
export function craftLineOf(chainId, rows, at) {
  if (!chainId) return null;
  const mine = rows.find((r) => r.id === chainId);
  if (mine?.craft) {
    const from = mine.craft.from;
    return { kind: "crafter", skill: mine.craft.skill, from: from ? { id: from, title: rowTitle(rows.find((r) => r.id === from)) } : null };
  }
  const crafters = rows
    .filter((r) => r.craft?.from === chainId && (at.working(r.id) || at.waiting(r.id)))
    // A turn that waits for a yes still runs: waiting comes first.
    .map((r) => ({ id: r.id, title: rowTitle(r), skill: r.craft?.skill ?? null, waiting: at.waiting(r.id) }));
  return crafters.length ? { kind: "source", crafters } : null;
}

/** The line's words, before its buttons. @param {CraftLine} line */
export function craftLineWords(line) {
  if (line.kind === "crafter") return `This chat crafts ${line.skill ? `the skill ${line.skill}` : "a skill"}${line.from ? " · started in" : ""}`;
  const [one, ...more] = line.crafters;
  if (more.length) return `${line.crafters.length} crafter chats opened here are at work`;
  return one.waiting ? `The crafter of ${one.skill || "a skill"} waits for your answer` : `A crafter is at work on ${one.skill || "a skill"}`;
}

/**
 * The toast once a crafter chat opened. `draft`: its first message waits in its box; without one, the skill's crafter
 * chat that stood already opened. @param {string} title @param {boolean} [draft]
 */
export const craftOpenedWords = (title, draft = false) =>
  draft
    ? `${title} is ready: its brief is in the box — change the model or the words, then press Send. Nothing runs until you do.`
    : `${title} opened: the chat that crafts this skill.`;
