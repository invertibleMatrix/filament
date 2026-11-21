// @ts-check
// The catalogue as models, not ids: one row per model with its variants as parameters, the way a person picks one
// (Cursor's parameterized picker, Claude Code's `opus[1m]`). A provider or an agent that lists one id per variant
// (grok-4.7-high-fast, gpt-5.5-extra-high, kimi-k3-flex, k3-256k, opus[1m]) folds back into one family whose
// effort, speed, thinking and window are chosen by picking the member id; a plain API model's effort, fast mode and
// window are settings Filament applies (model.effort, model.fast, model.window), offered only where the model takes
// them — what model-caps.js resolves (the model's row on the Upstreams page, its provider's listing, the rules, the
// built-ins), narrowed by the rules, never wider. And the window a session works in when it chose one.
import { EFFORT_LEVELS, isMachineUpstream } from "./schema.js";
import { findRoute, findUpstream, renderUpstreamModel, priceCardFor, billingForModel } from "./routing.js";
import { bareModel } from "./shaping.js";
import { traitsOf } from "./model-traits.js";
import { capsAt, modelCapsFor, placeOfName } from "./model-caps.js";
import { fastMultiplierFor, windowMultipliersFor, priceCard, billingFor } from "./pricing.js";
import { providerForBaseUrl, isOtherModel } from "./providers.js";

/** Every effort word a catalogue spells, as Filament's level (`extra-high` is Cursor's `xhigh`), longest match first. */
const EFFORT_TOKENS = /** @type {const} */ ([["extra-high", "xhigh"], ["xhigh", "xhigh"], ["minimal", "minimal"], ["medium", "medium"], ["none", "none"], ["high", "high"], ["low", "low"], ["max", "max"]]);
/** The display order of every level a family may offer — Filament's five plus the catalogue-only none and minimal. */
export const LEVEL_ORDER = Object.freeze(["none", "minimal", ...EFFORT_LEVELS]);
const SPEED_TOKENS = /** @type {const} */ ([["highspeed", "fast"], ["speed", "fast"], ["fast", "fast"], ["flex", "flex"]]);
const SPEED_ORDER = Object.freeze(["standard", "fast", "flex"]);

/**
 * A catalogue id taken apart from its end: the base model and the variant words it carries, in any order
 * (`claude-opus-5-thinking-high-fast` → base claude-opus-5, thinking on, effort high, speed fast).
 * @param {unknown} id
 * @returns {{ base: string, effort: string | null, speed: "fast" | "flex" | null, thinking: "on" | "off" | null, window: number | null }}
 */
export function parseVariant(id) {
  let rest = String(id || "");
  /** @type {ReturnType<typeof parseVariant>} */
  const out = { base: rest, effort: null, speed: null, thinking: null, window: null };
  for (let guard = 0; guard < 5; guard++) {
    const low = rest.toLowerCase();
    const win = out.window == null ? /(?:\[(\d+(?:\.\d+)?)([km])\]|-(\d+(?:\.\d+)?)([km]))$/.exec(low) : null;
    if (win) {
      const n = Number(win[1] ?? win[3]);
      out.window = Math.round(n * ((win[2] ?? win[4]) === "m" ? 1_000_000 : 1000));
      rest = rest.slice(0, -win[0].length);
      continue;
    }
    const sp = out.speed == null ? SPEED_TOKENS.find(([w]) => low.endsWith(`-${w}`)) : null;
    if (sp) {
      out.speed = sp[1];
      rest = rest.slice(0, -(sp[0].length + 1));
      continue;
    }
    const ef = out.effort == null ? EFFORT_TOKENS.find(([w]) => low.endsWith(`-${w}`)) : null;
    if (ef) {
      out.effort = ef[1];
      rest = rest.slice(0, -(ef[0].length + 1));
      continue;
    }
    if (out.thinking == null) {
      const th = low.endsWith("-non-reasoning") ? ["-non-reasoning", "off"] : low.endsWith("-reasoning") ? ["-reasoning", "on"] : low.endsWith("-thinking") ? ["-thinking", "on"] : null;
      if (th) {
        out.thinking = /** @type {"on" | "off"} */ (th[1]);
        rest = rest.slice(0, -th[0].length);
        continue;
      }
    }
    break;
  }
  out.base = rest || String(id || "");
  return out;
}

