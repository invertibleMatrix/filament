// @ts-check
// Settings › Agent loop (HarnessV4_Settings_Plan HS-4): Filament's own agent, drawn by hand (the owner's of 11-09: "what
// the hell is this hard coded json, get rid of it"): only what is set here, each row with a control of its own — no
// list as JSON or as lines of text. The folders it may work in, a list with Browse and × as Permissions' folders are
// (the fence on a listener open beyond this machine, said over it); the reader's model on Settings' model picker; the
// result cap; tree snapshots; the variables its commands are given beside what a build needs, a list of names as the
// folders are (`agentLoop.envPass`, r-hands of 11-12); where sub-agents that change files work, in the New chat board's
// words; the web hands.
// What another place sets is left to it (ui/lib/agent-loop-rows.js), and so is the loop's system prompt, the console's
// Prompts page's. Each row is kept at once (lib/config-rows.js). Under them, whether a turn a restart cut off goes on
// by itself (`sessions.resumeAfterRestart`, HarnessV3-TaskGraph-v2 TG2-D83): a chat's, a coding agent's too. And after
// how many minutes Filament checks in on an agent that ended its turn while its background command runs on
// (`sessions.idleWakeMinutes`, app/sessions/idle-wake.js, the owner's of 11-08), 0 for never. Last, whether a commit the
// agent makes ends with Filament's co-author line (`sessions.commitTrailer`, the loop's prompt version 108), on by default.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { segment } from "../lib/fields.js";
import { browseFolder, pathExample } from "../lib/folder-browse.js";
import { state } from "../state.js";
import { mountConfigPage, valueWords } from "../lib/config-rows.js";
import { createModelSelect } from "../composer/model.js";
import { WORKSPACE_SEG } from "../conversation/start-board.js";

/** The idle wake's row, as the page and its search name it. */
const IDLE_LABEL = "Check in on an idle agent after (minutes)";
/** The co-author line's row, as the page and its search name it. */
const TRAILER_LABEL = "Filament as co-author on commits";
/** The row of the variables commands are given whatever their names read like, as the page and its search name it. */
const PASS_LABEL = "Variables passed to commands";
/** What that row lists, under its name. */
const PASS_DESC = "Commands Filament runs get what a build, a test or git needs of your environment and nothing that reads like a secret. A variable named here is passed whatever its name or value says: a proxy whose address carries a password, a licence file's path, an SDK's home. Names only, never a value.";
/** What the reader's model does, under its row. */
const READER_DESC = "A cheap model that reads files for the agent and answers its one question (delegate_read), so the agent's own context never carries them. Not set: the agent reads for itself. A coding agent's model reads with hands of its own, so none is offered.";
/** Where sub-agents edit, before the words of the choice in force. */
const WHERE_DESC = "Where sub-agents that change files work, in every chat that has not chosen its own on its New chat board.";

/** Settings search's words for this page (search.js, HS-D68): each row it draws, in its order. */
export const SEARCH_ROWS = Object.freeze([
  { path: "agentLoop.roots", label: "Roots" },
  { path: "agentLoop.readerModel", label: "Reader model", desc: READER_DESC },
  { path: "agentLoop.resultCapChars" },
  { path: "agentLoop.treeSnapshots" },
  { path: "agentLoop.envPass", label: PASS_LABEL, desc: PASS_DESC },
  { path: "agentLoop.subagents.workspace", label: "Where they edit", desc: WHERE_DESC },
  { path: "agentLoop.web.searchEndpoint" },
  { path: "agentLoop.web.searchProvider" },
  { path: "agentLoop.web.searchApiKey" },
  { path: "agentLoop.web.allowPrivate" },
  { path: "sessions.resumeAfterRestart", label: "Go on after a restart" },
  { path: "sessions.idleWakeMinutes", label: IDLE_LABEL },
  { path: "sessions.commitTrailer", label: TRAILER_LABEL },
]);

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void, onChanged?: () => void }} [cb]
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, modelSelect?: typeof createModelSelect, pick?: any }} [io]
 *   `modelSelect`: the model picker; `pick`: the computer's own folder dialog (lib/folder-browse.js)
 */
