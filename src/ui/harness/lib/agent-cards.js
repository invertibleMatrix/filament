// @ts-check
// Saved agents on the page (HarnessV4_Tasks E15 steps 2 and 4). An agent is kept as a card (services/agent-cards.js):
// its tag, its name, what it is good for, how it thinks, what it may do, its model and what it sees — one kind of agent
// (HarnessV4_OneAgent_Plan OA1). Here: the words every surface says a card in — the `@` panel, the line over the composer, the
// chat's card, Settings › Agents — so the same card reads the same everywhere; the reading of a draft that starts with
// tags; and the list, kept current by the feed (`agents-changed`).
// Step 3 adds whom a session's main agent may ask by itself: a list of tags, the ticks on the cards as its default,
// read here into the cards it names and the few words a row says it in.
import { api } from "./api.js";
import { onBus } from "./bus.js";
import { CHAT_LINK } from "./labels.js";

/**
 * @typedef {{ tag: string, name: string, goodFor: string, thinks: string, may: "read" | "copy" | "edit",
 *   model: string | null, sees: { view: string, running: boolean, changes: "turn" | "uncommitted" | null }, shipped: boolean,
 *   from?: string | null, always?: boolean, partOf?: string | null }} AgentCard
 *   `always`: the main agent has it in every session — Builder and Reviewer — so no list ticks it; `partOf`: the team
 *   whose own Lead it is (OA-D4) — its team's page holds it, and no list offers it
 */

/** The shipped team that builds (the plan's p6). */
export const BUILD_TEAM = "builders";
/** Whether a team is the shipped Builders team. @param {{ key?: string, shipped?: boolean } | null | undefined} t */
export const isBuildTeam = (t) => !!t?.shipped && t.key === BUILD_TEAM;
/**
 * How many agents and teams the Library holds, as the left bar counts them: each agent once and each team once — a
 * shipped team's own Lead is its team's (`partOf`), not one card more (UX6: 20 where 26 were), and a plugin's agents,
 * which the page lists too (the Designer's of 10-26: a count is the rows its page shows). Null where the agents were
 * not read; the agents alone where the teams were not.
 * @param {{ shipped?: any[], saved?: any[], plugins?: any[] } | null | undefined} agents @param {{ shipped?: any[], saved?: any[] } | null | undefined} teams
 * @returns {number | null}
 */
export function agentsCount(agents, teams) {
  if (!agents) return null;
  const n = (/** @type {unknown} */ x) => (Array.isArray(x) ? x.filter((c) => !c?.partOf).length : 0);
  return n(agents.shipped) + n(agents.saved) + n(agents.plugins) + (teams ? n(teams.shipped) + n(teams.saved) : 0);
}

/** Each shipped agent's glyph (lib/icons.js), by its tag (HarnessV4_Tasks U12-D4). @type {Readonly<Record<string, string>>} */
const CARD_ICONS = Object.freeze({
  builder: "hammer", reviewer: "eye",
  product: "goal", enduser: "user",
  buildlead: "wrench",
});
/**
 * A saved agent's glyph: a shipped one's own, a copy's its source's, else an agent's.
 * @param {{ tag?: string, from?: string | null } | null | undefined} c
 */
export const cardIcon = (c) => CARD_ICONS[String(c?.tag || "")] || CARD_ICONS[String(c?.from || "")] || "bot";
/** Each shipped agent's tile tone in the Library, a system colour's name (proposal_ux mock-library). @type {Readonly<Record<string, string>>} */
const CARD_TONES = Object.freeze({
  builder: "orange", reviewer: "indigo",
  product: "pink", enduser: "green",
  buildlead: "orange",
});
/**
 * A saved agent's tile tone: a shipped one's own, a copy's its source's, else an agent's blue.
 * @param {{ tag?: string, from?: string | null } | null | undefined} c
 */
export const cardTone = (c) => CARD_TONES[String(c?.tag || "")] || CARD_TONES[String(c?.from || "")] || "blue";
/**
 * The cards with the two the main agent always has marked so (`always`: their tags, as the server's list says).
 * @param {readonly AgentCard[]} cards @param {readonly string[] | null | undefined} always @returns {AgentCard[]}
 */
