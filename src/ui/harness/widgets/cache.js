// @ts-check
// The Cache instrument (HarnessV3 Step 6 design): am I paying full price? The pill is the last request's hit rate —
// the share of its prompt read from the provider's cache. The popover: that rate as a ring beside how long the cache
// stays warm; the last request split into read / written / new input; the hit rate turn by turn; what the cache saved
// this session; and the prediction for the next turn. Every figure is the server's — the
// session's usage ledger (`settings.usage`), each model call of a running turn as its run says it (`round-cache`), the
// turns' facts, the main agent's cache state — and the prediction is arithmetic on the compose preview. It never fetches.
// Where Filament's own agent adds the cache markers, the popover chooses how long the provider keeps the cache — five
// minutes or an hour (`model.cacheTtl`) — for the chat's next turn on.
// It draws what is known and no more (lib/cache-facts.js): the pill and the ring are the newest request's where that
// request said its cache numbers, and where it said none — a provider or a coding agent that counts none — there is
// no pill, and the card, which Overview's tile still opens, says so over the earlier turns that did. A turn that said
// none is a gap among the turns, and the average is of the requests that said theirs. The clock and the prediction
// show where the cache that request touched has a lifetime something said — its calls, its provider's split of its
// writes, the markers Filament's own agent adds — and the chat's next request goes where that one went. A coding
// agent's cache whose lifetime nothing says (a request an older Filament booked, an agent that says none) has no clock
// either, and one thing is known of it all the same: past the longest any provider keeps a cache (the settings'
// `cache.atMost`, the hour the cold question asks by) it is gone, so the pill dims and says so (the owner's of 11-12:
// after an upgrade a chat hours idle stood lit at "Cache 100%"). Before any request has gone where the next one goes,
// the pill stands with no figure where Filament's own agent marks that request for the cache: its card is where the
// lifetime is chosen.
import { h, morphChildren } from "../../lib/dom.js";
import { promptOf, cacheSaid, cacheTouched, seenPrompt, hitOf, carriedOf } from "../../lib/cache-facts.js";
import { head, ringSvg, stackBar, legend, barStrip, group, row, note, link, segmented, tok, usd, pct, clock, kids, chartTurns, spanWords } from "./kit.js";

const HOUR_MS = 3_600_000;
const FIVE_MIN_MS = 300_000;
/** The lifetimes the popover offers, as `model.cacheTtl` names them. */
const LIFETIMES = Object.freeze([
  { id: "5m", label: "5 min", title: "Cheaper for a short session: writes cost 1.25× the input price" },
  { id: "1h", label: "1 hour", title: "Outlasts a long session's pauses: writes cost 2× the input price" },
]);

// The share of a prompt read from the cache, and the share the cache holds once it ran: the one rule's (lib/cache-facts.js).
export { hitOf, carriedOf };

/**
 * A model call's prompt as its run said it (`round-cache`), and when — the log's time, else the page's now: the Cache
 * instrument's last request while it is the newest the page knows. Null for one that counted no prompt.
 * `ttlMs`: the lifetime its cache writes asked for, where its run said (a coding agent's own markers).
 * @param {any} e  the run event @param {number} [now]
 * @returns {{ input: number, cacheRead: number, cacheWrite: number, at: number, ttlMs?: number } | null}
 */
export function callOf(e, now = Date.now()) {
  const t = { input: Number(e?.input) || 0, cacheRead: Number(e?.cacheRead) || 0, cacheWrite: Number(e?.cacheWrite) || 0 };
  return promptOf(t) > 0 ? { ...t, at: Number(e?.ts) || now, ...(Number(e?.ttlMs) > 0 ? { ttlMs: Number(e.ttlMs) } : {}) } : null;
}

/**
 * The next turn's first request, predicted: the share of its prompt the cache should serve, and the words for why.
 * `carried` is the share of the last request's prompt the cache holds now (`carriedOf`). Filament never re-shapes a
 * past turn between compactions, so all of that carries over; a turn past the compaction line restarts from a summary
 * and starts cold. A cache that has expired (or a model that is not cached) serves nothing: the next turn writes its
 * whole prompt again. A coding agent keeps its conversation whole between turns (HarnessV3-ACP AC3-5): what the cache
 * holds carries over while it is warm — unless it is past its line (AC5-3: `wouldCompact`), or the agent compacts on
 * its own first, which Filament can't see coming. What the chat sends ahead of its history changed since it last sent
 * it (`changed`, the preview's `printChanged`; the owner's of 11-06): the loop's next request writes it all again, and
 * while the cache is warm the next message asks first; an agent's session goes on, what it already loaded keeping its
 * old form, or starts fresh, as the person answers.
 * @param {{ carried: number | null, wouldCompact?: boolean, cold?: boolean, uncached?: boolean, ttlMin?: number, agent?: boolean, changed?: string[] }} o
 * @returns {{ share: number | null, words: string }}
 */
