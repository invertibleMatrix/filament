// @ts-check
// The settings page: a full-page two-column view in the content column (§5.10) — left nav grouped
// Basics / Models and agents / New chats / Filament, right a scroll region of rows. The overlay stays
// over the conversation: the transcript, composer and find bar stay mounted underneath. General's auto-archive
// sweep runs from the app's start, not from here (general.js `startHourlySweep`). Agents and teams and
// Abilities (gone since, for Skills) moved to the Library (proposal_ux §4.16, phase 7), and since the owner's word of 10-23 ("from harness
// settings remove these options") the nav lists them no more: the left bar's foot holds them; MCP servers followed on
// 10-26, as the Library's Connectors (a part of Plugins & Connectors since 11-09). Their old addresses lead there (app.js), and the search still finds them and
// their rows, opening the Library at them (`LIBRARY_HITS`).
import { h } from "../../lib/dom.js";
import { ICONS, icon } from "../lib/icons.js";
import { libraryOf, routeFor } from "../lib/router.js";
import { renderGeneral, SEARCH_ROWS as GENERAL_ROWS } from "./general.js";
import { renderAppearance, SEARCH_ROWS as APPEARANCE_ROWS } from "./appearance.js";
import { renderShortcuts } from "./shortcuts.js";
import { renderArchived } from "./archived.js";
import { renderMemory, SEARCH_ROWS as MEMORY_ROWS } from "./memory.js";
import { renderContext, SEARCH_ROWS as CONTEXT_ROWS } from "./context.js";
import { renderPermissions, SEARCH_ROWS as PERMISSIONS_ROWS } from "./permissions.js";
import { renderInstructions, SEARCH_ROWS as INSTRUCTIONS_ROWS } from "./instructions.js";
import { renderLanguageServers, SEARCH_ROWS as LANGUAGE_SERVERS_ROWS } from "./language-servers.js";
import { renderAgents } from "./agents.js";
import { renderProviders } from "./providers.js";
import { SEARCH_ROWS as FAILOVER_ROWS } from "./failover-card.js";
import { renderUsage } from "./usage.js";
import { renderImport } from "./import.js";
import { renderFeatures } from "./features.js";
import { renderExperimental, SEARCH_ROWS as EXPERIMENTAL_ROWS } from "./experimental.js";
import { renderConnect, SEARCH_ROWS as CONNECT_ROWS } from "./connect.js";
import { renderRemote, SEARCH_ROWS as REMOTE_ROWS } from "./remote.js";
import { renderAgentLoop, SEARCH_ROWS as AGENT_LOOP_ROWS } from "./agent-loop.js";
import { renderSpaceSettings, SEARCH_ROWS as SPACE_ROWS } from "./space.js";
import { renderDataPrivacy, SEARCH_ROWS as DATA_ROWS } from "./data-privacy.js";
import { renderAbout, SEARCH_ROWS as ABOUT_ROWS } from "./about.js";
import { settingsSearch, lightRow, holdJump, takeJump } from "./search.js";
import { state } from "../state.js";
import { agentsLabel, teamsOn } from "../../lib/teams-on.js";