export const withAlways = (cards, always) => cards.map((c) => (c.shipped && (always || []).includes(c.tag) ? { ...c, always: true } : c));

/** A change a card is shown, as a choice's words. @type {Readonly<Record<string, string>>} */
export const CHANGE_WORDS = Object.freeze({ turn: "The last turn's change, as a patch", uncommitted: "The uncommitted change, as a patch" });

/** What a card may do, as the editor's three choices say it (AG-7). @type {Readonly<Record<string, string>>} */
export const MAY_WORDS = Object.freeze({
  read: "Read only: it changes nothing",
  copy: "Runs in its own copy, nothing kept",
  edit: "Edits in its own copy, you apply",
});
/** What a copy holds, under the editor's "May do": in a git worktree with none of its own, its main checkout's are the ones linked (f3's of 11-10). */
export const COPY_HOLDS = "A copy holds what git tracks. Of what git ignores, only node_modules and a virtualenv are there, linked to your own (in a git worktree with none, to its main checkout's): a command that writes into them changes those.";
/** What a card's commands are (AG-267), under "Runs without asking" in its editor. */
export const RUNS_HINT = "One command a line, as the agent types it: npm test, node --test test/money.test.js. Each runs without asking, as written or followed by more words, only where the agent works in its own copy. Never an install, a step that cannot be undone or a command that reaches your folder: those, and every other command, follow the session's mode and your rules.";
/** A worker with no words of its own (AG-84), where its paragraph would stand. */
export const NO_WORDS = "No words of its own: it works as the main agent would, on the one task it is given";

/**
 * An agent's tools, as its editor's "Its tools" lists them (HarnessV4_ShippedAgents_Plan SA2), by the ids the server
 * keeps (`CARD_TOOLS`): each on unless its card switches it off — a switch takes a tool away, never gives one. `read`:
 * its line where the agent only reads, for those its level narrows.
 * @type {Readonly<Record<string, { name: string, line: string, read?: string }>>}
 */
export const TOOL_WORDS = Object.freeze({
  shell: { name: "Shell", line: "Runs commands, and shells in the background", read: "Runs only the commands that read: its level changes nothing" },
  browser: { name: "The browser", line: "Opens pages, clicks and types on them", read: "Looks at pages: its level lets it look, not click or type" },
  web: { name: "Web", line: "Fetches a page, searches the web" },
  mcp: { name: "Your connectors", line: "The tools of the connectors you added, and your plugins'" },
  visuals: { name: "Visuals and artifacts", line: "Draws in the chat, makes pages you keep" },
  space: { name: "The Space", line: "The project's board and What happened, its logbook" },
});
/** The tools a card goes without, in a chip's words: "Web off", "Shell and Web off", "3 tools off". @param {readonly string[] | null | undefined} off */
export function toolsOffWords(off) {
  const names = (off || []).map((id) => TOOL_WORDS[id]?.name || id);
  return !names.length ? "" : names.length < 3 ? `${listed(names)} off` : `${names.length} tools off`;
}

/**
 * What a running or ended agent may do, as a fact after its name. One that edits says where: its own copy of the
 * project, or the session's folder. @param {{ may?: string, work?: unknown } | null | undefined} sa
 */
export const mayFact = (sa) =>
  sa?.may === "read" ? "read only" : sa?.may === "copy" ? "runs in its own copy, nothing kept" : sa?.work ? "edits in its own copy" : "edits in the session's folder";

/**
 * Where an agent's own copy is, for its header (the owner's words of 10-26: "What copy?"): the fact says it is a git
 * worktree, and its title the folder and why the Changes pane and the branch button do not list it. Null for an agent
 * with no copy open. @param {{ may?: string, work?: { folder?: string | null } | null } | null | undefined} sa
 * @returns {{ words: string, title: string } | null}
 */
export function copyFact(sa) {
  const folder = sa?.may === "edit" || sa?.may == null ? sa?.work?.folder : null;
  if (!folder) return null;
  return {
    words: "edits in its own copy, a git worktree",
    title: `Its copy: ${folder}\nA second checkout of the project with no branch of its own. The Changes pane and the branch button show this chat's folder, so they do not list it; what it changes reaches your folder when you apply it.`,
  };
}