/** @template T @param {T[]} xs @param {readonly T[]} order */
const ordered = (xs, order) => [...new Set(xs)].sort((a, b) => order.indexOf(a) - order.indexOf(b));

/** An agent that takes effort as a setting (Claude Code's adapter, Codex per turn) rather than in the model id. @param {any} up */
const agentTakesEffort = (up) => up?.type === "codex" || /claude-agent-acp/i.test(String(up?.acp?.command || ""));

/**
 * The effort levels a plain model is offered as the model.effort setting: the levels it takes (`caps`, the resolver's
 * answer where it lands — else the rules' caps and the built-in traits alone), narrowed by the rules' allowed levels
 * and to the ones Filament's suffix can carry. Null when nobody knows the model: the picker then offers no levels
 * rather than guessing.
 * @param {string} model the name as sent @param {any} rules @param {import("./model-caps.js").ModelCaps | null} [caps]
 * @returns {{ via: "setting", levels: string[], default: string | null, capWithoutThinking?: string } | null}
 */
export function effortOffer(model, rules, caps = null) {
  const eff = caps?.effort || capsAt({ rules }, null, bareModel(model) || "", rules).effort;
  if (!Array.isArray(eff.levels)) return null;
  const allowed = new Set(rules?.effort?.allowed || EFFORT_LEVELS);
  const suffixes = new Set((rules?.effort?.suffixes || EFFORT_LEVELS).map((/** @type {string} */ s) => String(s).toLowerCase()));
  const levels = EFFORT_LEVELS.filter((l) => eff.levels?.includes(l) && allowed.has(l) && suffixes.has(l));
  return levels.length ? { via: "setting", levels, default: eff.default || null } : null;
}

/**
 * The windows a model can work in (tokens, ascending, its standard one included), or [] when it has one.
 * @param {any} cfg @param {string} model
 */
export function windowOptionsFor(cfg, model) {
  return modelCapsFor(cfg, String(model || ""))?.window.options || [];
}

/**
 * The window a session works in: its model.window choice when the model offers that window, else the model's own.
 * `source: "session"` names the choice.
 * @param {any} cfg @param {string} model @param {unknown} chosen
 * @returns {{ tokens: number | null, source: "operator" | "agent" | "endpoint" | "builtin" | "session" | null }}
 */
export function sessionWindowFor(cfg, model, chosen) {
  const caps = modelCapsFor(cfg, String(model || ""));
  const base = caps ? { tokens: caps.window.standard, source: caps.window.standardSource } : { tokens: null, source: null };
  const want = Math.floor(Number(chosen) || 0);
  if (!want || want === base.tokens) return /** @type {any} */ (base);
  return caps?.window.options.includes(want) ? { tokens: want, source: "session" } : /** @type {any} */ (base);
}

/**
 * What a family's fast ids cost against its standard ones: the operator's word at that upstream (a row's
 * fastMultiplier — a subscription's quota counts the same way), else the ratio of their own prices when both are
 * priced apart. Null when nobody knows; the built-in API rates are no word about an id a provider sells its own way.
 * @param {any} cfg @param {any[]} kept @param {ReturnType<typeof parseVariant>[]} kv
 */
function variantFastMultiplier(cfg, kept, kv) {
  // A member id is the provider's own name, sent whole through its route (an agent's `-fast` id is not Filament's suffix).
  const whole = (/** @type {string} */ id) => {
    const route = findRoute(cfg, id);
    return route ? { up: findUpstream(cfg, route.upstream), sent: renderUpstreamModel(route.upstreamModel, id, route.captures || []) || id } : null;
  };
  const i = kv.findIndex((v) => v.speed === "fast");
  const fastAt = i >= 0 ? whole(kept[i].id) : null;
  if (!fastAt) return null;
  const own = fastMultiplierFor(fastAt.sent, fastAt.up?.pricing);
  if (own?.source === "operator" && own.value > 1) return own.value;
  const j = kv.findIndex((v) => !v.speed && v.effort === kv[i].effort && v.thinking === kv[i].thinking && v.window === kv[i].window);
  const stdAt = j >= 0 ? whole(kept[j].id) : null;
  const a = priceCard(fastAt.sent, fastAt.up?.pricing);
  const b = stdAt ? priceCard(stdAt.sent, stdAt.up?.pricing) : null;
  return a && b && b.output > 0 && a.output > b.output ? Math.round((a.output / b.output) * 100) / 100 : null;
}

