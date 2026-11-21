// @ts-check
// The OpenAI Responses front door. The request becomes a Chat Completions request for the normal pipeline (routing,
// rules, translation, agents), and the reply is turned back into a Responses object or event stream on the way out.
// The previous_response_id store lives here: conversations a Responses client may continue (in memory, one hour).
import { sendJson } from "../app/pipeline/respond.js";
import { errorBody } from "../core/wire/errors.js";
import {
  responsesToChat,
  chatToResponse,
  createChatToResponsesStream,
  newResponseId,
} from "../core/wire/responses.js";
import { ResponseStore } from "../services/response-store.js";
import { modelsLentTo } from "../services/devices.js";
import { checkInboundAuth, readBody } from "./guards.js";

/**
 * @param {object} front
 * @param {any} front.config  the ConfigStore
 * @param {any} front.pipeline  the model-request pipeline (app/pipeline/run.js)
 */
export function createResponsesFrontDoor({ config, pipeline }) {
  const responseStore = new ResponseStore();

  async function handleResponsesRequest(req, res) {
    if (!checkInboundAuth(req, config.get().server))
      return sendJson(res, 401, errorBody("openai", 401, "invalid or missing API key (Filament inbound key)"));
    let raw, body;
    try {
      raw = await readBody(req, config.get().server.maxBodyBytes);
      body = JSON.parse(raw);
    } catch (/** @type {any} */ e) {
      return sendJson(
        res,
        e.status || 400,
        errorBody("openai", e.status || 400, e.status ? e.message : "invalid JSON body"),
      );
    }
    if (!body || typeof body !== "object" || typeof body.model !== "string")
      return sendJson(res, 400, errorBody("openai", 400, "body.model is required"));
    // Another machine's chat's call (services/devices.js `modelsLentTo`, the remote-agents plan's m-door) is kept
    // nowhere here: it continues no response this machine keeps — another client's among them —, and none of its is kept.
    const lent = !!modelsLentTo(req);
    if (lent && body.previous_response_id)
      return sendJson(res, 400, errorBody("openai", 400, "another machine's chat continues no response here, and none of its is kept: send the whole input"));
    /** @type {any[]} */
    let prior = [];
    if (body.previous_response_id) {
      const prev = responseStore.get(body.previous_response_id);
      if (!prev)
        return sendJson(res, 404, {
          error: {
            message: `previous response ${body.previous_response_id} is not known to Filament (responses are kept in memory for an hour and not across restarts; send the full input instead)`,
            type: "invalid_request_error",
            param: "previous_response_id",
            code: "previous_response_not_found",
          },
        });
      prior = prev.items;
    }
    let conv;
    try {
      conv = responsesToChat(body, { prior });
    } catch (/** @type {any} */ e) {
      return sendJson(res, e.status || 400, {
        error: {
          message: e.message,
          type: "invalid_request_error",
          param: e.param || null,
          code: e.code || null,
        },
      });
    }
    const id = newResponseId(),
      created = Math.floor(Date.now() / 1000);
    const notes = [
      `client: OpenAI Responses API (${conv.items.length} input item(s)${prior.length ? ` + ${prior.length} from previous_response_id` : ""})`,
      ...conv.notes,
    ];
    // Stored under the id the client saw: Filament's own, or the server's when the reply passed straight through.
    const remember = (resp) => {
      if (body.store === false || lent) return;
      responseStore.put(resp?.id || id, {
        items: [...prior, ...conv.items, ...(resp.output || [])],
        model: resp.model,
      });
    };
    const proxy = responsesProxy(res, { body, id, created, onDone: remember });
    return pipeline.handle(req, proxy, "openai", {
      raw: JSON.stringify(conv.chat),
      body: conv.chat,
      notes,
      api: "responses",
      // Theirs is stored at this machine's provider no more than here (`store` is true unless a client says otherwise).
      responsesBody: prior.length ? { ...body, input: conv.input, previous_response_id: undefined } : lent ? { ...body, store: false } : body,
      responsesSources: conv.sources,
    });
  }

  // A response object that looks like the client's socket to the pipeline but rewrites what passes through: Chat
  // Completions SSE becomes Responses events, a Chat Completions JSON reply becomes a Responses object, errors pass.
  function responsesProxy(real, { body, id, created, onDone }) {
    let mode = null,
      status = 200,
      headers = {},
      buf = "",
      tr = null,
      raw = false;
    const dec = new TextDecoder("utf-8");
    const keep = (h) => {
      const out = {};
      for (const [k, v] of Object.entries(h || {}))
        if (/^x-filament-/i.test(k) || /^(cache-control|connection|x-accel-buffering)$/i.test(k)) out[k] = v;
      return out;
    };
    const str = (chunk) => (typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true }));
    const over = {
      // Passthrough: the upstream answers in the Responses shape already, so nothing is rewritten on the way out.
      rawMode(on) {
        raw = !!on;
      },
      noteResponse(resp) {
        if (resp && resp.object === "response") onDone?.(resp);
      },
      writeHead(st, h) {
        if (raw) {
          mode = "pass";
          real.writeHead(st, h);
          return over;
        }
        status = st;
        headers = h || {};
        const ct = String(headers["content-type"] || headers["Content-Type"] || "");
        if (st >= 400) {
          mode = "pass";
          real.writeHead(st, headers);
        } else if (ct.includes("text/event-stream")) {
          mode = "stream";
          tr = createChatToResponsesStream(body, { id, created });
          real.writeHead(st, { ...keep(headers), "content-type": "text/event-stream; charset=utf-8" });
        } else mode = "json";
        return over;
      },
      flushHeaders() {
        if (mode === "stream" || mode === "pass" || raw) real.flushHeaders?.();
      },
      // What the client's socket answered, as a write does: false when it is full, so the pipeline waits for its drain
      // (it listens on the socket itself) before reading the provider on — said true always, a slow reader's reply was
      // buffered here whole.
      write(chunk) {
        if (mode === "pass" || raw) return real.write(chunk);
        if (mode === "stream") {
          const s = str(chunk);
          if (s.startsWith(":")) return real.write(s);
          const o = tr.push(s);
          return o ? real.write(o) : true;
        }
        buf += str(chunk);
        return true;
      },
      end(chunk) {
        if (chunk != null) over.write(chunk);
        if (mode === "pass" || raw) return real.end();
        if (mode === "stream") {
          const o = tr.end();
          if (o) real.write(o);
          if (tr.state.status !== "failed") onDone?.(tr.resp);
          return real.end();
        }
        let j = null;
        try {
          j = JSON.parse(buf);
        } catch {}
        if (!j || !j.choices) {
          real.writeHead(status || 500, {
            "content-type": "application/json; charset=utf-8",
            ...keep(headers),
          });
          return real.end(buf);
        }
        const resp = chatToResponse(j, body, { id, created });
        onDone?.(resp);
        const text = JSON.stringify(resp);
        real.writeHead(status, {
          ...keep(headers),
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(text),
        });
        return real.end(text);
      },
      get headersSent() {
        return mode === "json" && !raw ? false : real.headersSent;
      },
    };
    return new Proxy(real, {
      get(target, k) {
        if (k in over) return over[k];
        const v = target[k];
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  }

  return { handle: handleResponsesRequest };
}
