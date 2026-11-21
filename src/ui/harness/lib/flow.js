// @ts-check
// A chat's flows as the page holds them (HarnessV4_Flow_Plan F5; HarnessV4_OneAgent_Plan OA3, OA4): the list the server
// answers (GET /api/sessions/:id/flows, app/flow-runner.js's `view`), read again when the feed says one moved
// (`{ type: "flow" }` on the turns topic) and on a slow timer while one runs, since an event can be lost; the words its
// cards, its row on the Agents tab and the chat's status line say; a box moved up or down a step; and `/flow`, the
// message that asks the main agent to design one. The cards are views/flow.js's; every press goes through the host
// (app.js). Nothing here runs a flow: the server does, and only on the person's Start.
import { api } from "./api.js";

/** How often the list is read again while a flow runs: its holds must show even when an event is lost. */
const RESYNC_MS = 15_000;
/** How long a burst of the feed's events waits before one read. */
const SETTLE_MS = 300;
/** How long a change the page saw happen stays to be played: a card drawn again within it goes on with its moves. */
export const MOMENT_MS = 1500;

/**
 * A box as the list route answers it (core/flow.js `FlowBox`, with the runner's view of it).
 * @typedef {{ id: string, kind: "agent" | "team" | "review", agent: string, name: string, words: string, needs: string[], gate: boolean, readOnly: boolean,
 *   model: string | null, effort?: string, sees: string | null, state: BoxState, run: { sub?: string, team?: string } | null,
 *   result: { text: string, n?: number, at: number, cut?: boolean, made?: { title: string, address: string }[], drew?: { title: string, bytes: number }[], wrote?: boolean, more?: boolean, chars?: number } | null,
 *   verdict: { go: boolean, why: string } | null, goneOn: boolean, sentBack: number, sends?: number, error: string | null, usd: number,
 *   startedAt: number | null, endedAt: number | null, past: { verdict: { go: boolean, why: string } | null, at: number, text: string }[],
 *   ran?: string[], words_: string, writes: boolean, needsOf: { id: string, name: string }[], broken: string[], waiting: string | null, place?: BoxPlace, failedOn?: "bring" }} FlowBox
 *   `needs`: the ids of the boxes whose results it is handed (OA-D5), `needsOf` each with its name, `broken` the names of
 *   those not in an earlier step (OA3 case 5); `ran`: the sub-agents its earlier runs were; `words_`: its state in words;
 *   `writes`: a team box that writes; `place`: where one that started made its changes (OA5); `waiting`: what a box
 *   waiting for a seat waits for; `failedOn`: "bring" where it failed because the flow's Bring my uncommitted edits
 *   could not copy them into its new worktree (`bringFailed`)
 * @typedef {{ kind: "worktree", name: string, branch: string, folder: string, cwd: string, brought?: { files: number, stays: string[] } } | { kind: "folder", folder: string, why: string }} BoxPlace
 *   where a flow works from its first team box that writes on (HarnessV4_OneAgent_Plan OA5): a git worktree of its own,
 *   or the folder and why; `brought`, what of the folder's uncommitted files was copied into the worktree as it was made
 * @typedef {"waits" | "seat" | "working" | "asking" | "done" | "failed" | "stopped" | "skipped" | "cut"} BoxState
 * @typedef {{ n: number, at: number, by: "person" | "agent", what: string, why?: string }} FlowAct  an act on a running
 *   flow (OA4): the person's, or the main agent's that drives it
 * @typedef {{ id: string, chainId: string, title: string, goal: string, state: "draft" | "running" | "holds" | "done" | "stopped" | "cut",
 *   steps: { why: string, boxes: FlowBox[] }[], tell: boolean, hold: { kind: "gate" | "box" | "driver", box: string } | null,
 *   end: { text: string, sent: { at: number, how: string } | null, missed: string | null, waits: boolean, lost: boolean } | null,
 *   drawn: "agent" | "hand" | "saved", at: number, startedAt: number | null, endedAt: number | null,
 *   sentBack: number, line: string, problem: string | null, seats: number, usd: number,
 *   inPlace?: boolean, drives?: boolean, lost?: string | null, acts?: FlowAct[], place?: BoxPlace | null, bring?: boolean }} Flow  `at` (the view's): the
 *   step it is at, -1 past its last; `line`: the chat's status line; `problem`: why a draft cannot start, in words;
 *   `inPlace`, `drives`: started In place, and the main agent drives it now (OA4); `lost`: why the turn that drove it
 *   ended before it did; `bring`: Bring my uncommitted edits, on
 * @typedef {{ key: string, name: string, steps: { why?: string, boxes: { id?: string, kind: string, agent: string, words: string, needs?: string[], gate?: boolean, readOnly?: boolean }[] }[], shipped: boolean }} SavedFlow
 * @typedef {{ files: number | null, asking: boolean, failed: string | null, answered: boolean }} Uncommitted  the count
 *   a draft's card reads (OA5): how many uncommitted files its worktree would leave in the chat's folder — null where
 *   none would be made, or where it is not known — whether it is being asked now, why the last ask failed, in words, or
 *   null, and whether any answer came for the chat's folder since the chat was opened there: Start waits for the first
 *   alone
 */

/** The prefix of a flow's row on the Agents tab: a team's part of the list (lib/side.js `isTeamItem`). */
export const FLOW_ITEM = "team:flow:";
/** The Agents tab's row for flows themselves: a new flow, by hand or from a saved one. */
export const FLOW_HOME = "team:flows";
/** A flow's row, by its id. @param {string} id */
export const flowItem = (id) => `${FLOW_ITEM}${id}`;
/** The flow a row of the Agents tab is, else null. @param {string} id */
export const flowOfItem = (id) => (String(id).startsWith(FLOW_ITEM) ? String(id).slice(FLOW_ITEM.length) : null);

