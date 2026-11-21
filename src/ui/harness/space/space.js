// @ts-check
// A project's Space (proposal_ux §4.14, mock-space; U5 phase 8; HarnessV4_Space_Plan S1, the mock "Space, grown"
// screen 1): the project's page — what needs you here, who works in it and what runs by itself, its plan and its
// record. A full-frame page over the chat, as the Library is: the crumb "Filament › Space" with ⋯ — the project's
// settings, its Connectors…, Plugins…, Skills… and its Folders and worktrees… — and Back to chat; then the project's
// name, under it one line that never wraps — its folder and how many lanes — and what its agents run on, a quiet chip;
// at its right Add to this Space… and New chat here…, the filled one: a project's page is where a chat is started many
// times a day and an app made once, so New app… is Add to this Space…'s first row there, and the head's own, filled,
// on a Space of your own. Then its Board. Its apps, dashboards, Routines and Watchers are rows under the Space's in the
// left bar (the owner's idea of 10-29), each its address, `#/space/<project>/<app>`, and its page alone here — the
// crumb "r › Space › Deploys", its ⌄ the others. The Board, top to bottom: Needs you here — Now's own rows for this
// project's chats (lib/now.js), one quiet line when none. Then a pair: at its left the lanes, open unless you folded
// them — beside their head how many, which need you or work, New lane… and Hide —, one card per place a chat of the
// project works in (the main folder, a worktree): its branch, the chat that leads it — the one that needs you, else one
// at work, else the newest — with who runs it (its model, or its team and how many workers) and what it does now, the
// task it has on the board and what the place holds that its base lacks, and the newest line its chats wrote, else
// memory's newest of the chat; between two lanes, the newest time both were told; Overlaps under them when two lanes
// change one file, as git says (Compare… opens what each lane changes and the merge order, owners.js, in a sheet); Who
// works here in their place where the folder draws no lanes. At the pair's right, Runs by itself (by-itself.js): its
// routines, watchers and apps, a row each; under the lanes on a narrow page. Then Tasks — the board (board.js), one
// line while it is empty — and under it What happened (logbook.js), Where you left off (left-off.js) at its top when
// its chats moved since your last look, and the card its ⋯ › Tell the chats… opens (sync-card.js). The project's places
// (places.js), with Remove and Put back, open in a sheet from ⋯ and from the project's menu in the left bar. Simple by
// default (SG-D0): what extends a Space is added to it, never there before — Add to this Space… offers what it can
// grow; its dashboards and apps (S2, dashboards.js) each show alone, in the Board's place. Nothing here starts, sends
// or spends on one press: a lane opens its chat, a row of Runs by itself its page — Switch on… and Keep… their sheets —,
// New chat here…, New lane…, Start a chat on this…, Catch me up… and Dashboard… fill the Start, Tell the chats… opens
// its card, and Tell them is the press that sends (rule 1); Keep is the press that lets a dashboard run by itself. The
// Space is the server's (`/api/space/:project`), read as the page opens and again as the events stream says it moved
// (`space`); the lanes are drawn from the places' read and what the left bar already knows of each chat. The lanes'
// arithmetic is pure (`lanesOf`, `laneChat`, `laneFacts`); the page runs on the stub document. A project with no Space
// yet (by need, 11-12) draws all of it from an empty one under a card that says so, and the first thing the person adds
// — a task, a note, a pull, an app, a Keep, a telling, a routine's or watcher's ask — makes its Space with that press:
// the answer says `made`, and the page says it once, drops the card and tells the left bar (`makes`, `madeBy`,
// `fillFor`). While its deleted Space waits for Bring it back, the card and its lanes alone: nothing is added over it.
import { h, morphChildren, setHtml, standing } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { onBus } from "../lib/bus.js";
import { ICONS, icon } from "../lib/icons.js";
import { dialog, menu, sheet, toast } from "../lib/ui.js";
import { keepingFocus } from "../lib/keep-focus.js";
import { branchWords, possessive, sessionAge } from "../lib/labels.js";
import { editorButton } from "../lib/editors.js";
import { ASK_MAKES_SPACE, BOARD_COLUMNS, LOOK_AFTER_OWN, LOOK_AFTER_SHOWN, REPRO_TIP, ageWords, backWords, fedCountWords, laneFed,laneNews, lanePlaces, laneTask, leftOff, lookWords, madeWords, moveAsk, needGroups, noSpaceYet, overlapWords, ownersOf, placeKey, pullChipWords, routineMakeWords, watcherMakeWords, sizeWords, syncBetween, taskFileUrl, whenWords } from "../lib/space-view.js";
import { pullSheet } from "./pull-sheet.js";
import { ageEl, moveAges, needRows } from "./needs-rows.js";
import { pickPlace, placeChoices } from "./pick-place.js";
import { glanceCard } from "./your-space.js";
import { chipTone } from "../now-list.js";
import { placesSection, placesWords } from "./places.js";
import { catchUpWords, keepLook, lastLook, leftOffCard, toolMoment } from "./left-off.js";
import { boardPanel } from "./board.js";
import { logbookPanel } from "./logbook.js";
import { syncCard } from "./sync-card.js";
import { ownersPanel } from "./owners.js";
import { OVERVIEW, ROUTINES, WATCHERS, dashboardsPart, fixWords } from "./dashboards.js";
import { byItselfPart } from "./by-itself.js";
import { connectionsSheet, usesConnections } from "./connections.js";
import { lookAfterSheet, routinesFailed, routinesPart, routinesShown } from "./routines.js";
import { watchersFailed, watchersPart, watchersShown } from "./watchers.js";
import { startHere } from "./start-here.js";
import { pluginSheet } from "../library/plugin-sheet.js";
import { parseRoute, routeFor } from "../lib/router.js";
import { holdJump } from "../settings/search.js";
import { modelAt } from "../lib/space-settings.js";
import { spaceSettingsSheet } from "./settings-sheet.js";
import { askSheet } from "./ask-sheet.js";

/** The project's settings the door opens, each with the project already chosen in its Applies to (§4.16). */
export const PROJECT_PAGES = Object.freeze([
  { section: "permissions", label: "Permissions", icon: "shieldCheck", line: "What its chats' agents may do without asking" },
  { section: "instructions", label: "Instructions", icon: "scrollText", line: "The files and words its chats start from" },
  { section: "memory", label: "Memory in new chats", icon: "brain", line: "What memory brings into its new chats" },
]);

/** The most a file on a task may be: the server's (core/space.js SPACE_FILES.fileBytes), what a chat's box takes in one. */
const TASK_FILE_MOST = 20 * 1024 * 1024;
/** A file's bytes as base64. @param {Blob} f @returns {Promise<string>} */
const base64Of = (f) =>
  new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onload = () => res(String(rd.result).split(",")[1] || "");
    rd.onerror = () => rej(rd.error || new Error("the file could not be read"));
    rd.readAsDataURL(f);
  });

/** How long after an app's ask ran at once its page may ask again: past the click's few seconds that let it ask (11-04). */
const ASK_AGAIN_MS = 5_000;

/** How often the places — and what each lane's place changed — are read again while the Space is open and in view. */
const PLACES_EVERY_MS = 30_000;
const TICK_MS = 2_000;
/** How long a burst of the Space's changes is gathered before it is read again. */
const READ_AFTER_MS = 150;
/** How many places one files read asks for: the route's own most (`/space/:project/files`). */
const FILES_PER_READ = 20;
/** What showing a project in a Space of your own does (A7, and the owner's word of 10-26: what the Space connects reaches it). */
const SHOW_WHAT = "Its chats get this Space's connectors and plugins; what needs you in it, and its apps' numbers, show here.";

/**
 * A chat as the Space reads it: the left bar's facts and Now's row.
 * @typedef {{ title: string, when: number, line: string }} ChatFacts
 * @typedef {{ chat: (id: string) => ChatFacts | null, now: (id: string) => import("../lib/now.js").NowRow | null,
 *   failed: (id: string) => boolean, modelName: (id: string) => string }} LaneLook
 *   `modelName`: a model's name as the picker says it ("Opus 5.5"), from the catalogue's families
 */

/**
 * A chat in a lane: its name, what it does now and in which tone — `needs` it asks you, `works` it runs, `error` its
 * last run stopped — who runs it (`model`: the model at work, or a lead's team and its workers), the team it leads,
 * the newest line memory keeps of it, and when it last moved.
 * `routine`: a routine's run (S6), which leads its lane only while it works or needs you.
 * @typedef {{ id: string, name: string, state: string, tone: "" | "needs" | "works" | "error", model: string,
 *   team: string, line: string, when: number, routine: boolean }} LaneChat
 */

/**
 * A lane: a place where the project's chats work, the chat that leads it, the others there, and what the place holds.
 * @typedef {{ path: string, name: string, main: boolean, branch: string, facts: string, lead: LaneChat | null,
 *   others: LaneChat[], tone: LaneChat["tone"] }} Lane
 */

/** How a chat's tone ranks a lane's lead: what needs you first, then what works, then what stopped. */
const RANK = Object.freeze({ needs: 0, works: 1, error: 2, "": 3 });

/** A team at work, as a lane says who runs it: "Builders team · 3 workers". @param {string} team @param {number} workers */
const teamWords = (team, workers) => `${team}${/\bteam$/i.test(team) ? "" : " team"} · ${workers} worker${workers === 1 ? "" : "s"}`;

/**
 * A chat of a place, as a lane shows it.
 * @param {{ id: string, name?: string, routine?: string }} c  as `/git/places` names it @param {LaneLook} look
 * @returns {LaneChat}
 */
export function laneChat(c, look) {
  const facts = look.chat(c.id);
  const row = look.now(c.id);
  const when = facts?.when || 0;
  const name = facts?.title || c.name || "an untitled chat";
  const line = facts?.line || "";
  const team = row?.team || "";
  const model = team ? teamWords(team, row?.under?.length || 0) : row?.model ? look.modelName(row.model) : "";
  const was = { id: c.id, name, model, team, line, when, routine: !!c.routine };
  // A turn that failed waits for you in Now, its fact "failed: …": the lane says it so.
  if (row?.tone === "error") return { ...was, state: row.fact || "its last run stopped", tone: "error" };
  if (row?.group === "needs") return { ...was, state: row.fact || "waits for you", tone: "needs" };
  // A lead's row names its chat and its workers in its fact: the lane says them apart, its step alone here.
  const doing = team ? row?.step : row?.fact;
  if (row?.group === "works") return { ...was, state: doing ? `working · ${doing}` : "working", tone: "works" };
  if (look.failed(c.id)) return { ...was, state: "its last run stopped", tone: "error" };
  // A moment a little ahead of this clock (another machine's) is "now", not no age at all.
  const age = when ? sessionAge(new Date(Math.min(when, Date.now())).toISOString()) : "";
  return { ...was, state: age ? `idle · ${age}` : "idle", tone: "" };
}

/**
 * What a place holds that its base lacks, in a lane's words: "3 files changed, not committed · 2 commits not on main";
 * "merged into main" for a clean worktree with nothing of its own; why git could not read it.
 * @param {any} p  a place as `/git/places` answers one
 */
export function laneFacts(p) {
  if (p.missing) return "its folder is gone; git keeps its record";
  if (!p.ok) return String(p.error || "git could not read it");
  const parts = [];
  const files = p.uncommitted?.files || 0;
  if (files) parts.push(`${files} file${files === 1 ? "" : "s"} changed, not committed`);
  if (p.base && !p.onBase && p.ahead) parts.push(`${p.ahead} commit${p.ahead === 1 ? "" : "s"} not on ${p.base}`);
  if (!parts.length && !p.main && p.base && !p.onBase && p.ahead === 0) parts.push(p.fresh ? "nothing of its own yet" : `merged into ${p.base}`);
  return parts.join(" · ") || "nothing uncommitted";
}

/**
 * The lanes of a project's places: each place a chat works in — its folder there, or its agents wrote there — and the
 * main folder always; the main folder first, then the lanes whose chats need you, work, stopped, then the newest.
 * A routine's run that ended — done, or failed, which its Routines row and Needs you say — comes after the person's own
 * chats (seen live at S6: each run would have led the main lane, the chat you work in behind it).
 * @param {any} answer  `/git/places`' answer @param {LaneLook} look
 * @returns {Lane[]}
 */
export function lanesOf(answer, look) {
  const rank = (/** @type {LaneChat} */ c) => (c.routine && (c.tone === "" || c.tone === "error") ? 4 : RANK[c.tone]);
  // A folder in no repository (a Space of your own's, A3): its chats as one lane, the folder itself, for Needs you here,
  // Tell the chats… and where you left off — no lane is drawn there (found by the Hunter on A6).
  if (!answer?.ok) {
    const chats = (answer?.chats || []).map((/** @type {any} */ c) => laneChat(c, look)).sort((a, b) => rank(a) - rank(b) || b.when - a.when);
    const path = String(answer?.cwd || "");
    return chats.length ? [{ path, name: path.split(/[\\/]/).filter(Boolean).pop() || path, main: true, branch: "", facts: "", lead: chats[0], others: chats.slice(1), tone: chats[0].tone }] : [];
  }
  // Which places are lanes is `lanePlaces`' to say, the rule the left bar's row counts by too.
  const main = (answer.places || []).find((/** @type {any} */ p) => p.main)?.path || null;
  const inUse = new Set(lanePlaces(main, (answer.places || []).filter((/** @type {any} */ p) => (p.chats || []).length).map((/** @type {any} */ p) => ({ place: p.path, main }))).map(placeKey));
  /** @type {Lane[]} */
  const lanes = [];
  for (const p of answer.places || []) {
    if (!inUse.has(placeKey(p.path))) continue;
    const chats = (p.chats || []).map((/** @type {any} */ c) => laneChat(c, look))
      .sort((a, b) => rank(a) - rank(b) || b.when - a.when);
    const lead = chats[0] || null;
    lanes.push({ path: p.path, name: p.name, main: !!p.main, branch: branchWords(p) || "", facts: laneFacts(p), lead, others: chats.slice(1), tone: lead?.tone || "" });
  }
  const newest = (/** @type {Lane} */ l) => l.lead?.when || 0;
  return lanes.sort((a, b) => Number(b.main) - Number(a.main) || RANK[a.tone] - RANK[b.tone] || newest(b) - newest(a));
}

/**
 * The lanes' one line, beside their head — all that is left of them while they are folded (the reshape of 10-29): how
 * many of them need you, work and stopped, by their lead chats; "all quiet" where none does. "" with no lane.
 * @param {Lane[]} lanes
 */
