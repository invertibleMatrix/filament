// @ts-check
// The Space's board (proposal_ux §4.14, mock-space; U5 phase 8 v1): four columns — Planned, Doing, Waits for you, Done
// this week — of the tasks the person and the project's chats share. A card says its task, its line, the lane it
// stands in and the chat that has it, and how long it has been where it is; a parked one says so. A task whose chat
// asks you has "Open the ask ›", one that waits for you "Open ›": each opens that chat. A press on a card opens it in
// place to change — its words, its column, parked — or remove it, or, for a task no chat has, "Start a chat on this…",
// which fills the Start with it and nothing more: the chat takes the task as its first send makes it (rule 1). "+" on
// Planned, or the Tasks head's New task…, adds one. Done shows the week's newest three, "+ N more" the rest. A board
// with nothing to show folds to one line (HarnessV4_Space_Plan S1); an empty column says nothing — its head's 0 does.
// A lane's chip only where the Space has two lanes to tell apart. Each write answers with the Space as it stands,
// which the page draws again. A kept dashboard's rows may stand on it too (S4c, an issue each): after the typed tasks
// in their column, marked with the dashboard's name and their age as read, faint where its last read failed; they are
// the source's, so a press opens a menu of what may be done with one — never Change or Remove. The board takes the
// page's width, as Linear's and Jira's do (the owner's word of 10-27, the Designer's): four columns, two or one as it
// narrows; a card's title at three lines and its line at one; what waits for you marked by an orange edge. A pull's
// issues stand there too (the Space Apps plan of 10-29), after a dashboard's cards, each with its key (LIN-42); a press
// opens its menu, whose Move to… asks before a move goes back to its service. Each card has its ⋯ (the owner's of
// 11-02): a task's moves it to another column, sends it to a chat of a lane — the task in that chat's box, the card in
// Doing, nothing sent —, starts a chat on it, opens its chat, attaches files to it, changes or removes it; a dashboard's
// or a pull's opens the menu its face opens. Files and pictures go on any task (the owner's of 11-02): from Attach
// files…, dropped on its card, or pasted into it open in place; its card shows its first pictures and how many files it
// holds, opened in place it lists them, each to open or remove; a task sent to a chat takes them into its box. A task's
// card is dragged to another column, or to another place in its own, a line marking where it goes; its ⋯ moves it up or
// down there too. A dashboard's or a pull's card stays where its source puts it.
import { h, morphChildren } from "../../lib/dom.js";
import { ICONS, icon } from "../lib/icons.js";
import { confirmDialog, menu } from "../lib/ui.js";
import { DONE_SHOWN, REPRO_TIP, ageWords, boardColumns, laneOfTask, lookWords, movedTasks, sizeWords } from "../lib/space-view.js";

/**
 * What the board reads and does. `lanes`: the Space's lanes, as the board names them; `nameOf`: a chat by its name;
 * `asks`: whether a chat waits for you now; `write`: a write to the Space, its answer the Space as it stands, or its
 * refusal said and null; `startOn`: the Start filled with a task, in its folder; `sendTo`: a chat opened with a task
 * in its box, nothing sent; `fedMenu`: a fed card's menu, at its face.
 * @typedef {{ lanes: () => import("../lib/space-view.js").LaneRef[], nameOf: (chain: string) => string,
 *   asks: (chain: string) => boolean, openChat: (chain: string) => void,
 *   write: (method: string, path: string, body?: any) => Promise<any>, startOn: (task: import("../lib/space-view.js").SpaceTask) => void,
 *   sendTo?: (task: import("../lib/space-view.js").SpaceTask, chain: string) => void,
 *   reproduce?: (task: import("../lib/space-view.js").SpaceTask) => void,
 *   fedMenu?: (card: import("../lib/space-view.js").FedTask, anchor: HTMLElement) => void,
 *   pulledMenu?: (card: import("../lib/space-view.js").PulledTask, anchor: HTMLElement) => void, plain?: () => boolean,
 *   attach?: (task: import("../lib/space-view.js").SpaceTask, files: File[]) => Promise<import("../lib/space-view.js").SpaceTask | null>,
 *   fileUrl?: (task: import("../lib/space-view.js").SpaceTask, file: import("../lib/space-view.js").TaskFile) => string,
 *   moved?: () => void, report?: (err: unknown) => void, makes?: () => boolean, now?: () => number }} BoardCtx
 *   `reproduce`: Reproduce… on a task no chat has (S7-D1), the Builder on a new lane; `pulledMenu`: a pulled card's menu,
 *   at its face (the Space Apps plan of 10-29); `plain`: whether its folder is no repository — no Reproduce… there;
 *   `attach`: files attached to a task, each said where refused — the task as it stands then, null where none went;
 *   `fileUrl`: where a task's file is read; `moved`: the person's moves the Space has not answered yet changed — one
 *   made, one answered or refused —, so what reads the tasks as the board draws them (`shown`) draws again; `report`:
 *   where a failure of `moved` goes (the page's `reportError`), which never keeps the board from drawing or writing;
 *   `makes`: whether the project has no Space yet, so the first task makes it (by need, 11-12)
 */

/**
 * What waits its turn to be written: a move on the board, as the person made it (`BoardMove`: its order the ids of
 * those it stands among as the board showed them then, none for Done or where the Space puts it; `across`, whether the
 * person moved the card from the column it was drawn in — only then is its column written); or a write of a card's
 * made after moves the Space has not answered yet, `sent` told as it is written and handed its answer once answered —
 * null where refused.
 * @typedef {{ move: import("../lib/space-view.js").BoardMove, across: boolean }
 *   | { write: [string, string, any], done: (got: any) => void, sent?: () => void }} Queued
 */

/** Whether a drag carries files from the computer. @param {DragEvent} e */
const carriesFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
/** What a task's card dragged on the board carries: its id, as a kind of its own no other drop takes. */
const TASK_DRAG = "application/x-filament-board-card";
/** Whether a drag carries a task's card. @param {DragEvent} e */
const carriesTask = (e) => Array.from(e.dataTransfer?.types || []).includes(TASK_DRAG);
/** The marks a drag over the board leaves: the column under it, the card the dragged one goes above or below. */
const DRAG_MARKS = Object.freeze(["is-over", "is-before", "is-after"]);