/**
 * The model an agent runs on, its effort, and the provider that runs it (the owner's words of 10-26: "which provider
 * this agent is from"): "Opus at max on Anthropic". @param {string} model  as shown @param {string} effort  " at max", or ""
 * @param {string | null | undefined} provider
 */
export const modelFact = (model, effort, provider) => `${model}${effort}${provider ? ` on ${provider}` : ""}`;

/**
 * The change an agent was handed as a patch, as its launch named it (`running`, `turn`, `uncommitted`, `since:<ref>`),
 * in the words a card and a row say after the question; with `files`, how many files that was. "" for none.
 * @param {unknown} source @param {number | null} [files]
 */
export function handedWords(source, files = null) {
  const s = String(source || "");
  if (!s) return "";
  const what = s === "running" ? "with what this turn changed so far" : s === "turn" ? "with the last turn's change" : s === "uncommitted" ? "with the uncommitted change" : s.startsWith("since:") ? `with the changes since ${s.slice(6)}` : "";
  if (!what) return "";
  return typeof files === "number" ? `${what} · ${files} file${files === 1 ? "" : "s"}` : what;
}

/**
 * What the main agent attached to its message (`attach`), in words: "with 2 files and a picture"; "" for none. With
 * pictures alone, the words a card says of the person's ("with a picture", "with 3 pictures").
 * @param {{ files?: readonly string[], pictures?: readonly string[] } | null | undefined} attached
 */
export function attachedWords(attached) {
  const f = attached?.files?.length || 0;
  const p = attached?.pictures?.length || 0;
  const files = f === 0 ? "" : f === 1 ? "a file" : `${f} files`;
  const pictures = p === 0 ? "" : p === 1 ? "a picture" : `${p} pictures`;
  return files || pictures ? `with ${[files, pictures].filter(Boolean).join(" and ")}` : "";
}
/** Their names, for the words' tooltip. @param {{ files?: readonly string[], pictures?: readonly string[] } | null | undefined} attached */
export const attachedNames = (attached) => [...(attached?.files || []), ...(attached?.pictures || [])].join(", ");

/**
 * A range named in a draft: the one token `since:<ref>` at the start of what follows the tags (AG-81) —
 * `@security since:v1.2 what broke?`. Anything else is the question's own text.
 * @param {string} question @returns {{ changes: string | null, question: string }}
 */
export function leadingRange(question) {
  const m = /^(since:[A-Za-z0-9_@][A-Za-z0-9_.\/@^~{}-]*)(?:\s+|$)/.exec(String(question || ""));
  return m ? { changes: m[1], question: String(question).slice(m[0].length) } : { changes: null, question: String(question || "") };
}

/** How much of the session each view shows, as the start of a sentence. @type {Readonly<Record<string, string>>} */
const VIEW_SEES = Object.freeze({
  none: "Your question alone",
  folded: "This session folded",
  window: "The main agent's context window, the turn running now in it",
});

/** What a card is shown when it is asked, in a line. @param {{ view?: string, running?: boolean, changes?: string | null } | null | undefined} sees */
export function seesWords(sees) {
  const base = VIEW_SEES[String(sees?.view || "none")] || VIEW_SEES.none;
  const changes = String(sees?.changes || "");
  const change = changes === "running" ? "what this turn changed so far" : changes === "turn" ? "the last turn's change" : changes === "uncommitted" ? "the uncommitted change" : changes.startsWith("since:") ? `the changes since ${changes.slice(6)}` : "";
  // The context window holds the turn running now already.
  const more = [sees?.running && sees.view !== "window" ? "the turn running now" : "", change].filter(Boolean);
  return more.length ? `${base}, and ${more.join(" and ")}` : base;
}

/** The same, as a fact said after an agent's name: "sees this session folded, …". @param {{ view?: string, running?: boolean, changes?: string | null } | null | undefined} sees */
export const seesFact = (sees) => `sees ${seesWords(sees).replace(/^./, (c) => c.toLowerCase())}`;
/**
 * The words over a question in an agent's thread: a saved agent was asked — by you, or by the main agent itself
 * (HarnessV4_Tasks E15 step 3) — and any other agent was given a task. A start by itself (step 7) says so; why it
 * started is the line under these words (`exchangeView`), which are drawn in capitals.
 * @param {{ asked?: boolean, origin?: string } | null | undefined} sa  the thread's agent
 * @param {number} index  the exchange's place in the thread
 * @param {{ by?: string, why?: string } | null} [ex]  the exchange
 */
