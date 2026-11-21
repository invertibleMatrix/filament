// @ts-check
// Filament's updates, what every install takes alike (the remote plan's sv-update; from desktop/lib/updates.js): a
// newer release found on the public repository its releases go to, the file a release carries for how Filament was
// installed, and that file fetched and checked against the SHA-512 the release's latest*.yml gives — a download that
// does not match is not kept, and a release without one is not taken. The desktop app's kinds and its updater are
// desktop/lib/updates.js's; a server's build (`server`: the tarball scripts/dist-server.mjs makes for its machine, x64
// or arm64, with the memory engine or without, by latest-server.yml or arm64's latest-server-arm64.yml) is updated by
// `filament update` (src/cli/update.js). Plain Node.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * What a release carries for one kind of install: its file, by the version, and the update file its SHA-512 is in.
 * @typedef {{ file: (version: string) => string, feed: string }} Asset
 */

/**
 * An update a release offers: its version, the file to fetch for the install's kind — its name, address, size and
 * SHA-512 (base64, as latest*.yml says it), none for a kind with nothing to fetch — the release's page, and the kind.
 * @template {string} [K=string]
 * @typedef {{ version: string, name: string, url: string, size: number, sha512: string, page: string, kind: K }} Update
 */

/** What a server's build is for (scripts/dist-server.mjs SERVER_TARGETS). */
export const SERVER_TARGETS = ["linux-x64", "linux-arm64"];
/** x64's: the machine a name is for where none is given (scripts/dist-server.mjs SERVER_TARGET). */
export const SERVER_TARGET = "linux-x64";
/** The update file a release carries for x64's servers (scripts/dist-server.mjs FEED). */
export const SERVER_FEED = "latest-server.yml";

/**
 * A server's tarball for the machine `target`, as scripts/dist-server.mjs names it; `engine` false, the one without
 * the memory engine. @param {string} version @param {boolean} [engine] @param {string} [target]
 */
export const serverTarball = (version, engine = true, target = SERVER_TARGET) => `filament-server-${version}-${target}${engine ? "" : "-no-engine"}.tar.gz`;

/** The update file for `target`'s servers (scripts/dist-server.mjs feedName): x64's latest-server.yml, latest-server-arm64.yml for arm64's. @param {string} [target] */
export const serverFeed = (target = SERVER_TARGET) => (target === SERVER_TARGET ? SERVER_FEED : `latest-server-${target.replace(/^linux-/, "")}.yml`);

/**
 * What a release carries for a server's build: the tarball of the kind installed — with the memory engine, or
 * without — for the machine its build is for, and that machine's update file.
 * @param {boolean} engine @param {string} [target] @returns {Asset}
 */
export const serverAsset = (engine, target = SERVER_TARGET) => ({ file: (v) => serverTarball(v, engine, target), feed: serverFeed(target) });

/** "1.2.3", with a leading v or a prerelease after a dash, as its parts; null for none. @param {unknown} v */
const partsOf = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(String(v ?? "").trim());
  return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || "" } : null;
};

/** Whether version `a` is newer than `b`: a prerelease comes before its release. @param {unknown} a @param {unknown} b */
export function isNewer(a, b) {
  const x = partsOf(a),
    y = partsOf(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] > y.n[i];
  if (x.pre === y.pre) return false;
  if (!x.pre) return true;
  if (!y.pre) return false;
  return x.pre.localeCompare(y.pre, "en", { numeric: true }) > 0;
}

