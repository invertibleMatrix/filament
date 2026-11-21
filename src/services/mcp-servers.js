// @ts-check
// Your MCP servers across the settings layers (HarnessV4_Settings_Plan HS-1). The knob `plugins.mcp` lives on three
// layers — your defaults for all chats, a project's, a chat's own — and its lists add up by name (HS-D7): a narrower
// layer's server joins the ones beneath it, replaces one of the same name, or switches one on or off with a switch
// entry `{ name, enabled }`. A narrower layer also picks the account a remote server signs in with, with a pick
// entry `{ name, account }` (HarnessV4_Space_Plan S4b, SG-D14), how its tools reach Filament's own agent, `{ name,
// load }` (E49: in full with every request, or on demand), and what of it the place uses, `{ name, note }` (the owner's
// word of 10-26: Slack's channels for this project), said to every agent beside its tools. The servers a chat runs
// are the merged list's that are on.
// A server's credentials — an env value or a header whose NAME looks like one, the rule provider env and headers use —
// never travel back to a page or into a log (HS-D8): every answer shows them as the placeholder, a write that sends
// the placeholder back keeps the stored value, and at rest they are sealed (config.json, the archive's layers).
import { SECRET_ENV_RE, seal, open, isSealed } from "./config/secrets.js";
import { SECRET_HEADER_RE } from "../core/redact.js";
import { accountOf } from "../core/oauth.js";

export const MCP_KNOB = "plugins.mcp";
/** What a page sees in place of a credential, and sends back to keep it: the config's own placeholder. */
export const SECRET_MARK = "__SECRET__";

/**
 * Where a server's entry is kept: your defaults, the Space of your own that shows the project (between your defaults
 * and the project's: its connectors reach the projects it shows, the owner's word of 10-26), a project's, a chat's —
 * or, broadest of all, a plugin on there (the Connectors list's, E50), whose servers the others may switch, pick an
 * account for and load, never edit.
 * @typedef {"plugin" | "global" | "space" | "project" | "session"} Layer
 */
/**
 * One server as the merged list holds it: its spec (the entry without its switch, the account, the load and the note
 * picked for it in), the layer the spec comes from, whether it is on and which layer said so last, which layer picked
 * its account last (S4b), its load (E49) and its note, the layer whose server of this name it replaces, and — for a
 * switch whose server no broader layer has — `orphan`.
 * @typedef {{ name: string, spec: Record<string, any> | null, from: Layer, on: boolean, switchedAt: Layer | null, pickedAt: Layer | null,
 *   loadAt: Layer | null, noteAt: Layer | null, replaces: Layer | null, orphan: boolean }} MergedServer
 */

/** @param {unknown} e @returns {e is Record<string, any>} */
const isObject = (e) => !!e && typeof e === "object" && !Array.isArray(e);

/**
 * A switch entry: `{ name, enabled }` and nothing else. It turns a server of a broader layer on or off in its own.
 * @param {unknown} e
 */
export const isSwitch = (e) => isObject(e) && typeof e.name === "string" && typeof e.enabled === "boolean" && Object.keys(e).every((k) => k === "name" || k === "enabled");

/** What a pick may name besides the server: the account, the load, the note. */
const PICKS = Object.freeze(["account", "load", "note"]);

/**
 * A pick entry (HarnessV4_Space_Plan S4b): `{ name, account }`, `{ name, load }`, `{ name, note }` or more of them — a
 * switch's `enabled` beside them or not — and nothing else. It picks the account a broader layer's server of that name
 * signs in with here, how its tools reach Filament's own agent here (E49), and what of it this place uses.
 * @param {unknown} e
 */
export const isPick = (e) =>
  isObject(e) &&
  typeof e.name === "string" &&
  PICKS.some((k) => typeof e[k] === "string") &&
  PICKS.every((k) => e[k] === undefined || typeof e[k] === "string") &&
  (e.enabled === undefined || typeof e.enabled === "boolean") &&
  Object.keys(e).every((k) => k === "name" || k === "enabled" || PICKS.includes(k));

