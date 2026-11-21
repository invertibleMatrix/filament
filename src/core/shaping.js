// Request shaping engine. Pure functions: take a parsed body plus merged rules, return a new body and a
// list of human-readable changes. No I/O here so it is easy to unit test and to preview ("dry run").
import { EFFORT_LEVELS, RULES, defaultsOf } from "./schema.js";
import { builtinEffortsOf } from "./model-traits.js";

const EFFORT_RANK = Object.fromEntries(EFFORT_LEVELS.map((l, i) => [l, i]));
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

const regexCache = new Map();
export function rx(pattern) {
  if (!pattern) return null;
  let r = regexCache.get(pattern);
  if (!r) {
    try {
      r = new RegExp(pattern, "i");
    } catch {
      r = null;
    }
    regexCache.set(pattern, r);
  }
  return r;
}
export const matches = (pattern, model) => {
  const r = rx(pattern);
  return !!(r && model && r.test(model));
};

// Deep merge for rule layers: objects merge recursively, everything else is replaced by the later layer.
export function mergeRules(...layers) {
  const out = {};
  const merge = (dst, src) => {
    for (const [k, v] of Object.entries(src || {})) {
      if (v === undefined) continue;
      if (isObj(v) && !Array.isArray(v) && isObj(dst[k])) merge(dst[k], v);
      else if (isObj(v)) {
        dst[k] = {};
        merge(dst[k], v);
      } else dst[k] = Array.isArray(v) ? [...v] : v;
    }
  };
  merge(out, defaultsOf(RULES));
  for (const l of layers) merge(out, l);
  return out;
}

// "claude-opus-5-max" -> { base: "claude-opus-5", suffixEffort: "max", suffixFast: false }
// "claude-opus-5-xhigh-fast" / "claude-opus-5-fast-xhigh" -> { base: "claude-opus-5", suffixEffort: "xhigh", suffixFast: true }
export function parseModelSuffix(model, rules) {
  const efforts = [...(rules?.effort?.suffixes || [])].sort((a, b) => b.length - a.length);
  const fastOk = rules?.speed?.suffix !== false;
  let m = String(model || ""),
    suffixEffort = null,
    suffixFast = false;
  for (let guard = 0; guard < 3; guard++) {
    const lower = m.toLowerCase();
    const e = suffixEffort ? null : efforts.find((s) => lower.endsWith(`-${s}`));
    if (e) {
      suffixEffort = e;
      m = m.slice(0, -(e.length + 1));
      continue;
    }
    if (fastOk && !suffixFast && lower.endsWith("-fast")) {
      suffixFast = true;
      m = m.slice(0, -5);
      continue;
    }
    break;
  }
  // effort.stripSuffix off: the suffix still selects the effort, but routing and forwarding use the exact name sent
  if (rules?.effort?.stripSuffix === false)
    return { base: String(model || ""), suffixEffort, suffixFast, original: String(model || "") };
  return { base: m, suffixEffort, suffixFast, original: String(model || "") };
}

// Strip provider prefixes ("anthropic/claude-opus-5" -> "claude-opus-5") for family matching only.
export const bareModel = (model) =>
  String(model || "")
    .split("/")
    .pop();

// The levels a model may be sent: the rules' `allowed`, narrowed by what the model takes. With `caps` (the planner's
// model-caps answer for this upstream) its resolved levels decide — the model's row on the Upstreams page, else the
// provider's listing, else the rules' caps, else the built-ins. Without it, the operator's `modelCaps` entries that
// name the model — or, when none does, the built-in traits (a Grok takes low/medium/high; max would be refused). A
// family nobody knows keeps every allowed level.
export function allowedEffortsFor(model, rules, caps = /** @type {any} */ (null)) {
  let allowed = new Set(rules.effort.allowed || EFFORT_LEVELS);
  if (caps?.effort) {
    const levels = caps.effort.levels;
    return Array.isArray(levels) ? new Set([...allowed].filter((l) => levels.includes(l))) : allowed;
  }
  let capped = false;
  for (const cap of rules.effort.modelCaps || []) {
    if (matches(cap.match, model)) {
      allowed = new Set([...allowed].filter((l) => (cap.allowed || []).includes(l)));
      capped = true;
    }
  }
  const known = capped ? null : builtinEffortsOf(model);
  if (known) allowed = new Set([...allowed].filter((l) => known.includes(l)));
  return allowed;
}

