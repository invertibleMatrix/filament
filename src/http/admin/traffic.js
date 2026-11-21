// @ts-check
// The admin API's traffic area: the records feed, the operation log, usage rollups,
// replay/cancel, and the health board's reset.
import { sendJson } from "../../app/pipeline/respond.js";
import { parseModelSuffix } from "../../core/shaping.js";
import { findRoute, findUpstream } from "../../core/routing.js";
import { isAgentUpstream } from "../../core/schema.js";
import { createSseFold, droppedLines } from "../../core/wire/sse.js";
import { OP_KIND_KEYS, WIRED_OP_KINDS } from "../../services/oplog.js";
import { localDay } from "../../services/records.js";
import { houseAuth } from "../../services/house.js";
import { loopbackPost } from "../../services/loopback.js";
import { selfAddress } from "../../services/config/store.js";
import { compositionReport } from "../../app/sessions/composition.js";
import { usageBreakdown } from "../../app/usage-breakdown.js";

// Whose calls a dashboard query wants: `client` (the default — your tools), `memory` (Filament's own model calls) or
// `all` (one feed). Every usage endpoint defaults to `client` so nothing that meant "your traffic" — the Usage page,
// the Home charts, the budget alert, the assistant's get_usage — silently changes meaning; the Traffic tabs ask for
// `all` explicitly. Anything unrecognised falls back to `client` rather than widening the view by accident.
function scopeParam(searchParams) {
  const s = String(searchParams?.get?.("scope") || "").trim();
  return s === "all" || s === "memory" ? s : "client";
}

