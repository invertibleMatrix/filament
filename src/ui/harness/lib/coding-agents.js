// @ts-check
// Settings → Coding agents' entries as the page keeps them (HarnessV3-ACP AC3-8), the words they're said in, and an
// agent's mark. The state is the server's (`GET /api/coding-agents`): every agent Filament can drive — the ones it
// knows, ACP's registry's, any made by hand — and where each stands, how it installs, its install under way and its
// models. It is read while someone looks (the section, an install sheet) and read again whenever an entry moves, the
// configuration is saved or an agent's models answered; nobody looking, nothing is read. DOM-free: the mark is built
// with the page's `h`.

/**
 * An entry, as the server sends it (app/coding-agents.js `Entry`).
 * @typedef {{ id: string, name: string, about: string, authors: string[], license: string | null, docs: string | null,
 *   retired?: { leaves: boolean },
 *   from: "filament" | "registry" | "config", mark: string | null, version: string | null,
 *   state: "connected" | "off" | "ready" | "missing", upstreams: string[], primary: string | null,
 *   installed: { version: string, at: number } | null, runs: string | null, update: string | null,
 *   install: { way: "npm" | "script" | "npx" | "uvx" | "binary", line: string, needs: "npm" | "uv" | null } | null,
 *   download: { url: string, program: string } | null, unavailable: boolean, gone: boolean,
 *   installing: { terminal: string, line: string, at: number, version: string | null } | null,
 *   lastInstall: { outcome: "installed" | "failed" | "cancelled", error: string | null, at: number } | null,
 *   models: { count: number, at: number } | null, asking: boolean, modelsError: string | null,
 *   profile: import("../../lib/agent-profile.js").AgentProfile | null }} CodingAgent
 */
/**
 * The entries, the registry's age (when it was read, whether it's being read, why the last read failed) and this
 * computer as the registry names systems.
 * @typedef {{ entries: CodingAgent[], registry: { at: number | null, asking: boolean, error: string | null },
 *   computer: string | null }} CodingAgents
 */
/**
 * The page's entries as it keeps them: the last read (null before the first), a hook on each new one (its undo
 * returned; the first hook starts the reading, the last one's undo stops it), and a route's answer kept in place of
 * the page's copy.
 * @typedef {{ now: () => CodingAgents | null, listen: (fn: (list: CodingAgents) => void) => () => void,
 *   keep: (list: any) => void }} AgentsKeeper
 */

/** What the bus says when an entry may have moved. */
const MOVES = new Set(["hello", "coding-agents", "config-changed", "models-discovered"]);

/**
 * @param {(fn: (msg: any) => void) => () => void} subscribe  the page's events feed
 * @param {() => Promise<any>} read  `GET /api/coding-agents`
 * @returns {AgentsKeeper}
 */
export function keepCodingAgents(subscribe, read) {
  /** @type {CodingAgents | null} */
  let now = null;
  /** @type {Set<(list: CodingAgents) => void>} */
  const hooks = new Set();
  /** @type {(() => void) | null} */
  let off = null;
  let busy = false;
  let again = false;
  const tell = () => {
    if (now) for (const fn of [...hooks]) fn(now);
  };
  /** @param {any} list */
  const keep = (list) => {
    if (!list || !Array.isArray(list.entries)) return;
    now = { entries: list.entries, registry: list.registry, computer: list.computer ?? null };
    tell();
  };
  const pull = () => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    read()
      .then(keep, () => {})
      .finally(() => {
        busy = false;
        if (again && off) {
          again = false;
          pull();
        }
      });
  };
  return {
    now: () => now,
    listen(fn) {
      hooks.add(fn);
      if (now) fn(now);
      if (!off) {
        off = subscribe((msg) => {
          if (MOVES.has(msg?.type)) pull();
        });
        pull();
      }
      return () => {
        hooks.delete(fn);
        if (!hooks.size && off) {
          off();
          off = null;
        }
      };
    },
    keep,
  };
}