/** Where a model's levels were learned, for a change line that must say why a level moved. @param {any} caps */
const levelsFrom = (caps) =>
  caps?.effort?.source === "operator" ? " (levels from its Upstreams page row)" : caps?.effort?.source === "endpoint" ? " (levels from the provider's model list)" : "";

function resolveEffort({ requested, clientEffort, rules, model, thinkingDisabled, changes, caps = /** @type {any} */ (null) }) {
  let source = null,
    level = null;
  for (const src of rules.effort.sources || []) {
    if (src === "suffix" && requested.suffixEffort) {
      level = requested.suffixEffort;
      source = "suffix";
      break;
    }
    if (src === "client" && typeof clientEffort === "string" && clientEffort) {
      level = clientEffort.toLowerCase();
      source = "client";
      break;
    }
    if (src === "default" && rules.effort.default && rules.effort.default !== "none") {
      level = rules.effort.default;
      source = "default";
      break;
    }
  }
  if (!level) return { level: null, source: null };
  if (!(level in EFFORT_RANK)) {
    changes.push(`effort "${level}" is not a known level, dropped`);
    return { level: null, source };
  }

  const allowed = allowedEffortsFor(model, rules, caps);
  if (thinkingDisabled && rules.effort.capWhenThinkingDisabled !== "none") {
    for (const l of EFFORT_LEVELS)
      if (EFFORT_RANK[l] > EFFORT_RANK[rules.effort.capWhenThinkingDisabled]) allowed.delete(l);
  }
  if (allowed.size === 0) {
    changes.push(`effort removed: ${bareModel(model)} accepts no effort field${levelsFrom(caps)}`);
    return { level: null, source };
  }
  if (allowed.has(level)) return { level, source };

  const mode = rules.effort.onUnsupported;
  if (mode === "pass") return { level, source };
  if (mode === "drop") {
    changes.push(`effort "${level}" not allowed for ${bareModel(model)}${levelsFrom(caps)}, dropped`);
    return { level: null, source };
  }
  const lower =
    EFFORT_LEVELS.filter((l) => allowed.has(l) && EFFORT_RANK[l] <= EFFORT_RANK[level]).pop() ||
    EFFORT_LEVELS.filter((l) => allowed.has(l))[0];
  changes.push(`effort "${level}" not allowed for ${bareModel(model)}${levelsFrom(caps)}, clamped to "${lower}"`);
  return { level: lower, source };
}

/**
 * Fast mode's request fields for a provider that asks for it in fields of its own (xAI's and OpenAI's
 * `service_tier: "priority"`), set on the body as its row declares them — the fast request is the explicit ask, so a
 * client's own value for the same field gives way, and the change says so.
 * @param {any} body @param {Record<string, unknown>} params @param {string} why @param {string[]} changes
 */
export function applyFastParams(body, params, why, changes, what = "fast mode") {
  const moved = [];
  for (const [k, v] of Object.entries(params || {})) {
    const was = body[k];
    body[k] = structuredClone(v);
    moved.push(was === undefined || JSON.stringify(was) === JSON.stringify(v) ? `${k} = ${JSON.stringify(v)}` : `${k} ${JSON.stringify(was)} -> ${JSON.stringify(v)}`);
  }
  if (moved.length) changes.push(`${what}: ${moved.join(", ")} (from ${why})`);
}

function hasAnyCacheControl(body) {
  const check = (blocks) =>
    Array.isArray(blocks) && blocks.some((b) => b && typeof b === "object" && b.cache_control);
  if (check(body.system) || check(body.tools)) return true;
  for (const m of body.messages || []) if (check(m?.content)) return true;
  return false;
}

