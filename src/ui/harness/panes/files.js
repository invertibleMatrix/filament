// @ts-check
// The Files pane (§5.9.3): the project folder as a lazy tree, git-status letters joined on from the
// project's status when the folder is a repository, a filter that falls back to the name search, a
// changed-files-only toggle, and a context menu (Open, Add to chat, Copy absolute/relative path,
// Show in Changes when changed). A click opens the file as its own code-viewer tab. Drawn again — the run's
// pulse, a turn's end, its tab shown again — it keeps what the developer had open: the folders, the filter and
// Show changed files only; a draw once its read is a few seconds old reads the tree again where it stands.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { menu, tooltip } from "../lib/ui.js";
import { fileTag } from "../lib/labels.js";
import { statusLetter } from "./pane-data.js";
import { showChanges } from "./changes.js";

/** The project folders whose tree and git status the pane keeps: past these, the one drawn longest ago goes. */
export const FOLDERS_KEPT = 8;
/** How long a tree as drawn is shown again as it stands; a draw after it reads the tree again where it stands. */
const TREE_FRESH_MS = 8000;
/**
 * project cwd → its tree as last drawn: the pane's root as the developer left it, when it was read, and its read again
 * where it stands. @type {Map<string, { at: number, el: HTMLElement, again: () => void }>}
 */
const filesCache = new Map();
/** project cwd → its git status (by kind), remembered briefly so typing in the filter refetches nothing. @type {Map<string, { at: number, byPath: Map<string, any>, files: any[] }>} */
const gitCache = new Map();

/** A folder's entry kept as the newest, the oldest let go past FOLDERS_KEPT folders. @template T @param {Map<string, T>} m @param {string} cwd @param {T} v */
const keep = (m, cwd, v) => {
  m.delete(cwd);
  m.set(cwd, v);
  for (const k of [...m.keys()].slice(0, Math.max(0, m.size - FOLDERS_KEPT))) m.delete(k);
};

/**
 * @param {HTMLElement} body
 * @param {{ chat: any, onInsert?: (text: string) => void, openFileTab?: (f: { path: string, cwd: string }) => void, openTab?: (id: string) => void, setBadge?: (n: number) => void }} ctx
 */
