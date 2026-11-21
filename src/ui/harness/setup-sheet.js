// @ts-check
// The setup sheets (proposal_ux §4.6, R1): what Overview's How it is set up widgets change, each on a sheet of its own —
// the settings the Session inspector's tabs held, drawn with the same shared editor (`sectionCard`) over the session's
// own document. A sheet reads the document when it opens and again after every write, so a row never flips back to
// what it first drew; a write lands from the next turn, as the editor's toast says. The inspector's old addresses
// (`#/context/<tab>`) open the sheet that took the tab's place, over Overview (`OLD_TABS`); its Context Map is the Next
// request pane's. Who runs this chat opens on the teams to hand the chat to (widgets/hand.js, R4), above its settings;
// the models its agents run on are its Agents tab's, never this sheet's (the owner's plan of 11-05: three places at most).
import { h } from "../lib/dom.js";
import { api } from "./lib/api.js";
import { ICONS } from "./lib/icons.js";
import { sheet } from "./lib/ui.js";
import { SECTIONS } from "../lib/settings/knobs.js";
import { sectionCard, historyList } from "../lib/settings/editor.js";
import { createInspectorCallbacks } from "./context-callbacks.js";
import { createMcpList } from "./lib/mcp-list.js";
import { routeFor } from "./lib/router.js";
import { handSection } from "./widgets/hand.js";
import { state } from "./state.js";
import { teamsOn } from "../lib/teams-on.js";

/**
 * Each sheet: its title and glyph as its widget says them, the line under the title, and the settings' sections it
 * draws (knobs.js `SECTIONS`). `mcp`: this chat's connectors, the list Library › Plugins & Connectors draws, for this chat;
 * `history`: the settings' changes, from the operation log.
 * @typedef {{ title: string, icon: string, line: string, sections: readonly string[], mcp?: boolean, history?: boolean }} SetupSheet
 */

/** @type {Readonly<Record<string, SetupSheet>>} */
export const SETUP_SHEETS = Object.freeze({
  who: { title: "Who runs this chat", icon: "bot", line: "The engine that answers — the model you pick, the agent loop, or a lead and its team — and how its sub-agents work. The models they run on are its Agents tab's.", sections: ["agents"] },
  may: { title: "What it may do", icon: "shieldCheck", line: "What the agent may do without asking, the tools it has, and the connectors this chat gets.", sections: ["loop"], mcp: true },
  memory: { title: "Memory", icon: "brain", line: "What memory brings into this chat and learns from it. Off mutes it here; what you say is still kept.", sections: ["memory"] },
  rules: { title: "Instructions and rules", icon: "scrollText", line: "The project's instruction files, your skills, hooks on tool events, connectors and the web tools, and what a new worktree gets.", sections: ["instructions"] },
  fork: { title: "Forks and privacy", icon: "gitFork", line: "What a fork of this chat takes with it, and what memory and search may read of it.", sections: ["fork", "privacy"] },
  history: { title: "Changes to its settings", icon: "rotateCcw", line: "Every change of this chat's settings, newest first; each lands on the next turn.", sections: ["display"], history: true },
});
/** Who runs this chat's line while Settings › Experimental's Teams switch is off (src/ui/lib/teams-on.js). */
const WHO_LINE_ALONE = "The engine that answers — the model you pick, or the agent loop — and how its sub-agents work. The models they run on are its Agents tab's.";

/**
 * Where each of the Session inspector's tabs went (R1): a setup sheet, or — the Context Map — the Next request pane.
 * The address `#/context/<tab>` opens it there; a tab the inspector never had opens Overview alone.
 */
export const OLD_TABS = Object.freeze({ map: "next-request", behavior: "may", memory: "memory", teamwork: "who", rules: "rules", fork: "fork", history: "history" });

/**
 * Open a setup sheet over the chat.
 * @param {string} id  one of SETUP_SHEETS
 * @param {{ chainId: string, onToast: (msg: string, kind?: string) => void, draft?: () => string, onChanged?: () => void,
 *   open?: (id: string) => void, hand?: () => import("./widgets/hand.js").HandIO }} o  `onChanged`:
 *   a write landed — the page reads the session's view again; `open`: another sheet, where this one points to it;
 *   `hand`: the teams to hand the chat to, read as Who runs this chat draws — a press there closes the sheet first, for
 *   the switch's own sheet or the team editor
 * @returns {{ close: () => void } | null}  null for a sheet that does not exist
 */
