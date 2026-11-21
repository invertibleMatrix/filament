// @ts-check
// The queue panel (AgentPlanUX §5.5.3, `ConversationQueuePanel.tsx`): messages typed while a run is live, drained
// in order when it ends — one per run end, each run's end sending the next. A stop or an error pauses the drain,
// and so does a send the page refuses, said in the send's own words; **Continue** resumes it. Rows can be reordered by
// their grip, steered now, edited back into the composer, or removed.
// Each chat keeps its own queue (`queueState`), and the panel draws the shown chat's, which the composer drains. A chat
// not shown sends its own next message when its own turn — this page's — ends done (`awayNext`, the page's
// `drainElsewhere`; the owner's of 10-30: a message queued in a chat whose turn ended while they were in another
// waited there for Continue); a turn that went on elsewhere — another tab's, a wake — leaves its queue paused for
// Continue, and opening a chat never sends.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { button } from "../lib/ui.js";
import { overruleMark } from "./overrule-line.js";

/**
 * A message typed with files while a turn ran (the worktree plan's Phase 3 item 3): it waits whole, since a steer
 * carries words only. A message of words alone is its text. `overrules`: whose answers it overrules (HarnessV4_Tasks
 * E15 step 3) — they go with it whenever it goes. `sendAsIs`, `carry`: what a card answered for a message it stopped
 * (app.js `sendAsked`) — past the card's question, and the form a switch's session carries the turns in —, and
 * `modeSwitch`, a permission switch's words answering a waiting call (a message that waited on its row, app.js
 * `armWaiting`), and `allow`, the press of Allow (true) or Deny (false) on a waiting call's card, go with it too.
 * `via`: the row of the ⌄ menu it was sent by while a turn ran, and how (`SendVia`) — the turn it starts says it.
 * @typedef {{ text: string, files: any[], overrules?: import("./overrule-line.js").Overruling[], sendAsIs?: boolean, carry?: string, modeSwitch?: boolean, allow?: boolean, via?: SendVia }} QueuedMessage
 */

/**
 * The way a message went while a turn ran (the owner's of 11-09): the row of the ⌄ menu — `next-step`, `interrupt`,
 * `stop-and-send`, `when-done`, `veto`, `aside` —, the queue panel's own send on a row (`queue-next-step`), or a note
 * the turn ended before reading, which Filament sends again as the next message (`unread-note`); and whether the person
 * pressed a key (the send key, the veto key), clicked (the button, the row), or pressed nothing for this send (`auto`:
 * the unread note, whose first send said its own). The steer says it to the run, which keeps it on its `steer` event;
 * the turn a queued or stopped-and-sent message starts says it in its request's head (api.js `postTurn`).
 * @typedef {{ row: string, by: "key" | "click" | "auto" }} SendVia
 */

/**
 * One chat's queue: its messages; whether the drain waits, and why — said under the head, so a paused queue never
 * reads as stuck (the UI/UX review, 2026-09-30); what the send said where it refused the next message (`said`:
 * HarnessV4_Tasks U4) and whether Continue can send that message as it is (`again`: false where the send refused the
 * message itself — what it says, what it answers — which only an edit or a removal lifts); a Stop and send whose stop is on
 * its way; and how the chat's last turn ended as the send saw it, which its record may correct (`turnSettled`).
 * @typedef {{ items: (string | QueuedMessage)[], paused: boolean, why: "stopped" | "error" | "away" | "refused" | "reloaded" | null, said: string, again: boolean, now: boolean, ended: string }} QueueState
 */

/** @returns {QueueState} */
export const queueState = () => ({ items: [], paused: false, why: null, said: "", again: true, now: false, ended: "done" });

/** What a paused queue says under its head. */
const WHY = {
  stopped: "Paused — the last turn was stopped. Continue sends the next message.",
  error: "Paused — the last turn failed. Continue sends the next message.",
  away: "Paused — you were in another chat. Continue sends the next message.",
  reloaded: "Paused — the page loaded afresh. Continue sends the next message.",
};

/**
 * A paused queue's line. A send that refused is said in its own words where it gave any: its toast has passed by the
 * time the queue is read. Continue is offered as a try again only where it could send the message as it is: a refusal
 * of the message itself says in its own words what to do instead. @param {QueueState} st
 */
