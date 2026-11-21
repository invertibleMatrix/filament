// @ts-check
// Chat commands typed into a harness chat with a coding agent and answered by Filament itself: `/sessions`,
// `/resume <id>`, `/new`, `/status`, `/help`, `/cost`, `/commands`, `/compact`, `/clear` and `/autocompact`. An outside
// client's are its agent's, typed as they are: Filament answers none of them (acp-turn.js). Most call no agent:
// `/resume` attaches the chat to one of its sessions and has the agent recap it, `/compact` has the agent compact its
// session its own way (HarnessV3-ACP AC5-5), and `/status`, `/compact` and `/clear` go to the agent as typed where it
// publishes its own. Any other `/word` is passed to the agent as text, with a note on the record saying whether the
// agent published such a command.
import { KNOWN_AGENTS } from "../../core/catalogues.js";
import { cacheWords, listedOf } from "./status.js";
import { spentIn } from "../../core/turn-facts.js";
import { selfAddress } from "../../services/config/store.js";

/** @typedef {import("../deps.js").AppDeps} AppDeps */

const COMMAND_RE = /^\/(sessions|new|resume|compact|autocompact|clear|status|help|commands|cost)(?:\s+(.+?))?\s*$/i;

/**
 * The command the newest user message is, or null. `[1]` is the verb, `[2]` its argument.
 * @param {string} lastUserText
 */
export const parseAgentCommand = (lastUserText) => COMMAND_RE.exec(lastUserText);

const OWN_COMMAND_RE = /^\/([A-Za-z][\w:-]*)/;
/**
 * The `/word` a message opens with, or null: where it is none of Filament's it is the agent's own, which the agent
 * reads only at the start of a prompt.
 * @param {string} text
 */
export const slashWordOf = (text) => OWN_COMMAND_RE.exec(String(text ?? ""));

/** @param {any} conv @returns {{ name: string, description: string, hint: string }[]} */
const cmdList = (conv) =>
  (conv?.commands || []).map((x) => (typeof x === "string" ? { name: x, description: "", hint: "" } : x));
/** @param {any} conv @param {string} n */
const hasCmd = (conv, n) => cmdList(conv).some((c) => c.name === n);
/** @param {string} id */
const known = (id) => KNOWN_AGENTS.find((a) => a.id === id) || null;
/** @param {number} ms */
const dur = (ms) => {
  ms = Math.max(0, Math.round(ms));
  const s = Math.floor(ms / 1000),
    m = Math.floor(s / 60),
    h = Math.floor(m / 60),
    d = Math.floor(h / 24);
  return d
    ? `${d}d ${h % 24}h ${m % 60}m`
    : h
      ? `${h}h ${m % 60}m ${s % 60}s`
      : m
        ? `${m}m ${s % 60}s`
        : `${(ms / 1000).toFixed(1)}s`;
};
/** @param {number} n */
const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
/** @param {string} iso */
const ago = (iso) => {
  const d = Date.now() - new Date(iso).getTime();
  return d < 3600000
    ? `${Math.max(1, Math.round(d / 60000))} min ago`
    : d < 86400000
      ? `${(d / 3600000).toFixed(1)} h ago`
      : `${Math.round(d / 86400000)} d ago`;
};

/**
 * @typedef {object} AgentCommandContext
 * @property {RegExpExecArray} cmd  from `parseAgentCommand`
 * @property {any} rec
 * @property {any} bridge  the agent bridge for this upstream
 * @property {any} upstream
 * @property {any} acp  `upstream.acp || {}`
 * @property {"anthropic" | "openai"} format
 * @property {any} body
 * @property {Record<string, string>} inboundHeaders
 * @property {any} route
 * @property {string} modelId  the agent model id this turn resolved to
 * @property {string} agentName
 * @property {string | null} conversationId  the client's conversation id, if it sent one
 * @property {string} chain  the harness chat's chain: its `/compact` is the session's own compaction (AC5-5)
 * @property {any} [res]  the turn's response: a typed `/compact` compacts inside its turn
 * @property {((ev: any) => void) | null} [onEvent]  the turn's events: the compaction's, as the agent says them
 */

