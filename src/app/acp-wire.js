// @ts-check
// The agent's reply on the client's wire, hand-built: an agent reports events (text, thoughts, tool activity), not
// SSE, so Filament writes the Anthropic or Chat Completions stream itself — the message head on the first output,
// content blocks opened and closed as the kind of output changes, pings while the agent thinks in silence, and the
// closing usage and stop reason. The same object also writes the whole reply as JSON for a non-streaming client.
import { sendJson, sseHead } from "./pipeline/respond.js";

/** @typedef {import("node:http").ServerResponse} ServerResponse */
/** @typedef {{ text: string, nativeThought: string }} Collected  what the turn gathered: the reply text and the thoughts sent as thinking blocks */
/** @typedef {{ id: string, name: string, args: string, input: any }} ActionCall  a client tool call the agent asked for */

/**
 * @param {object} args
 * @param {ServerResponse} args.res
 * @param {"anthropic" | "openai"} args.format
 * @param {string} args.model  the model name the client sent; echoed in every event
 * @param {string} args.requestId
 * @param {string} args.upstreamId
 * @param {boolean} args.stream  whether the client asked for a stream
 * @param {number} args.heartbeatMs  silence after which a ping goes out
 * @param {number} args.pacingMs  how long text is held after a thought so the thought paints first
 * @param {() => void} args.onFirstByte  called when the first real output reaches the client
 * @param {string} [args.idPrefix]  the message id's middle part: "acp" for an agent upstream, "agent" for the agent loop
 * @param {boolean} [args.sideEvents]  the reply carries its run's events beside it (`runEvent`), and its head says
 *   so (`x-filament-run-events: 1`) — streamed replies only; the harness's own turn asks for them (R3)
 */
