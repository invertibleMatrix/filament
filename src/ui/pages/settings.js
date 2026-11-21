// @ts-check
import { ui } from "../runtime.js";
import { reachWords } from "../lib/log-reach.js";
import { AGENT_LOOP_ELSEWHERE } from "../lib/agent-loop-rows.js";
import { agentsPage, teamsOn } from "../lib/teams-on.js";

export function rules() {
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
    setHtml, statusPill, phaseOf, isLeaf,
  } = /** @type {any} */ (ui);


    const groups = Object.entries(state.schema.rules || {}).filter(([k, n]) => k !== "_doc" && n && !isLeaf(n)).map(([k]) => k);
    const R = (state.rulesUi ||= { q: "", group: "all", teach: store.get("rules.teach") === "1" });
    if (R.group !== "all" && !groups.includes(R.group)) R.group = "all";
    const formBox = h("div", {});
    const drawForm = () => formBox.replaceChildren(schemaForm(state.schema.rules, state.config.rules, () => markDirty(), { compact: !R.teach, filter: R.q, teach: R.teach, group: R.group === "all" ? null : R.group }));
    const search = h("input", { type: "search", class: "usage-q", placeholder: "filter rules (thinking, effort, cache…)", value: R.q });
    search.oninput = () => { R.q = search.value; drawForm(); };
    const teach = h("label", { class: "check" }, (() => { const cb = h("input", { type: "checkbox" }); cb.checked = R.teach; cb.onchange = () => { R.teach = cb.checked; store.set("rules.teach", R.teach ? "1" : "0"); render(); }; return cb; })(), "Show descriptions");
    const tabs = h("div", { class: "rules-tabs" },
      h("button", { type: "button", class: R.group === "all" ? "on" : "", onclick: () => { R.group = "all"; drawForm(); for (const b of tabs.children) b.classList.toggle("on", b === tabs.firstChild); } }, "All"),
      ...groups.map((g) => h("button", { type: "button", class: R.group === g ? "on" : "", onclick: (e) => { R.group = g; drawForm(); for (const b of tabs.children) b.classList.toggle("on", b === e.currentTarget); } }, g.replace(/_/g, " "))));
    drawForm();
    return h("div", {},
      intro("rules",
        h("p", {}, "Rules decide what happens to a request's parameters on the way through. Your messages and tools are never touched. Three kinds of action exist:"),
        h("div", { class: "cols3" },
          h("div", { class: "mini" }, h("b", {}, "Fix"), h("span", { class: "small", html: md("The agent sent something the model would reject, so it is rewritten. Example: old-style `thinking: enabled + budget_tokens` becomes `adaptive` on Claude 4.7+ / Opus 5 / Fable.") })),
          h("div", { class: "mini" }, h("b", {}, "Fill"), h("span", { class: "small", html: md("The agent sent nothing, so a default goes in. Example: `thinking.display = summarized` so reasoning text is visible; a default effort when none was given.") })),
          h("div", { class: "mini" }, h("b", {}, "Remove"), h("span", { class: "small", html: md("The agent sent something the model does not accept, so it is dropped. Example: `temperature` on Opus 4.7+, or the `redact-thinking` beta header that blanks thinking text.") }))),
        h("p", { class: "small" }, "Effort and thinking are the rules people ask about most. ", goto("concepts", "How effort reaches each kind of upstream", "effort-paths"), " explains where the level comes from and what each provider receives."),
        h("h4", {}, "Three layers, most specific wins"),
        h("p", { class: "small", html: md("The values on this page are **global**. An **upstream** can override any field for traffic going to it (Destinations → Upstreams → “rule overrides”). A **route** can override again for just that route. A field left on “inherit” takes the value from the layer below.") })),
      tabs,
      h("div", { class: "rules-toolbar" }, search, teach, h("span", { class: "grow" }), h("span", { class: "muted small" }, "Hover a field in compact mode for its effect.")),
      formBox);
}

