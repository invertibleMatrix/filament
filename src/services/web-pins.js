// @ts-check
// Vendor on publish, its fetching (the Space Apps plan of 10-29): each address a publish's page names on a library host
// is fetched once, with what it names in turn — a module's imports, a sheet's `@import`s and fonts — and given back as
// files to keep under the version's `_filament/web/`, each fetched file's references written to point at the files kept
// beside it. Only the library hosts are fetched from, over https, a redirect off them refused; a file is kept in
// `dir` once fetched, by its address, so a later version — or a publish with no network — keeps the same bytes. What
// could not be fetched is said, its address left as the page wrote it — and written whole where a kept file names it —
// so the page still loads it from the web; so too what was not fetched in the 30 s a publish waits, or before the turn
// was stopped, and a file the page's `integrity=` would refuse as kept.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEVICE_NAME, artifactTypeOf } from "../core/artifacts.js";
import { PIN_HOSTS, WEB_DIR, fetchedAddress, integrityIn, namesKept, relativeRef } from "../core/web-pins.js";

/**
 * How much one publish fetches at most: files, bytes in all and in one, how long each may take, and how long it waits
 * for the web in all — well inside the 50 s a connected agent waits for a call's answer.
 */
export const PIN_LIMITS = Object.freeze({ files: 80, bytes: 40 * 1024 * 1024, fileBytes: 15 * 1024 * 1024, ms: 20_000, total: 30_000, atOnce: 6 });
/** A browser's name, so a host answers as it answers a browser (a font sheet names woff2 files). */
const AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
/** The extension a file is kept under, by the type it was answered with. @type {readonly [RegExp, string][]} */
const EXT_OF = Object.freeze([
  [/javascript|ecmascript/i, "js"],
  [/text\/css/i, "css"],
  [/json/i, "json"],
  [/wasm/i, "wasm"],
  [/woff2/i, "woff2"],
  [/woff/i, "woff"],
  [/ttf|truetype/i, "ttf"],
  [/otf|opentype/i, "otf"],
  [/svg/i, "svg"],
  [/png/i, "png"],
  [/jpe?g/i, "jpg"],
  [/gif/i, "gif"],
  [/webp/i, "webp"],
  [/text\/plain/i, "txt"],
]);
/** A module's imports and re-exports, and a dynamic import, written whole in quotes. */
const MODULE_REFS = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])([^"'\n\r]+)\1/g;
/** A sheet's `url(…)` and `@import "…"`. */
const SHEET_REFS = /url\(\s*(["']?)([^"')\s]+)\1\s*\)|@import\s+(["'])([^"']+)\3/g;

/** @typedef {{ path: string, data: Buffer }} PinnedFile */
/**
 * `late`: how many of those not kept were not fetched in time, or before the turn was stopped.
 * @typedef {{ files: PinnedFile[], pins: Record<string, string>, failed: { address: string, why: string }[], late: number }} Pinned
 */

/** A short hash of a text. @param {string} s @param {number} n */
const hashOf = (s, n) => createHash("sha256").update(s).digest("hex").slice(0, n);
/** Whether a fetched file is read for what it names in turn, by its type and path. @param {string} type @param {string} path */
const kindOf = (type, path) => (/javascript|ecmascript/i.test(type) || /\.m?js$/i.test(path) ? "module" : /text\/css/i.test(type) || /\.css$/i.test(path) ? "sheet" : null);

/** The algorithms of Subresource Integrity, weakest first. */
const SRI_ALGS = Object.freeze(["sha256", "sha384", "sha512"]);
/** A hash in base64 as compared: base64url read as base64, no padding. @param {string} s */
const base64Of = (s) => s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");

/**
 * Whether bytes meet an `integrity=` as a browser checks them: by the strongest algorithm it names, any one of its
 * hashes; one that names no algorithm a browser knows checks nothing.
 * @param {Buffer} data @param {string} said
 */
export function meetsIntegrity(data, said) {
  /** @type {RegExpExecArray[]} */
  const hashes = [];
  for (const t of said.trim().split(/\s+/)) {
    const m = /^(sha256|sha384|sha512)-([A-Za-z0-9+/_=-]+)(?:\?.*)?$/i.exec(t);
    if (m) hashes.push(m);
  }
  if (!hashes.length) return true;
  const alg = /** @type {string} */ (SRI_ALGS.filter((a) => hashes.some((m) => m[1].toLowerCase() === a)).at(-1));
  const got = base64Of(createHash(alg).update(data).digest("base64"));
  return hashes.some((m) => m[1].toLowerCase() === alg && base64Of(m[2]) === got);
}
/** A name part of a path as a version may keep it: one Windows keeps for a device (`aux.js`) given a `_` before it. @param {string} p */
const safePart = (p) => {
  const s = p.replace(/[\u0000-\u001f<>:"|?*\\]/g, "_").replace(/[ .]+$/, (m) => "_".repeat(m.length)) || "_";
  return DEVICE_NAME.test(s) ? `_${s}` : s;
};

/**
 * Where a fetched file is kept under `WEB_DIR`: its host and path, a short hash of its query, and the extension its
 * type is served by where its own does not say it.
 * @param {URL} u @param {string} type  the type it was answered with
 */
export function keptPathOf(u, type) {
  const parts = u.pathname.split("/").filter(Boolean).map((p) => {
    try {
      return safePart(decodeURIComponent(p));
    } catch {
      return safePart(p);
    }
  });
  if (!parts.length || u.pathname.endsWith("/")) parts.push("index");
  if (u.search) parts[parts.length - 1] += `~${hashOf(u.search, 8)}`;
  const ext = EXT_OF.find(([re]) => re.test(type))?.[1] || "";
  const last = parts[parts.length - 1];
  const served = artifactTypeOf(last).split(";")[0];
  if (ext && (u.search || served !== artifactTypeOf(`x.${ext}`).split(";")[0])) parts[parts.length - 1] = `${last}.${ext}`;
  const path = [safePart(u.host), ...parts].join("/");
  return path.length <= 160 ? path : `${safePart(u.host)}/${hashOf(u.href, 16)}${ext ? `.${ext}` : ""}`;
}

/** Whether an address is one a publish fetches from: https, on a library host. @param {URL} u */
const onHosts = (u) => u.protocol === "https:" && PIN_HOSTS.includes(u.host);

/**
 * @param {{ dir: string, fetch?: typeof globalThis.fetch, log?: (level: string, msg: string) => void, limits?: Partial<Record<keyof typeof PIN_LIMITS, number>> }} o
 *   `dir`: where fetched files are kept by their address, across publishes and restarts
 */
export function createWebPins({ dir, fetch = (url, init) => globalThis.fetch(url, init), log = () => {}, limits = {} }) {
  const most = { ...PIN_LIMITS, ...limits };

  /**
   * One address's file: as kept from an earlier fetch, else fetched now (and kept) — unless `stop` has ended the
   * fetching, which `late` says why (`late: true`).
   * @param {string} href @param {AbortSignal} stop @param {() => string} late
   * @returns {Promise<{ ok: true, final: string, type: string, data: Buffer } | { ok: false, why: string, late?: boolean }>}
   */
  const one = async (href, stop, late) => {
    const key = hashOf(href, 32);
    try {
      const meta = JSON.parse(readFileSync(join(dir, `${key}.json`), "utf8"));
      if (meta?.address === href) return { ok: true, final: String(meta.final), type: String(meta.type || ""), data: readFileSync(join(dir, `${key}.bin`)) };
    } catch {
      // Not kept yet: fetched below.
    }
    /** Why a fetch or its body failed. @param {any} e */
    const unfetched = (e) =>
      stop.aborted
        ? { ok: /** @type {const} */ (false), why: late(), late: true }
        : { ok: /** @type {const} */ (false), why: e?.name === "TimeoutError" ? `it took longer than ${most.ms / 1000} s` : `it could not be fetched (${e?.cause?.code || e?.message || e})` };
    if (stop.aborted) return unfetched(null);
    let res;
    try {
      res = await fetch(href, { redirect: "follow", signal: AbortSignal.any([AbortSignal.timeout(most.ms), stop]), headers: { "user-agent": AGENT, accept: "*/*" } });
    } catch (e) {
      return unfetched(e);
    }
    let final;
    try {
      final = new URL(res.url || href);
    } catch {
      final = new URL(href);
    }
    if (!onHosts(final)) return { ok: false, why: `it led to ${final.host}, which is no library host` };
    if (!res.ok) return { ok: false, why: `${final.host} answered ${res.status}` };
    const said = Number(res.headers.get("content-length"));
    if (said > most.fileBytes) return { ok: false, why: `it is ${Math.round(said / 1024 / 1024)} MB, more than one file kept from the web may be` };
    let data;
    try {
      data = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      return unfetched(e);
    }
    if (data.length > most.fileBytes) return { ok: false, why: `it is ${Math.round(data.length / 1024 / 1024)} MB, more than one file kept from the web may be` };
    const type = String(res.headers.get("content-type") || "");
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${key}.bin.tmp`), data);
      renameSync(join(dir, `${key}.bin.tmp`), join(dir, `${key}.bin`));
      writeFileSync(join(dir, `${key}.json`), JSON.stringify({ address: href, final: final.href, type, at: Date.now() }));
    } catch (/** @type {any} */ e) {
      log("warn", `web pins: ${href} was fetched but could not be kept for later (${e?.message || e})`);
    }
    return { ok: true, final: final.href, type, data };
  };

  /**
   * What a fetched file names in turn, each at its place in the text: a module's imports, a sheet's imports and fonts.
   * @param {string} text @param {"module" | "sheet"} kind @param {string} base  the address it was answered from
   * @returns {{ start: number, end: number, href: string }[]}
   */
  const refsIn = (text, kind, base) => {
    const out = [];
    const re = kind === "module" ? MODULE_REFS : SHEET_REFS;
    for (const m of text.matchAll(new RegExp(re.source, "g"))) {
      const spec = kind === "module" ? m[2] : m[2] ?? m[4];
      if (!spec || spec.startsWith("data:") || spec.startsWith("#")) continue;
      if (kind === "module" && !/^(?:\/|\.\.?\/|https:\/\/)/.test(spec)) continue;
      let u;
      try {
        u = new URL(spec, base);
      } catch {
        continue;
      }
      if (!onHosts(u)) continue;
      u.hash = "";
      const start = /** @type {number} */ (m.index) + m[0].lastIndexOf(spec);
      out.push({ start, end: start + spec.length, href: u.href });
    }
    return out;
  };

  return {
    /**
     * Each address fetched and kept, with what it names in turn, as files under `WEB_DIR`; `pins`, each address as the
     * page wrote it and its file's path under `WEB_DIR`; `failed`, those not kept and why. The fetching ends at
     * `PIN_LIMITS.total`, or when `signal` does: what was not fetched by then stays as written, on the web (`late`).
     * A file the page's tags give an integrity hash is kept only where its bytes meet it and are kept as they are.
     * @param {readonly string[]} addresses  as the page wrote them
     * @param {{ texts?: readonly string[], signal?: AbortSignal | null }} [o]  `texts`: the page's files, read for the
     *   integrity hashes their tags give; `signal`: the turn's stop
     * @returns {Promise<Pinned>}
     */
    async pin(addresses, { texts = [], signal = null } = {}) {
      const stop = AbortSignal.any([AbortSignal.timeout(most.total), ...(signal ? [signal] : [])]);
      const late = () => (signal?.aborted ? "the turn was stopped before it was fetched" : `it was not fetched in ${most.total / 1000} s, the most a publish waits for the web`);
      const integrity = integrityIn(texts);
      /** @type {Map<string, { path: string, type: string, data: Buffer, final: string }>} */
      const got = new Map();
      /** @type {Map<string, string>} */
      const why = new Map();
      /** @type {Set<string>} */
      const lateOnes = new Set();
      let bytes = 0;
      /** @type {string[]} */
      const roots = [...new Set(addresses.map(fetchedAddress))].filter((h) => {
        try {
          return onHosts(new URL(h));
        } catch {
          return false;
        }
      });
      let wave = roots;
      const seen = new Set(wave);
      const taken = new Set();
      while (wave.length) {
        /** @type {string[]} */
        const next = [];
        for (let i = 0; i < wave.length; i += most.atOnce) {
          const batch = wave.slice(i, i + most.atOnce);
          const answers = await Promise.all(batch.map((h) => (got.size + why.size < most.files ? one(h, stop, late) : Promise.resolve({ ok: /** @type {const} */ (false), why: `the page names more than ${most.files} files to keep` }))));
          batch.forEach((h, k) => {
            const r = answers[k];
            if (!r.ok) {
              if ("late" in r && r.late) lateOnes.add(h);
              return void why.set(h, r.why);
            }
            if (!(integrity.get(h) || []).every((said) => meetsIntegrity(r.data, said))) return void why.set(h, "its bytes do not match the integrity hash the page gives it");
            if (bytes + r.data.length > most.bytes) return void why.set(h, `the files kept from the web would be more than ${Math.round(most.bytes / 1024 / 1024)} MB`);
            let path = keptPathOf(new URL(r.final), r.type);
            if (taken.has(path.toLowerCase())) path = `${path.split("/")[0]}/${hashOf(h, 16)}${/\.[a-z0-9]+$/i.exec(path)?.[0] || ""}`;
            taken.add(path.toLowerCase());
            bytes += r.data.length;
            got.set(h, { path, type: r.type, data: r.data, final: r.final });
            const kind = kindOf(r.type, path);
            if (!kind) return;
            for (const ref of refsIn(r.data.toString("utf8"), kind, r.final))
              if (!seen.has(ref.href)) {
                seen.add(ref.href);
                next.push(ref.href);
              }
          });
        }
        wave = next;
      }
      /** Each fetched file as kept, and what it names. @type {Map<string, { data: Buffer, names: string[] }>} */
      const kept = new Map();
      for (const [h, f] of got) {
        const kind = kindOf(f.type, f.path);
        if (!kind) {
          kept.set(h, { data: f.data, names: [] });
          continue;
        }
        // Its references to files kept beside it point at them; one not kept is written as its address on the web, which
        // a relative one would no longer reach from where it is kept; one that already names its file as written, or an
        // address written whole, stays as it was — so a file is the bytes fetched wherever it can be.
        const text = f.data.toString("utf8");
        const refs = refsIn(text, kind, f.final);
        let out = "";
        let at = 0;
        for (const r of refs) {
          const to = got.get(r.href)?.path;
          const spec = text.slice(r.start, r.end);
          if (to ? namesKept(f.path, spec, to) : /^https:\/\//i.test(spec)) continue;
          out += text.slice(at, r.start) + (to ? relativeRef(f.path, to) : r.href);
          at = r.end;
        }
        kept.set(h, { data: at ? Buffer.from(out + text.slice(at), "utf8") : f.data, names: refs.map((r) => r.href) });
      }
      // A file the page gives an integrity hash is kept only as the bytes it was checked as: one Filament would have to
      // change stays on the web, and what it names is kept only where another kept file names it too.
      for (const h of roots) {
        const f = got.get(h);
        if (f && integrity.has(h) && !kept.get(h)?.data.equals(f.data)) why.set(h, "Filament would have to change it to keep it, and the page's integrity hash would then fail");
      }
      /** The files kept: each the page uses, and what they name in turn. @type {Set<string>} */
      const used = new Set();
      const todo = roots.filter((h) => got.has(h) && !why.has(h));
      while (todo.length) {
        const h = /** @type {string} */ (todo.pop());
        if (used.has(h) || !got.has(h)) continue;
        used.add(h);
        todo.push(...(kept.get(h)?.names || []));
      }
      const named = new Set([...used].flatMap((h) => kept.get(h)?.names || []));
      /** @type {PinnedFile[]} */
      const files = [];
      for (const [h, f] of got) if (used.has(h)) files.push({ path: `${WEB_DIR}/${f.path}`, data: /** @type {Buffer} */ (kept.get(h)?.data) });
      /** @type {Record<string, string>} */
      const pins = {};
      /** @type {{ address: string, why: string }[]} */
      const failed = [];
      for (const a of new Set(addresses)) {
        const h = fetchedAddress(a);
        const f = got.get(h);
        if (f && used.has(h) && !why.has(h)) pins[a] = f.path;
        else failed.push({ address: a, why: why.get(h) || "it is no address Filament fetches from" });
      }
      // What a kept file names but could not be fetched is said too: that file will miss it offline.
      for (const [h, w] of why) if (!roots.includes(h) && named.has(h)) failed.push({ address: h, why: w });
      return { files, pins, failed, late: failed.filter((f) => lateOnes.has(fetchedAddress(f.address))).length };
    },
  };
}

/** @typedef {ReturnType<typeof createWebPins>} WebPins */
