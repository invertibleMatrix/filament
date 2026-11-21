// @ts-check
// The person's words queued at the agent while its turn runs (HarnessV3-FailurePoints §7.2), as Claude Code takes what
// is typed while it works: each is a plain `session/prompt` of the turn's session, which Claude Code folds into its
// running turn between tool rounds, or runs next when the turn ends first. Nothing is aborted.

/**
 * The text of a user message's content: a string, or its text blocks.
 * @param {any} content
 */
const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((b) => b?.type === "text")
          .map((b) => String(b.text || ""))
          .join("")
      : "";

/** How many pictures a user message's content holds. @param {any} content */
const picturesOf = (content) => (Array.isArray(content) ? content.filter((b) => b?.type === "image").length : 0);

/**
 * The prompts a turn queues at the agent while it works, where the agent declares prompt queueing and Filament reads its
 * raw messages (Claude's adapter). Claude's echo of the words (its raw user message) is when it took them: into its
 * running work (`true`), or after the cycle the turn was in had ended (`"after"`): a result came since the last prompt
 * it took. One answered with no echo was never taken (`false`): a stop dropped it from Claude Code's queue, or the agent
 * refused it. The turn reads on until every prompt it queued is answered (`drained`); words sent after that are handed
 * back at once. The pictures the words carry go in the same prompt (HarnessV4_Tasks C22); pictures with no words are
 * known at their echo by how many there are. The echo's `uuid` is the prompt's, which a result names where it answered
 * the prompt (`carries`). Words taken have run once a result follows their echo (`ran`): the cycle that took them is
 * over, whose answer to their prompt comes after it.
 * @param {(text: string, images?: import("./prompt.js").SteerImage[]) => Promise<any>} prompt  sends one prompt of the
 *   turn's session; resolves with its answer
 */
export function createQueued(prompt) {
  /** @type {{ text: string, pictures: number, took: boolean | "after", uuid: string, done: boolean, ran: boolean, settle: (took: boolean | "after") => void, answer: Promise<any> }[]} */
  const queued = [];
  /** A cycle of the agent's ended (its result) since it last took a prompt: words it takes now run after it. */
  let ended = false;
  let closed = false;
  return {
    /** @param {string} text @param {import("./prompt.js").SteerImage[]} [images] @returns {Promise<boolean | "after">} */
    send(text, images = []) {
      if (closed) return Promise.resolve(false);
      /** @type {(took: boolean | "after") => void} */
      let settle = () => {};
      const took = new Promise((resolve) => (settle = resolve));
      const answer = prompt(text, images);
      const q = { text: String(text).trim(), pictures: images.length, took: /** @type {boolean | "after"} */ (false), uuid: "", done: false, ran: false, settle, answer };
      const over = () => {
        q.done = true;
        if (!q.took) settle(false);
      };
      answer.then(over, over);
      queued.push(q);
      return took;
    },
    /**
     * One of the agent's raw messages, read in the order it sent them: a cycle's result, or a prompt's echo — of words
     * this turn queued, taken now. → the words taken, and whether after a cycle ended; null for none.
     * @param {any} message
     * @returns {{ text: string, after: boolean } | null}
     */
    heard(message) {
      if (message?.type === "result") {
        ended = true;
        for (const q of queued) if (q.took) q.ran = true;
      }
      if (message?.type !== "user" || message.parent_tool_use_id) return null;
      const said = textOf(message.message?.content).trim();
      const pictures = said ? 0 : picturesOf(message.message?.content);
      if (!said && !pictures) return null;
      const q = queued.find((x) => !x.took && !x.done && x.text === said && (said || x.pictures === pictures));
      // A prompt's echo starts a cycle, or joins the running one: words taken after it are taken into it.
      const after = ended;
      ended = false;
      if (!q) return null;
      q.took = after ? "after" : true;
      q.uuid = typeof message.uuid === "string" ? message.uuid : "";
      q.settle(q.took);
      return { text: q.text, after };
    },
    /**
     * Whether one of the agent's results answers words this turn queued, still waiting for their answer: a cycle Claude
     * began by itself (its answer to a background task) took them in, and its result names them (`user_message_uuids`,
     * an older Claude Code's `user_message_uuid`) — Claude's adapter then counts what the cycle spent in their answer.
     * @param {any} message
     */
    carries(message) {
      const named = Array.isArray(message?.user_message_uuids) ? message.user_message_uuids : typeof message?.user_message_uuid === "string" ? [message.user_message_uuid] : [];
      return queued.some((q) => q.took && !q.done && q.uuid && named.includes(q.uuid));
    },
    /**
     * Whether words this turn queued still wait for the cycle that runs them — not taken yet, or taken by a cycle whose
     * result has not come: the turn reads on until none does. Known as the agent's messages are read, never later: an
     * answer settles only once the read that brought it is over.
     */
    waiting() {
      return queued.some((q) => !q.done && !q.ran);
    },
    /**
     * Once every prompt queued is answered, those queued meanwhile too, the turn takes no more. → the answers of those
     * the agent took, in order, with how. Rejects with the failure of one it took; the failure of one it never took is
     * handed to `untaken` — the agent may have lost the session under it.
     * @param {(e: unknown) => void} [untaken]
     * @returns {Promise<{ answer: any, took: true | "after" }[]>}
     */
    async drained(untaken = () => {}) {
      /** @type {{ answer: any, took: true | "after" }[]} */
      const answers = [];
      for (let i = 0; i < queued.length; i++) {
        const q = queued[i];
        const answer = await q.answer.catch((e) => {
          if (q.took) throw e;
          untaken(e);
          return null;
        });
        if (q.took) answers.push({ answer, took: q.took });
      }
      closed = true;
      return answers;
    },
    /**
     * The turn ended before its prompts were all answered (it failed): no more go out, and those still waiting at the
     * agent are let go — `cancel` drops them from its queue. Settled once each is answered.
     * @param {() => void} cancel
     */
    async letGo(cancel) {
      closed = true;
      if (!queued.some((q) => !q.done)) return;
      cancel();
      await Promise.allSettled(queued.map((q) => q.answer));
    },
  };
}
