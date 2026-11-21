// @ts-check
// A Space's dashboards (HarnessV4_Space_Plan S2 and S3, the mock "Space, grown" screens 5 to 10): which one the page
// shows — the Board, Routines or an app, each a row under its Space in the left bar since the owner's idea of 10-29, its
// address `#/space/<project>/<app>`; no tabs on the page —, a dashboard's page — its bar ("Live · read
// 40 s ago" with Refresh; a draft with Keep…; Paused with Resume), each source's failure with Fix with an agent… and Read
// again, its page in a frame, its foot with What it may do — and the Keep sheet, every line Filament's
// (lib/space-dashboards.js). Nothing runs on one press but Refresh and Read again, which read what was kept: Keep is the
// press that lets it run by itself (rule 1), Fix with an agent… and Change with an agent… fill the Start. A button
// pressed in its page opens Filament's sheet (space/action-sheet.js), where it runs.
import { h, morphChildren } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { confirmDialog, menu, sheet, toast } from "../lib/ui.js";
import { PRESS_GROUPS, agoWords, backOf, barOf, faultsOf, footOf, glanceMenuWords, hookWords, keepLines, readsNow } from "../lib/space-dashboards.js";
import { actionSheet } from "./action-sheet.js";
import { newAppSheet } from "./new-app.js";

/** The Board's tab, by its key: the Overview's as it was named before the reshape of 10-29, so a tab kept keeps it. */
export const OVERVIEW = "overview";
/** The Routines tab's key (S6): no dashboard's name, as a name has no "@". */
export const ROUTINES = "@routines";
/** The Watchers tab's key (the plan of 11-11, its w8), beside Routines': the watchers' own page. */
export const WATCHERS = "@watchers";
/** What Keep… does, on a page's bar and on its row in the overview's Runs by itself. */
export const KEEP_DOES = "Everything it will do, in Filament's words: nothing runs until you keep it";

/**
 * What the Space hands its dashboards. `write`: a write to the Space, its answer drawn, a refusal toasted (null);
 * `request`: the same, its refusal handed back to say in place; `frame`: a dashboard's page in a frame (`again`: its
 * newest loaded again; `version`: an older one, its live one beside a draft), a button pressed in it to `onAct`;
 * `handOff`: a result's Hand to an agent… (A4: a Space of your own asks where it runs), else `startWith`; `onTab`: the
 * tab shown changed; `go`: a tab the person picked (Put back), its address a move Back undoes, else `select`;
 * `catalogue`, `chatName` and `modelName`: a button's sheet's — the models a second look or a check may run on, a
 * chat's title, a model's name as the picker says it. `makes`: whether the project has no Space yet (by need, 11-12) —
 * the drafts its chats published show all the same, and keeping one makes it, which the Keep sheet says.
 * @typedef {{ el: HTMLElement, setTitle: (t: string) => void, again: () => void, version: (v: number) => void, repaint?: () => void }} DashboardFrame
 *   `repaint`: its failure's line drawn again, its Back to v4 as the Space now reads it
 * @typedef {{ app?: boolean, onStop?: () => void, back?: (heard: number | null) => { v: number, go: () => void } | null,
 *   ask?: (text: string) => void }} FrameMore
 *   an app's frame: its page is the agent's own, and may ask its running button stopped; `back`: the version before
 *   the one shown, which a broken page's line offers (Back to v4) — none while the Space's newest is older than the
 *   one the frame was told was published (`heard`); `ask`: what its page asks an agent goes this way (the Space page's,
 *   the owner's of 11-04) — a failure's Tell the agent still fills the Start
 * @typedef {{ project: () => { id: string, name: string, cwd: string } | null, own?: () => boolean, makes?: () => boolean,
 *   write: (method: string, path: string, body?: any) => Promise<any>,
 *   request: import("./action-sheet.js").Request,
 *   startWith: (cwd: string, words: string) => void, openArtifact: (name: string) => void,
 *   handOff?: (cwd: string, words: string) => void,
 *   frame: (name: string, title: string, onAct: (m: { action: string, key: string }) => void, more?: FrameMore) => DashboardFrame,
 *   go?: (tab: string) => void, onTab: (tab: string) => void, catalogue?: import("./action-sheet.js").Catalogue,
 *   chatName?: (chain: string) => string, modelName?: (id: string) => string }} DashboardsCtx
 */

/** @typedef {import("../lib/space-dashboards.js").SpaceDashboard} SpaceDashboard */

/** What one is, in a chat's words: a dashboard, or an app. @param {SpaceDashboard} d */
const kindOf = (d) => (d.type === "app" ? "app" : "dashboard");
/** The words Fix with an agent… starts with (screen 9). @param {SpaceDashboard} d @param {{ source: string, said: string }} f @param {string} project */
export const fixWords = (d, f, project) =>
  `The ${kindOf(d)} “${d.title}” (artifact ${d.name}) in ${project}'s Space couldn't read its source ${f.source}: ${f.said} Find out why, fix it, and publish its next version: `;
/** The words Change with an agent… starts with. @param {SpaceDashboard} d @param {string} project */
export const changeWords = (d, project) => `Change the ${kindOf(d)} “${d.title}” (artifact ${d.name}) in ${project}'s Space, and publish its next version: `;

