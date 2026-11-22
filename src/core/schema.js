// Single source of truth for every configurable parameter.
// The settings UI, the docs generator, validation and the default config are all derived from this file,
// so every parameter carries a human explanation of what it does and what effect it has.
// The operation-log kinds come from op-kinds.js so the settings list, the System tab's chips and the recorder can never
// drift apart. op-kinds.js imports nothing, so this does not make a cycle.
import { OP_KINDS, OP_KIND_KEYS, DEFAULT_OP_KINDS } from "./op-kinds.js";

const p = (type, def, description, effect, extra = {}) => ({
  type,
  default: def,
  description,
  effect,
  ...extra,
});
const group = (doc, fields) => ({ _doc: doc, ...fields });

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
/** The efforts a sub-agent may be asked to run at (HarnessV4_Tasks E23-D5): a level, or `model` — none set, its model's own. */
export const SUBAGENT_EFFORTS = Object.freeze(["model", ...EFFORT_LEVELS]);

// Regexes that describe model families. Kept as plain strings so they are editable in the UI.
export const FAMILIES = {
  adaptiveOnly: "claude-(fable|mythos|opus-5|opus-4[-.]?[78]|sonnet-5)",
  rejectsDisabled: "claude-(fable|mythos)",
  noAdaptive: "claude-(haiku|sonnet-4[-.]?5|opus-4[-.]?[0-5]$|3[-.])",
  displayCapable: "claude-(fable|mythos|opus-5|opus-4[-.]?[678]|sonnet-5|sonnet-4[-.]?6)",
  noSampling: "claude-(fable|mythos|opus-5|opus-4[-.]?[78]|sonnet-5)",
  noXhigh: "claude-(opus|sonnet)-4[-.]?6",
  noEffort: "claude-(haiku|sonnet-4[-.]?5|opus-4[-.]?[0-5]$|3[-.])",
  fastMode: "claude-opus-(5([-.]5)?|4[-.]?8)$",
  longWindow: "claude-(opus-4[-.]?[78]|opus-5|sonnet-5|fable-5[-.]1)",
};

// ---------------------------------------------------------------------------------------------------
// Rules: how a request is reshaped before it leaves. Applied in layers: global defaults -> upstream
// overrides -> route overrides. Any field left undefined at a layer inherits from the layer below.
// ---------------------------------------------------------------------------------------------------
export const RULES = group(
  "Request shaping rules. Layered: global defaults, then per-upstream, then per-route overrides.",
  {
    thinking: group("How the Anthropic `thinking` parameter is sent upstream.", {
      mode: p(
        "enum",
        "client",
        "Which thinking configuration goes upstream.",
        "`client` keeps what the agent sent (after the fixes below). `adaptive` forces adaptive thinking. `disabled` forces thinking off (stripped on models that cannot disable it). `strip` removes the parameter so the model uses its own default.",
        { options: ["client", "adaptive", "disabled", "strip"] },
      ),
      legacyToAdaptive: p(
        "boolean",
        true,
        'Convert the legacy `{type:"enabled", budget_tokens}` shape into `{type:"adaptive"}` for adaptive-only models.',
        "Claude Opus 4.7+, Opus 5, Sonnet 5 and Fable reject `budget_tokens` with HTTP 400. Agents built on older SDKs still send the legacy shape; this makes them work.",
      ),
      adaptiveOnlyModels: p(
        "regex",
        FAMILIES.adaptiveOnly,
        "Model-name pattern for models that accept only adaptive thinking.",
        "Used by `legacyToAdaptive`. Extend it when new models ship.",
      ),
      rejectsDisabledModels: p(
        "regex",
        FAMILIES.rejectsDisabled,
        'Models that reject `thinking.type:"disabled"` (thinking is always on).',
        "For these the shim removes a `disabled` value instead of forwarding it, avoiding a 400.",
      ),
      noAdaptiveModels: p(
        "regex",
        FAMILIES.noAdaptive,
        'Models that do not accept `thinking.type:"adaptive"` at all (older Claude, Haiku 4.5).',
        "An adaptive request to these is converted to `enabled` with `fallbackBudgetTokens`, and `output_config.effort` is removed.",
      ),
      fallbackBudgetTokens: p(
        "number",
        16000,
        "Thinking budget used when converting adaptive thinking for `noAdaptiveModels`.",
        "Must be at least 1024 and less than `max_tokens`. Larger budgets cost more output tokens.",
      ),
      display: p(
        "enum",
        "summarized",
        "Value of `thinking.display` sent for models that support it.",
        "`summarized` makes the model return readable reasoning summaries (visible thinking in the agent). `omitted` (the API default on Fable, Opus 5, Sonnet 5, Opus 4.7+) returns empty thinking blocks even though thinking is still billed. `updates` returns short progress notes (beta, Fable only). `keep` sends whatever the agent sent.",
        { options: ["keep", "summarized", "omitted", "updates"] },
      ),
      displayModels: p(
        "regex",
        FAMILIES.displayCapable,
        "Models that accept `thinking.display`.",
        "Older models reject unknown thinking fields, so display is only added for matches.",
      ),
      respectClientDisplay: p(
        "boolean",
        false,
        "If the agent already set `thinking.display`, keep its value.",
        "Off means the shim's `display` setting always wins.",
      ),
      stripUnsignedHistory: p(
        "boolean",
        true,
        "Remove thinking blocks that have no signature from earlier assistant turns before forwarding to Anthropic.",
        "Such blocks come from ACP agents (Cursor) or other providers when you switch models mid-conversation; Anthropic rejects them with HTTP 400. Signed blocks are left alone, so the prompt cache is unaffected.",
      ),
    }),

    effort: group("How `output_config.effort` (Anthropic) or `reasoning_effort` (OpenAI) is chosen.", {
      sources: p(
        "array",
        ["suffix", "client", "default"],
        "Where the effort level comes from, in priority order; the first source that yields a value wins.",
        "`suffix` reads a `-low/-medium/-high/-xhigh/-max` ending on the requested model name. `client` uses the value the agent sent. `default` uses the `default` setting below.",
        { itemType: "enum", options: ["suffix", "client", "default"] },
      ),
      default: p(
        "enum",
        "none",
        "Effort used when no other source provides one.",
        "`none` sends no effort field (the model's own default, usually `high`). Higher effort means more thinking, better results on hard problems and more output tokens billed.",
        { options: ["none", ...EFFORT_LEVELS] },
      ),
      allowed: p(
        "array",
        [...EFFORT_LEVELS],
        "Effort levels the shim is allowed to send.",
        "Anything outside this list is handled per `onUnsupported`. Remove `max` here if you want a hard cost ceiling.",
        { itemType: "enum", options: EFFORT_LEVELS },
      ),
      onUnsupported: p(
        "enum",
        "clamp",
        "What to do when the chosen effort is not allowed for the model or by `allowed`.",
        "`clamp` picks the nearest lower allowed level. `drop` removes the field. `pass` sends it anyway (the provider may return 400).",
        { options: ["clamp", "drop", "pass"] },
      ),
      suffixes: p(
        "array",
        [...EFFORT_LEVELS],
        "Model-name suffixes recognized as effort selectors, e.g. `claude-opus-5-max`.",
        "Lets agents without an effort setting choose effort by picking a model name.",
        { itemType: "enum", options: EFFORT_LEVELS },
      ),
      stripSuffix: p(
        "boolean",
        true,
        "Remove the recognized effort suffix from the model name before matching routes and forwarding.",
        "On (default): `claude-opus-5-xhigh` matches `claude-*`, the upstream receives `claude-opus-5`, and xhigh becomes the effort. Off: the suffix still sets the effort, but the exact name is forwarded, for providers whose own model ids end in an effort word. Set it on a route or an upstream to keep the exact name only there (the route is still found with the suffix removed, so a `claude-*` route keeps matching). Coding agents such as Cursor always receive the exact name; no setting needed.",
      ),
      modelCaps: p(
        "list",
        [
          { match: FAMILIES.noXhigh, allowed: ["low", "medium", "high", "max"] },
          { match: FAMILIES.noEffort, allowed: [] },
        ],
        "Per-model-family limits on effort levels.",
        "Each entry is `{match: <regex>, allowed: [levels]}`. An empty list means the family accepts no effort field at all, so it is removed. Opus 4.6 and Sonnet 4.6 have no `xhigh`; Haiku 4.5 and Sonnet 4.5 have no effort. For one model at one provider, its row on the Upstreams page (`tune` → Reasoning) and then its provider's own listing (Anthropic's states each model's levels) come before these entries; `allowed` above still caps them all.",
        { itemShape: { match: "regex", allowed: "array" } },
      ),
      capWhenThinkingDisabled: p(
        "enum",
        "high",
        "Maximum effort to send when thinking is disabled.",
        "Opus 5 returns 400 for `xhigh`/`max` with thinking disabled. `none` disables the cap.",
        { options: ["none", "low", "medium", "high"] },
      ),
    }),

    resilience: group(
      "What happens when an upstream misbehaves: failover to the backups and cooldowns after failures.",
      {
        failover: p(
          "boolean",
          false,
          "Use the backup upstreams listed on a route when the first one fails or is out of quota.",
          "On: a request that gets 429 / 5xx / unreachable from the first upstream is retried on the next backup in priority order, and upstreams that just failed or report exhausted quota are tried last. Off (the default since 2026-11-09): only the first upstream of a route is ever used; backups are ignored until it is switched on. Switchable from Settings › Providers, the console's Home page and the tray card.",
        ),
        cooldownBaseSeconds: p(
          "number",
          10,
          "First cooldown after a retryable failure (429, 5xx, unreachable).",
          "Doubles with each consecutive failure (10, 20, 40 s …) and resets on the next success. A cooling-down upstream is tried last, not skipped, so a route with a single upstream still works.",
        ),
        cooldownMaxSeconds: p("number", 300, "Longest cooldown.", "Caps the doubling."),
      },
    ),

    autofit: group(
      "The context-fit stage that observes every request (the window, where it came from, the compaction line, the estimate and the verdict — on the request record, the meter and the widgets) and the /autofit command's defaults. Nothing here lets anything rewrite a request between a client and its provider: a request that does not fit goes out as it came, the provider's refusal reaches the client, and the person runs /autofit when they want the session compacted to fit (2026-09-28: the automatic ladder — proactive clearing, the reactive retry, the local 413 — was removed; its walking clear re-wrote the prompt cache every leg and cost a three-digit bill).",
      {
        margin: p(
          "number",
          0.85,
          "The /autofit command's margin: the share of the compaction line a fit holds.",
          "A fit summarizes the smallest prefix of oldest turns that lands the next request under this share of the compaction line (context.compaction.thresholdPercent of the window). The margin is what keeps the fit holding: the next many requests stay under it without another compaction, so the prompt cache survives. /autofit <30-95> overrides it per call.",
        ),
      },
    ),

    trim: group(
      "The slice pass: how a compaction summary too big for one call of its writer is read — in sequential slices sized from the writer's window, oldest first, each call carrying the summaries before it. A chat Filament runs falls to it where even its folded turns outgrow one call (Settings › Context names the writer).",
      {
        sliceBudgetFraction: p(
          "number",
          0.7,
          "Share of the summarizer's window one slice call may use.",
          "The rest is left for the summaries carried into that call and for its reply. Slices are sized **after** each call returns, from the summary it actually produced, so the count is discovered rather than guessed. Lower is safer on a provider that counts tokens differently than Filament does.",
        ),
        digestCapFraction: p(
          "number",
          0.3,
          "Share of the slice budget the carried summaries may take before they are recompressed.",
          "Carried summaries grow monotonically, so late in a long pass there would be no room left for content: past this share they are re-summarized into one rolling digest. That one call loses prompt-cache reuse (the carried prefix changes); between recompressions the prefix is append-only and caches normally.",
        ),
        sliceSummaryTokens: p(
          "number",
          1500,
          "The length each slice summary is asked for.",
          "The prompt asks for about 0.75x this in words. It is never a cap: the call asks for the most the summarizer can write inside its window (a reasoning model thinks inside the same room), and the summary is kept whole.",
        ),
        minSummaryPercent: p(
          "number",
          0.5,
          "Floor under one slice summary, as a percentage of the slice it condenses.",
          "Measured: a summarizer answered an 88,925-token slice with 51 tokens — three sentences for 86 messages — with HTTP 200, so the empty-reply guard passed it and half the conversation left the summary. Under this floor (never more than a quarter of `sliceSummaryTokens`) the slice is retried at half the size, at most 3 retries per pass, and the rest of the pass stays at the size that worked; a slice that cannot be split further is kept and marked **unusually short** in its heading. A cached summary under the floor is written again instead of reused. `0` disables the check.",
        ),
        maxSliceTokens: p(
          "number",
          100000,
          "Ceiling on ONE slice, in tokens — whatever the summarizer's window would allow.",
          "One summary condenses one slice to about `sliceSummaryTokens`, so a slice's size sets how much detail survives. Without a ceiling the slice budget is `0.7 × the model's context window`: a 1M window would make 700k-token slices, each condensed into one summary of some 1,100 words. More, smaller slices cost slightly more and keep more. `0` disables the ceiling and restores window-proportional sizing.",
        ),
        tailMessageCapChars: p(
          "number",
          24000,
          "Longest single message the summarizer reads.",
          "About 6,000 tokens. A longer tool result is clipped with a marker, the full bytes staying in the archive; a longer message of words alone (the summary an earlier compaction wrote, a long paste) is read whole, in pieces.",
        ),
      },
    ),

    translate: group(
      "Cross-format translation: an OpenAI-format request can reach an Anthropic upstream and vice versa. Filament converts the request, the reply and the stream; lossy steps are listed in the request record.",
      {
        mode: p(
          "enum",
          "auto",
          "Whether to translate when the client's format differs from the upstream's.",
          "`auto`: translate whenever the route's format or the upstream type requires it (an `anthropic` upstream reached from `/v1/chat/completions`, an `openai-compatible` one from `/v1/messages`). `never`: refuse such requests with a clear error.",
          { options: ["auto", "never"] },
        ),
        reasoning: p(
          "boolean",
          true,
          "Carry the model's reasoning across formats.",
          "Anthropic thinking text becomes OpenAI `reasoning_content` deltas; OpenAI `reasoning_content` becomes Anthropic `thinking` blocks (unsigned, so they are stripped again before any Anthropic model sees them). Off drops reasoning from translated replies.",
        ),
        openaiMaxTokensField: p(
          "enum",
          "max_tokens",
          "Field used for the length limit when translating to OpenAI format.",
          "`max_tokens` is understood by every OpenAI-compatible server; official OpenAI reasoning models prefer `max_completion_tokens`.",
          { options: ["max_tokens", "max_completion_tokens"] },
        ),
      },
    ),

    speed: group(
      "Fast mode: the same model served faster for a higher price. Anthropic's is `speed: \"fast\"` (up to 2.5x output speed for roughly double the price; research preview, Claude Opus 5.5, Opus 5 and Opus 4.8 only). Other providers ask for theirs with fields of their own — xAI's and OpenAI's priority processing is `service_tier: \"priority\"` — declared per model on the Upstreams page (`tune`: fast mode, its multiplier and its request fields). The harness offers it as the model.fast setting wherever it exists; Filament prices a fast request at the model's fastMultiplier. The other way is a flex tier (cheaper, slower; OpenAI's `service_tier: \"flex\"`), declared the same way on an OpenAI-format provider and offered as the model.flex setting — asked for with a `-flex` suffix, never together with fast mode (fast wins).",
      {
        mode: p(
          "enum",
          "client",
          "When to request fast mode.",
          '`client`: only when the agent asks (a `-fast` model suffix such as `claude-opus-5-fast`, or `speed: "fast"` in the request). `always`: every request to a supported model runs fast. `never`: fast requests are downgraded to standard speed.',
          { options: ["client", "always", "never"] },
        ),
        suffix: p(
          "boolean",
          true,
          "Recognize a `-fast` model-name suffix as a fast-mode request.",
          "Combines with effort suffixes in any order: `claude-opus-5-xhigh-fast` and `claude-opus-5-fast-xhigh` both work. The suffix is removed before forwarding. Cursor's own `-fast` model ids are unaffected because ACP routes use the full name. The same switch governs `-flex` (a flex-tier request), which is read only where the model declares a flex tier — elsewhere it stays part of the name.",
        ),
        models: p(
          "regex",
          FAMILIES.fastMode,
          "Models that accept Anthropic's fast mode (on an Anthropic-format upstream).",
          "Fast requests to any other model are downgraded to standard and noted in the changes list, instead of failing with HTTP 400. Not available through Bedrock, Vertex or Foundry. A model's own row on the Upstreams page wins over this pattern for that provider, either way — that is also where an OpenAI-format provider's fast mode is declared.",
        ),
        beta: p(
          "string",
          "fast-mode-2026-02-01",
          "Beta flag added to the `anthropic-beta` header when fast mode is sent.",
          "Anthropic requires it alongside the top-level `speed` field. Update if Anthropic renames the beta.",
        ),
      },
    ),

    params: group("Other request parameters.", {
      strip: p(
        "array",
        [],
        "Top-level request fields to always remove before forwarding.",
        "Use for fields an upstream rejects. Applied to every request on this layer.",
        { itemType: "string" },
      ),
      stripRules: p(
        "list",
        [{ match: FAMILIES.noSampling, strip: ["temperature", "top_p", "top_k"] }],
        "Per-model-family fields to remove.",
        "Each entry is `{match: <regex>, strip: [fields]}`. Claude Opus 4.7+, Opus 5, Sonnet 5 and Fable reject non-default sampling parameters with 400.",
        { itemShape: { match: "regex", strip: "array" } },
      ),
      maxTokensDefault: p(
        "number",
        null,
        "`max_tokens` to add when the agent did not send one.",
        "Anthropic requires `max_tokens`. Leave empty to forward as-is.",
      ),
      maxTokensMin: p(
        "number",
        null,
        "Raise `max_tokens` to at least this value.",
        "Useful for probes that send tiny limits (for example 16), which can end a thinking model's turn before any text. Leave empty to not touch it.",
      ),
      maxTokensMax: p(
        "number",
        null,
        "Lower `max_tokens` to at most this value.",
        "A cost ceiling per response. Leave empty for no ceiling.",
      ),
      forceStream: p(
        "enum",
        "client",
        "Streaming mode sent upstream.",
        "`client` keeps the agent's choice. `on` always streams (avoids HTTP timeouts on long thinking). `off` never streams. The response is converted back to what the agent asked for when they differ.",
        { options: ["client", "on", "off"] },
      ),
      openaiIncludeUsage: p(
        "boolean",
        true,
        "For OpenAI-format streams, ask the upstream to include a final usage chunk (`stream_options.include_usage`).",
        "Without it most OpenAI-compatible servers do not report token usage on streams, so the shim's usage view stays empty.",
      ),
    }),

    cache: group("Prompt caching (Anthropic `cache_control` markers).", {
      ensureBreakpoints: p(
        "enum",
        "system-and-last-user",
        "Add cache markers when the agent sent none.",
        "`system` marks the last system block. `system-and-last-user` also marks the last user message, which makes long tool-loop conversations reuse the cached prefix turn after turn, and the user message before the newest reply, where the request before put its mark, so a round of many calls at once still reads that cache past the provider's lookback. `off` never adds markers. Agents that manage caching themselves (Claude Code) are left alone when `respectClient` is on.",
        { options: ["off", "system", "system-and-last-user"] },
      ),
      respectClient: p(
        "boolean",
        true,
        "If the agent sent any `cache_control`, do not add or move markers.",
        "Prevents the shim from fighting an agent's own cache strategy.",
      ),
      ttl: p(
        "enum",
        "5m",
        "Cache lifetime requested on markers the shim adds.",
        "`1h` costs more to write but survives longer idle periods. Some accounts need the extended-cache-ttl beta for `1h`.",
        { options: ["5m", "1h"] },
      ),
      minSystemChars: p(
        "number",
        2000,
        "Only add a system marker when the system prompt is at least this many characters.",
        "Prefixes below the model's minimum cacheable size (1024 to 4096 tokens depending on model) are never cached, so marking them is pointless.",
      ),
    }),

    tools: group("Tool-use parameters.", {
      forcedToolChoice: p(
        "enum",
        "auto",
        "What to do with a forced `tool_choice` (`any` or a specific tool) on models that reject it.",
        'Claude Fable 5.1 and Mythos 5.1 return 400 for forced tool choice. `auto` rewrites it to `{type:"auto"}` (the model still almost always calls the tool; add an instruction in the prompt if it must). `pass` forwards it unchanged.',
        { options: ["auto", "pass"] },
      ),
      forcedToolChoiceModels: p(
        "regex",
        "claude-(fable|mythos)-5-1",
        "Models that reject forced tool choice.",
        "Only these are rewritten.",
      ),
    }),

    headers: group("Outbound HTTP headers.", {
      forwardResponse: p(
        "enum",
        "safe",
        "Which upstream response headers are passed back to the agent.",
        "`safe` forwards everything except connection-level and encoding headers, so rate-limit headers, request ids and provider extras reach the agent. `minimal` forwards only request id and retry-after.",
        { options: ["safe", "minimal"] },
      ),
      identity: p(
        "enum",
        "none",
        "How the shim presents itself to the upstream.",
        "`claude-code` sends the Claude Code user agent and `x-app: cli`. Routers such as 9router treat that client as trusted and pass the request through untouched instead of rewriting thinking and effort. `custom` uses `userAgent` below. `none` sends a plain Filament user agent.",
        { options: ["none", "claude-code", "custom"] },
      ),
      userAgent: p("string", "", "User agent for `identity: custom`.", "Sent as the `user-agent` header."),
      set: p(
        "map",
        {},
        "Headers to set on every upstream request (name to value).",
        "Overrides anything the shim would otherwise send for that name. Use for provider-specific requirements.",
        { itemType: "string" },
      ),
      remove: p(
        "array",
        [],
        "Header names to remove from the upstream request.",
        "Applied last, after everything else.",
        { itemType: "string" },
      ),
      anthropicBetaAdd: p(
        "array",
        [],
        "Beta flags to add to the `anthropic-beta` header.",
        "Merged with forwarded client flags; duplicates are removed.",
        { itemType: "string" },
      ),
      anthropicBetaRemove: p(
        "array",
        ["redact-thinking-2026-02-12"],
        "Beta flags to remove from the `anthropic-beta` header.",
        "`redact-thinking-2026-02-12` makes Anthropic return thinking blocks with empty text; removing it is what makes thinking visible.",
        { itemType: "string" },
      ),
      forwardClient: p(
        "array",
        ["anthropic-beta", "x-request-id", "x-session-id", "x-client-request-id"],
        "Inbound headers copied to the upstream request (allowlist).",
        "Authentication headers are never forwarded; the upstream's own credentials are used.",
        { itemType: "string" },
      ),
    }),
  },
);

