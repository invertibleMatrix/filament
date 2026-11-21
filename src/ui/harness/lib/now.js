// @ts-check
// Now (proposal_ux §4.1, D7): what needs you, what works and what finished since you looked, across every project. It
// is made from what the page already reads — the runs list of the sidebar's five-second poll, the newest events of each
// turn that runs or waits, the threads of the chats whose agents run, the unread marks — and nothing here asks the
// server anything. DOM-free: the left bar draws it (now-list.js), the rail's list and Alt+N read the same rows.
//
// Who gets a row. A chat whose own agent works, waits for you or stopped on an error; a thread that asks you (one you
// started, or one that started by itself); a team in charge of a chat, as its lead's row with the workers folded under
// it. The agents at work for a chat — the main agent's and those you started, yours marked — and its teams on the side
// are lines under its row, in the order they started ("· 2 agents, 1 team" on it), and the row stays under Working while
// they work on after its turn (the Designer's answers of 10-26 and 10-27, on the owner's words: "when i fire a side
// agent myself, that should also show as a child of the session"). One that asks you leaves the lines for a row of its
// own until it is answered; one that failed or was cut off needs you until its thread is opened in the Agents tab, where
// its Retry is. A row only names what to open: nothing here answers, starts or sends. In the left bar a chat stands in
// Now or in its project, never in both (`placeChats`), and one that stays a while with nothing at work is `stayRow`'s.
// A chat whose agent set a come-back stays under Working until it comes (the Designer's of 10-27): its row says when,
// and how long until it in its age's slot (`due`); its Cancel is the chat's status's, never Now's.
// A chat's work stretch (sessions/stretch.js; the owner's of 11-03: "it should not reset the time but accumulate that
// time") goes on from the turn it began with through each turn that ended while a command of its agents ran or a
// sub-agent worked for its main agent, and the waits between: its row's age counts from the stretch's start, and between
// its turns it stays under Working, saying what it waits for.
import { callWords, sessionAge, turnStateWords, workingWords } from "./labels.js";
import { LEADS_APPLY, isGuest, leadApplies, needsYou, rowIcon, sideRow } from "./side.js";
import { commandsCount, commandsFact, commandsWaited } from "./commands.js";
import { comeBackFact, idleWakeFact } from "./come-back.js";
import { workerCalled } from "./team.js";

/**
 * The runs list's row (GET /api/runs; services/runs.js RunMeta).
 * @typedef {{ id: string, kind: string, status: string, startedAt: number, endedAt: number | null,
 *   parentId?: string | null, events?: number, meta?: any, summary?: any }} RunRow
 */

/**
 * A turn's newest events, folded: its round, the calls still open, its loop's state, and the question it waits on.
 * `n`: the newest event number read, which the next read starts after.
 * @typedef {{ n: number, round: number, calls: Map<string, { name: string, card: any }>, state: any,
 *   ask: { kind: string, id: string | null, question: string, at: number } | null }} RunFold
 */

/**
 * A row of Now. `tile`: what its tile is coloured by — `needs` orange, `model` the hue of the model that runs it
 * (`model`), `agent` an agent's blue, `lead` a team lead's purple, `done` gray. `tone`: how its fact line reads — asks
 * orange, error red. `under`: the lines under a chat's row — a lead's workers, then the agents at work for it and its
 * teams on the side (`NowLine`). `at`: when it got here, for its age. A chat's turn at work says its step apart
 * (`step`), and a lead's its team's name (`team`), for a reader that names them in words of its own (the Space's lanes).
 * `stay`: a chat that stands in the left bar's Now with nothing at work or waiting for it (`stayRow`), seen already.
 * `due`: a chat under Working for its come-back alone — its age's slot says how long until it ("in 18m").
 * `space`: a Space's button running (the owner's of 10-29) — no chat's; the row opens its dashboard's or app's tab.
 * `where`: where its chat works beside its project, when that is anywhere but a repository's main folder (a worktree's
 * branch, the sidebar's `whereLine`), so three chats of one project tell apart (the owner's of 10-31); `apart`: what that
 * place holds not on main yet (labels.js `apartMark`), its mark. `from`: whose agents started its chat here, where another
 * machine's did (labels.js `fromAgentsWords`), as its row under Projects says it.
 * @typedef {{ key: string, chain: string, thread: string | null, group: "needs" | "works" | "done", title: string,
 *   project: string, fact: string, tone: "asks" | "error" | "", icon: string, tile: "needs" | "model" | "agent" | "lead" | "done",
 *   model: string, at: number, under: NowLine[], team: string, step: string, stay?: boolean,
 *   due?: import("./come-back.js").ComeBack, space?: { project: string, name: string }, where?: PlaceWords | null,
 *   apart?: PlaceWords | null, from?: string }} NowRow
 */
/**
 * A chat's place in words, as its row says it and its hover says it whole.
 * @typedef {{ text: string, title: string }} PlaceWords
 */

/**
 * A Space's button running now, as the holders read says it (services/dashboard-runner.js `running()`).
 * @typedef {{ project: string, projectName?: string, name: string, title: string, label: string, by: string | null, startedAt: number }} AppRun
 */

/**
 * A line under a chat's row: an agent's thread (`thread`), or a team on the side, whose own chat it opens (`chain`,
 * `thread` null). `yours`: an agent you started, which the line marks.
 * @typedef {{ key: string, thread: string | null, name: string, at: number, yours?: boolean, chain?: string }} NowLine
 */
/**
 * A chat's work stretch while it goes on, as the server says it (sessions/stretch.js): its start, and between its turns
 * what keeps it — how many of its commands run, of its agents work for its main agent, of its coding agent's own
 * background tasks run, and of its teams beside it will send their result by themselves.
 * @typedef {{ since: number, waits?: { commands: number, agents: number, tasks: number, teams: number, checks?: number } | null }} Stretch
 */
