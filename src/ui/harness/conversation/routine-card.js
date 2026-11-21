// @ts-check
// A routine or a watcher an agent proposed is proposed right in its chat (the owner's of 11-12: "the watcher that is
// proposed inside the Space is a bad design, watcher should always be proposed right in the chat"): the card under the
// call that proposed or changed it. Proposed, it is the Switch on sheet itself — what waking it starts, what it does,
// when, what it runs or its address, what it may do, the model it runs on, Ask for a change…, Not now and Switch on
// (space/routine-sheet.js `routineView`, the same parts and presses as the Space's sheet) —; on, one line that says it
// listens, or runs at its times, with What it does and the Space's Watchers or Routines; paused, removed, or changed by
// a later call, one line that says so. It follows its Space on the page's feed and reads its routine again as it moves.
// Not now folds it to one line, kept by this browser for that proposal: the agent's next change unfolds it. A card in
// another chat than the one that made it (a fork's copy of the call) says where it is switched on, and switches
// nothing; on a view-only device's page it switches nothing either, and says why.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { followWhileDrawn } from "../lib/follow-drawn.js";
import { routineView } from "../space/routine-sheet.js";
import { routineHands } from "../space/routine-presses.js";

/**
 * What a call made, as its run said it (the `routine` event, kept on the call by labels.js), or as its answer says it
 * where none rode — an older run's: the routine's id, which kind, whether the call changed it, and its project and `at`
 * where the event said them.
 * @typedef {{ project: string | null, routine: string, watcher: boolean, change: boolean, at: number | null }} Proposed
 * @typedef {import("../space/routine-sheet.js").RoutineRow} RoutineRow
 */

/**
 * What a card reads and does — the app's; null on a page that offers none (a test, a card drawn alone). `here`: the
 * chat the page shows and its project; `read`: one routine of a project (`GET /space/:project/routines/:id`), or why
 * it is not there (`gone`); `watch`: the project's Space heard moving, its stop returned; `write`: a write under the
 * routine's path, its answer, or null where it was refused (the app says why); `askChat`: a chat's box begun with an
 * ask; `openChat`; `openSpace`: the project's Watchers (`watcher`) or Routines; `catalogue`, `modelName`: the models a
 * run may start on, and a model's name, as the Space's sheet has them; `viewOnly`: the page switches nothing.
 * @type {{ here: (() => { chain: string | null, project: string | null }) | null,
 *   read: ((project: string, id: string) => Promise<{ routine: RoutineRow, place: string } | { gone: string }>) | null,
 *   watch: ((project: string, fn: () => void) => () => void) | null,
 *   write: ((project: string, id: string, method: string, path: string, body?: any) => Promise<any>) | null,
 *   askChat: ((chain: string, words: string) => void) | null, openChat: ((chain: string) => void) | null,
 *   openSpace: ((project: string, watcher: boolean) => void) | null,
 *   catalogue: import("../space/model-row.js").Catalogue | null, modelName: ((model: string) => string) | null,
 *   viewOnly: (() => boolean) | null }}
 */
export const routineActions = { here: null, read: null, watch: null, write: null, askChat: null, openChat: null, openSpace: null, catalogue: null, modelName: null, viewOnly: null };

/** What a view-only page says in place of Switch on. */
export const VIEW_ONLY_WORDS = "This device is view-only: it switches nothing on.";

/**
 * The routine a space call made, or null: a call still running, refused or failed made none, and neither did any
 * other action of the tool.
 * @param {any} t  the call's record
 * @returns {Proposed | null}
 */
