// @ts-check
// The admin API's files area: read-only views of a project folder for the harness (plan B3) — the tree, a file for
// the code viewer, a name search, and the folder browser — plus the two things that open a window rather than a
// file: the OS folder dialog and Show in folder, raised server-side (the server runs on the same machine as the
// browser, so the window is the user's real Explorer or Finder) — for this computer's caller alone (`elsewhere`). `cwd` must be a
// folder the agent loop itself may work in (folder.js); every `path` stays inside it through the hands' own fence.
// Nothing here writes, and nothing leaves the loopback admin surface: the same posture as the request bodies on
// /api/requests/:id.
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { sendJson } from "../../app/pipeline/respond.js";
import { agentsDevice, isLocalCaller } from "../guards.js";
import { guard as guardWith } from "./guard.js";
import { allowedFolder, allowedFolderSoon } from "./folder.js";
import { folderDocument } from "./exec.js";
import { listTree, readPreview, searchNames, findMentions, listDirs } from "../../adapters/tools/workspace.js";
import { folderVerdict, networkShare } from "../../app/agent/turn.js";
import { folderThere } from "../../adapters/git/folder-there.js";
import { redactorOf } from "../../core/redact.js";

// ASCII only, no em dashes: PowerShell 5.1 reads a BOM-less command string through the console codepage, and a
// smart quote where an ASCII apostrophe should be is a parse error (the tray scripts taught this). The topmost
// owner form is what brings the dialog over the browser window that asked for it.
const PICK_FOLDER_PS = [
  "Add-Type -AssemblyName System.Windows.Forms | Out-Null",
  "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }",
  "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$d.Description = 'Pick a project folder'",
  "$d.ShowNewFolderButton = $true",
  "if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
].join("; ");
// A Mac's: osascript shows `choose folder` itself, brought in front of the browser that asked (`activate`, which asks
// no other app and so no Automation permission), and writes its POSIX path, a `/` at its end.
const PICK_FOLDER_OSA = ["tell me to activate", 'POSIX path of (choose folder with prompt "Pick a project folder")'];

/** How a dialog's child ended: its exit code, what it wrote (4 KB at most), its error's tail; `missing`: not installed. @typedef {{ code: number, out: string, err: string, missing?: boolean }} Ran */

/**
 * The system's folder dialogs on `platform`, in the order they are tried — the next where one is not installed —, each
 * with how its Cancel reads: PowerShell's ends well having written nothing, osascript's in AppleScript's error -128,
 * zenity's and kdialog's with exit 1 (GTK writes its warnings either way). A Linux with no display to show one on (a
 * headless server) has none, and the page lists its folders itself.
 * @param {string} platform  Node's `process.platform` @param {Record<string, string | undefined>} env
 * @returns {{ cmd: string, args: string[], cancelled: (r: Ran) => boolean }[]}
 */
