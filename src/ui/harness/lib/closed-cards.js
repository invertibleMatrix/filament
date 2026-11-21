// @ts-check
// The agents' cards the person closed (HarnessV4_Tasks_Logs E37, the owner's 10-24: "i should be able to press a close
// button that will remove that from the transcript"), by chat: kept by this browser — how the person looks at a chat,
// not what happened in it (E37-D1) — so a closed card stays off the chat after a reload, and the chat menu brings a
// chat's back. Read once and kept in memory: a card asks at each paint, and a running agent's cards paint often. A closed
// card whose agent runs again stands while it runs, and is not counted hidden meanwhile.

/** The chats whose closed cards are kept, the last closed in last; and the cards a chat keeps. */
export const CLOSED_CHATS_MAX = 100;
export const CLOSED_PER_CHAT_MAX = 500;
const KEY = "closedCards";

/**
 * @param {{ get: (k: string) => string | null, set: (k: string, v: string) => void }} store
 */
export function createClosedCards(store) {
  /** @type {Map<string, string[]> | null} chat → its closed cards' keys (`agent:exchange`), oldest chat first */
  let byChat = null;
  const load = () => {
    if (byChat) return byChat;
    byChat = new Map();
    try {
      const j = JSON.parse(store.get(KEY) || "{}");
      if (j && typeof j === "object" && !Array.isArray(j))
        for (const [chat, keys] of Object.entries(j)) if (Array.isArray(keys)) byChat.set(chat, keys.map(String));
    } catch {}
    return byChat;
  };
  const save = () => store.set(KEY, JSON.stringify(Object.fromEntries(load())));
  /** @param {string} id @param {number} exchange */
  const keyOf = (id, exchange) => `${id}:${Number(exchange) || 0}`;
  /**
   * The closed cards that stand all the same — one whose agent runs again shows (agent-card.js `frame`) — each by the
   * row drawn of it, while that row is in the document: a card drawn again and the row it replaced never undo each other.
   * In memory alone: a card says it at each paint.
   * @type {Map<{ readonly isConnected: boolean }, { chat: string, key: string }>}
   */
  const standing = new Map();
  return {
    /** Whether the person closed this card in this chat. @param {string | null | undefined} chat @param {string} id @param {number} exchange */
    has: (chat, id, exchange) => !!chat && (load().get(chat)?.includes(keyOf(id, exchange)) ?? false),
    /**
     * How many of a chat's closed cards are off it: one that stands all the same is no hidden card (the Hunter's of
     * 11-01). @param {string | null | undefined} chat
     */
    count(chat) {
      if (!chat) return 0;
      /** @type {Set<string>} */
      const up = new Set();
      for (const [row, s] of standing) {
        if (!row.isConnected) standing.delete(row);
        else if (s.chat === chat) up.add(s.key);
      }
      return (load().get(chat) || []).filter((k) => !up.has(k)).length;
    },
    /**
     * A closed card's row says whether it stands all the same, at each paint and once it has left the document.
     * @param {string | null | undefined} chat @param {{ readonly isConnected: boolean }} row @param {string} id
     * @param {number} exchange @param {boolean} on
     */
    standing(chat, row, id, exchange, on) {
      if (on && chat) standing.set(row, { chat, key: keyOf(id, exchange) });
      else standing.delete(row);
    },
    /** The card leaves the chat. @param {string | null | undefined} chat @param {string} id @param {number} exchange */
    close(chat, id, exchange) {
      if (!chat) return;
      const all = load();
      const keys = (all.get(chat) || []).filter((k) => k !== keyOf(id, exchange));
      keys.push(keyOf(id, exchange));
      // The chat moves to the end: the chats closed in longest ago go first.
      all.delete(chat);
      all.set(chat, keys.slice(-CLOSED_PER_CHAT_MAX));
      while (all.size > CLOSED_CHATS_MAX) all.delete(/** @type {string} */ (all.keys().next().value));
      save();
    },
    /** The chat's closed cards come back; how many did. @param {string | null | undefined} chat */
    reopen(chat) {
      if (!chat) return 0;
      const n = load().get(chat)?.length ?? 0;
      if (load().delete(chat)) save();
      return n;
    },
  };
}
