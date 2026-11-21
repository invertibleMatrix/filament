// @ts-check
// The frame's header (proposal_ux §3.3, §4.2). On the left, the crumb: the project — the folder chip (its leaf, a
// worktree's mark, a hover card with the path and the place; typing there sets a new chat's folder) › the chat's title,
// whose press opens the chat menu (pin, rename, archive, copy, reload, move to a worktree, fork) and whose double-click
// renames. The header reads where the chat works, and makes the one place chip — where the chat works, or where its agent
// works now while that is elsewhere; its card says the rest: the chat's folder and branch, where the agent is now, the
// other places its agents wrote in, Open Changes and Move to a worktree… — and that place's `+N −N`, all its branch
// holds that its base lacks, a press opening Changes; the two stand under the message box (`place`, the app mounts them:
// in the header they were easy to miss, the owner's of 10-30). The view tabs in the middle. On the right, over the
// panes: a running flow's line (views/flow.js), the pane buttons and the Layout button (the app mounts them:
// panes/pane-buttons.js), Open in — a menu of the editors (URL schemes, remembered) and the system's file manager — and
// Help (local docs). The status capsule stands under the message box (composer.js).
import { h, setHtml } from "../lib/dom.js";
import { api, apiShared, remotePage } from "./lib/api.js";
import { ICONS, icon } from "./lib/icons.js";
import { aheadWords, baseWords, branchWords, pathLike, placeName, uncommittedWords, worktreeWords } from "./lib/labels.js";
import { menu, popover, tooltip, diffCount, closeOverlaysFor } from "./lib/ui.js";
import { routeFor } from "./lib/router.js";
import { WORDS } from "./lib/words.js";
import { chooseEditor, chosenEditor, editorsHere, fileManagerName, openInEditor } from "./lib/editors.js";
import { gitMovedFor } from "./lib/git-moved.js";
import { machineChip } from "./lib/machine-chip.js";

/** A mouse's single press on the title waits this long for a second one, which renames instead of opening the menu. */
const DOUBLE_PRESS_MS = 240;

/**
 * @param {{ onFork: () => void, onReload: () => void, onRenamed: (title: string) => void, onArchived: () => void,
 *   onToast: (msg: string, kind?: string) => void, getChat: () => any, onOpenChanges?: () => void, onPlace?: () => void,
 *   onMove?: () => void, closedCards?: () => number, onShowClosedCards?: () => void, platform?: () => string,
 *   onOpenFolder?: (path: string) => void, onWelcome?: () => void, viewOnly?: () => boolean,
 *   watchable?: () => true | "project" | "make" | "deleted", onWatch?: () => void }} cb
 *   `onOpenChanges`: the `+N −N`'s press and the place card's Open Changes; `onPlace`: where the chat shown works was
 *   read (`placeOf`); `onMove`: Move to a worktree…, the chat menu's and the place card's; `closedCards`: how many of
 *   the chat's agent cards the person hid, which `onShowClosedCards` brings back (E37); `platform`: the system Filament
 *   runs on, as `/api/state` says it, which names the file manager; `onOpenFolder`: the Open in menu's file manager item;
 *   `viewOnly`: the page is a view-only device's, whose chat menu copies and reloads alone; `watchable`: true where
 *   the chat shown is of a project that has a Space, which a watcher of it would live in; "make" where its project has
 *   none yet, which the press makes (by need, 11-12); "deleted" where its project's deleted Space waits, and "project"
 *   where the chat is of no project, neither of which the press can help; `onWatch`: Watch this chat…, the chat menu's
 */
