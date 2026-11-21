// @ts-check
// Which chat a request belongs to: the client's own id when it sends one, otherwise a fingerprint of the first message;
// the key also carries the upstream and the working directory, so one chat aimed at two agents is two conversations.
import { createHash } from "node:crypto";

// Conversation identity: a client-provided id when there is one (a client may send `x-session-id` per chat, OpenCode
// `x-opencode-session`, anything can send `x-filament-conversation`), otherwise a fingerprint of the first message.
/**
 * @param {string} upstreamId @param {string} cwd @param {readonly { role: string, text?: string }[]} flat
 * @param {string | null} [clientId]
 */
export function conversationKey(upstreamId, cwd, flat, clientId = null) {
  if (clientId)
    return createHash("sha1").update(`${upstreamId}\n${cwd}\nid:${clientId}`).digest("hex").slice(0, 16);
  const firstUser = flat.find((m) => m.role === "user")?.text || "";
  return createHash("sha1")
    .update(`${upstreamId}\n${cwd}\n${firstUser.slice(0, 2000)}`)
    .digest("hex")
    .slice(0, 16);
}
export const CONVERSATION_HEADERS = [
  "x-filament-conversation",
  "x-session-id",
  "x-opencode-session",
  "x-conversation-id",
  "x-thread-id",
];
export function clientConversationId(headers) {
  for (const h of CONVERSATION_HEADERS) if (headers?.[h]) return String(headers[h]).slice(0, 200);
  return null;
}
// A request of Filament's own continuing an archive chain by its id (the harness's sessions, any archived session opened
// from it; their ticks and sub-agents): a house-only header (services/house.js). Not a conversation id: memory resolves
// it to the chain's stored key, and an unknown id is ignored (HarnessV2 D5).
export const CHAIN_HEADER = "x-filament-chain";
/** @param {Record<string, any> | null | undefined} headers */
export function chainRefOf(headers) {
  return String(headers?.[CHAIN_HEADER] || "").trim();
}
/**
 * A client's word that Filament adds nothing of its own to its request (proxy-twice, FabeleHelper's of 11-11): a coding
 * agent Filament launched, whose model calls come back through Filament's door where the person's own settings point
 * it there. Its turn has Filament's memory, context and tools already; a second pass would add them again — a reminder
 * said twice, memory's tools offered twice. The request is still routed and recorded. A client-facing control, as
 * `x-filament-memory` is: any client may send it, and it names no chain.
 */
export const ADDS_HEADER = "x-filament-adds";
/** The header's line as a client sends it (ANTHROPIC_CUSTOM_HEADERS' `Name: value`). */
export const ADDS_NOTHING_LINE = `${ADDS_HEADER}: none`;
/** Whether the request asked Filament to add nothing. @param {Record<string, any> | null | undefined} headers  lower-cased names */
export const addsNothing = (headers) => String(headers?.[ADDS_HEADER] || "").trim().toLowerCase() === "none";
/**
 * The session a request's background shells belong to (HarnessV3-FixRound decision 20): the chain it names (Filament's
 * own header, else the chain memory found for it, which is the chain a sub-agent it launches rides), else the client's
 * conversation id; "" for a request that names none, so those share one anonymous session as they always shared.
 * @param {Record<string, any> | null | undefined} headers @param {string | null | undefined} chain
 */
export function shellSessionOf(headers, chain) {
  return chainRefOf(headers) || String(chain || "") || clientConversationId(headers) || "";
}
