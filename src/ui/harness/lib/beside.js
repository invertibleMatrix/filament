// @ts-check
// The teams beside the open chat, as the page holds them (team_v2_plan §5.3, §5.4): the list the server answers
// (GET /api/sessions/:id/beside, app/teams-beside.js's rows), read again when the feed says one of them moved — and on a
// slow timer while one works, since an event can be lost — and the words each card and each transcript mark says. The
// Team tab draws the cards (views/beside.js), the transcript the two marks (conversation/beside-marks.js); every press
// goes through the host (app.js).
import { api } from "./api.js";
import { prettyModel } from "./families.js";
import { tokWords } from "./brief.js";
import { possessive } from "./labels.js";
import { fmt } from "../../lib/format.js";

/** How often the list is read again while a team beside works: its end must show even when its event is lost. */
const RESYNC_MS = 15_000;
/** How long a burst of the feed's events waits before one read. */
const SETTLE_MS = 300;

/**
 * A team beside as the list route answers it (app/teams-beside.js `BesideRow`).
 * @typedef {{ id: string, main: string | null, team: { key: string, name: string }, ask: string, firedBy: "you" | "agent",
 *   at: number, model: string | null, title: string, state: "working" | "asking" | "done" | "stopped",
 *   workers: { running: number, waiting: number, total: number }, verify: boolean, checked?: boolean, notify: boolean, of: string | null,
 *   verifiedBy: string | null, result: { n: number, text: string, more: boolean, at: number | null } | null,
 *   findings?: { counts: Record<FindingKind, number>, top: Finding[], total: number } | null,
 *   notified: { n: number, at: number, how: "steered" | "sent" | "waits" | "envelope" } | null, cut: boolean, readOnly: boolean,
 *   fresh?: boolean, on: BesideOn, missed?: string | null, flow?: { id: string, box: string } | null }} BesideRow  `checked`: its result comes
 *   checked — BugHunters', or the gone Verifier's, as the server knows them — so nothing checks it again: no Verify…, no
 *   switch to check it; `findings`: its result's fixed
 *   list, where its lead wrote one (team_v2_plan §10 O3); `fresh`: its lead read only the words, none of the main chat;
 *   `flow`: the flow and box it runs for, where it is a flow's team box (HarnessV4_Flow_Plan F2); `missed`: why its
 *   result, which its switch was to hand to your agent, did not go — the server's reason
 * @typedef {"found" | "confirmed" | "plausible" | "uncovered" | "dismissed"} FindingKind
 * @typedef {{ kind: FindingKind, title: string, where: string, note: string, foundBy?: number }} Finding  `foundBy`: how
 *   many Hunters reported it, where several did (the plan's p6)
 * @typedef {{ id: string, n: number, team: { key: string, name: string }, ask: string, firedBy: "you" | "agent", at: number | null,
 *   text: string, message: string, findings: { items: Finding[], counts: Record<FindingKind, number> } | null }} TeamResult
 *   a team's result whole (`GET …/beside/:tid/result`): `message`, the words your agent gets
 * @typedef {{ lead: string | null, leadEffort?: string, leadFrom?: "here", workers: string[] | null, from: "picked" | "here" | "chat" | "project" | "team" | "seats",
 *   fell: { name: string, why: string, as: "lead" | "workers", next?: string, picked?: boolean }[], seats?: number | null }} BesideOn  what a team runs on (app/teams-beside.js);
 *   `seats`: how many its workers' list lends at once, where it is known
 */

/**
 * Where a team's lead is now (the server's `GET …/beside/:tid/lead`): whether its turn runs, its rounds, its newest
 * words (their end), its newest round's calls, when its turn began and what its chat has spent.
 * @typedef {{ id: string, running: boolean, rounds: number, words: string, calls: { name: string, subject: string, open: boolean }[],
 *   startedAt: number | null, usd: number }} LeadNow
 */

/** Each state as a card's badge says it. */
export const BESIDE_BADGE = Object.freeze({ working: "At work", asking: "Asks you", done: "Done", stopped: "Stopped" });

/** Who sent it, after the team's name (team_v2_plan §10: "your agent", never "the main agent"). @param {BesideRow} r */
export const firedWords = (r) => `${r.firedBy === "agent" ? "sent by your agent" : "sent by you"}${r.fresh ? ", fresh: it read only the words" : ""}`;

/** A fired mark's title (team_v2_plan §10 O3): who sent which team. @param {BesideRow} r */
export const sentTitle = (r) => `${r.firedBy === "agent" ? "Your agent" : "You"} sent the ${r.team.name} team on the side`;

