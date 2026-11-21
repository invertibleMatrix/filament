// @ts-check
// A project's Space as the page reads it (proposal_ux §4.14, U5 phase 8 v1 to v3; HarnessV4_Space_Plan S1): the
// arithmetic behind the board's columns, a card's age, which lane a task or a chat is in, what each lane's place
// changed and the files two lanes both change (Overlaps, from git alone: SG-D5), the merge order, the sync points between
// lanes, Where you left off (SG-D3) and how What happened tags each line. Pure: space/*.js draws what these say; the
// tests run them alone. The Space itself is the server's (`GET /api/space/:project`).

/** The board's columns, in its order, as the board heads them. */
export const BOARD_COLUMNS = Object.freeze([
  { key: "planned", head: "Planned" },
  { key: "doing", head: "Doing" },
  { key: "waits", head: "Waits for you" },
  { key: "done", head: "Done this week" },
]);
/** How many of the week's done tasks show before the rest fold under "+ N more". */
export const DONE_SHOWN = 3;

/**
 * A task as the server keeps it; `files`, those attached to it (the owner's of 11-02), absent while it has none;
 * `rank`, where the person put it in its column (core/space.js `rankTasks`), absent until they do.
 * @typedef {{ id: string, title: string, line: string, column: "planned" | "doing" | "waits" | "done", parked: boolean,
 *   chain: string | null, place: string | null, by: any, at: number, movedAt: number, startedAt: number | null,
 *   doneAt: number | null, files?: TaskFile[], rank?: number }} SpaceTask
 * @typedef {{ id: string, name: string, kind: "image" | "pdf" | "text" | "file", type: string, bytes: number, at: number }} TaskFile
 *   a file attached to a task: `kind`, as its bytes say it — what a chat's box takes of it
 * @typedef {{ id: string, at: number, by: { kind: string, chain?: string | null, name?: string, who?: string }, text: string, task: string | null,
 *   key?: string, since?: number, turns?: number }} SpaceEntry  another machine's line (`machine`, sp-cross): `by.name`,
 *   that machine's, and `by.who`, who wrote it there
 * @typedef {{ id: string, at: number, also: string, lanes: { chain: string, when: string, state: string, error?: string, at?: number }[] }} SpaceSync
 * @typedef {{ project: string, seq: number, tasks: SpaceTask[], log: SpaceEntry[], logMore: number, syncs: SpaceSync[],
 *   names: Record<string, string>, waiting: string[], dashboards?: import("./space-dashboards.js").SpaceDashboard[],
 *   gone?: { name: string, title: string, keptV: number | null, at: number }[], feeds?: SpaceFeeds, needs?: NeedRow[],
 *   runs?: import("../space/routines.js").Runs, own?: { name: string, folder: string, repo: boolean }, shows?: ShownProject[],
 *   shownIn?: { id: string, name: string }, pulled?: { tasks: PulledTask[], counts: PulledCount[] }, pulls?: PullShown[],
 *   settings?: { model?: string, effort?: string, asks?: string }, runsOn?: import("./space-settings.js").RunsOn }} SpaceAnswer
 *   `pulled`, `pulls`: the services it pulls onto its board, their cards and each pull as its sheet opens (the Space Apps
 *   plan of 10-29)
 *   `settings`, `runsOn`: its own settings, and what its agents run on with Settings › Space's under them (11-04)
 *   `own`: a Space of your own (HarnessV4_SpacesPlugins_Plan A6) — its name, its folder, and whether that is in a repository
 *   `shows`: the projects it shows (A7)
 *   `shownIn`: a project's, the Space of yours that shows it, whose connectors and plugins its chats get
 * @typedef {{ id: string, name: string, cwd: string, needs: (NeedRow & { project: string })[],
 *   dashboards: { name: string, title: string, state?: string, paused: boolean }[],
 *   glance: { project: string, name: string, title: string, paused: boolean, tiles: import("./your-space.js").GlanceTile[] }[],
 *   watchers?: string[] }} ShownProject
 *   a project a Space of your own shows (A7): its Needs you rows, its Space's dashboards for their chips, its tiles;
 *   `watchers`: which of its routines are watchers, by id, for their rows' chip
 * @typedef {{ connection: string, tool: string, args: Record<string, unknown>, words: string, to: string,
 *   answers: { who: string, words: string } | null, from: string[], chain: string, byName: string, account: string,
 *   sent?: { as: string, link: string | null } }} Draft  a draft an agent wrote (S5c): the connection's tool that would
 *   send it, its args with "{words}" where the words go, the words, where it goes, what it answers, what it was made
 *   from, the chat that wrote it and the account it sends as
 * @typedef {{ label: string, ran: string, said: string, reason: string }} CheckRow  an agent's check that says a button did
 *   not work (S5d): the button, what ran, the last line it said, why the agent says no
 * @typedef {{ reproduced: boolean, test: string, run: string, said: string, steps: string, tried: string[],
 *   questions: string[], draft: string, chain: string, byName: string, cwd: string }} Repro  what an agent asked to
 *   reproduce a report found (S7): the failing test, how to run it and what it said — or what it tried and its questions
 *   for the reporter, with its draft that asks them —; the chat that sent it, and its folder: the lane
 * @typedef {{ what: "keep" | "on" | "resume" | "tell", chain: string, byName: string, why: string, dashboard?: string,
 *   v?: number, first?: boolean, routine?: string, all?: boolean, chats?: { chain: string, name: string }[],
 *   ended?: string, moved?: string }} Ask  an agent's ask for a press that is the person's (HarnessV4_AgentsSpace_Plan
 *   SA-D7): Keep, Switch on, Resume or Tell; who asked and why — a Tell's words —; how it ended
 * @typedef {{ id: string, kind: "watch" | "source" | "draft" | "check" | "routine" | "repro" | "ask" | "machine", text: string, why: string, dashboard: string, title: string, watch?: string,
 *   source?: string, draft?: Draft, check?: CheckRow, routine?: { id: string, chain: string, watcher?: boolean, unapproved?: boolean, told?: number, heard?: string, guide?: { id: string, to: string, from?: string, name: string, text: string } }, repro?: Repro, ask?: Ask,
 *   machine?: { id: string, name: string, project: string, row: string, was: string, closed?: boolean, gone?: boolean }, outcome?: "sent" | "discarded", at: number,
 *   state: "open" | "later" | "done", until?: number, doneAt?: number,
 *   doneBy?: { chain: string, byName: string, line: string } }} NeedRow  a row of the project's Needs you that
 *   Filament keeps (S5a, SG-D10): what a kept dashboard's watch brought, its source that stopped on its failures, a draft
 *   (S5c), a check that says a button did not work (S5d), a routine's run that failed (S6) — or a watcher's guidance held for
 *   your Send it (`routine.guide`: its record, the chat it is for and its name, its words whole), or a watcher Filament
 *   switched off, what its program runs not being what was approved (`routine.unapproved`: no run failed) —, what an agent asked to
 *   reproduce a report found (S7), an agent's ask for a press (E42 SA-D7), or an open row of another machine's Space of the
 *   same repository (`machine`, sp-cross: Done dismisses it here; `closed`, put off or closed there; `gone`, its Space no
 *   longer read from there); put off until a moment (`later`), or done —
 *   a draft sent or discarded; `doneBy`, the chat whose agent marked it done, with its line (HarnessV4_AgentsSpace_Plan AS2)
 * @typedef {{ dashboard: string, title: string, branch: string, words: string, tone: string, at: number, stale: boolean, held?: true }} FedLine
 *   a kept dashboard's line on the lane of its branch (HarnessV4_Space_Plan S4c); `held`, stale as a script its source
 *   runs waits for your Keep
 * @typedef {{ dashboard: string, title: string, source: string, key: string, task: string, line: string,
 *   column: SpaceTask["column"], at: number, stale: boolean, held?: true, presses: { name: string, label: string }[] }} FedTask  a kept
 *   dashboard's card on the board: the source of its row, its row's key, its words, its column, the dashboard's buttons
 *   that fit its row — none while it is stale —; `held`, stale as a script its source runs waits for your Keep
 * @typedef {{ dashboard: string, title: string, count: number, more: number, done?: number, error?: string, held?: true }} FedCount
 *   what a dashboard put on the board: its cards, its open rows past the most, those kept off as done; why its source
 *   never read — `held`, as it waits for your Keep
 * @typedef {{ lanes: FedLine[], tasks: FedTask[], counts: FedCount[] }} SpaceFeeds
 * @typedef {{ pull: string, service: string, title: string, key: string, keyWords: string, task: string, line: string,
 *   column: SpaceTask["column"], state: string, url: string, lane: string, moved: boolean, at: number, stale: boolean }} PulledTask
 *   an issue a pull put on the board (the Space Apps plan of 10-29): its pull and service, its key — as its service says
 *   it ("#42") —, its words, its column and its service's state, its link, the lane Start a chat on this names after it,
 *   whether it was moved on the board only, when it was read, faint where its pull's last read failed since
 * @typedef {{ pull: string, title: string, count: number, more: number, done: number, error?: string, reading?: boolean }} PulledCount
 *   what a pull put on the board: its cards, its open rows past the most, those kept off as done; why its last read
 *   failed; whether its first read is under way
 * @typedef {{ id: string, service: string, title: string, connection: string, tool: string, args: Record<string, unknown>,
 *   rows: string, key: string, name: string, state: string, url: string, line: string, columns: Record<string, string>,
 *   back: { tool: string, args: Record<string, unknown> } | null, always: boolean, at: number,
 *   backStates: Record<string, string | null>, readAt: number | null, error: string | null, reading: boolean }} PullShown
 *   a pull as its sheet opens: what it reads through and how, its column map, how a move goes back and whether without
 *   asking; the state a move to each column sets in its service, null where none does
 */