export function createAgentReply({
  res,
  format,
  model,
  requestId,
  upstreamId,
  stream,
  heartbeatMs,
  pacingMs,
  onFirstByte,
  idPrefix = "acp",
  sideEvents = false,
}) {
  const msgId = format === "anthropic" ? `msg_${idPrefix}_${requestId}` : `chatcmpl-${idPrefix}-${requestId}`;
  const created = Math.floor(Date.now() / 1000);
  /** @type {Record<string, string>} */
  const extra = { "x-filament-request-id": requestId, "x-filament-upstream": upstreamId, ...(sideEvents && stream ? { "x-filament-run-events": "1" } : {}) };
  let headersSent = false,
    started = false,
    blockIndex = -1,
    /** @type {"text" | "thinking" | null} */
    blockType = null,
    // Whether the open block has carried words yet (the Chat Completions wire's join, below).
    blockSaid = false,
    lastWrite = Date.now();
  // The Chat Completions wire has no blocks: the reply's words of each kind are one string. A block that starts after
  // earlier words of its kind opens with a blank line, so a later round's words — or Filament's note — never run into
  // the last ones, as the Anthropic wire keeps its blocks apart (HarnessV3-Launch LD-D7's leftover).
  const said = { text: false, thinking: false };
  /** @param {string} s */
  const write = (s) => {
    // The same guard the heartbeat below uses, and it is load-bearing rather than tidy: buffered thoughts flush on
    // a 400 ms timer, and events can still arrive between the last flush and `res.end()` (around `flushPaced()` and
    // the client-action detach), so writing after the response ended is reachable. On Node that fails SILENTLY — no
    // throw, no ERR_STREAM_WRITE_AFTER_END — so without this guard the bytes vanish while `headersSent` stays set,
    // and the flush keeps mutating the collected text and the record after `finish()`. Bailing here means the output
    // is dropped deliberately, on a socket that is already gone, instead of half-written to nobody.
    if (res.writableEnded || res.destroyed) return;
    if (!headersSent) {
      res.writeHead(200, sseHead({ "x-accel-buffering": "no", ...extra }));
      res.flushHeaders?.();
      headersSent = true;
    }
    res.write(s);
    lastWrite = Date.now();
  };
  /** @type {(type: string, data: Record<string, unknown>) => void} */
  const aev = (type, data) => write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  /** @type {(delta: Record<string, unknown>, finish?: string | null) => void} */
  const oev = (delta, finish = null) =>
    write(
      `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
    );
  const ensureStart = () => {
    if (started) return;
    started = true;
    if (format === "anthropic")
      aev("message_start", {
        message: {
          id: msgId,
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      });
    else oev({ role: "assistant", content: "" });
  };
  const closeBlock = () => {
    if (!blockType) return;
    if (format === "anthropic") aev("content_block_stop", { index: blockIndex });
    blockType = null;
  };
  /** @param {"text" | "thinking"} type */
  const openBlock = (type) => {
    if (blockType === type) return;
    closeBlock();
    blockIndex++;
    blockType = type;
    blockSaid = false;
    if (format === "anthropic")
      aev("content_block_start", {
        index: blockIndex,
        content_block: type === "thinking" ? { type: "thinking", thinking: "" } : { type: "text", text: "" },
      });
  };
  /**
   * A Chat Completions delta's words: the first words of a block that follows earlier words of its kind open with a
   * blank line. @param {"text" | "thinking"} type @param {string} t
   */
  const joined = (type, t) => {
    openBlock(type);
    if (!t) return t;
    const lead = !blockSaid && said[type] ? "\n\n" : "";
    blockSaid = true;
    said[type] = true;
    return lead + t;
  };
  // Heartbeat: an agent may think in silence for minutes; without bytes on the wire the client's socket idles and
  // some clients give up. Every heartbeatMs of silence a harmless ping goes out (Anthropic's own API sends the same
  // ping events; OpenAI-style parsers ignore SSE comment lines). Only for streaming replies: JSON replies cannot
  // start early. The first ping opens the stream, so a fallback upstream is only tried for failures faster than that.
  // A ping is not the reply: the request stays "pending" on the dashboard until the agent's first real output.
  const heartbeat = stream
    ? setInterval(
        () => {
          if (res.writableEnded || res.destroyed || Date.now() - lastWrite < heartbeatMs) return;
          ensureStart();
          write(format === "anthropic" ? `event: ping\ndata: {"type":"ping"}\n\n` : ": keep-alive\n\n");
        },
        Math.max(250, Math.min(heartbeatMs / 2, 5000)),
      )
    : null;
  if (heartbeat) res.on("close", () => clearInterval(heartbeat));
  // Pacing: a chat client paints a thought block above the text only when the thought arrives a moment earlier.
  // Cursor's CLI over ACP hands over a whole step at once (thought, text, tool call in the same instant), and then
  // the text is painted first with the thought underneath. Text is held back briefly after a thought so the
  // thought paints first; order is always preserved, and the tail of the reply waits for the queue to drain.
  let paceUntil = 0;
  /** @type {(() => void)[]} */
  const paced = [];
  /** @type {NodeJS.Timeout | null} */
  let paceTimer = null;
  const runPaced = () => {
    paceTimer = null;
    while (paced.length && Date.now() >= paceUntil) /** @type {() => void} */ (paced.shift())();
    if (paced.length) paceTimer = setTimeout(runPaced, Math.max(1, paceUntil - Date.now()));
  };
  /** @param {() => void} fn @param {boolean} [thought] */
  const emitPaced = (fn, thought = false) => {
    if (thought) {
      if (paced.length) paced.push(fn);
      else fn();
      paceUntil = Date.now() + pacingMs;
      return;
    }
    if (paced.length || Date.now() < paceUntil) {
      paced.push(fn);
      if (!paceTimer) paceTimer = setTimeout(runPaced, Math.max(1, paceUntil - Date.now()));
    } else fn();
  };
  const flushPaced = () =>
    new Promise((resolve) => {
      const check = () => {
        if (!paced.length) return resolve(undefined);
        if (!paceTimer) runPaced();
        setTimeout(check, 5);
      };
      check();
    });
  /** @param {string} t */
  const streamText = (t) =>
    emitPaced(() => {
      ensureStart();
      onFirstByte();
      if (format === "anthropic") {
        openBlock("text");
        aev("content_block_delta", { index: blockIndex, delta: { type: "text_delta", text: t } });
      } else oev({ content: joined("text", t) });
    });
  /** @param {string} t */
  const streamThought = (t) =>
    emitPaced(() => {
      ensureStart();
      onFirstByte();
      if (format === "anthropic") {
        openBlock("thinking");
        aev("content_block_delta", { index: blockIndex, delta: { type: "thinking_delta", thinking: t } });
      } else oev({ reasoning_content: joined("thinking", t) });
    }, true);
  /**
   * The provider's signature for the open thinking block, as its own `signature_delta` — an Anthropic-format client
   * that replays the block in its next request needs it, or the provider refuses the history. Nothing on the wire
   * for chat formats (no place for it) or when no thinking block is open.
   * @param {string} sig
   */
  const streamSignature = (sig) =>
    emitPaced(() => {
      if (format !== "anthropic" || blockType !== "thinking") return;
      aev("content_block_delta", { index: blockIndex, delta: { type: "signature_delta", signature: sig } });
    }, true);
  /** The closing usage chunk of a Chat Completions stream (empty choices), then the terminator. */
  const endOpenaiStream = (usageObj) => {
    write(
      `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created, model, choices: [], usage: usageObj })}\n\n`,
    );
    write("data: [DONE]\n\n");
  };
  /** @param {ActionCall[]} calls */
  const toolCalls = (calls, withIndex) =>
    calls.map((c, i) => ({
      ...(withIndex ? { index: i } : {}),
      id: c.id,
      type: "function",
      function: { name: c.name, arguments: c.args },
    }));

  return {
    extra,
    get headersSent() {
      return headersSent;
    },
    /**
     * The turn has a run to look up (HarnessV3-Launch LD-D13): said in the head, so a client asks `/api/runs/<id>`
     * only where one exists. The agent loop starts its run before the reply's first byte; a head already sent stays
     * as it went.
     */
    markRun() {
      extra["x-filament-run"] = "1";
    },
    write,
    ensureStart,
    /**
     * One of the turn's run events, a whole SSE frame of Filament's own beside the reply (HarnessV3-Responsiveness R3):
     * `{"type":"filament_run","event":…}` as `filament_run`, so the page needs no second stream to draw the cards — its
     * client reads them off by their `type` and the reply's own events never mix with them. Through the same guarded
     * write, so a frame never lands after the reply ended. A reply that did not ask for side events, or is not
     * streamed, sends nothing. The event comes as its JSON as the run log made it (services/runs.js `eventJson`): a live
     * event is serialised once, for its file and every follow of the run, this reply's among them.
     * → false once the reply can take no more.
     * @param {string} eventJson
     */
    runEvent(eventJson) {
      if (!sideEvents || !stream || res.writableEnded || res.destroyed) return false;
      write(`event: filament_run\ndata: {"type":"filament_run","event":${eventJson}}\n\n`);
      return true;
    },
    streamText,
    streamThought,
    streamSignature,
    flushPaced,
    /**
     * The open content block ends here, so the next delta opens a new one — the agent loop's "one text block per
     * model call" (plan §4.5); on the Chat Completions wire the next words then open with a blank line. Paced like the
     * deltas, so it lands after any text still held back behind a thought.
     */
    breakBlock() {
      emitPaced(() => closeBlock());
    },
    /**
     * The whole reply as JSON from content blocks the caller assembled — the agent loop's per-call thinking and text
     * blocks, exactly the ones a streaming client received as deltas. On the Chat Completions wire each kind's blocks
     * that carry words are joined by a blank line, as the stream joined them.
     * @param {any[]} content @param {string} stopReason @param {Record<string, unknown>} usageObj
     */
    sendBlocks(content, stopReason, usageObj) {
      onFirstByte();
      if (format === "anthropic")
        return sendJson(
          res,
          200,
          { id: msgId, type: "message", role: "assistant", model, content, stop_reason: stopReason, stop_sequence: null, usage: usageObj },
          extra,
        );
      /** @param {"text" | "thinking"} type */
      const words = (type) => content.filter((b) => b?.type === type && b[type]).map((b) => b[type]).join("\n\n");
      const text = words("text");
      const thought = words("thinking");
      /** @type {Record<string, unknown>} */
      const message = { role: "assistant", content: text };
      if (thought) message.reasoning_content = thought;
      sendJson(
        res,
        200,
        { id: msgId, object: "chat.completion", created, model, choices: [{ index: 0, message, finish_reason: stopReason }], usage: usageObj },
        extra,
      );
    },
    /** A stream that has already begun ends with an error event in the client's format. @param {string} message */
    /**
     * @param {string} message @param {string | null} [detail]  what is said under the message, not in it
     * @param {{ head: string, more: string } | null} [failure]  the message in its two parts, where a failure in the
     *   one shape made it (core/failure.js): the page's card draws them
     */
    endWithError(message, detail = null, failure = null) {
      const more = { ...(detail ? { detail } : {}), ...(failure ? { failure } : {}) };
      if (format === "anthropic") aev("error", { error: { type: "api_error", message, ...more } });
      else write(`data: ${JSON.stringify({ error: { message, type: "server_error", ...more } })}\n\ndata: [DONE]\n\n`);
      res.end();
    },
    /**
     * The stream ends with the tool calls the agent asked the client to run.
     * @param {ActionCall[]} calls @param {Record<string, unknown>} usageObj
     */
    endWithActions(calls, usageObj) {
      ensureStart();
      onFirstByte();
      if (format === "anthropic") {
        closeBlock();
        for (const c of calls) {
          blockIndex++;
          aev("content_block_start", {
            index: blockIndex,
            content_block: { type: "tool_use", id: c.id, name: c.name, input: {} },
          });
          aev("content_block_delta", {
            index: blockIndex,
            delta: { type: "input_json_delta", partial_json: c.args },
          });
          aev("content_block_stop", { index: blockIndex });
        }
        blockType = null;
        aev("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: usageObj });
        aev("message_stop", {});
      } else {
        oev({ tool_calls: toolCalls(calls, true) });
        oev({}, "tool_calls");
        endOpenaiStream(usageObj);
      }
      res.end();
    },
    /**
     * The whole reply as JSON, ending with the tool calls the agent asked the client to run.
     * @param {Collected} col @param {ActionCall[]} calls @param {Record<string, unknown>} usageObj
     */
    sendActions(col, calls, usageObj) {
      onFirstByte();
      if (format === "anthropic") {
        const content = [];
        if (col.nativeThought) content.push({ type: "thinking", thinking: col.nativeThought });
        if (col.text) content.push({ type: "text", text: col.text });
        for (const c of calls) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
        sendJson(
          res,
          200,
          {
            id: msgId,
            type: "message",
            role: "assistant",
            model,
            content,
            stop_reason: "tool_use",
            stop_sequence: null,
            usage: usageObj,
          },
          extra,
        );
      } else {
        /** @type {Record<string, unknown>} */
        const message = { role: "assistant", content: col.text || null, tool_calls: toolCalls(calls, false) };
        if (col.nativeThought) message.reasoning_content = col.nativeThought;
        sendJson(
          res,
          200,
          {
            id: msgId,
            object: "chat.completion",
            created,
            model,
            choices: [{ index: 0, message, finish_reason: "tool_calls" }],
            usage: usageObj,
          },
          extra,
        );
      }
    },
    /**
     * The stream ends normally. @param {string} stopReason  already mapped to the wire format
     * @param {Record<string, unknown>} usageObj
     */
    endStream(stopReason, usageObj) {
      ensureStart();
      onFirstByte();
      if (format === "anthropic") {
        // A reply that never opened a block still gets one; a reply whose last block was closed on purpose (the agent
        // loop's per-call blocks) must not gain an empty text block the client would resend and be refused for.
        if (!blockType && blockIndex < 0) openBlock("text");
        closeBlock();
        aev("message_delta", { delta: { stop_reason: stopReason, stop_sequence: null }, usage: usageObj });
        aev("message_stop", {});
      } else {
        oev({}, stopReason);
        endOpenaiStream(usageObj);
      }
      res.end();
    },
    /**
     * The whole reply as JSON. Inline thoughts (text mode, or auto on OpenAI format) are already part of the text,
     * in order; only the native ones travel as a thinking block or `reasoning_content`.
     * @param {Collected} col @param {string} stopReason @param {Record<string, unknown>} usageObj
     */
    sendMessage(col, stopReason, usageObj) {
      onFirstByte();
      if (format === "anthropic") {
        const content = [];
        if (col.nativeThought) content.push({ type: "thinking", thinking: col.nativeThought });
        content.push({ type: "text", text: col.text });
        sendJson(
          res,
          200,
          {
            id: msgId,
            type: "message",
            role: "assistant",
            model,
            content,
            stop_reason: stopReason,
            stop_sequence: null,
            usage: usageObj,
          },
          extra,
        );
      } else {
        /** @type {Record<string, unknown>} */
        const message = { role: "assistant", content: col.text };
        if (col.nativeThought) message.reasoning_content = col.nativeThought;
        sendJson(
          res,
          200,
          {
            id: msgId,
            object: "chat.completion",
            created,
            model,
            choices: [{ index: 0, message, finish_reason: stopReason }],
            usage: usageObj,
          },
          extra,
        );
      }
    },
  };
}

/** @typedef {ReturnType<typeof createAgentReply>} AgentReply */
