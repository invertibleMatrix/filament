// The veil's bridge (HarnessV4_BrowserSize_Plan BS3): the see-through page the app lays over an agent's page while it
// drives (lib/browser-host.js `VEIL_PAGE`) says one thing — its Take over was pressed — and the app hears it only from
// a veil of its own (`veilPressed`). CommonJS: a sandboxed preload is no module.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("filamentVeil", {
  /** The developer pressed Take over on the page. */
  take: () => ipcRenderer.send("filament:veil-take"),
});
