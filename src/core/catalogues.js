// @ts-check
// What Filament knows about its destinations before asking them, as data. The coding agents it can drive (over ACP, or
// Codex over its app-server): how each is started, its modes and their aliases, how to log in and install it, the guide
// text the dashboard shows, and the upstream and route a fresh install seeds for it. Settings → Coding agents offers
// them, and Cursor through its SDK, before ACP's registry. And the Qoder cloud's model list, the picker's fallback when
// the account's live list is not available.

/**
 * How a known agent is installed (HarnessV3-ACP AC3-8), its maker's way, for the whole computer: an npm package, or a
 * script for each system; or ACP's registry's way, its program downloaded into Filament's own folder (`registry`: its id
 * there, the agent's own, `viaRegistry`).
 * @typedef {{ npm: string } | { script: { win32: string, posix: string } } | { registry: string }} InstallWay
 */
/**
 * @typedef {object} KnownAgent
 * @property {string} id
 * @property {string} name
 * @property {"acp" | "codex"} [type]  the upstream type it runs as; ACP when not said
 * @property {string} prefix
 * @property {string} command
 * @property {string[]} args
 * @property {string} mode
 * @property {string} [login]  its CLI's sign-in, as a line to run in a terminal; none where it signs in on its card
 *   alone (Antigravity)
 * @property {Record<string, string[]>} [modeAliases]  an ACP agent's mode ids for agent, plan and ask
 * @property {InstallWay} install
 * @property {string} about  what it is, in a line, as Settings → Coding agents offers it (HarnessV3-ACP AC3-8)
 * @property {string} [registry]  its id in ACP's registry: the registry's entry for it is this one, and its mark
 *   comes from there (HarnessV3-ACP AC3-8)
 * @property {string} [mark]  the registry entry its mark comes from, where it isn't its own
 * @property {string} docs
 * @property {string} notes
 * @property {string} account
 * @property {{ context: string, effort: string, resume: string, tokens: string }} guide
 * @property {string[]} [listModelsArgs]
 * @property {Record<string, string>} [env]
 * @property {"arg" | "session"} [modelSelection]
 * @property {boolean} [nativeTools]
 * @property {{ cmd: string, args?: string[], parse: "claude" | "codex" | "cursor" | "qoder" }} [status]  how its sign-in
 *   is read without a turn: its CLI's status command and the way it says it (core/agent-limits.js `statusReading`)
 * @property {string} [home]  the variable its CLI reads its folder from — its login, its settings, its sessions: an
 *   account of its own is a folder of its own (HarnessV3-ACP AC3-7)
 * @property {string[]} [signIn]  the command that signs it in, run in a terminal where the agent names no way of its
 *   own (HarnessV3-ACP AC3-7)
 * @property {boolean} [cancelKeepsWork]  a turn it cancels keeps what it did, as a drive saw (HarnessV3-ACP, AC3's
 *   drive C6): what is typed while it works can go in at its next step, as the prompt that carries the turn on (AC-D6)
 * @property {string} [thinkingDisplayFrom]  a version of its adapter whose Claude Code was seen taking how it shows its
 *   thinking (`--thinking-display`, HarnessV3-ACP AC-R2): that version and later ones are asked to show it, as recent
 *   models leave it out unless asked; an earlier one's Claude Code may not know the option, and would refuse the
 *   session
 * @property {boolean} [cachedInInput]  the input tokens it reports for a prompt are the whole prompt, what it read
 *   from its cache among them, as its records showed (the owner's chat of 11-11: a second prompt twenty seconds after
 *   a first of 17,096 said 17,273 input and 15,217 cached): its input beside the cache is what is left of them
 * @property {boolean} [onByDefault]  one of the agents a fresh install turns on where its program is found (`seededOn`):
 *   Claude Code, Codex and Cursor's CLI. The others are added off, Settings → Coding agents' Connect away
 * @property {string[]} [programs]  the other names its program goes by on another system (`agentKey`): Antigravity's
 *   `antigravity` off Windows
 * @property {string[]} [formerPrograms]  the names of the program it ran until an update (`agentKey`), which took
 *   its account's folder from `home` alone and none of `homeArg`, `folderEnv` and `folderSignIn`: Antigravity's
 *   `agy_acp_server`, until its card's Update
 * @property {string} [homeArg]  the option its program takes its account's folder from, where it reads no variable
 *   (`agentArgs`): Antigravity's `--gemini-dir`
 * @property {Record<string, string>} [folderEnv]  what an account with a folder of its own also starts with
 *   (`agentLaunchEnv`): Antigravity keeps such an account's sign-in in its folder only as it does over SSH
 * @property {string[]} [folderSignIn]  the command that signs an account with a folder of its own in, in a terminal,
 *   where the agent's own ways can't (`catalogueSignIn`): Antigravity's page can't hand such an account its sign-in, so
 *   `agy acp --login` shows Google's page's address and takes the code it gives
 * @property {{ version: string, why: string }} [minVersion]  the version below which Filament's install of it is told
 *   to update, and why (app/coding-agents.js `outdated`)
 */

