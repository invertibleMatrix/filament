// @ts-check
// Ctrl+K changes settings (the design pass of 10-24, UX7): what is typed in the command center, read as a setting and
// the value it should take — "line 70", "1m", "ask", "max", "sonnet", "mem off", "may product" — becomes a
// row that changes it for this chat on Enter, with where it stands now and what the change does. A value the chat has
// already, or one it cannot take, is a line saying why, never a row. Pure: the chat comes in as facts (app.js
// `settingFacts`), and a row's `change` is what the app runs — a settings write, the tune popover's choice, the model
// chip's pick, the Your agent may use list, or the compaction card.
import { lineFromWords, windowTokensOf, LINE_STOPS } from "../widgets/context.js";
import { tok } from "../widgets/kit.js";
import { MODES } from "../composer/mode.js";
import { LEVEL_ORDER, levelWords, windowWords } from "./families.js";

/**
 * @typedef {{ write: { patch?: any, unset?: string[] } } | { tune: "effort" | "window", value: string | number | null }
 *   | { family: string } | { may: string[] } | { summon: true }} SettingChange
 * @typedef {{ id: string, icon: string, tone: string, label: string, now: string, effect: string, change: SettingChange }} SettingRow
 * @typedef {{
 *   chat: boolean, client?: boolean,
 *   line?: { percent: number, window: number | null } | null,
 *   permission?: string,
 *   effort?: { levels: string[], now: string | null, auto: boolean } | null,
 *   window?: { options: number[], now: number, standard: number } | null,
 *   model?: string, modelId?: string, families?: { id: string, name: string }[],
 *   memory?: { on: boolean, source: string } | null,
 *   may?: { tags: string[], cards: { tag: string, name: string }[] } | null, mayOff?: string,
 * }} SettingFacts
 *   `client`: another app compacts it by itself; `line.percent` the
 *   line in force, `line.window` the window where known; `effort.auto` whether Auto
 *   is a choice; `window.now` the window in force (the standard where none is chosen); `memory.source` the layer
 *   memory's switch comes from; `may.cards` the agents it may be told to use
 * @typedef {{ kind: "line", words: string } | { kind: "compact" } | { kind: "window", tokens: number | null, words: string }
 *   | { kind: "permission", id: string } | { kind: "effort", level: string | null, all?: boolean }
 *   | { kind: "memory", on: boolean } | { kind: "may", word: string, off: boolean }
 *   | { kind: "model", words: string, said: boolean }} Intent
 */

/** What a chat not started is told: New chat's screen holds every control until its first message. */
export const NOT_STARTED = "Ctrl+K changes a started chat's settings: before its first message, New chat's screen holds them all";

const TONES = Object.freeze({
  line: "var(--color-sys-teal)",
  window: "var(--color-sys-indigo)",
  effort: "var(--color-sys-purple)",
  model: "var(--color-sys-blue)",
  memory: "var(--color-sys-pink)",
  may: "var(--color-sys-purple)",
});

/** The words a permission mode is typed by. A bare "auto" is not Full access: it is too easy to type by accident. */
const PERMISSION_WORDS = Object.freeze({
  "read-only": ["read-only", "read only", "readonly", "read"],
  ask: ["ask", "ask before changes"],
  edit: ["edit", "edit automatically"],
  auto: ["full access", "full"],
});
/** The words a reasoning level is typed by; "auto" is the model's own choice. */
const LEVEL_TYPED = Object.freeze({
  none: ["none"], minimal: ["minimal", "min"], low: ["low"], medium: ["medium", "med"], high: ["high"],
  xhigh: ["xhigh", "x-high", "extra high"], max: ["max"],
});

/** @param {string} q */
const norm = (q) => String(q || "").trim().toLowerCase().replace(/\s+/g, " ");

/** The permission mode the words name, "" for none. `prefixed`: after "permission", where "auto" is Full access too. @param {string} w @param {boolean} prefixed */
function permissionOf(w, prefixed) {
  if (prefixed && w === "auto") return "auto";
  return Object.entries(PERMISSION_WORDS).find(([, words]) => words.includes(w))?.[0] || "";
}

/** The level the words name: its id, null for Auto, undefined for none. @param {string} w */
function levelOf(w) {
  if (w === "auto") return null;
  return Object.entries(LEVEL_TYPED).find(([, words]) => words.includes(w))?.[0];
}

/**
 * What the typed words ask for, in the order they are read: none where they name no setting. A model's name is read
 * only where nothing else is ("max" is Reasoning; "model max" a model).
 * @param {string} query @returns {Intent[]}
 */
