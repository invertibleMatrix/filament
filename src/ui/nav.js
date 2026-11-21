// @ts-check
// Page titles, hub tabs, hash aliases. One table so the sidebar, palette and hash router cannot drift.

export const PAGES = {
  guide: [
    "Start here",
    "How Filament works, what to set up, and in which order. Five minutes of reading saves an hour of guessing.",
  ],
  concepts: [
    "Concepts",
    "Model names, reasoning, speed, translation and tokens: what each means, how each provider spells it, and every way Filament lets you set it.",
  ],
  docs: [
    "Docs",
    "The complete guide to everything Filament offers, the reference of every parameter, and the template catalogue. Searchable.",
  ],
  overview: ["Home", "Status, credentials and live traffic. Health, agents and latest sit in the tabs above."],
  requests: [
    "Traffic",
    "Every call that passed through, with tokens, timing, cost and the changes made. Click a row for details.",
  ],
  usage: [
    "Usage",
    "Tokens, speed, cache hits and cost per model and per day. Kept on disk, so the history survives restarts and log rotation.",
  ],
  memory: [
    "Memory",
    "Long-term memory for every model and every client: the engine, the archive of your conversations, and what the autopilot puts into requests.",
  ],
  memories: [
    "Memory",
    "What memory holds: confirm, correct or retire any claim, answer memory's questions, search it, add to it, and run maintenance on the engine.",
  ],
  sessions: [
    "Memory",
    "Every archived conversation, searchable by what you typed. Open one to read it, or copy the command that loads it into any chat.",
  ],
  activity: [
    "Memory",
    "What memory put into recent requests: briefings, per-turn blocks and tool calls, as counts and ids, never content.",
  ],
  memsettings: [
    "Memory",
    "Engine and folder, autopilot budgets, capture, memory's model, commands, backups and privacy. Press Save changes when done.",
  ],
  projects: [
    "Memory",
    "Every project memory has seen: its sessions and turns, how many memories stand in it, and the dossier each new session there opens with.",
  ],
  memusage: [
    "Memory",
    "Memory's own model calls: the cheap model learning from sessions and the engine consolidating. Tokens, cost and speed per model, purpose and day, kept apart from your clients' traffic.",
  ],
  routes: ["Destinations", "Advanced routing: bare names, rewrites, failover and virtual models. A provider's own prefix is set on its card."],
  upstreams: ["Destinations", "The servers and coding agents requests are forwarded to."],
  models: [
    "Destinations",
    "Every model your routes can reach, one line per provider that serves it: price, speed, cache hits and use from your own traffic.",
  ],
  rules: ["Settings", "Global defaults for how requests are fixed, filled and trimmed before forwarding."],
  templates: ["Settings", "Ready-made bundles of settings. Preview shows exactly what would change before you apply."],
  prompts: [
    "Settings",
    "Every system prompt Filament itself writes — the agent loop per permission mode, each sub-agent type — plus your own overlay that replaces the loop's role and report lines.",
  ],
  assistant: [
    "Assistant",
    "Configure Filament by chatting. The assistant reads and edits a draft of your config through tools; nothing is saved until you press Apply.",
  ],
  playground: ["Lab", "Send real requests to every Filament endpoint and see the reply plus what Filament changed."],
  dryrun: ["Lab", "Paste a request and see the route decision and the exact body that would be sent, without sending it."],
  settings: ["Settings", "Server address, inbound API keys, the agent loop, logging detail and alerts."],
};

export const HOME_PANES = [
  ["status", "Status"],
  ["health", "Health"],
  ["agents", "Agents"],
  ["latest", "Latest"],
];

export const HOME_SUB = {
  status: "Credentials, live traffic and what to type into your agent.",
  health: "Quotas, upstream health and the last hour / week.",
  agents: "What each agent supports, its processes and the conversations mapped to it.",
  latest: "Spend by model and the ten most recent requests.",
};

export const MEM_TABS = [
  ["memory", "Overview"],
  ["memories", "Memories"],
  ["projects", "Projects"],
  ["sessions", "Sessions"],
  ["activity", "Activity"],
  ["memusage", "LLM usage"],
  ["memsettings", "Settings"],
];

export const DEST_TABS = [
  ["upstreams", "Upstreams"],
  ["routes", "Routes (advanced)"],
  ["models", "Models"],
];
export const LAB_TABS = [
  ["playground", "Playground"],
  ["dryrun", "Dry run"],
];
// The first tab is "General" (HarnessV3-Launch LD-D10): its page's own sub-tabs start with Server.
export const SETTINGS_TABS = [
  ["settings", "General"],
  ["rules", "Rules"],
  ["templates", "Templates"],
  ["prompts", "Prompts"],
];