// Shipped as upstreams on a fresh install (the agents on by default enabled when their CLI is present), re-detectable
// later.
/** @type {KnownAgent[]} */
export const KNOWN_AGENTS = [
  {
    id: "cursor",
    name: "Cursor (agent via ACP)",
    prefix: "cursor",
    command: "agent",
    args: ["acp"],
    // Cursor is this way, its CLI (the owner's of 11-10: one Cursor, the way that fits Filament best): its own permission
    // requests come to the chat's switch, Filament's tools reach it over MCP, and it signs in with the person's Cursor
    // login rather than an API key. Its SDK is a second way behind Settings › Experimental (`CURSOR_SDK`).
    onByDefault: true,
    listModelsArgs: ["--list-models"],
    mode: "agent",
    modeAliases: { agent: ["agent"], plan: ["plan"], ask: ["ask"] },
    install: { script: { win32: "irm 'https://cursor.com/install?win32=true' | iex", posix: "curl https://cursor.com/install -fsS | bash" } },
    about: "Cursor's coding agent, on your Cursor plan.",
    registry: "cursor",
    docs: "https://cursor.com/docs/cli/acp",
    notes:
      "Effort and speed are part of Cursor's model ids (…-xhigh, …-fast). Modes: agent, plan, ask. Signs in with `agent login`, or as whoever is signed in to the Cursor editor.",
    login: "agent login",
    signIn: ["agent", "login"],
    status: { cmd: "agent", args: ["status", "--format", "json"], parse: "cursor" },
    cancelKeepsWork: true,
    account: "Your Cursor subscription (Cursor login)",
    guide: {
      context:
        "Fixed per model. Cursor picks the window of the model you name; there is no separate context setting. Ask Cursor's own /context (in its terminal) for details.",
      effort:
        "Part of the model id: pick …-low, …-high or …-xhigh (and …-fast for speed). Filament's -xhigh suffix and the client's effort picker are folded into the id when effortTemplate is set on this upstream.",
      resume:
        "Cursor lists its chats, so the #id model suffix continues one; Filament otherwise keeps one Cursor session per client chat.",
      tokens:
        "Cursor reports no usage: counts are the local class-weighted estimate and cost shows as “agent”.",
    },
  },
  {
    id: "qoder",
    name: "Qoder (agent via ACP)",
    prefix: "qoder",
    command: "qodercli",
    args: ["--acp"],
    mode: "yolo",
    modelSelection: "session",
    modeAliases: {
      agent: ["yolo", "auto", "acceptEdits"],
      plan: ["dontAsk", "default"],
      ask: ["dontAsk", "default"],
    },
    install: { npm: "@qoder-ai/qodercli" },
    about: "Qoder's coding agent, on your Qoder credits.",
    registry: "qoder",
    docs: "https://docs.qoder.com/cli/acp",
    notes:
      "Uses your Qoder login (`qodercli login`) and credits. Models: efficient, lite, qwen3.8-max… (see the agent's list). Modes: default, acceptEdits, auto, dontAsk, yolo.",
    login: "qodercli login",
    signIn: ["qodercli", "login"],
    status: { cmd: "qodercli", args: ["status", "-o", "json"], parse: "qoder" },
    account: "Your Qoder account and credits",
    guide: {
      context: "Fixed per model (efficient, lite, qmodel_38max…). No separate setting.",
      effort: "Qoder's models have no effort levels; pick the model instead.",
      resume: "Qoder keeps one session per client chat; it does not list past sessions to clients.",
      tokens: "Qoder reports no usage: counts are the local estimate.",
    },
  },
  {
    id: "qoder-cn",
    name: "Qoder CN (agent via ACP)",
    prefix: "qoder-cn",
    command: "qodercli",
    args: ["--acp"],
    env: { QODERCLI_SITE: "cn" },
    mode: "yolo",
    modelSelection: "session",
    login: "log in inside the Qoder CN desktop app (qoder.cn), or run: QODERCLI_SITE=cn qodercli login",
    signIn: ["qodercli", "login"],
    status: { cmd: "qodercli", args: ["status", "-o", "json"], parse: "qoder" },
    modeAliases: {
      agent: ["yolo", "auto", "acceptEdits"],
      plan: ["dontAsk", "default"],
      ask: ["dontAsk", "default"],
    },
    install: { npm: "@qoder-ai/qodercli" },
    about: "Qoder's coding agent on qoder.cn, with your China account: the same CLI, run with QODERCLI_SITE=cn.",
    mark: "qoder",
    docs: "https://docs.qoder.cn/cli",
    notes:
      "Your qoder.cn (China) account and credits. Same CLI as the qoder upstream, started with QODERCLI_SITE=cn so it uses the .qoder-cn login, models and endpoints. Log in once via the Qoder CN desktop app or QODERCLI_SITE=cn qodercli login.",
    account: "Your qoder.cn (China) account and credits",
    guide: {
      context: "Fixed per model (efficient, lite, qmodel_38max…). No separate setting.",
      effort: "Qoder's models have no effort levels; pick the model instead.",
      resume: "One session per client chat; no session listing.",
      tokens: "Qoder reports no usage: counts are the local estimate.",
    },
  },
  {
    // Google's coding agent (the owner's of 11-10: Google retired Gemini CLI for Antigravity on 06-18, so Google's models
    // run on Antigravity here, `RETIRED_AGENTS`): Google's agy CLI as an ACP server (`agy acp`, the owner's of 11-22), a
    // program Filament downloads into its own folder from Google's release feed (agy-feed.js), laid over the registry's
    // entry (`install.registry`, its id the registry's: app/coding-agents.js installs, updates and removes it as the
    // registry's). It names its sign-in ways itself (Google, Gemini Enterprise, a Gemini API key, Agent Platform). An
    // account's folder is its `--gemini-dir`: it reads no GEMINI_HOME, which accounts keep as the folder's name.
    id: "antigravity-acp",
    name: "Antigravity (agent via ACP)",
    prefix: "antigravity",
    command: "agy",
    args: ["acp", "--app-data-dir", "antigravity-acp"],
    programs: ["antigravity"],
    formerPrograms: ["agy_acp_server"],
    mode: "agent",
    modelSelection: "session",
    install: { registry: "antigravity-acp" },
    about: "Google's coding agent, with your Google account.",
    registry: "antigravity-acp",
    docs: "https://antigravity.google/docs/ide/extensions",
    notes:
      "Google's Antigravity CLI as an ACP server (agy acp), downloaded from Google's release feed into Filament's own folder (Install on its card; Update when Google ships a newer one). Signs in with Google, Gemini Enterprise, a Gemini API key or Gemini Enterprise Agent Platform: its card offers its own ways; an account added beside the first signs in with Google in a terminal (agy acp --login), its sign-in kept in its own folder. Its models are the ones your plan lists once signed in, each at a thinking level. On Windows it runs its commands in Windows PowerShell. It has sub-agent tools of its own, which no setting of its turns off. Its harness keeps a program in ~/.gemini/antigravity/bin, whatever its folder.",
    home: "GEMINI_HOME",
    homeArg: "--gemini-dir",
    // agy 1.5 keeps every folder's Google sign-in in one entry of the system's keyring, unless it takes itself to run
    // over SSH: then in the folder, where an added account's must be to be its own.
    folderEnv: { SSH_CONNECTION: "127.0.0.1 0 127.0.0.1 0" },
    folderSignIn: ["agy", "acp", "--app-data-dir", "antigravity-acp", "--login"],
    minVersion: { version: "1.5.1", why: "before 1.5.1 it shows Filament only some of your plan's models, and none Google released since" },
    cachedInInput: true,
    account: "Your Google account (or a Gemini API key)",
    guide: {
      context: "Fixed per model, as Antigravity says it.",
      effort: "As its models offer it.",
      resume: "Antigravity lists its sessions, so the #id model suffix continues one; Filament otherwise keeps one session per client chat.",
      tokens: "As Antigravity reports them, else the local estimate.",
    },
  },
  {
    id: "claude-code",
    name: "Claude Code (agent via ACP)",
    prefix: "claude-code",
    command: "claude-agent-acp",
    args: [],
    onByDefault: true,
    mode: "agent",
    modelSelection: "session",
    nativeTools: true,
    thinkingDisplayFrom: "0.76.0",
    modeAliases: { agent: ["bypassPermissions", "acceptEdits", "default"], plan: ["plan"], ask: ["default"] },
    install: { npm: "@agentclientprotocol/claude-agent-acp" },
    about: "Anthropic's coding agent, on your Claude Pro or Max plan.",
    registry: "claude-acp",
    docs: "https://github.com/agentclientprotocol/claude-agent-acp",
    notes:
      "Official ACP adapter over the Claude Agent SDK. Claude models only. This is the sanctioned way to use a Claude Pro/Max subscription outside claude.ai: log in once with `claude auth login`. ANTHROPIC_API_KEY works too, billed by the API.",
    login: "claude auth login",
    signIn: ["claude", "auth", "login"],
    home: "CLAUDE_CONFIG_DIR",
    status: { cmd: "claude", args: ["auth", "status"], parse: "claude" },
    account: "Your Claude Pro/Max subscription (Claude Code login) or an ANTHROPIC_API_KEY",
    guide: {
      context:
        "Choose it with the model id: plain ids (sonnet, haiku) use the standard window; ids ending in [1m] (opus[1m], claude-fable-5-2[1m]) use the 1-million-token window — a plain id runs in the standard window whatever window is set for it in Filament. Claude Code reports how full the window is on every request and compacts itself automatically when it gets full.",
      effort:
        "A session setting with the levels listed below. Set it with the model suffix (-low … -max) or the client's effort picker; Filament applies it per turn.",
      resume:
        "Claude Code lists every chat started in its terminal: start a new client chat with model <prefix>sonnet#<id> to continue one. A chat still open in a terminal must be closed first.",
      tokens: "Exact: input, cache read/write, output, cost and context fill come from Claude Code itself.",
    },
  },
  {
    id: "codex",
    name: "Codex",
    type: "codex",
    prefix: "codex",
    command: "codex",
    args: ["app-server"],
    onByDefault: true,
    mode: "agent",
    install: { npm: "@openai/codex" },
    about: "OpenAI's coding agent, on your ChatGPT plan.",
    // The registry's Codex is an ACP adapter for it; Filament drives Codex's own app-server, which says more.
    registry: "codex-acp",
    docs: "https://github.com/openai/codex",
    notes:
      "OpenAI's coding agent, driven over its own app-server (`codex app-server`), the interface Codex's editor extension uses. Signs in with your ChatGPT plan (`codex login`) or an OpenAI API key. Its models and their reasoning efforts, its account and its plan's usage windows come from Codex itself. Modes: agent, plan.",
    login: "codex login",
    signIn: ["codex", "login"],
    home: "CODEX_HOME",
    status: { cmd: "codex", args: ["login", "status"], parse: "codex" },
    account: "Your ChatGPT Plus/Pro/Team plan (codex login) or an OpenAI API key",
    guide: {
      context:
        "Fixed per model. Codex reports how full the window is after every turn and compacts its thread itself when it fills.",
      effort:
        "Per turn, from the levels each model lists (low … xhigh): pick the …-low … -xhigh model id, or set it with the client's effort picker.",
      resume:
        "Codex keeps its threads on disk, and the #id model suffix continues one. Filament otherwise keeps one Codex thread per chat, and picks it up again after a restart.",
      tokens: "Exact: input, cached input and output tokens come from Codex itself.",
    },
  },
];

