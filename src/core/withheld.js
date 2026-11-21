// @ts-check
// Memory's withheld exchange, put back on the wire (BUG-11, 2026-09-30). When a model calls Filament's memory tools,
// Filament answers them itself and asks the same upstream again, so the client is shown ONE assistant message: the
// visible blocks of every round, the memory calls taken out. The model's true sequence was several messages — its
// first reply (thinking, the memory call), Filament's results, its next reply. Sending the merged message back is a
// sequence the model never wrote: Anthropic refuses an assistant turn whose signed thinking was rearranged ("thinking
// blocks in the latest assistant message cannot be modified" — a sub-agent's run died on it after 48 rounds), and
// every provider's prompt cache misses from that message on. So the exchange is recorded when the reply ends — the
// messages the follow-up appended, and fingerprints of what the client was shown — and every later request that
// carries the merged message has it replaced by the true sequence just before it goes upstream.
//
// Pure: hashing and message surgery. The store lives in services/memory/withheld-store.js. Only an exact match is
// replaced — every visible block, in order — so an edited or foreign message goes out as the client sent it.
import { shortHash } from "./hash.js";

const K = 24;
const FP = 32;

/**
 * One visible block's identity, the same read off the model's reply (parseReply's generic blocks) or off the client's
 * resent message (whatever the client added, like cache_control, is not part of it). Empty text is nobody's content.
 * @param {any} b @returns {string | null}
 */
export function blockKey(b) {
  if (!b || typeof b !== "object") return null;
  switch (b.type) {
    case "text":
      return b.text ? `t${shortHash(b.text, K)}` : null;
    case "thinking":
      return b.signature ? `h${shortHash(b.signature, K)}` : `h~${shortHash(b.thinking || "", K)}`;
    case "redacted_thinking":
      return `r${shortHash(b.data || "", K)}`;
    case "tool_use":
      return `u${b.id}`;
    default: {
      const { cache_control: _cc, ...rest } = b;
      return `${b.type}:${b.id || b.tool_use_id || shortHash(JSON.stringify(rest), K)}`;
    }
  }
}
/** @param {any[]} blocks */
const keysOf = (blocks) => (blocks || []).map(blockKey).filter((k) => k !== null);
/** @param {string[]} keys */
const print = (keys) => shortHash(keys.join("|"), FP);
/** @param {any[]} blocks */
const textOfBlocks = (blocks) => (blocks || []).filter((b) => b?.type === "text" && b.text).map((b) => String(b.text)).join("");
/** @param {any} m */
const textOfMessage = (m) =>
  typeof m?.content === "string"
    ? m.content
    : Array.isArray(m?.content)
      ? m.content.filter((p) => p?.type === "text" && typeof p.text === "string").map((p) => p.text).join("")
      : "";
/** @param {any[]} blocks */
const toolIdsOf = (blocks) => (blocks || []).filter((b) => b?.type === "tool_use" && b.id).map((b) => String(b.id));

/**
 * A line Filament may place in front of the reply's first text — the memory cue (`applyCueJson` and its stream stage,
 * "<line>\n\n" before the model's text, or a block of its own when there is no text) — by its hash, line endings as \n
 * and trimmed, as the recorded prefixes are (BUG-11a).
 * @param {string} t
 */
const leadKey = (t) => shortHash(String(t ?? "").replace(/\r\n?/g, "\n").trim(), K);
/**
 * The text with the recorded lines in front of it taken off (more than one can sit there: an exchange keeps every line
 * it was recorded with). `whole`: what is left is itself such a line — a block Filament added for it.
 * @param {string} text @param {Set<string>} leads @returns {{ text: string, cut: boolean, whole: boolean }}
 */
function withoutLead(text, leads) {
  let raw = String(text ?? "");
  let cut = false;
  for (let guard = 0; guard < 4; guard++) {
    const at = raw.indexOf("\n\n");
    if (at <= 0 || !leads.has(leadKey(raw.slice(0, at)))) break;
    raw = raw.slice(at + 2);
    cut = true;
  }
  return { text: raw, cut, whole: !!raw.trim() && leads.has(leadKey(raw)) };
}
/**
 * An anthropic message's blocks as the model wrote them: the recorded lines taken off its first text block, and that
 * block dropped when it was only such a line. The same array when nothing was placed.
 * @param {any[]} content @param {Set<string>} leads
 */
function blocksWithoutLead(content, leads) {
  const i = content.findIndex((b) => b?.type === "text");
  if (i < 0 || !leads.size) return content;
  const w = withoutLead(content[i].text, leads);
  if (w.whole) return [...content.slice(0, i), ...content.slice(i + 1)];
  if (!w.cut) return content;
  return [...content.slice(0, i), { ...content[i], text: w.text }, ...content.slice(i + 1)];
}

