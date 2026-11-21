// @ts-check
// What a press on a routine's row does, a watcher's too: the Routines page (routines.js) and the Watchers page
// (watchers.js) list different rows and do the same to each. Its writes, under `/space/:project/routines/:id`; its
// sheet — Switch on…, or What it does —, opened on the routine as the Space says it now, with the sheet's own reads
// under that path (what a watcher's program runs, a watcher's address); Run now, with its chat in a
// toast; Fix…, the Start with the failure in its box; Remove, behind its word; its ⋯; Put back. And Pause all's
// button, one switch for this Filament, which both heads show. What each press does is said in Filament's words, as
// the server gives them for what the row is (`words.press`): a routine at times runs, a watcher listens.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { confirmDialog, menu, toast } from "../lib/ui.js";
import { api } from "../lib/api.js";
import { PAUSE_ALL_HOLDS, PAUSE_ALL_MEANWHILE, routineAskWords, routineFixWords } from "../lib/space-view.js";
import { routineSheet } from "./routine-sheet.js";

/**
 * @typedef {import("./routine-sheet.js").RoutineRow} RoutineRow
 * @typedef {import("./routines.js").RoutinesCtx} RoutinesCtx
 */

/** What Fix… does, on a row's button and in its ⋯. */
export const FIX_DOES = "The Start in its folder, the failure in its box: nothing runs until you send";

/**
 * What a routine's sheet presses, wherever it stands — the Space's sheet, the card under the call that proposed it in a
 * chat: Switch on, of what the sheet shows (its `at`, and a script watcher's seal); the model it runs on; the sheet's
 * own reads under its path. `write`: a write under `/space/:project/routines/:id`, its answer, or null where it was
 * refused (the host says it); `stands`: the routine as its host knows it now; `moved`: Switch on refused because its
 * chat changed it since — the host draws the sheet again on `now`.
 * @param {RoutineRow} r
 * @param {{ write: (method: string, path: string, body?: any) => Promise<any>, stands: () => RoutineRow | undefined, moved: (now: RoutineRow) => void }} o
 * @returns {Required<Pick<import("./routine-sheet.js").SheetOpts, "switchOn" | "request" | "chooseModel">>}
 */
export function routineHands(r, { write, stands, moved }) {
  const under = `/space/${encodeURIComponent(r.project)}/routines/${encodeURIComponent(r.id)}`;
  return {
    // The press is of what the sheet shows: its chat's change since (`at`) refuses it, and the sheet is drawn again on
    // what the routine does now. A watcher that runs a program sends the seal its sheet read with it; refused, that
    // sheet reads what it runs again in place.
    switchOn: async (seal) => {
      if (await write("POST", "/on", { at: r.at, ...(seal ? { seal } : {}) })) return true;
      const now = stands();
      if (now && now.at !== r.at && now.state === "proposed") moved(now);
      return false;
    },
    // The sheet's own reads and its Make a new address…: a refusal is the sheet's to say in its place, in the server's
    // words, so none is a toast.
    request: async (method, path, body) => {
      try {
        return { ok: true, got: await api(`${under}${path}`, method === "GET" ? {} : { method, body }) };
      } catch (e) {
        return { ok: false, error: /** @type {any} */ (e)?.message || "It could not be read." };
      }
    },
    // The model it runs on and its effort, the person's pick (the owner's words of 10-31 and 11-04); "" its Space's.
    chooseModel: async (model, effort) => !!(await write("POST", "/model", { model, effort })),
  };
}

/**
 * @param {RoutinesCtx} ctx
 * @param {() => RoutineRow[]} rows  the routines as the Space says them now, the watchers among them
 */
