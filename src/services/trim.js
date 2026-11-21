// The slice pass (model calls, the slice cache, the hollow-summary retry): a summary of a conversation too big for one
// call of its writer, read in sequential slices. The maths it runs on — sizing slices, picking them, the prompts — is
// core/trim.js, pure, and is re-exported here; the design notes are at its top.
import {
  DIGEST_PROMPT,
  MAX_HOLLOW_RETRIES,
  carriedPrefix,
  estTokens,
  joinSlices,
  normalizeTrimPolicy,
  partsOfTurn,
  percentOf,
  pickSlice,
  pieceChars,
  renderMessages,
  sliceKey,
  sliceRoom,
  summaryFloor,
  trimPrompt,
  turnGroups,
  wordsInPieces,
} from "../core/trim.js";
export * from "../core/trim.js";

// ---- the slice pass ---------------------------------------------------------------------------------------
// The compactor's summary when a head of turns outgrows one call: the groups summarized oldest
// first, each slice as much as fits the summarizer's room with the summaries so far carried ahead of it, the carried
// summaries re-compressed into one rolling digest past `digestCapFraction`, a hollow reply retried on a smaller slice,
// every good slice cached by its content. `notes` is the caller's list, extended in place. The caller joins what the
// pass wrote into one summary text (`joinSlices`).
/**
 * @param {{ groups: { from: number, to: number }[], rendered: string[], tokens: number[],
 *   policy: ReturnType<typeof normalizeTrimPolicy>, room: ReturnType<typeof sliceRoom>,
 *   callModel: import("../core/ports.js").Summarizer, cache?: import("../core/ports.js").SliceCache | null,
 *   onProgress?: import("../core/ports.js").ProgressSink, signal?: AbortSignal | null, model?: string, notes: string[] }} a
 *   `model` names the writer on each cached slice.
 */
