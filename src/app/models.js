// @ts-check
// The model list a client sees: every route's names, in the Anthropic or the OpenAI shape.
// And the catalogue's plumbing: the discovered-model cache (lists live in models-cache.json and survive restarts;
// providers and agent CLIs are asked by the dashboard's explicit Refresh, and an HTTP provider also once after a save
// that added or changed it — never because a page was opened), the windows the coding agents named as their turns
// ended (kept beside the lists), the names memory's model can stand as, and the context window a name maps to.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { aggregateModels, findRoute, findUpstream, renderUpstreamModel, agentWindowOf } from "../core/routing.js";
import { parseModelSuffix } from "../core/shaping.js";
import { UPSTREAM_TYPES, isAgentUpstream, isMachineUpstream } from "../core/schema.js";
import { agentKey, cursorSdkHeld } from "../core/catalogues.js";
import { normalizeModelForPricing } from "../core/pricing.js";
import { seedModelCache, dumpModelCache, forgetModelCache, discoveredAt, discoveredWindows, discoveredNames, discoveredCaps } from "../adapters/providers/http.js";
import { contextWindowFor } from "../services/records.js";
import { wireDiscoveredWindows, wireDiscoveredNames, wireDiscoveredCaps, wireAgentWindows, wireAgentNames, wireOutputCeilings } from "../core/routing.js";
import { sendJson } from "./pipeline/respond.js";
import { modelsThatAnswer } from "./readiness.js";
import { MODEL_MARKS } from "./acp-turn.js";

/** @typedef {import("./deps.js").AppDeps} AppDeps */

