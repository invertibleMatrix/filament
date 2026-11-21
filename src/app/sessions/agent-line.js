// @ts-check
// When and how a coding agent's session makes room (HarnessV3-ACP AC5-3). The agent composes its own context and
// compacts it itself; Filament's composition of the chat only seeds a fresh agent session. So the session's line is the
// share of the agent's window it chose (`context.compaction.thresholdPercent`), read against what the agent last said
// its context holds (HarnessV3-ACP AC3-5's count, on the newest turn's record). How it makes room is the session's
// way (`context.compaction.agent`): the agent's own compaction (AC5-5), the agent writing Filament's summary (Self), or
// Filament's methods on its copy (Ours), the suggestion reading the agent's cache. A session whose cache has gone cold
// asks before it goes on (cache-clock.js).
import { flattenMessages, isUserTurn } from "../../core/wire/flatten.js";
import { ofCopyAlone, usableWindow } from "./compaction.js";
import { agentOwn } from "../../services/token-calib.js";

/**
 * What an agent's context holds as a turn starts. `unsaid`: after the agent's own compaction that named no figure after
 * it (Codex names none), so `held` is 0 until its next turn counts.
 * @typedef {{ held: number, window: number | null, estimated: boolean, endedAt: number, unsaid?: boolean }} AgentHeld
 */

/**
 * What a turn says its agent's context held when it was last heard from. A finished turn: its record's count, folded
 * into its facts. One a restart cut off (`meta.cutOff`): the newest count its run log kept, which the next start wrote
 * on it (`meta.cut.held`, app/sessions/cut-turns.js) — the agent's session still holds that. One that failed after
 * doing work (`meta.failed`, HarnessV4_Tasks B1): the count its record kept as it failed. `named`: the window the
 * agent named, 0 where it named none; `carried`: the window the record carries, whoever named it.
 * @param {any} t
 * @returns {{ upstream: string | null, held: number, named: number, carried: number, estimated: boolean, endedAt: number }}
 */
function saidBy(t) {
  if (t.meta?.cutOff) {
    const h = t.meta.cut?.held;
    return { upstream: h?.upstream ?? null, held: Number(h?.tokens) || 0, named: Number(h?.window) || 0, carried: 0, estimated: h?.exact === false, endedAt: Number(t.meta.cut?.at) || 0 };
  }
  const c = t.meta?.facts?.context;
  const carried = Number(c?.window) || 0;
  return { upstream: t.meta?.facts?.upstream ?? null, held: Number(c?.held) || 0, named: c?.source === "agent" ? carried : 0, carried, estimated: !!c?.estimated, endedAt: Number(t.endedAt) || Number(t.meta?.failed?.at) || 0 };
}

/**
 * What the agent's context holds as a turn starts: what it said at the end of the session's newest finished turn, or
 * the last count of a turn a restart cut off or that failed after it, where one was kept (HarnessV4_Tasks A2, B1; a
 * turn that ended without its reply and with no count says nothing, the filament-agent plan's 2b-C D8) —
 * when that turn ran on this agent and no compaction of Filament's came since, which starts the next turn on a fresh
 * agent session (HarnessV3-ACP AC5-1). After the agent's own compaction since (AC5-5), what it said it holds after it,
 * from then — 0, `unsaid`, where it did not say; one it made in the middle of that turn is in the turn's own count,
 * which stands, and a summary Filament wrote for its copy alone changed nothing the agent holds (`ofCopyAlone`). Null
 * where there is nothing to judge: another engine answered last,
 * the agent counted nothing, or the next turn starts fresh. The window is the one the agent named, else `window`
 * (Filament's for the model), else what the record carries.
 * @param {{ turns: readonly any[], compactions: readonly any[], upstream: string, window: number | null }} o
 * @returns {AgentHeld | null}
 */
