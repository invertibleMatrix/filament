// @ts-check
// Sub-agents as the harness holds them (HarnessV3 §15 item 86). `subagentRoutes` is one session's sub-agent routes;
// the store is the open session's list, kept current by the events fan-out (`subagent` messages) with a slow resync
// while one runs — the stream drops events on a congested socket —, a slower one while its work waits for Apply with
// nothing running — the server finds that work in the folder only as the list is read —, and each running one's
// progress as the feed carries it (`subagent-progress`, HarnessV3-Views V3). The status panel, the spawn widget, the
// transcript's chips, the Team view and the dock's questions read the store; the viewer, bound to one sub-agent's
// session, uses the routes directly.
import { fmt } from "../../lib/format.js";
import { api } from "./api.js";
import { onBus } from "./bus.js";
import { formatWorkedFor } from "./labels.js";
import { LEVELS, prettyModel } from "./families.js";
import { teamWords, timesWords } from "./team.js";
import { onceAFrame } from "./once-a-frame.js";
import { oneBehind } from "./one-behind.js";
import { whenPageShown } from "./page-shown.js";
import { readAgents } from "./agents-since.js";

const RESYNC_MS = 5000;
/** Work that waits for Apply, nothing running: the server reads it against the folder at most once in 30 s (`SETTLE_EVERY_MS`), so a read sooner finds nothing more. */
const WAITING_MS = 30_000;
/** A burst of bus messages (a launch, its run's id, a quick end) asks for the list once. */
const SETTLE_MS = 150;
/** The characters of an asking or an answer the cards show: the server's cards' form (subagents.js `CARD_CHARS`). */
export const CARD_CHARS = 4000;
/** Words cut as the server cuts a card's (core/text.js `cut`): a host that answers them whole shows the same. @param {string} s */
export const cardCut = (s) => (s.length > CARD_CHARS ? `${s.slice(0, CARD_CHARS - 1)}…` : s);

/**
 * One sub-agent as the list route answers it: prompts and reports clipped for the cards. The detail route answers
 * the same shape whole, with `opening` — the context its first message opened with (a fork: the main agent's
 * conversation, said in a line). `pause`: it holds the session's running turn now; `aside`: the developer keeps its
 * reports until they send one on. `work`: its own git worktree — what waits to be applied — and `shares`: why a
 * writing sub-agent worked in the session's folder after all. `team`: a team's worker, its team and its role, and
 * `charge` while that team leads its chat; `task`: the graph task it does; `progress`: how its running exchange goes, null once it reported. `card`: the card it
 * runs as (HarnessV4_Tasks E15) — every launch has one, Builder with nothing named — frozen at its launch; `asked`: it
 * was asked by its tag, and answers whoever asked; `may`: what it may do — `read`, `copy` (its own copy of the
 * project, nothing kept) or `edit`. `view`, `running` and `changes`: what it was shown of the session — how much, the
 * turn running then, a change as a patch. `restored`: its session's record gave it back — after a restart, or once
 * Filament let its conversation go — so its next message starts a fresh agent that reads the thread. `seat`: its
 * model came from the session's pool (HarnessV4_Tasks E15 step 8) — `named` where a row of the list named it, and
 * the rows its launch passed because their model could not run, each with why. `effort`: the level it thinks at, where
 * one applies (HarnessV4_Tasks E23); `list`: the list its seat counts in — Agents on the side, or a team's Workers.
 * `hunts`: a Hunter's graph task, the one whose Hunt bugs started it (UX9). `machine`: one launched on another machine
 * (the remote-agents plan's s-launch), the machine it works on, and `remote` its folder, chat and run there.
 * @typedef {{ id: string, chainId: string, origin: "agent" | "owner" | "command" | "self", engine?: "loop",
 *   machine?: { id: string, name: string } | null, remote?: { cwd: string, chat: string | null, run: string | null } | null,
 *   team?: { key: string, name: string, role: string, charge?: boolean } | null, task?: string | null, hunts?: string | null, model: string,
 *   effort?: string | null, list?: "side" | "workers",
 *   seat?: { pooled: boolean, named: boolean, skipped: { model: string, why: string }[] } | null, provider?: string | null,
 *   card: { tag: string, name: string }, asked: boolean, may: "read" | "copy" | "edit",
 *   description: string, view: string, running: boolean, changes: string | null,
 *   memory: boolean, background: boolean, pause: boolean, aside: boolean, restored?: "restart" | "let-go" | null,
 *   detached?: "report" | "aside" | null, rebaseDue?: boolean,
 *   work: SubagentWork | null, shares: string | null,
 *   status: string, progress?: SubagentProgress | null, startedAt: number, endedAt: number | null,
 *   runId: string | null, exchanges: SubagentExchange[],
 *   opening?: Opening[] }} SubagentRow
 */
/**
 * One block of the context an agent's first message opened with (the server's Opening): the session's conversation,
 * the turn running then, the question that turn waited on the person with, a change as a patch, memory's brief, a
 * fork's copy of the main agent's conversation, a reviewer's change. `chars`: its size where its words are kept no
 * more — a thread its session gave back says what it was shown by kind and size.
 * @typedef {{ kind: "view" | "running" | "waiting" | "changes" | "brief" | "fork" | "review", count: number, text: string, chars?: number }} Opening
 */
/**
 * A block of that context named in a line, for its fold in the agent's conversation.
 * @param {{ kind: string, count: number }} b
 */
export function openingWords(b) {
  const n = (/** @type {string} */ one) => `${b.count} ${one}${b.count === 1 ? "" : "s"}`;
  switch (b.kind) {
    case "view": return `Conversation · ${n("turn")}`;
    case "running": return `The running turn · ${n("round")}`;
    case "waiting": return "The question waiting for your answer";
    case "changes": return `What changed · ${n("file")}`;
    case "fork": return `The main agent's conversation · ${n("message")}, as sent`;
    case "review": return `The change it reviews · ${n("file")}`;
    default: return `Memory brief · ${n("line")}`;
  }
}
/**
 * What a thread says at the message a fresh agent took it up with (HarnessV4_Tasks E15 step 5, BW-10): why the
 * agent's own conversation was gone, and what it reads instead.
 * @param {"restart" | "let-go"} why
 */
export const freshWords = (why) =>
  `${why === "restart" ? "Filament restarted since." : "Filament no longer holds this agent's own conversation."} This thread goes on from what was said here: the agent starts fresh and reads it.`;

/** Who launched a thread, by its origin. */
const ORIGIN_WORDS = Object.freeze({ agent: "launched by the agent", owner: "launched by you", command: "launched by /subagent", self: "started by itself" });
/**
 * Who started a thread, first among its head's facts (HarnessV4_Tasks U12-D8): a team's worker by its team, one asked
 * by its tag by who asked it, any other by who launched it.
 * @param {Pick<SubagentRow, "team" | "asked" | "origin">} sa
 */
export function startedWords(sa) {
  const team = String(sa.team?.name || "").trim();
  if (team) return `${teamWords(team)}'s worker`;
  if (sa.asked) return sa.origin === "owner" ? "asked by you" : sa.origin === "agent" ? "asked by the main agent" : sa.origin === "self" ? "started by itself" : "";
  return ORIGIN_WORDS[sa.origin] || "";
}
/**
 * Where one launched on another machine works, as its rows and its head say it (the remote-agents plan's s-ui): "on
 * Workstation"; nothing for one of this machine's.
 * @param {{ machine?: { name?: string } | null } | null | undefined} sa
 */
export const machineWords = (sa) => (sa?.machine?.name ? `on ${sa.machine.name}` : "");
/** The level a thread thinks at, after its model in its head: " at max"; nothing where none applies (U12-D8). @param {string | null | undefined} effort */
export const effortAt = (effort) => (effort && Object.hasOwn(LEVELS, effort) ? ` at ${LEVELS[/** @type {keyof typeof LEVELS} */ (effort)].words.toLowerCase()}` : "");

