// @ts-check
// What the desktop app's windows may show, and what its server is started with (HarnessV3-Native NA-D5, NA-D8). The
// windows show Filament's own pages only: an http(s) address elsewhere opens in the default browser, an editor's link
// (Open in editor) in that editor, anything else is refused. The server runs with the app's environment less what
// Electron sets for itself, and is told the app starts it again after a stop. Plain Node (NA-D13).
import { ELECTRON_VAR } from "../../src/adapters/agents/agent-process.js";
import { ART_DOMAIN } from "../../src/core/artifacts.js";

/** What `/api/state` says starts Filament again after a stop, when the app runs it: the page's Restart reads it. */
export const SUPERVISOR = "desktop";

/**
 * The editors' links the harness's Open in editor builds (`ui/harness/lib/editors.js`), handed to the system — in
 * those shapes alone: an editor's other links (its extensions' handlers) are refused. Another machine's page opens a
 * path there over SSH, by the alias the window reached it by (Remote - SSH's `vscode-remote/ssh-remote+<alias>`; the
 * hunt of p4-local-only: refused, so its Open in did nothing) — no other remote kind.
 */
export const EDITOR_LINKS = Object.freeze([
  "vscode://file/", "vscode-insiders://file/", "cursor://file/", "jetbrains://idea/navigate/reference?",
  "vscode://vscode-remote/ssh-remote+", "vscode-insiders://vscode-remote/ssh-remote+", "cursor://vscode-remote/ssh-remote+",
]);

/**
 * Where a window asked to show `url` sends it: it stays (Filament's own page), goes to the default browser (an http or
 * https address elsewhere), to its editor (an editor's link), or is refused (a file, a script, anything else).
 * @param {string} url @param {string} origin  the server's, `http://127.0.0.1:<port>`
 * @returns {"stay" | "browser" | "editor" | "refuse"}
 */
export function routeOf(url, origin) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return "refuse";
  }
  if (u.origin === origin) return "stay";
  if (EDITOR_LINKS.some((start) => url.startsWith(start))) return "editor";
  return u.protocol === "http:" || u.protocol === "https:" ? "browser" : "refuse";
}

/** How long after a click (or Enter, Space) a page's ask to open the browser counts as the person's (a browser's popup rule). */
export const ACTIVATION_MS = 5000;
/**
 * Whether a page's ask to open an address outside is taken as the person's: only just after their click, or Enter or
 * Space, in that window — and one press opens one address (the caller uses it up). Else the app asks first: a page (an
 * artifact a model wrote, say) could otherwise open the browser unbidden, as Electron has no popup blocker.
 * @param {number} lastPressAt @param {number} now
 */
export const askedByPerson = (lastPressAt, now) => now - lastPressAt >= 0 && now - lastPressAt <= ACTIVATION_MS;

/**
 * Whether an input is a press that opens: a click or a tap, or Enter or Space (a focused link's keys). Typing is none —
 * else every key typed into the composer would let a page open the browser.
 * @param {{ type: string, key?: string }} input
 */
export const isPress = (input) => input.type === "mouseDown" || input.type === "mouseUp" || input.type === "gestureTap" || ((input.type === "keyDown" || input.type === "rawKeyDown") && (input.key === "Enter" || input.key === " "));

/**
 * The server's environment: the app's own, less every variable Electron sets for itself (a program Filament starts
 * would run as plain Node by `ELECTRON_RUN_AS_NODE`), with `FILAMENT_SUPERVISOR` saying the app starts it again. The
 * installed app (`packaged`) installs its memory engine from the bundle it carries, whatever `FILAMENT_MEMORY_BUNDLE`
 * says: that one is a checkout's, and its tests'.
 * @param {Record<string, string | undefined>} env
 * @param {{ packaged?: boolean }} [o]
 * @returns {Record<string, string>}
 */
export function serverEnv(env, { packaged = false } = {}) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !ELECTRON_VAR.test(k) && !(packaged && k === "FILAMENT_MEMORY_BUNDLE")) out[k] = v;
  out.FILAMENT_SUPERVISOR = SUPERVISOR;
  return out;
}

/**
 * The server's arguments: this data folder, and the port only where the app was given one — else Filament reads its
 * config's, so a port changed in Settings is the one it listens on after a restart.
 * @param {{ dataDir: string, port?: number }} o
 */