const whyWords = (st) => {
  if (st.why !== "refused") return WHY[st.why || "stopped"];
  const said = String(st.said || "").trim().replace(/\.$/, "");
  return `Paused — the next message was not sent${said ? `: ${said}` : ""}.${st.again === false ? "" : " Continue tries again."}`;
};

/**
 * A turn of the queue's chat ended, as the send saw it: true when the next message goes now. The message Stop and send put
 * first goes, whatever ended the turn; a stop or an error pauses the drain until Continue. A message that waits for the
 * chat on its row (app.js `armWaiting`) ended no turn: the chat is held still, and the queue waits behind it for the
 * end of the turn that message starts. Pure.
 * @param {QueueState} st @param {"done" | "stopped" | "error" | "paused" | "waiting"} endedBy
 */
export function turnEnded(st, endedBy) {
  if (endedBy === "waiting") return false;
  st.ended = endedBy;
  if (st.now) {
    st.now = false;
    st.paused = false;
    st.why = null;
    st.said = "";
    return true;
  }
  if (endedBy !== "stopped" && endedBy !== "error") return true;
  if (st.items.length) {
    st.paused = true;
    st.why = endedBy;
  }
  return false;
}

/**
 * The turn's record settled how it ended (BUG-07's reconciliation): a stop the loop never read — the turn had finished
 * first — makes a done turn, so the queue that stop paused goes on; a paused queue beside a footer that says the turn
 * finished read as a contradiction (the UI/UX review, 2026-09-30). True when the next message goes now. Pure.
 * @param {QueueState} st @param {string} status
 */
export function turnSettled(st, status) {
  if (st.ended !== "stopped" || status !== "done") return false;
  st.ended = "done";
  if (!st.paused || st.why !== "stopped") return false;
  st.paused = false;
  st.why = null;
  return true;
}

/**
 * The chat is opened with no turn of its own running: what its queue still holds waited for a turn that went on while
 * another chat was shown. It waits, paused, for Continue, and a Stop and send's stop has landed. Pure.
 * @param {QueueState} st
 */
export function openedIdle(st) {
  st.now = false;
  if (!st.items.length || st.paused) return;
  st.paused = true;
  st.why = "away";
}

/**
 * Messages kept while the page loaded afresh (kept-queue.js; HarnessV4_Tasks U4) come back first, in order, and wait,
 * paused, for Continue: a page that loads afresh never sends by itself, whatever turn it finds running. True when any
 * came back. Pure.
 * @param {QueueState} st @param {(string | QueuedMessage)[]} items
 */
export function queueRestored(st, items) {
  const back = items.filter((it) => queuedText(it).trim() || queuedFiles(it).length);
  if (!back.length) return false;
  st.items.unshift(...back);
  st.paused = true;
  st.why = "reloaded";
  st.said = "";
  return true;
}

/**
 * Messages for after the running turn, in order; a blank one is no message. Pure.
 * @param {QueueState} st @param {(string | QueuedMessage)[]} items
 */
export function queueAdd(st, items) {
  for (const it of items) {
    if (!queuedText(it).trim() && !queuedFiles(it).length) continue;
    const whole = queuedFiles(it).length || queuedOverrules(it).length || Object.keys(queuedAnswer(it)).length || Object.keys(queuedVia(it)).length;
    st.items.push(typeof it === "string" || whole ? it : queuedText(it));
  }
}

/**
 * Notes a turn ended before its agent read them (app.js `agentUnheard`): its next messages, whatever ended the turn, as
 * the one Stop and send put first goes — sent into the turn, they are not the queue's that a stop pauses (the hunt of
 * 11-09: they waited for Continue while the toast said they went) —, ahead of what waits for the turn's end and behind
 * Stop and send's. `ended`: the turn has ended already, its run having said so after its end: true when the first goes
 * now, the pause lifted as that end's would have been. Pure.
 * @param {QueueState} st @param {(string | QueuedMessage)[]} items @param {boolean} ended
 */
export function queueUnheard(st, items, ended) {
  const notes = items.filter((it) => queuedText(it).trim() || queuedFiles(it).length);
  if (!notes.length) return false;
  st.items.splice(st.now ? 1 : 0, 0, ...notes);
  if (!ended) {
    st.now = true;
    return false;
  }
  st.paused = false;
  st.why = null;
  st.said = "";
  return true;
}

