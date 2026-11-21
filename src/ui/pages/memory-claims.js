// @ts-check
// The console's claims (HarnessV3-Memory M6-6): what the harness's Settings → Memory shows, in the console's own style,
// said in the same words from the same routes (src/ui/lib/claims.js).
// - claimPanels (the Memories tab): where (everywhere, or a project), which (standing, to review, retired), what kind
//   and a search; each claim a row with how it is known, how sure memory is, its flags and its trigger, and Confirm,
//   Correct, Retire or Restore and its history, opened under the row. Beside it, memory's questions about that scope,
//   answered in place.
// - dossierView (a Projects card): the project's dossier by section, each line with the claims it cites. A cite opens
//   the claim on the Memories tab, where it is confirmed, corrected or retired (M6-D3); Rewrite now asks the curator.
// - permissionPanel (the Memories tab): the always-allows memory offers once a call was allowed often enough. They are
//   not claims; Confirm is the always-allow.
// The console acts as the owner (M6-D2) with no session open, so nothing it does is scoped to one. What memory changes
// meanwhile, anywhere, the panels hear on the events stream and read again where they show it, and nowhere else (M7-D37).
import { ui } from "../runtime.js";
import {
  MEMORY_STATES, MEMORY_FILTERS, SURE_LINE, isRetired, plural, kindWord, itemPath, claimsPath, mayConfirm, questionWords, questionAnswers,
  triggerParts, eventWords, shortWhen, followClaims, claimsTouched, firstScope,
} from "../lib/claims.js";
import { projectWords } from "../lib/format.js";

/** A refusal or a failure, in its words. @param {any} e */
const said = (e) => e?.body?.error || e?.message || String(e);

/**
 * The Memories tab's claim browser and memory's questions about the scope it shows.
 * @param {any} S  the tab's remembered choices (`state.memUi`): `scope` (a project id, null for everywhere, undefined
 *   until one is picked: then the project with the most), `state`, `kind`, `q`
 * @returns {{ panels: HTMLElement[], reload: () => Promise<void> }}  the two panels, and a read of everything they show
 *   (after a change made elsewhere on the page)
 */
