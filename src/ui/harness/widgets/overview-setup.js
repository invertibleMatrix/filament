// @ts-check
// Overview's How it is set up tiles (proposal_ux §4.6): who runs this chat, what it may do, how earlier turns are kept,
// its instructions and rules, what the agent is told, forks and privacy, and the changes to its settings. Each names
// where its setting comes from — "This chat" beats the project, the project beats yours — and its back is the sheet
// that changes it (setup-sheet.js), or How earlier turns are kept's own sheet.
// Since the design pass of 10-24 (UX4) a value that is one choice or a switch changes on the tile itself (`setRow`),
// each row with where its own value comes from, and ↺ where this chat chose it; the sheet keeps the rest.
// What does not apply to the chat's engine is greyed on the face, with why (rule 5: never hidden silently).
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { menu } from "../lib/ui.js";
import { compactionLine, contextSources, windowFacts, roomChoices, LINE_STOPS } from "./context.js";
import { compactionParts, isClientView } from "./compaction.js";
import { leadingTeam, readingTeam, readsOnlyLine } from "../lib/team.js";
import { prettyModel } from "../lib/families.js";
import { settingChangeWords, sourceOfKnob } from "../lib/labels.js";
import { settingsChangesOf } from "../lib/overview.js";
import { TOOL_GROUPS } from "../conversation/start-board.js";
import { FORK_TRANSCRIPT_WORDS } from "../../lib/context-words.js";
import { ago, hero, legend, link, note, stackBar, tok } from "./kit.js";

/** @typedef {import("./kit.js").Mk} Mk */
/** @typedef {import("./registry.js").WidgetContext} WidgetContext */
/** @typedef {import("./frame.js").WidgetSpec} WidgetSpec */

/** A layer as a setup tile's badge names it. */
const LAYER_WORDS = Object.freeze({ session: "This chat", project: "from the project", global: "from yours", default: "from Filament" });
/** The layers, nearest first: a badge names the nearest any of its settings come from. */
const NEAREST = Object.freeze(["session", "project", "global", "default"]);

/**
 * Where a tile's settings come from, as its badge says it: the nearest layer any of `paths` is set in.
 * @param {any} settings  the session view's settings @param {readonly string[]} paths
 */
export function fromWords(settings, paths) {
  if (!settings) return "";
  return LAYER_WORDS[/** @type {keyof typeof LAYER_WORDS} */ (layerOf(settings, paths))] || "";
}

/** The nearest layer any of `paths` is set in. @param {any} settings @param {readonly string[]} paths */
export function layerOf(settings, paths) {
  const layers = paths.map((p) => sourceOfKnob(p, settings));
  return NEAREST.find((l) => layers.includes(l)) || "default";
}

/** A layer as a row's tag says it (the design pass of 10-24, UX4), and what that means on its hover. */
export const TAGS = Object.freeze({
  session: { words: "this chat", title: "This chat's own choice — ↺ puts it back" },
  project: { words: "project", title: "From the project's settings" },
  global: { words: "yours", title: "From your Settings: every chat that chooses nothing takes it" },
  default: { words: "default", title: "Filament's default: nobody has chosen it" },
});

/**
 * Where a row's value comes from, as its tag, and — where this chat chose it — ↺, which takes the chat's own back so
 * the layer under it applies.
 * @param {Mk} mk @param {WidgetContext} ctx @param {readonly string[]} paths @param {string} label @param {boolean} [live]
 * @returns {{ tag: any, back: any, own: string[] }}
 */