function textLength(blocks) {
  if (typeof blocks === "string") return blocks.length;
  if (!Array.isArray(blocks)) return 0;
  return blocks.reduce((n, b) => n + (typeof b?.text === "string" ? b.text.length : 0), 0);
}

/**
 * The shaped body, before any rule changes it: the client's top level and its messages array copied, everything they
 * hold shared with the client's body. A rule that changes something deeper puts a changed copy where it was (the
 * cache marker's message and block, an assistant message losing its unsigned thinking, `output_config`, `reasoning`)
 * and never writes on what it found. A whole deep copy of every attempt's body — a long conversation's every message,
 * on every round of an agent's turn — was the most of shaping's time; the client's body still comes out untouched,
 * and a memory follow-up that appends to it later reaches no body already shaped. A body holds no object twice: it
 * comes parsed from JSON or is built fresh, so no change made here shows anywhere else.
 * @param {any} input @param {string} list  the array a later append grows: `messages`, or a Responses body's `input`
 */
function shallowBody(input, list) {
  const body = { ...input };
  if (Array.isArray(body[list])) body[list] = body[list].slice();
  return body;
}

/** `output_config` without its effort, as a copy — gone whole when nothing else was in it. @param {any} body */
function dropEffort(body) {
  const { effort, ...rest } = body.output_config;
  if (Object.keys(rest).length) body.output_config = rest;
  else delete body.output_config;
}

/** A block with the cache marker on it, as a copy. @param {any} b @param {any} marker */
const marked = (b, marker) => Object.assign(Array.isArray(b) ? [...b] : { ...b }, { cache_control: { ...marker } });

function applyCache(body, rules, changes) {
  const mode = rules.cache.ensureBreakpoints;
  if (!mode || mode === "off") return;
  if (rules.cache.respectClient && hasAnyCacheControl(body)) return;
  const marker = rules.cache.ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
  let added = [];
  if (body.system && textLength(body.system) >= (rules.cache.minSystemChars || 0)) {
    const system = typeof body.system === "string" ? [{ type: "text", text: body.system }] : body.system;
    const last = system[system.length - 1];
    if (last && typeof last === "object") {
      const copy = Array.isArray(system) ? system.slice() : { ...system };
      copy[system.length - 1] = marked(last, marker);
      body.system = copy;
      added.push("system");
    }
  }
  if (mode === "system-and-last-user" && Array.isArray(body.messages)) {
    /** Marks a user message's last block, as a copy; false where it has none to mark. @param {number} i */
    const mark = (i) => {
      const m = body.messages[i];
      const content = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
      const blocks = Array.isArray(content) ? content : null;
      const last = blocks && blocks[blocks.length - 1];
      if (!last || typeof last !== "object" || last.type === "thinking") return false;
      body.messages[i] = { ...m, content: [...blocks.slice(0, -1), marked(last, marker)] };
      return true;
    };
    const lastUser = body.messages.findLastIndex((/** @type {any} */ m) => m?.role === "user");
    if (lastUser >= 0 && mark(lastUser)) added.push("last user message");
    // The request before this one ended at the user message before the newest reply, and marked it: marked again here,
    // its cache is read wherever this request's own mark lies past the provider's lookback (Anthropic's ~20 blocks) —
    // a round of ten calls at once, with their results, is past it, and the whole history was written again.
    const reply = body.messages.findLastIndex((/** @type {any} */ m, /** @type {number} */ i) => i < lastUser && m?.role === "assistant");
    const before = reply > 0 ? body.messages.findLastIndex((/** @type {any} */ m, /** @type {number} */ i) => i < reply && m?.role === "user") : -1;
    if (before >= 0 && mark(before)) added.push("the user message before the newest reply");
  }
  if (added.length) changes.push(`cache_control added on ${added.join(" + ")} (${rules.cache.ttl})`);
}