export function agentHeld({ turns, compactions, upstream, window }) {
  const last = turns.findLast((t) => (!t.meta?.cutOff && !t.meta?.failed) || saidBy(t).held > 0);
  const said = last ? saidBy(last) : null;
  if (!last || !said || said.upstream !== upstream || said.held <= 0) return null;
  const since = sessionsSince(last, compactions);
  if (since.some((c) => c.method !== "own")) return null;
  const at = { held: said.held, window: said.named || window || said.carried || null, estimated: said.estimated, endedAt: said.endedAt };
  const own = since.at(-1);
  if (!own) return at;
  const after = Number(own.detail?.after) || 0;
  return { ...at, held: after, estimated: false, endedAt: Number(own.created_at) || 0, ...(after ? {} : { unsaid: true }) };
}

/** The compactions since a turn started that an agent's session answers to: not one written for Filament's copy alone. @param {any} t @param {readonly any[]} compactions */
const sessionsSince = (t, compactions) => compactions.filter((c) => Number(c.created_at) > (Number(t.startedAt) || 0) && !ofCopyAlone(c));

/**
 * Whether the agent's next session starts from a compaction of Filament's: the chat's newest turn ran on this agent,
 * and Filament compacted its copy since (a method of its own, or the agent writing Filament's summary) — so the turn to
 * come starts a fresh agent session from that compaction (HarnessV3-ACP AC5-1), and Filament's composition is what the
 * agent will hold.
 * @param {{ turns: readonly any[], compactions: readonly any[], upstream: string }} o
 */
export function startsFromOurs({ turns, compactions, upstream }) {
  const last = turns.at(-1);
  return !!last && saidBy(last).upstream === upstream && sessionsSince(last, compactions).some((c) => c.method !== "own");
}

/**
 * Whether the agent had a session of the chat: a finished turn ran in one (the facts' `agentSession`) since another
 * engine last answered. A turn stopped before its session was up, or refused at its login, left none.
 * @param {readonly any[]} turns  the chat's finished turns @param {string} upstream
 */
export function hadSession(turns, upstream) {
  for (let i = turns.length - 1; i >= 0; i--) {
    const f = turns[i].meta?.facts;
    if (f?.upstream !== upstream) return false;
    if (f.agentSession === true) return true;
  }
  return false;
}

/**
 * The agent's own share of its context — its prompt and tools, which its every session holds and no compaction of
 * Filament's copy makes smaller — as the chat's newest turn on that agent that began a session new to it measured it
 * (HarnessV4_Tasks C33: the turn's facts' `context.own`); null where none has.
 * @param {readonly any[]} turns @param {string} upstream
 * @returns {number | null}
 */
export function ownShare(turns, upstream) {
  for (let i = turns.length - 1; i >= 0; i--) {
    const f = turns[i].meta?.facts;
    if (f?.upstream === upstream && Number(f.context?.own) > 0) return Number(f.context.own);
  }
  return null;
}

/**
 * The agent's own share as Filament knows it best: the fit over its fresh sessions in the chat's folder, across chats
 * (token-calib.js `agentOwn`; the owner's look of 10-24), else the chat's newest measure (`ownShare`).
 * @param {readonly any[]} turns @param {string} upstream @param {string | null | undefined} cwd
 * @returns {number | null}
 */
export const ownShareOf = (turns, upstream, cwd) => agentOwn(upstream, cwd)?.own ?? ownShare(turns, upstream);

/** When a turn was last heard from: its end, or when it failed or was cut off; 0 where nothing says. @param {any} t */
export const endedAtOf = (t) => saidBy(t).endedAt;

/**
 * How many of a composed request's turns of the person's the chat's session on an agent has seen, as its bridge
 * counts them (`isUserTurn`; the `SEEN_HEADER` of adapters/agents/compactions.js): those of the turns up to the newest
 * one that agent answered, as the request holds them — its head, its window (`places`, the turn
 * each message ahead of the new one is from). None where the agent answered no turn the request still holds apart.
 * @param {{ messages: readonly any[], places: readonly number[], turns: readonly any[], upstream: string }} o
 * @returns {number}
 */
