// @ts-check
// Usage as the scanner or the reply reported it, split into the record's token counts and, when the provider stated
// what it charged (xAI's cost_in_usd_ticks), the exact cost in place of the price-table estimate. A fast request that
// asked for a service tier (xAI's and OpenAI's priority processing) bills fast only when the reply names that tier:
// a busy provider serves the default one instead, at the default price. A flex request (Providers P5) is stricter,
// being the cheaper side: it bills at the flex price only when the reply names its tier — another tier, or none
// named, is the standard price, and the record says so. A usage that carried a cache count marks the record's tokens
// (`cacheSeen: true`, core/cache-facts.js): the record's columns are numbers either way, and a 0 its provider counted
// is told from one nothing said.
import { saysCache } from "./cache-facts.js";

/**
 * @param {{ tokens?: Record<string, any>, speed?: string, fastTier?: string, flexTier?: string, changes?: string[] }} rec
 * @param {any} u  token counts by kind, plus `providerCost` when the provider stated it and `tier` when it named one
 * @returns {{ tokens: Record<string, any>, cost?: number, costSource?: "provider", servedTier?: string, speed?: undefined, changes?: string[] }}
 */
export function usageAndCost(rec, u) {
  const { providerCost, tier, ...tokens } = u || {};
  const served = typeof tier === "string" && tier ? tier : null;
  const downgraded = rec.speed === "fast" && typeof rec.fastTier === "string" && !!served && served !== rec.fastTier;
  const flexWant = typeof rec.flexTier === "string" && rec.flexTier ? rec.flexTier : null;
  const unconfirmed = rec.speed === "flex" && !(flexWant && served === flexWant);
  const flexWhy = !flexWant
    ? "the flex tier's fields name no service_tier, so the reply cannot confirm it"
    : served
      ? `the flex tier requested "${flexWant}"; the provider served "${served}"`
      : `the flex tier requested "${flexWant}"; the reply did not say which tier served it`;
  return {
    tokens: { ...rec.tokens, ...tokens, ...(saysCache(tokens.cacheRead, tokens.cacheWrite) ? { cacheSeen: true } : {}) },
    ...(served ? { servedTier: served } : {}),
    ...(downgraded
      ? { speed: undefined, changes: [...(rec.changes || []), `fast mode requested the "${rec.fastTier}" tier; the provider served "${served}" — billed at the standard price`] }
      : unconfirmed
        ? { speed: undefined, changes: [...(rec.changes || []), `${flexWhy} — billed at the standard price`] }
        : {}),
    ...(typeof providerCost === "number"
      ? { cost: Math.round(providerCost * 1e6) / 1e6, costSource: "provider" }
      : {}),
  };
}