/**
 * A pull's chip in the Tasks head: "Linear 12", "Linear reading…", "Linear: its read failed".
 * @param {PulledCount} c
 */
export const pullChipWords = (c) => (c.reading ? `${c.title} reading…` : c.error && !c.count ? `${c.title}: its read failed` : `${c.title} ${c.count + c.more}`);

/**
 * A Space brought back, in its toast: "Its Space is back", and the apps kept in another Space since, which came back
 * taken out of it (10-29) — "Its Space is back: “CI” is kept in another Space, so here it is taken out".
 * @param {string} head @param {unknown} takenOut  the titles the answer names
 */
export function backWords(head, takenOut) {
  const titles = Array.isArray(takenOut) ? takenOut.filter((t) => typeof t === "string" && t).map((t) => `“${t}”`) : [];
  if (!titles.length) return head;
  const named = titles.length === 1 ? titles[0] : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
  return `${head}: ${named} ${titles.length === 1 ? "is" : "are"} kept in another Space, so here ${titles.length === 1 ? "it is" : "they are"} taken out`;
}

/**
 * A project with no Space, as its page draws one (by need, 11-12: the first thing the person adds there makes it): an
 * empty Space — no task, no line, nothing that runs —, with the drafts its chats published, each with its Keep….
 * @param {string} project @param {import("./space-dashboards.js").SpaceDashboard[]} [dashboards] @returns {SpaceAnswer}
 */
export const noSpaceYet = (project, dashboards = []) => ({ project, seq: 0, tasks: [], log: [], logMore: 0, syncs: [], names: {}, waiting: [], dashboards, gone: [], needs: [] });

/**
 * What a write's answer that made the project's Space says, in a toast (by need, 11-12) — alone, or after the press's
 * own words where it has a toast of its own —, with the tasks that came back from its old board where any did; ""
 * where the answer made none.
 * @param {{ made?: unknown, tasks?: unknown } | null | undefined} got
 */
export const madeWords = (got) => {
  if (got?.made !== true) return "";
  const n = Number(got.tasks) || 0;
  return `This project's Space is made: every chat in it can see and change it${n ? `; ${n} task${n === 1 ? "" : "s"} came back from its old board` : ""}`;
};

/** What the tip of a press that asks an agent for a routine or a watcher ends with while its project has no Space (by need). */
export const ASK_MAKES_SPACE = "; this makes the project's Space";

/**
 * What a move of a pulled card asks (the Space Apps plan of 10-29, decision 7): "Move LIN-42 to In Progress in Linear
 * too?" where a move there sets a state of its service; else why it moves on the board only.
 * @param {PulledTask} card @param {PullShown | null} pull @param {SpaceTask["column"]} column
 * @returns {{ back: true, ask: string, state: string } | { back: false, why: string }}
 */
export function moveAsk(card, pull, column) {
  const to = BOARD_COLUMNS.find((c) => c.key === column)?.head || column;
  if (!pull?.back) return { back: false, why: `${card.title}'s pull has no way to move a card back: it moves on this board only.` };
  const state = pull.backStates[column];
  if (!state) return { back: false, why: `No state of ${card.title} goes to ${to} in this pull's columns: it moves on this board only.` };
  if (state === card.state) return { back: false, why: `${card.title} says ${state} already.` };
  return { back: true, ask: `Move ${card.keyWords} to ${state} in ${card.title} too?`, state };
}

/**
 * The lines a lane shows from its Space's dashboards (S4c): those of its branch, `LANE_FED_SHOWN` at most, and how many
 * more. Main's lane is its branch's too.
 * @param {readonly FedLine[]} lines @param {string} branch
 * @returns {{ shown: FedLine[], more: number }}
 */
export function laneFed(lines, branch) {
  const mine = branch ? lines.filter((l) => l.branch === branch) : [];
  return { shown: mine.slice(0, LANE_FED_SHOWN), more: Math.max(0, mine.length - LANE_FED_SHOWN) };
}
/** How many of a lane's fed lines it shows (core's LANE_LINES_MAX). */
export const LANE_FED_SHOWN = 2;

/**
 * What the Tasks head says of the cards a source put on the board: "+ 5 from Issues", each dashboard's — its open rows,
 * those past the most too; one whose source never read says so rather than nothing (the Hunter on S4c): "Issues read
 * nothing yet: its tab says why", or "Issues waits for your Keep".
 * @param {SpaceFeeds["counts"]} counts
 */
export const fedCountWords = (counts) =>
  counts
    .map((c) => (c.held ? `${c.title} waits for your Keep` : c.error ? `${c.title} read nothing yet: its tab says why` : c.count + c.more ? `+ ${c.count + c.more} from ${c.title}` : ""))
    .filter(Boolean)
    .join(" · ");

/**
 * The order of the rows Filament keeps: what asks you — a chat's ask for a press (E42 SA-D7: after the chats' live asks,
 * which the Space puts first, before drafts), a draft —, then what fails — a check that says no too —, then what a watch
 * brought.
 */
const KEPT_RANK = { ask: -1, draft: 0, source: 1, check: 1, routine: 1, repro: 1, watch: 2 };

