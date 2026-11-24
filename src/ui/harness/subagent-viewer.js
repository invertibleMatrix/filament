// @ts-check
// An agent's conversation (HarnessV3 §15 item 86): one agent on the side, whole. Its head names it — its words, its
// card, model and the context it was handed — with its state, the time it has run and Stop while it works. The body
// is every exchange in order: the context its first
// message opened with, the task (or follow-up) entire, and the exchange's own run followed live — each round's
// thinking and words as they stream (HarnessV4_Tasks U1), its tool calls drawn as the transcript draws them,
// compactions and budget stops — then how it ended. Once it is idle the footer takes a follow-up, which continues the same conversation. A sub-agent that works
// in its own git worktree (§15 item 88) closes with its changes: the files, the diff on demand, and Apply.
// The conversation is one part (`subagentConversation`: its head, body and foot) that two hosts mount (HarnessV4_Tasks
// E15 step 2, AG-12; step 5, AG-104): an agent's thread in a tile beside the chat (panes/thread.js) and the Sub Agents tab
// (views/side.js).
// A saved agent's conversation is said in its card's words: its name, "read only", "You asked" — or "The main agent
// asked", where it did. What you type while it still works is held over the box and goes when it answers (step 5,
// AG-101); a thread that is not yours to continue has no box, and says why (AG-105). A coding agent's own agent —
// Claude's Agent tool, Codex's child thread, Cursor's task — is a thread to read (`guestConversation`, AG-153): its
// one exchange, drawn by the same part from what its turn's run says of it.
import { followScroll } from "./lib/follow-scroll.js";
import { h, morphChildren, setHtml, placeChildren } from "../lib/dom.js";
import { fmt } from "../lib/format.js";
import { followRun } from "./lib/api.js";
import { REPLAY_MAX_MS, REPLAY_QUIET_MS } from "./lib/replay-hold.js";
import { onBus } from "./lib/bus.js";
import { oneBehind } from "./lib/one-behind.js";
import { whenPageShown } from "./lib/page-shown.js";
import { alignOnto, letGoOfLog, formatWorkedFor, outputCutWords, subagentViewFact, turnStateWords, STEER_FROM_WORDS } from "./lib/labels.js";
import { mdChat } from "./lib/md-stream.js";
import { ICONS } from "./lib/icons.js";
import { button, menu } from "./lib/ui.js";
import { ringSvg } from "./widgets/kit.js";
import { ACT_ON_REPORT, answeredOther, applyFailure, contextGauge, deliveryFact, effortAt, freshWords, machineWords, noBoxWhy, sendChoices, sentWords, startedWords, subagentRoutes, statusWord, statusTone, tookOf, roundWords, openingWords } from "./lib/subagents.js";
import { seesFact, answerFact, askedWords, mayFact, copyFact, modelFact, handedWords, attachedNames, attachedWords } from "./lib/agent-cards.js";
import { prettyModel } from "./lib/families.js";
import { seatWords } from "./lib/pool.js";
import { rowIcon } from "./lib/side.js";
import { guestOf, guestOwner, guestThread, guestWhy } from "./lib/guest-thread.js";
import { askWords, toldWords, yourAsk } from "./lib/team.js";
import { applyWords } from "./lib/stream.js";
import { failureCard, failureWords } from "./lib/failure.js";
import { cardsEl, keepOutputs, noticesEl } from "./conversation/timeline.js";
import { shimNote } from "./conversation/turn.js";
import { answerControls, answersKey, askWhat, questionOf } from "./conversation/decisions.js";
import { thinkEl } from "./conversation/reasoning.js";
import { visualCard } from "./conversation/visual.js";
import { artifactCard } from "./conversation/artifact.js";
import { chipActions } from "./conversation/tools/layout.js";
import { PREVIEW_MS, REBASE_DUE_NOTE, WHY_WAITS, effectLine, howApplyWorks, kindWords, leaf, leftNote, nothingWords, resultLine } from "./lib/apply-words.js";
import { clockOf } from "./panes/changes-data.js";

/** A run that has not reported its id yet is looked up again after this long (its bus message may be lost). */
const STARTING_RETRY_MS = 2000;
/** A thread Filament could not answer for (busy, the connection dropped) is asked again after this long, doubled each time to the most. */
const LOOK_RETRY_MS = 2000;
const LOOK_RETRY_MAX_MS = 30_000;

/**
 * What a thread Filament started itself did in all: its runs and what they cost.
 * @param {import("./lib/subagents.js").SubagentRow} sa
 */
function selfTotal(sa) {
  const own = sa.exchanges.filter((x) => x.by === "self");
  const usd = own.reduce((n, x) => n + (Number(x.spentUsd) || 0), 0);
  return own.length ? `${own.length} run${own.length === 1 ? "" : "s"}${usd > 0 ? ` · $${usd.toFixed(usd < 0.1 ? 3 : 2)} in all` : ""}` : "";
}
/** How a changed file's status reads in the list. @type {Readonly<Record<string, string>>} */
const FILE_STATUS = Object.freeze({ A: "added", M: "changed", D: "deleted", T: "type changed" });

/** @param {number} at */
const clock = (at) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
/** @param {any} e */
const roundOf = (e) => (Number.isInteger(e?.round) ? e.round : 0);
/**
 * The run an exchange's rounds are followed in: its own, else — one on another machine — the run here its turn there
 * streams into (`mirror`), which takes no press of its cards: those are that machine's.
 * @param {{ runId?: string | null, mirror?: string } | null | undefined} ex
 */
const runOf = (ex) => ex?.runId || ex?.mirror || null;

/**
 * One sentence per round note the run's events carry that its cards do not draw: a budget's stop, an output cut. A
 * compaction is its round's line, as the chat draws it (`cardsEl`).
 * @param {any} e @returns {string | null}
 */
function noteOf(e) {
  if (e.type === "budget") return `Budget reached: ${e.which}${e.limit != null ? ` (${e.at} of ${e.limit})` : ""}`;
  if (e.type === "output-cut") return outputCutWords(e).replace(/\.$/, "");
  return null;
}

/**
 * A running agent's context gauge, beside its state in its head (the owner's of 11-12: its count, and where it
 * compacts), as the chat's own Context chip reads: "Context", a ring of the share of its window it holds with the line
 * where room is made marked on it, that share, then its count and where it compacts (lib/subagents.js
 * `contextGauge`) — orange nearing the line, red past it, the whole of it its tooltip. No ring and no share where no
 * window is known; hidden where nothing is counted yet, or it does not run.
 * @param {HTMLElement} el  the gauge @param {import("./lib/subagents.js").SubagentProgress | null | undefined} p  its
 *   progress while it runs, else null
 */
function paintContext(el, p) {
  const g = contextGauge(p);
  el.className = g ? `sav-ctx${g.tone ? ` is-${g.tone}` : ""}` : "sav-ctx hidden";
  if (!g) return void morphChildren(el, []);
  el.setAttribute("title", g.title);
  const color = g.tone === "error" ? "var(--color-sys-red)" : g.tone === "warn" ? "var(--color-sys-orange)" : "var(--color-sys-blue)";
  morphChildren(el, [
    h("span", { class: "sav-ctx-label" }, "Context"),
    ...(g.fill != null ? [h("span", { class: "sav-ctx-ring", html: ringSvg({ size: 14, width: 2.5, parts: [{ f: Math.max(0.001, g.fill), color }], notch: g.line?.f ?? null }) })] : []),
    ...(g.share ? [h("span", { class: "sav-ctx-share" }, g.share)] : []),
    h("span", { class: "sav-ctx-more" }, [g.count, g.at, g.folds].filter(Boolean).join(" · ")),
  ]);
}
/** @param {string} s */
const capital = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

/**
 * The context a sub-agent's first message opened with, each block folded under its one line. A fork's block says in
 * a line what it copied — the main agent's whole conversation, which is not repeated here. A team's reviewer may open
 * with the change it reviews: a builder's diff, not applied yet (HarnessV3-AtHome P2). A thread its session gave back
 * says what it was shown by kind and size: those words are kept no more, but for memory's brief while its conversation
 * opens with it, and a block without them does not open.
 * @param {import("./lib/subagents.js").Opening[]} opening
 */
function openingEl(opening) {
  if (!opening.length) return null;
  return h("div", { class: "sav-opening" },
    h("div", { class: "sav-label" }, "Context handed over"),
    ...opening.map((b) => {
      const patch = b.kind === "review" || b.kind === "changes";
      const size = b.kind === "fork" ? "" : `~${fmt.k(fmt.tokens(b.chars ?? b.text.length))} tokens`;
      const head = [h("span", { class: "sav-context-ic", html: b.kind === "brief" ? ICONS.brain : patch ? ICONS.fileDiff : ICONS.messageSquare }), h("span", {}, openingWords(b))];
      if (!b.text)
        return h("div", { class: "sav-context", title: "Filament keeps what was said in a thread, not what the agent was shown" },
          h("div", { class: "sav-context-head" }, ...head, h("span", { class: "sav-context-size" }, [size, "not kept"].filter(Boolean).join(" · "))));
      return h("details", { class: "sav-context" },
        h("summary", {}, ...head, size ? h("span", { class: "sav-context-size" }, size) : null),
        h("pre", { class: "sav-context-text" }, b.text));
    }));
}

/** A unified diff, each line toned by what it is. @param {string} diff */
function diffEl(diff) {
  const lines = String(diff || "").replace(/\n$/, "").split("\n");
  return h("pre", { class: "sav-diff" },
    ...lines.map((line) => h("span", {
      class: line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ") ? "d-file"
        : line.startsWith("@@") ? "d-hunk"
        : line.startsWith("+") ? "d-add"
        : line.startsWith("-") ? "d-del"
        : "",
    }, line)));
}

/**
 * The session's main agent, as a thread's "Send to main agent" needs it (HarnessV4_Tasks E15 step 5, BW-8).
 * @typedef {{ state: () => "works" | "asks" | "idle", outside: () => string | null, start: (line: string) => void, write: (text: string) => void }} MainDoor
 *   `state`: what it does now; `outside`: the outside client that writes this session's turns, where one does — a
 *   report can be queued only for turns Filament's own page sends; `start`: its turn, begun with a line of yours
 *   through the page's own send; `write`: words into the chat's message box, under what is there, never sent — a
 *   picture's ask or Tell in a thread that has no box of its own (HarnessV4_Visuals_Plan VS-D51)
 */

/**
 * A thread's pictures (HarnessV4_Visuals_Plan VS-D49): each one's card, made once by its call's id — kept, read from
 * where it is kept, or as its model writes it — and the cards of the artifacts it published (AFC-100), by its call's
 * id, or by the artifact where its log is gone.
 * @typedef {{ kept: (k: import("./lib/subagents.js").Drew) => HTMLElement, writing: (w: { id: string, title: string, loading: string[], chars: number }) => HTMLElement,
 *   artifact: (k: { id: string, name: string, v: number, title: string }) => HTMLElement }} Pictures
 */