export function claimPanels(S) {
  const { api, h, toast, empty } = /** @type {any} */ (ui);
  if (!MEMORY_STATES.some((s) => s.value === S.state)) S.state = "standing";
  if (typeof S.kind !== "string") S.kind = "";
  if (typeof S.q !== "string") S.q = "";
  const st = {
    /** @type {any[]} */ scopes: [],
    /** @type {any} */ claims: null,
    /** @type {any[] | null} */ questions: null,
    error: "",
    askError: "",
    /** @type {string | null} */ editing: null,
    draft: "",
    /** The histories open, by claim id: its events, or null while it is read. @type {Map<string, any[] | null>} */
    open: new Map(),
    busy: false,
    seq: 0,
    /** The questions' reads, as `seq` is the list's: one overtaken by a newer (another scope picked) is dropped. */
    askSeq: 0,
    /** A change came while the owner corrected a claim: what it touched is read once they are done (`freed`). */
    owed: false,
  };

  // ---- the parts that stay: the search keeps its focus while the list under it is read again ----
  const scopeSel = h("select", { class: "sm", "aria-label": "Where the memories hold", onchange: () => pick(scopeSel.value === "" ? null : scopeSel.value) });
  const search = h("input", { type: "search", class: "grow", placeholder: "words in a memory, or its id (i12)", "aria-label": "Search memories" });
  search.value = S.q;
  const run = () => {
    S.q = String(search.value || "").trim();
    void load();
  };
  search.onkeydown = (/** @type {KeyboardEvent} */ e) => {
    if (e.key === "Enter") run();
  };
  const statesEl = h("span", {});
  const kindsEl = h("div", { class: "row", style: "margin:0 0 10px" });
  const listEl = h("div", { "aria-live": "polite" });
  const askHead = h("h2", { style: "margin:0" }, "Memory asks");
  const askEl = h("div", {});

  /** @param {{ value: string, label: string }[]} options @param {string} value @param {(v: string) => void} onPick @param {string} label */
  const seg = (options, value, onPick, label) =>
    h("div", { class: "seg small", role: "tablist", "aria-label": label },
      ...options.map((op) => h("button", { class: op.value === value ? "on" : "", role: "tab", "aria-selected": op.value === value ? "true" : "false", onclick: () => onPick(op.value) }, op.label)));
  /** A button that waits while a word is on its way. @param {string} label @param {string} title @param {() => void} onClick @param {string} [cls] */
  const btn = (label, title, onClick, cls = "sm") =>
    h("button", { class: cls, title, ...(st.busy ? { disabled: "" } : {}), onclick: () => { if (!st.busy) onClick(); } }, label);

  // ---- writes: the owner's word, through the routes; a refusal is said in a toast ----
  /** @param {string} path @param {any} body @param {(r: any) => string | null} [done]  what the toast says after */
  async function word(path, body, done) {
    st.busy = true;
    paintList();
    paintQuestions();
    try {
      const r = await api(path, { method: "POST", body });
      if (r && r.ok === false) toast(r.error || "memory refused it", "err");
      else {
        const line = done?.(r);
        if (line) toast(line);
      }
    } catch (/** @type {any} */ e) {
      toast(said(e), "err");
    } finally {
      st.busy = false;
      st.editing = null;
      st.draft = "";
    }
    await reload();
  }
  const confirm = (/** @type {any} */ c) => word(itemPath(c.id), { status: "confirmed" }, () => `${c.id} confirmed: it counts as your word`);
  const restore = (/** @type {any} */ c) => word(itemPath(c.id), { status: "confirmed" }, () => `${c.id} stands again`);
  const retire = (/** @type {any} */ c) => word("/memory/forget", { id: c.id, reason: "retired in the console" }, () => `${c.id} retired: kept as history`);
  const fresh = (/** @type {any} */ c) => !!st.draft.trim() && st.draft.trim() !== String(c.text).trim();
  const correct = (/** @type {any} */ c) => {
    if (st.busy || !fresh(c)) return;
    void word(`${itemPath(c.id)}/correct`, { text: st.draft.trim(), reason: "corrected in the console" }, (r) => (r?.id ? `${r.id} replaces ${c.id}` : null));
  };
  /** @param {any} q @param {"accept" | "reject"} answer */
  const answer = (q, answer) => word(`/memory/inbox/${encodeURIComponent(q.id)}`, { answer }, () => (answer === "accept" ? "Done as asked" : "Left as it is: memory will not ask it again"));

  // ---- reads ----
  /**
   * Where memories hold, read again. The project picked being gone (deleted elsewhere), the one the tab opens on is
   * picked instead, once the owner's hands are free (M7-D37). @returns {Promise<boolean>} whether it picked one
   */
  async function loadScopes() {
    try {
      st.scopes = (await api("/memory/claims/scopes")).scopes || [];
    } catch (/** @type {any} */ e) {
      st.error = said(e);
      paintScopes();
      return false;
    }
    paintScopes();
    if (typeof S.scope !== "string" || st.scopes.some((s) => s.project === S.scope)) return false;
    if (st.editing != null) return (st.owed = true), false;
    pick(firstScope(st.scopes));
    return true;
  }
  /** The scope's questions, read again; a read overtaken by a newer one is dropped. */
  async function loadQuestions() {
    const mine = ++st.askSeq;
    try {
      const r = await api(`/memory/inbox${S.scope ? `?project=${encodeURIComponent(S.scope)}` : ""}`);
      if (mine === st.askSeq) {
        st.questions = r.questions || [];
        st.askError = "";
      }
    } catch (/** @type {any} */ e) {
      if (mine === st.askSeq) st.askError = said(e);
    }
    if (mine === st.askSeq) paintQuestions();
  }
  /** The list, read again; a read overtaken by a newer one is dropped. */
  async function load() {
    const mine = ++st.seq;
    st.error = "";
    try {
      const r = await api(claimsPath({ project: S.scope, state: S.state, kind: S.kind, q: S.q }));
      if (mine === st.seq) st.claims = r;
    } catch (/** @type {any} */ e) {
      if (mine === st.seq) st.error = said(e);
    }
    if (mine !== st.seq) return;
    paintFilters();
    paintList();
  }
  /** Another scope: its claims and its questions; the search and the open rows were the last one's. @param {string | null} project */
  function pick(project) {
    S.scope = project;
    S.q = "";
    search.value = "";
    st.editing = null;
    st.open.clear();
    st.claims = null;
    paintScopes();
    paintList();
    void loadQuestions();
    void load();
  }
  /** One claim, found by its id among the standing. @param {string} id */
  function find(id) {
    S.state = "standing";
    S.kind = "";
    S.q = id;
    search.value = id;
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
      const r = await api(`${itemPath(id)}/history`);
      if (st.open.has(id)) st.open.set(id, r.events || []);
    } catch (/** @type {any} */ e) {
      st.open.delete(id);
      why = said(e);
    }
    paintList();
    return why;
  }
  /** The owner's hands free again (a correction saved or put away): what changed meanwhile is read now. */
  const freed = () => {
    if (st.owed && st.editing == null) void reload();
  };

  // ---- painting ----
  function paintScopes() {
    const everywhere = st.scopes.find((s) => s.project === null);
    const projects = st.scopes.filter((s) => s.project !== null && (!s.archived || s.claims));
    /** @param {any} s */
    const opt = (s) => h("option", { value: s.project ?? "", ...(s.project === S.scope ? { selected: "" } : {}) }, `${s.name} (${s.claims ?? 0})`);
    scopeSel.replaceChildren(...(everywhere ? [opt(everywhere)] : []), ...(projects.length ? [h("optgroup", { label: "Projects" }, ...projects.map(opt))] : []));
    scopeSel.value = S.scope ?? "";
  }

  function paintFilters() {
    const c = st.claims?.counts;
    statesEl.replaceChildren(seg(MEMORY_STATES.map((s) => ({ value: s.value, label: c ? `${s.label} ${c[s.value]}` : s.label })), S.state, (v) => { S.state = v; void load(); }, "Which memories"));
    kindsEl.replaceChildren(seg(
      [{ value: "", label: c ? `All ${c.kinds.all}` : "All" }, ...MEMORY_FILTERS.map((f) => ({ value: f.value, label: c ? `${f.label} ${c.kinds[f.value]}` : f.label }))],
      S.kind, (v) => { S.kind = v; void load(); }, "Kinds"));
  }

  /** A claim's words being corrected: Save only once they say something new. @param {any} c */
  const editor = (c) => {
    const field = h("textarea", { rows: 3, "aria-label": `What is true now, in place of ${c.id}` });
    field.value = st.draft;
    const save = h("button", { class: "primary sm", onclick: () => correct(c) }, "Save");
    const mark = () => save.toggleAttribute("disabled", st.busy || !fresh(c));
    const cancel = () => {
      st.editing = null;
      paintList();
      freed();
    };
    field.oninput = () => {
      st.draft = String(field.value);
      mark();
    };
    field.onkeydown = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); correct(c); }
      else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    };
    mark();
    return h("div", { class: "mem-claim-edit" },
      h("b", { class: "small" }, `Correct ${c.id}: what is true now`),
      field,
      h("div", { class: "row", style: "margin:0;align-items:center;gap:8px" },
        h("span", { class: "muted small grow" }, "The old words are kept as history, replaced by these; a session that was shown them hears of it."),
        h("button", { class: "sm ghost", onclick: cancel }, "Cancel"),
        save));
  };

  /** A claim's history, oldest first. @param {any} c */
  const history = (c) => {
    const events = st.open.get(c.id);
    if (!events) return h("span", { class: "muted small" }, "reading the history…");
    if (!events.length) return h("span", { class: "muted small" }, "No history recorded.");
    return h("ol", { class: "small mem-history", "aria-label": `History of ${c.id}` },
      ...events.map((/** @type {any} */ e) =>
        h("li", { class: e.undone ? "muted" : "" },
          h("span", { class: "muted mem-history-when" }, shortWhen(e.at)),
          h("span", {}, eventWords(e), e.reason ? h("span", { class: "muted" }, ` — ${e.reason}`) : null, e.undone ? h("span", { class: "muted" }, " (undone)") : null))));
  };

  /** A claim: its row, and under it its editor or its history when one is open. @param {any} c */
  const claimRows = (c) => {
    const standing = !isRetired(c.status);
    const opened = st.open.has(c.id);
    const low = c.sure != null && c.sure < SURE_LINE;
    // One held off while the user is asked (`asked`, M6-D16) is not struck out: it is not untrue, it waits on them.
    const tr = h("tr", { class: standing ? "" : c.asked ? "mem-claim-held" : "mem-claim-retired", "data-id": c.id },
      h("td", {}, h("span", { class: "pill", title: `kind: ${c.kind}` }, kindWord(c.kind))),
      h("td", { class: "mem-text" },
        h("div", { class: "mem-claim-text" }, String(c.text)),
        ...(c.triggers || []).map((/** @type {any} */ t) =>
          h("div", { class: "muted small mem-trigger" }, "⚠ ", ...triggerParts(t).map((p) => (typeof p === "string" ? p : h("code", {}, p.code))))),
        c.held || c.flags?.length || c.replacedBy
          ? h("div", { class: "mem-claim-flags" },
              c.held ? h("span", { class: "pill warn", title: "Recall leaves it out until it is checked or confirmed" }, "held back from recall") : null,
              ...(c.flags || []).map((/** @type {string} */ f) => h("span", { class: "pill warn" }, f)),
              c.replacedBy ? h("button", { class: "sm ghost", title: `Show ${c.replacedBy}`, onclick: () => find(c.replacedBy) }, `replaced by ${c.replacedBy}`) : null)
          : null),
      h("td", { class: "muted small", style: "white-space:nowrap" }, h("code", {}, c.id), " ", [c.trust, c.backed > 1 ? `✓${c.backed}` : null].filter(Boolean).join(" · ")),
      h("td", { class: `num${low ? " warn" : ""}`, title: c.sure == null ? "" : `${Math.round(c.sure * 100)}% sure${low ? ": under the line, recall leaves it out" : ""}` }, c.sure != null ? `${Math.round(c.sure * 100)}%` : "–"),
      h("td", { class: "acts" },
        ...(standing
          ? [
              mayConfirm(c) ? btn("Confirm", `Confirm ${c.id}: it is right`, () => void confirm(c)) : null,
              btn("Correct", `Correct ${c.id}: say what is true now`, () => { st.editing = c.id; st.draft = String(c.text); paintList(); }),
              btn("Retire", `Retire ${c.id}: it is not true (kept as history)`, () => void retire(c), "sm ghost"),
            ]
          : [c.status === "dismissed" && !c.asked ? btn("Restore", `Restore ${c.id}: it holds after all`, () => void restore(c)) : null]),
        btn(opened ? "History ▴" : "History ▾", opened ? `Hide the history of ${c.id}` : `History of ${c.id}`, () => void toggleHistory(c.id), "sm ghost")));
    const under = st.editing === c.id ? editor(c) : opened ? history(c) : null;
    return under ? [tr, h("tr", { class: "mem-expand" }, h("td", { colspan: 5 }, under))] : [tr];
  };

  /** The words for an empty list, by what was asked. */
  const emptyWords = () => {
    if (S.q) return ["No memory here says that", "Search looks at a memory's words, or at its id (i12)."];
    if (S.state === "review") return ["Nothing to review", "No memory here is flagged, held back from recall or under the line."];
    if (S.state === "retired") return ["Nothing retired here", ""];
    if (S.kind) return [`No ${MEMORY_FILTERS.find((f) => f.value === S.kind)?.label.toLowerCase() || "memories"} here yet`, ""];
    return S.scope === null
      ? ["Nothing holds everywhere yet", "A rule you give outside any project, or one you remember here, shows here."]
      : ["No memories here yet", "They come as you work: what you correct, what you ask it to remember, and what the learner reads from finished sessions."];
  };

  function paintList() {
    if (st.error) return listEl.replaceChildren(h("p", { class: "err small" }, st.error));
    const r = st.claims;
    if (!r) return listEl.replaceChildren(h("span", { class: "muted small" }, "loading…"));
    if (!r.claims.length) return listEl.replaceChildren(empty(...emptyWords()));
    listEl.replaceChildren(
      h("div", { class: "table-wrap" },
        h("table", { class: "small mem-claims" },
          h("thead", {}, h("tr", {}, ...["kind", "memory", "known", "sure", ""].map((t) => h("th", {}, t)))),
          h("tbody", {}, ...r.claims.flatMap(claimRows)))),
      ...(r.more ? [h("p", { class: "muted small" }, `…and ${plural(r.more, "more", "more")}: a search or a kind narrows them.`)] : []));
  }

  function paintQuestions() {
    const qs = st.questions;
    askHead.replaceChildren(qs?.length ? `Memory asks · ${qs.length}` : "Memory asks");
    if (st.askError) return askEl.replaceChildren(h("p", { class: "err small" }, st.askError));
    if (!qs) return askEl.replaceChildren(h("span", { class: "muted small" }, "loading…"));
    if (!qs.length) return askEl.replaceChildren(h("p", { class: "muted small", style: "margin:0" }, "Memory asks nothing here. It asks before it changes your own word: a value that replaces yours, a rule whose file is gone."));
    askEl.replaceChildren(
      h("div", { class: "table-wrap" },
        h("table", { class: "small" },
          h("thead", {}, h("tr", {}, ...["memory would", "why", "asked", ""].map((t) => h("th", {}, t)))),
          h("tbody", {}, ...qs.map((q) => {
            const say = questionAnswers(q);
            return h("tr", {},
              h("td", { class: "mem-text" }, questionWords(q)),
              h("td", { class: "mem-text muted small" }, String(q.reason || "")),
              h("td", { class: "muted small", style: "white-space:nowrap" }, shortWhen(q.created)),
              h("td", { class: "acts" },
                btn(say.accept.label, say.accept.aria, () => void answer(q, "accept"), "sm primary"),
                btn(say.reject.label, say.reject.aria, () => void answer(q, "reject"), "sm ghost")));
          })))));
  }

  // ---- the panels ----
  paintFilters();
  paintList();
  paintQuestions();
  void (async () => {
    // The project remembered being gone, the scopes' read picked another, and read it.
    if (await loadScopes()) return;
    if (st.error) return paintList();
    if (S.scope !== null && typeof S.scope !== "string") {
      S.scope = firstScope(st.scopes);
      paintScopes();
    }
    void loadQuestions();
    void load();
  })();
  /** Everything the panels show, read again (the open histories too): after a word, Refresh, or a change not followed. */
  const reload = async () => {
    st.owed = false;
    await Promise.all([loadScopes(), loadQuestions(), load(), ...[...st.open.keys()].map((id) => readHistory(id))]);
  };
  const panels = [
    h("section", { class: "panel" },
      h("div", { class: "row", style: "margin:0 0 6px;align-items:center" },
        h("h2", { style: "margin:0" }, "Memories"),
        h("span", { class: "grow" }),
        h("label", { class: "small" }, "where ", scopeSel),
        h("button", { class: "sm", onclick: () => void reload() }, "Refresh")),
      h("p", { class: "muted small" }, "Each memory is one claim: what it says, how it is known (your word, confirmed, said in several sessions, or a model's guess), how sure memory is of it, and what is wrong with it now. To review lists the standing ones that are flagged, held back from recall or under the line. Confirm makes one your word; Correct replaces its words and keeps the old ones as history; Retire takes it out of recall, kept as history, and Restore brings it back."),
      h("div", { class: "row", style: "margin:0 0 8px;align-items:center;gap:8px" }, search, h("button", { class: "sm", onclick: run }, "Search"), statesEl),
      kindsEl,
      listEl),
    h("section", { class: "panel" },
      h("div", { class: "row", style: "margin:0 0 6px;align-items:center" }, askHead),
      askEl),
  ];
  // ---- live (M7-D37): what memory changes is read again where the panels show it; a tab left lets go ----
  followClaims(ui.onEvents, {
    alive: () => panels[0].isConnected !== false,
    onReadAll: () => (st.editing != null ? void (st.owed = true) : void reload()),
    onChanges: (changes) => {
      const t = claimsTouched(changes, { scope: S.scope ?? null, shown: (st.claims?.claims || []).map((/** @type {any} */ c) => c.id), histories: st.open.keys() });
      if (t.scopes) void loadScopes();
      if (t.questions) void loadQuestions();
      if (!t.list && !t.histories.length) return;
      // A read now would put a fresh list in place of the words being corrected.
      if (st.editing != null) return void (st.owed = true);
      if (t.list) void load();
      for (const id of t.histories) void readHistory(id);
    },
  });
  return { panels, reload };
}