export function openSetupSheet(id, o) {
  const spec = SETUP_SHEETS[id];
  if (!spec) return null;
  const chainId = o.chainId;
  const box = h("div", { class: "setup-sheet-box" }, h("p", { class: "setup-sheet-wait" }, "Reading this chat's settings…"));
  /** @type {any} */
  let doc = null;
  /** @type {ReturnType<typeof createMcpList> | null} */
  let mcp = null;
  const reload = () =>
    api(`/sessions/${encodeURIComponent(chainId)}/settings`)
      .then((d) => {
        doc = d;
        if (box.isConnected) draw();
      })
      .catch((e) => box.replaceChildren(h("p", { class: "setup-sheet-err" }, String(/** @type {any} */ (e)?.message || e))));
  const icb = createInspectorCallbacks({
    chainIdOf: () => chainId,
    docOf: () => doc,
    reload: () => {
      void reload();
      o.onChanged?.();
    },
    onToast: o.onToast,
    ...(o.draft ? { draft: o.draft } : {}),
  });
  /** The rules sheet's row for the connectors: they are on What it may do now, one press away. */
  const mcpElsewhere = () =>
    h("div", { class: "setup-sheet-elsewhere" },
      h("span", {}, "This chat's connectors are on What it may do."),
      o.open ? h("button", { class: "inst-link", type: "button", onclick: () => { s.close(); o.open?.("may"); } }, "Open it") : null);
  const history = spec.history ? h("div", { class: "setup-sheet-history" }, historyList(null)) : null;
  function draw() {
    if (!doc) return;
    // A plugin's sheet is a Library page: the sheet makes way for it.
    mcp ||= spec.mcp ? createMcpList({ scope: `chat:${chainId}`, at: "session", onToast: o.onToast, title: "Connectors for this chat", openPlugin: (pid) => { s.close(); location.hash = routeFor("library", { page: "plugins", scope: pid }); } }) : null;
    /** @type {Record<string, HTMLElement>} */
    const parts = id === "rules" ? { "plugins.mcp": mcpElsewhere() } : {};
    const cards = spec.sections
      .map((sid) => SECTIONS.find((/** @type {any} */ x) => x.id === sid))
      .filter(Boolean)
      .map((/** @type {any} */ x) => sectionCard(x, doc, icb, { instructions: h("span", { class: "muted small" }, "") }, { filamentRuns: true, parts, teams: teamsOn(state.config) }))
      .filter(Boolean);
    // The teams it can be handed to, while Settings › Experimental's Teams switch is on.
    const hand = id === "who" && teamsOn(state.config) ? o.hand?.() : null;
    const handEl = hand
      ? handSection({ ...hand, lead: (team) => { s.close(); hand.lead(team); }, newTeam: () => { s.close(); hand.newTeam(); } })
      : null;
    box.replaceChildren(...[handEl, history, mcp?.el, ...cards].filter((x) => x != null));
  }
  const head = h("div", { class: "setup-sheet-head" },
    h("span", { class: `setup-sheet-ic setup-${id}`, html: ICONS[spec.icon] || "" }),
    h("div", { class: "setup-sheet-titles" },
      h("h2", { class: "setup-sheet-title" }, spec.title),
      h("p", { class: "setup-sheet-line" }, id === "who" && !teamsOn(state.config) ? WHO_LINE_ALONE : spec.line)));
  const s = sheet({ label: spec.title, head, body: h("div", { class: "setup-sheet-body" }, box), class: "setup-sheet" });
  void reload();
  if (history)
    icb.loadHistory()
      .then((hist) => { if (history.isConnected) history.replaceChildren(historyList(hist)); })
      .catch((e) => history.replaceChildren(h("p", { class: "setup-sheet-err" }, String(/** @type {any} */ (e)?.message || e))));
  return s;
}