/** Each box state's badge: its class (the graph's colours) and its word. */
export const BOX_BADGE = Object.freeze({
  waits: { cls: "is-waiting", words: "Waits" },
  seat: { cls: "is-waiting", words: "Waits for a seat" },
  working: { cls: "is-running", words: "At work" },
  asking: { cls: "is-asking", words: "Asks you" },
  done: { cls: "is-done", words: "Done" },
  failed: { cls: "is-failed", words: "Failed" },
  stopped: { cls: "is-stopped", words: "Stopped" },
  skipped: { cls: "is-stopped", words: "Skipped" },
  cut: { cls: "is-stopped", words: "Stopped by a restart" },
});

/**
 * A box's badge: its state's, and a gate's verdict once it answered — Go, Not yet, or No verdict, which holds the flow.
 * @param {Pick<FlowBox, "state" | "gate" | "verdict" | "goneOn">} b
 */
export function boxBadge(b) {
  if (b.gate && b.state === "done") {
    if (b.verdict?.go) return { cls: "is-done", words: "Go" };
    return b.goneOn ? { cls: "is-done", words: "Gone on past it" } : { cls: "is-asking", words: b.verdict ? "Not yet" : "No verdict" };
  }
  return BOX_BADGE[b.state] || BOX_BADGE.waits;
}

/** Each kind of box in a word, as its tag says it; a gate is an agent box that says go or not yet (OA-D10). */
export const KIND_WORDS = Object.freeze({ agent: "agent", team: "team", review: "you" });
/** What each kind does, for its tag's tip and the box's sheet. */
export const KIND_TIPS = Object.freeze({
  agent: "One of your agents, at its own level: what it changes, it changes in its own copy, for you to keep",
  team: "A team beside your chat: its lead and its workers. One that writes works in a git worktree of the flow's own, never in your folder — in your folder where it is not a git repository",
  review: "Your own review: the flow holds here until you go on, or send a box back with a line",
});

/** How a draft was drawn, after the flow's name. */
export const DRAWN_WORDS = Object.freeze({
  agent: "drawn by your agent",
  hand: "drawn by hand",
  saved: "from a saved flow",
});

/** The command that asks your main agent for a flow (HarnessV4_OneAgent_Plan OA3, OA-D6). */
export const FLOW_WORD = "/flow";
/** What `/flow` alone says: what to type after it. */
export const FLOW_USAGE = "/flow needs your words after it: what the flow is for. Your agent designs it from them";
/** What `/flow` in a team's own chat says. */
export const FLOW_TEAM_CHAT = "A team's own chat draws no flow: ask for one in its main chat";
/**
 * A message's `/flow` words, "" for the word alone, or null for a message that is no `/flow`.
 * @param {string} text
 */
export function flowWordsOf(text) {
  const m = /^\/flow(?:\s+([\s\S]*))?$/i.exec(String(text || "").trim());
  return m ? String(m[1] || "").trim() : null;
}

/** Dollars as a card says them: cents from a dime up, more places below. @param {number} v */
export function money(v) {
  const n = Number(v) || 0;
  if (n <= 0) return "";
  if (n >= 0.1) return `$${n.toFixed(2)}`;
  if (n < 0.0001) return "<$0.0001";
  return `$${(n >= 0.01 ? n.toFixed(3) : n.toFixed(4)).replace(/(\.\d\d\d*?)0+$/, "$1")}`;
}
/** A span in a few words: "40 s", "12 min", "2 h 10 min". @param {number} ms */
export function span(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
}
/** Text on one line, cut to `n`. @param {unknown} s @param {number} n */
export const lineOf = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** Every box of a flow with its step. @param {Pick<Flow, "steps">} f */
export const boxesOf = (f) => f.steps.flatMap((s, i) => s.boxes.map((box) => ({ box, step: i })));
/** A box by its id, with its step, else null. @param {Pick<Flow, "steps">} f @param {string} id */
export const boxOf = (f, id) => boxesOf(f).find((x) => x.box.id === id) || null;
/** A box at work or asking. @param {Pick<FlowBox, "state">} b */
export const isLive = (b) => b.state === "seat" || b.state === "working" || b.state === "asking";
/** Whether a flow has ended. @param {Pick<Flow, "state">} f */
export const ended = (f) => f.state === "done" || f.state === "stopped";
/** The step a running flow is at, its first for a draft, its last once ended: the one its line names. @param {Flow} f */
export const stepNow = (f) => (Number.isInteger(f.at) && f.at >= 0 ? f.at : f.state === "draft" ? 0 : f.steps.length - 1);

/**
 * How long a box took, or has taken so far. @param {Pick<FlowBox, "startedAt" | "endedAt">} b @param {number} now
 */
export const tookOf = (b, now) => (b.startedAt ? span((b.endedAt || now) - b.startedAt) : "");

/**
 * What a box's card says under its name: its words in a draft; while it works, how long; what it waits for; its
 * verdict, its cost and its time once done; why it failed or stopped.
 * @param {FlowBox} b @param {number} step  its step @param {Flow} f @param {number} now
 */
export function boxLine(b, step, f, now) {
  if (f.state === "draft") return lineOf(b.words, 90);
  const made = b.result?.made?.length ? `${b.result.made.length} artifact${b.result.made.length === 1 ? "" : "s"}` : "";
  const drew = b.result?.drew?.length ? `${b.result.drew.length} picture${b.result.drew.length === 1 ? "" : "s"}` : "";
  switch (b.state) {
    case "waits":
      return step > stepNow(f) ? `waits for step ${step}` : b.kind === "review" ? "waits for its step" : "waits to start";
    case "seat":
      return `waits for ${b.waiting || "a free seat"}`;
    case "working":
      return [b.sentBack ? `sent back${b.sentBack > 1 ? ` ${b.sentBack} times` : ""}` : "", b.kind === "team" ? "its lead and its workers at work" : "at work", tookOf(b, now)].filter(Boolean).join(" · ");
    case "asking":
      return b.kind === "review" ? "waits for you: go on, or send a box back" : b.error || "asks you";
    case "done":
      if (b.gate) return [b.verdict?.go ? "Verdict: go" : b.verdict ? `Verdict: not yet${b.verdict.why ? ` — ${lineOf(b.verdict.why, 60)}` : ""}` : "no Verdict line in its answer", money(b.usd)].filter(Boolean).join(" · ");
      if (b.kind === "review") return "you went on";
      return [made, drew, b.result?.wrote ? "changes in its own copy" : "", money(b.usd), tookOf(b, now)].filter(Boolean).join(" · ");
    case "skipped":
      return "skipped: it hands on nothing";
    case "cut":
      return "cut by the restart";
    default:
      return b.error || BOX_BADGE[b.state]?.words.toLowerCase() || "";
  }
}