function applyStrips(body, rules, model, changes) {
  const toStrip = new Set(rules.params.strip || []);
  for (const r of rules.params.stripRules || [])
    if (matches(r.match, model)) for (const f of r.strip || []) toStrip.add(f);
  const removed = [];
  for (const f of toStrip)
    if (f in body) {
      delete body[f];
      removed.push(f);
    }
  if (removed.length) changes.push(`removed ${removed.join(", ")}`);
}

function applyMaxTokens(body, rules, changes) {
  const { maxTokensDefault, maxTokensMin, maxTokensMax } = rules.params;
  if (body.max_tokens == null && maxTokensDefault) {
    body.max_tokens = maxTokensDefault;
    changes.push(`max_tokens defaulted to ${maxTokensDefault}`);
  }
  if (typeof body.max_tokens === "number") {
    if (maxTokensMin && body.max_tokens < maxTokensMin) {
      changes.push(`max_tokens raised ${body.max_tokens} -> ${maxTokensMin}`);
      body.max_tokens = maxTokensMin;
    }
    if (maxTokensMax && body.max_tokens > maxTokensMax) {
      changes.push(`max_tokens lowered ${body.max_tokens} -> ${maxTokensMax}`);
      body.max_tokens = maxTokensMax;
    }
  }
}

function applyStreamMode(body, rules, changes) {
  const want = rules.params.forceStream;
  const before = body.stream === true;
  if (want === "on" && !before) {
    body.stream = true;
    changes.push("stream forced on");
  }
  if (want === "off" && before) {
    body.stream = false;
    changes.push("stream forced off");
  }
  return { clientWantsStream: before, upstreamStream: body.stream === true };
}

