// @ts-check
// Settings › Providers (HarnessV4_Settings_Plan HS-2, HS-D12 to HS-D15): where models come from when you hold a key or
// an account. The coding agents are Settings › Coding agents' (one line here points there).
// - *The list:* the backups switch at its head (failover-card.js, since the owner's settings cleanup of 11-09), a row
//   per provider — its health dot, its name, its plan and how many of its models are in the picker (or its last test's
//   failure, in red), today's spend — then Add a provider.
// - *A provider's page* takes the list's place: its head (Test, the switch), Connection (the key, sealed, with Replace;
//   how it bills; its plan), Models (lib/model-rows.js, the part a coding agent's card shows too, with each model's
//   backups here: lib/model-backups.js), Advanced (its id, name, prefix — Add fills it in, so it waits here since the
//   cleanup of 11-09 —, kind, auth style, wire API, models path, address, extra headers, the rule overrides the console
//   holds), and Remove, which first says what goes with it. Qoder cloud signs in with the browser instead of a key.
// - *Add a provider:* one sheet, top to bottom — which one, its plan, the key, the prefix (filled for you), the test
//   (its models as the picker will show them, each with a tick), then Add. A failed test still lets you add.
// Every change is kept at once (HS-D4) through the providers' state (lib/providers-state.js), which names the version
// the page read; a sheet is kept on its button. Built with an injected `h`, `api`, dialogs and timer, so it runs on the
// fake DOM.
import { h } from "../../lib/dom.js";
import { billingAt, fieldsOf, fillUrl, freePrefix, hostWord, keptHeaderWords, placeholders, prefixProblem, variantWords } from "../../lib/providers.js";
import { api } from "../lib/api.js";
import { onBus } from "../lib/bus.js";
import { keptField as kept } from "../lib/fields.js";
import { ICONS } from "../lib/icons.js";
import { createModelRows, dayBefore, usdWords } from "../lib/model-rows.js";
import { modelBackups } from "../lib/model-backups.js";
import { providersState, refusedWords } from "../lib/providers-state.js";
import { routeFor } from "../lib/router.js";
import { confirmDialog, dialog } from "../lib/ui.js";
import { agoWords } from "../lib/mcp-list.js";
import { failoverCard } from "./failover-card.js";

/** @param {unknown} e */
const errText = (e) => String(/** @type {any} */ (e)?.message || e);
/** The line that points to the other page (HS-D12). */
export const AGENTS_LINE = "Claude Code, Codex and Cursor are under Coding agents.";
/** What Add's foot says (HS-D14). */
export const ADD_FOOT = "A failed test still lets you add; its words stay on the row.";
/** The kinds of address another server may speak. */
const KINDS = Object.freeze([["openai-compatible", "OpenAI's API"], ["anthropic-compatible", "Anthropic's API"]]);
const AUTH = Object.freeze([["auto", "Usual for its kind"], ["bearer", "Authorization: Bearer"], ["x-api-key", "x-api-key"], ["both", "Both"]]);
const WIRE = Object.freeze([["auto", "Find out"], ["chat-completions", "/chat/completions"], ["responses", "/responses only"]]);
const TYPES = Object.freeze([["openai-compatible", "OpenAI-compatible"], ["anthropic-compatible", "Anthropic-compatible"], ["openai", "OpenAI"], ["anthropic", "Anthropic"]]);
/** A tile's hue, by the provider's id: the same provider wears the same one everywhere. */
const HUES = ["indigo", "orange", "purple", "blue", "teal", "green", "pink", "cyan", "red", "yellow"];

/** @param {string} id */
export const hueOf = (id) => HUES[[...String(id)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length];

/**
 * A test's answer in a row's words (HC-30): how fast it answered, or what it said when it refused.
 * @param {any} t  a provider's `test` @param {number} now
 * @returns {{ text: string, bad: boolean } | null}
 */
export function testWords(t, now) {
  if (!t) return null;
  if (t.ok) return { text: `Answered in ${t.ms} ms · tested ${agoWords(t.at, now)}`, bad: false };
  return { text: t.status ? `It answered ${t.status}: ${t.error || "refused"}` : `No answer: ${t.error || "it did not connect"}`, bad: true };
}

/**
 * A provider's plan, in the list's words: the catalogue plan its address is, or how it bills.
 * @param {any} u
 */
export function planWords(u) {
  if (u.type === "qoder") return u.qoder?.signedIn ? `Qoder account${u.qoder.email ? ` · ${u.qoder.email}` : ""}` : "Qoder account · not signed in";
  const b = billingAt(u, u.provider ? { plan: u.provider.plan } : null).billing;
  if (u.provider) return u.provider.plans.length > 1 ? u.provider.plan.label : b === "plan" ? "A plan" : "Per token";
  return `${hostOf(u.baseUrl)} · ${b === "plan" ? "a plan" : "per token"}`;
}

/** @param {string} url */
const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url || "no address";
  }
};

/**
 * The routes table as the prefix check reads it (lib/providers.js `prefixProblem`), from the providers' views: every
 * route names some upstream, so each one is in a view, as its prefix route or among the routes that name it.
 * @param {any[]} views
 */
export function routesOf(views) {
  return {
    upstreams: views.map((v) => ({ id: v.id, name: v.name })),
    routes: views.flatMap((v) => [...(v.prefix != null ? [{ match: `${v.prefix}/*` }] : []), ...(v.routes || []).map((/** @type {any} */ r) => ({ match: r.match }))]),
  };
}

/** A button in the harness's own markup (lib/ui.js `button`), built with the injected `h`. */
const btn = (/** @type {typeof h} */ m, /** @type {string} */ label, /** @type {string} */ variant, /** @type {() => void} */ onClick, /** @type {Record<string, any>} */ extra = {}) =>
  m("button", { class: `zc-btn zc-btn-v-${variant} zc-btn-s-sm${extra.class ? ` ${extra.class}` : ""}`, type: "button", onclick: onClick, ...(extra.title ? { title: extra.title } : {}), ...(extra.label ? { "aria-label": extra.label } : {}), ...(extra.disabled ? { disabled: "" } : {}) },
    extra.html ? m("span", { class: "zc-btn-ic", html: extra.html }) : null, label ? m("span", { class: "zc-btn-label" }, label) : null);

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void, now?: () => number, start?: string | null }} [cb]  `start`:
 *   "provider:<id>" opens on that provider's page (a Settings search result)
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, dialog?: typeof dialog, confirm?: typeof confirmDialog,
 *   subscribe?: (fn: (msg: any) => void) => () => void, open?: (url: string) => any, later?: (fn: () => void, ms: number) => any,
 *   state?: ReturnType<typeof providersState> }} [io]
 */
