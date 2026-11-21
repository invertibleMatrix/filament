// @ts-check
// A provider's models, or a coding agent's, as Settings shows them (HarnessV4_Settings_Plan HS-2, HS-D12, HS-D13): one
// row per model as the picker shows it — its variants folded in, ▸ for its ids — with a tick for "in the picker", what
// it can do (a chip per part, styled by who said it), its window, its list price, 30 days' use, how many agents run on
// it at once across your chats — empty, no limit; a provider's lower hold said under it — Tune ›, and on a provider's
// page its backups under its name and Backups › (lib/model-backups.js, the owner's settings cleanup of 11-09; a coding
// agent's model takes none). Under the rows: add a model by name, Refresh list
// (a provider's only: a coding agent's card asks for its models from its models line), and the models that are not for
// chat. Each change is kept at once (HS-D4)
// through the providers' state (lib/providers-state.js), which names the version the page read; the Tune sheet is the
// console's own (ui/lib/model-tune.js) in a dialog, kept on Save. Settings › Providers shows the part on a provider's
// page, Settings › Coding agents on an agent's card. Built with an injected `h`, `api` and dialogs, so it runs on the
// fake DOM; the pure helpers under it are what the tests read the words from.
import { h } from "../../lib/dom.js";
import { capsLoader, capChips, familyWindowWords, spelledWords, fmtPrice } from "../../lib/model-caps.js";
import { openTune } from "../../lib/model-tune.js";
import { api } from "./api.js";
import { ICONS } from "./icons.js";
import { confirmDialog, dialog } from "./ui.js";
import { refusedWords } from "./providers-state.js";
import { chainWords } from "./model-backups.js";
import { agentWindowWords } from "./labels.js";

/** @param {unknown} e */
const errText = (e) => String(/** @type {any} */ (e)?.message || e);
/** @param {unknown} s */
const low = (s) => String(s ?? "").toLowerCase();
/** How many families the list shows before "Show all". */
export const LIMIT = 40;
/** The words beside a Ping (HC-41). */
export const PING_SAYS = "Ping sends a tiny real request through your routes and rules; its answer shows on the row.";
/** Where a coding agent's card asks for its models again: the icon on its models line (settings/agents.js). */
export const ASK_AGAIN = "press ↻ on its models line above";

/** The most agents at once a model's limit goes to (http/admin/teams.js SLOTS_MOST). */
export const LIMIT_MOST = 64;

/**
 * A model's limit as its field holds it: null for none (empty), NaN for what a write would refuse.
 * @param {string} text
 */
export function limitOf(text) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= LIMIT_MOST ? n : NaN;
}

