// @ts-check
// `/status`, `/cost` and `/help` typed in a chat that talks to an API model: answered by Filament from its own records
// and a dry run of the request (agent chats have more, see commands/acp.js).
import { renderUpstreamModel } from "../../core/routing.js";
import { clientConversationId, chainRefOf } from "../../core/conversation.js";
import { answeredByFilament, billedByChildren, spentIn } from "../../core/turn-facts.js";
import { cacheSaid, promptOf } from "../../core/cache-facts.js";
import { answerWith, openCommandRecord } from "./answer.js";
import { selfAddress } from "../../services/config/store.js";

const COMMAND_RE = /^\/(status|cost|help)\s*$/i;

/** The command the newest message is, or null; `[1]` is the verb. @param {string} lastUserText */
export const parseStatusCommand = (lastUserText) => COMMAND_RE.exec(lastUserText);

/** @param {number} ms */
const dur = (ms) => {
  ms = Math.max(0, Math.round(ms));
  const s = Math.floor(ms / 1000),
    mi = Math.floor(s / 60),
    h = Math.floor(mi / 60),
    d = Math.floor(h / 24);
  return d
    ? `${d}d ${h % 24}h ${mi % 60}m`
    : h
      ? `${h}h ${mi % 60}m ${s % 60}s`
      : mi
        ? `${mi}m ${s % 60}s`
        : `${(ms / 1000).toFixed(1)}s`;
};
/** @param {number} n */
const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
/** @param {string} l */
const pad = (l) => l.padEnd(23);

/**
 * What `/cost`'s cache line says of a chat's model calls: the share of their prompts read from the cache and the cold
 * starts among them, of the calls whose usage said its cache numbers (core/cache-facts.js) — of how many, where some
 * said none —, and that none were reported where no call said any: never a 0% nothing counted.
 * @param {any[]} recs  the chat's requests that reached a model
 */
export function cacheWords(recs) {
  const said = recs.filter((r) => cacheSaid(r.tokens));
  if (!said.length) return "no cache numbers reported";
  const prompt = said.reduce((a, r) => a + promptOf(r.tokens), 0);
  const read = said.reduce((a, r) => a + (Number(r.tokens?.cacheRead) || 0), 0);
  const misses = said.filter((r) => (r.tokens?.cacheWrite || 0) > 0 && !(r.tokens?.cacheRead || 0)).length;
  const of = said.length < recs.length ? `, of the ${said.length} request${said.length === 1 ? "" : "s"} that reported cache numbers` : "";
  return `${Math.round((100 * read) / prompt)}% of input tokens from cache${of} · ${misses} miss${misses === 1 ? "" : "es"}`;
}

/**
 * The chat's list-price figure beside what it paid (Providers P4): the same tokens at the price card, the part of it
 * a plan paid instead, how many requests have none, and whether it says anything the paid figure does not — a chat
 * billed per token at the card says one figure.
 * @param {any[]} recs
 */
export function listedOf(recs) {
  let usd = 0, plan = 0, missing = 0, paid = 0;
  for (const r of recs) {
    // A turn's parent (the agent loop's) is billed by its rounds: its own $0 and absent list price are neither a
    // figure nor a gap.
    if (billedByChildren(r)) continue;
    paid += Number(r.cost) || 0;
    if (typeof r.listCost !== "number") {
      missing++;
      continue;
    }
    usd += r.listCost;
    if (r.billing === "plan") plan += r.listCost;
  }
  return { usd, plan, missing, differs: missing < recs.length && Math.abs(usd - paid) > 1e-9 };
}

/**
 * The chat's requests, oldest first: its own when the client names the chat; else, for a session Filament knows (the
 * harness's), the records whose spend books on that session — its rounds by their parent turn's chain, as the Spend
 * widget counts them (HarnessV3-FixRound decision 3); else the last 24 hours'. A turn's parent (the agent loop's) is
 * no model call — its rounds are counted, and its tokens and time are theirs added up — so it is left out: `/cost`
 * read every agent turn twice (backlog 20). Every request that spent counts, a hung-up stream's too, as the Spend
 * widget counts it; one refused before a model spent on it is none (`spentIn`).
 * @param {any[]} records @param {string | null | undefined} sid @param {number} [now]
 * @param {{ chainId: string, chainOf: (r: any) => string | null } | null} [session]
 */
