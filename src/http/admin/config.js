// @ts-check
// The admin API's config area: the schema and templates, reading and saving the configuration, the fields the
// harness's pages write one by one, the inbound keys, the dry-run route tester, the failover switch, the 9router
// import, and the dashboard assistant's session and apply endpoints.
import { sendJson } from "../../app/pipeline/respond.js";
import { schemaAsJson, isAgentUpstream } from "../../core/schema.js";
import { aggregateModels } from "../../core/routing.js";
import {
  normalizeConfig,
  validateConfig,
  redactConfig,
  mergeSecrets,
  secretsNow,
  configView,
  forgottenIn,
  generateKey,
} from "../../services/config/store.js";
import { getTemplate, applyTemplate, templateOffWhy, templatesFor } from "../../services/config/templates.js";
import { read9routerConnections, applyImport } from "../../services/config/import-9router.js";
import { describeDiff } from "../../services/config/diff.js";
import { changeLines, changesAnswer, staleAnswer } from "../../app/config-change.js";
import { changeFields } from "../../app/config-fields.js";
import { pressRefused } from "../guards.js";
import { configAsksLess } from "../../services/session-settings.js";

// Flattened to strings on purpose: the op log bounds every detail value, and an array of objects would be stored
// as "[obj]" placeholders — an audit trail that says something changed without saying what. ONE helper shared by
// the save, template-apply and assistant-apply paths, and by a stale draft's refusal, so they never drift apart.
const configChangesForOp = (diff) => changeLines(diff);

/**
 * The inbound keys are read and made on this computer alone (the owner's remote Filament of 11-06): a paired device's
 * turns need none (guards.js `markSessionTurn`), and one that read them would hold this machine's model endpoints for
 * good, past its revoking. The admin token is refused them too — it reaches this machine from elsewhere.
 * @param {any} r
 */
const keysStayHere = (r) => sendJson(r.res, 403, { error: "the inbound keys stay on the machine they belong to: read or make them in Filament there" });

/** What a save that would set the inbound keys or the admin token from another machine is answered (`plantsKeys`). */
export const KEYS_SET_HERE = "the inbound keys and the admin token are set on the machine they belong to: change them in Filament there";
/**
 * A provider's key set anew by a whole configuration's save — the console's Destinations — is this computer's own: where
 * a key copied here came from (`keyFrom`, app/providers.js) goes with the key it named. @param {any} next @param {any} now
 */
const keyFromLetGo = (next, now) => {
  for (const u of next?.upstreams || []) {
    const was = (now?.upstreams || []).find((/** @type {any} */ x) => x.id === u.id);
    if (u.keyFrom && was && was.apiKey !== u.apiKey) u.keyFrom = "";
  }
};
/** Whether a configuration changes what lets a caller in for good: the inbound keys, the admin token. @param {any} next @param {any} now */
const keysChange = (next, now) =>
  JSON.stringify(next?.server?.inboundKeys ?? []) !== JSON.stringify(now?.server?.inboundKeys ?? []) || String(next?.server?.adminToken ?? "") !== String(now?.server?.adminToken ?? "");
/**
 * Whether a configuration about to be saved changes what lets a caller in for good — the inbound keys, the admin token
 * — for a caller not on this computer: refused, as /keys are, for one set from elsewhere would let its setter in past
 * its revoking (the hunt of p1-keys: a full device's PUT /config planted a key of its own). A save that leaves them as
 * they are is saved.
 * @param {any} r  the request, its caller (`who`) @param {any} next @param {any} now
 */
export const plantsKeys = (r, next, now) => r.who?.kind !== "local" && keysChange(next, now);

/**
 * Why a configuration about to be saved is refused its caller, or null: one that lets the agent do more unasked —
 * every chat's mode, your defaults' mode or rules, a folder added to where agents work (session-settings.js
 * `configAsksLess`) — is a press, and this computer's caller without the desktop app's key presses nothing (guards.js
 * `pressRefused`; the swarm's review of 11-10). So is one that changes the inbound keys or the admin token
 * (`keysChange`): the keys are read and made by a press (press.js), and a key set here by its caller is one it holds.
 * @param {any} r  the request @param {any} next @param {any} now
 */
