// @ts-check
// Words typed to an agent on the side while it still works (HarnessV4_Tasks E15 step 5, AG-101): held on the page, one
// text an agent — typing again adds to it — and sent as its next message once it has answered, whichever tab or
// session the page shows then: the feed says when an agent's state moves, the open thread and the session's list say
// it too, and the first to say so sends. A send the server refuses keeps the words held and says why. Nothing here is
// kept beyond the page: a reload drops what was held.
import { onBus } from "./bus.js";
import { subagentRoutes } from "./subagents.js";

/**
 * @param {{ send?: (chainId: string, id: string, text: string) => Promise<unknown>, bus?: (fn: (msg: any) => void) => unknown }} [io]
 *   `send`: the agent's next message (its follow-up route); `bus`: the events feed
 */
export function createHeldAsks({ send = (chainId, id, text) => subagentRoutes(chainId).followUp(id, text), bus = onBus } = {}) {
  /** What is held, by session and agent; `error`: why its last send was refused. @type {Map<string, { text: string, error: string | null }>} */
  const held = new Map();
  /** The sends on their way. @type {Set<string>} */
  const going = new Set();
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** @param {string} chainId @param {string} id */
  const key = (chainId, id) => `${chainId}\n${id}`;
  const emit = () => {
    for (const fn of listeners) fn();
  };

  /** The agent has answered: what is held for it goes. @param {string} chainId @param {string} id */
  async function go(chainId, id) {
    const k = key(chainId, id);
    const h = held.get(k);
    if (!h || going.has(k)) return;
    held.delete(k);
    going.add(k);
    emit();
    try {
      await send(chainId, id, h.text);
    } catch (e) {
      // Not sent: the words stay held, ahead of anything typed meanwhile, with why.
      const later = held.get(k);
      held.set(k, { text: [h.text, later?.text].filter(Boolean).join("\n\n"), error: String(/** @type {any} */ (e)?.message || e) });
    } finally {
      going.delete(k);
      emit();
    }
  }

  bus((msg) => {
    if (msg?.type === "subagent" && msg.chainId && msg.id && msg.status && msg.status !== "running") void go(String(msg.chainId), String(msg.id));
  });

  return {
    /** What is held for an agent, and why it did not go where a send was refused; null with nothing held. @param {string} chainId @param {string} id */
    of: (chainId, id) => held.get(key(chainId, id)) || null,
    /** Hold words for an agent that still works; words held before stay ahead of them. @param {string} chainId @param {string} id @param {string} text */
    hold(chainId, id, text) {
      const words = String(text || "").trim();
      if (!words) return;
      const k = key(chainId, id);
      held.set(k, { text: [held.get(k)?.text, words].filter(Boolean).join("\n\n"), error: null });
      emit();
    },
    /** Take back what is held: it leaves, and is the caller's. @param {string} chainId @param {string} id */
    take(chainId, id) {
      const k = key(chainId, id);
      const text = held.get(k)?.text || "";
      if (held.delete(k)) emit();
      return text;
    },
    /** An agent is known to have answered (its thread or the session's list says so): what is held for it goes. */
    settled: go,
    /** Hear every change to what is held; returns the unsubscribe. @param {() => void} fn */
    onChange(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** @typedef {ReturnType<typeof createHeldAsks>} HeldAsks */
