// @ts-check
// The Start (proposal_ux §4.13, mock-newtask; HarnessV3-NewTask before it): how a new chat will start, before the first
// send, on one screen (the design pass of 10-24, UX5). Three questions in one card — who runs it, where it works
// (works-in.js draws that row's control), what it starts from, with how many changes are held and one Undo all — then
// the first request: what the model will get with your message, live as you type (NT-D5), and who builds it; then
// every card, open, in two columns. Every engine has every card: what one does not read is greyed, with why, never
// hidden (D8). The figures are the server's (`POST /sessions/draft-start`, weighed by the functions the turn itself
// uses, NT-D6); a value that is not the dashboard's says where it comes from (NT-D2); every control holds its change on
// the chat until the first send (NT-D7), and a row it changed has a dot and ↺, which puts back what the start gives (the
// answer's `base`). The board draws and holds — its host (empty.js) asks the server, and the cards never fetch.
import { h } from "../../lib/dom.js";
import { WORDS } from "../lib/words.js";
import { menu } from "../lib/ui.js";
import { head, hero, group, row, section, note, link, segmented, slider, switchRow, stackBar, tok, kids, icon } from "../widgets/kit.js";
import { MODES } from "../composer/mode.js";
import { createModelSelect } from "../composer/model.js";
import { MEMORY_SWITCHES } from "../widgets/memory.js";
import { MAY_ASK_SUB, mayAskRow } from "../widgets/may-ask.js";
import { createPoolChip } from "../widgets/pool.js";
import { createRunsOn } from "../widgets/runs-on.js";
import { isDefaultPool, poolPatch, poolRows } from "../lib/pool.js";
import { WAYS, methodOf, methodName, roomWords, wayName } from "../../lib/context-words.js";
import { METHODS, LINE_MIN, LINE_MAX } from "../widgets/compaction.js";
import { cap } from "../../lib/accounts.js";
import { CONNECT_URL, CONSOLE_WINDOW } from "../lib/catalogue.js";
import { leadsWords, readsOnly, readsOnlyAhead, runByWords, teamOf } from "../lib/team.js";
import { prettyModel } from "../lib/families.js";
import { placeName } from "../lib/labels.js";
import { isBuildTeam } from "../lib/agent-cards.js";

/** @typedef {typeof h} Mk */

/** The first request's parts in the order the bar draws them, each in the color of the card it belongs to. */
export const PARTS = Object.freeze({
  prompt: { label: "Filament's agent prompt", color: "var(--inst-label-3)" },
  instructions: { label: "Instructions", color: "var(--color-sys-yellow)" },
  skills: { label: "Skills", color: "var(--color-sys-mint)" },
  tools: { label: "Tools", color: "var(--color-sys-gray)" },
  memory: { label: "Memory", color: "var(--color-sys-pink)" },
  message: { label: "Your message", color: "var(--color-sys-blue)" },
});

/** The tools as the Tools card groups them; a name the loop does not offer this task is not drawn. */
export const TOOL_GROUPS = Object.freeze([
  { label: "Files", names: ["read", "glob", "grep", "lsp", "write", "edit"] },
  { label: "Shell", names: ["bash", "bash_background", "bash_output", "bash_kill", "powershell"] },
  { label: "Team", names: ["agent", "ask", "plan", "delegate_read"] },
  // The agent's browser rides with the web (HarnessV4_Browser_Plan BR2), on its own switch.
  { label: "Web", names: ["web_fetch", "web_search", "browser"] },
  // The agent's pictures in the chat; the switch takes their guide (visual_guide) with it.
  { label: "Visuals", names: ["show_visual"] },
  // The agent's pages kept apart from the chat, in the Artifacts list (HarnessV4_Artifacts_Plan AF-D3).
  { label: "Artifacts", names: ["artifact"] },
  // The project's board and logbook (proposal_ux §4.14): offered wherever the chat belongs to a project (TV2-D7).
  { label: "Space", names: ["space"] },
  // The main agent's tool that fires a team beside the chat (team_v2_plan §5.5): apart from Team's sub-agents, whose
  // word it would share.
  { label: "Teams beside", names: ["team"] },
  // The main agent's tool that designs a flow beside the chat when you ask with /flow (HarnessV4_OneAgent_Plan OA3).
  { label: "Flows", names: ["flow"] },
  // The main agent's tool that starts a chat of its own linked to this one, briefed by it (app/threads.js).
  { label: "Threads", names: ["thread"] },
  // The chat's own agent comes back to it later by itself (agent/come-back.js), a coding agent too (x50): on unless
  // switched off here (the Designer's of 10-27).
  { label: "Come back later", names: ["come_back"] },
]);
/**
 * A tool's chip in plain words; its own name — the one the agent calls and `loop.tools` lists — in the chip's title
 * (the design pass of 10-24: `bash_background`, `delegate_read` were the builder's words). A name not here shows as it is.
 */
export const TOOL_WORDS = Object.freeze(/** @type {Record<string, string>} */ ({
  read: "Read", glob: "Find files", grep: "Search text", lsp: "Language servers", write: "Write", edit: "Edit",
  bash: "Commands", bash_background: "Background commands", bash_output: "Their output", bash_kill: "Stop them", powershell: "PowerShell",
  agent: "Agents", ask: "Ask you", plan: "Plan", delegate_read: "Reader",
  web_fetch: "Fetch a page", web_search: "Web search", browser: "Browser",
  show_visual: "Pictures", artifact: "Artifacts", space: "Space", team: "Teams", flow: "Flows", thread: "Threads",
  come_back: "Come back later",
}));
/** The loop's tools a coding agent never has of its own, so its Tools card lists none of them as its own: Filament's agent tool comes with every chat. */
const NOT_ITS_OWN = Object.freeze(["agent"]);
/** The permission modes as the Tools card's control reads them, least free to most (the composer's menu orders them by use). */
const PERMISSION_SEG = Object.freeze([["read-only", "Read-only"], ["ask", "Ask"], ["edit", "Edit"], ["auto", "Full"]]);
/** Where sub-agents that change files work (`subagents.workspace`, the owner's plan of 11-09 for big repos): each choice, its label and what it means. Settings › Agent loop's row says it in these words. */
export const WORKSPACE_SEG = Object.freeze([
  ["auto", "Auto", "A patch for builders on Filament's loop, a worktree for coding agents and builders that run commands; changes land in a copy you merge"],
  ["patch", "Patch", "No checkout: only the files they read or write, moved to a worktree once they run a command; changes land in a copy you merge"],
  ["worktree", "Worktree", "A full git worktree each; changes land in a copy you merge"],
  ["folder", "Session folder", "They edit your folder directly, beside the main agent"],
]);
/**
 * The loop's switches that reach a coding agent (draft-start.js `AGENT_REACHES`; the owner's look of 10-24): Filament's
 * browser, pictures, artifacts, Space, teams, flows, threads and its come-back, over its MCP server. Its agent tool comes
 * with every chat.
 */
const AGENT_REACHES = Object.freeze(["browser", "show_visual", "artifact", "space", "team", "flow", "thread", "come_back"]);
/** The web tools and the browser ride on the session's say-so (`plugins.web.*`, `plugins.browser`), not only on `loop.tools`. */
const WEB_KNOB = Object.freeze({ web_fetch: "plugins.web.fetch", web_search: "plugins.web.search", browser: "plugins.browser" });

/**
 * Whether two values of a setting are the same (UX5: a change back to the start's is none): `loop.tools` by the names
 * it sets, in any order, none set the same as null — a name set true is not one left out, which a lower layer may
 * switch off — the rest as JSON.
 * @param {string} path @param {any} a @param {any} b
 */
