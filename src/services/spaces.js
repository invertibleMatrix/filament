// @ts-check
// A project's Space on disk (proposal_ux §4.14, U5 phase 8 v1 to v3): one JSON file per project in Filament's data
// folder, `spaces/<project>.json`, read once and kept in memory. Each change is written whole — a temporary file, then
// a rename — before the store takes it, so a write the disk refuses changes nothing; then it is said on the events
// bus's `space` topic, which an open Space follows. The person writes through the admin routes, the agents through
// their `space` tool (app/agent/space.js), a sync through the sync runner (app/space-sync.js), and Filament's own lines
// on what a chat finished and what the lanes did through the news on a turn's end (app/space-news.js, SG-D4). When a
// week turns, the first read of a Space that was used in it has the Record keeper write its line for that week (v3) —
// Filament's own arithmetic, no model.
// A project has a Space once the person makes one (the owner's of 10-29: "by default there is no space and one can right
// click to make one and similarly one can right click and delete one"): its file is the Space. The Spaces of before were
// every project's, made by the first write; the first start of this Filament sets each project's aside, its file renamed
// whole, and making that project's Space brings its board's tasks back — only those (the owner: the tasks were the part
// that worked). Deleting one renames its file too, and Bring back has it as it was for 30 days; then it goes for good.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FILE_KINDS, SPACE_FILES, SPACE_FILE_ID, spaceFileName, OWN_LIMITS, ownName, ASK_WHATS, AUTHOR_KINDS, CHECKING_MAX, DRAFT_LIMITS, FEED_LIMITS, NEEDS_DONE_SHOWN_MS, NEED_KINDS, SPACE_LIMITS, askKey, askNow, askPress, askTitle, emptySpace, entryText, fedKey, isColumn, needsShown, noteFinished, openTasks, rankTasks, spaceable, taskFields, taskOrder, weekStart, weekWords, routineWhy, UNTITLED_CHAT, askPressParts, askTitleParts, namedText } from "../core/space.js";
import { FAILS_TO_STOP, watchKeyOf } from "../core/dashboard-sources.js";
import { HELD_GUIDE_WHY, ROUTINE_LIMITS, UNAPPROVED_WHY, actWords, momentWords as clockAt, heldGuideWords, routineClash, scheduleOf, tookWords, unapprovedWords, whenWords } from "../core/routines.js";
import { CONNECTION_ITEMS, GUIDE_CHARS, GUIDE_LIMITS, GUIDE_STATES, TRIGGER_ROWS, WAKES, WATCH_LIMITS, WATCH_WAKES_HOUR, eventIn, heardOf, seenFields, toldWords, triggerChat, triggerEvery, triggerFields, triggerParts, wakesWords, wokeWith } from "../core/watchers.js";
import { PULL_LIMITS, movedKept, movedWords, pullFault, pullKept } from "../core/space-pulls.js";
import { ASKS_WORDS, SPACE_EFFORTS, runsOnOf, settingsChange, settingsIn } from "../core/space-settings.js";
import { unnoticed } from "../core/notices.js";
import { STORE_FILES, readStoreFile, setAsideIn } from "./store-files.js";

/** The file of Settings › Space, every Space's defaults (the owner's of 11-04), beside the Spaces: its name is no project's. */
const DEFAULTS_FILE = "_space-settings.json";

/** How far ahead Not now may put a row of Needs you: Monday 09:00 from a Sunday morning, and a day to spare. */
export const LATER_MAX_MS = 8 * 86_400_000;

/** How long a deleted Space may be brought back (the Designer's, 10-29: Undo, and Bring back for 30 days). */
export const SPACE_BACK_MS = 30 * 86_400_000;
/** How often Filament's own store removes, while it runs, the deleted Spaces whose 30 days are over. */
export const SPACE_PRUNE_EVERY_MS = 6 * 3_600_000;
/** What a Space of before is renamed to, set aside whole (`<project>.json.before-apps`); once its tasks came back, `-brought`. */
export const SET_ASIDE = ".before-apps";
/** The mark that the Spaces of before were set aside, so a Space made since never is. */
const SET_ASIDE_MARK = "_set-aside.json";
/** A deleted Space's file: `<project>.json.deleted-<ms>`. */
const DELETED = /^(.+)\.json\.deleted-(\d+)$/;
/** What a write to a project with no Space is refused with: only the person makes one, by need or from the menu (11-12). */
export const NO_SPACE = "This project has no Space: the person makes one by adding something on the project's page, or from the project's menu (right-click it in the bar).";
/**
 * What a write to a project whose deleted Space waits for Bring back is refused with: nothing added makes another until
 * it is brought back or made anew (http/admin/spaces.js `DELETED_WAITS`, the person's), so the by-need sentence would
 * be untrue there (11-12).
 */
export const SPACE_DELETED = "This project's Space was deleted: the person brings it back, or makes a new one, on the project's page or from its menu (right-click it in the bar).";

/** @typedef {import("../core/space.js").SpaceDoc} SpaceDoc @typedef {import("../core/space.js").SpaceTask} SpaceTask */
/** @typedef {import("../core/space.js").SpaceAuthor} SpaceAuthor @typedef {import("../core/space.js").SpaceEntry} SpaceEntry */
/** @typedef {import("../core/space.js").SpaceSync} SpaceSync @typedef {import("../core/space.js").SyncLane} SyncLane */
/** @typedef {import("../core/space.js").SeenPlace} SeenPlace */

/** A refusal with its HTTP status, which the routes answer in its words. @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });

/** The fields of a routine its chat proposes or changes (core/routines.js `routineFields`). */
const ROUTINE_FIELDS = /** @type {const} */ (["title", "when", "task", "writes", "acts", "trigger", "wakes", "guides"]);

/** @param {any} v @returns {v is Record<string, any>} */
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
/** Words another machine sent, as one line: each run of white space one space, NEL (U+0085) too, which `\s` leaves. @param {unknown} v */
const oneLine = (v) => String(v ?? "").replace(/[\s\u0085]+/g, " ").trim();
/** @param {any} by @returns {SpaceAuthor} */
const authorOf = (by) => ({
  kind: AUTHOR_KINDS.includes(by?.kind) ? by.kind : "you",
  ...(by?.chain ? { chain: String(by.chain) } : {}),
  ...(by?.name ? { name: String(by.name) } : {}),
  // Another machine's line keeps who wrote it there (sp-cross).
  ...(by?.kind === "machine" && by?.who ? { who: String(by.who) } : {}),
});

/** Where another machine's line came from, as a file holds it; undefined where it does not read as such. @param {any} f */
const fromIn = (f) => (isObj(f) && typeof f.machine === "string" && f.machine && typeof f.project === "string" && f.project && typeof f.id === "string" && f.id ? { machine: f.machine, project: f.project, id: f.id } : undefined);

/**
 * Who paused a thing, as a file holds it (HarnessV4_AgentsSpace_Plan SA-D3): the chat whose agent did, its name, its
 * line; undefined where it does not read as one — the person paused it then.
 * @param {any} b @returns {{ chain: string, byName: string, line: string } | undefined}
 */
const pausedByIn = (b) => (isObj(b) && typeof b.chain === "string" && b.chain && typeof b.line === "string" ? { chain: b.chain, byName: String(b.byName ?? ""), line: b.line } : undefined);

/**
 * What the line by Sync says, as a file holds it (core/space.js `SyncTold`); undefined where it does not read as one —
 * the line is read as its words alone then.
 * @param {any} t @returns {import("../core/space.js").SyncTold | undefined}
 */
const toldIn = (t) =>
  isObj(t) && Array.isArray(t.chains) && t.chains.every((c) => typeof c === "string") && Array.isArray(t.asks) && t.asks.every((a) => isObj(a) && typeof a.chain === "string")
    ? { chains: t.chains.map(String), asks: t.asks.map((a) => ({ chain: String(a.chain), byName: String(a.byName ?? ""), words: String(a.words ?? "") })), also: String(t.also ?? "") }
    : undefined;

/**
 * A line's parts, as a file holds them (core/space.js `NamedWords`); undefined where they do not read as such — the
 * line is read as its words alone then.
 * @param {any} t @returns {import("../core/space.js").NamedWords | undefined}
 */
const namedIn = (t) =>
  Array.isArray(t) && t.length && t.every((p) => typeof p === "string" || (isObj(p) && typeof p.chain === "string" && p.chain && typeof p.name === "string"))
    ? t.map((p) => (typeof p === "string" ? p : { chain: String(p.chain), name: String(p.name) }))
    : undefined;

/**
 * A task's files as a file holds them (core/space.js `SpaceFile`), each kept only where it reads as one.
 * @param {any} files @returns {import("../core/space.js").SpaceFile[]}
 */
const filesIn = (files) =>
  (Array.isArray(files) ? files : [])
    .filter((f) => isObj(f) && SPACE_FILE_ID.test(String(f.id)) && FILE_KINDS.includes(f.kind) && Number(f.bytes) >= 0)
    .map((f) => ({ id: String(f.id), name: spaceFileName(f.name), kind: f.kind, type: String(f.type || ""), bytes: Number(f.bytes) || 0, at: Number(f.at) || 0 }));

/**
 * A Space as its file holds it, each part kept only where it reads: a file edited by hand, or written by an older
 * Filament, loses the rows that do not, never the rest.
 * @param {any} raw @returns {SpaceDoc}
 */
function shaped(raw) {
  const doc = emptySpace();
  doc.seq = Number.isInteger(raw.seq) && raw.seq >= 0 ? raw.seq : 0;
  doc.keptWeek = Number(raw.keptWeek) || 0;
  for (const t of Array.isArray(raw.tasks) ? raw.tasks : []) {
    if (!isObj(t) || !t.id || !t.title || !isColumn(t.column)) continue;
    const at = Number(t.at) || 0;
    doc.tasks.push({
      id: String(t.id),
      title: String(t.title),
      line: String(t.line ?? ""),
      column: t.column,
      parked: t.parked === true,
      chain: t.chain ? String(t.chain) : null,
      place: t.place ? String(t.place) : null,
      by: authorOf(t.by),
      at,
      movedAt: Number(t.movedAt) || at,
      startedAt: t.startedAt == null ? null : Number(t.startedAt) || null,
      doneAt: t.doneAt == null ? null : Number(t.doneAt) || null,
      ...(filesIn(t.files).length ? { files: filesIn(t.files) } : {}),
      ...(typeof t.rank === "number" && Number.isFinite(t.rank) ? { rank: t.rank } : {}),
    });
  }
  for (const e of Array.isArray(raw.log) ? raw.log : [])
    if (isObj(e) && e.id && e.text)
      doc.log.push({
        id: String(e.id),
        at: Number(e.at) || 0,
        by: authorOf(e.by),
        text: String(e.text),
        task: e.task ? String(e.task) : null,
        ...(e.key
          ? {
              key: String(e.key),
              since: Number(e.since) || Number(e.at) || 0,
              turns: Math.max(1, Number(e.turns) || 1),
              ...(Number.isInteger(e.failedTurn) ? { failedTurn: e.failedTurn } : {}),
              ...(typeof e.place === "string" ? { place: e.place } : {}),
              ...(typeof e.facts === "string" ? { facts: e.facts } : {}),
            }
          : {}),
        ...(toldIn(e.told) ? { told: toldIn(e.told) } : {}),
        ...(namedIn(e.named) ? { named: namedIn(e.named) } : {}),
        ...(fromIn(e.from) ? { from: fromIn(e.from) } : {}),
        ...(e.onlyHere === true ? { onlyHere: true } : {}),
      });
  for (const s of Array.isArray(raw.syncs) ? raw.syncs : [])
    if (isObj(s) && s.id && Array.isArray(s.lanes))
      doc.syncs.push({
        id: String(s.id),
        at: Number(s.at) || 0,
        also: String(s.also ?? ""),
        lanes: s.lanes
          .filter((/** @type {any} */ l) => isObj(l) && l.chain)
          .map((/** @type {any} */ l) => ({
            chain: String(l.chain),
            when: l.when === "after" ? "after" : "now",
            state: ["waiting", "sent", "steered", "refused"].includes(l.state) ? l.state : "refused",
            ...(l.error ? { error: String(l.error) } : {}),
            ...(l.at ? { at: Number(l.at) } : {}),
          })),
      });
  if (isObj(raw.seen)) {
    /** @type {Record<string, SeenPlace>} */
    const seen = {};
    for (const [k, v] of Object.entries(raw.seen).slice(0, SPACE_LIMITS.places))
      if (isObj(v))
        seen[k] = { branch: v.branch ? String(v.branch) : null, base: v.base ? String(v.base) : null, ahead: Number.isInteger(v.ahead) ? v.ahead : null, main: v.main === true };
    doc.seen = seen;
  }
  /** @param {any} g */
  const grantIn = (g) => (isObj(g) && isObj(g.sources) && Array.isArray(g.watch) ? /** @type {import("../core/dashboard-sources.js").Grant} */ (g) : null);
  /** @param {any} s */
  const seenIn = (s) => (isObj(s) ? Object.fromEntries(Object.entries(s).filter(([, x]) => isObj(x))) : {});
  /**
   * The scripts' bytes a Keep pinned, a sha256 by each one's path — `{}` where it found none —, or undefined where it
   * pinned none at all: an earlier Filament kept it. A hash that does not read is left out, so its script waits for a Keep.
   * @param {any} s @returns {Record<string, string> | undefined}
   */
  const scriptsIn = (s) => (isObj(s) ? Object.fromEntries(Object.entries(s).filter(([p, h]) => p && typeof h === "string" && /^[0-9a-f]{64}$/.test(h))) : undefined);
  /** Who paused a kept one, an agent with its line (HarnessV4_AgentsSpace_Plan SA-D3), or null. @param {any} b */
  for (const d of Array.isArray(raw.dashboards) ? raw.dashboards : [])
    if (isObj(d) && typeof d.name === "string" && (d.state === "kept" || d.state === "removed") && !doc.dashboards.some((x) => x.name === d.name)) {
      const was = d.state === "removed" && isObj(d.was) && Number.isInteger(d.was.v) && d.was.v > 0 && grantIn(d.was.grant) ? d.was : null;
      const scripts = d.state === "kept" ? scriptsIn(d.scripts) : undefined;
      const wasScripts = was ? scriptsIn(was.scripts) : undefined;
      doc.dashboards.push({
        name: d.name,
        state: d.state,
        v: Number.isInteger(d.v) && d.v > 0 ? d.v : 0,
        grant: grantIn(d.grant),
        // What its Keep pinned holds across a restart: read back without it, every script read as changed since.
        ...(scripts ? { scripts } : {}),
        at: Number(d.at) || 0,
        paused: d.paused === true,
        seen: seenIn(d.seen),
        ...(d.state === "kept" && d.glance === true ? { glance: true } : {}),
        ...(d.state === "kept" && d.paused === true && pausedByIn(d.pausedBy) ? { pausedBy: pausedByIn(d.pausedBy) } : {}),
        ...(d.state === "kept" && Array.isArray(d.allowed) && d.allowed.some((x) => typeof x === "string") ? { allowed: d.allowed.filter((/** @type {unknown} */ x) => typeof x === "string") } : {}),
        ...(d.state === "removed"
          ? { was: was ? { v: was.v, grant: /** @type {import("../core/dashboard-sources.js").Grant} */ (grantIn(was.grant)), ...(wasScripts ? { scripts: wasScripts } : {}), at: Number(was.at) || 0, paused: was.paused === true, seen: seenIn(was.seen), ...(was.glance === true ? { glance: true } : {}), ...(was.paused === true && pausedByIn(was.pausedBy) ? { pausedBy: pausedByIn(was.pausedBy) } : {}) } : null }
          : {}),
      });
    }
  // A kept dashboard needs what its Keep granted: one without it is a draft again.
  doc.dashboards = doc.dashboards.filter((d) => d.state === "removed" || (d.v > 0 && d.grant));
  for (const n of Array.isArray(raw.needs) ? raw.needs : []) {
    if (!isObj(n) || !n.id || !n.text || !NEED_KINDS.includes(n.kind) || typeof n.dashboard !== "string") continue;
    // A draft keeps only what reads as one: its connection, tool, args, words and the chat that wrote it (S5c).
    const draft = n.kind === "draft" ? draftIn(n.draft) : null;
    if (n.kind === "draft" && !draft) continue;
    // A check's row keeps what the button ran and said, and why the agent said no (S5d).
    const check = n.kind === "check" && isObj(n.check) ? { label: String(n.check.label ?? ""), ran: String(n.check.ran ?? ""), said: String(n.check.said ?? ""), reason: String(n.check.reason ?? "") } : null;
    if (n.kind === "check" && !check) continue;
    // A routine's row names the routine and its run's chat (S6).
    const started = isObj(n.routine?.startedBy) && typeof n.routine.startedBy.chain === "string" && typeof n.routine.clock === "string" ? { startedBy: { chain: n.routine.startedBy.chain, byName: String(n.routine.startedBy.byName ?? "") }, clock: n.routine.clock } : {};
    // …or, for a watcher that tells only the person, how many events it heard while the row was open (the plan of 11-11).
    const told = Number.isInteger(n.routine?.told) && n.routine.told > 0 ? { told: n.routine.told, ...(typeof n.routine.heard === "string" && n.routine.heard ? { heard: n.routine.heard.slice(0, WATCH_LIMITS.summary) } : {}) } : {};
    // …or a watcher's guidance past its cap, held for the person's Send it (app/watchers/guidance.js); or that Filament
    // switched the watcher off itself (`watchUnapproved`).
    const g = n.routine?.guide;
    const guide = isObj(g) && typeof g.id === "string" && g.id && typeof g.to === "string" && g.to && typeof g.text === "string" && g.text ? { guide: { id: g.id, to: g.to, from: String(g.from ?? ""), name: String(g.name ?? ""), text: g.text.slice(0, GUIDE_CHARS) } } : {};
    const routine = n.kind === "routine" && isObj(n.routine) && typeof n.routine.id === "string" && n.routine.id ? { id: n.routine.id, chain: String(n.routine.chain ?? ""), ...(n.routine.watcher === true ? { watcher: /** @type {const} */ (true) } : {}), ...started, ...told, ...guide, ...(n.routine.unapproved === true ? { unapproved: /** @type {const} */ (true) } : {}) } : null;
    if (n.kind === "routine" && !routine) continue;
    // A repro's row keeps what the agent found, and its chat and folder (S7).
    const repro = n.kind === "repro" ? reproIn(n.repro) : null;
    if (n.kind === "repro" && !repro) continue;
    // An ask keeps what it asks for, who asked and why, and how it ended (E42 SA-D7).
    const ask = n.kind === "ask" ? askIn(n.ask) : null;
    if (n.kind === "ask" && !ask) continue;
    // Another machine's row keeps that machine, its project there and the row there (sp-cross).
    const m = n.machine;
    const machine = n.kind === "machine" && isObj(m) && [m.id, m.project, m.row].every((x) => typeof x === "string" && x)
      ? { id: m.id, name: String(m.name ?? ""), project: m.project, row: m.row, was: String(m.was ?? ""), ...(m.closed === true ? { closed: true, ...(m.gone === true ? { gone: true } : {}) } : m.capped === true ? { capped: true } : {}) }
      : null;
    if (n.kind === "machine" && !machine) continue;
    const state = n.state === "later" && Number(n.until) > 0 ? "later" : n.state === "done" ? "done" : "open";
    doc.needs.push({
      id: String(n.id),
      kind: n.kind,
      text: String(n.text),
      why: String(n.why ?? ""),
      dashboard: n.dashboard,
      title: String(n.title ?? n.dashboard),
      ...(n.watch ? { watch: String(n.watch) } : {}),
      ...(n.source ? { source: String(n.source) } : {}),
      ...(draft ? { draft } : {}),
      ...(check ? { check } : {}),
      ...(routine ? { routine } : {}),
      ...(repro ? { repro } : {}),
      ...(ask ? { ask: state === "done" ? ask : (({ ended: _e, moved: _m, ...open }) => open)(ask) } : {}),
      ...(machine ? { machine } : {}),
      at: Number(n.at) || 0,
      state,
      ...(state === "later" ? { until: Number(n.until) } : {}),
      ...(state === "done" ? { doneAt: Number(n.doneAt) || Number(n.at) || 0 } : {}),
      ...(state === "done" && draft ? { outcome: n.outcome === "sent" ? "sent" : "discarded" } : {}),
      // An agent that closed it (E42 SA-D5): its chat, who, its line.
      ...(state === "done" && isObj(n.doneBy) && typeof n.doneBy.chain === "string" && n.doneBy.chain && typeof n.doneBy.line === "string"
        ? { doneBy: { chain: n.doneBy.chain, byName: String(n.doneBy.byName ?? ""), line: n.doneBy.line } }
        : {}),
    });
  }
  for (const r of Array.isArray(raw.routines) ? raw.routines : []) {
    const kept = routineIn(r);
    if (kept && !doc.routines.some((x) => x.id === kept.id)) doc.routines.push(kept);
  }
  // The checks under way (S5d): a restart says each was cut.
  for (const c of Array.isArray(raw.checking) ? raw.checking.slice(-CHECKING_MAX) : [])
    if (isObj(c) && typeof c.agent === "string" && c.agent && typeof c.label === "string" && !doc.checking.some((x) => x.agent === c.agent))
      doc.checking.push({ agent: c.agent, chain: String(c.chain ?? ""), dashboard: String(c.dashboard ?? ""), title: String(c.title ?? c.dashboard ?? ""), label: c.label, ran: String(c.ran ?? ""), said: String(c.said ?? ""), at: Number(c.at) || 0 });
  // A Space of the person's own (HarnessV4_SpacesPlugins_Plan A1): its name and folder; the projects it shows (A7).
  if (isObj(raw.own) && typeof raw.own.name === "string" && raw.own.name && typeof raw.own.folder === "string" && raw.own.folder) {
    const shows = Array.isArray(raw.own.shows) ? [...new Set(raw.own.shows.filter((p) => typeof p === "string" && spaceable(p)))] : [];
    doc.own = { name: raw.own.name, folder: raw.own.folder, at: Number(raw.own.at) || 0, ...(shows.length ? { shows } : {}) };
  }
  // The services it pulls onto its board (the Space Apps plan of 10-29): each that reads as one, once by its id.
  /** @type {import("../core/space-pulls.js").SpacePull[]} */
  const pulls = [];
  for (const p of Array.isArray(raw.pulls) ? raw.pulls.slice(0, PULL_LIMITS.pulls) : []) {
    const kept = pullKept(p);
    if (kept && !pulls.some((x) => x.id === kept.id)) pulls.push(kept);
  }
  if (pulls.length) doc.pulls = pulls;
  // Its own settings (the owner's of 11-04): the model its agents run on, its effort, what an app's ask does.
  const settings = settingsIn(raw.settings);
  if (Object.keys(settings).length) doc.settings = settings;
  // Where each other machine's feed left off (sp-cross): each cursor that reads as one.
  const fed = isObj(raw.fedFrom) ? Object.entries(raw.fedFrom).filter(([k, c]) => k && isObj(c) && Number.isFinite(c.at) && Number.isFinite(c.n)).slice(-SPACE_LIMITS.fedFrom) : [];
  if (fed.length) doc.fedFrom = Object.fromEntries(fed.map(([k, c]) => [k, { at: Number(c.at), n: Number(c.n) }]));
  // What its watchers wrote the chats they watch, and the turns their runs reviewed (app/watchers/guidance.js).
  const guidance = (Array.isArray(raw.guidance) ? raw.guidance : []).flatMap((g) => guidanceIn(g) || []).slice(-GUIDE_LIMITS.kept);
  if (guidance.length) doc.guidance = guidance;
  const reviews = (Array.isArray(raw.reviews) ? raw.reviews : []).flatMap((v) => reviewIn(v) || []).slice(-GUIDE_LIMITS.reviews);
  if (reviews.length) doc.reviews = reviews;
  return doc;
}

