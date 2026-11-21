// @ts-check
// Filament's admin API as Settings › Providers and the model rows read it, in memory: the providers' views at a
// version, the narrow writes that move it, the catalogue, a probe's answer, the picker's lists, the caps cards and
// families, Ping, and Qoder's sign-in. Every call is kept; `refuse` turns any of them into a refusal the way the real
// api() throws one (its status and body on the error).

/** A refusal as lib/api.js throws it. @param {number} status @param {Record<string, any>} body */
export const apiError = (status, body) => Object.assign(new Error(String(body.error || `HTTP ${status}`)), { status, body });

/** Z.ai's catalogue entry: two plans, a key page, a prefix. */
export const ZAI = Object.freeze({
  id: "zai", name: "Z.ai (GLM)", type: "openai-compatible", prefix: "zai", keyUrl: "https://z.ai/manage-apikey", blurb: "GLM models.",
  plans: [
    { id: "coding", label: "GLM Coding Plan", baseUrl: "https://api.z.ai/api/coding/paas/v4", billing: "plan", modelsPath: "" },
    { id: "api", label: "API", baseUrl: "https://api.z.ai/api/paas/v4", billing: "metered", modelsPath: "" },
  ],
  fields: [],
});

/** A provider's view as GET /api/upstreams answers it: Z.ai on its coding plan unless `o` says otherwise. @param {Record<string, any>} [o] */
export const viewOf = (o = {}) => ({
  id: "zai", name: "Z.ai", type: "openai-compatible", agent: false, enabled: true, baseUrl: ZAI.plans[0].baseUrl,
  key: { stored: true, masked: "sk-a…f9" }, billing: null,
  provider: { id: "zai", name: ZAI.name, keyless: false, keyUrl: ZAI.keyUrl, plan: ZAI.plans[0], plans: ZAI.plans, fields: [] },
  prefix: "zai", routes: [], hiddenModels: [], models: [], discoverModels: true, authStyle: "auto", wireApi: "auto", modelsPath: "",
  headers: {}, pricing: {}, rules: {}, ruleOverrides: 0, qoder: null, test: null, today: { requests: 0, cost: 0, costN: 0 },
  ...o,
});

/** A family as POST /api/models/caps lists it. @param {string} up @param {string} name @param {string[]} ids @param {Record<string, any>} [o] */
export const familyOf = (up, name, ids, o = {}) => ({
  id: `${up}/${ids[0]}`, name, kind: "chat", lead: `${up}/${ids[0]}`,
  members: ids.map((n) => ({ id: `${up}/${n}`, name: n, source: "discovered", ...(n.endsWith("-fast") ? { speed: "fast" } : {}) })),
  ...o,
});

/** A model's card as POST /api/models/caps answers it. @param {string} id @param {Record<string, any>} [o] */
export const cardOf = (id, o = {}) => ({
  id, upstreamModel: id.split("/").slice(1).join("/"),
  caps: { wire: "openai", effort: { levels: null, source: null }, fast: { available: false, source: null }, thinking: { available: false, source: null }, window: { standard: 200000, options: [], source: "builtin" }, maxOutput: { tokens: null, source: null } },
  fallback: {}, offer: { kind: "model", effort: null, speed: null, thinking: null, window: { standard: 200000, options: [] } }, policy: {}, rowKeys: {},
  ...o,
});

/** The events stream as lib/bus.js `onBus` hands it out. */
export function fakeBus() {
  /** @type {Set<(msg: any) => void>} */
  const fns = new Set();
  return {
    /** @param {(msg: any) => void} fn */
    subscribe: (fn) => {
      fns.add(fn);
      return () => void fns.delete(fn);
    },
    /** @param {any} msg */
    say: (msg) => { for (const fn of [...fns]) fn(msg); },
    listeners: () => fns.size,
  };
}

/**
 * The server.
 * @param {{ upstreams?: any[], version?: number, catalogue?: any[], families?: Record<string, any[]>, cards?: Record<string, any[]>,
 *   info?: Record<string, any>, models?: any[], usage?: any[], slots?: any[], probe?: any, test?: any }} [o]
 *   `families`, `cards`: the caps answer by provider; `info`: GET /api/models' `upstreams`; `models`: its `models`; `usage`: the day store's rows; `slots`: GET /api/subagents/slots' rows
 */
