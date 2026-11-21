// @ts-check
// An agent's session and the chat's compactions (HarnessV3-ACP AC5-1). Each agent session a bridge keeps for a harness
// chat stands on one of the chat's compactions, the newest when the session started, and every harness turn names the
// chat's newest. A compaction since then starts a fresh session, whose first prompt carries the harness's composition
// of the chat: the summary, the files brought back, the turns kept. A session the chat left on a compaction it can
// still undo is kept on the record as the one from before (`before`, each with its own); an undo brings it back. A
// harness chat's fresh session is seeded from that composition whether the chat was compacted or not (HarnessV3-ACP
// AC-R1): the harness composed the whole chat for the agent's model, as its line left it. The three bridges keep their
// own records of a chat's session; this is the rule they share, and the words a fresh session's first prompt opens
// with.

/** The house header a harness turn names its chat's newest compaction in: its row's id, 0 before any. */
export const COMPACTION_HEADER = "x-filament-compaction";

/**
 * The house header a harness turn names, beside the chat's newest compaction, the compaction each agent's session of
 * the chat stands on where that is a newer one (HarnessV4_Tasks A8): one of Filament's copy alone — an agent's own in
 * the middle of a turn, which the copy follows, or the summary Filament wrote for the copy — which moves the sessions of
 * the agents that had not seen all it stands for as it was written. Such a session holds less than the summary stands
 * for: it starts fresh from the copy rather than be handed the summary on top of what it holds. `<upstream>=<row>`,
 * comma-separated, the upstream's id URI-encoded; a row with no name (`=<row>`) is any other agent's.
 */
export const STANDS_ON_HEADER = "x-filament-stands-on";

/**
 * The rows a request names (`STANDS_ON_HEADER`), by upstream; `""` for any agent it does not name.
 * @param {Record<string, string> | null | undefined} headers  lower-cased names
 * @returns {Map<string, number>}
 */
export function standsOnOf(headers) {
  /** @type {Map<string, number>} */
  const rows = new Map();
  for (const part of String(headers?.[STANDS_ON_HEADER] ?? "").split(",")) {
    const m = /^\s*([^=\s]*)=(\d+)\s*$/.exec(part);
    if (!m) continue;
    try {
      rows.set(decodeURIComponent(m[1]), Number(m[2]));
    } catch {
      // not a name Filament wrote
    }
  }
  return rows;
}

/** The header's value for those rows (`standsOnOf` read back); empty where there are none. @param {ReadonlyMap<string, number>} rows */
export const standsOnHeader = (rows) => [...rows].map(([upstream, id]) => `${encodeURIComponent(upstream)}=${id}`).join(",");

/**
 * The compaction `upstream`'s session of the chat stands on: its own row in `rows`, else any agent's, else the chat's
 * newest (`base`).
 * @param {number} base @param {ReadonlyMap<string, number>} rows @param {string} upstream
 */
export const standsOn = (base, rows, upstream) => rows.get(upstream) ?? rows.get("") ?? base;

/**
 * The compaction a request stands on, as the harness named it — for `upstream`'s session where it names one
 * (`standsOn`), else the chat's newest. Null when it names none: an outside client's request, whose client compacts
 * its own copy and leaves the agent's session as it is.
 * @param {Record<string, string> | null | undefined} headers  lower-cased names
 * @param {string | null} [upstream]  the agent that serves the request
 * @returns {number | null}
 */
export function compactionOf(headers, upstream = null) {
  const v = String(headers?.[COMPACTION_HEADER] ?? "").trim();
  if (!/^\d+$/.test(v)) return null;
  return upstream == null ? Number(v) : standsOn(Number(v), standsOnOf(headers), upstream);
}

/**
 * The house header a harness turn names its session's compaction line in (HarnessV4_Tasks A3): the tokens its agent's
 * context may hold before room is made, while the session makes room by itself. An agent that takes a line of its own
 * is given it as its session opens, so it acts in the middle of a turn, where Filament only checks between turns.
 */
export const LINE_HEADER = "x-filament-compaction-line";

/**
 * The line a request names, in tokens. Null when it names none: the session asks before it makes room, nobody knows
 * its agent's window yet, or the request is an outside client's.
 * @param {Record<string, string> | null | undefined} headers  lower-cased names
 * @returns {number | null}
 */
export function lineOf(headers) {
  const v = String(headers?.[LINE_HEADER] ?? "").trim();
  return /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null;
}

