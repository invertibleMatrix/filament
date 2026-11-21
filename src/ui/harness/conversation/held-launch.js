// @ts-check
// The card for sub-agents that change files (the owner's of 11-14): while Settings › Experimental › Parallelize tasks is
// off, a launch of one waits on it for the person's yes — "anytime the agent is suppose to spawn a sub agent that can
// edit files in parallel then it is suppose to show a card that asks for permission". It names each launch held, the
// model it runs on and where it would work, and counts down to the server's own answer: Accept, wherever each would
// work, where a model is known — else the work stays with the agent (the card says why). Accept starts them; Always
// accept in this chat starts them and switches Parallelize tasks on for that chat alone, so no card asks in it again
// (the owner's of 11-16); One at a time keeps the work with the agent for the rest of its turn. Its agent never waits on it: its call answered at once,
// and it hears the answer as a notice. Drawn from the transcript's read and the feed's `held` events, the newest word
// of either standing; once answered, one line says what happened.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { prettyModel } from "../lib/families.js";
import { attachedWords } from "../lib/agent-cards.js";
import { followWhileDrawn } from "../lib/follow-drawn.js";

/**
 * A launch on a card (app/agent/held-launch.js `HeldLaunch`): `kept`, its card's clock left it with the agent; `queued`,
 * accepted, it waits to start — a free slot, the chat's turn; `attached`, what the agent attached to it, by name.
 * @typedef {{ n: number, description: string, kind: string, model: string, where: "copy" | "folder" | "machine", machine?: string, attached?: { files: string[], pictures: string[] }, declines: string, agent?: string, kept?: boolean, queued?: boolean }} HeldLaunch
 */
/**
 * A card as the server says it (app/agent/held-launch.js `HoldView`): `left`, how long it had to go as it was said.
 * @typedef {{ id: string, chainId: string, at: number, until: number, left: number, turn: number | null, onTimeout: "accept" | "decline" | "some",
 *   why: string, launches: HeldLaunch[], state: "waiting" | "accepted" | "declined", by: "person" | "timeout" | "stop" | null,
 *   answeredAt: number | null, started: string[], failed: string[], paused?: boolean, always?: boolean }} HoldView
 * `always`: the person's Accept was Always accept in this chat — no card asks in it from then (the owner's of 11-16).
 */
/** The card's row between turns, as the transcript's read carries it. @typedef {HoldView & { type: "held", afterTurn: number }} HeldMark */

/**
 * What a card reads and does — the app's; null on a page that offers none (a test, a card drawn alone).
 * `view`: the card as the page last heard it, with when it heard it (`heard`, the page's clock), or null;
 * `watch`: a card heard again; `answer`: the route; `said`: a toast; `refresh`: the chat's cards read again from the
 * server, one it no longer has standing answered.
 * @type {{ view: ((chainId: string, id: string) => { hold: HoldView, heard: number } | null) | null, watch: ((fn: () => void) => () => void) | null,
 *   answer: ((chainId: string, id: string, said: "accept" | "decline" | "always") => Promise<any>) | null, said: ((words: string) => void) | null,
 *   refresh?: ((chainId: string) => Promise<void>) | null }}
 */
export const heldActions = { view: null, watch: null, answer: null, said: null, refresh: null };

/** How long past its deadline a card the page heard no answer of is read again from the server, and again after. */
const LATE_MS = 5_000;

/**
 * The cards of a chat the page holds waiting that its read, asked at `asked`, no longer has (`has`, the ids the server
 * answered with) — a restart forgot them, their turn with them —: each standing answered, nothing started, as of `at`.
 * One heard since the read was asked is newer than its answer, and stands.
 * @param {Map<string, { hold: HoldView, heard: number }>} heard @param {string} chainId @param {ReadonlySet<string>} has
 * @param {number} asked @param {number} at @returns {[string, { hold: HoldView, heard: number }][]} the keys and words to keep
 */
export const heldGone = (heard, chainId, has, asked, at) =>
  [...heard]
    .filter(([, was]) => was.hold.chainId === chainId && was.hold.state === "waiting" && !has.has(was.hold.id) && was.heard < asked)
    .map(([key, was]) => [key, { hold: { ...was.hold, state: "declined", by: "stop", left: 0, paused: false, answeredAt: at }, heard: at }]);