/**
 * What each window of a family sold as names of its own costs against its cheapest window (Kimi's `k3` at 1M, twice
 * `k3-256k`): the operator's word on the family's row (`windowMultipliers`, window tokens → multiplier; a window it
 * does not name is 1), else the ratio of their own output prices when every window is priced apart. Keyed by the
 * family's window option (0 is the plain member's standard window); only a window dearer than the cheapest is listed.
 * Null when nobody knows.
 * @param {any} cfg @param {any[]} kept @param {ReturnType<typeof parseVariant>[]} kv
 * @returns {Record<string, number> | null}
 */
function variantWindowMultipliers(cfg, kept, kv) {
  // One member per window: the one plain on every other axis (a -fast twin's price is its speed's, not its window's).
  /** @type {Map<number, any>} */
  const byWindow = new Map();
  kept.forEach((m, i) => {
    const v = kv[i];
    if (!v.effort && !v.speed && !v.thinking && !byWindow.has(v.window || 0)) byWindow.set(v.window || 0, m);
  });
  if (byWindow.size < 2) return null;
  const placeOf = (/** @type {any} */ m) => {
    const route = findRoute(cfg, m.id);
    const up = route ? findUpstream(cfg, route.upstream) : null;
    return { up, sent: route ? renderUpstreamModel(route.upstreamModel, m.id, route.captures || []) || m.id : m.id };
  };
  const plain = byWindow.get(0) || [...byWindow.values()][0];
  const home = placeOf(plain);
  const stated = windowMultipliersFor(home.sent, home.up?.pricing);
  const at = [...byWindow].map(([w, m]) => {
    const { up, sent } = placeOf(m);
    // The window in tokens: a member's own, the plain member's standard one for option 0.
    const tokens = w || Number(m.context_window) || 0;
    return { w, stated: stated ? stated[String(tokens)] ?? null : null, price: priceCard(sent, up?.pricing) };
  });
  const weights = stated
    ? at.map((x) => x.stated ?? 1)
    : at.every((x) => Number(x.price?.output) > 0)
      ? at.map((x) => Number(x.price?.output))
      : null;
  if (!weights) return null;
  const least = Math.min(...weights);
  /** @type {Record<string, number>} */
  const out = {};
  at.forEach((x, i) => {
    const r = Math.round((weights[i] / least) * 100) / 100;
    if (r > 1) out[String(x.w)] = r;
  });
  return Object.keys(out).length ? out : null;
}

/**
 * What a family folded by some of its ids' words still takes as settings on every member: the axes its ids do not
 * spell are the settings' to offer, as for a model that stands alone — Kimi's `k3` and `k3-256k` fold by window, and
 * both take model.effort; folding must not lose it. An offer holds when every member makes it (effort: the levels all
 * of them take, the plain member's default); the plain member's words stand for the rest.
 * @param {Family} fam @param {Family[]} offers  each member as a model of its own (`plainFamily`) @param {number} lead
 * @param {{ effort: boolean, speed: boolean, thinking: boolean, window: boolean }} axes
 */
function carrySettings(fam, offers, lead, axes) {
  const first = offers[lead] || offers[0];
  if (!first) return;
  if (!axes.effort && offers.every((o) => o.effort)) {
    const own = /** @type {NonNullable<Family["effort"]>} */ (first.effort);
    const levels = own.levels.filter((l) => offers.every((o) => o.effort?.levels.includes(l)));
    if (levels.length) fam.effort = { via: "setting", levels, default: own.default && levels.includes(own.default) ? own.default : null, ...(own.capWithoutThinking ? { capWithoutThinking: own.capWithoutThinking } : {}) };
  }
  if (!axes.speed && offers.every((o) => o.speed && String(o.speed.options) === String(first.speed?.options))) fam.speed = first.speed;
  if (!axes.thinking && offers.every((o) => o.thinking)) fam.thinking = first.thinking;
  if (!axes.window && offers.every((o) => o.window && String(o.window.options) === String(first.window?.options))) fam.window = first.window;
}