export function createHeader(cb) {
  let chat = null;
  /** the session's pinned truth once known (the truth read / the settings write); null = unknown, fall back to the chat's guess */
  let pinnedKnown = null;

  // --- the crumb: the project's folder chip and its hover card ---
  const folderIn = h("input", { id: "folder", type: "text", placeholder: "project folder", autocomplete: "off", spellcheck: "false" });
  const folderLeaf = h("span", { id: "folder-leaf", class: "ws-leaf" }, "No folder");
  const foldersDatalist = h("datalist", { id: "harness-folders" });
  const folderIc = h("span", { class: "ws-chip-ic", html: icon("folder") });
  const chip = h("label", { class: "ws-chip", title: "The project's folder: the agent reads, writes and runs its commands here" },
    folderIc,
    folderLeaf,
    folderIn,
    foldersDatalist);
  /** @type {any} */
  let hoverCard = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let hoverTimer;
  /** The field is typed in: the hover card, which would take its first Escape, stays away meanwhile. */
  let typing = false;
  const hideCard = () => {
    clearTimeout(hoverTimer);
    if (hoverCard) { hoverCard.close(); hoverCard = null; }
  };
  chip.addEventListener("pointerenter", () => {
    if (hoverCard || typing) return;
    hoverTimer = setTimeout(async () => {
      const cwd = folderIn.value.trim();
      if (!cwd) return;
      const body = h("div", { class: "ws-card" }, h("div", { class: "ws-path" }, cwd));
      const card = (hoverCard = popover(chip, body, { side: "bottom", align: "start" }));
      const p = await refreshGit();
      if (hoverCard === card && p) body.append(placeRows(p, cwd, false));
    }, 300);
  });
  chip.addEventListener("pointerleave", hideCard);
  // Enter keeps the folder typed and leaves the field; Escape puts back the one it held and leaves it (the owner's of
  // 11-01): left, the field folds to its leaf, and in the sidebar's top row the chat's name shows again. Leaving it is
  // what commits it, as a press elsewhere does; an IME's Enter is the IME's. What Escape puts back is the field's value
  // as it took focus, or as the page set it since (a chat switched by its key: its events are the page's own, not the
  // person's); a folder picked from the list commits at once, so the one put back is committed again.
  let folderWas = "";
  let committed = false;
  folderIn.addEventListener("focus", () => {
    folderWas = folderIn.value;
    committed = false;
    typing = true;
    hideCard();
  });
  folderIn.addEventListener("blur", () => { typing = false; });
  for (const type of ["input", "change"])
    folderIn.addEventListener(type, (e) => {
      if (!e.isTrusted) folderWas = folderIn.value;
      else if (type === "change") committed = true;
    });
  folderIn.addEventListener("keydown", (e) => {
    if ((e.key !== "Enter" && e.key !== "Escape") || e.isComposing) return;
    e.preventDefault();
    if (e.key === "Escape" && folderIn.value !== folderWas) {
      folderIn.value = folderWas;
      folderIn.dispatchEvent(new Event("input"));
      if (committed) folderIn.dispatchEvent(new Event("change"));
    }
    folderIn.blur();
  });

  // --- the title: a press opens the chat menu, a double-click renames ---
  const titleEl = h("span", { id: "chat-title", class: "c-title" }, WORDS.newChat);
  const titleChev = h("span", { class: "c-title-chev", "aria-hidden": "true", html: icon("chevronDown") });
  const titleBtn = h("span", { class: "c-title-btn", role: "button", tabindex: "0", "aria-haspopup": "menu", "aria-label": "Chat menu" }, titleEl, titleChev);
  // A name cut at the header's width is said whole on the hover, before what a press does.
  tooltip(titleBtn, { title: () => (titleEl.scrollWidth > titleEl.clientWidth ? `${titleEl.textContent} · Chat menu — double-click to rename` : "Chat menu — double-click to rename") });
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let pressTimer;
  /** The chat menu as last opened: while it shows, a press on the name closes it. @type {{ el: HTMLElement } | null} */
  let titleMenu = null;
  titleBtn.addEventListener("click", (e) => {
    clearTimeout(pressTimer);
    if (e.detail > 1) return; // a double-click's second press: the rename's
    // The chevron, a key, and a press while the menu shows (it closes) act at once; a mouse's press on the name waits
    // out a double-click.
    if (e.detail === 1 && !titleChev.contains(/** @type {Node} */ (e.target)) && !titleMenu?.el.isConnected) pressTimer = setTimeout(chatMenu, DOUBLE_PRESS_MS);
    else chatMenu();
  });
  titleBtn.addEventListener("dblclick", () => {
    clearTimeout(pressTimer);
    rename();
  });
  titleBtn.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    chatMenu();
  });
  let editing = false;
  function rename() {
    // A double press on the title renames — never on a view-only device's page.
    if (editing || !chat?.chainId || cb.viewOnly?.()) return;
    editing = true;
    const input = h("input", { class: "c-title-edit zc-input", type: "text", value: chatTitleText(), placeholder: "the chat's name" });
    titleBtn.replaceWith(input);
    input.focus();
    input.select();
    let finished = false; // Chrome fires blur inside replaceWith while the input is focused — one done only
    /** @param {boolean} commit */
    const done = async (commit) => {
      if (finished) return;
      finished = true;
      const title = input.value.trim();
      editing = false;
      input.replaceWith(titleBtn);
      if (!commit || !title || title === chatTitleText()) return;
      try {
        await api(`/sessions/${encodeURIComponent(chat.chainId)}/settings`, { method: "PATCH", body: { patch: { display: { title } } } });
        cb.onRenamed(title);
      } catch (e) {
        cb.onToast(String(/** @type {any} */ (e)?.message || e), "err");
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(true); }
      else if (e.key === "Escape") { e.preventDefault(); done(false); }
    });
    input.addEventListener("blur", () => done(true));
  }
  function chatTitleText() {
    return titleEl.textContent || "";
  }

  // --- the chat menu (proposal_ux V7: the chat's actions on its name) ---
  function chatMenu() {
    const c = chat;
    const has = !!c?.chainId;
    const isPinned = pinnedKnown ?? !!c?.pinned;
    const copies = [
      { label: "Copy path", icon: "copy", onClick: () => copyFolder() },
      { label: WORDS.copyChatPath, icon: "copy", disabled: !has, onClick: () => copyText(`${location.origin}${location.pathname}${routeFor("task", { id: c.chainId })}`) },
      { label: "Copy session ID", icon: "copy", disabled: !has, onClick: () => copyText(c.chainId) },
    ];
    const reload = { label: "Reload session", icon: "refreshCw", disabled: !has, onClick: () => cb.onReload() };
    // A view-only device's page writes nothing: no Pin, Rename, Archive, Move or Fork there.
    if (cb.viewOnly?.()) {
      titleMenu = menu([...copies, { type: "separator" }, reload], { anchor: titleBtn, side: "bottom", align: "start" });
      return;
    }
    titleMenu = menu([
      { label: isPinned ? "Unpin" : "Pin", icon: "pin", disabled: !has, onClick: () => togglePinned() },
      { label: "Rename", icon: "pencil", disabled: !has, onClick: () => rename() },
      { label: "Archive", icon: "archive", disabled: !has, onClick: () => archive() },
      { type: "separator" },
      ...copies,
      { type: "separator" },
      reload,
      moveItem(c),
      { label: "Fork…", icon: "trending", disabled: !has, desc: "a second chat from a turn; this one stays", onClick: () => cb.onFork() },
      watchItem(c),
      ...closedItem(),
    ], { anchor: titleBtn, side: "bottom", align: "start" });
  }
  /** The agents' cards hidden in this chat, back on it (E37): there only while some are hidden. */
  function closedItem() {
    const n = chat?.chainId ? cb.closedCards?.() ?? 0 : 0;
    return n && cb.onShowClosedCards
      ? [{ type: "separator" }, { label: `Show ${n} hidden agent card${n === 1 ? "" : "s"}`, icon: "eye", desc: "the cards you hid come back where they were", onClick: () => cb.onShowClosedCards?.() }]
      : [];
  }
  /** Move to a worktree…: the chat menu's and the place card's. @param {any} c */
  const moveItem = (c) => ({
    label: "Move to a worktree…", icon: "gitFork", disabled: !c?.chainId || !!c?.live || !cb.onMove,
    desc: c?.live ? "not while a turn runs" : "this chat and its own uncommitted files", onClick: () => cb.onMove?.(),
  });
  /**
   * Watch this chat…: the ask for a watcher of it put in its box, for the person to send — the chat's own agent
   * proposes the watcher, which lives in its project's Space. Its agent is given the space tool only where there is
   * one, so in a project with none yet the press makes it first, and says so (by need, 11-12). A chat of no project
   * says why not, and so does one whose project's deleted Space waits: a Space made then would stand in Bring back's
   * way. @param {any} c
   */
  const watchItem = (c) => {
    const can = cb.watchable?.() || "project";
    return {
      label: "Watch this chat…", icon: "eye", disabled: !c?.chainId || (can !== true && can !== "make") || !cb.onWatch,
      desc: !c?.chainId ? ""
        : can === true ? "the ask in the box, for you to send: its agent proposes the watcher, and you switch it on from its card under the call"
        : can === "make" ? "the ask in the box, for you to send: its agent proposes the watcher, and you switch it on from its card under the call. This makes the project's Space, where a watcher lives"
        : can === "deleted" ? "once this project's deleted Space is back, or a new one made (the project's ⋯ in the left bar): a watcher lives in one"
        : "not here: this chat is of no project, and a watcher lives in a project's Space",
      onClick: () => cb.onWatch?.(),
    };
  };
  /** Copy, and say whether it happened (Appendix A: "Copied" / "Copy failed"). @param {string} text */
  const copyText = (text) => {
    if (!navigator.clipboard) { cb.onToast("Copy failed", "err"); return; }
    navigator.clipboard.writeText(String(text)).then(() => cb.onToast("Copied"), () => cb.onToast("Copy failed", "err"));
  };

  async function togglePinned() {
    if (!chat?.chainId) return;
    try {
      // Read off the chat alone: the whole session's answer builds its statistics.
      const r = await api(`/sessions/${encodeURIComponent(chat.chainId)}/goal`);
      const next = !r?.pinned;
      await api(`/sessions/${encodeURIComponent(chat.chainId)}/settings`, { method: "PATCH", body: { patch: { display: { pinned: next } } } });
      pinnedKnown = next;
      cb.onToast(next ? "Pinned" : "Unpinned");
    } catch (e) {
      cb.onToast(String(/** @type {any} */ (e)?.message || e), "err");
    }
  }

  async function archive() {
    if (!chat?.chainId) return;
    try {
      await api(`/sessions/${encodeURIComponent(chat.chainId)}/settings`, { method: "PATCH", body: { patch: { display: { archived: true } } } });
      cb.onToast("Chat archived. The archive keeps it");
      cb.onArchived();
    } catch (e) {
      cb.onToast(String(/** @type {any} */ (e)?.message || e), "err");
    }
  }

  // --- the place chip (proposal_ux M2: one chip for the branch, "now in" and "also") ---
  const placeIc = h("span", { class: "place-ic", html: icon("gitBranch") });
  const placeName_ = h("span", { class: "place-name" });
  const placeAhead = h("span", { class: "place-ahead" });
  const placeMore = h("span", { class: "place-more" });
  const placeChip = h("button", { class: "place-chip hidden", type: "button", "aria-haspopup": "dialog" }, placeIc, placeName_, placeAhead, placeMore);
  tooltip(placeChip, { title: () => placeTip() });
  /** @type {any} */
  let placeCard = null;
  placeChip.addEventListener("click", (e) => {
    e.stopPropagation();
    openPlaceCard();
  });

  /** Where the agent works now, as its running turn's newest `place` says. @type {{ place: string, home: boolean } | null} */
  let nowAt = null;
  /** Each place's `/git/place` answer, read once while the chat is shown: its branch and whether it is a worktree. @type {Map<string, Promise<any>>} */
  const nowReads = new Map();
  const nowRead = () => {
    const at = nowAt?.place;
    if (!at) return Promise.resolve(null);
    let p = nowReads.get(at);
    if (!p) nowReads.set(at, (p = api(`/git/place?cwd=${encodeURIComponent(at)}`).catch(() => null)));
    return p;
  };
  /** One place, however its slashes and case are spelled. @param {string} p */
  const placeKey = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  /** Where the agent works now, while that is not the chat's folder. */
  const away = () => (nowAt && !nowAt.home ? nowAt.place : null);
  /** The other places the chat shown's agents wrote in, the one the agent works in now left out (the chip names it). */
  const alsoNow = () => {
    const a = away();
    const p = drawn && drawn.chat === chat ? drawn.p : null;
    return (p?.also || []).filter((/** @type {any} */ x) => !a || placeKey(x.place || x.cwd) !== placeKey(a));
  };
  /** The chip's words on hover: the branch whole, which a long name's chip cuts short. */
  const placeTip = () => {
    const a = away();
    const n = alsoNow().length;
    const more = n ? ` · also wrote in ${n} other folder${n === 1 ? "" : "s"}` : "";
    const named = placeName_.textContent && placeName_.textContent !== "also" ? `: ${placeName_.textContent}` : "";
    return a ? `The agent works in ${placeName(a)} now${more}` : `Where this chat works${named}${more}`;
  };

  /**
   * The chip: while the agent works outside the chat's folder, that place (live, its branch once read); else the
   * folder's branch and how far from its base. "+N": the other places its agents wrote in. Hidden with nothing to say.
   */
  function drawPlaceChip() {
    const p = drawn && drawn.chat === chat ? drawn.p : null;
    const a = away();
    const n = alsoNow().length;
    const home = p?.ok ? branchWords(p) : "";
    placeChip.classList.toggle("hidden", !a && !home && !n);
    placeChip.classList.toggle("away", !!a);
    placeMore.textContent = n ? `+${n}` : "";
    if (a) {
      setHtml(placeIc, icon("folder"));
      placeName_.textContent = placeName(a);
      placeAhead.textContent = "";
      drawStats(null);
      const read = nowRead();
      void read.then((q) => {
        // A read the feed's word put aside (`gitMoved`) lands after the one asked in its place: only the newest draws.
        if (away() !== a || nowReads.get(a) !== read || !q?.ok) return;
        setHtml(placeIc, icon(q.worktree ? "gitFork" : "folder"));
        if (branchWords(q)) placeName_.textContent = branchWords(q);
        drawStats(q);
      });
      return;
    }
    setHtml(placeIc, icon(p?.ok && p.worktree ? "gitFork" : "gitBranch"));
    placeName_.textContent = home || (n ? "also" : "");
    placeAhead.textContent = p?.ok ? aheadWords(p) : "";
    drawStats(p);
  }

  /** The card: the chat's folder and branch, where the agent works now, the other places, and what to do from here. */
  async function openPlaceCard() {
    hideCard();
    const cwd = chat?.cwd || folderIn.value.trim();
    const body = h("div", { class: "ws-card place-card" });
    // Above the chip, from its left edge: it stands under the message box, near the window's foot.
    const card = (placeCard = popover(placeChip, body, { side: "top", align: "start", width: 320, label: "Where this chat works", onClose: () => { if (placeCard === card) placeCard = null; } }));
    /** @param {string} words @param {...any} kids */
    const section = (words, ...kids) => h("div", { class: "place-sec" }, h("div", { class: "place-sec-label" }, words), ...kids);
    const [p, q] = await Promise.all([refreshGit(), away() ? nowRead() : Promise.resolve(null)]);
    if (placeCard !== card) return;
    const a = away();
    const also = alsoNow();
    const m = moveItem(chat);
    const move = h("button", { class: "sm ghost", type: "button", title: m.desc, onclick: () => { card.close(); m.onClick(); } }, h("span", { html: icon("gitFork") }), m.label);
    if (m.disabled) move.setAttribute("disabled", "");
    /** @type {HTMLElement[]} */
    const parts = [section("Works in", h("div", { class: "ws-path" }, cwd || "no folder yet"), p ? placeRows(p, cwd, false) : null)];
    if (a) parts.push(section("Now in", q ? placeRows(q, cwd, true) : h("div", { class: "ws-path" }, h("b", {}, placeName(a)), h("span", { class: "ws-sub" }, pathLike(a, cwd)))));
    if (also.length) parts.push(section("Also wrote in", ...also.map((/** @type {any} */ x) => placeRows(x, cwd, true))));
    parts.push(h("div", { class: "place-acts" },
      h("button", { class: "sm ghost", type: "button", onclick: () => { card.close(); cb.onOpenChanges?.(); } }, h("span", { html: icon("fileDiff") }), "Open Changes"),
      move));
    body.replaceChildren(...parts);
    card.place?.();
  }

  /**
   * Where the agent works now, from its running turn (the aligned run's `place`); null when no turn runs or it has
   * worked in the chat's folder alone. Drawn when it moves.
   * @param {{ place: string, home: boolean } | null} now
   */
  function setNow(now) {
    const next = now?.place ? { place: String(now.place), home: now.home === true } : null;
    if (next?.place === nowAt?.place && next?.home === nowAt?.home) return;
    nowAt = next;
    drawPlaceChip();
  }

  // --- the place's `+N −N`: all its branch holds that its base lacks, committed or not, not one turn's (the owner's of
  // 11-08: "it should not show this per turn changes but as a whole changes in current working branch"); on its base,
  // what is uncommitted. A press opens Changes ---
  const stats = diffCount({});
  const statsBtn = h("button", { class: "c-diff", type: "button", onclick: () => cb.onOpenChanges?.() }, stats.el);
  /** The place the count is of, as last drawn: its `/git/place` answer. @type {any} */
  let statsOf = null;
  tooltip(statsBtn, { title: () => statsTip(statsOf) });
  /** The count's words on hover. @param {any} p */
  const statsTip = (p) => {
    const branch = p?.ok ? branchWords(p) : "";
    const files = Number(p?.sinceBase?.files) || 0;
    const n = files ? ` (${files} file${files === 1 ? "" : "s"})` : "";
    // No count read — git could not tell, or the branch shares no commit with its base —: none promised.
    if (!branch || !p.sinceBase) return "Open Changes";
    return p.base && !p.onBase
      ? `All ${branch} holds that ${p.base} lacks, committed or not${n} — open Changes`
      : `What is uncommitted on ${branch}${n} — open Changes`;
  };
  /** The count of a place read whole, or none. @param {any} p */
  function drawStats(p) {
    statsOf = p?.ok ? p : null;
    const s = statsOf?.sinceBase;
    stats.update(Number(s?.added) || 0, Number(s?.removed) || 0);
  }

  // --- Open in: a press opens its menu, never an editor at once (the owner's of 11-01: "this button on top bar should be
  // a dropdown and not open directly into VS code and add a fourth option there as well which would be open in explorer
  // or finder whatever the os platform is") — the editors (URL schemes; the one picked is remembered, and every open
  // button on the page follows it), the folder in the system's file manager, its path copied. On another machine's page
  // (the owner's remote Filament of 11-06) the editors that open its folder over SSH, none where the rail reached it by no
  // alias, and no file manager: that one would open on its screen ---
  const editorBtn = h("button", { class: "ghost icon hdr-editor", type: "button", "aria-label": "Open in", "aria-haspopup": "menu", html: ICONS.code });
  tooltip(editorBtn, { title: "Open in…" });
  /** @param {Event} e */
  const openMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const editors = editorsHere();
    menu([
      ...(editors.length
        ? [
          { type: "label", label: "Open in" },
          ...editors.map((ed) => ({
            label: ed.label,
            type: "radio",
            checked: chosenEditor()?.id === ed.id,
            onClick: () => { chooseEditor(ed.id); openEditor(); },
          })),
          { type: "separator" },
        ]
        : []),
      ...(remotePage() ? [] : [{ label: `Open in ${fileManagerName(cb.platform?.())}`, icon: "folderOpen", onClick: () => openFolder() }]),
      { label: "Copy path", icon: "copy", onClick: () => copyFolder() },
    ], { anchor: editorBtn, side: "bottom", align: "end", width: 196 });
  };
  editorBtn.addEventListener("click", openMenu);
  editorBtn.addEventListener("contextmenu", openMenu);
  /** The chat's folder, or the one typed for a chat not started; "" where none is chosen yet. */
  const folderOf = () => chat?.cwd || folderIn.value.trim();
  const noFolder = () => cb.onToast("Choose the project folder first", "err");
  function openEditor() {
    if (!openInEditor(folderOf())) noFolder();
  }
  function openFolder() {
    const cwd = folderOf();
    if (!cwd) return void noFolder();
    cb.onOpenFolder?.(cwd);
  }
  /** Copy path, the chat menu's and this menu's: with no folder chosen, said as the rows beside it say it. */
  function copyFolder() {
    const cwd = folderOf();
    if (!cwd) return void noFolder();
    copyText(cwd);
  }

  // --- Help ---
  const helpBtn = h("button", { class: "ghost icon hdr-help", type: "button", "aria-label": "Help", html: ICONS.circleHelp });
  helpBtn.onclick = (e) => {
    e.stopPropagation();
    menu([
      { label: "Product docs", icon: "fileText", onClick: () => window.open("/ui/index.html#docs", "_blank", "noopener") },
      { label: "Keyboard shortcuts", icon: "circleHelp", onClick: () => { location.hash = routeFor("settings", { section: "shortcuts" }); } },
      ...(cb.onWelcome ? [{ label: "Welcome tour", icon: "sparkles", onClick: () => cb.onWelcome?.() }] : []),
    ], { anchor: helpBtn, side: "bottom", align: "end" });
  };
  tooltip(helpBtn, { title: "Help" });

  // --- the slots ---
  // A running flow's line (HarnessV4_Flow_Plan §4.8): the app mounts it here.
  const statusSlot = h("span", { class: "hdr-status" });
  // The pane buttons and the Layout button (panes/pane-buttons.js).
  const paneSlot = h("span", { class: "hdr-panes" });
  const layoutSlot = h("span", { class: "hdr-layout" });
  // The machine this page is, left of Changes, once another is kept beside this one (the desktop app's alone).
  const machine = machineChip({ tip: tooltip });
  // The session's view tabs (HarnessV3-Views VW-D1) take the middle; the app mounts them (views/host.js).
  const viewsSlot = h("div", { class: "view-tabs-slot" });

  // Another machine's agents started this chat: their mark, its words in its title (app.js `paintFromAgents`) — the
  // words themselves pushed the chat's name out of a narrow bar's crumb.
  const fromEl = h("span", { class: "c-from hidden", role: "img", html: icon("bot") });
  // A thread, or a chat whose agent started threads (core/threads.js): the linked chats' chip after the views — "Thread
  // of Build the login flow", "2 threads" — which opens the way to each: the chat that started this one, and the threads
  // it started (app.js `paintThreads`). In the crumb it cut the chat's name to its first letter, and beside the views,
  // whose box never gives up its width, it did the same: on its own it gives up its words before the title a letter.
  /** @type {{ from: { id: string, title: string } | null, started: { id: string, title: string }[] }} */
  let linked = { from: null, started: [] };
  const threadWords = h("span", { class: "c-thread-words" });
  const threadEl = h("button", {
    class: "c-thread hidden", type: "button", "aria-haspopup": "menu",
    onclick: (/** @type {MouseEvent} */ e) => {
      e.stopPropagation();
      /** @param {string} id */
      const go = (id) => { location.hash = routeFor("task", { id }); };
      menu([
        ...(linked.from ? [{ type: "label", label: "Thread of" }, { label: linked.from.title, icon: "messageCircle", onClick: () => go(String(linked.from?.id)) }] : []),
        ...(linked.from && linked.started.length ? [{ type: "separator" }] : []),
        ...(linked.started.length ? [{ type: "label", label: linked.started.length === 1 ? "Its thread" : "Its threads" }, ...linked.started.map((t) => ({ label: t.title, icon: "messagesSquare", onClick: () => go(t.id) }))] : []),
      ], { anchor: threadEl, side: "bottom", align: "start", width: 260 });
    },
  }, h("span", { class: "c-thread-ic", html: ICONS.messagesSquare }), threadWords, h("span", { class: "c-thread-chev", html: ICONS.chevronDown }));
  /** The chats linked to this one, as the sessions list names them. @param {typeof linked} o */
  const setThreads = (o) => {
    linked = o;
    const n = o.started.length;
    const many = n === 1 ? "1 thread" : `${n} threads`;
    const said = [o.from ? `Thread of ${o.from.title}` : "", n ? many : ""].filter(Boolean).join(" · ");
    threadEl.classList.toggle("hidden", !said);
    threadWords.textContent = said;
    const tip = [o.from ? `A thread the agent of “${o.from.title}” started` : "", n ? `${many} this chat's agent started` : ""].filter(Boolean).join("; ");
    // Its name is its words, said while a narrow header hides them too; the tooltip says the rest.
    threadEl.setAttribute("aria-label", said);
    threadEl.title = tip ? `${tip}: open one` : "";
  };
  const crumb = h("div", { class: "c-crumb" }, chip, h("span", { class: "c-sep", "aria-hidden": "true" }, "›"), titleBtn, fromEl);
  // The place chip and its branch's count, under the message box: the app mounts them in the composer's strip.
  const place = h("span", { class: "strip-place" }, placeChip, statsBtn);
  // One row (the owner's look at the design pass, 10-24: a row of the title's own left empty room over the tabs).
  const left = h("div", { class: "c-left" }, crumb, h("div", { class: "c-mid" }, viewsSlot), threadEl);
  const el = h("header", { class: "c-bar" },
    left,
    h("div", { class: "c-right" }, statusSlot, h("span", { class: "c-sp" }), machine?.el ?? null, paneSlot, h("span", { class: "c-div", "aria-hidden": "true" }), layoutSlot, editorBtn, helpBtn));

  /**
   * One place's rows in a card: its folder (`named`, for another place), whose worktree it is, its branch and how far
   * from its base, what is uncommitted; or why it could not be read (GWC-55 to GWC-57).
   * @param {any} p  a `/git/place` answer @param {string} like  the chat's folder, for the slashes @param {boolean} named
   */
  const placeRows = (p, like, named) => {
    const where = p.place || p.cwd;
    const row = (/** @type {any[]} */ ...kids) => h("div", { class: "ws-row" }, ...kids);
    return h("div", { class: "ws-place" },
      named ? h("div", { class: "ws-path" }, h("b", {}, placeName(where)), h("span", { class: "ws-sub" }, pathLike(where, like))) : null,
      !p.ok ? row(p.error || "git could not read it") : null,
      p.ok && p.worktree ? row(worktreeWords(p, like)) : null,
      p.ok ? h("div", { class: "ws-branch" },
        h("span", { class: "ws-branch-ic", html: icon("gitBranch") }), branchWords(p),
        aheadWords(p) ? h("span", { class: "ws-ahead" }, aheadWords(p)) : null) : null,
      p.ok ? row(baseWords(p)) : null,
      p.ok && p.uncommitted ? row(uncommittedWords(p.uncommitted)) : null);
  };

  let gitSeq = 0;
  /** The newest answer drawn, and whose chat it was read for: the Changes pane's place heads read it. @type {{ chat: any, p: any } | null} */
  let drawn = null;
  /**
   * Where the chat works, from GET /api/git/place, once per chat or folder, at each turn's end (GWC-59) and as a card
   * opens. Answers what it drew; null with no folder. `since`: when the feed said the place moved — a read on its way
   * that began before is not the answer (`apiShared`).
   * @param {{ since?: number }} [o]
   */
  async function refreshGit({ since = 0 } = {}) {
    const cwd = chat?.cwd || folderIn.value.trim();
    const mine = ++gitSeq;
    const asked = chat;
    if (!cwd) {
      drawn = { chat: asked, p: null };
      drawPlace(null);
      return null;
    }
    const chain = chat?.chainId ? `&chain=${encodeURIComponent(chat.chainId)}` : "";
    /** @type {any} */
    let p;
    try {
      // The read on its way shared (`apiShared`): opening a chat set the header twice — as it was chosen, and once its
      // transcript came — and the status panel reads the same place, each a read of its own.
      p = await apiShared(`/git/place?cwd=${encodeURIComponent(cwd)}${chain}`, { since });
    } catch (e) {
      p = { ok: false, error: String(/** @type {any} */ (e)?.message || e), also: [] };
    }
    if (mine === gitSeq) {
      drawn = { chat: asked, p };
      drawPlace(p);
      cb.onPlace?.();
    }
    return p;
  }
  /** The folder chip's mark and the place chip, from a `/git/place` answer. @param {any} p */
  function drawPlace(p) {
    setHtml(folderIc, icon(p?.ok && p.worktree ? "gitFork" : "folder"));
    drawPlaceChip();
  }
  /**
   * A git mark moved (`git-moved`, lib/git-moved.js): the chat's place, or one of the others its agents wrote in, is
   * read again, and so is the place the agent works in now; each answered at once.
   * @param {any} msg
   */
  function gitMoved(msg) {
    const p = drawn && drawn.chat === chat ? drawn.p : null;
    const cwd = chat?.cwd || folderIn.value.trim();
    if (cwd && gitMovedFor(msg, "place", [cwd, ...(p?.also || []).flatMap((/** @type {any} */ x) => [x.cwd, x.place])])) void refreshGit({ since: Date.now() });
    const at = nowAt?.place;
    if (at && gitMovedFor(msg, "place", [at])) {
      nowReads.delete(at);
      drawPlaceChip();
    }
  }
  /** Where a chat works as the header last read it: its folder's place and the others; null for another chat. @param {any} c */
  const placeOf = (c) => (drawn && drawn.chat === c ? drawn.p : null);

  /** The folder of the chat shown as the header last set it: the same chat set again in it keeps the chip as it stands. */
  let shownCwd = "";
  /** The chat moved: title, stats, the chips. @param {any} c */
  function setChat(c) {
    const was = chat;
    const wasCwd = shownCwd;
    chat = c;
    shownCwd = String(c?.cwd || "");
    pinnedKnown = null;
    nowReads.clear();
    nowAt = null;
    placeCard?.close();
    setNow(c?.live?.turn?.aligned?.place || null);
    drawPlaceChip();
    // The chip says the folder of a chat shown anew, or of the chat shown where its folder changed — a move, the worktree
    // made for it, its folder read at last. The chat shown read again in the same folder keeps the chip as it stands: a
    // folder picked there is the one the person's next message opens a new chat in (app.js `readySession`), whatever
    // reads the chat meanwhile.
    if (c?.cwd && (c !== was || c.cwd !== wasCwd)) {
      folderIn.value = c.cwd;
      folderIn.dispatchEvent(new Event("input"));
    } else if (c && was && was !== c && was.cwd && folderIn.value.trim() === String(was.cwd).trim()) {
      // A chat whose folder is not known — an opened chat before its transcript comes, a session with none — never shows
      // the folder of the chat shown before: a send would read it as the folder chosen for this one (app.js
      // `readySession`). What the chip holds otherwise, a folder typed or picked there, stays the chooser's.
      folderIn.value = "";
      folderIn.dispatchEvent(new Event("input"));
    }
    refreshGit();
  }

  return {
    el, folderIn, folderLeaf, foldersDatalist, titleEl, fromEl, setThreads, setChat, setNow, refreshGit, gitMoved, placeOf, hideCard,
    viewsSlot, statusSlot, paneSlot, layoutSlot, place,
    /**
     * Where the crumb stands (the owner's of 11-01: "when the side bar is open we move the git worktree related thing
     * and chat menu ... over there but when side bar is collapsed or hidden we show that exactly the way they currently
     * show ... when side bar is opened we move the tabs to the left as well ... on macbook laptop we have this notch and
     * dynamic island in the center that will get in the way"): `away`, the sidebar's top row while the sidebar shows,
     * the tabs then at the header's left (`.crumb-away`); null, its own place before them. The one crumb moves, never a
     * copy — its fields and the page's hold on them stay —, and what was open on it closes.
     * @param {HTMLElement | null} away
     */
    crumbIn(away) {
      const at = away || left;
      if (crumb.parentNode === at) return;
      hideCard();
      closeOverlaysFor(titleBtn);
      if (away) away.append(crumb);
      else left.insertBefore(crumb, left.firstChild);
      el.classList.toggle("crumb-away", !!away);
    },
  };
}