// ---------------------------------------------------------------------------------------------------
// Upstreams: where requests can be sent.
// ---------------------------------------------------------------------------------------------------
// Order = the order of the type picker on the dashboard: the common cases first. `agent` marks a coding agent (it runs
// turns, not answers requests); `kind` is the short word the dashboard shows beside an upstream's name.
export const UPSTREAM_TYPES = {
  "openai-compatible": {
    label: "OpenAI-compatible server (OpenRouter, DeepSeek, GLM, Groq, Ollama, LM Studio, a gateway…)",
    baseUrl: "",
    formats: ["openai"],
    authStyle: "bearer",
  },
  "anthropic-compatible": {
    label: "Anthropic-compatible server (a gateway, a proxy, a local router…)",
    baseUrl: "",
    formats: ["anthropic"],
    authStyle: "x-api-key",
  },
  openai: {
    label: "OpenAI API (your own key)",
    baseUrl: "https://api.openai.com",
    formats: ["openai"],
    authStyle: "bearer",
  },
  anthropic: {
    label: "Anthropic API (your own key)",
    baseUrl: "https://api.anthropic.com",
    formats: ["anthropic"],
    authStyle: "x-api-key",
  },
  acp: {
    label: "ACP agent (Cursor CLI, Claude Code, Antigravity, Qoder…)",
    baseUrl: "acp://local",
    formats: ["anthropic", "openai"],
    authStyle: "none",
    local: true,
    keyless: true, // the agent brings its own login; there is no key to paste
    agent: true,
    kind: "coding agent",
  },
  codex: {
    label: "Codex (OpenAI's coding agent, your ChatGPT sign-in)",
    baseUrl: "codex://local",
    formats: ["anthropic", "openai"],
    authStyle: "none",
    local: true,
    keyless: true, // `codex login` signs Codex in; there is no key to paste
    agent: true,
    kind: "coding agent",
    // Codex's app-server, started from the agent settings every coding agent shares (`acp`). What it has no use for
    // stays off its form: it takes the model and the effort per turn, has no modes to alias, keeps its own tools and is
    // offered none of Filament's.
    agentDefaults: { command: "codex", args: ["app-server"] },
    unused: [
      "modelSelection",
      "effortTemplate",
      "authenticate",
      "modeAliases",
      "listModelsArgs",
      "nativeTools",
      "steering",
      "steeringPrompt",
      "nativePaging",
      "nativePageLines",
      "nativePageChars",
      "rawMessages",
      "mcpServers",
    ],
  },
  "cursor-sdk": {
    label: "Cursor SDK (official @cursor/sdk, API key)",
    baseUrl: "sdk://cursor",
    formats: ["anthropic", "openai"],
    authStyle: "none",
    local: true,
    agent: true,
    kind: "Cursor SDK",
  },
  qoder: {
    label: "Qoder cloud (account login or personal token)",
    baseUrl: "qoder://cloud",
    formats: ["openai"],
    authStyle: "none",
    builtin: true,
    signIn: true, // answers with the account login the Upstreams page fills (`qoder.accessToken`), or a token pasted as the key
    kind: "Qoder cloud",
  },
  // Another paired machine's models (the remote-agents plan's m-upstream): `machine` names it, as this machine keeps it
  // for its agents (services/machines); its address, pinned certificate and device token are read there at each call,
  // never kept here (adapters/providers/filament.js). Both wires, so a request goes in its client's own shape and is
  // translated once, by the machine that knows its model's provider.
  filament: {
    label: "Another machine's Filament (its models, by this machine's agents' device there)",
    baseUrl: "filament://machine",
    formats: ["anthropic", "openai"],
    authStyle: "none",
    machine: true,
    kind: "another machine",
  },
};
/** The upstream types that are coding agents — one fact, named once, in the table above. */
export const AGENT_TYPES = new Set(Object.entries(UPSTREAM_TYPES).filter(([, t]) => t.agent).map(([type]) => type));
/** @param {any} u an upstream config entry, or null */
export const isAgentUpstream = (u) => !!u && AGENT_TYPES.has(u.type);
/** @param {any} u an upstream config entry, or null: whether it is another machine's models (`filament`) */
export const isMachineUpstream = (u) => !!u && !!(/** @type {any} */ (UPSTREAM_TYPES)[u.type])?.machine;
/**
 * Whether the upstream `id` names is a coding agent's, switched on or off — routing's `findUpstream` finds none that is
 * off, and one switched on later is reached all the same. @param {any} cfg @param {string | null | undefined} id
 */
export const namesAgentUpstream = (cfg, id) => isAgentUpstream((cfg?.upstreams || []).find((/** @type {any} */ u) => u?.id === id));
/** Whether the upstream `id` names is another machine's models, switched on or off. @param {any} cfg @param {string | null | undefined} id */
export const namesMachineUpstream = (cfg, id) => isMachineUpstream((cfg?.upstreams || []).find((/** @type {any} */ u) => u?.id === id));
/**
 * An agent's account turned off by itself in Settings › Coding agents: off, and kept so (`acp.accountOff`). The mark on
 * an account switched on another way (the console's switch) is stale: that one is on.
 * @param {any} u an upstream config entry, or null
 */
export const accountIsOff = (u) => !!u && u.enabled === false && u.acp?.accountOff === true;

// Login state for upstreams of type `qoder` (filled by the “Log in with Qoder” flow; tokens are secrets).
export const QODER_AUTH = group(
  "Qoder account credentials. Filled automatically by the login flow on the Upstreams page; a personal token (pt-…) pasted as the API key works too.",
  {
    region: p(
      "enum",
      "international",
      "Which Qoder deployment this account belongs to.",
      "`international`: qoder.com, APIs on *.qoder.sh. `china`: qoder.cn, APIs on *.qoder.com.cn — the browser login opens qoder.cn and every request (chat, models, quota, token exchange) goes to the China endpoints. With both subscriptions, add one Qoder upstream per region (e.g. `qoder` and `qoder-cn`).",
      { options: ["international", "china"] },
    ),
    authMethod: p(
      "enum",
      "device",
      "How this upstream authenticates.",
      "`device`: browser login with your Qoder account (tokens stored here). `pat`: the personal access token in `apiKey` is exchanged for a short-lived job token on demand.",
      { options: ["device", "pat"] },
    ),
    accessToken: p(
      "secret",
      "",
      "Qoder access token from the device login.",
      "Obtained by the login flow; expires after roughly 30 days, then log in again.",
    ),
    refreshToken: p(
      "secret",
      "",
      "Refresh token from the device login, if Qoder issued one.",
      "Kept for future use; Qoder's CLI does not refresh device tokens either.",
    ),
    userId: p(
      "string",
      "",
      "Qoder user id the token belongs to.",
      "Required for request signing; set by the login flow.",
    ),
    machineId: p(
      "string",
      "",
      "Machine id presented to Qoder.",
      "Generated at login and reused so the account sees one device.",
    ),
    name: p("string", "", "Account display name.", "Informational; included in signed requests."),
    email: p("string", "", "Account email.", "Informational; included in signed requests."),
    expiresAt: p(
      "number",
      0,
      "Token expiry (ms since epoch).",
      "Shown on the Upstreams page; log in again when it passes.",
    ),
  },
);

