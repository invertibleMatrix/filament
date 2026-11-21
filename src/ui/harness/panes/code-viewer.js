// @ts-check
// The code viewer (§5.9.3), docked as a file's own side-pane tab: a breadcrumb toolbar, a line-numbered pre
// (shiki-painted when the vendored grammar knows the extension, plain until it loads or if it fails), the
// assistant markdown renderer for .md files, images on a checker, and the endpoint's own refusals in its words.
// The ellipsis menu carries Wrap lines and the two copy paths; Open hands the file to the editor the header remembers
// (lib/editors.js), and stands where one opens it from this page.
// The run's pulse and a turn's end read the file again (`refreshCodeViewer`): the body is drawn where it changed. A
// file's tag with its lines (`#L10-40`) opens it scrolled to them, marked (`showLines`).
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { menu, tooltip } from "../lib/ui.js";
import { fileTag } from "../lib/labels.js";
import { chosenEditor, openInEditor } from "../lib/editors.js";
import { mdChat } from "../lib/md-stream.js";
import { paintFences, highlightCode, langOf } from "../lib/highlighter.js";
import { renderDiagrams } from "../lib/diagrams.js";
import { crumbsOf } from "./pane-data.js";

/** Each viewer drawn, by its root: what reads its file again. @type {WeakMap<Element, () => void>} */
const viewers = new WeakMap();
/** The lines a file's tag asked its tab to show (`showLines`), by the file, until a viewer of it takes them. @type {Map<string, { from: number, to: number }>} */
const wanted = new Map();
/**
 * The viewer drawn last of each file, by the file: its root, held weakly — a closed tab's viewer, its file's text and
 * its painted lines go with it. @type {Map<string, WeakRef<Element>>}
 */
const showing = new Map();
/** Each viewer drawn, by its root: what takes the lines asked of its file. @type {WeakMap<Element, () => void>} */
const takers = new WeakMap();
/** @param {string} cwd @param {string} path */
const fileKey = (cwd, path) => JSON.stringify([cwd, path]);

/**
 * A file's lines to show (the owner's LSP of 11-04: a tag's `#L10-40`, its chip pressed): its viewer scrolls to them
 * and marks them — at once where it stands on the page, else once a viewer of the file is drawn.
 * @param {string} cwd @param {string} path @param {string} range  `#L10` or `#L10-40`
 */
export function showLines(cwd, path, range) {
  const m = /^#L(\d+)(?:-(\d+))?$/.exec(range);
  if (!m) return;
  const from = Number(m[1]);
  const key = fileKey(cwd, path);
  wanted.set(key, { from, to: Math.max(from, Number(m[2] || from)) });
  const root = showing.get(key)?.deref();
  if (!root) showing.delete(key);
  // One that left the page takes none: the viewer drawn in its place does.
  else if (root.isConnected) takers.get(root)?.();
}

/**
 * The viewer in `body` reads its file again and draws what changed, its bar and a file as it was left standing: the
 * run's pulse and a turn's end drew the tab anew, its bar's buttons new elements under a resting pointer and the file
 * back to "Loading file..." (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost). False where
 * the body holds no viewer.
 * @param {HTMLElement} body
 */
export function refreshCodeViewer(body) {
  const root = body.firstElementChild;
  const again = root && viewers.get(root);
  if (!again) return false;
  again();
  return true;
}

/**
 * @param {HTMLElement} body
 * @param {{ path: string, cwd: string, chat?: any, openTab?: (id: string) => void, setBadge?: (n: number) => void, onInsert?: (text: string) => void }} ctx
 */
