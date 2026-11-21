// @ts-check
// A chat's waiting messages across a reload of the page (HarnessV4_Tasks U4). Its queue, and the messages held for a
// run the page has not learned yet (lib/held-steers.js), wait in the page's memory alone: a reload, or the browser
// putting the page away and loading it afresh (ui/lib/put-away.js), forgot them without a word. So the page writes
// them here as it goes away — the tab's own storage, one copy per session — and the chat's queue takes them back the
// first time it is made (queue.js's `queueRestored`: first, in order, paused for Continue). Taking removes the copy,
// and each going-away writes it afresh, so a copy never outlives the queue it was made of.
import { queuedText, queuedFiles, queuedOverrules, queuedAnswer, queuedVia } from "./queue.js";

/** @typedef {import("./queue.js").QueuedMessage} QueuedMessage */

const keyOf = (/** @type {string} */ chainId) => `filament.queue:${String(chainId)}`;

/**
 * A kept entry that is a message: words, or words with files — and the row it was sent by (`via`, the owner's of
 * 11-09), which the turn it starts still says. @param {any} it @returns {string | QueuedMessage | null}
 */
const messageOf = (it) => {
  if (typeof it === "string") return it.trim() ? it : null;
  if (!it || typeof it !== "object" || typeof it.text !== "string") return null;
  const files = Array.isArray(it.files) ? it.files : [];
  const overrules = queuedOverrules(it);
  return it.text.trim() || files.length ? { text: it.text, files, ...(overrules.length ? { overrules } : {}), ...queuedAnswer(it), ...queuedVia(it) } : null;
};

/**
 * @param {Pick<Storage, "getItem" | "setItem" | "removeItem"> | null} store  the tab's storage; none keeps nothing
 */
export function keptQueues(store) {
  return {
    /**
     * Keep a session's waiting messages; none removes its copy. True when all of it was kept. A storage too full for a
     * message's files keeps the words and the files' names, said when they come back (`lost`); one that takes nothing
     * keeps nothing, and the page going away is not stopped for it.
     * @param {string} chainId @param {(string | QueuedMessage)[]} items
     */
    keep(chainId, items) {
      try {
        if (!items.length) store?.removeItem(keyOf(chainId));
        else store?.setItem(keyOf(chainId), JSON.stringify({ items }));
        return !!store || !items.length;
      } catch {
        // Too full for it whole: the words are tried alone, below.
      }
      try {
        const lost = items.flatMap((it) => queuedFiles(it).map((f) => String(f?.name || "a file")));
        // The words go on alone, each with the overrule it carries, what it answers and the row it was sent by.
        const words = items.filter((it) => queuedText(it).trim()).map((it) => {
          const over = queuedOverrules(it);
          const answer = queuedAnswer(it);
          const via = queuedVia(it);
          return over.length || Object.keys(answer).length || via.via ? { text: queuedText(it), files: [], ...(over.length ? { overrules: over } : {}), ...answer, ...via } : queuedText(it);
        });
        store?.setItem(keyOf(chainId), JSON.stringify({ items: words, lost }));
      } catch {
        // Nothing fits: the messages stay this page's alone.
      }
      return false;
    },
    /**
     * Take back what was kept for a session, once: the messages in order, and the names of files that could not be kept.
     * @param {string} chainId @returns {{ items: (string | QueuedMessage)[], lost: string[] }}
     */
    take(chainId) {
      try {
        const raw = store?.getItem(keyOf(chainId));
        if (!raw) return { items: [], lost: [] };
        store?.removeItem(keyOf(chainId));
        const v = JSON.parse(raw);
        const items = [];
        for (const it of Array.isArray(v?.items) ? v.items : []) {
          const m = messageOf(it);
          if (m) items.push(m);
        }
        return { items, lost: Array.isArray(v?.lost) ? v.lost.map(String) : [] };
      } catch {
        return { items: [], lost: [] };
      }
    },
  };
}

/** What the page says of files a full storage could not keep with their messages. @param {string[]} lost */
export const keptLostWords = (lost) =>
  `${lost.length === 1 ? "A file" : `${lost.length} files`} of your queued messages could not be kept while the page loaded afresh: ${lost.join(", ")}. The words are back in the queue.`;
