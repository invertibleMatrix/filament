// The app's page's bridge (the owner's remote Filament of 11-06, Part 3; the popover in the rail's place since the
// owner's of 11-08): what that page may ask of the app — a machine picked in the popover, the popover closed, a
// machine's menu, the Add sheet's steps and its tailnet's machines — and its state as it moves. Given to the app's page's
// own view alone (rail.html); the app hears it only from there (lib/rail.js `hears`). No machine's page has it.
// CommonJS: a sandboxed preload is no module.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("filamentRail", {
  /** A machine picked in the popover: shown, the popover closed. @param {string} id  `local` for this computer */
  select: (id) => ipcRenderer.send("filament:rail-select", String(id)),
  /** The popover closed: Escape, a press outside it. */
  close: () => ipcRenderer.send("filament:rail-close"),
  /** A machine's own menu, at the pointer. @param {string} id */
  menu: (id) => ipcRenderer.send("filament:rail-menu", String(id)),
  /** The Add sheet opened over the window. */
  openAdd: () => ipcRenderer.send("filament:rail-add-open"),
  /** The Add sheet closed. */
  closeAdd: () => ipcRenderer.send("filament:rail-add-close"),
  /** Update all machines: every machine's Filament older than this app updated to its version, asked first. */
  updateAll: () => ipcRenderer.send("filament:rail-update-all"),
  /**
   * One step of the Add sheet — `check` who answers at the address, `pair` with the code — answered by the app.
   * `expect`: at Pair, the machine Continue showed — another answering there now is refused (lib/rail.js `add`).
   * @param {{ op: string, link: string, code: string, fingerprint: string, expect?: string }} input @returns {Promise<any>}
   */
  add: (input) =>
    ipcRenderer.invoke("filament:rail-add", {
      op: String(input?.op || ""),
      link: String(input?.link || ""),
      code: String(input?.code || ""),
      fingerprint: String(input?.fingerprint || ""),
      ...(input?.expect ? { expect: String(input.expect) } : {}),
    }),
  /** The machines of this computer's tailnet that answer as a Filament, for the Add sheet (lib/rail.js `tailnet`). @returns {Promise<any>} */
  tailnet: () => ipcRenderer.invoke("filament:rail-tailnet"),
  /** @param {(state: unknown) => void} fn */
  onState: (fn) => {
    ipcRenderer.on("filament:rail-state", (_e, state) => fn(state));
    ipcRenderer.send("filament:rail-ready");
  },
});