export function templates() {
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
    setHtml, statusPill, phaseOf, openDrawer, diffView,
  } = /** @type {any} */ (ui);


    return h("div", {},
      intro("templates",
        h("p", {}, "A template is a bundle of settings with an explanation of every effect. It is the fastest way to configure Filament without touching individual parameters. Under the hood it writes into the same three places you can edit by hand: the ", goto("rules"), " page (how requests are shaped), the ", goto("upstreams"), " page (where they go) and the ", goto("routes"), " page (which names go where). After applying, everything it set is visible and editable on those pages."),
        h("ul", { class: "small" }, h("li", {}, h("b", {}, "Preview changes"), " lists exactly which settings would change, from what to what. Nothing is written."), h("li", {}, h("b", {}, "Apply"), " writes those settings into the saved config immediately (no Save needed). Your other settings stay as they are; only the listed ones change."), h("li", {}, "Templates can be combined. Apply “Claude: visible thinking, real effort” first, then a destination template, then optionally an effort or logging one."), h("li", {}, "After applying a destination template, paste the API key on ", goto("upstreams"), " and press Save changes.")),
        h("h4", {}, "Typical recipes"),
        h("div", { class: "cols3" },
          h("div", { class: "mini" }, h("b", {}, "Your client → an OpenAI-compatible provider"), h("span", { class: "small" }, "Add an OpenAI-compatible upstream (OpenRouter, GLM, DeepSeek…) and a route; paste its key on Upstreams. Model in your client: whatever name the route catches.")),
          h("div", { class: "mini" }, h("b", {}, "Anthropic key only"), h("span", { class: "small" }, "Visible thinking + Direct to Anthropic. Streams forced on, caching ensured.")),
          h("div", { class: "mini" }, h("b", {}, "Cheaper day-to-day"), h("span", { class: "small" }, "Add Cost guard: caps effort at high and max_tokens at 32k. Switch to Maximum quality for hard tasks."))),
        h("p", { class: "small muted", style: "margin-top:10px" }, "Prefer being walked through it? ", goto("overview", "Get started"), " on Home takes it step by step, from the provider catalogue.")),
      h("div", { class: "cards two" }, ...state.templates.map((t) => h("div", { class: "card" },
      h("h3", {}, t.name), h("p", { class: "muted", html: md(t.summary) }),
      h("ul", { class: "small" }, ...t.effects.map((e) => h("li", { html: md(e) }))),
      t.requires?.length ? h("p", { class: "muted small" }, `Also applies: ${t.requires.join(", ")}`) : null,
      h("div", { class: "row", style: "margin-bottom:0" },
        h("button", { onclick: async () => { const r = await api(`/templates/${t.id}/preview`, { method: "POST" }); openDrawer(`Preview: ${t.name}`, diffView(r.changes, r.errors)); } }, "Preview changes"),
        h("button", { class: "primary", onclick: async () => { if (state.dirty && !confirm("You have unsaved changes; applying a template reloads the saved config and discards them. Continue?")) return; try { const r = await api(`/templates/${t.id}/apply`, { method: "POST" }); await loadAll({ force: true }); toast(`Applied ${t.name}`); openDrawer(`Applied: ${t.name}`, diffView(r.changes)); } catch (/** @type {any} */ e) { toast(e.message, "err"); } } }, "Apply"))))));
}

