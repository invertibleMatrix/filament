// @ts-check
// The desktop app's updates (the owner's of 11-05; every system, asked in the app, the owner's of 11-07): the installed
// app looks for a newer Filament on the public repository its releases go to (electron-builder.yml's publish, which the
// app reads from its resources/app-update.yml) a minute after it starts and every six hours after. A newer one is
// offered — the app's notice and its tray say so — and nothing is fetched until the person asks: then the download for
// how this app was installed (its `kind`) comes while they work, checked against the SHA-512 electron-builder wrote
// for it (the release's latest*.yml) — a release without one is not taken — and the notice asks again before it
// installs (lib/install-update.js). A store's build (the Mac App Store, the Microsoft Store) is updated by its store:
// its notice opens the store instead. The checksum says the file is the one its release names; on a Mac, Squirrel.Mac
// also checks the new app is signed as this one is. What a server's build takes too — the versions compared, the
// SHA-512 latest*.yml gives, the release's look and the checked download — is src/services/updates.js's (the remote
// plan's sv-update), said again here as the app imports it; the kinds are this app's. Plain Node (NA-D13): main.js
// runs it.
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fetchInstaller, isNewer, lookForUpdate as lookFor, shaIn } from "../../src/services/updates.js";

export { fetchInstaller, isNewer, shaIn };

/** How soon after the app starts it first looks, and how often after. */
export const FIRST_LOOK_MS = 60_000;
export const LOOK_EVERY_MS = 6 * 60 * 60_000;
/** How long a look waits on GitHub: a stalled one would hold every look after it, and Check now's "Checking…". */
export const LOOK_TIMEOUT_MS = 30_000;

/**
 * How this app updates, by how it was installed: `nsis` Windows' installer, run silently; `mac` the release's zip,
 * through Squirrel.Mac (Electron's autoUpdater); `appimage` the AppImage file replaced by the new one; `deb` the
 * release's deb, installed through the system's password prompt; `mac-store` and `windows-store` their store; `page`
 * none of these — a build run unpacked — whose notice opens the release's page.
 * @typedef {"nsis" | "mac" | "appimage" | "deb" | "mac-store" | "windows-store" | "page"} Kind
 */

/**
 * This app's kind. `appImage`: the AppImage's own path, which its runtime sets as APPIMAGE; `packageType`: what
 * electron-builder wrote in a Linux package's resources/package-type (deb, rpm…); `execPath`: the app's program — a
 * deb installs it under /opt, while the same resources, package-type and all, are in the unpacked build it was made
 * from; `mas` and `windowsStore`: Electron's process.mas and process.windowsStore, true in a store's build.
 * @param {{ platform?: string, mas?: boolean, windowsStore?: boolean, appImage?: string, packageType?: string, execPath?: string }} [o]
 * @returns {Kind}
 */
export function kindOf({ platform = process.platform, mas = false, windowsStore = false, appImage = "", packageType = "", execPath = process.execPath } = {}) {
  if (mas) return "mac-store";
  if (windowsStore) return "windows-store";
  if (platform === "win32") return "nsis";
  if (platform === "darwin") return "mac";
  if (platform === "linux") return appImage ? "appimage" : packageType.trim() === "deb" && execPath.startsWith("/opt/") ? "deb" : "page";
  return "page";
}

/**
 * What a release carries for each kind that downloads: the file, by its version as electron-builder.yml's artifactName
 * makes it, and the update file its SHA-512 is in.
 * @type {Partial<Record<Kind, { file: (version: string) => string, feed: string }>>}
 */
export const ASSETS = {
  nsis: { file: (v) => `Filament-${v}-setup-x64.exe`, feed: "latest.yml" },
  mac: { file: (v) => `Filament-${v}-mac-arm64.zip`, feed: "latest-mac.yml" },
  appimage: { file: (v) => `Filament-${v}-linux-x86_64.AppImage`, feed: "latest-linux.yml" },
  deb: { file: (v) => `Filament-${v}-linux-amd64.deb`, feed: "latest-linux.yml" },
};

/** Where a store's build is updated: its store's own updates page. @type {Partial<Record<Kind, string>>} */
export const STORE_PAGES = { "mac-store": "macappstore://showUpdatesPage", "windows-store": "ms-windows-store://downloadsandupdates" };

/**
 * An update a release offers: its version, the file to fetch for this app's kind — its name, address, size and SHA-512
 * (base64, as latest*.yml says it), none for a store or a page — the release's page, and the kind.
 * @typedef {import("../../src/services/updates.js").Update<Kind>} Update
 */