/**
 * @typedef {object} AgentCommandResult
 * @property {string | null} reply  Filament's answer; null passes the text to the agent (it has its own command)
 * @property {string} [note]  the record's word on an answer the agent may have been asked for (a harness `/compact`);
 *   without one the record says the agent was not called
 * @property {string} [intro]  text to emit as the agent's before the turn runs (`/resume` attached)
 * @property {any} [body]  the request body the turn should run with instead (`/resume` attached)
 * @property {string} [error]  the agent could not even be started or asked (`/resume`); the turn must fail
 */

/**
 * A harness chat's `/compact [what to keep]` (HarnessV3-ACP AC5-5): the agent compacts its session its own way, as
 * Compact now does under the way own — listed with the session's compactions, with Undo until the next message. The
 * answer in words, and the record's note: Filament asked the agent, or nothing was compacted (a refusal may come before
 * the agent is asked or after); null when the agent has no compaction of its own that Filament can ask for now.
 * @param {AppDeps} deps @param {AgentCommandContext} ctx
 * @returns {Promise<AgentCommandResult | null>}
 */
async function compactOwn(deps, { chain, cmd, res, onEvent = null, agentName }) {
  const typed = cmd[0].trim();
  /** @type {any} */
  let r;
  try {
    r = await deps.sessions.compact(String(chain), { way: "own", words: cmd[2] || "", within: res, onEvent });
  } catch (/** @type {any} */ e) {
    if (e?.extra?.lacks === "own") return null;
    return {
      reply: `**Not compacted:** ${e.message}.`,
      note: `acp: chat command ${typed} answered by Filament: not compacted — ${e.message}`,
    };
  }
  const c = r.compaction;
  const d = c.detail || {};
  const span = c.fromTurn === c.toTurn ? `turn ${c.toTurn}` : `turns ${c.fromTurn}–${c.toTurn}`;
  const figures = d.before && d.after ? ` — ${k(d.before)} → ${k(d.after)} tokens` : d.before ? ` — at ${k(d.before)} tokens` : "";
  const undo = d.forked
    ? "Until your next message, Undo on its row in the conversation brings back the session from before it."
    : "Until your next message, Undo on its row in the conversation goes back to Filament's copy of the chat, which a fresh session then starts from.";
  const untold = d.untold ? ` ${agentName} takes no instructions for its compaction: what you asked it to keep was not passed on.` : "";
  return {
    reply: `**Compacted.** ${agentName} compacted its own context (${span})${figures}${d.ms ? `, in ${dur(d.ms)}` : ""}. ${undo}${untold}`,
    note: `acp: chat command ${typed} answered by Filament, which asked ${agentName} to compact its own context`,
  };
}

/**
 * The tokens `/autocompact`'s argument names — `400k`, `1m`, `400,000`, `400000` — or "auto"; null for anything else.
 * @param {string} arg @returns {number | "auto" | null}
 */
export function compactPointOf(arg) {
  const t = String(arg || "").trim().toLowerCase().replace(/[,_\s]/g, "").replace(/tokens?$/, "");
  if (t === "auto") return "auto";
  const m = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(t);
  if (!m) return null;
  const n = Math.round(Number(m[1]) * (m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1_000 : 1));
  return n > 0 ? n : null;
}

/**
 * A harness chat's `/autocompact [auto|<tokens>]` (HarnessV4_Tasks C33). It is a coding agent's own word for where it
 * makes room (Claude Code's), and in a harness chat that point is the session's compaction line: Filament opens every
 * session of the chat with it, so a value typed to the agent alone would last until its session is next opened. So
 * Filament takes the word in every agent's chat and keeps it as the session's line; alone, it says the line.
 * @param {AppDeps} deps @param {AgentCommandContext} ctx
 * @returns {AgentCommandResult}
 */
