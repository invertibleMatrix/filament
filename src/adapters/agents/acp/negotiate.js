// Model and mode negotiation with an agent session, the pure part: what a session offers (models, effort levels,
// other settings, modes), a requested mode resolved through aliases, a flat model name taken apart into a base model
// and its parameter values (Cursor's picker), and the offered id a person most plausibly meant. And an agent's own
// words for the models it lists, wherever it lists them.
import { EFFORT_LEVELS } from "../../../core/schema.js";
import { parseModelSuffix } from "../../../core/shaping.js";

// Resolve a requested mode against what the agent offers, using aliases (Cursor "agent" == Gemini "yolo" == Qoder "yolo").
export function resolveMode(requested, available, aliases = {}) {
  if (!requested) return null;
  if (!available?.length) return requested;
  if (available.includes(requested)) return requested;
  for (const cand of aliases[requested] || []) if (available.includes(cand)) return cand;
  const lower = available.find((m) => m.toLowerCase() === String(requested).toLowerCase());
  return lower || null;
}

// What a session offers. Older agents list `models`; newer ones (Claude Code adapter) expose "model" and "effort"
// as session config options that are changed with session/set_config_option.
// A select's choices may come in groups (ACP's `SessionConfigSelectGroup`, each `{ group, name, options }`): flat, in
// their order. An option is found by the category ACP gives it (`model`, `thought_level`) before its id, which each
// agent names its own way (the review of 11-10: a grouped list, or one named otherwise, read as no models at all).
export function readSessionOffer(res) {
  const opts = (Array.isArray(res?.configOptions) ? res.configOptions : []).map((o) =>
    o && Array.isArray(o.options) ? { ...o, options: o.options.flatMap((x) => (x && typeof x === "object" && "group" in x && Array.isArray(x.options) ? x.options : [x])) } : o,
  );
  const opt = (re) => opts.find((o) => o && re.test(String(o.id || "")) && Array.isArray(o.options));
  const ofKind = (kind) => opts.find((o) => o && o.category === kind && Array.isArray(o.options));
  const modelOpt = ofKind("model") || opt(/^model$/i) || opt(/model/i),
    effortOpt = ofKind("thought_level") || opt(/^effort$/i) || opt(/effort/i);
  const classic = (res?.models?.availableModels || []).map((m) => m.modelId || m.id).filter(Boolean);
  const models = modelOpt ? modelOpt.options.map((o) => o.value).filter(Boolean) : classic;
  const configOptions = opts.map((o) => ({
    id: o.id,
    name: o.name || o.id,
    current: o.currentValue ?? null,
    values: Array.isArray(o.options)
      ? o.options.map((x) => ({ value: x.value, name: x.name || x.value, description: x.description || "" }))
      : [],
  }));
  const params = opts
    .filter((o) => o && o !== modelOpt && !/^mode$/i.test(String(o.id || "")) && Array.isArray(o.options))
    .map((o) => ({
      id: String(o.id),
      name: o.name || String(o.id),
      category: o.category || "",
      current: o.currentValue == null ? null : String(o.currentValue),
      values: o.options.map((x) => String(x.value)).filter(Boolean),
    }));
  return {
    params,
    models,
    modelLabels: modelLabels(modelOpt ? modelOpt.options : res?.models?.availableModels || []),
    currentModel: modelOpt ? (modelOpt.currentValue ?? null) : (res?.models?.currentModelId ?? null),
    modelConfig: !!modelOpt,
    modelConfigId: modelOpt?.id || null,
    efforts: effortOpt ? effortOpt.options.map((o) => o.value).filter(Boolean) : [],
    currentEffort: effortOpt ? (effortOpt.currentValue ?? null) : null,
    effortConfigId: effortOpt?.id || null,
    modes: (res?.modes?.availableModes || []).map((m) => m.id),
    modeDetails: (res?.modes?.availableModes || []).map((m) => ({
      id: m.id,
      name: m.name || m.id,
      description: m.description || "",
    })),
    currentMode: res?.modes?.currentModeId || null,
    configOptions,
  };
}
/**
 * An agent's own words for the models it lists (HarnessV3-ACP AF2): each id's name and description, from entries
 * shaped as Codex's and Cursor's lists, a session's model option and its classic `availableModels` have them
 * (`id` | `value` | `modelId`; `displayName` | `name`; `description`). A name that only spells its id again says
 * nothing and is left out, and so is an entry left with nothing to say, or hidden.
 * @param {readonly any[]} items
 * @returns {Record<string, import("../../../core/ports.js").ModelLabel>}
 */
