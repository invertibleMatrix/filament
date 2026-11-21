// @ts-check
// The Outputs pane (HarnessV4_Four_Plan E20): the files the chat's agents wrote that git does not show you — outside
// any repository, or inside one that git ignores (FO-D21, FO-D22) — newest first, each as it stands now (FO-D23). A
// row opens its file beside the chat (FO-D25); Show in folder opens the OS file manager on it — on another machine's
// page (the owner's remote Filament of 11-06), where that would open on its screen, Copy path stands in. The files git
// sees are Changes'. It only shows: nothing here moves, deletes or writes a file. Each read is drawn in place (dom.js
// `morphChildren`): the rows and buttons that stood stay, with the newest read's words and handlers.
import { h, morphChildren } from "../../lib/dom.js";
import { api, remotePage } from "../lib/api.js";
import { ICONS, icon } from "../lib/icons.js";
import { menu, tooltip } from "../lib/ui.js";
import { chosenEditor, openInEditor } from "../lib/editors.js";
import { placeName, sizeWords } from "../lib/labels.js";
import { newestTurn } from "../lib/turn-changes.js";
import { ageOf } from "./pane-data.js";
import { agentName, fileCount } from "./changes-data.js";

/**
 * What the pane is handed beside the host's own: the chat's sub-agents, to name a helper that wrote a file, and Show in
 * folder, which answers in words where the file manager could not be opened.
 * @typedef {{ chat: any, setBadge?: (n: number) => void, openFileTab: (f: { path: string, cwd: string }) => void,
 *   subagents: () => import("../lib/subagents.js").SubagentRow[], reveal: (path: string) => void,
 *   toast?: (msg: string, kind?: string) => void }} OutputsCtx
 * @typedef {{ path: string, name: string, folder: string, size: number, mtimeMs: number, agent: string, turn: number | null, ignoredIn: string | null }} OutputFile
 *   a file as `/api/memory/sessions/:id/outputs` answers it: `agent` "" is yours, `ignoredIn` the repository whose git
 *   ignores it (null outside any)
 */

/** The pane's words where it has no file to list (FOC-45, FOC-49). */
export const NOTHING_YET = "Nothing yet. Files your agents write outside git show here.";
export const NO_CHAT = "Files this chat's agents write outside git show here once it has a turn.";
export const SNAPSHOTS_OFF = "Filament keeps what its agents write with working-tree snapshots on; they are off in this chat.";
/** What the list never holds (FO-D21's downside, FOC-48). */
export const COMMANDS_NOTE = "Files a command made are not listed: Filament sees the files its agents' write and edit calls make.";

/**
 * The words of the files no longer where they were written (FO-D23): "1 is no longer where it was written".
 * @param {number} n
 */
export const goneWords = (n) => (n === 1 ? "1 is no longer where it was written" : `${n} are no longer where they were written`);

/**
 * A folder in a row, short: its last two folders, the whole one in the row's title. @param {string} folder
 */
export function folderWords(folder) {
  const whole = String(folder || "").replace(/\\/g, "/").replace(/(.)\/+$/, "$1");
  const parts = whole.split("/").filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : whole;
}