/**
 * Whether an entry may start a program, or reach an address, that the place did not before (r-doors, 11-12) — one of a
 * layer's list, or a server's row as it is written (app/sessions/mcp-servers.js `put`, the name in its path): a server,
 * by its command or its url, kept off or not — a narrower layer's switch turns it on, and a credential kept under its
 * name goes where its new url says —, or a switch on. A switch off and a pick alone — the account, the load, the note
 * — start nothing; anything else is read as one that may.
 * @param {unknown} e
 */
export const startsServer = (e) => !isObject(e) || "command" in e || "url" in e || (e.enabled !== false && !(e.enabled === undefined && PICKS.some((k) => k in e)));

/** The most a note says: a line or two, as every agent reads it beside the server's tools. */
export const NOTE_MAX = 300;

/** What of a server a place uses, in its words, or "" (the owner's word of 10-26). @param {Record<string, any> | null | undefined} spec */
export const noteOf = (spec) => (typeof spec?.note === "string" ? spec.note.replace(/\s+/g, " ").trim() : "");

/**
 * A merged spec with the note a narrower layer picked for it; an empty one takes the note beneath away.
 * @param {Record<string, any>} spec @param {unknown} note
 */
export function withNote(spec, note) {
  const { note: _was, ...rest } = spec;
  const n = noteOf({ note });
  return n ? { ...rest, note: n } : rest;
}

/**
 * How a server's tools reach Filament's own agent (E49, the owner's word of 10-26): `core`, every tool in full with
 * every request; `on-demand`, each tool by its name alone, its description loaded when the agent needs it — the
 * default, so a server costs its names until it is used. A coding agent loads its servers its own way.
 */
export const LOADS = Object.freeze(/** @type {const} */ (["core", "on-demand"]));
/** @typedef {typeof LOADS[number]} Load */
/** A spec's load: core where it says so, else on demand. @param {Record<string, any> | null | undefined} spec @returns {Load} */
export const loadOf = (spec) => (spec?.load === "core" ? "core" : "on-demand");

/**
 * A merged spec with the load a narrower layer picked for it: said whole, since the one beneath may say the other.
 * @param {Record<string, any>} spec @param {unknown} load
 */
export function withLoad(spec, load) {
  const { load: _was, ...rest } = spec;
  return LOADS.includes(/** @type {any} */ (load)) ? { ...rest, load } : rest;
}

/**
 * A spec with the account it signs in with: none for main, which is what a server with no `account` uses, and none
 * for a server run on this computer, which signs in its own way (a pick written by hand on one is no account).
 * @param {Record<string, any>} spec @param {unknown} account
 */
export function withAccount(spec, account) {
  const { account: _was, ...rest } = spec;
  const a = accountOf(account);
  return a && typeof rest.url === "string" ? { ...rest, account: a } : rest;
}

/** The spec a server is started from: the entry without its switch. @param {Record<string, any>} e */
export function specOf(e) {
  const { enabled: _on, ...spec } = e;
  return spec;
}

/**
 * The credential slots of one entry: an env value whose name looks like a credential, a header likewise.
 * @param {Record<string, any>} e @returns {["env" | "headers", string][]}
 */
export function secretSlotsOf(e) {
  /** @type {["env" | "headers", string][]} */
  const out = [];
  for (const [field, re] of /** @type {const} */ ([["env", SECRET_ENV_RE], ["headers", SECRET_HEADER_RE]])) {
    const map = e?.[field];
    if (isObject(map)) for (const [k, v] of Object.entries(map)) if (re.test(k) && typeof v === "string" && v) out.push([field, k]);
  }
  return out;
}

/**
 * A copy of an entry whose env and headers are copies too: its credentials can be changed without touching it.
 * @param {Record<string, any>} e @returns {Record<string, any>}
 */
const copyOf = (e) => ({ ...e, ...(isObject(e.env) ? { env: { ...e.env } } : {}), ...(isObject(e.headers) ? { headers: { ...e.headers } } : {}) });

/** One entry with its credentials as the placeholder. @param {unknown} e */
export function maskEntry(e) {
  if (!isObject(e)) return e;
  const slots = secretSlotsOf(e);
  if (!slots.length) return e;
  const out = copyOf(e);
  for (const [field, k] of slots) out[field][k] = SECRET_MARK;
  return out;
}