/**
 * Where a flow stands, after its name: how it was drawn while a draft; the step it is at and what it spent; that it asks
 * you; how it ended. `tone`: "warn" while it waits for you, "gray" once stopped, "done", else "". `at` and `n`: the
 * step it is at, counted from 1, and how many — the digit the head rolls (the Designer's of 10-28); `at` 0 where the
 * words name no step.
 * @param {Flow} f @returns {{ words: string, tone: "" | "warn" | "gray" | "done", at: number, n: number }}
 */
export function flowFig(f) {
  const n = f.steps.length;
  const at = Math.min(n, stepNow(f) + 1);
  const spent = money(f.usd);
  const asks = f.state === "holds" || boxesOf(f).some((x) => x.box.state === "asking");
  if (f.state === "draft") return { words: DRAWN_WORDS[f.drawn] || DRAWN_WORDS.hand, tone: "", at: 0, n };
  if (f.state === "done") return { words: ["done", `${boxesOf(f).length} boxes`, spent].filter(Boolean).join(" · "), tone: "done", at: 0, n };
  if (f.state === "stopped") return { words: [`stopped at step ${at} of ${n}`, spent].filter(Boolean).join(" · "), tone: "gray", at, n };
  if (f.state === "cut") return { words: `step ${at} of ${n} · stopped by a restart`, tone: "gray", at, n };
  return { words: [`step ${at} of ${n}`, asks ? "asks you" : spent].filter(Boolean).join(" · "), tone: asks ? "warn" : "", at, n };
}

/**
 * What changed in a flow between two reads the page saw (the Designer's of 10-28: motion comes from what changed since
 * the last read, played once after the card is drawn): it started, it ended, the step it is at moved, a box's state
 * moved, it came to ask you. Null where nothing it plays moved.
 * @typedef {{ at: number, started: boolean, ended: "done" | "stopped" | null, step: { from: number, to: number } | null,
 *   boxes: Record<string, { from: BoxState, to: BoxState }>, asked: string | null }} FlowMoment  `step`: from and to,
 *   counted from 0, -1 before the first; `asked`: the box that came to ask you (your review, a gate, a box that holds it)
 *   — "hold" for a hold of no box, its driver's turn ended, and "cut" for a restart's cut: no box of the card is it
 * @param {Flow | null} before @param {Flow} after @param {number} at
 * @returns {FlowMoment | null}
 */
export function changesOf(before, after, at) {
  if (after.state === "draft") return null;
  const was = before && before.state !== "draft" ? before : null;
  const started = !was && (after.state === "running" || after.state === "holds");
  const ended = (after.state === "done" || after.state === "stopped") && !!was && !ended_(was) ? after.state : null;
  const from = was ? stepNow(was) : -1;
  const to = stepNow(after);
  const step = (was || started) && from !== to && !ended_(after) ? { from, to } : null;
  /** @type {Record<string, { from: BoxState, to: BoxState }>} */
  const boxes = {};
  const old = new Map((before ? boxesOf(before) : []).map((x) => [x.box.id, x.box.state]));
  for (const { box } of boxesOf(after)) {
    const s = old.get(box.id) || "waits";
    if (s !== box.state && (was || started)) boxes[box.id] = { from: s, to: box.state };
  }
  // A hold of no box — its driver's turn ended — and a restart's cut come to ask you too: no box blooms, and the gate or
  // the callout that says so rises in (the Hunter's of 10-28).
  const asking = (/** @type {Flow} */ f) => (f.state === "cut" ? "cut" : f.state === "holds" ? f.hold?.box || "hold" : boxesOf(f).find((x) => x.box.state === "asking")?.box.id || null);
  const nowAsks = after.state === "running" || after.state === "holds" || after.state === "cut" ? asking(after) : null;
  const asked = nowAsks && (!was || asking(was) !== nowAsks || was.state !== after.state) ? nowAsks : null;
  if (!started && !ended && !step && !Object.keys(boxes).length && !asked) return null;
  return { at, started, ended, step, boxes, asked };
}
/** @param {Flow} f */
const ended_ = (f) => f.state === "done" || f.state === "stopped";

/**
 * A draft in one line under its steps: "5 steps · 6 boxes · 1 writes · 1 gate · at most 2 of your 4 seats".
 * @param {Flow} f @param {number | null} [seats]  how many seats the chat's agents have, where known
 */
