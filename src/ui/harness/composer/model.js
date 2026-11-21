// @ts-check
// The model picker (HarnessV3 §15 item 92): a macOS popover over the catalogue as models, not ids — the server's
// families (`/api/models` → `families`): one row per model with its variants folded in, a source list of the
// upstreams on the left (each provider and coding agent), a search field that crosses them all,
// and a facts line per row (the window, the price, what the model can be tuned for). Picking a row writes the model
// with the tuning it keeps; the tuning itself is the chip beside this one (effort.js). ↑/↓ walk the rows, ←/→ the
// sources while the query is empty, Enter picks, Esc closes. A session started on an `agent/` name shows its base:
// the harness runs plain routes on the loop anyway. A coding agent's tab
// carries its plan as its agent said it (HarnessV3-ACP AC3-6): the fullest window's gauge, and a chip from 80 %. A
// coding agent nobody is signed in to, or whose program isn't on this computer, has no tab (the owner's of 10-30): it
// comes back once its account says someone is — at a page's next read of the accounts, a turn it serves, Check now.
// Another machine's models (the remote-agents plan's m-ui) have a tab named for the machine, with a dot: green while it
// answers, amber while it was found offline or its listing failed, grey while that is not known (being asked, or never
// asked), the words why on its title and under its list. A machine whose models this Filament keeps has its tab before
// its listing has any (`setMachines`), saying why it lists nothing.
import { h, morphChildren, standing } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { popover } from "../lib/ui.js";
import { familyName, prettyModel, vendorOf, windowWords, locate, levelWords, pickable } from "../lib/families.js";
import { CONNECT_URL, CONSOLE_WINDOW } from "../lib/catalogue.js";
import { fullestOf, gaugeOf, glanceOf, offered, readsAs, summaryWords } from "../../lib/accounts.js";
import { gaugeSvg, stateColor } from "../widgets/kit.js";

/** @typedef {import("../../lib/accounts.js").AgentRow} AgentRow */

/**
 * The model a fresh start chooses where none is remembered, so the very first send works: the catalogue's first that
 * the picker offers (`offered`: never a coding agent nobody is signed in to, nor one whose program isn't here), and never
 * an effort twin. "" for none.
 * @param {any[]} models  `/api/models`' rows @param {AgentRow[]} accounts
 */
export function firstModel(models, accounts) {
  const first = (models || []).find((m) => !(m?.source === "effort-variant" && /-(low|medium|high|xhigh|max)$/.test(String(m.id || m))) && offered(accounts, m?.upstream));
  return first ? String(first.id || first) : "";
}