export function settingIntents(query) {
  const q = norm(query);
  /** @type {Intent[]} */
  const out = [];
  if (!q) return out;
  // The compaction line: "line 70", "compaction line 70%", "line 400k", "compact at 70", "autocompact 400k", "70%".
  const line = /^(?:(?:compaction )?line|compact(?:ion)? at|autocompact)(?: (?:at|to))?(?: (.+))?$/.exec(q) || (/^\d+(?:\.\d+)?\s*%$/.test(q) ? [q, q] : null);
  if (line) out.push({ kind: "line", words: line[1] || "" });
  if (/^(?:compact|make room|line\b)/.test(q)) out.push({ kind: "compact" });
  // The window: "1m", "200k", "window 1m", "window".
  const win = /^(?:context )?window(?: (?:to )?(.+))?$/.exec(q);
  if (win) out.push({ kind: "window", tokens: win[1] ? windowTokensOf(win[1]) : null, words: win[1] || "" });
  else if (/^\d+(?:\.\d+)?\s*[km]$/.test(q)) out.push({ kind: "window", tokens: windowTokensOf(q), words: q });
  // Permission: "ask", "read-only", "edit", "full access", "permission ask", "permission".
  const perm = /^(?:permission|perm|mode)(?: (.+))?$/.exec(q);
  const permId = permissionOf(perm ? perm[1] || "" : q, !!perm);
  if (permId || (perm && !perm[1])) out.push({ kind: "permission", id: permId });
  // Reasoning: "max", "low", "reasoning high", "effort auto", "auto", "reasoning".
  const eff = /^(?:reasoning|effort)(?: (.+))?$/.exec(q);
  const level = levelOf(eff ? eff[1] || "" : q);
  if (level !== undefined) out.push({ kind: "effort", level });
  else if (eff && !eff[1]) out.push({ kind: "effort", level: null, all: true });
  // Memory for this chat: "mem off", "memory on".
  const mem = /^(?:mem|memory)(?: for this chat)? (on|off)$/.exec(q);
  if (mem) out.push({ kind: "memory", on: mem[1] === "on" });
  // Your agent may use: "may product", "may use @enduser", "may not product".
  const may = /^may (?:(not|no) )?(?:use )?@?(\S.*)$/.exec(q);
  if (may) out.push({ kind: "may", word: may[2], off: !!may[1] });
  // A model by its name: "model glm", or "sonnet" where nothing else is read.
  const model = /^model(?: (.+))?$/.exec(q);
  if (model) out.push({ kind: "model", words: model[1] || "", said: true });
  else if (!out.length && q.length >= 3) out.push({ kind: "model", words: q, said: false });
  return out;
}

