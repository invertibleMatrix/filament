// @ts-check
// The welcome tour (the owner's FTUE, rebuilt 11-05: "top-notch, covering every feature, configuring Filament step by
// step"): a sheet in the window's middle, its ten steps on a rail at its left — Set up: Welcome, Connect a model,
// Default model, How it asks, Memory, Your chats, Your work; Discover: Agents and teams, Everything else; Start: Ready.
// Each step says why it matters and writes the real setting through the routes Settings uses (and the command line's),
// so what it sets is what Settings shows — Your chats (the owner's of 11-12) lists the other coding agents' single
// chats and brings the chosen ones in from the step itself, through Settings › Import's own hold on the server
// (settings/import.js `importKeeper`); under
// each step's name the rail says what is set. Previous, Next (Finish on the last) and Skip for now at the foot; ← and
// → move between steps. A sign-in or an install opens its own sheet, which takes the tour's place; the tour comes back
// at the same step as that sheet closes (`back`).
import { h } from "../../lib/dom.js";
import { accountName, maskEmail, signedInUnnamed } from "../../lib/accounts.js";
import { engineMissing, engineProgress } from "../../lib/engine.js";
import { api } from "../lib/api.js";
import { button, sheet } from "../lib/ui.js";
import { ICONS } from "../lib/icons.js";
import { prettyModel, levelWords, familyName, locate, memberFor, tuningOf, fitLevel, needsThinking } from "../lib/families.js";
import { askAfter, listed } from "../lib/agent-cards.js";
import { markTile } from "../lib/coding-agents.js";
import { MODES } from "../composer/mode.js";
import { lastTuning, rememberEffort } from "../composer/effort.js";
import { lastModel, newChatModelPref, setNewChatModelPref, state } from "../state.js";
import { agentsLabel, agentsPage, teamsOn } from "../../lib/teams-on.js";
import { modelRow } from "../space/model-row.js";
import { createModelSelect } from "../composer/model.js";
import { chatFilter, countWords, importKeeper, inFilament, nothingNew, sizeWords, syncSays, tightSays, whenWords } from "../settings/import.js";
import { comboLabel } from "../shortcuts.js";

/** Words naming a shortcut, as this computer prints it — ⌘K on a mac, as Settings › Shortcuts does. @param {string} s */
export const keysIn = (s) => (/mac/i.test(globalThis.navigator?.platform || "") ? s.replace(/\b(?:(?:Ctrl|Alt|Shift)\+)+[A-Z0-9]\b/g, (c) => comboLabel(c, true)) : s);

/**
 * The tour's steps, in order: the rail's group and name, and its page's title and why.
 */
export const WELCOME_STEPS = Object.freeze([
  {
    id: "welcome",
    group: "Set up",
    label: "Welcome",
    title: "Every coding agent you have, in one window",
    why: "One window for the coding agents and models you already have — Claude Code, Codex, Cursor, a provider's key — with agents that split the work, and a memory that carries what each chat learns into the next.",
  },
  {
    id: "connect",
    group: "Set up",
    label: "Connect a model",
    title: "Connect what you already use",
    why: "Filament runs the coding agents you already pay for on your own sign-in, and any provider's models on its API key. One of either is enough to start.",
  },
  {
    id: "model",
    group: "Set up",
    label: "Default model",
    title: "The model new chats start on",
    why: "Every new chat starts on this model, thinking this hard before it answers. A chat's own picker, beside the message box, still changes both for that chat.",
  },
  {
    id: "asks",
    group: "Set up",
    label: "How it asks",
    title: "What the agent may do on its own",
    why: "When the agent edits a file or runs a command, it can go ahead or ask you first. New chats start in the mode you pick; a chat's shield, beside the message box, changes it for that chat.",
  },
  {
    id: "memory",
    group: "Set up",
    label: "Memory",
    title: "A memory that carries over",
    why: "Memory keeps what your chats learn — facts about your projects, your decisions, how things are done here — and briefs each new chat with it, so you never explain the same thing twice.",
  },
  {
    id: "import",
    group: "Set up",
    label: "Your chats",
    title: "Bring in the chats you already have",
    why: "The chats you had in Claude Code, Codex and other coding agents on this computer can come into Filament, each as a chat here you can open and go on with. Nothing is changed where they are.",
  },
  {
    id: "work",
    group: "Set up",
    label: "Your work",
    title: "Where you work",
    why: "A chat works in a project folder: the agent reads and edits there, and the folder can have a Space of its own — its board of tasks, and What happened, its logbook —, made by the first thing you add on its page.",
  },
  {
    id: "team",
    group: "Discover",
    label: "Agents and teams",
    title: "Agents that work together",
    why: "A chat has one main agent. It brings in others when the work is better split — and you choose whom it may bring in by itself.",
  },
  {
    id: "discover",
    group: "Discover",
    label: "Everything else",
    title: "Everything else Filament does",
    why: "Pick an area, or an example to put it in the message box. Every one of these is also in the command center (Ctrl+K).",
  },
  {
    id: "ready",
    group: "Start",
    label: "Ready",
    title: "You're set",
    why: "Here is what you set. Each stays in Settings, where you can change it, and Settings › General or /welcome opens this tour again.",
  },
]);

/** The nine steps there were before Your chats (11-12), in their order: the page kept the place of the step it was left on. */
const STEPS_BEFORE = Object.freeze(["welcome", "connect", "model", "asks", "memory", "work", "team", "discover", "ready"]);
/**
 * Where the tour opens, from what the page kept: a step's name — or the place an older Filament kept, a number, read
 * as the step that stood there then, so a tour left on Your work or later opens on that step, not the one before it.
 * Nothing kept, or a step there is not: the first. @param {unknown} kept @returns {number}  its place among the steps now
 */
export function stepAt(kept) {
  const s = String(kept ?? "").trim();
  const id = /^\d+$/.test(s) ? STEPS_BEFORE[Number(s)] : s;
  return Math.max(0, WELCOME_STEPS.findIndex((st) => st.id === id));
}

/**
 * What the rail says under Your chats, and Ready's line: a run under way and how far; else the chats in Filament; else
 * how many chats were found that a run could bring; else that nothing is new; nothing found. The overview's counts
 * alone: the chats' list is the step's.
 * @param {any} data  Settings › Import's overview @param {any} [run]  the import under way, as last heard
 */
export function chatsFact(data, run) {
  if (run) return `Bringing in · ${Math.round(Number(run.percent) || 0)}%`;
  const found = (data?.sources || []).filter((/** @type {any} */ s) => s.found);
  if (!found.length) return "Nothing found";
  const here = inFilament({ sources: found });
  if (here) return `${countWords(here, "chat")} in Filament`;
  const reach = found.reduce((/** @type {number} */ n, /** @type {any} */ s) => n + (Number(s.pending?.chats) || 0), 0);
  return reach ? `${countWords(reach, "chat")} found` : "Nothing new";
}

/** A choice of chats, as Your chats keeps it and `POST /memory/import/chosen` takes it: an agent and its chats' ids each. @typedef {{ source: string, chats: string[] }[]} Picks */
/** A chat on Your chats' list, by its agent and its id there. @typedef {{ source: string, id: string }} Listed */

/** @param {unknown} v */
const num = (v) => (Number(v) || 0).toLocaleString("en-US");

/**
 * The chats Your chats lists, as the overview names them (`pending.list`, the tour's read): a group for each agent
 * found that has chats in reach, in the server's order, its chats the newest first; `shown`: those whose folder or
 * words hold `filter` (settings/import.js `chatFilter`, Browse's rule). An agent found whose store cannot be read is
 * a group with its `error` and no chats.
 * @param {any} data  the overview @param {string} [filter]
 * @returns {{ id: string, label: string, error: string | null, chats: any[], shown: any[] }[]}
 */
export function pickGroups(data, filter = "") {
  const holds = chatFilter(filter);
  return (data?.sources || [])
    .filter((/** @type {any} */ s) => s.found && (s.error || s.pending?.list?.length))
    .map((/** @type {any} */ s) => {
      /** @type {any[]} */
      const chats = s.pending?.list || [];
      return { id: String(s.id), label: String(s.label || s.id), error: s.error ? String(s.error) : null, chats, shown: chats.filter(holds) };
    });
}

/**
 * A choice kept to the chats still listed: the agents in the server's order, each with its chosen chats in its
 * list's order, an agent with none left out. So a chat that came in, or that the reach no longer holds, is chosen no
 * more — and what is left is what a press sends.
 * @param {any} data  the overview @param {Picks} picks @returns {Picks}
 */
export function picksIn(data, picks) {
  /** @type {Map<string, Set<string>>} */
  const want = new Map();
  for (const p of picks || []) want.set(String(p.source), new Set([...(want.get(String(p.source)) || []), ...(p.chats || []).map(String)]));
  return pickGroups(data)
    .map((g) => ({ source: g.id, chats: g.chats.filter((c) => want.get(g.id)?.has(String(c.id))).map((c) => String(c.id)) }))
    .filter((p) => p.chats.length);
}

/**
 * What Your chats says of a choice, and its button: how many chats, about how much there is to read, and how many of
 * each agent's.
 * @param {any} data  the overview @param {Picks} picks
 * @returns {{ head: string, sub: string, button: string, can: boolean, chats: number, bytes: number }}
 */
export function bringSays(data, picks) {
  const groups = pickGroups(data);
  const per = picksIn(data, picks).map((p) => {
    const g = groups.find((x) => x.id === p.source);
    const ids = new Set(p.chats);
    return { label: g?.label || p.source, chats: p.chats.length, bytes: (g?.chats || []).filter((c) => ids.has(String(c.id))).reduce((n, c) => n + (Number(c.bytes) || 0), 0) };
  });
  const chats = per.reduce((n, p) => n + p.chats, 0);
  const bytes = per.reduce((n, p) => n + p.bytes, 0);
  if (!chats) return { head: "No chat chosen yet", sub: "", button: "Bring in", can: false, chats: 0, bytes: 0 };
  return {
    head: `${countWords(chats, "chat")} chosen`,
    sub: [`about ${sizeWords(bytes)} to read`, ...per.map((p) => `${p.label} ${num(p.chats)}`)].join(" · "),
    button: `Bring in ${countWords(chats, "chat")}`,
    can: true,
    chats,
    bytes,
  };
}

/**
 * The quiet line under Your chats' list: the agents not found, and of each agent found what its list leaves out —
 * the chats in Filament already (brought in whole, or run through Filament) and, where a reach is set, those last
 * active before it. "" where there is nothing to say.
 * @param {any} data  the overview
 */