/**
 * Cursor through its official SDK, inside Filament's process (HarnessV3-ACP AC3-8): an entry of Settings → Coding agents
 * beside Cursor's CLI, and the way Cursor keeps more than one account — each is a key Cursor makes. Not a known agent:
 * nothing detects it or seeds it on a fresh install. Experimental since the owner's of 11-10 (`cursorSdkOn`): its agent
 * approves its own tools, which Filament can only swap for its own, where the CLI asks the chat's switch.
 */
export const CURSOR_SDK = {
  id: "cursor-sdk",
  name: "Cursor (official SDK)",
  type: /** @type {const} */ ("cursor-sdk"),
  prefix: "cursor-sdk",
  about: "Cursor's agent inside Filament, through Cursor's SDK. Each account is a key Cursor makes, so it keeps more than one.",
  /** @type {InstallWay} */
  install: { npm: "@cursor/sdk" },
  mark: "cursor",
  docs: "https://www.npmjs.com/package/@cursor/sdk",
};
/**
 * The coding agents Settings → Coding agents offers before ACP's registry's, in its order (HarnessV3-ACP AC3-8), Cursor's
 * SDK among them; `agentCatalogue` is what a config offers of it.
 * @type {readonly (KnownAgent | typeof CURSOR_SDK)[]}
 */