/** Where to get an installer Filament lacks. */
export const NEEDS_PAGE = { npm: "https://nodejs.org/", uv: "https://docs.astral.sh/uv/getting-started/installation/" };

/**
 * How an agent installs, in a few words: for the whole computer its maker's way, into Filament's own folder (a program
 * there Filament downloads), as a program to download by hand, or not here at all.
 * @param {CodingAgent} e @returns {string}
 */
export function installWords(e) {
  const w = e.install?.way;
  if (w === "npm") return "npm, for the whole computer";
  if (w === "script") return `${e.name}'s install script`;
  if (w === "npx") return "npm, in Filament's folder";
  if (w === "uvx") return "uv, in Filament's folder";
  if (w === "binary") return "A download, in Filament's folder";
  if (e.download) return "A program to download";
  if (e.unavailable) return "No build for this computer";
  return "";
}

/**
 * What an agent Filament drives no more says wherever it stands (`retired`; the Fable 5.2 re-read's finding 7: its card
 * said nothing, and turned off said its accounts are kept): why (`about`), then what becomes of its connection — on,
 * that it still runs and what turning it off does; off, that it leaves the settings at the next start with its route,
 * what stays and what keeps it, or that it stays because it holds settings of the person's. "" for any other agent.
 * @param {CodingAgent} e @returns {string}
 */
export function retiredWords(e) {
  if (!e.retired) return "";
  const on = e.state === "connected";
  const it = on ? "This connection still runs as it is set up. Turned off, it" : "It";
  const keep = e.state === "off" ? " Turn it on to keep it." : e.state === "ready" ? " Connect it to keep it." : "";
  const fate = e.retired.leaves
    ? `${it} leaves your settings the next time Filament starts, and its route with it: neither holds a setting of yours. ${e.name} itself and its sign-in stay on this computer.${keep}`
    : `${it} stays in your settings: it holds settings of yours.`;
  return [e.about, fate].filter(Boolean).join(" ");
}

/** A count of models in words. @param {number} n */
export const modelCount = (n) => `${n} ${n === 1 ? "model" : "models"}`;

/**
 * An agent's mark on its tile: the registry's icon, which Filament serves and the page tints with the theme (a mask),
 * or, for an agent with none, its name's first letter.
 * @param {(tag: string, attrs?: any, ...kids: any[]) => any} m @param {{ mark: string | null, name: string }} e
 */
export function markTile(m, e) {
  if (!e.mark) return m("span", { class: "cag-mark", "aria-hidden": "true" }, m("span", { class: "cag-mark-letter" }, (/[\p{L}\p{N}]/u.exec(e.name)?.[0] || "?").toUpperCase()));
  const url = `/api/coding-agents/icons/${encodeURIComponent(e.mark)}`;
  return m("span", { class: "cag-mark", "aria-hidden": "true" },
    m("span", { class: "cag-mark-glyph", style: `-webkit-mask-image: url("${url}"); mask-image: url("${url}")` }));
}

/**
 * An author as a row names them: npm's "Name <email> (url)" is its name — no address on the page; an author the
 * registry gives only as an address keeps it.
 * @param {string} a
 */
const authorName = (a) => a.replace(/<[^<>]*@[^<>]*>|\(\s*https?:\/\/[^()]*\)/g, " ").replace(/\s+/g, " ").trim() || a;

/** Who makes an agent and its licence, as its row says them. @param {CodingAgent} e */
export const makerWords = (e) => {
  const names = e.authors.map(authorName);
  return [names.length ? `By ${names.slice(0, 2).join(", ")}${names.length > 2 ? " and others" : ""}` : "", e.license || ""].filter(Boolean).join(" · ");
};

/**
 * Whether an agent's row matches what's searched: each word searched starts a word of its name, id, what it says of
 * itself or who makes it — "ant" finds Antigravity, not an agent for "relevant".
 * @param {CodingAgent} e @param {string} q
 */
export function matches(e, q) {
  const hay = [e.name, e.id, e.about, ...e.authors].join(" ").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(hay));
}