export function whereFrom(mk, ctx, paths, label, live = true) {
  const st = settingsOf(ctx);
  if (!st) return { tag: null, back: null, own: [] };
  const layer = /** @type {keyof typeof TAGS} */ (layerOf(st, paths));
  const own = paths.filter((p) => sourceOfKnob(p, st) === "session");
  const tag = mk("span", { class: `ov-set-from is-${layer}`, title: TAGS[layer]?.title || "" }, TAGS[layer]?.words || layer);
  const back = live && own.length
    ? mk("button", {
        class: "ov-set-back",
        type: "button",
        title: "Put it back: this chat's own choice goes, and what it would take otherwise applies",
        "aria-label": `Put ${label} back`,
        html: ICONS.rotateCcw || "",
        onclick: (/** @type {Event} */ e) => { e.stopPropagation?.(); ctx.write({ unset: own }); },
      })
    : null;
  return { tag, back, own };
}

/**
 * A setup row that changes in place (the design pass of 10-24, UX4): its name; its value as a chip whose menu holds the
 * choices, as a switch, or as words; where the value comes from (`whereFrom`), and ↺ where this chat chose it. A row
 * Filament cannot shape here (`dim`) keeps its words and no control. `paths`: the settings it covers.
 * @param {Mk} mk @param {WidgetContext} ctx
 * @param {{ label: string, paths: readonly string[], value?: string, tone?: string, dim?: boolean,
 *   choices?: readonly { id: string, label: string, desc?: string }[], current?: string, pick?: (id: string) => void,
 *   on?: boolean, flip?: (on: boolean) => void }} o
 */
export function setRow(mk, ctx, o) {
  const live = !o.dim;
  const { tag, back, own } = whereFrom(mk, ctx, o.paths, o.label, live);
  /** @type {any} */
  let control;
  if (live && o.choices && o.pick) {
    const pick = o.pick;
    const choices = o.choices;
    control = mk("button", {
      class: `ov-set-pick${o.tone ? ` is-${o.tone}` : ""}`,
      type: "button",
      "aria-haspopup": "menu",
      title: `${o.label}: change it here`,
      onclick: (/** @type {Event} */ e) => {
        e.stopPropagation?.();
        menu(choices.map((c) => ({ type: "radio", label: c.label, desc: c.desc, checked: c.id === o.current, onClick: () => { if (c.id !== o.current) pick(c.id); } })), { anchor: /** @type {HTMLElement} */ (e.currentTarget), side: "bottom", align: "end", width: 300 });
      },
    }, mk("span", { class: "ov-set-val" }, o.value || ""), mk("span", { class: "ov-set-chev", html: ICONS.chevronDown || "" }));
  } else if (live && o.flip && o.on !== undefined) {
    const flip = o.flip;
    control = mk("input", {
      class: "ios-switch ov-set-switch",
      type: "checkbox",
      role: "switch",
      "aria-label": o.label,
      ...(o.on ? { checked: "" } : {}),
      onchange: (/** @type {Event} */ e) => flip(!!(/** @type {HTMLInputElement} */ (e.target)).checked),
    });
    control.checked = !!o.on;
  } else control = mk("span", { class: "ov-set-words" }, o.value ?? (o.on === undefined ? "" : o.on ? "on" : "off"));
  return mk("div", { class: `ov-set${own.length && live ? " is-chat" : ""}${o.dim ? " is-dim" : ""}` },
    mk("span", { class: "ov-set-k" }, o.label), back, control, tag);
}

/** The badge at a setup tile's head. @param {Mk} mk @param {string} words */
const badge = (mk, words) => (words ? mk("span", { class: `ov-from${words === "This chat" ? " is-here" : ""}` }, words) : null);

/** A face's line that does not apply to the chat's engine, greyed, with why. @param {Mk} mk @param {string} why */
const greyed = (mk, why) => mk("p", { class: "ov-greyed" }, why);

/** The chat's settings, flat, and its engine. @param {WidgetContext} ctx */
const settingsOf = (ctx) => ctx.view()?.settings || null;
/** @param {WidgetContext} ctx @param {string} path */
const flat = (ctx, path) => settingsOf(ctx)?.flat?.[path];
/** The coding agent the chat's model reaches, or null. @param {WidgetContext} ctx */
const coder = (ctx) => (settingsOf(ctx)?.engine?.coder ? ctx.accounts?.session() || null : null);
/** The coding agent's name, "" for Filament's loop or a plain model. @param {WidgetContext} ctx */
const coderName = (ctx) => (settingsOf(ctx)?.engine?.coder ? coder(ctx)?.agentName || "The coding agent" : "");

