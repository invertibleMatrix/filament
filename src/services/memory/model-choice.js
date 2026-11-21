// @ts-check
// Memory's model (the memory plan's m1, the owner's of 11-07): the one the person set in Settings › Memory › Model
// first — a dedicated model for memory —; unset, the side model they named for the chat's compactions; else the chat's
// own model (a sub-agent's findings learn on the chat that launched it, the curator on the project's newest chat); else
// the model of the most recently active chat anywhere — the model new chats start on is the harness's own pick, kept in
// the browser, so the server reads the one last chatted on —; else none, said. Never "the cheapest model with a price": what reads a project's
// transcripts is a provider the person chose for it. A fallback that names a coding agent's model — no plain
// completion, an agent with hands of its own on its own plan — stands as the same model through a route to a provider
// where one serves it, else is passed over. Pure: the service reads the settings, this weighs them.
import { findRoute, findUpstream, renderUpstreamModel } from "../../core/routing.js";
import { isAgentUpstream } from "../../core/schema.js";
import { parseModelSuffix } from "../../core/shaping.js";

/** The effort memory's calls run at where the person set none: memory reads and files, it does not solve. */
export const MEMORY_EFFORT = "low";

/**
 * Where memory's model came from: the person's pick in Settings › Memory, the chat's compaction model, the chat's own,
 * the most recently active chat's (`default`); `off` where the person turned memory's model off, `none` where nothing
 * serves.
 * @typedef {"memory" | "compaction" | "chat" | "default" | "off" | "none"} ModelFrom
 */

/**
 * A model memory can call as a plain completion: the name itself where its route goes to a provider; where it names a
 * coding agent's model, the model its route sends the agent, when a route to a provider serves that; "" where none does,
 * or its upstream is switched off. Read without the effort or fast suffix a chat's requests may carry: memory's calls go
 * at memory's own effort (`memoryEffort`), which a suffix would override.
 * @param {any} cfg @param {string} name @returns {string}
 */
export function plainModelOf(cfg, name) {
  const n = parseModelSuffix(String(name || "").trim(), cfg?.rules).base.trim();
  if (!n) return "";
  const r = findRoute(cfg || {}, n);
  const up = r ? findUpstream(cfg, r.upstream) : null;
  if (!up || up.enabled === false) return "";
  if (!isAgentUpstream(up)) return n;
  const sent = String(renderUpstreamModel(r.upstreamModel, n, r.captures || []) || "").trim();
  if (!sent || sent === n) return "";
  const r2 = findRoute(cfg, sent);
  const up2 = r2 ? findUpstream(cfg, r2.upstream) : null;
  return up2 && up2.enabled !== false && !isAgentUpstream(up2) ? sent : "";
}

/**
 * The model memory calls, and where it came from. `set`: memory.models.summarizer — a model, "" or `auto` unset, `off`
 * none; `compaction`: the chat's context.compaction.model; `chat`: the chat's own model; `fallback`: the most recently
 * active chat's model; `plain`: a fallback as memory can call it (`plainModelOf`), "" where none serves. Each fallback
 * may be a function, read only where the ones before it serve none. The person's own pick stands as they named it.
 * @typedef {string | (() => string)} Named
 * @param {{ set?: string, compaction?: Named, chat?: Named, fallback?: Named, plain: (name: string) => string }} o
 * @returns {{ model: string, from: ModelFrom }}
 */
export function chooseMemoryModel({ set = "", compaction = "", chat = "", fallback = "", plain }) {
  const s = String(set || "").trim();
  if (s === "off") return { model: "", from: "off" };
  if (s && s !== "auto") return { model: s, from: "memory" };
  /** @type {[Named, ModelFrom][]} */
  const chain = [
    [compaction, "compaction"],
    [chat, "chat"],
    [fallback, "default"],
  ];
  for (const [name, from] of chain) {
    const model = plain(String((typeof name === "function" ? name() : name) || "").trim());
    if (model) return { model, from };
  }
  return { model: "", from: "none" };
}

/**
 * Why memory has no model, in words a reply or a page can carry; "" where it has one.
 * @param {ModelFrom} from
 */
export function whyNoModelWords(from) {
  if (from === "off") return "memory's model is off (Settings › Memory › Model)";
  if (from === "none")
    return "no model to call: set one in Settings › Memory › Model, or chat on a model a provider serves (a coding agent's alone is no plain model)";
  return "";
}

/**
 * The effort memory's calls are sent at: the person's pick, `MEMORY_EFFORT` where they made none, null for `model`
 * (the model's own: no effort sent).
 * @param {string | null | undefined} set @returns {string | null}
 */
export function memoryEffort(set) {
  const e = String(set || "").trim().toLowerCase();
  if (e === "model") return null;
  return e || MEMORY_EFFORT;
}