/** A list with every entry's credentials as the placeholder; anything else as it is. @param {unknown} list */
export const maskList = (list) => (Array.isArray(list) ? list.map(maskEntry) : list);

/** A list masked as `maskList` masks it, or the list itself where no entry holds a credential. @param {unknown} list */
const listMasked = (list) => {
  if (!Array.isArray(list)) return list;
  const out = list.map(maskEntry);
  return out.every((e, i) => e === list[i]) ? list : out;
};

/**
 * An answer with every value of the knob masked, wherever it sits: a flat document's `"plugins.mcp"`, a nested one's
 * `plugins.mcp`, and a change row's `from` and `to` (`{ path: "plugins.mcp", … }`). Everything else is as it is: an
 * object or a list is copied only where something inside it is masked, so an answer with no credential in it (a
 * transcript, most of all) is written as it came, never copied whole first. The one walk every page answer of a
 * session's, a project's or your defaults' settings goes through.
 * @param {any} x
 * @returns {any}
 */
export function maskAnswer(x) {
  if (Array.isArray(x)) {
    /** @type {any[] | null} */
    let out = null;
    for (let i = 0; i < x.length; i++) {
      const v = maskAnswer(x[i]);
      if (!out && v !== x[i]) out = x.slice(0, i);
      out?.push(v);
    }
    return out || x;
  }
  // Only a plain object is walked: a Date, a Buffer or anything with its own toJSON is written as it is.
  const proto = isObject(x) ? Object.getPrototypeOf(x) : undefined;
  if (proto !== Object.prototype && proto !== null) return x;
  /** @type {Record<string, any> | null} */
  let out = null;
  const change = x.path === MCP_KNOB;
  const keys = Object.keys(x);
  /** Each value as it was read, so a copy begun part way takes the ones before it unread again. @type {any[]} */
  const seen = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = x[k];
    /** @type {any} */
    let m;
    if (k === MCP_KNOB || (change && (k === "from" || k === "to" || k === "value"))) m = listMasked(v);
    else if (k === "plugins" && isObject(v) && Array.isArray(v.mcp)) {
      const inner = maskAnswer(v), mcp = listMasked(v.mcp);
      m = inner === v && mcp === v.mcp ? v : { ...inner, mcp };
    } else m = maskAnswer(v);
    if (!out && m !== v) {
      out = {};
      for (let j = 0; j < i; j++) out[keys[j]] = seen[j];
    }
    if (out) out[k] = m;
    else seen.push(v);
  }
  return out || x;
}

/**
 * A list a writer was handed, with each placeholder put back to the value it stands for: the stored entry of the same
 * name in `sources`, the nearest first (the layer being written, then the broader ones a narrower copy came from). A
 * placeholder nothing stands behind is refused in words: its value has to be typed.
 * @param {unknown} next @param {unknown[]} sources  lists, nearest first
 * @returns {{ list: any, errors: string[] }}
 */
export function restoreList(next, sources) {
  if (!Array.isArray(next)) return { list: next, errors: [] };
  /** @type {string[]} */
  const errors = [];
  const list = next.map((e) => {
    if (!isObject(e)) return e;
    /** @type {Record<string, any> | null} */
    let out = null;
    for (const field of /** @type {const} */ (["env", "headers"])) {
      const map = e[field];
      if (!isObject(map)) continue;
      for (const [k, v] of Object.entries(map)) {
        if (v !== SECRET_MARK) continue;
        const kept = sources
          .map((l) => (Array.isArray(l) ? l.find((s) => isObject(s) && s.name === e.name)?.[field]?.[k] : undefined))
          .find((s) => typeof s === "string" && s && s !== SECRET_MARK);
        if (kept === undefined) {
          errors.push(`"${MCP_KNOB}" server ${e.name}: the value of ${field === "env" ? "the environment's" : "the header"} ${k} is hidden and none is kept to stand for it — type its value`);
          continue;
        }
        out ||= copyOf(e);
        out[field][k] = kept;
      }
    }
    return out || e;
  });
  return { list, errors };
}