/**
 * One exchange: the prompt, and its run's rounds as the events arrive. The first opens with the context its message
 * was handed, as each read of the agent brings it (`update`): a launch composes it after the agent is listed.
 * @param {import("./lib/subagents.js").SubagentExchange} ex @param {number} index
 * @param {{ stick: (fn: () => void) => void, label: string,
 *   onward: { main: MainDoor, send: (exchange: number, when: "now" | "next") => Promise<{ into: "turn" | "queue" }> } | null,
 *   toast: (msg: string, kind?: string) => void, pictures?: Pictures | null,
 *   at?: { chain: string, agent: string, there?: () => import("./conversation/tools/layout.js").There | null } | null,
 *   follow?: (hears: { onEvent: (e: any) => void, onWords: (frame: any) => void }) => { promise: Promise<unknown>, stop: () => void },
 *   asleep?: boolean }} o
 *   `label`: the words over the prompt (`askedWords`) — a saved agent's exchanges are questions, not tasks;
 *   `onward`: the way from its answer to the main agent — the session's main agent, and `send`, which hands this
 *   exchange's answer over — or null for an answer that is nobody's to send: a coding agent's own agent's went to the
 *   call that began it; `pictures`: its pictures' cards, where its thread draws them; `follow`: where its rounds come
 *   from, for an exchange that has no run of its own to stream; `at`: its chat and its agent, where its edit cards ask
 *   their call's own change (the transcript audit, 2026-10-23); `asleep`: its run is followed only once it is woken
 *   (`wake`), as its thread comes near it
 */