export function predictNextRead(o) {
  if (o.wouldCompact) return { share: 0.03, words: "The next turn crosses the compaction line and restarts from a summary, so it starts cold." };
  if (o.uncached) return { share: 0, words: "This model's requests aren't cached, so every turn sends its whole prompt as new input." };
  if (o.carried == null) return { share: null, words: "The first request writes the cache; reads start with the next one." };
  const changed = o.changed?.length ? o.changed.join("; ") : "";
  if (changed && !o.agent && !o.cold) return { share: 0, words: `What this chat sends ahead of its history changed (${changed}), so the next turn writes the whole prompt again, warm as the cache is. Your next message asks first: compacting before it leaves less to write.` };
  if (changed && !o.cold) return { share: o.carried, words: `What the agent is given changed (${changed}). Your next message asks first: going on keeps its session and cache, though what it already loaded can keep its old form; compacting starts a fresh session, cold.` };
  if (o.cold) return { share: 0, words: `The cache has expired, so the next turn writes the whole prompt again. Sending within ${o.ttlMin || 5} minutes of a request keeps it warm.` };
  if (o.agent) return { share: o.carried, words: "The agent keeps its conversation whole between turns, so what the cache holds now carries over — unless the agent compacts first." };
  return { share: o.carried, words: "Filament never rewrites a past turn between compactions, so the whole history carries over from the cache." };
}

/**
 * How warm the provider's cache is now: the main agent's cache state when the page has it (the sub-agent registry
 * counts it), else counted from the newest request's time and the cache's lifetime (the state's, else `o.ttlMs` — what
 * the chat's calls or its setting say — else five minutes) — a read refreshes the lifetime, so the newest request is
 * where it runs from. A turn in flight uses the cache as it starts, at each model call and while its model writes —
 * `lastAt` is the newest of those — and between them, through a long tool, a wait on a sub-agent, its life runs down as
 * any other time's; a state the registry took before that use is older than the clock. With no use counted yet, the
 * turn's first request is reading it now.
 * @param {{ state: string, leftMs: number, ttlMs: number }} s @param {number | null} lastAt @param {number} now
 * @param {{ inFlight?: boolean, ttlMs?: number }} [o]
 * @returns {{ warm: boolean, leftMs: number, ttlMs: number, words: string }}
 */
export function warmthOf(s, lastAt, now, o = {}) {
  const ttlMs = Number(s?.ttlMs) > 0 ? Number(s.ttlMs) : Number(o.ttlMs) > 0 ? Number(o.ttlMs) : FIVE_MIN_MS;
  const warm = (/** @type {number} */ left) => ({ warm: true, leftMs: left, ttlMs, words: `Warm · ${clock(left)} left` });
  const cold = () => {
    const gone = Math.max(1, Math.round((now - Number(lastAt) - ttlMs) / 60000));
    return { warm: false, leftMs: 0, ttlMs, words: gone >= 90 ? "Cold — expired a while ago" : `Cold — expired ${gone} min ago` };
  };
  if (s?.state === "uncached") return { warm: false, leftMs: 0, ttlMs, words: "Not cached" };
  if (o.inFlight) {
    if (!(Number(lastAt) > 0)) return { warm: true, leftMs: ttlMs, ttlMs, words: "In use by this turn" };
    const left = Math.max(Number(lastAt) + ttlMs - now, s?.state === "warm" ? Number(s.leftMs) || 0 : 0);
    return left > 0 ? warm(left) : cold();
  }
  if (s?.state === "warm" && s.leftMs > 0) return warm(s.leftMs);
  if (!(Number(lastAt) > 0)) return { warm: false, leftMs: 0, ttlMs, words: "Waiting for a reply" };
  const left = Number(lastAt) + ttlMs - now;
  if (left > 0 && s?.state !== "cold") return warm(left);
  return cold();
}

