// @ts-check
// How fast the model writes (HarnessV3-AtHome AH-S1, built with HarnessV3-ACP AC3-5: "speed from the stream's timing,
// for every agent"). Everything the reply streams — its words, its thinking, and the input of the calls it writes (the
// loop's `round-writing`) — as characters, about four to a token: the rule the server's live records count by
// (services/records.js rateNow). While the reply writes, its rate over the last few seconds; once the stream stops (a
// tool runs, the agent waits, the reply ends), the reply's average over the time it was writing. Where the turn's run
// says a round's tools start, or its next round, the writing has stopped (`pause`): neither the time before the next
// words nor those words are writing, so a turn's tool calls never drag its speed down. Inside a reply a gap is writing
// up to PAUSE_MS: a provider may hold the words back and send them in bursts — and the reply is still writing between
// them, so the rate stands until the next comes.
//
// The figure shown (`shown`) follows the measure, easing toward it over about EASE_MS (the owner's word of 10-27: "this
// should update in a normalized interpolated manner and not like some jerky snapping numbers"): the page reads it a
// few times a second while the reply runs, so it glides between the stream's pieces.
//
// Where the run says what a round wrote as its provider counted it, and how long it wrote (`round-written`, `wrote`),
// that count is the figure: a round that thinks where the stream shows none of it, or writes a call's input, writes
// all the same. The words streamed since the last count are still the estimate's, until their round's count comes.

/** A gap inside a reply longer than this (ms) is a pause, not writing. Z.AI sends GLM's words in bursts some two
 *  seconds apart, every one of them written in the gap before it. */
export const PAUSE_MS = 4000;
/** The live rate's window (ms): long enough to hold two of a provider's bursts. */
export const RATE_MS = 3000;
/** The least writing (ms) a rate is said for: a shorter stretch is noise. */
export const LEAST_MS = 250;
/** How quickly the shown figure follows the measure (ms): in this time it covers about two thirds of a change. */
export const EASE_MS = 700;

/**
 * What the speed gauge shows. `rate`: tokens a second over the last few seconds of the stream, while it writes (null
 * once it stops, or before a quarter second of it); `average`: the reply's own, over the time it was writing (null until
 * a quarter second of it); `shown`: the figure the gauge draws — the rate while it writes, else the average — eased
 * toward as time passes, never snapped; `tokens`: written so far; `writingMs`: the time it was writing; `settled`: the
 * reply ended — the figure is no longer the running reply's.
 * @typedef {{ live: boolean, rate: number | null, average: number | null, shown: number | null, tokens: number, writingMs: number, settled: boolean }} SpeedFigure
 */

/** Characters as tokens, the stream's rule of thumb. @param {number} chars */
const asTokens = (chars) => chars / 4;

/**
 * One reply's speed: fed the reply's whole length each time it grows, told where its writing stopped, read at any
 * moment.
 * @returns {{ sample: (at: number, total: number) => void, pause: () => void, wrote: (tokens: number, ms: number | null) => void,
 *   read: (now: number) => SpeedFigure, settle: () => SpeedFigure | null }}
 */
export function createSpeedMeter() {
  /** The stream since its last pause, oldest first, as [at, chars] — no more than the live window needs. @type {[number, number][]} */
  let burst = [];
  let writingMs = 0;
  let writtenChars = 0;
  let chars = 0;
  // The rounds' own counts (`wrote`): every token they wrote, those of the rounds whose writing time is known, that time,
  // and how much of the stream they cover.
  let counted = 0;
  let timedTokens = 0;
  let timedMs = 0;
  let countedChars = 0;
  // The figure drawn, and when it was last read: it eases from there toward the measure.
  /** @type {number | null} */
  let shown = null;
  let shownAt = 0;

  /** @param {number} now @returns {SpeedFigure} */
  const read = (now) => {
    const last = burst[burst.length - 1];
    const first = burst[0];
    // Writing now: output within a pause's length, over a stretch long enough to say a rate for.
    const span = last && first ? last[0] - first[0] : 0;
    const live = !!last && now - last[0] <= PAUSE_MS && span >= LEAST_MS;
    const timed = timedMs >= LEAST_MS;
    const rate = live ? asTokens(last[1] - first[1]) / (span / 1000) : null;
    const average = timed ? timedTokens / (timedMs / 1000) : writingMs >= LEAST_MS ? asTokens(writtenChars) / (writingMs / 1000) : null;
    const target = rate ?? average;
    if (target == null) shown = null;
    else if (shown == null || !Number.isFinite(now)) shown = target;
    else shown += (target - shown) * (1 - Math.exp(-Math.max(0, now - shownAt) / EASE_MS));
    shownAt = Number.isFinite(now) ? Math.max(shownAt, now) : shownAt;
    return {
      live,
      rate,
      average,
      shown,
      tokens: Math.round(counted + asTokens(Math.max(0, chars - countedChars))),
      writingMs: timed ? timedMs : writingMs,
      settled: false,
    };
  };

  return {
    sample(at, total) {
      if (total <= chars) return; // nothing new: a redraw of what was there
      const last = burst[burst.length - 1];
      chars = total;
      if (!last || at - last[0] > PAUSE_MS) {
        // The first words, or the first after a pause: they start a stretch, and the time before them was no writing.
        burst = [[at, total]];
        return;
      }
      writingMs += at - last[0];
      writtenChars += total - last[1];
      burst.push([at, total]);
      // The newest sample at least a window older than this one stays, as the window's start: the older go.
      while (burst.length > 2 && at - burst[1][0] >= RATE_MS) burst.shift();
    },
    /** The writing stopped (a round's tools start, or its next round): the next words start a stretch of their own. */
    pause() {
      burst = [];
    },
    /** A round's count: the tokens it wrote, and the time it wrote them (null where too short to rate). */
    wrote(tokens, ms) {
      if (!(tokens > 0)) return;
      counted += tokens;
      countedChars = chars;
      if (ms != null && ms > 0) {
        timedTokens += tokens;
        timedMs += ms;
      }
    },
    read,
    /** The reply ended: its average from now on, or null when it wrote too little to say one. */
    settle() {
      const r = read(Infinity);
      return r.average == null ? null : { ...r, settled: true };
    },
  };
}

/**
 * Whether a live turn's event stops the writing, so the gauge's next words start a stretch of their own: a round's tools
 * start, its next round starts, or the turn waits — between a call's tries, for a slot, for an answer (the Hunter's find
 * of 10-27: the wait before a try asked again was counted as writing time). @param {any} e
 */
export const pausesWriting = (e) => e?.type === "tool-start" || e?.type === "round-start" || (e?.type === "turn-state" && e.to === "waiting");

/** The gauge's number: whole tokens a second, to a tenth below ten. @param {number} rate */
export const speedNumber = (rate) => (rate < 10 ? (Math.round(rate * 10) / 10).toFixed(1).replace(/\.0$/, "") : String(Math.round(rate)));

/** The gauge's figure in words, "42 tok/s". @param {number} rate */
export const speedWords = (rate) => `${speedNumber(rate)} tok/s`;