export function seenBy({ messages, places, turns, upstream }) {
  const last = turns.findLast((t) => saidBy(t).upstream === upstream);
  const through = last ? Number(last.n) || 0 : 0;
  const mine = messages.filter((_, i) => i < places.length && places[i] <= through);
  return flattenMessages("anthropic", { messages: mine }).filter(isUserTurn).length;
}

/**
 * The weight a refused seed is compacted under (HarnessV3-FailurePoints D9; HarnessV4_Tasks B5), in Filament's count of
 * the composition. `sent`: what the agent refused, by that count. Where its refusal said the most its context takes
 * (`max`) and what it counted (`counted`), the room is its limit less what it counts beyond Filament's — its own
 * prompt and tools; where it said its limit alone, that. Never more than what it refused; and what it refused where
 * it said nothing, or where what it said leaves no room at all.
 * @param {{ sent: number, max: number | null, counted: number | null }} o
 * @returns {number}
 */
export function seedRoom({ sent, max, counted }) {
  if (!(Number(max) > 0)) return sent;
  const room = Number(max) - Math.max(0, (Number(counted) || 0) - sent);
  return room > 0 ? Math.min(sent, room) : sent;
}

/**
 * The window the session's agent last named for itself, or null where it has named none: its newest turn that says
 * one, finished or cut off. What its line is a share of when nothing weighs the session this turn (`agentHeld` null:
 * a fresh session after Filament's compaction), so the line an agent is handed does not move with that.
 * @param {readonly any[]} turns @param {string} upstream
 * @returns {number | null}
 */
export function namedWindow(turns, upstream) {
  for (let i = turns.length - 1; i >= 0; i--) {
    const said = saidBy(turns[i]);
    if (said.upstream === upstream && said.named > 0) return said.named;
  }
  return null;
}

/**
 * The agent's line — `context.compaction.thresholdPercent` of its window — and whether its context is past it; null
 * when nobody knows the window.
 * @param {AgentHeld} at @param {any} compaction  the document's `context.compaction` section
 */
export function agentLine(at, compaction) {
  if (!at.window) return null;
  const usable = usableWindow(at.window, compaction);
  return { usable, over: at.held >= usable };
}

/** The agent's context against its line, in words. @param {AgentHeld} at @param {number} usable */
export const heldWords = (at, usable) =>
  `the agent's context holds ${at.estimated ? "≈" : ""}${at.held.toLocaleString()} of its ${Number(at.window).toLocaleString()}-token window, past the ${usable.toLocaleString()}-token compaction line`;

/**
 * The way an agent's session makes room now, with why: the session's choice (`context.compaction.agent`) where the
 * agent has it; else the suggestion (HarnessV4_Tasks U3-6, decision 15) — the agent's own compaction where it has one
 * now; else Self while the agent's cache is warm (its last turn ended within the longest life a cache has,
 * cache-clock.js's `AGENT_CACHE_MS`: the clock the cold question asks by) and the agent can write the summary; else
 * Ours, which every agent has.
 * @param {"suggested" | "own" | "self" | "ours"} chosen
 * @param {{ warm: boolean, self: boolean, own: boolean }} can
 * @returns {{ way: "own" | "self" | "ours", why: string }}
 */
export function agentWay(chosen, { warm, self, own }) {
  if (chosen === "own" && own) return { way: "own", why: "the agent's own compaction (context.compaction.agent: own)" };
  if (chosen === "self" && self) return { way: "self", why: "the agent writes the summary (context.compaction.agent: self)" };
  if (chosen === "ours") return { way: "ours", why: "Filament's methods on its copy (context.compaction.agent: ours)" };
  const lacks = chosen === "own" ? "this agent has no compaction of its own on demand; " : chosen === "self" ? "this agent cannot write Filament's summary; " : "";
  if (own) return { way: "own", why: `${lacks}suggested: the agent's own compaction` };
  if (warm && self) return { way: "self", why: `${lacks}suggested: the agent's cache is warm, so it writes the summary from it` };
  return { way: "ours", why: `${lacks}suggested: ${warm ? "the agent cannot write the summary" : "the agent's cache has gone cold"}, so Filament makes room on its copy` };
}
