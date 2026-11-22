// Templates: documented presets. Applying a template merges its patch into the config; each template
// explains what it does and the effect of each part so you can apply it without hand-editing parameters.
import { CURSOR_SDK, CURSOR_SDK_OFF, KNOWN_AGENTS, agentUpstream, agentRoute, catalogueUpstream, cursorSdkOn, installCommand, QODER_MODELS, viaRegistry } from "../../core/catalogues.js";

export const TEMPLATES = [
  {
    id: "cursor-sdk",
    name: "Cursor through the official SDK (API key)",
    summary:
      "A second way to run Cursor's agent, next to Cursor (its CLI over ACP): the official @cursor/sdk inside Filament's process, with your Cursor API key. Offered where Settings › Experimental › Cursor through its SDK is on.",
    effects: [
      "New upstream `cursor-sdk` (type Cursor SDK). Paste a Cursor API key from cursor.com/dashboard → Integrations → API keys on the Upstreams page; a user key bills your Cursor plan like the IDE does.",
      "Route `cursor-sdk/*` → that upstream: `cursor-sdk/grok-4.6-xhigh`, `cursor-sdk/composer-2.5-fast`, `cursor-sdk/auto`; add `@plan` for plan mode.",
      "Needs `npm install -g @cursor/sdk` once (about 50 MB); the upstream's card has an Install button. Filament works without it and says so when it is missing.",
      "Set client bridge `full` on the upstream to replace Cursor's read/edit/shell/delete with Filament's tools running through your chat tool.",
    ],
    patch: {
      upstreams: [catalogueUpstream(CURSOR_SDK, { enabled: true })],
      routes: [agentRoute(CURSOR_SDK, { enabled: true })],
    },
  },
  {
    id: "claude-visible-thinking",
    name: "Claude: visible thinking, real effort",
    summary:
      "Fixes the two things routers and old SDKs get wrong on Fable / Opus 5 / Sonnet 5: empty thinking text and downgraded effort.",
    effects: [
      "Legacy `thinking: enabled + budget_tokens` becomes `adaptive` (avoids HTTP 400 on adaptive-only models).",
      "`thinking.display` is set to `summarized`, so the agent shows the model's reasoning summary instead of blank blocks.",
      "Effort is taken from a `-xhigh`/`-max` model suffix first, then from what the agent sent, and is never silently clamped below what the model supports.",
      "`redact-thinking-2026-02-12` is removed from the beta header (it blanks thinking text).",
      "Sampling parameters that Opus 4.7+ rejects are removed.",
    ],
    patch: {
      rules: {
        thinking: {
          mode: "client",
          legacyToAdaptive: true,
          display: "summarized",
          respectClientDisplay: false,
        },
        effort: { sources: ["suffix", "client", "default"], default: "none", onUnsupported: "clamp" },
        headers: { anthropicBetaRemove: ["redact-thinking-2026-02-12"] },
      },
    },
  },
  {
    id: "direct-anthropic",
    name: "Direct to Anthropic",
    summary: "Talk to api.anthropic.com yourself, with prompt caching ensured and no router in between.",
    effects: [
      "New upstream `anthropic` (paste your Anthropic key).",
      "Route `claude-*` -> Anthropic.",
      "Cache markers are added on the system prompt and the last user message when the agent sent none, so long sessions reuse the cached prefix.",
      "Streams are forced on to avoid HTTP timeouts on long thinking turns; the reply is converted back if the agent asked for JSON.",
    ],
    requires: ["claude-visible-thinking"],
    patch: {
      upstreams: [
        {
          id: "anthropic",
          name: "Anthropic",
          type: "anthropic",
          baseUrl: "https://api.anthropic.com",
          apiKey: "",
          authStyle: "x-api-key",
          rules: { cache: { ensureBreakpoints: "system-and-last-user" }, params: { forceStream: "on" } },
        },
      ],
      routes: [{ match: "claude-*", upstream: "anthropic", upstreamModel: "{model}", format: "anthropic" }],
    },
  },
  // One template per known coding agent (Cursor, Qoder, Claude Code over ACP; Codex over its app-server): upstream +
  // route. Not one Filament installs itself (Antigravity): Settings → Coding agents downloads and connects it.
  ...KNOWN_AGENTS.filter((a) => !viaRegistry(a)).map((a) => ({
    id: a.type === "codex" ? a.id : `${a.id}-via-acp`,
    name: `${a.name.replace(" (agent via ACP)", "")} as a model (via its CLI, ${a.type === "codex" ? "app-server" : "ACP"})`,
    summary: `Use ${a.name.replace(" (agent via ACP)", "")}'s own agent and models from any chat client. The agent does the work with its own tools in your project folder; Filament relays the conversation.`,
    effects: [
      `New upstream \`${a.id}\` of type ${a.type === "codex" ? "Codex" : "ACP agent"} running \`${[a.command, ...a.args].join(" ")}\`. Install: ${installCommand(a, process.platform)?.line}`,
      `Route \`${a.prefix}/*\` -> that upstream: ask for \`${a.prefix}/<model id>\`; the agent's model list is discovered automatically and shown on the Overview.`,
      "The working directory is taken from the client's system prompt (`Working directory: …`, what Claude Code sends), so the agent edits the project you have open.",
      `Default mode \`${a.mode}\`; switch per message with \`@plan\`, \`@ask\`, \`@agent\` or the agent's own mode ids. Tool prompts are auto-approved (\`permissions = allow-all\`).`,
      "Reasoning is shown as thinking blocks; one short line per tool call tells you what the agent did.",
      a.notes,
    ],
    patch: {
      upstreams: [agentUpstream({ ...a, installed: true })],
      routes: [agentRoute({ ...a, installed: true })],
    },
  })),
  {
    id: "qoder-cloud",
    name: "Qoder cloud models (your Qoder account, no CLI)",
    summary:
      "Talk to Qoder's cloud models (Qwen, Kimi, GLM, DeepSeek, MiniMax and Qoder's own tiers) directly with your Qoder account, the way 9router's `qd/*` provider did. Plain chat completions with tools; no agent, no working directory. For a qoder.cn (China) account, set region to china — the login page and every endpoint follow it.",
    effects: [
      "New upstream `qoder-cloud` of type Qoder cloud. Log in on the Upstreams page with “Log in with Qoder” (browser, PKCE device flow) or paste a personal token (pt-…, from qoder.com/account/integrations — qoder.cn in China) as the API key.",
      "Route `qd/*` -> that upstream: `qd/lite`, `qd/qmodel_38max`, `qd/kmodel_latest`, `qd/gmodel`, `qd/dmodel`, … The live model list from your account replaces the built-in one once logged in.",
      "Requests are sent in Qoder's own signed protocol; Anthropic-format clients are translated automatically (Qoder speaks OpenAI shapes).",
      "Uses your Qoder credits; quota is shown on the upstream card. Pasted images are uploaded to Qoder's image service and referenced by URL (small ones inline if the upload fails).",
    ],
    patch: {
      upstreams: [
        {
          id: "qoder-cloud",
          name: "Qoder cloud",
          type: "qoder",
          baseUrl: "",
          apiKey: "",
          authStyle: "auto",
          discoverModels: true,
          models: QODER_MODELS.map(([id]) => id),
          qoder: { authMethod: "device" },
        },
      ],
      routes: [{ match: "qd/*", upstream: "qoder-cloud", upstreamModel: "{1}", format: "auto" }],
    },
  },
  {
    id: "anthropic-compatible-provider",
    name: "Anthropic-compatible provider or gateway",
    summary:
      "Forward Anthropic-format requests to any server that implements `/v1/messages` at its own address, with the same Claude fixes as the direct route.",
    effects: [
      "New upstream `anthropic-compat` (set its base URL and key on the Upstreams page).",
      "Route `compat/claude-*` -> that upstream as `claude-{1}`, so `compat/claude-sonnet-5` reaches it as `claude-sonnet-5`. Rename the prefix if you like.",
      "Visible-thinking and effort fixes apply; cache markers are preserved.",
    ],
    requires: ["claude-visible-thinking"],
    patch: {
      upstreams: [
        {
          id: "anthropic-compat",
          name: "Anthropic-compatible gateway",
          type: "anthropic-compatible",
          baseUrl: "",
          apiKey: "",
          authStyle: "x-api-key",
        },
      ],
      routes: [
        {
          match: "compat/claude-*",
          upstream: "anthropic-compat",
          upstreamModel: "claude-{1}",
          format: "anthropic",
        },
      ],
    },
  },
  {
    id: "openai-compatible-passthrough",
    name: "OpenAI-compatible provider, minimal touch",
    summary:
      "Forward OpenAI-format requests to any OpenAI-compatible server (GLM, Kimi, DeepSeek, local servers) while keeping usage visible.",
    effects: [
      "New upstream `openai-compat` (set its base URL and key).",
      "Route `*` (lowest priority; put it last) -> that upstream.",
      "`stream_options.include_usage` is added so token usage shows up on streams.",
      "No thinking or effort rewriting beyond the effort suffix, which many of these servers accept as `reasoning_effort`.",
    ],
    patch: {
      upstreams: [
        {
          id: "openai-compat",
          name: "OpenAI-compatible",
          type: "openai-compatible",
          baseUrl: "http://localhost:7001",
          apiKey: "",
          authStyle: "bearer",
          rules: { params: { openaiIncludeUsage: true } },
        },
      ],
      routes: [{ match: "*", upstream: "openai-compat", upstreamModel: "{model}", format: "openai" }],
    },
  },
  {
    id: "effort-presets",
    name: "Effort by model suffix (low / medium / high / xhigh / max)",
    summary:
      "Lets any agent pick effort by model name, e.g. `claude-opus-5-max`, even if the agent has no effort setting.",
    effects: [
      "Suffix wins over the agent's own effort value.",
      "Suffix is stripped before forwarding (providers 404 on suffixed names).",
      "Default when neither suffix nor agent gives a value: `high`.",
    ],
    patch: {
      rules: { effort: { sources: ["suffix", "client", "default"], default: "high", stripSuffix: true } },
    },
  },
  {
    id: "cost-guard",
    name: "Cost guard",
    summary: "Caps effort at `high`, caps `max_tokens`, and keeps caching on. Good default for routine work.",
    effects: [
      "`max` and `xhigh` are clamped to `high` (measurably cheaper on long agent sessions).",
      "`max_tokens` is capped at 32000 per response.",
      "Cache markers ensured so repeated context is billed at cache-read rates.",
    ],
    patch: {
      rules: {
        effort: { allowed: ["low", "medium", "high"], onUnsupported: "clamp" },
        params: { maxTokensMax: 32000 },
        cache: { ensureBreakpoints: "system-and-last-user" },
      },
    },
  },
  {
    id: "max-quality",
    name: "Maximum quality",
    summary:
      "Always send effort `max` on Claude unless the agent explicitly picked something else, stream everything, never clamp.",
    effects: [
      "Default effort `max`; agent or suffix can still choose lower.",
      "`onUnsupported = clamp` still protects models that lack `max`/`xhigh`.",
      "Streams forced on so long turns cannot hit HTTP timeouts.",
    ],
    patch: {
      rules: {
        effort: { default: "max", allowed: ["low", "medium", "high", "xhigh", "max"] },
        params: { forceStream: "on" },
      },
    },
  },
  {
    id: "full-observability",
    name: "Full observability",
    summary:
      "Debugging mode: store the inbound and shaped request bodies (whole conversations) for every call.",
    effects: [
      "`storeBodies = full` (inbound + shaped, secrets redacted). Long agent sessions are megabytes per request, so the log file grows fast; the per-request cap still applies.",
      "Keep the last 2000 requests in memory for the UI.",
      "Switch back to `summary-logging` when done.",
    ],
    patch: { observability: { storeBodies: "full", keepLastRequests: 2000 } },
  },
  {
    id: "summary-logging",
    name: "Summary logging (default)",
    summary:
      "Keep what matters per request without the conversation: what came in, what went out, and every change made.",
    effects: [
      "`storeBodies = summary`: model in/out, thinking in/out, effort in/out, stream flag, message and tool counts, system size, cache markers, bytes, headers sent, changes list.",
      "No message content is stored, so the log stays small even for very long sessions.",
      "Keep the last 500 requests in memory.",
    ],
    patch: { observability: { storeBodies: "summary", keepLastRequests: 500 } },
  },
  {
    id: "quiet-logging",
    name: "Quiet logging",
    summary: "Metadata and token usage only, nothing about request contents.",
    effects: [
      "`storeBodies = none`: timing, status, tokens, cost and the changes list only.",
      "Keep the last 200 requests in memory.",
    ],
    patch: { observability: { storeBodies: "none", keepLastRequests: 200 } },
  },
];