// Settings for the coding agents (`acp`, `codex`, `cursor-sdk`): a local agent driven over the Agent Client Protocol,
// Codex's app-server or the Cursor SDK. A type's `unused` list names what it ignores.
export const ACP = group(
  "How Filament drives a local coding agent. The agent runs its own tools in your project folder; Filament only relays the conversation.",
  {
    command: p(
      "string",
      "agent",
      "Executable the agent runs as: it speaks ACP on stdio, or Codex's app-server protocol for a `codex` upstream.",
      "`agent` is Cursor CLI (Filament finds its real binary on Windows). Other ACP agents: `claude-agent-acp` (Claude Code), `qodercli`, Antigravity's `agy` (`antigravity` off Windows)… anything that implements the protocol. A `codex` upstream runs `codex`.",
    ),
    args: p(
      "array",
      ["acp"],
      "Arguments that put the executable into server mode.",
      "Cursor needs `acp`, Codex `app-server`. A `--model <id>` pair is added automatically per route model when `modelSelection` is `arg`.",
      { itemType: "string" },
    ),
    env: p(
      "map",
      {},
      "Extra environment variables for the agent process.",
      "For example `CURSOR_API_KEY` to authenticate without `agent login`. Qoder's CLI serves both deployments: `QODERCLI_SITE=cn` makes it use your qoder.cn account and endpoints; when the international and China CLIs are both installed, point `command` at the one whose account you want.",
      { itemType: "string" },
    ),
    envRemove: p(
      "array",
      [],
      "Inherited environment variables to withhold from the agent process.",
      "The agent starts with Filament's own environment minus this list. `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` and `CLAUDE_CODE_SSE_PORT` are always withheld: they mark the terminal Filament was started from as a Claude Code session, and an agent that inherits them (claude-agent-acp wraps Claude Code) behaves as if it were nested inside one. Add names here for anything else your terminal exports that the agent must not see — an `ANTHROPIC_API_KEY` that would override the agent's own subscription login, for instance. Variables set in `env` above always win. The request record names what was withheld.",
      { itemType: "string" },
    ),
    home: p(
      "string",
      "",
      "The account's own folder: where the agent keeps its login, its settings and its sessions.",
      "Empty: the agent's usual folder, its Default account — the login its CLI has on this computer. The harness's Settings → Coding agents → Add account makes one for each further account, inside Filament's data folder, and the agent gets it as the variable its CLI reads: `CLAUDE_CONFIG_DIR` for Claude Code, `CODEX_HOME` for Codex, `GEMINI_HOME` for Antigravity (over a variable of the same name in `env`). Filament never reads inside it. Cursor's CLI and Qoder have no such variable, so they keep one account each; Cursor's SDK route keeps its account as its key.",
    ),
    account: p(
      "string",
      "",
      "The account's name, for an account added beside the agent's Default one.",
      "Set by the harness's Settings → Coding agents → Add account (and Rename there): the account shows by this name, and its upstream is named `<agent> · <name>`. Empty: the agent's Default account. An account with a name can be removed there, which removes its upstream, its routes and the folder Filament made for it.",
    ),
    turnedOff: p(
      "boolean",
      false,
      "Turned off in the harness's Settings → Coding agents.",
      "Set with `enabled` off on every account of the agent by *Turn off* there, and cleared by *Turn on*: its models leave the picker, its accounts and their logins are kept, and the console's *Detect installed agents* never turns it back on. An upstream turned off by hand (its `enabled` alone) is one detection turns on again when its program is found.",
    ),
    accountOff: p(
      "boolean",
      false,
      "This account turned off in the harness's Settings → Coding agents.",
      "Set with `enabled` off by an account's *Turn off* there, and cleared by its *Turn on*: Filament runs nothing on it and its models leave the picker, while its sign-in is kept, and *Detect installed agents* never turns it back on. The agent's other accounts are as they were; its last account turned off turns the agent off, and the agent's *Turn on* then puts every account on again — while any account is on, it leaves those turned off one by one as they are.",
    ),
    modelSelection: p(
      "enum",
      "arg",
      "How the route's model id is handed to the agent.",
      "`arg`: start the agent with `--model <id>` (Cursor CLI); one process per model, sessions are loaded across processes when you switch. `session`: one process, the model is set per session with ACP `session/set_model` (agents that advertise models in `session/new`; switching mid-conversation is then a single call). `none`: ignore the model id and let the agent use its own default.",
      { options: ["arg", "session", "none"] },
    ),
    effortTemplate: p(
      "string",
      "",
      "How to express a requested effort in the agent's model id. Empty = effort is ignored (pick effort by model name instead).",
      "Used when the route model carries a Filament suffix (`cursor/cursor-grok-4.6-xhigh`) or the client sends `output_config.effort` / `reasoning_effort`. `{model}` is the model id without suffix, `{effort}` the level. Cursor's CLI takes flat ids, so `{model}-{effort}` turns `cursor-grok-4.6` + client effort low into `cursor-grok-4.6-low` (Cursor rejects bracket ids on `--model`). Leave empty when the agent's model names already encode effort and you pick them by name.",
    ),
    authenticate: p(
      "boolean",
      false,
      "Call the agent's advertised `authenticate` method after start.",
      "Off: the agent uses the login it already has (Cursor and Qoder work this way). On: Filament calls `authenticate`, which for some agents opens a browser login page every time the agent starts, including during model discovery. Leave off unless an agent refuses sessions without it.",
    ),
    mode: p(
      "string",
      "agent",
      "Default session mode requested from the agent.",
      "Common words `agent` (full tool access), `plan` (read-only planning) and `ask` (questions only) are mapped onto each agent's own mode names via `modeAliases` (Cursor: agent/plan/ask; Qoder: yolo/dontAsk/default). Any turn can override it with a suffix on the model name: `cursor/composer-2.5@plan`, `qoder/lite@ask`, or an agent's exact mode id such as `@acceptEdits`; the session switches and stays there until the next override. Codex knows `agent` and `plan`; `ask` runs as `plan`.",
    ),
    modeAliases: p(
      "map",
      {},
      "How `agent`, `plan` and `ask` map onto this agent's mode ids.",
      'Example for Qoder: `{"agent":["yolo","auto","acceptEdits"],"plan":["dontAsk","default"],"ask":["dontAsk","default"]}`. Filled in automatically for known agents; Filament also tries sensible defaults.',
      { itemType: "string[]" },
    ),
    listModelsArgs: p(
      "array",
      [],
      'Arguments that make the executable print its model list ("id - name" lines), if it has such a command.',
      "Cursor: `--list-models`. Leave empty for agents without one; Filament then reads the models the agent advertises when a session is created.",
      { itemType: "string" },
    ),
    permissions: p(
      "enum",
      "allow-all",
      "How Filament answers the agent's permission prompts (edit file, run command…) in a chat tool's turns.",
      "`ask` puts the question to you through the chat client's own question tool (Claude Code's AskUserQuestion) and waits for your answer; a client without one gets allow-once. `allow-all` approves everything, like Cursor's Run Everything: each call once where the agent offers that, its 'always' only where it offers no other yes. `read-only` approves reads and searches, rejects edits and commands. `allow-once` approves each call without granting 'always'. `reject` refuses everything (chat only). A word that is none of these is refused when the configuration is saved; one a config.json edited by hand holds asks, as `ask` does, and refuses where nobody can be asked, never allowing anything unasked; the log says so. In the harness this setting is not used: the session's permission switch (Read-only, Edit, Ask, Auto) and its rules judge each request as the loop judges its own calls, with the project's always-allows; only a plan the agent proposes waits for you whatever the switch says.",
      { options: ["allow-all", "allow-once", "ask", "read-only", "reject"] },
    ),
    clientBridge: p(
      "enum",
      "prompts",
      "How much of the agent's work is handed to the chat client's own tools.",
      "`prompts`: permission questions (with `permissions = ask`) and the agent's plan go to the client as its own AskUserQuestion / TodoWrite tool calls when it has them, so they appear as native cards. `full`: also file reads, file writes and commands the agent delegates (Qoder) run through the client's Read / Write / Bash, under the client's own permission mode; a client without such tools gets Filament's own hands under this upstream's permission policy. `native` (Claude Code only): its built-in tools are switched off and Filament's MCP toolset (Read, Write, Edit, Bash, Glob, Grep) takes their place, so every read, edit and command runs through the client; other agents treat it as `full`. `off`: everything is rendered as text and answered by policy. Codex delegates no file or command work, so `full` and `native` act as `prompts` there.",
      { options: ["off", "prompts", "full", "native"] },
    ),
    nativeTools: p(
      "boolean",
      false,
      "Treat this agent as able to switch its built-in tools off (for `clientBridge = native`).",
      "Advanced. Claude Code is recognised automatically; set this only for another agent whose ACP adapter honours `_meta.disableBuiltInTools` in session/new.",
    ),
    steering: p(
      "boolean",
      false,
      "EXPERIMENT: also offer this agent Filament's tools and ask it to prefer them, even though it keeps its own.",
      "Rung 2 of the fidelity ladder, for agents that cannot switch their built-in tools off (Cursor). Injecting an MCP toolset is core ACP, so the agent CAN be given Filament's Read/Write/Edit/Bash/Glob/Grep alongside its own; this adds an instruction asking it to route file and command work through them, so those calls render as native cards in your chat client instead of being narrated as text. It is nondeterministic by nature — a model may ignore the instruction, partly or wholly, and mixing two visual languages can read worse than a uniform quiet feed. That is why it is opt-in, and why the request record and the Agents page report the LEAK RATE: the share of tool calls the agent made with its own tools anyway. Measure that on your agent before deciding whether this beats `toolActivity: quiet` with no steering. It takes effect when the agent's session is next created or reloaded: a session that is already running was never offered the toolset, so it keeps running without it, measures nothing, and the request record says so in plain words — a new chat starts a fresh one. Turning steering off does not take the tools back from a session that already has them.",
    ),
    steeringPrompt: p(
      "string",
      "Tool routing: for every file read, write, edit, search and shell command in this session, use the Filament tools (Read, Write, Edit, Bash, Glob, Grep) instead of your built-in equivalents. They are forwarded to the person's editor, which renders them as its own native cards, applies its own permission prompts and keeps a complete record; your built-in tools are only narrated back as text, so the editor cannot show or approve them. Keep using your own tools for anything Filament does not offer, and if a Filament tool fails, fall back to your built-in one and say that you did.",
      "The instruction sent to the agent when `steering` is on.",
      "Sent once, at the start of a new agent session, and not repeated on every turn — repeating it would make the leak rate meaningless as a measurement, since of course an agent obeys an instruction it was just given. Edit it freely: the wording IS the experiment. Empty falls back to this default text.",
      { multiline: true, rows: 5 },
    ),
    nativePaging: p(
      "boolean",
      true,
      "Cap what the agent's own tool calls return to it, while your chat client keeps the full result.",
      "Applies whenever the agent calls one of Filament's tools — `clientBridge = native`, or `steering` in any mode that permits it. It does NOT apply to work an agent delegates over ACP's own file and terminal methods (`full` with no steering), which bypass Filament's toolset and come back whole; that is a known gap, and those delegations are listed on the request record's Changes instead. With the bridge on, a read or a command lands in TWO histories — the client's and the agent's — and both are billed as context on every later turn. Paging makes the agent's copy smaller than the client's instead of equal to it, so the duplication costs less than one extra copy: your client still ran the tool and still shows and keeps everything, and the agent is told it got a page and how to ask for the next one. This is what the CLIs already do (Claude Code's own Read stops at about 2000 lines and says so), so the agent loses nothing it would have had. Off returns whole files and whole command outputs to the agent.",
    ),
    nativePageLines: p(
      "number",
      400,
      "Lines per page returned to the agent for a file read, and kept from a command's output.",
      "A read keeps the FIRST lines from wherever the agent asked to start, so paging forward with `offset` walks the file in order. A command keeps the LAST lines, because that is where the error and the exit status are. The agent is told how many lines it got and, for a read, which `offset` continues it. Zero, a negative number or anything non-numeric means the default of 400 — NOT “no cap”: to stop paging altogether turn off `nativePaging`, which overrides this and `nativePageChars`.",
    ),
    nativePageChars: p(
      "number",
      24000,
      "Character ceiling on the same result, whichever bites first.",
      "A page of 400 very long lines (minified JS, a CSV, a log with no newlines) is still enormous, so the character cap applies too and the agent is told. About 6,000 tokens at 4 characters each.",
    ),
    rawMessages: p(
      "number",
      50,
      "Raw messages kept per agent session, for the Agents page.",
      "Claude's adapter sends its SDK's own messages beside ACP's updates: the model's whole message, each tool's result as the model read it, the turn's result. Filament reads them to draw the turn and keep its record whatever this says; this keeps the newest of them per session, so the Agents page can show exactly what the agent said and heard. They hold whole files and whole results, so they live in memory only — never on disk — and the request record keeps just their count by type. 0 keeps none; a negative or non-numeric value means the default of 50.",
    ),
    clientWaitMinutes: p(
      "number",
      60,
      "How long a turn waits for the client to answer a tool call Filament asked for (a permission question, a file, a command).",
      "When the client never comes back (the chat was closed), the waiting agent action is cancelled after this long and the turn ends; whatever the agent said meanwhile is delivered with the next message.",
    ),
    cwdSource: p(
      "enum",
      "client",
      "Where the working directory for the agent comes from.",
      "`client`: taken from the request, matching `cwdPattern` against the system prompt (Claude Code sends `Working directory: <path>`), or the `x-filament-cwd` header. `fixed`: always `cwdDefault`.",
      { options: ["client", "fixed"] },
    ),
    cwdPattern: p(
      "regex",
      "Working directory:\\s*(.+)",
      "Regular expression whose first group is the project path in the client's system prompt.",
      "Only used with `cwdSource = client`. The path must exist on this machine.",
    ),
    cwdDefault: p(
      "string",
      "",
      "Folder used when no path is found in the request.",
      "Empty falls back to your home folder, which is rarely what you want; set it for clients that never send a path.",
    ),
    cwdFromUserMessages: p(
      "boolean",
      false,
      "Also look for the working-directory pattern inside user messages, not only the system prompt.",
      "Off by default: text that merely appears in the conversation must not be able to aim an auto-approving agent at a folder. Turn on only for clients that put the path in a user message.",
    ),
    cwdAllowlist: p(
      "array",
      [],
      "Folders the agent may work in (each entry covers its subfolders).",
      "Empty means anywhere on this machine. With entries, a working directory outside them is ignored (falls back to `cwdDefault` or the first allowlisted folder) and the request record says so. Recommended when `permissions = allow-all`. Entries must be full folder paths such as `C:\\Projects` (or `/home/you/projects`); the permissions policy itself belongs in `permissions`, not here.",
      { itemType: "string" },
    ),
    housekeeping: p(
      "enum",
      "local",
      "What to do with a client's housekeeping requests (a session title it asks its model for) that arrive on this agent's route.",
      "`local`: Filament writes the title itself from your first message, instantly and free. `model`: send them to `housekeepingModel` through your own routes (a cheap API model gives nicer titles). `agent`: pass them to the agent like any message; the agent mistakes the instruction for a task and opens a second session in your home folder, so this is only for clients that never send such requests.",
      { options: ["local", "model", "agent"] },
    ),
    housekeepingModel: p(
      "string",
      "",
      "Model name (as your tool would type it) that answers housekeeping requests when `housekeeping = model`.",
      "Any name your routes resolve, for example `claude-haiku-4-5-20251001`. Leave empty to answer titles locally.",
    ),
    hints: p(
      "boolean",
      false,
      "Put Filament's own voice into the agent's reply.",
      "Off (the default): Filament's notes go to the request record only — open the turn under Traffic to read them. On: a short italic `_filament: …_` line is appended to the reply when something you asked for could not be applied (a model, mode or effort the agent does not have, images or files it cannot take), and when a turn ends on an unusual stop reason. Off is the better default because a chat client keeps the reply as permanent context: every line Filament adds is a line the next model reads, and models imitate what they see — switch to an API model mid-conversation and it can start answering in Filament's `⚙` style. Said regardless of this setting, because each one is information you cannot get anywhere else in the chat: genuine failures (the agent crashed, its turn was abandoned, a tool result arrived for a turn that no longer exists); a turn that was cut short and produced NO answer of its own (tool lines are Filament's text, not the agent's, so a reply can look non-empty and still be empty); permission prompts that were auto-allowed because this chat tool declares no question tool while the agent's policy is “ask” — a silent security downgrade you are entitled to be told about, once per chat; and the agent quietly working in a different folder than this chat's project because that folder is outside `acp.cwdAllowlist`, since edits can then land in the wrong tree. The request record always has the full list either way.",
    ),
    thoughts: p(
      "enum",
      "auto",
      "How the agent's reasoning reaches your chat.",
      "Thoughts are buffered into RUNS: contiguous thought chunks are flushed as one block, and a tool call or the start of the answer ends the run. So “one block per thought” means one per run, not per fragment. `auto`: a tool connected in Anthropic format gets one thinking block per run, in the order they happened. A tool connected in OpenAI format gets `reasoning_content` for the runs before the reply's first text, and every later run inline as a quoted paragraph (`> 💭 …`) in the order it happened, because OpenAI-style chat apps keep a single reasoning block and a single text block per reply (a later thinking block would land under all the text). `native-then-inline`: that OpenAI behaviour forced, whatever the format — useful to see exactly what an OpenAI-format client would get. `thinking-block`: always native blocks (Anthropic `thinking`, OpenAI `reasoning_content`), whatever the order. `text`: every run inline as a quoted paragraph. `hide`: dropped. Blocks produced this way carry no signature; Filament strips them from history before forwarding to Anthropic (`thinking.stripUnsignedHistory`).",
      { options: ["auto", "native-then-inline", "thinking-block", "text", "hide"] },
    ),
    toolActivity: p(
      "enum",
      "quiet",
      "How the agent's tool usage appears in your chat.",
      "`quiet` (recommended): one compact line when a call starts (`⚙ Read src/app.js`, or `⚙ run \\`npm test\\`` for a shell command), and a second line only when the outcome says something — an edit's `✓ +12 −3 src/proxy.js` summary, or a failure with its exit code and last few lines. Progress updates in between are merged silently, so a call that streams twenty updates still costs at most two lines, and nothing is dumped into the middle of the agent's prose. `text`: the older behaviour — a fenced ```diff``` block per edit and a fenced block of command output, inline in the reply. `verbose`: the same as `text` with the caps raised, for reading a whole dump in chat. `hide`: only the agent's own words. What quiet leaves out is not copied anywhere else by Filament — the request record keeps the announced tool names, and the AGENT's own session keeps its full history, so ask the agent if you need the detail; choose `text` or `verbose` when you would rather see it inline.",
      { options: ["quiet", "text", "verbose", "hide"] },
    ),
    toolDiffStyle: p(
      "enum",
      "",
      "How edits are shown. Empty = follow `toolActivity` (quiet → summary, text/verbose → fenced).",
      "`summary`: one line per file, `+12 −3 src/proxy.js`. `fenced`: a ```diff``` block with context lines. `off`: edits are announced but never shown. `quiet` already implies `summary`; use this to override, for example quiet lines plus real diffs.",
      { options: ["", "summary", "fenced", "off"] },
    ),
    toolDiffMaxFiles: p(
      "number",
      3,
      "Files whose diff is shown per tool call. Empty or unset follows the mode (3, or 8 for `verbose`); **0 shows none**.",
      "A call that rewrites ten files shows the first few and stays quiet about the rest. In `quiet` this caps the `+A −R` summary lines; in `text`/`verbose` it caps the fenced blocks.",
    ),
    toolOutput: p(
      "enum",
      "",
      "When command output is shown. Empty = follow `toolActivity` (quiet → failures only, text/verbose → always).",
      "`failure`: only when the command failed, and only its last few lines — a passing `npm test` needs no transcript in your chat. `always`: every command's output. `never`: no output at all, just the announcement. Note that a command whose stdout *is* the answer (`git log`, `cat config.json`) shows nothing in `failure` mode — set `always` if you want that inline.",
      { options: ["", "failure", "always", "never"] },
    ),
    toolOutputMaxLines: p(
      "number",
      0,
      "Output lines kept per command (0 or empty = the mode's default: 6 for a quiet failure, 30 otherwise, 90 in `verbose`).",
      "Tail-truncated: the last lines are the ones that matter, because that is where the error and the exit status are. Has no effect while output resolves to `failure` in quiet mode, which is capped at 6 lines.",
    ),
    toolIcons: p(
      "boolean",
      true,
      "Prefix tool lines with the ⚙ / ✓ / ✗ glyphs.",
      "Off replaces them with words (`tool:`, `ok:`, `failed:`) for a client or font that renders those glyphs as boxes, and because Filament's glyph style is exactly what a model starts imitating once it sits in the client's permanent context. Applies to `quiet`, `text` and `verbose`; `hide` shows no tool lines at all.",
    ),
    pacingMs: p(
      "number",
      60,
      "How long text waits after a thought before being sent (0 = off).",
      "A chat client paints a thought block above the text only when the thought arrives a moment earlier. Cursor's CLI hands over a whole step at once — thought, text and tool call in the same instant — so without this the text paints first with the thought underneath it. Order is always preserved; the tail of the reply waits for the queue to drain.",
    ),
    seedHistory: p(
      "boolean",
      true,
      "When a conversation has no agent session yet but already has earlier turns, send those turns as context first.",
      "This is what makes switching to the agent mid-conversation work. In the harness the seed is the chat as the harness composed it for the agent's model — the whole conversation, or where its compaction left it — never a cut of it. Off: the agent sees only the newest message.",
    ),
    seedFromArchive: p(
      "boolean",
      true,
      "Build that seed from Filament's archive rather than from the history this request carried.",
      "For an outside chat client; the harness's own chats seed from the harness's composition. Needs Memory enabled. Your chat client's history is lossy in one direction — it compacted, and it contains the narration it was shown — and the agent's own session is lossy in the other: it never saw the turns a different model handled. The archive holds the whole cross-model conversation byte-exact, with tool noise already dropped, so it seeds a new agent session with what actually happened rather than with whatever the client happened to resend. Falls back to the request's history when this chat has never been archived, and the request record says which source was used. Off always uses the request's history.",
    ),
    seedView: p(
      "enum",
      "chat",
      "Which view of the archive seeds a new agent session.",
      "`chat`: each turn's user message and final answer, tool calls and thinking dropped — the closest thing to the conversation as the person experienced it. `summary`: one compressed line per turn instead, which is the better shape for handing a long chat to a DIFFERENT agent (§11.3), and costs no model call because the archive already stores them. `compact`: the `chat` view with the latest compaction summary prepended and the turns it covers left out, so a chat your client already compacted still seeds completely.",
      { options: ["chat", "summary", "compact"] },
    ),
    seedBudgetTokens: p(
      "number",
      0,
      "Token budget for the archive's seed.",
      "0 (the default): half the context window Filament knows for the agent's model, the other half left for the agent's work — 100,000 tokens where Filament does not know the window. A number sets the budget for this agent. Oldest turns are dropped first and the newest is always kept, so a chat longer than the budget seeds with its recent history rather than its beginning; the record says how many turns were dropped and the budget it used. Applies to the archive's seed for an outside chat client; the harness's own chats seed from the harness's composition. Turn seeding off with `seedHistory`, or the archive with `seedFromArchive`.",
    ),
    catchUp: p(
      "boolean",
      true,
      "Tell the agent about the turns it missed while this chat was talking to a different model.",
      "You ping-pong A → B → A: the agent's own session survived, so it still thinks the conversation is where it left it. On (the default), the turns it never saw are injected once as a “Meanwhile, this conversation continued…” preamble, so it does not repeat work or answer a stale question. Off: it resumes blind and only your newest message exists. Applies only to a reused session — a brand-new one is covered by `seedHistory`.",
    ),
    forwardSystemPrompt: p(
      "boolean",
      false,
      "Include the client's system prompt in the first message to the agent.",
      "Agents like Cursor have their own system prompt and tools; the client's prompt (which describes the client's tools) mostly confuses them. Turn on for clients whose instructions matter.",
    ),
    inputTokenEstimate: p(
      "enum",
      "conversation",
      "How `input_tokens` is filled in replies, since ACP agents report no usage.",
      "Clients with a context-window meter show it from this number. `conversation`: the local class-weighted estimate over the system prompt and messages the client sent (prose ≈4 chars/token, code and JSON denser, CJK ≈1 char/token; scaled by the factor the model the agent's turns were counted under showed over the API, where Filament has learned one). `request`: also counts the client's tool definitions, matching what a normal model call would bill. `none`: report 0. Counting is always local — no provider is ever contacted for a token count.",
      { options: ["conversation", "request", "none"] },
    ),
    mcpServers: p(
      "list",
      [],
      "MCP servers the agent should connect to for every session started by Filament.",
      "Each entry: `{name, command, args, env}`. Cursor also loads its own project and user `mcp.json`; use this to pin servers regardless of the project. Approval and start-up limits are the agent's.",
      { itemShape: { name: "string", command: "string", args: "string[]", env: "map" } },
    ),
    sessionIdleMinutes: p(
      "number",
      240,
      "Let go of a chat's agent session after this much inactivity.",
      "Counted from the chat's last turn's end: a chat whose turn runs is never idle, and its agent is kept. A chat of the harness keeps its session: the agent only closes it, and the chat's next message opens it again with all the agent held, until the chat has gone unused 30 days. Another client's chat forgets its session: the agent keeps its own history on disk, and a later message starts a new session seeded with the client's history. Which session a chat has is saved next to config.json, so Filament restarts do not lose sessions.",
    ),
  },
);

