// @ts-check
// Hash routes: `#/` a new task, `#/new/<folder>` a new task in a folder (the address another machine's page is opened
// at from this computer's new-chat menu, pk-list), `#/task/<chainId>` a session on its Chat view and `#/task/<chainId>/<view>` on another
// of its views (HarnessV3-Views VW-D1; `side` since HarnessV4_Tasks E15 step 5, `overview` since proposal_ux phase 4),
// `#/settings/<section>` the full-page settings view, `#/context/<tab>` the Session inspector's old address — the page
// leads it to the open chat's Overview and the sheet that holds what the tab held (proposal_ux R1) —,
// `#/control-room/<runId>` the maximised control room, `#/artifacts` the Artifacts page
// (HarnessV4_Artifacts_Plan AF-D10), `#/artifacts/<name>` an artifact's full view (AF-D36), and `#/library/<page>` a
// page of the Library — Agents and teams, Skills, Memory (proposal_ux §4.15, phase 7), Plugins & Connectors —,
// Memory's with the workspace it opens on (`#/library/memory/<scope>`), Plugins & Connectors' with the plugin whose
// sheet it opens (`#/library/plugins/<id>`, a connector's row's Open) and `#/library/connectors` at its connectors part
// (Connectors' own page until the owner's of 11-09), Skills' with the skill whose page it opens
// (`#/library/skills/<name>`), `#/space/<project>` a project's Space (proposal_ux §4.14,
// phase 8), and `#/your-space` Your Space (HarnessV4_Space_Plan S5b). The Settings pages the Library took over keep
// their addresses: `libraryOf` says where each now is. Pure — no DOM. An unknown path is home, and a view the page does
// not know is Chat.
import { isArtifactName } from "./artifacts.js";

/** A session's views, Chat first: the one its bare address shows; then in the tabs' order (proposal_ux D4). */
export const VIEWS = Object.freeze(["chat", "overview", "side", "team", "plan"]);
/** The Library's own pages, in the left bar's order (its last, Artifacts, keeps `#/artifacts`). */
export const LIBRARY_PAGES = Object.freeze(["agents", "skills", "memory", "plugins"]);
/**
 * The Library's addresses that name a part of a page, by the page that holds it: Connectors, a page of its own until
 * the owner's of 11-09, is a part of Plugins & Connectors. Its address, and every door that opened it, lands on that
 * page at that part.
 */
const LIBRARY_PARTS = Object.freeze(/** @type {Record<string, string>} */ ({ connectors: "plugins" }));
/** The Library's pages whose address names one thing in them: Memory's workspace, the plugin whose sheet opens, the skill whose page opens. */
const SCOPED = Object.freeze(["memory", "plugins", "skills"]);

/**
 * The Library page an address's page or part is drawn on: Connectors' is Plugins & Connectors; a page's, its own.
 * @param {string | undefined} page
 */
export const libraryPage = (page) => (page && Object.hasOwn(LIBRARY_PARTS, page) ? LIBRARY_PARTS[page] : page);

/**
 * Where a Settings page the Library took over now is (proposal_ux §4.15): Agents — with its teams in sight from
 * `settings/teams` —, Skills (the search finds it there), and MCP servers, the Library's Connectors since the owner's word of 10-26
 * (Plugins & Connectors' connectors part since the owner's of 11-09: `libraryPage`). Memory
 * stays in Settings for its engine and what new chats do; its browser is the Library's. Null for any other section.
 * @param {string} section
 * @returns {{ page: string, start: string | null } | null}
 */
export function libraryOf(section) {
  if (section === "saved-agents") return { page: "agents", start: null };
  if (section === "teams") return { page: "agents", start: "groups" };
  if (section === "skills") return { page: "skills", start: null };
  if (section === "mcp-servers") return { page: "connectors", start: null };
  return null;
}

/**
 * @typedef {{ kind: "home", folder?: string } | { kind: "task", id: string, view: string } | { kind: "settings", section: string }
 *   | { kind: "context", tab: string } | { kind: "control-room", id: string } | { kind: "artifacts" }
 *   | { kind: "artifact", id: string } | { kind: "library", page: string, scope: string, part?: string }
 *   | { kind: "space", id: string, tab?: string } | { kind: "your-space" }} Route
 *   `scope`: the workspace Library › Memory opens on ("" for the first one it holds), the plugin Library › Plugins &
 *   Connectors opens the sheet of; `part`: the part of its page the address named (`connectors`), which the page opens
 *   at; a space's `id`: its project's, its `tab`: the app, the dashboard, Routines ("@routines") or Watchers ("@watchers") it shows,
 *   as its row in the bar opens it (the owner's of 10-29) — none, its Board; home's `folder`: a new chat opened in it
 */

/** The routes a full-frame screen owns: it lies over the conversation, which stays as it is underneath. */
const SCREENS = Object.freeze(["settings", "control-room", "artifacts", "artifact", "library", "space", "your-space"]);
/** Is a route of this kind a full-frame screen (Settings, a control room, the Artifacts page, an artifact, a Library
 *  page, a Space, Your Space)? @param {string} kind */
export const isScreen = (kind) => SCREENS.includes(kind);
/** Is a full-frame screen on at this address? @param {string} [hash] */
export const onScreen = (hash) => isScreen(parseRoute(hash).kind);

/**
 * A part of the address as it names its thing: decoded, or as written where it holds no escape the URI reader takes
 * (`#/task/%` typed by hand, a link cut short) — such an address still leads somewhere, and the page that reads it
 * never throws. @param {string} part
 */
