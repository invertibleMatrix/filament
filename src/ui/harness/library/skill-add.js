// @ts-check
// Add to skill… (HarnessV4_Skills_Plan step 4, the Designer's of 10-27): a memory's words written into a skill made in
// Filament, under the section its kind belongs in — a rule under Rules, a how-to under How to work as its own heading
// and steps, a fact under Facts —, shown in place before they are written. Nothing goes in by a model alone: the person
// picks the skill, reads and may change the words, sees where they land, and presses Add. The memory stays as it is,
// its History saying where its words went; the lines are noted beside the skill, so the crafter keeps them.
// Built with an injected `h`, `api` and dialog, so it runs on the fake DOM.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { dialog } from "../lib/ui.js";
import { openNewSkill, whereWords } from "./skills.js";

/** The section each kind of memory goes under; another kind, Rules. */
const SECTION_OF = /** @type {Record<string, string>} */ ({ rule: "Rules", convention: "Rules", preference: "Rules", decision: "Rules", procedure: "How to work", fact: "Facts" });
/** How many of a section's last lines the preview shows above the new ones. */
const PREVIEW_LINES = 4;

/** The section a memory's kind goes under. @param {string} kind */
export const sectionFor = (kind) => SECTION_OF[kind] || "Rules";
/** Whether a memory of this kind can go into a skill: guidance, not work in flight (a thread) or a past session's words. @param {string} kind */
export const addsToSkill = (kind) => kind !== "thread" && kind !== "words";

/**
 * The lines a memory's words become: a bullet; a how-to written "How to <goal>: 1. … 2. …" its own `###` heading with
 * its steps numbered, as the agent reads a method.
 * @param {string} kind @param {string} words @returns {string[]}
 */
export function linesFor(kind, words) {
  const w = String(words || "").trim().replace(/\s*\n\s*/g, " ");
  const how = kind === "procedure" ? /^How to (.+?):\s*(1\.\s[\s\S]*)$/i.exec(w) : null;
  if (how) return [`### How to ${how[1].trim()}`, ...how[2].split(/\s+(?=\d+\.\s)/).map((s) => s.trim()).filter(Boolean)];
  return [`- ${w}`];
}

/**
 * A SKILL.md's `## ` headings, past its front matter and outside its code fences, each with its line.
 * @param {string[]} lines @returns {{ title: string, at: number }[]}
 */
function headings(lines) {
  /** @type {{ title: string, at: number }[]} */
  const out = [];
  let i = 0;
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    i++;
  }
  let fence = false;
  for (; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    else if (!fence) {
      const m = /^##\s+(.+?)\s*#*\s*$/.exec(lines[i]);
      if (m) out.push({ title: m[1], at: i });
    }
  }
  return out;
}

/** The `## ` sections a SKILL.md has, by title. @param {string} text */
export const sectionsOf = (text) => headings(String(text || "").split(/\r?\n/)).map((x) => x.title);

/**
 * A SKILL.md with lines added at the end of the section titled `title`, one missing made at the end of the file; its
 * line ends kept. → the new text, the section's last lines before them (for the preview), whether the section was
 * made, and whether it says those lines already.
 * @param {string} text @param {string} title @param {string[]} add
 * @returns {{ text: string, before: string[], made: boolean, already: boolean }}
 */
export function withLines(text, title, add) {
  const src = String(text || "");
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(/\r?\n/);
  const heads = headings(lines);
  const i = heads.findIndex((x) => x.title.toLowerCase() === title.toLowerCase());
  if (i < 0) {
    let end = lines.length;
    while (end > 0 && !lines[end - 1].trim()) end--;
    return { text: [...lines.slice(0, end), "", `## ${title}`, "", ...add].join(eol) + eol, before: [], made: true, already: false };
  }
  const start = heads[i].at;
  let end = heads[i + 1]?.at ?? lines.length;
  while (end > start + 1 && !lines[end - 1].trim()) end--;
  const body = lines.slice(start + 1, end);
  const said = new Set(body.map((l) => l.trim()));
  const already = add.every((l) => said.has(l.trim()));
  // A heading of its own (a how-to) stands apart from what is above it; a bullet joins the list it ends, and an empty
  // section's first line stands apart from its heading.
  const gap = end === start + 1 || add[0].startsWith("### ") ? [""] : [];
  return {
    text: [...lines.slice(0, end), ...gap, ...add, ...lines.slice(end)].join(eol),
    before: body.filter((l) => l.trim()).slice(-PREVIEW_LINES),
    made: false,
    already,
  };
}