/** A count's place in words: 1st, 2nd, 3rd, 4th … 11th, 12th, 13th. @param {number} n */
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
/** A moment as this page's clock says it: "12:48", with its day where it was not today ("Oct 22, 21:39"). @param {number} at @param {number} now */
const clockOf = (at, now) => {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === new Date(now).toDateString() ? hm : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${hm}`;
};

/**
 * Why a model runs fewer agents than its limit now, as its row says it under the model, or "" (`GET
 * /api/subagents/slots`): its provider said too many requests, for so long; refused at the same number again, how many
 * it takes on your account, since when, and when one more is tried — or that one more is being tried now (the owner's
 * word of 10-23). With no limit set, only what the provider holds it to. Its rate-limit headers hold none: they count
 * a minute's requests (the review of 11-05).
 * @param {{ cap: number | null, set: number | null, lowered: { cap?: number, from?: string, liftsAt?: number, takes?: number, times?: number, since?: number, probing?: boolean } | null } | null | undefined} row
 * @param {number} now
 */
export function heldWords(row, now) {
  const low = row?.lowered;
  if (!row || !low || row.cap == null) return "";
  const n = row.set != null ? `${row.cap} of ${row.set}` : String(row.cap);
  const left = low.liftsAt ? low.liftsAt - now : 0;
  const mins = left > 0 ? Math.ceil(left / 60_000) : 0;
  if (low.from === "429" && Number(low.times) >= 2 && Number(low.takes) > 0) {
    const refused = `refused the ${ordinal(Number(low.takes) + 1)} ${low.times} times${low.since ? ` since ${clockOf(low.since, now)}` : ""}`;
    if (low.probing) return `Agents at once: ${n} for now, trying one more at a time — its provider ${refused}`;
    return `Agents at once: ${n} — its provider takes about ${low.takes} on your account: it ${refused}${mins ? `. One more is tried in ${mins} minute${mins === 1 ? "" : "s"}` : ""}`;
  }
  // Past its hold, no minutes: the next read says the row again.
  if (low.from === "429") return `Agents at once: ${n} for now — its provider said too many requests${mins ? `, for ${mins} more minute${mins === 1 ? "" : "s"}` : ""}`;
  return "";
}

/**
 * What runs on a model now, in its limit field's tooltip: "2 at work · 1 waits"; "" while nothing does.
 * @param {{ running?: number, waiting?: number } | null | undefined} row
 */
export function atWorkWords(row) {
  const run = Number(row?.running) || 0;
  const wait = Number(row?.waiting) || 0;
  return [run ? `${run} at work` : "", wait ? `${wait} wait${wait === 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");
}

/** A day `days` before `now`, as the day store names it. @param {number} now @param {number} days */
export function dayBefore(now, days) {
  const d = new Date(now - days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Tokens in short: 18.4M, 2.1K. @param {number} n */
export function tokWords(n) {
  if (n >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

/** Dollars in short: $41.20, $0.03. @param {number} v */
export const usdWords = (v) => `$${v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2)}`;

/**
 * 30 days' use of a model in words: its tokens, what it was paid, and on a plan what the same tokens cost at list.
 * @param {{ requests: number, tokens: number, cost: number, costN: number, listCost: number, listCostN: number } | null} r
 */
export function useWords(r) {
  if (!r?.requests) return "—";
  const tok = `${tokWords(r.tokens)} tok`;
  if (r.costN && r.cost > 0) return `${tok} · ${usdWords(r.cost)}`;
  if (r.listCostN && r.listCost > 0) return `${tok} · plan, ${usdWords(r.listCost)} at list`;
  return tok;
}

/**
 * A family's 30 days, its ids added up, from the day store's rows keyed `upstream|model`.
 * @param {Map<string, any>} use @param {string} upstream @param {{ name: string }[]} members
 */
export function familyUse(use, upstream, members) {
  const out = { requests: 0, tokens: 0, cost: 0, costN: 0, listCost: 0, listCostN: 0 };
  for (const x of members) {
    const r = use.get(`${upstream}|${x.name}`);
    if (!r) continue;
    out.requests += r.requests || 0;
    out.tokens += (r.input || 0) + (r.cacheRead || 0) + (r.cacheWrite || 0) + (r.output || 0);
    out.cost += r.cost || 0;
    out.costN += r.costN || 0;
    out.listCost += r.listCost || 0;
    out.listCostN += r.listCostN || 0;
  }
  return out.requests ? out : null;
}

/** A Ping's answer in words. @param {any} r */
export function pingWords(r) {
  if (!r) return "";
  if (r.ok) return `Answered in ${r.ms >= 1000 ? `${(r.ms / 1000).toFixed(1)} s` : `${r.ms} ms`}${r.text ? `: “${String(r.text).slice(0, 60)}”` : ""}`;
  return `Failed${r.status ? ` (${r.status})` : ""}: ${String(r.error || "no answer").slice(0, 160)}`;
}

/**
 * A model's list price in the row's words — in / out, "plan" for a coding agent — or null when it has none.
 * @param {any} entry  its card from POST /api/models/caps @param {boolean} agent
 */
export function priceWords(entry, agent) {
  const p = entry?.price;
  const has = !!p && (Number(p.input) > 0 || Number(p.output) > 0);
  // An agent's turns are paid by its plan; a row someone wrote gives them a list figure, a built-in rate never does.
  if (agent) return has && p.source === "upstream" ? `plan · ${fmtPrice(p.input)} / ${fmtPrice(p.output)}` : "plan";
  return has ? `${fmtPrice(p.input)} / ${fmtPrice(p.output)}` : null;
}

/**
 * The names a Refresh took away: in the list before it, not after it, and not typed (a typed name stays, marked).
 * @param {Set<string>} before @param {any[]} families @param {string[]} typed
 */
export function goneNames(before, families, typed) {
  const now = new Set(families.flatMap((f) => f.members.map((/** @type {any} */ x) => low(x.name))));
  const kept = new Set(typed.map(low));
  return [...before].filter((n) => !now.has(low(n)) && !kept.has(low(n)));
}

/** A button in the harness's own markup (lib/ui.js `button`), built with the injected `h`. */
const btn = (/** @type {typeof h} */ m, /** @type {string} */ label, /** @type {string} */ variant, /** @type {() => void} */ onClick, /** @type {Record<string, any>} */ extra = {}) =>
  m("button", { class: `zc-btn zc-btn-v-${variant} zc-btn-s-sm${extra.class ? ` ${extra.class}` : ""}`, type: "button", onclick: onClick, ...(extra.title ? { title: extra.title } : {}), ...(extra.label ? { "aria-label": extra.label } : {}), ...(extra.disabled ? { disabled: "" } : {}) },
    extra.html ? m("span", { class: "zc-btn-ic", html: extra.html }) : null, label ? m("span", { class: "zc-btn-label" }, label) : null);

/**
 * One provider's models, or one coding agent's.
 * @param {{ state: ReturnType<typeof import("./providers-state.js").providersState>, id: string,
 *   onToast?: (msg: string, kind?: string) => void, subscribe?: (fn: (msg: any) => void) => () => void, now?: () => number,
 *   backups?: ReturnType<typeof import("./model-backups.js").modelBackups> }} o
 *   `subscribe`: the events stream, for a provider's list found by a save's discovery (`models-discovered`); `backups`:
 *   every model's backups, on a provider's page (a coding agent's card has none)
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, dialog?: typeof dialog, confirm?: typeof confirmDialog }} [io]
 * @returns {{ el: HTMLElement, paint: () => void }}
 */
export function createModelRows(o, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const openDialog = io.dialog || dialog;
  const ask = io.confirm || confirmDialog;
  const toast = o.onToast || (() => {});
  const now = o.now || Date.now;
  const loadCaps = capsLoader(call, { families: true });
  const el = m("div", { class: "mrows", "data-upstream": o.id });
  let filter = "";
  let showAll = false;
  let adding = false;
  let refreshing = false;
  /** The families opened to their ids. @type {Set<string>} */
  const opened = new Set();
  /** Each id's last Ping: null while it is on its way. @type {Record<string, any>} */
  const pings = {};
  /** The names the last Refresh took away from the provider's list. @type {string[] | null} */
  let gone = null;
  /** The provider's typed names the caps answer was read with: a change reads the families again. */
  let typedAt = "";
  /** @type {Promise<any> | null} */
  let modelsP = null;
  /** @type {{ at: number, p: Promise<Map<string, any>> } | null} */
  let useP = null;
  /** Each model's limit across your chats and what holds it now, by `upstream\0model`, read at most every 15 s. @type {{ at: number, p: Promise<Map<string, any>> } | null} */
  let slotsP = null;
  let seq = 0;
  /** What the last draw read of the provider's own list, for Add by name: its listed names, and what a turn says. */
  let lastSaw = { listedLow: /** @type {Set<string> | null} */ (null), notListed: "" };
  // The filter and the add-by-name row stay put across draws, so what is typed in them keeps its place and its focus.
  const search = /** @type {any} */ (m("input", { class: "zc-input mrows-filter", type: "search", placeholder: "Filter", spellcheck: "false" }));
  search.oninput = () => {
    filter = low(search.value.trim());
    paint();
  };
  /** @type {any} */
  let addBox = null;

  const models = (force = false) => {
    if (force || !modelsP) modelsP = call(`/models${force ? "?refresh=1" : ""}`).catch((e) => ({ models: [], upstreams: {}, error: errText(e) }));
    return modelsP;
  };
  const usage = () => {
    const t = now();
    if (useP && t - useP.at < 60_000) return useP.p;
    const p = call(`/usage/days?from=${dayBefore(t, 29)}`)
      .then((r) => new Map((r?.total?.rows || []).map((/** @type {any} */ x) => [`${x.upstream}|${x.model}`, x])))
      .catch(() => new Map());
    useP = { at: t, p };
    return p;
  };

  /** @param {any} v */
  const slotMap = (v) => new Map((v?.rows || []).map((/** @type {any} */ r) => [`${r.upstream}\0${String(r.model).toLowerCase()}`, r]));
  const slots = () => {
    const t = now();
    if (slotsP && t - slotsP.at < 15_000) return slotsP.p;
    const p = call("/subagents/slots").then(slotMap).catch(() => new Map());
    slotsP = { at: t, p };
    return p;
  };
  /**
   * A model's limit written at once (`PUT /api/subagents/slots`), or taken away (`n` null); the answer is every row again.
   * @param {string} upstream @param {string} model @param {number | null} n
   */
  async function setLimit(upstream, model, n) {
    try {
      const v = await call("/subagents/slots", { method: "PUT", body: { upstream, model, n } });
      slotsP = { at: now(), p: Promise.resolve(slotMap(v)) };
      toast(n == null ? `${model} runs agents with no limit` : `${model} runs up to ${n} agent${n === 1 ? "" : "s"} at once across your chats`);
    } catch (e) {
      toast(errText(e), "err");
    }
    paint();
  }

  const name = () => String(o.state.get(o.id)?.name || o.id);
  /** A change of the provider's, kept at once; its toast once kept, its refusal said. @param {Record<string, any>} patch @param {string} words */
  async function keep(patch, words) {
    try {
      await o.state.patch(o.id, patch);
      toast(words);
      return true;
    } catch (e) {
      toast(refusedWords(e, name()), "err");
      paint();
      return false;
    }
  }

  /** The harness's face for the Tune sheet: a wide dialog that asks before edits Save has not taken go. */
  const tuneKit = () => /** @type {import("../../lib/model-tune.js").TuneKit} */ ({
    h: m,
    applyLabel: "Save",
    open: (title, box, g) => {
      /** @type {any} */
      let d = null;
      let asking = false;
      d = openDialog({
        title,
        body: box,
        wide: true,
        guard: () => {
          if (!g.dirty()) return true;
          if (!asking) {
            asking = true;
            const [q, ...rest] = g.discard.split("? ");
            void ask({ title: `${q}?`, description: rest.join("? "), confirmLabel: "Discard", destructive: true }).then((yes) => {
              asking = false;
              if (yes) d.close(true);
            });
          }
          return false;
        },
      });
      return { close: (force) => d.close(!!force) };
    },
    button: (b) => btn(m, b.label, b.primary ? "default" : "outline", b.onClick || (() => {}), { title: b.title }),
  });

  function paint() {
    const u = o.state.get(o.id);
    const my = ++seq;
    if (!u) {
      el.replaceChildren(m("p", { class: "mrows-quiet" }, o.state.failed() || "Reading its models…"));
      return;
    }
    const typed = JSON.stringify(u.models || []);
    if (typed !== typedAt) {
      typedAt = typed;
      loadCaps.clear();
    }
    void Promise.all([models(), usage(), loadCaps(u), slots(), o.backups?.ready]).then(([mm, use, cr, held]) => {
      if (my === seq) draw(u, mm, use, cr, held);
    });
  }

  /** @param {any} u @param {any} mm @param {Map<string, any>} use @param {any} cr @param {Map<string, any>} held */
  function draw(u, mm, use, cr, held) {
    const agent = !!u.agent;
    const who = u.name || u.id;
    const info = mm.upstreams?.[u.id] || {};
    const hidden = new Set((u.hiddenModels || []).map(low));
    // hiddenModels speaks for the names a provider lists: a name a route spells exactly is always offered
    const hidable = (/** @type {any} */ x) => x.source !== "route";
    const isHidden = (/** @type {any} */ x) => hidable(x) && hidden.has(low(x.name));
    /** @type {any[]} */
    const fams = cr.families || [];
    const chat = fams.filter((f) => f.kind !== "other");
    const other = fams.filter((f) => f.kind === "other");
    const allIds = fams.flatMap((f) => f.members);
    const hiddenCount = allIds.filter(isHidden).length;
    const shownCount = chat.filter((f) => f.members.some((/** @type {any} */ x) => !isHidden(x))).length;
    const typedLow = new Set((u.models || []).map(low));
    const listedLow = Array.isArray(info.listed) ? new Set(info.listed.map(low)) : null;
    const keyedLow = new Set((Array.isArray(info.keyed) ? info.keyed : []).map(low));
    const notListed = agent ? `${who} does not list it: a turn on it says what the agent did with it.` : `It is not in ${who}'s own list: Ping tells whether it answers.`;
    const match = (/** @type {any} */ f) => !filter || [f.id, f.name, ...f.members.map((/** @type {any} */ x) => x.id)].some((s) => low(s).includes(filter));
    const shown = chat.filter(match);
    const list = showAll || filter ? shown : shown.slice(0, LIMIT);
    const anyUse = fams.some((f) => familyUse(use, u.id, f.members));

    /** @param {string[]} names @param {boolean} hide @param {string} label */
    const setHidden = (names, hide, label) => {
      const lows = new Set(names.map(low));
      const next = (u.hiddenModels || []).filter((/** @type {string} */ x) => !lows.has(low(x)));
      if (hide) next.push(...names);
      void keep({ hiddenModels: next }, hide ? `${label} is out of every picker; its name still answers when asked for` : `${label} is in every picker again`);
    };
    /**
     * @param {string} label  what a screen reader says @param {string} said  the model, as the toast names it
     * @param {boolean} on @param {boolean} disabled @param {string[]} names @param {string} title
     */
    const tick = (label, said, on, disabled, names, title) => {
      const t = /** @type {any} */ (m("input", { type: "checkbox", class: "mrow-tick", "aria-label": label, title, ...(disabled ? { disabled: "" } : {}) }));
      t.checked = on;
      t.onchange = () => setHidden(names, !t.checked, said);
      return t;
    };
    /** A name you typed: said, with a × that takes it off your typed names. @param {string} n */
    const typedMark = (n) => {
      if (!typedLow.has(low(n))) return null;
      const out = !!listedLow && !listedLow.has(low(n));
      return m("span", { class: "mrow-typed", title: out ? `You typed this name. ${notListed}` : `You typed this name; ${who} lists it too, so it stays when you take it off here` },
        out ? "typed, not in its list" : "typed",
        m("button", { type: "button", class: "mrow-x", "aria-label": `Take ${n} off the names you typed`, title: `Take ${n} off the names you typed`, html: ICONS.x,
          onclick: () => void keep({ models: (u.models || []).filter((/** @type {string} */ x) => low(x) !== low(n)) }, `${n} is no longer one of your typed names`) }));
    };
    /** A model the account's API key offers, which its agent does not list itself (`keyed` of GET /api/models): said. @param {string} n */
    const keyMark = (n) => (keyedLow.has(low(n)) ? m("span", { class: "mrow-quiet mrow-keyed", title: `Anthropic lists it for this account's API key. ${who} does not list it itself.` }, "from your API key") : null);
    /** @param {string} id */
    const ping = async (id) => {
      pings[id] = null;
      paint();
      try {
        pings[id] = await call("/models/ping", { method: "POST", body: { model: id } });
      } catch (e) {
        pings[id] = { ok: false, error: errText(e) };
      }
      paint();
    };
    /** @param {string} id */
    const pingBtn = (id) => btn(m, pings[id] === null ? "Pinging…" : "Ping", "ghost", () => void ping(id), { title: `${PING_SAYS} (${id})`, label: `Ping ${id}`, disabled: pings[id] === null, class: "mrow-ping" });
    /** @param {string} id */
    const pingLine = (id) => (pings[id] ? m("div", { class: `mrow-said${pings[id].ok ? " is-ok" : " is-bad"}` }, pingWords(pings[id])) : null);
    /** A model's limit row as the server read it: its number set, and what holds it now — its name in any case, as the server matches it. @param {any} x */
    const slotOf = (x) => held.get(`${u.id}\0${String(x.name).toLowerCase()}`) || null;
    /**
     * How many agents run on a model at once across your chats: its field, empty for no limit (the owner's of 11-05:
     * none set, none), each change written as it is made.
     * @param {any} x
     */
    const limitFig = (x) => {
      const r = slotOf(x);
      const busy = atWorkWords(r);
      const field = /** @type {any} */ (m("input", { class: "zc-input mrow-limit-in", type: "number", min: "1", max: String(LIMIT_MOST), step: "1", placeholder: "no limit",
        "aria-label": `${x.name}: how many agents at once across your chats — empty for no limit`,
        title: `How many of Filament's agents run on ${x.name} at once, across your chats: empty, no limit${busy ? ` · now ${busy}` : ""}` }));
      field.value = r?.set != null ? String(r.set) : "";
      field.onchange = () => {
        const n = limitOf(field.value);
        if (Number.isNaN(n)) {
          toast(`Agents at once is a whole number from 1 to ${LIMIT_MOST}, or empty for no limit`, "err");
          field.value = r?.set != null ? String(r.set) : "";
          return;
        }
        if (n === (r?.set ?? null)) return;
        void setLimit(u.id, x.name, n);
      };
      field.onkeydown = (/** @type {KeyboardEvent} */ e) => { if (e.key === "Enter") { e.preventDefault(); field.blur?.(); } };
      return m("span", { class: "mrow-fig mrow-limit", "data-k": "At once" }, field);
    };
    /** A provider's lower hold on a model's agents now, under the model; none, nothing. @param {any} x */
    const heldLine = (x) => {
      const w = heldWords(slotOf(x), now());
      return w ? m("div", { class: "mrow-said is-warn" }, w) : null;
    };
    /** A coding agent that runs a model in a window of its own, not the one said for it here, under the model. @param {any} x */
    const ownWindowLine = (x) => {
      const md = (mm.models || []).find((/** @type {any} */ r) => r.id === x.id);
      const w = md?.agent_window ? agentWindowWords({ who, model: x.name, runs: md.agent_window, set: md.context_window, add: md.agent_window_add }) : null;
      return w ? m("div", { class: "mrow-said is-warn" }, w) : null;
    };
    /** A family of several ids says its limits on its ids: how many are set. @param {any[]} members */
    const famLimit = (members) => {
      const set = members.filter((x) => slotOf(x)?.set != null).length;
      return m("span", { class: `mrow-fig${set ? "" : " is-none"}`, "data-k": "At once", title: "Each id has its own limit: ▸ shows them" }, set ? `${set} of ${members.length} set` : "no limit");
    };

    /** @param {any} f @param {any} entry */
    const tune = (f, entry) => {
      const lead = f.members.find((/** @type {any} */ x) => x.id === f.lead) || f.members[0];
      if (!entry?.caps) return toast(cr.error ? `Could not read what ${lead.id} can do: ${cr.error}` : `${lead.id} does not reach ${who} in the saved configuration`, "err");
      openTune({
        u, x: { id: lead.id, upstreamModel: lead.name }, entry, load: loadCaps, agent,
        models: allIds.map((/** @type {any} */ x) => ({ id: x.id, upstreamModel: x.name })),
        onApply: async ({ key, row }) => {
          try {
            await o.state.patch(o.id, { pricingRow: { key, row } });
          } catch (e) {
            throw new Error(refusedWords(e, who));
          }
          toast(`${key} saved; every model picker reads it again`);
        },
      }, tuneKit());
    };

    /** A model's backups as the view has them: a provider's model only, where a route takes it. @param {any} f */
    const routeOf = (f) => (agent || !o.backups ? null : o.backups.rowOf(u.id, f));
    /** Its backups under its name, where it has some. @param {any} r */
    const chainLine = (r) => (r?.backups.length ? m("div", { class: "mdl-chain has" }, chainWords(r)) : null);
    /** Backups ›, where its backups are set here. @param {any} r @param {string} label */
    const backupsBtn = (r, label) => (r?.can && o.backups ? btn(m, "Backups ›", "ghost", () => o.backups?.open(r), { label: `Backups for ${label}`, title: `Where ${label} goes when ${who} fails`, class: "mrow-backups" }) : null);

    /** @param {any} f */
    const famRows = (f) => {
      const entry = cr.byId.get(f.lead);
      const route = routeOf(f);
      const lead = f.members.find((/** @type {any} */ x) => x.id === f.lead) || f.members[0];
      const many = f.members.length > 1;
      const open = opened.has(f.id);
      const can = f.members.filter(hidable);
      const off = can.filter(isHidden);
      const allOff = !!can.length && off.length === can.length;
      const t = tick(`In the picker: ${f.name}`, f.name, !allOff, !can.length, can.map((/** @type {any} */ x) => x.name),
        can.length ? (allOff ? "Out of the picker: tick to offer it (its names still answer when asked for)" : off.length ? `${off.length} of its ${can.length} ids are out: untick to take them all out, tick to offer them all` : "In the picker: untick to take it out (its names still answer when asked for)") : "A route names it, so it is always offered");
      if (off.length && !allOff) t.indeterminate = true;
      const chips = entry ? capChips(m, entry, { window: false }) : [];
      if (!chips.length) chips.push(m("span", { class: "mrow-quiet", title: cr.error ? `could not be read: ${cr.error}` : "nothing known beyond plain requests: tune it to say what it can do" }, cr.error ? "can do: not read" : "plain requests"));
      const price = priceWords(entry, agent);
      const toggle = many
        ? m("button", { type: "button", class: "mrow-fold", "aria-expanded": open ? "true" : "false", title: open ? "Fold its ids" : `Show its ${f.members.length} ids`,
            onclick: () => { if (open) opened.delete(f.id); else opened.add(f.id); paint(); } }, `${open ? "▾" : "▸"} ${f.members.length} ids`)
        : null;
      const sub = allOff ? "out of the picker" : off.length ? `${off.length} of its ids out of the picker` : null;
      return [
        m("div", { class: `mrow${allOff ? " is-off" : ""}`, "data-family": f.id },
          t,
          m("div", { class: "mrow-model" },
            m("div", { class: "mrow-name" }, m("span", { class: "mrow-nm", title: f.id }, f.name), toggle, many ? null : keyMark(lead.name), many ? null : typedMark(lead.name), sub ? m("span", { class: "mrow-quiet" }, sub) : null),
            m("div", { class: "mrow-caps" }, ...chips),
            // HC-46: a model in the picker with no list price says what that means, and offers to set one
            price == null && !allOff ? m("div", { class: "mrow-noprice" }, "No price: spend shows tokens only · ", m("button", { type: "button", class: "mrow-link", onclick: () => tune(f, entry) }, "Set price")) : null,
            chainLine(route),
            many ? null : pingLine(lead.id),
            many ? null : heldLine(lead),
            many ? null : ownWindowLine(lead)),
          m("div", { class: "mrow-figs" },
            m("span", { class: "mrow-fig", "data-k": "Window", title: "The standard context window, then the others a chat may choose" }, familyWindowWords(entry?.offer?.window, entry?.caps?.window)),
            m("span", { class: `mrow-fig${price == null ? " is-none" : ""}`, "data-k": agent ? "Billed" : "Price", title: price == null ? "No list price known: Tune › gives it one; only the cost figures read it" : "List price per million tokens, in / out: Tune › changes it" }, price ?? "–"),
            anyUse ? m("span", { class: "mrow-fig", "data-k": "30 days", title: "Its tokens and spend through this provider in the last 30 days, its ids added up" }, useWords(familyUse(use, u.id, f.members))) : null,
            many ? famLimit(f.members) : limitFig(lead)),
          m("span", { class: "mrow-acts" }, many ? null : pingBtn(lead.id), btn(m, "Tune ›", "ghost", () => tune(f, entry), { title: `What ${f.name} can do here, and its list price`, label: `Tune ${f.name}`, class: "mrow-tune" }), backupsBtn(route, f.name))),
        ...(many && open ? f.members.map((/** @type {any} */ x) =>
          m("div", { class: `mrow is-member${isHidden(x) ? " is-off" : ""}`, "data-member": x.id },
            tick(`In the picker: ${x.id}`, x.name, !isHidden(x), !hidable(x), [x.name], hidable(x) ? (isHidden(x) ? "Out of the picker: tick to offer it" : "In the picker: untick to take just this id out") : "A route names it, so it is always offered"),
            m("div", { class: "mrow-model" },
              m("div", { class: "mrow-name" }, m("code", { class: "mrow-id" }, x.name), m("span", { class: "mrow-quiet" }, spelledWords(x)), keyMark(x.name), typedMark(x.name)),
              pingLine(x.id),
              heldLine(x),
              ownWindowLine(x)),
            m("div", { class: "mrow-figs" },
              m("span", { class: "mrow-fig" }),
              m("span", { class: "mrow-fig" }),
              anyUse ? m("span", { class: "mrow-fig", "data-k": "30 days" }, useWords(familyUse(use, u.id, [x]))) : null,
              limitFig(x)),
            m("span", { class: "mrow-acts" }, pingBtn(x.id)))) : []),
      ];
    };

    // Why nothing, or not everything, shows.
    const why = u.enabled === false
      ? `Switched off: none of ${who}'s models is offered.`
      : info.discovering
        ? `Asking ${who} for its models…`
        : info.error
          ? `${who} did not list its models: ${String(info.error).replace(/\.\s*$/, "")}. ${agent ? `Once that is fixed, ${ASK_AGAIN}.` : "Check its key above, then Refresh list."}`
          : !agent && u.prefix == null && !u.routes?.some((/** @type {any} */ r) => r.as === "first" && r.enabled)
            ? "Nothing reaches it yet: give it a prefix under Advanced below, and your chats ask for its models as prefix/model."
            : fams.length
              ? null
              : cr.error
                ? `Its models could not be read: ${cr.error}`
                : info.unasked
                  ? `Not asked yet: Filament asks ${who} for its models when you ${agent ? ASK_AGAIN : "press Refresh list"}.`
                  : `No model names came back. Add one by name, or check the connection.`;

    search.setAttribute("aria-label", `Filter ${who}'s models`);
    lastSaw = { listedLow, notListed };
    const head = m("div", { class: "mrows-head" },
      m("span", { class: "mrows-count" }, chat.length ? `${shownCount} of ${chat.length} in the picker` : ""),
      m("span", { class: "grow" }),
      chat.length > 8 ? search : null,
      allIds.length > 1 ? btn(m, "Hide all", "ghost", () => void keep({ hiddenModels: [...new Set([...(info.all || []), ...allIds.filter(hidable).map((/** @type {any} */ x) => x.name)].filter(Boolean))] }, `Every model of ${who} is out of the picker: tick the few you want`), { title: "Take every model out of the picker, then tick the few you want" }) : null,
      hiddenCount ? btn(m, `Show all (${hiddenCount} out)`, "ghost", () => void keep({ hiddenModels: [] }, `Every model of ${who} is in the picker`)) : null);
    const cols = m("div", { class: "mrow is-head", "aria-hidden": "true" },
      m("span", {}), m("span", {}, "Model · what it can do"),
      m("div", { class: "mrow-figs" }, m("span", { class: "mrow-fig" }, "Window"), m("span", { class: "mrow-fig" }, agent ? "Billed" : "List price, in / out"), anyUse ? m("span", { class: "mrow-fig" }, "30 days") : null,
        m("span", { class: "mrow-fig", title: "How many of Filament's agents run on the model at once, across your chats: empty, no limit" }, "Agents at once")),
      m("span", {}));
    const otherBox = other.length
      ? m("details", { class: "mrows-other" },
          m("summary", {}, `Other models, not for chat · ${other.length}`, m("span", { class: "mrows-hint" }, " — embedding, rerank, speech and image models: never in a chat's picker; the ticked ones are listed for your tools")),
          m("div", { class: "mrows-list" }, ...other.filter(match).map((f) => {
            const x = f.members[0];
            return m("div", { class: `mrow is-other${isHidden(x) ? " is-off" : ""}`, "data-other": x.id },
              tick(`Listed for your tools: ${x.id}`, x.name, !isHidden(x), !hidable(x), [x.name], hidable(x) ? "Ticked: listed for your tools (never in a chat's picker)" : "A route names it, so it is always listed"),
              m("div", { class: "mrow-model" }, m("div", { class: "mrow-name" }, m("code", { class: "mrow-id" }, x.name)), pingLine(x.id)),
              m("span", { class: "mrow-acts" }, pingBtn(x.id)));
          })))
      : null;

    el.replaceChildren(...[
      head,
      why ? m("p", { class: `mrows-why${info.error || cr.error ? " is-bad" : ""}` }, why) : null,
      cr.errors?.length ? m("p", { class: "mrows-why is-bad" }, `Its model rows have problems a save would refuse: ${cr.errors.join("; ")}`) : null,
      // Why the models its API key can use beyond its own list were not asked for, or did not come (`keyNote`): its own
      // list stands, so the line is no error's.
      info.keyNote ? m("p", { class: "mrows-why mrows-key" }, String(info.keyNote)) : null,
      list.length ? m("div", { class: `mrows-list${anyUse ? " has-use" : ""}` }, cols, ...list.flatMap(famRows)) : null,
      shown.length > LIMIT && !filter ? btn(m, showAll ? "Show fewer" : `Show all ${shown.length}`, "ghost", () => { showAll = !showAll; paint(); }) : null,
      filter && !shown.length ? m("p", { class: "mrows-hint" }, `No model of ${who} matches “${filter}”.`) : null,
      otherBox,
      gone?.length ? m("p", { class: "mrows-why" }, `Gone from ${who}'s list at the last Refresh: ${gone.slice(0, 8).join(", ")}${gone.length > 8 ? ` and ${gone.length - 8} more` : ""}.`) : null,
      adding ? (addBox ||= addRow()) : null,
      m("div", { class: "mrows-acts" },
        adding ? null : btn(m, "Add a model by name", "outline", () => { adding = true; addBox = null; paint(); }, { html: ICONS.plus }),
        // A coding agent's card asks for its models from its models line (settings/agents.js): one refresh, not two
        // (the owner's settings cleanup of 11-09).
        agent ? null : btn(m, refreshing ? "Asking…" : "Refresh list", "outline", () => void refresh(fams, u), { disabled: refreshing, title: `Ask ${who} for its model list again` }),
        m("span", { class: "mrows-hint" }, `${PING_SAYS}${hiddenCount ? ` ${hiddenCount} id${hiddenCount === 1 ? " is" : "s are"} out of the picker.` : ""}`)),
    ].filter(Boolean));
  }

  /**
   * Add a model by name (HarnessV4_Tasks E9, HC-38): kept in the provider's typed names, so every picker offers it; a
   * name it lists already but is out of the picker comes back in. Built once while it is open; what it checks against
   * is the provider as it stands when Add is pressed.
   */
  function addRow() {
    const said = m("span", { class: "mrows-said", role: "status" });
    const field = /** @type {any} */ (m("input", { class: "zc-input mrows-name-in", type: "text", placeholder: "Its name, as the provider spells it", "aria-label": `A model's name at ${name()}`, spellcheck: "false", autocomplete: "off" }));
    const close = () => {
      adding = false;
      addBox = null;
    };
    const add = async () => {
      const u = o.state.get(o.id);
      const n = String(field.value || "").trim();
      if (!u) return;
      if (!n) return void said.replaceChildren("Type a model's name first");
      if (n.includes(",")) return void said.replaceChildren("A model's name has no comma");
      const who = u.name || u.id;
      const typedLow = new Set((u.models || []).map(low));
      const { listedLow, notListed } = lastSaw;
      const l = low(n);
      const hiddenNow = (u.hiddenModels || []).some((/** @type {string} */ x) => low(x) === l);
      const listedHere = !!listedLow?.has(l);
      if ((typedLow.has(l) || listedHere) && !hiddenNow) return void said.replaceChildren(typedLow.has(l) ? `${n} is one of your typed names already` : `${n} is in ${who}'s own list already`);
      /** @type {Record<string, any>} */
      const patch = {};
      if (hiddenNow) patch.hiddenModels = (u.hiddenModels || []).filter((/** @type {string} */ x) => low(x) !== l);
      if (!typedLow.has(l) && !listedHere) patch.models = [...(u.models || []), n];
      // a refused change leaves the row open, with the name still in it
      if (await keep(patch, `${n} ${hiddenNow && (typedLow.has(l) || listedHere) ? "is in every picker again" : "is kept: every picker offers it"}${!hiddenNow && listedLow && !listedHere ? `. ${notListed}` : ""}`)) {
        close();
        paint();
      }
    };
    field.onkeydown = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Enter") { e.preventDefault(); void add(); }
      else if (e.key === "Escape") { e.preventDefault(); close(); paint(); }
    };
    const pingIt = () => {
      const n = String(field.value || "").trim();
      if (!n) return void said.replaceChildren("Type a model's name first");
      const prefix = o.state.get(o.id)?.prefix;
      const id = prefix ? `${prefix}/${n}` : n;
      said.replaceChildren("Pinging…");
      call("/models/ping", { method: "POST", body: { model: id } }).then((r) => said.replaceChildren(pingWords(r)), (e) => said.replaceChildren(pingWords({ ok: false, error: errText(e) })));
    };
    queueMicrotask(() => field.focus?.());
    return m("div", { class: "mrows-add" }, field, btn(m, "Add", "default", () => void add()), btn(m, "Ping", "ghost", pingIt, { title: PING_SAYS }), btn(m, "Cancel", "ghost", () => { close(); paint(); }), said);
  }

  /** Ask the provider again (HC-40): new names come in; the ones it no longer lists are said. @param {any[]} fams @param {any} u */
  async function refresh(fams, u) {
    const before = new Set(fams.flatMap((f) => f.members.map((/** @type {any} */ x) => String(x.name))));
    refreshing = true;
    paint();
    try {
      await models(true);
      loadCaps.clear();
      const cr = await loadCaps(u);
      gone = goneNames(before, cr.families || [], u.models || []);
      const after = new Set((cr.families || []).flatMap((/** @type {any} */ f) => f.members.map((/** @type {any} */ x) => low(x.name))));
      const fresh = [...after].filter((n) => ![...before].some((b) => low(b) === n)).length;
      toast(`Asked ${u.name || u.id} again: ${fresh ? `${fresh} new` : "nothing new"}${gone.length ? `, ${gone.length} gone from its list` : ""}`);
    } finally {
      refreshing = false;
      paint();
    }
  }

  const offs = [o.state.listen(() => {
    if (el.isConnected === false) return stop();
    modelsP = null;
    paint();
  })];
  if (o.backups)
    offs.push(o.backups.listen(() => {
      if (el.isConnected === false) return stop();
      paint();
    }));
  if (o.subscribe)
    offs.push(o.subscribe((msg) => {
      if (msg?.type !== "models-discovered") return;
      if (el.isConnected === false) return stop();
      modelsP = null;
      loadCaps.clear();
      paint();
    }));
  function stop() {
    while (offs.length) offs.pop()?.();
  }
  paint();
  return { el, paint };
}
