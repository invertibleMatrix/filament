// @ts-check
// The side-by-side card (Phase 5), which the agent suggests (the owner's of 11-10): what it says and asks for — where
// each task works, the side run its Accept starts, and the one line on a slow checkout of the folder. Pure: the card is
// drawn by conversation/side-offer.js.

/** A newest checkout this slow or slower is said on the card: each copy of the folder waits for the one before it. */
export const SLOW_CHECKOUT_MS = 20_000;
/** What the card says where the chat names no model for its tasks to run on: Accept is off. */
export const NO_MODEL_WORDS = "This chat names no model for them to run on: choose one in the message box, and Accept takes it.";

/**
 * The card's line on a slow checkout of the folder, or "" where the newest one was quick, or none is known.
 * @param {number | null | undefined} ms
 */
export function slowCheckoutWords(ms) {
  const n = Number(ms);
  if (ms == null || !Number.isFinite(n) || n < SLOW_CHECKOUT_MS) return "";
  const s = Math.round(n / 1000);
  return `The last copy of this folder took ${s >= 120 ? `${Math.round(s / 60)} minutes` : `${s} s`} to check out, and copies are made one at a time: these may take a while to start.`;
}

/**
 * Where a task of the card works, as the Plan page's sheet starts it (views/side-run-sheet.js): one that writes works in
 * its own copy where the folder is a git repository and the chat's editing sub-agents work in their own copies — the
 * chat's setting, `worktree` —, else in your folder; one that only reads needs no copy.
 * @param {{ writes?: readonly string[] }} t @param {{ repo?: boolean, worktree?: boolean } | null} facts  the side-run route's GET
 * @returns {"copy" | "yours"}
 */
export const sideFolderOf = (t, facts) => (t.writes?.length && facts?.repo && facts?.worktree ? "copy" : "yours");

/** A folder as the card says it. @param {"copy" | "yours"} f */
export const sideFolderWords = (f) => (f === "copy" ? "own copy" : "your folder");

/**
 * The side run the card's Accept asks the graph's side-run route for: every task it offers, on the chat's model, each
 * where it works, started now — mid-turn too, as the Plan page's sheet starts them (the review of side-now: a turn
 * that builds a whole plan held them for hours). `facts` is the read Accept made as it was pressed. It names the card (`offer`, its `at`): a card pressed long after it
 * was drawn — its tasks started or changed since, the plan reworked — starts nothing, said in words.
 * @param {{ at: number, tasks: readonly { id: string, writes?: readonly string[] }[] }} offer @param {string} model
 * @param {{ repo?: boolean, worktree?: boolean, turn?: boolean } | null} facts  the side-run route's GET
 */
export function acceptBody(offer, model, facts) {
  return {
    starts: "now",
    offer: offer.at,
    tasks: offer.tasks.map((t) => ({ id: t.id, model, folder: sideFolderOf(t, facts) })),
  };
}

/**
 * What the card says of its own life: the agent does none of these tasks' work until it is answered, it answers itself
 * in 60 seconds (the owner's of 11-14), and when it leaves.
 */
export const CARD_LIFE_WORDS = "Your agent does none of these tasks' work until you answer: it goes on with work of its own. With no answer, the card answers itself in 60 seconds, and it leaves as soon as any of these tasks is started, dropped or re-planned.";