/**
 * The rows Filament keeps in Needs you here, as it draws them (S5a): those open — a draft first, then a stopped source,
 * then what a watch brought, the newest first in each (S5c) —, those put off (the soonest back first), and those done
 * today (the newest first). One put off whose moment has come is open, as the server says it on its next read.
 * @param {readonly NeedRow[]} needs @param {number} now
 * @returns {{ open: NeedRow[], later: NeedRow[], done: NeedRow[] }}
 */
export function needGroups(needs, now) {
  const today = new Date(now).setHours(0, 0, 0, 0);
  const back = (/** @type {NeedRow} */ n) => n.state === "later" && (n.until ?? 0) <= now;
  return {
    open: needs.filter((n) => n.state === "open" || back(n)).sort((a, b) => (KEPT_RANK[a.kind] ?? 3) - (KEPT_RANK[b.kind] ?? 3) || b.at - a.at),
    later: needs.filter((n) => n.state === "later" && !back(n)).sort((a, b) => (a.until ?? 0) - (b.until ?? 0)),
    done: needs.filter((n) => n.state === "done" && (n.doneAt ?? 0) >= today).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)),
  };
}

/** Where a draft's words go in its args: a value that is this, whole (core's WORDS_MARK). */
const WORDS_MARK = "{words}";

/** A draft's From, as its row says it: "From: slack · main"; a server that signs in its own way alone. @param {Draft} d */
export const draftFrom = (d) => `From: ${d.connection}${d.account ? ` · ${d.account}` : ""}`;

/** What Ask for a change… puts in the box of the chat that wrote a draft (S5-D9): its id and its title. @param {NeedRow} n */
export const draftAsk = (n) => `About your draft ${n.id} “${n.text}”: `;

/** How much of what a button said the Start's box is given (S5d): its last characters. */
export const HAND_SAID_CHARS = 2000;

/**
 * What Hand to an agent… puts in the Start's box for a row of Needs you (HarnessV4_Space_Plan S5d, SG-D25): what the
 * row says and where it came from — a watch's find, or a check that says a button did not work —, then "Look into it: "
 * for the person to go on. Nothing is sent until they send it.
 * @param {NeedRow} n @param {string} place  the project's name
 */
export function handWords(n, place) {
  const c = n.check;
  // The row by its id, and how to close it once it is dealt with (E42 SA-D5, the Designer's words): the box still ends
  // on the person's colon, so what they type never reads as the agent's closing line.
  const close = "once it is dealt with, mark it done with the space tool, in a line on what you did.";
  if (n.kind === "check" && c)
    return `On “${n.title}”, a dashboard in ${place}'s Space, I pressed “${c.label}”: ${ended(`it ran ${c.ran}${c.said.trim() ? ` and said: ${c.said.trim()}` : ""}`)} An agent checked it and says it did not work: ${ended(c.reason || "it gave no reason")} It is row ${n.id} of Needs you: ${close} Find out why, and fix it: `;
  return `“${n.title}”, a dashboard in ${place}'s Space, put this in Needs you as row ${n.id}: ${ended(`${n.text}${n.why ? ` (why: ${n.why})` : ""}`)} Once it is dealt with, mark the row done with the space tool, in a line on what you did. Look into it: `;
}

/**
 * The quiet line under a row an agent closed, in Done today (E42 SA-D5, the Designer's second pass): its name and its
 * line, in What happened's own form. "" for a row the person closed. @param {NeedRow} n
 */
export const doneByLine = (n) => (n.state === "done" && n.doneBy ? `${n.doneBy.byName || "An agent"}: ${n.doneBy.line}` : "");

/**
 * The line under an ask (E42 SA-D7, the Designer's second pass): its chat and its reason — a Tell's words, quoted, as
 * its chat's. @param {NeedRow} n
 */
export const askLine = (n) => (n.ask ? `${n.ask.byName || "A chat"}: ${n.ask.what === "tell" ? `“${n.ask.why}”` : n.ask.why}` : "");

/** The press an ask's button is, in the sheet's words: Keep…, Switch on…, Resume — at once, no sheet —, Tell the chats…. @param {NeedRow} n */
export const askButton = (n) => (n.ask?.what === "keep" ? "Keep…" : n.ask?.what === "on" ? "Switch on…" : n.ask?.what === "resume" ? "Resume" : n.ask?.what === "tell" ? "Tell the chats…" : "");

/** Turn down's tooltip (the Designer: a word, not ✓ — ✓ means Done everywhere and reads as yes). @param {NeedRow} n */
export const turnDownTitle = (n) => `Say no: What happened tells ${n.ask?.byName || "its chat"}; Bring back in Done today undoes it.`;

/**
 * How an ask ended, as Done today says it after its chat's name: "kept", "turned down", "v4 came" (the Designer); and,
 * where it has no Bring back, where its way back is instead — a watcher's on Watchers, where its row's switch pauses it.
 * @param {NeedRow} n @param {boolean} [watcher]  what it asked to switch on is a watcher
 * @returns {{ words: string, back: boolean, title: string }}
 */
export function askEnded(n, watcher = false) {
  const a = n.ask;
  if (!a) return { words: "done", back: true, title: "" };
  if (a.ended === "turned down") return { words: "turned down", back: true, title: "" };
  if (a.ended === "moved") return { words: a.moved || "it moved", back: false, title: "It went by itself: its chat asks again if it is still wanted" };
  if (a.ended === "taken back") return { words: "took it back", back: false, title: "Its chat took it back" };
  const where = a.what === "keep" ? "It was kept: pause or remove it from its tab's ⋯"
    : a.what === "on" ? (watcher ? "It was switched on: its switch on Watchers pauses it, its ⋯ there removes it" : "It was switched on: pause or remove it from Routines' ⋯")
    : a.what === "resume" ? "It was resumed: pause it again from its ⋯"
    : "What was told stays told";
  return { words: a.ended || "done", back: false, title: where };
}