/**
 * A project's dossier, on its card (M6-6, M6-D3): by section, each line with the claims it cites. A cite opens the claim
 * on the Memories tab, where it is confirmed, corrected or retired, and the line follows; Rewrite now asks the curator.
 * @param {{ id: string, name?: string, dossier?: number | null }} p  a project as the projects route lists it
 */
export function dossierView(p) {
  const { api, h, toast, state, go } = /** @type {any} */ (ui);
  /** @type {any} */
  let d = null;
  let shown = false;
  let busy = false;
  /** The project was deleted (elsewhere: this card was drawn before): nothing is left to read or rewrite. */
  let gone = false;
  /** @type {() => void} */
  let unfollow = () => {};
  const out = h("div", { class: "mem-dossier" });
  const openClaim = (/** @type {string} */ id) => {
    Object.assign((state.memClaims ||= {}), { scope: p.id, state: "standing", kind: "", q: id });
    go("memories");
  };
  const went = () => {
    gone = true;
    d = null;
    unfollow();
    paint();
  };
  async function read() {
    try {
      d = await api(`/memory/dossier?project=${encodeURIComponent(p.id)}`);
    } catch (/** @type {any} */ e) {
      if (e?.status === 404) return went();
      toast(said(e), "err");
    }
    paint();
  }
  async function rewrite() {
    busy = true;
    paint();
    try {
      const r = await api("/memory/curator/run", { method: "POST", body: { project: p.id } });
      if (r?.skipped) toast(`The curator did not run: ${r.skipped}`, "err");
      else if (r?.error) toast(`The curator's pass ${r.run} stopped: ${r.error}`, "err");
      else toast(`The curator's pass ${r?.run || ""}: ${plural(Number(r?.actions) || 0, "change")}, ${plural(Number(r?.questions) || 0, "question")}`);
    } catch (/** @type {any} */ e) {
      toast(said(e), "err");
    }
    busy = false;
    shown = true;
    await read();
  }
  /** @param {any} sec */
  const section = (sec) =>
    h("div", { class: "mem-dsec" },
      h("b", { class: "small" }, String(sec.title)),
      h("ul", { class: "small mem-dlines" },
        ...sec.lines.map((/** @type {any} */ l) =>
          h("li", {},
            h("span", {}, String(l.text)),
            ...l.cites.map((/** @type {string} */ id) => h("button", { class: "sm ghost mono mem-cite", title: `Open ${id} on the Memories tab: confirm, correct or retire it there`, onclick: () => openClaim(id) }, id)),
            ...(l.flags || []).filter((/** @type {string} */ f) => !/^✓/.test(f)).map((/** @type {string} */ f) => h("span", { class: "pill warn" }, f))))));
  function paint() {
    if (gone) return out.replaceChildren(h("span", { class: "muted small" }, "This project was deleted: its dossier went with it."));
    const version = d ? d.version : p.dossier;
    out.replaceChildren(
      h("div", { class: "row", style: "margin:0;align-items:center;gap:8px" },
        h("span", { class: "muted small grow" }, version ? `Dossier v${version}, written by the curator: every new session here opens with it.` : "No dossier written yet: until the curator writes one, sessions here open with the project's standing memories, by kind."),
        h("button", { class: "sm ghost", onclick: () => { shown = !shown; if (shown && !d) void read(); else paint(); } }, shown ? "Hide" : "Show"),
        h("button", { class: "sm", title: "Ask the curator for a pass over this project now: merge what says the same, re-check what changed, write the dossier", ...(busy ? { disabled: "" } : {}), onclick: () => void rewrite() }, busy ? "rewriting…" : "Rewrite now")),
      ...(shown && d
        ? [
            h("span", { class: "muted small" }, [
              d.written ? `written ${shortWhen(d.written.at)}${d.written.model ? ` by ${d.written.model}` : ""}` : "shown from its memories, by kind",
              d.hidden ? `${plural(d.hidden, "line")} hidden: a memory it rests on changed or was retired` : null,
            ].filter(Boolean).join(" · ")),
            ...(d.sections?.length
              ? d.sections.map(section)
              : [h("span", { class: "muted small" }, "Nothing to show yet: no memory of this project has earned a place (said by you, confirmed, or said in two sessions).")]),
          ]
        : shown ? [h("span", { class: "muted small" }, "reading…")] : []));
  }
  paint();
  // Live (M7-D37): a change in the project reads the dossier shown again; a rewrite reads it even hidden, for its version;
  // the project deleted (`deleted` with no claim, in it) says so, and reads nothing.
  unfollow = followClaims(ui.onEvents, {
    alive: () => out.isConnected !== false,
    onReadAll: () => void ((shown || d) && read()),
    onChanges: (changes) => {
      if (changes.some((c) => c.claim == null && c.action === "deleted" && c.project === p.id)) return went();
      if (!claimsTouched(changes, { scope: p.id, dossier: p.id }).dossier) return;
      if (shown || changes.some((c) => c.action === "dossier" && c.project === p.id)) void read();
    },
  });
  return out;
}

