// @ts-check
// The empty / draft state: the greeting,
// the time-of-day greeting fitted between 20 and 30px and re-evaluated at the next hour boundary, the project
// chooser row ("Start a new chat in" + the workspace menu: recent folders, Open folder…, Work outside a project; then
// the folder's path and branch, quiet), and the Start (start-board.js; proposal_ux §4.13), a folder chosen or none:
// its three questions, where the chat works among them (works-in.js, HarnessV4_Git_Plan step 5), its tiles and the
// first request, asked of the server (`POST /sessions/draft-start`) whenever the held choice, the model or the draft
// moves. Starts from is your settings, with what the board changes over them; the cards hold what matters before the
// first message, and the long tail is set after it (HarnessV3-AtHome AH-D3: no settings dialog). Every change is held on the chat until the first send (D15, NT-D7).
import { h, setHtml } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { menu, dialog } from "../lib/ui.js";
import { api } from "../lib/api.js";
import { browseFolder, pathExample } from "../lib/folder-browse.js";
import { greetingAt, msUntilNextGreetingBoundary, workedToday } from "../lib/labels.js";
import { state, recentFolders, rememberFolder, forgetFolder } from "../state.js";
import { createStartBoard } from "./start-board.js";
import { createWorksIn } from "./works-in.js";
import { whose } from "../lib/words.js";
import { AUTO, HERE, autoPick, chipWords } from "../lib/run-on.js";

