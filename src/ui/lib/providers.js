// @ts-check
// The provider catalogue's words, for both faces (HarnessV4_Settings_Plan HS-D1): which entry and plan an address
// belongs to, how a plan's address is filled, how an upstream bills, a provider's prefix route and whether a prefix is
// free, and a family's variants in the picker's words. The console's "Add a provider" (pages/provider-add.js) and its
// Upstreams page draw from here, and so does the harness's Settings › Providers. A page never imports core: the
// catalogue arrives from GET /api/providers, and the pieces of core/providers.js a page needs are copied here and pinned
// against it by test/providers.test.js.
import { winWords } from "./model-caps.js";

/** @param {any} u */
const norm = (u) => String(u || "").trim().replace(/\/+$/, "").toLowerCase();
/** @param {string} s */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A plan address as a pattern: each `{field}` one host label or path segment. @param {string} tpl @param {string} hole */
const rxOf = (tpl, hole) => new RegExp(`^${norm(tpl).split(/\{\w+\}/).map(esc).join(hole)}$`);

/** The `{field}` names a plan's address asks for. @param {string} url @returns {string[]} */
export function placeholders(url) {
  return [...String(url || "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

/**
 * core/providers.js `providerForBaseUrl`, over the served catalogue: the entry and plan an address belongs to, or null
 * (the card then says "Custom").
 * @param {any[]} providers @param {string} url @returns {{ provider: any, plan: any } | null}
 */
export function providerFor(providers, url) {
  const want = norm(url);
  if (!want) return null;
  for (const provider of providers || []) for (const plan of provider.plans || []) if (rxOf(plan.baseUrl, "[a-z0-9-]+").test(want)) return { provider, plan };
  return null;
}

/**
 * core/pricing.js `billingOf`, for the provider card (no row): how this upstream bills, and who said so — its own
 * `billing`, else the catalogue plan its address is, else per token. A coding agent's card has no switch: it is a plan.
 * @param {{ billing?: string | null }} u @param {{ plan: { billing?: string } } | null} known  `providerFor`'s answer
 * @returns {{ billing: "metered" | "plan", source: "upstream" | "catalogue" | "default" }}
 */
export function billingAt(u, known) {
  if (u?.billing === "metered" || u?.billing === "plan") return { billing: u.billing, source: "upstream" };
  const b = known?.plan?.billing;
  if (b === "metered" || b === "plan") return { billing: b, source: "catalogue" };
  return { billing: "metered", source: "default" };
}

/**
 * core/providers.js `fillBaseUrl`: a plan's address with its fields filled in, or null while one is missing or could
 * move the request elsewhere (a dot, a slash, a colon).
 * @param {string} url @param {Record<string, string>} [fields]
 */
export function fillUrl(url, fields = {}) {
  let bad = false;
  const out = String(url || "").replace(/\{(\w+)\}/g, (_, k) => {
    const v = String(fields?.[k] ?? "").trim();
    if (!/^[A-Za-z0-9-]+$/.test(v)) bad = true;
    return v;
  });
  return bad ? null : out;
}

/** The field values an address holds for a plan's template, so switching region keeps the workspace. @param {string} tpl @param {string} url */
export function fieldsOf(tpl, url) {
  const names = placeholders(tpl);
  const m = names.length ? rxOf(tpl, "([a-z0-9-]+)").exec(norm(url)) : null;
  return m ? Object.fromEntries(names.map((n, i) => [n, m[i + 1]])) : {};
}

/**
 * A provider's prefix route (D1): its first enabled route shaped `P/*` → `{1}` — derived, never flagged. A route that
 * carries failover, rule overrides or a fixed format is the operator's own work and stays an ordinary route.
 * @param {any} cfg @param {string} upstreamId
 */
export function prefixRouteOf(cfg, upstreamId) {
  return (cfg?.routes || []).find((/** @type {any} */ r) =>
    r.upstream === upstreamId && r.enabled !== false && /^[^*]+\/\*$/.test(String(r.match || "")) && !String(r.match).startsWith("re:") &&
    r.upstreamModel === "{1}" && !(r.fallbacks || []).length && !Object.keys(r.rules || {}).length && (!r.format || r.format === "auto")) || null;
}

/**
 * Why a prefix cannot be a new provider's, in words, or "" when it can: an id's letters, not an upstream's id already,
 * and no route already catching names that start with it (the new route would take them from it).
 * @param {any} cfg @param {string} prefix
 */
export function prefixProblem(cfg, prefix) {
  const p = String(prefix || "").trim();
  if (!p) return "Type a prefix: the word your tools put before each model name.";
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(p)) return "A prefix is letters, digits, dashes or underscores, starting with a letter or digit.";
  const lower = p.toLowerCase();
  const up = (cfg?.upstreams || []).find((/** @type {any} */ u) => String(u.id).toLowerCase() === lower);
  if (up) return `${p} is already the id of ${up.name || up.id}: pick another prefix.`;
  const r = (cfg?.routes || []).find((/** @type {any} */ x) => String(x.match || "").toLowerCase().startsWith(`${lower}/`));
  if (r) return `The route ${r.match} already catches names starting with ${p}/: pick another prefix.`;
  return "";
}

/** A free prefix near the one wanted: the entry's own, else with -2, -3… @param {any} cfg @param {string} want */
export function freePrefix(cfg, want) {
  if (!want) return "";
  for (let n = 1; n < 50; n++) {
    const p = n === 1 ? want : `${want}-${n}`;
    if (!prefixProblem(cfg, p)) return p;
  }
  return want;
}

/** A prefix for an address the catalogue does not know: its host's name (api.example.com → example; this machine → local). @param {string} url */
export function hostWord(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":")) return "local";
    const parts = host.split(".").filter((x) => !["api", "www", "integrate", "inference", "gateway"].includes(x));
    return (parts.length >= 2 ? parts[parts.length - 2] : parts[0] || "").replace(/[^a-z0-9_-]/g, "") || "provider";
  } catch {
    return "";
  }
}

