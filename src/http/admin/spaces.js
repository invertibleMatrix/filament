// @ts-check
// The admin API's Space area (proposal_ux §4.14, U5 phase 8 v1 to v3): a project's Space as the page shows it — its
// board, What happened (its logbook), its syncs, with each chat named — and the person's writes to it: a task added,
// changed, moved or removed, a line in the logbook, a sync run (app/space-sync.js). Beside them, what Overlaps and the
// merge order read of each lane's place (HarnessV4_Space_Plan SG-D5): the files it changed, committed and not, as git says
// them, fenced like every row that reads a folder (folder.js); the week's page as Markdown; and each project's open
// tasks, for the left bar. Its dashboards (S2): those it shows, kept or drafts, and the person's Keep, Pause, Remove and
// Read again (services/dashboard-runner.js). Your Space (S5b): every project's Needs you and At a glance, in one
// answer. A draft's sheet, its Send and Stop (S5c, app/space-drafts.js). Its routines (S6, app/routines.js): what runs by
// itself — each routine's row in words, the kept watches, Pause all — and the person's Switch on, Pause, Run now, Remove
// and Put back; memory's procedures of the project, for When you press Run. Pull from… (the Space Apps plan of 10-29,
// app/space-pulls.js): a board's pulls of Linear, GitHub or Jira, their sheet's Read once, a card's move — back to its
// service only on the person's word. A task's files (the owner's of 11-02, services/space-files.js): one attached, read,
// taken off. What its Spaces of one repository wrote, for another machine's Space of it, which pulls it (the remote-agents
// plan's sp-cross). The store says each change on the events
// stream (`space`), which an open Space follows. A project Filament does not know has no Space; one it knows has none
// until the person makes one — from its menu, or by the first thing they add on its page (`byNeed`, 11-12).
import { fewAtOnce } from "../../core/at-once.js";
import { FEED_LIMITS, SPACE_FILES, entryText, goneWords, machineFeed, needsShown, spaceFileName, spaceMarkdown, taskFields } from "../../core/space.js";
import { fileKindOf } from "../../services/space-files.js";
import { readFileSync } from "node:fs";
import { ARCHIVED_ROW, atWords, headWords, listenWords, routineRunsOn, rowWords } from "../../core/routines.js";
import { SPACE_ASKS, SPACE_EFFORTS } from "../../core/space-settings.js";
import { asProcedure } from "../../services/memory/procedures.js";
import { sendJson } from "../../app/pipeline/respond.js";
import { branchOf, remoteKey, remoteKeys } from "../../adapters/git/inspect.js";
import { agentFolderRefusal } from "./remote.js";
import { pressRefused } from "../guards.js";
import { pullAsksLess, pullFault } from "../../core/space-pulls.js";
import { LANES_MAX, placeFiles } from "../../app/space-lanes.js";
import { guard as guardWith } from "./guard.js";
import { poolName } from "../../core/pool.js";
import { allowedFolder } from "./folder.js";
import { join } from "node:path";
import { SPACES_FOLDER, computerFolders, documentsFolder, inRepo, reachLimits } from "../../app/own-spaces.js";
import { APPS_FOLDER, appStarters, copyStarter, newAppWords, startersFor } from "../../services/app-starters.js";
import { folderApps, importApp, notYetAdded } from "../../services/app-import.js";
import { publishFolderApp } from "../../app/agent/artifacts.js";

/** How many of the logbook's newest lines the page is given; it says how many more there are. */
export const LOG_SHOWN = 300;
/** How many of the newest syncs the page is given. */
export const SYNCS_SHOWN = 20;
/** The most places one files read reads: as many as an agent's read of the lanes (app/space-lanes.js). */
const FILES_PLACES_MAX = LANES_MAX;
/** How long another machine's feed takes a Space's folder's remote as read (sp-cross): read again after it. */
const FEED_REMOTE_MS = 5 * 60_000;

/**
 * The cursors another machine's feed is asked since (`since`, sp-cross): by each project here, where its last answer
 * left off — each that reads as one —; {} for none. Null where it is no JSON object.
 * @param {string | null} text @returns {Record<string, import("../../core/space.js").FeedCursor> | null}
 */
function cursorsIn(text) {
  if (!text) return {};
  /** @type {any} */
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  return Object.fromEntries(Object.entries(j).filter(([, c]) => c && Number.isFinite(c.at) && Number.isFinite(c.n)).map(([p, c]) => [p, { at: Number(c.at), n: Number(c.n) }]));
}

/**
 * The store's refusals name their status and are answered in their words; anything else is the shared guard's 500.
 * @param {(r: any, a: any) => any} fn
 */