export const UPSTREAM = group("An upstream is a place requests are forwarded to.", {
  id: p("string", "", "Short identifier used by routes.", "Letters, digits, dashes."),
  name: p("string", "", "Display name.", "Shown in the UI and logs."),
  type: p(
    "enum",
    "openai-compatible",
    "Kind of upstream.",
    "Sets the default base URL, supported formats and auth header.",
    { options: Object.keys(UPSTREAM_TYPES) },
  ),
  machine: p(
    "string",
    "",
    "The paired machine whose models this upstream offers (type `filament`): its id, as this machine keeps it.",
    "One this machine keeps an agents' device for (Settings › Remote access › Machines), whose grant `models` is on there. Its address, its certificate and the device's token are read from remotes.json at each call, never kept in config.json; its models are the ones that answer there by an API — never a coding agent of that machine's.",
  ),
  baseUrl: p(
    "string",
    "",
    "Base URL without the endpoint path.",
    "The shim appends `/v1/messages` or `/v1/chat/completions`. A base that ends in its own version keeps it: `https://api.z.ai/api/coding/paas/v4` gets `/v4/chat/completions` (and `/v4/models`, `/v4/embeddings`), never `/v4/v1/…`. A full endpoint pasted here is used as it is. For routers use `http://localhost:<port>`.",
  ),
  apiKey: p(
    "secret",
    "",
    "Credential for this upstream.",
    "Sent as `x-api-key`, `Authorization: Bearer`, or both, per `authStyle`.",
  ),
  authStyle: p(
    "enum",
    "auto",
    "Which auth header carries the key.",
    "`auto` picks the usual header for the type. Routers accept both.",
    { options: ["auto", "x-api-key", "bearer", "both"] },
  ),
  wireApi: p(
    "enum",
    "auto",
    "Which OpenAI-style endpoint the server offers (OpenAI API and OpenAI-compatible servers only).",
    "`auto`: Chat Completions first; when the server answers 404 or 405 there, Filament sends the same request to `/v1/responses` instead and remembers that until it restarts. `chat-completions`: only `/v1/chat/completions`. `responses`: only `/v1/responses` (some OpenAI models, and servers built on the Responses API). Filament keeps working in Chat Completions inside; the request is repacked on the way out and the reply on the way in, so every client format and every rule still applies. Ignored for Anthropic-format servers and coding agents.",
    { options: ["auto", "chat-completions", "responses"] },
  ),
  headers: p("map", {}, "Extra headers for this upstream.", "Merged after the rules' `headers.set`.", {
    itemType: "string",
  }),
  enabled: p(
    "boolean",
    true,
    "Whether routes may use this upstream.",
    "Disabled upstreams are skipped and fallbacks are tried.",
  ),
  billing: p(
    "enum",
    null,
    "How this provider bills you: `metered` (per token) or `plan` (a subscription).",
    "On a plan a request pays nothing by itself, and its price card is its list price: what the same tokens would cost per token, shown beside what was paid. Empty follows the provider catalogue for a known plan's address (Z.AI's and Kimi's coding plans are plans), else metered. A coding agent (ACP, Codex, Cursor SDK) is always a plan. A model's own `billing` in its pricing row wins over this, for a provider that sells some models per token and others on a plan. Spend is analytics either way: nothing is ever capped by it.",
    { options: ["metered", "plan"] },
  ),
  discoverModels: p(
    "boolean",
    true,
    "Let Filament ask this upstream for its model list (`GET /v1/models`): when a save adds it or changes its address, key or auth, and on the console's Refresh.",
    "Discovered names are mapped backwards through your routes and advertised on Filament's own `/v1/models`, so agents with a model picker see real names instead of only the ones typed into routes. Lists are cached on disk (`models-cache.json`) and survive restarts; nothing is fetched because a page was opened — a save that adds the upstream or changes its address, models path, key, auth style or this switch asks once in the background, the Refresh button asks every upstream, and neither ever deletes names typed on the upstream: the lists are merged. A listing that states a context window per model (OpenRouter-style `context_length`) has it captured beside the names, and it serves as the model's window below your own pricing word.",
  ),
  modelsPath: p(
    "string",
    "",
    "Custom path for the model list.",
    "Empty means `/v1/models`, or `/vN/models` under the base's version when the base ends in one (`…/v4` → `/v4/models`). Some servers use `/models`, a vendor-specific path or a full URL.",
  ),
  models: p(
    "array",
    [],
    "Model names you typed for this upstream, offered in every picker beside the ones it lists itself.",
    "Add one with the Add button under the upstream's model list (or here, comma separated). Merged with discovered names, never removed by a Refresh; useful for upstreams without a list endpoint and for a model the list does not show yet. A coding agent is given a typed name exactly or not at all — never the closest name it offers — and a turn on a name it does not offer says so.",
    { itemType: "string" },
  ),
  pricing: p(
    "map",
    {},
    "This upstream's model cards: each model's prices (USD per million tokens), what it can do here — reasoning levels, fast mode, extended thinking, context windows, output ceiling, tools. How many agents run on a model at once is `agentLoop.subagents.slots`.",
    "Set them on the Upstreams page: each model's **tune** sheet sets what it can do and, under Pricing, its list price (the same model often costs and behaves differently at different providers). A model whose variants are ids of their own is tuned on its family's base row, which covers every id it starts. Keys are model names or prefixes as this upstream spells them. Every field is optional, and every one you leave out comes from the next source that knows: the provider's own model listing (captured by Refresh — Anthropic's states each model's reasoning levels, thinking, window and output ceiling; OpenRouter-style listings state windows), then the Rules page, then Filament's built-in knowledge. The harness's model picker offers exactly what this resolves to, and requests are shaped by the same answer. When the provider itself states what it charged (xAI does), that figure is used instead of any price here. `contextTokens` is the model's standard context window at THIS provider: every request record judges its fit by it (nothing is ever reshaped to fit), /autofit fits a session to it, and a summary's slices are sized with it. `windows` lists the other windows a session may choose (the harness's Context window control; `[]` = the standard one only) — windows the same name takes; a provider that sells each window as a name of its own (Kimi's `k3` at 1M beside `k3-256k`) needs none, since the picker folds those names into one model with a Context window choice, and `windowMultipliers` on the family's row says what each of those windows costs against the cheapest, window tokens → multiplier (`{\"1000000\": 2}`: the 1M window at twice; on a plan, twice the quota), shown beside the window in the picker. `maxOutputTokens` is the model's maximum output: sessions and agent turns without their own max_tokens use it; left out, what the provider's listing states or a refusal of a larger request named (Filament remembers that one for the model here, and its own call goes again within it), else 128,000. `efforts` lists the reasoning levels the model takes (`low`, `medium`, `high`, `xhigh`, `max`; `[]` = it takes no effort field, which is then removed) and `effortDefault` the level the provider uses when none is sent. `fast` says whether the model has a fast mode here, `fastMultiplier` what it costs against the standard price (or how much faster it spends a subscription's quota; Anthropic's is 2), and `fastParams` the request fields that ask for it on an OpenAI-format provider — xAI and OpenAI take `{\"service_tier\": \"priority\"}`, and the reply's own tier decides whether the request is billed fast. On the Anthropic wire fast mode is `speed: \"fast\"` with its beta and needs no fields. `flex` says whether the model has a flex tier here (a provider's cheaper, slower processing; OpenAI-format wires only), `flexMultiplier` what it costs against the standard price (above 0, at most 1: 0.5 = half), and `flexParams` the request fields that ask for it — OpenAI takes `{\"service_tier\": \"flex\"}`. A flex request bills at the multiplier only when the reply says it was served on that tier. `thinking` says whether the model takes extended thinking (Anthropic wire; off removes the field). `tools` says whether the model takes tools (left out: what the provider's listing states — OpenRouter's and Mistral's do — else yes; a coding agent brings its own and ignores it): off, Filament's own agent runs it in words only, with no tools offered and its prompt saying why, memory offers it none of its tools, and the Assistant refuses it; a client's own tools are always sent as the client sent them. `maxConcurrency`, where an older configuration has one, is kept as written and caps nothing: how many agents a model runs at once at a source is its limit on its row under Settings › Providers (`agentLoop.subagents.slots`), lowered for a while by a provider's 429; its calls hold to what the provider showed, a 429's and its rate-limit headers'.",
    {
      itemShape: {
        input: "number",
        output: "number",
        cacheRead: "number",
        cacheWrite: "number",
        contextTokens: "number",
        maxOutputTokens: "number",
        maxConcurrency: "number",
        keepsThinking: "boolean",
        efforts: "array",
        effortDefault: "string",
        fast: "boolean",
        fastMultiplier: "number",
        fastParams: "map",
        flex: "boolean",
        flexMultiplier: "number",
        flexParams: "map",
        windows: "array",
        windowMultipliers: "map",
        thinking: "boolean",
        tools: "boolean",
        billing: "string",
      },
    },
  ),
  hiddenModels: p(
    "array",
    [],
    "Model names (as the upstream spells them) to keep out of the advertised list.",
    "Toggle them on the Upstreams page. Hidden names still work when an agent asks for them by name; they are just not offered in pickers (/v1/models, Playground, Assistant).",
    { itemType: "string" },
  ),
  rules: p(
    "rules",
    {},
    "Rule overrides for this upstream.",
    "Any rule left unset inherits the global default.",
  ),
  acp: ACP,
  qoder: QODER_AUTH,
});

