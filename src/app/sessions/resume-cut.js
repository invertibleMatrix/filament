// @ts-check
// A turn a restart cut off goes on by itself (HarnessV3-TaskGraph-v2 TG2-D83). At start the cut turns get the work their
// run logs hold (cut-turns.js); once the server listens, Filament sends each such chat a turn of its own through the
// route a message takes, as replay-compare sends its copy's. The turn is a turn like any: its history has the cut
// turn's work, it carries what the stop told the session, it asks the page for permissions, Stop stops it. Every
// question its send would ask first but the cold-cache one stops it instead (service.js `resume`), and the cut turn
// says why. With `sessions.resumeAfterRestart` off, nothing goes on: the cut turn waits for the person's message. A
// team beside a chat never goes on by itself (team_v2_plan §9 Q8): its card says it stopped, with Resume…. Nor does a
// chat the person archived (sessions/service.js `notByItself`): its cut turn waits for their next message there.
// A clean stop (TG2-D85) refuses every new model call while it drains, its own turns' included: a turn between rounds
// fails on that refusal instead of being cut. So the stop notes the chats whose turn runs (`noteRunningAtStop`), and the
// next start goes on with each one's newest turn that has no reply (`takeRunningAtStop`, `stoppedTurns`).
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { byOfTurn } from "../../core/turn-by.js";

/** The message Filament sends the chat: its own words, not the person's — the page draws them as Filament's. */
export const RESUME_LINE =
  "[Filament: Filament restarted while your last turn was running, and the restart cut it off. What you had done is above, and the folder still holds your changes. Go on with the task from where you stopped.]";

/** What a resume asked of a chat whose newest turn no restart cut off is refused with. */
export const NOTHING_TO_RESUME = "nothing to go on with: the chat's newest turn was not cut off by a restart";

/** Why a resumed turn cut again before it ran a call stays cut: going on again could loop on what stopped Filament. */
export const CUT_AGAIN = "it was cut again before it ran anything, and going on again could loop on what stopped Filament";

/** Why a team beside a chat stays stopped (team_v2_plan §9 Q8): it spends only on the person's Send. */
export const TEAM_WAITS = "a team beside a chat goes on only when you send it on: Resume… on its card";

/** Why a flow's team box stays stopped (HarnessV4_Flow_Plan FL-D19): its flow goes on on the person's Go on alone. */
export const FLOW_WAITS = "a flow's box goes on only on your word: Go on, on its flow's card";

/**
 * Whether a user message is the one Filament sends to go on with a cut turn: its last text block is `RESUME_LINE`,
 * whatever rode ahead of it (a sub-agent's report, a background shell's exit).
 * @param {any} message
 */
export function isResumeMessage(message) {
  const c = message?.content;
  if (typeof c === "string") return c === RESUME_LINE;
  if (!Array.isArray(c)) return false;
  const last = c.filter((b) => b?.type === "text").at(-1);
  return !!last && last.text === RESUME_LINE;
}

/** The note a clean stop leaves in Filament's data folder: the chats whose harness turn ran as it stopped. */
export const RUNNING_AT_STOP = "running-at-stop.json";

/**
 * Note the chats whose harness turn runs as Filament stops (TG2-D85); with none, no note is left behind.
 * @param {string} dataDir @param {string[]} chains @param {number} [at]
 */
export function noteRunningAtStop(dataDir, chains, at = Date.now()) {
  const file = join(dataDir, RUNNING_AT_STOP);
  if (!chains.length) return rmSync(file, { force: true });
  writeFileSync(file, JSON.stringify({ at, chains }));
}

/**
 * The note the last clean stop left, read once: it is deleted as it is read. Null where there is none, or it does not
 * read as one.
 * @param {string} dataDir @returns {{ at: number, chains: string[] } | null}
 */
export function takeRunningAtStop(dataDir) {
  const file = join(dataDir, RUNNING_AT_STOP);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  rmSync(file, { force: true });
  try {
    const j = JSON.parse(text);
    return Array.isArray(j?.chains) ? { at: Number(j.at) || 0, chains: j.chains.map(String) } : null;
  } catch {
    return null;
  }
}

/**
 * Of the chats a clean stop noted, each one's newest turn the stop left with no reply: it failed while Filament stopped,
 * or a restart cut it. Only a harness turn; not one that finished, nor one waiting on the person. Its calls are its
 * newest run's: the ones its cut mark counted where the mark is that run's (`meta.cut.tools`: a start kept its work from
 * its run's log, and that run's end counts none), else the run's end's. A resume lands on the row of the resume turn it
 * goes on with (the same message), so the mark there may be an earlier run's.
 * @param {{ archive: any, runs: { getRun: (id: string) => any } | null, chains: string[] }} o
 * @returns {import("./cut-turns.js").KeptTurn[]}
 */
export function stoppedTurns({ archive, runs, chains }) {
  if (!archive) return [];
  /** @type {import("./cut-turns.js").KeptTurn[]} */
  const out = [];
  for (const chainId of chains) {
    const t = archive.getTurns(chainId).at(-1);
    const meta = t?.meta || {};
    if (!t || t.final_hash || meta.window !== "harness" || !(meta.failed || Number(meta.running) > 0)) continue;
    const run = String((t.requestIds || []).at(-1) || "");
    const tools = meta.cut?.run === run ? meta.cut.tools : runs?.getRun(run)?.summary?.toolCalls;
    out.push({ chainId, turnId: t.id, run, tools: Number(tools) || 0 });
  }
  return out;
}