/** What a transcript's team mark says of itself (§10 O3, the mock's D8): the page draws it; the agent never reads it. */
export const ONLY_YOURS = "only on your page — your agent can't see this";

/**
 * What its workers do now: "2 at work · 1 waits for a slot"; "" with none at work.
 * @param {BesideRow} r
 */
export function workersWords(r) {
  const w = r.workers || { running: 0, waiting: 0, total: 0 };
  return [w.running ? `${w.running} at work` : "", w.waiting ? `${w.waiting} wait${w.waiting === 1 ? "s" : ""} for a slot` : ""].filter(Boolean).join(" · ");
}

/**
 * Where its result went, in a line; "" where it went nowhere yet.
 * @param {BesideRow} r
 */
export function notifiedWords(r) {
  const n = r.notified;
  if (!n) return "";
  if (n.how === "waits") return "Goes to your agent once its turn ends";
  // Into its running turn sealed (HarnessV4_Envelopes_Plan EN4): your agent opens it when it chooses, or at once if it waits.
  if (n.how === "envelope") return "Sent to your agent as an envelope: it opens it when it reaches a stopping point";
  return n.how === "steered" ? "Sent to your agent: its running turn read it" : "Sent to your agent";
}

/**
 * What its card says under its name, by its state: what it does, what it asks, how it stopped.
 * @param {BesideRow} r
 */
export function stateLine(r) {
  if (r.state === "working") return workersWords(r) || "Its lead works on it";
  if (r.state === "asking") return "Its lead asks you something: open it to answer";
  if (r.state === "stopped") return r.cut ? "Stopped before it finished: Filament stopped while it worked" : "Stopped before it finished";
  return "";
}

/**
 * The shipped team that finds bugs and checks claims (the plan's p6): Verify… opens its Brief with a team's result as
 * the claims to check, and its own result is checked by none (a row says so: `checked`). The server's is core/beside.js
 * `BUGHUNTERS`.
 */
export const BUGHUNTERS = "bughunters";

/** The switches a card, a fired mark and the Brief's When it's done carry, in their words (U13 W3). */
export const SWITCH_WORDS = Object.freeze({
  notify: { label: "Hand its result to your agent", title: "Its result goes to your agent by itself when the team ends — after BugHunters' check, where that is on too" },
  verify: { label: "Check it with BugHunters first", title: "BugHunters checks its result against the code when it ends; it fixes nothing" },
});
/** What a row and a card's line say of a result BugHunters checks (`verifiedBy`). */
export const CHECKING_WORDS = "BugHunters checks it";

/**
 * Which buttons a team's card offers now: Open always; Stop while it works; Send to your agent… and Verify, then send…
 * on a result not yet sent on — Verify, then send… not on one that comes checked (`checked`: BugHunters', the gone
 * Verifier's); Resume… on one that stopped before it finished, a restart's cut or your Stop (its conversation stays:
 * Resume… fills its box to go on). `teams` false: Settings › Experimental's Teams switch is off (src/ui/lib/teams-on.js),
 * and neither Verify, which sends BugHunters, nor Resume… is offered; a team at work still stops, and a result still goes.
 * @param {BesideRow} r @param {boolean} [teams]
 */
export function cardActions(r, teams = true) {
  const done = r.state === "done" && !!r.result;
  return {
    stop: r.state === "working",
    notify: done && !r.notified && !!r.main,
    verify: teams && done && !r.checked && !r.verifiedBy,
    resume: teams && r.state === "stopped",
    switches: r.state === "working" || r.state === "asking",
  };
}

/**
 * What a team runs on, in a line: "its lead on Claude Opus 5.5 · its workers on GLM 5.3 Flash, then Kimi K3".
 * @param {BesideOn | null | undefined} on
 */
export function onWords(on) {
  if (!on) return "";
  const lead = on.lead ? `its lead on ${prettyModel(on.lead)}` : "";
  const list = (on.workers || []).filter(Boolean).map(prettyModel).join(", then ");
  // None named, and no list of the chat's own to send: each member's card's, else its lead's (teams-beside.js `runsOn`).
  const workers = !list ? "its workers on their cards' models, else its lead's model"
    : on.from === "here" ? `its workers on this chat's models for the team: ${list}`
    : on.from === "chat" ? `its workers on their cards' models, else this chat's list: ${list}`
      : on.from === "project" ? `its workers on their cards' models, else this project's list: ${list}` : `its workers on ${list}`;
  return [lead, workers].filter(Boolean).join(" · ");
}

