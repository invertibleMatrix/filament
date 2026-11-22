// @ts-check
// Now, in the left bar (proposal_ux §4.1, D7): Needs you, Working and Done across every project, on top of the
// projects. Its rows are lib/now.js's; this file reads what they need beside the runs list the sidebar already polls —
// each followed turn's newest events (GET /api/runs/:id/events, from the event it read last) and the threads of the
// chats whose agents run (GET /api/sessions/:id/subagents), and of a chat whose agent's failure you have not seen, its
// run gone from the list or not — only while the page is in view, a read at a time per run, and only where the runs
// list says a run moved since.
// It draws again only when a row's words (`nowKey`) or its age moved, the chat open changed, or a minute passed. A
// row names what to open — the chat, the thread, or the chat whose card asks — and a press opens it, a team's worker
// under its lead its own thread: nothing here answers, starts or sends. The row of the chat open now is marked.
// The left bar's own Now (`place`) decides where its chats stand — here while Now has a row of their own for them, in
// their project otherwise, never both (the Designer's of 10-27, `placeChats`): a chat whose row went stays a quiet
// minute under Done, the chat open until it is left, and while the pointer is on the bar (`held`) none comes or goes;
// the bar draws its list again when one did (`onMoved`). Its chat rows carry the chat's menu and Delete, as its row
// under Projects does.
// When nothing runs and nothing waits, Now folds to one line ("Nothing running · 2 finished today"), the projects up
// under it. The rail's Now (sidebar.js) lists the same rows in a popover.
import { h, morphChildren, on } from "../lib/dom.js";
import { api } from "./lib/api.js";
import { ICONS, glyphOf } from "./lib/icons.js";
import { awayWords } from "./lib/desk.js";
import { vendorOf } from "./lib/families.js";
import { DONE_SHOWN, FOLD_TAIL, QUIET_MS, ageOf, behindItsRun, blankFold, chainsThatNeed, chainsWithThreads, foldEvents, nowKey, nowRows, placeChats, quietWords, readInTurns, runsToFold, stayRow } from "./lib/now.js";
import { failureSeen } from "./lib/failures-seen.js";
import { comeBackInShort } from "./lib/come-back.js";
import { readAgents } from "./lib/agents-since.js";

const OPEN_KEY = "harness.sidebar.nowOpen";
/** How often a chat's threads are read again while none of them runs (a waiting Apply, a question). */
const THREADS_QUIET_MS = 30_000;
/** How many chats' threads are read at once: the rest wait their turn (`readInTurns`). */
const THREAD_READS = 2;

/** The project chip's colours: one per project, the same on every row and in every window (Your Space's too). */
const CHIP_TONES = ["blue", "orange", "green", "purple", "teal", "pink", "indigo", "yellow"];
/** @param {string} name */
export const chipTone = (name) => {
  let n = 0;
  for (const c of name) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return CHIP_TONES[n % CHIP_TONES.length];
};

/** No other machine's rows. @type {import("./lib/desk.js").DeskGroups} */
const NONE_MORE = { needs: [], works: [], done: [] };