/** A window as kept: a whole number of tokens a model could have. @param {unknown} n */
const isWindow = (n) => typeof n === "number" && Number.isInteger(n) && n >= 1000 && n <= 100_000_000;
/** An output ceiling as kept: a whole number of tokens a reply could hold. @param {unknown} n */
const isCeiling = (n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 10_000_000;
/**
 * A model's name as the windows agents named and the ceilings providers stated are kept: as prices are looked up (path,
 * case and date aside), its effort aside too — a window or a ceiling is the model's whatever effort a turn ran at, and
 * these are found by the whole key, with no prefix to fall back on. @param {string} sent
 */
const windowKey = (sent) => normalizeModelForPricing(sent).replace(/-(low|medium|high|xhigh|max)$/, "");

// Config view for model discovery: ACP upstreams get their model list from the agent, not from HTTP.
// Discovered model lists survive restarts (models-cache.json): the dashboard and /v1/models answer instantly from
// disk, and the agent CLIs are only asked when the user presses Refresh.
/**
 * @param {object} mc
 * @param {string} mc.dataDir
 * @param {any} mc.config  the ConfigStore
 * @param {(level: string, ...args: any[]) => void} mc.log
 * @param {(u: any) => any} mc.destinationFor
 * @param {(msg: { upstream: string, ok: boolean, count?: number, error?: string }) => void} [mc.onDiscovered]  a
 *   save's discovery answered, or an agent asked by Connect or a Refresh (the bus tells open pages to re-read the list)
 */
export function createModelCache({ dataDir, config, log, destinationFor, onDiscovered = () => {} }) {
  const modelsCacheFile = join(dataDir, "models-cache.json");
  const localModelCache = new Map(); // acp / qoder upstream id -> { at, names, labels?, caps?, keyed?, keyNote? }
  /** A coding agent's upstream id -> the windows it named, by model (`windowKey`). @type {Map<string, Record<string, number>>} */
  const agentWindows = new Map();
  /**
   * An upstream's id -> the output ceilings it stated as it refused a request that asked for more, by model
   * (`windowKey`): forgotten when its address, type or models path changes, as its listing is.
   * @type {Map<string, Record<string, number>>}
   */
  const outputCeilings = new Map();
  try {
    const j = JSON.parse(readFileSync(modelsCacheFile, "utf8"));
    seedModelCache(j.http);
    for (const [id, v] of Object.entries(j.local || {}))
      if (v && Array.isArray(v.names)) localModelCache.set(id, v);
    for (const [id, w] of Object.entries(j.agentWindows || {})) {
      const kept = Object.fromEntries(Object.entries(w && typeof w === "object" ? w : {}).filter(([k, n]) => k && isWindow(n)));
      if (Object.keys(kept).length) agentWindows.set(id, kept);
    }
    for (const [id, c] of Object.entries(j.outputCeilings || {})) {
      const kept = Object.fromEntries(Object.entries(c && typeof c === "object" ? c : {}).filter(([k, n]) => k && isCeiling(n)));
      if (Object.keys(kept).length) outputCeilings.set(id, kept);
    }
  } catch {}
  // The endpoint-stated windows captured at discovery serve every window question (the context stamp, the compactor, the meter)
  // through routing's injected lookup — one wiring point, so the tier order lives in pricing alone.
  wireDiscoveredWindows(discoveredWindows);
  wireDiscoveredNames(discoveredNames);
  // What the listings stated beyond windows (Anthropic's reasoning levels and thinking, output ceilings; a coding
  // agent's, the thinking levels its session offered for its model — `agentCaps`): the model capabilities resolver
  // reads them between the operator's row and the rules.
  wireDiscoveredCaps((id) => discoveredCaps(id) || agentCaps(id));
  // The windows the coding agents named (the account-switch fix, D1–D2): every window question asks them below the
  // operator's row, through routing's injected lookup.
  wireAgentWindows(agentWindow);
  // What each coding agent listed itself: the name that runs a model in 1M asks it (routing's `oneMToAdd`).
  wireAgentNames((id) => (localModelCache.has(id) ? ownNames(id) : null));
  // The output ceilings providers stated in their refusals: every output question asks them with the listings' claims.
  wireOutputCeilings((upstreamId, sent) => outputCeilings.get(upstreamId)?.[windowKey(sent)] ?? null);
  /** @type {NodeJS.Timeout | null} */
  let cacheSaveTimer = null;
  let closed = false;
  const saveModelCache = () => {
    try {
      writeFileSync(
        modelsCacheFile,
        JSON.stringify({ http: dumpModelCache(), local: Object.fromEntries(localModelCache), agentWindows: Object.fromEntries(agentWindows), outputCeilings: Object.fromEntries(outputCeilings) }),
      );
    } catch (/** @type {any} */ e) {
      log("warn", `could not save models-cache.json: ${e.message}`);
    }
  };
  function persistModelCache() {
    if (closed) return; // the server stopped: a discovery that answers late saves nothing
    clearTimeout(cacheSaveTimer ?? undefined);
    cacheSaveTimer = setTimeout(() => {
      cacheSaveTimer = null;
      saveModelCache();
    }, 500);
    cacheSaveTimer.unref?.();
  }
  // The context window recorded for a model name (0 when none is known): the slice pass sizes its slices from the
  // writer's window, and the context stamp reads the same tables.
  /** @param {string} name */
  function windowForModel(name) {
    const n = String(name || "").trim();
    if (!n) return 0;
    const r = findRoute(config.get(), parseModelSuffix(n).base) || findRoute(config.get(), n);
    const up = r ? findUpstream(config.get(), r.upstream) : null;
    const sent = r
      ? renderUpstreamModel(r.upstreamModel, parseModelSuffix(n).base, r.captures || []) || n
      : n;
    return contextWindowFor(sent, up?.pricing, up ? discoveredWindows(up.id) : null, agentWindowOf(up, sent));
  }
  /** @param {boolean} force  the dashboard's Refresh; every other caller passes false and is served from disk */
  async function cfgForModels(force) {
    const upstreams = [];
    for (const u of config.get().upstreams || []) {
      // Cursor's SDK held off by its Experimental switch is asked nothing (catalogues.js `cursorSdkHeld`).
      if (u.enabled === false || cursorSdkHeld(config.get(), u) || !(UPSTREAM_TYPES[u.type]?.local || UPSTREAM_TYPES[u.type]?.builtin)) {
        upstreams.push(u);
        continue;
      }
      let names = [];
      // Same rule as the HTTP providers: the agent CLIs are asked by an explicit Refresh only, never because a picker
      // was opened. Asking spawned CLIs here was the other half of the four-second cold start (F16).
      if (u.discoverModels !== false) names = force ? await askAndSay(u) : localModelCache.get(u.id)?.names || [];
      upstreams.push({ ...u, discoverModels: false, models: [...new Set([...(u.models || []), ...names])] });
    }
    return { ...config.get(), upstreams };
  }
  /**
   * An agent CLI (or Qoder) asked for its list now: what it says becomes its list, with its own words for its models
   * where it gave them (HarnessV3-ACP AF2). One that could not answer says why until an ask it answers (HarnessV3-ACP
   * AC2's drive: Codex stopping at its start read as an agent with no models); the list it gave before stays, and one
   * it never gave is not saved as an empty answer.
   * @param {any} u @returns {Promise<string[]>}  its names now
   */
  async function askLocal(u) {
    const cached = localModelCache.get(u.id);
    /** @type {{ names?: string[], labels?: Record<string, import("../core/ports.js").ModelLabel>, caps?: Record<string, { efforts?: string[] }>, error?: string, keyed?: string[], keyNote?: string }} */
    const r = await destinationFor(u)
      .listModels({ force: true })
      .catch((/** @type {any} */ e) => ({ error: e?.message || String(e) }));
    if (r.error) {
      discovery.set(u.id, { asking: false, error: String(r.error), at: Date.now() });
      log("warn", `models: ${u.id} did not list its models: ${r.error}`);
      return cached?.names || [];
    }
    discovery.delete(u.id);
    const names = r.names || [];
    if (!names.length && cached) return cached.names; // keep the old list if the agent answered with none
    const labels = r.labels && Object.keys(r.labels).length ? r.labels : null;
    const caps = r.caps && Object.keys(r.caps).length ? r.caps : null;
    // A Claude Code account on an API key (acp/bridge.js `#keyOffers`): which of its names its key offers beyond the
    // agent's own list, and why those could not be asked for, kept with the list.
    const keyed = Array.isArray(r.keyed) && r.keyed.length ? { keyed: r.keyed } : {};
    localModelCache.set(u.id, { at: Date.now(), names, ...(labels ? { labels } : {}), ...(caps ? { caps } : {}), ...keyed, ...(r.keyNote ? { keyNote: String(r.keyNote) } : {}) });
    persistModelCache();
    return names;
  }
  /**
   * What an agent's own listing said its models take beyond their names — the thinking levels its session offered for
   * the model it opened on (acp/bridge.js `listModels`) — by the id it lists each under; null where it said none.
   * @param {string} id @returns {Record<string, import("../core/routing.js").DiscoveredCaps> | null}
   */
  function agentCaps(id) {
    const c = localModelCache.get(String(id || ""))?.caps;
    return c && typeof c === "object" && Object.keys(c).length ? c : null;
  }
  /**
   * An agent CLI (or Qoder) asked for its models now: asking while it answers, then its list or why not, which every
   * open page hears as a discovery's — the page that asked, and any other: a harness page's picker, whose limit card
   * moves a chat onto another account's same model. Its names now.
   * @param {any} u @returns {Promise<string[]>}
   */
  async function askAndSay(u) {
    discovery.set(u.id, { asking: true });
    const names = await askLocal(u);
    const error = discovery.get(u.id)?.error;
    onDiscovered(error ? { upstream: u.id, ok: false, error } : { upstream: u.id, ok: true, count: names.length });
    return names;
  }
  /**
   * One coding agent's models asked for now (HarnessV3-ACP AC3-8: Connect, and a card's Refresh in Settings → Coding
   * agents). @param {string} id
   */
  async function askAgent(id) {
    const u = savedUpstream(id);
    if (!u || u.enabled === false || cursorSdkHeld(config.get(), u)) return;
    await askAndSay(u);
  }
  /** An agent's list as kept: how many names, and when it answered; null before it ever did. @param {string} id */
  function listed(id) {
    const v = localModelCache.get(String(id || ""));
    return v ? { count: v.names.length, at: v.at } : null;
  }
  /**
   * The names an upstream itself listed when it was last asked — an agent's or Qoder's own list, an API provider's
   * listing — without the ones typed on its card, or that its account's API key offers beyond its list (`keyedFor`);
   * null when it was never asked (HarnessV4_Tasks E9: a typed name its list lacks is said so).
   * @param {string} id @returns {string[] | null}
   */
  function ownNames(id) {
    const key = String(id || "");
    const kept = localModelCache.get(key);
    if (!kept) return discoveredNames(key) || null;
    return kept.keyed?.length ? kept.names.filter((/** @type {string} */ n) => !kept.keyed.includes(n)) : kept.names;
  }
  /**
   * What a Claude Code account's API key offers beyond the list Claude Code gave, as its last listing found it
   * (acp/bridge.js `#keyOffers`): those names, each one's words, and why they could not be asked for (`note`), for
   * the account's card; null for an upstream that keeps neither.
   * @param {string} id
   * @returns {{ names: string[], labels: Record<string, import("../core/ports.js").ModelLabel>, note: string | null } | null}
   */
  function keyedFor(id) {
    const kept = localModelCache.get(String(id || ""));
    const names = Array.isArray(kept?.keyed) ? kept.keyed.filter((/** @type {unknown} */ n) => typeof n === "string") : [];
    const note = typeof kept?.keyNote === "string" && kept.keyNote ? kept.keyNote : null;
    if (!names.length && !note) return null;
    return { names, labels: Object.fromEntries(Object.entries(kept.labels || {}).filter(([n]) => names.includes(n))), note };
  }
  /**
   * An agent's own words for the models its list kept (HarnessV3-ACP AF2), by the id it lists each under; null where
   * its listing said none.
   * @param {string} id @returns {Record<string, import("../core/ports.js").ModelLabel> | null}
   */
  function labelsFor(id) {
    return localModelCache.get(String(id || ""))?.labels || null;
  }

  // The first discovery happens when the configuration is SAVED (Providers P0): a provider that is new, or whose
  // listing (type, address, models path) or access (key, enabled, the discovery switch) changed, is asked once, in
  // the background. A read still never asks (the 2026-09-23 rule — the four-second cold picker was a read that did),
  // so a provider that answered with ten models no longer reads "Models · 0" until someone presses Refresh. A changed
  // listing forgets the old names first (they came from somewhere else); a changed key keeps them until the answer.
  // HTTP providers only: the agent CLIs and Qoder keep their explicit Refresh, whose failure is kept here too.
  /** @type {Map<string, { asking: boolean, error?: string, at?: number }>} */
  const discovery = new Map();
  /** @type {Map<string, { again: boolean }>} */
  const inFlight = new Map();
  /** @param {any} u */
  const asksOnSave = (u) =>
    !!u && u.enabled !== false && u.discoverModels !== false && !UPSTREAM_TYPES[u.type]?.local && !UPSTREAM_TYPES[u.type]?.builtin;
  /** @param {any} u */
  const shapeOf = (u) => ({
    // another machine's models are listed where its machine is (adapters/providers/filament.js)
    listing: JSON.stringify([u?.type || "", String(u?.baseUrl || "").replace(/\/+$/, ""), String(u?.modelsPath || "").trim(), u?.machine || ""]),
    // what the list request is sent with: a hash of the key (never the key itself — the shape lives as long as the
    // process) and how it is presented (authHeaders' style)
    access: JSON.stringify([createHash("sha256").update(String(u?.apiKey || "")).digest("hex").slice(0, 16), u?.authStyle || "auto", u?.enabled !== false, u?.discoverModels !== false]),
  });
  /** @param {any} cfg */
  const shapesOf = (cfg) => new Map((cfg?.upstreams || []).map((/** @type {any} */ u) => [u.id, shapeOf(u)]));
  let shapes = shapesOf(config.get());
  /** The upstream as saved now, enabled or not. @param {string} id */
  const savedUpstream = (id) => (config.get().upstreams || []).find((/** @type {any} */ x) => x.id === id) || null;
  /** One ask of the upstream as the configuration has it NOW (a save that lands meanwhile is read, not lost). @param {string} id */
  async function askOnce(id) {
    const u = savedUpstream(id);
    if (!asksOnSave(u)) return void discovery.delete(id);
    discovery.set(id, { asking: true }); // a second ask (a save while the first ran) is asking again, not the first's answer
    /** @type {any} */
    const r = await destinationFor(u)
      .listModels({ force: true })
      .catch((/** @type {any} */ e) => ({ source: "error", error: e?.message || String(e), names: [] }));
    if (!savedUpstream(id)) {
      forgetModelCache(id); // removed while it was being asked
      return void discovery.delete(id);
    }
    if (r?.source === "discovered") {
      discovery.delete(id);
      persistModelCache();
      log("info", `models: ${id} answered with ${r.names.length} model${r.names.length === 1 ? "" : "s"} (asked after the save)`);
      onDiscovered({ upstream: id, ok: true, count: r.names.length });
    } else {
      discovery.set(id, { asking: false, error: String(r?.error || "no answer"), at: Date.now() });
      log("warn", `models: ${id} did not answer its model list after the save: ${r?.error || "no answer"}`);
      onDiscovered({ upstream: id, ok: false, error: String(r?.error || "no answer") });
    }
  }
  /** Ask in the background; saves while it runs make one more ask, never a pile of them. @param {string} id */
  function discoverSoon(id) {
    const running = inFlight.get(id);
    if (running) return void (running.again = true);
    const slot = { again: false };
    inFlight.set(id, slot);
    discovery.set(id, { asking: true });
    (async () => {
      try {
        do {
          slot.again = false;
          await askOnce(id);
        } while (slot.again);
      } finally {
        inFlight.delete(id);
      }
    })();
  }
  config.onChange?.((/** @type {any} */ c) => {
    const next = shapesOf(c);
    let forgot = false;
    for (const id of shapes.keys())
      if (!next.has(id)) {
        forgot = forgetModelCache(id) || forgot;
        // An agent's list goes with it too: an account removed and added again under its name asks afresh. So do the
        // windows it named.
        forgot = localModelCache.delete(id) || forgot;
        forgot = agentWindows.delete(id) || forgot;
        forgot = outputCeilings.delete(id) || forgot;
        discovery.delete(id);
      }
    for (const u of c?.upstreams || []) {
      const was = shapes.get(u.id);
      const now = /** @type {{ listing: string, access: string }} */ (next.get(u.id));
      if (was && was.listing === now.listing && was.access === now.access) continue;
      if (was && was.listing !== now.listing) {
        forgot = forgetModelCache(u.id) || forgot;
        forgot = outputCeilings.delete(u.id) || forgot;
      }
      if (asksOnSave(u)) discoverSoon(u.id);
      else discovery.delete(u.id);
    }
    shapes = next;
    if (forgot) persistModelCache();
  });
  /**
   * What a save's discovery (an agent's: its Refresh) says about an upstream now: asking, or the error it answered —
   * until a newer list is known (a Refresh that worked since); `unasked` while nothing has asked it (its empty list
   * is no answer — HarnessV3-CodebasePass decision 6): an agent CLI or Qoder, which only a Refresh asks, until it
   * answered one; an HTTP provider with no list on this machine, which no save asked because it was set up outside
   * the console (config.json by hand, or brought from another machine without models-cache.json: HarnessV3-Launch
   * LD-D3); null when nothing.
   * @param {string} id @returns {{ asking: boolean, error?: string, at?: number, unasked?: boolean } | null}
   */
  const discoveryOf = (id) => {
    const key = String(id || "");
    const d = discovery.get(key) || null;
    if (d && !d.asking && discoveredAt(id) > (d.at || 0)) {
      discovery.delete(key);
      return null;
    }
    if (d) return d;
    const u = savedUpstream(key);
    if (!u || u.enabled === false || u.discoverModels === false) return null;
    const onRefresh = !!(UPSTREAM_TYPES[u.type]?.local || UPSTREAM_TYPES[u.type]?.builtin);
    const listed = onRefresh ? localModelCache.has(key) : discoveredAt(key) > 0;
    return listed ? null : { asking: false, unasked: true };
  };
  /**
   * An account added in Settings starts with its agent's model list (HarnessV3-ACP AC3-7), as old as that list is;
   * its own Refresh replaces it.
   * @param {string} fromId @param {string} toId
   */
  function adopt(fromId, toId) {
    const listed = localModelCache.get(fromId);
    if (!listed) return;
    // The agent's own list alone: what the other account's API key offers is that key's, not this account's.
    const { keyed = [], keyNote: _, ...own } = listed;
    const labels = own.labels && keyed.length ? Object.fromEntries(Object.entries(own.labels).filter(([n]) => !keyed.includes(n))) : own.labels;
    localModelCache.set(toId, { ...own, names: listed.names.filter((/** @type {string} */ n) => !keyed.includes(n)), ...(labels ? { labels } : {}) });
    persistModelCache();
  }
  /**
   * The window a coding agent named for a model as a turn ended (the account-switch fix, D1): kept per upstream — one
   * account of the agent — under the name as that upstream receives it; the newest word stands.
   * @param {string} upstreamId @param {string} sent @param {number} tokens
   */
  function noteAgentWindow(upstreamId, sent, tokens) {
    const key = windowKey(sent);
    const n = Math.floor(Number(tokens) || 0);
    if (!upstreamId || !key || !isWindow(n) || !isAgentUpstream(savedUpstream(upstreamId))) return;
    const kept = agentWindows.get(upstreamId) || {};
    if (kept[key] === n) return;
    agentWindows.set(upstreamId, { ...kept, [key]: n });
    persistModelCache();
  }
  /**
   * The window a coding agent named for a model: its own account's word, else (D2) the smallest that another account
   * of the same agent named for it. An account added or signed in since has run no turn yet, and the same agent's same
   * model almost always has the same window; where accounts differ, the smallest seeds no more than any of them took.
   * @param {string} upstreamId @param {string} sent @returns {number | null}
   */
  function agentWindow(upstreamId, sent) {
    const key = windowKey(sent);
    if (!key) return null;
    const own = agentWindows.get(upstreamId)?.[key];
    if (own) return own;
    const ups = config.get().upstreams || [];
    const me = ups.find((/** @type {any} */ u) => u.id === upstreamId);
    if (!me || !isAgentUpstream(me)) return null;
    const kin = agentKey(me);
    let least = 0;
    for (const [id, kept] of agentWindows) {
      const n = id === upstreamId ? 0 : Number(kept[key]) || 0;
      if (!n || (least && n >= least)) continue;
      const other = ups.find((/** @type {any} */ u) => u.id === id);
      if (other && isAgentUpstream(other) && agentKey(other) === kin) least = n;
    }
    return least || null;
  }
  /**
   * The most a model may write at an upstream, as the upstream said when it refused a request that asked for more:
   * kept under the name as that upstream receives it; a lower word replaces a higher one.
   * @param {string} upstreamId @param {string} sent @param {number} tokens
   */
  function noteOutputCeiling(upstreamId, sent, tokens) {
    const key = windowKey(sent);
    const n = Math.floor(Number(tokens) || 0);
    if (!upstreamId || !key || !isCeiling(n) || !savedUpstream(upstreamId)) return;
    const kept = outputCeilings.get(upstreamId) || {};
    if (kept[key] && kept[key] <= n) return;
    outputCeilings.set(upstreamId, { ...kept, [key]: n });
    persistModelCache();
  }
  /** The server's stop: a pending save is written now, and none after (HarnessV3-FixRound F1 item 1). */
  function close() {
    closed = true;
    if (!cacheSaveTimer) return;
    clearTimeout(cacheSaveTimer);
    cacheSaveTimer = null;
    saveModelCache();
  }
  return { cfgForModels, persistModelCache, windowForModel, discoveryOf, adopt, askAgent, listed, ownNames, keyedFor, labelsFor, noteAgentWindow, noteOutputCeiling, close };
}

/**
 * The models another machine's chats may call here (the remote-agents plan's m-door): those that answer
 * (readiness.js `modelsThatAnswer`), by an API — never a coding agent's, which would work on this machine for them, nor
 * a third machine's, which it lent to this one alone (m-upstream) — and named alone, with no mark a coding agent reads
 * (acp-turn.js `MODEL_MARKS`).
 * @param {any} cfg @param {readonly any[]} models  the catalogue (`aggregateModels(…).models`)
 */
export const lentModels = (cfg, models) =>
  modelsThatAnswer(cfg, models).filter((m) => {
    const u = findUpstream(cfg, m.upstream);
    return !isAgentUpstream(u) && !isMachineUpstream(u) && ![...String(m.id)].some((c) => Object.hasOwn(MODEL_MARKS, c));
  });

/**
 * @param {AppDeps} deps
 * @param {import("node:http").ServerResponse} res
 * @param {"anthropic" | "openai"} format
 * @param {{ lent?: boolean }} [o]  `lent`: the list another machine's chats are given (`lentModels`)
 */
export async function listModels({ config, modelsConfig, destination }, res, format, { lent = false } = {}) {
  const discover = (u, opts) =>
    /** @type {import("../core/ports.js").Destination} */ (destination(u)).listModels(opts);
  const cfg = await modelsConfig(false);
  const all = (await aggregateModels(cfg, { discover })).models || [];
  const models = lent ? lentModels(cfg, all) : all;
  const now = Math.floor(Date.now() / 1000);
  // `upstream` / `upstream_model` / `context_window` are Filament extras (clients ignore unknown fields).
  if (format === "anthropic")
    return sendJson(res, 200, {
      data: models.map((m) => ({
        id: m.id,
        type: "model",
        display_name: m.id,
        created_at: new Date(now * 1000).toISOString(),
        upstream: m.upstream,
        upstream_model: m.upstreamModel,
        ...(m.context_window ? { context_window: m.context_window } : {}),
      })),
      has_more: false,
      first_id: models[0]?.id || null,
      last_id: models[models.length - 1]?.id || null,
    });
  return sendJson(res, 200, {
    object: "list",
    data: models.map((m) => ({
      id: m.id,
      object: "model",
      created: now,
      owned_by: m.upstream,
      upstream: m.upstream,
      upstream_model: m.upstreamModel,
      ...(m.context_window ? { context_window: m.context_window } : {}),
    })),
  });
}