export async function sliceSummaries({ groups: given, rendered, tokens, policy: P, room, callModel, cache = null, onProgress = () => {}, signal = null, model = "", notes }) {
  /** The number of a rendered entry, counted from 1. @param {number} i */
  const msgNo = (i) => i + 1;
  // The pass's own list: a group bigger than one slice is cut as it is read (`pickSlice`'s `rest`).
  const groups = given.slice();
  const reserve = room.reserve;
  const summaryTokens = room.summaryTokens;
  const words = room.words;
  const aborted = () => !!signal?.aborted;
  const slices = [];
  let digest = null,
    digestTokens = 0,
    gi = 0,
    calls = 0,
    cachedHits = 0,
    recompactions = 0,
    mechanical = 0,
    written = 0,
    clippedChars = 0;
  // `sliceNo` counts ATTEMPTS; `slices.length` counts SUMMARIES THAT LANDED. They diverge the moment a slice fails, and
  // labelling with the latter is what made a failing pass report "slice 1 failed" twice while it was actually 67%
  // through the conversation (W8 D7). `endedBy` records which exit ended the loop: the natural end pushes no note, and
  // `reason` used to be the FIRST note matching /failed|no room|cap|disconnected/ — always the earliest failure, never
  // the thing that actually stopped the pass (W8 D8).
  let sliceNo = 0,
    failedSlices = 0,
    endedBy = "exhausted",
    ceilingNoted = false;
  // Hollow replies: how many summaries were kept under the floor, how many retries the pass spent on smaller slices,
  // and the slice size the rest of the pass is held to once a smaller one worked.
  let hollowSlices = 0,
    hollowRetries = 0,
    hollowCap = 0;
  // What the summaries written condensed, and the hollow ones among them, in the tokens of their slices.
  let writtenTokens = 0,
    hollowTokens = 0;
  const digestCap = Math.max(512, Math.floor(P.digestCapFraction * room.frac));
  // A ceiling on one slice, independent of how big the summarizer's window is: one summary condenses one slice, so a
  // slice's size sets how much detail survives (rules.trim.maxSliceTokens).
  const sliceCeiling = room.ceiling; // the same number the compactor's plan reads (`sliceRoom`) — no twin to drift

  while (gi < groups.length) {
    if (aborted()) {
      endedBy = "disconnected";
      mechanical += groups.length - gi;
      notes.push(
        `the compaction was stopped; ${groups.length - gi} turn group(s) were left un-summarized and the summary carries only what was finished before that`,
      );
      break;
    }
    let carriedTokens = digestTokens + slices.reduce((n, s) => n + s.tokens, 0);
    // The carried-digest cap: re-compress the accumulated summaries into one rolling digest so late slices
    // still get room. This is the one call that breaks prompt-cache reuse of the carried prefix.
    if (slices.length >= 2 && carriedTokens > digestCap) {
      const before = slices.map((s) => `- part ${s.n}: ${s.text}`).join("\n");
      onProgress({
        step: "trim",
        message: "re-compressing the carried summaries into one rolling digest",
        percent: percentOf(groups, gi),
      });
      try {
        const merged = String(
          (await callModel({
            system: DIGEST_PROMPT,
            user: `${digest ? `PREVIOUS DIGEST:\n${digest}\n\n` : ""}SUMMARIES TO MERGE:\n${before}`,
          })) || "",
        ).trim();
        // An empty digest is a failed one: replacing the carried summaries with it would drop them all.
        if (!merged) throw new Error("the digest came back empty");
        digest = merged;
        calls++;
        recompactions++;
        slices.length = 0;
        digestTokens = estTokens(digest);
        notes.push(
          `the carried summaries passed ${digestCap.toLocaleString()} tokens and were merged into one rolling digest (${recompactions} time${recompactions === 1 ? "" : "s"}); that one call loses prompt-cache reuse, the prefix is append-only again afterwards`,
        );
      } catch (e) {
        // Never lose the pass because a digest call failed: keep the oldest summaries as a mechanical digest.
        digest = `${digest ? digest + "\n" : ""}${before.slice(0, Math.max(2000, digestCap * 4))}`;
        digestTokens = estTokens(digest);
        slices.length = 0;
        recompactions++;
        notes.push(
          `merging the carried summaries failed (${String(e?.message || e).slice(0, 100)}); they were concatenated and truncated instead`,
        );
      }
      carriedTokens = digestTokens;
    }
    let budget = room.frac - carriedTokens - reserve;
    // The ceiling: never hand one call more than `maxSliceTokens`, whatever the model's window says it could take. More,
    // smaller slices cost a little more and keep more detail. A note is pushed the first time it bites, so the pass
    // explains its own shape.
    if (sliceCeiling > 0 && budget > sliceCeiling) {
      budget = sliceCeiling;
      if (!ceilingNoted) {
        ceilingNoted = true;
        notes.push(
          `slices are capped at ${sliceCeiling.toLocaleString()} tokens (rules.trim.maxSliceTokens) rather than the ${room.frac.toLocaleString()} the summarizer's window would allow, so each summary condenses less and keeps more detail`,
        );
      }
    }
    // After a hollow reply the rest of the pass stays at the size that is being retried: handing the model another
    // slice of the size it just failed on would repeat the failure and spend a retry on it.
    if (hollowCap > 0 && budget > hollowCap) budget = hollowCap;
    // `room.minSlice` is derived from the WINDOW (min(2048, max(256, frac*0.25))), so with a 400k window it is 2048 —
    // larger than an explicit ceiling of, say, 2000. Comparing against it unadjusted would trip the no-room break on
    // the first iteration and the pass would do nothing at all. An explicit ceiling is a deliberate choice and wins.
    const minSlice = sliceCeiling > 0 ? Math.min(room.minSlice, sliceCeiling) : room.minSlice;
    if (budget < minSlice) {
      endedBy = "no-room";
      const eff = sliceCeiling > 0 ? Math.min(room.frac, sliceCeiling) : room.frac;
      notes.push(
        `no room left for another slice (the carried digest is ~${carriedTokens.toLocaleString()} tokens of the ${eff.toLocaleString()}-token slice budget${sliceCeiling > 0 && sliceCeiling < room.frac ? ` — the maxSliceTokens ceiling, not the ${room.frac.toLocaleString()} the window would allow` : ""}, and a slice needs at least ${minSlice.toLocaleString()}); ${groups.length - gi} turn group(s) are not represented`,
      );
      mechanical += groups.length - gi;
      break;
    }

    // Adaptive sizing: take whole turn groups while they fit, at least one, and split an oversized group.
    const pick = pickSlice({ groups, rendered, tokens, from: gi, budget });
    const sliceText = pick.text;
    // One message bigger than the whole budget is clipped to it. Count what went, so the summary's "Not represented"
    // section and the record tell the truth.
    if (pick.clippedChars > 0) {
      if (!clippedChars) notes.push("one message was larger than the whole slice budget: the end of it was left out of the summary");
      clippedChars += pick.clippedChars;
    }
    const key = sliceKey(sliceText, words);
    sliceNo++; // this attempt's number, whether or not it lands a summary
    const floor = summaryFloor(pick.tokens, summaryTokens, P.minSummaryPercent);
    let summary = null,
      hollow = false,
      retry = false;
    try {
      summary = cache?.get?.(key) || null;
    } catch {
      summary = null;
    }
    // A cached summary met the floor in force when it was written (a hollow one is never cached), and the floor moves
    // with the slice pass's settings. One under today's floor would hand a second summary a hole, so it counts as a miss and is
    // written again.
    if (summary && floor > 0 && estTokens(summary) < floor) {
      notes.push(
        `a cached summary of slice ${sliceNo} was unusually short (~${estTokens(summary)} tokens for ~${pick.tokens.toLocaleString()} tokens of conversation) and was not reused`,
      );
      summary = null;
    }
    if (summary) {
      cachedHits++;
      onProgress({
        step: "trim",
        message: `slice ${sliceNo} reused from the cache`,
        percent: percentOf(groups, pick.next),
        slice: sliceNo,
        tokens: pick.tokens,
      });
    } else {
      onProgress({
        step: "trim",
        message: `summarizing slice ${sliceNo} (~${pick.tokens.toLocaleString()} tokens of the conversation)`,
        percent: percentOf(groups, gi),
        slice: sliceNo,
        tokens: pick.tokens,
      });
      try {
        const raw = await callModel({
          system: trimPrompt(words),
          user: `${carriedPrefix(digest, slices)}EXCERPT (messages ${msgNo(pick.fromMsg)} to ${msgNo(pick.toMsg - 1)} of the conversation):\n\n${sliceText}`,
        });
        calls++;
        summary = String(raw || "").trim();
        // An empty reply is a failed slice, not a free one: count it and say so. (Kept inside the same try, so the
        // note itself must not throw — a ReferenceError here would be swallowed by the catch below and double-count.)
        if (!summary) {
          mechanical++;
          failedSlices++;
          notes.push(`slice ${sliceNo} came back empty and is not represented`);
        } else if (floor > 0 && estTokens(summary) < floor) {
          // Under the floor. Retry on half the slice — but never less than the whole first turn group (a group is cut
          // only where it cannot fit a slice at all), and only when that is meaningfully smaller than what just failed.
          // A slice that cannot be split further is kept and marked: a short summary with a warning beats a hole the
          // reader cannot see.
          const got = estTokens(summary);
          const g0 = groups[gi];
          let g0Tokens = 0;
          for (let i = g0.from; i < g0.to; i++) g0Tokens += tokens[i] || 0;
          const smaller = Math.max(minSlice, Math.floor(pick.tokens / 2), g0Tokens);
          if (
            hollowRetries < MAX_HOLLOW_RETRIES &&
            pick.next - gi >= 2 &&
            smaller <= Math.floor(pick.tokens * 0.75)
          ) {
            hollowRetries++;
            hollowCap = smaller;
            retry = true;
            summary = null;
            notes.push(
              `slice ${sliceNo} came back with ~${got} tokens for ~${pick.tokens.toLocaleString()} tokens of conversation, under the ${P.minSummaryPercent}% floor; retrying on a slice of ~${smaller.toLocaleString()} tokens, and the rest of the pass stays at that size`,
            );
          } else {
            hollow = true;
            hollowSlices++;
            notes.push(
              `slice ${sliceNo} came back with ~${got} tokens for ~${pick.tokens.toLocaleString()} tokens of conversation, under the ${P.minSummaryPercent}% floor, and could not be split further${hollowRetries >= MAX_HOLLOW_RETRIES ? ` (${MAX_HOLLOW_RETRIES} retries already spent)` : ""}; it is kept and marked in the summary`,
            );
          }
        }
      } catch (e) {
        calls++;
        summary = null;
        mechanical++;
        failedSlices++;
        notes.push(
          `summarizing slice ${sliceNo} failed (${String(e?.message || e).slice(0, 120)}); that slice is not represented in the summary`,
        );
        if (calls >= 3 && failedSlices === calls) {
          endedBy = "all-failed";
          notes.push(
            `every one of the first ${calls} slice calls failed; the pass stopped rather than producing an empty summary`,
          );
          break;
        }
      }
      if (retry) continue; // `gi` is untouched: the same starting point is picked again under the smaller cap
      // A hollow summary is never cached: a second summary gets another chance at it, perhaps with another model.
      if (summary && !hollow)
        try {
          cache?.put?.(key, { text: summary, tokens: estTokens(summary), chars: sliceText.length, model });
        } catch {}
    }
    if (summary) {
      slices.push({
        n: slices.length + 1,
        from: msgNo(pick.fromMsg),
        to: msgNo(pick.toMsg - 1),
        text: summary,
        tokens: estTokens(summary),
        sourceTokens: pick.tokens,
        hollow,
      });
      written++;
      writtenTokens += pick.tokens;
      if (hollow) hollowTokens += pick.tokens;
    }
    // What an oversized group has left is read next, as a group of its own.
    if (pick.rest) groups.splice(gi, 1, { from: pick.fromMsg, to: pick.toMsg }, pick.rest);
    gi = pick.next;
  }

  // A pass can run out of conversation with nothing to show for it: the early-stop needs three failed calls, so a
  // short conversation where every call failed ends "naturally" instead. Calling that "the whole conversation was
  // read" would be true of the loop and false of the outcome, so name what actually happened.
  if (endedBy === "exhausted" && written === 0 && failedSlices > 0) endedBy = "all-failed";
  return { slices, digest, digestTokens, calls, cached: cachedHits, recompactions, mechanical, written, clippedChars, failedSlices, endedBy, hollowSlices, hollowRetries, hollowTokens, writtenTokens };
}

