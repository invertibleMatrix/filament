// @ts-check
// The provider catalogue (HarnessV3-Providers D2, P1): the providers "Add a provider" knows, as pure data. Each entry
// knows its addresses (one per plan or region), how it is billed there, its type, the prefix its models are asked
// for under, where its key comes from, and the capability hints its model rows start with. What makes "paste a key"
// enough — Z.AI's /v4 base, Gemini's full endpoint, DashScope's workspace host — lives here, so nobody learns it the
// hard way. Every address was checked against the provider's own documentation on 2026-10-01 (HarnessV3 §17).
// The dashboard reads it through GET /api/providers; the probe (POST /api/providers/probe) reads it here.

/**
 * @typedef {{ id: string, label: string, baseUrl: string, billing: "metered" | "plan", modelsPath?: string,
 *   keyUrl?: string, note?: string }} ProviderPlan
 * @typedef {{ id: string, label: string, placeholder?: string, hint?: string }} ProviderField
 * @typedef {{
 *   id: string, name: string, type: "openai-compatible" | "anthropic-compatible" | "openai" | "anthropic",
 *   plans: ProviderPlan[], prefix: string, blurb: string, keyless?: boolean, keyUrl?: string, docsUrl?: string,
 *   fields?: ProviderField[], hints?: Record<string, Record<string, any>>, otherKinds?: string, pickNone?: boolean,
 *   route?: { discoverPrefixes?: string[] }
 * }} Provider
 */

/** Model ids that are not chat models: embeddings, rerankers, speech, images, moderation. A catalogue entry may say
 *  its own (`otherKinds`); this is everyone else's. */
export const OTHER_KINDS = "(embed|embedding|rerank|tts|whisper|speech|image|dall-e|moderation)";

/** A plan's address may carry a `{field}` the Connect step asks for (DashScope's workspace). */
const WORKSPACE = /** @type {ProviderField} */ ({ id: "workspace", label: "Workspace ID", placeholder: "ws-…", hint: "Model Studio → your workspace's details" });