/**
 * A flow at work, as the holders read says it (flow-runner.js `live()`): its chat, running, holding or cut by a restart
 * — which asks you for its Go on —, its line, whether it asks you, and since when.
 * @typedef {{ chainId: string, id: string, state: "running" | "holds" | "cut", line: string, asks: boolean, at: number }} FlowAtWork
 */

/** A team's name as a line or a row says it: "BugHunters team", never "… team team". @param {string} name */
export const teamLine = (name) => (/\bteam$/i.test(String(name).trim()) ? String(name).trim() : `${String(name).trim() || "A"} team`);

/** What works for a chat, counted: "2 agents", "2 agents, 1 team", "1 team". @param {number} agents @param {number} teams */
const atWorkWords = (agents, teams) => [agents ? `${agents} agent${agents === 1 ? "" : "s"}` : "", teams ? `${teams} team${teams === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");

/** The events a fold reads: the rest (a command's output, the words) never move a row. */
export const FOLD_TYPES = Object.freeze(new Set(["round-start", "tool-start", "tool-end", "turn-state", "ask", "ask-end"]));

/** How many of a turn's newest events the first read takes: enough for its round and its open calls. */
export const FOLD_TAIL = 240;

/** @returns {RunFold} */
export const blankFold = () => ({ n: 0, round: 0, calls: new Map(), state: null, ask: null });

/**
 * Fold a page of a turn's events into what it does now. A round's start closes the calls of the round before it (the
 * loop waits for them); a coding agent's question stays until its `ask-end`. A worker's question to its lead is its
 * lead's, never yours (HarnessV3-TaskGraph-v2 TG2-D49).
 * @param {RunFold} f @param {readonly any[]} events
 */
export function foldEvents(f, events) {
  for (const e of events) {
    if (Number.isFinite(e?.n)) f.n = Math.max(f.n, Number(e.n));
    const round = Number(e?.round) || 0;
    switch (e?.type) {
      case "round-start":
        if (round >= f.round) f.calls.clear();
        f.round = Math.max(f.round, round);
        break;
      case "tool-start":
        f.round = Math.max(f.round, round);
        f.calls.set(String(e.id), { name: String(e.name || ""), card: e.card || null });
        break;
      case "tool-end":
        f.calls.delete(String(e.id));
        break;
      case "turn-state":
        f.state = { to: e.to, why: e.why, tokens: e.tokens, retry: e.retry, queue: e.queue };
        break;
      case "ask":
        // An ask shown again waits since it was first asked.
        if (e.kind !== "lead") {
          const id = e.id != null ? String(e.id) : null;
          f.ask = { kind: String(e.kind || "question"), id, question: String(e.question || ""), at: id !== null && f.ask?.id === id ? f.ask.at : Number(e.ts) || 0 };
        }
        break;
      case "ask-end":
        if (!f.ask || f.ask.id == null || f.ask.id === String(e.id)) f.ask = null;
        break;
    }
  }
  return f;
}

/** Words on one line: a row's CSS cuts what does not fit, and its hover says it whole. @param {unknown} s */
const oneLine = (s) => String(s || "").replace(/\s+/g, " ").trim();

/**
 * What a waiting question asks of you, in a row's words.
 * @param {NonNullable<RunFold["ask"]>} a
 */
export function askLine(a) {
  if (a.kind === "proposal") return "its plan waits for your yes";
  if (a.kind === "permission") return a.question ? `waits for your yes: ${oneLine(a.question)}` : "waits for your yes";
  return a.question ? `asks: ${oneLine(a.question)}` : "asks you";
}

/**
 * What a turn does now, as its row says it: "round 75 · running node render.mjs". The call running now by its card;
 * several at once, counted; none, the loop's own state; nothing read yet, "working".
 * @param {RunFold | null | undefined} f
 */
export function foldLine(f) {
  if (!f) return "working";
  const calls = [...f.calls.values()];
  const doing = calls.length === 1 ? callWords(calls[0]) : calls.length > 1 ? `running ${calls.length} tool calls` : turnStateWords(f.state) || "working";
  return [f.round ? `round ${f.round}` : "", doing].filter(Boolean).join(" · ");
}

/** A chat's own turns, not a sub-agent's run nor a replay. @param {RunRow} r */
const isTurn = (r) => r.kind === "agent-turn" || r.kind === "coding-agent";
/** A run that still goes. @param {RunRow} r */
const goes = (r) => r.endedAt == null && r.status === "running";
/**
 * The model a run runs on, as the catalogue names it: a coding agent's run names its model apart from the agent
 * (`opus-xhigh` of `claude-code-northwind`), which the catalogue spells `claude-code-northwind/opus-xhigh`.
 * @param {RunRow | null | undefined} r
 */
const modelOf = (r) => {
  const model = String(r?.meta?.model || "");
  const agent = r?.kind === "coding-agent" ? String(r.meta?.upstream || "") : "";
  return agent && model && !model.includes("/") ? `${agent}/${model}` : model;
};

/**
 * The runs a fold should follow: each chat's newest turn that goes or waits on you (paused), newest first, at most
 * `max` of them.
 * @param {readonly RunRow[]} runs @param {number} [max]
 */
export function runsToFold(runs, max = 6) {
  const seen = new Set();
  /** @type {RunRow[]} */
  const out = [];
  for (const r of runs) {
    const chain = String(r.meta?.chain || "");
    if (!isTurn(r) || !chain || seen.has(chain)) continue;
    seen.add(chain);
    if (goes(r) || r.status === "paused") out.push(r);
  }
  return out.slice(0, max);
}

/**
 * The chats whose threads Now reads: those with a sub-agent's run in the list, newest first — the main agent's helpers,
 * your threads, a team's workers — every one (the owner's of 10-28: four at most left a fifth chat's thread that asked
 * you out of Now; `readInTurns` keeps the reads few at a time).
 * @param {readonly RunRow[]} runs
 */
export function chainsWithThreads(runs) {
  /** @type {string[]} */
  const out = [];
  for (const r of runs) {
    const chain = String(r.meta?.chain || "");
    if (r.kind === "subagent" && chain && !out.includes(chain)) out.push(chain);
  }
  return out;
}

/**
 * A thread whose record says it runs while the runs list has ended its run: its exchange closes a moment after its run,
 * once its work is captured and its report handed on (the drive of 11-01: most of a second) — its record is read again
 * at the next poll, its word standing meanwhile (the review of 11-01: the list's word dropped a team's worker for that
 * moment). Never one Filament runs the check of (`progress.check`, TG2-D45): a check has no clock, so its record is
 * read as its runs move, or every half a minute, as any thread's is. @param {any} t @param {readonly RunRow[]} runs
 */
export const behindItsRun = (t, runs) => t?.status === "running" && !t.progress?.check && !!t.runId && runs.some((r) => r.id === t.runId && r.endedAt != null);

/**
 * Whether a thread has a row under Needs you (`nowRows`): one you started, or one that started by itself, or a team's
 * worker, that asks you or whose changes wait for your Apply. @param {any} r
 */
const threadNeedsYou = (r) => !isGuest(r) && needsYou(r) && (r.origin === "owner" || r.origin === "command" || r.origin === "self" || !!r.team);

/**
 * The chats Now reads on though no sub-agent's run of theirs is in the runs list now (the owner's of 10-28): one with a
 * thread that needs you, or whose agent failed and you have not seen it — each stays under Needs you until it is
 * answered, applied or opened.
 * @param {ReadonlyMap<string, readonly any[]>} threads @param {(r: any) => boolean} seen
 */
export function chainsThatNeed(threads, seen) {
  return [...threads].filter(([, list]) => list.some((r) => threadNeedsYou(r) || (agentFailure(r) && !seen(r)))).map(([c]) => c);
}

/**
 * Each item's read, `n` at a time, all of them before it ends (the owner's of 10-28): a browser holds six connections to
 * a host, which the runs list and the turns' folds share with every chat's threads read at once.
 * @template T @param {readonly T[]} items @param {(item: T) => Promise<unknown>} read @param {number} n
 */
export async function readInTurns(items, read, n) {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await read(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.max(0, Math.min(n, items.length)) }, lane));
}

/**
 * A chat as Now names it: its title, its project, where it works beside it and what that place holds not on main yet
 * (`NowRow`'s `where` and `apart`), whose agents started it where another machine's did (`from`), its newest activity.
 * @typedef {{ title: string, project: string, when: number, unread: boolean, where?: PlaceWords | null, apart?: PlaceWords | null, from?: string }} ChatFacts
 */

/**
 * Now's three groups.
 * @param {{ runs: readonly RunRow[], folds: ReadonlyMap<string, RunFold>, threads: ReadonlyMap<string, readonly any[]>,
 *   chats: (chain: string) => ChatFacts | null, unread: ReadonlySet<string>, holders: ReadonlyMap<string, any>,
 *   commands?: ReadonlyMap<string, readonly import("./commands.js").CommandRow[]>, seen?: (r: any) => boolean, now: number,
 *   beside?: (chain: string) => { main: string, name: string } | null,
 *   comeBacks?: ReadonlyMap<string, import("./come-back.js").ComeBack>, idleWakes?: ReadonlyMap<string, import("./come-back.js").IdleWake>,
 *   stretches?: ReadonlyMap<string, Stretch>,
 *   flows?: ReadonlyMap<string, readonly FlowAtWork[]>, apps?: readonly AppRun[],
 *   asked?: ReadonlyMap<string, { line: string, at: number, working?: boolean }>,
 *   compacting?: ReadonlyMap<string, { at: number }> }} o
 *   `chats`: a chain's title, project and newest activity; `unread`: the chains finished since you looked; `holders`:
 *   who holds each session's turn (another tab's turn shows as working); `commands`: the commands each chat's agents
 *   run in the background (HarnessV4_Background_Plan E38-D1) — a working row counts them, and a chat whose turn ended
 *   stays under Working while one runs, its turn's end said first where it is unread; `seen`: whether a thread's
 *   failure was seen (lib/failures-seen.js) — none is, left out; `beside`: a team on the side's chat — the chat it works
 *   for and its team — whose turn at work is a line under that chat's row; none known (the tray's Now), a row of its own;
 *   `comeBacks`: each chat's come-back while it waits (the Designer's of 10-27) — a chat whose turn ended stays under
 *   Working until it comes, as it does for a command, its row saying when; `idleWakes`: each chat's check-in on its agent
 *   idle while its command runs (app/sessions/idle-wake.js, the owner's of 11-08), its row saying when; `stretches`: each chat's work stretch while
 *   it goes on (the owner's of 11-03) — its turn's row and its row between turns count their age from its start, and
 *   between turns it stays under Working, its row saying what keeps it as the server counts it; `flows`: each chat's flows at work (the
 *   owner's of 10-28) — a chat whose turn ended stays under Working while one runs, its line on the row, and one that asks
 *   you (your review, a gate, a box that failed) is a row of its own under Needs, which opens the chat; `apps`: the
 *   Spaces' buttons running now (the owner's of 10-29) — an app's build, a dashboard's roll back —, each a row of its own
 *   under Working, which opens its tab; `asked`: each chat whose message a card stopped before it was sent, the card's
 *   question and when it stopped — the chat needs you, whatever its newest run says (the page's own: no other knows) —;
 *   or, `working`, the page at work for that message — room made for it, or the message gone again, its answer on its
 *   way —, in its words, under Working where neither a run nor a holder says more; `compacting`: each chat whose
 *   compaction is written between its turns, and when it began (0: asked, its start not said yet) — under Working while
 *   it is, saying so (the owner's of 11-21).
 * @returns {{ needs: NowRow[], works: NowRow[], done: NowRow[] }}
 */
export function nowRows(o) {
  /** @type {NowRow[]} */
  const needs = [];
  /** @type {NowRow[]} */
  const works = [];
  /** @type {NowRow[]} */
  const done = [];
  const facts = (/** @type {string} */ chain) => o.chats(chain) || { title: "a chat", project: "", when: 0, unread: false };
  /**
   * A row of the chat's. A thread's — a sub-agent's, which may work in a copy of its own — says no place: where the chat
   * works and what it holds apart are its chat's row's.
   * @param {string} chain @param {Partial<NowRow>} r @returns {NowRow}
   */
  const row = (chain, r) => ({ key: `chat:${chain}`, chain, thread: null, group: "works", title: facts(chain).title, project: facts(chain).project, where: (!r.thread && facts(chain).where) || null, apart: (!r.thread && facts(chain).apart) || null, from: (!r.thread && facts(chain).from) || "", fact: "", tone: "", icon: "messageSquare", tile: "model", model: "", at: 0, under: [], team: "", step: "", ...r });

  // The chats whose newest turn is at work, or waits on you in its middle: where a team leads one, its lead holds it.
  /** @type {Set<string>} */
  const atTurn = new Set();
  /** @type {Set<string>} */
  const turnRead = new Set();
  for (const r of o.runs) {
    const chain = String(r.meta?.chain || "");
    if (!isTurn(r) || !chain || turnRead.has(chain)) continue;
    turnRead.add(chain);
    if (goes(r) || r.status === "paused") atTurn.add(chain);
  }
  // Each chat's threads, by what they need: one that asks you gets a row — yours, a self-started one's, a worker's; a
  // team's workers fold under its lead; the agents at work for it, the main agent's and yours, are lines under its row;
  // one whose failure you have not seen needs you.
  // A worker's change that waits is its lead's to apply while its team leads the chat (`team.charge`, as the chat's
  // settings say) and its lead is at work — at its turn, or due back for a worker still at work: a line under the
  // lead's row (`waits`). The lead gone, or the chat handed back to your agent, it is yours: a row under Needs you.
  /** @type {Map<string, { team: string, workers: any[], waits: any[], helpers: number, agents: any[] }>} */
  const crews = new Map();
  // Each chat's flows at work (the owner's of 10-28): one that asks you needs you; the rest keep it at work.
  /** @param {string} chain */
  const flowsGoing = (chain) => (o.flows?.get(chain) || []).filter((x) => !x.asks);
  for (const [chain, list] of o.flows || []) {
    for (const x of list) if (x.asks) needs.push(row(chain, { key: `flow:${x.id}`, group: "needs", fact: x.line, tone: "asks", tile: "needs", icon: "waypoints", at: Number(x.at) || o.now }));
  }
  for (const [chain, list] of o.threads) {
    const crew = { team: "", workers: /** @type {any[]} */ ([]), waits: /** @type {any[]} */ ([]), helpers: 0, agents: /** @type {any[]} */ ([]) };
    // The workers whose change waits for their lead's apply (lib/side.js `leadApplies`).
    const leads = leadApplies(list, atTurn.has(chain));
    /** A thread's row under Needs you. @param {any} r */
    const needsRow = (r) => {
      const w = sideRow(r, o.now);
      return row(chain, { key: `thread:${r.id}`, thread: String(r.id), title: `${w.name} · for ${facts(chain).title}`, icon: rowIcon(r), model: String(r.model || ""), group: "needs", fact: w.fact, tone: "asks", tile: "needs", at: askedAt(r) });
    };
    for (const r of list) {
      if (isGuest(r)) continue;
      const yours = r.origin === "owner" || r.origin === "command";
      const mine = yours || (r.origin === "self" && needsYou(r));
      if (r.team?.name && r.status === "running") {
        crew.team = String(r.team.name);
        crew.workers.push(r);
      } else if (r.status === "running" && (r.origin === "agent" || (yours && !needsYou(r)))) {
        crew.helpers++;
        crew.agents.push(r);
      }
      const failed = agentFailure(r);
      if (failed && !o.seen?.(r)) {
        const w = sideRow(r, o.now);
        needs.push(row(chain, { key: `thread:${r.id}`, thread: String(r.id), title: `${w.name} · for ${facts(chain).title}`, icon: rowIcon(r), model: String(r.model || ""), group: "needs", fact: failed, tone: "error", tile: "agent", at: Number(r.exchanges?.at(-1)?.endedAt) || Number(r.startedAt) || 0 }));
      }
      if (!needsYou(r) || !(mine || r.team)) continue;
      if (leads.has(String(r.id))) crew.waits.push(r);
      else needs.push(needsRow(r));
    }
    if (crew.waits.length) crew.team ||= String(crew.waits[0].team.name || "");
    crews.set(chain, crew);
  }

  // The teams on the side at work, whoever started them, by the chat they work for: a line each under its row, as the
  // Projects list draws them — the lead and its workers in the team's own chat, a click away (the Designer's answer of
  // 10-27). One whose lead asks you keeps a row of its own.
  /** @type {Map<string, { chain: string, name: string, at: number }[]>} */
  const sides = new Map();
  /** The side teams' chats drawn as lines. @type {Set<string>} */
  const asLines = new Set();
  const newestTurns = new Set();
  for (const r of o.runs) {
    const chain = String(r.meta?.chain || "");
    if (!isTurn(r) || !chain || newestTurns.has(chain)) continue;
    newestTurns.add(chain);
    const side = o.beside?.(chain) || null;
    // At work while its lead's turn goes, or its workers work on after it (the Hunter's find of 10-27).
    const working = goes(r) || (r.status !== "paused" && !!crews.get(chain)?.workers.length);
    if (!side || !working || o.folds.get(r.id)?.ask) continue;
    sides.set(side.main, [...(sides.get(side.main) || []), { chain, name: teamLine(side.name), at: r.startedAt }]);
    asLines.add(chain);
  }
  // Each chat's newest turn. One over says nothing of its own (`over`) where it was read, or where the page is at work on
  // a message sent since: what the chat does now stands — a turn the server holds for it before the list has its run,
  // the page making room for its message or sending it again (the drive of 11-01: a chat with a turn finished before
  // read "finished" all the while its Compact and send made room; the review of 11-01: unread, too).
  const seen = new Set();
  const over = new Set();
  // A message a card stopped before it was sent waits for your answer, in the card's words: nothing ran, so nothing
  // finished (the owner's of 11-01: the chat stood under Done, "finished", though nothing was sent).
  for (const [chain, a] of o.asked || []) {
    if (a.working) continue;
    seen.add(chain);
    needs.push(row(chain, { group: "needs", fact: askLine({ kind: "card", id: null, question: a.line, at: a.at }), tone: "asks", tile: "needs", icon: "hand", at: a.at }));
  }
  for (const r of o.runs) {
    const chain = String(r.meta?.chain || "");
    if (!isTurn(r) || !chain || seen.has(chain) || over.has(chain)) continue;
    if (!goes(r) && r.status !== "paused" && !asLines.has(chain) && (!o.unread.has(chain) || o.asked?.get(chain)?.working === true)) {
      over.add(chain);
      continue;
    }
    seen.add(chain);
    const f = o.folds.get(r.id) || null;
    const crew = crews.get(chain);
    const model = modelOf(r);
    if (asLines.has(chain)) continue;
    if (r.status === "paused" || (goes(r) && f?.ask)) {
      needs.push(row(chain, { group: "needs", fact: f?.ask ? askLine(f.ask) : "waits for your yes", tone: "asks", tile: "needs", icon: "hand", model, at: f?.ask?.at || Number(r.endedAt) || r.startedAt }));
    } else if (goes(r)) {
      const lead = !!crew?.team;
      const others = atWorkWords(crew?.helpers || 0, sides.get(chain)?.length || 0);
      const more = lead ? [counted(crew?.workers.length || 0, "worker", "workers"), others].filter(Boolean).join(", ") : others;
      // A team in charge keeps its chat's title on the row, its team on the line, so the row reads the same in Now and
      // in its project (the Designer's of 10-27); a chat nothing names (the tray's team chats) is named by its team.
      const known = !!o.chats(chain);
      works.push(row(chain, {
        ...(lead ? { icon: "users", tile: /** @type {const} */ ("lead"), ...(known ? {} : { title: `${crew?.team} · lead` }) } : {}),
        fact: [lead && known ? `${crew?.team} leads` : "", foldLine(f), more, commandsCount(o.commands?.get(chain)), flowsFact(flowsGoing(chain))].filter(Boolean).join(" · "),
        team: lead ? String(crew?.team || "") : "",
        step: foldLine(f),
        model,
        // From its work stretch's start where the turn goes on with one: the turns before it and the waits between count.
        at: o.stretches?.get(chain)?.since || r.startedAt,
        under: lead ? crewLines(crew) : [],
      }));
    } else if (o.unread.has(chain)) {
      const failed = r.status === "error" || r.status === "failed";
      // A chat's failure in the words an agent's is said in, and kept as it goes on to Done once seen (stayRow).
      if (failed) needs.push(row(chain, { group: "needs", fact: failedWords(r), tone: "error", icon: "circleAlert", model, at: Number(r.endedAt) || r.startedAt }));
      else done.push(row(chain, { group: "done", fact: r.status === "stopped" || r.status === "aborted" ? "stopped" : "finished", icon: "check", tile: "done", model, at: Number(r.endedAt) || r.startedAt }));
    }
  }
  // Another tab's turn, or a chat's move, on a session this page runs nothing in. A team on the side's chat is said as a
  // line under the chat it works for once the list has its turn, never as a row of its own (the review of 11-01: placed,
  // it stood a minute as finished once the line took its place).
  for (const [chain, holder] of o.holders) {
    if (seen.has(chain) || o.beside?.(chain)) continue;
    seen.add(chain);
    works.push(row(chain, { fact: workingWords(holder), at: o.stretches?.get(chain)?.since || Number(holder?.since) || o.now }));
  }
  // The page at work for a message a card stopped — room made for it, or the message gone again — where nothing above
  // says so: the server holds no turn while room is made, nor before it hears the message (the review of 11-01: the chat
  // read "asks" all the while its Compact and send made room).
  for (const [chain, a] of o.asked || []) {
    if (!a.working || seen.has(chain)) continue;
    seen.add(chain);
    works.push(row(chain, { fact: a.line, at: a.at }));
  }
  // Finished since you looked, where no run in the list says more.
  for (const chain of o.unread) {
    if (seen.has(chain)) continue;
    const c = o.chats(chain);
    if (c) done.push(row(chain, { group: "done", fact: "finished", icon: "check", tile: "done", at: c.when }));
  }
  // A chat whose turn is over while agents or teams work on for it (the Designer's answers of 10-26 and 10-27), a
  // command of its agents runs (E38-D1) or the come-back its agent set waits (the Designer's of 10-27): under Working,
  // not Done — its end first where you have not read it, then what works, its lines under it ("at work": one you started
  // after its turn was never "still" at it), then when it comes back; the terminal's tile where commands keep it there,
  // the timer's where its come-back alone does, and how long until it in the age's slot. One that needs you stays there;
  // one at work counted them above.
  // A team in charge whose lead's turn is over while its workers work on (the Hunter's find of 10-27) stays too, as its
  // lead's row: the team on its line, the workers under it.
  // A chat whose work stretch goes on between its turns (the owner's of 11-03) stays too, its end not said — its agent
  // waits, it has not finished —, what keeps it in its place as the server counts it (`waitWords`), its age from the
  // stretch's start.
  const busy = new Set([
    ...[...(o.commands || [])].filter(([, l]) => l?.length).map(([c]) => c),
    ...[...crews].filter(([, c]) => c.agents.length || c.workers.length).map(([c]) => c),
    ...sides.keys(),
    ...(o.comeBacks?.keys() || []),
    ...(o.idleWakes?.keys() || []),
    ...[...(o.flows || [])].filter(([c]) => flowsGoing(c).length).map(([c]) => c),
    ...(o.stretches?.keys() || []),
  ]);
  for (const chain of busy) {
    const list = o.commands?.get(chain) || [];
    const crew = crews.get(chain);
    const agents = crew?.agents || [];
    const workers = crew?.workers || [];
    const teams = sides.get(chain) || [];
    const back = o.comeBacks?.get(chain) || null;
    const idle = o.idleWakes?.get(chain) || null;
    const flowing = flowsGoing(chain);
    const stretch = o.stretches?.get(chain) || null;
    const since = stretch?.since || 0;
    const key = `chat:${chain}`;
    if (asLines.has(chain) || needs.some((r) => r.key === key) || works.some((r) => r.key === key)) continue;
    const at = done.findIndex((r) => r.key === key);
    const ended = at >= 0 ? done.splice(at, 1)[0] : null;
    const newestRun = o.runs.find((r) => isTurn(r) && String(r.meta?.chain || "") === chain);
    const lead = workers.length > 0;
    const known = !!o.chats(chain);
    const working = [lead ? `${workers.length} worker${workers.length === 1 ? "" : "s"}` : "", atWorkWords(agents.length, teams.length)].filter(Boolean).join(", ");
    const alone = !since && !working && !list.length && !flowing.length;
    works.push(row(chain, {
      fact: (since
        ? [lead && known ? `${crew?.team} leads` : "", waitWords(stretch?.waits, list, lead), idle ? idleWakeFact(idle) : "", flowsFact(flowing), back ? comeBackFact(back) : ""]
        : [ended?.fact || "", lead && known ? `${crew?.team} leads` : "", working ? `${working} at work` : "", list.length ? commandsFact(list) : "", idle ? idleWakeFact(idle) : "", flowsFact(flowing), back ? comeBackFact(back) : ""]).filter(Boolean).join(" · "),
      ...(lead ? { icon: "users", tile: /** @type {const} */ ("lead"), ...(known ? {} : { title: `${crew?.team} · lead` }) } : working || (since && !list.length && !flowing.length) ? {} : { icon: list.length ? "terminal" : flowing.length ? "waypoints" : "timer" }),
      team: lead ? String(crew?.team || "") : "",
      model: newestRun ? modelOf(newestRun) : "",
      at: since || (alone ? ended?.at || o.chats(chain)?.when || o.now : Math.min(...list.map((c) => Number(c.startedAt) || o.now), ...[...workers, ...agents].map((a) => Number(a.startedAt) || o.now), ...teams.map((t) => Number(t.at) || o.now), ...flowing.map((x) => Number(x.at) || o.now))),
      under: crewLines(crew),
      ...(alone && back ? { due: back } : {}),
    }));
  }
  // A chat whose compaction is written between its turns — its Compact, /autofit — (the owner's of 11-21: "when open a
  // chat and compact this, then it should move from project to Working section"): under Working while it is, saying so,
  // first on a row at work for it already, and out of Done, whose end it no longer is. One that needs you stays there.
  for (const [chain, c] of o.compacting || []) {
    const key = `chat:${chain}`;
    if (asLines.has(chain) || needs.some((r) => r.key === key)) continue;
    const at = works.find((r) => r.key === key);
    if (at) {
      at.fact = ["compacting", at.fact].filter(Boolean).join(" · ");
      continue;
    }
    const ended = done.findIndex((r) => r.key === key);
    if (ended >= 0) done.splice(ended, 1);
    const newestRun = o.runs.find((r) => isTurn(r) && String(r.meta?.chain || "") === chain);
    works.push(row(chain, { fact: "compacting", model: newestRun ? modelOf(newestRun) : "", at: Number(c?.at) || o.now }));
  }
  // What works for a chat, as lines under its row wherever it stands — after a lead's workers — in the order they
  // started, so a new one comes in at the foot: the agents at work, yours marked, and its teams on the side.
  for (const r of [...needs, ...works]) {
    if (r.thread) continue;
    const agents = crews.get(r.chain)?.agents || [];
    const teams = sides.get(r.chain) || [];
    if (!agents.length && !teams.length) continue;
    /** @type {{ start: number, line: NowLine }[]} */
    const lines = [
      ...agents.map((a) => ({ start: Number(a.startedAt) || 0, line: { key: `thread:${a.id}`, thread: String(a.id), name: agentName(a), at: Number(a.exchanges?.at(-1)?.startedAt ?? a.startedAt) || 0, ...(a.origin === "agent" ? {} : { yours: true }) } })),
      ...teams.map((t) => ({ start: Number(t.at) || 0, line: { key: `chat:${t.chain}`, thread: null, chain: t.chain, name: t.name, at: Number(t.at) || 0 } })),
    ];
    r.under = [...r.under, ...lines.sort((a, b) => a.start - b.start).map((x) => x.line)];
  }
  for (const x of o.apps || []) {
    works.push({
      key: `app:${x.name}`, chain: "", thread: null, group: "works", title: String(x.title || x.name), project: String(x.projectName || ""),
      fact: `“${x.label}” is running${x.by ? ` · pressed by ${x.by}` : ""}`, tone: "", icon: "play", tile: "agent", model: "",
      at: Number(x.startedAt) || o.now, under: [], team: "", step: "", space: { project: String(x.project), name: String(x.name) },
    });
  }
  const newest = (/** @type {NowRow} */ a, /** @type {NowRow} */ b) => b.at - a.at;
  return { needs: needs.sort(newest), works: works.sort(newest), done: done.sort(newest) };
}

/** A count in a row's words: "1 agent", "2 agents", "" for none. @param {number} n @param {string} one @param {string} many */
const counted = (n, one, many) => (n > 0 ? `${n} ${n === 1 ? one : many}` : "");

/**
 * What a chat's agent waits for between the turns of its work stretch, as its row says it: what the server counts keeping
 * it (`Stretch`'s `waits`) — its agents (a lead's workers), its teams beside it, its coding agent's own tasks, its task
 * graph's checks Filament runs (the owner's of 11-06) — and the commands the page holds, the same ones the server
 * counts: "waiting for 2 agents and 1 command: npm test". "working" where none is said: the turn its agent is woken with
 * on its way.
 * @param {Stretch["waits"]} w @param {readonly import("./commands.js").CommandRow[]} list @param {boolean} lead
 */
export function waitWords(w, list, lead) {
  const what = [counted(Number(w?.agents) || 0, lead ? "worker" : "agent", lead ? "workers" : "agents"), counted(Number(w?.teams) || 0, "team", "teams"), counted(Number(w?.tasks) || 0, "task", "tasks"), counted(Number(w?.checks) || 0, "check", "checks"), commandsWaited(list)].filter(Boolean);
  if (!what.length) return "working";
  return `waiting for ${what.length > 1 ? `${what.slice(0, -1).join(", ")} and ${what.at(-1)}` : what[0]}`;
}

/**
 * A chat's flows at work, as its row says them: the one's own line ("Flow · step 1 of 3"), else how many.
 * @param {readonly FlowAtWork[]} list
 */
const flowsFact = (list) => (list.length === 1 ? list[0].line : list.length ? `${list.length} flows at work` : "");

/** When a thread began to need you: its question's time, else its newest exchange's end. @param {any} r */
const askedAt = (r) => Number(r.progress?.asking?.at) || Number(r.exchanges?.at(-1)?.endedAt) || Number(r.startedAt) || 0;

/** An agent at work under its chat, the main agent's or yours: its name, what it was asked. @param {any} r */
function agentName(r) {
  const who = String(r.card?.name || "agent");
  const what = oneLine(r.exchanges?.at(-1)?.description || r.description);
  return what && what !== who ? `${who} · ${what}` : who;
}

/** Whose agents' failures need you: the main agent's, and those you asked yourself — in Start…, or by a command. */
const FAILS_FOR_YOU = Object.freeze(new Set(["agent", "owner", "command"]));

/**
 * Where an agent ended in a way that needs you (the Designer's answer of 10-26; yours too since 10-26): failed, or cut
 * off, never by a stop — the person's, the main agent's, or its turn's, which cut it with `stoppedBy` — and never at a
 * budget, where it stopped as told. Said with its failure's own short words. A team's worker's is its lead's, a graph
 * task's its graph's, which sends it back, and one that started by itself is left to its next start. Null where it
 * needs nothing.
 * @param {any} r @returns {string | null}
 */
export function agentFailure(r) {
  if (!FAILS_FOR_YOU.has(r?.origin) || r.team || r.task || (r.status !== "failed" && r.status !== "aborted")) return null;
  const out = r.exchanges?.at(-1)?.outcome || null;
  if (out?.stoppedBy) return null;
  const cut = r.status === "aborted" || !!r.cut;
  const said = r.cut ? "Filament restarted before it finished" : oneLine(out?.failure?.said || "");
  return `${cut ? "cut off" : "failed"}${said ? `: ${said}` : ""}`;
}

/**
 * A lead's lines under its row: its workers at work, then each whose change waits for the lead's apply, in those words.
 * @param {{ workers: any[], waits: any[] } | null | undefined} crew @returns {NowLine[]}
 */
function crewLines(crew) {
  return [
    ...(crew?.workers || []).map((w) => ({ key: `thread:${w.id}`, thread: String(w.id), name: workerName(w), at: Number(w.exchanges?.at(-1)?.startedAt ?? w.startedAt) || 0 })),
    ...(crew?.waits || []).map((w) => ({ key: `thread:${w.id}`, thread: String(w.id), name: `${workerName(w)} · ${counted(Number(w.work?.pending) || 0, "file", "files")} ${LEADS_APPLY}`, at: askedAt(w) })),
  ];
}

/** A team's worker under its lead: what it is called (`workerCalled`), its task, its first words. @param {any} r */
function workerName(r) {
  const who = workerCalled(r) || String(r.team?.role || "worker");
  const what = oneLine(r.exchanges?.at(-1)?.description || r.description);
  return [who, [r.task || "", what].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
}

/** A row's age, in one word: 2m, 3h, 4d. @param {number} at @param {number} now */
export const ageOf = (at, now) => (at > 0 ? sessionAge(new Date(Math.min(at, now)).toISOString()) : "");

/**
 * How Now folds when nothing runs and nothing waits: one line — "Nothing running · 2 finished today" — the count of
 * those that finished today, else of all that finished since you looked.
 * @param {readonly NowRow[]} done @param {number} now
 */
export function quietWords(done, now) {
  const d = new Date(now);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const n = done.filter((r) => r.at >= today).length;
  return ["Nothing running", n ? `${n} finished today` : done.length ? `${done.length} finished` : ""].filter(Boolean).join(" · ");
}

/** How many Done rows show before the rest fold under Earlier. */
export const DONE_SHOWN = 3;

/** How long a chat stays in the left bar's Now once nothing works or waits for it, before it goes home to its project. */
export const QUIET_MS = 60_000;

/**
 * Which chats stand in the left bar's Now (the Designer's of 10-27, on the owner's words: "two same things showing at
 * the same time is not a good design"): a chat stands in Now while Now has a row of its own for it, and in its project
 * otherwise — one row, so one selection. One whose row went stays a quiet minute, so a reply within it never moves it,
 * and the chat open stays until it is left. While `held` — the pointer on the bar — none comes or goes, though one
 * that went quiet starts its minute. Folded, Now holds none: every chat stays home.
 * @param {ReadonlyMap<string, number>} placed  chain → when its row went (0 while Now has one; -Infinity: home at once)
 * @param {ReadonlySet<string>} wanted  the chats Now has a row of their own for
 * @param {{ now: number, current: string | null, open: boolean, held: boolean, quietMs?: number }} o
 * @returns {Map<string, number>}
 */
export function placeChats(placed, wanted, o) {
  /** @type {Map<string, number>} */
  const next = new Map();
  if (!o.open) return next;
  const quiet = o.quietMs ?? QUIET_MS;
  for (const [chain, went] of placed) {
    if (wanted.has(chain)) {
      next.set(chain, 0);
      continue;
    }
    const since = went || o.now;
    if (o.held || chain === o.current || o.now - since < quiet) next.set(chain, since);
  }
  if (!o.held) for (const chain of wanted) if (!next.has(chain)) next.set(chain, 0);
  return next;
}

/**
 * Who holds each chat's turn as Now reads it: the server's word — and, for a chat a send of this page waits in, its
 * answer on its way (state.js `atWork` reads it as at work), the holder read last for it while the server's word is
 * gone. The server lets go of a chat as a card stops its message, and the page hears that before it hears the card: in
 * between, Now drew the open chat under Done, "finished" (the drive of 11-01). `kept` holds, from one read to the next,
 * the holder of each chat sent in; a chat no send waits in is let go of.
 * @param {ReadonlyMap<string, any>} holders @param {Iterable<string>} sending @param {Map<string, any>} kept
 * @returns {ReadonlyMap<string, any>}
 */
export function holdersWhileSent(holders, sending, kept) {
  const waits = new Set(sending);
  for (const chain of [...kept.keys()]) if (!waits.has(chain)) kept.delete(chain);
  /** @type {Map<string, any> | null} */
  let out = null;
  for (const chain of waits) {
    const held = holders.get(chain);
    if (held) kept.set(chain, held);
    else if (kept.has(chain)) (out ||= new Map(holders)).set(chain, kept.get(chain));
  }
  return out || holders;
}

/** A chat's failed turn in a word and its error's first line: "failed: the connection was reset". @param {any} r */
const failedWords = (r) => {
  const said = oneLine(r?.summary?.error || "");
  return `failed${said ? `: ${said}` : ""}`;
};

/**
 * A chat that stands in the left bar's Now with nothing at work or waiting for it — in its quiet minute, or open —
 * under Done: its last turn's end in a word, seen already. A failure keeps its words and its alert, in the error's
 * tone, on Done's tile (the Designer's of 10-27, on the Hunter's find: the chat open on screen failed under a check).
 * One at work — `working`: a team on the side's, a line under the row of the chat it works for, where the pointer on
 * the bar keeps that row from coming, its lead's turn going or its workers on after it — or whose newest turn goes is
 * at work, under Working (the review of 11-01: it read "finished").
 * @param {string} chain @param {number} since  when its row went
 * @param {{ runs: readonly RunRow[], chats: (chain: string) => ChatFacts | null, working?: boolean }} o
 * @returns {NowRow}
 */
export function stayRow(chain, since, o) {
  const facts = o.chats(chain) || { title: "a chat", project: "", when: 0, unread: false };
  const last = o.runs.find((r) => isTurn(r) && String(r.meta?.chain || "") === chain) || null;
  const status = String(last?.status || "");
  const working = o.working === true || (!!last && goes(last));
  const failed = !working && (status === "error" || status === "failed");
  const fact = working ? "working" : status === "stopped" || status === "aborted" ? "stopped" : failed ? failedWords(last) : "finished";
  const at = Number.isFinite(since) && since > 0 ? since : Number(last?.endedAt) || facts.when;
  return { key: `chat:${chain}`, chain, thread: null, group: working ? "works" : "done", title: facts.title, project: facts.project, where: facts.where || null, apart: facts.apart || null, from: facts.from || "", fact, tone: failed ? "error" : "", icon: working ? "messageSquare" : failed ? "circleAlert" : "check", tile: working ? "model" : "done", model: modelOf(last), at, under: [], team: "", step: "", stay: true };
}

/**
 * What a row is for its signature: a draw is skipped while nothing a row shows moved.
 * @param {{ needs: NowRow[], works: NowRow[], done: NowRow[] }} g
 */
export const nowKey = (g) => JSON.stringify([g.needs, g.works, g.done].map((rows) => rows.map((r) => [r.key, r.title, r.project, r.where?.text || "", r.where?.title || "", r.apart?.text || "", r.apart?.title || "", r.from || "", r.fact, r.tone, r.tile, r.model, r.icon, r.under.map((u) => u.name), r.stay ? 1 : 0])));