/**
 * The next message of a chat not shown, its own turn ended done (the owner's of 10-30): taken out, one per turn end;
 * null where its queue is empty or a pause holds it. Pure.
 * @param {QueueState} st @returns {string | QueuedMessage | null}
 */
export function awayNext(st) {
  if (st.paused || !st.items.length) return null;
  return st.items.shift() ?? null;
}

/**
 * A message `awayNext` took that its send did not: back first — for the end of a turn that runs after all, or, with
 * `said`, paused in the send's own words, as the panel's `refused` does (`again`: whether Continue can send it as it
 * is). Pure.
 * @param {QueueState} st @param {string | QueuedMessage} it @param {string | null} [said] @param {boolean} [again]
 */
export function awayBack(st, it, said = null, again = true) {
  st.items.unshift(it);
  if (said == null) return;
  st.paused = true;
  st.why = "refused";
  st.said = String(said);
  st.again = again;
}

/** A queued message's words. @param {string | QueuedMessage} it */
export const queuedText = (it) => (typeof it === "string" ? it : String(it?.text || ""));
/** A queued message's files: none for words alone. @param {string | QueuedMessage} it */
export const queuedFiles = (it) => (typeof it === "string" ? [] : Array.isArray(it?.files) ? it.files : []);
/** Whose answers a queued message overrules: nobody's, for most. @param {string | QueuedMessage} it @returns {import("./overrule-line.js").Overruling[]} */
export const queuedOverrules = (it) => (typeof it === "string" || !Array.isArray(it?.overrules) ? [] : it.overrules);
/**
 * What a queued message answers, as its send takes it — a card's question (`sendAsIs`, a switch's `carry`), a waiting
 * call's permission switch (`modeSwitch`) or its card's press (`allow`): nothing, for most. Read from a message, a
 * waiting row's options, or what a reload kept.
 * @param {string | Record<string, any>} it @returns {{ sendAsIs?: true, carry?: string, modeSwitch?: true, allow?: boolean }}
 */
export const queuedAnswer = (it) =>
  typeof it === "string" ? {} : {
    ...(it?.sendAsIs === true ? { sendAsIs: true } : {}),
    ...(typeof it?.carry === "string" && it.carry ? { carry: it.carry } : {}),
    ...(it?.modeSwitch === true ? { modeSwitch: true } : {}),
    ...(typeof it?.allow === "boolean" ? { allow: it.allow } : {}),
  };
/**
 * The row a queued message was sent by, as its send takes it — read from a message, or what a reload kept: none for a
 * message typed between turns, nor for words Filament queued of its own. @param {string | Record<string, any>} it
 * @returns {{ via?: SendVia }}
 */
export const queuedVia = (it) =>
  typeof it !== "string" && typeof it?.via?.row === "string" && (it.via.by === "key" || it.via.by === "click" || it.via.by === "auto") ? { via: { row: it.via.row, by: it.via.by } } : {};

/**
 * The panel: it draws the queue it is shown (`bind`), and every change below is that queue's.
 * @param {{ onSteer: (it: string | QueuedMessage) => void, onEdit: (it: string | QueuedMessage) => void, onContinue: () => void }} cb
 */
