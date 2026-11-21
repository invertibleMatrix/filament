// @ts-check
import { ui } from "../runtime.js";
import { isAgentUp } from "../lib/upstream-kinds.js";
import { serverBase } from "../lib/format.js";

export function concepts() {
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


    const c = state.config, R = c.rules;
    const toc = h("div", { class: "toc" }, ...[["names", "Model names & mapping"], ["reasoning", "Thinking & effort"], ["speed", "Speed (fast mode)"], ["translation", "Translation: what changes, what does not"], ["tokens", "Context window, tokens, cost"], ["effort-paths", "How effort reaches each upstream"], ["agents", "Agents: files, images, commands, questions"], ["explain", "Explain a model"], ["cheatsheet", "Suffix cheat sheet"]].map(([id, t]) => goto("concepts", t, id)));
    // ---- Explain a model ----
    const explainBox = h("div", { class: "muted small" }, "Type a model name and press Explain.");
    const explainInput = h("input", { type: "text", class: "mono", value: c.routes.find((r) => r.match && !r.match.includes("*"))?.match || "claude-opus-5-xhigh", placeholder: "claude-opus-5-xhigh-fast, cursor/composer-2.5@plan, glm-5 …" });
    const explain = async () => {
      const name = explainInput.value.trim(); if (!name) return;
      explainBox.replaceChildren(h("span", { class: "muted" }, "working…"));
      let dry; try { dry = await api("/dry-run", { method: "POST", body: { format: "anthropic", body: { model: name, max_tokens: 1024, thinking: { type: "adaptive" }, messages: [{ role: "user", content: "hi" }] } } }); } catch (/** @type {any} */ e) { return explainBox.replaceChildren(h("span", { class: "err" }, e.message)); }
      const req = dry.requested || {}; const base = bare(req.base || name);
      const up = dry.upstream ? c.upstreams.find((u) => u.id === dry.upstream) : null; const isAcp = isAgentUp(up);
      const fam = (p) => { const r = rx(p); return !!(r && r.test(base)); };
      const facts = [];
      const row = (k, v, cls = "") => facts.push(h("tr", { class: cls }, h("td", {}, k), h("td", { html: typeof v === "string" ? md(v) : "" }, typeof v === "string" ? null : v)));
      row("You typed", `\`${name}\``);
      const parts = []; if (req.suffixEffort) parts.push(`effort suffix \`-${req.suffixEffort}\``); if (req.suffixFast) parts.push("speed suffix `-fast`"); const modeM = /@(agent|plan|ask)$/i.exec(name); if (modeM) parts.push(`agent mode suffix \`@${modeM[1]}\``);
      row("Suffixes found", parts.length ? parts.join(", ") + `. Name used for matching: \`${req.base || name}\`` : "none");
      if (!dry.ok) { row("Route", `**none matches**: ${dry.error}. Add a route on the Routes page.`, "bad-row"); }
      else {
        row("Route", `\`${dry.route}\` → upstream **${dry.upstream}** (${state.schema.upstreamTypes[up?.type]?.label || up?.type || "?"})`);
        row("Name the upstream receives", `\`${dry.body?.model || "?"}\``);
      }
      if (isAcp) {
        row("How to choose effort", "This is an agent, not an API. Effort is part of the agent's model name (Cursor: `…-low`, `…-high`, `…-xhigh`, `…-fast`). Filament's `-xhigh` suffix is only applied when `effortTemplate` is set on the upstream; otherwise pick the id from the model list.");
        row("How to choose mode", "Append `@agent`, `@plan` or `@ask`. Applies from that message on, mid-conversation.");
        row("Thinking", `${up.acp?.thoughts && up.acp.thoughts !== "auto" ? `Shown as ${up.acp.thoughts}` : "Auto: thinking blocks in order for a tool connected in Anthropic format; in OpenAI format the thoughts before the first text are a reasoning block and later thoughts are quoted paragraphs (💭) inside the text, in order"} (upstream setting \`thoughts\`). Tool activity: ${up.acp?.toolActivity || "text"}.`);
        row("Tokens", `\`input_tokens\` are estimated locally (class-weighted per token type; upstream setting \`inputTokenEstimate\`) — counting never contacts a provider; the agent reports no usage. Cost is covered by the agent's subscription.`);
      } else {
        const claude = /claude/i.test(base);
        if (claude) {
          const adaptiveOnly = fam(R.thinking.adaptiveOnlyModels), noAdaptive = fam(R.thinking.noAdaptiveModels), rejectsDisabled = fam(R.thinking.rejectsDisabledModels), display = fam(R.thinking.displayModels);
          row("Thinking", adaptiveOnly ? `Adaptive only. \`budget_tokens\` is rejected with HTTP 400; Filament converts the old shape automatically (\`legacyToAdaptive\`).${rejectsDisabled ? " Thinking **cannot be turned off** on this model; a `disabled` request is removed." : " Can be turned off with `thinking.type = disabled` (Opus 5: only at effort high or below)."}` : noAdaptive ? "Old style only: `thinking: {type: enabled, budget_tokens: N}`. No adaptive mode, no effort parameter. Filament converts adaptive requests to enabled + `fallbackBudgetTokens`." : "Adaptive supported (`thinking.type = adaptive`), also accepts the legacy budget shape.");
          row("Visible thinking", display ? `Supported. Filament sends \`display = ${R.thinking.display}\` so the reasoning summary is visible in the agent (Anthropic's default \`omitted\` returns empty thinking blocks).` : "Not supported on this model; `thinking.display` is removed.");
          const cap = (R.effort.modelCaps || []).find((x) => fam(x.match)); const noEffort = fam(R.thinking.noAdaptiveModels);
          row("Effort levels", noEffort ? "None: `output_config.effort` predates this model and is removed." : `Allowed: ${(cap ? cap.allowed : R.effort.allowed).map((l) => `\`${l}\``).join(" ")}. Chosen in this order: ${(R.effort.sources || []).join(" → ")}; default \`${R.effort.default}\`. Levels above the cap are ${R.effort.onUnsupported === "clamp" ? "clamped down" : R.effort.onUnsupported}.`);
          row("Fast mode", fam(R.speed?.models || "") ? `Available: \`${req.base}-fast\` sends \`speed: fast\` plus the \`${R.speed.beta}\` beta. Roughly double the price, up to 2.5x output speed, separate rate limit. (Rule \`speed.mode\` = ${R.speed?.mode || "client"}.)` : "Not available on this model. A `-fast` suffix is downgraded to standard speed.");
          const strips = (R.params.stripRules || []).filter((x) => fam(x.match)).flatMap((x) => x.strip || []);
          row("Removed parameters", strips.length ? `${strips.map((s) => `\`${s}\``).join(", ")} (the API rejects them on this model).` : "none by model rule");
          row("Forced tool choice", fam(R.tools.forcedToolChoiceModels) ? "Rejected by this model; Filament rewrites `tool_choice any/tool` to `auto`." : "Passed through.");
        } else {
          row("Thinking", "Not a Claude model: Anthropic-style `thinking` rules do not apply. If the request is OpenAI format, effort is sent as `reasoning_effort`; the provider decides what it supports.");
          row("Effort levels", `Sent as \`reasoning_effort\` (OpenAI format) with the same source order (${(R.effort.sources || []).join(" → ")}). Providers that do not know the field usually ignore it.`);
          row("Fast mode", "Anthropic-only. A `-fast` suffix is ignored here.");
        }
        if (dry.ok) {
          row("Body Filament would send", h("pre", { class: "small" }, JSON.stringify({ model: dry.body.model, thinking: dry.body.thinking, output_config: dry.body.output_config, speed: dry.body.speed, max_tokens: dry.body.max_tokens, stream: dry.body.stream }, (k, v) => (v === undefined ? undefined : v), 1)));
          row("Headers of note", h("pre", { class: "small" }, JSON.stringify(Object.fromEntries(Object.entries(dry.headers || {}).filter(([k]) => /anthropic-beta|anthropic-version|user-agent|x-app/.test(k))), null, 1)));
          row("Changes Filament makes", dry.changes?.length ? h("ul", { class: "small" }, ...dry.changes.map((x) => h("li", {}, x))) : "none for this sample request");
        }
      }
      explainBox.replaceChildren(h("div", { class: "table-wrap" }, h("table", { class: "small explain" }, h("tbody", {}, ...facts))));
    };
    explainInput.onkeydown = (e) => { if (e.key === "Enter") explain(); };

    return h("div", {},
      h("section", { class: "panel" }, h("p", { class: "muted" }, "Four words carry most of the confusion: the model ", h("b", {}, "name"), " decides where a request goes; ", h("b", {}, "thinking and effort"), " decide how hard the model works; ", h("b", {}, "speed"), " decides how fast it answers; and ", h("b", {}, "translation"), " is what Filament changes on the way. Each has its own spelling per provider. This page lays them side by side."), toc),

      section("names", "Model names & mapping",
        h("p", {}, "The name your agent sends is a request, not an address. Filament turns it into an address in four steps:"),
        h("ol", { class: "small" }, h("li", { html: md("**Suffixes are peeled off.** `-low` … `-max` becomes the effort, `-fast` becomes the speed, `@plan`/`@ask`/`@agent` becomes the agent mode. What remains is the name used for matching.") }), h("li", { html: md("**Routes are checked top to bottom**; the first `match` that fits wins. `*` means any text.") }), h("li", { html: md("**The upstream model template is filled in.** `{model}` = the matched name, `{1}` = what the first `*` captured. This produces the exact id the provider understands.") }), h("li", { html: md("**The upstream's rules run** (thinking, effort, speed, headers), then the request is sent.") })),
        h("h4", {}, "Same model, four spellings"),
        cmpTable(["Where", "Spelling of Claude Opus 5 at extra-high effort", "Route that produces it"], [
          ["Anthropic API", "`claude-opus-5` + `output_config.effort: xhigh`", "`direct/claude-*` → `claude-{1}`; ask for `direct/claude-opus-5-xhigh`"],
          ["Cursor via ACP", "`claude-opus-5-xhigh` (effort is **inside** the id; also `…-fast` variants)", "`cursor/*` → `{1}`; ask for `cursor/claude-opus-5-xhigh`"],
          ["OpenAI-compatible server", "Provider's own id, e.g. `glm-5`; effort as `reasoning_effort`", "`*` → `{model}` on that upstream, placed last"],
        ]),
        h("p", { class: "small muted" }, "Everything your agent can ask for is listed on the Upstreams page inside each upstream's card. Hover a name to see the id the upstream receives; click it to ping it."),
        h("h4", {}, "Where mapping is configured"),
        h("ul", { class: "small" }, h("li", {}, goto("routes"), ": the match patterns and upstream model templates. Reorder to change priority."), h("li", {}, goto("upstreams"), ": which server or agent an id belongs to; `discover models` fills the picker with the upstream's real ids."), h("li", {}, goto("rules", "Rules → effort.suffixes / effort.stripSuffix"), ": which suffixes are recognized and removed."), h("li", {}, goto("settings", "Settings → advertiseEffortSuffixes"), ": adds `-xhigh`/`-max` variants of Claude models to the picker so agents without an effort setting still get a choice."))),

      section("reasoning", "Thinking & effort",
        h("p", { html: md("**Thinking** is the model reasoning before it answers. **Effort** is how much of it (and how much output) you are willing to pay for. **Display** is whether you get to read the reasoning. Providers spell these three very differently, and getting them wrong is the most common cause of empty thinking, silent downgrades and HTTP 400s.") }),
        cmpTable(["Provider", "Turn thinking on", "Choose depth", "See the reasoning", "Rejects"], [
          ["Anthropic, current Claude (Fable 5/5.1, Opus 5.5/5/4.7/4.8, Sonnet 5)", "`thinking: {type: adaptive}` (Fable: always on, omit or adaptive only)", "`output_config.effort`: `low` `medium` `high` `xhigh` `max` (default high; xhigh is the sweet spot for coding)", "`thinking.display: summarized` (default `omitted` = empty blocks)", "`budget_tokens` → 400; `temperature/top_p/top_k` → 400; Fable: `disabled` → 400, forced `tool_choice` → 400"],
          ["Anthropic, Opus 4.6 / Sonnet 4.6", "`adaptive` (or legacy `enabled` + `budget_tokens`)", "effort `low` `medium` `high` `max` (no `xhigh`)", "`display: summarized` (was the default)", "—"],
          ["Anthropic, Haiku 4.5 and older", "`thinking: {type: enabled, budget_tokens: N}` (≥1024, < max_tokens)", "the budget itself; no `effort`", "always visible", "`adaptive`, `effort`, `display`"],
          ["OpenAI Chat Completions style (GPT, GLM, DeepSeek, Kimi…)", "implicit for reasoning models", "`reasoning_effort`: `low` `medium` `high` (some accept `minimal`/`xhigh`)", "`reasoning_content` in the stream, provider-dependent", "unknown fields are usually ignored, sometimes 400"],
          ["Cursor via ACP", "part of the model id (`…-thinking-…`)", "part of the model id (`…-low`, `…-high`, `…-xhigh`, bracket params like `[effort=high]` inside Cursor)", "streamed as thoughts; Filament shows them as thinking blocks", "unknown ids → “Cannot use this model”"],
        ], { prose: true }),
        h("h4", {}, "What your agent sends, and what Filament does"),
        h("p", { class: "small", html: md("Claude Code sends Anthropic format: a `thinking` object and `output_config.effort` (clients built on older SDKs still send `budget_tokens`). Filament then applies the **thinking** and **effort** rule groups in this order: fix the shape (`legacyToAdaptive`), pick the effort from the first source that has one (`effort.sources`, default suffix → client → default), cap it to what the model allows (`modelCaps`, `onUnsupported`), add `display` where supported, and remove what the model rejects. Every step is listed in the request record.") }),
        cmpTable(["You want", "Do this"], [
          ["Extra-high effort on a Claude model from an agent with no effort picker", "Use the suffix: `claude-opus-5-xhigh`. Suffix beats the agent's own value."],
          ["Always at least high, whatever the agent sends", "Rules → `effort.default = high` and remove `client` from `effort.sources`."],
          ["Cap spend on routine work", "Rules → `effort.allowed = [low, medium, high]`, `onUnsupported = clamp` (the Cost guard template)."],
          ["Different effort per project", "Put the effort suffix in the model name inside that project's agent settings; or add a route per project with a rule override."],
          ["See the reasoning text", "Rules → `thinking.display = summarized` (default). `updates` (beta) shows only progress notes between tool calls on Fable 5/5.1."],
          ["Turn thinking off", "Rules → `thinking.mode = disabled`. Ignored on Fable (cannot be disabled) and rejected by Opus 5 above effort high. Prefer low effort instead."],
          ["Effort for a Cursor model", "Pick the id that carries it: `cursor/cursor-grok-4.6-xhigh-fast`. Or set `effortTemplate = {model}-{effort}` on the Cursor upstream and use `cursor/cursor-grok-4.6-xhigh`."],
        ])),

      section("effort-paths", "How effort reaches each kind of upstream",
        h("p", { html: md("Effort can come from three places, checked in the order set by `effort.sources` (default: **suffix → client → default**): a suffix on the model name (`-low` `-medium` `-high` `-xhigh` `-max`), the client's own setting (Anthropic-style clients send `output_config.effort`; OpenAI-style clients send `reasoning_effort`), or the default in Rules. What Filament then sends depends on the upstream:") }),
        cmpTable(["Upstream kind", "How the effort is delivered", "Levels that work", "Notes"], [
          ["Anthropic API, Anthropic-compatible servers", "`output_config.effort` in the request body (Claude 4.6+ models). `thinking` is set to `adaptive`.", "`low` `medium` `high` `xhigh` `max`; per-model caps in Rules → effort → modelCaps (Opus 4.6 has no `xhigh`; Haiku 4.5 has no effort at all).", "Levels above a model's cap are clamped or rejected (`onUnsupported`). Every change is listed in the request record."],
          ["OpenAI-compatible provider (GLM, DeepSeek, Kimi, Groq, local servers)", "`reasoning_effort` in the body (or `reasoning.effort` when the client used that shape).", "`low` `medium` `high`; some providers also take `minimal` or `xhigh`; many ignore the field.", "An Anthropic-format client's `output_config.effort` is translated into `reasoning_effort` automatically."],
          ["Claude Code (ACP)", "Claude Code's `effort` session option, set before each turn.", "`low` `medium` `high` `xhigh` `max` where the model takes them (Haiku has none).", "Ask for `claude-code/<model>-<effort>`, or use your client's effort picker. A level the model lacks is left out, with a note."],
          ["Codex", "`effort` on each turn, from the levels Codex lists for the model.", "The model's own, usually `low` `medium` `high` `xhigh`; the cheat sheet lists them.", "Ask for `codex/<model>-<effort>`, or use your client's effort picker. A level the model lacks is left out, with a note."],
          ["ACP agent (Cursor, Qoder CLI, Antigravity)", "There is no effort field: the agent picks its own model. Filament can only encode the effort **into the model id** when the upstream's `effortTemplate` is set, e.g. `{model}-{effort}` for Cursor.", "Whatever ids the agent offers: Cursor `cursor-grok-4.6-low/-high/-xhigh`, plus `-fast`. Qoder CLI: `efficient` / `lite` / `qmodel_38max` (no effort variants). Antigravity: the ones it lists.", "Easiest: ask for the id that already carries the effort, `cursor/cursor-grok-4.6-xhigh-fast`. With the template set, `cursor/cursor-grok-4.6-xhigh` and your client's effort picker both work too. Agents without effort variants ignore it (a note is recorded)."],
          ["Qoder cloud (`qd/*`)", "None. Qoder's protocol has no effort field; reasoning models reason at their fixed depth.", "—", "Pick the model instead: `qd/lite` (fast), `qd/efficient`, or a reasoning model from the list."],
        ], { prose: true }),
        h("p", { class: "small muted" }, "Test any of this without spending money: Dry run shows the exact body that would be sent for a given name. The Requests page shows what was actually sent, under “Changes applied”.")),
      section("agents", "Agents via ACP: files, images, modes, commands, questions",
        h("p", { html: md("When a route points at a **coding agent**, Filament is not talking to a model but to a whole agent with its own tools, model list and permissions. Here is what crosses over from your client and what does not.") }),
        cmpTable(["You send from your client", "What the agent gets", "Notes"], [
          ["Text", "The latest message as the prompt. On the first turn of a new session the earlier chat is included as a transcript so the agent has context.", "The client's system prompt is **not** forwarded by default (`forwardSystemPrompt`): agents have their own, and the client's describes the client's tools, not the agent's."],
          ["Images (pasted screenshots)", "Attached as image blocks when the agent accepts images. Cursor, Qoder CLI and Antigravity do.", "Only images on the **latest** message are sent; earlier ones already reached the agent in their own turn. Agents that refuse images get a note in the request record instead."],
          ["Files (PDF, text, code attached as documents)", "A PDF goes as its text, page by page, through pdftotext. Other files go as ACP resources if the agent accepts embedded files (Qoder CLI does). Otherwise text files are inlined into the prompt with a header; other binary files are announced to the agent, which can ask you for the path.", "Cursor does not accept embedded files: paste text or give the agent the file path inside your project, it reads files itself."],
          ["Agent mode (agent / plan / ask)", "Add a suffix to the model name: `cursor/auto@plan`, `cursor/auto@ask`; `@agent` switches back. Works mid-conversation.", "A client's own “plan mode” lives in the client's prompt, which the agent never sees; use the suffix. Mode names are mapped per agent (Cursor agent/plan/ask, Qoder yolo/plan/default)."],
          ["Continue a chat you started in the agent's own terminal", "Add the session id after a `#` in the model name: `claude-code/sonnet#3716601d`. Filament asks the agent for its sessions, attaches to the matching one and sends only your new message; the agent keeps the history. Overview → Agent sessions lists the chats with a copyable name.", "A session still open in a terminal must be closed first (Claude Code refuses to run one chat in two places). Unknown ids start a fresh session with a note."],
          ["Chat commands typed as a message", "Go to the agent as typed in a client's chat, except memory's `@mem` and `/goal`, which Filament answers. In Filament's own chats with a coding agent it answers them, most without the agent: `/sessions` lists the agent's chats by name; `/resume <id or title words>` attaches the chat to one, and the agent runs a turn recapping where you left off; `/new` starts fresh; `/status` (agent, sign-in, model, effort, context fill); `/cost` (cost, durations, code changes, usage by model, cache); `/commands` (everything the agent offers, described); `/help`. With an API model `/status`, `/cost` and `/help` work there too.", "When something you asked for cannot be applied (a model or mode the agent lacks, an ignored effort, a dropped image), Filament adds one short italic line to the reply, once per conversation; switch off with the upstream's `hints` setting."],
          ["Slash commands", "Text starting with `/` is passed as-is. Agents that publish commands (ACP `available_commands`) interpret them; Filament lists what each session offers under Overview → Agent sessions.", "A client's own slash commands are handled inside the client and never reach Filament."],
          ["Tools and MCP servers defined in your client", "Not forwarded. The agent uses **its own** tools (file edits, terminal, search) and its own MCP servers; you can add MCP servers for the agent under Upstreams → Agent settings.", "This is by design: an agent cannot call tools that live inside another program."],
        ]),
        h("p", { class: "small muted" }, "Each agent's card on the ", goto("upstreams", "Upstreams page"), " has a live cheat sheet (“How to use … from your chat client”) that asks the agent what it offers right now: model ids, effort levels, context-window variants, modes, session listing, published commands."),
        h("h4", {}, "What comes back"),
        cmpTable(["The agent does", "What your client shows", "Notes"], [
          ["Streams its answer", "Normal assistant text, live.", "Claude Code reports exact tokens, cache hits, cost and how full its context is (shown on the request). Cursor and Qoder CLI report nothing, so their counts are Filament's local class-weighted estimate and cost shows as “agent”."],
          ["Thinks", "Thinking blocks, like Claude's, in the order they happened, when your client is connected in Anthropic format. In OpenAI format the thoughts before the first text are a reasoning block and later thoughts are quoted paragraphs (💭) inside the text, because OpenAI-style chat apps keep one text block per reply and would paint a later thinking block under all the text.", "Change with `thoughts` on the upstream (auto / thinking-block / text / hide)."],
          ["Edits files, runs commands", "One short line per tool call (`⚙ Read src/app.js`), and the result appears in your project folder.", "Set `toolActivity = hide` for a clean answer only."],
          ["Asks permission (edit this file? run this command?)", "Nothing: Filament answers on your behalf using the upstream's `permissions` policy (`allow-all` by default, like Cursor's Run Everything: each call allowed once where the agent offers that).", "`read-only` approves reads and rejects edits and commands; `reject` makes it chat only; a word that is none of these asks, and refuses where nobody can be asked. Every decision is recorded on the request."],
          ["Asks you a question in words (plan mode, clarifications)", "The question, as its answer. Reply in the same chat; the next message goes to the same agent session, so the conversation continues.", "ACP has no interactive question dialog; questions are plain text both ways."],
          ["Shows a plan", "The plan entries as text.", "Ask for `@plan` mode to get a plan without edits."],
        ])),
      section("speed", "Speed (fast mode)",
        h("p", { html: md("Three things are called “fast”. **Cursor's `-fast` model ids** are Cursor's own faster serving tier, chosen by picking that id. **Anthropic fast mode** is a research preview that serves the same Claude model at up to 2.5x output tokens per second for roughly double the price: Opus 5 at $10 / $50 per million tokens instead of $5 / $25. **A priority tier** (xAI, OpenAI) is the same model on the provider's faster lane, asked for with `service_tier: \"priority\"` and billed at a multiple of the price. No provider's model list says which models have fast mode: the Upstreams page's **tune** says it, per model, and the harness's Speed switch follows.") }),
        cmpTable(["Provider", "How to ask", "Models", "Cost / caveats"], [
          ["Anthropic", "top-level `speed: \"fast\"` + beta header `fast-mode-2026-02-01`. In Filament: model suffix `-fast` (`claude-opus-5-xhigh-fast`), the harness's Speed switch, or rule `speed.mode = always`", "the Rules page's `speed.models` (Claude Opus 5.5, Opus 5 and Opus 4.8), or a model tuned **Has fast mode** on its upstream; other models → downgraded to standard by Filament", "≈2x price; separate rate limit; switching speed mid-conversation invalidates the prompt cache; not on Bedrock/Vertex/Foundry, Batch or Priority Tier"],
          ["Cursor via ACP", "pick the `…-fast` id, e.g. `cursor/cursor-grok-4.6-high-fast`", "whatever Cursor lists", "Cursor quota; Filament passes the name through untouched (tune sets what a fast id costs against its standard one)"],
          ["OpenAI-compatible (xAI, OpenAI, gateways)", "the request fields the model's tune names — xAI and OpenAI take `service_tier: \"priority\"` — sent with a `-fast` suffix, the Speed switch or `speed.mode = always`", "the models tuned **Has fast mode** with request fields on their upstream; untuned models → the `-fast` suffix is ignored and noted", "the multiplier set in tune (2 = twice the price, or twice a plan's quota); billed fast only when the reply names the tier asked for, else at the standard price with a note"],
        ], { prose: true }),
        h("p", { class: "small muted" }, "Configured per model with ", goto("upstreams", "Upstreams → a model's tune", null), ", and for the wire under ", goto("rules", "Rules → speed", null), h("span", { html: md(": `mode` (client / always / never), `suffix`, `models`, `beta`.") }))),

      section("translation", "Translation: what changes, what does not",
        h("p", { html: md("Two layers. **Format translation** converts between the Anthropic Messages and OpenAI Chat Completions wire formats when the client and the upstream disagree: an OpenAI-format client can call Claude at Anthropic, an Anthropic-format client (Claude Code) can call GLM or Grok on an OpenAI-compatible server. Requests, replies and streams are all converted, tool loops included; lossy steps (e.g. thinking blocks that cannot cross) are listed in the request record. Controlled by `rules.translate`. **Shaping** then does three kinds of edits inside the chosen format, and nothing else touches your messages, tools or system prompt.") }),
        h("div", { class: "cols3" }, h("div", { class: "mini" }, h("b", {}, "Fix"), h("span", { class: "small", html: md("Rewrite what the model would reject: legacy `thinking` → adaptive; forced `tool_choice` → auto on Fable 5.1; `budget_tokens` dropped from adaptive.") })), h("div", { class: "mini" }, h("b", {}, "Fill"), h("span", { class: "small", html: md("Add what is missing: effort default, `display: summarized`, `max_tokens` default, cache markers, `stream_options.include_usage`, `speed` + beta on fast requests.") })), h("div", { class: "mini" }, h("b", {}, "Remove"), h("span", { class: "small", html: md("Drop what the model refuses: `temperature/top_p/top_k` on 4.7+, `redact-thinking` beta, unsigned thinking blocks from history, fast mode on unsupported models.") }))),
        h("h4", {}, "Anthropic ↔ OpenAI field equivalents (what a cross-format translator has to map)"),
        cmpTable(["Concept", "Anthropic Messages", "OpenAI Chat Completions", "Lossy?"], [
          ["System prompt", "top-level `system` (string or blocks)", "first message with `role: system` (or `developer`)", "no"],
          ["Turn content", "`content` blocks: text, image, tool_use, tool_result, thinking", "`content` string or parts; tool calls in `tool_calls`; results as `role: tool` messages", "thinking blocks have no equivalent → dropped"],
          ["Tools", "`tools[].input_schema`", "`tools[].function.parameters`", "no"],
          ["Forced tool", "`tool_choice: {type: any / tool}`", "`tool_choice: required / {type: function}`", "no"],
          ["Length", "`max_tokens` (required)", "`max_completion_tokens` / `max_tokens`", "no"],
          ["Reasoning depth", "`output_config.effort` + `thinking`", "`reasoning_effort`", "levels differ per provider"],
          ["Visible reasoning", "`thinking` blocks with signatures", "`reasoning_content` deltas (non-standard)", "signatures cannot round-trip"],
          ["Caching", "explicit `cache_control` markers", "automatic prefix caching, no markers", "control is lost one way"],
          ["Usage", "`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`", "`prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`", "cache write counts have no OpenAI field"],
        ]),
        h("p", { class: "small", html: md("Practical advice for a client that takes several providers: one Anthropic-format provider entry pointing at Filament covers everything. Claude models go through untouched; other models are translated on the way out and back. A second, OpenAI-format entry is optional and saves nothing, because translation only happens when the upstream needs it.") })),

      section("tokens", "Context window, tokens, cost",
        h("p", { html: md("A **token** is a fragment of text from the model's vocabulary, usually part of a word: about 4 characters or ¾ of a word in English prose, nearer 3.5 characters in code. The **context window** is the maximum tokens a model can hold at once (1M for current Claude models, 200K for Haiku 4.5). Agents show a context meter based on the `input_tokens` in each reply.") }),
        cmpTable(["Number", "Where it comes from", "Notes"], [
          ["`input_tokens`", "the provider's `usage` in every response; Filament records and forwards it", "for ACP agents there is no usage: Filament estimates locally (class-weighted, upstream setting `inputTokenEstimate`) — counting never contacts a provider"],
          ["cache read / cache write", "Anthropic `cache_read_input_tokens` / `cache_creation_input_tokens`", "reads are billed at ~10% of input price; the Overview's hit rate = read ÷ (read + fresh input)"],
          ["thinking tokens", "counted by Filament from the streamed thinking text (chars ÷ 4)", "billed as output tokens by the provider"],
          ["Cost", "tokens × the model's price card at its upstream (else Filament's built-in rates), or the provider's own charge when its reply states one", "a plan pays $0 a request (a coding agent is always on one); the same tokens at the card show beside it as the list price"],
        ]),
        h("p", { class: "small muted" }, "The first request after a model switch pays full input price (caches are per model); afterwards caching resumes on the new model.")),

      section("explain", "Explain a model",
        h("p", { class: "muted" }, "Type any name your agent might send. You get the route, the exact id the upstream receives, every capability that applies to that model under your current rules, and the body and headers Filament would send for a sample request."),
        h("div", { class: "row", style: "margin:0 0 10px" }, h("label", { class: "grow" }, "model name ", explainInput), h("button", { class: "primary", onclick: explain }, "Explain")),
        explainBox),

      section("cheatsheet", "Suffix cheat sheet",
        cmpTable(["Suffix", "Meaning", "Applies to", "Example"], [
          ["`-low` `-medium` `-high` `-xhigh` `-max`", "effort level; overrides the agent's own value", "Claude via API or router; ACP agents only with `effortTemplate`", "`claude-opus-5-xhigh`"],
          ["`-fast`", "Fast mode: Anthropic's speed + beta header, or the request fields a model's tune names (xAI and OpenAI: `service_tier: \"priority\"`)", "Claude Opus 5.5 / 5 / 4.8, or any model tuned **Has fast mode** on its upstream; combinable with effort in any order", "`claude-opus-5-xhigh-fast`, `spacex/grok-4.7-fast`"],
          ["`@agent` `@plan` `@ask`", "agent mode for this and following turns", "ACP agents (Cursor)", "`cursor/composer-2.5@plan`"],
          ["`provider/` prefix", "part of the name, chosen by your routes, not a suffix", "any", "`direct/claude-opus-5`, `cursor/…`, `anthropic/…`"],
        ])));
}