export const serverArgs = ({ dataDir, port }) => ["--data-dir", dataDir, ...(port === undefined ? [] : ["--port", String(port)])];

/**
 * What Filament's own pages may be granted: what they ask of the browser — a copy, the terminal's paste (Ctrl+V reads
 * the clipboard), notifications (Settings › General's switches, a run that ends in a tab out of sight) and an
 * artifact's frame filled to the screen at the person's click in it. No page of Filament's asks for a camera, a
 * microphone, the place or a device, so none is granted.
 */
export const OWN_GRANTS = Object.freeze(["clipboard-read", "clipboard-sanitized-write", "fullscreen", "notifications"]);

/**
 * What an artifact's frame in Filament's page may be granted: what its frame's `allow` gives it in a browser, its full
 * screen, and the pointer locked — which only an app's frame may ask (its sandbox's allow-pointer-lock), a game's.
 */
export const ARTIFACT_GRANTS = Object.freeze(["clipboard-sanitized-write", "fullscreen", "pointerLock"]);

/**
 * Whether a page may be granted what it asks of the browser (the clipboard, notifications, full screen): Filament's own
 * pages, what they use (`OWN_GRANTS`) — another machine's in the window as This computer's —; an artifact's frame inside one
 * of them, its copy and its full screen: `<name>.art.localhost` on the page's own port over http (this computer's, an
 * SSH tunnel's), or another machine's network address — https, its host, the port after the page's (http/artifacts.js
 * `artifactsPort`, the owner's remote Filament of 11-06, Part 4); nothing else.
 * @param {{ permission: string, requesting: string | undefined, embedding?: string | undefined }} ask
 *   `embedding`: the page the asking frame is in, where it is a frame @param {string} origin
 */
export function mayGrant({ permission, requesting, embedding }, origin) {
  const of = (/** @type {string | undefined} */ url) => {
    try {
      return new URL(String(url || ""));
    } catch {
      return null;
    }
  };
  const asker = of(requesting);
  const own = of(origin);
  if (!asker || !own) return false;
  if (asker.origin === own.origin) return OWN_GRANTS.includes(permission);
  // Both over http: an https page's port and an http frame's both read "" where each is its scheme's own (the review of
  // p3-shell).
  const here = own.protocol === "http:" && asker.protocol === "http:" && asker.hostname.endsWith(`.${ART_DOMAIN}`) && asker.port === own.port;
  const network = own.protocol === "https:" && asker.protocol === "https:" && asker.hostname === own.hostname && own.port !== "" && asker.port === String(Number(own.port) + 1);
  return (here || network) && of(embedding)?.origin === own.origin && ARTIFACT_GRANTS.includes(permission);
}

/**
 * The addresses the app's windows' session listens on for their owner session (`ownerSessionGoes`): Filament's own
 * origin, over http and its sockets'. @param {string} origin
 */
export const ownerSessionUrls = (origin) => {
  const host = new URL(origin).host;
  return [`http://${host}/*`, `ws://${host}/*`];
};

/**
 * Whether a call of the app's windows carries their owner session (main.js `ownerSession`): one to Filament's own
 * origin — its host and port, over http or a socket —, asked by a window's own load or by a frame whose every frame up
 * to its window's is at that origin. Never one to another port of this computer's address (a server an agent runs, an
 * image a model wrote into a chat), another name for it, an artifact's frame's, nor a frame's that an artifact holds
 * at Filament's own address. A frame Electron can no longer read is none of Filament's.
 * @param {{ url: string, resourceType?: string, frame?: { origin: string, parent: any } | null }} call  Electron's
 *   webRequest details @param {string} origin
 */
export function ownerSessionGoes({ url, resourceType, frame }, origin) {
  try {
    const to = new URL(url);
    const own = new URL(origin);
    if (own.protocol !== "http:" || (to.protocol !== "http:" && to.protocol !== "ws:") || to.host !== own.host) return false;
    if (resourceType === "mainFrame") return true;
    if (!frame) return false;
    for (let f = frame; f; f = f.parent) if (f.origin !== own.origin) return false;
    return true;
  } catch {
    return false;
  }
}