export const ROUTE = group("A route maps a model name the agent asks for to an upstream and a model there.", {
  match: p(
    "string",
    "",
    "Model-name pattern the agent sends.",
    "Exact name, or a glob with `*` (for example `claude-*`). An effort suffix is stripped before matching when `effort.stripSuffix` is on. First matching route wins, top to bottom.",
  ),
  upstream: p("string", "", "Upstream id.", "Must reference an existing upstream."),
  upstreamModel: p(
    "string",
    "{model}",
    "Model name to send upstream.",
    "`{model}` is replaced with the matched name without suffix, e.g. `anthropic/{model}` for OmniRoute's prefixed ids. `{1}`, `{2}`… are the parts matched by each `*` in `match`, so `direct/claude-*` can be sent as `claude-{1}`. This lets several routes address the same upstream model under different names.",
  ),
  format: p(
    "enum",
    "auto",
    "Wire format sent to the upstream for this route.",
    "`auto`: the agent's own format when the upstream speaks it, otherwise the one it does speak (translated). `anthropic` or `openai` forces that format; requests in the other format are translated (see `rules.translate`).",
    { options: ["auto", "anthropic", "openai"] },
  ),
  fallbacks: p(
    "list",
    [],
    "The failover order: other upstreams that serve this route when the one before fails.",
    "Each entry is `{upstream, upstreamModel}`, tried in order (strategy in_order) when the previous one fails before answering: rate limit (429), server errors (5xx, 529), unreachable, an unknown model on that provider (404, or a 400 naming the model) or a refused key (401, 403). A plain-name route with entries here is a virtual model (`free-model`). Other strategies spread requests across the same list.",
    { itemShape: { upstream: "string", upstreamModel: "string" } },
  ),
  strategy: p(
    "enum",
    "in_order",
    "How to choose among the primary upstream and its fallbacks for each request.",
    "`in_order`: primary first, fallbacks only on failure. `round_robin`: rotate. `random`. `least_latency`: the upstream with the lowest recent first-byte time. `least_cost`: cheapest by the model's price card at each upstream. `quota_aware`: avoid upstreams whose rate-limit headers or quota say they are nearly exhausted. Upstreams that are cooling down after failures are always tried last.",
    { options: ["in_order", "round_robin", "random", "least_latency", "least_cost", "quota_aware"] },
  ),
  discoverPrefixes: p(
    "array",
    [],
    "For router upstreams (9router, OmniRoute) that list models as `provider/model`: provider prefixes whose models this route advertises by bare name.",
    'Routers usually accept the bare model name and pick their default provider for it. With `["anthropic"]`, a discovered `anthropic/claude-opus-5` is advertised as `claude-opus-5` through a `claude-*` route, while `cu/claude-opus-5-thinking-high` (Cursor) is not. Empty disables bare-name discovery for this route; ids that match the route\'s upstream model template in full are always considered.',
    { itemType: "string" },
  ),
  enabled: p("boolean", true, "Whether this route is active.", "Disabled routes are skipped."),
  rules: p("rules", {}, "Rule overrides for this route.", "Highest-priority layer."),
});

export const SERVER = group("Listener and access control.", {
  host: p(
    "string",
    "127.0.0.1",
    "Interface to listen on.",
    "`127.0.0.1` keeps the shim private to this machine. `0.0.0.0` exposes it to the network; then set inbound keys.",
  ),
  port: p(
    "number",
    20300,
    "Port for both the API endpoints and the settings UI.",
    "Agents use `http://<host>:<port>/v1`.",
  ),
  inboundKeys: p(
    "array",
    [],
    "API keys agents must present.",
    "Checked as `Authorization: Bearer <key>` or `x-api-key`. Empty list with `requireAuth` off means open access on the listener.",
    { itemType: "secret" },
  ),
  requireAuth: p(
    "boolean",
    true,
    "Require an inbound key on the model endpoints.",
    "The settings UI and admin API answer this computer, the devices paired in Settings › Remote access and `adminToken` alone, whatever this says.",
  ),
  adminToken: p(
    "secret",
    "",
    "Token that lets a script on another machine call the admin API, sent as `x-filament-admin` or a Bearer token.",
    "Leave empty for none: this computer and the full devices paired in Settings › Remote access administer Filament still — a view-only one reads. A browser on another machine pairs instead.",
  ),
  allowedHosts: p(
    "array",
    [],
    "Extra host names the console, the admin API, the model endpoints and MCP may be reached under.",
    "They answer only to `localhost`, IP addresses and the configured `host` (a defence against DNS rebinding from web pages). Add a name here when you reach Filament through a reverse proxy or a hosts-file alias.",
    { itemType: "string" },
  ),
  maxBodyBytes: p(
    "number",
    64 * 1024 * 1024,
    "Largest accepted request body.",
    "Long agent conversations with many tools can reach several megabytes. A call of Filament's own loop past it goes with its older pictures, PDFs and files left out until it is within. The message box refuses a message whose attachments together pass it.",
  ),
  logLevel: p("enum", "info", "Log verbosity in Filament's terminal window.", "`debug` prints every rewrite decision.", {
    options: ["error", "warn", "info", "debug"],
  }),
  encryptSecrets: p(
    "boolean",
    true,
    "Store API keys, tokens and inbound keys encrypted in config.json.",
    "AES-256-GCM with a random key in `secret.key` next to the config. Copy both files to move an installation; config.json alone reveals no secrets. Off writes them in plain text (only for debugging).",
  ),
  advertiseEffortSuffixes: p(
    "array",
    [],
    "Effort suffixes to add as extra entries on Filament's `/v1/models` for Claude models.",
    'With `["xhigh","max"]`, an agent\'s model picker also shows `claude-opus-5-xhigh` and `claude-opus-5-max`, which pick effort without any agent setting. Empty keeps the list short.',
    { itemType: "enum", options: EFFORT_LEVELS },
  ),
  // A group after the leaves: PARAMETERS.md says a group's leaves under its own heading, and what follows under the group's.
  lan: group("Reach this machine on my network (Settings › Remote access): an https listener of its own for the devices paired with this machine.", {
    enabled: p(
      "boolean",
      false,
      "Listen on this machine's network addresses, over https.",
      "On: Filament listens on every address of this machine at `port`, over https with a certificate of its own — self-signed, made the first time and kept in the data folder's `lan-tls` folder — beside the loopback listener, which stays as it is. Its pages, API, stream and sockets answer the devices paired in Settings › Remote access and the pairing page anyone; the model endpoints, MCP, an app's hooks and artifacts answer on this machine alone. A browser warns of the certificate once: its fingerprint must be the one Settings › Remote access shows. Takes effect at once.",
    ),
    port: p("number", 20343, "Port for the network listener.", "Its own port, never the loopback listener's. Takes effect at once; a Windows Firewall rule Filament made names the port it was made for."),
  }),
  tailscale: group("Share on my tailnet (Settings › Remote access): `tailscale serve` gives this Filament an https address on your tailnet.", {
    serve: p(
      "boolean",
      false,
      "Serve this Filament on your tailnet with tailscale serve.",
      "On: Filament asks Tailscale's command line to serve https://<this machine>.<your tailnet>.ts.net — its certificate one an authority signs — to a door of its own on loopback at `port`, and the artifacts at port 8443 of that name. It never takes an https port you serve something else on, and turned off takes back its own alone. Its pages, API, stream and sockets answer the devices paired in Settings › Remote access, and the pairing page anyone on the tailnet; the model endpoints, MCP and an app's hooks answer on this machine alone. Needs Tailscale installed and signed in here, and HTTPS turned on for the tailnet. Takes effect at once.",
    ),
    trustOwnLogin: p(
      "boolean",
      false,
      "Let in a machine signed in to Tailscale as you, without pairing.",
      "On: a request tailscale serve hands on from a machine signed in to the tailnet as this one is — its Tailscale-User-Login, which tailscale serve alone sets — drives this Filament as this machine does. Another person's machine on your tailnet, a tagged one, and one from the internet (Funnel) still pair with a code.",
    ),
    port: p("number", 20345, "Port of the tailnet's door, on loopback.", "Where tailscale serve hands requests on to Filament, on this machine alone; the artifacts' door is at the port after it. Its own port, never the loopback listener's nor the network listener's."),
  }),
});

// Who caused a request. A DISPLAY enum, not a config knob: the classifier that assigns one lives in
// `services/records.js:recordSource`, the API filters on it, and the dashboard builds its Traffic tabs and source filter from
// these labels — so the three cannot drift apart. The browser never re-derives a source from user-agent strings or
// record fields; it reads the one the server already put on the record. (Same rule as the bridge-mode column, which
// must come from the schema rather than a hard-coded list.)
//
// A coding-agent turn is still `client`: your tool asked Filament to run an agent. Agent turns are a separate facet
// (their record carries an `acp` block), which is what the Agents tab filters on.
export const TRAFFIC_SOURCES = {
  client: {
    label: "Your tools",
    short: "client",
    hint: "A request from something you pointed at Filament: Claude Code, Cursor, an SDK, the playground. Includes coding-agent turns.",
  },
  memory: {
    label: "Memory",
    short: "memory",
    hint: "Filament's own model call on memory's behalf: learning a session, rewriting a recall query, a summary's slice, a compaction summary, or the memory engine's own call. The purpose column says which.",
  },
  "agent-loop": {
    label: "Agent loop",
    short: "agent",
    hint: "The parent turn of an agent/<model> request. It carries the tokens the client sees but no cost: every tick and the reader behind delegate_read are billed on their own records.",
  },
  "agent-tick": {
    label: "Agent-loop tick",
    short: "tick",
    hint: "One model call inside an agent turn, or the cheap model reading files for it (delegate_read). These are the calls that really hit an upstream.",
  },
  subagent: {
    label: "Sub-agent",
    short: "sub",
    hint: "A sub-agent's run: a fresh agent loop on one task, launched by an agent turn, from the harness's spawn widget or by /subagent. Like an agent-loop turn it carries tokens and no cost — its own ticks are billed on their records.",
  },
  compaction: {
    label: "Compaction fork",
    short: "compaction",
    hint: "A compaction's summary written by a fork of the session's own request: the same model, system prompt, tools and conversation, read from the provider's cache, with the summary asked as the newest message. It books on the session; one written during a turn names that turn as its cause. A summary written from the transcript instead is a Memory call (Compaction summary).",
  },
  replay: {
    label: "Replay",
    short: "replay",
    hint: "A stored request re-sent from the console to compare two runs side by side.",
  },
  assistant: {
    label: "Console assistant",
    short: "assistant",
    hint: "Filament's own assistant answering a question you asked in the console.",
  },
  housekeeping: {
    label: "Housekeeping",
    short: "housekeeping",
    hint: "A client's session-title or conversation-summary ping, answered locally by Filament or by the housekeeping model.",
  },
  ping: {
    label: "Health ping",
    short: "ping",
    hint: "Filament checking that an upstream and a model still answer. Sent by the console's ping button and by health checks.",
  },
};

// What Filament's own model calls are for — the `purpose` values `MemoryService.callModel` sends. Listed here so the
// Traffic row pill and the Memory tab's purpose filter take their labels and explanations from one place instead of a
// list re-typed in the browser. `recordSource` tags the call `memory`; this says which kind of memory work it was.
export const MEMORY_PURPOSES = {
  learn: {
    label: "Learning",
    hint: "Reading a finished conversation and extracting what is worth remembering: a title, its end state, per-turn summaries and typed items.",
  },
  recall: {
    label: "Recall rewrite",
    hint: "Rewriting a message into other words a search can match, where the recall rewrite is on. Only fires when the plain query found almost nothing.",
  },
  compact: {
    label: "Compaction summary",
    hint: "Summarizing a session's oldest turns into one compaction from the transcript: /autofit, Compact now, a session's own compaction at the line, or the agent loop folding its oldest rounds. A summary a fork of the session's own request wrote is a Compaction fork instead.",
  },
  engine: {
    label: "Memory engine",
    hint: "The Mnemosyne engine's own model call (consolidation, embeddings-related work), proxied through Filament so it is priced and visible like any other.",
  },
  signal: {
    label: "Correction signal",
    hint: "A read memory's model made of a non-English message that opened like a correction, in the traffic of a release before the memory plan's d3; no longer made — the agent keeps what you say with its memory tools.",
  },
  estimate: {
    label: "Goal estimate",
    hint: "The one intake estimate a `/goal` cannot skip: how big the goal is (hours to team-years), the slice that is achievable, its assumptions and the first step. Made once, before the goal can be accepted.",
  },
  title: {
    label: "Chat name",
    hint: "Memory's model naming a chat from about 1K tokens of its first message, as it is sent (Settings › Experimental, experimental.nameChats). Only a chat Filament named from its first message is renamed, and once; never one kept from memory.",
  },
  curate: {
    label: "Curation",
    hint: "The memory curator's call: judging which memories say the same thing, keying a value, checking a memory against its changed file or the turn it came from, or writing a project's dossier. Bounded by memory.curator.maxCalls a pass.",
  },
  memory: { label: "Memory (other)", hint: "A memory call that did not name a purpose." },
};