/** A sentence's end: a period, where it has none of its own (seen live: "writes nothing.."). @param {string} s */
const ended = (s) => (/[.!?…]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/**
 * What Hand to an agent… puts in the Start's box for a button's result (S5d): the button, its dashboard and the row it
 * was pressed on, what ran, and what it said — its last `HAND_SAID_CHARS` — or why it failed; and an agent's check's
 * verdict, where one ended.
 * @param {{ place: string, dashboard: string, label: string, says: string, ran: string, said: string, error?: string, checked?: string }} o
 *   `says`: its sentence with the row's values; `error`: how it ended where it failed or was stopped, in What happened's
 *   words ("it failed: npx exited 1…", "you stopped it"); `checked`: the check's Verdict line, its words alone
 */
export function resultWords({ place, dashboard, label, says, ran, said, error = "", checked = "" }) {
  const out = (said.length > HAND_SAID_CHARS ? `…${said.slice(-HAND_SAID_CHARS)}` : said).trim();
  const failure = error.trim().replace(/\.$/, "");
  // What it said, where its failure's words do not already say it (seen live: the same line twice).
  const told = out && !failure.includes(out.replace(/\.$/, "")) ? ` What it said: ${out}` : "";
  const end = failure ? ` ${failure[0].toUpperCase()}${failure.slice(1)}.${told}` : ` It said: ${out || "nothing"}`;
  const check = checked.trim() ? `${/[.!?…]$/.test(end.trim()) ? "" : "."} An agent checked it and says: ${ended(checked)}` : "";
  return `On “${dashboard}”, a dashboard in ${place}'s Space, I pressed “${label}” (${says}). It ran ${ran}.${end}${check}\n\nLook into it: `;
}

/**
 * A report as Reproduce… hands it to the Builder (S7, the mock's screen 14): `title`, its first line, which names the
 * lane; `text`, the rest of its words; `from`, where it came from, in words.
 * @typedef {{ title: string, text: string, from: string }} ReproReport
 */

/** The longest a lane Reproduce… names may be, past `repro/`. */
const REPRO_NAME_CHARS = 40;

/**
 * The lane Reproduce… works in (S7-D2): `repro/` and the issue key its title begins with (PLAY-91 → `repro/play-91`,
 * #482 → `repro/482`), else its first words (`repro/sign-in-loops-on-safari`).
 * @param {string} title
 */
export function reproLane(title) {
  const s = String(title || "").trim();
  const key = /^(?:#(\d+)|([A-Za-z][A-Za-z0-9]*-\d+))\b/.exec(s);
  if (key) return `repro/${(key[1] || key[2]).toLowerCase()}`;
  const words = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  let name = "";
  for (const w of words) {
    if ((name ? `${name}-${w}` : w).length > REPRO_NAME_CHARS) break;
    name = name ? `${name}-${w}` : w;
  }
  return `repro/${name || "report"}`;
}

/** What Reproduce… does, where a person points at it: the box it fills, for whom, and that nothing runs yet (S7-D2). */
export const REPRO_TIP = "The Start on a new lane repro/…, the Builder asked to reproduce it with a failing test and fix nothing: nothing runs until you send";

/**
 * What Reproduce… puts in the Start's box (S7-D2): addressed to the Builder, which writes and runs tests, where Agents
 * has it (`@builder`), the report's words and where it came from, and what to do — a failing test, or the Browser pane
 * for a web app; no fix — and how to say what it found (the space tool's `repro`).
 * @param {ReproReport} r @param {{ builder: boolean }} o
 */
export function reproduceWords(r, { builder }) {
  const body = [r.text.trim() && r.text.trim() !== r.title.trim() ? r.text.trim() : "", r.from ? `(${ended(r.from).replace(/\.$/, "")}.)` : ""].filter(Boolean).join("\n");
  return [
    `${builder ? "@builder " : ""}Reproduce this — don't fix it: ${r.title.trim()}`,
    ...(body ? [body] : []),
    "Reproduce it with a failing test, or in the Browser pane for a web app; don't fix it. Then say what you found with the space tool's repro: reproduced, with the failing test and how to run it — or not, with what you tried and your questions for the reporter.",
  ].join("\n\n");
}

/**
 * What a repro's Fix it… puts in the Start's box, in its lane (S7-D4): the report, its failing test and how to run it,
 * what it said; its row by its id, to mark done once fixed; make it pass without weakening it.
 * @param {{ id?: string, title: string, repro: Repro }} n
 */
export function reproFixWords({ id = "", title, repro: r }) {
  const said = r.said.trim() ? ` It said: ${ended(r.said)}` : "";
  // Its row stays open until marked (E42, the Designer's second pass): named, as Hand to an agent… names a row.
  const row = id ? ` It is row ${id} of Needs you: once it is fixed, mark it done with the space tool, in a line on what you changed.` : "";
  return `Fix “${title}”. The failing test ${r.test} shows it — run it with: ${r.run}.${said}${row} Make it pass without weakening it, and say what you changed: `;
}

/**
 * A repro's lines, as its row says them (S7-D4): reproduced — "A failing test: …. It said: …", "Run: …" —; or not —
 * "Tried 3 ways: …; …", its questions quoted, with what became of its draft of them (`how`: drafted while it waits, sent
 * once it was, none where it was discarded; by default, drafted where it names one).
 * @param {Repro} r @param {"drafted" | "sent" | ""} [how] @returns {string[]}
 */
export function reproLines(r, how = r.draft ? "drafted" : "") {
  // What it said follows the test as the agent wrote it, after a dash: its words may begin small ("fails on main").
  if (r.reproduced) return [ended(`A failing test: ${r.test}${r.said.trim() ? ` — ${r.said.trim()}` : ""}`), `Run: ${r.run}`, ...(r.steps.trim() ? [`Steps: ${r.steps.trim()}`] : [])];
  const n = r.tried.length;
  return [
    `Tried ${n === 1 ? "1 way" : `${n} ways`}: ${r.tried.join("; ")}${/[.!?…]$/.test(r.tried.at(-1) || "") ? "" : "."}`,
    ...(r.questions.length ? [`${r.questions.length === 1 ? "1 question" : `${r.questions.length} questions`} for the reporter${how ? `, ${how}` : ""}: ${r.questions.map((q) => `“${q}”`).join(" · ")}`] : []),
  ];
}

/**
 * A row of Needs you as Reproduce… hands it on (S7-D1): what a watch found — its words, its dashboard and why it came —,
 * or a check that says a button did not work — what was pressed, what ran and said, and why the agent says no.
 * @param {NeedRow} n @param {string} place
 * @returns {ReproReport}
 */
export function reproReportOf(n, place) {
  // The box wraps it in brackets: the rule after a dash, not in brackets of its own (seen live on S7).
  const from = `${n.title}, a dashboard in ${place}'s Space, put it in Needs you${n.why ? ` — ${n.why}` : ""}`;
  const c = n.check;
  if (n.kind === "check" && c)
    return { title: n.text, text: `I pressed “${c.label}”: ${ended(`it ran ${c.ran}${c.said.trim() ? ` and said: ${c.said.trim()}` : ""}`)} An agent checked it and says it did not work: ${ended(c.reason || "it gave no reason")}`, from };
  return { title: n.text, text: "", from };
}

/** What Copy the questions copies (S7-D4): a repro's questions, a line each. @param {Repro} r */
export const reproQuestions = (r) => r.questions.map((q) => `- ${q}`).join("\n");

/** The words Routine… starts the Start with (S6, screen 11): an agent proposes it; only your Switch on runs it. @param {string} place */
export const routineMakeWords = (place) => `Make a routine for ${place}'s Space — work an agent does by itself at a time I switch on: `;

/** The words Watcher… starts the Start with, as Routine… does for a routine: an agent proposes it; only your Switch on lets it listen. @param {string} place */
export const watcherMakeWords = (place) => `Make a watcher for ${place}'s Space — something that listens for an event and wakes an agent, or tells me, once I switch it on: `;

/**
 * What Watch this chat… in a chat's menu puts in its box, for the person to send: the chat's own agent proposes the
 * watcher, which listens only once they switch it on.
 */
export const WATCH_CHAT_WORDS = "Propose a watcher that reviews each turn of this chat against what I asked for, and guides it when it drifts. Use the space tool's supervisor example.";

/**
 * How a row of the overview's Runs by itself stands (space/by-itself.js): the one word at its right, the tone of its
 * dot, and where it comes in the list (`rank`) — what failed first, then what waits for the person's Switch on or Keep,
 * then what is on, then what is paused. A routine's and a watcher's, from what their rows on their own pages say: one
 * proposed, one paused — by Filament where it says why —, one whose last run failed, else a routine is on and a
 * watcher listens, its tone the run's while one is under way. An app's, from what its row in the left bar says
 * (lib/space-dashboards.js `tabOf`): a source it reads fails or its scripts wait for a Keep, a draft, paused, else live.
 * @param {{ kind: "routine" | "watcher", state: string, paused: boolean, pausedWhy?: string, tone: string }
 *   | { kind: "app", draft: boolean, paused: boolean, fault: boolean, held: boolean }} x
 * @returns {{ word: string, tone: "bad" | "proposed" | "draft" | "on" | "works" | "asks" | "live" | "paused", rank: 0 | 1 | 2 | 3 }}
 */
export function byItselfStands(x) {
  if (x.kind === "app") {
    if (x.fault) return { word: "Couldn't read", tone: "bad", rank: 0 };
    if (x.held) return { word: "Waits for your Keep", tone: "bad", rank: 0 };
    if (x.draft) return { word: "Draft", tone: "draft", rank: 1 };
    if (x.paused) return { word: "Paused", tone: "paused", rank: 3 };
    return { word: "Live", tone: "live", rank: 2 };
  }
  if (x.state === "proposed") return { word: "Proposed", tone: "proposed", rank: 1 };
  if (x.paused) return { word: x.pausedWhy ? "Paused by Filament" : "Paused", tone: "paused", rank: 3 };
  if (x.tone === "bad") return { word: "Failed", tone: "bad", rank: 0 };
  return { word: x.kind === "watcher" ? "Listening" : "On", tone: x.tone === "works" || x.tone === "asks" ? x.tone : "on", rank: 2 };
}

/**
 * Whether a routine or a watcher fails now: its last run failed, and it is on and not paused. One proposed again or
 * paused runs nothing, and every row says that of it before its last run (`byItselfStands`, its own page's row): the
 * dot beside Routines and Watchers, in the left bar and on their tabs, is of these alone, so pausing what fails puts it
 * out — as the server's read for the bar says it (http/admin/spaces.js `barOf`).
 * @param {{ state: string, paused: boolean, words: { tone: string } }} r
 */
export const standsFailed = (r) => r.state !== "removed" && r.state !== "proposed" && !r.paused && r.words.tone === "bad";

/** What Pause all holds back, as its button's tip, its confirm and Settings › Space say it: everything that starts by itself. */
export const PAUSE_ALL_HOLDS = "no routine at its time, no dashboard's watch, no watcher on an event";

/**
 * What becomes of what comes while Pause all is on, as its confirm says it of all it holds: a time, what a chat does,
 * what moves in a folder and what a program posts are gone for what waited on them, and a watcher's own program is
 * stopped; what reads something for news — a dashboard's source, a branch, a connection's answer — keeps where it
 * stood, and finds what changed once it reads again.
 */
export const PAUSE_ALL_MEANWHILE = "A routine's times that come while paused are skipped and said; what a chat does, what moves in a folder and what a program posts then wakes no watcher, and a watcher's own program is stopped: Resume makes up none of it. A dashboard's watch and a watcher of a branch or a connection read again on Resume, and find what changed meanwhile.";

/**
 * What a routine's Fix… puts in the Start's box (S6, case 8): the routine, when it ran and why it failed. A watcher is
 * said as one, with what it has in a time's place: what it watches.
 * @param {{ title: string, why: string, ran: string, watcher?: boolean }} o  `ran`: when it ran, in its row's words
 * @param {string} place
 */
export const routineFixWords = ({ title, why, ran, watcher = false }, place) =>
  `“${title}”, a ${watcher ? "watcher" : "routine"} of ${place}'s Space, failed (${ran}): ${ended(why || "it gave no reason")} Find out why, and fix it — its words, ${watcher ? "what it watches" : "its time"}, or what it needs; propose the ${watcher ? "watcher" : "routine"} again where it changes: `;

/**
 * What a routine's Ask for a change… puts in the box of the chat that made it: the routine by its id, a watcher said
 * as one — the space tool changes both with its routine. @param {{ id: string, title: string, trigger?: unknown }} r
 */
export const routineAskWords = (r) => `About your ${r.trigger ? "watcher" : "routine"} ${r.id} “${r.title}” (change it with the space tool's routine and its id): `;

/** What a procedure's Run… puts in the Start's box (S6-D7): memory's how-to, whole, to do now. @param {{ text: string }} p @param {string} place */
export const procedureWords = (p, place) => `Do this now in ${place}, as memory keeps it — stop and ask me before any step that pushes, deploys or sends: ${p.text}`;

/**
 * What do you look after… (S6, screen 3; S6-D9): the kinds of work a Space can look after, in plain words — none names
 * a service (your word 4, SG-D24). A tick asks an agent to set it up as routines and dashboards you switch on yourself.
 */
export const LOOK_AFTER = Object.freeze([
  { key: "reviews", label: "Reviews and checks", line: "Changes that ask for your review, and checks that fail on the main branch, in Needs you: watched without AI.",
    ask: "changes that ask for my review, and checks that fail on the main branch, in Needs you: watched without AI." },
  { key: "messages", label: "Messages", line: "A brief on weekdays at 09:00 of what came in, and what asks you in Needs you: an agent that only reads, and never sends.",
    ask: "a brief on weekdays at 09:00 of what came in, and what asks me in Needs you: an agent that only reads, and never sends." },
  { key: "releases", label: "Releases", line: "How you release, as your chats did it, and a dashboard of what is live: each step yours to run.",
    ask: "how I release, as my chats did it, and a dashboard of what is live: each step mine to run." },
  { key: "oncall", label: "On call", line: "A dashboard of errors with a watch, and a way back on deploys with a second look before it runs.",
    ask: "a dashboard of errors with a watch, and a way back on deploys with a second look before it runs." },
  { key: "upkeep", label: "Upkeep", line: "Weekly, safe dependency updates in a lane of its own with the tests run, and what expires soon: what it changed waits like any lane's.",
    ask: "weekly, safe dependency updates in a lane of its own with the tests run, and what expires soon: what it changed waits like any lane's." },
  { key: "reporting", label: "Reporting", line: "Fridays at 16:00, your weekly update as a draft — what was done, merged and closed —, waiting for your Send.",
    ask: "Fridays at 16:00, my weekly update as a draft — what was done, merged and closed —, waiting for my Send." },
]);

/**
 * What a Space of your own looks after (HarnessV4_SpacesPlugins_Plan A6, §5): the work that belongs to no project —
 * what people say to you, your mail, the issues given to you —, beside reviews and reporting. None names a service.
 */
export const LOOK_AFTER_OWN = Object.freeze([
  { key: "messages", label: "Messages", line: "Who tagged you, and what is planned that touches you, in Needs you; a brief on weekdays at 09:00; replies drafted, never sent.",
    ask: "who tagged me, and what is planned that touches me, in Needs you; a brief on weekdays at 09:00 of what came in; replies drafted for my Send, never sent." },
  { key: "email", label: "Email", line: "What matters in Needs you, the rest archived or labelled as you say; replies drafted, never sent.",
    ask: "what matters in my inbox in Needs you, the rest archived or labelled as I say; replies drafted for my Send, never sent." },
  { key: "issues", label: "Issues", line: "The issues given to you, each one a chat can pick up, and a dashboard of where each stands.",
    ask: "the issues assigned to me, each one a chat can pick up, and a dashboard of where each stands." },
  // Reviews, without the main branch a folder of one's own may not have (found by the Hunter on A6).
  { key: "reviews", label: "Reviews and checks", line: "Changes that ask for your review, and checks that fail, in Needs you: watched without AI.",
    ask: "changes that ask for my review, and checks that fail, in Needs you: watched without AI." },
  LOOK_AFTER[5],
]);

/**
 * What a project shown in a Space of yours looks after (the owner's word of 10-26: "a pr review as well"): the Space
 * keeps the reviews asked of you and your weekly update, so the project keeps its checks, and its messages are its
 * channels'. Reporting is the Space's alone.
 */
export const LOOK_AFTER_SHOWN = Object.freeze([
  { key: "reviews", label: "Checks", line: "Checks that fail on the main branch, in Needs you: watched without AI.",
    ask: "checks that fail on the main branch, in Needs you: watched without AI." },
  { key: "messages", label: "Messages", line: "A brief on weekdays at 09:00 of what came in on this project's channels: an agent that only reads, and never sends.",
    ask: "a brief on weekdays at 09:00 of what came in on this project's channels: an agent that only reads, and never sends." },
  LOOK_AFTER[2],
  LOOK_AFTER[3],
  LOOK_AFTER[4],
]);

/**
 * The Start's words for the kinds ticked (S6-D9): set them up as parts you switch on yourself; nothing runs. Each kind in
 * the person's own voice (`ask`): the sheet's "you" would be the agent's to read (seen at S6's live look). `kinds`: a
 * Space of your own's (LOOK_AFTER_OWN), else a project's.
 * @param {readonly string[]} keys @param {string} place @param {readonly { key: string, label: string, ask: string }[]} [kinds]
 */
export function lookAfterWords(keys, place, kinds = LOOK_AFTER) {
  const rows = kinds.filter((k) => keys.includes(k.key)).map((k) => `- ${k.label}: ${k.ask}`);
  // A Space of your own's connections are the Space's: it is no project to the person (found by the Hunter on A6).
  const whose = kinds === LOOK_AFTER_OWN ? "this Space's" : "this project's";
  return `Set up ${place}'s Space for what I look after, as routines and dashboards I switch on myself — propose each, run nothing, and use ${whose} connections where it has them, saying which one is missing where one is:\n${rows.join("\n")}\n\n`;
}

/**
 * The call a draft's Send makes, as its sheet shows it: the args, "‹your words›" where the words go.
 * @param {Record<string, unknown>} args
 */
export function draftCall(args) {
  /** @param {unknown} v @returns {unknown} */
  const shown = (v) => (v === WORDS_MARK ? "‹your words›" : Array.isArray(v) ? v.map(shown) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shown(x)])) : v);
  return JSON.stringify(shown(args), null, 2);
}

