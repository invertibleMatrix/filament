// Dashboard assistant: a chat agent that configures Filament by calling tools against a draft config.
// The model is reached through Filament itself (any non-ACP route), so it works with whatever the user has set up.
// Nothing is saved until the user presses Apply in the UI; every tool works on a per-chat draft.
import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { schemaAsJson, isLeaf, UPSTREAM_TYPES } from "../core/schema.js";
import { callRoom } from "../core/routing.js";
import { modelCapsFor } from "../core/model-caps.js";
import { estimateBodyTokens } from "../core/tokens.js";
import { getTemplate, applyTemplate, templateOffWhy, templatesFor } from "../services/config/templates.js";
import { normalizeConfig, validateConfig, redactConfig, secretsNow, mergeSecrets } from "../services/config/store.js";

const MAX_ITERATIONS = 16;

// ---------------------------------------------------------------------------------------------------
// The shipped documentation, sectioned for search_docs / read_docs (cached per mtime)
// ---------------------------------------------------------------------------------------------------
const DOCS_DIR = fileURLToPath(new URL("../../docs/", import.meta.url));
const DOC_FILES = [
  "GUIDE.md",
  "CONTEXT.md",
  "ARCHITECTURE.md",
  "memory-guide.md",
  "build_steps.md",
  "PARAMETERS.md",
  "TEMPLATES.md",
  "ROADMAP.md",
  "memory-architecture.md",
];
const docsCache = new Map(); // file -> { mtime, sections: [{ heading, level, text, lines }] }
function docSections(file) {
  let st;
  try {
    st = statSync(`${DOCS_DIR}${file}`);
  } catch {
    return null;
  }
  const hit = docsCache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit.sections;
  const raw = readFileSync(`${DOCS_DIR}${file}`, "utf8");
  const sections = [];
  let cur = { heading: "(top)", level: 0, text: "" };
  for (const line of raw.split("\n")) {
    const m = /^(#{1,4})\s+(.*)$/.exec(line);
    if (m) {
      if (cur.text.trim()) sections.push(cur);
      cur = { heading: m[2].replace(/[#*`]/g, "").trim(), level: m[1].length, text: "" };
    } else cur.text += line + "\n";
  }
  if (cur.text.trim()) sections.push(cur);
  docsCache.set(file, { mtime: st.mtimeMs, sections });
  return sections;
}
// Dashboard pages the assistant can send the user to (open_page); ids match the UI's tabs.
export const PAGES = [
  "overview",
  "requests",
  "usage",
  "memory",
  "memories",
  "sessions",
  "activity",
  "memusage",
  "projects",
  "routes",
  "upstreams",
  "settings",
  "assistant",
  "guide",
  "docs",
];

// ---------------------------------------------------------------------------------------------------
// Knowledge for the system prompt
// ---------------------------------------------------------------------------------------------------
function paramReference(node, prefix = "", out = []) {
  for (const [k, v] of Object.entries(node)) {
    if (k === "_doc") continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (isLeaf(v))
      out.push(
        `- ${path} (${v.type}${v.options ? ": " + v.options.join("|") : ""}; default ${JSON.stringify(v.default)}): ${v.description} Effect: ${v.effect || ""}`,
      );
    else {
      if (v._doc) out.push(`\n## ${path}\n${v._doc}`);
      paramReference(v, path, out);
    }
  }
  return out;
}

const CONCEPTS = `
# How Filament works (for you, the assistant)
- Agents (Claude Code, any Anthropic- or OpenAI-format client) send requests to Filament at /v1/messages or /v1/chat/completions with an inbound key.
- A request's model name is parsed: suffixes -low/-medium/-high/-xhigh/-max choose effort, -fast chooses Anthropic fast mode (Opus 5 / 4.8 only), @agent/@plan/@ask choose an ACP agent mode. The remaining name is matched against ROUTES top to bottom; first match wins. "*" is a wildcard; {model} and {1} fill the upstreamModel template.
- The route names an UPSTREAM: type anthropic (api.anthropic.com), openai/openai-compatible (GPT, GLM, DeepSeek, Kimi, Groq, xAI, local servers), anthropic-compatible (a gateway, a proxy or a local router speaking Anthropic's format), acp (a local coding agent such as Cursor CLI driven over the Agent Client Protocol; it edits files itself; models are its own ids; no API key), cursor-sdk (Cursor's official SDK with an API key) or qoder (Qoder's cloud, by account login or a personal token).
- If the client's wire format differs from what the upstream speaks, Filament TRANSLATES (rules.translate). Otherwise it passes the format through.
- RULES then fix/fill/remove parameters: thinking shape (legacy budget_tokens -> adaptive on new Claude), thinking.display=summarized so reasoning is visible, effort from suffix -> client -> default with per-model caps, sampling params removed on Claude 4.7+, forced tool_choice -> auto on Fable 5.1, beta headers (redact-thinking removed), cache markers, max_tokens bounds, stream forcing, fast mode. Rules are layered: global (config.rules) -> upstream.rules -> route.rules; an unset field inherits.
- TEMPLATES are documented bundles of settings; applying one merges its patch. Prefer templates for common setups.
- RESILIENCE: a route's primary + fallbacks form a pool; route.strategy picks among them (in_order, round_robin, random, least_latency, least_cost, quota_aware). Upstreams that fail with 429/5xx/unreachable get an exponential cooldown (rules.resilience) and are tried last. No clock cuts a model call: it ends when the provider answers or fails, or when its client hangs up.
- Every request is recorded (Requests page): tokens, cache read/write, cost, timing, and the list of changes Filament made.
- Claude facts: Fable 5.1 = thinking always on, effort low..max, no forced tool_choice, no sampling params; Opus 5 = adaptive thinking default, effort low..max, fast mode available; Sonnet 5 = adaptive, effort low..max; Opus/Sonnet 4.6 = no xhigh; Haiku 4.5 = old budget_tokens thinking, no effort. display: summarized makes thinking text visible (default omitted returns empty blocks).
- Cursor is upstream type acp with command 'agent' (the Cursor CLI over ACP, uses the CLI's own login). Upstream type cursor-sdk is a second way behind Settings › Experimental (experimental.cursorSdk, off by default: off, its models leave the pickers and a turn on it is refused, saying so) (the official @cursor/sdk in Filament's process, needs a Cursor API key pasted on the upstream and 'npm install -g @cursor/sdk' once; the same acp.* settings apply; clientBridge full replaces Cursor's read/edit/shell/delete with Filament's tools through the client). Template 'cursor-sdk' adds the upstream and a 'cursor-sdk/*' route.
- Codex: upstream type codex (Codex's own app-server, 'codex app-server', signed in with 'codex login'; the same acp.* settings apply except the ACP-only ones; model names codex/<model> and codex/<model>-<effort>). Template 'codex' adds the upstream and a 'codex/*' route.
- Client bridge: acp.clientBridge = prompts (default: permission questions with acp.permissions=ask and the agent's plan become the chat client's own AskUserQuestion / TodoWrite tool calls, shown as native cards), full (also delegated file reads/writes/commands run through the client's Read/Write/Bash under the client's permission mode; Qoder delegates, Cursor/Codex/Claude Code do not), native (Claude Code only: its built-in tools are replaced by Filament's MCP toolset so every action runs through the client), off (text only). acp.clientWaitMinutes bounds the wait for the client's answer.
- Agent turns: no clock ends a coding agent's turn; it ends when the agent ends it, when it is stopped, or when the agent fails. Clients' housekeeping requests (session titles) are answered by Filament (acp.housekeeping=local) or by acp.housekeepingModel; never let them reach the agent.
- Agent folders: acp.cwdAllowlist holds full folder paths only (or stays empty = any folder); the policy words allow-all / read-only belong in acp.permissions. A non-path entry in cwdAllowlist is rejected by validation.
- Cursor via ACP: pick effort and speed by choosing the Cursor model id (…-low/-high/-xhigh, …-fast); mode via @plan/@ask; permissions policy on the upstream; input tokens are always estimated locally (a class-weighted estimate) — counting never contacts a provider.

# The memory system (short)
- Optional but built in: MEMORY = an encrypted byte-exact ARCHIVE of conversations (SQLite; projects → sessions → turns) + a Mnemosyne ENGINE child process holding what was learned + a BRAIN deciding per request what to inject. Learned items (corrections, preferences, facts) are kept by the agent with its memory tools as the user says them, or distilled by memory's model at session boundaries; they start "inferred" until the user confirms them on the Memories page.
- What reaches the model: one stable BRIEFING in the system prompt per session, a small block on the newest message when something related exists, and filament_memory_* tools the model can call (Filament runs them and re-asks). Re-attached blocks are byte-exact so provider prompt caches survive.
- Users steer it with @mem commands in any chat (status, remember, sessions, load <id>, off/on, new) and the Memory hub in the console: Overview, Memories (+learned-items review), Sessions, Activity, LLM usage, Projects, Settings.
- Memory settings (memory.* in the parameter reference) are config like anything else: change them in the DRAFT with set_config_value.

# The console, page by page (open_page can send the user to any of these)
- overview (Home): Get started's steps until a model can answer; then status, spend, live requests, alerts. requests (Traffic): every request, failures, the changes Filament made. usage: cost/tokens by model, upstream, client and project, 30-day chart. memory hub: memories, sessions, activity, memusage, projects. routes: model-name → destination rules. upstreams: providers and coding agents, keys, discovery. settings: everything else. assistant: you. guide (Start here): Get started's steps, what Filament does, a model-name tester and the glossary. docs: the shipped guides.

# How to work
1. Understand what the user wants in plain terms. Ask one short question only if truly ambiguous.
2. Inspect first: get_config, list_models, list_templates, get_recent_requests when debugging; get_usage and get_alerts for cost and health questions; get_memory_status / memory_sessions / memory_items for memory questions.
3. Answer "how does X work" from the shipped documentation: search_docs first, read_docs for the full section. Never invent behaviour the docs do not support.
4. Change the DRAFT with tools (set_config_value, add_route, add_upstream, apply_template, …). Prefer a template when one fits. Keep changes minimal and reversible.
5. Verify with validate and, where useful, dry_run (shows exactly what would be sent) or test_upstream.
6. Send the user to the right page with open_page instead of describing where to click ("I opened Traffic for you" after calling it).
7. Finish with a short plain-language summary of what changed and why, then say: "Press Apply to save these changes." Never claim something is saved: only the user's Apply saves.
Rules: use only parameters that exist in the reference below; never write secrets (API keys) into config through tools — ask the user to paste keys on the Upstreams page; memory_remember / memory_forget / memory_learn act on the REAL memory immediately (they are not part of the draft — say so); explain effects, not mechanics; no filler.
`;

export function buildSystemPrompt({ cfg, models, dataDir }) {
  const s = schemaAsJson();
  const ref = [
    ...paramReference(s.rules, "rules"),
    ...paramReference(s.upstream, "upstream"),
    ...paramReference(s.route, "route"),
    ...paramReference(s.config.server, "server"),
    ...paramReference(s.config.observability, "observability"),
    ...(s.config.memory ? paramReference(s.config.memory, "memory") : []),
    ...(s.config.alerts ? paramReference(s.config.alerts, "alerts") : []),
  ].join("\n");
  const upstreamTypes = Object.entries(s.upstreamTypes)
    .map(
      ([k, v]) =>
        `- ${k}: ${v.label} (formats ${v.formats.join("/")}${v.baseUrl ? ", default URL " + v.baseUrl : ""})`,
    )
    .join("\n");
  const tpl = templatesFor(cfg).map((t) => `- ${t.id}: ${t.name}. ${t.summary}`).join("\n");
  const cfgText = JSON.stringify(redactConfig(cfg, { masked: false }), null, 1);
  const modelText = (models || [])
    .slice(0, 400)
    .map(
      (m) =>
        `${m.id} -> ${m.upstream}${m.upstreamModel && m.upstreamModel !== m.id ? " as " + m.upstreamModel : ""}`,
    )
    .join("\n");
  return `You are the Filament configuration assistant, embedded in the Filament console. You help a non-expert configure Filament (a local proxy between coding agents and model providers / local agents) by reading and editing a draft of its configuration through tools. Be concrete, brief and friendly.
${CONCEPTS}
# Upstream types
${upstreamTypes}

# Templates (apply_template)
${tpl}

# Parameter reference (paths as used by set_config_value; "upstream.*" fields live on each entry of upstreams[], "route.*" on each entry of routes[])
${ref}

# Current configuration (secrets masked as __SECRET__; data dir ${dataDir})
\`\`\`json
${cfgText}
\`\`\`

# Models agents can currently ask for (${(models || []).length} names; "name -> upstream")
${modelText || "(none yet)"}
`;
}

// ---------------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------------
export const TOOLS = [
  {
    name: "get_config",
    description:
      "Return the current DRAFT configuration (secrets masked). Call before changing anything you have not seen.",
    input_schema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          description: "Optional: rules | upstreams | routes | server | observability | pricing",
        },
      },
    },
  },
  {
    name: "set_config_value",
    description:
      "Set one value in the draft. Paths: 'rules.effort.default', 'server.logLevel', 'observability.storeBodies', 'upstream:<id>.acp.mode', 'upstream:<id>.rules.headers.identity', 'route:<match>.format', 'route:<match>.rules.effort.default'. Value must be JSON-typed correctly (string, number, boolean, array, object). Use null to unset an override on an upstream/route rule.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, value: {} },
      required: ["path", "value"],
    },
  },
  {
    name: "add_upstream",
    description:
      "Add or replace an upstream in the draft. Do NOT include apiKey; the user pastes keys in the UI. For a coding agent (type 'acp' or 'codex') include an 'acp' object (command, args, mode, permissions…); a 'codex' upstream that names no command runs 'codex app-server'.",
    input_schema: {
      type: "object",
      properties: {
        upstream: {
          type: "object",
          description:
            "Fields: id (required), name, type (anthropic|openai|anthropic-compatible|openai-compatible|acp|cursor-sdk|qoder), baseUrl, authStyle, enabled, discoverModels, models, rules, acp",
        },
      },
      required: ["upstream"],
    },
  },
  {
    name: "remove_upstream",
    description:
      "Remove an upstream from the draft (routes pointing at it become invalid; fix or remove them too).",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "add_route",
    description:
      "Add a route to the draft at a position (0 = top, highest priority; omit = before any catch-all '*'). Replaces an existing route with the same match.",
    input_schema: {
      type: "object",
      properties: {
        route: {
          type: "object",
          description:
            "Fields: match (required), upstream (required id), upstreamModel (default '{model}'), format (auto|anthropic|openai), fallbacks, discoverPrefixes, enabled, rules",
        },
        position: { type: "integer" },
      },
      required: ["route"],
    },
  },
  {
    name: "remove_route",
    description: "Remove the route with this match from the draft.",
    input_schema: { type: "object", properties: { match: { type: "string" } }, required: ["match"] },
  },
  {
    name: "move_route",
    description: "Move a route to a new position (0 = top).",
    input_schema: {
      type: "object",
      properties: { match: { type: "string" }, position: { type: "integer" } },
      required: ["match", "position"],
    },
  },
  {
    name: "list_templates",
    description: "List templates with their summaries and effects.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "apply_template",
    description:
      "Apply a template to the draft (with its dependencies). Returns the list of settings that would change.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "validate",
    description: "Validate the draft and list every difference from the saved configuration.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "dry_run",
    description:
      "Show what Filament would send for a sample request under the DRAFT: route, upstream, body, headers, changes. Use to confirm thinking/effort/speed settings.",
    input_schema: {
      type: "object",
      properties: {
        model: { type: "string", description: "Model name as an agent would send it" },
        format: { type: "string", enum: ["anthropic", "openai"] },
        body: {
          type: "object",
          description: "Optional full request body; a minimal one is built from model if omitted",
        },
      },
      required: ["model"],
    },
  },
  {
    name: "list_models",
    description: "List the model names agents can ask for right now, with the upstream each goes to.",
    input_schema: {
      type: "object",
      properties: { filter: { type: "string", description: "substring filter" } },
    },
  },
  {
    name: "test_upstream",
    description:
      "Connectivity test for a SAVED upstream (API key or agent start). Returns ok/error and the number of models seen.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "get_recent_requests",
    description:
      "Recent requests with status, model, upstream, tokens, timing and the changes Filament made. Use to debug 'why did X happen'.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "integer" }, onlyErrors: { type: "boolean" } },
    },
  },
  {
    name: "get_request",
    description:
      "Full detail of one request by id: error text, changes, received-vs-sent summary, provider metadata.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "search_reference",
    description:
      "Search the parameter reference and templates for a word (e.g. 'display', 'cache', 'permissions').",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  // ---- knowledge: the shipped documentation ----
  {
    name: "search_docs",
    description:
      "Search the shipped guides (GUIDE, memory-guide, build_steps, PARAMETERS, TEMPLATES, ROADMAP, memory-architecture) by words. Returns matching sections with a short excerpt each; use read_docs for the full text of one. This is the source of truth for every 'how does X work' question.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "words to look for, e.g. 'prompt cache blocks', 'failover strategy', 'backup destination'",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_docs",
    description: "Return the full text of one documentation section found by search_docs.",
    input_schema: {
      type: "object",
      properties: {
        doc: { type: "string", description: "file name as returned by search_docs, e.g. memory-guide.md" },
        heading: { type: "string", description: "the section heading as returned by search_docs" },
      },
      required: ["doc", "heading"],
    },
  },
  // ---- dashboard data: memory, usage, alerts ----
  {
    name: "get_memory_status",
    description:
      "Memory system state: enabled, engine (Mnemosyne) state and counts, archive size, sessions waiting to be learned, backup state. Use before any memory advice.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "memory_sessions",
    description:
      "Search the user's archived sessions by words they typed. Each row: id, title, project, client, turns, end-state line, learned-items count, learning pill data.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "integer" }, project: { type: "string" } },
    },
  },
  {
    name: "memory_items",
    description: "Learned items (inferred facts awaiting review, confirmed, dismissed, or superseded by a correction).",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["inferred", "confirmed", "dismissed", "superseded"] },
        kind: { type: "string" },
        limit: { type: "integer" },
      },
    },
  },
  {
    name: "memory_recall",
    description:
      "Ask the memory engine what it remembers about a topic (the same recall the autopilot uses). Returns memories with relevance scores.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "memory_remember",
    description:
      "Store a fact/preference/rule/decision in the user's memory NOW (not a draft change): confirmed and pinned. Keep it one sentence, the user's own terms. A procedure (how a multi-step thing is done in a project) is written \"How to <goal>: 1. <step> 2. <step>\".",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        kind: { type: "string", enum: ["fact", "preference", "rule", "decision", "procedure"] },
      },
      required: ["text"],
    },
  },
  {
    name: "memory_forget",
    description:
      "Retire a memory the user asks to forget, NOW (its id: 'i<n>' for a learned item, or an engine memory id). It is kept as history and no longer served.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "memory_learn",
    description:
      "Force the learner over one session NOW: title, end state and facts, even if it is not idle. Cheapest way to answer 'what happened in this session'.",
    input_schema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] },
  },
  {
    name: "get_usage",
    description:
      "Traffic and cost summary for a period: totals, per model, per upstream, per client and per project, cache hit rate, errors. hours defaults to 24.",
    input_schema: { type: "object", properties: { hours: { type: "integer" } } },
  },
  {
    name: "get_alerts",
    description: "Active alerts (failovers, degraded engine, the daily spend warning) the user has not dismissed.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "open_page",
    description:
      "Open a console page for the user (they see a button to jump there). Use after explaining something that lives on a page.",
    input_schema: {
      type: "object",
      properties: {
        page: { type: "string", enum: PAGES },
        why: {
          type: "string",
          description: "one short line shown on the button, e.g. 'review the learned items'",
        },
      },
      required: ["page"],
    },
  },
];