// The groups say what a person is doing (HarnessV4_Settings_Plan HS-D5): setting up the models and agents, deciding
// how new chats behave, and Filament itself.
export const SECTIONS = [
  { id: "general", group: "Basics", label: "General", icon: "settings" },
  { id: "appearance", group: "Basics", label: "Appearance", icon: "palette" },
  { id: "shortcuts", group: "Basics", label: "Keyboard shortcuts", icon: "squareSlash" },
  { id: "archived", group: "Basics", label: "Archived chats", icon: "archive" },
  { id: "providers", group: "Models and agents", label: "Providers", icon: "cable" },
  { id: "agents", group: "Models and agents", label: "Coding agents", icon: "bot" },
  { id: "permissions", group: "New chats", label: "Permissions", icon: "shieldCheck" },
  { id: "instructions", group: "New chats", label: "Instructions", icon: "notepadText" },
  // What the agents ask about code, and which programs answer (the owner's LSP of 11-04).
  { id: "language-servers", group: "New chats", label: "Language servers", icon: "code" },
  // Its page is titled as the sheet a chat opens from its context ring (proposal_ux §4.16).
  { id: "context", group: "New chats", label: "Context", title: "How earlier turns are kept", icon: "layers" },
  { id: "memory", group: "New chats", label: "Memory", icon: "sparkles" },
  { id: "connect", group: "Filament", label: "Connect other apps", icon: "network" },
  // This Filament from your other machines: pairing them, and the devices paired (the owner's remote Filament of 11-06).
  { id: "remote", group: "Filament", label: "Remote access", icon: "globe" },
  { id: "agent-loop", group: "Filament", label: "Agent loop", icon: "repeat" },
  // Every Space's defaults (the owner's of 11-04): the model its agents run on, what an app's ask does, Pause all.
  { id: "space", group: "Filament", label: "Space", icon: "layoutGrid" },
  { id: "data", group: "Filament", label: "Data and privacy", icon: "lock" },
  { id: "usage", group: "Filament", label: "Usage stats", icon: "clock3" },
  { id: "import", group: "Filament", label: "Import", icon: "download" },
  { id: "features", group: "Filament", label: "Feature board", icon: "waypoints" },
  // Features still being tried, each off until it is turned on (the owner's of 11-05).
  { id: "experimental", group: "Filament", label: "Experimental", icon: "flaskConical" },
  { id: "about", group: "Filament", label: "About", icon: "info" },
];

/**
 * The Library's pages as the search finds them (the owner's word of 10-23 took them off the nav): a result opens the
 * Library there (router.js `libraryOf`), and their rows' results light the row on it.
 */
export const LIBRARY_HITS = Object.freeze([
  { id: "saved-agents", group: "Library", label: "Agents and teams" },
  { id: "skills", group: "Library", label: "Skills" },
  { id: "mcp-servers", group: "Library", label: "Connectors" },
]);
/**
 * The Library's pages as the search finds them now: the agents' page named as Settings › Experimental's Teams switch has
 * it (src/ui/lib/teams-on.js). @param {any} cfg
 */
export const libraryHits = (cfg) => LIBRARY_HITS.map((s) => (s.id === "saved-agents" ? { ...s, label: agentsLabel(cfg) } : s));
/** The agents' page's words under its title while teams are off. */
const AGENTS_ALONE = "In the Library now: every agent's card. The programs Filament runs for you — Claude Code, Codex, Cursor — are under Coding agents.";

/** A section's page title: its own where it has one (Context's is the sheet's), else its name. @param {string} id */
const sectionTitle = (id) => {
  const s = SECTIONS.find((x) => x.id === id);
  return s?.title || s?.label || "General";
};