export const OBSERVABILITY = group("What is recorded per request.", {
  keepLastRequests: p(
    "number",
    500,
    "Requests kept in memory for the UI.",
    "Older entries fall off, a finished agent tick or sub-agent call first, but never one of a turn still running, whose cache card and accounting read them until it ends; everything is still appended to the log file. A restart reloads this many from the end of the log — the current file first, then its rotated generations, newest first — by reading backwards in chunks, so raising the number costs RAM for the extra rows, not a 66 MB slurp of the whole file.",
  ),
  logFile: p(
    "string",
    "requests.jsonl",
    "JSONL file (inside the data directory) with one record per request.",
    "Empty disables file logging.",
  ),
  storeBodies: p(
    "enum",
    "summary",
    "How much of each request to keep (memory and the JSONL log).",
    "`summary` keeps what matters without the conversation: model in/out, thinking in/out, effort in/out, stream flag, message and tool counts, sizes, the headers sent, and every change applied. `none` keeps metadata and usage only. `shaped` additionally stores the full request body as sent upstream (whole chat, secrets redacted). `full` also stores the inbound body. Long agent sessions are megabytes per request, so use `shaped`/`full` only while debugging; bodies above `maxStoredBodyBytes` are truncated.",
    { options: ["none", "summary", "shaped", "full"] },
  ),
  maxStoredBodyBytes: p(
    "number",
    2 * 1024 * 1024,
    "Per-request cap for stored bodies.",
    "Keeps the log file and memory bounded.",
  ),
  storeInternalBodies: p(
    "boolean",
    false,
    "Also keep the bodies of Filament's OWN model calls: memory learning, recall rewriting, summary slices, compaction summaries, the memory engine, the console's assistant and health pings.",
    "Off by default. Those calls carry learning and summary **prompts**, which contain your conversation text, and Traffic lists them beside your clients' requests, so they would be one click away. With this off they stay metadata-only — model, tokens, timings, cost, the purpose and every change applied — and the drawer says why a body is absent. Turn it on only while debugging one of Filament's own calls.",
  ),
  tokenCalibration: p(
    "boolean",
    true,
    "Learn the token estimator's error per upstream+model from the usage every real reply already states, and apply it as a multiplier.",
    "Nothing is ever sent anywhere to learn this — it reads receipts Filament keeps. After three real replies the session composer, the context stamp on every request, `count_tokens` and the agent loop's compaction line size themselves to the scale that upstream actually bills; a provider that never states usage stays on the class-weighted estimate. A coding agent's own counts teach nothing — what an agent states is its own context's count, never the request's — but where its turns name the model that counted them (Claude Code's `opus` is `claude-opus-5-5`), its estimates borrow the factor that model showed on an upstream Filament calls directly; an agent whose turns name none, or whose model no such upstream has answered, stays on the class-weighted estimate. Learned ratios live in `token-calib.json` in the data directory. Off = plain estimates.",
  ),
  runEvents: group(
    "The run log: every event an agent turn or a sub-agent publishes, kept per run so the harness can watch a run live and replay it after a restart (`/api/runs`).",
    {
      persist: p(
        "boolean",
        true,
        "Append each run's events to `runs/<id>.jsonl` in the data directory.",
        "Off keeps runs in memory only: a restart forgets them and a replay of an older run is not possible. The events carry conversation (a brief, a question, a sub-agent's words) — they live under the data directory like the archive, never in the operation log.",
      ),
      retentionDays: p(
        "number",
        7,
        "Days a run's file is kept before the sweep removes it.",
        "Checked at start and every six hours; a run that is still running is never removed. 0 keeps files forever.",
      ),
      maxPerRun: p(
        "number",
        20000,
        "Events kept in memory per run.",
        "Past this the oldest fall out of the ring; a viewer asking for them is told the first number it can still get (and the file, when persistence is on, fills the rest). A long agent turn streams a few thousand text deltas.",
      ),
      ringMB: p(
        "number",
        4,
        "Megabytes of a running run's newest events kept in memory, as their JSON measures them.",
        "Older events are read from the run's file, a page at a time, when something asks for them (a viewer opening the run, a page scrolled back), so what a long turn streamed stays on disk instead of in the server's memory. Never fewer than the newest 200 events. An ended run keeps none in memory once its file holds them all. With `persist` off, or once a run's file could not be written, its events stay in memory, up to `maxPerRun`.",
      ),
      keepRuns: p(
        "number",
        200,
        "Ended runs kept in memory.",
        "Older ended runs leave memory (their files stay until the sweep); a running run is never evicted.",
      ),
      toolPreviewChars: p(
        "number",
        2000,
        "Characters of a tool's result carried on the agent loop's `tool-end` event.",
        "The harness shows a command's output, a read's first lines or a search's hits from this preview (the model saw the whole result). Clipped at this many characters with the cut marked; 0 carries no preview, only the counts. The run log is conversation-bearing already (`round-text`), so this changes nothing about where content lives: the run file, never the operation log.",
      ),
      imagesMaxMB: p(
        "number",
        500,
        "Megabytes of the pictures tools handed agents, kept so the harness shows them on the calls' cards.",
        "A picture an agent read, or one a tool returned (an MCP server's screenshot), is kept as the model saw it beside the run files (`runs/images/`), once per content, for as long as run files are kept (`retentionDays`). Past this many megabytes the oldest go first. Only PNG, JPEG, GIF and WebP are kept, at most 10 MB each and 8 a call. 0 keeps none; so does `persist` off. The pictures are conversation, as the run files are.",
      ),
    },
  ),
  broadcast: p(
    "boolean",
    true,
    "Push live request events to the UI.",
    "Uses server-sent events; negligible cost.",
  ),
  ops: group(
    "Everything Filament does that is NOT a model call: health and cooldowns, config changes, background jobs, the memory engine, the learner, coding agents, agent runs and alerts.",
    {
      enabled: p(
        "boolean",
        true,
        "Record operations at all.",
        "Off stops the operation log entirely: no ring, no `ops.jsonl`, and Traffic → System goes empty. Request records are unaffected either way.",
      ),
      kinds: p(
        "list",
        DEFAULT_OP_KINDS,
        "Which kinds the System tab shows by default.",
        "Every kind is still **recorded**, including the firehose ones — searches, engine calls, agent tool calls, stream milestones — so nothing is lost; an unlisted kind just needs its chip switched on. Keeping the firehose out of the default view is what stops one busy turn from burying the audit trail.",
        { itemType: "enum", options: OP_KIND_KEYS },
      ),
      keepLast: p(
        "number",
        2000,
        "Operations kept in memory for the UI.",
        "Older ones fall off the list but stay in the log file and its rotated generations. On a busy box the firehose kinds churn this ring fast: with engine calls, searches and tool calls switched on, one agent turn can write dozens of operations, so this morning's cooldown or refused compaction may already be out of the in-memory list (it is still in the file). Raise this if the System tab needs to reach further back; the cost is RAM and a slower console load, nothing else.",
      ),
      logFile: p(
        "string",
        "ops.jsonl",
        "JSONL file (inside the data directory), one operation per line.",
        "Rotates at 20 MB keeping five generations (`.1` newest … `.5` oldest), and a restart reads back across them, so it does not blank the System tab. Empty disables the file and operations then live only in memory.",
      ),
    },
  ),
});

export const PRICING_DEFAULTS = {
  // contextTokens: the window the meter, the context stamp and the compactor size against when the operator has not set the
  // model's row on the Upstreams page (a row there overrides these per provider). Docs as cited per family.
  // keepsThinking: the interleaved-thinking models (Opus 4.5+, Sonnet 4.6+ and newer) whose thinking blocks ride
  // every reply — the keepInHistory derivation reads it (Step 6 §1.4); a row of your own with keepsThinking: false
  // says otherwise for your model, longest prefix first.
  // fastMultiplier: what a fast-mode request (Anthropic `speed: "fast"`) costs against the row's prices — Opus 4.8's
  // $10 / $50 against its $5 / $25.
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5, contextTokens: 200_000, keepsThinking: true },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, contextTokens: 200_000, keepsThinking: true },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, contextTokens: 200_000, keepsThinking: true, fastMultiplier: 2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, contextTokens: 200_000, keepsThinking: true, fastMultiplier: 2 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, contextTokens: 200_000, keepsThinking: true, fastMultiplier: 2 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, contextTokens: 200_000, keepsThinking: true },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, contextTokens: 200_000, keepsThinking: true },
  "claude-opus-4-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, contextTokens: 200_000, keepsThinking: true },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, contextTokens: 200_000, keepsThinking: true },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, contextTokens: 200_000, keepsThinking: true },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, contextTokens: 200_000 },
  // xAI (docs.x.ai, September 2026; prices for prompts under 200k tokens, the longer-prompt tier is double)
  "grok-4.6": { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0, contextTokens: 256_000 },
  "grok-4.5": { input: 2, output: 6, cacheRead: 0.3, cacheWrite: 0, contextTokens: 256_000 },
  "grok-4.3": { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0, contextTokens: 256_000 },
  "grok-4.20": { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0, contextTokens: 256_000 },
  "grok-build": { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0, contextTokens: 256_000 },
};

/**
 * The once-per-session briefing's token budget unless Memory settings say otherwise (the owner's of 10-29: up to 5K,
 * so a session starts knowing where the repository stands, what happened in it lately and the recent sessions). One
 * number for the setting's default, memory's and the New Task board's.
 */
export const BRIEFING_TOKENS = 4500;

export const MEMORY = group(
  "Long-term memory for every model and every client. Filament installs and runs Mnemosyne (open source, SQLite, on your machine) as its own child process, keeps a byte-exact archive of your conversations, and on autopilot gives each request what past sessions established: identity, your rules, the project's dossier, decisions, related sessions. Models can also call memory tools themselves. Content never enters records or logs.",
  {
    enabled: p(
      "boolean",
      true,
      "Turn memory on.",
      "On (the default): Filament runs the Mnemosyne engine it installed as its own child process, the autopilot adds relevant memory to requests, it learns from your sessions, and models get the filament_memory_* tools unless a client sends `x-filament-memory: off`. Off: the archive still records every conversation, for your sessions and their transcripts, but nothing is recalled, learned or offered as a tool. A config that saved off stays off.",
    ),
    folder: p(
      "string",
      "",
      "Folder that holds the memory (archive.db, mnemosyne/, memory.json).",
      "Empty = `<data folder>/memory`. Any drive works. Pointing a fresh install at an existing folder adopts it.",
    ),
    engine: group("The Mnemosyne engine that comes with Filament, which Filament installs and runs.", {
      autoInstall: p(
        "boolean",
        true,
        "Install the engine that came with Filament by itself.",
        "On (the default): when memory is on, Filament installs its engine in the background as it starts, or when memory is switched on, from the copy that came with Filament, offline — where it is missing, or where the one installed is another than this Filament's (a new release's replaces the last; memory is backed up first when the Mnemosyne version changes). Nothing is ever downloaded and no engine is updated: each release brings its own. It tries once a run; Install on the Memory page tries again at any time. Off: nothing installs until you press Install.",
      ),
      embeddings: p(
        "boolean",
        true,
        "Meaning-based recall with the local embedding model that comes with the engine (runs on CPU).",
        "Off: keyword recall only. Changing this later needs a reindex.",
      ),
      bank: p(
        "string",
        "default",
        "Mnemosyne bank (a separate database) to use.",
        "Banks isolate domains (work, personal).",
      ),
    }),
    autopilot: group("What memory does on every request without you typing anything.", {
      enabled: p(
        "boolean",
        true,
        "Recall into requests automatically.",
        "Off: only the archive records; no briefing, no per-turn memory, no tools, no reminder on a tool call's result.",
      ),
      mode: p(
        "enum",
        "conservative",
        "How eager the autopilot is.",
        "`conservative`: inject nothing when unsure, at most a few items per turn, items that were never used fade out. `eager`: wider recall from day one.",
        { options: ["conservative", "eager"] },
      ),
      briefingTokens: p(
        "number",
        BRIEFING_TOKENS,
        "Token budget for the once-per-session briefing, the whole of it (its header and line on memory's tools, your rules, identity, the project's dossier, where the repository stands and its newest commit, recent sessions, deep recall, and the legends under them).",
        "Placed once in the system prompt and kept stable so provider prompt caches survive. Each block has its share of what your rules leave, so none crowds out another; a first message with no task in it (a greeting) gets no recall, and its share goes to the dossier and the project's procedures, whole.",
      ),
      turnTokens: p(
        "number",
        300,
        "Token budget for the per-message block.",
        "Half again after a compaction, and on a chat's first message when no briefing was built on it; none on tool-result legs and on a message with no word to look up by (a greeting, a yes). It never says again what the chat has in view: what its briefing showed, and what an earlier block shows on a message it still sends. Never read from what the message says.",
      ),
      minScore: p(
        "number",
        0.2,
        "Score floor for recalled memories (0 to 1).",
        "A result is used when it scores at least this, or when it is within 60% of the best result of the query.",
      ),
      tools: p(
        "boolean",
        true,
        "Offer the filament_memory_* tools to models.",
        "The model can search memory and past sessions, load a session, remember and forget. Filament runs the calls and asks the model again before the client sees anything.",
      ),
      toolIterations: p("number", 4, "Most memory tool rounds per request.", ""),
      loadBudgetTokens: p(
        "number",
        30000,
        "Most tokens of past sessions one request may pull, across every load of every tool round.",
        "A per-load ceiling alone would let a determined model page the whole archive in slices; this is the request-wide cap. Raise it for deep research turns, lower it to protect the context window.",
      ),
      cue: p(
        "boolean",
        true,
        "One visible line at the start of a session's first reply naming related sessions.",
        "Lets you pull a session in by hand (`@mem load <id>`).",
      ),
      rewrite: p(
        "boolean",
        false,
        "When a message's own words find fewer than two memories, let memory's model suggest 2-3 alternative search words and look again.",
        "Catches past work worded differently (the same effort remembered under three names). Off by default: recall already finds by meaning, and the agent searches memory itself when it needs more. One small model call on such a message, waited for; a failed one is dropped and recall goes on with the message's own keywords. Its cost shows in Usage under Memory → LLM usage.",
      ),
    }),
    capture: group("What gets recorded and learned.", {
      turns: p(
        "boolean",
        true,
        "Archive every conversation turn byte for byte (encrypted at rest).",
        "The archive is what session search and `@mem load` read. Off: an outside client's turns are not archived; a chat Filament composes keeps its own turns all the same — its history is composed from them and its page shows them — and memory learns nothing from them, and its search, loads and learning read none of them for any other chat, even once this is on again.",
      ),
      learn: p(
        "boolean",
        true,
        "Learn automatically: end states, titles, facts, rules and decisions with memory's model at boundaries (compaction, idle, session end). What you tell the agent to keep, it keeps as you say it, with its memory tools.",
        "Learned items are marked inferred until you confirm them on the Memory page.",
      ),
      idleMinutes: p(
        "number",
        30,
        "A session idle this long counts as a boundary (end state and learning run).",
        "",
      ),
      dailyCap: p("number", 200, "Most learned items per day.", ""),
      messageCapBytes: p(
        "number",
        1048576,
        "Largest single message stored in full (bytes), the pictures and files it carries in base64 not counted; bigger ones are stored truncated with a marker.",
        "",
      ),
      inputCapChars: p(
        "number",
        4000,
        "How much of each of your messages feeds search and memory.",
        "The archive still keeps the full bytes.",
      ),
      excludeClients: p("array", [], "User-agent prefixes that never get memory.", "", {
        itemType: "string",
      }),
      excludeModels: p(
        "array",
        [],
        "Model-name patterns that never get memory (same `*` syntax as routes).",
        "",
        { itemType: "string" },
      ),
      excludeFolders: p(
        "array",
        [],
        "Working directories that are never captured or recalled (prefix match).",
        "For client work or anything private.",
        { itemType: "string" },
      ),
    }),
    models: group("The model memory works with.", {
      summarizer: p(
        "string",
        "",
        "Memory's model (Settings › Memory › Model): what it learns from finished sessions, curates, rewrites searches and names chats with.",
        "Empty = not set: each call takes the chat's compaction model (context.compaction.model), else the chat's own model — a sub-agent's findings, the chat that launched it; the curator, the project's most recently active chat — else the most recently active chat's model anywhere. A coding agent's model stands as the same model through a provider's route where one serves it, never the agent itself; with none, memory waits and says why. Never the cheapest model by itself: what reads a project's chats is a provider you chose for it. A model named is yours, from any provider, and is first for every memory call. `off` = none: memory learns nothing from sessions, and a side model's summary needs a model named in Settings › Context. Calls go through Filament, so they show in Usage.",
      ),
      effort: p(
        "string",
        "",
        "The effort memory's calls are sent at.",
        "Empty = low: memory reads and files, it does not solve. `model` sends none (the model's own). Else a level the model takes; one it does not take is fitted as every request's is (rules.effort.onUnsupported).",
      ),
    }),
    curator: group("Memory's sleep: a pass over a project's memory between sessions.", {
      enabled: p(
        "boolean",
        true,
        "Run the curator.",
        "A pass over a project runs in the background once memory learned something in it since its last pass and that pass is `everyHours` old — seen when a learning run lands and when a chat of the project starts a turn — and when asked (`@mem curate`); the global claims the same way. It merges memories that say the same thing, keys values so a newer one replaces the older, checks memories whose files changed, judges whether a correction that shared a memory's words says it is wrong, retires what has gone stale and writes the project's dossier. What it would do to your own word it asks you instead (`@mem inbox`); every pass can be undone (`@mem undo r<n>`). Off: no passes; the dossier last written stays, the memories that earned a place since following it, and a project with none has its dossier rendered from its memories by kind.",
      ),
      usesModel: p(
        "boolean",
        true,
        "The curator uses memory's model.",
        "Off: it works by rule alone — it still expires stale threads, retires memories whose files are gone and asks you about the rest, but merges, keys and re-checks nothing, and writes no dossier: the one last written stays, the memories that earned a place since following it, and a project with none has its dossier rendered from its memories by kind.",
      ),
      maxCalls: p("number", 20, "Most model calls one pass makes.", "A pass out of calls stops calling and says so; the steps that need no model still run. Where the dossier will write, its call is kept for it from the steps before it; where a step's last call moves what it is written from, the next pass writes it."),
      everyHours: p("number", 6, "The fewest hours between two passes over one project.", "A pass waits for this long after the last one began, so a project gets at most four a day however much it learns."),
    }),
    commands: group("Commands typed in any chat.", {
      enabled: p(
        "boolean",
        true,
        "Answer `@mem` commands locally.",
        "`@mem status`, `@mem recall <words>`, `@mem sessions <words>`, `@mem load <id> [view]`, `@mem remember <text>`, `@mem rule <text>`, `@mem prefer <text>`, `@mem procedure <How to …>`, `@mem forget <id>`, `@mem off|on`, `@mem new`, `@mem help`.",
      ),
      prefix: p(
        "string",
        "@mem",
        "The command prefix.",
        "`/`, `!` and `#` are captured by Claude Code itself and never reach Filament.",
      ),
    }),
    backups: group("Backups of the memory folder.", {
      enabled: p(
        "boolean",
        false,
        "Back up daily.",
        "A consistent copy (SQLite online backup) of the archive, the Mnemosyne database and memory.json, gzipped, with checksums.",
      ),
      folder: p(
        "string",
        "",
        "Destination folder (a Google Drive for Desktop or OneDrive folder is the practical choice).",
        "",
      ),
      hour: p("number", 3, "Hour of day (0 to 23, local time).", ""),
      keep: p("number", 14, "How many backups to keep.", ""),
    }),
    privacy: group("What stays private.", {
      encryptArchive: p(
        "boolean",
        true,
        "Encrypt archived message bodies with Filament's secret key.",
        "Changing this needs a new archive; the setting applies to new folders.",
      ),
      searchIndex: p(
        "boolean",
        true,
        "Keep a capped plaintext search index of your inputs and final answers (needed for session search).",
        "Off: session search is disabled; memory recall still works.",
      ),
    }),
    rules: group("Rules that act.", {
      act: p(
        "array",
        [],
        "Ids of learned rules allowed to attach a reminder to matching tool results (opt-in per rule), as their memory lines show them (`i12`).",
        "",
        { itemType: "string" },
      ),
    }),
  },
);