/**
 * `label` and `note`: the model's name and description in its coding agent's own words, where its listing gave them
 * (HarnessV3-ACP AF2).
 * @typedef {{ id: string, effort: string | null, speed: string | null, thinking: string | null, window: number | null, context_window?: number }} FamilyMember
 * @typedef {{ id: string, upstream: string, kind: "variants" | "model" | "other", members: FamilyMember[],
 *   effort: { via: "name" | "setting", levels: string[], plain?: boolean, default: string | null, capWithoutThinking?: string } | null,
 *   speed: { via: "name" | "setting", options: string[], multiplier?: number, flexMultiplier?: number, wire?: "anthropic" | "openai" } | null,
 *   thinking: { via: "name" | "setting", options: string[] } | null,
 *   price?: { input: number, output: number } | null,
 *   window: { via: "name" | "setting", options: number[], standard: number | null, multipliers?: Record<string, number> } | null,
 *   context_window?: number, codingAgent?: boolean, billing?: "plan", label?: string, note?: string,
 *   noTools?: "operator" | "endpoint", onMachine?: string }} Family
 * `noTools`: the model takes no tools, and who said so — its row, or its provider's listing (HarnessV4_Tasks E4).
 * `onMachine`: another machine's model, by that machine's name (the remote-agents plan's m-ui) — said in a plan's place.
 */

/** Who said a model takes no tools, or nothing when it takes them. @param {any} caps  model-caps.js's answer */
const noToolsOf = (caps) => (caps && !caps.tools.available && caps.tools.source ? { noTools: caps.tools.source } : {});

/**
 * Another machine's model: the machine's name, which the picker says where it would say a plan — the upstream is
 * `billing: "plan"` so this machine counts no dollars for it, yet it runs on that machine's keys and sign-ins, no plan
 * of yours. Null for any other model. @param {any} cfg @param {any} m
 */
function machineOf(cfg, m) {
  const up = findUpstream(cfg, m?.upstream);
  return isMachineUpstream(up) ? { onMachine: String(up.name || up.id) } : null;
}

/**
 * Whether a catalogue row is a model that is not for chat — an embedding, rerank, speech, image or moderation model
 * (Providers P2): the provider's own words for them when the catalogue knows it (its `otherKinds`), else the common
 * ones. Such a row stands alone as `kind: "other"`: pickers leave it out, and its name still routes.
 * @param {any} cfg @param {any} m
 */
export function isOtherRow(cfg, m) {
  const up = findUpstream(cfg, m?.upstream);
  return isOtherModel(up ? providerForBaseUrl(up.baseUrl)?.provider || null : null, m?.upstreamModel || m?.id);
}

/**
 * The catalogue folded into families, in the catalogue's own order (a family sits where its first member did).
 * Rows the harness never offers (advertised effort twins) are left out; a model that is not
 * for chat is a family of its own, `kind: "other"`, never folded with chat ids.
 * @param {any} cfg @param {any[]} rows  `/api/models` rows
 * @returns {Family[]}
 */