export const AGENT_CATALOGUE = ["claude-code", "codex", "cursor", "cursor-sdk", "antigravity-acp", "qoder", "qoder-cn"].map(
  (id) => /** @type {KnownAgent | typeof CURSOR_SDK} */ (id === CURSOR_SDK.id ? CURSOR_SDK : KNOWN_AGENTS.find((a) => a.id === id)),
);
/**
 * Whether Cursor's SDK is a way of Cursor's here: Settings › Experimental's switch for it (`experimental.cursorSdk`, the
 * owner's of 11-10), off by default — Cursor is its CLI.
 * @param {any} cfg
 */
export const cursorSdkOn = (cfg) => cfg?.experimental?.cursorSdk === true;
/**
 * Whether an upstream is held off by that switch: one on Cursor's SDK while it is off. Nothing reaches Cursor through it
 * then — no turn, no models asked, no sign-in read, no test.
 * @param {any} cfg @param {any} u
 */
export const cursorSdkHeld = (cfg, u) => u?.type === "cursor-sdk" && !cursorSdkOn(cfg);
/** Where that switch is, as a sentence names it. */
export const CURSOR_SDK_SWITCH = "Settings › Experimental (Cursor through its SDK)";
/**
 * What Filament says of an upstream on Cursor's SDK while its switch is off: what stands in, and where it goes on. True
 * at every place — a sign-in, a check, a test, an install; where a model was picked, `routing.js offWhy` adds the other
 * way out.
 */
export const CURSOR_SDK_OFF = `Cursor through its SDK is off: Cursor is its CLI here. Turn it on in ${CURSOR_SDK_SWITCH}`;
/**
 * The catalogue a config offers (`AGENT_CATALOGUE`): Cursor's SDK only where its switch is on (`cursorSdkOn`).
 * @param {any} cfg @returns {readonly (KnownAgent | typeof CURSOR_SDK)[]}
 */
export const agentCatalogue = (cfg) => (cursorSdkOn(cfg) ? AGENT_CATALOGUE : AGENT_CATALOGUE.filter((a) => a.id !== CURSOR_SDK.id));
/**
 * The command that installs an agent of the catalogue on `platform`, its maker's way (HarnessV3-ACP AC3-8): the program
 * with its arguments, and the line a person would type. Null where none is known, and for one ACP's registry installs
 * (`viaRegistry`: Settings → Coding agents downloads its program). An npm package installs at `version` where one is
 * given — an update's, the registry's (AF3) — else at its latest.
 * @param {{ install?: InstallWay } | null | undefined} a @param {string} platform  `process.platform`
 * @param {string | null} [version]
 * @returns {{ argv: string[], line: string } | null}
 */