function lineCommand(deps, { chain, cmd, agentName }) {
  const n = (/** @type {number | null} */ v) => (v == null ? "" : v.toLocaleString());
  const where = (/** @type {{ percent: number, tokens: number | null, window: number | null }} */ l) =>
    l.window ? `${n(l.tokens)} tokens, ${l.percent}% of the ${n(l.window)}-token window` : `${l.percent}% of the window, which nobody has named yet`;
  const kept = `It is this session's own: every ${agentName} session this chat opens is opened with it, and the Context meter shows it. \`/autocompact auto\` gives it back to your default.`;
  if (!cmd[2]) {
    const l = deps.sessions.lineOf(String(chain));
    return { reply: `This session's compaction line is ${where(l)}${l.own ? "" : " (your default)"}. \`/autocompact 400k\` sets it in tokens for this session; the Context meter's line is the same setting.` };
  }
  const asked = compactPointOf(cmd[2]);
  if (asked == null) return { reply: "Usage: `/autocompact <tokens>` (`400k`, `1m`, `400000`) sets this session's compaction line; `/autocompact auto` gives it back to your default; `/autocompact` alone says it." };
  try {
    const l = asked === "auto" ? deps.sessions.lineOf(String(chain), { auto: true }) : deps.sessions.lineOf(String(chain), { tokens: asked });
    if (asked === "auto") return { reply: `This session's compaction line follows your default again: ${where(l)}.` };
    const rounded = l.tokens !== asked ? ` The line is kept as a whole percent of the window, so ${n(asked)} reads as ${n(l.tokens)}.` : "";
    return { reply: `**The compaction line is ${where(l)}.**${rounded} ${kept}` };
  } catch (/** @type {any} */ e) {
    return { reply: `**The line was not changed:** ${e.message}.` };
  }
}

/**
 * Answers one agent-chat command.
 * @param {AppDeps} deps
 * @param {AgentCommandContext} ctx
 * @returns {Promise<AgentCommandResult>}
 */
