// @ts-check
// The Tune sheet (HarnessV3 §15 item 93; HarnessV4_Settings_Plan HS-D1): what one model can do at a provider, part by
// part, its list price included (the sheet's "Pricing — for analytics", Providers P2; a row's old maxConcurrency is
// kept as it is and caps nothing: a model's agent limit is its row's on Settings › Providers). Both faces open
// it — the console's Upstreams page in its drawer, the harness's Settings › Providers in a sheet — and each hands it a
// kit: its `h`, how it opens a sheet and asks before edits are dropped, and its buttons. What Apply does is the
// caller's: the console puts the row in its unsaved changes, the harness saves it at once. The sheet previews what
// the harness's model picker will offer before anything is applied: POST /api/models/caps answers from the draft row.
import {
  TUNE_FIELDS, PRICE_FIELDS, LEVELS, LEVEL_WORDS, SOURCE_WORDS, SOURCE_LONG, windowChoices, windowWithCost, windowsText,
  winWords, tokens, levelList, parseWindows, statedIn, priceWords, carriedPrices, normPrice, fmtPrice,
} from "./model-caps.js";

/**
 * What a face gives the sheet. `open` shows the sheet's box under its title and answers how to close it: unforced, it
 * asks first while `dirty()` (in the face's own words, with `discard`); forced, it just closes. `applyLabel` names
 * the button that hands the row over in the face's words — the console's Apply puts it in its unsaved changes, the
 * harness's Save writes it at once.
 * @typedef {{
 *   h: (tag: string, attrs?: any, ...kids: any[]) => any,
 *   open: (title: string, box: HTMLElement, guard: { dirty: () => boolean, discard: string }) => { close: (force?: boolean) => void },
 *   button: (o: { label: string, primary?: boolean, title?: string, onClick?: () => void }) => HTMLElement,
 *   applyLabel?: string,
 * }} TuneKit
 */

/**
 * The Tune sheet: what one model can do at this upstream, part by part. Each part is Automatic — the provider's list,
 * the Rules page or Filament's built-ins, whichever knows — until it is set here; the preview at the foot says what the
 * harness's picker will offer and is asked of the server as the sheet changes. Its last part is the model's list price
 * (Providers P2). Apply hands the row to `o.onApply` — `row: null` when nothing is left on it — and the
 * sheet closes once that is done; a failure stays on the sheet, said. A field of the row the sheet does not own is
 * never touched.
 * A row is keyed by a name or a prefix and covers every model whose name starts with it, so the sheet names the other
 * models of the table (`o.models`) its row also speaks for — not the family's own variants, which it is meant to.
 * @param {{ u: any, x: any, entry: any, load: (u: any, names: string[]) => Promise<any>, agent: boolean,
 *   onApply: (r: { key: string, row: Record<string, any> | null }) => void | Promise<void>, models?: any[] }} o
 * @param {TuneKit} kit
 */