export function installCommand(a, platform, version = null) {
  const w = a?.install;
  if (!w || "registry" in w) return null;
  if ("npm" in w) {
    const argv = ["npm", "install", "-g", version ? `${w.npm}@${version}` : w.npm];
    return { argv, line: commandLine(argv, {}, platform) };
  }
  const win = platform === "win32";
  const script = win ? w.script.win32 : w.script.posix;
  return { argv: win ? ["powershell.exe", "-NoProfile", "-Command", script] : ["sh", "-c", script], line: script };
}
/**
 * Whether a known agent installs ACP's registry's way (`InstallWay`'s `registry`): its program downloaded into Filament's
 * own folder, so detection never finds it on the PATH and no template starts it by its name — Settings → Coding agents
 * installs and connects it.
 * @param {{ install?: InstallWay } | null | undefined} a
 */
export const viaRegistry = (a) => !!a?.install && "registry" in a.install;
/**
 * The agents Filament drives no more, by their id in ACP's registry, with why (the owner's of 11-10): Settings → Coding
 * agents lists none of them, and an upstream of one still in the settings says so on its card, on or off, with what
 * becomes of it (the Fable 5.2 re-read's finding 7: only the list to add said it, in words that were not so of every
 * connection) — the page's words, by whether it leaves the settings once off (app/coding-agents.js `retired`, from
 * services/config/store.js `retiredHolds`).
 * @type {Readonly<Record<string, string>>}
 */
export const RETIRED_AGENTS = Object.freeze({
  gemini: "Gemini CLI: Google retired it for Antigravity (June 2026), so Filament runs Google's models on Antigravity.",
});
/**
 * Each retired agent as the catalogue knew it, so what an install seeded for it (`agentUpstream`, `agentRoute`) can be
 * told from what a person set on it since (services/config/store.js `retiredHolds`).
 * @type {Readonly<Record<string, Pick<KnownAgent, "id" | "name" | "prefix" | "command" | "args" | "mode" | "modeAliases">>>}
 */
export const RETIRED_SEEDS = Object.freeze({
  gemini: { id: "gemini", name: "Gemini CLI (agent via ACP)", prefix: "gemini", command: "gemini", args: ["--acp"], mode: "yolo", modeAliases: { agent: ["yolo", "autoEdit"], plan: ["plan"], ask: ["plan", "default"] } },
});
/**
 * The upstream an entry of the catalogue connects as (HarnessV3-ACP AC3-8): a known agent's as detection makes it;
 * Cursor's SDK route with no key yet, its account signed in next.
 * @param {KnownAgent | typeof CURSOR_SDK} a @param {{ enabled?: boolean }} [opts]
 */
export function catalogueUpstream(a, { enabled } = {}) {
  if (a.type !== "cursor-sdk") return agentUpstream(/** @type {KnownAgent} */ (a), { enabled });
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    enabled: enabled ?? true,
    apiKey: "",
    acp: { permissions: "allow-all", clientBridge: "prompts", thoughts: "auto", toolActivity: "text", cwdSource: "client", mode: "agent" },
  };
}
/**
 * The entry of Settings → Coding agents an agent upstream is a card of (HarnessV3-ACP AC3-8): Cursor's SDK route
 * apart from Cursor's CLI; a known agent's own upstream (its id, run the agent's way); one connected from ACP's
 * registry (its id is the registry's); else, as an account added beside one is, the agent its command runs.
 * @param {{ id?: string, type?: string, acp?: { command?: string } } | null | undefined} u
 * @param {ReadonlySet<string>} registryIds
 * @returns {string}
 */
export function entryOf(u, registryIds) {
  if (u?.type === "cursor-sdk") return CURSOR_SDK.id;
  const id = String(u?.id || "");
  const known = KNOWN_AGENTS.find((a) => a.id === id);
  if ((known && (known.type || "acp") === u?.type) || registryIds.has(id)) return id;
  return agentKey(u);
}

/**
 * Whether a fresh install, and detection after it, turns a known agent on: its program is here and it is one of the
 * agents on by default (`onByDefault`). Every other one is added off, with its route on, so a name of it says the
 * agent is off rather than matching nothing.
 * @param {{ installed?: boolean, onByDefault?: boolean }} a
 */
export const seededOn = (a) => !!a.installed && a.onByDefault === true;

// The upstream and the route a fresh install seeds for a known agent (`installed` is what detection found); Settings →
// Coding agents makes a registry agent's the same way (HarnessV3-ACP AC3-8).
/**
 * @param {Pick<KnownAgent, "id" | "name" | "command" | "args" | "mode"> &
 *   Partial<Pick<KnownAgent, "type" | "env" | "listModelsArgs" | "modelSelection" | "modeAliases">> &
 *   { installed?: boolean }} a
 * @param {{ enabled?: boolean }} [opts]
 */