/**
 * Why an extra header that keeps its stored value keeps its name, on either face: the store finds the value by the name
 * it was stored under, and refuses a save that holds it under another. @param {string} name
 */
export const keptHeaderWords = (name) => `${name} keeps its stored value under its own name: give it a new value to rename it, or remove it and add it again`;

/** The tiles for addresses the catalogue does not know; their address is typed. */
export const CUSTOM = Object.freeze([
  { id: "custom-openai", custom: true, name: "Custom OpenAI-compatible", type: "openai-compatible", prefix: "", blurb: "Any server with /v1/chat/completions or /v1/responses: a gateway, a router, a local server.", plans: [{ id: "custom", label: "Custom", baseUrl: "", billing: "metered" }] },
  { id: "custom-anthropic", custom: true, name: "Custom Anthropic-compatible", type: "anthropic-compatible", prefix: "", blurb: "A gateway, proxy or local router that speaks the Anthropic Messages API.", plans: [{ id: "custom", label: "Custom", baseUrl: "", billing: "metered" }] },
]);

/** @param {string} s */
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** A family's variants in the picker's words, each once: Low–High, Fast, Flex, Thinking, 1M. @param {any} f @returns {string[]} */
export function variantWords(f) {
  /** @type {string[]} */
  const out = [];
  const lv = f?.effort?.levels || [];
  if (lv.length) out.push(lv.length > 1 ? `${cap(lv[0])}–${cap(lv[lv.length - 1])}` : cap(lv[0]));
  for (const s of f?.speed?.options || []) if (s !== "standard") out.push(cap(s));
  if ((f?.thinking?.options || []).includes("on")) out.push("Thinking");
  for (const n of f?.window?.options || []) if (n) out.push(winWords(n));
  return out;
}
