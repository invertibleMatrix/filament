// @ts-check
// The Library (proposal_ux §4.15, phase 7): what Filament keeps for you across chats, each kind on a page of its own —
// Agents and teams, Skills (HarnessV4_Skills_Plan S1-6), Memory, Plugins & Connectors (HarnessV4_SpacesPlugins_Plan
// B5's Plugins and the Connectors of the owner's word of 10-26, Settings › MCP servers before it, one page since the
// owner's of 11-09: a plugin brings connectors, and a connector is an MCP server without the rest); its
// last, Artifacts, keeps its page (`#/artifacts`). A full-frame screen over
// the conversation, as Settings is: the crumb "Library › <page>" — "Library › Skills › <name>" on a skill's own page,
// with Back to Skills — with Back to chat, its
// title and line, then the page. The left bar's Library rows open it, and Settings keeps a row where each page left;
// a Settings search result that lives here opens here, lit (settings/search.js).
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { libraryOf, libraryPage, routeFor } from "../lib/router.js";
import { holdJump, lightRow, takeJump } from "../settings/search.js";
import { renderLibraryAgents } from "./agents.js";
import { renderSkills, renderSkillPage, skillsPlace } from "./skills.js";
import { renderMemoryBrowser } from "./memory.js";
import { renderPlugins } from "./plugins.js";
import { state } from "../state.js";
import { agentsLabel, teamsOn } from "../../lib/teams-on.js";

/** The Library's pages (router.js LIBRARY_PAGES), in the left bar's order: its name, glyph and line. */
export const LIBRARY = Object.freeze({
  agents: Object.freeze({
    label: "Agents and teams",
    icon: "atSign",
    // U13's one page: the words a newcomer reads first (the owner's vibe coder of 10-20), short (the owner's of 11-09).
    line: "Agents any chat can ask, and teams that put one in charge of workers. Nothing here starts anything: you do that in a chat.",
  }),
  // HarnessV4_Skills_Plan S1-6 (the Designer's of 10-27): built like Connectors, a skill on per place.
  skills: Object.freeze({
    label: "Skills",
    icon: "wandSparkles",
    line: "How-tos your agents can follow: Filament's own, yours, and the ones Claude Code, Codex and Cursor keep on this computer.",
  }),
  memory: Object.freeze({
    label: "Memory",
    icon: "brain",
    line: "What memory knows, everywhere and in each workspace, how sure it is, and your word on it. How it behaves — in new chats, the model it learns with, its engine — is in Settings › Memory.",
  }),
  // HarnessV4_SpacesPlugins_Plan B5 (the Designer's §6 D) and the Connectors of the owner's word of 10-26, one page
  // since the owner's of 11-09: what is on here first, then where more plugins come from.
  plugins: Object.freeze({
    label: "Plugins & Connectors",
    icon: "puzzle",
    line: "Connectors are MCP servers: tools from other programs. A plugin brings connectors along with skills, commands and scripts. Every engine in a chat — Filament's own agent, Claude Code, Codex, Cursor — can use what is on here. Installing a plugin runs nothing.",
  }),
});

/** The agents' page while Settings › Experimental's Teams switch is off (src/ui/lib/teams-on.js): your agents alone. */
const AGENTS_ALONE = Object.freeze({ ...LIBRARY.agents, line: "Agents any chat can ask. Nothing here starts anything: you do that in a chat." });

/**
 * @param {HTMLElement} host  the conversation's frame
 * @param {{ page: string, scope?: string, part?: string }} at  the page, and the workspace Library › Memory opens on,
 *   the plugin Plugins & Connectors opens, the skill whose page Skills opens; `part`: the part of the page its address
 *   named (`connectors`)
 * @param {{ onClose: () => void, onToast?: (msg: string, kind?: string) => void, getChain?: () => string | undefined,
 *   onChanged?: () => void, start?: string | null, onCraft?: (skill: string) => void }} cb
 *   `onChanged`: an agent, a team or a list of seats changed; `start`: what Agents and teams opens on ("new", "new-team",
 *   "groups", "agents")
 */