/**
 * A line of Made from in parts: its words, and each link in it that opens (http and https alone).
 * @param {string} line @returns {({ text: string } | { href: string })[]}
 */
export function linkParts(line) {
  /** @type {({ text: string } | { href: string })[]} */
  const out = [];
  let at = 0;
  for (const m of String(line).matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)) {
    const href = m[0].replace(/[.,;:!?]+$/, "");
    const i = /** @type {number} */ (m.index);
    if (i > at) out.push({ text: line.slice(at, i) });
    out.push({ href });
    at = i + href.length;
  }
  if (at < line.length) out.push({ text: line.slice(at) });
  return out;
}

/**
 * Not now's choices (S5-D3): tomorrow 09:00, and Monday 09:00 where that is not tomorrow; in the night, 09:00 this
 * morning first, while it is an hour away or more (found at the live look: at 00:50, tomorrow 09:00 hid a row 32 hours).
 * @param {number} now @returns {{ label: string, until: number }[]}
 */
export function notNowChoices(now) {
  const d = new Date(now);
  const at = (/** @type {number} */ days) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 9).getTime();
  const morning = at(0);
  const tomorrow = at(1);
  const monday = at((8 - d.getDay()) % 7 || 7);
  return [
    ...(now <= morning - 3_600_000 ? [{ label: "Until 09:00 this morning", until: morning }] : []),
    { label: "Until tomorrow 09:00", until: tomorrow },
    ...(monday !== tomorrow ? [{ label: "Until Monday 09:00", until: monday }] : []),
  ];
}