export const pressNeeded = (r, next, now) => {
  const no = pressRefused(r.req);
  return no && (configAsksLess(now, next) || keysChange(next, now)) ? no : null;
};

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function configRoutes(a) {
  const { config, log, ops, assistant, dryRun, cfgForModels, discover, listening = () => null } = a;
  const failover = async (r) => {
    if (r.method === "POST") {
      const body = (await r.json()) || {};
      const next = structuredClone(config.get());
      next.rules.resilience = { ...(next.rules.resilience || {}), failover: body.enabled !== false };
      config.set(next);
      config.save();
      log("info", `failover ${config.get().rules.resilience.failover ? "on" : "off"}`);
    }
    const routesWithBackups = (config.get().routes || [])
      .filter((x) => x.enabled !== false && (x.fallbacks || []).length)
      .map((x) => ({
        match: x.match,
        chain: [x.upstream, ...x.fallbacks.map((f) => f.upstream)],
        strategy: x.strategy || "in_order",
      }));
    return sendJson(r.res, 200, {
      enabled: config.get().rules.resilience?.failover === true,
      routesWithBackups,
      version: config.version(),
    });
  };
  return [
    ["GET", "/schema", (r) => sendJson(r.res, 200, schemaAsJson())],
    ["GET", "/templates", (r) => sendJson(r.res, 200, { templates: templatesFor(config.get()) })],
    [
      "PUT",
      "/config",
      async (r) => {
        const { res, json, url } = r;
        const incoming = await json();
        if (!incoming) return sendJson(res, 400, { error: "invalid JSON" });
        // A draft names the version it was read at (`?base=`, HS-D3): one read before a newer save — the harness's, a
        // sign-in's, another window's — would undo it, so it is refused with what changed since. A save that names no
        // version (a script, the CLI) is taken whatever has been saved since.
        const base = url.searchParams.get("base");
        if (base != null && Number(base) !== config.version()) return sendJson(res, 409, staleAnswer(config, Number(base)));
        // The version the draft was read at (`?read=`), where Keep mine made a newer one its base: its placeholders name
        // the secrets read with it, and each one it never changed is taken as the configuration holds it — a key rotated
        // or a sign-in's tokens since that read are never undone (the bug hunt of 10-30, SEC-8).
        const read = url.searchParams.get("read");
        const was = read == null || Number(read) === config.version() ? config.get() : config.at(Number(read));
        if (!was)
          return sendJson(res, 409, { error: "Not saved: this page's edits were read too long ago to tell which keys changed since. Discard them (or reload the page) and make them again.", version: config.version() });
        let merged;
        try {
          merged = normalizeConfig(secretsNow(mergeSecrets(incoming, was, { unreadable: config.unreadable() }), was, config.get()));
        } catch (/** @type {any} */ e) {
          if (Number.isInteger(e?.status)) return sendJson(res, e.status, { error: e.message });
          throw e;
        }
        // A secret this secret.key cannot open that the page sent back empty was removed on purpose: this save forgets it,
        // where a field merely left empty sends its placeholder and keeps it (`forgottenIn`).
        const forget = forgottenIn(incoming, config.unreadable());
        keyFromLetGo(merged, config.get());
        const v = validateConfig(merged);
        if (!v.ok) return sendJson(res, 400, { error: "validation failed", errors: v.errors });
        if (plantsKeys(r, merged, config.get())) return sendJson(res, 403, { error: KEYS_SET_HERE });
        const unpressed = pressNeeded(r, merged, config.get());
        if (unpressed) return sendJson(res, 403, { error: unpressed, press: true });
        // A save that moves the host or port waits for a restart, unless it moves them back to where Filament listens.
        const at = listening();
        const restartNeeded =
          (merged.server.port !== config.get().server.port || merged.server.host !== config.get().server.host) &&
          (!at || merged.server.port !== at.port || merged.server.host !== at.host);
        // The audit trail that never existed: `describeDiff` was already computed for the template preview and the
        // assistant, then thrown away. It is redacted, so it is safe to persist. Computed BEFORE config.set replaces the
        // live object, or there is nothing left to compare against.
        const diff = describeDiff(config.get(), merged);
        config.set(merged);
        config.save({ forget });
        log("info", `config saved${restartNeeded ? " (host/port changed: restart Filament to apply)" : ""}`);
        const count = diff.length + forget.length;
        ops.record("config", `configuration saved (${count} change${count === 1 ? "" : "s"})`, {
          sub: "save",
          level: restartNeeded ? "warn" : "info",
          detail: { count, restartNeeded, changes: [...configChangesForOp(diff), ...forget.map((where) => `${where}: •••• (secret, unreadable) → removed`)] },
        });
        return sendJson(res, 200, { ok: true, ...configView(config), version: config.version(), restartNeeded });
      },
    ],
    // What changed since a version a page read (HS-D3): the console's bar names it.
    ["GET", "/config/changes", (r) => sendJson(r.res, 200, changesAnswer(config, Number(r.url.searchParams.get("since"))))],
    // The harness's Filament pages (HS-4): a write names the fields it changes, `{ set: { path: value }, unset: [path],
    // base }`, against the configuration as it stands.
    [
      "PATCH",
      "/config/fields",
      async (r) => {
        const b = (await r.json()) || {};
        try {
          const out = changeFields(config, { set: b.set, unset: b.unset, base: b.base == null ? null : Number(b.base) }, listening(), { refuse: (was, next) => pressNeeded(r, next, was) });
          if (out.changes.length)
            ops.record("config", `settings changed in the harness (${out.changes.length} change${out.changes.length === 1 ? "" : "s"})`, {
              sub: "fields",
              level: out.restartNeeded ? "warn" : "info",
              detail: { count: out.changes.length, restartNeeded: out.restartNeeded, changes: out.changes },
            });
          return sendJson(r.res, 200, { ok: true, ...out, version: config.version() });
        } catch (/** @type {any} */ e) {
          if (Number.isInteger(e?.status)) return sendJson(r.res, e.status, { error: e.message, ...(e.extra || {}), version: config.version() });
          throw e;
        }
      },
    ],
    [
      "POST",
      "/config/reload",
      (r) => {
        config.reload();
        ops.record("config", "configuration reloaded from disk", { sub: "reload" });
        return sendJson(r.res, 200, { ok: true, ...configView(config) });
      },
    ],
    [
      "POST",
      "/keys/rotate",
      (r) => {
        if (r.who?.kind !== "local") return keysStayHere(r);
        const key = generateKey();
        const server = config.get().server;
        const was = server.inboundKeys;
        server.inboundKeys = [key, ...(was || [])].slice(0, 5);
        try {
          config.save();
        } catch (/** @type {any} */ e) {
          // A key the configuration could not keep is no key: the keys it would have joined stay in use, the oldest included.
          server.inboundKeys = was;
          return sendJson(r.res, 500, { error: `the configuration could not be saved (${e?.message || e}), so the keys are as they were` });
        }
        ops.record("config", "a new inbound API key was generated and the old ones kept", {
          sub: "keys",
          detail: { keys: config.get().server.inboundKeys.length },
        });
        return sendJson(r.res, 200, { key });
      },
    ],
    ["GET", "/keys", (r) => (r.who?.kind !== "local" ? keysStayHere(r) : sendJson(r.res, 200, { keys: config.get().server.inboundKeys || [] }))],
    [
      "POST",
      "/templates/:id/:action",
      async (r) => {
        const { res, params } = r;
        const id = params.id,
          action = params.action;
        const t = /** @type {any} */ (getTemplate(id));
        if (!t) return sendJson(res, 404, { error: "template not found" });
        const off = templateOffWhy(config.get(), t);
        if (off) return sendJson(res, 409, { error: `${off}.` });
        let next = config.get();
        for (const dep of t.requires || []) {
          const d = getTemplate(dep);
          if (d) next = applyTemplate(next, d);
        }
        next = normalizeConfig(applyTemplate(next, t));
        const v = validateConfig(next);
        if (action !== "preview" && action !== "apply")
          return sendJson(res, 400, { error: `unknown action "${action}"; use preview or apply` });
        const changes = describeDiff(config.get(), next);
        if (action === "preview")
          return sendJson(res, 200, { ok: v.ok, errors: v.errors, config: redactConfig(next), changes });
        if (!v.ok)
          return sendJson(res, 400, { error: "template produced an invalid config", errors: v.errors });
        const unpressed = pressNeeded(r, next, config.get());
        if (unpressed) return sendJson(res, 403, { error: unpressed, press: true });
        config.set(next);
        config.save();
        log("info", `template applied: ${t.id}`);
        // A template apply rewrites the same config a hand save does and until now left no durable trace of it —
        // "who turned that on?" had no answer. The diff is computed either way (the preview needs it), so the op is free.
        ops.record(
          "config",
          `template "${t.id}" applied (${changes.length} change${changes.length === 1 ? "" : "s"})`,
          {
            sub: "template",
            detail: { template: t.id, count: changes.length, changes: configChangesForOp(changes) },
          },
        );
        return sendJson(res, 200, { ok: true, config: redactConfig(config.get()), changes });
      },
    ],
    [
      "POST",
      "/dry-run",
      async (r) => {
        const input = await r.json();
        if (!input?.body?.model) return sendJson(r.res, 400, { error: "body.model is required" });
        return sendJson(r.res, 200, dryRun(input));
      },
    ],
    ["GET", "/failover", failover],
    ["POST", "/failover", failover],
    // ---- migrate from 9router ----
    [
      "GET",
      "/migrate/9router",
      async (r) => {
        const found = await read9routerConnections();
        return sendJson(r.res, 200, {
          found: found.found,
          path: found.path,
          error: found.error,
          connections: found.connections.map((c) => ({
            provider: c.provider,
            authType: c.authType,
            name: c.name,
            email: c.email,
            active: c.active,
            updatedAt: c.updatedAt,
          })),
        });
      },
    ],
    [
      "POST",
      "/migrate/9router",
      async (r) => {
        const { res, json } = r;
        const input = await json();
        const found = await read9routerConnections();
        if (!found.found) return sendJson(res, 404, { error: `9router database not found at ${found.path}` });
        if (found.error) return sendJson(res, 500, { error: found.error });
        const { config: next, report } = applyImport(config.get(), found.connections, {
          overwrite: !!input?.overwrite,
        });
        const merged = normalizeConfig(next);
        const v = validateConfig(merged);
        if (!v.ok)
          return sendJson(res, 400, { error: "import produced an invalid config", errors: v.errors });
        config.set(merged);
        config.save();
        log("info", `9router import: ${report.map((x) => `${x.provider}:${x.action}`).join(", ")}`);
        return sendJson(res, 200, { ok: true, report, config: redactConfig(config.get()) });
      },
    ],
    // ---- dashboard assistant ----
    [
      "GET",
      "/assistant/models",
      async (r) => {
        const m = await aggregateModels(await cfgForModels(false), { discover });
        const acpIds = new Set(
          (config.get().upstreams || []).filter((u) => isAgentUpstream(u)).map((u) => u.id),
        );
        return sendJson(r.res, 200, {
          models: m.models
            .filter((x) => !acpIds.has(x.upstream) && x.source !== "effort-variant")
            .map((x) => ({ id: x.id, upstream: x.upstream })),
        });
      },
    ],
    [
      "GET",
      "/assistant/session",
      (r) => {
        const s = assistant.session(r.url.searchParams.get("id") || undefined);
        return sendJson(r.res, 200, {
          sessionId: s.id,
          model: s.model || null,
          transcript: s.transcript,
          pendingChanges: assistant.pending(s),
          valid: validateConfig(s.draft).ok,
        });
      },
    ],
    [
      "POST",
      "/assistant/chat",
      async (r) => {
        const { res, json } = r;
        const input = await json();
        if (!input?.message) return sendJson(res, 400, { error: "message is required" });
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        res.flushHeaders?.();
        const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
        const s = assistant.session(input.sessionId || undefined);
        send({ type: "session", sessionId: s.id });
        // The assistant's calls have no clock (HarnessV3-FailurePoints §4 A): the console hanging up ends them.
        const hangUp = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) hangUp.abort();
        });
        try {
          await assistant.turn({
            sessionId: s.id,
            message: String(input.message),
            model: input.model,
            onEvent: send,
            signal: hangUp.signal,
          });
        } catch (/** @type {any} */ e) {
          send({ type: "error", message: e.message });
        }
        res.end();
        return;
      },
    ],
    [
      "POST",
      "/assistant/apply",
      async (r) => {
        const { res, json } = r;
        const input = await json();
        const s = assistant.session(input?.sessionId || undefined);
        const merged = normalizeConfig(assistant.applied(s));
        const v = validateConfig(merged);
        if (!v.ok) return sendJson(res, 400, { error: "draft is invalid", errors: v.errors });
        if (plantsKeys(r, merged, config.get())) return sendJson(res, 403, { error: KEYS_SET_HERE });
        const unpressed = pressNeeded(r, merged, config.get());
        if (unpressed) return sendJson(res, 403, { error: unpressed, press: true });
        const changes = describeDiff(config.get(), merged);
        config.set(merged);
        config.save();
        log("info", `assistant applied ${changes.length} change(s)`);
        // The assistant editing the config is the most invisible write there is — a chat message that changes routing.
        // Same op shape as a hand save, different sub, so the audit trail says who drove the change.
        ops.record(
          "config",
          `the console's assistant applied ${changes.length} change${changes.length === 1 ? "" : "s"}`,
          {
            sub: "assistant",
            detail: { count: changes.length, changes: configChangesForOp(changes) },
          },
        );
        assistant.resetDraft(s.id);
        s.transcript.push({ role: "system", text: `Applied ${changes.length} change(s).`, ts: Date.now() });
        return sendJson(res, 200, { ok: true, changes, config: redactConfig(config.get()) });
      },
    ],
    [
      "POST",
      "/assistant/discard",
      async (r) => {
        const input = await r.json();
        const s = assistant.resetDraft(input?.sessionId || undefined);
        s.transcript.push({ role: "system", text: "Draft changes discarded.", ts: Date.now() });
        return sendJson(r.res, 200, { ok: true });
      },
    ],
    [
      "POST",
      "/assistant/reset",
      async (r) => {
        const input = await r.json();
        if (input?.sessionId) assistant.sessions.delete(input.sessionId);
        const s = assistant.session(undefined);
        return sendJson(r.res, 200, { sessionId: s.id });
      },
    ],
  ];
}
