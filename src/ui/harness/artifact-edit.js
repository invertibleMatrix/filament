// @ts-check
// A Doc's or a deck's text, edited in its full view (HarnessV4_Artifacts_Plan E18 step 6, AFC-115..AFC-117): its
// Markdown beside its page, which shows each change as it is typed — a deck at the slide the caret is in. Save, or
// Ctrl+S, keeps it as the next version, made by you; Cancel asks first only when something changed. A version that
// came while you edited is said at once, with Save anyway — yours the newest, theirs kept in Versions — and Discard
// mine; a Save that meets one says the same. What you typed outlives the view: Back, or another chat, keeps it, and
// the view opened again is in Edit with it.
import { h } from "../lib/dom.js";
import { api } from "./lib/api.js";
import { confirmDialog, toast } from "./lib/ui.js";
import { versionBy } from "./lib/artifacts.js";
import { slideAt, splitSlides } from "../artifacts/deck.js";

/** @typedef {import("./lib/artifacts.js").ArtifactSeen} ArtifactSeen */
/** @typedef {{ base: number, start: string, text: string }} Draft  the version begun from, its text then, the text now */

/** What the developer typed and has not saved, by artifact. @type {Map<string, Draft>} */
const drafts = new Map();
/** Whether an artifact has text typed and not saved (AFC-117). @param {string} name */
export const hasDraft = (name) => drafts.has(name);

/** How long typing rests before the page beside it shows the text. */
const SHOW_AFTER_MS = 120;
/** A refusal's words, without their last stop. @param {unknown} e */
const said = (e) => String(/** @type {any} */ (e)?.message || e).replace(/\.$/, "");
/** The keys that save, as this machine writes them. */
const SAVE_KEYS = /Mac|iPhone|iPad/.test(navigator.platform || "") ? "⌘S" : "Ctrl+S";

/**
 * @param {string} name
 * @param {{ draft: (markdown: string, at: number) => void, onLeave: () => void, onChange: () => void }} o
 *   `draft`: the page beside it shows the text; `onLeave`: the view goes back to its page alone; `onChange`: whether
 *   something changed, for Save
 */