export const ALERTS = group(
  "Alerts: Filament comes to find you when something needs attention (a banner on every console page and a line on the tray card).",
  {
    failover: p(
      "boolean",
      true,
      "Alert when a request was saved by a backup provider.",
      "One alert per affected request; the request's row in Traffic carries the full failover trail.",
    ),
    degraded: p(
      "boolean",
      true,
      "Alert when the memory engine is degraded.",
      "Recall then runs on the archive alone; the alert repeats at most once an hour while it stays down.",
    ),
    dailyCostUsd: p(
      "number",
      0,
      "Alert when today's client spend passes this many dollars.",
      "0 turns it off. Checked every 30 seconds against the durable per-day totals; one alert per day.",
    ),
  },
);

/**
 * Filament's co-author line, the trailer a commit made with Filament ends with while `sessions.commitTrailer` is on:
 * the loop's prompt asks it (agent/prompt.js), a coding agent's standing context asks it (app/agent-context.js), and
 * Claude Code's own attribution setting carries it (adapters/agents/acp/toolset.js).
 */
export const FILAMENT_TRAILER = "Co-authored-by: Filament <noreply@filamentdev.com>";
/** What a pull request made with Filament says of it, where an agent's settings take such a line (Claude Code's). */
export const FILAMENT_PR_LINE = "Made with [Filament](https://filamentdev.com)";

