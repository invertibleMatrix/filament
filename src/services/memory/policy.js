// A session's own settings, read from and written to its settings document (services/session-settings.js), one
// store for every client (HarnessV3 Step 1): an outside client's chain and a harness chain
// resolve the same three layers, so a command typed in any chat, the dashboard and the facade all change the same
// knob. With no chain (memory off, or a global-only read) the document is the global layer alone, and the reads return
// the global answers. The goal stays on the chain's meta: it is state about the session, not a setting.
import { applyPatch, flatten, globalLayer, resolveChainSettings, resolveSettings } from "../session-settings.js";

/**
 * @param {{
 *   archive: () => any,
 *   archiveWhy: () => string,
 *   config: () => any,
 *   now: () => number,
 * }} deps — read live: the archive opens and closes with memory, the config is the store's current object.
 */
export class SessionPolicies {
  constructor({ archive, archiveWhy, config, now }) {
    Object.assign(this, { archive, archiveWhy, config, now });
  }

  /**
   * The chain's settings document, resolved; the global layer alone when there is no chain to resolve (memory off,
   * or a global read with no chain id). One resolver for every caller — the commands, the pipeline stages, the
   * dashboard — so they can never disagree about what a session's knobs say.
   * @param {string | null} chainId
   */
  docFor(chainId = null) {
    const cfg = this.config();
    const a = this.archive();
    return (chainId && a ? resolveChainSettings(a, cfg, String(chainId)) : null) || resolveSettings({ global: globalLayer(cfg) });
  }

  /**
   * The one writer: change the session's own layer of the settings document. `patch` sets knobs (nested or dotted),
   * `unset` returns them to the layers below. Validation problems come back as `errors` naming the offending keys
   * and nothing is written; only a missing archive or chain throws. Validation knows the layer (HarnessV3 Step 2
   * D3): a session's own layer accepts every knob.
   * @param {string} chainId @param {{ patch?: any, unset?: string[] }} change
   * @returns {{ layer: any, changes: { path: string, from: any, to: any, live: boolean }[], errors: string[] }}
   */
  patchSession(chainId, { patch = {}, unset = [] } = {}) {
    if (!this.archive()) throw new Error(`no archive: ${this.archiveWhy()}`);
    const ch = this.archive().getChain(String(chainId || ""));
    if (!ch) throw new Error("no such session");
    const r = applyPatch(this.archive().chainSettings(ch.id) || {}, { patch, unset }, { at: "session" });
    if (!r.errors.length && r.changes.length)
      this.archive().setChainSettings(ch.id, r.layer && Object.keys(flatten(r.layer)).length ? r.layer : null);
    return r;
  }

  // The goal (WP-I): one objective per session, on the chain meta, so it survives
  // compactions, client restarts and Filament restarts, and a fork carries it. Read as its one key of the meta, which
  // grows with the chat: the chain is not read whole for it.
  /** @param {string} chainId @returns {import("./goal.js").Goal | null} */
  goalFor(chainId) {
    try {
      return this.archive()?.metaOf(chainId, ["goal"])?.goal || null;
    } catch {
      return null;
    }
  }
  /** @param {string} chainId @param {import("./goal.js").Goal | null} goal */
  setGoal(chainId, goal) {
    if (!this.archive()) throw new Error(`no archive: ${this.archiveWhy()}`);
    const ch = this.archive().getChain(chainId);
    if (!ch) throw new Error("no such session");
    const meta = ch.meta || {};
    meta.goal = goal || undefined;
    this.archive().setMeta(chainId, meta);
    return goal || null;
  }
}
