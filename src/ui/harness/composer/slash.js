// @ts-check
// The slash and mention panels (AgentPlanUX §5.8): `/` lists commands and agents; `@` lists your saved
// agents first where a tag would address them — at the start of a message, among its leading tags (HarnessV4_Tasks
// E15 step 2) — and later in a message to the main agent, where a tag names an agent or a team for the main agent to
// use (HarnessV4_OneAgent_Plan OA2, L28) — then sessions, and the project's files and folders by the letters typed, in
// order (the owner's of 11-04: "press @ and tag the files from a project"): a folder picked opens on what it holds, and
// lines typed after a path (`#L10-40`) ride on the file picked; `@#` and a name lists the project's names its language
// servers know, a pick tagging the name's file with its lines (the owner's LSP of 11-04); `#` lists sessions. Typing filters; arrows
// move, Enter inserts, Esc closes. `$` lists the skills (the owner's of 10-28: "put the skill behind $ symbol so that to
// are easy to find and load"): those on in the chat, then the Library's off here — a pick writes `$<name>`, and the
// message loads it for its turn —, then the on plugins'; a `$` that names none (`$PATH`, `$5`) shows no panel. Selecting inserts the token — the harness writes what the model will actually see, never a hidden
// attachment: a past chat is tagged where it is typed, `[its title](chat:<id>)`, for the model to load by its memory
// tool where it needs it (the owner's word of 10-26, labels.js `chatTag`); in a chat whose model has no memory tools,
// it is pasted in at Send by the visible first line `@mem load <id>` (docs/COMMANDS.md).
// Drawn like Spotlight (HarnessV3 §15 item 92): a glass panel over the composer, the trigger and what it finds in its
// head, each row on a tile in its kind's color with the typed text marked in its name, the chosen row filled in the
// accent with the return key on it, and the keys along the foot. Since the design pass of 10-24 (UX7) the commands
// stand in groups (`commandRows`): Everyday first, then Make room — its four each saying how it differs — then the
// rest under their catalogue groups' names.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { WORDS } from "../lib/words.js";
import { chatTag, fileTag, noteSkillNames } from "../lib/labels.js";
import { state } from "../state.js";
import { teamsOn } from "../../lib/teams-on.js";

/** The chats' section where the chat's model has no memory tools to load a tagged one: picked, it is pasted in at Send. */
export const PASTED_IN = "Pasted in at Send — this chat has no memory tools";

/**
 * A row of the panel. `again`: picked, it is typed in and the panel opens on what it names (a folder's files).
 * @typedef {{ label: string, insert: string, detail?: string, prefixLine?: string, picker?: string, section?: string, mono?: boolean, kind?: string, tag?: string, brief?: string, again?: boolean }} Row
 */

/**
 * What an `@` typed holds: a path, and the lines after it (`#L10`, `#L10-40`) that the file picked carries — of a
 * range half typed (`#L10-`), what is whole.
 * @param {string} query
 */
export function mentionParts(query) {
  const at = query.indexOf("#");
  if (at < 0) return { path: query, range: "" };
  const m = /^L(\d+)(?:-(\d+))?/i.exec(query.slice(at + 1));
  return { path: query.slice(0, at), range: m ? `#L${m[1]}${m[2] ? `-${m[2]}` : ""}` : "" };
}