export const getTemplate = (id) => TEMPLATES.find((t) => t.id === id) || null;

/**
 * The templates a config offers: Cursor's SDK's only where its Experimental switch is on (`cursorSdkOn`, the owner's of
 * 11-10).
 * @param {any} cfg
 */
export const templatesFor = (cfg) => (cursorSdkOn(cfg) ? TEMPLATES : TEMPLATES.filter((t) => t.id !== CURSOR_SDK.id));
/**
 * Why a template a config doesn't offer (`templatesFor`) is refused when applied by its id: Cursor's SDK's while its
 * switch is off. Null for one it offers, or none.
 * @param {any} cfg @param {any} t
 */
export const templateOffWhy = (cfg, t) => (t && !templatesFor(cfg).includes(t) ? CURSOR_SDK_OFF : null);

// Merge a template patch into a config. Upstreams/routes are matched by id/match and replaced or appended. An upstream
// replaced keeps its credentials as the template sets its own fields: its key, its sign-in (`qoder`'s tokens and
// account) and its agent's environment (`acp.env`) — the bug hunt of 10-30, SEC-6.
export function applyTemplate(cfg, template) {
  const out = structuredClone(cfg);
  const patch = template.patch || {};
  const deep = (dst, src) => {
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        dst[k] = dst[k] && typeof dst[k] === "object" && !Array.isArray(dst[k]) ? dst[k] : {};
        deep(dst[k], v);
      } else dst[k] = structuredClone(v);
    }
  };
  for (const key of ["rules", "server", "observability"])
    if (patch[key]) {
      out[key] = out[key] || {};
      deep(out[key], patch[key]);
    }
  for (const u of patch.upstreams || []) {
    const i = (out.upstreams || []).findIndex((x) => x.id === u.id);
    const existing = i >= 0 ? out.upstreams[i] : null;
    const merged = {
      ...(existing || {}),
      ...u,
      apiKey: u.apiKey || existing?.apiKey || "",
      rules: { ...(existing?.rules || {}), ...(u.rules || {}) },
      ...(u.qoder && existing?.qoder ? { qoder: { ...existing.qoder, ...u.qoder } } : {}),
      ...(u.acp && existing?.acp?.env ? { acp: { ...u.acp, env: { ...existing.acp.env, ...(u.acp.env || {}) } } } : {}),
    };
    if (i >= 0) out.upstreams[i] = merged;
    else (out.upstreams ||= []).push(merged);
  }
  for (const r of patch.routes || []) {
    const i = (out.routes || []).findIndex((x) => x.match === r.match && x.upstream === r.upstream);
    if (i >= 0) out.routes[i] = { ...out.routes[i], ...r };
    else (out.routes ||= []).push({ ...r });
  }
  // Keep catch-all routes last so specific ones keep priority.
  out.routes = [...(out.routes || [])].sort((a, b) => (a.match === "*") - (b.match === "*"));
  return out;
}