/** Each section's words under its title, which the search finds it by too. */
export const DESCRIPTIONS = {
  general: "These preferences affect the current window experience.",
  appearance: "Theme, UI font size, and code presentation",
  shortcuts: "",
  archived: "The chats and projects you archived: nothing Filament starts by itself runs in one until you bring it back. Unarchive one and the sidebar lists it again; a chat's title opens it.",
  memory: "A project left out of memory, the model memory works with, and its engine, backups and folder. What it holds for each workspace is in Library › Memory.",
  permissions: "What the agent may do without asking, in every chat that has not chosen its own. A chat's own switch, beside its message box, changes it for that chat.",
  instructions: "What the agent is told and given in every chat that has not chosen its own: words for every chat, the project's instruction files, hooks and the web tools. Your skills are in Library › Skills.",
  "language-servers": "The programs that tell Filament's agents about code — where a name is defined, what uses it, a file's symbols and its problems — in every chat that has not chosen its own. Nothing is bundled: the ones Filament knows run where they are installed on this computer, beside your plugins' and your own.",
  context: "How earlier turns reach the model in a chat that has not chosen its own: what goes every turn, what happens when the window fills. A chat changes it for itself from its context ring: How earlier turns are kept.",
  "saved-agents": "In the Library now: every agent's card and the teams built from them. The programs Filament runs for you — Claude Code, Codex, Cursor — are under Coding agents.",
  skills: "In the Library: how-tos every agent can use, each a folder with a SKILL.md, and where each is on.",
  providers: "Where models come from when you hold a key or an account, and each model's agents at once: how many of Filament's agents run on it across your chats, with none set as many as needed. A model's backups, tried when its provider fails, are set on its provider's page, and used only while the switch at the top is on. The console calls these upstreams.",
  agents: "The coding agents Filament runs — Claude Code, Codex, Cursor and more from ACP's registry. Connect or install one here, sign in its accounts, see how much of each plan is left, and set each model's agents at once. A key for a provider's API goes under Providers.",
  "mcp-servers": "In the Library now, on Plugins & Connectors: your MCP servers and your plugins', for all chats or a project — tools from other programs every engine in a chat can use.",
  usage: "Every model call that went through this Filament — its own chats' and any tool's that uses it as its endpoint — counted as it finished and kept on this computer for 400 days (daily-usage.json in the data folder). This page sends nothing: a day's counts leave this computer only where Anonymous usage statistics is on, in Data and privacy.",
  import: "Bring your chats from other coding agents into Filament. Each becomes a session in the sidebar, under its project, and you can go on with it on any model. The other agent's files are only read.",
  features: "Each feature's switch, its state in the open session, a number from your own sessions, and the replay-compare action.",
  experimental: "Features still being tried. Each is off until you turn it on, and may change or go in a later version; the switches few need are kept here too.",
  remote: "Your other machines and devices: what each may do on this machine, and what this machine may do on them. Pair a new one with a code made here.",
  connect: "What another app needs to use Filament — Claude Code, Codex, an SDK: the address, a key, and a block to copy. Memory's door for other agents is here too.",
  space: "What every Space does where it chose nothing of its own: the model its agents run on by themselves, with that model's effort — chats started from a Space start on it too —, and what an app's button that asks an agent does. A Space chooses its own in its ⋯ › Space settings….",
  "agent-loop": "Filament's own agent: the folders it may open, its tools, where its sub-agents edit, the web, and what it does after a restart. Filament's own calls get these as they stand; in the harness, Settings › New chats and a chat's own settings lie over them. Hover a setting to read what it does.",
  data: "What Filament keeps of each request and for how long, where it keeps it, and what it comes to find you about.",
  about: "Which Filament this is, restarting it, and the console for the proxy's own tools.",
};

/** The rows each page draws, as the search finds them (search.js, HS-D68): a section's own list beside its code. */
export const PAGE_ROWS = Object.freeze({
  general: GENERAL_ROWS,
  appearance: APPEARANCE_ROWS,
  providers: FAILOVER_ROWS,
  permissions: PERMISSIONS_ROWS,
  instructions: INSTRUCTIONS_ROWS,
  "language-servers": LANGUAGE_SERVERS_ROWS,
  context: CONTEXT_ROWS,
  memory: MEMORY_ROWS,
  connect: CONNECT_ROWS,
  remote: REMOTE_ROWS,
  "agent-loop": AGENT_LOOP_ROWS,
  space: SPACE_ROWS,
  data: DATA_ROWS,
  experimental: EXPERIMENTAL_ROWS,
  about: ABOUT_ROWS,
});

/**
 * An address no section has, by the section that holds its settings: models, Providers, where a model's backups are
 * set (the owner's settings cleanup of 11-09). A link to it opens there, its address put right.
 */
export const MOVED = Object.freeze(/** @type {Record<string, string>} */ ({ models: "providers" }));

/**
 * @param {HTMLElement} host
 * @param {string} section
 * @param {{ onClose: () => void } & SectionCallbacks} cb
 */