const leafOf = (p) => (p || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
/** A folder as the project id compares it: forward slashes, no trailing one, lower case. @param {unknown} p */
const keyOf = (p) => String(p ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * The project each folder stands in, as the server last said it (`POST /memory/projects/of`): a worktree's folder stands
 * in its main folder's project (HarnessV4_Git_Plan GW-D46), as the left bar groups its chats; null where it could not
 * say. Folder key → answer.
 * @type {Map<string, { id: string, cwd: string, name: string } | null>}
 */
const standing = new Map();
/** The folders one ask names at most: the server reads 64. */
const OF_PER_ASK = 64;

/**
 * The folder of the project a folder stands in, where that is another folder — a worktree's main folder, as the left
 * bar groups its chats (GW-D46) —, as the page knows it: the list's project for a chat in that folder, else the
 * server's last word (`standing`). Null where it is the folder itself or none; undefined where neither has said. A new
 * chat with no folder named opens there (app.js `newChat`).
 * @param {string} folder
 * @returns {string | null | undefined}
 */
export function projectFolderOf(folder) {
  const k = keyOf(folder);
  if (!k) return null;
  const listed = (state.sessions || []).find((/** @type {any} */ s) => keyOf(s.cwd) === k && s.project && s.project !== "none")?.project;
  const filed = listed ? null : [...state.chats.values()].find((/** @type {any} */ c) => keyOf(c.cwd) === k && c.projectId)?.projectId;
  const id = listed || filed;
  const p = id ? (state.projects || []).find((/** @type {any} */ x) => String(x?.id) === String(id)) : null;
  const server = standing.get(k);
  if (!p?.cwd && server === undefined) return undefined;
  const cwd = String(p?.cwd || server?.cwd || "");
  return cwd && keyOf(cwd) !== k ? cwd : null;
}

/**
 * Where each folder stands, asked of the server and kept in `standing`; a failed ask keeps nothing for its folders, so
 * the next ask asks again. Never throws.
 * @param {string[]} paths
 */
export async function readStanding(paths) {
  const asked = [...new Set(paths.filter(Boolean))];
  for (let i = 0; i < asked.length; i += OF_PER_ASK) {
    const part = asked.slice(i, i + OF_PER_ASK);
    /** @type {unknown} */
    let said = null;
    try {
      said = (await api("/memory/projects/of", { method: "POST", body: { paths: part } }))?.projects;
    } catch {}
    if (!Array.isArray(said)) continue;
    const answers = said;
    part.forEach((p, j) => standing.set(keyOf(p), answers[j] || null));
  }
}

/**
 * The menu's rows, one per project: a folder the server says stands in a project — a worktree's, in its main folder's
 * (GW-D46) — is that project's row, named as the bar names it; one it could not say stays as it is. In the folders'
 * order, each project once.
 * @param {{ cwd: string, name: string }[]} folders  `knownFolders`
 * @param {(cwd: string) => { id: string, cwd: string } | null | undefined} standsIn
 * @param {readonly { id?: string, name?: string }[]} projects  the archive's projects the bar lists
 * @returns {{ cwd: string, name: string }[]}
 */
export function projectRows(folders, standsIn, projects) {
  /** @type {{ cwd: string, name: string }[]} */
  const out = [];
  const seen = new Set();
  for (const f of folders) {
    const p = standsIn(f.cwd);
    // A folder that is its own project stays as the menu has it: the server spells a drive's root without its slash
    // ("C:"), which names the folder the server stands in on that drive, not the root.
    const cwd = p && keyOf(p.cwd) !== keyOf(f.cwd) ? p.cwd : f.cwd;
    const k = keyOf(cwd);
    if (seen.has(k)) continue;
    seen.add(k);
    const listed = p ? projects.find((x) => x?.id === p.id) : null;
    out.push({ cwd, name: listed?.name || (keyOf(f.cwd) === k ? f.name : "") });
  }
  return out;
}

/**
 * The folders the menu offers: the archive's named projects first, then this browser's recent folders, then the
 * folders sessions ran in — deduped case-insensitively. The chooser revalidates against the disk every time it
 * opens, so a deleted project's ghost never survives one menu, and folds each folder into its project (`projectRows`).
 * @returns {{ cwd: string, name: string }[]}
 */
export function knownFolders() {
  /** @type {{ cwd: string, name: string }[]} */
  const out = [];
  const seen = new Set();
  const push = (cwd, name = "") => {
    const f = String(cwd || "").trim();
    const key = f.toLowerCase();
    if (!f || seen.has(key)) return;
    seen.add(key);
    out.push({ cwd: f, name: String(name || "").trim() });
  };
  for (const p of state.projects || []) push(p.cwd, p.name);
  for (const f of recentFolders()) push(f);
  for (const s of state.sessions || []) push(s.cwd);
  return out;
}

/**
 * What the Start board needs of the page (app.js): the create body the first send would carry (`sessionStartBody`,
 * so the board weighs exactly what will be created — NT-D6), `outside: true` on it where no folder is chosen (the send
 * works in Everything), the composer's draft and permission chip, and the models.
 * `agents`: your saved agents and the tags ticked "The main agent may ask it" (HarnessV4_Tasks E15 step 3), with what
 * a card that started by itself cost today; `manageAgents`: Settings › Agents (step 7); `manageMcp`: Settings › MCP
 * servers (HarnessV4_Settings_Plan HC-26); `manageSkills`: Library › Skills; `agentName`: the coding agent the start's
 * model runs on, by its name ("Claude Code"), for the board's greyed parts (D8); `modelWords`: the start's model as the
 * composer's chip names it.
 * @typedef {{ body: () => any | null, text: () => string, permission: () => string, setPermission: (id: string) => void,
 *   models: () => any[], families?: () => any[], teams?: () => any[], teamsOn?: () => boolean, mainModel: () => string, modelWords?: () => string, agentName?: () => string, poolFacts?: import("../widgets/pool.js").PoolChipIO["facts"],
 *   agents?: () => { cards: readonly import("../lib/agent-cards.js").AgentCard[], asks: readonly string[],
 *     find?: (tag: string) => import("../lib/agent-cards.js").AgentCard | null },
 *   manageAgents?: () => void, manageMcp?: () => void, manageSkills?: () => void, teamNames?: (keys: unknown) => string[],
 *   kept?: () => boolean, clearKept?: () => void, viewOnly?: () => boolean }} StartHooks
 *   `kept`: the box holds words typed in this folder before and not sent, as they were put back; `clearKept`: the box
 *   emptied, and what was kept with it; `viewOnly`: the page is a view-only device's (the owner's remote Filament of
 *   11-06, p4-view-ui), which starts no chat — the chooser and the Start give way to words that say so, and nothing is
 *   asked of the server
 */

/**
 * Another machine the desktop app keeps, as the new chat's menu shows it: its projects as that machine lists them, or
 * null with why they could not be read (`words`); not read yet, none said (`projects` left out).
 * @typedef {{ id: string, name: string, projects?: { cwd: string, name: string }[] | null, words?: string | null }} OtherMachine
 */

/** What a new chat's page says on a view-only device's page, in place of the chooser and the Start. */
export const VIEW_ONLY_START_WORDS = "This device is view-only: it reads this Filament's chats and starts none. Open a chat from the list to read it.";

/**
 * Run on (the remote desk's s2c), as the Start asks it of the page: whether it stands (the desktop app's desk, a folder
 * chosen), the draft's choice (`get`, `set`: This computer "", a machine's id, or Auto), the machines as this computer
 * reads them for the folder (`places`, kept a moment; `tried`: a read of them ended, answered or not), the chats at
 * work on each (`running`) and the chat's model, which Auto weighs, the machine Auto's chip names as it paints (`saw`,
 * "" none), and Settings › Remote access, where a machine's Run on is switched on.
 * @typedef {{ on: () => boolean, get: () => string, set: (choice: string, name: string) => void, places: (folder: string, fresh?: boolean) => Promise<import("../lib/run-on.js").Places | null>,
 *   known: (folder: string) => import("../lib/run-on.js").Places | null, tried: (folder: string) => boolean, running: () => ReadonlyMap<string, number>, model: () => string,
 *   saw?: (id: string) => void, settings: () => void }} RunOnHooks
 */

/**
 * @param {{ getFolder: () => string, setFolder: (p: string) => void, onToast?: (msg: string, kind?: string) => void,
 *   chatOf?: () => any, onHeld?: (c: { patch: Record<string, any> }) => void, start?: StartHooks,
 *   spaceOf?: (cwd: string) => { name: string, own: boolean } | null,
 *   otherMachines?: () => Promise<{ machines: OtherMachine[] } | null>, machineNames?: () => Promise<{ machines: OtherMachine[] } | null>,
 *   openOn?: (machine: string, cwd: string) => void, runOn?: RunOnHooks, alsoOn?: (cwd: string) => string[] }} cb
 *   `spaceOf`: the Space a chat in a folder works in (the left bar's `spaceFor`); `otherMachines`: the machines the
 *   desktop app keeps beside this computer, each with its projects as it lists them, read by the app with its sign-in
 *   there (null where no app answers: a browser's page, another machine's); `machineNames`: the same machines by name
 *   alone, nothing asked of them, at once; `openOn`: a new chat on one of them, in a folder of its own, opened in its
 *   page (pk-list, the owner's of 11-10); `runOn`: where the new chat runs (`RunOnHooks`); `alsoOn`: the other machines
 *   that have a project's repository, by their names, as the desk lists their chats
 * @returns {{ el: HTMLElement, refresh: () => void, paintChip: () => void, paintStart: () => void, placesMoved: (msg: any) => void, draftChanged: () => void }}
 */
export function createEmptyState(cb) {
  const greetText = h("span", { class: "greet-text" });
  const greet = h("p", { class: "greet" }, greetText);
  // The hidden measurement span carries the text at 30px; the greeting shrinks only when the two collide.
  const measure = h("span", { class: "greet-measure", "aria-hidden": "true" });
  greet.append(measure);
  const fit = () => {
    const available = greet.clientWidth - 32;
    const natural = measure.scrollWidth;
    const size = !natural || available >= natural ? 30 : Math.max(20, Math.floor(30 * (available / natural)));
    greet.style.fontSize = `${size}px`;
  };
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(fit).observe(greet);

  const chipLabel = h("span", { class: "chooser-label" }, "Choose a project");
  const chipIcon = h("span", { class: "chooser-ic", html: ICONS.folder });
  const chip = h("button", { class: "chooser-chip", type: "button" },
    chipIcon, chipLabel, h("span", { class: "chooser-chev", html: ICONS.chevronDown }));

  // The Space a chat in the folder works in, under the chooser (the Designer's walk of 10-29, "which agent do I ask":
  // a Space's New chat here… opened a Start that said nothing of it). Any agent the Start offers works there.
  const spaceLine = h("p", { class: "chooser-space", hidden: "" });
  // Words typed here before and not sent, put back in the box (the Designer's second walk of 10-29: New chat here…
  // opened on an app's request, saying nothing of it): said, with Clear, until the box is changed.
  const keptLine = h("p", { class: "chooser-kept", hidden: "" },
    h("span", {}, "Kept from before: what you typed here and didn't send. "),
    h("button", { class: "ghost sm chooser-kept-clear", type: "button", onclick: () => { cb.start?.clearKept?.(); paintKept(); } }, "Clear"));
  /** The page is a view-only device's: it starts no chat. */
  const viewOnly = () => cb.start?.viewOnly?.() === true;
  const paintKept = () => void (keptLine.hidden = viewOnly() || !cb.start?.kept?.());
  const viewLine = h("p", { class: "chooser-view-only hidden", role: "status" }, VIEW_ONLY_START_WORDS);
  /** The folders being asked where they stand, for the chip: each asked once at a time. */
  const asking = new Set();
  /**
   * The project the folder stands in, where the server said it is another folder's — a worktree's main folder's
   * (GW-D46) —; null for one that is its own project, or not known yet: then it is asked, and the chip painted again
   * once the server says. An ask that failed is asked again at the chip's next paint, never in a loop of its own.
   * @param {string} folder
   */
  const projectAbove = (folder) => {
    const k = keyOf(folder);
    if (!standing.has(k)) {
      if (!asking.has(k)) {
        asking.add(k);
        void readStanding([folder]).then(() => {
          asking.delete(k);
          if (standing.has(k) && keyOf(cb.getFolder()) === k) paintChip();
        });
      }
      return null;
    }
    const p = standing.get(k);
    return p && keyOf(p.cwd) !== k ? p : null;
  };
  const paintChip = () => {
    // A view-only device's page starts no chat: the chooser goes, and the words say why.
    const ro = viewOnly();
    chooser.classList.toggle("hidden", ro);
    viewLine.classList.toggle("hidden", !ro);
    if (ro) {
      spaceLine.hidden = true;
      paintKept();
      return;
    }
    const folder = cb.getFolder();
    // A worktree's folder is named by its project, as the bar groups its chats; the sentence beside says the folder.
    const above = folder ? projectAbove(folder) : null;
    chipLabel.textContent = !folder ? "Choose a project" : above ? (state.projects || []).find((x) => x?.id === above.id)?.name || above.name || leafOf(above.cwd) : leafOf(folder);
    setHtml(chipIcon, folder ? ICONS.folder : ICONS.messageCircle);
    chip.title = folder || "No project: the chat works in Everything, a folder of Filament's own";
    const sp = folder ? cb.spaceOf?.(above?.cwd || folder) || null : null;
    spaceLine.hidden = !sp;
    paintKept();
    spaceLine.textContent = sp ? `This chat works in ${sp.own ? `${sp.name}, a Space of yours` : `${whose(sp.name)} Space`}, whichever agent you pick: it can add tasks, note what it did in What happened, and make or change its apps.` : "";
    paintRunOn();
  };

  // The menu opens at the press, from what the page knows — the folders it remembers, each folded into the project the
  // server last said it stands in —, and takes the server's word in place as it comes (the owner's of 11-01: on a busy
  // server the press opened nothing for seconds, waiting on the disk). Its rows stand: one that stays is the element it
  // was, under the pointer (`menu`'s `set`).
  // The machines the desktop app keeps stand under this computer's projects, a row each, as soon as the app names them:
  // its projects, as the app reads them there, open beside it, and one picked opens a new chat in that machine's page,
  // in its folder (pk-list). A read that comes seconds later changes what a row says and opens, never how many rows
  // there are, so nothing moves under the pointer (the review of pk-list).
  chip.onclick = async (e) => {
    e.stopPropagation();
    let folders = knownFolders();
    /** The other machines, as the app read them; none until it answers. @type {OtherMachine[]} */
    let others = [];
    const search = h("input", { class: "chooser-search", type: "text", placeholder: "Search projects", "aria-label": "Search projects" });
    const searchRow = h("div", { class: "chooser-search-row" }, h("span", { class: "chooser-search-ic", html: ICONS.search }), search);
    /**
     * The other machines' part: a row each, its projects beside it — or one greyed row that says why there are none, or
     * that they are being read.
     */
    const machineItems = () =>
      others.length
        ? [
            { type: "separator" },
            { type: "label", label: "Your other machines" },
            ...others.map((x) => ({
              key: `on:${x.id}`,
              label: x.name,
              desc: x.projects === undefined ? "Reading its projects…" : !x.projects ? "Its projects can't be read" : x.projects.length ? `${x.projects.length} project${x.projects.length === 1 ? "" : "s"}` : "No projects there yet",
              icon: "network",
              submenu: x.projects?.length
                ? x.projects.map((p) => ({ key: `on:${x.id}:${keyOf(p.cwd)}`, label: p.name || leafOf(p.cwd), desc: p.cwd, icon: "folder", onClick: () => cb.openOn?.(x.id, p.cwd) }))
                : [{ key: `on:${x.id}:none`, label: x.projects === undefined ? "Reading its projects…" : x.projects ? "No projects there yet" : "Its projects can't be read", desc: x.projects === null ? x.words || undefined : undefined, icon: "folder", disabled: true }],
            })),
          ]
        : [];
    /** The menu's items for the folders, each folded into its project as far as the server said where it stands. */
    const items = () => {
      const current = cb.getFolder();
      const standsIn = (/** @type {string} */ cwd) => standing.get(keyOf(cwd));
      const projects = projectRows(folders, standsIn, state.projects || []);
      // The project the chooser's folder stands in is the one ticked, a worktree's too; choosing it keeps the folder.
      const here = current ? keyOf(standsIn(current)?.cwd || current) : "";
      return [
        { type: "node", node: searchRow },
        ...projects.map((f) => ({
          type: "check",
          key: keyOf(f.cwd),
          label: f.name || leafOf(f.cwd),
          desc: [f.name ? f.cwd : "", alsoOnWords(f.cwd)].filter(Boolean).join(" · ") || undefined,
          icon: "folder",
          checked: keyOf(f.cwd) === here,
          onClick: () => {
            if (keyOf(f.cwd) !== here) cb.setFolder(f.cwd);
          },
        })),
        projects.length ? null : { type: "node", node: h("div", { class: "chooser-empty" }, "No projects yet. Open a folder below to make one.") },
        ...machineItems(),
        { type: "separator" },
        { key: "open", label: "Open folder…", icon: "folderPlus", onClick: () => openFolderDialog() },
        {
          type: "check",
          key: "outside",
          label: "Work outside a project",
          desc: "In Everything, a folder of Filament's own",
          icon: "messageCircle",
          checked: !current,
          onClick: () => cb.setFolder(""),
        },
      ].filter((x) => x !== null);
    };
    const m = menu(items(), { anchor: chip, side: "top", align: "start", width: 288 });
    // The press closed the menu it had open.
    if (!m.el.isConnected) return;
    const filter = () => {
      const q = search.value.trim().toLowerCase();
      for (const row of Array.from(m.el.querySelectorAll(".zc-menu-item"))) {
        const label = row.querySelector(".zc-menu-text")?.textContent || "";
        /** @type {HTMLElement} */ (row).classList.toggle("hidden", !!q && !label.toLowerCase().includes(q));
      }
    };
    search.oninput = filter;
    search.focus();
    /** The menu drawn again with the machines as they stand, the search's filter kept. @param {OtherMachine[]} next */
    const showMachines = (next) => {
      if (!m.el.isConnected) return;
      others = next;
      m.set(items());
      filter();
    };
    /** @type {Promise<{ machines: OtherMachine[] } | null> | null} */
    let naming = null;
    /** @type {Promise<{ machines: OtherMachine[] } | null> | null} */
    let reading = null;
    try {
      naming = cb.machineNames?.() ?? null;
      reading = cb.otherMachines?.() ?? null;
    } catch {}
    let read = false;
    if (naming)
      void naming
        .then((r) => {
          // Named after the read answered: the read's rows stand.
          if (read || !Array.isArray(r?.machines) || !r.machines.length) return;
          showMachines(r.machines.map((x) => ({ id: String(x.id), name: String(x.name) })));
        })
        .catch(() => {});
    if (reading)
      void reading
        .then((r) => {
          read = true;
          if (!Array.isArray(r?.machines) || (!r.machines.length && !others.length)) return;
          showMachines(r.machines);
        })
        .catch(() => {});
    if (!folders.length) return;
    // Ghosts out: a folder that left the disk (a project deleted under it, the folder itself deleted) is dropped
    // and forgotten, not offered — and a chip pointing at one is cleared. Beside it, where each folder stands: a
    // worktree's folder is its repository's project, one row (GW-D46), as the bar shows its chats.
    const paths = folders.map((f) => f.cwd);
    const currentBefore = cb.getFolder();
    const [r] = await Promise.all([
      api("/files/exists", { method: "POST", body: { paths } }).catch(() => null),
      readStanding(currentBefore ? [...paths, currentBefore] : paths),
    ]);
    if (Array.isArray(r?.ok)) {
      const gone = folders.filter((_, i) => r.ok[i] === false);
      for (const g of gone) forgetFolder(g.cwd);
      if (gone.length) folders = folders.filter((f) => !gone.includes(f));
      // The folder chosen now, which may be another than at the press: one chosen meanwhile is left alone.
      const current = cb.getFolder();
      if (current && gone.some((g) => g.cwd === current)) cb.setFolder("");
    }
    if (!m.el.isConnected) return;
    m.set(items());
    filter();
  };

  /** The other machines a project's repository is on too, for its row. @param {string} cwd */
  const alsoOnWords = (cwd) => {
    const names = cb.alsoOn?.(cwd) || [];
    return names.length ? `also on ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}` : "";
  };

  // --- Run on (the remote desk's s2c) -----------------------------------------------------------------------------
  // Beside the project: where the chat runs. Its choice is the draft's, never changed at send time; Auto's pick is said
  // on the chip, and why on its hover.
  const runOnLabel = h("span", { class: "chooser-label" }, "This computer");
  const runOnIcon = h("span", { class: "chooser-ic", html: ICONS.monitor });
  const runOnChip = h("button", { class: "chooser-chip run-on-chip", type: "button", "aria-label": "Run on" }, runOnIcon, runOnLabel, h("span", { class: "chooser-chev", html: ICONS.chevronDown }));
  const runOnLead = h("span", { class: "chooser-lead run-on-lead" }, "on");
  /**
   * What the chip says now, from the machines as last read; a read the chip needs is asked once for the folder, and one
   * that came back with nothing is said, not asked again (a send reads them anew). A draft with no folder has no chip,
   * and runs on this computer: a choice it held goes.
   */
  const paintRunOn = () => {
    const r = cb.runOn;
    const folder = cb.getFolder();
    if (r && !folder && r.on() && r.get() !== HERE) r.set(HERE, "");
    const shown = !!r && r.on() && !!folder && !viewOnly();
    runOnChip.classList.toggle("hidden", !shown);
    runOnLead.classList.toggle("hidden", !shown);
    if (!shown || !r) return;
    const choice = r.get();
    const known = r.known(folder);
    const failed = !known && r.tried(folder);
    if (choice && !known && !failed) void r.places(folder).then(() => cb.getFolder() === folder && paintRunOn());
    const running = r.running();
    const model = r.model();
    const words = chipWords(choice, known, { running, model, name: cb.chatOf?.()?.runOnName || "" });
    // The machine Auto's chip names: a send whose pick, read anew, is another says so before anything goes.
    if (choice === AUTO) r.saw?.((known && autoPick(known, { running, model }).pick?.id) || "");
    runOnLabel.textContent = words.label;
    runOnChip.title = choice && failed ? "Your machines could not be read: a send reads them again" : words.title;
    setHtml(runOnIcon, choice === HERE ? ICONS.monitor : ICONS.network);
  };
  runOnChip.onclick = async (e) => {
    e.stopPropagation();
    const r = cb.runOn;
    const folder = cb.getFolder();
    if (!r || !folder) return;
    /** @param {import("../lib/run-on.js").Places | null} places @param {boolean} [failed]  a read of them came back with nothing */
    const items = (places, failed = false) => {
      const choice = r.get();
      const auto = places ? chipWords(AUTO, places, { running: r.running(), model: r.model() }) : null;
      return [
        { type: "check", key: "here", label: "This computer", icon: "monitor", checked: choice === HERE, onClick: () => pick(HERE, "") },
        { type: "check", key: "auto", label: "Auto", desc: auto ? auto.title : "Picks the idlest of your machines that has this project", icon: "sparkles", checked: choice === AUTO, onClick: () => pick(AUTO, "") },
        { type: "separator" },
        { type: "label", label: "Your machines" },
        ...(places
          ? places.machines.length
            ? places.machines.map((p) => ({
                type: "check",
                key: `m:${p.id}`,
                label: p.name,
                desc: chipWords(p.id, places, { running: r.running(), model: r.model() }).title,
                icon: "network",
                checked: choice === p.id,
                onClick: () => pick(p.id, p.name),
              }))
            : [{ key: "none", label: "No machine is kept for this Filament's agents", icon: "network", disabled: true }]
          : failed
            ? [{ key: "unread", label: "Your machines could not be read", desc: "Open this menu again to read them anew", icon: "network", disabled: true }]
            : [{ key: "reading", label: "Reading your machines…", icon: "network", disabled: true }]),
        { type: "separator" },
        { key: "settings", label: "Switch Run on on for a machine…", desc: "Settings › Remote access, on that machine's line", icon: "settings", onClick: () => r.settings() },
      ];
    };
    const m = menu(items(r.known(folder)), { anchor: runOnChip, side: "top", align: "start", width: 320 });
    if (!m.el.isConnected) return;
    const places = await r.places(folder, true);
    if (m.el.isConnected && cb.getFolder() === folder) m.set(items(places, !places));
    paintRunOn();
  };
  /** A choice held on the draft. @param {string} choice @param {string} name */
  const pick = (choice, name) => {
    cb.runOn?.set(choice, name);
    paintRunOn();
  };

  function openFolderDialog() {
    const input = h("input", { class: "zc-input", type: "text", placeholder: pathExample(state.platform), spellcheck: "false" });
    const browse = h("button", { class: "ghost sm", type: "button" }, "Browse…");
    const dirs = h("div", { class: "browse-dirs hidden" });
    // The OS dialog first; where it cannot open — a server with none, another machine's page — the list in the page.
    browse.addEventListener("click", () => void browseFolder(input, dirs, (m) => cb.onToast?.(m, "err")));
    const commit = (d) => {
      const p = input.value.trim();
      if (!p) { input.focus(); return; }
      rememberFolder(p);
      cb.setFolder(p);
      d.close();
    };
    const d = dialog({
      title: "Open folder",
      description: "The folder the agent works in: it reads, writes and runs its commands there.",
      body: h("div", { class: "flex flex-col gap-2" }, input, browse, dirs),
      actions: [
        { label: "Cancel", variant: "outline", onClick: () => d.close() },
        { label: "Open", onClick: () => commit(d) },
      ],
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commit(d); } });
    input.focus();
  }

  const boardBox = h("div", { class: "nt-host hidden" });
  // Where in the folder's repository the chat works (HarnessV4_Git_Plan step 5): the Start's second question, and the
  // folder's path and branch in the sentence. A choice moves what the Start board weighs (GWC-118).
  // Run on sends the folder Works in names: its chip reads that folder's machines.
  const worksIn = createWorksIn({ chat: () => cb.chatOf?.() || null, folder: () => cb.getFolder(), text: () => cb.start?.text() || "", changed: () => (ask(0), paintRunOn()) });
  const chooser = h("div", { class: "chooser" }, h("span", { class: "chooser-lead" }, "Start a new chat in"), chip, runOnLead, runOnChip, worksIn.where);
  const el = h("div", { class: "empty-chat" },
    greet,
    chooser,
    viewLine,
    spaceLine,
    keptLine,
    boardBox);

  // --- the Start board (HarnessV3-NewTask) -------------------------------------------------------------------
  // The choice is held on the chat (app.js), not here: the board draws it and the server weighs it — the changes the
  // chat holds over your defaults.
  const chat = () => cb.chatOf?.() || null;
  /** Hold the chat's changes (D15). @param {Record<string, any>} next */
  const hold = (next) => {
    const c = chat();
    if (!c || c.chainId) return;
    cb.onHeld?.({ patch: next });
    ask(0);
  };
  const board = createStartBoard({
    // The board's changes are the chat's held patch — what Reset drops. The composer's own held choices (its
    // permission chip, the tuning) ride the create body too and are weighed, but they are the composer's to show.
    held: () => ({ ...(chat()?.held || {}) }),
    set: (path, value) => hold({ ...(chat()?.held || {}), [path]: value }),
    unset: (path) => {
      const next = { ...(chat()?.held || {}) };
      delete next[path];
      hold(next);
    },
    permission: () => cb.start?.permission() || "",
    setPermission: (id) => { cb.start?.setPermission(id); ask(0); },
    models: () => cb.start?.models() || [],
    mainModel: () => cb.start?.mainModel() || "",
    agentName: () => cb.start?.agentName?.() || "",
    modelWords: () => cb.start?.modelWords?.() || "",
    poolFacts: (rows) => cb.start?.poolFacts?.(rows) ?? Promise.resolve(null),
    families: () => cb.start?.families?.() || [],
    teams: () => cb.start?.teams?.() || [],
    teamsOn: () => cb.start?.teamsOn?.() !== false,
    agents: () => cb.start?.agents?.() || { cards: [], asks: [] },
    manageAgents: () => cb.start?.manageAgents?.(),
    manageMcp: () => cb.start?.manageMcp?.(),
    manageSkills: () => cb.start?.manageSkills?.(),
    teamNames: (keys) => cb.start?.teamNames?.(keys) || [],
    reset: () => hold({}),
    worksIn: { control: worksIn.control, line: worksIn.line },
  });
  boardBox.append(board.el);
  const hideBoard = () => { boardBox.classList.add("hidden"); el.classList.remove("has-board"); };
  const showBoard = () => { boardBox.classList.remove("hidden"); el.classList.add("has-board"); };

  // The newest answer wins: each ask carries a number, and an answer that is not the newest's — or arrives for a chat
  // or a folder the page has left — is dropped.
  let asked = 0;
  let askTimer = 0;
  /** Ask again after `delay` ms (the draft's pause), replacing any ask still waiting. @param {number} delay */
  const ask = (delay) => {
    clearTimeout(askTimer);
    askTimer = Number(setTimeout(() => { void load(); }, delay));
  };
  const load = async () => {
    const c = chat();
    const folder = cb.getFolder();
    // A view-only device's page starts nothing: no Start, and nothing asked that the server would refuse it. With no
    // folder chosen the Start stands too (the owner's of 11-09: it showed nothing): the body says the chat works outside
    // a project, and the server weighs Everything's start.
    if (!cb.onHeld || !cb.start || viewOnly() || !c || c.chainId) return hideBoard();
    const body = cb.start.body();
    if (!body) return hideBoard();
    const mine = ++asked;
    board.pending(true);
    let d;
    try {
      d = await api("/sessions/draft-start", { method: "POST", body: { ...body, text: cb.start.text() } });
    } catch (/** @type {any} */ e) {
      // Said on the board, shown even before its first answer: its questions stand, the tiles wait. A page that
      // turned view-only meanwhile shows no Start at all.
      if (mine === asked && chat() === c && !viewOnly()) {
        board.failed(String(e?.message || e));
        showBoard();
      }
      return;
    }
    if (mine !== asked || chat() !== c || cb.getFolder() !== folder || c.chainId || viewOnly()) return; // moved on while this loaded
    board.paint(d);
    showBoard();
  };
  /** The greeting now: the hour's, the evening's praise only on a day the developer worked (LD-D4). */
  const greeting = () => {
    const now = new Date();
    return greetingAt(now.getHours(), workedToday(state.sessions, now));
  };
  /** The greeting re-evaluates itself at the next hour boundary. */
  let timer = 0;
  const schedule = () => {
    clearTimeout(timer);
    measure.textContent = greeting();
    greetText.textContent = measure.textContent;
    fit();
    timer = window.setTimeout(() => { paint(); schedule(); }, msUntilNextGreetingBoundary());
  };
  const paint = () => {
    const text = greeting();
    greetText.textContent = text;
    measure.textContent = text;
    paintChip();
    if (!viewOnly()) worksIn.refresh();
    fit();
    ask(0);
  };
  schedule();

  return {
    el,
    refresh: paint,
    paintChip: () => {
      paintChip();
      if (!viewOnly()) worksIn.refresh();
    },
    paintStart: () => ask(0),
    /** A repository's places read again and moved (`git-moved`): Works in reads the folder's again where they are its. @param {any} msg */
    placesMoved: (msg) => {
      if (!viewOnly() && worksIn.moved(msg)) worksIn.refresh();
    },
    draftChanged: () => {
      ask(150);
      if (!viewOnly()) worksIn.draftChanged();
      paintKept();
    },
  };
}