// ---------------------------------------------------------------------------------------------------
// Anthropic Messages format
// ---------------------------------------------------------------------------------------------------
export function shapeAnthropic({ body: input, rules, requested, upstreamModel, caps = /** @type {any} */ (null) }) {
  const body = shallowBody(input, "messages");
  const changes = [];
  const model = bareModel(upstreamModel || requested.base);
  body.model = upstreamModel || requested.base;
  if (input.model !== body.model) changes.push(`model ${input.model} -> ${body.model}`);

  // --- thinking ---
  const t = rules.thinking;
  let thinking = isObj(body.thinking) ? { ...body.thinking } : undefined;
  const adaptiveOnly = matches(t.adaptiveOnlyModels, model);
  const noAdaptive = matches(t.noAdaptiveModels, model);

  if (t.mode === "strip") {
    if (thinking) changes.push("thinking removed (mode: strip)");
    thinking = undefined;
  } else if (t.mode === "adaptive") {
    thinking = { type: "adaptive" };
    changes.push("thinking forced adaptive");
  } else if (t.mode === "disabled") {
    thinking = { type: "disabled" };
    changes.push("thinking forced disabled");
  }

  if (thinking) {
    if (thinking.type === "enabled" && adaptiveOnly && t.legacyToAdaptive) {
      thinking = { type: "adaptive", ...(thinking.display ? { display: thinking.display } : {}) };
      changes.push("thinking enabled+budget_tokens -> adaptive (adaptive-only model)");
    }
    if (thinking.type === "adaptive" && noAdaptive) {
      thinking = { type: "enabled", budget_tokens: t.fallbackBudgetTokens || 16000 };
      changes.push(
        `thinking adaptive -> enabled budget ${thinking.budget_tokens} (model has no adaptive mode)`,
      );
    }
    if (thinking.type === "disabled" && matches(t.rejectsDisabledModels, model)) {
      thinking = undefined;
      changes.push("thinking.disabled removed (model cannot disable thinking)");
    }
    if (thinking && thinking.type === "adaptive" && "budget_tokens" in thinking) {
      delete thinking.budget_tokens;
      changes.push("budget_tokens removed from adaptive thinking");
    }
    if (
      thinking &&
      (thinking.type === "adaptive" || thinking.type === "enabled") &&
      matches(t.displayModels, model) &&
      t.display !== "keep"
    ) {
      const clientHad = typeof thinking.display === "string" && thinking.display;
      if (!(clientHad && t.respectClientDisplay) && thinking.display !== t.display) {
        thinking.display = t.display;
        changes.push(`thinking.display = ${t.display}`);
      }
    }
    if (thinking && thinking.display && !matches(t.displayModels, model)) {
      delete thinking.display;
      changes.push("thinking.display removed (unsupported model)");
    }
  }
  // A model its row or its provider's listing says takes no extended thinking would refuse the field: it goes. The
  // built-ins' silence about a non-Claude model is not such a word.
  const noThinking = caps?.thinking && !caps.thinking.available && (caps.thinking.source === "operator" || caps.thinking.source === "endpoint");
  if (noThinking && thinking && thinking.type !== "disabled") {
    changes.push(`thinking removed (${model} takes no extended thinking: ${caps.thinking.source === "operator" ? "its row on the Upstreams page" : "its provider's listing"} says so)`);
    thinking = undefined;
  }
  if (thinking) body.thinking = thinking;
  else delete body.thinking;
  const thinkingDisabled = !thinking || thinking.type === "disabled";

  // Thinking blocks without a signature (from an ACP agent or another provider) are rejected by Anthropic when
  // replayed; drop them from earlier assistant turns. Signed blocks stay so the cache prefix is untouched.
  if (t.stripUnsignedHistory !== false && Array.isArray(body.messages)) {
    let dropped = 0;
    body.messages.forEach((m, i) => {
      if (m?.role !== "assistant" || !Array.isArray(m.content)) return;
      const kept = m.content.filter((b) => !(b && b.type === "thinking" && !b.signature));
      if (kept.length !== m.content.length) {
        dropped += m.content.length - kept.length;
        body.messages[i] = { ...m, content: kept.length ? kept : [{ type: "text", text: "" }] };
      }
    });
    if (dropped) changes.push(`${dropped} unsigned thinking block(s) removed from history`);
  }

  // --- effort ---
  const clientEffort = isObj(body.output_config) ? body.output_config.effort : undefined;
  const { level, source } = resolveEffort({
    requested,
    clientEffort,
    rules,
    model,
    thinkingDisabled,
    changes,
    caps,
  }); // no thinking object at all counts as disabled (Opus 5 rejects xhigh/max then too)
  if (level) {
    if (clientEffort !== level)
      changes.push(`effort ${clientEffort ? `${clientEffort} -> ` : ""}${level} (from ${source})`);
    body.output_config = { ...(isObj(body.output_config) ? body.output_config : {}), effort: level };
  } else if (isObj(body.output_config) && "effort" in body.output_config) dropEffort(body);
  if (noAdaptive && isObj(body.output_config) && "effort" in body.output_config) {
    dropEffort(body);
    changes.push("effort removed (model predates output_config.effort)");
  }

  // --- forced tool choice on models that reject it ---
  if (
    rules.tools?.forcedToolChoice === "auto" &&
    isObj(body.tool_choice) &&
    ["any", "tool"].includes(body.tool_choice.type) &&
    matches(rules.tools.forcedToolChoiceModels, model)
  ) {
    changes.push(
      `tool_choice ${body.tool_choice.type}${body.tool_choice.name ? ":" + body.tool_choice.name : ""} -> auto (model rejects forced tool choice)`,
    );
    body.tool_choice = {
      type: "auto",
      ...(body.tool_choice.disable_parallel_tool_use !== undefined
        ? { disable_parallel_tool_use: body.tool_choice.disable_parallel_tool_use }
        : {}),
    };
  }

  // --- fast mode (Anthropic `speed: "fast"` and its beta header) ---
  // Which models take it: the planner's caps when it passed them (the model's row on the Upstreams page, else the
  // rules' speed.models), the rules alone otherwise. A row may add fields of its own for a gateway that wants them.
  const extraBetas = [];
  const sp = rules.speed || {};
  const clientFast = body.speed === "fast";
  const wantFast = sp.mode === "always" || (sp.mode !== "never" && (requested.suffixFast || clientFast));
  const fastOk = caps?.fast ? caps.fast.available : matches(sp.models, model);
  if (wantFast && fastOk) {
    if (!clientFast) changes.push(`speed fast (from ${requested.suffixFast ? "model suffix" : "rule"})`);
    body.speed = "fast";
    if (sp.beta) extraBetas.push(sp.beta);
    if (caps?.fast?.params) applyFastParams(body, caps.fast.params, requested.suffixFast ? "the -fast suffix" : clientFast ? "the client's speed" : "rule: always", changes);
  } else if (wantFast || "speed" in body) {
    if (wantFast) changes.push(`fast mode not available on ${model}${caps?.fast?.source === "operator" ? " (its row on the Upstreams page says it has none)" : ""} -> standard speed`);
    else if (sp.mode === "never") changes.push("speed removed (rule: never)");
    delete body.speed;
  }

  applyStrips(body, rules, model, changes);
  applyMaxTokens(body, rules, changes);
  applyCache(body, rules, changes);
  const streamInfo = applyStreamMode(body, rules, changes);
  return { body, changes, extraBetas, fast: body.speed === "fast", ...streamInfo };
}