export function buildFamilies(cfg, rows) {
  const list = (rows || []).filter((m) => m?.id && m.source !== "effort-variant");
  /** @type {Family[]} */
  const out = [];
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  /** @type {Map<any, ReturnType<typeof parseVariant>>} */
  const parsed = new Map();
  /** @type {Set<any>} */
  const others = new Set(list.filter((m) => isOtherRow(cfg, m)));
  for (const m of list) {
    if (others.has(m)) continue;
    const v = parseVariant(m.id);
    parsed.set(m, v);
    const key = `${m.upstream}\u0000${v.base}`;
    if (!groups.has(key)) groups.set(key, []);
    /** @type {any[]} */ (groups.get(key)).push(m);
  }
  /** @type {Map<any, Family>} the family each row landed in, so the output keeps the catalogue's order */
  const placed = new Map();
  for (const [key, members] of groups) {
    const base = key.slice(key.indexOf("\u0000") + 1);
    const vs = members.map((m) => /** @type {ReturnType<typeof parseVariant>} */ (parsed.get(m)));
    // An axis is real when the family spells two or more values on it — `qwen3` beside `qwen3-max` is two models,
    // not an effort level; `kimi-k3` beside `kimi-k3-fast` is a speed.
    const efforts = [...new Set(vs.map((v) => v.effort).filter(Boolean))];
    const axes = {
      effort: efforts.length >= 2,
      speed: new Set(vs.map((v) => v.speed || "standard")).size >= 2,
      thinking: new Set(vs.map((v) => v.thinking || "off")).size >= 2,
      window: new Set(vs.map((v) => v.window || 0)).size >= 2,
    };
    const fits = (/** @type {ReturnType<typeof parseVariant>} */ v) => (!v.effort || axes.effort) && (!v.speed || axes.speed) && (!v.thinking || axes.thinking) && (!v.window || axes.window);
    const kept = members.filter((_, i) => fits(vs[i]));
    const anyAxis = axes.effort || axes.speed || axes.thinking || axes.window;
    if (members.length >= 2 && anyAxis && kept.length >= 2) {
      const kv = kept.map((m) => /** @type {ReturnType<typeof parseVariant>} */ (parsed.get(m)));
      const plainRow = kept.find((_, i) => !kv[i].effort && !kv[i].speed && !kv[i].thinking && !kv[i].window) || null;
      const first = plainRow || kept[0];
      const traits = traitsOf(base);
      const fastX = axes.speed ? variantFastMultiplier(cfg, kept, kv) : null;
      const winX = axes.window ? variantWindowMultipliers(cfg, kept, kv) : null;
      /** @type {Family} */
      const fam = {
        id: base,
        upstream: first.upstream,
        kind: "variants",
        members: kept.map((m, i) => ({ id: m.id, effort: kv[i].effort, speed: kv[i].speed, thinking: kv[i].thinking, window: kv[i].window, ...(m.context_window ? { context_window: m.context_window } : {}) })),
        effort: axes.effort ? { via: "name", levels: ordered(kv.map((v) => v.effort).filter((e) => !!e), LEVEL_ORDER).map(String), plain: kv.some((v) => !v.effort), default: traits?.effortDefault || null } : null,
        speed: axes.speed ? { via: "name", options: ordered(kv.map((v) => v.speed || "standard"), SPEED_ORDER).map(String), ...(fastX ? { multiplier: fastX } : {}) } : null,
        thinking: axes.thinking ? { via: "name", options: ordered(kv.map((v) => v.thinking || "off"), ["off", "on"]).map(String) } : null,
        window: axes.window ? { via: "name", options: [...new Set(kv.map((v) => v.window || 0))].sort((a, b) => a - b), standard: Number(plainRow?.context_window) || null, ...(winX ? { multipliers: winX } : {}) } : null,
        ...(first.context_window ? { context_window: first.context_window } : {}),
        ...(first.codingAgent ? { codingAgent: true } : machineOf(cfg, first) || (billingForModel(cfg, first.id) === "plan" ? { billing: "plan" } : {})),
        // The plain member's words name the family; another's name its own setting too ("Codex 5.3 High").
        ...ownWords(plainRow),
        ...noToolsOf(modelCapsFor(cfg, first.id)),
      };
      carrySettings(fam, kept.map((m) => plainFamily(cfg, m)), kept.indexOf(first), axes);
      const price = first.codingAgent ? null : priceCardFor(cfg, first.id);
      if (price) fam.price = { input: price.input, output: price.output };
      for (const m of kept) placed.set(m, fam);
      for (const m of members) if (!kept.includes(m)) placed.set(m, plainFamily(cfg, m));
    } else {
      for (const m of members) placed.set(m, plainFamily(cfg, m));
    }
  }
  for (const m of others) placed.set(m, otherFamily(m));
  const seen = new Set();
  for (const m of list) {
    const fam = placed.get(m);
    if (!fam || seen.has(fam)) continue;
    seen.add(fam);
    out.push(fam);
  }
  return out;
}

/** A row's name and description in its agent's own words, as a family carries them. @param {any} m */
function ownWords(m) {
  return { ...(m?.label ? { label: String(m.label) } : {}), ...(m?.note ? { note: String(m.note) } : {}) };
}

/** A model that is not for chat: listed apart, with nothing to tune. @param {any} m @returns {Family} */
function otherFamily(m) {
  return { id: m.id, upstream: m.upstream, kind: "other", members: [{ id: m.id, effort: null, speed: null, thinking: null, window: null, ...(m.context_window ? { context_window: m.context_window } : {}) }], effort: null, speed: null, thinking: null, window: null, ...(m.codingAgent ? { codingAgent: true } : {}) };
}

