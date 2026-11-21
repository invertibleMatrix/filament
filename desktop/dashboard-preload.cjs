// The dashboard window's bridge: the press key alone (main.js `filament:press-key`), which the console's writes carry
// (src/ui/lib/api.js `pressFetch`) — a mode or a rule that lets the agent do more unasked is a press while the app runs
// (src/http/guards.js `pressRefusal`). The app hands it only to Filament's own page there (lib/browser-host.js
// `paneHears`). CommonJS: a sandboxed preload is no module.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("filamentApp", {
  /** The key this computer's presses carry while the app runs; null where the app gives none. @returns {Promise<string | null>} */
  pressKey: () => ipcRenderer.invoke("filament:press-key"),
});