/** The mark a file's name earns. @param {string} name */
export function markOf(name) {
  const ext = String(name).split(".").pop()?.toLowerCase() || "";
  if (/^(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/.test(ext)) return "image";
  if (/^(md|txt|log|csv|rst)$/.test(ext)) return "fileText";
  if (/^(js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|cs|cpp|c|h|json|ya?ml|toml|html|css|sh|ps1|sql|xml)$/.test(ext)) return "fileCode2";
  return "file";
}

/**
 * A row's second line: its folder, its size, when it last changed, who wrote it, and the repository that ignores it.
 * @param {OutputFile} f @param {string} who @param {number} [now]
 */
export function rowFacts(f, who, now = Date.now()) {
  return [folderWords(f.folder), sizeWords(f.size), ageOf(f.mtimeMs, now), who, f.ignoredIn ? `ignored by git, in ${placeName(f.ignoredIn)}` : ""]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The pane on screen, which the run's pulse refreshes in place.
 * @type {{ chat: any, root: HTMLElement, pulse: () => void } | null}
 */
let drawn = null;

/** @param {HTMLElement} body @param {OutputsCtx} ctx */
export function renderOutputs(body, ctx) {
  drawn = createPane(body, ctx);
}

/**
 * The run's pulse: the pane on screen reads again when a round wrote, or the turn ended.
 * @param {HTMLElement} body @param {OutputsCtx} ctx
 */
export function refreshOutputs(body, ctx) {
  if (!drawn || drawn.chat !== ctx.chat || !body.contains(drawn.root)) {
    body.replaceChildren();
    renderOutputs(body, ctx);
    return;
  }
  drawn.pulse();
}

/** @param {HTMLElement} body @param {OutputsCtx} ctx */
function createPane(body, ctx) {
  const chat = ctx.chat;
  const count = h("span", { class: "out-count" });
  const again = h("button", { class: "ghost icon", type: "button", "aria-label": "Read again", html: ICONS.rotateCcw, onclick: () => load({ keep: true }) });
  tooltip(again, { title: "Read again" });
  const list = h("div", { class: "out-list" });
  const root = h("div", { class: "out" }, h("div", { class: "out-bar" }, count, h("span", { class: "grow" }), again), list);
  body.append(root);

  let seq = 0;
  /** Whether the gone files' fold is open. */
  let goneOpen = false;
  /** @type {any} */
  let answer = null;
  /** The newest turn's snapshots at the last read, and whether it ran then. */
  let snaps = 0;
  let wasLive = false;
  const isLive = () => !!newestTurn(chat) && chat?.live?.turn === newestTurn(chat);
  const snapsOf = () => (chat?.live?.events || []).filter((/** @type {any} */ e) => e?.type === "snapshot").length;
  const snapshotsOff = () => chat?.view?.settings?.effective?.loop?.treeSnapshots === false;

  /** @param {{ keep?: boolean }} [o] */
  async function load({ keep = false } = {}) {
    const mine = ++seq;
    snaps = snapsOf();
    wasLive = isLive();
    if (!chat?.chainId) {
      answer = { files: [], gone: [], errors: [] };
      return draw(false);
    }
    if (!keep) list.replaceChildren(h("div", { class: "pane-empty" }, "Reading…"));
    let got;
    try {
      got = await api(`/memory/sessions/${encodeURIComponent(chat.chainId)}/outputs`);
    } catch (/** @type {any} */ e) {
      got = { error: String(e?.message || e) };
    }
    if (mine !== seq) return;
    answer = got;
    draw(keep);
  }

  /**
   * The list drawn in place: each row keyed by its file's path and each other part by what it is, so a read landing — a
   * round that wrote, the turn's end, Read again — keeps the rows and buttons that stood, which a list made anew put
   * under a resting pointer as new elements (the owner's of 11-01: buttons blinking under a resting pointer, clicks
   * lost).
   * @param {boolean} keep
   */
  function draw(keep) {
    const top = list.scrollTop;
    const files = /** @type {OutputFile[]} */ (answer?.files || []);
    count.textContent = files.length ? fileCount(files.length) : "";
    ctx.setBadge?.(files.length);
    /** @type {HTMLElement[]} */
    const out = [];
    if (answer?.error) out.push(h("div", { class: "pane-empty", "data-key": "empty" }, answer.error));
    else if (!files.length) out.push(h("div", { class: "pane-empty", "data-key": "empty" }, !chat?.chainId ? NO_CHAT : snapshotsOff() ? SNAPSHOTS_OFF : NOTHING_YET));
    const rows = ctx.subagents() || [];
    if (files.length)
      out.push(h("div", { class: "out-group", "data-key": "files" }, ...files.map((f) => fileRow(f, agentName(f.agent, f.agent ? rows.find((r) => r.id === f.agent) || null : null).name))));
    for (const e of answer?.errors || []) out.push(h("div", { class: "out-error", "data-key": `error:${e.place}` }, h("b", {}, `${placeName(e.place)}: `), e.error));
    const gone = answer?.gone || [];
    if (gone.length) {
      const fold = h("button", { class: `out-fold${goneOpen ? " open" : ""}`, "data-key": "gone", type: "button", "aria-expanded": String(goneOpen), onclick: () => { goneOpen = !goneOpen; draw(true); } },
        h("span", { class: "out-chev", html: ICONS.chevronRight }), goneWords(gone.length));
      out.push(fold);
      if (goneOpen) for (const g of gone) out.push(h("div", { class: "out-gone", "data-key": `gone:${g.path}`, title: g.path }, g.path));
    }
    if (files.length || gone.length) out.push(h("p", { class: "pane-note out-note", "data-key": "note" }, COMMANDS_NOTE));
    morphChildren(list, out);
    if (keep) list.scrollTop = top;
  }

  /**
   * A file's row, keyed by its path. Its buttons' handlers go through `h`, which a draw in place carries to the button
   * that stands, so a press acts on the file as last read; the ⋯ menu opens on the button pressed.
   * @param {OutputFile} f @param {string} who
   */
  function fileRow(f, who) {
    const folder = f.folder.replace(/\\/g, "/");
    const open = () => ctx.openFileTab({ cwd: folder, path: f.name });
    // Copied or not, it says so, as the header's Copy path does (the hunt of p4-local-only).
    const copy = () => {
      const say = ctx.toast || (() => {});
      if (!navigator.clipboard) return void say("Copy failed", "err");
      navigator.clipboard.writeText(f.path).then(() => say("Copied"), () => say("Copy failed", "err"));
    };
    const away = remotePage();
    const show = h("button", {
      class: "ghost icon out-btn", type: "button", "aria-label": away ? "Copy path" : "Show in folder", html: icon(away ? "copy" : "folderOpen"),
      onclick: (/** @type {MouseEvent} */ e) => {
        e.stopPropagation();
        if (away) copy();
        else ctx.reveal(f.path);
      },
    });
    tooltip(show, { title: away ? "Copy path" : "Show in folder" });
    const more = h("button", {
      class: "ghost icon out-btn", type: "button", "aria-label": "More", html: ICONS.ellipsis,
      onclick: (/** @type {MouseEvent} */ e) => {
        e.stopPropagation();
        const editor = chosenEditor();
        menu([
          { label: "Open beside the chat", onClick: open },
          ...(remotePage() ? [] : [{ label: "Show in folder", onClick: () => ctx.reveal(f.path) }]),
          ...(editor ? [{ label: `Open in ${editor.label}`, onClick: () => openInEditor(f.path) }] : []),
          { type: "separator" },
          { label: "Copy path", onClick: copy },
        ], { anchor: /** @type {HTMLElement} */ (e.currentTarget), side: "bottom", align: "end", width: 200 });
      },
    });
    return h("div", {
      class: "out-row", "data-key": f.path, role: "button", tabindex: "0", title: f.path, onclick: open,
      onkeydown: (/** @type {KeyboardEvent} */ e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } },
    },
      h("span", { class: "out-ic", html: icon(markOf(f.name)) }),
      h("span", { class: "out-text" },
        h("span", { class: "out-name" }, f.name),
        h("span", { class: "out-facts" }, rowFacts(f, who))),
      h("span", { class: "out-end" }, show, more));
  }

  /** A round that wrote, or the turn's end, reads the list again in place (FOC-53). */
  function pulse() {
    const live = isLive();
    if ((live && snapsOf() !== snaps) || (wasLive && !live)) void load({ keep: true });
  }

  load();
  return { chat, root, pulse };
}