export function guide() {
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
    setHtml, statusPill, phaseOf, getStarted, startFacts,
  } = /** @type {any} */ (ui);


    const c = state.config;
    const base = serverBase(c.server);
    const glossary = [
      ["Agent (client)", "The program that talks to the model: Claude Code, Cursor, a script. It sends a request and expects an answer in the same format."],
      ["Format", "The shape of the request. Three come in: Anthropic Messages (`/v1/messages`), OpenAI Chat Completions (`/v1/chat/completions`) and the OpenAI Responses API (`/v1/responses`). Filament translates between them when the destination speaks another one, and every route, rule and agent works from all three."],
      ["Upstream", "Where Filament forwards to: the real provider (api.anthropic.com, api.openai.com), any OpenAI- or Anthropic-compatible server (OpenRouter, a gateway, a local router), your Qoder account, or a coding agent on this machine. Remote upstreams have a URL and an API key."],
      ["Route", "A line in a table that says: requests for model names shaped like X go to upstream Y, called Z over there. Routes are checked top to bottom; the first that matches wins."],
      ["Wildcard `*`", "In a route's match, `*` stands for “any text here”. `claude-*` matches `claude-opus-5` and `claude-fable-5-1`. A match without `*` must equal the name exactly. `*` alone matches everything (put it last)."],
      ["`{model}` and `{1}`", "Placeholders for the upstream model name. `{model}` is the whole name the agent asked for (without effort suffix). `{1}` is whatever the first `*` matched. Example: match `direct/claude-*`, upstream model `claude-{1}`: `direct/claude-opus-5` is sent as `claude-opus-5`."],
      ["Effort suffix", "Add `-low`, `-medium`, `-high`, `-xhigh` or `-max` to the model name, e.g. `claude-opus-5-max`. Filament removes it, matches on the bare name, and sends it as the effort. This lets agents with no effort setting still choose one."],
      ["Thinking", "The model's reasoning before the answer. Newer Claude models use `adaptive` thinking and can return it as a readable `summarized` text. Old SDKs send the older `enabled + budget_tokens` shape, which these models reject; Filament converts it."],
      ["Rules", "Settings that fix, fill or remove request parameters before forwarding. Fix: rewrite something the model would reject. Fill: add a default when the agent sent nothing. Remove: drop a parameter or header the model does not accept. Anything not covered by a rule passes through unchanged."],
      ["Rule layers", "Rules live on three levels: global (the Rules page), per upstream, per route. The more specific level wins. A field left on “inherit” takes the value from the level below."],
      ["Template", "A ready-made bundle of rules, routes and upstreams with explanations. Preview shows the exact settings that would change. Apply writes them into your config. You can still edit afterwards."],
      ["Prompt caching", "Anthropic re-uses the unchanged start of a long conversation at a tenth of the price. Agents mark where the cache should cut with `cache_control`. Filament keeps those marks and can add them when missing."],
      ["Codex upstream", "OpenAI's Codex as a model: Filament starts `codex app-server` (Codex's own protocol, the one its editor extension uses) and drives it the way it drives an ACP agent. Codex signs in with your ChatGPT plan (`codex login`)."],
      ["ACP agent", "An upstream that is not a model API but a local coding agent (Cursor CLI, Claude Code, Antigravity, Qoder CLI) spoken to over the Agent Client Protocol. Filament starts it, hands it the newest message and the project folder from your request, auto-approves its tool prompts, and streams its answer back like a model reply. The agent edits files with its own tools; your client sees the text plus one line per tool used."],
      ["Switching models mid-chat", "Always allowed. Each request carries the whole conversation, so a new model name just routes the same history elsewhere. For ACP agents Filament seeds a fresh session with the earlier turns. Thinking blocks without a signature are removed before Anthropic sees them."],
      ["Save", "Edits on Routes, Upstreams, Rules and Settings live only in the browser until you press Save changes (top right). Templates apply immediately to the saved config."],
    ];
    return h("div", {},
      h("section", { class: "panel" }, h("h2", {}, "What Filament does"), h("p", { class: "muted" }, "Two things on one address: a coding agent of its own, the harness, and a proxy between the agents you already use and the model providers. Your agent talks to Filament as if it were the provider. Filament decides where the request goes (a route), corrects the parameters the agent got wrong or left out (rules), forwards it, and streams the answer back in your agent's own format."), flowDiagram(),
        h("p", { class: "small muted", style: "margin-top:10px" }, "Your agent can speak Anthropic Messages, OpenAI Chat Completions or the OpenAI Responses API. When the provider speaks another one, Filament translates, so any of your tools reaches any model you connected.")),
      // The same steps Home shows until a model can answer (HarnessV3-Launch LD-D2), from the one builder.
      h("section", { class: "panel" }, h("h2", {}, "Get started"), h("p", { class: "muted" }, "Ticks update live from what Filament knows."), getStarted.steps(startFacts(), { base, key: state.keys?.[0] || null })),
      h("section", { class: "panel" }, h("h2", {}, "What your agent sends, and what happens to it"), h("p", { class: "muted" }, "A request is a JSON body plus headers. The interesting fields and Filament's action on each:"),
        h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "field the agent sends"), h("th", {}, "what it means"), h("th", {}, "what Filament does"))), h("tbody", {}, ...[
          ["`model`", "Which model, e.g. `claude-fable-5-1-max`.", "Strips the effort suffix, finds the first matching route, renames it to the upstream's model name."],
          ["`messages`, `system`, `tools`", "The conversation, instructions and tool definitions.", "Untouched. Only counts are logged, never the text (unless you switch storeBodies to full)."],
          ["`thinking`", "Whether and how the model should reason.", "Fix: `enabled + budget_tokens` becomes `adaptive` on models that require it. Fill: adds `display: summarized` so reasoning text is visible. Remove: drops `disabled` on models that cannot turn thinking off."],
          ["`output_config.effort`", "How hard the model should think: low … max.", "Fill/override: effort suffix wins, then the agent's value, then the default. Clamped only if the model lacks that level."],
          ["`max_tokens`, `stream`", "Reply length limit and streaming on/off.", "Fills a default `max_tokens` if missing; can force streaming on to avoid timeouts, converting back for the agent."],
          ["`temperature`, `top_p`, `top_k`", "Sampling settings from older models.", "Removed on Claude 4.7+ where the API rejects them."],
          ["`cache_control` marks", "Where prompt caching may cut.", "Kept. Added on the system prompt and last user message only if the agent sent none and the rule is on."],
          ["header `anthropic-beta`", "Opt-in features.", "Adds what you list, removes `redact-thinking` (it blanks the reasoning text)."],
        ].map(([f, m, a]) => h("tr", {}, h("td", { html: md(f) }), h("td", { html: md(m) }), h("td", { html: md(a) })))))),
        h("p", { class: "small muted", style: "margin-top:10px" }, "Want to see it with your own request? ", goto("dryrun", "Dry run"), " shows the before and after without sending anything; the ", goto("playground", "Playground"), " sends it for real and shows the reply.")),
      h("section", { class: "panel" }, h("h2", {}, "Try a model name"), h("p", { class: "muted" }, "Type what your agent would put in the model field and see where it would go."), routeTester()),
      h("section", { class: "panel" }, h("h2", {}, "Glossary"), h("dl", { class: "glossary" }, ...glossary.flatMap(([t, d]) => [h("dt", { html: md(t) }), h("dd", { html: md(d) })]))));
}

