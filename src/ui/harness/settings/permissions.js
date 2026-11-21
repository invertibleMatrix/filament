// @ts-check
// Settings › Permissions (HarnessV4_Settings_Plan HS-3; HC-52..57, HC-80..85): what the agent may do in the chats that
// have not chosen their own — the mode a new chat starts in, when Always allow offers a rule, the folders it may also
// read, the rules in words with Forget, the switch for a second look before risky commands (HarnessV4_Space_Plan
// SG-D13), the commands it never runs, the text hidden from the model, and the check run after each edit. "Applies to" picks the place (settings/place-page.js): all chats, or a project, whose chats take
// the project's rows over yours. A project holds no mode, so there the mode rows give way to one line that says its
// chats take yours (HC-80). Built with an injected `h`, `api` and menu, so it runs on the fake DOM.
import { ICONS } from "../lib/icons.js";
import { keptField, segment } from "../lib/fields.js";
import { browseFolder, pathExample } from "../lib/folder-browse.js";
import { state } from "../state.js";
import { agentsPage } from "../../lib/teams-on.js";
import { MODES, ruleWords } from "../composer/mode.js";
import { mountPlacePage } from "./place-page.js";

/** Settings search's words for this page (search.js, HS-D68): each row it draws, checked against its code by a test. */
export const SEARCH_ROWS = Object.freeze([
  { label: "New chats start in", words: "mode permissions ask edit automatically full access read only plan" },
  { label: "Learn from approvals", words: "always allow" },
  { label: "Offered in Memory after", words: "ask again approvals" },
  { label: "Folders it may also read", words: "added folders" },
  { label: "What it may and may not do", words: "rules always allow forget" },
  { label: "Second look before risky commands", words: "review skeptic deploy migration push force drop" },
  { label: "Commands it never runs", words: "bash deny" },
  { label: "Text hidden from the model", words: "redact secrets" },
  { label: "Check after each edit", words: "verify test lint" },
]);

/**
 * What the switch covers, as its row says it (core/second-look.js RISKY in words): every mode asks, Full access too.
 */
export const secondLookWords = (/** @type {any} */ cfg) => `Deploys and rollbacks, migrations, terraform apply and destroy, kubectl apply and delete, git push --force, tags and deletes, DROP, TRUNCATE and DELETE FROM, and deleting cloud resources ask first in every mode, Full access too — and the Reviewer, Filament's agent that only reads, starts as the card asks, on the model its card in ${agentsPage(cfg)} names, else the chat's, and puts its five lines on the card before you answer. Always allow is never offered for them; a command Filament can tell only reads is not asked about.`;

/** A list as the page reads one. @param {unknown} v @returns {any[]} */
const listOf = (v) => (Array.isArray(v) ? v : []);

/**
 * @param {HTMLElement} body
 * @param {import("./place-page.js").PageCallbacks} [cb]
 * @param {import("./place-page.js").PageIo} [io]
 */
export function renderPermissions(body, cb = {}, io = {}) {
  mountPlacePage(body, cb, io, {
    say: (project) => (project ? `Chats in ${project.name} take these over yours; its folders add to yours.` : "Every chat that has not chosen its own."),
    rows: permissionRows,
  });
}

/**
 * The page's rows over one place.
 * @param {import("./place-page.js").Kit} kit @param {import("./place-page.js").Project | null} project
 */