/** @param {unknown} e */
const errText = (e) => String(/** @type {any} */ (e)?.message || e);
/** The skill picked last, picked first the next time. */
let lastSkill = "";

/**
 * The toast after an add: where it went, and who gets it — none, where the skill is on nowhere.
 * @param {string} id @param {string} skill @param {string} section @param {boolean} onSomewhere
 */
export function addedWords(id, skill, section, onSomewhere) {
  return `Added ${id} to ${skill}, under ${section}. ${onSomewhere ? "Chats where it is on get it from their next message." : `It is on nowhere: a message that tags it as $${skill} has the agent load it.`}`;
}

/**
 * Add to skill…: the dialog, from the skill picked to the words written.
 * @param {{ id: string, kind: string, text: string }} claim  the memory
 * @param {{ toast: (msg: string, kind?: string) => void }} cb
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, dialog?: typeof dialog }} [io]
 */
export function openAddToSkill(claim, cb, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const openDialog = io.dialog || dialog;
  const btn = (/** @type {string} */ label, /** @type {string} */ variant, /** @type {() => void} */ onClick) =>
    m("button", { class: `zc-btn zc-btn-v-${variant} zc-btn-s-sm`, type: "button", onclick: onClick }, m("span", { class: "zc-btn-label" }, label));
  const sheet = m("div", { class: "mcps-sheet skl-add" }, m("p", { class: "mcps-quiet" }, "Reading your skills…"));
  const d = openDialog({
    title: `Add ${claim.id} to a skill`,
    description: "Its words go into a skill made in Filament; you see them in place first. The memory stays as it is.",
    glyph: m("span", { class: "mcps-tile", "aria-hidden": "true", html: ICONS.wandSparkles }),
    body: sheet,
    wide: true,
  });
  /** The skills made in Filament, as the list answers them. @type {any[]} */
  let made = [];
  let picked = "";
  /** The picked skill's SKILL.md as it was read, and whether it is longer than the page reads. */
  let base = "";
  let cut = false;
  let section = sectionFor(claim.kind);
  let words = String(claim.text || "");
  /** Said over the preview: its SKILL.md changed while the dialog was open. */
  let moved = "";
  void load();

  /** The made skills, and the picked one's SKILL.md. @param {string} [want] */
  async function load(want = "") {
    try {
      const list = await call("/skills?place=all");
      made = (list?.skills || []).filter((/** @type {any} */ s) => s.kind === "made");
    } catch (e) {
      sheet.replaceChildren(m("p", { class: "mcps-failed" }, errText(e)));
      return;
    }
    if (!made.length) return paintNone();
    const names = made.map((s) => s.name);
    picked = [want, picked, lastSkill].find((n) => n && names.includes(n)) || names[0];
    await read();
  }

  /** The picked skill's SKILL.md, then the sheet. */
  async function read() {
    try {
      const page = await call(`/skills/${encodeURIComponent(picked)}`);
      base = String(page?.text || "");
      cut = !!page?.cut;
    } catch (e) {
      sheet.replaceChildren(m("p", { class: "mcps-failed" }, errText(e)));
      return;
    }
    paint();
  }

  /** No skill made here yet: only those are written; New skill… makes one, picked here once it is. */
  function paintNone() {
    sheet.replaceChildren(
      m("p", {}, "No skill made in Filament yet: only those are written here."),
      m("div", { class: "mcps-sheet-foot" }, btn("Cancel", "outline", () => d.close()), btn("New skill…", "default", () => newSkill())));
  }

  function newSkill() {
    openNewSkill({ h: m, api: call, dialog: openDialog, toast: cb.toast }, (name) => void load(name));
  }

  function paint() {
    const skill = made.find((s) => s.name === picked);
    const onSomewhere = !!skill?.places?.some((/** @type {any} */ p) => p.on);
    const pick = /** @type {HTMLSelectElement} */ (m("select", { class: "set-select", "aria-label": "Skill", onchange: () => { picked = pick.value; moved = ""; void read(); } },
      ...made.map((s) => m("option", { value: s.name, ...(s.name === picked ? { selected: "" } : {}) }, s.name))));
    const titles = [...new Set([sectionFor(claim.kind), ...sectionsOf(base)])];
    const where = /** @type {HTMLSelectElement} */ (m("select", { class: "set-select", "aria-label": "Section", onchange: () => { section = where.value; paintPreview(); } },
      ...titles.map((t) => m("option", { value: t, ...(t === section ? { selected: "" } : {}) }, t))));
    const text = /** @type {HTMLTextAreaElement} */ (m("textarea", { class: "zc-input mcps-note", rows: "3", "aria-label": "Its words", oninput: () => { words = String(text.value || ""); paintPreview(); } }));
    text.value = words;
    const preview = m("pre", { class: "skl-pre skl-add-preview", "aria-label": "Where it goes" });
    const note = m("p", { class: "mcps-hint" });
    const error = m("p", { class: "mcps-error", role: "alert" });
    const addBtn = btn(`Add to ${picked}`, "default", () => void add());
    /** A labelled row of the sheet. @param {string} k @param {...any} v */
    const field = (k, ...v) => m("div", { class: "mcps-field" }, m("span", { class: "mcps-k" }, k), m("div", { class: "mcps-v" }, ...v));
    sheet.replaceChildren(
      m("div", { class: "mcps-fields" },
        field("Skill", m("div", { class: "skl-add-pick" }, pick, btn("New skill…", "outline", () => newSkill())), m("span", { class: "mcps-hint" }, onSomewhere ? `It is ${whereWords(skill.places)}.` : `On nowhere: a message that tags it as $${skill.name} has the agent load it.`)),
        field("Its words", text, m("span", { class: "mcps-hint" }, "A skill speaks to the agents that load it: say it as they should take it.")),
        field("Goes under", where, m("span", { class: "mcps-hint" }, "in its SKILL.md"))),
      preview,
      note,
      error,
      m("div", { class: "mcps-sheet-foot" }, btn("Cancel", "outline", () => d.close()), addBtn));
    paintPreview();

    /** The section as it would read, the new lines marked; Add only where there is something new to write. */
    function paintPreview() {
      const add = linesFor(claim.kind, words);
      const got = withLines(base, section, add);
      preview.replaceChildren(
        m("span", { class: "skl-add-old" }, `## ${section}${got.made ? " — new, at the end" : ""}`),
        ...(got.before.length ? [m("span", { class: "skl-add-old" }, "…"), ...got.before.map((l) => m("span", { class: "skl-add-old" }, l))] : []),
        ...add.map((l) => m("span", { class: "skl-add-new" }, l)));
      const why = cut ? "Its SKILL.md is longer than the page reads: it is edited in its folder." : !words.trim() ? "" : got.already ? `${picked} says it already, under ${section}.` : "";
      note.replaceChildren(moved || why);
      addBtn.toggleAttribute("disabled", cut || !words.trim() || got.already);
    }

    async function add() {
      addBtn.setAttribute("disabled", "");
      error.replaceChildren("");
      // Read again just before the write: changed while the dialog was open, it is shown again first, never written over.
      let now = base;
      try {
        now = String((await call(`/skills/${encodeURIComponent(picked)}`))?.text || "");
      } catch (e) {
        error.replaceChildren(errText(e));
        paintPreview();
        return;
      }
      if (now !== base) {
        base = now;
        moved = "Its SKILL.md changed while this was open: this is where the words land now.";
        return paint();
      }
      const lines = linesFor(claim.kind, words);
      const got = withLines(base, section, lines);
      try {
        // `from`: the memory and the lines, noted beside the skill — Write it again keeps them — and on its History.
        await call(`/skills/${encodeURIComponent(picked)}/file`, { method: "PUT", body: { path: "SKILL.md", text: got.text, from: { memory: claim.id, section, lines } } });
      } catch (e) {
        error.replaceChildren(errText(e));
        paintPreview();
        return;
      }
      lastSkill = picked;
      d.close();
      cb.toast(addedWords(claim.id, picked, section, onSomewhere));
    }
  }
}