/**
 * A conversation too big for one call of its writer, summarized in sequential slices into one text: its messages of
 * words cut in pieces no bigger than the smallest slice, read turn by turn — a turn bigger than one slice in parts at
 * its steps — and the summaries joined (`joinSlices`), with a line for what no summary covers. `policy` is
 * `rules.trim` (normalizeTrimPolicy reads it); `windowTokens`, the writer's window; `callModel` makes one call and
 * names its purpose; `cache`, the slice cache. `text` is "" where no summary landed.
 * @param {{ messages: any[], policy?: any, windowTokens: number, callModel: import("../core/ports.js").Summarizer,
 *   cache?: import("../core/ports.js").SliceCache | null, onProgress?: import("../core/ports.js").ProgressSink,
 *   signal?: AbortSignal | null, model?: string }} a
 */
export async function summarizeInSlices({ messages: given, policy = {}, windowTokens, callModel, cache = null, onProgress = () => {}, signal = null, model = "" }) {
  const P = normalizeTrimPolicy(policy);
  const room = sliceRoom(windowTokens, P);
  // A piece is under the cap on one message, and small enough for the smallest slice the pass makes.
  const messages = wordsInPieces(given, pieceChars(P, room));
  const rendered = renderMessages(messages, { cap: P.tailMessageCapChars });
  const tokens = rendered.map(estTokens);
  const budget = Math.max(room.minSlice, room.budget);
  const weight = (/** @type {{ from: number, to: number }} */ g) => {
    let n = 0;
    for (let i = g.from; i < g.to; i++) n += tokens[i] || 0;
    return n;
  };
  /** @type {string[]} */
  const notes = [];
  const pass = await sliceSummaries({
    // The parts are the size of the smallest slice the pass makes: the room a slice has shrinks as the summaries
    // before it ride along, and a part that still fits is never cut between a call and its result.
    groups: turnGroups(messages, "anthropic").flatMap((g) => (weight(g) > budget ? partsOfTurn(messages, tokens, g, room.minSlice) : [g])),
    rendered,
    tokens,
    policy: P,
    room,
    callModel,
    cache,
    onProgress,
    signal,
    model,
    notes,
  });
  const missing = [
    pass.mechanical ? `${pass.mechanical} turn group(s) could not be summarized` : null,
    pass.clippedChars ? `~${Math.round(pass.clippedChars / 4).toLocaleString()} tokens were clipped to fit the summarizer's window` : null,
  ].filter(Boolean);
  const text = pass.slices.length || pass.digest ? joinSlices({ digest: pass.digest, slices: pass.slices, missing: missing.length ? `${missing.join("; ")}.` : null }) : "";
  return { text, pass, notes };
}
