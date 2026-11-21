// @ts-check
// The tail of Filament's next tool answer (checkpoint.js `viaOf`, "tool-answer"; DIVERGENCE next-tool-answer): an agent
// that takes words only once a step ended — Cursor's command-line agent, whose steer cancels the step it is on — hears
// what comes mid-turn after the answer of the next call it makes of Filament's tools. Its turn owes the words here, by
// its chat; the chat's agent's next answer from Filament takes them; the turn's end lets go of what none took.

/**
 * What a turn owes its agent's next answer: its words — or what makes them as that answer goes, judged then (the review
 * of bcc37fbb7, sa_ea3782cd) —, `said` once an answer carried them, `dropped` where none did by the turn's end, or they
 * came to nothing as it went.
 * @typedef {{ text: string | (() => string), said?: () => void, dropped?: () => void }} Owed
 */

export function createToolTails() {
  /** @type {Map<string, Owed[]>} */
  const owed = new Map();
  return {
    /**
     * Words for the chat's agent's next answer from Filament. A chat's turn owes them; one owed twice goes twice, in order.
     * @param {string} chain @param {Owed} o
     */
    owe(chain, o) {
      if (!chain || !o.text) return;
      owed.set(chain, [...(owed.get(chain) || []), o]);
    },
    /** Whether words wait for the chat's agent's next answer. @param {string} chain */
    owes: (chain) => !!owed.get(chain)?.length,
    /**
     * The words owed, taken for an answer that goes now: each `said`, or `dropped` where it came to nothing. "" where
     * none is.
     * @param {string} chain
     */
    take(chain) {
      const list = owed.get(chain) || [];
      owed.delete(chain);
      /** @type {string[]} */
      const words = [];
      for (const o of list) {
        const text = typeof o.text === "function" ? o.text() : o.text;
        if (!text) {
          o.dropped?.();
          continue;
        }
        words.push(text);
        o.said?.();
      }
      return words.join("\n\n");
    },
    /** The turn ended: what no answer carried is let go, each `dropped`. @param {string} chain */
    drop(chain) {
      const list = owed.get(chain) || [];
      owed.delete(chain);
      for (const o of list) o.dropped?.();
    },
  };
}
