// @ts-check
// The person's words at a coding agent's next step (HarnessV3-ACP AC-D6, AC3-1's next-step tier): for an agent that
// takes no words into its running turn but keeps what a turn it cancels did, as a drive saw (the catalogue's
// `cancelKeepsWork`: Cursor's CLI, AC3's drive C6). The words wait for a call of the turn to end with none still
// running; the turn is cancelled there, and they go as the prompt that carries it on — the same turn, one run, one
// reply. Never mid-call, never mid-sentence: a turn that ends first, or is stopped, hands them back, and they go as
// the next message. Filament's own words — another agent's report, its envelope's line — go the same way, said as
// Filament's (the nudge map of 11-10: they went in as "The person sent this").

/**
 * Why the turn stopped and that its work goes on, said after whose the words are: its last step finished, so nothing
 * is redone (AC3's drive, run 3: told only that its turn was stopped, Cursor ran its finished command again).
 */
const PAUSED =
  "Your turn was paused after your last step finished — no step was cut short — so it could reach you. Take it into account, then carry on with your task from where you left off, without redoing finished steps.";
/** The same, where several came: each is said under whose it is. */
const PAUSED_MANY =
  "Your turn was paused after your last step finished — no step was cut short — so they could reach you. Take them into account, then carry on with your task from where you left off, without redoing finished steps.";

/**
 * Who sent words that wait for the next step: the person, or Filament — its own words, or another's it relays (a
 * sub-agent's lead's, the agent that planned its task), which say whose inside them.
 * @typedef {"person" | "filament"} SentBy
 */
/** @param {SentBy} by */
const whoSent = (by) => (by === "filament" ? "Filament sent this" : "The person sent this");

/**
 * The prompt that carries the turn on: the words as sent, after the line that says whose they are and why they come
 * now — several in the order they were sent, each under whose it is.
 * @param {string | readonly { text: string, by: SentBy }[]} sent  words alone are the person's
 */
export const nextStepPrompt = (sent) => {
  const list = typeof sent === "string" ? [{ text: sent, by: /** @type {SentBy} */ ("person") }] : sent;
  if (list.length === 1) return `${whoSent(list[0].by)} while you were working. ${PAUSED}\n\n---\n${list[0].text}`;
  const bys = new Set(list.map((x) => x.by));
  const who = bys.size > 1 ? "The person and Filament" : bys.has("filament") ? "Filament" : "The person";
  return `${who} sent ${list.length} messages while you were working, in the order below. ${PAUSED_MANY}${list.map((x) => `\n\n---\n${whoSent(x.by)}:\n${x.text}`).join("")}`;
};

/**
 * @param {{ cancel: () => void, running: () => boolean }} o  `cancel`: the turn's cancel, sent to the agent;
 *   `running`: whether a call of the turn still runs
 */
export function createNextStep({ cancel, running }) {
  /**
   * The words waiting for the turn's next step, in the order they were sent, and how each one's wait ends: a second
   * send never takes the first's place (the nudge map of 11-10 — the first's words were lost, its wait never ended).
   * @type {{ text: string, by: SentBy, took: (yes: boolean) => void }[]}
   */
  let waiting = [];
  /** The turn was cancelled for the words waiting. */
  let cancelled = false;
  /** The turn is over: words sent now go as the next message. */
  let over = false;
  return {
    /**
     * Words for the turn, as the run sends them, each waiting behind those before it: true once they go in as the
     * turn's next prompt, false where the turn ends first (a stop among its ends). `by`: whose they are.
     * @param {string} text @param {SentBy} [by] @returns {Promise<boolean>}
     */
    send(text, by = "person") {
      if (over) return Promise.resolve(false);
      return new Promise((took) => void waiting.push({ text: String(text), by: by === "filament" ? "filament" : "person", took }));
    },
    /**
     * The turn's event sink, watched: a call that ends with none still running is the step the words wait for.
     * @param {(ev: any) => any} onEvent @returns {(ev: any) => any}
     */
    watch(onEvent) {
      return (ev) => {
        const r = onEvent(ev);
        if (ev?.type === "tool" && (ev.status === "completed" || ev.status === "failed") && waiting.length && !cancelled && !running()) {
          cancelled = true;
          cancel();
        }
        return r;
      };
    },
    /**
     * The words the turn was cancelled for, every one sent by now in its order, as they go in as its next prompt
     * (`nextStepPrompt`); null where it was cancelled for none.
     * @returns {{ text: string, by: SentBy }[] | null}
     */
    take() {
      if (!cancelled || !waiting.length) return null;
      const went = waiting;
      waiting = [];
      cancelled = false;
      for (const w of went) w.took(true);
      return went.map(({ text, by }) => ({ text, by }));
    },
    /** The turn is over: words still waiting go as the next message. */
    end() {
      over = true;
      for (const w of waiting) w.took(false);
      waiting = [];
    },
  };
}