/** Each kind's tile: its glyph and its color. */
const KINDS = /** @type {Record<string, { icon: string, tone: string }>} */ ({
  command: { icon: "squareSlash", tone: "var(--color-sys-gray)" },
  agent: { icon: "bot", tone: "var(--color-sys-purple)" },
  model: { icon: "sparkles", tone: "var(--color-sys-gray)" },
  card: { icon: "atSign", tone: "var(--color-sys-purple)" },
  team: { icon: "users", tone: "var(--color-sys-yellow)" },
  "agent-command": { icon: "squareSlash", tone: "var(--color-sys-purple)" },
  file: { icon: "fileText", tone: "var(--color-sys-blue)" },
  folder: { icon: "folder", tone: "var(--color-sys-blue)" },
  symbol: { icon: "code", tone: "var(--color-sys-green)" },
  session: { icon: "messageSquare", tone: "var(--color-sys-indigo)" },
  skill: { icon: "wandSparkles", tone: "var(--color-sys-pink)" },
});
/** What each trigger finds, for the panel's head. */
const HEADS = /** @type {Record<string, string>} */ ({ "/": "Commands", "@": "Chats and files", "#": WORDS.pastChats, $: "Skills" });
/** The `@` panel's head where a tag would address a saved agent. */
const HEAD_WITH_AGENTS = "Agents, teams, chats and files";
/** The same while Settings › Experimental's Teams switch is off (src/ui/lib/teams-on.js). */
const HEAD_WITH_AGENTS_ALONE = "Agents, chats and files";
/** The `@` panel's head later in a message to the main agent, where a tag names an agent or a team for it to use (L28). */
const HEAD_WITH_USE = "For your agent to use";

/**
 * The typed text marked in a row's name (the first match, case-insensitive).
 * @param {string} label @param {string} q
 */
function marked(label, q) {
  const at = q ? label.toLowerCase().indexOf(q) : -1;
  if (at < 0) return [label];
  return [label.slice(0, at), h("mark", { class: "slash-mark" }, label.slice(at, at + q.length)), label.slice(at + q.length)].filter((x) => x !== "");
}

/**
 * @param {{ onInsert: (text: string, o?: { prefixLine?: string }) => void, onToast?: (msg: string) => void, getChain?: () => string, getFolder?: () => string,
 *   onOpenModel?: (query: string) => void, modelMatches?: (query: string) => boolean, modelKey?: () => string, getAgentRun?: () => string | null, onActive?: (id: string | null) => void,
 *   getCards?: () => import("../lib/agent-cards.js").AgentCard[], getTeams?: () => { key: string, name: string, line?: string }[],
 *   onBrief?: (team: string) => void, memoryTools?: () => boolean }} cb
 *   `onActive`: the highlighted row's id (the text field owns the focus and announces it), null when the panel closes;
 *   `getAgentRun`: on a coding agent's chat, a run of the agent's, whose session's commands the panel offers;
 *   `getCards`: your saved agents; `getTeams`: the teams, whose row opens the team's Brief (`onBrief`) and sends nothing;
 *   `memoryTools`: false where the chat's model has no memory tools to load a tagged chat; `onOpenModel`: the box's
 *   model picker, opened on the words typed (`modelMatches`: whether they find a model there; `modelKey`: its key)
 * @returns {{ el: HTMLElement, open: (kind: string, query: string, o?: { agents?: boolean, use?: boolean }) => void, move: (dir: number) => void, choose: () => boolean, close: () => void, isOpen: () => boolean }}
 */
/**
 * What picking a command puts in the box: its own words, up to where yours begin (`/btw <question>` gives `/btw `), so
 * the name of what to type is never sent as if it were typed.
 * @param {string} command
 */
export const typedOf = (command) => `${command.split(/\s*</)[0]} `;

/** The commands typed most, first in the `/` list (the design pass of 10-24, UX7). */
const EVERYDAY = Object.freeze(["/btw <question>", "/steer-fork <message>", "/subagent <task>", "/status", "/cost", "/help", "/flow <words>", "/plan <words>", "/craft <words>", "/team <name>", "/settings"]);
/**
 * The four that make room, next, each saying how it differs from the others.
 * @returns {[string, string][]}
 */
const roomWays = () => [
  ["/compaction", "Asks first: the card with every way to make room, what each keeps and costs; you choose"],
  ["/compact", "Now, no card: the chat's own way — one summary, or an instant fold; a coding agent compacts its own context, told what to keep; Undo until the next message"],
  ["/autofit", "Just enough: only the oldest turns the window needs, never more"],
  ["/autocompact", "Makes no room now: where this chat's line stands, said in tokens"],
];