/**
 * The anchors an exchange is found by: its tool calls' ids and its thinking signatures — unique to the one reply that
 * produced them, so a lookup never picks another conversation's exchange. Text alone is never an anchor ("Done." is
 * in a thousand conversations); a message with neither ids nor signatures is never restored.
 * @param {"anthropic" | "openai"} format @param {any} msg  a client-format assistant message
 * @returns {string[]}
 */
export function anchorsOf(format, msg) {
  if (msg?.role !== "assistant") return [];
  if (format === "anthropic") return Array.isArray(msg.content) ? anchorsOfBlocks(msg.content) : [];
  return Array.isArray(msg.tool_calls) ? msg.tool_calls.filter((c) => c?.id).map((c) => `tu:${c.id}`) : [];
}
/** @param {any[]} blocks  generic or anthropic blocks */
function anchorsOfBlocks(blocks) {
  /** @type {string[]} */
  const out = [];
  for (const b of blocks || []) {
    if (b?.type === "tool_use" && b.id) out.push(`tu:${b.id}`);
    else if (b?.type === "thinking" && b.signature) out.push(`sig:${shortHash(b.signature, FP)}`);
  }
  return out;
}

/**
 * @typedef {object} ExchangeShape  what the client was shown, as fingerprints — no content (the table holds hashes only)
 * @property {1} v
 * @property {"anthropic" | "openai"} format
 * @property {number} [headCount]  anthropic: visible blocks of the rounds before the last
 * @property {number} [finCount]   anthropic: visible blocks of the last round
 * @property {number} [headLen]    openai: characters of the earlier rounds' text
 * @property {string} head
 * @property {string} fin
 * @property {string} [tools]      openai: the last round's tool call ids
 * @property {string[]} [lead]     the lines Filament may have placed in front of the reply's first text, hashed
 *   (BUG-11a): taken off the client's message before it is compared
 */

/**
 * Describe an exchange for the store, or null when it cannot be found again (no anchor) or has nothing to restore.
 * @param {{ format: "anthropic" | "openai", head: any[], final: any[], lead?: string[] }} x  `head`: the visible blocks
 *   of the rounds before the last (memory calls taken out); `final`: the last round's visible blocks — both
 *   parseReply-shaped; `lead`: the lines Filament may place in front of the reply (the memory cue)
 * @returns {{ shape: ExchangeShape, anchors: string[] } | null}
 */
export function describeExchange({ format, head, final, lead = [] }) {
  const leads = (lead || []).filter((t) => String(t ?? "").trim()).map(leadKey);
  const d = describeBare({ format, head, final });
  if (d && leads.length) d.shape.lead = leads;
  return d;
}
/** @param {{ format: "anthropic" | "openai", head: any[], final: any[] }} x @returns {{ shape: ExchangeShape, anchors: string[] } | null} */
function describeBare({ format, head, final }) {
  if (format === "anthropic") {
    const finKeys = keysOf(final);
    if (!finKeys.length) return null;
    const headKeys = keysOf(head);
    const anchors = [...new Set(anchorsOfBlocks([...(head || []), ...(final || [])]))];
    if (!anchors.length) return null;
    return { shape: { v: 1, format, headCount: headKeys.length, head: print(headKeys), finCount: finKeys.length, fin: print(finKeys) }, anchors };
  }
  if (format === "openai") {
    const ids = toolIdsOf(final);
    if (!ids.length) return null;
    const headText = textOfBlocks(head);
    const finText = textOfBlocks(final);
    return {
      shape: { v: 1, format, headLen: headText.length, head: shortHash(headText, FP), fin: shortHash(finText, FP), tools: print(ids) },
      anchors: ids.map((id) => `tu:${id}`),
    };
  }
  return null;
}

/**
 * The last round's own message, cut out of the merged one — or null when the message is not exactly what the client
 * was shown (edited, trimmed, another reply that happens to share an anchor).
 * @param {"anthropic" | "openai"} format @param {any} msg @param {ExchangeShape} shape
 * @returns {any | null}
 */
