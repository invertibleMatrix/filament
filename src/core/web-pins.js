// @ts-check
// Vendor on publish (the Space Apps plan of 10-29, "Runtime and offline"): a library a page names from a CDN host is
// fetched once as it is published and kept in that version, so the page draws offline. The version keeps each file
// fetched under `_filament/web/` — Filament's own on an artifact's address, which no file of a publish may be under —
// with `pins.json`, each address as the page wrote it and the file kept for it. The page's own files stay as written,
// so the agent reads and edits what it wrote; the address serves them with each kept address pointed at its file
// (`pinnedText`), and a download writes them so too. What a fetched file names in turn — a module's imports, a sheet's
// fonts — is fetched and kept as well, and its references written to point at the files kept beside it.
import { OWN_PREFIX } from "./artifacts.js";
import { VISUAL_HOSTS } from "./visual-look.js";

/** Where a version keeps the files fetched for it. */
export const WEB_DIR = `${OWN_PREFIX}/web`;
/** …and what it kept for each address. */
export const PINS_FILE = `${WEB_DIR}/pins.json`;
/** The files whose addresses are kept and pointed at what was kept: a page, its sheets and its scripts. */
export const PINNED_TEXT = /\.(?:html?|css|m?js|m?ts)$/i;
/** The hosts an address is kept from: the library hosts a page may load from (AF-D4). */
export const PIN_HOSTS = Object.freeze(VISUAL_HOSTS.map((h) => new URL(h).host));

const HOSTS_SOURCE = PIN_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|");
/** An address on those hosts as a page writes it: up to a quote, a space, a bracket or a backtick. */
const ADDRESS = () => new RegExp(`https://(?:${HOSTS_SOURCE})/[^\\s"'\`<>()\\\\]*`, "g");
/** What ends a sentence after an address written in words, not part of it. */
const TRAILING = /[.,;:!?]+$/;

/**
 * An address as found, or null where it is no address to keep: one a template builds (`${…}`), and one that ends in
 * `/` — an import map's prefix, which a browser drops unless it still ends in `/`, and a folder's listing at best.
 * @param {string} raw
 */
const addressOf = (raw) => {
  const s = raw.replace(TRAILING, "");
  return !s || s.includes("${") || s.endsWith("$") || s.endsWith("/") ? null : s;
};

/** The addresses on the library hosts a text names, each once, as written. @param {string} text */
export function webAddressesIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(ADDRESS())) {
    const a = addressOf(m[0]);
    if (a) out.add(a);
  }
  return [...out];
}

/** A publish's answer where the turn was stopped while its page's libraries were fetched: nothing is published. */
export const PIN_STOPPED = "Not published: the turn was stopped while Filament fetched what its page names from the web.";

/** The address to fetch for one as written: an HTML attribute's `&amp;` is its `&`. @param {string} raw */
export const fetchedAddress = (raw) => raw.replace(/&amp;/g, "&");

/** A tag that may load a file with `integrity=`: a script, a sheet or a preload. */
const LOADING_TAG = /<(?:script|link)\b[^>]*>/gi;
/** One attribute of a tag, its value quoted or bare. */
const ATTRIBUTE = /([^\s"'=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
/** An import map, whose `integrity` names addresses too. */
const IMPORT_MAP = /<script\b[^>]*\btype\s*=\s*["']?importmap["']?[^>]*>([\s\S]*?)<\/script>/gi;

/**
 * The integrity hashes the texts give each address (Subresource Integrity): a script's or link's `integrity=`, and an
 * import map's `integrity`; each address as fetched, with every hash a tag gives it.
 * @param {readonly string[]} texts
 */
export function integrityIn(texts) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  /** @param {string} address @param {unknown} said */
  const add = (address, said) => {
    if (typeof said !== "string" || !said.trim()) return;
    const a = fetchedAddress(address);
    out.set(a, [...(out.get(a) || []), said]);
  };
  for (const text of texts) {
    for (const [tag] of String(text).matchAll(LOADING_TAG)) {
      /** @type {Record<string, string>} */
      const attrs = {};
      for (const m of tag.matchAll(ATTRIBUTE)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
      const address = attrs.src || attrs.href;
      if (address && "integrity" in attrs) add(address, attrs.integrity);
    }
    for (const [, json] of String(text).matchAll(IMPORT_MAP)) {
      try {
        const said = JSON.parse(json)?.integrity;
        if (said && typeof said === "object") for (const [a, h] of Object.entries(said)) add(a, h);
      } catch {
        // A map that does not read checks nothing.
      }
    }
  }
  return out;
}

/**
 * A text with each address it names that was kept pointed at its file: `to(path)` gives what replaces it, by the kept
 * file's path under `WEB_DIR`. An address not kept stays as written.
 * @param {string} text @param {Readonly<Record<string, string>>} pins @param {(path: string) => string} to
 */
export function pinnedText(text, pins, to) {
  return String(text).replace(ADDRESS(), (whole) => {
    const a = addressOf(whole);
    if (!a || !Object.prototype.hasOwnProperty.call(pins, a)) return whole;
    return to(pins[a]) + whole.slice(a.length);
  });
}

/** What a version kept for each address, from its `pins.json`; empty where it kept none. @param {Buffer | string | null | undefined} file */
export function pinsOf(file) {
  if (!file) return /** @type {Record<string, string>} */ ({});
  try {
    const said = JSON.parse(String(file));
    const pins = said?.pins && typeof said.pins === "object" ? said.pins : {};
    /** @type {Record<string, string>} */
    const out = {};
    for (const [k, v] of Object.entries(pins)) if (typeof v === "string" && v && !v.split("/").includes("..")) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/** Whether a version's file is one Filament fetched for it, under `WEB_DIR`. @param {string} path */
export const isWebFile = (path) => path === WEB_DIR || path.startsWith(`${WEB_DIR}/`);

/**
 * A relative reference from one kept file to another, as a module import takes it: always `./` or `../` first, so it
 * is never read as a bare name.
 * @param {string} from  the referring file's path @param {string} to  the file it names
 */
export function relativeRef(from, to) {
  const a = from.split("/").slice(0, -1);
  const b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const up = a.length - i;
  const rest = b.slice(i).join("/");
  return up ? `${"../".repeat(up)}${rest}` : `./${rest}`;
}

/**
 * Whether a kept file's reference, as written, already names the file kept for it: a relative one that resolves there,
 * left as it is so the file keeps the bytes fetched (a sheet's `url(fonts/…)`).
 * @param {string} from  the referring file's path @param {string} spec  the reference as written @param {string} to  the file kept for it
 */
export function namesKept(from, spec, to) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(spec)) return false;
  try {
    const u = new URL(spec, `https://kept/${from}`);
    return !u.search && decodeURIComponent(u.pathname) === `/${to}`;
  } catch {
    return false;
  }
}