/** @param {string} v */
const unquote = (v) => v.trim().replace(/^(['"])(.*)\1$/, "$2");

/**
 * The SHA-512 latest*.yml gives the file `name` — its `files` entry, or the older `path`/`sha512` pair — or null.
 * @param {string} yml @param {string} name
 */
export function shaIn(yml, name) {
  const lines = String(yml ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const url = /^\s*-\s*url:\s*(.+)$/.exec(lines[i]);
    if (!url || unquote(url[1]) !== name) continue;
    for (let j = i + 1; j < lines.length && /^\s+[^-\s]/.test(lines[j]); j++) {
      const sha = /^\s+sha512:\s*(.+)$/.exec(lines[j]);
      if (sha) return unquote(sha[1]);
    }
  }
  const path = /^path:\s*(.+)$/m.exec(yml),
    sha = /^sha512:\s*(.+)$/m.exec(yml);
  return path && sha && unquote(path[1]) === name ? unquote(sha[1]) : null;
}

/**
 * The newest release of `owner/repo` where it is newer than `current` — or the one `version` names, whatever its
 * version — and, for a kind that downloads (`asset`), carries its file for that kind and that file's SHA-512; else
 * none, and why.
 * @template {string} K
 * @param {{ current: string, owner: string, repo: string, kind: K, asset: Asset | null | undefined, version?: string, fetchImpl?: typeof fetch, signal?: AbortSignal }} o
 * @returns {Promise<{ update: Update<K> | null, why: string, newest?: boolean, failed?: boolean }>}  `failed`: GitHub answered with an error; `newest`: the build that runs is as new
 */
export async function lookForUpdate({ current, owner, repo, kind, asset, version: named = "", fetchImpl = fetch, signal }) {
  const headers = { accept: "application/vnd.github+json", "user-agent": `Filament/${current}` };
  const r = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/releases/${named ? `tags/v${named}` : "latest"}`, { headers, signal });
  if (r.status === 404) return { update: null, why: named ? `${owner}/${repo} has no release ${named}` : `${owner}/${repo} has no release, or is not public` };
  if (!r.ok) return { update: null, why: `GitHub answered HTTP ${r.status}`, failed: true };
  const rel = /** @type {any} */ (await r.json());
  const version = String(rel?.tag_name || "").replace(/^v/, "");
  if (!partsOf(version)) return { update: null, why: `the newest release's tag (${JSON.stringify(rel?.tag_name ?? null)}) is no version` };
  if (!named && !isNewer(version, current)) return { update: null, why: `${current} is as new as the newest release (${version})`, newest: true };
  const page = String(rel.html_url || "");
  // A kind with nothing to fetch — a store's build, or one that can't update itself: the version and the page alone.
  if (!asset) return { update: { version, name: "", url: "", size: 0, sha512: "", page, kind }, why: "" };
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  // Its own version's file by name (electron-builder.yml's artifactName, dist-server.mjs's tarballName): one of another
  // version under the tag would install as a downgrade, again at every Quit (the review of 85ff00e86).
  const name = asset.file(version);
  const file = assets.find((/** @type {any} */ a) => a?.name === name && basename(name) === name);
  const yml = assets.find((/** @type {any} */ a) => a?.name === asset.feed);
  if (!file) return { update: null, why: `release ${version} carries no ${name}` };
  if (!yml) return { update: null, why: `release ${version} carries no ${asset.feed} to check its ${name} by` };
  const y = await fetchImpl(String(yml.browser_download_url), { headers: { "user-agent": headers["user-agent"] }, signal, redirect: "follow" });
  if (!y.ok) return { update: null, why: `release ${version}'s ${asset.feed} answered HTTP ${y.status}`, failed: true };
  const sha512 = shaIn(await y.text(), String(file.name));
  if (!sha512) return { update: null, why: `release ${version}'s ${asset.feed} gives no SHA-512 for ${file.name}` };
  return { update: { version, name: String(file.name), url: String(file.browser_download_url), size: Number(file.size) || 0, sha512, page, kind }, why: "" };
}

/** A file's SHA-512, base64. @param {string} file @returns {Promise<string>} */
const shaOfFile = async (file) => {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("base64");
};

/**
 * The update's file in `dir`, checked by its SHA-512: → its path. One there already that matches is kept as it is; a
 * download that does not match is removed and fails in words; every other file in `dir` goes once it is in.
 * `onProgress` hears the bytes as they come, and the size the release gives.
 * @param {Update} update @param {string} dir
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal, onProgress?: (received: number, size: number) => void }} [o]
 */
export async function fetchInstaller(update, dir, { fetchImpl = fetch, signal, onProgress } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, update.name);
  if (!existsSync(file) || (await shaOfFile(file)) !== update.sha512) {
    const part = `${file}.part`;
    const r = await fetchImpl(update.url, { headers: { "user-agent": `Filament/${update.version}` }, signal, redirect: "follow" });
    if (!r.ok || !r.body) throw new Error(`the download answered HTTP ${r.status}`);
    const size = update.size || Number(r.headers.get("content-length")) || 0;
    const hash = createHash("sha512");
    let received = 0;
    const through = new Transform({
      transform(chunk, _enc, done) {
        hash.update(chunk);
        received += chunk.length;
        onProgress?.(received, size);
        done(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(/** @type {any} */ (r.body)), through, createWriteStream(part));
    } catch (e) {
      rmSync(part, { force: true });
      throw e;
    }
    if (hash.digest("base64") !== update.sha512) {
      rmSync(part, { force: true });
      throw new Error(`the download of Filament ${update.version} does not match the SHA-512 its release gives: it was not kept`);
    }
    rmSync(file, { force: true });
    renameSync(part, file);
  }
  for (const n of readdirSync(dir)) if (n !== update.name) rmSync(join(dir, n), { recursive: true, force: true });
  return file;
}