export function renderAgentLoop(body, cb = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const pickModel = io.modelSelect || createModelSelect;
  /** The models a route answers, as the composer's picker offers them; read once, then handed to the picker drawn last. */
  const offered = { models: /** @type {any[]} */ ([]), families: /** @type {any[]} */ ([]) };
  /** @type {ReturnType<typeof createModelSelect> | null} */
  let picker = null;
  /** What is typed in Roots' field outlives the page drawn again: a refused path stays to be put right (HC-84). */
  let typed = "";
  /** And what is typed in the variables' field, the same way. */
  let typedName = "";

  mountConfigPage(body, cb, io, {
    // Over the rows, a listener open beyond this machine while no root is listed, in the server's words (`exposed` on
    // /state): Roots below is where it ends.
    rows: (kit) => [
      kit.state?.exposed ? kit.note(kit.state.exposed, "warn") : null,
      kit.head("Where it works"),
      kit.field("agentLoop.roots", { label: "Roots", wide: true, control: () => rootsList(kit) }),
      kit.head("Its tools"),
      kit.field("agentLoop.readerModel", { label: "Reader model", desc: READER_DESC, control: () => readerPick(kit) }),
      kit.field("agentLoop.resultCapChars"),
      kit.field("agentLoop.treeSnapshots"),
      kit.head("Its commands"),
      kit.field("agentLoop.envPass", { label: PASS_LABEL, desc: PASS_DESC, wide: true, control: () => namesList(kit) }),
      kit.head("Sub-agents"),
      kit.field("agentLoop.subagents.workspace", { label: "Where they edit", desc: `${WHERE_DESC} ${whereNow(kit)[2]}.`, wide: true, control: (label) => whereSeg(kit, label) }),
      kit.head("Web"),
      kit.field("agentLoop.web.searchEndpoint"),
      kit.field("agentLoop.web.searchProvider"),
      kit.field("agentLoop.web.searchApiKey"),
      kit.field("agentLoop.web.allowPrivate"),
      kit.head("After a restart"),
      kit.field("sessions.resumeAfterRestart", { label: "Go on after a restart" }),
      kit.head("While a command runs"),
      kit.field("sessions.idleWakeMinutes", { label: IDLE_LABEL }),
      kit.head("Commits"),
      kit.field("sessions.commitTrailer", { label: TRAILER_LABEL }),
    ].filter(Boolean),
  });
  // A coding agent's model is no reader: one would read with hands of its own (the server refuses it at the turn).
  call("/models?all=1").then((c) => {
    offered.models = (c?.models || c?.data || []).filter((/** @type {any} */ x) => !x?.codingAgent);
    offered.families = (c?.families || []).filter((/** @type {any} */ f) => !f?.codingAgent);
    picker?.setModels(offered.models);
    picker?.setFamilies?.(offered.families);
  }, () => {});

  /** Roots: each folder with its ×, then a path to add, typed or browsed. @param {import("../lib/config-rows.js").ConfigKit} kit */
  function rootsList(kit) {
    const path = "agentLoop.roots";
    const now = kit.value(path);
    const list = Array.isArray(now) ? now.map(String) : [];
    // The page is drawn again before a write answers: a path the list now holds was kept, and its field is emptied.
    if (list.includes(typed.trim())) typed = "";
    /** @param {string[]} next */
    const keep = (next) => kit.setField(path, next);
    const items = list.map((f, i) => m("div", { class: "nset-item" }, m("span", { class: "nset-path" }, f),
      m("button", { class: "nset-x", type: "button", title: `Stop working in ${f}`, "aria-label": `Remove ${f}`, html: ICONS.x, onclick: () => void keep(list.filter((_, j) => j !== i)) })));
    const input = /** @type {any} */ (m("input", { class: "zc-input nset-in nset-mono", type: "text", placeholder: `A whole path: ${pathExample(state.platform, "work", "D")}`, spellcheck: "false", autocomplete: "off", "aria-label": "A folder to add", value: typed }));
    const dirs = m("div", { class: "browse-dirs hidden" });
    const add = async () => {
      const p = String(input.value || "").trim();
      if (!p) { input.focus?.(); return; }
      if (list.includes(p)) { cb.onToast?.(`${p} is listed already`); return; }
      typed = p;
      await keep([...list, p]);
    };
    input.oninput = () => { typed = String(input.value || ""); };
    input.onkeydown = (/** @type {KeyboardEvent} */ e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } };
    const adder = m("div", { class: "nset-add" }, input,
      m("span", { class: "nset-add-acts" },
        m("button", { class: "ghost sm", type: "button", onclick: () => void browseFolder(input, /** @type {any} */ (dirs), (w) => cb.onToast?.(w, "err"), io) }, "Browse…"),
        m("button", { class: "ghost sm", type: "button", onclick: () => void add() }, "Add")));
    return m("div", { class: "nset-list" },
      items.length ? m("div", { class: "nset-items" }, ...items) : m("p", { class: "nset-none" }, "None: any folder, while Filament is reached from this computer alone. Reached from beyond it, no turn runs until one is listed."),
      adder, dirs);
  }

  /** The variables passed to commands: each name with its ×, then a name to add, as Roots' folders are. @param {import("../lib/config-rows.js").ConfigKit} kit */
  function namesList(kit) {
    const path = "agentLoop.envPass";
    const now = kit.value(path);
    const list = Array.isArray(now) ? now.map(String) : [];
    // As Roots': a name the list now holds was kept, and its field is emptied; a refused one stays to be put right.
    if (list.includes(typedName.trim())) typedName = "";
    /** @param {string[]} next */
    const keep = (next) => kit.write({ set: { [path]: next } }, (r) => `${PASS_LABEL}: ${valueWords(r.values?.[path])}`);
    const items = list.map((n, i) => m("div", { class: "nset-item" }, m("span", { class: "nset-path" }, n),
      m("button", { class: "nset-x", type: "button", title: `Stop passing ${n}`, "aria-label": `Remove ${n}`, html: ICONS.x, onclick: () => void keep(list.filter((_, j) => j !== i)) })));
    const input = /** @type {any} */ (m("input", { class: "zc-input nset-in nset-mono", type: "text", placeholder: "A variable's name: HTTPS_PROXY", spellcheck: "false", autocomplete: "off", "aria-label": "A variable to pass", value: typedName }));
    const add = async () => {
      const n = String(input.value || "").trim();
      if (!n) { input.focus?.(); return; }
      if (list.includes(n)) { cb.onToast?.(`${n} is listed already`); return; }
      typedName = n;
      await keep([...list, n]);
    };
    input.oninput = () => { typedName = String(input.value || ""); };
    input.onkeydown = (/** @type {KeyboardEvent} */ e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } };
    const adder = m("div", { class: "nset-add" }, input, m("span", { class: "nset-add-acts" }, m("button", { class: "ghost sm", type: "button", onclick: () => void add() }, "Add")));
    return m("div", { class: "nset-list" },
      items.length ? m("div", { class: "nset-items" }, ...items) : m("p", { class: "nset-none" }, "None: only what Filament passes by itself."),
      adder);
  }

  /** Reader model: Settings' model picker; Use the default puts none back. @param {import("../lib/config-rows.js").ConfigKit} kit */
  function readerPick(kit) {
    const path = "agentLoop.readerModel";
    const pick = pickModel({
      onChange: (name) => void kit.setField(path, name),
      onUseDefault: () => void kit.write({ unset: [path] }, () => "Reader model: none, the agent reads for itself"),
      defaultDesc: "None: the agent reads for itself",
      blank: "None",
    });
    pick.el.setAttribute("aria-label", "Reader model");
    pick.setModels(offered.models);
    pick.setFamilies?.(offered.families);
    pick.set(String(kit.value(path) || ""));
    picker = pick;
    return pick.el;
  }

  /** The choice in force, as the New chat board's row reads it. @param {import("../lib/config-rows.js").ConfigKit} kit */
  function whereNow(kit) {
    const w = String(kit.value("agentLoop.subagents.workspace") || "");
    return WORKSPACE_SEG.find(([id]) => id === w) || WORKSPACE_SEG[0];
  }

  /** Where they edit: the board's four, each with its words on hover. @param {import("../lib/config-rows.js").ConfigKit} kit @param {string} label */
  function whereSeg(kit, label) {
    const path = "agentLoop.subagents.workspace";
    const [now] = whereNow(kit);
    return segment(m, WORKSPACE_SEG.map(([value, name, title]) => ({ value, label: name, title })), now, (v) => {
      if (v !== now) void kit.write({ set: { [path]: v } }, (r) => `${label}: ${WORKSPACE_SEG.find(([id]) => id === r.values?.[path])?.[1] || r.values?.[path]}`);
    }, label);
  }
}