export function modelLabels(items) {
  /** @type {Record<string, import("../../../core/ports.js").ModelLabel>} */
  const out = {};
  for (const it of items || []) {
    const id = String(it?.id ?? it?.value ?? it?.modelId ?? "").trim();
    if (!id || it.hidden) continue;
    const name = String(it.displayName ?? it.name ?? "").trim();
    const note = String(it.description ?? "").trim();
    const label = name.toLowerCase() === id.toLowerCase() ? "" : name;
    if (label || note) out[id] = { ...(label ? { label } : {}), ...(note ? { note } : {}) };
  }
  return out;
}

/**
 * A model list as an agent's CLI prints it, an "id - Name" line each (Cursor's `agent --list-models`), colours and
 * all: its ids, and each one's name in its own words — without the CLI's marks for its own state, "(current)" and
 * "(default)", which a kept list would soon have wrong.
 * @param {string} text
 * @returns {{ names: string[], labels: Record<string, import("../../../core/ports.js").ModelLabel> }}
 */
export function listedModels(text) {
  /** @type {string[]} */
  const names = [];
  const items = [];
  for (const line of String(text || "").replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/)) {
    const hit = /^([A-Za-z0-9][\w.\-\[\]=,]*)\s+-\s+(.*)$/.exec(line.trim());
    if (!hit) continue;
    names.push(hit[1]);
    items.push({ id: hit[1], name: hit[2].replace(/\s*\((?:current|default)(?:\s*,\s*(?:current|default))*\)$/i, "") });
  }
  return { names, labels: modelLabels(items) };
}

/**
 * The version a model's name, or an agent's words for a model, carry ("claude-opus-5-5", "grok-4.6", "Opus 5 with 1M
 * context": 5.5, 4.6, 5): its first number, with the one after a dot or dash. A size ("1M", "[1m]") is none.
 * @param {unknown} text
 * @returns {string | null}
 */
function versionOf(text) {
  const m = /\b(\d{1,2})(?:[-.](\d{1,2}))?\b/.exec(String(text ?? ""));
  return m ? (m[2] ? `${m[1]}.${m[2]}` : m[1]) : null;
}
/**
 * Whether an offered model is of the version a name asks for (the bug report's O1): any, where the name carries none;
 * else the one its id names, or, for an id that names none ("opus[1m]"), the agent's words for it — its name, then its
 * description. Never a model nothing says the version of.
 * @param {string} wanted @param {string} id
 * @param {Record<string, import("../../../core/ports.js").ModelLabel>} labels
 */
function ofVersion(wanted, id, labels) {
  const v = versionOf(wanted);
  return !v || (versionOf(id) ?? versionOf(labels[id]?.label) ?? versionOf(labels[id]?.note)) === v;
}