/** The name as the harness shows it: the loop's prefix is Filament's own name for its loop, never displayed here. @param {string} name */
export const shownName = (name) => String(name || "").replace(/^agent\//, "");

/**
 * A coding agent's plan on its source tab (HarnessV3-ACP AC3-6): its fullest window's gauge, and a chip where it warns
 * or stops — the Account instrument's words, at a glance before the agent is chosen — and its sentence for the tab's
 * title. Nothing for a source that is no coding agent's; the sentence alone until the agent says who it runs as.
 * @param {AgentRow | undefined} row @param {number} [now]
 * @returns {{ title: string | null, gauge: { f: number | null, color: string } | null,
 *   chip: { tone: "warn" | "error", figure: string } | null }}
 */
export function sourcePlan(row, now = Date.now()) {
  if (!row) return { title: null, gauge: null, chip: null };
  const a = row.account;
  if (!a?.identity) return { title: summaryWords(row, now), gauge: null, chip: null };
  const g = glanceOf(a);
  const f = gaugeOf(a);
  return {
    title: summaryWords(row, now),
    gauge: f != null || g.tone ? { f, color: stateColor(readsAs(a, fullestOf(a)), "var(--color-sys-gray)") } : null,
    chip: g.tone ? { tone: g.tone, figure: g.figure } : null,
  };
}

/**
 * The machines whose models this Filament keeps — the configuration's upstreams of type `filament`, switched on —, each
 * with what `/api/models` said of its listing (`upstreams`): offline and why, still asked, never asked, why it failed,
 * and how many names it listed. What the picker's `setMachines` takes: a tab for each, before its listing has a model too.
 * @param {any[] | undefined} ups  the configuration's upstreams @param {Record<string, any> | undefined} info  `/api/models`' `upstreams`
 * @returns {{ upstream: string, name: string, offline: string | null, asking: boolean, unasked: boolean, error: string | null, listed: number }[]}
 */
export const machinesOf = (ups, info) =>
  (ups || [])
    .filter((u) => u?.type === "filament" && u.enabled !== false)
    .map((u) => {
      const i = info?.[u.id] || {};
      return { upstream: String(u.id), name: String(u.name || u.id), offline: i.offline ? String(i.offline) : null, asking: i.discovering === true, unasked: i.unasked === true, error: i.error ? String(i.error) : null, listed: Number(i.count) || 0 };
    });

/**
 * Another machine's models on their source tab (the remote-agents plan's m-ui): whether the machine was found offline —
 * why, in words, as `/api/models` says it on each of its rows (`offline`), or of its listing where it has none —, and
 * the tab's title. A machine this Filament keeps (`machinesOf`) whose listing has no model yet says why it lists
 * nothing (`empty`): still asked, never asked, failed, its names kept out of the picker here, or none answers there.
 * Null for a source that is no machine's.
 * @param {any[]} models  `/api/models`' rows, named (`upstreamName`) @param {string} key  the source
 * @param {ReturnType<typeof machinesOf>} [machines]
 * `dot`: whether it answers — "ok", "off" (offline, or its listing failed), "unknown" (asked now, or never).
 * @returns {{ offline: string | null, title: string, dot: "ok" | "off" | "unknown", empty?: string } | null}
 */
export function sourceMachine(models, key, machines = []) {
  const row = (models || []).find((m) => m?.upstream === key && m.machine);
  const kept = row ? null : (machines || []).find((m) => m?.upstream === key);
  if (!row && !kept) return null;
  if (row) {
    const name = String(row.upstreamName || key);
    const offline = row.offline ? String(row.offline) : null;
    return { offline, title: offline ? `Offline: ${offline}` : `On ${name}: its models run on its keys and sign-ins, and each call goes there`, dot: offline ? "off" : "ok" };
  }
  const k = /** @type {ReturnType<typeof machinesOf>[number]} */ (kept);
  const empty = k.asking
    ? `Asking ${k.name} for its models…`
    : k.error && !k.offline
      ? `${k.name} did not list its models: ${k.error.replace(/\.\s*$/, "")}.`
      : k.unasked
        ? `${k.name} has not been asked for its models yet.`
        : k.listed
          ? `${k.name} lists ${k.listed} ${k.listed === 1 ? "model" : "models"}, and none is in the picker: hidden here, or no route reaches ${k.listed === 1 ? "it" : "them"}.`
          : `${k.name} lists no models: none answers there yet. Connect one in its own Settings › Providers.`;
  const dot = k.offline || k.error ? "off" : k.asking || k.unasked ? "unknown" : "ok";
  return { offline: k.offline, title: k.offline ? `Offline: ${k.offline}` : empty, dot, empty: k.offline ? `Offline: ${k.offline}` : empty };
}

/**
 * What the list says when it shows no row: a search that matched nothing, a source with no model, or no model at all
 * (HarnessV3-Launch LD-D4) — then the way to connect one, the console's catalogue in its own window.
 * @param {string} query  the search as typed ("" for none) @param {boolean} none  no model anywhere
 * @param {() => void} [onLeave]  the menu closes as the console opens @param {typeof h} [mk]
 */
export function emptyList(query, none, onLeave = () => {}, mk = h) {
  if (none && !query)
    return mk("div", { class: "mp-empty" },
      mk("span", { class: "mp-empty-ic", html: ICONS.sparkles }),
      mk("span", {}, "No models yet"),
      mk("a", { class: "mp-empty-link", href: CONNECT_URL, target: CONSOLE_WINDOW, onclick: () => onLeave() }, "Connect a model"));
  return mk("div", { class: "mp-empty" }, mk("span", { class: "mp-empty-ic", html: ICONS.search }), query ? `No model matches “${query}”` : "No models here");
}

/**
 * The picker's footer: the model chosen, and the way back to the default. With no model at all there is neither, and
 * the list's Connect a model is the one way on (HarnessV3-Launch LD-D4): no footer. A caller with no default to go
 * back to (a row of a pool's list) has no button, and no footer where no model is chosen either (AG-257).
 * @param {{ note: string, none: boolean, title: string, onUseDefault: (() => void) | null }} o  `note`: the model
 *   chosen, in words ("" for none); `none`: no model anywhere; `title`: what the default is
 * @param {typeof h} [mk]
 */
export function pickerFoot({ note, none, title, onUseDefault }, mk = h) {
  if (none || (!note && !onUseDefault)) return null;
  return mk("div", { class: "mp-foot" },
    mk("span", { class: "mp-foot-note" }, note || "No model chosen yet"),
    onUseDefault
      ? mk("button", { class: "mp-foot-btn", type: "button", title, onclick: onUseDefault },
          mk("span", { class: "mp-foot-ic", html: ICONS.rotateCcw }), "Use the default")
      : null);
}

/**
 * A model's tile: its maker's mark on its hue, a rounded square like an app icon.
 * @param {string} id @param {{ size?: "sm" | "md" }} [o]
 */
export function modelTile(id, o = {}) {
  const v = vendorOf(id);
  return h("span", { class: `mp-tile${o.size === "sm" ? " is-sm" : ""}`, style: `--tile:${v.hue}`, "aria-hidden": "true" }, v.mark);
}

/** @param {number} n */
const usd = (n) => `$${n >= 10 ? Math.round(n) : Number(n.toFixed(2)).toString()}`;

/**
 * The row's facts line: which model its agent's name means, the window (a range when it can grow), the price per
 * million tokens in and out, and what it can be tuned for — each a quiet word, the tuning ones with their glyph.
 * @param {any} f  a family
 */
export function familyFacts(f) {
  /** @type {{ text: string, icon?: string, tone?: string, title?: string }[]} */
  const out = [];
  // A coding agent's description that names its model first says which one a name like "Opus" is: "Opus 5 · Best
  // for everyday, complex tasks" (HarnessV3-ACP AF2). The whole description is its title.
  const said = String(f.note || "").split(" · ");
  if (said.length > 1 && said[0] && said[0].toLowerCase() !== familyName(f).toLowerCase()) out.push({ text: said[0], title: String(f.note) });
  const opts = (f.window?.options || []).map(Number).filter((n) => n > 0);
  const std = Number(f.window?.standard || f.context_window) || 0;
  const most = Math.max(std, ...opts);
  // A family sold as a name per window can reach below its standard one too (Kimi's k3 at 1M, k3-256k at 256K).
  const least = Math.min(...[std, ...opts].filter((n) => n > 0));
  if (std && most > std) out.push({ text: `${windowWords(std)}–${windowWords(most)}`, title: `A ${windowWords(std)} context window, or ${windowWords(most)} when you choose it` });
  else if (std && least < std) out.push({ text: `${windowWords(least)}–${windowWords(std)}`, title: `A ${windowWords(std)} context window, or ${windowWords(least)} when you choose it` });
  else if (std || most) out.push({ text: windowWords(std || most), title: `A ${windowWords(std || most)} context window` });
  if (f.codingAgent) out.push({ text: "Coding agent", icon: "bot" });
  // Another machine's model runs on its keys and sign-ins: its name in a price's place, the list price in its title.
  else if (f.onMachine) out.push({ text: `On ${f.onMachine}`, title: `Runs on ${f.onMachine}'s keys and sign-ins${f.price && (f.price.input || f.price.output) ? `. At list price: ${usd(f.price.input)} in and ${usd(f.price.output)} out per million tokens` : ""}` });
  else if (f.price && (f.price.input || f.price.output)) {
    const card = `${usd(f.price.input)} in and ${usd(f.price.output)} out per million tokens`;
    out.push({ text: `${usd(f.price.input)} · ${usd(f.price.output)}`, title: f.billing === "plan" ? `On your plan: paid $0, the plan's usage instead. At list price: ${card}` : card });
  } else if (f.billing === "plan") out.push({ text: "On your plan", title: "On your subscription plan: paid $0, the plan's usage instead" });
  if (f.effort) out.push({ text: `${f.effort.levels.length} ${f.effort.levels.length === 1 ? "level" : "levels"}`, icon: "brain", tone: "effort", title: `Reasoning: ${f.effort.levels.map((/** @type {string} */ l) => levelWords(l)).join(", ")}${f.effort.default ? ` (its own default: ${levelWords(f.effort.default)})` : ""}` });
  if (f.speed) out.push({ text: f.speed.options.includes("fast") ? "Fast" : "Flex", icon: "zap", tone: "fast", title: f.speed.options.includes("fast") ? "Has a fast mode" : "Has a flex tier" });
  if (f.thinking && f.thinking.via === "name") out.push({ text: "Thinking", icon: "sparkles", tone: "think", title: "Comes with and without thinking" });
  // A model that takes no tools (HarnessV4_Tasks E4): said where the choice is made, never on every turn after it.
  if (f.noTools) out.push({ text: "No tools", title: `Takes no tools — ${f.noTools === "operator" ? "your Tune sheet on the Upstreams page says so" : "its provider's model list says so"}. The agent answers on it in words only: it cannot read, change or run anything.` });
  return out;
}

/**
 * @param {{ onPick?: (family: any, member: any) => void, onChange?: (name: string) => void, onUseDefault?: () => void, defaultDesc?: string,
 *   blank?: string, align?: "start" | "end" }} [cb]
 *   `onPick` writes the family (the composer plans the write with the tuning in force); a caller without families
 *   takes `onChange` with the picked id; `blank`: the chip's words while no model is chosen ("Your chat's model");
 *   `align`: the popover's edge against the chip's — its right (the composer's, at the box's right) unless `start`
 * @returns {{ el: HTMLElement, name: () => string, set: (name: string) => void, setModels: (models: any[]) => void, setFamilies: (families: any[]) => void, setNote: (note: string | null) => void, setLocked: (reason: string | null) => void,
 *   setAccounts: (rows: AgentRow[]) => void, setMachines: (list: ReturnType<typeof machinesOf>) => void, open: (query?: string, o?: { onClose?: () => void }) => void, matches: (query: string) => boolean, family: () => any | null }}
 */
export function createModelSelect(cb = {}) {
  /** @type {any[]} */
  let models = [];
  /** @type {any[]} */
  let families = [];
  let current = "";
  /** @type {string | null} */
  let note = null;
  /** @type {string | null} why the chip shows a model nobody may change here, while it does */
  let locked = null;
  /** The coding agents' accounts (HarnessV3-ACP AC3-6): an agent's tab carries its plan, and one nobody is signed in to
   *  has none. @type {AgentRow[]} */
  let accounts = [];
  /** The machines whose models this Filament keeps (`machinesOf`): each has its tab, listed or not yet. @type {ReturnType<typeof machinesOf>} */
  let machines = [];
  const tileBox = h("span", { class: "model-chip-tile" });
  const blank = cb.blank || "Choose a model";
  const label = h("span", { class: "model-name" }, blank);
  const chip = h("button", { class: "model-chip", type: "button", title: "Model", "aria-haspopup": "dialog" },
    tileBox, label, h("span", { class: "mode-caret", html: ICONS.chevronsUpDown }));

  /** The family and member the chip's name belongs to (a name no family knows is shown as it is). */
  const located = () => (current ? locate(listed(), shownName(current)) : null);
  const paint = () => {
    const at = located();
    label.textContent = current ? (at ? familyName(at.family) : prettyModel(shownName(current))) : blank;
    // Painted at every view of the chat: the tile drawn in place, under a resting pointer the element that stood.
    morphChildren(tileBox, [current ? modelTile(at?.family?.id || shownName(current), { size: "sm" }) : h("span", { class: "mp-tile is-sm is-empty", html: ICONS.sparkles })]);
    chip.title = locked || [shownName(current), note].filter(Boolean).join(" · ") || "Model";
    chip.toggleAttribute("disabled", !!locked);
    chip.classList.toggle("is-locked", !!locked);
  };

  /** The families to list: the server's — never a model that is not for chat (an embedding or image model, kind
   *  "other": its name still routes) — or, for a caller that has only the rows, one plain family per row. */
  const listed = () => (families.length ? /** @type {any[]} */ (pickable(families)) : models.map((m) => ({
    id: String(m.id || m), upstream: m.upstream || "models", kind: "model",
    members: [{ id: String(m.id || m), effort: null, speed: null, thinking: null, window: null }],
    effort: null, speed: null, thinking: null, window: null,
    ...(m.context_window ? { context_window: m.context_window } : {}), ...(m.codingAgent ? { codingAgent: true } : {}),
  })));
  /** The upstream names as the dashboard spells them (the rows carry them once the config lands). */
  const upstreamName = (/** @type {string} */ id) => models.find((m) => m.upstream === id && m.upstreamName)?.upstreamName || machines.find((m) => m.upstream === id)?.name || id;
  /** What a query matches: the ids and the name, the maker and the source, and what the model can be tuned for. @param {any} f @param {string} key */
  const haystack = (f, key) => [
    f.id, prettyModel(f.id), f.label || "", f.note || "", ...f.members.map((/** @type {any} */ m) => m.id), vendorOf(f.id).name, upstreamName(key),
    f.speed?.options?.includes("fast") ? "fast" : "", f.speed?.options?.includes("flex") ? "flex" : "", f.thinking ? "thinking" : "",
    ...(f.effort?.levels || []).map((/** @type {string} */ l) => levelWords(l)), ...(f.window?.options || []).map((/** @type {number} */ n) => windowWords(n)),
    f.codingAgent ? "coding agent" : "", f.noTools ? "no tools" : "",
  ].join(" ").toLowerCase();
  /** A source's plan on its tab (`sourcePlan`): its sentence for the tab's title, and its marks. @param {string} key */
  const planOf = (key) => {
    const p = sourcePlan(accounts.find((x) => x.upstream === key));
    return {
      title: p.title,
      marks: [
        p.gauge ? h("span", { class: "mp-source-plan", html: gaugeSvg({ width: 14, stroke: 2.2, f: p.gauge.f, color: p.gauge.color }) }) : null,
        p.chip ? h("span", { class: `mp-source-chip is-${p.chip.tone}` }, p.chip.figure) : null,
      ],
    };
  };
  /** The sources the picker offers (`offered`), in the catalogue's order; then a machine's whose listing has no model yet. */
  const sources = () => {
    /** @type {Map<string, any[]>} */
    const map = new Map();
    for (const f of listed()) {
      if (!offered(accounts, f.upstream)) continue;
      if (!map.has(f.upstream)) map.set(f.upstream, []);
      /** @type {any[]} */ (map.get(f.upstream)).push(f);
    }
    for (const m of machines) if (!map.has(m.upstream)) map.set(m.upstream, []);
    return [...map.entries()];
  };

  /** Whether words find a model, as the picker's search finds them. @param {string} query */
  const matches = (query) => {
    const q = String(query || "").trim().toLowerCase();
    return !!q && sources().some(([key, fams]) => fams.some((f) => haystack(f, key).includes(q)));
  };

  /**
   * `query`: words already in its search, its first match highlighted (the message box's /opus, the Designer's of
   * 10-28); `onClose`: where the focus goes back once it closes, picked or not.
   * @param {string} [query] @param {{ onClose?: () => void }} [o]
   */
  const openMenu = (query = "", o = {}) => {
    if (locked) return;
    const search = h("input", { class: "mp-search-input", type: "text", placeholder: "Search models, or fast, thinking, 1M…", "aria-label": "Search models", spellcheck: "false", role: "combobox", "aria-expanded": "true", "aria-controls": "mp-list" });
    /** @type {any} */ (search).value = String(query || "");
    const nav = h("nav", { class: "mp-sources", role: "tablist", "aria-label": "Sources" });
    const list = h("div", { class: "mp-list", id: "mp-list", role: "listbox", "aria-label": "Models" });
    const here = located();
    let active = here ? here.family.upstream : null;
    let hi = 0;
    let rowSeq = 0;
    /** The rows as this draw made them; the list is drawn in place, so the one on the page is `standing(el)`. @type {{ el: HTMLElement, family: any }[]} */
    let rows = [];

    const rowOf = (/** @type {any} */ f) => {
      const isCurrent = !!here && here.family === f;
      const facts = familyFacts(f);
      const el = h("button", {
        class: `mp-row${isCurrent ? " is-current" : ""}`, type: "button", role: "option", id: `mp-row-${++rowSeq}`, "data-key": `row:${f.upstream}:${f.id}`,
        "aria-selected": isCurrent ? "true" : "false",
        title: [f.kind === "variants" ? `${f.id} — ${f.members.length} variants` : f.id, f.note].filter(Boolean).join("\n"),
        onclick: () => pick(f),
        // One highlight, the way a macOS list keeps it: the pointer and the arrow keys move the same one.
        onpointermove: () => { const i = rows.findIndex((r) => r.family === f); if (i >= 0 && i !== hi) { hi = i; paintHi(false); } },
      },
        modelTile(f.id),
        h("span", { class: "mp-row-text" },
          h("span", { class: "mp-row-name" }, familyName(f)),
          h("span", { class: "mp-row-facts" }, ...facts.map((x) => h("span", { class: `mp-fact${x.tone ? ` is-${x.tone}` : ""}`, ...(x.title ? { title: x.title } : {}) }, x.icon ? h("span", { class: "mp-fact-ic", html: /** @type {any} */ (ICONS)[x.icon] || "" }) : null, x.text)))),
        isCurrent ? h("span", { class: "mp-row-check", html: ICONS.check }) : null);
      return { el, family: f };
    };

    // Drawn again at each word typed and each source chosen: in place, the tab just pressed and the rows under the
    // pointer the elements that stood (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost).
    const draw = () => {
      const all = sources();
      if (!active || !all.some(([k]) => k === active)) active = all[0]?.[0] || null;
      const q = search.value.trim().toLowerCase();
      morphChildren(nav, all.map(([key, fams]) => {
        const plan = planOf(key);
        const machine = sourceMachine(models, key, machines);
        const title = plan.title || machine?.title;
        return h("button", {
          class: `mp-source${key === active && !q ? " is-on" : ""}`, type: "button", role: "tab", "data-key": key,
          "aria-selected": key === active && !q ? "true" : "false",
          ...(title ? { title } : {}),
          onclick: () => { active = key; search.value = ""; hi = 0; draw(); search.focus(); },
        },
          machine ? h("span", { class: `mp-source-dot is-${machine.dot}`, "aria-hidden": "true" }) : null,
          h("span", { class: "mp-source-name" }, upstreamName(key)),
          ...plan.marks,
          h("span", { class: "mp-source-count" }, String(fams.length)));
      }));
      /** @type {HTMLElement[]} */
      const out = [];
      rows = [];
      /** The list shows no row and has said why already: a machine's whose listing has none. */
      let saidWhy = false;
      if (q) {
        // A query crosses every source; each group keeps its source's name as a header.
        for (const [key, fams] of all) {
          const hits = fams.filter((f) => haystack(f, key).includes(q));
          if (!hits.length) continue;
          out.push(h("div", { class: "mp-group", "data-key": `group:${key}` }, upstreamName(key)));
          for (const f of hits) { const r = rowOf(f); rows.push(r); out.push(r.el); }
        }
      } else {
        for (const f of all.find(([k]) => k === active)?.[1] || []) { const r = rowOf(f); rows.push(r); out.push(r.el); }
        // A machine found offline: why, under its models — a chat on one reaches it again once it answers. One whose
        // listing has no model yet says why in the list's place.
        const machine = active ? sourceMachine(models, active, machines) : null;
        if (machine?.offline) out.push(h("div", { class: "mp-source-note", role: "note", "data-key": `note:${active}` }, `Offline: ${machine.offline}`));
        else if (machine?.empty) out.push(h("div", { class: "mp-empty", role: "note", "data-key": `empty:${active}` }, h("span", { class: "mp-empty-ic", html: ICONS.sparkles }), machine.empty));
        saidWhy = !!machine?.empty;
      }
      if (!rows.length && !saidWhy) out.push(emptyList(search.value.trim(), !all.length, () => d.close()));
      morphChildren(list, out);
      if (hi >= rows.length) hi = Math.max(0, rows.length - 1);
      paintHi(false);
    };
    const paintHi = (scroll = true) => {
      rows.forEach((r, i) => standing(r.el).classList.toggle("is-hi", i === hi));
      if (rows[hi]) search.setAttribute("aria-activedescendant", standing(rows[hi].el).id);
      else search.removeAttribute("aria-activedescendant");
      if (scroll && rows[hi]) standing(rows[hi].el).scrollIntoView({ block: "nearest" });
    };
    const pick = (/** @type {any} */ f) => {
      d.close();
      if (cb.onPick) return cb.onPick(f, f.members[0]);
      current = f.members[0].id;
      paint();
      cb.onChange?.(current);
    };
    search.oninput = () => { hi = 0; draw(); };
    search.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (rows.length) { hi = (hi + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length; paintHi(); }
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !search.value) {
        e.preventDefault();
        const all = sources();
        const at = all.findIndex(([k]) => k === active);
        active = all[(at + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length]?.[0] || active;
        hi = 0;
        draw();
      } else if (e.key === "Enter") {
        const r = rows[hi];
        if (r) { e.preventDefault(); pick(r.family); }
      }
    });
    draw();
    // Open on the current model's row; on words searched, on their first match.
    const at = query ? -1 : rows.findIndex((r) => here && r.family === here.family);
    if (at >= 0) { hi = at; paintHi(); }
    const foot = pickerFoot({
      note: current ? `${here ? familyName(here.family) : prettyModel(shownName(current))}${note ? ` · ${note}` : ""}` : "",
      none: !sources().length,
      title: cb.defaultDesc || "Unset this session's own model: your project or global setting applies",
      onUseDefault: cb.onUseDefault ? () => { d.close(); cb.onUseDefault?.(); } : null,
    });
    const box = h("div", { class: "mp" },
      h("div", { class: "mp-search" }, h("span", { class: "mp-search-ic", html: ICONS.search }), search),
      h("div", { class: "mp-body" }, nav, list),
      foot);
    const d = popover(chip, box, { side: "top", align: cb.align || "end", width: 580, label: "Choose a model", ...(o.onClose ? { onClose: o.onClose } : {}) });
    d.el.classList.add("aq-pop", "is-model-picker");
    search.focus();
  };
  chip.onclick = (/** @type {Event} */ e) => { e.stopPropagation(); openMenu(); };
  paint();

  return {
    el: chip,
    name: () => current,
    /** @param {string} name */
    set(name) { current = name || ""; paint(); },
    /** @param {any[]} list */
    setModels(list) { models = list || []; paint(); },
    /** @param {any[]} list */
    setFamilies(list) { families = Array.isArray(list) ? list : []; paint(); },
    /** Whose model the chip is showing (the session's words: "this session"…), for its title. */
    setNote(n) { note = n || null; paint(); },
    /** Fixed to the model it shows, the reason on its title (a fork runs on the main agent's) — or free again with null. */
    setLocked(reason) { locked = reason || null; paint(); },
    /** The coding agents' accounts: which agents have a tab, and what each carries (the next open draws them). @param {AgentRow[]} rows */
    setAccounts(rows) { accounts = Array.isArray(rows) ? rows : []; },
    /** The machines whose models this Filament keeps (`machinesOf`): a tab for each, before its listing has a model too (the next open draws them). @param {ReturnType<typeof machinesOf>} list */
    setMachines(list) { machines = Array.isArray(list) ? list : []; },
    open: (query, o) => openMenu(query, o),
    matches,
    /** The located family of the model in force, or null. */
    family: () => located()?.family || null,
  };
}