export function leftOutSays(data) {
  /** @type {any[]} */
  const sources = data?.sources || [];
  const reach = Number(data?.prefs?.reachDays) || 0;
  const missing = sources.filter((s) => !s.found);
  const parts = missing.length ? [`Not found on this computer: ${listed(missing.map((s) => String(s.label || s.id)))}.`] : [];
  for (const s of sources.filter((x) => x.found && !x.error)) {
    const st = s.states || {};
    const here = (st.imported || 0) + (st.own || 0);
    const older = reach > 0 ? (st.new || 0) + (st.grown || 0) - (s.pending?.chats || 0) : 0;
    const says = [...(here ? [`${num(here)} in Filament already`] : []), ...(older > 0 ? [`${num(older)} older than ${reach} days`] : [])];
    if (says.length) parts.push(`${s.label || s.id}: ${says.join(", ")}`);
  }
  return parts.join(" · ");
}

/**
 * What Your chats says where agents were found and no chat is in reach: that every chat found is in Filament already
 * (brought in whole, or run through it), else that none inside the reach is new or has grown (Settings › Import's
 * words, `nothingNew`).
 * @param {any} data  the overview
 */
export function noneSays(data) {
  /** @type {any[]} */
  const found = (data?.sources || []).filter((/** @type {any} */ s) => s.found);
  const chats = found.reduce((n, s) => n + (Number(s.chats) || 0), 0);
  const here = found.reduce((n, s) => n + (s.states?.imported || 0) + (s.states?.own || 0), 0);
  return chats && here === chats && !found.some((s) => s.error) ? "Every chat found is in Filament already." : nothingNew(Number(data?.prefs?.reachDays) || 0);
}

/**
 * What the tour is handed: the page's keepers of the coding agents and their accounts (app.js `agentsKeeper`,
 * `accountKeeper`), the sign-in and install sheets, and what it tells the page.
 * - `signIn`, `install`: open the page's sheet for it, which takes the tour's place; `back`, called as that sheet
 *   closes, opens the tour again at the step it was on.
 * - `step`: where it opens (the step it was left on, `stepAt`); `seen`: the steps visited, ticked; `folder`: the folder
 *   picked; `chats`: the other agents' chats were read — read again, so the rail keeps its note and a run is found;
 *   `picked`: the chats chosen on Your chats, kept as the tour steps aside for a sheet.
 * - `onStep`: each step it moves to, its place and its name, for the page to keep.
 * - `onSessions`: Your chats brought chats in — the list of sessions is to be read again; told as the run ends, the
 *   tour open or closed.
 * - `onDone`: how it ended — Finish, Skip for now, or closed (Esc, ×, a Settings page opened from it).
 * - `onExample`: an example prompt picked — the page puts it in the message box; the tour has closed.
 * - `onStart`: Start your first chat — the page starts a new chat, on the model and in the folder set; the tour has closed.
 * - `pickFolder`: a folder to work in, the one named or else the person's pick (null: none) — the page starts a chat
 *   in it; `folders`: the folders worked in last.
 * - `onSettings`: a Settings page opened (its section); the tour has closed.
 * @typedef {{ step?: number, seen?: number[], folder?: string, chats?: boolean, picked?: Picks, agents: { now: () => any, listen: (fn: (list: any) => void) => () => void, keep: (list: any) => void },
 *   accounts: { rows: () => any[], listen: (fn: () => void) => () => void, check?: (upstream: string) => Promise<void> },
 *   signIn: (upstream: string, back: () => void) => void, install: (id: string, back: () => void) => void, onStep?: (i: number, id: string) => void,
 *   onDone?: (how: "finish" | "skip" | "close") => void, onExample?: (text: string) => void, onSettings?: (section: string) => void,
 *   onStart?: () => void, pickFolder?: (path?: string) => Promise<string | null>, folders?: () => string[],
 *   onSessions?: () => void, onToast?: (msg: string, kind?: string) => void }} WelcomeOpts
 */

/**
 * Where new chats start, as Settings › General keeps it (state.js): the model chosen for them, or "" for the one used
 * last; and the effort a new chat starts from (composer/effort.js `lastTuning`), "" its model's own.
 * @typedef {{ get: () => string, set: (m: string) => void, last: () => string, effort: () => string, thinking: () => boolean,
 *   setEffort: (level: string, thinkingOn?: boolean) => void }} StartPref
 */

/** The main agent, its helpers and the teams, each with an example. */
export const TEAM_CARDS = Object.freeze([
  { id: "main", title: "The main agent", line: "The agent you chat with. It plans the work, builds it, and runs the others.", example: "Plan adding a dark mode to this app, then build it." },
  { id: "sub", title: "Sub-agents", line: "The main agent launches them for searches and reviews; each works in a context of its own and reports back (the Agents tab).", example: "Have a sub-agent find where this project handles errors, while you go on." },
  { id: "side", title: "Side agents", line: "When tasks of a plan can run at once, the main agent suggests them on a card you accept or ignore — or starts them itself with Parallelize tasks on; each works in its own worktree, and the main agent merges what they did." },
  { id: "teams", title: "Teams", line: "Builders and BugHunters: a lead and its workers on the models you choose. The roster lives in Library › Agents and teams.", example: "Ask the BugHunters to hunt for bugs in the last commit." },
]);

/**
 * What the tour shows while Settings › Experimental's Teams switch is off (src/ui/lib/teams-on.js): no team's card, the
 * agents' step named Agents.
 * @template {{ id: string }} T @param {readonly T[]} list @returns {readonly T[]}
 */
const withTeams = (list) => (teamsOn(state.config) ? list : list.filter((x) => x.id !== "teams"));

/** What Filament does, by area: each where it is found, and an example to try where one fits. */
export const FEATURES = Object.freeze([
  { id: "graph", area: "Plan and run", icon: "listTodo", title: "The task graph", line: "Work of more than one step is planned as tasks in their order, drawn live on the Plan tab beside the chat.", where: "Plan tab · Alt+5", example: "Plan the migration to the new API as a task graph before you start." },
  { id: "plan", area: "Plan and run", icon: "listTodo", title: "/plan", line: "The agent plans first and asks before it changes anything.", where: "The message box", example: "/plan add sign-in with GitHub" },
  { id: "parallel", area: "Plan and run", icon: "gitFork", title: "Tasks in parallel", line: "Tasks of the plan that can run at once go to side agents, each in its own worktree: the agent suggests them on a card, or starts them itself with Parallelize tasks on.", where: "The card in the chat · Settings › Experimental" },
  { id: "flow", area: "Plan and run", icon: "repeat", title: "/flow", line: "A flow of steps the agents run in order, with checks between them.", where: "The message box", example: "/flow" },
  { id: "goal", area: "Plan and run", icon: "rocket", title: "/goal", line: "A goal the agent drives toward round after round, until it is met or needs you.", where: "The message box", example: "/goal all tests pass on Windows" },
  { id: "steer", area: "Plan and run", icon: "messageSquare", title: "Send while it works", line: "Send while a turn runs: your message joins it at its next step. /steer-fork weighs it aside first.", where: "The message box, while a turn runs" },
  { id: "rewind", area: "Plan and run", icon: "history", title: "Rewind and fork", line: "Go back to an earlier message, its files too (/rewind, or Esc twice in an empty box); a fork tries another way from any turn.", where: "/rewind · Fork at this turn, Ctrl+Shift+F" },
  { id: "btw", area: "Agents", icon: "plus", title: "Ask on the side", line: "A question or a job for another agent while the main one works; its answer waits in the Agents tab.", where: "Agents tab · Alt+A · /btw", example: "/btw what does the retry logic do?" },
  { id: "teams", area: "Agents", icon: "users", title: "Teams", line: "A lead and its workers on the models you choose: Builders build, BugHunters find bugs and check them.", where: "Library › Agents and teams", example: "Ask the BugHunters to hunt for bugs in the last commit." },
  { id: "letters", area: "Agents", icon: "mail", title: "Letters", line: "The main agent and its sub-agents write each other while they work; a reply wakes the one that waits.", where: "The Agents tab" },
  { id: "catch-up", area: "Agents", icon: "history", title: "Catch me up", line: "Back from a break: a copy of the main agent tells you what the chat did, and the chat goes on undisturbed.", where: "Command center · Catch me up…" },
  { id: "changes", area: "Your code", icon: "fileDiff", title: "Changes", line: "Every file the agent changed, as diffs to review, keep or take back.", where: "The panes beside the chat · Ctrl+Shift+D" },
  { id: "terminal", area: "Your code", icon: "squareTerminal", title: "Terminal", line: "A terminal in the chat's folder, beside the chat.", where: "The panes · Ctrl+J" },
  { id: "browser", area: "Your code", icon: "globe", title: "Browser", line: "A browser the agent drives while you watch: the pages it builds, the sites it works on.", where: "The panes · Browser" },
  { id: "mentions", area: "Your code", icon: "atSign", title: "@ files and @# names", line: "Type @ in the message box to bring in a file, @# for a name your language servers know.", where: "The message box" },
  { id: "lsp", area: "Your code", icon: "code", title: "Language servers", line: "The agent sees the errors its edits leave, from the language servers on this computer.", where: "Settings › Language servers" },
  { id: "space", area: "Memory and Spaces", icon: "squareKanban", title: "Spaces", line: "Each project's board of tasks, What happened — its logbook — and routines that run on a schedule.", where: "A project's Space, in the sidebar" },
  { id: "memory", area: "Memory and Spaces", icon: "brain", title: "Memory", line: "What your chats learned, by project: read it, correct a line, or forget one.", where: "Library › Memory" },
  { id: "skills", area: "Memory and Spaces", icon: "wandSparkles", title: "Skills", line: "Procedures every agent can load; /craft makes a new one with you.", where: "Library › Skills", example: "/craft a skill for releasing this app" },
  { id: "artifacts", area: "Memory and Spaces", icon: "shapes", title: "Artifacts", line: "Pages your agents made — a tracker, a report, a small tool — kept apart from the chat.", where: "Library › Artifacts" },
  { id: "command", area: "Everywhere", icon: "search", title: "Command center", line: "Every action, setting and chat, found by typing.", where: "Ctrl+K" },
  { id: "connectors", area: "Everywhere", icon: "plug", title: "Connectors and plugins", line: "Your MCP servers, and Claude Code's and Codex's plugins: the tools your chats reach.", where: "Library › Plugins & Connectors" },
  { id: "apps", area: "Everywhere", icon: "network", title: "Your other apps", line: "Claude Code, Cursor or any client can use Filament as its endpoint, with your memory beside it.", where: "Settings › Connect other apps" },
  { id: "usage", area: "Everywhere", icon: "gauge", title: "Usage", line: "What each model cost you, and how fast it ran.", where: "Settings › Usage stats" },
]);

/** The providers whose keys most people hold, listed first on Connect a model. */
const FIRST_PROVIDERS = Object.freeze(["anthropic", "openai", "openrouter"]);

/** The examples the last step offers. */
const TRY = Object.freeze([
  "Explain how this project is laid out, and suggest three improvements.",
  "Plan adding a dark mode to this app, then build it.",
  "/plan add sign-in with GitHub",
]);

/**
 * A coding agent's account: the rows of the upstreams it serves, as Settings → Coding agents reads them, its Default's
 * (`primary`) first. @param {any} e @param {any[]} rows every account
 */