export async function answerAgentCommand(deps, ctx) {
  const { config, usage, health } = deps;
  const {
    cmd,
    rec,
    bridge,
    upstream,
    acp,
    format,
    body,
    inboundHeaders,
    route,
    modelId,
    agentName,
    conversationId,
  } = ctx;
  const verb = cmd[1].toLowerCase();
  const prefix = (route.match || "").replace(/\*.*$/, "");
  const peek = () =>
    bridge.peekByRequest({
      upstream,
      format,
      body,
      cwdHint: inboundHeaders["x-filament-cwd"],
      conversationId,
    });
  const conv0 = peek();
  if (verb === "sessions") {
    // The chat's request goes with it: Cursor's SDK lists agents by folder, the chat's too (the bug report's X6).
    const l = await bridge.listSessions(upstream, { format, body, cwdHint: inboundHeaders["x-filament-cwd"] });
    if (!(l.ok && l.sessions.length))
      return { reply: `${agentName} reported no sessions${l.error ? ` (${l.error})` : ""}.` };
    const rows = l.sessions.slice(0, 30).map((x, i) => {
      const id8 = String(x.sessionId).slice(0, 8);
      const title = String(x.title || "untitled")
        .replace(/\s+/g, " ")
        .slice(0, 80);
      const name = title
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2)
        .slice(0, 2)
        .join(" ");
      return `${i + 1}. **${title}**${x.cwd ? ` — ${x.cwd}` : ""}${x.updatedAt ? ` — ${ago(x.updatedAt)}` : ""}\n   → \`/resume ${id8}\`${name && x.title ? ` or \`/resume ${name}\`` : ""} · id ${id8}`;
    });
    const here = conv0?.title
      ? `“${String(conv0.title).slice(0, 60)}” (${String(conv0.sessionId).slice(0, 8)})`
      : conv0
        ? `session ${String(conv0.sessionId).slice(0, 8)}`
        : "no session yet";
    return {
      reply:
        `**Chats ${agentName} knows about** (newest first; ${l.sessions.length} total${l.sessions.length > 30 ? ", 30 shown" : ""}):\n\n` +
        rows.join("\n") +
        `\n\nThis chat is on ${here}. \`/resume\` takes the id or distinctive words from the title; from a brand-new chat use a model name like \`${prefix}${modelId}#${String(l.sessions[0].sessionId).slice(0, 8)}\`. A chat still open in a terminal must be closed there first; \`/new\` starts a fresh one.`,
    };
  }
  if (verb === "new") {
    bridge.forgetByRequest({
      upstream,
      format,
      body,
      cwdHint: inboundHeaders["x-filament-cwd"],
      conversationId,
    });
    return {
      reply: `Started over: your next message opens a fresh ${agentName} session. The earlier messages in this window are not sent along.`,
    };
  }
  if (verb === "status" || verb === "help") {
    const conv = peek();
    if (verb === "status" && hasCmd(conv, "status")) return { reply: null }; // the agent has its own /status
    const hb = health.snapshot()[upstream.id];
    const ctxUse = conv?.context;
    const pi = bridge.processInfo(upstream.id);
    const sessRecs = conv
      ? usage.records.filter((r) => r.acp?.sessionId === conv.sessionId && spentIn(r))
      : [];
    const sessTok = sessRecs.reduce(
      (a, r) => ({
        in: a.in + (r.tokens?.input || 0) + (r.tokens?.cacheRead || 0) + (r.tokens?.cacheWrite || 0),
        out: a.out + (r.tokens?.output || 0),
        cost: a.cost + (r.cost || 0),
        list: a.list + (typeof r.listCost === "number" ? r.listCost : 0),
        exact: a.exact && !r.estimatedTokens,
      }),
      { in: 0, out: 0, cost: 0, list: 0, exact: sessRecs.length > 0 },
    );
    // What the session cost: what it paid, else what a plan paid for, at the API's prices.
    const spent = sessTok.cost ? ` · $${sessTok.cost.toFixed(4)}` : sessTok.list ? ` · $${sessTok.list.toFixed(4)} at list price, paid by the plan` : "";
    // Who the agent runs as, in the one identity every agent's account takes (HarnessV3-ACP AC3-6), and how its login
    // pays as the agent's word on it says (a Cursor key bills its owner's plan).
    const id = pi?.identity;
    const authLine =
      id && id.kind !== "none"
        ? `${id.label}${id.email || id.detail ? ` (${id.email || id.detail})` : ""}${
            id.billing === "plan"
              ? id.kind === "account"
                ? " · subscription"
                : " · billed to its owner's plan"
              : id.billing === "metered"
                ? id.kind === "api-key"
                  ? " · pay-per-token API key, not a subscription"
                  : " · billed by use"
                : ""
          }`
        : null;
    const lines = [
      `**Filament status for this chat**`,
      `- ${agentName}${pi?.agent?.version ? ` ${pi.agent.version}` : ""}${pi?.agent?.name ? ` (${pi.agent.name})` : ""}${pi ? ` · ${pi.processes} running process${pi.processes === 1 ? "" : "es"}` : " · not running yet"}`,
      authLine
        ? `- signed in as: ${authLine}`
        : id?.kind === "none"
          ? `- signed in: no, the agent says nobody is signed in`
          : `- signed in: ${known(upstream.id)?.account || "the agent's own login"}`,
      conv
        ? `- this session: ${sessRecs.length} Filament request(s) · ${sessTok.in.toLocaleString()} in / ${sessTok.out.toLocaleString()} out tokens${sessTok.exact ? "" : " (estimated)"}${spent}`
        : null,
      (acp.mcpServers || []).length
        ? `- MCP servers passed to the agent: ${acp.mcpServers.map((m) => m.name || m.command).join(", ")}`
        : `- MCP servers passed to the agent: none (the agent's own MCP config still applies)`,
      `- agent: ${agentName} (${upstream.id})${acp.command ? ` · command \`${acp.command}${(acp.args || []).length ? " " + acp.args.join(" ") : ""}\`` : ""}`,
      `- route: \`${route.match}\` → model name \`${modelId}\`${conv?.modelId ? ` → agent model \`${conv.modelId}\`` : ""}`,
      conv
        ? `- agent session: ${conv.title ? `“${String(conv.title).slice(0, 60)}” ` : ""}(\`${String(conv.sessionId).slice(0, 8)}\`) · ${conv.turns} turn(s) so far · folder ${conv.cwd}${conv.resumedFrom ? " · resumed" : ""}`
        : `- agent session: none yet (your next real message opens one)`,
      `- mode: ${conv?.mode || acp.mode || "agent"} · permissions policy: ${acp.permissions || "allow-all"}${conv?.effort ? ` · effort: ${conv.effort}` : ""}`,
      ctxUse?.used
        ? `- agent context: ${ctxUse.used.toLocaleString()}${ctxUse.size ? ` of ${ctxUse.size.toLocaleString()} tokens (${Math.round((100 * ctxUse.used) / ctxUse.size)}%)` : " tokens"}`
        : `- agent context: not reported yet`,
      `- upstream health: ${hb?.coolingDown ? `cooling down ${Math.ceil(hb.cooldownLeftMs / 1000)} s` : hb?.quotaExceeded ? "quota exhausted" : "ok"} · failover ${config().rules.resilience?.failover === true ? "on" : "off"}${(route.fallbacks || []).length ? ` · backups: ${route.fallbacks.map((f) => f.upstream).join(", ")}` : ""}`,
      conv?.commands?.length
        ? `- agent commands published: ${conv.commands.length} (type them as /name)`
        : `- agent commands published: none yet`,
      ``,
      `Filament commands: \`/sessions\`, \`/resume <id>\`, \`/new\`, \`/compact\`, \`/clear\`, \`/status\`, \`/cost\`, \`/commands\`, \`/help\`, \`/autocompact\`; \`/compact\`, \`/clear\` and \`/status\` go to ${agentName} where it has its own. Other words starting with / go to ${agentName} as typed, but for the chat commands Filament answers first (COMMANDS.md).`,
      `Console: ${deps.selfBase ? deps.selfBase() : selfAddress(config().server)}/`,
    ];
    if (verb === "help") {
      lines.length = 0;
      lines.push(
        `**Commands you can type here**`,
        `- \`/sessions\` — chats ${agentName} knows about, with the id to resume`,
        `- \`/resume <id or title words>\` — continue one of them in this chat`,
        `- \`/new\` — start a fresh agent session`,
        `- \`/status\` — this chat's agent, model, mode, effort, context fill, upstream health; passed to ${agentName} where it has its own`,
        `- \`/compact [what to keep]\` — ${agentName} compacts its own context where it can, listed with Undo; else explained, or passed to it where it has its own`,
        `- \`/clear\` — explained (the agent manages its own context), or passed to it where it has its own`,
        `- model-name tricks: \`${prefix}<model>-xhigh\` (effort), \`${prefix}<model>@plan\` (mode), \`${prefix}<model>#<id>\` (resume)`,
        `- \`/commands\` — every command ${agentName} offers, with what each one does`,
        `- \`/cost\` — this session's cost, durations, code changes, usage by model, cache stats (like Claude CLI's /cost)`,
        conv?.commands?.length
          ? `\n**${agentName}'s own commands** (${conv.commands.length}): ${cmdList(conv)
              .slice(0, 60)
              .map((c) => "/" + c.name)
              .join(", ")}${conv.commands.length > 60 ? ", …" : ""}. Type \`/commands\` for descriptions.`
          : `\n${agentName} has not published its own commands to this session yet; \`/commands\` asks it directly.`,
      );
    }
    return { reply: lines.filter((l) => l != null).join("\n") };
  }
  if (verb === "cost") {
    // Claude CLI's /cost, computed from Filament's own records for this agent session.
    const conv = peek();
    if (!conv)
      return {
        reply: "No agent session for this chat yet, so nothing has been spent. Send a real message first.",
      };
    const recs = usage.records
      .filter((r) => r.acp?.sessionId === conv.sessionId)
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    const spent = recs.filter(spentIn);
    const totalCost = spent.reduce((a, r) => a + (r.cost || 0), 0);
    // What the turns were worth at the API's prices, where a plan paid them (the agent's own figure): said apart.
    const listed = listedOf(spent);
    const exact = spent.length > 0 && spent.every((r) => !r.estimatedTokens);
    const apiMs = spent.reduce((a, r) => a + (r.totalMs || 0), 0);
    const wallMs = recs.length ? Date.now() - new Date(recs[0].ts).getTime() : 0;
    const added = spent.reduce((a, r) => a + (r.acp?.linesAdded || 0), 0),
      removed = spent.reduce((a, r) => a + (r.acp?.linesRemoved || 0), 0);
    /** @type {Map<string, { input: number, output: number, cacheRead: number, cacheWrite: number, cost: number }>} */
    const byModel = new Map();
    for (const r of spent) {
      const rows = r.acp?.modelUsage?.length
        ? r.acp.modelUsage
        : [
            {
              model: conv.modelId || r.upstreamModel || r.model,
              input: r.tokens?.input || 0,
              output: r.tokens?.output || 0,
              cacheRead: r.tokens?.cacheRead || 0,
              cacheWrite: r.tokens?.cacheWrite || 0,
            },
          ];
      for (const m of rows) {
        const b = byModel.get(m.model) || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
        b.input += m.input;
        b.output += m.output;
        b.cacheRead += m.cacheRead;
        b.cacheWrite += m.cacheWrite;
        if (rows.length === 1) b.cost += r.cost || 0;
        byModel.set(m.model, b);
      }
    }
    // The newest call that reached the agent's model; a refusal touched no cache.
    const lastAt = spent.length ? new Date(spent[spent.length - 1].ts).getTime() : 0;
    const idle = lastAt ? Date.now() - lastAt : 0;
    /** @param {string} l */
    const pad = (l) => l.padEnd(23);
    const lines = [
      `**Cost for this ${agentName} session \`${String(conv.sessionId).slice(0, 8)}\`** (${spent.length} request${spent.length === 1 ? "" : "s"} through Filament)`,
      "```",
      `${pad("Total cost:")}$${totalCost.toFixed(4)}${exact ? "" : " (estimated)"}`,
      ...(listed.differs ? [`${pad("At list price:")}$${listed.usd.toFixed(4)}`, ...(listed.plan > 0 ? [`${pad("Saved by plans:")}$${listed.plan.toFixed(4)}`] : [])] : []),
      `${pad("Total duration (API):")}${dur(apiMs)}`,
      `${pad("Total duration (wall):")}${dur(wallMs)}`,
      `${pad("Total code changes:")}${added} lines added, ${removed} lines removed${added || removed ? " (from the agent's edit diffs)" : ""}`,
      `Usage by model:`,
      ...[...byModel.entries()].map(
        ([m, b]) =>
          `    ${m}:  ${k(b.input)} input, ${k(b.output)} output, ${k(b.cacheRead)} cache read, ${k(b.cacheWrite)} cache write${b.cost ? ` ($${b.cost.toFixed(4)})` : ""}`,
      ),
      `${pad("Prompt cache:")}${spent.length} requests · ${cacheWords(spent)} · last activity ${dur(idle)} ago`,
      "```",
      exact
        ? `Numbers come from ${agentName} itself.`
        : `${agentName} reports no usage, so tokens are estimated locally and cost is what the agent's subscription covers.`,
      conv.resumedFrom ? `This session was resumed; turns before Filament attached are not counted.` : null,
    ].filter(Boolean);
    return { reply: lines.join("\n") };
  }
  if (verb === "commands") {
    const conv = peek();
    let list = cmdList(conv);
    let source = "published to this chat";
    if (!list.length) {
      const o = await bridge.offer(upstream);
      list = (o.ok ? o.commands : []).map((c) => ({
        name: c.name,
        description: c.description || "",
        hint: c.hint || "",
      }));
      source = o.ok ? "asked the agent just now" : `could not ask the agent: ${o.error}`;
    }
    const mine = [
      ["sessions", "chats the agent knows about, with the id to resume"],
      ["resume <id>", "continue one of them in this chat"],
      ["new", "start a fresh agent session"],
      ["status", "this chat's agent, model, mode, effort, context fill, upstream health"],
      ["commands", "this list"],
      ["cost", "cost, durations, code changes, usage by model, cache stats for this session"],
      ["help", "short overview"],
      ["compact [what to keep]", "the agent's own compaction where it has one, listed with Undo; else explained, or passed to the agent where it has its own"],
      ["autocompact [<tokens>|auto]", "this session's compaction line in tokens (`/autocompact 400k`): every session this chat opens is opened with it"],
      ["clear", "explained, or passed to the agent where it has its own; the agent manages its own context"],
    ];
    /** @param {{ name: string, description: string, hint: string }} c */
    const fmtCmd = (c) =>
      `- \`/${c.name}${c.hint ? " " + c.hint : ""}\`${c.description ? ` — ${String(c.description).replace(/\s+/g, " ").slice(0, 160)}` : ""}`;
    return {
      reply: [
        `**${agentName}: ${list.length} command${list.length === 1 ? "" : "s"}** (${source}). Type them exactly as shown; the agent runs them itself.`,
        list.length
          ? list.map(fmtCmd).join("\n")
          : `None${/could not/.test(source) ? "" : " yet. Some agents (Cursor) publish their commands only after the first real message; ask again after one."}`,
        ``,
        `**Filament's own** (answered here; \`/resume\` then has the agent recap, \`/compact\` has it compact its own context, and \`/status\`, \`/compact\` and \`/clear\` go to it where it has its own):`,
        mine.map(([n, d]) => `- \`/${n}\` — ${d}`).join("\n"),
        ``,
        `Model-name tricks: \`${prefix}<model>-xhigh\` sets effort, \`${prefix}<model>@plan\` sets the mode, \`${prefix}<model>#<id>\` resumes a session.`,
      ].join("\n"),
    };
  }
  if (verb === "autocompact") return lineCommand(deps, ctx);
  if (verb === "compact" || verb === "clear") {
    // `/compact`: the session's own compaction, where the agent has one Filament can ask for now.
    if (verb === "compact") {
      const own = await compactOwn(deps, ctx);
      if (own) return own;
    }
    const conv = peek();
    if (hasCmd(conv, verb)) return { reply: null }; // the agent offers this command itself: pass the text through
    const ctxUse = conv?.context;
    const held = ctxUse?.used
      ? `Its context is at ${ctxUse.used.toLocaleString()}${ctxUse.size ? ` of ${ctxUse.size.toLocaleString()} tokens (${Math.round((100 * ctxUse.used) / ctxUse.size)}%)` : " tokens"}.`
      : "It has not reported its context size yet.";
    const itself = upstream.id === "claude-code" ? " Claude Code compacts itself automatically when it gets full." : "";
    // Filament makes room on its copy of the chat (Compact now), and the agent's next session starts from it
    // (HarnessV3-ACP AC5-1).
    if (verb === "compact")
      return { reply: `${agentName} has no compaction of its own that Filament can ask for now. ${held}${itself} Compact now makes room on Filament's copy of the chat instead — your next message then starts a fresh session from it — or send \`/new\` to start an empty one.` };
    return {
      reply: `${agentName} manages its own context window, so there is nothing for Filament to clear. ${held}${itself} Send \`/new\` to start a fresh agent session instead.`,
    };
  }
  // /resume
  if (!cmd[2])
    return { reply: "Usage: `/resume <session id or its first characters>`. Send `/sessions` to list them." };
  let at;
  try {
    at = await bridge.attach({
      upstream,
      modelId,
      format,
      body,
      cwdHint: inboundHeaders["x-filament-cwd"],
      conversationId,
      sessionId: cmd[2],
      headers: inboundHeaders,
    });
  } catch (/** @type {any} */ e) {
    return { reply: null, error: e.message };
  }
  if (!at.ok) {
    (rec.priorChanges ||= []).push(`acp: /resume ${cmd[2]} failed: ${at.raw || at.error}`);
    return {
      reply: `Could not attach to session \`${cmd[2]}\`: ${at.error}\n\nThis chat keeps its current session. \`/sessions\` lists what can be resumed.`,
    };
  }
  // The session the chat held, where an undo brought the chat back to one from before it: the chat goes on in that one,
  // and the one it held is let go (`undone`).
  const undone = at.undone ? String(at.undone).slice(0, 8) : "";
  (rec.priorChanges ||= []).push(
    `acp: /resume attached this chat to session ${at.session.sessionId.slice(0, 8)}${at.session.title ? ` “${String(at.session.title).slice(0, 60)}”` : ""} in ${at.cwd}${undone ? `, from before the compaction undone (session ${undone} let go)` : ""}`,
  );
  return {
    reply: null,
    intro: `Attached to **${String(at.session.title || "untitled").slice(0, 80)}** (${at.session.sessionId.slice(0, 8)}) in ${at.cwd}${undone ? ` — the session from before the compaction you undid; session ${undone} is let go` : ""}.\n\n`,
    body: {
      ...body,
      messages: body.messages.map((m, i, arr) =>
        i === arr.length - 1 && m.role === "user"
          ? {
              ...m,
              content:
                "In one or two short lines, remind me where we left off in this conversation, then wait for my next message.",
            }
          : m,
      ),
    },
  };
}

