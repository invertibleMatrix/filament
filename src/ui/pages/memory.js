// @ts-check
import { ui } from "../runtime.js";
import { settingsEditor, historyList } from "../lib/settings/editor.js";
import { sessionEditorCallbacks, projectEditorCallbacks } from "../lib/settings/http-callbacks.js";
import { claimPanels, dossierView, permissionPanel } from "./memory-claims.js";
import { memoryModelsPanel } from "./memory-models.js";
import { outcomesPanel } from "./memory-outcomes.js";
import { metricsPanel } from "./memory-metrics.js";
import { projectWords, sessionWords } from "../lib/format.js";
import { learnsWith } from "../lib/claims.js";
import { teamsOn } from "../lib/teams-on.js";
import { WITHOUT_ENGINE, OTHER_ENGINE_WORDS, RESTART_WORDS, installWords, otherEngine, restartEngine, stallWords, uninstallWords } from "../lib/engine.js";

/**
 * A memory tab's body: the off state; why the archive is not open, in its own words (a file another build wrote says
 * how to start over where Filament runs), else where to look; or, once the status is known, what `build(status)` makes.
 * @param {(st: any) => any} build @param {string} [what]
 */
export function memGate(build, what = "this page") {
  const { h, memStatus, memOffPanel } = ui;
  const box = h("div", {}, h("p", { class: "muted small" }, "checking memory…"));
  memStatus()
    .then((/** @type {any} */ st) => {
      if (!st.enabled) return box.replaceChildren(memOffPanel(what));
      if (!st.archive) {
        const why = st.archiveError || `Check the memory folder (${st.folder || "?"}) under Settings and the server log.`;
        return box.replaceChildren(h("section", { class: "panel" }, h("div", { class: "empty" }, h("b", {}, "The archive could not be opened"), h("span", { class: "small" }, why))));
      }
      box.replaceChildren(build(st));
    })
    .catch((/** @type {any} */ e) => box.replaceChildren(h("p", { class: "err" }, e.message)));
  return box;
}

export function memory() {
  const {
    state, render, go, goto, toast, api,
    intro, empty, schemaForm, markDirty, setReqFilter, REQ_FILTER_DEFAULTS,
    HOME_PANES, HUBS, PAGES, copyline, secretLine, upLabel,
    upDisplay, removeUpstream, routeMeaning, routeTester,
    modelCatalog, failoverRows, failoverSentence, flowDiagram, cmpTable,
    section, bridgeModes, BRIDGE_HINT, FAIL_CAUSES, STRATEGIES,
    qs, rx, bare, setStatus, loadAll,
    loadSavedAndGo, loadRequests, loadOps, hashFor,
    startLiveTicker, requestsTable, opsTable, mixedTable, liveView, agentsView,
    openRequest, openRulesDrawer, flatten,
    mergedRules, input, idInput, pingResult, memStatus, memAgo,
    memWhen, memBytes, memPrefix, memEnginePill, memKindPill, memLineageSvg,
    memSessionLink, memOffPanel, memGate, memJobPanel, memBackupsPanel, memImportPanel,
    memBackfillControl, memResultsTable, memSummary,
    commandsDoc, memKnewCard, memTimelineCard, memBenchmarkPanels, fmt, h,
    $, store, md, mdDoc, mdBlock, esc,
    setHtml, statusPill, phaseOf,
  } = /** @type {any} */ (ui);


    const box = h("div", {}, h("p", { class: "muted small" }, "checking memory…"));
    const draw = async (opts = {}) => {
      let st; try { st = await memStatus(opts); } catch (/** @type {any} */ e) { box.replaceChildren(h("p", { class: "err" }, e.message)); return; }
      if (!st.enabled) { box.replaceChildren(memOffPanel("the engine, archive and autopilot cards")); return; }
      const e = st.engine || {}, a = st.archive, ap = st.autopilot || {}, bk = st.backups || {}, counts = e.counts || {};
      const other = otherEngine(e);
      const running = (st.jobs || []).find((j) => j.status === "running");
      const jobBox = h("div", {}); if (running) jobBox.append(memJobPanel(running, () => draw({ fresh: true })));
      const startJob = async (path, label) => { try { const { job } = await api(path, { method: "POST", body: {} }); jobBox.replaceChildren(memJobPanel(job, () => draw({ fresh: true }))); for (const b of box.querySelectorAll("button.mem-jobbtn")) b.disabled = true; toast(label); } catch (/** @type {any} */ err) { toast(err.message, "err"); } };
      const probeBtn = h("button", { class: "sm", title: "Ask the engine to answer now; starts it if it is idle", onclick: () => { probeBtn.disabled = true; probeBtn.textContent = "probing…"; draw({ probe: true }); } }, "Probe");
      const actions = h("div", { class: "card-foot" });
      // Install only with the bundle that came with Filament here: without it, the card says why there is nothing to install.
      if ((!e.installed || other) && e.bundle?.ready) actions.append(h("button", { class: `${e.installed ? "sm" : "primary"} mem-jobbtn`, disabled: running ? "" : null, onclick: () => startJob("/memory/install", "Installing the memory engine…") }, e.installed ? "Install this Filament's engine" : "Install memory engine"));
      if (e.installed) actions.append(probeBtn);
      actions.append(h("span", { class: "grow" }), goto("memsettings", "Settings →"));
      const mini = (label, value, sub) => h("div", { class: "mini" }, h("span", { class: "label" }, label), h("b", {}, value), sub ? h("span", { class: "muted small" }, sub) : null);
      const kv = (...pairs) => h("div", { class: "kv small" }, ...pairs.filter(Boolean).flatMap(([k, v]) => [h("span", {}, k), v && v.nodeType ? v : h("span", {}, v == null || v === "" ? "–" : String(v))]));
      const path = (p) => (p ? h("code", { class: "mem-path", title: p }, p) : h("span", {}, "–"));
      const engineCard = h("section", { class: "card" },
        h("div", { class: "card-head" }, h("h3", {}, "Engine"), memEnginePill(st), h("span", { class: "muted small" }, "Mnemosyne, run by Filament as a child process")),
        !e.installed ? h("p", { class: "small", style: "margin:8px 0 0" }, `Until the engine is installed, ${WITHOUT_ENGINE}. ${installWords(e.bundle)}${e.bundle?.ready ? " With memory on, Filament installs it by itself as it starts, unless memory.engine.autoInstall is off. Nothing else on this machine is touched, and the folder can be deleted and reinstalled at any time." : ""}`) : null,
        other ? h("p", { class: "small", style: "margin:8px 0 0" }, `${OTHER_ENGINE_WORDS} With memory on, Filament does it by itself as it starts, unless memory.engine.autoInstall is off.`) : null,
        e.state === "stopped" && e.installed ? h("p", { class: "muted small", style: "margin:8px 0 0" }, "Installed and idle: the engine starts with the first request that needs it, or when you press Probe.") : null,
        e.lastError ? h("p", { class: "err small", style: "margin:8px 0 0" }, e.lastError) : null,
        e.stalled ? h("p", { class: "warn small", style: "margin:8px 0 0" }, stallWords(e.stalled)) : null,
        e.installed ? h("div", { class: "mem-grid" }, mini("Working", fmt.n(counts.working), "memories, recalled by meaning"), mini("Episodic", fmt.n(counts.episodic), "the engine's own summaries, never served"), mini("Facts", fmt.n(counts.triples), "knowledge graph")) : null,
        kv(["version", e.version || null], e.installed && e.source ? ["installed from", e.source === "bundle" ? (e.bundle?.current ? "the copy that came with this Filament" : "a copy that came with Filament") : "a download"] : null, ["embeddings", e.embeddings == null ? "unknown until the engine answers" : e.embeddings ? "on · recall by meaning" : "off · keyword recall"], e.python ? ["python", e.python] : null, ["last memory", counts.lastMemory ? memWhen(counts.lastMemory) : "–"], ["engine calls", `${fmt.n(e.calls)}${e.pid ? ` · pid ${e.pid}` : ""}`], ["engine folder", path(e.dir)], e.dbPath ? ["database", path(e.dbPath)] : null),
        jobBox, actions);
      const archiveCard = h("section", { class: "card" },
        h("div", { class: "card-head" }, h("h3", {}, "Archive"), a ? h("span", { class: `pill ${st.folderExists ? "ok" : "warn"}` }, st.folderExists ? "on disk" : "folder missing") : h("span", { class: "pill err" }, "not open"), h("span", { class: "muted small" }, st.manifest?.encrypted === false ? "message bodies stored in plain text" : "message bodies encrypted at rest")),
        a ? h("div", { class: "mem-grid" }, mini("Sessions", fmt.n(a.chains), `${fmt.n(a.projects)} project${a.projects === 1 ? "" : "s"}`), mini("Turns", fmt.n(a.turns), `${fmt.n(a.compactions)} compaction${a.compactions === 1 ? "" : "s"}`), mini("Messages", a.counting ? "counting…" : fmt.n(a.messages), a.counting ? "counted once, in the background" : memBytes(a.bytes)), mini("Memories", fmt.n(a.items), "every claim, retired ones too: under Memories"), mini("Injections", fmt.n(a.injections), "listed under Activity"), mini("Summary slices", fmt.n(a.trimSlices), "cached summaries: a second summary of the same text is free")) : h("p", { class: "err small", style: "margin:8px 0 0" }, st.archiveError || "The archive could not be opened. Check the folder below and the server log."),
        kv(["folder", path(st.folder)], ["created", st.manifest?.createdAt ? memWhen(st.manifest.createdAt) : null], st.manifest?.deviceId ? ["device", st.manifest.deviceId] : null),
        a && (a.chains || 0) < 3 ? h("div", { class: "alert", style: "margin-top:10px" }, h("span", {}, h("b", {}, "Import past sessions. "), "Claude Code and Hermes Mnemosyne histories on this machine can be brought in, so memory starts from what you already did."), goto("memsettings", "Import →", "import")) : null,
        h("div", { class: "card-foot" }, goto("sessions", "Sessions →"), goto("memories", "Memories →"), goto("activity", "Activity →")));
      const on = ap.enabled !== false;
      const autopilotCard = h("section", { class: "card" },
        h("div", { class: "card-head" }, h("h3", {}, "Autopilot"), h("span", { class: `pill ${on ? "ok" : ""}` }, on ? ap.mode || "conservative" : "off"), h("span", { class: "muted small" }, on ? "runs on every request without you typing anything" : "archive only: nothing is added to requests")),
        kv(["briefing budget", `${fmt.n(ap.briefingTokens ?? 1200)} tokens, once per session, cache-stable`], ["per-turn budget", `${fmt.n(ap.turnTokens ?? 300)} tokens on the newest message`], ["score floor", String(ap.minScore ?? 0.2)], ["memory tools", ap.tools === false ? "off" : `on · up to ${fmt.n(ap.toolIterations ?? 4)} rounds per request`], ["visible cue", ap.cue === false ? "off" : "one line on a session's first reply"], ["query rewrite", ap.rewrite === true ? "on · when the message's own words find little; waited for, a failed one leaves them" : "off"], ["memory's model", (() => { const lw = learnsWith(st.models); return lw.model ? h("span", {}, h("code", {}, lw.model), lw.chosen ? " · not set: each chat's own, this where none is named" : null) : h("span", { class: lw.off ? "" : "warn" }, `none: ${lw.why}`); })()]),
        h("div", { class: "card-foot" }, h("span", { class: "muted" }, "Titles, end states and learned facts use memory's model; its cost shows in Usage."), h("span", { class: "grow" }), goto("memsettings", "Change →")));
      const hasDest = bk.enabled && bk.folder;
      const backupsCard = h("section", { class: "card" },
        h("div", { class: "card-head" }, h("h3", {}, "Backups"), h("span", { class: `pill ${hasDest ? "ok" : "warn"}` }, hasDest ? "daily" : bk.enabled ? "no destination" : "off")),
        hasDest ? kv(["destination", path(bk.folder)], ["when", `daily at ${String(bk.hour ?? 3).padStart(2, "0")}:00 · keep ${fmt.n(bk.keep ?? 14)}`]) : h("div", { class: "alert warn", style: "margin-top:8px" }, h("span", {}, h("b", {}, "No backup destination yet. "), "The memory folder holds every archived conversation and everything learned. Point backups at a Google Drive for Desktop or OneDrive folder so a disk failure does not take it with it."), goto("memsettings", "Set up →", "backups")),
        bk.folder ? h("div", { style: "margin-top:10px" }, memBackupsPanel({ compact: true })) : null,
        h("div", { class: "card-foot" }, h("span", { class: "muted" }, "A consistent copy of archive.db, the Mnemosyne database and memory.json, gzipped with checksums."), h("span", { class: "grow" }), goto("memsettings", "All backups →", "backups")));
      const strip = h("div", { class: "mem-strip" }, h("span", { class: "muted small" }, "loading…"));
      api("/memory/activity?limit=200").then(({ activity }) => {
        const day = Date.now() - 86400000; const recent = (activity || []).filter((x) => (x.created_at || 0) >= day);
        const n = (k) => recent.filter((x) => x.kind === k).length;
        const used = recent.filter((x) => x.used === true).length, unused = recent.filter((x) => x.used === false).length;
        const tok = recent.reduce((s, x) => s + (x.tokens || 0), 0);
        strip.replaceChildren(mini("Briefings", fmt.n(n("briefing")), "once per new session"), mini("Turn blocks", fmt.n(n("turn")), "attached to your messages"), mini("Tool calls", fmt.n(n("tool")), "the model asked memory"), mini("Tokens added", fmt.n(tok), "across those requests"), mini("Picked up", recent.length ? `${fmt.n(used)} / ${fmt.n(used + unused)}` : "–", recent.length ? `${fmt.n(recent.length - used - unused)} not judged yet` : "nothing injected in 24 h"));
      }).catch((err) => strip.replaceChildren(h("span", { class: "err small" }, err.message)));
      box.replaceChildren(h("div", { class: "mem-cards" }, engineCard, archiveCard, autopilotCard, backupsCard), h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, "What changed · last 24 hours"), st.learning?.pending ? h("span", { class: "pill warn", title: "Sessions idle since their last turn; the cheap model distils each once it has been quiet for the configured minutes" }, `${fmt.n(st.learning.pending)} waiting to learn`) : null, goto("activity", "Every injection →")), h("p", { class: "muted small", style: "margin:0 0 10px" }, "Memory's own model calls — learning, summary slices, recall rewrites, the engine — and everything Filament did around them now live in ", h("a", { href: "#requests", onclick: (e) => { e.preventDefault(); setReqFilter({ tab: "memory" }); go("requests"); } }, "Traffic → Memory"), " and ", h("a", { href: "#requests", onclick: (e) => { e.preventDefault(); setReqFilter({ tab: "system" }); go("requests"); } }, "Traffic → System"), ". This page keeps what memory holds; Traffic keeps what Filament did."), strip), outcomesPanel((state.memOutcomes ||= {})));
      // The archive's messages counted in the background: read again while this page shows, until they are.
      if (a?.counting) setTimeout(() => { if (box.isConnected) draw({ fresh: true }); }, 3000);
    };
    draw();
    const p = memPrefix();
    return h("div", {},
      intro("memory",
        h("p", {}, h("b", {}, "One memory for every model and every client."), " Filament keeps a byte-exact ", h("b", {}, "archive"), " of your conversations (SQLite, encrypted), runs ", h("b", {}, "Mnemosyne"), " as its own child process to hold what was learned, and a ", h("b", {}, "brain"), " decides on every request what to add: one stable briefing per session in the system prompt, a small block on the newest message when something related exists, and the ", h("code", {}, "filament_memory_*"), " tools so the model can search, load a past session, remember and forget by itself. Filament runs those calls and asks the model again before your client sees anything."),
        h("ul", { class: "small" },
          h("li", {}, h("b", {}, "Autopilot first"), ": nothing to type. Conservative by default: inject nothing when unsure, at most a few items per turn, items that are never picked up fade out."),
          h("li", {}, h("b", {}, "Commands"), ": type ", h("code", {}, `${p} help`), " in any chat. ", h("code", {}, `${p} sessions <words>`), " finds past sessions by what you typed, ", h("code", {}, `${p} load <id>`), " attaches one to your next message, ", h("code", {}, `${p} remember <text>`), " stores a fact, ", h("code", {}, `${p} off`), " mutes this chat."),
          h("li", {}, h("b", {}, "Learning"), ": what you tell the agent to keep, it keeps with its memory tools as you say it — your own words when it quotes you; titles, end states, facts, rules and decisions are extracted by memory's model at session boundaries. Everything learned starts as ", h("i", {}, "inferred"), " until you confirm it on the Memories tab."),
          h("li", {}, h("b", {}, "Privacy"), ": memory content goes only into the prompt of the request it belongs to. Request records, logs and the Activity tab carry counts and ids, never text. A client can send ", h("code", {}, "x-filament-memory: off"), "; excluded clients, models and folders never get memory."))),
      box);
}

