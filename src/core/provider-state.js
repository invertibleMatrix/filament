// @ts-check
// What a request names that its provider keeps on the account that sends it (the remote-agents plan's m-door): another
// machine's chat on this machine's models names none of it — a conversation, a stored prompt, a vector store, a file, a
// container, a stored item kept at this machine's provider are this machine's, and a chat sent from elsewhere neither
// reads nor adds to them. Each wire's own fields, where its API puts them; a tool's schema or a call's input that happens
// to hold a key of the same name is no such field.

/** @param {unknown} v @returns {any[]} */
const listOf = (v) => (Array.isArray(v) ? v : []);

/**
 * The first field of a request on `api`'s wire that names state its provider keeps, as a path in the body (`tools[0]
 * .vector_store_ids`); "" where it names none. Responses: `conversation`, `prompt` (a stored prompt), `previous_response_id`,
 * a tool's `vector_store_ids` or a file search, a code interpreter's container named or given files, an input's
 * `item_reference` or a part's `file_id`. Messages: `container`, a block's `source.file_id` or a source of type `file`, in
 * a message or a tool's result. Chat Completions: a `file` part's `file.file_id`.
 * @param {"anthropic" | "openai" | "responses"} api @param {any} body
 */
export function keptStateNamed(api, body) {
  if (!body || typeof body !== "object") return "";
  if (api === "responses") {
    for (const k of ["conversation", "prompt", "previous_response_id"]) if (body[k] != null) return k;
    for (const [i, t] of listOf(body.tools).entries()) {
      if (t?.vector_store_ids != null) return `tools[${i}].vector_store_ids`;
      if (t?.type === "file_search") return `tools[${i}] (a file search)`;
      if (t?.container != null && (typeof t.container !== "object" || t.container.file_ids != null)) return `tools[${i}].container`;
    }
    for (const [i, item] of listOf(body.input).entries()) {
      if (item?.type === "item_reference") return `input[${i}] (an item_reference)`;
      for (const [j, part] of listOf(item?.content).entries()) if (part?.file_id != null) return `input[${i}].content[${j}].file_id`;
    }
    return "";
  }
  if (api === "anthropic") {
    if (body.container != null) return "container";
    for (const [i, m] of listOf(body.messages).entries())
      for (const [j, b] of listOf(m?.content).entries()) {
        const at = `messages[${i}].content[${j}]`;
        if (b?.source?.file_id != null || b?.source?.type === "file") return `${at}.source.file_id`;
        for (const [k, inner] of listOf(b?.content).entries())
          if (inner?.source?.file_id != null || inner?.source?.type === "file") return `${at}.content[${k}].source.file_id`;
      }
    return "";
  }
  for (const [i, m] of listOf(body.messages).entries())
    for (const [j, part] of listOf(m?.content).entries()) if (part?.type === "file" && part.file?.file_id != null) return `messages[${i}].content[${j}].file.file_id`;
  return "";
}