/** The line "Now" starts the main agent's turn with while it is idle, yours to change (BW-8). */
export const ACT_ON_REPORT = "Act on this report";
/**
 * What "Send to main agent" offers under an answer (HarnessV4_Tasks E15 step 5, BW-8), by what the main agent does
 * now. At work: into its turn, or kept for your next message. Idle: a turn that starts with the report and a line of
 * yours (`line`), or kept. Asking you: only with your answer — a line of yours would be read as that answer.
 * @param {"works" | "asks" | "idle"} state
 * @returns {{ when: "now" | "next", line: boolean, label: string, desc: string }[]}
 */
export function sendChoices(state) {
  if (state === "asks") return [{ when: "next", line: false, label: "With my answer", desc: "The main agent waits for your answer: it reads this when you give it" }];
  const next = { when: /** @type {"next"} */ ("next"), line: false, label: "With my next message", desc: state === "works" ? "It waits: the turn running now does not read it by itself" : "It waits, and opens the turn your next message starts" };
  return state === "works"
    ? [{ when: "now", line: false, label: "Now", desc: "It reads it at its next step" }, next]
    : [{ when: "now", line: true, label: "Now", desc: "Its turn starts with this and a line of yours" }, next];
}
/**
 * What an agent's surfaces say where another model answered than the one it was launched on (its exchange's
 * `otherModel`), or "": the model that answered named first, the one launched on beside it.
 * @param {SubagentRow | null | undefined} row
 * @param {unknown} [exchange]  the exchange a card is of; omitted: its newest that ended
 */
export function answeredOther(row, exchange) {
  const all = row?.exchanges || [];
  const x = exchange == null ? [...all].reverse().find((e) => e.status !== "running") : all[Number(exchange) || 0];
  const o = x?.otherModel;
  return o?.answered && o?.chosen ? `answered by ${prettyModel(o.answered)}, not ${prettyModel(o.chosen)}` : "";
}
/**
 * Where an answer stands with the main agent once it left your hands, or nothing while it is yours to send — and a
 * worker's report Filament sent back to it, its check having failed (HarnessV3-TaskGraph-v2 TG2-D45).
 * @param {SubagentExchange["delivery"]} delivery
 */
export const deliveryFact = (delivery) =>
  delivery === "sent"
    ? "Sent to the main agent"
    : delivery === "auto"
      ? "It went to the main agent"
      : delivery === "tool"
        ? "It answered the main agent's call"
        : delivery === "back"
          ? "Filament's check of it failed, and it went back to the worker"
          : delivery === "weighed"
            ? "It weighed your message — what it made of it is under your message"
            : "";
/**
 * What the page says once an answer was sent on. @param {"now" | "next"} when @param {"turn" | "queue"} into
 */
export const sentWords = (when, into) =>
  when === "next" ? "It goes with your next message" : into === "turn" ? "Sent — the running turn reads it at its next step" : "Sent — it opens the main agent's next turn";
/**
 * How a running exchange goes (the server's Progress): its round, its newest tool, what its newest round sent against
 * its window, its compactions, its newest words, what it has spent so far, and the call that waits for the developer —
 * with the always-allow waiting for that call's shape — or a worker's question to its lead (`to`, HarnessV3-TaskGraph-v2
 * TG2-D49), with its options, its number and when it asked, or its plan (`plan`, TG2-D50); and whether its changes wait
 * for its lead's review of its plan (`held`).
 * @typedef {{ round: number, tool: { name: string, args: string } | null,
 *   context: { tokens: number, window: number | null, usable: number | null, estimated?: true } | null,
 *   compactions: { round: number, at: number, how: string }[], words: string, spent: number | null,
 *   asking: { tool: string, args: string, question: string,
 *     offer?: { itemId: number, tool: string, shape: string }, to?: "lead", options?: string[], n?: number, at?: number, plan?: boolean } | null,
 *   held?: boolean }} SubagentProgress
 */
/**
 * What a running agent's context holds, as its gauge says it (the owner's of 11-12: "it's token count as well and also
 * at what percentage the compaction will start out of it's context window"): its count — a coding agent's own, or
 * Filament's estimate ("≈") where the agent says none — the share of its window where one is known (`fill`), and where
 * room is made in the middle of its work (`line`: the tokens its progress says, as a share of the window), with the
 * tone the chat's own Context gauge takes: `warn` from 85% of the way to the line, `error` past it. Its words, part
 * by part: `share` ("14%"), `count` ("136k of 1M"; "41k tokens" with no window known), `at` ("compacts at 40%",
 * "past its line at 40%") and `folds` ("compacted twice"); `held`, the count and the share in a tile's few words;
 * `title`, the whole of it. A line is said only inside the window: one made for a larger window than its agent runs
 * in is none, and with none its agent makes room at a point of its own. Null where nothing is counted yet.
 * @param {SubagentProgress | null | undefined} p
 * @returns {{ tokens: number, window: number | null, fill: number | null, line: { tokens: number, f: number, percent: number } | null,
 *   tone: "" | "warn" | "error", share: string, count: string, at: string, folds: string, held: string, title: string } | null}
 */
export function contextGauge(p) {
  const c = p?.context;
  const tokens = Number(c?.tokens) || 0;
  if (!c || !(tokens > 0)) return null;
  const window = Number(c.window) > 0 ? Number(c.window) : null;
  const usable = Number(c.usable) > 0 ? Number(c.usable) : null;
  const line = window && usable && usable < window ? { tokens: usable, f: usable / window, percent: Math.round((usable / window) * 100) } : null;
  const fill = window ? Math.min(1, tokens / window) : null;
  /** @type {"" | "warn" | "error"} */
  const tone = fill != null && line ? (fill >= line.f ? "error" : fill >= line.f * 0.85 ? "warn" : "") : "";
  const approx = c.estimated ? "≈" : "";
  const share = fill == null ? "" : fill < 0.01 ? "<1%" : `${Math.round(fill * 100)}%`;
  const n = (/** @type {number} */ v) => Math.round(v).toLocaleString("en-US");
  const times = Array.isArray(p?.compactions) ? p.compactions.length : 0;
  const count = window ? `${approx}${fmt.k(tokens)} of ${fmt.k(window)}` : `${approx}${fmt.k(tokens)} tokens`;
  const at = line ? (tone === "error" ? `past its line at ${line.percent}%` : `compacts at ${line.percent}%`) : "";
  const folds = times ? `compacted ${timesWords(times)}` : "";
  const title = [
    `Its context holds ${approx}${n(tokens)} tokens${window ? ` of its ${n(window)}-token window (${share})` : ""}${c.estimated ? ", as Filament estimates it: its agent says no count" : ""}.`,
    !window
      ? "Its window is not known yet."
      : !line
        ? "Nothing says where it compacts: its agent makes room at a point of its own."
        : tone === "error"
          ? `It is past its compaction line, ${n(line.tokens)} tokens (${line.percent}% of the window): room is made at its next step.`
          : `It compacts at ${n(line.tokens)} tokens, ${line.percent}% of the window: ${approx}${n(line.tokens - tokens)} to go.`,
    times ? `Compacted ${timesWords(times)} so far.` : "",
  ].filter(Boolean).join(" ");
  return { tokens, window, fill, line, tone, share, count, at, folds, held: [count, share].filter(Boolean).join(" · "), title };
}
/**
 * `lastApplied`: when its newest apply was, how many files it brought, who applied it (owner, agent, command, graph)
 * and how its files came in — the files it left with conflict markers that still have them (`marked`, from the top of
 * `repo`), and its reason where Filament's check had failed; `hand`: it was marked as applied, its change brought over
 * some other way and nothing written, and `undo`: that mark can be undone now; `folder`: where its copy is; `sig`:
 * which work waits, as one word, for what is read again when it moves; `there`: it worked in a copy on another
 * machine, and `left`: what it made or changed in that copy that stayed there, each path with why — never its content.
 * @typedef {{ pending: number, added: number, removed: number, applied: number, open: boolean, error?: string, folder?: string | null, sig?: string,
 *   there?: boolean, left?: { path: string, why: string }[],
 *   lastApplied?: { at: number, files: number, by?: string, reason?: string, came?: import("./apply-words.js").CameCount, marked?: string[], repo?: string, hand?: boolean, undo?: boolean } | null,
 *   files: { path: string, status: string, added: number, removed: number, binary: boolean }[] }} SubagentWork
 */