function exchangeView(ex, index, o) {
  /** Its run's log as it lands, let go of once every event of it is in and aligned (`flush`). @type {any[] | null} */
  let events = [];
  /** What its end reads of the log (`paintEnd`), kept as each event lands: how many came, whether a round said words,
   *  and the pictures and artifacts it brought. */
  const heard = { events: 0, said: false, drawn: new Set(), published: new Set() };
  /**
   * A round as drawn. `thought` and `said`: its thinking and its words are in whole, from the run's log; until then
   * `draft` is its thinking as it streams, and `text` holds its words so far.
   * `pics`: the pictures it drew, after its calls (HarnessV4_Visuals_Plan VS-D49).
   * @type {Map<number, { el: HTMLElement, text: HTMLElement, tools: HTMLElement, pics: HTMLElement, notes: HTMLElement, said: boolean, acted: boolean, thought: boolean, from: number | null, draft: { block: { text: string, done?: boolean }, view: ReturnType<typeof thinkEl> } | null }>}
   */
  const rounds = new Map();
  /** The run's words as they stream: the server holds them while it runs, and its log keeps a round's only at the
   *  round's end — minutes of thinking read as one still word without them. @type {{ blocks: { type: string, text: string }[] } | null} */
  let words = null;
  let wordsMoved = false;
  const roundsBox = h("div", { class: "sav-rounds" });
  /** What the agent told the person beside its answer (HarnessV4_Tasks C21), as the chat draws a turn's. */
  const noticesBox = h("div", { class: "sav-notices" });
  const working = h("div", { class: "sav-working" }, h("span", { class: "gradient" }, "Starting"));
  /** Its pictures where its run's log is gone: what the exchange says it drew, before its end. */
  const drewBox = h("div", { class: "sav-pics" });
  const endBox = h("div", { class: "sav-end hidden" });
  /** Under the answer (BW-8): where it stands with the main agent, and the ways on with it. */
  const actsBox = h("div", { class: "sav-acts hidden" });
  const el = h("section", { class: "sav-ex" },
    ex.fresh ? h("div", { class: "sav-note sav-fresh" }, freshWords(ex.fresh)) : null,
    h("div", { class: "sav-label" }, o.label, h("span", { class: "sav-time" }, clock(ex.startedAt))),
    // Why it started by itself, as it was written: a sign's line names a command.
    ex.by === "self" && ex.why ? h("div", { class: "sav-note sav-why" }, ex.why) : null,
    // A start by itself was told Filament's words, not yours: they stand folded.
    ex.by === "self" ? h("details", { class: "sav-told" }, h("summary", {}, "What Filament told it"), h("div", { class: "sav-bubble" }, ex.prompt)) : h("div", { class: "sav-bubble" }, ex.prompt),
    // What the main agent attached to its message (`attach`), each by name in its tooltip.
    ex.by === "agent" && (ex.files?.length || ex.pictures?.length) ? h("div", { class: "sav-note sav-attached", title: attachedNames(ex) }, attachedWords(ex)) : null,
    roundsBox,
    noticesBox,
    working,
    drewBox,
    endBox,
    actsBox);
  /** The first exchange's context as drawn, and what it was drawn from: drawn again only when that moves, so a fold
   *  opened stays open. @type {HTMLElement | null} */
  let openingShown = null;
  let openingKey = "";
  /** @param {import("./lib/subagents.js").Opening[]} opening */
  const paintOpening = (opening) => {
    const key = JSON.stringify(opening);
    if (key === openingKey) return;
    openingKey = key;
    const next = openingEl(opening);
    if (openingShown && next) openingShown.replaceWith(next);
    else if (openingShown) openingShown.remove();
    else if (next) el.insertBefore(next, el.firstChild);
    openingShown = next;
  };
  /** @type {{ promise: Promise<unknown>, stop: () => void } | null} */
  let follow = null;
  let current = ex;
  let thoughts = 0;
  /** Every event of the run is in: its end was reached, or its log is gone. */
  let followed = false;
  let closed = false;
  /** Its run is followed once it has one; an exchange asleep waits for its thread to wake it (`wake`). */
  let awake = !o.asleep;
  /** Its rounds are shown, or it has none to show: its replay is in, or it held none (`shown`). */
  let landed = () => {};
  const shown = new Promise((resolve) => { landed = () => resolve(undefined); });
  /** @type {Set<number>} */
  const dirty = new Set();
  /** The round whose plan card stands: the run's newest plan's (labels.js `alignEvents`). @type {number | null} */
  let planRound = null;
  /** Each message into its run, by its id: the line that says whether it was read. @type {Map<string, HTMLElement>} */
  const sent = new Map();
  /** Each message's words, by its id: the developer may change them while it waits. @type {Map<string, HTMLElement>} */
  const sentText = new Map();
  /** Its calls' rows drawn last, kept while what each is drawn from holds (render.js `DrawnRows`): a card is not drawn
   *  anew at each event, so its picture, its diff and its output's place stay. @type {import("./conversation/tools/render.js").DrawnRows} */
  const kept = new Map();
  /** Where each command's output stands, kept as it scrolls, as the chat keeps a turn's (timeline.js `outputTops`):
   *  read off every output of the thread at each frame, it laid the whole thread out at each event of a running agent.
   *  @type {WeakMap<Element, number>} */
  const outputTops = new WeakMap();
  roundsBox.addEventListener("scroll", (e) => {
    const t = /** @type {any} */ (e.target);
    if (t?.classList?.contains("term-out")) outputTops.set(t, Number(t.scrollTop) || 0);
  }, true);
  /** Filament's own word on how its run ended (a stop, a budget, a rail): its note, never its words. */
  let noticed = "";
  let noticesKey = "";
  /** Its run's events as the newest frame aligned them: what the working line reads between frames. @type {any} */
  let lastAligned = null;
  /** What the frames aligned of its run's log so far (labels.js `alignOnto`). */
  const alignCache = {};
  /**
   * Where its run stood as the follow began (its hello's `run.events`, the last event's `n`), and the newest event
   * here: until that one is in, the replay is still passing its earlier rounds. A thread opened on a run its run
   * socket replays one message at a time: drawn as it came, a frame between any two, it rolled through every round to
   * its end, its words each round's later ones glued on (the owner's of 11-15: "it takes some times to load it, the
   * text loads and then takes sometimes it reaches the tail. the text being rendered feels unformatted as well").
   * Its rounds wait out of sight, no frame drawn, until the replay is in, then land in one frame, at their end — or
   * once it falls quiet (`REPLAY_QUIET_MS`) or has taken `REPLAY_MAX_MS`, a replay that slow drawn as it comes. A
   * follow that hands no hello (a coding agent's own agent's, `o.follow`) holds nothing.
   */
  let replayTo = 0;
  let lastN = 0;
  let replaying = false;
  /** When the replay last brought something, and when it is drawn whatever it has brought. */
  let heardAt = 0;
  let holdUntil = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let replayWait;
  /** Its rounds shown once the replay falls quiet or has waited its most; else looked at again then. */
  const waitReplay = () => {
    const left = Math.min(heardAt + REPLAY_QUIET_MS, holdUntil) - Date.now();
    if (left <= 0) return endReplay();
    replayWait = setTimeout(waitReplay, left);
  };
  let frame = 0;
  const schedule = () => {
    if (!frame && !closed && !replaying) frame = requestAnimationFrame(flush);
  };
  /** The replay in, or waited for long enough: its rounds shown, drawn in the next frame. */
  const endReplay = () => {
    clearTimeout(replayWait);
    if (!replaying) return;
    replaying = false;
    roundsBox.classList.remove("hidden");
    schedule();
    landed();
  };
  /** @param {any} run  the run as its follow's hello says it */
  const heardRun = (run) => {
    replayTo = Math.max(replayTo, Number(run?.events) || 0);
    // A follow taken up again (its socket dropped) replays only what it missed, onto rounds already shown.
    if (heard.events || lastN >= replayTo || replaying) {
      if (!replaying) landed();
      return;
    }
    replaying = true;
    roundsBox.classList.add("hidden");
    paintWorking();
    heardAt = Date.now();
    holdUntil = heardAt + REPLAY_MAX_MS;
    replayWait = setTimeout(waitReplay, REPLAY_QUIET_MS);
  };

  /** @param {number} r */
  const roundView = (r) => {
    let v = rounds.get(r);
    if (!v) {
      const text = h("div", { class: "a-md sav-text hidden" });
      const tools = h("div", { class: "sav-tools" });
      const pics = h("div", { class: "sav-pics" });
      const notes = h("div", { class: "sav-notes" });
      v = { el: h("div", { class: "sav-round" }, text, tools, pics, notes), text, tools, pics, notes, said: false, acted: false, thought: false, from: null, draft: null };
      rounds.set(r, v);
      // Rounds arrive in order; one that shows up late (a note on round 0) still lands in its place.
      const after = [...rounds.keys()].filter((k) => k > r).sort((a, b) => a - b)[0];
      roundsBox.insertBefore(v.el, after != null ? /** @type {any} */ (rounds.get(after)).el : null);
    }
    return v;
  };

  /**
   * What the running exchange is doing now, as the chat's live line says a turn's (the transcript audit, 2026-10-23):
   * waiting for your answer, for a slot at its provider or to try again; starting; waiting for its own agents; its
   * model's call before its words land, with what it has thought where its run counts it. A running call says so on
   * its own row, and a compaction on its line.
   * @param {any} [aligned]  its run's events, aligned
   */
  const paintWorking = (aligned = lastAligned) => {
    const running = current.status === "running";
    const last = rounds.size ? rounds.get(Math.max(...rounds.keys())) : null;
    // A round whose thinking or words stream says so itself: the thinking block rolls its newest line.
    const streams = !!last && (!!last.draft || !last.text.classList.contains("hidden"));
    const st = aligned?.turnState || null;
    const why = String(st?.why || "");
    const busy = !!aligned && [...aligned.byRound.values()].some((c) => c.compacting || c.order.some((/** @type {string} */ k) => c.tools.get(k)?.state === "running"));
    const word = replaying
      ? "Loading"
      : !running
      ? ""
      : st?.to === "waiting" && why.startsWith("the developer's answer")
        ? `Waiting for your answer${why.includes(" — ") ? `: ${why.split(" — ").slice(1).join(" — ")}` : ""}`
        : st?.to === "waiting" && (st.retry || st.queue)
          ? capital(turnStateWords(st))
          : !runOf(current) || !last
            ? "Starting"
            : busy
              ? ""
              : st?.to === "waiting"
                ? capital(turnStateWords(st))
                : !last.said && !last.acted && !streams
                  ? st?.to === "planning" && st.tokens ? capital(turnStateWords(st)) : "Thinking"
                  : "";
    working.classList.toggle("hidden", !word);
    /** @type {HTMLElement} */ (working.firstChild).textContent = word;
  };

  /**
   * The newest round's thinking and words so far, drawn once a frame; what the run's log brought whole stays. The words
   * are the running round's alone: while the replay is still passing an earlier round, the blocks after its start are
   * its own and every later round's, so they wait for the replay to reach the round that runs.
   */
  const drawWords = () => {
    if (lastN < replayTo) return;
    wordsMoved = false;
    const v = rounds.size ? rounds.get(Math.max(...rounds.keys())) : null;
    if (!words || !v || v.from == null) return;
    const own = roundWords(words.blocks, v.from);
    if (own.thinking && !v.thought) {
      if (!v.draft) {
        const block = { text: own.thinking, done: false };
        v.draft = { block, view: thinkEl(block, { isFirst: thoughts++ === 0 }) };
        v.el.insertBefore(v.draft.view.el, v.text);
      }
      v.draft.block.text = own.thinking;
      v.draft.view.draw();
    }
    // Filament's note on how it ended stands as its note (`noticed`), not among its words.
    const said = noticed && own.text.trimEnd().endsWith(noticed) ? own.text.trimEnd().slice(0, -noticed.length).trimEnd() : own.text;
    if (said && !v.said) {
      // Its words began: the thinking before them is over.
      if (v.draft && !v.draft.block.done) v.draft.view.finish();
      v.text.classList.remove("hidden");
      setHtml(v.text, mdChat(said, null).out);
    }
  };

  /**
   * Pictures into their box, in the order drawn: a card goes in once and is never moved — a frame moved draws again
   * from its start — and one not wanted any more (its call was refused) leaves.
   * @param {HTMLElement} box @param {HTMLElement[]} want
   */
  const place = (box, want) => {
    for (const el of Array.from(box.children)) if (!want.includes(/** @type {HTMLElement} */ (el))) el.remove();
    for (const el of want) if (el.parentNode !== box) box.append(el);
  };
  /**
   * A round's pictures: the ones kept, then any its model is still writing (VS-D11), then the artifacts it published
   * (AFC-100). @param {any} cell
   */
  const roundPictures = (cell) => (!o.pictures || !cell ? [] : [
    ...cell.visuals.map((/** @type {any} */ k) => /** @type {Pictures} */ (o.pictures).kept(k)),
    ...[...cell.writing.values()].map((/** @type {any} */ w) => /** @type {Pictures} */ (o.pictures).writing(w)),
    ...(cell.artifacts || []).map((/** @type {any} */ k) => /** @type {Pictures} */ (o.pictures).artifact(k)),
  ]);

  /** What the agent told the person beside its answer, drawn again only when it changes. @param {any} aligned */
  const paintNotices = (aligned) => {
    const key = JSON.stringify(aligned.notices || []);
    if (key === noticesKey) return;
    noticesKey = key;
    noticesBox.replaceChildren(...(aligned.notices?.length ? [noticesEl(aligned.notices)] : []));
  };

  const flush = () => {
    frame = 0;
    o.stick(() => {
      if (wordsMoved) drawWords();
      // Onto what the frame before aligned, as the chat's turn is (labels.js `alignOnto`): the whole log aligned again
      // each frame made a frame's work grow with the run.
      const aligned = alignOnto(alignCache, events);
      lastAligned = aligned;
      // Its run is over and every event of it is in, aligned: the alignment is all its rounds are drawn from, and the
      // log itself is let go of (labels.js `letGoOfLog`) — a frame after reads the alignment as it stands.
      if (followed && current.status !== "running" && events && letGoOfLog(alignCache, events)) events = null;
      // Its rounds' cards as the chat draws a turn's (the transcript audit, 2026-10-23): its plan, hooks, its own
      // agents' marks, compactions and the line of one under way, an edit's change, the Background button. A row whose
      // call did not change stays, and each command's output keeps its place.
      const live = current.status === "running";
      // One on another machine's calls ran there: its cards ask nothing of this one's (tools/render.js `TurnAt` `there`).
      const at = o.at ? { chain: o.at.chain, n: index, agent: o.at.agent, ...(o.at.there?.() ? { there: o.at.there() } : {}) } : null;
      const outputs = /** @type {[HTMLElement, number][]} */ (Array.from(roundsBox.querySelectorAll("pre.term-out")).map((p) => [/** @type {HTMLElement} */ (p), outputTops.get(p) || 0]));
      for (const r of dirty) {
        const cell = aligned.byRound.get(r);
        if (!cell && !rounds.has(r)) continue;
        const v = roundView(r);
        placeChildren(v.tools, cell ? cardsEl(cell, { live, runId: current.runId || undefined, turnAt: at, drawn: kept, asksApart: false, steers: false, ownChat: false }) : []);
        place(v.pics, roundPictures(cell));
      }
      dirty.clear();
      keepOutputs(outputs, roundsBox);
      paintNotices(aligned);
      paintWorking(aligned);
      paintEnd();
    });
  };

  /** @param {any} e */
  const push = (e) => {
    // A log let go of is a run over and aligned whole: an event heard again adds nothing to it.
    events?.push(e);
    heard.events++;
    if (e?.type === "round-text") heard.said = true;
    else if (e?.type === "visual") heard.drawn.add(String(e.id));
    else if (e?.type === "artifact") heard.published.add(String(e.name));
    if (Number.isFinite(e?.n)) lastN = Math.max(lastN, e.n);
    // The replay is in at its hello's newest event: everything it brought lands in the next frame.
    if (replaying && lastN >= replayTo) endReplay();
    else if (replaying) heardAt = Date.now();
    const r = roundOf(e);
    switch (e.type) {
      case "round-start":
        // Where its own words begin among the run's: the blocks that stood before it are earlier rounds'.
        roundView(r).from = Number.isInteger(e.blocksBefore) ? e.blocksBefore : null;
        wordsMoved = true;
        break;
      case "round-thinking": {
        const v = roundView(r);
        v.thought = true;
        if (v.draft) {
          // The block that streamed is the round's thinking: it takes the log's copy and closes.
          v.draft.block.text = String(e.thinking || "");
          v.draft.view.draw();
          v.draft.view.finish();
          break;
        }
        const t = thinkEl({ text: String(e.thinking || ""), done: true }, { isFirst: thoughts++ === 0 });
        v.el.insertBefore(t.el, v.text);
        break;
      }
      case "round-text": {
        const v = roundView(r);
        v.said = true;
        v.text.classList.remove("hidden");
        setHtml(v.text, mdChat(String(e.text || ""), null).out);
        break;
      }
      case "tool-start":
        roundView(r).acted = true;
        dirty.add(r);
        break;
      // Its plan, drawn among the round's rows: one card, at its newest list, which leaves the round that had it.
      case "plan":
        if (planRound != null && planRound !== r) dirty.add(planRound);
        planRound = r;
        dirty.add(r);
        break;
      case "tool-output":
      case "tool-end":
      // A picture it drew, one its model is writing, or an artifact it published: after the round's calls.
      case "visual":
      case "visual-writing":
      case "artifact":
        dirty.add(r);
        break;
      // A message into its run while it worked (HarnessV3-TaskGraph-v2 §12.12, U7): whose — its lead's, Filament's, the
      // developer's own — its words, and whether it has read it. It carries no round: it stands in the round that ran
      // when it came.
      case "steer": {
        if (e.kind !== "note" || !e.id) break;
        const state = h("div", { class: "sav-steer-state" }, "waits for its next step");
        const words = h("div", { class: "sav-steer-text" }, String(e.text || ""));
        sent.set(String(e.id), state);
        sentText.set(String(e.id), words);
        const at = rounds.size ? Math.max(...rounds.keys()) : 0;
        roundView(at).notes.append(h("div", { class: `sav-steer${e.from ? ` from-${String(e.from)}` : ""}` },
          h("div", { class: "sav-steer-from" }, /** @type {Record<string, string>} */ (STEER_FROM_WORDS)[String(e.from)] || "Your message"),
          words,
          state));
        break;
      }
      case "steer-read":
        for (const id of e.ids || []) { const st = sent.get(String(id)); if (st) st.textContent = "read at its next step"; }
        break;
      case "steer-unread":
        for (const id of e.ids || []) { const st = sent.get(String(id)); if (st) st.textContent = "never read: its run ended first"; }
        break;
      // Changed, or taken back, while it waited; handed to its agent (HarnessV4_Tasks C34).
      case "steer-edit": {
        const w = sentText.get(String(e.id ?? ""));
        if (w) w.textContent = String(e.text || "");
        break;
      }
      case "steer-drop":
        for (const id of e.ids || []) { const st = sent.get(String(id)); if (st) st.textContent = "taken back: it never went"; }
        break;
      case "steer-sent":
        for (const id of e.ids || []) { const st = sent.get(String(id)); if (st && st.textContent === "waits for its next step") st.textContent = "with its agent: it goes in at its next step"; }
        break;
      // Filament's word on how its run ended — a stop, a budget, a rail — as the chat draws a turn's: a note of its
      // own, never the agent's words (the loop writes it into the reply too, for a client that draws none).
      case "notice":
        noticed = String(e.text || "").trim();
        if (noticed) roundView(rounds.size ? Math.max(...rounds.keys()) : r).notes.append(shimNote(noticed));
        wordsMoved = true;
        break;
      default: {
        const note = noteOf(e);
        if (note) roundView(r).notes.append(h("div", { class: "sav-note" }, note));
        // Any other event may move its round's cards: a compaction, a hook, an ask, its own agents' marks (an event
        // that names no round is its newest round's).
        dirty.add(Number.isInteger(e?.round) ? e.round : rounds.size ? Math.max(...rounds.keys()) : 0);
      }
    }
    schedule();
  };

  const paintEnd = () => {
    // Its pictures and artifacts, where its run's log brought none of them — the log is gone: what the exchange says
    // it drew and published.
    if (o.pictures && followed && (current.drew?.length || current.made?.length)) {
      const { drawn, published } = heard;
      const p = o.pictures;
      place(drewBox, [
        ...(current.drew || []).filter((d) => !drawn.has(d.id)).map((d) => p.kept(d)),
        ...(current.made || []).filter((m) => !published.has(m.name)).map((m) => p.artifact({ id: `made:${m.name}`, name: m.name, v: m.v, title: m.title })),
      ]);
    }
    const ended = current.status !== "running";
    endBox.classList.toggle("hidden", !ended);
    if (!ended) return;
    const tokens = (Number(current.tokensIn) || 0) + (Number(current.tokensOut) || 0);
    const facts = [
      current.ms ? formatWorkedFor(current.ms) : "",
      current.rounds ? `${current.rounds} round${current.rounds === 1 ? "" : "s"}` : "",
      current.toolCalls ? `${current.toolCalls} tool call${current.toolCalls === 1 ? "" : "s"}` : "",
      tokens ? `${fmt.k(tokens)} tokens` : "",
      current.spentUsd ? `$${Number(current.spentUsd).toFixed(current.spentUsd < 0.1 ? 3 : 2)}` : "",
    ].filter(Boolean);
    // The run's last words are its report; drawn here only when no round said them — it was refused before its loop
    // ran (no run), or its run log is gone. Until the run's events are all in, that is not known yet.
    // One its run's log wrote (`fromLog`) is what its rounds show already, where they are shown.
    const said = heard.said || (!!current.fromLog && heard.events > 0);
    const report = current.report && !said && (!runOf(current) || followed) ? h("div", { class: "a-md sav-text" }) : null;
    if (report) setHtml(report, mdChat(current.report || "", null).out);
    // Drawn again at each word of the registry once it ended: in place, its report's links and its failure's buttons
    // the elements under the pointer (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost).
    morphChildren(endBox, [
      report ? (report.setAttribute("data-key", "report"), report) : null,
      h("div", { class: `sav-outcome tone-${statusTone(current.status)}`, "data-key": "outcome" },
        h("span", { class: "sav-dot" }),
        h("b", {}, statusWord(current.status)),
        facts.length ? h("span", {}, facts.join(" · ")) : null),
      current.error ? failureCard(h, failureWords({ error: current.error, failure: current.failure }), { inset: true }) : null]);
  };

  /** What the row under the answer says now: drawn again only when that moves, so a line being written in it stays
   *  through the clock's ticks. */
  let actsKey = "";
  /** "Now" while the main agent is idle: the line its turn starts with, as written so far. @type {string | null} */
  let line = null;
  let passing = false;
  /** @param {"now" | "next"} when @param {string | null} [first]  the line the main agent's turn starts with */
  const pass = async (when, first = null) => {
    passing = true;
    paintActs();
    // Offered only where there is a way on (`paintActs`).
    const way = /** @type {NonNullable<typeof o.onward>} */ (o.onward);
    try {
      const out = await way.send(index, when);
      line = null;
      // Idle, the report waits on the session's queue: the turn this line starts opens with it.
      if (first != null) way.main.start(first);
      else o.toast(sentWords(when, out.into));
    } catch (e) {
      o.toast(String(/** @type {any} */ (e)?.message || e), "err");
    } finally {
      passing = false;
      paintActs();
    }
  };
  /** @param {HTMLElement} anchor */
  const openSend = (anchor) => {
    menu(sendChoices(/** @type {NonNullable<typeof o.onward>} */ (o.onward).main.state()).map((c) => ({
      label: c.label,
      desc: c.desc,
      onClick: () => {
        if (!c.line) return void pass(c.when);
        line = ACT_ON_REPORT;
        paintActs();
      },
    })), { anchor, width: 300 });
  };
  const paintActs = () => {
    const ended = current.status !== "running";
    const outside = ended && current.delivery === "held" && o.onward ? o.onward.main.outside() : null;
    const key = ended ? [current.delivery ?? "", outside || "", current.report ? 1 : 0, line == null ? 0 : 1, passing ? 1 : 0].join("\u0000") : "";
    if (key === actsKey) return;
    actsKey = key;
    actsBox.classList.toggle("hidden", !ended);
    if (!ended) return void actsBox.replaceChildren();
    /** @param {string} words */
    const note = (words) => h("span", { class: "sav-acts-note" }, words);
    const copy = current.report ? button({ label: "Copy", variant: "ghost", size: "sm", title: "Copy the answer", onClick: () => { navigator.clipboard?.writeText(current.report || "").catch(() => {}); } }) : "";
    if (current.delivery !== "held" || !o.onward) return void actsBox.replaceChildren(note(deliveryFact(current.delivery)), copy);
    if (outside) return void actsBox.replaceChildren(note(`${outside} writes this session's turns: copy the answer over to pass it on`), copy);
    if (line != null) {
      const input = /** @type {HTMLInputElement} */ (h("input", { class: "sav-acts-line", type: "text", "aria-label": "Your line to the main agent" }));
      input.value = line;
      input.disabled = passing;
      const go = () => void pass("now", input.value.trim() || ACT_ON_REPORT);
      const drop = () => {
        line = null;
        paintActs();
      };
      input.addEventListener("input", () => { line = input.value; });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          go();
        } else if (e.key === "Escape") {
          e.stopPropagation();
          drop();
        }
      });
      const start = button({ label: "Send", size: "sm", title: "Start the main agent's turn with the report, then this line (Enter)", onClick: go });
      const cancel = button({ label: "Cancel", variant: "ghost", size: "sm", onClick: drop });
      start.toggleAttribute("disabled", passing);
      cancel.toggleAttribute("disabled", passing);
      actsBox.replaceChildren(note("The main agent's turn starts with this answer, then your line:"), input, start, cancel);
      if (!passing) {
        input.focus();
        input.select();
      }
      return;
    }
    const send = button({ label: "Send to main agent", variant: "outline", size: "sm", title: "Hand this answer to the session's main agent: now, or with your next message", onClick: () => openSend(send) });
    send.setAttribute("aria-haspopup", "menu");
    send.append(h("span", { class: "sav-caret", html: ICONS.chevronDown }));
    send.toggleAttribute("disabled", passing);
    actsBox.replaceChildren(note(""), send, copy);
  };

  return {
    el,
    /** Its rounds are shown, or it has none to show; once it is stopped, too. */
    shown,
    /** Who writes the session's turns may have changed: the row under the answer says so. */
    tick: () => paintActs(),
    /** Its run followed from now on, as an exchange not asleep follows it: its thread came near it. */
    wake() {
      if (closed || awake) return;
      awake = true;
      this.update(current);
    },
    /**
     * The exchange as the registry now says: its run is followed once it exists, its end drawn once it ends; the
     * first's context as the agent's read says it (`opening`), drawn once it is known.
     * @param {import("./lib/subagents.js").SubagentExchange} next @param {import("./lib/subagents.js").Opening[]} [opening]
     */
    update(next, opening) {
      // Its end draws its cards once more: an edit's change its record held only once it ended is read then.
      if (current.status === "running" && next.status !== "running") {
        kept.clear();
        for (const r of rounds.keys()) dirty.add(r);
        schedule();
      }
      current = next;
      // No run to follow yet: nothing of its rounds to wait for.
      const run = runOf(next);
      if (!run) landed();
      if (run && !follow && awake) {
        const hears = {
          onRun: heardRun,
          onEvent: (/** @type {any} */ e) => push(e),
          // The words so far, then each piece: drawn with the frame, however many pieces land in it.
          onWords: (/** @type {any} */ w) => {
            words = applyWords(/** @type {any} */ (words), w);
            wordsMoved = true;
            if (replaying) heardAt = Date.now();
            schedule();
          },
        };
        follow = o.follow ? o.follow(hears) : followRun(run, { words: true, ...hears });
        follow.promise.then(() => {
          followed = true;
          endReplay();
          schedule();
          landed();
        });
      }
      o.stick(() => {
        if (index === 0 && opening) paintOpening(opening);
        paintWorking();
        paintEnd();
        paintActs();
      });
    },
    stop() {
      closed = true;
      clearTimeout(replayWait);
      follow?.stop();
      if (frame) cancelAnimationFrame(frame);
      landed();
    },
  };
}