export function renderFiles(body, ctx) {
  const cwd = ctx.chat?.cwd || "";
  const cached = filesCache.get(cwd);
  // A pane drawn again keeps what the developer had open, and refetches nothing while its read is fresh.
  if (cached) {
    body.append(cached.el);
    keep(filesCache, cwd, cached);
    if (Date.now() - cached.at >= TREE_FRESH_MS) cached.again();
    return;
  }
  if (!cwd) {
    body.append(h("div", { class: "pane-empty" }, "Name the project folder first. The file tree lists that folder."));
    return;
  }
  const filter = h("input", { class: "zc-input", type: "text", placeholder: "Search files...", "aria-label": "Search files" });
  const changedBtn = h("button", { class: "ghost sm", type: "button" }, "Show changed files only");
  tooltip(changedBtn, { title: "Show changed files only" });
  const refresh = h("button", { class: "ghost sm", type: "button", title: "Refresh file tree", html: ICONS.rotateCcw });
  const tree = h("div", { class: "file-tree" });
  const root = h("div", { class: "files" },
    h("div", { class: "pane-toolbar" }, filter, changedBtn, refresh),
    tree);
  body.append(root);

  /** @type {Map<string, any>} */
  let gitByPath = new Map();
  /** @type {any[]} */
  let gitFiles = [];
  let changedOnly = false;
  /** The folders open, by path: the tree read again where it stands opens them again. @type {Set<string>} */
  const opened = new Set();
  /** What the tree shows: the folder's tree, the changed files, or the search's matches. @type {"tree" | "changed" | "search"} */
  let shows = "tree";
  /** The tree's paints, counted: an answer that lands after a newer paint began draws nothing. */
  let paints = 0;
  const kept = { at: Date.now(), el: root, again: () => again() };
  keep(filesCache, cwd, kept);

  /** The project's git status, joined onto the tree rows by path; a non-repository is no letters at all. */
  const loadGit = async () => {
    const hit = gitCache.get(cwd);
    if (hit && Date.now() - hit.at < 30000) { gitByPath = hit.byPath; gitFiles = hit.files; return; }
    try {
      const st = await api(`/git/status?cwd=${encodeURIComponent(cwd)}`);
      const files = st?.ok ? st.files || [] : [];
      gitByPath = new Map(files.map((/** @type {any} */ f) => [String(f.path).replace(/\\/g, "/"), f]));
      gitFiles = files;
      keep(gitCache, cwd, { at: Date.now(), byPath: gitByPath, files });
    } catch {
      gitByPath = new Map();
      gitFiles = [];
    }
  };

  /**
   * A folder's entries drawn in `host` — the tree's own, or an open folder's — or why they could not be read, in their
   * place: the tree's as the pane says a failure, a folder's as its "Nothing here." is said.
   * @param {string} path @param {HTMLElement} host @param {number} depth
   */
  const load = async (path, host, depth) => {
    const own = host === tree;
    const n = own ? ++paints : 0;
    if (own) shows = "tree";
    host.replaceChildren(h("div", { class: "pane-note" }, "Loading…"));
    try {
      const r = await api(`/files/tree?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}&depth=1`);
      if (own && n !== paints) return;
      const entries = r?.entries || [];
      if (!entries.length) host.replaceChildren(h("div", { class: "pane-note" }, "Nothing here."));
      else host.replaceChildren(...entries.map((/** @type {any} */ e) => row(e, depth)));
    } catch (e) {
      if (own && n !== paints) return;
      host.replaceChildren(h("div", { class: own ? "pane-empty" : "pane-note file-tree-failed" }, String(/** @type {any} */ (e)?.message || e)));
    }
  };

  /** @param {string} path  the context menu both rows share */
  const rowMenu = (path) => {
    const git = gitByPath.get(String(path).replace(/\\/g, "/"));
    return [
      { label: "Open", icon: "fileCode2", onClick: () => ctx.openFileTab?.({ path, cwd }) },
      ctx.onInsert ? { label: "Add to chat", onClick: () => ctx.onInsert?.(`${fileTag(path)} `) } : null,
      { label: "Copy absolute path", onClick: () => navigator.clipboard.writeText(`${cwd.replace(/[\\/]+$/, "")}/${path}`).catch(() => {}) },
      { label: "Copy relative path", onClick: () => navigator.clipboard.writeText(path).catch(() => {}) },
      // Only for a file the status names: Changes shows it in Branch, among the uncommitted (GWC-38).
      git
        ? { label: "Show in Changes", onClick: () => { showChanges({ scope: "branch", file: { path: String(path).replace(/\\/g, "/") } }); ctx.openTab?.("changes"); } }
        : null,
    ].filter(Boolean);
  };

  /** @param {any} e @param {number} depth */
  const row = (e, depth) => {
    const dir = e.kind === "dir";
    const p = String(e.path).replace(/\\/g, "/");
    const git = gitByPath.get(p);
    const letter = git ? statusLetter(git) : null;
    const el = h("button", {
      class: "file-tree-row", type: "button", style: `padding-left:${8 + depth * 12}px`, title: p,
      "aria-label": e.name,
    },
      h("span", { class: "file-tree-ic", html: dir ? ICONS.chevronRight : ICONS.file }),
      h("span", { class: `file-tree-name${letter ? ` git-${letter.cls}` : ""}` }, e.name),
      letter ? h("span", { class: `git-letter ${letter.cls}` }, letter.letter) : null);
    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      menu(rowMenu(p), { anchor: /** @type {HTMLElement} */ (el), side: "bottom", align: "start", width: 200 });
    });
    const kids = h("div", { class: "file-tree-kids hidden" });
    /** The folder open or shut; opened, its entries read where they are not yet, or could not be. @param {boolean} on */
    const show = (on) => {
      kids.classList.toggle("hidden", !on);
      el.querySelector(".file-tree-ic")?.classList.toggle("open", on);
      if (on) opened.add(p);
      else opened.delete(p);
      if (on && (!kids.childElementCount || kids.firstElementChild?.classList.contains("file-tree-failed"))) void load(e.path, kids, depth + 1);
    };
    el.addEventListener("click", () => {
      if (dir) show(kids.classList.contains("hidden"));
      else ctx.openFileTab?.({ path: p, cwd });
    });
    // A folder the developer left open opens again as the tree is read again.
    if (dir && opened.has(p)) show(true);
    return h("div", {}, el, dir ? kids : null);
  };

  /** The changed files only: one flat list from the status, letters attached. */
  const paintChanged = () => {
    ++paints;
    shows = "changed";
    if (!gitFiles.length) {
      tree.replaceChildren(h("div", { class: "pane-empty" }, "No changed files — the working tree is clean, or this folder is not a repository."));
      return;
    }
    tree.replaceChildren(...gitFiles.map((f) => {
      const letter = statusLetter(f);
      const el = h("button", { class: "file-tree-row", type: "button", title: f.path },
        h("span", { class: "file-tree-ic", html: ICONS.file }),
        h("span", { class: `file-tree-name git-${letter.cls}` }, f.path),
        h("span", { class: `git-letter ${letter.cls}` }, letter.letter));
      el.addEventListener("click", () => ctx.openFileTab?.({ path: f.path, cwd }));
      el.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        menu(rowMenu(f.path), { anchor: /** @type {HTMLElement} */ (el), side: "bottom", align: "start", width: 200 });
      });
      return el;
    }));
  };

  /** The folder's tree from its top, every folder shut — the toolbar's own way back to it. */
  const loadTop = () => {
    opened.clear();
    void load("", tree, 0);
  };

  changedBtn.addEventListener("click", () => {
    changedOnly = !changedOnly;
    changedBtn.classList.toggle("on", changedOnly);
    kept.at = Date.now();
    if (changedOnly) paintChanged();
    else loadTop();
  });

  refresh.addEventListener("click", () => {
    gitCache.delete(cwd);
    kept.at = Date.now();
    const n = paints;
    void loadGit().then(() => {
      if (n !== paints) return;
      if (changedOnly) paintChanged();
      else loadTop();
    });
  });

  filter.addEventListener("input", () => {
    const q = filter.value.trim();
    if (!q) {
      if (changedOnly) paintChanged();
      else loadTop();
      return;
    }
    void search(q);
  });

  /** The search's matches for the filter's words. @param {string} q */
  const search = async (q) => {
    const n = ++paints;
    shows = "search";
    tree.replaceChildren(h("div", { class: "pane-note" }, "Searching…"));
    // A search that failed says why, in the server's words: git refusing the folder's repository among them.
    const r = await api(`/files/search?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(q)}&limit=50`).catch((/** @type {any} */ e) => ({ failed: String(e?.message || e) }));
    // Words typed since, or another paint of the tree: this answer is not what the pane shows now.
    if (n !== paints) return;
    const found = r?.files || [];
    if (!found.length) { tree.replaceChildren(h("div", { class: "pane-empty" }, r.failed ? `The search failed: ${r.failed}` : "No matching files.")); return; }
    tree.replaceChildren(...found.map((/** @type {any} */ f) => {
      const p = String(f.path).replace(/\\/g, "/");
      const el = h("button", { class: "file-tree-row", type: "button", title: p },
        h("span", { class: "file-tree-ic", html: ICONS.file }),
        h("span", { class: "file-tree-name" }, f.name),
        h("span", { class: "file-tree-dir" }, p.slice(0, -f.name.length)));
      el.addEventListener("click", () => ctx.openFileTab?.({ path: p, cwd }));
      el.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        menu(rowMenu(p), { anchor: /** @type {HTMLElement} */ (el), side: "bottom", align: "start", width: 200 });
      });
      return el;
    }));
  };

  /**
   * The tree read again where it stands — the search's matches, the changed files, or the folder's tree with the
   * folders left open — unless the developer moved it while the status was read.
   */
  const again = () => {
    kept.at = Date.now();
    const n = paints;
    void loadGit().then(() => {
      if (n !== paints) return;
      if (shows === "search") void search(filter.value.trim());
      else if (shows === "changed") paintChanged();
      else void load("", tree, 0);
    });
  };

  const first = paints;
  void loadGit().then(() => {
    if (first === paints) void load("", tree, 0);
  });
}

/**
 * The host's pulse: the tree stays as it stands, nothing read — a running turn's pulses never take back the folders
 * the developer opened, nor Show changed files only; a body that shows another folder's tree, or none, is drawn afresh.
 * A turn's end, the chat idle, reads a tree a few seconds old again where it stands, as a draw does: what the turn
 * wrote shows in the folders left open.
 * @param {HTMLElement} body @param {Parameters<typeof renderFiles>[1]} ctx
 */
export function refreshFiles(body, ctx) {
  const cached = filesCache.get(ctx.chat?.cwd || "");
  if (cached && body.contains(cached.el)) {
    if (!ctx.chat?.live && Date.now() - cached.at >= TREE_FRESH_MS) cached.again();
    return;
  }
  body.replaceChildren();
  renderFiles(body, ctx);
}