/** The first two names on a list, and how many more; the teams it may start are a list of their own. @param {string[]} names */
const fewNames = (names) => (names.length ? `${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2}` : ""}` : "no agents");

/**
 * The rows the typed words make for this chat, and the lines that say why one is not offered.
 * @param {string} query @param {SettingFacts} f @returns {{ rows: SettingRow[], why: string[] }}
 */
export function settingRows(query, f) {
  const intents = settingIntents(query);
  /** @type {SettingRow[]} */
  const rows = [];
  /** @type {string[]} */
  const why = [];
  if (!intents.length) return { rows, why };
  if (!f.chat) {
    // A model guessed from a word is no setting typed: only a setting said is told why.
    if (intents.some((i) => i.kind !== "model" || i.said)) why.push(NOT_STARTED);
    return { rows, why };
  }
  const model = f.model || "This model";
  for (const i of intents) {
    if (i.kind === "line") {
      const l = f.line;
      if (f.client) { why.push("Another app compacts this chat by itself: its line is its own"); continue; }
      if (!l) continue;
      const w = Number(l.window) || 0;
      const picked = i.words ? lineFromWords(i.words, w) : null;
      if (i.words && picked == null) {
        why.push(w ? "A line is a share of the window, 15% to 95%, or its tokens: line 70, line 400k" : "A line is a share of the window, 15% to 95%: line 70");
        continue;
      }
      const vals = picked != null ? [picked] : LINE_STOPS.filter((p) => p !== l.percent);
      for (const v of vals) {
        if (v === l.percent) { why.push(`The line is at ${v}% already`); continue; }
        rows.push({
          id: `line-${v}`, icon: "foldVertical", tone: TONES.line,
          label: `Compaction line → ${v}%`,
          now: `now ${l.percent}%${w ? ` · ${tok(Math.floor((w * l.percent) / 100))} → ${tok(Math.floor((w * v) / 100))}` : ""}`,
          effect: w ? `It makes room as it nears ${tok(Math.floor((w * v) / 100))} tokens` : `It makes room past ${v}% of its window`,
          change: { write: { patch: { context: { compaction: { thresholdPercent: v } } } } },
        });
      }
    } else if (i.kind === "compact") {
      if (f.client || rows.some((r) => r.id === "compact")) continue;
      rows.push({ id: "compact", icon: "foldVertical", tone: TONES.line, label: "Compact now…", now: "opens its card first", effect: "", change: { summon: true } });
    } else if (i.kind === "window") {
      const wf = f.window;
      if (!wf) { why.push(`${model} has one window`); continue; }
      const shown = (/** @type {number} */ n) => n || wf.standard;
      const nowShown = shown(wf.now);
      const opts = i.tokens != null ? wf.options.filter((n) => shown(n) === i.tokens) : i.words ? [] : wf.options.filter((n) => shown(n) !== nowShown);
      if (i.words && !opts.length) { why.push(`${model} offers ${wf.options.map((n) => windowWords(shown(n))).join(" or ")}`); continue; }
      for (const n of opts) {
        if (shown(n) === nowShown) { why.push(`The window is ${windowWords(nowShown)} already`); continue; }
        rows.push({
          id: `window-${shown(n)}`, icon: "maximize2", tone: TONES.window,
          label: `Window → ${windowWords(shown(n))}`,
          now: `now ${windowWords(nowShown)}`,
          effect: shown(n) > wf.standard ? `Room to ${windowWords(shown(n))} tokens before the session compacts` : `The standard window: the session compacts as it nears ${windowWords(shown(n))} tokens`,
          change: { tune: "window", value: n },
        });
      }
    } else if (i.kind === "permission") {
      const now = MODES.find((x) => x.id === f.permission) || MODES.find((x) => x.id === "edit");
      const list = i.id ? MODES.filter((x) => x.id === i.id) : MODES.filter((x) => x.id !== now?.id);
      for (const x of list) {
        if (x.id === now?.id) { why.push(`Permission is ${x.label} already`); continue; }
        rows.push({ id: `permission-${x.id}`, icon: x.icon, tone: x.tone, label: `Permission → ${x.label}`, now: `now ${now?.label || ""}`, effect: x.desc, change: { write: { patch: { loop: { permissions: x.id } } } } });
      }
    } else if (i.kind === "effort") {
      const e = f.effort;
      if (!e) { why.push(`${model} has no reasoning levels`); continue; }
      /** @type {(string | null)[]} */
      const offered = [...(e.auto ? [null] : []), ...e.levels];
      const list = i.all ? offered.filter((l) => l !== e.now) : [i.level];
      for (const l of list) {
        if (!offered.includes(l)) { why.push(`${model} thinks at ${offered.map((x) => levelWords(x)).join(", ")}`); continue; }
        if (l === e.now) { why.push(`Reasoning is ${levelWords(l)} already`); continue; }
        const up = l && e.now ? LEVEL_ORDER.indexOf(l) > LEVEL_ORDER.indexOf(e.now) : null;
        rows.push({
          id: `effort-${l || "auto"}`, icon: "gauge", tone: TONES.effort,
          label: `Reasoning → ${levelWords(l)}`,
          now: `now ${levelWords(e.now)}`,
          effect: !l ? "The model decides how hard it thinks" : up === null ? `It thinks at ${levelWords(l)} from the next request` : up ? "It thinks harder from the next request: slower, and more tokens" : "It thinks less from the next request: quicker, and fewer tokens",
          change: { tune: "effort", value: l },
        });
      }
    } else if (i.kind === "model") {
      const words = i.words.split(" ").filter(Boolean);
      if (!words.length) continue;
      const found = (f.families || []).filter((x) => x.id !== f.modelId && words.every((w) => x.name.toLowerCase().includes(w))).slice(0, 5);
      if (!found.length && i.said) why.push(`No model is named “${i.words}”`);
      for (const x of found)
        rows.push({ id: `model-${x.id}`, icon: "bot", tone: TONES.model, label: `Model → ${x.name}`, now: `now ${f.model || "none"}`, effect: "From the next message; its reasoning and window carried where it takes them", change: { family: x.id } });
    } else if (i.kind === "memory") {
      const m = f.memory;
      if (!m) continue;
      if (i.on === m.on) { why.push(`Memory is ${m.on ? "on" : "off"} for this chat already`); continue; }
      if (i.on && m.source === "global") { why.push("Memory is off everywhere: the console's switch decides"); continue; }
      rows.push({
        id: `memory-${i.on ? "on" : "off"}`, icon: "brain", tone: TONES.memory,
        label: `Memory for this chat → ${i.on ? "on" : "off"}`,
        now: `now ${m.on ? "on" : "off"}`,
        effect: i.on ? "It recalls into this chat and learns from it again" : "It recalls nothing into this chat and learns nothing from it; the archive still records",
        // On: this chat's own off goes; a project's off is beaten by this chat's own on.
        change: { write: i.on ? (m.source === "session" ? { unset: ["memory.enabled"] } : { patch: { "memory.enabled": true } }) : { patch: { "memory.enabled": false } } },
      });
    } else if (i.kind === "may") {
      if (f.mayOff) { why.push(f.mayOff); continue; }
      const m = f.may;
      if (!m) continue;
      const exact = m.cards.filter((c) => c.tag === i.word);
      const found = (exact.length ? exact : m.cards.filter((c) => c.tag.startsWith(i.word) || c.name.toLowerCase().includes(i.word))).slice(0, 4);
      if (!found.length) { why.push(`No agent is named “${i.word}”: may product, may enduser`); continue; }
      const names = m.tags.map((t) => m.cards.find((c) => c.tag === t)?.name || t);
      for (const c of found) {
        const on = m.tags.includes(c.tag);
        if (on !== i.off) { why.push(on ? `Your agent may use ${c.name} already` : `${c.name} is not on its list`); continue; }
        rows.push({
          id: `may-${c.tag}`, icon: "atSign", tone: TONES.may,
          label: i.off ? `Your agent may no longer use ${c.name}` : `Your agent may use ${c.name}`,
          now: `now ${fewNames(names)}`,
          effect: i.off ? `It asks @${c.tag} no more in this chat` : `It may ask @${c.tag} by itself in this chat`,
          change: { may: i.off ? m.tags.filter((t) => t !== c.tag) : [...m.tags, c.tag] },
        });
      }
    }
  }
  return { rows, why };
}

/**
 * The examples under Also type, each what a press types: those this chat can take, in its own values.
 * @param {SettingFacts} f @returns {{ code: string, words: string }[]}
 */
export function settingExamples(f) {
  if (!f.chat) return [];
  /** @type {{ code: string, words: string }[]} */
  const ex = [];
  const l = f.line;
  if (l && !f.client) {
    const v = l.percent === 70 ? 85 : 70;
    ex.push({ code: `line ${v}`, words: `Compaction line: ${v}%` });
  }
  const wf = f.window;
  const other = wf?.options.map((n) => n || wf.standard).find((n) => n !== (wf.now || wf.standard));
  if (other) ex.push({ code: windowWords(other).toLowerCase(), words: `Window: ${windowWords(other)}` });
  const p = MODES.find((x) => x.id === (f.permission === "ask" ? "edit" : "ask"));
  if (p) ex.push({ code: p.id, words: `Permission: ${p.label}` });
  const top = f.effort ? [...f.effort.levels].reverse().find((x) => x !== f.effort?.now) : null;
  if (top) ex.push({ code: LEVEL_TYPED[/** @type {keyof typeof LEVEL_TYPED} */ (top)]?.[0] || top, words: `Reasoning: ${levelWords(top)}` });
  const fam = (f.families || []).find((x) => x.id !== f.modelId && wordOf(x.name));
  if (fam) ex.push({ code: wordOf(fam.name), words: `Model: ${fam.name}` });
  if (f.memory) ex.push({ code: f.memory.on ? "mem off" : "mem on", words: "Memory for this chat" });
  const card = f.may && !f.mayOff ? f.may.cards.find((c) => !f.may?.tags.includes(c.tag)) : null;
  if (card) ex.push({ code: `may ${card.tag}`, words: `Your agent may use ${card.name}` });
  return ex;
}

/** A model's name by its last word of letters ("Claude Sonnet 5.5" → sonnet), "" where it has none. @param {string} name */
function wordOf(name) {
  const w = String(name).toLowerCase().split(/[^a-z0-9.]+/).filter((x) => /^[a-z]{3,}$/.test(x)).at(-1) || "";
  // A word another setting reads ("max", "low") is no model's name here.
  return w && !settingIntents(w).some((i) => i.kind !== "model") ? w : "";
}