// Resolve "upstream:<id>.a.b" / "route:<match>.a.b" / "rules.a.b" into [container, key].
function resolvePath(draft, path) {
  let root = draft,
    segs;
  const m = /^(upstream|route):(.+?)\.(.+)$/.exec(path);
  if (m) {
    if (m[1] === "upstream") {
      root = (draft.upstreams || []).find((u) => u.id === m[2]);
      if (!root) throw new Error(`upstream "${m[2]}" not found`);
    } else {
      root = (draft.routes || []).find((r) => r.match === m[2]);
      if (!root) throw new Error(`route "${m[2]}" not found`);
    }
    segs = m[3].split(".");
  } else segs = path.split(".");
  let o = root;
  for (const k of segs.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== "object") o[k] = {};
    o = o[k];
  }
  return [o, segs.at(-1), root];
}

/**
 * The tools that write the draft. The model's view shows each stored secret as "__SECRET__", so a write can carry one:
 * it is the secret stored at that place where the draft was read, as a page's Save has it (`mergeSecrets`), never the
 * placeholder's text, and one that stands for nothing kept refuses the write, the draft as it was.
 */
const WRITES = new Set(["set_config_value", "add_upstream", "add_route"]);

export class Assistant {
  // `unreadable`: the places whose stored value this secret.key cannot open (the store's `unreadable()`).
  constructor({
    getConfig,
    describeDiff,
    dryRun,
    listModels,
    testUpstream,
    usage,
    callModel,
    dataDir,
    memory = null,
    alertsList = null,
    log = () => {},
    unreadable = () => [],
  }) {
    Object.assign(this, {
      getConfig,
      describeDiff,
      dryRun,
      listModels,
      testUpstream,
      usage,
      callModel,
      dataDir,
      memory,
      alertsList,
      log,
      unreadable,
    });
    this.sessions = new Map();
    setInterval(() => {
      const cutoff = Date.now() - 6 * 3600_000;
      for (const [k, s] of this.sessions) if (s.lastUsed < cutoff) this.sessions.delete(k);
    }, 600_000).unref?.();
  }