/**
 * When a row put off comes back: "today 18:00", "tomorrow 09:00", "Mon 09:00", "3 Nov 09:00".
 * @param {number} at @param {number} now
 */
export function untilWords(at, now) {
  const d = new Date(at);
  const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return `today ${time}`;
  if (days === 1) return `tomorrow ${time}`;
  if (days < 7) return `${DAYS[d.getDay()]} ${time}`;
  return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })} ${time}`;
}

/**
 * A row's dashboard as its chip names it (S5a): its title, said paused where it is, taken out where the Space no longer
 * has it — then it has no tab to open.
 * @param {NeedRow} n @param {readonly { name: string, title: string, paused: boolean }[]} dashboards
 * @returns {{ label: string, tab: boolean }}
 */
export function needChip(n, dashboards) {
  const d = dashboards.find((x) => x.name === n.dashboard);
  if (!d) return { label: `${n.title} · taken out`, tab: false };
  return { label: d.paused ? `${d.title || n.title} · paused` : d.title || n.title, tab: true };
}

/** The Monday, 00:00 local, of the week a moment is in. @param {number} ms */
export function weekStart(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * How long ago, as a card's corner says it: "now", "40m", "2h", "12d" — a moment of this week, for a done task, by
 * its day ("Sat"), today's by its age.
 * @param {number} at @param {number} now @param {{ day?: boolean }} [o]
 */
export function ageWords(at, now, { day = false } = {}) {
  const ms = Math.max(0, now - at);
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (day && at < today && at >= weekStart(now)) return DAYS[new Date(at).getDay()];
  if (ms < 60_000) return "now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

/**
 * Where a task's file is read: a picture shown as one, text as text, any other kind downloaded.
 * @param {string} project @param {string} task @param {string} file
 */
export const taskFileUrl = (project, task, file) => `/api/space/${encodeURIComponent(project)}/tasks/${encodeURIComponent(task)}/files/${encodeURIComponent(file)}`;

/** A file's size in words: 812 bytes, 14 KB, 2.4 MB. @param {number} n */
export const sizeWords = (n) => (n < 1024 ? `${n} bytes` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1).replace(/\.0$/, "")} MB`);

/**
 * A task's files a chat's box takes — pictures, PDFs, text —, and the names of those it does not: they stay on the card.
 * @param {{ files?: TaskFile[] }} t @returns {{ takes: TaskFile[], left: string[] }}
 */
export const boxFilesOf = (t) => ({ takes: (t.files || []).filter((f) => f.kind !== "file"), left: (t.files || []).filter((f) => f.kind === "file").map((f) => f.name) });

/**
 * A task's files read from its Space for a chat's box, each whole as a File (`get`: the page's fetch); one that could
 * not be read is said in words, and the rest are read all the same.
 * @param {string} project @param {string} task @param {readonly TaskFile[]} takes @param {(url: string) => Promise<Response>} get
 * @returns {Promise<{ files: File[], failed: string[] }>}
 */
export async function readTaskFiles(project, task, takes, get) {
  const read = await Promise.allSettled(
    takes.map(async (f) => {
      const r = await get(taskFileUrl(project, task, f.id));
      if (!r.ok) throw new Error(`${f.name} could not be read from the board (${r.status})`);
      const blob = await r.blob();
      return new File([blob], f.name, { type: f.type.split(";")[0] || blob.type });
    }),
  );
  return {
    files: read.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
    failed: read.flatMap((r) => (r.status === "rejected" ? [String(r.reason?.message || r.reason)] : [])),
  };
}