// A model asked for as one flat name ("cursor-grok-4.6-xhigh-fast", "claude-opus-4-8-thinking-max", "grok-4.6") against an
// agent whose session offers base models plus one option per parameter (Cursor's parameterized picker: effort, fast,
// thinking, context, reasoning…). Returns the base model and the option values the name asks for, or null when the name
// does not start with an offered model of its version (`labels`: the agent's words for its models). Words after the
// base are matched against option values ("xhigh" -> effort) or switch a boolean option on ("fast", "thinking");
// booleans not named are off, because Cursor's own list spells the non-fast variant without the word. An effort from
// Filament's suffix or the client fills in when the name has none.
export function planVariant(modelId, effort, { models = [], params = [], labels = {} } = {}) {
  const id = String(modelId || "")
    .trim()
    .toLowerCase();
  if (!id || !models.length) return null;
  const cands = [...new Set(models.map((m) => String(m || "")).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  let base = null,
    rest = "";
  for (const prefix of ["", "cursor-"]) {
    if (!id.startsWith(prefix)) continue;
    const tail = id.slice(prefix.length);
    const hit = cands.find((m) => {
      const l = m.toLowerCase();
      // Of the name's version only (the bug report's O1): "gpt-5-5" is not gpt-5 with a word left over.
      return tail === l || (tail.startsWith(l + "-") && ofVersion(tail, m, labels));
    });
    if (hit) {
      base = hit;
      rest = tail.slice(hit.length);
      break;
    }
  }
  if (!base) return null;
  // The name's version spelled right after the base is the base's own: an alias's, whose id names none
  // ("sonnet-5-xhigh").
  const version = versionOf(id);
  if (version) rest = rest.replace(new RegExp(`^-${version.replace(".", "[-.]")}(?=-|$)`), "");
  const opts = params.filter((p) => p && Array.isArray(p.values) && p.values.length);
  const isBool = (p) => p.values.every((v) => /^(true|false)$/i.test(String(v)));
  const valueOf = (p, t) => p.values.find((v) => String(v).toLowerCase() === t);
  const effortLike = (p) => /effort|thought|reason/i.test(`${p.id} ${p.category || ""}`) && !isBool(p);
  const set = new Map(),
    unknown = [];
  for (const t of rest.split("-").filter(Boolean)) {
    const byValue = opts.find((p) => !isBool(p) && valueOf(p, t)) || opts.find((p) => valueOf(p, t));
    if (byValue) {
      set.set(byValue.id, valueOf(byValue, t));
      continue;
    }
    const flag = opts.find((p) => p.id.toLowerCase() === t && isBool(p));
    if (flag) {
      set.set(flag.id, flag.values.find((v) => /^true$/i.test(v)) || "true");
      continue;
    }
    unknown.push(t);
  }
  for (const p of opts)
    if (isBool(p) && !set.has(p.id)) set.set(p.id, p.values.find((v) => /^false$/i.test(v)) || "false");
  const effortWord = effort ? String(effort).toLowerCase() : null;
  const unknownRest = unknown.filter((t) => t !== effortWord);
  unknown.length = 0;
  unknown.push(...unknownRest);
  if (effort) {
    const e = String(effort).toLowerCase();
    const target = opts.find((p) => effortLike(p) && valueOf(p, e));
    if (target && !set.has(target.id)) set.set(target.id, valueOf(target, e));
  }
  return { base, set: [...set.entries()], unknown, effortParam: opts.find(effortLike)?.id || null };
}
/**
 * The offered id a person most plausibly meant ("opus" -> "opus[1m]", "claude-sonnet-5" -> "sonnet"): the id itself,
 * the same without its bracketed hint, then one that starts with the name or that the name starts with, then one that
 * contains it or that it contains — those two of the name's version only (`ofVersion`, the bug report's O1:
 * "claude-opus-5-5" took "opus[1m]", which the agent's own words call Opus 5).
 * @param {string | null | undefined} wanted @param {readonly string[]} [offered]
 * @param {Record<string, import("../../../core/ports.js").ModelLabel>} [labels] the agent's words for its models
 */
export function matchOffered(wanted, offered = [], labels = {}) {
  if (!wanted) return null;
  const w = String(wanted).toLowerCase();
  const norm = (x) =>
    String(x)
      .toLowerCase()
      .replace(/\[.*?\]/g, "");
  const near = offered.filter((x) => ofVersion(w, x, labels));
  return (
    offered.find((x) => String(x).toLowerCase() === w) ||
    offered.find((x) => norm(x) === w) ||
    near.find((x) => norm(x).startsWith(w) || w.startsWith(norm(x))) ||
    near.find((x) => norm(x).includes(w) || w.includes(norm(x))) ||
    null
  );
}

/**
 * The name typed on the upstream's card that a model id is (HarnessV4_Tasks E9), as the card holds it: the id whole,
 * case aside, else the id without the effort and `-fast` Filament reads off a name's end (`parseModelSuffix`, every
 * level) — a turn's id comes with them still on it (acp-turn.js `useFull`: "claude-fable-5-2[1m]-xhigh" is the card's
 * "claude-fable-5-2[1m]"), its effort travelling beside it. Null where the id is no typed name: never a typed name's
 * closest, nor one a longer name starts with.
 * @param {string | null | undefined} modelId @param {readonly unknown[] | null} [typed] the card's typed names
 * @returns {string | null}
 */
export function typedName(modelId, typed = []) {
  const id = String(modelId || "").trim().toLowerCase();
  const names = (Array.isArray(typed) ? typed : []).map(String);
  /** @param {string} low */
  const held = (low) => (low ? (names.find((t) => t.toLowerCase() === low) ?? null) : null);
  return held(id) ?? held(parseModelSuffix(id, { effort: { suffixes: EFFORT_LEVELS } }).base);
}

// How an upstream picks the agent's model: on the command line (`--model`, the default), through the session's
// config option, or not at all.
export function modelSelection(acp) {
  return acp?.modelSelection || "arg";
}