/**
 * A sub-agent's pending work whole (GET …/changes): the files and the unified diff.
 * @typedef {{ files: SubagentWork["files"], diff: string, applied: number }} SubagentChanges
 */
/**
 * `delivery`: where the report went once the exchange ended — the agent call's result, the main agent by itself,
 * nowhere yet (the developer's to send), sent on by the developer, back to the worker, Filament's check of it having
 * failed, or to the turn whose person's message it weighed. `description`: what it was asked, in a line.
 * @typedef {{ prompt: string, description: string, by: "agent" | "owner" | "command" | "self", runId: string | null, status: string, startedAt: number,
 *   endedAt: number | null, delivery: "tool" | "auto" | "held" | "sent" | "back" | "weighed" | null, report?: string, error?: string | null,
 *   rounds?: number, toolCalls?: number, tokensIn?: number, tokensOut?: number, spentUsd?: number, ms?: number,
 *   failure?: { head?: string, more?: string } | null, handed?: { source: string, files: number | null },
 *   pictures?: string[], files?: string[],
 *   fresh?: "restart" | "let-go", why?: string, drew?: Drew[],
 *   made?: Made[], sentIn?: { run: string, round: number | null }, fromLog?: boolean, mirror?: string,
 *   agentModel?: string, otherModel?: { chosen: string, answered: string }, promptHead?: boolean, reportHead?: boolean }} SubagentExchange
 *   `promptHead`, `reportHead`: the list carries its asking, its answer, as a head (the list's `heads`), read whole where
 *   shown whole;
 *   `agentModel`: the model its coding agent says answered it; `otherModel`: both names where that is not the model
 *   it was launched on (the server's word);
 *   `failure`: why it failed, in the one shape — its words' two parts are the failure card's (lib/failure.js);
 *   `handed`: the change its message carried as a patch, as it was named, and how many files that was;
 *   `fresh`: a fresh agent took the thread up with this message, and why; `why`: why Filament started it itself (`by`
 *   is then "self"); `drew`: the pictures it drew in this exchange, in the order drawn
 *   (HarnessV4_Visuals_Plan VS-D50); `made`: the artifacts it published, each once (HarnessV4_Artifacts_Plan AFC-100);
 *   `sentIn`: the turn that sent it and that turn's round, where a turn's call did (HarnessV4_OneAgent_Plan L47);
 *   `mirror`: one on another machine, the run here that shows its turn there as it works, its words streamed (s2e)
 */
/**
 * A picture a helper drew, by where it is kept: on the turn that launched it (`turn`), or on the session (`session`),
 * for a helper no turn launched (HarnessV4_Visuals_Plan VS-D48).
 * @typedef {{ id: string, title: string, bytes: number, turn?: number, session?: true }} Drew
 */
/**
 * An artifact a helper published, at the newest version it made (HarnessV4_Artifacts_Plan AFC-100).
 * @typedef {{ name: string, v: number, title: string }} Made
 */
/**
 * What the developer's launch carries (POST /sessions/:id/subagents). `deliver: false` keeps the report aside;
 * `worktree: false` keeps a writing sub-agent in the session's folder. `start` (HarnessV4_Tasks E13-1): one of the
 * server's starts (`ViewSizes.starts`), which fills the fields the launch leaves out; `running`: it is also shown the
 * turn running now; `changes`: it is also shown a change as a patch (`running`: what the turn running now changed so
 * far; `turn`: the last finished turn's; `uncommitted`; `since:<ref>`: everything since a commit, tag or branch).
 * `worker`: the worker card it runs as (Builder with none named); `may`: what it may do, where lower than its card says.
 * `as`: the saved agent asked instead, by its tag — it answers whoever asked, and its card stands in the chat — with
 * `images`, the pictures that go with the words. `hunts`: the graph task a Hunter hunts bugs in, by its id (UX9), and
 * `range` the files it hunts in, its task's (the plan's p6).
 * @typedef {{ prompt: string, description?: string, start?: string, worker?: string, as?: string,
 *   images?: { name: string, mediaType: string, data: string }[], may?: "read" | "copy" | "edit",
 *   model?: string, view?: string, running?: boolean, changes?: string, memory?: boolean, worktree?: boolean,
 *   deliver?: boolean, pause?: boolean, inform?: boolean, hunts?: string, range?: string[] }} SpawnSpec
 */
/**
 * Saved agents asked the same thing at once (`as`: their tags), each blind to the others: all start, or none does
 * (the refusal's words say why). `refused`: a tag that could not start after the others had — an agent of the session
 * took its place in the same instant. `images`: the pictures that go with the question. `changes`: a change each is
 * handed as a patch (`SpawnSpec.changes`).
 * @typedef {{ prompt: string, as: string[], models?: string[], images?: { name: string, mediaType: string, data: string }[], changes?: string }} AskSpec
 *   `models`: one agent (`as` names it alone) asked once on each of these models, all or none (step 8, AG-241)
 */
/**
 * How warm the main agent's cache is — the newest request of its running turn, else of its last — which decides
 * whether Enhance forks it. `leftMs` counts down from when the list answered. `forkable`: a fork has a request to copy.
 * @typedef {{ state: "warm" | "cold" | "uncached" | "none", running: boolean, leftMs: number, ttlMs: number, tokens: number, model: string | null, forkable?: boolean }} CacheState
 */
/**
 * What each context view would hand a sub-agent, in estimated tokens, and whether a fork can be made now (and on
 * which model: the main agent's). Beside any of them (HarnessV4_Tasks E13-1): `running`, the turn running now — its
 * size, the rounds and calls its log shows; null with none — `changes`, a change as a patch from either source, with
 * why there is none (`note`); and `starts`, the server's table of starts (services/subagent-starts.js).
 * @typedef {{ tokens: number, files: number, note?: string }} PatchSize
 * @typedef {{ id: string, name: string, view: string, running: boolean, changes: "turn" | "uncommitted" | null, worker: string, may: "read" | "copy" | "edit", worktree: boolean, deliver: boolean, task?: string, since?: "message", asks?: boolean, fork?: "warm" }} StartRow
 * @typedef {{ tokens: Record<string, number>, fork: { available: boolean, model: string | null, state: string },
 *   running?: { run: string, tokens: number, rounds: number, calls: number } | null,
 *   changes?: { turn: PatchSize, uncommitted: PatchSize }, starts?: StartRow[] }} ViewSizes
 */
/**
 * Enhance's answer: the brief, a title for the cards, how it was written (a fork of the main agent, or a view read by
 * the session's model) and the provider's token counts — a fork's cache read is the proof it was cheap.
 * @typedef {{ text: string, title: string | null, how: "fork" | "view", usage: { input: number, cacheRead: number, cacheWrite: number, output: number } | null }} Enhanced
 */

