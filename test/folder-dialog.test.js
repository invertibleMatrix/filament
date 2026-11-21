// @ts-check
// Browse… on a Mac (the owner's of 11-09): "it does not open finder and toast says only windows one is supported". The
// desktop app's page asks the app's own dialog (desktop/harness-preload.cjs `filamentApp.pickFolder`, Electron's
// `dialog.showOpenDialog` over the window that asked) on every system; a server run from the command line raises the
// system's own — PowerShell's on Windows, osascript's `choose folder` on a Mac, zenity's or else kdialog's on a Linux
// desktop —, and where there is none (a Linux with no display, neither installed) the page lists the server's folders
// unsaid. Only a dialog that should have opened and failed is said. The path box's example is the server's system's own
// shape. The command lines are checked here with a stand-in for spawn: only a Mac shows that osascript's dialog comes up
// in front.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { stubDocument } from "./helpers/dom-stub.js";

const g = /** @type {any} */ (globalThis);

describe("the server's dialog, by the system it runs on", () => {
  /**
   * A stand-in for spawn: how each command ends, by its name — its exit code and what it wrote —, a command named none
   * not installed (spawn's ENOENT, then its close). What was run, in order.
   * @param {Record<string, { code: number, out?: string, err?: string }>} endings
   */
  const stand = (endings) => {
    /** @type {[string, string[]][]} */
    const ran = [];
    const spawn = (/** @type {string} */ cmd, /** @type {string[]} */ args) => {
      ran.push([cmd, args]);
      const child = /** @type {any} */ (new EventEmitter());
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      const end = endings[cmd];
      setImmediate(() => {
        if (!end) {
          child.emit("error", Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" }));
          return void child.emit("close", -2);
        }
        if (end.out) child.stdout.emit("data", Buffer.from(end.out, "utf8"));
        if (end.err) child.stderr.emit("data", Buffer.from(end.err, "utf8"));
        child.emit("close", end.code);
      });
      return child;
    };
    return { spawn, ran };
  };
  /**
   * POST /files/pick-folder's answer, for this computer's caller, as if Filament ran on `platform` with `env`. Node's own
   * platform says it too, so a row that reads that alone raises no real dialog on the machine the tests run on.
   * @param {string} platform @param {Record<string, string>} env @param {any} spawn
   */
  const pick = async (platform, env, spawn) => {
    const { fileRoutes } = await import("../src/http/admin/files.js");
    const row = fileRoutes({ config: { get: () => ({}) }, overrides: { folderDialog: { platform, env, spawn } } }).find(([m, p]) => m === "POST" && p === "/files/pick-folder");
    assert.ok(row);
    const res = { status: 0, text: "", writableEnded: false, destroyed: false, headersSent: false, writeHead(/** @type {number} */ s) { this.status = s; }, end(/** @type {string} */ t) { this.text = t; } };
    const was = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(process, "platform"));
    Object.defineProperty(process, "platform", { ...was, value: platform });
    try {
      await /** @type {any} */ (row)[2]({ req: { socket: { remoteAddress: "127.0.0.1" }, headers: {} }, json: async () => ({}), res, url: new URL("http://x/api/files/pick-folder") });
    } finally {
      Object.defineProperty(process, "platform", was);
    }
    assert.equal(res.status, 200);
    return JSON.parse(res.text);
  };
  const OSA = ["osascript", ["-e", "tell me to activate", "-e", 'POSIX path of (choose folder with prompt "Pick a project folder")']];
  const ZENITY = ["zenity", ["--file-selection", "--directory", "--title=Pick a project folder"]];
  const KDIALOG = ["kdialog", ["--title", "Pick a project folder", "--getexistingdirectory"]];

  // (fails before: yes — a Mac's server answered "the native folder dialog is Windows-only" and ran nothing)
  test("a Mac: osascript's choose folder, brought to the front; its POSIX path without the trailing slash", async () => {
    const s = stand({ osascript: { code: 0, out: "/Users/me/My App/\n" } });
    assert.deepEqual(await pick("darwin", {}, s.spawn), { ok: true, path: "/Users/me/My App" });
    assert.deepEqual(s.ran, [OSA]);
  });

  // (fails before: yes — no dialog ran on a Mac)
  test("a Mac: Cancel is AppleScript's error -128, a cancel and not a failure; another error is said", async () => {
    const cancel = stand({ osascript: { code: 1, err: "0:62: execution error: User canceled. (-128)\n" } });
    assert.deepEqual(await pick("darwin", {}, cancel.spawn), { ok: false, cancelled: true, reason: "no folder was chosen" });
    const fail = stand({ osascript: { code: 1, err: "0:62: execution error: Not authorised to send Apple events. (-1743)\n" } });
    assert.deepEqual(await pick("darwin", {}, fail.spawn), { ok: false, cancelled: false, reason: "0:62: execution error: Not authorised to send Apple events. (-1743)\n" });
  });

  // (fails before: yes — a Linux desktop's server ran nothing)
  test("a Linux desktop: zenity's folder chooser; its Cancel, exit 1 over GTK's chatter, is a cancel", async () => {
    const s = stand({ zenity: { code: 0, out: "/home/me/app\n" } });
    assert.deepEqual(await pick("linux", { DISPLAY: ":0" }, s.spawn), { ok: true, path: "/home/me/app" });
    assert.deepEqual(s.ran, [ZENITY]);
    const cancel = stand({ zenity: { code: 1, err: "Gtk-Message: 10:02:11.123: GtkDialog mapped without a transient parent. This is discouraged.\n" } });
    assert.deepEqual(await pick("linux", { WAYLAND_DISPLAY: "wayland-0" }, cancel.spawn), { ok: false, cancelled: true, reason: "no folder was chosen" });
  });

  // (fails before: yes)
  test("a Linux desktop without zenity: kdialog's; with neither, no dialog — said as none, not as a failure", async () => {
    const kde = stand({ kdialog: { code: 0, out: "/home/me/kde app\n" } });
    assert.deepEqual(await pick("linux", { DISPLAY: ":0" }, kde.spawn), { ok: true, path: "/home/me/kde app" });
    assert.deepEqual(kde.ran, [ZENITY, KDIALOG]);
    const none = stand({});
    const r = await pick("linux", { DISPLAY: ":0" }, none.spawn);
    assert.deepEqual([r.ok, r.noDialog, r.cancelled], [false, true, undefined]);
    assert.deepEqual(none.ran, [ZENITY, KDIALOG]);
  });

  // (fails before: yes — it was said as "Windows-only")
  test("a Linux with no display (a headless server): no dialog, nothing run", async () => {
    const s = stand({ zenity: { code: 0, out: "/never\n" } });
    const r = await pick("linux", {}, s.spawn);
    assert.deepEqual([r.ok, r.noDialog, s.ran], [false, true, []]);
  });

  test("Windows: PowerShell's dialog as before; its cancel ends well with nothing written", async () => {
    const s = stand({ "powershell.exe": { code: 0, out: "C:\\work\\app\r\n" } });
    assert.deepEqual(await pick("win32", {}, s.spawn), { ok: true, path: "C:\\work\\app" });
    assert.deepEqual(s.ran.map(([c, a]) => [c, a.slice(0, 3)]), [["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command"]]]);
    assert.match(s.ran[0][1][3], /FolderBrowserDialog/);
    const cancel = stand({ "powershell.exe": { code: 0 } });
    assert.deepEqual(await pick("win32", {}, cancel.spawn), { ok: false, cancelled: true, reason: "no folder was chosen" });
  });
});