export function renderSettings(host, section, cb) {
  const current = SECTIONS.some((s) => s.id === section) ? section : MOVED[section] || "general";
  if (MOVED[section]) globalThis.history?.replaceState?.(null, "", routeFor("settings", { section: current }));
  // A search result opened in another section, or on a page it opens on: lit once this one is drawn.
  const taken = takeJump((s) => s === current);
  const nav = h("nav", { class: "settings-nav" });
  const body = h("div", { class: "settings-body" });
  // A result in this section lights its row where it is; one elsewhere, or on a page the section opens on (a
  // provider's), draws that section first.
  const finder = settingsSearch({
    sections: [...SECTIONS, ...libraryHits(state.config)],
    descriptions: teamsOn(state.config) ? DESCRIPTIONS : { ...DESCRIPTIONS, "saved-agents": AGENTS_ALONE },
    rows: PAGE_ROWS,
    onSearching: (on) => nav.classList.toggle("is-searching", on),
    open: (go) => {
      const moved = libraryOf(go.section);
      if (go.section === current && !go.start && !moved) return lightRow(body, go);
      holdJump(go);
      if (moved) location.hash = routeFor("library", { page: moved.page });
      else if (go.section === current) renderSettings(host, current, cb);
      else location.hash = routeFor("settings", { section: go.section });
    },
  });
  nav.append(finder.field);
  let lastGroup = "";
  for (const s of SECTIONS) {
    if (s.group !== lastGroup) {
      nav.append(h("div", { class: "settings-group" }, s.group));
      lastGroup = s.group;
    }
    nav.append(h("a", {
      class: `settings-item${s.id === current ? " on" : ""}`,
      href: routeFor("settings", { section: s.id }),
    }, h("span", { class: "settings-ic", html: icon(/** @type {keyof typeof ICONS} */ (s.icon)) }), s.label));
  }
  nav.append(finder.results);
  const existing = host.querySelector(".settings");
  if (existing) existing.remove();
  // Overlaid, not a replacement: the transcript, composer and find bar stay mounted underneath.
  host.append(h("div", { class: "settings" },
    nav,
    h("div", { class: "settings-main" },
      h("div", { class: "settings-top" },
        h("span", { class: "settings-crumb" }, `Settings › ${SECTIONS.find((s) => s.id === current)?.label}`),
        h("button", { class: "ghost sm", type: "button", onclick: cb.onClose }, "Back to chat")),
      h("h2", { class: "set-title" }, sectionTitle(current)),
      DESCRIPTIONS[current] ? h("p", { class: "set-desc" }, DESCRIPTIONS[current]) : null,
      body)));
  const start = taken?.start || cb.start || null;
  drawSection(body, current, start === cb.start ? cb : { ...cb, start });
  finder.restore();
  if (taken) lightRow(body, taken);
}

/**
 * What the sections are handed. `onChanged`: a change the open session's settings show (a team made, edited or
 * deleted, the members' model; a saved agent likewise); `start`: what the section opens on, where it takes one
 * (Providers: "provider:<id>", that provider's page; Agents and teams' starts are the Library's now); `accounts` and
 * `agents`: the page's accounts and coding agents, as it keeps them; `signIn`: the sign-in sheet, for an account
 * (HarnessV3-ACP AC3-7); `install`: the install sheet, for an agent; `useResetCredit`: one of a Codex account's reset
 * credits, once the person says so (AC3-8).
 * `onSessions`: the list of sessions is to be read again (an import brought chats in); `onWelcome`: the welcome tour,
 * opened again (General's Welcome tour).
 * @typedef {{ onToast?: (msg: string, kind?: string) => void, getChain?: () => string | undefined, onChanged?: () => void, onSessions?: () => void, onWelcome?: () => void, start?: string | null,
 *   accounts: import("../../lib/accounts.js").AccountKeeper, agents: import("../lib/coding-agents.js").AgentsKeeper,
 *   signIn: (upstream: string) => void, install: (id: string) => void,
 *   useResetCredit: (upstream: string) => Promise<unknown> }} SectionCallbacks
 */

/**
 * @param {HTMLElement} body @param {string} section @param {SectionCallbacks} cb
 */
function drawSection(body, section, cb) {
  if (section === "appearance") return renderAppearance(body);
  if (section === "shortcuts") return renderShortcuts(body);
  if (section === "archived") return renderArchived(body, cb);
  if (section === "memory") return renderMemory(body, cb);
  if (section === "context") return renderContext(body, cb);
  if (section === "permissions") return renderPermissions(body, cb);
  if (section === "instructions") return renderInstructions(body, cb);
  if (section === "language-servers") return renderLanguageServers(body, cb);
  if (section === "agents") return renderAgents(body, cb);
  if (section === "providers") return void renderProviders(body, cb);
  if (section === "usage") return renderUsage(body, cb);
  if (section === "import") return renderImport(body, cb);
  if (section === "features") return renderFeatures(body, cb);
  if (section === "experimental") return renderExperimental(body, cb);
  if (section === "connect") return renderConnect(body, cb);
  if (section === "remote") return renderRemote(body, cb);
  if (section === "agent-loop") return renderAgentLoop(body, cb);
  if (section === "space") return renderSpaceSettings(body, cb);
  if (section === "data") return renderDataPrivacy(body, cb);
  if (section === "about") return renderAbout(body, cb);
  renderGeneral(body, cb);
}