/** How an exchange ended, in the words every surface uses. @type {Readonly<Record<string, string>>} */
const STATUS_WORDS = Object.freeze({
  running: "Running",
  done: "Finished",
  "budget-stopped": "Budget stop",
  stopped: "Stopped",
  aborted: "Cut off",
  failed: "Failed",
});
/** @param {string} status */
export const statusWord = (status) => STATUS_WORDS[status] || status;
/** The tone a status draws in: running, fine, or a stop worth a look. @param {string} status @returns {"running" | "ok" | "warn" | "error"} */
export const statusTone = (status) => (status === "running" ? "running" : status === "done" ? "ok" : status === "failed" || status === "aborted" ? "error" : "warn");

/**
 * Why a thread has no box to ask its agent more (HarnessV4_Tasks E15 AG-105), or null where you can: a saved agent the
 * main agent asked is the main agent's thread, which asks it again by itself — you ask that agent yourself, by its tag
 * (`ask`) — and one that does a task of the task graph ends with its report.
 * @param {SubagentRow} sa @returns {{ words: string, ask?: string } | null}
 */
export function noBoxWhy(sa) {
  if (sa.asked && sa.origin === "agent") return { words: `The main agent asked this, and asks ${sa.card.name} again by itself. To ask ${sa.card.name} yourself, open a new thread:`, ask: sa.card.tag };
  if (sa.task) return { words: `It does task ${sa.task} of the task graph, and its report ends it. To try the task again, send it back from the Plan tab.` };
  return null;
}

/** A refused apply for a toast: nothing went in, unless the error says it went in only in part. @param {unknown} e */
export const applyFailure = (e) => {
  const m = String(/** @type {any} */ (e)?.message || e);
  return m.startsWith("Applied only in part") ? m : `Nothing applied: ${m}`;
};

/** A refused Send back to rebase, in its own words: it applies nothing, and says no apply (the Hunter's of 10-28). @param {unknown} e */
export const rebaseFailure = (e) => String(/** @type {any} */ (e)?.message || e);

/**
 * A sub-agent's row in words (HarnessV3-Launch RD-D5): named by its newest exchange, so a follow-up's own task shows
 * (the launch's line hid it), with "follow-up" beside its status and, in the title, the task it began with. Every row
 * says first which card it runs as (HarnessV4_Tasks E15): "Product: should this queue or fail?", "Reviewer: find the retry" —
 * but a team's worker, whose card on every surface says its role already.
 * @param {SubagentRow} r @returns {{ name: string, followUp: boolean, title: string }}
 */
export function rowWords(r) {
  const followUp = r.exchanges.length > 1;
  const said = followUp ? r.exchanges[r.exchanges.length - 1].description : r.description;
  return {
    name: r.card && !r.team ? `${r.card.name}: ${said}` : said,
    followUp,
    title: followUp ? `Open its conversation — it began as “${r.description}”` : "Open its conversation",
  };
}

/**
 * A round's own words as they stream (HarnessV4_Tasks U1): of the word blocks its run has streamed so far, those from
 * the round's start on — the blocks that stood before it are earlier rounds' — its thinking joined, and its text.
 * @param {{ type: string, text: string }[]} blocks @param {number} from  the round-start's `blocksBefore`
 * @returns {{ thinking: string, text: string }}
 */
export function roundWords(blocks, from) {
  const own = blocks.slice(Math.max(0, Number(from) || 0));
  /** @param {string} type @param {string} between */
  const joined = (type, between) => own.filter((b) => b.type === type).map((b) => String(b.text || "")).join(between);
  return { thinking: joined("thinking", "\n\n"), text: joined("text", "") };
}

/**
 * How a sub-agent's exchange ended, for the card of the call that launched it, where that call's run stopped hearing of
 * it (HarnessV4_Tasks U1; the bug report's L10): a sub-agent's events ride the turn that launched it only while that
 * turn runs — a turn that paused, or a background launch whose turn ended, left its card at "running" for good. Where
 * the session's list knows the exchange and it has ended, the end is the list's, in the fields the run's own
 * `subagent-end` gives. Null while the events' word stands: they told its end, it still runs, or the list knows no more.
 *
 * One the list holds no longer (the S5 gap): Filament keeps a session's newest sub-agents, and none across a restart,
 * so a card whose run ended and left it running (`left`, lib/labels.js alignEvents) read "running" for good. Where
 * the list was answered (`known`) and has no row of it, it runs no longer, and its own run's log is asked how it
 * ended (`logged`: the run its turn's log named, `sub.run`): that end is drawn as the list's would be, marked
 * `gone` — there is no conversation left to open. Where that log says nothing either it is `forgotten`, with what
 * the events had told of it left as it stands.
 *
 * The list carries each answer as a head (its `heads`, `reportHead`): where it cut this one, the agent's cards' form is
 * read (`card`, the store's) and its end is the one the list gave before its heads, its answer cut as the list cut it —
 * the head stands while it is read, and where it could not be (`reportHead`, as the list says it).
 * @param {{ state?: string, exchange?: number, left?: boolean, run?: string, agentId?: string } | null | undefined} sub  the call's sub-agent, from its run's events
 * @param {SubagentRow | null | undefined} row  the session's row of it
 * @param {boolean} [known]  the session's list was answered: a sub-agent with no row is one it holds no longer
 * @param {((sub: any) => LoggedEnd | null | undefined) | null} [logged]  what its own run's log says (the store's
 *   `logged`): undefined while it is read, null where the turn named no run of it
 * @param {((id: string, exchange: number) => SubagentExchange | null | undefined) | null} [card]  its exchange in the
 *   cards' form (the store's `card`): undefined while it is read, null where it could not be
 * @returns {{ state: "done" | "stopped" | "failed", status: string, asking: null, ms?: number, rounds?: number, tokens?: number, report?: string, error?: string | null, failure?: { head?: string, more?: string } | null, gone?: boolean, unread?: string, reportHead?: true } | null}
 */
export function endFromList(sub, row, known = false, logged = null, card = null) {
  if (!sub || sub.state !== "running") return null;
  if (!row) {
    if (!known || !sub.left) return null;
    const read = logged ? logged(sub) : null;
    if (read === undefined) return null;
    return read?.end ? { ...endOf(read.end), gone: true } : { state: "stopped", status: "forgotten", asking: null, gone: true, ...(read?.unread ? { unread: read.unread } : {}) };
  }
  if (!Number.isInteger(sub.exchange)) return null;
  const x = row.exchanges[/** @type {number} */ (sub.exchange)];
  // Its status says it ended, whether or not its time is known: a restart that cut it left none.
  if (!x || x.status === "running") return null;
  if (!x.reportHead) return endOf(x);
  const whole = card ? card(String(sub.agentId || ""), /** @type {number} */ (sub.exchange)) : null;
  return whole ? { ...endOf(x), report: cardCut(String(whole.report ?? x.report ?? "")) } : { ...endOf(x), reportHead: /** @type {const} */ (true) };
}

/**
 * What a sub-agent's own run's log said of its end (GET /sessions/:id/subagents/:sid/end): the exchange as the list
 * would give it, null where the log holds none; `unread`: why the log could not be read at all.
 * @typedef {{ end: any | null, unread?: string }} LoggedEnd
 */

/** An ended exchange in the fields a card takes (`endFromList`). @param {any} x */
const endOf = (x) => ({
  state: /** @type {"done" | "stopped" | "failed"} */ (x.status === "done" ? "done" : x.status === "stopped" ? "stopped" : "failed"),
  status: String(x.status),
  ms: x.ms ?? (x.endedAt != null ? Math.max(0, x.endedAt - x.startedAt) : 0),
  rounds: x.rounds,
  tokens: (Number(x.tokensIn) || 0) + (Number(x.tokensOut) || 0),
  report: x.report,
  error: x.error,
  failure: x.failure || null,
  asking: null,
});