export const HUBS = {
  overview: { nav: "overview", tabs: HOME_PANES, sameView: true },
  memory: { nav: "memory", tabs: MEM_TABS },
  memories: { nav: "memory", tabs: MEM_TABS },
  sessions: { nav: "memory", tabs: MEM_TABS },
  activity: { nav: "memory", tabs: MEM_TABS },
  memsettings: { nav: "memory", tabs: MEM_TABS },
  projects: { nav: "memory", tabs: MEM_TABS },
  memusage: { nav: "memory", tabs: MEM_TABS },
  routes: { nav: "destinations", tabs: DEST_TABS },
  upstreams: { nav: "destinations", tabs: DEST_TABS },
  models: { nav: "destinations", tabs: DEST_TABS },
  playground: { nav: "lab", tabs: LAB_TABS },
  dryrun: { nav: "lab", tabs: LAB_TABS },
  settings: { nav: "settings", tabs: SETTINGS_TABS },
  rules: { nav: "settings", tabs: SETTINGS_TABS },
  templates: { nav: "settings", tabs: SETTINGS_TABS },
  prompts: { nav: "settings", tabs: SETTINGS_TABS },
};

// A hub's own name opens its first page.
export const TAB_ALIAS = {
  home: "overview",
  traffic: "requests",
  destinations: "upstreams",
  lab: "playground",
};
export const CONFIG_TABS = new Set([
  "routes",
  "upstreams",
  "rules",
  "settings",
  "templates",
  "prompts",
  "memsettings",
]);
export const HELP_TABS = new Set(["docs", "guide", "concepts"]);

export const navId = (tab) => HUBS[tab]?.nav || (HELP_TABS.has(tab) ? "help" : tab);

/**
 * Traffic sub-tabs: id, label, hint. The hash, the strip and the palette all read this table. Requests comes first and is the default
 * (HarnessV3-Launch LD-D10): someone opening Traffic wants their requests; All mixes in the operations log.
 */
export const TRAFFIC_VIEWS = [
  [
    "requests",
    "Requests",
    "Every model call Filament forwarded or made itself: your tools, memory's own calls, the agent loop's ticks, compaction forks, replays, pings, the console's assistant.",
  ],
  [
    "all",
    "All",
    "Everything in one chronological stream: every model call AND every operation Filament performed — health cooldowns, config saves, background jobs, compactions, engine and learner activity. This is the tab to watch when something behaved oddly and you do not yet know which subsystem did it.",
  ],
  [
    "client",
    "Your tools",
    "Only the requests your own agents and SDKs sent. Excludes Filament's own calls AND its work on your behalf — the agent loop's ticks, sub-agents and replays have their own source; pick Requests for everything.",
  ],
  [
    "memory",
    "Memory",
    "Only Filament's own calls: learning a session, rewriting a recall query, one slice of a summary, a compaction summary written from the transcript (/autofit, Compact now), the memory engine. A summary a fork of the session wrote is a Compaction fork, under Requests.",
  ],
  [
    "agents",
    "Agents",
    "Coding agents (Claude Code, Cursor, Codex, Antigravity, Qoder) reached through Filament: the live processes, conversations and turns, plus HISTORY from the request records — tool calls per turn, how many went through Filament versus the agent's own, the leak rate, and lines touched.",
  ],
  [
    "system",
    "System",
    "Operations only — no model calls. The audit trail: who cooled down and why, what changed in the configuration and when, every background job including the ones that refused, engine lifecycle, and anything logged at warn or error.",
  ],
  [
    "live",
    "Live",
    "Everything in flight right now, from every source: pending and streaming requests with how long they have been going and how quiet the output has been, plus the background jobs still running. This is the tab to watch when something seems stuck.",
  ],
];
export const TRAFFIC_TABS = TRAFFIC_VIEWS.map(([id]) => id);

const MEMORY_HASH = {
  memories: "memories",
  sessions: "sessions",
  activity: "activity",
  settings: "memsettings",
  projects: "projects",
  usage: "memusage",
  memusage: "memusage",
};
const DEST_HASH = {
  "": "upstreams",
  routes: "routes",
  upstreams: "upstreams",
  models: "models",
};

/**
 * Parse a location.hash body (no leading #) into a navigation patch.
 * Empty or unknown hashes return null so the current page stays put.
 * @param {string} raw
 * @returns {{ tab: string, homePane?: string, section?: string|null, memSel?: string|null, reqFilter?: { tab: string } } | null}
 */
export function parseHash(raw) {
  if (!raw) return null;
  const [tab, section, extra] = String(raw).split(":");
  if (tab === "memory") {
    const next = MEMORY_HASH[section] || "memory";
    /** @type {{ tab: string, section: string|null, memSel?: string }} */
    const out = { tab: next, section: null };
    if (next === "sessions" && extra && /^[\w-]+$/.test(extra)) out.memSel = extra;
    else if (next === "memsettings" && extra) out.section = extra;
    return out;
  }
  if (tab === "destinations") {
    if (section === "new-virtual" || (section && /^edit-\d+$/.test(section))) return { tab: "routes", section };
    return { tab: DEST_HASH[section || ""] || "upstreams", section: null };
  }
  if (tab === "lab") {
    return { tab: section === "dryrun" || section === "dry-run" ? "dryrun" : "playground", section: null };
  }
  if (tab === "requests" || tab === "traffic") {
    if (section === "usage") return { tab: "usage", section: null };
    const reqTab = TRAFFIC_TABS.includes(section) ? section : "requests";
    return {
      tab: "requests",
      section: null,
      reqFilter: { tab: reqTab },
    };
  }
  if (tab === "settings" && section) {
    return { tab: section === "server" ? "settings" : PAGES[section] ? section : "settings", section: null };
  }
  if ((tab === "overview" || tab === "home") && section && HOME_PANES.some(([id]) => id === section)) {
    return { tab: "overview", homePane: section, section: null };
  }
  const resolved = TAB_ALIAS[tab] || tab;
  if (PAGES[resolved]) return { tab: resolved, section: section || null };
  if (PAGES[tab]) return { tab, section: section || null };
  return null;
}