export function settings() {
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


    const c = state.config;

    // What the token estimator has learned, per upstream+model — the readout and the one control that matters:
    // forget. Loaded lazily on first render of the Observability tab; the factor is applied server-side, so a
    // refresh here only ever changes what is displayed.
    // How far back the request log reaches (HarnessV3-Responsiveness R7), under the storeBodies row's form: with
    // whole bodies stored, a long agent session fills the log in minutes, and a question about this morning finds
    // nothing. Read once per visit; the server works it out at start and after each rotation.
    const reachLine = () => {
      if (state.logReach === undefined) {
        state.logReach = null;
        api("/state")
          .then((j) => {
            state.logReach = j.logReach || false;
            if (S.tab === "observability") render();
          })
          .catch(() => {});
      }
      const said = reachWords(state.logReach, String(state.saved?.observability?.storeBodies || ""), (at) => `${memWhen(at)} (${memAgo(at)})`);
      if (!said) return null;
      return h("p", { class: `small ${said.heavy ? "warn" : "muted"}`, style: "margin:4px 0 12px" }, said.text);
    };
    const calibPanel = () => {
      if (state.tokenCalib === undefined) {
        state.tokenCalib = null;
        api("/token-calib")
          .then((j) => {
            state.tokenCalib = j;
            if (S.tab === "observability") render();
          })
          .catch(() => {});
      }
      const rows = state.tokenCalib || [];
      return h("div", { class: "calib-panel", style: "margin-top:14px" },
        h("h3", {}, "Token calibration"),
        h("p", { class: "muted small" }, "Learned from the usage real replies already state — nothing is ever sent anywhere to learn it. A factor scales that pair's estimates wherever Filament sizes by them: the session composer, the context stamp on every request, count_tokens, the agent loop's window edge. Providers that never report usage never appear; their estimates stay class-weighted. A factor serves after three real replies. A coding agent's own counts teach nothing (they are its whole context's, not one request's): its row says which model its turns were counted under, and its estimates borrow that model's factor from an upstream Filament calls directly, once one has learned it."),
        rows.length
          ? h("table", { class: "tbl" },
              h("tr", {}, h("th", {}, "upstream :: model"), h("th", {}, "factor"), h("th", {}, "samples"), h("th", {}, "last learned"), h("th", {})),
              ...rows.map((e) => h("tr", {},
                h("td", { class: "mono" }, e.key),
                h("td", {}, e.f == null ? "—" : `×${Number(e.f).toFixed(2)}`),
                h("td", {}, e.as ? (e.from ? `counted as ${e.as}: borrowed from ${e.from} (${e.n})` : `counted as ${e.as}: no upstream has learned it, so the plain estimate`) : String(e.n)),
                h("td", { class: "muted" }, e.at ? new Date(e.at).toLocaleString() : "—"),
                h("td", {}, h("button", { onclick: async () => { try { await api("/token-calib", { method: "DELETE", body: { key: e.key } }); state.tokenCalib = undefined; toast(`Forgot ${e.key}`); if (S.tab === "observability") render(); } catch (/** @type {any} */ err) { toast(err.message, "err"); } } }, "Forget")),
              )))
          : h("p", { class: "muted small" }, state.tokenCalib === null ? "Loading…" : "Nothing learned yet — an upstream appears here after three of its real replies state usage."),
      );
    };

    // A new key is stored on the server and the saved configuration read again, which throws an edited draft away: asked
    // first, as a template's Apply asks. The toast points at the list, where the key shows masked beside its Copy; a
    // toast never holds a key. A rotate that fails says why; the keys and the page stay as they are.
    const rotate = async () => {
      if (state.dirty && !confirm("You have unsaved changes; a new key reloads the saved config and discards them. Continue?")) return;
      try {
        await api("/keys/rotate", { method: "POST" });
      } catch (/** @type {any} */ e) {
        return toast(`No new key: ${e.message}`, "err");
      }
      try {
        await loadAll({ force: true });
      } catch (/** @type {any} */ e) {
        return toast(`A new key was made, but the page could not read it (${e.message}): reload the page to see it`, "err");
      }
      toast("A new key is first in the list: copy it from there");
    };
    const keys = h("div", {}, ...(state.keys || []).map((k, i) => h("div", { class: "row", style: "margin:6px 0" }, secretLine(k), i === 0 ? h("span", { class: "pill ok" }, "current") : h("span", { class: "pill" }, "previous"))), h("div", { class: "toolbar", style: "margin-top:12px" }, h("button", { onclick: rotate }, "Rotate key"), h("span", { class: "muted small" }, "The previous 4 keys keep working so agents can be moved over one at a time.")));
    // The secrets this secret.key cannot open (the store's `unreadable`): each kept on disk as it was sealed, so the
    // secret.key it was sealed with opens it again; a value typed in its place replaces it.
    const lost = state.unreadable || [];
    const unreadable = lost.length
      ? h("section", { class: "panel" }, h("h2", {}, "Secrets Filament cannot read"),
          h("p", { class: "warn" }, `${lost.length === 1 ? "This secret is" : "These secrets are"} kept as stored, sealed with a secret.key this Filament does not have. Put that secret.key back beside config.json and restart Filament, and ${lost.length === 1 ? "it opens" : "they open"} again. A value typed in place of one replaces it, and its Remove forgets it; a save of anything else keeps ${lost.length === 1 ? "it" : "them"}.`),
          h("ul", {}, ...lost.map((where) => h("li", {}, h("code", {}, where)))))
      : null;
    // The tabs, Rules-page style: one panel at a time, the choice remembered in state.
    const S = (state.settingsUi ||= { tab: "server" });
    const TABS = [
      { id: "server", label: "Server" },
      { id: "agent-loop", label: "Agent loop" },
      { id: "observability", label: "Observability" },
      { id: "alerts", label: "Alerts" },
      { id: "raw", label: "Raw config" },
    ];
    if (!TABS.some((t) => t.id === S.tab)) S.tab = "server";
    const panelOf = (id) => {
      if (id === "agent-loop")
        return h("section", { class: "panel" }, h("h2", {}, "Agent loop"), h("p", { class: "muted" }, `The agent loop's settings, straight from the schema — a new one lands here automatically. Those another page sets are left to it: the mode new chats start in and when Memory offers a rule (the harness's Settings › Permissions), how many agents run on a model at once (Settings › Providers), ${teamsOn(c) ? "the agents and teams" : "the agents"} your agent may use (${agentsPage(c)}), and the loop's system prompt overlay (the Prompts tab, with its live preview). A chat can override these on its Overview in the harness; that setting wins for that chat. Hover a field for its effect.`), schemaForm(state.schema.config.agentLoop, c.agentLoop, () => markDirty(), { compact: true, teach: true, skip: AGENT_LOOP_ELSEWHERE }));
      if (id === "observability")
        return h("section", { class: "panel" }, h("h2", {}, "Observability"), schemaForm(state.schema.config.observability, c.observability, () => markDirty(), { compact: true, teach: false }), reachLine(), calibPanel());
      if (id === "alerts")
        return h("section", { class: "panel" }, h("h2", {}, "Alerts"), h("p", { class: "muted small" }, "What Filament comes to find you about: a banner on every console page and a line on the tray card."), schemaForm(state.schema.config.alerts, c.alerts, () => markDirty(), { compact: true, teach: false }));
      if (id === "raw")
        return h("section", { class: "panel" }, h("h2", {}, "Raw config"), h("p", { class: "muted" }, "Secrets are shown as __SECRET__ and kept when you save, each under the name it was read with: a __SECRET__ moved to another name refuses the save until its value is typed there."), (() => { const ta = h("textarea", { class: "mono", rows: 16 }, JSON.stringify(c, null, 2)); ta.onchange = () => { try { const next = JSON.parse(ta.value); Object.keys(state.config).forEach((k) => delete state.config[k]); Object.assign(state.config, next); markDirty(); toast("Draft updated from the JSON; press Save changes to apply"); render(); } catch { ta.classList.add("bad"); toast("Invalid JSON", "err"); } }; return ta; })());
      return h("section", { class: "panel" }, h("h2", {}, "Server"), h("p", { class: "muted" }, "Host and port changes take effect after a restart. Hover a field for its effect."), schemaForm(state.schema.config.server, c.server, () => markDirty(), { compact: true, teach: false }));
    };
    const box = h("div", {});
    const draw = () => box.replaceChildren(panelOf(S.tab));
    const tabs = h("div", { class: "rules-tabs" },
      ...TABS.map((t) => h("button", { type: "button", class: S.tab === t.id ? "on" : "", onclick: (e) => { S.tab = t.id; draw(); for (const b of tabs.children) b.classList.toggle("on", b === e.currentTarget); } }, t.label)));
    draw();
    return h("div", {},
      unreadable,
      h("section", { class: "panel" }, h("h2", {}, "Inbound API keys"), h("p", { class: "muted" }, "Agents must send one of these as Authorization: Bearer or x-api-key."), keys),
      tabs,
      box);
}