export function routinePresses(ctx, rows) {
  /** @param {RoutineRow} r @param {string} path @param {any} [body] @param {string} [method] */
  const write = (r, path, body, method = "POST") => ctx.write(r.project, method, `/routines/${encodeURIComponent(r.id)}${path}`, body);

  /**
   * Switch on… or What it does: the sheet, of the routine as the Space says it now. A row is drawn again only where its
   * words moved, so the one it was drawn from may be older — its model, chosen since by the person or by its chat
   * proposing it again (found by the review of 10-31). `focus`: "address", a webhook watcher's address in sight.
   * @param {RoutineRow} drawnAs @param {boolean} readOnly @param {"address"} [focus]
   */
  function open(drawnAs, readOnly, focus) {
    const r = rows().find((x) => x.id === drawnAs.id && x.project === drawnAs.project) || drawnAs;
    const p = ctx.place(r.project);
    /** The routine as the Space says it at this moment. */
    const stands = () => rows().find((x) => x.id === r.id && x.project === r.project);
    // A refused Switch on is said in a toast, and the sheet opens again on what the routine does now — the Space was
    // read with the refusal.
    const hands = routineHands(r, {
      write: (method, path, body) => write(r, path, body, method),
      stands,
      moved: (now) => {
        s.close();
        open(now, false);
      },
    });
    const s = routineSheet({
      r,
      place: p?.name || "its project",
      readOnly,
      ...(focus ? { focus } : {}),
      ...hands,
      stands,
      ...(ctx.catalogue ? { catalogue: ctx.catalogue } : {}),
      ...(r.spaceOn ? { space: r.spaceOn } : {}),
      ...(ctx.modelName ? { nameOf: ctx.modelName } : {}),
      openChat: ctx.openChat,
      askChat: ctx.askChat,
    });
  }

  /** The chat a watcher wakes, where it wakes the one that proposed it, by its name; "" for any other routine. @param {RoutineRow} r */
  const wokenChat = (r) => (r.wakes === "chat" ? r.madeName || "the chat that proposed it" : "");

  /**
   * Run now, the press: its run's chat, with Open in the toast — for a watcher of the chat that proposed it, a turn in
   * that chat. @param {RoutineRow} r
   */
  async function runNow(r) {
    const got = await write(r, "/run", {});
    if (!got?.chain) return;
    const chain = String(got.chain);
    if (wokenChat(r)) toast(`“${r.title}” looks now, in a turn of its own in ${wokenChat(r)}`, "", { action: { label: "Open", title: "The chat it woke", onClick: () => ctx.openChat(chain) } });
    else toast(`“${r.title}” runs now, in a chat of its own`, "", { action: { label: "Open", title: "Its run's chat", onClick: () => ctx.openChat(chain) } });
  }

  /** Fix…: the Start in the project's folder, the failure in its box. @param {RoutineRow} r */
  function fix(r) {
    const p = ctx.place(r.project);
    if (p && ctx.startWith) ctx.startWith(p.cwd, routineFixWords({ title: r.title, why: r.words.why, ran: r.words.ran, watcher: !!r.trigger }, p.name));
  }

  /** Taken out, on your word: its way back is said. @param {RoutineRow} r */
  async function remove(r) {
    const ok = await confirmDialog({ title: `Remove “${r.title}”?`, description: r.words.press.removed, confirmLabel: "Remove", destructive: true });
    if (ok) await write(r, "", undefined, "DELETE");
  }

  /**
   * A row's ⋯. `pause`: with its Resume or Pause — a watcher's row has a switch for them; `fixes`: with Fix… where its
   * last run failed — a routine's row has the button.
   * @param {RoutineRow} r @param {HTMLElement} anchor @param {{ pause?: boolean, fixes?: boolean }} [o]
   */
  function more(r, anchor, { pause = true, fixes = false } = {}) {
    const says = r.words.press;
    const running = r.last?.state === "running";
    const on = r.state === "on";
    menu([
      ...(on
        ? [
            // A watcher that tells only you runs nothing: no Run now.
            ...(running
              ? [{ label: "Open its run", icon: "messageSquare", desc: "The chat it runs in now", onClick: () => r.last && ctx.openChat(r.last.chain) }]
              : r.wakes === "you"
                ? []
                : [{ label: "Run now", icon: "play", desc: says.run, onClick: () => void runNow(r) }]),
            ...(!pause
              ? []
              : [r.paused
                  ? { label: "Resume", icon: "play", desc: says.resume, onClick: () => void write(r, "/pause", { paused: false }) }
                  : { label: "Pause", icon: "pause", desc: says.pause, onClick: () => void write(r, "/pause", { paused: true }) }]),
            { label: "What it does", icon: "shieldCheck", desc: says.what, onClick: () => open(r, true) },
            // A watcher a program posts to: its sheet, the address in sight.
            ...(r.words.webhook ? [{ label: "Its address…", icon: "link", desc: "Where a program posts to wake it: yours to copy", onClick: () => open(r, true, "address") }] : []),
          ]
        : [{ label: "Switch on…", icon: "shieldCheck", desc: says.on, onClick: () => open(r, false) }]),
      ...(fixes && r.words.tone === "bad" && ctx.startWith ? [{ label: "Fix…", icon: "wrench", desc: FIX_DOES, onClick: () => fix(r) }] : []),
      ...(ctx.askChat ? [{ label: "Ask for a change…", icon: "messageCirclePlus", desc: `“${r.madeName || "Its chat"}”, which made it, its box begun`, onClick: () => ctx.askChat?.(r.madeIn, routineAskWords(r)) }] : []),
      ...(r.last?.chain && !running ? [{ label: "Open its last run", icon: "messageSquare", desc: r.words.last, onClick: () => r.last && ctx.openChat(r.last.chain) }] : []),
      { type: "separator" },
      { label: "Remove", icon: "trash2", variant: "destructive", desc: says.remove, onClick: () => void remove(r) },
    ], { anchor, side: "bottom", align: "end", width: 300 });
  }

  return {
    write,
    open,
    runNow,
    fix,
    more,
    /**
     * A routine's Switch on… sheet, opened from elsewhere — an agent's ask for it in Needs you (E42 SA-D7). One that is
     * not proposed opens its What it does. @param {string} project @param {string} id
     */
    switchOn(project, id) {
      const r = rows().find((x) => x.id === id && x.project === project);
      if (r) open(r, r.state !== "proposed");
    },
    /**
     * Add to this Space…'s lines for those removed, each its way back as it was (S6-D13): `mine`, the rows this page
     * lists. @param {string} project @param {(r: RoutineRow) => boolean} mine
     */
    backItems(project, mine) {
      return rows()
        .filter((r) => r.state === "removed" && r.project === project && mine(r))
        .map((r) => ({ label: `Put back “${r.title}”`, icon: "rotateCcw", desc: r.words.press.back, onClick: () => void write(r, "/back", {}) }));
    },
  };
}