/**
 * Each model a team names that cannot run, and what runs in its place: "Claude Opus 5.5 cannot run now (no provider
 * serves it): its lead runs on this chat's model".
 * @param {BesideOn | null | undefined} on
 */
export function fellWords(on) {
  if (!on?.fell?.length) return [];
  // What its workers run on instead, by where the rest come from (teams-beside.js `runsOn`; the review of 0376f5a4f).
  const rest = on.from === "here" ? "its workers run on the rest of this chat's rows for the team"
    : on.from === "project" ? "its workers run on their cards' models, else this project's list"
    : on.from === "chat" ? "its workers run on their cards' models, else this chat's list"
    : (on.workers || []).length ? "its workers run on the rest of the team's list" : "its workers run on their cards' models, else its lead's model";
  return on.fell.map((f) => {
    const why = f.why ? ` (${f.why})` : "";
    // One picked for this run: Send would be refused, so the words say what to do instead.
    if (f.picked) return `${f.name} cannot run now${why}: pick another model for its ${f.as === "lead" ? "lead" : "workers"}`;
    return `${f.name} cannot run now${why}: ${f.as === "lead" ? (f.next ? `its lead runs on the next of its list, ${f.next}` : "its lead runs on this chat's model") : rest}`;
  });
}

/**
 * Each kind of finding as a result's chips count it (team_v2_plan §10 O3), in their order: a hunt's Found, Plausible,
 * Dismissed and Not covered; a check's Confirmed, Plausible and Dismissed. `tone`: the dot's colour. A plausible one
 * is "unsure" on the page (U13 W3) — "2 more unsure" after what was found or confirmed (`more`).
 */
export const FINDING_WORDS = Object.freeze({
  found: { words: (/** @type {number} */ n) => `${n} found`, tone: "red" },
  confirmed: { words: (/** @type {number} */ n) => `${n} confirmed`, tone: "green" },
  plausible: { words: (/** @type {number} */ n, more = false) => `${n} ${more ? "more " : ""}unsure`, tone: "orange" },
  uncovered: { words: (/** @type {number} */ n) => `${n} ${n === 1 ? "area" : "areas"} not covered`, tone: "gray" },
  dismissed: { words: (/** @type {number} */ n) => `${n} dismissed`, tone: "gray" },
});
const KINDS = /** @type {FindingKind[]} */ (Object.keys(FINDING_WORDS));

/**
 * A result's chips: each kind it has, counted — "7 found", "3 more unsure", "1 area not covered".
 * @param {{ counts: Partial<Record<FindingKind, number>> } | null | undefined} f
 * @returns {{ kind: FindingKind, words: string, tone: string }[]}
 */
export function findingChips(f) {
  if (!f) return [];
  const sure = (Number(f.counts?.found) || 0) + (Number(f.counts?.confirmed) || 0) > 0;
  return KINDS.filter((k) => (Number(f.counts?.[k]) || 0) > 0).map((k) => ({ kind: k, words: FINDING_WORDS[k].words(Number(f.counts[k]), sure), tone: FINDING_WORDS[k].tone }));
}

/**
 * A finding's confidence mark (the plan's p6): "×2" beside one that two or more Hunters reported, with its title in
 * words — null for one that one Hunter did. @param {Finding} x @returns {{ text: string, title: string } | null}
 */
export const foundByMark = (x) => (Number(x.foundBy) > 1 ? { text: `×${Number(x.foundBy)}`, title: `Found by ${Number(x.foundBy)} Hunters on their own` } : null);

/**
 * What a card's top few leave out, in a line: "+ 4 more found · 3 unsure"; "" where they show all.
 * @param {{ counts: Partial<Record<FindingKind, number>>, top: Finding[] } | null | undefined} f
 */
export function moreWords(f) {
  if (!f) return "";
  const parts = KINDS.map((k) => {
    const left = (Number(f.counts?.[k]) || 0) - f.top.filter((x) => x.kind === k).length;
    if (left <= 0) return "";
    return k === "found" || k === "confirmed" ? `${left} more ${k}` : FINDING_WORDS[k].words(left);
  }).filter(Boolean);
  return parts.length ? `+ ${parts.join(" · ")}` : "";
}

/** What the server leads a refused send's reason with (app/teams-beside.js `send`): the page says whom it missed itself. */
const REFUSED_LEAD = "the result could not reach the main agent: ";

/**
 * A result its switch — Hand its result to your agent — was to send on when the team ended, and that did not go (the
 * row's `missed`, the server's reason): what was tried, and why it did not go. "" where none was missed, where it went
 * since, and where BugHunters checks it.
 * @param {BesideRow} r
 */
