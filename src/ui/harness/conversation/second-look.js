// @ts-check
// A second look, drawn (HarnessV4_Space_Plan S3b, SG-D12; the mock's screens 10 and 12): on the permission card a review
// rule asks with, and on a dashboard button's sheet. It asks where the Reviewer's run is
// (`/sessions/:chain/second-looks/:agent`, answered once there is one), then follows it: what it reads as it reads it,
// its words as they come, its five lines once it is done — text, never HTML. Its time counts while it reads, and no
// clock ends it: the buttons beside it never wait. Where there is none, it says why: "No second look: …".
// What runs it is said under its head (the owner's word of 10-31): the model and its provider, What it was asked — its
// task whole, folded —, and The Reviewer's card, where the model every look runs on is set.
import { h } from "../../lib/dom.js";
import { api, followRun } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { applyWords } from "../lib/stream.js";
import { prettyModel } from "../lib/families.js";
import { routeFor } from "../lib/router.js";
import { holdJump } from "../settings/search.js";
import { lookAnswer, lookLine, lookTime, readingWords, roundText } from "../lib/second-look.js";
import { state } from "../state.js";
import { agentsPage } from "../../lib/teams-on.js";

/** Library's agents page, the Reviewer's card lit: where its model — every look's, where none is chosen — is set. */
export const openReviewerCard = () => {
  holdJump({ section: "saved-agents", start: "agents", selector: '[data-tag="reviewer"]' });
  location.hash = routeFor("library", { page: "agents" });
};

/**
 * @typedef {{ chain: string, agent: string } | { error: string }} LookRef  where a second look is, as the server says
 *   it (core/second-look.js)
 */

/**
 * @param {LookRef | null | undefined} look
 * @param {{ h?: typeof h, get?: (path: string) => Promise<any>, follow?: typeof followRun, now?: () => number, title?: string, none?: string,
 *   onEnd?: (lines: string[]) => void, modelName?: (id: string) => string, openCard?: () => void }} [o]
 *   `get`: the admin API (a test's stand-in); `follow`: a run's events and words; `title` and `none`: its head's words,
 *   and theirs where there is none — a button's check after it ran (S5d) is drawn the same way: "Agent check", "No check";
 *   `onEnd`: once it ended, with its lines (a check's sheet takes its Stop away and keeps its Verdict for Hand to an
 *   agent…); `modelName`: a model's name as the picker says it; `openCard`: the Reviewer's card opened
 * @returns {{ el: HTMLElement, stop: () => void }}
 */
