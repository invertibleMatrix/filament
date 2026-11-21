// @ts-check
// When a chat's record of its agent session goes (HarnessV4_Tasks C25): the idle sweep's rule, which the three bridges
// share. Each keeps, per chat, which agent session continues it; every minute a sweep looks at the chats nobody has
// used for a while. A harness chat lives in Filament's archive for as long as the person keeps it, and its agent holds
// the conversation in a context it compacts by itself: the record of its session outlives idleness, and only the
// agent's hold on the session is let go. An outside client's chat is the client's: it seeds a new session from its own
// history, so its record goes.

/**
 * A harness chat's record goes once the chat has gone unused this long: by then an agent has deleted the session
 * itself (Claude Code keeps one 30 days), so nothing that could be opened again goes with it.
 */
export const CHAT_KEPT_MS = 30 * 24 * 3600_000;

/**
 * What the idle sweep does with a chat's record:
 * - `keep`: work is queued or running on it (`inUse`), or it has not been idle past its own limit (`idleMs`, the
 *   upstream's `acp.sessionIdleMinutes` as the record was made);
 * - `rest`: a harness chat's (`harness`), idle past its limit. Its agent lets go of the session where it holds it
 *   open, and the record stays: the chat's next message opens the same session again, with all its agent holds. A
 *   fresh session would start from Filament's whole copy of the chat, which no agent's own compaction has shortened;
 * - `drop`: an outside client's chat idle past its limit, or a harness chat unused for `CHAT_KEPT_MS`.
 * @param {{ lastUsed: number, idleMs?: number, harness?: boolean }} c @param {number} now @param {boolean} inUse
 * @returns {"keep" | "rest" | "drop"}
 */
export function idleStep(c, now, inUse) {
  const idle = now - c.lastUsed;
  if (inUse || idle <= (c.idleMs || 4 * 3600_000)) return "keep";
  return c.harness && idle <= CHAT_KEPT_MS ? "rest" : "drop";
}

/**
 * The durable line a dropped chat leaves, as a bridge's `#op` takes it: whose session was forgotten, and how long the
 * chat had gone unused. The chat's next message starts a new session, and this line says why. Ids and counts only.
 * @param {{ upstreamId?: string, sessionId?: string, agentId?: string, lastUsed: number, harness?: boolean }} c @param {number} now
 * @returns {[string, { sub: string, detail: any, ref: any }]}
 */
export function idleDropOp(c, now) {
  const id = String(c.sessionId || c.agentId || "");
  const hours = Math.round((now - c.lastUsed) / 360_000) / 10;
  return [
    `forgot an idle chat's agent session on ${c.upstreamId} (${id.slice(0, 12)}): unused ${hours} h`,
    { sub: "idle", detail: { upstream: c.upstreamId, sessionId: id, idleHours: hours, harness: c.harness === true }, ref: { upstreamId: c.upstreamId, sessionId: id } },
  ];
}
