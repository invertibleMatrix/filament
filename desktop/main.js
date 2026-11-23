// @ts-check
// The Filament desktop app, stage one (HarnessV3-Native): Filament's server as a child process of the app, the harness and
// the dashboard in windows of its own, a tray with its card, notifications — Filament's alerts, and the harness's chats
// that need you or ended (NA3b) —, start at logon. The only file that speaks
// to Electron; what it decides lives in lib/, in plain Node, and is tested there (NA-D13).
//
//   npm run desktop -- [--data-dir <folder>] [--port <n>] [--hidden]
//   a second launch opens the harness in the first; with --card it shows the first's card; with --quit it quits the
//   first (and, with none running, does nothing)
//
// Its first lines put Electron's own files (cookies, caches, crash dumps) under `<dataDir>\desktop`: left alone,
// Electron would write them into `%APPDATA%\Filament`, which is Filament's data folder (NA-D6).
import { app, autoUpdater, BrowserWindow, Menu, Notification, Tray, WebContentsView, clipboard, dialog, ipcMain, nativeImage, nativeTheme, net, screen, session, shell, utilityProcess, webContents } from "electron";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isCheckout, resolveDataDir } from "../src/config.js";
import { attachWatch, followPort, foundAt, hostOf, portOf, refusedWords } from "./lib/start.js";
import { createSupervisor } from "./lib/supervisor.js";
import { askedByPerson, isPress, mayGrant, routeOf, serverArgs, serverEnv } from "./lib/policy.js";
import { keepPlace, placeOf, readPlaces } from "./lib/window-state.js";
import { swatchBitmap, trayRows, trayTip } from "./lib/tray.js";
import { createLog, serverTail } from "./lib/log.js";
import { watchRenderer, RELOAD_AFTER_MS, stoppedWords } from "./lib/renderer-watch.js";
import { SAMPLE_EVERY_MS, createMemorySampler } from "./lib/metrics.js";
import { CARD_SIZE, cardHears, cardPlace, downPage, downWords, harnessRoute, trayClick } from "./lib/card.js";
import { alertNote, backNote, balloonOf, noteLine, restartingNote, tickNote, updateNote, updateOutNote } from "./lib/notes.js";
import { createUpdater, installArgs, kindOf, releasesRepoOf, repoOf, STORE_PAGES } from "./lib/updates.js";
import { installDeb, readySquirrel, relaunchOf, replaceAppImage } from "./lib/install-update.js";
import { WATCH_MS, chatRoute, createFleet, createWatch } from "./lib/watch.js";
import { keepSettings, readSettings } from "./lib/settings.js";
import { appIdOf, logonItem, oldAppIdOf, oldLogonEntry } from "./lib/logon.js";
import { iconsOf } from "./lib/icons.js";
import { LINK_PATH, consolePage, createLink, createPages, inboundKeyOf, paneHears, placeRect } from "./lib/browser-host.js";
import { filamentsOwn } from "../src/core/browser.js";
import { POP_SIZE, popPlaceName, popTab, popUrl } from "./lib/pop-out.js";
import { frameOf, overlayColors } from "./lib/frame.js";
import { appVersion, buildWords, readBuild } from "./lib/build-info.js";
import { underWay, waitPage, waitWords } from "./lib/waiting.js";
import { LOCAL_ID, LOCAL_NAME, MACHINES_FILE, addMachine, colorOf, iconOf, pickRoute, readHere, readKept, readMachines, removeMachine, renameMachine, setMachineBrowser, setMachineLook, setMachineOff } from "./lib/machines.js";
import { createMachineBrowsers, machineGuards, partitionFor, placeOnMachine } from "./lib/machine-browser.js";
import { createRail, showAsk, zoomRows } from "./lib/rail.js";
import { createUpdateThere } from "./lib/update-there.js";
import { DESK_KEYS } from "../src/ui/harness/lib/chat-only.js";
import { checkMachine } from "./lib/add-machine.js";
import { createTunnels } from "./lib/ssh-route.js";
import { createMachineAgents } from "./lib/machine-agents.js";
import { createDesk } from "./lib/desk.js";
import { createMachines } from "../src/services/machines/index.js";
import { usePinBook } from "../src/services/machines/key-pins.js";
import { OWNER_COOKIE, OWNER_HEADER, ownerHeaders } from "../src/services/owner.js";
import { mergedPath, readShellPath } from "./lib/shell-path.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = fileURLToPath(import.meta.url);
/** The tray's icon and the windows', this system's (lib/icons.js). */
const ICONS = iconsOf(ROOT);
/** @param {string} name */
const opt = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

// An absolute folder: Electron takes no other, and the server, started in the checkout, reads it the same.
const dataDir = resolve(resolveDataDir(opt("--data-dir")));
// The keys behind the certificates its machines' network routes pin, learned at each pinned connection (key-pins.js).
usePinBook(dataDir);
const own = join(dataDir, "desktop");
app.setName("Filament");
app.setPath("userData", own);
// A checkout's app is another app to Windows: its own taskbar button, and its own Start-at-logon entry (the entry is
// named by this id), never the installed app's. The installed app's is electron-builder.yml's appId.
if (process.platform === "win32") app.setAppUserModelId(appIdOf(isCheckout()));

/** The windows, by what they show. */
const PAGES = { harness: "/ui/harness.html", dashboard: "/" };
const SIZES = { harness: { width: 1440, height: 920 }, dashboard: { width: 1280, height: 860 } };
const placesFile = join(own, "windows.json");
const settingsFile = join(own, "settings.json");
/** The machines the harness window drives beside this computer (lib/machines.js). */
const machinesFile = join(own, MACHINES_FILE);
const log = createLog(join(own, "server.log"));
/** Filament's memory as it goes (lib/metrics.js): a file of its own, which the server's output never rotates away. */
const memLog = createLog(join(own, "memory.log"));
/**
 * The SSH tunnels this computer holds to the machines kept that are reached by SSH (lib/ssh-route.js): brought up as a
 * machine's way is picked — the window's, the tray's watch, the Add sheet's check —, ended as no machine kept goes through
 * them, and as the app quits.
 */
const tunnels = createTunnels({ log: (line) => log.line(line), kept: () => readKept(machinesFile).flatMap((m) => m.routes) });
/**
 * A machine's way picked, its SSH tunnel brought up first; one taken is marked so, and one that came up and lost to a
 * better way ends (lib/ssh-route.js `only`). @param {import("./lib/machines.js").Machine} m
 */
const pickHeld = (m) =>
  pickRoute(m, { hold: (route) => tunnels.hold(route) }).then((r) => {
    if (r.route?.kind === "ssh") tunnels.chosen(r.route);
    return r;
  });
/** How often the app looks at Filament for alerts — and, attached to one started elsewhere, whether it still answers. */
const LOOK_MS = 5000;
/**
 * How soon a machine is looked at again once its events stream says something moved there (lib/desk.js): at most once
 * each that long, however busy it is.
 */
const SOON_MS = 2000;

/** What later launches asked before this one was ready — a double-click while it starts, a `--quit` —, done once it is. @type {string[][]} */
const early = [];
/** @type {(argv: string[]) => void} */
let launched = (argv) => void early.push(argv);

if (!app.requestSingleInstanceLock()) {
  // The first one is told (`second-instance`): it opens the harness, or quits on --quit.
  app.quit();
} else if (process.argv.includes("--quit")) {
  // No app runs (it would hold the lock): nothing to quit, and nothing is started.
  app.exit(0);
} else {
  app.on("second-instance", (_e, argv) => launched(argv));
  void run();
}