/** @param {DashboardsCtx} ctx */
export function dashboardsPart(ctx) {
  /** @type {SpaceDashboard[]} */
  let list = [];
  let tab = OVERVIEW;
  /** Whether the tab shows its live version beside a newer draft (See v2), not the draft. */
  let seeLive = false;
  /** Whether the Space's dashboards were drawn yet, and the tab the address asked before they were: the first drawing
   *  shows it, or the Board where it is no longer there. */
  let painted = false;
  let want = "";
  /** The frame of the tab shown, by its dashboard, and what it read as it loaded. @type {{ name: string, reads: string, frame: DashboardFrame } | null} */
  let framed = null;
  /** The Routines tab: there once the Space has a routine not removed or a kept watch (S6, SG-D0); a dot where a run failed. */
  let routines = { shown: false, failed: false };
  /** The Watchers tab: there once the Space has a watcher not removed; a dot where a run of one failed. */
  let watchers = { shown: false, failed: false };
  /** A button's sheet opened while another ran on its dashboard: told once the Space says nothing runs there. */
  /** @type {{ name: string, sheet: ReturnType<typeof actionSheet> } | null} */
  let waitsOn = null;
  const bar = h("div", { class: "sdb-bar", role: "status" });
  const faults = h("div", { class: "sdb-faults" });
  const stage = h("div", { class: "sdb-stage" });
  const foot = h("div", { class: "sdb-foot" });
  const view = h("section", { class: "sdb-view", hidden: "", "aria-label": "Dashboard" }, bar, faults, stage, foot);

  const shown = () => list.find((d) => d.name === tab) || null;
  const path = (/** @type {SpaceDashboard} */ d) => `/dashboards/${encodeURIComponent(d.name)}`;
  const projectName = () => ctx.project()?.name || "this project";

  /** Whether a page besides the Board is there: Routines, Watchers, or a dashboard's by its name. @param {string} t */
  const there = (t) => (t === ROUTINES ? routines.shown : t === WATCHERS ? watchers.shown : list.some((d) => d.name === t));

  /** The page shown: the Board, Routines, Watchers or a dashboard's, the Board where that one is not there. @param {string} next */
  function select(next) {
    if (next !== tab) seeLive = false;
    tab = next === OVERVIEW || there(next) ? next : OVERVIEW;
    paintView();
    ctx.onTab(tab);
  }

  /**
   * ＋ New app (the Space Apps plan of 10-29): one box and the starters; its press copies a starter's folder into the
   * project and opens the Start with the words that make the app — a dashboard for Numbers. Nothing is sent.
   */
  function make() {
    const p = ctx.project();
    if (!p) return;
    newAppSheet({
      place: p.name,
      own: !!ctx.own?.(),
      starters: () => ctx.write("GET", "/starters").then((r) => r?.starters || []),
      make: (said, starter) => ctx.write("POST", "/new-app", { said, ...(starter ? { starter } : {}) }).then((r) => (r?.words ? r : null)),
      startWith: (words) => ctx.startWith(p.cwd, words),
    });
  }

  /**
   * The bar, the failures and the foot of the tab shown; its frame made once for it, and loaded again as what it may
   * read moves — kept, paused, resumed, a new live version —, since its page learns that as it loads.
   */
  function paintView() {
    const d = shown();
    view.hidden = !d;
    if (!d) {
      if (framed) stage.replaceChildren();
      framed = null;
      return;
    }
    // See v2 lasts while the newest is a draft beside a live version.
    if (!(d.draft && d.state === "kept" && d.liveV)) seeLive = false;
    const reads = `${d.state}|${d.draft}|${d.paused}|${d.liveV}|${seeLive}`;
    if (framed?.name !== d.name) {
      const name = d.name;
      /** @param {number | null} heard */
      const back = (heard) => {
        const now = list.find((x) => x.name === name);
        // A version published that the Space has not read yet: no way back offered until it has.
        const v = now && !(heard && now.v < heard) ? backOf(now, seeLive) : null;
        return now && v ? { v, go: () => void goBack(now, v) } : null;
      };
      framed = { name, reads, frame: ctx.frame(name, d.title, (m) => void press(name, m.action, m.key), { app: d.type === "app", onStop: () => void stopRun(name), back }) };
      stage.replaceChildren(framed.frame.el);
    } else {
      framed.frame.setTitle(d.title);
      if (framed.reads !== reads) {
        framed.reads = reads;
        if (seeLive && d.liveV) framed.frame.version(d.liveV);
        else framed.frame.again();
      } else framed.frame.repaint?.();
    }
    paintBar(d);
  }

  /**
   * Back to v4 (the Space Apps plan of 10-29): a version whose page broke, the one before it published again as the
   * newest — live at once where it reads, watches and runs what was kept, else a draft to keep. The broken one stays
   * among its versions. @param {SpaceDashboard} d @param {number} v
   */
  async function goBack(d, v) {
    try {
      await api(`/artifacts/${encodeURIComponent(d.name)}/newest`, { method: "POST", body: { v } });
      toast(`v${v} of ${d.title} is the newest again`);
    } catch (e) {
      toast(`v${v} could not be made the newest: ${String(/** @type {any} */ (e)?.message || e)}`, "err");
    }
  }

  /**
   * The bar, the failures and the foot, drawn in place, each button kept by its key: they are drawn at every move of
   * the Space, and a button made anew stood under a resting pointer (the owner's of 11-01: buttons blinking under a
   * resting pointer, clicks lost). @param {SpaceDashboard} d
   */
  function paintBar(d) {
    const now = Date.now();
    const b = barOf(d, now, seeLive);
    const moreWords = `More for this ${kindOf(d)}`;
    const more = h("button", { class: "ghost icon sdb-more", type: "button", "aria-label": moreWords, title: moreWords, "aria-haspopup": "menu", html: ICONS.ellipsis, "data-key": "more", onclick: (/** @type {Event} */ e) => moreMenu(d, /** @type {HTMLElement} */ (e.currentTarget)) });
    const press =
      b.press === "keep"
        ? h("button", { class: "sm sdb-keep", type: "button", "data-key": "keep", title: KEEP_DOES, onclick: () => keepSheet(d) }, "Keep…")
        : b.press === "resume"
          ? h("button", { class: "sm sdb-resume", type: "button", "data-key": "resume", onclick: () => void ctx.write("POST", `${path(d)}/pause`, { paused: false }) }, h("span", { class: "sp-btn-ic", html: ICONS.play }), "Resume")
          : b.press === "stop" && d.running
            ? h("button", { class: "sm sdb-stop", type: "button", "data-key": "stop", title: "Stop the button running: what it did before the stop stays done", onclick: () => void ctx.write("POST", `${path(d)}/actions/${encodeURIComponent(d.running?.action || "")}/stop`, {}) }, "Stop")
            : b.press === "none"
              ? null
              : h("button", { class: "ghost sm sdb-refresh", type: "button", "data-key": "refresh", title: "Read its sources now", onclick: () => void ctx.write("POST", `${path(d)}/read`, {}) }, h("span", { class: "sp-btn-ic", html: ICONS.refreshCw }), "Refresh");
    const see = b.see;
    const other = see ? h("button", { class: "ghost sm sdb-see", type: "button", "data-key": "see", title: see.tip, onclick: () => { seeLive = see.to === "live"; paintView(); } }, see.label) : null;
    bar.setAttribute("class", `sdb-bar is-${b.tone}`);
    morphChildren(bar, [h("span", { class: "sdb-bar-dot" }), h("span", { class: "sdb-bar-words" }, b.words), h("span", { class: "sb-sp" }), ...(other ? [other] : []), ...(press ? [press] : []), more]);
    // The failure's strip is the version shown's: over a draft, its tab and its bar say the live one fails, See v1 shows
    // it with its Read again (found by the Hunter on S2: nothing said it).
    const fs = readsNow(d) && (!d.draft || seeLive) ? faultsOf(d, now) : [];
    faults.hidden = !fs.length;
    morphChildren(faults, fs.map((f) => h("div", { class: "sdb-fault", role: "alert", "data-key": `fault:${f.source}` },
      h("b", { class: "sdb-fault-head" }, f.head),
      h("p", { class: "sdb-fault-said" }, f.said),
      h("p", { class: "sp-quiet sdb-fault-kept" }, f.kept),
      h("div", { class: "sdb-fault-acts" },
        h("button", { class: "sm primary", type: "button", title: "The Start with this failure, its source and the dashboard named: nothing runs until you send", onclick: () => fix(d, f) }, "Fix with an agent…"),
        h("button", { class: "sm", type: "button", title: `Run ${f.source} again now`, onclick: () => void ctx.write("POST", `${path(d)}/read`, { source: f.source }) }, "Read again")))));
    morphChildren(foot, [h("span", { class: "sp-quiet" }, footOf(d, now, seeLive)),
      ...(d.state === "kept" && d.grant ? [h("button", { class: "sdb-may", type: "button", onclick: () => keepSheet(d, true) }, "What it may do")] : [])]);
  }

  /**
   * A button pressed in a dashboard's page (S3): its sheet as Filament fills it from the row it read — or why not, in a
   * toast —, then the sheet, where it runs.
   * @param {string} name @param {string} action @param {string} key
   */
  async function press(name, action, key) {
    const d = list.find((x) => x.name === name);
    if (!d) return;
    const at = `${path(d)}/actions/${encodeURIComponent(action)}`;
    const r = await ctx.request("POST", at, { key });
    if (!r.ok) return void toast(r.error, "err");
    // A keeps button (10-29) changes the app's own data alone: it runs as it is pressed, with no sheet, how it ended in a toast.
    if (r.got?.effect === "keeps") {
      const ran = await ctx.request("POST", `${at}/run`, { key, ask: {} });
      const said = !ran.ok ? ran.error : ran.got?.done ? ran.got.said || "done" : ran.got?.outcome || ran.got?.error || "it ended";
      return void toast(`${r.got.label}: ${said}`, ran.ok && ran.got?.done ? "" : "err");
    }
    // Its result handed to an agent (S5d): the Start in the project's folder, the result in its box. A second look or a
    // check runs on the model the person sees and may change there, picked from the catalogue (the owner's word of 10-31).
    const sheet = actionSheet({ look: r.got, path: at, key, request: ctx.request, place: projectName(), handTo: (words) => { const p = ctx.project(); if (p) (ctx.handOff || ctx.startWith)(p.cwd, words); },
      ...(ctx.catalogue ? { catalogue: ctx.catalogue } : {}), ...(ctx.chatName ? { chatName: ctx.chatName } : {}), ...(ctx.modelName ? { modelName: ctx.modelName } : {}) });
    if (r.got?.running) waitsOn = { name, sheet };
  }

  /** Its running button stopped, asked from an app's page as Stop in its bar does. @param {string} name */
  function stopRun(name) {
    const d = list.find((x) => x.name === name);
    if (d?.running) return ctx.write("POST", `${path(d)}/actions/${encodeURIComponent(d.running.action)}/stop`, {});
  }

  /** @param {SpaceDashboard} d @param {{ source: string, said: string }} f */
  function fix(d, f) {
    const p = ctx.project();
    if (p) ctx.startWith(p.cwd, fixWords(d, f, p.name));
  }

  /**
   * The tab's ⋯: Pause or Resume, What it may do, Show on Your Space (S5b: its status tiles in At a glance, off until you
   * switch it on; there only where its live version has one), Change with an agent…, Open in Artifacts, Remove from this
   * Space — which a draft in a project with no Space yet is not in.
   * @param {SpaceDashboard} d @param {HTMLElement} anchor
   */
  function moreMenu(d, anchor) {
    const p = ctx.project();
    const kept = d.state === "kept";
    const statuses = Number(d.statuses) || 0;
    menu([
      ...(kept
        ? [
            d.paused
              ? { label: "Resume", icon: "play", desc: "Its reads and its watches go on", onClick: () => void ctx.write("POST", `${path(d)}/pause`, { paused: false }) }
              : { label: "Pause", icon: "pause", desc: "Nothing of it reads or runs until you resume it", onClick: () => void ctx.write("POST", `${path(d)}/pause`, { paused: true }) },
            { label: "What it may do", icon: "shieldCheck", desc: "What you kept, in Filament's words", onClick: () => keepSheet(d, true) },
            {
              type: "switch",
              label: "Show on Home",
              // Its glyph is Your Space's: the row lines up with the ones around it.
              icon: "house",
              checked: d.glance === true,
              disabled: !statuses && !d.glance,
              desc: glanceMenuWords(d, statuses),
              onClick: () => void ctx.write("POST", `${path(d)}/glance`, { on: !d.glance }),
            },
          ]
        : [{ label: "Keep…", icon: "shieldCheck", desc: "Everything it will do: nothing runs until you keep it", onClick: () => keepSheet(d) }]),
      // Its secrets (10-29): where its newest version or its Keep names any.
      ...(secretNames(d).length ? [{ label: "Secrets…", icon: "lock", desc: `Type what its commands get: ${secretNames(d).join(", ")}`, onClick: () => void secretsSheet(d) }] : []),
      { label: "Change with an agent…", icon: "messageCirclePlus", desc: "The Start here, the dashboard named", onClick: () => { if (p) ctx.startWith(p.cwd, changeWords(d, p.name)); } },
      { label: "Open in Artifacts", icon: "externalLink", desc: "Its versions, its download", onClick: () => ctx.openArtifact(d.name) },
      ...(ctx.makes?.() ? [] : [{ type: "separator" }, { label: "Remove from this Space", icon: "trash2", variant: "destructive", desc: "It stays in Artifacts; nothing of it runs", onClick: () => void remove(d) }]),
    ], { anchor, side: "bottom", align: "end", width: 280 });
  }

  /** Taken out of the Space, on the person's word: its way back is said. @param {SpaceDashboard} d */
  async function remove(d) {
    const ok = await confirmDialog({
      title: `Remove “${d.title}” from ${projectName()}'s Space?`,
      description: d.state === "kept"
        ? "Nothing of it reads or runs any more. It stays in Artifacts, and Add to this Space… puts it back as you kept it."
        : "It stays in Artifacts, and Add to this Space… puts it back; the next version a chat publishes shows it here again too.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    const got = await ctx.write("DELETE", path(d));
    if (got) select(OVERVIEW);
  }

  /**
   * A sends button's switch in What it may do (10-29): whether an agent may press it without asking you — off, it asks
   * whatever its chat's mode. What happened says each change.
   * @param {SpaceDashboard} d @param {{ name: string, label: string, allowed: boolean }} b
   */
  function allowSwitch(d, b) {
    const box = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", class: "sdb-allow-box", ...(b.allowed ? { checked: "" } : {}) }));
    box.onchange = async () => {
      box.disabled = true;
      const got = await ctx.write("POST", `${path(d)}/allow`, { action: b.name, on: box.checked });
      if (!got) box.checked = !box.checked;
      box.disabled = false;
    };
    return h("label", { class: "sdb-allow", title: "Off, an agent's press of it always asks you first, whatever its chat's mode" }, box, ` Agents may press “${b.label}” without asking you`);
  }

  /** The secrets its newest version or its Keep names (10-29). @param {SpaceDashboard} d */
  const secretNames = (d) => [...new Set([...(d.newest?.secrets || []), ...(d.grant?.secrets || [])])];

  /**
   * Its Secrets… sheet (the Space Apps plan of 10-29): each secret it names, with its builder's line on what it is for,
   * whether it is set and since when. A value typed here is sealed on this computer and never shown again — not here,
   * not to its page or an agent; Replace types a new one, Forget takes it away.
   * @param {SpaceDashboard} d
   */
  async function secretsSheet(d) {
    const title = `Secrets of “${d.title}”`;
    const list = h("div", { class: "sdb-secrets" }, h("p", { class: "sp-quiet" }, "Reading…"));
    /** @param {any[]} all */
    const paint = (all) => list.replaceChildren(...all.map(row));
    /** One secret: its name and state, its line, and where a value is typed. @param {{ name: string, about: string, set: boolean, at: number | null, handed: boolean }} x */
    const row = (x) => {
      const input = /** @type {HTMLInputElement} */ (h("input", { type: "password", class: "zc-input sdb-secret-in", autocomplete: "off", spellcheck: "false", placeholder: x.set ? "Type a new one to replace it" : "Type it here", "aria-label": x.name }));
      const err = h("div", { class: "sdb-secret-err hidden" });
      /** @param {Promise<{ ok: true, got: any } | { ok: false, error: string }>} p @param {string} done */
      const after = async (p, done) => {
        const r = await p;
        if (!r.ok) {
          err.textContent = r.error;
          err.classList.remove("hidden");
          return;
        }
        paint(r.got.secrets || []);
        toast(done);
      };
      const save = h("button", { class: "sm", type: "button", onclick: () => {
        if (!input.value.trim()) return void input.focus();
        void after(ctx.request("PUT", `${path(d)}/secrets/${encodeURIComponent(x.name)}`, { value: input.value }), `${x.name} is set`);
      } }, x.set ? "Replace" : "Save");
      input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); save.click(); } };
      return h("div", { class: "sdb-secret" },
        h("div", { class: "sdb-secret-head" }, h("code", { class: "sdb-cmd" }, x.name),
          h("span", { class: `sdb-secret-state${x.set ? " is-set" : ""}` }, x.set && x.at ? `set ${agoWords(x.at, Date.now())}` : x.set ? "set" : "not set")),
        x.about ? h("div", { class: "sp-quiet" }, x.about) : null,
        x.handed ? null : h("div", { class: "sp-quiet" }, "Its commands get it once you keep the version that names it."),
        h("div", { class: "sdb-secret-row" }, input, save,
          x.set ? h("button", { class: "ghost sm", type: "button", onclick: () => void after(ctx.request("DELETE", `${path(d)}/secrets/${encodeURIComponent(x.name)}`), `${x.name} is forgotten`) }, "Forget") : null),
        err);
    };
    /** @type {{ close: () => void } | null} */
    let s = null;
    const body = h("div", { class: "sdb-keep-body" }, list,
      h("p", { class: "sp-quiet sdb-keep-note" }, "Each is sealed on this computer and handed to its commands in their environment, by its name. Its page, its agents and What happened never see one: where a command says one, it shows hidden."));
    s = sheet({ label: title, class: "sdb-keep-sheet sdb-secrets-sheet", head: h("b", { class: "sp-sheet-title" }, title), body,
      foot: h("div", { class: "sdb-keep-foot" }, h("span", { class: "sb-sp" }), h("button", { class: "sm", type: "button", onclick: () => s?.close() }, "Close")) });
    const r = await ctx.request("GET", `${path(d)}/secrets`);
    if (!r.ok) list.replaceChildren(h("p", { class: "sdb-secret-err" }, r.error));
    else paint(r.got.secrets || []);
  }

  /**
   * The Keep sheet (screen 7): everything it will do, in Filament's words — or, read-only, what it may do now.
   * @param {SpaceDashboard} d @param {boolean} [readOnly]
   */
  function keepSheet(d, readOnly = false) {
    const p = ctx.project();
    const lines = keepLines(d, p?.cwd || "its project's folder", { kept: readOnly });
    const isNew = () => h("span", { class: "sdb-new" }, "new");
    /** Each tool line's word from its server, filled once it answers (S4a). @type {Map<string, HTMLElement[]>} */
    const checks = new Map();
    /** @param {{ connection: string, name: string }} t @param {boolean} reads */
    const checkOf = (t, reads) => {
      const el = h("div", { class: "sp-quiet sdb-tool-check" }, `Asking ${t.connection} what it is…`);
      const k = `${t.connection}|${t.name}|${reads}`;
      checks.set(k, [...(checks.get(k) || []), el]);
      return el;
    };
    /**
     * What it runs: a command and its folder, or a connection's tool — and what a source reads (more reads, 10-29): an
     * address from its host, a folder of the project, Filament's own rows, a script through uv.
     * @param {{ command: string, kind?: string, tool: { connection: string } | null, host?: string, filament?: string, folder: string }} x
     */
    const runs = (x) => {
      const code = h("code", { class: "sdb-cmd" }, x.command);
      const where = h("span", { class: "sdb-folder" }, x.folder);
      if (x.tool) return ["Calls ", code, " through ", h("b", {}, x.tool.connection)];
      if (x.kind === "fetch") return ["Fetches ", code, " from ", h("b", {}, x.host || "")];
      if (x.kind === "folder") return ["Lists ", code, ", read only, in ", where];
      if (x.kind === "filament") return ["Reads ", h("b", {}, x.filament || x.command), ", in Filament"];
      return [code, " in ", where];
    };
    /** Each hook's address in What it may do, filled once Filament answers (phase 4). @type {Map<string, HTMLElement>} */
    const addresses = new Map();
    /** @param {SpaceDashboard} _d @param {string} name */
    const hookAddress = (_d, name) => {
      const el = h("div", { class: "sdb-hook" }, h("span", { class: "sp-quiet" }, "Reading its address…"));
      addresses.set(name, el);
      return el;
    };
    /** @param {{ name: string, address?: string | null, records: number, at: number | null, paused?: boolean }[]} hooks */
    const fillHooks = (hooks) => {
      for (const [name, el] of addresses) {
        const x = hooks.find((y) => y.name === name);
        if (!x?.address) {
          el.replaceChildren(h("span", { class: "sp-quiet" }, "No address yet: it has one once you keep the version that names it."));
          continue;
        }
        const address = x.address;
        const copy = h("button", { class: "ghost sm", type: "button", onclick: () => {
          if (!navigator.clipboard?.writeText) return toast("This page cannot copy: select the address and copy it", "err");
          navigator.clipboard.writeText(address).then(() => toast("The address is copied"), () => toast("It was not copied: select the address and copy it", "err"));
        } }, "Copy");
        const renew = h("button", { class: "ghost sm", type: "button", onclick: async () => {
          const yes = await confirmDialog({ title: `A new address for ${name}?`, description: "The address you copied stops at once: what posts to it is refused until you give it the new one.", confirmLabel: "New address", destructive: true });
          if (!yes) return;
          const r = await ctx.request("POST", `${path(d)}/hooks/${encodeURIComponent(name)}/renew`);
          if (!r.ok) return void toast(r.error, "err");
          fillHooks(r.got.hooks || []);
          toast(`${name} has a new address`);
        } }, "New address");
        el.replaceChildren(h("div", { class: "sdb-hook-row" }, h("code", { class: "sdb-cmd sdb-hook-addr" }, address), copy, renew), h("div", { class: "sp-quiet" }, hookWords(x, Date.now())));
      }
    };
    const commands = lines.reads.some((r) => r.kind === "command" || r.kind === "python");
    const tooled = lines.reads.some((r) => r.tool);
    const fetched = lines.reads.some((r) => r.kind === "fetch");
    const body = h("div", { class: "sdb-keep-body" },
      h("p", { class: "sdb-keep-lead" }, readOnly
        ? "It runs without AI. This is everything it may do; a later version that adds to it asks you again."
        : "It runs without AI. This is everything it will do; a later version that adds to it asks you again."),
      // A draft a chat published in a project with no Space yet: its Keep is the press that makes it (by need, 11-12).
      ...(!readOnly && ctx.makes?.() ? [h("p", { class: "sp-quiet sdb-keep-note sdb-keep-makes" }, "Keeping it makes this project's Space: every chat in it can see and change it.")] : []),
      // An app that only takes POSTs reads nothing: no heading over nothing (found driving hooks).
      ...(lines.reads.length
        ? [h("h4", { class: "sdb-keep-h" }, "Reads by itself"),
            h("ul", { class: "sdb-keep-list" }, ...lines.reads.map((r) => h("li", { class: "sdb-keep-line" },
              h("div", {}, ...runs(r), ...(r.isNew ? [" ", isNew()] : [])),
              h("div", { class: "sp-quiet" }, `${r.source}: ${r.every}`),
              ...(r.headers?.length ? [h("div", { class: "sp-quiet" }, "sends ", ...r.headers.flatMap((x, i) => [i ? " · " : "", h("code", { class: "sdb-cmd" }, x)]))] : []),
              ...(r.tool ? [checkOf(r.tool, true)] : []))))]
        : []),
      ...(commands ? [h("p", { class: "sp-quiet sdb-keep-note" }, "A command or a script can't vouch that it only reads: you keep its exact text and the scripts it runs from here as they are now, and no other command runs for it. A script changed after waits until you keep it again.")] : []),
      ...(tooled ? [h("p", { class: "sp-quiet sdb-keep-note" }, "A connector's tool is read only where its server says it only reads, asked again at each read; it is called as the chats here call it.")] : []),
      ...(fetched ? [h("p", { class: "sp-quiet sdb-keep-note" }, "An address is only read (GET), on its host alone. A {secret.…} in it is filled by Filament with what you typed in Secrets…, never shown to the page or an agent.")] : []),
      ...(lines.tells.length
        ? [h("h4", { class: "sdb-keep-h" }, "Tells you"),
            h("ul", { class: "sdb-keep-list" }, ...lines.tells.map((t) => h("li", { class: "sdb-keep-line" },
              h("div", {}, t.rule, " → ", h("b", {}, t.to), ...(t.isNew ? [" ", isNew()] : [])),
              h("div", { class: "sp-quiet" }, `${t.says ? `writes “${t.says}” · ` : ""}${t.every}`))))]
        : []),
      // Its buttons, by what they do (10-29): what keeps the app's own data runs as you press it; what writes on this
      // machine or sends off it opens Filament's sheet first — and an agent's press of what sends asks you, unless you
      // let agents press it (What it may do).
      ...PRESS_GROUPS.flatMap((g) => {
        const bs = lines.presses.filter((b) => b.effect === g.effect);
        return bs.length
          ? [h("h4", { class: "sdb-keep-h" }, g.head),
              h("ul", { class: "sdb-keep-list" }, ...bs.map((b) => h("li", { class: "sdb-keep-line" },
                h("div", {}, h("b", {}, b.label), ...(b.isNew ? [" ", isNew()] : [])),
                h("div", {}, ...runs(b)),
                h("div", { class: "sp-quiet" }, [b.rows, ...b.asks, ...b.checks, ...(b.second ? [b.second] : [])].join(" · ")),
                ...(b.tool ? [checkOf(b.tool, false)] : []),
                ...(g.effect === "sends" && readOnly ? [allowSwitch(d, b)] : [])))),
              h("p", { class: "sp-quiet sdb-keep-note" }, `${g.note}${g.effect !== "keeps" && bs.some((b) => !b.tool) ? " A row's value in a command may not start with “-”." : ""}`)]
          : [];
      }),
      // The tools it offers this Space's agents (the owner's of 11-05): each command exactly, what an agent fills it
      // with, and what it does — one that reads runs as an agent calls it, one that writes is judged by its chat's mode,
      // one that sends always asks you.
      ...(lines.tools.length
        ? [h("h4", { class: "sdb-keep-h" }, "Offers this Space's agents"),
            h("ul", { class: "sdb-keep-list" }, ...lines.tools.map((t) => h("li", { class: "sdb-keep-line" },
              h("div", {}, h("b", {}, t.name), ` · ${t.effect}`, ...(t.isNew ? [" ", isNew()] : [])),
              h("div", {}, h("code", { class: "sdb-cmd" }, t.command), ` in ${t.folder}`),
              h("div", { class: "sp-quiet" }, [t.about, ...t.args].filter(Boolean).join(" · "))))),
            h("p", { class: "sp-quiet sdb-keep-note" }, "An agent of this Space lists these only when it needs one, and fills each {args.…} — never a shell, a value never starting with “-”. One that reads runs as it calls it, in any mode; one that writes is judged by its chat's mode, as a command; one that sends always asks you.")]
        : []),
      // Its secrets (10-29): their names alone — you type each in Secrets…, and neither its page nor an agent sees one.
      ...(lines.secrets.length
        ? [h("h4", { class: "sdb-keep-h" }, "Gets your secrets"),
            h("ul", { class: "sdb-keep-list" }, ...lines.secrets.map((x) => h("li", { class: "sdb-keep-line" }, h("code", { class: "sdb-cmd" }, x.name), ...(x.isNew ? [" ", isNew()] : [])))),
            h("p", { class: "sp-quiet sdb-keep-note" }, `Its commands get each one in their environment, by its name${fetched ? ", and an address fills it where it says {secret.…}" : ""}, once you type it in Secrets… (the ⋯ beside its bar). Sealed on this computer; its page, its agents and What happened never see one.`)]
        : []),
      // Its hooks (phase 4): each a collection a POST from this computer lands in; What it may do gives each address.
      ...(lines.hooks.length
        ? [h("h4", { class: "sdb-keep-h" }, "Takes POSTs"),
            h("ul", { class: "sdb-keep-list" }, ...lines.hooks.map((x) => h("li", { class: "sdb-keep-line" },
              h("div", {}, "Into ", h("code", { class: "sdb-cmd" }, x.name), ...(x.isNew ? [" ", isNew()] : [])),
              x.about ? h("div", { class: "sp-quiet" }, x.about) : null,
              ...(readOnly ? [hookAddress(d, x.name)] : [])))),
            h("p", { class: "sp-quiet sdb-keep-note" }, readOnly
              ? "Copy an address into what sends there. A POST from this computer alone — never a web page — is one record its page reads; nothing runs for it. New address stops the old one."
              : "Each gets an address of its own, which What it may do gives you to copy into what sends there. A POST from this computer alone — never a web page — is one record its page reads; nothing runs for it.")]
        : []),
      ...(lines.gone.length ? [h("h4", { class: "sdb-keep-h" }, "No longer"), h("ul", { class: "sdb-keep-list" }, ...lines.gone.map((g) => h("li", { class: "sdb-keep-line sp-quiet" }, g)))] : []),
      // The scripts its commands run that changed since it was kept — or of which an earlier Filament, which kept it,
      // kept no record —: held until a Keep takes each as it is now.
      ...(lines.changed.length
        ? [h("h4", { class: "sdb-keep-h" }, lines.unrecorded ? "No record from when you kept it" : "Changed since you kept it"),
            h("ul", { class: "sdb-keep-list" }, ...lines.changed.map((x) => h("li", { class: "sdb-keep-line" }, h("code", { class: "sdb-cmd" }, x)))),
            h("p", { class: "sp-quiet sdb-keep-note" }, `${lines.unrecorded ? "An earlier Filament kept it, and kept no record of the scripts it runs. " : ""}${readOnly
              ? "Nothing runs these until you keep it again: Keep… beside its bar shows them and keeps each as it is now."
              : "Keep runs each as it is now; until then nothing runs it, with its secrets or without."}`)]
        : []),
      h("h4", { class: "sdb-keep-h" }, "Shows"),
      // A Space's apps and dashboards are rows under it in the left bar, each its own page (10-29): no tab any more.
      h("ul", { class: "sdb-keep-list" }, h("li", { class: "sdb-keep-line" }, `On its own page, a row under ${projectName()}'s Space in the left bar`),
        // An app's glance (phase 3): Home's At a glance, once switched on.
        ...(d.type === "app" && d.reads?.glance?.length ? [h("li", { class: "sdb-keep-line" }, `On Home's At a glance once you switch on Show on Home (the ⋯ beside its bar): ${d.reads.glance.join(", ")}`)] : []),
        // S4c: what it feeds into the Space, from rows it reads anyway.
        ...lines.shows.map((x) => h("li", { class: "sdb-keep-line sdb-keep-fed" }, h("div", {}, x.words), h("div", { class: "sp-quiet" }, x.more)))));
    const title = readOnly ? `What “${d.title}” may do` : `Keep “${d.title}” in ${projectName()}'s Space?`;
    /** @type {{ close: () => void } | null} */
    let s = null;
    const footEl = readOnly
      ? h("div", { class: "sdb-keep-foot" }, h("span", { class: "sp-quiet" }, "Pause or remove it from the ⋯ beside its bar."), h("span", { class: "sb-sp" }),
          h("button", { class: "sm", type: "button", onclick: () => s?.close() }, "Close"))
      : h("div", { class: "sdb-keep-foot" }, h("span", { class: "sp-quiet" }, "Pause, change or remove it from the ⋯ beside its bar."), h("span", { class: "sb-sp" }),
          h("button", { class: "ghost sm", type: "button", onclick: () => s?.close() }, "Not now"),
          h("button", { class: "sm primary sdb-keep-go", type: "button", onclick: async () => {
            const got = await ctx.write("POST", `${path(d)}/keep`, { v: d.v });
            if (got) s?.close();
          } }, "Keep"));
    s = sheet({ label: title, class: "sdb-keep-sheet", head: h("b", { class: "sp-sheet-title" }, title), body, foot: footEl });
    // Its hooks' addresses (phase 4), asked of Filament as the sheet opens: the person's alone.
    if (addresses.size)
      void ctx.request("GET", `${path(d)}/hooks`).then((r) => {
        if (r.ok) fillHooks(r.got.hooks || []);
        else for (const el of addresses.values()) el.replaceChildren(h("span", { class: "sdb-secret-err" }, r.error));
      });
    // Each tool's server asked what it is (S4a): nothing is called.
    if (checks.size)
      // What it may do asks of the tools its kept grant names; Keep… of the newest version's.
      void ctx.request("GET", `${path(d)}/tools${readOnly ? "?kept=1" : ""}`).then((r) => {
        for (const els of checks.values()) for (const el of els) el.textContent = r.ok ? "" : `Its servers could not be asked: ${r.error}`;
        if (!r.ok) return;
        for (const t of Array.isArray(r.got?.tools) ? r.got.tools : [])
          for (const el of checks.get(`${t.connection}|${t.name}|${t.reads}`) || []) {
            el.textContent = String(t.words || "");
            el.classList.toggle("is-bad", !t.ok);
          }
      });
  }

  return {
    view,
    /** The tab shown. */
    selected: () => tab,
    select,
    /** The tab the address names: shown now, or as the Space is first read. @param {string} t */
    show(t) {
      if (!painted) want = t;
      else if (t !== tab) select(t);
    },
    /** The name of the page shown, the Board's none: the crumb's last word. */
    title: () => (tab === ROUTINES ? "Routines" : tab === WATCHERS ? "Watchers" : shown()?.title || ""),
    /** What the Space shows besides its Board, in the left bar's order: Routines, Watchers, then each dashboard and app. */
    tabs: () => [...(routines.shown ? [{ key: ROUTINES, label: "Routines" }] : []), ...(watchers.shown ? [{ key: WATCHERS, label: "Watchers" }] : []), ...list.map((d) => ({ key: d.name, label: d.title }))],
    /**
     * The dashboards as the Space now says them, and whether its Routines and its Watchers are there.
     * @param {SpaceDashboard[]} next @param {{ routines?: { shown: boolean, failed: boolean }, watchers?: { shown: boolean, failed: boolean } }} [o]
     */
    paint(next, o = {}) {
      list = Array.isArray(next) ? next : [];
      if (o.routines) routines = o.routines;
      if (o.watchers) watchers = o.watchers;
      // The run a sheet waits on has ended: its Run may run.
      const waited = waitsOn;
      if (waited && !list.find((d) => d.name === waited.name)?.running) {
        waitsOn = null;
        waited.sheet.ended();
      }
      const was = !painted ? want : "";
      painted = true;
      // The address's tab, or the Board where it is gone: either way the address is said again.
      if (was && was !== tab) return select(was);
      if (tab !== OVERVIEW && !there(tab)) return select(OVERVIEW);
      paintView();
    },
    /**
     * Add to this Space…'s lines for the dashboards taken out, each its way back: a kept one as it was kept, a draft as a
     * draft; put back, its tab is shown.
     * @param {{ name: string, title: string, keptV: number | null }[]} gone
     */
    backItems(gone) {
      return gone.map((g) => ({
        label: `Put back “${g.title}”`,
        icon: "rotateCcw",
        desc: g.keptV ? `As you kept it: v${g.keptV}, reading by itself again` : "As a draft: nothing reads until you keep it",
        onClick: () => void ctx.write("POST", `/dashboards/${encodeURIComponent(g.name)}/back`).then((got) => (got ? (ctx.go || select)(g.name) : undefined)),
      }));
    },
    /** The bar's ages, as the clock moves: its words alone where its state is the same, so a focused button keeps focus. */
    tick() {
      const d = shown();
      if (!d || view.hidden) return;
      const b = barOf(d, Date.now(), seeLive);
      const words = bar.querySelector(".sdb-bar-words");
      if (words && bar.classList.contains(`is-${b.tone}`)) words.textContent = b.words;
      else paintBar(d);
    },
    /**
     * A tab's Keep sheet, opened from elsewhere. `v`: the version an ask asked to keep (E42 case 20): the sheet is pinned
     * to it — a newer one came, its tab shows it instead, and the ask goes by itself at the next read.
     * @param {string} name @param {number} [v]
     */
    keep(name, v) {
      const d = list.find((x) => x.name === name);
      if (!d) return;
      if (v !== undefined && d.v !== v) return select(name);
      keepSheet(d);
    },
    /** A dashboard's button pressed on a row from elsewhere — a card it put on the board (S4c): Filament's sheet, as in its tab. */
    press,
    make,
  };
}
