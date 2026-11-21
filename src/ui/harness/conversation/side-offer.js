// @ts-check
// The side-by-side card (Phase 5): after the turn in which your agent suggested them (the owner's of 11-10: the agent
// puts it, never Filament by itself), its ready tasks that can run at once: each by name with the files it writes and where it works (its own copy where it
// writes and the chat's editing sub-agents work in copies, else your folder), and the model they run on, the chat's
// own — where the chat names none, it says so and Accept is off. Accept reads the chat's room afresh and starts them
// now, mid-turn too, through the graph's side-run route — each a sub-agent whose result comes to your agent as a
// report, and your agent applies it —; Ignore clears the card, and its tasks stay your agent's. The card is the graph's, kept with the
// session: a reload draws it again, and one answered — here, in another tab, or by the agent starting a task itself —
// leaves as the graph the page holds says. The agent waits on no card, and the card says so; an Accept names its card,
// so one pressed after it stood no more starts nothing and leaves. Where the folder's newest copy was slow to check out,
// one line says so. Unanswered, it answers itself 60 seconds after it was put (the plan of 11-14), on the server: the
// card counts down to the server's deadline, second by second while it is drawn, and says what comes then — its tasks
// start by themselves, or they stay with your agent, and why.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { prettyModel } from "../lib/families.js";
import { roomWords, sideStartedWords, writesWords } from "../views/side-run-sheet.js";
import { CARD_LIFE_WORDS, NO_MODEL_WORDS, acceptBody, sideFolderOf, sideFolderWords, slowCheckoutWords } from "../lib/side-offer.js";
import { followWhileDrawn } from "../lib/follow-drawn.js";

/**
 * A card's row between turns, as the transcript's read carries it and the page places it. `until`: when the server
 * answers it by itself, and `onTimeout` how — `why` it keeps the tasks your agent's —; missing on a card that waits for
 * your press alone.
 * @typedef {{ type: "side", at: number, afterTurn: number, turn?: number, ids: string[], tasks: { id: string, name: string, writes: string[] }[], until?: number, onTimeout?: "accept" | "decline", why?: string }} SideMark
 */
/**
 * The side-run route's GET; `now` its server's clock, and `skew` how far that runs ahead of this page's, as the read came.
 * @typedef {{ max: number, running: number, turn: boolean, repo: boolean, worktree: boolean, checkoutMs: number | null, now?: number, skew?: number }} SideFacts
 */

/**
 * What a card reads and does — the app's; null on a page that offers none (a test, a card drawn alone).
 * `offer`: the card the chat's graph holds now, as the page last heard it — `known` false while the page has heard no
 * graph since its read, when the read's own word stands; `watch`: the graph heard again; `model`: the chat's own;
 * `facts`: the side-run route's GET; `accept`, `ignore`: the routes; `said`: a toast.
 * @type {{ offer: ((chainId: string) => { known: boolean, at: number | null }) | null, watch: ((fn: () => void) => () => void) | null,
 *   model: ((chainId: string) => string) | null, facts: ((chainId: string) => Promise<SideFacts>) | null,
 *   accept: ((chainId: string, body: ReturnType<typeof acceptBody>) => Promise<any>) | null, ignore: ((chainId: string, at: number) => Promise<any>) | null,
 *   said: ((words: string) => void) | null }}
 */
export const sideActions = { offer: null, watch: null, model: null, facts: null, accept: null, ignore: null, said: null };

/**
 * How long a card's read of the chat's room stands for a card drawn again, to paint what it says: Accept reads it
 * afresh, whatever this holds.
 */
const FACTS_MS = 15_000;
/** The least time between two reads of the chat's room a card makes as the page hears the chat's graph again. */
export const REFRESH_MS = 2_000;
/** The room's reads, by card. @type {Map<string, { at: number, p: Promise<SideFacts> }>} */
const factsRead = new Map();

/**
 * How long past its deadline a card that still stands says "now": the server answers it at the deadline, and the graph
 * heard takes it away; one still here after this the server let wait — Parallelize tasks switched on, the person's
 * consent — and it waits for your press, its clock gone.
 */
export const CLOCK_GRACE_MS = 10_000;

/** A time left as the card's clock says it: minutes and seconds, a second begun counted whole ("0:42", "1:00"). @param {number} ms */
const clockWords = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * What the card says of its own answer, `left` ms before the server's deadline (the plan of 11-14): its tasks start by
 * themselves, or they stay with your agent, and why — "now" once the deadline is reached, until the graph the page
 * hears says what came of it. "" for a card that waits for your press alone.
 * @param {Pick<SideMark, "until" | "onTimeout" | "why">} m @param {number} left
 */
