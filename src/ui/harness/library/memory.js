// @ts-check
// Library › Memory (HarnessV3-Memory M6-5; proposal_ux §4.15, phase 7): what memory knows, where, how sure it is — and
// the owner's word on it. What memory does in new chats, the models it learns and curates with, its door for other
// agents and its engine stay in Settings › Memory (settings/memory.js), which links here. Left, where claims live:
// "Everywhere" (the claims that hold in every workspace) and each workspace, with how many stand there; the page
// opens on the one its address names — a chat's memory widget names the chat's folder — else on the workspace that
// holds the most. Right, the one picked, four ways:
// - Memories, the claim browser: standing, to review (flagged, held back or no longer sure) or retired, by kind; each
//   claim with how it is known, how sure memory is, its flags and its trigger; Confirm, Correct, Retire or Restore, and
//   its history;
// - Dossier: the curator's page on the workspace, by section, each line with the claims it rests on, which is where it
//   is edited (M6-D3); and Rewrite now;
// - Add, on both: a claim remembered as the owner's word, in the workspace picked or everywhere;
// - Questions: what memory asks before it changes the user's own word, answered in place;
// - Models: how each model's finished work went there (M7-D53), a record the owner reads and nothing routes by.
// It reads and writes through the memory routes as the owner, scoped to the open session (M6-D2). What memory changes
// meanwhile, anywhere, it hears on the events fan-out and reads again where it shows, and nowhere else (M7-D37). Each
// part read again is drawn in place (dom.js `morphChildren`), its scopes, chips, cards and buttons keyed by what they
// are and the search field kept as itself, so the one under a resting pointer is the element that stood: its hover
// holds and a press on it lands (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost). Built
// with an injected `h`, `api`, bus and `drawIn`, so it runs on the fake DOM.
import { h, morphChildren, standing } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { onBus } from "../lib/bus.js";
import { ICONS } from "../lib/icons.js";
import { MEMORY_KINDS } from "../widgets/memory.js";
import {
  MEMORY_STATES, MEMORY_FILTERS, SURE_LINE, isRetired as retired, plural, itemPath, claimsPath, mayConfirm, questionWords, questionAnswers,
  triggerParts, eventWords, shortWhen as when, followClaims, claimsTouched, firstScope,
} from "../../lib/claims.js";
import { OUTCOME_WINDOWS, OUTCOME_FILTERS, OUTCOMES_NOTE, outcomesPath, outcomeWords, endedParts, noOutcomesWords } from "../../lib/outcomes.js";
import { segment } from "../lib/fields.js";
import { addsToSkill, openAddToSkill } from "./skill-add.js";

const VIEWS = Object.freeze([
  { value: "memories", label: "Memories" },
  { value: "dossier", label: "Dossier" },
  { value: "questions", label: "Questions" },
  { value: "models", label: "Models" },
]);
/** Each kind of work on its tile: a harness turn, a sub-agent's run. */
const WORK_TILES = /** @type {Record<string, { icon: string, color: string }>} */ (Object.freeze({
  turn: { icon: "messageSquare", color: "var(--color-sys-cyan)" },
  subagent: { icon: "bot", color: "var(--color-sys-indigo)" },
}));
/** What the owner can add, as they would say it (a pitfall and a thread come from the work, not from a form). */
const ADD_KINDS = Object.freeze([
  { value: "rule", label: "Rule" },
  { value: "preference", label: "Preference" },
  { value: "decision", label: "Decision" },
  { value: "fact", label: "Fact" },
  { value: "procedure", label: "How to" },
]);
/** A folder as two of them are compared: one slash, no trailing one, one case. @param {unknown} p */
const folderKey = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
/**
 * The workspace the page opens on: the one an address names — by its key, or by its folder (a chat's) — or
 * "everywhere"; else, or where none matches, the one that holds the most (`firstScope`).
 * @param {any[]} scopes @param {string | null | undefined} want
 * @returns {string | null}
 */
export function scopeFor(scopes, want) {
  if (want === "everywhere") return null;
  const named = want ? scopes.find((s) => s.project !== null && (s.project === want || (s.cwd && folderKey(s.cwd) === folderKey(want)))) : null;
  return named ? named.project : firstScope(scopes);
}
/** @param {string} kind */
const kindOf = (kind) => /** @type {Record<string, { icon: string, color: string, word: string }>} */ (MEMORY_KINDS)[kind] || { icon: "brain", color: "var(--color-sys-gray)", word: "Memory" };

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void, getChain?: () => string | undefined, scope?: string | null }} [cb]
 *   `scope`: the workspace the page opens on, by its key or folder, or "everywhere" (`scopeFor`)
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, debounceMs?: number, bus?: typeof onBus, followMs?: number,
 *   dialog?: typeof import("../lib/ui.js").dialog, drawIn?: (host: any, nodes: any[]) => void }} [io]  `dialog`: Add to
 *   skill…'s; `drawIn`: how a draw goes into a part of the page — in place (dom.js `morphChildren`, the page's), or a
 *   fake DOM's own
 */