/**
 * Fast mode on an OpenAI-format wire (Chat Completions or Responses): asked for with the fields the model's row
 * declares (`fastParams`), when its row declares a fast mode at all. Anthropic's `speed` has no equivalent there, so a
 * `-fast` suffix without such a row is ignored and said so. Returns whether the request goes out fast.
 * @param {any} body @param {any} rules @param {any} requested @param {any} caps @param {string} model @param {string[]} changes
 */
function applyOpenAIFast(body, rules, requested, caps, model, changes) {
  const sp = rules.speed || {};
  const wantFast = sp.mode === "always" || (sp.mode !== "never" && requested.suffixFast);
  if (wantFast && caps?.fast?.available && caps.fast.params) {
    applyFastParams(body, caps.fast.params, requested.suffixFast ? "the -fast suffix" : "rule: always", changes);
    return true;
  }
  const why =
    caps?.fast?.missing === "params"
      ? `${model} is marked fast on its Upstreams page row, but the row has no request fields to ask with — add fastParams (e.g. {"service_tier": "priority"})`
      : `${model} has no fast mode on this wire (its Upstreams page row can declare one, with the request fields that ask for it)`;
  if (requested.suffixFast) changes.push(sp.mode === "never" ? "-fast suffix ignored (rule: never)" : `-fast suffix ignored: ${why}`);
  else if (sp.mode === "always") changes.push(`fast mode (rule: always) not sent: ${why}`);
  return false;
}

/**
 * The flex tier on an OpenAI-format wire (Providers P5): the parse read Filament's `-flex` suffix (`flexParse`, which
 * reads it only on a model whose row declares flex with its fields), so the row's `flexParams` go on the body. Fast
 * mode, asked for too, wins: the faster tier is the explicit ask. Returns whether the request goes out on flex.
 * @param {any} body @param {any} requested @param {any} caps @param {boolean} fast @param {string[]} changes
 */
function applyOpenAIFlex(body, requested, caps, fast, changes) {
  if (!requested?.suffixFlex) return false;
  if (fast) {
    changes.push("flex tier not sent: fast mode was asked for too, and wins");
    return false;
  }
  if (!caps?.flex?.available || !caps.flex.params) return false;
  applyFastParams(body, caps.flex.params, "the -flex suffix", changes, "flex tier");
  return true;
}

/** Z.ai's own addresses (the provider catalogue's three plans): the hosts that take `tool_stream`. */
const TOOL_STREAM_HOSTS = /^https?:\/\/(api\.z\.ai|open\.bigmodel\.cn)(?=[/:]|$)/i;