async function run() {
  // The login shell's PATH, read while Electron gets ready, in place before the server starts: what it runs then finds
  // npm, git and the agents' commands as a terminal does (lib/shell-path.js).
  const shellPathRead = readShellPath();
  const given = opt("--port");
  /** Where Filament listens: `--port`, else its config's port, on its config's host — read again before each start, so
   * a port changed in Settings is followed. @type {number} */
  let port;
  try {
    port = portOf(dataDir, given);
  } catch (/** @type {any} */ e) {
    dialog.showErrorBox("Filament cannot start", String(e?.message || e));
    return app.exit(2);
  }
  let host = hostOf(dataDir);
  let origin = `http://${host}:${port}`;
  await app.whenReady();
  // Which build this is, in the log a report is read from: one rebuild of a version told from another (lib/build-info.js).
  const built = app.isPackaged ? readBuild() : null;
  log.line(`Filament ${app.getVersion()}${built ? `, ${buildWords(built)}` : app.isPackaged ? "" : ", from the checkout"}`);
  const shellPath = await shellPathRead;
  if (shellPath.path) {
    const before = String(process.env.PATH || "").split(":").filter(Boolean).length;
    process.env.PATH = mergedPath(shellPath.path, process.env.PATH);
    log.line(`PATH from ${shellPath.shell}: ${process.env.PATH.split(":").length - before} folders added`);
  } else if (shellPath.shell) log.line(`no PATH from ${shellPath.shell} (${shellPath.why}): the app's own kept`);

  const found = await foundAt(port, { host, dataDir });
  if (found.kind === "refuse") {
    const w = refusedWords(port, found.why, dataDir, { given: given != null });
    log.line(`refused: ${found.why}`);
    await dialog.showMessageBox({ type: "error", title: w.title, message: w.message, detail: w.detail, buttons: ["Close"] });
    return app.exit(1);
  }
  /** The app started this Filament, and stops it on Quit; else it attached to one already running (NA-D7), or to one
   * that took the port after its own ended. */
  let owned = found.kind === "start";
  log.line(found.kind === "attach" ? `attached to Filament ${found.version} on port ${port} (its data folder: ${found.dataDir})` : `starting Filament on port ${port}, data folder ${dataDir}`);
  let quitting = false;
  let settings = readSettings(settingsFile);

  // ---- what its pages may do: Filament's own origin, and an artifact's frame in it its copy and full screen -----------
  /**
   * A session's permissions, by the origin that is its pages' own: this computer's Filament's, or, in a machine's
   * partition (lib/rail.js), that machine's — none while the app's own page stands there.
   * @param {Electron.Session} ses @param {() => string | null} originOf
   */
  const grants = (ses, originOf) => {
    ses.setPermissionRequestHandler((wc, permission, grant, details) => {
      const at = originOf();
      grant(!!at && mayGrant({ permission, requesting: details?.requestingUrl, embedding: details?.isMainFrame ? undefined : wc?.getURL() }, at));
    });
    ses.setPermissionCheckHandler((_wc, permission, requesting, details) => {
      const at = originOf();
      return !!at && mayGrant({ permission, requesting, embedding: details?.isMainFrame ? undefined : details?.embeddingOrigin }, at);
    });
  };
  grants(session.defaultSession, () => origin);
  // A menu no one sees, for its keys alone: reload, the developer tools, zoom, full screen. Every other key is the page's
  // (the harness takes Ctrl+W, Ctrl+N, Ctrl+K and more). Reload and the developer tools are the focused page's: with
  // another machine shown in the window, its page — the window's own one, this computer's, stands hidden behind it. A
  // Mac shows it, in the menu bar: its first menu is the app's, named Filament, with About, Hide and Quit (⌘Q) — a Quit
  // as the tray's, which asks before it stops a Filament at work (the owner's of 11-08: the Filament menu had Edit's rows).
  const focusedPage = () => webContents.getFocusedWebContents() ?? BrowserWindow.getFocusedWindow()?.webContents ?? null;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: /** @type {const} */ ("appMenu") }] : []),
      { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
      {
        label: "View",
        submenu: [
          { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => focusedPage()?.reload() },
          { label: "Force Reload", accelerator: "Shift+CmdOrCtrl+R", click: () => focusedPage()?.reloadIgnoringCache() },
          { label: "Toggle Developer Tools", accelerator: process.platform === "darwin" ? "Alt+Command+I" : "Ctrl+Shift+I", click: () => focusedPage()?.toggleDevTools() },
          { type: "separator" },
          // The roles' own, and the machines told: the room lent to another machine's page sized for the zoom it has now.
          ...zoomRows({ page: focusedPage, zoomed: () => rail?.zoomed() }),
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
    ]),
  );

  /**
   * What a page may open, keep and ask. `originOf`: the origin that is its own — this computer's Filament, or, in the
   * window's view of another machine (lib/rail.js), that machine's, null while the app's own page stands there; `prefs`:
   * what a window it opens on its own origin is made with — another machine's, its partition and no bridge; `onChild`:
   * each window it opens, for the window to close with its machine.
   * @param {Electron.WebContents} contents @param {{ originOf?: () => string | null, prefs?: Electron.WebPreferences, onChild?: (child: BrowserWindow) => void }} [o]
   */
  const guard = (contents, { originOf = () => origin, prefs = SAFE, onChild } = {}) => {
    /** A window another machine's page opened is that machine's: never moved to this computer's Filament (`reload`). */
    const remote = prefs !== SAFE;
    /**
     * Where an address goes from this page. No origin its own (the app's page in a machine's view): nothing stays —
     * a data: or about: address's origin is "null" too (the review of p3-shell). @param {string} url
     */
    const routeHere = (url) => {
      const at = originOf();
      const route = routeOf(url, at ?? "null");
      return route === "stay" && !at ? "refuse" : route;
    };
    let lastPress = -Infinity;
    /** A question about an address outside is up in this window: asks meanwhile are dropped, never stacked. */
    let asking = false;
    // A click or a tap (input-event), Enter or Space (before-input-event, which names the key): typing is no press.
    contents.on("input-event", (_e, input) => void (isPress(input) && (lastPress = Date.now())));
    contents.on("before-input-event", (_e, input) => void (isPress(input) && (lastPress = Date.now())));
    /**
     * An address outside (a site, an editor's link) goes to the system — at once just after the person's own press, which
     * it uses up (one press, one address), else asked first: a page (an artifact a model wrote, say) could otherwise open
     * it unbidden. `always`: asked whatever was pressed.
     * @param {string} url @param {"browser" | "editor"} route @param {{ always?: boolean }} [o]
     */
    const outside = async (url, route, { always = false } = {}) => {
      const what = route === "editor" ? "an editor's link" : "an address in the browser";
      if (!always && askedByPerson(lastPress, Date.now())) {
        lastPress = -Infinity;
        return void shell.openExternal(url);
      }
      if (asking) return void log.line(`a page asked to open ${what} while a question was up: dropped`);
      asking = true;
      log.line(`a page asked to open ${what} with no press of the person's: asked first`);
      try {
        const { response } = await dialog.showMessageBox({
          type: "question",
          title: "Filament",
          message: route === "editor" ? "Open this in your editor?" : "Open this address in your browser?",
          detail: `A page in Filament asks to open ${url.length > 300 ? `${url.slice(0, 299)}…` : url}`,
          buttons: ["Open", "Cancel"],
          defaultId: 1,
          cancelId: 1,
        });
        if (response === 0) void shell.openExternal(url);
      } finally {
        asking = false;
      }
    };
    /** @param {Electron.Event} e @param {string} url */
    const away = (e, url) => {
      const route = routeHere(url);
      if (route === "stay") return;
      e.preventDefault();
      if (route !== "refuse") void outside(url, route);
    };
    contents.on("will-navigate", away);
    contents.on("will-redirect", away);
    contents.setWindowOpenHandler(({ url }) => {
      const route = routeHere(url);
      // This computer's console, opened from its page (the harness's Open Filament console), has the press key's bridge.
      const own = !remote && consolePage(url, origin) ? { ...prefs, preload: join(ROOT, "desktop", "dashboard-preload.cjs") } : prefs;
      if (route === "stay") return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: own } };
      // Open in editor navigates its own window; an editor's link in a window of its own is a page's (an artifact's).
      if (route !== "refuse") void outside(url, route, { always: route === "editor" });
      return { action: "deny" };
    });
    contents.on("did-create-window", (child) => {
      child.setMenuBarVisibility(false);
      if (!remote) track(child);
      onChild?.(child);
      // Another machine's window keeps the origin it opened at: its view moving to another route moves none of it.
      const at = originOf();
      guard(child.webContents, { originOf: remote ? () => at : originOf, prefs, onChild });
    });
    // A page's "leave this page?" (beforeunload) would hold its window — and Quit — without a word: asked as a browser
    // asks; on Quit the person chose already.
    contents.on("will-prevent-unload", (e) => {
      if (quitting) return e.preventDefault();
      const opts = { type: /** @type {const} */ ("question"), title: "Filament", message: "Leave this page?", detail: "A page in this window asks to stay open: what it holds may not be kept.", buttons: ["Leave", "Stay"], defaultId: 0, cancelId: 1 };
      const w = BrowserWindow.fromWebContents(contents);
      if ((w ? dialog.showMessageBoxSync(w, opts) : dialog.showMessageBoxSync(opts)) === 0) e.preventDefault();
    });
    // Electron has no right-click menu of its own: cut, copy and paste where they apply, as a browser's.
    contents.on("context-menu", (_e, p) => rightClick(p, routeHere(p.linkURL) !== "refuse"));
  };
  /**
   * The right-click menu, as a browser's: cut, copy and paste where they apply, and a link's address to copy.
   * @param {Electron.ContextMenuParams} p @param {boolean} linkCopies
   */
  const rightClick = (p, linkCopies) => {
    /** @type {Electron.MenuItemConstructorOptions[]} */
    const rows = p.isEditable
      ? [{ role: "cut", enabled: p.editFlags.canCut }, { role: "copy", enabled: p.editFlags.canCopy }, { role: "paste", enabled: p.editFlags.canPaste }, { type: "separator" }, { role: "selectAll" }]
      : p.selectionText
        ? [{ role: "copy" }]
        : [];
    if (p.linkURL && linkCopies) {
      if (rows.length) rows.push({ type: "separator" });
      rows.push({ label: "Copy link", click: () => clipboard.writeText(p.linkURL) });
    }
    if (rows.length) Menu.buildFromTemplate(rows).popup();
  };
  /** @type {Electron.WebPreferences} */
  const SAFE = { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true };

  // ---- the agent's browser (HarnessV4_Browser_Plan BR3): its pages here, Filament's driver over the link -------------
  // The pages are the app's (BR-D1), parked in a window no one sees; Filament reaches them over its socket with its own
  // key, whether the app started it or attached to it (BR-D2). The link goes with Filament, and its pages with the link:
  // Filament forgets them as it goes, and opens a chat's page again at its next call.
  const pages = createPages({
    electron: { WebContentsView, BrowserWindow, session, nativeImage },
    send: (m) => link.send(m),
    log: (line) => log.line(line),
    menu: (_wc, p) => rightClick(p, /^https?:/i.test(String(p.linkURL || ""))),
    // The developer's hand on a page (HarnessV4_BrowserSize_Plan BS3): the pointer's place, and the Browser pane told.
    pointer: () => screen.getCursorScreenPoint(),
    tellPane: (win, m) => {
      if (!win.isDestroyed()) win.webContents.send("filament:browser-hand", m);
    },
    veilPreload: join(ROOT, "desktop", "veil-preload.cjs"),
    // Filament's own address, where it is now (it follows a move), is never reached from the agent's browser.
    own: (url) => filamentsOwn(url, port, [host]),
    // Its page placed in the harness window: the machines' Ctrl+1..9 from there too.
    keys: (w, e, input) => void (rail && w === windows.get("harness") && rail.keys(e, input)),
  });
  const link = createLink({
    url: () => `ws://${host}:${port}${LINK_PATH}`,
    key: () => inboundKeyOf(dataDir),
    owner: () => ownerHeaders(dataDir, `http://${host}:${port}`),
    onMessage: (m) => {
      if (typeof m.n !== "number") return;
      pages.handle(m).then(
        (result) => link.send({ n: m.n, ok: true, result: result ?? null }),
        (/** @type {any} */ e) => link.send({ n: m.n, ok: false, error: String(e?.message || e) }),
      );
    },
    onDown: () => pages.closeAll(),
    log: (line) => log.line(line),
  });
  /** The harness's windows: its own, and the panes popped out of it (HarnessV4_BrowserSize_Plan BS4). */
  const harnessWindows = () => /** @type {BrowserWindow[]} */ ([windows.get("harness"), ...popped.values()].filter((w) => !!w && !w.isDestroyed()));
  /**
   * The harness window a word to the pane's bridge came from — its own or a popped pane's —, when it is heard
   * (`paneHears`). @param {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} e
   */
  const paneOf = (e) => harnessWindows().find((w) => paneHears(e.sender === w.webContents, e.senderFrame?.url, origin)) || null;
  /** Whether a word came from Filament's own console in a window of the app (`consolePage`), whose bridge asks the press key alone. @param {Electron.IpcMainInvokeEvent} e */
  const consoleOf = (e) => !!BrowserWindow.fromWebContents(e.sender) && consolePage(e.senderFrame?.url, origin);
  /**
   * Another machine's Browser pane a word to the bridge came from (machine-preload.cjs), where this app holds that
   * machine's chats' browser (b-remote): its pages here, the harness window its view is in, and where the view lies.
   * @param {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} e
   */
  const machinePaneOf = (e) => {
    const at = rail?.machinePane(e.sender, e.senderFrame);
    const there = at ? machineBrowsers.pagesOf(at.id) : null;
    const w = windows.get("harness");
    return at && there && w && !w.isDestroyed() ? { ...at, pages: there, w } : null;
  };
  /**
   * Another machine's Browser pane puts a chat's page this app holds for that machine over itself, as This computer's
   * does (lib/machine-browser.js `placeOnMachine`). @param {Electron.IpcMainInvokeEvent} e @param {any} p
   */
  const placeForMachine = (e, p) => {
    const placed = placeOnMachine({ pane: rail?.machinePane(e.sender, e.senderFrame) ?? null, active: rail?.showing() ?? null, pagesOf: (id) => machineBrowsers.pagesOf(id), win: windows.get("harness"), zoom: e.sender.getZoomFactor(), ask: p });
    // Its view and its page on top, in that order, and the app's popover or Add sheet over both.
    if (placed) rail?.raise();
    return placed;
  };
  // The Browser pane puts the chat's page over itself (BR-D11), at the rectangle it measured — in CSS pixels, so the
  // page's zoom scales it — locked under the veil while an agent drives it (BS3), and parks it as it hides.
  ipcMain.handle("filament:browser-place", (e, p) => {
    const w = paneOf(e);
    if (!w) return placeForMachine(e, p);
    const [width, height] = w.getContentSize();
    const rect = placeRect(p?.rect, w.webContents.getZoomFactor(), { width, height });
    if (rect && typeof p?.tab === "string" && pages.place(p.tab, w, rect, { lock: p?.lock === true })) {
      // Another machine's view showing, and the app's popover or Add sheet, stay over this computer's page and what it placed.
      if (rail && w === windows.get("harness")) rail.raise();
      return true;
    }
    pages.parkAll(w);
    return false;
  });
  ipcMain.on("filament:browser-park", (e) => {
    const w = paneOf(e);
    if (w) return pages.parkAll(w);
    const r = machinePaneOf(e);
    if (r) r.pages.parkAll(r.w);
  });
  // The veil's Take over: heard from a veil of the app's own alone (`veilPressed` knows its pages), this computer's or
  // another machine's.
  ipcMain.on("filament:veil-take", (e) => void (pages.veilPressed(e.sender) || machineBrowsers.all().some((x) => x.veilPressed(e.sender))));
  ipcMain.on("filament:browser-hand-off", (e) => {
    const w = paneOf(e);
    if (w) return pages.handOff(w);
    const r = machinePaneOf(e);
    if (r) r.pages.handOff(r.w);
  });

  /**
   * This computer as it wears itself: its colour and icon chosen, else the colour its own Filament's id picks
   * (<dataDir>/machine.json) — the one every other window that keeps it gives it — and a desktop's icon.
   * @returns {{ color: string, icon: string }}
   */
  const hereLook = () => {
    const h = readHere(machinesFile);
    let id = "";
    try {
      id = String(JSON.parse(readFileSync(join(dataDir, "machine.json"), "utf8"))?.id || "").toLowerCase();
    } catch {}
    return { color: h.color || colorOf({ id: id || LOCAL_ID }), icon: iconOf(h) };
  };
  /** A colour's dot for a menu's row (lib/tray.js `swatchBitmap`), made once each. @type {Map<string, Electron.NativeImage>} */
  const swatches = new Map();
  /** @param {string} hex */
  const swatchOf = (hex) => {
    let img = swatches.get(hex);
    if (!img) {
      const s = swatchBitmap(hex);
      img = nativeImage.createFromBitmap(s.buffer, { width: s.width, height: s.height, scaleFactor: s.scaleFactor });
      swatches.set(hex, img);
    }
    return img;
  };
  /**
   * A menu's rows as Electron takes them: each `swatch` drawn as its dot, its submenus' too (a machine's Colour).
   * @param {readonly any[]} rows @returns {any[]}
   */
  const dressRows = (rows) =>
    rows.map((r) => {
      if (!r || r.type === "separator") return r;
      const { swatch, submenu, ...rest } = r;
      return { ...rest, ...(swatch ? { icon: swatchOf(swatch) } : {}), ...(submenu ? { submenu: dressRows(submenu) } : {}) };
    });

  /** @type {Map<"harness" | "dashboard", BrowserWindow>} */
  const windows = new Map();
  /** The harness window's machines (lib/rail.js): its chips' popover, its Add sheet, the other machines' views. @type {ReturnType<typeof createRail> | null} */
  let rail = null;
  /** The harness window's title bar colours, as its page last said them: the app's page wears them. @type {{ color: string, symbolColor: string } | null} */
  let chrome = null;
  /**
   * This computer among the machines: connected while its Filament answers, reconnecting while it is on its way (a start,
   * a restart), else offline. @returns {import("./lib/machines.js").Watched}
   */
  const localWatched = () => {
    const state = owned ? sup.now().state : null;
    const up = owned ? state === "up" || state === "late" : !gone;
    return { status: up ? "online" : state && underWay(state) ? "reconnecting" : "offline", silentSince: null, why: up ? null : owned ? `Filament is ${state}` : "the Filament the app attached to does not answer" };
  };
  nativeTheme.on("updated", () => rail?.paint());
  // The app's page (the popover, the Add sheet): a machine picked, the popover closed, and its first ask for the state —
  // heard from that page alone.
  ipcMain.on("filament:rail-select", (e, id) => void (rail?.hears(e.sender, e.senderFrame?.url) && rail.pick(String(id))));
  ipcMain.on("filament:rail-close", (e) => void (rail?.hears(e.sender, e.senderFrame?.url) && rail.closePop()));
  ipcMain.on("filament:rail-ready", (e) => void (rail?.hears(e.sender, e.senderFrame?.url) && rail.paint()));
  // A harness page's machine chip (harness-preload.cjs, machine-preload.cjs): its press, its first ask for its state,
  // the colours another machine's page asks the controls to wear — heard from This computer's page and the machines'
  // views alone, each as the machine it is (lib/rail.js `hearsPage`); the room the controls take, from This computer's.
  ipcMain.on("filament:machines-open", (e, rect) => {
    const id = rail?.hearsPage(e.sender, e.senderFrame);
    if (id) rail?.openPop(id, rect);
  });
  ipcMain.on("filament:machines-ready", (e) => {
    const id = rail?.hearsPage(e.sender, e.senderFrame);
    if (id) rail?.told(id);
  });
  ipcMain.on("filament:machines-title-bar", (e, c) => {
    const id = rail?.hearsPage(e.sender, e.senderFrame);
    if (id) rail?.tintFrom(id, c);
  });
  ipcMain.on("filament:frame-area", (e, r) => void (rail?.hearsPage(e.sender, e.senderFrame) === LOCAL_ID && rail.frameArea(r)));
  // A machine's page loading at the better way it moved to (machine-preload.cjs): what it kept for this tab where it
  // was, from that view's main frame alone (lib/rail.js `carryFor`). Always answered: its page waits on it.
  ipcMain.on("filament:machines-carry", (e) => {
    let pairs = null;
    try {
      pairs = rail?.carryFor(e.sender, e.senderFrame) ?? null;
    } catch {}
    e.returnValue = pairs;
  });
  /** How many of a machine's chats wait on you, as the watch last saw them: its row in the popover, the chips' counts. @param {string} id */
  const waitingOn = (id) => Number(machineRows.find((m) => m.id === id)?.needs) || 0;
  /**
   * Whether a turn is at work on a machine, as the watch last saw it — or not known yet: its page is not moved to a
   * better way meanwhile (lib/rail.js `busy`). @param {string} id
   */
  const busyOn = (id) => {
    const n = workingOn.get(id);
    return n === undefined || n > 0;
  };
  /** Another machine's pages in the app — the window's views of it, by their partition: one of its harness's marks its own unread. @type {Map<Electron.WebContents, string>} */
  const remotePages = new Map();
  /** Whether a page of that partition's machine's harness is open here. @param {string} partition */
  const holdsHarness = (partition) =>
    [...remotePages].some(([c, p]) => {
      if (p !== partition || c.isDestroyed()) return false;
      try {
        return new URL(c.getURL()).pathname === PAGES.harness;
      } catch {
        return false;
      }
    });
  // A machine's menu (Remove), and the Add sheet: opened, closed, and each step's ask — from the app's page alone.
  ipcMain.on("filament:rail-menu", (e, id) => void (rail?.hears(e.sender, e.senderFrame?.url) && rail.machineMenu(String(id))));
  ipcMain.on("filament:rail-add-open", (e) => void (rail?.hears(e.sender, e.senderFrame?.url) && rail.openAdd()));
  ipcMain.on("filament:rail-add-close", (e) => void (rail?.hears(e.sender, e.senderFrame?.url) && rail.closeAdd()));
  ipcMain.on("filament:rail-update-all", (e) => void (rail?.hears(e.sender, e.senderFrame?.url) && rail.updateAll()));
  ipcMain.handle("filament:rail-add", (e, input) => (rail?.hears(e.sender, e.senderFrame?.url) ? rail.add(input) : { ok: false, words: "Not the rail's page." }));
  ipcMain.handle("filament:rail-tailnet", (e) => (rail?.hears(e.sender, e.senderFrame?.url) ? rail.tailnet() : { found: [], words: "Not the rail's page." }));
  /** The panes in windows of their own (BS4), by the tab each shows. @type {Map<string, BrowserWindow>} */
  const popped = new Map();
  /** Every window the app has: its own two, and those a page of Filament's opened. @type {Set<BrowserWindow>} */
  const every = new Set();
  /** Windows whose page did not load (Filament not up yet, or gone a moment): loaded again at its next answer. @type {Set<BrowserWindow>} */
  const unloaded = new Set();
  /**
   * Windows opened while the app's own Filament gave no page yet (its start, a restart): the app's page in each
   * (lib/waiting.js), and what comes into it at Filament's answer — its page, at the route it was asked to open.
   * @type {Map<BrowserWindow, { name: "harness" | "dashboard", route: string }>}
   */
  const waiting = new Map();
  /** Each window's page watched (lib/renderer-watch.js): a process it loses is said in the log. @type {Map<BrowserWindow, { pid: () => number }>} */
  const watched = new Map();
  /** A window as the log names it: the app's own by name, a pane by its tab, any other as a page's. @param {BrowserWindow} w */
  const windowName = (w) => {
    const own = [...windows].find(([, x]) => x === w)?.[0];
    if (own) return `the ${own} window`;
    const tab = [...popped].find(([, x]) => x === w)?.[0];
    return tab ? `the popped-out ${popPlaceName(tab)} pane` : "a window a page opened";
  };
  /**
   * The app's processes' memory, read each minute and written to memory.log every ten (lib/metrics.js), the windows
   * named and the server's own census, which it posts over its port.
   */
  const sampler = createMemorySampler({
    metrics: () => app.getAppMetrics(),
    windows: () => [...watched].filter(([w]) => !w.isDestroyed()).map(([w, x]) => ({ name: windowName(w), pid: x.pid() })),
    write: (line) => memLog.write(`${line}\n`),
  });
  const sampling = setInterval(() => {
    try {
      sampler.sample();
    } catch {}
  }, SAMPLE_EVERY_MS);
  sampling.unref?.();
  /** A window's load after its page's process went: one a window, its newest plan's. @type {WeakMap<BrowserWindow, ReturnType<typeof setTimeout>>} */
  const recovering = new WeakMap();
  /**
   * A window whose page's process went, loaded again a moment after as its plan says (lib/renderer-watch.js
   * `crashPlan`): at the same place, without the chat that took it down, or — kept going down — the app's own page
   * saying so; that page going down too, left as it is. Its Browser pane's pages, and other machines' drawn over it,
   * go back to their parking as its close sends them: the page that placed them is gone, and the next places its own.
   * A window loaded meanwhile by something else (Filament's answer, a reload, a chat opened) is left as it is.
   * @param {BrowserWindow} w @param {import("./lib/renderer-watch.js").CrashPlan} plan
   */
  const recoverPage = (w, plan) => {
    pages.forgetWindow(w);
    for (const x of machineBrowsers.all()) x.forgetWindow(w);
    clearTimeout(recovering.get(w));
    recovering.delete(w);
    if (plan.do === "leave") return;
    const later = setTimeout(() => {
      recovering.delete(w);
      if (w.isDestroyed() || quitting || !w.webContents.isCrashed()) return;
      if (plan.do === "stop") {
        const dark = nativeTheme.shouldUseDarkColors;
        const bar = w === windows.get("harness") ? frameOf({ dark }).titleBarOverlay || null : null;
        void w.loadURL(waitPage(stoppedWords([...popped.values()].includes(w)), { dark, busy: false, bar, version: appVersion(ROOT) })).catch(() => {});
      } else if (plan.url) void w.loadURL(plan.url).catch(() => {});
      else w.webContents.reload();
    }, RELOAD_AFTER_MS);
    later.unref?.();
    recovering.set(w, later);
  };
  /** @param {BrowserWindow} w */
  const track = (w) => {
    every.add(w);
    // An error page "finishes loading" too (did-finish-load follows did-fail-load); only a navigation that commits is a
    // page of Filament's. -3 is one the guard (or a newer one) cancelled: the page stands.
    w.webContents.on("did-fail-load", (_e, code, _d, _u, isMainFrame) => void (isMainFrame && code !== -3 && unloaded.add(w)));
    w.webContents.on("did-navigate", () => void unloaded.delete(w));
    watched.set(w, watchRenderer(w.webContents, { name: () => windowName(w), log: (line) => log.line(line), quitting: () => quitting, lastOf: (pid) => sampler.lastOf(pid), recover: (plan) => recoverPage(w, plan) }));
    w.on("closed", () => {
      every.delete(w);
      unloaded.delete(w);
      waiting.delete(w);
      watched.delete(w);
    });
  };
  /** A waiting window's page, as Filament is now: what holds it, and a spinner while it is on its way. @param {BrowserWindow} w */
  const paintWait = (w) => {
    const at = waiting.get(w);
    if (!at || w.isDestroyed()) return;
    const state = sup.now().state;
    const dark = nativeTheme.shouldUseDarkColors;
    const bar = at.name === "harness" ? frameOf({ dark }).titleBarOverlay || null : null;
    void w.loadURL(waitPage(waitWords(state, port), { dark, busy: underWay(state), bar, version: appVersion(ROOT) })).catch(() => {});
  };
  /** @param {"harness" | "dashboard"} name */
  const pageOf = (name) => `${origin}${PAGES[name]}`;
  /**
   * The app's harness or dashboard, shown; `route`, a chat's place in the harness (a row of the card's Now, a
   * notification's chat): the open window goes there without loading again, a new one opens there. `launch`: a person's
   * launch of the app while it runs asks (a double-click on its launcher): on Windows a new window shows at once, its own
   * colour behind the page on its way, where any other waits for its first paint. A guess at why such a launch showed no
   * window in front (the owner's of 11-17): Windows lets the launch bring a window forward only for a moment, which its
   * first paint can outlast. A window kept maximized is shown by `maximize()` as it is made, so it never waited; the log
   * lines `launched` writes are to tell.
   * @param {"harness" | "dashboard"} name @param {string} [route] @param {{ launch?: boolean }} [o]
   */
  const openWindow = (name, route = "", { launch = false } = {}) => {
    const had = windows.get(name);
    if (had && !had.isDestroyed()) {
      if (had.isMinimized()) had.restore();
      had.show();
      had.focus();
      const waited = waiting.get(had);
      // A chat of this computer's (a notification's, the card's Now): its page shown, not another machine's over it.
      if (route && name === "harness") rail?.select("local");
      // Still waiting for Filament: its page opens there at Filament's answer.
      if (route && waited) waited.route = route;
      else if (!waited) {
        let onPage = false;
        try {
          onPage = new URL(had.webContents.getURL()).pathname === PAGES[name];
        } catch {}
        if (onPage && route) void had.webContents.executeJavaScript(`location.hash = ${JSON.stringify(route)}; true`).catch(() => {});
        // Off its page — the app's own, its page having kept going down (lib/renderer-watch.js), or a load that failed —
        // it loads it again in place, keeping the tab's storage and what its chats had queued: a new window has none. One
        // whose first load is under way has no address yet, and is left to it (Fable 5.2's review of 11-17: a second
        // launch as the app started loaded its page twice).
        else if (!onPage && !had.webContents.isLoadingMainFrame()) void had.loadURL(`${pageOf(name)}${route}`).catch(() => {});
      }
      return had;
    }
    const main = screen.getPrimaryDisplay();
    const screens = [main, ...screen.getAllDisplays().filter((d) => d.id !== main.id)].map((d) => d.workArea);
    const place = placeOf(readPlaces(placesFile)[name], screens, SIZES[name]);
    const w = new BrowserWindow({
      x: place.x,
      y: place.y,
      width: place.width,
      height: place.height,
      show: false,
      title: "Filament",
      ...(ICONS.window ? { icon: ICONS.window } : {}),
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff",
      // The harness's own title bar (lib/frame.js): its top row is the window's, the system's controls drawn over it.
      ...(name === "harness" ? frameOf({ dark: nativeTheme.shouldUseDarkColors }) : {}),
      // The harness's Browser pane has its bridge (harness-preload.cjs); the dashboard the press key's alone (dashboard-preload.cjs).
      webPreferences: { ...SAFE, preload: join(ROOT, "desktop", name === "harness" ? "harness-preload.cjs" : "dashboard-preload.cjs") },
    });
    w.setMenuBarVisibility(false);
    if (place.maximized) w.maximize();
    track(w);
    guard(w.webContents);
    if (launch && process.platform === "win32") w.show();
    else w.once("ready-to-show", () => w.show());
    w.on("close", () => {
      keepPlace(placesFile, name, { ...w.getNormalBounds(), maximized: w.isMaximized() });
      // The pages its Browser pane showed go back to their parking: they are the chats', not the window's; its veil goes.
      // Other machines' pages this app holds too, drawn over their views' panes.
      pages.forgetWindow(w);
      for (const x of machineBrowsers.all()) x.forgetWindow(w);
    });
    w.on("closed", () => windows.delete(name));
    windows.set(name, w);
    // The harness window drives the machines kept beside this computer: a chip in each page's top bar once there is one,
    // its popover the app's (lib/rail.js).
    if (name === "harness") {
      const r = createRail({
        win: w,
        View: WebContentsView,
        sessionOf: (partition) => session.fromPartition(partition),
        railPage: pathToFileURL(join(ROOT, "desktop", "rail.html")).href,
        railPreload: join(ROOT, "desktop", "rail-preload.cjs"),
        machinePreload: join(ROOT, "desktop", "machine-preload.cjs"),
        // This computer in the colour its own Filament's id picks until one is chosen, as other windows show it.
        machines: () => readMachines(machinesFile, origin).map((m) => (m.local ? { ...m, ...hereLook() } : m)),
        localWatched,
        waiting: waitingOn,
        busy: busyOn,
        // The window's controls dressed as the page showing's top row: another machine's as it asked, else This computer's.
        tint: (c) => {
          if (process.platform === "darwin" || w.isDestroyed()) return;
          const colors = c ?? chrome;
          if (!colors) return;
          try {
            w.setTitleBarOverlay(colors);
          } catch {}
        },
        look: () => ({ dark: nativeTheme.shouldUseDarkColors, colors: chrome }),
        // The chat shown in place moved there, or stopped showing: This computer's page follows it (harness-preload.cjs `onGuest`).
        onGuest: (g) => {
          if (!w.isDestroyed() && paneHears(true, w.webContents.getURL(), origin)) w.webContents.send("filament:desk-guest", g);
        },
        // A machine too new for this app: This computer's Settings › About, where Updates' Check now takes the newest.
        updateHere: () => void openWindow("harness", "#/settings/about"),
        // Another machine's Filament updated to this app's version: its own update route, with the sign-in its partition
        // holds, else over SSH (lib/update-there.js).
        appVersion: app.getVersion(),
        updateThere: createUpdateThere({ pick: pickHeld, cookieOf: (partition, url) => cookieOf(partition, url), log: (line) => log.line(line) }),
        guard: (contents, o) => {
          guard(contents, o);
          remotePages.set(contents, String(/** @type {any} */ (o.prefs).partition || ""));
          contents.once("destroyed", () => remotePages.delete(contents));
        },
        grants,
        log: (line) => log.line(line),
        pick: pickHeld,
        check: (input) => checkMachine(input, { ssh: tunnels }),
        // Each change of the machines kept moves the links of their chats' browsers at once (lib/machine-browser.js).
        keep: {
          add: (m) => {
            const got = addMachine(machinesFile, m, { log: (line) => log.line(line) });
            machineBrowsers.sync();
            return got;
          },
          remove: (id) => {
            const went = removeMachine(machinesFile, id, { log: (line) => log.line(line) });
            machineBrowsers.sync();
            return went;
          },
          off: (id, off) => {
            const got = setMachineOff(machinesFile, id, off, { log: (line) => log.line(line) });
            machineBrowsers.sync();
            return got;
          },
          rename: (id, name) => {
            const got = renameMachine(machinesFile, id, name, { log: (line) => log.line(line) });
            machineBrowsers.sync();
            return got;
          },
          // Its colour or icon: the tray's rows and the desk wear it at once, not at the watch's next tick.
          look: (id, l) => {
            const got = setMachineLook(machinesFile, id, l, { log: (line) => log.line(line) });
            if (got) dressedAnew();
            return got;
          },
        },
        // A machine's chats' pages this app holds, drawn over its view's Browser pane.
        browserOf: (id) => machineBrowsers.pagesOf(id),
        menu: (rows) => Menu.buildFromTemplate(dressRows(rows)).popup({ window: w }),
        confirm: async (q) =>
          (await dialog.showMessageBox(w, { type: "question", message: q.title, detail: q.detail, buttons: [q.yes, "Cancel"], defaultId: 1, cancelId: 1, noLink: true })).response === 0,
        // This computer's own Filament, asked as a machine is added: never added beside itself.
        ownId: () =>
          ask("/.well-known/filament")
            .then((x) => (x.ok ? x.json() : null))
            .then((j) => (typeof j?.id === "string" ? j.id.toLowerCase() : null), () => null),
      });
      rail = r;
      w.on("closed", () => void (rail === r && (rail = null)));
    }
    // Its own Filament gives no page yet: the window shows now all the same, the app's page saying so, and Filament's
    // comes into it at the answer (`reload`) — a window held back until then left only the tray icon to see for as long
    // as a start takes, the first after an install longest (the owner's of 10-31).
    if (owned && sup.now().state !== "up") {
      waiting.set(w, { name, route });
      paintWait(w);
    } else void w.loadURL(`${pageOf(name)}${route}`).catch(() => {});
    return w;
  };
  /** Every harness window told which tabs are out: the main one draws "In its own window" in their place (BS-D8). */
  const tellPopped = () => {
    const list = [...popped.keys()];
    for (const w of harnessWindows()) w.webContents.send("filament:popped", list);
  };
  /**
   * A pane in a window of its own (BS4): the harness page showing that one tab, at the chat `route` names — or, out
   * already, its window shown. It opens where a window of its kind stood last (BS-D7), a little aside from another
   * popped window standing there, else at `POP_SIZE` on the main screen; closing it brings the pane back.
   * @param {string} tab @param {string} route
   */
  const popOut = (tab, route) => {
    const had = popped.get(tab);
    if (had && !had.isDestroyed()) {
      if (had.isMinimized()) had.restore();
      had.show();
      had.focus();
      return;
    }
    const main = screen.getPrimaryDisplay();
    const screens = [main, ...screen.getAllDisplays().filter((d) => d.id !== main.id)].map((d) => d.workArea);
    const name = popPlaceName(tab);
    const place = placeOf(readPlaces(placesFile)[name], screens, POP_SIZE);
    const taken = (/** @type {number} */ x, /** @type {number} */ y) => [...popped.values()].some((o) => !o.isDestroyed() && o.getBounds().x === x && o.getBounds().y === y);
    while (taken(place.x, place.y)) {
      place.x += 28;
      place.y += 28;
    }
    const w = new BrowserWindow({
      x: place.x,
      y: place.y,
      width: place.width,
      height: place.height,
      show: false,
      title: "Filament",
      ...(ICONS.window ? { icon: ICONS.window } : {}),
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff",
      // Its title bar is the pane's own head (lib/frame.js).
      ...frameOf({ dark: nativeTheme.shouldUseDarkColors, pane: true }),
      // The harness page, with its bridge: a popped Browser places its page here as the main window's does.
      webPreferences: { ...SAFE, preload: join(ROOT, "desktop", "harness-preload.cjs") },
    });
    w.setMenuBarVisibility(false);
    if (place.maximized) w.maximize();
    track(w);
    guard(w.webContents);
    w.once("ready-to-show", () => w.show());
    w.on("close", () => {
      keepPlace(placesFile, name, { ...w.getNormalBounds(), maximized: w.isMaximized() });
      pages.forgetWindow(w);
    });
    w.on("closed", () => {
      if (popped.get(tab) === w) popped.delete(tab);
      tellPopped();
    });
    void w.loadURL(popUrl(origin, tab, route));
    popped.set(tab, w);
    log.line(`a pane popped out: ${name}`);
    tellPopped();
  };
  // A tile's Pop out, from the harness's window; Bring back from either; the tabs out, asked as a page loads.
  ipcMain.handle("filament:pop-out", (e, p) => {
    const tab = popTab(p?.tab);
    if (!paneOf(e) || !tab) return false;
    popOut(tab, String(p?.route || ""));
    return true;
  });
  ipcMain.on("filament:pop-back", (e, t) => {
    const tab = popTab(t);
    const w = paneOf(e) && tab ? popped.get(tab) : null;
    if (w && !w.isDestroyed()) w.close();
  });
  ipcMain.handle("filament:pop-list", (e) => (paneOf(e) ? [...popped.keys()] : []));
  // The colours of the harness's top row, said by its page as it loads and as its theme changes: the controls over
  // it wear them (lib/frame.js). Only Filament's own page in a harness window, and only two #rrggbb.
  ipcMain.on("filament:title-bar", (e, c) => {
    const w = paneOf(e),
      colors = overlayColors(c);
    if (!w || !colors) return;
    if (w === windows.get("harness")) {
      chrome = colors;
      rail?.paint();
      // Another machine's page shows over it: the controls wear that page's colours (lib/rail.js `tint`).
      if (rail && rail.active() !== LOCAL_ID) return;
    }
    // A Mac's buttons wear the system's own colours: setTitleBarOverlay is Windows' and Linux's.
    if (process.platform === "darwin") return;
    try {
      w.setTitleBarOverlay(colors);
    } catch {}
  });

  /**
   * At Filament's answer: a window that waited for it takes its page, at the route it was asked to open; one whose page
   * did not load, or that shows the place Filament left, loads its page again — the app's own two their page, any other
   * the same page at Filament's place now.
   */
  const reload = () => {
    for (const w of every) {
      if (w.isDestroyed()) continue;
      const waited = waiting.get(w);
      if (waited) {
        waiting.delete(w);
        void w.loadURL(`${pageOf(waited.name)}${waited.route}`).catch(() => {});
        continue;
      }
      /** @type {URL | null} */
      let at = null;
      try {
        at = new URL(w.webContents.getURL());
      } catch {}
      const left = !!at && (at.protocol === "http:" || at.protocol === "https:") && at.origin !== origin;
      if (!unloaded.has(w) && !left) continue;
      const name = [...windows].find(([, x]) => x === w)?.[0];
      // The app's own page that failed here keeps its place and what its address said (a crash's words, lib/crash-notice.js).
      const kept = name && at && !left && at.pathname === PAGES[name] ? `${at.search}${at.hash}` : "";
      const page = name ? `${pageOf(name)}${kept}` : at && (at.protocol === "http:" || at.protocol === "https:") ? `${origin}${at.pathname}${at.search}${at.hash}` : null;
      if (page) void w.loadURL(page);
    }
  };
  /** Filament moved (Settings changed its port or host, then a restart): the app follows it. @param {number} p @param {string} h */
  const follow = (p, h) => {
    if (p === port && h === host) return;
    log.line(`Filament is now at ${h}:${p} (was ${host}:${port})`);
    port = p;
    host = h;
    origin = `http://${h}:${p}`;
  };

  // ---- the server: the app's own child, or the one it attached to ---------------------------------------------------
  /**
   * This computer's presses — an ask answered, a call's Always allow — carry this key while the app runs, else Filament
   * refuses them (src/http/guards.js `pressRefusal`): any program here reaches its API with no secret, the model's own
   * shell among them. Made for this run of the app, handed to the Filament it starts over its port and to the harness's
   * page by its bridge — never an environment, a file or the log. A Filament the app attached to holds none.
   */
  const pressKey = randomBytes(32).toString("base64url");
  /**
   * A call to Filament's own address; one to its admin API carries the owner key its data folder holds now
   * (src/services/owner.js), read at each call — each start of Filament mints its own — and sent only where that
   * folder's Filament listens. A key other than the one the windows' session was minted with (a Filament the app
   * attached to started again by itself) takes a new session (`ownerSession`).
   * @param {string} path @param {RequestInit} [init]
   */
  const ask = (path, init = {}) => {
    const owner = path.startsWith("/api/") ? ownerHeaders(dataDir, origin) : {};
    if (path !== "/api/owner/session" && owner[OWNER_HEADER] && owner[OWNER_HEADER] !== sessionFor) void ownerSession();
    return fetch(`${origin}${path}`, { ...init, headers: { "x-filament-ui": "1", ...owner, ...(init.body ? { "content-type": "application/json" } : {}) }, signal: AbortSignal.timeout(5000) });
  };
  /** The key the windows' browser session was last minted with: "" before the first. */
  let sessionFor = "";
  /**
   * The app's windows' browser session: minted by Filament for this call, which holds its owner key, and kept as an
   * HttpOnly cookie of their session, never written to disk — the page itself holds no secret. Taken again at each
   * start of Filament, before its windows load: a session lasts while the start that minted it does.
   */
  const ownerSession = async () => {
    sessionFor = ownerHeaders(dataDir, origin)[OWNER_HEADER] || "";
    try {
      const r = await ask("/api/owner/session", { method: "POST", body: "{}" });
      const j = /** @type {any} */ (r.ok ? await r.json() : null);
      if (typeof j?.token === "string" && j.token) await session.defaultSession.cookies.set({ url: origin, name: String(j.cookie || OWNER_COOKIE), value: j.token, path: "/", httpOnly: true, sameSite: "strict" });
      else log.line(`Filament minted no browser session for the app's windows (HTTP ${r.status})`);
    } catch (/** @type {any} */ e) {
      log.line(`Filament minted no browser session for the app's windows (${e?.message || e})`);
    }
  };
  const sup = createSupervisor({
    fork: () => {
      const c = utilityProcess.fork(join(ROOT, "bin", "filament.js"), serverArgs({ dataDir, port: given != null ? port : undefined }), { env: serverEnv(process.env, { packaged: app.isPackaged }), stdio: "pipe", serviceName: "Filament server", cwd: ROOT });
      // Its port keeps the key until Filament hears it, as it loads (guards.js `hearPressKey`).
      c.postMessage({ pressKey });
      c.stdout?.on("data", (d) => log.write(String(d)));
      c.stderr?.on("data", (d) => log.write(String(d)));
      // Its memory's census, each minute (src/services/memory-log.js), for the memory log's next line; its end writes
      // its last numbers at once.
      c.on("message", (/** @type {any} */ m) => {
        try {
          sampler.heard(m?.census);
        } catch {}
      });
      c.on("exit", (/** @type {number} */ code) => {
        try {
          sampler.serverEnded(code);
        } catch {}
      });
      // A utility process has its PID once it is spawned, not as it is forked.
      c.once("spawn", () => {
        log.line(`Filament's process: pid ${c.pid}`);
        try {
          sampler.serverStarted(Number(c.pid));
        } catch {}
      });
      return {
        get pid() {
          return c.pid;
        },
        kill: () => c.kill(),
        onExit: (fn) => c.on("exit", (code) => fn(code)),
      };
    },
    answers: () => ask("/api/state").then((r) => r.ok, () => false),
    shutdown: async (ifIdle) => {
      const r = await ask("/api/shutdown", { method: "POST", body: JSON.stringify(ifIdle ? { ifIdle: true } : {}) });
      if (r.ok) return { ok: true };
      const body = /** @type {any} */ (await r.json().catch(() => null));
      return { ok: false, note: String(body?.note || body?.error || `HTTP ${r.status}`).replace(/^not stopped: /, "") };
    },
    // Before each start again: where Filament will listen now (a config that does not read moves nothing), and who is there.
    vacant: () => {
      try {
        follow(followPort(dataDir, given, port), hostOf(dataDir, host));
      } catch {}
      return foundAt(port, { host, dataDir });
    },
    onState: (state, f) => moved(state, f),
    log: (line) => log.line(line),
  });
  let toldLate = false;
  /**
   * As the server's state moves: the tray says it; an answer loads the windows that waited for it or did not load, and
   * until then the waiting ones say where it stands; a slow start is said once; a port taken while it was down is said —
   * a Filament there is the one the app shows from then on —; a start that failed is said with what Filament said last.
   * @param {import("./lib/supervisor.js").State} state @param {import("./lib/supervisor.js").Facts} f
   */
  function moved(state, f) {
    const taken = state === "taken" ? f.found : undefined;
    if (taken?.kind === "attach") {
      owned = false;
      silentSince = null;
      gone = false;
      log.line(`attached to Filament ${taken.version} on port ${port} (its data folder: ${taken.dataDir})`);
    }
    paintTray();
    cardMoved();
    rail?.paint();
    // A Restart the person asked from the tray or the card: said as Filament takes it, and once it is back.
    if (state === "restarting" && restartAsked) say(restartingNote(restartAsked.inFlight));
    if (state === "up" && restartAsked) {
      restartAsked = null;
      void ask("/api/state")
        .then((r) => r.json())
        .then((s) => say(backNote(String(s?.version || ""), port)), () => say(backNote("", port)));
    }
    if (state !== "up" && state !== "restarting" && state !== "starting" && state !== "late") restartAsked = null;
    // The windows' browser session first (`ownerSession`), so the page they load calls with it.
    if (state === "up" || taken?.kind === "attach") void ownerSession().finally(reload);
    else for (const w of waiting.keys()) paintWait(w);
    if (state === "late" && !toldLate) {
      toldLate = true;
      const file = join(own, "server.log");
      void dialog
        .showMessageBox({ type: "info", title: "Filament", message: "Filament is taking longer than usual to start", detail: `It is still starting. What it says is in ${file}.`, buttons: ["Open the log", "OK"], defaultId: 1 })
        .then(({ response }) => (response === 0 ? shell.openPath(file) : ""));
    }
    if (taken?.kind === "refuse") sayTaken(taken.why);
    if (state === "failed") void failed(f.code);
  }
  /** Its port another's when it was to start again: said, with where the port is set. @param {string} why */
  function sayTaken(why) {
    const w = refusedWords(port, why, dataDir, { again: true, given: given != null });
    void dialog.showMessageBox({ type: "error", title: w.title, message: w.message, detail: w.detail, buttons: ["OK"] });
  }
  /** It could not start: said, with what Filament said last; Try again starts it anew. @param {number | null | undefined} code */
  async function failed(code) {
    const file = join(own, "server.log");
    const said = serverTail(file);
    const { response } = await dialog.showMessageBox({
      type: "error",
      title: "Filament",
      message: "Filament could not start",
      detail: `It ended before it answered (exit ${code ?? "?"}).${said.length ? ` What it said last:\n\n${said.join("\n")}` : ""}\n\nAll it said is in ${file}.`,
      buttons: ["Try again", "Open the log", "Close"],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 0) void act("restart");
    if (response === 1) void shell.openPath(file);
  }

  // ---- updates: the installed app's, from its releases' repository (lib/updates.js, lib/install-update.js) -----------
  /** @returns {any} */
  const ownPackage = () => {
    try {
      return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    } catch {
      return null;
    }
  };
  /** A file of the app's resources, or "": electron-builder writes app-update.yml there, and a Linux package's package-type. @param {string} name */
  const resource = (name) => {
    try {
      return readFileSync(join(process.resourcesPath, name), "utf8");
    } catch {
      return "";
    }
  };
  /** How this app updates, by how it was installed. */
  const updateKind = kindOf({ mas: !!process.mas, windowsStore: !!process.windowsStore, appImage: process.env.APPIMAGE || "", packageType: resource("package-type") });
  // A checkout updates by git: only the installed app looks.
  const updater = app.isPackaged
    ? createUpdater({
        current: app.getVersion(),
        // The public repository electron-builder.yml publishes to, as the build wrote it into the app; the package's own
        // where a build wrote none.
        repo: releasesRepoOf(resource("app-update.yml")) ?? repoOf(ownPackage()),
        dir: join(own, "updates"),
        kind: updateKind,
        // Electron's own fetch: the system's proxy and certificate store, where Node's reaches neither.
        fetchImpl: /** @type {typeof fetch} */ ((url, init) => net.fetch(String(url), /** @type {any} */ (init))),
        log: (line) => log.line(line),
        enabled: () => settings.updates,
        // A Mac's zip goes to Squirrel.Mac as soon as it is checked: Restart to update then installs at once.
        prepare: updateKind === "mac" ? (u) => readySquirrel({ autoUpdater, zip: u.file, log: (l) => log.line(l) }) : undefined,
        onChange: (s) => {
          paintTray();
          tellUpdate();
          if (!owned) return;
          if (s.phase === "available" && s.received === 0 && !updateSaid.has(`a${s.version}`)) (updateSaid.add(`a${s.version}`), say(updateOutNote(s.version, s.kind)));
          if (s.phase === "ready" && !updateSaid.has(`r${s.version}`)) (updateSaid.add(`r${s.version}`), say(updateNote(s.version, s.kind)));
        },
      })
    : null;
  // Squirrel.Mac says its errors as an event, which throws in the app where nothing listens: one after readySquirrel
  // gave up (its download cut at the time limit) is logged.
  if (updater && updateKind === "mac") autoUpdater.on("error", (/** @type {any} */ e) => log.line(`updates: Squirrel.Mac: ${e?.message || e}`));
  /** The update as the harness's notice and the tray show it: none where the app runs another's Filament, or offers none. */
  const updateView = () => (updater && owned && updater.state.phase !== "none" ? updater.state : null);
  /** Every harness window hears where the update stands (harness-preload.cjs `filamentApp.onUpdate`). */
  function tellUpdate() {
    const v = updateView();
    for (const w of every) if (!w.isDestroyed()) w.webContents.send("filament:update", v);
  }
  /** The versions whose news was said as a notification, once each: out, and ready. */
  const updateSaid = new Set();
  /** How a Linux update starts the app again once it is in place (Restart to update), or none. @type {{ execPath: string, args: string[] } | null} */
  let relaunch = null;
  /**
   * The update fetched, installed as the app quits: Windows' installer started on its own, silently, the app started
   * after for a restart; a Mac's handed to Squirrel.Mac, which installs it as the app goes — Restart to update quits
   * through it, so → true, and leave() ends the app by Squirrel's quitAndInstall; a Linux one is in place already
   * (restartToUpdate), and the app starts again from it — a Quit puts an AppImage in place as it goes, no password
   * asked. Only where the app runs its own Filament, which it has stopped by then: an attached one — started from a
   * terminal, from the install folder — the silent installer would end unasked, a turn and all (the review of 85ff00e86).
   * @param {boolean} restart @returns {boolean} whether Squirrel.Mac ends the app
   */
  function installUpdate(restart) {
    const u = updater?.ready;
    if (!u || !owned) return false;
    if (!existsSync(u.file)) return (log.line(`updates: Filament ${u.version}'s download is gone from ${u.file}: nothing installs, and asked again it is fetched again`), false);
    if (u.kind === "mac") {
      log.line(`updates: Filament ${u.version} installs as the app goes${restart ? ", then starts" : ""} (Squirrel.Mac)`);
      return restart;
    }
    if (u.kind === "appimage" || u.kind === "deb") {
      if (restart && relaunch) {
        app.relaunch(relaunch);
        log.line(`updates: Filament ${u.version} is in place; starting it`);
      } else if (!restart && u.kind === "appimage" && process.env.APPIMAGE) {
        const r = replaceAppImage(u.file, process.env.APPIMAGE);
        log.line(r.ok ? `updates: Filament ${u.version}'s AppImage is in place at ${process.env.APPIMAGE}` : `updates: ${r.why}`);
      }
      return false;
    }
    if (u.kind !== "nsis") return false;
    const fail = (/** @type {any} */ e) => log.line(`updates: Filament ${u.version}'s installer did not start (${e?.message || e})`);
    try {
      const child = spawn(u.file, installArgs(restart), { detached: true, stdio: "ignore", windowsHide: true });
      child.on("error", fail);
      child.unref();
      log.line(`updates: installing Filament ${u.version}${restart ? ", then starting it" : ""}`);
    } catch (/** @type {any} */ e) {
      fail(e);
    }
    return false;
  }
  /**
   * The person's Update: a store's build opens its store, one that can't update itself the release's page; a Mac app
   * that can't replace itself (run from its disk image, or from Downloads, where macOS runs it from a copy it makes)
   * says where to put it first; otherwise the download comes while they work.
   */
  async function getUpdate() {
    const u = updater?.available;
    if (!u || !owned) return;
    const store = STORE_PAGES[u.kind];
    if (store || u.kind === "page") return void shell.openExternal(store || u.page).catch(() => {});
    if (u.kind === "mac" && !app.isInApplicationsFolder()) {
      const { response } = await dialog.showMessageBox({
        type: "info",
        title: "Filament",
        message: "Move Filament to Applications to update it",
        detail: `Filament runs from where macOS can't let it replace itself (${process.execPath.replace(/\/Contents\/MacOS\/[^/]+$/, "")}). Quit Filament, drag it from its disk image or Downloads into Applications, and open it from there: its Update then installs ${u.version}.`,
        buttons: ["OK", "Open the release page"],
        defaultId: 0,
        cancelId: 0,
      });
      if (response === 1) void shell.openExternal(u.page).catch(() => {});
      return;
    }
    await updater?.fetch();
  }
  /** A Restart to update under way: a second press (the notice's and the tray's) joins it. @type {Promise<void> | null} */
  let restarting = null;
  /**
   * The person's Restart to update — the second ask, once the download is in. A Linux one: Filament stopped first —
   * asked while it works, and Keep it running installs nothing — then put in place (an AppImage's file replaced, a deb
   * through the password prompt), and where that failed Filament starts again and the app runs on as it was; then the
   * Quit, which installs the rest.
   */
  const restartToUpdate = () => (restarting ||= restartNow().finally(() => (restarting = null)));
  async function restartNow() {
    const u = updater?.ready;
    if (!u || !owned) return;
    if (u.kind === "appimage" || u.kind === "deb") {
      if (!(await stopAsked())) return;
      const r = u.kind === "appimage" ? (process.env.APPIMAGE ? replaceAppImage(u.file, process.env.APPIMAGE) : { ok: /** @type {const} */ (false), why: "this app was not started from an AppImage" }) : await installDeb(u.file, u.sha512);
      if (!r.ok) {
        sup.start();
        log.line(`updates: Filament ${u.version} was not installed: ${r.why}`);
        const { response } = await dialog.showMessageBox({
          type: "warning",
          title: "Filament",
          message: `Filament ${u.version} was not installed`,
          detail: `${r.why[0].toUpperCase()}${r.why.slice(1)}. Filament keeps running as it is; its release page has the new version to install by hand.`,
          buttons: ["Close", "Open the release page"],
          defaultId: 0,
          cancelId: 0,
        });
        if (response === 1) void shell.openExternal(u.page).catch(() => {});
        return;
      }
      relaunch = relaunchOf(u.kind, { appImage: process.env.APPIMAGE || "", execPath: process.execPath, argv: process.argv });
    }
    return quit({ update: "restart" });
  }

  // ---- the tray -------------------------------------------------------------------------------------------------------
  // By its path: on Windows, Electron then reads the .ico at the size the screen's scale asks for (desktop/lib/icons.js).
  const tray = new Tray(ICONS.tray);
  /** Attached: since when that Filament gives no answer, and whether it gives none now. @type {number | null} */
  let silentSince = null;
  let gone = false;
  /** How many of the harness's chats wait on you (the watch below), for the tooltip. */
  let needsCount = 0;
  /** Each machine as the watch last saw it, This computer first: the tray's rows and the popover's counts. @type {import("./lib/tray.js").MachineRow[]} */
  let machineRows = [];
  /** How many turns are at work on each other machine, as its last look said (`busyOn`). @type {Map<string, number>} */
  const workingOn = new Map();
  /** The tray's menu as last painted. @type {Electron.Menu | null} */
  let trayMenu = null;
  // An update is offered where the app runs its own Filament alone (`installUpdate`).
  const facts = () => ({ owned, state: owned ? sup.now().state : /** @type {const} */ ("attached"), port, gone, logonOn: process.platform === "linux" ? null : logonOn(), notify: settings.notify, needs: needsCount, machines: machineRows, updates: updater ? settings.updates : null, update: updateView() });
  function paintTray() {
    if (tray.isDestroyed()) return;
    tray.setToolTip(trayTip(facts()));
    trayMenu = Menu.buildFromTemplate(trayRows(facts()).map((row) => ("type" in row ? row : { label: row.label, enabled: row.enabled !== false, ...(row.checked === undefined ? {} : { type: /** @type {const} */ ("checkbox"), checked: row.checked }), ...(row.swatch ? { icon: swatchOf(row.swatch) } : {}), click: () => void act(row.id) })));
    // A Mac's menu bar opens a tray's menu at any click, over the card the click opened (the owner's of 11-08): there it
    // opens at a right-click alone.
    if (process.platform !== "darwin") tray.setContextMenu(trayMenu);
  }
  tray.on("right-click", () => {
    if (process.platform === "darwin" && trayMenu) tray.popUpContextMenu(trayMenu);
  });
  // A click shows or hides the card; a double-click opens the harness. A Mac's Ctrl-click is its right-click.
  tray.on("click", (e) => {
    if (process.platform === "darwin" && e?.ctrlKey && trayMenu) return void tray.popUpContextMenu(trayMenu);
    const what = trayClick({ shown: !!card && !card.isDestroyed() && card.isVisible(), blurredAt: cardBlurredAt, now: Date.now() });
    if (what === "hide") card?.hide();
    else if (what === "open") openCard();
  });
  tray.on("double-click", () => {
    card?.hide();
    openWindow("harness");
  });

  // ---- the card: Filament's page in a small window by the tray -------------------------------------------------------
  /** @type {BrowserWindow | null} */
  let card = null;
  /** The card's window shows the app's own page (Filament gave none), not Filament's card. */
  let cardDown = false;
  /** The card's theme, as its page last said: the app's own page wears it. */
  let cardLight = false;
  /** When the card last hid as it lost the focus (lib/card.js `trayClick`). */
  let cardBlurredAt = 0;
  /** The app's word on its Filament, as the card's page shows it. */
  const appFacts = () => ({ owned, state: owned ? sup.now().state : gone ? "gone" : "attached", port });
  const cardAnswers = () => (owned ? sup.now().state === "up" : !gone);
  const loadCard = () => {
    if (!card || card.isDestroyed()) return;
    cardDown = !cardAnswers();
    void card.loadURL(cardDown ? downPage(downWords(appFacts().state, port), !cardLight) : `${origin}/ui/tray-card.html`).catch(() => {});
  };
  function openCard() {
    const fresh = !card || card.isDestroyed();
    if (fresh) {
      const w = new BrowserWindow({
        ...CARD_SIZE,
        show: false,
        frame: false,
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        title: "Filament",
        backgroundColor: cardLight ? "#fbfbfd" : "#1d1d20",
        webPreferences: { ...SAFE, preload: join(ROOT, "desktop", "card-preload.cjs") },
      });
      guard(w.webContents);
      // Esc hides it, whichever page it shows; so does a click anywhere else, as a tray's popover hides (the owner's of
      // 11-08).
      w.webContents.on("before-input-event", (e, input) => {
        if (input.type === "keyDown" && input.key === "Escape") {
          e.preventDefault();
          w.hide();
        }
      });
      w.on("blur", () => {
        if (w.isDestroyed() || !w.isVisible()) return;
        cardBlurredAt = Date.now();
        w.hide();
      });
      // Filament's card that did not load (Filament went meanwhile): the app's own page, until Filament answers.
      w.webContents.on("did-fail-load", (_e, code, _d, _u, isMainFrame) => {
        if (!isMainFrame || code === -3 || cardDown) return;
        cardDown = true;
        void w.loadURL(downPage(downWords(appFacts().state, port), !cardLight)).catch(() => {});
      });
      w.on("closed", () => void (card = null));
      card = w;
      loadCard();
    }
    const at = tray.getBounds();
    const near = at.width > 0 ? screen.getDisplayMatching(at) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    /** @type {BrowserWindow} */ (card).setBounds(cardPlace(at, near.workArea));
    // A new window is shown at its first paint: shown before it, beside another window of the app's, Chromium keeps it
    // hidden — nothing painted, its page told it is hidden.
    const show = () => {
      if (!card || card.isDestroyed()) return;
      card.show();
      card.focus();
      cardState();
    };
    if (fresh) /** @type {BrowserWindow} */ (card).once("ready-to-show", show);
    else show();
  }
  const cardState = () => void (card && !card.isDestroyed() && card.webContents.send("filament:card-state", appFacts()));
  /** As Filament's state moves: the card hears it, and shows Filament's card once Filament answers (at its place now). */
  function cardMoved() {
    if (!card || card.isDestroyed()) return;
    let at = "";
    try {
      at = new URL(card.webContents.getURL()).origin;
    } catch {}
    if (cardAnswers() ? cardDown || (at !== "null" && at !== origin) : cardDown) loadCard();
    cardState();
  }
  ipcMain.on("filament:card-act", (e, id, route) => {
    if (!card || card.isDestroyed() || e.sender !== card.webContents || !cardHears(id, e.senderFrame?.url, origin, route)) return void log.line(`a word to the card's bridge, not heard: ${String(id).slice(0, 40)}`);
    if (id === "hide") return void card.hide();
    if (id !== "restart") card.hide();
    void act(id, route);
  });
  ipcMain.on("filament:card-ready", (e) => void (card && !card.isDestroyed() && e.sender === card.webContents && cardState()));
  ipcMain.on("filament:card-look", (e, look) => void (card && !card.isDestroyed() && e.sender === card.webContents && (cardLight = !!look?.light)));

  // ---- notifications: Filament's alerts, each once; a Restart the person asked -----------------------------------------
  const startedAt = Date.now();
  /** When a failover was last told. */
  const quiet = {};
  /** The alerts said (or older than the app), by id. @type {Set<string>} */
  const seen = new Set();
  /** A Restart from the tray or the card, while it runs: what was in flight as it was asked. @type {{ inFlight: number } | null} */
  let restartAsked = null;
  /** What the last notification named: a click on it opens that — a chat of this computer's, another machine — else the card. @type {{ route: string | null, machine: string | null }} */
  let saidOf = { route: null, machine: LOCAL_ID };
  /** Filament's logo, as each notification wears it. */
  const logo = nativeImage.createFromPath(join(ROOT, "src", "ui", "filament-icon.png"));
  /**
   * @param {import("./lib/notes.js").Note | null} note @param {string | null} [route]  the chat it names, on its machine
   * @param {string | null} [machine]  whose it is: this computer's, another machine's (shown in the window), null for several
   */
  function say(note, route = null, machine = LOCAL_ID) {
    if (!note) return;
    log.line(noteLine(note, settings.notify));
    if (!settings.notify || tray.isDestroyed()) return;
    saidOf = { route, machine };
    // Windows: through the tray icon — a Windows notification that needs no Start-menu shortcut, which a run from the
    // checkout has none of. Elsewhere the system's own.
    if (process.platform === "win32") tray.displayBalloon(balloonOf(note, logo));
    else if (Notification.isSupported()) {
      const n = new Notification({ title: note.title, body: note.text, ...(logo.isEmpty() ? {} : { icon: logo }) });
      n.on("click", () => openSaid(route, machine));
      n.show();
    }
  }
  /**
   * A notification pressed: this computer's chat it names, or its card; another machine's, that machine shown in the window
   * at the chat it names; several machines', the harness window. @param {string | null} route @param {string | null} machine
   */
  const openSaid = (route, machine) => (machine === null ? void openWindow("harness") : machine !== LOCAL_ID ? showMachine(machine, route) : route ? void openWindow("harness", route) : openCard());
  tray.on("balloon-click", () => openSaid(saidOf.route, saidOf.machine));
  /**
   * A machine shown in the harness window — its row in the tray, a notification of its —, the window opened first; at
   * `route`, the chat a notification names, where its page opens there (rail.js `openOn`), else as it shows.
   * @param {string} id @param {string | null} [route]
   */
  const showMachine = (id, route = null) => {
    openWindow("harness");
    if (!route || !rail?.openOn(id, route)) rail?.select(id);
  };

  // ---- start at logon ------------------------------------------------------------------------------------------------
  const item = logonItem({ exe: process.execPath, packaged: app.isPackaged, main: MAIN, dataDir: opt("--data-dir") ? dataDir : undefined, port: given });
  function logonOn() {
    try {
      return app.getLoginItemSettings({ path: item.path, args: item.args }).openAtLogin;
    } catch {
      return false;
    }
  }
  /** @param {boolean} on */
  const setLogon = (on) => app.setLoginItemSettings({ openAtLogin: on, path: item.path, args: item.args });
  // A login item Windows keeps under the app's id before com.filamentdev.desktop: moved to the new id, once — left, it
  // would start the app at logon still once Start at logon's check is turned off.
  if (process.platform === "win32")
    try {
      const old = oldLogonEntry(app.getLoginItemSettings({ path: item.path, args: item.args }).launchItems, oldAppIdOf(isCheckout()));
      if (old) {
        app.setLoginItemSettings({ openAtLogin: false, name: old.name, path: item.path, args: item.args });
        if (old.enabled) setLogon(true);
        log.line(`start at logon: the login item under ${old.name} moved to ${appIdOf(isCheckout())}${old.enabled ? "" : " (it was off)"}`);
      }
    } catch {}

  // ---- the look every few seconds: alerts; attached, whether that Filament still answers ------------------------------
  let looking = false;
  async function look() {
    if (looking || quitting || (owned && sup.now().state !== "up")) return;
    looking = true;
    try {
      const said = await ask("/api/alerts").then((r) => (r.ok ? r.json() : null), () => null);
      if (said) say(alertNote(said.alerts, seen, startedAt, quiet));
      if (owned) return;
      const w = attachWatch(silentSince, said !== null, Date.now());
      silentSince = w.silentSince;
      if (w.gone !== gone) {
        gone = w.gone;
        log.line(gone ? "the Filament the app attached to does not answer" : "the Filament the app attached to answers again");
        paintTray();
        cardMoved();
        rail?.paint();
      }
      if (!w.take) return;
      const f = await foundAt(port, { host, dataDir });
      if (owned) return;
      if (f.kind === "start") {
        log.line("the Filament the app attached to gave no answer for 45 s: the app starts its own");
        owned = true;
        silentSince = null;
        gone = false;
        sup.start();
      } else if (f.kind === "attach") {
        silentSince = null;
        gone = false;
        paintTray();
        cardMoved();
      } else silentSince = Date.now();
    } finally {
      looking = false;
    }
  }
  const looks = setInterval(() => void look(), LOOK_MS);

  // ---- every machine's harness, watched every 10 s: the chats that come to need you, the turns that end, Your Space's new rows
  // This computer's tells after a restart what the restart cut, as it always has: no outage of its is quiet.
  const watch = createWatch({ call: (path, init = {}) => ask(`/api${path}`, init).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))), outageMs: Infinity });
  /** The Cookie header a machine's partition sends an origin: its sign-in there, read by main alone. @param {string} partition @param {string} url */
  const cookieOf = async (partition, url) => (await session.fromPartition(partition).cookies.get({ url })).map((c) => `${c.name}=${c.value}`).join("; ");
  // Each machine kept beside this computer, its own watch (the owner's remote Filament of 11-06, Part 3), read with the
  // sign-in its partition's session holds: the window open or not.
  const fleet = createFleet({ machines: () => readKept(machinesFile), pick: pickHeld, cookieOf });
  // This Filament's agents on each of them (the remote-agents plan's f-ui): Settings › Remote access's switch, its calls
  // made here with that sign-in, the agents' device's token kept in this Filament's machine store — never the page's.
  // Its own name goes with them (the Filament here keeps it in machine.json, services/machine.js): that machine says its
  // agents' chats are from it.
  const ownName = () => {
    try {
      return String(JSON.parse(readFileSync(join(dataDir, "machine.json"), "utf8"))?.name || "");
    } catch {
      return "";
    }
  };
  const agentsThere = createMachineAgents({ machines: () => readKept(machinesFile), pick: pickHeld, cookieOf, store: createMachines({ dataDir }), log: (line) => log.line(line), ownName });
  // Each machine let use this app's browser (b-remote): its link to that machine's browser host, made here with the same
  // sign-in, and its chats' pages here — a profile of that machine's, the same guards as this computer's pages; their
  // localhost that machine's, through a proxy over the link (b-tunnel); and nothing of this computer's own: its loopback
  // by any name, its own Filament wherever this computer's link last said it is reached, and its port and host as the app
  // reads them; that machine's Filament as it says where it is reached (`own`).
  const herePlaces = () => {
    const p = pages.places();
    return { ports: [...new Set([port, ...p.ports])], names: [...new Set([host, ...p.names])], origins: p.origins };
  };
  const machineBrowsers = createMachineBrowsers({
    machines: () => readKept(machinesFile),
    pick: pickHeld,
    cookieOf,
    keep: (id, on) => setMachineBrowser(machinesFile, id, on, { log: (line) => log.line(line) }),
    log: (line) => log.line(line),
    // Each link's state as it moves, to the harness pages of this app's own Filament: Settings › Remote access says it.
    changed: (row) => {
      for (const w of harnessWindows()) if (paneHears(true, w.webContents.getURL(), origin)) w.webContents.send("filament:browser-link", row);
    },
    pagesFor: (m, send) => {
      /** @type {ReturnType<typeof createPages> | null} */
      let made = null;
      const guards = machineGuards({ here: herePlaces, tunneled: () => !!made?.proxying() });
      made = createPages({
        electron: { WebContentsView, BrowserWindow, session, nativeImage },
        send,
        partition: partitionFor(m.id),
        log: (line) => log.line(`${m.name}: ${line}`),
        menu: (_wc, p) => rightClick(p, /^https?:/i.test(String(p.linkURL || ""))),
        pointer: () => screen.getCursorScreenPoint(),
        // The developer's hand on a page, told to that machine's Browser pane in the window.
        tellPane: (_win, msg) => {
          const c = rail?.pageOf(m.id);
          if (c && !c.isDestroyed()) c.send("filament:browser-hand", msg);
        },
        veilPreload: join(ROOT, "desktop", "veil-preload.cjs"),
        own: guards.own,
        named: guards.named,
        landed: guards.landed,
        keys: (w, e, input) => void (rail && w === windows.get("harness") && rail.keys(e, input)),
      });
      return made;
    },
  });
  machineBrowsers.sync();

  // ---- the desk (the remote desk of 11-22) -----------------------------------------------------------------------------
  /**
   * Each other machine's Now, chats and desk flags as its last look found them, by its id: kept while it is away, so the
   * desk greys its rows rather than losing them; none for one signed out here, disconnected or removed.
   * @type {Map<string, { rows: import("./lib/watch.js").NowGroups, recent: import("./lib/watch.js").DeskChat[], flags: string[] }>}
   */
  const deskLooks = new Map();
  /** The desk as this computer's page last heard it, and as sent. @type {any} */
  let deskNow = null;
  let deskSaid = "";
  /**
   * What this computer's page lists every machine's chats from: This computer as it wears itself, and each other machine
   * kept — its state, its colour and icon, its Now's rows, its chats and what its Filament does for the desk (`flags`,
   * watch.js `deskFlagsOf`: what one lacks, the desk greys). Another machine's page hears none of it: no page there
   * hears another machine's names (lib/rail.js).
   */
  const deskOf = () => ({
    here: { id: LOCAL_ID, name: LOCAL_NAME, ...hereLook() },
    machines: readKept(machinesFile).map((k) => {
      const row = machineRows.find((r) => r.id === k.id);
      const refused = !k.off && !!row?.refused;
      const had = k.off || refused ? null : deskLooks.get(k.id);
      return { id: k.id, name: k.name, status: k.off ? "disconnected" : (row?.status ?? "reconnecting"), refused, color: colorOf(k), icon: iconOf(k), rows: had?.rows ?? { needs: [], works: [], done: [] }, recent: had?.recent ?? [], flags: had?.flags ?? [] };
    }),
  });
  /** The desk told to this computer's page — Filament's own page in the harness window — where it moved. */
  const tellDesk = () => {
    const d = deskOf();
    const said = JSON.stringify(d);
    if (said === deskSaid) return;
    [deskNow, deskSaid] = [d, said];
    const w = windows.get("harness");
    if (w && !w.isDestroyed() && paneHears(true, w.webContents.getURL(), origin)) w.webContents.send("filament:desk", d);
  };
  /**
   * The harness window's own page — This computer's, Filament's page there, not a popped pane's — a word to the desk
   * comes from, else null: a popped pane, which never hears the desk move, neither reads it nor acts through it (the hunt
   * on s1e). @param {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} e
   */
  const deskPage = (e) => {
    const w = windows.get("harness");
    return w && !w.isDestroyed() && paneOf(e) === w && rail?.hearsPage(e.sender, e.senderFrame) === LOCAL_ID ? w : null;
  };
  // This computer's page asks for it as it starts listening (harness-preload.cjs `onDesk`), Filament's own page alone.
  ipcMain.handle("filament:desk", (e) => (deskPage(e) ? (deskNow ?? deskOf()) : null));
  // The desk's Done cleared: those chats of a machine kept marked seen there (harness-preload.cjs `seen`), this
  // computer's page alone, its chats' ids as ids — fifty at most —, the machine's own mark and nothing else.
  ipcMain.handle("filament:desk-seen", async (e, p) => {
    const id = String(p?.id ?? "");
    if (!deskPage(e) || !readKept(machinesFile).some((k) => k.id === id && !k.off)) return false;
    const chains = (Array.isArray(p?.chains) ? p.chains : []).map(String).filter((c) => /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(c)).slice(0, 50);
    await Promise.all(chains.map((c) => fleet.markSeen(id, c)));
    return true;
  });
  // The desk's bridge (lib/desk.js): This computer's page acts on the other machines by the desk's operations alone, made
  // here as this window's sign-in there — never a path, never a token. Each machine's events stream says what moved
  // there, to that page alone, and a turn, an ask or a stream (re)joined has that machine looked at again soon.
  const desk = createDesk({
    machines: () => readKept(machinesFile),
    pick: pickHeld,
    cookieOf,
    tell: (f) => {
      const w = windows.get("harness");
      if (w && !w.isDestroyed() && paneHears(true, w.webContents.getURL(), origin)) w.webContents.send("filament:desk-event", f);
      if (f.type === "turn" || f.type === "ask" || f.type === "hello") lookSoon(f.machine);
    },
  });
  ipcMain.handle("filament:desk-call", (e, p) => (deskPage(e) ? desk.call(p) : null));
  /** A rectangle of the page's, in the window's units. @param {BrowserWindow} w @param {unknown} rect */
  const deskRect = (w, rect) => {
    const [width, height] = w.getContentSize();
    return placeRect(rect, w.webContents.getZoomFactor(), { width, height });
  };
  // Another machine's chat shown in place over This computer's column beside its list (lib/rail.js `showChat`), moved
  // with that column, out of sight while something of the page lies over it, and let go — that page's words alone.
  ipcMain.handle("filament:desk-show", (e, p) => {
    const w = deskPage(e);
    const [width, height] = w ? w.getContentSize() : [0, 0];
    const ask = w ? showAsk(p, w.webContents.getZoomFactor(), { width, height }, placeRect) : null;
    return !!ask && !!rail?.showChat(ask.id, ask.hash, ask.rect, ask.theme, ask.focus);
  });
  ipcMain.on("filament:desk-place", (e, rect, keys) => {
    const w = deskPage(e);
    if (w) rail?.placeChat(rect ? deskRect(w, rect) : null, keys === true);
  });
  ipcMain.on("filament:desk-hide", (e) => void (deskPage(e) && rail?.hideChat()));
  // A machine's page showing a chat alone (machine-preload.cjs), while that chat shows in place: its whole page shown at
  // an address of its harness, or a key of the list beside it handed to This computer's page — by its id, one of
  // DESK_KEYS. A view out of sight, or kept from before, pulls the window nowhere.
  ipcMain.on("filament:machines-full", (e, route) => {
    const id = rail?.hearsPage(e.sender, e.senderFrame);
    if (id && id !== LOCAL_ID && rail?.guest() === id) rail?.openOn(id, String(route ?? ""));
  });
  ipcMain.on("filament:machines-key", (e, key) => {
    const id = rail?.hearsPage(e.sender, e.senderFrame);
    const w = windows.get("harness");
    if (!id || id === LOCAL_ID || rail?.guest() !== id || !DESK_KEYS.includes(String(key)) || !w || w.isDestroyed()) return;
    w.webContents.focus();
    w.webContents.send("filament:desk-key", String(key));
  });
  // A machine's view showing the app's update page (lib/rail.js `updatePage`): its act, as the view it is, which the
  // rail takes up only while that view shows such a page — `install`, Update Filament on it.
  ipcMain.on("filament:machines-update", (e, how) => {
    const id = rail?.hearsPage(e.sender, e.senderFrame);
    if (id && id !== LOCAL_ID) rail?.updateOn(id, how === "install" ? "install" : "");
  });
  /** @type {NodeJS.Timeout | null} */
  let soon = null;
  /** The machines whose events stream said something moved there since the last look of theirs. @type {Set<string>} */
  const soonFor = new Set();
  /**
   * Those machines alone looked at again within `SOON_MS` — this computer's own Filament and the rest wait for the tick
   * —, at most once each `SOON_MS` however busy they are; one under way, the next after it.
   * @param {string} id
   */
  const lookSoon = (id) => {
    if (quitting) return;
    soonFor.add(id);
    if (soon) return;
    soon = setTimeout(() => {
      soon = null;
      if (watching) return void lookSoon(id);
      const only = new Set(soonFor);
      soonFor.clear();
      void watchLook({ only });
    }, SOON_MS);
    soon.unref?.();
  };
  /** A machine's colour now, as the tray's row wears it. @param {string} id */
  const colorNow = (id) => (id === LOCAL_ID ? hereLook().color : colorOf(readKept(machinesFile).find((k) => k.id === id) ?? { id }));
  /** A machine's colour or icon chosen: the tray and the desk dressed anew at once. */
  const dressedAnew = () => {
    machineRows = machineRows.map((r) => ({ ...r, color: colorNow(r.id) }));
    paintTray();
    tellDesk();
  };

  let watching = false;
  /**
   * The tick's look at every machine; `only`: those machines alone, as their events stream asked (`lookSoon`) — this
   * computer's own Filament not read, every other machine as it last stood. @param {{ only?: ReadonlySet<string> | null }} [o]
   */
  async function watchLook({ only = null } = {}) {
    if (watching || quitting) return;
    watching = true;
    try {
      // A tunnel no machine kept goes through any more — removed from the window, or disconnected — ends; so does the
      // link of its chats' browser, and one paired again since it was refused dials anew.
      const kept = readKept(machinesFile);
      tunnels.only(kept.filter((m) => !m.off).flatMap((m) => m.routes.filter((r) => r.kind === "ssh").map((r) => String(r.url))));
      machineBrowsers.sync();
      desk.sync();
      // This computer's while its Filament answers; every other machine's, whatever this one's does — each read on its
      // own, so neither one's failure costs the other's notes (the review of p3-watch).
      const up = !gone && !(owned && sup.now().state !== "up");
      const [w, others] = await Promise.all([up && !only ? watch.look().catch(() => null) : null, fleet.look({ only }).catch(() => [])]);
      if (quitting) return;
      if (w) needsCount = w.needs;
      // The turns at work on each, where its look landed: a machine not read since keeps what it said last.
      for (const o of others) if (o.look) workingOn.set(o.id, o.look.works);
      for (const id of [...workingOn.keys()]) if (!kept.some((k) => k.id === id && !k.off)) workingOn.delete(id);
      // Each machine in the window's order, in its colour; one disconnected says so and counts nothing — the fleet watches it not.
      const rows = [
        { id: LOCAL_ID, name: LOCAL_NAME, local: true, status: localWatched().status, needs: up ? needsCount : 0, color: colorNow(LOCAL_ID) },
        ...kept.flatMap((k) => {
          if (k.off) return [{ id: k.id, name: k.name, status: /** @type {const} */ ("disconnected"), refused: false, needs: 0, color: colorOf(k) }];
          const m = others.find((o) => o.id === k.id);
          return m ? [{ id: m.id, name: m.name, status: m.status, refused: m.refused, needs: m.needs, color: colorOf(k) }] : [];
        }),
      ];
      if (JSON.stringify(rows) !== JSON.stringify(machineRows)) {
        machineRows = rows;
        paintTray();
        rail?.paint();
      }
      // The desk: each machine's rows as its look found them — one that did not look this tick keeps its last.
      for (const m of others) {
        if (m.refused) deskLooks.delete(m.id);
        else if (m.look) deskLooks.set(m.id, { rows: m.look.rows, recent: m.look.recent, flags: m.look.flags });
      }
      for (const id of [...deskLooks.keys()]) if (!kept.some((k) => k.id === id && !k.off)) deskLooks.delete(id);
      tellDesk();
      // A turn that ended where no page of its machine's harness is open here takes its chat's unread mark there, as the
      // harness's page gives it where one is: the card's Done and the harness's then say it.
      const harness = windows.get("harness");
      if (w && (!harness || harness.isDestroyed()))
        for (const e of w.ended) void ask(`/api/sessions/${encodeURIComponent(e.chain)}/settings`, { method: "PATCH", body: JSON.stringify({ patch: { display: { unread: true } } }) }).catch(() => {});
      for (const m of others) if (m.look && !holdsHarness(m.partition)) for (const e of m.look.ended) void fleet.markUnread(m.id, e.chain);
      // One notification a tick, every machine's in it but the one showing in the harness window you are in: there,
      // its own Now says it (the review of p3-shell).
      const focused = BrowserWindow.getFocusedWindow();
      const showing = focused && focused === harness ? (rail?.active() ?? LOCAL_ID) : null;
      const tick = tickNote(
        [
          ...(w ? [{ machine: LOCAL_ID, needs: w.needsNew, ended: w.ended.filter((e) => e.told), space: w.spaceNew }] : []),
          ...others.flatMap((m) => (m.look ? [{ machine: m.id, name: m.name, needs: m.look.needsNew, ended: m.look.ended.filter((e) => e.told), space: m.look.spaceNew }] : [])),
        ],
        showing,
      );
      if (!tick) return;
      // A press opens the chat it names, or what came to Your Space (S5b), on the machine it is of — another's in its page
      // in the window —; a note of several machines', the window.
      const route = tick.chat?.chain ? chatRoute({ chain: tick.chat.chain, thread: tick.chat.thread }) : tick.home ? "#/your-space" : null;
      say(tick.note, route, tick.machine);
    } finally {
      watching = false;
    }
  }
  const watches = setInterval(() => void watchLook(), WATCH_MS);
  paintTray();

  /** A chat's turn a stop cuts is taken up again at the next start (V2-6); nothing else is. */
  const CUTS = "a chat's cut turn goes on by itself when Filament starts again; anything else it was doing is cut.";
  /** @param {string} id @param {unknown} [route]  `open`'s: a chat's place in the harness */
  async function act(id, route) {
    if (id === "harness" || id === "dashboard") return void openWindow(id);
    if (id === "open") return void openWindow("harness", harnessRoute(route) || "");
    if (id === "card") return void openCard();
    // A machine's row: the harness window shows it.
    if (id.startsWith("machine:")) return void showMachine(id.slice("machine:".length));
    if (id === "notify") {
      settings = keepSettings(settingsFile, { notify: !settings.notify });
      log.line(`notifications ${settings.notify ? "on" : "off"}`);
      return void paintTray();
    }
    if (id === "updates") {
      settings = keepSettings(settingsFile, { updates: !settings.updates });
      log.line(`updates ${settings.updates ? "on" : "off"}`);
      if (settings.updates) void updater?.look().then(paintTray);
      return void paintTray();
    }
    // Update: the download, or a store's page; Restart to update: a Linux one put in place, then Filament stops as
    // Quit stops it — asked first while it works —, and the rest installs as the app goes.
    if (id === "update-get") return getUpdate();
    if (id === "update") return restartToUpdate();
    if (id === "logon") {
      setLogon(!logonOn());
      log.line(`start at logon ${logonOn() ? "on" : "off"}`);
      return void paintTray();
    }
    if (id === "restart") {
      // What runs as it is asked, for the notification once Filament takes it (a turn that runs refuses it).
      const was = sup.now().state;
      if (was === "up" || was === "late") {
        const live = await ask("/api/live").then((r) => r.json(), () => null);
        restartAsked = { inFlight: (live?.active || []).filter((/** @type {any} */ a) => !a.parentId).length };
      }
      const r = await sup.restart();
      if (!r.ok) restartAsked = null;
      if (r.ok) {
        // Asked again, its port is still another program's: said again (its state did not move, so nothing else says it).
        const n = sup.now();
        if (n.state === "taken" && n.found?.kind === "refuse") sayTaken(n.found.why);
        return;
      }
      if ("unanswered" in r) {
        const { response } = await dialog.showMessageBox({
          type: "warning",
          title: "Filament",
          message: "Filament does not answer",
          detail: `It did not answer the question to restart (${r.note}). Ending it and starting it again: ${CUTS}`,
          buttons: ["End it and start again", "Leave it"],
          defaultId: 1,
          cancelId: 1,
        });
        if (response === 0) await sup.restart({ force: true });
        return;
      }
      await dialog.showMessageBox({ type: "info", title: "Filament", message: "Filament was not restarted", detail: `${r.note}. Restart it once that ends: nothing was cut.`, buttons: ["OK"] });
      return;
    }
    // The tray's Quit installs an update that waits; a --quit launch (the installer's own ask) or a logoff does not —
    // but a Mac's: Squirrel.Mac, handed the update once it was checked, installs it however the app ends.
    if (id === "quit") return quit({ update: owned && settings.updates ? "quiet" : null });
  }
  // Settings › General's Notifications in the harness's window (the design pass of 10-24, UX8): the tray's own check,
  // read — and set, where the page names a choice — from Filament's page there alone. The answer is the app's choice.
  // Settings › Remote access's Add a machine, from Filament's page in a harness window: the harness window's Add sheet.
  ipcMain.on("filament:add-machine", (e) => {
    if (!paneOf(e) || !rail) return;
    const w = windows.get("harness");
    if (w && !w.isDestroyed()) {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    }
    rail.openAdd();
  });
  // Settings › Remote access's other machines, from Filament's page in a harness window alone: each as it stands there,
  // and this Filament's agents let work on one, or not, its models lent here, or not, Full control there, or not, or its
  // agents' device forgotten —
  // the page hears the outcome.
  // Each row carries its browser switch too (b-remote): kept here, its link's state as it stands.
  ipcMain.handle("filament:agent-machines", async (e) => (paneOf(e) ? { machines: (await agentsThere.list()).map((x) => ({ ...x, ...machineBrowsers.rowOf(x.id) })) } : null));
  ipcMain.handle("filament:agents-on", (e, p) => (paneOf(e) ? agentsThere.set(String(p?.id ?? ""), p?.on === true) : null));
  ipcMain.handle("filament:browser-on", (e, p) => (paneOf(e) ? machineBrowsers.set(String(p?.id ?? ""), p?.on === true) : null));
  ipcMain.handle("filament:agents-models", (e, p) => (paneOf(e) ? agentsThere.models(String(p?.id ?? ""), p?.on === true) : null));
  ipcMain.handle("filament:agents-full", (e, p) => (paneOf(e) ? agentsThere.full(String(p?.id ?? ""), p?.on === true) : null));
  ipcMain.handle("filament:agents-forget", (e, id) => (paneOf(e) ? agentsThere.forget(String(id ?? "")) : null));
  // The new-chat menu's other machines (pk-list), from Filament's page in a harness window alone: their names at once,
  // nothing asked of them, then each one's projects, read there with this window's sign-in; a project picked opens that
  // machine's page in the rail at its address.
  ipcMain.handle("filament:machine-names", (e) => (paneOf(e) ? { machines: agentsThere.names() } : null));
  ipcMain.handle("filament:machine-projects", async (e) => (paneOf(e) ? { machines: await agentsThere.projects() } : null));
  ipcMain.handle("filament:open-on", (e, p) => (paneOf(e) && rail ? rail.openOn(String(p?.id ?? ""), String(p?.route ?? "")) : false));
  // The press key (`pressKey`), to Filament's own page in a harness window, or its console in a window of the app, alone:
  // their writes carry it (src/ui/lib/api.js `pressFetch`).
  ipcMain.handle("filament:press-key", (e) => (paneOf(e) || consoleOf(e) ? pressKey : null));
  // Browse… (the owner's of 11-09: on a Mac the server's dialog was Windows' alone): the system's folder dialog, the
  // app's own, over the harness window that asked — so it comes up in front of it, on every system —, for Filament's
  // own page alone; null for any other, which asks the server's (src/http/admin/files.js).
  ipcMain.handle("filament:pick-folder", async (e) => {
    const w = paneOf(e);
    if (!w) return null;
    try {
      const r = await dialog.showOpenDialog(w, { title: "Pick a project folder", properties: ["openDirectory", "createDirectory"] });
      return r.canceled || !r.filePaths?.[0] ? { ok: false, cancelled: true } : { ok: true, path: r.filePaths[0] };
    } catch (/** @type {any} */ err) {
      return { ok: false, reason: String(err?.message || err) };
    }
  });
  // The harness's update notice (src/ui/harness/lib/update-notice.js): where it stands, and its two buttons — Update
  // (the download, or a store's page) and Restart to update — from Filament's own page alone.
  ipcMain.handle("filament:update", (e) => (paneOf(e) ? updateView() : null));
  ipcMain.handle("filament:update-act", (e, what) => {
    if (!paneOf(e)) return false;
    void (what === "restart" ? restartToUpdate() : getUpdate());
    return true;
  });
  // Settings › About's Check now (the owner's of 11-08): a look at once, rather than at the next one by itself — while
  // the tray's Check for updates is off too —, and what it found. A newer one moves the notice as a look's always does.
  ipcMain.handle("filament:update-check", async (e) => {
    if (!paneOf(e)) return null;
    if (!updater) return { result: "checkout" };
    if (!owned) return { result: "attached" };
    return updater.look(true);
  });
  ipcMain.handle("filament:notify", (e, want) => {
    if (!paneOf(e)) return null;
    // `act`'s turn of the check runs before its first wait: the choice is kept and the tray painted by the answer.
    if (typeof want === "boolean" && want !== settings.notify) void act("notify");
    return settings.notify;
  });

  /** The Quit under way: a second Quit (the tray's, a `--quit` launch) while it asks joins it. @type {Promise<void> | null} */
  let leaving = null;
  /** The update a Quit under way installs as the app goes: with the app started after, or not. @type {"restart" | "quiet" | null} */
  let updateAs = null;
  /**
   * Quit: Filament is stopped where the app started it — asked first while it works, never cut unasked. `update`: the
   * update fetched installs once it has stopped (a Quit the person took back installs nothing).
   * @param {{ update?: "restart" | "quiet" | null }} [o]
   */
  function quit({ update = null } = {}) {
    if (update && updateAs !== "restart") updateAs = update;
    if (!leaving) leaving = leave().finally(() => ((leaving = null), (updateAs = null)));
    return leaving;
  }
  /**
   * Filament stopped where the app started it — asked first while it works, never cut unasked: → whether it stopped
   * (Keep it running → false). One stopped already stops at once.
   */
  async function stopAsked() {
    if (!owned) return true;
    const r = await sup.stop();
    if (r.ok) return true;
    const { response } = await dialog.showMessageBox({
      type: "warning",
      title: "Filament",
      message: "unanswered" in r ? "Filament does not answer" : "Filament is still working",
      detail: `${"unanswered" in r ? `It did not answer the question to stop (${r.note})` : r.note}. Quitting stops it now: ${CUTS}`,
      buttons: ["Keep it running", "Quit anyway"],
      defaultId: 0,
      cancelId: 0,
    });
    if (response !== 1) return false;
    await sup.stop({ force: true });
    return true;
  }
  async function leave() {
    if (quitting) return;
    if (!(await stopAsked())) return;
    quitting = true;
    tunnels.close();
    updater?.stop();
    const squirrel = updateAs ? installUpdate(updateAs === "restart") : false;
    clearInterval(sampling);
    clearInterval(looks);
    clearInterval(watches);
    if (soon) clearTimeout(soon);
    link.stop();
    pages.destroy();
    machineBrowsers.destroy();
    desk.close();
    card?.destroy();
    tray.destroy();
    // A Mac's Restart to update ends the app by Squirrel.Mac, which installs the new one and starts it; where Squirrel
    // fails instead, the app ends as a Quit does — its tray and Filament are gone by now — and the update waits.
    if (squirrel) {
      autoUpdater.once("error", () => app.quit());
      autoUpdater.quitAndInstall();
    } else app.quit();
  }

  // Closing every window leaves Filament serving your agents: the tray brings a window back.
  app.on("window-all-closed", () => {});
  // However the app ends, no ssh of its is left holding a tunnel.
  app.on("will-quit", () => tunnels.close());
  app.on("before-quit", (e) => {
    if (quitting) return;
    e.preventDefault();
    void quit();
  });

  // The link tries until Filament takes it: at once where the app attached, as soon as its own Filament answers.
  link.start();
  updater?.start();
  if (owned) sup.start();
  // The harness shows at once — while its own Filament starts, with the app's page saying so — unless the app started
  // hidden (tray only, as at logon).
  if (!process.argv.includes("--hidden")) openWindow("harness");
  // What later launches asked meanwhile, and from now on: a double-click while Filament starts brings its window forward.
  // The log says whether it found the window open or made one, and how it stands a moment later.
  launched = (argv) => {
    if (argv.includes("--quit")) return void quit();
    if (argv.includes("--card")) return void openCard();
    const had = windows.get("harness");
    const found = !!had && !had.isDestroyed();
    const w = openWindow("harness", "", { launch: true });
    log.line(`a launch asked for the harness window: ${found ? "found it open" : "made one"}`);
    setTimeout(() => {
      if (w.isDestroyed()) return;
      log.line(`a launch's harness window a moment on: ${w.isVisible() ? "visible" : "hidden"}, ${w.isFocused() ? "focused" : "not focused"}${w.isMinimized() ? ", minimized" : ""}${w.isMaximized() ? ", maximized" : ""}, its page ${w.webContents.mainFrame?.visibilityState || "unknown"}`);
    }, 1500).unref?.();
  };
  for (const argv of early.splice(0)) launched(argv);
  // macOS starts no second copy: the app opened again from the Finder, or its Dock icon clicked, while no window of it
  // shows, asks as a second launch does. Heard once the start has opened its window or not.
  app.on("activate", (_e, hasVisibleWindows) => {
    if (!hasVisibleWindows) launched([]);
  });
}
