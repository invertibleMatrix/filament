// @ts-check
// The admin API's Coding agents area (HarnessV3-ACP AC3-8): Settings → Coding agents' entries, with the registry's
// age (read again when the section opens on a copy older than a day); the registry read again now; its agents' icons,
// served from Filament's own address under a policy that runs nothing; an agent installed (and its install stopped),
// connected, turned off, its models asked for, and removed from this computer. A change is answered with the entries
// as they then stand; a refusal with its status and its words.
import { readFileSync } from "node:fs";
import { sendJson } from "../../app/pipeline/respond.js";
import { drives } from "../guards.js";

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function codingAgentRoutes(a) {
  const { codingAgents } = a;
  /** @param {any} r */
  const idOf = (r) => decodeURIComponent(r.params.id);
  /**
   * A change, answered with what it said and the entries as they then stand; its refusal with its status.
   * @param {any} r @param {() => Promise<any> | any} fn
   */
  const changed = async (r, fn) => {
    try {
      const out = (await fn()) || {};
      return sendJson(r.res, 200, { ...out, ...codingAgents.list() });
    } catch (/** @type {any} */ e) {
      return sendJson(r.res, e?.status || 502, { error: e?.message || String(e) });
    }
  };
  return [
    [
      "GET",
      "/coding-agents",
      (r) => {
        // A view-only device reads the list as it stands: the registry fetched afresh is this machine's to do.
        if (drives(r.who)) codingAgents.refreshIfStale();
        return sendJson(r.res, 200, codingAgents.list());
      },
    ],
    ["POST", "/coding-agents/registry/refresh", (r) => changed(r, () => codingAgents.refreshRegistry())],
    [
      "GET",
      "/coding-agents/icons/:id",
      (r) => {
        const file = codingAgents.iconOf(idOf(r));
        if (!file) return sendJson(r.res, 404, { error: "no icon for that agent" });
        // An SVG the registry made, checked when it was kept: served as an image that runs nothing, wherever it's
        // opened.
        r.res.writeHead(200, {
          "content-type": "image/svg+xml",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          "x-content-type-options": "nosniff",
          "cache-control": "private, max-age=3600",
        });
        return r.res.end(readFileSync(file));
      },
    ],
    ["POST", "/coding-agents/:id/install", (r) => changed(r, () => codingAgents.install(idOf(r)))],
    ["POST", "/coding-agents/:id/install/cancel", (r) => changed(r, () => ({ stopped: codingAgents.cancelInstall(idOf(r)) }))],
    ["POST", "/coding-agents/:id/connect", (r) => changed(r, () => codingAgents.connect(idOf(r)))],
    ["POST", "/coding-agents/:id/off", (r) => changed(r, () => codingAgents.off(idOf(r)))],
    ["POST", "/coding-agents/:id/models", (r) => changed(r, () => codingAgents.askModels(idOf(r)))],
    ["DELETE", "/coding-agents/:id", (r) => changed(r, () => codingAgents.remove(idOf(r)))],
  ];
}