/**
 * The `/` list's commands in groups (UX7): Everyday, then Make room — its four each saying how it differs —, then the
 * rest under their catalogue groups' names, in the catalogue's order. Every command is listed once, a pick typing its
 * own words (`typedOf`); typing keeps each group's matches.
 * @param {{ words?: any, groups?: { title?: string, commands?: any[] }[], commands?: any[] }} catalog @param {string} q  lower-cased
 * @returns {Row[]}
 */
export function commandRows(catalog, q) {
  const groups = catalog.commands?.length ? [{ title: "Commands", commands: catalog.commands }] : catalog.groups || [];
  const all = groups.flatMap((g) => (g.commands || []).map((c) => ({ c, group: String(g.title || "Commands") })));
  /** @param {any} c */
  const nameOf = (c) => String(c.command || `/${c.name || c}`);
  const room = new Map(roomWays());
  /** @type {Map<string, string>} */
  const lead = new Map();
  for (const k of EVERYDAY) lead.set(k, "Everyday");
  for (const k of room.keys()) lead.set(k, "Make room");
  const order = ["Everyday", "Make room", ...new Set(all.map((x) => x.group))];
  const rowOf = (/** @type {{ c: any, group: string }} */ x) => {
    const name = nameOf(x.c);
    return /** @type {Row} */ ({ section: lead.get(name) || x.group, kind: "command", label: name, insert: typedOf(name), detail: room.get(name) || x.c.summary || "", mono: true });
  };
  const rows = all.filter((x) => !q || nameOf(x.c).toLowerCase().includes(q)).map(rowOf);
  /** The lead groups in their own order, the commands' order within each. */
  const rank = (/** @type {Row} */ r) => {
    const at = r.section === "Everyday" ? EVERYDAY.indexOf(r.label) : r.section === "Make room" ? [...room.keys()].indexOf(r.label) : 0;
    return order.indexOf(String(r.section)) * 1000 + at;
  };
  return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}

/** How long the `$` list keeps the skills it read: one read for a word typed, a skill added in the Library seen soon. */
const SKILLS_FRESH_MS = 10_000;
/** The `$` list's sections. */
export const SKILL_SECTIONS = Object.freeze({ on: "Always on in this chat", off: "Tag to load it for this message", plugin: "From your plugins" });

/**
 * The `$` list's rows from the skills route's answer (`GET /skills?place=`): yours on at the chat's place, then yours
 * off there — a call loads one for its turn alone (agent/skills.js `withCalled`) —, then the skills of the plugins on
 * there. A pick writes `$<name> `. Typing keeps the names that hold it, and the descriptions with a word that starts
 * with it, three characters on: `$5` and `$HO` are a price and a variable half typed, never "Opus 5.5" and "How"
 * (the Hunter's of 10-28). A word typed with no lower-case letter keeps only the names that start with it as written:
 * `$HOME` and `$5` name nothing, `$D` and `$3` a skill named Deploy or 3d-print (the Hunter's of 10-28: a name may
 * start with a capital or a digit).
 * @param {{ skills?: { name: string, description?: string, on?: { on?: boolean } }[], plugins?: { name: string, title?: string, on?: boolean, skills?: string[] }[] } | null} got
 * @param {string} q  lower-cased
 * @param {string} [typed]  as typed
 * @returns {Row[]}
 */