/** Settings → Prompts: every system prompt Filament itself authors, read-only, plus the operator's overlay. */
export function prompts() {
  const { state, api, intro, markDirty, h } = /** @type {any} */ (ui);

    const c = state.config;
    // The opening-text draft: typed into state.config, applied by the Save bar. An entry whose bytes equal the
    // built-in opening saves as empty — the stock prompt (with its closing report line) stays in force — and a
    // no-op save does not dirty the page.
    const commitOverlay = (text) => {
      const t = String(text ?? "");
      if (t === String(c.agentLoop?.systemPrompt ?? "")) return;
      (c.agentLoop ||= {}).systemPrompt = t;
      markDirty();
    };

    const viewer = h("div", {}, h("p", { class: "muted" }, "Loading…"));
    api("/prompts")
      .then((/** @type {any} */ r) => fillPrompts(viewer, r))
      .catch((/** @type {any} */ e) => viewer.replaceChildren(h("p", { class: "warn" }, String(e?.message || e))));

    return h("div", {},
      intro("prompts",
        h("p", {}, "One agent request, in the order the provider caches it: the system blocks, then the tools, then the conversation history. The system is three slots — memory's briefing rides first, the loop's own prompt in the middle, your project's instructions and skills last. The built-in bytes are versioned and tested; the loop's opening text in ② is the one editable entry, and its copy button puts the original back."),
        h("p", { class: "small muted" }, "The loop's prompt and its tools are the same in every permission mode — the mode is enforced at the tool gate, so switching permissions mid-task never rewrites what the provider has cached. Per session, though, the tool set and the outer slots differ: each block below says what fills it and when. The real assembled prompt of any actual turn is on the harness's Prompt pane and on the request record."),
        h("p", { class: "small muted" }, "All of that is Filament's own agent loop. A session a coding agent answers — Claude Code, Codex, Antigravity, Cursor — runs on that agent's own system prompt and tools, which are its maker's: Filament writes none of it. What Filament does give such a session is the last block below.")),
      h("section", { class: "panel" }, h("h2", {}, "The request, assembled"), viewer));

    /** Names in a sentence: "a, b and c". @param {string[]} xs @param {string} [last] */
    function andWords(xs, last = "and") {
      return xs.length > 1 ? `${xs.slice(0, -1).join(", ")} ${last} ${xs[xs.length - 1]}` : xs.join("");
    }
    /** The prompt's own section heads, for the line over it: " · How you work · Your tools · …". @param {unknown} text */
    function sectionsOf(text) {
      const heads = String(text || "").split("\n").filter((l) => l.startsWith("# ")).map((l) => l.slice(2).trim());
      return heads.length ? ` · ${heads.join(" · ")}` : "";
    }

    /** Fill the read-only viewer from GET /api/prompts: the request's anatomy in wire order. */
    function fillPrompts(host, r) {
      const loop = r?.loop || {};
      const an = r?.anatomy || {};
      const memNames = (an.tools?.memory?.names || []).join(", ");
      const memRecall = String(an.tools?.memory?.recall || "");
      /** @type {any[]} */
      const blocks = [
        h("p", { class: "muted small" },
          `Agent loop prompt version ${loop.promptVersion ?? "?"} · wire order: ${(Array.isArray(an.wire) ? an.wire : ["the system blocks", "the tools", "the history"]).join(" → ")}`,
          loop.overlay ? " · your overlay is in force: it replaces the role and report lines" : ""),
        // ① memory's slot: the bytes are composed per session, so the slot explains itself and says where the real ones live.
        h("details", { class: "prompt-block" },
          h("summary", {}, "① memory's shaped system — the briefing rides first"),
          h("div", { class: "prompt-body" },
            h("p", { class: "small" },
              h("span", { class: `pill ${an.memory?.on ? "ok" : ""}` }, an.memory?.on ? "engine open" : "engine closed"),
              " The project's standing briefing, the goal and the per-turn blocks memory composes. This slot rides at the very head of the system, re-attached byte-identically every request, so the provider's cache prefix stays warm. It fills per session — the real bytes of any turn are on the harness's Prompt pane and on the request record."),
            an.memory?.on ? null : h("p", { class: "small muted" }, "Memory's engine is not open, so this slot is empty until it is."))),
        // ② the loop's system prompt: the one editable entry, live as you type — the Save bar highlights on the
        // first keystroke, the assembled preview splices the draft onto the fixed rest of the prompt per input.
        loop.prompt || loop.role
          ? h("details", { class: "prompt-block", open: "" },
              h("summary", {}, "② the agent loop's system prompt — yours to edit"),
              h("div", { class: "prompt-body" },
                (() => {
                  const role = String(loop.role || "");
                  const saved = String(loop.overlay || "");
                  const ta = h("textarea", {
                    class: "mono", rows: 8, spellcheck: "false",
                    placeholder: role ? "" : "Filament's built-in opening text appears here after a restart — or type your own now",
                  });
                  ta.value = saved || role;
                  // Everything after the opening sentence is fixed bytes, so the preview rebuilds exactly: the
                  // draft spliced onto what the server assembled around the current head.
                  const head = saved || role;
                  const restOf = (s) => (head && typeof s === "string" && s.startsWith(head) ? s.slice(head.length) : null);
                  const rest = restOf(loop.prompt);
                  const pre = h("pre", { class: "prompt-pre" }, String(loop.prompt || ""));
                  const statusEl = h("span", { class: "muted small" }, "");
                  // An entry equal to the built-in opening saves as empty (the stock prompt, report line and all).
                  const normalize = (v) => (role && String(v).trim() === role.trim() ? "" : String(v).trim());
                  const refresh = () => {
                    const eff = normalize(ta.value);
                    if (rest != null) pre.textContent = (eff || role) + rest;
                    statusEl.textContent = (eff
                      ? "Your text is in force for every agent turn — the built-in closing report line is dropped with it."
                      : "The built-in prompt is in force. What you type replaces its opening sentence; the folder, the sections on how to work, the tools and care, and the session's Environment follow after it either way.")
                      + (state.dirty ? "  Unsaved — press Save changes." : "");
                  };
                  const edited = () => { commitOverlay(normalize(ta.value)); refresh(); if (!previewBox.open) previewBox.open = true; };
                  ta.oninput = edited;
                  ta.onchange = edited;
                  const restore = role
                    ? h("button", {
                        class: "sm ghost", type: "button",
                        title: "Put the built-in opening text back. Identical bytes mean the default prompt is in force (with its closing report line).",
                        onclick: () => { ta.value = role; edited(); },
                      }, "Restore the original")
                    : null;
                  const previewBox = h("details", { class: "prompt-block", open: "" },
                    h("summary", {}, `Assembled prompt, version ${loop.promptVersion ?? "?"} — what the next turn carries${sectionsOf(loop.prompt)}`),
                    pre);
                  refresh();
                  return h("div", { class: "overlay-edit" }, ta, h("div", { class: "row", style: "margin:8px 0 0; align-items:center; gap:10px" }, restore, statusEl), previewBox);
                })()))
          : null,
        // ③ instructions & skills close the system.
        h("details", { class: "prompt-block" },
          h("summary", {}, "③ project instructions & skills — they close the system"),
          h("div", { class: "prompt-body" },
            h("p", { class: "small" },
              an.instructions?.folder
                ? `Read from ${an.instructions.folder} — the first allowlisted agent folder stands in for a session's working folder. Each file is capped at ${Number(an.instructions.capChars || 24000).toLocaleString()} characters, exactly as a real turn caps it.`
                : "No allowlisted agent folder yet (agentLoop.roots is empty) — a session's working folder decides for real; nothing to preview until one is named."),
            an.instructions?.files?.length
              ? h("p", { class: "small muted" }, an.instructions.files.map((f) => `${f.file} · ${Number(f.chars).toLocaleString()} chars${f.truncated ? ", cut" : ""}`).join("  ·  "))
              : null,
            an.instructions?.missing?.length ? h("p", { class: "small muted" }, `not found: ${an.instructions.missing.join(", ")}`) : null,
            an.instructions?.text ? h("pre", { class: "prompt-pre" }, String(an.instructions.text)) : null,
            h("p", { class: "small muted" }, "A session's own instructions.files list, its standing session text and the skills catalogue ride this same block; it changes only when the files change, and the block's hash lands on the turn's record."))),
        // The tools array: everything available, and what differs per session.
        h("details", { class: "prompt-block" },
          h("summary", {}, "then the tools array — after the system, before the history"),
          h("div", { class: "prompt-body" },
            h("p", { class: "small" }, "Everything the model can call, in the order it is offered. Tools sit inside the provider's cached prefix just like the system prompt, so a tool list that changes is as expensive as a prompt that changes — which is why the set below is the same in every permission mode."),
            h("div", { class: "tool-rows" }, ...(an.tools?.loop || []).map((t) => h("div", { class: "tool-row" }, h("code", {}, String(t.name)), h("span", { class: "muted small" }, String(t.brief || ""))))),
            h("p", { class: "small muted" }, "Per session, the set differs from the list above:"),
            h("ul", { class: "small muted" },
              h("li", {}, h("code", {}, "delegate_read"), " is in the list above only when the global reader model is configured; per session the session's own ", h("code", {}, "loop.readerModel"), " decides, and a reader that does not resolve leaves the tool out."),
              h("li", {}, h("code", {}, "web_fetch"), " and ", h("code", {}, "web_search"), " ride after the loop's own tools when a session switches ", h("code", {}, "plugins.web"), " on."),
              h("li", {}, h("code", {}, "tasks"), " rides right after ", h("code", {}, "plan"), " for the session's own agent — a team's lead too — and a sub-agent that runs one of the task graph's tasks is offered ", h("code", {}, "report"), " to end with."),
              h("li", {}, h("code", {}, "mcp__<server>__<tool>"), " — whatever MCP servers the session rides; per session, not listable here."),
              h("li", {}, "any hand above can be switched off per session by ", h("code", {}, "loop.tools"), ".")),
            h("p", { class: "small" },
              h("span", { class: `pill ${an.memory?.tools ? "ok" : ""}` }, an.memory?.tools ? "memory tools on" : "memory tools off"),
              " Memory's own tools append at the very end of the array: ", h("code", {}, memNames || "filament_memory_*"),
              " and ", h("code", {}, memRecall || "filament_recall"),
              ", which rides every request of a chat Filament runs, so a fold, a tool-result policy or a result cap never changes the tools. On agent turns they ride the loop's internal ticks, not the client's request."))),
        r?.subagents ? subagentBlock(r.subagents) : null,
        r?.teams ? teamBlock(r.teams) : null,
        r?.coder ? coderBlock(r.coder, { names: memNames, on: !!an.memory?.tools }) : null,
      ];
      if (loop.prompt || (an.tools?.loop || []).length) host.replaceChildren(...blocks.filter(Boolean));
      else host.replaceChildren(h("p", { class: "muted" }, "No prompts configured yet."));
    }

    /**
     * Sub-agents' own prompts: one per type, the notes they read beyond it, and — a fork having none of its own —
     * what it reads after the main agent's conversation and what it hears when it reaches for ask, plan or agent.
     */
    function subagentBlock(s) {
      const notes = s.notes || {};
      const pre = (/** @type {unknown} */ text) => h("pre", { class: "prompt-pre" }, String(text || ""));
      const sub = (/** @type {string} */ title, /** @type {any[]} */ ...kids) => h("details", { class: "prompt-block" }, h("summary", {}, title), ...kids);
      return sub("sub-agents — their own system prompt",
        h("div", { class: "prompt-body" },
          h("p", { class: "small" },
            `A sub-agent — launched by the agent tool, the harness's spawn widget or /subagent — is an agent-loop request of its own. Its system prompt takes the loop prompt's place (②) with its own role, permission and report sentences; memory's slot (①) stays quiet and the project's instructions and skills (③) close it as for the main agent. It is offered the loop's tools without ${andWords(s.off || [])}: `,
            h("code", {}, (s.tools || []).join(", ")), "."),
          sub("Builder — your tools, under the session's permission mode", pre(s.workers?.builder)),
          sub("Reviewer — read-only", pre(s.workers?.reviewer)),
          sub("ahead of its task, when it works in its own git worktree", pre(notes.worktree)),
          h("p", { class: "small" },
            "A fork (view fork) has no prompt of its own: it runs on the main agent's system prompt, tools and thinking byte for byte — the prefix the provider already caches — and on every message of the main agent's conversation, then one note and its task. Its launching call is answered ",
            h("code", {}, String(notes.forkOwnCall || "")), "; the main agent's other running calls ", h("code", {}, String(notes.forkOtherCall || "")), "."),
          sub("a fork's note, after the whole conversation — and its worktree's, when it has one", pre(notes.fork), pre(notes.forkWorktree)),
          sub(`what a fork hears when it calls ${andWords(Object.keys(s.forkRefusals || {}), "or")}`, pre(Object.entries(s.forkRefusals || {}).map(([k, v]) => `${k}: ${v}`).join("\n\n")))));
    }

    /**
     * A team's prompts (HarnessV3-AtHome P2): its lead's, with the tools it is offered, and each worker's by role — the
     * team's persona and its words for each role in their places.
     */
    function teamBlock(t) {
      const pre = (/** @type {unknown} */ text) => h("pre", { class: "prompt-pre" }, String(text || ""));
      const sub = (/** @type {string} */ title, /** @type {any[]} */ ...kids) => h("details", { class: "prompt-block" }, h("summary", {}, title), ...kids);
      return sub("a team — its lead's prompt and its workers'",
        h("div", { class: "prompt-body" },
          h("p", { class: "small" },
            "When a team answers a session (engine.mode team, or /team), its lead is the agent loop on the session's model with a prompt of its own in ②: it plans, briefs and checks, its team's persona follows its role, and it has the solo loop's hands, for a piece better done itself, under the session's permission mode — ",
            h("code", {}, (t.leadTools || []).join(", ")),
            ". The session's MCP servers are its lead's as well as its workers'. Each worker is a sub-agent on the model its lead's launch names, else its seat's own, else the Brief's pick, else the session's rows for its team's workers, else its team's, else its card's (the session's rows for the card first), else the first with room on the session's own list (subagents.pool) — with none, its lead's model —, each at its row's effort, else as hard as its lead, in its role's base type, its team's words for the role after its role's line. In a session a coding agent answers, that agent leads, and a worker whose model is a coding agent's works as one: each on its own system prompt, with its part from the last block below."),
          h("p", { class: "small" }, "The teams themselves, those that ship and yours, are made and changed in the harness: ", h("a", { href: "/ui/harness.html#/library/agents" }, "Library › Agents and teams"), "."),
          sub("the lead", pre(t.lead)),
          ...Object.entries(t.workers || {}).map(([role, text]) => sub(`${role} — ${t.roleMay?.[role] === "read" ? "read-only" : "it may edit"}`, pre(text)))));
    }

    /**
     * What Filament gives a coding agent's session (HarnessV4_Tasks C18): none of its system prompt, which is its
     * maker's — the words around the context it hands over, its MCP server's, the task graph's, the agent's part as a
     * sub-agent, a worker or a lead, and the tools it offers.
     * @param {any} c @param {{ names: string, on: boolean }} mem  memory's tools, as the loop's
     */
    function coderBlock(c, mem) {
      const pre = (/** @type {unknown} */ text) => h("pre", { class: "prompt-pre" }, String(text || ""));
      const sub = (/** @type {string} */ title, /** @type {any[]} */ ...kids) => h("details", { class: "prompt-block" }, h("summary", {}, title), ...kids);
      const t = c.tools || {};
      return sub("a coding agent — what Filament gives its session",
        h("div", { class: "prompt-body" },
          h("p", { class: "small" },
            "Claude Code, Codex, Antigravity and Cursor answer a session over Filament's bridge on their own system prompt and their own tools. None of ①, ② or ③ is sent to one, and no edit on this page reaches one. Filament hands it a context instead: memory's briefing, the session's goal, the chat's skills, the task graph's words, and its part when it works as a sub-agent, a team's worker or a team's lead. Those stand for the whole session: they go through the agent's own system channel as the session opens — Claude's appended system prompt, Codex's developer instructions — and ahead of its first prompt where the agent has no such channel. A block that changes or leaves later is said once, ahead of the next prompt. Memory's recall for one message goes after the person's words, as it does for every model. A turn's record names the blocks it gave."),
          h("p", { class: "small" },
            "Its tools from Filament come over Filament's MCP server: memory's — ",
            h("code", {}, mem.names || "filament_memory_*"),
            mem.on ? "" : ", off now",
            " — ", h("code", {}, String(t.graph || "tasks")), " for the task graph, ", h("code", {}, String(t.report || "report")), " on a run of one of the graph's tasks, and ",
            h("code", {}, (t.lead || []).join(", ")), " for a team's lead. Where the bridge runs the agent's hands through Filament, the server offers those too: ",
            h("code", {}, (t.hands || []).join(", ")), "."),
          sub("ahead of the context, where it is said in full", pre(c.head)),
          sub("ahead of a change to it", pre(c.update)),
          sub("the MCP server's own words, as the agent connects", pre(c.server)),
          sub("the task graph's words", pre(c.graph)),
          sub("its part as a sub-agent", pre(c.subagent)),
          sub("its part as a team's worker — a builder's; another role's has that role's line, as the team's block shows", pre(c.worker)),
          sub("its part as a team's lead", pre(c.lead))));
    }
}