export function chatRecordsOf(records, sid, now = Date.now(), session = null) {
  const inChat = sid
    ? (/** @type {any} */ r) => r.clientSession === sid
    : session?.chainId
      ? (/** @type {any} */ r) => session.chainOf(r) === session.chainId
      : (/** @type {any} */ r) => new Date(r.ts).getTime() > now - 86400000;
  return records
    .filter((r) => spentIn(r) && !billedByChildren(r) && inChat(r))
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

/**
 * @param {import("../pipeline/context.js").RequestContext} ctx
 * @param {import("../deps.js").AppDeps} deps
 * @param {{ verb: string, primaryUp: any }} args  the verb typed and the route's primary upstream
 */
export function answerStatusCommand(ctx, deps, { verb, primaryUp }) {
  const { config, usage, health, memory, dryRun } = deps;
  const { format, body, route, requested, headers } = ctx;
  const cfg = config();
  // The console is where Filament listens now: a port saved since waits for a restart.
  const base = deps.selfBase ? deps.selfBase() : selfAddress(cfg.server);
  const sid = clientConversationId(headers);
  // No client id: a harness chat is still "this chat" — by the chain its turns name in Filament's own header. An
  // outside client that sends no id keeps the 24-hour reading: the session memory guessed for it is no chat it named.
  const chainId = !sid ? chainRefOf(headers) || null : null;
  const session = chainId ? { chainId, chainOf: (/** @type {any} */ r) => memory.sessionChainOf?.(r) || null } : null;
  const scoped = !!(sid || session);
  const upName = primaryUp.name || primaryUp.id;
  const chatRecs = chatRecordsOf(usage.records, sid, Date.now(), session);
  let text;
  if (verb === "cost") {
    const totalCost = chatRecs.reduce((a, r) => a + (r.cost || 0), 0);
    const listed = listedOf(chatRecs);
    const apiMs = chatRecs.reduce((a, r) => a + (r.totalMs || 0), 0);
    const wallMs = chatRecs.length ? Date.now() - new Date(chatRecs[0].ts).getTime() : 0;
    /** @type {Map<string, { input: number, output: number, cacheRead: number, cacheWrite: number, cost: number, list: number, n: number }>} */
    const byModel = new Map();
    for (const r of chatRecs) {
      if (answeredByFilament(r)) continue; // no model's: a line of 0 tokens under Filament's own name is noise
      const key = r.upstreamModel || r.model;
      const b = byModel.get(key) || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, list: 0, n: 0 };
      b.input += r.tokens?.input || 0;
      b.output += r.tokens?.output || 0;
      b.cacheRead += r.tokens?.cacheRead || 0;
      b.cacheWrite += r.tokens?.cacheWrite || 0;
      b.cost += r.cost || 0;
      b.list += typeof r.listCost === "number" ? r.listCost : 0;
      b.n++;
      byModel.set(key, b);
    }
    const idle = chatRecs.length ? Date.now() - new Date(chatRecs[chatRecs.length - 1].ts).getTime() : 0;
    const own = chatRecs.filter(answeredByFilament).length;
    const modelCalls = chatRecs.length - own; // the cache is a model's: Filament's own answers never reach one
    text = [
      `**Cost for ${scoped ? "this chat" : "the last 24 hours (this client sends no chat id)"}** (${chatRecs.length} request${chatRecs.length === 1 ? "" : "s"} through Filament${own ? `, ${own} of them answered by Filament itself` : ""})`,
      "```",
      `${pad("Total cost:")}$${totalCost.toFixed(4)}`,
      ...(listed.differs
        ? [
            `${pad("At list price:")}$${listed.usd.toFixed(4)}${listed.missing ? ` (${listed.missing} request${listed.missing === 1 ? "" : "s"} without a list price)` : ""}`,
            ...(listed.plan > 0 ? [`${pad("Saved by plans:")}$${listed.plan.toFixed(4)}`] : []),
          ]
        : []),
      `${pad("Total duration (API):")}${dur(apiMs)}`,
      `${pad("Total duration (wall):")}${dur(wallMs)}`,
      `Usage by model:`,
      ...[...byModel.entries()].map(
        ([mm, b]) =>
          `    ${mm}:  ${k(b.input)} input, ${k(b.output)} output, ${k(b.cacheRead)} cache read, ${k(b.cacheWrite)} cache write ($${b.cost.toFixed(4)}${listed.differs && Math.abs(b.list - b.cost) > 1e-9 ? ` paid · $${b.list.toFixed(4)} at list` : ""}, ${b.n} request${b.n === 1 ? "" : "s"})`,
      ),
      `${pad("Prompt cache:")}${modelCalls} request${modelCalls === 1 ? "" : "s"} · ${cacheWords(chatRecs.filter((r) => !answeredByFilament(r)))} · last activity ${dur(idle)} ago`,
      "```",
      `Costs use each model's price card (its upstream's, else Filament's built-in rates); the provider's invoice is the truth.${listed.differs ? " The cost is what was paid — $0 on a subscription plan; at list price is the same tokens at the price card." : ""} Code changes are made by your client, not the model, so they are not counted here.`,
    ].join("\n");
  } else if (verb === "status") {
    const hb = health.snapshot()[primaryUp.id];
    let dry = null;
    try {
      dry = dryRun({ format, body }, cfg);
    } catch {}
    const spent = chatRecs.reduce((a, r) => a + (r.cost || 0), 0);
    const listed = listedOf(chatRecs);
    text = [
      `**Filament status for this chat**`,
      `- model name: \`${body.model}\` → route \`${route.match}\` → **${upName}** (${primaryUp.type}) receives \`${dry?.body?.model || renderUpstreamModel(route.upstreamModel, requested.base, route.captures || [])}\``,
      dry?.changes?.length
        ? `- what Filament changes on this request: ${dry.changes.join("; ")}`
        : `- what Filament changes on this request: nothing`,
      `- ${scoped ? "this chat" : "last 24 h"}: ${chatRecs.length} request(s) · $${spent.toFixed(4)}${listed.differs ? ` paid · $${listed.usd.toFixed(4)} at list price` : ""}`,
      `- upstream health: ${hb?.coolingDown ? `cooling down ${Math.ceil(hb.cooldownLeftMs / 1000)} s` : hb?.quotaExceeded ? "quota exhausted" : "ok"} · failover ${cfg.rules.resilience?.failover === true ? "on" : "off"}${(route.fallbacks || []).length ? ` · backups: ${route.fallbacks.map((f) => f.upstream).join(", ")}` : " · no backups on this route"}`,
      ``,
      `Commands here: \`/status\`, \`/cost\`, \`/help\`. Effort: add \`-low\` … \`-max\` to the model name or use your client's picker; \`-fast\` for Anthropic fast mode where supported. Filament's chats with a coding agent (Cursor, Claude Code…) also have \`/sessions\`, \`/resume\`, \`/new\`, \`/commands\`.`,
      `Console: ${base}/`,
    ].join("\n");
  } else {
    text = [
      `**Commands you can type in this chat**`,
      `- \`/status\` — where this model name goes, what Filament changes, this chat's spend, upstream health`,
      `- \`/cost\` — cost, durations, usage by model and cache stats for this chat`,
      ...(ctx.memory?.session?.composed ? [`- \`/compact\` — compact this session now, its own way: one summary, or the instant fold; Undo until the next message`] : []),
      `- \`/settings [all|<name>]\` — what is in force in this chat and where each value came from; \`/set <name> <value>\` and \`/unset <name>\` change one setting for this session`,
      `- \`/help\` — this list`,
      ``,
      `Model-name tricks: \`${body.model.replace(/-(low|medium|high|xhigh|max)$/i, "")}-xhigh\` (effort), \`…-fast\` (Anthropic fast mode on Opus). Filament's chats with a coding agent (Cursor, Claude Code, Qoder, Codex) also have \`/sessions\`, \`/resume\`, \`/new\`, \`/commands\`, \`/compact\`.`,
      `Every command, explained: the console's Docs → Commands page, ${base}/#docs:cmd-chat`,
    ].join("\n");
  }
  const rec = openCommandRecord(ctx, deps, { upstream: primaryUp.id, trace: false });
  answerWith(ctx, deps, rec, text, {
    changes: [`chat command /${verb} answered by Filament, upstream not called`],
  });
}