/**
 * Pause all's button (S6-D4), on the Routines head and the Watchers head: one switch for this Filament (S6-D12) —
 * pressed in one Space, every Space pauses, and its confirm says so; Resume while it is on, which asks nothing first.
 * @param {Pick<RoutinesCtx, "all" | "pauseAll">} ctx @param {() => boolean} paused  whether Pause all is on now
 */
export function pauseAllButton(ctx, paused) {
  const el = h("button", { class: "sm srt-pause", type: "button" });
  el.addEventListener("click", async () => {
    const on = !paused();
    if (on) {
      const ok = await confirmDialog({
        title: "Pause every Space?",
        description: `Every Space of this Filament pauses${ctx.all ? "" : ", not this one alone"}: nothing starts by itself — ${PAUSE_ALL_HOLDS} — until you resume. A run under way goes on: its chat's Stop is there. ${PAUSE_ALL_MEANWHILE}`,
        confirmLabel: "Pause every Space",
      });
      if (!ok) return;
    }
    await ctx.pauseAll(on);
  });
  return {
    el,
    /** Its words as Pause all stands; `hidden`: nothing it would hold back, and nothing to resume. @param {boolean} hidden */
    paint(hidden) {
      const on = paused();
      el.replaceChildren(h("span", { class: "sp-btn-ic", html: on ? ICONS.play : ICONS.pause }), on ? "Resume" : "Pause every Space");
      el.title = on ? "Pause all goes off in every Space: what runs by itself goes on at its next times, nothing made up" : `Nothing starts by itself in any Space until you resume: ${PAUSE_ALL_HOLDS}`;
      el.hidden = hidden;
    },
  };
}