export function matchExchange(format, msg, shape) {
  if (msg?.role !== "assistant" || !shape || shape.format !== format) return null;
  const leads = new Set(Array.isArray(shape.lead) ? shape.lead : []);
  if (format === "anthropic") {
    if (!Array.isArray(msg.content)) return null;
    const headCount = Number(shape.headCount) || 0;
    const finCount = Number(shape.finCount) || 0;
    // What the model wrote: a line recorded in front of its text was Filament's, never the model's (BUG-11a).
    const content = blocksWithoutLead(msg.content, leads);
    /** @type {{ k: string, i: number }[]} */
    const keyed = [];
    content.forEach((/** @type {any} */ b, /** @type {number} */ i) => {
      const k = blockKey(b);
      if (k) keyed.push({ k, i });
    });
    if (!finCount || keyed.length !== headCount + finCount) return null;
    if (print(keyed.slice(0, headCount).map((x) => x.k)) !== shape.head) return null;
    if (print(keyed.slice(headCount).map((x) => x.k)) !== shape.fin) return null;
    // The client's own bytes for the last round's blocks (its cache markers included), from its first keyed block on.
    return { ...msg, content: content.slice(headCount ? keyed[headCount].i : 0) };
  }
  const text = withoutLead(textOfMessage(msg), leads).text;
  const ids = Array.isArray(msg.tool_calls) ? msg.tool_calls.map((/** @type {any} */ c) => String(c?.id || "")) : [];
  const headLen = Number(shape.headLen) || 0;
  if (print(ids) !== shape.tools || text.length < headLen) return null;
  if (shortHash(text.slice(0, headLen), FP) !== shape.head || shortHash(text.slice(headLen), FP) !== shape.fin) return null;
  const finText = text.slice(headLen);
  return { ...msg, content: finText || null };
}

/**
 * Whether the message after `i` answers every tool call of the last round's own message (true when it has none).
 * @param {"anthropic" | "openai"} format @param {any} fin @param {any[]} messages @param {number} i
 */
function answered(format, fin, messages, i) {
  const ids = format === "anthropic" ? toolIdsOf(fin.content) : (Array.isArray(fin.tool_calls) ? fin.tool_calls : []).map((/** @type {any} */ c) => String(c?.id || "")).filter(Boolean);
  if (!ids.length) return true;
  /** @type {Set<string>} */
  const got = new Set();
  if (format === "anthropic") {
    const next = messages[i + 1];
    for (const b of Array.isArray(next?.content) ? next.content : []) if (b?.type === "tool_result" && b.tool_use_id) got.add(String(b.tool_use_id));
  } else for (let j = i + 1; j < messages.length && messages[j]?.role === "tool"; j++) got.add(String(messages[j].tool_call_id || ""));
  return ids.every((id) => got.has(id));
}

/**
 * Replace every merged message the store knows by the model's true sequence: the withheld messages (the rounds that
 * called memory, Filament's results), then the last round's own message. Never mutates `messages`; the store's
 * messages are copied, so later stages may edit what they are given.
 * @param {"anthropic" | "openai"} format
 * @param {any[]} messages
 * @param {(anchors: string[]) => Map<string, { shape: ExchangeShape & { rounds?: number }, prefix: any[] }>} lookup
 * @returns {{ messages: any[], restored: number, rounds: number }}
 */
export function restoreMessages(format, messages, lookup) {
  const none = { messages, restored: 0, rounds: 0 };
  if (!Array.isArray(messages) || messages.length < 2) return none;
  /** @type {[number, string[]][]} */
  const wanted = [];
  const all = new Set();
  messages.forEach((m, i) => {
    const a = anchorsOf(format, m);
    if (!a.length) return;
    wanted.push([i, a]);
    for (const x of a) all.add(x);
  });
  if (!wanted.length) return none;
  const found = lookup([...all]);
  if (!found || !found.size) return none;
  /** @type {any[] | null} */
  let out = null;
  let restored = 0;
  let rounds = 0;
  // From the end, so the indices of earlier messages stay valid while later ones grow.
  for (const [i, anchors] of wanted.reverse()) {
    const hit = anchors.map((a) => found.get(a)).find(Boolean);
    if (!hit || !Array.isArray(hit.prefix) || !hit.prefix.length) continue;
    const fin = matchExchange(format, messages[i], hit.shape);
    if (!fin) continue;
    // A last round that called the client's tools goes back only before their answers (BUG-11c): a message resent
    // without them would end on a tool call nobody answered.
    if (!answered(format, fin, messages, i)) continue;
    // Already in its true form (the withheld messages sit right before it): nothing to put back.
    if (i > 0 && JSON.stringify(messages[i - 1]) === JSON.stringify(hit.prefix[hit.prefix.length - 1])) continue;
    out ??= messages.slice();
    out.splice(i, 1, ...structuredClone(hit.prefix), fin);
    restored++;
    rounds += Number(hit.shape.rounds) || 1;
  }
  return out ? { messages: out, restored, rounds } : none;
}
