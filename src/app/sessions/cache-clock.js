// @ts-check
// A session's prompt cache as a message is about to be sent (HarnessV4_Tasks C26). A provider keeps a conversation's
// prefix for a while after the last request that read or wrote it: while it does, going on reads all the session
// holds at the cache's price; once it has let go, the next message pays for all of it again at the full price. So a
// message a person sends into a session whose cache has gone cold asks first (`context.compaction.resumeQuestion`),
// where the same model or agent goes on in it. For a model Filament calls the cache's life is the one its last turn's
// markers asked for — as the provider split that turn's writes, else the chat's choice (`model.cacheTtl`), else its
// route's (`cache.ttl`): five minutes or one hour — counted from the end of the session's last turn, and a model whose
// replies read and wrote no cache has none to lose. A coding agent calls its model itself, and Filament sees nothing of
// its cache: one hour is the longest any provider keeps one, so past it the agent's cache is cold whichever model it calls.
import { findRoute, findUpstream } from "../../core/routing.js";
import { mergeRules } from "../../core/shaping.js";
import { CARRY_WORDS } from "../../core/context-words.js";

/** The longest any provider keeps a prompt cache: past it a coding agent's cache is cold. */
export const AGENT_CACHE_MS = 60 * 60_000;

/** The cache lifetime the route's rules ask for a model: "1h" or "5m". @param {any} cfg @param {string} model */
export function routeCacheTtl(cfg, model) {
  const r = model ? findRoute(cfg, model) : null;
  return mergeRules(cfg?.rules, r && findUpstream(cfg, r.upstream)?.rules, r?.rules).cache?.ttl === "1h" ? "1h" : "5m";
}

/** A cache lifetime's milliseconds: an hour for "1h", else the five minutes a provider keeps a prefix by default. @param {string | null | undefined} ttl */
export const ttlMsOf = (ttl) => (ttl === "1h" ? 3_600_000 : 300_000);

/**
 * The life of the cache a turn's writes left, as its provider split them (`cacheWrite1h`, Anthropic's `cache_creation`):
 * an hour where any write was an hour's, five minutes where it wrote and none was; 0 where its tokens do not say — it
 * wrote nothing, or its provider gave no split. A chat's choice changed since does not move it.
 * @param {any} tokens  a turn's facts' tokens
 */
export function writtenTtlMs(tokens) {
  if (!(Number(tokens?.cacheWrite) > 0) || tokens?.cacheWrite1h == null) return 0;
  return Number(tokens.cacheWrite1h) > 0 ? 60 * 60_000 : 5 * 60_000;
}

/**
 * A session's cache as a message is sent. `state`: `warm` while the cache's life has not run out, `cold` once it has,
 * `none` where the session's replies read and wrote no cache. `idleMs`: since the session's last turn ended; `ttlMs`:
 * the cache's life; `leftMs`: what is left of it, 0 once cold. `seen`: Filament read the cache in the replies' own
 * counts (a model it calls); false for a coding agent's, where `warm` means "within the longest life a cache has".
 * @typedef {{ state: "warm" | "cold" | "none", idleMs: number, ttlMs: number, leftMs: number, seen: boolean }} CacheClock
 */

/**
 * The cache's clock, from when the session's last turn ended; null where none has.
 * @param {{ endedAt: number, ttlMs: number, now: number, cached?: boolean | null, leftMs?: number | null }} o  `cached`:
 *   whether the last turn's replies read or wrote the provider's cache — null for a coding agent, whose cache Filament
 *   does not see; `leftMs`: what is left of the cache's life where something counted it (a request kept warm, which a
 *   later read renews), else the life less the idle time
 * @returns {CacheClock | null}
 */
export function cacheClock({ endedAt, ttlMs, now, cached = null, leftMs = null }) {
  if (!(endedAt > 0)) return null;
  const idleMs = Math.max(0, now - endedAt);
  const left = cached === false ? 0 : Math.max(0, leftMs ?? ttlMs - idleMs);
  return { state: cached === false ? "none" : left > 0 ? "warm" : "cold", idleMs, ttlMs, leftMs: left, seen: cached != null };
}

/** A stretch of time as the question says it: "75 m", "2 h 10 m", "3 d 4 h". @param {number} ms */
export function idleWords(ms) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} m` : `${h} h`;
  return h % 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${Math.floor(h / 24)} d`;
}