export function agentUpstream(a, { enabled } = {}) {
  const type = a.type || "acp";
  return {
    id: a.id,
    name: a.name,
    type,
    baseUrl: "",
    apiKey: "",
    authStyle: "auto",
    enabled: enabled ?? a.installed ?? false,
    discoverModels: true,
    models: [],
    rules: {},
    acp: {
      command: a.command,
      args: a.args,
      env: a.env || {},
      ...(type === "acp"
        ? {
            listModelsArgs: a.listModelsArgs || [],
            authenticate: false,
            modelSelection: a.modelSelection || "arg",
            mode: a.mode,
            modeAliases: a.modeAliases,
          }
        : { mode: a.mode }),
      permissions: "allow-all",
      thoughts: "auto",
      toolActivity: "text",
      cwdSource: "client",
    },
  };
}
/**
 * @param {{ id: string, prefix: string, installed?: boolean }} a
 * @param {{ enabled?: boolean }} [opts]
 */
export function agentRoute(a, { enabled } = {}) {
  return {
    match: `${a.prefix}/*`,
    upstream: a.id,
    upstreamModel: "{1}",
    format: "auto",
    fallbacks: [],
    discoverPrefixes: [],
    enabled: enabled ?? a.installed ?? false,
    rules: {},
  };
}
/**
 * Which coding agent an upstream runs, whichever way it reaches it (HarnessV3-ACP AC3-6): Cursor through its SDK or its
 * CLI is Cursor, Qoder's two sites are Qoder, an ACP agent Filament doesn't know is its command. Two upstreams of one
 * agent are two of its logins: a turn one's plan stopped can go on in the other.
 * @param {{ type?: string, acp?: { command?: string } } | null | undefined} u
 * @returns {string}
 */
export function agentKey(u) {
  if (u?.type === "codex") return "codex";
  if (u?.type === "cursor-sdk") return "cursor";
  const cmd = programName(u);
  if (cmd === "cursor-agent") return "cursor";
  return (
    KNOWN_AGENTS.find((a) => (a.type || "acp") === "acp" && [a.command, ...(a.programs || []), ...(a.formerPrograms || [])].some((n) => n.toLowerCase() === cmd))?.id ||
    cmd ||
    "agent"
  );
}
/**
 * An upstream's program by its name alone: its command's file, without its folder or its extension, in lower case.
 * @param {{ acp?: { command?: string } } | null | undefined} u
 */
function programName(u) {
  return (
    String(u?.acp?.command || "agent")
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.(cmd|exe|bat|ps1|par)$/i, "")
      .toLowerCase() || ""
  );
}
/**
 * The agent of the catalogue an upstream runs, as its program is now (`formerPrograms`): null for one that still runs
 * the program the agent ran until an update, which reads its folder as it did then — and for any other.
 * @param {{ type?: string, acp?: { command?: string } } | null | undefined} u
 * @returns {KnownAgent | null}
 */
function currentAgent(u) {
  const known = KNOWN_AGENTS.find((a) => a.id === agentKey(u)) || null;
  const cmd = programName(u);
  return known && !(known.formerPrograms || []).some((n) => n.toLowerCase() === cmd) ? known : null;
}
/**
 * What an account with a folder of its own starts with beside the folder's variable (`folderEnv`); none for any other.
 * @param {{ type?: string, acp?: { command?: string, home?: string } } | null | undefined} u
 * @returns {Record<string, string>}
 */
function folderVars(u) {
  return String(u?.acp?.home || "").trim() ? { ...(currentAgent(u)?.folderEnv || {}) } : {};
}
/**
 * What drives saw of an upstream's agent beyond what it declares (HarnessV3-ACP AC-D5): whether a turn it cancels
 * keeps what it did (`cancelKeepsWork`, AC3's drive C6), the adapter version from which its Claude Code takes how
 * it shows its thinking (`thinkingDisplayFrom`, AC-R2), and whether the input it reports holds what it read from its
 * cache (`cachedInInput`) — an agent over ACP that the catalogue knows, by its command.
 * @param {{ type?: string, acp?: { command?: string } } | null | undefined} u
 * @returns {{ cancelKeepsWork: boolean, thinkingDisplayFrom: string | null, cachedInInput: boolean }}
 */
export function confirmedOf(u) {
  const known = (u?.type || "acp") === "acp" ? KNOWN_AGENTS.find((a) => a.id === agentKey(u)) : null;
  return { cancelKeepsWork: known?.cancelKeepsWork === true, thinkingDisplayFrom: known?.thinkingDisplayFrom || null, cachedInInput: known?.cachedInInput === true };
}
/**
 * The variable an upstream's agent reads its folder from (HarnessV3-ACP AC3-7): `CLAUDE_CONFIG_DIR` for Claude Code,
 * `CODEX_HOME` for Codex, `GEMINI_HOME` for Antigravity. Null for an agent that keeps one login on a computer (Cursor's CLI, Qoder, one
 * Filament doesn't know) and for Cursor's SDK route, whose account is its key.
 * @param {{ type?: string, acp?: { command?: string } } | null | undefined} u
 * @returns {string | null}
 */