/**
 * Who runs the chat, in a few words — a team, a coding agent (over ACP where it is) or Filament's agent loop, always on
 * (the owner's of 11-09) — its kind, and whether it is a coding agent, whose parts Filament cannot shape are greyed
 * (Overview's head says so).
 * @param {WidgetContext} ctx @returns {{ name: string, kind: "team" | "coder" | "loop", coder: boolean }}
 */
export function engineOf(ctx) {
  const t = leadingTeam(settingsOf(ctx)?.engine);
  if (t) return { name: `${t.name} team`, kind: "team", coder: false };
  const c = coderName(ctx);
  if (c) return { name: coder(ctx)?.type === "acp" ? `${c} over ACP` : c, kind: "coder", coder: true };
  return { name: "Filament's agent loop", kind: "loop", coder: false };
}

/** @param {WidgetContext} ctx @returns {WidgetSpec} */
export function whoWidget(ctx) {
  const team = () => leadingTeam(settingsOf(ctx)?.engine);
  const model = () => String(flat(ctx, "model.name") || ctx.subagents?.sessionModel() || "").replace(/^agent\//, "");
  const engineWords = () => {
    const t = team();
    return t ? `${t.name} team` : coderName(ctx) || engineOf(ctx).name;
  };
  return {
    id: "who",
    label: "Who runs this chat",
    icon: "bot",
    state: engineWords,
    sheet: () => ctx.openSetup?.("who"),
    tileTrail: (mk) => badge(mk, fromWords(settingsOf(ctx), ["model.name", "engine.mode", "engine.team"])),
    tile: (mk) => {
      const t = team();
      const c = coder(ctx);
      const m = model();
      // Memory where it works in the chat; where Memory settings leave the chat out, why (the server's words, D4).
      const out = settingsOf(ctx)?.engine?.leftOut || null;
      const left = out ? ` Memory leaves this chat out: ${out}.` : "";
      const lineWords = t
        ? `Its lead plans and its workers do the work${t.problem ? ` — it cannot lead now: ${t.problem}` : ""}.`
        : c
          ? `Over the ACP bridge${c.label ? `, on its account “${c.label}”` : ""}. Filament adds ${out ? "" : "memory, "}agents, pictures and artifacts.${left}`
          : `Filament runs the turns: its tools, ${out ? "" : "memory, "}sub-agents and the compaction line.${left}`;
      return [
        mk("div", { class: "ov-who" }, mk("b", { class: "ov-who-name" }, engineWords()), m ? mk("span", { class: "ov-quiet" }, prettyModel(m)) : null),
        mk("p", { class: "ov-line" }, lineWords),
        mk("div", { class: "ov-acts" },
          t ? link(mk, "Back to your agent…", () => ctx.team?.back()) : ctx.team?.on?.() === false ? null : link(mk, "Hand it to a team…", () => ctx.team?.open()),
          c ? link(mk, "Switch account…", () => ctx.showWidget?.("account")) : null),
      ];
    },
  };
}

/** The settings a family's chip writes: the loop's own tools, and the web's and the browser's own switches. */
const WEB_KNOBS = Object.freeze({ web_fetch: ["web", "fetch"], web_search: ["web", "search"], browser: ["browser"] });
/** Every setting the families' chips cover, for their tag and ↺. */
const TOOL_PATHS = Object.freeze(["loop.tools", "plugins.web.fetch", "plugins.web.search", "plugins.browser"]);

/**
 * What a family's chip writes to switch it (the design pass of 10-24, UX4): each of its loop tools in `loop.tools` —
 * the whole object as it resolves, as the Start's chips write it, so a tool the project switched off stays off —, and
 * the web's and the browser's own switches.
 * @param {{ names: readonly string[] }} family @param {boolean} on @param {any} tools  `loop.tools` as it resolves
 * @returns {{ patch: any }}
 */
export function familyPatch(family, on, tools) {
  /** @type {any} */
  const patch = {};
  const own = family.names.filter((n) => !Object.hasOwn(WEB_KNOBS, n));
  if (own.length) patch.loop = { tools: { ...(tools && typeof tools === "object" ? tools : {}), ...Object.fromEntries(own.map((n) => [n, on])) } };
  for (const n of family.names) {
    const at = WEB_KNOBS[/** @type {keyof typeof WEB_KNOBS} */ (n)];
    if (!at) continue;
    patch.plugins ||= {};
    if (at.length === 2) (patch.plugins[at[0]] ||= {})[at[1]] = on;
    else patch.plugins[at[0]] = on;
  }
  return { patch };
}

/** The permission modes in the page's words, and their tone on the tile: Full access is red while a turn runs, as the box's chip (UX8). */
const PERMISSIONS = Object.freeze({
  "read-only": { words: "Read-only", line: "looks, never changes", tone: "" },
  ask: { words: "Ask before changes", line: "asks you before each change", tone: "" },
  edit: { words: "Edit automatically", line: "changes files, asks before risky commands", tone: "" },
  auto: { words: "Full access", line: "runs anything without asking", tone: "error" },
});

/**
 * The tool families the loop offers this chat (TOOL_GROUPS), each on unless every one of its tools is switched off —
 * the web's ride on their own switches, and so does the browser (`browser`, off unless said). `teams` false: Settings ›
 * Experimental's Teams switch is off, and the team tool's family is none of them.
 * @param {any} tools  `loop.tools` as it resolves @param {{ fetch: boolean, search: boolean, browser?: boolean }} web
 * @param {boolean} [teams]
 */
export function toolFamilies(tools, web, teams = true) {
  const off = (/** @type {string} */ n) => (n === "web_fetch" ? !web.fetch : n === "web_search" ? !web.search : n === "browser" ? !web.browser : tools?.[n] === false);
  return TOOL_GROUPS.filter((g) => teams || !g.names.includes("team")).map((g) => ({ label: g.label, on: g.names.some((n) => !off(n)) }));
}

/** @param {WidgetContext} ctx @returns {WidgetSpec} */
export function mayWidget(ctx) {
  const permId = () => (Object.hasOwn(PERMISSIONS, String(flat(ctx, "loop.permissions"))) ? String(flat(ctx, "loop.permissions")) : "edit");
  const perm = () => PERMISSIONS[/** @type {keyof typeof PERMISSIONS} */ (permId())];
  /** While a team that changes no file is in charge the chat only reads, whatever the row says: the fact, in a few words. */
  const held = () => {
    const t = readingTeam(settingsOf(ctx)?.engine);
    return t ? readsOnlyLine(t.name) : "";
  };
  return {
    id: "may",
    label: "What it may do",
    icon: "shieldCheck",
    state: () => [perm().words, held()].filter(Boolean).join(" · "),
    sheet: () => ctx.openSetup?.("may"),
    tileSub: held,
    tile: (mk) => {
      const p = perm();
      const tools = flat(ctx, "loop.tools");
      const families = toolFamilies(tools, { fetch: flat(ctx, "plugins.web.fetch") !== false, search: flat(ctx, "plugins.web.search") !== false, browser: flat(ctx, "plugins.browser") === true }, ctx.team?.on?.() !== false);
      const c = coderName(ctx);
      const mcp = Array.isArray(flat(ctx, "plugins.mcp")) ? flat(ctx, "plugins.mcp").length : 0;
      const shaped = !c;
      const from = whereFrom(mk, ctx, TOOL_PATHS, "the tools", shaped);
      return [
        setRow(mk, ctx, {
          label: "Permission",
          paths: ["loop.permissions"],
          value: p.words,
          // Red that is always on is looked past: only while a turn runs, when the agent may act without asking.
          tone: ctx.live()?.streaming ? p.tone : "",
          choices: Object.entries(PERMISSIONS).map(([id, x]) => ({ id, label: x.words, desc: x.line })),
          current: permId(),
          pick: (id) => ctx.write({ patch: { loop: { permissions: id } } }),
        }),
        // Each family's chip switches it for this chat, where Filament's loop runs the tools.
        mk("div", { class: `ov-chips${shaped ? "" : " is-dim"}${from.own.length && shaped ? " is-chat" : ""}` },
          ...families.map((f) => (shaped
            ? mk("button", {
                class: `ov-chip is-button${f.on ? "" : " is-off"}`,
                type: "button",
                "aria-pressed": f.on ? "true" : "false",
                title: `${f.label}: ${f.on ? "on — press to switch it off" : "off — press to switch it on"} in this chat`,
                onclick: (/** @type {Event} */ e) => { e.stopPropagation?.(); ctx.write(familyPatch(/** @type {typeof TOOL_GROUPS[number]} */ (TOOL_GROUPS.find((g) => g.label === f.label)), !f.on, tools)); },
              }, f.label)
            : mk("span", { class: `ov-chip${f.on ? "" : " is-off"}` }, f.label))),
          mk("span", { class: "ov-chip" }, mcp ? `${mcp} connector${mcp === 1 ? "" : "s"}` : "Connectors"),
          from.back,
          from.tag),
        c ? greyed(mk, `${c}'s own tools are its own list — Filament shows the ones it adds.`) : null,
      ];
    },
  };
}

/** Back after a break's two answers, in the sheet's words. */
const COLD_CHOICES = Object.freeze([
  { id: "ask", label: "Ask me", desc: "Your message waits, and a card asks: send it as it is, or make room first" },
  { id: "send", label: "Send as it is", desc: "Your message goes as it is, at the full price" },
]);

/** @param {WidgetContext} ctx @returns {WidgetSpec} */
export function howKeptWidget(ctx) {
  return {
    id: "kept",
    label: "How earlier turns are kept",
    icon: "history",
    state: () => {
      const l = compactionLine(ctx.view(), windowFacts(ctx.view(), ctx.live()).window, null);
      return l ? `at ${tok(l.tokens)}` : "no line";
    },
    sheet: () => ctx.openHow?.(),
    tileTrail: (mk) => link(mk, "Change…", () => ctx.openHow?.()),
    tile: (mk) => {
      const wf = windowFacts(ctx.view(), ctx.live());
      const l = compactionLine(ctx.view(), wf.window, wf.usable);
      const c = coderName(ctx);
      // A client compacts by itself, its own way: its rows say so on the sheet.
      const client = isClientView(ctx.view());
      const cp = compactionParts(ctx);
      const way = c ? cp.chosenWay() : cp.kind();
      const rooms = roomChoices(cp, !!c);
      return [
        setRow(mk, ctx, {
          label: "Your line",
          paths: ["context.compaction.thresholdPercent"],
          value: l ? `${tok(l.tokens)} · ${l.percent}%` : "none: the window is unknown",
          dim: client || !l,
          choices: LINE_STOPS.map((p) => ({ id: String(p), label: `${p}%`, ...(wf.window ? { desc: `${tok(Math.floor((wf.window * p) / 100))} tokens` } : {}) })),
          current: String(cp.percent()),
          pick: (id) => ctx.write({ patch: { context: { compaction: { thresholdPercent: Number(id) } } } }),
        }),
        setRow(mk, ctx, { label: "Ask before making room", paths: ["context.compaction.mode"], on: cp.mode() === "ask", dim: client, flip: (on) => ctx.write({ patch: { context: { compaction: { mode: on ? "ask" : "auto" } } } }) }),
        setRow(mk, ctx, {
          label: "Makes room by",
          paths: c ? ["context.compaction.agent"] : ["context.compaction.method", "context.compaction.writer"],
          value: rooms.find((x) => x.id === way)?.label || way,
          dim: client,
          choices: rooms.map((x) => ({ id: x.id, label: x.label, desc: x.desc })),
          current: way,
          pick: (id) => { const r = rooms.find((x) => x.id === id); if (r) ctx.write({ patch: { context: { compaction: r.patch } } }); },
        }),
        setRow(mk, ctx, {
          label: "Back after a break",
          paths: ["context.compaction.resumeQuestion"],
          value: cp.asksCold() ? "Ask me" : "Send as it is",
          dim: client,
          choices: COLD_CHOICES,
          current: cp.asksCold() ? "ask" : "send",
          pick: (id) => ctx.write({ patch: { context: { compaction: { resumeQuestion: id === "ask" } } } }),
        }),
      ];
    },
  };
}

/** @param {WidgetContext} ctx @returns {WidgetSpec} */
export function rulesWidget(ctx) {
  return {
    id: "rules",
    label: "Instructions and rules",
    icon: "scrollText",
    state: () => (String(flat(ctx, "instructions.session") || "").trim() ? "also tells it" : "nothing extra"),
    sheet: () => ctx.openSetup?.("rules"),
    tile: (mk) => {
      const c = coderName(ctx);
      const extra = String(flat(ctx, "instructions.session") || "").trim();
      const files = flat(ctx, "instructions.files");
      const fileWords = files === false ? "none" : Array.isArray(files) && files.length ? files.join(" · ") : "the project's own (CLAUDE.md, AGENTS.md)";
      const hooks = Array.isArray(flat(ctx, "hooks")) && flat(ctx, "hooks").length ? `${flat(ctx, "hooks").length} hooks` : "none";
      const copy = flat(ctx, "worktree.copy");
      const skills = Array.isArray(flat(ctx, "skills.on")) ? flat(ctx, "skills.on").length : 0;
      // Words and lists change on the sheet (the tile's press); what is on or off changes here.
      return [
        setRow(mk, ctx, { label: "Also tell it", paths: ["instructions.session"], value: extra ? `“${extra.length > 40 ? `${extra.slice(0, 39)}…` : extra}”` : "nothing yet", dim: !!c }),
        setRow(mk, ctx, { label: "Project files it reads", paths: ["instructions.files"], value: c ? `${c} reads its own` : fileWords, dim: !!c }),
        // Every agent takes the chat's skills: a coding agent through Filament's skill tool (HarnessV4_Skills_Plan S1-1);
        // which are on is Library › Skills' to say, for all chats, a project or this chat.
        setRow(mk, ctx, { label: "Skills", paths: ["skills.on"], value: skills ? `${skills} on` : "none on" }),
        setRow(mk, ctx, { label: "Hooks", paths: ["hooks"], value: hooks, dim: !!c }),
        setRow(mk, ctx, { label: "A new worktree gets", paths: ["worktree.copy"], value: Array.isArray(copy) && copy.length ? `${copy.length} item${copy.length === 1 ? "" : "s"} copied` : "nothing copied" }),
      ];
    },
  };
}

/** The prompt's parts the tile names, each in its colour: Filament's part and what memory adds. */
const TOLD_PARTS = Object.freeze([
  { label: "System & tools", words: "Filament's part", color: "var(--color-sys-gray)" },
  { label: "Briefing", words: "Briefing", color: "var(--color-sys-pink)" },
  { label: "Goal", words: "Goal", color: "var(--color-sys-green)" },
  { label: "Memory blocks", words: "Memory", color: "var(--color-sys-purple)" },
]);

/** @param {WidgetContext} ctx @returns {WidgetSpec} */
export function toldWidget(ctx) {
  const parts = () => {
    const rec = ctx.live()?.rec || null;
    const rows = rec ? contextSources(rec).rows : [];
    return TOLD_PARTS.map((p) => ({ ...p, value: rows.find(([l]) => l === p.label)?.[1] || 0 })).filter((p) => p.value > 0);
  };
  return {
    id: "told",
    label: "What the agent is told",
    icon: "notepadText",
    state: () => (parts().length ? tok(parts().reduce((n, p) => n + p.value, 0)) : "—"),
    tileSub: () => "read only",
    tileTrail: (mk) => link(mk, "Read it", () => ctx.openPane?.("run:calls")),
    tile: (mk) => {
      const c = coderName(ctx);
      const list = parts();
      return [
        list.length ? stackBar(mk, list.map((p) => ({ value: p.value, color: p.color, label: `${p.words} ${tok(p.value)}` })), { tall: true }) : null,
        list.length ? legend(mk, list.map((p) => ({ color: p.color, label: p.words, value: tok(p.value) }))) : note(mk, c ? "" : "Shows once a reply has ended: the parts of the prompt the newest request carried."),
        c ? greyed(mk, `${c}'s own system prompt is not shown over the bridge — only what Filament adds.`) : null,
      ];
    },
    now: () => note(h, "The prompt's parts as the newest request carried them, from its record. Read it opens the request itself."),
    link: () => ({ label: "Read the newest request", onClick: () => ctx.openPane?.("run:calls") }),
  };
}

/** @param {WidgetContext} ctx @returns {WidgetSpec} */
export function forkWidget(ctx) {
  /** What a fork carries of the transcript (`fork.transcript`), As it was unless chosen. */
  const forkOf = () => FORK_TRANSCRIPT_WORDS.find((x) => x.id === flat(ctx, "fork.transcript")) || FORK_TRANSCRIPT_WORDS[0];
  return {
    id: "fork",
    label: "Forks and privacy",
    icon: "gitFork",
    state: () => forkOf().name,
    sheet: () => ctx.openSetup?.("fork"),
    tile: (mk) => [
      setRow(mk, ctx, {
        label: "A fork gets",
        paths: ["fork.transcript"],
        value: forkOf().name,
        choices: FORK_TRANSCRIPT_WORDS.map((x) => ({ id: x.id, label: x.name, desc: x.line })),
        current: forkOf().id,
        pick: (id) => ctx.write({ patch: { fork: { transcript: id } } }),
      }),
      setRow(mk, ctx, { label: "Memory reads it", paths: ["privacy.learn"], on: flat(ctx, "privacy.learn") !== false, flip: (on) => ctx.write({ patch: { privacy: { learn: on } } }) }),
      setRow(mk, ctx, { label: "Searchable", paths: ["privacy.index"], on: flat(ctx, "privacy.index") !== false, flip: (on) => ctx.write({ patch: { privacy: { index: on } } }) }),
    ],
  };
}

/** @param {WidgetContext} ctx @returns {WidgetSpec} */
export function changesWidget(ctx) {
  const list = () => settingsChangesOf(ctx.turns());
  return {
    id: "changes",
    label: "Changes to its settings",
    icon: "rotateCcw",
    state: () => String(list().length),
    sheet: () => ctx.openSetup?.("history"),
    // No change since it started: off the page until one is made.
    empty: () => list().length === 0,
    tile: (mk) => {
      const all = list();
      const last = all.at(-1);
      const first = last?.changes[0];
      return [
        hero(mk, { value: String(all.length) }),
        last ? mk("p", { class: "ov-line" }, `last: ${first ? settingChangeWords(first.path, first.to) : "settings changed"}${last.at ? `, ${ago(last.at)}` : ""}`) : mk("p", { class: "ov-line" }, "None since it started."),
        link(mk, "See all", () => ctx.openSetup?.("history")),
      ];
    },
  };
}