export function sumLine(f, seats = null) {
  const all = boxesOf(f).map((x) => x.box);
  const writers = all.filter((b) => b.writes).length;
  const gates = all.filter((b) => b.gate).length;
  const reviews = all.filter((b) => b.kind === "review").length;
  const s = f.steps.length;
  return [
    `${s} step${s === 1 ? "" : "s"}`,
    `${all.length} box${all.length === 1 ? "" : "es"}`,
    writers ? `${writers} write${writers === 1 ? "s" : ""}` : "",
    gates ? `${gates} gate${gates === 1 ? "" : "s"}` : "",
    reviews ? `${reviews === 1 ? "your review" : `${reviews} reviews of yours`}` : "",
    f.seats ? `at most ${f.seats}${seats ? ` of your ${seats}` : ""} seat${(seats || f.seats) === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");
}

/** What a draft says of itself before Start: each box is handed what it needs, and nothing runs yet. */
export const DRAFT_NOTE = "Each box is handed your words and the results of the boxes it needs. Nothing runs until you press Start: beside your chat, your agent is told the flow as it stands; In place (Start ▾), your agent drives it in a turn of its own.";
/** What Start ▾ offers (OA4): beside the chat, as Start does, or In place. */
export const START_WAYS = Object.freeze({
  beside: { label: "Beside your chat", desc: "Filament runs the steps; your chat stays yours, and your agent is told the flow with your next message" },
  inPlace: { label: "In place", desc: "A turn of your agent drives it: it hears each result as it lands, and may retry, skip, send back, or answer a gate" },
});

/**
 * How a flow started In place stands with your agent, under its head (OA4): it drives it; or it went on beside your
 * chat. Null for one started beside the chat, a draft, or one whose hold says it (the turn that drove it ended).
 * @param {Flow} f @returns {string | null}
 */
export function placeWords(f) {
  if (!f.inPlace || f.state === "draft") return null;
  if (f.drives && f.state !== "done" && f.state !== "stopped") return f.state === "cut" ? "In place · your agent's turn goes on after the restart, and may retry or skip what it cut" : "In place · your agent drives it in its turn and hears each result as it lands";
  if (f.drives) return "In place · your agent drove it in its turn";
  if (f.state === "holds" && f.hold?.kind === "driver") return null;
  return `Started in place${f.lost ? ` · ${f.lost}` : ""} · ${f.state === "done" || f.state === "stopped" ? "it went on beside your chat" : "it goes on beside your chat"}`;
}

/** "your uncommitted file", "your 3 uncommitted files". @param {number} n */
const yourFiles = (n) => (n === 1 ? "your uncommitted file" : `your ${n} uncommitted files`);

/**
 * Where a flow works (HarnessV4_OneAgent_Plan OA5), under its head: the git worktree of its own its first team that writes
 * made — its branch, its folder, and what of your uncommitted files it was given where you asked — or your folder, where
 * it is not a git repository. Null before such a team started.
 * @param {Pick<Flow, "place">} f @returns {{ words: string, title: string, worktree: boolean } | null}
 */
export function worksWords(f) {
  const p = f.place;
  if (p?.kind === "worktree") {
    const b = p.brought;
    const stays = b?.stays.length ? ` ${b.stays.slice(0, 3).join(", ")}${b.stays.length > 3 ? ` and ${b.stays.length - 3} more` : ""} stayed: not ${b.stays.length === 1 ? "a plain file" : "plain files"}.` : "";
    const brought = !b ? "" : b.files ? `\n${yourFiles(b.files)[0].toUpperCase()}${yourFiles(b.files).slice(1)} ${b.files === 1 ? "was" : "were"} copied in as uncommitted edits; your folder keeps ${b.files === 1 ? "it" : "them"}.${stays}` : `\nNothing was uncommitted in your folder to copy in.${stays}`;
    const said = !b ? "" : b.files ? ` · ${yourFiles(b.files)} brought` : " · nothing uncommitted to bring";
    return { words: `Works in its own worktree · branch ${p.branch}${said}`, title: `${p.folder}\nMade from your folder's last commit when its first team that writes started; every box after it works there, never in your folder. Nothing is merged: the branch is yours to merge, or to let go${brought}`, worktree: true };
  }
  if (p?.kind === "folder") return { words: "Works in your folder", title: `${p.why[0].toUpperCase()}${p.why.slice(1)}: its teams that write change your folder's files`, worktree: false };
  return null;
}

/** Bring my uncommitted edits, a draft's switch (OA5): off unless the person switches it on. */
export const BRING_WORDS = Object.freeze({
  label: "Bring my uncommitted edits",
  title: "As its first team that writes starts, your folder's changed, new and deleted files are copied into the flow's worktree as uncommitted edits. Nothing is committed, and your folder keeps its own",
});

/**
 * What a draft says of your uncommitted files (OA5), beside its Bring my uncommitted edits: its first team that writes
 * starts a new branch from your folder's last commit, so they stay here — or, switched on, are copied in. `uncommitted`:
 * how many your folder has (the list's read), null where no worktree would be made or the count is not known
 * (`countNote` speaks then). Null where it has nothing to say: no team box that writes, a folder with nothing
 * uncommitted and the switch off.
 * @param {Pick<Flow, "state" | "steps" | "bring" | "place">} f @param {number | null} uncommitted @returns {string | null}
 */
export function bringNote(f, uncommitted) {
  if (f.state !== "draft" || f.place || uncommitted == null || !boxesOf(f).some((x) => x.box.writes)) return null;
  const from = "Its first team that writes starts a new branch from your folder's last commit";
  if (!f.bring) return uncommitted ? `${from}, so ${yourFiles(uncommitted)} ${uncommitted === 1 ? "stays" : "stay"} here.` : null;
  return uncommitted
    ? `${from}, and ${yourFiles(uncommitted)} ${uncommitted === 1 ? "is" : "are"} copied into it as uncommitted edits: nothing is committed, and your folder keeps ${uncommitted === 1 ? "it" : "them"}.`
    : `${from}, and what is uncommitted in your folder as it starts is copied into it as uncommitted edits: nothing is now.`;
}

/** The words on a draft's Start while its count is asked: Start waits for them. */
export const COUNT_HELD_WORDS = "Checking your folder for uncommitted files…";

/**
 * What a draft says while its count is not known (OA5): why the last count failed, with the way the flow starts all the
 * same, which does not hold Start — they may start knowing it is not known, or ask again, and a count asked again
 * meanwhile changes nothing of it — or that its folder is being checked, which holds Start while no answer of any kind
 * has come for the folder yet: the person learns what stays behind before they can start. Null where the count is
 * known, where there is nothing to count — no team that writes, no worktree to make — or where the count was never
 * asked.
 * @param {Pick<Flow, "state" | "steps" | "bring" | "place">} f @param {Uncommitted | null | undefined} c
 * @returns {{ held: boolean, words: string } | null}
 */
export function countNote(f, c) {
  if (f.state !== "draft" || f.place || !c || c.files != null || !boxesOf(f).some((x) => x.box.writes)) return null;
  if (c.failed) {
    const from = "Its first team that writes starts a new branch from your folder's last commit";
    return {
      held: false,
      words: `Your folder's uncommitted files could not be counted: ${c.failed}. ${from}, ${f.bring ? "and whatever is uncommitted in your folder as it starts is copied into it as uncommitted edits" : "so whatever is uncommitted in your folder stays here"}.`,
    };
  }
  return c.asking && !c.answered ? { held: true, words: COUNT_HELD_WORDS } : null;
}