/** A count of launches in words, as the head says it. @param {number} n */
const count = (n) => (n === 2 ? "two" : n === 3 ? "three" : String(n));

/** The card's head. @param {HoldView} v */
export const heldTitle = (v) =>
  v.launches.length > 1 ? `Your agent asks to run ${count(v.launches.length)} sub-agents in parallel` : "Your agent asks to hand this to a sub-agent";

/** Where a launch would work, in words. @param {HeldLaunch} l */
export const heldWhereWords = (l) =>
  l.where === "copy" ? "in its own copy of the folder" : l.where === "machine" ? `on ${l.machine || "another machine"}` : "in your folder itself";

/** A launch's line under its name. @param {HeldLaunch} l */
export const heldLaunchSub = (l) => [l.model ? `on ${prettyModel(l.model)}` : "no model named", heldWhereWords(l), attachedWords(l.attached), l.agent ? `started as ${l.agent}` : l.kept ? "stayed with your agent" : l.queued ? "waits to start" : ""].filter(Boolean).join(" · ");

/** Whether every launch of the card works in a copy of its own, so nothing reaches the person's folder unapplied. @param {HoldView} v */
const allInCopies = (v) => v.launches.every((l) => l.where === "copy");

/** Seconds as m:ss. @param {number} ms */
export const clockWords = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * What a waiting card says of its clock, `ms` left. @param {HoldView} v @param {number} ms
 */
export function heldClockWords(v, ms) {
  // Its turn waits on you: no clock runs until it goes on.
  if (v.paused) return "Waits for your answer: your agent waits on you meanwhile, and the 60 seconds start again as it goes on.";
  if (ms <= 0) return v.onTimeout === "accept" ? `Starting ${v.launches.length > 1 ? "them" : "it"}…` : v.onTimeout === "some" ? "Starting those with a model…" : "Keeping the work with your agent…";
  const many = v.launches.length > 1;
  if (v.onTimeout === "accept")
    return `${many ? "They start by themselves" : "It starts by itself"} in ${clockWords(ms)}${
      allInCopies(v) ? `: ${many ? "each works" : "it works"} in its own copy, and nothing reaches your folder until it is applied.` : `, ${many ? "each where its line says" : "where its line says"}.`
    }`;
  if (v.onTimeout === "some") return `With no answer in ${clockWords(ms)}, those with a model start by themselves, and the rest stay with your agent: ${v.why}.`;
  return `With no answer in ${clockWords(ms)}, the work stays with your agent: ${v.why}.`;
}

/**
 * The card as it stands: the page's newest word of it, else its mark — an answered card is never taken back to waiting.
 * @param {HeldMark | HoldView} m @param {string} chainId @returns {{ hold: HoldView, heard: number } | null} null: the mark's word stands
 */
const heardOf = (m, chainId) => {
  const heard = heldActions.view?.(chainId, m.id);
  return heard && (heard.hold.state !== "waiting" || m.state === "waiting") ? heard : null;
};

/** Whether the card was answered, by the page's newest word of it. @param {HeldMark | HoldView} m @param {string} chainId */
export const heldAnswered = (m, chainId) => (heardOf(m, chainId)?.hold || m).state !== "waiting";

/**
 * The round a card was asked in: the newest of the run's rounds with a call begun by the card's `at` — the call that
 * asked, or the one running when a graph's task waited on it. Null where no call carries a time.
 * @param {ReadonlyMap<number, { tools?: Map<string, { at?: number }> }>} byRound  the aligned run's rounds @param {number} at
 * @returns {number | null}
 */
export function heldRound(byRound, at) {
  /** @type {number | null} */
  let found = null;
  for (const [r, c] of byRound) {
    if (found != null && r <= found) continue;
    for (const t of c.tools?.values() || []) if (Number(t.at) > 0 && Number(t.at) <= at) { found = r; break; }
  }
  return found;
}

/** What a card answered Always accept in this chat says besides. */
export const ALWAYS_LINE = "From now on in this chat, sub-agents start without this card; the gear on its Agents tab turns that off.";