export const askedWords = (sa, index, ex = null) =>
  ex?.by === "self"
    ? ex.why ? "Started by itself on" : "By itself"
    : sa?.asked ? `${sa.origin === "agent" ? "The main agent asked" : "You asked"}${index && sa.origin !== "self" ? " again" : ""}` : index ? "Follow-up" : "Task";
/**
 * Where a saved agent's newest answer is, as a fact after its name: with the person, or sent on to the main agent.
 * @param {readonly { delivery?: string | null }[]} exchanges
 */
export const answerFact = (exchanges) => (exchanges.at(-1)?.delivery === "sent" ? "its answer went to the main agent" : "its answer stays with you");

/** A tag at the start of what is left of a draft: `@` and 2 to 24 letters, digits and dashes — never a path, which has a dot or a slash. */
const TAG_AT_START = /^@([A-Za-z][A-Za-z0-9-]{1,23})[,:]?(?=\s|$)/;

/**
 * The `@words` a draft starts with, one after another, as typed (each once), and what follows them. A word later in
 * the message is the message's own text, and so is a word of `stop` and all after it: a team's key, which is no
 * agent to ask (U13-D13).
 * @param {string} text @param {readonly string[]} [stop]  lowered @returns {{ words: string[], question: string }}
 */
export function leadingTags(text, stop = []) {
  let rest = String(text || "").replace(/^\s+/, "");
  /** @type {string[]} */
  const words = [];
  for (;;) {
    const m = TAG_AT_START.exec(rest);
    if (!m || stop.includes(m[1].toLowerCase())) break;
    if (!words.some((w) => w.toLowerCase() === m[1].toLowerCase())) words.push(m[1]);
    rest = rest.slice(m[0].length).replace(/^\s+/, "");
  }
  return { words, question: rest };
}

/**
 * The draft as the + menu's Ask an agent leaves it, and where the caret goes: an `@` at its start for the agent to
 * pick — or, where its leading tags already address saved agents, after the last of them, so the draft stays theirs
 * and the one picked joins them (the 9 plausible of 10-19: "@ " before "@pm …" made the draft the main agent's).
 * @param {string} value @param {boolean} tagged  whether its leading tags address saved agents
 * @returns {{ value: string, caret: number }}
 */
export function askDraft(value, tagged) {
  const v = String(value || "").replace(/^\s+/, "");
  // `question` is what follows the leading tags: the end of the draft as it was written.
  const rest = tagged ? leadingTags(v).question : v;
  const head = tagged ? v.slice(0, v.length - rest.length).replace(/\s*$/, " ") : "";
  return { value: `${head}@${rest ? ` ${rest}` : ""}`, caret: head.length + 1 };
}

/**
 * Whom a draft is for. `to`: the saved agents it starts by naming, where every leading `@word` names one — the
 * message is then theirs, and the main agent hears nothing. `unknown`: leading `@words` that name no agent, as typed;
 * with any, the message is not the agents'. `question`: the draft without its leading tags — and, where it is the
 * agents', without the range it names first (`since:v1.2`), which is `changes`: the change each is handed as a patch.
 * A team's key is no agent's tag here (U13-D13): the leading tags end before it, a card that holds the same word
 * set aside — `teamAddressed` finds a draft that opens with one.
 * @param {string} text @param {readonly AgentCard[]} cards @param {readonly { key: string }[]} [teams]
 * @returns {{ to: AgentCard[], unknown: string[], question: string, changes: string | null }}
 */
export function addressed(text, cards, teams = []) {
  const { words, question } = leadingTags(text, teams.map((t) => t.key));
  /** @type {AgentCard[]} */
  const to = [];
  /** @type {string[]} */
  const unknown = [];
  for (const w of words) {
    const card = cards.find((c) => c.tag === w.toLowerCase());
    if (card) to.push(card);
    else unknown.push(w);
  }
  if (unknown.length || !to.length) return { to: [], unknown, question, changes: null };
  const range = leadingRange(question);
  return { to, unknown, question: range.question, changes: range.changes };
}

