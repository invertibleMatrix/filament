// @ts-check
// How an update fetched and checked (lib/updates.js) installs, by how the app was installed (the owner's of 11-07: every
// system, the person asked first). Windows: its installer runs silently as the app quits (main.js). A Mac: Squirrel.Mac
// — Electron's autoUpdater — takes the zip Filament fetched and checked, from a server of the app's own on 127.0.0.1
// that only it is told the address of, checks the new app is signed as this one is, and readies it; Restart to update
// quits and installs it, and a Quit installs it as the app goes. An AppImage: the new file takes the old one's place,
// its path kept, and the app starts again from it. A deb: the system's password prompt (pkexec) installs it with apt,
// and the app starts again; a prompt the person dismisses installs nothing, and the app keeps running. Plain Node
// (NA-D13): Electron's autoUpdater and app come in from main.js.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, createReadStream, renameSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename } from "node:path";

/** How long Squirrel.Mac may take to ready an update before it is given up (it unpacks and checks the whole app). */
export const SQUIRREL_MS = 10 * 60_000;

/**
 * The zip handed to Squirrel.Mac and readied: Squirrel asks the feed, which answers with the zip's address on the same
 * server, fetches it from there, and says update-downloaded once the new app is unpacked and its signature checked.
 * Resolves then; rejects with Squirrel's error, or after `timeoutMs`. The server closes either way.
 * @param {{ autoUpdater: any, zip: string, log?: (line: string) => void, timeoutMs?: number }} o  `autoUpdater`: Electron's
 *   (setFeedURL, checkForUpdates, on, removeListener), from main.js
 * @returns {Promise<void>}
 */
export async function readySquirrel({ autoUpdater, zip, log = () => {}, timeoutMs = SQUIRREL_MS }) {
  const token = randomBytes(16).toString("hex");
  const name = encodeURIComponent(basename(zip));
  /** @type {number} */
  let port = 0;
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === `/${token}/feed`) {
      res.writeHead(200, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ url: `http://127.0.0.1:${port}/${token}/${name}` }));
    }
    if (req.method === "GET" && req.url === `/${token}/${name}`) {
      // A zip gone from under it (its folder emptied) is Squirrel's error to say, never one thrown in the app.
      try {
        const size = statSync(zip).size;
        res.writeHead(200, { "content-type": "application/zip", "content-length": size });
        return void createReadStream(zip).on("error", () => res.destroy()).pipe(res);
      } catch {
        res.writeHead(404);
        return void res.end();
      }
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((ok, fail) => server.once("error", fail).listen(0, "127.0.0.1", () => ok(undefined)));
  port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  /** @type {Array<[string, (...a: any[]) => void]>} */
  const heard = [];
  try {
    await new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`Squirrel.Mac did not ready the update in ${Math.round(timeoutMs / 60_000)} minutes`)), timeoutMs);
      const on = (/** @type {string} */ e, /** @type {(...a: any[]) => void} */ f) => (heard.push([e, f]), autoUpdater.on(e, f));
      on("update-downloaded", () => (clearTimeout(timer), ok(undefined)));
      on("update-not-available", () => (clearTimeout(timer), fail(new Error("Squirrel.Mac found no update at the feed"))));
      on("error", (/** @type {any} */ e) => (clearTimeout(timer), fail(new Error(`Squirrel.Mac: ${e?.message || e}`))));
      autoUpdater.setFeedURL({ url: `http://127.0.0.1:${port}/${token}/feed`, serverType: "default" });
      log(`updates: handing ${basename(zip)} to Squirrel.Mac`);
      autoUpdater.checkForUpdates();
    });
  } finally {
    for (const [e, f] of heard) autoUpdater.removeListener(e, f);
    server.close();
  }
}

/**
 * The AppImage at `to` replaced by the one at `from`: copied beside it, made runnable, then put in its place — one
 * rename, so a failure leaves the old one whole. The running app reads the old file's copy, which it keeps until it ends.
 * @param {string} from @param {string} to
 * @param {{ copy?: typeof copyFileSync, chmod?: typeof chmodSync, rename?: typeof renameSync, remove?: (p: string) => void }} [fs]
 * @returns {{ ok: true } | { ok: false, why: string }}
 */
export function replaceAppImage(from, to, { copy = copyFileSync, chmod = chmodSync, rename = renameSync, remove = (p) => rmSync(p, { force: true }) } = {}) {
  const next = `${to}.new`;
  try {
    copy(from, next);
    chmod(next, 0o755);
    rename(next, to);
    return { ok: true };
  } catch (/** @type {any} */ e) {
    try {
      remove(next);
    } catch {}
    return { ok: false, why: `the AppImage at ${to} can't be replaced (${e?.code || e?.message || e})` };
  }
}

/**
 * What runs as root once the password is given: the deb copied into a folder of root's own, its SHA-512 checked there
 * against the release's — the file in the updates folder is the person's to write, and was checked when it came, maybe
 * hours before — and only that copy installed with apt, which takes what it needs from the system's sources. Its exit
 * codes: 3 the copy failed, 4 the copy is not the file checked.
 */
export const DEB_INSTALL = [
  'set -u; d=$(mktemp -d) || exit 3; trap \'rm -rf "$d"\' EXIT',
  'cp -- "$1" "$d/update.deb" || exit 3',
  'printf "%s  %s\\n" "$2" "$d/update.deb" | sha512sum -c --status - || exit 4',
  'apt-get install -y "$d/update.deb"',
].join("\n");

/**
 * A deb installed through the system's password prompt: pkexec runs DEB_INSTALL as root on it, with the SHA-512 its
 * release gives (base64, as latest-linux.yml says it). → ok, or why not: a prompt dismissed, no pkexec, a file that
 * changed since it was checked, apt's own failure.
 * @param {string} file @param {string} sha512 @param {{ spawnImpl?: typeof spawn }} [o]
 * @returns {Promise<{ ok: true } | { ok: false, why: string }>}
 */
export function installDeb(file, sha512, { spawnImpl = spawn } = {}) {
  return new Promise((done) => {
    const hex = Buffer.from(sha512, "base64").toString("hex");
    const child = spawnImpl("pkexec", ["/bin/sh", "-c", DEB_INSTALL, "filament-update", file, hex], { stdio: "ignore" });
    child.on("error", (/** @type {any} */ e) =>
      done({ ok: false, why: e?.code === "ENOENT" ? `this system has no pkexec to ask for the password: install it with sudo apt install ${file}` : `pkexec could not start (${e?.code || e?.message})` }),
    );
    child.on("close", (/** @type {number | null} */ code) =>
      done(
        code === 0
          ? { ok: true }
          : {
              ok: false,
              why:
                code === 126
                  ? "the password prompt was dismissed"
                  : code === 127
                    ? "the system did not allow it"
                    : code === 3
                      ? `${file} could not be copied to install it`
                      : code === 4
                        ? `${file} changed since it was checked against its release: it was not installed`
                        : `apt-get exited with code ${code}`,
            },
      ),
    );
  });
}

/**
 * How the app starts again once an update is in place on Linux: an AppImage from its own file (the app's executable
 * lives in the image's mount, which goes with it), a deb's from its program, each with the arguments it was started
 * with. @param {"appimage" | "deb"} kind @param {{ appImage?: string, execPath: string, argv: string[] }} o
 */
export const relaunchOf = (kind, { appImage = "", execPath, argv }) => ({ execPath: kind === "appimage" ? appImage : execPath, args: argv.slice(1) });