/**
 * The house header a harness turn says its own earlier try in (HarnessV4_Tasks B8): the message went before, in a
 * turn that failed after doing work or that a restart cut off, and the chat kept that try. The new try goes on in the
 * same turn of the chat, while the request's history holds the message twice: the try with its work, then the message.
 */
export const EARLIER_TRY_HEADER = "x-filament-earlier-try";

/**
 * How many of a request's user turns are an earlier try of its newest message: 1 where the harness says so, else 0.
 * A session counts the person's turns it has seen by the chat's turns (`told`, acp/prompt.js), where the try and the
 * message are one: counted as two, the session would take the next turn another engine answered for one it saw.
 * @param {Record<string, string> | null | undefined} headers  lower-cased names
 * @returns {0 | 1}
 */
export const earlierTriesOf = (headers) => (String(headers?.[EARLIER_TRY_HEADER] ?? "").trim() === "1" ? 1 : 0);

/** @param {{ basedOn?: number }} c */
const on = (c) => Number(c.basedOn) || 0;

/**
 * Where a chat's request goes on, by the compaction it stands on, and the sessions it lets go of (`gone`):
 * - `stay`: the session stands on it, or the request names none. Once a turn runs on the compacted session, the
 *   compactions under it can no longer be undone: the sessions from before go;
 * - `back`: a session from before stands on it (an undo brought the chat back there): the one to go on with, keeping
 *   those from before it. The session, and any between, go;
 * - `fresh`: a new session, from the harness's composition. The session, and every one from before it, go.
 * @template {{ basedOn?: number, before?: C | null }} C
 * @param {C} conv @param {number | null} base
 * @returns {{ move: "stay", gone: C[] } | { move: "back", to: C, gone: C[] } | { move: "fresh", gone: C[] }}
 */
export function moveFor(conv, base) {
  /** @type {C[]} */
  const earlier = [];
  for (let c = conv.before; c; c = c.before) earlier.push(c);
  if (base == null) return { move: "stay", gone: [] };
  if (on(conv) === base) return { move: "stay", gone: earlier };
  const at = earlier.findIndex((c) => on(c) === base);
  if (at >= 0) return { move: "back", to: earlier[at], gone: [conv, ...earlier.slice(0, at)] };
  return { move: "fresh", gone: [conv, ...earlier] };
}

/** What a fresh session's first prompt opens with after a compaction: the chat as it stands, not someone else's. */
export const COMPACTED_WORDS = "This conversation was compacted: here is where it stands. Continue from it, do not repeat it";
/** …and before any: the chat so far, which other models (or another session) answered. */
export const EARLIER_WORDS = "Earlier conversation (from another assistant; continue it, do not repeat it)";

/**
 * The house header a harness turn says where Filament's copy of the chat starts from a summary the chat's sessions went
 * on under — a coding agent compacted its own context and handed the summary over, and the copy follows it; or it
 * handed none, and Filament wrote one for the copy alone (HarnessV4_Tasks C29): `<id>:<n>`, that compaction's
 * row and how many of the request's turns of the person's the chat's session on this agent has seen, as the harness
 * counts them (the turns up to the newest one this agent answered). The copy changed its start under sessions that go
 * on, so the count a session made on the earlier form no longer places what it saw; this one does.
 */
export const SEEN_HEADER = "x-filament-seen";

/**
 * What a request says of the copy's start and the session's place in it; null when it says none: the copy starts from
 * no agent's summary, or the request is an outside client's.
 * @param {Record<string, string> | null | undefined} headers  lower-cased names
 * @returns {{ head: number, seen: number } | null}
 */
export function seenOf(headers) {
  const m = /^(\d+):(\d+)$/.exec(String(headers?.[SEEN_HEADER] ?? "").trim());
  return m ? { head: Number(m[1]), seen: Number(m[2]) } : null;
}

/**
 * Whether a session holds less than the whole chat: its seed or the turns another engine answered still wait for its
 * next prompt (`fresh`, `heard`: its own command went as typed, the bug report's L20), or it was never told some
 * (`partial`: catch-up is off, or it was a session from elsewhere taken into a chat that had turns). The summary such
 * a session writes as it compacts its own context stands for less than the chat, so Filament's copy does not follow it.
 * @param {{ fresh?: boolean, heard?: number[], partial?: boolean } | null | undefined} conv
 */
export const owes = (conv) => !!(conv?.partial || conv?.fresh || conv?.heard?.length);
