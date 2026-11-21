// @ts-check
// What the agent hears of its chat's move to another place (HarnessV4_Git_Plan GW-D72): the first turn after a move
// carries Filament's word, on its newest message alone — where it works now, what came
// with it, what did not. The move is told once that turn ran to its end (GW-D86); a turn that failed or was cut off
// leaves it for the next.

/** The files a note names at most; the rest are counted. */
const NAMED_MAX = 20;

/**
 * The note for the chat's moves its agent has not heard of yet; null when it heard of every one. Several are said as
 * one: from the first one's folder to the last one's.
 * @param {any} meta  the chat's
 * @returns {{ ids: string[], text: string } | null}
 */
export function moveNote(meta) {
  const untold = (Array.isArray(meta?.moves) ? meta.moves : []).filter((/** @type {any} */ m) => m && !m.told);
  const first = untold[0];
  const last = untold.at(-1);
  if (!first || !last) return null;
  const from = String(first.from?.cwd || "");
  const to = String(last.to?.cwd || "");
  const files = [...new Set(untold.flatMap((/** @type {any} */ m) => (Array.isArray(m.files) ? m.files : []).map((/** @type {any} */ f) => String(f.path))))];
  const named = files.slice(0, NAMED_MAX).join(", ") + (files.length > NAMED_MAX ? `, and ${files.length - NAMED_MAX} more` : "");
  // The project's worktree template copied into the worktree the last move made (HarnessV4_Four_Plan FOC-67).
  const copy = Array.isArray(last.copy) ? last.copy.map(String) : [];
  const copied = copy.slice(0, NAMED_MAX).join(", ") + (copy.length > NAMED_MAX ? `, and ${copy.length - NAMED_MAX} more` : "");
  const lines = [
    `[Filament: since your last turn the person moved this chat from ${from} to ${to}${last.to?.branch ? ` (branch ${last.to.branch})` : ""}.`,
    `Work in ${to} from now on: your commands start there, and the paths in earlier turns that name ${from} are the old folder.`,
    files.length ? `Your uncommitted changes moved with it, at the same paths: ${named}.` : "No uncommitted change of yours was there to move.",
    copy.length
      ? `What git ignores (node_modules, .env, build output) stayed in ${from}, but for what Filament copies into the new worktree from the project's list: ${copied}. Install or copy what else your work needs before you run it.]`
      : `What git ignores (node_modules, .env, build output) stayed in ${from}: install or copy what your work needs before you run it.]`,
  ];
  return { ids: untold.map((/** @type {any} */ m) => String(m.id)), text: lines.join(" ") };
}

/**
 * The meta patch that marks the moves a turn told as told.
 * @param {any} meta @param {readonly string[]} ids
 */
export const toldPatch = (meta, ids) => ({
  moves: (Array.isArray(meta?.moves) ? meta.moves : []).map((/** @type {any} */ m) => (ids.includes(String(m?.id)) ? { ...m, told: true } : m)),
});
