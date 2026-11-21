// @ts-check
// Settings › Space (the owner's of 11-04: "a section inside settings called Space where we could have some useful global
// settings for space"): what every Space does where it chose nothing of its own — the model its agents run on, with that
// model's effort (its routines' runs, an app's asks run in the background, a button's second look), and what an app's
// ask does —; Pause all, which every Space shares; and the Spaces that chose their own, each with a way to it and Use
// these. A Space chooses its own in its ⋯ › Space settings…. Built with an injected `h`, `api` and model picker, so it
// runs on the fake DOM.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { routeFor } from "../lib/router.js";
import { onBus } from "../lib/bus.js";
import { createModelSelect } from "../composer/model.js";
import { locate, familyName, prettyModel } from "../lib/families.js";
import { ASK_CHOICES, askWords, modelAt } from "../lib/space-settings.js";
import { PAUSE_ALL_HOLDS } from "../lib/space-view.js";
import { fitEffort, modelRow } from "../space/model-row.js";
import { row, selectControl, switchControl } from "./rows.js";

/** Settings search's words for the page (search.js, HS-D68), checked against its code by a test. */
export const SEARCH_ROWS = Object.freeze([
  { label: "Model for Spaces", words: "space default model effort routines automated agents background" },
  { label: "When an app asks an agent", words: "app ask button run background chat summarize" },
  { label: "Pause all", words: "routines watches pause every space stop" },
  { label: "Spaces with their own", words: "override space model own settings" },
]);

/**
 * Settings › Space as the server answers it (`GET /spaces/settings`).
 * @typedef {{ settings: { model?: string, effort?: string, asks?: string }, problem?: string, pausedSince: number | null,
 *   spaces: { project: string, name: string, own: boolean, settings: { model?: string, effort?: string, asks?: string } }[] }} SpaceDefaults
 */

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void }} [cb]
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, modelSelect?: typeof createModelSelect, bus?: typeof onBus }} [io]
 */