  // A chat's draft keeps `base`, the configuration it was read from: what it never changed of the secrets is the
  // configuration's as it stands when it is applied (`applied`).
  session(id) {
    let s = id && this.sessions.get(id);
    if (!s) {
      const base = structuredClone(this.getConfig());
      s = {
        id: id || randomBytes(6).toString("hex"),
        draft: structuredClone(base),
        base,
        messages: [],
        transcript: [],
        lastUsed: Date.now(),
      };
      this.sessions.set(s.id, s);
    }
    s.lastUsed = Date.now();
    return s;
  }
  resetDraft(id) {
    const s = this.session(id);
    s.base = structuredClone(this.getConfig());
    s.draft = structuredClone(s.base);
    return s;
  }
  applied(s) {
    return secretsNow(s.draft, s.base, this.getConfig());
  }
  pending(s) {
    return this.describeDiff(this.getConfig(), this.applied(s));
  }

  async runTool(s, name, input) {
    if (!WRITES.has(name)) return this.#run(s, name, input);
    const was = structuredClone(s.draft);
    const out = await this.#run(s, name, input);
    try {
      s.draft = normalizeConfig(mergeSecrets(s.draft, s.base, { unreadable: this.unreadable() }));
    } catch (/** @type {any} */ e) {
      s.draft = was;
      if (!Number.isInteger(e?.status)) throw e;
      throw new Error(
        e.places?.length
          ? `Not changed: __SECRET__ stands for a secret Filament keeps, and none is kept at ${e.places.join(", ")}. Write no placeholder there: leave a stored secret where it is, and have the person set a new one on the Upstreams page.`
          : e.message,
      );
    }
    return out;
  }

