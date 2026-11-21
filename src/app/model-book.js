// @ts-check
// The models a sub-agent's launch reads (HarnessV4_Tasks E23): the catalogue as the harness picker has it — every
// route's names and what the providers and coding agents listed, each agent's model with its own label — folded into
// families once per change, never per launch. A save, or a provider's or an agent's list answering, marks it stale,
// and the next read reads it again from the caches (a read never asks a provider). A launch reads it at once (`now`);
// one that matches a name as a person says it waits for a stale book to be read (`fresh`).
import { buildFamilies } from "../core/model-families.js";
import { findUpstream } from "../core/routing.js";
import { isAgentUpstream } from "../core/schema.js";

/**
 * The catalogue's rows as the harness reads them: a coding agent's model says so, with its name and description in
 * the agent's own words where its listing gave them (HarnessV3-ACP AF2). In place.
 * @param {any} cfg @param {any[]} rows
 * @param {((upstreamId: string) => Record<string, { label?: string, note?: string }> | null | undefined) | null} [labelsFor]
 */
export function withAgentWords(cfg, rows, labelsFor = null) {
  for (const m of rows) {
    if (isAgentUpstream(findUpstream(cfg, m.upstream))) m.codingAgent = true;
    const own = labelsFor?.(m.upstream)?.[m.upstreamModel];
    if (own?.label) m.label = String(own.label);
    if (own?.note) m.note = String(own.note);
  }
  return rows;
}

/**
 * @typedef {{ cfg: any, families: readonly import("../core/model-families.js").Family[] }} ModelBook
 * @param {{ config: { get: () => any }, rows: () => Promise<any[]>,
 *   labelsFor?: (upstreamId: string) => Record<string, { label?: string, note?: string }> | null | undefined,
 *   log?: (level: string, msg: string) => void }} o  `rows`: the catalogue's rows, read from the caches
 */
export function createModelBook({ config, rows, labelsFor = () => null, log = () => {} }) {
  /** @type {ModelBook | null} */
  let book = null;
  let stale = true;
  /** @type {Promise<void> | null} */
  let reading = null;
  const read = () => {
    if (reading) return reading;
    stale = false;
    reading = (async () => {
      try {
        const cfg = config.get();
        const list = withAgentWords(cfg, await rows(), labelsFor);
        book = { cfg, families: Object.freeze(buildFamilies(cfg, list)) };
      } catch (/** @type {any} */ e) {
        stale = true;
        log("warn", `models: the list a sub-agent's launch reads could not be read (${e?.message || e})`);
      } finally {
        reading = null;
      }
    })();
    return reading;
  };
  return {
    /** The catalogue changed: the next read reads it again. */
    stale() {
      stale = true;
    },
    /** The book as it stands — null before its first read — read again in the background where it is stale. @returns {ModelBook | null} */
    now() {
      if (stale) void read();
      return book;
    },
    /** The book, read again first where it is stale or being read. @returns {Promise<ModelBook | null>} */
    async fresh() {
      // A change that lands while it is read marks it stale again: read once more, at most twice over.
      for (let i = 0; i < 3 && (stale || reading); i++) await read();
      return book;
    },
  };
}
