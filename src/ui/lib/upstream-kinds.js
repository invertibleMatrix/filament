// @ts-check
// Which upstreams are coding agents, and the short word for each kind, as the server's type table says (`/api/schema`'s
// upstreamTypes, core/schema.js UPSTREAM_TYPES): no page keeps its own list of agent types.
import { state } from "../runtime.js";

/** @param {any} u an upstream config entry, or null */
export const isAgentUp = (u) => !!u && !!(/** @type {any} */ (state.schema))?.upstreamTypes?.[u.type]?.agent;

/**
 * The short word for an upstream's kind ("coding agent", "Cursor SDK"), else its type's label without the aside.
 * @param {any} u an upstream config entry, or null
 */
export const kindOf = (u) => {
  if (!u) return "";
  const t = (/** @type {any} */ (state.schema))?.upstreamTypes?.[u.type];
  return t?.kind || String(t?.label || u.type).replace(/ \(.*\)$/, "");
};