/** Whether a span's days read as days (`2026-09-13`); one left out is no end. @param {{ from: string | null, to: string | null }} span */
const daysRead = (span) => [span.from, span.to].every((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v));
const DAYS_UNREAD = "from/to must look like 2026-09-13";

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function trafficRoutes(a) {
  const { config, usage, ops, memory, health, liveAborts, log = () => {} } = a;
  /** Where Filament listens now, its replays' door (a port saved since waits for a restart). */
  const selfBase = a.selfBase || (() => selfAddress(config.get().server));
  const usageDays = async (r) => {
    const { url, path, res } = r;
    const q = url.searchParams;
    const span = { from: q.get("from") || null, to: q.get("to") || null };
    if (!daysRead(span)) return sendJson(res, 400, { error: DAYS_UNREAD });
    if (path.endsWith(".csv")) {
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="filament-usage${span.from ? "-" + span.from : ""}${span.to ? "-to-" + span.to : ""}.csv"`,
      });
      return res.end(usage.dailyStore.csv(span));
    }
    return sendJson(res, 200, {
      today: localDay(),
      days: usage.dailyStore.list({ ...span, limit: Number(q.get("limit")) || 0 }),
      total: usage.dailyStore.aggregate(span),
      file: usage.dailyStore.persist ? usage.dailyStore.path : null,
    });
  };
  return [
    // The Traffic feed. `scope` decides whose calls are listed — `client` (default, your tools), `memory`
    // (Filament's own), or `all` (one feed, which is what the dashboard's All tab asks for). `source` and `purpose`
    // narrow within it. Filtering happens over the whole ring and only then is cut to `limit`, so a filtered page is
    // a page long rather than the newest N narrowed to two rows.
    [
      "GET",
      "/requests",
      (r) => {
        const { url, res } = r;
        const q = url.searchParams;
        const want = Number(q.get("limit")) || 100;
        const source = (q.get("source") || "").trim();
        const purpose = (q.get("purpose") || "").trim();
        // A `source`/`purpose` filter widens the scope unless the caller stated one. `purpose` only exists on memory's
        // own calls, and `source=memory` inside the default client scope would silently return zero rows — which reads as
        // "there were no memory calls" rather than "you asked for two contradictory things". An explicit scope wins.
        const scope = q.get("scope") ? scopeParam(q) : source || purpose ? "all" : scopeParam(q);
        const filtering = !!(source || purpose);
        let list = usage.list(filtering ? 1e9 : want, { scope });
        if (source) list = list.filter((x) => x.source === source);
        if (purpose) list = list.filter((x) => String(x.memoryFor?.purpose || "") === purpose);
        // `matched` counts rows after the source/purpose filters but BEFORE the `limit` cut, so a caller can tell
        // "nothing matched" from "more matched than you asked for". Unfiltered, it equals the number returned.
        return sendJson(res, 200, {
          requests: list.slice(0, want),
          scope,
          source: source || undefined,
          purpose: purpose || undefined,
          matched: list.length,
        });
      },
    ],
    // The operation log: everything Filament did that was not a model call. `kinds` is a comma-separated list; omit it
    // for the configured default view (the significant kinds), or pass `kinds=all` for literally everything including
    // the firehose kinds. `counts` comes back unfiltered by kind so a chip can say "health (4)" even while hidden.
    [
      "GET",
      "/ops",
      (r) => {
        const { url, res } = r;
        const q = url.searchParams;
        const raw = (q.get("kinds") || "").trim();
        // An explicit list that names no real kind falls back to the configured default rather than returning nothing:
        // an empty table reads as "Filament did nothing", which is the exact misreading this log exists to prevent.
        const parsed = raw
          .split(",")
          .map((k) => k.trim())
          .filter((k) => OP_KIND_KEYS.includes(k));
        const kinds = !raw ? ops.shownKinds : raw === "all" ? null : parsed.length ? parsed : ops.shownKinds;
        const since = Number(q.get("since")) || 0;
        return sendJson(res, 200, {
          ops: ops.list({
            kinds,
            since,
            limit: Math.min(1000, Math.max(1, Number(q.get("limit")) || 200)),
            q: q.get("q") || "",
            before: q.get("before") || null,
          }),
          counts: ops.counts({ since }),
          shownKinds: ops.shownKinds,
          enabled: ops.enabled,
          inMemory: ops.ops.length,
          // `kinds` is what was actually applied (null internally means "everything"), echoed back so the UI can label
          // the view it is looking at instead of guessing from the config; `counts` always covers every kind, so a chip
          // can show a count for a kind that is currently switched off.
          kinds: kinds || OP_KIND_KEYS,
          countsAllKinds: kinds === null,
          // Which kinds actually have a producer. The UI greys the others out and says so, rather than showing a chip
          // that can never fill — an audit trail advertising coverage it does not have is worse than one that admits gaps.
          wired: WIRED_OP_KINDS,
        });
      },
    ],
    // Replay: send a stored request's exact inbound body to another model, memory off, as a fresh record linked to
    // the original. Coding agents are refused: replaying one would run the agent for real.
    [
      "POST",
      "/requests/:id/replay",
      async (r) => {
        const { res, json, params } = r;
        const reqId = decodeURIComponent(params.id);
        const b = (await json()) || {};
        const model = String(b.model || "").trim();
        if (!model) return sendJson(res, 400, { error: "model is required" });
        const d = usage.detail(reqId);
        if (!d) return sendJson(res, 404, { error: "no such request" });
        if (!d.inboundBody)
          return sendJson(res, 409, {
            error:
              "this request's body was not stored in full; set observability.storeBodies = full in Settings to make requests replayable",
          });
        let origBody;
        try {
          origBody = typeof d.inboundBody === "string" ? JSON.parse(d.inboundBody) : d.inboundBody;
        } catch {
          return sendJson(res, 409, {
            error:
              "the stored body was truncated at capture (observability.maxStoredBodyBytes) and cannot be replayed",
          });
        }
        if (!origBody || typeof origBody !== "object" || !Array.isArray(origBody.messages))
          return sendJson(res, 409, { error: "the stored body has no messages to replay" });
        const fmt = d.format === "openai" ? "openai" : "anthropic";
        // Resolve the route with the SAME suffix rules the proxy itself will use. Guarding on a different base than the
        // one the request is actually routed by is how a replay slips past: with effort-suffix stripping on, "x-max"
        // guards as "x-max" (an API route) but routes as "x" — which can be a coding agent, spawned for real. One
        // argument, and the two resolutions cannot disagree.
        const base = parseModelSuffix(model, config.get().rules).base;
        const route = findRoute(config.get(), base) || findRoute(config.get(), model);
        if (!route) return sendJson(res, 400, { error: `no route matches "${model}"` });
        // Any candidate on the route, primary or fallback, may be an agent — a failover mid-replay would run it for real.
        const agentCandidate = [route.upstream, ...(route.fallbacks || []).map((f) => f.upstream)].find(
          (id) => isAgentUpstream(findUpstream(config.get(), id)),
        );
        if (agentCandidate)
          return sendJson(res, 400, {
            error: `this route can reach the coding agent "${agentCandidate}" (primary or fallback); replaying it would run the agent for real. Pick an API-only model.`,
          });
        // Replayed as a STREAMING request even when the original was not: a non-streaming call only has a first-byte
        // time once the whole reply has arrived, so its "TTFT" is really its total. Streaming is the only way to get a
        // number that means what the comparison says it means. The body is otherwise untouched, and the difference is
        // reported (`streamed` on both sides) rather than hidden.
        const replayBody = { ...origBody, model, stream: true };
        const endpoint = fmt === "openai" ? "/v1/chat/completions" : "/v1/messages";
        const textOf = (j) =>
          fmt === "anthropic"
            ? (j?.content || [])
                .filter((x) => x?.type === "text")
                .map((x) => x.text)
                .join("")
            : typeof j?.choices?.[0]?.message?.content === "string"
              ? j.choices[0].message.content
              : "";
        const t0 = Date.now();
        // The replay has no clock (HarnessV3-FailurePoints §4 A): the page that asked hanging up ends it.
        const hangUp = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) hangUp.abort();
        });
        try {
          const r2 = await loopbackPost(`${selfBase()}${endpoint}`, {
            headers: {
              "content-type": "application/json",
              ...(fmt === "anthropic" ? { "anthropic-version": "2023-06-01" } : {}),
              ...houseAuth(),
              "x-filament-memory": "off",
              "x-filament-replay-of": d.id,
              "x-session-id": `replay-${d.id}`,
            },
            body: JSON.stringify(replayBody),
            signal: hangUp.signal,
          });
          // First byte measured here, on the replay's own response — the same thing the record measures upstream.
          let j = null,
            ttft = null,
            streamed = false;
          const ct = String(r2.headers.get("content-type") || "");
          if (ct.includes("text/event-stream") && r2.body) {
            streamed = true;
            // Folded as it comes, its text never kept (core/wire/sse.js `createSseFold`): a reply with a line past what
            // Filament reads of one is the error that says so, said once in the log.
            const said = droppedLines(log, `replay of ${d.id}`, "it was dropped unread, and the reply with it: the replay fails in those words");
            const fold = createSseFold(fmt, { onOver: said.onOver, whole: true });
            const reader = r2.body.getReader();
            const dec = new TextDecoder();
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (ttft == null) ttft = Date.now() - t0;
                fold.feed(dec.decode(value, { stream: true }));
              }
            } finally {
              await reader.cancel().catch(() => {});
            } // the 180 s abort rejects a pending read; release the socket either way
            if (ttft == null) ttft = Date.now();
            fold.feed(dec.decode());
            fold.end();
            j = fold.reply();
          } else {
            j = await r2.json().catch(() => null);
            ttft = Date.now() - t0; // not a stream: this is the whole reply, and `streamed` says so
          }
          const text = textOf(j);
          // A stream that parses but carries nothing (truncated after message_start, garbage deltas) used to report a
          // green "replayed" with an empty reply. That is a lie in the UI, so it is reported as a failure instead.
          const blocks = fmt === "anthropic" ? j?.content || [] : j?.choices || [];
          const streamErr = !!(j?.error || j?.type === "error");
          const contentless = r2.ok && !streamErr && !text && !blocks.length;
          const ok = r2.ok && !streamErr && !contentless;
          const errMsg =
            !r2.ok || streamErr
              ? j?.error?.message || `HTTP ${r2.status}`
              : contentless
                ? "the upstream answered but its stream carried no content — it may have been truncated or malformed"
                : null;
          const repId = r2.headers.get("x-filament-request-id");
          const rep = repId ? usage.byId.get(repId) : null;
          // `ttftReal` is the honesty flag: whether this side's first-byte time is a genuine first byte, or the moment
          // a whole buffered reply happened to be ready. Keyed on what actually happened (a buffered upstream answer,
          // a locally synthesized reply) rather than on what the client asked for — an upstream
          // that answers JSON to a streamed request would otherwise report a fake TTFT as a real one.
          const side = (rec, fallbackModel) =>
            rec
              ? {
                  id: rec.id,
                  model: rec.model || fallbackModel,
                  upstream: rec.upstream || null,
                  upstreamModel: rec.upstreamModel || null,
                  status: rec.status,
                  error: rec.error || null,
                  ttftMs: rec.ttftMs ?? null,
                  totalMs: rec.totalMs ?? null,
                  tps: rec.tps ?? null,
                  tokens: rec.tokens || null,
                  cost: typeof rec.cost === "number" ? rec.cost : null,
                  streamed: rec.stream === true,
                  ttftReal: rec.ttftMs != null && !rec.ttftBuffered && !rec.local,
                  estimatedTokens: !!rec.estimatedTokens,
                  ts: rec.ts,
                }
              : null;
          // The provider's own usage shape, mapped to the record shape the UI reads (`input`/`output`), so a replay
          // whose record could not be found still shows its tokens instead of a misleading dash.
          const rawUsage = j?.usage || null;
          const mappedUsage = rawUsage
            ? {
                input: rawUsage.input_tokens ?? rawUsage.prompt_tokens ?? null,
                output: rawUsage.output_tokens ?? rawUsage.completion_tokens ?? null,
                cacheRead: rawUsage.cache_read_input_tokens ?? null,
                cacheWrite: rawUsage.cache_creation_input_tokens ?? null,
              }
            : null;
          // A contentless stream is a failed replay even though the HTTP leg succeeded, so the comparison side must not
          // show a green "ok" next to a red pill: the user reads the two together.
          const replaySide = side(rep, model) || {
            id: null,
            model,
            upstream: null,
            status: ok ? "ok" : "error",
            error: errMsg,
            ttftMs: ttft,
            totalMs: Date.now() - t0,
            tps: null,
            tokens: mappedUsage,
            cost: null,
            streamed,
            ttftReal: streamed,
            estimatedTokens: false,
            ts: new Date().toISOString(),
          };
          return sendJson(res, 200, {
            ok,
            status: r2.status,
            model,
            ms: Date.now() - t0,
            reply: text || null,
            usage: rawUsage,
            error: errMsg,
            record: rep
              ? {
                  id: rep.id,
                  cost: rep.cost,
                  tokens: rep.tokens,
                  totalMs: rep.totalMs,
                  ttftMs: rep.ttftMs,
                  tps: rep.tps,
                  upstream: rep.upstream,
                }
              : null,
            compare: {
              original: side(d, d.model),
              replay: !ok ? { ...replaySide, status: "error", error: errMsg } : replaySide,
            },
          });
        } catch (/** @type {any} */ e) {
          return sendJson(res, 502, { error: `replay failed: ${e.message}` });
        }
      },
    ],
    // The replays of one request, newest first: the Traffic table groups them under their original, and the drawer
    // lists earlier comparisons without re-running anything.
    [
      "GET",
      "/requests/:id/replays",
      (r) => {
        const { res, params } = r;
        const reqId = decodeURIComponent(params.id);
        if (!usage.byId.get(reqId)) return sendJson(res, 404, { error: "no such request" });
        const rows = usage.records
          .filter((x) => x.replayOf === reqId)
          .slice(-50)
          .reverse()
          .map((x) => usage.publicRecord(x));
        return sendJson(res, 200, { original: reqId, count: rows.length, replays: rows });
      },
    ],
    [
      "POST",
      "/requests/:id/cancel",
      (r) => {
        const { res, params } = r;
        const id = decodeURIComponent(params.id);
        const c = liveAborts.get(id);
        if (!c)
          return sendJson(res, 404, {
            error:
              id === usage.byId.get(id)?.id ? "that request already finished" : "no such in-flight request",
          });
        c.abort();
        return sendJson(res, 200, { ok: true });
      },
    ],
    [
      // "Explain this request" (HarnessV2 §10.5): how the outbound body was composed, read off the record; the archive
      // names the session's kind.
      "GET",
      "/requests/:id/composition",
      (r) => {
        const d = usage.detail(r.params.id);
        if (!d) return sendJson(r.res, 404, { error: "not found" });
        const archive = memory?.archive || null;
        let chainKind = null;
        try {
          chainKind = d.memory?.chain && archive?.getChain ? archive.getChain(d.memory.chain)?.kind || null : null;
        } catch {}
        return sendJson(r.res, 200, compositionReport(d, { chainKind }));
      },
    ],
    [
      "GET",
      "/requests/:id*",
      (r) => {
        const d = usage.detail(r.params.id);
        return d ? sendJson(r.res, 200, d) : sendJson(r.res, 404, { error: "not found" });
      },
    ],
    [
      "GET",
      "/usage/summary",
      (r) =>
        sendJson(
          r.res,
          200,
          usage.summary((Number(r.url.searchParams.get("hours")) || 24) * 3600 * 1000, {
            scope: scopeParam(r.url.searchParams),
            // By project in words (LD-D8): memory's archive names each folder, so the page shows `shop-api`, not its id.
            projectNamed: (id) => memory?.projectNamed?.(id) ?? null,
          }),
        ),
    ],
    [
      "GET",
      "/usage/daily",
      (r) =>
        sendJson(r.res, 200, {
          days: usage.daily(Math.min(31, Number(r.url.searchParams.get("days")) || 7), {
            scope: scopeParam(r.url.searchParams),
          }),
        }),
    ],
    // Durable per-day history (daily-usage.json): every day on record, newest first, plus one combined bucket for the span.
    ["GET", "/usage/days", usageDays],
    ["GET", "/usage/days.csv", usageDays],
    // The same days as Settings › Usage stats reads them (app/usage-breakdown.js): the last `days` up to today, or
    // `from`/`to`; neither is every day on record. Worked out as it is read, nothing of it kept.
    [
      "GET",
      "/usage/breakdown",
      (r) => {
        const q = r.url.searchParams;
        const span = { from: q.get("from") || null, to: q.get("to") || null };
        if (!daysRead(span)) return sendJson(r.res, 400, { error: DAYS_UNREAD });
        return sendJson(r.res, 200, usageBreakdown({ usage, config, memory }, { ...span, days: Number(q.get("days")) || 0 }));
      },
    ],
    [
      "GET",
      "/usage/timeline",
      (r) =>
        sendJson(r.res, 200, {
          minutes: Number(r.url.searchParams.get("minutes")) || 60,
          scope: scopeParam(r.url.searchParams),
          buckets: usage.timeline(Number(r.url.searchParams.get("minutes")) || 60, {
            scope: scopeParam(r.url.searchParams),
          }),
        }),
    ],
    [
      "GET",
      "/usage/upstreams",
      (r) =>
        sendJson(r.res, 200, {
          since: (Number(r.url.searchParams.get("hours")) || 24) + "h",
          upstreams: usage.upstreamStats((Number(r.url.searchParams.get("hours")) || 24) * 3600 * 1000, {
            scope: scopeParam(r.url.searchParams),
          }),
          health: health.snapshot(),
          scope: scopeParam(r.url.searchParams),
        }),
    ],
    [
      "POST",
      "/health/:id*/reset",
      (r) => {
        const id = decodeURIComponent(r.params.id);
        health.reset(id);
        return sendJson(r.res, 200, { ok: true });
      },
    ],
  ];
}