/**
 * Z.ai streams a tool call's arguments only when asked (`tool_stream: true`): without it a call's whole input — a file
 * the model writes — comes in one piece once the model has written it, so nothing hears it grow: not the speed gauge,
 * not a visual drawn as it is written (the owner's word of 10-27: the gauge stood still while an agent wrote a file;
 * measured through Filament on GLM-5.3: one piece at the end without it, 499 over 7.6 s with it). Asked for on a
 * streamed Chat Completions request that offers tools, at Z.ai's addresses alone — another server may refuse a field
 * it does not know — and never over a value the client sent itself.
 * @param {any} body  the shaped Chat Completions body @param {string} baseUrl  the upstream's address
 * @param {string[]} changes
 * @returns {boolean} whether it was asked for
 */
export function applyToolStream(body, baseUrl, changes) {
  if (!body || body.stream !== true || !Array.isArray(body.tools) || !body.tools.length || "tool_stream" in body) return false;
  if (!TOOL_STREAM_HOSTS.test(String(baseUrl || ""))) return false;
  body.tool_stream = true;
  changes.push("tool_stream on: Z.ai streams each tool call's arguments as the model writes them");
  return true;
}

// ---------------------------------------------------------------------------------------------------
// OpenAI Chat Completions format
// ---------------------------------------------------------------------------------------------------
export function shapeOpenAI({ body: input, rules, requested, upstreamModel, caps = /** @type {any} */ (null) }) {
  const body = shallowBody(input, "messages");
  const changes = [];
  const model = bareModel(upstreamModel || requested.base);
  body.model = upstreamModel || requested.base;
  if (input.model !== body.model) changes.push(`model ${input.model} -> ${body.model}`);

  const fast = applyOpenAIFast(body, rules, requested, caps, model, changes);
  const flex = applyOpenAIFlex(body, requested, caps, fast, changes);
  const clientEffort =
    typeof body.reasoning_effort === "string"
      ? body.reasoning_effort
      : isObj(body.reasoning)
        ? body.reasoning.effort
        : undefined;
  const { level, source } = resolveEffort({
    requested,
    clientEffort,
    rules,
    model,
    thinkingDisabled: false,
    changes,
    caps,
  });
  if (level) {
    if (clientEffort !== level)
      changes.push(`reasoning_effort ${clientEffort ? `${clientEffort} -> ` : ""}${level} (from ${source})`);
    if (isObj(body.reasoning) && "effort" in body.reasoning) body.reasoning = { ...body.reasoning, effort: level };
    else body.reasoning_effort = level;
  } else if (typeof body.reasoning_effort === "string") delete body.reasoning_effort;

  if (
    rules.tools?.forcedToolChoice === "auto" &&
    matches(rules.tools.forcedToolChoiceModels, model) &&
    (body.tool_choice === "required" || (isObj(body.tool_choice) && body.tool_choice.type === "function"))
  ) {
    changes.push("tool_choice forced -> auto (model rejects forced tool choice)");
    body.tool_choice = "auto";
  }

  applyStrips(body, rules, model, changes);
  if (rules.params.maxTokensDefault && body.max_tokens == null && body.max_completion_tokens == null) {
    body.max_completion_tokens = rules.params.maxTokensDefault;
    changes.push(`max_completion_tokens defaulted to ${rules.params.maxTokensDefault}`);
  }
  const streamInfo = applyStreamMode(body, rules, changes);
  if (body.stream === true && rules.params.openaiIncludeUsage && !body.stream_options?.include_usage) {
    body.stream_options = { ...(body.stream_options || {}), include_usage: true };
    changes.push("stream_options.include_usage added");
  }
  return { body, changes, fast, flex, ...streamInfo };
}

