// @ts-check
// An agent's updates read against ACP's own schema, as pinned (HarnessV3-ACP AC0-2): the reader's note on a kind it
// does not draw, or on an update that lacks what the schema requires, names the schema's version.
import { ACP_SCHEMA } from "./schema-pin.js";

/**
 * @typedef {{ sdk: string, updates: Record<string, Record<string, string>>, unstable: string[],
 *   agentCapabilities: string[], sessionCapabilities: string[] }} Pin
 */

/** A value's JSON type, as the pin spells types. @param {unknown} v */
const jsonType = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/** Fields in words: "a", "a and b", "a, b and c". @param {string[]} fields */
const inWords = (fields) => (fields.length > 1 ? `${fields.slice(0, -1).join(", ")} and ${fields.at(-1)}` : fields[0]);

/**
 * The fields of a kind in the schema that are absent, or of a type it does not allow; none when the update fits, and
 * none for a kind outside the schema.
 * @param {any} u @param {Pin} [pin]
 * @returns {string[]}
 */
export function missingFields(u, pin = ACP_SCHEMA) {
  const wants = pin.updates[String(u?.sessionUpdate)];
  if (!wants) return [];
  return Object.entries(wants)
    .filter(([f, t]) => u[f] === undefined || (t !== "any" && !t.split("|").includes(jsonType(u[f]))))
    .map(([f]) => f);
}

/**
 * The note on an update kind the reader does not draw: one outside the schema, or one in it that Filament does not
 * draw yet, with the schema's version, and whether the schema marks the kind unstable.
 * @param {string} kind @param {Pin} [pin]
 */
export function undrawnNote(kind, pin = ACP_SCHEMA) {
  if (!Object.hasOwn(pin.updates, kind)) return `acp: the agent sent ${kind}, which ACP schema ${pin.sdk} does not have; ignored`;
  const unstable = pin.unstable.includes(kind) ? ", marked unstable there" : "";
  return `acp: the agent sent ${kind} (in ACP schema ${pin.sdk}${unstable}); Filament does not draw it yet`;
}

/**
 * The note on an update of a kind the reader draws that lacks what the schema requires: drawn as far as it goes.
 * @param {string} kind @param {string[]} fields @param {Pin} [pin]
 */
export const missingNote = (kind, fields, pin = ACP_SCHEMA) =>
  `acp: the agent sent ${kind} without ${inWords(fields)}, which ACP schema ${pin.sdk} requires; read as far as it goes`;
