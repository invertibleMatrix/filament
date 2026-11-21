// @ts-check
// The house key: how Filament tells its own calls through its front door — the loop's ticks, sub-agents, memory's model
// calls and its engine, the assistant, housekeeping, pings, replays — from a client's.
// One random secret per process, minted at start and held in memory only (the memory engine's child process is
// handed it at spawn); a house call authenticates with it instead of an inbound key. The lineage headers and
// Filament's own user agents mean something only on a request that presents it: a client may send any header it
// likes, but it cannot make its request an agent tick, a sub-agent or memory's own traffic — and so cannot take itself
// out of the client totals the Usage page reads. Memory's capture is no such guard: a client asks memory to stay out
// of its request by a header of its own, with no key (`x-filament-memory: off`; core/conversation.js `addsNothing`).
import { randomBytes, timingSafeEqual } from "node:crypto";

const KEY = `filament-house-${randomBytes(32).toString("base64url")}`;
const KEY_BYTES = Buffer.from(KEY);

/** The key a house call authenticates with. */
export const houseKey = () => KEY;

/** The auth header a house call sends (it counts as an inbound key wherever one is required). */
export const houseAuth = () => ({ "x-api-key": KEY });

/**
 * The credential a request presents: a Bearer token, else an x-api-key.
 * @param {Record<string, string>} headers  lower-cased names
 */
export const credentialOf = (headers) =>
  String(headers?.authorization || "").replace(/^bearer\s+/i, "").trim() || String(headers?.["x-api-key"] || "");

/**
 * Whether the request presents the house key.
 * @param {Record<string, string>} headers  lower-cased names
 */
export function isHouseCall(headers) {
  const got = Buffer.from(credentialOf(headers));
  return got.length === KEY_BYTES.length && timingSafeEqual(got, KEY_BYTES);
}

/**
 * The lineage of Filament's own machinery at work: a loop's tick, a sub-agent (its launching request, or `owner` when
 * the developer launched it).
 */
const MACHINERY_HEADERS = ["x-filament-agent-of", "x-filament-subagent-of"];

/**
 * Whether a request is Filament's machinery at work rather than a turn somebody sent: such a request is never aligned
 * with a window's history, nor born as a session of its own. The one answer the chat-command stage and memory read.
 * Meaningful on admitted headers only (`admitHeaders`), where a client's copy was already dropped.
 * @param {Record<string, string> | null | undefined} headers  lower-cased names
 */
export const isMachineryRequest = (headers) => !!headers && MACHINERY_HEADERS.some((name) => !!headers[name]);

/**
 * Headers only a house call may carry: which request this one belongs to (the lineage the records and memory key
 * on), memory's own bookkeeping, the harness's word that a message is its permission switch answering a
 * waiting call (HarnessV3-AtHome AH-F1), or the person's press of Allow on its card (`x-filament-allow`), the chat's newest compaction, which a coding agent's session follows
 * (HarnessV3-ACP AC5-1), and the newer one each agent's session stands on where one of Filament's copy alone moved it
 * (HarnessV4_Tasks A8), its compaction line, which an agent that takes one acts on in the middle of a turn
 * (HarnessV4_Tasks A3), and a call's name and class at the gate — the id it hears its waits for a slot
 * by, and that it is a sub-agent's work, which waits behind the rest (AH-F5), and the cache lifetime its chat chose for
 * the turn (`model.cacheTtl`), which the markers Filament adds ask for — and the session a request belongs to
 * (`x-filament-chain`), which Filament's own chats, their ticks and sub-agents name: a client's conversation is its own.
 * The client-facing controls (`x-filament-memory`, `-cwd`, `-conversation`, `-permissions`) are not here: a client is
 * meant to send those.
 */
export const HOUSE_ONLY_HEADERS = Object.freeze([
  ...MACHINERY_HEADERS,
  "x-filament-subagent",
  "x-filament-replay-of",
  "x-filament-memory-purpose",
  "x-filament-memory-for",
  "x-filament-parent-request",
  "x-filament-fork",
  "x-filament-job",
  "x-filament-housekeeping",
  "x-filament-mode-switch",
  "x-filament-allow",
  "x-filament-compaction",
  "x-filament-stands-on",
  "x-filament-compaction-line",
  "x-filament-earlier-try",
  "x-filament-seen",
  "x-filament-call",
  "x-filament-background",
  "x-filament-cache-ttl",
  "x-filament-chain",
  "x-filament-client",
  // A loop's call for another machine's agents' chat (services/devices.js `AGENTS_CHAT_HEADER`).
  "x-filament-agents-chat",
]);

/**
 * Headers that read what they name: `x-filament-memory-load` pastes the session it names into the request. Believed
 * from a caller that could read every session anyway — a house call, or one the admin API answers (over loopback or
 * with the admin token, naming this machine) — so a request from another machine, or a page that rebound a name to
 * this one, cannot pull a chat on this machine by naming it.
 */
export const READER_HEADERS = Object.freeze(["x-filament-memory-load"]);

/**
 * The header a client names its request's permission mode by: client-facing, so it rides to the turn whoever sent it,
 * and fixes the mode the turn runs in (`sessionMode`, app/agent/turn.js; a word that is no mode's reads as Edit). A
 * chat's turn sent to the admin API carries it there as a model request does (pipeline/stages/parse.js), where a held
 * turn's own `read-only` wins over it (sessions/service.js) — so on that row it is a press, as the body's `permissions`
 * is (http/admin/press.js `turnPresses`).
 */
export const MODE_HEADER = "x-filament-permissions";

/** Filament's own user agents (`filament-memory/…`, `filament-ping/…`, …): what the traffic classifiers key on. */
const HOUSE_USER_AGENT = /^filament-/i;

/**
 * What a client's request sent that only a house call may carry: the house-only headers it lost, the user agent in
 * Filament's own namespace it keeps only as `unverified …` (null when it sent none), and the headers that read what
 * they name, lost by a caller that could not read every session (`unread`).
 * @typedef {{ dropped: string[], agent: string | null, unread: string[] }} SetAside
 */

/**
 * The headers a model request is judged by. A house call's pass as they are. Anyone else's lose the house-only
 * headers, and a user agent in Filament's own namespace is marked `unverified` — kept for the record, no longer matched
 * by the classifiers; and the headers that read what they name, unless `reads`: the caller could read every session
 * anyway (`READER_HEADERS`). `setAside` says which, so the record can.
 * @param {Record<string, string>} headers  lower-cased names
 * @param {{ reads?: boolean }} [o]
 * @returns {{ headers: Record<string, string>, house: boolean, setAside: SetAside }}
 */
export function admitHeaders(headers, { reads = false } = {}) {
  if (isHouseCall(headers)) return { headers, house: true, setAside: { dropped: [], agent: null, unread: [] } };
  const out = { ...headers };
  /** @param {readonly string[]} names @returns {string[]} the ones it carried */
  const drop = (names) => names.filter((name) => name in out && delete out[name]);
  const dropped = drop(HOUSE_ONLY_HEADERS);
  const unread = reads ? [] : drop(READER_HEADERS);
  const ua = String(out["user-agent"] || "");
  const agent = HOUSE_USER_AGENT.test(ua) ? ua.slice(0, 60) : null;
  if (agent) out["user-agent"] = `unverified ${ua}`;
  return { headers: out, house: false, setAside: { dropped, agent, unread } };
}