/**
 * A watcher's guidance as its file holds it, or null where it does not read as one: its watcher, the two chats, its
 * words and a state Filament knows. @param {any} g @returns {import("../core/watchers.js").Guidance | null}
 */
function guidanceIn(g) {
  if (!isObj(g) || ![g.id, g.watcher, g.from, g.to, g.text].every((x) => typeof x === "string" && x) || !GUIDE_STATES.includes(g.state)) return null;
  return {
    id: g.id,
    watcher: g.watcher,
    title: String(g.title ?? ""),
    from: g.from,
    to: g.to,
    text: g.text.slice(0, GUIDE_CHARS),
    at: Number(g.at) || 0,
    state: g.state,
    ...(g.how === "note" || g.how === "turn" ? { how: g.how } : {}),
    ...(Number.isInteger(g.turn) && g.turn > 0 ? { turn: g.turn } : {}),
    ...(typeof g.why === "string" && g.why ? { why: g.why.slice(0, SPACE_LIMITS.line) } : {}),
    ...(Number(g.sentAt) > 0 ? { sentAt: Number(g.sentAt) } : {}),
    ...(g.pressed === true ? { pressed: /** @type {true} */ (true) } : {}),
  };
}

/** A reviewed turn as its file holds it, or null. @param {any} v @returns {import("../core/watchers.js").Review | null} */
function reviewIn(v) {
  if (!isObj(v) || typeof v.chain !== "string" || !v.chain || !Number.isInteger(v.turn) || v.turn <= 0 || typeof v.watcher !== "string" || !v.watcher) return null;
  return { chain: v.chain, turn: v.turn, watcher: v.watcher, title: String(v.title ?? ""), at: Number(v.at) || 0, guided: v.guided === true };
}

/**
 * The chats' turns a watcher's run reviews, as its row keeps them while it runs: each a chat and its turn's number,
 * once, the newest. @param {any} turns @returns {{ chain: string, turn: number }[]}
 */
function turnsIn(turns) {
  /** @type {{ chain: string, turn: number }[]} */
  const out = [];
  for (const t of Array.isArray(turns) ? turns : [])
    if (isObj(t) && typeof t.chain === "string" && t.chain && Number.isInteger(t.turn) && t.turn > 0 && !out.some((x) => x.chain === t.chain && x.turn === t.turn)) out.push({ chain: t.chain, turn: t.turn });
  return out.slice(-WATCH_LIMITS.events);
}

/**
 * A repro as its file holds it (S7), or null where it does not read as one: whether it reproduced the report, and the
 * chat that sent it. @param {any} r @returns {import("../core/space.js").Repro | null}
 */
function reproIn(r) {
  if (!isObj(r) || typeof r.reproduced !== "boolean" || typeof r.chain !== "string" || !r.chain) return null;
  const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const s = (/** @type {unknown} */ v) => String(v ?? "");
  return { reproduced: r.reproduced, test: s(r.test), run: s(r.run), said: s(r.said), steps: s(r.steps), tried: list(r.tried), questions: list(r.questions), draft: s(r.draft), chain: r.chain, byName: s(r.byName), cwd: s(r.cwd) };
}

/**
 * An ask as its file holds it (E42 SA-D7), or null where it does not read as one: what it asks for and of what, who
 * asked and why, and how it ended. @param {any} a @returns {import("../core/space.js").Ask | null}
 */
function askIn(a) {
  if (!isObj(a) || !ASK_WHATS.includes(a.what) || typeof a.chain !== "string" || !a.chain || typeof a.why !== "string") return null;
  const ends = ["kept", "switched on", "resumed", "told", "turned down", "taken back", "moved"];
  const chats = Array.isArray(a.chats) ? a.chats.filter((c) => isObj(c) && typeof c.chain === "string" && c.chain).map((c) => ({ chain: c.chain, name: String(c.name ?? "") })) : [];
  if (a.what === "keep" && (typeof a.dashboard !== "string" || !a.dashboard || !(Number(a.v) > 0))) return null;
  if (a.what === "on" && (typeof a.routine !== "string" || !a.routine)) return null;
  if (a.what === "resume" && a.all !== true && !(typeof a.dashboard === "string" && a.dashboard) && !(typeof a.routine === "string" && a.routine)) return null;
  if (a.what === "tell" && !chats.length) return null;
  return {
    what: a.what,
    chain: a.chain,
    byName: String(a.byName ?? ""),
    why: a.why,
    ...(typeof a.dashboard === "string" && a.dashboard ? { dashboard: a.dashboard } : {}),
    ...(a.what === "keep" ? { v: Number(a.v), ...(a.first === true ? { first: true } : {}) } : {}),
    ...(typeof a.routine === "string" && a.routine ? { routine: a.routine } : {}),
    ...(a.all === true ? { all: true } : {}),
    ...(a.what === "tell" ? { chats } : {}),
    ...(ends.includes(a.ended) ? { ended: a.ended } : {}),
    ...(a.ended === "moved" && typeof a.moved === "string" ? { moved: a.moved } : {}),
  };
}

/**
 * A watcher's seen cursor as its file holds it (the plan of 11-11): the moment it listens from, the newest event it
 * heard and the newest ids; then the fields its trigger's kind keeps there and no other's, each read as that kind's row
 * reads it (core/watchers.js `seenFields`) — a turn trigger's count toward its every; a connection's keys, the path of
 * the list they are of, its last ask and its trouble; a commit trigger's trouble, and its head. One on with none
 * listens from the moment it was switched on.
 * @param {any} s @param {number | null} onAt @param {import("../core/watchers.js").Trigger["kind"]} kind  its trigger's
 * @returns {import("../core/watchers.js").Seen | null}
 */
function seenIn(s, onAt, kind) {
  if (isObj(s) && Number(s.from) > 0)
    return {
      from: Number(s.from),
      at: Number(s.at) > 0 ? Number(s.at) : null,
      ids: Array.isArray(s.ids) ? s.ids.filter((x) => typeof x === "string" && x).slice(-WATCH_LIMITS.seenIds) : [],
      ...seenFields(kind, s),
    };
  return onAt ? { from: onAt, at: null, ids: [] } : null;
}

/**
 * The events that wait for a watcher's run, as its file holds them: each that reads as one, the newest kept, and the
 * count of those before them; null where none.
 * @param {any} p @returns {import("../core/watchers.js").Pending | null}
 */
function pendingIn(p) {
  if (!isObj(p) || !Array.isArray(p.events)) return null;
  const events = /** @type {import("../core/watchers.js").WatchEvent[]} */ (p.events.map(eventIn).filter(Boolean)).slice(-WATCH_LIMITS.events);
  return events.length ? { events, more: Number.isInteger(p.more) && p.more > 0 ? p.more : 0 } : null;
}

/**
 * What a watcher's Switch on approved by content, as its file holds it (a routine's `script`): each file's hash by its
 * path, and when; null where it does not read as one.
 * @param {any} x @returns {{ pins: Record<string, string>, at: number } | null}
 */
function approvedIn(x) {
  if (!isObj(x) || !isObj(x.pins) || !(Number(x.at) > 0)) return null;
  return { pins: Object.fromEntries(Object.entries(x.pins).filter(([p, h]) => p && typeof h === "string" && /^[0-9a-f]{64}$/.test(h))), at: Number(x.at) };
}

/**
 * A routine as its file holds it (S6), or null where it does not read as one. One on with no moment it was switched on
 * is proposed again: what runs by itself is what the person switched on (S6-D3). A watcher's trigger is read as core
 * checks one: one that no longer reads makes no routine, never one woken by what nobody switched on. What its Switch
 * on approved by content (`script`) is kept for a watcher that was switched on: a proposed one holds none, whatever
 * its file says.
 * @param {any} r @returns {import("../core/routines.js").Routine | null}
 */
function routineIn(r) {
  if (!isObj(r) || typeof r.id !== "string" || !r.id || typeof r.title !== "string" || !r.title || typeof r.when !== "string") return null;
  if (typeof r.task !== "string" || typeof r.madeIn !== "string" || !["proposed", "on", "removed"].includes(r.state)) return null;
  const trigger = r.trigger === undefined ? null : triggerFields(r.trigger);
  if (trigger && !trigger.ok) return null;
  /** @param {any} x @returns {import("../core/routines.js").RoutineRun | null} */
  const runIn = (x) =>
    isObj(x) && typeof x.chain === "string" && ["running", "done", "failed", "stopped"].includes(x.state) && Number(x.at) > 0
      ? {
          at: Number(x.at),
          chain: x.chain,
          by: x.by === "you" ? "you" : x.by === "event" ? "event" : x.by === "agent" && isObj(x.startedBy) && typeof x.startedBy.chain === "string" ? "agent" : "time",
          ...(x.by === "agent" && isObj(x.startedBy) && typeof x.startedBy.chain === "string" ? { startedBy: { chain: x.startedBy.chain, byName: String(x.startedBy.byName ?? "") } } : {}),
          state: x.state,
          ...(Number(x.ended) > 0 ? { ended: Number(x.ended) } : {}),
          ...(typeof x.said === "string" && x.said ? { said: x.said } : {}),
          ...(typeof x.why === "string" && x.why ? { why: x.why } : {}),
          // The model it ran on, and why that was its Space's (the owner's of 11-04).
          ...(typeof x.on === "string" && x.on ? { on: x.on.slice(0, 240) } : {}),
          ...(typeof x.instead === "string" && x.instead ? { instead: x.instead.slice(0, SPACE_LIMITS.text) } : {}),
          // A watcher's run: how many events woke it; under way in the chat it wakes, its turn's number there, and
          // whether it carried an event of a chat whose words were its own alone.
          ...(Number.isInteger(x.events) && x.events > 0 ? { events: x.events } : {}),
          ...(x.state === "running" && Number.isInteger(x.turn) && x.turn > 0 ? { turn: x.turn } : {}),
          ...(x.state === "running" && x.quiet === true ? { quiet: true } : {}),
          // …and the turns its events were of, which its end keeps as reviews.
          ...(x.state === "running" && turnsIn(x.turns).length ? { turns: turnsIn(x.turns) } : {}),
        }
      : null;
  const onAt = Number(r.onAt) > 0 ? Number(r.onAt) : null;
  const state = r.state === "on" && !onAt ? "proposed" : r.state;
  return {
    id: r.id,
    title: r.title,
    when: trigger ? "" : r.when,
    task: r.task,
    writes: r.writes === true,
    ...(Array.isArray(r.acts) && r.acts.some((a) => typeof a === "string") ? { acts: r.acts.filter((a) => typeof a === "string").slice(0, ROUTINE_LIMITS.acts) } : {}),
    ...(trigger?.ok
      ? { trigger: trigger.trigger, wakes: WAKES.includes(r.wakes) ? r.wakes : "new", seen: state === "proposed" ? null : seenIn(r.seen, onAt, trigger.trigger.kind), pending: pendingIn(r.pending) }
      : {}),
    // It may guide the chat its trigger names: said of no other — one that tells only the person, or names no chat.
    ...(trigger?.ok && r.guides === true && r.wakes !== "you" && triggerChat(trigger.trigger) ? { guides: true } : {}),
    ...(trigger?.ok && onAt && state !== "proposed" && approvedIn(r.script) ? { script: /** @type {{ pins: Record<string, string>, at: number }} */ (approvedIn(r.script)) } : {}),
    state,
    ...(state === "removed" ? { was: r.was === "on" && onAt ? "on" : "proposed" } : {}),
    paused: r.paused === true,
    ...(r.paused === true && pausedByIn(r.pausedBy) ? { pausedBy: pausedByIn(r.pausedBy) } : {}),
    ...(r.paused === true && typeof r.pausedWhy === "string" && r.pausedWhy ? { pausedWhy: r.pausedWhy.slice(0, SPACE_LIMITS.text) } : {}),
    madeIn: r.madeIn,
    madeBy: String(r.madeBy ?? ""),
    model: String(r.model ?? ""),
    ...(r.modelBy === "you" ? { modelBy: /** @type {"you"} */ ("you") } : {}),
    ...(r.model && typeof r.effort === "string" && SPACE_EFFORTS.includes(r.effort) ? { effort: r.effort } : {}),
    at: Number(r.at) || 0,
    onAt,
    upTo: Number(r.upTo) > 0 ? Number(r.upTo) : null,
    last: runIn(r.last),
    skipped: isObj(r.skipped) && Number(r.skipped.at) > 0 ? { at: Number(r.skipped.at), why: String(r.skipped.why ?? ""), ...(r.skipped.missed === true ? { missed: true } : {}) } : null,
    // A watcher's wake-ups of the last hour, for its cap.
    ...(trigger?.ok && Array.isArray(r.woke) && r.woke.some((t) => Number(t) > 0) ? { woke: r.woke.map(Number).filter((t) => t > 0).sort((a, b) => a - b).slice(-WATCH_WAKES_HOUR) } : {}),
  };
}

/**
 * A draft as its file holds it (S5c), or null where it does not read as one.
 * @param {any} d @returns {import("../core/space.js").Draft | null}
 */
function draftIn(d) {
  if (!isObj(d) || typeof d.connection !== "string" || !d.connection || typeof d.tool !== "string" || !d.tool) return null;
  if (!isObj(d.args) || typeof d.words !== "string" || typeof d.chain !== "string") return null;
  return {
    connection: d.connection,
    tool: d.tool,
    args: d.args,
    words: d.words,
    to: String(d.to ?? ""),
    answers: isObj(d.answers) ? { who: String(d.answers.who ?? ""), words: String(d.answers.words ?? "") } : null,
    from: Array.isArray(d.from) ? d.from.filter((/** @type {unknown} */ x) => typeof x === "string") : [],
    chain: d.chain,
    byName: String(d.byName ?? ""),
    account: String(d.account ?? ""),
    ...(isObj(d.sent) ? { sent: { as: String(d.sent.as ?? ""), link: typeof d.sent.link === "string" ? d.sent.link : null } } : {}),
  };
}

/**
 * What a kept dashboard runs, in words: "it runs 2 commands and 1 watch by itself, and 2 buttons when you press them";
 * one that reads a connection's tool says so (S4a): "it runs 1 command, calls 1 tool and keeps 1 watch by itself".
 * @param {import("../core/dashboard-sources.js").Grant} grant
 */
function runsWords(grant) {
  const all = Object.values(grant.sources);
  const tools = all.filter((s) => "tool" in s).length;
  const runs = all.length - tools;
  const watches = grant.watch.length;
  const buttons = Object.keys(grant.actions).length;
  /** @param {number} k @param {string} one @param {string} many */
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const pressed = buttons ? `, and ${n(buttons, "button", "buttons")} when you press ${buttons === 1 ? "it" : "them"}` : "";
  if (!tools) return `it runs ${n(runs, "command", "commands")}${watches ? ` and ${n(watches, "watch", "watches")}` : ""} by itself${pressed}`;
  const parts = [runs ? `runs ${n(runs, "command", "commands")}` : "", `calls ${n(tools, "tool", "tools")}`, watches ? `keeps ${n(watches, "watch", "watches")}` : ""].filter(Boolean);
  return `it ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]} by itself${pressed}`;
}

/**
 * What a Space keeps of each part once it outgrows its limit: the newest log lines and syncs — this machine's own and
 * those another machine fed each to its own limit —; of the tasks, every open one before the oldest done ones go; of
 * Needs you, the newest open rows, the oldest put to Done today.
 * @param {SpaceDoc} doc @param {number} at  the change's moment
 */
function trimmed(doc, at) {
  // Needs you: past its open rows' limit the oldest go to Done today — done now, so Done today shows them and Bring back
  // is there (found by the Hunter on S2: done when they came, a day's old row was gone from sight) —; past the done
  // ones', the oldest done go. Another machine's row the limit closes is no Done of the person's: its feed opens it
  // again once there is room (`capped`, the hu-feed hunt's), so the limit closes those first, the oldest of them, and
  // the person's own rows only after (the swarm's review of 11-10).
  const open = doc.needs.filter((n) => n.state !== "done");
  const fedFirst = [...open.filter((n) => n.kind === "machine"), ...open.filter((n) => n.kind !== "machine")];
  for (const n of fedFirst.slice(0, Math.max(0, open.length - SPACE_LIMITS.needs))) {
    n.state = "done";
    n.doneAt = at;
    delete n.until;
    if (n.kind === "draft") n.outcome = "discarded";
    if (n.kind === "machine" && n.machine) n.machine.capped = true;
  }
  const done = doc.needs.filter((n) => n.state === "done").sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0));
  const goes = new Set(done.slice(0, Math.max(0, done.length - SPACE_LIMITS.needsDone)));
  if (goes.size) doc.needs = doc.needs.filter((n) => !goes.has(n));
  // What happened: the oldest lines go, this machine's own past `log` and another machine's fed copies past `fedLog`
  // apart, so a busy machine's feed never pushes out a line kept nowhere else (the hu-feed hunt's).
  const fedLines = doc.log.filter((e) => e.from).length;
  let ownOver = doc.log.length - fedLines - SPACE_LIMITS.log;
  let fedOver = fedLines - SPACE_LIMITS.fedLog;
  if (ownOver > 0 || fedOver > 0) doc.log = doc.log.filter((e) => (e.from ? fedOver-- <= 0 : ownOver-- <= 0));
  if (doc.syncs.length > SPACE_LIMITS.syncs) doc.syncs = doc.syncs.slice(-SPACE_LIMITS.syncs);
  // The drafts taken out go first, the oldest of them; a kept dashboard stays.
  while (doc.dashboards.length > SPACE_LIMITS.dashboards) {
    const i = doc.dashboards.findIndex((d) => d.state === "removed");
    if (i < 0) break;
    doc.dashboards.splice(i, 1);
  }
  // The routines removed go first, the oldest of them; a proposal past the limit is refused before it is written.
  while (doc.routines.length > ROUTINE_LIMITS.routines) {
    const i = doc.routines.findIndex((r) => r.state === "removed");
    if (i < 0) break;
    doc.routines.splice(i, 1);
  }
  // A watcher's guidance: the oldest that goes nowhere any more — read, dropped — first, then the oldest; and the
  // oldest reviews.
  if (doc.guidance && doc.guidance.length > GUIDE_LIMITS.kept) {
    const over = doc.guidance.length - GUIDE_LIMITS.kept;
    const settled = doc.guidance.filter((g) => g.state === "read" || g.state === "dropped");
    const goes = new Set([...settled, ...doc.guidance.filter((g) => !settled.includes(g))].slice(0, over));
    doc.guidance = doc.guidance.filter((g) => !goes.has(g));
  }
  if (doc.reviews && doc.reviews.length > GUIDE_LIMITS.reviews) doc.reviews = doc.reviews.slice(-GUIDE_LIMITS.reviews);
  if (doc.tasks.length > SPACE_LIMITS.tasks) {
    const gone = new Set(
      doc.tasks
        .filter((t) => t.column === "done")
        .sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0))
        .slice(0, doc.tasks.length - SPACE_LIMITS.tasks)
        .map((t) => t.id),
    );
    doc.tasks = doc.tasks.filter((t) => !gone.has(t.id));
  }
  return doc;
}

/**
 * What another machine's feed of its Spaces of this repository brought, written into this Space (the remote-agents plan's
 * sp-cross): each line once, by its id there — one said again there (Filament's line on a chat's turns grows) changed
 * in place —, in its moment's place, authored `machine`, its moment never past this machine's clock; each row open there
 * one row here, its words as they are there — one dismissed here stays so —; a row here no longer open there (put off or
 * closed there) closed, and opened again once it is open there again; a Space there that the feed names no more —
 * deleted there, or in a folder another machine's agents may no longer use, which nothing here tells apart — its rows
 * closed as no longer in that machine's Spaces (`gone`), its lines kept; and where the feed left off (`fedFrom`). Each field read
 * as a file's is, from a machine that may be any Filament: what does not read is left out. A list cut by a limit —
 * Spaces past the most one feed carries, said there (`past`) or more than this machine reads, rows past the most a Space's
 * list is read for — names only some: what it does not name may be open there still, and is closed by none of it. A row
 * the open rows' limit closed here (`capped`) opens again as there is room, never past it: it would close another; a new
 * row waits for room the same way. Changes
 * `doc`; → how many changes it made, 0 where it brought nothing new.
 * @param {SpaceDoc} doc @param {{ id: string, name: string }} machine @param {unknown} fed  the feed's `spaces`: a whole
 *   answer's, never one that failed — anything but a list names no Space, and closes none
 * @param {number} at @param {(prefix: string) => string} next  an id for a new line or row
 * @param {unknown} [past]  the feed's `past`: how many of that machine's Spaces of the repository it left out
 */