/**
 * @typedef {import("./lib/now.js").NowRow} NowRow
 * @typedef {import("./lib/desk.js").DeskRow} DeskRow
 * @param {{ chats: (chain: string) => import("./lib/now.js").ChatFacts | null, unread: () => ReadonlySet<string>,
 *   holders: () => ReadonlyMap<string, any>, commands?: () => ReadonlyMap<string, readonly import("./lib/commands.js").CommandRow[]>,
 *   comeBacks?: () => ReadonlyMap<string, import("./lib/come-back.js").ComeBack>, idleWakes?: () => ReadonlyMap<string, import("./lib/come-back.js").IdleWake>,
 *   stretches?: () => ReadonlyMap<string, import("./lib/now.js").Stretch>,
 *   flows?: () => ReadonlyMap<string, readonly import("./lib/now.js").FlowAtWork[]>,
 *   apps?: () => readonly import("./lib/now.js").AppRun[], asked?: () => ReadonlyMap<string, { line: string, at: number, working?: boolean }>,
 *   compacting?: () => ReadonlyMap<string, { at: number }>,
 *   onOpen: (row: NowRow) => void, onSeen: (chains: string[]) => void,
 *   onCount?: (needs: number, works: number) => void, current?: () => string | null, marked?: () => string | null, seen?: (r: any) => boolean,
 *   beside?: (chain: string) => { main: string, name: string } | null, call?: typeof api, h?: typeof h,
 *   drawIn?: (host: any, nodes: any[]) => void,
 *   place?: boolean, held?: () => number, onMoved?: () => void, paint?: (draw: () => void) => void,
 *   onMenu?: (row: NowRow, anchor: HTMLElement) => void, onDelete?: (row: NowRow) => void,
 *   named?: (chain: string, title: string) => number | null,
 *   more?: () => import("./lib/desk.js").DeskGroups | null, onOpenMore?: (row: DeskRow) => void, onSeenMore?: (rows: DeskRow[]) => void,
 *   askCards?: (row: DeskRow, mk: any, w: { away: string, onOpen: () => void }) => any[], asksKey?: () => string }} o
 *   `more`: the other machines' Now (the remote desk of 11-22, lib/desk.js `deskGroups`), drawn among its own rows, each
 *   with its machine's chip and greyed while that machine does not answer — never placed, never this Now's count to the
 *   rail —; `onOpenMore`: one of them pressed; `onSeenMore`: Done's Clear, theirs; `askCards`: the cards of one of
 *   theirs' waiting asks, under its row (desk-inbox.js), and `asksKey` what they would draw, in a word;
 *   `named`: how far a name the side model just gave a chat has written itself in, in ms — null once it is written
 *   (Settings › Experimental): its row's title writes it in, a draw meanwhile patching it in place;
 *   `comeBacks`: each chat's come-back while it waits (lib/now.js), its row's age slot saying how long until it;
 *   `idleWakes`: each chat's check-in on its agent idle while its command runs (lib/now.js), its row's fact saying when;
 *   `stretches`: each chat's work stretch while it goes on (lib/now.js), its row's age counted from its start;
 *   `asked`: the page's chats whose message a card stopped, each needing you in its card's words — or at work, the page
 *   making room for that message or sending it again (lib/now.js); `compacting`: the chats whose compaction is written
 *   between their turns, each under Working while it is (lib/now.js);
 *   `onSeen`: Clear's chains, marked seen; `onCount`: the rail's badge, when the counts move; `current`: the chain of
 *   the chat open now, which stays placed, and whose own row (not its threads') is marked — unless `marked` says
 *   another, or none (a Space on screen: the reviewer of 10-29); `seen`: whether a thread's failure was seen
 *   (lib/failures-seen.js, the page's own); `beside`: a team on the side's chat, drawn as a line under the chat it works
 *   for (none: its own row, as the tray's card draws it); `h`: what draws its
 *   elements (the page's, or a test's fake DOM; the tray's card draws the same rows, HarnessV3-Native NA3b); `drawIn`:
 *   how a draw goes into its host — in place (dom.js `morphChildren`, the page's: a row drawn again is the element
 *   that stood, so the pointer resting on it keeps its hover and a press on it lands; the owner's of 11-01), or a fake
 *   DOM's own.
 *   `place`: this is the left bar's Now, which decides where the bar's chats stand; `held`: until when moves wait (the
 *   pointer on the bar), 0 when none; `onMoved`: a chat came or went, so the bar draws its list again; `paint`: how its
 *   own draws are made — the bar's moves each row from where it stood (bar-flight.js); `onMenu`, `onDelete`: a chat
 *   row's right-click and its Delete key, the bar's own.
 */