export function docs() {
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


    const D = (state.docs ||= { file: "GUIDE.md", q: "", cache: {} });
    const wanted = state.section; // render() clears it before the document has loaded
    if (wanted && String(wanted).startsWith("cmd-")) D.file = "COMMANDS"; // #docs:cmd-<group> deep-links into the Commands tab
    const FILES = [["GUIDE.md", "Guide", "Everything Filament offers, explained for anyone"], ["COMMANDS", "Commands", "Everything you can type into a chat: /status, /cost, /compact, the memory prefix, agent-chat commands, model-name tricks — with the words this configuration uses"], ["CONTEXT.md", "Context & compaction", "How earlier turns reach the model: who holds the conversation, the compaction line and its methods, a coding agent's ways, where each setting comes from — then what an outside client gets: a plain proxy plus memory"], ["PARAMETERS.md", "Every parameter", "Each setting with its default, meaning and effect"], ["TEMPLATES.md", "Templates", "What each template changes, and why"], ["memory-guide.md", "Memory, technically", "The whole memory mechanism: terms, the request pipeline, retrieval, learning, the console"], ["build_steps.md", "Build & run", "Install, start, stop, update and fix Filament by hand — for non-developers"], ["ARCHITECTURE.md", "Architecture", "The map of the code: layers, the pipeline, how a change is verified; each area's module map is in docs/architecture/ beside it"]];
    const tabs = h("div", { class: "seg" }, ...FILES.map(([f, label, title]) => h("button", { class: D.file === f ? "active" : "", title, onclick: () => { D.file = f; D.q = ""; state.section = null; render(); } }, label)));
    const count = h("span", { class: "muted small docs-count" });
    const search = h("input", { type: "search", class: "docs-q", placeholder: "search this document…", value: D.q, oninput: () => { D.q = search.value; applySearch(); } });
    const toc = h("nav", { class: "docs-toc" }); const body = h("article", { class: "doc" }, h("span", { class: "muted small" }, "loading…"));
    const applySearch = () => {
      const q = D.q.trim().toLowerCase();
      for (const m of body.querySelectorAll("mark.hit")) m.replaceWith(m.textContent); body.normalize();
      const blocks = [...body.children]; let shown = 0, hits = 0;
      if (!q) { for (const b of blocks) b.hidden = false; count.textContent = ""; for (const a of toc.children) a.classList.remove("dim"); return; }
      // a heading stays visible when anything under it (until the next heading of the same or higher level) matches
      const level = (el) => (/^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : 9);
      const matches = blocks.map((b) => b.textContent.toLowerCase().includes(q));
      blocks.forEach((b, i) => {
        if (level(b) < 9) { let any = false; for (let j = i + 1; j < blocks.length && level(blocks[j]) > level(b); j++) if (matches[j]) { any = true; break; } b.hidden = !(any || matches[i]); }
        else b.hidden = !matches[i];
        if (!b.hidden) shown++; if (matches[i]) hits++;
      });
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT); const texts = []; let n; while ((n = /** @type {any} */ (walker.nextNode()))) if (!n.parentElement.hidden && !n.parentElement.closest("[hidden]") && n.nodeValue.toLowerCase().includes(q)) texts.push(n);
      for (const t of texts) { const i = t.nodeValue.toLowerCase().indexOf(q); if (i < 0) continue; const after = t.splitText(i); after.splitText(q.length); const m = h("mark", { class: "hit" }, after.nodeValue); after.replaceWith(m); }
      count.textContent = hits ? `${hits} matching block${hits === 1 ? "" : "s"}` : "no matches";
      for (const a of toc.children) { const el = document.getElementById(a.dataset.target); a.classList.toggle("dim", !el || el.hidden); }
    };
    const draw = (md) => {
      setHtml(body, mdDoc(md, "docs"));
      const heads = [...body.querySelectorAll("h2, h3")];
      toc.replaceChildren(...heads.map((el) => h("a", { href: `#docs:${el.id.replace(/^docs-/, "")}`, class: el.tagName === "H3" ? "lvl3" : "", "data-target": el.id, onclick: (e) => { e.preventDefault(); el.scrollIntoView({ behavior: "smooth", block: "start" }); history.replaceState(null, "", `#docs:${el.id.replace(/^docs-/, "")}`); } }, el.textContent)));
      body.querySelectorAll("a[data-doc-link]").forEach((a) => { a.onclick = (e) => { e.preventDefault(); const el = document.getElementById(a.dataset.docLink); if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); history.replaceState(null, "", `#docs:${a.dataset.docLink.replace(/^docs-/, "")}`); } }; });
      applySearch();
      if (wanted) { const el = document.getElementById(`docs-${wanted}`); if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 30); }
    };
    // The Commands tab is not a file: it renders the live catalogue (/api/commands) so the words match this install.
    // The generated docs/COMMANDS.md is the plain-text twin with the default words.
    if (D.file === "COMMANDS") {
      const cmdToc = h("nav", { class: "docs-toc" });
      return h("div", { class: "docs-page" },
        h("div", { class: "usage-controls" }, tabs, h("span", { class: "grow" }), h("a", { class: "golink", href: "/docs/COMMANDS.md", target: "_blank", rel: "noopener" }, "open as plain text (default words)")),
        h("div", { class: "docs-layout" }, cmdToc, commandsDoc(wanted, cmdToc)));
    }
    (D.cache[D.file] ? Promise.resolve(D.cache[D.file]) : fetch(`/docs/${D.file}`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }).then((t) => (D.cache[D.file] = t)))
      .then(draw).catch((e) => body.replaceChildren(empty("Document not available", `${D.file}: ${e.message}. The docs folder ships with Filament next to src/; if it was removed, restore it from the repository.`)));
    return h("div", { class: "docs-page" },
      h("div", { class: "usage-controls" }, tabs, search, count, h("span", { class: "grow" }), h("a", { class: "golink", href: `/docs/${D.file}`, target: "_blank", rel: "noopener" }, "open as plain text")),
      h("div", { class: "docs-layout" }, toc, body));
}