export function renderSpaceSettings(body, cb = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const toast = cb.onToast || (() => {});
  const bus = io.bus || onBus;
  /** The models the picker lists, read once as the page opens: the composer's catalogue. */
  const cat = { models: /** @type {any[]} */ ([]), families: /** @type {any[]} */ ([]), accounts: /** @type {any[]} */ ([]) };
  const catalogue = { models: () => cat.models, families: () => cat.families, accounts: () => cat.accounts };
  /** A model's name as the picker says it. @param {string} id */
  const nameOf = (id) => {
    const at = locate(cat.families, id);
    return at ? familyName(at.family) : prettyModel(id);
  };
  /** @type {SpaceDefaults | null} */
  let st = null;
  let saving = false;
  let alive = true;

  /** A change to Settings › Space, said in a toast where refused; the page drawn from the answer. @param {Record<string, string>} patch */
  async function save(patch) {
    saving = true;
    try {
      const r = await call("/spaces/settings", { method: "PATCH", body: patch });
      if (st && r?.settings) st = { ...st, settings: r.settings, ...(r.problem ? { problem: r.problem } : { problem: undefined }) };
    } catch (/** @type {any} */ e) {
      toast(e?.body?.error || e?.message || String(e), "err");
    }
    saving = false;
    paint();
  }

  const modelHost = m("div", { class: "spset-model" });
  const runs = modelRow({
    named: "The model every Space's agents run on",
    catalogue,
    modelSelect: io.modelSelect || createModelSelect,
    blank: "None",
    defaultDesc: "None: each routine runs on its own model, and an app's ask asks for one",
    onPick: (name) => void save({ model: name, effort: fitEffort(catalogue, name, runs.effort() || st?.settings.effort || "") }),
    onDefault: () => void save({ model: "" }),
    effort: { onPick: (level) => void save({ effort: level }), named: "The effort every Space's agents run at" },
    alive: () => alive && body.isConnected !== false,
  });
  modelHost.append(runs.row);
  const asks = selectControl({ value: "ask", options: ASK_CHOICES.map((c) => ({ value: c.value, label: c.label })), label: "When an app asks an agent", onChange: (v) => void save({ asks: v }) });
  const pause = m("div", { class: "spset-pause" });
  const spacesEl = m("div", { class: "spset-spaces" });

  const modelRowEl = row(
    "Model for Spaces",
    "What every Space's agents run on where the Space chose none of its own: its routines' runs, an app's asks run in the background, a button's second look — and what chats started from a Space start on. A routine you chose a model for keeps it; one whose model cannot run now runs on this one instead, and says so.",
    modelHost,
    { h: m, wide: true },
  );
  const asksRow = row(
    "When an app asks an agent",
    "An app's button that asks an agent for something — a summary, a fix. Run it here works in the background, reading only, on the Space's model: a chat of the Space you can open, and a line in What happened when it is asked.",
    asks,
    { h: m },
  );
  body.replaceChildren(modelRowEl, asksRow, pause, spacesEl);

  function paint() {
    if (!st) return;
    const s = st.settings;
    runs.show(s.model || "", s.model ? (st.problem ? "" : "Every Space without its own runs on it") : "No model for Spaces: each routine runs on the model it was made with", s.effort || "");
    if (saving) runs.hold("Saving…");
    else runs.hold(null);
    asks.value = s.asks || "ask";
    const on = !!st.pausedSince;
    pause.replaceChildren(row(
      "Pause all",
      on ? `On since ${new Date(/** @type {number} */ (st.pausedSince)).toLocaleString()}: nothing in any Space starts by itself — ${PAUSE_ALL_HOLDS} — until you switch it off.` : `Nothing in any Space starts by itself while it is on — ${PAUSE_ALL_HOLDS}. A run under way goes on.`,
      switchControl({ checked: on, label: "Pause all", onChange: (next) => void pauseAll(next) }),
      { h: m },
    ));
    const own = st.spaces;
    spacesEl.replaceChildren(row(
      "Spaces with their own",
      own.length ? "These chose their own in their ⋯ › Space settings…: the rest use what is above." : "None: every Space uses what is above. A Space chooses its own in its ⋯ › Space settings….",
      own.length
        ? m("ul", { class: "spset-list" }, ...own.map((x) => m("li", { class: "spset-space", "data-project": x.project },
            m("a", { class: "inst-link spset-name", href: routeFor("space", { id: x.project }) }, x.name),
            m("span", { class: "spset-what" }, [x.settings.model ? modelAt(x.settings.model, x.settings.effort || "", nameOf) : "", x.settings.asks ? `an app's ask: ${askWords(x.settings.asks).replace(/^./, (c) => c.toLowerCase())}` : ""].filter(Boolean).join(" · ")),
            m("button", { class: "ghost sm spset-reset", type: "button", title: `${x.name} uses what is above again`, onclick: () => void useThese(x.project) }, "Use these"))))
        : m("span"),
      { h: m, wide: own.length > 0 },
    ));
  }

  /** Pause all switched, for every Space. @param {boolean} on */
  async function pauseAll(on) {
    try {
      const r = await call("/spaces/pause", { method: "POST", body: { on } });
      if (st) st = { ...st, pausedSince: r?.pausedSince ?? null };
    } catch (/** @type {any} */ e) {
      toast(e?.body?.error || e?.message || String(e), "err");
    }
    paint();
  }

  /** A Space's own choices taken away: it uses Settings › Space's again. @param {string} project */
  async function useThese(project) {
    try {
      await call(`/space/${encodeURIComponent(project)}/settings`, { method: "PATCH", body: { model: "", asks: "" } });
      await read();
    } catch (/** @type {any} */ e) {
      toast(e?.body?.error || e?.message || String(e), "err");
    }
  }

  /** The newest answer drawn, as its words: a read that says the same draws nothing again (an open picker stays open). */
  let drawn = "";
  async function read() {
    /** @type {SpaceDefaults} */
    let got;
    try {
      got = await call("/spaces/settings");
    } catch (/** @type {any} */ e) {
      // Read before: what was drawn stands — a server restarting is no reason to empty the page.
      if (!st) body.replaceChildren(m("p", { class: "set-desc" }, `Settings › Space could not be read: ${e?.body?.error || e?.message || e}`));
      return;
    }
    const key = JSON.stringify(got);
    st = got;
    if (key === drawn) return;
    drawn = key;
    paint();
  }
  // The models first where they come — the picker lists them —, the settings either way.
  void Promise.all([
    call("/models?all=1").then((c) => { cat.models = c?.models || c?.data || []; cat.families = c?.families || []; }, () => {}),
    call("/agent-accounts").then((r) => { cat.accounts = Array.isArray(r?.agents) ? r.agents : []; }, () => {}),
  ]).then(() => {
    // The catalogue came: the picker lists it, and the effort offers the levels of the model shown.
    runs.relist();
    return read();
  });
  // Pause all, Settings › Space or a Space's own moved elsewhere — a Space's page, an agent, another window —: read
  // again while the page is open, a burst once.
  /** @type {ReturnType<typeof setTimeout> | null} */
  let soon = null;
  const off = bus((msg) => {
    if (!body.isConnected) {
      alive = false;
      if (soon) clearTimeout(soon);
      off();
      return;
    }
    if (msg?.type !== "space" || saving || soon) return;
    soon = setTimeout(() => {
      soon = null;
      void read();
    }, 400);
  });
}
