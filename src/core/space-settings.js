// @ts-check
// A Space's settings (the owner's of 11-04: "a model selection per space so that some automated agentic work like
// Routines could run on that model without users having to open a chat"): the model a Space's agents run on where
// nothing nearer is chosen, with its effort — its routines' runs, an app's asks, a button's second look and check, the
// chats its page starts —, and what an app's ask does. Settings › Space keeps them for every Space; a Space's own (its
// ⋯ › Space settings…) stand over them, each on its own. Pure: their shapes and checks, what a Space runs on, and the
// words its page and its agents say them in.

/** The efforts a Space's model may be set at: a run takes the nearest its model takes (core/model-choice.js `effortOf`). */
export const SPACE_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);

/**
 * What an app's ask does — its page's `filament.ask(words)`, after a click in it: `ask`, a sheet over the app says what
 * would run and where, with Run it and Open in a chat; `run`, it runs at once, a chat of the Space at work in the
 * background on the Space's model; `chat`, the Start in the Space with its words, nothing sent until you send.
 */
export const SPACE_ASKS = Object.freeze(["ask", "run", "chat"]);
/** What an app's ask does where neither the Space nor Settings › Space says: it asks. */
export const ASKS_DEFAULT = "ask";
/** The words of each, as the pickers offer them. */
export const ASKS_WORDS = Object.freeze({
  ask: "Ask me first: run it here, or open a chat",
  run: "Run it at once, on the Space's model",
  chat: "Open a chat with its words",
});

/** The longest model name kept: no name Filament routes is near it. */
const MODEL_MAX = 200;
const FIELDS = ["model", "effort", "asks"];

/**
 * A Space's settings, or Settings › Space's: `model` its agents run on, `effort` that model's — kept only with it —, and
 * `asks`, what an app's ask does. Each absent where it is not set.
 * @typedef {{ model?: string, effort?: string, asks?: "ask" | "run" | "chat" }} SpaceSettings
 */

/**
 * What a Space's agents run on, and where that came from: `space` its own, `default` Settings › Space's, "" none — a
 * routine runs on its own then, and an ask asks for one. `asks`, and where it came from, the same way.
 * @typedef {{ model: string, effort: string, from: "space" | "default" | "", asks: "ask" | "run" | "chat",
 *   asksFrom: "space" | "default" | "" }} RunsOn
 */

/** @param {unknown} v */
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
/** A model's name as one is kept, or null where it reads as none. @param {unknown} v */
const nameIn = (v) => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= MODEL_MAX && !/[\u0000-\u001f\u007f]/.test(t) ? t : null;
};

/**
 * Settings as a file holds them, kept only where each reads as one: an effort without its model is none.
 * @param {unknown} raw @returns {SpaceSettings}
 */
export function settingsIn(raw) {
  /** @type {SpaceSettings} */
  const out = {};
  if (!isObj(raw)) return out;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const model = nameIn(r.model);
  if (model) {
    out.model = model;
    if (typeof r.effort === "string" && SPACE_EFFORTS.includes(r.effort)) out.effort = r.effort;
  }
  if (typeof r.asks === "string" && SPACE_ASKS.includes(r.asks)) out.asks = /** @type {SpaceSettings["asks"]} */ (r.asks);
  return out;
}

/**
 * A change to settings, or its refusal in words: each field it names set, and `null` or "" taking one away — a model
 * taken away takes its effort, which is the model's. `changed`: the fields whose value moved.
 * @param {unknown} was @param {unknown} patch
 * @returns {{ ok: true, settings: SpaceSettings, changed: string[] } | { ok: false, error: string }}
 */
export function settingsChange(was, patch) {
  if (!isObj(patch)) return { ok: false, error: "a Space's settings are a JSON object: { model?, effort?, asks? }" };
  const p = /** @type {Record<string, unknown>} */ (patch);
  const extra = Object.keys(p).filter((k) => !FIELDS.includes(k));
  if (extra.length) return { ok: false, error: `a Space's settings are model, effort and asks, not ${extra.join(", ")}` };
  const before = settingsIn(was);
  /** @type {SpaceSettings} */
  const next = { ...before };
  if ("model" in p) {
    const m = p.model ?? "";
    if (typeof m !== "string") return { ok: false, error: 'model is a model\'s name, or "" for none' };
    const name = nameIn(m);
    if (m.trim() && !name) return { ok: false, error: `model is a model's name, ${MODEL_MAX} characters at most, on one line` };
    if (name) {
      // Another model: an effort kept for the one before is that one's, unless this change says one too.
      if (name !== before.model && !("effort" in p)) delete next.effort;
      next.model = name;
    } else {
      delete next.model;
      delete next.effort;
    }
  }
  if ("effort" in p) {
    const e = p.effort ?? "";
    if (typeof e !== "string" || (e && !SPACE_EFFORTS.includes(e))) return { ok: false, error: `effort is one of ${SPACE_EFFORTS.join(", ")}, or "" for the model's own` };
    if (e && !next.model) return { ok: false, error: "an effort is its model's: choose the model first" };
    if (e) next.effort = e;
    else delete next.effort;
  }
  if ("asks" in p) {
    const a = p.asks ?? "";
    if (typeof a !== "string" || (a && !SPACE_ASKS.includes(a))) return { ok: false, error: `asks is ${SPACE_ASKS.join(", ")}, or "" for the default` };
    if (a) next.asks = /** @type {SpaceSettings["asks"]} */ (a);
    else delete next.asks;
  }
  const changed = FIELDS.filter((k) => (/** @type {any} */ (next)[k] ?? "") !== (/** @type {any} */ (before)[k] ?? ""));
  return { ok: true, settings: next, changed };
}

/**
 * What a Space's agents run on: its own model, with its own effort, where it set one; else Settings › Space's, with
 * that effort; else none. What an app's ask does: its own, else the default's, else it asks.
 * @param {unknown} own @param {unknown} defaults @returns {RunsOn}
 */
export function runsOnOf(own, defaults) {
  const o = settingsIn(own);
  const d = settingsIn(defaults);
  /** @type {Pick<RunsOn, "model" | "effort" | "from">} */
  const model = o.model ? { model: o.model, effort: o.effort || "", from: "space" } : d.model ? { model: d.model, effort: d.effort || "", from: "default" } : { model: "", effort: "", from: "" };
  /** @type {Pick<RunsOn, "asks" | "asksFrom">} */
  const asks = o.asks ? { asks: o.asks, asksFrom: "space" } : d.asks ? { asks: d.asks, asksFrom: "default" } : { asks: /** @type {"ask"} */ (ASKS_DEFAULT), asksFrom: "" };
  return { ...model, ...asks };
}