export function missedWords(r) {
  const said = String(r.missed || "").trim();
  if (!said || notifiedWords(r) || r.verifiedBy) return "";
  const why = said.startsWith(REFUSED_LEAD) ? said.slice(REFUSED_LEAD.length).trim() : said;
  return `Filament tried to hand it to your agent when the team ended and could not${why ? ` (${why})` : ""}`;
}

/**
 * Where a result stands with your agent, at a result card's foot: where it went, BugHunters on it, or "your agent has
 * not seen it" — after what was tried and why it did not go, where its switch could not hand it on (`missedWords`), and
 * before that Send to your agent… still sends it, where that stands beside these words (`send`).
 * @param {BesideRow} r @param {{ send?: boolean }} [o]  `send`: whether Send to your agent… is offered beside them
 */
export function seenWords(r, { send = cardActions(r).notify } = {}) {
  if (notifiedWords(r)) return notifiedWords(r);
  if (r.verifiedBy) return "BugHunters checks it first";
  const missed = missedWords(r);
  if (!missed) return "your agent has not seen it";
  return `${missed}: your agent has not seen it${send ? " — Send to your agent… still sends it" : ""}`;
}

/**
 * Whether an ended team folds to a row on the Agents tab (team_v2_plan §10 O2, O3): its result went to your agent or
 * BugHunters checks it. One whose result waits for you keeps its card, and so does one that stopped before it finished —
 * Resume… is on its card (U13 W3).
 * @param {BesideRow} r
 */
export const foldsToRow = (r) => r.state === "done" && (!!r.notified || !!r.verifiedBy);

/** How many tokens words take, roughly, for an attachment's size: "≈3k tokens". @param {string} text */
export const tokenWords = (text) => `${tokWords(fmt.tokens(String(text || "").length))} tokens`;

/**
 * A team's result as the message box's attachment (team_v2_plan §10 O3, Send to your agent…): its card in the box —
 * "BugHunters' result · 7 found, 3 plausible" — and, when the person's Send sends the box, the words your agent gets,
 * ahead of the person's own. `main`: the chat whose box holds it.
 * @param {TeamResult} res @param {string} main
 */
export function resultAttachment(res, main) {
  const chips = findingChips(res.findings).filter((c) => c.kind !== "uncovered" && c.kind !== "dismissed").map((c) => c.words);
  return {
    kind: /** @type {const} */ ("team"),
    name: `${possessive(res.team.name)} result`,
    line: chips.join(", "),
    size: res.message.length,
    text: res.message,
    team: { id: res.id, n: res.n, main, key: res.team.key },
  };
}

/** What a Resume… fills a team's composer with: Send starts it. */
export const RESUME_WORDS = "Go on from where you stopped.";

/**
 * The open chat's teams beside, followed: read when the chat changes, when the feed says one of them moved, and on a
 * slow timer while one works.
 * @param {{ call?: typeof api, later?: (fn: () => void, ms: number) => any, clear?: (t: any) => void }} [o]
 */
export function createBesideStore(o = {}) {
  const call = o.call || api;
  const later = o.later || ((fn, ms) => setTimeout(fn, ms));
  const clear = o.clear || ((t) => clearTimeout(t));
  let chainId = "";
  /** The chat the open one runs beside, where it is a team's own; else null. @type {string | null} */
  let main = null;
  /** @type {BesideRow[]} */
  let rows = [];
  /** The open chat's own row, where it is a team's own: its Teams tab shows it as its main chat's does. @type {BesideRow | null} */
  let self = null;
  let seq = 0;
  /** @type {any} */
  let resync = null;
  /** @type {any} */
  let settle = null;
  /** Every team chat the page has heard of, by id: its name and its main chat's id — Now's rows name them so. @type {Map<string, { name: string, main: string }>} */
  const known = new Map();
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
      const r = await call(`/sessions/${encodeURIComponent(at)}/beside`);
      if (mine !== seq) return;
      rows = Array.isArray(r?.teams) ? r.teams : [];
      main = r?.main ? String(r.main) : null;
      self = main && r?.self?.id === at ? r.self : null;
      for (const x of rows) known.set(x.id, { name: x.team.name, main: at });
      if (self && main) known.set(self.id, { name: self.team.name, main });
      emit();
    } catch {
      // Unreachable for now: the cards stay as last seen, and the next event or resync reads again.
    }
    if (mine !== seq) return;
    if (resync) clear(resync);
    resync = rows.some((x) => x.state === "working") || self?.state === "working" ? later(load, RESYNC_MS) : null;
  }

  return {
    chainId: () => chainId,
    /** The chat the open one runs beside, where it is a team's own; else null. */
    main: () => main,
    /** @returns {BesideRow[]} */
    rows: () => rows,
    /** The open chat's own row, where it is a team's own; else null. @returns {BesideRow | null} */
    self: () => self,
    /** @param {string} id */
    row: (id) => rows.find((x) => x.id === id) || null,
    /** A team chat the page heard of: its team's name and its main chat. @param {string} id */
    knownChat: (id) => known.get(String(id)) || null,
    /** The open chat changed: its list is read. @param {string | null} id */
    setChain(id) {
      const next = String(id || "");
      if (next === chainId) return;
      chainId = next;
      rows = [];
      main = null;
      self = null;
      seq += 1;
      emit();
      void load();
    },
    refresh: load,
    /** A row the server answered with a write: it stands in the list at once. @param {BesideRow | null | undefined} row */
    put(row) {
      // The open chat's own row, where it is a team's own: a press on its board or card.
      if (row && row.id === chainId && main && row.main === main) {
        self = row;
        emit();
        return;
      }
      if (!row || row.main !== chainId) return;
      const i = rows.findIndex((x) => x.id === row.id);
      rows = i < 0 ? [row, ...rows] : rows.map((x, j) => (j === i ? row : x));
      known.set(row.id, { name: row.team.name, main: chainId });
      emit();
    },
    /** The feed said a team beside moved: its main chat's list is read, once for a burst. @param {any} msg */
    heard(msg) {
      if (msg?.type !== "beside" || (String(msg.main || "") !== chainId && !(main && String(msg.main || "") === main)) || settle) return;
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
  };
}