function folderDialogs(platform, env) {
  if (platform === "win32") return [{ cmd: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", PICK_FOLDER_PS], cancelled: (r) => !r.err }];
  if (platform === "darwin") return [{ cmd: "osascript", args: PICK_FOLDER_OSA.flatMap((line) => ["-e", line]), cancelled: (r) => /\(-128\)/.test(r.err) }];
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return [];
  return [
    { cmd: "zenity", args: ["--file-selection", "--directory", "--title=Pick a project folder"], cancelled: (r) => r.code === 1 },
    { cmd: "kdialog", args: ["--title", "Pick a project folder", "--getexistingdirectory"], cancelled: (r) => r.code === 1 },
  ];
}

/**
 * A dialog's child run to its end. A child, so a dialog left open never blocks a server thread; the kill at ten minutes
 * is the janitor for a dialog nobody will ever answer.
 * @param {typeof spawn} run @param {string} cmd @param {string[]} args
 * @returns {Promise<Ran>}
 */
function runDialog(run, cmd, args) {
  return new Promise((resolve) => {
    /** @type {any} */
    let child;
    try {
      child = run(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (/** @type {any} */ e) {
      return resolve({ code: 1, out: "", err: e.message, missing: e?.code === "ENOENT" });
    }
    let s = "";
    let errTail = "";
    child.stdout.on("data", (/** @type {Buffer} */ d) => { s += d.toString("utf8"); if (s.length > 4096) { try { child.kill(); } catch {} } });
    child.stderr.on("data", (/** @type {Buffer} */ d) => { errTail = (errTail + d.toString("utf8")).slice(-300); });
    const t = setTimeout(() => { try { child.kill(); } catch {} }, 600000);
    t.unref?.();
    child.on("error", (/** @type {any} */ e) => { clearTimeout(t); resolve({ code: 1, out: "", err: e.message, missing: e?.code === "ENOENT" }); });
    child.on("close", (/** @type {number | null} */ code) => { clearTimeout(t); resolve({ code: code ?? 1, out: s, err: errTail }); });
  });
}

/** The area's reading of a failure: a path outside the folder or one that is not there is the caller's, not a 500. */
const guard = (fn) =>
  guardWith(fn, (msg) =>
    /resolves outside|reaches outside/.test(msg)
      ? { status: 403, error: msg }
      : /^no such (file|folder)|^cannot list/.test(msg)
        ? { status: 404, error: msg }
        : null,
  );

/**
 * A caller on another machine (the owner's remote Filament of 11-06) — a paired device, the admin token, anyone through a
 * proxy here — refused in `words`, its answer marked `remote`: what opens a window opens it on this machine's screen,
 * where nobody who asked from there is. A call in Filament's own process has no socket, and is this machine's. → whether
 * it was refused.
 * @param {any} r @param {string} words
 */
const elsewhere = (r, words) => {
  if (!r.req?.socket || isLocalCaller(r.req)) return false;
  sendJson(r.res, 403, { error: words, remote: true });
  return true;
};

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function fileRoutes(a) {
  const { config } = a;
  /** The folder a row works in, looked at off the server's thread first, or the refusal already sent. @param {any} r */
  const rootOf = async (r) => {
    const f = await allowedFolderSoon(config.get(), r.url.searchParams.get("cwd"));
    if (!f.ok) {
      sendJson(r.res, f.status, { error: f.error });
      return null;
    }
    return f.root;
  };
  return [
    [
      "GET",
      "/files/tree",
      guard(async (r) => {
        const root = await rootOf(r);
        if (!root) return;
        const q = r.url.searchParams;
        return sendJson(r.res, 200, { cwd: root, ...(await listTree(root, { path: q.get("path") || "", depth: Number(q.get("depth")) || 1 })) });
      }),
    ],
    [
      // A file for the code viewer. Another machine's agents read its text redacted, as this machine's agents' read tool
      // reads it: by the privacy.redact of a chat in that folder (exec.js `folderDocument`) — an SVG's too, which is text,
      // and an image whose bytes hold what that matches they read none of (the xf-exec hunt's: a secret's file named
      // .svg, or an image carrying one, went to them whole).
      "GET",
      "/files/read",
      guard(async (r) => {
        const root = await rootOf(r);
        if (!root) return;
        const path = r.url.searchParams.get("path") || "";
        if (!path) return sendJson(r.res, 400, { error: "path is required" });
        const file = await readPreview(root, path);
        const redact = agentsDevice(r.who) ? redactorOf(folderDocument(a, root)?.privacy?.redact) : null;
        if (redact && file.kind === "text") return sendJson(r.res, 200, { cwd: root, ...file, content: redact(String(file.content ?? "")) });
        if (redact && file.kind === "image") {
          const bytes = Buffer.from(String(file.dataUrl).slice(String(file.dataUrl).indexOf(",") + 1), "base64");
          if (file.mime === "image/svg+xml") return sendJson(r.res, 200, { cwd: root, ...file, dataUrl: `data:${file.mime};base64,${Buffer.from(redact(bytes.toString("utf8")), "utf8").toString("base64")}` });
          if ([bytes.toString("latin1"), bytes.toString("utf8")].some((s) => redact(s) !== s))
            return sendJson(r.res, 403, { error: `another machine's agents read no image that holds what this folder's chats redact (privacy.redact): ${file.path}` });
        }
        return sendJson(r.res, 200, { cwd: root, ...file });
      }),
    ],
    [
      "GET",
      "/files/search",
      guard(async (r) => {
        const root = await rootOf(r);
        if (!root) return;
        const q = r.url.searchParams;
        return sendJson(r.res, 200, { cwd: root, q: q.get("q") || "", ...(await searchNames(root, q.get("q") || "", { limit: Number(q.get("limit")) || 50 })) });
      }),
    ],
    // What an `@` in the message box offers: files and folders by the letters typed, or a folder's own (findMentions).
    [
      "GET",
      "/files/mentions",
      guard(async (r) => {
        const root = await rootOf(r);
        if (!root) return;
        const q = r.url.searchParams;
        return sendJson(r.res, 200, { cwd: root, q: q.get("q") || "", ...(await findMentions(root, q.get("q") || "", { limit: Number(q.get("limit")) || 12 })) });
      }),
    ],
    // The folder browser: the roots (or the drives) at the top, one level of subfolders below. A `path` is allowed by
    // the same judgement as a cwd, so with roots listed the browser cannot wander outside them.
    [
      "GET",
      "/files/dirs",
      guard(async (r) => {
        const q = r.url.searchParams;
        const cfg = config.get();
        const roots = (Array.isArray(cfg.agentLoop?.roots) ? cfg.agentLoop.roots : []).map(String).filter(Boolean);
        const path = q.get("path") || "";
        if (path) {
          const f = await allowedFolderSoon(cfg, path);
          if (!f.ok) return sendJson(r.res, f.status, { error: f.error });
        }
        // What the person picks here is a folder for a chat of their own: Filament's copies folder is no root of it.
        return sendJson(r.res, 200, await listDirs({ path, hidden: q.get("hidden") === "1", roots, allowed: (p) => folderVerdict(cfg, p, { person: true }).ok }));
      }),
    ],
    // Existence answers, one per path, no content read: the harness prunes remembered folders that left the disk
    // (a deleted project's ghost kept being offered as a place for the next task). Each path is judged as a working
    // folder is (`folderVerdict`): true for one an agent may work in, false for one not there, and null — unknown — for
    // one the folder rules keep Filament out of. A network share is never asked here, whatever the rules: the page asks
    // unprompted, and Windows would sign in to the share's computer as the person to answer. The harness keeps a folder
    // it is not told is gone.
    [
      "POST",
      "/files/exists",
      guard(async (r) => {
        const b = await r.json();
        const paths = (Array.isArray(b?.paths) ? b.paths : []).slice(0, 64).map((p) => String(p || ""));
        const cfg = config.get();
        // Each looked at off the server's thread first, a moment at most: a mapped drive gone offline is unknown, never
        // asked again on the thread (folder-there.js `folderThere`).
        const looked = await Promise.all(paths.map((p) => (networkShare(p) || !p.trim() ? null : folderThere(p.trim()))));
        return sendJson(r.res, 200, {
          ok: paths.map((p, i) => {
            if (networkShare(p)) return null;
            if (p.trim() && looked[i] === null) return null;
            const v = folderVerdict(cfg, p);
            return v.ok ? true : v.why === "missing" || v.why === "empty" ? false : null;
          }),
        });
      }),
    ],
    // The system's folder dialog for a page in a browser, or one the desktop app does not answer (the app's own page
    // asks the app's dialog first: desktop/harness-preload.cjs `pickFolder`): Windows', a Mac's, a Linux desktop's
    // (`folderDialogs`). Where there is none — a headless Linux, neither dialog installed — the answer says
    // `noDialog` and the page lists the folders itself, unsaid, as a page on another machine does, refused. A test hands
    // the platform, the environment and spawn in `overrides.folderDialog`.
    [
      "POST",
      "/files/pick-folder",
      guard(async (r) => {
        if (elsewhere(r, "the folder dialog opens on the computer Filament runs on, not yours: browse its folders in the page")) return;
        const io = a.overrides?.folderDialog || {};
        const platform = io.platform || process.platform;
        for (const d of folderDialogs(platform, io.env || process.env)) {
          const out = await runDialog(io.spawn || spawn, d.cmd, d.args);
          if (out.missing) continue;
          // A Mac's path ends in a `/`; the root keeps its own.
          const path = platform === "win32" ? out.out.trim() : out.out.trim().replace(/(.)\/+$/, "$1");
          if (out.code === 0 && path) return sendJson(r.res, 200, { ok: true, path });
          const cancelled = d.cancelled(out);
          return sendJson(r.res, 200, { ok: false, cancelled, reason: cancelled ? "no folder was chosen" : out.err || `the folder dialog ended with code ${out.code}` });
        }
        return sendJson(r.res, 200, { ok: false, noDialog: true, reason: "this computer has no folder dialog to open: browse its folders in the page" });
      }),
    ],
    // Show in folder (HarnessV4_Four_Plan FO-D30): the OS file manager, the file selected — Explorer, Finder, else
    // the folder opened. A file in a folder the agent may work in, by the same judgement as a cwd. Nothing is read. A page
    // on another machine copies the path instead.
    [
      "POST",
      "/files/reveal",
      guard(async (r) => {
        if (elsewhere(r, "Show in folder opens the file manager on the computer Filament runs on, not yours: copy the path instead")) return;
        const b = await r.json();
        const path = String(b?.path || "");
        if (!path || !isAbsolute(path)) return sendJson(r.res, 400, { error: "path is required: a whole path" });
        // A file on a network share is judged by its folder before the disk is asked of it: one the folder rules keep out
        // is refused unasked (`folderVerdict`).
        if (networkShare(path)) {
          const near = allowedFolder(config.get(), dirname(path));
          if (!near.ok) return sendJson(r.res, near.status, { error: near.error });
        }
        let st;
        try {
          st = statSync(path);
        } catch {
          return sendJson(r.res, 404, { error: `no such file: ${path}` });
        }
        const f = allowedFolder(config.get(), st.isDirectory() ? path : dirname(path));
        if (!f.ok) return sendJson(r.res, f.status, { error: f.error });
        const shown = await revealIn(resolve(path), st.isDirectory());
        return shown ? sendJson(r.res, 500, { error: `the file manager could not be opened (${shown})` }) : sendJson(r.res, 200, { ok: true });
      }),
    ],
  ];
}

/**
 * The OS file manager on a path, left running: Explorer with the file selected (a path holds no `"` on Windows, so
 * its quotes are written as Explorer reads them), Finder likewise, elsewhere its folder. The error's words, or "".
 * @param {string} path  whole @param {boolean} folder
 * @returns {Promise<string>}
 */
function revealIn(path, folder) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["explorer.exe", [folder ? `"${path}"` : `/select,"${path}"`]]
      : process.platform === "darwin"
        ? ["open", folder ? [path] : ["-R", path]]
        : ["xdg-open", [folder ? path : dirname(path)]];
  return new Promise((done) => {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsVerbatimArguments: process.platform === "win32" });
      child.once("spawn", () => { child.unref(); done(""); });
      child.once("error", (e) => done(e.message));
    } catch (/** @type {any} */ e) {
      done(String(e?.message || e));
    }
  });
}
