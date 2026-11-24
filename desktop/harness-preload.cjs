// The harness window's bridge (HarnessV4_Browser_Plan BR3, BR-D11): the Browser pane puts the chat's page — a view the
// app holds (lib/browser-host.js) — over itself while it shows, at the rectangle it measures, and parks it when it
// hides or something of the harness's own comes over it. While an agent drives the page the pane asks for it locked
// (HarnessV4_BrowserSize_Plan BS3): the app's veil over it, and the developer's hand on it said back to the pane —
// taken, held, away with the seconds left, over. Given to the harness's windows alone — its own and a popped pane's
// (BS4); the app hears it only from Filament's own page there (lib/browser-host.js `paneHears`). CommonJS: a sandboxed
// preload is no module.
const { contextBridge, ipcRenderer } = require("electron");

/** The fields a desk operation may carry (desktop/lib/desk.js `OPS`, which checks each again). */
const DESK_FIELDS = ["op", "machine", "chat", "q", "after", "cwd", "title", "model", "mode", "content", "ask", "allow", "choice", "words"];
/** A rectangle as plain numbers. @param {any} r */
const rectOf = (r) => ({ x: Number(r?.x) || 0, y: Number(r?.y) || 0, width: Number(r?.width) || 0, height: Number(r?.height) || 0 });

contextBridge.exposeInMainWorld("filamentBrowser", {
  /**
   * The tab's page over the pane: true once it is there, false where the app has no such tab.
   * @param {string} tab @param {{ x: number, y: number, width: number, height: number }} rect  the pane's, in CSS pixels
   * @param {{ lock?: boolean }} [o]  `lock`: an agent drives it — the veil over it
   * @returns {Promise<boolean>}
   */
  place: (tab, rect, o) =>
    ipcRenderer.invoke("filament:browser-place", {
      tab: String(tab),
      rect: rect ? { x: Number(rect.x), y: Number(rect.y), width: Number(rect.width), height: Number(rect.height) } : null,
      lock: o?.lock === true,
    }),
  /** Every page the window shows, parked again. */
  park: () => ipcRenderer.send("filament:browser-park"),
  /**
   * The developer's hand on the page, as the app says it: `{ state: "take" | "held" | "away" | "over", tab, left? }`.
   * @param {(m: any) => void} fn @returns {() => void}  stops hearing it
   */
  onHand: (fn) => {
    const heard = (/** @type {any} */ _e, /** @type {any} */ m) => fn(m);
    ipcRenderer.on("filament:browser-hand", heard);
    return () => ipcRenderer.removeListener("filament:browser-hand", heard);
  },
  /** The hold ended at the pane (Give back): the app stops watching the pointer. */
  handOff: () => ipcRenderer.send("filament:browser-hand-off"),
});