/** What an answered card says. @param {HoldView} v */
export function heldAnsweredWords(v) {
  const all = v.launches.length;
  const failed = v.failed.length ? ` Not started: ${v.failed.join("; ")}.` : "";
  if (v.state === "accepted") {
    const ran = v.started.length;
    const kept = v.launches.filter((l) => l.kept).length;
    const stayed = kept ? ` ${kept === 1 ? "One" : `${count(kept)[0].toUpperCase()}${count(kept).slice(1)}`} stayed with your agent: ${v.why}.` : "";
    const queued = v.launches.filter((l) => l.queued).length;
    // Accepted for this chat from now on: said once, under what it started.
    const always = v.always ? ` ${ALWAYS_LINE}` : "";
    const accepted = v.always ? "Always accepted in this chat" : "Accepted";
    // Accepted, a graph's task that cannot start yet starts once a slot is free and the chat's turn runs: none started
    // yet, or some.
    if (!ran && queued) return `${v.by === "timeout" ? "No answer in time" : accepted}: ${queued === all ? (all === 1 ? "it starts" : "they start") : `${queued} of ${all} start`} once a slot is free and your agent's turn runs, ${queued === 1 ? "its report coming" : "each report coming"} to your agent.${failed}${stayed}${always}`;
    const how = v.by === "timeout" ? "No answer in time, so Filament started" : `${accepted}: started`;
    const waits = queued ? ` ${queued === 1 ? "One more starts" : `${queued} more start`} once a slot is free.` : "";
    return `${how} ${ran === all ? (all === 1 ? "it" : all === 2 ? "both" : `all ${count(all)}`) : `${ran} of ${all}`}; ${ran === 1 ? "its report comes" : "each report comes"} to your agent.${waits}${failed}${stayed}${always}`;
  }
  if (v.by === "stop") return "The turn ended before an answer: nothing started.";
  if (v.by === "timeout") return `No answer in time, and ${v.why}: the work stayed with your agent.`;
  return "One at a time: your agent does the work itself, and starts no sub-agent that changes files for the rest of this turn.";
}

/**
 * The card's row: drawn from the mark, painted again as the page hears it, its clock moving each second while it waits
 * and is in the document. A press answers it once: an answer from elsewhere (another tab, its own clock) stands.
 * @param {HeldMark} m @param {string} chainId
 * @returns {HTMLElement}
 */
