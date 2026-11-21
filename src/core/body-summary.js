// @ts-check
// A compact, content-free description of a request body: enough to see what came in and what went out (the record's
// `translation.received` / `translation.sent`) without storing a byte of conversation.

/** @typedef {import("./types.js").WireFormat} WireFormat */

/** Characters of text in a string or a content array (text blocks and bare strings; nothing else counts). */
const textLen = (v) =>
  typeof v === "string"
    ? v.length
    : Array.isArray(v)
      ? v.reduce(
          (n, x) => n + (typeof x?.text === "string" ? x.text.length : typeof x === "string" ? x.length : 0),
          0,
        )
      : 0;

/**
 * @param {any} b  the body
 * @param {WireFormat} format  decides where the system prompt lives
 * @param {number} bytes  the serialized size, measured by the caller
 */
export function summarizeBody(b, format, bytes) {
  const msgs = Array.isArray(b?.messages) ? b.messages : [];
  /** @type {Record<string, number>} */
  const roles = {};
  let cacheMarks = 0;
  for (const m of msgs) {
    roles[m?.role] = (roles[m?.role] || 0) + 1;
    if (Array.isArray(m?.content)) for (const c of m.content) if (c?.cache_control) cacheMarks++;
  }
  if (Array.isArray(b?.system)) for (const s of b.system) if (s?.cache_control) cacheMarks++;
  const sysMsgs = msgs.filter((m) => m?.role === "system");
  return {
    model: b?.model,
    stream: b?.stream === true,
    max_tokens: b?.max_tokens ?? b?.max_completion_tokens ?? null,
    thinking: b?.thinking ?? null,
    effort: b?.output_config?.effort ?? b?.reasoning_effort ?? b?.reasoning?.effort ?? null,
    messages: msgs.length,
    roles,
    tools: Array.isArray(b?.tools) ? b.tools.length : 0,
    systemChars:
      format === "anthropic" ? textLen(b?.system) : sysMsgs.reduce((n, m) => n + textLen(m.content), 0),
    cacheMarkers: cacheMarks,
    sampling: ["temperature", "top_p", "top_k"].filter((k) => b && k in b),
    bytes,
  };
}