/**
 * The always-allows memory offers (permissions.js): a call allowed often enough in a project becomes an offer, to
 * review here. Confirm is the always-allow; Dismiss keeps it from being offered again.
 * @param {any} S  the tab's remembered choices (`state.memUi`): `perm`, the status shown
 */
export function permissionPanel(S) {
  const { api, h, toast, empty, memSessionLink, memAgo } = /** @type {any} */ (ui);
  const SEGS = [["inferred", "Offered"], ["confirmed", "Always allowed"], ["dismissed", "Dismissed"]];
  if (!SEGS.some(([v]) => v === S.perm)) S.perm = "inferred";
  const box = h("div", {}, h("span", { class: "muted small" }, "loading…"));
  const segEl = h("span", {});
  const paintSeg = () =>
    segEl.replaceChildren(h("div", { class: "seg small" }, ...SEGS.map(([v, l]) => h("button", { class: S.perm === v ? "on" : "", onclick: () => { S.perm = v; paintSeg(); void load(); } }, l))));
  /** @param {any} it @param {string} status */
  const setStatus = async (it, status) => {
    try {
      await api(itemPath(it.id), { method: "POST", body: { status } });
      toast(status === "confirmed" ? `Always allowed: ${it.text}` : "Dismissed: it is not offered again");
    } catch (/** @type {any} */ e) {
      toast(said(e), "err");
    }
    void load();
  };
  async function load() {
    let items;
    try {
      items = (await api(`/memory/items?kind=permission&status=${encodeURIComponent(S.perm)}&limit=200`)).items || [];
    } catch (/** @type {any} */ e) {
      return box.replaceChildren(h("p", { class: "err small" }, said(e)));
    }
    if (!items.length)
      return box.replaceChildren(empty(S.perm === "inferred" ? "Nothing offered" : S.perm === "confirmed" ? "Nothing always allowed" : "Nothing dismissed", S.perm === "inferred" ? "An always-allow is offered once you have allowed the same call in a project often enough." : ""));
    box.replaceChildren(
      h("div", { class: "table-wrap" },
        h("table", { class: "small" },
          h("thead", {}, h("tr", {}, ...["call", "project", "session", "when", ""].map((t) => h("th", {}, t)))),
          h("tbody", {}, ...items.map((/** @type {any} */ it) =>
            h("tr", {},
              h("td", { class: "mem-text" }, h("code", {}, String(it.text ?? ""))),
              ((pw) => h("td", { class: "muted small", title: pw.title }, pw.text))(projectWords({ id: it.project_id, name: it.projectName, cwd: it.projectCwd })),
              h("td", {}, memSessionLink(it.chain_id)),
              h("td", { class: "muted small", style: "white-space:nowrap" }, memAgo(it.created_at)),
              h("td", { class: "acts" },
                S.perm !== "confirmed" ? h("button", { class: "sm", onclick: () => void setStatus(it, "confirmed") }, "Always allow") : null,
                S.perm !== "dismissed" ? h("button", { class: "sm ghost", onclick: () => void setStatus(it, "dismissed") }, "Dismiss") : null)))))));
  }
  paintSeg();
  void load();
  return h("section", { class: "panel" },
    h("div", { class: "row", style: "margin:0 0 6px;align-items:center" }, h("h2", { style: "margin:0" }, "Always-allow offers"), h("span", { class: "grow" }), segEl),
    h("p", { class: "muted small" }, "When you allow the same call in a project often enough, memory offers to allow it always there. These are not memories: an always-allow only spares the question."),
    box);
}