/**
 * Where a cut turn stands with going on, on its `cut` mark (the page's note, labels.js `openTurnWords`): "going",
 * `{ held }` where Filament chose not to, `{ refused }` where the send was refused, or undefined to leave the mark as it
 * was.
 * @param {any} archive @param {number} turnId @param {"going" | { held: string } | { refused: string } | undefined} resume
 */
function mark(archive, turnId, resume) {
  const cut = archive.getTurn(turnId)?.meta?.cut;
  if (!cut) return;
  archive.mergeTurnMeta(turnId, { cut: { ...cut, resume } });
}

/**
 * Which of the turns the start kept go on: with the switch on, each chat's newest turn, once — not one that was itself
 * a resume and was cut again before it ran a call, nor a team's beside a chat, switch or not, nor one in a chat where
 * Filament starts no turn by itself (`notByItself`: why, or null — sessions/service.js's rule, which a wake's gate and
 * the start's sweep ask too: the person archived it). Each one's mark says it (`going`, or `held` with why); a team's
 * turn a clean stop failed gets a mark of its own, so its card knows a stop cut it and offers Resume….
 * @param {{ archive: any, kept: import("./cut-turns.js").KeptTurn[], on: boolean, notByItself?: (chainId: string) => string | null, now?: number }} o
 * @returns {{ chainId: string, turnId: number }[]}
 */
export function resumePlan({ archive, kept, on, notByItself = () => null, now = Date.now() }) {
  if (!archive) return [];
  /** @type {{ chainId: string, turnId: number }[]} */
  const plan = [];
  const seen = new Set();
  for (const k of kept) {
    if (!k.chainId || seen.has(k.chainId)) continue;
    if (archive.getTurns(k.chainId).at(-1)?.id !== k.turnId) continue;
    seen.add(k.chainId);
    const team = archive.getChain(k.chainId);
    if (team?.kind === "team") {
      const cut = archive.getTurn(k.turnId)?.meta?.cut;
      const flows = !!team.meta?.beside?.flow;
      archive.mergeTurnMeta(k.turnId, { cut: { ...(cut || { run: k.run, at: now, rounds: 0, tools: k.tools, logged: 0 }), resume: { held: flows ? FLOW_WAITS : TEAM_WAITS } } });
      continue;
    }
    if (!on) continue;
    // What the cut turn's chat is owed stays owed, and rides its next turn with the cut turn's work.
    const alone = notByItself(k.chainId);
    if (alone) {
      mark(archive, k.turnId, { held: alone });
      continue;
    }
    const turn = archive.getTurn(k.turnId);
    const message = turn?.user_hash ? archive.getMessage(turn.user_hash)?.message : null;
    // Itself a resume (core/turn-by.js): by its row's mark, or by its line where it began before turns were marked
    // (archive `bySince`).
    const since = Number(archive.bySince?.());
    const resumed = byOfTurn(turn || {}, () => (!(Number(turn?.started_at) >= since) && isResumeMessage(message) ? "resume" : null)) === "resume";
    if (resumed && !(k.tools > 0)) {
      mark(archive, k.turnId, { held: CUT_AGAIN });
      continue;
    }
    mark(archive, k.turnId, "going");
    plan.push({ chainId: k.chainId, turnId: k.turnId });
  }
  return plan;
}

/**
 * Send each planned chat its turn, all at once. `post(chainId)` sends `{ by: "resume" }` to the chat's turns route and
 * answers once the reply's head is in: `{ status, body }`, the body a refusal's JSON. A turn taken leaves the mark
 * `going`; a turn already running there — the person's own message got in first — clears it; any other refusal, or a
 * send that failed, leaves its words. → each chat's outcome, once every head is in.
 * @param {{ plan: { chainId: string, turnId: number }[], archive: any, post: (chainId: string) => Promise<{ status: number, body: any }>, log?: (level: string, msg: string) => void }} o
 * @returns {Promise<{ chainId: string, turnId: number, went: boolean, why?: string }[]>}
 */
export async function resumeCutTurns({ plan, archive, post, log = () => {} }) {
  /**
   * A mark written once the send's answer is in: memory that a stop closed meanwhile keeps none, said in the log.
   * @param {{ chainId: string, turnId: number }} p @param {"going" | { held: string } | { refused: string } | undefined} resume
   */
  const markAfter = (p, resume) => {
    try {
      mark(archive, p.turnId, resume);
    } catch (/** @type {any} */ e) {
      log("warn", `sessions: the turn a restart cut off in ${p.chainId} could not be marked (${e?.message || e})`);
    }
  };
  return Promise.all(
    plan.map(async (p) => {
      /** @type {{ status: number, body: any }} */
      let r;
      try {
        r = await post(p.chainId);
      } catch (/** @type {any} */ e) {
        const why = String(e?.message || e);
        markAfter(p, { refused: why });
        log("warn", `sessions: Filament could not go on with the turn a restart cut off in ${p.chainId} (${why})`);
        return { ...p, went: false, why };
      }
      if (r.status >= 200 && r.status < 300) {
        log("info", `sessions: Filament went on with the turn a restart cut off in ${p.chainId}`);
        return { ...p, went: true };
      }
      // A refusal's words: the route's own, or a model wire's error, which carries them in its `message`.
      const why = String(r.body?.error?.message || r.body?.error || `HTTP ${r.status}`);
      markAfter(p, r.body?.holder ? undefined : { refused: why });
      log("info", `sessions: Filament did not go on with the turn a restart cut off in ${p.chainId} (${why})`);
      return { ...p, went: false, why };
    }),
  );
}