export function renderMemoryBrowser(body, cb = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const drawIn = io.drawIn || morphChildren;
  const debounceMs = io.debounceMs ?? 180;
  const toast = cb.onToast || (() => {});
  const session = () => cb.getChain?.() || null;

  /** The page's state: where, which view and filters, what was read, and the owner's work in progress. */
  const st = {
    /** @type {any[]} */ scopes: [],
    /** @type {string | null} */ scope: null,
    view: "memories",
    state: "standing",
    kind: "",
    q: "",
    /** @type {any} */ claims: null,
    /** @type {any} */ dossier: null,
    /** How models did here (M7-D53): the window and the kind of work picked, and what the route said. */
    days: "30",
    work: "",
    /** @type {any} */ outcomes: null,
    /** @type {any[] | null} */ questions: null,
    error: "",
    /** @type {string | null} */ editing: null,
    draft: "",
    /** A claim being added: its kind and words (kept through a refusal, to fix; a new one starts as a rule). */
    adding: false,
    addKind: "rule",
    addText: "",
    /** The histories open, by claim id: its events, or null while it is read. @type {Map<string, any[] | null>} */
    open: new Map(),
    busy: false,
    seq: 0,
    /** The questions' reads, as `seq` is the view's: one overtaken by a newer (another scope picked) is dropped. */
    askSeq: 0,
    /** A change came while the owner wrote here: what it touched is read once they are done (`freed`). */
    owed: false,
  };

  // ---- the parts that stay: the search field keeps its focus while the list under it is read again ----
  /** @type {ReturnType<typeof setTimeout> | null} */
  let typing = null;
  const search = /** @type {HTMLInputElement} */ (m("input", {
    class: "zc-input mset-search",
    type: "search",
    placeholder: "Search memories, or an id",
    "aria-label": "Search memories",
    spellcheck: "false",
    oninput: (/** @type {Event} */ e) => {
      st.q = String(/** @type {HTMLInputElement} */ (e.target).value || "");
      if (typing) clearTimeout(typing);
      if (debounceMs > 0) typing = setTimeout(() => void load(), debounceMs);
      else void load();
    },
  }));
  const scopesEl = m("nav", { class: "mset-scopes", "aria-label": "Where memories live" });
  const headEl = m("div", { class: "mset-head" });
  const toolsEl = m("div", { class: "mset-tools" });
  /** The memories' tools row, built once: the field stays in it as the controls beside it are drawn again. */
  const toolsRow = m("div", { class: "mset-tools-row", "data-key": "tools" });
  const listEl = m("div", { class: "mset-list", "aria-live": "polite" });

  /** A segmented control. @param {readonly { value: string, label: string }[]} options @param {string} value @param {(v: string) => void} onChange @param {string} label */
  const seg = (options, value, onChange, label) => segment(m, options, value, onChange, label);
  /** An icon button, its name its action. @param {string} glyph @param {string} title @param {() => void} onClick @param {string} [cls] */
  const actBtn = (glyph, title, onClick, cls = "") =>
    m("button", {
      class: `mset-act${cls ? ` ${cls}` : ""}`,
      type: "button",
      "data-key": glyph,
      title,
      "aria-label": title,
      ...(st.busy ? { disabled: "" } : {}),
      html: /** @type {Record<string, string>} */ (ICONS)[glyph],
      onclick: (/** @type {Event} */ e) => {
        e.stopPropagation?.();
        if (!st.busy) onClick();
      },
    });
  const scopeOf = () => st.scopes.find((s) => s.project === st.scope) || null;

  // ---- writes: the owner's word, through the routes; a refusal is said in a toast ----
  /**
   * @param {string} path @param {any} payload @param {{ done?: (r: any) => string | null }} [o]  `done`: what the toast says after
   */
  async function word(path, payload, o = {}) {
    st.busy = true;
    paintList();
    try {
      const r = await call(path, { method: "POST", body: { ...payload, ...(session() ? { session: session() } : {}) } });
      if (r && r.ok === false) toast(r.error || "memory refused it", "err");
      else {
        const said = o.done?.(r);
        if (said) toast(said);
      }
    } catch (/** @type {any} */ e) {
      toast(e?.body?.error || e?.message || String(e), "err");
    } finally {
      st.busy = false;
      st.editing = null;
      st.draft = "";
    }
    await reread();
  }
  const confirm = (/** @type {any} */ c) => word(itemPath(c.id), { status: "confirmed" });
  const restore = (/** @type {any} */ c) => word(itemPath(c.id), { status: "confirmed" }, { done: () => `${c.id} stands again` });
  const retire = (/** @type {any} */ c) => word("/memory/forget", { id: c.id, reason: "retired in the Library" }, { done: () => `${c.id} retired: kept as history` });
  const fresh = (/** @type {any} */ c) => !!st.draft.trim() && st.draft.trim() !== String(c.text).trim();
  const correct = (/** @type {any} */ c) => {
    if (st.busy || !fresh(c)) return;
    void word(`${itemPath(c.id)}/correct`, { text: st.draft.trim(), reason: "corrected in Settings" }, { done: (r) => (r?.id ? `${r.id} replaces ${c.id}` : null) });
  };
  /** @param {any} q @param {"accept" | "reject"} answer */
  const answer = (q, answer) => word(`/memory/inbox/${encodeURIComponent(q.id)}`, { answer });
  /** The owner's word, remembered where the page stands (M6-D3): it closes once memory has it. */
  const add = () => {
    const text = st.addText.trim();
    if (st.busy || !text) return;
    void word("/memory/remember", { text, kind: st.addKind, ...(st.scope ? { project: st.scope } : {}) }, {
      done: (r) => {
        st.adding = false;
        st.addKind = "rule";
        st.addText = "";
        return r?.retired ? String(r.note || `${r.id} is on file, retired`) : r?.id ? `${r.id} remembered: it counts as your word` : null;
      },
    });
  };
  async function rewrite() {
    st.busy = true;
    paintList();
    try {
      const r = await call("/memory/curator/run", { method: "POST", body: { project: st.scope } });
      if (r?.skipped) toast(`The curator did not run: ${r.skipped}`, "err");
      else if (r?.error) toast(`The curator's pass ${r.run} stopped: ${r.error}`, "err");
      else toast(`The curator's pass ${r?.run || ""}: ${plural(Number(r?.actions) || 0, "change")}, ${plural(Number(r?.questions) || 0, "question")}`);
    } catch (/** @type {any} */ e) {
      toast(e?.body?.error || e?.message || String(e), "err");
    } finally {
      st.busy = false;
    }
    await reread();
  }
  // ---- reads ----
  /**
   * Where claims live, read again. The workspace picked being gone (deleted elsewhere), the one the page opens on is
   * picked instead, once the owner's hands are free (M7-D37).
   */
  async function loadScopes() {
    try {
      st.scopes = (await call("/memory/claims/scopes")).scopes || [];
    } catch (/** @type {any} */ e) {
      st.error = e?.body?.error || e?.message || String(e);
      return paintScopes();
    }
    paintScopes();
    if (st.scope === null || st.scopes.some((s) => s.project === st.scope)) return;
    if (handsBusy()) return void (st.owed = true);
    pick(firstScope(st.scopes));
  }
  /** The scope's questions, read again; a read overtaken by a newer one is dropped. */
  async function loadQuestions() {
    const mine = ++st.askSeq;
    /** @type {any[] | null} */
    let questions = null;
    try {
      questions = (await call(`/memory/inbox${st.scope ? `?project=${encodeURIComponent(st.scope)}` : ""}`)).questions || [];
    } catch {}
    if (mine !== st.askSeq) return;
    st.questions = questions;
    paintHead();
    if (st.view === "questions") paintList();
  }
  /** The open view, read again; a read overtaken by a newer one is dropped. */
  async function load() {
    const mine = ++st.seq;
    st.error = "";
    try {
      if (st.view === "memories") {
        const r = await call(claimsPath({ project: st.scope, state: st.state, kind: st.kind, q: st.q }));
        if (mine === st.seq) st.claims = r;
      } else if (st.view === "dossier" && st.scope) {
        const r = await call(`/memory/dossier?project=${encodeURIComponent(st.scope)}`);
        if (mine === st.seq) st.dossier = r;
      } else if (st.view === "models") {
        const r = await call(outcomesPath({ project: st.scope, days: st.days, kind: st.work }));
        if (mine === st.seq) st.outcomes = r;
      }
    } catch (/** @type {any} */ e) {
      if (mine === st.seq) st.error = e?.body?.error || e?.message || String(e);
    }
    if (mine !== st.seq) return;
    paintTools();
    paintList();
  }
  /**
   * Another scope picked: its view read; the search and the open claims were the last one's. A claim being added stays,
   * to be remembered here instead. @param {string | null} project
   */
  function pick(project) {
    st.scope = project;
    if (project === null && st.view === "dossier") st.view = "memories";
    st.q = "";
    search.value = "";
    st.editing = null;
    st.open.clear();
    st.claims = null;
    st.dossier = null;
    st.outcomes = null;
    paintScopes();
    paintHead();
    void loadQuestions();
    void load();
  }
  /** Show one claim: the standing ones, searched by its id. @param {string} id */
  function find(id) {
    st.view = "memories";
    st.state = "standing";
    st.kind = "";
    st.q = id;
    search.value = id;
    paintHead();
    void load();
  }
  /** @param {string} id */
  async function toggleHistory(id) {
    if (st.open.has(id)) {
      st.open.delete(id);
      return paintList();
    }
    st.open.set(id, null);
    paintList();
    const why = await readHistory(id);
    if (why) toast(why, "err");
  }
  /**
   * A claim's history, read into the open ones (shown as it was until the new one lands); one that cannot be read closes,
   * with why. @param {string} id @returns {Promise<string | null>}
   */
  async function readHistory(id) {
    /** @type {string | null} */
    let why = null;
    try {
      const r = await call(`${itemPath(id)}/history`);
      if (st.open.has(id)) st.open.set(id, r.events || []);
    } catch (/** @type {any} */ e) {
      st.open.delete(id);
      why = e?.body?.error || e?.message || String(e);
    }
    paintList();
    return why;
  }
  /** Everything the page shows, read again: after the owner's word, and when a change could not be followed. */
  async function reread() {
    st.owed = false;
    await Promise.all([loadScopes(), loadQuestions(), load(), ...[...st.open.keys()].map((id) => readHistory(id))]);
  }
  /** The owner writes here (a correction, a claim added): a read now would put a fresh list in place of their words. */
  const handsBusy = () => st.editing != null || st.adding;
  /** Their hands free again: what changed meanwhile is read now. */
  const freed = () => {
    if (st.owed && !handsBusy()) void reread();
  };

  // ---- painting ----
  function paintScopes() {
    const everywhere = st.scopes.find((s) => s.project === null);
    const projects = st.scopes.filter((s) => s.project !== null && (!s.archived || s.claims));
    /** @param {any} s @param {string} glyph */
    const scopeBtn = (s, glyph) =>
      m("button", {
        class: `mset-scope${s.project === st.scope ? " on" : ""}${s.archived ? " is-archived" : ""}`,
        type: "button",
        "data-key": s.project === null ? "everywhere" : `scope:${s.project}`,
        title: s.cwd || "Claims that hold in every project",
        "aria-current": s.project === st.scope ? "true" : "false",
        onclick: () => pick(s.project),
      },
        m("span", { class: "mset-scope-ic", html: /** @type {Record<string, string>} */ (ICONS)[glyph], "aria-hidden": "true" }),
        m("span", { class: "mset-scope-name" }, String(s.name)),
        m("span", { class: "mset-count" }, String(s.claims ?? 0)));
    drawIn(scopesEl, [
      ...(everywhere ? [scopeBtn(everywhere, "globe")] : []),
      m("div", { class: "mset-scopes-head", "data-key": "head" }, "Projects"),
      ...(projects.length ? projects.map((s) => scopeBtn(s, "folder")) : [m("p", { class: "mset-quiet", "data-key": "none" }, "None yet: a project is a folder you work in.")]),
    ]);
  }

  function paintHead() {
    const s = scopeOf();
    const asks = st.questions?.length || 0;
    const views = VIEWS.filter((v) => v.value !== "dossier" || st.scope !== null).map((v) => (v.value === "questions" && asks ? { ...v, label: `Questions ${asks}` } : v));
    drawIn(headEl, [
      m("div", { class: "mset-title", "data-key": "title" },
        m("div", { class: "mset-name" }, s ? String(s.name) : ""),
        m("div", { class: "mset-sub" }, st.scope === null ? "Claims that hold in every project" :String(s?.cwd || ""))),
      seg(views, st.view, (v) => {
        st.view = v;
        paintHead();
        paintTools();
        paintList();
        void load();
      }, "View"),
    ]);
  }

  function paintTools() {
    const addBtn = m("button", { class: "sm", type: "button", "data-key": "add", ...(st.adding ? { disabled: "" } : {}), onclick: () => { st.adding = true; paintTools(); paintList(); } }, "Add");
    if (st.view === "memories") {
      const c = st.claims?.counts;
      /** @param {string} value @param {string} label @param {number | undefined} n */
      const chip = (value, label, n) =>
        m("button", { class: `mset-chip${st.kind === value ? " on" : ""}`, type: "button", "data-key": `kind:${value}`, "aria-pressed": st.kind === value ? "true" : "false", onclick: () => { st.kind = value; void load(); } },
          label, n != null ? m("span", { class: "mset-chip-n" }, String(n)) : null);
      // The field goes into the row that stays as itself: a draw in place leaves it where it is, its words and its
      // focus with it, and draws the controls beside it.
      drawIn(toolsRow, [
        search,
        seg(MEMORY_STATES.map((s) => ({ value: s.value, label: c ? `${s.label} ${c[s.value]}` : s.label })), st.state, (v) => { st.state = v; void load(); }, "Which memories"),
        addBtn,
      ]);
      return drawIn(toolsEl, [
        toolsRow,
        m("div", { class: "mset-kinds", role: "toolbar", "aria-label": "Kinds", "data-key": "kinds" },
          chip("", "All", c?.kinds?.all),
          ...MEMORY_FILTERS.map((f) => chip(f.value, f.label, c?.kinds?.[f.value]))),
      ]);
    }
    if (st.view === "dossier" && st.dossier) {
      const d = st.dossier;
      return drawIn(toolsEl, [
        m("div", { class: "mset-tools-row", "data-key": "dossier" },
          m("div", { class: "mset-quiet" }, [
            d.version ? `Version ${d.version}` : "Not written yet: shown from its memories, by kind",
            d.written ? `written ${when(d.written.at)}${d.written.model ? ` by ${d.written.model}` : ""}` : null,
            d.hidden ? `${plural(d.hidden, "line")} hidden: a memory it rests on changed or was retired` : null,
          ].filter(Boolean).join(" · ")),
          m("div", { class: "mset-edit-acts" }, addBtn, m("button", { class: "sm", type: "button", "data-key": "rewrite", ...(st.busy ? { disabled: "" } : {}), onclick: () => void rewrite() }, "Rewrite now"))),
      ]);
    }
    if (st.view === "models")
      return drawIn(toolsEl, [
        m("div", { class: "mset-tools-row", "data-key": "models" },
          seg(OUTCOME_WINDOWS, st.days, (v) => { st.days = v; void load(); }, "Over the last"),
          seg(OUTCOME_FILTERS, st.work, (v) => { st.work = v; void load(); }, "Kind of work")),
      ]);
    drawIn(toolsEl, []);
  }

  /**
   * A claim's words being corrected: Save only once they say something new. Drawn again in place, the fresh Save
   * stands for the one on the page (`standing`): `mark` reaches that one.
   * @param {any} c
   */
  const editor = (c) => {
    const save = m("button", { class: "sm primary", type: "button", onclick: () => correct(c) }, "Save");
    const mark = () => standing(save).toggleAttribute("disabled", st.busy || !fresh(c));
    const field = m("textarea", {
      class: "zc-input mset-field",
      rows: "3",
      "aria-label": `What is true now, in place of ${c.id}`,
      oninput: (/** @type {Event} */ e) => {
        st.draft = String(/** @type {HTMLTextAreaElement} */ (e.target).value);
        mark();
      },
      onkeydown: (/** @type {KeyboardEvent} */ e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); correct(c); }
        else if (e.key === "Escape") { e.preventDefault(); st.editing = null; paintList(); freed(); }
      },
    });
    field.value = st.draft;
    mark();
    return m("article", { class: "mset-claim is-editing", "data-key": c.id },
      m("div", { class: "mset-edit-head" }, `Correct ${c.id}: what is true now`),
      field,
      m("p", { class: "mset-quiet" }, "The old words are kept as history, replaced by these; a session that was shown them hears of it."),
      m("div", { class: "mset-edit-acts" },
        m("button", { class: "sm ghost", type: "button", onclick: () => { st.editing = null; paintList(); freed(); } }, "Cancel"),
        save));
  };

  /** A claim being added: its kind, its words, where it will hold; Save once there are words. */
  const adder = () => {
    const save = m("button", { class: "sm primary", type: "button", onclick: add }, "Save");
    const mark = () => standing(save).toggleAttribute("disabled", st.busy || !st.addText.trim());
    const close = () => {
      st.adding = false;
      st.addKind = "rule";
      paintTools();
      paintList();
      freed();
    };
    const field = m("textarea", {
      class: "zc-input mset-field",
      rows: "3",
      "aria-label": "What memory should hold, as your word",
      placeholder: st.addKind === "procedure" ? "How to <goal>: 1. <step> 2. <step>" : "One thing that is true, in a sentence",
      oninput: (/** @type {Event} */ e) => {
        st.addText = String(/** @type {HTMLTextAreaElement} */ (e.target).value);
        mark();
      },
      onkeydown: (/** @type {KeyboardEvent} */ e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); }
        else if (e.key === "Escape") { e.preventDefault(); close(); }
      },
    });
    field.value = st.addText;
    mark();
    const where = st.scope === null ? "everywhere" : `in ${scopeOf()?.name ?? "this workspace"}`;
    return m("article", { class: "mset-claim is-editing", "data-key": "adder" },
      m("div", { class: "mset-edit-head" }, `Remember, ${where}, as your word`),
      seg(ADD_KINDS, st.addKind, (v) => { st.addKind = v; paintList(); }, "Kind"),
      field,
      m("p", { class: "mset-quiet" }, st.addKind === "procedure" ? "A how-to reads as its goal and its steps; it replaces the other ways to the same goal." : "It counts as your word: confirmed, never faded, and shown before a model's guesses."),
      m("div", { class: "mset-edit-acts" },
        m("button", { class: "sm ghost", type: "button", onclick: close }, "Cancel"),
        save));
  };

  /** How sure memory is, as a bar and a figure. @param {number} sure */
  const meter = (sure) => {
    const pct = Math.round(sure * 100);
    const low = sure < SURE_LINE;
    return m("span", { class: `mset-meter${low ? " is-low" : ""}`, title: `${pct}% sure${low ? ": under the line, recall leaves it out" : ""}` },
      m("span", { class: "mset-meter-bar", "aria-hidden": "true" }, m("span", { class: "mset-meter-fill", style: `width:${pct}%` })),
      `${pct}% sure`);
  };

  /**
   * A claim: its kind's tile, its words whole, what memory knows of it with its actions at the row's end (the words
   * take the card's width: the actions never hold a column of their own), its trigger, its history when open.
   * @param {any} c
   */
  const claimCard = (c) => {
    if (st.editing === c.id) return editor(c);
    const k = kindOf(c.kind);
    const stands = !retired(c.status);
    const events = st.open.get(c.id);
    const opened = st.open.has(c.id);
    const acts = m("div", { class: "mset-acts", "data-key": "acts" },
      ...(stands
        ? [
            mayConfirm(c) ? actBtn("check", `Confirm ${c.id}: it is right`, () => void confirm(c)) : null,
            actBtn("pencil", `Correct ${c.id}`, () => { st.editing = c.id; st.draft = String(c.text); paintList(); }),
            actBtn("archive", `Retire ${c.id}: it is not true`, () => void retire(c)),
            // Into a skill made in Filament, shown in place first (HarnessV4_Skills_Plan step 4); the memory stays.
            addsToSkill(c.kind) ? actBtn("wandSparkles", `Add ${c.id} to a skill…`, () => openAddToSkill(c, { toast }, { h: m, api: call, dialog: io.dialog })) : null,
          ]
        : [c.status === "dismissed" && !c.asked ? actBtn("rotateCcw", `Restore ${c.id}: it holds after all`, () => void restore(c)) : null]),
      actBtn("history", opened ? `Hide the history of ${c.id}` : `History of ${c.id}`, () => void toggleHistory(c.id), opened ? "on" : ""));
    // One held off while the user is asked (`asked`, M6-D16) is not struck out: it is not untrue, it waits on them.
    return m("article", { class: `mset-claim${stands ? "" : c.asked ? " is-held" : " is-retired"}`, "data-id": c.id, "data-key": c.id },
      m("span", { class: "mset-tile", style: `--tile:${k.color}`, html: /** @type {Record<string, string>} */ (ICONS)[k.icon] || ICONS.brain, "aria-hidden": "true" }),
      m("div", { class: "mset-claim-body" },
        m("div", { class: "mset-claim-text" }, String(c.text)),
        m("div", { class: "mset-claim-meta" },
          m("span", { class: "mset-kind" }, `${k.word} · ${c.id}`),
          c.trust ? m("span", {}, String(c.trust)) : null,
          c.backed > 1 ? m("span", { title: `${c.backed} sessions said it` }, `✓${c.backed}`) : null,
          c.sure != null ? meter(c.sure) : null,
          c.held ? m("span", { class: "mset-flag" }, "held back from recall") : null,
          ...(c.flags || []).map((/** @type {string} */ f) => m("span", { class: "mset-flag" }, f)),
          c.replacedBy
            ? m("button", { class: "mset-cite", type: "button", "data-key": "replaced", title: `Show ${c.replacedBy}`, onclick: () => find(c.replacedBy) }, `replaced by ${c.replacedBy}`)
            : !stands ? m("span", {}, c.asked ? "held for your answer" : "retired") : null,
          acts),
        ...(c.triggers || []).map((/** @type {any} */ t) =>
          m("div", { class: "mset-trigger" },
            m("span", { class: "mset-trigger-ic", html: ICONS.shieldAlert, "aria-hidden": "true" }),
            m("span", {}, ...triggerParts(t).map((p) => (typeof p === "string" ? p : m("code", { class: "mset-code" }, p.code)))))),
        opened
          ? m("ol", { class: "mset-history", "data-key": "history", "aria-label": `History of ${c.id}` },
              ...(events
                ? events.map((/** @type {any} */ e) =>
                    m("li", { class: `mset-event${e.undone ? " is-undone" : ""}` },
                      m("span", { class: "mset-event-when" }, when(e.at)),
                      m("span", { class: "mset-event-what" }, eventWords(e), e.reason ? m("span", { class: "mset-event-why" }, ` — ${e.reason}`) : null, e.undone ? m("span", { class: "mset-event-why" }, " (undone)") : null)))
                : [m("li", { class: "mset-quiet" }, "Reading…")]))
          : null));
  };

  /** The words for an empty list, by what was asked. */
  const emptyWords = () => {
    if (st.q.trim()) return "No memory here says that.";
    if (st.state === "review") return "Nothing to review: no memory here is flagged, held back or unsure.";
    if (st.state === "retired") return "Nothing retired here.";
    if (st.kind) return `No ${MEMORY_FILTERS.find((f) => f.value === st.kind)?.label.toLowerCase() || "memories"} here yet.`;
    return st.scope === null
      ? "Nothing holds everywhere yet. A rule you give outside any workspace shows here."
      : "No memories here yet. They come as you work: what you correct, what you ask it to remember, and what the learner reads from finished sessions.";
  };

  /** @param {any} q */
  const questionCard = (q) => {
    const say = questionAnswers(q);
    return m("article", { class: "mset-claim", "data-key": q.id },
      m("span", { class: "mset-tile", style: "--tile:var(--color-sys-orange)", html: ICONS.circleHelp, "aria-hidden": "true" }),
      m("div", { class: "mset-claim-body" },
        m("div", { class: "mset-claim-text" }, questionWords(q)),
        m("div", { class: "mset-claim-meta" }, m("span", {}, String(q.reason || "")), q.created ? m("span", {}, `asked ${when(q.created)}`) : null)),
      m("div", { class: "mset-acts is-shown" },
        m("button", { class: "sm primary", type: "button", "data-key": "accept", "aria-label": say.accept.aria, ...(st.busy ? { disabled: "" } : {}), onclick: () => void answer(q, "accept") }, say.accept.label),
        m("button", { class: "sm", type: "button", "data-key": "reject", "aria-label": say.reject.aria, ...(st.busy ? { disabled: "" } : {}), onclick: () => void answer(q, "reject") }, say.reject.label)));
  };

  /**
   * How runs ended, as one bar: a share for each way, in its colour, named in `label`.
   * @param {ReturnType<typeof endedParts>} parts @param {string} label
   */
  const endedBar = (parts, label) =>
    m("div", { class: "mset-bar", role: "img", "aria-label": label },
      ...parts.map((p) => m("span", { class: `mset-bar-seg is-${p.key}`, style: `flex:${p.n}`, title: `${p.n} ${p.label}` })));
  /** A figure, big, over its name. @param {string} value @param {string} label */
  const figure = (value, label) => m("div", { class: "mset-fig" }, m("span", { class: "mset-fig-n" }, value), m("span", { class: "mset-fig-l" }, label));
  /**
   * A model's record in one kind of work: its tile, name and runs; held, the median rounds and time, the cost a run;
   * how its runs ended, as a bar with its words; and a line for each thing they did. @param {any} g
   */
  const outcomeCard = (g) => {
    const w = outcomeWords(g);
    const tile = WORK_TILES[g.kind] || { icon: "brain", color: "var(--color-sys-gray)" };
    return m("article", { class: "mset-model" },
      m("div", { class: "mset-model-head" },
        m("span", { class: "mset-tile", style: `--tile:${tile.color}`, html: /** @type {Record<string, string>} */ (ICONS)[tile.icon], "aria-hidden": "true" }),
        m("span", { class: "mset-model-name" }, w.who),
        m("span", { class: "mset-kind" }, w.runs)),
      m("div", { class: "mset-figs" }, figure(w.held, "held"), figure(w.rounds, "rounds"), figure(w.time, "time"), figure(w.perRun, "a run")),
      endedBar(endedParts(g), [w.heldWords, w.trouble].filter(Boolean).join(" · ")),
      m("div", { class: "mset-model-meta" }, m("span", {}, w.heldWords), w.trouble ? m("span", { class: "mset-flag" }, w.trouble) : null, m("span", {}, w.cost)),
      ...w.lines.map((l) =>
        m("div", { class: "mset-did" },
          m("span", { class: "mset-did-what" }, l.what),
          endedBar(l.parts, [l.held, l.trouble].filter(Boolean).join(" · ")),
          m("span", { class: "mset-did-n" }, l.held))));
  };
  function paintList() {
    if (st.error) return drawIn(listEl, [m("p", { class: "set-error" }, st.error)]);
    if (st.view === "models") {
      const r = st.outcomes;
      if (!r) return drawIn(listEl, [m("p", { class: "mset-quiet" }, "Reading…")]);
      const note = m("p", { class: "mset-quiet" }, OUTCOMES_NOTE);
      return drawIn(listEl, [note, ...(r.groups.length ? r.groups.map(outcomeCard) : [m("p", { class: "mset-quiet" }, noOutcomesWords({ days: st.days, kind: st.work, everywhere: st.scope === null }))])]);
    }
    const top = st.adding && st.view !== "questions" ? [adder()] : [];
    if (st.view === "questions") {
      const qs = st.questions || [];
      return drawIn(listEl, qs.length ? qs.map(questionCard) : [m("p", { class: "mset-quiet" }, "Memory asks nothing here. It asks before it changes your own word: a value that replaces yours, a rule whose file is gone.")]);
    }
    if (st.view === "dossier") {
      const d = st.dossier;
      if (!d) return drawIn(listEl, [...top, m("p", { class: "mset-quiet" }, "Reading…")]);
      if (!d.sections?.length)
        return drawIn(listEl, [...top, m("p", { class: "mset-quiet" }, "Nothing to say yet. The dossier is written from this workspace's memories once there are some; Rewrite now asks the curator.")]);
      return drawIn(listEl, [...top, ...d.sections.map((/** @type {any} */ sec) =>
        m("section", { class: "mset-dsec", "data-key": `section:${sec.title}` },
          m("h4", { class: "mset-dsec-title" }, String(sec.title)),
          ...sec.lines.map((/** @type {any} */ l) =>
            m("div", { class: "mset-dline" },
              m("span", { class: "mset-dline-text" }, String(l.text)),
              m("span", { class: "mset-dline-cites" },
                ...l.cites.map((/** @type {string} */ id) => m("button", { class: "mset-cite", type: "button", "data-key": id, title: `Show ${id}: confirm, correct or retire it here`, onclick: () => find(id) }, id)),
                ...(l.flags || []).filter((/** @type {string} */ f) => !/^✓/.test(f)).map((/** @type {string} */ f) => m("span", { class: "mset-flag" }, f)))))))]);
    }
    const r = st.claims;
    if (!r) return drawIn(listEl, [...top, m("p", { class: "mset-quiet" }, "Reading…")]);
    if (!r.claims.length) return drawIn(listEl, [...top, m("p", { class: "mset-quiet" }, emptyWords())]);
    drawIn(listEl, [...top, ...r.claims.map(claimCard), ...(r.more ? [m("p", { class: "mset-quiet", "data-key": "more" }, `…and ${r.more} more: a search or a kind narrows them.`)] : [])]);
  }

  // ---- the page ----
  // The frame is the container the layout reads its width from: the page beside the sidebars, not the window.
  const frameEl = m("div", { class: "mset-frame" }, m("div", { class: "mset" }, scopesEl, m("section", { class: "mset-main" }, headEl, toolsEl, listEl)));
  body.replaceChildren(frameEl);
  // ---- live (HarnessV3-Memory M7-D37): what memory changes is read again where this page shows it; a page left lets go ----
  followClaims(io.bus || onBus, {
    wait: io.followMs ?? 250,
    alive: () => frameEl.isConnected !== false,
    onReadAll: () => (handsBusy() ? void (st.owed = true) : void reread()),
    onChanges: (changes) => {
      const t = claimsTouched(changes, { scope: st.scope, shown: (st.claims?.claims || []).map((/** @type {any} */ c) => c.id), histories: st.open.keys(), dossier: st.view === "dossier" ? st.scope : null });
      if (t.scopes) void loadScopes();
      if (t.questions) void loadQuestions();
      const list = st.view === "memories" ? t.list : st.view === "dossier" && t.dossier;
      if (!list && !t.histories.length) return;
      if (handsBusy()) return void (st.owed = true);
      if (list) void load();
      for (const id of t.histories) void readHistory(id);
    },
  });
  paintHead();
  paintTools();
  paintList();
  void (async () => {
    await loadScopes();
    if (st.error) return paintList();
    pick(scopeFor(st.scopes, cb.scope));
  })();
}