export function memories() {
  const {
    state, render, go, goto, toast, api,
    intro, empty, schemaForm, markDirty, setReqFilter, REQ_FILTER_DEFAULTS,
    HOME_PANES, HUBS, PAGES, copyline, secretLine, upLabel,
    upDisplay, removeUpstream, routeMeaning, routeTester,
    modelCatalog, failoverRows, failoverSentence, flowDiagram, cmpTable,
    section, bridgeModes, BRIDGE_HINT, FAIL_CAUSES, STRATEGIES,
    qs, rx, bare, loadAll, loadSavedAndGo,
    loadRequests, loadOps, hashFor, startLiveTicker,
    requestsTable, opsTable, mixedTable, liveView, agentsView,
    openRequest, openRulesDrawer, flatten, mergedRules,
    input, idInput, pingResult, memStatus, memAgo, memWhen,
    memBytes, memPrefix, memEnginePill, memKindPill, memLineageSvg, memSessionLink,
    memOffPanel, memGate, memJobPanel, memBackupsPanel, memImportPanel, memBackfillControl,
    memResultsTable, memSummary, commandsDoc,
    memKnewCard, memTimelineCard, memBenchmarkPanels, fmt, h, store,
    md, mdDoc, mdBlock, esc, setHtml, statusPill,
    phaseOf,
  } = /** @type {any} */ (ui);


    const S = (state.memUi ||= { q: "" });
    return h("div", {},
      intro("memories",
        h("p", {}, "Memory is a set of ", h("b", {}, "claims"), ": a rule, a preference, a decision, a fact, how to do something, an open thread. Each is one thing held true about you or a project, with who said it, how many sessions backed it and how sure memory is of it. Recall serves the ones that stand, and you have the last word on every one of them under ", h("b", {}, "Memories"), " below. Each project's dossier, the page its new sessions open with, is written from them by the curator (Projects)."),
        h("p", { class: "small" }, "The engine (Mnemosyne) keeps a copy of each claim for recall by meaning. ", h("b", {}, "Identity facts"), " are its fixed slots; the first six join every briefing. Retiring a claim keeps it as history, and Restore brings it back.")),
      memGate((st) => {
        const engineUp = !!st.engine?.installed;
        // ---- the claims and memory's questions (M6-6), made first so a Remember reads them again ----
        const claims = claimPanels((state.memClaims ||= {}));
        // ---- search ----
        const q = h("input", { type: "search", class: "grow", placeholder: "what should the model know? e.g. tray restart, tabs or spaces, the sqlite decision", value: S.q });
        const out = h("div", { class: "mem-out" }, h("p", { class: "muted small", style: "margin:0" }, "Results come from the claims, the engine's copies of them and the archive (matching turns). A session result links to the Sessions tab."));
        const run = async () => { S.q = q.value.trim(); if (!S.q) return; out.replaceChildren(h("span", { class: "muted small" }, "recalling…")); try { const { results } = await api("/memory/recall", { method: "POST", body: { query: S.q, limit: 20 } }); out.replaceChildren(results.length ? memResultsTable(results) : empty("Nothing recalled", engineUp ? "Try other words. Recall matches meaning when embeddings are on and keywords otherwise." : "The engine is not installed, so only the claims and archived turns can match. Install it on the Overview.")); } catch (/** @type {any} */ e) { out.replaceChildren(h("p", { class: "err small" }, e.message)); } };
        q.onkeydown = (e) => { if (e.key === "Enter") run(); };
        if (S.q) run();
        const searchPanel = h("section", { class: "panel" }, h("h2", {}, "Search memory"), h("div", { class: "row", style: "margin:0 0 10px;align-items:center" }, q, h("button", { class: "primary", onclick: run }, "Search")), out);
        // ---- remember ----
        const note = h("textarea", { rows: 2, placeholder: "something every model should know from now on, e.g. “I write TypeScript with tabs and no semicolons”" });
        const kind = h("select", {}, ...[["fact", "fact · something true about you or your work"], ["rule", "rule · always or never do this"], ["preference", "preference · how you like things"], ["decision", "decision · what was chosen and why"], ["procedure", "how to · the steps that do something"]].map(([v, l]) => h("option", { value: v }, l)));
        const noteOut = h("span", { class: "small muted" });
        // Where it holds: everywhere, or one project (the harness's Add on a workspace does the same, M6-D3).
        const where = h("select", { title: "Everywhere, or only in one project's sessions" }, h("option", { value: "" }, "everywhere"));
        const fillWhere = () => where.replaceChildren(h("option", { value: "" }, "everywhere"), ...[...(state.memProjects || new Map())].map(([id, name]) => h("option", { value: id }, name)));
        if (state.memProjects) fillWhere(); else api("/memory/projects").then((p) => { state.memProjects = new Map((p.projects || []).map((x) => [x.id, x.name || x.id])); fillWhere(); }).catch(() => {});
        const rememberBtn = h("button", { class: "primary", onclick: async () => { const t = note.value.trim(); if (!t) return; rememberBtn.disabled = true; noteOut.textContent = "storing…"; try { const r = await api("/memory/remember", { method: "POST", body: { text: t, kind: kind.value, ...(where.value ? { project: where.value } : {}) } }); noteOut.replaceChildren("Stored as your word: a confirmed ", h("b", {}, kind.value), where.value ? ` in ${state.memProjects?.get(where.value) || where.value}` : " everywhere", r.id ? h("span", {}, " · id ", h("code", {}, String(r.id))) : " (archive only: the engine did not answer)"); note.value = ""; void claims.reload(); } catch (/** @type {any} */ e) { noteOut.textContent = e.message; } rememberBtn.disabled = false; } }, "Remember this");
        const rememberPanel = h("section", { class: "card" }, h("h3", {}, "Remember something"), h("p", { class: "muted small" }, "Stored as your word: a confirmed claim, with its copy in the engine. Rules and preferences open every briefing where they hold; facts and decisions are recalled when relevant. A how-to reads “How to <goal>: 1. <step> 2. <step>”."), note, h("div", { class: "row", style: "margin:8px 0 0;align-items:flex-end;gap:10px" }, h("label", { class: "grow" }, "kind ", kind), h("label", {}, "where ", where), rememberBtn), h("div", { style: "margin-top:6px;min-height:18px" }, noteOut));
        // ---- maintenance ----
        const mOut = h("div", { class: "mem-out" });
        const runM = async (label, path, body) => { mOut.replaceChildren(h("span", { class: "muted small" }, `${label}… this can take a while on a large database.`)); try { const r = await api(path, { method: "POST", body }); mOut.replaceChildren(h("p", { class: "small", style: "margin:0 0 6px" }, h("b", {}, label), " finished."), memSummary(r)); state.memStatus = null; } catch (/** @type {any} */ e) { mOut.replaceChildren(h("p", { class: "err small" }, e.message)); } };
        const maintPanel = h("section", { class: "card" }, h("h3", {}, "Maintenance"), h("p", { class: "muted small" }, "On the engine's own database: Hygiene audit lists stale or noisy rows without changing anything. Diagnose checks the database, the embeddings and the vector index. Rebuild embeddings re-encodes every memory, needed after switching the embeddings setting. Tidying the claims themselves (merging what says the same, re-checking what changed, writing the dossiers) is the curator's: Rewrite now on a project, or ", h("code", {}, `${memPrefix()} curate`), " in a chat."),
          h("div", { class: "row", style: "margin:0 0 6px" }, h("button", { onclick: () => runM("Hygiene audit", "/memory/hygiene", { action: "audit", limit: 200 }) }, "Hygiene audit"), h("button", { onclick: () => runM("Diagnose", "/memory/diagnose", {}) }, "Diagnose"), h("button", { title: "Re-encode every memory with the current embedding model; can take minutes on a large database", onclick: () => { if (confirm("Rebuild the embeddings of every memory now? Recall answers from keywords until it finishes.")) runM("Rebuild embeddings", "/memory/reindex", {}); } }, "Rebuild embeddings")),
          engineUp ? null : h("p", { class: "warn small", style: "margin:0" }, "These need the engine. ", goto("memory", "Install it on the Overview.")), mOut);
        // ---- identity facts: the user's facts that hold in every project (the memory plan's f5) ----
        const canonBox = h("div", {}, h("span", { class: "muted small" }, "loading…"));
        const cName = h("input", { type: "text", placeholder: "name, e.g. name, editor, language" });
        const cBody = h("input", { type: "text", placeholder: "the fact itself, one or two sentences" });
        const addCanon = async () => { const name = cName.value.trim(), body = cBody.value.trim(); if (!name || !body) return toast("A name and the fact are both needed", "err"); try { await api("/memory/identity", { method: "POST", body: { name, body } }); cName.value = ""; cBody.value = ""; toast("Identity fact saved"); loadCanon(); } catch (/** @type {any} */ e) { toast(e.message, "err"); } };
        const loadCanon = () => api("/memory/identity").then(({ identity }) => {
          const rows = (identity || []).filter((r) => r);
          if (!rows.length) return canonBox.replaceChildren(empty("No identity facts yet", "Add your name, how you like answers written, and the tools you use. The first six join every briefing."));
          canonBox.replaceChildren(h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, ...["name", "fact", "memory", ""].map((t) => h("th", {}, t)))), h("tbody", {}, ...rows.map((r) => { const tr = h("tr", {}, h("td", {}, h("b", {}, String(r.name ?? ""))), h("td", { class: "mem-text" }, String(r.body ?? "")), h("td", { class: "muted" }, h("code", {}, String(r.id ?? "")), ` ${String(r.trust ?? "")}`), h("td", { class: "acts" }, h("button", { class: "sm ghost danger", title: "Retire this fact about you, in every project", onclick: async (e) => { if (!confirm(`Delete the identity fact “${r.name}”?`)) return; e.target.disabled = true; try { await api("/memory/identity", { method: "DELETE", body: { id: r.id } }); tr.remove(); toast("Deleted"); } catch (/** @type {any} */ err) { e.target.disabled = false; toast(err.message, "err"); } } }, "Delete"))); return tr; })))));
        }).catch((e) => canonBox.replaceChildren(h("p", { class: "err small" }, e.message)));
        loadCanon();
        const canonPanel = h("section", { class: "panel" }, h("h2", {}, "Identity facts"), h("p", { class: "muted small" }, "Facts about you that hold in every project, each a memory of your own word (the harness's Library › Memory › Everywhere): the first six join every briefing after your rules — your name, how you like answers written, the tools you use. What a project learned about you comes here once you keep it everywhere: memory asks."), canonBox,
          h("div", { class: "row", style: "margin:12px 0 0;align-items:flex-end" }, h("label", {}, "name ", cName), h("label", { class: "grow" }, "fact ", cBody), h("button", { onclick: addCanon }, "Add")));
        return h("div", {}, ...claims.panels, searchPanel, h("div", { class: "cards two" }, rememberPanel, maintPanel), canonPanel, permissionPanel(S));
      }, "memories, search and remembering"));

}
export function projects() {
  const {
    state, render, go, goto, toast, api,
    intro, empty, schemaForm, markDirty, setReqFilter, REQ_FILTER_DEFAULTS,
    HOME_PANES, HUBS, PAGES, copyline, secretLine, upLabel,
    upDisplay, removeUpstream, routeMeaning, routeTester,
    modelCatalog, failoverRows, failoverSentence, flowDiagram, cmpTable,
    section, bridgeModes, BRIDGE_HINT, FAIL_CAUSES, STRATEGIES,
    qs, rx, bare, setStatus, loadAll,
    loadSavedAndGo, loadRequests, loadOps, hashFor,
    startLiveTicker, requestsTable, opsTable, mixedTable, liveView, agentsView,
    openRequest, openRulesDrawer, flatten,
    mergedRules, input, idInput, pingResult, memStatus, memAgo,
    memWhen, memBytes, memPrefix, memEnginePill, memKindPill, memLineageSvg,
    memSessionLink, memOffPanel, memGate, memJobPanel, memBackupsPanel, memImportPanel,
    memBackfillControl, memResultsTable, memSummary,
    commandsDoc, memKnewCard, memTimelineCard, memBenchmarkPanels, fmt, h,
    $, store, md, mdDoc, mdBlock, esc,
    setHtml, statusPill, phaseOf,
  } = /** @type {any} */ (ui);


    const box = h("div", {}, h("span", { class: "muted small" }, "loading…"));
    const draw = async () => {
      let ps; try { ps = (await api("/memory/projects")).projects || []; } catch (/** @type {any} */ e) { return box.replaceChildren(h("p", { class: "err" }, e.message)); }
      // How many claims stand in each, as the Memories tab counts them (its "where" list).
      const standing = new Map(); try { for (const s of (await api("/memory/claims/scopes")).scopes || []) standing.set(s.project, s.claims || 0); } catch {}
      if (!ps.length) return box.replaceChildren(empty("No projects yet", "A project appears the first time a chat names a working folder (system prompt, header or agent cwd)."));
      const mini = (label, value, sub) => h("div", { class: "mini" }, h("span", { class: "label" }, label), h("b", {}, value), sub ? h("span", { class: "muted small" }, sub) : null);
      box.replaceChildren(h("div", { class: "mem-cards" }, ...ps.map((p) => {
        return h("section", { class: "card" },
          h("div", { class: "card-head" }, h("h3", {}, p.name || "(no folder)"), h("span", { class: "pill" }, `${fmt.n(p.chains)} session${p.chains === 1 ? "" : "s"}`)),
          h("code", { class: "mem-path", title: p.cwd || "" }, p.cwd || "chats that named no working folder"),
          h("div", { class: "mem-grid" }, mini("Turns", fmt.n(p.turns)), mini("Memories", fmt.n(standing.has(p.id) ? standing.get(p.id) : p.items), "standing claims"), mini("Last activity", memAgo(p.last_seen))),
          h("div", { style: "margin:8px 0 0" }, dossierView(p)),
          h("div", { class: "card-foot" }, h("button", { class: "sm", onclick: () => { state.memProj = p.id; state.memProjName = p.name || p.id; go("sessions"); } }, "Sessions →"), h("button", { class: "sm", title: "This project's memories: confirm, correct or retire them", onclick: () => { Object.assign((state.memClaims ||= {}), { scope: p.id, state: "standing", kind: "", q: "" }); go("memories"); } }, "Memories →"), h("button", { class: "sm", title: "The repo's settings (instructions, hooks, privacy)", onclick: () => { state.memProjSet = p.id; drawSettings(p.id); } }, "Settings →"), h("span", { class: "grow" }),
            h("button", { class: "sm ghost danger", title: "Delete this project and every session in it — no undo (your backups apart)", onclick: async () => {
              // Its Space goes with it, as the harness's dialog says (HarnessV4_SpacesPlugins_Plan A5; found by the Hunter
              // on A5: this one never said so).
              const goes = p.id ? await api(`/space/${encodeURIComponent(p.id)}/goes`).then((/** @type {any} */ x) => String(x?.words || "")).catch(() => "") : "";
              if (!confirm(`Delete the project "${p.name || p.id}" for good?\n\nAll ${fmt.n(p.chains)} session${p.chains === 1 ? "" : "s"} under it (${fmt.n(p.turns)} turns), its ${fmt.n(p.items)} memories, its dossier and memory's questions about it go with it.${goes ? ` ${goes}` : ""} The folder and its files stay. Move sessions you want to keep to another project first (Sessions → open one → move). There is no undo apart from your backups.`)) return; api(`/memory/projects/${encodeURIComponent(p.id)}/delete`, { method: "POST" }).then((r) => { toast(`Deleted ${r.name ?? p.id}: ${fmt.n(r.chains)} session${r.chains === 1 ? "" : "s"}, ${fmt.n(r.turns)} turns, ${fmt.n(r.items)} items${r.forgotten ? `, ${fmt.n(r.forgotten)} engine memories forgotten` : ""}`); if (state.memProj === p.id) { state.memProj = null; state.memProjName = null; } state.memProjects = null; draw(); }).catch((e) => toast(e.message, "err")); } }, "Delete project"),
            h("span", { class: "muted small" }, `project id ${p.id}`)));
      })));
    };
    // One project's Settings (D14): the repo knobs through the shared editor in project mode — a project holds no
    // mode (D3).
    const drawSettings = async (projectId) => {
      box.replaceChildren(h("span", { class: "muted small" }, "loading the settings…"));
      let doc;
      try {
        doc = await api(`/projects/${encodeURIComponent(projectId)}/settings`);
      } catch (/** @type {any} */ e) {
        return box.replaceChildren(h("p", { class: "err" }, e.message), h("button", { class: "sm", onclick: () => { state.memProjSet = null; draw(); } }, "← all projects"));
      }
      if (state.memProjSet !== projectId) return;
      const cb = projectEditorCallbacks({ projectId, reload: () => drawSettings(projectId), toast });
      box.replaceChildren(
        h("section", { class: "panel" },
          h("div", { class: "row", style: "margin:0 0 8px;align-items:center" },
            h("button", { class: "sm ghost", onclick: () => { state.memProjSet = null; draw(); } }, "← all projects"),
            h("h2", { style: "margin:0" }, doc.name),
            h("code", { class: "small", title: doc.cwd }, doc.cwd || doc.projectId)),
          h("p", { class: "muted small", style: "margin:0 0 10px" }, "The repo's facts: instruction files, hooks, skills folders, privacy. Every session in the project inherits them; a session may still set its own."),
          settingsEditor({ doc, cb, mode: "project" })));
    };
    if (state.memProjSet) drawSettings(state.memProjSet);
    else draw();
    return h("div", {},
      intro("projects",
        h("p", {}, "Memory groups every session by the folder it happened in — a ", h("b", {}, "project"), ". This page is the bird's-eye view: how much each folder has been worked on, how many memories stand in it, and its ", h("b", {}, "dossier"), ": the page every new session there opens with, written by the curator from the project's memories. A dossier is edited through the memories it cites: open one from its line, confirm, correct or retire it, and the line follows. ", h("b", {}, "Rewrite now"), " asks the curator for a pass at once; it also runs on its own after learning, and nightly."),
        h("p", { class: "small" }, "The id under each card is the project key used in memories and briefings; Sessions and Memories open on one project from here.")),
      box);

}
export function sessions() {
  const {
    state, render, go, goto, toast, api,
    intro, empty, schemaForm, markDirty, setReqFilter, REQ_FILTER_DEFAULTS,
    HOME_PANES, HUBS, PAGES, copyline, secretLine, upLabel,
    upDisplay, removeUpstream, routeMeaning, routeTester,
    modelCatalog, failoverRows, failoverSentence, flowDiagram, cmpTable,
    section, bridgeModes, BRIDGE_HINT, FAIL_CAUSES, STRATEGIES,
    qs, rx, bare, setStatus, loadAll,
    loadSavedAndGo, loadRequests, loadOps, hashFor,
    startLiveTicker, requestsTable, opsTable, mixedTable, liveView, agentsView,
    openRequest, openRulesDrawer, flatten,
    mergedRules, input, idInput, pingResult, memStatus, memAgo,
    memWhen, memBytes, memPrefix, memEnginePill, memKindPill, memLineageSvg,
    memSessionLink, memOffPanel, memGate, memJobPanel, memBackupsPanel, memImportPanel,
    memBackfillControl, memResultsTable, memSummary,
    commandsDoc, memKnewCard, memTimelineCard, memBenchmarkPanels, fmt, h,
    store, mdDoc, mdBlock, esc, setHtml, statusPill,
    phaseOf,
  } = /** @type {any} */ (ui);


    const S = (state.memSess ||= { q: "", view: "chat", panel: "transcript" });
    return h("div", {},
      intro("sessions",
        h("p", {}, "Every conversation that passed through Filament with memory on is a ", h("b", {}, "session"), ": your messages and the model's answers byte for byte, plus the tool work in between, encrypted in the archive. Sessions are found by what ", h("i", {}, "you"), " typed, not by what the model said in passing."),
        h("h4", {}, "Loading a session into a chat"),
        h("p", { class: "small" }, "Open a session, pick a view, and copy its command, for example ", h("code", {}, `${memPrefix()} load a1b2c3d4 summary`), ". Type it into any chat, whichever client or model: Filament answers the command itself, and attaches the rendered session to your ", h("b", {}, "next"), " message so the model reads it as context. ", h("b", {}, "chat"), " is your messages and the final answers; ", h("b", {}, "summary"), " one line per turn; ", h("b", {}, "full"), " everything including tool calls; ", h("b", {}, "compact"), " the last compaction summary and the turns after it. The autopilot also names related sessions in the first reply of a new chat so you can load one by id.")),
      memGate((st) => {
        const q = h("input", { type: "search", class: "grow", placeholder: "words you typed in a past chat, e.g. tray restart, migrate 9router", value: S.q });
        const listBox = h("div", { class: "mem-list" }, h("span", { class: "muted small" }, "loading…"));
        const detail = h("div", {}, h("span", { class: "muted small" }, "loading…"));
        let rows = [];
        const select = (id) => { state.memSel = id; history.replaceState(null, "", hashFor()); for (const b of listBox.querySelectorAll(".mem-item")) b.classList.toggle("on", b.dataset.id === id); loadDetail(); };
        const drawList = () => {
          if (!rows.length) return listBox.replaceChildren(empty(S.q ? "No session matches" : "No sessions yet", S.q ? "Search looks at what you typed and at the final answers, capped at a few thousand characters per message." : "Sessions appear after the first chat request with memory on."));
          listBox.replaceChildren(...rows.map((s) => h("button", { class: `mem-item ${s.id === state.memSel ? "on" : ""}`, "data-id": s.id, onclick: () => select(s.id) },
            h("b", {}, sessionWords(s)),
            h("span", { class: "meta" }, h("code", {}, s.id), h("span", {}, s.when || "–"), s.client ? h("span", {}, s.client) : null, h("span", {}, `${fmt.n(s.turns)} turn${s.turns === 1 ? "" : "s"}`),
              s.learned?.error ? h("span", { class: "pill err", title: `the last learn pass failed: ${s.learned.error}` }, "learn failed") : (s.learned || s.state) ? h("span", { class: "pill ok", title: `memory's model has been through this session${s.learned?.at ? ` (last pass ${memAgo(s.learned.at)})` : ""}${s.learned?.skipped ? ` — ${s.learned.skipped}` : ""}` }, s.items ? `learned · ${fmt.n(s.items)} item${s.items === 1 ? "" : "s"}` : "learned") : h("span", { class: "pill warn", title: "the cheap model distils a session once it has been idle for the configured quiet minutes — or press Learn now inside it" }, "waiting"),
              s.open?.length ? h("span", { class: "pill warn" }, `${s.open.length} open`) : null),
            s.state ? h("span", { class: "snip" }, s.state) : null,
            ...(s.matches || []).map((m) => h("span", { class: "snip" }, h("span", { class: "muted" }, `turn ${m.n}: `), String(m.snippet ?? ""))))));
        };
        const loadList = async () => {
          listBox.replaceChildren(h("span", { class: "muted small" }, "searching…"));
          // The management page sees every conversation that was somebody's — imported sub-agent transcripts too;
          // only Filament's own round chains stay out.
          try { rows = (await api(`/memory/sessions?q=${encodeURIComponent(S.q)}&limit=40&kind=interactive,fork,subagent${state.memProj ? `&project=${encodeURIComponent(state.memProj)}` : ""}`)).sessions || []; } catch (/** @type {any} */ e) { listBox.replaceChildren(h("p", { class: "err small" }, e.message)); return; }
          if (!state.memSel && rows[0]) state.memSel = rows[0].id;
          drawList(); loadDetail();
        };
        const loadDetail = async () => {
          const id = state.memSel;
          if (!id) { detail.replaceChildren(empty("Pick a session", "Click one on the left to read it and get the command that loads it into a chat.")); return; }
          if (S.panel === "settings") return loadSettingsDetail(id);
          detail.replaceChildren(h("span", { class: "muted small" }, "loading…"));
          let d; try { d = await api(`/memory/sessions/${encodeURIComponent(id)}?view=${encodeURIComponent(S.view)}&budget=8000`); } catch (/** @type {any} */ e) { detail.replaceChildren(empty("Session not found", `${e.message}. It may have been removed, or the id in the link is stale.`)); return; }
          if (state.memSel !== id) return; // the user moved on while this loaded
          const ch = d.chain || {}, stt = ch.state || {}, r = d.rendered || {};
          const viewSeg = h("div", { class: "seg small" }, ...[["chat", "Chat", "your messages and the final answers, verbatim"], ["summary", "Summary", "one line per turn"], ["full", "Full", "every message including tool calls and results, as JSON"], ["compact", "Compact", "the last compaction summary, then the turns after it"]].map(([v, l, t]) => h("button", { class: S.view === v ? "on" : "", title: t, onclick: () => { S.view = v; loadDetail(); } }, l)));
          const panelSeg = h("div", { class: "seg small" }, ...[["transcript", "Transcript", "the archived conversation"], ["settings", "Settings", "every setting this session chooses and its settings history"]].map(([v, l, t]) => h("button", { class: (S.panel || "transcript") === v ? "on" : "", title: t, onclick: () => { S.panel = v; loadDetail(); } }, l)));
          const cmd = `${memPrefix()} load ${id}${S.view !== "chat" ? " " + S.view : ""}`;
          const text = r.text != null ? String(r.text) : r.messages ? JSON.stringify(r.messages, null, 1) : "";
          const pw = projectWords(d.project);
          const kvRows = [["project", h("span", { title: pw.title }, pw.text)], ["client", ch.client], ["model", ch.model], ["started", memWhen(ch.started_at)], ["last activity", memWhen(ch.last_at)], ["turns", fmt.n(ch.turns)], ch.parent_id ? ["continues", memSessionLink(ch.parent_id)] : null, ch.meta?.muted ? ["memory", "muted for this session"] : null].filter(Boolean);
          detail.replaceChildren(h("div", {}, // through h(): null children are dropped, replaceChildren would print them
            h("div", { class: "row", style: "margin:0 0 6px;align-items:center;gap:10px" }, h("h2", { style: "margin:0" }, sessionWords(ch)), copyline(String(ch.id || id)), stt.status ? h("span", { class: `pill ${stt.status === "open" ? "warn" : stt.status === "done" ? "ok" : ""}` }, stt.status) : null,
              h("span", { class: "grow" }),
              h("button", { class: "sm", title: "Run memory's model over this session right now: title, end state and learned facts, even if it is not idle yet. Takes a few seconds; its cost shows in Usage.", onclick: (e) => { const btn = e.currentTarget; btn.disabled = true; const old = btn.textContent; btn.textContent = "learning…"; api(`/memory/learn/${encodeURIComponent(id)}`, { method: "POST" }).then((r) => { toast(r.skipped ? `Nothing to learn (${r.skipped})` : `Learned ${fmt.n(r.items || 0)} new item${(r.items || 0) === 1 ? "" : "s"}${r.dedupedItems ? `, ${fmt.n(r.dedupedItems)} already known` : ""}${r.title ? ", title set" : ""}${r.state ? ", end state written" : ""}`); loadList(); loadDetail(); }).catch((err) => { toast(err.message, "err"); btn.disabled = false; btn.textContent = old; }); } }, "Learn now"),
              (() => { // re-file a session that landed under an accidental working directory
                const projSel = h("select", { class: "sm", title: "Re-file this session under the project it belongs to — for sessions that landed under a wrong working directory" }, h("option", { value: "" }, "move to project…"));
                const fill = () => projSel.replaceChildren(h("option", { value: "" }, "move to project…"), ...[...(state.memProjects || new Map())].filter(([pid]) => pid !== (ch.project_id ?? null)).map(([pid, name]) => h("option", { value: pid }, name)));
                if (state.memProjects) fill(); else api("/memory/projects").then((p) => { state.memProjects = new Map((p.projects || []).map((x) => [x.id, x.name || x.id])); fill(); }).catch(() => {});
                return h("span", { class: "row", style: "gap:6px" }, projSel,
                  h("button", { class: "sm", title: "Move this session and its learned items to the selected project", onclick: () => { if (!projSel.value) return toast("Pick a project first", "err"); api(`/memory/sessions/${encodeURIComponent(id)}/move`, { method: "POST", body: { project: projSel.value } }).then((r) => { toast(`Moved to ${state.memProjects?.get(r.to) || r.to}${r.items ? ` (${fmt.n(r.items)} item${r.items === 1 ? "" : "s"} followed)` : ""}`); loadList(); loadDetail(); }).catch((e) => toast(e.message, "err")); } }, "Move"));
              })(),
              h("button", { class: "sm ghost danger", title: "Delete this session, its turns and everything learned from it — no undo (your backups apart)", onclick: () => { if (!confirm(`Delete this session for good?\n\nIts ${fmt.n(ch.turns ?? 0)} turns, its learned items and its lineage links go with it; message bodies shared with other sessions stay. What the engine learned from it is forgotten there too. There is no undo apart from your backups.`)) return; api(`/memory/sessions/${encodeURIComponent(id)}/delete`, { method: "POST" }).then((r) => { toast(`Deleted: ${fmt.n(r.turns)} turns, ${fmt.n(r.items)} learned item${r.items === 1 ? "" : "s"}${r.forgotten ? `, ${fmt.n(r.forgotten)} engine memories forgotten` : ""}`); state.memSel = null; loadList(); }).catch((e) => toast(e.message, "err")); } }, "Delete")),
            h("div", { class: "kv small" }, .../** @type {any[]} */ (kvRows).flatMap(([k, v]) => [h("span", {}, k), v && v.nodeType ? v : h("span", {}, v == null || v === "" ? "–" : String(v))])),
            h("div", { class: "row", style: "margin:8px 0 0;align-items:center" }, panelSeg, h("span", { class: "muted small" }, "the transcript, or every setting this session runs under")),
            h("h4", { style: "margin:12px 0 4px" }, "Lineage"),
            (() => { const holder = h("div", {}); api(`/memory/sessions/${encodeURIComponent(id)}/lineage`).then((l) => holder.replaceChildren(l && l.nodes?.length > 1 ? h("div", {}, memLineageSvg(l, (nid) => select(nid)), h("p", { class: "muted small", style: "margin:4px 0 0" }, "Ancestors left, later sessions right. Solid edges: continues / child. Dashed: loaded on request. Click a node to open it.")) : h("p", { class: "muted small" }, "A standalone session so far: nothing continues it and it continues nothing."))).catch(() => holder.replaceChildren(h("p", { class: "muted small" }, "Lineage unavailable."))); return holder; })(),
            stt.summary || stt.open?.length || stt.next?.length || stt.done?.length ? h("div", { class: "mem-state small" }, stt.summary ? h("p", {}, String(stt.summary)) : null, ...[["open", "Open"], ["next", "Next"], ["done", "Done"]].map(([k, l]) => (Array.isArray(stt[k]) && stt[k].length ? h("div", {}, h("b", {}, l), h("ul", {}, ...stt[k].map((x) => h("li", {}, String(x))))) : null))) : h("p", { class: "muted small" }, "No end state yet: it is written by the cheap model when the session goes idle or is compacted."),
            h("h4", {}, "Load it into a chat"),
            h("div", { class: "row", style: "margin:0;align-items:center;gap:10px" }, copyline(cmd), h("span", { class: "muted small" }, "Type it in any chat. Filament attaches this session's ", h("b", {}, S.view), " view to your next message and the model sees it."),
              h("button", { class: "sm", title: "Download this session (its metadata, end state and the rendered view) as a Markdown file", onclick: () => {
                const esc2 = (t) => String(t || "").replace(/\]/g, "\\]");
                const md = [`# ${sessionWords(ch)} (${ch.id})`, "", `- project: ${pw.text}${d.project?.cwd ? ` (${d.project.cwd})` : ""} · client: ${ch.client ?? "–"} · model: ${ch.model ?? "–"}`, `- started: ${memWhen(ch.started_at)} · last activity: ${memWhen(ch.last_at)} · turns: ${ch.turns ?? 0}`, stt.summary ? `- end state: ${esc2(stt.summary)}` : null, ...(stt.open || []).map((x) => `- open: ${esc2(x)}`), ...(stt.next || []).map((x) => `- next: ${esc2(x)}`), ...(stt.done || []).map((x) => `- done: ${esc2(x)}`), "", `## ${S.view} view (~${r.tokens ?? "?"} tokens)`, "", text || "(nothing recorded)"].filter((l) => l != null).join("\n");
                const blob = new Blob([md], { type: "text/markdown" }); const a2 = document.createElement("a"); a2.href = URL.createObjectURL(blob); a2.download = `filament-session-${ch.id}-${S.view}.md`; a2.click(); setTimeout(() => URL.revokeObjectURL(a2.href), 2000);
              } }, "Export .md")),
            h("h4", {}, "Rendered"),
            h("div", { class: "row", style: "margin:0 0 8px;align-items:center;gap:10px" }, viewSeg, h("span", { class: "muted small" }, `${fmt.n(r.turns)} of ${fmt.n(r.total)} turn${r.total === 1 ? "" : "s"}${r.dropped ? ` · ${fmt.n(r.dropped)} older dropped for the 8,000-token budget` : ""} · ~${fmt.n(r.tokens)} tokens`)),
            h("pre", { class: "mem-render" }, text || "(nothing to show for this view)"),
            h("h4", {}, `Turns (${fmt.n(d.turns?.length || 0)}) — click a row to open it`),
            d.turns?.length ? h("div", { class: "table-wrap" }, h("table", { class: "small mem-turns" }, h("thead", {}, h("tr", {}, ...["#", "when", "took", "in", "out", "work", "summary"].map((t) => h("th", {}, t)))), h("tbody", {}, ...d.turns.map((t) => {
              const det = h("tr", { class: "mem-expand hidden" }, h("td", { colspan: 7 }, h("span", { class: "muted small" }, "…")));
              const tr = h("tr", { class: "clickable", title: "Open this turn: your message, the work, the final answer" });
              tr.onclick = async () => {
                const open = !det.classList.contains("hidden"); det.classList.toggle("hidden", open); tr.classList.toggle("open", !open);
                if (open || det.dataset.loaded) return;
                try {
                  const t2 = await api(`/memory/turns/${encodeURIComponent(t.id)}`);
                  const part = (label, v) => v ? h("div", { class: "mem-turn-part" }, h("b", {}, label), h("pre", { class: "mem-render small" }, v.preview || `(${v.kind}, ${fmt.n(v.bytes)} bytes${v.truncated ? ", stored truncated" : ""}, no text)`)) : h("div", { class: "mem-turn-part muted small" }, `${label}: none recorded`);
                  det.querySelector("td").replaceChildren(
                    part("You", t2.user), part("Final answer", t2.final),
                    t2.workCount ? h("div", { class: "mem-turn-part" }, h("b", {}, `Work between them (${fmt.n(t2.workCount)} message${t2.workCount === 1 ? "" : "s"}, in order)`), h("ul", { class: "small", style: "margin:4px 0 0" }, ...t2.work.map((w) => h("li", {}, memKindPill(w.kind), " ", h("span", { class: "mono small" }, String(w.preview || `${fmt.n(w.bytes)} bytes`).slice(0, 300)))))) : h("div", { class: "mem-turn-part muted small" }, "No work between the message and the answer."),
                    t2.summary ? h("div", { class: "mem-turn-part" }, h("b", {}, "Learner's one-liner"), h("span", { class: "small" }, ` ${t2.summary}`)) : "");
                  det.dataset.loaded = "1";
                } catch (/** @type {any} */ e) { det.querySelector("td").replaceChildren(h("span", { class: "err small" }, e.message)); }
              };
              tr.append(h("td", { class: "num" }, t.n), h("td", { class: "muted small", style: "white-space:nowrap" }, memWhen(t.startedAt)), h("td", { class: "muted small" }, t.endedAt && t.startedAt ? fmt.ms(t.endedAt - t.startedAt) : "–"), h("td", { class: "num", title: "characters you typed" }, fmt.n(t.inputChars)), h("td", { class: "num", title: "characters in the final answer" }, fmt.n(t.outputChars)), h("td", { class: "num", title: "messages between your message and the final answer: tool calls, results, thinking" }, fmt.n(t.work)), h("td", { class: "mem-text muted small" }, t.summary ? String(t.summary) : "–"));
              const frag = document.createDocumentFragment(); frag.append(tr, det); return frag;
            })))) : h("p", { class: "muted small" }, "No turns recorded."),
            d.compactions?.length ? h("div", {}, h("h4", {}, `Compactions (${fmt.n(d.compactions.length)})`),
              h("ul", { class: "small" }, ...d.compactions.map((cp) => h("li", {}, h("details", {}, h("summary", {}, `${cp.kind || "compaction"} of turns ${cp.from_turn}–${cp.to_turn} · ${memWhen(cp.created_at)}`), cp.text ? h("pre", { class: "mem-render small" }, cp.text) : h("span", { class: "muted small" }, "(no text stored)")))))) : null));
        };
        // The session's Settings (D14): the shared editor in session mode and the settings history — the same
        // surface the harness's setup sheets mount.
        const loadSettingsDetail = async (id) => {
          detail.replaceChildren(h("span", { class: "muted small" }, "loading the settings…"));
          let doc;
          try {
            doc = await api(`/sessions/${encodeURIComponent(id)}/settings`);
          } catch (/** @type {any} */ e) {
            detail.replaceChildren(empty("Settings unavailable", `${e.message}. The session may predate the settings document; its transcript is untouched.`));
            return;
          }
          if (state.memSel !== id) return;
          const historyBox = h("div", {}, h("span", { class: "muted small" }, "reading the history…"));
          const cb = sessionEditorCallbacks({ chainId: id, reload: () => loadSettingsDetail(id), toast });
          const panelSeg = h("div", { class: "seg small" }, ...[["transcript", "Transcript", "the archived conversation"], ["settings", "Settings", "every setting this session chooses and its settings history"]].map(([v, l, t]) => h("button", { class: (S.panel || "transcript") === v ? "on" : "", title: t, onclick: () => { S.panel = v; loadDetail(); } }, l)));
          detail.replaceChildren(h("div", { class: "s-block" },
            h("div", { class: "row", style: "margin:0;align-items:center" }, panelSeg, h("span", { class: "muted small" }, "a change lands on the session's next request and draws a boundary row")),
            h("div", { class: "kv small" },
              h("span", {}, "session"), h("code", {}, id),
              h("span", {}, "document"), h("code", { title: doc.hash }, String(doc.hash || "").slice(0, 8)),
              h("span", {}, "client"), h("span", {}, String(doc.native ? "the harness" : doc.chainId ? "an outside client" : "–")))),
            settingsEditor({ doc, cb, filamentRuns: !!doc.native, teams: teamsOn(state.config) }),
            h("section", { class: "s-block" },
              h("h4", {}, "Settings history"),
              historyBox));
          api(`/sessions/${encodeURIComponent(id)}/settings/history?limit=100`).then((hist) => { if (detail.isConnected) historyBox.replaceChildren(historyList(hist)); }).catch((e) => historyBox.replaceChildren(h("div", { class: "err small" }, e.message)));
        };
        const search = () => { S.q = q.value.trim(); loadList(); };
        q.onkeydown = (e) => { if (e.key === "Enter") search(); };
        loadList();
        return h("div", { class: "mem-split" },
          h("div", {},
            h("div", { class: "row", style: "margin:0 0 10px;align-items:center" }, q, h("button", { class: "primary", onclick: search }, "Search")),
            state.memProj ? h("div", { class: "row", style: "margin:0 0 8px" }, h("span", { class: "pill", title: state.memProj }, `project: ${state.memProjName || state.memProj}`, h("button", { class: "sm ghost", title: "Clear the project filter", onclick: () => { state.memProj = null; state.memProjName = null; render(); } }, "×"), " "), h("span", { class: "muted small" }, "only this project's sessions — ", goto("projects", "all projects →"))) : null,
            listBox),
          h("section", { class: "panel mem-detail-panel" }, detail));
      }, "the session list"));

}
export function activity() {
  const {
    state, render, go, goto, toast, api,
    intro, empty, schemaForm, markDirty, setReqFilter, REQ_FILTER_DEFAULTS,
    HOME_PANES, HUBS, PAGES, copyline, secretLine, upLabel,
    upDisplay, removeUpstream, routeMeaning, routeTester,
    modelCatalog, failoverRows, failoverSentence, flowDiagram, cmpTable,
    section, bridgeModes, BRIDGE_HINT, FAIL_CAUSES, STRATEGIES,
    qs, rx, bare, setStatus, loadAll,
    loadSavedAndGo, loadRequests, loadOps, hashFor,
    startLiveTicker, requestsTable, opsTable, mixedTable, liveView, agentsView,
    openRequest, openRulesDrawer, flatten,
    mergedRules, input, idInput, pingResult, memStatus, memAgo,
    memWhen, memBytes, memPrefix, memEnginePill, memKindPill, memLineageSvg,
    memSessionLink, memOffPanel, memGate, memJobPanel, memBackupsPanel, memImportPanel,
    memBackfillControl, memResultsTable, memSummary,
    commandsDoc, memKnewCard, memTimelineCard, memBenchmarkPanels, fmt, h,
    $, store, md, mdDoc, mdBlock, esc,
    setHtml, statusPill, phaseOf,
  } = /** @type {any} */ (ui);


    return h("div", {},
      intro("activity",
        h("p", {}, "Every time memory changed a request, one line lands here: a ", h("b", {}, "briefing"), " (placed once in a session's system prompt), a ", h("b", {}, "turn block"), " (attached to the newest message), or a ", h("b", {}, "tool call"), " the model made. Only counts and ids are kept, never the text. ", h("b", {}, "Used"), " says whether the work picked the material up: yes when the reply repeats a phrase of an injected item, the turn's tool calls carry a word of it that is rare across memory, the model confirmed it, or its memory search found it again; no when none did; unknown until the turn has been judged. Items that go unused three times running are demoted, which is how the autopilot gets quieter on its own."),
        h("p", {}, h("b", {}, "Memory cost per request"), " is the benchmark: how long memory held each request before the upstream was called, what the engine cost, how much was added and whether it was used. Every request also carries its own ", h("b", {}, "memory timeline"), " (open it from Traffic or from the request links here): each step in order, with reasons and timings, content never included. ", h("b", {}, "Learning runs"), " shows what was extracted from which session. What the cheap model itself cost is on the ", h("b", {}, "LLM usage"), " tab, kept apart from your clients' traffic.")),
      memGate(() => {
        const box = h("section", { class: "panel" }, h("span", { class: "muted small" }, "loading…"));
        const metrics = metricsPanel((state.memMetrics ||= {}));
        const load = () => api("/memory/activity?limit=150").then(({ activity }) => {
          const usedPill = (u) => (u === true ? h("span", { class: "pill ok" }, "yes") : u === false ? h("span", { class: "pill warn" }, "no") : h("span", { class: "pill" }, "unknown"));
          const kindLabel = { briefing: "briefing", turn: "turn block", tool: "tool call" };
          box.replaceChildren(h("div", { class: "row", style: "margin:0 0 10px;align-items:center" }, h("h2", { style: "margin:0" }, `Recent injections (${fmt.n(activity.length)})`), h("span", { class: "grow" }), h("button", { class: "sm", onclick: load }, "Refresh")),
            activity.length ? h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, ...["when", "kind", "request", "session", "turn", "items", "tokens", "used"].map((t) => h("th", {}, t)))), h("tbody", {}, ...activity.map((x) => {
              const ids = x.ids || [];
              const det = h("tr", { class: "mem-expand hidden" }, h("td", { colspan: 8 }, h("span", { class: "muted small" }, "…")));
              const tr = h("tr", {},
                h("td", { class: "muted small", style: "white-space:nowrap", title: memWhen(x.created_at) }, memAgo(x.created_at)),
                h("td", {}, h("span", { class: "pill" }, kindLabel[x.kind] || x.kind || "?")),
                h("td", {}, x.request_id ? h("a", { href: "#requests", class: "golink mono small", title: "Open this request in Traffic (its memory timeline shows every decision)", onclick: (e) => { e.preventDefault(); openRequest(x.request_id).catch((err) => toast(err.message, "err")); } }, String(x.request_id)) : h("span", { class: "muted" }, "–")),
                h("td", {}, memSessionLink(x.chain_id)),
                h("td", { class: "num muted" }, x.turn_id ?? "–"),
                h("td", { class: "num" }, ids.length ? h("button", { class: "sm ghost", title: "Which items these were (fetched from the archive when you open it)", onclick: async () => {
                  const open = !det.classList.contains("hidden"); det.classList.toggle("hidden", open); tr.classList.toggle("open", !open);
                  if (open || det.dataset.loaded) return;
                  det.querySelector("td").replaceChildren(h("span", { class: "muted small" }, "resolving the items…"));
                  try {
                    const { items } = await api("/memory/injection-items", { method: "POST", body: { ids } });
                    det.querySelector("td").replaceChildren(h("ul", { class: "small mem-itemlist" }, ...items.map((it) => h("li", {}, memKindPill(it.kind), " ", it.text ? h("span", {}, String(it.text).slice(0, 240)) : h("span", { class: "muted" }, `(${it.id})`), it.chainId ? h("span", {}, " · from ", memSessionLink(it.chainId)) : null))));
                    det.dataset.loaded = "1";
                  } catch (/** @type {any} */ e) { det.querySelector("td").replaceChildren(h("span", { class: "err small" }, e.message)); }
                } }, `${fmt.n(ids.length)} ▾`) : h("span", { class: "muted" }, "0")),
                h("td", { class: "num" }, x.tokens ? `~${fmt.n(x.tokens)}` : "–"),
                h("td", {}, usedPill(x.used)));
              const frag = document.createDocumentFragment(); frag.append(tr, det); return frag;
            })))) : empty("Nothing injected yet", "The first request that the autopilot enriches shows up here. Briefings appear once a session has something worth telling the model."));
        }).catch((e) => box.replaceChildren(h("p", { class: "err small" }, e.message)));
        load(); return h("div", {}, metrics, memBenchmarkPanels(), box);
      }, "the injection log"));

}
export function memusage() {
  const {
    state, render, go, goto, toast, api,
    intro, empty, schemaForm, markDirty, setReqFilter, REQ_FILTER_DEFAULTS,
    HOME_PANES, HUBS, PAGES, copyline, secretLine, upLabel,
    upDisplay, removeUpstream, routeMeaning, routeTester,
    modelCatalog, failoverRows, failoverSentence, flowDiagram, cmpTable,
    section, bridgeModes, BRIDGE_HINT, FAIL_CAUSES, STRATEGIES,
    rx, bare, setStatus, loadAll, loadSavedAndGo,
    loadRequests, loadOps, hashFor, startLiveTicker,
    requestsTable, opsTable, mixedTable, liveView, agentsView,
    openRequest, openRulesDrawer, flatten, mergedRules,
    input, idInput, pingResult, memStatus, memAgo, memWhen,
    memBytes, memPrefix, memEnginePill, memKindPill, memLineageSvg, memSessionLink,
    memOffPanel, memGate, memJobPanel, memBackupsPanel, memImportPanel, memBackfillControl,
    memResultsTable, memSummary, commandsDoc,
    memKnewCard, memTimelineCard, memBenchmarkPanels, fmt, h, store,
    md, mdDoc, mdBlock, esc, setHtml, statusPill,
    phaseOf,
  } = /** @type {any} */ (ui);


    const U = (state.memUsageFilter ||= { mode: "30d", day: null, from: null, to: null });
    const dayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const today = dayStr(new Date()); const shift = (day, n) => { const [y, m, d] = day.split("-").map(Number); return dayStr(new Date(y, m - 1, d + n)); };
    const nice = (day) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: y === new Date().getFullYear() ? undefined : "numeric" }); };
    const sel = U.mode === "today" ? { from: today, to: today, label: `Today · ${nice(today)}` } : U.mode === "yesterday" ? { from: shift(today, -1), to: shift(today, -1), label: `Yesterday · ${nice(shift(today, -1))}` } : U.mode === "7d" ? { from: shift(today, -6), to: today, label: "Last 7 days" } : U.mode === "30d" ? { from: shift(today, -29), to: today, label: "Last 30 days" } : U.mode === "all" ? { from: null, to: null, label: "All time" } : U.mode === "day" ? { from: U.day, to: U.day, label: U.day === today ? `Today · ${nice(U.day)}` : nice(U.day) } : { from: U.from || null, to: U.to || null, label: `${U.from || "start"} → ${U.to || "today"}` };
    const qs = new URLSearchParams(); if (sel.from) qs.set("from", sel.from); if (sel.to) qs.set("to", sel.to);
    const seg = (items, cur, onpick) => h("div", { class: "seg" }, ...items.map(([v, label]) => h("button", { class: cur === v ? "active" : "", onclick: () => onpick(v) }, label)));
    const quick = seg([["today", "Today"], ["yesterday", "Yesterday"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All time"], ["range", "Custom…"]], U.mode, (v) => { U.mode = v; if (v === "range" && !U.from) { U.from = shift(today, -13); U.to = today; } render(); });
    const range = U.mode === "range" ? h("div", { class: "seg daynav" }, h("input", { type: "date", value: U.from || "", max: today, onchange: (e) => { U.from = e.target.value || null; render(); } }), h("span", { class: "muted small" }, "to"), h("input", { type: "date", value: U.to || "", max: today, onchange: (e) => { U.to = e.target.value || null; render(); } })) : null;
    const csv = h("button", { title: "Every day × purpose × model in the selection", onclick: () => { window.location.href = `/api/memory/usage.csv?${qs}`; } }, "Download CSV");
    const controls = h("div", { class: "usage-controls" }, quick, range, h("span", { class: "grow" }), h("span", { class: "muted small" }, sel.label), csv);
    const stat = (label, value, sub) => h("div", { class: "card stat" }, h("div", { class: "label" }, label), h("div", { class: "big" }, value), sub ? h("div", { class: "sub" }, sub) : null);
    const purposeName = (p) => (p === "learn" ? "learning from a session" : p === "engine" ? "the engine (consolidation, extraction)" : p || "memory");
    const statsBox = h("div", { class: "usage-stats" }, h("span", { class: "muted small" }, "loading…")); const rowsBox = h("div", {}); const daysBox = h("div", {}); const listBox = h("div", {}, h("span", { class: "muted small" }, "loading…"));
    const num = (v, title) => h("td", { class: "num", title: title || null }, v);
    Promise.all([api(`/memory/usage?${qs}`), api("/memory/traffic?limit=200")]).then(([u, tr]) => {
      const t = u.total || {}; state.memRequests = tr.requests || [];
      statsBox.replaceChildren(
        stat("Model calls", fmt.n(t.requests || 0), t.requests ? `${fmt.n(t.ok)} ok · ${fmt.n(t.errors)} failed${t.aborted ? ` · ${fmt.n(t.aborted)} cancelled` : ""}` : "none in this period"),
        stat("Tokens in", fmt.n((t.input || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0)), `${fmt.n(t.input || 0)} fresh · ${fmt.n(t.cacheRead || 0)} from cache · ${fmt.n(t.cacheWrite || 0)} written to cache`),
        stat("Tokens out", fmt.n(t.output || 0), "what memory's model wrote back (titles, states, items)"),
        stat("Cache hit rate", fmt.pct(t.cacheHitRate || 0), "each session's text is new, so this stays low by nature"),
        stat("Average call", t.avgMs != null ? fmt.ms(t.avgMs) : "–", t.avgTtftMs != null ? `first byte after ${fmt.ms(t.avgTtftMs)}` : "end to end"),
        stat("Cost", t.costN ? fmt.usd(t.cost) : "–", t.costN < (t.requests || 0) ? `${fmt.n(t.requests - t.costN)} call(s) without a price` : "from the price cards"));
      const rows = (t.rows || []);
      rowsBox.replaceChildren(h("section", { class: "panel" }, h("h2", { style: "margin:0 0 8px" }, "By purpose and model"),
        rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "small usage-table" }, h("thead", {}, h("tr", {}, h("th", {}, "Purpose"), h("th", {}, "Model"), h("th", {}, "Upstream"), ...["Calls", "Failed", "Input", "Cache read", "Cache write", "Output", "Cache hit", "Avg call", "Cost"].map((x) => h("th", { class: "num" }, x)))),
          h("tbody", {}, ...rows.map((r) => h("tr", {}, h("td", {}, h("span", { class: "pill" }, r.purpose === "learn" ? "learning" : r.purpose === "engine" ? "engine" : r.purpose || "memory"), h("div", { class: "muted small" }, purposeName(r.purpose))), h("td", {}, h("code", {}, r.model)), h("td", {}, r.upstream),
            num(fmt.n(r.requests)), h("td", { class: `num ${r.errors ? "err" : "muted"}` }, fmt.n(r.errors)), num(fmt.n(r.input)), num(fmt.n(r.cacheRead)), num(fmt.n(r.cacheWrite)), num(fmt.n(r.output)), num(fmt.pct(r.cacheHitRate)), num(r.avgMs != null ? fmt.ms(r.avgMs) : "–"), num(r.costN ? fmt.usd(r.cost) : "–")))))) : empty("No model calls in this period", "The cheap model is only called at learning boundaries: a session idle for a while, a compaction, a manual Learn, or a backfill after an import.")));
      const days = (u.days || []);
      daysBox.replaceChildren(h("section", { class: "panel" }, h("h2", { style: "margin:0 0 8px" }, "By day"), h("p", { class: "muted small", style: "margin:0 0 8px" }, "Kept on disk (memory-usage.json), so this survives restarts and log rotation. Click a day to select it."),
        days.length ? h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, h("th", {}, "Day"), ...["Calls", "Failed", "Tokens in", "Tokens out", "Cost", "Purposes"].map((x) => h("th", { class: x === "Purposes" ? "" : "num" }, x)))),
          h("tbody", {}, ...days.map((d) => { const byP = new Map(); for (const r of d.rows || []) byP.set(r.purpose || "memory", (byP.get(r.purpose || "memory") || 0) + r.requests); return h("tr", { style: "cursor:pointer", onclick: () => { U.mode = "day"; U.day = d.day; render(); } }, h("td", {}, d.day === today ? `${d.day} (today)` : d.day), num(fmt.n(d.requests)), h("td", { class: `num ${d.errors ? "err" : "muted"}` }, fmt.n(d.errors)), num(fmt.n(d.input + d.cacheRead + d.cacheWrite)), num(fmt.n(d.output)), num(d.costN ? fmt.usd(d.cost) : "–"), h("td", { class: "small" }, [...byP.entries()].map(([k, n]) => `${k === "learn" ? "learning" : k} ×${n}`).join(", "))); })))) : empty("Nothing recorded yet", "")));
      const list = state.memRequests;
      listBox.replaceChildren(h("section", { class: "panel" }, h("div", { class: "row", style: "margin:0 0 8px;align-items:center" }, h("h2", { style: "margin:0" }, `Recent calls · ${fmt.n(list.length)}`), h("span", { class: "grow" }), h("label", { class: "check" }, (() => { const cb = h("input", { type: "checkbox" }); cb.checked = state.live; cb.onchange = () => (state.live = cb.checked); return cb; })(), "live"), h("button", { class: "sm", onclick: () => render() }, "Refresh")),
        h("p", { class: "muted small", style: "margin:0 0 8px" }, "The same record a client request gets: click one for tokens, timing, the body sent and its trace. The session a learning call read from is on its record as memoryFor.chain."),
        list.length ? requestsTable(list.slice(0, 200), { dividers: true }) : empty("No calls since Filament started", "Learning runs when a session has been idle for a while; nothing has needed memory's model yet.")));
    }).catch((e) => statsBox.replaceChildren(h("p", { class: "err small" }, e.message)));
    return h("div", {},
      intro("memusage",
        h("p", {}, "Memory sometimes calls a model: ", h("b", {}, "memory's model"), " — the one set under Memory → Settings, else each chat's compaction model, else the chat's own, at low effort — reads a finished session and writes back a title, an end state and durable items (learning), and the engine may call it to consolidate. Those calls are ", h("b", {}, "never made on a client message"), ": the autopilot's lookups are embedding and keyword searches, and captures are pattern-based, so a message through Filament costs no extra model call."),
        h("p", {}, "They happen at learning boundaries only: a session idle for the configured minutes (30 by default), a compaction, a manual Learn on the Sessions page, a backfill after an import (one call per imported session, once), and the engine's nightly consolidation. Each call is also one row in Traffic → Memory; Usage counts your clients' traffic unless its scope toggle includes these.")),
      controls, statsBox, rowsBox, daysBox, listBox);

}
export function memsettings() {
  const {
    state, render, go, goto, toast, api,
    intro, empty, schemaForm, markDirty, setReqFilter, REQ_FILTER_DEFAULTS,
    HOME_PANES, HUBS, PAGES, copyline, secretLine, upLabel,
    upDisplay, removeUpstream, routeMeaning, routeTester,
    modelCatalog, failoverRows, failoverSentence, flowDiagram, cmpTable,
    section, bridgeModes, BRIDGE_HINT, FAIL_CAUSES, STRATEGIES,
    qs, rx, bare, setStatus, loadAll,
    loadSavedAndGo, loadRequests, loadOps, hashFor,
    startLiveTicker, requestsTable, opsTable, mixedTable, liveView, agentsView,
    openRequest, openRulesDrawer, flatten,
    mergedRules, input, idInput, pingResult, memStatus, memAgo,
    memWhen, memBytes, memPrefix, memEnginePill, memKindPill, memLineageSvg,
    memSessionLink, memOffPanel, memGate, memJobPanel, memBackupsPanel, memImportPanel,
    memBackfillControl, memResultsTable, memSummary,
    commandsDoc, memKnewCard, memTimelineCard, memBenchmarkPanels, fmt, h,
    $, store, md, mdDoc, mdBlock, esc,
    setHtml, statusPill, phaseOf,
  } = /** @type {any} */ (ui);


    const c = state.config; const S = state.schema.config.memory;
    const M = c.memory;
    const form = (schema, values) => schemaForm(schema, values, () => markDirty(), { compact: true, teach: false });
    // Engine controls act right away (install, uninstall), independent of the save bar.
    // Restart is for an engine the person sees hung (HarnessV4_Tasks U1): shown while memory is on and it is installed.
    const ctl = h("div", { class: "mem-job", style: "margin:0 0 4px" }, h("span", { class: "muted small" }, "checking the engine…"));
    const drawCtl = () => memStatus({ fresh: true }).then((st) => {
      const e = st.engine || {}; const running = (st.jobs || []).find((j) => j.status === "running");
      const other = otherEngine(e);
      const jobBox = h("div", {}); if (running) jobBox.append(memJobPanel(running, drawCtl));
      const startJob = async (path, label) => { try { const { job } = await api(path, { method: "POST", body: {} }); jobBox.replaceChildren(memJobPanel(job, drawCtl)); toast(label); for (const b of ctl.querySelectorAll("button")) b.disabled = true; } catch (/** @type {any} */ err) { toast(err.message, "err"); } };
      const uninstall = async () => { if (!confirm(uninstallWords({ again: st.enabled && state.saved?.memory?.engine?.autoInstall !== false, bundled: e.bundle?.ready !== false }))) return; try { await api("/memory/uninstall", { method: "POST", body: {} }); toast("Engine removed"); state.memStatus = null; drawCtl(); } catch (/** @type {any} */ err) { toast(err.message, "err"); } };
      ctl.replaceChildren(
        h("div", { class: "row", style: "margin:0;align-items:center;gap:10px" }, h("b", {}, "Engine"), memEnginePill(st), h("span", { class: "muted small grow" }, e.installed ? `Mnemosyne ${e.version || "?"} in ${e.dir || "the engine folder"}${other ? `. ${OTHER_ENGINE_WORDS}` : ""}` : `${st.enabled ? "Not installed." : "Memory is off; the engine can still be installed ahead of time."} ${installWords(e.bundle)}`),
          (!e.installed || other) && e.bundle?.ready ? h("button", { class: "primary sm", disabled: running ? "" : null, onclick: () => startJob("/memory/install", "Installing the memory engine…") }, "Install") : null,
          e.installed && st.enabled ? h("button", { class: "sm", disabled: running ? "" : null, title: RESTART_WORDS, onclick: async (/** @type {any} */ ev) => { const b = ev.currentTarget; b.disabled = true; b.textContent = "Restarting…"; await restartEngine({ api, toast }); state.memStatus = null; drawCtl(); } }, "Restart") : null,
          e.installed ? h("button", { class: "sm danger", disabled: running ? "" : null, onclick: uninstall }, "Uninstall") : null),
        jobBox);
    }).catch((e) => ctl.replaceChildren(h("span", { class: "err small" }, e.message)));
    drawCtl();
    if (state.section) { const id = `memsettings-${state.section}`; state.section = null; setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80); } // deep link from the Overview cards
    return h("div", {},
      intro("memsettings",
        h("p", {}, "Everything here is saved with the Save changes button at the top and takes effect at once: the memory service re-opens the folder and engine with the new values. Turning memory ", h("b", {}, "off"), " stops capture and recall but keeps everything on disk."),
        h("ul", { class: "small" },
          h("li", {}, h("b", {}, "Folder"), ": the archive, the Mnemosyne database and memory.json. Any drive; point a fresh install at an existing folder to adopt it. The engine (Python, packages, model) lives separately in the data folder and is never backed up."),
          h("li", {}, h("b", {}, "Autopilot budgets"), " are the most tokens memory may add: the briefing once per session (kept byte-identical so provider caches survive), the turn block on each new message. Doubled when you refer to the past or change topic; zero on tool legs and trivial messages."),
          h("li", {}, h("b", {}, "Capture"), " decides what is recorded and learned; exclude clients, model patterns and working folders that must never be remembered."),
          )),
      h("section", { class: "panel" }, h("h2", {}, "Engine and folder"), h("p", { class: "muted small" }, "Turn memory on, choose where it runs and where it lives."), form({ enabled: S.enabled, folder: S.folder }, M), h("h4", {}, "Engine"), ctl, form(S.engine, M.engine)),
      h("section", { class: "panel" }, h("h2", {}, "Autopilot"), h("p", { class: "muted small", html: md(S.autopilot._doc || "") }), form(S.autopilot, M.autopilot)),
      h("section", { class: "panel" }, h("h2", {}, "Capture"), h("p", { class: "muted small", html: md(S.capture._doc || "") }), form(S.capture, M.capture)),
      memoryModelsPanel(S, M),
      h("section", { class: "panel" }, h("h2", {}, "Commands"), h("p", { class: "muted small", html: md(S.commands._doc || "") }), form(S.commands, M.commands)),
      h("section", { class: "panel", id: "memsettings-import" }, h("h2", {}, "Import past sessions"), h("p", { class: "muted small" }, "Bring in what you did before Filament had memory. Imported sessions land in the archive like any other: searchable on the Sessions tab, loadable with the load command, and a source for learning. Importing the same source again skips what is already there."), memImportPanel(), memBackfillControl(state.memStatus)),
      h("section", { class: "panel", id: "memsettings-backups" }, h("h2", {}, "Backups"), h("p", { class: "muted small", html: md(S.backups._doc || "") }), M.backups?.enabled && !M.backups?.folder ? h("p", { class: "warn small" }, "Backups are on but have no destination folder yet.") : null, form(S.backups, M.backups), h("h4", {}, "Backups on disk"), h("p", { class: "muted small" }, "Back up now works as soon as a destination folder is saved, whether or not the daily schedule is on."), memBackupsPanel()),
      h("section", { class: "panel" }, h("h2", {}, "Privacy"), h("p", { class: "muted small", html: md(S.privacy._doc || "") }), form(S.privacy, M.privacy)),
      h("details", { class: "panel" }, h("summary", {}, h("h2", {}, "Rules that act")), h("p", { class: "muted small" }, "Learned rules can attach a reminder to matching tool results once you list their ids here."), form({ rules: S.rules }, M)));
}
