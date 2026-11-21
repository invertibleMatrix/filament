// @ts-check
// The permission mode switch (HarnessV3-Facade D6): a view of the session's `loop.permissions`. It lists exactly
// the setting's four values. The harness runs every LLM route through the loop, so the no-changes choice is
// read-only, not a model without the loop.
// For a session it shows the value in force and writes at once through the one writer; for a new chat it shows what
// the chat would start in — the Start board's held mode, else "New chats start in" from your settings
// (HarnessV4_Settings_Plan HS-D48), which the page hands it — and holds a pick for the create call. A pick is that chat's alone: nothing is
// remembered for the next one. Each mode has its tone (HarnessV3 §15 item 92): the chip's glyph wears
// it, and the menu lists the modes on tiles in it, the way System Settings lists its panes — Full access in red. The
// chip itself turns red for Full access only while a turn runs (the design pass of 10-24, UX8): at rest it is like the
// other chips, its shield red.
// Under the modes, for a session, the rules in force (HarnessV3-AtHome AH-D7): the commands always allowed in this
// chat (d-allow), what Always allow remembered for the project and the
// rules written for the session or its project, one line each in words, each with its own Forget. Nobody writes a
// rule by hand here; a rule is shown where it was born, where you choose what the agent may do.
// While a team that changes no file is in charge of the chat (lib/team.js `readingTeam`), each turn only reads
// whatever the chat's mode says: the chip is read-only's, its tip and a line at its menu's head say why, and the menu
// still sets the chat's own mode — the one its agent has again after Back to your agent.
import { h, morphChildren } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { menu } from "../lib/ui.js";
import { readsOnlyWords } from "../lib/team.js";

/** The switch's options — the ids of `loop.permissions` in the settings schema; a test pins this list against it. */
export const MODES = [
  { id: "read-only", label: "Read-only", icon: "eye", tone: "var(--color-sys-blue)", warn: false, desc: "Reads, searches and runs commands that only read. Edits and other commands are refused." },
  { id: "edit", label: "Edit automatically", icon: "shieldCheck", tone: "var(--color-sys-green)", warn: false, desc: "Edits files in its folder and runs commands that only read on its own. Asks before other commands, and before writing outside its folder." },
  { id: "ask", label: "Ask before changes", icon: "hand", tone: "var(--color-sys-indigo)", warn: false, desc: "Asks before every edit and every command, except commands that only read." },
  { id: "auto", label: "Full access", icon: "shieldAlert", tone: "var(--color-sys-red)", warn: true, desc: "Edits and runs commands without asking." },
];
/** Read-only's row: the chip's face while a team that changes no file is in charge. */
const READ_ONLY = MODES.find((x) => x.id === "read-only") || MODES[0];

/** Where a rule in force comes from, as its row says it. */
const RULE_FROM = { chat: "From Always allow in this chat", learned: "From Always allow in this project", session: "Set for this session", project: "Set for this project" };