/**
 * What will read the session when the message goes, and from where: a model Filament calls reads Filament's composition
 * of it (`from: "copy"`); a coding agent reads its own session, or a new one that starts from Filament's copy.
 * @typedef {{ kind: "model" | "agent", name: string, from: "session" | "copy" }} Reader
 */

/**
 * The question a cold session asks before a message goes on in it. `why`: `cold`, the cache's life ran out; `lost`,
 * the agent's bridge keeps no session of the chat any more, so a new one starts from Filament's copy — `moved`, the
 * folder's name, where that is because the chat moved there since the agent's last turn (HarnessV4_Git_Plan §12);
 * `carry`, the form that new session carries the earlier turns in (`context.carry`'s); `changed`, what the chat sends
 * ahead of its history is no longer what it last sent (agent/prefix.js) — `changes` says what moved, in words, and goes
 * with a cold question too.
 * @typedef {{ why: "cold" | "lost" | "changed", moved?: string, carry?: string, changes?: string[], idleMs: number, held: number | null, estimated: boolean,
 *   window: number | null, usable: number | null, reads: Reader, cache: CacheClock | null }} ResumeQuestion
 */

/** How much the reader holds, in words. @param {ResumeQuestion} q */
const heldOf = (q) => (q.held ? `${q.estimated ? "≈" : ""}${q.held.toLocaleString()} tokens${q.window ? ` of its ${q.window.toLocaleString()}-token window` : ""}` : null);

/**
 * The question in words: what the refusal says, and what the card opens with.
 * @param {ResumeQuestion} q
 */
export function resumeWords(q) {
  const held = heldOf(q);
  const ask = "Send it as it is, or make room first?";
  // A lost session's copy past the line says so: its card offers the forms that fit, and makes room for one that does not.
  const past = q.usable && Number(q.held) > q.usable ? `, past its ${q.usable.toLocaleString()}-token line` : "";
  const weighs = held ? `, which weighs ${held}${past}` : "";
  // The form the copy goes in, said: Words leaves the tools' output out, and the card is where that is chosen.
  const form = q.carry ? CARRY_WORDS.find((x) => x.id === q.carry) : null;
  const as = form ? ` as ${form.name} (${form.line})` : "";
  if (q.why === "lost" && q.moved)
    return `This chat moved to ${q.moved}, so ${q.reads.name} starts a new session there from Filament's copy of the chat${as}${weighs}: nothing of it is cached, so all of it is paid for at the full price. ${ask}`;
  if (q.why === "lost")
    return `${q.reads.name} keeps no session of this chat any more, so this message starts a new one from Filament's copy of the chat${as}${weighs}: nothing of it is cached, so all of it is paid for at the full price. ${ask}`;
  const changed = q.changes?.length ? q.changes.join("; ") : "";
  if (q.why === "changed" && q.reads.kind === "agent")
    return `What ${q.reads.name} is given ahead of this chat changed (${changed || "Filament's words or tools"}): its session goes on, and what it already loaded there can keep its old form — a tool it has used, the definition it first read. Making room first starts a fresh session from the compaction, which reads it all anew. ${ask}`;
  if (q.why === "changed")
    return `What this chat sends ahead of its history changed (${changed || "Filament's words or tools"}), so going on writes ${held ? `all ${held}` : "the whole session"} to ${q.reads.name}'s cache again, at a write's price — making room first leaves less to write. ${ask}`;
  const too = changed ? ` What it sends ahead of its history changed too: ${changed}.` : "";
  const life = idleWords(q.cache?.ttlMs ?? 0);
  if (q.reads.kind === "agent")
    return `This session has been idle ${idleWords(q.idleMs)}${held ? `, and ${q.reads.name} holds ${held}` : `, and ${q.reads.name} has not said how much it holds`}: a coding agent's cache lasts ${life} at the most, so going on pays for all of it again at the full price.${too} ${ask}`;
  return `This session has been idle ${idleWords(q.idleMs)}, and ${q.reads.name} keeps its cache ${life} after a turn: the cache has gone cold, so going on sends ${held ? `all ${held}` : "the whole session"} at the full price again.${too} ${ask}`;
}