/**
 * The ends a turn's cards take from the session's list (`endFromList`), as one key: the timeline draws a turn's cards
 * again when it changes, and only then — an answer the list cut, once more as its cards' form stands in its place.
 * @param {any} aligned  the turn's alignEvents answer @param {(id: string) => SubagentRow | null} rowOf
 * @param {boolean} [known]  the list was answered (`endFromList`)
 * @param {((sub: any) => LoggedEnd | null | undefined) | null} [logged]  its own run's word (`endFromList`)
 * @param {((id: string, exchange: number) => SubagentExchange | null | undefined) | null} [card]  its cards' form (`endFromList`)
 */
export function listEndsKey(aligned, rowOf, known = false, logged = null, card = null) {
  /** @type {string[]} */
  const out = [];
  for (const c of aligned?.byRound?.values() || [])
    for (const t of c.tools.values()) {
      const end = t.sub?.agentId ? endFromList(t.sub, rowOf(String(t.sub.agentId)), known, logged, card) : null;
      if (end) out.push(`${t.sub.agentId}:${t.sub.exchange}:${end.status}${end.reportHead ? ":head" : ""}`);
    }
  return out.join(",");
}

/** How long a sub-agent's newest exchange has run, or took once it ended ("" before it starts). @param {SubagentRow} r @param {number} [now] */
export function tookOf(r, now = Date.now()) {
  const last = r.exchanges.at(-1);
  if (!last) return "";
  return formatWorkedFor((last.endedAt ?? (r.status === "running" ? now : last.startedAt)) - last.startedAt);
}

/**
 * A running sub-agent's progress off the events feed, onto its row (HarnessV3-Views V3): the Team view's cards and the
 * dock's questions read it there. Another session's message, a row the list has not brought yet and an ended one's
 * change nothing — the list carries an end. Says whether it changed a row.
 * @param {SubagentRow[]} rows @param {string} chainId @param {any} msg
 */
export function mergeProgress(rows, chainId, msg) {
  if (msg?.type !== "subagent-progress" || !chainId || msg.chainId !== chainId) return false;
  const row = rows.find((r) => r.id === msg.id);
  if (!row || row.status !== "running") return false;
  row.progress = msg.progress || null;
  return true;
}

/**
 * One of a coding agent's own agents, as the list answers it (app/agent-guests.js; HarnessV4_Tasks E15 step 5): an
 * agent Filament did not launch, read from its turn's run. `id`: that run and its card there (lib/guest-thread.js
 * `guestOf`); `of`: the coding agent whose it is, "" where its run names none; `agent`: the kind its agent gives it;
 * `status` aborted: its run ended with no word of its end.
 * @typedef {{ id: string, guest: true, of: string, run: string, stub: string, description: string, agent: string,
 *   model: string, prompt: string, status: "running" | "done" | "failed" | "stopped" | "aborted", startedAt: number,
 *   endedAt: number | null, ms: number | null, toolCalls: number, tokens: number | null, report: string,
 *   error: string }} GuestRow
 */

/**
 * A pool's rows as a launch would read them now (HarnessV4_Tasks E15 step 8): what each lends and why fewer, its
 * model's limit and price, why it cannot run. The rows are an edit not saved yet. `session`: the chat whose running
 * agents count, "" for a task not started; `main`: the main agent's model, which the nameless row stands for.
 * @param {{ pool: import("./pool.js").PoolRow[], session?: string, main?: string }} o
 * @returns {Promise<{ seats: import("./pool.js").SeatFacts[], total: number }>}
 */
export const poolSeatsNow = ({ pool, session = "", main = "" }) => api("/subagents/seats", { method: "POST", body: { pool, session, main } });

/**
 * What a helper drew in one exchange (HarnessV4_Visuals_Plan VS-D50), in the order drawn: the page's list says it while
 * Filament holds the agent (`row`); else the chat's record of where each is kept, as its transcript said — on the turn
 * that launched it, or on the session for one no turn launched (VS-D48).
 * @param {SubagentRow | null} row @param {{ turns?: any[], visuals?: any[] }} chat @param {string} id @param {number} exchange
 * @param {(id: string, exchange: number) => Drew[]} [kept]  the chat's record read once for many cards (`drewKept`)
 * @returns {Drew[]}
 */
export function drewIn(row, chat, id, exchange, kept) {
  const listed = row?.exchanges?.[exchange]?.drew;
  if (listed?.length) return listed;
  return (kept || drewKept(chat))(id, exchange);
}

/**
 * The chat's record of what its helpers drew, by helper and exchange, in the order drawn (`drewIn`): read once, for
 * every card drawn — each card that read it alone looked through every turn of the chat.
 * @param {{ turns?: any[], visuals?: any[] }} chat
 * @returns {(id: string, exchange: number) => Drew[]}
 */
export function drewKept(chat) {
  /** @type {Map<string, Drew[]>} */
  const by = new Map();
  /** @param {any} v @param {{ turn: number } | { session: true }} where */
  const put = (v, where) => {
    if (typeof v?.by !== "string") return;
    const k = `${v.by}\u0000${Number(v.exchange) || 0}`;
    const list = by.get(k) || [];
    list.push({ id: String(v.id), title: String(v.title ?? ""), bytes: Number(v.bytes) || 0, ...where });
    by.set(k, list);
  };
  for (const t of chat.turns || []) if (Number.isInteger(t?.n) && t.n > 0) for (const v of t.visuals || []) put(v, { turn: Number(t.n) });
  for (const v of chat.visuals || []) put(v, { session: true });
  return (id, exchange) => by.get(`${id}\u0000${exchange}`) || [];
}

/**
 * What a helper published in one exchange (HarnessV4_Artifacts_Plan AFC-100), the first made first: the page's list
 * says it while Filament holds the agent (`row`); else the chat's record of its helpers' versions, from its transcript.
 * @param {SubagentRow | null} row @param {{ helpersMade?: any[] }} chat @param {string} id @param {number} exchange
 * @returns {Made[]}
 */
export function madeIn(row, chat, id, exchange) {
  const listed = row?.exchanges?.[exchange]?.made;
  if (listed?.length) return listed;
  return (chat.helpersMade || [])
    .filter((m) => m?.helper === id && (Number(m.exchange) || 0) === exchange)
    .map((m) => ({ name: String(m.name), v: Number(m.v) || 0, title: String(m.title ?? "") }));
}

