// @ts-check
// One upstream's connection test, as the dashboard's Test button and the assistant's `test upstream` both ask for
// it. The dashboard sends its form copy of the upstream, where stored secrets are "__SECRET__" placeholders: the saved
// values are spliced back in so the test sees the real credentials, then the upstream's Destination answers.
import { CURSOR_SDK_OFF, cursorSdkHeld } from "../core/catalogues.js";
import { upstreamBaseUrl } from "../core/routing.js";
import { isAgentUpstream } from "../core/schema.js";
import { normalizeConfig } from "../services/config/store.js";
import { secretSlots } from "../services/config/secrets.js";

/**
 * The saved upstream a form copy stands for: the one it was read as — the id it was renamed from (`renamedFrom`, an
 * unsaved rename on its card) — else the one with its id.
 * @param {any} u @param {any} config  the ConfigStore
 */
export const savedOf = (u, config) => {
  const id = (typeof u?.renamedFrom === "string" && u.renamedFrom) || u?.id;
  return (config.get().upstreams || []).find((/** @type {any} */ x) => x.id === id);
};

/**
 * An upstream as its test runs it, `u` changed in place: each stored secret the form copy holds as its placeholder —
 * its key, a sign-in's tokens, an extra header, a coding agent's environment credential — is the saved upstream's at
 * the same place; one it keeps none for goes as nothing, never as the placeholder's text. The dashboard's form copy is
 * not normalised; an agent's test reads acp.* defaults, so it gets the normalised one.
 * @param {any} u  the upstream as sent (form copy) or as stored @param {any} saved  the one it stands for (`savedOf`), if any
 */
function asTested(u, saved) {
  const kept = new Map(saved ? secretSlots({ upstreams: [saved] }, { idOf: () => "" }).map(([o, k, where]) => [where, o[k]]) : []);
  for (const [o, k, where] of secretSlots({ upstreams: [u] }, { idOf: () => "" }))
    if (o[k] === "__SECRET__") {
      const v = kept.get(where);
      o[k] = typeof v === "string" ? v : "";
    }
  return isAgentUpstream(u) ? normalizeConfig({ upstreams: [u] }).upstreams[0] : u;
}

/**
 * @param {any} u  the upstream as sent (form copy) or as stored
 * @param {any} config  the ConfigStore
 * @param {(u: any) => any} destinationFor
 */
export async function testUpstream(u, config, destinationFor) {
  // Cursor's SDK while Settings › Experimental's switch for it is off: nothing reaches Cursor through it.
  if (cursorSdkHeld(config.get(), u)) return { ok: false, error: `${CURSOR_SDK_OFF}.` };
  return destinationFor(asTested(u, savedOf(u, config))).test();
}

/** A value as JSON with each object's keys in order: two that hold the same read the same. @param {unknown} v */
const inOrder = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

/**
 * What a test of an upstream starts, and where it sends what the upstream holds: its kind; a coding agent's program
 * whole (`acp`: its command, arguments, environment, home and mode among them); a provider's address as its requests
 * are built (core/routing.js `upstreamBaseUrl`), the address its models are read from where it names one, and its
 * extra headers; a Qoder account's region, and the machine another machine's models are asked of.
 * @param {any} u  as its test runs it (`asTested`)
 */
const reachOf = (u) => inOrder([u.type, isAgentUpstream(u) ? u.acp : null, upstreamBaseUrl(u), String(u.modelsPath || "").trim(), u.headers || {}, u.qoder?.region || "", u.machine || ""]);

/**
 * Whether a test of `u` does more than the test of an upstream that is kept (s-rows, 11-12): the row took any body, so
 * a program on this computer had Filament start whatever program an `acp.command` named, and — under a kept provider's
 * id, with another address — send that provider's key there. True where no kept upstream stands behind it (`savedOf`),
 * or where it starts or reaches what the kept one does not (`reachOf`), each as its test would run it; the kept one
 * tested as it is kept — the page's form with none of those changed — does no more than the saved one's own test.
 * The admin row's press (http/admin/press.js).
 * @param {any} u  the upstream as sent @param {any} config  the ConfigStore
 */
export function testsMore(u, config) {
  const saved = u && typeof u === "object" && !Array.isArray(u) ? savedOf(u, config) : null;
  if (!saved) return true;
  return reachOf(asTested(structuredClone(u), saved)) !== reachOf(asTested(structuredClone(saved), saved));
}