/** @typedef {ReturnType<typeof createBesideStore>} BesideStore */

/** The routes a team beside's press goes through. @param {string} chainId @param {typeof api} [call] */
export const besideRoutes = (chainId, call = api) => {
  const base = `/sessions/${encodeURIComponent(chainId)}/beside`;
  return {
    /**
     * `total`: how many workers its lead launches in all this run; `range`: what a bug hunt hunts in, in words (the
     * plan's p6).
     * @param {{ team: string, ask: string, model?: string | null, workers?: string | null, most?: number | null, total?: number | null, range?: string, effort?: string | null, workersEffort?: string | null, verify?: boolean, notify?: boolean, of?: string | null }} body
     */
    fire: (body) => call(base, { method: "POST", body }),
    /**
     * What a team's lead would read of the chat, for the Brief (team_v2_plan §10 O1); `whole`: the record itself too.
     * @param {string} team @param {string} model @param {boolean} [whole]
     */
    reads: (team, model, whole = false) => call(`${base}/reads?${new URLSearchParams({ team, ...(model ? { model } : {}), ...(whole ? { whole: "1" } : {}) })}`),
    /**
     * What a team would run on now, for its fire card. @param {string} team
     * @param {{ model?: string, workers?: string }} [pick] @returns {Promise<BesideOn>}
     */
    runsOn: (team, pick = {}) =>
      call(`${base}/runs-on?${new URLSearchParams({ team, ...(pick.model ? { model: pick.model } : {}), ...(pick.workers ? { workers: pick.workers } : {}) })}`),
    /**
     * Where a team's lead is now, for its board (team_v2_plan §10 O2). @param {string} id
     * @returns {Promise<LeadNow>}
     */
    lead: (id) => call(`${base}/${encodeURIComponent(id)}/lead`),
    /** @param {string} id @param {{ verify?: boolean, notify?: boolean }} body */
    set: (id, body) => call(`${base}/${encodeURIComponent(id)}`, { method: "PATCH", body }),
    /** @param {string} id */
    notify: (id) => call(`${base}/${encodeURIComponent(id)}/notify`, { method: "POST", body: {} }),
    /** @param {string} id */
    verifyAsk: (id) => call(`${base}/${encodeURIComponent(id)}/verify`),
    /** A team's result whole (§10 O3): Open beside's, and Send to your agent…'s words. @param {string} id @returns {Promise<TeamResult>} */
    result: (id) => call(`${base}/${encodeURIComponent(id)}/result`),
    /**
     * Its result went from the box (§10 O3): its card says so. @param {string} id
     * @param {{ n: number, how: "steered" | "sent" }} body
     */
    sent: (id, body) => call(`${base}/${encodeURIComponent(id)}/sent`, { method: "POST", body }),
    /** @param {string} id */
    stop: (id) => call(`${base}/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} }),
    /** Its chat deleted, from the Agents tab (the owner's ask of 10-23). @param {string} id */
    remove: (id) => call(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  };
};