export function openTune(o, kit) {
  const { h } = kit;
  const { u, x } = o;
  const variants = o.entry?.offer?.kind === "variants" && !!o.entry?.offer?.familyKey;
  const want = variants ? String(o.entry.offer.familyKey) : String(x.upstreamModel || x.id);
  // The row that already belongs to this model, however it is spelled (grok-4.6 or grok-4-6): two spellings of one
  // key would be two rows fighting over the same models.
  const key = Object.keys(u.pricing || {}).find((k) => normPrice(k) === normPrice(want)) || want;
  /** @type {string[]} */
  const members = o.entry?.offer?.members || [x.id];
  /** @type {string[]} */
  const covered = (o.models || []).filter((m) => !members.includes(m.id) && normPrice(m.upstreamModel || m.id).startsWith(normPrice(key))).map((m) => String(m.upstreamModel || m.id));
  const own = { ...((u.pricing || {})[key] || {}) };
  /** Every row field the sheet owns: what the model can do, then its prices. */
  const SHEET = [...TUNE_FIELDS, ...PRICE_FIELDS, "billing"];
  /** @type {Record<string, any>} the sheet's pending fields: an absent one is Automatic */
  const pend = {};
  for (const f of SHEET) if (own[f] != null) pend[f] = structuredClone(own[f]);
  let entry = o.entry;
  /** @type {string[]} */
  let errors = [];
  /** Inputs whose text does not parse yet (a half-typed window list, broken JSON): Apply waits for them. @type {Set<string>} */
  const bad = new Set();
  const wire = entry?.caps?.wire || null;
  const rowOf = () => {
    const row = { ...own };
    for (const f of SHEET) {
      if (pend[f] === undefined) delete row[f];
      else row[f] = pend[f];
    }
    return row;
  };
  const draftUp = () => {
    const row = rowOf();
    const pricing = { ...(u.pricing || {}) };
    if (Object.keys(row).length) pricing[key] = row;
    else delete pricing[key];
    return { ...u, pricing };
  };

  const box = h("div", { class: "tune-sheet" });
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let seq = 0;
  const ask = () => {
    const n = ++seq;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const r = await o.load(draftUp(), [x.id]);
      if (n !== seq) return;
      // A failed ask keeps the last answer on show, dimmed, and says so.
      askError = r.error || null;
      if (!askError) {
        entry = r.byId.get(x.id) || entry;
        errors = (r.errors || []).filter((/** @type {string} */ e) => e.startsWith(`pricing["${key}"]`));
        for (const up of live) up();
        preview.classList.remove("stale");
      }
      paintPreview();
    }, 180);
  };
  /** @type {string | null} */
  let askError = null;
  /** Whether the sheet holds changes Apply has not put in the draft yet. */
  const tuneOf = (/** @type {any} */ r) => JSON.stringify(SHEET.map((f) => (r?.[f] == null ? null : r[f])));
  const dirty = () => tuneOf(rowOf()) !== tuneOf(own) || bad.size > 0;
  /** The request fields last typed, kept while fast mode is switched away from "Has fast mode" and back. */
  let keptParams = /** @type {any} */ (null);
  let keptFlexParams = /** @type {any} */ (null);
  /** A field changed: the preview is asked again; the controls repaint only when their shape changes. @param {boolean} [repaint] */
  const changed = (repaint = false) => {
    if (repaint) paint();
    else paintPreview();
    preview.classList.add("stale");
    ask();
  };

  /**
   * Who said a value, in words: the row that said it when that is a prefix row. A fallback value names no row: it is
   * what the value falls back to without this upstream's own word.
   * @param {string} field @param {string | null} source @param {boolean} [fallback]
   */
  const said = (field, source, fallback = false) => {
    if (!source) return "nobody states it";
    if (source !== "operator") return SOURCE_LONG[source] || source;
    const k = fallback ? null : entry?.rowKeys?.[field];
    return !k ? "set on this upstream" : k === key ? "set here" : `set on the row “${k}”, which covers every model it starts`;
  };
  const srcPill = (/** @type {string} */ field, /** @type {string | null} */ source, label = "") => {
    const k = entry?.rowKeys?.[field];
    if (!source) return h("span", {});
    const words = source === "operator" && k && k !== key ? `row “${k}”` : SOURCE_WORDS[source] || source;
    return h("span", { class: `cap-chip src-${source}${source === "operator" && k && k !== key ? " inherited" : ""}`, title: `${label ? `${label} ` : ""}${said(field, source)}` }, label ? `${label} ${words}` : words);
  };
  /** @param {{ id: string, label: string }[]} options @param {string} value @param {(id: string) => void} pick @param {string} label */
  const seg = (options, value, pick, label) =>
    h("div", { class: "seg small", role: "group", "aria-label": label }, ...options.map((opt) => h("button", { type: "button", class: opt.id === value ? "on" : "", "aria-pressed": opt.id === value ? "true" : "false", onclick: () => pick(opt.id) }, opt.label)));
  /**
   * What Automatic stands for, for one field: the server's answer while this row does not say it (a prefix row, the
   * provider's list, the rules, the built-ins); while the answer to an unset is still on its way, the value without
   * any of this upstream's rows. `fb` says which, for `said`.
   * @param {string} field @param {string} part
   */
  const autoPart = (field, part) => {
    const fb = entry?.rowKeys?.[field] === key;
    return { v: (fb ? entry?.fallback : entry?.caps)?.[part] || {}, fb };
  };
  /** A note that follows the answer, like the headers do. @param {() => string} text */
  const liveNote = (text) => {
    const note = h("span", { class: "tune-src" });
    const say = () => { note.textContent = text(); };
    say();
    live.push(say);
    return note;
  };
  /**
   * A number that is Automatic while empty; the note beside it says what Automatic is, and follows the typing.
   * @param {string} field @param {string} label @param {string} unit @param {() => string} auto @param {{ min?: number, max?: number, step?: number }} [lim]
   */
  const numberField = (field, label, unit, auto, lim = {}) => {
    const i = h("input", { type: "number", min: String(lim.min ?? 0), step: String(lim.step ?? 1), value: pend[field] ?? "", placeholder: "automatic", "aria-label": `${label} (${unit})` });
    const note = h("span", { class: "tune-src" });
    const say = () => { note.textContent = bad.has(field) ? "not a value it takes yet — fix it, or empty it for automatic" : pend[field] === undefined ? `automatic: ${auto()}` : "set here — empty it to go back to automatic"; };
    live.push(say);
    i.oninput = () => {
      const t = String(/** @type {HTMLInputElement} */ (i).value).trim();
      bad.delete(field);
      if (t === "") delete pend[field];
      else if (Number.isFinite(Number(t)) && Number(t) >= (lim.min ?? 0) && (lim.max == null || Number(t) <= lim.max)) pend[field] = Number(t);
      else bad.add(field);
      i.classList.toggle("bad", bad.has(field));
      say();
      changed();
    };
    say();
    return h("div", { class: "tune-row" }, h("label", {}, label, i, h("span", { class: "tune-unit" }, unit)), note);
  };

  /** Each header's value follows the server's answer in place: a repaint would take the focus from a half-typed box. @type {Array<() => void>} */
  let live = [];
  /** @param {string} title @param {() => string} value @param {() => Node} pill @param {any[]} rest */
  const section = (title, value, pill, ...rest) => {
    const val = h("span", { class: "tune-val" });
    const tag = h("span", { class: "tune-tag" });
    const up = () => {
      val.textContent = value();
      tag.replaceChildren(pill());
    };
    up();
    live.push(up);
    return h("section", { class: "tune-sec" }, h("div", { class: "tune-sec-head" }, h("h3", {}, title), val, tag), ...rest.filter((n) => n !== null && n !== undefined));
  };
  const fixed = (/** @type {string} */ cls, /** @type {string} */ text) => () => h("span", { class: `cap-chip ${cls}` }, text);

  const reasoning = () => {
    const c = entry?.caps?.effort || {};
    const lv = Array.isArray(c.levels) ? c.levels : null;
    const via = entry?.offer?.effort?.via;
    if (via === "name") return section("Reasoning", () => levelList(entry?.offer?.effort?.levels || []), fixed("src-name", "model ids"), h("p", { class: "tune-help" }, "This provider lists one id per level: the picker's levels are those ids, and there is nothing to set here."));
    if (o.agent && via !== "setting") return section("Reasoning", () => "the agent's own", fixed("src-name", "agent"), h("p", { class: "tune-help" }, "This agent takes no reasoning setting from Filament: pick a model id that names a level, if it lists any."));
    const words = () => {
      const now = entry?.caps?.effort || {};
      const L = Array.isArray(now.levels) ? now.levels : null;
      return L === null ? "nobody states its levels: the picker offers none, and the model decides" : !L.length ? "takes no effort field (Filament removes it)" : `${levelList(L)}${now.default ? `, default ${LEVEL_WORDS[now.default] || now.default}` : ""}`;
    };
    const setting = pend.efforts !== undefined;
    /** @type {string[]} */
    const levels = Array.isArray(pend.efforts) ? pend.efforts : [];
    const none = setting && !levels.length;
    const body = [h("div", { class: "tune-row" }, seg([{ id: "auto", label: "Automatic" }, { id: "set", label: "Set here" }], setting ? "set" : "auto", (id) => {
      if (id === "auto") { delete pend.efforts; delete pend.effortDefault; }
      else pend.efforts = lv && lv.length ? [...lv] : [...LEVELS];
      changed(true);
    }, "Reasoning levels"), setting ? h("span", { class: "tune-src" }, "the levels ticked are the ones offered and sent; a level outside them is clamped") : liveNote(() => { const { v, fb } = autoPart("efforts", "effort"); return `automatic: ${said("efforts", v.source ?? null, fb)}`; }))];
    if (setting) {
      const boxes = LEVELS.map((l) => {
        const i = h("input", { type: "checkbox" });
        /** @type {HTMLInputElement} */ (i).checked = levels.includes(l);
        /** @type {HTMLInputElement} */ (i).disabled = none;
        i.onchange = () => {
          const next = new Set(levels);
          if (/** @type {HTMLInputElement} */ (i).checked) next.add(l);
          else next.delete(l);
          // Unticking the last level is not "takes none" — that is the box below, said on purpose.
          if (next.size) pend.efforts = LEVELS.filter((v) => next.has(v));
          if (pend.effortDefault && !pend.efforts.includes(pend.effortDefault)) delete pend.effortDefault;
          changed(true);
        };
        return h("label", { class: "check" }, i, LEVEL_WORDS[l]);
      });
      const noneBox = h("input", { type: "checkbox" });
      /** @type {HTMLInputElement} */ (noneBox).checked = none;
      noneBox.onchange = () => {
        pend.efforts = /** @type {HTMLInputElement} */ (noneBox).checked ? [] : lv && lv.length ? [...lv] : [...LEVELS];
        delete pend.effortDefault;
        changed(true);
      };
      body.push(h("div", { class: "tune-row" }, ...boxes), h("div", { class: "tune-row" }, h("label", { class: "check" }, noneBox, "Takes no reasoning field — Filament removes it instead of clamping")));
      if (!none) {
        const sel = h("select", { "aria-label": "The provider's default level" }, h("option", { value: "" }, "not stated"), ...levels.map((l) => h("option", { value: l }, LEVEL_WORDS[l])));
        /** @type {HTMLSelectElement} */ (sel).value = pend.effortDefault || "";
        sel.onchange = () => {
          const v = /** @type {HTMLSelectElement} */ (sel).value;
          if (v) pend.effortDefault = v;
          else delete pend.effortDefault;
          changed();
        };
        body.push(h("div", { class: "tune-row" }, h("label", {}, "The provider's default ", sel), h("span", { class: "tune-src" }, "the level it uses when none is sent — the picker's Auto says it")));
      }
    }
    const allowed = entry?.policy?.effortAllowed;
    const cut = lv && Array.isArray(allowed) ? lv.filter((/** @type {string} */ l) => !allowed.includes(l)) : [];
    if (cut.length) body.push(h("p", { class: "tune-help" }, `The Rules page allows no ${cut.map((/** @type {string} */ l) => LEVEL_WORDS[l] || l).join(" or ")}: the picker leaves ${cut.length === 1 ? "it" : "them"} out.`));
    return section("Reasoning", words, () => srcPill("efforts", entry?.caps?.effort?.source ?? null), ...body);
  };

  const fast = () => {
    const sp = entry?.offer?.speed;
    const times = (/** @type {unknown} */ m) => (Number(m) > 1 ? `${m}×` : "");
    // The multiplier is against the price; a coding agent's turns bill a subscription, where it is the quota, and a
    // model on a subscription plan spends the plan's usage.
    const unit = o.agent ? "the plan's quota" : entry?.billing?.billing === "plan" ? "your plan's usage" : "the standard price";
    const priced = !o.agent && !!(entry?.offer?.price && (entry.offer.price.input || entry.offer.price.output));
    const unpricedHelp = priced || o.agent ? null : h("p", { class: "tune-help" }, "No price is known for this model here yet: the number still counts — on a subscription plan it is how much faster fast mode spends the quota.");
    if (sp?.via === "name") {
      return section("Fast mode", () => { const m = times(entry?.offer?.speed?.multiplier); return `fast ids${m ? `, ${m}` : ""}`; }, fixed("src-name", "model ids"),
        h("p", { class: "tune-help" }, "This provider lists its fast variants as ids of their own; the picker's Speed switch moves between them. What a fast id costs against its standard one:"),
        numberField("fastMultiplier", "A fast id costs", `× ${unit}`, () => times(entry?.offer?.speed?.multiplier) || "not stated", { min: 1, step: 0.5 }),
        variants ? h("p", { class: "tune-help" }, `Set on the family's base row “${key}”, which covers every id that starts with it.`) : null);
    }
    if (o.agent) return section("Fast mode", () => "the agent's own", fixed("src-name", "agent"), h("p", { class: "tune-help" }, "A coding agent's speed is its own: when it has fast variants, they are ids it lists."));
    const mode = pend.fast === true ? "on" : pend.fast === false ? "off" : "auto";
    const words = () => {
      const now = entry?.caps?.fast || {};
      const m = times(now.multiplier);
      return now.available ? `yes${m ? `, ${m} ${unit}` : ""}` : now.missing === "params" ? "marked fast, but no request fields to ask with" : "none known here";
    };
    const body = [h("div", { class: "tune-row" }, seg([{ id: "auto", label: "Automatic" }, { id: "on", label: "Has fast mode" }, { id: "off", label: "No fast mode" }], mode, (id) => {
      if (id === "auto") delete pend.fast;
      else pend.fast = id === "on";
      // Request fields only travel with "Has fast mode"; the ones typed are kept for a switch back.
      if (id === "on" && !pend.fastParams) pend.fastParams = keptParams || (wire === "openai" ? { service_tier: "priority" } : undefined);
      if (pend.fastParams === undefined) delete pend.fastParams;
      if (id !== "on") { if (pend.fastParams) keptParams = pend.fastParams; delete pend.fastParams; bad.delete("fastParams"); }
      if (id === "off") { delete pend.fastMultiplier; bad.delete("fastMultiplier"); }
      changed(true);
    }, "Fast mode"), mode === "auto" ? liveNote(() => { const { v, fb } = autoPart("fast", "fast"); return `automatic: ${v.available ? `has fast mode, ${said("fast", v.source ?? null, fb)}` : "none known — no provider lists fast mode, so it is yours to declare"}`; }) : h("span", { class: "tune-src" }, mode === "on" ? "the picker offers the Speed switch" : "the picker offers no fast mode; a -fast request runs at standard speed, and the record says so"))];
    if (mode !== "off") body.push(numberField("fastMultiplier", "Fast costs", `× ${unit}`, () => { const { v, fb } = autoPart("fastMultiplier", "fast"); return v.multiplier ? `${times(v.multiplier)} (${said("fastMultiplier", v.multiplierSource ?? null, fb)})` : "not stated"; }, { min: 1, step: 0.5 }), unpricedHelp);
    if (mode === "on") {
      if (wire === "openai" || pend.fastParams) {
        const ta = h("textarea", { spellcheck: "false", "aria-label": "Request fields for fast mode", placeholder: '{"service_tier": "priority"}' });
        /** @type {HTMLTextAreaElement} */ (ta).value = pend.fastParams ? JSON.stringify(pend.fastParams) : "";
        ta.oninput = () => {
          const t = /** @type {HTMLTextAreaElement} */ (ta).value.trim();
          bad.delete("fastParams");
          if (!t) delete pend.fastParams;
          else {
            try {
              const j = JSON.parse(t);
              if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("not an object");
              pend.fastParams = j;
            } catch {
              bad.add("fastParams");
            }
          }
          ta.classList.toggle("bad", bad.has("fastParams"));
          changed();
        };
        body.push(h("div", { class: "tune-row" }, h("label", { class: "grow" }, "Request fields", ta)),
          h("p", { class: "tune-help" }, wire === "openai" ? "Sent with every fast request. xAI and OpenAI take service_tier: priority — and the reply names the tier it served, which decides whether the request bills fast." : "Extra fields sent beside speed: \"fast\", for a gateway that wants its own."));
      } else body.push(h("p", { class: "tune-help" }, "On the Anthropic wire Filament sends speed: \"fast\" with its beta header: no fields needed."));
    }
    return section("Fast mode", words, () => srcPill("fast", entry?.caps?.fast?.source ?? null), ...body);
  };

  // The flex tier (Providers P5): an OpenAI-format provider's cheaper, slower processing (OpenAI's service_tier: flex).
  // Nothing built in knows one, so it is declared here or not at all; a flex request bills at the multiplier only when
  // the reply says it was served there.
  const flex = () => {
    if (o.agent || wire !== "openai" || entry?.offer?.speed?.via === "name") return null;
    const on = pend.flex === true;
    const unit = entry?.billing?.billing === "plan" ? "your plan's usage" : "the standard price";
    const words = () => {
      const now = entry?.caps?.flex || {};
      const m = Number(now.multiplier) > 0 ? `${now.multiplier}×` : "";
      return now.available ? `yes${m ? `, ${m} ${unit} when served there` : ""}` : now.missing === "params" ? "marked flex, but no request fields to ask with" : "none";
    };
    const body = [h("div", { class: "tune-row" }, seg([{ id: "off", label: "No flex tier" }, { id: "on", label: "Has a flex tier" }], on ? "on" : "off", (id) => {
      if (id === "on") {
        pend.flex = true;
        if (!pend.flexParams) pend.flexParams = keptFlexParams || { service_tier: "flex" };
      } else {
        if (pend.flexParams) keptFlexParams = pend.flexParams;
        delete pend.flex; delete pend.flexParams; delete pend.flexMultiplier;
        bad.delete("flexParams"); bad.delete("flexMultiplier");
      }
      changed(true);
    }, "Flex tier"), h("span", { class: "tune-src" }, on ? "the picker offers Flex on the Speed switch" : "no flex tier: a -flex name is not read as one"))];
    if (on) {
      body.push(numberField("flexMultiplier", "Flex costs", `× ${unit}`, () => "not stated — billed at the standard price", { min: 0.01, max: 1, step: 0.05 }));
      const ta = h("textarea", { spellcheck: "false", "aria-label": "Request fields for the flex tier", placeholder: '{"service_tier": "flex"}' });
      /** @type {HTMLTextAreaElement} */ (ta).value = pend.flexParams ? JSON.stringify(pend.flexParams) : "";
      ta.oninput = () => {
        const t = /** @type {HTMLTextAreaElement} */ (ta).value.trim();
        bad.delete("flexParams");
        if (!t) delete pend.flexParams;
        else {
          try {
            const j = JSON.parse(t);
            if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("not an object");
            pend.flexParams = j;
          } catch {
            bad.add("flexParams");
          }
        }
        ta.classList.toggle("bad", bad.has("flexParams"));
        changed();
      };
      body.push(h("div", { class: "tune-row" }, h("label", { class: "grow" }, "Request fields", ta)),
        h("p", { class: "tune-help" }, "Sent with every flex request. OpenAI takes service_tier: flex — and the reply names the tier it served: only that tier bills at the flex price."));
    }
    return section("Flex tier", words, () => srcPill("flex", entry?.caps?.flex?.source ?? null), ...body);
  };

  const thinking = () => {
    if (wire !== "anthropic") return null;
    const mode = pend.thinking === true ? "on" : pend.thinking === false ? "off" : "auto";
    return section("Extended thinking", () => (entry?.caps?.thinking?.available ? "yes" : "no"), () => srcPill("thinking", entry?.caps?.thinking?.source ?? null),
      h("div", { class: "tune-row" }, seg([{ id: "auto", label: "Automatic" }, { id: "on", label: "Takes it" }, { id: "off", label: "Not taken" }], mode, (id) => {
        if (id === "auto") delete pend.thinking;
        else pend.thinking = id === "on";
        changed(true);
      }, "Extended thinking"), mode === "auto" ? liveNote(() => { const { v, fb } = autoPart("thinking", "thinking"); return `automatic: ${v.available ? "takes it" : "not taken"}, ${said("thinking", v.source ?? null, fb)}`; }) : h("span", { class: "tune-src" }, mode === "on" ? "the picker offers the Extended thinking switch" : "no switch, and a thinking field in a request is removed")));
  };

  // Whether the model takes tools (HarnessV4_Tasks E4). A coding agent brings its own: nothing here speaks for one.
  const tools = () => {
    if (o.agent) return null;
    const mode = pend.tools === true ? "on" : pend.tools === false ? "off" : "auto";
    return section("Tools", () => (entry?.caps?.tools?.available === false ? "takes none" : "takes them"), () => srcPill("tools", entry?.caps?.tools?.source ?? null),
      h("div", { class: "tune-row" }, seg([{ id: "auto", label: "Automatic" }, { id: "on", label: "Takes them" }, { id: "off", label: "Takes none" }], mode, (id) => {
        if (id === "auto") delete pend.tools;
        else pend.tools = id === "on";
        changed(true);
      }, "Tools"), mode === "auto" ? liveNote(() => { const { v, fb } = autoPart("tools", "tools"); return `automatic: ${v.available === false ? "takes none" : "takes them"}, ${v.source ? said("tools", v.source, fb) : "nobody says otherwise"}`; }) : h("span", { class: "tune-src" }, mode === "on" ? "Filament's agent and memory offer it their tools" : "Filament's agent answers on it in words only, memory offers it no tools, and the Assistant refuses it; a client's own tools are still sent as it sent them")));
  };

  const windows = () => {
    // A family sold as a name per window (Kimi's k3 at 1M, k3-256k at 256K): the picker's window choice picks the name.
    const named = entry?.offer?.window?.via === "name" ? entry.offer.window : null;
    const words = () => {
      const now = entry?.caps?.window || {};
      if (named) return windowChoices(named).map((n) => windowWithCost(named, n)).join(" · ");
      return now.standard ? `${tokens(now.standard)}${now.options?.length >= 2 ? `; a session may choose ${now.options.map(winWords).join(" · ")}` : ""}` : "not known";
    };
    const body = [numberField("contextTokens", "Standard window", "tokens", () => { const { v, fb } = autoPart("contextTokens", "window"); return v.standard ? `${tokens(v.standard)}, ${said("contextTokens", v.standardSource ?? null, fb)}` : "not known — the context meter has no scale"; }, { min: 1000, step: 1000 })];
    if (named) {
      /** @type {Record<string, string>} */
      const ids = entry.offer.windowIds || {};
      const std = Number(named.standard) || 0;
      const nameOf = (/** @type {number} */ opt) => String(ids[String(opt)] || "").replace(/^[^/]*\//, "");
      const pairs = (named.options || []).map((/** @type {number} */ opt) => ({ opt, tokens: opt || std })).filter((/** @type {any} */ p) => p.tokens);
      body.unshift(h("p", { class: "tune-help" },
        `Each window here is a model of its own: ${pairs.map((/** @type {any} */ p) => `${winWords(p.tokens)} is ${nameOf(p.opt) || "its own id"}`).join(", ")}. `,
        "The harness's picker switches to that name when a window is chosen, and the route sends it as it is. The standard window below is this row's own; ",
        h("i", {}, "Other windows"), " is for windows one name takes itself (Anthropic's 1M), which these are not."));
      // What each window costs against the cheapest: one row per window, written on this family's row.
      for (const p of pairs) {
        const k = String(p.tokens);
        const i = h("input", { type: "number", min: "1", step: "0.25", placeholder: "1", value: pend.windowMultipliers?.[k] ?? "", "aria-label": `What the ${winWords(p.tokens)} window costs, times the cheapest` });
        i.oninput = () => {
          const t = /** @type {HTMLInputElement} */ (i).value.trim();
          const map = { ...(pend.windowMultipliers || {}) };
          if (t === "") delete map[k];
          else map[k] = Number(t);
          bad.delete("windowMultipliers");
          if (Object.values(map).some((x) => !(Number(x) >= 1))) bad.add("windowMultipliers");
          if (Object.keys(map).length) pend.windowMultipliers = map;
          else delete pend.windowMultipliers;
          i.classList.toggle("bad", !!t && !(Number(t) >= 1));
          changed();
        };
        body.push(h("div", { class: "tune-row" }, h("label", {}, `${winWords(p.tokens)}${nameOf(p.opt) ? ` (${nameOf(p.opt)})` : ""} costs `, i, h("span", { class: "tune-unit" }, "× the cheapest window"))));
      }
      body.push(liveNote(() => pend.windowMultipliers
        ? "set here: each window's cost against the cheapest (2 = twice; on a plan, twice the quota) — empty them all for automatic"
        : named.multipliers
          ? `automatic, from their prices: ${windowChoices(named).map((n) => windowWithCost(named, n)).join(" · ")}`
          : "automatic: nobody states what the windows cost — on a plan, say it here (2 = twice the quota)"));
    }
    if (!o.agent) {
      const only = Array.isArray(pend.windows) && !pend.windows.length;
      const i = h("input", { type: "text", placeholder: "automatic", "aria-label": "Other windows", value: Array.isArray(pend.windows) && pend.windows.length ? windowsText(pend.windows) : "" });
      /** @type {HTMLInputElement} */ (i).disabled = only;
      const autoWins = () => { const { v, fb } = autoPart("windows", "window"); return (v.options || []).length >= 2 ? `${v.options.map(winWords).join(" · ")}, ${said("windows", v.source ?? null, fb)}` : "the standard one only"; };
      const note = h("span", { class: "tune-src" });
      const say = () => { note.textContent = bad.has("windows") ? "not a list of windows yet — type token counts like 200K, 1M, or empty it for automatic" : pend.windows === undefined ? `automatic: ${autoWins()} — type 200K, 1M` : only ? "set here: the standard window only" : "set here — empty it to go back to automatic"; };
      live.push(say);
      i.oninput = () => {
        const t = /** @type {HTMLInputElement} */ (i).value.trim();
        bad.delete("windows");
        if (!t) delete pend.windows;
        else {
          const w = parseWindows(t);
          if (w && w.length) pend.windows = w;
          else bad.add("windows");
        }
        i.classList.toggle("bad", bad.has("windows"));
        say();
        changed();
      };
      say();
      const onlyBox = h("input", { type: "checkbox" });
      /** @type {HTMLInputElement} */ (onlyBox).checked = only;
      onlyBox.onchange = () => {
        if (/** @type {HTMLInputElement} */ (onlyBox).checked) pend.windows = [];
        else delete pend.windows;
        bad.delete("windows");
        changed(true);
      };
      body.push(h("div", { class: "tune-row" }, h("label", {}, "Other windows ", i), note), h("div", { class: "tune-row" }, h("label", { class: "check" }, onlyBox, "The standard window only — no choice in the picker")));
    }
    // The standard window and the choices can come from different places (Anthropic lists the 1M; Filament knows 200K
    // is the other choice): then each says its own.
    const pill = () => {
      const now = entry?.caps?.window || {};
      const choices = now.options?.length >= 2;
      if (choices && now.standardSource && now.source !== now.standardSource) return h("span", { class: "tune-tags" }, srcPill("contextTokens", now.standardSource, "standard:"), srcPill("windows", now.source ?? null, "choices:"));
      return choices ? srcPill("windows", now.source ?? null) : srcPill("contextTokens", now.standardSource ?? null);
    };
    return section("Context window", words, pill, ...body);
  };

  const output = () => {
    if (o.agent) return null;
    return section("Output ceiling", () => { const t = entry?.caps?.maxOutput?.tokens; return t ? tokens(t) : "not stated — sessions use 128,000"; }, () => srcPill("maxOutputTokens", entry?.caps?.maxOutput?.source ?? null),
      numberField("maxOutputTokens", "Max output", "tokens", () => { const { v, fb } = autoPart("maxOutputTokens", "maxOutput"); return v.tokens ? `${tokens(v.tokens)}, ${said("maxOutputTokens", v.source ?? null, fb)}` : "not stated — sessions without their own max_tokens use 128,000"; }, { min: 256, step: 1000 }));
  };

  /** @type {Record<string, string>} */
  const PRICE_LABEL = { input: "in", cacheRead: "cached in", output: "out", cacheWrite: "cache write" };
  const pricing = () => {
    /**
     * The price the server reads for this model from the draft: this row's, a row that covers it, or the built-ins'.
     * A coding agent's turns bill its plan, and their list figure reads only a row the operator wrote — a built-in API
     * rate never prices them (HarnessV3-FixRound decision 26).
     */
    const card = () => {
      const p = entry?.price || null;
      return o.agent && p && p.source !== "upstream" ? null : p;
    };
    const ownPriced = () => PRICE_FIELDS.some((f) => pend[f] !== undefined);
    const words = (/** @type {any} */ p) => priceWords(p, fmtPrice);
    const from = () => {
      const p = card();
      if (!p) return "nobody prices it";
      return p.source === "upstream" ? (ownPriced() ? "set here" : "a row of this upstream that covers it") : p.source === "builtin" ? "Filament's built-in API rates" : String(p.source);
    };
    /** @type {Record<string, HTMLInputElement>} */
    const boxes = {};
    const note = h("span", { class: "tune-src" });
    const say = () => {
      note.textContent = PRICE_FIELDS.some((f) => bad.has(f))
        ? "a price is a number of at least 0 — fix it, or empty it"
        : ownPriced()
          ? "set here — empty the four boxes to fall back to the next source that prices it"
          : `automatic: ${card() && (Number(card().input) || Number(card().output)) ? `${words(card())}, ${from()}` : o.agent ? "nobody prices it — its turns show no list figure" : "nobody prices it — requests to it show no cost"}`;
    };
    for (const f of PRICE_FIELDS) {
      const p = card();
      const i = /** @type {HTMLInputElement} */ (h("input", { type: "number", min: "0", step: "0.01", value: pend[f] ?? "", placeholder: !ownPriced() && p && statedIn(p, f) && Number(p[f]) > 0 ? String(+Number(p[f]).toFixed(4)) : f === "cacheRead" || f === "cacheWrite" ? "= in" : "–", class: "price-in", "aria-label": `${PRICE_LABEL[f]} price, USD per million tokens` }));
      i.oninput = () => {
        const t = String(i.value).trim();
        bad.delete(f);
        if (t === "") delete pend[f];
        else if (Number.isFinite(Number(t)) && Number(t) >= 0) {
          if (!ownPriced())
            for (const [g, v] of Object.entries(carriedPrices(card(), f))) {
              pend[g] = v;
              boxes[g].value = String(v);
            }
          pend[f] = Number(t);
        } else bad.add(f);
        i.classList.toggle("bad", bad.has(f));
        say();
        changed();
      };
      boxes[f] = i;
    }
    live.push(say);
    say();
    const boxRow = h("div", { class: "tune-row price-row" }, ...PRICE_FIELDS.map((f) => h("label", {}, `${PRICE_LABEL[f]} `, boxes[f])), h("span", { class: "tune-unit" }, "USD per million tokens"));
    const chip = () => h("span", { class: `cap-chip src-${card()?.source === "builtin" ? "builtin" : card() ? "operator" : "none"}` }, from());
    // An agent's row is its list price alone: it is always on its plan, and Filament queues none of its turns.
    if (o.agent)
      return section("Pricing — for analytics", () => `${words(card())} · on the agent's plan`, chip,
        h("p", { class: "tune-help" }, "What the same tokens would cost per token at a metered provider. The agent's turns are paid by its plan ($0); this price only gives them the “at list” figure beside that $0 — on Usage, Traffic, the turn footer and the Spend widget. An agent counts its own tokens, so the figure is an estimate. A cache price left empty is the in price."),
        boxRow,
        h("div", { class: "tune-row" }, note));
    // How this model is billed (Providers P4): its provider's way unless this row says otherwise — a provider may sell
    // one model per token beside another on a plan.
    const billNote = h("span", { class: "tune-src" });
    const sayBill = () => {
      const b = entry?.billing;
      billNote.textContent = !b ? "" : b.billing === "plan" ? "on a plan: each request is paid $0, its list price kept for analytics" : "per token: each request is paid at the list price";
    };
    live.push(sayBill);
    sayBill();
    const provWay = entry?.billing?.provider === "plan" ? "a plan" : "per token";
    const billRow = h("div", { class: "tune-row" }, h("span", {}, "Billed "),
      seg([{ id: "auto", label: `Like the provider (${provWay})` }, { id: "metered", label: "Per token" }, { id: "plan", label: "On a plan" }], pend.billing ?? "auto", (id) => {
        if (id === "auto") delete pend.billing;
        else pend.billing = id;
        changed(true);
      }, "How this model is billed"),
      billNote);
    return section("Pricing — for analytics", () => `${words(card())}${entry?.billing?.billing === "plan" ? " · on a plan" : ""}`, chip,
      h("p", { class: "tune-help" }, "The list price per million tokens at this provider. The cost figures read it — Usage, Traffic, the turn footer, the Spend widget — and so does fast mode's multiplier when its ids are priced apart. A cache price left empty is the in price: no discount is assumed.", variants ? ` Set on the family's base row “${key}”, which prices every id that starts with it unless one has a row of its own.` : ""),
      boxRow,
      h("div", { class: "tune-row" }, note),
      billRow);
  };

  const preview = h("div", { class: "tune-preview", "aria-live": "polite" });
  const applyLabel = kit.applyLabel || "Apply";
  const applyBtn = /** @type {HTMLButtonElement} */ (kit.button({ label: applyLabel, primary: true }));
  /** Why the last Apply did not go through (a save the server refused): said in the preview until the next one. @type {string | null} */
  let applyError = null;
  /** @type {Record<string, string>} */
  const BAD = { input: "The in price is a number of at least 0", cacheRead: "The cached-in price is a number of at least 0", output: "The out price is a number of at least 0", cacheWrite: "The cache-write price is a number of at least 0", windowMultipliers: "A window's cost is a multiplier of at least 1 (2 = twice the cheapest)", windows: "Other windows: type token counts like 200K, 1M", fastParams: "Request fields: not a JSON object yet", fastMultiplier: "The fast multiplier is at least 1 (2 = twice)", flexParams: "Flex request fields: not a JSON object yet", flexMultiplier: "The flex multiplier is above 0 and at most 1 (0.5 = half)", contextTokens: "The standard window is a token count, at least 1,000", maxOutputTokens: "Max output is a token count, at least 256" };
  const paintPreview = () => {
    const f = entry?.offer;
    const lines = [];
    if (f?.effort?.levels?.length) lines.push(`Reasoning ${levelList(f.effort.levels)}${f.effort.default ? ` (Auto: ${LEVEL_WORDS[f.effort.default] || f.effort.default})` : ""}`);
    if (f?.speed?.options?.length) lines.push(`Speed ${f.speed.options.map((/** @type {string} */ s) => (s === "fast" && Number(f.speed.multiplier) > 1 ? `Fast (${f.speed.multiplier}×)` : s[0].toUpperCase() + s.slice(1))).join(" · ")}`);
    if (f?.thinking) lines.push("Extended thinking switch");
    if (windowChoices(f?.window).length) lines.push(`Windows ${windowChoices(f.window).map((n) => windowWithCost(f.window, n)).join(" · ")}`);
    const absent = [];
    if (f && !f.speed) absent.push("no fast mode");
    if (f && !f.effort) absent.push("no reasoning levels");
    if (entry?.caps?.tools?.available === false) absent.push("no tools (Filament's agent answers in words only)");
    const problems = [...errors, ...[...bad].map((b) => BAD[b] || b), ...(applyError ? [`Not kept: ${applyError}`] : [])];
    preview.replaceChildren(...[
      h("div", { class: "tune-preview-head" }, h("b", {}, "The harness's model picker will offer"), h("span", { class: "muted small" }, " — requests are shaped by the same answer")),
      // Each offer holds together on a line of its own; the lines break between offers, never inside one.
      h("div", { class: "tune-preview-body" }, ...(lines.length ? lines.flatMap((l, i) => [i ? " · " : "", h("span", { class: "tune-offer" }, l)]) : ["nothing to tune: the model is picked plain"])),
      absent.length && lines.length ? h("div", { class: "muted small" }, `And ${absent.join(", ")}.`) : null,
      askError ? h("div", { class: "warn small" }, `The preview could not be asked (${askError}): what it shows is from before this change.`) : null,
      problems.length ? h("ul", { class: "err small tune-errors" }, ...problems.map((e) => h("li", {}, e))) : null,
    ].filter((n) => n !== null));
    applyBtn.disabled = problems.length > (applyError ? 1 : 0);
  };

  const paint = () => {
    live = [];
    box.replaceChildren(...[
      h("p", { class: "muted small tune-intro" }, "What this model can do at ", h("b", {}, u.name || u.id), ". Each part is Automatic — the provider's own model list, the Rules page or Filament's built-in knowledge, whichever knows — until you set it here."),
      variants ? h("p", { class: "small tune-intro" }, `These ids are one family (${entry?.offer?.family}): the sheet sets its base row “${key}”, which covers every id that starts with it.`) : null,
      covered.length ? h("p", { class: "small tune-intro tune-covers" }, h("b", {}, "Also covers "), covered.slice(0, 6).map((n, i) => [i ? ", " : "", h("code", {}, n)]).flat(), covered.length > 6 ? ` and ${covered.length - 6} more` : "", `: a row keyed “${key}” speaks for every model whose name starts with it, so what you set here applies to ${covered.length === 1 ? "it" : "them"} too — unless ${covered.length === 1 ? "its" : "their"} own row says otherwise (tune ${covered.length === 1 ? "it" : "one"} to give it one).`) : null,
      reasoning(),
      fast(),
      flex(),
      thinking(),
      tools(),
      windows(),
      output(),
      pricing(),
      h("div", { class: "tune-foot" }, preview,
        h("div", { class: "row tune-actions" }, applyBtn,
          kit.button({ label: "Cancel", onClick: () => shown.close() }),
          h("span", { class: "grow" }),
          kit.button({ label: "All automatic", title: "Take every capability field off this row; its prices stay", onClick: () => { for (const f of TUNE_FIELDS) delete pend[f]; bad.clear(); changed(true); } }))),
    ].filter((n) => n !== null));
    paintPreview();
  };
  applyBtn.addEventListener("click", async () => {
    if (bad.size || errors.length) return;
    const row = rowOf();
    applyError = null;
    applyBtn.disabled = true;
    try {
      await o.onApply({ key, row: Object.keys(row).length ? row : null });
    } catch (e) {
      applyError = String(/** @type {any} */ (e)?.message || e);
      paintPreview();
      return;
    }
    shown.close(true);
  });
  paint();
  // Escape, ×, Cancel: edits Apply has not taken are asked about before they go.
  const shown = kit.open(`Tune ${key}`, box, { dirty, discard: `Discard your changes to ${key}? Nothing is kept until you press ${applyLabel}.` });
  ask();
}
