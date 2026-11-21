// @ts-check
// Filament's own settings as the harness's Filament pages set them (HarnessV4_Settings_Plan HS-4, HS-D3, HS-D4): each
// write names the fields it changes, a value set or one put back to Filament's default, and is made against the
// configuration as it stands, so a page read before another window's change never undoes it. A page that read the
// configuration at an older version (`base`) is refused only when one of the fields it names changed since, with what
// changed. Only the sections those pages draw take writes here, and never a credential: the inbound keys have their
// own routes, the admin token is the console's.
import { CONFIG_SCHEMA } from "../core/schema.js";
import { normalizeConfig } from "../services/config/store.js";
import { describeDiff } from "../services/config/diff.js";
import { changeConfig, changedSince, changeLines, failure } from "./config-change.js";

/** The sections the harness draws, the only ones written here. */
export const FIELD_SECTIONS = Object.freeze(["server", "agentLoop", "observability", "alerts", "memory", "ui", "telemetry", "experimental"]);
/** Single fields of other sections a page draws (the owner's of 11-09): Agent loop's three rows of `sessions`, never
 *  its map of your defaults, which Settings › New chats writes. */
const FIELD_LEAVES = Object.freeze(["sessions.resumeAfterRestart", "sessions.idleWakeMinutes", "sessions.commitTrailer"]);
/** What a change to these needs before it takes effect: Filament listens where it started until it starts again. */
const RESTART_FIELDS = new Set(["server.host", "server.port"]);

/** @param {any} node */
const isLeaf = (node) => !!node && typeof node === "object" && typeof node.type === "string" && "description" in node;

/**
 * The schema's leaf at a dotted path, refused in words when the harness may not write it.
 * @param {string} path @returns {any}
 */
export function fieldLeaf(path) {
  const keys = String(path || "").split(".");
  if (!FIELD_SECTIONS.includes(keys[0]) && !FIELD_LEAVES.includes(String(path))) throw failure(400, `${path} is not one of the settings set here (${FIELD_SECTIONS.join(", ")})`);
  /** @type {any} */
  let node = CONFIG_SCHEMA;
  for (const k of keys) node = k !== "_doc" && node && typeof node === "object" && !isLeaf(node) ? node[k] : undefined;
  if (!isLeaf(node)) throw failure(400, `${path} is not a setting`);
  if (node.type === "secret" || node.itemType === "secret") throw failure(400, `${path} holds credentials, which are not set here`);
  return node;
}

/**
 * A value for a leaf, checked, in the shape the configuration keeps; a refusal says what the setting takes.
 * @param {string} path @param {any} leaf @param {any} v
 */
export function fieldValue(path, leaf, v) {
  /** @type {string[] | null} */
  const options = Array.isArray(leaf.options) ? leaf.options : null;
  if (leaf.type === "boolean") {
    if (typeof v !== "boolean") throw failure(400, `${path} is true or false`);
    return v;
  }
  if (leaf.type === "number") {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw failure(400, `${path} is a number, 0 or more`);
    return v;
  }
  if (leaf.type === "string" || leaf.type === "enum") {
    if (typeof v !== "string") throw failure(400, `${path} is text`);
    const s = leaf.multiline ? v : v.trim();
    if (options && !options.includes(s)) throw failure(400, `${path} is one of ${options.join(", ")}`);
    return s;
  }
  if (leaf.type === "array" || leaf.type === "list") {
    if (!Array.isArray(v)) throw failure(400, `${path} is a list`);
    if (leaf.itemType === "string") {
      if (v.some((x) => typeof x !== "string")) throw failure(400, `${path} is a list of text`);
      return [...new Set(v.map((x) => x.trim()).filter(Boolean))];
    }
    if (leaf.itemType === "enum") {
      const bad = v.find((x) => !options?.includes(x));
      if (bad !== undefined) throw failure(400, `${path} takes only ${options?.join(", ")}: not ${JSON.stringify(bad)}`);
      return [...new Set(v)];
    }
    // A list of objects: the configuration's own check judges it, as a whole save's does.
    return structuredClone(v);
  }
  if (leaf.type === "map") {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw failure(400, `${path} is an object`);
    return structuredClone(v);
  }
  throw failure(400, `${path} is not set here`);
}

/** @param {any} doc @param {string} path @param {any} value */
function putAt(doc, path, value) {
  const keys = path.split(".");
  let cur = doc;
  for (const k of keys.slice(0, -1)) {
    if (!cur[k] || typeof cur[k] !== "object" || Array.isArray(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

/** @param {any} doc @param {string} path */
const valueAt = (doc, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), doc);

/**
 * Some of Filament's settings changed: `set` names each field with its value, `unset` each one put back to Filament's
 * default. → the change in lines (none when nothing moved, and nothing is saved), whether it waits for a restart (it
 * moved the host or port away from where Filament listens, `listening`; anywhere, when that is not known), and each named
 * field's value now.
 * @param {{ get: () => any, set: (cfg: any) => void, save: () => void, version: () => number, at: (v: number) => any }} config
 * @param {{ set?: Record<string, any>, unset?: string[], base?: number | null }} change
 * @param {{ host: string, port: number } | null} [listening]
 * @param {{ refuse?: ((was: any, next: any) => string | null) | null }} [o]  `refuse`: why the change is not saved, or
 *   null where it is — the press key's (config.js `pressNeeded`), refused with `press: true` before anything moves
 * @returns {{ changes: string[], restartNeeded: boolean, values: Record<string, any> }}
 */
export function changeFields(config, change, listening = null, { refuse = null } = {}) {
  const set = change?.set ?? {};
  const unset = change?.unset ?? [];
  if (!set || typeof set !== "object" || Array.isArray(set)) throw failure(400, "set is an object of { path: value }");
  if (!Array.isArray(unset) || unset.some((p) => typeof p !== "string")) throw failure(400, "unset is a list of paths");
  const paths = [...Object.keys(set), ...unset];
  if (!paths.length) throw failure(400, "name a setting to change: { set: { path: value } } or { unset: [path] }");
  const both = unset.find((p) => Object.hasOwn(set, p));
  if (both) throw failure(400, `${both} is both set and put back`);
  const leaves = new Map(paths.map((p) => [p, fieldLeaf(p)]));
  const base = change?.base;
  if (Number.isInteger(base) && base !== config.version()) {
    const since = changedSince(config, /** @type {number} */ (base));
    if (!since) throw failure(409, "These settings were read too long ago to tell what changed since: read them again", { stale: true });
    const touched = since.filter((d) => paths.some((p) => d.path === p || d.path.startsWith(`${p}.`)));
    if (touched.length) throw failure(409, "This setting changed since the page read it: read it again", { stale: true, changes: changeLines(touched) });
  }
  const cfg = config.get();
  const next = structuredClone(cfg);
  for (const [p, v] of Object.entries(set)) putAt(next, p, fieldValue(p, leaves.get(p), v));
  for (const p of unset) putAt(next, p, structuredClone(leaves.get(p).default));
  const normal = normalizeConfig(next);
  const diff = describeDiff(cfg, normal);
  const no = diff.length ? refuse?.(cfg, normal) : null;
  if (no) throw failure(403, no, { press: true });
  if (diff.length) changeConfig(config, next);
  const now = config.get();
  const away = !listening || now.server?.host !== listening.host || now.server?.port !== listening.port;
  return {
    changes: changeLines(diff),
    restartNeeded: away && diff.some((d) => RESTART_FIELDS.has(d.path)),
    values: Object.fromEntries(paths.map((p) => [p, valueAt(now, p)])),
  };
}