export function artifactEditor(name, o) {
  const text = /** @type {HTMLTextAreaElement} */ (h("textarea", { class: "artifact-edit-text", spellcheck: "true", "aria-label": "Its text, in Markdown" }));
  const where = h("span", { class: "artifact-edit-where" });
  const staleWords = h("span", { class: "artifact-note-text" });
  const anyway = h("button", { class: "visual-act", type: "button", title: "Keep your text as the newest version; the one that came stays in Versions" }, "Save anyway");
  const discard = h("button", { class: "visual-act", type: "button", title: "Leave Edit; your text is lost" }, "Discard mine");
  const stale = h("div", { class: "artifact-edit-stale hidden", role: "status" }, staleWords, anyway, discard);
  const el = h("div", { class: "artifact-edit hidden" },
    h("div", { class: "artifact-edit-head" }, where, h("span", { class: "grow" }), h("span", { class: "artifact-edit-hint" }, `Markdown · ${SAVE_KEYS} saves`)),
    stale, text);

  /** @type {Draft | null} */
  let cur = null;
  /** @type {ArtifactSeen | null} */
  let record = null;
  let saving = false;
  let timer = 0;
  let slideShown = -1;

  /** The page beside it shows the text, and where the caret is. */
  const show = () => {
    window.clearTimeout(timer);
    if (!cur) return;
    o.draft(text.value, text.selectionStart);
    slideShown = record?.type === "slides" ? slideAt(splitSlides(text.value), text.selectionStart) : -1;
  };
  const showSoon = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(show, SHOW_AFTER_MS);
  };
  /** A version that came since the one begun from, said with what to do (AFC-116). */
  const paintStale = () => {
    const newest = record?.versions.at(-1);
    const came = !!(cur && record && newest && newest.v > cur.base);
    stale.classList.toggle("hidden", !came);
    if (came && record && newest && cur) staleWords.textContent = `${record.title} changed while you edited it: v${newest.v}, ${versionBy(newest, record.chats)}. Your text is kept.`;
    where.textContent = cur ? `Editing, from v${cur.base}` : "";
  };
  const leave = () => {
    drafts.delete(name);
    cur = null;
    el.classList.add("hidden");
    o.onLeave();
  };

  text.addEventListener("input", () => {
    if (!cur) return;
    cur.text = text.value;
    o.onChange();
    showSoon();
  });
  // A deck follows the caret from slide to slide (AFC-115): moved by a key, a click or a selection.
  const onCaret = () => {
    if (!cur || record?.type !== "slides") return;
    if (slideAt(splitSlides(text.value), text.selectionStart) !== slideShown) showSoon();
  };
  for (const kind of ["selectionchange", "select", "keyup", "click"]) text.addEventListener(kind, onCaret);
  text.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void editor.save(false);
    }
  });
  anyway.addEventListener("click", () => void editor.save(true));
  discard.addEventListener("click", leave);

  const editor = {
    el,
    /** Whether it is open. */
    get open() {
      return !!cur;
    },
    /** Whether the text differs from the version begun from. */
    get changed() {
      return !!cur && cur.text !== cur.start;
    },
    /** The artifact as it stands now: a version that came is said at once. @param {ArtifactSeen} a */
    record(a) {
      record = a;
      paintStale();
    },
    /**
     * Begin, from the newest version's text — or the text typed before, kept (AFC-117). Whether it began.
     * @param {ArtifactSeen} a @returns {Promise<boolean>}
     */
    async begin(a) {
      record = a;
      let d = drafts.get(name);
      if (!d) {
        try {
          const r = /** @type {{ v: number, markdown: string }} */ (await api(`/artifacts/${encodeURIComponent(name)}/text`));
          d = { base: r.v, start: r.markdown, text: r.markdown };
        } catch (e) {
          toast(`${a.title} cannot be edited now: ${said(e)}.`, "err");
          return false;
        }
        drafts.set(name, d);
      }
      cur = d;
      text.value = d.text;
      el.classList.remove("hidden");
      paintStale();
      text.focus();
      show();
      return true;
    },
    /** The page beside it loaded again — a new version came: it shows the text again. */
    again() {
      if (cur) show();
    },
    /** Keep the text as the next version (AFC-115); `force` over a version that came (AFC-116). @param {boolean} force */
    async save(force) {
      if (!cur || saving) return;
      if (!force && cur.text === cur.start) return leave();
      saving = true;
      o.onChange();
      try {
        const r = /** @type {ArtifactSeen & { unchanged?: boolean }} */ (
          await api(`/artifacts/${encodeURIComponent(name)}/versions`, { method: "POST", body: { markdown: cur.text, base: cur.base, ...(force ? { force: true } : {}) } }));
        toast(r.unchanged ? `Nothing changed in ${r.title}` : `Saved ${r.title}: v${r.versions.length}, by you`);
        leave();
      } catch (e) {
        const err = /** @type {any} */ (e);
        if (err?.status === 409 && err.body?.versions) {
          record = err.body;
          paintStale();
        } else toast(`Not saved: ${said(e)}.`, "err");
      } finally {
        saving = false;
        o.onChange();
      }
    },
    /** Leave Edit: asked first where something changed. */
    async cancel() {
      if (cur && cur.text !== cur.start) {
        const yes = await confirmDialog({
          title: `Discard your changes to “${record?.title || name}”?`,
          description: "What you typed since you began is lost. The artifact stays as it is.",
          confirmLabel: "Discard",
          destructive: true,
        });
        if (!yes) return;
      }
      leave();
    },
    /** The artifact is gone: what was typed for it goes too. */
    gone() {
      if (cur) leave();
    },
    /** Whether a save is on its way. */
    get saving() {
      return saving;
    },
  };
  return editor;
}