export function proposedOf(t) {
  if (!t || t.state === "running" || t.state === "failed" || t.state === "refused" || t.state === "declined" || t.state === "vetoed") return null;
  const r = t.routine;
  if (r && r.routine) return { project: r.project ? String(r.project) : null, routine: String(r.routine), watcher: r.watcher === true, change: r.change === true, at: Number(r.at) > 0 ? Number(r.at) : null };
  const said = String(t.preview || "");
  const m = /^(Watcher|Routine) (r\d+) "/.exec(said);
  return m ? { project: null, routine: m[2], watcher: m[1] === "Watcher", change: /" (?:\([^)]*\) )?is changed and /.test(said), at: null } : null;
}

const FOLD_KEY = "harness.routineFolded";
/** The newest folds kept: an older proposal is long switched on, or gone. */
const FOLDS_KEPT = 200;
/** The proposals this browser folded, each `project/id@at`. */
const folds = {
  /** @returns {string[]} */
  get() {
    try {
      const v = JSON.parse(globalThis.localStorage?.getItem(FOLD_KEY) || "[]");
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  },
  /** @param {string} key */
  add(key) {
    try {
      globalThis.localStorage?.setItem(FOLD_KEY, JSON.stringify([...this.get().filter((k) => k !== key), key].slice(-FOLDS_KEPT)));
    } catch {}
  },
};

/**
 * The cards drawn, by the chat they are drawn in and their call: a row drawn again passes the one that stands. A fork
 * holds its chat's calls under their ids, and its card says where the proposal is switched on: never its chat's card.
 * @type {Map<string, { el: HTMLElement, key: string }>}
 */
const cards = new Map();

/**
 * The card under a call that made a routine: the one that stands for that call, else a new one, which reads its
 * routine and follows its Space while it is in the document.
 * @param {Proposed} p @param {string} callId
 * @returns {HTMLElement}
 */
export function routineCard(p, callId) {
  const key = JSON.stringify(p);
  const where = routineActions.here?.() || { chain: null, project: null };
  const at = `${where.chain || ""}|${callId}`;
  const had = cards.get(at);
  if (had && had.key === key) return had.el;
  const project = p.project || where.project;
  const el = /** @type {HTMLElement} */ (h("div", { class: "rp-card", "data-self": "", "data-routine": p.routine }));
  /** The routine as its Space says it, read last. @type {RoutineRow | null} */
  let row = null;
  let place = "its project";
  /** Why it is not there, where it is not. */
  let gone = "";
  /** What the person opened: "auto" as it stands, "what" What it does of one on, "open" a folded proposal's sheet. @type {"auto" | "what" | "open"} */
  let mode = "auto";
  /** The sheet's view standing in the card, and what it was drawn of. @type {ReturnType<typeof routineView> | null} */
  let view = null;
  let viewKey = "";
  let reading = false;
  let again = false;
  /** A Switch on under way: what the Space says meanwhile is drawn once it has its answer, never over the press. */
  let switching = false;
  let owed = false;
  /** The sheet's tag: where it stands, said again as the routine moves under a view that stays. @type {HTMLElement | null} */
  let tag = null;

  const kindOf = (/** @type {RoutineRow} */ r) => (r.trigger ? "Watcher" : "Routine");
  const glyphOf = (/** @type {RoutineRow} */ r) => (r.trigger ? "eye" : "clock3");
  const foldKey = (/** @type {RoutineRow} */ r) => `${project}/${r.id}@${r.at}`;
  /** A button of the card's lines. @param {string} words @param {() => void} press @param {string} [cls] */
  const btn = (words, press, cls = "inst-link") => h("button", { class: `${cls} rp-act`, type: "button", onclick: press }, words);
  const toSpace = (/** @type {RoutineRow} */ r) => (routineActions.openSpace && project ? [btn(r.trigger ? "Watchers" : "Routines", () => routineActions.openSpace?.(String(project), !!r.trigger))] : []);
  /** One line of the card: its glyph, its words, its presses. @param {string} glyph @param {any[]} words @param {any[]} [acts] @param {string} [tone] */
  const line = (glyph, words, acts = [], tone = "") =>
    h("div", { class: `rp-line${tone ? ` is-${tone}` : ""}` },
      h("span", { class: "rp-ic", "aria-hidden": "true", html: /** @type {any} */ (ICONS)[glyph] || ICONS.eye }),
      h("span", { class: "rp-words" }, ...words),
      ...(acts.length ? [h("span", { class: "rp-acts" }, ...acts)] : []));
  const named = (/** @type {RoutineRow} */ r) => h("b", {}, `“${r.title}”`);
  const letGo = () => {
    view?.close();
    view = null;
    viewKey = "";
  };

  async function read() {
    if (!project || !routineActions.read) return paint();
    if (reading) return void (again = true);
    reading = true;
    try {
      const got = await routineActions.read(String(project), p.routine);
      if ("gone" in got) {
        gone = got.gone;
        row = null;
      } else {
        gone = "";
        row = got.routine;
        place = got.place || place;
      }
    } catch (e) {
      gone = String(/** @type {any} */ (e)?.message || e);
    } finally {
      reading = false;
    }
    paint();
    if (again) {
      again = false;
      void read();
    }
  }

  /** The sheet's view in the card: a proposal's whole, or What it does of one on. @param {RoutineRow} r @param {boolean} readOnly */
  function sheetIn(r, readOnly) {
    const k = `${readOnly ? "what" : "full"}|${r.at}`;
    if (view && viewKey === k) return dress(r, readOnly);
    letGo();
    const hands = routineActions.write
      ? routineHands(r, {
          // A refusal reads the routine again before its answer: the sheet is drawn again on what stands.
          write: async (method, path, body) => {
            const got = await routineActions.write?.(String(project), r.id, method, path, body);
            if (!got) await read();
            return got;
          },
          stands: () => row || undefined,
          moved: () => paint(),
        })
      : null;
    view = routineView({
      r,
      place,
      readOnly,
      here: where.chain || undefined,
      ...(hands && !readOnly
        ? {
            ...hands,
            // A watcher a program posts to stays drawn as What it does once on, its address in sight: its secret is
            // shown that once.
            switchOn: async (/** @type {string | undefined} */ seal) => {
              switching = true;
              let ok = false;
              try {
                ok = await hands.switchOn(seal);
                if (ok && r.words.webhook) {
                  mode = "what";
                  viewKey = `what|${r.at}`;
                }
              } finally {
                switching = false;
              }
              const late = owed;
              owed = false;
              // On, a watcher a program posts to reads where it stands now, its view kept; any other is read by its
              // sheet's let-go. Refused, the card is drawn on what its read found.
              if (ok && r.words.webhook) void read();
              else if (!ok && late) paint();
              return ok;
            },
          }
        : hands ? { request: hands.request } : {}),
      ...(hands ? { chooseModel: hands.chooseModel } : {}),
      stands: () => row || undefined,
      ...(routineActions.catalogue ? { catalogue: routineActions.catalogue } : {}),
      ...(r.spaceOn ? { space: r.spaceOn } : {}),
      ...(routineActions.modelName ? { nameOf: routineActions.modelName } : {}),
      ...(routineActions.openChat ? { openChat: routineActions.openChat } : {}),
      ...(routineActions.askChat ? { askChat: routineActions.askChat } : {}),
      done: (why) => {
        if (why === "on") {
          mode = "auto";
          void read();
        } else if (why === "leave") {
          // Not now folds the proposal for this browser; Close puts What it does away, a webhook's after its Switch on too.
          if (row?.state === "proposed") folds.add(foldKey(row));
          mode = "auto";
          paint();
        }
      },
    });
    viewKey = k;
    tag = /** @type {HTMLElement} */ (h("span", { class: "rp-tag" }));
    el.replaceChildren(
      h("div", { class: "rp-head" },
        h("span", { class: "rp-ic", "aria-hidden": "true", html: r.trigger ? ICONS.eye : ICONS.clock3 }),
        view.head,
        tag),
      view.body,
      view.foot);
    dress(r, readOnly);
  }

  /** Where the routine stands, on the sheet's tag and its edge: on, it reads as on, whatever view stands. @param {RoutineRow} r @param {boolean} readOnly */
  function dress(r, readOnly) {
    const on = readOnly || r.state === "on";
    if (tag) tag.textContent = on ? (r.paused ? "Paused" : r.trigger ? "Listening" : "On") : p.change ? "Changed" : "Proposed";
    el.className = `rp-card is-sheet${on ? " is-on" : ""}`;
  }

  /** One line in the card's place: the view, where one stood, goes. @param {HTMLElement} l @param {string} [cls] */
  const only = (l, cls = "") => {
    letGo();
    el.replaceChildren(l);
    el.className = `rp-card${cls ? ` ${cls}` : ""}`;
  };

  function paint() {
    if (switching) return void (owed = true);
    if (!project) return only(line("eye", ["Its project could not be told: its Space's Watchers hold it."], [], "quiet"));
    if (gone) return only(line(p.watcher ? "eye" : "clock3", [gone], [], "quiet"));
    const r = row;
    if (!r) return only(line("loader", [`Reading the ${p.watcher ? "watcher" : "routine"}…`], [], "quiet"));
    const kind = kindOf(r);
    if (r.state === "removed") return only(line(glyphOf(r), [`${kind} `, named(r), " was removed: Put back is in the Space."], toSpace(r), "quiet"));
    // A later call changed it: that call's card is the one that asks.
    if (p.at != null && r.at > p.at) return only(line(glyphOf(r), ["A later call changed ", named(r), r.state === "proposed" ? ": its card further down asks you." : ": its card further down says where it stands."], [], "quiet"));
    if (r.state === "on") {
      if (mode === "what") return sheetIn(r, true);
      const words = r.paused
        ? [`${kind} `, named(r), ` is paused${r.pausedWhy ? `: ${r.pausedWhy}` : ""}.`]
        : r.trigger
          ? [`${kind} `, named(r), ` listens: ${r.words.when}.`]
          : [`${kind} `, named(r), ` is on: ${r.words.when}${r.words.next ? `, next ${r.words.next}` : ""}.`];
      return only(line(glyphOf(r), words, [btn("What it does", () => { mode = "what"; paint(); }), ...toSpace(r)], r.paused ? "quiet" : "on"), "is-on");
    }
    // Proposed, in another chat than the one that made it: where it is switched on.
    if (where.chain && r.madeIn && r.madeIn !== where.chain)
      return only(line(glyphOf(r), [`${kind} `, named(r), ` waits for its Switch on in “${r.madeName || "the chat that proposed it"}”.`], routineActions.openChat ? [btn("Open it", () => routineActions.openChat?.(r.madeIn))] : [], "quiet"));
    if (routineActions.viewOnly?.()) return only(line(glyphOf(r), [`${kind} `, named(r), " waits for its Switch on. ", VIEW_ONLY_WORDS], toSpace(r), "quiet"));
    if (mode !== "open" && folds.get().includes(foldKey(r)))
      return only(line(glyphOf(r), [`${kind} `, named(r), " waits for your Switch on."], [btn("Switch on…", () => { mode = "open"; paint(); }, "inst-btn")], "waits"), "is-folded");
    sheetIn(r, false);
  }

  paint();
  if (project && routineActions.watch) followWhileDrawn(el, (fn) => routineActions.watch?.(String(project), fn) || (() => {}), () => void read(), () => {
    if (cards.get(at)?.el === el) cards.delete(at);
    letGo();
  });
  void read();
  cards.set(at, { el, key });
  return el;
}