describe("the page", () => {
  /** What the page asked of the server, in order. @type {string[]} */
  const asked = [];
  /** The server's answer to the dialog. @type {any} */
  let answer = null;
  const realFetch = g.fetch;
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {typeof import("../src/ui/harness/lib/api.js")} */
  let apiMod;
  /** @type {typeof import("../src/ui/harness/lib/folder-browse.js")} */
  let browse;
  /** @type {typeof import("../src/ui/lib/dom.js").h} */
  let h;
  before(async () => {
    doc = stubDocument();
    g.fetch = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
      asked.push(`${String(init.method || "GET")} ${url}`);
      const body = String(url).startsWith("/api/files/pick-folder") ? answer : { parent: null, dirs: [{ name: "home", path: "/home" }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    };
    apiMod = await import("../src/ui/harness/lib/api.js");
    browse = await import("../src/ui/harness/lib/folder-browse.js");
    h = (await import("../src/ui/lib/dom.js")).h;
  });
  after(() => {
    g.fetch = realFetch;
    delete g.filamentApp;
    apiMod.setRemotePage(false);
    doc.restore();
  });
  beforeEach(() => {
    asked.length = 0;
    answer = null;
    delete g.filamentApp;
    apiMod.setRemotePage(false);
  });
  const input = () => /** @type {any} */ (h("input", { type: "text" }));
  const dialogAsked = () => asked.filter((a) => a === "POST /api/files/pick-folder").length;

  // (fails before: yes — the page asked the server, whose dialog on a Mac was none)
  test("in the desktop app, the app's own dialog first: a pick fills the box, a cancel stops there, the server asked nothing", async () => {
    /** @type {number} */
    let opened = 0;
    g.filamentApp = { pickFolder: async () => (++opened, { ok: true, path: "/Users/me/app" }) };
    const box = input();
    assert.equal(await apiMod.pickFolderNative(box), "picked");
    assert.deepEqual([box.value, opened, dialogAsked()], ["/Users/me/app", 1, 0]);
    g.filamentApp = { pickFolder: async () => ({ ok: false, cancelled: true }) };
    /** @type {string[]} */
    const said = [];
    assert.equal(await apiMod.pickFolderNative(input(), (w) => void said.push(w)), false);
    assert.deepEqual([said, dialogAsked()], [[], 0]);
  });

  // (fails before: yes)
  test("the app's dialog that failed is said; a window the app does not hear (null) asks the server's", async () => {
    g.filamentApp = { pickFolder: async () => ({ ok: false, reason: "no window" }) };
    /** @type {string[]} */
    const said = [];
    assert.equal(await apiMod.pickFolderNative(input(), (w) => void said.push(w)), "failed");
    assert.equal(said.length, 1);
    assert.match(said[0], /no window/);
    g.filamentApp = { pickFolder: async () => null };
    answer = { ok: true, path: "/home/me/app" };
    const box = input();
    assert.equal(await apiMod.pickFolderNative(box), "picked");
    assert.deepEqual([box.value, dialogAsked()], ["/home/me/app", 1]);
  });

  test("another machine's page asks neither the app's dialog nor the server's", async () => {
    let opened = 0;
    g.filamentApp = { pickFolder: async () => (++opened, { ok: true, path: "/x" }) };
    apiMod.setRemotePage(true);
    assert.equal(await apiMod.pickFolderNative(input()), "failed");
    assert.deepEqual([opened, dialogAsked()], [0, 0]);
  });

  // (fails before: yes — every not-ok answer but a cancel was said as a dialog that could not open)
  test("a server with no dialog: Browse… lists its folders in the page, nothing said; a dialog that failed is said", async () => {
    answer = { ok: false, noDialog: true, reason: "no folder dialog on this computer" };
    /** @type {string[]} */
    const said = [];
    const host = /** @type {any} */ (h("div", { class: "browse-dirs hidden" }));
    assert.equal(await browse.browseFolder(input(), host, (w) => void said.push(w)), "failed");
    assert.deepEqual([said, host.classList.contains("hidden"), host.querySelectorAll(".browse-dir").map((/** @type {any} */ b) => b.textContent)], [[], false, ["home"]]);
    answer = { ok: false, cancelled: false, reason: "execution error (-1743)" };
    await browse.browseFolder(input(), host, (w) => void said.push(w));
    assert.equal(said.length, 1);
    assert.match(said[0], /-1743/);
  });

  // (fails before: yes — "H:\path\to\the\project" on a Mac)
  test("the path box's example is the server's system's shape", () => {
    assert.equal(browse.pathExample("win32"), "H:\\path\\to\\the\\project");
    assert.equal(browse.pathExample("darwin"), "/Users/you/path/to/the/project");
    assert.equal(browse.pathExample("linux"), "/home/you/path/to/the/project");
    assert.equal(browse.pathExample(""), "/path/to/the/project", "not read yet");
    // Each box keeps its own example: its folders, and on Windows its drive.
    assert.deepEqual(["win32", "darwin", "linux", ""].map((p) => browse.pathExample(p, "skills/unity", "C")), ["C:\\skills\\unity", "/Users/you/skills/unity", "/home/you/skills/unity", "/skills/unity"]);
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    const empty = readFileSync(new URL("../src/ui/harness/conversation/empty.js", import.meta.url), "utf8");
    assert.doesNotMatch(app + empty, /H:\\\\path\\\\to/);
    assert.equal(app.match(/placeholder: pathExample\(state\.platform\)/g)?.length, 2, "Add project and the first send's picker");
    assert.equal(empty.match(/placeholder: pathExample\(state\.platform\)/g)?.length, 1, "Open folder…");
  });
});

// (fails before: yes — the app had no folder dialog to offer the page)
test("the desktop app: the bridge asks the app's dialog, the app answers Filament's own page alone, over its window", () => {
  const src = readFileSync(new URL("../desktop/harness-preload.cjs", import.meta.url), "utf8");
  /** @type {Record<string, any>} */
  const bridge = {};
  /** @type {any[]} */
  const invoked = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (/** @type {string} */ k, /** @type {any} */ v) => void (bridge[k] = v) },
    ipcRenderer: { invoke: async (/** @type {string} */ ch, /** @type {any[]} */ ...a) => void invoked.push([ch, ...a]), send() {}, on() {}, removeListener() {} },
  };
  vm.runInNewContext(src, { require: (/** @type {string} */ m) => (m === "electron" ? electron : null) });
  void bridge.filamentApp.pickFolder("ignored");
  assert.deepEqual(invoked, [["filament:pick-folder"]], "nothing of the page's rides along");
  const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
  assert.match(
    main,
    /ipcMain\.handle\("filament:pick-folder", async \(e\) => \{\n\s+const w = paneOf\(e\);\n\s+if \(!w\) return null;\n[\s\S]*?await dialog\.showOpenDialog\(w, \{ title: "Pick a project folder", properties: \["openDirectory", "createDirectory"\] \}\);\n\s+return r\.canceled \|\| !r\.filePaths\?\.\[0\] \? \{ ok: false, cancelled: true \} : \{ ok: true, path: r\.filePaths\[0\] \};/,
  );
});