/** Retry without my edits (OA5): a failed Bring my uncommitted edits switched off for the flow, and the box started again. */
export const BRING_FAILED_WORDS = Object.freeze({
  note: "Its worktree was made from your folder's last commit, but your uncommitted edits could not be copied into it, so it was taken back. Retry tries the copy again.",
  label: "Retry without my edits",
  title: "Bring my uncommitted edits is switched off for this flow, and the box starts again: its worktree starts from your folder's last commit alone, and your uncommitted files stay here",
});

/**
 * Whether a box failed because its flow's Bring my uncommitted edits could not copy them into the worktree it made
 * (OA5), while the flow still has no place: its card offers Retry without them. @param {Pick<Flow, "bring" | "place">} f @param {Pick<FlowBox, "state" | "failedOn">} b
 */
export const bringFailed = (f, b) => b.state === "failed" && b.failedOn === "bring" && f.bring === true && !f.place;

/** A writing box's tag tip (OA5): where it writes, once it started, else where it will. @param {Pick<FlowBox, "place">} b */
export const writeTip = (b) =>
  b.place?.kind === "worktree" ? `Writes on branch ${b.place.branch}, in the flow's own worktree: never in your folder` : b.place ? "Writes in your folder: it is not a git repository" : "Writes: in a git project, in a worktree of the flow's own, never in your folder; else in your folder";

/** Where a writing box's changes are, on its sheet (OA5); null before it started. @param {Pick<FlowBox, "place" | "writes">} b */
export const placeNote = (b) =>
  !b.writes || !b.place ? null : b.place.kind === "worktree" ? `Its changes are on branch ${b.place.branch}, in the worktree ${b.place.folder}. Nothing is merged into your folder.` : "Its changes are in your folder: it is not a git repository.";

/** What your agent did to a flow it drives, the newest first (OA4 case 3): the card says each with its why. @param {Flow} f @param {number} [n] */
export const agentActs = (f, n = 3) => (f.acts || []).filter((a) => a.by === "agent").slice(-n).reverse();
/** What Tell my agent when done says. */
export const TELL_WORDS = Object.freeze({
  label: "Tell my agent when done",
  title: "At the end your agent gets one message: a line for each box and the last step's results whole. It reads nothing of the flow before then",
});

/**
 * The boxes a gate or your review needs, each a Send back: its words and what it does.
 * @param {Flow} f @param {string} boxId  the gate's or the review's
 */
export function backOffers(f, boxId) {
  const at = boxOf(f, boxId);
  if (!at) return [];
  const review = at.box.kind === "review";
  const what = review ? "your line" : "the gate's answer and your line";
  const then = review ? "then you review again" : "then the gate reads again";
  return at.box.needs.map((id) => boxOf(f, id)?.box).filter((b) => !!b && b.kind !== "review").map((b) => {
    const x = /** @type {FlowBox} */ (b);
    return {
      id: x.id,
      label: `Send back to ${x.name}`,
      title: x.kind === "team"
        ? `A new turn in its chat with ${what}${x.writes ? `: ${x.name}'s changes stay, and it goes on from them` : ""}; ${then}`
        : `It runs again with ${what}; ${then}`,
    };
  });
}

/** What a gate that held says on its card: its name and verdict, and why. @param {FlowBox} g */
export function gateWords(g) {
  const head = g.verdict ? `${g.name} — not yet` : `${g.name} gave no verdict`;
  const why = g.verdict ? g.verdict.why || "Its answer says not yet, with no reason on its line." : "Its answer has no Verdict line, so the flow holds as for not yet.";
  // How many times it sent a box back (its own count: `sentBack` is a box's sent back to it).
  const n = g.sends || 0;
  return { head, why, back: n ? `sent back ${n === 1 ? "once" : `${n} times`}` : "" };
}

/**
 * Where a flow's end message stands with the main agent, at its card's foot; null where it was not to go.
 * @param {Flow} f @returns {{ words: string, tone: "ok" | "wait" | "warn", send: boolean } | null}
 */
export function endWords(f) {
  const e = f.end;
  if (f.state !== "done") return null;
  // Driven In place (OA4): its agent heard its end in the turn that drove it; no message of its own went.
  if (!e && f.inPlace && f.drives) return { words: "Your agent heard its end in the turn that drove it", tone: "ok", send: false };
  if (!e) return null;
  if (e.sent) return { words: e.sent.how === "envelope" ? "Its end went to your agent as an envelope: it opens it when it reaches a stopping point" : e.sent.how === "steered" ? "Its end went to your agent: its running turn read it" : "Its end went to your agent", tone: "ok", send: false };
  if (e.waits) return { words: "Its end goes to your agent once your chat's turn ends", tone: "wait", send: false };
  if (e.missed) return { words: `Its end did not reach your agent: ${e.missed}`, tone: "warn", send: true };
  return { words: "Filament stopped before its end went to your agent", tone: "warn", send: true };
}

/**
 * Whether a flow needs the person: a draft to start, a hold, a box that asks, a restart's Go on, an end that did not go.
 * @param {Flow} f
 */
export function needsYou(f) {
  if (f.state === "draft" || f.state === "holds" || f.state === "cut") return true;
  if (f.state === "running") return boxesOf(f).some((x) => x.box.state === "asking");
  return !!endWords(f)?.send;
}

/** The flow's chat status line names it while it runs, holds or waits after a restart. @param {Flow} f */
export const showsInStatus = (f) => f.state === "running" || f.state === "holds" || f.state === "cut";

/**
 * The chat's status line for its flows (§4.8): the one that waits for you first, else the one that runs — its line, and
 * a writing team box at work said, so neither you nor your agent edits its files unaware (§4.7). Null with none.
 * @param {readonly Flow[]} flows
 * @returns {{ id: string, words: string, title: string, tone: "" | "warn" | "gray" } | null}
 */