export function accountOf(e, rows) {
  const serves = Array.isArray(e.upstreams) ? e.upstreams : e.primary ? [e.primary] : [];
  return rows.filter((r) => serves.includes(r.upstream)).sort((x, y) => Number(y.upstream === e.primary) - Number(x.upstream === e.primary))[0] || null;
}

/**
 * A coding agent's state in the tour's words, and what it offers. `checking`: the accounts being asked who is signed in.
 * @param {any} e @param {any[]} rows every account @param {Set<string>} [checking]
 */
export function agentRowOf(e, rows, checking) {
  if (e.installing) return { state: "installing", words: "Installing…", act: null };
  if (e.state === "connected") {
    const r = accountOf(e, rows);
    if (!r) return { state: "connected", words: "Connected", act: null };
    if (r.signingIn) return { state: "signing-in", words: "Signing in…", act: { kind: "sign-in", label: "Show the sign-in", upstream: r.upstream } };
    const id = r.account?.identity;
    if (!id && checking?.has(r.upstream)) return { state: "checking", words: "Connected — asking who is signed in…", act: null };
    const out = !!id && (r.account.signedOut || id.kind === "none");
    if (id && !out) {
      const who = String(id.label || (id.email ? maskEmail(id.email) : accountName(r)));
      // A plan its label names already ("Claude Max", max) is said once.
      const plan = id.plan && !who.toLowerCase().includes(String(id.plan).toLowerCase()) ? ` · ${id.plan}` : "";
      return { state: "signed-in", words: `Signed in as ${who}${plan}`, act: null };
    }
    // Someone is signed in, as nobody said whom: an agent that keeps who it runs as to itself offers no Sign in then.
    if (signedInUnnamed(r.account)) return { state: "signed-in", words: r.says === false ? "Signed in — it doesn't say which account it runs on" : "Signed in", act: null };
    return { state: "signed-out", words: id ? "Not signed in" : r.says === false ? "Connected — it doesn't say which account it runs on" : "Connected — not heard from yet", act: { kind: "sign-in", label: "Sign in", upstream: r.upstream } };
  }
  if (e.state === "ready" || e.state === "off") return { state: "ready", words: "Installed, not connected", act: { kind: "connect", label: "Connect" } };
  if (e.install) return { state: "missing", words: e.install.needs ? `Not installed — it needs ${e.install.needs}` : "Not installed", act: e.install.needs ? null : { kind: "install", label: "Install…" } };
  return { state: "missing", words: "Not installed", act: e.download ? { kind: "download", label: "Download", url: e.download } : null };
}

/**
 * The catalogue's rows named by their provider as the composer's picker tabs name them (app.js `nameModels`): its name
 * in the configuration, not its id. `st`: `GET /state`. @param {any[]} rows @param {any} st @returns {any[]}
 */
export function withProviders(rows, st) {
  const names = new Map((st?.config?.upstreams || []).map((/** @type {any} */ u) => [u.id, u.name || u.id]));
  for (const r of rows) if (r?.upstream && names.has(r.upstream)) r.upstreamName = names.get(r.upstream);
  return rows;
}
/**
 * Whether the tour opens by itself as the page starts: while nothing can answer — no coding agent connected and no
 * model listed (the owner's of 11-08: "it should show until there is at least 1 agent connected"), however often it
 * was closed — and once, besides, on a data folder never toured that has no chat yet (the owner's FTUE of 11-05). A
 * count that could not be read (null) opens nothing.
 * @param {{ toured: boolean, chats: number | null, models: number | null, connected: number | null }} o
 */
export function tourOpensItself({ toured, chats, models, connected }) {
  return (models === 0 && connected === 0) || (!toured && chats === 0);
}