// The app's own choices that the harness's Settings shows (the design pass of 10-24, UX8): its notifications, the
// tray's Notifications check; and the machines its window drives (the owner's remote Filament of 11-06, Part 3).
contextBridge.exposeInMainWorld("filamentApp", {
  /**
   * Whether the app shows its notifications; with `on`, that choice made first. Null where the app does not answer.
   * @param {boolean} [on] @returns {Promise<boolean | null>}
   */
  notify: (on) => ipcRenderer.invoke("filament:notify", typeof on === "boolean" ? on : null),
  /**
   * The colours of the page's top row, which Windows' controls over it wear where the page is the window's title bar
   * (lib/frame.js): two #rrggbb.
   * @param {{ color: string, symbolColor: string }} c
   */
  titleBar: (c) => ipcRenderer.send("filament:title-bar", { color: String(c?.color || ""), symbolColor: String(c?.symbolColor || "") }),
  /** Settings › Remote access's Add a machine: the app's Add sheet opened over the harness's window (lib/rail.js). */
  addMachine: () => ipcRenderer.send("filament:add-machine"),
  /**
   * One step of setting up a machine over SSH (lib/setup-over-ssh.js): `{ alias, step, latest? }` → how it went
   * (`StepResult`). Null where the app does not answer this page. @param {{ alias: string, step: string, latest?: boolean }} input
   */
  sshSetup: (input) => ipcRenderer.invoke("filament:ssh-setup", { alias: String(input?.alias ?? ""), step: String(input?.step ?? ""), ...(input?.latest === true ? { latest: true } : {}) }),
  /**
   * The Add sheet's Set up Filament over SSH, heard: the setup sheet opened with the host typed there; → a function that
   * stops hearing it. @param {(p: { alias: string }) => void} fn
   */
  onSshSetup: (fn) => {
    const heard = (_e, p) => fn({ alias: String(p?.alias ?? "") });
    ipcRenderer.on("filament:ssh-setup-open", heard);
    return () => ipcRenderer.removeListener("filament:ssh-setup-open", heard);
  },
  /**
   * Settings › Remote access's other machines (the remote-agents plan's f-ui): each this window keeps, and whether this
   * Filament's agents may work there, as that machine says — read by the app with its sign-in there, which this page
   * never holds (lib/machine-agents.js `AgentsRow`). @returns {Promise<{ machines: any[] } | null>}
   */
  agentMachines: () => ipcRenderer.invoke("filament:agent-machines"),
  /** This Filament's agents let work on a machine, or not: → the machine as it stands after. @param {string} id @param {boolean} on */
  agentsOn: (id, on) => ipcRenderer.invoke("filament:agents-on", { id: String(id), on: on === true }),
  /**
   * A machine lends this Filament its models, or not — its agents' device's grant `models` there: → the machine as it
   * stands after. @param {string} id @param {boolean} on
   */
  agentsModels: (id, on) => ipcRenderer.invoke("filament:agents-models", { id: String(id), on: on === true }),
  /**
   * Full control on a machine, or not — its agents' device's grant `full` there, on top of Agents: this Filament's agents
   * act there as you: → the machine as it stands after. @param {string} id @param {boolean} on
   */
  agentsFull: (id, on) => ipcRenderer.invoke("filament:agents-full", { id: String(id), on: on === true }),
  /** Forget: this Filament's agents' device revoked on that machine, its token let go here. @param {string} id */
  agentsForget: (id) => ipcRenderer.invoke("filament:agents-forget", String(id)),
  /**
   * Copy keys: your providers named (by their ids here) have their keys copied to that machine by the app, as your full
   * device there — this page names them and never holds a key: → the machine as it stands after, and how each went
   * (`copied`). @param {string} id @param {string[]} ids
   */
  copyKeys: (id, ids) => ipcRenderer.invoke("filament:keys-copy", { id: String(id), ids: Array.isArray(ids) ? ids.map(String) : [] }),
  /**
   * The new-chat menu's other machines (pk-list): each this window keeps, with its projects as that machine lists them,
   * read by the app with its sign-in there; null and why where they could not be read (lib/machine-agents.js
   * `ProjectsRow`). @returns {Promise<{ machines: any[] } | null>}
   */
  machineProjects: () => ipcRenderer.invoke("filament:machine-projects"),
  /** The new-chat menu's other machines by their id and name, nothing asked of them: its rows at the press. @returns {Promise<{ machines: { id: string, name: string }[] } | null>} */
  machineNames: () => ipcRenderer.invoke("filament:machine-names"),
  /**
   * A machine's page opened in the rail at an address of its page (`#/new/<folder>`, a new chat in that folder there):
   * → whether it opened. @param {string} id @param {string} route
   */
  openOn: (id, route) => ipcRenderer.invoke("filament:open-on", { id: String(id), route: String(route) }),
  /**
   * A machine let use this app's browser, or not (b-remote): the agent's pages for your chats there open in this app —
   * kept by the app, its link made or let go: → the machine's row after (lib/machine-browser.js `BrowserRow`).
   * @param {string} id @param {boolean} on
   */
  browserOn: (id, on) => ipcRenderer.invoke("filament:browser-on", { id: String(id), on: on === true }),
  /**
   * A machine's browser link as its state moves — up, down, refused —: its row (lib/machine-browser.js `BrowserRow`).
   * @param {(row: any) => void} fn @returns {() => void}  stops hearing it
   */
  onBrowserLink: (fn) => {
    const heard = (_e, row) => fn(row);
    ipcRenderer.on("filament:browser-link", heard);
    return () => ipcRenderer.removeListener("filament:browser-link", heard);
  },
  /**
   * The room the window's controls take over the page's top row, in its pixels — its Window Controls Overlay's — lent to
   * the other machines' pages, which cannot read it (lib/rail.js `lentFrame`). @param {{ left: number, right: number }} r
   */
  frameArea: (r) => ipcRenderer.send("filament:frame-area", { left: Number(r?.left) || 0, right: Number(r?.right) || 0 }),
  /**
   * Where the app's update stands, for the sidebar's notice (desktop/lib/updates.js UpdateState); null where there is
   * none to offer. @returns {Promise<any>}
   */
  update: () => ipcRenderer.invoke("filament:update"),
  /** The notice's buttons: "get" — Update: the download, or a store's page — and "restart", Restart to update. @param {"get" | "restart"} what */
  updateAct: (what) => ipcRenderer.invoke("filament:update-act", what === "restart" ? "restart" : "get"),
  /**
   * Settings › About's Check now: a look for a newer Filament at once, → what it found (desktop/lib/updates.js `Looked`),
   * `checkout` where the app runs from its code folder, `attached` where it shows a Filament it did not start.
   * @returns {Promise<any>}
   */
  checkUpdates: () => ipcRenderer.invoke("filament:update-check"),
  /** Each move of the update, as it comes; → a function that stops hearing it. @param {(s: any) => void} fn */
  onUpdate: (fn) => {
    const heard = (_e, s) => fn(s);
    ipcRenderer.on("filament:update", heard);
    return () => ipcRenderer.removeListener("filament:update", heard);
  },
  /**
   * The key this computer's presses carry while the app runs (src/http/guards.js `pressRefusal`), which the page's writes
   * send (src/ui/harness/lib/api.js): the app hands it to Filament's own page alone. Null where it does not answer.
   * @returns {Promise<string | null>}
   */
  pressKey: () => ipcRenderer.invoke("filament:press-key"),
  /**
   * Browse…: the system's folder dialog, the app's own over this window, on every system (the owner's of 11-09: a Mac's
   * page had none) — `{ ok: true, path }`, `{ ok: false, cancelled: true }`, or `{ ok: false, reason }` where it could
   * not open. Null where the app does not answer this page (src/ui/harness/lib/api.js `pickFolderNative`).
   * @returns {Promise<{ ok: boolean, path?: string, cancelled?: boolean, reason?: string } | null>}
   */
  pickFolder: () => ipcRenderer.invoke("filament:pick-folder"),
});