/**
 * A list with its credentials sealed (`seal`) or opened (`open`) with `key`: what the archive keeps of a layer.
 * A value that cannot be opened becomes "" — the key is not this one — so the server is offered without it.
 * @param {unknown} list @param {Buffer} key @param {"seal" | "open"} way
 */
function cryptList(list, key, way) {
  if (!Array.isArray(list)) return list;
  return list.map((e) => {
    if (!isObject(e)) return e;
    const slots = secretSlotsOf(e);
    if (!slots.length) return e;
    const out = copyOf(e);
    for (const [field, k] of slots) {
      const v = out[field][k];
      if (way === "seal") out[field][k] = seal(v, key);
      else if (isSealed(v))
        try {
          out[field][k] = open(v, key);
        } catch {
          out[field][k] = "";
        }
    }
    return out;
  });
}

/**
 * A stored settings layer (nested or dotted) with its MCP servers' credentials sealed or opened: the archive's
 * `settings_json` of a chat or a project. Nothing else in the layer is touched.
 * @param {any} layer @param {Buffer | null} key  none: the archive is kept in plain text, and so is this
 * @param {"seal" | "open"} way
 */
export function cryptLayer(layer, key, way) {
  if (!key || !isObject(layer)) return layer;
  const nested = isObject(layer.plugins) && Array.isArray(layer.plugins.mcp);
  const dotted = Array.isArray(layer[MCP_KNOB]);
  if (!nested && !dotted) return layer;
  return {
    ...layer,
    ...(nested ? { plugins: { ...layer.plugins, mcp: cryptList(layer.plugins.mcp, key, way) } } : {}),
    ...(dotted ? { [MCP_KNOB]: cryptList(layer[MCP_KNOB], key, way) } : {}),
  };
}

/**
 * The layers' lists merged by name (HS-D7), broadest first. A spec joins the list or replaces the server of its name;
 * a switch turns the server it names on or off; a switch whose server no broader layer has stays as an orphan, so a
 * page can show it and offer to clear it.
 * @param {{ at: Layer, list: unknown }[]} layers  broadest first; a layer that holds no list is left out
 * @returns {MergedServer[]}
 */
export function mergeServers(layers) {
  /** @type {Map<string, MergedServer>} */
  const byName = new Map();
  for (const { at, list } of layers) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      if (!isObject(e) || typeof e.name !== "string") continue;
      const prev = byName.get(e.name);
      if (isSwitch(e) || isPick(e)) {
        const switches = typeof e.enabled === "boolean";
        if (prev) {
          if (switches) {
            prev.on = /** @type {boolean} */ (e.enabled);
            prev.switchedAt = at;
          }
          if (typeof e.account === "string") {
            if (prev.spec) prev.spec = withAccount(prev.spec, e.account);
            prev.pickedAt = at;
          }
          if (typeof e.load === "string") {
            if (prev.spec) prev.spec = withLoad(prev.spec, e.load);
            prev.loadAt = at;
          }
          if (typeof e.note === "string") {
            if (prev.spec) prev.spec = withNote(prev.spec, e.note);
            prev.noteAt = at;
          }
        } else
          byName.set(e.name, { name: e.name, spec: null, from: at, on: switches ? /** @type {boolean} */ (e.enabled) : true, switchedAt: switches ? at : null, pickedAt: typeof e.account === "string" ? at : null, loadAt: typeof e.load === "string" ? at : null, noteAt: typeof e.note === "string" ? at : null, replaces: null, orphan: true });
        continue;
      }
      const spec = specOf(e);
      byName.set(e.name, {
        name: e.name,
        spec: "account" in spec ? withAccount(spec, spec.account) : spec,
        from: at,
        on: e.enabled !== false,
        switchedAt: typeof e.enabled === "boolean" ? at : null,
        pickedAt: null,
        loadAt: null,
        noteAt: null,
        replaces: prev && !prev.orphan ? prev.from : null,
        orphan: false,
      });
    }
  }
  return [...byName.values()];
}

/** The servers a chat runs: the merged list's specs that are on. @param {MergedServer[]} merged */
export const serversOn = (merged) => merged.filter((s) => s.on && !s.orphan && s.spec).map((s) => /** @type {Record<string, any>} */ (s.spec));
