// @ts-check
// Reading the reply stream of `/v1/messages` (and any SSE the harness follows): a byte stream into events, and the
// Anthropic event vocabulary into the reply's blocks. The parsing is pure and tested in test/harness-page.test.js;
// the fetch reader is the thin effectful edge.

/**
 * An SSE chunk parser: feed decoded text, get whole events. An event is one or more `data:` lines (joined with \n)
 * ended by a blank line; `id:` is the event's id (the run log's resume cursor); comment lines are ignored.
 * @returns {{ feed: (s: string) => { data: string, id: string | null }[], end: () => { data: string, id: string | null }[] }}
 */
export function createSseParser() {
  let buf = "";
  let data = [];
  let id = null;
  const events = [];
  const flushEvent = () => {
    if (!data.length && id === null) return;
    if (data.length) events.push({ data: data.join("\n"), id });
    data = [];
    id = null;
  };
  const feedLines = (line) => {
    if (line === "") return flushEvent();
    if (line.startsWith(":")) return;
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    else if (line.startsWith("id:")) id = line.slice(3).replace(/^ /, "") || null;
  };
  return {
    feed(s) {
      buf += s;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        feedLines(line);
      }
      const out = events.splice(0);
      return out;
    },
    end() {
      if (buf.trim()) feedLines(buf.replace(/\r$/, ""));
      buf = "";
      flushEvent();
      return events.splice(0);
    },
  };
}
import { saidUnder } from "./failure.js";

/**
 * The accumulator for one Anthropic reply: content blocks in order (text / thinking), the usage as it grows, the
 * stop reason, the error. Deltas append to the open block; a block boundary starts the next. The reply says when the
 * wire closed its last block (`tailClosed`): that model call is over, and the drawing's caret is an open tail's alone
 * (`tailOpen`).
 * A stream that ends in an error keeps what its event said beyond the message: the failure's two parts (`failure`),
 * and under the message the agent's own error where one came, else the event as it came (`errorDetail`).
 * @returns {{ push: (j: any) => void, reply: { blocks: { type: "text" | "thinking", text: string }[], usage: any, stopReason: string | null, error: string | null, tailClosed?: boolean, errorDetail?: string, failure?: { head: string, more: string } | null, httpStatus?: number, errorBody?: any } }}
 */
export function createAnthropicAccumulator() {
  /** @type {{ type: "text" | "thinking", text: string }[]} */
  const blocks = [];
  /** @type {{ blocks: { type: "text" | "thinking", text: string }[], usage: any, stopReason: string | null, error: string | null, tailClosed?: boolean, errorDetail?: string, failure?: { head: string, more: string } | null, httpStatus?: number, errorBody?: any }} */
  const reply = { blocks, usage: null, stopReason: null, error: null };
  const open = (type) => {
    if (blocks.at(-1)?.type === type) return;
    blocks.push({ type, text: "" });
  };
  return {
    push(j) {
      if (!j || typeof j !== "object") return;
      if (j.type === "content_block_start") {
        const t = j.content_block?.type;
        if (t === "text" || t === "thinking") {
          blocks.push({ type: t, text: t === "text" ? j.content_block.text || "" : j.content_block.thinking || "" });
          reply.tailClosed = false;
        }
      } else if (j.type === "content_block_delta") {
        const d = j.delta || {};
        if (d.type === "text_delta") {
          open("text");
          blocks[blocks.length - 1].text += d.text || "";
          reply.tailClosed = false;
        } else if (d.type === "thinking_delta") {
          open("thinking");
          blocks[blocks.length - 1].text += d.thinking || "";
          reply.tailClosed = false;
        }
      } else if (j.type === "content_block_stop") reply.tailClosed = true;
      else if (j.type === "message_start") reply.usage = { ...(reply.usage || {}), ...(j.message?.usage || {}) };
      else if (j.type === "message_delta") {
        reply.usage = { ...(reply.usage || {}), ...(j.usage || {}) };
        if (j.delta?.stop_reason) reply.stopReason = j.delta.stop_reason;
      } else if (j.type === "error") {
        const under = saidUnder(j);
        reply.error = j.error?.message || "stream error";
        reply.failure = under.failure;
        reply.errorDetail = (under.detail || JSON.stringify(j, null, 2)).slice(0, 4000);
      }
    },
    reply,
  };
}

/**
 * A joining page's reply, from its run's `words` frames (HarnessV3-Launch LD-D16), in the accumulator's shape. The whole
 * set lands on the blocks the page holds, in place, so the drawing's handles keep theirs; a piece adds to its block, or
 * opens the next. A piece out of order is left: none should come, since the server sends the whole set after any piece
 * it could not write. A block's end closes the reply's tail (`end`, or the whole set's `open: false`), and the next
 * piece opens it again.
 * @param {any} reply  the page's reply so far, or null @param {any} frame
 */
export function applyWords(reply, frame) {
  const out = reply || { blocks: [], usage: null, stopReason: null, error: null };
  if (Array.isArray(frame?.blocks)) {
    frame.blocks.forEach((/** @type {any} */ b, /** @type {number} */ i) => {
      const have = out.blocks[i];
      if (have && have.type === b.type) have.text = String(b.text || "");
      else out.blocks[i] = { type: b.type, text: String(b.text || "") };
    });
    out.tailClosed = frame.open === false;
    return out;
  }
  if (frame?.end === true) {
    out.tailClosed = true;
    return out;
  }
  const p = frame?.piece;
  if (!p) return out;
  const have = out.blocks[p.block];
  if (have && have.type === p.type) have.text += String(p.text || "");
  else if (p.block === out.blocks.length) out.blocks.push({ type: p.type, text: String(p.text || "") });
  else return out;
  out.tailClosed = false;
  return out;
}

/**
 * Whether the reply's last block still takes words: the caret's one condition (HarnessV4_Tasks U4). A reply whose last
 * block has ended keeps none — its model call is over and its tools run.
 * @param {{ blocks?: any[], tailClosed?: boolean } | null | undefined} reply
 */
export const tailOpen = (reply) => !!reply?.blocks?.length && reply.tailClosed !== true;

/**
 * Read a fetch response's SSE body into events. `onEvent(parsed, rawEvent)` runs per event; `[DONE]` ends.
 * Returns when the body closes (also on abort).
 * @param {Response} res @param {(j: any, ev: { data: string, id: string | null }) => void} onEvent
 */
export async function readSse(res, onEvent) {
  if (!res.body) throw new Error("empty stream");
  const parser = createSseParser();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const ev of parser.feed(dec.decode(value, { stream: true }))) {
      if (ev.data === "[DONE]") return;
      let j = null;
      try {
        j = JSON.parse(ev.data);
      } catch {
        continue;
      }
      onEvent(j, ev);
    }
  }
  for (const ev of parser.end()) {
    if (ev.data === "[DONE]") return;
    try {
      onEvent(JSON.parse(ev.data), ev);
    } catch {}
  }
}