/**
 * The team a draft opens with (U13-D13): its first `@word` a team's key — a card that holds the same word set aside.
 * The draft is then that team's: Enter opens its Brief with the rest as its ask, and the Brief's Send starts it.
 * Null for any other draft, and for a command.
 * @template {{ key: string }} T
 * @param {string} text @param {readonly T[]} teams @returns {{ team: T, ask: string } | null}
 */
export function teamAddressed(text, teams) {
  const draft = String(text || "").replace(/^\s+/, "");
  if (!draft.startsWith("@")) return null;
  for (const team of teams) {
    const key = String(team.key || "").toLowerCase();
    if (!key || draft.slice(1, 1 + key.length).toLowerCase() !== key) continue;
    // The key whole: a comma or a colon may follow it, then a space or the end.
    const rest = draft.slice(1 + key.length);
    const m = /^[,:]?(?=\s|$)/.exec(rest);
    if (m) return { team, ask: rest.slice(m[0].length).trim() };
  }
  return null;
}

/**
 * A tag past a draft's start: `@` after a space, an opening bracket or a quote — never in an address (`a@b.dev`) — and
 * never followed by what makes it a path (`@src/app.js`, `@notes.md`). A sentence's full stop after it is no path.
 */
const TAG_IN_TEXT = /(^|[\s([{"'“‘])@([A-Za-z0-9][A-Za-z0-9-]{1,23})(?![A-Za-z0-9_/\\-]|\.[A-Za-z0-9])/g;
/** Code in a draft — a fence, or a span in backticks — whose `@words` are code, not tags. */
const CODE_IN_TEXT = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

/**
 * The saved agents a draft to the main agent names with an `@` past its start (HarnessV4_OneAgent_Plan OA2, L27):
 * each once, in the draft's order. Nothing starts at Send: the message goes to the main agent with Filament's line
 * telling it to use them, and the line over the box says so ("For your agent to use"). None for a draft that is the
 * agents' own (`addressed`) or a command, and none in code. A team's key is the team's (U13-D13), a card of the same
 * tag set aside.
 * @param {string} text @param {readonly AgentCard[]} cards @param {readonly { key: string }[]} [teams]
 * @returns {AgentCard[]}
 */
export function usesIn(text, cards, teams = []) {
  /** @type {AgentCard[]} */
  const out = [];
  for (const typed of tagsPast(text, cards, teams)) {
    const word = typed.toLowerCase();
    const card = teams.some((t) => t.key === word) ? null : cards.find((c) => c.tag === word);
    if (card && !out.includes(card)) out.push(card);
  }
  return out;
}

/**
 * The teams a draft to the main agent names with an `@` past its start (HarnessV4_OneAgent_Plan OA2: "teams the
 * same"): each once, in the draft's order — none started at Send; the main agent is told to start them with its team
 * tool. A team's key is the team's, where a saved agent's tag holds the same word too (U13-D13). Where `usesIn` finds
 * none, as it finds none.
 * @template {{ key: string }} T
 * @param {string} text @param {readonly AgentCard[]} cards @param {readonly T[]} teams @returns {T[]}
 */
export function teamUsesIn(text, cards, teams) {
  /** @type {T[]} */
  const out = [];
  for (const typed of tagsPast(text, cards, teams)) {
    const team = teams.find((t) => t.key === typed.toLowerCase());
    if (team && !out.includes(team)) out.push(team);
  }
  return out;
}

/**
 * The `@words` past a draft's start that name no saved agent and no team (HarnessV4_OneAgent_Plan OA-D11, L4: "QA
 * doesn't exist yet"): each once, as typed, in the draft's order — the composer holds such a draft once, and Enter
 * again sends it as written. Where `usesIn` finds none, as it finds none.
 * @param {string} text @param {readonly AgentCard[]} cards @param {readonly { key: string }[]} [teams] @returns {string[]}
 */
export function unknownTagsPast(text, cards, teams = []) {
  /** @type {string[]} */
  const out = [];
  for (const typed of tagsPast(text, cards, teams)) {
    const word = typed.toLowerCase();
    if (!teams.some((t) => t.key === word) && !cards.some((c) => c.tag === word) && !out.some((w) => w.toLowerCase() === word)) out.push(typed);
  }
  return out;
}

/**
 * The `@words` a draft to the main agent holds past its start, as typed, in order — none in code, in a command, or in
 * a draft that is the agents' own (`addressed`) or a team's (`teamAddressed`).
 * @param {string} text @param {readonly AgentCard[]} cards @param {readonly { key: string }[]} [teams] @returns {string[]}
 */
function tagsPast(text, cards, teams = []) {
  const draft = String(text || "").trim();
  if (!draft || draft.startsWith("/") || teamAddressed(draft, teams) || addressed(draft, cards, teams).to.length) return [];
  // Code's `@words` are code, and a tagged chat's title is its name (labels.js `CHAT_LINK`): neither names an agent.
  const words = leadingTags(draft, teams.map((t) => t.key)).question.replace(CODE_IN_TEXT, " ").replace(CHAT_LINK, " ");
  return [...words.matchAll(TAG_IN_TEXT)].map((m) => m[2]);
}

/**
 * The cards a mistyped tag most likely meant, nearest first: by how much of the word a tag holds, letter after letter
 * in order, against the longer of the two; then your own before the shipped ones, then the list's order.
 * @param {string} word @param {readonly AgentCard[]} cards @param {number} [n]
 */
export function nearestCards(word, cards, n = 8) {
  const w = String(word || "").toLowerCase();
  /** The longest run of letters two words share in order. @param {string} a @param {string} b */
  const shared = (a, b) => {
    let row = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      const next = [0];
      for (let j = 1; j <= b.length; j++) next[j] = a[i - 1] === b[j - 1] ? row[j - 1] + 1 : Math.max(row[j], next[j - 1]);
      row = next;
    }
    return row[b.length];
  };
  return cards
    .map((c, i) => ({ c, i, near: w ? shared(w, c.tag) / Math.max(w.length, c.tag.length) : 0 }))
    .sort((a, b) => b.near - a.near || Number(a.c.shipped) - Number(b.c.shipped) || a.i - b.i)
    .slice(0, n)
    .map((x) => x.c);
}

/**
 * The two marks a chat holds of one question to a saved agent — sent off, and back — wherever they stand: before its
 * first turn (`asked`), before a turn or after one.
 * @param {{ asked?: any[], turns?: any[] } | null | undefined} chat @param {string} id @param {number} exchange
 * @returns {{ dispatch?: any, arrival?: any }}
 */
export const cardMarksOf = (chat, id, exchange) => cardMarksKept(chat)(id, exchange);

/**
 * Every question to a saved agent a chat holds, its two marks by agent and exchange (`cardMarksOf`): read once, for
 * every card drawn — each card that read its own alone looked through every turn of the chat, a few times a paint.
 * @param {{ asked?: any[], turns?: any[] } | null | undefined} chat
 * @returns {(id: string, exchange: number) => { dispatch?: any, arrival?: any }}
 */
export function cardMarksKept(chat) {
  /** @type {Map<string, { dispatch?: any, arrival?: any }>} */
  const pairs = new Map();
  const take = (/** @type {any[] | undefined} */ list) => {
    for (const b of list || []) {
      if (b?.type !== "subagent" || !b.asked || (b.event !== "dispatch" && b.event !== "arrival")) continue;
      const k = `${String(b.agentId)}\u0000${Number(b.exchange) || 0}`;
      const pair = pairs.get(k) || {};
      pair[/** @type {"dispatch" | "arrival"} */ (b.event)] = b;
      pairs.set(k, pair);
    }
  };
  take(chat?.asked);
  for (const t of chat?.turns || []) {
    take(t.boundaries);
    take(t.boundariesAfter);
  }
  return (id, exchange) => pairs.get(`${id}\u0000${exchange}`) || {};
}

/** Names joined as a sentence lists them: "Product", "Product and Builder", "Product, Builder and End user". @param {readonly string[]} names */
export function listed(names) {
  if (names.length < 3) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Whom a list of tags names (a session's `subagents.ask`, or the default): the cards that exist, each once, in the
 * list's order, and the tags whose card is gone — the agent's tool leaves those out.
 * @param {readonly string[] | null | undefined} tags @param {readonly AgentCard[]} cards
 * @returns {{ tags: string[], named: AgentCard[], gone: string[] }}  `tags`: the list as written, each once
 */
export function askNamed(tags, cards) {
  const list = [...new Set((Array.isArray(tags) ? tags : []).map((t) => String(t || "").trim().replace(/^@/, "").toLowerCase()).filter(Boolean))];
  /** @type {AgentCard[]} */
  const named = [];
  /** @type {string[]} */
  const gone = [];
  for (const t of list) {
    const card = cards.find((c) => c.tag === t);
    if (card) named.push(card);
    else gone.push(t);
  }
  return { tags: list, named, gone };
}

/**
 * Who uses a card, in a line (steps 4 and 6): the teams it leads, then the teams whose member it is, with which of
 * them add a line of their own for it, then the starts of `/subagent` that launch it. "" where nobody does.
 * @param {{ teams?: readonly { name: string, words: boolean, as?: string }[], starts?: readonly { id: string }[] } | null | undefined} used
 */
export function usedByWords(used) {
  const led = (used?.teams || []).filter((t) => t.as === "lead");
  const teams = (used?.teams || []).filter((t) => t.as !== "lead");
  const leads = led.length ? `leads the ${listed(led.map((t) => t.name))} team${led.length === 1 ? "" : "s"}` : "";
  const own = teams.filter((t) => t.words);
  const adds = !own.length
    ? ""
    : own.length < teams.length
      ? `: ${listed(own.map((t) => t.name))} ${own.length === 1 ? "adds its" : "add their"} own line`
      : teams.length === 1
        ? ": it adds its own line"
        : ": each adds its own line";
  return [leads, teams.length ? `${teams.map((t) => t.name).join(", ")}${adds}` : "", ...(used?.starts || []).map((s) => `/subagent start=${s.id}`)].filter(Boolean).join(" · ");
}

/** Whom may be asked, in a row's few words: "Nobody", up to three names, "Product, End user and 2 more". @param {readonly string[]} names */
export function mayAskWords(names) {
  if (!names.length) return "Nobody";
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/** A list with one tag ticked (it joins at the end) or unticked. @param {readonly string[]} tags @param {string} tag @param {boolean} on */
export const askAfter = (tags, tag, on) => (on ? [...tags.filter((t) => t !== tag), tag] : tags.filter((t) => t !== tag));

/**
 * Your saved agents, the shipped ones first, read once and again whenever one is made, changed or deleted — here or
 * in another window — and with them the tags ticked "The main agent may ask it": the default of every chat that has
 * not chosen its own list. `all` is what a list offers: never a team's own Lead (OA-D4), which `find` still finds.
 * @param {{ call?: (path: string) => Promise<any>, bus?: (fn: (msg: any) => void) => unknown }} [io]
 */
export function createAgentCardList({ call = api, bus = onBus } = {}) {
  /** @type {AgentCard[]} */
  let cards = [];
  /** @type {string[]} */
  let ask = [];
  let seq = 0;
  /** @type {Set<() => void>} */
  const listeners = new Set();
  async function load() {
    const mine = ++seq;
    try {
      const r = await call("/agents");
      if (mine !== seq) return;
      cards = withAlways([...(Array.isArray(r?.shipped) ? r.shipped : []), ...(Array.isArray(r?.saved) ? r.saved : [])], r?.always);
      ask = Array.isArray(r?.ask) ? r.ask.map(String) : [];
      for (const fn of listeners) fn();
    } catch {
      // Unreachable for now: the list stays as last read, and the next change or reload reads it again.
    }
  }
  bus((msg) => {
    if (msg?.type === "agents-changed") void load();
  });
  return {
    all: () => cards.filter((c) => !c.partOf),
    /** The tags ticked on their cards: whom a chat's main agent may ask where the chat chose no list of its own. */
    asks: () => ask,
    /** @param {string} tag */
    find: (tag) => cards.find((c) => c.tag === String(tag || "").replace(/^@/, "").toLowerCase()) || null,
    load,
    /** @param {() => void} fn */
    onChange(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** @typedef {ReturnType<typeof createAgentCardList>} AgentCardList */