export function heldLaunchRow(m, chainId) {
  const body = h("div", { class: "so-body" });
  const card = h("div", { class: "tool-note so-card hl-card", "data-held": m.id }, body);
  const row = h("div", { class: "boundary-row is-subagent is-side is-held" }, card);
  const drawnAt = Date.now();
  /**
   * `clock`: the line the tick moves, alone — the presses stay as they are, a focus on one kept; `seen`: the row was in
   * the document once.
   * `sig`: what it was drawn from last. `asked`: when its chat's cards were last read again for it (the page's clock).
   * @type {{ busy: boolean, said: string, gone: boolean, seen: boolean, tick: ReturnType<typeof setInterval> | null, clock: HTMLElement | null, sig: string, asked: number }}
   */
  const st = { busy: false, said: "", gone: false, seen: false, tick: null, clock: null, sig: "", asked: 0 };
  /** The card as it stands, and when it was said, by the page's clock. */
  const now = () => heardOf(m, chainId) || { hold: /** @type {HoldView} */ (m), heard: drawnAt };
  const stopTick = () => {
    if (st.tick) clearInterval(st.tick);
    st.tick = null;
  };
  /** How long the card has to go, by the page's clock. @param {HoldView} v @param {number} heard */
  const left = (v, heard) => (Number(v.left) || 0) - (Date.now() - heard);
  const paint = () => {
    const { hold: v, heard } = now();
    // Drawn as it stands already — another card's word heard, say —: nothing is drawn again, a focus on a press kept.
    const sig = JSON.stringify([{ ...v, left: 0, until: 0 }, st.busy, st.said]);
    if (sig === st.sig) return;
    st.sig = sig;
    const waiting = v.state === "waiting";
    const may = waiting && !st.busy && !!heldActions.answer;
    row.classList.toggle("is-answered", !waiting);
    // Answered, it is one line (the owner's of 11-16: the cards "stuck at the end of the chat pushing the work above"):
    // what it held, each started one's id, and what happened — it stands where its agent asked (timeline.js `placeCards`).
    if (!waiting) {
      body.replaceChildren(
        h("span", { class: "so-ic", "aria-hidden": "true", html: ICONS.layers }),
        h("p", { class: "so-line hl-done" },
          h("span", { class: "hl-names", title: v.launches.map((l) => `${l.description}: ${heldLaunchSub(l)}`).join("\n") },
            v.launches.map((l) => (l.agent ? `${l.description} (${l.agent})` : l.description)).join(" · ")),
          " — ", heldAnsweredWords(v)),
        ...(st.said ? [h("p", { class: "so-line is-warn" }, st.said)] : []),
      );
      st.clock = null;
      return void stopTick();
    }
    // Its clock keeps work from a sub-agent, or starts one in the folder itself: said in the warning tone.
    st.clock = h("p", { class: `so-line hl-clock${v.onTimeout !== "accept" || !allInCopies(v) ? " is-warn" : ""}`, role: "timer" }, heldClockWords(v, left(v, heard)));
    body.replaceChildren(
      h("span", { class: "so-ic", "aria-hidden": "true", html: ICONS.layers }),
      h("div", { class: "so-main" },
        h("div", { class: "so-head" }, h("strong", {}, heldTitle(v))),
        h("ul", { class: "so-list", "aria-label": "The sub-agents" },
          ...v.launches.map((l) => h("li", { class: "so-task" },
            h("span", { class: "so-name", title: l.description }, l.description),
            h("span", { class: "so-sub" }, heldLaunchSub(l))))),
        st.clock,
        st.said ? h("p", { class: "so-line is-warn" }, st.said) : null,
        h("div", { class: "so-acts" },
          h("button", { class: "inst-btn is-primary", type: "button", ...(may ? {} : { disabled: "" }), title: "Each starts as a sub-agent; its report comes to your agent", onclick: () => void answer("accept") }, st.busy ? "Answering…" : "Accept"),
          h("button", { class: "inst-btn", type: "button", ...(may ? {} : { disabled: "" }), title: "Accept, and Parallelize tasks is on for this chat from now on: sub-agents start without this card. The gear on its Agents tab turns that off.", onclick: () => void answer("always") }, "Always accept in this chat"),
          h("button", { class: "inst-btn", type: "button", ...(may ? {} : { disabled: "" }), title: "Nothing starts: your agent does the work itself, in order", onclick: () => void answer("decline") }, v.launches.length > 1 ? "One at a time" : "Keep it with the agent"))),
    );
    if (st.gone) stopTick();
    else if (!st.tick) st.tick = setInterval(tick, 1000);
  };
  /**
   * Each second while it waits: its clock line moves; an answer heard meanwhile draws the card again. Its deadline
   * passed by `LATE_MS` with no word — the feed missed it, or Filament restarted and forgot the card —, the chat's
   * cards are read again, every `LATE_MS` at most.
   */
  const tick = () => {
    if (!row.isConnected) return void ((st.seen || st.gone) && stopTick());
    st.seen = true;
    const { hold: v, heard } = now();
    if (v.state !== "waiting" || !st.clock) return paint();
    const ms = left(v, heard);
    st.clock.textContent = heldClockWords(v, ms);
    if (!v.paused && ms <= -LATE_MS && Date.now() - st.asked >= LATE_MS && heldActions.refresh) {
      st.asked = Date.now();
      void heldActions.refresh(chainId).catch(() => {});
    }
  };
  /** @param {"accept" | "decline" | "always"} said */
  const answer = async (said) => {
    if (st.busy || !heldActions.answer || now().hold.state !== "waiting") return;
    st.busy = true;
    st.said = "";
    paint();
    try {
      await heldActions.answer(chainId, m.id, said);
    } catch (/** @type {any} */ e) {
      // Answered already — in another tab, or by its own clock as the press went —: the card says what stands as the
      // page hears it, and the refusal once.
      // The server's word is read again: one it no longer has stands answered.
      if (e?.status === 409) {
        heldActions.said?.(String(e?.body?.error || e?.message || e));
        void heldActions.refresh?.(chainId)?.catch(() => {});
      } else st.said = `Not answered: ${String(e?.message || e)}`;
    } finally {
      st.busy = false;
      paint();
    }
  };
  paint();
  if (heldActions.watch)
    followWhileDrawn(row, heldActions.watch, paint, () => {
      st.gone = true;
      stopTick();
    });
  return row;
}