const guard = (fn) =>
  guardWith(async (r, a) => {
    try {
      return await fn(r, a);
    } catch (/** @type {any} */ e) {
      if (Number.isInteger(e?.status) && e.status >= 400 && e.status < 600 && !r.res.headersSent) return sendJson(r.res, e.status, { error: e.message });
      throw e;
    }
  });

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function spaceRoutes(a) {
  const { config, memory } = a;
  /** @type {import("../../services/spaces.js").SpaceStore | null} */
  const spaces = a.spaces ?? null;
  /** @type {import("../../app/space-sync.js").SpaceSyncRunner | null} */
  const sync = a.spaceSync ?? null;
  /** @type {import("../../services/dashboard-runner.js").DashboardRunner | null} */
  const dashboards = a.dashboards ?? null;
  /** The dashboards' runner, or the refusal that says it is not wired. */
  const runner = () => {
    if (!dashboards) throw refused(503, "dashboards are not wired in this Filament");
    return dashboards;
  };
  /** @type {import("../../app/space-drafts.js").Drafts | null} */
  const drafts = a.spaceDrafts ?? null;
  /** The drafts' sheet and Send (S5c), or the refusal that says they are not wired. */
  const draftsOf = () => {
    if (!drafts) throw refused(503, "drafts are not wired in this Filament");
    return drafts;
  };
  /** @type {import("../../app/routines.js").Routines | null} */
  const routines = a.routines ?? null;
  /** A watcher's guidance held for the person, sent by their press. @type {import("../../app/watchers/guidance.js").Guiding | null} */
  const guidance = a.guidance ?? null;
  /** The script watchers' source: what a Switch on approves of one, and its sheet's words. @type {import("../../app/watchers/script.js").ScriptWatch | null} */
  const scripts = a.scriptWatch ?? null;
  /**
   * What a watcher's sheet says of what is its kind's own, which goes with its row's words. A script watcher's
   * (`script`): what it runs, the files a Switch on approves, its secrets by name and which have no value, as whom it
   * runs. A webhook watcher's (`webhook`): where its address answers, how its posts are signed, its bounds — never
   * the address. Nothing for any other. @param {string} project @param {import("../../core/routines.js").Routine} r
   */
  const sheetWords = (project, r) => {
    const script = scripts?.sheetOf(project, r);
    const webhook = webhooks?.sheetOf(r);
    return { ...(script ? { script } : {}), ...(webhook ? { webhook } : {}) };
  };
  /** The routines' runner (S6), or the refusal that says it is not wired. */
  const routinesOf = () => {
    if (!routines) throw refused(503, "routines are not wired in this Filament");
    return routines;
  };
  /** @type {import("../../app/watchers/webhook.js").WebhookWatch | null} */
  const webhooks = a.webhookWatch ?? null;
  /** The watchers' addresses a program posts to, or the refusal that says they are not wired. */
  const webhooksOf = () => {
    if (!webhooks) throw refused(503, "watchers' addresses are not wired in this Filament");
    return webhooks;
  };
  /** @type {import("../../app/space-pulls.js").Pulls | null} */
  const pulls = a.spacePulls ?? null;
  /** The board's pulls (the Space Apps plan of 10-29), or the refusal that says they are not wired. */
  const pullsOf = () => {
    if (!pulls) throw refused(503, "pulls are not wired in this Filament");
    return pulls;
  };
  /** @type {import("../../services/artifacts.js").ArtifactStore | null} */
  const artifacts = a.artifacts ?? null;
  /**
   * The apps a project's folder holds that no app of Filament's came from yet (Import app…): by the folder each was
   * published from, or — one published before Filament kept that — by its title among this Space's apps.
   * @param {{ id: string, cwd: string }} p
   */
  const newFolderApps = (p) => {
    const titles = dashboards ? dashboards.shown(p.id).filter((d) => d.type === "app").map((d) => String(d.title)) : [];
    return notYetAdded(folderApps(p.cwd), artifacts ? artifacts.list() : [], titles);
  };
  /**
   * An app's folder in the project published as a draft of its Space (Import app…), or the refusal that says why not.
   * @param {{ id: string, cwd: string }} p @param {string} folder @param {string} [lead]  what the refusal begins with
   */
  const draftOf = (p, folder, lead = "Not published") => {
    if (!artifacts) throw refused(503, "artifacts are not wired in this Filament");
    const got = publishFolderApp({ store: artifacts, folder, cwd: p.cwd, project: p.id, maxBytes: config.get().server.maxBodyBytes, port: (a.selfPort || (() => config.get().server.port))() });
    if (!got.ok) throw refused(400, got.error.replace(/^Not published/, lead));
    return got;
  };
  /** @type {(chain: string) => string} */
  const nameOf = a.spaceNames ?? ((chain) => chain);
  /** Whether a chat's words are none of another chat's agent's to read (core/space.js `readerNames`). @type {(chain: string) => boolean} */
  const apart = a.spaceApart ?? (() => false);
  /** Each Space's folder's remote's key as another machine's feed last read it (sp-cross), read again after FEED_REMOTE_MS. */
  const folderRemotes = remoteKeys({ ttl: FEED_REMOTE_MS });
  /**
   * A Space's folder's remote's key (`remoteKey`); null for none; undefined where git could not read the folder just
   * now (`remoteRead`'s `unread`), kept for no while: no remote is known either way.
   * @param {string} folder @returns {Promise<string | null | undefined>}
   */
  const remoteKeyOf = async (folder) => (await folderRemotes.of([folder])).get(folder);
  /** @type {import("../../app/own-spaces.js").OwnSpaces | null} */
  const ownSpaces = a.ownSpaces ?? null;
  /** Spaces of your own (A1), or the refusal that says they are not wired. */
  const ownOf = () => {
    if (!ownSpaces) throw refused(503, "Spaces of your own are not wired in this Filament");
    return ownSpaces;
  };
  /** @type {import("../../services/space-files.js").SpaceFiles | null} */
  const files = a.spaceFiles ?? null;
  /** The tasks' files (the owner's of 11-02), or the refusal that says they are not kept. */
  const filesOf = () => {
    if (!files?.on) throw refused(503, "this Filament keeps no files on tasks");
    return files;
  };
  /** The Spaces, or the refusal that says they are not wired. */
  const store = () => {
    if (!spaces) throw refused(503, "the Spaces are not wired in this Filament");
    return spaces;
  };
  /** The project a row names, known to the archive; else its refusal. @param {any} r @returns {{ id: string, name: string, cwd: string }} */
  const projectOf = (r) => {
    if (!memory?.archive) throw refused(503, `no archive: a Space belongs to a project the archive knows. ${memory?.archiveWhy?.() || ""}`.trim());
    const id = String(r.params.project || "");
    const p = memory.archive.getProject(id);
    if (!p) throw refused(404, "no such project");
    return { id, name: String(p.name || id), cwd: String(p.cwd || "") };
  };
  /**
   * A Space by need (11-12): what the person adds on a project's page that lives in a Space — a task, a line in What
   * happened, a sync, a pull, an app, a Keep — makes the project's Space with that same press where it has none, and
   * its answer says so, for the page to say: `made`, with `tasks`, how many came back from its old board. The store's
   * gate stays as it is (services/spaces.js `change`): nothing an agent, a routine, a sync or Filament itself writes
   * makes a Space — only the rows that call this, each an add of the person's. None gives its caller more than Make a
   * Space's own row, which asks no press (press.js) and answers neither a view-only device nor another machine's
   * agents, as none of these does (remote.js). Never while a deleted Space still waits: one made now would stand in
   * Bring back's way, and deleting that one would put the old one out of reach — refused here, before the row writes
   * anything. → the make, which the row calls once its body is checked and what it writes beside the Space is
   * written, so a write refused leaves no empty Space behind: what its answer carries.
   * @param {string} id @returns {() => { made?: true, tasks?: number }}
   */
  /** A deleted Space still waits for Bring back: said by the adds it refuses, and by a read that finds no Space. */
  const DELETED_WAITS = "This project's Space was deleted: bring it back, or make a new one, first.";
  /**
   * What a row that only reads says of a project with no Space: how one comes to be now (by need) — never "from its
   * menu" alone, which sent the person away from the page that makes it —, or that its deleted one waits.
   * @param {string} id
   */
  const noSpaceWords = (id) => (store().deletedAt(id) != null ? DELETED_WAITS : "This project has no Space yet: the first thing you add on its page makes one.");
  const byNeed = (id) => {
    if (store().has(id)) return () => ({});
    if (store().deletedAt(id) != null) throw refused(409, DELETED_WAITS);
    return () => {
      const out = store().make(id);
      return out.made ? { made: /** @type {const} */ (true), ...(out.tasks ? { tasks: out.tasks } : {}) } : {};
    };
  };
  /** The person, as the Space names who wrote. @type {import("../../core/space.js").SpaceAuthor} */
  const YOU = { kind: "you" };
  /**
   * Why a model cannot run an agent now, as the Agents page checks one — `{ problem }` — or nothing where it can, or none
   * is named. @param {string | undefined} model @returns {{ problem?: string }}
   */
  const modelProblemOf = (model) => {
    /** @type {string | null} */
    const cannot = model && a.subagentModelProblem ? a.subagentModelProblem(poolName(model)) : null;
    return cannot ? { problem: cannot } : {};
  };
  /** A body that is a JSON object, else the refusal that says what it is. @param {any} r @param {string} shape */
  const objectBody = async (r, shape) => {
    const b = await r.json();
    if (!b || typeof b !== "object" || Array.isArray(b)) throw refused(400, `a JSON object is required: ${shape}`);
    return b;
  };

  /**
   * What runs by itself (S6, screen 11) — a project's, or every project's (Your Space) with null: its head's words, Pause
   * all's moment, each routine with its row's words — a run under way read from its chat — and the chat that made it by
   * name, and each kept watch with its last and next look in words. The page never reads core: Filament says them.
   * The watchers are among the routines, and have a page and a head of their own (`listening`): `head` counts what
   * runs at times.
   * `keep`: the projects shown (Your Space's, those with a name), its head counting only theirs.
   * @param {string | null} project @param {(project: string) => boolean} [keep]
   */
  const runsOf = (project, keep = () => true) => {
    const at = Date.now();
    const pausedSince = store().pausedSince();
    const ids = (project == null ? [...new Set(store().routinesAll().map((x) => x.project))] : [project]).filter(keep);
    const rows = ids.flatMap((p) => {
      // A Space of the person's own whose folder is no git repository: its routines that write write there (A2c).
      const own = store().get(p).own;
      const inPlace = !!own && !inRepo(own.folder);
      // What each would run on now, and whose that model is (the owner's of 11-04): its sheet says it. Said of what
      // runs in a chat of its own — a routine at times, a watcher that wakes a new chat. A watcher's turn in the chat
      // that proposed it runs on that chat's model, and one that tells only the person runs nothing: no model is theirs.
      const space = store().runsOn(p);
      // The turns its watchers reviewed, as the Space keeps them: each watcher's row counts today's.
      const reviews = store().get(p).reviews || [];
      // Its project archived (r-itself, 11-12): nothing of it runs by itself, which each row says where its next time
      // would be; none of them counts in the head, nor is its next time the head's.
      const archived = store().archived(p);
      return (routines ? routines.live(p) : store().get(p).routines.map((r) => ({ r, live: null }))).map(({ r, live }) => ({
        ...r,
        project: p,
        ...(archived ? { archived: /** @type {const} */ (true) } : {}),
        madeName: nameOf(r.madeIn),
        words: { ...rowWords(r, { now: at, pausedSince, live, inPlace, nameOf, reviews, archived }), ...sheetWords(p, r) },
        ...(!r.trigger || (r.wakes || "new") === "new" ? { runsOn: routineRunsOn(r, space), spaceOn: { model: space.model, effort: space.effort, from: space.from } } : {}),
      }));
    });
    // A watch of an archived project's dashboard looks at nothing (s-itself, 11-12): its row says so where its next
    // look would be, in the routines' rows' words, and the head counts none of them.
    const watches = (dashboards ? dashboards.watches(project) : []).filter((w) => keep(w.project)).map((w) => ({
      ...w,
      lastWords: w.last ? atWords(w.last, at) : "not yet",
      nextWords: w.paused ? "paused" : w.archived ? ARCHIVED_ROW : pausedSince ? "Pause all is on" : w.nextAt ? atWords(w.nextAt, at) : "soon",
    }));
    const going = rows.filter((r) => r.state === "on" && !r.paused && !r.archived);
    const on = going.filter((r) => !r.trigger).map((r) => ({ title: r.title, nextAt: r.words.nextAt }));
    const looking = watches.filter((w) => !w.paused && !w.archived).map((w) => ({ title: `a watch of ${w.title}`, nextAt: w.nextAt }));
    // An agent's Pause all says who and why (HarnessV4_AgentsSpace_Plan SA-D3).
    const pausedBy = store().pausedAllBy();
    const listening = listenWords(going.filter((r) => r.trigger).length, { now: at, pausedSince, pausedBy });
    return { head: headWords(on, looking, { now: at, pausedSince, pausedBy }), listening, pausedSince, pausedBy, routines: rows, watches };
  };

  /**
   * A Space's asks settled as it is read (E42 SA-D7): one whose press was done — on its row or anywhere — or whose thing
   * moved goes to Done today by itself. A failure leaves them as they were: the read goes on.
   * @param {string} project
   */
  const settled = (project) => {
    try {
      if (dashboards) dashboards.asksSettle(project);
      else store().asksSettle(project);
    } catch (/** @type {any} */ e) {
      (a.log || (() => {}))("warn", `space: the asks of ${project} were not settled (${String(e?.message || e).slice(0, 160)})`);
    }
  };

  /**
   * A Space as the page shows it: its tasks, the newest of its logbook and its syncs; each chat it names, by name; and
   * the lanes a sync still waits for.
   * @param {string} project
   */
  const shown = (project) => {
    settled(project);
    const doc = store().get(project);
    const log = doc.log.slice(-LOG_SHOWN);
    const syncs = doc.syncs.slice(-SYNCS_SHOWN);
    const chains = new Set(
      [...doc.tasks.map((t) => t.chain), ...log.map((e) => e.by.chain), ...syncs.flatMap((s) => s.lanes.map((l) => l.chain))].filter(
        (c) => typeof c === "string" && c,
      ),
    );
    const ids = new Set(syncs.map((s) => s.id));
    const waiting = sync ? [...sync.waitingFor()].filter(([, s]) => ids.has(s)).map(([chain]) => chain) : [];
    // The Space of your own that shows this project (A7), whose connectors and plugins its chats get: the page's
    // "In Work" chip, and what it leaves to that Space (the owner's word of 10-26).
    const above = doc.own ? null : store().ownAbove(project);
    const aboveName = above && named(above) ? store().get(above).own?.name : null;
    return {
      project,
      seq: doc.seq,
      tasks: doc.tasks,
      log,
      logMore: doc.log.length - log.length,
      syncs,
      names: Object.fromEntries([...chains].map((c) => [c, nameOf(/** @type {string} */ (c))])),
      waiting,
      dashboards: dashboards ? dashboards.shown(project) : [],
      gone: dashboards ? dashboards.gone(project) : [],
      // What its kept dashboards feed into it (S4c): lines on its lanes, cards on its board.
      feeds: dashboards ? dashboards.feeds(project) : { lanes: [], tasks: [], counts: [] },
      // The services it pulls onto its board (the Space Apps plan of 10-29): their cards — read first, so each pull's
      // row says the read that starts — and each pull as its sheet opens.
      ...(pulls ? { pulled: pulls.cards(project), pulls: pulls.shown(project) } : {}),
      // Its Needs you rows Filament keeps (S5a): open and put off — one whose moment came is open again —, and those
      // done in the last two days, for Done today.
      needs: needsShown(doc.needs, Date.now()),
      // What runs by itself (S6): its routines, its kept watches, Pause all.
      runs: runsOf(project),
      // Its own settings, and what its agents run on with Settings › Space's under them (the owner's of 11-04).
      settings: doc.settings || {},
      runsOn: ((on) => ({ ...on, ...modelProblemOf(on.model) }))(store().runsOn(project)),
      // A Space of your own (HarnessV4_SpacesPlugins_Plan A3, A6): its name and folder, and whether that folder is in a git
      // repository — the page leaves out lanes, overlaps and places where it is not.
      ...(doc.own ? { own: { name: doc.own.name, folder: doc.own.folder, repo: inRepo(doc.own.folder) }, shows: showsOf(doc.own.shows || []) } : {}),
      ...(above && aboveName ? { shownIn: { id: above, name: aboveName } } : {}),
    };
  };

  /**
   * The projects a Space of your own shows (A7), as a view: each one's rows in Needs you — open, put off, done of late —
   * with its project, the dashboards its Space shows (for their chips), its watchers by id (for their rows' chip, where
   * it has any), and its kept dashboards' status tiles. A row done here is done in its own Space, which the rows' writes
   * go to. A project the archive no longer knows is left out.
   * @param {readonly string[]} ids
   */
  const showsOf = (ids) => {
    const at = Date.now();
    const known = ids.map(named).filter((p) => p != null);
    if (!known.length) return [];
    const tiles = dashboards ? dashboards.glance({ projects: new Set(known.map((p) => p.id)) }) : [];
    return known.map((p) => {
      settled(p.id);
      const doc = store().get(p.id);
      const watchers = doc.routines.filter((r) => r.trigger && r.state !== "removed").map((r) => r.id);
      return {
        ...p,
        needs: needsShown(doc.needs, at).map((n) => ({ ...n, project: p.id })),
        dashboards: dashboards ? dashboards.shown(p.id).map((d) => ({ name: d.name, title: d.title, state: d.state, paused: d.paused })) : [],
        glance: tiles.filter((g) => g.project === p.id),
        ...(watchers.length ? { watchers } : {}),
      };
    });
  };

  /** A project the archive knows, as Your Space names it; null for one it does not (a Space whose project went). @param {string} id */
  const named = (id) => {
    const p = memory?.archive?.getProject(id);
    return p ? { id, name: String(p.name || id), cwd: String(p.cwd || "") } : null;
  };
  /** @param {Record<string, number>} counts */
  const ofKnown = (counts) => Object.fromEntries(Object.entries(counts).filter(([id]) => named(id)));

  /**
   * What the left bar draws under each Space's row (the owner's idea of 10-29): `apps`, each of its apps and dashboards
   * as its tab read them — what `tabOf` reads, never their content —, for those with any; `routines`, whether one
   * fails now, for those with a routine at times or a kept watch (`routinesShown`); `watchers`, the same for those
   * with a watcher (`watchersShown`).
   * @param {string[]} ids  the projects with a Space
   */
  const barOf = (ids) => {
    const known = [...new Set(ids)].filter((id) => named(id));
    /** @type {Record<string, any[]>} */
    const apps = {};
    // Every Space's at once, the artifacts listed once: the bar asks at every Space's change.
    const shownOf = dashboards ? dashboards.shownIn(known) : {};
    for (const id of known) {
      const list = shownOf[id] || [];
      // `changed` and `unrecorded`: scripts it runs that wait for your Keep, which its row's dot and tip say.
      if (list.length) apps[id] = list.map((d) => ({ name: d.name, title: d.title, type: d.type, v: d.v, state: d.state, draft: d.draft, paused: d.paused, liveV: d.liveV, sources: d.sources, changed: d.changed, ...(d.unrecorded ? { unrecorded: true } : {}) }));
    }
    /** @type {Record<string, { failed: boolean }>} */
    const routinesOf = {};
    /** @type {Record<string, { failed: boolean }>} */
    const watchersOf = {};
    const runs = known.length ? runsOf(null, (p) => known.includes(p)) : { routines: [], watches: [] };
    // What fails now: its last run failed, and it is on and not paused — one proposed again or paused runs nothing, and
    // its row says that of it (the page's twin: ui/harness/lib/space-view.js `standsFailed`).
    const failsNow = (/** @type {{ state: string, paused: boolean, words: { tone: string } }} */ x) => x.state !== "proposed" && !x.paused && x.words.tone === "bad";
    for (const id of known) {
      const mine = runs.routines.filter((x) => x.project === id && x.state !== "removed");
      const timed = mine.filter((x) => !x.trigger);
      const woken = mine.filter((x) => x.trigger);
      if (timed.length || runs.watches.some((w) => w.project === id)) routinesOf[id] = { failed: timed.some(failsNow) };
      if (woken.length) watchersOf[id] = { failed: woken.some(failsNow) };
    }
    return { apps, routines: routinesOf, watchers: watchersOf };
  };

  /** A Space deleted or brought back: the routines' timer and the dashboards' watches set again from what the Spaces hold now. */
  const afterMove = () => {
    try {
      routines?.arm?.();
      dashboards?.reschedule?.();
    } catch (/** @type {any} */ e) {
      (a.log || (() => {}))("warn", `space: what runs by itself was not set again (${String(e?.message || e).slice(0, 160)})`);
    }
  };

  return [
    // Each project's open tasks that has a Space: the left bar's Space row counts them. Beside them (S5b), each one's
    // open rows in Needs you, and whether Your Space shows: its row counts them with the chats'.
    [
      "GET",
      "/spaces",
      guard((r) => {
        const at = Date.now();
        // `next`: when the counts change by themselves — a row put off comes back —, for the left bar to ask again then.
        // `own`: the Spaces of the person's own, for the bar's Spaces section (HarnessV4_SpacesPlugins_Plan A6).
        // Only those whose project the archive knows: one whose project went is no Space to open (found by the Hunter on A6).
        const own = store().owns().filter(({ project }) => named(project)).map(({ project, own: o }) => ({ project, name: o.name, folder: o.folder }));
        // `open` names every project that has a Space (10-29: those the person made); `back`, those whose deleted Space
        // Bring back may still have, and when each was deleted.
        const open = store().openCounts();
        return sendJson(r.res, 200, { open, needs: ofKnown(store().needCounts(at)), extended: store().extended(at, { known: (id) => !!named(id) }) || own.length > 0, next: store().needsNext(at), own, back: ofKnown(store().deletedAll()), ...barOf([...Object.keys(open), ...own.map((o) => o.project)]) });
      }),
    ],
    // What this machine's Spaces of one repository wrote, for another machine's Space of it (the remote-agents plan's
    // sp-cross): that machine pulls it through the agents' device it keeps here (services/space-machines.js), as this
    // one may not reach it. Each Space whose project's folder has the remote named — in any of its forms, as /clones
    // matches one — and is a folder another machine's agents may use (remote.js `agentFolderRefusal`): its lines since
    // its cursor in `since`, its open rows of Needs you, and its cursor next (core/space.js `machineFeed`). `left`: how
    // many such Spaces lie in a folder those agents may not use, left out; `past`: how many past the most one feed
    // carries, or in a folder git could not read just now, left out too — an answer that names some alone, which
    // closes none of the rest there (the swarm's review of 11-10: an unread folder was read as no remote). Where the projects
    // or the chats' folders cannot be read, no Space is known for one: a 503 in words, never an answer naming none, which
    // that machine would read as every Space gone (the hu-feed hunt's). It reads alone.
    [
      "GET",
      "/spaces/machine-feed",
      guard(async (r) => {
        const key = remoteKey(String(r.url.searchParams.get("remote") || "").trim());
        if (!key) return sendJson(r.res, 400, { error: "name the repository with remote=: its remote's URL, as `git remote get-url origin` prints it" });
        const since = cursorsIn(r.url.searchParams.get("since"));
        if (!since) return sendJson(r.res, 400, { error: 'since is the last answer\'s cursors, as JSON: { "<project>": { "at": <ms>, "n": <number> } }' });
        if (!memory?.archive) return sendJson(r.res, 503, { error: `no archive: a Space belongs to a project the archive knows, so no Space is fed. ${memory?.archiveWhy?.() || ""}`.trim() });
        /** @type {string[]} */
        let folders = [];
        try {
          folders = memory.chatFolders?.({ person: true }) || [];
        } catch (/** @type {any} */ e) {
          return sendJson(r.res, 503, { error: `the chats' folders could not be read (${String(e?.message || e).slice(0, 200)}): no Space is fed` });
        }
        const roots = config.get().agentLoop?.roots || [];
        const at = Date.now();
        const spaces = [];
        let left = 0;
        let past = 0;
        for (const project of store().projects()) {
          if (!store().has(project) || store().get(project).own) continue;
          const folder = named(project)?.cwd;
          const its = folder ? await remoteKeyOf(folder) : null;
          // A folder git could not read just now may be of this repository: left out, said by `past`, never named gone.
          if (its === undefined) {
            past++;
            continue;
          }
          if (!folder || its !== key) continue;
          if (agentFolderRefusal(folder, { dataDir: a.dataDir, roots, folders })) {
            left++;
            continue;
          }
          if (spaces.length >= FEED_LIMITS.spaces) {
            past++;
            continue;
          }
          spaces.push({ project, ...machineFeed(store().get(project), { since: Object.hasOwn(since, project) ? since[project] : null, nameOf, apart, now: at }) });
        }
        return sendJson(r.res, 200, { key, spaces, left, past });
      }),
    ],
    [
      // Your Space (S5b): every project's rows in Needs you — open, put off, done of late —, each with its project; the
      // projects they name and the dashboards each shows, for their chips; At a glance. `?glance=0` leaves out At a
      // glance and its reads (the tray's look).
      "GET",
      "/your-space",
      guard((r) => {
        const at = Date.now();
        // Each Space with an ask open, settled first (E42 SA-D7).
        for (const p of new Set(store().needsAll(at).filter((n) => n.kind === "ask" && n.state !== "done").map((n) => n.project))) settled(p);
        const needs = store().needsAll(at).filter((n) => named(n.project));
        const glance = r.url.searchParams.get("glance") === "0" || !dashboards ? [] : dashboards.glance().filter((g) => named(g.project));
        // Its Routines tab (S6): every project's routines and kept watches, each with its project.
        const runs = runsOf(null, (p) => !!named(p));
        const ids = [...new Set([...needs.map((n) => n.project), ...glance.map((g) => g.project), ...runs.routines.map((x) => x.project), ...runs.watches.map((w) => w.project)])];
        // The Space of your own that shows a project (A7): Home names it on the project's chip.
        const showers = new Map(store().owns().flatMap(({ project, own: o }) => (o.shows || []).map((p) => [p, { id: project, name: o.name }])));
        return sendJson(r.res, 200, {
          projects: ids.map((id) => {
            const p = named(id);
            const s = showers.get(id);
            return p && s ? { ...p, space: s } : p;
          }),
          needs,
          dashboards: Object.fromEntries(ids.map((id) => [id, dashboards ? dashboards.shown(id).map((d) => ({ name: d.name, title: d.title, state: d.state, paused: d.paused })) : []])),
          glance,
          runs,
          extended: store().extended(at),
        });
      }),
    ],
    // Spaces of your own (HarnessV4_SpacesPlugins_Plan A1, A2): every one, with where a new one's folder goes and the
    // drives "the whole computer" lists; make one, change its name or what it may read, delete it (its folder stays).
    [
      "GET",
      "/spaces/own",
      guard((r) => {
        const own = ownOf();
        // `limits`: what narrows what a Space may read, in words, for the New Space sheet (A2).
        return sendJson(r.res, 200, { spaces: own.list(), folder: join(documentsFolder(), SPACES_FOLDER), drives: computerFolders(), limits: reachLimits(config.get()) });
      }),
    ],
    ["POST", "/spaces/own", guard(async (r) => sendJson(r.res, 200, ownOf().make(await objectBody(r, "{ name, folder?, reach?, folders? }"))))],
    [
      "PATCH",
      "/space/:project/own",
      guard(async (r) => {
        const b = await objectBody(r, "{ name?, reach?, folders? }");
        // What its chats may read, widened — a folder its layer does not list yet — is a press, as the folders a chat
        // works in are in every settings row (press.js; s-rows, 11-12): the agent reads there without asking. Its name,
        // the same folders again and fewer of them need none.
        const unpressed = pressRefused(r.req);
        if (unpressed && ownOf().widens(projectOf(r).id, b)) return sendJson(r.res, 403, { error: unpressed, press: true });
        return sendJson(r.res, 200, ownOf().change(projectOf(r).id, b));
      }),
    ],
    ["DELETE", "/space/:project/own", guard(async (r) => sendJson(r.res, 200, await ownOf().remove(projectOf(r).id)))],
    // The projects a Space of your own shows (A7): `{ add }` one more — it leaves the Space that showed it before —, or
    // `{ drop }` one. The project stays under Projects; its chats get the Space's connectors and plugins while it shows.
    [
      "POST",
      "/space/:project/own/shows",
      guard(async (r) => {
        const id = projectOf(r).id;
        const b = await objectBody(r, "{ add? } or { drop? }: a project's id");
        const add = typeof b.add === "string" ? b.add : undefined;
        const drop = typeof b.drop === "string" ? b.drop : undefined;
        if (!add === !drop) throw refused(400, "say which project: { add } or { drop }, its id");
        if (add && !named(add)) throw refused(404, "There is no such project to show.");
        const shows = store().ownShows(id, add ? { add } : { drop });
        return sendJson(r.res, 200, { ok: true, shows, space: shown(id) });
      }),
    ],
    [
      // A project's Space; one with none (10-29: none until the person makes one) answers 404 with `none` — and when its
      // deleted Space was deleted, where Bring back may still have it. With it, the drafts its chats published (by need,
      // 11-12): its page shows each with its Keep…, which makes the Space.
      "GET",
      "/space/:project",
      guard((r) => {
        const { id } = projectOf(r);
        if (!store().has(id)) return sendJson(r.res, 404, { error: noSpaceWords(id), none: true, deletedAt: store().deletedAt(id), dashboards: dashboards ? dashboards.shown(id) : [] });
        return sendJson(r.res, 200, shown(id));
      }),
    ],
    [
      // Make a Space (10-29): one press; an old board's tasks come back with it. → whether it was made now, and how many.
      // `{ need: true }` (by need, 11-12): the make of a press that only fills a box with an ask — Routine…, Watcher…,
      // What do you look after…, Watch this chat… —, whose agent answers through the space tool, so the Space is there
      // before the message goes: made as an add makes it (`byNeed`), never over a deleted one that waits.
      "POST",
      "/space/:project",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await r.json();
        const made = b?.need === true ? byNeed(id)() : store().make(id);
        return sendJson(r.res, 200, { ok: true, ...made, space: shown(id) });
      }),
    ],
    [
      // Delete Space… (10-29): its file kept 30 days for Bring back; what ran by itself in it stops now.
      "DELETE",
      "/space/:project",
      guard((r) => {
        const { id } = projectOf(r);
        // A draft of it being sent waits for its Send's end, as its Discard does (found by the Hunter on Space optional).
        if (drafts?.sendingIn(id)) throw refused(409, "A draft of it is being sent: wait for it, or stop it from its sheet (Review & send…).");
        const out = store().remove(id);
        afterMove();
        return sendJson(r.res, 200, { ok: true, ...out });
      }),
    ],
    [
      // Bring back (10-29): a deleted Space as it was, within 30 days — the toast's Undo too.
      "POST",
      "/space/:project/back",
      guard((r) => {
        const { id } = projectOf(r);
        // An app kept in another Space since comes back taken out, named by its title, at its newest version as a
        // take-out keeps it.
        const out = store().bringBack(id, {
          appOf: (name) => {
            const app = artifacts?.get(name);
            return { title: app?.title || name, v: app?.versions.length || 0 };
          },
        });
        afterMove();
        return sendJson(r.res, 200, { ok: true, ...out, space: shown(id) });
      }),
    ],
    // What of its Space goes with a project deleted (HarnessV4_SpacesPlugins_Plan A5): the delete dialog's line, empty
    // for a Space nobody used.
    ["GET", "/space/:project/goes", guard((r) => sendJson(r.res, 200, { words: goneWords(store().get(projectOf(r).id)) }))],
    [
      // A task the person adds: `{ title, line?, column?, parked?, chain?, place? }`.
      "POST",
      "/space/:project/tasks",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ title, line?, column?, parked?, chain?, place? }");
        const f = taskFields(b, { create: true });
        if (!f.ok) throw refused(400, f.error);
        const made = byNeed(id)();
        const task = store().addTask(id, b, YOU);
        return sendJson(r.res, 200, { ok: true, task, ...made, space: shown(id) });
      }),
    ],
    [
      // A task's fields the person changes — its column moves it, with the times that go with it.
      "PATCH",
      "/space/:project/tasks/:id",
      guard(async (r) => {
        const { id } = projectOf(r);
        const task = store().changeTask(id, r.params.id, await objectBody(r, "{ title?, line?, column?, parked?, chain?, place?, order? }, the fields to change"));
        return sendJson(r.res, 200, { ok: true, task, space: shown(id) });
      }),
    ],
    [
      // A task removed, the files attached to it with it.
      "DELETE",
      "/space/:project/tasks/:id",
      guard((r) => {
        const { id } = projectOf(r);
        const t = store().removeTask(id, r.params.id);
        files?.forget(id, (t.files || []).map((f) => f.id));
        return sendJson(r.res, 200, { ok: true, space: shown(id) });
      }),
    ],
    [
      // A file attached to a task (the owner's of 11-02): `{ name, data }`, its bytes in base64. What it is — a picture,
      // a PDF, text or another file — is read from its bytes.
      "POST",
      "/space/:project/tasks/:id/files",
      guard(async (r) => {
        const { id } = projectOf(r);
        const kept = filesOf();
        const b = await objectBody(r, "{ name, data }, its bytes in base64");
        if (typeof b.data !== "string" || !b.data) throw refused(400, "data is the file, in base64");
        const name = spaceFileName(b.name);
        const t = store().get(id).tasks.find((x) => x.id === r.params.id);
        if (!t) throw refused(404, "no such task");
        const data = Buffer.from(b.data, "base64");
        if (!data.length) throw refused(400, `${name} is empty`);
        if (data.length > SPACE_FILES.fileBytes) throw refused(413, `${name} is ${(data.length / 1048576).toFixed(1)} MB: a file on a task is ${SPACE_FILES.fileBytes / 1048576} MB at most`);
        const fid = /** @type {string} */ (kept.keep(id, data));
        try {
          const file = store().taskFileAdd(id, t.id, { id: fid, name, ...fileKindOf(data), bytes: data.length, at: Date.now() });
          return sendJson(r.res, 200, { ok: true, file, task: store().get(id).tasks.find((x) => x.id === t.id), space: shown(id) });
        } catch (e) {
          kept.forget(id, [fid]);
          throw e;
        }
      }),
    ],
    [
      // A task's file: a picture shown as one, text as text, any other kind as a download — never run on this page's
      // address. Its id names its bytes, which never change.
      "GET",
      "/space/:project/tasks/:id/files/:file",
      guard((r) => {
        const { id } = projectOf(r);
        const f = (store().get(id).tasks.find((x) => x.id === r.params.id)?.files || []).find((x) => x.id === r.params.file);
        const path = f ? filesOf().pathOf(id, f.id) : null;
        if (!f || !path) throw refused(404, "no such file on this task");
        const data = readFileSync(path);
        const inline = f.kind === "image" || f.kind === "text";
        r.res.writeHead(200, {
          "content-type": f.kind === "image" || f.kind === "pdf" || f.kind === "text" ? f.type : "application/octet-stream",
          "content-length": data.length,
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox",
          "cache-control": "private, max-age=604800, immutable",
          ...(inline ? {} : { "content-disposition": `attachment; filename="${f.name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(f.name)}` }),
        });
        return r.res.end(data);
      }),
    ],
    [
      "DELETE",
      "/space/:project/tasks/:id/files/:file",
      guard((r) => {
        const { id } = projectOf(r);
        const f = store().taskFileRemove(id, r.params.id, String(r.params.file));
        files?.forget(id, [f.id]);
        return sendJson(r.res, 200, { ok: true, space: shown(id) });
      }),
    ],
    // Pull from… (the Space Apps plan of 10-29, decision 7): what the sheet starts from for each service; its Read once,
    // which calls the read-only tool and keeps nothing; a pull set up, changed or taken off; read again; a card moved —
    // on the board only, or back to its service when the person says so —; its moves going back without asking.
    ["GET", "/space/:project/pulls/presets", guard((r) => (projectOf(r), sendJson(r.res, 200, { presets: pullsOf().presets() })))],
    [
      // A connector's tools, each marked read-only or not: `?connection=`. Its server is asked; nothing is called.
      "GET",
      "/space/:project/pulls/tools",
      guard(async (r) => {
        const { id } = projectOf(r);
        return sendJson(r.res, 200, await pullsOf().toolsOf(id, r.url.searchParams.get("connection") || ""));
      }),
    ],
    [
      "POST",
      "/space/:project/pulls/try",
      guard(async (r) => {
        const { id } = projectOf(r);
        return sendJson(r.res, 200, await pullsOf().tryRead(id, await objectBody(r, "{ service, connection, tool, args, paths? }")));
      }),
    ],
    [
      // A pull set up, or the one of `id` changed: `{ id?, service, title, connection, tool, args, rows, key, name, state?,
      // url?, line?, columns, back?, always? }`. One that lets more go back into its service than the pull it replaces —
      // a way back that is new or another, Always — is a press (core/space-pulls.js `pullAsksLess`; the re-read of
      // 11-11: a save set both with no key, and a card then moved back with no ask).
      "POST",
      "/space/:project/pulls",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ id?, service, title, connection, tool, args, rows, key, name, state?, url?, line?, columns, back?, always? }");
        const unpressed = pressRefused(r.req);
        const was = unpressed ? (store().get(id).pulls || []).find((p) => p.id === String(b.id ?? "").trim()) || null : null;
        if (unpressed && pullAsksLess(b, was)) return sendJson(r.res, 403, { error: unpressed, press: true });
        const fault = pullFault(b);
        if (fault) throw refused(400, fault);
        const made = byNeed(id)();
        const pull = store().pullSave(id, b);
        return sendJson(r.res, 200, { ok: true, pull, ...made, space: shown(id) });
      }),
    ],
    [
      "DELETE",
      "/space/:project/pulls/:id",
      guard((r) => {
        const { id } = projectOf(r);
        store().pullRemove(id, String(r.params.id));
        pullsOf().forget(id, String(r.params.id));
        return sendJson(r.res, 200, { ok: true, space: shown(id) });
      }),
    ],
    [
      "POST",
      "/space/:project/pulls/:id/read",
      guard(async (r) => {
        const { id } = projectOf(r);
        const out = await pullsOf().readNow(id, String(r.params.id));
        return sendJson(r.res, 200, { ...out, space: shown(id) });
      }),
    ],
    [
      // A card moved: `{ key, column, back?, always? }` — `back`, in its service too; `always`, Always for this board.
      "POST",
      "/space/:project/pulls/:id/move",
      guard(async (r) => {
        const { id } = projectOf(r);
        const out = await pullsOf().move(id, String(r.params.id), await objectBody(r, "{ key, column, back?, always? }"));
        return sendJson(r.res, 200, { ...out, space: shown(id) });
      }),
    ],
    [
      // Its moves going back without asking, or asking again: `{ on }`.
      "POST",
      "/space/:project/pulls/:id/always",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ on }");
        if (typeof b.on !== "boolean") throw refused(400, "on is true or false");
        const pull = store().pullAlways(id, String(r.params.id), b.on);
        return sendJson(r.res, 200, { ok: true, pull, space: shown(id) });
      }),
    ],
    [
      // A row of Needs you done, put off, or brought back (S5a): `{ done: true }`, `{ later: <when it comes back> }`,
      // `{ back: true }`; a draft (S5c) discarded, `{ discard: true }`, or its words kept as the person left them,
      // `{ words }`.
      "POST",
      "/space/:project/needs/:id",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ done: true }, { later: <when it comes back> }, { back: true }, { discard: true }, { words } or, for an ask, { turnDown: true }");
        // A draft being sent waits for its Send's end: discarded meanwhile, what went out was marked sent over it (found
        // by the Hunter on S5c: the row's Discard, a second tab, beside a sheet closed while it sent).
        if (drafts?.sending(id, String(r.params.id))) throw refused(409, "It is being sent: wait for it, or stop it from its sheet (Review & send…).");
        const row = store().needChange(id, r.params.id, b);
        return sendJson(r.res, 200, { ok: true, row, space: shown(id) });
      }),
    ],
    [
      // A draft's sheet as it opens, or as its From picks another account (S5c): `?account=`. Its server is asked
      // whether the tool can send; nothing is called.
      "GET",
      "/space/:project/needs/:id/draft",
      guard(async (r) => {
        const { id } = projectOf(r);
        return sendJson(r.res, 200, await draftsOf().look(id, String(r.params.id), r.url.searchParams.get("account") || undefined));
      }),
    ],
    [
      // A draft sent, by the person's Send: `{ words, account? }`. The answer comes once its tool ended: `sent`, with
      // what it said and its link; or not, and why.
      "POST",
      "/space/:project/needs/:id/send",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ words, account? }");
        const out = await draftsOf().send(id, String(r.params.id), { words: b.words, account: b.account });
        return sendJson(r.res, 200, { ok: true, ...out, space: shown(id) });
      }),
    ],
    [
      // A draft's Send under way, stopped: Stop on its sheet.
      "POST",
      "/space/:project/needs/:id/send/stop",
      guard((r) => {
        const { id } = projectOf(r);
        if (!draftsOf().stop(id, String(r.params.id))) throw refused(409, "nothing of it is being sent");
        return sendJson(r.res, 200, { ok: true });
      }),
    ],
    [
      // A watcher's guidance held for the person past its cap (app/watchers/guidance.js), sent by their Send it: that
      // one goes to the chat it is for now — into its running turn, as a turn of Filament's own, or as it next lets go.
      "POST",
      "/space/:project/needs/:id/guide",
      guard(async (r) => {
        const { id } = projectOf(r);
        if (!guidance) throw refused(503, "guidance is not wired in this Filament");
        const out = await guidance.sendHeld(id, String(r.params.id));
        return sendJson(r.res, 200, { ...out, space: shown(id) });
      }),
    ],
    [
      // A line the person writes in the logbook: `{ text, task? }`.
      "POST",
      "/space/:project/log",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ text, task? }");
        const t = entryText(b.text);
        if (!t.ok) throw refused(400, t.error);
        // A line on a task needs that task, so a Space: the store refuses it where there is none.
        const made = b.task ? {} : byNeed(id)();
        const entry = store().write(id, b.text, YOU, b.task ? String(b.task) : null);
        return sendJson(r.res, 200, { ok: true, entry, ...made, space: shown(id) });
      }),
    ],
    [
      // A sync the person runs: `{ lanes: [{ chain, when: "now" | "after" }], also?, asks? }` — each lane's chat is sent its
      // message (app/space-sync.js); `asks`, the asks to tell it carries (E42 SA-D7). The answer is the sync as it
      // began, each lane's outcome following on the stream.
      "POST",
      "/space/:project/sync",
      guard(async (r) => {
        const { id } = projectOf(r);
        if (!sync) throw refused(503, "syncs are not wired in this Filament");
        const b = await objectBody(r, '{ lanes: [{ chain, when: "now" | "after" }], also?, asks? }');
        const need = byNeed(id);
        let made = {};
        const out = sync.run(id, b, { ready: () => void (made = need()) });
        if (!out.ok) return sendJson(r.res, 400, { error: out.error });
        return sendJson(r.res, 200, { ok: true, sync: out.sync, ...made, space: shown(id) });
      }),
    ],
    [
      // What each lane's place changed, for the owners panel and the merge order: `?place=<folder>`, once per place.
      "GET",
      "/space/:project/files",
      guard(async (r) => {
        projectOf(r);
        const asked = [...new Set(r.url.searchParams.getAll("place").map(String).filter(Boolean))];
        if (asked.length > FILES_PLACES_MAX) throw refused(400, `one read takes ${FILES_PLACES_MAX} folders at most`);
        const places = await fewAtOnce(asked, async (path) => {
          const f = allowedFolder(config.get(), path);
          if (!f.ok) return { path, ok: false, error: f.status === 404 ? "the folder is gone" : f.error, branch: null, base: null, ahead: null, commits: 0, files: [], more: 0 };
          return placeFiles(await branchOf(f.root), path);
        });
        return sendJson(r.res, 200, { places });
      }),
    ],
    // ＋ New app (the Space Apps plan of 10-29): its starters, and the words its Start opens with — a starter with a
    // folder copied into the project's .filament/apps/ first, for the agent to adapt. Nothing is sent: the person reads
    // the Start and sends it.
    // A Space of your own offers its own starters, none of them about a codebase (the Designer's redesign of 10-29).
    ["GET", "/space/:project/starters", guard(async (r) => sendJson(r.res, 200, { starters: startersFor(!!spaces?.get(projectOf(r).id)?.own) }))],
    [
      "POST",
      "/space/:project/new-app",
      guard(async (r) => {
        const p = projectOf(r);
        const b = await objectBody(r, "{ said?, starter? }");
        const said = typeof b.said === "string" ? b.said : "";
        const id = typeof b.starter === "string" && b.starter ? b.starter : null;
        const starter = id ? appStarters().find((s) => s.id === id) || null : null;
        if (id && !starter) throw refused(404, `Filament has no starter ${id}`);
        if (!said.trim() && !starter) throw refused(400, "say what it should do, or pick a starter");
        const own = !!spaces?.get(p.id)?.own;
        // Its Start's agent publishes the app into the Space: it is there before the message goes (by need, 11-12).
        const need = byNeed(p.id);
        if (!starter?.folder) return sendJson(r.res, 200, { words: newAppWords({ project: p.name, said, starter, own }), ...need() });
        const made = copyStarter(starter.id, p.cwd);
        if (!made.ok) throw refused(409, made.error);
        return sendJson(r.res, 200, { words: newAppWords({ project: p.name, said, starter, folder: made.folder, own }), folder: made.folder, files: made.files, ...need() });
      }),
    ],
    // The apps a project's folder brings, under .filament/apps/ (Import app…, phase 4): those no app of Filament's came
    // from yet, which Add to this Space… offers; one added is published as a draft of this Space, with no chat.
    [
      "GET",
      "/space/:project/folder-apps",
      guard(async (r) => {
        const p = projectOf(r);
        return sendJson(r.res, 200, { apps: newFolderApps(p).map(({ folder, title, description }) => ({ folder, title, description })) });
      }),
    ],
    [
      "POST",
      "/space/:project/folder-apps",
      guard(async (r) => {
        const p = projectOf(r);
        const b = await objectBody(r, "{ folder }");
        const found = folderApps(p.cwd).find((x) => x.folder === b.folder);
        if (!found) throw refused(404, `${typeof b.folder === "string" ? b.folder : "That folder"} holds no app of this project's: an app's folder under ${APPS_FOLDER}/ holds app.json and index.html`);
        const need = byNeed(p.id);
        const got = draftOf(p, found.folder);
        return sendJson(r.res, 200, { ok: true, name: got.name, title: got.title, ...need(), space: shown(p.id) });
      }),
    ],
    [
      // Import app…: a .zip — an app's download, or its folder zipped — `{ data }` in base64, unpacked into this project's
      // .filament/apps/ and published as a draft of its Space. Nothing runs until the person keeps it.
      "POST",
      "/space/:project/import-app",
      guard(async (r) => {
        const p = projectOf(r);
        const b = await objectBody(r, "{ data }");
        if (typeof b.data !== "string" || !b.data) throw refused(400, "data is the .zip, in base64");
        const need = byNeed(p.id);
        const made = importApp(Buffer.from(b.data, "base64"), p.cwd, { maxBytes: config.get().server.maxBodyBytes });
        if (!made.ok) throw refused(400, made.error);
        const got = draftOf(p, made.folder, `It is unpacked in ${made.folder}, but not published`);
        return sendJson(r.res, 200, { ok: true, name: got.name, title: got.title, folder: made.folder, ...need(), space: shown(p.id) });
      }),
    ],
    [
      // A dashboard kept in this Space at the version the person's Keep sheet showed: `{ v }` (HarnessV4_Space_Plan
      // SG-D7). What that version reads and watches is what it may do from now on.
      "POST",
      "/space/:project/dashboards/:name/keep",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ v }, the version kept");
        const v = Number(b.v);
        if (!Number.isInteger(v) || v < 1) throw refused(400, "v is the version kept, a whole number from 1");
        const need = byNeed(id);
        let made = {};
        const out = runner().keep(id, String(r.params.name), v, { ready: () => void (made = need()) });
        if (!out.ok) throw refused(out.status, out.error);
        return sendJson(r.res, 200, { ok: true, dashboard: out.dashboard, ...made, space: shown(id) });
      }),
    ],
    [
      // What the Space's kept dashboards reach out through (S4b): the Connections sheet's Used by and Programs.
      "GET",
      "/space/:project/connections",
      guard(async (r) => {
        const { id } = projectOf(r);
        return sendJson(r.res, 200, runner().usesOf(id));
      }),
    ],
    [
      // What each connection's tool a dashboard names is, as its Keep sheet opens (S4a): each server asked for its
      // tools; nothing is called.
      "GET",
      "/space/:project/dashboards/:name/tools",
      guard(async (r) => {
        const { id } = projectOf(r);
        // `?kept=1`: What it may do — the tools the kept grant names, not the newest version's.
        const out = await runner().toolsOf(id, String(r.params.name), { kept: r.url.searchParams.get("kept") === "1" });
        if (!out.ok) throw refused(out.status, out.error);
        return sendJson(r.res, 200, { tools: out.tools });
      }),
    ],
    [
      // A kept dashboard paused or going on: `{ paused }`.
      "POST",
      "/space/:project/dashboards/:name/pause",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ paused }");
        if (typeof b.paused !== "boolean") throw refused(400, "paused is true or false");
        runner().change(id, String(r.params.name), { paused: b.paused });
        return sendJson(r.res, 200, { ok: true, space: shown(id) });
      }),
    ],
    [
      // A kept dashboard shown on Your Space's At a glance, or not (S5b): `{ on }`.
      "POST",
      "/space/:project/dashboards/:name/glance",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ on }");
        if (typeof b.on !== "boolean") throw refused(400, "on is true or false");
        runner().setGlance(id, String(r.params.name), b.on);
        return sendJson(r.res, 200, { ok: true, space: shown(id) });
      }),
    ],
    [
      // A kept one's sends button agents may press without asking you, or ask again (10-29): `{ action, on }`. The
      // person's alone: the space tool has no way to it.
      "POST",
      "/space/:project/dashboards/:name/allow",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ action, on }");
        if (typeof b.action !== "string" || !b.action) throw refused(400, "action is the button's name");
        if (typeof b.on !== "boolean") throw refused(400, "on is true or false");
        const out = runner().allow(id, String(r.params.name), b.action, b.on);
        if (!out.ok) throw refused(out.status, out.error);
        return sendJson(r.res, 200, { ok: true, allowed: out.allowed, space: shown(id) });
      }),
    ],
    [
      // An app's secrets (the Space Apps plan of 10-29): each it names, its line and whether it is set — never a value.
      "GET",
      "/space/:project/dashboards/:name/secrets",
      guard((r) => {
        const { id } = projectOf(r);
        const out = runner().secretsOf(id, String(r.params.name));
        if (!out.ok) throw refused(out.status, out.error);
        return sendJson(r.res, 200, { secrets: out.secrets });
      }),
    ],
    [
      // One typed in its sheet, `{ value }`, sealed in place of the one before; DELETE forgets it. The person's alone:
      // the space tool has no way to it, and no answer carries a value back.
      "PUT",
      "/space/:project/dashboards/:name/secrets/:secret",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ value }");
        if (typeof b.value !== "string") throw refused(400, "value is the secret, as text");
        const out = runner().setSecret(id, String(r.params.name), String(r.params.secret), b.value);
        if (!out.ok) throw refused(out.status, out.error);
        return sendJson(r.res, 200, { ok: true, secrets: out.secrets });
      }),
    ],
    [
      "DELETE",
      "/space/:project/dashboards/:name/secrets/:secret",
      guard((r) => {
        const { id } = projectOf(r);
        const out = runner().setSecret(id, String(r.params.name), String(r.params.secret), null);
        if (!out.ok) throw refused(out.status, out.error);
        return sendJson(r.res, 200, { ok: true, secrets: out.secrets });
      }),
    ],
    [
      // An app's hooks (phase 4): each its Keep grants, its line, its address and how many records it keeps. The
      // person's sheet alone has an address: the space tool's read never does.
      "GET",
      "/space/:project/dashboards/:name/hooks",
      guard((r) => {
        const { id } = projectOf(r);
        const out = runner().hooksOf(id, String(r.params.name), { withAddress: true });
        if (!out.ok) throw refused(out.status, out.error);
        return sendJson(r.res, 200, { hooks: out.hooks });
      }),
    ],
    [
      // New address: the hook's old one stops at once.
      "POST",
      "/space/:project/dashboards/:name/hooks/:hook/renew",
      guard((r) => {
        const { id } = projectOf(r);
        const out = runner().hookRenew(id, String(r.params.name), String(r.params.hook));
        if (!out.ok) throw refused(out.status, out.error);
        return sendJson(r.res, 200, { ok: true, hooks: out.hooks });
      }),
    ],
    [
      // A dashboard taken out of this Space, kept or a draft: nothing of it runs; the artifact stays in Artifacts.
      "DELETE",
      "/space/:project/dashboards/:name",
      guard((r) => {
        const { id } = projectOf(r);
        runner().change(id, String(r.params.name), { removed: true });
        return sendJson(r.res, 200, { ok: true, space: shown(id) });
      }),
    ],
    [
      // A button's sheet as it opens (S3, screen 10): `{ key }`, the row it was pressed on, as Filament read it.
      "POST",
      "/space/:project/dashboards/:name/actions/:action",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ key }, the row's key");
        const out = await runner().sheet(id, String(r.params.name), String(r.params.action), String(b.key ?? ""));
        if (!out.ok) throw refused(out.status, out.error);
        return sendJson(r.res, 200, out);
      }),
    ],
    [
      // A button run: `{ key, ask?, check? }`. The answer comes once its command ended: `done`, what it said, its
      // failure; with `check` — `{ model }`, the model the person chose — and done, where an agent checks it (S5d), or
      // why none could. A check that names no model is refused before anything runs (the owner's word of 10-31).
      "POST",
      "/space/:project/dashboards/:name/actions/:action/run",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ key, ask?, check? }");
        const answers = b.ask != null && typeof b.ask === "object" && !Array.isArray(b.ask) ? b.ask : {};
        const check = b.check == null || b.check === false ? null : { model: typeof b.check?.model === "string" ? b.check.model : "" };
        const out = await runner().act(id, String(r.params.name), String(r.params.action), String(b.key ?? ""), answers, { check });
        if (!out.ok) throw refused(out.status, out.error);
        return sendJson(r.res, 200, { ...out, space: shown(id) });
      }),
    ],
    [
      // A button's second look, as the person asks for it on its sheet (S3b): `{ key, model }`, the model they chose.
      // The Reviewer starts; the sheet follows it.
      "POST",
      "/space/:project/dashboards/:name/actions/:action/look",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ key, model }: the row's key, and the model the Reviewer runs on");
        const out = await runner().lookAt(id, String(r.params.name), String(r.params.action), String(b.key ?? ""), typeof b.model === "string" ? b.model : "");
        if (!out.ok) throw refused(out.status, out.error);
        return sendJson(r.res, 200, out);
      }),
    ],
    [
      // The button running on a dashboard, stopped: Stop on its sheet.
      "POST",
      "/space/:project/dashboards/:name/actions/:action/stop",
      guard((r) => {
        const { id } = projectOf(r);
        const out = runner().stopAct(id, String(r.params.name));
        if (!out.ok) throw refused(out.status, out.error);
        return sendJson(r.res, 200, { ok: true });
      }),
    ],
    [
      // A dashboard taken out of this Space put back as it was — kept as it was kept, or a draft again: its way back.
      "POST",
      "/space/:project/dashboards/:name/back",
      guard((r) => {
        const { id } = projectOf(r);
        runner().putBack(id, String(r.params.name));
        return sendJson(r.res, 200, { ok: true, space: shown(id) });
      }),
    ],
    [
      // A kept dashboard's sources read now, a stopped one too — Refresh and Read again: `{ source? }`, one, else all.
      "POST",
      "/space/:project/dashboards/:name/read",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ source? }");
        const name = String(r.params.name);
        const live = runner().liveOf(name);
        if (!live || live.project !== id) throw refused(409, "it is not kept in this Space: nothing reads until it is");
        if (live.d.paused) throw refused(409, "it is paused: resume it to read it");
        const all = Object.keys(live.content.sources || {});
        const asked = b.source == null ? all : [String(b.source)];
        if (asked.some((s) => !all.includes(s))) throw refused(404, `v${live.v} has no source ${asked.find((s) => !all.includes(s))}`);
        /** @type {Record<string, { at: number, error: string | null, fails: number, stopped: boolean, off?: "held" }>} */
        const sources = {};
        await Promise.all(
          asked.map(async (s) => {
            // The person's own press: it reads in an archived project too, where nothing reads by itself (s-itself, 11-12).
            const got = await runner().read(name, live.v, s, { force: true, by: "you" });
            // A read refused — its version gone meanwhile — says why too, as a failure does (found by the Hunter on S5a:
            // it was left out, and Read again did nothing in silence); one whose scripts wait for a Keep, `off` "held".
            sources[s] = got.ok ? { at: got.state.at, error: got.state.error, fails: got.state.fails, stopped: got.state.stopped } : { at: 0, error: got.error, fails: 0, stopped: false, ...("off" in got && got.off === "held" ? { off: got.off } : {}) };
          }),
        );
        return sendJson(r.res, 200, { ok: true, sources, space: shown(id) });
      }),
    ],
    [
      // One routine as the Space's read says it (`runsOf`'s row), and its project's name, which its sheet says: what the
      // card under the call that proposed it reads (the owner's of 11-12: a watcher is proposed in the chat). One that
      // is not there, or a project with no Space, is a 404.
      "GET",
      "/space/:project/routines/:id",
      guard((r) => {
        const { id, name } = projectOf(r);
        if (!store().has(id)) return sendJson(r.res, 404, { error: noSpaceWords(id), none: true });
        const want = String(r.params.id);
        const routine = runsOf(id).routines.find((x) => x.id === want);
        if (!routine) return sendJson(r.res, 404, { error: `This Space has no routine ${want}.` });
        return sendJson(r.res, 200, { routine, place: name });
      }),
    ],
    [
      // A routine switched on, by the person's Switch on (S6-D1): it runs at its times from now. `{ at?, seal? }`:
      // the routine's `at` as the sheet they pressed on showed it — the press is of what they read: where its chat
      // changed it since, 409 with the Space as it stands (`moved`), and the sheet shows what it does now. `seal`: of
      // a script watcher, what its sheet read as the files the press approves (`GET …/script`): the files are
      // hashed here and now and pinned only where their seal is that one — another, 409 `moved` as well; none, 400.
      // A routine of any other kind takes no seal, and one sent is not read.
      "POST",
      "/space/:project/routines/:id/on",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ at?, seal? }");
        if (b.at != null && !Number.isFinite(b.at)) throw refused(400, "at is the routine's `at`, a number, as the Space gave it");
        if (b.seal != null && typeof b.seal !== "string") throw refused(400, "seal is the seal its sheet read, as GET …/script gave it");
        try {
          // Compared and pinned in one step, inside the Switch on: the bytes kept are the bytes whose seal was asked.
          store().routineOn(id, String(r.params.id), b.at ?? null, { nameOf, pins: (w) => scripts?.approve(id, w, b.seal ?? null) ?? null });
        } catch (/** @type {any} */ e) {
          if (e?.moved) return sendJson(r.res, 409, { error: e.message, moved: true, space: shown(id) });
          throw e;
        }
        routines?.arm();
        return sendJson(r.res, 200, { ok: true, space: shown(id) });
      }),
    ],
    [
      // A routine on, paused or going on: `{ paused }`.
      "POST",
      "/space/:project/routines/:id/pause",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ paused }");
        if (typeof b.paused !== "boolean") throw refused(400, "paused is true or false");
        store().routinePause(id, String(r.params.id), b.paused);
        routines?.arm();
        return sendJson(r.res, 200, { ok: true, space: shown(id) });
      }),
    ],
    [
      // The model a routine runs on, the person's choice on its sheet (the owner's word of 10-31): `{ model, effort? }`, ""
      // its Space's model (the owner's of 11-04). One that cannot run is refused, saying why, as the Agents page checks a model.
      "POST",
      "/space/:project/routines/:id/model",
      guard(async (r) => {
        const { id } = projectOf(r);
        const b = await objectBody(r, "{ model, effort? }");
        if (typeof b.model !== "string") throw refused(400, "model is a model's name, or \"\" for this Space's model");
        if (b.effort != null && typeof b.effort !== "string") throw refused(400, "effort is a level, or \"\" for the model's own");
        const model = b.model.trim();
        /** @type {string | null} */
        const cannot = model && a.subagentModelProblem ? a.subagentModelProblem(poolName(model)) : null;
        if (cannot) throw refused(409, `“${model}” cannot run: ${cannot}`);
        store().routineModel(id, String(r.params.id), model, typeof b.effort === "string" ? b.effort.trim() : "");
        return sendJson(r.res, 200, { ok: true, space: shown(id) });
      }),
    ],
    [
      // Run now, the person's press: a routine on runs once. The answer comes once its chat's turn began: its chat.
      // `{ again }`: the Retry of a watcher's wake that failed, by that turn's number in the chat it wakes — the wake
      // goes again as the watcher's, its block read from that chat's record (app/routines.js `runNow`; r-doors, 11-12).
      "POST",
      "/space/:project/routines/:id/run",
      guard(async (r) => {
        const { id } = projectOf(r);
        const again = (await r.json())?.again ?? null;
        if (again !== null && !(Number.isInteger(again) && again > 0)) throw refused(400, "again is a turn's number in the chat the watcher wakes");
        const chain = await routinesOf().runNow(id, String(r.params.id), null, again);
        return sendJson(r.res, 200, { ok: true, chain, space: shown(id) });
      }),
    ],
    [
      // A routine removed, on the person's word: nothing of it runs; Put back is its way back.
      "DELETE",
      "/space/:project/routines/:id",
      guard((r) => {
        const { id } = projectOf(r);
        store().routineRemove(id, String(r.params.id));
        routines?.arm();
        return sendJson(r.res, 200, { ok: true, space: shown(id) });
      }),
    ],
    [
      // A routine removed, put back as it was.
      "POST",
      "/space/:project/routines/:id/back",
      guard((r) => {
        const { id } = projectOf(r);
        store().routineBack(id, String(r.params.id));
        routines?.arm();
        return sendJson(r.res, 200, { ok: true, space: shown(id) });
      }),
    ],
    [
      // What a script watcher's sheet reads as it opens (app/watchers/script.js `read`): `{ seal, files: [{ path,
      // bytes, changed? }], differs? }` — the seal of what a Switch on would pin, which the press sends back, and the
      // files it approves, or approved. `?file=<path>`: one of those files' text, `{ path, text, cut, bytes }`, or
      // `{ path, unread }` where it is not shown; a path that is none of them is a 404. The Space's document carries
      // no file's text: this reads the project's files, which the person's page may read.
      "GET",
      "/space/:project/routines/:id/script",
      guard((r) => {
        const { id } = projectOf(r);
        if (!scripts) throw refused(503, "script watchers are not wired in this Filament");
        return sendJson(r.res, 200, scripts.read(id, String(r.params.id), r.url.searchParams.get("file")));
      }),
    ],
    [
      // The address a program posts to, of a webhook watcher that is on, for its sheet: `{ url, urlTailnet?, sign,
      // secret? }` — `secret` the first time a signed one's is read, and never after. The person's alone, a press:
      // an agent that read its watcher's address could wake itself.
      "GET",
      "/space/:project/routines/:id/address",
      guard((r) => {
        const { id } = projectOf(r);
        return sendJson(r.res, 200, webhooksOf().addressOf(id, String(r.params.id)));
      }),
    ],
    [
      // Make a new address, the person's press: the old one opens nothing from now. The new one, and a signed one's
      // new secret, are in this answer.
      "POST",
      "/space/:project/routines/:id/address/renew",
      guard((r) => {
        const { id } = projectOf(r);
        return sendJson(r.res, 200, { ok: true, ...webhooksOf().renew(id, String(r.params.id)) });
      }),
    ],
    [
      // Pause all (S6-D4, D12): `{ on }` — nothing starts by itself, no routine's time and no watch's look, until it is
      // off. One switch for this Filament.
      "POST",
      "/spaces/pause",
      guard(async (r) => {
        const b = await objectBody(r, "{ on }");
        if (typeof b.on !== "boolean") throw refused(400, "on is true or false");
        const pausedSince = dashboards ? dashboards.pauseAll(b.on) : store().pauseAll(b.on);
        routines?.arm();
        return sendJson(r.res, 200, { ok: true, pausedSince });
      }),
    ],
    [
      // Settings › Space (the owner's of 11-04): every Space's defaults — the model its agents run on where a Space sets
      // none, its effort, what an app's ask does —, the Spaces that set their own, and Pause all's moment.
      "GET",
      "/spaces/settings",
      guard((r) => {
        const own = store()
          .projects()
          .filter((p) => store().has(p) && named(p))
          .map((p) => ({ project: p, name: store().get(p).own?.name || named(p)?.name || p, own: !!store().get(p).own, settings: store().settingsOf(p) }))
          .filter((s) => Object.keys(s.settings).length);
        return sendJson(r.res, 200, { settings: store().defaults(), spaces: own, efforts: SPACE_EFFORTS, asks: SPACE_ASKS, pausedSince: store().pausedSince(), ...modelProblemOf(store().defaults().model) });
      }),
    ],
    [
      // Settings › Space changed: `{ model?, effort?, asks? }`, each `null` or "" taken away. A model that cannot run now
      // is kept — a plan used up comes back —, and the answer says why it cannot, as the page shows it.
      "PATCH",
      "/spaces/settings",
      guard(async (r) => {
        const settings = store().setDefaults(await objectBody(r, "{ model?, effort?, asks? }"));
        return sendJson(r.res, 200, { ok: true, settings, ...modelProblemOf(settings.model) });
      }),
    ],
    [
      // A Space's own settings (its ⋯ › Space settings…): `{ model?, effort?, asks? }` over Settings › Space's, each
      // `null` or "" back to those. A line in its What happened says what changed.
      "PATCH",
      "/space/:project/settings",
      guard(async (r) => {
        const { id } = projectOf(r);
        const settings = store().setSettings(id, await objectBody(r, "{ model?, effort?, asks? }"));
        return sendJson(r.res, 200, { ok: true, settings, ...modelProblemOf(settings.model), space: shown(id) });
      }),
    ],
    [
      // An app's ask run here (the owner's of 11-04): `{ words, app?, model?, effort? }` — the app's words, run as a new
      // read-only chat of this Space in the background, on the model given (its sheet's) or the Space's. The answer comes
      // once its turn began: its chat and what it runs on.
      "POST",
      "/space/:project/asks",
      guard(async (r) => {
        const { id } = projectOf(r);
        if (!a.spaceAsks) throw refused(503, "an app's asks do not run here in this Filament");
        if (!store().has(id)) throw refused(404, noSpaceWords(id));
        const b = await objectBody(r, "{ words, app?, model?, effort? }");
        /** @type {import("../../app/space-asks.js").SpaceAsks} */
        const asks = a.spaceAsks;
        const got = await asks.run(id, { words: b.words, app: b.app, model: b.model, effort: b.effort });
        return sendJson(r.res, 200, { ok: true, ...got, space: shown(id) });
      }),
    ],
    [
      // When you press Run (S6-D7): memory's procedures of this project — "How to release: 7 steps" —, each with the
      // chat it was learned in. The page's Run… fills the Start with one; nothing runs.
      "GET",
      "/space/:project/procedures",
      guard((r) => {
        const { id } = projectOf(r);
        const items = memory?.items ? memory.items({ kind: "procedure", projectId: id, limit: 50 }) : [];
        const procedures = items
          .filter((/** @type {any} */ it) => !["dismissed", "superseded"].includes(String(it.status)))
          .flatMap((/** @type {any} */ it) => {
            const p = asProcedure(String(it.text || ""));
            return p ? [{ id: Number(it.id), goal: p.goal, steps: p.steps.length, text: p.text, at: Number(it.created_at) || 0, from: it.chain_id ? nameOf(String(it.chain_id)) : "" }] : [];
          });
        return sendJson(r.res, 200, { procedures });
      }),
    ],
    [
      // The week's page (v3): the board and this week's logbook, as Markdown for the person's notes.
      "GET",
      "/space/:project/week.md",
      guard((r) => {
        const p = projectOf(r);
        const text = spaceMarkdown(store().get(p.id), { name: p.name, nameOf, now: Date.now() });
        r.res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" });
        r.res.end(text);
      }),
    ],
  ];
}