/** A moment as the logbook's margin says it: its time today, its day this week, else its date. @param {number} at @param {number} now */
export function whenWords(at, now) {
  const d = new Date(at);
  const today = new Date(now).setHours(0, 0, 0, 0);
  const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
  if (at >= today) return `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (at >= weekStart(now)) return DAYS[d.getDay()];
  return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
}

/**
 * A moment as Where you left off says it, its time always: "today 19:40", "yesterday 19:40", "Mon 19:40", "21 Oct
 * 19:40". @param {number} at @param {number} now
 */
export function lookWords(at, now) {
  const d = new Date(at);
  const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const today = new Date(now).setHours(0, 0, 0, 0);
  const yesterday = new Date(today - 1).setHours(0, 0, 0, 0);
  if (at >= today) return `today ${time}`;
  if (at >= yesterday) return `yesterday ${time}`;
  if (at >= today - 6 * 86_400_000) return `${DAYS[d.getDay()]} ${time}`;
  return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })} ${time}`;
}

/**
 * One column's tasks in the board's order, top to bottom: Planned's open ones before its parked; in Planned, Doing and
 * Waits each where the person put it (its `rank`, core/space.js `rankTasks`), else by its time on the board on that
 * same scale — Planned's by when it was made, the others' by when it moved —, the newest on top; Done the newest done
 * on top. The server's `boardOrder` (core/space.js), which says the board to an agent and on the week's page: the layers
 * keep the page and the server apart, so each has its own, and a test holds them word for word.
 * @template {SpaceTask} T @param {readonly T[]} tasks  the column's @param {string} column @returns {T[]}
 */
export function boardOrder(tasks, column) {
  const place = (/** @type {T} */ t) => t.rank ?? -(column === "planned" ? t.at : t.movedAt);
  return column === "done"
    ? [...tasks].sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
    : [...tasks].sort((a, b) => (column === "planned" ? Number(a.parked) - Number(b.parked) : 0) || place(a) - place(b));
}

/**
 * The tasks a task stands among in its column in the order a write puts them: `ids`, those of them top to bottom as the
 * person's board showed them; one the ids leave out, made or moved in since that board was drawn, keeps its place among
 * them — below the one of them it stood below (the task placed is no mark: it moves), or on top where it stood above
 * them all. The server's `placedAmong` (core/space.js `rankTasks`), held to it word for word as `boardOrder` is.
 * @template {SpaceTask} T @param {readonly T[]} among  in the board's order (`boardOrder`) @param {T} t  the task placed
 * @param {readonly string[]} ids @returns {T[]}
 */
export function placedAmong(among, t, ids) {
  const byId = new Map(among.map((x) => [x.id, x]));
  const listed = ids.flatMap((id) => byId.get(id) ?? []);
  /** Each the ids leave out, under the one listed it stood below; null: above them all. @type {Map<T | null, T[]>} */
  const under = new Map();
  /** @type {T | null} */
  let above = null;
  for (const x of among) {
    if (!listed.includes(x)) under.set(above, [...(under.get(above) || []), x]);
    else if (x !== t) above = x;
  }
  return [...(under.get(null) || []), ...listed.flatMap((x) => [x, ...(under.get(x) || [])])];
}

/**
 * A move on the board: the task, the column it ends in, the ids of those it stands among there top to bottom (none for
 * Done), and when it was made.
 * @typedef {{ id: string, column: SpaceTask["column"], order: string[] | null, at: number }} BoardMove
 */

/**
 * The tasks as a move leaves them, as the server's write makes them (services/spaces.js `moveTo`, core/space.js
 * `rankTasks`): the board draws a move so before the server answers, and the person's next one builds on it. A task
 * gone since is no move. @param {readonly SpaceTask[]} tasks @param {BoardMove} move @returns {SpaceTask[]}
 */
export function movedTasks(tasks, { id, column, order, at }) {
  const out = tasks.map((x) => ({ ...x }));
  const t = out.find((x) => x.id === id);
  if (!t) return out;
  if (t.column !== column) {
    t.column = column;
    t.movedAt = at;
    delete t.rank;
    if (column === "doing" && t.startedAt == null) t.startedAt = at;
    t.doneAt = column === "done" ? at : null;
  }
  if (order && column !== "done")
    placedAmong(boardOrder(out.filter((x) => x.column === column && (column !== "planned" || x.parked === t.parked)), column), t, order).forEach((x, i) => {
      x.rank = i - at;
    });
  return out;
}

/**
 * The board's columns with their tasks in its order (`boardOrder`), Done only this week's.
 * @param {readonly SpaceTask[]} tasks @param {number} now
 * @returns {{ key: string, head: string, tasks: SpaceTask[] }[]}
 */
export function boardColumns(tasks, now) {
  const since = weekStart(now);
  return BOARD_COLUMNS.map((c) => ({
    key: c.key,
    head: c.head,
    tasks: boardOrder(tasks.filter((t) => t.column === c.key && (c.key !== "done" || (t.doneAt ?? 0) >= since)), c.key),
  }));
}

/**
 * A lane as the board and the panels name it: its place's folder, its chip's words, whether it is the main folder, and
 * the chats that work there.
 * @typedef {{ path: string, chip: string, main: boolean, chains: string[] }} LaneRef
 */

/** A folder as two places are compared. @param {unknown} p */
export const placeKey = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * A project's lanes, the one rule its Space's page and its row in the left bar count by (the owner's of 11-12): a lane
 * is a folder or worktree of the project's repository that a chat works in — its folder is there, or its agents wrote
 * there — and the main folder always. `works`: each place a chat works in, with its repository's main folder. A place
 * of another repository is no lane of this one, nor one inside the repository's own git folder, where Filament keeps
 * its helpers' copies: the page's places leave those out.
 * @param {string | null | undefined} main  the repository's main folder; none where it has none (a bare repository)
 * @param {Iterable<{ place?: string | null, main?: string | null } | null | undefined>} works
 * @returns {string[]}  each lane's place as first spelled, the main folder first
 */
export function lanePlaces(main, works) {
  /** @type {Map<string, string>} */
  const lanes = new Map(main ? [[placeKey(main), String(main)]] : []);
  for (const w of works) {
    if (!w?.place) continue;
    const key = placeKey(w.place);
    if (main && (placeKey(w.main || w.place) !== placeKey(main) || key.startsWith(`${placeKey(main)}/.git/`))) continue;
    if (!lanes.has(key)) lanes.set(key, String(w.place));
  }
  return [...lanes.values()];
}

/**
 * The lane a task stands in: its chat's, else the folder it is planned for; null for neither.
 * @param {SpaceTask} t @param {readonly LaneRef[]} lanes
 */
export function laneOfTask(t, lanes) {
  if (t.chain) {
    const l = lanes.find((x) => x.chains.includes(/** @type {string} */ (t.chain)));
    if (l) return l;
  }
  if (t.place) return lanes.find((x) => placeKey(x.path) === placeKey(t.place)) || null;
  return null;
}

/**
 * The newest logbook line a lane's chats wrote, for its card. @param {readonly SpaceEntry[]} log @param {LaneRef} lane
 * @returns {SpaceEntry | null}
 */
export function laneNews(log, lane) {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.by.kind === "agent" && e.by.chain && lane.chains.includes(e.by.chain)) return e;
  }
  return null;
}

/**
 * The task a lane has now: of those in Doing whose chat works there, the one the board shows on top (`boardOrder`), else
 * of those that wait for you.
 * @param {readonly SpaceTask[]} tasks @param {LaneRef} lane
 */
export function laneTask(tasks, lane) {
  const mine = tasks.filter((t) => t.chain && lane.chains.includes(t.chain));
  const pick = (/** @type {string} */ c) => boardOrder(mine.filter((t) => t.column === c), c)[0] || null;
  return pick("doing") || pick("waits");
}

/**
 * The newest sync that reached both of two lanes — the point drawn between them — or null.
 * @param {readonly SpaceSync[]} syncs @param {LaneRef} a @param {LaneRef} b
 */