/**
 * A `/word` Filament does not answer — none of its own, or one of its own an outside client sent (`outside`: those
 * are its own chats' alone) — passed to the agent as text; the record says which, and whether the agent has published
 * such a command.
 * @param {{ rec: any, bridge: any, upstream: any, format: string, body: any, inboundHeaders: Record<string, string>, conversationId: string | null, lastUserText: string, outside?: boolean }} ctx
 */
export function noteForeignCommand({
  rec,
  bridge,
  upstream,
  format,
  body,
  inboundHeaders,
  conversationId,
  lastUserText,
  outside = false,
}) {
  const otherCmd = slashWordOf(lastUserText);
  if (!otherCmd) return;
  const conv0 = bridge.peekByRequest({
    upstream,
    format,
    body,
    cwdHint: inboundHeaders["x-filament-cwd"],
    conversationId,
  });
  const published = cmdList(conv0).map((c) => c.name);
  (rec.priorChanges ||= []).push(
    published.includes(otherCmd[1])
      ? `acp: /${otherCmd[1]} is a command published by the agent; passed through`
      : outside && parseAgentCommand(lastUserText)
        ? `acp: /${otherCmd[1]} is Filament's in its own chats; an outside client's goes to the agent as text${published.length ? ` (not among the ${published.length} the agent published)` : ""}`
        : `acp: /${otherCmd[1]} is not a Filament command${published.length ? ` and not among the ${published.length} the agent published` : ""}; sent to the agent as text`,
  );
}