export function createQueue(cb) {
  let st = queueState();
  /** @type {number | null} */
  let dragFrom = null;
  /** Whether the running turn takes a steer: a coding agent's only where its run says so (HarnessV3-ACP AC3-1). */
  let steerOk = true;
  /** Whether a turn runs: a row's send goes at its next step then, and as a message of its own between turns. */
  let running = false;
  const el = h("div", { class: "queue hidden" });

  const draw = () => {
    const items = st.items;
    el.classList.toggle("hidden", !items.length);
    el.replaceChildren(
      h("div", { class: "queue-head" },
        h("span", {}, `Queued messages (${items.length})`),
        st.paused ? button({ variant: "secondary", size: "xs", label: "Continue", title: "Resume sending the queue", onClick: () => { st.paused = false; st.why = null; st.said = ""; draw(); cb.onContinue(); } }) : null),
      ...(st.paused ? [h("div", { class: "queue-why muted small" }, whyWords(st))] : []),
      ...items.map((it, i) => {
        const text = queuedText(it);
        const files = queuedFiles(it).length;
        const over = queuedOverrules(it);
        const row = h("div", { class: "queue-row", draggable: "true" },
          h("span", { class: "queue-grip", html: ICONS.gripVertical, title: "Drag to reorder" }),
          h("span", { class: "queue-text" }, text || "(attachments)"),
          files ? h("span", { class: "queue-files muted small" }, `${files} file${files === 1 ? "" : "s"}`) : null,
          over.length ? h("span", { class: "queue-overrules small" }, overruleMark(over)) : null,
          // A steer carries words only: a message with files waits for the turn's end. While a turn runs the row's send
          // is the ⌄ menu's Send at its next step, by its name (the owner's of 11-09).
          steerOk && !files ? h("button", { class: "ghost icon", type: "button", title: running ? "Send at its next step" : "Send", "aria-label": running ? "Send at its next step" : "Send", html: ICONS.arrowUpFromLine, onclick: () => { items.splice(i, 1); draw(); cb.onSteer(it); } }) : null,
          h("button", { class: "ghost icon", type: "button", title: "Edit", "aria-label": "Edit", html: ICONS.pencil, onclick: () => { items.splice(i, 1); draw(); cb.onEdit(it); } }),
          h("button", { class: "ghost icon", type: "button", title: "Remove", "aria-label": "Remove", html: ICONS.trash2, onclick: () => { items.splice(i, 1); draw(); } }));
        row.addEventListener("dragstart", () => { dragFrom = i; row.classList.add("dragging"); });
        row.addEventListener("dragend", () => { dragFrom = null; row.classList.remove("dragging"); });
        row.addEventListener("dragover", (e) => { e.preventDefault(); });
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          if (dragFrom == null || dragFrom === i) return;
          const [moved] = items.splice(dragFrom, 1);
          items.splice(i, 0, moved);
          dragFrom = null;
          draw();
        });
        return row;
      }));
  };

  return {
    el,
    /** Show a chat's queue (HarnessV3-Views V3). @param {QueueState} next */
    bind(next) { st = next; dragFrom = null; draw(); },
    /** Whether a row may steer the running turn: where a coding agent's takes no words mid-turn, its rows only wait.
     *  `live`: whether a turn runs, which the row's send is named by. @param {boolean} on @param {boolean} [live] */
    steers(on, live = false) { if (steerOk === on && running === live) return; steerOk = on; running = live; draw(); },
    /** @param {string | QueuedMessage} it */
    push(it) { st.items.push(it); draw(); },
    /** @param {(string | QueuedMessage)[]} list */
    add(list) { queueAdd(st, list); draw(); },
    /** Stop and send: the message goes first, the moment the turn its stop ends is over.
     *  @param {string | QueuedMessage} it */
    sendNow(it) { st.items.unshift(it); st.now = true; draw(); },
    /** Notes the turn ended before reading them (`queueUnheard`): true when the first goes now.
     *  @param {(string | QueuedMessage)[]} list @param {boolean} ended */
    unheard(list, ended) { const go = queueUnheard(st, list, ended); draw(); return go; },
    /** Take the oldest message, leaving the rest for the next run's end. @returns {string | QueuedMessage} */
    shift() { const first = st.items.shift(); draw(); return first || ""; },
    /** A message taken out that a running turn could not take goes back first, for that turn's end.
     *  @param {string | QueuedMessage} it */
    putBack(it) { st.items.unshift(it); draw(); },
    /** A message the drain took that the send refused (HarnessV4_Tasks U4): back first, and the queue waits, paused,
     *  saying why — no turn runs whose end would send it. `again`: whether Continue can send it as it is.
     *  @param {string | QueuedMessage} it @param {string} said @param {boolean} [again] */
    refused(it, said, again = true) { awayBack(st, it, String(said || ""), again); draw(); },
    size: () => st.items.length,
    paused: () => st.paused,
    /** @param {"done" | "stopped" | "error" | "paused" | "waiting"} endedBy */
    ended(endedBy) { const go = turnEnded(st, endedBy); draw(); return go; },
    /** @param {string} status */
    settled(status) { const go = turnSettled(st, status); draw(); return go; },
  };
}