export function agentHomeVar(u) {
  if (u?.type === "cursor-sdk") return null;
  const agent = agentKey(u);
  return KNOWN_AGENTS.find((a) => a.id === agent)?.home || null;
}
/**
 * The environment an upstream's agent starts with: its own variables, and its account's folder as the variable its CLI
 * reads (HarnessV3-ACP AC3-7) — the folder wins over a variable of the same name — with what such an account also
 * starts with (`folderEnv`).
 * @param {{ type?: string, acp?: { command?: string, env?: Record<string, unknown>, home?: string } } | null | undefined} u
 * @returns {Record<string, unknown>}
 */
export function agentLaunchEnv(u) {
  const home = String(u?.acp?.home || "").trim();
  const name = home ? agentHomeVar(u) : null;
  return { ...(u?.acp?.env || {}), ...folderVars(u), ...(name ? { [name]: home } : {}) };
}
/**
 * How an agent keeps its accounts (HarnessV3-ACP AC3-7): `folder` — an added account has a folder of its own, read
 * through the variable its CLI reads; `key` — Cursor's SDK route, whose account is its key; null — it keeps one login
 * on a computer.
 * @param {{ type?: string, acp?: { command?: string } } | null | undefined} u
 * @returns {"folder" | "key" | null}
 */
export function accountStyle(u) {
  if (u?.type === "cursor-sdk") return "key";
  return agentHomeVar(u) ? "folder" : null;
}
/**
 * The id of an account added beside an agent's upstream (HarnessV3-ACP AC3-7): the agent's, then the account's name
 * (`claude-code-work`); Cursor's SDK route keeps its own (`cursor-sdk-work`), apart from Cursor's CLI.
 * @param {{ type?: string, acp?: { command?: string } } | null | undefined} u @param {string} slug
 */
export function accountId(u, slug) {
  return `${u?.type === "cursor-sdk" ? "cursor-sdk" : agentKey(u)}-${slug}`;
}
/**
 * The catalogue's command that signs an agent in, as a program to run (HarnessV3-ACP AC3-7), named by its agent: an
 * ACP agent's configured program where it is the same one (a full path stays), else the catalogue's (Claude Code's
 * `claude`, beside its adapter); Codex's configured program, with the options before its `app-server` kept. With the
 * account's folder. Null where the catalogue names none.
 * @param {{ id?: string, name?: string, type?: string, acp?: { command?: string, args?: string[], env?: Record<string, unknown>, home?: string } } | null | undefined} u
 * @returns {{ name: string, command: string, args: string[], env: Record<string, unknown> } | null}
 */
export function catalogueSignIn(u) {
  const known = KNOWN_AGENTS.find((a) => a.id === agentKey(u));
  // An account with a folder of its own signs in its own way where the agent has one (`folderSignIn`: Antigravity's).
  const folder = String(u?.acp?.home || "").trim() ? currentAgent(u)?.folderSignIn : null;
  const cmd = folder || known?.signIn;
  if (!known || !cmd) return null;
  if (u?.type === "codex") {
    const args = Array.isArray(u.acp?.args) ? u.acp.args : [];
    const at = args.indexOf("app-server");
    return { name: agentName(u), command: u.acp?.command || cmd[0], args: [...(at >= 0 ? args.slice(0, at) : args), ...cmd.slice(1)], env: agentLaunchEnv(u) };
  }
  return { name: agentName(u), command: cmd[0] === known.command ? u?.acp?.command || cmd[0] : cmd[0], args: [...cmd.slice(1), ...homeArgs(u)], env: agentLaunchEnv(u) };
}
/**
 * Whether an account signs in by the catalogue's command alone (`folderSignIn`): one with a folder of its own, of an
 * agent whose own ways that open a page can't reach such an account — Antigravity's refuse, saying it runs over SSH.
 * @param {{ type?: string, acp?: { command?: string, home?: string } } | null | undefined} u
 */
export const signsInInTerminal = (u) => !!(String(u?.acp?.home || "").trim() && currentAgent(u)?.folderSignIn);
/**
 * The account's folder as its program takes it on its command line (`homeArg`), where it reads no variable for it;
 * none for an account with no folder, and for any other agent.
 * @param {{ type?: string, acp?: { command?: string, home?: string } } | null | undefined} u
 * @returns {string[]}
 */
function homeArgs(u) {
  const home = String(u?.acp?.home || "").trim();
  const opt = home ? currentAgent(u)?.homeArg : null;
  return opt ? [opt, home] : [];
}
/**
 * A command as a line to copy into a terminal on `platform` (HarnessV3-ACP AC3-7), its variables set for it alone:
 * PowerShell's way on Windows (set before, removed after), a POSIX shell's elsewhere.
 * @param {string[]} argv @param {Record<string, string>} vars @param {string} platform  `process.platform`
 * @returns {string}
 */