const decoded = (part) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

/**
 * The folder a new chat at `#/new/<folder>` opens in: the project of the page's list it names, as the list names it —
 * never a folder on a share, nor one no project names, which a link in a chat's words could name (the review of
 * pk-list); null for those. Compared as the page compares folders: its separators and its case aside.
 * @param {string} folder @param {readonly any[] | null | undefined} projects  the page's `state.projects`
 * @returns {string | null}
 */
export function newChatFolder(folder, projects) {
  const asked = String(folder || "").trim();
  if (!asked || /^[\\/]{2}/.test(asked)) return null;
  const key = (/** @type {unknown} */ p) => String(p ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const known = (projects || []).find((p) => typeof p?.cwd === "string" && p.cwd && key(p.cwd) === key(asked));
  return known ? String(known.cwd) : null;
}

/** @param {string} [hash] @returns {Route} */
export function parseRoute(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  const path = raw.replace(/^\//, "");
  if (!path) return { kind: "home" };
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "task" && parts[1]) return { kind: "task", id: decoded(parts[1]), view: VIEWS.includes(parts[2]) ? parts[2] : "chat" };
  if (parts[0] === "settings") return { kind: "settings", section: parts[1] ? decoded(parts[1]) : "general" };
  if (parts[0] === "context") return { kind: "context", tab: parts[1] ? decoded(parts[1]) : "map" };
  if (parts[0] === "control-room" && parts[1]) return { kind: "control-room", id: decoded(parts[1]) };
  if (parts[0] === "artifacts" && !parts[1]) return { kind: "artifacts" };
  if (parts[0] === "artifacts" && isArtifactName(parts[1])) return { kind: "artifact", id: parts[1] };
  if (parts[0] === "library") {
    // Abilities' old address opens Skills, which took its place (E57; Hunter's find): a bookmark lands where it meant.
    const asked = parts[1] === "abilities" ? "skills" : parts[1];
    // Connectors' address opens Plugins & Connectors at its connectors part: every bookmark and door lands there.
    if (asked && Object.hasOwn(LIBRARY_PARTS, asked)) return { kind: "library", page: LIBRARY_PARTS[asked], scope: "", part: asked };
    const page = LIBRARY_PAGES.includes(asked) ? asked : LIBRARY_PAGES[0];
    return { kind: "library", page, scope: SCOPED.includes(page) && parts[2] ? decoded(parts.slice(2).join("/")) : "" };
  }
  if (parts[0] === "space" && parts[1]) {
    return parts[2] ? { kind: "space", id: decoded(parts[1]), tab: decoded(parts[2]) } : { kind: "space", id: decoded(parts[1]) };
  }
  if (parts[0] === "your-space") return { kind: "your-space" };
  if (parts[0] === "new" && parts[1]) return { kind: "home", folder: decoded(parts.slice(1).join("/")) };
  return { kind: "home" };
}

/**
 * @param {Route["kind"] | Route} kind
 * @param {{ id?: string, section?: string, tab?: string, view?: string, page?: string, scope?: string, folder?: string }} [extra]
 *   `folder`: home's, a new chat in it (`#/new/<folder>`)
 */
export function routeFor(kind, extra = {}) {
  const k = typeof kind === "string" ? kind : kind.kind;
  const id = extra.id || (typeof kind === "object" && "id" in kind ? kind.id : "");
  const section = extra.section || (typeof kind === "object" && "section" in kind ? kind.section : "");
  const tab = extra.tab || (typeof kind === "object" && "tab" in kind ? kind.tab : "");
  const view = extra.view || (typeof kind === "object" && "view" in kind ? kind.view : "");
  const page = extra.page || (typeof kind === "object" && "page" in kind ? kind.page : "");
  const scope = extra.scope ?? (typeof kind === "object" && "scope" in kind ? kind.scope : "");
  if (k === "task" && id) return `#/task/${encodeURIComponent(id)}${view !== VIEWS[0] && VIEWS.includes(view) ? `/${view}` : ""}`;
  if (k === "settings") return section ? `#/settings/${encodeURIComponent(section)}` : "#/settings";
  if (k === "context") return tab ? `#/context/${encodeURIComponent(tab)}` : "#/context/map";
  if (k === "control-room" && id) return `#/control-room/${encodeURIComponent(id)}`;
  if (k === "artifacts") return "#/artifacts";
  if (k === "artifact" && id) return `#/artifacts/${encodeURIComponent(id)}`;
  if (k === "library") {
    // A part's address stays its own (`#/library/connectors`), asked by its name or read back from its route.
    const part = extra.page ? page : (typeof kind === "object" && "part" in kind && kind.part) || page;
    if (Object.hasOwn(LIBRARY_PARTS, part)) return `#/library/${part}`;
    const at = LIBRARY_PAGES.includes(page) ? page : LIBRARY_PAGES[0];
    return `#/library/${at}${SCOPED.includes(at) && scope ? `/${encodeURIComponent(scope)}` : ""}`;
  }
  if (k === "space" && id) return `#/space/${encodeURIComponent(id)}${tab && tab !== "overview" ? `/${encodeURIComponent(tab)}` : ""}`;
  if (k === "your-space") return "#/your-space";
  if (k === "home" && extra.folder) return `#/new/${encodeURIComponent(extra.folder)}`;
  return "#/";
}