/**
 * @param {import("./registry.js").WidgetContext} ctx
 * @param {import("./frame.js").WidgetIO} [io]
 * @returns {import("./frame.js").WidgetSpec}
 */
export function cacheWidget(ctx, io = {}) {
  const mk = io.h || h;
  // The open popover is drawn again at every frame of a reply: in place, its lifetime's two choices and its figures
  // the elements they were under the pointer (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost).
  const drawIn = io.drawIn || morphChildren;
  const usage = () => ctx.view()?.settings?.usage || null;
  /** The chat's cache lifetime as its settings say it (`model.cacheTtl`, else the route's rules), and whether it can choose. */
  const setting = () => ctx.view()?.settings?.cache || null;
  /**
   * Whether the chat's next request goes elsewhere than its ledger's last one went — another model, another agent —,
   * as its settings say of that very request (`cache.same`, its `at` the request's): what that request left in a cache
   * is not the next one's to read. Not known of a request newer than the settings' answer.
   */
  const moved = () => {
    const s = setting()?.same;
    const booked = usage()?.last;
    return !!s && s.is === false && !!booked && Number(s.at) === Number(booked.at);
  };
  /**
   * The last request's tokens: the newest model call the page knows — the running turn's, as its run says each one
   * (`round-cache`, kept on the chat after the turn; a run says the calls whose usage carried their cache numbers), or
   * the session ledger's newest, whichever came later — else, with neither, the reply's own record (a turn's record
   * sums its calls, so it stands in only where nothing else counted). Null while a turn runs where the chat moved to
   * and no call of its own has been said: its requests are the newest, and nothing has said their numbers.
   */
  const last = () => {
    const live = ctx.live();
    const call = live?.call || null;
    const booked = usage()?.last || null;
    const ledger = booked && promptOf(booked) > 0 ? booked : null;
    if (call && !(Number(ledger?.at) > Number(call.at))) return { ...call, cacheSeen: true };
    if (ledger && live?.streaming && moved()) return null;
    if (ledger) return ledger;
    const rec = live?.rec;
    return rec?.tokens && promptOf(rec.tokens) > 0 ? rec.tokens : booked;
  };
  /**
   * When the newest request the page knows of ran — and, while a turn runs, its newest use of the cache: its start and
   * each moment its model wrote (`usedAt`). A read refreshes the cache's lifetime, so its warmth runs from it.
   */
  const lastAt = () => {
    const live = ctx.live();
    return Math.max(Number(live?.call?.at) || 0, Number(usage()?.last?.at) || 0, live?.streaming ? Number(live.usedAt) || 0 : 0) || null;
  };
  /** The newest request said its cache numbers (lib/cache-facts.js): the pill and the ring are its, or there are none. */
  const said = () => cacheSaid(last());
  /** The turns the charts draw whose usage said cache numbers. */
  const saidTurns = () => chartTurns(ctx.turns?.() || []).filter((x) => !x.command && cacheSaid(x.facts?.tokens));
  /** Some request of the chat said its cache numbers: Overview keeps the tile, and the card has a record to show. */
  const ever = () => said() || cacheSaid(usage()) || saidTurns().length > 0;
  const lastHit = () => hitOf(last());
  /** The share read from the cache over the session, of the requests that said theirs. */
  const sessionHit = () => hitOf(usage());
  /** Whether every prompt token of the session came with cache numbers: the average is the session's, else of those that did. */
  const whole = () => {
    const u = usage();
    return !!u && seenPrompt(u) >= promptOf(u);
  };
  /** What the cache saved, where the ledger can say: a request said its numbers, and one had a list price to save against. */
  const saved = () => {
    const u = usage();
    return u && cacheSaid(u) && (Number(u.listUnpriced) || 0) < (Number(u.requests) || 0) ? usd(u.savedUsd) : null;
  };
  const state = () => ctx.subagents?.cache?.() || { state: "none", leftMs: 0, ttlMs: 0, tokens: 0 };
  /** The session's model is a coding agent's: it keeps its own conversation, and Filament never shapes it. */
  const agent = () => !!ctx.live()?.agent;
  /**
   * No request has gone where the chat's next one goes — none yet, or the chat has moved since a newest one that gave
   * no numbers — and that request is one Filament's own agent marks for its provider's cache (the chat's setting can
   * choose its lifetime): the pill stands with no figure, and the card is where the lifetime is chosen before it.
   */
  const ahead = () => !said() && !agent() && !!setting()?.settable && (!(Number(usage()?.requests) > 0) || moved());
  /** The lifetime the newest request's writes asked for, where its run or the ledger said (a coding agent's own markers). */
  const callTtl = () => Number(last()?.ttlMs) || 0;
  /**
   * The life of the cache the newest turn that wrote one left, as its provider split its writes (`cacheWrite1h`), of
   * the turns the newest one's model and upstream answered; 0 where none says, and where the chat has moved since: a
   * turn of another model says nothing of this one's cache. A lifetime chosen since moves only the next turn's.
   */
  const writtenTtl = () => {
    if (moved()) return 0;
    const turns = chartTurns(ctx.turns?.() || []).filter((x) => !x.command).reverse();
    const on = turns[0]?.facts;
    for (const x of turns) {
      if (x.facts?.model !== on?.model || x.facts?.upstream !== on?.upstream) break;
      const t = x.facts?.tokens;
      if (Number(t?.cacheWrite) > 0 && t.cacheWrite1h != null) return Number(t.cacheWrite1h) > 0 ? HOUR_MS : FIVE_MIN_MS;
    }
    return 0;
  };
  /**
   * How long the provider keeps the cache the newest request touched, where something says: the request's own calls,
   * else what the last writes had, else the markers Filament's own agent adds (the chat's setting, where it can
   * choose). 0 where nothing does — a coding agent that says none, a provider that caches by itself.
   */
  const life = () => callTtl() || writtenTtl() || (!agent() && setting()?.settable ? (setting().ttl === "1h" ? HOUR_MS : FIVE_MIN_MS) : 0);
  /** The newest request is the ledger's, and the chat has moved since: its figures are another model's cache. */
  const stale = () => moved() && !!usage()?.last && last() === usage().last;
  /**
   * Whether the newest request's cache has a clock and a prediction: it said its numbers, it read or wrote the cache,
   * the chat's next request goes where it went, and something says how long that cache is kept.
   */
  const timed = () => {
    const t = last();
    return cacheSaid(t) && cacheTouched(t) && !stale() && life() > 0;
  };
  /**
   * The longest the cache the newest request touched can be kept, where nothing says its lifetime: a coding agent's,
   * as the chat's settings say it (`cache.atMost`: the longest any provider keeps one, the clock the question before a
   * message into an idle session asks by). 0 where its lifetime is said, and where nothing bounds it.
   */
  const atMost = () => (life() > 0 ? 0 : Number(setting()?.atMost) || 0);
  /** How long ago the newest request ran. */
  const idle = () => Math.max(0, Date.now() - Number(lastAt()));
  /**
   * The newest request's cache is gone whichever lifetime it had: it said its numbers and touched the cache, the
   * chat's next request goes where it went, nothing says how long that cache is kept — and it ran longer ago than any
   * is. Not while a turn runs: its requests read the cache as they go, and say what they found.
   */
  const lapsed = () => {
    const t = last();
    return atMost() > 0 && lastAt() != null && !ctx.live()?.streaming && cacheSaid(t) && cacheTouched(t) && !stale() && idle() >= atMost();
  };
  /** Why the newest request's cache has no clock, in the card's words and the tile's; none where it has one. */
  const untimed = () => {
    const t = last();
    if (!cacheSaid(t) || timed()) return null;
    if (stale()) return { words: "The chat has moved to another model since this request, so its next turn reads none of this cache.", short: "the chat moved to another model" };
    if (!cacheTouched(t)) return { words: "This request read nothing from the cache and wrote nothing to it.", short: "nothing was cached" };
    if (lapsed()) return { words: `This request ran ${spanWords(idle())} ago, and no provider keeps a prompt cache longer than ${spanWords(atMost())}: it has gone cold, so the next turn writes the whole prompt again.`, short: `idle ${spanWords(idle())}` };
    return { words: "Nothing says how long this cache is kept, so there is no countdown and no forecast.", short: "its lifetime is not known" };
  };
  const warmth = () => warmthOf(state(), lastAt(), Date.now(), { inFlight: !!ctx.live()?.streaming, ttlMs: life() });
  /** The cache has expired since the last request: the pill's rate is history, not what the next turn will get. */
  const coldNow = () => (timed() && !warmth().warm) || lapsed();
  /** That it is cold, in the words its clock gives — or, with no clock, how long it has been idle. */
  const coldWords = () => (lapsed() ? `Cold — idle ${spanWords(idle())}` : warmth().words);
  /** A poor read after the first request (the first one writes the cache, so it never counts). */
  const poor = () => {
    const x = lastHit();
    return x != null && x < 0.5 && (Number(usage()?.requests) || 0) > 1;
  };
  /** @type {any} */
  let preview = null;
  /** @type {null | ((first?: boolean) => void)} */
  let painter = null;

  const pillText = () => {
    const x = lastHit();
    return x == null ? "—" : `${Math.round(x * 100)}%`;
  };
  /** The header's quiet line: the cache's lifetime where it has a clock, and that the newest request gave no numbers. */
  const headSub = () => (!said() ? (ahead() ? (setting().ttl === "1h" ? "One-hour prompt cache" : "Five-minute prompt cache") : ever() ? "No cache numbers for the newest request" : "No cache numbers") : timed() ? (warmth().ttlMs >= HOUR_MS ? "One-hour prompt cache" : "Five-minute prompt cache") : "Prompt cache");

  /** @param {typeof h} m @param {() => void} close */
  const panel = (m, close) => {
    const subBox = m("span", {});
    const ringBox = m("span", { class: "inst-ring-svg" });
    const ringCenter = m("div", { class: "inst-ring-center" });
    const side = m("div", { class: "inst-cache-side" });
    const duo = m("div", { class: "inst-duo" }, m("div", { class: "inst-ring", style: "width:96px;height:96px" }, ringBox, ringCenter), side);
    const whyBox = m("div", {});
    const earlierBox = m("div", { class: "inst-card" });
    const lastBox = m("div", { class: "inst-card" });
    const turnsBox = m("div", { class: "inst-card" });
    const predictBox = m("div", {});
    const lifeBox = m("div", {});
    const warmthBox = m("div", { class: "inst-cache-warmth" });
    let wasWarm = false;
    let wasTimed = false;
    let wasLapsed = false;
    const paintWarmth = () => {
      // With no clock, the one thing known: it is cold, and for how long it has been idle.
      const w = lapsed() ? { warm: false, leftMs: 0, ttlMs: 0, words: coldWords() } : warmth();
      drawIn(warmthBox, kids([
        m("div", { class: `inst-warmth${w.warm ? " is-warm" : ""}` }, m("span", { class: "inst-warmth-dot" }), m("span", { class: "inst-warmth-text" }, w.words)),
        w.warm ? m("div", { class: "inst-drain" }, m("span", { style: `width:${Math.round(Math.max(0, Math.min(1, w.leftMs / w.ttlMs)) * 100)}%` })) : null,
      ]));
    };
    /** A figure beside its name. @param {string} label @param {string} value @param {boolean} [good] */
    const kv = (label, value, good = false) => m("div", { class: "inst-kv" }, m("span", {}, label), m("b", good ? { class: "is-good" } : {}, value));
    const average = () => (sessionHit() != null ? `${Math.round(/** @type {number} */ (sessionHit()) * 100)}%` : "—");
    painter = (first = false) => {
      const t = last();
      // The ring, the split and the lifetime are the newest request's where it said its numbers; the clock and the
      // prediction where its cache has them (`timed`).
      const known = cacheSaid(t);
      const clocked = timed();
      // No clock, and cold all the same: longer idle than any cache is kept (`lapsed`).
      const gone = lapsed();
      wasLapsed = gone;
      const hit = lastHit();
      const earlier = !known && ever();
      const next = !known && ahead();
      drawIn(subBox, [headSub()]);
      duo.classList.toggle("hidden", !known);
      drawIn(ringBox, known ? [m("span", { class: "inst-ring-svg", html: ringSvg({ size: 96, width: 10, parts: hit != null ? [{ f: Math.max(0.005, hit), color: poor() ? "var(--color-sys-orange)" : "var(--color-sys-green)" }] : [], draw: first }) })] : []);
      drawIn(ringCenter, known
        ? [
            m("div", { class: "inst-ring-num" }, hit != null ? String(Math.round(hit * 100)) : "—", hit != null ? m("small", {}, "%") : null),
            m("div", { class: "inst-ring-cap" }, "last request")]
        : []);
      if (clocked || gone) paintWarmth();
      drawIn(lifeBox, kids([known || next ? lifetimeRow(m) : null]));
      drawIn(side, known
        ? kids([
            clocked || gone ? warmthBox : null,
            kv(whole() ? "Session average" : "Average where reported", average()),
            saved() != null ? kv("Saved so far", /** @type {string} */ (saved()), true) : null])
        : []);
      // Where there is no clock, why — and, where the newest request gave no numbers, that what follows is earlier;
      // before the first request where the next one goes, what that one does.
      const why = known ? untimed()?.words || "" : next ? "No request has gone to this model yet. Its first one writes the cache; reads start with the next." : earlier ? "The newest request gave no cache numbers. What follows is from the earlier turns that did." : "No request of this chat has given cache numbers.";
      whyBox.classList.toggle("hidden", !why);
      drawIn(whyBox, why ? [note(m, why)] : []);
      earlierBox.classList.toggle("hidden", !earlier);
      drawIn(earlierBox, earlier
        ? kids([
            m("div", { class: "inst-card-head" }, m("span", { class: "inst-card-title" }, "Earlier turns")),
            kv("Average where reported", average()),
            saved() != null ? kv("Saved by the cache", /** @type {string} */ (saved()), true) : null])
        : []);
      // The last request, read / written / new.
      const read = Number(t?.cacheRead) || 0;
      const wrote = Number(t?.cacheWrite) || 0;
      const fresh = Number(t?.input) || 0;
      const all = read + wrote + fresh;
      lastBox.classList.toggle("hidden", !known);
      drawIn(lastBox, known
        ? [
            m("div", { class: "inst-card-head" }, m("span", { class: "inst-card-title" }, "Last request"), m("span", { class: "inst-card-fig" }, all ? `${tok(all)} tokens` : "—")),
            stackBar(m, [
              { value: read, color: "var(--color-sys-green)", label: "Read from cache" },
              { value: wrote, color: "var(--color-sys-teal)", label: "Written to cache" },
              { value: fresh, color: "var(--color-sys-blue)", label: "New input" },
            ], { tall: true }),
            legend(m, [
              { color: "var(--color-sys-green)", label: "Read from cache", value: tok(read), share: pct(read, all) },
              { color: "var(--color-sys-teal)", label: "Written to cache", value: tok(wrote), share: pct(wrote, all) },
              { color: "var(--color-sys-blue)", label: "New input", value: tok(fresh), share: pct(fresh, all) },
            ])]
        : []);
      if (first) lastBox.querySelector?.(".inst-stack")?.classList.add("is-draw");
      // The hit rate turn by turn: a turn whose usage said no cache numbers is a gap, never a column at 0%.
      const shown = chartTurns(ctx.turns?.() || []).slice(-24);
      drawIn(turnsBox, [
        m("div", { class: "inst-card-head" }, m("span", { class: "inst-card-title" }, "Hit rate by turn"), m("span", { class: "inst-card-fig" }, shown.length ? `${shown.length} turn${shown.length === 1 ? "" : "s"}` : "")),
        shown.length
          ? barStrip(m, shown.map((x, i) => {
              const r = x.command ? null : hitOf(x.facts?.tokens);
              return { value: r ?? 0, gap: !x.command && r == null, label: x.command ? `Turn ${x.n}: a command — no request` : r == null ? `Turn ${x.n}: no cache numbers` : `Turn ${x.n}: ${Math.round(r * 100)}% from cache`, mark: i === shown.length - 1 };
            }), { ariaLabel: "the share read from cache, turn by turn", max: 1, slots: 12, height: 44, draw: first })
          : note(m, "Each finished turn adds a column.")]);
      // The prediction — and the cache's warmth now, which overrules it.
      wasTimed = clocked;
      predictBox.classList.toggle("hidden", !clocked);
      if (!clocked) {
        wasWarm = false;
        drawIn(predictBox, []);
        return;
      }
      const cur = preview?.current;
      const w = warmth();
      wasWarm = w.warm;
      const p = predictNextRead({
        carried: carriedOf(t),
        // An agent's session is past its line by what the agent holds, not by Filament's composition (AC5-3).
        wouldCompact: agent() ? !!preview?.compaction?.agent?.over : !!cur?.wouldCompact,
        cold: !w.warm && (lastAt() != null || state().state === "cold"),
        uncached: state().state === "uncached",
        ttlMin: Math.round(w.ttlMs / 60_000),
        agent: agent(),
        changed: Array.isArray(cur?.printChanged) ? cur.printChanged : [],
      });
      const predictTone = p.share == null ? " is-none" : p.share < 0.5 ? " is-warn" : "";
      drawIn(predictBox, [m("div", { class: `inst-predict${predictTone}` },
        m("div", { class: "inst-predict-head" }, m("span", {}, "Next turn"), m("b", {}, p.share == null ? "—" : `~${Math.round(p.share * 100)}%`), m("span", { class: "inst-predict-unit" }, "from cache")),
        m("div", { class: "inst-predict-words" }, p.words))]);
    };
    painter(true);
    // The compose preview answers async; its arrival repaints the prediction.
    ctx.preview?.().then((pv) => { preview = pv; painter?.(false); }).catch(() => {});
    const root = m("div", { class: "inst inst-cache" },
      head(m, { icon: "zap", title: "Cache", sub: subBox }),
      duo,
      lifeBox,
      whyBox,
      predictBox,
      earlierBox,
      lastBox,
      turnsBox,
      m("div", { class: "inst-foot" }, m("span", { class: "inst-foot-note" }, readPriceWords()), link(m, "Next request", () => { close(); ctx.openPane?.("next-request"); })));
    // The countdown ticks while the popover is open (the timer ends itself once the popover is gone); the moment the
    // cache goes cold — by its clock, or with none by the longest any is kept —, or gains or loses its clock, the card
    // is drawn again.
    const tick = setInterval(() => {
      if (root.isConnected === false || root.isConnected === undefined) clearInterval(tick);
      else if (timed() !== wasTimed || lapsed() !== wasLapsed || (wasTimed && warmth().warm !== wasWarm)) painter?.(false);
      else if (wasTimed || wasLapsed) paintWarmth();
    }, 1000);
    /** @type {any} */ (tick)?.unref?.();
    return root;
  };

  /**
   * How long the provider keeps the cache: where Filament's own agent adds the markers, the choice of five minutes or
   * an hour for the chat's next turn on — a turn running keeps the one it started with; a coding agent's, the lifetime
   * its own markers asked for, said and not chosen. Nothing where neither is known.
   * @param {typeof h} m
   */
  const lifetimeRow = (m) => {
    const s = setting();
    if (agent() || !s?.settable) {
      const t = agent() ? callTtl() : 0;
      return t ? group(m, row(m, { label: "Cache lifetime", sub: "Set by the agent's own requests", value: t >= HOUR_MS ? "1 hour" : "5 min" })) : null;
    }
    const running = !!ctx.live()?.streaming;
    const ran = Number(state().ttlMs) > 0 ? (Number(state().ttlMs) >= HOUR_MS ? "1h" : "5m") : null;
    const sub = running && ran && ran !== s.ttl ? "From the next turn; this one keeps the one it started with" : s.ttl === "1h" ? "Writes cost 2× the input price; reads cost the same" : "Writes cost 1.25× the input price; reads cost the same";
    return group(m, row(m, {
      label: "Cache lifetime",
      sub,
      trailing: segmented(m, {
        options: LIFETIMES,
        value: () => String(setting()?.ttl || "5m"),
        ariaLabel: "How long the provider keeps this chat's prompt cache",
        onChange: (id) => { if (id !== setting()?.ttl || setting()?.from !== "chat") ctx.write({ patch: { model: { cacheTtl: id } } }); },
      }).el,
    }));
  };

  /** What a cached token costs against a new one, from the model's price card when the server sent it. */
  const readPriceWords = () => {
    const p = ctx.view()?.settings?.price;
    const input = Number(p?.input);
    const read = Number(p?.cacheRead);
    return input > 0 && read >= 0 ? `A cached token costs ${Math.round((read / input) * 100)}% of a new one` : "";
  };

  /**
   * The turns whose request read less than half its prompt from the cache, the first turn aside (it writes it): of
   * the turns that said their cache numbers — one that said none missed nothing anyone counted.
   */
  const busts = () => chartTurns(ctx.turns?.() || []).filter((x, i) => i > 0 && !x.command && (hitOf(x.facts?.tokens) ?? 1) < 0.5).length;

  return {
    id: "cache",
    label: "Cache",
    icon: "zap",
    width: 348,
    liveNow: true,
    // The pill is the newest request's share: none while no request has said its cache numbers, and none once the
    // newest one gave none — a chat that moved to an agent that counts none.
    visible: () => ctx.hasSession() && (said() || ahead()),
    // Overview keeps the tile while some request of the chat said its numbers: the record of those turns.
    empty: () => !ever() && !ahead(),
    // The tile on Overview (proposal_ux §4.6, S): the last request's share from the cache as a ring, how warm it is now
    // where its cache has a clock, and the turns that read it cold; where the newest request gave no numbers, that, and
    // the earlier turns' share.
    tile: (m) => {
      if (!said()) {
        const avg = sessionHit();
        if (ahead())
          return [
            m("div", { class: "ov-cache" },
              m("span", { class: "ov-ring" },
                m("span", { class: "ov-ring-svg", html: ringSvg({ size: 64, width: 7, parts: [] }) }),
                m("span", { class: "ov-ring-num" }, "—")),
              m("div", { class: "ov-lines" }, m("b", {}, "No request yet"), m("span", {}, "on this model"))),
            m("p", { class: "ov-quiet" }, "The first one writes the cache"),
          ];
        return [
          m("div", { class: "ov-cache" },
            m("span", { class: "ov-ring" },
              m("span", { class: "ov-ring-svg", html: ringSvg({ size: 64, width: 7, parts: [] }) }),
              m("span", { class: "ov-ring-num" }, "—")),
            m("div", { class: "ov-lines" }, m("b", {}, "No cache numbers"), m("span", {}, "for the newest request"))),
          m("p", { class: "ov-quiet" }, avg != null ? `Earlier turns: ${Math.round(avg * 100)}% from cache` : "Earlier turns gave theirs"),
        ];
      }
      const hit = lastHit();
      const clocked = timed();
      const gone = lapsed();
      const w = warmth();
      const n = busts();
      return [
        m("div", { class: "ov-cache" },
          m("span", { class: "ov-ring" },
            m("span", { class: "ov-ring-svg", html: ringSvg({ size: 64, width: 7, parts: hit != null ? [{ f: Math.max(0.005, hit), color: poor() ? "var(--color-sys-orange)" : "var(--color-sys-green)" }] : [] }) }),
            m("span", { class: "ov-ring-num" }, pillText())),
          m("div", { class: "ov-lines" },
            ...(clocked
              ? [m("b", { class: w.warm ? "is-good" : "" }, w.warm ? "Warm" : "Cold"), m("span", {}, w.warm ? `${clock(w.leftMs)} left` : w.words.replace(/^Cold — /, ""))]
              : gone
                ? [m("b", {}, "Cold"), m("span", {}, untimed()?.short || "")]
                : [m("b", {}, "No countdown"), m("span", {}, untimed()?.short || "")]),
            // The turns that read it cold, in plain words (the Designer's review of 10-24: "busts" is the builder's).
            m("span", { title: "Turns after the first whose request read less than half its prompt from the cache: each paid for most of it anew" }, n ? `${n} turn${n === 1 ? "" : "s"} missed it` : "No turn missed it"))),
        m("p", { class: "ov-quiet" }, hit != null ? "from cache on the last request" : "no request yet"),
      ];
    },
    state: pillText,
    // In the strip, "Cache 90% warm 3:43" (the design pass of 10-24): how long it stays warm, or that it went cold —
    // where its cache has a clock; the share alone where it has none, until it is idle longer than any cache is kept.
    named: true,
    more: () => {
      if (lapsed()) return "gone cold";
      if (!timed()) return "";
      const w = warmth();
      // In minutes: the strip repaints every five seconds, and a clock there would jump; the popover keeps its own.
      return w.warm ? `warm ${Math.max(1, Math.ceil(w.leftMs / 60_000))} min` : "gone cold";
    },
    tone: () => (poor() ? "warn" : ""),
    // Gone cold since, or the chat moved to another model: the pill dims — its rate is the last request's, and the
    // next turn reads none of that cache.
    marks: () => ({ cold: coldNow() || (said() && stale()) }),
    title: () => {
      const x = lastHit();
      if (x == null) {
        const asked = (Number(usage()?.requests) || 0) > 0;
        return asked && ahead() ? "Cache: no request yet on the model this chat moved to" : asked ? "Cache: no cache numbers for the newest request" : "Cache: no request yet";
      }
      const read = `the last request read ${Math.round(x * 100)}% of its prompt from the provider's cache`;
      if (stale()) return `Cache: ${read}; the chat has moved to another model since`;
      return coldNow() ? `Cache: ${coldWords().toLowerCase()} — ${read}; the next turn writes it again` : `Cache: ${read}`;
    },
    panel,
    repaint: () => painter?.(false),
  };
}