export function statusOf(flows) {
  const shown = flows.filter(showsInStatus);
  const f = shown.find(needsYou) || shown.find((x) => x.state === "running") || shown[0];
  if (!f) return null;
  const writer = boxesOf(f).find((x) => x.box.writes && x.box.state === "working")?.box;
  const tone = f.state === "cut" ? "gray" : needsYou(f) ? "warn" : "";
  const more = shown.length > 1 ? ` · +${shown.length - 1}` : "";
  return {
    id: f.id,
    words: `${f.line}${more}`,
    title: [`“${f.title}”`, writer ? (writer.place?.kind === "worktree" ? `${writer.name} is writing on branch ${writer.place.branch}, not in this folder` : `${writer.name} is writing in this folder`) : "", "Open it on the Agents tab"].filter(Boolean).join(" · "),
    tone,
  };
}

/**
 * A flow as a row of the Agents tab, beside the teams (lib/side.js `TeamItem`): by what it needs of you; its boxes at
 * work or asking under it, an agent box opening its thread; the sub-agents it ran leave the list, under it.
 * @param {Flow} f @param {number} now @returns {import("./side.js").TeamItem}
 */
export function flowRow(f, now) {
  const fig = flowFig(f);
  const group = needsYou(f) ? "needs" : f.state === "running" ? "works" : "done";
  const tone = fig.tone === "warn" ? "asks" : f.state === "running" ? "works" : f.state === "stopped" || f.state === "cut" ? "warn" : "ok";
  const held = (/** @type {FlowBox} */ b) => f.state === "holds" && f.hold?.box === b.id;
  const live = boxesOf(f).filter((x) => isLive(x.box) || held(x.box) || (f.state === "cut" && x.box.state === "cut"));
  /** A crew line's tone: it asks you, it failed, it stopped, or it works. @param {FlowBox} b @returns {import("./side.js").TeamItem["tone"]} */
  const crewTone = (b) => (b.state === "asking" || (held(b) && b.state === "done") ? "asks" : b.state === "failed" ? "error" : b.state === "stopped" || b.state === "cut" ? "warn" : "works");
  return {
    id: flowItem(f.id),
    way: "flow",
    group,
    key: "",
    name: "Flow",
    look: { icon: "waypoints", tone: fig.tone === "warn" ? "orange" : f.state === "stopped" || f.state === "cut" ? "gray" : "cyan" },
    tag: f.state === "draft" ? "drawn" : "flow",
    task: f.title,
    fact: f.state === "draft" ? (f.problem ? "cannot start yet" : "waits for your Start") : f.state === "done" ? [fig.words, endWords(f)?.send ? "its end did not go" : ""].filter(Boolean).join(" · ") : fig.words,
    tone,
    // Its place among the agents of its part: when it started, else when it was drawn.
    at: Number(f.startedAt ?? f.at) || 0,
    crew: live.map(({ box }) => ({
      id: box.run?.sub || flowItem(f.id),
      name: box.name,
      fact: boxBadge(box).words.toLowerCase(),
      tone: crewTone(box),
      icon: box.kind === "team" ? "users" : box.kind === "review" ? "user" : "bot",
      thread: !!box.run?.sub,
    })),
    // Its boxes' sub-agents, now and before — a gate asked again, a box retried: each thread stays under the flow.
    crewIds: boxesOf(f).flatMap((x) => [x.box.run?.sub, ...(x.box.ran || [])]).filter((x) => typeof x === "string"),
    // Deleted from the list with what it ran (the owner's ask of 10-23); a worktree of its own stays.
    drop: { id: f.id, state: f.state, keeps: !!f.place },
  };
}

/** Whether a team beside is a flow's box: its row is the flow's, not the list's own. @param {{ flow?: { id: string, box: string } | null }} r */
export const isFlowTeam = (r) => !!r?.flow;

/**
 * A flow's steps as an edit sends them: each step's why, each box's own fields — its id and its needs with them — none of
 * its run. @param {Pick<Flow, "steps">} f
 */
export const stepsBody = (f) => f.steps.map((s) => ({ why: s.why || "", boxes: s.boxes.map((b) => ({ id: b.id, kind: b.kind, agent: b.agent, words: b.words, needs: [...(b.needs || [])], gate: !!b.gate, readOnly: !!b.readOnly, model: b.model || null, ...(b.effort ? { effort: b.effort } : {}), sees: b.sees || null })) }));

/**
 * A draft's steps with one box moved a step up (`dir` -1) or down (+1), as Move up and Move down send them (OA3, L38):
 * into the step above or below, or into a step of its own before the first or after the last where it shares its own;
 * a step it leaves empty goes. Its needs stay as they were, so one that no longer holds shows on the box. Null where it
 * cannot move: alone in the first step, up, or in the last, down.
 * @param {Pick<Flow, "steps">} f @param {number} step @param {number} index @param {-1 | 1} dir
 */
export function moveBox(f, step, index, dir) {
  const steps = stepsBody(f);
  const at = steps[step];
  const box = at?.boxes[index];
  if (!box) return null;
  const alone = at.boxes.length === 1;
  if ((dir < 0 && step === 0 && alone) || (dir > 0 && step === steps.length - 1 && alone)) return null;
  at.boxes.splice(index, 1);
  if (dir < 0 && step === 0) steps.unshift({ why: "", boxes: [box] });
  else if (dir > 0 && step === steps.length - 1) steps.push({ why: "", boxes: [box] });
  else steps[step + dir].boxes.push(box);
  return steps.filter((s) => s.boxes.length);
}