export function skillRows(got, q, typed = q) {
  const exact = !!typed && !/[a-z]/.test(typed);
  const has = (/** @type {unknown} */ s) => !q || (exact ? String(s || "").startsWith(typed) : String(s || "").toLowerCase().includes(q));
  const word = q.length >= 3 && !exact ? new RegExp(`(?:^|[^a-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) : null;
  const told = (/** @type {unknown} */ s) => !q || (!!word && word.test(String(s || "").toLowerCase()));
  const row = (/** @type {string} */ name, /** @type {string} */ detail, /** @type {string} */ section) =>
    /** @type {Row} */ ({ section, kind: "skill", label: `$${name}`, insert: `$${name} `, detail, mono: true });
  const yours = (got?.skills || []).filter((s) => s && s.name && (has(s.name) || told(s.description)));
  return [
    ...yours.filter((s) => s.on?.on).map((s) => row(s.name, String(s.description || ""), SKILL_SECTIONS.on)),
    ...yours.filter((s) => !s.on?.on).map((s) => row(s.name, String(s.description || ""), SKILL_SECTIONS.off)),
    ...(got?.plugins || []).filter((x) => x?.on).flatMap((x) => (x.skills || []).filter(has).map((n) => row(n, String(x.title || x.name), SKILL_SECTIONS.plugin))),
  ];
}

/**
 * The `/` list's way to the model (the Designer's of 10-28, on the owner's "anywhere in the harness where model picker
 * is used, have it use our standard model picker"): one row, Change the model…, last — with nothing typed, words
 * "model" holds, or words the picker's search finds a model for (`/opus`, `/glm`, `/fast`, `/1m`) — which opens the
 * box's picker on them. Never a list of models.
 * @param {{ modelMatches?: (query: string) => boolean, modelKey?: () => string, onOpenModel?: (query: string) => void }} cb
 * @param {string} query @returns {Row[]}
 */
export function modelRow(cb, query) {
  if (!cb.onOpenModel) return [];
  const q = query.trim().toLowerCase();
  if (q && !"model".includes(q) && !cb.modelMatches?.(q)) return [];
  const key = cb.modelKey?.() || "";
  const searched = q && !"model".includes(q);
  return [{ section: "Model", kind: "model", label: "Change the model…", insert: "", picker: searched ? query.trim() : "", detail: searched ? `Opens the model picker on “${query.trim()}”` : `Opens the model picker${key ? ` · ${key}` : ""}` }];
}

export function createSlashPanel(cb) {
  const el = h("div", { class: "slash-panel hidden", role: "listbox", "aria-label": "Suggestions" });
  /** @type {Row[]} */
  let rows = [];
  let hi = 0;
  let kind = "";
  let typed = "";
  let seq = 0;
  let loading = false;
  /** The `@` panel is open where a tag would address a saved agent: they lead its rows. */
  let withAgents = false;
  /** The `@` stands later in a message to the main agent: a tag there names an agent or a team for it to use (`usesIn`). */
  let withUse = false;

  const EMPTY = { "/": "No matching commands", "@": "No matching chats or files", "#": "No past chats match", $: "No skills yet — Library › Skills adds them" };
  /** The skills route's answer, read at most every SKILLS_FRESH_MS; typing filters it. @type {any} */
  let skillsGot = null;
  let skillsAt = 0;
  /** The chat it was read for ("" for none yet): the one box serves every chat, and each has its own on and off. */
  let skillsFor = "";
  /** Why an `@#` lists no name, where the servers said: none serves the project's files, one is starting. */
  let emptySaid = "";
  /** The `@` panel lists the project's names (`@#`): from files to names, or back, is a list of its own. */
  let asSymbols = false;
  /** The `@#` ask on its way: a key typed stops it, so a language server answers the newest alone. @type {AbortController | null} */
  let symbolsAsk = null;

  const paint = () => {
    /** @type {(HTMLElement | null)[]} */
    const out = [h("div", { class: "slash-head" },
      h("kbd", { class: "slash-trigger" }, kind || "/"),
      h("span", { class: "slash-head-title" }, typed ? h("span", { class: "slash-query" }, typed) : (kind === "@" && withAgents ? (teamsOn(state.config) ? HEAD_WITH_AGENTS : HEAD_WITH_AGENTS_ALONE) : kind === "@" && withUse ? HEAD_WITH_USE : HEADS[kind]) || "Suggestions"),
      h("span", { class: "slash-head-count" }, loading ? "Searching…" : rows.length ? `${rows.length} ${rows.length === 1 ? "result" : "results"}` : ""))];
    const list = h("div", { class: "slash-list" });
    let section = "";
    // After `@#`, the name typed is what a row's name holds.
    const q = (asSymbols ? typed.slice(1) : typed).toLowerCase();
    rows.forEach((r, i) => {
      if (r.section && r.section !== section) {
        section = r.section;
        list.append(h("div", { class: "slash-section" }, section));
      }
      const k = KINDS[r.kind || ""] || KINDS.command;
      list.append(h("button", {
        class: `slash-row${i === hi ? " on" : ""}`, type: "button", role: "option", id: `slash-row-${i}`, "aria-selected": i === hi ? "true" : "false",
        onclick: () => pick(i),
        onpointermove: () => { if (hi !== i) { hi = i; paintHi(); } },
      },
        h("span", { class: "slash-tile", style: `--tone:${k.tone}`, html: /** @type {any} */ (ICONS)[k.icon] || "" }),
        h("span", { class: "slash-text" },
          h("span", { class: `slash-label${r.mono ? " mono" : ""}` }, ...marked(r.label, q), r.tag ? h("span", { class: "slash-tagword" }, ...marked(r.tag, q)) : null),
          r.detail ? h("span", { class: "slash-detail" }, r.detail) : null),
        h("span", { class: "slash-enter", "aria-hidden": "true", html: ICONS.cornerDownLeft })));
    });
    if (!rows.length) list.append(h("div", { class: "slash-empty" }, h("span", { class: "slash-empty-ic", html: ICONS.search }), loading ? "Searching…" : emptySaid || (kind === "@" && (withAgents || withUse) ? "No matching agents, chats or files" : /** @type {any} */ (EMPTY)[kind] || "Nothing matches")));
    out.push(list);
    out.push(h("div", { class: "slash-foot" },
      h("span", { class: "slash-key" }, h("kbd", {}, "↑"), h("kbd", {}, "↓"), "to move"),
      h("span", { class: "slash-key" }, h("kbd", {}, "↵"), "to insert"),
      h("span", { class: "slash-key" }, h("kbd", {}, "esc"), "to close"),
      // A range after an agent's tag hands it that change as a patch (HarnessV4_Tasks E15 step 4).
      kind === "@" && withAgents ? h("span", { class: "slash-key slash-tip" }, h("kbd", {}, "since:v1.2"), "after a tag: it reads the changes since then") : null));
    el.replaceChildren(...out.filter(Boolean));
    el.querySelector(".slash-row.on")?.scrollIntoView({ block: "nearest" });
    cb.onActive?.(rows.length ? `slash-row-${hi}` : null);
  };
  /** Move the highlight without rebuilding the rows under the pointer. */
  const paintHi = () => {
    el.querySelectorAll(".slash-row").forEach((b, i) => {
      b.classList.toggle("on", i === hi);
      b.setAttribute("aria-selected", i === hi ? "true" : "false");
    });
    el.querySelector(".slash-row.on")?.scrollIntoView({ block: "nearest" });
    cb.onActive?.(rows.length ? `slash-row-${hi}` : null);
  };

  /** @param {number} i */
  function pick(i) {
    const r = rows[i];
    if (!r) return;
    // Change the model…: the typed /opus leaves the box, and the picker opens on it — never a model picked from here.
    if (r.picker != null) {
      cb.onInsert("");
      close();
      cb.onOpenModel?.(r.picker);
      return;
    }
    // A team is sent from its Brief (team_v2_plan §10 O5): the tag typed goes, and the Brief opens on the team.
    if (r.brief) {
      cb.onInsert("");
      close();
      cb.onBrief?.(r.brief);
      return;
    }
    // A folder is typed in, and the panel opens on what it holds — anew: no row of the last search stays to be picked.
    if (r.again) {
      cb.onInsert(r.insert);
      void open(kind, r.insert.slice(kind.length), { agents: withAgents, use: withUse, anew: true });
      return;
    }
    cb.onInsert(r.insert, r.prefixLine ? { prefixLine: r.prefixLine } : undefined);
    close();
  }

  /** The coding agent's own commands (AC1-6), under its name: they go to the agent as the message's text. @param {string} q */
  const agentCommands = async (q) => {
    const runId = cb.getAgentRun?.() || "";
    if (!runId) return [];
    const r = await api(`/runs/${encodeURIComponent(runId)}/agent-commands`).catch(() => null);
    const section = `${r?.agent || "The agent"}'s commands`;
    return (r?.commands || []).filter((/** @type {any} */ c) => !q || String(c.name).toLowerCase().includes(q))
      .map((/** @type {any} */ c) => /** @type {Row} */ ({ section, kind: "agent-command", label: `/${c.name}`, insert: `/${c.name} `, detail: c.description || c.hint || "", mono: true }));
  };
  /** Your saved agents, by tag or name: choosing one writes its tag, and the message is then that agent's. @param {string} q */
  const cards = (q) =>
    (cb.getCards?.() || [])
      .filter((c) => !q || c.tag.includes(q) || c.name.toLowerCase().includes(q))
      .map((c) => /** @type {Row} */ ({ section: "Agents", kind: "card", label: c.name, tag: `@${c.tag}`, insert: `@${c.tag} `, detail: c.goodFor }));
  /**
   * Your saved agents later in a message to the main agent (HarnessV4_OneAgent_Plan OA2): choosing one writes its tag,
   * and the main agent is told to use it; nothing starts at Send. @param {string} q
   */
  const uses = (q) => {
    return cards(q).map((r) => ({ ...r, section: "Agents" }));
  };
  /**
   * The teams later in a message to the main agent: choosing one writes its key, and the main agent is told to start it
   * with its team tool; nothing starts at Send. @param {string} q
   */
  const teamUses = (q) =>
    (cb.getTeams?.() || [])
      .filter((t) => !q || t.key.includes(q) || t.name.toLowerCase().includes(q))
      .map((t) => /** @type {Row} */ ({ section: "Teams", kind: "team", label: t.name, tag: `@${t.key}`, insert: `@${t.key} `, detail: t.line || "" }));
  /** The teams, by name or key: choosing one opens its Brief — on the side or in charge — and starts nothing. @param {string} q */
  const teams = (q) =>
    (cb.getTeams?.() || [])
      .filter((t) => !q || t.key.includes(q) || t.name.toLowerCase().includes(q))
      .map((t) => /** @type {Row} */ ({ section: "Send a team", kind: "team", label: t.name, tag: `@${t.key}`, insert: "", detail: "Opens its Brief — Send starts it", brief: t.key }));
  /**
   * Past chats: picked, one is tagged where it was typed — its id for the model to load where it needs it, nothing
   * pasted in at Send; where the chat's model has no memory tools, its visible first line pastes it in at Send.
   * @param {string} query @param {string} q
   */
  const sessions = async (query, q) => {
    const r = await api(`/memory/sessions?limit=20${q ? `&q=${encodeURIComponent(query)}` : ""}`).catch(() => ({ sessions: [] }));
    const tools = cb.memoryTools?.() !== false;
    return (r.sessions || []).map((/** @type {any} */ s) => {
      const label = String(s.title || s.preview || s.id);
      return /** @type {Row} */ (tools
        ? { section: WORDS.chats, kind: "session", label, insert: `${chatTag(label, String(s.id))} `, detail: s.id }
        : { section: PASTED_IN, kind: "session", label, insert: "", detail: s.id, prefixLine: `@mem load ${s.id}` });
    });
  };
  /**
   * The skills where this chat stands, else everywhere's (a chat not started yet) — null where they could not be read:
   * never everywhere's in a started chat's place, whose on and off differ (the Hunter's of 10-28).
   */
  const skillsHere = async () => {
    const chain = cb.getChain?.() || "";
    const got = await api(chain ? `/skills?place=${encodeURIComponent(`chat:${chain}`)}` : "/skills?place=all").catch(() => null);
    if (got) noteSkillNames([...(got.skills || []).map((/** @type {any} */ s) => String(s?.name || "")), ...(got.plugins || []).flatMap((/** @type {any} */ p) => (p?.skills || []).map(String))]);
    return got;
  };
  /**
   * The project's files and folders an `@` names (`/files/mentions`): by the letters typed, in order, or once a
   * folder's `/` is typed, what it holds. The message carries the path alone (the owner's of 11-04), in quotes where it
   * is no bare one (`fileTag`): a file picked with the lines typed after it (`#L10-40`); a folder picked is typed in,
   * and the panel opens on what it holds.
   * @param {string} query
   */
  const files = async (query) => {
    const cwd = cb.getFolder?.() || "";
    const { path, range } = mentionParts(query);
    if (!cwd || !path) return [];
    const found = await api(`/files/mentions?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(path)}&limit=12`).catch(() => null);
    const under = found?.under ? String(found.under) : "";
    const inside = under ? `In ${under}` : "";
    const fileRows = (found?.files || []).map((/** @type {any} */ f) => /** @type {Row} */ ({ section: inside || "Files", kind: "file", label: f.name || f.path, insert: `${fileTag(String(f.path))}${range} `, detail: f.path, mono: true }));
    // A folder whose tag needs quotes is tagged whole: no word typed after a quote goes on searching in it.
    const folderRows = (found?.folders || []).map((/** @type {any} */ d) => {
      const tag = fileTag(String(d.path));
      const bare = !tag.startsWith('@"');
      return /** @type {Row} */ ({ section: inside || "Folders", kind: "folder", label: `${d.name}/`, insert: bare ? tag : `${tag} `, again: bare, detail: d.path, mono: true });
    });
    return under ? [...folderRows, ...fileRows] : [...fileRows, ...folderRows];
  };
  /**
   * The project's names an `@#` asks for (`/lsp/symbols`): what the chat's language servers know by the name typed, each
   * a row whose pick tags its file with its lines (`@src/a.js#L10-40`) — the chip that opens it there — and, where none
   * is found, why.
   * @param {string} name @returns {Promise<{ rows: Row[], said: string }>}
   */
  const symbols = async (name) => {
    symbolsAsk?.abort();
    symbolsAsk = null;
    const cwd = cb.getFolder?.() || "";
    if (!cwd) return { rows: [], said: "Pick the chat's folder first: its project's names are listed by its language servers" };
    if (!name) return { rows: [], said: "Type a name: the project's names its language servers know" };
    const chain = cb.getChain?.() || "";
    const ask = (symbolsAsk = new AbortController());
    const got = await api(`/lsp/symbols?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(name)}${chain ? `&chain=${encodeURIComponent(chain)}` : ""}`, { signal: ask.signal }).catch(() => null);
    if (symbolsAsk === ask) symbolsAsk = null;
    if (!got) return { rows: [], said: "The project's names could not be read" };
    const rows = (got.symbols || []).map((/** @type {any} */ s) => {
      const lines = s.line ? `#L${s.line}${s.end > s.line ? `-${s.end}` : ""}` : "";
      return /** @type {Row} */ ({ section: "Symbols", kind: "symbol", label: String(s.name), insert: `${fileTag(String(s.path))}${lines} `, detail: `${s.kind}${s.container ? ` in ${s.container}` : ""} · ${s.path}${s.line ? `:${s.line}` : ""}`, mono: true });
    });
    return { rows, said: rows.length ? "" : String(got.said || "") || "No name like it in the project" };
  };

  /**
   * @param {string} k  "/", "@", "#" or "$"
   * @param {string} query
   * @param {{ agents?: boolean, use?: boolean, anew?: boolean }} [o]  `agents`: the `@` stands where a tag addresses a
   *   saved agent; `use`: later in a message to the main agent, where a tag names an agent or a team for it to use;
   *   `anew`: a list of its own, not a refinement of the one shown (a folder picked opens on what it holds)
   */
  async function open(k, query, o = {}) {
    // A `$` before a word with no lower-case letter is a variable or a price (`$HOME`, `$5`) unless a skill the list
    // read is named so: nothing is asked for it, and with no list read, no panel (the Hunter's of 10-28).
    const exact = k === "$" && !!query && !/[a-z]/.test(query);
    if (exact && !skillsGot) return close();
    const names = k === "@" && query.startsWith("#");
    const reopened = kind !== k || o.anew === true || names !== asSymbols;
    asSymbols = names;
    if (!names) {
      symbolsAsk?.abort();
      symbolsAsk = null;
    }
    kind = k;
    typed = query;
    withAgents = k === "@" && o.agents === true;
    withUse = k === "@" && !withAgents && o.use === true;
    // The `$` panel shows once it has skills to list: a `$PATH` typed never flashes it.
    if (k !== "$") el.classList.remove("hidden");
    const q = query.toLowerCase();
    const mine = ++seq;
    // A first open says it is looking; a refinement keeps the rows it has until the new ones land.
    if (reopened && k !== "$") { rows = []; loading = true; paint(); }
    /** @type {Row[]} */
    let next = [];
    let said = "";
    try {
      if (names) {
        ({ rows: next, said } = await symbols(query.slice(1)));
      } else if (k === "/") {
        const cmds = commandRows(await api("/commands"), q);
        // On an agent's chat, the agent's own commands lead: they are what its chat is for.
        next = [...(await agentCommands(q)), ...cmds, ...modelRow(cb, query)];
      } else if (k === "@") {
        const agents = withAgents ? [...cards(q), ...teams(q)] : withUse ? [...uses(q), ...teamUses(q)] : [];
        // The agents are on the page already: they show while the chats and files are searched. The chats come before
        // the files, found by their names too (the owner's word of 11-02: a chat was found under every file).
        if (reopened && agents.length) { rows = agents; hi = 0; paint(); }
        const [chats, found] = await Promise.all([sessions(query, q), files(query)]);
        next = [...agents, ...chats, ...found];
      } else if (k === "#") {
        next = await sessions(query, q);
      } else if (k === "$") {
        // Read once a while: the word typed after a `$` that named none asks nothing more. Another chat, or this one once
        // it started, reads again: its skills are on and off where it stands (the Hunter's of 10-28).
        const here = cb.getChain?.() || "";
        if (!exact && (!skillsGot || skillsFor !== here || Date.now() - skillsAt > SKILLS_FRESH_MS)) {
          // One that could not be read is read again at the next `$`, never kept.
          skillsGot = await skillsHere();
          skillsAt = Date.now();
          skillsFor = here;
        }
        next = skillRows(skillsGot, q, query);
      }
    } catch {
      next = [];
    }
    if (mine !== seq || kind !== k) return;
    // A `$` that names no skill is a word of the message (`$PATH`, `$5`): no panel over it — nor over skills that could
    // not be read, which says nothing true.
    if (k === "$" && ((q && !next.length) || !skillsGot)) return close();
    el.classList.remove("hidden");
    rows = next;
    emptySaid = said;
    loading = false;
    hi = 0;
    paint();
  }

  const close = () => { el.classList.add("hidden"); kind = ""; typed = ""; rows = []; emptySaid = ""; loading = false; withAgents = false; withUse = false; asSymbols = false; symbolsAsk?.abort(); symbolsAsk = null; cb.onActive?.(null); };

  return {
    el,
    open,
    /** @param {number} dir */
    move(dir) { if (!rows.length) return; hi = (hi + dir + rows.length) % rows.length; paintHi(); },
    choose() { if (!kind || !rows.length) return false; pick(hi); return true; },
    close,
    isOpen: () => !!kind && !el.classList.contains("hidden"),
  };
}