function fedInto(doc, machine, fed, at, next, past = 0) {
  let changes = 0;
  /** How many more rows may be open here before the open rows' limit closes one (`trimmed`). */
  let room = SPACE_LIMITS.needs - doc.needs.filter((n) => n.state !== "done").length;
  for (const s of (Array.isArray(fed) ? fed : []).slice(0, FEED_LIMITS.spaces)) {
    if (!isObj(s) || !spaceable(s.project)) continue;
    const project = String(s.project);
    for (const x of (Array.isArray(s.entries) ? s.entries : []).slice(-FEED_LIMITS.entries)) {
      // One line: what it wrote there never begins a line here (core/space.js logWords), and opens no notice of
      // Filament's where an agent here reads it (core/notices.js).
      const text = isObj(x) ? entryText(typeof x.text === "string" ? unnoticed(oneLine(x.text)) : x.text) : null;
      if (!text?.ok || typeof x.id !== "string" || !/^e\d+$/.test(x.id) || !Number.isFinite(x.at)) continue;
      const who = typeof x.who === "string" ? unnoticed(oneLine(x.who)).slice(0, FEED_LIMITS.who) : "";
      /** @type {SpaceAuthor} */
      const by = { kind: "machine", name: oneLine(machine.name), ...(who ? { who } : {}) };
      const when = Math.min(Number(x.at), at);
      const i = doc.log.findIndex((e) => e.from?.machine === machine.id && e.from.project === project && e.from.id === x.id);
      const was = i >= 0 ? doc.log[i] : null;
      if (was && was.text === text.text && was.at === when && was.by.who === by.who && was.by.name === by.name) continue;
      if (was) doc.log.splice(i, 1);
      // In its moment's place: the logbook reads oldest first, and a line from there may be older than the newest here.
      doc.log.splice(doc.log.findLastIndex((e) => e.at <= when) + 1, 0, { id: was ? was.id : next("e"), at: when, by, text: text.text, task: null, from: { machine: machine.id, project, id: x.id } });
      changes++;
    }
    if (Array.isArray(s.needs)) {
      const cut = s.needs.length > SPACE_LIMITS.needs;
      /** The rows open there, by their id there. @type {Map<string, { text: string, why: string, title: string, was: string, at: number }>} */
      const open = new Map();
      for (const x of s.needs.slice(0, SPACE_LIMITS.needs)) {
        const text = isObj(x) && typeof x.text === "string" ? unnoticed(oneLine(x.text)).slice(0, SPACE_LIMITS.text) : "";
        if (text && typeof x.id === "string" && /^n\d+$/.test(x.id))
          open.set(x.id, { text, why: unnoticed(oneLine(x.why)).slice(0, SPACE_LIMITS.text), title: unnoticed(oneLine(x.title)).slice(0, SPACE_LIMITS.title), was: NEED_KINDS.includes(x.kind) ? x.kind : "", at: Math.min(Number(x.at) || at, at) });
      }
      /** @type {Set<string>} */
      const had = new Set();
      for (const n of doc.needs) {
        const m = n.kind === "machine" ? n.machine : null;
        if (!m || m.id !== machine.id || m.project !== project) continue;
        had.add(m.row);
        const there = open.get(m.row);
        if (!there) {
          if (cut) continue;
          // Its Space is read from there again: closed there, not gone with it.
          if (n.state === "done" && !m.capped) {
            if (m.gone) {
              delete m.gone;
              changes++;
            }
            continue;
          }
          // Closed there — one the limit closed here, now there too: it opens as it opens there.
          if (n.state !== "done") room++;
          Object.assign(n, { state: "done", doneAt: n.state === "done" ? n.doneAt : at });
          delete n.until;
          delete m.capped;
          m.closed = true;
          changes++;
          continue;
        }
        // Dismissed here; or closed by the limit here, and no room for it yet.
        if (n.state === "done" && (m.capped ? room <= 0 : !m.closed)) continue;
        const was = JSON.stringify([n.state, n.text, n.why, n.title, m.name]);
        if (n.state === "done") {
          n.state = "open";
          delete n.doneAt;
          delete m.closed;
          delete m.gone;
          delete m.capped;
          room--;
        }
        Object.assign(n, { text: there.text, why: there.why, title: there.title });
        m.name = oneLine(machine.name);
        if (JSON.stringify([n.state, n.text, n.why, n.title, m.name]) !== was) changes++;
      }
      // A new row waits for room, never past it: the limit would close another for it. Its feed brings it again.
      for (const [row, x] of open) {
        if (had.has(row) || room <= 0) continue;
        doc.needs.push({ id: next("n"), kind: "machine", text: x.text, why: x.why, dashboard: "", title: x.title, machine: { id: machine.id, name: oneLine(machine.name), project, row, was: x.was }, at: x.at, state: "open" });
        room--;
        changes++;
      }
    }
    const c = s.cursor;
    if (isObj(c) && Number.isFinite(c.at) && Number.isFinite(c.n)) {
      const key = fedKey(machine.id, project);
      const kept = doc.fedFrom?.[key];
      if (!kept || kept.at !== c.at || kept.n !== c.n) {
        // The newest last, so past the limit the one fed longest ago goes.
        const { [key]: _was, ...rest } = doc.fedFrom || {};
        doc.fedFrom = Object.fromEntries([...Object.entries(rest), [key, { at: Number(c.at), n: Number(c.n) }]].slice(-SPACE_LIMITS.fedFrom));
        changes++;
      }
    }
  }
  if (!Array.isArray(fed) || fed.length > FEED_LIMITS.spaces || Number(past) > 0) return changes;
  const named = new Set(fed.filter((s) => isObj(s) && spaceable(s.project)).map((s) => String(s.project)));
  for (const n of doc.needs) {
    const m = n.kind === "machine" ? n.machine : null;
    if (!m || m.id !== machine.id || named.has(m.project) || (n.state === "done" && !m.capped)) continue;
    Object.assign(n, { state: "done", doneAt: n.state === "done" ? n.doneAt : at });
    delete n.until;
    delete m.capped;
    Object.assign(m, { closed: true, gone: true });
    changes++;
  }
  return changes;
}

/**
 * A task moved into a column, as of a moment: when it began, when it was done; where the person put it in the column it
 * left goes with it. @param {SpaceTask} t @param {import("../core/space.js").Column} to @param {number} at
 */
function moveTo(t, to, at) {
  if (t.column === to) return;
  t.column = to;
  t.movedAt = at;
  delete t.rank;
  if (to === "doing" && t.startedAt == null) t.startedAt = at;
  t.doneAt = to === "done" ? at : null;
}

/**
 * @param {{ dir: string | null, events?: { publish: (topic: string, payload: any) => any } | null, log?: (level: string, msg: string) => void, now?: () => number, exists?: ((project: string) => boolean) | null, madeOnly?: boolean, pruneEvery?: number, apart?: (chain: string) => boolean, archived?: (project: string) => boolean }} o
 *   `dir`: where the files are; null keeps every Space in memory alone (the tests'); `exists`: whether a project is
 *   known, which a Space dropped with its project waits on before it is written again; `madeOnly`: a project has a Space
 *   only once the person made it (`make`, `makeOwn`), and a write reaches no other — Filament's own store, since 10-29;
 *   without it every project has one, made by its first write — the world the tests of what a Space does keep;
 *   `pruneEvery`: how often, in ms, the deleted Spaces past their 30 days are removed while it runs (`SPACE_PRUNE_EVERY_MS`
 *   for Filament's own; none by default), until `stop()`; `apart`: whether a chat's words are none of another chat's
 *   agent's to read (server.js's `space.apart`): a refusal to an agent names such a chat "an untitled chat" (`toReader`);
 *   `archived`: whether the person archived a project (the left bar's Archive project), whose Space then runs nothing
 *   by itself (`archivedNow`)
 */