/** A box's needs in words, as its card says them: "needs PM and Designer", "needs nothing". @param {Pick<FlowBox, "needsOf">} b */
export function needsWords(b) {
  const names = (b.needsOf || []).map((n) => n.name);
  return names.length ? `needs ${names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`}` : "needs nothing";
}

/** A saved flow's steps in a line: "Product → Builder, Product → Reviewer ⛉ → Builders → BugHunters". @param {SavedFlow} s @param {(b: any) => string} nameOf */
export const savedLine = (s, nameOf) => s.steps.map((st) => st.boxes.map((b) => `${nameOf(b)}${b.gate ? " ⛉" : ""}`).join(", ")).join(" → ");

/** The routes a flow's press goes through. @param {string} chainId @param {typeof api} [call] */
export const flowRoutes = (chainId, call = api) => {
  const base = `/sessions/${encodeURIComponent(chainId)}/flows`;
  /** @param {string} id */
  const one = (id) => `${base}/${encodeURIComponent(id)}`;
  return {
    /** @returns {Promise<{ flows: Flow[] }>} */
    list: () => call(base),
    /** What a draft's worktree would leave in your folder (`bringNote`); `error`, why git could not tell. @returns {Promise<{ uncommitted: number | null, error?: string }>} */
    uncommitted: () => call(`${base}/uncommitted`),
    /** A flow by hand, or from a saved one. @param {any} body @returns {Promise<{ flow: Flow }>} */
    create: (body) => call(base, { method: "POST", body }),
    /** @param {string} id @returns {Promise<Flow>} */
    get: (id) => call(one(id)),
    /** @param {string} id @param {{ steps?: any[], goal?: string, title?: string, tell?: boolean, bring?: boolean }} body @returns {Promise<{ flow: Flow }>} */
    edit: (id, body) => call(one(id), { method: "PUT", body }),
    /** Off the list; `runs`: what it ran with it, the Agents tab's Delete (the owner's ask of 10-23). @param {string} id @param {{ runs?: boolean }} [o] */
    remove: (id, o = {}) => call(`${one(id)}${o.runs ? "?runs=1" : ""}`, { method: "DELETE" }),
    /** Beside the chat, or In place (OA4). @param {string} id @param {{ inPlace?: boolean }} [o] @returns {Promise<{ flow: Flow }>} */
    start: (id, o = {}) => call(`${one(id)}/start`, { method: "POST", body: o.inPlace ? { inPlace: true } : {} }),
    /** At a gate, or your review (`box`), or where the turn that drove it ended (OA4: `on` goes on beside). @param {string} id @param {{ action: "back" | "on" | "stop", box?: string, to?: string, line?: string }} body @returns {Promise<{ flow: Flow }>} */
    decide: (id, body) => call(`${one(id)}/decide`, { method: "POST", body }),
    /** @param {string} id @returns {Promise<{ flow: Flow }>} */
    stop: (id) => call(`${one(id)}/stop`, { method: "POST", body: {} }),
    /** @param {string} id @returns {Promise<{ flow: Flow }>} */
    goOn: (id) => call(`${one(id)}/go-on`, { method: "POST", body: {} }),
    /** @param {string} id @returns {Promise<{ flow: Flow }>} */
    send: (id) => call(`${one(id)}/send`, { method: "POST", body: {} }),
    /** @param {string} id @param {{ name?: string }} body @returns {Promise<{ saved: SavedFlow }>} */
    keep: (id, body) => call(`${one(id)}/keep`, { method: "POST", body }),
    /** A box's result whole. @param {string} id @param {string} bid */
    result: (id, bid) => call(`${one(id)}/boxes/${encodeURIComponent(bid)}`),
    /** @param {string} id @param {string} bid @param {"stop" | "skip" | "retry" | "hand-on" | "take"} act @returns {Promise<{ flow: Flow }>} */
    act: (id, bid, act) => call(`${one(id)}/boxes/${encodeURIComponent(bid)}/${act}`, { method: "POST", body: {} }),
    /** @returns {Promise<{ flows: SavedFlow[] }>} */
    saved: () => call("/flows/saved"),
    /** @param {string} key */
    forget: (key) => call(`/flows/saved/${encodeURIComponent(key)}`, { method: "DELETE" }),
  };
};
/** @typedef {ReturnType<typeof flowRoutes>} FlowRoutes */

/**
 * The open chat's flows, followed: read when the chat changes, when the feed says one moved, and on a slow timer while
 * one runs. What changed in each between two reads of the same chat — or a write the server answered — is kept a
 * moment to be played (`changes`, the Designer's of 10-28); a chat's first read keeps none, so a card opened plays
 * nothing.
 * @param {{ call?: typeof api, later?: (fn: () => void, ms: number) => any, clear?: (t: any) => void, now?: () => number }} [o]
 */
export function createFlowList(o = {}) {
  const call = o.call || api;
  const later = o.later || ((fn, ms) => setTimeout(fn, ms));
  const clear = o.clear || ((t) => clearTimeout(t));
  const now = o.now || Date.now;
  let chainId = "";
  /** @type {Flow[]} */
  let flows = [];
  /** How many uncommitted files a draft's worktree would leave in the chat's folder, as the last count said. @type {number | null} */
  let uncommitted = null;
  /** Whether a count is being asked now: a draft's Start waits while none has been answered yet. */
  let asking = false;
  /** Whether any count was answered — counted, nothing to say, or failed — for the open chat's folder. */
  let answered = false;
  /** Why the last count failed, in words; null where it did not. The card says it and offers Count again. @type {string | null} */
  let failed = null;
  /** The drafts, their steps with them, the last count was asked for: asked again only where they changed. */
  let countedFor = "";
  /** Whether the next count is asked whatever the drafts: the chat's turn let go, so its agent's files may have changed. */
  let recount = false;
  let counting = 0;
  /** The open chat's folder, where the page knows it: the count is its. */
  let folderOf = "";
  /** A draft whose card says the count: one with a team that writes, which makes the worktree. @param {Flow} f */
  const writingDraft = (f) => f.state === "draft" && boxesOf(f).some((x) => x.box.writes);
  /** The count let go whole, as for another folder: nothing known, nothing asked, nothing answered. */
  const dropCount = () => {
    uncommitted = null;
    asking = false;
    answered = false;
    failed = null;
    countedFor = "";
    recount = false;
    counting += 1;
  };
  /** Whether the open chat's flows were read once: only then is a change one the page saw happen. */
  let known = false;
  /** Each flow's moments still to be played, by its id. @type {Map<string, FlowMoment[]>} */
  const moments = new Map();
  /** What moved from the list as it was to the one now: each flow's moment kept, the old ones let go. @param {Flow[]} was @param {Flow[]} next */
  const note = (was, next) => {
    const t = now();
    for (const [id, list] of moments) {
      const kept = list.filter((m) => t - m.at < MOMENT_MS);
      if (kept.length) moments.set(id, kept);
      else moments.delete(id);
    }
    if (!known) return;
    const old = new Map(was.map((f) => [f.id, f]));
    for (const f of next) {
      const m = changesOf(old.get(f.id) || null, f, t);
      if (m) moments.set(f.id, [...(moments.get(f.id) || []), m]);
    }
  };
  let seq = 0;
  /** @type {any} */
  let resync = null;
  /** @type {any} */
  let settle = null;
  /** @type {Set<() => void>} */
  const listeners = new Set();
  const emit = () => {
    for (const fn of listeners) fn();
  };

  async function load() {
    if (!chainId) return;
    const mine = ++seq;
    const at = chainId;
    try {
      const r = await call(`/sessions/${encodeURIComponent(at)}/flows`);
      if (mine !== seq) return;
      const next = Array.isArray(r?.flows) ? r.flows : [];
      note(flows, next);
      flows = next;
      known = true;
      emit();
      void count();
    } catch {
      // Unreachable for now, or a chat with no archive: the cards stay as last seen.
    }
    if (mine !== seq) return;
    if (resync) clear(resync);
    resync = flows.some((f) => f.state === "running" || (f.state === "done" && f.end?.waits)) ? later(load, RESYNC_MS) : null;
  }

  /**
   * The count a draft's card says, asked on its own after the flows, and only for a draft with a team that writes —
   * the one that makes a worktree, the one whose card says the count: git walks the folder for it, so it is asked only
   * where those drafts changed or the chat's turn let go — not as a flow moves, nor on the slow timer. While the first
   * is asked the card says so and holds Start; one that fails — the route's `error`, or no answer — says why, with
   * Count again, and holds nothing, and is asked again as a count is: the drafts changed, the turn let go, Count again.
   * What the folder's count last said stays while no such draft stands, for the next: a stale one is asked again as
   * that draft comes.
   */
  async function count() {
    const drafts = flows.filter(writingDraft);
    const key = drafts.length ? JSON.stringify(drafts.map((f) => [f.id, f.steps])) : "";
    const again = recount;
    recount = false;
    if (!key) {
      countedFor = "";
      counting += 1;
      if (asking) {
        asking = false;
        emit();
      }
      return;
    }
    if (key === countedFor && !again) return;
    countedFor = key;
    const mine = ++counting;
    const at = chainId;
    if (!asking) {
      asking = true;
      emit();
    }
    try {
      const r = await call(`/sessions/${encodeURIComponent(at)}/flows/uncommitted`);
      if (mine !== counting || at !== chainId) return;
      uncommitted = Number.isInteger(r?.uncommitted) ? r.uncommitted : null;
      failed = typeof r?.error === "string" && r.error ? r.error : null;
    } catch (/** @type {any} */ e) {
      if (mine !== counting || at !== chainId) return;
      uncommitted = null;
      failed = String(e?.message || e || "Filament did not answer");
    }
    answered = true;
    asking = false;
    emit();
  }

  return {
    chainId: () => chainId,
    /** The open chat's flows, the newest first. @returns {Flow[]} */
    rows: () => flows,
    /** @param {string} id */
    row: (id) => flows.find((f) => f.id === id) || null,
    /**
     * The count a draft's card reads (`bringNote`, `countNote`): how many uncommitted files its worktree would leave in
     * the open chat's folder, null where none would or it is not known; whether it is asked now; why it failed; whether
     * any answer came for the folder.
     * @returns {Uncommitted}
     */
    uncommitted: () => ({ files: uncommitted, asking, failed, answered }),
    /** Count again: the count asked once more, whatever the drafts — the card's press after a failed one. */
    recount() {
      recount = true;
      void count();
    },
    /**
     * The open chat changed: its flows are read. `folder`, the chat's, where the page knows it: the count is the
     * folder's, so a chat moved to another folder (sessions/move.js) drops the old one's and holds Start for the new
     * folder's first; a folder not known yet, then known, is the one the count was asked for.
     * @param {string | null} id @param {string | null} [folder]
     */
    setChain(id, folder = "") {
      const next = String(id || "");
      const at = String(folder || "");
      if (next === chainId) {
        if (at && folderOf && at !== folderOf) {
          folderOf = at;
          dropCount();
          emit();
          void count();
        } else if (at) folderOf = at;
        return;
      }
      chainId = next;
      folderOf = at;
      flows = [];
      dropCount();
      known = false;
      moments.clear();
      seq += 1;
      emit();
      void load();
    },
    refresh: load,
    /** A flow the server answered with a write: it stands in the list at once. @param {Flow | null | undefined} f */
    put(f) {
      if (!f || f.chainId !== chainId) return;
      const i = flows.findIndex((x) => x.id === f.id);
      const next = i < 0 ? [f, ...flows] : flows.map((x, j) => (j === i ? f : x));
      note(flows, next);
      flows = next;
      emit();
      void count();
    },
    /** A flow gone from the list. @param {string} id */
    drop(id) {
      const had = flows.length;
      flows = flows.filter((x) => x.id !== id);
      if (flows.length === had) return;
      emit();
      void count();
    },
    /**
     * The feed said a flow of the open chat moved — or, with a draft on its list, that the chat's turn let go of it, its
     * agent's files changed: its list is read, once for a burst, and after a turn its count asked again. @param {any} msg
     */
    heard(msg) {
      const turnEnded = msg?.type === "turn" && !msg.holder && flows.some(writingDraft);
      if ((msg?.type !== "flow" && !turnEnded) || String(msg.chainId || "") !== chainId) return;
      if (turnEnded) recount = true;
      if (settle) return;
      settle = later(() => {
        settle = null;
        void load();
      }, SETTLE_MS);
    },
    /** @param {() => void} fn */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** A flow's moments the page saw happen in the last moment, to be played on its card. @param {string} id @returns {FlowMoment[]} */
    changes: (id) => (moments.get(id) || []).filter((m) => now() - m.at < MOMENT_MS),
  };
}
/** @typedef {ReturnType<typeof createFlowList>} FlowList */