/** @type {readonly Provider[]} */
export const PROVIDERS = deepFreeze([
  {
    id: "zai", name: "Z.AI (GLM)", type: "openai-compatible", prefix: "zai",
    blurb: "GLM models from Zhipu. The coding plan is a subscription; the API bills per token.",
    keyUrl: "https://z.ai/manage-apikey/apikey-list", docsUrl: "https://docs.z.ai/devpack/quick-start",
    plans: [
      { id: "coding", label: "Coding plan", baseUrl: "https://api.z.ai/api/coding/paas/v4", billing: "plan" },
      { id: "api", label: "API", baseUrl: "https://api.z.ai/api/paas/v4", billing: "metered" },
      { id: "china", label: "China (BigModel)", baseUrl: "https://open.bigmodel.cn/api/paas/v4", billing: "metered", keyUrl: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys" },
    ],
  },
  {
    id: "kimi", name: "Kimi (Moonshot)", type: "openai-compatible", prefix: "kimi",
    blurb: "Kimi models. Kimi Code is a subscription; the Moonshot platform bills per token.",
    keyUrl: "https://www.kimi.com/code", docsUrl: "https://platform.kimi.ai",
    plans: [
      { id: "code", label: "Kimi Code plan", baseUrl: "https://api.kimi.com/coding/v1", billing: "plan" },
      { id: "global", label: "Moonshot global", baseUrl: "https://api.moonshot.ai/v1", billing: "metered", keyUrl: "https://platform.kimi.ai/console/api-keys" },
      { id: "china", label: "Moonshot China", baseUrl: "https://api.moonshot.cn/v1", billing: "metered", keyUrl: "https://platform.kimi.com/console/api-keys" },
    ],
  },
  {
    id: "xai", name: "xAI (Grok)", type: "openai-compatible", prefix: "xai",
    blurb: "Grok models, billed per token. States what each reply cost.",
    keyUrl: "https://console.x.ai", docsUrl: "https://docs.x.ai",
    plans: [{ id: "api", label: "API", baseUrl: "https://api.x.ai/v1", billing: "metered" }],
    // Priority processing is xAI's fast mode, asked for with a request field (the tune sheet's fastParams); whether a
    // model has it is still the operator's to switch on.
    hints: { "grok-": { fastParams: { service_tier: "priority" } } },
  },
  {
    id: "nvidia", name: "NVIDIA NIM", type: "openai-compatible", prefix: "nvidia",
    blurb: "Open models hosted by NVIDIA.",
    keyUrl: "https://build.nvidia.com/settings/api-keys", docsUrl: "https://docs.api.nvidia.com",
    plans: [{ id: "api", label: "API", baseUrl: "https://integrate.api.nvidia.com/v1", billing: "metered" }],
  },
  {
    id: "neuralwatt", name: "Neuralwatt", type: "openai-compatible", prefix: "neuralwatt",
    blurb: "Open models hosted by Neuralwatt.",
    keyUrl: "https://portal.neuralwatt.com",
    plans: [{ id: "api", label: "API", baseUrl: "https://api.neuralwatt.com/v1", billing: "metered" }],
  },
  {
    id: "deepseek", name: "DeepSeek", type: "openai-compatible", prefix: "deepseek",
    blurb: "DeepSeek's own models, billed per token.",
    keyUrl: "https://platform.deepseek.com/api_keys", docsUrl: "https://api-docs.deepseek.com",
    plans: [{ id: "api", label: "API", baseUrl: "https://api.deepseek.com", billing: "metered" }],
  },
  {
    id: "openrouter", name: "OpenRouter", type: "openai-compatible", prefix: "openrouter",
    blurb: "Hundreds of models from many providers behind one key.",
    keyUrl: "https://openrouter.ai/settings/keys", docsUrl: "https://openrouter.ai/docs",
    plans: [{ id: "api", label: "API", baseUrl: "https://openrouter.ai/api/v1", billing: "metered" }],
    pickNone: true,
  },
  {
    id: "groq", name: "Groq", type: "openai-compatible", prefix: "groq",
    blurb: "Open models on Groq's fast inference hardware.",
    keyUrl: "https://console.groq.com/keys", docsUrl: "https://console.groq.com/docs",
    plans: [{ id: "api", label: "API", baseUrl: "https://api.groq.com/openai/v1", billing: "metered" }],
  },
  {
    id: "minimax", name: "MiniMax", type: "openai-compatible", prefix: "minimax",
    blurb: "MiniMax's own models.",
    keyUrl: "https://platform.minimax.io/console/access", docsUrl: "https://platform.minimax.io/docs",
    plans: [
      { id: "global", label: "Global", baseUrl: "https://api.minimax.io/v1", billing: "metered" },
      { id: "china", label: "China", baseUrl: "https://api.minimax.cn/v1", billing: "metered" },
    ],
  },
  {
    id: "mistral", name: "Mistral", type: "openai-compatible", prefix: "mistral",
    blurb: "Mistral's own models, billed per token.",
    keyUrl: "https://console.mistral.ai/api-keys", docsUrl: "https://docs.mistral.ai",
    plans: [{ id: "api", label: "API", baseUrl: "https://api.mistral.ai/v1", billing: "metered" }],
  },
  {
    id: "together", name: "Together", type: "openai-compatible", prefix: "together",
    blurb: "Open models hosted by Together AI.",
    keyUrl: "https://api.together.ai/settings/api-keys", docsUrl: "https://docs.together.ai",
    plans: [{ id: "api", label: "API", baseUrl: "https://api.together.ai/v1", billing: "metered" }],
  },
  {
    id: "fireworks", name: "Fireworks", type: "openai-compatible", prefix: "fireworks",
    blurb: "Open models hosted by Fireworks AI.",
    keyUrl: "https://app.fireworks.ai/account/api-keys", docsUrl: "https://docs.fireworks.ai",
    plans: [{ id: "api", label: "API", baseUrl: "https://api.fireworks.ai/inference/v1", billing: "metered" }],
  },
  {
    id: "gemini", name: "Google Gemini", type: "openai-compatible", prefix: "gemini",
    blurb: "Gemini models through Google's OpenAI-compatible endpoint.",
    keyUrl: "https://aistudio.google.com/apikey", docsUrl: "https://ai.google.dev/gemini-api/docs/openai",
    // Google's compatible base is …/v1beta/openai/: without a /vN at its end Filament would append /v1/chat/completions,
    // so the address is the full endpoint and the list is named in full.
    plans: [{
      id: "api", label: "API", billing: "metered",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      modelsPath: "https://generativelanguage.googleapis.com/v1beta/openai/models",
    }],
    // A listing that spells its ids models/gemini-… is also advertised by the bare name, which the endpoint takes.
    route: { discoverPrefixes: ["models"] },
  },
  {
    id: "dashscope", name: "Qwen (Alibaba Model Studio)", type: "openai-compatible", prefix: "qwen",
    blurb: "Qwen models on Alibaba Cloud Model Studio (DashScope).",
    keyUrl: "https://modelstudio.console.alibabacloud.com", docsUrl: "https://www.alibabacloud.com/help/en/model-studio",
    fields: [WORKSPACE],
    plans: [
      { id: "singapore", label: "Singapore", baseUrl: "https://{workspace}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", billing: "metered" },
      { id: "us", label: "US (Virginia)", baseUrl: "https://dashscope-us.aliyuncs.com/compatible-mode/v1", billing: "metered" },
      { id: "hongkong", label: "Hong Kong", baseUrl: "https://{workspace}.cn-hongkong.maas.aliyuncs.com/compatible-mode/v1", billing: "metered" },
      { id: "tokyo", label: "Tokyo", baseUrl: "https://{workspace}.ap-northeast-1.maas.aliyuncs.com/compatible-mode/v1", billing: "metered" },
    ],
  },
  {
    id: "openai", name: "OpenAI", type: "openai", prefix: "openai",
    blurb: "GPT models with your own OpenAI API key.",
    keyUrl: "https://platform.openai.com/api-keys", docsUrl: "https://platform.openai.com/docs",
    plans: [{ id: "api", label: "API", baseUrl: "https://api.openai.com", billing: "metered" }],
  },
  {
    id: "anthropic", name: "Anthropic", type: "anthropic", prefix: "anthropic",
    blurb: "Claude with your own Anthropic API key. Its model list states each model's reasoning and thinking.",
    keyUrl: "https://platform.claude.com/settings/keys", docsUrl: "https://docs.claude.com",
    plans: [{ id: "api", label: "API", baseUrl: "https://api.anthropic.com", billing: "metered" }],
  },
  {
    id: "ollama", name: "Ollama", type: "openai-compatible", prefix: "ollama", keyless: true,
    blurb: "Models running on this machine through Ollama. No key.",
    docsUrl: "https://ollama.com/download",
    plans: [{ id: "local", label: "This machine", baseUrl: "http://localhost:11434/v1", billing: "plan" }],
  },
  {
    id: "lmstudio", name: "LM Studio", type: "openai-compatible", prefix: "lmstudio", keyless: true,
    blurb: "Models running on this machine through LM Studio's server. No key.",
    docsUrl: "https://lmstudio.ai",
    plans: [{ id: "local", label: "This machine", baseUrl: "http://localhost:1234/v1", billing: "plan" }],
  },
]);

/** @template T @param {T} v @returns {T} */
function deepFreeze(v) {
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

/** @param {string} id @returns {Provider | null} */
export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}

/** The plan asked for, or the provider's first (its default). @param {Provider | null} provider @param {string} [planId] */
export function planOf(provider, planId) {
  if (!provider) return null;
  return provider.plans.find((p) => p.id === planId) || provider.plans[0];
}

/** The `{field}` names a plan's address asks for. @param {string} url @returns {string[]} */
export function placeholdersOf(url) {
  return [...String(url || "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

/**
 * A plan's address with its fields filled in, or null while one is missing. A value is one host label or path
 * segment: anything that could move the request elsewhere (a dot, a slash, a colon) is refused.
 * @param {string} url @param {Record<string, string>} [fields]
 */
export function fillBaseUrl(url, fields = {}) {
  let bad = false;
  const out = String(url || "").replace(/\{(\w+)\}/g, (_, k) => {
    const v = String(fields?.[k] ?? "").trim();
    if (!/^[A-Za-z0-9-]+$/.test(v)) bad = true;
    return v;
  });
  return bad ? null : out;
}

const norm = (/** @type {string} */ u) => String(u || "").trim().replace(/\/+$/, "").toLowerCase();
const rxOf = (/** @type {string} */ tpl) => new RegExp(`^${norm(tpl).split(/\{\w+\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[a-z0-9-]+")}$`);

/**
 * The catalogue entry and plan an upstream's address belongs to (the card's badge and plan picker), or null for an
 * address the catalogue does not know — that one stays "Custom". A trailing slash and letter case do not matter; a
 * plan's `{workspace}` matches any one host label.
 * @param {string} url
 * @returns {{ provider: Provider, plan: ProviderPlan } | null}
 */
export function providerForBaseUrl(url) {
  const want = norm(url);
  if (!want) return null;
  for (const provider of PROVIDERS)
    for (const plan of provider.plans) if (rxOf(plan.baseUrl).test(want)) return { provider, plan };
  return null;
}

/** Whether a listed id is not a chat model (set apart as "Other models"). @param {Provider | null} provider @param {string} id */
export function isOtherModel(provider, id) {
  return new RegExp(provider?.otherKinds || OTHER_KINDS, "i").test(String(id || ""));
}

/**
 * A provider's prefix route (HarnessV3-Providers D1): its first enabled route shaped `P/*` → `{1}` — derived, never
 * flagged. A route that carries failover, rule overrides or a fixed format is the operator's own work and stays an
 * ordinary route. The pages' copy (ui/lib/providers.js) is pinned against this one by test/providers.test.js.
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