/** The files the person picks, handed to `then`: the computer's own picker, several at once. @param {(files: File[]) => void} then */
function pickFiles(then) {
  const input = /** @type {HTMLInputElement} */ (h("input", { type: "file", multiple: "" }));
  input.onchange = () => then(Array.from(input.files || []));
  input.click();
}

/**
 * Files pasted: a picture copied has no name of its own ("image.png"), so it is named by the moment, as the chat's box
 * names one. @param {ClipboardEvent} e @returns {File[]}
 */
const pastedFiles = (e) =>
  Array.from(e.clipboardData?.files || []).map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `screenshot-${Date.now()}-${i + 1}.png`, { type: f.type || "image/png" })));

/** Each column's mark in its head. */
const HEAD_MARK = Object.freeze({ planned: "dot is-gray", doing: "spin", waits: "dot is-orange", done: "dot is-green" });
/** The columns a task can be moved to, in the editor's words. */
const MOVE_TO = Object.freeze([
  ["planned", "Planned"],
  ["doing", "Doing"],
  ["waits", "Waits for you"],
  ["done", "Done"],
]);

/** @param {BoardCtx} ctx */
export function boardPanel(ctx) {
  const now = ctx.now || Date.now;
  // Files from the computer dropped on the board but on no card are refused here: the browser would open the file in
  // the page's place. A card, or a card open in place, takes its own first (`dropsInto`).
  const el = h("div", { class: "sb-board", role: "list", "aria-label": "The board",
    ondragover: (/** @type {DragEvent} */ e) => {
      if (!carriesFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    },
    ondrop: (/** @type {DragEvent} */ e) => {
      if (carriesFiles(e) && !e.defaultPrevented) e.preventDefault();
    } });
  const report = ctx.report || ((/** @type {unknown} */ err) => reportError(err));
  /**
   * The task open in place to change, "+" for a new one; each opening of one counted (`opened`), so a Save or a Remove
   * answered closes only the editor it was pressed in; and whether Done shows all of the week's.
   */
  /** @type {string | null} */
  let editing = null;
  let opened = 0;
  let doneAll = false;
  /** The tasks as the Space last answered them. @type {import("../lib/space-view.js").SpaceTask[]} */
  let told = [];
  /** The tasks as the board draws them: those, with the person's moves the Space has not answered yet. @type {import("../lib/space-view.js").SpaceTask[]} */
  let tasks = [];
  /**
   * The person's moves the Space has not answered yet, oldest first, with the writes of cards made after them: each move
   * drawn at once, so the next builds on the one before; all written one after another, each once the one before is
   * answered, so the Space takes them in the order they were made — a move's write built as it is sent (`bodyOf`).
   * @type {Queued[]}
   */
  let moves = [];
  /** The cards kept dashboards put on it (S4c). @type {import("../lib/space-view.js").FedTask[]} */
  let fed = [];
  /** The issues its pulls put on it (the Space Apps plan of 10-29). @type {import("../lib/space-view.js").PulledTask[]} */
  let pulled = [];
  /** The task whose card is dragged, from its dragstart to its drop or dragend. @type {import("../lib/space-view.js").SpaceTask | null} */
  let dragged = null;

  /**
   * A task as the board draws it now — a card or its menu drawn before a write (a file attached to it open in place,
   * which the board does not draw over), or before a move, hands on the task as it stands now.
   * @param {import("../lib/space-view.js").SpaceTask} t
   */
  const latest = (t) => tasks.find((x) => x.id === t.id) || t;

  /**
   * A task opened in place to change, or "+" a new one: one more opening (`opened`). A new one's card is brought into
   * view by the least move: New task… stands in the section's head, and Planned may be under the page's fold. One opened
   * to change stands where the press was.
   * @param {string} key
   */
  const openEditor = (key) => {
    editing = key;
    opened++;
    paint();
    if (key === "+") el.querySelector("[data-new]")?.scrollIntoView?.({ block: "nearest" });
  };

  /**
   * Tasks with the person's moves the Space has not answered yet made over them: what the board draws over the tasks as
   * the Space last answered them. @param {readonly import("../lib/space-view.js").SpaceTask[]} base
   * @returns {import("../lib/space-view.js").SpaceTask[]}
   */
  const ahead = (base) => moves.reduce((ts, q) => ("move" in q && holds(ts, q) ? movedTasks(ts, q.move) : ts), [...base]);

  /**
   * Whether a move still means something over tasks: one across columns always; one within a column only while the card
   * stands in that column — moved out of it since (an agent's move, a refused one), its place there is no move.
   * @param {readonly import("../lib/space-view.js").SpaceTask[]} ts @param {{ move: import("../lib/space-view.js").BoardMove, across: boolean }} q
   */
  const holds = (ts, q) => q.across || ts.some((x) => x.id === q.move.id && x.column === q.move.column);

  /**
   * The tasks a task stands among in a column, as the board shows them — or as `ts` has them —, itself with them where it
   * is there: Planned's open ones or its parked, as it is; all of another column's.
   * @param {string} column @param {import("../lib/space-view.js").SpaceTask} t @param {readonly import("../lib/space-view.js").SpaceTask[]} [ts]
   */
  const standsAmong = (column, t, ts = tasks) =>
    (boardColumns(ts, now()).find((c) => c.key === column)?.tasks || []).filter((x) => column !== "planned" || x.parked === t.parked);

  /**
   * One more to write in its turn: the first written at once, the others as the ones before them are answered; a move
   * drawn once its write is under way, so no drawing keeps it from the Space. @param {Queued} q
   */
  const enqueue = (q) => {
    moves = [...moves, q];
    if (moves.length === 1) void writeMoves();
    if ("move" in q) redraw();
  };

  /**
   * A write of a card's in its turn, after the person's moves made before it, so the Space takes them all in the order
   * they were made: its answer, null where refused, as `ctx.write`'s; `sent` told as it is written.
   * @param {string} method @param {string} path @param {any} [body] @param {() => void} [sent] @returns {Promise<any>}
   */
  const inTurn = (method, path, body, sent) => new Promise((done) => enqueue({ write: [method, path, body], done, ...(sent ? { sent } : {}) }));

  /**
   * A task put in a column at a place among those it stands with there, itself left out: moved there where it was not,
   * its place written — Done keeps the order its tasks were done in. Nothing is written where it stays as it was. The
   * board draws it there at once, over what the Space last answered, until the Space answers it (`moves`).
   * @param {import("../lib/space-view.js").SpaceTask} card @param {string} column @param {number} at
   */
  function placeAt(card, column, at) {
    const t = latest(card);
    const shown = standsAmong(column, t);
    const others = shown.filter((x) => x.id !== t.id);
    const across = column !== t.column;
    if (!across && (column === "done" || shown.findIndex((x) => x.id === t.id) === at)) return;
    const order = column === "done" ? null : [...others.slice(0, at), t, ...others.slice(at)].map((x) => x.id);
    enqueue({ move: { id: t.id, column: /** @type {import("../lib/space-view.js").SpaceTask["column"]} */ (column), order, at: now() }, across });
  }

  /**
   * A task moved to another column, where the Space puts one moved in (Move to…): drawn there at once, written in its
   * turn. @param {import("../lib/space-view.js").SpaceTask} card @param {string} column
   */
  function moveTo(card, column) {
    const t = latest(card);
    if (column !== t.column) enqueue({ move: { id: t.id, column: /** @type {import("../lib/space-view.js").SpaceTask["column"]} */ (column), order: null, at: now() }, across: true });
  }

  /**
   * A move's write, built as it is sent from the tasks as the Space last answered them — the moves before it answered by
   * then —: its column where the person moved the card across, and the ids of those it then stands among there, top to
   * bottom, as the board draws it. Null where nothing is to be written: the Space has the task no more, or a move within
   * a column finds the card moved out of it since (`holds`).
   * @param {{ move: import("../lib/space-view.js").BoardMove, across: boolean }} q
   */
  function bodyOf(q) {
    const { move } = q;
    const was = told.find((x) => x.id === move.id);
    if (!was || !holds(told, q)) return null;
    const column = q.across ? { column: move.column } : null;
    if (!move.order) return column;
    const after = movedTasks(told, move);
    const t = after.find((x) => x.id === move.id) || was;
    return { ...column, order: standsAmong(move.column, t, after).map((x) => x.id) };
  }

  /**
   * The moves after one the Space refused, as the person placed them on the Space as it stands. Each made while the
   * refused one was drawn — up to the card's own next move, which places it again — saw that card where the refused
   * move put it: its order leaves the card out, so the card dropped keeps its place among the cards whose places stand,
   * and the Space keeps the refused card where it has it among them (`placedAmong`: below the one it stood below, else
   * above them all). @param {readonly Queued[]} queued @param {string} id  the refused move's card
   */
  const unplaced = (queued, id) => {
    let drawn = true;
    return queued.map((q) => {
      if (!drawn || !("move" in q)) return q;
      if (q.move.id === id) {
        drawn = false;
        return q;
      }
      return q.move.order ? { ...q, move: { ...q.move, order: q.move.order.filter((x) => x !== id) } } : q;
    });
  };

  /**
   * The oldest written, a move's body built now; answered or refused — the page says a refusal —, a move is drawn no
   * more over what the Space answered, so a refused one goes back as the Space has it and the moves after it are
   * placed on the Space as it stands (`unplaced`); a card's write hands on its answer. The next is written before
   * anything is drawn, so no drawing keeps the rest from the Space.
   */
  async function writeMoves() {
    const q = moves[0];
    /** @type {any} */
    let got = null;
    try {
      if ("write" in q) {
        q.sent?.();
        got = await ctx.write(...q.write);
      } else {
        const body = bodyOf(q);
        got = body ? await ctx.write("PATCH", `/tasks/${encodeURIComponent(q.move.id)}`, body) : {};
      }
    } finally {
      moves = moves.filter((x) => x !== q);
      if ("write" in q) q.done(got);
      else if (!got) moves = unplaced(moves, q.move.id);
      if (moves.length) void writeMoves();
      if ("move" in q) redraw();
    }
  }

  /**
   * The board drawn again with the moves the Space has not answered yet — not while a card is open in place —, and what
   * reads it told: its failure reported, never the board's.
   */
  const redraw = () => {
    tasks = ahead(told);
    if (!editing) paint();
    try {
      ctx.moved?.();
    } catch (err) {
      report(err);
    }
  };

  /** A column's task cards, by their task's id. @param {HTMLElement} col @returns {Map<string, HTMLElement>} */
  const cardsIn = (col) => new Map(Array.from(col.querySelectorAll("[data-task]")).map((c) => [c.getAttribute("data-task") || "", /** @type {HTMLElement} */ (c)]));

  /**
   * Where a drop at a height puts a task among those it stands with in that column: above the first card whose middle is
   * below it, else last. @param {HTMLElement} col @param {string} column @param {import("../lib/space-view.js").SpaceTask} t @param {number} y
   */
  function slotAt(col, column, t, y) {
    const others = standsAmong(column, t).filter((x) => x.id !== t.id);
    const cards = cardsIn(col);
    const i = others.findIndex((x) => {
      const r = cards.get(x.id)?.getBoundingClientRect();
      return !!r && y < r.top + r.height / 2;
    });
    return i < 0 ? others.length : i;
  }

  /** The drag's marks taken off the board. */
  const unmark = () => {
    for (const k of DRAG_MARKS) for (const x of Array.from(el.querySelectorAll(`.${k}`))) x.classList.remove(k);
  };

  /**
   * Where a drop would put the task, marked: the column under it, and the card it would go above — or below the last.
   * @param {HTMLElement} col @param {string} column @param {import("../lib/space-view.js").SpaceTask} t @param {number} at
   */
  function markAt(col, column, t, at) {
    unmark();
    col.classList.add("is-over");
    if (column === "done") return;
    const others = standsAmong(column, t).filter((x) => x.id !== t.id);
    const cards = cardsIn(col);
    if (others[at]) cards.get(others[at].id)?.classList.add("is-before");
    else if (others.length) cards.get(others[others.length - 1].id)?.classList.add("is-after");
  }

  /**
   * A column a task's card is dropped on: the card put where the drop marks. Files dragged from the computer are a card's
   * own (`dropsInto`), never the column's. @param {string} column
   */
  const takesCards = (column) => ({
    ondragover: (/** @type {DragEvent} */ e) => {
      if (!dragged || !carriesTask(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const col = /** @type {HTMLElement} */ (e.currentTarget);
      markAt(col, column, dragged, slotAt(col, column, dragged, e.clientY));
    },
    ondragleave: (/** @type {DragEvent} */ e) => {
      if (!(/** @type {HTMLElement} */ (e.currentTarget).contains(/** @type {Node | null} */ (e.relatedTarget)))) unmark();
    },
    ondrop: (/** @type {DragEvent} */ e) => {
      if (!dragged || !carriesTask(e)) return;
      e.preventDefault();
      const t = dragged;
      dragged = null;
      unmark();
      placeAt(t, column, slotAt(/** @type {HTMLElement} */ (e.currentTarget), column, t, e.clientY));
    },
  });

  /**
   * A task's card, to be dragged — none while a card is open in place, which the board does not draw over.
   * @param {import("../lib/space-view.js").SpaceTask} t
   */
  const dragsCard = (t) =>
    editing
      ? {}
      : {
          draggable: "true",
          ondragstart: (/** @type {DragEvent} */ e) => {
            if (!e.dataTransfer) return;
            dragged = t;
            e.dataTransfer.setData(TASK_DRAG, t.id);
            e.dataTransfer.effectAllowed = "move";
            /** @type {HTMLElement} */ (e.currentTarget).classList.add("is-dragged");
          },
          ondragend: (/** @type {DragEvent} */ e) => {
            dragged = null;
            /** @type {HTMLElement} */ (e.currentTarget).classList.remove("is-dragged");
            unmark();
          },
        };

  /**
   * A card's ⋯, at its corner: its menu, at the button. @param {string} title  what its menu offers
   * @param {(anchor: HTMLElement) => void} open
   */
  const dots = (title, open) =>
    h("button", { class: "ghost icon sb-dots", type: "button", "aria-label": "More", title, "aria-haspopup": "menu", html: icon("ellipsis"), onclick: (/** @type {Event} */ e) => open(/** @type {HTMLElement} */ (e.currentTarget)) });

  /**
   * A task's ⋯ (the owner's of 11-02): Move to each other column; Send to a lane — each chat of the Space's lanes, the
   * task in its box and the card in Doing, the chat its own; nothing is sent —; Start a chat on this…, Reproduce… and
   * Open its chat, as the card opened in place has them; Change… and Remove…, asked once more.
   * @param {import("../lib/space-view.js").SpaceTask} t @param {HTMLElement} anchor
   */
  function taskMenu(t, anchor) {
    const path = `/tasks/${encodeURIComponent(t.id)}`;
    const lanes = ctx.lanes();
    const chats = lanes.flatMap((l) => l.chains.map((chain) => ({ chain, lane: l })));
    // A Space with no repository says chats, not lanes (the Designer's walk of 10-29).
    const plain = !!ctx.plain?.();
    const open = t.column !== "done";
    /**
     * The task that chat's, as a chat taking it makes it — in Doing, out of park, planned for no folder —, and only then
     * in that chat's box: a move refused is said, and no chat opens. Written in its turn, after the moves made before it.
     * @param {string} chain
     */
    const send = async (chain) => {
      const got = await inTurn("PATCH", path, { chain, column: "doing", parked: false, place: null });
      if (got) ctx.sendTo?.(got.task || t, chain);
    };
    const starts = [
      ...(ctx.sendTo && chats.length
        ? [{ label: plain ? "Send to a chat" : "Send to a lane", icon: plain ? "messageCircle" : "gitFork", desc: "This task in that chat's box, the card in Doing: nothing is sent",
            submenu: chats.map(({ chain, lane }) => ({ label: ctx.nameOf(chain), ...(lanes.length > 1 && !plain ? { note: lane.chip } : {}), onClick: () => void send(chain) })) }]
        : []),
      ...(open ? [{ label: "Start a chat on this…", icon: "messageCirclePlus", desc: "A new chat in its folder, this task in its box: nothing runs until you send", onClick: () => ctx.startOn(latest(t)) }] : []),
      ...(open && !t.chain && ctx.reproduce && !plain
        ? [{ label: "Reproduce…", icon: "bug", desc: REPRO_TIP, onClick: () => ctx.reproduce?.(latest(t)) }]
        : []),
      ...(t.chain ? [{ label: `Open ${ctx.nameOf(t.chain)}`, icon: "messageCircle", onClick: () => ctx.openChat(/** @type {string} */ (t.chain)) }] : []),
    ];
    // Its place among those it stands with in its column, as a drag puts it: Done keeps the order its tasks were done in.
    // Move to… is a move as a drag's is, drawn at once and written in its turn.
    const mine = open ? standsAmong(t.column, t) : [];
    const at = mine.findIndex((x) => x.id === t.id);
    menu([
      ...MOVE_TO.filter(([v]) => v !== t.column).map(([v, w]) => ({ label: `Move to ${w}`, icon: "arrowRight", onClick: () => moveTo(t, v) })),
      ...(at > 0 ? [{ label: "Move up", icon: "arrowUp", onClick: () => placeAt(t, t.column, at - 1) }] : []),
      ...(at >= 0 && at < mine.length - 1 ? [{ label: "Move down", icon: "arrowDown", onClick: () => placeAt(t, t.column, at + 1) }] : []),
      ...(starts.length ? [{ type: "separator" }, ...starts] : []),
      { type: "separator" },
      ...(ctx.attach ? [{ label: "Attach files…", icon: "paperclip", desc: "Pictures, documents, any file: kept on this task", onClick: () => pickFiles((files) => void ctx.attach?.(t, files)) }] : []),
      { label: "Change…", icon: "pencil", onClick: () => openEditor(t.id) },
      { label: "Remove…", icon: "trash2", variant: "destructive", onClick: async () => {
        const sure = await confirmDialog({ title: `Remove “${t.title}”?`, description: t.chain ? `It goes from the board; ${ctx.nameOf(t.chain)} stays as it is.` : "It goes from the board.", confirmLabel: "Remove", destructive: true });
        if (sure) void inTurn("DELETE", path);
      } },
    ], { anchor, side: "bottom", align: "end", width: 290 });
  }

  /**
   * An issue a pull put on the board: its title and line, its key as its service says it, "here only" where it was
   * moved on the board alone, its service's name, its age as read — faint where its pull's last read failed. A press
   * opens its menu: Open it in its service, Move to…, Start a chat on this….
   * @param {import("../lib/space-view.js").PulledTask} f
   */
  function pulledEl(f) {
    // Its menu at the face that stands: the board is drawn in place, so the face pressed is the one on the page.
    const face = h("button", { class: "sb-face", type: "button", title: `${f.keyWords} of ${f.title}: open it, move it, start a chat on it`, "aria-haspopup": "menu", onclick: (/** @type {Event} */ e) => ctx.pulledMenu?.(f, /** @type {HTMLElement} */ (e.currentTarget)) },
      h("span", { class: "sb-t" }, f.task),
      ...(f.line && f.column !== "done" ? [h("span", { class: "sb-d" }, f.line)] : []));
    return h("article", { class: `sb-card is-fed is-pulled${f.column === "done" ? " is-done" : ""}${f.column === "waits" ? " is-ask" : ""}${f.stale ? " is-stale" : ""}${ctx.pulledMenu ? " has-dots" : ""}`, role: "listitem", "data-pulled": `${f.pull} ${f.key}`, "data-key": `pulled:${f.pull} ${f.key}` },
      face,
      ...(ctx.pulledMenu ? [dots(face.getAttribute("title") || "", (a) => ctx.pulledMenu?.(f, a))] : []),
      h("div", { class: "sb-f" },
        h("span", { class: "sb-key", title: f.state ? `${f.title} says ${f.state}` : f.keyWords }, f.keyWords),
        ...(f.moved ? [h("span", { class: "sb-tag", title: `Moved on this board only: ${f.title} still says ${f.state}` }, "here only")] : []),
        h("span", { class: "sb-src", title: `From ${f.title}, pulled onto this board` }, h("span", { class: "sb-src-ic", html: ICONS.download }), f.title),
        h("span", { class: "sb-sp" }),
        h("span", { class: "sb-age", title: f.stale ? `Its last read failed: what ${f.title} answered ${lookWords(f.at, now())}` : `Read ${ageWords(f.at, now())}` }, f.stale ? `as read ${lookWords(f.at, now())}` : ageWords(f.at, now()))));
  }

  /**
   * A kept dashboard's row as a card: its title and line, the dashboard's name, its age as read — "as read today 12:02",
   * faint, where its last read failed or its source waits for your Keep. A press opens its menu.
   * @param {import("../lib/space-view.js").FedTask} f
   */
  function fedEl(f) {
    const face = h("button", { class: "sb-face", type: "button", title: `A row of ${f.title}: its buttons, Pick up…, Open its page`, "aria-haspopup": "menu", onclick: (/** @type {Event} */ e) => ctx.fedMenu?.(f, /** @type {HTMLElement} */ (e.currentTarget)) },
      h("span", { class: "sb-t" }, f.task),
      ...(f.line && f.column !== "done" ? [h("span", { class: "sb-d" }, f.line)] : []));
    return h("article", { class: `sb-card is-fed${f.column === "done" ? " is-done" : ""}${f.column === "waits" ? " is-ask" : ""}${f.stale ? " is-stale" : ""}${ctx.fedMenu ? " has-dots" : ""}`, role: "listitem", "data-fed": `${f.dashboard} ${f.key}`, "data-key": `fed:${f.dashboard} ${f.key}` },
      face,
      ...(ctx.fedMenu ? [dots(face.getAttribute("title") || "", (a) => ctx.fedMenu?.(f, a))] : []),
      h("div", { class: "sb-f" },
        h("span", { class: "sb-src", title: `From ${f.title}, a dashboard of this Space, as Filament read it` }, h("span", { class: "sb-src-ic", html: ICONS.layoutDashboard }), f.title),
        h("span", { class: "sb-sp" }),
        // A moment as the Space says one: "as read today 00:17".
        h("span", { class: "sb-age", title: f.held ? `${f.title} waits for your Keep: what it read ${lookWords(f.at, now())}` : f.stale ? `Its last read failed: what ${f.title} read ${lookWords(f.at, now())}` : `Read ${ageWords(f.at, now())}` }, f.stale ? `as read ${lookWords(f.at, now())}` : ageWords(f.at, now()))));
  }

  /** A card's lane, where there are two to tell apart. @param {import("../lib/space-view.js").LaneRef | null} lane */
  const chip = (lane) => (lane && ctx.lanes().length > 1 ? [h("span", { class: `sp-branch${lane.main ? " is-main" : ""}` }, lane.chip)] : []);

  /** How many pictures a card shows; the rest of its files are counted by its paperclip. */
  const PICS_SHOWN = 3;
  /** A card's first pictures, small, under its words. @param {import("../lib/space-view.js").SpaceTask} t */
  const picsOf = (t) => {
    const pics = (t.files || []).filter((f) => f.kind === "image").slice(0, PICS_SHOWN);
    const url = ctx.fileUrl;
    return pics.length && url ? [h("span", { class: "sb-pics" }, ...pics.map((f) => h("img", { class: "sb-pic", src: url(t, f), alt: f.name, loading: "lazy", draggable: "false" })))] : [];
  };
  /** How many files a card's task holds, by a paperclip; their names on its title. @param {import("../lib/space-view.js").SpaceTask} t */
  const clipOf = (t) =>
    t.files?.length ? [h("span", { class: "sb-clip", title: t.files.map((f) => f.name).join("\n") }, h("span", { class: "sb-clip-ic", html: ICONS.paperclip }), String(t.files.length))] : [];

  /**
   * Files dropped on a card, or on a task open in place, handed to `take`; the card marked while they are over it.
   * @param {(files: File[]) => void} take
   */
  const dropsInto = (take) => ({
    ondragover: (/** @type {DragEvent} */ e) => {
      if (!ctx.attach || !carriesFiles(e)) return;
      e.preventDefault();
      /** @type {HTMLElement} */ (e.currentTarget).classList.add("is-drop");
    },
    ondragleave: (/** @type {DragEvent} */ e) => {
      const at = /** @type {HTMLElement} */ (e.currentTarget);
      if (!at.contains(/** @type {Node | null} */ (e.relatedTarget))) at.classList.remove("is-drop");
    },
    ondrop: (/** @type {DragEvent} */ e) => {
      if (!ctx.attach || !carriesFiles(e)) return;
      e.preventDefault();
      /** @type {HTMLElement} */ (e.currentTarget).classList.remove("is-drop");
      take(Array.from(e.dataTransfer?.files || []));
    },
  });

  /** @param {import("../lib/space-view.js").SpaceTask} t */
  function cardEl(t) {
    if (editing === t.id) return editorEl(t);
    const lane = laneOfTask(t, ctx.lanes());
    const chat = t.chain ? ctx.nameOf(t.chain) : "";
    const asking = !!t.chain && t.column !== "done" && ctx.asks(t.chain);
    /** The way to the chat a card's task waits on, where one does. */
    const go = asking
      ? h("button", { class: "sb-go is-ask", type: "button", onclick: () => ctx.openChat(/** @type {string} */ (t.chain)) }, "Open the ask ›")
      : t.column === "waits" && t.chain
        ? h("button", { class: "sb-go", type: "button", onclick: () => ctx.openChat(/** @type {string} */ (t.chain)) }, "Open ›")
        : null;
    const age = ageWords(t.column === "done" ? (t.doneAt ?? t.movedAt) : t.movedAt, now(), { day: t.column === "done" });
    return h("article", { class: `sb-card${t.column === "done" ? " is-done" : ""}${t.column === "waits" || asking ? " is-ask" : ""}${t.parked ? " is-parked" : ""} has-dots`, role: "listitem", "data-task": t.id, "data-key": `task:${t.id}`,
        ...dropsInto((files) => void ctx.attach?.(t, files)), ...dragsCard(t) },
      h("button", { class: "sb-face", type: "button", title: "Change this task", onclick: () => openEditor(t.id) },
        h("span", { class: "sb-t" }, t.title),
        ...(t.line && t.column !== "done" ? [h("span", { class: "sb-d" }, t.line)] : []),
        ...picsOf(t)),
      dots(`Move it, send it to a ${ctx.plain?.() ? "chat" : "lane"}, start a chat on it, attach files, change or remove it`, (a) => taskMenu(t, a)),
      h("div", { class: "sb-f" },
        ...(t.parked ? [h("span", { class: "sb-tag" }, "parked")] : []),
        ...clipOf(t),
        ...chip(lane),
        ...(chat && !go ? [h("span", { class: "sb-who", title: chat }, chat)] : []),
        h("span", { class: "sb-sp" }),
        go || h("span", { class: "sb-age" }, age)));
  }

  /**
   * A task open in place: its words, its column and parked, Save; Remove asked once more; Start a chat on this… for a
   * task no chat has; Open its chat for one that has.
   * @param {import("../lib/space-view.js").SpaceTask | null} t  null for a new one
   */
  function editorEl(t) {
    const title = /** @type {HTMLInputElement} */ (h("input", { class: "zc-input sb-in", type: "text", maxlength: "120", placeholder: "What the task is, in a few words", value: t?.title || "", "aria-label": "Title" }));
    const line = /** @type {HTMLTextAreaElement} */ (h("textarea", { class: "zc-input sb-in sb-line-in", rows: "2", maxlength: "400", placeholder: "One line on it (optional)", "aria-label": "Its line" }));
    line.value = t?.line || "";
    const column = /** @type {HTMLSelectElement} */ (h("select", { class: "zc-input sb-in sb-col-in", "aria-label": "Column" }, ...MOVE_TO.map(([v, w]) => h("option", { value: v, ...((t?.column || "planned") === v ? { selected: "" } : {}) }, w))));
    const parked = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", ...(t?.parked ? { checked: "" } : {}) }));
    const said = h("span", { class: "sb-said", role: "status" });
    // Closed: this opening of it alone — a Save or a Remove answered after the person opened another closes nothing.
    const mine = opened;
    const close = () => {
      if (opened !== mine) return;
      editing = null;
      paint();
    };
    // Its files: those it holds — drawn again from each answer, as the board is not drawn while it is open — and, for a
    // new task, those picked to attach once Add makes it.
    let held = t?.files || [];
    /** @type {File[]} */
    let picked = [];
    const filesEl = h("div", { class: "sb-files" });
    /** @param {import("../lib/space-view.js").TaskFile} f */
    const heldRow = (f) => {
      const url = t && ctx.fileUrl ? ctx.fileUrl(t, f) : "";
      return h("div", { class: "sb-file", "data-file": f.id },
        f.kind === "image" && url ? h("img", { class: "sb-file-pic", src: url, alt: "" }) : h("span", { class: "sb-file-ic", html: f.kind === "file" ? ICONS.file : ICONS.fileText }),
        // A picture and text open in a tab of their own; any other kind is downloaded.
        h("a", { class: "sb-file-name", href: url, target: "_blank", rel: "noopener", title: f.name, ...(f.kind === "image" || f.kind === "text" ? {} : { download: f.name }) }, f.name),
        h("span", { class: "sb-file-size" }, sizeWords(f.bytes)),
        h("button", { class: "ghost icon sb-file-x", type: "button", "aria-label": `Remove ${f.name}`, title: `Remove ${f.name}`, html: icon("x"), onclick: async () => {
          if (!t) return;
          const sure = await confirmDialog({ title: `Remove “${f.name}”?`, description: `It goes from “${t.title}” for good.`, confirmLabel: "Remove", destructive: true });
          if (!sure) return;
          const got = await ctx.write("DELETE", `/tasks/${encodeURIComponent(t.id)}/files/${encodeURIComponent(f.id)}`);
          if (got?.space) { held = got.space.tasks.find((/** @type {any} */ x) => x.id === t.id)?.files || []; drawFiles(); }
        } }));
    };
    /** @param {File} f @param {number} i */
    const pickedRow = (f, i) =>
      h("div", { class: "sb-file is-picked" },
        h("span", { class: "sb-file-ic", html: f.type.startsWith("image/") ? ICONS.image : ICONS.file }),
        h("span", { class: "sb-file-name", title: `${f.name}: attached as Add makes the task` }, f.name),
        h("span", { class: "sb-file-size" }, sizeWords(f.size)),
        h("button", { class: "ghost icon sb-file-x", type: "button", "aria-label": `Leave out ${f.name}`, title: `Leave out ${f.name}`, html: icon("x"), onclick: () => { picked = picked.filter((_, k) => k !== i); drawFiles(); } }));
    const drawFiles = () => {
      filesEl.replaceChildren(...held.map(heldRow), ...picked.map(pickedRow));
      filesEl.classList.toggle("hidden", !held.length && !picked.length);
    };
    drawFiles();
    /** Files to attach: to the task now, or, for a new one, once Add makes it. @param {File[]} files */
    const take = async (files) => {
      if (!files.length) return;
      if (!t) { picked = [...picked, ...files]; drawFiles(); return; }
      const got = await ctx.attach?.(t, files);
      if (got) { held = got.files || []; drawFiles(); }
    };
    const saveBtn = /** @type {HTMLButtonElement} */ (h("button", { class: "sm primary", type: "submit" }, t ? "Save" : "Add"));
    /** Whether its Save or its Remove is on its way: one press each, nothing more written until it is answered. */
    let busy = false;
    /**
     * Its Save or Remove on its way, on its button; one written in its turn behind moves the Space has not answered yet
     * says in its line that it waits for them, until it is written. @param {HTMLButtonElement} btn @param {string} words
     * @param {boolean} inLine  whether it is written in its turn (`inTurn`)
     */
    const waiting = (btn, words, inLine) => {
      busy = true;
      btn.disabled = true;
      btn.replaceChildren(words);
      said.replaceChildren(inLine && moves.length ? "Waits for the moves before it" : "");
    };
    /** Answered with a refusal (the page says why): its button as it was. @param {HTMLButtonElement} btn @param {string} words */
    const again = (btn, words) => {
      busy = false;
      btn.disabled = false;
      btn.replaceChildren(words);
      said.replaceChildren();
    };
    const sent = () => said.replaceChildren();
    const save = async () => {
      if (busy) return;
      // Its column only where the person changed it: one the board drew from a move the Space then refused is not
      // written again.
      const body = { title: title.value, line: line.value, ...(!t || column.value !== t.column ? { column: column.value } : {}), parked: parked.checked };
      if (!title.value.trim()) { said.replaceChildren("A task needs a title"); title.focus(); return; }
      waiting(saveBtn, t ? "Saving…" : "Adding…", !!t);
      // A task's change waits its turn behind the moves made before it; a new task has none.
      const ok = t ? await inTurn("PATCH", `/tasks/${encodeURIComponent(t.id)}`, body, sent) : await ctx.write("POST", "/tasks", body);
      if (!ok) return void again(saveBtn, t ? "Save" : "Add");
      if (!t && picked.length && ok.task) await ctx.attach?.(ok.task, picked);
      close();
    };
    let removing = false;
    const removeBtn = /** @type {HTMLButtonElement} */ (h("button", { class: "ghost sm sb-remove", type: "button", onclick: async () => {
      if (!t || busy) return;
      if (!removing) { removing = true; removeBtn.replaceChildren("Remove for good?"); removeBtn.classList.add("is-sure"); return; }
      waiting(removeBtn, "Removing…", true);
      if (await inTurn("DELETE", `/tasks/${encodeURIComponent(t.id)}`, undefined, sent)) close();
      else again(removeBtn, "Remove for good?");
    } }, "Remove"));
    // The editor is never morphed (`data-self`): a draw that brings an editor puts it in whole. What keeps the words
    // typed is that the board is not drawn again while one is open (`editing`, in `paint` and `tick`), so what Save reads
    // is what the person typed.
    const form = h("form", { class: "sb-card sb-editor", role: "listitem", ...(t ? { "data-task": t.id, "data-key": `editor:${t.id}` } : { "data-new": "", "data-key": "editor:new" }), "data-self": "",
      onsubmit: (/** @type {Event} */ e) => { e.preventDefault(); void save(); },
      onkeydown: (/** @type {KeyboardEvent} */ e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } },
      // A picture or a file pasted is attached; words pasted go in as words.
      onpaste: (/** @type {ClipboardEvent} */ e) => {
        const files = ctx.attach ? pastedFiles(e) : [];
        if (!files.length) return;
        if (!e.clipboardData?.getData("text/plain").trim()) e.preventDefault();
        void take(files);
      },
      ...dropsInto((files) => void take(files)) },
      title,
      line,
      h("div", { class: "sb-ed-row" }, column, h("label", { class: "sb-park" }, parked, "Parked")),
      filesEl,
      ...(ctx.attach
        ? [h("button", { class: "ghost sm sb-attach", type: "button", title: "Pictures, documents, any file: kept on this task. You can drop or paste them here too.", onclick: () => pickFiles((files) => void take(files)) },
            h("span", { class: "sp-btn-ic", html: ICONS.paperclip }), "Attach files…")]
        : []),
      ...(t && !t.chain && t.column !== "done"
        ? [h("button", { class: "ghost sm sb-start", type: "button", title: "The Start in its folder, with this task as the message; nothing runs until you send", onclick: () => { ctx.startOn({ ...latest(t), files: held }); close(); } },
            h("span", { class: "sp-btn-ic", html: ICONS.messageCirclePlus }), "Start a chat on this…")]
        : []),
      // Not where the Space's folder is no repository: the Builder's failing test is on a new lane (the Designer, 10-29).
      ...(t && !t.chain && t.column !== "done" && ctx.reproduce && !ctx.plain?.()
        ? [h("button", { class: "ghost sm sb-repro", type: "button", title: REPRO_TIP, onclick: () => { ctx.reproduce?.(latest(t)); close(); } },
            h("span", { class: "sp-btn-ic", html: ICONS.bug }), "Reproduce…")]
        : []),
      ...(t?.chain ? [h("button", { class: "ghost sm sb-open", type: "button", onclick: () => ctx.openChat(/** @type {string} */ (t.chain)) }, `Open ${ctx.nameOf(t.chain)}`)] : []),
      h("div", { class: "sb-ed-row sb-ed-acts" },
        ...(t ? [removeBtn] : []),
        said,
        h("span", { class: "sb-sp" }),
        h("button", { class: "ghost sm", type: "button", onclick: close }, "Cancel"),
        saveBtn));
    queueMicrotask(() => title.focus?.());
    return form;
  }

  /**
   * The board drawn again from the tasks it last read; with none to show, one line (HarnessV4_Space_Plan S1). Drawn in
   * place, each column and card kept by its key: it is drawn at every move of the Space and every tick of the clock, and
   * a card made anew each time put a new face under a resting pointer (the owner's of 11-01: buttons blinking under a
   * resting pointer, clicks lost).
   */
  function paint() {
    const cols = boardColumns(tasks, now());
    const empty = !cols.some((c) => c.tasks.length) && !fed.length && !pulled.length && editing !== "+";
    el.classList.toggle("is-empty", empty);
    if (empty) {
      // The chats here, in either kind of Space — and before the Space is read (the Designer, 10-29: a Space of your own's
      // said "the project's agents", then, on its second walk, said so until it was read). On a project with no Space
      // yet no chat adds a task: the first is the person's, and makes it (by need, 11-12).
      morphChildren(el, [h("p", { class: "sb-none" }, ctx.makes?.()
        ? "No tasks yet. New task… adds the first and makes this project's Space; from then the chats here add theirs as they work."
        : "No tasks yet. New task… adds one; the chats here add theirs as they work.")]);
      return;
    }
    morphChildren(el, cols.map((c) => {
      // Typed tasks first, then a dashboard's cards (S4c, case 10), then a pull's; Done folds them all past its first three.
      const all = [...c.tasks.map((t) => cardEl(t)), ...fed.filter((f) => f.column === c.key).map(fedEl), ...pulled.filter((f) => f.column === c.key).map(pulledEl)];
      const shown = c.key === "done" && !doneAll ? all.slice(0, DONE_SHOWN) : all;
      const more = all.length - shown.length;
      const mark = HEAD_MARK[/** @type {keyof typeof HEAD_MARK} */ (c.key)];
      return h("section", { class: `sb-col is-${c.key}`, "aria-label": c.head, "data-key": `col:${c.key}`, ...takesCards(c.key) },
        h("div", { class: "sb-head" },
          mark === "spin" ? h("span", { class: "sb-mark sp-spin is-still", html: ICONS.loader }) : h("span", { class: `sb-mark ${mark}` }),
          h("span", { class: "sb-head-name" }, c.head),
          h("span", { class: "sb-count" }, String(all.length)),
          h("span", { class: "sb-sp" }),
          ...(c.key === "planned" ? [h("button", { class: "ghost icon sb-add", type: "button", "aria-label": "Add a task", title: "Add a task", html: icon("plus"), onclick: () => openEditor("+") })] : [])),
        ...(c.key === "planned" && editing === "+" ? [editorEl(null)] : []),
        ...shown,
        ...(more > 0 ? [h("button", { class: "sb-more", type: "button", onclick: () => { doneAll = true; paint(); } }, `+ ${more} more`)] : []),
        ...(c.key === "done" && doneAll && all.length > DONE_SHOWN ? [h("button", { class: "sb-more", type: "button", onclick: () => { doneAll = false; paint(); } }, "Show fewer")] : []));
    }));
  }

  return {
    el,
    /**
     * The tasks as the Space now has them — the person's moves it has not answered yet drawn over them —, and the cards
     * its kept dashboards and its pulls put on it; a card open to change stays open while its task does.
     * @param {import("../lib/space-view.js").SpaceTask[]} next
     * @param {{ force?: boolean, fed?: import("../lib/space-view.js").FedTask[], pulled?: import("../lib/space-view.js").PulledTask[] }} [o]
     */
    paint(next, { force = false, fed: fedNext = fed, pulled: pulledNext = pulled } = {}) {
      const was = JSON.stringify([tasks, fed, pulled]);
      told = next;
      tasks = ahead(told);
      fed = fedNext;
      pulled = pulledNext;
      if (editing && editing !== "+" && !tasks.some((t) => t.id === editing)) editing = null;
      // A card open to change is not drawn over while the person types in it.
      if (editing && !force) return;
      if (force || JSON.stringify([tasks, fed, pulled]) !== was || !el.childElementCount) paint();
    },
    /**
     * Tasks as the board draws them: those, with the person's moves the Space has not answered yet made over them — what
     * a lane's Has: reads, so it names the card the board shows. @param {readonly import("../lib/space-view.js").SpaceTask[]} ts
     */
    shown: (ts) => ahead(ts),
    /** Draw again: the ages and who asks you move with the clock. */
    tick: () => { if (!editing) paint(); },
    /** New task…: the board opens with a new card on Planned. */
    add() {
      openEditor("+");
    },
  };
}
