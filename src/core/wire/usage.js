// @ts-check
// Token usage as each wire format reports it → Filament's one shape { input, output, cacheRead, cacheWrite, cacheWrite1h,
// thinking, providerCost }. OpenAI-compatible servers disagree among themselves about cached tokens; both spellings are read.
// A cache count is set only where the usage carried one, at 0 too: a usage with neither `cacheRead` nor `cacheWrite`
// is one whose provider said nothing of its cache (core/cache-facts.js `saysCache`).

export function usageFromAnthropic(u, into = {}) {
  if (!u || typeof u !== "object") return into;
  if (u.input_tokens != null) into.input = u.input_tokens;
  if (u.output_tokens != null) into.output = u.output_tokens;
  if (u.cache_read_input_tokens != null) into.cacheRead = u.cache_read_input_tokens;
  if (u.cache_creation_input_tokens != null) into.cacheWrite = u.cache_creation_input_tokens;
  // Of those writes, the ones an hour's cache holds (Anthropic's `cache_creation` split): they cost twice the input
  // price, not the 1.25× of five minutes'.
  if (u.cache_creation?.ephemeral_1h_input_tokens != null) into.cacheWrite1h = u.cache_creation.ephemeral_1h_input_tokens;
  if (u.output_tokens_details?.thinking_tokens != null)
    into.thinking = u.output_tokens_details.thinking_tokens;
  return into;
}

export function usageFromOpenAI(u, into = {}) {
  if (!u || typeof u !== "object") return into;
  if (u.prompt_tokens != null) into.input = u.prompt_tokens;
  if (u.completion_tokens != null) into.output = u.completion_tokens;
  if (u.prompt_tokens_details?.cached_tokens != null) {
    into.cacheRead = u.prompt_tokens_details.cached_tokens;
    into.input = Math.max(0, (u.prompt_tokens || 0) - into.cacheRead);
  }
  if (u.prompt_cache_hit_tokens != null) {
    into.cacheRead = u.prompt_cache_hit_tokens;
    // The hits are part of the prompt: a server that says no misses leaves them to be taken out of it.
    into.input =
      u.prompt_cache_miss_tokens ?? (u.prompt_tokens != null ? Math.max(0, u.prompt_tokens - into.cacheRead) : into.input);
  }
  if (u.completion_tokens_details?.reasoning_tokens != null)
    into.thinking = u.completion_tokens_details.reasoning_tokens;
  if (typeof u.cost_in_usd_ticks === "number") into.providerCost = u.cost_in_usd_ticks / 1e10; // xAI states what it charged (1 tick = 1e-10 USD)
  return into;
}

// A Responses object's usage; input excludes the cached part, like the OpenAI reader.
export function usageFromResponses(u, into = {}) {
  if (!u || typeof u !== "object") return into;
  const cached = u.input_tokens_details?.cached_tokens || 0;
  if (u.input_tokens != null) into.input = Math.max(0, u.input_tokens - cached);
  if (u.input_tokens_details?.cached_tokens != null) into.cacheRead = cached;
  if (u.output_tokens != null) into.output = u.output_tokens;
  if (u.output_tokens_details?.reasoning_tokens != null)
    into.thinking = u.output_tokens_details.reasoning_tokens;
  if (typeof u.cost_in_usd_ticks === "number") into.providerCost = u.cost_in_usd_ticks / 1e10; // xAI states what it charged (1 tick = 1e-10 USD)
  return into;
}

/**
 * The service tier a provider says it served (xAI and OpenAI name it on every chunk: `"service_tier":"priority"`),
 * read off the raw upstream bytes — the stream the client gets may be translated and carry it no more. The last one
 * named wins. A tier quoted inside a model's own text arrives escaped (`\"service_tier\"`) and never matches.
 */
export function createTierSniffer() {
  let tail = "";
  /** @type {string | null} */
  let tier = null;
  return {
    /** @param {string} text */
    feed(text) {
      const s = tail + String(text || "");
      for (const m of s.matchAll(/"service_tier"\s*:\s*"([A-Za-z0-9_-]{1,32})"/g)) tier = m[1];
      tail = s.slice(-64);
    },
    /** @returns {string | null} */
    get tier() {
      return tier;
    },
  };
}