export function sameValue(path, a, b) {
  if (path === "loop.tools") {
    const set = (/** @type {any} */ v) => JSON.stringify(Object.entries(v && typeof v === "object" ? v : {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
    return set(a) === set(b);
  }
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * What the prompt's Environment section tells the agent, in one line (HarnessV3-SystemPrompt SP-D12): the system, the
 * shell its bash tool runs, the timezone and the branch — null when the loop sends none.
 * @param {{ system?: string, shell?: string, zone?: string, git?: string | null } | null | undefined} env  the answer's `environment`
 */
export function environmentWords(env) {
  if (!env) return null;
  const parts = [env.system, env.shell ? `${env.shell} for commands` : "", env.zone, env.git ? `git ${env.git}` : "not a git repository"].filter(Boolean);
  return `Its prompt says where it runs: ${parts.join(" · ")}.`;
}

/**
 * The bar's rows: each part that weighs something, in the bar's order; memory's is a ceiling (`upTo`).
 * @param {any} d  the draft-start answer
 * @returns {{ id: string, tokens: number, upTo: boolean, label: string, color: string }[]}
 */
export function anatomy(d) {
  return (Array.isArray(d?.parts) ? d.parts : [])
    .filter((/** @type {any} */ p) => Number(p?.tokens) > 0 && Object.hasOwn(PARTS, p.id))
    .map((/** @type {any} */ p) => ({ id: String(p.id), tokens: Number(p.tokens), upTo: !!p.upTo, .../** @type {any} */ (PARTS)[p.id] }));
}

/**
 * Where the first request stands: its tokens (memory at its ceiling), the window and the compaction line, and the tone —
 * orange past the line (compaction cannot help a first request: there is no history to make room in), red past the
 * window.
 * @param {any} d
 */
export function standing(d) {
  const total = anatomy(d).reduce((n, r) => n + r.tokens, 0);
  const window = Number(d?.window?.tokens) || 0;
  const line = Number(d?.line?.tokens) || 0;
  const tone = !window ? "" : total >= window ? "error" : line && total >= line ? "warn" : "";
  return { total, window, line, percent: Number(d?.line?.percent) || 85, tone: /** @type {"" | "warn" | "error"} */ (tone) };
}

/** Whether Filament's loop builds the first request: alone, or as a team's lead (HarnessV3-AtHome P2). @param {any} e */
const loopBuilds = (e) => e?.kind === "loop" || e?.kind === "team";
/**
 * Whether the task has agents of Filament's to launch or ask: Filament's loop with its agent tool, a coding agent with
 * Filament's (HarnessV4_Tasks E12 step 2). A model answering as plain chat has no tools to launch with. @param {any} e
 */
const launches = (e) => loopBuilds(e) || e?.kind === "agent";
/**
 * The list's row under its label (step 8; U13-D15): the default says it is the chat's own model; a list says how an
 * agent takes a model. A coding agent's launches read it as the loop's do, its nameless row the agent's own model (the
 * owner's of 11-06).
 * @param {import("../lib/pool.js").PoolRow[]} rows
 */
export const poolSub = (rows) => (isDefaultPool(rows) ? "Your chat's model" : "An agent takes the first model with room, from the top");

/**
 * Who builds the first request's context, in one sentence (NT-D8).
 * @param {any} e  the answer's engine
 */
export function engineWords(e) {
  switch (e?.kind) {
    case "loop": return "Filament's agent loop runs this chat — this is its first request";
    case "team": return `Team ${e.team.name} leads this chat on Filament's agent loop — this is its lead's first request`;
    case "agent": return e.team
      ? `Team ${e.team.name} leads this chat, its lead the coding agent ${e.model}: it builds its own context, and Filament adds its lead's part and its team's tools`
      : `${e.model} is a coding agent: it builds its own context, and Filament sees its requests once it starts`;
    case "model": return `Filament's agent loop does not run ${e.model}: the turns go to it as plain chat`;
    default: return e?.why ? `Nothing would answer yet — ${e.why}` : "Choose a model to see how the chat starts";
  }
}

/**
 * Who runs the session, as the first question says it (HarnessV4_Tasks E15 step 6, AG-173): the team that leads —
 * null when the agent itself answers — whether a team may be picked, and the one line under the row: a start that asks
 * for a team no team can answer says so, in orange; a task no team can lead says why its second choice is off; a team
 * that changes no file, chosen, says what the server holds the chat to while it leads, before the first send (d-side,
 * 11-12).
 * @param {any} d  the draft-start answer
 * @returns {{ team: import("../lib/team.js").Leading | null, off: boolean, why: string, warn: boolean }}
 */
export function whoRuns(d) {
  const w = d?.who || {};
  const row = w.team ? (w.teams || []).find((/** @type {any} */ t) => t.key === w.team) : null;
  const team = row ? teamOf(row, String(row.key)) : null;
  const warn = !!w.asked && !team;
  const why = warn
    ? `This start asks for a team, and the agent itself answers: ${w.off || w.problem}.`
    : w.off
      ? `No team can lead this chat: ${w.off}.`
      : team && readsOnly(row)
        ? readsOnlyAhead(team.name)
        : "";
  return { team, off: !team && !!w.off, why, warn };
}

/**
 * Where a value comes from, as the board marks it (NT-D2): "changed here" for what this task holds over its start,
 * "this project" for the project's — and nothing for the dashboard's own value or the built-in default, which is what
 * an unmarked value means.
 * @param {string} path @param {any} d @param {Record<string, any>} held  this task's held knobs, flat
 */
export function markOf(path, d, held) {
  if (held && Object.hasOwn(held, path)) return "changed here";
  const s = d?.sources?.[path];
  if (s === "session") return "changed here";
  if (s === "project") return "this project";
  return "";
}

/**
 * Starts from, the third question: where the start comes from — your defaults for the folder, which the cards' values
 * are, and what you change on them held for this chat.
 * @param {any} d
 * @returns {string}
 */
export function fromWords(d) {
  // A chat outside a project (`outside`, no folder chosen) starts from your defaults, in Everything's folder.
  if (d?.outside) return "Your defaults, outside any project.";
  // The defaults are the project's — a worktree's are its repository's (GW-D46), named as the chooser's chip names it.
  const where = d?.projectName ? placeName(String(d.projectName)) : d?.cwd ? placeName(String(d.cwd)) : "";
  return `Your defaults${where ? ` for ${where}` : ""}.`;
}

/** @param {number} n */
const memoriesWords = (n) => `${n} memor${n === 1 ? "y" : "ies"}`;

/**
 * What memory knows that the chat draws on, in one line — null where Memory settings leave the chat out or memory
 * cannot say. In a project: its memories and its dossier. Outside one (`outside`, the chat in Everything): the
 * memories that hold everywhere (`knows.everywhere`, as Library › Memory › Everywhere counts them) and those earlier
 * chats outside a project left, and that recall reaches every project's — it crosses projects (memory/brain.js
 * `retrieve`).
 * @param {any} d  the draft-start answer
 * @returns {string | null}
 */
export function knowsWords(d) {
  const m = d?.memory || {};
  const k = m.knows;
  if (!k || m.out) return null;
  const own = Number(k.memories) || 0;
  if (d?.outside) {
    const all = Number(k.everywhere) || 0;
    return `Knows ${memoriesWords(all)} that ${all === 1 ? "holds" : "hold"} everywhere${own ? `, and ${own} from earlier chats outside a project` : ""}. Your projects' memories join where your messages touch them.`;
  }
  return `Knows ${memoriesWords(own)} about this project${k.dossier ? `, and opens with its dossier (v${k.dossier})` : ""}`;
}

/**
 * A coding agent's way to make room (`context.compaction.agent`), as its tile says it.
 * @param {unknown} id @param {string} who  the agent's name
 */
const agentWayWords = (id, who) =>
  id === "own" ? `${who}'s own way` : id === "self" ? `${who} writes the summary` : id === "ours" ? wayName("ours") : "The suggested way";

/**
 * @typedef {object} HeadWords
 * @property {string} value  the tag at the card's head
 * @property {string} sub  a line more, on the tag's tooltip
 * @property {boolean} [dim]  this engine does not read the card (D8)
 * @property {string} [why]  why, said on the tag's tooltip and in the card
 * @property {"" | "warn" | "error"} [tone]
 */

/**
 * What each card's head says at its end (D5, D8) — the seven tiles' words until the design pass of 10-24 put every card
 * on the screen (UX5): its value, a line more on its tooltip, greyed with why where the engine does not read it. The
 * Context tile's figure is the first request's own. `who` is the coding agent's name ("Claude Code"), `permission` the
 * composer's mode, `main` the task's own model, `held` the changes held for it.
 * @param {any} d
 * @param {{ who?: string, permission: string, main: string, held: Record<string, any> }} o
 * @returns {Record<"memory" | "tools" | "subagents" | "skills" | "compaction" | "instructions", HeadWords>}
 */
export function headWords(d, o) {
  const e = d?.engine || {};
  const loop = loopBuilds(e);
  const coder = e.kind === "agent";
  const who = o.who || "The coding agent";
  const flat = d?.flat || {};
  const part = (/** @type {string} */ id) => Number((d?.parts || []).find((/** @type {any} */ p) => p.id === id)?.tokens) || 0;
  const plainWhy = engineWords(e);
  const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  const m = d?.memory || {};
  // Outside a project, what holds everywhere counts beside Everything's own (`knowsWords`).
  const known = (Number(m.knows?.memories) || 0) + (d?.outside ? Number(m.knows?.everywhere) || 0 : 0);
  // A chat Memory settings leave out (`out`, the server's words for why): memory recalls and learns nothing there, and
  // none of its tools ride.
  const memory = !m.global
    ? { value: "Off", sub: "off in Memory settings" }
    : m.out
      ? { value: "Left out", sub: String(m.out) }
      : !m.on
        ? { value: "Muted", sub: "recording continues" }
        : { value: known ? `On · ${plural(known, "memory", "memories")}` : "On", sub: m.autopilot ? "recalled from your message" : "recording only" };

  const t = d?.tools || {};
  const offered = (t.offered || []).length;
  const mcp = (t.mcp || []).length;
  const lent = offered + (Number(t.memory) || 0) + (t.adds || []).length;
  const added = [lent ? plural(lent, "tool") : "", mcp ? plural(mcp, "server") : ""].filter(Boolean);
  const tools = loop
    ? { value: plural(offered, "tool"), sub: MODES.find((x) => x.id === o.permission)?.label || "" }
    : coder
      ? { value: `${who}'s own`, sub: added.length ? `+ ${added.join(", ")} from Filament` : "nothing from Filament" }
      : { value: "None of the loop's", sub: t.memory ? `memory's ${t.memory} only` : "plain chat", dim: true, why: plainWhy };

  const rows = poolRows(flat["subagents.pool"]);
  const carries = "each sees its task alone";
  const pool = (/** @type {import("../lib/pool.js").PoolRow[]} */ list) =>
    list.length === 1 ? prettyModel(list[0].model || o.main) : `${list.length} models, first with room`;
  const subagents = !launches(e)
    ? { value: "None", sub: "plain chat launches none", dim: true, why: plainWhy }
    : loop && (t.off || []).includes("agent")
      ? { value: "Off", sub: "the agent tool is off", tone: /** @type {"warn"} */ ("warn") }
      : { value: pool(rows), sub: carries };

  const s = d?.skills || {};
  // A coding agent is offered them too, through Filament's skill tool (HarnessV4_Skills_Plan S1-1); plain chat none.
  const skillCount = (s.list || []).length;
  const weight = loop ? part("skills") : 0;
  const skills = !loop && !coder
    ? { value: "None", sub: "plain chat", dim: true, why: plainWhy }
    : {
        value: skillCount ? `${skillCount} on` : "None on",
        sub: (weight ? `${tok(weight)} tokens` : "") || (coder ? (skillCount ? "through Filament's skill tool" : `${who} reads its own skills`) : "Library › Skills turns one on"),
      };

  const percent = Number(flat["context.compaction.thresholdPercent"]) || standing(d).percent;
  const method = String(flat["context.compaction.method"] || "summary");
  const compaction = {
    value: `At ${percent}% · ${flat["context.compaction.mode"] === "auto" ? "by itself" : "ask me"}`,
    sub: coder
      ? agentWayWords(flat["context.compaction.agent"], who)
      : roomWords(method)?.name || methodName(method, { keepWhole: flat["context.compaction.keepWhole"] }),
  };

  const files = d?.instructions?.files || [];
  const extra = String(o.held["instructions.session"] ?? flat["instructions.session"] ?? "").trim();
  const instructions = loop
    ? { value: files.length ? `${files[0].file}${files.length > 1 ? ` +${files.length - 1}` : ""}` : "No file", sub: extra ? "+ your words" : "+ nothing extra" }
    : coder
      ? { value: `${who}'s own`, sub: "it reads its own files", dim: true, why: `${who} reads its own instruction files; Filament's ride its loop's prompt` }
      : { value: "None", sub: "plain chat", dim: true, why: plainWhy };

  return { memory, tools, subagents, skills, compaction, instructions };
}

/**
 * `loop.tools` once a tool's chip flips: the value as it resolves, with the name set on or off. A name switched back
 * on is set true, not dropped — the held object replaces the start's whole, and a tool your defaults (or the project)
 * switched off would stay off under a dropped name.
 * @param {any} current  `loop.tools` as it resolves @param {string} name @param {boolean} on
 */
export function toolsAfter(current, name, on) {
  return { ...(current && typeof current === "object" ? current : {}), [name]: on };
}

/**
 * @typedef {object} BoardIO
 * @property {() => Record<string, any>} held  the changes this task holds over its start, flat — what Reset drops
 * @property {(path: string, value: any) => void} set  hold a change on the chat
 * @property {(path: string) => void} unset  drop a held change
 * @property {() => string} permission  the composer's permission mode
 * @property {(id: string) => void} setPermission  move the composer's permission chip
 * @property {() => any[]} models  the model rows a picker offers
 * @property {() => any[]} [families]  the catalogue's families: the levels a row's model takes, for its effort
 * @property {() => any[]} [teams]  every team as Library holds it, with its lead's and its workers' models: Who runs on what's
 * @property {() => boolean} [teamsOn]  Settings › Experimental's Teams switch (src/ui/lib/teams-on.js): off, Who runs it
 *   is not asked, and the agent itself runs the task
 * @property {import("../widgets/pool.js").PoolChipIO["facts"]} [poolFacts]  what the rows of the chat's list take
 *   now, for its editor
 * @property {() => { cards: readonly import("../lib/agent-cards.js").AgentCard[], asks: readonly string[],
 *   find?: (tag: string) => import("../lib/agent-cards.js").AgentCard | null }} agents
 *   your saved agents, any card by its tag (a team's lead's too), and the tags ticked
 *   "The main agent may ask it"
 * @property {() => void} manageAgents  Settings › Agents, where a card's start is set
 * @property {() => void} manageMcp  Library › Plugins & Connectors, where the connectors a task starts with are set
 * @property {() => void} [manageSkills]  Library › Skills, where a skill is turned on for all chats or a project
 * @property {(keys: unknown) => string[]} [teamNames]  the teams a list names by key (the draft answer's `agentTeams`,
 *   `subagents.teams` as the server reads it), by their names: "Your agent may use" says them after the agents
 * @property {() => string} mainModel  the task's own model
 * @property {() => string} [modelWords]  that model as the composer's chip names it ("Opus 5.5"); else its id made
 *   readable
 * @property {() => string} [agentName]  the coding agent the task's model runs on, by its name ("Claude Code"); empty
 *   for another engine
 * @property {() => void} reset  drop every held change
 * @property {{ control: HTMLElement, line: HTMLElement }} [worksIn]  the second question's control and the line under
 *   it, drawn by works-in.js (none: the row is not drawn)
 */

/**
 * The board: built once per new chat, painted with each answer, every card with it. The Instructions card's text box
 * persists across paints, so typing in it never loses the caret.
 * @param {BoardIO} io @param {{ h?: Mk, modelSelect?: typeof createModelSelect, poolChip?: typeof createPoolChip, menu?: typeof menu }} [o]
 *   `modelSelect` is the composer's picker, `poolChip` the pool's chip and `menu` the popover menus (the compaction
 *   widget's seam: a test draws the board without a browser)
 * @returns {{ el: HTMLElement, paint: (d: any) => void, pending: (on: boolean) => void, failed: (why: string) => void }}
 */
export function createStartBoard(io, o = {}) {
  const mk = o.h || h;
  const modelSelect = o.modelSelect || createModelSelect;
  const poolChip = o.poolChip || createPoolChip;
  const openMenu = o.menu || menu;
  /** @type {any} */
  let d = null;
  const flat = (/** @type {string} */ p) => d?.flat?.[p];
  /**
   * Who runs on what (widgets/runs-on.js; the owner's plan of 11-05): this chat's rows for its agents and its teams,
   * held like every change until the first send. Made once, so a paint keeps it open or folded.
   */
  const runsOnPanel = createRunsOn({
    cards: () => io.agents().cards,
    teams: () => io.teams?.() || [],
    // A chat's own alone, as its list (session-only): what is held, at once — a second edit before the server's answer
    // builds on the first (the review of 11-05).
    byCard: () => io.held()["subagents.byCard"] ?? null,
    byTeam: () => io.held()["subagents.byTeam"] ?? null,
    setByCard: (next) => (next ? choose("subagents.byCard", next) : io.unset("subagents.byCard")),
    setByTeam: (next) => (next ? choose("subagents.byTeam", next) : io.unset("subagents.byTeam")),
    everyone: () => flat("subagents.pool"),
    // The team the draft's engine says leads it, by its key whatever the draft calls it — none where it cannot, and its
    // turns go to the model (the review of 8a278df79) —, as the Agents tab reads them.
    leading: () => engine().team?.key ?? null,
    ownList: () => own("subagents.pool"),
    card: (tag) => io.agents().find?.(tag) ?? null,
    pick: () => {
      const model = String(flat("engine.teamWorkers") || "");
      const effort = String(flat("engine.teamEffort") || "");
      return model || effort ? { model, effort } : null;
    },
    main: () => io.mainModel(),
    models: () => io.models() || [],
    families: () => io.families?.() || [],
    ...(io.poolFacts ? { facts: io.poolFacts } : {}),
    inherit: () => ({ level: String(flat("model.effort") || "model"), desc: "The main agent's effort, as this chat starts" }),
  }, { h: mk, poolChip });
  /** Whether the chat holds its own value of a setting: a change made here (NT-D7). @param {string} p */
  const own = (p) => Object.hasOwn(io.held(), p);
  /** Where a value comes from, under its row; a change made here says so by its dot instead (UX5). @param {string} p */
  const mark = (p) => (own(p) ? "" : markOf(p, d, io.held()));
  /**
   * Hold a change on the chat (NT-D7); the host asks the server again and the board repaints with the answer. A change
   * back to what the start gives drops the held one, and a choice of the value it has holds nothing (UX5).
   * @param {string} path @param {any} value
   */
  const choose = (path, value) => {
    const base = d?.base || {};
    if (own(path) && Object.hasOwn(base, path) && sameValue(path, value, base[path])) return io.unset(path);
    if (!own(path) && sameValue(path, value, flat(path))) return;
    io.set(path, value);
  };
  /**
   * ↺ (UX5): puts back what the chat starts with.
   * @param {string} what  what it puts back, said on the button @param {() => void} run
   */
  const undoBtn = (what, run) => mk("button", { class: "nt-undo", type: "button", title: `Put back ${what} as the chat starts: drop your change`, "aria-label": `Put back ${what}`, onclick: () => run() }, icon(mk, "rotateCcw", "nt-undo-ic"));
  /** What ↺ runs for `paths`: drops the chat's changes of them — null while it holds none. @param {string[]} paths */
  const dropper = (paths) => {
    const mine = paths.filter(own);
    return mine.length ? () => { for (const p of mine) io.unset(p); } : null;
  };
  /**
   * A row the chat changed: a dot before its name and ↺ at its end, beside the row (a row can be a button).
   * @param {any} rowEl @param {string} what @param {string[]} paths
   */
  const owned = (rowEl, what, paths) => {
    const run = dropper(paths);
    return run ? mk("div", { class: "nt-own" }, rowEl, undoBtn(what, run)) : rowEl;
  };
  /** A section's title, with its dot and ↺ while `run` puts something back. @param {string} title @param {(() => void) | null} run */
  const ownTitle = (title, run) => (run ? mk("span", { class: "nt-own-k" }, title, undoBtn(title, run)) : title);
  /** The coding agent's name, as a sentence's subject and inside one. */
  const who = () => io.agentName?.() || "";
  const whoIn = () => who() || "the coding agent";
  /** The task's model in words, as the composer's chip says it. */
  const modelWords = () => io.modelWords?.() || (io.mainModel() ? prettyModel(io.mainModel()) : "");
  const engine = () => d?.engine || {};

  /**
   * One question: its words on the left with a quiet line under them, its controls on the right, and what it says
   * under the controls.
   * @param {string} id @param {string} k @param {string} sub @param {any[]} ctl @param {any[]} [under]
   */
  const question = (id, k, sub, ctl, under = []) =>
    mk("div", { class: `nt-q nt-${id}`, "aria-label": id },
      mk("div", { class: "nt-q-k" }, mk("span", { class: "nt-q-name" }, k), mk("small", {}, sub)),
      mk("div", { class: "nt-q-ctl" }, ...ctl),
      ...under);

  // ---- who runs it (AG-173) -------------------------------------------------------------------------------------
  // The second choice opens the teams; with one chosen it reads the team's name, and the line under it says who that
  // is.
  const whoSelf = mk("button", { class: "inst-seg-btn", type: "button", onclick: () => alone() }, icon(mk, "bot", "nt-seg-ic"), "The agent itself");
  const whoTeamText = mk("span", {});
  const whoTeam = /** @type {HTMLButtonElement} */ (mk("button", { class: "inst-seg-btn", type: "button", "aria-haspopup": "menu", onclick: (/** @type {Event} */ e) => { e.stopPropagation(); teamMenu(); } },
    icon(mk, "users", "nt-seg-ic"), whoTeamText, icon(mk, "chevronDown", "nt-who-chev")));
  const whoMark = mk("span", { class: "nt-who-mark" });
  const whoNote = mk("span", { class: "nt-q-note nt-who-note" });
  const whoBy = mk("span", { class: "nt-who-by" });
  // A team's crew runs on the chat's list (U13-D14), set on the agents' card below: nothing of its own here.
  /** The chat's list held as an order, like every change until the first send. @param {any[]} next */
  const choosePool = (next) => choose("subagents.pool", poolPatch({}, next).subagents.pool);
  const whoRun = mk("div", { class: "nt-q-under nt-who-run hidden" }, whoBy);
  const whoWhy = mk("p", { class: "nt-q-under nt-who-why", role: "status" });
  const whoEl = question("who", "Who runs it", "one agent, or a lead and its team",
    [mk("div", { class: "inst-seg nt-who-seg", role: "group", "aria-label": "Who runs it" }, whoSelf, whoTeam), whoMark, whoNote],
    [whoRun, whoWhy]);

  // ---- works in (HarnessV4_Git_Plan step 5): works-in.js draws the control and the line under it ------------------
  const whereEl = io.worksIn
    ? question("where", "Works in", "where it changes files", [io.worksIn.control], [mk("div", { class: "nt-q-under" }, io.worksIn.line)])
    : null;

  // ---- starts from: your defaults, and what this chat changes on them (NT-D3) -------------------------------------
  const fromNote = mk("span", { class: "nt-q-note nt-from-note" });
  // How many changes the chat holds, and one ↺ for them all (UX5), where Reset was; with none, that nothing starts until
  // you send (AH-D3), said once.
  const undoAll = mk("span", { class: "nt-undo-all" });
  const status = mk("span", { class: "nt-status", role: "status" });
  const fromEl = question("from", "Starts from", "your settings, then what you change below", [fromNote, undoAll, status]);

  const askEl = mk("section", { class: "nt-ask nt-card", "aria-label": "The start's questions" }, ...kids([whoEl, whereEl, fromEl]));

  // ---- the cards: every one open, in two columns (UX5) ------------------------------------------------------------
  /** @param {string} id */
  const card = (id) => mk("section", { class: `nt-card inst inst-nt-${id}`, id: `nt-card-${id}`, "aria-label": id });
  const memCard = card("memory");
  const toolsCard = card("tools");
  const subsCard = card("subagents");
  const skillsCard = card("skills");
  const compCard = card("compaction");
  const instrCard = card("instructions");
  // The persistent text box: "Also tell it…" writes instructions.session, held; its count is the server's.
  const extra = /** @type {HTMLTextAreaElement} */ (mk("textarea", { class: "nt-extra", rows: "3", placeholder: "Anything this chat must always follow — it rides the end of the system prompt", "aria-label": "Extra instructions for this chat" }));
  let extraTimer = 0;
  extra.addEventListener("input", () => {
    clearTimeout(extraTimer);
    extraTimer = Number(setTimeout(() => {
      const v = extra.value.trim();
      if (v) choose("instructions.session", v);
      else io.unset("instructions.session");
    }, 300));
  });
  const extraWhy = mk("p", { class: "inst-note nt-extra-why hidden" });
  const instrHead = mk("div", { class: "nt-card-head" });
  const instrBody = mk("div", { class: "nt-card-body" });
  const extraTitle = mk("span", {});
  instrCard.append(instrHead, instrBody, section(mk, extraTitle, extra, extraWhy));
  // Two columns of three, each a stack, so a short card leaves no hole beside a tall one.
  const grid = mk("div", { class: "nt-grid" },
    mk("div", { class: "nt-stack" }, toolsCard, memCard, skillsCard),
    mk("div", { class: "nt-stack" }, compCard, subsCard, instrCard));

  /**
   * What a card holds that this engine does not read (D8): greyed under the line that says why, out of the keyboard's
   * and the pointer's reach.
   * @param {string} why @param {...any} nodes
   */
  const dim = (why, ...nodes) => [note(mk, why), mk("div", { class: "nt-dim", inert: "", "aria-disabled": "true" }, ...kids(nodes))];

  // ---- the cards' heads: what the tiles said, at each head's end (UX5) ----------------------------------------------
  /** @type {Partial<Record<string, HeadWords>>} */
  let words = {};
  /** @param {string} id */
  const tag = (id) => {
    const w = words[id];
    return w
      ? mk("span", { class: `nt-card-tag${w.dim ? " is-dim" : ""}${w.tone ? ` is-${w.tone}` : ""}`, title: [w.sub, w.why].filter(Boolean).join(" — ") }, w.value)
      : null;
  };

  // ---- the first request (NT-D5), with what the Context card said (UX5) -------------------------------------------
  const firstSub = mk("span", { class: "nt-first-sub" });
  const firstFig = mk("span", { class: "nt-first-fig" });
  const firstLine = mk("span", { class: "nt-first-line" });
  const firstBar = mk("div", { class: "nt-first-bar" });
  const firstLegend = mk("div", { class: "nt-first-legend" });
  const firstNote = mk("p", { class: "inst-note nt-first-note" });
  const firstMore = mk("div", { class: "nt-first-more" });
  const firstEl = mk("section", { class: "nt-first nt-card inst-nt-context", "aria-label": "The first request" },
    mk("div", { class: "nt-first-head" }, mk("span", { class: "nt-first-title" }, "The first request"), firstSub, firstFig, firstLine),
    firstBar, firstLegend, firstNote, firstMore);

  const el = mk("div", { class: "nt-board is-blank" }, askEl, firstEl, grid);

  // ---- the questions --------------------------------------------------------------------------------------------
  const paintFrom = () => {
    const changes = Object.keys(io.held()).length;
    fromNote.replaceChildren(fromWords(d));
    undoAll.replaceChildren(...(changes
      ? [mk("span", { class: "nt-changed" }, `${changes} changed for this chat`),
          mk("button", { class: "nt-undo", type: "button", title: "Undo all: drop every change you made for this chat", "aria-label": "Undo all", onclick: () => io.reset() }, icon(mk, "rotateCcw", "nt-undo-ic"))]
      : ["Nothing starts until you send · a row you change shows a dot and ↺"]));
    undoAll.classList.toggle("is-on", !!changes);
  };

  /** A team runs it: the two settings a hand-over writes, held for this task. @param {string} key */
  const lead = (key) => {
    choose("engine.mode", "team");
    choose("engine.team", key);
  };
  /** The agent itself runs it: no team held, and the model's own engine over a team the start asks for. */
  const alone = () => {
    if (!d?.who?.asked) return;
    io.unset("engine.team");
    choose("engine.mode", "model");
  };
  const teamMenu = () => {
    /** @type {any[]} */
    const rows = d?.who?.teams || [];
    const item = (/** @type {any} */ t) => {
      const team = teamOf(t, String(t.key));
      return { type: "check", label: team.name, desc: leadsWords(team), checked: d?.who?.team === team.key, onClick: () => lead(team.key) };
    };
    // In the Library's groups (UX6): Builders, the teams that look and check, then yours.
    const build = rows.filter(isBuildTeam);
    const looks = rows.filter((t) => t.shipped && !isBuildTeam(t));
    const yours = rows.filter((t) => !t.shipped);
    /** @param {string} label @param {any[]} list @param {boolean} first */
    const menuPart = (label, list, first) => (list.length ? [...(first ? [] : [{ type: "separator" }]), { type: "label", label }, ...list.map(item)] : []);
    openMenu([
      ...menuPart("They build", build, true),
      ...menuPart("They look and check", looks, !build.length),
      ...menuPart("Yours", yours, !build.length && !looks.length),
    ], { anchor: whoTeam, side: "bottom", align: "start", width: 340 });
  };
  const paintWho = () => {
    const w = whoRuns(d);
    whoEl.classList.toggle("hidden", io.teamsOn?.() === false);
    whoSelf.classList.toggle("is-on", !w.team);
    whoSelf.setAttribute("aria-pressed", w.team ? "false" : "true");
    whoTeam.classList.toggle("is-on", !!w.team);
    whoTeam.setAttribute("aria-pressed", w.team ? "true" : "false");
    whoTeam.toggleAttribute("disabled", w.off);
    whoTeam.setAttribute("title", w.off ? w.why : w.team ? leadsWords(w.team) : "Pick the team whose lead answers you");
    whoTeamText.replaceChildren(w.team ? `${w.team.name} team` : "A lead and its team");
    // A team chosen here: its dot, and ↺ back to who the start says (UX5).
    const back = dropper(["engine.mode", "engine.team"]);
    whoEl.classList.toggle("is-changed", !!back);
    whoMark.replaceChildren(...kids([back ? undoBtn("who runs it", back) : mark("engine.team") || mark("engine.mode") || null]));
    // Alone, the line names the model below and what the other choice is (the mock's words).
    const named = modelWords();
    const model = named ? [who(), named].filter(Boolean).join(" · ") : "";
    whoNote.replaceChildren(...kids([!w.team && !w.off ? `${model ? `${model} — the model below. ` : ""}A lead plans and its workers do the work.` : null]));
    whoRun.classList.toggle("hidden", !w.team);
    if (w.team) whoBy.replaceChildren(runByWords(w.team));
    whoWhy.replaceChildren(...kids([w.why || null]));
    whoWhy.classList.toggle("is-warn", w.warn);
  };

  // ---- the first request -------------------------------------------------------------------------------------------
  const paintFirst = () => {
    const st = standing(d);
    const rows = anatomy(d);
    const e = engine();
    firstSub.replaceChildren(e.kind === "agent"
      ? `what Filament adds to ${whoIn()}'s own — it grows as you type`
      : `what ${modelWords() || "the model"} will get with your message — it grows as you type`);
    firstFig.replaceChildren(mk("b", {}, tok(st.total)), ...kids([st.window ? ` of ${tok(st.window)}` : null]));
    firstFig.classList.toggle("is-warn", st.tone === "warn");
    firstFig.classList.toggle("is-error", st.tone === "error");
    // The bar is a share of the window, the line notched on it; with no window the parts share the bar.
    firstBar.replaceChildren(stackBar(mk, rows.map((r) => ({ value: r.tokens, color: r.color, label: r.label, hatch: r.upTo })), st.window ? { total: st.window, tall: true, notch: st.line ? st.line / st.window : null } : { tall: true }));
    firstLegend.replaceChildren(...rows.map((r) =>
      mk("span", { class: "nt-first-part" }, mk("span", { class: "inst-dot", style: `background:${r.color}` }), `${r.upTo ? `${r.label} up to` : r.label} ${tok(r.tokens)}`)));
    firstNote.replaceChildren(...kids([
      !st.window
        ? "This model's window is not known — set it on the Upstreams page."
        : st.tone === "error"
          ? "Bigger than the window: the model would refuse it."
          : st.tone === "warn"
            ? "Past the compaction line before any history — there is nothing to compact yet."
            : null,
    ]));
    firstNote.classList.toggle("is-error", st.tone === "error");
    firstNote.classList.toggle("is-warn", st.tone === "warn");
    // Where the line falls, at the head's end; a coding agent's figure is Filament's side only (its sub says so).
    firstLine.replaceChildren(...kids([st.window && st.line ? `compacts at ${tok(st.line)} · ${st.percent}%` : null]));
    // What the Context card said (UX5): who builds the first request, where its prompt says it runs, the servers that
    // join it on the first turn — and, where no model can answer, the way to connect one: the console's catalogue in its
    // own window (HarnessV3-Launch LD-D4).
    const none = !(io.models() || []).length;
    firstMore.replaceChildren(...kids([
      none
        ? mk("p", { class: "inst-note nt-first-none" }, "No model can answer yet: connect one in the console. ",
            mk("a", { class: "inst-link", href: CONNECT_URL, target: CONSOLE_WINDOW }, "Connect a model", icon(mk, "chevronRight", "inst-link-chev")))
        : note(mk, `${engineWords(e)}.`),
      d?.environment ? note(mk, /** @type {string} */ (environmentWords(d.environment))) : null,
      (d?.tools?.mcp || []).length ? note(mk, `Plus the tools of ${d.tools.mcp.join(", ")} — counted once ${d.tools.mcp.length === 1 ? "it connects" : "they connect"} on the first turn.`) : null,
    ]));
  };

  const paintMemory = () => {
    const m = d?.memory || {};
    const on = m.global && m.on;
    // A chat Memory settings leave out says why, and nothing memory would bring it.
    const sub = !m.global
      ? "Off in your Memory settings"
      : m.out
        ? `Left out — ${m.out}`
        : !m.on
          ? "Muted for this chat — recording continues"
          : !m.autopilot
            ? "Recording only — autopilot is off in Memory settings"
            : "What it will remember and recall";
    const knows = knowsWords(d);
    memCard.replaceChildren(...kids([
      head(mk, { icon: "brain", title: "Memory", sub, trailing: tag("memory") }),
      (m.briefing || 0) + (m.recall || 0) > 0 ? hero(mk, { value: tok((m.briefing || 0) + (m.recall || 0)), unit: "tokens, at most", caption: "A briefing and related memories, picked from your first message" }) : null,
      knows ? note(mk, knows) : null,
      group(mk,
        owned(switchRow(mk, {
          label: "Memory for this chat",
          sub: mark("memory.enabled") || undefined,
          checked: !!on,
          disabled: !m.global,
          title: !m.global ? "Off globally — the console's switch decides" : "",
          onChange: (v) => choose("memory.enabled", v),
        }), "Memory for this chat", ["memory.enabled"]),
        ...MEMORY_SWITCHES.map((s) => owned(switchRow(mk, {
          label: s.label,
          sub: mark(s.path) || s.sub,
          checked: !!on && flat(s.path) !== false,
          disabled: !on,
          onChange: (v) => choose(s.path, v),
        }), s.label, [s.path])),
        owned(switchRow(mk, {
          label: "Learn from this chat",
          sub: mark("memory.learn") || "What it learns joins memory for later chats",
          checked: !!on && flat("memory.learn") !== false,
          disabled: !on,
          onChange: (v) => choose("memory.learn", v),
        }), "Learn from this chat", ["memory.learn"])),
    ]));
  };

  const paintTools = () => {
    const e = engine();
    const loop = loopBuilds(e);
    const t = d?.tools || { offered: [], off: [], mcp: [] };
    const offered = new Set(t.offered || []);
    const off = new Set(t.off || []);
    // While Settings › Experimental's Teams switch is off no chip says teams: the team tool is offered to nobody.
    const teamsHere = io.teamsOn?.() !== false;
    const groups = teamsHere ? TOOL_GROUPS : TOOL_GROUPS.filter((g) => !g.names.includes("team"));
    const reaches = teamsHere ? AGENT_REACHES : AGENT_REACHES.filter((n) => n !== "team");
    const perm = io.permission() || String(flat("loop.permissions") || "edit");
    const seg = segmented(mk, {
      options: PERMISSION_SEG.map(([id, label]) => ({ id, label, title: MODES.find((x) => x.id === id)?.desc })),
      value: () => io.permission() || perm,
      onChange: (id) => io.setPermission(id),
      ariaLabel: "Permission mode",
    });
    const mode = MODES.find((x) => x.id === perm);
    const permission = section(mk, "Permission mode", mk("div", { class: "nt-perm" }, seg.el), mode ? note(mk, mode.desc) : null);
    const toolTokens = (d?.parts || []).find((/** @type {any} */ p) => p.id === "tools")?.tokens || 0;
    // `loop.tools` now, and as the start gives it before this chat's change (the answer's `base`).
    const nowTools = flat("loop.tools");
    const baseTools = (d?.base || {})["loop.tools"];
    /** A name's own value in a `loop.tools` (undefined: not named). @param {any} v @param {string} n */
    const valIn = (v, n) => (v && typeof v === "object" ? v[n] : undefined);
    /** A tool's switch; `given`: the names the engine is handed now — the loop's own, or what Filament adds to an agent. */
    const chip = (/** @type {string} */ name, given = offered) => {
      const web = /** @type {Record<string, string>} */ (WEB_KNOB)[name];
      const on = given.has(name);
      if (!on && !off.has(name) && !web) return null; // not this task's to offer (delegate_read without a reader model)
      return mk("button", {
        class: `nt-chip${on ? " is-on" : ""}`,
        type: "button",
        role: "switch",
        "aria-checked": on ? "true" : "false",
        "data-tool": name,
        title: `${TOOL_WORDS[name] ? `${TOOL_WORDS[name]} (${name})` : name}: ${on ? "offered — click to switch it off for this chat" : "off — click to offer it"}`,
        onclick: () => {
          // A web tool — the browser too — is offered on the session's say-so (plugins.web.*, plugins.browser) and not
          // switched off in loop.tools.
          if (web) choose(web, !on);
          if (!web || (!on && off.has(name))) {
            const next = toolsAfter(nowTools, name, !on);
            // A tool this chat switched off, switched on again where the start names it not: its name dropped, back to
            // the start's — so a chip flipped twice is no change (UX5).
            if (!on && own("loop.tools") && valIn(nowTools, name) === false && valIn(baseTools, name) === undefined) delete next[name];
            choose("loop.tools", next);
          }
        },
      }, TOOL_WORDS[name] || name);
    };
    const memoryNote = t.memory || t.recall ? note(mk, `Plus ${[t.memory ? `memory's ${t.memory} tools` : null, t.recall ? "filament_recall" : null].filter(Boolean).join(" and ")}.`) : null;
    // A family the chat changed (UX5): ↺ puts its chips back as the start has them and keeps the other families' — the
    // web's and the browser's own switches dropped, `loop.tools` given the start's value for its names.
    const putBack = (/** @type {{ names: readonly string[] }} */ g) => {
      const webs = g.names.map((n) => /** @type {Record<string, string>} */ (WEB_KNOB)[n]).filter((p) => p && own(p));
      const moved = own("loop.tools") && g.names.some((n) => valIn(nowTools, n) !== valIn(baseTools, n));
      if (!webs.length && !moved) return null;
      return () => {
        for (const p of webs) io.unset(p);
        if (!moved) return;
        /** @type {Record<string, any>} */
        const next = { ...(nowTools && typeof nowTools === "object" ? nowTools : {}) };
        for (const n of g.names) {
          if (baseTools && typeof baseTools === "object" && Object.hasOwn(baseTools, n)) next[n] = baseTools[n];
          else delete next[n];
        }
        choose("loop.tools", next);
      };
    };
    if (loop) {
      toolsCard.replaceChildren(...kids([
        head(mk, { icon: "wrench", title: "Tools", sub: `${tok(toolTokens)} tokens with memory's`, trailing: tag("tools") }),
        permission,
        ...groups.map((g) => {
          const chips = kids(g.names.map((n) => chip(n)));
          return chips.length ? section(mk, ownTitle(g.label, putBack(g)), mk("div", { class: "nt-chips" }, ...chips)) : null;
        }),
        memoryNote,
        (t.mcp || []).length ? mcpSection(t) : null,
      ]));
      return;
    }
    // Another engine (D8): the loop's tools are named, greyed, with why. A coding agent keeps its permission mode, and
    // what Filament adds reaches it — memory's tools, its team's, the MCP servers, and Filament's own tools on the chat's
    // switches (the owner's look of 10-24), which stay live here.
    const named = (/** @type {readonly string[]} */ names) => names.map((n) => mk("span", { class: "nt-chip is-named", title: n }, TOOL_WORDS[n] || n));
    const loopTools = groups.map((g) => section(mk, g.label, mk("div", { class: "nt-chips" }, ...named(g.names))));
    if (e.kind === "agent") {
      const reach = kids(reaches.map((n) => chip(n, new Set(t.adds || []))));
      // Its own to do: the loop's other tools, by family. Its agent tool is Filament's, and comes with every chat.
      const itsOwn = groups.map((g) => ({ label: g.label, names: g.names.filter((n) => !AGENT_REACHES.includes(n) && !NOT_ITS_OWN.includes(n)) })).filter((g) => g.names.length);
      const hands = t.hands === "native"
        ? `Files and commands: Filament's Read, Write, Edit, Bash, Glob and Grep, in place of ${whoIn()}'s own (its client bridge is native); the web's fetch and search, questions and plans: its own. The loop's switches for these don't reach it.`
        : `Files, commands, the web's fetch and search, questions and plans: ${whoIn()}'s own tools, so the loop's switches for these don't reach it.`;
      toolsCard.replaceChildren(...kids([
        head(mk, { icon: "wrench", title: "Tools", sub: `${cap(whoIn())}'s own, and what Filament adds`, trailing: tag("tools") }),
        permission,
        offered.size ? section(mk, "Its team's, from Filament", mk("div", { class: "nt-chips" }, ...[...offered].map((n) => mk("span", { class: "nt-chip is-on is-named" }, n)))) : null,
        reach.length ? section(mk, ownTitle("From Filament", putBack({ names: reaches })), mk("div", { class: "nt-chips" }, ...reach), note(mk, "Filament's agent tool comes with every chat.")) : null,
        memoryNote,
        (t.mcp || []).length ? mcpSection(t) : null,
        dim(hands, ...itsOwn.map((g) => section(mk, g.label, mk("div", { class: "nt-chips" }, ...named(g.names))))),
      ]));
      return;
    }
    toolsCard.replaceChildren(...kids([
      head(mk, { icon: "wrench", title: "Tools", sub: "The loop's tools — this engine brings none", trailing: tag("tools") }),
      memoryNote,
      dim(`${engineWords(e)}.`, permission, ...loopTools),
    ]));
  };

  /**
   * The connectors the task starts with, each dotted by its last test in Library › Plugins & Connectors (HarnessV4_Settings_Plan
   * HC-26): green where it answered, red where it failed, none where it was never tested. The list is set there; a
   * plugin's says the plugin it came with (HarnessV4_SpacesPlugins_Plan B5), set there too.
   * @param {{ mcp: string[], mcpTests?: Record<string, { ok: boolean, words: string } | null>, mcpFrom?: Record<string, string> }} t
   */
  const mcpSection = (t) => section(mk, "Connectors",
    mk("div", { class: "nt-chips" }, ...t.mcp.map((name) => {
      const test = t.mcpTests?.[name] || null;
      const from = t.mcpFrom?.[name] || "";
      return mk("span", {
        class: "nt-chip is-on nt-mcp",
        title: from
          ? `${name}: from the plugin ${from}, connected when a turn needs it — Library › Plugins & Connectors sets it`
          : test ? `${name}: ${test.ok ? "" : "failed — "}${test.words}` : `${name}: not tested — Library › Plugins & Connectors tests it`,
      }, mk("span", { class: `nt-mcp-dot${test ? (test.ok ? " is-ok" : " is-bad") : ""}`, "aria-hidden": "true" }), name,
      ...(from ? [mk("span", { class: "nt-mcp-from" }, ` · from ${from.split("@")[0]}`)] : []));
    })),
    note(mk, "Connected on the first turn."),
    link(mk, "Connectors in the Library", () => io.manageMcp()));

  /**
   * A model picked for a part of the task: a summary's writer — a coding agent's too.
   * @param {string} path @param {string} label @param {string} fallback
   */
  const pickerRow = (path, label, fallback) => {
    const named = String(flat(path) || "");
    const sel = modelSelect({
      onChange: (name) => { if (name && name !== named) choose(path, name); },
      onUseDefault: () => io.unset(path),
      defaultDesc: fallback,
    });
    sel.setModels(io.models() || []);
    if (named) sel.set(named);
    const sub = named ? mark(path) || undefined : `${fallback}${io.mainModel() ? ` (${io.mainModel()})` : ""}`;
    return row(mk, { label, sub, trailing: sel.el });
  };

  /**
   * The pool the task's agents on the side run on (HarnessV4_Tasks E15 step 8): its chip, whose editor's list is held
   * like every other change until the first send.
   */
  const poolRow = () => {
    const rows = poolRows(flat("subagents.pool"));
    const chip = poolChip({
      rows: () => flat("subagents.pool"),
      main: () => io.mainModel(),
      models: () => io.models() || [],
      families: () => io.families?.() || [],
      facts: io.poolFacts,
      // A row that says no effort thinks as the task's main agent will (the owner's word of 11-05).
      inherit: () => ({ level: String(flat("model.effort") || "model"), desc: "The main agent's effort, as this chat starts" }),
      onChange: choosePool,
      onUseDefault: () => io.unset("subagents.pool"),
      defaultWords: "Drop this chat's own list: its agents run on its model, as its main agent does",
    });
    chip.paint();
    return row(mk, { label: "They run on", sub: [poolSub(rows), mark("subagents.pool")].filter(Boolean).join(" · "), trailing: chip.el });
  };

  /** Who runs on what, painted with this answer. */
  const paintedRuns = () => {
    runsOnPanel.paint();
    return runsOnPanel.el;
  };

  const paintSubagents = () => {
    // The loop's tool switch: a coding agent never reads it (AG-72).
    const agentOff = loopBuilds(engine()) && (d?.tools?.off || []).includes("agent");
    // Whom the task's main agent may ask by itself (HarnessV4_Tasks E15 step 3, AG-44): the list this task would
    // start with, and a change held like every other until the first send.
    const people = io.agents();
    const from = mark("subagents.ask");
    const askRow = mayAskRow(mk, {
      tags: Array.isArray(flat("subagents.ask")) ? flat("subagents.ask") : [],
      // A list the chat changed is its own (its dot says so), not "as in Library".
      sub: own("subagents.ask") ? "" : from || MAY_ASK_SUB,
      own: Object.hasOwn(io.held(), "subagents.ask"),
      cards: people.cards,
      defaults: people.asks,
      off: agentOff ? "Nobody is asked while the agent tool is off in Tools" : "",
      onChange: (tags) => choose("subagents.ask", tags),
      onDefault: () => io.unset("subagents.ask"),
      // As the team tool will read them (the draft answer's `agentTeams`): a team that is gone stands in no list.
      teams: io.teamNames ? io.teamNames(d?.agentTeams) : [],
      onTeams: () => io.manageAgents(),
    }, openMenu);
    // Where they edit (the owner's plan of 11-09 for big repos): `subagents.workspace`, else as the older switch says —
    // on Auto, off the session's folder.
    const whereNow = () => {
      const w = String(flat("subagents.workspace") ?? "");
      return WORKSPACE_SEG.some(([id]) => id === w) ? w : flat("subagents.worktree") === false ? "folder" : "auto";
    };
    const whereSeg = segmented(mk, {
      options: WORKSPACE_SEG.map(([id, label, title]) => ({ id, label, title })),
      value: whereNow,
      onChange: (id) => choose("subagents.workspace", id),
      ariaLabel: "Where they edit",
    });
    const whereWords = WORKSPACE_SEG.find(([id]) => id === whereNow())?.[2] || "";
    const body = [
      group(mk, owned(askRow, "Your agent may use", ["subagents.ask"])),
      group(mk, owned(poolRow(), "They run on", ["subagents.pool"])),
      owned(paintedRuns(), "Who runs on what", ["subagents.byCard", "subagents.byTeam"]),
      owned(section(mk, "Where they edit", mk("div", { class: "nt-perm" }, whereSeg.el), note(mk, mark("subagents.workspace") || mark("subagents.worktree") || whereWords)), "Where they edit", ["subagents.workspace", "subagents.worktree"]),
    ];
    subsCard.replaceChildren(...kids([
      head(mk, { icon: "botMessageSquare", title: "Sub-agents", sub: "The saved agents you ask, and those the main agent calls", trailing: tag("subagents") }),
      agentOff ? note(mk, "The agent tool is off in Tools — the main agent calls no agent in this chat.", "warn") : null,
      // A model answering as plain chat has no tools to launch them with (D8).
      launches(engine()) ? body : dim(`${engineWords(engine())}: plain chat has no tools to launch agents with.`, ...body),
    ]));
  };

  const paintSkills = () => {
    const loop = loopBuilds(engine());
    const s = d?.skills || { on: [], list: [], triggered: [], problems: [] };
    const triggered = new Set(s.triggered || []);
    // The skills on where this task starts, a switch each (HarnessV4_Skills_Plan S1-6): off holds `enabled: false` for
    // this chat alone, and on again drops it — the rest is Library › Skills, for all chats or a project.
    // Read at each press, not once a paint: two switches turned before the board paints again each keep their word
    // (Hunter's find: the second wrote over the first).
    const heldNow = () => /** @type {any[]} */ (Array.isArray(io.held()["skills.on"]) ? io.held()["skills.on"] : []);
    const held = heldNow();
    const key = (/** @type {unknown} */ n) => String(n ?? "").toLowerCase();
    const listed = new Set((s.list || []).map((/** @type {any} */ k) => key(k.name)));
    const offHere = held.filter((e) => e?.enabled === false && !listed.has(key(e.name))).map((e) => String(e.name));
    const setSkill = (/** @type {string} */ name, /** @type {boolean} */ on) => {
      const rest = heldNow().filter((e) => key(e?.name) !== key(name));
      const next = on ? rest : [...rest, { name, enabled: false }];
      if (next.length) choose("skills.on", next);
      else io.unset("skills.on");
    };
    const rows = [
      // A plugin's skill is on where its plugin is: no word of `skills.on` turns it off, so its switch is shown, not
      // pressed (Hunter's find: off wrote a name the server refuses, and every later weigh failed).
      ...(s.list || []).map((/** @type {any} */ k) => switchRow(mk, {
        label: k.name,
        sub: triggered.has(k.name) ? "Your message names it: the agent loads it as it needs it" : k.plugin ? `From the ${k.plugin} plugin: on where the plugin is on` : k.description || undefined,
        checked: true,
        ...(k.plugin ? { disabled: true, title: `Turn the ${k.plugin} plugin off in Library › Plugins & Connectors to leave it out` } : {}),
        onChange: (on) => setSkill(k.name, on),
      })),
      ...offHere.map((name) => switchRow(mk, { label: name, sub: "Off in this chat", checked: false, onChange: (on) => setSkill(name, on) })),
    ];
    const skills = [
      rows.length ? owned(group(mk, ...rows), "Skills", ["skills.on"]) : note(mk, "No skill is on here yet: Library › Skills turns one on for all chats or this project."),
      ...(s.problems || []).map((/** @type {string} */ p) => note(mk, p, "warn")),
    ];
    skillsCard.replaceChildren(...kids([
      head(mk, { icon: "wandSparkles", title: "Skills", sub: "Procedures and know-how it starts with", trailing: tag("skills") }),
      // Skills ride the loop's prompt, and reach a coding agent through Filament's skill tool (HarnessV4_Skills_Plan
      // S1-1), beside its own folders' — plain chat takes none (D8).
      loop ? skills : engine().kind === "agent" ? [...skills, note(mk, `${cap(whoIn())} loads these with Filament's skill tool, and the skills of its own folders with its own.`)] : dim(`${engineWords(engine())}: plain chat takes no skills.`, ...skills),
      io.manageSkills ? link(mk, "Skills in the Library", () => io.manageSkills?.()) : null,
    ]));
  };

  const paintCompaction = () => {
    const coder = engine().kind === "agent";
    const method = String(flat("context.compaction.method") || "summary");
    const mt = methodOf(method);
    /** A method's name with the task's number in it. @param {string} id */
    const nameOf = (id) => methodName(id, { keepWhole: flat("context.compaction.keepWhole") });
    const asks = flat("context.compaction.mode") !== "auto";
    const percent = Number(flat("context.compaction.thresholdPercent")) || 85;
    const win = Number(d?.window?.tokens) || 0;
    const figure = mk("span", { class: "nt-line-fig" }, win ? `${percent}% · ${tok(Math.floor((win * percent) / 100))}` : `${percent}%`);
    const methods = METHODS;
    const methodRow = row(mk, {
      label: "Makes room by",
      sub: `${mt.line}${mark("context.compaction.method") ? ` · ${mark("context.compaction.method")}` : ""}`,
      value: nameOf(method),
      onClick: () => openMenu(methods.map((x) => ({ type: "check", label: nameOf(x.id), desc: x.line, checked: x.id === method, onClick: () => choose("context.compaction.method", x.id) })), { anchor: methodRow, side: "bottom", align: "end", width: 280 }),
    });
    // A coding agent makes room its way (`context.compaction.agent`); Filament's methods are the loop's.
    const way = String(flat("context.compaction.agent") || "suggested");
    const wayRow = row(mk, {
      label: "Makes room by",
      sub: `${(WAYS.find((x) => x.id === way) || WAYS[0]).line}${mark("context.compaction.agent") ? ` · ${mark("context.compaction.agent")}` : ""}`,
      value: wayName(way, cap(whoIn())),
      onClick: () => openMenu(WAYS.map((x) => ({ type: "check", label: wayName(x.id, cap(whoIn())), desc: x.line, checked: x.id === way, onClick: () => choose("context.compaction.agent", x.id) })), { anchor: wayRow, side: "bottom", align: "end", width: 300 }),
    });
    compCard.replaceChildren(...kids([
      head(mk, { icon: "foldVertical", title: "Compaction", sub: "How room is made when the chat is full", trailing: tag("compaction") }),
      coder
        ? group(mk, owned(wayRow, "Makes room by", ["context.compaction.agent"]))
        : group(mk, owned(methodRow, "Makes room by", ["context.compaction.method"])),
      section(mk, ownTitle("The line", dropper(["context.compaction.thresholdPercent"])),
        mk("div", { class: "nt-line" },
          slider(mk, {
            min: LINE_MIN, max: LINE_MAX, step: 5, value: Math.min(LINE_MAX, Math.max(LINE_MIN, percent)), ariaLabel: "Compaction line, percent of the window",
            onInput: (v) => { figure.textContent = win ? `${v}% · ${tok(Math.floor((win * v) / 100))}` : `${v}%`; },
            onChange: (v) => choose("context.compaction.thresholdPercent", v),
          }),
          figure)),
      group(mk,
        owned(pickerRow("context.compaction.model", "Summaries written by", "The chat's own model"), "Summaries written by", ["context.compaction.model"]),
        owned(switchRow(mk, { label: "Ask before making room", sub: mark("context.compaction.mode") || "Off: a message makes room by itself at the line", checked: asks, onChange: (on) => choose("context.compaction.mode", on ? "ask" : "auto") }), "Ask before making room", ["context.compaction.mode"])),
    ]));
  };

  const paintInstructions = () => {
    const e = engine();
    const loop = loopBuilds(e);
    const ins = d?.instructions || { files: [], missing: [] };
    const part = (d?.parts || []).find((/** @type {any} */ p) => p.id === "instructions")?.tokens || 0;
    const files = [
      (ins.files || []).length
        ? group(mk, ...ins.files.map((/** @type {any} */ f) => row(mk, { icon: "fileText", label: f.file, value: `${f.chars.toLocaleString()} characters${f.truncated ? ", cut" : ""}` })))
        : note(mk, d?.outside ? "Pick a project to see its instruction files." : loop ? "No instruction file in this folder or above it." : "The loop's instruction files: AGENTS.md, CLAUDE.md and those your settings name."),
      (ins.missing || []).length ? note(mk, `Looked for, not found: ${ins.missing.join(", ")}`) : null,
      // A folder below the chat's tells its own as the agent works there (the Designer's answer of 10-27).
      loop ? note(mk, "Folders below: told when the agent first works there.") : null,
      part ? note(mk, `${tok(part)} tokens at the end of the system prompt.`) : null,
    ];
    instrHead.replaceChildren(head(mk, { icon: "scrollText", title: "Instructions", sub: "What it must always follow", trailing: tag("instructions") }));
    extraTitle.replaceChildren(ownTitle("Also tell it…", dropper(["instructions.session"])));
    // The files and the box ride Filament's loop's prompt; another engine never reads them (D8).
    instrBody.replaceChildren(...kids([
      loop ? files : dim(e.kind === "agent" ? `${cap(whoIn())} reads its own instruction files, as it does outside Filament.` : `${engineWords(e)}: instructions ride the loop's prompt.`, ...files),
    ]));
    extra.disabled = !loop;
    extraWhy.replaceChildren(...kids([loop ? null : `It rides Filament's loop's prompt, which ${e.kind === "agent" ? whoIn() : "plain chat"} doesn't read.`]));
    extraWhy.classList.toggle("hidden", loop);
    // The box shows the start's own text until the developer types; it is never rewritten under the caret.
    if (typeof document === "undefined" || document.activeElement !== extra) {
      const held = io.held()["instructions.session"];
      extra.value = String(held ?? flat("instructions.session") ?? "");
    }
  };

  return {
    el,
    paint(answer) {
      d = answer;
      status.replaceChildren();
      el.classList.remove("is-pending");
      el.classList.remove("is-blank");
      words = headWords(d, { who: who(), permission: io.permission() || String(flat("loop.permissions") || "edit"), main: io.mainModel(), held: io.held() });
      paintWho();
      paintFrom();
      paintFirst();
      for (const paintCard of [paintTools, paintMemory, paintSkills, paintCompaction, paintSubagents, paintInstructions]) paintCard();
    },
    pending(on) {
      el.classList.toggle("is-pending", !!on);
    },
    failed(why) {
      el.classList.remove("is-pending");
      status.replaceChildren(why);
    },
  };
}