/** One session's sub-agent routes. @param {string} chainId */
export function subagentRoutes(chainId) {
  const base = `/sessions/${encodeURIComponent(chainId)}/subagents`;
  /** @param {string} path @param {any} [body] */
  const post = (path, body = {}) => api(`${base}${path}`, { method: "POST", body });
  return {
    /** @returns {Promise<{ subagents: SubagentRow[], own?: GuestRow[], queued: number, envelopes?: { n: number, from: string, description: string, sender: string, subject: string }[], cache: CacheState, limit?: Seats, nextSeat?: { model: string, own: boolean } | null, refusedPictures?: { model: string, said: string }[] }>} */
    // As the rows that moved since this page's last read of the chat's list (`readAgents`, the slowness of 11-02).
    list: () => readAgents(chainId, api),
    /** Ask saved agents (HarnessV4_Tasks E15 step 2). @param {AskSpec} spec @returns {Promise<{ subagents: SubagentRow[], refused: { tag: string, model?: string, error: string }[] }>} */
    ask: (spec) => post("", spec),
    /** The developer's launch. @param {SpawnSpec} spec @returns {Promise<SubagentRow>} */
    spawn: async (spec) => (await post("", spec)).subagent,
    /** @param {string} id */
    stop: (id) => post(`/${encodeURIComponent(id)}/stop`),
    /** Its thread deleted, from the Agents tab (the owner's ask of 10-23). @param {string} id */
    remove: (id) => api(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" }),
    /**
     * A team's worker's waiting call answered (HarnessV3-AtHome P2): `allow`, the press of Allow, runs it; without it
     * the words answer it Not run in them; `modeSwitch`: the words are the developer's permission switch, and the call
     * is judged again under it. `ask`: the number of the ask the card showed (TG2-D42) — the server settles that one
     * alone, and an ask on another machine takes no press without it. `choice`: the number of the choice, from 1, that
     * answers a question another machine's chat asks there.
     * @param {string} id @param {string} answer @param {{ allow?: boolean, modeSwitch?: boolean, ask?: number | null, choice?: string | null }} [o]
     * @returns {Promise<{ ok: true, subagent: SubagentRow }>}
     */
    answer: (id, answer, o = {}) => post(`/${encodeURIComponent(id)}/answer`, { answer, ...(o.allow ? { allow: true } : {}), ...(o.modeSwitch ? { modeSwitch: true } : {}), ...(Number.isInteger(o.ask) ? { ask: o.ask } : {}), ...(typeof o.choice === "string" ? { choice: o.choice } : {}) }),
    /**
     * Free the main agent from a foreground sub-agent (BUG-12): it runs on in the background; with `report` its report
     * arrives as a message when it finishes, without it stays the developer's to send on.
     * @param {string} id @param {boolean} [report]
     */
    detach: (id, report = true) => post(`/${encodeURIComponent(id)}/detach`, { report }),
    /** Continue a sub-agent's conversation. @param {string} id @param {string} prompt @returns {Promise<SubagentRow>} */
    followUp: async (id, prompt) => (await post(`/${encodeURIComponent(id)}/follow-up`, { prompt })).subagent,
    /**
     * A thread that failed asked again, in the same thread (the owner's word of 10-24): its question once more.
     * @param {string} id @returns {Promise<SubagentRow>}
     */
    retry: async (id) => (await post(`/${encodeURIComponent(id)}/follow-up`, { prompt: "", again: true })).subagent,
    /**
     * Your words to a running sub-agent, past its lead (HarnessV4_Tasks decision 10): read at its next step, and its lead
     * told. `told`: "turn" — its lead's turn reads that at its next step — or "queue", its next turn; `asking`: the call
     * whose answer it waits for first.
     * @param {string} id @param {string} text
     * @returns {Promise<{ ok: true, told: "turn" | "queue", asking: string | null }>}
     */
    message: (id, text) => post(`/${encodeURIComponent(id)}/message`, { text }),
    /**
     * A report kept aside, passed on to the main agent (the newest exchange's unless one is named). `when`: "now" —
     * its running turn's next step, else its next turn; "next" — with your next message, even while a turn runs.
     * @param {string} id @param {number} [exchange] @param {"now" | "next"} [when]
     * @returns {Promise<{ into: "turn" | "queue", subagent: SubagentRow }>}
     */
    send: (id, exchange, when) => post(`/${encodeURIComponent(id)}/send`, { ...(Number.isInteger(exchange) ? { exchange } : {}), ...(when ? { when } : {}) }),
    /**
     * A task rewritten with the main agent's context, for the sub-agent about to be launched.
     * @param {string} prompt @param {{ readOnly?: boolean, view?: string }} [o] @returns {Promise<Enhanced>}
     */
    enhance: (prompt, o = {}) => post("/enhance", { prompt, ...o }),
    /**
     * What each context view would hand a sub-agent, and whether a fork can be made now. `changes: false` leaves the
     * two patches unread and unsized: for a reader that shows the views' sizes alone, in a folder with many changed
     * files.
     * @param {{ changes?: boolean }} [o] @returns {Promise<ViewSizes>}
     */
    views: async ({ changes = true } = {}) => {
      const r = await api(`${base}/views${changes ? "" : "?changes=0"}`);
      const none = { tokens: 0, files: 0 };
      return {
        tokens: r?.tokens || {},
        fork: r?.fork || { available: false, model: null, state: "none" },
        running: r?.running || null,
        changes: { turn: r?.changes?.turn || none, uncommitted: r?.changes?.uncommitted || none },
        starts: Array.isArray(r?.starts) ? r.starts : [],
      };
    },
    /** One sub-agent whole. @param {string} id @returns {Promise<SubagentRow>} */
    detail: async (id) => (await api(`${base}/${encodeURIComponent(id)}`)).subagent,
    /** One sub-agent in the cards' form: each asking and answer to CARD_CHARS, as the list carried them before its heads. @param {string} id @returns {Promise<SubagentRow>} */
    card: async (id) => (await api(`${base}/${encodeURIComponent(id)}?card=1`)).subagent,
    /** What its own worktree changed, waiting to be applied: files and the diff. @param {string} id @returns {Promise<SubagentChanges>} */
    changes: (id) => api(`${base}/${encodeURIComponent(id)}/changes`),
    /**
     * How one of its exchanges ended, as that exchange's own run's log says: for one the list holds no longer.
     * @param {string} id @param {string} run @returns {Promise<{ run: string, end: any | null }>}
     */
    end: (id, run) => api(`${base}/${encodeURIComponent(id)}/end?run=${encodeURIComponent(run)}`),
    /**
     * Its worktree's changes into the session's folder, all or nothing: a refusal names the files that would not
     * come through (the error's `conflicts`).
     * `choices`: the developer's, by path, for the files that overlapped theirs (the Designer's of 10-27).
     * @param {string} id @param {Record<string, import("./apply-words.js").Choice>} [choices]
     * @returns {Promise<{ files: SubagentWork["files"], came: import("./apply-words.js").Came[], subagent: SubagentRow | null }>}
     */
    apply: (id, choices) => post(`/${encodeURIComponent(id)}/apply`, choices && Object.keys(choices).length ? { choices } : {}),
    /**
     * Mark its waiting changes as applied: they reached the folder some other way, so nothing is written and they wait
     * no more (10-29). A refusal says why: an Apply running, its graph task's change, or nothing waiting.
     * @param {string} id @returns {Promise<{ ok: true, files: SubagentWork["files"], subagent: SubagentRow | null }>}
     */
    markApplied: (id) => post(`/${encodeURIComponent(id)}/mark-applied`),
    /** Undo its mark as applied: its changes wait for Apply again. @param {string} id @returns {Promise<{ ok: true, files: SubagentWork["files"], subagent: SubagentRow | null }>} */
    unmarkApplied: (id) => api(`${base}/${encodeURIComponent(id)}/mark-applied`, { method: "DELETE" }),
    /**
     * What its Apply would do now, nothing written (the Designer's of 10-27): how each file would come in, and the files
     * that would stop it, each with its kind and its choices — with the developer's choices so far, how those would come.
     * @param {string} id @param {Record<string, import("./apply-words.js").Choice>} [choices]
     * @returns {Promise<{ ok: true, repo: string, folder: string | null, files: number, came: import("./apply-words.js").Came[], conflicts: import("./apply-words.js").Conflict[] }>}
     */
    preview: (id, choices) => api(`${base}/${encodeURIComponent(id)}/apply-preview${choices && Object.keys(choices).length ? `?choices=${encodeURIComponent(JSON.stringify(choices))}` : ""}`),
    /**
     * One file that stops its Apply, as Compare shows it (the Designer's of 10-27): each overlap, yours over its.
     * @param {string} id @param {string} path
     * @returns {Promise<{ ok: true, path: string, kind: import("./apply-words.js").ConflictKind | null, why: string, overlaps: import("./apply-words.js").Overlap[], repo: string, folder: string | null }>}
     */
    compare: (id, path) => api(`${base}/${encodeURIComponent(id)}/apply-compare?path=${encodeURIComponent(path)}`),
    /**
     * Send its work back to rebase (the Designer's of 10-27): its change redone on the folder as it is now, the overlaps
     * marked, and it goes on to resolve them.
     * @param {string} id @returns {Promise<{ ok: true, marked: string[], left: import("./apply-words.js").Conflict[], files: number, task: string | null }>}
     */
    rebase: (id) => post(`/${encodeURIComponent(id)}/rebase`),
  };
}

/** No word yet on the main agent's cache. @type {CacheState} */
const NO_CACHE = Object.freeze({ state: "none", running: false, leftMs: 0, ttlMs: 0, tokens: 0, model: null, forkable: false });

/**
 * A list's seats: how many its rows lend now — null where its models have no limit — and how many of its agents run.
 * @typedef {{ max: number | null, running: number }} Seats
 */
/** A list's seats as the list route says them, or null where it says none. @param {any} x @returns {Seats | null} */
const seatsOf = (x) => {
  if (!x || typeof x !== "object") return null;
  const running = Math.max(0, Number(x.running) || 0);
  // No limit comes as null: a JSON number holds no Infinity.
  if (x.max == null) return { max: null, running };
  return Number.isFinite(Number(x.max)) ? { max: Math.max(0, Number(x.max)), running } : null;
};

/**
 * A sealed envelope as the list route says it (app/agent/subagents.js `envelopeView`): its number, the sub-agent that sent
 * it and what it was asked, who sent it in the envelope's words, its subject line, and whether a team's, a flow's or
 * another chat's, or the fork's that weighed your message (`via`).
 * @typedef {{ n: number, from: string, description: string, sender: string, subject: string, via?: "team" | "flow" | "chat" | "steer" | "agent" }} SealedEnvelope
 */
/** The list route's sealed envelopes, oldest first. @param {any} list @returns {SealedEnvelope[]} */
const sealedOf = (list) =>
  (Array.isArray(list) ? list : [])
    .map((e) => ({ n: Number(e?.n) || 0, from: String(e?.from || ""), description: String(e?.description || ""), sender: String(e?.sender || ""), subject: String(e?.subject || ""), ...(e?.via === "team" || e?.via === "flow" || e?.via === "chat" || e?.via === "steer" || e?.via === "agent" ? { via: /** @type {"team" | "flow" | "chat" | "steer" | "agent"} */ (e.via) } : {}) }))
    .filter((e) => e.n > 0);

/** The open session's sub-agents, and how warm the main agent's cache is. */
export function createSubagentStore() {
  let chainId = "";
  /** @type {SubagentRow[]} */
  let rows = [];
  /** The coding agents' own agents, newest first: rows to read, never Filament's to continue, stop or count. @type {GuestRow[]} */
  let own = [];
  /** Whether this session's list was answered: until then no row of a sub-agent says nothing of it. */
  let known = false;
  /** What sub-agents' own runs said of their ends, by run, for the ones the list holds no longer (`logged`). @type {Map<string, LoggedEnd>} */
  const loggedEnds = new Map();
  /** The runs being asked now. @type {Set<string>} */
  const reading = new Set();
  /**
   * Sub-agents in the cards' form (`card`), read for an ended exchange whose answer the list carries as a head: held for
   * the chat, each with the list read it was asked after (`gen`) — every hearing asks the cards of every turn drawn, so
   * a bound below what one pass asks would read them again without end. @type {Map<string, { row: SubagentRow, gen: number }>}
   */
  const cardRows = new Map();
  /** The agents whose cards' form is being read now. @type {Set<string>} */
  const cardReading = new Set();
  /** The list read after which an agent's cards' form could not be read: asked again once the list is read again. @type {Map<string, number>} */
  const cardFailed = new Map();
  /** How many reads of the list were answered: a card's form is asked at most once after each (`card`). */
  let listGen = 0;
  /** Who waits for the cards' forms on their way to be drawn (`cardsHeard`). @type {(() => void)[]} */
  let cardWaiters = [];
  let queued = 0;
  /**
   * The session's envelopes still sealed, oldest first, as the list last said (HarnessV4_Envelopes_Plan EN5): each its
   * number, who sent it and its subject — the line over the box says them until its agent opens them (the owner's of
   * 11-02). @type {SealedEnvelope[]}
   */
  let envelopes = [];
  /** The session's limit and how many agents run in it, as the list last said. @type {{ max: number, running: number } | null} */
  let limit = null;
  /** The seat a launch that names no model would take now, as the list last said; null where none is free. @type {{ model: string, own: boolean } | null} */
  let nextSeat = null;
  /**
   * Agents on the side's seats and how many of them run, as the list last said (HarnessV4_Tasks U12-D5) — said too where
   * none of its models can run now, as `limit` is not.
   * @type {Seats | null}
   */
  let seats = null;
  /** The models whose provider refused a request with pictures, as the list last said (HarnessV4_Tasks E15 AG-20). @type {Set<string>} */
  let refusedPictures = new Set();
  /** @type {CacheState} */
  let cache = NO_CACHE;
  /** When `cache` was answered: its `leftMs` counts down from then. */
  let cacheAt = 0;
  let seq = 0;
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let settleTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let resyncTimer = null;
  /** What the listeners of the hearing under way share (`shared`). @type {Map<string, any> | null} */
  let hearing = null;

  /**
   * The listeners hear the list moved once a frame, however often it moved before it: each running agent's progress
   * comes about twice a second, and each repainted the status, the agents' band, the widgets, the dock and every card
   * drawn. They read the store as it stands then. A tab put away, which gets no frames, still hears within a beat.
   */
  const emit = onceAFrame(() => {
    hearing = new Map();
    try {
      for (const fn of listeners) fn();
    } finally {
      hearing = null;
      // The cards drew what the forms read brought: who waited for them hears it, once none is on its way.
      if (!cardReading.size && cardWaiters.length) {
        const waiting = cardWaiters;
        cardWaiters = [];
        for (const done of waiting) done();
      }
    }
  }, { late: 250 });

  /**
   * A running sub-agent's end must show even when its bus message is lost, and a file an apply left with conflict markers
   * is resolved in the developer's editor, which no message says (the Designer's of 10-28): look again on a slow timer.
   * Work that waits for Apply can come into the folder another way — with git, by hand —, which the server finds only as
   * the list is read (`settleWaiting`): while it waits and nothing else asks, look again on a slower one.
   */
  const schedule = () => {
    if (resyncTimer) clearTimeout(resyncTimer);
    const marked = rows.some((r) => !!r.work?.lastApplied?.marked?.length);
    const busy = rows.some((r) => r.status === "running") || own.some((g) => g.status === "running") || marked;
    const waits = rows.some((r) => r.status !== "running" && (Number(r.work?.pending) || 0) > 0);
    resyncTimer = busy ? setTimeout(load, RESYNC_MS) : waits ? setTimeout(load, WAITING_MS) : null;
  };

  /**
   * The list read again: at once where no read of this session's is on its way, else once that one lands — one read
   * behind it however many asks come meanwhile (lib/one-behind.js): every sub-agent's message asked, and a burst of
   * them sent reads out faster than they came back.
   * @returns {Promise<void>}
   */
  function readNow() {
    return chainId ? listReads.ask() : Promise.resolve();
  }
  const listReads = oneBehind(readList);
  /** What waits while the page is out of sight is this store's list. */
  const listShown = Symbol("the agents' list");
  /**
   * The list read again by a timer or the feed's word: out of sight, once as the page shows again (lib/page-shown.js) —
   * a page kept hidden read it every five seconds while an agent ran, and at each of their messages.
   * @returns {Promise<void>}
   */
  function load() {
    return whenPageShown(listShown, readNow) || Promise.resolve();
  }

  async function readList() {
    if (!chainId) return;
    const mine = ++seq;
    try {
      const r = await subagentRoutes(chainId).list();
      if (mine !== seq) return; // the session changed, or a newer look is in flight
      rows = Array.isArray(r?.subagents) ? r.subagents : [];
      own = Array.isArray(r?.own) ? r.own : [];
      known = true;
      listGen++;
      queued = Number(r?.queued) || 0;
      envelopes = sealedOf(r?.envelopes);
      limit = r?.limit && Number(r.limit.max) > 0 ? { max: Number(r.limit.max), running: Number(r.limit.running) || 0 } : null;
      seats = seatsOf(r?.limit);
      nextSeat = r?.nextSeat?.model ? { model: String(r.nextSeat.model), own: r.nextSeat.own === true } : null;
      refusedPictures = new Set((r?.refusedPictures || []).map((x) => String(x.model)));
      cache = r?.cache || NO_CACHE;
      cacheAt = Date.now();
      emit();
    } catch {
      // Unreachable for now: the rows stay as last seen, and it is read again in a moment — a failed read used to wait
      // for some agent's message, and a first one left the tab empty while Filament stalled (the owner's logs of 11-01).
      if (mine !== seq) return;
      if (resyncTimer) clearTimeout(resyncTimer);
      resyncTimer = setTimeout(load, RESYNC_MS);
      return;
    }
    if (mine === seq) schedule();
  }

  const soon = () => {
    if (settleTimer) return;
    settleTimer = setTimeout(() => {
      settleTimer = null;
      load();
    }, SETTLE_MS);
  };
  // A sub-agent's state moved, the session's turn opened or closed (the cache's source changed), or its sealed
  // envelopes moved (EN5).
  onBus((msg) => {
    if ((msg?.type === "subagent" || msg?.type === "subagent-cache" || msg?.type === "subagent-envelopes") && chainId && msg.chainId === chainId) soon();
    else if (mergeProgress(rows, chainId, msg)) emit();
  });

  return {
    /** Follow another session (or none). The list empties at once so a session never shows another's sub-agents. @param {string | null} id */
    setChain(id) {
      const next = String(id || "");
      if (next === chainId) return;
      chainId = next;
      rows = [];
      own = [];
      known = false;
      loggedEnds.clear();
      cardRows.clear();
      cardFailed.clear();
      queued = 0;
      envelopes = [];
      limit = null;
      seats = null;
      nextSeat = null;
      cache = NO_CACHE;
      seq++;
      // A read on its way is the session left's: its answer is dropped, and this one's is not held behind it.
      listReads.reset();
      if (resyncTimer) clearTimeout(resyncTimer);
      resyncTimer = null;
      emit();
      if (chainId) readNow();
    },
    chainId: () => chainId,
    /** The session's sub-agents, newest first. */
    rows: () => rows,
    /** The coding agents' own agents, newest first. */
    own: () => own,
    running: () => rows.filter((r) => r.status === "running"),
    /** Reports waiting for the session's next turn. */
    queued: () => queued,
    /**
     * Whether the session's envelope of that number is still sealed (EN5): null until the list has answered.
     * @param {number} n @returns {boolean | null}
     */
    sealed: (n) => (known ? envelopes.some((e) => e.n === Number(n)) : null),
    /** The session's envelopes still sealed, oldest first: none until the list has answered. */
    envelopes: () => envelopes,
    /** How many agents the session may run at once, and how many run now; null until the list has answered. */
    limit: () => limit,
    /** Agents on the side's seats and how many run (U12-D5); null until the list route has said them. */
    seats: () => seats,
    /** The seat a launch that names no model would take now; null until the list has answered, or where none is free. */
    nextSeat: () => nextSeat,
    /** Whether this model's provider refused a request that carried pictures, and none has gone through since. @param {string} model */
    refusedPictures: (model) => refusedPictures.has(model),
    /** Something a row's watchers read moved outside the list — a mark of a saved agent's answer placed in the chat. */
    touch: emit,
    /** The main agent's cache as of now: the answer's lifetime counted down since it came; a warm one that ran out is cold. @returns {CacheState} */
    cache: () => {
      const leftMs = Math.max(0, cache.leftMs - (Date.now() - cacheAt));
      return { ...cache, leftMs, state: cache.state === "warm" && !leftMs ? "cold" : cache.state };
    },
    /** @param {string} id */
    row: (id) => rows.find((r) => r.id === id) || null,
    /** Whether the list was answered for this session: a sub-agent it has no row of is then one Filament holds no longer (`endFromList`). */
    known: () => known,
    /**
     * How a sub-agent the list holds no longer ended, as its own run's log says (`endFromList`): asked once a run,
     * and the list's listeners hear when the answer is in. Undefined while it is read; null where its turn named no
     * run of it. A log that is gone answers no end; one that could not be read says why (`unread`).
     * @param {{ agentId?: string, run?: string } | null | undefined} sub  the card's sub-agent (lib/labels.js alignEvents)
     * @returns {LoggedEnd | null | undefined}
     */
    logged(sub) {
      const run = String(sub?.run || "");
      const id = String(sub?.agentId || "");
      if (!run || !id || !chainId) return null;
      const have = loggedEnds.get(run);
      if (have) return have;
      if (reading.has(run)) return undefined;
      reading.add(run);
      const chain = chainId;
      subagentRoutes(chain)
        .end(id, run)
        .then(
          (r) => /** @type {LoggedEnd} */ ({ end: r?.end || null }),
          (e) => /** @type {LoggedEnd} */ (e?.status === 404 ? { end: null } : { end: null, unread: String(e?.message || e) }),
        )
        .then((said) => {
          reading.delete(run);
          if (chain !== chainId) return;
          loggedEnds.set(run, said);
          emit();
        });
      return undefined;
    },
    /**
     * An ended exchange in its agent's cards' form, for an answer the list carries as a head (`endFromList`): the
     * agent's read once, and the list's listeners hear when it is in. Undefined while it is read; null where it could
     * not be, or the form read lacks it (it ended after) — asked again once the list has been read again.
     * @param {string} id @param {number} exchange @returns {SubagentExchange | null | undefined}
     */
    card(id, exchange) {
      const sid = String(id || "");
      if (!sid || !chainId || !Number.isInteger(exchange)) return null;
      const held = cardRows.get(sid);
      const x = held?.row.exchanges?.[exchange];
      if (x && x.status !== "running") return x;
      if (cardReading.has(sid)) return undefined;
      if (held?.gen === listGen || cardFailed.get(sid) === listGen) return null;
      cardReading.add(sid);
      const chain = chainId;
      const gen = listGen;
      subagentRoutes(chain)
        .card(sid)
        .then((row) => row || null, () => null)
        .then((row) => {
          cardReading.delete(sid);
          if (chain === chainId) {
            if (Array.isArray(row?.exchanges)) {
              cardRows.set(sid, { row: /** @type {SubagentRow} */ (row), gen });
              cardFailed.delete(sid);
            } else cardFailed.set(sid, gen);
          }
          emit();
        });
      return undefined;
    },
    /**
     * Once no cards' form is on its way and the cards drew what they brought (`card`): Find searches the words they
     * hold. True where one was on its way. @returns {Promise<boolean>}
     */
    cardsHeard() {
      return cardReading.size ? new Promise((done) => cardWaiters.push(() => done(true))) : Promise.resolve(false);
    },
    /** The list read now: what a press of the person's moved, which its caller waits on. */
    refresh: readNow,
    /** Something the list tells of moved where no message of its own says so — a coding agent's own agent began or
     *  ended, on its turn's run: the list is read again, once for a burst. */
    soon,
    /**
     * A reading the listeners of one hearing share, made by the first that asks: every agent card drawn repaints as the
     * list moves, and each read the chat's marks and pictures for itself. Asked outside a hearing, it is made anew.
     * @template T @param {string} key @param {() => T} make @returns {T}
     */
    shared(key, make) {
      if (!hearing) return make();
      if (!hearing.has(key)) hearing.set(key, make());
      return hearing.get(key);
    },
    /** Hear every change to the list; returns the unsubscribe. @param {() => void} fn */
    onChange(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** @typedef {ReturnType<typeof createSubagentStore>} SubagentStore */