export function sideClockWords(m, left) {
  if (typeof m.until !== "number" || (m.onTimeout !== "accept" && m.onTimeout !== "decline")) return "";
  const when = left > 0 ? `in ${clockWords(left)}` : "now";
  return m.onTimeout === "accept" ? `Starts by itself ${when}.` : `Stays with your agent ${when}${m.why ? `: ${m.why}` : ""}.`;
}

/**
 * Whether the graph the page holds still offers this card: one heard since that offers another, or none, does not.
 * @param {SideMark} m @param {string} chainId
 */
export function sideOfferStands(m, chainId) {
  const now = sideActions.offer?.(chainId);
  return !now?.known || now.at === m.at;
}

/**
 * A card's row: drawn from the mark, painted again as the page hears the chat's graph while it is in the document — the
 * chat's room read again then, at most every `REFRESH_MS`. Its Accept reads the room afresh and decides from that
 * read: the card may stand a long while, an agent ended since. A card that stands no more
 * takes its row with it.
 * @param {SideMark} m @param {string} chainId
 * @returns {HTMLElement}
 */
export function sideOfferRow(m, chainId) {
  const body = h("div", { class: "so-body" });
  const card = h("div", { class: "tool-note so-card", "data-side-offer": String(m.at) }, body);
  const row = h("div", { class: "boundary-row is-subagent is-side" }, card);
  /**
   * `readAt`: when the room was last asked for; `reading`: a read the graph heard asked for is on its way; `later`: the
   * one it waits to make; `gone`: the row was drawn over, or left the document.
   * @type {{ facts: SideFacts | null, readAt: number, reading: boolean, later: ReturnType<typeof setTimeout> | null, busy: boolean, said: string, done: boolean, gone: boolean }}
   */
  const st = { facts: null, readAt: 0, reading: false, later: null, busy: false, said: "", done: false, gone: false };
  const key = `${chainId}\n${m.at}`;
  const model = sideActions.model?.(chainId) || "";
  const n = m.tasks.length;
  const stands = () => !st.done && !st.gone && sideOfferStands(m, chainId);
  // The countdown to the server's deadline: one line, its words set again each second, so a press in hand keeps its
  // button. Keyed, so a drawing over this row keeps it the clock.
  const clock = sideClockWords(m, 0) ? h("p", { class: "so-line so-clock", "data-key": "clock" }) : null;
  /** @type {any} */
  let ticking = null;
  const stopClock = () => {
    if (ticking) clearInterval(ticking);
    ticking = null;
  };
  const tick = () => {
    if (!clock || typeof m.until !== "number") return;
    // The server's deadline by the server's clock: a page on another machine's counts by it (`skew`).
    const left = m.until - (Date.now() + (st.facts?.skew || 0));
    // Past its deadline by the server's clock — once the room's read has said it, where one is made.
    if (left < -CLOCK_GRACE_MS && (st.facts || !sideActions.facts)) {
      clock.classList.add("hidden");
      clock.textContent = "";
      return stopClock();
    }
    clock.textContent = sideClockWords(m, left);
  };
  /**
   * The chat's room and turn, as the side-run route says them: `fresh`, asked now; else this card's read within
   * `FACTS_MS` stands. @param {boolean} fresh @returns {Promise<SideFacts>}
   */
  const read = (fresh) => {
    if (!sideActions.facts) return Promise.reject(new Error("this page reads no chat's room"));
    const had = factsRead.get(key);
    const r = !fresh && had && Date.now() - had.at < FACTS_MS ? had : { at: Date.now(), p: sideActions.facts(chainId).then((f) => ({ ...f, skew: typeof f?.now === "number" ? f.now - Date.now() : 0 })) };
    factsRead.set(key, r);
    st.readAt = r.at;
    return r.p.then(
      (f) => {
        st.facts = f;
        return f;
      },
      (/** @type {any} */ e) => {
        if (factsRead.get(key) === r) factsRead.delete(key);
        throw e;
      },
    );
  };
  /** The graph heard again: the room read again, at most every `REFRESH_MS`, while the card stands. */
  const refresh = () => {
    if (!stands() || st.busy || st.reading || st.later || !sideActions.facts) return;
    const wait = st.readAt + REFRESH_MS - Date.now();
    if (wait > 0) {
      st.later = setTimeout(() => {
        st.later = null;
        refresh();
      }, wait);
      return;
    }
    st.reading = true;
    read(true)
      .then(() => paint(), () => {})
      .finally(() => {
        st.reading = false;
      });
  };
  const paint = () => {
    const on = stands();
    row.classList.toggle("hidden", !on);
    if (!on) return void body.replaceChildren();
    const f = st.facts;
    const room = f ? roomWords(f, n) : null;
    const slow = slowCheckoutWords(f?.checkoutMs);
    // A room full when last read leaves Accept on: its press reads the room again, and says so where it is full still.
    const ready = !st.busy && !!sideActions.accept && !!model;
    tick();
    body.replaceChildren(
      h("span", { class: "so-ic", "aria-hidden": "true", html: ICONS.layers }),
      h("div", { class: "so-main" },
        h("div", { class: "so-head" }, h("strong", {}, `Your agent suggests running ${n === 2 ? "two" : n} tasks in parallel`)),
        h("ul", { class: "so-list", "aria-label": "The tasks" },
          ...m.tasks.map((t) => h("li", { class: "so-task" },
            h("span", { class: "so-id" }, t.id),
            h("span", { class: "so-name", title: t.name }, t.name),
            h("span", { class: "so-sub" }, [t.writes.length ? `writes ${writesWords(t.writes)}` : "reads only", f ? sideFolderWords(sideFolderOf(t, f)) : ""].filter(Boolean).join(" · "))))),
        h("p", { class: "so-line" }, `${model ? `On ${prettyModel(model)}, your agent's model. ` : ""}Each result comes to your agent as a report, and your agent applies it.`),
        h("p", { class: "so-line so-life" }, CARD_LIFE_WORDS),
        model ? null : h("p", { class: "so-line is-warn" }, NO_MODEL_WORDS),
        slow ? h("p", { class: "so-line is-warn" }, slow) : null,
        room && !room.fits ? h("p", { class: "so-line is-warn" }, room.words) : null,
        st.said ? h("p", { class: "so-line is-warn" }, st.said) : null,
        clock,
        h("div", { class: "so-acts" },
          h("button", { class: "inst-btn is-primary", type: "button", ...(ready ? {} : { disabled: "" }), title: "Each task goes to a sub-agent of its own: your agent is told to leave them, and each result comes to it", onclick: () => void accept() }, st.busy ? "Starting…" : "Accept"),
          h("button", { class: "inst-btn", type: "button", ...(st.busy || !sideActions.ignore ? { disabled: "" } : {}), title: "Clears the card: these tasks stay your agent's, and it suggests them again only if you ask it to", onclick: () => void ignore() }, "Ignore"))),
    );
  };
  const accept = async () => {
    if (st.busy || !sideActions.accept || !model) return;
    st.busy = true;
    st.said = "";
    paint();
    try {
      // The room as it is at the press: where it is full still, nothing is asked. Mid-turn too they start now, each copy
      // your folder as it stands.
      const f = await read(true);
      const room = roomWords(f, n);
      if (!room.fits) {
        st.said = `Nothing started: ${room.words}`;
        return;
      }
      const r = await sideActions.accept(chainId, acceptBody(m, model, f));
      st.done = true;
      // What the run did, not what was offered: a launch refused gave its task back to your agent.
      const later = !!r?.later;
      sideActions.said?.(sideStartedWords(later || !Array.isArray(r?.started) ? m.ids : r.started, later, Array.isArray(r?.refused) ? r.refused : []));
    } catch (/** @type {any} */ e) {
      // The card stands no more — pressed long after it was drawn, on a page that had not heard the graph since —:
      // nothing started, and it leaves, its words said once (the owner's of 11-06).
      if (e?.body?.gone === true) {
        st.done = true;
        sideActions.said?.(String(e?.body?.error || e?.message || e));
      } else st.said = `Nothing started: ${String(e?.message || e)}`;
    } finally {
      st.busy = false;
      paint();
    }
  };
  const ignore = async () => {
    if (st.busy || !sideActions.ignore) return;
    st.busy = true;
    st.said = "";
    paint();
    try {
      await sideActions.ignore(chainId, m.at);
      st.done = true;
    } catch (/** @type {any} */ e) {
      // Gone already — answered in another tab, or its tasks moved on —: it leaves here too, and says once that nothing
      // was ignored, as an Accept's refusal says nothing started (the hunt of side-card).
      if (e?.status === 409) {
        st.done = true;
        sideActions.said?.(String(e?.body?.error || e?.message || e));
      } else st.said = `Not cleared: ${String(e?.message || e)}`;
    } finally {
      st.busy = false;
      paint();
    }
  };
  paint();
  // The clock moves each second while the card stands in the document; a row drawn away, answered or gone stops it.
  if (clock && !clock.classList.contains("hidden")) {
    ticking = setInterval(() => (row.isConnected && stands() ? tick() : stopClock()), 1000);
    ticking?.unref?.();
  }
  if (stands() && sideActions.facts)
    read(false)
      .then(() => paint())
      .catch((/** @type {any} */ e) => {
        st.said = `The chat's room could not be read: ${String(e?.message || e)}`;
        paint();
      });
  // The graph is followed while the card is drawn: the next row drawn after it has left lets it go (lib/follow-drawn.js),
  // and a read it waited to make with it.
  if (sideActions.watch)
    followWhileDrawn(
      row,
      sideActions.watch,
      () => {
        paint();
        refresh();
      },
      () => {
        st.gone = true;
        if (st.later) clearTimeout(st.later);
        st.later = null;
        stopClock();
      },
    );
  return row;
}