export function commandLine(argv, vars, platform) {
  const win = platform === "win32";
  /** @param {string} s */
  const quoted = (s) => (win ? `'${s.replace(/'/g, "''")}'` : `'${s.replace(/'/g, "'\\''")}'`);
  /** @param {string} s */
  const q = (s) => (/^[\w@%+=:,./\\-]+$/.test(s) ? s : quoted(s));
  const words = argv.map(q);
  // PowerShell runs a quoted program only through its call operator.
  const cmd = `${win && words[0] !== argv[0] ? "& " : ""}${words.join(" ")}`;
  const names = Object.keys(vars);
  if (!names.length) return cmd;
  if (!win) return `${names.map((n) => `${n}=${q(vars[n])}`).join(" ")} ${cmd}`;
  // PowerShell assigns a quoted value as a string; a bare `C:\path` would be run as a command.
  return `${names.map((n) => `$env:${n}=${quoted(vars[n])}; `).join("")}${cmd}; ${names.map((n) => `Remove-Item Env:${n}`).join("; ")}`;
}
/**
 * The line that signs an upstream's agent in from a terminal on `platform` (HarnessV3-ACP AC3-7): the program its
 * sign-in runs (`catalogueSignIn`), with the account's folder set for it. Null for an agent the catalogue names none
 * for, and for Cursor's SDK route, whose account is its key.
 * @param {{ type?: string, acp?: { command?: string, args?: string[], home?: string } } | null | undefined} u
 * @param {string} platform
 * @returns {string | null}
 */
export function signInLine(u, platform) {
  if (u?.type === "cursor-sdk") return null;
  const own = catalogueSignIn(u);
  if (!own) return null;
  const home = String(u?.acp?.home || "").trim();
  const name = home ? agentHomeVar(u) : null;
  return commandLine([own.command, ...own.args], { ...folderVars(u), ...(name ? { [name]: home } : {}) }, platform);
}
/**
 * Whether an agent can switch its built-in tools off and work with Filament's hands (`acp.clientBridge` native): its
 * upstream says so (`acp.nativeTools`), or the catalogue's agent it runs does (Claude Code).
 * @param {any} acp  the upstream's `acp` @param {{ id?: string } | null | undefined} upstream
 */
export const nativeCapable = (acp, upstream) =>
  acp?.nativeTools === true || !!KNOWN_AGENTS.find((a) => a.command === (acp?.command || "agent") || a.id === upstream?.id)?.nativeTools;
/**
 * An agent upstream's name in a sentence: its own, without the catalogue's "(agent via ACP)".
 * @param {{ id?: string, name?: string } | null | undefined} u
 */
export function agentTitle(u) {
  return String(u?.name || u?.id || "The agent").replace(/\s*\(agent via ACP\)$/, "");
}
/**
 * The agent an upstream runs, by its name alone (HarnessV3-ACP AC3-7): "Claude Code" for its Default account and for
 * "Claude Code · Work" alike.
 * @param {{ id?: string, name?: string } | null | undefined} u
 */
export function agentName(u) {
  return agentTitle(u).replace(/ · .*$/, "");
}
/**
 * Where an agent nobody signed in to is signed in (HarnessV3-ACP AC3-7): the harness's Settings → Coding agents, or
 * the account's own line in a terminal.
 * @param {{ type?: string, acp?: { command?: string, home?: string } } | null | undefined} u @param {string} platform
 */
export function signInAdvice(u, platform) {
  const line = signInLine(u, platform);
  return `Sign in under Settings → Coding agents in Filament's harness${line ? `, or run \`${line}\` in a terminal` : ""}`;
}
// The arguments an ACP agent is started with. Only Cursor's CLI needs the `acp` subcommand when nothing is configured;
// adapters such as claude-agent-acp take no arguments and reject unknown ones. An account's folder follows where its
// program takes it on its command line (`homeArg`: Antigravity's `--gemini-dir`), never kept in its arguments: an
// account added copies them, and an update replaces them.
/** @param {{ command?: string, args?: string[], home?: string }} [acp] */
export function agentArgs(acp = {}) {
  const own = Array.isArray(acp.args) && acp.args.length ? acp.args : /^(agent|cursor-agent)$/i.test(String(acp.command || "agent")) ? ["acp"] : [];
  const folder = homeArgs({ acp });
  return folder.length ? [...own, ...folder] : own;
}

// Known Qoder model ids (the live list from the account is preferred; this is the fallback for the picker).
export const QODER_MODELS = [
  ["ultimate", "Ultimate"],
  ["auto", "Auto"],
  ["performance", "Performance"],
  ["efficient", "Efficient"],
  ["lite", "Lite"],
  ["qmodel_38max", "Qwen3.8-Max"],
  ["qmodel_latest", "Qwen3.7-Max"],
  ["qmodel", "Qwen3.7-Plus"],
  ["qfmodel", "Qwen3.8-Flash"],
  ["kmodel_latest", "Kimi-K3"],
  ["kmodel", "Kimi-K2.7-Code"],
  ["gmodel", "GLM-5.3"],
  ["gfmodel", "GLM-5.3-Flash"],
  ["dmodel", "DeepSeek-V4-Pro"],
  ["dfmodel", "DeepSeek-V4-Flash"],
  ["mmodel", "MiniMax-M3"],
];