export function lanesWords(lanes) {
  if (!lanes.length) return "";
  const n = (/** @type {Lane["tone"]} */ tone) => lanes.filter((l) => l.tone === tone).length;
  const needs = n("needs");
  const works = n("works");
  const stopped = n("error");
  const parts = [
    needs ? `${needs} need${needs === 1 ? "s" : ""} you` : "",
    works ? `${works} at work` : "",
    stopped ? `${stopped} stopped` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "all quiet";
}

/** A lane as the board and the panels name it. @param {Lane} l @returns {import("../lib/space-view.js").LaneRef} */
export const laneRef = (l) => ({ path: l.path, chip: l.branch || l.name, main: l.main, chains: [...(l.lead ? [l.lead.id] : []), ...l.others.map((o) => o.id)] });

/**
 * What the page hands the Space. `project`: the project by its id, null while the list has not named it;
 * `openChat`: a chat opened; `newChat`: the Start filled in the folder, on a new worktree with `lane`; `startOn`: the
 * Start filled with a task of the board, in a folder, the task linked to the chat its first send makes; `startWith`:
 * the Start in a folder with words in its box (Catch me up…, Dashboard…), on a new worktree with `lane` (a card a
 * dashboard put on the board, picked up: S4c), or on the lane `lane` names (a pulled issue's, "lin-42"); `projectSettings`: a settings page with the
 * project chosen; `onMoved`: a worktree removed or put back; `openArtifact`: an artifact's own view; `dashboardFrame`:
 * a dashboard's page in a frame, for its tab, its words to an agent handed off as `handOff` hands them, a button
 * pressed in it to `onAct`; `handOff`: work that starts here but may belong to a project (HarnessV4_SpacesPlugins_Plan
 * A4) — from a Space of your own, where the chat runs is asked first and the chat remembers this Space; from a
 * project's, the chat starts in `cwd` and asks nothing; a task of the board goes with it (`task`). A Space of your own that shows
 * projects (A7): `projects` and `ownSpaces`, the lists Include a project… picks from; `asking`, Now's rows of a project's chats
 * that ask you, `openRow` one opened; `openSpace`, a project's own Space, at its dashboard's or app's page with `tab`.
 * `catalogue`: the models a button's second look or check may run on, as the composer's picker lists them.
 * `runsOn`: what this Space's agents run on, told each time the page reads it (the owner's of 11-04) — the chats it
 * starts start on its model; `spaceDefaults`: Settings › Space, every Space's defaults.
 * @typedef {{ project: (id: string) => { id: string, name: string, cwd: string } | null, look: LaneLook,
 *   runsOn?: (on: import("../lib/space-settings.js").RunsOn | null) => void, spaceDefaults?: () => void,
 *   projects?: () => { id: string, name: string, cwd: string }[], ownSpaces?: () => { project: string, name: string }[],
 *   asking?: (project: string) => import("../lib/now.js").NowRow[], openRow?: (r: import("../lib/now.js").NowRow) => void,
 *   openSpace?: (project: string, tab?: string) => void,
 *   openChat: (id: string) => void, newChat: (cwd: string, lane: boolean) => void,
 *   startOn?: (project: string, task: import("../lib/space-view.js").SpaceTask, cwd: string) => void,
 *   startWith?: (cwd: string, words: string, lane?: boolean | string) => void,
 *   handOff?: (from: string, cwd: string, words: string, task?: import("../lib/space-view.js").SpaceTask | null) => void,
 *   reproduce?: (cwd: string, report: import("../lib/space-view.js").ReproReport) => void,
 *   askChat?: (chain: string, words: string, task?: { project: string, task: import("../lib/space-view.js").SpaceTask }) => void,
 *   openArtifact?: (name: string) => void,
 *   dashboardFrame?: (name: string, title: string, cwd: string, onAct: (m: { action: string, key: string }) => void, from?: string,
 *     more?: import("./dashboards.js").FrameMore) => import("./dashboards.js").DashboardFrame,
 *   catalogue?: import("./action-sheet.js").Catalogue,
 *   projectSettings: (id: string, section: string) => void, onMoved: () => void, onClose: () => void }} SpaceCallbacks
 */

/** @param {unknown} e */
const said = (e) => String(/** @type {any} */ (e)?.message || e);

/**
 * The project's Space made for a press outside its page that only fills a box — Watch this chat…, in a chat of a
 * project with none (app.js `onWatch`) —, as such a press on the page makes it (by need, 11-12: `{ need: true }`, the
 * routes' `byNeed`): said where it was made. Refused — its deleted Space waits —, said, and false: nothing is to be
 * filled.
 * @param {string} project
 */
export async function spaceForAsk(project) {
  try {
    const made = madeWords(await api(`/space/${encodeURIComponent(project)}`, { method: "POST", body: { need: true } }));
    if (made) toast(made);
    return true;
  } catch (e) {
    toast(said(e), "err");
    return false;
  }
}

/** The Space on screen: its stop, which keeps your look. */
let open = /** @type {(() => void) | null} */ (null);
/** The Space on screen, for its own address with another tab: that page shown in place, nothing read again. */
let onScreen = /** @type {{ id: string, root: HTMLElement, page: { root: HTMLElement, paint: (force?: boolean) => void, stop: () => void, show: (tab: string) => void } } | null} */ (null);
/** The project whose page opens with its Places open (its menu's Folders and worktrees…), and the open page's way to. */
let placesNext = "";
let openPlacesNow = /** @type {((id: string) => boolean) | null} */ (null);
/** The projects whose lanes you folded, while the harness is open: their Space opens with them folded again. */
const lanesFolded = new Set();

/**
 * A project's page shown with its places' sheet open (Folders and worktrees…): the page on screen at once where it is
 * that project's, else the next page drawn for it.
 * @param {string} id
 */
export function placesFirst(id) {
  if (openPlacesNow?.(id)) return;
  placesNext = id;
}

/**
 * The Space on screen left — the page went to another screen —: it stops now and keeps your look, so the next Space
 * opened reads it (found by the Hunter on S1: kept only as its tick saw it gone, up to 2 s later, a Space opened again
 * at once read the look before and showed again what you had just seen).
 */
export function leaveSpace() {
  const stop = open;
  open = null;
  stop?.();
}

/**
 * Draw a project's Space over the frame. Its tick and its feed end once the page has left it, or on `stop`; the Space
 * it replaces stops first, its look kept before this one reads it. The same project's page on screen, its address with
 * another tab — an app's row in the left bar pressed (the owner's idea of 10-29) — shows that page in place.
 * @param {HTMLElement} host  the main frame @param {{ id: string, tab?: string }} at  the route's project, and the page
 *   it shows: the Board, Routines or a dashboard's @param {SpaceCallbacks} cb
 */
export function renderSpace(host, at, cb) {
  if (onScreen && onScreen.id === at.id && onScreen.root.isConnected && onScreen.root.parentElement === host) {
    onScreen.page.show(at.tab || OVERVIEW);
    return onScreen.page;
  }
  leaveSpace();
  host.querySelector(":scope > .space")?.remove();
  // Reading until the Space is read (seen live: a project with no Space drew a whole empty Space before its card).
  const root = h("div", { class: "space sp-is-reading", "data-project": at.id });
  host.append(root);
  /** The project, once the list names it (the first paint asks), and the places' last read. */
  /** @type {{ id: string, name: string, cwd: string } | null} */
  let project = null;
  /** @type {any} */
  let answer = null;
  let drawnKey = "";
  let readAt = 0;
  /** The Space as the server last said it; why it could not be read. */
  /** @type {import("../lib/space-view.js").SpaceAnswer | null} */
  let space = null;
  let spaceError = "";
  /**
   * The project has no Space (10-29: none until the person makes one): when its last was deleted, and the drafts its
   * chats published since; null: it has one.
   */
  /** @type {{ deletedAt: number | null, dashboards: import("../lib/space-dashboards.js").SpaceDashboard[] } | null} */
  let none = null;
  /**
   * Whether the first thing added here makes the project's Space (by need, 11-12): it has none, and no deleted one
   * waits — the routes refuse an add while one does, so the page offers none then.
   */
  const makes = () => !!none && !none.deletedAt;
  /** What each lane's place changed, by its folder, and whether it was read. */
  /** @type {Map<string, import("../lib/space-view.js").PlaceFiles>} */
  let files = new Map();
  let filesRead = false;
  /** Why the newest files read could not read every lane's place; "" where it did. */
  let filesError = "";
  /** The lanes as last drawn, for the panels. @type {Lane[]} */
  let lanes = [];
  /**
   * Where you left off counts from: your last look before this one (null: never), read as the project is first known,
   * then the moment you dismissed the card; the card as last drawn.
   */
  /** @type {number | null} */
  let leftSince = null;
  let leftKey = "";

  const crumbName = h("span", { class: "sp-crumb-name" });
  const lanesEl = h("div", { class: "sp-lanes", role: "list", "aria-label": "Lanes" });
  const lineEl = h("p", { class: "sp-line" });
  const titleEl = h("h2", { class: "sp-title" });
  const boardNote = h("p", { class: "sp-quiet sp-board-note", hidden: "" });
  const needsList = h("div", { class: "sp-needs", role: "list", "aria-label": "Needs you here" });
  const needsCount = h("span", { class: "sp-sec-count" });
  const lanesCount = h("span", { class: "sp-sec-count" });
  const overlapEl = h("div", { class: "sp-overlap", role: "status", hidden: "" });
  const places = placesSection({
    folder: () => project?.cwd || "",
    editorButton: (path, what) => editorButton(path, what, "pl-open"),
    onMoved: () => cb.onMoved(),
    onRead: (a) => {
      answer = a;
      paint(true);
      void readFiles();
    },
  });
  /**
   * The places read again; the lanes follow its answer. `footprint`: Filament's footprint in the repository after them —
   * as the Space opens and on its ⟳, never on the minute's read or the feed's.
   * @param {{ footprint?: boolean }} [o]
   */
  const read = ({ footprint = false } = {}) => {
    readAt = Date.now();
    void places.load({ footprint });
  };

  const base = () => `/space/${encodeURIComponent(at.id)}`;
  /** A chat by its name: the left bar's, else the Space's own word for it. @param {string} chain */
  const nameOf = (chain) => cb.look.chat(chain)?.title || space?.names?.[chain] || "an untitled chat";
  const refs = () => lanes.map(laneRef);
  /** The lane a chat works in. @param {string} chain */
  const laneOf = (chain) => refs().find((l) => l.chains.includes(chain)) || null;

  /** How many reads of the Space were asked: only the newest one's answer is drawn. */
  let spaceReads = 0;
  /**
   * The Space read again; a refusal is said where the board stands. An answer that lands after a newer read was asked
   * is not drawn: it would put an older Space over the one that read says.
   */
  async function readSpace() {
    const mine = ++spaceReads;
    try {
      const got = await api(base());
      if (mine !== spaceReads) return;
      space = got;
      spaceError = "";
      none = null;
    } catch (e) {
      if (mine !== spaceReads) return;
      const x = /** @type {any} */ (e);
      if (x?.status === 404 && x.body?.none === true) {
        none = { deletedAt: Number(x.body.deletedAt) || null, dashboards: Array.isArray(x.body.dashboards) ? x.body.dashboards : [] };
        space = null;
        spaceError = "";
      } else spaceError = said(e);
    }
    root.classList.remove("sp-is-reading");
    paintSpace();
  }
  let readTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  const readSoon = () => {
    if (readTimer) return;
    readTimer = setTimeout(() => {
      readTimer = null;
      void readSpace();
    }, READ_AFTER_MS);
  };
  /** What each lane's place changed, for the owners panel and the merge order. */
  async function readFiles() {
    const paths = (answer?.places || []).filter((/** @type {any} */ p) => lanes.some((l) => l.path === p.path)).map((/** @type {any} */ p) => String(p.path));
    if (!paths.length) return;
    // A read takes FILES_PER_READ places at most, so more lanes are read in parts; a part that fails is said, never
    // drawn as "no lane has changed a file" (found by the Hunter on S1: a refusal read as nothing changed, and past 20
    // lanes every read was refused).
    /** @type {Map<string, import("../lib/space-view.js").PlaceFiles>} */
    const got = new Map();
    let error = "";
    for (let i = 0; i < paths.length; i += FILES_PER_READ) {
      const part = paths.slice(i, i + FILES_PER_READ);
      try {
        const r = await api(`${base()}/files?${part.map((p) => `place=${encodeURIComponent(p)}`).join("&")}`);
        for (const p of r?.places || []) got.set(placeKey(p.path), p);
      } catch (e) {
        error ||= said(e);
        // What this part read before stays as it was.
        for (const p of part) {
          const had = files.get(placeKey(p));
          if (had) got.set(placeKey(p), had);
        }
      }
    }
    files = got;
    filesError = error;
    filesRead = true;
    paintOwners();
  }

  /**
   * A write to the Space whose refusal its caller says in its own place (a button's sheet): its answer's Space drawn,
   * no failed read said over it.
   * @param {string} method @param {string} path @param {any} [body]
   * @returns {Promise<{ ok: true, got: any } | { ok: false, error: string }>}
   */
  async function request(method, path, body) {
    try {
      const got = await api(`${base()}${path}`, { method, ...(body === undefined ? {} : { body }) });
      if (got?.space) {
        space = got.space;
        spaceError = "";
        paintSpace();
      }
      return { ok: true, got: got || {} };
    } catch (e) {
      return { ok: false, error: said(e) };
    }
  }

  /**
   * An answer that says its press made the project's Space (by need, 11-12: the routes' `byNeed`): the card goes, the
   * left bar is told as Make a Space tells it, and the Space is read where the answer did not bring it. → the words
   * that say so, for one toast; "" where the press made none.
   * @param {any} got
   */
  function madeBy(got) {
    const words = madeWords(got);
    if (!words) return "";
    none = null;
    if (!got.space) void readSpace();
    cb.onMoved();
    return words;
  }

  /**
   * A write to the Space: its answer — the Space as it stands — drawn, no failed read said over it; a refusal said in a
   * toast, and null — drawn too where it says how the Space stands now (a Switch on of a routine its chat changed
   * since the sheet was read). A press that made the Space is said in a toast (`madeBy`), unless its caller says it in
   * a toast of its own (`says: false`).
   * @param {string} method @param {string} path @param {any} [body] @param {{ says?: boolean }} [o]
   */
  async function write(method, path, body, { says = true } = {}) {
    /** @param {any} now */
    const stands = (now) => {
      if (!now) return;
      space = now;
      spaceError = "";
      paintSpace();
    };
    try {
      const got = await api(`${base()}${path}`, { method, ...(body === undefined ? {} : { body }) });
      const made = madeBy(got);
      if (made && says) toast(made);
      stands(got?.space);
      return got || {};
    } catch (e) {
      stands(/** @type {any} */ (e)?.body?.space);
      toast(said(e), "err");
      return null;
    }
  }

  /**
   * Files attached to a task (the owner's of 11-02), each sent whole in its turn: one past what a task's file may be,
   * one the computer would not read, or one refused, is said in a toast and the rest go on. → the task as the last
   * answer has it; null where none went.
   * @param {import("../lib/space-view.js").SpaceTask} task @param {File[]} files
   */
  async function attachTo(task, files) {
    /** @type {import("../lib/space-view.js").SpaceTask | null} */
    let got = null;
    for (const f of files) {
      if (f.size > TASK_FILE_MOST) {
        toast(`${f.name} is ${sizeWords(f.size)}: a file on a task is ${TASK_FILE_MOST / 1048576} MB at most`, "err");
        continue;
      }
      /** @type {string} */
      let data;
      try {
        data = await base64Of(f);
      } catch (e) {
        toast(`${f.name} could not be read: ${said(e)}`, "err");
        continue;
      }
      const r = await write("POST", `/tasks/${encodeURIComponent(task.id)}/files`, { name: f.name, data });
      if (r?.task) got = r.task;
    }
    return got;
  }

  /**
   * A press that only fills the Start — Routine…, Watcher…, What do you look after… —: what its agent proposes lives in
   * the Space, so a project with none has it made first, as an add makes it (by need, 11-12: `{ need: true }` on the
   * make, which refuses while its deleted Space waits), and only then is the box filled. Refused: said, nothing filled.
   * @param {string} cwd @param {string} words
   */
  async function fillFor(cwd, words) {
    if (none && !(await write("POST", "", { need: true }))) return;
    cb.startWith?.(cwd, words);
  }

  const board = boardPanel({
    lanes: refs,
    nameOf,
    plain: () => noGit(),
    makes,
    asks: (chain) => cb.look.now(chain)?.group === "needs",
    openChat: (chain) => cb.openChat(chain),
    write,
    startOn: (task) => {
      if (!project || !cb.startOn) return;
      const lane = task.place ? refs().find((l) => placeKey(l.path) === placeKey(task.place)) : null;
      // A Space of your own asks where the chat runs (A4); a project's starts in its lane or folder.
      if (space?.own && cb.handOff) return void cb.handOff(project.id, project.cwd, task.line ? `${task.title}\n\n${task.line}` : task.title, task);
      cb.startOn(project.id, task, lane?.path || project.cwd);
    },
    // Send to a lane (the owner's of 11-02): the chat opened, the task's words first in its box, its files with them.
    sendTo: cb.askChat ? (task, chain) => cb.askChat?.(chain, task.line ? `${task.title}\n\n${task.line}` : task.title, project ? { project: project.id, task } : undefined) : undefined,
    attach: (task, files) => attachTo(task, files),
    fileUrl: (task, file) => taskFileUrl(at.id, task.id, file.id),
    // A task of the board reproduced (S7-D1): from the project's folder, on a lane of its own.
    reproduce: cb.reproduce
      ? (task) => {
          if (project) cb.reproduce?.(project.cwd, { title: task.title, text: task.line, from: `a task on the board of ${project.name}'s Space` });
        }
      : undefined,
    fedMenu: (f, anchor) => fedMenu(f, anchor),
    pulledMenu: (f, anchor) => pulledMenu(f, anchor),
    // A lane's Has: reads the board as it draws the person's moves, so it follows a drop before the Space answers it.
    moved: () => {
      if (project && answer) paintLanes();
    },
  });
  const sync = syncCard({
    chats: () =>
      lanes.flatMap((l) => {
        const ref = laneRef(l);
        /** @param {LaneChat} c @param {boolean} lead */
        const row = (c, lead) => ({ chain: c.id, name: c.team ? `${possessive(c.team)} lead` : c.name, chip: ref.chip, main: l.main, works: c.tone === "works" || c.tone === "needs", lead });
        return [...(l.lead ? [row(l.lead, true)] : []), ...l.others.map((o) => row(o, false))];
      }),
    last: () => space?.syncs.at(-1) || null,
    run: (body) => write("POST", "/sync", body),
    nameOf,
    plain: () => noGit(),
  });
  const left = leftOffCard({
    nameOf,
    openChat: (chain) => cb.openChat(chain),
    catchUp: (since) => { if (project && cb.startWith) cb.startWith(project.cwd, catchUpWords(toolMoment(since), noGit())); },
    dismiss: () => {
      leftSince = Date.now();
      keepLook(at.id, leftSince);
      paintLeft();
    },
  });
  // Where you left off at the top of What happened (the reshape of 10-29): one logbook, what came since your last look first.
  const logbook = logbookPanel({
    lanes: refs,
    nameOf,
    laneOf,
    write: (text) => write("POST", "/log", { text }),
    makes,
    copyWeek: () => void copyWeek(),
    tell: () => sync.open(),
    left: left.el,
    card: sync.el,
    openChat: (chain) => cb.openChat(chain),
  });
  // Its Routines (S6): a tab, there once a routine or a kept watch is (SG-D0) — what runs by itself, and what you run.
  // Its Watchers: a tab beside it, there once a watcher is — what listens for events, and whom each wakes.
  /** @type {import("./routines.js").RoutinesCtx} */
  const runsCtx = {
    all: false,
    place: () => project,
    write: (_p, method, path, body) => write(method, path, body),
    pauseAll: async (on) => {
      try {
        await api("/spaces/pause", { method: "POST", body: { on } });
        void readSpace();
        return true;
      } catch (e) {
        toast(said(e), "err");
        return false;
      }
    },
    startWith: cb.startWith ? (cwd, words) => void fillFor(cwd, words) : undefined,
    openChat: (chain) => cb.openChat(chain),
    askChat: cb.askChat,
    openTab: (_p, name) => go(name),
    procedures: () => api(`${base()}/procedures`).then((r) => (Array.isArray(r?.procedures) ? r.procedures : [])),
    lookAfter: () => openLookAfter(),
    ...(cb.catalogue ? { catalogue: cb.catalogue } : {}),
    modelName: (id) => cb.look.modelName(id),
  };
  const routines = routinesPart(runsCtx);
  const watchers = watchersPart(runsCtx);
  // What runs by itself, on the Board beside its lanes: a row for each routine, watcher and app, a press opening its
  // page; Keep… is the app's own sheet, and "and N more" over apps alone the crumb's ⌄ list, from its line.
  const byItself = byItselfPart({ ...runsCtx, makes, keep: (name) => dashboards.keep(name), pages: (anchor) => openTabs(anchor) });
  // Its dashboards (S2): each one's page in a frame, its bar, its Keep sheet; which one shows is the address's.
  const dashboards = dashboardsPart({
    project: () => project,
    own: () => !!space?.own,
    makes,
    write,
    request,
    startWith: (cwd, words) => cb.startWith?.(cwd, words),
    handOff: cb.handOff ? (cwd, words) => (project ? cb.handOff?.(project.id, cwd, words) : undefined) : undefined,
    openArtifact: (name) => cb.openArtifact?.(name),
    // What its page asks an agent goes through this Space's own way for an app's ask (the owner's of 11-04).
    frame: (name, title, onAct, more) => (cb.dashboardFrame ? cb.dashboardFrame(name, title, project?.cwd || "", onAct, project?.id, { ...more, ask: (text) => appAsk(title, text) }) : { el: h("div", { class: "sdb-unframed" }), setTitle: () => {}, again: () => {}, version: () => {} }),
    // A button's sheet: the models its second look or check may run on, and who and what it names.
    ...(cb.catalogue ? { catalogue: cb.catalogue } : {}),
    chatName: (chain) => cb.look.chat(chain)?.title || space?.names?.[chain] || "",
    modelName: (id) => cb.look.modelName(id),
    go: (t) => go(t),
    onTab: (t) => {
      // An app, Routines or Watchers has the page to itself: the Board's head and sections hide, and the crumb names it.
      overview.hidden = t !== OVERVIEW;
      head.hidden = t !== OVERVIEW;
      routines.show(t === ROUTINES, at.id);
      watchers.show(t === WATCHERS);
      paintCrumb();
      // The address names the page shown (the owner's idea of 10-29): its row in the left bar is marked, and Back
      // returns to it. A page left says nothing: the address is the next page's.
      const loc = /** @type {any} */ (globalThis).location;
      const here = loc ? parseRoute(loc.hash) : null;
      const want = routeFor("space", { id: at.id, tab: t });
      if (!stopped && here?.kind === "space" && here.id === at.id && loc.hash !== want) loc.replace(want);
    },
  });
  dashboards.show(at.tab || OVERVIEW);

  /** The week's page, copied as Markdown for the person's notes. */
  async function copyWeek() {
    try {
      const r = await fetch(`/api${base()}/week.md`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await navigator.clipboard.writeText(await r.text());
      toast("This week's page copied as Markdown");
    } catch (e) {
      toast(`Not copied: ${said(e)}`, "err");
    }
  }

  // Places (the mock's 8), in a sheet since the reshape of 10-29: ⋯ › Folders and worktrees…, or the project's menu in
  // the left bar. Its words are drawn as the places are read, the sheet open or not.
  const placesWordsEl = h("span", { class: "sp-quiet sp-places-words" });
  /** The places' sheet while it is open. @type {{ el: HTMLElement, close: () => void } | null} */
  let placesSheet = null;
  /** Folders and worktrees…: the project's places in a sheet, one at a time. */
  function openPlaces() {
    if (placesSheet?.el.isConnected) return;
    placesSheet = sheet({
      label: "Folders and worktrees",
      class: "sp-places-sheet",
      head: h("b", { class: "sp-sheet-title" }, "Folders and worktrees"),
      body: h("section", { class: "sp-places", "aria-label": "Folders and worktrees" },
        h("div", { class: "sp-panel-h" },
          placesWordsEl,
          h("button", { class: "ghost icon sp-again", type: "button", "aria-label": "Read them again", title: "Read them again", html: ICONS.rotateCcw, onclick: () => read({ footprint: true }) })),
        places.el),
      onClose: () => { placesSheet = null; },
    });
  }

  // ⋯ (the reshape of 10-29): the project's settings — a Space of your own's are its own (A6) —, what its chats reach
  // and can use, and its folders, none of it on the page by default.
  const settingsBtn = h("button", { class: "ghost icon sp-settings", type: "button", "aria-haspopup": "menu", "aria-label": "Project settings, connectors, plugins, skills and folders", title: "Project settings, connectors, plugins, skills and folders", html: icon("ellipsis"), onclick: () => openSettings() });
  const crumbIc = h("span", { class: "sp-crumb-ic", html: ICONS.folder });
  const tile = h("span", { class: "team-tile sp-tile", "aria-hidden": "true", html: ICONS.squareKanban });
  // An empty Space's first screen (the Designer's redesign of 10-29): Start here, on top of the Board.
  const firstEl = h("div", { class: "sp-first-slot" });
  /** Whether Start here is shown: the page's first screen, Needs you off it. */
  let first = false;
  /** What Start here was last drawn for. */
  let firstKey = "";
  // What extends a Space (SG-D0): nothing is there until it is added.
  const addBtn = h("button", { class: "ghost sm sp-add", type: "button", "aria-haspopup": "menu", title: "What extends this Space: nothing is there until you add it", onclick: () => void openAdd() },
    h("span", { class: "sp-btn-ic", html: ICONS.plus }), "Add to this Space…");
  // The crumb names an app's or Routines' page after its Space — "r › Space › Deploys" —, its Space the way back to the
  // Board; ⌄ lists what else the Space shows, the left bar hidden or not.
  const crumbPage = h("button", { class: "sp-crumb-page", type: "button", onclick: () => go(OVERVIEW) }, "Space");
  const crumbAppSep = h("span", { class: "sp-crumb-sep", hidden: "" }, "›");
  const crumbApp = h("span", { class: "sp-crumb-app", hidden: "" });
  const crumbGo = h("button", { class: "ghost icon sp-crumb-go", type: "button", "aria-haspopup": "menu", "aria-label": "This Space's apps", title: "This Space's apps", hidden: "", html: ICONS.chevronDown, onclick: () => openTabs() });
  /** The crumb as the page shown says it. */
  function paintCrumb() {
    const t = dashboards.title();
    crumbPage.classList.toggle("is-link", !!t);
    crumbPage.setAttribute("title", t ? "Back to the Board" : "The Board");
    crumbAppSep.hidden = !t;
    crumbApp.hidden = !t;
    crumbApp.replaceChildren(t);
    crumbGo.hidden = !dashboards.tabs().length;
  }
  /**
   * A page the person picks — the crumb's Space, ⌄, a chip's or a card's Open, Put back —: its address set first, a move
   * Back undoes (the page says itself in the address by replacing it only to correct it), then shown at once.
   * @param {string} tab
   */
  function go(tab) {
    const loc = /** @type {any} */ (globalThis).location;
    const here = loc ? parseRoute(loc.hash) : null;
    const want = routeFor("space", { id: at.id, tab });
    if (!stopped && here?.kind === "space" && here.id === at.id && loc.hash !== want) loc.hash = want;
    dashboards.select(tab);
  }
  /**
   * ⌄: the Board, Routines, Watchers and each app, the one shown checked. `anchor`: where the list opens, the crumb's ⌄
   * unless another line opens it. @param {HTMLElement} [anchor]
   */
  function openTabs(anchor = crumbGo) {
    const on = dashboards.selected();
    menu([{ key: OVERVIEW, label: "Board" }, ...dashboards.tabs()].map((x) => ({ type: "radio", label: x.label, checked: x.key === on, onClick: () => go(x.key) })),
      { anchor, side: "bottom", align: "start", width: 220 });
  }
  const top = h("div", { class: "settings-top sp-top" },
    h("span", { class: "sp-crumb" }, crumbIc, crumbName, h("span", { class: "sp-crumb-sep" }, "›"), crumbPage, crumbAppSep, crumbApp, crumbGo),
    h("span", { class: "sp-top-acts" },
      settingsBtn,
      h("button", { class: "ghost sm", type: "button", onclick: () => cb.onClose() }, "Back to chat")));
  /** New chat here…: the Start in its folder; nothing runs until you send. */
  const newChatHere = () => { if (project) cb.newChat(project.cwd, false); };
  // The head's filled button is what its page is for. A project's page is where a chat is started many times a day and
  // an app made once: New chat here… is the filled one there, Add to this Space… beside it, and New app… that menu's
  // first row, not drawn in the head. A Space of your own is for its apps (the Designer's redesign of 10-29): New app…
  // filled, New chat here… quiet beside it (`paintActs`).
  // What its agents run on (the owner's of 11-04), a quiet chip under the line: a press opens its Space settings.
  const runsEl = h("button", { class: "sp-runs-on", type: "button", hidden: "", onclick: () => openSpaceSettings() });
  const NEW_CHAT_TIP = "The Start in this Space's folder: a chat started there works in this Space. Nothing runs until you send";
  const newChatBtn = h("button", { class: "sm primary sp-new-chat", type: "button", title: NEW_CHAT_TIP, onclick: () => newChatHere() },
    h("span", { class: "sp-btn-ic", html: ICONS.messageCirclePlus }), "New chat here…");
  const newAppBtn = h("button", { class: "sm primary sp-new-app", type: "button", hidden: "", title: "Say what it should do, or pick a starter: an agent makes it in a chat, and nothing runs until you keep it", onclick: () => dashboards.make() },
    h("span", { class: "sp-btn-ic", html: ICONS.plus }), "New app…");
  /** The head's acts as the Space's kind has them: a project's, or a Space of your own's. */
  function paintActs() {
    const own = !!space?.own;
    newChatBtn.className = own ? "ghost sm sp-new-chat" : "sm primary sp-new-chat";
    newAppBtn.hidden = !own;
  }
  const head = h("div", { class: "sp-head" },
    tile,
    h("div", { class: "sp-head-words" }, titleEl, lineEl, runsEl),
    addBtn, newChatBtn, newAppBtn);
  paintActs();
  /** A section's head: its name, how many, and its quiet words or its buttons at the right. @param {string} name @param {HTMLElement | null} count @param {...any} end */
  const secHead = (name, count, ...end) => h("div", { class: "sp-sec-h" }, h("h3", { class: "sp-sec-name" }, name), ...(count ? [count] : []), h("span", { class: "sb-sp" }), ...end);
  const needsNone = h("span", { class: "sp-quiet sp-needs-none" }, "Nothing needs you here.");
  const needsWords = h("span", { class: "sp-quiet", hidden: "" }, "as Now has them, this project's");
  // Under the rows: those done today and those put off, each list behind its Show, each row with Bring back (S5a).
  const needsFoot = h("div", { class: "sp-needs-foot", hidden: "" });
  const needsSec = h("section", { class: "sp-sec sp-needs-sec", "aria-label": "Needs you here" },
    h("div", { class: "sp-sec-h" }, h("h3", { class: "sp-sec-name" }, "Needs you here"), needsCount, needsNone, h("span", { class: "sb-sp" }), needsWords),
    needsList, needsFoot);
  // Needs you is off while it holds nothing — no row, none done today or put off (the Designer's walk of 10-29: an empty
  // one was the first thing a Space said). Under Start here it shows a project's chats that ask you (the reviewer of
  // 10-29: Start here hid them), the only rows it can hold then: a kept row ends Start here.
  let needsHas = false;
  const paintNeedsShown = () => void (needsSec.hidden = !project || !needsHas);
  /** Which of the foot's lists is open. @type {"" | "done" | "later"} */
  let needsShow = "";
  // The lanes: who works here, open on the page. Beside their head how many, and which need you, work or stopped; New
  // lane…, what a second lane is for in its tip; and Hide, which folds their cards to that line — folded, the page opens
  // them folded again while the harness is open.
  const lanesWordsEl = h("span", { class: "sp-quiet sp-lanes-words" });
  const lanesBody = h("div", { class: "sp-lanes-body", id: `sp-lanes-${at.id}` }, lanesEl);
  const lanesToggle = h("button", { class: "ghost sm sp-lanes-go", type: "button", "aria-expanded": "true", "aria-controls": lanesBody.id, onclick: () => openLanes(lanesBody.hidden) },
    h("span", { class: "sp-lanes-go-words" }, "Hide"), h("span", { class: "sp-lanes-chev", html: ICONS.chevronDown }));
  const NEW_LANE = "The Start here, on a new worktree — a branch and a folder of its own, made when you send —: a second lane, to work on two things at once";
  /**
   * Why New lane… cannot be pressed here, in words; "" where it can. A new lane is a new worktree, and a folder git
   * reads no repository in has none to make: its press opened the Start on "A new worktree", which the Start's Works in
   * row does not show there, and the first send was refused, no chat made (found on 11-12). Unread, it is offered: the
   * press only fills the Start.
   */
  const noNewLane = () =>
    answer && !answer.ok ? `A new lane is a new worktree, made by git — and git could not read this folder: ${answer.error || "not in a git repository"}. New chat here… starts one in the folder itself.` : "";
  const newLaneBtn = h("button", {
    class: "ghost sm sp-new-lane",
    type: "button",
    title: NEW_LANE,
    onclick: () => { if (project && !noNewLane()) cb.newChat(project.cwd, true); },
  }, h("span", { class: "sp-btn-ic", html: ICONS.plus }), "New lane…");
  /** New lane… as the places' last read leaves it: greyed, its tip saying why, where no worktree can be made. */
  const paintNewLane = () => {
    const why = noNewLane();
    newLaneBtn.toggleAttribute("disabled", !!why);
    newLaneBtn.setAttribute("title", why || NEW_LANE);
  };
  const lanesSec = h("section", { class: "sp-sec sp-lanes-sec", "aria-label": "Lanes" }, secHead("Lanes", lanesCount, lanesWordsEl, newLaneBtn, lanesToggle), lanesBody);
  /** The lanes opened or folded, kept for the project. @param {boolean} on */
  function openLanes(on) {
    lanesBody.hidden = !on;
    lanesToggle.setAttribute("aria-expanded", String(on));
    lanesToggle.querySelector(".sp-lanes-go-words")?.replaceChildren(on ? "Hide" : "Show");
    lanesSec.classList.toggle("is-open", on);
    if (on) lanesFolded.delete(at.id);
    else lanesFolded.add(at.id);
  }
  openLanes(!lanesFolded.has(at.id));
  // What the kept dashboards put on the board, by each: "+ 5 from Issues" (S4c).
  const fedCountEl = h("span", { class: "sp-quiet sp-fed-count", hidden: "" });
  // Each pull's chip (the Space Apps plan of 10-29): its service and how many it put on the board; its menu.
  const pullChipsEl = h("span", { class: "sp-pull-chips" });
  const PULL_DOES = "Linear, GitHub or Jira onto this board, through one of its connectors: their issues as cards, moved back only when you say so";
  const pullBtn = h("button", { class: "ghost sm sp-pull", type: "button", title: PULL_DOES, onclick: () => openPull(null) },
    h("span", { class: "sp-btn-ic", html: ICONS.download }), "Pull from…");
  const newTaskBtn = h("button", { class: "ghost sm sp-new-task", type: "button", title: "A task on the board, for you and the chats here", onclick: () => board.add() }, h("span", { class: "sp-btn-ic", html: ICONS.plus }), "New task…");
  const tasksSec = h("section", { class: "sp-sec sp-tasks", "aria-label": "Tasks" },
    secHead("Tasks", null, fedCountEl, pullChipsEl, pullBtn, newTaskBtn),
    board.el, boardNote);
  const work = h("div", { class: "sp-work" }, tasksSec, logbook.el);
  // From its projects (A7): a Space of your own shows projects, each one's Needs you and tiles, done here as there.
  // Its head is there only while a project shows: the page's sections are the mock's until then.
  const showsEl = h("div", { class: "sp-shows" });
  const showsHead = secHead("From its projects", null, h("span", { class: "sp-quiet" }, "a row done here is done in its project"));
  const showsSec = h("section", { class: "sp-sec sp-shows-sec", "aria-label": "From its projects", hidden: "" });
  let showsOn = false;
  // No Space yet (10-29: none until the person makes one): what one is, Make a Space, and Bring it back where its last
  // was deleted. Its lanes and Places are the project's, and stay. Its title and its words are `paintNone`'s: with no
  // deleted Space that waits, the first thing added makes one (by need, 11-12), and Make a Space is the quiet way to an
  // empty one.
  const noneTitle = h("h3", { class: "sp-none-title" });
  const noneWhat = h("p", { class: "sp-quiet sp-none-what" });
  const noneBackWords = h("p", { class: "sp-quiet sp-none-back", hidden: "" });
  const noneBack = h("button", { class: "ghost sm", type: "button", hidden: "", onclick: () => void bringBack() }, h("span", { class: "sp-btn-ic", html: ICONS.rotateCcw }), "Bring it back");
  const noneMake = h("button", { class: "ghost sm sp-none-make", type: "button", onclick: () => void makeHere() }, h("span", { class: "sp-btn-ic", html: ICONS.plus }), "Make a Space");
  const noneEl = h("section", { class: "sp-none", "aria-label": "No Space yet", hidden: "" },
    h("span", { class: "team-tile sp-tile", "aria-hidden": "true", html: ICONS.squareKanban }),
    h("div", { class: "sp-none-words" }, noneTitle, noneWhat, noneBackWords),
    h("span", { class: "sp-none-acts" }, noneBack, noneMake));
  /** Make a Space here: made, with its old board's tasks where it had a Space before. */
  async function makeHere() {
    noneMake.disabled = true;
    try {
      const r = await api(base(), { method: "POST" });
      const n = Number(r?.tasks) || 0;
      toast(n ? `This Space is made: ${n} task${n === 1 ? "" : "s"} came back from its old board` : "This Space is made");
      await readSpace();
      cb.onMoved();
    } catch (e) {
      toast(said(e), "err");
    } finally {
      noneMake.disabled = false;
    }
  }
  /** Bring it back: as it was when it was deleted. */
  async function bringBack() {
    try {
      const got = await api(`${base()}/back`, { method: "POST" });
      toast(backWords("This Space is back", got?.takenOut));
      await readSpace();
      cb.onMoved();
    } catch (e) {
      toast(said(e), "err");
    }
  }
  /**
   * The page as a project with no Space has it: the card, its lanes and Places, and a Space's own parts drawn from an
   * empty one (`paintSpace`), each press saying in its tip that it makes the Space (by need, 11-12). While its deleted
   * Space waits, none of those parts — hidden by the page's class (space.css) —: the card alone, with Bring it back and
   * Make a Space.
   */
  function paintNone() {
    const no = !!none;
    const at = none?.deletedAt || 0;
    const m = makes();
    root.classList.toggle("sp-is-none", no);
    root.classList.toggle("sp-is-deleted", !!at);
    noneEl.hidden = !no;
    noneTitle.replaceChildren(at ? "This project has no Space" : "No Space yet");
    noneWhat.replaceChildren(`A Space is the project's board of tasks and What happened — the log of what its chats did —, with the apps they make for it. ${at ? "Once it is made, every chat in this project can see and change it." : "The first thing you add here makes it: from then every chat in this project can see and change it."} Its lanes and folders are here either way.`);
    noneBack.hidden = !at;
    noneBackWords.hidden = !at;
    noneBackWords.replaceChildren(at ? `Its Space was deleted ${lookWords(at, Date.now())}: Bring it back has it as it was, for 30 days from then.` : "");
    if (m) noneMake.setAttribute("title", "An empty Space, on purpose: the first thing you add here makes one anyway");
    else noneMake.removeAttribute("title");
    addBtn.setAttribute("title", m ? "What a Space can hold: the first thing you add makes this project's Space" : "What extends this Space: nothing is there until you add it");
    newTaskBtn.setAttribute("title", `A task on the board, for you and the chats here${m ? ": the first one makes this project's Space" : ""}`);
    pullBtn.setAttribute("title", `${PULL_DOES}${m ? ". Saving one makes this project's Space" : ""}`);
    // A chat makes no Space: with none, its tip says where it starts and nothing of a Space there is not.
    newChatBtn.setAttribute("title", no ? "The Start in this project's folder. Nothing runs until you send" : NEW_CHAT_TIP);
  }
  // Who works here (the Designer's redesign of 10-29; the owner's first question, on a Space of their own: which agent
  // works in it): where the folder draws no lanes, its chats as rows — what each does and who runs it —, a press opening
  // one. Its head is there only then: a Space with lanes says its chats in them.
  const whoCount = h("span", { class: "sp-sec-count" });
  const whoList = h("div", { class: "sp-who", role: "list" });
  const whoNone = h("p", { class: "sp-quiet sp-who-none" }, "No chat works here yet. New chat here… starts one: it can see and change this Space.");
  const whoMore = h("p", { class: "sp-quiet sp-who-more", hidden: "" });
  const whoSec = h("section", { class: "sp-sec sp-who-sec", "aria-label": "Who works here", hidden: "" });
  // Who works here beside what runs by itself: the lanes — Who works here where the folder draws none — and their
  // Overlaps at the left, Runs by itself at the right, under them on a narrow page (space.css `.sp-pair`).
  const pair = h("div", { class: "sp-pair" }, h("div", { class: "sp-pair-main" }, whoSec, lanesSec, overlapEl), byItself.el);
  /** The pair's left column holds nothing — no lanes drawn, nobody listed —: what runs by itself takes its row whole. */
  const paintPair = () => void pair.classList.toggle("is-single", !project || (noGit() && (!answer || first)));
  const overview = h("div", { class: "sp-overview" }, firstEl, noneEl, needsSec, showsSec, pair, work);
  const scroll = h("div", { class: "sp-scroll" }, head, overview, routines.el, watchers.el, dashboards.view);
  root.append(top, scroll);

  /** Import app…'s file (phase 4): a .zip, picked. */
  const importInput = /** @type {HTMLInputElement} */ (h("input", { type: "file", class: "hidden sp-import", accept: ".zip,application/zip", "aria-label": "An app's .zip", onchange: (/** @type {any} */ e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void importApp(file);
  } }));
  root.append(importInput);
  /**
   * An app's .zip imported (Import app…): unpacked into the project's .filament/apps/, published as a draft of this
   * Space, its tab shown. @param {File} file
   */
  async function importApp(file) {
    /** @type {string} */
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || "").replace(/^data:[^,]*,/, ""));
      r.onerror = () => reject(r.error || new Error(`${file.name} could not be read`));
      r.readAsDataURL(file);
    }).catch((e) => (toast(said(e), "err"), ""));
    if (!data) return;
    // Its own toast says the Space it made too (by need, 11-12), in one.
    const got = await write("POST", "/import-app", { data }, { says: false });
    if (!got) return;
    toast([`“${got.title}” is a draft here, unpacked in ${got.folder}: nothing runs until you keep it`, madeWords(got)].filter(Boolean).join(". "));
    go(String(got.name));
  }
  /** An app the project's folder holds, added as a draft (phase 4). @param {{ folder: string, title: string }} x */
  async function addFolderApp(x) {
    const got = await write("POST", "/folder-apps", { folder: x.folder }, { says: false });
    if (!got) return;
    toast([`“${got.title}” is a draft here: nothing runs until you keep it`, madeWords(got)].filter(Boolean).join(". "));
    go(String(got.name));
  }

  /** Add to this Space…: what a Space can grow, each made or chosen elsewhere; nothing is added on the press. */
  async function openAdd() {
    if (!project) return;
    const p = project;
    // The apps its folder brings that are not here yet (phase 4), asked as the menu opens; none where that fails.
    const found = space?.own ? null : await request("GET", "/folder-apps");
    /** @type {{ folder: string, title: string, description: string }[]} */
    const fromFolder = found?.ok && Array.isArray(found.got.apps) ? found.got.apps : [];
    if (project !== p) return;
    menu([
      // ＋ New app (10-29): your words or a starter; Numbers is the tile dashboard this item made before.
      // A Space of your own's starters are its own (the Designer's redesign of 10-29).
      // New app…, first: a project's page reaches it here; a Space of your own's head has it too, by this one name
      // (the Designer's walk of 10-29: two names for one thing).
      { label: "New app…", icon: "layoutDashboard", desc: `What it should do, or a starter — ${space?.own ? "To-do list, Habits, Reader, A small game" : "Pipeline, Team pulse, Reader, Numbers"} —, made in a chat: nothing runs until you keep it`, onClick: () => dashboards.make() },
      // Import app… (phase 4): a .zip of an app, unpacked into this project and added as a draft.
      ...(space?.own ? [] : [{ label: "Import app…", icon: "package", desc: "An app's .zip — its download from Filament, or its folder zipped —, unpacked into this project's .filament/apps/: a draft, nothing runs until you keep it", onClick: () => importInput.click() }]),
      // The apps this project's folder brings (phase 4): a repo's, or one an agent made, not added here yet.
      ...fromFolder.map((x) => ({ label: `“${x.title}” from this project's folder`, icon: "folderOpen", desc: `${x.folder}${x.description ? ` · ${x.description}` : ""} · a draft: nothing runs until you keep it`, onClick: () => void addFolderApp(x) })),
      // Routine… and Watcher… fill the Start; on a project with no Space yet the press makes it first, and says so here.
      ...(cb.startWith ? [{ label: "Routine…", icon: "clock3", desc: `Work an agent does by itself at a time, made in a chat: it runs only once you switch it on${makes() ? ASK_MAKES_SPACE : ""}`, onClick: () => void fillFor(p.cwd, routineMakeWords(p.name)) }] : []),
      // What the Watchers page's own Watcher… does: a Space with none has this way in.
      ...(cb.startWith ? [{ label: "Watcher…", icon: "eye", desc: `Something that listens for an event and wakes an agent, or tells you, made in a chat: it listens only once you switch it on${makes() ? ASK_MAKES_SPACE : ""}`, onClick: () => void fillFor(p.cwd, watcherMakeWords(p.name)) }] : []),
      // Connectors, plugins and skills are under ⋯ since the reshape of 10-29 (openSettings).
      // A Space of your own shows projects (A7): their rows and tiles here, the project itself where it was.
      ...(space?.own && cb.projects ? [{ label: "Include a project…", icon: "folder", desc: SHOW_WHAT, onClick: () => void showProject() }] : []),
      ...dashboards.backItems(space?.gone || []),
      ...routines.backItems(at.id),
      ...watchers.backItems(at.id),
      // Last, never shown by itself (S6-D9).
      ...(cb.startWith ? [{ type: "separator" }, { label: "What do you look after…", icon: "listTodo", desc: "Tick the kinds of work: an agent proposes routines and apps for them, each yours to switch on", onClick: () => openLookAfter() }] : []),
    ], { anchor: addBtn, side: "bottom", align: "end", width: 300 });
  }

  /**
   * ⋯ › Plugins… (HarnessV4_SpacesPlugins_Plan B5; Add to this Space…'s until the reshape of 10-29): the plugins
   * installed here, each opening its sheet with this Space picked, and the Library's page to find more. Nothing is
   * turned on by the press.
   */
  async function openPlugins() {
    if (!project) return;
    const at = `project:${project.id}`;
    let list = /** @type {any[]} */ ([]);
    try { list = (await api("/plugins/installed"))?.plugins || []; } catch (/** @type {any} */ e) { return void toast(String(e?.message || e), "err"); }
    const library = () => { location.hash = routeFor("library", { page: "plugins" }); };
    if (!list.length) return library();
    menu([
      { type: "label", label: "Installed here" },
      ...list.map((p) => {
        const here = (p.on || []).some((/** @type {any} */ w) => w.place === at && w.on);
        return { label: p.title || p.name, icon: "puzzle", desc: here ? "Open it to turn it off here or change its values" : `From ${p.origin}`, ...(here ? { note: "on here" } : {}), onClick: () => void pluginSheet({ id: p.id, place: at, onToast: (/** @type {string} */ m, /** @type {string | undefined} */ k) => toast(m, k) }) };
      }),
      { type: "separator" },
      { label: "Find more…", icon: "search", desc: "Library › Plugins & Connectors: what Claude Code and Codex have, and their marketplaces", onClick: library },
    ], { anchor: settingsBtn, side: "bottom", align: "end", width: 300 });
  }

  /** ⋯ › Skills…: Library › Skills on this place; nothing is turned on by the press. */
  function openSkills() {
    if (!project) return;
    holdJump({ section: "skills", start: `project:${project.id}` });
    location.hash = routeFor("library", { page: "skills" });
  }

  /**
   * What do you look after… (S6, screen 3): its ticks fill the Start in this project's folder; nothing runs. On a
   * project with no Space yet its sheet says the ask makes it, and its press does (`fillFor`).
   */
  function openLookAfter() {
    if (!project || !cb.startWith) return;
    // A project shown in a Space of yours leaves the reviews asked of you and your weekly update to it (the owner's word
    // of 10-26).
    const above = space?.shownIn;
    // A Space of your own's kinds each read an account: whether one is connected, said over them — or why the list
    // could not be read, which is never taken for one connected.
    const connected = () => api(`/mcp-servers?scope=${encodeURIComponent(`project:${project?.id}`)}`).then((r) => (r?.servers || []).some((/** @type {any} */ x) => x.on !== false && !x.orphan)).catch((e) => said(e));
    lookAfterSheet({ place: project, startWith: (cwd, words) => void fillFor(cwd, words), ...(space?.own ? { kinds: LOOK_AFTER_OWN, connected: connected(), onConnect: () => openConnections() } : above ? { kinds: LOOK_AFTER_SHOWN, note: `Reviews asked of you and your weekly update are ${above.name}'s.` } : makes() ? { note: "Ask an agent… makes this project's Space: what its agent proposes lives there." } : {}) });
  }

  /** A Space of your own whose folder is no git repository (A3): no lanes, overlaps or places to show. */
  const noGit = () => !!space?.own && !space.own.repo;
  /** How many chats Who works here shows; the left bar lists the rest under the Space. */
  const WHO_MAX = 8;
  /** Who works here: the chats of a Space with no lanes, as its one folder's lane has them; Start here says it first. */
  function paintWho() {
    const on = !!project && noGit() && !!answer && !first;
    whoSec.hidden = !on;
    paintPair();
    if (!on) return void whoSec.replaceChildren();
    if (!whoSec.childNodes.length) whoSec.append(secHead("Who works here", whoCount, h("span", { class: "sp-quiet" }, "any chat started here works in this Space, whichever agent you pick")), whoList, whoNone, whoMore);
    const chats = lanes.flatMap((l) => [...(l.lead ? [l.lead] : []), ...l.others]);
    whoCount.replaceChildren(chats.length ? String(chats.length) : "");
    whoNone.hidden = !!chats.length;
    whoMore.hidden = chats.length <= WHO_MAX;
    whoMore.replaceChildren(chats.length > WHO_MAX ? `and ${chats.length - WHO_MAX} more — the left bar lists them under ${project?.name || "this Space"}` : "");
    // In place, each row kept by its chat: drawn at every move of the lanes, and a row made anew stood under a resting
    // pointer (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost).
    keepingFocus(whoList, () => morphChildren(whoList, chats.slice(0, WHO_MAX).map((c) =>
      h("button", { class: `sp-who-row${c.tone ? ` is-${c.tone}` : ""}`, type: "button", role: "listitem", title: `Open ${c.name}`, "data-chain": c.id, "data-key": `who:${c.id}`, onclick: () => cb.openChat(c.id) },
        h("span", { class: "sp-need-dot" }),
        h("span", { class: "sp-who-words" },
          h("span", { class: "sp-who-name" }, c.name),
          h("span", { class: "sp-quiet sp-who-state" }, [c.state, c.model].filter(Boolean).join(" · "))),
        h("span", { class: "sp-need-go" }, "Open ›")))));
  }
  /** Where a Space's first screen was put away by Not now, in this browser. @param {string} id */
  const awayKey = (id) => `harness.space.firstAway.${id}`;
  /** How many chats work here, as its lanes have them. */
  const chatsHere = () => lanes.reduce((n, l) => n + (l.lead ? 1 : 0) + l.others.length, 0);
  /**
   * An empty Space's first screen (the Designer's redesign of 10-29): Start here — what it is for, who works in it, and
   * three first steps — while it holds no app, task, routine, row or shown project, until Not now; Needs you is off it,
   * having nothing to say. A Space of your own's first chat ends it too (Who works here says it then); a project's chats
   * do not, being there before its Space (the Designer's walk of 10-29: recipes, one chat, › Make a Space opened on
   * nothing that said what it was). What do you look after? never shows by itself: it is a press of Start here's, and of
   * Add to this Space….
   */
  function paintFirst() {
    const s = space;
    let away = false;
    try {
      away = !!localStorage.getItem(awayKey(at.id));
    } catch {}
    first = !!s && !!project && !!answer && !away && !(s.own && chatsHere()) && !s.tasks.length && !(s.pulled?.tasks || []).length && !(s.feeds?.tasks || []).length && !(s.dashboards || []).length && !(s.needs || []).length
      && !(s.shows || []).length && !(s.runs?.routines || []).some((/** @type {any} */ r) => r.state !== "removed");
    paintNeedsShown();
    if (!first || !project || !s) {
      firstKey = "";
      return void firstEl.replaceChildren();
    }
    // Drawn again only as its words move: its name, its kind, how many chats a project has.
    const key = JSON.stringify([project.name, !!s.own, chatsHere()]);
    if (firstKey === key) return;
    firstKey = key;
    firstEl.replaceChildren(startHere({
      name: project.name,
      own: !!s.own,
      chats: chatsHere(),
      onNewApp: () => dashboards.make(),
      onNewChat: () => newChatHere(),
      onConnect: () => openConnections(),
      onLookAfter: cb.startWith ? () => openLookAfter() : null,
      onNotNow: () => {
        try {
          localStorage.setItem(awayKey(at.id), "1");
        } catch {}
        paintFirst();
        paintWho();
      },
    }));
  }

  /**
   * Include a project… (A7): a project of yours picked to show here — its Needs you and tiles —, the Space that showed it before
   * left. Spaces of your own are not offered, nor what shows here already. Its chats get this Space's connectors and
   * plugins (the owner's word of 10-26); the project stays under Projects.
   */
  async function showProject() {
    if (!project || !cb.projects) return;
    const here = project.id;
    const shown = new Set((space?.shows || []).map((s) => s.id));
    const choices = placeChoices(here, cb.projects(), cb.ownSpaces?.() || []).filter((c) => !c.own && c.id !== here && !shown.has(c.id));
    if (!choices.length) return void toast(shown.size ? "Every project of yours shows here already." : "You have no project to show yet: a chat in a folder makes one.");
    const p = await pickPlace({
      here,
      choices,
      title: "Show a project here",
      what: SHOW_WHAT,
      note: "A project shows in one Space at most: shown here, it leaves the Space it was in, and what that Space gave it. It stays under Projects.",
    });
    if (!p) return;
    const got = await write("POST", "/own/shows", { add: p.id });
    if (got) toast(`${p.name} shows here now: its chats get ${space?.own?.name || project.name}'s connectors and plugins from their next message.`);
  }

  /** Stop showing here (A7): the project's rows and tiles leave this page, and this Space's connectors and plugins its chats. @param {{ id: string, name: string }} s */
  async function stopShowing(s) {
    const got = await write("POST", "/own/shows", { drop: s.id });
    if (got) toast(`${s.name} no longer shows here, nor gets ${space?.own?.name || project?.name || "this Space"}'s connectors and plugins. It stays under Projects.`);
  }

  /**
   * The Space of yours that shows this project, beside its title (the owner's word of 10-26): "In Work", in Work's
   * colour; a press opens Work. None where no Space shows it.
   * @returns {HTMLElement[]}
   */
  const inSpaceChip = () => {
    const s = space?.shownIn;
    if (!s) return [];
    return [h("button", { class: `now-proj ys-proj sp-in-chip c-${chipTone(s.name)}`, type: "button", title: `Its chats get ${s.name}'s connectors and plugins`, onclick: () => cb.openSpace?.(s.id) }, `In ${s.name}`)];
  };

  /** A shown project's chip: its name in its colour, as Now draws it; a press opens its own Space. @param {{ id: string, name: string }} s */
  const showChip = (s) =>
    h("button", { class: `now-proj ys-proj sp-show-chip c-${chipTone(s.name)}`, type: "button", title: `Open ${s.name}'s Space`, onclick: () => cb.openSpace?.(s.id) }, s.name);

  /**
   * A shown project's rows (A7): drawn as its own Space draws them; a write goes to its Space — done here, done there —
   * and this one is read again. A dashboard's chip opens its tab in the project's Space.
   */
  const shownRows = needRows({
    place: (n) => {
      const s = (space?.shows || []).find((x) => x.id === n.project);
      return s ? { id: s.id, name: s.name, cwd: s.cwd, dashboards: s.dashboards } : null;
    },
    openTab: (id, name) => cb.openSpace?.(id, name),
    startWith: cb.startWith ? (cwd, words) => cb.startWith?.(cwd, words) : undefined,
    // Hand to an agent… from here asks where it runs, as this Space's own rows do (A4).
    handOff: cb.handOff ? (p, words) => { if (project) cb.handOff?.(project.id, p.cwd, words); } : undefined,
    post: async (id, path, body) => {
      try {
        const got = await api(`/space/${encodeURIComponent(id)}${path}`, { method: "POST", body });
        void readSpace();
        return got || {};
      } catch (e) {
        toast(said(e), "err");
        return null;
      }
    },
    askChat: cb.askChat,
    openChat: (chain) => cb.openChat(chain),
    reproduce: cb.reproduce ? (cwd, report) => cb.reproduce?.(cwd, report) : undefined,
    draftOf: (n, id) => (space?.shows || []).find((s) => s.id === n.project)?.needs.find((x) => x.id === id && x.kind === "draft") || null,
    watcher: (n) => !!(space?.shows || []).find((s) => s.id === n.project)?.watchers?.includes(n.routine?.id || n.ask?.routine || ""),
  });

  /** A chat of a shown project that asks you, as Now has it; a press opens it. @param {import("../lib/now.js").NowRow} r @param {number} now */
  const askingRow = (r, now) =>
    h("button", { class: `sp-need is-${r.tone || "asks"}`, type: "button", role: "listitem", title: `Open ${r.title}`, "data-chain": r.chain, "data-key": r.key, onclick: () => (cb.openRow ? cb.openRow(r) : cb.openChat(r.chain)) },
      h("span", { class: "sp-need-dot" }),
      h("span", { class: "sp-need-words" },
        h("span", { class: "sp-need-t" }, r.fact || "waits for you"),
        h("span", { class: "sp-need-f" }, r.title, ...(r.at ? [" · ", ageEl(r.at, now)] : []))),
      h("span", { class: "sp-need-go" }, "Open ›"));

  /** The tiles' hosts, by project, as drawn: the minute draws their cards again, in the one on the page (`standing`). @type {Map<string, HTMLElement>} */
  let tileHosts = new Map();
  let showsKey = "";
  let tilesKey = "";
  /**
   * From its projects (A7): each shown project — its chip, what needs you there, Open its Space and ⋯ —, its chats
   * that ask you, its kept rows, its dashboards' tiles. Drawn again where a row moved, and in place, each block and row
   * kept by its key — a row made anew as another moved put a new button under a resting pointer (the owner's of 11-01:
   * buttons blinking under a resting pointer, clicks lost) —; the minute moves the ages and the tiles alone.
   */
  function paintShows() {
    const shows = space?.own ? space.shows || [] : [];
    showsSec.hidden = !shows.length;
    if (showsOn !== !!shows.length) {
      showsOn = !!shows.length;
      showsSec.replaceChildren(...(showsOn ? [showsHead, showsEl] : []));
    }
    const now = Date.now();
    const asking = new Map(shows.map((s) => [s.id, cb.asking?.(s.id) || []]));
    const key = JSON.stringify([
      shows.map((s) => [s.id, s.name, s.cwd, s.dashboards, s.needs.map((n) => [n.id, n.text, n.at, n.until, n.doneAt, n.outcome, n.draft?.words, n.ask?.why, n.ask?.ended])]),
      [...asking].map(([id, rows]) => [id, rows.map((r) => [r.key, r.fact, r.tone, r.title, r.at])]),
      new Date(now).setHours(0, 0, 0, 0),
    ]);
    if (key === showsKey) moveAges(showsEl, now);
    else {
      showsKey = key;
      tilesKey = "";
      tileHosts = new Map();
      keepingFocus(showsEl, () => morphChildren(showsEl, shows.map((s) => {
        const open = needGroups(s.needs, now).open;
        const chats = asking.get(s.id) || [];
        const count = open.length + chats.length;
        const more = h("button", { class: "ghost icon sp-show-more", type: "button", title: `More for ${s.name}`, "aria-label": `More for ${s.name}`, "aria-haspopup": "menu", html: ICONS.ellipsis, onclick: (/** @type {Event} */ e) => menu([
          { label: "Stop showing here", icon: "eyeOff", desc: "Its rows and tiles leave this page; the project stays under Projects", onClick: () => void stopShowing(s) },
        ], { anchor: /** @type {HTMLElement} */ (e.currentTarget), side: "bottom", align: "end", width: 280 }) });
        // The tiles are the minute's to draw (`data-placed`): a block drawn again leaves its cards on the page as they are.
        const tiles = h("div", { class: "ys-cards sp-show-tiles", "data-key": "tiles", "data-placed": "", hidden: "" });
        tileHosts.set(s.id, tiles);
        return h("div", { class: "sp-show", "data-project": s.id, "data-key": `show:${s.id}` },
          h("div", { class: "sp-show-h", "data-key": "head" },
            showChip(s),
            h("span", { class: "sp-quiet sp-show-count" }, count ? `${count} need${count === 1 ? "s" : ""} you there` : "nothing needs you there"),
            h("span", { class: "sb-sp" }),
            h("button", { class: "ghost sm sp-show-go", type: "button", title: `Open ${s.name}'s own Space`, onclick: () => cb.openSpace?.(s.id) }, "Open its Space ›"),
            more),
          ...(count ? [h("div", { class: "sp-needs", role: "list", "aria-label": `Needs you in ${s.name}`, "data-key": "needs" }, ...chats.map((r) => askingRow(r, now)), ...open.map((n) => shownRows.row(n, now)))] : []),
          tiles);
      })));
    }
    const tk = JSON.stringify([shows.map((s) => s.glance), Math.floor(now / 60_000)]);
    if (tk === tilesKey) return;
    tilesKey = tk;
    for (const s of shows) {
      const host = tileHosts.get(s.id);
      if (!host) continue;
      const at = standing(host);
      at.hidden = !s.glance.length;
      keepingFocus(at, () => morphChildren(at, s.glance.map((d) => glanceCard(d, now, { open: () => cb.openSpace?.(s.id, d.name) }))));
    }
  }

  /** The Connectors sheet (S4b): the project's connectors, the account each signs in with, and what here uses each. */
  function openConnections() {
    if (!project) return;
    const p = project;
    void connectionsSheet({ project: { id: p.id, name: space?.own?.name || p.name }, own: !!space?.own, get: (path) => api(path), onSettings: () => cb.projectSettings(p.id, "mcp-servers") }).then((s) => (connections = s));
  }
  /** The Connectors sheet while it is open: the Space's moves read it again. @type {Awaited<ReturnType<typeof connectionsSheet>> | null} */
  let connections = null;

  /**
   * ⋯ (the reshape of 10-29): the project's settings pages, each opening with this project chosen; what its chats and
   * dashboards reach and can use — Connectors…, Plugins…, Skills…, Add to this Space…'s before —; and its folders
   * (Places, also in the project's menu in the left bar), where it has a repository.
   */
  function openSettings() {
    if (!project) return;
    const id = project.id;
    const whose = space?.own ? "Space's" : "project's";
    menu([
      // Its own model and what an app's ask does (the owner's of 11-04), over Settings › Space's.
      ...(space ? [{ label: "Space settings…", icon: "slidersHorizontal", desc: "The model its agents run on by themselves, with its effort, and what an app's ask does here", onClick: () => openSpaceSettings() }, { type: "separator" }] : []),
      { type: "label", label: space?.own ? "Settings" : "Project settings" },
      ...PROJECT_PAGES.map((p) => ({ label: p.label, icon: p.icon, desc: p.line, onClick: () => cb.projectSettings(id, p.section) })),
      { type: "separator" },
      // "used here" where a kept dashboard calls a connector's tool (S4b): the top bar's Connectors was there only then.
      { label: "Connectors…", icon: "plug", desc: `The accounts and services this ${whose} chats and apps can use, and the account each signs in with`, ...(usesConnections(space?.dashboards || []) ? { note: "used here" } : {}), onClick: () => openConnections() },
      // HarnessV4_SpacesPlugins_Plan B5: a plugin installed in the Library, turned on for this Space's chats.
      { label: "Plugins…", icon: "puzzle", desc: `Claude Code's or Codex's: their connectors, skills and commands in this ${whose} chats`, onClick: () => void openPlugins() },
      // HarnessV4_Skills_Plan S1-6: Library › Skills with this place picked, where a skill is turned on for it.
      { label: "Skills…", icon: "wandSparkles", desc: `How-tos every agent in this ${whose} chats can use: turn yours on for it, or tag one in a message`, onClick: () => openSkills() },
      ...(noGit() ? [] : [{ type: "separator" }, { label: "Folders and worktrees…", icon: "gitFork", desc: `The ${whose} main folder and each worktree: Remove where nothing is lost, Put back what was removed`, onClick: () => openPlaces() }]),
    ], { anchor: settingsBtn, side: "bottom", align: "end", width: 300 });
  }

  /** The Space's name as its sheets say it: its own name, or its project's. */
  const spaceName = () => space?.own?.name || project?.name || "this Space";
  /** What it runs on as the page holds it: none until its Space is read. @returns {import("../lib/space-settings.js").RunsOn} */
  const runsOnNow = () => space?.runsOn || { model: "", effort: "", from: "", asks: "ask", asksFrom: "" };

  /** The head's runs-on line (the owner's of 11-04): its model at its effort and whose, or that it has none. */
  function paintRunsOn() {
    const on = space?.runsOn;
    runsEl.hidden = !on;
    if (!on) return;
    const at = modelAt(on.model, on.effort, (id) => cb.look.modelName(id));
    runsEl.classList.toggle("is-none", !on.model);
    runsEl.classList.toggle("is-bad", !!on.problem);
    runsEl.textContent = !on.model ? "No model for its agents yet: choose one…" : `Its agents run on ${at}${on.from === "default" ? ", from Settings › Space" : ""}${on.problem ? " — can't run now" : ""}`;
    runsEl.title = on.problem ? `Can't run now: ${on.problem}. Choose another in Space settings…` : "What its routines and an app's asks run on by themselves, and what chats started here start on: Space settings…";
  }

  /** Space settings… (the owner's of 11-04): its own model and effort, and what an app's ask does, over Settings › Space's. */
  function openSpaceSettings() {
    if (!project || !space) return;
    spaceSettingsSheet({
      name: spaceName(),
      own: !!space.own,
      now: { settings: space.settings || {}, runsOn: runsOnNow() },
      nameOf: (id) => cb.look.modelName(id),
      save: async (patch) => {
        const got = await write("PATCH", "/settings", patch);
        return got?.space ? { settings: got.space.settings || {}, runsOn: got.space.runsOn } : null;
      },
      ...(cb.spaceDefaults ? { openDefaults: () => cb.spaceDefaults?.() } : {}),
      ...(cb.catalogue ? { catalogue: cb.catalogue } : {}),
    });
  }

  /**
   * An app's ask (its page's `filament.ask`, after a click in it; the owner's of 11-04): as the Space says an app's ask
   * goes — run here at once on its model, where it has one that can run; the Start here with the words; or, by default,
   * its sheet over the app, which says what would run where before anything does. A Space of your own asks nowhere else:
   * the app lives here.
   * @param {string} app @param {string} words
   */
  function appAsk(app, words) {
    if (!project) return;
    const p = project;
    const on = runsOnNow();
    const chat = () => cb.startWith?.(p.cwd, words);
    // The Start with its words costs nothing: a page that asks again only writes the box again.
    if (on.asks === "chat") return void chat();
    // One ask at a time (found by the review of 11-04): a click lends its page a few seconds in which it could ask again
    // and again — each a run in the background where asks run at once. One starting, or its sheet open, stands; the
    // rest are let go, said once.
    if (asking) {
      // Said once while it stands: a page that keeps asking says nothing more.
      if (!toldAgain) toast(`${app} asked again while its ask ${asking === "sheet" ? "waits in its sheet" : "is starting"}: one at a time`);
      toldAgain = true;
      return;
    }
    toldAgain = false;
    /** @param {string} model @param {string} effort */
    const run = async (model, effort) => {
      const got = await request("POST", "/asks", { words, app, model, effort });
      return got.ok ? { ok: /** @type {const} */ (true), chain: String(got.got.chain || ""), on: String(got.got.on || model) } : { ok: /** @type {const} */ (false), error: got.error };
    };
    /** Said once it runs: the person stays on the app, its chat a press away. @param {string} chain @param {string} model */
    const ran = (chain, model) => toast(`${app}'s ask runs in the background on ${modelAt(model.split(" · ")[0], model.split(" · ")[1] || "", (id) => cb.look.modelName(id))}`, "", { action: { label: "Open", title: "Its chat", onClick: () => cb.openChat(chain) } });
    if (on.asks === "run" && on.model && !on.problem) {
      asking = "run";
      void run(on.model, on.effort).then((got) => {
        // A moment more before the next: the click that asked is still the page's for a few seconds.
        setTimeout(() => { if (asking === "run") asking = ""; }, ASK_AGAIN_MS);
        if (got.ok) ran(got.chain, got.on);
        else toast(`${app}'s ask did not run: ${got.error}`, "err");
      });
      return;
    }
    asking = "sheet";
    askSheet({
      app,
      words,
      space: spaceName(),
      runsOn: on,
      run,
      ran,
      openChat: chat,
      keep: async (patch) => !!(await write("PATCH", "/settings", patch)),
      closed: () => { if (asking === "sheet") asking = ""; },
      ...(cb.catalogue ? { catalogue: cb.catalogue } : {}),
    });
  }
  /** An app's ask under way here: its run starting (`run`), or its sheet open (`sheet`); "" none. */
  let asking = /** @type {"" | "run" | "sheet"} */ ("");
  /** Whether a page asking again while one stands was said: once each time. */
  let toldAgain = false;

  /**
   * A card a dashboard put on the board, pressed (S4c): its dashboard's buttons that fit its row — each Filament's sheet,
   * as in its tab; a stale card has none, and Read again in their place, or Keep… where its source waits for your Keep,
   * which alone reads it again —, Pick up… (the Start on a new lane, the card's words in its box: nothing runs until you
   * send), and its dashboard's tab. The card is the service's: moving it is the service's too.
   * @param {import("../lib/space-view.js").FedTask} f @param {HTMLElement} anchor
   */
  function fedMenu(f, anchor) {
    if (!project) return;
    const p = project;
    const words = `${f.task}${f.line ? `\n\n${f.line}` : ""}\n\n(From ${f.title}, a dashboard of this Space.)`;
    const again = f.held
      ? [{ label: "Keep…", icon: "shieldCheck", desc: `A script ${f.source} runs waits for your Keep: its buttons wait for rows read after it`, onClick: () => dashboards.keep(f.dashboard) }]
      : f.stale && f.source
        ? [{ label: "Read again", icon: "refreshCw", desc: `${f.title}'s last read of ${f.source} failed: its buttons wait for rows read now`, onClick: () => void write("POST", `/dashboards/${encodeURIComponent(f.dashboard)}/read`, { source: f.source }) }]
        : [];
    menu([
      ...again,
      ...f.presses.map((b) => ({ label: b.label, icon: "play", desc: `${f.title}'s button, on this row: you see what it sends before it runs`, onClick: () => void dashboards.press(f.dashboard, b.name, f.key) })),
      ...(again.length || f.presses.length ? [{ type: "separator" }] : []),
      ...(cb.startWith ? [{ label: "Pick up…", icon: "gitFork", desc: "The Start on a new lane, its words in the box: nothing runs until you send", onClick: () => cb.startWith?.(p.cwd, words, true) }] : []),
      // Reproduce… (S7-D1): the Builder on a new lane repro/…, a failing test and no fix.
      ...(cb.reproduce && !noGit() ? [{ label: "Reproduce…", icon: "bug", desc: REPRO_TIP, onClick: () => cb.reproduce?.(p.cwd, { title: f.task, text: f.line, from: `${f.title}, a dashboard of ${p.name}'s Space` }) }] : []),
      { label: `Open ${f.title}`, icon: "layoutDashboard", desc: "Its page in this Space", onClick: () => go(f.dashboard) },
    ], { anchor, side: "bottom", align: "start", width: 300 });
  }

  /**
   * Pull from… (the Space Apps plan of 10-29, decision 7): its sheet, for a new pull or the one given to change. Its
   * answer is the Space as it stands, drawn.
   * @param {import("../lib/space-view.js").PullShown | null} pull
   */
  function openPull(pull) {
    if (!project) return;
    const p = project;
    pullSheet({
      place: space?.own?.name || p.name,
      pull,
      get: (path) => api(`${base()}${path}`),
      post: (path, body) => api(`${base()}${path}`, { method: "POST", body }),
      servers: async () => {
        const got = await api(`/mcp-servers?scope=${encodeURIComponent(`project:${p.id}`)}`);
        return (got?.servers || []).filter((/** @type {any} */ s) => s && s.on !== false && !s.orphan).map((/** @type {any} */ s) => String(s.name));
      },
      onSaved: (got) => {
        const made = madeBy(got);
        if (made) toast(made);
        if (got?.space) {
          space = got.space;
          spaceError = "";
          paintSpace();
        }
      },
      ...(pull ? { onRemove: async () => !!(await write("DELETE", `/pulls/${encodeURIComponent(pull.id)}`)) } : {}),
      onConnectors: () => openConnections(),
    });
  }

  /**
   * Each pull's chip in the Tasks head: its service and its cards, its read failing in orange; a press, its menu. In
   * place, each kept by its pull: the chips are drawn at every move of the Space (the owner's of 11-01: buttons
   * blinking under a resting pointer, clicks lost).
   */
  function paintPullChips() {
    const counts = space?.pulled?.counts || [];
    morphChildren(pullChipsEl, counts.map((c) =>
      h("button", { class: `ghost sm sp-pull-chip${c.error ? " is-bad" : ""}`, type: "button", "data-pull": c.pull, "data-key": `pull:${c.pull}`, title: c.error ? `Its last read failed: ${c.error}` : `${c.count} on the board${c.more ? `, ${c.more} more open` : ""}: read again, change it, take it off`, onclick: (/** @type {Event} */ e) => pullMenu(c.pull, /** @type {HTMLElement} */ (e.currentTarget)) },
        h("span", { class: "sp-btn-ic", html: ICONS.download }), pullChipWords(c))));
  }

  /** A pull's menu, from its chip: Read again, its moves going back without asking, Change…, Take it off. @param {string} id @param {HTMLElement} anchor */
  function pullMenu(id, anchor) {
    const pull = (space?.pulls || []).find((x) => x.id === id);
    if (!pull) return;
    const path = `/pulls/${encodeURIComponent(id)}`;
    menu([
      { label: "Read again", icon: "refreshCw", desc: `Asks ${pull.title} through ${pull.connection} › ${pull.tool} now`, onClick: async () => {
        const got = await write("POST", `${path}/read`);
        if (got && got.ok === false) toast(got.error, "err");
      } },
      ...(pull.back
        ? [{ label: pull.always ? "Ask before a move goes back" : "Moves go back without asking", icon: pull.always ? "hand" : "zap", desc: pull.always ? `A card you move asks again whether it moves in ${pull.title} too` : `A card you move moves in ${pull.title} too, as you move it`, onClick: () => void write("POST", `${path}/always`, { on: !pull.always }) }]
        : []),
      { label: "Change this pull…", icon: "pencil", desc: "What it reads, its column map, how a move goes back", onClick: () => openPull(pull) },
      { type: "separator" },
      { label: "Take it off the board", icon: "trash2", desc: `Its cards go from the board; nothing changes in ${pull.title}`, onClick: () => void write("DELETE", path) },
    ], { anchor, side: "bottom", align: "end", width: 300 });
  }

  /**
   * An issue a pull put on the board, pressed: Open it in its service, Move to… each other column — asked first whether
   * it moves in the service too —, Start a chat on this… on a lane named after its key, Reproduce…, and Read again where
   * its pull's last read failed.
   * @param {import("../lib/space-view.js").PulledTask} f @param {HTMLElement} anchor
   */
  function pulledMenu(f, anchor) {
    if (!project) return;
    const p = project;
    const words = `${f.keyWords} ${f.task}${f.line ? `\n\n${f.line}` : ""}${f.url ? `\n\n${f.url}` : ""}\n\n(${f.keyWords} of ${f.title}, pulled onto this Space's board.)`;
    const top = [
      ...(f.stale ? [{ label: "Read again", icon: "refreshCw", desc: `${f.title}'s last read failed: this card is as it was read`, onClick: () => void write("POST", `/pulls/${encodeURIComponent(f.pull)}/read`) }] : []),
      ...(f.url ? [{ label: `Open ${f.keyWords} in ${f.title}`, icon: "externalLink", desc: f.url, onClick: () => void window.open(f.url, "_blank", "noopener,noreferrer") }] : []),
    ];
    const starts = [
      ...(cb.startWith ? [{ label: "Start a chat on this…", icon: "messageCirclePlus", desc: `The Start on a new lane ${f.lane}, its words in the box: nothing runs until you send`, onClick: () => cb.startWith?.(p.cwd, words, f.lane) }] : []),
      ...(cb.reproduce && !noGit() ? [{ label: "Reproduce…", icon: "bug", desc: REPRO_TIP, onClick: () => cb.reproduce?.(p.cwd, { title: `${f.keyWords} ${f.task}`, text: [f.line, f.url].filter(Boolean).join("\n"), from: `${f.title}, pulled onto ${p.name}'s board` }) }] : []),
    ];
    menu([
      ...top,
      ...(top.length ? [{ type: "separator" }] : []),
      ...BOARD_COLUMNS.filter((c) => c.key !== f.column).map((c) => ({ label: `Move to ${c.key === "done" ? "Done" : c.head}`, icon: "arrowRight", desc: `${f.title} says ${f.state || "no state"}`, onClick: () => void moveCard(f, /** @type {import("../lib/space-view.js").SpaceTask["column"]} */ (c.key)) })),
      ...(starts.length ? [{ type: "separator" }, ...starts] : []),
    ], { anchor, side: "bottom", align: "start", width: 300 });
  }

  /**
   * A pulled card moved (decision 7): asked once whether it moves in its service too — "Move LIN-42 to In Progress in
   * Linear too?", with Always for this board —, or straight back where the person said always; on the board only where
   * no state of its service goes there, said.
   * @param {import("../lib/space-view.js").PulledTask} f @param {import("../lib/space-view.js").SpaceTask["column"]} column
   */
  async function moveCard(f, column) {
    const pull = (space?.pulls || []).find((x) => x.id === f.pull) || null;
    const ask = moveAsk(f, pull, column);
    const path = `/pulls/${encodeURIComponent(f.pull)}/move`;
    if (!ask.back) {
      if (pull?.back || !pull) toast(ask.why);
      return void write("POST", path, { key: f.key, column });
    }
    const said = pull?.always ? { back: true, always: undefined } : await askMove(f, ask);
    if (!said) return;
    const got = await write("POST", path, { key: f.key, column, back: said.back, ...(said.always ? { always: true } : {}) });
    if (got && got.ok === false) toast(got.error, "err");
  }

  /**
   * The move's ask: Move in its service too, or Only on this board; Always for this board with the first. Null where
   * the person closed it.
   * @param {import("../lib/space-view.js").PulledTask} f @param {{ ask: string, state: string }} ask
   * @returns {Promise<{ back: boolean, always: boolean | undefined } | null>}
   */
  function askMove(f, ask) {
    return new Promise((resolve) => {
      let done = false;
      const box = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", class: "sp-move-always" }));
      /** @param {{ back: boolean, always: boolean | undefined } | null} v */
      const end = (v) => {
        done = true;
        d.close(true);
        resolve(v);
      };
      const d = dialog({
        title: ask.ask,
        description: `${f.title} says ${f.state || "no state"} now. Moved on this board only, the card stands there until ${f.title} says another state.`,
        body: h("label", { class: "sp-move-always-row" }, box, "Always for this board"),
        actions: [
          { label: "Only on this board", variant: "outline", onClick: () => end({ back: false, always: undefined }) },
          { label: `Move in ${f.title} too`, onClick: () => end({ back: true, always: box.checked || undefined }) },
        ],
        onClose: () => { if (!done) resolve(null); },
      });
    });
  }

  /** @param {LaneChat} c */
  const chatButton = (c) => h("button", { class: "sp-lane-other", type: "button", title: `${c.name} · ${c.state}`, onclick: (/** @type {Event} */ e) => { e.stopPropagation(); cb.openChat(c.id); } }, c.name);

  /** @param {Lane} l */
  function laneEl(l) {
    const lead = l.lead;
    const ref = laneRef(l);
    // The card the board shows on top, its moves not yet answered drawn over the Space's tasks.
    const task = space ? laneTask(board.shown(space.tasks), ref) : null;
    const news = space ? laneNews(space.log, ref) : null;
    const face = h("button", {
      class: "sp-lane-face",
      type: "button",
      ...(lead ? { title: `Open ${lead.name}` } : { title: "No chat works here yet", disabled: "" }),
      onclick: () => { if (lead) cb.openChat(lead.id); },
    },
    // The head's parts keyed by what they are: a model said, or a spinner gone, never draws one part over another.
    h("div", { class: "sp-lane-head" },
      h("span", { class: `sp-branch${l.main ? " is-main" : ""}`, "data-key": "branch" }, h("span", { class: "sp-branch-ic", html: icon(l.main ? "gitBranch" : "gitFork") }), l.branch || l.name),
      h("span", { class: "sp-lane-name", "data-key": "name" }, lead ? lead.name : l.name),
      ...(lead?.model ? [h("span", { class: "sp-lane-who", "data-key": "who" }, lead.model)] : []),
      ...(lead ? [h("span", { class: `sp-lane-state is-${lead.tone || "idle"}`, "data-key": "state", title: lead.state },
        ...(lead.tone === "works" ? [h("span", { class: "sp-spin", "data-key": "spin", html: ICONS.loader })] : []), h("span", { class: "sp-state-words", "data-key": "words" }, lead.state))] : [])),
    h("div", { class: "sp-lane-facts" },
      ...(task ? [h("span", { class: "sp-has" }, "Has: ", h("b", {}, task.title), task.line ? ` — ${task.line}` : ""), " · "] : []),
      l.facts),
    ...(news
      ? [h("div", { class: "sp-lane-line is-news", title: news.text }, h("span", { class: "sp-pen", html: ICONS.pencil }), `${whenWords(news.at, Date.now())} “${news.text}”`)]
      : lead?.line ? [h("div", { class: "sp-lane-line" }, lead.line)] : lead ? [] : [h("div", { class: "sp-lane-line is-none" }, "No chat works here yet")]));
    const fed = laneFed(space?.feeds?.lanes || [], l.branch);
    return h("article", { class: `sp-lane${l.tone ? ` is-${l.tone}` : ""}`, role: "listitem", "data-place": l.path, "data-key": `lane:${l.path}` },
      face,
      ...(fed.shown.length
        ? [h("div", { class: "sp-fed-lines" }, ...fed.shown.map((x) => fedLine(l, x)), ...(fed.more ? [h("span", { class: "sp-quiet sp-fed-more" }, `and ${fed.more} more`)] : []))]
        : []),
      ...(l.others.length ? [h("div", { class: "sp-lane-more" }, h("span", { class: "sp-quiet" }, `Also here (${l.others.length}):`), ...l.others.slice(0, 3).map(chatButton), ...(l.others.length > 3 ? [h("span", { class: "sp-quiet" }, `and ${l.others.length - 3} more`)] : []))] : []));
  }

  /**
   * A kept dashboard's line on a lane (S4c): its words, red or green as its row says, its dashboard — a press opens its
   * tab —, and on a red one Fix it…: the Start in the lane's folder, the line in its box. Its last read failed, or its
   * source waits for your Keep: what it read before, said as such.
   * @param {Lane} l @param {import("../lib/space-view.js").FedLine} x
   */
  const fedLine = (l, x) => h("div", {
    class: `sp-fed${x.tone ? ` is-${x.tone}` : ""}${x.stale ? " is-stale" : ""}`,
    title: x.held
      ? `${x.title} waits for your Keep: what it read ${lookWords(x.at, Date.now())}`
      : x.stale ? `Its last read failed: what ${x.title} read ${lookWords(x.at, Date.now())}` : `${x.title}, read ${ageWords(x.at, Date.now())}`,
  },
  h("span", { class: "sp-fed-dot" }),
  h("span", { class: "sp-fed-w" }, x.words),
  h("button", { class: "sp-fed-src", type: "button", title: `Open ${x.title}`, onclick: () => go(x.dashboard) },
    h("span", { class: "sp-fed-src-ic", html: ICONS.layoutDashboard }), x.title),
  ...(x.tone === "bad" && cb.startWith
    ? [h("button", { class: "sp-fed-fix", type: "button", title: "The Start in this lane's folder, the line in its box: nothing runs until you send",
        onclick: () => cb.startWith?.(l.path, `${x.words}\n\n(${x.title}, a dashboard of this Space, says this of ${l.branch || l.name}.) Find why, and fix it.`) }, "Fix it…")]
    : []));

  /** The newest sync that reached two lanes, between them: a diamond and its time. @param {Lane} a @param {Lane} b */
  const syncPoint = (a, b) => {
    const s = space ? syncBetween(space.syncs, laneRef(a), laneRef(b)) : null;
    return s ? [h("div", { class: "sp-syncpt", "data-key": `sync:${a.path}|${b.path}`, title: `The last time both were told, at ${new Date(s.at).toLocaleString()}` }, h("span", { class: "sp-dia" }), h("span", { class: "sp-syncpt-at" }, whenWords(s.at, Date.now())), h("span", { class: "sp-syncpt-ln" }))] : [];
  };

  /**
   * The lanes' words with what the Space adds to them, for drawing again only when one moved: its `seq`, and the minute
   * while a lane says when its news or a sync came.
   * @param {Lane[]} ls
   */
  const lanesKey = (ls) =>
    JSON.stringify([
      ls.map((l) => [l.path, l.branch, l.facts, l.tone, l.lead && [l.lead.id, l.lead.name, l.lead.state, l.lead.model, l.lead.line], l.others.map((o) => [o.id, o.name])]),
      space ? [space.seq, space.log.length || space.syncs.length ? Math.floor(Date.now() / 60_000) : 0] : null,
      (space?.feeds?.lanes || []).map((x) => [x.dashboard, x.branch, x.words, x.tone, x.stale, !!x.held]),
    ]);

  /** The board, the logbook and the Sync card drawn from the Space as it stands. */
  function paintSpace() {
    paint(true);
    paintNone();
    // A read that failed is said where the board stands: with no board yet, why; over a board read before, that the
    // board drawn is that earlier read.
    boardNote.hidden = !spaceError;
    boardNote.replaceChildren(!spaceError ? "" : space ? `The board's last read failed: ${spaceError}. It shows what was read before.` : `The board could not be read: ${spaceError}`);
    // A project with no Space is drawn from an empty one (by need, 11-12): with the drafts its chats published, each
    // with its Keep…, where the first thing added makes it; with nothing while its deleted Space waits, so no part
    // stands as the Space that went had it — an app's page open then gives way to the Board's place, where the card is
    // (found 11-12: with the parts not drawn again, the app's page stood hidden over a hidden Board, a blank page).
    const s = space || (none ? noSpaceYet(at.id, none.deletedAt ? [] : none.dashboards) : null);
    if (!s) return;
    // What its agents run on (the owner's of 11-04): the chats it starts start on it, and its head says it.
    cb.runsOn?.(s.runsOn || null);
    paintRunsOn();
    paintActs();
    const runs = s.runs || null;
    routines.paint(runs);
    watchers.paint(runs);
    byItself.paint(runs, s.dashboards || []);
    dashboards.paint(s.dashboards || [], {
      routines: { shown: routinesShown(runs), failed: routinesFailed(runs) },
      watchers: { shown: watchersShown(runs), failed: watchersFailed(runs) },
    });
    paintCrumb();
    // A Space of your own (A6): its glyph, and its settings — its own, no project's (⋯ names them so, openSettings).
    const own = s.own || null;
    setHtml(crumbIc, own ? ICONS.layoutGrid : ICONS.folder);
    setHtml(tile, own ? ICONS.layoutGrid : ICONS.squareKanban);
    const more = own ? "Settings, connectors, plugins, skills and folders" : "Project settings, connectors, plugins, skills and folders";
    settingsBtn.title = more;
    settingsBtn.setAttribute("aria-label", more);
    paintFirst();
    paintWho();
    board.paint(s.tasks, { fed: s.feeds?.tasks || [], pulled: s.pulled?.tasks || [] });
    const fedCount = fedCountWords(s.feeds?.counts || []);
    fedCountEl.hidden = !fedCount;
    fedCountEl.replaceChildren(fedCount);
    paintPullChips();
    logbook.paint(s.log, s.logMore);
    sync.paint(s);
    paintShows();
    paintOwners();
    paintLeft();
  }

  /** The Overlap banner (SG-D5): the files two lanes both change, as git says; Compare… opens what each lane changes. */
  function paintOwners() {
    const shared = filesRead && !noGit() ? ownersOf(refs(), files).shared : [];
    const words = overlapWords(shared);
    overlapEl.hidden = !words;
    if (!words) return void overlapEl.replaceChildren();
    // In place: drawn at every move of the Space, and its Compare… made anew stood under a resting pointer (the owner's
    // of 11-01: buttons blinking under a resting pointer, clicks lost).
    morphChildren(overlapEl, [
      h("span", { class: "sp-overlap-ic", html: ICONS.shieldAlert }),
      h("b", {}, words.head), h("span", { class: "sp-overlap-line" }, ` · ${words.line}`),
      h("span", { class: "sb-sp" }),
      h("button", { class: "ghost sm sp-compare", type: "button", title: "What each lane changes and the order that merges them: read-only", onclick: () => compare() }, "Compare…"),
    ]);
  }

  /** Compare…: what each lane changes and the merge order, in a sheet. */
  function compare() {
    const owners = ownersPanel();
    owners.paint(refs(), files, filesRead, filesError);
    sheet({ label: "What each lane changes", class: "sp-compare-sheet", head: h("b", { class: "sp-sheet-title" }, "What each lane changes"), body: owners.el });
  }

  /**
   * Needs you here: the chats of this project that need you, as Now has them — what each asks, its chat and lane, how
   * long; a press opens it —, then the rows Filament keeps for its dashboards (S5a): a source that stopped, what a watch
   * found. None: one quiet line. Under them, what was done today and what was put off, each behind its Show.
   */
  function paintNeeds() {
    const rows = needsRows();
    const now = Date.now();
    const g = needGroups(space?.needs || [], now);
    const count = rows.length + g.open.length;
    needsHas = !!(count + g.done.length + g.later.length);
    paintNeedsShown();
    needsCount.replaceChildren(count ? String(count) : "");
    // None: the section is one quiet line (the mock's 3).
    needsNone.hidden = !!count;
    needsWords.hidden = !count;
    // Whose rows they are: a draft is its chats' agents' (S5c), a failed run its routines' (S6), what an agent found
    // reproducing a report its agents' too (S7), the rest its dashboards' (seen live: drafts alone were "what its
    // dashboards found", and so was a routine's failure).
    const drafts = g.open.some((n) => n.kind === "draft");
    // A routine's failed run; what a watcher that tells only the person heard is its watchers' (the plan of 11-11, w5).
    // …and a watcher's guidance held for your Send it is its watchers' as well.
    const guides = g.open.some((n) => n.kind === "routine" && !!n.routine?.guide);
    // A watcher Filament switched off is its watchers' too, and no failed run: nothing of it ran.
    const off = g.open.some((n) => n.kind === "routine" && !!n.routine?.unapproved);
    const failed = g.open.filter((n) => n.kind === "routine" && !n.routine?.told && !n.routine?.guide && !n.routine?.unapproved);
    // A failed run is its watchers' where its row says so, or this Space's list names it a watcher, as its chip goes.
    const ofWatcher = (/** @type {import("../lib/space-view.js").NeedRow} */ n) => !!n.routine?.watcher || !!(space?.runs?.routines || []).find((r) => r.id === n.routine?.id)?.trigger;
    const runs = failed.some((n) => !ofWatcher(n));
    const woken = failed.some(ofWatcher);
    const heard = g.open.some((n) => n.kind === "routine" && !!n.routine?.told);
    const repros = g.open.some((n) => n.kind === "repro");
    // A chat's ask for your press (E42 SA-D7) is its chats', as their live asks are.
    const asks = g.open.some((n) => n.kind === "ask");
    // Another machine's open rows (sp-cross) are its Space's there.
    const fed = g.open.some((n) => n.kind === "machine");
    const fedOn = [...new Set(g.open.filter((n) => n.kind === "machine").map((n) => String(/** @type {any} */ (n).machine?.name || "")).filter(Boolean))];
    const found = g.open.some((n) => n.kind !== "draft" && n.kind !== "routine" && n.kind !== "repro" && n.kind !== "ask" && n.kind !== "machine");
    const listed = (/** @type {string[]} */ a) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`);
    const owners = [asks && !rows.length ? "its chats' asks" : "", found ? "its dashboards'" : "", runs ? "its routines'" : "", woken || heard || guides || off ? "its watchers'" : "", repros ? "its reproductions" : "", drafts ? "its drafts" : "", fed ? "its other machines'" : ""].filter(Boolean);
    const whose = `,${owners.length === 1 ? " and" : ""} ${listed(owners)}`;
    const said = listed([asks ? "what its chats ask you to press" : "", found ? "what its dashboards found" : "", runs ? "its routines' failed runs" : "", woken ? "its watchers' failed runs" : "", heard ? "what its watchers heard" : "", guides ? "what its watchers would tell a chat" : "", off ? "the watchers Filament switched off" : "", repros ? "what its agents found reproducing a report" : "", drafts ? "its drafts" : "", fed ? `what is open on ${fedOn.length ? listed(fedOn) : "its other machines"}` : ""].filter(Boolean));
    needsWords.replaceChildren(!g.open.length ? `as Now has them, this ${space?.own ? "Space" : "project"}'s` : rows.length ? `its chats', as Now has them${whose}` : drafts && !found && !failed.length && !heard && !guides && !off && !asks && !fed ? "drafts its chats wrote, for you to send" : said);
    needsList.hidden = !count;
    // Drawn again only where a row or its words moved — the day too, for the foot's "done 14:02" and "until tomorrow
    // 09:00" —, and in place, each row kept by its key, so a menu open on a row keeps its button and a row's buttons
    // stand under a resting pointer as another row moves (the owner's of 11-01: buttons blinking under a resting
    // pointer, clicks lost); the minute moves the ages alone.
    const key = JSON.stringify([
      rows.map((r) => [r.c.id, r.row.fact, r.row.tone, r.lane.path, r.row.at]),
      // A draft's end too: sent or discarded say so in Done today, and only one of them has Bring back (S5c); and its
      // words, which a sheet's close keeps, so its Review… opens on them (found by the Hunter on S5c).
      [g.open, g.later, g.done].map((ns) => ns.map((n) => [n.id, n.text, n.at, n.until, n.doneAt, n.outcome, n.draft?.words, n.ask?.why, n.ask?.ended])),
      (space?.dashboards || []).map((d) => [d.name, d.title, d.paused]),
      needsShow,
      new Date(now).setHours(0, 0, 0, 0),
    ]);
    if (needsList.dataset.key === key) return void moveAges(needsList, now);
    needsList.dataset.key = key;
    keepingFocus(needsList, () => morphChildren(needsList, [
      ...rows.map(({ c, row, lane }) => h("button", { class: `sp-need is-${row.tone || "asks"}`, type: "button", role: "listitem", title: `Open ${c.name}`, "data-chain": c.id, "data-key": `chat:${c.id}`, onclick: () => cb.openChat(c.id) },
        h("span", { class: "sp-need-dot" }),
        h("span", { class: "sp-need-words" },
          h("span", { class: "sp-need-t" }, row.fact || "waits for you"),
          h("span", { class: "sp-need-f" }, h("span", { class: `sp-branch${lane.main ? " is-main" : ""}` }, laneRef(lane).chip), ` · ${c.name}`, ...(row.at ? [" · ", ageEl(row.at, now)] : []))),
        h("span", { class: "sp-need-go" }, "Open ›"))),
      ...g.open.map((n) => kept.row(n, now)),
    ]));
    if ((needsShow === "done" && !g.done.length) || (needsShow === "later" && !g.later.length)) needsShow = "";
    keepingFocus(needsFoot, () => morphChildren(needsFoot, kept.foot(needsFoot, g, now, {
      show: needsShow,
      toggle: (which) => {
        needsShow = needsShow === which ? "" : which;
        paintNeeds();
      },
    })));
  }

  /**
   * The rows Filament keeps (S5a, space/needs-rows.js): a stopped source's Fix it… fills the Start in this project's
   * folder; a dashboard's chip opens its tab; Done, Not now and Bring back answer the Space, which is drawn.
   */
  const kept = needRows({
    place: () => (project ? { ...project, dashboards: space?.dashboards || [] } : null),
    openTab: (_p, name) => go(name),
    startWith: cb.startWith ? (cwd, words) => cb.startWith?.(cwd, words) : undefined,
    handOff: cb.handOff ? (p, words) => cb.handOff?.(p.id, p.cwd, words) : undefined,
    post: (_p, path, body) => write("POST", path, body),
    // A draft's Ask for a change… (S5c): the chat that wrote it, its box filled.
    askChat: cb.askChat,
    // A routine's failed run (S6): its chat; a repro's lane (S7).
    openChat: (chain) => cb.openChat(chain),
    // Reproduce… (S7-D1), and the draft a repro names; none where the folder is no repository.
    reproduce: cb.reproduce ? (cwd, report) => cb.reproduce?.(cwd, report) : undefined,
    plain: () => noGit(),
    draftOf: (_n, id) => (space?.needs || []).find((x) => x.id === id && x.kind === "draft") || null,
    // An ask's press (E42 SA-D7): the Keep sheet, the routine's Switch on…, the Tell the chats card with its words.
    // Switch on… is the press of a watcher Filament switched off too, which its row names.
    keep: (n) => dashboards.keep(n.dashboard, n.ask?.v),
    switchOn: (n) => {
      const id = n.ask?.routine || n.routine?.id;
      if (project && id) routines.switchOn(project.id, id);
    },
    tell: (n) => sync.open({ asks: [n] }),
    // A watcher's row, by this Space's list of them: its chip opens Watchers.
    watcher: (n) => !!(space?.runs?.routines || []).find((r) => r.id === (n.routine?.id || n.ask?.routine))?.trigger,
  });

  /** The chats of this project Now says need you, the newest first, with their lanes. */
  function needsRows() {
    /** @type {{ c: LaneChat, row: import("../lib/now.js").NowRow, lane: Lane }[]} */
    const rows = [];
    for (const l of lanes)
      for (const c of [...(l.lead ? [l.lead] : []), ...l.others]) {
        const row = cb.look.now(c.id);
        if (row?.group === "needs") rows.push({ c, row, lane: l });
      }
    return rows.sort((a, b) => (b.row.at || 0) - (a.row.at || 0));
  }

  /**
   * Where you left off, once a look has both the Space and the lanes, from your last look before this one — and drawn
   * again as they move while the Space stays open: a line of What happened that lands, a chat that comes to ask you.
   * Dismiss counts from that moment: the card comes back with what moves after it. Your look is kept as the page leaves
   * the Space.
   */
  function paintLeft() {
    if (!space || !answer || !project) return;
    // The chats that ask you, in Needs you here's order: Continue opens the one it puts first.
    const asks = needsRows().filter(({ c }) => c.tone === "needs").map(({ c }) => ({ chain: c.id, name: c.name, fact: c.state }));
    const newest = lanes.filter((l) => l.lead).sort((a, b) => (b.lead?.when || 0) - (a.lead?.when || 0))[0] || null;
    const card = leftOff({
      last: leftSince,
      now: Date.now(),
      log: space.log,
      asks,
      newest: newest?.lead ? { chain: newest.lead.id, name: newest.lead.name, chip: laneRef(newest).chip, facts: newest.facts } : null,
    });
    // Its words name the minute ("today 14:02", "5 min ago"): drawn again as they, or what it shows, move.
    const key = JSON.stringify([card, card ? Math.floor(Date.now() / 60_000) : 0]);
    if (key === leftKey) return;
    leftKey = key;
    left.paint(card);
  }

  /**
   * The lanes drawn again where their words moved, or always with `force`. A project the list names only now (the
   * page opened at its address before the list came) has its places and its Space read as it is first known.
   * @param {boolean} [force]
   */
  /**
   * The head's line, one line that never wraps: a project's folder and its lanes, the whole of it its tip where it is
   * cut — who works in its Space is its name's tip —; a Space of your own's, who works in it and its folder by its
   * name, the whole path on hover (the Designer's redesign of 10-29).
   */
  function paintLine() {
    if (!project) return;
    const plain = noGit();
    const n = answer?.ok && !plain ? ` · ${lanes.length} lane${lanes.length === 1 ? "" : "s"}` : "";
    const folder = project.cwd.split(/[\\/]/).filter(Boolean).pop() || project.cwd;
    const line = space?.own ? `Chats you start here work in this Space · its files in “${folder}”${n}` : `${project.cwd}${n}`;
    lineEl.replaceChildren(line);
    lineEl.setAttribute("title", space?.own ? project.cwd : line);
    if (space && !space.own) titleEl.setAttribute("title", `Every chat in ${project.name} works in this Space`);
    else titleEl.removeAttribute("title");
  }
  function paint(force = false) {
    if (!project) {
      project = cb.project(at.id);
      if (project) {
        leftSince = lastLook(project.id);
        // Reading until its Space is read, as a page opened on a known project is.
        root.classList.add("sp-is-reading");
        read({ footprint: true });
        void readSpace();
      }
    }
    // A project the list does not name has no act of its head's that does anything (space.css hides them): the page of
    // one just archived drew Add to this Space… and New chat here…, dead (seen in the page, 11-12).
    root.classList.toggle("sp-is-unknown", !project);
    if (!project) {
      // Nothing is read for a project the list does not name: the reading page's class would hide its line, which says
      // why (space.css hides .sp-line while it reads).
      root.classList.remove("sp-is-reading");
      crumbName.replaceChildren("Project");
      titleEl.replaceChildren("This project is not known");
      lineEl.replaceChildren("It may have been archived or deleted, or the list of projects has not been read yet. An archived project is brought back in Settings › Archived chats.");
      lanesEl.replaceChildren();
      needsSec.hidden = true;
      showsSec.hidden = true;
      lanesSec.hidden = true;
      work.hidden = true;
      paintPair();
      return;
    }
    // A Space of your own with no repository has no lanes, overlaps or places (A3): ⋯ offers no Folders and worktrees….
    const plain = noGit();
    paintNeedsShown();
    lanesSec.hidden = plain;
    paintNewLane();
    paintPair();
    work.hidden = false;
    crumbName.replaceChildren(project.name);
    // A Space of your own's page is its Board, as its row in the left bar says (the Designer's walk of 10-29).
    crumbPage.replaceChildren(space?.own ? "Board" : "Space");
    // The chip in place: the title is drawn at every tick (the owner's of 11-01: buttons blinking under a resting
    // pointer, clicks lost).
    morphChildren(titleEl, [project.name, ...inSpaceChip()]);
    paintLine();
    placesWordsEl.replaceChildren(answer?.ok ? `${placesWords(answer)} · Remove where nothing is lost, Put back what was removed` : answer ? "git could not read this folder" : "reading…");
    paintNeeds();
    if (!answer) {
      lanesEl.replaceChildren(h("p", { class: "sp-quiet sp-reading" }, "Reading where its chats work…"));
      lanesWordsEl.replaceChildren("reading…");
      return;
    }
    const next = lanesOf(answer, cb.look);
    const key = lanesKey(next);
    // The lanes stand; who asks you, or the minute, may have moved.
    if (!force && key === drawnKey) return void paintLeft();
    drawnKey = key;
    lanes = next;
    paintLine();
    lanesCount.replaceChildren(String(lanes.length));
    lanesWordsEl.replaceChildren(lanesWords(lanes));
    paintNeeds();
    paintFirst();
    paintWho();
    paintLeft();
    paintLanes();
    // The board's and the logbook's chips name the lanes: they follow them.
    board.tick();
    logbook.tick();
    sync.tick();
  }

  /**
   * The lanes drawn in place, each kept by its folder: the lanes are drawn at every move of the Space, of the places and
   * of the board, and a lane's face made anew stood under a resting pointer (the owner's of 11-01: buttons blinking under
   * a resting pointer, clicks lost).
   */
  function paintLanes() {
    keepingFocus(lanesEl, () => morphChildren(lanesEl, lanes.flatMap((l, i) => [...(i ? syncPoint(lanes[i - 1], l) : []), laneEl(l)])));
  }

  // ↑ ↓ ← → move between the lanes; Enter opens one, as a button does. New lane… is a button of the section's head, in
  // the page's Tab order before the cards, and no stop of this walk.
  lanesEl.addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => {
    const by = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
    if (!by) return;
    const faces = /** @type {HTMLElement[]} */ ([...lanesEl.querySelectorAll(".sp-lane-face:not([disabled])")]);
    const i = faces.indexOf(/** @type {any} */ (document.activeElement));
    if (i < 0) return;
    e.preventDefault();
    faces[Math.max(0, Math.min(faces.length - 1, i + by))]?.focus();
  });

  // The Space moved — a chat's tool, a sync's lane, another tab's write: read again, a burst once.
  const offBus = onBus((m) => {
    // "*": Pause all, every Space's (S6-D12).
    // A project this Space shows (A7) moved too: its rows and tiles are drawn here.
    if (m?.type === "space" && (m.project === at.id || m.project === "*" || space?.shows?.some((s) => s.id === m.project)) && project) {
      readSoon();
      // An open Connectors sheet reads again too: what its dashboards use, its rows (found by the Hunter on S4b).
      if (connections?.el.isConnected) void connections.refresh();
      else connections = null;
    }
    // A version published or an artifact deleted: a dashboard a chat of the project made shows, or goes.
    else if (m?.type === "artifact" && project && (m.v || m.change === "deleted")) readSoon();
    // Its places read again behind the answer it was given, and moved (the slowness of 11-02): asked again, at once.
    else if (project && places.moved(m)) read();
  });
  paint(true);
  /** Who asks you on the board's tasks, and the minute: the board draws again as either moves. */
  let boardKey = "";
  /** Your look at this Space, kept as the page leaves it: the next look's Where you left off starts from here. */
  const keep = () => { if (project) keepLook(project.id, Date.now()); };
  globalThis.addEventListener?.("pagehide", keep);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(tick);
    offBus();
    if (readTimer) clearTimeout(readTimer);
    globalThis.removeEventListener?.("pagehide", keep);
    if (openPlacesNow === placesHere) openPlacesNow = null;
    if (onScreen?.root === root) onScreen = null;
    // Its places' sheet goes with the page: its rows are this page's.
    placesSheet?.close();
    keep();
  };
  /** Folders and worktrees… from the project's menu, this page on screen: its places' sheet open. @param {string} id */
  const placesHere = (id) => {
    if (id !== at.id || stopped || !root.isConnected) return false;
    openPlaces();
    return true;
  };
  openPlacesNow = placesHere;
  if (placesNext === at.id) {
    placesNext = "";
    openPlaces();
  }
  // The lanes follow the chats as the left bar learns of them; the places are read again now and then while in view.
  const tick = setInterval(() => {
    if (root.isConnected === false) return void stop();
    paint();
    if (space) paintShows();
    dashboards.tick();
    const key = JSON.stringify([space?.tasks.filter((t) => t.chain && cb.look.now(t.chain)?.group === "needs").map((t) => t.id) || [], Math.floor(Date.now() / 60_000)]);
    if (key !== boardKey) {
      boardKey = key;
      board.tick();
      logbook.tick();
    }
    if (project && document.visibilityState !== "hidden" && Date.now() - readAt > PLACES_EVERY_MS) read();
  }, TICK_MS);
  open = stop;
  /** The page its address names shown: the Board, Routines or a dashboard's. @param {string} tab */
  const show = (tab) => dashboards.show(tab);
  const page = { root, paint, stop, show };
  onScreen = { id: at.id, root, page };
  return page;
}