export function fakeServer(o = {}) {
  const s = {
    version: o.version ?? 10,
    upstreams: structuredClone(o.upstreams || [viewOf()]),
    catalogue: o.catalogue || [ZAI],
    families: o.families || {},
    cards: o.cards || {},
    info: o.info || {},
    models: o.models || [],
    usage: o.usage || [],
    /** Each model's limit across your chats and what holds it, as `GET /api/subagents/slots` lists them. @type {any[]} */
    slots: structuredClone(o.slots || []),
    probe: o.probe ?? { ok: true, status: 200, ms: 90, models: [], families: [], other: [] },
    test: o.test ?? { ok: true, status: 200, ms: 120, models: 2 },
    ping: /** @type {any} */ ({ ok: true, ms: 840, text: "pong" }),
    qoderPolls: /** @type {any[]} */ ([]),
    /** @type {{ path: string, method: string, body: any }[]} */
    calls: [],
    /** A refusal in place of an answer, when it says one. @type {((path: string, method: string, body: any) => Error | undefined) | null} */
    refuse: null,
    /** @type {(path: string, o?: any) => Promise<any>} */
    api: async () => null,
    /** The calls of one kind, by method and path's start. @param {string} method @param {string} start */
    made: (method, start) => s.calls.filter((c) => c.method === method && c.path.startsWith(start)),
  };
  /** @param {string} id */
  const find = (id) => {
    const u = s.upstreams.find((x) => x.id === id);
    if (!u) throw apiError(404, { error: "upstream not found" });
    return u;
  };
  s.api = async (path, opts = {}) => {
    const method = opts.method || "GET";
    const body = opts.body === undefined ? undefined : structuredClone(opts.body);
    s.calls.push({ path, method, body });
    const no = s.refuse?.(path, method, body);
    if (no) throw no;
    const [p, q = ""] = path.split("?");
    /** @type {RegExpExecArray | null} */
    let m;
    if (p === "/upstreams" && method === "GET") return { version: s.version, upstreams: structuredClone(s.upstreams) };
    if (p === "/upstreams" && method === "POST") {
      const cat = s.catalogue.find((x) => x.id === body.provider);
      const plan = cat?.plans.find((/** @type {any} */ x) => x.id === body.plan) || cat?.plans[0];
      const u = viewOf({
        id: body.prefix, name: cat ? cat.name.replace(/ \(.*\)$/, "") : body.prefix, type: body.type, baseUrl: body.baseUrl || plan?.baseUrl,
        key: { stored: !!body.apiKey, masked: body.apiKey ? "sk-n…ew" : "" }, prefix: body.prefix, hiddenModels: body.hiddenModels || [],
        provider: cat ? { id: cat.id, name: cat.name, keyless: !!cat.keyless, keyUrl: cat.keyUrl, plan, plans: cat.plans, fields: cat.fields || [] } : null,
      });
      s.upstreams.push(u);
      s.version++;
      return { upstream: structuredClone(u), config: {}, version: s.version };
    }
    if ((m = /^\/upstreams\/([^/]+)$/.exec(p))) {
      const u = find(decodeURIComponent(m[1]));
      if (method === "PATCH") {
        const { base: _base, apiKey, pricingRow, ...rest } = body;
        Object.assign(u, rest);
        if (apiKey) u.key = { stored: true, masked: `${apiKey.slice(0, 4)}…${apiKey.slice(-2)}` };
        if (pricingRow) {
          if (pricingRow.row) u.pricing[pricingRow.key] = pricingRow.row;
          else delete u.pricing[pricingRow.key];
        }
        s.version++;
        return { upstream: structuredClone(u), version: s.version };
      }
      if (method === "DELETE") {
        s.upstreams = s.upstreams.filter((x) => x !== u);
        s.version++;
        return { removed: u.id, name: u.name, routes: 1 + (q.includes("also=1") ? u.routes.length : 0) };
      }
    }
    if ((m = /^\/upstreams\/([^/]+)\/removal$/.exec(p))) {
      const u = find(decodeURIComponent(m[1]));
      return { id: u.id, name: u.name, prefix: u.prefix, routes: u.routes, last30: { requests: 1234, cost: 4.5 } };
    }
    if ((m = /^\/upstreams\/([^/]+)\/test$/.exec(p))) {
      const u = find(decodeURIComponent(m[1]));
      u.test = { ...s.test, at: 1_758_000_000_000 };
      return s.test;
    }
    if (p === "/providers") return { providers: s.catalogue, otherKinds: [] };
    if (p === "/providers/probe") return typeof s.probe === "function" ? s.probe(body) : s.probe;
    if (p === "/models") {
      const families = Object.entries(s.families).flatMap(([up, fs]) => fs.filter((f) => f.kind !== "other").map((f) => ({ ...f, upstream: up })));
      return { models: s.models, upstreams: s.info, families };
    }
    if (p === "/usage/days") return { total: { rows: s.usage } };
    if (p === "/subagents/slots" && method === "GET") return { default: null, most: 64, rows: structuredClone(s.slots) };
    if (p === "/subagents/slots" && method === "PUT") {
      const at = s.slots.find((r) => r.upstream === body.upstream && r.model === body.model);
      if (at) at.set = body.n;
      else s.slots.push({ upstream: body.upstream, model: body.model, name: body.model, set: body.n, cap: body.n, lowered: null, running: 0, waiting: 0, whom: [] });
      return { ok: true, default: null, most: 64, rows: structuredClone(s.slots) };
    }
    if (p === "/models/caps") {
      const id = body.upstream.id;
      return { models: s.cards[id] || [], families: s.families[id] || [], errors: [], agent: false };
    }
    if (p === "/models/ping") return s.ping;
    if (p === "/templates/qoder-cloud/apply") {
      s.upstreams.push(viewOf({ id: "qoder", name: "Qoder", type: "qoder", baseUrl: "https://qoder.example", provider: null, prefix: "qoder", key: { stored: false, masked: "" }, qoder: { signedIn: false, email: null, expiresAt: null } }));
      s.version++;
      return { ok: true };
    }
    if ((m = /^\/qoder\/([^/]+)\/login\/start$/.exec(p))) return { url: "https://qoder.example/device", nonce: "n1", userCode: "ABCD-1234" };
    if ((m = /^\/qoder\/([^/]+)\/login\/poll$/.exec(p))) {
      const next = s.qoderPolls.shift() || { status: "pending" };
      if (next.status === "ok") {
        const u = find(decodeURIComponent(m[1]));
        u.qoder = { signedIn: true, email: next.email, expiresAt: null };
        s.version++;
      }
      return next;
    }
    if ((m = /^\/qoder\/([^/]+)\/logout$/.exec(p))) {
      find(decodeURIComponent(m[1])).qoder = { signedIn: false, email: null, expiresAt: null };
      s.version++;
      return { ok: true };
    }
    throw apiError(404, { error: `the fake has no ${method} ${path}` });
  };
  return s;
}

/** A dialog that keeps what it was asked to show, and how it closed: "forced" past its guard, "asked" through it. */
export function recordingDialogs() {
  /** @type {any[]} */
  const shown = [];
  const dialog = (/** @type {any} */ d) => {
    const rec = {
      ...d,
      closed: /** @type {string | null} */ (null),
      /** @param {boolean} [force] */
      close(force) {
        if (rec.closed) return;
        if (!force && d.guard && !d.guard()) return;
        rec.closed = force ? "forced" : "asked";
        d.onClose?.();
      },
    };
    shown.push(rec);
    return rec;
  };
  return { dialog, shown };
}

/** Lets every answer already on its way land. */
export const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
export const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** Every node under `n` wearing a class. @param {any} n @param {string} cls */
export const every = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls));
/** The node under `n` a screen reader names so. @param {any} n @param {string} label */
export const named = (n, label) => all(n, (x) => x.attrs?.["aria-label"] === label)[0];