/**
 * One sub-agent's conversation as the parts a host mounts: its head (who, its state, its buttons), its body (every
 * exchange) and its foot (the follow-up). `mount` says where the body scrolls and which element's place in the
 * document means it is still shown; `close` lets go of what it follows.
 * @param {{ chainId: string, id: string, toast: (msg: string, kind?: string) => void, main: MainDoor,
 *   held?: import("./lib/held-asks.js").HeldAsks | null, onAskSelf?: ((tag: string) => void) | null,
 *   answer?: ((id: string, a: import("./conversation/decisions.js").WorkerAnswer) => Promise<boolean>) | null,
 *   always?: ((id: string, offer: any, ask: number | null) => Promise<boolean>) | null }} o
 *   `main`: the session's main agent, for the answers' "Send to main agent"; `held`: where words wait for its answer
 *   that its run could not take while it works; `onAskSelf`: a new thread with the saved agent of this one, for a
 *   thread the main agent asked; `answer` and `always`: a call of its that waits for you, answered in its foot — for a host that draws no strip of its own
 */
export function subagentConversation({ chainId, id, toast, main, held = null, onAskSelf = null, answer = null, always = null }) {
  const routes = subagentRoutes(chainId);
  /** @type {import("./lib/subagents.js").SubagentRow | null} */
  let sa = null;
  /** @type {ReturnType<typeof exchangeView>[]} */
  const views = [];

  const title = h("div", { class: "sav-title" }, "Agent");
  const meta = h("div", { class: "sav-meta" });
  const pill = h("span", { class: "sav-status" });
  /** Its context's gauge while it runs (`paintContext`). */
  const ctx = h("span", { class: "sav-ctx hidden" });
  const stopBtn = button({ label: "Stop", variant: "outline", size: "sm", title: "Stop it now — what it finished is kept as its report", onClick: () => stop() });
  // Run in background (BUG-12's Detach, renamed on the owner's word of 10-27): the main agent waits on a foreground
  // sub-agent; these free it while the sub-agent runs on. The two labels say who gets the report — the whole difference
  // between them (the UI/UX review, 2026-09-30).
  const detachBtn = button({ label: "Run in background — auto-report", variant: "outline", size: "sm", title: "Free the main agent now. This agent keeps running in the background; when it finishes, its report reaches the main agent automatically.", onClick: () => detach(true) });
  const takeBtn = button({ label: "Run in background — report to me", variant: "outline", size: "sm", title: "Free the main agent now. This agent keeps running in the background; its report comes to you instead, and you can send it on to the main agent later.", onClick: () => detach(false) });
  // One on another machine: its chat there, opened as that machine's own page (s2e). What the person sends there is a
  // turn of that chat's as any other: while it runs, a message from here is refused there as busy.
  const thereBtn = button({ label: "Open there", variant: "outline", size: "sm", class: "hidden", onClick: () => openThere() });
  const avatar = h("span", { class: "sav-avatar", html: ICONS.bot });
  /** The face drawn now, so the clock's ticks leave it be. */
  let faceKey = "";
  const head = h("div", { class: "sav-head" },
    avatar,
    h("div", { class: "sav-head-text" }, title, meta),
    // Its state, its context's gauge and what can be done with it: one group, which a narrow head sets under its words.
    h("div", { class: "sav-head-acts" }, pill, ctx, thereBtn, detachBtn, takeBtn, stopBtn));
  const body = h("div", { class: "sav-body" }, h("div", { class: "sav-loading gradient" }, "Loading"));
  /** Its worktree's changes, after the exchanges: the files, the diff on demand, Apply. */
  const workBox = h("section", { class: "sav-work hidden" });
  /** @type {HTMLElement | null} the diff, once asked for (dropped when the work moves) */
  let diffBox = null;
  let applying = false;
  /**
   * Its Apply's dry run, read again as its work moves (the band's, the Designer's of 10-27) — and its place among the
   * reads and refusals, in the order asked (`n`; `gotN` once it answered).
   * @type {{ sig: string, at: number, n: number, got?: any, gotN?: number } | null}
   */
  let preview = null;
  /** Its dry run's read again once it is old, as the band's: the developer's edits in their editor move what it says (the Hunter's of 10-28). @type {any} */
  let previewLater = null;
  /**
   * What its Apply refused, said in place of a toast, and its place: a dry run asked after it says how things are then
   * (the Hunter's of 10-28: a refusal kept Apply locked).
   * @type {{ error: string, conflicts: import("./lib/apply-words.js").Conflict[], n: number } | null}
   */
  let refused = null;
  /** Its reads and refusals, counted in the order they came. */
  let asked = 0;
  /** How Apply works, opened. */
  let howOpen = false;
  /** Its Mark as applied, or the undo of one, under way; and a refusal of either, in its words (10-29). */
  let marking = false;
  /** @type {string | null} */
  let markSaid = null;
  const input = /** @type {HTMLTextAreaElement} */ (h("textarea", { class: "sav-input", rows: "1", "aria-label": "Follow-up" }));
  const send = button({ icon: "arrowUp", size: "icon-sm", title: "Send (Enter)", class: "sav-send", onClick: () => sendFollowUp() });
  /** What was typed while it works, waiting for its answer. */
  const heldEl = h("div", { class: "sav-held hidden", role: "status" });
  /** Why there is no box. */
  const whyEl = h("div", { class: "sav-why hidden" });
  /** A call of its that waits for your answer, where the host answers it here. */
  const askEl = h("div", { class: "sav-asks hidden" });
  /** The call it shows: drawn again only when another waits, so a Deny's half-typed why survives the clock's ticks. */
  let askShown = "";
  const box = h("div", { class: "sav-foot" }, input, send);
  const foot = h("div", { class: "sav-foot-box" }, askEl, heldEl, whyEl, box);
  /** What the two say now: drawn again only when it moves, so a button in them keeps the focus through the clock's ticks. */
  let heldKey = "";
  let whyKey = "";
  const paintHeld = () => {
    const kept = held?.of(chainId, id) || null;
    const name = sa?.card?.name || "it";
    const key = kept ? `${kept.text}\u0000${kept.error || ""}\u0000${name}` : "";
    if (key === heldKey) return;
    heldKey = key;
    heldEl.classList.toggle("hidden", !kept);
    if (!kept) return void heldEl.replaceChildren();
    const again = h("button", { class: "sav-held-btn", type: "button", onclick: () => void held?.settled(chainId, id) }, "Send again");
    const back = h("button", { class: "sav-held-btn", type: "button", title: "Back into the box, to change or drop", onclick: () => {
      const text = held?.take(chainId, id) || "";
      input.value = [text, input.value.trim()].filter(Boolean).join("\n\n");
      input.focus();
    } }, "Take back");
    heldEl.replaceChildren(
      h("span", { class: "sav-held-words", title: kept.text }, kept.text),
      h("span", { class: `sav-held-when${kept.error ? " is-error" : ""}` }, kept.error ? `not sent: ${kept.error}` : `goes when ${name} answers`),
      ...(kept.error ? [again] : []),
      back);
  };
  const offHeld = held ? held.onChange(paintHeld) : () => {};

  /**
   * A picture's ask, or its failure's Tell the agent (HarnessV4_Visuals_Plan VS-D51): into the box beside the picture —
   * this thread's, under what is there, where it has one; else the chat's. Never sent: only the person sends.
   * @param {string} text
   */
  const writeIn = (text) => {
    if (!sa || noBoxWhy(sa)) return main.write(text);
    const had = input.value.replace(/\s+$/, "");
    const from = had ? had.length + 2 : 0;
    input.value = had ? `${had}\n\n${text}` : text;
    input.dispatchEvent(new Event("input"));
    input.focus();
    input.setSelectionRange(from, input.value.length);
  };
  /** Its pictures' cards by their call's id, each made once: its frame is never made twice. @type {Map<string, ReturnType<typeof visualCard>>} */
  const pictures = new Map();
  /** @param {string} vid @param {string} title */
  const pictureOf = (vid, title) => {
    let pic = pictures.get(vid);
    if (!pic) pictures.set(vid, (pic = visualCard({ id: vid, title }, { onAsk: writeIn, onTell: writeIn })));
    return pic;
  };
  /** Its artifacts' cards by their call's id, each made once; one opens in its own side-pane tab. @type {Map<string, HTMLElement>} */
  const published = new Map();
  /** @type {Pictures} */
  const drawn = {
    artifact: (k) => {
      const had = published.get(k.id);
      if (had) return had;
      const card = artifactCard(k, { onOpen: (name) => chipActions.openArtifact?.(name) }).el;
      published.set(k.id, card);
      return card;
    },
    kept: (k) => {
      const pic = pictureOf(k.id, k.title);
      pic.show({ chain: chainId, n: Number.isInteger(k.turn) ? Number(k.turn) : null, session: k.session === true, title: k.title });
      return pic.el;
    },
    writing: (w) => {
      const pic = pictureOf(w.id, w.title);
      pic.writing(w);
      return pic.el;
    },
  };
  /** The head's buttons: each shows only where the sub-agent's state offers it (`paintHead`); Open on where its chat there is (`paintThere`). */
  const actions = [thereBtn, detachBtn, takeBtn, stopBtn];
  /** No sub-agent is shown — not loaded yet, or gone: nothing is offered, and nothing can be asked of it. */
  const offerNothing = () => {
    for (const b of actions) b.classList.add("hidden");
    pill.className = "sav-status hidden";
    ctx.className = "sav-ctx hidden";
    input.disabled = true;
    send.toggleAttribute("disabled", true);
  };
  offerNothing();

  /** @type {ReturnType<typeof setTimeout> | null} */
  let retry = null;
  /**
   * The looks at the registry: one on its way at a time, and one at most behind it (lib/one-behind.js) — each of its
   * messages read the agent whole again, beside the reads still on their way.
   */
  const looks = oneBehind(look);
  /** What waits while the page is out of sight is this thread's look. */
  const lookShown = Symbol("a thread's look");
  /**
   * A look asked by the feed or a timer: out of sight, once as the page shows again (lib/page-shown.js) — a page kept
   * hidden read the agent whole at each of its messages. A thread let go of meanwhile reads nothing.
   */
  const lookWhenShown = () => void whenPageShown(lookShown, () => { if (!closed) void load(); });
  let sending = false;
  const tick = setInterval(() => paintHead(), 1000);
  const offBus = onBus((msg) => {
    if (msg?.type === "subagent" && msg.id === id) lookWhenShown();
    // Its progress as the feed carries it while it runs (HarnessV3-Views V3), between the reads of it whole: what its
    // head's gauge says, and a call of its that waits for you.
    else if (msg?.type === "subagent-progress" && msg.id === id && msg.chainId === chainId && sa && running()) {
      sa.progress = msg.progress || null;
      paintHead();
      paintAsk();
    }
  });
  /** Where the body scrolls. @type {HTMLElement | null} */
  let scroller = null;
  /** Let go of: a read of it still on its way draws nothing when it lands. */
  let closed = false;
  /** How long the next look waits after one Filament could not answer: doubled each time, to LOOK_RETRY_MAX_MS. */
  let failedWait = 0;
  /**
   * The exchanges before the newest, followed only as the place shown comes near them (the owner's of 11-17: a running
   * sub-agent's thread opened at its first exchange, then Loading, and reached its newest seconds later — every
   * exchange's run replayed from its first event at once, the newest's answered last). The newest is followed at once;
   * once its rounds are shown, those near the place shown wake one at a time — one on the screen before one only near
   * it, the nearest the end first —, each once the one before it is shown. A page with no IntersectionObserver follows
   * every exchange at once.
   */
  const canSleep = typeof IntersectionObserver === "function";
  /** Each exchange not followed yet, by its element: its place among the views. @type {Map<Element, number>} */
  const asleep = new Map();
  /** @type {IntersectionObserver | null} */
  let near = null;
  /** One woken, or the newest, is still landing: the next waits for it. */
  let waking = false;
  const watchNear = () => {
    near?.disconnect();
    near = null;
    if (closed || waking || !asleep.size || !scroller) return;
    const root = scroller;
    near = new IntersectionObserver((entries) => {
      // The screen itself, not the screen's height around it that the watch reaches: after a jump up, the exchange in
      // view wakes before those just under it.
      const view = root.getBoundingClientRect();
      let at = -1;
      let seen = -1;
      for (const e of entries) {
        const i = e.isIntersecting ? asleep.get(e.target) ?? -1 : -1;
        if (i < 0) continue;
        at = Math.max(at, i);
        const box = e.boundingClientRect;
        if (box.bottom > view.top && box.top < view.bottom) seen = Math.max(seen, i);
      }
      if (seen >= 0 || at >= 0) wakeNear(seen >= 0 ? seen : at);
    }, { root, rootMargin: "100% 0px" });
    for (const el of asleep.keys()) near.observe(el);
  };
  /** The next is woken once this one's rounds are shown, or once its replay has had its longest hold. @param {ReturnType<typeof exchangeView>} v */
  const landThen = (v) => {
    waking = true;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let most;
    void Promise.race([v.shown, new Promise((resolve) => { most = setTimeout(resolve, REPLAY_MAX_MS); })]).then(() => {
      clearTimeout(most);
      waking = false;
      watchNear();
    });
  };
  /** A word of the watcher that lands after the thread was let go of wakes nothing. @param {number} i */
  const wakeNear = (i) => {
    near?.disconnect();
    near = null;
    const v = views[i];
    if (closed || !v) return;
    asleep.delete(v.el);
    v.wake();
    landThen(v);
  };
  /** None waits to be woken any more: the thread is let go of, or gone. */
  const sleepNoMore = () => {
    near?.disconnect();
    near = null;
    asleep.clear();
  };
  // Its box is let go of too: the Agents tab scrolls every thread in one, and a read of the thread left that landed after
  // the switch put that box at its end, under the thread the person had scrolled up in (the owner's of 11-02).
  const close = () => {
    closed = true;
    scroller = null;
    clearInterval(tick);
    unfollow();
    if (retry) clearTimeout(retry);
    if (previewLater) clearTimeout(previewLater);
    previewLater = null;
    offBus();
    offHeld();
    sleepNoMore();
    for (const v of views) v.stop();
  };

  // The view follows the newest words until the developer scrolls up, and again once they scroll back to the end —
  // judged when they scroll, never after new words have already pushed the end away; a tab switch keeps the place
  // (lib/follow-scroll.js).
  const tail = { following: true };
  let unfollow = () => {};
  /** @param {() => void} fn */
  const stick = (fn) => {
    fn();
    if (tail.following && scroller) scroller.scrollTop = scroller.scrollHeight;
  };

  const running = () => sa?.status === "running";
  // Any agent at work takes your words now, as the main agent does while it works (HarnessV4_Tasks decision 10; the
  // transcript audit, 2026-10-23): it reads them at its next step, and whoever launched it is told — a team's lead, or
  // the main agent. A task's worker too, whose box is else its report's to end.
  const tells = () => running();
  /** Whose agent it is hears what you told it: a team's lead, or the main agent that launched it or runs its task. */
  const toldWho = () => (sa?.team ? "its lead" : sa && (sa.origin === "agent" || sa.task) ? "the main agent" : "");

  function paintHead() {
    if (!sa) return;
    const took = tookOf(sa);
    const seat = seatWords(sa.seat);
    // Its face (U12-D4): as its row in the Sub Agents tab wears it — a team's worker its member's glyph, any other its card's.
    const face = rowIcon(sa);
    if (face !== faceKey) {
      faceKey = face;
      setHtml(avatar, /** @type {any} */ (ICONS)[face] || ICONS.bot);
    }
    // One asked by its tag is its card; one launched is its task, with the card it runs as among its facts. Who
    // started it comes first, and the model says the level it thinks at (HarnessV4_Tasks U12-D8).
    title.textContent = sa.asked ? sa.card.name : sa.description || sa.id;
    // Drawn again every second: its facts and its clock in place, a fact's tooltip under the pointer the one it was.
    morphChildren(meta, [
      ...[
        startedWords(sa),
        sa.asked ? "" : sa.card.name,
        // Where it edits, the folder of its copy on hover; the model with the provider that runs it.
        copyFact(sa) || mayFact(sa),
        modelFact(sa.asked ? prettyModel(sa.model) : sa.model, effortAt(sa.effort), sa.provider),
        // One on another machine (the remote-agents plan's s-ui): which, after its model — its state is the pill's.
        machineWords(sa),
        seat?.from || "",
        // A card sees one of its own views; one asked that runs as a live copy reads as a launched one does.
        sa.asked && sa.view !== "fork" ? seesFact({ view: sa.view, running: sa.running, changes: sa.changes }) : [subagentViewFact(sa.view), handedWords(sa.changes)].filter(Boolean).join(", "),
        sa.memory ? "memory brief" : "",
        sa.origin === "self" ? selfTotal(sa) : "",
        sa.pause && running() ? "the main agent waits for it" : "",
        sa.detached === "report" ? "in the background — its report goes to the main agent" : sa.detached === "aside" ? "in the background — its report comes to you" : sa.aside ? (sa.asked ? answerFact(sa.exchanges) : "reports kept for you") : "",
      ]
        .filter(Boolean)
        .map((t) => (typeof t === "string" ? h("span", {}, t) : h("span", { title: t.title }, t.words))),
      // The rows of the pool its launch passed, each with why (AG-236).
      ...(seat?.skipped || []).map((t) => h("span", { class: "sav-meta-warn" }, t)),
      // Another model than the one it was launched on answered its newest exchange that ended: said as a warning.
      ...[answeredOther(sa)].filter(Boolean).map((t) => h("span", { class: "sav-meta-warn" }, t))]);
    pill.className = `sav-status tone-${statusTone(sa.status)}`;
    morphChildren(pill, [h("span", { class: "sav-dot" }), statusWord(sa.status), took ? h("span", { class: "sav-elapsed" }, took) : null]);
    // What its context holds as it works, and where it compacts: its gauge, beside its state.
    paintContext(ctx, running() ? sa.progress : null);
    stopBtn.classList.toggle("hidden", !running());
    paintThere();
    // Only a launch the main agent is waiting on can be detached: the agent's own, in the foreground, still running.
    const detachable = running() && !sa.background && sa.origin === "agent";
    detachBtn.classList.toggle("hidden", !detachable);
    takeBtn.classList.toggle("hidden", !detachable);
    // A thread that is not yours to continue (HarnessV4_Tasks E15 AG-54, AG-105) — a saved agent the main agent
    // asked, which it asks again by itself; a task of the task graph, which its report ends — says why where its box
    // would stand, with the way to ask that agent yourself.
    const no = tells() ? null : noBoxWhy(sa);
    foot.classList.remove("hidden");
    box.classList.toggle("hidden", !!no);
    whyEl.classList.toggle("hidden", !no);
    const key = no ? `${no.words}\u0000${no.ask || ""}` : "";
    if (key !== whyKey) {
      whyKey = key;
      const ask = no?.ask;
      const name = sa.card.name;
      whyEl.replaceChildren(...(no ? [h("span", {}, no.words)] : []), ...(ask && onAskSelf ? [h("button", { class: "sav-why-btn", type: "button", title: `A new thread with ${name}`, onclick: () => onAskSelf(ask) }, `@${ask}`)] : []));
    }
    input.disabled = sending;
    send.toggleAttribute("disabled", sending);
    // One its session gave back holds no conversation of its own: the box says what the next message starts.
    const how = sa.restored ? ": it starts fresh, and reads this thread first" : null;
    const who = toldWho();
    input.placeholder = tells()
      ? `Working: what you write reaches it at its next step${who ? `, and ${who} is told` : ""}`
      : sa.asked
      ? `Ask ${sa.card.name} again${how ?? ": the same thread, told what happened since"}`
      : `Ask ${sa.description ? `“${sa.description}”` : sa.id} more${how ?? ", in the context it already has"}`;
    paintAsk();
    paintHeld();
    for (const v of views) v.tick();
  }

  /**
   * A call of its that waits for your answer, answered in its foot where the host gives the way (the thread beside the
   * chat; the Agents tab draws its own strip): as the chat's dock answers the main agent's — Allow, Deny with why,
   * Always allow (the transcript audit, 2026-10-23).
   */
  function paintAsk() {
    const asking = answer && always && sa && running() ? yourAsk(sa.progress) : null;
    const key = asking ? answersKey(asking) : "";
    if (key === askShown) return;
    askShown = key;
    askEl.classList.toggle("hidden", !asking);
    if (!asking || !sa || !answer || !always) return void askEl.replaceChildren();
    const w = askWords(asking);
    const name = sa.card?.name || "It";
    askEl.replaceChildren(h("div", { class: "ask-strip", role: "group", "aria-label": `${name} asks you` },
      h("span", { class: "ask-who-name" }, name),
      askWhat(h, asking, w.verb),
      w.what ? h("code", { class: "ask-cmd", title: w.whole }, w.what) : null,
      answerControls(h, { id: sa.id, who: name, n: asking.n, offer: /** @type {any} */ (asking.offer) || null, answer, always, ...questionOf(asking) }).el));
  }

  /** The agent read again: whoever awaits it has a look that started after the ask. */
  function load() {
    return looks.ask();
  }

  async function look() {
    /** @type {import("./lib/subagents.js").SubagentRow} */
    let next;
    try {
      next = await routes.detail(id);
    } catch (e) {
      if (closed) return;
      if (retry) clearTimeout(retry);
      retry = null;
      // Filament could not say now — busy, or the connection dropped (the owner's logs of 11-01: it said "gone" while
      // Filament stalled): what is shown stays, and it is asked again, later each time. Only a 404 says it is gone.
      if (/** @type {any} */ (e)?.status !== 404) {
        failedWait = Math.min(LOOK_RETRY_MAX_MS, failedWait ? failedWait * 2 : LOOK_RETRY_MS);
        retry = setTimeout(lookWhenShown, failedWait);
        return;
      }
      // Gone with what it could be asked: its state, its buttons and its follow-up leave with its conversation.
      sa = null;
      for (const v of views.splice(0)) v.stop();
      offerNothing();
      foot.classList.add("hidden");
      body.replaceChildren(h("div", { class: "sav-empty" }, `This thread is gone: ${/** @type {any} */ (e)?.message || e}. It was deleted, or it was older than the newest 30 a session keeps — one whose work waits for your Apply is always kept.`));
      sleepNoMore();
      return;
    }
    // Drawn wherever its place stands: an answer dropped while the place was off the page (a pane's tile moved, the tab
    // put away) left it on Loading for good, nothing asking again (the owner's logs of 11-01).
    if (closed || !next) return;
    failedWait = 0;
    const moved = JSON.stringify(sa?.work || null) !== JSON.stringify(next.work || null);
    sa = next;
    const first = !views.length;
    if (first) body.replaceChildren(workBox);
    const opening = sa.opening || [];
    const newest = sa.exchanges.length - 1;
    sa.exchanges.forEach((ex, i) => {
      if (!views[i]) {
        // Opened, the thread follows its newest exchange, and any still running; the rest as it comes near them.
        const sleeps = canSleep && first && i < newest && ex.status !== "running" && !!runOf(ex);
        const v = exchangeView(ex, i, { stick, asleep: sleeps, label: askedWords(sa, i, ex), onward: { main, send: passOn }, toast, pictures: drawn, at: { chain: chainId, agent: id, there: thereCards } });
        views.push(v);
        if (sleeps) asleep.set(v.el, i);
        stick(() => body.insertBefore(v.el, workBox));
      }
      views[i].update(ex, opening);
    });
    if (first && asleep.size) landThen(views[newest]);
    if (moved) diffBox = null;
    paintHead();
    paintWork();
    // It has answered: what was held for it goes, as its next message.
    if (sa.status !== "running") void held?.settled(chainId, id);
    if (retry) clearTimeout(retry);
    const last = sa.exchanges.at(-1);
    retry = last && last.status === "running" && !runOf(last) ? setTimeout(lookWhenShown, STARTING_RETRY_MS) : null;
  }

  /** The machine its calls ran on, for its cards (tools/layout.js `There`): null for one of this computer's. */
  const thereCards = () => (sa?.machine ? { id: String(sa.machine.id), name: String(sa.machine.name), chat: sa.remote?.chat ? String(sa.remote.chat) : null } : null);
  /** Its machine and its chat there, where the page can open that machine's: none before its chat there is made. */
  const thereOf = () => (sa?.machine && sa.remote?.chat && chipActions.openOnMachine ? { machine: sa.machine, chat: sa.remote.chat } : null);
  /** Open on <machine>, where its chat there can be opened. */
  function paintThere() {
    const at = thereOf();
    thereBtn.classList.toggle("hidden", !at);
    if (!at) return;
    const label = `Open on ${at.machine.name}`;
    const words = /** @type {HTMLElement} */ (thereBtn.querySelector(".zc-btn-label"));
    if (words.textContent !== label) words.textContent = label;
    thereBtn.title = `Its chat on ${at.machine.name}, as that machine shows it. A message you send there is a turn of that chat's, and while one runs there a message from here is refused as busy.`;
  }
  function openThere() {
    const at = thereOf();
    if (at) chipActions.openOnMachine?.(at.machine, at.chat);
  }

  async function stop() {
    try {
      await routes.stop(id);
      toast("Stopping it — what it finished is kept as its report");
    } catch (e) {
      toast(String(/** @type {any} */ (e)?.message || e), "err");
    }
  }

  /** @param {boolean} report */
  async function detach(report) {
    try {
      await routes.detach(id, report);
      toast(report ? "In the background now — the main agent carries on; this agent keeps running and its report reaches the main agent when it finishes (the turn waits for that report before it ends)" : "In the background now — the main agent carries on; this agent keeps running and its report comes to you");
      load();
    } catch (e) {
      toast(String(/** @type {any} */ (e)?.message || e), "err");
    }
  }

  /**
   * Where its own worktree's work stands, once it is idle: waiting — why it waits, what Apply would do from its dry run
   * or what stops it, the files, the diff on demand, Apply and How Apply works, as the agents band says them (the
   * Designer's of 10-27); applied — the result line, in place of a toast —; nothing changed; or why it worked in the
   * session's folder after all. The head holds no second Apply.
   */
  function paintWork() {
    const w = sa?.work || null;
    const shares = sa?.shares || null;
    if (!sa || running() || (!w && !shares)) {
      workBox.classList.add("hidden");
      return;
    }
    workBox.classList.remove("hidden");
    // Changes waiting for Apply are the thread's card in green (HarnessV4_Tasks U12-D8) — not while they wait for its
    // rebase, which is its own next (the Hunter's of 10-28).
    workBox.classList.toggle("is-ready", !!w && !w.error && w.pending > 0 && !sa.rebaseDue);
    // Drawn again at each look at the agent and at each dry run of its Apply: in place, each part keyed by what it is,
    // so Apply, the diff's button and How Apply works stay the elements under the pointer (the owner's of 11-01:
    // buttons blinking under a resting pointer, clicks lost).
    /** @param {any[]} parts */
    const draw = (parts) => morphChildren(workBox, parts);
    const label = h("div", { class: "sav-label", "data-key": "label" }, "Changes");
    /** @param {string} text @param {string} [key] */
    const note = (text, key = "note") => h("p", { class: "sav-work-note", "data-key": key }, text);
    /** A button of the box, keyed by what it does. @param {any} b @param {string} key */
    const keyed = (b, key) => (b.setAttribute("data-key", key), b);
    if (w?.pending && sa.rebaseDue) return void draw([label, note(REBASE_DUE_NOTE)]);
    if (!w) return void draw([label, note(`It worked in the session's folder — no worktree (${shares}) — so its changes are there already.`)]);
    if (w.error) return void draw([label, note(`Its work could not be captured (${w.error}); its worktree folder is kept.`)]);
    const said = markSaid ? [h("p", { class: "sav-work-last", "data-key": "said" }, markSaid)] : [];
    // What stayed in its copy on another machine, never brought here: by why, count and name.
    const stayed = w.left?.length ? [note(leftNote(w.left, sa.machine?.name || null), "left")] : [];
    if (!w.pending) {
      const last = w.lastApplied || null;
      // A mark as applied can be undone while nothing of its work came since: its changes then wait for Apply again.
      const undo = last?.undo ? [h("div", { class: "sav-work-actions", "data-key": "acts" }, keyed(button({ label: marking ? "Undoing…" : "Undo", variant: "ghost", size: "sm", title: "Its changes wait for your Apply again", disabled: marking, onClick: () => unmarkWork() }), "undo"))] : [];
      return void draw([label,
        note(last ? resultLine({ at: last.at, by: last.by, reason: last.reason || null, files: last.files, came: last.came || null, hand: !!last.hand }, clockOf) : w.applied ? "Its changes were applied to the session's folder." : nothingWords({ there: !!w.there, machine: sa.machine?.name || null, left: w.left || null })),
        ...stayed, ...undo, ...said]);
    }
    const sig = `${w.sig || ""}:${w.pending}:${w.added}:${w.removed}:${w.applied}`;
    if (!preview || preview.sig !== sig || (preview.gotN !== undefined && Date.now() - preview.at > PREVIEW_MS)) {
      // The same work read again: its last answer stays on show until the new one comes.
      const same = preview?.sig === sig ? preview : null;
      /** @type {{ sig: string, at: number, n: number, got?: any, gotN?: number }} */
      const entry = { sig, at: Date.now(), n: ++asked, ...(same ? { got: same.got, gotN: same.gotN } : {}) };
      preview = entry;
      routes.preview(id).then((got) => { entry.got = got; }, (e) => { entry.got = { error: String(e?.message || e) }; }).finally(() => {
        entry.gotN = entry.n;
        if (preview !== entry) return;
        paintWork();
        if (previewLater) return;
        previewLater = setTimeout(() => {
          previewLater = null;
          if (workBox.isConnected) paintWork();
        }, PREVIEW_MS + 50);
        previewLater?.unref?.();
      });
    }
    const got = preview.got;
    const fresh = !!got && !got.error && (!refused || (preview.gotN || 0) > refused.n);
    /** @type {import("./lib/apply-words.js").Conflict[]} */
    const conflicts = fresh ? got.conflicts || [] : refused?.conflicts?.length ? refused.conflicts : got?.conflicts || [];
    const effect = refused && !fresh && !refused.conflicts?.length ? refused.error : !got ? "Checking what Apply would do…" : got.error ? `Apply can't be checked now: ${got.error}` : effectLine({ folder: got.repo || got.folder || "your folder", came: got.came || [], conflicts, pressed: !!refused && !fresh });
    const showDiff = keyed(button({ label: diffBox ? "Hide the diff" : "Show the diff", variant: "ghost", size: "sm", onClick: () => toggleDiff() }), "diff");
    const apply = keyed(button({ label: applying ? "Applying…" : `Apply ${w.pending} file${w.pending === 1 ? "" : "s"}`, size: "sm", onClick: () => applyWork() }), "apply");
    apply.toggleAttribute("disabled", applying || marking || conflicts.length > 0 || !got || !!got.error);
    // Mark as applied (10-29): its change reached the folder some other way. None for a graph task's sub-agent: its task
    // reads an apply as its change merged, before a restart or after, and Apply tells it so.
    const mark = sa.task ? null : keyed(button({ label: marking ? "Marking…" : "Mark as applied", variant: "ghost", size: "sm", title: "Its changes are in your folder already: they stop waiting, and nothing is written. You can undo it.", disabled: applying || marking, onClick: () => markWork() }), "mark");
    const how = h("button", { class: "sav-how-btn", type: "button", "data-key": "how", "aria-expanded": String(howOpen), onclick: () => { howOpen = !howOpen; paintWork(); } }, "How Apply works");
    workBox.classList.toggle("is-stuck", conflicts.length > 0);
    draw([
      label,
      note(`${WHY_WAITS} ${w.pending} file${w.pending === 1 ? "" : "s"}, +${w.added} −${w.removed}.`),
      h("p", { class: "sav-work-effect", "data-key": "effect" }, effect),
      // A refusal the dry run after it has overtaken: still said, Apply not locked by it.
      ...(refused && fresh ? [h("p", { class: "sav-work-last", "data-key": "refused" }, `Your last Apply: ${refused.error}`)] : []),
      ...(conflicts.length
        ? [
            h("ul", { class: "sav-conflicts", "data-key": "conflicts" }, ...conflicts.map((c) => h("li", {}, h("b", {}, leaf(c.path)), ` — ${kindWords(c)}`, h("span", { class: "sav-cpath" }, c.path)))),
            note("Choose for each file — keep yours, take its, or both with markers — or send it back to rebase, from its row in Changes.", "choose"),
          ]
        : []),
      h("div", { class: "sav-files", "data-key": "files" },
        ...w.files.map((f) => h("div", { class: "sav-file" },
          h("span", { class: `sav-file-status s-${f.status}` }, FILE_STATUS[f.status] || f.status),
          h("code", { class: "sav-file-path" }, f.path),
          h("span", { class: "sav-file-n" }, f.binary ? "binary" : `+${f.added} −${f.removed}`))),
        w.pending > w.files.length ? h("div", { class: "sav-work-note" }, `… and ${w.pending - w.files.length} more`) : null),
      ...stayed,
      h("div", { class: "sav-work-actions", "data-key": "acts" }, how, showDiff, mark, apply),
      ...said,
      ...(howOpen ? [h("ol", { class: "sav-how", "data-key": "how" }, ...howApplyWorks(got?.folder || w.folder || null).map((t) => h("li", {}, t)))] : []),
      // The diff, made once a press asks for it, comes in as itself.
      diffBox]);
  }

  async function toggleDiff() {
    if (diffBox) {
      diffBox = null;
      return paintWork();
    }
    try {
      const c = await routes.changes(id);
      diffBox = c.diff ? diffEl(c.diff) : h("p", { class: "sav-work-note" }, "No diff to show.");
    } catch (e) {
      diffBox = h("p", { class: "sav-error" }, String(/** @type {any} */ (e)?.message || e));
    }
    paintWork();
  }

  /** Its worktree's changes into the session's folder, all or nothing: what it did, or what stopped it, said in place. */
  async function applyWork() {
    if (applying || marking) return;
    applying = true;
    refused = null;
    // A mark's refusal said before is the thread's past: the Apply says what it did now.
    markSaid = null;
    paintHead();
    paintWork();
    try {
      await routes.apply(id);
    } catch (e) {
      refused = { error: applyFailure(e), conflicts: /** @type {any} */ (e)?.body?.conflicts || [], n: ++asked };
    } finally {
      applying = false;
      preview = null;
      await load();
    }
  }

  /** Mark as applied: its changes are in the folder already, so they wait no more; nothing is written. */
  function markWork() {
    return markOrUndo(() => routes.markApplied(id), "It couldn't be marked as applied");
  }

  /** Undo a mark as applied: its changes wait for Apply again. */
  function unmarkWork() {
    return markOrUndo(() => routes.unmarkApplied(id), "Its mark couldn't be undone");
  }

  /**
   * A mark, or its undo, then the thread read again; a refusal said in place, as Apply's is.
   * @param {() => Promise<unknown>} act @param {string} failed
   */
  async function markOrUndo(act, failed) {
    if (marking || applying) return;
    marking = true;
    markSaid = null;
    paintWork();
    try {
      await act();
      refused = null;
    } catch (e) {
      markSaid = `${failed}: ${String(/** @type {any} */ (e)?.message || e)}`;
    } finally {
      marking = false;
      preview = null;
      await load();
    }
  }

  /**
   * An answer kept with the developer goes to the main agent: into its work now, or with their next message.
   * @param {number} exchange @param {"now" | "next"} when
   */
  async function passOn(exchange, when) {
    const out = await routes.send(id, exchange, when);
    await load();
    return out;
  }

  async function sendFollowUp() {
    const text = input.value.trim();
    if (!text || sending) return;
    if (tells()) return void tellNow(text);
    sending = true;
    paintHead();
    try {
      await routes.followUp(id, text);
      input.value = "";
      input.style.height = "";
      tail.following = true;
      await load();
    } catch (e) {
      toast(String(/** @type {any} */ (e)?.message || e), "err");
    } finally {
      sending = false;
      paintHead();
    }
  }

  /**
   * Your words into a working agent's run now, whoever launched it told (decision 10). Refused while its run cannot
   * take them (Filament runs its check of its report), they wait for its answer where they can be held; else they
   * stay in the box.
   * @param {string} text
   */
  async function tellNow(text) {
    sending = true;
    paintHead();
    try {
      const out = await routes.message(id, text);
      input.value = "";
      input.style.height = "";
      tail.following = true;
      toast(toldWords(sa, out));
      await load();
    } catch (e) {
      const why = String(/** @type {any} */ (e)?.message || e);
      if (held && running()) {
        held.hold(chainId, id, text);
        input.value = "";
        input.style.height = "";
        toast(`${why} — your words go when it answers`);
      } else toast(why, "err");
    } finally {
      sending = false;
      paintHead();
    }
  }

  input.addEventListener("keydown", (e) => {
    // An input method's Enter ends its word (Chinese, Japanese): it never sends (HC-117).
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      sendFollowUp();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  });

  return {
    head,
    body,
    foot,
    /** @param {HTMLElement} scrolls  where the body scrolls */
    mount(scrolls) {
      scroller = scrolls;
      unfollow();
      unfollow = followScroll(scrolls, tail);
      // Those waiting to be woken are watched in the new place.
      watchNear();
      load();
    },
    close,
    /** The follow-up box takes the keys: Ask again. */
    focusFollowUp() { input.focus(); },
  };
}