export function permissionRows(kit, project) {
  const { m, place, cb, io, write, row, head, linesRow } = kit;
  const here = place.projectId ? "This project" : "All chats";

  return [
    head("How it asks"),
    ...(project ? [
      row("New chats start in", "A project holds no mode of its own: its chats start in the one All chats sets.", null),
    ] : [
      modeRow(),
      // Always allow is on the card from a call's first ask (HarnessV4_Tasks E3); the count is Memory's offer, and the
      // line a client that draws no card is told.
      kit.switchRow("loop.learnedPermissions.enabled", "Learn from approvals", "When the agent asks, Always allow in this project is offered from the first time, and what you always allow runs without asking. Off: it asks every time.", true),
      row("Offered in Memory after", "How many approvals of the same call before Memory lists it under Offered, and an app that shows no card is told.",
        keptField(m, String(place.value("loop.learnedPermissions.afterApprovals") ?? 5), async (v) => {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1) { cb.onToast?.("Offered in Memory after: a whole number, 1 or more", "err"); return false; }
          return write({ patch: { "loop.learnedPermissions.afterApprovals": n } });
        }, { type: "number", min: "1", step: "1", class: "zc-input nset-num", "aria-label": "Approvals before Memory offers a rule" }),
        { path: "loop.learnedPermissions.afterApprovals" }),
    ]),
    head("Where it may read"),
    foldersRow(),
    head("Rules"),
    rulesRow(),
    // Off by default (SG-D13): on, it changes how Full access behaves, so it is yours to switch on.
    kit.switchRow("loop.secondLook", "Second look before risky commands", secondLookWords(state.config)),
    linesRow("privacy.bashDeny", "Commands it never runs", "One pattern a line, * for any run of characters. Refused in every mode, ahead of the rules.", "git push --force*"),
    head("What the model sees"),
    linesRow("privacy.redact", "Text hidden from the model", "One regular expression a line. What matches is replaced with [redacted] in what its tools hand back, before any model reads it.", "sk-[A-Za-z0-9]{20,}"),
    row("Check after each edit", "A command run in the project folder before a turn that changed files ends. If it fails, the model gets its output and one more round.",
      keptField(m, String(place.value("loop.verify.afterEdits") ?? ""), async (v) => (v ? write({ patch: { "loop.verify.afterEdits": v } }) : place.own("loop.verify.afterEdits") ? write({ unset: ["loop.verify.afterEdits"] }) : kit.notHere("loop.verify.afterEdits")),
        { class: "zc-input nset-in nset-mono", placeholder: "npm test", "aria-label": "Check after each edit" }),
      { path: "loop.verify.afterEdits", wide: true }),
  ];

  /** "New chats start in" (HC-52): the four modes; every chat that has not picked its own follows. */
  function modeRow() {
    const now = String(place.value("loop.permissions") || "edit");
    const mode = MODES.find((x) => x.id === now) || MODES[1];
    return row("New chats start in", `${mode.desc} Every chat that has not picked its own mode follows this, from its next step.`,
      segment(m, MODES.map((x) => ({ value: x.id, label: x.label, title: x.desc })), now, (v) => { if (v !== now) void write({ patch: { "loop.permissions": v } }); }, "New chats start in"),
      { path: "loop.permissions", wide: true });
  }

  /** "Folders it may also read" (HC-53..55, HC-83, HC-84): this place's own, each with its remove; under a project
   *  all chats' too, with none — the project's add to them. */
  function foldersRow() {
    const path = "loop.addedFolders";
    const own = listOf(place.ownValue(path));
    const under = place.projectId ? listOf(place.under(path)) : [];
    /** @param {string[]} next @param {(ok: boolean) => void} [settle] */
    const keep = (next, settle) => write(next.length ? { patch: { [path]: next } } : { unset: [path] }, settle);
    const items = [
      ...under.map((f) => m("div", { class: "nset-item" }, m("span", { class: "nset-path" }, f), m("span", { class: "nset-src" }, "All chats"))),
      ...own.map((f, i) => m("div", { class: "nset-item" }, m("span", { class: "nset-path" }, f), m("span", { class: "nset-src is-here" }, here),
        m("button", { class: "nset-x", type: "button", title: `Stop reading ${f} without asking`, "aria-label": `Remove ${f}`, html: ICONS.x, onclick: () => void keep(own.filter((_, j) => j !== i)) }))),
    ];
    const input = /** @type {any} */ (m("input", { class: "zc-input nset-in nset-mono", type: "text", placeholder: `A whole path: ${pathExample(state.platform, "notes", "D")}`, spellcheck: "false", autocomplete: "off", "aria-label": "A folder to add", value: kit.drafts.get(path) || "" }));
    const dirs = m("div", { class: "browse-dirs hidden" });
    // What is typed outlives the page drawn again: a refused path stays to be put right (HC-84).
    const add = async () => {
      const p = String(input.value || "").trim();
      if (!p) { input.focus?.(); return; }
      if (own.includes(p)) { cb.onToast?.(`${p} is listed already`); return; }
      kit.drafts.set(path, p);
      await keep([...own, p], (ok) => { if (ok) kit.drafts.delete(path); });
    };
    input.oninput = () => { kit.drafts.set(path, String(input.value || "")); };
    input.onkeydown = (/** @type {KeyboardEvent} */ e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } };
    const adder = m("div", { class: "nset-add" }, input,
      m("span", { class: "nset-add-acts" },
        m("button", { class: "ghost sm", type: "button", onclick: () => void browseFolder(input, /** @type {any} */ (dirs), (w) => cb.onToast?.(w, "err"), io) }, "Browse…"),
        m("button", { class: "ghost sm", type: "button", onclick: () => void add() }, "Add")));
    return row("Folders it may also read", place.projectId
      ? "Besides a chat's own folder, without asking. This project's add to all chats' folders; those are removed under All chats."
      : "Besides a chat's own folder, without asking. A project's folders and a chat's own add to these.",
    m("div", { class: "nset-list" }, items.length ? m("div", { class: "nset-items" }, ...items) : m("p", { class: "nset-none" }, "None: outside a chat's folder, it reads only when you say yes."), adder, dirs),
    { wide: true });
  }

  /** "What it may and may not do" (HC-56, HC-81, HC-82): the rules in words, each this place holds with Forget. Nobody
   *  writes a rule by hand here: a rule is made where the agent asks (HS-D43). */
  function rulesRow() {
    const path = "loop.rules";
    const rules = listOf(place.value(path));
    const mine = place.own(path);
    /** @param {any} r */
    const forget = async (r) => {
      const res = await place.forgetRule(r);
      cb.onToast?.(res.words, res.ok ? "" : "err");
      if (res.ok) cb.onChanged?.();
      kit.repaint();
    };
    const items = rules.map((r) => m("div", { class: "nset-item" },
      m("span", { class: "nset-rule" }, ...ruleWords(r).split("`").map((part, i) => (i % 2 ? m("code", { class: "nset-code" }, part) : part)).filter((p) => p !== "")),
      m("span", { class: `nset-src${mine ? " is-here" : ""}` }, r.learned ? "From Always allow" : mine ? here : "All chats"),
      mine ? m("button", { class: "ghost sm", type: "button", title: "Forget this rule: the next such call asks", onclick: () => void forget(r) }, "Forget") : null));
    const note = !place.projectId ? "" : mine ? "This project's rules take the place of those for all chats." : rules.length ? "These are all chats': forget one under All chats." : "";
    return row("What it may and may not do", "Rules are made where the agent asks, with Always allow in a chat. Forget one, and the next such call asks again.",
      m("div", { class: "nset-list" },
        items.length ? m("div", { class: "nset-items" }, ...items) : m("p", { class: "nset-none" }, "None yet."),
        note ? m("p", { class: "nset-none" }, note) : null),
      { wide: true });
  }
}