export function syncBetween(syncs, a, b) {
  const reached = (/** @type {SpaceSync} */ s, /** @type {LaneRef} */ l) => s.lanes.some((x) => l.chains.includes(x.chain) && x.state !== "refused");
  for (let i = syncs.length - 1; i >= 0; i--) if (reached(syncs[i], a) && reached(syncs[i], b)) return syncs[i];
  return null;
}

/** A path as a chip says it: its name, a folder's glob by its folder's name ("panes/*"). @param {string} path */
export function pathLabel(path) {
  const p = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = p.split("/").filter(Boolean);
  const last = parts.at(-1) || p;
  if ((last === "*" || last === "**") && parts.length > 1) return `${parts.at(-2)}/*`;
  return last;
}

/**
 * A place's changed files as the Space's files read answers them.
 * @typedef {{ path: string, ok: boolean, error: string | null, branch: string | null, base: string | null,
 *   ahead: number | null, commits: number, files: { path: string, committed: boolean, uncommitted: boolean }[], more: number }} PlaceFiles
 */

/**
 * What each lane's place changed, and the files two lanes both change (Overlaps, SG-D5: git alone says it), each said
 * once with the lanes that change it. A lane's own list leaves out what it shares.
 * @param {readonly LaneRef[]} lanes @param {ReadonlyMap<string, PlaceFiles>} files  by place key
 * @returns {{ own: { lane: LaneRef, paths: string[] }[], shared: { path: string, lanes: LaneRef[] }[] }}
 */
export function ownersOf(lanes, files) {
  /** @type {Map<string, LaneRef[]>} */
  const by = new Map();
  const of = lanes.map((lane) => ({ lane, changed: [...new Set((files.get(placeKey(lane.path))?.files || []).map((f) => f.path))] }));
  for (const x of of) for (const p of x.changed) by.set(p, [...(by.get(p) || []), x.lane]);
  const shared = [...by].filter(([, ls]) => ls.length > 1).map(([path, ls]) => ({ path, lanes: ls })).sort((a, b) => a.path.localeCompare(b.path));
  const meet = new Set(shared.map((s) => s.path));
  return { own: of.map((x) => ({ lane: x.lane, paths: x.changed.filter((p) => !meet.has(p)) })).filter((o) => o.paths.length), shared };
}

/**
 * The Overlap banner's words (SG-D5): one file, "feat/login and feat/x both change src/auth/redirect.ts" ("3 lanes
 * change …" where more do); more, how many and the first three, "by two lanes", or "by two lanes or more" where one
 * is changed by more. Null where no file is changed by two lanes.
 * @param {{ path: string, lanes: LaneRef[] }[]} shared
 * @returns {{ head: string, line: string } | null}
 */
export function overlapWords(shared) {
  if (!shared.length) return null;
  const one = shared[0].lanes;
  if (shared.length === 1) return { head: "Overlap", line: `${one.length > 2 ? `${one.length} lanes change` : `${one.map((l) => l.chip).join(" and ")} both change`} ${shared[0].path}.` };
  const names = shared.slice(0, 3).map((s) => pathLabel(s.path));
  const by = shared.some((s) => s.lanes.length > 2) ? "two lanes or more" : "two lanes";
  return { head: "Overlaps", line: `${shared.length} files are changed by ${by}: ${names.join(", ")}${shared.length > 3 ? ` and ${shared.length - 3} more` : ""}.` };
}

/**
 * The order the worktrees' branches merge in with the fewest meetings (v3, read-only): each lane with commits its base
 * lacks, those whose changes meet no other lane's first, then by how many they meet, then the fewest commits. Filament
 * merges nothing.
 * @param {readonly LaneRef[]} lanes @param {ReadonlyMap<string, PlaceFiles>} files
 * @returns {{ lane: LaneRef, commits: number, base: string | null, meets: { path: string, lane: LaneRef }[] }[]}
 */
export function mergeOrder(lanes, files) {
  const read = lanes.map((lane) => ({ lane, f: files.get(placeKey(lane.path)) || null }));
  return read
    .filter((x) => !x.lane.main && x.f?.ok && (x.f.ahead ?? x.f.commits) > 0)
    .map((x) => {
      const mine = new Set((x.f?.files || []).map((f) => f.path));
      /** @type {{ path: string, lane: LaneRef }[]} */
      const meets = [];
      for (const y of read) {
        if (y === x) continue;
        for (const f of y.f?.files || []) if (mine.has(f.path)) meets.push({ path: f.path, lane: y.lane });
      }
      return { lane: x.lane, commits: Number(x.f?.ahead ?? x.f?.commits) || 0, base: x.f?.base ?? null, meets };
    })
    .sort((a, b) => Number(a.meets.length > 0) - Number(b.meets.length > 0) || a.meets.length - b.meets.length || a.commits - b.commits);
}

/**
 * Where a sync's lane stands, in the card's words.
 * @param {{ state: string, when: string, error?: string }} l @param {boolean} waitingNow  the runner still holds it
 */
export function syncLaneWords(l, waitingNow) {
  if (l.state === "sent") return "sent as a turn of its own";
  if (l.state === "steered") return "sent into its running turn";
  if (l.state === "waiting") return waitingNow ? "waits for its turn to end" : "waits";
  return `not sent: ${l.error || "refused"}`;
}

/** After how long away the Space says where work stood, though nothing moved since (SG-D3). */
export const AWAY_MS = 8 * 3_600_000;
/** How many lines of What happened Where you left off names; the rest are counted. */
export const LEFT_OFF_LINES = 3;

/**
 * Where you left off (SG-D3): Filament's own facts, no agent — the lines of What happened since your last look that
 * are not your own (the newest first), the chats that ask you, and, after `AWAY_MS` away, where work stood: the chat
 * last at work. Null on a first look, and where nothing moved and you were not long away.
 * @param {{ last: number | null, now: number, log: readonly SpaceEntry[],
 *   asks: { chain: string, name: string, fact: string }[],
 *   newest: { chain: string, name: string, chip: string, facts: string } | null }} o
 * @returns {{ last: number, lines: SpaceEntry[], more: number, asks: { chain: string, name: string, fact: string }[],
 *   stood: { chain: string, name: string, chip: string, facts: string } | null, go: string | null } | null}
 *   `go`: the chat Continue opens — the first that asks you, else the one last at work, else the newest line's
 */
export function leftOff({ last, now, log, asks, newest }) {
  if (!last || last > now) return null;
  const since = log.filter((e) => e.at > last && e.by.kind !== "you" && e.by.kind !== "keeper");
  const away = now - last >= AWAY_MS;
  if (!since.length && !(away && newest)) return null;
  const lines = since.slice(-LEFT_OFF_LINES).reverse();
  const go = asks[0]?.chain || newest?.chain || lines.find((e) => e.by.chain)?.by.chain || null;
  return { last, lines, more: since.length - lines.length, asks, stood: away ? newest : null, go };
}

/**
 * How What happened tags a line, at its right (the mock's source column): the person's is a note, an agent's its
 * chat's, Filament's own, a sync's told, the Record keeper's the week, another machine's its machine's (sp-cross).
 * @param {SpaceEntry} e
 */
export function happenedTag(e) {
  if (e.by.kind === "you") return "note";
  if (e.by.kind === "sync") return "told";
  if (e.by.kind === "keeper") return "week";
  if (e.by.kind === "filament") return "filament";
  if (e.by.kind === "machine") return "machine";
  return "agent";
}
