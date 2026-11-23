// Another machine's page's bridges (the owner's of 11-08: a switcher in the top bar in the rail's place): what its
// chip left of Changes hears — the machine it is, its state, how many chats wait on you on the others, whether the
// popover is open, and the room the window's controls take over its top row — and its press, which opens the app's own
// popover under it; the colours it asks the window's controls to wear while it shows; and, showing a chat alone beside
// This computer's list (the remote desk of 11-22), its way to its whole page and the keys it hands that list, by their
// shortcut's id — never the list's words, nor any of This computer's state. The same `filamentMachines`
// This computer's page has (harness-preload.cjs), so one chip serves both. And its Browser pane's `filamentBrowser`
// (b-remote), the shape This computer's page has: a chat's page this app holds for that machine — its browser switched
// on in Settings › Remote access — drawn over the pane, parked, and the developer's hand on it; a tab the app holds
// not is refused, and the pane shows the page as that machine casts it. Nothing else of the app's: no other machine's
// name, no other bridge (lib/rail.js). Given to the machines' views alone; the app hears it only from the view
// showing's main frame (lib/rail.js `hearsPage`, `machinePane`). CommonJS: a sandboxed preload is no module.
const { contextBridge, ipcRenderer } = require("electron");

const rectOf = (r) => ({ x: Number(r?.x) || 0, y: Number(r?.y) || 0, width: Number(r?.width) || 0, height: Number(r?.height) || 0 });

// Its page came to a new address of its machine's — opened, or moved to a better way (lib/rail.js `carryFor`): what it
// kept for this tab where it was — its drafts, its queued messages, the lines waiting for its server — put in place
// here before its own scripts run, else nothing; whatever this address kept from an earlier visit is let go, so nothing
// sent since comes back. A reload at the same address keeps its own.
try {
  const carried = ipcRenderer.sendSync("filament:machines-carry");
  if (Array.isArray(carried)) {
    sessionStorage.clear();
    for (const [k, v] of carried) sessionStorage.setItem(String(k), String(v));
  }
} catch {}

contextBridge.exposeInMainWorld("filamentMachines", {
  /** The popover opened under the chip, at its rectangle in the page's pixels. @param {{ x: number, y: number, width: number, height: number }} rect */
  open: (rect) => ipcRenderer.send("filament:machines-open", rectOf(rect)),
  /**
   * The chip's state as it moves, and once now: `{ shown, name, status, waiting, open, frame }`.
   * @param {(state: any) => void} fn @returns {() => void}  stops hearing it
   */
  onState: (fn) => {
    const heard = (_e, s) => fn(s);
    ipcRenderer.on("filament:machines", heard);
    ipcRenderer.send("filament:machines-ready");
    return () => ipcRenderer.removeListener("filament:machines", heard);
  },
  /** The colours of the page's top row, which the window's controls wear while it shows: two #rrggbb. @param {{ color: string, symbolColor: string }} c */
  titleBar: (c) => ipcRenderer.send("filament:machines-title-bar", { color: String(c?.color || ""), symbolColor: String(c?.symbolColor || "") }),
  /**
   * The page shows its chat alone, beside This computer's list (src/ui/harness/lib/chat-only.js): this machine's whole
   * page shown in the window at an address of its harness (`#/…`), the screen asked for there. @param {string} route
   */
  full: (route) => ipcRenderer.send("filament:machines-full", String(route ?? "").slice(0, 2000)),
  /** A key of This computer's list pressed in the chat shown alone, by its shortcut's id (chat-only.js `DESK_KEYS`): its page runs it. @param {string} id */
  deskKey: (id) => ipcRenderer.send("filament:machines-key", String(id ?? "").slice(0, 40)),
  /**
   * The app's update page's acts (lib/rail.js `updatePage`): Open its page, or Update this app; `install`, Update
   * Filament on it. @param {string} [how]
   */
  update: (how) => ipcRenderer.send("filament:machines-update", ...(how === "install" ? ["install"] : [])),
});

contextBridge.exposeInMainWorld("filamentBrowser", {
  /**
   * The tab's page over the pane: true once it is there, false where the app holds no such tab of this machine's.
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
  /** Every page this machine's view shows, parked again. */
  park: () => ipcRenderer.send("filament:browser-park"),
  /**
   * The developer's hand on the page, as the app says it: `{ state: "take" | "held" | "away" | "over", tab, left? }`.
   * @param {(m: any) => void} fn @returns {() => void}  stops hearing it
   */
  onHand: (fn) => {
    const heard = (_e, m) => fn(m);
    ipcRenderer.on("filament:browser-hand", heard);
    return () => ipcRenderer.removeListener("filament:browser-hand", heard);
  },
  /** The hold ended at the pane (Give back): the app stops watching the pointer. */
  handOff: () => ipcRenderer.send("filament:browser-hand-off"),
});