// The machine chip left of Changes (the owner's of 11-08, in the rail's place): what it hears — shown once another
// machine is kept, This computer's name, state, colour and icon, how many chats wait on you on the others, whether its
// popover is open — and its press, the app's popover under it (lib/rail.js). Another machine's page has the same, alone
// (machine-preload.cjs). And the desk (the remote desk of 11-22), This computer's page's alone: every other machine's
// Now and chats, which another machine's page never hears.
contextBridge.exposeInMainWorld("filamentMachines", {
  /** The popover opened under the chip, at its rectangle in the page's pixels. @param {{ x: number, y: number, width: number, height: number }} rect */
  open: (rect) =>
    ipcRenderer.send("filament:machines-open", { x: Number(rect?.x) || 0, y: Number(rect?.y) || 0, width: Number(rect?.width) || 0, height: Number(rect?.height) || 0 }),
  /** The chip's state as it moves, and once now. @param {(state: any) => void} fn @returns {() => void}  stops hearing it */
  onState: (fn) => {
    const heard = (/** @type {any} */ _e, /** @type {any} */ s) => fn(s);
    ipcRenderer.on("filament:machines", heard);
    ipcRenderer.send("filament:machines-ready");
    return () => ipcRenderer.removeListener("filament:machines", heard);
  },
  /**
   * The desk as it moves, and once now: This computer as it wears itself (`here`: its colour and icon), and each other
   * machine kept — its id, name, state, whether it signed this window out, its colour and icon, its Now's rows
   * (`rows`: needs, works, done) and its chats, the newest first (`recent`) — as the app's watch last found them
   * (desktop/lib/watch.js). @param {(desk: any) => void} fn @returns {() => void}  stops hearing it
   */
  onDesk: (fn) => {
    let live = true;
    const heard = (/** @type {any} */ _e, /** @type {any} */ d) => fn(d);
    ipcRenderer.on("filament:desk", heard);
    void ipcRenderer.invoke("filament:desk").then((d) => void (live && d && fn(d)), () => {});
    return () => {
      live = false;
      ipcRenderer.removeListener("filament:desk", heard);
    };
  },
  /**
   * Chats of another machine's marked seen there — the desk's Done cleared —, as its own page marks them: their unread
   * mark goes, and nothing else. @param {string} id  the machine @param {string[]} chains  its chats' ids there
   */
  seen: (id, chains) => ipcRenderer.invoke("filament:desk-seen", { id: String(id), chains: Array.isArray(chains) ? chains.slice(0, 50).map(String) : [] }),
  /**
   * One of the desk's operations on another machine, made by the app as its sign-in there (desktop/lib/desk.js `OPS`):
   * `{ op, machine, … }` — its chats, a search, its holders, a chat's asks or live state; a new chat, a turn, an answer,
   * a stop, a mode. → what came of it (desk.js `DeskAnswer`). Its fields alone go, as plain values.
   * @param {any} p @returns {Promise<any>}
   */
  call: (p) => {
    /** @type {Record<string, string | boolean>} */
    const q = {};
    for (const k of DESK_FIELDS) {
      const v = p?.[k];
      if (typeof v === "string" || typeof v === "boolean") q[k] = v;
      else if (typeof v === "number" && Number.isFinite(v)) q[k] = String(v);
    }
    return ipcRenderer.invoke("filament:desk-call", q);
  },
  /**
   * Each frame of the other machines' events streams the desk reads, as it comes (desk.js `DeskFrame`): a stream joined
   * or lost, a turn's start or end, a chat's writer, an ask. @param {(frame: any) => void} fn @returns {() => void}  stops hearing it
   */
  onEvent: (fn) => {
    const heard = (/** @type {any} */ _e, /** @type {any} */ f) => fn(f);
    ipcRenderer.on("filament:desk-event", heard);
    return () => ipcRenderer.removeListener("filament:desk-event", heard);
  },
  /**
   * Another machine's chat shown in place over the page's column beside its list (lib/rail.js `showChat`): `{ machine,
   * route, rect, theme, focus }`, the rectangle in the page's pixels, the look light or dark, `focus` the keys its. →
   * whether it shows. @param {any} p @returns {Promise<boolean>}
   */
  showChat: (p) =>
    ipcRenderer.invoke("filament:desk-show", { machine: String(p?.machine ?? ""), route: String(p?.route ?? ""), rect: rectOf(p?.rect), theme: p?.theme === "light" ? "light" : "dark", focus: p?.focus === true }),
  /**
   * The chat shown in place moved with the column, or out of sight while something of the page lies over it (null);
   * `keys`: the keys its again. @param {any} rect @param {boolean} [keys]
   */
  placeChat: (rect, keys) => ipcRenderer.send("filament:desk-place", rect ? rectOf(rect) : null, keys === true),
  /** The chat shown in place let go: the column the page's own again. */
  hideChat: () => ipcRenderer.send("filament:desk-hide"),
  /**
   * The chat shown in place as its page goes — `{ id, hash }`: the machine, its page's address, null as it stops showing
   * there. @param {(g: any) => void} fn @returns {() => void}  stops hearing it
   */
  onGuest: (fn) => {
    const heard = (/** @type {any} */ _e, /** @type {any} */ g) => fn({ id: String(g?.id ?? ""), hash: typeof g?.hash === "string" ? g.hash : null });
    ipcRenderer.on("filament:desk-guest", heard);
    return () => ipcRenderer.removeListener("filament:desk-guest", heard);
  },
  /** A key the chat shown in place hands the page, by its shortcut's id (lib/chat-only.js `DESK_KEYS`). @param {(id: string) => void} fn @returns {() => void}  stops hearing it */
  onKey: (fn) => {
    const heard = (/** @type {any} */ _e, /** @type {any} */ id) => fn(String(id));
    ipcRenderer.on("filament:desk-key", heard);
    return () => ipcRenderer.removeListener("filament:desk-key", heard);
  },
});

// Pop out (HarnessV4_BrowserSize_Plan BS4): a tile's pane in a window of its own — the harness page showing that one
// tab —, brought back by closing it; every harness window hears which tabs are out.
contextBridge.exposeInMainWorld("filamentPanes", {
  /**
   * A tab in a window of its own, at a chat's route — or, out already, its window shown.
   * @param {string} tab @param {string} route @returns {Promise<boolean>}
   */
  popOut: (tab, route) => ipcRenderer.invoke("filament:pop-out", { tab: String(tab), route: String(route || "") }),
  /** A tab's window closed: the pane back in the main window. @param {string} tab */
  bringBack: (tab) => ipcRenderer.send("filament:pop-back", String(tab)),
  /** The tabs out now. @returns {Promise<string[]>} */
  popped: () => ipcRenderer.invoke("filament:pop-list"),
  /** @param {(tabs: string[]) => void} fn @returns {() => void}  stops hearing it */
  onPopped: (fn) => {
    const heard = (/** @type {any} */ _e, /** @type {any} */ tabs) => fn(Array.isArray(tabs) ? tabs.map(String) : []);
    ipcRenderer.on("filament:popped", heard);
    return () => ipcRenderer.removeListener("filament:popped", heard);
  },
});