export function renderLibrary(host, at, cb) {
  const page = /** @type {keyof typeof LIBRARY} */ (Object.hasOwn(LIBRARY, at.page) ? at.page : "agents");
  const it = page === "agents" && !teamsOn(state.config) ? { ...AGENTS_ALONE, label: agentsLabel(state.config) } : LIBRARY[page];
  // A result or a door held for this page, or for a part of it (Connectors, on Plugins & Connectors).
  const taken = takeJump((s) => libraryPage(libraryOf(s)?.page) === page);
  host.querySelector(":scope > .library")?.remove();
  const acts = h("span", { class: "lib-top-acts" });
  // A page's own acts beside its title: Agents and teams' New agent… and New team….
  const titleActs = h("span", { class: "lib-title-acts" });
  const body = h("div", { class: "lib-body" });
  // One skill's own page: its name after the page's in the crumb, its name and words in the title.
  const skill = page === "skills" && at.scope ? at.scope : "";
  const title = h("h2", { class: "lib-title" }, skill || it.label);
  const line = h("p", { class: "lib-line" }, skill ? "" : it.line);
  const sep = () => h("span", { class: "lib-crumb-sep", "aria-hidden": "true" }, "›");
  host.append(h("div", { class: "library", "data-page": page },
    h("div", { class: "settings-top lib-top" },
      h("span", { class: "settings-crumb lib-crumb" },
        h("span", { class: "lib-crumb-ic", "aria-hidden": "true", html: /** @type {any} */ (ICONS)[it.icon] || "" }),
        "Library", sep(), skill ? h("span", {}, it.label) : h("span", { class: "lib-crumb-at" }, it.label),
        ...(skill ? [sep(), h("span", { class: "lib-crumb-at" }, skill)] : [])),
      acts),
    h("div", { class: "lib-scroll" },
      h("div", { class: "lib-title-row" }, title, titleActs),
      line,
      body)));
  // Back to Skills: on the place the list showed when the skill was opened, as a Space's door opens it (Hunter's find).
  const backToSkills = () => {
    const place = skillsPlace();
    if (place !== "all") holdJump({ section: "skills", start: place });
    location.hash = routeFor("library", { page: "skills" });
  };
  const back = skill
    ? h("button", { class: "ghost sm", type: "button", onclick: backToSkills }, "Back to Skills")
    : h("button", { class: "ghost sm", type: "button", onclick: cb.onClose }, "Back to chat");
  acts.append(back);
  // Agents and teams has its New agent… and New team… beside its title.
  if (page === "agents") {
    const start = taken?.start || cb.start || null;
    renderLibraryAgents(body, { ...cb, start, acts: titleActs });
  } else if (skill) renderSkillPage(body, skill, { onToast: cb.onToast, onCraft: cb.onCraft, acts: titleActs, head: (name, words) => { title.replaceChildren(name); line.replaceChildren(words); } });
  // Opened from a Space's Add to this Space… with its place chosen (`start`: "project:<id>").
  else if (page === "skills") renderSkills(body, { onToast: cb.onToast, start: taken?.start || cb.start || null, acts: titleActs });
  // At its connectors part where the address or the door named Connectors: opened from a Space's or a project's door
  // with its place chosen (`start`: "project:<id>"), from a Settings result on a connector's row.
  else if (page === "plugins") {
    const atConnectors = at.part === "connectors" || libraryOf(String(taken?.section || ""))?.page === "connectors";
    renderPlugins(body, { ...cb, open: at.scope || null, connectors: { at: atConnectors, start: taken?.start || null, finish: taken?.finish || null } });
  } else renderMemoryBrowser(body, { ...cb, scope: at.scope || null });
  if (taken) lightRow(body, taken);
}