/** A thread whose turn's record is kept no longer. */
const GUEST_GONE = "The record of the turn this agent worked in is kept no longer, and its thread went with it.";
/** A thread its turn's record says nothing of. */
const GUEST_UNTOLD = "The turn's record says nothing of this agent.";

/**
 * One of a coding agent's own agents as the parts a host mounts (HarnessV4_Tasks E15 step 5, AG-153): an agent Filament
 * did not launch, whose thread is read out of its turn's run as that run is followed (lib/guest-thread.js) — whole
 * for a turn that ended, live for one that runs — and drawn by the part that draws any agent's exchange. It is its
 * coding agent's to continue and to stop (AG-155), and it works in that agent's folder: no box, no Apply, no Stop and
 * no Send. The foot says whose it is; Copy stays under its answer.
 * @param {{ id: string, toast: (msg: string, kind?: string) => void, follow?: typeof followRun }} o
 *   `id`: its thread's id, its turn's run and its card there; `follow`: the tests' seam for the run's stream
 */
export function guestConversation({ id, toast, follow = followRun }) {
  const at = guestOf(id) || { run: "", stub: "" };
  const thread = guestThread(at.stub);
  const title = h("div", { class: "sav-title" }, "Agent");
  const meta = h("div", { class: "sav-meta" });
  const pill = h("span", { class: "sav-status hidden" });
  const head = h("div", { class: "sav-head" }, h("span", { class: "sav-avatar is-own", html: ICONS.bot }), h("div", { class: "sav-head-text" }, title, meta), pill);
  const body = h("div", { class: "sav-body" }, h("div", { class: "sav-loading gradient" }, "Loading"));
  const whyEl = h("div", { class: "sav-why" });
  const foot = h("div", { class: "sav-foot-box hidden" }, whyEl);
  /** Its one exchange, drawn once its run says it began. @type {ReturnType<typeof exchangeView> | null} */
  let view = null;
  /** That exchange's ears: its rounds are handed to them as the run tells them. @type {{ onEvent: (e: any) => void, onWords: (frame: any) => void } | null} */
  let hears = null;
  /** @type {ReturnType<typeof followRun> | null} */
  let follower = null;
  let missing = false;
  /** @type {HTMLElement | null} */
  let scroller = null;
  const tail = { following: true };
  let unfollow = () => {};
  /** @param {() => void} fn */
  const stick = (fn) => {
    fn();
    if (tail.following && scroller) scroller.scrollTop = scroller.scrollHeight;
  };

  /** @returns {import("./lib/subagents.js").SubagentExchange} */
  const exchange = () => {
    const f = thread.facts();
    return {
      prompt: f.prompt || f.description,
      description: f.description,
      by: "agent",
      runId: at.run,
      status: f.status,
      startedAt: f.startedAt,
      endedAt: f.endedAt,
      // Its answer is the result of the call that began it.
      delivery: "tool",
      report: f.report,
      error: f.error || null,
      toolCalls: f.toolCalls,
      ...(f.ms != null ? { ms: f.ms } : {}),
    };
  };

  let whyKey = "";
  const paintHead = () => {
    const f = thread.facts();
    if (!f.known) return;
    const running = f.status === "running";
    title.textContent = f.description || "Agent";
    // Drawn again every second: its facts and its clock in place.
    morphChildren(meta, [`${guestOwner(f.of)}'s own`, f.agent, f.model, f.tokens ? `${fmt.k(f.tokens)} tokens` : "", f.toolCalls ? `${f.toolCalls} call${f.toolCalls === 1 ? "" : "s"}` : ""].filter(Boolean).map((t) => h("span", {}, t)));
    const took = running ? formatWorkedFor(Math.max(0, Date.now() - f.startedAt)) : f.ms != null ? formatWorkedFor(f.ms) : "";
    pill.className = `sav-status tone-${statusTone(f.status)}`;
    morphChildren(pill, [h("span", { class: "sav-dot" }), statusWord(f.status), took ? h("span", { class: "sav-elapsed" }, took) : null]);
    foot.classList.remove("hidden");
    const why = guestWhy(f.of, running);
    if (why !== whyKey) {
      whyKey = why;
      whyEl.replaceChildren(h("span", {}, why));
    }
  };

  /** How it stands, as far as its head and its exchange's end read it: they are drawn again when this moves. */
  let stood = "";
  /** What the run said of it since: its rounds to the exchange, then how it stands now. @param {import("./lib/guest-thread.js").ThreadItem[]} items */
  const feed = (items) => {
    const f = thread.facts();
    if (!f.known) return;
    if (!view) {
      view = exchangeView(exchange(), 0, {
        stick,
        label: `${guestOwner(f.of)} asked`,
        onward: null,
        toast,
        follow: (ears) => {
          hears = ears;
          return { promise: /** @type {NonNullable<typeof follower>} */ (follower).promise, stop: () => {} };
        },
      });
      body.replaceChildren(view.el);
      view.update(exchange());
    }
    for (const it of items) {
      if ("words" in it) hears?.onWords(it.words);
      else hears?.onEvent(it.event);
    }
    const now = `${f.status}\u0000${f.toolCalls}\u0000${f.model}\u0000${f.tokens}`;
    if (now === stood) return;
    stood = now;
    view.update(exchange());
    paintHead();
  };

  const tick = setInterval(paintHead, 1000);

  return {
    head,
    body,
    foot,
    /** @param {HTMLElement} scrolls  where the body scrolls */
    mount(scrolls) {
      scroller = scrolls;
      unfollow();
      unfollow = followScroll(scrolls, tail);
      follower = follow(at.run, {
        onRun: (run) => thread.run(run),
        onEvent: (e) => feed(thread.take(e)),
        onRunEnd: (status) => feed(thread.over(status)),
        onMissing: () => {
          missing = true;
        },
      });
      // The run's whole word is in, and it told of no such agent: its record is gone, or names none here.
      follower.promise.then(() => {
        if (!thread.facts().known) body.replaceChildren(h("div", { class: "sav-empty" }, missing ? GUEST_GONE : GUEST_UNTOLD));
      });
    },
    close() {
      // Its box is let go of with it: another thread scrolls in it next.
      scroller = null;
      clearInterval(tick);
      unfollow();
      follower?.stop();
      view?.stop();
    },
  };
}