export function secondLookView(look, o = {}) {
  const mk = o.h || h;
  const get = o.get || ((/** @type {string} */ p) => api(p));
  const follow = o.follow || followRun;
  const now = o.now || (() => Date.now());
  const nameOf = o.modelName || prettyModel;
  const openCard = o.openCard || openReviewerCard;
  const head = o.title || "Second look";
  const none = o.none || "No second look";
  const title = mk("span", { class: "slk-title" }, head);
  const state = mk("span", { class: "slk-state" });
  const doing = mk("div", { class: "slk-doing" });
  const list = mk("ol", { class: "slk-lines" });
  const headEl = mk("div", { class: "slk-head" }, mk("span", { class: "slk-ic", "aria-hidden": "true", html: ICONS.eye }), title, state);
  const el = mk("section", { class: "slk", "aria-label": head, "aria-live": "polite" }, headEl, doing, list);
  doing.hidden = true;
  if (!look || "error" in look) {
    const why = look && "error" in look ? look.error : "nothing started one";
    el.classList.add("is-none");
    title.textContent = `${none}:`;
    state.textContent = why;
    el.setAttribute("aria-label", `${none}: ${why}`);
    return { el, stop: () => {} };
  }
  // What runs it and what it was asked, under its head once its run says (the owner's word of 10-31).
  const on = mk("span", { class: "slk-on" });
  const asked = mk("pre", { class: "slk-asked" });
  asked.hidden = true;
  const toggle = mk("button", { class: "slk-link slk-asked-toggle", type: "button", "aria-expanded": "false", title: "Its task whole, as Filament wrote it: the command, the row, what to answer" }, "What it was asked");
  toggle.addEventListener("click", () => {
    asked.hidden = !asked.hidden;
    toggle.setAttribute("aria-expanded", asked.hidden ? "false" : "true");
  });
  const card = mk("button", { class: "slk-link slk-card", type: "button", title: `${agentsPage(state.config)}: the model every second look runs on, where you choose none` }, "The Reviewer's card");
  card.addEventListener("click", () => openCard());
  const meta = mk("div", { class: "slk-meta" }, on, mk("span", { class: "slk-sep", "aria-hidden": "true" }, "·"), toggle, mk("span", { class: "slk-sep", "aria-hidden": "true" }, "·"), card);
  meta.hidden = true;
  el.replaceChildren(headEl, meta, asked, doing, list);
  /** What its run says runs it, drawn once it says: its model, that model's provider, and its task. @param {any} r */
  const told = (r) => {
    if (!r?.model) return;
    on.textContent = `On ${nameOf(String(r.model))}${r.provider ? ` · ${r.provider}` : ""}`;
    asked.textContent = String(r.asked || "");
    meta.hidden = false;
  };
  const from = now();
  let ended = false;
  /** @type {any} */
  let reply = null;
  let roundFrom = 0;
  /** Its newest round's words as its log keeps them. */
  let said = "";
  /** @type {ReturnType<typeof setInterval> | null} */
  let ticking = null;
  /** @type {{ stop: () => void } | null} */
  let following = null;
  /** Stopped (its card answered, its sheet closed): a run it learns of afterwards is not followed. */
  let stopped = false;

  /** @param {string[]} lines */
  const drawLines = (lines) =>
    list.replaceChildren(...lines.map((l) => {
      const { label, text } = lookLine(l);
      return mk("li", { class: "slk-line" }, ...(label ? [mk("span", { class: "slk-label" }, `${label}: `)] : []), text);
    }));
  const reading = () => {
    if (ended) return;
    // A card answered or a sheet closed takes this with it.
    if (ticking && !el.isConnected && now() - from > 2000) return stop();
    state.textContent = `· Reviewer is reading… ${lookTime(now() - from)}`;
  };
  /** @param {string} words @param {string[]} lines */
  const end = (words, lines) => {
    ended = true;
    if (ticking) clearInterval(ticking);
    ticking = null;
    doing.hidden = true;
    state.textContent = words;
    if (lines.length) drawLines(lines);
    el.classList.add("is-done");
    o.onEnd?.(lines);
  };
  /**
   * Its end as the registry keeps it (`r`, ended): done, its answer whole under `doneWords`; stopped or failed, why, and
   * of its report only lines of its answer — the rest is Filament's note of its stop, no word of the Reviewer's.
   * @param {any} r @param {string} doneWords
   */
  const endFrom = (r, doneWords) => {
    if (r?.status === "done") return end(doneWords, lookAnswer(r.report || "", true));
    const lines = lookAnswer(r?.report || "");
    end(r?.error ? `· the Reviewer stopped: ${r.error}` : lines.length ? "· the Reviewer was stopped" : "· the Reviewer was stopped before it answered", lines);
  };
  const stop = () => {
    stopped = true;
    if (ticking) clearInterval(ticking);
    ticking = null;
    following?.stop();
    following = null;
  };

  reading();
  ticking = setInterval(reading, 1000);
  const path = `/sessions/${encodeURIComponent(look.chain)}/second-looks/${encodeURIComponent(look.agent)}`;
  /**
   * Its end as the registry keeps it, where its run said nothing the page could follow (its log no longer kept): the
   * answer whole, or why it failed.
   */
  const settle = async () => {
    try {
      const r = await get(path);
      told(r);
      if (r?.status === "running") return end("· its words could not be followed: its card in the chat's Agents shows them", []);
      endFrom(r, `· Reviewer · ${lookTime(now() - from)}`);
    } catch (/** @type {any} */ e) {
      end(`· ${e?.message || "its answer could not be read"}`, []);
    }
  };
  /**
   * Its run ended (`status`, its run-end's; "" where the stream closed): its last round's words are its answer.
   * @param {string} status
   */
  const finish = (status) => {
    if (ended) return;
    const lines = lookAnswer(roundText(reply, roundFrom) || said, true);
    const fine = !status || /^(done|ok|ended|completed)$/.test(status);
    if (lines.length || !fine) return end(fine ? `· Reviewer · ${lookTime(now() - from)}` : `· the Reviewer stopped (${status})`, lines);
    void settle();
  };
  void (async () => {
    /** @type {any} */
    let r;
    try {
      r = await get(path);
    } catch (/** @type {any} */ e) {
      return end(`· none: ${e?.message || "it could not be read"}`, []);
    }
    told(r);
    // Ended before the page asked (a page loaded again, a pause an undone rewind brought back): its end as the registry
    // keeps it.
    if (r.status !== "running") return endFrom(r, "· Reviewer · done");
    if (!r.runId) return settle();
    // Stopped while it asked: a follow made now had nothing left to stop it, and a Reviewer gone without an end in its
    // log was followed for as long as the page lived.
    if (stopped) return;
    following = follow(r.runId, {
      words: true,
      onEvent: (/** @type {any} */ e) => {
        if (e?.type === "round-start") roundFrom = Number.isInteger(e.blocksBefore) ? e.blocksBefore : roundFrom;
        // A round's words whole, as its log keeps them: what a page that joins late reads.
        if (e?.type === "round-text") {
          said = String(e.text || "");
          if (!ended && !roundText(reply, roundFrom)) drawLines(lookAnswer(said));
        }
        const w = readingWords(e);
        if (w && !ended) {
          doing.hidden = false;
          doing.textContent = `reads ${w}`;
        }
        if (e?.type === "run-end") finish(String(e.status || ""));
      },
      onWords: (/** @type {any} */ frame) => {
        reply = applyWords(reply, frame);
        // Its words before its first numbered line are not its answer (a round that reads first).
        if (!ended) drawLines(lookAnswer(roundText(reply, roundFrom)));
      },
      onDone: () => finish(""),
    });
  })();
  return { el, stop };
}
