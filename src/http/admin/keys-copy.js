// @ts-check
// Your providers' keys copied to another machine you work from the desk (s3c): POST /key-copies, the one row that
// answers a provider's key as it is. It answers the desktop app's main process alone — the call that sends the app's
// press key (guards.js `pressedWithKey`) and this computer's owner key itself (`ownerKeySent`): the app's page holds
// the press key and a session, never the owner key; the command line holds the owner key, never the press key; a
// device, a tailnet login, a program here and a Filament no app holds a key for, neither —, and the keys it names
// alone, each as its provider is set here, for the app to hand to that machine as its full device there
// (desktop/lib/machine-agents.js `copyKeys`). Nothing here sends a key anywhere, and no line here says one.
// secret.key never goes: each key is read open, as this Filament holds it.
import { sendJson } from "../../app/pipeline/respond.js";
import { providerForBaseUrl } from "../../core/providers.js";
import { isAgentUpstream, isMachineUpstream } from "../../core/schema.js";
import { isSealed } from "../../services/config/secrets.js";
import { ownerKeySent, pressedWithKey } from "../guards.js";

/** What any other caller is told. */
export const COPY_REFUSED = "Only the Filament app on this computer copies its providers' keys to another machine: from Settings › Remote access, a machine's Copy keys.";
/** The most providers one copy names. */
export const COPY_MOST = 50;
/** The providers whose key goes: an API's, the kinds another machine adds (app/providers.js `add`). */
export const KEY_TYPES = new Set(["openai-compatible", "anthropic-compatible", "openai", "anthropic"]);

/**
 * A provider's setting as another machine adds it (app/providers.js `add`): its catalogue entry and plan where its
 * address is one, its own address, key and the rest as set here — its prefix its id.
 * @param {any} u
 */
const copyOf = (u) => {
  const known = providerForBaseUrl(u.baseUrl);
  return {
    id: String(u.id),
    name: String(u.name || u.id),
    ...(known ? { provider: known.provider.id, plan: known.plan.id } : {}),
    type: String(u.type),
    baseUrl: String(u.baseUrl || ""),
    apiKey: String(u.apiKey),
    authStyle: String(u.authStyle || "auto"),
    ...(u.wireApi ? { wireApi: String(u.wireApi) } : {}),
    modelsPath: String(u.modelsPath || ""),
    headers: u.headers && typeof u.headers === "object" ? { ...u.headers } : {},
    hiddenModels: Array.isArray(u.hiddenModels) ? [...u.hiddenModels] : [],
  };
};

/**
 * @param {any} a  the admin context: `config`
 * @returns {import("../router.js").RouteRow[]}
 */
export function keysCopyRoutes(a) {
  return [
    [
      "POST",
      "/key-copies",
      async (r) => {
        if (r.who?.kind !== "local" || !pressedWithKey(r.req) || !ownerKeySent(r.req)) return sendJson(r.res, 403, { error: COPY_REFUSED });
        /** @type {any} */
        let body;
        try {
          body = await r.json();
        } catch {
          return sendJson(r.res, 400, { error: "invalid JSON" });
        }
        const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(String))] : [];
        if (!ids.length || ids.length > COPY_MOST) return sendJson(r.res, 400, { error: `name the providers whose keys go, ${COPY_MOST} at most` });
        /** @type {any[]} */
        const ups = a.config.get().upstreams || [];
        /** @type {any[]} */
        const keys = [];
        for (const id of ids) {
          const u = ups.find((x) => x.id === id);
          if (!u || isAgentUpstream(u) || isMachineUpstream(u) || !KEY_TYPES.has(u.type))
            return sendJson(r.res, 404, { error: `No provider "${id}" here has an API key to copy: a coding agent signs in on its machine, and another machine's models are its own.` });
          // A key, or a header's value, this data folder's secret.key cannot open is none to send.
          if (typeof u.apiKey !== "string" || !u.apiKey || isSealed(u.apiKey)) return sendJson(r.res, 409, { error: `${u.name || u.id} has no key here that can be read: add it again under Settings › Providers.` });
          if (Object.values(u.headers || {}).some(isSealed)) return sendJson(r.res, 409, { error: `${u.name || u.id} has a header here whose value cannot be read: set it again under Settings › Providers.` });
          keys.push(copyOf(u));
        }
        return sendJson(r.res, 200, { keys }, { "cache-control": "no-store" });
      },
    ],
  ];
}