export const CONFIG_SCHEMA = group("Filament configuration.", {
  server: SERVER,
  observability: OBSERVABILITY,
  rules: RULES,
  upstreams: p("list", [], "Upstream definitions.", "See the Upstreams page.", { itemSchema: "UPSTREAM" }),
  routes: p("list", [], "Routes, evaluated top to bottom.", "See the Routes page.", { itemSchema: "ROUTE" }),
  sessions: group(
    "Sessions: your defaults for them, a harness turn a restart cut off, an agent idle while its command runs, and Filament's line on the commits its agents make.",
    {
      defaults: p(
        "map",
        {},
        "Your defaults for sessions.",
        "What a session takes where it has not chosen its own, in the session settings' own words (`{ context: { compaction: { thresholdPercent: 70 } } }`): the harness's Settings › Context writes it. It lies over the dashboard's rules where both name a setting, and under a session's own choice. It never carries one session's own state (its model). Outside clients' requests keep following the rules.",
      ),
      resumeAfterRestart: p(
        "boolean",
        true,
        "Go on with a harness turn a restart cut off.",
        "When Filament stops while a harness chat's turn runs (a restart, a crash), its next start keeps what the turn did, then sends the chat a turn of its own that says so and asks the agent to go on from where it stopped — Filament's loop and a coding agent alike. The turn is like any: it asks you for permissions, and Stop stops it. It does not go on where the send would first ask you something (the session asks before compacting and is past its line, or the model changed), nor a second time where the turn it sent was cut again before it ran anything; the cut turn says why. Off: a cut turn waits for your next message. An outside client's turns are never resumed: the client sends again itself.",
      ),
      idleWakeMinutes: p(
        "number",
        5,
        "Minutes an agent may sit idle while its background command runs before Filament checks in (0 is off).",
        "A harness chat's agent that ends its turn while a background command of its own still runs — one it started, one you sent to the background, or its coding agent's own background shell — is sent a turn of Filament's after this many minutes, naming each command and how long it has run, so it can say where it stands, wait on, or stop one that hangs. Anything that starts a turn first cancels it: the command's end, your message, a report, a letter or a come-back. One of those that waits with no turn come for it yet — a letter still sealed, a report not told — puts the check-in off twice, then goes with it. A chat you stopped or archived, or with a question waiting, is not woken. Open tasks on the plan never wake it. Each check-in in a row with nothing else between waits twice as long, to an hour. Whole minutes, 1 to 60; 0 turns it off. Kept across a restart: the commands it watched ended with the Filament that stopped, and the agent is told that instead.",
      ),
      commitTrailer: p(
        "boolean",
        true,
        "End a commit Filament's agent makes with Filament's co-author line.",
        "Filament's agent loop is told that a commit you ask for ends its message with the trailer `Co-authored-by: Filament <noreply@filamentdev.com>`, so the repository's history shows the work Filament helped with — the chat's agent, its sub-agents and a team's lead and workers alike. Coding agents are told the same in their standing context, and Claude Code's own attribution setting carries the line (and \"Made with Filament\" on a pull request) in place of its own. Off: the message is in the repository's own style alone, and Claude Code's attribution stays hidden. Codex's own line is its ChatGPT workspace's to say: no setting of Codex's turns it off. It is one sentence of the loop's prompt, either way the same bytes turn to turn, so the provider's cache holds; a flip takes effect at each chat's next turn, which writes the cache anew once — Claude Code's session is opened again with its new setting then.",
      ),
    },
  ),
  agentLoop: group(
    "The agent loop: one model with Filament's file and shell tools, run server-side. The harness drives every LLM route through it (a plain route picked there runs the loop), and Filament's own calls name it `agent/<model>`; an outside client's request goes to the model it names.",
    {
      permissions: p(
        "string",
        "edit",
        "What the agent may do without asking.",
        "A command that only reads runs in every mode — on the bash hand in a real bash (Git Bash, bash or sh), `ls`, `cat`, `head`, `tail`, `wc`, `grep`, `rg`, `find`, `pwd` or `echo` with options that only read, on paths inside the working folder, after a `cd` into one of its folders too; a command Filament cannot tell only reads is asked about or refused with the reason (a write, a path outside, a program it does not know). `read-only`: reads, searches and those commands run; a write or any other command is refused in words. `edit`: writes and edits inside the working folder run free too; any other shell command asks first. `ask`: every write, edit and other command asks. `auto`: nothing asks (bash still runs with a filtered environment, no API keys). Asking pauses the turn on a question: the harness's card answers it — Allow runs the call, and Deny or any other message you type refuses it, delivered to the model in your words; /allow alone, typed or from a client that draws no card, allows it. Nothing reads your words for a yes. The mode is enforced at the tool gate and never changes the loop's system prompt or tool list, so switching it mid-task — restrictive before a risky step, loose after — costs no cache. `edit` is the mode people actually work in; ask-on-every-write is the mode nobody keeps on.",
        { options: ["read-only", "edit", "ask", "auto"] },
      ),
      systemPrompt: p(
        "string",
        "",
        "Your own system prompt for agent/<model> turns. Empty = the built-in one.",
        "When set, your text replaces the loop's built-in role and report sentences; the folder, tools and steering lines are still appended after it, so the loop keeps working. The assembled prompt — built-in or with your overlay — is on the console's Settings → Prompts page.",
        { multiline: true, rows: 8 },
      ),
      roots: p(
        "array",
        [],
        "Folders the agent may work in; the working folder must lie under one of them.",
        "Absolute folder paths (`C:\\work`, `/home/me/code`; a filesystem root is allowed, a bare drive letter is not a folder). The working folder comes from the client's `x-filament-cwd` header (the harness sends it), else from the project memory names for the chat; it is judged as the filesystem resolves it, so a link under a listed root that points elsewhere is judged by where it points. A folder outside this list, or one that does not exist, is refused in words; a folder on a network share (`\\\\host\\share\\…`) whose share no listed root names is outside, judged without asking the share. Empty means any folder the process can reach, a network share's too — allowed only while the listener is loopback-only (`server.host` localhost, a 127.x.x.x address, ::1 or ::ffff:127.x.x.x); on an exposed listener an empty list refuses every turn until you name the folders, a share's before it is asked.",
        { itemType: "string" },
      ),
      envPass: p(
        "array",
        [],
        "Environment variables the commands Filament runs are also given, by name.",
        "A command Filament runs for an agent — the loop's `bash` and `powershell`, a background command, a terminal a coding agent asks Filament for, Filament's own Bash over MCP — and a program it starts for you (a hook, an MCP server on this computer, a language server, a dashboard's command, a script watcher) gets a filtered copy of the environment Filament was started with: what a build, a test or git needs and that is no secret. That is the PATH, your home and the system's folders, locale, proxies, certificate bundles, the ssh agent's socket, git's author and committer and its other `GIT_*`, `npm_config_*`, the toolchain and SDK homes and build settings Filament knows, and which cloud profile, kubeconfig or Docker a tool uses. Never a `GIT_*` or `npm_config_*` name that reads like a secret (`key`, `token`, `secret`, `password`, `credential`, `auth`, `session`, `cookie`, `private`), a value that is an address with a password in it (`http://user:password@proxy`), git's config by environment (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_n`, `GIT_CONFIG_VALUE_n`), or anything the list does not know. A name listed here goes through whatever it reads like or holds: `HTTPS_PROXY` whose address carries a password, a licence file's path, an SDK's home Filament does not know. Names only, never a value; on Windows in any case; one of Filament's own (`FILAMENT_*`) is refused. It holds from the next command started: a program already running keeps the environment it started with. A coding agent's own shell is not Filament's: it has the environment its agent was started with (`upstreams[].acp.envRemove` withholds from that).",
        { itemType: "string" },
      ),
      resultCapChars: p(
        "number",
        0,
        "A tool result longer than this many characters reaches the model as its head plus a pointer.",
        "The whole result is archived and `filament_recall` brings it back, so nothing is lost — the cap keeps one huge read or command dump from riding every remaining round of the turn at full size. It bites the moment the result lands, never retroactively, so the prefix stays byte-stable and the provider's cache survives. 0 disables it; a session's `loop.resultCapChars` overrides this for that session.",
      ),
      learnedPermissions: group("What the loop learns from the permissions you grant.", {
        afterApprovals: p(
          "number",
          5,
          "Approvals of the same call shape in a project before memory offers an always-allow. 0 learns nothing.",
          "The harness's card offers Always allow in this project from a call's first ask, for the call's shape: a shell command's head word and subcommand (`npm test`, `git status` — flags, paths and arguments do not count, and a command with pipes, chains or redirects is never learned), a write's or edit's file class (`*.md`). Each Allow is also counted per project under the shape; at the count an always-allow is offered once, as a memory item of kind permission (inferred) named in the reply, for a client that draws no card; confirming it on the Memory page lets that shape run without asking in that project, dismissing it keeps the question and the card's offer away. A confirmed rule is one shape, never all commands, and never reaches outside the working folder. Rules you already confirmed keep working at 0.",
        ),
      }),
      treeSnapshots: p(
        "boolean",
        true,
        "Snapshot the working tree after every round in which the loop's hands wrote, or, in the harness, a coding agent's.",
        "A commit object on a hidden git ref (`refs/filament/snapshots/<session>/<turn>-<round>`) of the repository the working folder belongs to: no branch moves, the index and `git status` are untouched. A fork of the session at that turn (`POST /api/sessions/:id/fork { atTurn, worktree: true }`) checks the snapshot out as a detached worktree beside the repository (with the repository's hooks off, as for every copy Filament makes; Git LFS content checks out), so the files rewind with the conversation. The turn's \"N files changed\" card in the harness chat is the diff between a turn's snapshots — the tree's own truth, hand edits included. The snapshots live in the repository's object store: they hold every file `git status` would show (ignored files stay out), and a `git push --mirror` publishes them like any ref. A folder with no git gets no snapshot, said in the reply's record. Off: forks rewind the conversation only, and the chat's turns carry no changes card.",
      ),
      readerModel: p(
        "string",
        "",
        "The cheap model behind `delegate_read` — a route name.",
        "`delegate_read` has that model read a set of files and answer one question, so the agent's own context never carries the files. Empty: the tool is not offered and the agent reads for itself. It must be a plain route: an `agent/…` name or a coding-agent upstream here would give the reader hands of its own, so such a value is refused at the start of the turn and the tool is left out, with a note in the reply.",
      ),
      subagents: group("Sub-agents: a fresh agent loop on one task, launched by the agent (the `agent` tool), from the harness's spawn widget, or by `/subagent` in a chat Filament runs; a team's workers are sub-agents its lead launches. A session's `subagents.*` settings override `ask`, `teams`, `worktree` and `workspace`; `slots` holds across every chat.", {
        slots: p(
          "list",
          [],
          "How many agents run on each model at once, across every chat and every team.",
          "Each entry is `{upstream, model, n}`: a source's id (a provider's upstream, or a coding agent's account), the model's name as that source receives it, and how many agents run on it at once, 1 to 64; each model once at each source. A model with no entry has no limit. Every chat's sub-agents and every lead's workers share these: a launch takes a free slot, the next row of its list takes it where one is full, a team's worker waits for one where every slot is busy (its card says for what), and others are refused in words. A number counts agents only: Filament's gate on requests holds to what the provider showed, never to this (a price card's `maxConcurrency` caps nothing either). A provider's 429 lowers a model's number for a while; its rate-limit headers count requests a minute, and lower none. Each model's row on Settings › Providers, or on its coding agent's page, writes it.",
        ),
        ask: p(
          "array",
          [],
          "The saved agents a session's main agent may ask, by tag.",
          "Empty: nobody. Each tag names a card in the harness's Library, where a card's tick “Your agent may use it” writes this list. The `agent` tool then lists these agents, each with the line that says what it is good for, and the agent's instructions say when to ask one. A session's own `subagents.ask` replaces the list for that session.",
          { itemType: "string" },
        ),
        teams: p(
          "array",
          ["bughunters"],
          "The teams a session's main agent may start on the side by itself, by key.",
          "Each key names a team on the harness's Library › Agents page, where its tick \"Your agent may use it\" writes this list; the one that ships ticked reads and changes nothing (BugHunters), and a team that changes files starts by itself only once you tick it. A key no team has is left out, and a list of none but those is this default again. The `team` tool's send refuses any other in words, and its status names the rest as yours to send. A team you start yourself is always yours. Empty: none. A session's own `subagents.teams` replaces this list.",
          { itemType: "string" },
        ),
        worktree: p(
          "boolean",
          true,
          "A sub-agent that changes files works in its own git worktree, and its changes wait to be applied.",
          "The worktree is a detached checkout of the project as it stands at the launch — uncommitted changes and untracked files included, ignored files left out (dependency folders such as `node_modules` are linked in so checks can run) — under `<git dir>/filament-worktrees/`, so the sub-agent never collides with the main agent's edits. When it ends, its work is captured on hidden refs (`refs/filament/subagents/<id>/…`) and its report lists the files it changed; they reach the session's folder only when applied — by the agent (`agent` with `apply_changes`), the harness's Apply, or `/subagent apply` — each file merged three-way with what changed meanwhile, all or nothing (the index and HEAD untouched; it works after a restart too). An explorer never gets one (it cannot write), and a folder outside git always shares. Off: writing sub-agents work in the session's folder, beside the main agent. A session's `subagents.worktree`, or a launch, may say otherwise.",
        ),
        workspace: p(
          "enum",
          "auto",
          "Where a sub-agent that changes files works: Auto, a patch, a worktree, or the session's folder.",
          "`auto`: a builder on Filament's own loop gets a patch — no checkout: a folder at its worktree's place holding only the files it read or wrote, the rest read from the project as it stood at its launch, its work captured on the same hidden refs — and moves to a worktree at the same folder once it runs a command, a language server or a hook; a coding agent, one that runs in a copy, a worker or task with a check, a brief or card that names commands, attempts, a session with hooks on read, write or edit or with MCP servers on this computer (which its patch's folder would hold), and a card whose last three launches here each moved within five calls get a worktree from the start. `patch` and `worktree` say which for every builder (a coding agent, or a session with MCP servers on this computer, always gets a worktree); `folder` works in the session's folder. A worktree on auto is a copy-on-write clone where the drive clones files and git ignores build caches here (they come warm), a sparse checkout of the folders its launch names for a builder in a big repository (widened as it reads or writes outside them), else every file checked out; `worktree` always checks out every file. On a big repository a worktree costs minutes and gigabytes per builder; a patch costs a ref and a folder. `auto` here leaves each session's `subagents.worktree` its say (off: the folder); a session's `subagents.workspace`, or a launch, may say otherwise.",
          { options: ["auto", "patch", "worktree", "folder"] },
        ),
      }),
      web: group("The web hands (`web_fetch`, `web_search`) a session may switch on with `plugins.web.*` in its settings.", {
        searchEndpoint: p(
          "string",
          "https://html.duckduckgo.com/html/?q={query}",
          "Where `web_search` sends a query: a URL with `{query}` where the encoded words go.",
          "The answer is read as JSON (a `results` array of title, url and snippet — SearXNG and the like) or as an HTML results page (DuckDuckGo's `html.duckduckgo.com`; any page's links as a last resort). A URL without `{query}` gets `?q=`. The endpoint is judged like any fetched host: a private or local one needs `allowPrivate`. Where `searchProvider` names a search service, this endpoint answers only when the service has no key or fails, and the result says so.",
        ),
        searchProvider: p(
          "enum",
          "endpoint",
          "The search service `web_search` asks first, with your key in `searchApiKey`.",
          "`endpoint`: the search endpoint above (DuckDuckGo's HTML page by default — free, but it turns away searches it takes for a bot). `brave` (Brave Search API), `tavily` (Tavily) or `serper` (Serper, Google's results): a search API with your key; the key rides a request header, never the URL. Without `searchApiKey`, the service's own environment variable is read (BRAVE_API_KEY, TAVILY_API_KEY, SERPER_API_KEY). A search the service refuses or fails falls back to the endpoint, and the result names why.",
          { options: ["endpoint", "brave", "tavily", "serper"] },
        ),
        searchApiKey: p(
          "secret",
          "",
          "Your key for the search service `searchProvider` names.",
          "Stored sealed with your other secrets (secret.key), never shown again, and never handed to a model: `web_search` puts it on the service's request header only.",
        ),
        allowPrivate: p(
          "boolean",
          false,
          "Let the web hands reach loopback, private and link-local addresses.",
          "Off: `web_fetch` and `web_search` refuse localhost, 127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16 and their IPv6 kin, on every redirect hop, after resolving the name — a page the model reads could otherwise send it to Filament's own admin API or a cloud metadata service. On: a session may read your own services (a local SearXNG, a dev server); keep it on only where every session's author is you.",
        ),
      }),
    },
  ),
  memory: MEMORY,
  alerts: ALERTS,
  ui: group("The harness page's own choices that hold for this data folder, in the app and in a browser alike.", {
    welcome: group("The welcome tour: ten steps that set Filament up and show what it does.", {
      seen: p(
        "boolean",
        false,
        "The welcome tour was seen.",
        "Off: the harness opens the welcome tour once, on a data folder whose harness has no chat yet — connecting a coding agent or a key, the model new chats start on and its effort, how the agent asks, memory and its side model, the chats you had in other coding agents, a project folder, the agents and teams, the rest of Filament, and what you set. Finished, skipped or closed, it is on, and the tour opens by itself again only while nothing can answer — no coding agent connected, no model that answers —; else when asked: the command center's Welcome tour, the help menu's, or `/welcome`.",
      ),
    }),
    coach: group("The first-run tips: small bubbles beside a control each, shown once (src/ui/harness/coach/coach.json lists them).", {
      seen: p("array", [], "The tips seen, by their ids.", "A tip seen — Got it, Next, a click on its control, Esc, or Skip tips for all of them — never shows again. Empty: each shows the first time its moment comes. The tips' own file can show them all again after each restart (`replayOnRestart`).", {
        itemType: "string",
      }),
    }),
    star: group("The ask for a star on GitHub, at the sidebar's foot (src/http/admin/star.js).", {
      asked: p(
        "boolean",
        false,
        "A star was asked for.",
        "Off: once Filament has been used in five different hours — an hour of a day with a model call in it, as Usage counts them —, the sidebar asks once for a star on GitHub, never while the usage-stats notice still waits, nor on a view-only device. Star on GitHub, which opens the repository in your browser, or Not now turns this on, and it never asks again.",
      ),
    }),
  }),
  telemetry: group("Anonymous usage statistics (Settings › Data and privacy): what Filament sends, and whether it may.", {
    // No fixed default: the build's (services/telemetry.js `officialBuild`), so a person's on is kept as their off is.
    enabled: p(
      "boolean",
      null,
      "Send anonymous usage statistics.",
      "Not set: official builds from filamentdev.com send anonymous usage counts unless you turn them off; builds you make yourself send nothing unless you turn them on. On: once the notice has been shown, Filament sends Filament's relay (t.filamentdev.com, which drops the address it came from and passes it on to PostHog in the EU) an event as it starts and, once a day, a summary of a day it ran on — tokens, cost and speed by provider kind and model, runs by engine, accounts counted by kind, a few features on or counted, requests per hour, the version, system, language and time zone — under an id of its own made for this alone. Never a prompt, a reply, code, a path, a name, an address, a key or an account. Settings › Data and privacy shows the last thing sent, as it went. Off, or `DO_NOT_TRACK=1` or `FILAMENT_TELEMETRY=0` in its environment: nothing is counted or sent.",
    ),
    noticeSeen: p(
      "boolean",
      false,
      "The telemetry notice was shown.",
      "Off: the harness shows the notice about anonymous usage statistics once, and nothing is sent until it has been shown; a Filament started by hand in a terminal says it in its start lines.",
    ),
  }),
  experimental: group("Features still being tried (Settings › Experimental): each is off until you turn it on, and may change or go in a later version.", {
    nameChats: p(
      "boolean",
      false,
      "Name chats with memory's model.",
      "On: as a chat's first message is sent — or its next once this is turned on — memory's model for the chat (`memory.models.summarizer`, Settings › Memory › Model; not set, the chat's compaction model, else its own), reads about 1K tokens of it, the first message (and the answer, where the chat already has one), and names it in a few words while the agent works; the sidebar shows the name come in. A try that failed is made again as the turn ends, the answer read too. Only a chat Filament named from its first message is renamed, once: one you named, or renamed since, keeps yours, and so does one kept from memory (Memory settings leave it out, or its own or its project's `privacy.learn` is off), which memory's model never reads. With no model for memory (turned off, or not set and no chat's model one a provider serves) no chat is renamed; one memory's model fails to name twice keeps its name. Off: a chat keeps the first line of its first message as its name.",
    ),
    parallelizeTasks: p(
      "boolean",
      false,
      "Parallelize tasks.",
      "On, in every chat, it is your consent: where tasks of your agent's task graph can run at once — truly independent: none needs another's work — your agent starts them on sub-agents itself (a coding agent with Filament's agent tool), and no card asks you first. Each works in its own worktree, so they may share a file, the second to land merging at its apply — unless sub-agents work in the chat's folder (Agent loop › Where they edit: Session folder), where tasks that share a file run one after another; tasks that need each other stay in order. Your agent's prompt says so — a coding agent's context —, so when you switch it each chat's prompt is written anew once, at its next message. A plan asked for, or offered and taken, puts the tasks that wait on no other on sub-agents, and they start once you approve it. None in a chat a team leads, whose lead plans its workers' tasks in parallel already. Off, it asks you on a card first: where tasks can run at once your agent suggests them on one, and a sub-agent that changes files it launches is held on one; they start on your Accept, or after 60 seconds if you say nothing; Ignore, or One at a time, keeps the work with your agent. A reviewer, which only reads, is never held. The Plan shows the card's Run them in parallel while it stands.",
    ),
    cursorSdk: p(
      "boolean",
      false,
      "Cursor through its SDK.",
      "On: Settings › Coding agents offers Cursor a second way beside Cursor, its CLI — Cursor's SDK (`@cursor/sdk`) inside Filament's process, signed in with an API key Cursor makes, each key an account of its own — and its models stand in the pickers. Its agent approves its own tools, so its shell and file tools are off and Filament's checked ones do that work; a chat stricter than Auto also runs without its sub-agents and your MCP servers. Off: Cursor is its CLI alone, whose permission questions come to your chat's switch and which signs in with your Cursor login; an upstream on the SDK stays in your settings, its models out of the pickers, and a turn sent to it says to turn this on.",
    ),
    teams: p(
      "boolean",
      false,
      "Teams.",
      "On: teams — a lead that plans, briefs and checks, and workers that do the work, Builders and BugHunters among them — are offered everywhere: Library › Agents and teams holds them, a chat's Agents tab sends one on the side or puts one in charge, your agent has its team tool, `/team` hands a chat to one, and a flow's box may be one. Off: no team starts and nothing offers one — the Library's page is Agents, your agent has no team tool, `/team` answers that teams are off (`/team off` still gives a chat back), and a chat set to be led by a team is answered by your agent, its setting kept for when this is on again. A team already at work finishes, and the team work in your chats stays in their transcripts. Your teams and their settings stay as they are. Switching it writes each chat's tools anew once, at its next message.",
    ),
  }),
});

export const isLeaf = (node) =>
  node && typeof node === "object" && typeof node.type === "string" && "description" in node;

export function defaultsOf(node) {
  if (isLeaf(node)) return structuredClone(node.default);
  const out = {};
  for (const [k, v] of Object.entries(node)) if (k !== "_doc") out[k] = defaultsOf(v);
  return out;
}

export function walk(node, cb, path = []) {
  if (isLeaf(node)) return cb(path.join("."), node);
  for (const [k, v] of Object.entries(node)) if (k !== "_doc") walk(v, cb, [...path, k]);
}

export function getLeaf(node, path) {
  let cur = node;
  for (const k of path.split(".")) {
    if (!cur || isLeaf(cur)) return null;
    cur = cur[k];
  }
  return isLeaf(cur) ? cur : null;
}

export const SCHEMAS = { CONFIG: CONFIG_SCHEMA, RULES, UPSTREAM, ROUTE, SERVER, OBSERVABILITY };

export function schemaAsJson() {
  const strip = (node) => {
    if (isLeaf(node)) return node;
    const out = { _doc: node._doc };
    for (const [k, v] of Object.entries(node)) if (k !== "_doc") out[k] = strip(v);
    return out;
  };
  return {
    config: strip(CONFIG_SCHEMA),
    rules: strip(RULES),
    upstream: strip(UPSTREAM),
    route: strip(ROUTE),
    upstreamTypes: UPSTREAM_TYPES,
    effortLevels: EFFORT_LEVELS,
    // Display enums the dashboard builds UI from, so a label or a list of choices is never hard-coded in the
    // browser where it can drift from the server that actually produces the value.
    trafficSources: TRAFFIC_SOURCES,
    memoryPurposes: MEMORY_PURPOSES,
    // Operation kinds with their labels, hints and `noisy` flag, so the System tab's chips are built from the same
    // list the recorder validates against. A kind the browser had to name itself is a kind that drifts.
    opKinds: OP_KINDS,
  };
}