/**
 * The bookmark for the current dashboard place. Inverse of parseHash for every hub tab.
 * @param {{ tab: string, homePane?: string, section?: string|null, memSel?: string|null, reqFilter?: { tab?: string } }} s
 */
export function formatHash(s) {
  const tab = s.tab;
  const section = s.section || null;
  if (tab === "overview" && s.homePane && s.homePane !== "status") return `#overview:${s.homePane}`;
  if (tab === "upstreams") return "#destinations";
  if (tab === "models") return "#destinations:models";
  if (tab === "routes") {
    if (section === "new-virtual" || (section && /^edit-\d+$/.test(section))) return `#destinations:${section}`;
    return "#destinations:routes";
  }
  if (tab === "dryrun") return "#lab:dryrun";
  if (tab === "playground") return "#lab";
  if (tab === "rules") return "#settings:rules";
  if (tab === "templates") return "#settings:templates";
  if (tab === "prompts") return "#settings:prompts";
  if (tab === "usage") return "#requests:usage";
  if (tab === "requests") {
    const sub = s.reqFilter?.tab;
    return sub && sub !== "requests" ? `#requests:${sub}` : "#requests";
  }
  if (tab === "memories") return "#memory:memories";
  if (tab === "sessions")
    return `#memory:sessions${s.memSel && /^[\w-]+$/.test(s.memSel) ? ":" + s.memSel : ""}`;
  if (tab === "activity") return "#memory:activity";
  if (tab === "memsettings") return `#memory:settings${section ? ":" + section : ""}`;
  if (tab === "projects") return "#memory:projects";
  if (tab === "memusage") return "#memory:usage";
  if (tab === "memory") return "#memory";
  return `#${tab}${section ? ":" + section : ""}`;
}

/**
 * Jump-list entries derived from the same tables the hubs and Traffic strip use.
 * Action commands (copy URL, theme) stay in the shell — they need live state.
 */
export function palettePages() {
  /** @type {{ id: string, label: string, hint: string, tab: string, pane?: string, filter?: string, section?: string }[]} */
  const cmds = [];
  /**
   * @param {string} id
   * @param {string} label
   * @param {string} hint
   * @param {{ tab: string, pane?: string, filter?: string, section?: string }} extra
   */
  const add = (id, label, hint, extra) => cmds.push({ id, label, hint: hint || "", ...extra });
  add("overview", PAGES.overview[0], HOME_SUB.status, { tab: "overview" });
  for (const [id, label] of HOME_PANES) {
    if (id === "status") continue;
    add(`overview:${id}`, `${PAGES.overview[0]} → ${label}`, HOME_SUB[id], { tab: "overview", pane: id });
  }
  add("requests", PAGES.requests[0], PAGES.requests[1], { tab: "requests" });
  for (const [id, label, hint] of TRAFFIC_VIEWS) {
    add(`requests:${id}`, `${PAGES.requests[0]} → ${label}`, hint, { tab: "requests", filter: id });
  }
  add("usage", PAGES.usage[0], PAGES.usage[1], { tab: "usage" });
  for (const [id, label] of MEM_TABS) {
    const page = PAGES[id];
    const hashId =
      id === "memory" ? "memory" : `memory:${id === "memsettings" ? "settings" : id === "memusage" ? "usage" : id}`;
    add(hashId, id === "memory" ? page[0] : `${page[0]} → ${label}`, page[1], { tab: id });
  }
  for (const [id, label] of DEST_TABS) {
    add(id, label, PAGES[id][1], { tab: id });
  }
  add("routes:new-virtual", "New virtual model", "Routes · one name that tries several providers in order", {
    tab: "routes",
    section: "new-virtual",
  });
  for (const [id] of LAB_TABS) add(id, PAGES[id][0], PAGES[id][1], { tab: id });
  for (const [id, label] of SETTINGS_TABS) {
    add(id, id === "settings" ? "General settings" : label, PAGES[id][1], { tab: id });
  }
  add("assistant", PAGES.assistant[0], PAGES.assistant[1], { tab: "assistant" });
  add("docs", PAGES.docs[0], PAGES.docs[1], { tab: "docs" });
  add("concepts", PAGES.concepts[0], PAGES.concepts[1], { tab: "concepts" });
  add("guide", PAGES.guide[0], PAGES.guide[1], { tab: "guide" });
  return cmds;
}