/** The GitHub repository a package.json names (`repository`), or null. @param {any} pkg @returns {{ owner: string, repo: string } | null} */
export function repoOf(pkg) {
  const r = pkg?.repository;
  const url = typeof r === "string" ? r : r?.url;
  const m = /github\.com[/:]([^/\s]+)\/([^/#?\s]+?)(?:\.git)?\/?(?:[#?].*)?$/.exec(String(url || ""));
  return m ? { owner: m[1], repo: m[2] } : null;
}

/**
 * The repository an app's resources/app-update.yml names — the one electron-builder.yml publishes to, where the
 * releases are — or null where it names no GitHub one.
 * @param {string} yml @returns {{ owner: string, repo: string } | null}
 */
export function releasesRepoOf(yml) {
  const field = (/** @type {string} */ k) => new RegExp(`^${k}:\\s*(.+?)\\s*$`, "m").exec(String(yml ?? ""))?.[1].replace(/^(['"])(.*)\1$/, "$2") || "";
  const [provider, owner, repo] = ["provider", "owner", "repo"].map(field);
  return provider === "github" && /^[\w.-]+$/.test(owner) && /^[\w.-]+$/.test(repo) ? { owner, repo } : null;
}

/**
 * The newest release of `owner/repo`, where it is newer than `current` and — for a kind that downloads — carries its
 * file for this app's kind and that file's SHA-512; else none, and why, for the log (src/services/updates.js
 * lookForUpdate, by this app's ASSETS).
 * @param {{ current: string, owner: string, repo: string, kind?: Kind, fetchImpl?: typeof fetch, signal?: AbortSignal }} o
 * @returns {Promise<{ update: Update | null, why: string, newest?: boolean, failed?: boolean }>}  `failed`: GitHub answered with an error; `newest`: the build that runs is as new
 */
export const lookForUpdate = ({ kind = "nsis", ...o }) => lookFor({ ...o, kind, asset: ASSETS[kind] });

/** Every file in the updates folder gone: the build that runs is the newest, and a download kept there is spent. @param {string} dir */
export function clearUpdates(dir) {
  try {
    for (const n of readdirSync(dir)) rmSync(join(dir, n), { recursive: true, force: true });
  } catch {}
}

/**
 * How Windows' installer runs as an update: silently, as an update, and — for Restart to update — the app started after.
 * @param {boolean} restart
 */
export const installArgs = (restart) => ["/S", "--updated", ...(restart ? ["--force-run"] : [])];

/**
 * Where the updater stands, as the app's notice and its tray show it: `none` nothing newer; `available` a newer one,
 * not fetched (a store's or a page's stays here: its action opens the store, or the page); `downloading` with the
 * bytes so far; `ready` fetched and checked; `failed` a download that failed, and why — asked again, it tries again.
 * @typedef {{ phase: "none" | "available" | "downloading" | "ready" | "failed", version: string, kind: Kind, page: string, received: number, size: number, why: string }} UpdateState
 */

/**
 * What a look found, for one the person asked for (Settings › About's Check now): `out` a newer one, offered (`state`
 * says where it stands); `newest` this build is as new as the newest release; `none` no update to take, and why (a
 * release without this system's file, or no release); `failed` GitHub not reached, and why; `off` a look by itself while
 * the looking is off.
 * @typedef {{ result: "out" | "newest" | "none" | "failed" | "off", version?: string, why?: string }} Looked
 */

/**
 * The app's updater. `look()` finds an update, once at a time, and fetches nothing — `look(true)`, one the person
 * asked for, looks while the looking is off; → what it found; `fetch()` fetches the one found —
 * the person asked — joining a fetch under way; `ready` is the one fetched. `onChange` hears every move of `state`, and
 * a download's progress at most each percent. `prepare`: what the kind does with the file once it is checked, before
 * it is ready (a Mac's hands it to Squirrel.Mac): its failure is the download's. `start()` looks FIRST_LOOK_MS in and
 * every LOOK_EVERY_MS after; `enabled()` false skips a look by itself.
 * @param {{ current: string, repo: { owner: string, repo: string } | null, dir: string, kind?: Kind, fetchImpl?: typeof fetch, log?: (line: string) => void,
 *   onChange?: (s: UpdateState) => void, prepare?: (u: Update & { file: string }) => Promise<void>, enabled?: () => boolean, firstMs?: number, everyMs?: number, lookMs?: number }} o
 */
export function createUpdater({ current, repo, dir, kind = "nsis", fetchImpl = fetch, log = () => {}, onChange = () => {}, prepare, enabled = () => true, firstMs = FIRST_LOOK_MS, everyMs = LOOK_EVERY_MS, lookMs = LOOK_TIMEOUT_MS }) {
  /** @type {Update | null} */
  let available = null;
  /** @type {(Update & { file: string }) | null} */
  let ready = null;
  /** @type {UpdateState} */
  let state = { phase: "none", version: "", kind, page: "", received: 0, size: 0, why: "" };
  /** @type {Promise<Looked> | null} */
  let looking = null;
  /** @type {Promise<void> | null} */
  let fetching = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** @param {Partial<UpdateState>} s */
  const move = (s) => {
    state = { ...state, ...s };
    onChange(state);
  };
  /** @param {boolean} asked @returns {Promise<Looked>} */
  const once = async (asked) => {
    if (!repo) return { result: "none", why: "this build names no repository to look in" };
    if (!asked && !enabled()) return { result: "off" };
    try {
      const { update, why, newest, failed } = await lookForUpdate({ current, ...repo, kind, fetchImpl, signal: AbortSignal.timeout(lookMs) });
      if (!update) {
        if (newest && !ready && !fetching) {
          // As new as the newest: the download of the update it came by, and one a crash cut, go — and an offer not yet
          // taken, of a release pulled since, is offered no more.
          clearUpdates(dir);
          if (available) {
            available = null;
            move({ phase: "none", version: "", page: "", received: 0, size: 0, why: "" });
          }
        }
        log(`updates: none to take — ${why}`);
        return newest ? { result: "newest", version: current } : { result: failed ? "failed" : "none", why };
      }
      if (available?.version === update.version) {
        // The same version, its files uploaded again since (a run of the release's built again): the offer is the
        // release as it stands, so its download is checked by the SHA-512 it gives now.
        if (!fetching && !ready) available = update;
        return { result: "out", version: update.version };
      }
      // A download under way of an older one goes on; the newer one is offered once it ends.
      if (fetching) {
        log(`updates: Filament ${update.version} is out; offered once the download under way ends`);
        return { result: "out", version: update.version };
      }
      available = update;
      ready = null;
      log(`updates: Filament ${update.version} is out`);
      move({ phase: "available", version: update.version, page: update.page, received: 0, size: update.size, why: "" });
      return { result: "out", version: update.version };
    } catch (/** @type {any} */ e) {
      const why = e?.name === "TimeoutError" ? `GitHub didn't answer within ${Math.round(lookMs / 1000)} seconds` : String(e?.message || e);
      log(`updates: the look failed (${why}); the next one tries again`);
      return { result: "failed", why };
    }
  };
  /** Looks now, joining a look under way; `asked`, the person's, while the looking is off too. @param {boolean} [asked] */
  const look = (asked = false) => (looking ||= once(asked).finally(() => (looking = null)));
  /** Fetches the update found — a store's or a page's has nothing to fetch — joining a fetch under way. */
  const fetchIt = () =>
    (fetching ||= (async () => {
      let u = available;
      if (!u || !ASSETS[u.kind] || ready?.version === u.version) return;
      const again = state.phase === "failed";
      let shown = -1;
      move({ phase: "downloading", received: 0, size: u.size, why: "" });
      // Try again reads the release as it stands: a download that failed its SHA-512 may have met files uploaded again.
      if (again && repo)
        try {
          const { update } = await lookForUpdate({ current, ...repo, kind, fetchImpl, signal: AbortSignal.timeout(lookMs) });
          if (update?.version === u.version) u = available = update;
        } catch {}
      log(`updates: fetching Filament ${u.version} (${u.name})`);
      try {
        const file = await fetchInstaller(u, dir, {
          fetchImpl,
          onProgress: (received, size) => {
            const pct = size ? Math.floor((received / size) * 100) : -1;
            if (pct === shown) return;
            shown = pct;
            move({ received, size });
          },
        });
        await prepare?.({ ...u, file });
        ready = { ...u, file };
        log(`updates: Filament ${u.version} is ready, checked by its SHA-512: ${file}`);
        move({ phase: "ready", received: state.size || state.received });
      } catch (/** @type {any} */ e) {
        log(`updates: Filament ${u.version}'s download failed (${e?.message || e})`);
        move({ phase: "failed", why: String(e?.message || e) });
      }
    })().finally(() => (fetching = null)));
  return {
    look,
    fetch: fetchIt,
    get state() {
      return state;
    },
    get available() {
      return available;
    },
    get ready() {
      return ready;
    },
    start() {
      const tick = () => {
        timer = setTimeout(() => void look().finally(tick), everyMs);
        timer.unref?.();
      };
      timer = setTimeout(() => void look().finally(tick), firstMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
