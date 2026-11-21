// @ts-check
// Start at logon (HarnessV3-Native NA-D10): the system's own login item starts the app hidden — the tray alone, Filament
// running —, the installed app or a checkout (Electron over it), with the data folder and port it was given. Plain
// Node (NA-D13): the login item's read and write come in from main.js (Electron's), so no test touches the system's.

/**
 * What the login item starts: the app's exe, and what it is given — a checkout's main script first (the exe is
 * Electron's own then), `--hidden`, and the data folder and port where the app was started with them.
 * @param {{ exe: string, packaged: boolean, main: string, dataDir?: string, port?: string }} o
 * @returns {{ path: string, args: string[] }}
 */
export function logonItem({ exe, packaged, main, dataDir, port }) {
  return { path: exe, args: [...(packaged ? [] : [main]), "--hidden", ...(dataDir ? ["--data-dir", dataDir] : []), ...(port ? ["--port", port] : [])] };
}

/** The app's id to Windows (its taskbar button, the name of its login item): the installed app's, or a checkout's. @param {boolean} checkout */
export const appIdOf = (checkout) => (checkout ? "com.filamentdev.desktop.dev" : "com.filamentdev.desktop");

/** The id each had before com.filamentdev.desktop (the owner's of 11-07), whose login item Windows still keeps under it. @param {boolean} checkout */
export const oldAppIdOf = (checkout) => (checkout ? "filament.desktop.dev" : "filament.desktop");

/**
 * The login item Windows keeps under the app's old id, of those `getLoginItemSettings().launchItems` lists — moved to
 * the new id once, so Start at logon's check turns off the one that starts the app — or none.
 * @param {unknown} items @param {string} oldId @returns {{ name: string, enabled: boolean } | null}
 */
export function oldLogonEntry(items, oldId) {
  const found = Array.isArray(items) ? items.find((i) => i && i.name === oldId) : null;
  return found ? { name: oldId, enabled: found.enabled !== false } : null;
}