export function renderCodeViewer(body, ctx) {
  const { path, cwd } = ctx;
  const abs = `${String(cwd || "").replace(/[\\/]+$/, "")}/${path}`;
  const isMd = /\.md$/i.test(path);

  const crumbs = h("div", { class: "code-crumbs" });
  const tool = h("div", { class: "code-crumb" });
  const main = h("div", { class: "code-viewer" });
  const root = h("div", { class: "code-file-tab" }, h("div", { class: "code-bar" }, crumbs, tool), main);
  body.append(root);

  /** The body's wrap state; a pre honours it, the markdown renderer always wraps. */
  let wrap = true;
  let mdPreview = isMd;
  /** @type {any} */
  let data = null;
  /** Guards the async shiki swap: a wrap toggle or a re-fetch since the ask invalidates the older answer. */
  let paintSeq = 0;
  /** The lines a tag asked for (`showLines`), marked on each pre drawn; `toScroll` until they were scrolled to. @type {{ from: number, to: number } | null} */
  let marked = null;
  let toScroll = false;
  /**
   * The marked lines on a pre: the plain one's `.code-line`s, shiki's `.line`s. They are scrolled to once the pre is laid
   * out — a tab behind the chat or a pane put away is not, and is scrolled at its next read, as it shows.
   * @param {Element} pre
   */
  const markIn = (pre) => {
    const m = marked;
    if (!m) return;
    const rows = Array.from(pre.querySelectorAll(".code-line, .line"));
    rows.forEach((row, i) => row.classList.toggle("is-marked", i + 1 >= m.from && i + 1 <= m.to));
    const first = rows[m.from - 1];
    if (toScroll && first && first.getClientRects().length) {
      first.scrollIntoView({ block: "center" });
      toScroll = false;
    }
  };
  /** The lines asked of this file taken: a markdown file shows its source, where its lines are. */
  const take = () => {
    const w = wanted.get(fileKey(cwd, path));
    if (!w) return;
    wanted.delete(fileKey(cwd, path));
    marked = w;
    toScroll = true;
    if (mdPreview) {
      mdPreview = false;
      paintTool();
      paintBody();
      return;
    }
    const pre = main.querySelector(".code-pre");
    if (pre) markIn(pre);
  };

  const paintCrumbs = () => {
    const parts = crumbsOf(cwd, path);
    crumbs.replaceChildren(
      ...parts.map((part, i) =>
        i < parts.length - 1
          ? [h("span", { class: "code-crumb-part" }, part), h("span", { class: "code-crumb-sep", html: ICONS.chevronRight })]
          : [h("span", { class: "code-crumb-file" }, h("span", { class: "code-crumb-ic", html: ICONS.fileCode2 }), part)]).flat(2),
    );
  };

  const paintTool = () => {
    // The header's choice, as every open button on the page follows it; none on another machine's page the rail reached
    // by no SSH alias (the owner's remote Filament of 11-06): no Open.
    const ed = chosenEditor();
    const openBtn = ed ? h("button", { class: "ghost sm", type: "button", title: `Open in ${ed.label}`, onclick: () => openInEditor(abs) }, "Open") : null;
    const mdBtn = isMd
      ? h("button", {
        class: `ghost sm${mdPreview ? " on" : ""}`, type: "button", title: "Source preview", html: ICONS.fileCode2,
        onclick: () => { mdPreview = !mdPreview; paintTool(); paintBody(); },
      })
      : null;
    const wrapBtn = h("button", {
      class: `ghost sm${wrap ? " on" : ""}`, type: "button", html: ICONS.wrap,
      onclick: () => { wrap = !wrap; paintTool(); paintBody(); },
    });
    tooltip(wrapBtn, { title: "Wrap lines" });
    const more = h("button", { class: "ghost sm", type: "button", title: "More", html: ICONS.ellipsis });
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      menu([
        { type: "check", label: "Wrap lines", checked: wrap, onClick: () => { wrap = !wrap; paintTool(); paintBody(); } },
        { type: "separator" },
        { label: "Copy absolute path", onClick: () => navigator.clipboard.writeText(abs).catch(() => {}) },
        { label: "Copy relative path", onClick: () => navigator.clipboard.writeText(path).catch(() => {}) },
        ...(ctx.onInsert ? [{ label: "Add to chat", onClick: () => ctx.onInsert?.(`${fileTag(path)} `) }] : []),
      ], { anchor: more, side: "bottom", align: "end", width: 208 });
    });
    tool.replaceChildren(...[mdBtn, wrapBtn, openBtn, more].filter(Boolean));
  };

  const paintBody = () => {
    if (!data) return;
    const r = data;
    if (r.kind === "binary") {
      main.replaceChildren(h("p", { class: "pane-empty" }, "This file looks like binary data and cannot be previewed as code yet."));
      return;
    }
    if (r.kind === "image" && r.dataUrl) {
      main.replaceChildren(h("div", { class: "code-img-wrap" }, h("img", { class: "code-img", src: r.dataUrl, alt: r.name || path })));
      return;
    }
    if (mdPreview && isMd && typeof r.content === "string") {
      // h() filters the nulls — replaceChildren itself would not.
      const mdEl = h("div", { class: "a-md md-file" + (wrap ? "" : " nowrap"), html: mdChat(r.content, null).out });
      main.replaceChildren(h("div", {},
        mdEl,
        r.truncated ? h("p", { class: "pane-note" }, r.note || "The file was cut at the read limit.") : null));
      paintFences(mdEl).catch(() => {});
      renderDiagrams(mdEl).catch(() => {});
      return;
    }
    const lines = String(r.content || "").split("\n");
    if (lines.length && lines.at(-1) === "") lines.pop();
    const plain = h("pre", { class: `code-pre${wrap ? " wrap" : ""}` },
      ...lines.map((l, i) => h("span", { class: "code-line" }, h("span", { class: "code-no" }, String(i + 1)), l || " ")));
    main.replaceChildren(h("div", {},
      plain,
      r.truncated ? h("p", { class: "pane-note" }, r.note || "The file was cut at the read limit.") : null));
    markIn(plain);
    // The highlighted pre replaces the plain one when shiki arrives; a wrap toggle since rebuilds and re-asks.
    const seq = ++paintSeq;
    const ext = path.split(".").pop() || "";
    if (langOf(ext)) {
      highlightCode(String(r.content || ""), ext).then((shiny) => {
        if (!shiny || seq !== paintSeq || !plain.isConnected) return;
        shiny.classList.toggle("wrap", wrap);
        plain.replaceWith(shiny);
        markIn(shiny);
      }).catch(() => {});
    }
  };

  /** What the body shows: the read's answer as text, or "failed" — the same answer read again draws nothing. */
  let shown = "";
  /**
   * The file read, and the body drawn where the read answers something else than it shows; lines asked for and not yet
   * scrolled to, where the viewer was out of sight, are scrolled to now.
   */
  const read = () => api(`/files/read?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`)
    .then((r) => {
      const key = JSON.stringify(r);
      if (key === shown) {
        const pre = main.querySelector(".code-pre");
        if (toScroll && pre) markIn(pre);
        return;
      }
      shown = key;
      data = r;
      paintBody();
    })
    .catch(() => {
      if (shown === "failed") return;
      shown = "failed";
      data = null;
      main.replaceChildren(h("div", { class: "pane-empty" }, "The file does not exist, or this environment cannot access that path."));
    });

  paintCrumbs();
  paintTool();
  main.replaceChildren(h("div", { class: "pane-empty" }, "Loading file..."));
  viewers.set(root, read);
  showing.set(fileKey(cwd, path), new WeakRef(root));
  takers.set(root, take);
  take();
  read();
}