/** The files a rule's pattern names, in words: `*.md` files, files with no extension, any file, else the glob itself. @param {string} p */
const filesOf = (p) => (p === "(no extension)" ? "files with no extension" : p === "*" ? "any file" : /^\*\.[^\\/*?]+$/.test(p) ? `${p} files` : p);

/**
 * One rule in force in words (HarnessV3-AtHome AH-D7): "Runs `npm test` without asking", "Never runs `rm *`", "Asks
 * before writing *.md files". A hand the words do not know is named as the rule names it: `mcp__notes__write_note(*)`.
 * @param {{ tool: string, pattern: string, verdict: string }} r
 */
export function ruleWords(r) {
  const p = String(r.pattern);
  /** [what it does, doing it, the thing] — `Runs`, `running`, the subject. */
  const [does, doing, what] =
    r.tool === "bash" || r.tool === "bash_background" || r.tool === "powershell" ? ["Runs", "running", `\`${p}\``]
    : r.tool === "write" ? ["Writes", "writing", filesOf(p)]
    : r.tool === "edit" ? ["Edits", "editing", filesOf(p)]
    : r.tool === "read" ? ["Reads", "reading", filesOf(p)]
    : r.tool === "web_fetch" ? ["Fetches", "fetching", p === "*" ? "any web page" : p]
    : r.tool === "web_search" ? ["Searches the web for", "searching the web for", p === "*" ? "anything" : p]
    : r.tool === "*" && p === "*" ? ["Runs", "running", "any tool"]
    : ["Runs", "running", `${r.tool}(${p})`];
  if (r.verdict === "deny") return `Never ${does.toLowerCase()} ${what}`;
  if (r.verdict === "ask") return `Asks before ${doing} ${what}`;
  // A review rule (HarnessV4_Space_Plan SG-D13): it asks with the Reviewer's five lines first.
  if (r.verdict === "review") return `Asks with a second look before ${doing} ${what}`;
  return `${does} ${what} without asking`;
}

/**
 * The words a switch answers a waiting call with (HarnessV3-AtHome AH-F1), marked as a switch, so the call is judged
 * again under the mode now in force — it runs, is refused, or asks again: the session's own call, and each worker's
 * (HarnessV3-Views V3). Null for Ask, under which the call would only ask again, and for an unknown mode.
 * @param {string | null | undefined} mode  the mode in force after the switch
 * @returns {string | null}
 */
export function switchWords(mode) {
  const m = MODES.find((x) => x.id === mode);
  return !m || m.id === "ask" ? null : `Switched to ${m.label}`;
}

/**
 * What the switch says when it moves while the session's own permission waits: its words (`switchWords`), sent as the
 * next message. Null when the newest turn waits on no permission — a question is answered in words.
 * @param {any} turn  the chat's newest turn @param {string | null | undefined} mode  the mode in force after the switch
 * @returns {string | null}
 */
export function switchAnswer(turn, mode) {
  return turn?.paused?.kind === "permission" ? switchWords(mode) : null;
}

/** A row of the session's rulesInForce (HarnessV3-AtHome AH-D7). @typedef {{ tool: string, pattern: string, verdict: string, from: string }} RuleRow */

/**
 * @param {{ onChange?: (id: string) => void, onUseDefault?: () => void, onForget?: (rule: RuleRow) => void }} [cb]
 * @param {{ h?: typeof h, menu?: typeof menu, drawIn?: (parent: any, nodes: any[]) => void }} [o]  the page's own unless a
 *   test hands in its stand-ins — `drawIn`, how the chip's face goes into it: in place (dom.js `morphChildren`)
 * @returns {{ el: HTMLElement, mode: () => string, set: (id: string) => void, cycle: () => void, setNote: (note: string | null) => void, setRules: (rules: readonly RuleRow[]) => void,
 *   setLive: (on: boolean) => void, setReading: (by: { name: string, own?: boolean } | null) => void }}
 */
export function createModeSwitch(cb = {}, { h: mk = h, menu: openMenu = menu, drawIn = morphChildren } = {}) {
  // Filament's own default, until the page hands the switch what the chat stands on.
  let mode = "edit";
  let note = null;
  /** @type {readonly RuleRow[]} */
  let rules = [];
  /** A turn runs on the chat: Full access is red only then, when the agent may run any command without asking. */
  let live = false;
  /** The team in charge that changes no file, by its name — `own`: the chat is that team's own —, or null: while it
   *  leads, the chat only reads whatever `mode` says. @type {{ name: string, own: boolean } | null} */
  let reading = null;
  /** Why the chat only reads now, naming the chat's own mode: the chip's tip and the menu's first line. @param {{ name: string, own: boolean }} by */
  const readingWords = (by) => readsOnlyWords(by.name, MODES.find((x) => x.id === mode)?.label || mode, by.own);

  const chip = mk("button", { class: "mode-chip", type: "button", title: "Permission mode", "aria-haspopup": "menu", onclick: (/** @type {Event} */ e) => open(e) });
  const paint = () => {
    // The mode in force: read-only under a team that changes no file, else the chat's own.
    const m = reading ? READ_ONLY : MODES.find((x) => x.id === mode) || MODES[1];
    // Red that is always on is looked past (the design pass of 10-24, UX8): at rest the chip is like the others, its
    // shield in the mode's red.
    chip.classList.toggle("warn", !!m.warn && live);
    chip.setAttribute("data-mode", m.id);
    chip.style.setProperty("--tone", m.tone);
    chip.title = reading ? readingWords(reading) : [`${m.label}: ${m.desc}`, note ? `(${note})` : ""].filter(Boolean).join(" ");
    // Painted at every view of the chat: its face drawn in place, under a resting pointer the elements that stood (the
    // owner's of 11-01: buttons blinking under a resting pointer, clicks lost).
    drawIn(chip, [
      mk("span", { class: "mode-ic", html: ICONS[m.icon] }),
      mk("span", { class: "mode-label" }, m.label),
      mk("span", { class: "mode-caret", html: ICONS.chevronsUpDown }),
    ]);
  };
  paint();

  const choose = (id) => {
    mode = id;
    note = null; // the person chose: whatever the chip showed stops mattering
    paint();
    cb.onChange?.(mode);
  };

  /** The open menu, for a rule's Forget to close it before it acts. @type {{ close: () => void } | null} */
  let shown = null;
  /** One rule's row: its words, where it comes from, and its Forget. @param {RuleRow} r */
  const ruleRow = (r) =>
    mk("div", { class: "mode-rule" },
      mk("div", { class: "mode-rule-text" },
        // The words' backticks are markup: a command is set in mono, and no backtick is drawn (HarnessV3-Launch LD-D20).
        mk("span", { class: "mode-rule-words" }, ...ruleWords(r).split("`").map((part, i) => (i % 2 ? mk("code", { class: "mode-rule-code" }, part) : part)).filter((p) => p !== "")),
        mk("span", { class: "mode-rule-from" }, RULE_FROM[/** @type {keyof typeof RULE_FROM} */ (r.from)] || r.from)),
      mk("button", { class: "mode-rule-forget", type: "button", title: "Forget this rule: the agent asks again", onclick: () => { shown?.close(); cb.onForget?.(r); } }, "Forget"));

  /** @param {Event} e */
  const open = (e) => {
    e.stopPropagation();
    // The menu says where the value comes from (D6), and offers "Use the default" — the session's own value
    // unset, the project's or the global setting applies again.
    const inForce = note ? mk("div", { class: "model-inforce" }, mk("span", { class: "muted" }, `${MODES.find((x) => x.id === mode)?.label || mode} · ${note}`)) : null;
    // Under a team that changes no file a pick is still the chat's own mode: the menu's first line says what holds
    // meanwhile, and nothing is greyed.
    const held = reading ? mk("div", { class: "model-inforce" }, mk("span", { class: "muted" }, readingWords(reading))) : null;
    shown = openMenu([
      { type: "label", label: "What the agent may do" },
      ...(held ? [{ type: "node", node: held }] : []),
      ...(inForce ? [{ type: "node", node: inForce }] : []),
      ...MODES.map((opt) => ({
        type: "radio",
        label: opt.label,
        desc: opt.desc,
        icon: opt.icon,
        tone: opt.tone,
        checked: opt.id === mode,
        onClick: () => choose(opt.id),
      })),
      { type: "separator" },
      { label: "Use the default", desc: "Unset this session's own mode: your project or global setting applies", icon: "rotateCcw", tone: "var(--color-sys-gray)", onClick: () => cb.onUseDefault?.() },
      ...(rules.length ? [{ type: "separator" }, { type: "label", label: "Remembered rules" }, ...rules.map((r) => ({ type: "node", node: ruleRow(r) }))] : []),
    ], { anchor: chip, side: "top", align: "start", width: 340 });
  };

  const cycle = () => choose(MODES[(MODES.findIndex((x) => x.id === mode) + 1) % MODES.length].id);

  /** Show whose mode the chip is displaying (the session's, the held changes'), or null for the plain preference. */
  const setNote = (n) => { note = n || null; paint(); };

  /** The session's rules in force, listed under the modes the next time the menu opens; none for a new chat. */
  const setRules = (/** @type {readonly RuleRow[]} */ next) => { rules = Array.isArray(next) ? next : []; };

  /** Whether a turn runs on the chat now. @param {boolean} on */
  const setLive = (on) => { if (live !== !!on) { live = !!on; paint(); } };

  /** The team in charge that changes no file, as the page says it with the band, or null. @param {{ name: string, own?: boolean } | null} by */
  const setReading = (by) => {
    const next = by?.name ? { name: String(by.name), own: !!by.own } : null;
    if (next?.name === reading?.name && next?.own === reading?.own) return;
    reading = next;
    paint();
  };

  return { el: chip, mode: () => mode, set: (id) => { if (MODES.some((m) => m.id === id)) { mode = id; paint(); } }, cycle, setNote, setRules, setLive, setReading };
}
