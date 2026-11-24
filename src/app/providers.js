// @ts-check
// The providers as the harness's Settings › Providers sets them (HarnessV4_Settings_Plan HS-2, HS-D3): each write names
// the one provider it changes and is made against the configuration as it stands, never a page's whole copy of it.
// - `list()`: every upstream in the page's words — the catalogue entry and plan its address is, its key as set or not
//   (never the key), its prefix, the other routes that name it, its models' lists and rows, its last test and today's
//   spend.
// - `add(body)`: a provider from the catalogue (or another address) with its key, its prefix route at the top, the
//   models left out of the pickers, and the catalogue's hints as its first model rows.
// - `change(id, patch, base)`: one provider's fields; a page that read it at an older version is refused when this
//   provider changed since (a sign-in's tokens, another window), with what changed — a change elsewhere leaves it be.
//   Both take their caller's weigher (`refuse`): the admin rows hand in the configuration's own, so what a save of the
//   whole refuses a caller, these refuse it too.
// - `removal(id)` and `remove(id, { also })`: what goes with a provider, then the provider and its prefix route; a
//   route of the operator's that names it stops the removal until they say those go too (HS-D15).
// A coding agent's entry takes only its model lists here (HS-D12): its connection is Settings › Coding agents'.
import { providerById, planOf, placeholdersOf, fillBaseUrl, providerForBaseUrl, prefixRouteOf, prefixProblem, freePrefix } from "../core/providers.js";
import { UPSTREAM_TYPES, isAgentUpstream, isMachineUpstream } from "../core/schema.js";
import { cleanName } from "../services/machine.js";
import { withoutUpstreams } from "../core/routing.js";
import { redactConfig } from "../services/config/store.js";
import { changeConfig, changedSince, changeLines, failure } from "./config-change.js";

const SECRET = "__SECRET__";
/** The kinds an API provider is (the coding agents and Qoder cloud are added their own ways). */
const API_TYPES = new Set(["openai-compatible", "anthropic-compatible", "openai", "anthropic"]);
const AUTH_STYLES = new Set(["auto", "bearer", "x-api-key", "both"]);
const WIRE_APIS = new Set(["auto", "chat-completions", "responses"]);
/**
 * Where a key came from, as another machine's app said it as it copied the key here ("Desk on 2026-11-24"): one short
 * line with nothing invisible in it, as long as a machine's name at most; "" for none. @param {unknown} v
 */
const keyFromOf = (v) => (typeof v === "string" ? cleanName(v) : "");
/** The fields a coding agent's entry takes here: its model lists and a model's row. */
const AGENT_FIELDS = new Set(["hiddenModels", "models", "pricingRow"]);
/**
 * The fields another machine's entry takes here: its name, its switch, its prefix, how it bills, its model lists and
 * rows — never an address, a key or a header, which are its machine's, read from the machines store at each call.
 */
const MACHINE_FIELDS = new Set(["name", "enabled", "prefix", "billing", "discoverModels", "hiddenModels", "models", "pricingRow"]);
const DAY = 86_400_000;

/** @param {number} at */
const dayOf = (at) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** How many leaf values a rules object sets (its rule overrides). @param {any} v @returns {number} */
const leaves = (v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.values(v).reduce((n, x) => n + leaves(x), 0) : v === undefined ? 0 : 1);

/** A list of model names, each once, with no comma (the typed list is kept as one). @param {unknown} v @param {string} what */
function namesOf(v, what) {
  if (!Array.isArray(v)) throw failure(400, `${what} is a list of model names`);
  const out = [];
  const seen = new Set();
  for (const x of v) {
    const n = String(x ?? "").trim();
    if (!n) continue;
    if (n.includes(",")) throw failure(400, `A model name has no comma: ${n}`);
    if (seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}

/**
 * Headers as a page sends them back: a value shown as the placeholder keeps the one stored under that name. One under
 * a name that holds none — a header renamed with its kept value — is refused in words, never dropped (the bug hunt of
 * 10-30).
 * @param {unknown} v @param {Record<string, string>} stored
 */
function headersOf(v, stored) {
  if (v == null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw failure(400, "headers are a map of names to values");
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, raw] of Object.entries(v)) {
    const name = String(k).trim();
    if (!name) continue;
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw failure(400, `A header's name is letters, digits and dashes: ${name}`);
    const val = String(raw ?? "");
    if (val === SECRET) {
      if (!Object.hasOwn(stored, name)) throw failure(400, `${name} holds no kept value: a kept value stays under the name it was saved with. Type the header's value again, or put back the name it had.`);
      out[name] = String(stored[name] ?? "");
    } else out[name] = val;
  }
  return out;
}

/**
 * A write's weigher: why the configuration it would leave is not saved, in words, or null where it is.
 * @typedef {(was: any, next: any) => string | null} Weigher
 */

/** A machine's name in a prefix's letters: "Kai's PC" → "kai-s-pc". @param {string} name */
const prefixOfName = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "") || "machine";