export function createNow(o) {
  /** The chain whose row is marked: the page's, else the chat open. */
  const marked = () => (o.marked ? o.marked() : o.current?.() || null);
  const call = o.call || api;
  const mk = o.h || h;
  const drawIn = o.drawIn || morphChildren;
  const seen = o.seen || failureSeen;
  /** runId → its fold. @type {Map<string, import("./lib/now.js").RunFold>} */
  const folds = new Map();
  /** chain → its threads, as the list route last answered. @type {Map<string, any[]>} */
  const threads = new Map();
  /** chain → when its threads were read. @type {Map<string, number>} */
  const threadsAt = new Map();
  /** @type {import("./lib/now.js").RunRow[]} */
  let runs = [];
  /** @type {{ needs: NowRow[], works: NowRow[], done: NowRow[] }} */
  let groups = { needs: [], works: [], done: [] };
  /** What the bar's Now draws (`viewOf`): the groups whole, or what stands here. */
  let view = groups;
  /** The other machines' rows as last read (`o.more`). @type {import("./lib/desk.js").DeskGroups} */
  let more = NONE_MORE;
  /** The chats that stand in the bar's Now: chain → when its row went (0 while Now has one). @type {Map<string, number>} */
  let placed = new Map();
  /** The next settle is the person's own press (Fold, Clear, Earlier): nothing waits for the pointer. */
  let forced = false;
  /** A chat the next settle starts without (`home`), so its going is a move the bar draws. @type {string | null} */
  let sentHome = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let settleTimer;
  let drawnKey = "";
  let drawnAt = 0;
  /** The counts the rail's badge was last told: needs, works. */
  let counted = [-1, -1];
  let reading = false;
  /** The quiet line pressed open: the Done rows under it. */
  let quietOpen = false;
  /** Earlier pressed open: every Done row. */
  let earlier = false;
  let open = true;
  try { open = localStorage.getItem(OPEN_KEY) !== "0"; } catch {}

  const el = mk("section", { class: "now", "aria-label": "Now" });

  /** Fold a turn's events read since the last one, or its newest tail on a first read. @param {import("./lib/now.js").RunRow} r */
  async function readFold(r) {
    const had = folds.get(r.id);
    // A turn that waits on you says nothing more until it is answered: one read is enough.
    if (had && r.status === "paused") return;
    // Nothing since the event it read last, as the list numbers the run's newest: nothing to read (every poll read each
    // followed turn's log again, five seconds apart, whether it had moved or not).
    if (had && Number.isFinite(Number(r.events)) && had.n >= Number(r.events)) return;
    const f = had || blankFold();
    const since = Math.max(f.n, (Number(r.events) || 0) - FOLD_TAIL);
    const page = await call(`/runs/${encodeURIComponent(r.id)}/events?since=${since}&limit=${FOLD_TAIL}`).catch(() => null);
    if (!page) return;
    foldEvents(f, Array.isArray(page.events) ? page.events : []);
    folds.set(r.id, f);
  }

  /** A chat's threads. @param {string} chain */
  async function readThreads(chain) {
    const moved = threadRuns(chain);
    const heard = threadsHeard.get(chain) || 0;
    // As the rows that moved since this page's last read of the chat's list (`readAgents`).
    const r = await readAgents(chain, call).catch(() => null);
    threadsAt.set(chain, Date.now());
    if (r) {
      const list = Array.isArray(r.subagents) ? r.subagents : [];
      threads.set(chain, list);
      // One read a moment before its record caught up with its run's end (`behindItsRun`), or before the feed's newest
      // word on its threads (`threadsMoved`), is read again at the next poll.
      if (list.some((t) => behindItsRun(t, runs)) || (threadsHeard.get(chain) || 0) !== heard) threadsSaw.delete(chain);
      else threadsSaw.set(chain, moved);
    }
  }

  /** chain → its threads' runs as the list said them at its threads' last read (`threadRuns`). @type {Map<string, string>} */
  const threadsSaw = new Map();
  /** chain → how often the feed said its threads moved (`threadsMoved`), so a read asked before its newest word knows it. @type {Map<string, number>} */
  const threadsHeard = new Map();
  /** Where a chat's threads' runs stand in the runs list: each one's id, state and newest event. @param {string} chain */
  const threadRuns = (chain) =>
    runs.filter((r) => r.kind === "subagent" && String(r.meta?.chain || "") === chain).map((r) => `${r.id}:${r.status}:${r.endedAt ?? ""}:${r.events ?? ""}`).join(",");

  /**
   * Whether a chat's threads are due a read: each poll its threads' runs moved — a thread says what it does, asks or
   * ends with an event of its run, and the end of the last that ran is a move too (the drive of 11-01: unread, Now said
   * its agent at work for up to half a minute after it answered) —; else every half a minute.
   * @param {string} chain
   */
  const threadsDue = (chain) => !threads.has(chain) || threadRuns(chain) !== threadsSaw.get(chain) || Date.now() - (threadsAt.get(chain) || 0) >= THREADS_QUIET_MS;

  /**
   * The runs list's newest answer: the rows from what is known, then the reads it calls for, then the rows again.
   * @param {import("./lib/now.js").RunRow[]} list
   */
  async function update(list) {
    runs = Array.isArray(list) ? list : [];
    refresh();
    if (reading || (typeof document !== "undefined" && document.visibilityState !== "visible")) return;
    reading = true;
    try {
      const follow = runsToFold(runs);
      for (const id of [...folds.keys()]) if (!follow.some((r) => r.id === id)) folds.delete(id);
      // A chat whose thread needs you, or whose agent's failure you have not seen, is read on, its run gone from the list or not.
      const chains = [...new Set([...chainsWithThreads(runs), ...chainsThatNeed(threads, seen)])];
      for (const c of [...threads.keys()]) if (!chains.includes(c)) { threads.delete(c); threadsAt.delete(c); threadsSaw.delete(c); }
      for (const c of [...threadsHeard.keys()]) if (!chains.includes(c)) threadsHeard.delete(c);
      await Promise.all([...follow.map(readFold), readInTurns(chains.filter(threadsDue), readThreads, THREAD_READS)]);
    } finally {
      reading = false;
    }
    refresh();
  }

  /**
   * The rows again; drawn when one moved, or a minute on for the ages. The bar's own Now settles where its chats stand
   * first, and tells the bar when one came or went, which draws its list with this.
   * @param {boolean} [force]  the person's own press: nothing waits for the pointer
   */
  function refresh(force = false) {
    groups = nowRows({ runs, folds, threads, chats: o.chats, unread: o.unread(), holders: o.holders(), commands: o.commands?.() || new Map(), comeBacks: o.comeBacks?.() || new Map(), idleWakes: o.idleWakes?.() || new Map(), stretches: o.stretches?.() || new Map(), flows: o.flows?.() || new Map(), apps: o.apps?.() || [], asked: o.asked?.() || new Map(), compacting: o.compacting?.() || new Map(), seen, now: Date.now(), beside: o.beside });
    const pressed = force || forced;
    forced = false;
    if (o.place && settle(pressed)) o.onMoved?.();
    view = viewOf();
    more = o.more?.() || NONE_MORE;
    // A row's age as it reads: it moves with the clock, and with what it counts from — a chat's work stretch heard after
    // its row was drawn, as a page that loads afresh hears it. Another machine's rows, and whether it answers, too.
    const t = Date.now();
    const theirs = [...more.needs, ...more.works, ...more.done];
    const ages = [...view.needs, ...view.works, ...view.done, ...theirs].map((r) => (r.due ? "" : ageOf(r.at, t))).join(",");
    // Earlier pressed too: the other machines' Done past their newest three moves nothing else (the review of s1b).
    const k = `${nowKey(view)}\0${nowKey(more)}\0${theirs.map((r) => `${r.machine.status}:${r.machine.name}:${r.machine.color}:${r.machine.icon}`).join(",")}\0${ages}\0${marked() || ""}\0${open}\0${earlier}\0${o.asksKey?.() ?? ""}`;
    if (k === drawnKey && Date.now() - drawnAt < 60_000) return;
    drawnKey = k;
    draw();
    if (groups.needs.length !== counted[0] || groups.works.length !== counted[1]) {
      counted = [groups.needs.length, groups.works.length];
      o.onCount?.(counted[0], counted[1]);
    }
  }

  /** The chats Now has a row of their own for: every one that needs you or works, and Done's newest three (all once Earlier is pressed). */
  function wantedOf() {
    const own = (/** @type {NowRow[]} */ rows) => rows.filter((r) => !r.thread && !r.space).map((r) => r.chain);
    const done = own(groups.done);
    return new Set([...own(groups.needs), ...own(groups.works), ...(earlier ? done : done.slice(0, DONE_SHOWN))]);
  }

  /**
   * Where the bar's chats stand now (`placeChats`); true when one came or went. The next look is set for the first quiet
   * minute that runs out, and for the end of a hold that keeps a move waiting.
   * @param {boolean} force
   */
  function settle(force) {
    const t = Date.now();
    const until = force ? 0 : Number(o.held?.()) || 0;
    const current = o.current?.() || null;
    const wanted = wantedOf();
    const from = sentHome ? new Map([...placed].filter(([c]) => c !== sentHome)) : placed;
    sentHome = null;
    const next = placeChats(from, wanted, { now: t, current, open, held: until > t });
    // A chat gone from the bar (deleted, archived) stays nowhere.
    for (const [c, went] of next) if (went && !o.chats(c)) next.delete(c);
    const moved = next.size !== placed.size || [...next.keys()].some((c) => !placed.has(c));
    placed = next;
    clearTimeout(settleTimer);
    const quiet = [...placed].filter(([c, went]) => went > 0 && c !== current).map(([, went]) => went + QUIET_MS);
    const waits = until > t && ([...wanted].some((c) => !placed.has(c)) || quiet.some((at) => at <= t));
    const due = [...(waits ? [until] : []), ...quiet].filter((at) => at > t);
    if (due.length) settleTimer = setTimeout(() => refresh(), Math.min(...due) - t + 50);
    return moved;
  }

  /**
   * What this Now draws: every group whole, or — the bar's own — a chat's row only where it stands here, with those that
   * stay a while (`stayRow`) under Done, newest first — or, at work, under Working. A chat drawn as a line under a chat's
   * row — a team on the side's at work — stays nowhere else where that row is here, and under Working where a hold keeps
   * it from coming (the review of 11-01: it stood under Done, "finished", as its team worked).
   */
  function viewOf() {
    if (!o.place) return groups;
    // A Space's button running is no chat's: it stands here alone.
    const here = (/** @type {NowRow} */ r) => !!r.thread || !!r.space || placed.has(r.chain);
    const rows = [...groups.needs, ...groups.works, ...groups.done].filter((r) => !r.thread && !r.space);
    const lines = (/** @type {NowRow[]} */ list) => list.flatMap((r) => r.under.flatMap((u) => (u.chain ? [u.chain] : [])));
    const rowed = new Set([...rows.map((r) => r.chain), ...lines(rows.filter(here))]);
    const atWork = new Set(lines(rows));
    const stay = [...placed].filter(([c]) => !rowed.has(c)).map(([c, since]) => stayRow(c, since, { runs, chats: o.chats, working: atWork.has(c) }));
    const newest = (/** @type {NowRow} */ a, /** @type {NowRow} */ b) => b.at - a.at;
    return {
      needs: groups.needs.filter(here),
      works: [...groups.works.filter(here), ...stay.filter((r) => r.group === "works")].sort(newest),
      done: [...groups.done.filter(here), ...stay.filter((r) => r.group === "done")].sort(newest),
    };
  }

  /** Done's Clear: each marked seen and, the person's own press, home at once — but the chat open, which stays until it is left. */
  function clearDone() {
    if (o.place) {
      for (const r of groups.done) if (placed.has(r.chain)) placed.set(r.chain, -Infinity);
      for (const [c, went] of placed) if (went) placed.set(c, -Infinity);
      forced = true;
    }
    o.onSeen(groups.done.map((r) => r.chain));
    // Another machine's, seen there: each goes from here as its machine's list says it next.
    if (more.done.length) o.onSeenMore?.(more.done);
    // Where marking them seen drew nothing again, they go all the same.
    if (forced) refresh();
  }

  /** A row's title; one the side model just gave, writing itself in (`o.named`). @param {NowRow} r */
  const titleOf = (r) => {
    const since = r.thread || r.space ? null : o.named?.(r.chain, r.title) ?? null;
    return mk("span", { class: `now-title${since != null ? " is-named" : ""}` }, r.title);
  };
  /**
   * A row: its tile, its title, its project and its fact, its age; workers folded under a lead; in the bar's own Now,
   * another machine's asks' cards under its row (`bar`: the rail's popover is drawn once, and a card's press moves it).
   * @param {NowRow} r @param {number} now @param {boolean} placing @param {boolean} [bar]
   */
  function rowEl(r, now, placing, bar = false) {
    // Another machine's row (lib/desk.js): its machine's chip leads its line, it is greyed while that machine does not
    // answer, and a press opens it there — no menu, no Delete, no mark of this computer's.
    const there = /** @type {any} */ (r).machine ? /** @type {DeskRow} */ (r) : null;
    const away = there ? awayWords(there.machine) : "";
    const tile = mk("span", {
      class: `now-tile t-${r.tile}`,
      ...(r.tile === "model" ? { style: `--tile:${vendorOf(r.model).hue}` } : {}),
      html: /** @type {any} */ (ICONS)[r.icon] || ICONS.messageSquare,
    });
    const line = mk("span", { class: "now-line" },
      there
        ? mk("span", { class: `now-machine c-${there.machine.color}`, title: away || `On ${there.machine.name}` },
          mk("span", { class: "now-machine-ic", html: glyphOf(there.machine.icon) }), mk("span", { class: "now-machine-name" }, there.machine.name))
        : null,
      r.project ? mk("span", { class: `now-proj c-${chipTone(r.project)}` }, r.project) : null,
      mk("span", { class: `now-fact${r.tone ? ` ${r.tone}` : ""}` }, r.fact));
    // Where its chat works — a worktree's branch —, so chats of one project tell apart (the owner's of 10-31), and what
    // that place holds not on main yet, the mark its row under Projects wears too: a line of their own under the chip,
    // as a row under Projects has in a narrow bar — beside the chip they squeezed what the chat does out of the line.
    // Their hovers say the place whole. A chat another machine's agents started here says whose, first, as its row under
    // Projects does — at work, it stands here alone.
    const place = r.from || r.where || r.apart
      ? mk("span", { class: "now-line now-place" },
        r.from
          ? mk("span", { class: "now-where now-from", title: "Another machine's agents started this chat here" }, mk("span", { class: "now-where-ic", html: ICONS.bot }), mk("span", { class: "now-where-text" }, r.from))
          : null,
        r.where
          ? mk("span", { class: "now-where", title: r.where.title }, mk("span", { class: "now-where-ic", html: ICONS.gitBranch }), mk("span", { class: "now-where-text" }, r.where.text))
          : null,
        r.apart ? mk("span", { class: "now-apart", title: r.apart.title }, r.apart.text) : null)
      : null;
    const current = !r.thread && !!r.chain && r.chain === marked();
    // Finished since you looked, among those that stay seen (the bar's Done holds both).
    const unread = placing && r.group === "done" && !r.stay ? mk("span", { class: "now-unread", title: "Finished since you looked" }) : null;
    // Keyed (`data-key`) as the bar flies it: drawn again, a row is the element that stood, its handlers this draw's.
    const flip = there ? there.key : r.thread || r.space ? `now:${r.key}` : `chat:${r.chain}`;
    const go = () => (there ? o.onOpenMore?.(there) : o.onOpen(r));
    const row = mk("div", {
      class: `now-row is-${r.group}${current ? " is-current" : ""}${r.stay ? " is-stay" : ""}${there ? " is-there" : ""}${away ? " is-away" : ""}`,
      role: "button",
      tabindex: "0",
      "data-key": flip,
      "data-flip": flip,
      ...(there || r.thread || r.space ? {} : { "data-chain": r.chain }),
      ...(there ? { "data-machine": there.machine.id } : {}),
      ...(current ? { "aria-current": "page" } : {}),
      title: [r.title, there ? `on ${there.machine.name}` : "", r.project, r.from, r.where?.text, r.apart?.title, r.fact, away].filter(Boolean).join(" · "),
      onclick: go,
      onkeydown: (/** @type {KeyboardEvent} */ e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
        else if (e.key === "Delete" && o.onDelete && !there && !r.thread && !r.space) { e.preventDefault(); o.onDelete(r); }
      },
    }, tile,
      mk("span", { class: "now-text" }, titleOf(r), line, place),
      // A come-back's row says how long until it, where another row says how long since (the Designer's of 10-27).
      mk("span", { class: "now-age" }, unread, r.due ? comeBackInShort(r.due, now) : ageOf(r.at, now)));
    if (o.onMenu && !there && !r.thread && !r.space) {
      // The row the menu opens on is the one pressed: the element that stands, whichever draw made the handler.
      on(row, "contextmenu", (/** @type {MouseEvent} */ e) => {
        e.preventDefault();
        o.onMenu?.(r, /** @type {HTMLElement} */ (e.currentTarget || row));
      });
    }
    // Another machine's asks under its row in Needs you, answered here (desk-inbox.js): the row and its cards one.
    const cards = there && bar && o.askCards ? o.askCards(there, mk, { away, onOpen: go }) : [];
    if (cards.length) return mk("div", { class: "now-crew now-asks", "data-key": `crew:${flip}` }, row, ...cards);
    if (!r.under.length) return row;
    return mk("div", { class: "now-crew", "data-key": `crew:${flip}` }, row, ...r.under.map((u) => {
      /** Its own thread, in its chat; a team on the side's own chat. */
      const go = () => o.onOpen({ ...r, key: u.key, chain: u.chain || r.chain, thread: u.thread, title: u.name, under: [] });
      const title = u.thread ? `Open its thread: ${u.name}${u.yours ? " — you started it" : ""}` : `Open its chat: ${u.name}`;
      return mk("div", {
        class: "now-under", role: "button", tabindex: "0", "data-key": `line:${u.key}`, "data-flip": `line:${u.key}`, title, onclick: go,
        onkeydown: (/** @type {KeyboardEvent} */ e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
        },
      },
        mk("span", { class: "now-under-spin", html: ICONS.loader }),
        mk("span", { class: "now-under-name" }, u.name),
        // Between the name and the age, so a cut name never hides it (the Designer's answer of 10-27).
        u.yours ? mk("span", { class: "now-under-tag" }, "yours") : null,
        mk("span", { class: "now-age" }, ageOf(u.at, now)));
    }));
  }

  /** A group's head: its mark, its name, and Done's Clear. @param {"needs" | "works" | "done"} g */
  function groupHead(g) {
    const mark = g === "works" ? mk("span", { class: "now-gspin", html: ICONS.loader }) : mk("span", { class: `now-gdot ${g}` });
    const clear = g === "done"
      ? mk("button", { class: "now-clear", type: "button", title: "Mark them all seen", onclick: () => clearDone() }, "Clear")
      : null;
    return mk("div", { class: "now-group", "data-key": `group:${g}`, "data-flip": `group:${g}` }, mark, g === "needs" ? "Needs you" : g === "works" ? "Working" : "Done", clear);
  }

  /**
   * The groups' rows into `host`: Needs you, Working, Done — Done's newest three, the rest under Earlier. The bar's own
   * Now draws what stands in it: its Done whole, Earlier counting those still home.
   * @param {HTMLElement} host @param {{ bar?: boolean }} [w]  `bar`: the left bar's own Now
   */
  function fill(host, w = {}) {
    const placing = !!(w.bar && o.place);
    const g = w.bar ? view : groups;
    const now = Date.now();
    /** Its own rows and the other machines' as one, newest first. @param {NowRow[]} own @param {NowRow[]} theirs */
    const both = (own, theirs) => (theirs.length ? [...own, ...theirs].sort((a, b) => b.at - a.at) : own);
    /** The other machines' Done: their newest three, all once Earlier is pressed. */
    const theirDone = earlier ? more.done : more.done.slice(0, DONE_SHOWN);
    const needs = both(g.needs, more.needs);
    const works = both(g.works, more.works);
    /** @type {HTMLElement[]} */
    const nodes = [];
    if (needs.length) nodes.push(groupHead("needs"), ...needs.map((r) => rowEl(r, now, placing, !!w.bar)));
    if (works.length) nodes.push(groupHead("works"), ...works.map((r) => rowEl(r, now, placing)));
    const shown = both(placing || earlier ? g.done : g.done.slice(0, DONE_SHOWN), theirDone);
    if (shown.length) {
      nodes.push(groupHead("done"), ...shown.map((r) => rowEl(r, now, placing)));
      const own = placing ? (earlier ? 0 : groups.done.filter((r) => !r.thread && !placed.has(r.chain)).length) : earlier ? 0 : Math.max(0, g.done.length - DONE_SHOWN);
      const left = own + more.done.length - theirDone.length;
      if (left > 0) {
        nodes.push(mk("button", {
          class: "now-earlier", type: "button", "data-key": "now-earlier", "data-flip": "now-earlier",
          onclick: () => {
            earlier = true;
            if (o.place) refresh(true);
            else draw();
          },
        }, `Earlier (${left})`));
      }
    }
    drawIn(host, nodes);
  }

  /** Its rows drawn again, through the bar's `paint` where it has one. */
  function draw() {
    drawnAt = Date.now();
    if (o.paint) o.paint(paint);
    else paint();
  }

  function paint() {
    // The bar's Done shows by itself, so its Now is quiet only when it holds nothing at all — another machine's rows none.
    const theirs = more.needs.length + more.works.length + more.done.length;
    const quiet = o.place
      ? !groups.needs.length && !groups.works.length && !groups.done.length && !view.done.length && !theirs
      : !groups.needs.length && !groups.works.length && !more.needs.length && !more.works.length;
    /** What needs you, here and on the other machines. */
    const needing = groups.needs.length + more.needs.length;
    const chevron = (/** @type {boolean} */ down) => mk("span", { class: "now-chev", html: down ? ICONS.chevronDown : ICONS.chevronRight });
    if (quiet) {
      const words = quietWords(groups.done, Date.now());
      const head = mk("button", {
        class: "lb-sec now-head is-quiet",
        type: "button",
        "data-flip": "now-head",
        "aria-expanded": String(quietOpen),
        disabled: !groups.done.length ? "" : undefined,
        onclick: () => { quietOpen = !quietOpen; draw(); },
      }, mk("span", { class: "lb-sec-name" }, "Now"), mk("span", { class: "now-quiet" }, words), groups.done.length ? chevron(quietOpen) : null);
      const body = mk("div", { class: "now-body" });
      if (quietOpen) fill(body);
      drawIn(el, [head, body]);
      return;
    }
    const head = mk("button", {
      class: "lb-sec now-head",
      type: "button",
      "data-flip": "now-head",
      "aria-expanded": String(open),
      // Folded, the bar's chats all stay home, each its mark on its row.
      title: open ? (o.place ? "Fold Now: every chat stays in its project" : "Fold Now") : "Show Now",
      onclick: () => {
        open = !open;
        try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch {}
        if (o.place) refresh(true);
        else draw();
      },
    }, mk("span", { class: "lb-sec-name" }, "Now"),
      needing ? mk("span", { class: "now-count", title: `${needing} need${needing === 1 ? "s" : ""} you` }, String(needing)) : null,
      mk("span", { class: "grow" }), chevron(open));
    const body = mk("div", { class: "now-body" });
    if (open) fill(body, { bar: true });
    drawIn(el, [head, body]);
  }

  return {
    el,
    update,
    refresh,
    /** The rows into another host: the rail's popover. @param {HTMLElement} host */
    fill: (host) => fill(host),
    /** The first row that needs you, for Alt+N; null when nothing does. */
    next: () => groups.needs[0] || null,
    /** A chat's own row — needs you, working, done — else one of its threads'; null where Now has none. @param {string} chain */
    rowOf: (chain) => {
      const all = [...groups.needs, ...groups.works, ...groups.done];
      return all.find((r) => r.chain === chain && !r.thread) || all.find((r) => r.chain === chain) || null;
    },
    /** What a chat waits on you for, in its Needs you row's words — its own before its threads'; "" when nothing. @param {string} chain */
    factOf: (chain) => (groups.needs.find((r) => r.chain === chain && !r.thread) || groups.needs.find((r) => r.chain === chain))?.fact || "",
    /** Whether a chat stands in the bar's Now — drawn here, and not in its project. @param {string} chain */
    stands: (chain) => !!o.place && placed.has(chain),
    /**
     * A chat with nothing left to show here goes home to its project at once, open or not: Not now gave its message
     * back, so nothing ran and nothing finished (the owner's of 11-01). One Now still has a row for stays.
     * @param {string} chain
     */
    home(chain) {
      if (!o.place || !placed.has(chain)) return;
      sentHome = chain;
      forced = true;
      refresh();
    },
    /**
     * The feed said a chat's thread moved — its record changed, as when a check Filament ran ends, which the runs list
     * never shows (the review of 11-01: its agent read at work up to half a minute after) —: its threads are read at the
     * next poll, and a read on its way now is read again. @param {string} chain
     */
    threadsMoved(chain) {
      threadsHeard.set(chain, (threadsHeard.get(chain) || 0) + 1);
      threadsSaw.delete(chain);
    },
    get needs() { return groups.needs.length; },
    get works() { return groups.works.length; },
    /** Done's rows, for a quiet line of its own (`quietWords`). */
    get done() { return groups.done; },
    /** Its three groups as they stand: Your Space's Today reads them (S5b). */
    groups: () => groups,
    /**
     * The other machines' rows the bar's Now shows now, by key: none while it is folded, their Done's newest three until
     * Earlier is pressed — the rest stand in their projects (one chat, one place; the review of s1b).
     * @returns {Set<string>}
     */
    theirsShown: () => (open ? new Set([...more.needs, ...more.works, ...(earlier ? more.done : more.done.slice(0, DONE_SHOWN))].map((r) => r.key)) : new Set()),
  };
}
