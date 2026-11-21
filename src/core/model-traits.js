// @ts-check
// What Filament knows about a model's reasoning and windows before asking it — the built-in price table's sibling, versioned
// with the app: the effort levels a family takes and the one it uses when none is sent, and the context windows it
// can work in beyond its standard one. Pure data and one lookup. The operator's rules can narrow what is sent
// (`effort.modelCaps` wins over this table for a family it names); nothing here widens them.
import { EFFORT_LEVELS, FAMILIES } from "./schema.js";

/**
 * A family's traits. `efforts` lists the levels it accepts, in EFFORT_LEVELS order — an empty list: it takes no effort
 * field at all; absent: Filament does not know. `effortDefault` is the level the provider uses when none is sent.
 * `windows` are the context windows it can work in (tokens), the standard one included.
 * @typedef {{ match: string, efforts?: readonly string[], effortDefault?: string, windows?: readonly number[] }} ModelTraits
 */

const ALL = EFFORT_LEVELS;
const LONG = Object.freeze([200_000, 1_000_000]);

/** First match wins; patterns are tested case-insensitively against the model name as it is sent (path dropped). @type {readonly ModelTraits[]} */
export const MODEL_TRAITS = Object.freeze([
  // Anthropic (docs, September 2026). Haiku 4.5, Sonnet 4.5 and the older Opus take no effort field; Opus and Sonnet
  // 4.6 have no xhigh. The 1M window is generally available on 4.6 and newer at the standard price — Filament still
  // starts a session at 200K, so a longer history is a choice, not a surprise on the bill.
  { match: FAMILIES.noEffort, efforts: [] },
  { match: FAMILIES.noXhigh, efforts: ["low", "medium", "high", "max"], effortDefault: "high", windows: LONG },
  { match: FAMILIES.longWindow, efforts: ALL, effortDefault: "high", windows: LONG },
  { match: "claude-(fable|mythos|opus-5|sonnet-5)", efforts: ALL, effortDefault: "high" },
  // Claude Code's own aliases: `opus`, `sonnet` are today's Opus and Sonnet; Haiku takes no effort.
  { match: "^(opus|sonnet)(\\[1m\\])?$", efforts: ALL, effortDefault: "high" },
  { match: "^haiku", efforts: [] },
  // xAI: reasoning_effort low / medium / high, high when none is sent; reasoning cannot be switched off.
  { match: "^grok-4[.-]20.*non-reasoning", efforts: [] },
  { match: "^grok-4\\.[3-9](?![0-9])", efforts: ["low", "medium", "high"], effortDefault: "high" },
  // OpenAI: GPT-5.6 adds max; 5.5 and earlier stop at xhigh. Medium when none is sent.
  { match: "^gpt-5[.-]6", efforts: ALL, effortDefault: "medium" },
  { match: "^gpt-5([.-][0-5])?(?![0-9])", efforts: ["low", "medium", "high", "xhigh"], effortDefault: "medium" },
]);

const rxCache = new Map();
/** @param {string} pattern */
const rxOf = (pattern) => {
  if (!rxCache.has(pattern)) {
    let r = null;
    try {
      r = new RegExp(pattern, "i");
    } catch {
      r = null;
    }
    rxCache.set(pattern, r);
  }
  return rxCache.get(pattern);
};

/** The model name a trait pattern is tested against: the last path segment, a date stamp dropped
 *  ("anthropic/claude-haiku-4-5-20251001" → "claude-haiku-4-5"). @param {unknown} model */
export const traitName = (model) => (String(model || "").split("/").pop() || "").replace(/-\d{8}$/, "");

/**
 * The built-in traits of a model, or null when Filament knows nothing about it.
 * @param {unknown} model @returns {ModelTraits | null}
 */
export function traitsOf(model) {
  const name = traitName(model);
  if (!name) return null;
  for (const t of MODEL_TRAITS) if (rxOf(t.match)?.test(name)) return t;
  return null;
}

/**
 * The effort levels the table says a model accepts, or null when it does not know.
 * @param {unknown} model @returns {string[] | null}
 */
export function builtinEffortsOf(model) {
  const t = traitsOf(model);
  return t && Array.isArray(t.efforts) ? [...t.efforts] : null;
}
