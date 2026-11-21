// @ts-check
// The desktop app's tray, as data (HarnessV3-Native NA-D9, NA-D10): its menu and its tooltip for the state the app is
// in — the card, the windows, each machine of the harness window, Restart, an update to restart into, start at logon, the
// notifications, updating itself, Quit; the tooltip also how many chats need you
// (NA3b), on every machine. Plain Node (NA-D13); main.js turns the
// rows into Electron's menu.

/**
 * @typedef {{ id: string, label: string, enabled?: boolean, checked?: boolean } | { type: "separator" }} TrayRow
 *   `checked`: a row that is on or off
 * @typedef {{ id: string, name: string, local?: boolean, status: import("./machines.js").MachineStatus, refused?: boolean, needs: number }} MachineRow
 *   a machine of the harness window as the watch last saw it (lib/watch.js): This computer (`local`) or another, its state, whether
 *   it refuses this window's sign-in, and how many of its chats wait on you
 * @typedef {{ owned: boolean, state: import("./supervisor.js").State | "attached", port: number, gone?: boolean, logonOn?: boolean | null, notify?: boolean, needs?: number, machines?: readonly MachineRow[], updates?: boolean | null, update?: import("./updates.js").UpdateState | null }} TrayFacts
 *   `owned`: the app started this Filament (else it attached to one already running); `gone`: attached, and that Filament
 *   does not answer; `logonOn`: the app starts at logon (null: the system has no login item to set); `notify`: it shows notifications; `needs`: the harness's chats
 *   that wait on you (lib/watch.js); `machines`: each machine of the harness window, This computer first — its rows and its counts,
 *   where any is kept beside it; `updates`: the installed app looks for its updates (null: not offered, as from a
 *   checkout); `update`: where its updater stands, where it offers one (lib/updates.js) — the row the harness's notice
 *   has beside it
 */

/** @param {unknown} s @param {number} n */
const cut = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
/** A count of chats that wait on you. @param {number} n */
const needWords = (n) => `${n} chat${n === 1 ? " needs" : "s need"} you`;
/** @param {unknown} n */
const count = (n) => Math.max(0, Math.floor(Number(n) || 0));

/**
 * A machine's row in the tray: its name, and how many of its chats wait on you, or why it is not watched. Pressed, the
 * harness window shows it.
 * @param {MachineRow} m @returns {TrayRow}
 */
const machineRow = (m) => {
  const n = count(m.needs);
  const how = m.status === "disconnected" ? "disconnected" : m.refused ? "signed out here" : m.status === "offline" ? "offline" : m.status === "reconnecting" ? "reconnecting" : n ? needWords(n) : "";
  return { id: `machine:${m.id}`, label: `${cut(m.name, 40)}${how ? ` — ${how}` : ""}` };
};

/** What a store's build updates from, by its kind. @type {Record<string, string>} */
const STORES = { "mac-store": "the App Store", "windows-store": "the Microsoft Store" };

/**
 * The update's row, as its notice has it (the owner's of 11-07: nothing fetched until asked, asked again before it
 * installs): Update to fetch it — a store's opens its store, a page's the release —, its download under way, Restart to
 * update once it is in. @param {import("./updates.js").UpdateState | null | undefined} u @returns {TrayRow[]}
 */
export function updateRows(u) {
  if (!u || u.phase === "none") return [];
  const v = u.version;
  if (u.phase === "ready") return [{ id: "update", label: `Restart to update to Filament ${v}` }];
  if (u.phase === "downloading") return [{ id: "update-get", label: `Downloading Filament ${v}…${u.size ? ` ${Math.floor((u.received / u.size) * 100)}%` : ""}`, enabled: false }];
  if (STORES[u.kind]) return [{ id: "update-get", label: `Update to Filament ${v} in ${STORES[u.kind]}` }];
  if (u.kind === "page") return [{ id: "update-get", label: `See Filament ${v}'s release` }];
  return [{ id: "update-get", label: `Update to Filament ${v}${u.phase === "failed" ? " (try again)" : ""}` }];
}

/** @param {TrayFacts} f @returns {TrayRow[]} */
export function trayRows(f) {
  const machines = f.machines && f.machines.length > 1 ? f.machines : [];
  return [
    { id: "card", label: "Show the card" },
    { id: "harness", label: "Open Filament" },
    { id: "dashboard", label: "Open the dashboard" },
    // The machines the harness window drives, where any is kept beside this computer: each its own row.
    ...(machines.length ? [{ type: /** @type {const} */ ("separator") }, ...machines.map(machineRow)] : []),
    { type: "separator" },
    f.owned
      ? { id: "restart", label: f.state === "restarting" ? "Restarting Filament…" : "Restart Filament", enabled: f.state === "up" || f.state === "late" || f.state === "taken" || f.state === "failed" }
      : { id: "restart", label: "Restart Filament (started elsewhere)", enabled: false },
    ...updateRows(f.update),
    { type: "separator" },
    // None where the system has no login item for Electron to set (Linux): a check that never sticks.
    ...(f.logonOn === null ? [] : [{ id: "logon", label: "Start at logon", checked: f.logonOn === true }]),
    { id: "notify", label: "Notifications", checked: f.notify !== false },
    ...(typeof f.updates === "boolean" ? [{ id: "updates", label: "Check for updates", checked: f.updates }] : []),
    { type: "separator" },
    { id: "quit", label: f.owned ? "Quit (stops Filament)" : "Quit (Filament keeps running)" },
  ];
}

/**
 * How many chats need you, as the tooltip says it: on every machine together, and where — the one other machine by its
 * name, several by how many. `others`: this computer's own left out (its Filament does not answer now).
 * @param {TrayFacts} f @param {{ others?: boolean }} [o]
 */
const needsTip = (f, { others = false } = {}) => {
  const rows = (f.machines?.length ? f.machines : [{ id: "local", name: "", local: true, status: /** @type {const} */ ("online"), needs: count(f.needs) }]).filter((m) => count(m.needs) && !(others && m.local));
  const n = rows.reduce((t, m) => t + count(m.needs), 0);
  if (!n) return "";
  const where = rows.length > 1 ? `, on ${rows.length} machines` : rows[0].local ? "" : `, on ${cut(rows[0].name, 32)}`;
  return ` · ${needWords(n)}${where}`;
};

/** @param {TrayFacts} f */
export function trayTip(f) {
  const need = needsTip(f);
  // This computer's Filament not answering: the other machines' chats alone.
  const away = needsTip(f, { others: true });
  if (!f.owned) return f.gone ? `Filament · port ${f.port} · started elsewhere, not answering${away}` : `Filament · port ${f.port} · started elsewhere${need}`;
  switch (f.state) {
    case "up":
      return `Filament · port ${f.port}${need}`;
    case "starting":
      return `Filament · starting…${away}`;
    case "late":
      return `Filament · starting, slower than usual (see server.log)${away}`;
    case "restarting":
      return `Filament · restarting…${away}`;
    case "stopping":
      return `Filament · stopping…${away}`;
    case "taken":
      return `Filament · not running: port ${f.port} is another program's${away}`;
    case "failed":
      return `Filament · could not start (see server.log)${away}`;
    default:
      return `Filament · not running${away}`;
  }
}
