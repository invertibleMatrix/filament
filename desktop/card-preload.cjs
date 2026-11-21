// The tray card's bridge (HarnessV3-Native NA-D9): what the card's page may ask of the app — one of its acts (open the
// harness or the dashboard, a chat of its Now in the harness, Restart, hide the card) — the app's word on its Filament as it moves, and the card's theme,
// for the page the app draws while Filament gives none. Given to the card's window alone; the app hears an act only from
// Filament's own page there (lib/card.js `cardHears`). CommonJS: a sandboxed preload is no module.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("filamentDesktop", {
  /** @param {string} id @param {string} [route]  `open`'s: the chat's place in the harness */
  act: (id, route) => ipcRenderer.send("filament:card-act", String(id), route == null ? undefined : String(route)),
  /** @param {(facts: unknown) => void} fn */
  onState: (fn) => {
    ipcRenderer.on("filament:card-state", (_e, facts) => fn(facts));
    ipcRenderer.send("filament:card-ready");
  },
  /** @param {{ light: boolean }} look */
  look: (look) => ipcRenderer.send("filament:card-look", { light: !!(look && look.light) }),
});