/**
 * A model that stands alone: what Filament itself can set on it, as model-caps.js resolves it where the model lands —
 * effort where anyone knows its levels, fast mode where it has one on this wire (Anthropic's `speed`, or a
 * provider's own fields its row declares), extended thinking on the Anthropic wire, a choice of window where it
 * offers more than one. A coding agent's model offers the effort setting only when the agent takes effort as a
 * session option — Claude Code's adapter and Codex, and any whose own listing said the levels its session offers for
 * the model (Antigravity's thinking level; caps' `endpoint`) —; fast mode and the window are the agent's own business
 * there.
 * @param {any} cfg @param {any} m @returns {Family}
 */
function plainFamily(cfg, m) {
  const place = placeOfName(cfg, m.id);
  const caps = place ? capsAt(cfg, place.up, place.sent, place.rules) : null;
  const agent = !!caps?.agent;
  const effort = place && caps && (!agent || agentTakesEffort(place.up) || caps.effort.source === "endpoint") ? effortOffer(place.sent, place.rules, caps) : null;
  // The harness asks for fast mode with the -fast suffix: a rule that turns fast off, or the suffix, leaves nothing to offer.
  const sp = place?.rules?.speed || {};
  const fast = !!caps?.fast.available && sp.mode !== "never" && sp.suffix !== false;
  const windows = !agent && caps ? caps.window.options : [];
  // Extended thinking is a setting on the Anthropic wire (model.thinking.budget; adaptive on the families that take
  // only that). Without it the rules cap effort (capWhenThinkingDisabled: Opus refuses xhigh and max then), which
  // the picker says beside the levels it caps.
  const thinks = !!caps?.thinking.available;
  const cap = String(place?.rules?.effort?.capWhenThinkingDisabled || "none");
  if (effort && thinks && cap !== "none") effort.capWithoutThinking = cap;
  const price = place && !agent ? priceCard(place.sent, place.up?.pricing) : null;
  // What the speed costs — the price, or on a subscription the quota — so the picker can say it.
  const multiplier = fast && Number(caps?.fast.multiplier) > 1 ? Number(caps?.fast.multiplier) : null;
  // The flex tier (Providers P5): a setting where the row declares it with its fields, and the parse reads `-flex`
  // (the same rule as fast's suffix switch). Its multiplier is under 1: the cheaper side.
  const flex = !agent && !!caps?.flex.available && sp.suffix !== false;
  const flexX = flex && Number(caps?.flex.multiplier) > 0 && Number(caps?.flex.multiplier) < 1 ? Number(caps?.flex.multiplier) : null;
  const speeds = ["standard", ...(fast ? ["fast"] : []), ...(flex ? ["flex"] : [])];
  return {
    id: m.id,
    upstream: m.upstream,
    kind: "model",
    members: [{ id: m.id, effort: null, speed: null, thinking: null, window: null, ...(m.context_window ? { context_window: m.context_window } : {}) }],
    effort,
    // `wire` says how it is asked for — Anthropic's `speed` (its 2.5× figure) or a provider's own fields — for the copy.
    speed: fast || flex ? { via: "setting", options: speeds, ...(multiplier ? { multiplier } : {}), ...(flexX ? { flexMultiplier: flexX } : {}), wire: /** @type {"anthropic" | "openai"} */ (caps?.wire) } : null,
    thinking: thinks ? { via: "setting", options: ["off", "on"] } : null,
    ...(price ? { price: { input: price.input, output: price.output } } : {}),
    window: windows.length >= 2 ? { via: "setting", options: windows, standard: caps?.window.standard ?? null } : null,
    ...(m.context_window ? { context_window: m.context_window } : {}),
    ...(m.codingAgent ? { codingAgent: true } : {}),
    ...ownWords(m),
    ...noToolsOf(caps),
    // A subscription plan (Providers P4): its speed and window cost the plan's usage, not dollars.
    ...(machineOf(cfg, m) || (place && !agent && billingFor(place.sent, place.up) === "plan" ? { billing: "plan" } : {})),
  };
}