export function renderProviders(body, cb = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const openDialog = io.dialog || dialog;
  const ask = io.confirm || confirmDialog;
  const subscribe = io.subscribe || onBus;
  const openPage = io.open || ((url) => window.open(url, "_blank", "noopener"));
  const later = io.later || ((fn, ms) => setTimeout(fn, ms));
  const toast = cb.onToast || (() => {});
  const now = cb.now || Date.now;
  const state = io.state || providersState(call, subscribe);
  /** The provider whose page is open; null shows the list. @type {string | null} */
  let open = typeof cb.start === "string" && cb.start.startsWith("provider:") ? cb.start.slice("provider:".length) : null;
  let query = "";
  /** The catalogue (GET /api/providers), read once. @type {any[] | null} */
  let catalogue = null;
  /** What the picker shows (GET /api/models), for the list's counts. @type {any} */
  let models = null;
  /** 30 days' spend by provider, and when it was read (read again after a minute). @type {Map<string, number> | null} */
  let spend30 = null;
  let spentAt = 0;
  /** Each provider's page parts, kept across paints so what was typed and opened stays. @type {Map<string, any>} */
  const pages = new Map();
  /** A test on its way, by provider. @type {Set<string>} */
  const testing = new Set();
  /** Every model's backups, read the first time a provider's page opens. @type {ReturnType<typeof modelBackups> | null} */
  let backups = null;

  const root = m("div", { class: "prov-page" });
  body.replaceChildren(root);
  const alive = () => root.isConnected !== false;

  const views = () => (state.all() || []).filter((u) => !u.agent);
  /** @param {any} u */
  const nameOf = (u) => String(u?.name || u?.id || "");

  /** What the page shows beside the providers: the catalogue, the picker's counts, 30 days' spend. */
  async function readSide() {
    const fresh = now() - spentAt < 60_000;
    const [cat, mm, use] = await Promise.all([
      catalogue ? Promise.resolve(null) : call("/providers").catch(() => null),
      call("/models").catch(() => null),
      fresh ? Promise.resolve(null) : call(`/usage/days?from=${dayBefore(now(), 29)}`).catch(() => null),
    ]);
    if (cat) catalogue = cat.providers || [];
    if (mm) models = mm;
    if (use) {
      spentAt = now();
      spend30 = new Map();
      for (const r of use.total?.rows || []) if (r.costN) spend30.set(r.upstream, (spend30.get(r.upstream) || 0) + (Number(r.cost) || 0));
    }
    paint();
  }

  // ---- the list ---------------------------------------------------------------------------------------------------

  /** @param {any} u */
  function listRow(u) {
    const t = testWords(u.test, now());
    const info = models?.upstreams?.[u.id];
    const listed = Array.isArray(info?.all) ? info.all.length : null;
    const inPicker = (models?.families || []).filter((/** @type {any} */ f) => f.upstream === u.id && f.kind !== "other").length;
    const bad = t?.bad || !!info?.error;
    const sub = t?.bad ? t.text : info?.error ? `It did not list its models: ${info.error}` : [planWords(u), listed != null ? `${listed} listed` : null, models ? `${inPicker} in the picker` : null].filter(Boolean).join(" · ");
    const today = u.today?.costN && u.today.cost > 0 ? `${usdWords(u.today.cost)} today` : billingAt(u, u.provider ? { plan: u.provider.plan } : null).billing === "plan" ? "plan" : "—";
    return m("button", { type: "button", class: `prov-row${u.enabled ? "" : " is-off"}`, "data-provider": u.id, onclick: () => go(u.id) },
      m("span", { class: `prov-dot${bad ? " is-bad" : t ? " is-ok" : ""}`, "aria-hidden": "true" }),
      m("span", { class: "prov-row-text" },
        m("span", { class: "prov-row-name" }, nameOf(u), u.enabled ? null : m("span", { class: "prov-off" }, "off")),
        m("span", { class: `prov-row-sub${bad ? " is-bad" : ""}` }, sub)),
      m("span", { class: "prov-fig" }, today),
      m("span", { class: "prov-chev", "aria-hidden": "true", html: ICONS.chevronRight }));
  }

  // The list's parts stay put across paints, so the search field keeps its focus while the rows under it change.
  const search = /** @type {any} */ (m("input", { class: "zc-input prov-search", type: "search", placeholder: "Search providers", "aria-label": "Search the providers", spellcheck: "false" }));
  search.oninput = () => {
    query = String(search.value || "");
    fillRows();
  };
  const rowsBox = m("div", { class: "prov-list" });
  // The backups switch heads the list (the owner's settings cleanup of 11-09).
  const failover = failoverCard({ onToast: toast, alive }, { h: m, api: call, subscribe });
  const listActs = m("div", { class: "prov-acts" }, btn(m, "Add a provider", "default", () => void addSheet(), { html: ICONS.plus }));
  const listFoot = m("p", { class: "prov-foot" }, AGENTS_LINE, " ", m("a", { href: routeFor("settings", { section: "agents" }) }, "Open Coding agents"));

  function fillRows() {
    const all = views();
    const q = query.trim().toLowerCase();
    const shown = all.filter((u) => !q || [u.id, u.name, u.baseUrl, u.provider?.name].some((s) => String(s || "").toLowerCase().includes(q)));
    rowsBox.replaceChildren(...(!all.length
      ? [m("p", { class: "prov-empty" }, "No provider yet. Add one with its key, and its models join the picker.")]
      : shown.length ? shown.map(listRow) : [m("p", { class: "prov-quiet" }, `No provider matches “${query.trim()}”.`)]));
  }

  /** HC-44: a long list is searched. */
  function list() {
    fillRows();
    return [failover.el, views().length > 8 ? search : null, rowsBox, listActs, listFoot];
  }

  // ---- a provider's page -------------------------------------------------------------------------------------------

  /** @param {string | null} id */
  function go(id) {
    open = id;
    paint();
    root.scrollIntoView?.({ block: "start" });
  }

  /** A change of one provider, kept at once; its toast, or its refusal said. @param {any} u @param {Record<string, any>} patch @param {string} words */
  async function keep(u, patch, words) {
    try {
      await state.patch(u.id, patch);
      if (words) toast(words);
      return true;
    } catch (e) {
      toast(refusedWords(e, nameOf(u)), "err");
      paint();
      return false;
    }
  }

  /** @param {any} u */
  async function test(u) {
    testing.add(u.id);
    paint();
    try {
      const r = await call(`/upstreams/${encodeURIComponent(u.id)}/test`);
      const t = testWords({ ...r, at: now() }, now());
      toast(`${nameOf(u)}: ${t?.text}${r.ok && r.models != null ? ` · ${r.models} models` : ""}`, r.ok ? "" : "err");
    } catch (e) {
      toast(`${nameOf(u)}: ${errText(e)}`, "err");
    } finally {
      testing.delete(u.id);
      await state.read();
    }
  }

  /**
   * A text field kept on Enter or when left (HS-D4); Esc puts it back.
   * @param {string} value @param {(v: string) => Promise<boolean>} save @param {Record<string, any>} attrs
   */
  const keptField = (value, save, attrs) => kept(m, value, save, { class: "zc-input prov-in", ...attrs });

  /** A row of a card: its label and words left, its control right. @param {string} label @param {string | null} sub @param {...any} ctl */
  const cardRow = (label, sub, ...ctl) =>
    m("div", { class: "prov-crow" }, m("div", { class: "prov-crow-text" }, m("div", { class: "prov-crow-label" }, label), sub ? m("div", { class: "prov-crow-sub" }, sub) : null), m("div", { class: "prov-crow-ctl" }, ...ctl));

  /** @param {any} u */
  function keyRow(u) {
    const part = pages.get(u.id);
    if (part.replacing) {
      const f = /** @type {any} */ (m("input", { class: "zc-input prov-in prov-key-in", type: "password", placeholder: "Paste the new key", autocomplete: "off", "aria-label": `${nameOf(u)}'s new key` }));
      const save = async () => {
        const v = String(f.value || "").trim();
        part.replacing = false;
        if (!v) return void paint(); // HC-34: an empty field keeps the key it has
        await keep(u, { apiKey: v }, `${nameOf(u)}'s key replaced: Test checks it`);
        paint();
      };
      f.onkeydown = (/** @type {KeyboardEvent} */ e) => {
        if (e.key === "Enter") { e.preventDefault(); void save(); }
        else if (e.key === "Escape") { e.preventDefault(); part.replacing = false; paint(); }
      };
      queueMicrotask(() => f.focus?.());
      return cardRow("Key", "Sealed on this computer. An empty field keeps the key it has.", f, btn(m, "Save", "default", () => void save()), btn(m, "Cancel", "ghost", () => { part.replacing = false; paint(); }));
    }
    const keyUrl = u.provider?.keyUrl;
    // A key sealed with a secret.key this computer does not have is kept as it is, said so, never as no key.
    if (u.key.unreadable)
      return cardRow("Key", "Sealed with another secret.key: Filament cannot read it. Put that secret.key back beside config.json and restart Filament to read it again; a key set here replaces it.",
        m("span", { class: "prov-masked", title: "Kept as it was sealed" }, "unreadable"),
        btn(m, "Replace", "outline", () => { part.replacing = true; paint(); }),
        keyUrl ? m("a", { class: "prov-link", href: keyUrl, target: "_blank", rel: "noopener noreferrer" }, "Get a key") : null);
    return cardRow("Key", u.key.stored ? "Sealed on this computer: never shown again" : u.provider?.keyless ? "It runs on this computer: no key needed" : "No key yet",
      u.key.stored ? m("span", { class: "prov-masked", title: "The key's first and last letters" }, u.key.masked) : null,
      btn(m, u.key.stored ? "Replace" : "Set a key", "outline", () => { part.replacing = true; paint(); }),
      keyUrl ? m("a", { class: "prov-link", href: keyUrl, target: "_blank", rel: "noopener noreferrer" }, "Get a key") : null);
  }

  /** Qoder cloud's account (HC-47): signed in with the browser, not a key. @param {any} u */
  function accountRow(u) {
    const part = pages.get(u.id);
    const q = u.qoder || {};
    const signIn = async () => {
      part.signing = { words: "Opening Qoder's sign-in page…" };
      paint();
      try {
        const st = await call(`/qoder/${encodeURIComponent(u.id)}/login/start`, { method: "POST" });
        openPage(st.url);
        part.signing = { nonce: st.nonce, words: `Sign in on the page that opened${st.userCode ? ` (its code: ${st.userCode})` : ""}. This waits until you do, or until Qoder says the code ran out.`, url: st.url };
        paint();
        const poll = async () => {
          if (!part.signing || part.signing.nonce !== st.nonce) return;
          /** @type {any} */
          let p;
          try {
            p = await call(`/qoder/${encodeURIComponent(u.id)}/login/poll`, { method: "POST", body: { nonce: st.nonce } });
          } catch (e) {
            part.signing = null;
            toast(`Qoder's sign-in: ${errText(e)}`, "err");
            return void paint();
          }
          if (p.status === "pending") return void later(poll, 2000);
          part.signing = null;
          if (p.status === "ok") toast(`Signed in to Qoder as ${p.email || p.name || p.userId}`);
          else toast(p.status === "expired" ? "Qoder's sign-in code ran out: press Sign in again" : `Qoder's sign-in: ${p.error || p.status}`, "err");
          await state.read();
        };
        later(poll, 2000);
      } catch (e) {
        part.signing = null;
        toast(`Qoder's sign-in: ${errText(e)}`, "err");
        paint();
      }
    };
    const signOut = async () => {
      if (!(await ask({ title: `Sign out of Qoder on ${nameOf(u)}?`, description: "Its models stop answering until you sign in again.", confirmLabel: "Sign out", destructive: true }))) return;
      try {
        await call(`/qoder/${encodeURIComponent(u.id)}/logout`, { method: "POST" });
        toast("Signed out of Qoder");
      } catch (e) {
        toast(errText(e), "err");
      }
      await state.read();
    };
    if (part.signing)
      return cardRow("Account", part.signing.words,
        part.signing.url ? m("a", { class: "prov-link", href: part.signing.url, target: "_blank", rel: "noopener noreferrer" }, "Open it again") : null,
        btn(m, "Cancel", "ghost", () => { part.signing = null; paint(); }));
    return cardRow("Account", q.signedIn ? `Signed in${q.email ? ` as ${q.email}` : ""}${q.expiresAt ? ` · until ${new Date(q.expiresAt).toLocaleDateString()}` : ""}` : "Not signed in: its models answer once you are",
      q.signedIn ? btn(m, "Sign out", "outline", () => void signOut()) : btn(m, "Sign in", "default", () => void signIn()));
  }

  /** @param {any} u */
  function billingRow(u) {
    const known = u.provider ? { plan: u.provider.plan } : null;
    const at = billingAt(u, known);
    const own = billingAt({ billing: null }, known).billing;
    const pickIt = (/** @type {"metered" | "plan"} */ b) => {
      if (b === at.billing) return;
      void keep(u, { billing: b === own ? null : b }, `${nameOf(u)} bills ${b === "plan" ? "on a plan: each request is paid $0, its list price kept for analytics" : "per token: each request is paid at its list price"}`);
    };
    const seg = m("div", { class: "set-seg", role: "tablist", "aria-label": "How it bills" },
      ...[["metered", "Per token"], ["plan", "A plan"]].map(([id, words]) => m("button", { class: `set-seg-btn${at.billing === id ? " on" : ""}`, type: "button", role: "tab", "aria-selected": at.billing === id ? "true" : "false", onclick: () => pickIt(/** @type {any} */ (id)) }, words)));
    return cardRow("How it bills", at.billing === "plan" ? "A plan's spend shows tokens and what they cost at list" : "Each request is paid at its list price", seg);
  }

  /** @param {any} u */
  function planRow(u) {
    const p = u.provider;
    if (!p || p.plans.length < 2) return null;
    const fields = fieldsOf(p.plan.baseUrl, u.baseUrl);
    const sel = /** @type {any} */ (m("select", { class: "set-select", "aria-label": "Its plan" },
      ...p.plans.map((/** @type {any} */ pl) => {
        const url = fillUrl(pl.baseUrl, fields);
        return m("option", { value: pl.id, ...(pl.id === p.plan.id ? { selected: "" } : {}), ...(url == null ? { disabled: "" } : {}) }, `${pl.label}${url == null ? ` (needs its ${placeholders(pl.baseUrl).join(", ")}: type its address under Advanced)` : ""}`);
      })));
    sel.onchange = () => {
      const pl = p.plans.find((/** @type {any} */ x) => x.id === sel.value);
      const url = pl ? fillUrl(pl.baseUrl, fields) : null;
      if (!pl || url == null || pl.id === p.plan.id) return;
      // the models path follows the plan when it was the old plan's own
      const path = (u.modelsPath || "") === (p.plan.modelsPath || "") ? { modelsPath: pl.modelsPath || "" } : {};
      void keep(u, { baseUrl: url, ...path }, `${nameOf(u)} is on ${pl.label} now: ${pl.billing === "plan" ? "a plan" : "billed per token"}`);
    };
    return cardRow("Plan", p.plan.billing === "plan" ? "A subscription: requests use your plan" : "Billed per token", sel);
  }

  /** @param {any} u */
  function prefixRow(u) {
    const part = pages.get(u.id);
    const others = (u.routes || []).filter((/** @type {any} */ r) => r.enabled);
    const field = keptField(u.prefix ?? "", async (v) => {
      part.prefixError = null;
      part.free = null;
      try {
        await state.patch(u.id, { prefix: v });
        toast(`Your chats ask for ${nameOf(u)}'s models as ${v}/… now`);
        return true;
      } catch (e) {
        part.prefixError = refusedWords(e, nameOf(u));
        part.free = /** @type {any} */ (e)?.body?.free || null;
        paint();
        return false;
      }
    }, { class: "zc-input prov-in prov-prefix", placeholder: "none", "aria-label": "Its prefix" });
    return m("div", { class: "prov-crow-wrap" },
      cardRow("Prefix", u.prefix == null ? "No prefix route: give it one and your chats reach its models as prefix/model" : "What your chats put before a model's name", field, m("span", { class: "prov-slash" }, "/")),
      part.prefixError ? m("p", { class: "prov-err" }, part.prefixError, part.free ? [" ", btn(m, `Use ${part.free}`, "outline", () => void (async () => { part.prefixError = null; const was = part.free; part.free = null; if (await keep(u, { prefix: was }, `Your chats ask for ${nameOf(u)}'s models as ${was}/… now`)) paint(); })())] : []) : null,
      others.length ? m("p", { class: "prov-note" }, `Your routes name it too: ${others.map((/** @type {any} */ r) => `${r.match}${r.as === "backup" ? " (as a backup)" : ""}`).join(", ")}. They are set in the console.`) : null);
  }

  /**
   * Extra headers (HC-45): a value that carries a key shows as set, with Replace, and is never sent back. A kept one holds
   * its name, as the console's card holds it: the server finds the value by that name, and Replace frees it.
   * @param {any} u
   */
  function headersBox(u) {
    const part = pages.get(u.id);
    /** @type {{ key: string, value: string, kept: boolean }[]} */
    const rows = (part.headers ||= Object.entries(u.headers || {}).map(([k, v]) => ({ key: k, value: v === "__SECRET__" ? "" : String(v), kept: v === "__SECRET__" })));
    const box = m("div", { class: "prov-pairs" },
      ...rows.map((r, i) => {
        const k = /** @type {any} */ (m("input", { class: "zc-input prov-in prov-hk", type: "text", value: r.key, placeholder: "Header-Name", "aria-label": "Header name", spellcheck: "false" }));
        k.oninput = () => { if (!r.kept) r.key = String(k.value || ""); };
        k.onchange = () => {
          if (!r.kept || String(k.value || "").trim() === r.key) return;
          k.value = r.key;
          toast(keptHeaderWords(r.key), "err");
        };
        const v = r.kept
          ? m("span", { class: "prov-masked" }, m("span", { "aria-label": "set, hidden" }, "••••••••"), btn(m, "Replace", "ghost", () => { r.kept = false; r.value = ""; paint(); }))
          : /** @type {any} */ (m("input", { class: "zc-input prov-in", type: "text", value: r.value, placeholder: "value", "aria-label": `Value of ${r.key || "the new header"}`, spellcheck: "false", oninput: (/** @type {any} */ e) => { r.value = String(e.target.value || ""); } }));
        return m("div", { class: "prov-pair" }, k, v, m("button", { type: "button", class: "prov-x", title: "Remove this header", "aria-label": "Remove this header", html: ICONS.x, onclick: () => { rows.splice(i, 1); paint(); } }));
      }),
      m("div", { class: "prov-pair-acts" },
        btn(m, "Add header", "ghost", () => { rows.push({ key: "", value: "", kept: false }); paint(); }, { html: ICONS.plus }),
        btn(m, "Save headers", "outline", () => void (async () => {
          const map = Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.kept ? "__SECRET__" : r.value]));
          if (await keep(u, { headers: map }, `${nameOf(u)}'s headers saved`)) part.headers = null;
          paint();
        })())));
    return box;
  }

  /** @param {any} u */
  function advanced(u) {
    const part = pages.get(u.id);
    /** @param {string} key @param {readonly (readonly string[])[]} opts @param {string} value @param {string} label */
    const select = (key, opts, value, label) => {
      const s = /** @type {any} */ (m("select", { class: "set-select", "aria-label": label }, ...opts.map(([v, l]) => m("option", { value: v, ...(v === value ? { selected: "" } : {}) }, l))));
      s.onchange = () => void keep(u, { [key]: s.value }, `${nameOf(u)}'s ${label.toLowerCase()} saved`);
      return s;
    };
    const openaiWire = u.type === "openai" || u.type === "openai-compatible";
    const det = /** @type {any} */ (m("details", { class: "prov-adv", ...(part.advOpen ? { open: "" } : {}) },
      m("summary", {}, "Advanced: id, prefix, kind, auth style, wire API, models path, address, extra headers"),
      m("div", { class: "prov-card" },
        cardRow("Id", "What the console and the records call it", m("code", { class: "prov-id" }, u.id)),
        cardRow("Name", null, keptField(u.name, (v) => keep(u, { name: v }, `Renamed ${v || u.id}`), { "aria-label": "Its name" })),
        prefixRow(u),
        u.type === "qoder" ? null : cardRow("Kind", "The API it speaks", select("type", TYPES, u.type, "Kind")),
        u.type === "qoder" ? null : cardRow("Auth style", "How the key goes with each request", select("authStyle", AUTH, u.authStyle, "Auth style")),
        openaiWire ? cardRow("Wire API", "Which OpenAI endpoint it takes", select("wireApi", WIRE, u.wireApi, "Wire API")) : null,
        u.type === "qoder" ? null : cardRow("Models path", "Blank: its address's /models", keptField(u.modelsPath, (v) => keep(u, { modelsPath: v }, `${nameOf(u)}'s models path saved`), { placeholder: "/v1/models", "aria-label": "Models path" })),
        u.type === "qoder" ? null : cardRow("Address", null, keptField(u.baseUrl, (v) => keep(u, { baseUrl: v }, `${nameOf(u)}'s address saved: Test checks it`), { class: "zc-input prov-in prov-url", "aria-label": "Its address" })),
        u.type === "qoder" ? null : m("div", { class: "prov-crow is-stack" }, m("div", { class: "prov-crow-text" }, m("div", { class: "prov-crow-label" }, "Extra headers"), m("div", { class: "prov-crow-sub" }, "A header that carries a key is never shown again")), headersBox(u)),
        // HC-50: the console's rule overrides are kept on every save here, and said
        u.ruleOverrides ? cardRow("Rule overrides", `${u.ruleOverrides} rule override${u.ruleOverrides === 1 ? "" : "s"}, set in the console`, m("a", { class: "prov-link", href: "/ui/#destinations:upstreams", target: "_blank", rel: "noopener" }, "Open the console")) : null)));
    det.ontoggle = () => { part.advOpen = !!det.open; };
    return det;
  }

  /** What goes with a provider, then the provider (HS-D15). @param {any} u */
  async function remove(u) {
    /** @type {any} */
    let r;
    try {
      r = await state.removal(u.id);
    } catch (e) {
      return toast(errText(e), "err");
    }
    const routes = r.routes || [];
    const last = r.last30 || { requests: 0, cost: null };
    const goes = m("ul", { class: "prov-goes" },
      r.prefix != null ? m("li", {}, "Its prefix route ", m("code", {}, `${r.prefix}/*`)) : null,
      ...routes.map((/** @type {any} */ x) => m("li", {}, "Your route ", m("code", {}, x.match), x.as === "backup" ? " loses it as a backup" : " goes: it sends to it first")),
      m("li", {}, last.requests ? `It answered ${last.requests.toLocaleString("en-US")} request${last.requests === 1 ? "" : "s"} in the last 30 days${last.cost ? ` (${usdWords(last.cost)})` : ""}: a chat on one of its models is told when it next sends.` : "It answered no request in the last 30 days."));
    const d = openDialog({
      title: `Remove ${nameOf(u)}?`,
      description: routes.length ? "Your routes name it, so they are changed too: removing it alone would leave them pointing nowhere." : "Its key goes with it.",
      body: goes,
      actions: [
        { label: "Cancel", variant: "outline", onClick: () => d.close() },
        { label: routes.length ? "Remove it and those routes" : "Remove", variant: "destructive", onClick: () => void (async () => {
          d.close(true);
          try {
            const out = await state.remove(u.id, routes.length > 0);
            pages.delete(u.id);
            open = null;
            toast(`${out.name} removed, with ${out.routes === 1 ? "its route" : `${out.routes} routes`}`);
          } catch (e) {
            toast(refusedWords(e, nameOf(u)), "err");
          }
          paint();
        })() },
      ],
    });
  }

  /** @param {any} u */
  function providerPage(u) {
    backups ||= modelBackups({ onToast: toast, alive }, { h: m, api: call, dialog: openDialog, confirm: ask, subscribe });
    if (!pages.has(u.id)) pages.set(u.id, { rows: createModelRows({ state, id: u.id, onToast: toast, subscribe, now, backups }, { h: m, api: call, dialog: openDialog, confirm: ask }) });
    const part = pages.get(u.id);
    const t = testWords(u.test, now());
    const s30 = spend30?.get(u.id);
    const sw = m("button", { class: `set-switch${u.enabled ? " on" : ""}`, type: "button", role: "switch", "aria-checked": u.enabled ? "true" : "false", "aria-label": `Use ${nameOf(u)}`,
      onclick: () => void keep(u, { enabled: !u.enabled }, u.enabled ? `${nameOf(u)} is off: its models leave every picker, and a chat on one is told when it next sends` : `${nameOf(u)} is on: its models are in the picker again`) });
    return [
      m("button", { type: "button", class: "prov-back", onclick: () => go(null) }, "‹ Providers"),
      m("div", { class: "prov-head" },
        m("span", { class: "prov-tile", style: `--tile: var(--color-sys-${hueOf(u.provider?.id || u.id)})`, "aria-hidden": "true" }, (/[\p{L}\p{N}]/u.exec(nameOf(u))?.[0] || "?").toUpperCase()),
        m("div", { class: "prov-head-text" },
          m("h3", { class: "prov-name" }, nameOf(u)),
          m("div", { class: `prov-meta${t?.bad ? " is-bad" : ""}` },
            m("span", { class: `prov-dot${t ? (t.bad ? " is-bad" : " is-ok") : ""}`, "aria-hidden": "true" }),
            [t ? t.text : "Not tested since Filament started", s30 != null ? `30 days: ${usdWords(s30)}` : null].filter(Boolean).join(" · "))),
        m("div", { class: "prov-head-acts" }, btn(m, testing.has(u.id) ? "Testing…" : "Test", "outline", () => void test(u), { disabled: testing.has(u.id), title: "Asks it for its model list with its key" }), sw)),
      m("h4", { class: "prov-h" }, "Connection"),
      m("div", { class: "prov-card" },
        u.type === "qoder" ? accountRow(u) : keyRow(u),
        u.type === "qoder" ? null : billingRow(u),
        planRow(u)),
      m("h4", { class: "prov-h" }, "Models"),
      part.rows.el,
      advanced(u),
      m("div", { class: "prov-acts is-end" }, btn(m, "Remove this provider…", "destructive", () => void remove(u))),
    ];
  }

  // ---- add a provider ----------------------------------------------------------------------------------------------

  /** The catalogue's tiles, then Qoder's, then another address. */
  const tiles = () => [
    ...(catalogue || []),
    { id: "qoder-cloud", qoder: true, name: "Qoder", blurb: "Your Qoder account's cloud models. You sign in with your browser; no key.", plans: [] },
    { id: "custom", custom: true, name: "Another address", blurb: "Ollama, LM Studio, a gateway: any server that speaks OpenAI's or Anthropic's API.", plans: [{ id: "custom", label: "Custom", baseUrl: "", billing: "metered" }] },
  ];

  /**
   * Add a provider (HS-D14): which one, its plan, the key, the prefix (filled for you), the test, Add. Its fields are
   * built once per choice, so typing never loses its place: the test's answer and the foot are drawn on their own.
   */
  async function addSheet() {
    if (!catalogue) {
      try {
        catalogue = (await call("/providers")).providers || [];
      } catch (e) {
        return toast(`The provider list could not be read: ${errText(e)}`, "err");
      }
    }
    const F = {
      p: /** @type {any} */ (null), plan: "", kind: "openai-compatible", key: "", url: "", fields: /** @type {Record<string, string>} */ ({}),
      prefix: "", prefixTyped: false, probe: /** @type {any} */ (null), seq: 0, asking: false, adding: false, q: "", famQ: "",
      off: /** @type {Set<string>} */ (new Set()), otherOn: /** @type {Set<string>} */ (new Set()), error: "",
    };
    /** @type {any} */
    let timer = null;
    const tilesBox = m("div", { class: "prov-tiles" });
    const stepsBox = m("div", { class: "prov-steps" });
    const resultBox = m("div", { class: "prov-result-host" });
    const famsBox = m("div", { class: "prov-fams" });
    const countEl = m("span", { class: "prov-count" });
    const prefixWhy = m("span", { class: "prov-err" });
    const footSays = m("span", { class: "prov-add-says" });
    const addBtn = btn(m, "Add", "default", () => void add());
    const tileSearch = /** @type {any} */ (m("input", { class: "zc-input prov-search", type: "search", placeholder: "Search providers", "aria-label": "Search the catalogue", spellcheck: "false" }));
    tileSearch.oninput = () => {
      F.q = String(tileSearch.value || "");
      fillTiles();
    };
    const famSearch = /** @type {any} */ (m("input", { class: "zc-input prov-search", type: "search", placeholder: "Filter models", "aria-label": "Filter its models", spellcheck: "false" }));
    famSearch.oninput = () => {
      F.famQ = String(famSearch.value || "");
      fillFams();
    };
    const box = m("div", { class: "prov-add" },
      m("div", { class: "prov-step" }, m("div", { class: "prov-step-t" }, "Which one"), tileSearch, tilesBox),
      stepsBox,
      m("div", { class: "prov-add-foot" }, footSays, btn(m, "Cancel", "outline", () => d.close()), addBtn));
    const dirty = () => !!F.p && !!(F.key || F.url || Object.values(F.fields).some(Boolean));
    let confirming = false;
    const d = openDialog({
      title: "Add a provider",
      description: AGENTS_LINE,
      glyph: m("span", { class: "prov-tile is-glyph", style: "--tile: var(--color-sys-orange)", "aria-hidden": "true", html: ICONS.cable }),
      body: box,
      wide: true,
      onClose: () => clearTimeout(timer),
      guard: () => {
        if (!dirty()) return true;
        if (!confirming) {
          confirming = true;
          void ask({ title: "Discard this provider?", description: "Nothing is added until you press Add.", confirmLabel: "Discard", destructive: true }).then((yes) => {
            confirming = false;
            if (yes) d.close(true);
          });
        }
        return false;
      },
    });
    const cfg = () => routesOf(state.all() || []);
    const planNow = () => F.p?.plans.find((/** @type {any} */ x) => x.id === F.plan) || F.p?.plans[0];
    const typeNow = () => (F.p?.custom ? F.kind : F.p?.type);
    const urlNow = () => (F.p?.custom ? F.url.trim() : fillUrl(planNow()?.baseUrl || "", F.fields) || "");
    const needsKey = () => !F.p?.keyless && !F.p?.custom && !F.p?.qoder;
    const ready = () => !!urlNow() && (!needsKey() || !!F.key);
    const soon = () => {
      clearTimeout(timer);
      F.seq++;
      F.probe = null;
      drawResult();
      if (ready()) timer = later(() => void probe(), 600);
    };

    function fillTiles() {
      const q = F.q.trim().toLowerCase();
      const all = tiles().filter((p) => !q || [p.name, p.id, p.blurb].some((x) => String(x || "").toLowerCase().includes(q)));
      tilesBox.replaceChildren(...(all.length ? all.map((p) => m("button", { type: "button", class: `prov-ptile${F.p?.id === p.id ? " on" : ""}`, "data-tile": p.id, title: p.blurb, "aria-pressed": F.p?.id === p.id ? "true" : "false", onclick: () => pick(p) },
        m("span", { class: "prov-tile is-small", style: `--tile: var(--color-sys-${p.custom ? "green" : hueOf(p.id)})`, "aria-hidden": "true" }, p.custom ? "…" : (/[\p{L}\p{N}]/u.exec(p.name)?.[0] || "?").toUpperCase()),
        m("span", { class: "prov-ptile-name" }, p.name.replace(/ \(.*\)$/, "")))) : [m("p", { class: "prov-quiet" }, `No provider matches “${F.q.trim()}”: Another address takes any server.`)]));
    }

    /** @param {any} p */
    function pick(p) {
      clearTimeout(timer);
      Object.assign(F, { p, plan: p.plans[0]?.id || "", key: "", url: "", fields: {}, prefix: p.qoder ? "" : p.custom ? "" : freePrefix(cfg(), p.prefix), prefixTyped: false, probe: null, error: "", off: new Set(), otherOn: new Set(), famQ: "" });
      famSearch.value = "";
      fillTiles();
      drawSteps();
      if (ready()) void probe();
    }

    /** One step of the sheet: its title and what it holds. @param {string} title @param {...any} kids */
    const step = (title, ...kids) => m("div", { class: "prov-step" }, m("div", { class: "prov-step-t" }, title), ...kids);

    /** The steps after Which one, for the provider picked: built once per choice (a plan or a kind redraws them). */
    function drawSteps() {
      const p = F.p;
      if (!p) return void stepsBox.replaceChildren();
      const pl = planNow();
      const out = [];
      if (p.qoder) {
        out.push(step("Its account", m("p", { class: "prov-hint" }, "Qoder cloud's models come with your Qoder account. Add it, then press Sign in on its page: your browser opens Qoder's sign-in.")));
        stepsBox.replaceChildren(...out);
        return drawFoot();
      }
      if (p.custom) {
        const urlIn = /** @type {any} */ (m("input", { class: "zc-input prov-in prov-url", type: "text", value: F.url, placeholder: "http://localhost:11434/v1", "aria-label": "Its address", spellcheck: "false" }));
        urlIn.oninput = () => {
          F.url = String(urlIn.value || "");
          if (!F.prefixTyped) {
            F.prefix = freePrefix(cfg(), hostWord(F.url.trim()));
            prefixIn.value = F.prefix;
            sayPrefix();
          }
          soon();
        };
        out.push(step("Its address",
          m("div", { class: "set-seg", role: "tablist", "aria-label": "It speaks" }, ...KINDS.map(([id, words]) => m("button", { class: `set-seg-btn${F.kind === id ? " on" : ""}`, type: "button", role: "tab", "aria-selected": F.kind === id ? "true" : "false", onclick: () => { if (F.kind === id) return; F.kind = id; drawSteps(); soon(); } }, words))),
          urlIn));
      } else if (p.plans.length > 1) {
        out.push(step("Its plan",
          m("div", { class: "set-seg", role: "tablist", "aria-label": "Its plan" }, ...p.plans.map((/** @type {any} */ x) => m("button", { class: `set-seg-btn${x.id === F.plan ? " on" : ""}`, type: "button", role: "tab", "aria-selected": x.id === F.plan ? "true" : "false", onclick: () => { if (x.id === F.plan) return; F.plan = x.id; drawSteps(); soon(); } }, x.label))),
          m("span", { class: "prov-hint" }, pl?.billing === "plan" ? (p.keyless ? "Runs on this computer: nothing is billed." : "A subscription: requests use your plan.") : "Billed per token.")));
      }
      // HC-31: a plan's address may ask for fields (a region, a workspace); a dot or a slash is refused
      const holes = placeholders(pl?.baseUrl || "");
      if (holes.length)
        out.push(step("Its address needs", ...holes.map((k) => {
          const def = (p.fields || []).find((/** @type {any} */ x) => x.id === k) || { id: k, label: k };
          const said = m("span", { class: "prov-hint" }, def.hint || "");
          const i = /** @type {any} */ (m("input", { class: "zc-input prov-in", type: "text", value: F.fields[k] || "", placeholder: def.placeholder || "", "aria-label": def.label, spellcheck: "false" }));
          i.oninput = () => {
            F.fields[k] = String(i.value || "").trim();
            const bad = !!F.fields[k] && fillUrl(`{${k}}`, F.fields) == null;
            said.className = bad ? "prov-err" : "prov-hint";
            said.replaceChildren(bad ? "Letters, digits and dashes only: a dot or a slash would send your key elsewhere" : def.hint || "");
            soon();
          };
          return m("label", { class: "prov-field" }, m("span", { class: "prov-field-k" }, def.label), i, said);
        })));
      if (!p.keyless) {
        const keyIn = /** @type {any} */ (m("input", { class: "zc-input prov-in prov-key-in", type: "password", value: F.key, placeholder: p.custom ? "Its key, if it asks for one" : "Paste the key", autocomplete: "off", "aria-label": "The key" }));
        keyIn.oninput = () => {
          F.key = String(keyIn.value || "");
          soon();
        };
        const keyUrl = pl?.keyUrl || p.keyUrl;
        out.push(step("The key", keyIn, m("span", { class: "prov-hint" }, "Kept sealed on this computer. Never shown again.", keyUrl ? [" ", m("a", { class: "prov-link", href: keyUrl, target: "_blank", rel: "noopener noreferrer" }, "Get a key")] : [])));
      }
      const prefixIn = /** @type {any} */ (m("input", { class: "zc-input prov-in prov-prefix", type: "text", value: F.prefix, placeholder: "prefix", "aria-label": "Prefix", spellcheck: "false" }));
      prefixIn.oninput = () => {
        F.prefix = String(prefixIn.value || "").trim();
        F.prefixTyped = true;
        F.error = "";
        sayPrefix();
        drawFoot();
      };
      out.push(step("Prefix", m("span", { class: "prov-prefix-wrap" }, prefixIn, m("span", { class: "prov-slash" }, "/")),
        m("span", { class: "prov-hint" }, "Filled for you: what your chats put before a model's name."), prefixWhy));
      out.push(step("Test", resultBox));
      stepsBox.replaceChildren(...out);
      sayPrefix();
      drawResult();
    }

    /** HC-33: a prefix that is taken says so as it is typed. */
    function sayPrefix() {
      prefixWhy.replaceChildren(F.prefix ? prefixProblem(cfg(), F.prefix) : F.p?.custom ? "" : "Type a prefix: the word your chats put before each model's name.");
    }

    async function probe() {
      clearTimeout(timer);
      if (!F.p || F.p.qoder || !ready()) return;
      const seq = ++F.seq;
      F.asking = true;
      F.probe = null;
      drawResult();
      /** @type {any} */
      let r;
      try {
        r = await call("/providers/probe", { method: "POST", body: {
          upstream: { id: F.prefix || "draft", type: typeNow(), baseUrl: urlNow(), apiKey: F.key, authStyle: "auto", modelsPath: planNow()?.modelsPath || "", headers: {}, enabled: true, rules: {} },
          prefix: F.prefix || F.p.prefix || "provider", provider: F.p.custom ? "" : F.p.id } });
      } catch (e) {
        r = { ok: false, status: 0, error: errText(e) };
      }
      if (seq !== F.seq) return; // a newer ask began: this answer is old
      F.asking = false;
      F.probe = r;
      if (r.ok) {
        F.off = new Set(F.p.pickNone ? (r.families || []).map((/** @type {any} */ f) => f.id) : []);
        F.otherOn = new Set();
      }
      drawResult();
    }

    /** The test's answer: its models as the picker will show them, each with a tick (HC-29), or its words (HC-30). */
    function drawResult() {
      const r = F.probe;
      if (F.asking) resultBox.replaceChildren(m("div", { class: "prov-result is-wait" }, m("div", { class: "prov-result-head" }, m("span", { class: "prov-dot is-wait" }), `Asking ${F.p.custom ? urlNow() : F.p.name.replace(/ \(.*\)$/, "")} for its models…`)));
      else if (!r) {
        const missing = !urlNow() ? (F.p?.custom ? "Type its address, and it is tested." : "Fill in what its address needs, and it is tested.") : needsKey() && !F.key ? "Paste the key, and it is tested." : "";
        resultBox.replaceChildren(m("div", { class: "prov-result is-idle" }, m("span", { class: "prov-hint" }, missing || "Not tested yet."), ready() ? btn(m, "Test", "outline", () => void probe()) : null));
      } else if (!r.ok)
        resultBox.replaceChildren(m("div", { class: "prov-result is-bad" }, m("div", { class: "prov-result-head" }, m("span", { class: "prov-dot is-bad" }), testWords({ ...r, at: now() }, now())?.text), btn(m, "Test again", "outline", () => void probe())));
      else {
        const fams = r.families || [];
        resultBox.replaceChildren(m("div", { class: "prov-result" },
          m("div", { class: "prov-result-head" }, m("span", { class: "prov-dot is-ok" }), `Answered · ${(r.models || []).length} models, shown as ${fams.length} in the picker`, m("span", { class: "grow" }), countEl),
          fams.length > 12 ? famSearch : null,
          fams.length > 1 ? m("div", { class: "prov-pair-acts" }, btn(m, "Tick all", "ghost", () => { F.off = new Set(); fillFams(); }), btn(m, "Untick all", "ghost", () => { F.off = new Set(fams.map((/** @type {any} */ f) => f.id)); fillFams(); })) : null,
          famsBox,
          (r.other || []).length
            ? m("details", { class: "prov-other" }, m("summary", {}, `Other models, not for chat · ${r.other.length}`),
                m("div", { class: "prov-fams" }, ...r.other.map((/** @type {string} */ n) => {
                  const cbx = /** @type {any} */ (m("input", { type: "checkbox", class: "mrow-tick", "aria-label": `Listed for your tools: ${n}` }));
                  cbx.checked = F.otherOn.has(n);
                  cbx.onchange = () => { if (cbx.checked) F.otherOn.add(n); else F.otherOn.delete(n); };
                  return m("label", { class: "prov-fam" }, cbx, m("code", {}, n));
                })))
            : null));
        fillFams();
      }
      drawFoot();
    }

    function fillFams() {
      const fams = F.probe?.families || [];
      const q = F.famQ.trim().toLowerCase();
      const bare = (/** @type {string} */ id) => (id.startsWith(`${F.prefix}/`) ? id.slice(F.prefix.length + 1) : id);
      const shown = fams.filter((/** @type {any} */ f) => !q || f.id.toLowerCase().includes(q) || f.members.some((/** @type {any} */ x) => String(x.name).toLowerCase().includes(q)));
      famsBox.replaceChildren(...(fams.length ? shown.map((/** @type {any} */ f) => {
        const cbx = /** @type {any} */ (m("input", { type: "checkbox", class: "mrow-tick", "aria-label": `In the picker: ${bare(f.id)}` }));
        cbx.checked = !F.off.has(f.id);
        cbx.onchange = () => {
          if (cbx.checked) F.off.delete(f.id);
          else F.off.add(f.id);
          sayCount();
        };
        const words = variantWords(f);
        return m("label", { class: "prov-fam", title: f.members.map((/** @type {any} */ x) => x.name).join(", ") }, cbx, m("span", { class: "prov-fam-name" }, bare(f.id)),
          words.length ? m("span", { class: "prov-hint" }, words.join(" · ")) : null, f.members.length > 1 ? m("span", { class: "prov-hint" }, `${f.members.length} ids`) : null);
      }) : [m("p", { class: "prov-hint" }, "It listed no chat models. Add it, and add a model by name on its page.")]));
      sayCount();
    }
    const sayCount = () => {
      const fams = F.probe?.families || [];
      countEl.replaceChildren(fams.length ? `${fams.filter((/** @type {any} */ f) => !F.off.has(f.id)).length} of ${fams.length} ticked` : "");
    };

    function drawFoot() {
      footSays.replaceChildren(F.error ? m("span", { class: "prov-err" }, F.error) : ADD_FOOT);
      addBtn.replaceChildren(m("span", { class: "zc-btn-label" }, F.adding ? "Adding…" : F.p?.qoder ? "Add Qoder" : F.p ? `Add ${F.p.custom ? "it" : F.p.name.replace(/ \(.*\)$/, "")}` : "Add"));
      const off = !F.p || F.adding;
      if (off) addBtn.setAttribute("disabled", "");
      else addBtn.removeAttribute("disabled");
    }

    /** The names left out of the picker: the unticked families' ids, and the other models not ticked. */
    const hiddenList = () => {
      const r = F.probe;
      if (!r?.ok) return [];
      const out = [];
      for (const f of r.families || []) if (F.off.has(f.id)) for (const x of f.members) out.push(x.name);
      for (const n of r.other || []) if (!F.otherOn.has(n)) out.push(n);
      return [...new Set(out)];
    };

    async function add() {
      if (!F.p || F.adding) return;
      if (F.p.qoder) return addQoder();
      const problem = prefixProblem(cfg(), F.prefix);
      if (problem) {
        F.error = problem;
        return drawFoot();
      }
      if (!/^https?:\/\//i.test(urlNow())) {
        F.error = F.p.custom ? "Type its address: http:// or https://" : "Fill in what its address needs";
        return drawFoot();
      }
      clearTimeout(timer);
      F.error = "";
      F.adding = true;
      drawFoot();
      try {
        const up = await state.add({ provider: F.p.custom ? "" : F.p.id, type: typeNow(), plan: F.plan, fields: F.fields, baseUrl: F.p.custom ? urlNow() : "", apiKey: F.key, prefix: F.prefix, hiddenModels: hiddenList() });
        d.close(true);
        toast(`${nameOf(up)} added: your chats ask for its models as ${F.prefix}/…, and the picker has them`);
        // The list's dot says how it answers, a failure's words included (HC-30).
        void call(`/upstreams/${encodeURIComponent(up.id)}/test`).catch(() => null).then(() => state.read());
        go(up.id);
      } catch (e) {
        F.adding = false;
        const free = /** @type {any} */ (e)?.body?.free;
        F.error = free ? `${errText(e)} ${free} is free: Add takes it.` : errText(e);
        if (free) {
          F.prefix = free;
          F.prefixTyped = true;
          const pi = /** @type {any} */ (box.querySelector?.(".prov-prefix"));
          if (pi) pi.value = free;
          sayPrefix();
        }
        drawFoot();
      }
    }

    /** Qoder cloud comes from its template (its upstream and route at once); its page then signs in (HC-47). */
    async function addQoder() {
      const had = (state.all() || []).find((u) => u.type === "qoder");
      if (had) {
        d.close(true);
        return go(had.id);
      }
      F.adding = true;
      drawFoot();
      try {
        await call("/templates/qoder-cloud/apply", { method: "POST" });
        await state.read();
        const up = (state.all() || []).find((u) => u.type === "qoder");
        d.close(true);
        toast("Qoder added: sign in on its page");
        if (up) go(up.id);
      } catch (e) {
        F.adding = false;
        F.error = errText(e);
        drawFoot();
      }
    }

    fillTiles();
    drawFoot();
  }

  /** What the root shows: put again only when its parts change, so a field's focus survives a paint. @type {any[]} */
  let placed = [];
  function paint() {
    if (root.isConnected === false) return stop();
    const u = open ? state.get(open) : null;
    if (open && !u && state.all()) open = null;
    const kids = !state.all()
      ? [m("p", { class: "prov-quiet" }, state.failed() || "Reading your providers…"), state.failed() ? btn(m, "Try again", "outline", () => void state.read()) : null]
      : u ? providerPage(u) : list();
    const next = kids.filter((n) => n != null);
    if (next.length === placed.length && next.every((n, i) => n === placed[i])) return;
    // A provider's page is drawn again after each change: the control that had the focus (the next field, after a
    // field was kept on leaving it) has it again in the new page.
    const active = /** @type {any} */ (globalThis.document?.activeElement);
    const label = active && root.contains?.(active) ? active.getAttribute?.("aria-label") : null;
    placed = next;
    root.replaceChildren(...next);
    if (label) /** @type {any} */ (root.querySelector?.(`[aria-label="${String(label).replace(/["\\]/g, "\\$&")}"]`))?.focus?.();
  }

  const off = state.listen(() => {
    paint();
    void readSide();
  });
  function stop() {
    off();
  }
  paint();
  void state.read();
  void readSide();
  return { state, go, paint };
}