  /** One tool's work on the draft, as `runTool` hands it. @param {any} s @param {string} name @param {any} input */
  async #run(s, name, input) {
    const d = s.draft;
    switch (name) {
      case "get_config": {
        const c = redactConfig(d, { masked: false });
        return input?.section ? { [input.section]: c[input.section] } : c;
      }
      case "set_config_value": {
        const [o, k, root] = resolvePath(d, String(input.path));
        // An upstream renamed in the draft takes its secrets to its new id; one this secret.key cannot open stays in the
        // file under the id it has, and Apply would let it go: such a rename is refused, in words.
        if (k === "id" && o === root && (d.upstreams || []).includes(root) && input.value !== root.id) {
          const held = /** @type {string[]} */ (this.unreadable()).filter((where) => where.startsWith(`upstreams.${root.id}.`));
          if (held.length)
            throw new Error(`Not renamed: ${held.join(", ")} cannot be read (sealed with another secret.key), so it cannot move with "${root.id}" to a new id. Put back the secret.key it was sealed with and restart Filament, or have the person set the value again on the Upstreams page, then rename it.`);
        }
        // What stood there, as the model's view shows it: a stored secret as its placeholder, never its value.
        const [vo, vk] = resolvePath(redactConfig(d, { masked: false }), String(input.path));
        const before = vo[vk];
        if (input.value === null) delete o[k];
        else o[k] = input.value;
        s.draft = normalizeConfig(d);
        const v = validateConfig(s.draft);
        return { ok: v.ok, errors: v.errors, path: input.path, before, after: input.value };
      }
      case "add_upstream": {
        const u = { ...input.upstream };
        if (!u.id) throw new Error("upstream.id is required");
        if (u.apiKey && u.apiKey !== "__SECRET__") {
          delete u.apiKey;
        }
        const i = (d.upstreams || []).findIndex((x) => x.id === u.id);
        if (i >= 0) d.upstreams[i] = { ...d.upstreams[i], ...u, apiKey: d.upstreams[i].apiKey };
        else (d.upstreams ||= []).push({ apiKey: "", ...u });
        s.draft = normalizeConfig(d);
        const v = validateConfig(s.draft);
        return {
          ok: v.ok,
          errors: v.errors,
          note: UPSTREAM_TYPES[u.type]?.keyless
            ? "A coding agent brings its own login; it needs no key."
            : "Remind the user to paste the API key on the Upstreams page, then press Save.",
        };
      }
      case "remove_upstream": {
        const n = d.upstreams.length;
        d.upstreams = d.upstreams.filter((u) => u.id !== input.id);
        const v = validateConfig(normalizeConfig(d));
        return { removed: n - d.upstreams.length, ok: v.ok, errors: v.errors };
      }
      case "add_route": {
        const r = { upstreamModel: "{model}", format: "auto", enabled: true, ...input.route };
        if (!r.match || !r.upstream) throw new Error("route.match and route.upstream are required");
        d.routes = (d.routes || []).filter((x) => x.match !== r.match);
        let pos = input.position;
        if (pos == null) {
          const star = d.routes.findIndex((x) => x.match === "*");
          pos = star >= 0 ? star : d.routes.length;
        }
        d.routes.splice(Math.max(0, Math.min(pos, d.routes.length)), 0, r);
        s.draft = normalizeConfig(d);
        const v = validateConfig(s.draft);
        return {
          ok: v.ok,
          errors: v.errors,
          position: pos,
          routes: s.draft.routes.map((x) => `${x.match} -> ${x.upstream} as ${x.upstreamModel}`),
        };
      }
      case "remove_route": {
        const n = d.routes.length;
        d.routes = d.routes.filter((r) => r.match !== input.match);
        return { removed: n - d.routes.length };
      }
      case "move_route": {
        const i = d.routes.findIndex((r) => r.match === input.match);
        if (i < 0) throw new Error("route not found");
        const [r] = d.routes.splice(i, 1);
        d.routes.splice(Math.max(0, Math.min(input.position, d.routes.length)), 0, r);
        return { routes: d.routes.map((x) => x.match) };
      }
      case "list_templates":
        return templatesFor(d).map((t) => ({
          id: t.id,
          name: t.name,
          summary: t.summary,
          effects: t.effects,
          requires: t.requires || [],
        }));
      case "apply_template": {
        const t = getTemplate(input.id);
        if (!t) throw new Error(`template "${input.id}" not found`);
        const off = templateOffWhy(d, t);
        if (off) throw new Error(`${off}.`);
        let next = d;
        for (const dep of t.requires || []) {
          const dt = getTemplate(dep);
          if (dt) next = applyTemplate(next, dt);
        }
        next = normalizeConfig(applyTemplate(next, t));
        const changes = this.describeDiff(d, next);
        s.draft = next;
        const v = validateConfig(next);
        return { ok: v.ok, errors: v.errors, changes };
      }
      case "validate": {
        const v = validateConfig(s.draft);
        return { ok: v.ok, errors: v.errors, pendingChanges: this.pending(s) };
      }
      case "dry_run": {
        const format = input.format || "anthropic";
        const body =
          input.body ||
          (format === "anthropic"
            ? {
                model: input.model,
                max_tokens: 1024,
                thinking: { type: "adaptive" },
                messages: [{ role: "user", content: "hello" }],
              }
            : { model: input.model, messages: [{ role: "user", content: "hello" }] });
        if (!body.model) body.model = input.model;
        return this.dryRun({ format, body, headers: {} }, s.draft);
      }
      case "list_models": {
        const m = await this.listModels();
        const f = (input?.filter || "").toLowerCase();
        return m.models
          .filter((x) => !f || x.id.toLowerCase().includes(f))
          .slice(0, 300)
          .map((x) => ({ id: x.id, upstream: x.upstream, sent: x.upstreamModel }));
      }
      case "test_upstream":
        return this.testUpstream(input.id);
      case "get_recent_requests": {
        let list = this.usage.list(Math.min(input?.limit || 20, 100));
        if (input?.onlyErrors) list = list.filter((r) => r.status === "error");
        return list.map((r) => ({
          id: r.id,
          ts: r.ts,
          model: r.model,
          upstream: r.upstream,
          upstreamModel: r.upstreamModel,
          status: r.status,
          httpStatus: r.httpStatus,
          error: r.error,
          tokens: r.tokens,
          ttftMs: r.ttftMs,
          totalMs: r.totalMs,
          changes: r.changes,
        }));
      }
      case "get_request": {
        const r = this.usage.detail(input.id);
        if (!r) throw new Error("request not found");
        const { inboundBody, shapedBody, ...rest } = r;
        return rest;
      }
      case "search_reference": {
        const q = String(input.query || "").toLowerCase();
        const s2 = schemaAsJson();
        const hits = [
          ...paramReference(s2.rules, "rules"),
          ...paramReference(s2.upstream, "upstream"),
          ...paramReference(s2.route, "route"),
          ...paramReference(s2.config.server, "server"),
          ...paramReference(s2.config.observability, "observability"),
          ...(s2.config.memory ? paramReference(s2.config.memory, "memory") : []),
          ...(s2.config.alerts ? paramReference(s2.config.alerts, "alerts") : []),
        ].filter((l) => l.toLowerCase().includes(q));
        const tpl = templatesFor(d).filter((t) => JSON.stringify(t).toLowerCase().includes(q)).map(
          (t) => `${t.id}: ${t.summary}`,
        );
        return { parameters: hits.slice(0, 40), templates: tpl };
      }
      // ---- the shipped documentation ----
      case "search_docs": {
        const terms = String(input.query || "")
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length > 2);
        if (!terms.length) return { error: "give search_docs some words" };
        const hits = [];
        for (const file of DOC_FILES) {
          for (const sec of docSections(file) || []) {
            const hay = `${sec.heading}\n${sec.text}`.toLowerCase();
            let score = 0;
            for (const t of terms) {
              const n = hay.split(t).length - 1;
              if (n) score += 1 + Math.min(n - 1, 3) * 0.25;
            }
            if (
              sec.heading
                .toLowerCase()
                .split(/\W+/)
                .some((w) => terms.includes(w))
            )
              score += 1.5;
            if (score >= 1)
              hits.push({
                doc: file,
                heading: sec.heading,
                score: Math.round(score * 2) / 2,
                excerpt: sec.text.replace(/\s+/g, " ").trim().slice(0, 260),
              });
          }
        }
        hits.sort((a, b) => b.score - a.score);
        if (!hits.length)
          return {
            note: "nothing matched; try other words, or the question may be about something the guides do not cover",
            docs: DOC_FILES,
          };
        return { sections: hits.slice(0, 8) };
      }
      case "read_docs": {
        const file = DOC_FILES.find((f) => f.toLowerCase() === String(input.doc || "").toLowerCase());
        if (!file) return { error: `doc must be one of ${DOC_FILES.join(", ")}` };
        const q = String(input.heading || "").toLowerCase();
        const secs = docSections(file) || [];
        const sec =
          secs.find((x) => x.heading.toLowerCase() === q) ||
          secs.find((x) => x.heading.toLowerCase().includes(q));
        if (!sec)
          return {
            error: `no section "${input.heading}" in ${file}; call search_docs first`,
            headings: secs.slice(0, 60).map((x) => x.heading),
          };
        return { doc: file, heading: sec.heading, text: sec.text.trim().slice(0, 12000) };
      }
      // ---- dashboard data ----
      case "get_memory_status": {
        if (!this.memory?.enabled?.())
          return {
            enabled: false,
            note: "memory is off; turn it on from the console's Memory page (open_page memory)",
          };
        try {
          return await this.memory.status({});
        } catch (e) {
          return { error: e.message };
        }
      }
      case "memory_sessions": {
        if (!this.memory?.enabled?.()) return { error: "memory is off" };
        try {
          return {
            // The list goes to the assistant's model: no chat Memory settings leave out is in it (memory's `sessions`).
            sessions: this.memory.sessions(String(input.query || ""), {
              limit: Math.min(input.limit || 8, 20),
              project: input.project || null,
              others: true,
            }),
          };
        } catch (e) {
          return { error: e.message };
        }
      }
      case "memory_items": {
        if (!this.memory?.enabled?.()) return { error: "memory is off" };
        try {
          return {
            items: this.memory.items({
              status: input.status,
              kind: input.kind,
              limit: Math.min(input.limit || 20, 100),
            }),
          };
        } catch (e) {
          return { error: e.message };
        }
      }
      case "memory_recall": {
        if (!this.memory?.enabled?.()) return { error: "memory is off" };
        try {
          return { results: await this.memory.scope({ role: "owner" }).search(String(input.query || ""), { limit: 8 }) };
        } catch (e) {
          return { error: e.message };
        }
      }
      case "memory_remember": {
        if (!this.memory?.enabled?.()) return { error: "memory is off" };
        try {
          // The owner's console: it stores what the owner asked for, in the owner's word.
          const r = await this.memory.scope({ role: "owner" }).remember(String(input.text || ""), { kind: input.kind || "fact", importance: 0.85 });
          return { ...r, note: "stored now (confirmed); it joins briefings or recall from here on" };
        } catch (e) {
          return { error: e.message };
        }
      }
      case "memory_forget": {
        if (!this.memory?.enabled?.()) return { error: "memory is off" };
        try {
          return await this.memory.scope({ role: "owner" }).forget(String(input.id || ""), { reason: "the owner asked the assistant to forget it" });
        } catch (e) {
          return { error: e.message };
        }
      }
      case "memory_learn": {
        if (!this.memory?.enabled?.()) return { error: "memory is off" };
        try {
          return await this.memory.learn(String(input.sessionId || ""));
        } catch (e) {
          return { error: e.message };
        }
      }
      case "get_usage": {
        const hours = Math.min(Math.max(Number(input.hours) || 24, 1), 24 * 30);
        // Projects in words (LD-D8): memory names each folder; the id stays beside it, which the memory tools take.
        const t = this.usage.summary(hours * 3600_000, { projectNamed: this.memory?.projectNamed ? (id) => this.memory.projectNamed(id) : null });
        const slim = (obj, key = "name") =>
          Object.entries(obj || {})
            .slice(0, 12)
            .map(([k, v]) => ({ [key]: k, ...v }));
        return {
          hours,
          totals: {
            requests: t.requests,
            tokensIn: t.tokens.input + t.tokens.cacheRead + t.tokens.cacheWrite,
            tokensOut: t.tokens.output,
            thinking: t.tokens.thinking,
            cacheHitRate: t.cacheHitRate,
            cost: t.cost,
            errors: t.errors,
          },
          byModel: slim(t.byModel),
          byUpstream: slim(t.byUpstream),
          byClient: slim(t.byClient),
          byProject: slim(t.byProject, "project"),
        };
      }
      case "get_alerts": {
        return { alerts: this.alertsList ? this.alertsList() : [] };
      }
      case "open_page": {
        const page = PAGES.includes(input.page) ? input.page : null;
        if (!page) return { error: `page must be one of ${PAGES.join(", ")}` };
        return { page, note: input.why || "" };
      }
      default:
        throw new Error(`unknown tool ${name}`);
    }
  }

  // One user turn. onEvent gets {type:'text'|'tool'|'tool_result'|'done'|'error', ...}; `signal`: the chat hung up.
  async turn({ sessionId, message, model, onEvent = () => {}, signal = null }) {
    const s = this.session(sessionId);
    s.model = model || s.model;
    if (!s.model) throw new Error("no model selected");
    // The assistant works only through its tools: a model that takes none (HarnessV4_Tasks E4) is refused before
    // anything is sent.
    const said = modelCapsFor(this.getConfig(), s.model)?.tools;
    if (said && !said.available)
      throw new Error(`${s.model} takes no tools (${said.source === "operator" ? "its row on the Upstreams page says so" : "its provider's model list says so"}), and the assistant works only through its tools. Pick another model.`);
    const turnStart = s.messages.length; // on a model error, roll back to here so no dangling tool_use remains
    s.messages.push({ role: "user", content: message });
    s.transcript.push({ role: "user", text: message, ts: Date.now() });
    let models = [];
    try {
      models = (await this.listModels()).models;
    } catch {}
    const system = buildSystemPrompt({ cfg: s.draft, models, dataDir: this.dataDir });
    let finalText = "";
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      let res;
      try {
        const ask = { model: s.model, system, tools: TOOLS, messages: s.messages };
        // The most the model can write, inside its window (HarnessV3-FailurePoints §13).
        res = await this.callModel({ ...ask, max_tokens: callRoom(this.getConfig(), s.model, estimateBodyTokens(ask, "request")) }, { signal });
      } catch (e) {
        onEvent({ type: "error", message: e.message });
        s.messages.length = turnStart;
        return { error: e.message };
      }
      if (res.type === "error" || !Array.isArray(res.content)) {
        const msg = res.error?.message || JSON.stringify(res).slice(0, 300);
        onEvent({ type: "error", message: msg });
        s.messages.length = turnStart;
        return { error: msg };
      }
      s.messages.push({ role: "assistant", content: res.content });
      const texts = res.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .filter(Boolean);
      for (const t of texts) {
        finalText += (finalText ? "\n\n" : "") + t;
        onEvent({ type: "text", text: t });
        s.transcript.push({ role: "assistant", text: t, ts: Date.now() });
      }
      const uses = res.content.filter((b) => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !uses.length) break;
      const results = [];
      for (const u of uses) {
        onEvent({ type: "tool", id: u.id, name: u.name, input: u.input });
        let out,
          isError = false;
        try {
          out = await this.runTool(s, u.name, u.input || {});
        } catch (e) {
          out = { error: e.message };
          isError = true;
        }
        const text = JSON.stringify(out ?? null);
        const shown = text.length > 12000 ? text.slice(0, 12000) + "…[truncated]" : text;
        s.transcript.push({
          role: "tool",
          name: u.name,
          input: u.input,
          result: shown.slice(0, 2000),
          isError,
          ts: Date.now(),
        });
        onEvent({ type: "tool_result", id: u.id, name: u.name, ok: !isError, summary: shown.slice(0, 400) });
        results.push({
          type: "tool_result",
          tool_use_id: u.id,
          content: shown,
          ...(isError ? { is_error: true } : {}),
        });
      }
      s.messages.push({ role: "user", content: results });
    }
    // Trim history to the last 40 messages, keeping pairs intact from the start of a user turn.
    if (s.messages.length > 40) {
      let cut = s.messages.length - 40;
      while (
        cut < s.messages.length &&
        !(s.messages[cut].role === "user" && typeof s.messages[cut].content === "string")
      )
        cut++;
      s.messages = s.messages.slice(cut);
    }
    const v = validateConfig(s.draft);
    const done = {
      type: "done",
      sessionId: s.id,
      pendingChanges: this.pending(s),
      valid: v.ok,
      errors: v.errors,
    };
    onEvent(done);
    return { text: finalText, ...done };
  }
}