export function createSpaceStore({ dir, events = null, log = () => {}, now = Date.now, exists = null, madeOnly = false, pruneEvery = 0, apart = () => false, archived = () => false }) {
  /**
   * Another chat, as a refusal to a chat's agent (`reader`) names it: `said`, its name kept with it, save a chat whose
   * words are none of the reader's (`apart`) — "an untitled chat" (core/space.js `readerNames`).
   * @param {string} reader @param {string | null | undefined} chain @param {string} said
   */
  const toReader = (reader, chain, said) => (chain && chain !== reader && apart(chain) ? UNTITLED_CHAT : said);
  /** @type {Map<string, SpaceDoc>} */
  const docs = new Map();
  /**
   * The Spaces dropped with their project (A5) in this run: a write that was under way as it went — a watch's look, a
   * run's end — would make its file again (found by the Hunter on A5), so it is refused while the project stays gone.
   * A project made again with the same folder has its Space again.
   * @type {Set<string>}
   */
  const dropped = new Set();
  /** The Spaces the person deleted in this run: a write under way as it went is refused, as a dropped one's is, until made again or brought back. */
  const deletedNow = new Set();
  /** The Spaces deleted where no folder keeps them (the tests' stores): each as it was, and when. @type {Map<string, { at: number, doc: SpaceDoc }>} */
  const bin = new Map();
  /** Each shown project's Space of your own, read once until a Space changes (`ownAbove`). @type {Map<string, string> | null} */
  let above = null;
  /**
   * The folder's `.json` files as `known` last read them, in the folder's order: read again only once this store has
   * made or taken away one — a Space's first write, a delete, a bring back, a drop, a file that would not read set
   * aside —, so the kept dashboards (each read of a dashboard's looks at them several times), the left bar's counts and
   * the routines read no folder for a list that did not change. Null until read, and after such a change.
   * @type {string[] | null}
   */
  let filed = null;
  /** @param {string} project */
  const fileOf =(project) => join(/** @type {string} */ (dir), `${project}.json`);

  /** @param {unknown} project */
  const idOf = (project) => {
    const p = String(project ?? "");
    if (!spaceable(p)) throw refused(400, `"${p.slice(0, 40)}" is no project's id`);
    return p;
  };

  /** Whether a project has a Space: one written in this run, or its file. @param {string} id */
  const hasOne = (id) => (docs.get(id)?.seq ?? 0) > 0 || (!!dir && existsSync(fileOf(id)));
  /** What a project with no Space is refused with: where its deleted one waits for Bring back, that it does. @param {string} id */
  const noneWords = (id) => (binned(id) ? SPACE_DELETED : NO_SPACE);

  /**
   * The Spaces of before set aside, once (10-29): every project's file renamed whole to `.before-apps` — a Space of your
   * own stays, the person made it —, and a mark written so a Space made since is never set aside.
   */
  function setAsideOld() {
    if (!dir) return;
    const mark = join(dir, SET_ASIDE_MARK);
    try {
      if (existsSync(mark)) return;
      mkdirSync(dir, { recursive: true });
      let n = 0;
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && spaceable(x.slice(0, -5)))) {
        /** @type {any} */
        let raw = null;
        try {
          raw = JSON.parse(readFileSync(join(dir, f), "utf8"));
        } catch {}
        if (isObj(raw?.own)) continue;
        renameSync(join(dir, f), join(dir, `${f}${SET_ASIDE}`));
        filed = null;
        n++;
      }
      writeFileSync(mark, JSON.stringify({ at: now(), setAside: n }));
      if (n) log("info", `spaces: ${n} Space${n === 1 ? "" : "s"} of before set aside, each file kept whole as .before-apps: a project has a Space once the person makes one, and making it brings its board's tasks back`);
    } catch (/** @type {any} */ e) {
      log("warn", `spaces: the Spaces of before could not be set aside (${e?.message || e}); it is tried again at the next start`);
    }
  }
  setAsideOld();
  // This build's Spaces another build set aside, each taken back as the store starts: a project has its Space again
  // whether or not anything reads it (r-itself, 11-12). One that does not read is its own read's to say.
  if (dir)
    for (const name of setAsideIn(dir, STORE_FILES.spaces.version))
      try {
        fileRead(join(dir, name), false);
      } catch {}

  /**
   * The deleted Spaces that can no longer come back, removed for good (the owner's of 10-29): each file deleted more than
   * `SPACE_BACK_MS` ago — at the start, at each delete, and every `pruneEvery` while it runs —, and the tests' bin the
   * same way.
   */
  function pruneDeleted() {
    const since = now() - SPACE_BACK_MS;
    for (const [id, b] of bin) if (b.at < since) bin.delete(id);
    if (!dir) return;
    try {
      for (const f of readdirSync(dir)) {
        const m = DELETED.exec(f);
        if (!m || Number(m[2]) >= since) continue;
        try {
          rmSync(join(dir, f), { force: true });
        } catch (/** @type {any} */ e) {
          log("warn", `spaces: the deleted Space ${f}, past its 30 days, could not be removed (${e?.message || e}); it is tried again at the next prune`);
        }
      }
    } catch {}
  }
  pruneDeleted();
  // And while it runs on: a Filament left running past a Space's 30 days has no start or delete to remove it then
  // (found mapping the prune, 10-29).
  const pruning = pruneEvery > 0 ? setInterval(pruneDeleted, pruneEvery) : null;
  pruning?.unref?.();

  /**
   * A Space of before's board, set aside (10-29): its tasks and its count of changes, so the ids of those made after
   * never meet theirs; none where its tasks came back already, or nothing was set aside.
   * @param {string} id @returns {{ tasks: SpaceTask[], seq: number, file: string | null }}
   */
  function oldBoard(id) {
    const file = dir ? `${fileOf(id)}${SET_ASIDE}` : null;
    if (!file || !existsSync(file)) return { tasks: [], seq: 0, file: null };
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      const doc = shaped(raw);
      return { tasks: doc.tasks, seq: doc.seq, file };
    } catch (/** @type {any} */ e) {
      log("warn", `spaces: the old board of ${id} could not be read (${e?.message || e}); its Space starts empty, and the file stays`);
      return { tasks: [], seq: 0, file: null };
    }
  }

  /**
   * A project's newest deleted Space that may still come back: when it was deleted; null where none was in 30 days.
   * @param {string} id @returns {{ at: number, file: string | null } | null}
   */
  function binned(id) {
    const since = now() - SPACE_BACK_MS;
    if (!dir) {
      const b = bin.get(id);
      return b && b.at >= since ? { at: b.at, file: null } : null;
    }
    let best = null;
    try {
      for (const f of readdirSync(dir)) {
        const m = DELETED.exec(f);
        if (!m || m[1] !== id) continue;
        const at = Number(m[2]);
        if (at >= since && (!best || at > best.at)) best = { at, file: join(dir, f) };
      }
    } catch {}
    return best;
  }

  /**
   * A Space's file read as this build reads it (r-itself, 11-12; services/store-files.js): one of another build's
   * version is set aside under its version's name first, and this build's own, set aside so, taken back. Each is said,
   * and the folder's list read again. @param {string} file @param {boolean} [swept]
   */
  function fileRead(file, swept = true) {
    return readStoreFile(file, STORE_FILES.spaces, (level, msg) => {
      filed = null;
      log(level, `spaces: ${msg}`);
    }, { now, swept });
  }

  /**
   * A Space as its file holds it; a file that cannot be read is set aside as `.broken`, said, and the Space starts
   * empty — one of another build's version under its version's name (`fileRead`). @param {string} project
   */
  function load(project) {
    if (!dir) return emptySpace();
    const file = fileOf(project);
    try {
      const raw = fileRead(file);
      if (raw?.version !== 1) throw new Error("it is no version 1 Space");
      return shaped(raw);
    } catch (/** @type {any} */ e) {
      if (e?.code === "ENOENT") return emptySpace();
      log("warn", `spaces: ${project}.json could not be read (${e.message}); its Space starts empty, and the file is kept beside it as .broken`);
      try {
        renameSync(file, `${file}.broken`);
        filed = null;
      } catch {}
      return emptySpace();
    }
  }

  /** Write a Space whole, then make it the store's, then say so. @param {string} project @param {SpaceDoc} next */
  function commit(project, next) {
    if (dir) {
      mkdirSync(dir, { recursive: true });
      const file = fileOf(project);
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        writeFileSync(tmp, JSON.stringify(next));
        renameSync(tmp, file);
      } catch (e) {
        rmSync(tmp, { force: true });
        throw e;
      }
      // A project's first file is one more in the folder.
      if (filed && !filed.includes(`${project}.json`)) filed = null;
    }
    docs.set(project, next);
    above = null;
    events?.publish("space", { type: "space", project, seq: next.seq });
  }

  /**
   * One change: made on a copy of the Space, counted, trimmed and written; the change's own answer handed back. A
   * project with no Space is refused it where only a made Space is written (`madeOnly`), and one deleted in this run
   * always — but the change that makes it (`making`).
   * @template T @param {string} project @param {(doc: SpaceDoc, at: number) => T} fn @param {{ making?: boolean }} [o] @returns {T}
   */
  function change(project, fn, { making = false } = {}) {
    if (dropped.has(project)) {
      if (exists && !exists(project)) throw refused(404, "This Space went with its project, which was deleted.");
      dropped.delete(project);
    }
    if (!making && (deletedNow.has(project) || (madeOnly && !hasOne(project)))) throw refused(404, noneWords(project));
    const doc = structuredClone(read(project));
    const at = now();
    doc.seq++;
    // A Space begins kept to its first week: the Record keeper's first line is that week's, once it ends.
    if (!doc.keptWeek) doc.keptWeek = weekStart(at);
    const out = fn(doc, at);
    commit(project, trimmed(doc, at));
    return out;
  }

  /**
   * A Space as it stands; the Record keeper's line for the week just ended first written where it is due (v3). Read
   * only: what it hands back is the store's own.
   * @param {string} project @returns {SpaceDoc}
   */
  function read(project) {
    let doc = docs.get(project);
    if (!doc) docs.set(project, (doc = load(project)));
    const thisWeek = weekStart(now());
    if (doc.keptWeek < thisWeek && (doc.tasks.length || doc.log.length)) {
      const from = weekStart(thisWeek - 1);
      const line = weekWords(doc, from, thisWeek);
      const kept = structuredClone(doc);
      kept.keptWeek = thisWeek;
      if (line) {
        kept.seq++;
        kept.log.push({ id: `e${kept.seq}`, at: now(), by: { kind: "keeper" }, text: line, task: null });
      }
      try {
        commit(project, trimmed(kept, now()));
        doc = kept;
      } catch (/** @type {any} */ e) {
        log("warn", `spaces: the Record keeper's line for ${project} could not be written (${e.message}); it is tried again at the next read`);
      }
    }
    return doc;
  }

  /** @param {SpaceDoc} doc @param {string} id */
  const taskIn = (doc, id) => {
    const t = doc.tasks.find((x) => x.id === String(id ?? "").trim());
    if (!t) throw refused(404, `There is no task "${String(id ?? "").slice(0, 40)}" on the board: read the board for the ids.`);
    return t;
  };

  /** @param {SpaceDoc} doc @param {unknown} id */
  const pullIn = (doc, id) => {
    const p = (doc.pulls || []).find((x) => x.id === String(id ?? "").trim());
    if (!p) throw refused(404, `There is no pull "${String(id ?? "").slice(0, 40)}" on this board.`);
    return p;
  };
  /**
   * A pull's moves going back without asking, or asking again: the person's word, and a line in What happened, as it
   * changes what a move on the board does. @param {SpaceDoc} doc @param {number} at @param {import("../core/space-pulls.js").SpacePull} p @param {boolean} on
   */
  const alwaysSet = (doc, at, p, on) => {
    if (on && !p.back) throw refused(409, `${p.title}'s pull has no way to move a card back: its moves stay on this board.`);
    if (p.always === on) return;
    p.always = on;
    said(doc, at, on ? `Moves of ${p.title}'s cards on this board go back to ${p.title} without asking you.` : `Moves of ${p.title}'s cards on this board ask you again before they go back to ${p.title}.`);
  };

  /** @param {SpaceDoc} doc @param {unknown} id */
  const routineOf = (doc, id) => {
    const r = doc.routines.find((x) => x.id === String(id ?? "").trim());
    if (!r) throw refused(404, `There is no routine "${String(id ?? "").slice(0, 40)}" in this Space: its read lists them with their ids.`);
    return r;
  };
  /** Which of the two a record is, as What happened names it: a watcher listens, a routine at times runs. @param {import("../core/routines.js").Routine} r */
  const kindOf = (r) => (r.trigger ? "watcher" : "routine");
  /** A routine's schedule in its row's words; a watcher's, that it listens from now. @param {import("../core/routines.js").Routine} r */
  const whenOf = (r) => {
    if (r.trigger) return "it listens from now";
    const s = scheduleOf(r.when);
    return s.ok ? whenWords(s.s) : r.when;
  };
  /**
   * What a routine may do, as What happened says it: a Space of the person's own writes in a lane where its folder is a
   * git repository, else in its folder (A2c) — "writing" says both. @param {SpaceDoc} doc @param {import("../core/routines.js").Routine} r
   */
  const mayOf = (doc, r) => `${r.writes ? (doc.own ? "writing" : "writing in a lane of its own") : "reading only"}${r.acts?.length ? `, acting through ${actWords(r.acts)}` : ""}`;
  /**
   * Whom a watcher wakes and what that may do, as What happened says it, the chats it names kept apart (core/space.js
   * `NamedWords`): a new chat each time, its run as a routine's (`mayOf`); the chat that proposed it (`by`, its name),
   * in a turn held to reading, or one that works as that chat works; or only the person, no agent run — and what runs
   * all the same where its trigger runs a program (core's `toldWords`). Then the chat it may guide, by `nameOf`'s name.
   * @param {SpaceDoc} doc @param {import("../core/routines.js").Routine} r @param {string} by @param {(chain: string) => string} nameOf
   * @returns {import("../core/space.js").NamedWords}
   */
  const wakesParts = (doc, r, by, nameOf) => {
    const wakes = r.wakes || "new";
    if (wakes === "you") return [`${wakesWords("you", "")}: ${r.trigger ? toldWords(r.trigger) : "nothing runs"}`];
    const watched = r.trigger ? triggerChat(r.trigger) : "";
    /** @type {import("../core/space.js").NamedWords} */
    const guides = r.guides && watched ? [", and may guide ", { chain: watched, name: nameOf(watched) }] : [];
    if (wakes === "chat") return ["wakes ", { chain: r.madeIn, name: by }, r.writes ? " in a turn that works as that chat works" : " in a turn held to reading", ...guides];
    return [`${wakesWords("new", "")}, ${mayOf(doc, r)}`, ...guides];
  };
  /** A line of Filament's, or a chat's agent's, in What happened. @param {SpaceDoc} doc @param {number} at @param {string} text @param {SpaceAuthor} [by] */
  const said = (doc, at, text, by = { kind: "filament" }) => void doc.log.push({ id: `e${doc.seq}`, at, by, text: entryText(text).ok ? text : text.slice(0, SPACE_LIMITS.text), task: null });
  /** Filament's line about this Space itself, which no other machine's Space is fed (`onlyHere`). @param {SpaceDoc} doc @param {number} at @param {string} text */
  const saidHere = (doc, at, text) => void doc.log.push({ id: `e${doc.seq}`, at, by: { kind: "filament" }, text: entryText(text).ok ? text : text.slice(0, SPACE_LIMITS.text), task: null, onlyHere: true });
  /**
   * A line that names chats in its words, kept in parts (core/space.js `NamedWords`): its words as the person's page reads
   * them, and its parts, by which another chat's agent reads it under its own names (`logWords`).
   * @param {SpaceDoc} doc @param {number} at @param {import("../core/space.js").NamedWords} parts @param {SpaceAuthor} [by]
   */
  const saidNamed = (doc, at, parts, by = { kind: "filament" }) => {
    const text = namedText(parts);
    doc.log.push({ id: `e${doc.seq}`, at, by, text: entryText(text).ok ? text : text.slice(0, SPACE_LIMITS.text), task: null, ...(parts.some((x) => typeof x !== "string") ? { named: parts } : {}) });
  };
  /** A held guidance's open row in Needs you, put to Done: it goes, or goes no more. @param {SpaceDoc} doc @param {number} at @param {(n: import("../core/space.js").NeedRow) => boolean} which */
  const closeHeld = (doc, at, which) => {
    for (const n of doc.needs)
      if (n.kind === "routine" && n.routine?.guide && n.state !== "done" && which(n)) {
        n.state = "done";
        n.doneAt = at;
        delete n.until;
      }
  };
  /**
   * A guidance held for the person, in Needs you: the row open for its watcher and chat, its words replaced, or a new
   * one — which watcher, the chat it would guide by `name`, the guidance's first line, and its words whole.
   * @param {SpaceDoc} doc @param {number} at @param {import("../core/watchers.js").Guidance} g @param {string} title @param {string} name
   */
  const heldRow = (doc, at, g, title, name) => {
    const text = heldGuideWords(title, name, g.text).slice(0, SPACE_LIMITS.text);
    const routine = { id: g.watcher, chain: "", guide: { id: g.id, to: g.to, from: g.from, name, text: g.text } };
    const open = doc.needs.find((x) => x.kind === "routine" && x.routine?.id === g.watcher && x.routine.guide?.to === g.to && x.state !== "done");
    if (open) Object.assign(open, { text, why: HELD_GUIDE_WHY, title, routine, at });
    else doc.needs.push({ id: `n${doc.seq}`, kind: "routine", text, why: HELD_GUIDE_WHY, dashboard: "", title, routine, at, state: "open" });
  };
  /**
   * A watcher's guidance that still waits — for its chat to let go, or for the person in Needs you — goes no more once
   * its watcher is changed or taken out: what the person switched on is what it was then. Each is dropped, its row
   * closed, and What happened says so once. @param {SpaceDoc} doc @param {number} at
   * @param {import("../core/routines.js").Routine} r @param {string} how  what happened to the watcher
   */
  const dropGuides = (doc, at, r, how) => {
    const live = (doc.guidance || []).filter((g) => g.watcher === r.id && (g.state === "waiting" || g.state === "held"));
    if (!live.length) return;
    for (const g of live) Object.assign(g, { state: "dropped", why: `its watcher ${how}` });
    closeHeld(doc, at, (n) => n.routine?.id === r.id);
    said(doc, at, `What “${r.title}” wrote to guide the chat it watches still waited, and is dropped: the watcher ${how}.`);
  };
  /**
   * What a kept dashboard was kept as: its way back once it is taken out (`dashboardBack`); none without its grant.
   * @param {import("../core/space.js").SpaceDashboard} d @returns {import("../core/space.js").KeptAs | null}
   */
  const keptAsOf = (d) => (d.grant ? { v: d.v, grant: d.grant, ...(d.scripts ? { scripts: d.scripts } : {}), at: d.at, paused: d.paused, seen: d.seen, ...(d.glance === true ? { glance: true } : {}), ...(d.paused && d.pausedBy ? { pausedBy: d.pausedBy } : {}) } : null);
  /**
   * A Space brought back (`bringBack`), once its file is named back: its line, and each app of it kept in another Space
   * since taken out here — at its newest version, what it was kept as its way back —, a line each. → their titles.
   * @param {string} id @param {(name: string) => { title: string, v: number }} appOf @returns {string[]}
   */
  function backAs(id, appOf) {
    const others = known().filter((p) => p !== id);
    const elsewhere = new Set(read(id).dashboards.filter((d) => d.state === "kept" && others.some((p) => read(p).dashboards.some((x) => x.name === d.name && x.state === "kept"))).map((d) => d.name));
    return change(
      id,
      (doc, at) => {
        said(doc, at, "You brought this Space back.");
        /** @type {string[]} */
        const titles = [];
        if (!elsewhere.size) return titles;
        // Out, nothing of it reads: a stopped source's row in Needs you goes, as at a take-out.
        doc.needs = doc.needs.filter((n) => !(n.kind === "source" && n.dashboard && elsewhere.has(n.dashboard) && n.state !== "done"));
        doc.dashboards = doc.dashboards.map((d) => {
          if (d.state !== "kept" || !elsewhere.has(d.name)) return d;
          const app = appOf(d.name);
          titles.push(app.title);
          doc.seq++;
          said(doc, at, `“${app.title}” is kept in another project's Space now, so it came back taken out of this one: Add to this Space… puts it back once it is taken out there.`);
          return { name: d.name, state: "removed", v: app.v || d.v, grant: null, at, paused: false, seen: {}, was: keptAsOf(d) };
        });
        return titles;
      },
      { making: true },
    );
  }

  /**
   * Pause all (S6-D4, D12): the moment it was switched on, or null; one switch for this Filament, kept in the spaces
   * folder beside the Spaces — its name is no project's — so a restart keeps it. Read once.
   * @type {number | null | undefined}
   */
  /**
   * An ask ended (E42 SA-D7): to Done today — pressed, turned down, taken back, or gone with its thing — and What
   * happened's line where one is due: the person's Turn down tells its chat; its chat's take back is its own line; a
   * thing that moved says so. A press has the person's own line already (You kept …).
   * @param {import("../core/space.js").SpaceDoc} doc @param {import("../core/space.js").NeedRow} n @param {number} at
   * @param {import("../core/space.js").AskEnd} ended @param {{ moved?: string, name?: string | null }} [o]
   */
  function endAsk(doc, n, at, ended, { moved, name = null } = {}) {
    const a = /** @type {import("../core/space.js").Ask} */ (n.ask);
    n.state = "done";
    n.doneAt = at;
    delete n.until;
    a.ended = ended;
    if (ended === "moved") a.moved = moved || "its thing moved";
    else delete a.moved;
    // The asker and a Tell's chats kept apart, as the person's page reads them and another chat's agent by its own names.
    const press = a.what === "tell" && a.chats?.length ? askPressParts(askTitleParts(a, n.title)) : [askPress(n.text)];
    /** @type {[import("../core/space.js").NamedWords, SpaceAuthor] | null} */
    const line =
      ended === "turned down" ? [["You turned down ", { chain: a.chain, name: a.byName || "a chat" }, "'s ask: ", ...press, "."], { kind: "you" }]
      : ended === "taken back" ? [["Took back its ask to ", ...press, "."], { kind: "agent", chain: a.chain, ...(name ? { name } : {}) }]
      : ended === "moved" ? [[{ chain: a.chain, name: a.byName || "A chat" }, "'s ask to ", ...press, ` went by itself: ${a.moved}.`], { kind: "filament" }]
      : null;
    if (!line) return;
    // One change may end several (a settle): each line its own id, as `happened` gives them.
    if (doc.log.some((e) => e.id === `e${doc.seq}`)) doc.seq++;
    saidNamed(doc, at, line[0], line[1]);
  }

  /**
   * Settings › Space as last read or written (the owner's of 11-04); undefined until the first read.
   * @type {import("../core/space-settings.js").SpaceSettings | undefined}
   */
  let kept;
  /** Settings › Space, read once from its file: none where it is not there, or does not read. */
  function defaults() {
    if (kept !== undefined) return kept;
    kept = {};
    if (!dir) return kept;
    try {
      kept = settingsIn(JSON.parse(readFileSync(join(dir, DEFAULTS_FILE), "utf8")));
    } catch (/** @type {any} */ e) {
      if (e?.code !== "ENOENT") log("warn", `spaces: ${DEFAULTS_FILE} could not be read (${e.message}); every Space runs with no default model until Settings › Space is saved again`);
    }
    return kept;
  }

  /**
   * Whether a project is archived (r-itself, 11-12): its Space runs nothing by itself until the person brings it back
   * — its routines' times are skipped, its watchers hear nothing and their sources stand still —, as under Pause all,
   * with nothing switched off: back, each goes again, and nothing it missed is made up. The one rule the runner
   * (app/routines.js), the watchers' sources (app/watchers/*.js) and what they keep here ask. Not archived where it
   * cannot be read. @param {unknown} project
   */
  const archivedNow = (project) => {
    try {
      return !!archived(String(project ?? ""));
    } catch {
      return false;
    }
  };
  let paused;
  /** The chat whose agent switched it on, with its line (SA-D3); null where the person did. @type {{ chain: string, byName: string, line: string } | null} */
  let pausedBy = null;
  const pauseFile = () => join(/** @type {string} */ (dir), "_pause-all.json");
  function pausedSince() {
    if (paused !== undefined) return paused;
    paused = null;
    if (!dir) return paused;
    try {
      const kept = JSON.parse(readFileSync(pauseFile(), "utf8"));
      const since = Number(kept?.since);
      paused = since > 0 ? since : null;
      pausedBy = paused ? pausedByIn(kept?.by) ?? null : null;
    } catch (/** @type {any} */ e) {
      if (e?.code !== "ENOENT") log("warn", `spaces: _pause-all.json could not be read (${e.message}); what runs by itself runs`);
    }
    return paused;
  }

  /**
   * The projects that have a Space: a file on disk, or one written since the store began — a Space only read is none
   * (a project with no Space reads as an empty one).
   */
  function known() {
    /** @type {string[]} */
    let names = [];
    if (filed) names = filed;
    else
      try {
        names = filed = dir ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
      } catch {}
    const written = [...docs].filter(([, d]) => d.seq > 0).map(([p]) => p);
    return [...new Set([...names.map((f) => f.slice(0, -5)), ...written])].filter(spaceable);
  }

  const store = {
    /** Its prune's clock stopped, as Filament stops. */
    stop() {
      if (pruning) clearInterval(pruning);
    },

    /** @param {unknown} project */
    get: (project) => read(idOf(project)),

    /** The projects that have a Space: a file on disk, or one made since the store began. */
    projects: () => known(),

    /** Whether a project has a Space (10-29: one the person made; without `madeOnly`, every project's). @param {unknown} project */
    has: (project) => spaceable(project) && (!madeOnly || hasOne(String(project))),

    /**
     * A project's Space made by the person (10-29): a new one — with its old board's tasks where a Space of before was set
     * aside, only those, the rest left in that file, which is named `-brought` after so a Space made again starts empty.
     * A Space of your own is made by `makeOwn`. → whether it was made now, and how many tasks came back.
     * @param {unknown} project @returns {{ made: boolean, tasks: number }}
     */
    make(project) {
      const id = idOf(project);
      if (hasOne(id)) return { made: false, tasks: 0 };
      const old = oldBoard(id);
      const out = change(
        id,
        (doc, at) => {
          doc.seq = Math.max(doc.seq, old.seq + 1);
          doc.tasks = old.tasks;
          const n = old.tasks.length;
          saidHere(doc, at, n ? `You made this Space. ${n} task${n === 1 ? "" : "s"} came back from its old board.` : "You made this Space.");
          return { made: true, tasks: n };
        },
        { making: true },
      );
      deletedNow.delete(id);
      if (old.file)
        try {
          renameSync(old.file, `${old.file}-brought`);
        } catch (/** @type {any} */ e) {
          log("warn", `spaces: the old board of ${id} stays named as it was (${e?.message || e}); a Space made again brings its tasks back again`);
        }
      return out;
    },

    /**
     * A project's Space deleted by the person (10-29): its file renamed whole (`.deleted-<ms>`) and the store's copy
     * dropped, so nothing of it runs any more — its routines and its dashboards' watches are read from it —, said on the
     * stream. Bring back has it as it was for 30 days. A Space of your own is deleted from its own menu.
     * @param {unknown} project @returns {{ at: number }}
     */
    remove(project) {
      const id = idOf(project);
      if (!hasOne(id)) throw refused(404, noneWords(id));
      const doc = read(id);
      if (doc.own) throw refused(409, "A Space of your own is deleted from its own menu: its ⋯ › Delete Space….");
      const at = now();
      if (dir) {
        renameSync(fileOf(id), `${fileOf(id)}.deleted-${at}`);
        filed = null;
      } else bin.set(id, { at, doc });
      docs.delete(id);
      deletedNow.add(id);
      above = null;
      events?.publish("space", { type: "space", project: id, seq: 0, gone: true });
      pruneDeleted();
      return { at };
    },

    /** When a project's Space was deleted, where it may still come back; null else. @param {unknown} project */
    deletedAt: (project) => (spaceable(project) && !hasOne(String(project)) ? binned(String(project))?.at ?? null : null),

    /** Every project whose deleted Space may still come back, and when it was deleted: the bar's Bring back. @returns {Record<string, number>} */
    deletedAll() {
      /** @type {Set<string>} */
      const ids = new Set(bin.keys());
      try {
        if (dir) for (const f of readdirSync(dir)) {
          const m = DELETED.exec(f);
          if (m && spaceable(m[1])) ids.add(m[1]);
        }
      } catch {}
      /** @type {Record<string, number>} */
      const out = {};
      for (const id of ids) {
        const at = hasOne(id) ? null : binned(id)?.at ?? null;
        if (at != null) out[id] = at;
      }
      return out;
    },

    /**
     * A project's deleted Space brought back as it was (10-29), within 30 days of its delete; refused where it has one,
     * or none to bring back. An app of it kept in another Space since stays kept there alone — an app is kept in one
     * Space —: here it comes back taken out, what it was kept as its way back, as a take-out leaves it, and a line says
     * so (found reviewing the Space work, 10-29). → when it was deleted, and the titles of those taken out.
     * @param {unknown} project
     * @param {{ appOf?: (name: string) => { title: string, v: number } }} [o]  an app's title and its newest version
     * @returns {{ at: number, takenOut?: string[] }}
     */
    bringBack(project, { appOf = (name) => ({ title: name, v: 0 }) } = {}) {
      const id = idOf(project);
      if (hasOne(id)) throw refused(409, "This project has a Space already.");
      const b = binned(id);
      if (!b) throw refused(404, "This project has no deleted Space to bring back: one is kept 30 days.");
      const held = bin.get(id);
      if (b.file) {
        renameSync(b.file, fileOf(id));
        filed = null;
      } else {
        docs.set(id, /** @type {{ doc: SpaceDoc }} */ (held).doc);
        bin.delete(id);
      }
      if (dir) docs.delete(id);
      deletedNow.delete(id);
      // What it holds is read and changed before it is back: a failure on the way leaves it deleted as it was, never
      // back with an app kept in two Spaces (found by the review of 10-29).
      /** @type {string[]} */
      let takenOut;
      try {
        takenOut = backAs(id, appOf);
      } catch (e) {
        docs.delete(id);
        if (b.file) {
          renameSync(fileOf(id), b.file);
          filed = null;
        } else if (held) bin.set(id, held);
        deletedNow.add(id);
        throw e;
      }
      return { at: b.at, ...(takenOut.length ? { takenOut } : {}) };
    },

    /**
     * The Spaces of the person's own (HarnessV4_SpacesPlugins_Plan A1), oldest first: each one's project and what it
     * keeps of itself.
     * @returns {{ project: string, own: import("../core/space.js").SpaceOwn }[]}
     */
    owns() {
      return known()
        .map((project) => ({ project, own: read(project).own }))
        .filter((x) => !!x.own)
        .map((x) => ({ project: x.project, own: /** @type {import("../core/space.js").SpaceOwn} */ (x.own) }))
        .sort((a, b) => a.own.at - b.own.at || a.own.name.localeCompare(b.own.name));
    },

    /**
     * The Space of your own that shows a project (A7), or null: the Space above it, whose connectors and plugins its
     * chats get (the owner's word of 10-26). A project shows in one Space at most. Read every chat's settings, so it is
     * read once until a Space changes.
     * @param {unknown} project @returns {string | null}
     */
    ownAbove(project) {
      if (!above) {
        const next = new Map();
        for (const o of store.owns()) for (const p of o.own.shows || []) next.set(p, o.project);
        above = next;
      }
      return above.get(String(project ?? "")) ?? null;
    },

    /**
     * A project's Space made one of the person's own (A1), or its name changed: the first is said in What happened,
     * a new name too. Refused past OWN_LIMITS.spaces.
     * @param {unknown} project @param {{ name: string, folder?: string }} o
     * @returns {import("../core/space.js").SpaceOwn}
     */
    makeOwn(project, { name, folder }) {
      const id = idOf(project);
      const ok = ownName(name);
      if (!ok.ok) throw refused(400, ok.error);
      const was = read(id).own;
      if (!was && store.owns().length >= OWN_LIMITS.spaces) throw refused(409, `Filament keeps ${OWN_LIMITS.spaces} Spaces of your own at most: delete one first.`);
      if (!was && !folder) throw refused(400, "A Space of your own needs its folder.");
      const out = change(
        id,
        (doc, at) => {
          if (!was) {
            doc.own = { name: ok.name, folder: String(folder), at };
            saidHere(doc, at, `You made this Space: “${ok.name}”, its files in ${folder}.`);
          } else if (was.name !== ok.name) {
            doc.own = { ...was, name: ok.name };
            said(doc, at, `You renamed this Space “${ok.name}” (it was “${was.name}”).`);
          }
          return /** @type {import("../core/space.js").SpaceOwn} */ (doc.own);
        },
        { making: !was },
      );
      deletedNow.delete(id);
      return out;
    },

    /**
     * The projects a Space of your own shows (A7): their Needs you and tiles on its page, a project in one Space at
     * most — shown here, it leaves the Space that showed it before. → the projects it shows now.
     * @param {unknown} project @param {{ add?: string, drop?: string }} o @returns {string[]}
     */
    ownShows(project, { add, drop }) {
      const id = idOf(project);
      if (!read(id).own) throw refused(409, "Only a Space of your own shows projects.");
      if (add) {
        idOf(add);
        if (add === id) throw refused(400, "A Space does not show itself.");
        if (read(add).own) throw refused(400, "A Space of your own is not a project to show.");
        for (const o of store.owns())
          if (o.project !== id && o.own.shows?.includes(add))
            change(o.project, (doc) => {
              const own = doc.own;
              if (!own) return;
              const shows = (own.shows || []).filter((p) => p !== add);
              doc.own = { name: own.name, folder: own.folder, at: own.at, ...(shows.length ? { shows } : {}) };
            });
      }
      return change(id, (doc) => {
        const own = /** @type {import("../core/space.js").SpaceOwn} */ (doc.own);
        const shows = [...new Set([...(own.shows || []).filter((p) => p !== drop), ...(add ? [add] : [])])];
        doc.own = { name: own.name, folder: own.folder, at: own.at, ...(shows.length ? { shows } : {}) };
        return shows;
      });
    },

    /**
     * A Space gone with its project (HarnessV4_SpacesPlugins_Plan A5, SP-D6): its file deleted and the store's copy
     * dropped, so nothing of it runs any more — its routines and its dashboards' watches are read from it — and said on
     * the stream. A Space never written is a no-op. → whether there was one.
     * @param {unknown} project @returns {boolean}
     */
    drop(project) {
      const id = idOf(project);
      const had = docs.has(id) || known().includes(id);
      docs.delete(id);
      dropped.add(id);
      above = null;
      if (dir) {
        rmSync(fileOf(id), { force: true });
        filed = null;
      }
      if (had) events?.publish("space", { type: "space", project: id, seq: 0, gone: true });
      return had;
    },

    /**
     * A Space whose project is gone (A5): every routine on and every dashboard kept is paused, each with a line saying
     * why, so nothing fires at its time where nobody sees it. Resume, should the project come back, is the person's.
     * → how many it paused.
     * @param {unknown} project @returns {number}
     */
    pauseGone(project) {
      const id = idOf(project);
      const doc = read(id);
      if (!doc.routines.some((r) => r.state === "on" && !r.paused) && !doc.dashboards.some((d) => d.state === "kept" && !d.paused)) return 0;
      return change(id, (d, at) => {
        /** @type {string[]} */
        const what = [];
        for (const r of d.routines)
          if (r.state === "on" && !r.paused) {
            r.paused = true;
            delete r.pausedBy;
            what.push(`the ${kindOf(r)} “${r.title}”`);
          }
        let kept = 0;
        for (const k of d.dashboards)
          if (k.state === "kept" && !k.paused) {
            k.paused = true;
            delete k.pausedBy;
            kept++;
          }
        if (kept) what.push(`${kept} dashboard${kept === 1 ? "" : "s"}`);
        const list = what.length === 1 ? what[0] : `${what.slice(0, -1).join(", ")} and ${what.at(-1)}`;
        said(d, at, `Filament paused ${list}: this Space's project was gone. Resume runs each again.`);
        return what.length - (kept ? 1 : 0) + kept;
      });
    },

    /** A new task on the board. @param {unknown} project @param {any} input @param {SpaceAuthor} by @returns {SpaceTask} */
    addTask(project, input, by) {
      const f = taskFields(input, { create: true });
      if (!f.ok) throw refused(400, f.error);
      return change(idOf(project), (doc, at) => {
        /** @type {SpaceTask} */
        const t = { id: `t${doc.seq}`, title: "", line: "", column: "planned", parked: false, chain: null, place: null, ...f.fields, by: authorOf(by), at, movedAt: at, startedAt: null, doneAt: null };
        const column = t.column;
        t.column = "planned";
        moveTo(t, column, at);
        doc.tasks.push(t);
        return t;
      });
    },

    /**
     * A task's fields changed — its column moved with the times that go with it —; with `order`, the ids of the column
     * it ends in top to bottom, where the person put it there (the board's drag).
     * @param {unknown} project @param {string} id @param {any} input @returns {SpaceTask}
     */
    changeTask(project, id, input) {
      const f = taskFields(input, { create: false });
      if (!f.ok) throw refused(400, f.error);
      const order = taskOrder(input.order, id);
      if (!order.ok) throw refused(400, order.error);
      return change(idOf(project), (doc, at) => {
        const t = taskIn(doc, id);
        const { column, ...rest } = f.fields;
        Object.assign(t, rest);
        if (column) moveTo(t, column, at);
        if (order.ids) rankTasks(doc, t, order.ids, at);
        return t;
      });
    },

    /** → the task removed, its files with it for the caller to forget. @param {unknown} project @param {string} id @returns {SpaceTask} */
    removeTask(project, id) {
      return change(idOf(project), (doc) => {
        const t = taskIn(doc, id);
        doc.tasks = doc.tasks.filter((x) => x !== t);
        return t;
      });
    },

    /**
     * A file attached to a task (the owner's of 11-02), its bytes kept already (services/space-files.js): refused past
     * the files a task holds or what the Space keeps in all.
     * @param {unknown} project @param {string} id @param {import("../core/space.js").SpaceFile} file
     * @returns {import("../core/space.js").SpaceFile}
     */
    taskFileAdd(project, id, file) {
      return change(idOf(project), (doc) => {
        const t = taskIn(doc, id);
        const files = t.files || [];
        if (files.length >= SPACE_FILES.files) throw refused(409, `“${t.title}” holds ${SPACE_FILES.files} files already: remove one first.`);
        const kept = doc.tasks.reduce((n, x) => n + (x.files || []).reduce((m, f) => m + f.bytes, 0), 0);
        if (kept + file.bytes > SPACE_FILES.spaceBytes) throw refused(409, `This Space keeps ${Math.round(SPACE_FILES.spaceBytes / 1048576)} MB of files at most: remove some first.`);
        t.files = [...files, file];
        return file;
      });
    },

    /** A task's file taken off it. → the file, for the caller to forget. @param {unknown} project @param {string} id @param {string} fileId */
    taskFileRemove(project, id, fileId) {
      return change(idOf(project), (doc) => {
        const t = taskIn(doc, id);
        const f = (t.files || []).find((x) => x.id === fileId);
        if (!f) throw refused(404, `“${t.title}” holds no such file.`);
        const rest = (t.files || []).filter((x) => x !== f);
        if (rest.length) t.files = rest;
        else delete t.files;
        return f;
      });
    },

    /**
     * The ids of the files a project's Space holds: the one it has, and every deleted one that may still come back —
     * what a sweep of the files leaves (services/space-files.js).
     * @param {unknown} project @returns {Set<string>}
     */
    filesHeld(project) {
      const id = idOf(project);
      /** @type {SpaceDoc[]} */
      const held = [];
      if (hasOne(id)) held.push(read(id));
      const since = now() - SPACE_BACK_MS;
      const b = bin.get(id);
      if (b && b.at >= since) held.push(b.doc);
      if (dir)
        for (const f of readdirSync(dir)) {
          const m = DELETED.exec(f);
          if (!m || m[1] !== id || Number(m[2]) < since) continue;
          held.push(shaped(JSON.parse(readFileSync(join(dir, f), "utf8"))));
        }
      return new Set(held.flatMap((d) => d.tasks.flatMap((t) => (t.files || []).map((f) => f.id))));
    },

    /** A chat takes a task: it is that chat's, in Doing. @param {unknown} project @param {string} id @param {string} chain @returns {SpaceTask} */
    takeTask(project, id, chain) {
      return change(idOf(project), (doc, at) => {
        const t = taskIn(doc, id);
        if (t.column === "done") throw refused(409, `"${t.title}" is done; add a task for what is left.`);
        t.chain = chain;
        t.place = null;
        t.parked = false;
        moveTo(t, "doing", at);
        return t;
      });
    },

    /**
     * A line in the logbook; `told`, the line by Sync's parts, by which a reader's words say it again (core/space.js
     * `logWords`). @param {unknown} project @param {unknown} text @param {SpaceAuthor} by @param {string | null} [task]
     * @param {import("../core/space.js").SyncTold | null} [told] @returns {SpaceEntry}
     */
    write(project, text, by, task = null, told = null) {
      const t = entryText(text);
      if (!t.ok) throw refused(400, t.error);
      return change(idOf(project), (doc, at) => {
        if (task) taskIn(doc, task);
        /** @type {SpaceEntry} */
        const e = { id: `e${doc.seq}`, at, by: authorOf(by), text: t.text, task: task || null, ...(told ? { told } : {}) };
        doc.log.push(e);
        return e;
      });
    },

    /**
     * Where each of a machine's Spaces that fed this one left off (the remote-agents plan's sp-cross), by its project
     * there: what its feed is asked since. @param {unknown} project @param {string} machine  its id
     * @returns {Record<string, import("../core/space.js").FeedCursor>}
     */
    fedFrom(project, machine) {
      /** @type {Record<string, import("../core/space.js").FeedCursor>} */
      const out = {};
      const head = fedKey(machine, "");
      for (const [k, c] of Object.entries(read(idOf(project)).fedFrom || {})) if (k.startsWith(head)) out[k.slice(head.length)] = c;
      return out;
    },

    /**
     * What a machine's feed of its Spaces of this repository brought (sp-cross), in one change (`fedInto`) — none where
     * it brought nothing new, so a feed with nothing to say writes nothing and wakes no open Space. → whether it wrote.
     * @param {unknown} project @param {{ machine: { id: string, name: string }, spaces: unknown, past?: unknown }} o
     *   `spaces` and `past`: the feed's
     */
    machineFed(project, { machine, spaces, past = 0 }) {
      const id = idOf(project);
      /** @param {SpaceDoc} doc @param {number} at */
      const into = (doc, at) => {
        let first = true;
        return fedInto(
          doc,
          machine,
          spaces,
          at,
          (p) => {
            if (!first) doc.seq++;
            first = false;
            return `${p}${doc.seq}`;
          },
          past,
        );
      };
      if (!into(structuredClone(read(id)), now())) return false;
      change(id, into);
      return true;
    },

    /**
     * A sync begun: its lanes, each waiting for its message, and what the person added.
     * @param {unknown} project @param {{ lanes: { chain: string, when: "now" | "after" }[], also: string }} o @returns {SpaceSync}
     */
    startSync(project, { lanes, also }) {
      return change(idOf(project), (doc, at) => {
        /** @type {SpaceSync} */
        const s = { id: `s${doc.seq}`, at, also, lanes: lanes.map((l) => ({ chain: l.chain, when: l.when, state: "waiting" })) };
        doc.syncs.push(s);
        return s;
      });
    },

    /** How a sync's message to one lane went. @param {unknown} project @param {string} sync @param {string} chain @param {{ state: SyncLane["state"], error?: string }} how */
    syncLane(project, sync, chain, how) {
      change(idOf(project), (doc, at) => {
        const lane = doc.syncs.find((s) => s.id === sync)?.lanes.find((l) => l.chain === chain);
        if (!lane) return;
        lane.state = how.state;
        lane.at = at;
        if (how.error) lane.error = how.error;
        else delete lane.error;
      });
    },

    /**
     * A dashboard kept in this Space at a version, with what that Keep grants (SG-D7, SG-D19) and the bytes of the
     * scripts it runs (`scripts`), and a line saying so. A dashboard is kept in one Space; kept here again, its watches
     * keep what they saw where they are the same.
     * @param {unknown} project
     * @param {{ name: string, v: number, grant: import("../core/dashboard-sources.js").Grant, scripts?: Record<string, string>, title: string }} o
     * @returns {import("../core/space.js").SpaceDashboard}
     */
    keepDashboard(project, { name, v, grant, scripts = {}, title }) {
      const id = idOf(project);
      const elsewhere = known().find((p) => p !== id && read(p).dashboards.some((d) => d.name === name && d.state === "kept"));
      if (elsewhere) throw refused(409, `${title} is kept in another project's Space; take it out there first.`);
      return change(id, (doc, at) => {
        const was = doc.dashboards.find((d) => d.name === name);
        const keys = new Set(grant.watch.map(watchKeyOf));
        /** @type {import("../core/space.js").SpaceDashboard} */
        // Its scripts' bytes, `{}` where its commands run none of the project's: a Keep with none is one an earlier
        // Filament made, which recorded none.
        const d = { name, state: "kept", v, grant, scripts, at, paused: was?.paused === true && was.state === "kept", seen: was?.state === "kept" ? Object.fromEntries(Object.entries(was.seen).filter(([k]) => keys.has(k))) : {} };
        // Kept again, it stays on Your Space's At a glance where you switched it there (S5b).
        if (was?.state === "kept" && was.glance === true) d.glance = true;
        // Paused by an agent, it stays paused as it said why.
        if (d.paused && was?.pausedBy) d.pausedBy = was.pausedBy;
        // A sends button you let agents press stays so while it is the same button; changed, they ask you again (10-29).
        const allowed = was?.state === "kept" ? (was.allowed || []).filter((n) => grant.actions[n]?.effect === "sends" && JSON.stringify(grant.actions[n]) === JSON.stringify(was.grant?.actions[n])) : [];
        if (allowed.length) d.allowed = allowed;
        doc.dashboards = [...doc.dashboards.filter((x) => x.name !== name), d];
        // Kept again while paused, it stays paused, as you left it: the line says so, not that it runs.
        const words = d.paused ? `it stays paused: once you resume it, ${runsWords(grant)}` : runsWords(grant);
        doc.log.push({ id: `e${doc.seq}`, at, by: { kind: "filament" }, text: `You kept “${title}” in this Space: ${words}.`, task: null, onlyHere: true });
        return d;
      });
    },

    /**
     * A dashboard paused or going on, or taken out of this Space: a kept one's line says so, and nothing of it runs. Taken
     * out, its newest version then is kept: a later one a chat publishes shows it again, as a draft.
     * `by`: a chat's agent that pauses it, with its line on why (HarnessV4_AgentsSpace_Plan SA-D3): kept on it, its bar
     * says who paused it and why, and What happened has the line as the chat's own; your Resume says whose pause it ends.
     * An agent's pause of one paused already is refused, naming who paused it.
     * @param {unknown} project @param {string} name
     * @param {{ paused?: boolean, removed?: boolean, title: string, v?: number,
     *   by?: { chain: string, name?: string | null, byName: string, line: string } | null }} o
     */
    dashboardChange(project, name, { paused, removed, title, v = 0, by = null }) {
      return change(idOf(project), (doc, at) => {
        const was = doc.dashboards.find((d) => d.name === name) || null;
        // Paused or out, nothing of it reads: a stopped source's row in Needs you goes; what its watches brought stays.
        if (removed || paused) doc.needs = doc.needs.filter((n) => !(n.kind === "source" && n.dashboard === name && n.state !== "done"));
        if (removed) {
          // What it was kept as goes with it — its way back (`dashboardBack`); taken out again, what it was before stays.
          const keptAs = was?.state === "kept" && was.grant ? keptAsOf(was) : (was?.was ?? null);
          doc.dashboards = [...doc.dashboards.filter((x) => x !== was), { name, state: "removed", v, grant: null, at, paused: false, seen: {}, was: keptAs }];
          if (was?.state === "kept") doc.log.push({ id: `e${doc.seq}`, at, by: { kind: "filament" }, text: `You took “${title}” out of this Space: nothing of it runs.`, task: null, onlyHere: true });
          return;
        }
        if (!was || was.state !== "kept") throw refused(409, `${title} is not kept in this Space: keep it first.`);
        if (paused === undefined) return;
        if (was.paused === paused) {
          if (by && paused) throw refused(409, `“${title}” is paused already, by ${was.pausedBy ? `${toReader(by.chain, was.pausedBy.chain, was.pausedBy.byName || "an agent")}: ${was.pausedBy.line}` : "the person"}.`);
          return;
        }
        was.paused = paused;
        if (paused && by) {
          was.pausedBy = { chain: by.chain, byName: by.byName, line: by.line };
          const text = `Paused “${title}”: ${by.line}`;
          doc.log.push({ id: `e${doc.seq}`, at, by: { kind: "agent", chain: by.chain, ...(by.name ? { name: by.name } : {}) }, text: entryText(text).ok ? text : text.slice(0, SPACE_LIMITS.text), task: null });
          return;
        }
        const had = was.pausedBy || null;
        delete was.pausedBy;
        saidNamed(doc, at, paused ? [`You paused “${title}”: nothing of it runs until you resume it.`] : had ? [`You resumed “${title}”, which `, { chain: had.chain, name: had.byName || "an agent" }, ` had paused: ${had.line}`] : [`You resumed “${title}”.`]);
      });
    },

    /**
     * A dashboard taken out of this Space put back as it was (its way back): kept at the version, with what that Keep
     * granted and the scripts' bytes it pinned — nothing more —, paused if it was, its watches knowing what they saw,
     * and a line saying so; one never kept shows again as a draft. Refused where it is not out, or is kept in another
     * Space now.
     * @param {unknown} project @param {string} name @param {string} title
     * @returns {import("../core/space.js").SpaceDashboard | null}  the kept record, or null for a draft
     */
    dashboardBack(project, name, title) {
      const id = idOf(project);
      const out = read(id).dashboards.find((d) => d.name === name);
      if (!out || out.state !== "removed") throw refused(409, `${title} is not taken out of this Space.`);
      const keptAs = out.was || null;
      if (keptAs && known().some((p) => p !== id && read(p).dashboards.some((d) => d.name === name && d.state === "kept")))
        throw refused(409, `${title} is kept in another project's Space; take it out there first.`);
      return change(id, (doc, at) => {
        doc.dashboards = doc.dashboards.filter((d) => d.name !== name);
        if (!keptAs) return null;
        /** @type {import("../core/space.js").SpaceDashboard} */
        const d = { name, state: "kept", v: keptAs.v, grant: keptAs.grant, ...(keptAs.scripts ? { scripts: keptAs.scripts } : {}), at: keptAs.at, paused: keptAs.paused, seen: keptAs.seen, ...(keptAs.glance === true ? { glance: true } : {}), ...(keptAs.paused && keptAs.pausedBy ? { pausedBy: keptAs.pausedBy } : {}) };
        doc.dashboards.push(d);
        doc.log.push({ id: `e${doc.seq}`, at, by: { kind: "filament" }, text: keptAs.paused ? `You put “${title}” back in this Space, paused as it was.` : `You put “${title}” back in this Space: ${runsWords(keptAs.grant)}.`, task: null, onlyHere: true });
        return d;
      });
    },

    /**
     * What one watch of a kept dashboard saw, and its lines in What happened (SG-D9) — or, where it goes to Needs you, a
     * row each there (S5a, S5-D1), the last saying how many more it counted —, in one change. Nothing is written where
     * it is no longer kept.
     * @param {unknown} project @param {string} name @param {string} key @param {import("../core/dashboard-sources.js").WatchSeen} seen
     * @param {string[]} lines @param {string} title
     * @param {{ to?: string, why?: string, more?: number }} [o]  `to`: where the watch writes; `why`: the rule that brought
     *   a row; `more`: how many it counted past its lines (whose last line, in What happened's words, says so)
     */
    watchSaw(project, name, key, seen, lines, title, { to = "what-happened", why = "", more = 0 } = {}) {
      const id = idOf(project);
      if (!read(id).dashboards.some((d) => d.name === name && d.state === "kept")) return;
      change(id, (doc, at) => {
        const d = doc.dashboards.find((x) => x.name === name && x.state === "kept");
        if (!d) return;
        d.seen[key] = seen;
        let first = true;
        const next = (/** @type {string} */ p) => {
          if (!first) doc.seq++;
          first = false;
          return `${p}${doc.seq}`;
        };
        const fit = (/** @type {string} */ text) => (entryText(text).ok ? text : text.slice(0, SPACE_LIMITS.text));
        if (to === "needs-you") {
          const rows = more ? lines.slice(0, -1) : lines;
          rows.forEach((text, i) => {
            const last = i === rows.length - 1;
            doc.needs.push({ id: next("n"), kind: "watch", text: fit(last && more ? `${text} · and ${more} more like it` : text), why, dashboard: name, title, watch: key, at, state: "open" });
          });
          return;
        }
        for (const text of lines) doc.log.push({ id: next("e"), at, by: { kind: "filament", name: title }, text: fit(text), task: null });
      });
    },

    /**
     * A kept dashboard's source stopped on its failures (S5a): one row in Needs you that says so, in the failure's words
     * — the one there already, if it is, says the newest.
     * @param {unknown} project @param {{ dashboard: string, title: string, source: string, error: string }} o
     */
    sourceStopped(project, { dashboard, title, source, error }) {
      const id = idOf(project);
      if (!read(id).dashboards.some((d) => d.name === dashboard && d.state === "kept")) return;
      change(id, (doc, at) => {
        const text = `${title} stopped reading ${source}: ${error}`.slice(0, SPACE_LIMITS.text);
        const had = doc.needs.find((n) => n.kind === "source" && n.dashboard === dashboard && n.source === source && n.state !== "done");
        if (had) return void Object.assign(had, { text, title, at });
        doc.needs.push({ id: `n${doc.seq}`, kind: "source", text, why: `a kept dashboard's source failed ${FAILS_TO_STOP} times in a row`, dashboard, title, source, at, state: "open" });
      });
    },

    /**
     * A source that reads well again, or that waits for the person's Keep — no failure of it —: its stopped row goes (it
     * said a state, now past). Nothing is written where there is none.
     * @param {unknown} project @param {string} dashboard @param {string} source
     */
    sourceRead(project, dashboard, source) {
      const id = idOf(project);
      const mine = (/** @type {import("../core/space.js").NeedRow} */ n) => n.kind === "source" && n.dashboard === dashboard && n.source === source && n.state !== "done";
      if (!read(id).needs.some(mine)) return;
      change(id, (doc) => {
        doc.needs = doc.needs.filter((n) => !mine(n));
      });
    },

    /**
     * A row of Needs you done, put off until a moment (Not now), or brought back (S5a): its way back from either. A draft
     * (S5c) is discarded — its done —, and its words changed while it waits (`words`: the person's edits, kept); a sent
     * one has no way back: what left this machine is not Filament's to call back. An ask (E42 SA-D7) is turned down
     * (`turnDown`), What happened telling its chat, and Bring back undoes that; one its press answered, or whose thing
     * moved, has its own way back — the thing's —, not Bring back.
     * @param {unknown} project @param {string} row
     * @param {{ done?: boolean, discard?: boolean, later?: number, back?: boolean, words?: unknown, turnDown?: boolean }} o
     * @returns {import("../core/space.js").NeedRow}
     */
    needChange(project, row, o) {
      const id = idOf(project);
      return change(id, (doc, at) => {
        const n = doc.needs.find((x) => x.id === String(row ?? ""));
        if (!n) throw refused(404, `There is no row "${String(row ?? "").slice(0, 40)}" in this Space's Needs you.`);
        const draft = n.kind === "draft" ? n.draft : null;
        const gone = draft && n.state === "done" ? (n.outcome === "sent" ? "It was sent" : "It is discarded") : "";
        const ask = n.kind === "ask" ? n.ask : null;
        // Another machine's row is dealt with there (sp-cross): Done dismisses it here alone, and one closed there comes
        // back here as it opens there again.
        const there = n.kind === "machine" ? n.machine : null;
        if (there && o.later !== undefined) throw refused(400, `a row of ${there.name || "another machine"}'s Space is dealt with there: Done dismisses it here`);
        if (there && o.back === true && there.closed)
          throw refused(409, `It is ${there.gone ? `no longer in ${there.name || "its machine"}'s Spaces` : `put off or closed on ${there.name || "its machine"}`}: it comes back here once it is open there again.`);
        if (o.turnDown === true) {
          if (!ask) throw refused(400, "only an ask is turned down: a row is done ({ done: true })");
          if (n.state === "done") throw refused(409, `It is ${ask.ended || "done"} already.`);
          endAsk(doc, n, at, "turned down");
          return n;
        }
        if (ask && (o.done === true || o.discard === true)) throw refused(400, "an ask is answered by its press, or turned down ({ turnDown: true })");
        if (ask && o.back === true && n.state === "done" && ask.ended !== "turned down")
          throw refused(409, ask.ended === "moved" ? `It went by itself: ${ask.moved || "its thing moved"}. Ask its chat again if it is still wanted.`
            : ask.ended === "taken back" ? `${ask.byName || "Its chat"} took it back: it asks again if it is still wanted.`
            : `It was ${ask.ended}: its way back is the thing's own.`);
        // The person's Done or Bring back: another machine's row is no longer one the open rows' limit closed.
        if (there && (o.done === true || o.back === true)) delete there.capped;
        if (o.done === true || o.discard === true) {
          if (o.discard === true && !draft) throw refused(400, "only a draft is discarded: a row is done ({ done: true })");
          if (gone) throw refused(409, `${gone} already.`);
          n.state = "done";
          n.doneAt = at;
          delete n.until;
          delete n.doneBy;
          if (draft) n.outcome = "discarded";
        } else if (o.words !== undefined) {
          if (!draft) throw refused(400, "only a draft has words to change");
          if (gone) throw refused(409, `${gone}: its words stay as they were.`);
          const words = String(o.words ?? "").replace(/\r\n?/g, "\n").trim();
          if (!words) throw refused(400, "a draft's words cannot be empty: Discard it instead");
          if (words.length > DRAFT_LIMITS.words) throw refused(400, `a draft's words are ${DRAFT_LIMITS.words} characters at most; these are ${words.length}`);
          draft.words = words;
        } else if (o.later !== undefined) {
          const until = Number(o.later);
          if (!Number.isFinite(until) || until <= at || until > at + LATER_MAX_MS) throw refused(400, "later is when it comes back: a moment within the next 8 days");
          n.state = "later";
          n.until = until;
          delete n.doneAt;
        } else if (o.back === true) {
          if (draft && n.outcome === "sent") throw refused(409, "It was sent: what left this machine cannot be brought back from here. Ask its chat for a new draft.");
          // One an agent closed: the logbook says whose done the person undid (E42, the Designer's second pass).
          if (n.state === "done" && n.doneBy) {
            saidNamed(doc, at, [`Brought back “${n.text}”, which `, { chain: n.doneBy.chain, name: n.doneBy.byName || "an agent" }, " had marked done."], { kind: "you" });
          }
          n.state = "open";
          delete n.until;
          delete n.doneAt;
          delete n.outcome;
          delete n.doneBy;
          if (ask) {
            delete ask.ended;
            delete ask.moved;
          }
          // The newest the trim knows of: past 100 open, another goes to Done today, not the one you brought back.
          doc.needs = [...doc.needs.filter((x) => x !== n), n];
        } else throw refused(400, "say what to do: { done: true }, { later: <when it comes back> }, { back: true } — and for a draft { discard: true } or { words }");
        return n;
      });
    },

    /**
     * A row an agent marked done, with its line on what it did (HarnessV4_AgentsSpace_Plan SA-D5): any open or put-off
     * row of its project but a draft — the person's to send or discard, or its own chat's to discard. Done today keeps
     * who closed it and the line; What happened gets the chat's own line. Bring back undoes it, as any done.
     * @param {unknown} project @param {unknown} row
     * @param {{ chain: string, name?: string | null, byName: string, line: string }} by  the chat, a helper's own name
     *   where it is one, who it is in words, and its line (checked by the caller)
     * @returns {import("../core/space.js").NeedRow}
     */
    needDoneBy(project, row, { chain, name = null, byName, line }) {
      return change(idOf(project), (doc, at) => {
        const n = doc.needs.find((x) => x.id === String(row ?? ""));
        if (!n) throw refused(404, `There is no row "${String(row ?? "").slice(0, 40)}" in this Space's Needs you.`);
        if (n.state === "done") throw refused(409, `${n.id} is done already${n.doneBy ? `, by ${toReader(chain, n.doneBy.chain, n.doneBy.byName || "an agent")}: ${n.doneBy.line}` : ""}.`);
        if (n.kind === "ask" && n.ask) {
          if (n.ask.chain === chain) throw refused(400, `${n.id} is your ask: the person answers it with its press, or turns it down — {"action":"needs","with":{"id":"${n.id}","discard":true}} takes it back.`);
          throw refused(403, `${n.id} is ${toReader(chain, n.ask.chain, n.ask.byName || "another chat")}'s ask: the person answers it, or ${toReader(chain, n.ask.chain, n.ask.byName || "that chat")} takes it back.`);
        }
        if (n.kind === "draft" && n.draft) {
          if (n.draft.chain === chain) throw refused(400, `${n.id} is your draft: a draft is sent or discarded, not done — {"action":"needs","with":{"id":"${n.id}","discard":true}} discards it.`);
          const whose = toReader(chain, n.draft.chain, n.draft.byName || "another chat");
          throw refused(403, `${n.id} is ${whose}'s draft: the person sends or discards it, or ${whose} does.`);
        }
        n.state = "done";
        n.doneAt = at;
        delete n.until;
        n.doneBy = { chain, byName, line };
        const text = `Marked “${n.text}” done: ${line}`;
        doc.log.push({ id: `e${doc.seq}`, at, by: { kind: "agent", chain, ...(name ? { name } : {}) }, text: entryText(text).ok ? text : text.slice(0, SPACE_LIMITS.text), task: null });
        return n;
      });
    },

    /**
     * An agent's ask for a press that is the person's (E42 SA-D7): a row of Needs you, its title the press in its
     * sheet's words, the asker and its reason under it, and the chat's line in What happened. One open ask per thing and
     * chat: the same chat asking again for the same thing opens its old row again, with the new reason — as a second
     * repro does. What it asks for is checked by the caller (app/agent/space.js), as it stands now.
     * @param {unknown} project @param {import("../core/space.js").Ask} ask @param {string} title  the thing's title
     * @param {{ name?: string | null }} [o]  a helper's own name, for What happened
     * @returns {import("../core/space.js").NeedRow}
     */
    askWrite(project, ask, title, { name = null } = {}) {
      return change(idOf(project), (doc, at) => {
        const text = askTitle(ask, title);
        const was = doc.needs.find((x) => x.kind === "ask" && x.ask?.chain === ask.chain && askKey(x.ask) === askKey(ask));
        /** @type {import("../core/space.js").NeedRow} */
        let n;
        if (was) {
          Object.assign(was, { text, title, ask, dashboard: ask.dashboard || "", at, state: "open" });
          delete was.until;
          delete was.doneAt;
          n = was;
          doc.needs = [...doc.needs.filter((x) => x !== was), was];
        } else {
          n = { id: `n${doc.seq}`, kind: "ask", text, why: "", dashboard: ask.dashboard || "", title, ask, at, state: "open" };
          doc.needs.push(n);
        }
        // A Tell's chats kept apart: another chat's agent reads them by its own names.
        const line = ask.what === "tell" ? ["Asks you to ", ...askPressParts(askTitleParts(ask, title)), `: “${ask.why}”`] : [`Asks you to ${askPress(text)}: ${ask.why}`];
        saidNamed(doc, at, line, { kind: "agent", chain: ask.chain, ...(name ? { name } : {}) });
        return n;
      });
    },

    /**
     * An ask taken back by the chat that asked (E42, case 4): to Done today, no Bring back; its line in What happened.
     * Another chat's is refused: the person answers it, or its chat takes it back.
     * @param {unknown} project @param {string} row @param {{ chain: string, name?: string | null }} by
     * @returns {import("../core/space.js").NeedRow}
     */
    askTakeBack(project, row, { chain, name = null }) {
      return change(idOf(project), (doc, at) => {
        const n = doc.needs.find((x) => x.id === String(row ?? ""));
        if (!n?.ask) throw refused(404, `There is no ask "${String(row ?? "").slice(0, 40)}" in this Space's Needs you.`);
        if (n.ask.chain !== chain) throw refused(403, `${n.id} is ${toReader(chain, n.ask.chain, n.ask.byName || "another chat")}'s ask: the person answers it, or ${toReader(chain, n.ask.chain, n.ask.byName || "that chat")} takes it back.`);
        if (n.state === "done") throw refused(409, `${n.id} is ${n.ask.ended === "moved" ? `gone by itself: ${n.ask.moved}` : n.ask.ended || "done"} already.`);
        endAsk(doc, n, at, "taken back", { name });
        return n;
      });
    },

    /**
     * The asks whose press was done — there or anywhere — or whose thing moved under them (E42 SA-D7, the Designer):
     * each to Done today by itself, one that moved with a line in What happened. `dashboards`: the Space's as its runner
     * shows them, null where none is wired (an ask about a dashboard is let be then). → the rows that went.
     * @param {unknown} project
     * @param {readonly { name: string, state: string, v: number, keptV: number | null, paused: boolean }[] | null} [dashboards]
     * @returns {import("../core/space.js").NeedRow[]}
     */
    asksSettle(project, dashboards = null) {
      const id = idOf(project);
      const doc0 = read(id);
      const now0 = { dashboards: dashboards || [], routines: doc0.routines, pausedSince: pausedSince() };
      const ends = doc0.needs
        .filter((n) => n.kind === "ask" && n.ask && n.state !== "done" && (dashboards || !(n.ask.dashboard)))
        .map((n) => ({ id: n.id, e: askNow(/** @type {import("../core/space.js").Ask} */ (n.ask), now0) }))
        .filter((x) => x.e);
      if (!ends.length) return [];
      return change(id, (doc, at) =>
        ends.flatMap(({ id: row, e }) => {
          const n = doc.needs.find((x) => x.id === row && x.state !== "done");
          if (!n?.ask || !e) return [];
          endAsk(doc, n, at, e.ended, { moved: e.moved });
          return [n];
        }),
      );
    },

    /**
     * The open asks to tell that a sync carries (E42, case 21b): their words, with who asked. Refused where one is no open
     * ask to tell of this Space. @param {unknown} project @param {string[]} rows
     * @returns {{ id: string, chain: string, byName: string, words: string }[]}
     */
    tellAsks(project, rows) {
      const doc = read(idOf(project));
      return rows.map((row) => {
        const n = doc.needs.find((x) => x.id === row);
        if (!n?.ask || n.ask.what !== "tell" || n.state === "done") throw refused(409, `${String(row).slice(0, 40)} is no open ask to tell the chats in this Space.`);
        return { id: n.id, chain: n.ask.chain, byName: n.ask.byName, words: n.ask.why };
      });
    },

    /** The asks to tell a sync carried, told (E42, case 21b): each to Done today. @param {unknown} project @param {string[]} rows */
    asksTold(project, rows) {
      if (!rows.length) return;
      change(idOf(project), (doc, at) => {
        for (const n of doc.needs) if (rows.includes(n.id) && n.ask?.what === "tell" && n.state !== "done") endAsk(doc, n, at, "told");
      });
    },

    /**
     * A draft an agent wrote (S5c): a row of Needs you, waiting for the person's Send. With `row`, a draft of the same
     * chat that still waits, rewritten (Ask for a change…); another chat's, or one sent or discarded, is refused
     * (S5c-D3).
     * @param {unknown} project
     * @param {Extract<ReturnType<typeof import("../core/space.js").draftFields>, { ok: true }>["fields"]} fields  as core's
     *   `draftFields` checked them
     * @param {{ chain: string, byName: string, account: string }} by  the chat that wrote it, and the account it sends as
     * @param {string | null} [row]
     * @returns {import("../core/space.js").NeedRow}
     */
    writeDraft(project, fields, { chain, byName, account }, row = null) {
      return change(idOf(project), (doc, at) => {
        const { title, ...rest } = fields;
        /** @type {import("../core/space.js").Draft} */
        const draft = { ...rest, chain, byName, account };
        if (row) {
          const n = doc.needs.find((x) => x.id === row);
          if (!n?.draft) throw refused(404, `There is no draft "${row.slice(0, 40)}" in this Space: its drafts' ids are in the space tool's read.`);
          if (n.draft.chain !== chain) throw refused(409, `${row} is ${toReader(chain, n.draft.chain, n.draft.byName || "another chat")}'s draft: write one of your own.`);
          if (n.state === "done") throw refused(409, `${row} was ${n.outcome === "sent" ? "sent" : "discarded"}: write a new draft.`);
          Object.assign(n, { text: title, draft, at, state: "open" });
          delete n.until;
          return n;
        }
        /** @type {import("../core/space.js").NeedRow} */
        const n = { id: `n${doc.seq}`, kind: "draft", text: title, why: "", dashboard: "", title: "Draft", draft, at, state: "open" };
        doc.needs.push(n);
        return n;
      });
    },

    /**
     * A draft sent (S5c): to Done today as sent, with its words as they went and as which account, and a line in What
     * happened — what was sent, through what, and the first link the tool's answer gave.
     * @param {unknown} project @param {string} row @param {{ words: string, as: string, link: string | null }} o
     * @returns {import("../core/space.js").NeedRow}
     */
    draftSent(project, row, { words, as, link }) {
      return change(idOf(project), (doc, at) => {
        const n = doc.needs.find((x) => x.id === row);
        if (!n?.draft) throw refused(404, `There is no draft "${String(row).slice(0, 40)}" in this Space.`);
        n.state = "done";
        n.doneAt = at;
        n.outcome = "sent";
        delete n.until;
        n.draft.words = words;
        n.draft.sent = { as, link };
        const text = `You sent “${n.text}” through ${n.draft.connection} › ${n.draft.tool}${as ? ` as ${as}` : ""}${link ? `: ${link}` : "."}`;
        doc.log.push({ id: `e${doc.seq}`, at, by: { kind: "filament" }, text: entryText(text).ok ? text : text.slice(0, SPACE_LIMITS.text), task: null });
        return n;
      });
    },

    /**
     * What an agent asked to reproduce a report found (S7-D3, D4): a row of Needs you — "Reproduced: …" or "Couldn't
     * reproduce: …" — and a line in What happened. One per chat: the chat's second report takes its first one's row,
     * open again, so a lane has one result.
     * @param {unknown} project
     * @param {Extract<ReturnType<typeof import("../core/space.js").reproFields>, { ok: true }>["fields"]} fields  as core's
     *   `reproFields` checked them
     * @param {{ chain: string, byName: string, cwd: string }} by  the chat that sent it, who, and its folder: the lane
     * @returns {import("../core/space.js").NeedRow}
     */
    writeRepro(project, fields, { chain, byName, cwd }) {
      return change(idOf(project), (doc, at) => {
        const { title, ...rest } = fields;
        /** @type {import("../core/space.js").Repro} */
        const repro = { ...rest, chain, byName, cwd };
        const text = `${repro.reproduced ? "Reproduced" : "Couldn't reproduce"}: ${title}`;
        const was = doc.needs.find((x) => x.kind === "repro" && x.repro?.chain === chain);
        /** @type {import("../core/space.js").NeedRow} */
        let n;
        if (was) {
          Object.assign(was, { text, title, repro, at, state: "open" });
          delete was.until;
          delete was.doneAt;
          n = was;
        } else {
          n = { id: `n${doc.seq}`, kind: "repro", text, why: "", dashboard: "", title, repro, at, state: "open" };
          doc.needs.push(n);
        }
        const asks = repro.questions.length ? `, with ${repro.questions.length} question${repro.questions.length === 1 ? "" : "s"} for the reporter` : "";
        const who = { chain, name: byName };
        saidNamed(doc, at, repro.reproduced
          ? [who, ` reproduced “${title}”: ${repro.test} fails (${repro.run}).`]
          : [who, ` could not reproduce “${title}”: it tried ${repro.tried.length} way${repro.tried.length === 1 ? "" : "s"}${asks}.`]);
        return n;
      });
    },

    /**
     * A kept dashboard shown on Your Space's At a glance or not (S5b, S5-D7): a view's choice, so no line in What
     * happened. Refused where it is not kept here.
     * @param {unknown} project @param {string} name @param {boolean} on @param {string} title
     * @returns {import("../core/space.js").SpaceDashboard}
     */
    dashboardGlance(project, name, on, title) {
      return change(idOf(project), (doc) => {
        const d = doc.dashboards.find((x) => x.name === name && x.state === "kept");
        if (!d) throw refused(409, `${title} is not kept in this Space: keep it first.`);
        if (on) d.glance = true;
        else delete d.glance;
        return d;
      });
    },

    /**
     * A kept one's `sends` button an agent may press without asking the person, or asks again (the Space Apps plan of
     * 10-29): the person's word alone, and a line in What happened, as it changes what agents may do unasked.
     * @param {unknown} project @param {string} name @param {string} action @param {boolean} on
     * @param {{ title: string, label: string }} words
     * @returns {import("../core/space.js").SpaceDashboard}
     */
    dashboardAllow(project, name, action, on, { title, label }) {
      return change(idOf(project), (doc, at) => {
        const d = doc.dashboards.find((x) => x.name === name && x.state === "kept");
        if (!d) throw refused(409, `${title} is not kept in this Space: keep it first.`);
        const now = new Set(d.allowed || []);
        if (now.has(action) === on) return d;
        if (on) now.add(action);
        else now.delete(action);
        if (now.size) d.allowed = [...now];
        else delete d.allowed;
        const text = on ? `You let agents press “${label}” on ${title} without asking you, though it sends.` : `Agents ask you again before they press “${label}” on ${title}.`;
        saidHere(doc, at, text);
        return d;
      });
    },

    /**
     * A pull set up or changed from its sheet (the Space Apps plan of 10-29): a new one, `p<seq>`, while the board has
     * fewer than `PULL_LIMITS.pulls`, which What happened says with what it reads through; or the one of that id — its
     * cards moved on the board kept while it reads the same tool the same way and names its cards by the same key. Its
     * sheet's Always is the switch's word (`alwaysSet`): What happened says it as it changes, on or off.
     * @param {unknown} project @param {any} input @returns {import("../core/space-pulls.js").SpacePull}
     */
    pullSave(project, input) {
      const fault = pullFault(input);
      if (fault) throw refused(400, fault);
      return change(idOf(project), (doc, at) => {
        const pulls = doc.pulls || [];
        const was = input.id ? pullIn(doc, input.id) : null;
        if (!was && pulls.length >= PULL_LIMITS.pulls) throw refused(409, `A board pulls from ${PULL_LIMITS.pulls} services at most: remove one first.`);
        const same = !!was && was.connection === input.connection.trim() && was.tool === input.tool.trim() && JSON.stringify(was.args) === JSON.stringify(input.args) && was.key === String(input.key).trim();
        const kept = pullKept({ ...input, id: was ? was.id : `p${doc.seq}`, at: was ? was.at : at, always: !!was?.always, moved: same && was ? was.moved : {} });
        if (!kept) throw refused(400, "it does not read as a pull");
        if (was) pulls[pulls.indexOf(was)] = kept;
        else {
          pulls.push(kept);
          said(doc, at, `You pulled ${kept.title}'s issues onto the board, read through ${kept.connection} › ${kept.tool}.`);
        }
        doc.pulls = pulls;
        // Always as its sheet leaves it, set as its switch sets it: refused where the pull keeps no way back, and a line
        // of its own where it changes (a save wrote it past both, and nothing said a move now went back unasked).
        const always = input.always === true;
        if (kept.always !== always) {
          if (doc.log.some((e) => e.id === `e${doc.seq}`)) doc.seq++;
          alwaysSet(doc, at, kept, always);
        }
        return kept;
      });
    },

    /** A pull taken off the board: its cards go from it; nothing changes in its service. @param {unknown} project @param {string} id */
    pullRemove(project, id) {
      change(idOf(project), (doc, at) => {
        const p = pullIn(doc, id);
        const left = (doc.pulls || []).filter((x) => x !== p);
        if (left.length) doc.pulls = left;
        else delete doc.pulls;
        said(doc, at, `You took ${p.title}'s pull off the board: its cards went from it, and nothing changed in ${p.title}.`);
      });
    },

    /**
     * A pull's card moved on the board: it stands in its column while the service says `from` — the state it has, or
     * the one the move set there (`went`), which What happened says. `always`: the person's Always for this board, set
     * with the move. The moved cards no longer standing go, by the rows read last.
     * @param {unknown} project @param {string} id @param {string} key
     * @param {{ column: import("../core/space.js").Column, from: string, went?: string | null, always?: boolean }} move
     * @param {readonly import("../core/space-pulls.js").PullRow[]} rows
     * @returns {import("../core/space-pulls.js").SpacePull}
     */
    pullMoved(project, id, key, { column, from, went = null, always }, rows) {
      if (!isColumn(column)) throw refused(400, "a card moves to planned, doing, waits or done");
      return change(idOf(project), (doc, at) => {
        const p = pullIn(doc, id);
        const moved = movedKept(p, rows, at);
        delete moved[key];
        moved[key] = { column, from, at };
        p.moved = Object.fromEntries(Object.entries(moved).slice(-PULL_LIMITS.moved));
        if (went) said(doc, at, movedWords(p, key, went));
        if (always !== undefined) {
          if (went && doc.log.some((e) => e.id === `e${doc.seq}`)) doc.seq++;
          alwaysSet(doc, at, p, always);
        }
        return p;
      });
    },

    /** A pull's moves going back without asking, or asking again. @param {unknown} project @param {string} id @param {boolean} on */
    pullAlways(project, id, on) {
      return change(idOf(project), (doc, at) => {
        const p = pullIn(doc, id);
        alwaysSet(doc, at, p, on);
        return p;
      });
    },

    /**
     * Every project's Needs you rows as Your Space shows them (S5b): each Space's `needsShown`, with its project.
     * @param {number} at @returns {(import("../core/space.js").NeedRow & { project: string })[]}
     */
    needsAll(at) {
      return known().flatMap((project) => needsShown(read(project).needs, at).map((n) => ({ ...n, project })));
    },

    /**
     * Each project's open rows in Needs you — a row put off whose moment came is open again —, where it has any: what
     * the left bar's Your Space row counts beside the chats'.
     * @param {number} at @returns {Record<string, number>}
     */
    needCounts(at) {
      /** @type {Record<string, number>} */
      const out = {};
      for (const id of known()) {
        const n = needsShown(read(id).needs, at).filter((x) => x.state === "open").length;
        if (n) out[id] = n;
      }
      return out;
    },

    /**
     * The soonest moment after `at` when what Needs you says changes by itself — a row put off comes back, a done one
     * leaves Done —, or null: nothing is written then, so a page that counts asks again at it (found by the Hunter on
     * S5a: the left bar's count stayed as it was past a row's moment).
     * @param {number} at @returns {number | null}
     */
    needsNext(at) {
      let next = Infinity;
      for (const id of known())
        for (const n of read(id).needs) {
          const when = n.state === "later" ? (n.until ?? 0) : n.state === "done" ? (n.doneAt ?? 0) + NEEDS_DONE_SHOWN_MS : 0;
          if (when > at && when < next) next = when;
        }
      return Number.isFinite(next) ? next : null;
    },

    /**
     * Whether Your Space shows (S5-D6, SG-D0): a Space keeps a dashboard or a routine (S6), or holds a row of its own in
     * Needs you — one whose dashboard went stays where you can reach it. `known`: whether a project is known.
     * @param {number} at @param {{ known?: ((project: string) => boolean) | null }} [o]
     */
    extended(at, { known: isKnown = null } = {}) {
      // A Space left by a project gone counts for nothing: Home would show with nothing in it (found by the Hunter on A5).
      return known().some((id) => {
        if (isKnown && !isKnown(id)) return false;
        const doc = read(id);
        return doc.dashboards.some((d) => d.state === "kept") || doc.routines.some((r) => r.state !== "removed") || needsShown(doc.needs, at).length > 0;
      });
    },

    /**
     * A line in What happened about what a dashboard's button did (S3): Filament's, or the chat's whose agent pressed it
     * (HarnessV4_AgentsSpace_Plan SA-D4). @param {unknown} project @param {string} text @param {SpaceAuthor} [by]
     */
    dashboardSaid(project, text, by = { kind: "filament" }) {
      return change(idOf(project), (doc, at) => {
        doc.log.push({ id: `e${doc.seq}`, at, by: authorOf(by), text: entryText(text).ok ? text : text.slice(0, SPACE_LIMITS.text), task: null });
      });
    },

    /**
     * An agent's check of what a dashboard's button did, ended (HarnessV4_Space_Plan S5d): its verdict in What happened —
     * "An agent checked “Roll back to this…” on Deploys: it did not work — the row still says 0%" —, and where it says
     * it did not work, a row in Needs you (kind *check*) with what ran and why. A check stopped or cut off says so, and
     * leaves no row.
     * @param {unknown} project
     * @param {{ dashboard: string, title: string, label: string, ran: string, said: string,
     *   verdict: "worked" | "failed" | "unclear" | "none", reason: string, stopped?: boolean, agent?: string }} o  `none`:
     *   it gave no verdict — `stopped`, or `reason` says why; `agent`: the check it ends, kept under way since it began
     */
    checkSaid(project, { dashboard, title, label, ran, said, verdict, reason, stopped = false, agent = "" }) {
      const why = reason.replace(/\s+/g, " ").trim();
      const fit = (/** @type {string} */ text) => (entryText(text).ok ? text : text.slice(0, SPACE_LIMITS.text));
      const text = verdict === "none"
        ? stopped ? `You stopped the agent's check of “${label}” on ${title}.` : `The agent's check of “${label}” on ${title} did not finish: ${why || "it said nothing"}`
        : `An agent checked “${label}” on ${title}: ${verdict === "worked" ? "it worked" : verdict === "failed" ? "it did not work" : "it could not tell"}${why ? ` — ${why}` : "."}`;
      return change(idOf(project), (doc, at) => {
        if (agent) doc.checking = doc.checking.filter((c) => c.agent !== agent);
        // Its words name the dashboard: no name before them (seen live: "Deploys: … on Deploys").
        doc.log.push({ id: `e${doc.seq}`, at, by: { kind: "filament" }, text: fit(text), task: null });
        if (verdict === "failed")
          doc.needs.push({ id: `n${doc.seq}`, kind: "check", text: fit(`“${label}” on ${title} did not do what it was for`), why: fit(`an agent checked it: ${why || "it did not work"}`), dashboard, title, check: { label, ran, said, reason: why }, at, state: "open" });
      });
    },

    /**
     * An agent's check of a button begun (S5d): kept under way until `checkSaid` ends it, so a restart that cuts it says
     * so (`checksCut`; found by the Hunter on S5d: a check in flight at a restart never said anything).
     * @param {unknown} project @param {Omit<import("../core/space.js").Checking, "at">} c
     */
    checkStarted(project, c) {
      return change(idOf(project), (doc, at) => {
        doc.checking = [...doc.checking.filter((x) => x.agent !== c.agent), { ...c, at }].slice(-CHECKING_MAX);
      });
    },

    /**
     * The checks a restart cut (S5d): each kept under way and not followed now (`live`) ends with its line — "did not
     * finish: Filament stopped before it ended" —, and no row: what its button did stays as it ran. Their projects.
     * @param {(agent: string) => boolean} [live]  a check this Filament still waits on
     * @returns {string[]}
     */
    checksCut(live = () => false) {
      /** @type {string[]} */
      const cut = [];
      for (const project of known()) {
        const gone = read(project).checking.filter((c) => !live(c.agent));
        for (const c of gone)
          store.checkSaid(project, { dashboard: c.dashboard, title: c.title, label: c.label, ran: c.ran, said: c.said, verdict: "none", reason: "Filament stopped before it ended", agent: c.agent });
        if (gone.length) cut.push(project);
      }
      return cut;
    },

    /** Every dashboard kept in a Space, with its project: what runs by itself. @returns {{ project: string, d: import("../core/space.js").SpaceDashboard }[]} */
    keptDashboards() {
      return known().flatMap((project) => read(project).dashboards.filter((d) => d.state === "kept").map((d) => ({ project, d })));
    },

    /**
     * A routine an agent proposes, or changes (HarnessV4_Space_Plan S6, S6-D1): a new one is Proposed — it runs only once
     * the person switches it on —, with its chat's line in What happened. With `id`, the chat's own is changed; one on goes
     * back to Proposed, off, and its line says so (S6-D3); the model the person chose for it stays (the owner's word of
     * 10-31), where none chosen takes the chat's now. Another chat's, or one removed, is refused. A watcher (the plan of
     * 11-11) stays one, and a routine at times one: each is refused the other's fields, and so is a record whose fields
     * cannot stand together (core's `routineClash`), a change's laid over what is kept. Its line says whom it wakes and
     * what that may do, the chats it names — the one it watches, the one it wakes — kept apart (`named`), the watched by
     * `nameOf`'s name.
     * @param {unknown} project
     * @param {Partial<Pick<import("../core/routines.js").Routine, "title" | "when" | "task" | "writes" | "acts" | "trigger" | "wakes" | "guides">>} fields
     *   as core's `routineFields` checked them: all of them for a new one
     * @param {{ chain: string, byName: string, model: string, nameOf?: (chain: string) => string }} by  the chat that
     *   proposes it, its name, its model now, and how it names the chats
     * @param {string | null} [id]
     * @returns {import("../core/routines.js").Routine}
     */
    routinePropose(project, fields, { chain, byName, model, nameOf = () => "a chat of this project" }, id = null) {
      return change(idOf(project), (doc, at) => {
        /** @type {SpaceAuthor} */
        const by = { kind: "agent", chain };
        if (id) {
          const r = routineOf(doc, id);
          if (r.madeIn !== chain) throw refused(409, `${r.id} is ${toReader(chain, r.madeIn, r.madeBy || "another chat")}'s routine: propose one of your own.`);
          if (r.state === "removed") throw refused(409, `${r.id} was removed by the person: propose a new one if it is still wanted.`);
          if (r.trigger && fields.when !== undefined) throw refused(409, `“${r.title}” is a watcher: it wakes on events, not at times. Change its trigger, or propose a routine.`);
          if (!r.trigger && (fields.trigger || fields.wakes)) throw refused(409, `“${r.title}” runs at its times: propose a watcher of its own for events.`);
          const wasOn = r.state === "on";
          // Its fields by name, as core checked them: nothing else an object handed here holds reaches the routine.
          /** @type {Partial<import("../core/routines.js").Routine>} */
          const given = {};
          for (const k of ROUTINE_FIELDS) if (fields[k] !== undefined) /** @type {any} */ (given)[k] = fields[k];
          // What the change makes of it must stand together (core's `routineClash`): asked before anything is changed.
          const clash = routineClash({ ...r, ...given });
          if (clash) throw refused(409, `“${r.title}”: ${clash}.`);
          Object.assign(r, given);
          if (!r.guides) delete r.guides;
          Object.assign(r, { madeBy: byName, model: r.modelBy === "you" ? r.model : model || r.model, at });
          if (wasOn) Object.assign(r, { state: "proposed", onAt: null, upTo: null, paused: false }, r.trigger ? { seen: null, pending: null } : {});
          // What its Switch on approved by content was approved of what it was: the next press approves what it is.
          delete r.script;
          dropGuides(doc, at, r, "was changed by its chat");
          // Where its Switch on is: a watcher's on the Space's Watchers page, a routine's on Routines.
          if (wasOn) said(doc, at, r.trigger ? `Changed the watcher “${r.title}”: it is off until you switch it on again, in Watchers.` : `Changed the routine “${r.title}”: it is off until you switch it on again, in Routines.`, by);
          else if (r.trigger) saidNamed(doc, at, [`Changed its proposed watcher “${r.title}”: `, ...triggerParts(r.trigger, nameOf), "."], by);
          else said(doc, at, `Changed its proposed routine “${r.title}”: ${whenOf(r)}.`, by);
          return r;
        }
        if (doc.routines.filter((x) => x.state !== "removed").length >= ROUTINE_LIMITS.routines)
          throw refused(409, `this Space holds ${ROUTINE_LIMITS.routines} routines: the person removes one before another is proposed`);
        /** @type {import("../core/routines.js").Routine} */
        const r = { id: `r${doc.seq}`, title: "", when: "", task: "", writes: false, state: "proposed", paused: false, madeIn: chain, madeBy: byName, model, at, onAt: null, upTo: null, last: null, skipped: null };
        for (const k of ROUTINE_FIELDS) if (fields[k] !== undefined) /** @type {any} */ (r)[k] = fields[k];
        if (r.trigger) Object.assign(r, { when: "", wakes: fields.wakes || "new", seen: null, pending: null });
        const clash = routineClash(r);
        if (clash) throw refused(409, `“${r.title}”: ${clash}.`);
        if (!r.guides) delete r.guides;
        doc.routines.push(r);
        if (r.trigger)
          saidNamed(doc, at, [`Proposed a watcher: “${r.title}”, `, ...triggerParts(r.trigger, nameOf), ", ", ...wakesParts(doc, r, byName, nameOf), ". It listens only once you switch it on, in Watchers."], by);
        else said(doc, at, `Proposed a routine: “${r.title}”, ${whenOf(r)}, ${mayOf(doc, r)}. It runs only once you switch it on, in Routines.`, by);
        return r;
      });
    },

    /**
     * A routine the person switched on (R1, S6-D1): it runs at its times from now, and a line says when and what it may
     * do. A watcher listens from now: its seen cursor starts then, nothing waiting; its line says whom it wakes and
     * what that may do, the chats it names kept apart — the one it may guide by `nameOf`'s name. `read`: the routine's
     * `at` as the sheet they pressed on showed it — the press is of what they read: where its chat changed it since, it
     * is refused (`moved`), and the sheet shows what it does now. `pins`: what this press approves by content, where the
     * routine's source runs something of the project (app/watchers/script.js `approve`) — each file's hash by its path,
     * null where it approves nothing so —, kept on the routine with the moment (`script`): the app's to say, as it
     * reads the files, and never an agent's call. A row that said Filament switched it off is answered by the press.
     * @param {unknown} project @param {string} id @param {number | null} [read]
     * @param {{ nameOf?: (chain: string) => string, pins?: ((r: import("../core/routines.js").Routine) => Record<string, string> | null) | null }} [o]
     * @returns {import("../core/routines.js").Routine}
     */
    routineOn(project, id, read = null, { nameOf = () => "a chat of this project", pins = null } = {}) {
      return change(idOf(project), (doc, at) => {
        const r = routineOf(doc, id);
        if (r.state === "removed") throw refused(409, `“${r.title}” was removed: put it back first.`);
        if (r.state === "on") throw refused(409, `“${r.title}” is on already.`);
        if (read != null && r.at !== read) throw Object.assign(refused(409, `“${r.title}” was changed by its chat since you read it: read what it does now, then switch it on.`), { moved: true });
        // Read before anything is changed: a read that throws leaves the routine as it was.
        const approved = pins ? pins(r) : null;
        Object.assign(r, { state: "on", onAt: at, upTo: null, paused: false, skipped: null }, r.trigger ? { seen: { from: at, at: null, ids: [] }, pending: null } : {});
        if (approved) r.script = { pins: approved, at };
        else delete r.script;
        doc.needs = doc.needs.filter((n) => !(n.kind === "routine" && n.routine?.id === r.id && n.routine.unapproved && n.state !== "done"));
        if (r.trigger) saidNamed(doc, at, [`You switched on the watcher “${r.title}”: it listens from now and `, ...wakesParts(doc, r, r.madeBy || "the chat that proposed it", nameOf), "."]);
        else said(doc, at, `You switched on “${r.title}”: ${whenOf(r)}, ${mayOf(doc, r)}.`);
        return r;
      });
    },

    /**
     * The model a routine runs on, the person's choice (the owner's word of 10-31: the models agents run on are theirs):
     * its runs start on it, at `effort` where one is given — "" its Space's model, as Settings › Space or its Space
     * settings name it (the owner's of 11-04) —, a change by its chat keeps it, and a line says it where it changed. Its
     * state stays as it was. One removed is refused, and an effort that is none; so is a watcher that starts no chat of
     * its own — a turn in the chat that proposed it runs on that chat's model, and one that tells only the person runs
     * nothing.
     * @param {unknown} project @param {string} id @param {string} model @param {string} [effort]
     * @returns {import("../core/routines.js").Routine}
     */
    routineModel(project, id, model, effort = "") {
      if (effort && !SPACE_EFFORTS.includes(effort)) throw refused(400, `effort is one of ${SPACE_EFFORTS.join(", ")}, or "" for the model's own`);
      return change(idOf(project), (doc, at) => {
        const r = routineOf(doc, id);
        if (r.state === "removed") throw refused(409, `“${r.title}” was removed: put it back first.`);
        if (r.trigger && r.wakes === "chat") throw refused(409, `“${r.title}” takes a turn in the chat that proposed it, on that chat's own model: none is chosen for it.`);
        if (r.trigger && r.wakes === "you") throw refused(409, `“${r.title}” tells only you, and runs nothing: no model is chosen for it.`);
        const was = `${r.model}|${r.effort || ""}`;
        r.model = model;
        r.modelBy = "you";
        if (model && effort) r.effort = effort;
        else delete r.effort;
        if (was !== `${model}|${model ? effort : ""}`) said(doc, at, `You chose the model “${r.title}” runs on: ${model ? `${model}${effort ? ` at ${effort} effort` : ""}` : "this Space's model"}.`);
        return r;
      });
    },

    /**
     * A routine on, paused or going on: paused, it runs no more; resumed, its next time is the first from now — the
     * times it was paused through are not made up (S6-D5). `by`: an agent's pause (HarnessV4_AgentsSpace_Plan SA-D3),
     * its chat and line, which its row and What happened say; one already paused is refused naming who paused it —
     * Filament, where it did (`watchPaused`). Resuming is the person's: their Resume of an agent's pause, or of
     * Filament's, says whose it ends.
     * @param {unknown} project @param {string} id @param {boolean} on
     * @param {{ chain: string, name?: string | null, byName: string, line: string } | null} [by]
     * @returns {import("../core/routines.js").Routine}
     */
    routinePause(project, id, on, by = null) {
      return change(idOf(project), (doc, at) => {
        const r = routineOf(doc, id);
        if (r.state !== "on") throw refused(409, `“${r.title}” is not on: ${r.state === "proposed" ? "switch it on first" : "put it back first"}.`);
        if (by && r.paused) throw refused(409, `“${r.title}” is paused already, by ${r.pausedBy ? `${toReader(by.chain, r.pausedBy.chain, r.pausedBy.byName)}: ${r.pausedBy.line}` : r.pausedWhy ? `Filament: ${r.pausedWhy}` : "the person"}.`);
        if (r.paused === on) return r;
        const was = r.pausedBy;
        const why = r.pausedWhy;
        r.paused = on;
        delete r.pausedBy;
        delete r.pausedWhy;
        if (on && by) r.pausedBy = { chain: by.chain, byName: by.byName, line: by.line };
        if (!on) r.upTo = at;
        // A watcher resumed listens from now: what happened while it was paused is not made up; what it heard before
        // still waits for its run.
        if (!on && r.trigger) r.seen = { from: at, at: r.seen?.at ?? null, ids: r.seen?.ids ?? [] };
        if (by) said(doc, at, `Paused the ${kindOf(r)} “${r.title}”: ${by.line}`, { kind: "agent", chain: by.chain, ...(by.name ? { name: by.name } : {}) });
        else if (!on && !was && why) said(doc, at, `You resumed the ${kindOf(r)} “${r.title}”, which Filament had paused: ${why}`);
        else saidNamed(doc, at, on ? [`You paused the ${kindOf(r)} “${r.title}”: it ${r.trigger ? "listens" : "runs"} no more until you resume it.`] : was ? [`You resumed the ${kindOf(r)} “${r.title}”, which `, { chain: was.chain, name: was.byName }, ` had paused: ${was.line}`] : [`You resumed the ${kindOf(r)} “${r.title}”: ${whenOf(r)}.`]);
        return r;
      });
    },

    /**
     * A watcher Filament pauses itself (the review of w5's fixes): the chat it wakes can never take its turn — gone,
     * archived, a client's own session —, so it fails once, never anew at each hearing. Its row and What happened say
     * why (`pausedWhy`); what it heard stays, as a paused watcher's does; Resume, or Remove, is the person's. One not
     * on, or paused already, is let be. A routine at times is refused. → whether it paused it.
     * @param {unknown} project @param {string} id @param {string} why
     */
    watchPaused(project, id, why) {
      const pid = idOf(project);
      const r = routineOf(read(pid), id);
      if (!r.trigger) throw refused(409, `“${r.title}” runs at its times: Filament pauses no routine at times itself.`);
      if (r.state !== "on" || r.paused) return false;
      change(pid, (doc, at) => {
        const w = routineOf(doc, id);
        w.paused = true;
        delete w.pausedBy;
        w.pausedWhy = String(why).slice(0, SPACE_LIMITS.text);
        said(doc, at, `Filament paused the watcher “${w.title}”: ${w.pausedWhy}. It listens again once you resume it.`);
      });
      return true;
    },

    /**
     * A watcher Filament switches off itself: what would run is not what the person's Switch on approved by content —
     * a file its program is made of changed since, or nothing records the approval (app/watchers/script.js). It is
     * Proposed again, as one its chat changed: off, its cursor and what waited dropped, and what was approved with
     * them. What happened says why, and one row in Needs you — the one open for it where one is, its words the newest
     * — until the person's Switch on, whose sheet shows what it runs. One that is not on is let be. A routine at times
     * is refused. → whether it switched it off.
     * @param {unknown} project @param {string} id @param {string} why
     */
    watchUnapproved(project, id, why) {
      const pid = idOf(project);
      const r = routineOf(read(pid), id);
      if (!r.trigger) throw refused(409, `“${r.title}” runs at its times: Filament switches no routine at times off itself.`);
      if (r.state !== "on") return false;
      change(pid, (doc, at) => {
        const w = routineOf(doc, id);
        Object.assign(w, { state: "proposed", onAt: null, upTo: null, paused: false, seen: null, pending: null });
        delete w.pausedBy;
        delete w.pausedWhy;
        delete w.script;
        dropGuides(doc, at, w, "was switched off by Filament");
        const words = unapprovedWords(w.title, String(why).slice(0, SPACE_LIMITS.text / 2));
        said(doc, at, words.said);
        const text = words.row.slice(0, SPACE_LIMITS.text);
        const routine = { id: w.id, chain: "", watcher: /** @type {const} */ (true), unapproved: /** @type {const} */ (true) };
        const open = doc.needs.find((n) => n.kind === "routine" && n.routine?.id === w.id && !!n.routine.unapproved && n.state !== "done");
        if (open) Object.assign(open, { text, why: UNAPPROVED_WHY, title: w.title, routine, at });
        else doc.needs.push({ id: `n${doc.seq}`, kind: "routine", text, why: UNAPPROVED_WHY, dashboard: "", title: w.title, routine, at, state: "open" });
      });
      return true;
    },

    /**
     * A routine taken out, on the person's word (S6-D13): nothing of it runs; a run under way goes on, its chat's Stop
     * there. Its way back is Put back, as it was. @param {unknown} project @param {string} id
     * @returns {import("../core/routines.js").Routine}
     */
    routineRemove(project, id) {
      return change(idOf(project), (doc, at) => {
        const r = routineOf(doc, id);
        if (r.state === "removed") throw refused(409, `“${r.title}” is removed already.`);
        r.was = r.state;
        r.state = "removed";
        if (r.trigger) r.pending = null;
        dropGuides(doc, at, r, "was removed");
        said(doc, at, `You removed the ${kindOf(r)} “${r.title}”: ${r.trigger ? "it listens no more" : "nothing of it runs"}. Add to this Space… puts it back.`);
        return r;
      });
    },

    /**
     * A routine removed put back as it was: on — paused if it was, its next time the first from now — or proposed.
     * @param {unknown} project @param {string} id @returns {import("../core/routines.js").Routine}
     */
    routineBack(project, id) {
      return change(idOf(project), (doc, at) => {
        const r = routineOf(doc, id);
        if (r.state !== "removed") throw refused(409, `“${r.title}” is not removed.`);
        r.state = r.was === "on" && r.onAt ? "on" : "proposed";
        delete r.was;
        if (r.state === "on") r.upTo = at;
        if (r.state === "on" && r.trigger) r.seen = { from: at, at: r.seen?.at ?? null, ids: r.seen?.ids ?? [] };
        said(doc, at, r.state === "on" ? `You put the ${kindOf(r)} “${r.title}” back: on${r.paused ? ", paused" : ""}, as it was.` : `You put the ${kindOf(r)} “${r.title}” back, proposed as it was.`);
        return r;
      });
    },

    /**
     * A routine's run begun (S6-D2): its chat, its moment — the time it ran at, or a press of Run now —, by whom: its
     * time, the person, an agent (`startedBy`, SA-D10), or a watcher's events (`events`, how many). A run at its time
     * moves `upTo` to it; one by events counts toward its watcher's wake-ups of the hour (`woke`).
     * @param {unknown} project @param {string} id
     * @param {{ at: number, chain: string, by: import("../core/routines.js").RunBy, startedBy?: { chain: string, byName: string },
     *   on?: string, instead?: string, events?: number, turn?: number, quiet?: boolean, turns?: { chain: string, turn: number }[] }} run  `on`: the model it runs on, in words; `instead`: why
     *   that is its Space's; `turn`: a watcher's turn in the chat it wakes, by its number there; `quiet`: it carried an
     *   event of a chat whose words were its own alone; `turns`: the chats' turns its events were of, which its end
     *   keeps as reviews
     */
    routineStarted(project, id, { at: when, chain, by, startedBy, on, instead, events, turn, quiet, turns }) {
      return change(idOf(project), (doc, at) => {
        const r = routineOf(doc, id);
        r.last = { at: when, chain, by, ...(by === "agent" && startedBy ? { startedBy } : {}), state: "running", ...(on ? { on } : {}), ...(instead ? { instead } : {}), ...(events ? { events } : {}), ...(turn ? { turn } : {}), ...(quiet ? { quiet: true } : {}), ...(turnsIn(turns).length ? { turns: turnsIn(turns) } : {}) };
        // Its own model could not run, so the model for this Space's agents runs it (the owner's of 11-04) — its own or
        // Settings › Space's —: said, as the person did not choose it for this one.
        if (instead && on) said(doc, at, `“${r.title}” runs on ${on} instead, the model for this Space's agents: ${instead}.`, { kind: "filament", ...(chain ? { chain } : {}) });
        if (by === "time") r.upTo = Math.max(r.upTo ?? 0, when);
        if (by === "event") r.woke = wokeWith(r.woke, when);
        return r;
      });
    },

    /**
     * A routine's run ended, or could not start (`chain` ""): its row's last run, and a line in What happened — what it
     * said, or why it failed. A failure is one row in Needs you, the newest's words where one is open (S6-D10); a run
     * that ends well again takes it away. A run that is no longer its newest is let be.
     * @param {unknown} project @param {string} id
     * @param {{ at: number, chain: string, by: import("../core/routines.js").RunBy, startedBy?: { chain: string, byName: string },
     *   state: "done" | "failed" | "stopped", said?: string, why?: string }} run
     * @returns {import("../core/routines.js").Routine | null}
     */
    routineEnded(project, id, run) {
      const pid = idOf(project);
      const was = read(pid).routines.find((x) => x.id === id);
      if (!was || (run.chain && was.last?.chain !== run.chain)) return null;
      return change(pid, (doc, at) => {
        const r = routineOf(doc, id);
        // An agent's run keeps who started it, from its start where its end does not say.
        const startedBy = run.startedBy || (run.by === "agent" ? r.last?.startedBy : undefined);
        // What it ran on, from its start (the owner's of 11-04), and how many events woke a watcher's.
        const ranOn = run.chain && r.last?.chain === run.chain ? { ...(r.last.on ? { on: r.last.on } : {}), ...(r.last.instead ? { instead: r.last.instead } : {}), ...(r.last.events ? { events: r.last.events } : {}) } : {};
        // The turns it reviewed, from its start: kept below where it ends well.
        const reviewed = run.chain && r.last?.chain === run.chain ? r.last.turns || [] : [];
        /** @type {import("../core/routines.js").RoutineRun} */
        const last = { at: run.at, chain: run.chain, by: run.by, ...(run.by === "agent" && startedBy ? { startedBy } : {}), state: run.state, ended: at, ...(run.said ? { said: run.said } : {}), ...(run.why ? { why: run.why } : {}), ...ranOn };
        r.last = last;
        if (run.by === "time") r.upTo = Math.max(r.upTo ?? 0, run.at);
        const clock = clockAt(run.at, run.at);
        /** @type {SpaceAuthor} */
        const by = { kind: "filament", ...(run.chain ? { chain: run.chain } : {}) };
        // Its failure's row: never a row of what a watcher that tells only the person heard, nor of a guidance held
        // for them, which are theirs to close; nor the row of one Filament switched off, which its Switch on answers.
        const mine = (/** @type {import("../core/space.js").NeedRow} */ n) => n.kind === "routine" && n.routine?.id === r.id && !n.routine.told && !n.routine.guide && !n.routine.unapproved && n.state !== "done";
        if (run.state === "failed") {
          const why = run.why || "it gave no reason";
          said(doc, at, `“${r.title}” failed (${clock}): ${why}`, by);
          const text = `“${r.title}” failed: ${why}`.slice(0, SPACE_LIMITS.text);
          const whyRow = routineWhy(run.by, clock, startedBy?.byName, !!r.trigger);
          // An agent's Run now keeps its chat and the clock, so the why is said again under a reader's name (core/space.js
          // `needsWords`).
          const routine = { id: r.id, chain: run.chain, ...(r.trigger ? { watcher: /** @type {const} */ (true) } : {}), ...(run.by === "agent" && startedBy ? { startedBy, clock } : {}) };
          const had = doc.needs.find(mine);
          if (had) Object.assign(had, { text, why: whyRow, title: r.title, routine, at });
          else doc.needs.push({ id: `n${doc.seq}`, kind: "routine", text, why: whyRow, dashboard: "", title: r.title, routine, at, state: "open" });
        } else if (run.state === "stopped") said(doc, at, `“${r.title}”'s run (${clock}) was stopped before it ended.`, by);
        else {
          said(doc, at, `“${r.title}” ran (${clock}, ${tookWords(at - run.at)}): ${run.said || "it said nothing"}`, by);
          doc.needs = doc.needs.filter((n) => !mine(n));
          // Each turn it reviewed, for the page: whether it wrote that turn's chat guidance while it ran.
          for (const t of reviewed)
            (doc.reviews ||= []).push({ chain: t.chain, turn: t.turn, watcher: r.id, title: r.title, at, guided: (doc.guidance || []).some((g) => g.watcher === r.id && g.to === t.chain && g.at >= run.at) });
        }
        return r;
      });
    },

    /**
     * A time of a routine that did not run, and why — its last run still under way, Pause all, Filament off (`missed`) —:
     * its row says so, and its next time is the one after (S6-D5). @param {unknown} project @param {string} id
     * @param {{ at: number, why: string, missed?: boolean }} o
     */
    routineSkipped(project, id, { at: when, why, missed = false }) {
      return change(idOf(project), (doc) => {
        const r = routineOf(doc, id);
        r.skipped = { at: when, why, ...(missed ? { missed: true } : {}) };
        r.upTo = Math.max(r.upTo ?? 0, when);
        return r;
      });
    },

    /**
     * Events a watcher's source heard (the plan of 11-11): each new to it — since it listens, and not seen yet — moves its
     * seen cursor and waits, coalesced, for its next run (core/watchers.js `heardOf`); a turn trigger's `every` lets each
     * `every`th wait, the others counted on the cursor. One proposed, paused or removed, or while Pause all is on or
     * its project archived (`archivedNow`), hears none: an event said then is never made up after. A source that looks
     * at what stands — a connection's answer, a branch's tip — looks again once Pause all is off, or the project back,
     * from what it last saw: what changed meanwhile is heard then (`watchAsked`, `watchHead`). Written only where one
     * was new. A routine at times is refused. → how many wait now of those it heard.
     * @param {unknown} project @param {string} id @param {readonly unknown[]} events
     */
    watchHeard(project, id, events) {
      const pid = idOf(project);
      const r = routineOf(read(pid), id);
      if (!r.trigger) throw refused(409, `“${r.title}” runs at its times: it hears no events.`);
      if (r.state !== "on" || r.paused || pausedSince() || archivedNow(pid) || !r.seen) return 0;
      const h = heardOf(r.seen, r.pending ?? null, events, triggerEvery(r.trigger));
      if (!h.heard) return 0;
      change(pid, (doc) => Object.assign(routineOf(doc, id), { seen: h.seen, pending: h.pending }));
      return h.took;
    },

    /**
     * A connection's watcher asked its tool (the plan of 11-11, its w4): when, the keys of what it answered and the path
     * of the list they are of (`list`, none where they are of no list) — or why it failed, counted in a row, its keys
     * and its list kept —, on its cursor. One that is not on, or has no cursor, keeps nothing: switched on again it
     * listens from then. A routine at times, or a watcher of anything else, is refused. → whether it was kept.
     * @param {unknown} project @param {string} id
     * @param {{ at: number, keys?: string[], list?: string[] | null, failed?: string }} asked
     */
    watchAsked(project, id, { at, keys, list, failed }) {
      const pid = idOf(project);
      const r = routineOf(read(pid), id);
      if (r.trigger?.kind !== "connection") throw refused(409, `“${r.title}” asks no connection's tool.`);
      if (r.state !== "on" || !r.seen) return false;
      change(pid, (doc) => {
        const w = routineOf(doc, id);
        if (!w.seen) return;
        const { trouble, ...seen } = w.seen;
        const { list: _was, ...answered } = seen;
        w.seen = failed
          ? { ...seen, asked: at, trouble: { at, why: String(failed).slice(0, WATCH_LIMITS.summary), fails: (trouble?.fails || 0) + 1 } }
          : keys
            ? { ...answered, asked: at, keys: keys.slice(0, CONNECTION_ITEMS), ...(list ? { list: list.slice(0, WATCH_LIMITS.list) } : {}) }
            : { ...seen, asked: at };
      });
      return true;
    },

    /**
     * A watcher's source could not look at what it watches — a commit trigger's, at its branch (the plan of 11-11, its
     * w3) —: why, on its cursor, from the first look that failed so until one goes well (`why` null) — what its row
     * says, in its kind's words (core/watchers.js `troubleWords`). `fails`: how many times it failed so, for a source
     * that counts them — a webhook's posts refused —, 1 for one that says only that it stands. Written only where it
     * changes. One that is not on, is paused or has no cursor keeps nothing. A routine at times, and a watcher of a
     * kind whose row has no trouble to say, is refused. → whether it stands as asked.
     * @param {unknown} project @param {string} id @param {string | null} why @param {number} [fails]
     */
    watchTrouble(project, id, why, fails = 1) {
      const pid = idOf(project);
      const r = routineOf(read(pid), id);
      if (!r.trigger || !TRIGGER_ROWS[r.trigger.kind].trouble) throw refused(409, `“${r.title}” keeps no trouble of its own.`);
      if (r.state !== "on" || r.paused || !r.seen) return false;
      const said = why ? String(why).slice(0, WATCH_LIMITS.summary) : null;
      const n = Number.isInteger(fails) && fails > 0 ? fails : 1;
      if ((r.seen.trouble?.why ?? null) === said && (!said || r.seen.trouble?.fails === n)) return true;
      change(pid, (doc, at) => {
        const w = routineOf(doc, id);
        if (!w.seen) return;
        const { trouble: _was, ...seen } = w.seen;
        w.seen = said ? { ...seen, trouble: { at, why: said, fails: n } } : seen;
      });
      return true;
    },

    /**
     * A commit trigger's watcher looked at its branch (the plan of 11-11, its w3): the commit it is at now, on its
     * cursor — what it heard of the move is heard first, `watchHeard`. One that is not on, is paused, has no cursor, or
     * looks under Pause all or in an archived project keeps nothing: resumed, it listens from then; Pause all off, or
     * its project back, it looks again from its head.
     * `was`: the cursor the look began from — its moment and head —, where it must still be: a look that began before a
     * resume keeps nothing on the cursor the resume began. A watcher of anything else is refused. → whether it was kept.
     * @param {unknown} project @param {string} id @param {string} head
     * @param {{ from: number, head: string | null } | null} [was]
     */
    watchHead(project, id, head, was = null) {
      const pid = idOf(project);
      const r = routineOf(read(pid), id);
      if (r.trigger?.kind !== "commit") throw refused(409, `“${r.title}” watches no branch.`);
      if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(head)) throw refused(400, "a head is a commit's whole id");
      if (r.state !== "on" || r.paused || pausedSince() || archivedNow(pid) || !r.seen) return false;
      if (was && (r.seen.from !== was.from || (r.seen.head ?? null) !== was.head)) return false;
      if (r.seen.head === head) return true;
      change(pid, (doc, at) => {
        const w = routineOf(doc, id);
        if (w.seen) w.seen = { ...w.seen, head, headAt: at };
      });
      return true;
    },

    /**
     * A file trigger's watcher looked at its folder (app/watchers/files.js): when, on its cursor (`fileAt`) — what it
     * heard of the look is heard first, `watchHeard` —, so a start after a stop tells what was written since. One that
     * is not on, is paused, has no cursor, or looks under Pause all or in an archived project keeps nothing. `at` null lets go of what it kept,
     * under Pause all too: its next look is where it listens from, and nothing written meanwhile is made up. `was`: the
     * cursor the look began from, by its moment, where it must still be: a look that began before a resume keeps
     * nothing on the cursor the resume began. A watcher whose kind keeps no such moment (its row's `seen`) is refused.
     * → whether it was kept.
     * @param {unknown} project @param {string} id @param {number | null} at
     * @param {{ from: number } | null} [was]
     */
    watchLooked(project, id, at, was = null) {
      const pid = idOf(project);
      const r = routineOf(read(pid), id);
      if (!r.trigger || !("fileAt" in TRIGGER_ROWS[r.trigger.kind].seen)) throw refused(409, `“${r.title}” watches no folder's files.`);
      if (r.state !== "on" || r.paused || !r.seen || (at != null && (pausedSince() || archivedNow(pid)))) return false;
      if (was && r.seen.from !== was.from) return false;
      if ((r.seen.fileAt ?? null) === at) return true;
      change(pid, (doc) => {
        const w = routineOf(doc, id);
        if (!w.seen) return;
        const { fileAt: _was, ...seen } = w.seen;
        w.seen = at != null ? { ...seen, fileAt: at } : seen;
      });
      return true;
    },

    /**
     * What waits for a watcher's run, taken by the run that starts: the events, oldest first, and how many came before
     * them; none wait after. Null where nothing does. `only`: those a turn in the chat it wakes carried, read before it
     * was sent — taken alone, what was heard meanwhile waiting on. Those of them that newer ones pushed out of the list
     * meanwhile, counted in `more` since, are taken from its count too: the turn carried them.
     * @param {unknown} project @param {string} id @param {import("../core/watchers.js").Pending | null} [only]
     * @returns {import("../core/watchers.js").Pending | null}
     */
    watchTake(project, id, only = null) {
      const pid = idOf(project);
      const got = routineOf(read(pid), id).pending ?? null;
      if (!got) return null;
      if (!only) {
        change(pid, (doc) => void (routineOf(doc, id).pending = null));
        return got;
      }
      // Those a chat's turn carried (`only`, read before it was sent), and no more: one heard meanwhile waits on.
      const sent = new Set(only.events.map((e) => e.id));
      change(pid, (doc) => {
        const w = routineOf(doc, id);
        const waits = w.pending?.events || [];
        const left = waits.filter((e) => !sent.has(e.id));
        const pushed = only.events.length - (waits.length - left.length);
        // Events the list holds no more are counted only before ones it holds: with none left, none is counted.
        const more = left.length ? Math.max(0, (w.pending?.more || 0) - only.more - pushed) : 0;
        w.pending = left.length ? { events: left, more } : null;
      });
      return only;
    },

    /**
     * What a watcher's run took and could not carry (r-itself, 11-12: the door its first message goes through failed,
     * app/routines.js `run`) waits again, ahead of what was heard meanwhile and under the cap what waits always has
     * (core/watchers.js `WATCH_LIMITS.events`): the newest, the older counted in `more`. One that is not on any more —
     * switched off, removed, its cursor gone — keeps none. → whether they wait again.
     * @param {unknown} project @param {string} id @param {import("../core/watchers.js").Pending} took
     */
    watchBack(project, id, took) {
      const pid = idOf(project);
      const r = read(pid).routines.find((x) => x.id === id);
      if (!r?.trigger || r.state !== "on" || !r.seen || !took.events.length) return false;
      change(pid, (doc) => {
        const w = routineOf(doc, id);
        const since = w.pending?.events || [];
        const waits = [...took.events.filter((e) => !since.some((s) => s.id === e.id)), ...since];
        const over = Math.max(0, waits.length - WATCH_LIMITS.events);
        w.pending = { events: waits.slice(over), more: took.more + (w.pending?.more || 0) + over };
      });
      return true;
    },

    /**
     * What a watcher that tells only the person heard (the plan of 11-11, its w5): taken, and said in Needs you — one
     * row of it while one is open, its words the newest event's and its count grown; a new one once the person closed it.
     * No run, no chat. → how many it told, 0 where none waited.
     * @param {unknown} project @param {string} id
     */
    watchTold(project, id) {
      const pid = idOf(project);
      const r = routineOf(read(pid), id);
      if (r.wakes !== "you") throw refused(409, `“${r.title}” wakes a chat: it tells the person nothing in Needs you.`);
      const got = r.pending ?? null;
      if (!got?.events.length) return 0;
      const n = got.events.length + got.more;
      change(pid, (doc, at) => {
        const w = routineOf(doc, id);
        w.pending = null;
        const newest = /** @type {import("../core/watchers.js").WatchEvent} */ (got.events.at(-1));
        const open = doc.needs.find((x) => x.kind === "routine" && x.routine?.id === w.id && !!x.routine.told && x.state !== "done");
        const told = (open?.routine?.told || 0) + n;
        const text = `“${w.title}” heard: ${newest.summary}`.slice(0, SPACE_LIMITS.text);
        const why = `A watcher that tells only you · ${told === 1 ? "1 event" : `${told} events`}, the newest at ${clockAt(newest.at, at)}`;
        const routine = { id: w.id, chain: "", told, heard: newest.summary };
        if (open) Object.assign(open, { text, why, title: w.title, routine, at });
        else doc.needs.push({ id: `n${doc.seq}`, kind: "routine", text, why, dashboard: "", title: w.title, routine, at, state: "open" });
      });
      return n;
    },

    /**
     * A watcher's guidance to the chat it watches, kept (app/watchers/guidance.js): where it stands as its sender found
     * it — `waiting` and why, `sent` and how, or `held` for the person past the cap. One waits per watcher and chat, and
     * one is held: the reviewer's newer view takes the older's place, which is dropped. A held one is a row in Needs
     * you — the one open for that watcher and chat, its words replaced, or a new one —, naming the chat by `nameOf`'s
     * name, its words whole on the row.
     * @param {unknown} project @param {string} id  the watcher's
     * @param {Pick<import("../core/watchers.js").Guidance, "from" | "to" | "text" | "state"> & Partial<Pick<import("../core/watchers.js").Guidance, "how" | "turn" | "why" | "sentAt">>} g
     * @param {{ nameOf?: (chain: string) => string }} [o]
     * @returns {import("../core/watchers.js").Guidance}
     */
    guideKeep(project, id, g, { nameOf = () => "a chat of this project" } = {}) {
      return change(idOf(project), (doc, at) => {
        const r = routineOf(doc, id);
        const list = (doc.guidance ||= []);
        for (const x of list)
          if (x.watcher === r.id && x.to === g.to && (x.state === "waiting" || (x.state === "held" && g.state === "held"))) Object.assign(x, { state: "dropped", why: "a newer one from its watcher took its place" });
        /** @type {import("../core/watchers.js").Guidance} */
        const kept = {
          id: `g${doc.seq}`,
          watcher: r.id,
          title: r.title,
          from: g.from,
          to: g.to,
          text: g.text.slice(0, GUIDE_CHARS),
          at,
          state: g.state,
          ...(g.how ? { how: g.how } : {}),
          ...(g.turn ? { turn: g.turn } : {}),
          ...(g.why ? { why: g.why.slice(0, SPACE_LIMITS.line) } : {}),
          ...(g.sentAt ? { sentAt: g.sentAt } : {}),
        };
        list.push(kept);
        if (kept.state === "held") heldRow(doc, at, kept, r.title, nameOf(kept.to));
        return kept;
      });
    },

    /**
     * A kept guidance moved on: sent, read, waiting again, held, dropped — what `patch` says of it, a part given as
     * undefined taken off. One held from now is a row in Needs you, as a new one held is (`guideKeep`), taking the
     * place of an older one of its watcher's held for that chat; one that is held no more leaves Needs you: its row is
     * done. `say`: a line for What happened, where its end is one the person should read, the chats it names kept
     * apart. Null where the Space keeps no such guidance.
     * @param {unknown} project @param {string} guide
     * @param {Partial<Pick<import("../core/watchers.js").Guidance, "state" | "how" | "turn" | "why" | "sentAt" | "pressed">>} patch
     * @param {{ say?: import("../core/space.js").NamedWords | null, nameOf?: (chain: string) => string }} [o]
     * @returns {import("../core/watchers.js").Guidance | null}
     */
    guideMove(project, guide, patch, { say = null, nameOf = () => "a chat of this project" } = {}) {
      const pid = idOf(project);
      const was = (read(pid).guidance || []).find((g) => g.id === guide);
      if (!was) return null;
      const same = Object.entries(patch).every(([k, v]) => /** @type {any} */ (was)[k] === v);
      if (same && !say) return was;
      return change(pid, (doc, at) => {
        const g = /** @type {import("../core/watchers.js").Guidance} */ ((doc.guidance || []).find((x) => x.id === guide));
        const held = g.state === "held";
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) delete (/** @type {any} */ (g)[k]);
          else /** @type {any} */ (g)[k] = k === "why" ? String(v).slice(0, SPACE_LIMITS.line) : v;
        }
        if (g.state === "held" && !held) {
          for (const x of doc.guidance || []) if (x !== g && x.watcher === g.watcher && x.to === g.to && x.state === "held") Object.assign(x, { state: "dropped", why: "a newer one from its watcher took its place" });
          heldRow(doc, at, g, doc.routines.find((r) => r.id === g.watcher)?.title || g.title, nameOf(g.to));
        } else if (g.state !== "held") closeHeld(doc, at, (n) => n.routine?.guide?.id === g.id);
        if (say) saidNamed(doc, at, say);
        return g;
      });
    },

    /** The guidance a Space keeps, the oldest first. @param {unknown} project @returns {import("../core/watchers.js").Guidance[]} */
    guidance(project) {
      return read(idOf(project)).guidance || [];
    },

    /**
     * Every Space's guidance that still has somewhere to go — waiting, on its way, held —, with its project.
     * @returns {{ project: string, g: import("../core/watchers.js").Guidance }[]}
     */
    guidanceLive() {
      return known().flatMap((project) => (read(project).guidance || []).filter((g) => g.state === "waiting" || g.state === "sent" || g.state === "held").map((g) => ({ project, g })));
    },

    /**
     * The turns of one chat its Space's watchers reviewed, the oldest first: which watcher, when its run ended, and
     * whether it wrote the chat guidance. @param {unknown} project @param {string} chain
     * @returns {import("../core/watchers.js").Review[]}
     */
    reviewsOf(project, chain) {
      return (read(idOf(project)).reviews || []).filter((v) => v.chain === chain);
    },

    /** Every routine of every Space, with its project. @returns {{ project: string, r: import("../core/routines.js").Routine }[]} */
    routinesAll() {
      return known().flatMap((project) => read(project).routines.map((r) => ({ project, r })));
    },

    pausedSince,

    /** Whether a project is archived, so that nothing of its Space runs by itself (`archivedNow`). @param {unknown} project */
    archived: archivedNow,

    /** Who switched Pause all on, where an agent did (SA-D3): its chat, name and line; null for the person, or off. */
    pausedAllBy() {
      return pausedSince() ? pausedBy : null;
    },

    /**
     * Pause all switched (S6-D4, D12): on, nothing starts by itself — no routine's time, no watch's look — until it is
     * switched off. Written before the store takes it; said on the `space` topic for every Space (`project` "*").
     * `by`: an agent's (SA-D3), its chat and line, which the head of what runs by itself says; one already on is
     * refused naming who switched it. Switching it off is the person's.
     * @param {boolean} on @param {{ chain: string, byName: string, line: string } | null} [by]
     * @returns {number | null}  the moment it is paused since, or null
     */
    pauseAll(on, by = null) {
      const was = pausedSince();
      if (by && was) throw refused(409, `Pause all is on already, since ${clockAt(was, now())}, by ${pausedBy ? `${toReader(by.chain, pausedBy.chain, pausedBy.byName)}: ${pausedBy.line}` : "the person"}.`);
      if (!!was === on) return was;
      const next = on ? now() : null;
      const who = on && by ? { chain: by.chain, byName: by.byName, line: by.line } : null;
      if (dir) {
        mkdirSync(dir, { recursive: true });
        if (next) {
          const tmp = `${pauseFile()}.${process.pid}.tmp`;
          try {
            writeFileSync(tmp, JSON.stringify({ since: next, ...(who ? { by: who } : {}) }));
            renameSync(tmp, pauseFile());
          } catch (e) {
            rmSync(tmp, { force: true });
            throw e;
          }
        } else rmSync(pauseFile(), { force: true });
      }
      paused = next;
      pausedBy = who;
      events?.publish("space", { type: "space", project: "*", seq: 0 });
      return next;
    },

    /**
     * Settings › Space (the owner's of 11-04): every Space's defaults — the model its agents run on where a Space sets
     * none, with its effort, and what an app's ask does. One file beside the Spaces, read once.
     */
    defaults,

    /**
     * Settings › Space changed: each field the patch names set, or with `null` or "" taken away. Written before the store
     * takes it; said on the `space` topic for every Space (`project` "*"), as each one's page says what it runs on.
     * @param {unknown} patch @returns {import("../core/space-settings.js").SpaceSettings}
     */
    setDefaults(patch) {
      const got = settingsChange(defaults(), patch);
      if (!got.ok) throw refused(400, got.error);
      if (!got.changed.length) return got.settings;
      if (dir) {
        mkdirSync(dir, { recursive: true });
        const file = join(dir, DEFAULTS_FILE);
        const tmp = `${file}.${process.pid}.tmp`;
        try {
          writeFileSync(tmp, JSON.stringify(got.settings));
          renameSync(tmp, file);
        } catch (e) {
          rmSync(tmp, { force: true });
          throw e;
        }
      }
      kept = got.settings;
      events?.publish("space", { type: "space", project: "*", seq: 0 });
      return got.settings;
    },

    /** A Space's own settings, over Settings › Space's: none where it sets none. @param {unknown} project */
    settingsOf: (project) => read(idOf(project)).settings || {},

    /**
     * A Space's own settings changed, on the person's word (its ⋯ › Space settings…): each field the patch names set, or
     * with `null` or "" taken away — to Settings › Space's then —, and a line in What happened saying what changed.
     * @param {unknown} project @param {unknown} patch @returns {import("../core/space-settings.js").SpaceSettings}
     */
    setSettings(project, patch) {
      const id = idOf(project);
      const got = settingsChange(read(id).settings, patch);
      if (!got.ok) throw refused(400, got.error);
      if (!got.changed.length) return got.settings;
      return change(id, (doc, at) => {
        if (Object.keys(got.settings).length) doc.settings = got.settings;
        else delete doc.settings;
        const on = runsOnOf(doc.settings, defaults());
        /** @type {string[]} */
        const lines = [];
        if (got.changed.includes("model") || got.changed.includes("effort"))
          lines.push(
            on.from === "space" ? `You set the model this Space's agents run on: ${on.model}${on.effort ? ` at ${on.effort} effort` : ""}. Its routines and an app's asks run on it where you chose none for them.`
            : on.from === "default" ? `This Space's agents run on Settings › Space's model again: ${on.model}${on.effort ? ` at ${on.effort} effort` : ""}.`
            : "This Space has no model of its own any more, and Settings › Space sets none: its routines run on their own.",
          );
        if (got.changed.includes("asks")) lines.push(`An app's ask in this Space: ${ASKS_WORDS[on.asks].replace(/^./, (c) => c.toLowerCase())}${on.asksFrom === "default" ? " (Settings › Space's)" : on.asksFrom === "" ? " (as every Space does by default)" : ""}.`);
        said(doc, at, lines.join(" "));
        return got.settings;
      });
    },

    /** What a Space's agents run on (core/space-settings.js `runsOnOf`): its own, else Settings › Space's. @param {unknown} project */
    runsOn: (project) => runsOnOf(read(idOf(project)).settings, defaults()),

    /**
     * What Filament saw at a turn's end (SG-D4): a line on each chat that finished — its own newest grown within the hour,
     * a turn whose end failed counted once with its retry's (core/space.js `noteFinished`) — the lanes' news, and the
     * places as now read. Nothing is written where nothing is new and the places read the same as the last read.
     * @param {unknown} project
     * @param {{ finished?: { chain: string, name: string, place: string | null, facts: string | null, turn?: number | null, failed?: boolean }[], lines?: string[],
     *   seen?: Record<string, SeenPlace> | null }} news
     * @returns {SpaceEntry[]}
     */
    happened(project, { finished = [], lines = [], seen = null }) {
      const id = idOf(project);
      const before = read(id);
      const sameSeen = !seen || JSON.stringify(seen) === JSON.stringify(before.seen);
      if (!finished.length && !lines.length && sameSeen) return [];
      return change(id, (doc, at) => {
        /** @type {SpaceEntry[]} */
        const out = [];
        let first = true;
        /** A line's id: this change's own, then one more of the count for each line after it. */
        const nextId = () => {
          if (!first) doc.seq++;
          first = false;
          return `e${doc.seq}`;
        };
        for (const f of finished) out.push(noteFinished(doc, f, at, nextId()));
        for (const text of lines) {
          const t = entryText(text);
          if (!t.ok) continue;
          /** @type {SpaceEntry} */
          const e = { id: nextId(), at, by: { kind: "filament" }, text: t.text, task: null };
          doc.log.push(e);
          out.push(e);
        }
        if (seen) doc.seen = seen;
        return out;
      });
    },

    /**
     * Each project's open tasks that has a Space, for the left bar's Space row ("5 tasks · 2 lanes").
     * @returns {Record<string, number>}
     */
    openCounts() {
      /** @type {Record<string, number>} */
      const out = {};
      for (const id of known()) out[id] = openTasks(read(id)).length;
      return out;
    },

    /**
     * The lanes of every Space whose sync still waits for its chat's turn to end, said not sent with why: the runner
     * that held them is gone (Filament started again). → how many.
     * @param {string} why
     */
    dropWaiting(why) {
      let n = 0;
      for (const id of known()) {
        if (!read(id).syncs.some((s) => s.lanes.some((l) => l.state === "waiting"))) continue;
        change(id, (doc, at) => {
          for (const s of doc.syncs)
            for (const l of s.lanes)
              if (l.state === "waiting") {
                Object.assign(l, { state: "refused", error: why, at });
                n++;
              }
        });
      }
      return n;
    },
  };
  return store;
}

/** @typedef {ReturnType<typeof createSpaceStore>} SpaceStore */