// OpenAI Responses format, passed through from a Responses client to a server that speaks Responses. The same
// decisions as shapeOpenAI where the field exists (model name, effort from the suffix, max_output_tokens default,
// stream mode); everything else is forwarded exactly as the client sent it.
export function shapeResponses({ body: input, rules, requested, upstreamModel, caps = /** @type {any} */ (null) }) {
  const body = shallowBody(input, "input");
  const changes = [];
  const model = bareModel(upstreamModel || requested.base);
  body.model = upstreamModel || requested.base;
  if (input.model !== body.model) changes.push(`model ${input.model} -> ${body.model}`);
  const fast = applyOpenAIFast(body, rules, requested, caps, model, changes);
  const flex = applyOpenAIFlex(body, requested, caps, fast, changes);
  const clientEffort =
    isObj(body.reasoning) && typeof body.reasoning.effort === "string" ? body.reasoning.effort : undefined;
  const { level, source } = resolveEffort({
    requested,
    clientEffort,
    rules,
    model,
    thinkingDisabled: false,
    changes,
    caps,
  });
  if (level) {
    if (clientEffort !== level)
      changes.push(`reasoning.effort ${clientEffort ? `${clientEffort} -> ` : ""}${level} (from ${source})`);
    body.reasoning = { ...(isObj(body.reasoning) ? body.reasoning : {}), effort: level };
  }
  if (rules.params.maxTokensDefault && body.max_output_tokens == null) {
    body.max_output_tokens = rules.params.maxTokensDefault;
    changes.push(`max_output_tokens defaulted to ${rules.params.maxTokensDefault}`);
  }
  const streamInfo = applyStreamMode(body, rules, changes);
  return { body, changes, fast, flex, ...streamInfo };
}

// Header composition for the outbound request. `inbound` is a plain lower-cased header map.
export function shapeHeaders({ rules, inbound, format, upstreamHeaders, auth, requestId, extraBetas = [] }) {
  const h = {};
  h["content-type"] = "application/json";
  h["accept"] = "text/event-stream, application/json";
  for (const name of rules.headers.forwardClient || []) {
    const n = name.toLowerCase();
    if (["authorization", "x-api-key", "cookie", "host", "content-length", "connection"].includes(n))
      continue;
    if (inbound[n] != null && n !== "anthropic-beta") h[n] = inbound[n];
  }
  if (format === "anthropic") {
    h["anthropic-version"] = inbound["anthropic-version"] || "2023-06-01";
    const forwardBeta = (rules.headers.forwardClient || [])
      .map((x) => x.toLowerCase())
      .includes("anthropic-beta");
    const list = [];
    const push = (v) => {
      for (const f of String(v || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean))
        if (!list.includes(f)) list.push(f);
    };
    if (forwardBeta && inbound["anthropic-beta"]) push(inbound["anthropic-beta"]);
    for (const f of rules.headers.anthropicBetaAdd || []) push(f);
    for (const f of extraBetas) push(f);
    if (rules.thinking?.display === "updates") push("thinking-display-updates-2026-08-18");
    const remove = new Set((rules.headers.anthropicBetaRemove || []).map((s) => s.toLowerCase()));
    const finalBeta = list.filter((f) => !remove.has(f.toLowerCase()));
    if (finalBeta.length) h["anthropic-beta"] = finalBeta.join(",");
  }
  const identity = rules.headers.identity;
  if (identity === "claude-code") {
    h["user-agent"] = "claude-cli/2.1.258 (external, cli)";
    h["x-app"] = "cli";
  } else if (identity === "custom" && rules.headers.userAgent) h["user-agent"] = rules.headers.userAgent;
  else h["user-agent"] = "filament/0.1";
  if (requestId) h["x-filament-request-id"] = requestId;
  for (const [k, v] of Object.entries(rules.headers.set || {})) h[k.toLowerCase()] = String(v);
  for (const [k, v] of Object.entries(upstreamHeaders || {})) h[k.toLowerCase()] = String(v);
  for (const [k, v] of Object.entries(auth || {})) h[k.toLowerCase()] = v;
  for (const name of rules.headers.remove || []) delete h[name.toLowerCase()];
  return h;
}