/** A count with its noun. @param {number} n @param {string} one */
const count = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
/** A folder's last part, as the rail says it. @param {string} p */
const baseName = (p) => String(p || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(p || "");
/** A glyph of the icon set. @param {string} name */
const glyph = (name) => ICONS[/** @type {keyof typeof ICONS} */ (name)] || "";

/**
 * Open the welcome tour. → its sheet's close, a step's opening, and the step it is on.
 * @param {WelcomeOpts} o
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, sheet?: typeof sheet, now?: () => number, pref?: StartPref,
 *   modelRow?: typeof modelRow, modelSelect?: typeof createModelSelect, later?: (fn: () => void, ms: number) => void }} [io]
 * @returns {{ close: () => void, go: (i: number) => void, step: () => number }}
 */
export function openWelcome(o, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const clock = io.now || Date.now;
  const makeRow = io.modelRow || modelRow;
  // Wherever the tour has a model chosen, the composer's picker (the owner's of 11-06): never a list of names.
  const pickModel = io.modelSelect || createModelSelect;
  /** @type {StartPref} */
  const pref = io.pref || { get: newChatModelPref, set: setNewChatModelPref, last: lastModel, effort: () => lastTuning().effort || "", thinking: () => lastTuning().thinking === "on", setEffort: rememberEffort };
  const N = WELCOME_STEPS.length;
  let at = Math.max(0, Math.min(N - 1, Math.floor(Number(o.step) || 0)));
  /** The steps visited: ticked on the rail. */
  const seen = new Set([...(o.seen || []), at]);
  /** The folder picked on Your work, kept across a sign-in's sheet. */
  let folder = String(o.folder || "");
  /** How it ended, said once as it closes. @type {"finish" | "skip" | "close"} */
  let how = "close";
  /** The listeners a step drew with, undone as it is left. @type {(() => void)[]} */
  let offs = [];
  const stop = () => {
    for (const off of offs.splice(0)) off();
  };
  /** What each step has set, said under its name on the rail. @type {Record<string, string>} */
  const facts = {};
  /** @param {string} id @param {string} words */
  const note = (id, words) => {
    if (facts[id] === words) return;
    facts[id] = words;
    paintRail();
  };

  const rail = m("nav", { class: "wel-rail", "aria-label": "Welcome steps" });
  const main = m("div", { class: "wel-main" });
  const body = m("div", { class: "wel-body" }, rail, main);
  const fill = m("span", { class: "wel-progress-fill" });
  const progress = m("span", { class: "wel-progress", "aria-hidden": "true" }, fill);
  const where = m("span", { class: "wel-where-at" });
  const prev = button({ label: "Previous", variant: "ghost", onClick: () => go(at - 1) });
  const next = button({ label: "Next", variant: "default", onClick: () => (at === N - 1 ? end("finish") : go(at + 1)) });
  const skip = button({ label: "Skip for now", variant: "ghost", onClick: () => end("skip") });
  const head = m("div", { class: "wel-head" },
    m("span", { class: "wel-mark", "aria-hidden": "true", html: glyph("sparkles") }),
    m("div", { class: "wel-head-text" }, m("h2", { class: "wel-title" }, "Welcome to Filament"), m("span", { class: "wel-sub" }, "Set it up in a few minutes — every step can be skipped")),
    m("span", { class: "wel-head-at" }, where, progress));
  const foot = m("div", { class: "wel-foot" }, skip, m("span", { class: "wel-gap" }), prev, next);

  const s = (io.sheet || sheet)({
    label: "Welcome to Filament",
    class: "wel-sheet",
    head,
    body,
    foot,
    onClose: () => {
      stop();
      window.removeEventListener("keydown", keys, true);
      if (!stepped) o.onDone?.(how);
    },
  });
  /** @param {"finish" | "skip"} why */
  const end = (why) => {
    how = why;
    s.close();
  };
  /** ← and → move between steps, unless the focus types. @param {KeyboardEvent} e */
  function keys(e) {
    if (!s.el.isConnected || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    const t = /** @type {any} */ (e.target);
    // A dialog over the tour (the command center) keeps its own arrows.
    if (t && t !== document.body && !s.el.contains(t)) return;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    e.preventDefault();
    go(at + (e.key === "ArrowRight" ? 1 : -1));
  }
  window.addEventListener("keydown", keys, true);

  /** The tour stepped aside for a sheet of the page's: its close ends nothing. */
  let stepped = false;
  /**
   * A sheet a step opens takes the tour's place; the tour comes back at the same step as that sheet closes.
   * @param {(back: () => void) => void} open
   */
  const aside = (open) => {
    stepped = true;
    const step = at;
    s.close();
    open(() => void openWelcome({ ...o, step, seen: [...seen], folder, chats: !!(chats.st.data || chats.st.run.import), picked: picks }, io));
  };
  /** A Settings page opened from a step: the tour closes for it, and /welcome brings it back at this step. @param {string} section */
  const leaveFor = (section) => {
    s.close();
    o.onSettings?.(section);
  };

  function paintRail() {
    const groups = [...new Set(WELCOME_STEPS.map((st) => st.group))];
    rail.replaceChildren(
      ...groups.map((g) =>
        m("div", { class: "wel-group" },
          m("div", { class: "wel-group-label" }, g),
          ...WELCOME_STEPS.map((st, i) => ({ st, i })).filter((x) => x.st.group === g).map(({ st, i }) =>
            m(
              "button",
              {
                type: "button",
                class: `wel-step${i === at ? " on" : ""}${seen.has(i) && i !== at ? " done" : ""}`,
                ...(i === at ? { "aria-current": "step" } : {}),
                onclick: () => go(i),
              },
              m("span", { class: "wel-n" }, seen.has(i) && i !== at ? "✓" : String(i + 1)),
              m("span", { class: "wel-step-text" }, m("span", { class: "wel-label" }, st.id === "team" ? agentsLabel(state.config) : st.label), facts[st.id] ? m("span", { class: "wel-fact" }, facts[st.id]) : null),
            ),
          ),
        ),
      ),
    );
    prev.toggleAttribute("disabled", at === 0);
    next.textContent = at === N - 1 ? "Finish" : "Next";
    // The last step's own Start your first chat is the one to press: Finish steps back, and there is nothing to skip.
    next.classList.toggle("zc-btn-v-default", at !== N - 1);
    next.classList.toggle("zc-btn-v-ghost", at === N - 1);
    skip.hidden = at === N - 1;
    where.textContent = `Step ${at + 1} of ${N}`;
    fill.setAttribute("style", `width:${Math.round(((at + 1) / N) * 100)}%`);
  }

  /** @param {number} i */
  function go(i) {
    if (i < 0 || i >= N) return;
    at = i;
    seen.add(i);
    o.onStep?.(i, WELCOME_STEPS[i].id);
    stop();
    paintRail();
    const st = WELCOME_STEPS[i];
    const box = m("section", { class: `wel-page wel-${st.id}` });
    main.replaceChildren(
      m("header", { class: "wel-pagehead" },
        m("div", { class: "wel-eyebrow" }, `Step ${i + 1} of ${N} · ${st.group}`),
        m("h3", { class: "wel-h" }, st.title),
        m("p", { class: "wel-why" }, keysIn(st.why))),
      box,
    );
    PAGES[st.id](box);
    main.scrollTop = 0;
  }

  /** An example prompt, picked: it goes to the message box, and the tour closes. @param {string} text */
  const example = (text) =>
    m("button", { type: "button", class: "wel-example", title: "Put it in the message box", onclick: () => { end("finish"); o.onExample?.(text); } }, text.startsWith("/") ? m("code", {}, text) : m("span", {}, text));
  /** A section of a step: its heading, its words, what it holds. @param {string} title @param {string} lead @param {...any} kids */
  const part = (title, lead, ...kids) => m("div", { class: "wel-part" }, m("h4", {}, title), lead ? m("p", { class: "wel-lead" }, lead) : null, ...kids);

  // What the rail says before a step is opened: what answers, where new chats start, how they ask, memory.
  /** @param {any} r `GET /start` */
  const connectFact = (r) => {
    if (r?.connected) note("connect", r.connected.ok ? count(Number(r.connected.models) || 0, "model") : unlistedOf(r.connected).length ? "Models not listed yet" : "Nothing yet");
    if (r?.memory && !(r.memory.enabled && facts.memory?.startsWith("On"))) note("memory", r.memory.enabled ? "On" : "Off");
  };
  /**
   * What is set up that Filament has no list of models for yet (`GET /start`'s `unlisted`, Get started's LD-D3): it can
   * answer once its models are listed. @param {any} c `connected` @returns {string[]}
   */
  const unlistedOf = (c) => (!c?.ok && Array.isArray(c?.unlisted) ? c.unlisted.map(String) : []);
  /**
   * The line that says so, with the click that asks them for their models (`GET /models?refresh=1`, as Get started's
   * List their models); `then` once they answered. @param {string[]} names @param {() => void} then
   */
  const unlistedLine = (names, then) => {
    const one = names.length === 1;
    const list = button({
      label: one ? "List its models" : "List their models",
      size: "sm",
      onClick: () => {
        list.setAttribute("disabled", "");
        list.textContent = "Listing…";
        void call("/models?refresh=1").then((r) => {
          const failed = Object.entries(r?.upstreams || {}).filter(([, i]) => /** @type {any} */ (i)?.error);
          if (failed.length) o.onToast?.(failed.map(([id, i]) => `${id} did not list its models: ${/** @type {any} */ (i).error}`).join("; "), "err");
        }, (e) => o.onToast?.(e?.message || String(e), "err")).finally(then);
      },
    });
    return [m("span", {}, `${listed(names)} ${one ? "is" : "are"} set up, but Filament has no list of ${one ? "its" : "their"} models yet, so none can answer. `), list];
  };
  /** @param {string} id */
  const modeFact = (id) => note("asks", MODES.find((x) => x.id === id)?.label || "");
  /** The model families, once the Default model step read them: a model named as its picker names it. */
  let families = /** @type {any[]} */ ([]);
  /** @param {string} name */
  const modelAt = (name) => (name && families.length ? locate(families, name) : null);
  /** @param {string} name */
  const modelName = (name) => {
    const at = modelAt(name);
    return at ? familyName(at.family) : prettyModel(name);
  };
  /**
   * The effort a new chat on it runs at, as its composer reads the last tuning (composer.js `tuningNow`): a model whose
   * ids spell the level, its member's own; else the one chosen fitted to its levels — capped where it needs extended
   * thinking and thinking is off. @param {string} name
   */
  const levelOf = (name) => {
    const at = modelAt(name);
    if (!at) return pref.effort();
    const f = at.family;
    return String(tuningOf(at, {
      effort: f.effort?.via === "setting" ? fitLevel(f.effort.levels, pref.effort() || null) : null,
      thinkingBudget: pref.thinking() && f.thinking?.via === "setting" ? 16000 : null,
    }).effort || "");
  };
  /**
   * The member of its family that runs at a level, where the family's ids spell it — a level it lacks fitted to those
   * it takes, as the composer's pick; none asked, its plain member, or where it has none the one it is on (`planReset`)
   * —; else the name as it is. @param {string} name @param {string} level
   */
  const atLevel = (name, level) => {
    const at = modelAt(name);
    const e = at?.family.effort;
    if (!at || e?.via !== "name") return name;
    const want = level ? fitLevel(e.levels, level) : e.plain ? null : at.member.effort;
    return memberFor(at.family, { ...tuningOf(at), effort: want }, "effort").id;
  };
  const modelFact = () => {
    const name = pref.get() || pref.last();
    const lv = name ? levelOf(name) : "";
    note("model", name ? `${modelName(name)}${lv ? ` · ${levelWords(lv)}` : ""}` : "");
  };
  void call("/start").then(connectFact, () => {});
  void call("/defaults/settings").then((d) => modeFact(String(d?.flat?.["loop.permissions"] || "edit")), () => {});
  // The families, so the rail names the model as its picker does — not by an id that spells its level.
  void call("/models?all=1").then((c) => {
    if (!families.length && Array.isArray(c?.families)) families = c.families;
    modelFact();
  }, () => {});
  modelFact();
  if (folder) note("work", baseName(folder));

  // The other coding agents' chats: Settings › Import's own hold on the server (settings/import.js), one for the whole
  // tour, so a run started on Your chats goes on while another step shows — the rail says how far — and is asked until
  // it ends where the tour has closed, for the page to hear that chats came in. Nothing is read until Your chats, or
  // Ready, shows: the look goes through every agent's files. The tour's read names the chats a run could bring
  // (`list`): Your chats chooses among them.
  /** What the step that shows draws again, as the overview is read or a run moves (`moved`). @type {(moved: boolean) => void} */
  let shows = () => {};
  /** The chats chosen on Your chats: none at first, kept for the whole tour and across a sign-in's sheet (`aside`). @type {Picks} */
  let picks = o.picked || [];
  const chats = importKeeper({
    paint: () => chatsNow(false),
    onRun: () => chatsNow(true),
    // A tour that has gone reads nothing again: the page's own list is what its import changed.
    onEnd: () => (s.el.isConnected ? chats.load() : undefined),
    onToast: o.onToast,
    onSessions: () => o.onSessions?.(),
    list: true,
  }, { h: m, api: call, later: io.later });
  /** @param {boolean} moved */
  const chatsNow = (moved) => {
    if (chats.st.data) {
      // Each read of the overview: a chat that came in, or that the reach no longer holds, is chosen no more.
      if (!moved) picks = picksIn(chats.st.data, picks);
      note("import", chatsFact(chats.st.data, chats.st.run.import));
    }
    shows(moved);
  };
  /** The overview read, once at a time. */
  let readingChats = false;
  const readChats = () => {
    if (readingChats) return;
    readingChats = true;
    void chats.load().finally(() => { readingChats = false; });
  };
  // Back from a sign-in's sheet (`aside`): the note the rail had, and a run under way, are read again.
  if (o.chats) readChats();

  /** @type {Record<string, (box: HTMLElement) => void>} */
  const PAGES = {
    // ① What Filament is, and what the tour sets.
    welcome(box) {
      const pillars = [
        { icon: "cable", title: "Every model you have", line: "Your coding agents on their own sign-in, any provider on its key: one picker, and a chat moves between them." },
        { icon: "users", title: "Agents that split the work", line: teamsOn(state.config) ? "The main agent plans, then hands searches, reviews and whole tasks to sub-agents, side agents and teams." : "The main agent plans, then hands searches, reviews and whole tasks to sub-agents and side agents." },
        { icon: "brain", title: "A memory of your projects", line: "What each chat learns briefs the next one, on every model and in every app connected to Filament." },
      ];
      // Three pillars and Next: the rail beside it is the steps ahead (Product's review of 11-06).
      box.append(
        m("div", { class: "wel-pillars" }, ...pillars.map((p) => m("div", { class: "wel-pillar" }, m("span", { class: "wel-tile", html: glyph(p.icon) }), m("div", { class: "wel-card-title" }, p.title), m("p", {}, p.line)))),
        m("p", { class: "wel-lead" }, "Each step writes the real setting, which Settings keeps, and any step can be skipped."),
      );
    },

    // ② The coding agents you already use, connected and signed in here — or a provider's key, added and tried.
    connect(box) {
      const status = m("div", { class: "wel-status", role: "status" }, "Checking what can answer…");
      let reading = 0;
      /** What can answer now (`GET /start`): the banner, and the rail. */
      const readStart = () => {
        const n = ++reading;
        void call("/start").then((r) => {
          if (n !== reading || !box.isConnected) return;
          connectFact(r);
          const c = r?.connected || {};
          const unlisted = unlistedOf(c);
          status.className = `wel-status ${c.ok ? "ok" : "warn"}`;
          if (c.ok) status.textContent = `✓ Filament can answer on ${count(Number(c.models) || 0, "model")}. Go on, or connect more.`;
          else if (unlisted.length) status.replaceChildren(...unlistedLine(unlisted, readStart));
          else status.textContent = "Nothing can answer yet: connect a coding agent or add a provider's key below — either is enough.";
        }, () => {
          if (n === reading && box.isConnected) status.hidden = true;
        });
      };
      readStart();

      const list = m("div", { class: "wel-rows" }, m("p", { class: "wel-muted" }, "Looking for your coding agents…"));
      // The agents not on this computer, folded: kept across repaints, so one opened stays open.
      const moreRows = m("div", { class: "wel-rows" });
      const moreCount = m("span", {});
      const more = /** @type {HTMLDetailsElement} */ (m("details", { class: "wel-more", hidden: "" }, m("summary", {}, moreCount), moreRows));
      const look = button({ label: "Look again", variant: "ghost", size: "sm", onClick: () => void call("/coding-agents").then((l) => o.agents.keep(l), (e) => o.onToast?.(e.message, "err")) });
      const have = m("div", { class: "wel-rows" });
      const form = m("div", { class: "wel-form" }, m("p", { class: "wel-muted" }, "Reading the providers…"));
      const said = m("p", { class: "wel-said", role: "status" });
      box.append(
        status,
        m("section", { class: "wel-agents wel-part" },
          m("div", { class: "wel-titled" }, m("h4", {}, "Your coding agents"), look),
          m("p", { class: "wel-lead" }, "Claude Code, Codex, Cursor, Antigravity… run here on your own sign-in, so no key is needed for them."),
          list,
          more),
        m("section", { class: "wel-keys wel-part" },
          m("h4", {}, "Or a provider's API key"),
          m("p", { class: "wel-lead" }, "A key gives Filament that provider's models: Anthropic, OpenAI, OpenRouter, and many more. One that asks for more than a key is in Settings › Providers."),
          have,
          form,
          said),
      );
      /** The accounts being asked who is signed in, and those asked once already while the step shows. */
      const checking = new Set();
      const asked = new Set();
      /** The agents connected when the banner was last read: one more, or one less, reads it again. */
      let connected = "";
      const paint = () => {
        const entries = o.agents.now()?.entries || [];
        const rows = o.accounts.rows() || [];
        const now = entries.filter((e) => e.state === "connected").map((e) => e.id).join(",");
        if (now !== connected) {
          if (connected) readStart();
          connected = now;
        }
        if (!entries.length) return void list.replaceChildren(m("p", { class: "wel-muted" }, "Looking for your coding agents…"));
        // A connected agent whose account was never read is asked, once, as Settings' Check now asks: a read that never spends.
        for (const e of entries) {
          const r = e.state === "connected" ? accountOf(e, rows) : null;
          if (!r || r.account?.identity || r.signingIn || !o.accounts.check || asked.has(r.upstream)) continue;
          asked.add(r.upstream);
          checking.add(r.upstream);
          void o.accounts.check(r.upstream).catch(() => {}).finally(() => {
            checking.delete(r.upstream);
            if (box.isConnected) paint();
          });
        }
        const mine = entries.filter((e) => e.installing || e.state === "connected" || e.state === "ready" || e.state === "off");
        const others = entries.filter((e) => !mine.includes(e));
        list.replaceChildren(...(mine.length ? mine.map(row) : [m("p", { class: "wel-muted" }, "None of them is on this computer yet: install one below.")]));
        moreRows.replaceChildren(...others.map(row));
        moreCount.textContent = `More coding agents (${others.length})`;
        more.hidden = !others.length;
        if (!mine.length) more.open = true;
        /** @param {any} e */
        function row(e) {
          const r = agentRowOf(e, rows, checking);
          const act = r.act;
          const btn = !act
            ? null
            : act.kind === "download"
              ? m("a", { class: "zc-btn zc-btn-v-ghost zc-btn-s-sm", href: act.url, target: "_blank", rel: "noopener" }, act.label)
              : button({
                  label: act.label,
                  variant: act.kind === "sign-in" ? "default" : "ghost",
                  size: "sm",
                  onClick: () => {
                    if (act.kind === "connect") void call(`/coding-agents/${encodeURIComponent(e.id)}/connect`, { method: "POST" }).then((l) => o.agents.keep(l), (err) => o.onToast?.(err.message, "err"));
                    else if (act.kind === "sign-in") aside((back) => o.signIn(String(act.upstream), back));
                    else if (act.kind === "install") aside((back) => o.install(e.id, back));
                  },
                });
          return m("div", { class: `wel-row wel-${r.state}`, "data-agent": e.id }, m("span", { class: "wel-row-name" }, e.name || e.id), m("span", { class: "wel-row-state" }, r.words), btn);
        }
      };
      offs.push(o.agents.listen(paint), o.accounts.listen(paint));
      paint();

      const paintHave = () =>
        void call("/upstreams").then((r) => {
          const keys = (r?.upstreams || []).filter((u) => !u.agent && (u.key?.stored || u.provider?.keyless));
          // A key short enough to mask whole reads as dots alone, like a spinner: said in words.
          const saved = (/** @type {any} */ u) => `✓ Key saved${/\w/.test(String(u.key?.masked || "")) ? ` · ${u.key.masked}` : ""}`;
          have.replaceChildren(...keys.map((u) => m("div", { class: "wel-row wel-signed-in" }, m("span", { class: "wel-row-name" }, u.name || u.id), m("span", { class: "wel-row-state" }, u.provider?.keyless ? "No key needed" : saved(u)))));
        }, () => {});
      paintHave();
      void call("/providers").then((r) => {
        // The providers most people hold a key for first, the rest as the catalogue lists them.
        const rank = (/** @type {any} */ p) => ((i) => (i < 0 ? FIRST_PROVIDERS.length : i))(FIRST_PROVIDERS.indexOf(p.id));
        const providers = (r?.providers || []).filter((p) => !p.fields?.length || p.keyless).sort((a, b) => rank(a) - rank(b));
        if (!providers.length) return void form.replaceChildren(m("p", { class: "wel-muted" }, "No provider to add here: Settings › Providers has them all."));
        const pick = /** @type {HTMLSelectElement} */ (m("select", { class: "wel-select", "aria-label": "Provider" }, ...providers.map((p) => m("option", { value: p.id }, p.name))));
        const plan = /** @type {HTMLSelectElement} */ (m("select", { class: "wel-select", "aria-label": "Plan" }));
        const key = /** @type {HTMLInputElement} */ (m("input", { class: "wel-input", type: "password", autocomplete: "off", spellcheck: "false", "aria-label": "API key", placeholder: "Paste your key" }));
        const get = /** @type {HTMLAnchorElement} */ (m("a", { class: "wel-link", target: "_blank", rel: "noopener" }, "Get a key"));
        const add = button({ label: "Add and test", variant: "default", onClick: () => void addKey() });
        const chosen = () => providers.find((p) => p.id === pick.value) || providers[0];
        /** Where the key of the provider and plan picked is got. */
        const link = () => {
          const p = chosen();
          const url = (p.plans || []).find((pl) => pl.id === plan.value)?.keyUrl || p.keyUrl || "";
          get.hidden = !url || !!p.keyless;
          if (url) get.href = url;
        };
        /** A provider picked: its plans, the first picked. */
        const fillPlans = () => {
          const p = chosen();
          const plans = p.plans || [];
          plan.replaceChildren(...plans.map((pl) => m("option", { value: pl.id }, pl.label || pl.id)));
          plan.hidden = plans.length < 2;
          key.hidden = !!p.keyless;
          link();
        };
        pick.addEventListener("change", fillPlans);
        plan.addEventListener("change", link);
        fillPlans();
        async function addKey() {
          const p = chosen();
          const apiKey = key.value.trim();
          if (!p.keyless && !apiKey) return void (said.textContent = "Paste the key first.");
          add.setAttribute("disabled", "");
          said.textContent = `Adding ${p.name}…`;
          said.className = "wel-said";
          try {
            /** @type {any} */
            let made = null;
            let prefix = p.prefix || p.id;
            for (let tries = 0; !made; tries++) {
              try {
                made = await call("/upstreams", { method: "POST", body: { provider: p.id, ...(plan.value && !plan.hidden ? { plan: plan.value } : {}), ...(apiKey ? { apiKey } : {}), prefix } });
              } catch (/** @type {any} */ e) {
                if (!e?.body?.free || tries > 0) throw e;
                prefix = String(e.body.free);
              }
            }
            key.value = "";
            const id = String(made?.upstream?.id || prefix);
            said.textContent = `Added ${p.name} as "${id}" — trying it…`;
            /** @type {any} */
            const t = await call(`/upstreams/${encodeURIComponent(id)}/test`);
            said.textContent = t?.ok
              ? `✓ ${id} answers${t.ms != null ? ` in ${t.ms} ms` : ""}${Number.isFinite(t.models) ? `: ${t.models} model${t.models === 1 ? "" : "s"}` : ""}.`
              : `✗ ${id} did not answer: ${t?.error || `HTTP ${t?.status}`}`;
            said.className = `wel-said ${t?.ok ? "ok" : "bad"}`;
            paintHave();
            readStart();
          } catch (/** @type {any} */ e) {
            said.textContent = `✗ ${e?.message || e}`;
            said.className = "wel-said bad";
          } finally {
            add.removeAttribute("disabled");
          }
        }
        form.replaceChildren(m("div", { class: "wel-line" }, pick, plan), m("div", { class: "wel-line" }, key, add), get);
      }, (e) => form.replaceChildren(m("p", { class: "wel-said bad" }, `The providers did not read: ${e.message}`)));
    },

    // ③ The model new chats start on, and its effort: Settings › General's New chats start on, the composer's tuning.
    model(box) {
      /** The catalogue the picker lists, read as this step opens. */
      const cat = { models: /** @type {any[]} */ ([]), families: /** @type {any[]} */ ([]) };
      const catalogue = { models: () => cat.models, families: () => cat.families, accounts: () => o.accounts.rows() || [] };
      const said = m("p", { class: "wel-said", role: "status" });
      const shown = () => pref.get() || pref.last();
      const words = () => (pref.get() ? "Every new chat starts on it." : pref.last() ? "The message box's model now: choose one, and every new chat starts on it." : "None chosen yet: choose one, and every new chat starts on it.");
      const row = makeRow({
        named: "New chats start on",
        // The chip stands at the page's left: the picker opens from its left edge, over the page, not the rail.
        modelSelect: (/** @type {any} */ c) => pickModel({ ...c, align: "start" }),
        catalogue,
        blank: "Choose a model",
        defaultDesc: "Start on the model the message box had last",
        onPick: (picked) => {
          const name = pref.effort() ? atLevel(picked, pref.effort()) : picked;
          pref.set(name);
          row.show(name, words(), levelOf(name));
          said.textContent = `New chats start on ${modelName(name)}.`;
          modelFact();
        },
        onDefault: () => {
          pref.set("");
          row.show(shown(), words(), levelOf(shown()));
          said.textContent = "New chats start on the model the message box had last.";
          modelFact();
        },
        effort: {
          named: "How hard it thinks",
          // What the message box starts on, so its own chip.
          tuning: true,
          onPick: (level) => {
            const was = shown();
            const at = modelAt(was);
            // A level that runs capped without extended thinking turns thinking on with it, as the composer's pick does.
            pref.setEffort(level, !!level && at?.family.thinking?.via === "setting" && needsThinking(at.family, level));
            // A model that spells its level in its id: the member at that level is where new chats start, and shows its own.
            const name = atLevel(was, level);
            if (name !== was) pref.set(name);
            if (at?.family.effort?.via === "name") row.show(name, words(), levelOf(name));
            const lv = levelOf(name);
            said.textContent = !level
              ? lv ? `${modelName(name)} has no default of its own: new chats on it think at ${levelWords(lv)}.` : "New chats think as their model does by default."
              : lv && lv !== level ? `New chats on ${modelName(name)} think at ${levelWords(lv)}, the nearest it takes.` : `New chats think at ${levelWords(level)} where their model takes it.`;
            modelFact();
          },
        },
      });
      const holder = m("div", { class: "wel-model-pick" }, row.row);
      box.append(
        holder,
        said,
        m("p", { class: "wel-muted" }, "Settings › General keeps where new chats start."),
      );
      void Promise.all([call("/models?all=1"), call("/state").catch(() => null)]).then(([c, st]) => {
        if (!box.isConnected) return;
        cat.models = withProviders(c?.models || c?.data || [], st);
        cat.families = c?.families || [];
        if (!cat.models.length) {
          const none = m("div", { class: "wel-status warn" }, "Nothing can answer yet, so there is no model to choose: connect a coding agent or add a key first.");
          holder.replaceChildren(none, button({ label: "Connect a model", variant: "default", onClick: () => go(1) }));
          // Set up, its models never listed: the click that lists them, and the step drawn again with them.
          void call("/start").then((r) => {
            const unlisted = unlistedOf(r?.connected);
            if (unlisted.length && box.isConnected) none.replaceChildren(...unlistedLine(unlisted, () => box.isConnected && go(at)));
          }, () => {});
          return;
        }
        families = cat.families;
        row.relist();
        row.show(shown(), words(), levelOf(shown()));
        modelFact();
      }, (e) => holder.replaceChildren(m("p", { class: "wel-said bad" }, `The models did not read: ${e?.message || e}`)));
    },

    // ④ What the agent may do on its own: the four modes, Settings › Permissions' New chats start in.
    asks(box) {
      const cards = m("div", { class: "wel-modes", role: "radiogroup", "aria-label": "New chats start in" }, m("p", { class: "wel-muted" }, "Reading how new chats start…"));
      const said = m("p", { class: "wel-said", role: "status" });
      box.append(
        cards,
        said,
        m("p", { class: "wel-muted" }, "Whatever the mode, Always allow on an ask remembers your answer in that project. Settings › Permissions holds the rules, the folders it may also read, and the commands it never runs."),
      );
      let now = "";
      // From the least the agent may do on its own to the most, as a newcomer weighs them.
      const ORDER = ["read-only", "ask", "edit", "auto"];
      const modes = [...MODES].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
      const paint = () =>
        cards.replaceChildren(...modes.map((x) =>
          m("button", {
            type: "button",
            role: "radio",
            "aria-checked": String(x.id === now),
            class: `wel-mode${x.id === now ? " on" : ""}${x.warn ? " warn" : ""}`,
            "data-mode": x.id,
            style: `--wel-tone:${x.tone}`,
            onclick: () => void pick(x.id),
          },
          m("span", { class: "wel-tile", html: glyph(x.icon) }),
          m("span", { class: "wel-mode-text" },
            m("span", { class: "wel-mode-label" }, x.label, x.id === "edit" ? m("span", { class: "wel-badge" }, "Filament's default") : null),
            m("span", { class: "wel-mode-desc" }, x.desc)))));
      /** @param {string} id */
      async function pick(id) {
        if (id === now) return;
        const was = now;
        now = id;
        paint();
        try {
          const d = await call("/defaults/settings", { method: "PATCH", body: { patch: { loop: { permissions: id } } } });
          now = String(d?.flat?.["loop.permissions"] || id);
          const label = MODES.find((x) => x.id === now)?.label || now;
          said.className = "wel-said ok";
          said.textContent = `✓ New chats start in ${label}.${now === "auto" ? " It edits and runs any command without asking you: keep it for work you can afford to lose." : ""}`;
          modeFact(now);
        } catch (/** @type {any} */ e) {
          now = was;
          said.className = "wel-said bad";
          said.textContent = `✗ ${e?.message || e}`;
        }
        if (box.isConnected) paint();
      }
      void call("/defaults/settings").then((d) => {
        if (!box.isConnected) return;
        now = String(d?.flat?.["loop.permissions"] || "edit");
        modeFact(now);
        paint();
      }, (e) => box.isConnected && cards.replaceChildren(m("p", { class: "wel-said bad" }, `How new chats start did not read: ${e?.message || e}`)));
    },

    // ⑤ Memory, the model it learns with, its engine — and chats named by that model.
    memory(box) {
      const state = m("div", { class: "wel-rows" }, m("p", { class: "wel-muted" }, "Reading memory…"));
      box.append(
        m("p", { class: "wel-lead" }, "Memory reads your chats as they go and keeps what matters, at low effort. It works with the model you set for it here; not set, with each chat's compaction model, else the chat's own."),
        state,
      );
      const engineRow = m("span", { class: "wel-row-state" });
      // Shown only while it needs you — installing, missing, or not read: installed, it is nothing a newcomer acts on.
      const engineLine = m("div", { class: "wel-row", hidden: "" }, m("span", { class: "wel-row-name" }, "Engine"), engineRow);
      /** An engine that installs: its row alone is read again until it is done, while this step shows. @type {ReturnType<typeof setTimeout> | undefined} */
      let again;
      offs.push(() => clearTimeout(again));
      /** Where memory's engine stands (`GET /memory/engine`, as the Memory widget reads it), in its row. */
      const paintEngine = async () => {
        clearTimeout(again);
        /** @type {any} */
        let now;
        try {
          now = await call("/memory/engine");
        } catch (/** @type {any} */ e) {
          if (box.isConnected) engineRow.replaceChildren(`Did not read: ${e?.message || e}`);
          engineLine.hidden = false;
          return;
        }
        if (!box.isConnected) return;
        const going = engineProgress(now);
        const missing = engineMissing(now);
        const install = button({ label: "Install", size: "sm", onClick: () => void call("/memory/install", { method: "POST", body: {} }).then(() => void paintEngine(), (e) => o.onToast?.(e.message, "err")) });
        engineLine.hidden = !going && (now?.state === "ready" || !missing);
        if (going) {
          engineRow.replaceChildren(`Installing — ${going.percent}%`);
          again = setTimeout(() => void paintEngine(), 1500);
        } else if (now?.state === "ready") engineRow.replaceChildren("Installed");
        else if (missing?.installable) engineRow.replaceChildren(now.error ? `Didn't install: ${now.error}` : "Not installed", install);
        else if (missing) engineRow.replaceChildren(`None here: ${now.why}`);
        else engineRow.replaceChildren("Starts with memory");
      };
      const paint = async () => {
        try {
          const [st, mo, all, cfg] = await Promise.all([call("/memory/status"), call("/memory/models"), call("/models?all=1").catch(() => ({})), call("/state").catch(() => null)]);
          if (!box.isConnected) return;
          const models = mo?.models || {};
          // Whether memory is on, in words: no switch turns it off here (the owner's of 11-08 and 11-09 — memory is core,
          // its one off switch is Settings › Experimental's, never the tour's).
          const learnsOn = models.summarizer !== "off";
          /** Memory's model written — a model, "" unset or "off" —, and the step read again. @param {string} summarizer */
          const setSide = (summarizer) =>
            void call("/memory/models", { method: "POST", body: { summarizer } }).then(
              (r) => {
                const ms = r?.models || {};
                o.onToast?.(ms.summarizer && ms.summarizer !== "off" ? `Memory learns with ${modelName(ms.summarizer)}` : ms.now ? "Memory learns with each chat's own model" : "Memory learns with no model");
                void paint();
              },
              (e) => {
                o.onToast?.(e.message, "err");
                void paint();
              },
            );
          // The composer's picker, as Settings › Memory has it: every model you connected, by family, with its price and
          // provider; Use the default unsets it, so each chat's compaction model, else its own, stands. Nothing here turns
          // learning off.
          const pick = pickModel({
            onChange: (name) => setSide(name),
            onUseDefault: () => setSide(""),
            defaultDesc: "Not set: each chat's compaction model, else the chat's own",
            blank: "Not set",
            align: "start",
          });
          pick.el.setAttribute("aria-label", "Memory's model");
          pick.setModels(withProviders(all?.models || all?.data || [], cfg));
          pick.setFamilies(all?.families || []);
          if (!families.length && Array.isArray(all?.families)) families = all.families;
          pick.setAccounts(o.accounts?.rows?.() || []);
          const set = learnsOn && models.summarizer !== "auto" ? String(models.summarizer || "") : "";
          pick.set(set);
          // The picker names the model set: words where none is, or memory has none to call.
          const learns = !learnsOn
            ? "Learning is off: choose a model, and memory learns from your chats again."
            : !models.now
              ? "No model for it yet: pick one here, or connect a key (step 2) — a coding agent alone gives memory none."
              : set
                ? ""
                : "Each chat's compaction model, else the chat's own.";
          note("memory", st?.enabled ? (set ? `On · ${modelName(set)}` : "On") : "Off");
          // Chats named by memory's model (Settings › Experimental): read where the configuration reads, written as that page writes it.
          const naming = cfg?.config ? namingRow(cfg.config?.experimental?.nameChats === true) : null;
          state.replaceChildren(
            m("div", { class: "wel-row" }, m("span", { class: "wel-row-name" }, "Memory"), m("span", { class: "wel-row-state" }, st?.enabled ? "On" : "Off")),
            ...(st?.enabled ? [m("div", { class: "wel-row" }, m("span", { class: "wel-row-name" }, "Learns with"), m("span", { class: "wel-row-state" }, pick.el, ...(learns ? [m("span", { class: "wel-hint" }, learns)] : [])))] : []),
            engineLine,
            ...(naming ? [naming] : []),
          );
          void paintEngine();
        } catch (/** @type {any} */ e) {
          if (box.isConnected) state.replaceChildren(m("p", { class: "wel-said bad" }, `Memory did not read: ${e?.message || e}`));
        }
      };
      /** "Name chats with memory's model", Settings › Experimental's switch. @param {boolean} named */
      const namingRow = (named) => {
        let now = named;
        const sw = m("button", { class: "set-switch", type: "button", role: "switch", "aria-label": "Name chats with memory's model" });
        const word = m("span", {});
        const show = () => {
          sw.classList.toggle("on", now);
          sw.setAttribute("aria-checked", now ? "true" : "false");
          word.textContent = now ? "On" : "Off";
        };
        show();
        sw.addEventListener("click", () => {
          now = !now;
          show();
          void call("/config/fields", { method: "PATCH", body: { set: { "experimental.nameChats": now } } }).then(
            () => o.onToast?.(now ? "Chats are named by memory's model" : "Chats keep the first line of their first message as their name"),
            (e) => {
              now = !now;
              show();
              o.onToast?.(e.message, "err");
            },
          );
        });
        return m("label", { class: "wel-row" },
          m("span", { class: "wel-row-name" }, "Name chats", m("span", { class: "wel-badge" }, "Experimental")),
          m("span", { class: "wel-row-state" }, sw, word, m("span", { class: "wel-hint wel-hint-line" }, "Memory's model names each chat from about 1K tokens of your first message, as you send it. Off: a chat keeps the first line of your first message.")));
      };
      void paint();
    },

    // ⑥ The chats you had in other coding agents, chosen and brought in from here (the owner's of 11-12: "it should
    // show the individual chat that one can select or select all to bring in"): the single chats a run could bring,
    // by agent, each with its tick, none chosen at first; the chosen ones come in as one run of Settings › Import's —
    // its bar and Stop —, and how far back the list reaches and whether memory reads what comes in are that page's
    // own writes. No agent is switched on for Sync now from here: that switch is Settings › Import's.
    import(box) {
      /** What the filter holds, kept while the step shows: the overview read again draws the step again. */
      let filter = "";
      const draw = () => {
        // The runs' bars are drawn with the step: those of the draw before are gone.
        chats.hosts.import = [];
        chats.hosts.read = [];
        const d = chats.st.data;
        box.classList.remove("wel-picking");
        if (chats.st.failed) {
          return void box.replaceChildren(
            m("p", { class: "wel-said bad" }, `Your coding agents' chats did not read: ${chats.st.failed}`),
            m("div", { class: "wel-line" }, button({ label: "Try again", variant: "ghost", size: "sm", onClick: readChats })));
        }
        if (!d) return void box.replaceChildren(m("p", { class: "wel-muted" }, "Looking for your coding agents' chats…"));
        /** @type {any[]} */
        const sources = d.sources || [];
        // Nothing to bring: one line, and Next goes on.
        if (!sources.some((s) => s.found)) return void box.replaceChildren(m("p", { class: "wel-lead" }, `${syncSays(d).head}${sources.length ? `: Filament looked for ${listed(sources.map((s) => `${s.label}'s`))}` : ""}.`));
        const busy = chats.busy();
        const groups = pickGroups(d);
        const total = groups.reduce((n, g) => n + g.chats.length, 0);
        const left = leftOutSays(d);
        /** @param {Listed} c */
        const keyOf = (c) => `${c.source}\n${c.id}`;
        /** Every tick drawn, with the chats it stands for now: a chat's own, an agent's shown, all those shown. @type {{ el: any, of: () => Listed[] }[]} */
        let ticks = [];
        /** @param {() => Listed[]} of @param {string} name  which tick it is, for the focus to find it after a draw */
        const tick = (of, name) => {
          const el = m("input", { type: "checkbox", class: "wel-tick", "data-pick": name, ...(busy ? { disabled: "" } : {}) });
          el.addEventListener("change", () => choose(of(), !!el.checked));
          const t = { el, of };
          ticks.push(t);
          return t;
        };
        /** Chats ticked or cleared: the choice stays in the list's order, and the step says what it is now. @param {Listed[]} which @param {boolean} on */
        const choose = (which, on) => {
          const sets = new Map(picks.map((p) => [p.source, new Set(p.chats)]));
          for (const c of which) {
            const set = sets.get(c.source) || new Set();
            if (on) set.add(c.id);
            else set.delete(c.id);
            sets.set(c.source, set);
          }
          picks = picksIn(d, [...sets].map(([source, set]) => ({ source, chats: [...set] })));
          says();
        };
        /** The groups as the filter leaves them. */
        let shown = groups;
        const all = tick(() => shown.flatMap((g) => g.shown.map((c) => ({ source: g.id, id: String(c.id) }))), "all");
        const allWords = m("span", {});
        const count = m("span", { class: "wel-pick-count" });
        const search = m("input", { class: "wel-input wel-pick-filter", type: "search", placeholder: "Filter by folder or words", "aria-label": "Filter by folder or words", spellcheck: "false", "data-pick": "filter", value: filter, ...(busy ? { disabled: "" } : {}) });
        const list = m("div", { class: "wel-pick-list" });
        const bring = m("div", { class: "wel-rows" });
        /** What is chosen, said again after a tick: each tick as it stands (in between where some of its chats are chosen), the count, and the press. */
        const says = () => {
          const has = new Set(picks.flatMap((p) => p.chats.map((id) => keyOf({ source: p.source, id }))));
          for (const t of ticks) {
            const of = t.of();
            const n = of.filter((c) => has.has(keyOf(c))).length;
            t.el.checked = of.length > 0 && n === of.length;
            t.el.indeterminate = n > 0 && n < of.length;
          }
          count.textContent = `${num(has.size)} of ${num(total)} chosen`;
          const to = bringSays(d, picks);
          // More to read than the drive has free is said before the press.
          const tight = busy ? null : tightSays(d, to, "Choose fewer chats.");
          bring.replaceChildren(
            m("div", { class: "wel-row wel-bring" },
              m("span", { class: "wel-row-state" }, m("span", { class: "wel-bring-head" }, busy ? "Bringing them in…" : to.head), !busy && to.sub ? m("span", { class: "wel-hint" }, to.sub) : null),
              button({ label: to.button, variant: "default", size: "sm", disabled: !to.can || busy, onClick: () => void chats.start("import", "/memory/import/chosen", { picks }) })),
            ...(tight ? [m("div", { class: "wel-status warn", role: "note" }, tight)] : []));
        };
        /** A chat's row: its tick, its words, where and when it was and how big it is; the whole row ticks it. @param {{ id: string }} g @param {any} c */
        const rowOf = (g, c) => {
          const words = String(c.title || c.preview || "untitled");
          const where = c.cwd ? m("span", { title: c.cwd }, baseName(c.cwd)) : c.project ? m("span", { title: "Its folder is not on this computer" }, String(c.project)) : null;
          const rest = [...(c.lastAt != null ? [whenWords(c.lastAt, clock())] : []), ...(c.bytes != null ? [`${c.about ? "about " : ""}${sizeWords(c.bytes)}`] : [])].join(" · ");
          // The spaces between its parts are for the row's name as it is read out: the row lays them out apart.
          return m("label", { class: "wel-pick-row", "data-chat": c.id },
            tick(() => [{ source: g.id, id: String(c.id) }], `chat ${g.id} ${c.id}`).el,
            m("span", { class: "wel-pick-words", title: words }, words),
            " ",
            m("span", { class: "wel-pick-meta" }, where, where && rest ? " · " : null, rest),
            ...(c.state === "grown" ? [" ", m("span", { class: "wel-badge", title: "Part of it is in Filament already: the rest comes in" }, "grown")] : []));
        };
        /** An agent's group: its head — its tick for the chats shown, its mark, its name, how many — and its chats; one whose store cannot be read says why, with no row. @param {ReturnType<typeof pickGroups>[number]} g */
        const groupOf = (g) => {
          const mark = markTile(m, { mark: null, name: g.label });
          const name = m("span", { class: "wel-pick-name" }, g.label);
          if (g.error) return m("section", { class: "wel-pick-group", "data-agent": g.id }, m("div", { class: "wel-pick-agent" }, mark, name, " ", m("span", { class: "wel-said bad" }, g.error)));
          const how = g.shown.length === g.chats.length ? countWords(g.chats.length, "chat") : `${num(g.shown.length)} of ${countWords(g.chats.length, "chat")}`;
          return m("section", { class: "wel-pick-group", "data-agent": g.id },
            m("label", { class: "wel-pick-agent" }, tick(() => g.shown.map((c) => ({ source: g.id, id: String(c.id) })), `agent ${g.id}`).el, mark, name, " ", m("span", { class: "wel-hint" }, how)),
            ...g.shown.map((c) => rowOf(g, c)));
        };
        // What the list leaves out, and where the rest comes in from, at the list's own end: said where one looks for
        // a chat that is not there, and no line of the step's own, which the list's height pays for.
        const foot = [left, "Settings › Import brings in more, any time."].filter(Boolean).join(" · ");
        const paintList = () => {
          shown = pickGroups(d, filter);
          const rows = shown.reduce((n, g) => n + g.shown.length, 0);
          const filtering = !!filter.trim();
          allWords.textContent = filtering ? `Select the ${num(rows)} shown` : "Select all";
          all.el.toggleAttribute("disabled", busy || !rows);
          ticks = [all];
          list.replaceChildren(
            ...shown.filter((g) => g.error || g.shown.length).map(groupOf),
            ...(filtering && !rows ? [m("p", { class: "wel-muted wel-pick-none" }, "No chat's folder or words hold that.")] : []),
            ...(total ? [m("p", { class: "wel-muted wel-pick-foot" }, foot)] : []));
          says();
        };
        search.addEventListener("input", () => {
          filter = String(search.value || "");
          paintList();
        });
        // Whether memory reads what comes in. Where it can read nothing the server says why, and the tour's own Memory
        // step is a press away; the chats come in either way.
        // One line tall, its words beside its switch: what it costs where it is on, that it costs nothing where it is off.
        const why = d.learner?.why || null;
        const withModel = d.learner?.model ? ` with ${modelName(String(d.learner.model))}` : "";
        const reads = why
          ? m("div", { class: "wel-row wel-reads" },
              m("span", { class: "wel-row-name" }, "Memory reads them"),
              m("span", { class: "wel-row-state" }, chats.learnSwitch(), `Not now: ${why}.`),
              button({ label: "Back to Memory", variant: "ghost", size: "sm", onClick: () => go(WELCOME_STEPS.findIndex((st) => st.id === "memory")) }))
          : m("label", { class: "wel-row wel-reads" },
              m("span", { class: "wel-row-name" }, "Memory reads them"),
              m("span", { class: "wel-row-state" }, chats.learnSwitch(), m("span", {}, d.prefs?.learn ? "On" : "Off"),
                m("span", { class: "wel-hint" }, d.prefs?.learn ? `Memory reads what comes in${withModel}, a call for every few turns.` : `No model is called. On, memory reads what comes in${withModel}.`)));
        // The step is drawn again as the overview is read: what had the focus in the list keeps it, and the list stays
        // where it was scrolled to, so a filter being typed or a tick reached by Tab is not taken from under the hand.
        const active = /** @type {any} */ (globalThis.document?.activeElement);
        const held = active && box.contains(active) ? { name: active.getAttribute?.("data-pick"), at: active.selectionStart } : null;
        const scrolled = box.querySelector(".wel-pick-list")?.scrollTop || 0;
        paintList();
        // With chats in reach the step fills the sheet, and the list takes what the rest leaves: it scrolls inside
        // itself, so the step is never taller than the sheet (1280 × 800).
        box.classList.toggle("wel-picking", total > 0);
        box.replaceChildren(
          m("div", { class: "wel-part wel-choose" },
            // What to do, and how far back the list reaches, on one line: every line above the list is a chat's row
            // less in it (the sheet is 720px tall at the most, and the list takes what the rest leaves).
            m("div", { class: "wel-titled" },
              // No chat in reach: the line says so, the reach beside it still there to widen it.
              m("p", { class: "wel-lead" }, total ? "Choose the chats to bring in. Nothing comes in until you press the button." : noneSays(d)),
              m("label", { class: "imp-reach" }, "Reaches back", chats.reachSelect("wel-select"))),
            ...(total
              ? [
                  m("div", { class: "wel-pick", role: "group", "aria-label": "Chats to bring in" },
                    m("div", { class: "wel-pick-head" }, m("label", { class: "wel-pick-all" }, all.el, allWords), count, search),
                    list),
                ]
              // An agent whose store cannot be read still says why; and what is left out, on a line of its own.
              : [...(groups.length ? [m("div", { class: "wel-pick wel-pick-only" }, list)] : []), ...(left ? [m("p", { class: "wel-muted" }, left)] : [])])),
          m("div", { class: "wel-part" },
            m("div", { class: "wel-rows" }, reads, total ? bring : null),
            chats.runHost("import"),
            chats.runHost("read")),
        );
        list.scrollTop = scrolled;
        if (held?.name) {
          const again = [search, ...ticks.map((t) => t.el)].find((el) => el.getAttribute("data-pick") === held.name && box.contains(el));
          again?.focus();
          if (again === search && held.at != null) search.setSelectionRange?.(held.at, held.at);
        }
      };
      // A run that moved draws its own bar (the keeper's); anything else draws the step again.
      shows = (moved) => { if (!moved) draw(); };
      offs.push(() => { shows = () => {}; });
      draw();
      // Read at each visit: what Settings › Import, or another window, changed since stands here too.
      readChats();
    },

    // ⑦ A project folder to work in.
    work(box) {
      const here = m("div", { class: "wel-rows" });
      box.append(part("A project folder", keysIn("Open the folder of a project you work on: your first chat starts there. Ctrl+O opens another one any time."), here));
      const paintFolder = () => {
        const recent = (o.folders?.() || []).filter((f) => f !== folder).slice(0, 4);
        const choose = button({ label: folder ? "Choose another…" : "Choose a folder…", variant: folder ? "ghost" : "default", onClick: () => void pickIt() });
        here.replaceChildren(
          ...(folder ? [m("div", { class: "wel-row wel-signed-in" }, m("span", { class: "wel-row-name" }, baseName(folder)), m("span", { class: "wel-row-state", title: folder }, `✓ ${folder}`))] : []),
          ...(o.pickFolder ? [m("div", { class: "wel-line" }, choose)] : [m("p", { class: "wel-muted" }, "Open folder… in the sidebar picks one.")]),
          ...(o.pickFolder && recent.length ? [m("div", { class: "wel-chips", "aria-label": "Folders worked in last" }, ...recent.map((f) => m("button", { type: "button", class: "wel-chip", title: f, onclick: () => void pickIt(f) }, baseName(f))))] : []),
        );
      };
      /** @param {string} [path] */
      const pickIt = async (path) => {
        const p = await o.pickFolder?.(path).catch(() => null);
        if (!p) return;
        folder = String(p);
        note("work", baseName(folder));
        if (box.isConnected) paintFolder();
      };
      paintFolder();
    },

    // ⑧ Who works in a chat, and whom your agent may bring in by itself: Library › Agents and teams' ticks.
    team(box) {
      const agents = m("div", { class: "wel-rows" }, m("p", { class: "wel-muted" }, "Reading your agents…"));
      const teams = m("div", { class: "wel-rows" });
      box.append(
        m("div", { class: "wel-cards wel-cards-2" }, ...withTeams(TEAM_CARDS).map((c) => m("div", { class: `wel-card wel-card-${c.id}` }, m("div", { class: "wel-card-title" }, c.title), m("p", {}, c.line), c.example ? example(c.example) : null))),
        part("Whom your agent may bring in by itself", `Your default for every chat. A chat's Agents tab has a gear for its own; ${agentsPage(state.config)} holds the cards, and the model each runs on.`, agents, teams),
      );
      /** @type {any} */
      let ag = null;
      /** @type {any} */
      let tm = null;
      // The plugins' agents too, as Library lists them: a tick written here keeps theirs.
      const cardsOf = () => [...(ag?.shipped || []), ...(ag?.saved || []), ...(ag?.plugins || [])].filter((c) => !c.partOf);
      const always = () => (Array.isArray(ag?.always) ? ag.always.map(String) : []);
      const ticked = () => (Array.isArray(ag?.ask) ? ag.ask.map(String) : []).filter((t) => cardsOf().some((c) => c.tag === t));
      const teamList = () => [...(tm?.saved || []), ...(tm?.shipped || [])];
      const teamTicks = () => (Array.isArray(tm?.agentTeams) ? tm.agentTeams.map(String) : []).filter((k) => teamList().some((t) => t.key === k));
      const factNow = () => {
        if (!ag) return;
        const n = always().filter((t) => cardsOf().some((c) => c.tag === t)).length + ticked().filter((t) => !always().includes(t)).length;
        const k = tm ? teamTicks().length : 0;
        note("team", `${count(n, "agent")}${k ? `, ${count(k, "team")}` : ""}`);
      };
      /** @param {string} cls @param {string} name @param {string} line @param {any} control */
      const tickRow = (cls, name, line, control) => m("label", { class: `wel-row ${cls}` }, m("span", { class: "wel-row-name" }, name), m("span", { class: "wel-row-state" }, line), control);
      const paintAgents = () => {
        const cards = cardsOf();
        agents.replaceChildren(...cards.map((c) => {
          if (always().includes(c.tag)) return tickRow("wel-always", c.name, c.goodFor || "", m("span", { class: "wel-badge" }, "Always"));
          const box2 = /** @type {HTMLInputElement} */ (m("input", { type: "checkbox", class: "wel-tick", "aria-label": `Your agent may bring in ${c.name}`, "data-tag": c.tag, ...(ticked().includes(c.tag) ? { checked: "" } : {}) }));
          box2.addEventListener("change", () => void setAsk(c, box2.checked));
          return tickRow("", c.name, c.goodFor || "", box2);
        }));
        factNow();
      };
      const paintTeams = () => {
        teams.replaceChildren(...teamList().map((t) => {
          const box2 = /** @type {HTMLInputElement} */ (m("input", { type: "checkbox", class: "wel-tick", "aria-label": `Your agent may send the ${t.name} team`, "data-team": t.key, ...(teamTicks().includes(t.key) ? { checked: "" } : {}) }));
          box2.addEventListener("change", () => void setTeam(t, box2.checked));
          return tickRow("wel-team", `${t.name} team`, String(t.line || ""), box2);
        }));
        factNow();
      };
      /** @param {any} c @param {boolean} on */
      async function setAsk(c, on) {
        try {
          const r = await call("/subagents/ask", { method: "PUT", body: { tags: askAfter(ticked(), c.tag, on) } });
          ag = { ...ag, ask: r?.ask || [] };
          o.onToast?.(on ? `Your agent may bring in ${c.name}, in every chat that chose no list of its own` : `Your agent no longer brings in ${c.name} by itself`);
        } catch (/** @type {any} */ e) {
          o.onToast?.(e?.message || String(e), "err");
        }
        if (box.isConnected) paintAgents();
      }
      /** @param {any} t @param {boolean} on */
      async function setTeam(t, on) {
        const rest = teamTicks().filter((k) => k !== t.key);
        try {
          const r = await call("/subagents/teams", { method: "PUT", body: { teams: on ? [...rest, t.key] : rest } });
          tm = { ...tm, agentTeams: r?.agentTeams || [] };
          o.onToast?.(on ? `Your agent may send the ${t.name} team by itself` : `Your agent no longer sends the ${t.name} team by itself`);
        } catch (/** @type {any} */ e) {
          o.onToast?.(e?.message || String(e), "err");
        }
        if (box.isConnected) paintTeams();
      }
      void call("/agents").then((r) => {
        ag = r || {};
        if (box.isConnected) paintAgents();
      }, (e) => box.isConnected && agents.replaceChildren(m("p", { class: "wel-said bad" }, `Your agents did not read: ${e?.message || e}`)));
      // The teams it may send by itself, while teams are on.
      if (teamsOn(state.config))
        void call("/teams").then((r) => {
          tm = r || {};
          if (box.isConnected) paintTeams();
        }, () => {});
    },

    // ⑨ The rest of Filament, by area, each with where it is and an example where one fits.
    discover(box) {
      const areas = ["All", ...new Set(FEATURES.map((f) => f.area))];
      let area = "All";
      const chips = m("div", { class: "wel-chips", role: "group", "aria-label": "Areas" });
      const grid = m("div", { class: "wel-grid" });
      box.append(chips, grid);
      const paint = () => {
        chips.replaceChildren(...areas.map((a) => m("button", { type: "button", class: `wel-chip${a === area ? " on" : ""}`, "aria-pressed": String(a === area), onclick: () => { area = a; paint(); } }, a)));
        grid.replaceChildren(...withTeams(FEATURES).filter((f) => area === "All" || f.area === area).map((f) =>
          m("div", { class: `wel-feat wel-card-${f.id}` },
            m("div", { class: "wel-feat-head" }, m("span", { class: "wel-tile", html: glyph(f.icon) }), m("div", { class: "wel-card-title" }, f.title)),
            m("p", {}, keysIn(f.line)),
            m("div", { class: "wel-feat-where" }, keysIn(f.where)),
            f.example ? example(f.example) : null)));
      };
      paint();
    },

    // ⑩ What was set, each with its way back, and the first chat.
    ready(box) {
      const list = m("div", { class: "wel-summary" }, m("p", { class: "wel-muted" }, "Reading what you set…"));
      const start = button({ label: "Start your first chat", variant: "default", onClick: () => { end("finish"); o.onStart?.(); } });
      box.append(
        list,
        m("div", { class: "wel-cta" }, start),
        part("Or try one of these", "", m("div", { class: "wel-examples" }, ...TRY.map(example))),
        m("p", { class: "wel-muted" }, keysIn("Settings › General, /welcome, the command center's Welcome tour (Ctrl+K) and the help menu open this tour again.")),
      );
      // Come here by Next, the keys go on to the first chat: a second Enter would have pressed Finish, starting none.
      if (globalThis.document?.activeElement === next) start.focus();
      /** @param {string} label @param {string} value @param {string} id @param {boolean} [warn] */
      const line = (label, value, id, warn = false) =>
        m("div", { class: `wel-row${warn ? " wel-warn" : ""}`, "data-step": id },
          m("span", { class: "wel-row-name" }, label),
          m("span", { class: "wel-row-state" }, value),
          button({ label: "Change", variant: "ghost", size: "sm", onClick: () => go(WELCOME_STEPS.findIndex((st) => st.id === id)) }));
      // The chats brought in, as the rail says them — read here where Your chats was never opened, and kept up as a run moves.
      const chatsLine = () => (chats.st.data ? chatsFact(chats.st.data, chats.st.run.import) : chats.st.failed ? "Not read" : "Looking for them…");
      shows = () => {
        const el = list.querySelector('[data-step="import"] .wel-row-state');
        if (el) el.textContent = chatsLine();
      };
      offs.push(() => { shows = () => {}; });
      if (!chats.st.data && !chats.st.failed) readChats();
      void Promise.all([call("/start").catch(() => null), call("/defaults/settings").catch(() => null)]).then(([st, d]) => {
        if (!box.isConnected) return;
        connectFact(st);
        if (st?.memory?.enabled && st.memory.learnsWith && !st.memory.chosen) note("memory", `On · ${modelName(st.memory.learnsWith)}`);
        const c = st?.connected;
        const mode = MODES.find((x) => x.id === String(d?.flat?.["loop.permissions"] || "edit"));
        const name = pref.get() || pref.last();
        const lv = name ? levelOf(name) : "";
        const mem = st?.memory;
        list.replaceChildren(
          line("Models", c ? (c.ok ? `${count(Number(c.models) || 0, "model")} can answer` : unlistedOf(c).length ? `${listed(unlistedOf(c))}: models not listed yet` : "Nothing can answer yet") : "Not read", "connect", !!c && !c.ok),
          line("New chats start on", name ? `${modelName(name)}${lv ? ` · ${levelWords(lv)} effort` : ""}${pref.get() ? "" : " (until you choose one)"}` : "The model you pick in the chat", "model"),
          line("How it asks", mode ? mode.label : "Not read", "asks"),
          line("Memory", mem ? (mem.enabled ? `On${!mem.learnsWith ? ", no model for it yet" : mem.chosen ? ", learning with each chat's own model" : `, learning with ${modelName(mem.learnsWith)}`}` : "Off") : "Not read", "memory"),
          line("Your chats", chatsLine(), "import"),
          line("First chat in", folder || "No folder yet: Change picks one, or your first chat asks", "work"),
        );
      });
    },
  };

  go(at);
  // The sheet focuses its ×; the way on is Next, which Enter presses.
  next.focus();
  return { close: () => s.close(), go, step: () => at };
}