/**
 * @param {{ config: import("../core/ports.js").ConfigStore, usage?: any, now?: () => number,
 *   machines?: import("../services/machines/index.js").Machines | null }} deps
 *   `machines`: the machines this Filament keeps (services/machines), whose models an upstream of type `filament` offers
 */
export function createProviders({ config, usage = null, now = Date.now, machines = null }) {
  /** The last test of each upstream since Filament started: its answer and when (the list's dot). @type {Map<string, any>} */
  const tests = new Map();

  /** Requests and spend per upstream since `from` (a day), from the day store. @param {string} from */
  const spendSince = (from) => {
    /** @type {Map<string, { requests: number, cost: number, costN: number }>} */
    const by = new Map();
    for (const r of usage?.dailyStore?.aggregate({ from })?.rows || []) {
      const s = by.get(r.upstream) || { requests: 0, cost: 0, costN: 0 };
      s.requests += Number(r.requests) || 0;
      s.cost += Number(r.cost) || 0;
      s.costN += Number(r.costN) || 0;
      by.set(r.upstream, s);
    }
    return by;
  };

  /** @param {string} id */
  const find = (id) => (config.get().upstreams || []).find((/** @type {any} */ u) => u.id === id) || null;
  /** @param {string} id */
  const must = (id) => {
    const u = find(id);
    if (!u) throw failure(404, `No provider "${id}"`);
    return u;
  };

  /**
   * One upstream in the page's words, from the redacted configuration. `lost`: the places this secret.key cannot open
   * (the store's `unreadable()`), which the redacted configuration shows as kept: a key among them says so.
   * @param {any} cfg  redacted @param {any} u  redacted @param {Map<string, any>} today @param {Set<string>} lost
   */
  const viewOf = (cfg, u, today, lost) => {
    const known = providerForBaseUrl(u.baseUrl);
    const pr = prefixRouteOf(cfg, u.id);
    const routes = (cfg.routes || [])
      .filter((/** @type {any} */ r) => r !== pr && (r.upstream === u.id || (r.fallbacks || []).some((/** @type {any} */ f) => f?.upstream === u.id)))
      .map((/** @type {any} */ r) => ({ match: String(r.match), as: r.upstream === u.id ? "first" : "backup", enabled: r.enabled !== false }));
    const q = u.qoder || {};
    const unreadable = (/** @type {string} */ place) => lost.has(`upstreams.${u.id}.${place}`);
    return {
      id: u.id,
      name: u.name || u.id,
      type: u.type,
      agent: isAgentUpstream(u),
      // Another machine's models: the machine, by its id as this machine keeps it (services/machines).
      ...(isMachineUpstream(u) ? { machine: u.machine } : {}),
      enabled: u.enabled !== false,
      baseUrl: u.baseUrl || "",
      key: { stored: u.apiKey === SECRET, masked: u.apiKeyMasked || "", ...(unreadable("apiKey") ? { unreadable: true } : {}), ...(u.keyFrom ? { from: String(u.keyFrom) } : {}) },
      billing: u.billing === "metered" || u.billing === "plan" ? u.billing : null,
      provider: known
        ? {
            id: known.provider.id,
            name: known.provider.name,
            keyless: !!known.provider.keyless,
            keyUrl: known.plan.keyUrl || known.provider.keyUrl || null,
            plan: { id: known.plan.id, label: known.plan.label, billing: known.plan.billing },
            plans: known.provider.plans,
            fields: known.provider.fields || [],
          }
        : null,
      prefix: pr ? String(pr.match).slice(0, -2) : null,
      routes,
      hiddenModels: u.hiddenModels || [],
      models: u.models || [],
      discoverModels: u.discoverModels !== false,
      authStyle: u.authStyle || "auto",
      wireApi: u.wireApi || "auto",
      modelsPath: u.modelsPath || "",
      headers: u.headers || {},
      // Its model rows and rules, as a Tune sheet previews against them (POST /api/models/caps takes the page's copy).
      pricing: u.pricing || {},
      rules: u.rules || {},
      ruleOverrides: leaves(u.rules || {}),
      // A kind that signs in with an account (Qoder cloud's) says where its account stands.
      ...(UPSTREAM_TYPES[u.type]?.signIn ? { qoder: { signedIn: !!(q.accessToken && q.userId && !unreadable("qoder.accessToken")) || String(u.apiKeyMasked || "").startsWith("pt-"), email: q.email || null, expiresAt: q.expiresAt || null } } : {}),
      test: tests.get(u.id) || null,
      today: today.get(u.id) || null,
    };
  };

  /** The configuration as the page reads it, and the places this secret.key cannot open. */
  const redacted = () => {
    const lost = config.unreadable();
    return { cfg: redactConfig(config.get(), { unreadable: lost }), lost: new Set(lost) };
  };

  /** @param {string} id */
  const view = (id) => {
    const { cfg, lost } = redacted();
    const u = (cfg.upstreams || []).find((/** @type {any} */ x) => x.id === id);
    return u ? viewOf(cfg, u, spendSince(dayOf(now())), lost) : null;
  };

  /**
   * A provider's change of the configuration kept, where its caller's weigher lets it: `refuse` says why it is not
   * saved, or null where it is — the press key's (http/admin/config.js `pressNeeded`, which reads the configuration's
   * own weigher: what is a press in a save of the whole is one here; s-rows, 11-12) —, refused with `press: true`
   * before anything moves, as a field's is (config-fields.js).
   * @param {any} next  the whole configuration as it should be @param {{ refuse?: Weigher | null, forget?: string[] }} [o]
   */
  const keep = (next, { refuse = null, forget = [] } = {}) => {
    const no = refuse?.(config.get(), next);
    if (no) throw failure(403, no, { press: true });
    changeConfig(config, next, { forget });
  };

  /**
   * Another machine's models added (the remote-agents plan's m-upstream): `machine` names one this Filament keeps an
   * agents' device for — by its name, its id or its address —, kept here by its id; its name is the machine's, its
   * prefix the one given, else the machine's name in a prefix's letters, made free. It bills here as a plan: its
   * machine pays its provider. One machine's models are one upstream.
   * @param {any} b @param {{ refuse?: Weigher | null }} [o]
   */
  const addMachine = (b, { refuse = null } = {}) => {
    const which = String(b.machine ?? "").trim();
    if (!which) throw failure(400, "Name the machine whose models it offers: one this Filament's agents work on (Settings › Remote access)");
    /** A name two machines share is refused in the store's words, which say each by its id. @param {boolean} agents */
    const found = (agents) => {
      try {
        return machines?.find(which, { agents }) || null;
      } catch (/** @type {any} */ e) {
        throw failure(400, String(e?.message || e));
      }
    };
    const kept = found(true);
    if (!kept) {
      const theirs = found(false);
      const all = (machines?.list() || []).filter((m) => m.device.scope === "agent").map((m) => m.name);
      throw failure(
        400,
        theirs
          ? `${theirs.name} is paired with this machine for you, not for its agents: let this machine's agents work there (Settings › Remote access › Machines), then add its models`
          : `No machine "${which}" is kept for this Filament's agents — ${all.length ? `those kept: ${all.join(", ")}` : "none is: pair one in Settings › Remote access › Machines"}`,
      );
    }
    const cfg = config.get();
    const had = (cfg.upstreams || []).find((/** @type {any} */ u) => isMachineUpstream(u) && u.machine === kept.machine.id);
    if (had) throw failure(409, `${kept.name}'s models are offered already, by ${had.name || had.id}`);
    const typed = String(b.prefix ?? "").trim();
    const problem = typed ? prefixProblem(cfg, typed) : "";
    if (problem) throw failure(409, problem, { free: freePrefix(cfg, /[^a-z0-9_-]/i.test(typed) ? prefixOfName(kept.name) : typed) });
    const prefix = typed || freePrefix(cfg, prefixOfName(kept.name));
    const upstream = {
      id: prefix,
      name: String(b.name || "").trim() || kept.name,
      type: "filament",
      machine: kept.machine.id,
      enabled: true,
      billing: "plan",
      rules: {},
      hiddenModels: b.hiddenModels == null ? [] : namesOf(b.hiddenModels, "hiddenModels"),
    };
    const route = { match: `${prefix}/*`, upstream: prefix, upstreamModel: "{1}", format: "auto", fallbacks: [], discoverPrefixes: [], enabled: true, rules: {} };
    const next = structuredClone(cfg);
    (next.upstreams ||= []).push(upstream);
    (next.routes ||= []).unshift(route);
    keep(next, { refuse });
    return view(prefix);
  };

  return {
    /** Every upstream, in the order the configuration keeps them, and the version they were read at. */
    list() {
      const { cfg, lost } = redacted();
      const today = spendSince(dayOf(now()));
      return { version: config.version(), upstreams: (cfg.upstreams || []).map((/** @type {any} */ u) => viewOf(cfg, u, today, lost)) };
    },

    /**
     * Keep a test's answer for the list's dot (its key, its sample and its names stay out).
     * @param {string} id @param {any} r  `testUpstream`'s answer
     */
    tested(id, r) {
      tests.set(id, { ok: !!r?.ok, status: Number(r?.status) || 0, ms: Number(r?.ms) || 0, models: r?.models ?? null, error: r?.ok ? null : String(r?.error || (r?.status ? `HTTP ${r.status}` : "no answer")).slice(0, 300), at: now() });
    },

    /**
     * A provider added (HS-D14): `provider` a catalogue id, or none for another address (`type`, `baseUrl`); `plan` and
     * `fields` make its address; `apiKey`; `prefix`; `hiddenModels`, the models left out; `name`, `authStyle`,
     * `wireApi`, `modelsPath`, `headers` from Advanced. `refuse`: its caller's weigher (`keep`).
     * @param {any} body @param {{ refuse?: Weigher | null }} [o]
     */
    add(body, { refuse = null } = {}) {
      const b = body && typeof body === "object" ? body : {};
      if (b.type === "filament") return addMachine(b, { refuse });
      const cfg = config.get();
      const known = b.provider ? providerById(String(b.provider)) : null;
      if (b.provider && !known) throw failure(400, `The catalogue has no provider "${b.provider}"`);
      const plan = planOf(known, b.plan ? String(b.plan) : undefined);
      const type = known ? known.type : String(b.type || "openai-compatible");
      if (!API_TYPES.has(type)) throw failure(400, `A provider here is ${[...API_TYPES].join(", ")}; a coding agent is connected under Coding agents`);
      const typed = typeof b.baseUrl === "string" ? b.baseUrl.trim() : "";
      const baseUrl = typed || (plan ? fillBaseUrl(plan.baseUrl, b.fields || {}) || "" : "");
      if (!/^https?:\/\/[^/\s]+/i.test(baseUrl)) {
        const missing = plan && !typed ? placeholdersOf(plan.baseUrl).find((k) => !fillBaseUrl(`{${k}}`, b.fields || {})) : null;
        const field = missing ? (known?.fields || []).find((f) => f.id === missing)?.label || missing : null;
        throw failure(400, field ? `Type the ${field}: it is part of the address` : "The address must start with http:// or https://");
      }
      const prefix = String(b.prefix ?? "").trim();
      const problem = prefixProblem(cfg, prefix);
      if (problem) throw failure(409, problem, { free: freePrefix(cfg, prefix && !/[^a-z0-9_-]/i.test(prefix) ? prefix : known?.prefix || "provider") });
      const apiKey = typeof b.apiKey === "string" && b.apiKey !== SECRET ? b.apiKey.trim() : "";
      const upstream = {
        id: prefix,
        name: String(b.name || "").trim() || (known ? known.name : prefix),
        type,
        baseUrl,
        apiKey,
        ...(apiKey && keyFromOf(b.keyFrom) ? { keyFrom: keyFromOf(b.keyFrom) } : {}),
        authStyle: AUTH_STYLES.has(b.authStyle) ? b.authStyle : "auto",
        ...(type === "openai" || type === "openai-compatible" ? { wireApi: WIRE_APIS.has(b.wireApi) ? b.wireApi : "auto" } : {}),
        modelsPath: typeof b.modelsPath === "string" ? b.modelsPath.trim() : plan?.modelsPath || "",
        headers: headersOf(b.headers, {}),
        enabled: true,
        rules: {},
        hiddenModels: b.hiddenModels == null ? [] : namesOf(b.hiddenModels, "hiddenModels"),
        pricing: structuredClone(known?.hints || {}),
      };
      const route = { match: `${prefix}/*`, upstream: prefix, upstreamModel: "{1}", format: "auto", fallbacks: [], discoverPrefixes: [...(known?.route?.discoverPrefixes || [])], enabled: true, rules: {} };
      const next = structuredClone(cfg);
      (next.upstreams ||= []).push(upstream);
      (next.routes ||= []).unshift(route);
      keep(next, { refuse });
      return view(prefix);
    },

    /**
     * One provider's fields changed. `base`: the version the page read it at — when this provider (its entry, or a route
     * that names it) changed since, the change is refused with what changed (HC-43). `refuse`: its caller's weigher
     * (`keep`) — its address moved while its key is kept sends the key there, which is a press.
     * @param {string} id @param {any} patch @param {number | null} [base]
     * @param {{ refuse?: Weigher | null }} [o]
     */
    change(id, patch, base = null, { refuse = null } = {}) {
      const p = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
      const u = must(id);
      const agent = isAgentUpstream(u);
      if (agent) {
        const other = Object.keys(p).find((k) => !AGENT_FIELDS.has(k));
        if (other) throw failure(400, `${u.name || u.id} is a coding agent: its ${other} is set under Settings › Coding agents`);
      }
      if (isMachineUpstream(u)) {
        const other = Object.keys(p).find((k) => !MACHINE_FIELDS.has(k));
        if (other) throw failure(400, `${u.name || u.id} is another machine's models: its ${other} is that machine's, kept in Settings › Remote access`);
      }
      if (Number.isInteger(base) && base !== config.version()) {
        const diff = changedSince(config, /** @type {number} */ (base), id);
        if (!diff) throw failure(409, `${u.name || u.id}'s page was read too long ago to tell what changed since: read it again`, { stale: true });
        if (diff.length) throw failure(409, `${u.name || u.id} changed since this page read it: read it again`, { stale: true, changes: changeLines(diff) });
      }
      const cfg = config.get();
      const next = structuredClone(cfg);
      const nu = next.upstreams.find((/** @type {any} */ x) => x.id === id);
      if ("name" in p) nu.name = String(p.name ?? "").trim() || nu.id;
      if ("enabled" in p) {
        if (typeof p.enabled !== "boolean") throw failure(400, "enabled is true or false");
        nu.enabled = p.enabled;
      }
      // An empty key keeps the one kept (HC-34); null takes it away, one this secret.key cannot open too (`forget`).
      /** @type {string[]} */
      const forget = [];
      if ("apiKey" in p) {
        if (p.apiKey === null) {
          nu.apiKey = "";
          forget.push(`upstreams.${id}.apiKey`);
        } else if (typeof p.apiKey === "string" && p.apiKey.trim() && p.apiKey !== SECRET) nu.apiKey = p.apiKey.trim();
        // Where the key came from goes with it: a copy's (`keyFrom`), and none for one set here.
        if (p.apiKey === null || (typeof p.apiKey === "string" && p.apiKey.trim() && p.apiKey !== SECRET)) nu.keyFrom = keyFromOf(p.keyFrom);
      }
      if ("baseUrl" in p) {
        const url = String(p.baseUrl ?? "").trim();
        if (!/^https?:\/\/[^/\s]+/i.test(url)) throw failure(400, "The address must start with http:// or https://");
        nu.baseUrl = url;
      }
      if ("type" in p) {
        if (!API_TYPES.has(p.type) || !API_TYPES.has(nu.type)) throw failure(400, `A provider's kind is one of ${[...API_TYPES].join(", ")}`);
        nu.type = p.type;
        if (p.type === "openai" || p.type === "openai-compatible") nu.wireApi ||= "auto";
        else delete nu.wireApi;
      }
      if ("billing" in p) {
        if (p.billing !== null && p.billing !== "metered" && p.billing !== "plan") throw failure(400, "billing is metered, plan, or null for the catalogue's word");
        if (p.billing === null) delete nu.billing;
        else nu.billing = p.billing;
      }
      if ("authStyle" in p) {
        if (!AUTH_STYLES.has(p.authStyle)) throw failure(400, `authStyle is one of ${[...AUTH_STYLES].join(", ")}`);
        nu.authStyle = p.authStyle;
      }
      if ("wireApi" in p) {
        if (!WIRE_APIS.has(p.wireApi)) throw failure(400, `wireApi is one of ${[...WIRE_APIS].join(", ")}`);
        nu.wireApi = p.wireApi;
      }
      if ("modelsPath" in p) nu.modelsPath = String(p.modelsPath ?? "").trim();
      if ("discoverModels" in p) nu.discoverModels = p.discoverModels !== false;
      if ("headers" in p) nu.headers = headersOf(p.headers, u.headers || {});
      if ("hiddenModels" in p) nu.hiddenModels = namesOf(p.hiddenModels, "hiddenModels");
      if ("models" in p) nu.models = namesOf(p.models, "models");
      // One model's row, as a Tune sheet saves it: the row whole, or null to take it away.
      if ("pricingRow" in p) {
        const key = String(p.pricingRow?.key ?? "").trim();
        if (!key) throw failure(400, "pricingRow names its key: the model name, or the prefix, it covers");
        const row = p.pricingRow?.row;
        if (row != null && (typeof row !== "object" || Array.isArray(row))) throw failure(400, "pricingRow.row is the row's fields, or null to take it away");
        nu.pricing = { ...(nu.pricing || {}) };
        if (row && Object.keys(row).length) nu.pricing[key] = row;
        else delete nu.pricing[key];
      }
      // The prefix moves the provider's prefix route, or makes one where it has none.
      if ("prefix" in p) {
        const want = String(p.prefix ?? "").trim();
        const pr = prefixRouteOf(next, id);
        if (!pr || want !== String(pr.match).slice(0, -2)) {
          const others = { upstreams: next.upstreams.filter((/** @type {any} */ x) => x.id !== id), routes: next.routes.filter((/** @type {any} */ r) => r !== pr) };
          const problem = prefixProblem(others, want);
          if (problem) throw failure(409, problem, { free: freePrefix(others, id) });
          if (pr) pr.match = `${want}/*`;
          else next.routes.unshift({ match: `${want}/*`, upstream: id, upstreamModel: "{1}", format: "auto", fallbacks: [], discoverPrefixes: [], enabled: true, rules: {} });
        }
      }
      keep(next, { refuse, forget });
      return view(id);
    },

    /** What goes with a provider (HS-D15): its prefix route, the other routes that name it, its last 30 days. @param {string} id */
    removal(id) {
      const u = must(id);
      if (isAgentUpstream(u)) throw failure(400, `${u.name || u.id} is a coding agent: it is removed under Settings › Coding agents`);
      const v = /** @type {any} */ (view(id));
      const s = spendSince(dayOf(now() - 29 * DAY)).get(id) || null;
      return { id, name: v.name, prefix: v.prefix, routes: v.routes, last30: s ? { requests: s.requests, cost: s.costN ? s.cost : null } : { requests: 0, cost: null } };
    },

    /**
     * The provider gone, and its prefix route. A route of the operator's that names it stops it (409, those routes
     * named) until `also`: then a route that sends to it first goes too, and one that keeps it as a backup loses that
     * backup.
     * @param {string} id @param {{ also?: boolean }} [o]
     */
    remove(id, o = {}) {
      const u = must(id);
      if (isAgentUpstream(u)) throw failure(400, `${u.name || u.id} is a coding agent: it is removed under Settings › Coding agents`);
      const cfg = config.get();
      const pr = prefixRouteOf(cfg, id);
      const others = (cfg.routes || []).filter((/** @type {any} */ r) => r !== pr && (r.upstream === id || (r.fallbacks || []).some((/** @type {any} */ f) => f?.upstream === id)));
      if (others.length && !o.also)
        throw failure(409, `${others.length === 1 ? "A route of yours names" : `${others.length} routes of yours name`} ${u.name || u.id}: ${others.map((/** @type {any} */ r) => r.match).join(", ")}. Remove ${others.length === 1 ? "it" : "them"} too, or change ${others.length === 1 ? "it" : "them"} in the console first.`, { routes: others.map((/** @type {any} */ r) => ({ match: String(r.match), as: r.upstream === id ? "first" : "backup" })) });
      changeConfig(config, withoutUpstreams(cfg, new Set([id])));
      tests.delete(id);
      return { removed: id, name: u.name || u.id, routes: others.length + (pr ? 1 : 0) };
    },
  };
}
