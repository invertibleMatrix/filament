// @ts-check
// "Add a provider" (HarnessV3-Providers P1, the vault's HarnessV3-Providers.md §4): pick a provider, paste its key,
// see its models as the picker will show them, press Add. One write adds the upstream, its prefix route, the models
// left out (its hidden list) and the catalogue's hints (its first model rows) — POST /api/upstreams, against the
// configuration as it stands (HarnessV4_Settings_Plan HS-D3) — and the save's own discovery (P0) then lists the models
// on its card. The catalogue arrives from GET /api/providers; its words are ui/lib/providers.js's.
import { ui } from "../runtime.js";
import { placeholders, fillUrl, prefixProblem, freePrefix, hostWord, CUSTOM, variantWords } from "../lib/providers.js";

/**
 * The add flow, drawn into its own box: Choose, then Connect (plan, key, prefix, the probe, Advanced), the models it
 * found, and Add. Its state lives in `state.addFlow`, so a page redraw keeps what was typed.
 * @param {{ special?: { title: string, when: string, note?: string, action: () => void }[], canCancel?: boolean }} [o]
 */
export function providerAdd(o = {}) {
  const { state, api, h, toast, render, markDirty, fmt, configFollow } = /** @type {any} */ (ui);
  const box = h("div", { class: "provider-add" });
  const F = (state.addFlow ||= { step: "choose", q: "" });
  const entries = () => [...(state._providers?.providers || []), ...CUSTOM];
  const entryOf = (/** @type {string} */ id) => entries().find((p) => p.id === id) || null;
  const draw = () => {
    const p = F.step === "connect" ? entryOf(F.entry) : null;
    box.replaceChildren(p ? connect(p) : choose());
  };
  let timer = /** @type {any} */ (null); // the probe's quiet time after typing; cleared whenever the flow moves on
  const cancel = () => { clearTimeout(timer); state.addFlow = null; state.addUp = false; render(); };

  // ---- Step 1: choose ----
  const choose = () => {
    const grid = h("div", { class: "add-grid" });
    const tile = (/** @type {any} */ p) => h("button", { type: "button", class: "add-option prov-tile", "data-provider": p.id, onclick: () => start(p) },
      h("b", {}, p.name), h("span", { class: "small" }, p.blurb),
      h("span", { class: "prov-tags" },
        h("span", { class: `pill${p.keyless ? " ok" : ""}` }, p.keyless ? "No key (local)" : p.custom ? "Address and key" : "API key"),
        p.plans.some((/** @type {any} */ x) => x.billing === "plan") && !p.keyless ? h("span", { class: "pill live" }, "Subscription plan") : "",
        p.plans.length > 1 ? h("span", { class: "pill" }, `${p.plans.length} ${p.plans.some((/** @type {any} */ x) => x.billing === "plan") ? "plans" : "regions"}`) : ""));
    const special = (/** @type {any} */ s) => h("button", { type: "button", class: "add-option", onclick: s.action }, h("b", {}, s.title), h("span", { class: "small" }, s.when), s.note ? h("span", { class: "muted small" }, s.note) : "");
    const fill = () => {
      const q = String(F.q || "").trim().toLowerCase();
      const hit = (/** @type {any} */ p) => !q || [p.name, p.id, p.blurb].some((x) => String(x || "").toLowerCase().includes(q));
      grid.replaceChildren(...entries().filter(hit).map(tile), ...(o.special || []).filter((s) => !q || `${s.title} ${s.when}`.toLowerCase().includes(q)).map(special));
    };
    const search = h("input", { type: "search", class: "prov-search", placeholder: "Search providers", value: F.q || "", oninput: () => { F.q = search.value || ""; fill(); } });
    fill();
    return h("section", { class: "panel" },
      h("div", { class: "row", style: "margin:0 0 6px;align-items:baseline" }, h("h2", { style: "margin:0" }, "Add a provider"), h("span", { class: "grow" }), o.canCancel ? h("button", { class: "sm ghost", onclick: cancel }, "Cancel") : ""),
      h("p", { class: "muted small" }, "Pick one, paste its key, and its models are listed before anything is saved. Your tools then ask for them as ", h("code", {}, "prefix/model"), "."),
      search, grid);
  };
  const start = (/** @type {any} */ p) => {
    Object.assign(F, { step: "connect", entry: p.id, plan: p.plans[0].id, key: "", fields: {}, adv: {}, headers: [], prefix: freePrefix(state.config, p.prefix), prefixTyped: false, probe: null, seq: (F.seq || 0) + 1, off: new Set(), otherOn: new Set(), famQ: "" });
    draw();
  };

  // ---- Steps 2–4: connect, models, add ----
  const connect = (/** @type {any} */ p) => {
    const planNow = () => p.plans.find((/** @type {any} */ x) => x.id === F.plan) || p.plans[0];
    const baseUrl = () => (F.adv.baseUrl != null ? F.adv.baseUrl : fillUrl(planNow().baseUrl, F.fields) || "");
    const openaiWire = p.type === "openai" || p.type === "openai-compatible";
    const draft = () => ({
      id: F.prefix, name: F.adv.name || (p.custom ? F.prefix : p.name), type: p.type, baseUrl: baseUrl(), apiKey: F.key || "",
      authStyle: F.adv.authStyle || "auto", ...(openaiWire ? { wireApi: F.adv.wireApi || "auto" } : {}),
      modelsPath: F.adv.modelsPath != null ? F.adv.modelsPath : planNow().modelsPath || "",
      headers: Object.fromEntries((F.headers || []).filter((/** @type {string[]} */ [k]) => String(k || "").trim()).map((/** @type {string[]} */ [k, v]) => [k.trim(), v])),
      enabled: true, rules: {},
    });
    const status = h("div", { class: "prov-status small" });
    const models = h("div", { class: "prov-models" });
    const example = h("div", { class: "muted small prov-example" });
    const prefixErr = h("div", { class: "err small" });
    const addLabel = `Add ${p.custom ? "this provider" : p.name}`;
    const addBtn = h("button", { class: "primary", disabled: "", onclick: () => add(false) }, addLabel);
    const anyway = h("span", {});
    const count = h("span", { class: "muted small" });
    const soon = () => { clearTimeout(timer); timer = setTimeout(probe, 600); };
    const onEnter = (/** @type {any} */ e) => { if (e.key === "Enter") probe(); };

    const setPrefix = () => {
      const problem = prefixProblem(state.config, F.prefix);
      prefixErr.replaceChildren(F.prefix || baseUrl() ? problem : ""); // a custom tile's empty prefix waits for its address
      const first = F.probe?.ok ? (F.probe.families || [])[0]?.id : "";
      example.replaceChildren("Your tools ask for ", h("code", {}, first || `${F.prefix || "prefix"}/<model>`), first ? " and the rest of its list the same way." : ".");
      return problem;
    };
    const setStatus = (/** @type {string} */ kind, /** @type {any[]} */ ...words) => status.replaceChildren(h("span", { class: `pill ${kind === "ok" ? "ok" : kind === "err" ? "err" : ""}` }, kind === "ok" ? "connected" : kind === "err" ? "not connected" : kind === "busy" ? "connecting…" : "waiting"), " ", ...words, " ", h("button", { class: "sm ghost", onclick: () => probe() }, kind === "err" ? "Try again" : "Connect"));
    const drawAdd = () => {
      const ok = !!F.probe?.ok && !setPrefix() && !!baseUrl();
      addBtn.disabled = !ok;
      anyway.replaceChildren(F.probe && !F.probe.ok && baseUrl() && !prefixProblem(state.config, F.prefix) ? h("button", { class: "sm ghost", title: "Add it without a model list: the name still works when asked for, and Refresh on its card asks again later", onclick: () => add(true) }, "Add anyway") : "");
    };
    const probe = async () => {
      clearTimeout(timer);
      setPrefix();
      const url = baseUrl();
      const missing = placeholders(planNow().baseUrl).find((k) => !fillUrl(`{${k}}`, F.fields));
      if (!url) { F.probe = null; setStatus("wait", missing ? `Type the ${((p.fields || []).find((/** @type {any} */ x) => x.id === missing)?.label || missing)} to connect.` : "Type the provider's address to connect."); drawModels(); return drawAdd(); }
      if (!p.keyless && !p.custom && !F.key) { F.probe = null; setStatus("wait", "Paste the key to connect."); drawModels(); return drawAdd(); }
      const seq = ++F.seq;
      F.probe = null;
      setStatus("busy", `Asking ${p.custom ? url : p.name} for its models…`);
      drawModels(); drawAdd();
      /** @type {any} */
      let r;
      try {
        r = await api("/providers/probe", { method: "POST", body: { upstream: draft(), prefix: F.prefix || p.prefix || "provider", provider: p.custom ? "" : p.id } });
      } catch (/** @type {any} */ e) {
        r = { ok: false, status: 0, error: e.message, sample: "" };
      }
      if (seq !== F.seq) return; // a newer ask began: this answer is old
      F.probe = r;
      if (r.ok) { F.off = new Set(p.pickNone ? (r.families || []).map((/** @type {any} */ f) => f.id) : []); F.otherOn = new Set(); }
      const n = (r.models || []).length;
      if (r.ok) setStatus("ok", h("b", {}, `${n} model${n === 1 ? "" : "s"}`), (r.other || []).length ? ` (${r.other.length} not for chat)` : "", h("span", { class: "muted" }, ` · ${fmt.ms(r.ms)}`));
      else {
        const gist = fmt.errorGist(r.sample) || r.error || "no answer";
        setStatus("err", h("span", { title: r.sample || r.error || "" }, `${r.status ? `${r.status} · ` : ""}${String(gist).slice(0, 160)}`));
      }
      drawModels(); drawAdd();
    };

    // The models it found, as the picker will show them: one row per family, its variants once, its ids folded away.
    const drawModels = () => {
      const r = F.probe;
      if (!r?.ok) return models.replaceChildren();
      const fams = r.families || [];
      const q = String(F.famQ || "").trim().toLowerCase();
      const shown = fams.filter((/** @type {any} */ f) => !q || f.id.toLowerCase().includes(q) || f.members.some((/** @type {any} */ m) => m.id.toLowerCase().includes(q)));
      const bare = (/** @type {string} */ id) => (id.startsWith(`${F.prefix}/`) ? id.slice(F.prefix.length + 1) : id);
      const famRow = (/** @type {any} */ f) => {
        const cb = h("input", { type: "checkbox", ...(F.off.has(f.id) ? {} : { checked: "" }), onchange: () => { if (cb.checked) F.off.delete(f.id); else F.off.add(f.id); drawCount(); } });
        const words = variantWords(f);
        return h("div", { class: "fam-row", "data-family": f.id },
          h("label", { class: "check", title: f.id }, cb, h("b", {}, bare(f.id))),
          h("span", { class: "chips-wrap" }, ...words.map((w) => h("span", { class: "cap-chip" }, w))),
          f.members.length > 1 ? h("details", { class: "fam-members" }, h("summary", { class: "muted small" }, `${f.members.length} ids`), h("div", { class: "chips-wrap" }, ...f.members.map((/** @type {any} */ m) => h("code", { class: "chip" }, m.name)))) : h("span", { class: "muted small mono" }, f.members[0]?.name || ""));
      };
      const others = r.other || [];
      const otherBox = others.length ? h("details", { class: "subform prov-other" }, h("summary", {}, `Other models (not for chat) · ${others.length}`),
        h("div", { class: "prov-other-body" }, h("p", { class: "muted small" }, "Embedding, rerank, speech and image models. They stay out of chat pickers unless ticked; each still works when asked for by name."),
          h("div", { class: "chips-wrap" }, ...others.map((/** @type {string} */ n) => { const cb = h("input", { type: "checkbox", ...(F.otherOn.has(n) ? { checked: "" } : {}), onchange: () => { if (cb.checked) F.otherOn.add(n); else F.otherOn.delete(n); drawCount(); } }); return h("label", { class: "check" }, cb, h("code", {}, n)); })))) : "";
      const famSearch = fams.length > 12 ? h("input", { type: "search", class: "prov-search", placeholder: "Filter models", value: F.famQ || "", oninput: () => { F.famQ = famSearch.value || ""; drawModels(); } }) : "";
      const all = (/** @type {boolean} */ on) => { F.off = new Set(on ? [] : fams.map((/** @type {any} */ f) => f.id)); drawModels(); };
      models.replaceChildren(
        h("div", { class: "row", style: "margin:12px 0 6px;align-items:center" }, h("b", {}, "Models"), count, h("span", { class: "grow" }), famSearch, fams.length > 1 ? h("button", { class: "sm ghost", onclick: () => all(true) }, "All") : "", fams.length > 1 ? h("button", { class: "sm ghost", onclick: () => all(false) }, "None") : ""),
        fams.length ? h("div", { class: "fam-list" }, ...shown.map(famRow)) : h("p", { class: "muted small" }, "It listed no chat models."),
        otherBox);
      drawCount();
    };
    const drawCount = () => {
      const r = F.probe;
      if (!r?.ok) return count.replaceChildren();
      const on = (r.families || []).filter((/** @type {any} */ f) => !F.off.has(f.id)).length;
      count.replaceChildren(` · ${on} of ${(r.families || []).length} offered in pickers${F.otherOn.size ? `, plus ${F.otherOn.size} other` : ""}`);
    };
    const hiddenList = () => {
      const r = F.probe;
      if (!r?.ok) return [];
      /** @type {string[]} */
      const out = [];
      for (const f of r.families || []) if (F.off.has(f.id)) for (const m of f.members) out.push(m.name);
      for (const n of r.other || []) if (!F.otherOn.has(n)) out.push(n);
      return [...new Set(out)];
    };

    const add = async (/** @type {boolean} */ anyway) => {
      const problem = prefixProblem(state.config, F.prefix) || prefixProblem(state.saved, F.prefix);
      if (problem) { prefixErr.replaceChildren(problem); return toast(problem, "err"); }
      if (!/^https?:\/\//i.test(baseUrl())) return toast("Type the provider's address first.", "err");
      if (!anyway && !F.probe?.ok) return;
      clearTimeout(timer);
      const d = draft();
      // Only the new provider is written, against the configuration as it stands: edits elsewhere on the page stay as
      // they were, unsaved.
      const body = {
        provider: p.custom ? "" : p.id, type: p.type, plan: F.plan, fields: F.fields, baseUrl: d.baseUrl, apiKey: d.apiKey, prefix: F.prefix,
        hiddenModels: hiddenList(), name: F.adv.name || "", authStyle: d.authStyle, wireApi: d.wireApi, modelsPath: d.modelsPath, headers: d.headers,
      };
      addBtn.disabled = true;
      addBtn.replaceChildren("Adding…");
      /** @type {any} */
      let r;
      try {
        r = await configFollow.own(async () => {
          const got = await api("/upstreams", { method: "POST", body });
          // A clean page takes the whole configuration as it is now; an edited one merges the new provider in by hand.
          if (state.dirty) configFollow.adopt(got.version);
          else configFollow.loaded(got.version);
          return got;
        });
      } catch (/** @type {any} */ e) {
        addBtn.disabled = false;
        addBtn.replaceChildren(addLabel);
        // A prefix taken since the page drew it (another window's add): the server's free one, ready for Add again.
        if (e.body?.free) { F.prefix = e.body.free; F.prefixTyped = true; prefixIn.value = F.prefix; drawAdd(); prefixErr.replaceChildren(`${e.message} ${F.prefix} is free: Add takes it.`); }
        return toast(e.message, "err");
      }
      const id = r.upstream.id;
      state.saved = structuredClone(r.config);
      if (!state.dirty) { state.config = r.config; state.unreadable = r.unreadable || []; markDirty(false); }
      else {
        const su = r.config.upstreams.find((/** @type {any} */ x) => x.id === id);
        const sr = r.config.routes.find((/** @type {any} */ x) => x.upstream === id && x.match === `${id}/*`);
        if (su) state.config.upstreams.push(structuredClone(su));
        if (sr) state.config.routes.unshift(structuredClone(sr));
      }
      state._catalog = null; state._catalogPending = null; if (state.catalog) state.catalog.cache = null;
      state.addFlow = null; state.addUp = false; state.selUp = id; state.justAdded = { id, prefix: F.prefix };
      toast(`Added. Your tools can ask for ${F.prefix}/… now.`);
      render();
    };

    // The inputs, built once per draw so typing never loses focus; what they change redraws only its own parts.
    const plans = p.plans.length > 1 ? h("div", { class: "row", style: "align-items:center" },
      h("span", { class: "small" }, "Plan "),
      h("div", { class: "seg" }, ...p.plans.map((/** @type {any} */ pl) => h("button", { type: "button", class: pl.id === F.plan ? "active" : "", onclick: () => { if (pl.id === F.plan) return; F.plan = pl.id; F.adv.baseUrl = undefined; F.adv.modelsPath = undefined; F.probe = null; F.seq++; draw(); } }, pl.label))),
      h("span", { class: "muted small" }, planNow().billing === "plan" ? (p.keyless ? "Runs on this machine: nothing is billed." : "A subscription: requests use your plan.") : "Billed per token.")) : h("p", { class: "muted small" }, planNow().billing === "plan" ? (p.keyless ? "Runs on this machine: nothing is billed." : "A subscription: requests use your plan.") : "Billed per token.");
    const fieldIns = placeholders(planNow().baseUrl).map((k) => {
      const def = (p.fields || []).find((/** @type {any} */ x) => x.id === k) || { id: k, label: k };
      const i = h("input", { type: "text", class: "mono", value: F.fields[k] || "", placeholder: def.placeholder || "", oninput: () => { F.fields[k] = String(i.value || "").trim(); soon(); }, onkeydown: onEnter });
      return h("label", {}, `${def.label} `, i, def.hint ? h("span", { class: "muted small", style: "display:block" }, def.hint) : "");
    });
    const urlIn = h("input", { type: "text", class: "mono", value: baseUrl(), placeholder: p.custom ? "https://gateway.example.com/v1" : "", oninput: () => {
      F.adv.baseUrl = String(urlIn.value || "").trim();
      if (p.custom && !F.prefixTyped) { F.prefix = freePrefix(state.config, hostWord(F.adv.baseUrl)); prefixIn.value = F.prefix; }
      soon();
    }, onkeydown: onEnter });
    const keyIn = h("input", { type: "password", value: F.key || "", placeholder: p.keyless ? "not needed" : "paste the key", autocomplete: "off", oninput: () => { F.key = keyIn.value || ""; soon(); }, onkeydown: onEnter });
    const prefixIn = h("input", { type: "text", class: "mono prefix-in", value: F.prefix || "", placeholder: "prefix", oninput: () => { F.prefix = String(prefixIn.value || "").trim(); F.prefixTyped = true; setPrefix(); drawAdd(); soon(); }, onkeydown: onEnter });
    const keyUrl = planNow().keyUrl || p.keyUrl;
    const sel = (/** @type {string} */ k, /** @type {string[][]} */ opts) => { const s = h("select", { onchange: () => { F.adv[k] = s.value; soon(); } }, ...opts.map(([v, l]) => h("option", { value: v, ...((F.adv[k] || "auto") === v ? { selected: "" } : {}) }, l))); return s; };
    const txt = (/** @type {string} */ k, /** @type {any} */ value, /** @type {string} */ ph, /** @type {boolean} */ probeIt) => { const i = h("input", { type: "text", class: "mono", value: value ?? "", placeholder: ph, oninput: () => { F.adv[k] = String(i.value || "").trim(); if (probeIt) soon(); } }); return i; };
    const headersBox = h("div", { class: "kv-edit" });
    const drawHeaders = () => headersBox.replaceChildren(...(F.headers || []).map((/** @type {string[]} */ pair, /** @type {number} */ i) => {
      const k = h("input", { type: "text", class: "mono", value: pair[0] || "", placeholder: "Header-Name", oninput: () => { pair[0] = k.value || ""; } });
      const v = h("input", { type: "text", class: "mono", value: pair[1] || "", placeholder: "value", oninput: () => { pair[1] = v.value || ""; } });
      return h("div", { class: "row", style: "margin:0 0 4px" }, k, v, h("button", { class: "sm ghost", title: "Remove this header", onclick: () => { F.headers.splice(i, 1); drawHeaders(); } }, "×"));
    }), h("button", { class: "sm ghost", onclick: () => { F.headers.push(["", ""]); drawHeaders(); } }, "+ header"));
    drawHeaders();
    const advanced = h("details", { class: "subform prov-advanced" }, h("summary", {}, "Advanced (address, auth, wire API, models path, headers, name)"),
      h("div", { class: "prov-adv-body" },
        p.custom ? "" : h("div", { class: "row" }, h("label", { class: "grow" }, "base URL ", urlIn)),
        h("div", { class: "row" },
          h("label", {}, "auth ", sel("authStyle", [["auto", "auto (the usual for the type)"], ["bearer", "Authorization: Bearer"], ["x-api-key", "x-api-key"], ["both", "both"]])),
          openaiWire ? h("label", {}, "wire API ", sel("wireApi", [["auto", "auto (detect)"], ["chat-completions", "/v1/chat/completions"], ["responses", "/v1/responses only"]])) : "",
          h("label", { class: "grow" }, "models path (blank = the base's /models) ", txt("modelsPath", F.adv.modelsPath != null ? F.adv.modelsPath : planNow().modelsPath || "", "/v1/models", true))),
        h("div", { class: "row" }, h("label", { class: "grow" }, "display name ", txt("name", F.adv.name || "", p.custom ? "shown in the console" : p.name, false))),
        h("div", {}, h("span", { class: "small" }, "extra headers"), headersBox)));

    const view = h("section", { class: "panel prov-connect" },
      h("div", { class: "row", style: "margin:0 0 6px;align-items:baseline" },
        h("button", { class: "sm ghost", onclick: () => { F.step = "choose"; F.seq++; clearTimeout(timer); draw(); } }, "← All providers"),
        h("h2", { style: "margin:0" }, `Add ${p.name}`), h("span", { class: "grow" }), o.canCancel ? h("button", { class: "sm ghost", onclick: cancel }, "Cancel") : ""),
      h("p", { class: "muted small" }, p.blurb, p.docsUrl ? h("span", {}, " ", h("a", { href: p.docsUrl, target: "_blank", rel: "noopener" }, "Its documentation")) : ""),
      plans,
      p.custom ? h("div", { class: "row" }, h("label", { class: "grow" }, "base URL ", urlIn)) : "",
      fieldIns.length ? h("div", { class: "row" }, ...fieldIns) : "",
      h("div", { class: "row" },
        p.keyless ? h("span", { class: "muted small" }, "No key: it runs on this machine.") : h("label", { class: "grow" }, "API key ", keyIn, keyUrl ? h("a", { class: "small", href: keyUrl, target: "_blank", rel: "noopener", style: "display:inline-block;margin-top:4px" }, "Get a key") : ""),
        h("label", {}, "prefix ", h("span", { class: "prefix-wrap" }, prefixIn, h("code", {}, "/")))),
      example, prefixErr, status, models, advanced,
      h("div", { class: "row", style: "margin:12px 0 0;align-items:center" }, addBtn, anyway, h("span", { class: "muted small" }, "One save: the provider, its prefix route and the models you ticked.")));
    // A draw keeps what the last ask found; a fresh step asks at once when it has what it needs.
    if (F.probe) { setStatus(F.probe.ok ? "ok" : "err", F.probe.ok ? `${(F.probe.models || []).length} models` : String(fmt.errorGist(F.probe.sample) || F.probe.error || "")); drawModels(); drawAdd(); }
    else probe();
    return view;
  };

  box.replaceChildren(h("span", { class: "muted small" }, "loading the provider list…"));
  (state._providers ? Promise.resolve(state._providers) : api("/providers").then((/** @type {any} */ r) => (state._providers = r)))
    .then(draw)
    .catch((/** @type {any} */ e) => box.replaceChildren(h("p", { class: "err small" }, `Could not load the provider list: ${e.message}`)));
  return box;
}
